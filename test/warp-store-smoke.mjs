/**
 * 曲率存储冒烟（two-add-cosmos-proposal-warp 1.3 / spec cosmos-proposal-warp
 * 「门控接力状态机」「条目操作矩阵」「生命周期清理」「持久化与多窗口广播」）：
 *  - 条目 / 文档归一化容错（版本漂移、坏条目逐条丢弃、锚点去重、目标形态约束）；
 *  - 附着快照定稿（按钮快照 + 分流规则；重复附着拒绝只认非终态条目）；
 *  - 操作矩阵：grayed|ready|failed|skipped 可移出，launching|executing 拒绝；
 *  - 暂停标志、目标聚合读面、生命周期清理三路径、公开投影（不含 prompt 正文）；
 *  - 原子写 + createWarpStore 句柄（注入读/写/时钟/id）。
 * 运行：node test/warp-store-smoke.mjs
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  WARP_STATES,
  WARP_VERSION,
  attachWarpEntries,
  clearWarp,
  clearWarpEmbryoSlug,
  clearWarpProposal,
  clearWarpTarget,
  createWarpStore,
  emptyWarpDoc,
  hasActiveWarpTarget,
  normalizeWarpDoc,
  normalizeWarpEntry,
  patchWarpEntry,
  publicWarpSnapshotOf,
  removeWarpEntry,
  resolveWarpStorePath,
  setWarpPaused,
  warpCountsOf,
  warpTargetsOf
} from "../src/warp-store.mjs";

const cleanup = [];
const tempDir = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(dir);
  return dir;
};

const button = (name, extra = {}) => ({ name, prompt: "执行 " + name, ...extra });

/* ── 1. 路径 / 空文档 / 归一化容错 ── */
{
  assert.equal(resolveWarpStorePath({ env: { DSH_HOME: "C:/dsh-home" } }), join("C:/dsh-home", "storages", "dsh-v-cosmos.warp.json"), "路径 = $DSH_HOME/storages/dsh-v-cosmos.warp.json");
  assert.equal(resolveWarpStorePath({ env: {}, home: "C:/Users/x/.dsh" }), join("C:/Users/x/.dsh", "storages", "dsh-v-cosmos.warp.json"), "显式 home = 存储根");

  const empty = emptyWarpDoc();
  assert.deepEqual(empty, { version: WARP_VERSION, warps: {} });

  /* proposal 条目合法 */
  const proposal = normalizeWarpEntry({
    id: "w1",
    wsId: "ws1",
    targetKey: "add-a",
    targetKind: "proposal",
    targetLabel: "提案 A",
    proposalDir: "C:/ws/openspec/changes/add-a",
    button: { name: "Review", prompt: "审查", preState: "created", prepend: true, model: { provider: "p", model: "m" } },
    rule: "queue",
    state: "ready",
    enqueuedAt: 10,
    stateAt: 20
  });
  assert.ok(proposal, "合法 proposal 条目");
  assert.equal(proposal.rule, "queue");
  assert.equal(proposal.button.preState, "created", "preState 随快照定格");
  assert.equal(proposal.button.prepend, true);
  assert.deepEqual(proposal.button.model, { provider: "p", model: "m" });
  assert.equal("explorerSessionId" in proposal, false);

  /* 缺必填 → null */
  assert.equal(normalizeWarpEntry({ ...proposal, targetKind: "unknown" }), null, "未知目标形态");
  assert.equal(normalizeWarpEntry({ ...proposal, proposalDir: "" }), null, "proposal 缺目录");
  assert.equal(normalizeWarpEntry({ ...proposal, button: { name: "", prompt: "x" } }), null, "缺按钮名");
  assert.equal(normalizeWarpEntry({ ...proposal, button: { name: "Review", prompt: "  " } }), null, "空 prompt");

  /* embryo：slug 去重 + 探索会话；未知 preState 丢弃（不拒绝条目） */
  const embryo = normalizeWarpEntry({
    id: "w2",
    wsId: "ws1",
    targetKey: "session-1",
    targetKind: "embryo",
    anchorSlugs: ["s1", " s2 ", "s1", ""],
    explorerSessionId: "session-1",
    button: { name: "New", prompt: "探索", preState: "proto" },
    rule: "queue",
    state: "grayed"
  });
  assert.ok(embryo, "合法 embryo 条目");
  assert.deepEqual(embryo.anchorSlugs, ["s1", "s2"], "slug trim 去重保序");
  assert.equal(embryo.explorerSessionId, "session-1");
  assert.equal(embryo.rule, "queue");
  assert.equal(normalizeWarpEntry({ ...embryo, anchorSlugs: [] }), null, "embryo 必须有锚点");

  /* 文档归一化：版本漂移 → 空；坏条目逐条丢弃；同 id 去重 */
  assert.deepEqual(normalizeWarpDoc({ version: 99, warps: {} }), emptyWarpDoc(), "版本漂移 → 空文档");
  const doc = normalizeWarpDoc({
    version: WARP_VERSION,
    warps: {
      ws1: {
        paused: true,
        pausedAt: 5,
        entries: [proposal, { id: "bad" }, { ...proposal }, { ...embryo }]
      },
      "": { entries: [] },
      ws2: { entries: [] }
    }
  });
  assert.deepEqual(Object.keys(doc.warps), ["ws1"], "空队列/空 id 不落文档");
  assert.equal(doc.warps.ws1.entries.length, 2, "坏条目丢弃 + 同 id 去重");
  assert.equal(doc.warps.ws1.paused, true);
  assert.equal(doc.warps.ws1.pausedAt, 5);
}

