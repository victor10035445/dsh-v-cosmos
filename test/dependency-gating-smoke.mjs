/**
 * 跨提案依赖调度门控冒烟（second-add-cross-proposal-dependency-gating 4.1 / 4.2）：
 *
 *  - A. 门控纯逻辑（dep-gate.mjs）：deps 快照归一 / 达标子句 / 等待原因推导；
 *  - B. 曲率侧（warp-scheduler + warp-store）：门控等待保持置灰、反向索引唤醒、
 *       前置失败等修复、点火与转投的防御复验（skipped + 依赖原因）、重启对账重建索引；
 *  - C. 脉冲侧（queue-scheduler + queue-store）：让位扫描（链式倒序 [b,c,a] → 执行序
 *       a,b,c）、无关条目不连坐、全等待闲置态与重扫、条目模型零改动（无 deps 字段）；
 *  - D. 宿主接线（index.mjs apply + 真路由）：附着 deps 定格、/warp 等待呈现、
 *       入队预警不拒绝、前置 failed → 等修复原因、依赖会话收尾沿整体驱动重扫。
 *
 * 运行：node test/dependency-gating-smoke.mjs
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply } from "../src/index.mjs";
import { createWarpScheduler } from "../src/warp-scheduler.mjs";
import {
  createWarpStore,
  publicWarpEntryOf,
  warpDependencyWaitersOf
} from "../src/warp-store.mjs";
import { createQueueStore, publicEntryOf } from "../src/queue-store.mjs";
import { createQueueScheduler } from "../src/queue-scheduler.mjs";
import { projectQueuePanel, projectWarpPanel } from "../src/panel.mjs";
import {
  DEPENDENCY_DRIFT_REASON,
  DEPENDENCY_WAIT_REASONS,
  dependencyVerdictOf,
  dependencyWaitOf,
  depsSnapshotOf,
  normalizeDeps,
  repairReasonOf
} from "../src/dep-gate.mjs";

const flush = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

let clock = 1000;
const nextClock = () => {
  clock += 10;
  return clock;
};

/* ────────────────────────────────────────────────────────────────────────────
 * A. 门控纯逻辑
 * ──────────────────────────────────────────────────────────────────────────── */

{
  assert.deepEqual(normalizeDeps(null), [], "缺失 → 空依赖（无守卫）");
  assert.deepEqual(normalizeDeps("x"), [], "非数组 → 空依赖");
  assert.deepEqual(normalizeDeps([{ slug: "a", state: "bogus" }]), [], "状态枚举外 → 整份丢弃");
  assert.deepEqual(
    normalizeDeps([{ slug: "a", state: "reviewed" }, { slug: "a", state: "executed" }]),
    [],
    "同 slug 重复 → 整份丢弃（normalizeRequires 契约）"
  );
  assert.deepEqual(
    normalizeDeps([{ slug: "b", state: "executed" }, { slug: "a", state: "reviewed" }]),
    [{ slug: "b", state: "executed" }, { slug: "a", state: "reviewed" }],
    "合法快照保序透传"
  );

  assert.deepEqual(
    depsSnapshotOf([
      { slug: "b", state: "executed", source: "derived" },
      { slug: "a", state: "reviewed", source: "declared" },
      { slug: "a", state: "executed", source: "declared" },
      { slug: "", state: "executed" },
      { slug: "c", state: "proto" }
    ]),
    [{ slug: "a", state: "reviewed" }, { slug: "b", state: "executed" }],
    "生效依赖 → 持久快照（去 source / 去重 / 码点序 / 非法丢弃）"
  );

  const observation = {
    active: [{ slug: "one-add-x", state: "reviewed" }, { slug: "two-add-y", state: "created" }],
    archiveNames: ["2026-01-old-add-z"]
  };
  const waiting = dependencyVerdictOf(observation, [{ slug: "one-add-x", state: "executed" }]);
  assert.equal(waiting.satisfied, false, "状态序未达 → 不达标");
  assert.deepEqual(waiting.first, { slug: "one-add-x", state: "executed" }, "首项透出");
  assert.equal(
    dependencyVerdictOf(observation, [{ slug: "one-add-x", state: "reviewed" }]).satisfied,
    true,
    "后继闭包：reviewed ≥ reviewed 达标"
  );
  assert.equal(
    dependencyVerdictOf(observation, [{ slug: "old-add-z", state: "executed" }]).satisfied,
    true,
    "归档探测（-<slug> 后缀）视为达标"
  );
  assert.equal(
    dependencyVerdictOf({ active: [{ slug: "proto-only", state: "proto" }], archiveNames: [] }, [
      { slug: "proto-only", state: "created" }
    ]).satisfied,
    false,
    "proto（未点燃）判不达标"
  );
  assert.deepEqual(dependencyVerdictOf(observation, []), { satisfied: true, unsatisfied: [], first: null }, "无依赖恒达标");

  assert.equal(repairReasonOf(["queued", "failed"]), DEPENDENCY_WAIT_REASONS.repair, "前置 failed → 等修复");
  assert.equal(repairReasonOf(["skipped"]), DEPENDENCY_WAIT_REASONS.repair, "前置 skipped → 等修复");
  assert.equal(repairReasonOf(["queued", "executing"]), null, "正常推进 → 无原因");

  const waitPlain = dependencyWaitOf(observation, [{ slug: "one-add-x", state: "executed" }]);
  assert.deepEqual(waitPlain, { dep: "one-add-x" }, "等待呈现：首个未达标项、无原因");
  const waitRepair = dependencyWaitOf(observation, [{ slug: "one-add-x", state: "executed" }], ["failed"]);
  assert.deepEqual(waitRepair, { dep: "one-add-x", reason: "repair" }, "等待呈现：等修复原因");
  assert.equal(dependencyWaitOf(observation, [{ slug: "one-add-x", state: "reviewed" }]), null, "达标 → 无等待");
}