/* ── 2. 附着：快照 / 重复拒绝 / 终态残留不构成重复 ── */
{
  let doc = emptyWarpDoc();
  const inputs = [
    { button: button("Review", { preState: "created" }), rule: "direct" },
    { button: button("Archive", { preState: "executed" }), rule: "queue" }
  ];
  const attached = attachWarpEntries(doc, {
    wsId: "ws1",
    targetKey: "add-a",
    targetKind: "proposal",
    targetLabel: "提案 A",
    proposalDir: "C:/ws/openspec/changes/add-a",
    entries: inputs,
    now: 100,
    idFactory: (() => {
      let n = 0;
      return () => "w-" + (++n);
    })()
  });
  assert.equal(attached.ok, true);
  assert.equal(attached.entries.length, 2);
  assert.equal(attached.entries[0].state, "grayed", "附着即 grayed 入场");
  assert.equal(attached.entries[0].enqueuedAt, 100);
  assert.equal(attached.entries[1].rule, "queue", "规则快照");
  doc = attached.doc;
  assert.equal(hasActiveWarpTarget(doc, "ws1", "add-a"), true);

  const duplicate = attachWarpEntries(doc, {
    wsId: "ws1",
    targetKey: "add-a",
    targetKind: "proposal",
    proposalDir: "C:/ws/openspec/changes/add-a",
    entries: [{ button: button("Apply"), rule: "direct" }]
  });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error, "duplicate", "非终态条目 → 重复附着拒绝");

  /* 置灰条目移出后 → 可再次附着 */
  doc = removeWarpEntry(doc, { wsId: "ws1", entryId: "w-1" }).doc;
  doc = removeWarpEntry(doc, { wsId: "ws1", entryId: "w-2" }).doc;
  assert.equal(hasActiveWarpTarget(doc, "ws1", "add-a"), false, "全部移出 → 已托管解除");

  /* failed / skipped 残留不构成重复 */
  const again = attachWarpEntries(doc, {
    wsId: "ws1",
    targetKey: "add-a",
    targetKind: "proposal",
    proposalDir: "C:/ws/openspec/changes/add-a",
    entries: [{ button: button("Review"), rule: "direct" }],
    now: 200,
    idFactory: () => "w-3"
  });
  doc = again.doc;
  doc = patchWarpEntry(doc, { wsId: "ws1", entryId: "w-3", patch: { state: "failed", reason: "x" }, now: 210 }).doc;
  const retry = attachWarpEntries(doc, {
    wsId: "ws1",
    targetKey: "add-a",
    targetKind: "proposal",
    proposalDir: "C:/ws/openspec/changes/add-a",
    entries: [{ button: button("Review"), rule: "direct" }],
    now: 220,
    idFactory: () => "w-4"
  });
  assert.equal(retry.ok, true, "failed 残留不构成重复");
}