/* ────────────────────────────────────────────────────────────────────────────
 * B. 曲率侧
 * ──────────────────────────────────────────────────────────────────────────── */

/** 曲率夹具（全注入面直测：假定时器 / 无 fs / 共享会话态桩）。 */
function makeWarpFixture(gate) {
  let id = 0;
  const store = createWarpStore({
    filePath: "C:/virtual/warp.json",
    read: () => null,
    write: () => {},
    now: () => clock,
    idFactory: () => "w-" + (++id)
  });
  const calls = { deliver: [], transfer: [], changes: 0, notify: [] };
  const sessionStates = new Map();
  const timers = [];
  const scheduler = createWarpScheduler({
    store,
    gate,
    deliver: async (entry) => {
      calls.deliver.push(entry);
      return { ok: true, sessionId: "s-" + entry.id };
    },
    transfer: async (entry) => {
      calls.transfer.push(entry);
      return { ok: true };
    },
    readSession: async () => ({ ok: true, running: false, waiting: false }),
    readSessionState: (sessionId) => sessionStates.get(sessionId) ?? null,
    onChange: () => {
      calls.changes += 1;
    },
    notify: (message, isError) => calls.notify.push({ message, isError }),
    now: () => clock,
    setTimeout: (fn, ms) => {
      const timer = { fn, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (timer) => {
      if (timer) timer.cleared = true;
    },
    firstBusyWindowMs: 5000,
    stopGraceMs: 50
  });
  return { store, scheduler, calls, timers, sessionStates };
}

/** 附着一组条目（默认 proposal 目标）。 */
function attachWarp(store, targetKey, entries, options = {}) {
  const now = nextClock();
  return store.attach({
    wsId: options.wsId ?? "ws1",
    targetKey,
    targetKind: options.targetKind ?? "proposal",
    targetLabel: targetKey,
    proposalDir: "C:/ws/openspec/changes/" + targetKey,
    deps: options.deps,
    entries,
    now
  });
}

const applyButton = (name = "Apply") => ({ button: { name, prompt: "执行 " + name }, rule: "direct" });
const queueButton = (name = "Apply") => ({ button: { name, prompt: "执行 " + name }, rule: "queue" });

/* B1. 门控等待：依赖未达标 → 保持置灰 + 呈现子态；反向索引命中后收尾沿唤醒 */
{
  const observation = { active: [{ slug: "one-add-x", state: "reviewed" }], archiveNames: [] };
  const gate = (entry) => (dependencyVerdictOf(observation, entry.deps).satisfied
    ? { ok: true }
    : { ok: false, reason: DEPENDENCY_DRIFT_REASON });
  const fx = makeWarpFixture(gate);
  const attached = attachWarp(fx.store, "two-add-y", [applyButton()], {
    deps: [{ slug: "one-add-x", state: "executed" }]
  });
  assert.equal(attached.ok, true, "附着力成功");
  assert.deepEqual(
    attached.entries[0].deps,
    [{ slug: "one-add-x", state: "executed" }],
    "deps 快照随条目持久化（附着时刻定格）"
  );
  fx.scheduler.reviewTarget("ws1", "two-add-y");
  await flush();
  const grayed = fx.store.warp("ws1").entries[0];
  assert.equal(grayed.state, "grayed", "依赖未达标 → 复查不点亮，保持置灰");
  assert.equal(fx.calls.deliver.length, 0, "未进入点火调度");

  const projected = publicWarpEntryOf(grayed, null, dependencyWaitOf(observation, grayed.deps, []));
  assert.equal(projected.subState, "waiting-dependency", "grayed 条目呈「等待依赖」子态");
  assert.equal(projected.waiting?.dep, "one-add-x", "等待依赖目标名透出（首个未达标项）");
  assert.equal("reason" in (projected.waiting ?? {}), false, "正常等待无原因");

  /* 反向索引：依赖提案 slug → 等待目标集合（随条目集现算、不独立持久化）。 */
  const waiters = warpDependencyWaitersOf(fx.store.doc).get("ws1\u0000one-add-x");
  assert.deepEqual(waiters, [{ wsId: "ws1", targetKey: "two-add-y" }], "反向索引命中等待目标");

  /* 依赖会话收尾沿：依赖提案达标 → 追加触发等待目标复查 → 点亮并点火。 */
  observation.active[0].state = "executed";
  for (const waiter of waiters) fx.scheduler.onTaskSettled(waiter.wsId, waiter.targetKey);
  await flush();
  const lit = fx.store.warp("ws1").entries[0];
  assert.equal(lit.state, "executing", "依赖达标 + 收尾沿 → 点亮并投递执行");
  assert.equal(fx.calls.deliver.length, 1, "投递一次");
  fx.scheduler.dispose();
}

/* B2. 前置失败：等待者保持置灰 + 等修复原因；修复后经触发沿唤醒 */
{
  const observation = { active: [{ slug: "one-add-x", state: "reviewed" }], archiveNames: [] };
  const gate = (entry) => (dependencyVerdictOf(observation, entry.deps).satisfied
    ? { ok: true }
    : { ok: false, reason: DEPENDENCY_DRIFT_REASON });
  const fx = makeWarpFixture(gate);
  attachWarp(fx.store, "two-add-y", [applyButton()], { deps: [{ slug: "one-add-x", state: "executed" }] });
  fx.scheduler.reviewTarget("ws1", "two-add-y");
  await flush();
  const grayed = fx.store.warp("ws1").entries[0];
  assert.equal(grayed.state, "grayed", "前置失败 → 等待者不联动标失败、不静默推进");
  const wait = dependencyWaitOf(observation, grayed.deps, ["failed"]);
  assert.deepEqual(wait, { dep: "one-add-x", reason: "repair" }, "透出等修复原因");
  const projected = publicWarpEntryOf(grayed, null, wait);
  assert.equal(projected.subState, "waiting-dependency", "等待依赖子态保留");

  /* 前置修复（重试成功收尾 / 手动完成）→ 同一触发沿唤醒 */
  observation.active[0].state = "executed";
  fx.scheduler.onTaskSettled("ws1", "two-add-y");
  await flush();
  assert.equal(fx.store.warp("ws1").entries[0].state, "executing", "修复后点亮执行");
  fx.scheduler.dispose();
}

/* B3. 点火防御复验：门控通过后 deps 旁路未达标 → skipped + 依赖原因（不投递） */
{
  let calls = 0;
  const gate = () => {
    calls += 1;
    return calls === 1 ? { ok: true } : { ok: false, reason: DEPENDENCY_DRIFT_REASON };
  };
  const fx = makeWarpFixture(gate);
  attachWarp(fx.store, "two-add-y", [applyButton()], { deps: [{ slug: "one-add-x", state: "executed" }] });
  fx.scheduler.reviewTarget("ws1", "two-add-y");
  await flush();
  const skipped = fx.store.warp("ws1").entries[0];
  assert.equal(skipped.state, "skipped", "点火复验不过 → skipped 残留");
  assert.equal(skipped.reason, DEPENDENCY_DRIFT_REASON, "原因码 = dependency-drift");
  assert.ok(String(skipped.message).includes("依赖"), "依赖原因透出");
  assert.equal(fx.calls.deliver.length, 0, "未发起投递");
  fx.scheduler.dispose();
}

/* B4. 转投防御复验：ready 后转投复验发现依赖未达标 → skipped（不转入脉冲队列） */
{
  let calls = 0;
  const gate = () => {
    calls += 1;
    return calls === 1 ? { ok: true } : { ok: false, reason: DEPENDENCY_DRIFT_REASON };
  };
  const fx = makeWarpFixture(gate);
  attachWarp(fx.store, "two-add-y", [queueButton()], { deps: [{ slug: "one-add-x", state: "executed" }] });
  fx.scheduler.reviewTarget("ws1", "two-add-y");
  await flush();
  const skipped = fx.store.warp("ws1").entries[0];
  assert.equal(skipped.state, "skipped", "转投复验不过 → skipped 残留");
  assert.equal(skipped.reason, DEPENDENCY_DRIFT_REASON, "原因码 = dependency-drift");
  assert.ok(String(skipped.message).includes("依赖"), "依赖原因透出");
  assert.equal(fx.calls.transfer.length, 0, "未转入脉冲队列");
  fx.scheduler.dispose();
}

/* B5. 重启对账：deps 随条目回读 → 反向索引等价重建（无独立持久化） */
{
  let saved = null;
  const store = createWarpStore({
    filePath: "mem://warp",
    read: () => saved,
    write: (path, text) => {
      saved = text;
    },
    now: () => clock,
    idFactory: () => "w-" + Math.random().toString(16).slice(2)
  });
  attachWarp(store, "two-add-y", [applyButton()], { deps: [{ slug: "one-add-x", state: "executed" }] });
  assert.equal(typeof saved, "string", "附着落盘");
  assert.ok(saved.includes("\"deps\""), "deps 快照入盘");
  const reloaded = createWarpStore({ filePath: "mem://warp", read: () => saved, write: () => {} });
  reloaded.load();
  const entry = reloaded.warp("ws1").entries[0];
  assert.deepEqual(entry.deps, [{ slug: "one-add-x", state: "executed" }], "回读保留 deps 快照");
  assert.deepEqual(
    warpDependencyWaitersOf(reloaded.doc).get("ws1\u0000one-add-x"),
    [{ wsId: "ws1", targetKey: "two-add-y" }],
    "索引从条目 deps 等价重建"
  );
  /* 终态残留不参与等待（failed/skipped 不再唤醒） */
  reloaded.patch({ wsId: "ws1", entryId: entry.id, patch: { state: "failed", reason: "turn-error" } });
  assert.equal(warpDependencyWaitersOf(reloaded.doc).get("ws1\u0000one-add-x"), undefined, "残留条目不入索引");
}

/* ────────────────────────────────────────────────────────────────────────────
 * C. 脉冲侧（让位扫描）
 * ──────────────────────────────────────────────────────────────────────────── */

const QUEUE_WS = "ws1";

/** 队列夹具：depsOf(proposalId) → 依赖 slug 清单；satisfied 集合驱动达标。 */
function makeQueueFixture(depsOf) {
  let seq = 0;
  const store = createQueueStore({
    filePath: "mem://queues",
    read: () => null,
    write: () => {},
    now: () => clock,
    idFactory: () => "q-" + (++seq)
  });
  const satisfied = new Set();
  const calls = [];
  const pending = [];
  const timers = [];
  const scheduler = createQueueScheduler({
    store,
    deliver: (entry) => new Promise((resolve) => {
      calls.push(entry);
      pending.push(resolve);
    }),
    readSession: async () => ({ ok: true, running: false, waiting: false }),
    reverify: async () => ({ ok: true }),
    depsSatisfied: (wsId, entry) => depsOf(entry.proposalId).every((slug) => satisfied.has(slug)),
    onChange: () => {},
    notify: () => {},
    now: () => clock,
    setTimeout: (fn, ms) => {
      const timer = { fn, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (timer) => {
      if (timer) timer.cleared = true;
    },
    firstBusyWindowMs: 5000,
    stopGraceMs: 50
  });
  const enqueue = (proposalId) => {
    const result = store.enqueue({
      wsId: QUEUE_WS,
      proposalId,
      proposalDir: "C:/ws/openspec/changes/" + proposalId,
      button: { name: "Apply", prompt: "apply " + proposalId }
    });
    assert.equal(result.ok, true, "入队 " + proposalId);
    return result.entry;
  };
  const resolveNext = async (value) => {
    const resolve = pending.shift();
    assert.ok(resolve, "没有待投递调用");
    resolve(value);
    await flush();
  };
  const complete = (sessionId) => {
    scheduler.onAgentStatus({ sessionId, status: "running" });
    scheduler.onSessionTurnEnd(sessionId, { kind: "completed" });
    scheduler.onAgentStatus({ sessionId, status: "idle" });
  };
  return { store, scheduler, calls, satisfied, enqueue, resolveNext, complete };
}

/* C1. 链式倒序 [b,c,a] → 执行序 a,b,c；存储顺序保持 FIFO */
{
  const deps = { "two-add-b": ["one-add-a"], "three-add-c": ["two-add-b"], "one-add-a": [] };
  const fx = makeQueueFixture((proposalId) => deps[proposalId] ?? []);
  const b = fx.enqueue("two-add-b");
  const c = fx.enqueue("three-add-c");
  const a = fx.enqueue("one-add-a");
  fx.scheduler.kick(QUEUE_WS);
  await flush();
  assert.equal(fx.calls.length, 1, "只启动一条");
  assert.equal(fx.calls[0].proposalId, "one-add-a", "让位扫描跳过 b、c，启动首个依赖达标的 a");
  assert.equal(fx.store.find(QUEUE_WS, b.id).state, "queued", "被跳条目保持 queued（不落残态）");
  assert.equal(fx.store.find(QUEUE_WS, c.id).state, "queued", "被跳条目保持 queued");
  assert.deepEqual(
    fx.store.queue(QUEUE_WS).entries.map((entry) => entry.proposalId),
    ["two-add-b", "three-add-c", "one-add-a"],
    "存储顺序（入队 FIFO）不变"
  );

  await fx.resolveNext({ ok: true, sessionId: "s-a" });
  fx.satisfied.add("one-add-a");
  fx.complete("s-a");
  await flush();
  assert.equal(fx.calls.at(-1).proposalId, "two-add-b", "a 完成后启动 b");
  await fx.resolveNext({ ok: true, sessionId: "s-b" });
  fx.satisfied.add("two-add-b");
  fx.complete("s-b");
  await flush();
  assert.equal(fx.calls.at(-1).proposalId, "three-add-c", "b 完成后启动 c（执行序 a→b→c）");
  assert.deepEqual(
    fx.store.queue(QUEUE_WS).entries.map((entry) => entry.proposalId),
    ["three-add-c"],
    "已完成条目出队，剩余顺序保持"
  );
  fx.scheduler.dispose();
}

/* C2. 无关条目不连坐 [x,b]（b 先入队） */
{
  const deps = { "two-add-b": ["one-add-a"] };
  const fx = makeQueueFixture((proposalId) => deps[proposalId] ?? []);
  const b = fx.enqueue("two-add-b");
  fx.enqueue("nine-add-x");
  fx.scheduler.kick(QUEUE_WS);
  await flush();
  assert.equal(fx.calls.length, 1, "启动一条");
  assert.equal(fx.calls[0].proposalId, "nine-add-x", "跳过等待依赖的 b，启动无依赖 x");
  assert.equal(fx.store.find(QUEUE_WS, b.id).state, "queued", "b 不被连坐（保持 queued）");
  fx.scheduler.dispose();
}

/* C3. 全等待闲置态与重扫（暂停标志恒不动；下一执行指示与扫描单点同源） */
{
  const deps = { "two-add-b": ["one-add-a"] };
  const fx = makeQueueFixture((proposalId) => deps[proposalId] ?? []);
  const b = fx.enqueue("two-add-b");
  fx.scheduler.kick(QUEUE_WS);
  await flush();
  assert.equal(fx.calls.length, 0, "全等待 → 不启动任何条目");
  assert.equal(fx.store.queue(QUEUE_WS).paused, false, "闲置态 MUST NOT 自动置暂停标志");
  assert.equal(fx.scheduler.nextExecutable(QUEUE_WS), null, "下一执行指示为空（全等待）");
  const projected = publicEntryOf(
    fx.store.find(QUEUE_WS, b.id),
    null,
    { dep: "one-add-a" }
  );
  assert.equal(projected.subState, "waiting-dependency", "queued 条目呈等待依赖子态");
  assert.equal("deps" in fx.store.find(QUEUE_WS, b.id), false, "条目模型零改动（无 deps 字段）");

  /* 依赖达标 + 整体重扫（关联会话收尾触发源驱动）→ 启动 */
  fx.satisfied.add("one-add-a");
  assert.equal(fx.scheduler.nextExecutable(QUEUE_WS)?.proposalId, "two-add-b", "重扫后下一执行 = b");
  fx.scheduler.kick(QUEUE_WS);
  await flush();
  assert.equal(fx.calls.length, 1, "达标后重扫启动 b");
  assert.equal(fx.calls[0].proposalId, "two-add-b", "启动的是 b");
  fx.scheduler.dispose();
}

/* ────────────────────────────────────────────────────────────────────────────
 * D. 宿主接线（真路由 + 真解析面）
 * ──────────────────────────────────────────────────────────────────────────── */

const cleanupDirs = [];
const tempDir = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
};

const writeProposal = (changesDir, slug, state) => {
  const dir = join(changesDir, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "tasks.md"), "- [ ] one\n- [ ] two");
  writeFileSync(join(dir, ".state.json"), JSON.stringify({ version: 1, state, setBy: "test", at: 1 }));
  return dir;
};

try {
  const wsRoot = tempDir("dsh-cosmos-dep-ws-");
  const changesDir = join(wsRoot, "openspec", "changes");
  const xDir = writeProposal(changesDir, "one-add-x", "created");
  writeProposal(changesDir, "two-add-y", "created");
  const workspaces = [{ id: "ws1", title: "WS One", path: wsRoot, sessionIds: [] }];
  const home = tempDir("dsh-cosmos-dep-home-");
  process.env.DSH_HOME = home;

  /* 关联预载（依赖提案的活动计数数据源：sess-x ↔ one-add-x）。 */
  mkdirSync(join(home, "storages"), { recursive: true });
  writeFileSync(join(home, "storages", "dsh-v-cosmos.json"), JSON.stringify({
    version: 1,
    entries: [{
      workspace: wsRoot,
      proposal: "one-add-x",
      sessionId: "sess-x",
      origin: "explicit",
      createdAt: 1,
      updatedAt: 1
    }]
  }, null, 2));
  /* 谱系台账预载：two-add-y 显式声明依赖 one-add-x(executed)。 */
  writeFileSync(join(home, "storages", "dsh-v-cosmos.birthlines.json"), JSON.stringify({
    version: 1,
    workspaces: {
      [wsRoot]: {
        lineages: [
          { slug: "one-add-x", embryoAt: 1, ignitedMs: 1 },
          { slug: "two-add-y", embryoAt: 1, ignitedMs: 2, requires: [{ slug: "one-add-x", state: "executed" }] }
        ],
        sightings: []
      }
    }
  }, null, 2));
  /* 队列预载：one-add-x 的 failed 残留（等待原因 = 等修复的推导输入）。 */
  writeFileSync(join(home, "storages", "dsh-v-cosmos.queues.json"), JSON.stringify({
    version: 1,
    queues: {
      ws1: {
        paused: false,
        pausedAt: 0,
        entries: [{
          id: "q-failed",
          wsId: "ws1",
          proposalId: "one-add-x",
          proposalDir: xDir,
          button: { name: "Apply", prompt: "apply one-add-x" },
          enqueuedAt: 1,
          state: "failed",
          stateAt: 1,
          reason: "turn-error",
          message: "回合错误"
        }]
      }
    }
  }, null, 2));

  const buttons = [{ name: "Apply", prompt: "执行 Apply", autoSend: true }];
  const config = { buttons, warpPlan: { bars: [{ name: "Apply" }] } };

  let handler = null;
  const listeners = [];
  const sessionCalls = [];
  const sessionController = {
    async create(...args) {
      sessionCalls.push({ method: "create", args });
      return { sessionId: "sess-new" };
    },
    async selectModel() {
      return { selected: true };
    },
    async rename(args) {
      sessionCalls.push({ method: "rename", args });
      return { title: args?.[0]?.title ?? "", seq: 1 };
    },
    async prompt(...args) {
      sessionCalls.push({ method: "prompt", args });
      return { accepted: true };
    },
    async list() {
      return { items: [] };
    }
  };
  const ctx = {
    logger: { warn() {} },
    effect(fn) {
      return fn();
    },
    inject() {},
    on(event, listener, listenerOptions) {
      const record = { event, listener, listenerOptions };
      listeners.push(record);
      return () => {
        const index = listeners.indexOf(record);
        if (index >= 0) listeners.splice(index, 1);
      };
    },
    webServer: {
      register(definition) {
        handler = definition.handler;
        return () => {};
      }
    },
    workspaceRegistry: {
      list: () => workspaces,
      get archivedSessionIds() {
        return new Set();
      }
    },
    agents: { get: () => null },
    sessions: { get: () => null },
    sessionController,
    tools: null,
    listeners
  };
  apply(ctx, config, {});
  assert.ok(handler, "apply 注册了 API handler");

  const captureJson = () => {
    const state = { status: 0, body: null };
    state.res = {
      writeHead(status) {
        state.status = status;
      },
      write() {},
      end(chunk) {
        try {
          state.body = JSON.parse(String(chunk ?? ""));
        } catch {
          state.body = null;
        }
      },
      on() {}
    };
    return state;
  };
  const getJson = async (url) => {
    const state = captureJson();
    await handler({ method: "GET", url }, state.res);
    return state;
  };
  const postJson = async (path, body) => {
    const state = captureJson();
    const chunks = [Buffer.from(JSON.stringify(body ?? {}), "utf8")];
    await handler({
      method: "POST",
      url: "/api/dsh-v-cosmos" + path,
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) yield chunk;
      }
    }, state.res);
    return state;
  };

  /* D1. 附着：deps 快照定格进条目（磁盘可见） */
  const attached = await postJson("/warp/attach", { wsId: "ws1", targetKind: "proposal", targetKey: "two-add-y" });
  assert.equal(attached.status, 200, "附着 200");
  assert.equal(attached.body.ok, true, "附着 ok");
  const warpDoc = JSON.parse(readFileSync(join(home, "storages", "dsh-v-cosmos.warp.json"), "utf8"));
  assert.deepEqual(
    warpDoc.warps.ws1.entries[0].deps,
    [{ slug: "one-add-x", state: "executed" }],
    "附着时刻解析并定格 deps 快照"
  );

  /* D2. /warp 呈现：grayed + 等待依赖子态（前置 failed → 等修复原因） */
  const warpSnapshot = await getJson("/api/dsh-v-cosmos/warp");
  const warpEntry = warpSnapshot.body.warp.warps.ws1.entries[0];
  assert.equal(warpEntry.state, "grayed", "依赖未达标 → 置灰");
  assert.equal(warpEntry.subState, "waiting-dependency", "等待依赖子态");
  assert.deepEqual(warpEntry.waiting, { dep: "one-add-x", reason: "repair" }, "等待目标 + 等修复原因");

  /* D3. 入队预警：未达标仍允许入队（不拒绝、不落残态、条目模型零改动） */
  const enqueued = await postJson("/queue/enqueue", { wsId: "ws1", proposalId: "two-add-y", buttonName: "Apply" });
  assert.equal(enqueued.status, 200, "依赖未达标入队 200（不拒绝）");
  assert.equal(enqueued.body.ok, true, "入队成功");
  assert.deepEqual(enqueued.body.warning, { dependency: "one-add-x", requiredState: "executed" }, "预警信息透出");
  assert.equal(enqueued.body.entry.state, "queued", "落 queued（无残态）");
  assert.equal(enqueued.body.entry.subState, "waiting-dependency", "入队响应即带等待依赖子态");
  assert.deepEqual(enqueued.body.entry.waiting, { dep: "one-add-x", reason: "repair" }, "等待原因 = 等修复");

  /* D4. /queue 队列级呈现：闲置态（非暂停）+ 无下一执行 */
  const queueSnapshot = await getJson("/api/dsh-v-cosmos/queue");
  const queue = queueSnapshot.body.queue.queues.ws1;
  assert.equal(queue.paused, false, "闲置态不是暂停（暂停标志不动）");
  assert.equal(queue.idle, true, "全部等待依赖 → 闲置态");
  assert.equal(queue.nextExecution, null, "全等待 → 无下一执行指示");
  assert.equal(queue.entries.find((entry) => entry.proposalId === "two-add-y").state, "queued", "等待条目保持 queued");

  /* D5. 依赖会话收尾沿 → 整体重扫 → 依赖达标条目启动 */
  writeFileSync(join(xDir, ".state.json"), JSON.stringify({ version: 1, state: "executed", setBy: "test", at: 2 }));
  await sleep(450); // 观察快照 TTL 过期（下一帧读到当刻磁盘事实）
  const statusListener = listeners.find((record) => record.event === "agent/status");
  assert.ok(statusListener, "agent/status 监听已挂");
  statusListener.listener({ agent: { id: "sess-x" }, status: "running" });
  await sleep(5);
  statusListener.listener({ agent: { id: "sess-x" }, status: "idle" });
  await sleep(20);
  const afterSettle = await getJson("/api/dsh-v-cosmos/queue");
  const afterQueue = afterSettle.body.queue.queues.ws1;
  const started = afterQueue.entries.find((entry) => entry.proposalId === "two-add-y");
  assert.ok(
    started && (started.state === "executing" || started.state === "launching"),
    "依赖会话收尾沿唤醒 → 整体重扫启动达标条目（实际 " + started?.state + "）"
  );
  assert.equal(afterQueue.idle, false, "有可执行条目后闲置态解除");
  assert.equal(afterQueue.paused, false, "重扫不改变暂停标志");

  /* D6. 曲率等待者同批唤醒（反向索引）：grayed 条目已点亮 */
  const warpAfter = await getJson("/api/dsh-v-cosmos/warp");
  const warpLit = warpAfter.body.warp.warps.ws1.entries[0];
  assert.ok(
    warpLit.state === "ready" || warpLit.state === "launching" || warpLit.state === "executing",
    "依赖达标 → 曲率等待者点亮（实际 " + warpLit.state + "）"
  );
  assert.equal(warpLit.subState ?? null, null, "等待依赖子态消失");
} finally {
  for (const dir of cleanupDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * E. 呈现投影与词典（3.1–3.3）
 * ──────────────────────────────────────────────────────────────────────────── */

{
  const grayedEntry = {
    id: "w1",
    wsId: "ws1",
    targetKey: "two-add-y",
    targetKind: "proposal",
    targetLabel: "two-add-y",
    buttonName: "Apply",
    rule: "direct",
    state: "grayed",
    subState: "waiting-dependency",
    waiting: { dep: "one-add-x", reason: "repair" },
    enqueuedAt: 1000
  };
  const warpPanel = projectWarpPanel({
    warp: { entries: [grayedEntry], counts: { total: 1 } },
    wsId: "ws1",
    now: 2000,
    waitLabels: { dependency: "等待依赖", repair: "等修复" }
  });
  const warpRow = warpPanel.rows[0];
  assert.equal(warpRow.badgeKey, "waiting-dependency", "曲率等待依赖徽标键");
  assert.equal(warpRow.badgeLabel, "等待依赖 one-add-x", "徽标文案 = 等待依赖 <前置提案名>");
  assert.equal(warpRow.waitingDep, "one-add-x", "等待目标透出");
  assert.equal(warpRow.waitingDetail, "等修复", "等待原因（等修复）行内可见");
  assert.ok(String(warpRow.rowTitle).includes("等修复"), "rowTitle 含等待原因");

  const queuedEntry = {
    id: "q1",
    wsId: "ws1",
    proposalId: "two-add-y",
    buttonName: "Apply",
    state: "queued",
    subState: "waiting-dependency",
    waiting: { dep: "one-add-x" },
    enqueuedAt: 1000
  };
  const queuePanel = projectQueuePanel({
    queue: {
      paused: false,
      counts: { total: 1, queued: 1, launching: 0, executing: 0, failed: 0, skipped: 0, active: 1 },
      entries: [queuedEntry],
      nextExecution: { proposalId: "two-add-y", buttonName: "Apply" },
      idle: true
    },
    wsId: "ws1",
    now: 2000,
    waitLabels: { dependency: "等待依赖", repair: "等修复" }
  });
  assert.equal(queuePanel.rows[0].badgeKey, "waiting-dependency", "脉冲等待依赖徽标键");
  assert.equal(queuePanel.rows[0].badgeLabel, "等待依赖 one-add-x", "脉冲条目徽标文案");
  assert.equal(queuePanel.rows[0].waitingDetail, null, "正常等待无原因（零布局）");
  assert.equal(queuePanel.idle, true, "闲置态透传");
  assert.deepEqual(queuePanel.nextExecution, { proposalId: "two-add-y", buttonName: "Apply" }, "下一执行指示透传");

  /* 词典增量（zh / en 各一份，无残留重复）+ 组件与 CSS 钩子存在性。 */
  const clientSource = readFileSync(new URL("../src/client.jsx", import.meta.url), "utf8");
  for (const [key, zh, en] of [
    ["cosmos.queue.waitDep", "等待依赖", "Waiting for"],
    ["cosmos.queue.waitRepair", "等修复", "awaiting fix"],
    ["cosmos.queue.idle", "全部等待依赖", "All waiting on dependencies"],
    ["cosmos.queue.nextExecution", "下一执行", "Next"],
    ["cosmos.queue.depWarning", "依赖 {dep} 未达标，该条目将在队列中等待", "Dependency {dep} is not satisfied; this entry will wait in the queue"]
  ]) {
    assert.ok(clientSource.includes("\"" + key + "\": \"" + zh + "\""), `zh 词典增量 ${key}`);
    assert.ok(clientSource.includes("\"" + key + "\": \"" + en + "\""), `en 词典增量 ${key}`);
    assert.equal(
      clientSource.split("\"" + key + "\"").length - 1,
      3,
      `词典键 ${key} 恰为 zh + en + 一处使用（无残留重复）`
    );
  }
  assert.ok(clientSource.includes("data-cosmos-queue-idle"), "闲置态标识挂载点");
  assert.ok(clientSource.includes("data-cosmos-queue-next"), "下一执行指示挂载点");
  assert.ok(clientSource.includes("data-badge=waiting-dependency"), "等待依赖徽标样式钩子");
  assert.ok(clientSource.includes("data-cosmos-warp-wait-reason"), "曲率等待原因行挂载点");
  assert.ok(clientSource.includes("data-cosmos-queue-wait-reason"), "脉冲等待原因行挂载点");
}

console.log("dependency-gating-smoke: all assertions passed");