/* ── 3. 操作矩阵 / 暂停 / 计数 / 目标聚合 ── */
{
  let doc = emptyWarpDoc();
  const entries = WARP_STATES.map((state, index) => ({
    button: button("B" + index),
    rule: "direct"
  }));
  doc = attachWarpEntries(doc, {
    wsId: "ws1",
    targetKey: "t" + 1,
    targetKind: "proposal",
    proposalDir: "C:/ws/openspec/changes/t1",
    entries,
    now: 1,
    idFactory: (() => {
      let n = 0;
      return () => "e" + (++n);
    })()
  }).doc;
  for (let i = 0; i < WARP_STATES.length; i += 1) {
    doc = patchWarpEntry(doc, { wsId: "ws1", entryId: "e" + (i + 1), patch: { state: WARP_STATES[i] }, now: 2 }).doc;
  }
  const warp = doc.warps.ws1;
  assert.deepEqual(
    warpCountsOf(warp),
    { total: 6, grayed: 1, ready: 1, launching: 1, executing: 1, failed: 1, skipped: 1, inflight: 2, pending: 2 },
    "计数口径（inflight = launching + executing；pending = grayed + ready）"
  );
  /* 可移出：grayed/ready/failed/skipped；锁定：launching/executing */
  for (const [index, state] of WARP_STATES.entries()) {
    const result = removeWarpEntry(doc, { wsId: "ws1", entryId: "e" + (index + 1) });
    if (state === "launching" || state === "executing") {
      assert.equal(result.ok, false, state + " 锁定");
      assert.equal(result.error, "locked");
    } else {
      assert.equal(result.ok, true, state + " 可移出");
    }
  }
  assert.equal(removeWarpEntry(doc, { wsId: "ws1", entryId: "missing" }).error, "missing", "缺失条目");

  /* 暂停标志（不改条目） */
  const paused = setWarpPaused(doc, { wsId: "ws1", paused: true, now: 7 });
  assert.equal(paused.paused, true);
  assert.equal(paused.doc.warps.ws1.pausedAt, 7);
  assert.equal(paused.doc.warps.ws1.entries.length, warp.entries.length, "暂停不触碰条目");
  const resumed = setWarpPaused(paused.doc, { wsId: "ws1", paused: false });
  assert.equal(resumed.doc.warps.ws1.paused, false);
  assert.equal(resumed.doc.warps.ws1.pausedAt, 0);

  /* 目标聚合：去重 + embryo 探索会话 */
  let multi = emptyWarpDoc();
  multi = attachWarpEntries(multi, {
    wsId: "ws1",
    targetKey: "add-a",
    targetKind: "proposal",
    proposalDir: "C:/ws/openspec/changes/add-a",
    entries: [{ button: button("A") }, { button: button("B") }],
    idFactory: (() => {
      let n = 0;
      return () => "m" + (++n);
    })()
  }).doc;
  multi = attachWarpEntries(multi, {
    wsId: "ws1",
    targetKey: "sess-1",
    targetKind: "embryo",
    anchorSlugs: ["s1", "s2"],
    explorerSessionId: "sess-1",
    entries: [{ button: button("New", { preState: "proto" }) }],
    idFactory: () => "m9"
  }).doc;
  const targets = warpTargetsOf(multi);
  assert.equal(targets.length, 2, "同目标两条目聚合为一行");
  const embryoTarget = targets.find((target) => target.targetKind === "embryo");
  assert.equal(embryoTarget.explorerSessionId, "sess-1");
}

/* ── 4. 生命周期清理三路径 + 公开投影 ── */
{
  const make = () => {
    let doc = emptyWarpDoc();
    doc = attachWarpEntries(doc, {
      wsId: "ws1",
      targetKey: "add-a",
      targetKind: "proposal",
      proposalDir: "C:/ws/openspec/changes/add-a",
      entries: [{ button: button("Review", { preState: "created" }) }, { button: button("Apply", { preState: "reviewed" }) }],
      now: 1,
      idFactory: (() => {
        let n = 0;
        return () => "a" + (++n);
      })()
    }).doc;
    doc = patchWarpEntry(doc, { wsId: "ws1", entryId: "a2", patch: { state: "executing", sessionId: "s" }, now: 2 }).doc;
    doc = attachWarpEntries(doc, {
      wsId: "ws1",
      targetKey: "sess-1",
      targetKind: "embryo",
      anchorSlugs: ["s1", "s2"],
      explorerSessionId: "sess-1",
      entries: [{ button: button("New", { preState: "proto" }) }],
      now: 3,
      idFactory: () => "b1"
    }).doc;
    doc = attachWarpEntries(doc, {
      wsId: "ws1",
      targetKey: "add-b",
      targetKind: "proposal",
      proposalDir: "C:/ws/openspec/changes/add-b",
      entries: [{ button: button("Review") }],
      now: 4,
      idFactory: () => "c1"
    }).doc;
    return doc;
  };

  /* 提案归档：清非在途，executing 保留 */
  const archived = clearWarpProposal(make(), { wsId: "ws1", proposalId: "add-a" });
  assert.equal(archived.removed, 1, "归档只清 grayed（executing 保留）");
  assert.deepEqual(archived.doc.warps.ws1.entries.map((entry) => entry.id), ["a2", "b1", "c1"], "其他目标不受影响");

  /* 星胚移除：含该 slug 的星胚目标全清（含在途） */
  const dismissed = clearWarpEmbryoSlug(make(), { wsId: "ws1", slug: "s2" });
  assert.equal(dismissed.removed, 1);
  assert.deepEqual(dismissed.doc.warps.ws1.entries.map((entry) => entry.id), ["a1", "a2", "c1"], "星胚目标全清，已展开提案不受影响");

  /* 清目标（includeInflight 开关） */
  const kept = clearWarpTarget(make(), { wsId: "ws1", targetKey: "add-a" });
  assert.equal(kept.removed, 1, "默认保留在途");
  const all = clearWarpTarget(make(), { wsId: "ws1", targetKey: "add-a", includeInflight: true });
  assert.equal(all.removed, 2, "includeInflight 全清");

  /* 工作区不在册：整队列删除 */
  const cleared = clearWarp(make(), { wsId: "ws1" });
  assert.equal(cleared.removed, 4);
  assert.equal(cleared.doc.warps.ws1, undefined);

  /* 公开投影不含 prompt 正文；executing 子态 + ready 等待会话空闲 */
  const snapshot = publicWarpSnapshotOf(make(), (wsId, entry) => {
    if (entry.state === "executing") return { running: true, waiting: 0 };
    if (entry.state === "ready") return { waitingSession: true };
    return null;
  });
  const publicEntry = snapshot.warps.ws1.entries[0];
  assert.equal(publicEntry.buttonName, "Review");
  assert.equal(publicEntry.targetKey, "add-a");
  assert.equal(publicEntry.targetKind, "proposal");
  assert.equal(publicEntry.rule, "direct");
  assert.equal("prompt" in publicEntry, false, "投影不含 prompt 正文");
  assert.equal(snapshot.warps.ws1.entries.find((entry) => entry.id === "a2").subState, "running", "executing running 子态");
}

/* ── 5. 原子写 + 句柄（注入） ── */
{
  const home = tempDir("dsh-cosmos-warp-home-");
  const store = createWarpStore({
    env: { DSH_HOME: home },
    now: () => 1234,
    idFactory: (() => {
      let n = 0;
      return () => "w-" + (++n);
    })()
  });
  assert.equal(store.load().version, WARP_VERSION);
  const attached = store.attach({
    wsId: "ws1",
    targetKey: "add-a",
    targetKind: "proposal",
    proposalDir: "C:/ws/openspec/changes/add-a",
    entries: [{ button: button("Review", { preState: "created" }) }]
  });
  assert.equal(attached.ok, true);
  assert.equal(attached.entries[0].id, "w-1");
  assert.equal(attached.entries[0].enqueuedAt, 1234, "时钟注入");
  const filePath = join(home, "storages", "dsh-v-cosmos.warp.json");
  const text = readFileSync(filePath, "utf8");
  assert.ok(text.includes('"version": 1'), "落盘版本");
  assert.ok(!text.startsWith("\ufeff"), "无 BOM");
  const reloaded = createWarpStore({ env: { DSH_HOME: home } });
  reloaded.load();
  assert.equal(reloaded.warp("ws1").entries.length, 1, "重启可读回");

  /* 落盘失败只告警（内存态权威） */
  const warns = [];
  const broken = createWarpStore({
    filePath: join(home, "storages", "broken.json"),
    write: () => {
      throw new Error("disk full");
    },
    logger: { warn: (message) => warns.push(String(message)) }
  });
  broken.load();
  const result = broken.attach({
    wsId: "ws1",
    targetKey: "add-a",
    targetKind: "proposal",
    proposalDir: "dir",
    entries: [{ button: button("Review") }],
    idFactory: () => "x"
  });
  assert.equal(result.ok, true, "落盘失败不改变内存态结果");
  assert.equal(broken.warp("ws1").entries.length, 1);
  assert.equal(warns.some((line) => line.includes("落盘失败")), true, "落盘失败告警");
}

for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
console.log("warp-store-smoke: all assertions passed");
