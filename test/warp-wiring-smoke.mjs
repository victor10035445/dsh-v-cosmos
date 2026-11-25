/**
 * 曲率宿主接线冒烟（two-add-cosmos-proposal-warp 4.5 / spec cosmos-proposal-warp
 * 「持久化与多窗口广播」「生命周期清理与工作区守卫」「重启对账」）：
 * stub ctx 直调 apply() 真调路由 handler，覆盖：
 *  - `GET /warp` 全量快照（无 prompt 正文）、`POST /warp/attach` 错误码族（invalid /
 *    workspace-unknown / proposal-unknown / plan-empty / plan-unmatched / duplicate）；
 *  - 附着即复查（ready/grayed 入场）、暂停/继续、操作矩阵（ready 可移出、executing 锁定）；
 *  - `warp-changed` 轻帧计数；`/config` PUT 的曲率计划悬空引用拒绝；
 *  - proto 直投既有探索会话（零 create/rename，只 prompt）、完成收尾出队；
 *  - 转投脉冲队列（转投即完成：曲率条目移出、脉冲侧 queued）；
 *  - 生命周期清理：提案归档清非在途条目 / 星胚移除清目标全部条目 / 工作区不在册清队列；
 *  - 重启对账三态（launching → failed / executing 冷读收敛）。
 *
 * 运行：node test/warp-wiring-smoke.mjs
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply } from "../src/index.mjs";
import { proposalDirPath } from "../src/queue-store.mjs";
import { WARP_VERSION } from "../src/warp-store.mjs";

const cleanupDirs = [];
const tempDir = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
};
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/* ── 夹具：工作区（两个提案 + 星胚锚点） ── */
const wsRoot = tempDir("dsh-cosmos-warp-ws-");
const changesDir = join(wsRoot, "openspec", "changes");
const pendingDir = join(wsRoot, "openspec", "pending-changes");
const proposalA = join(changesDir, "add-a");
const proposalB = join(changesDir, "add-b");
mkdirSync(proposalA, { recursive: true });
mkdirSync(proposalB, { recursive: true });
mkdirSync(pendingDir, { recursive: true });
writeFileSync(join(proposalA, "tasks.md"), "- [ ] one\n- [ ] two");
writeFileSync(join(proposalA, ".state.json"), JSON.stringify({ version: 1, state: "created", setBy: "test", at: 1 }));
writeFileSync(join(proposalB, "tasks.md"), "- [ ] one");
writeFileSync(join(proposalB, ".state.json"), JSON.stringify({ version: 1, state: "created", setBy: "test", at: 2 }));
writeFileSync(join(pendingDir, "s1.json"), JSON.stringify({ name: "s1", by: "explore", at: 3, sessionId: "explorer-1" }));
writeFileSync(join(pendingDir, "s2.json"), JSON.stringify({ name: "s2", by: "explore", at: 4, sessionId: "explorer-1" }));

const workspaces = [{ id: "ws1", title: "WS One", path: wsRoot, sessionIds: [] }];

const buttonConfig = (name, extra = {}) => ({
  name,
  prompt: "执行 " + name,
  autoSend: false,
  ...(extra.preState === "proto" ? { newSession: false } : {}),
  ...extra
});
const BUTTONS = [
  buttonConfig("New", { preState: "proto" }),
  buttonConfig("Review", { preState: "created" }),
  buttonConfig("Apply", { preState: "reviewed" }),
  buttonConfig("Archive", { preState: "executed" }),
  buttonConfig("ReviewPulse", { preState: "created" })
];
const PLAN = {
  bars: [
    { name: "New" },
    { name: "Review" },
    { name: "Apply" },
    { name: "Archive" },
    { name: "ReviewPulse", rule: "queue" }
  ]
};

let handler = null;
let frames = [];
let listeners = [];

/** 记录式 sessionController 桩。 */
function makeSessionController(options = {}) {
  const calls = [];
  const record = (method, args) => calls.push({ method, args });
  let created = 0;
  return {
    calls,
    async create(...args) {
      record("create", args);
      if (options.createThrows === true) throw new Error("create boom");
      created += 1;
      return { sessionId: options.sessionId ?? "session-" + created };
    },
    async selectModel(...args) {
      record("selectModel", args);
      return { selected: true };
    },
    async rename(...args) {
      record("rename", args);
      return { title: args[0]?.title ?? "", seq: 1 };
    },
    async prompt(...args) {
      record("prompt", args);
      if (options.promptThrows === true) throw new Error("prompt boom");
      return { accepted: true };
    },
    async list(...args) {
      record("list", args);
      return options.listResult ?? { items: [] };
    }
  };
}

function makeCtx(options = {}) {
  listeners = [];
  return {
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
      register(def) {
        options.assign?.(def.handler);
        return () => {};
      }
    },
    workspaceRegistry: {
      list: () => workspaces,
      get archivedSessionIds() {
        return new Set(options.archived ?? []);
      }
    },
    agents: { get: options.agentOf ?? (() => null) },
    sessions: { get: () => null },
    sessionController: options.sessionController ?? null,
    tools: null,
    listeners
  };
}

/**
 * 启动应用实例。
 * @param {object} [options]
 */
function boot(options = {}) {
  const home = tempDir("dsh-cosmos-warp-home-");
  process.env.DSH_HOME = home;
  if (options.preload !== null && options.preload !== undefined) {
    mkdirSync(join(home, "storages"), { recursive: true });
    writeFileSync(join(home, "storages", "dsh-v-cosmos.warp.json"), JSON.stringify(options.preload, null, 2));
  }
  frames = [];
  let captured = null;
  const ctx = makeCtx({ assign: (value) => { captured = value; }, ...options });
  apply(ctx, { buttons: options.buttons ?? BUTTONS, warpPlan: options.warpPlan ?? PLAN });
  assert.ok(captured, "apply 注册了 API handler");
  handler = captured;
  return { home, ctx };
}

function captureJson() {
  const state = { status: 0, body: null, res: null };
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
}

function stubBodyReq(method, url, body) {
  const chunks = [Buffer.from(JSON.stringify(body ?? {}), "utf8")];
  return {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    }
  };
}

async function getJson(url) {
  const state = captureJson();
  await handler({ method: "GET", url }, state.res);
  return state;
}

async function postJson(path, body) {
  const state = captureJson();
  await handler(stubBodyReq("POST", "/api/dsh-v-cosmos" + path, body), state.res);
  return state;
}

async function putJson(path, body) {
  const state = captureJson();
  await handler(stubBodyReq("PUT", "/api/dsh-v-cosmos" + path, body), state.res);
  return state;
}

async function warpOfApi() {
  const state = await getJson("/api/dsh-v-cosmos/warp");
  assert.equal(state.status, 200, "GET /warp 200");
  assert.equal(state.body?.ok, true, "GET /warp ok:true");
  return state.body.warp;
}

const dataFrames = () => frames
  .map((line) => line.trim())
  .filter((line) => line.startsWith("data: "))
  .map((line) => JSON.parse(line.slice(6)));
const warpFrameCount = () => dataFrames().filter((frame) => frame.type === "warp-changed").length;

async function subscribeSse() {
  const sseRes = {
    writeHead() {},
    write(chunk) { frames.push(String(chunk)); },
    end() {},
    on() {}
  };
  await handler({ method: "GET", url: "/api/dsh-v-cosmos/events" }, sseRes);
}

/* ── 1. 路由错误码族 + 附着即复查（暂停态） ── */
{
  boot();
  await subscribeSse();
  const empty = await warpOfApi();
  assert.equal(empty.version, WARP_VERSION, "快照版本");
  assert.deepEqual(empty.warps, {}, "初始无曲率队列");

  assert.equal((await postJson("/warp/attach", {})).body.error, "invalid", "缺 wsId → invalid");
  assert.equal((await postJson("/warp/attach", { wsId: "ghost", targetKind: "proposal", targetKey: "add-a" })).body.error, "workspace/unknown", "未知工作区");
  assert.equal((await postJson("/warp/attach", { wsId: "ws1", targetKind: "bogus", targetKey: "add-a" })).body.error, "invalid", "未知目标形态");
  assert.equal((await postJson("/warp/attach", { wsId: "ws1", targetKind: "proposal", targetKey: "ghost" })).body.error, "proposal/unknown", "未知提案");

  /* 暂停后再附着：复查点亮但不点火（验证 ready/grayed 入场与快照） */
  assert.equal((await postJson("/warp/pause", { wsId: "ws1" })).body.paused, true);
  const framesBefore = warpFrameCount();
  const attached = await postJson("/warp/attach", { wsId: "ws1", targetKind: "proposal", targetKey: "add-a", targetLabel: "提案 A" });
  assert.equal(attached.status, 200, "附着 200");
  assert.equal(attached.body.ok, true);
  assert.equal(attached.body.entries.length, 4, "提案目标附着了 4 条非 proto 计划条目（Review/Apply/Archive/ReviewPulse）");
  assert.equal(attached.body.entries[0].buttonName, "Review");
  assert.equal("prompt" in attached.body.entries[0], false, "投影不含 prompt 正文");
  assert.equal(warpFrameCount() >= framesBefore + 1, true, "附着广播 warp-changed 轻帧（附着 + 复查点亮）");

  const snapshot = await warpOfApi();
  const entries = snapshot.warps.ws1.entries;
  assert.deepEqual(entries.map((entry) => entry.buttonName), ["Review", "Apply", "Archive", "ReviewPulse"], "计划顺序 = 条目顺序");
  assert.deepEqual(entries.map((entry) => entry.state), ["ready", "grayed", "grayed", "ready"], "前置门控匹配者点亮，其余置灰");
  assert.equal(entries[3].rule, "queue", "分流规则快照");
  assert.equal(snapshot.warps.ws1.paused, true);

  /* 重复附着拒绝 */
  const duplicate = await postJson("/warp/attach", { wsId: "ws1", targetKind: "proposal", targetKey: "add-a" });
  assert.equal(duplicate.status, 400);
  assert.equal(duplicate.body.error, "duplicate");
  assert.equal(duplicate.body.reason, "已托管");

  /* 继续 → 点火（会话服务缺席 → 显式 failed） */
  assert.equal((await postJson("/warp/resume", { wsId: "ws1" })).body.paused, false);
  await sleep(40);
  const afterResume = await warpOfApi();
  const failed = afterWarpEntry(afterResume, "Review");
  assert.equal(failed.state, "failed", "会话服务缺席 → 显式失败残留");
  assert.equal(failed.reason, "session-controller-unavailable");
  /* failed 残留可移出；locked executing 拒绝在下一段验证 */
  const removeFailed = await postJson("/warp/remove", { wsId: "ws1", entryId: failed.id });
  assert.equal(removeFailed.status, 200, "failed 残留可移出");
}

function afterWarpEntry(warp, buttonName) {
  for (const queue of Object.values(warp.warps)) {
    const found = queue.entries.find((entry) => entry.buttonName === buttonName);
    if (found) return found;
  }
  return null;
}

/* ── 2. plan-empty / plan-unmatched / 直投成功链 / executing 锁定 ── */
{
  boot({ warpPlan: { bars: [] } });
  assert.equal((await postJson("/warp/attach", { wsId: "ws1", targetKind: "proposal", targetKey: "add-a" })).body.error, "plan-empty", "空计划拒绝");

  boot({ buttons: [buttonConfig("Review", { preState: "created" })], warpPlan: { bars: [{ name: "Review" }] } });
  assert.equal((await postJson("/warp/attach", { wsId: "ws1", targetKind: "embryo", targetKey: "explorer-1", anchorSlugs: ["s1"] })).body.error, "plan-unmatched", "星胚目标无 proto 条目 → plan-unmatched");

  const controller = makeSessionController();
  const { ctx } = boot({ sessionController: controller });
  await subscribeSse();
  await postJson("/queue/pause", { wsId: "ws1" }); // 暂停脉冲队列：本段只验证曲率直投链
  const attached = await postJson("/warp/attach", { wsId: "ws1", targetKind: "proposal", targetKey: "add-b" });
  assert.equal(attached.status, 200);
  await sleep(40);
  const snapshot = await warpOfApi();
  const running = snapshot.warps.ws1.entries.find((entry) => entry.buttonName === "Review");
  assert.equal(running.state, "executing", "附着 → 复查 → 直投 → executing");
  assert.equal(running.sessionId, "session-1");
  assert.deepEqual(
    controller.calls.map((call) => call.method),
    ["create", "rename", "prompt"],
    "直投链 = create → rename → prompt（模型未绑定；无 selectModel）"
  );
  const promptCall = controller.calls.find((call) => call.method === "prompt");
  assert.equal(promptCall.args[0].mode, "queue", "prompt.mode = queue");
  assert.equal(promptCall.args[0].content[0].text.includes("@"), true, "提案目标消息含 @提案目录");

  /* executing 锁定：移出被拒 */
  const locked = await postJson("/warp/remove", { wsId: "ws1", entryId: running.id });
  assert.equal(locked.status, 400);
  assert.equal(locked.body.error, "locked", "executing 条目锁定");

  /* 事件面完成 → 出队 + 接力（先把提案写为 reviewed，门控才会放行 Apply） */
  writeFileSync(join(proposalB, ".state.json"), JSON.stringify({ version: 1, state: "reviewed", setBy: "test", at: 2 }));
  const status = ctx.listeners.find((record) => record.event === "agent/status");
  assert.ok(status, "agent/status 监听已挂");
  status.listener({ agent: { id: "session-1" }, status: "running" });
  status.listener({ agent: { id: "session-1" }, status: "idle" });
  await sleep(30);
  const afterComplete = await warpOfApi();
  const nextEntry = afterWarpEntry(afterComplete, "Apply");
  assert.ok(nextEntry, "Review 出队后 Apply 接力点亮/点火");
  assert.notEqual(nextEntry.state, "grayed", "Apply 不再置灰");
}

/* ── 3. proto 直投（零 create / 零 rename；安静门） ── */
{
  const controller = makeSessionController();
  const { ctx } = boot({ sessionController: controller });
  await subscribeSse();
  const attached = await postJson("/warp/attach", {
    wsId: "ws1",
    targetKind: "embryo",
    targetKey: "explorer-1",
    targetLabel: "s1/s2",
    anchorSlugs: ["s1", "s2"],
    explorerSessionId: "explorer-1"
  });
  assert.equal(attached.status, 200, "星胚附着 200");
  assert.equal(attached.body.entries.length, 1, "星胚目标仅附着 proto 条目");
  assert.deepEqual(attached.body.entries[0].anchorSlugs, ["s1", "s2"], "锚点 slug 快照");
  await sleep(40);
  const snapshot = await warpOfApi();
  const proto = snapshot.warps.ws1.entries[0];
  assert.equal(proto.state, "executing", "proto 直投 → executing");
  assert.equal(proto.sessionId, "explorer-1", "sessionId = 既有探索会话");
  assert.deepEqual(controller.calls.map((call) => call.method), ["prompt"], "proto 只 prompt（零 create/rename）");
  const message = controller.calls[0].args[0].content[0].text;
  assert.equal(message.includes("@"), false, "星胚消息无 @引用");
  assert.equal(message.includes("s1") && message.includes("s2"), true, "多 slug 附清单");

  /* 完成收尾：proto 出队（未点燃 slug → 不展开） */
  const status = ctx.listeners.find((record) => record.event === "agent/status");
  status.listener({ agent: { id: "explorer-1" }, status: "running" });
  /* 停机原因主信号（真实宿主次序：turn/end 先于 idle） */
  const turnEnd = ctx.listeners.find((record) => record.event === "session/event");
  assert.ok(turnEnd, "session/event 监听已挂");
  turnEnd.listener({ id: "explorer-1" }, { type: "turn/end", data: { reason: { kind: "completed" } } });
  status.listener({ agent: { id: "explorer-1" }, status: "idle" });
  await sleep(20);
  const after = await warpOfApi();
  assert.deepEqual(after.warps.ws1?.entries ?? [], [], "proto 完成后出队且未展开任何条目");
}

/* ── 4. 转投脉冲队列（转投即完成） ── */
{
  boot();
  /* 暂停脉冲队列，避免转投后立即被脉冲调度器消费 */
  await postJson("/queue/pause", { wsId: "ws1" });
  const attached = await postJson("/warp/attach", { wsId: "ws1", targetKind: "proposal", targetKey: "add-a" });
  assert.equal(attached.status, 200);
  await sleep(40);
  const warp = await warpOfApi();
  const entries = warp.warps.ws1.entries;
  assert.equal(entries.some((entry) => entry.buttonName === "ReviewPulse"), false, "转投条目已移出曲率队列（转投即完成）");
  const pulse = (await getJson("/api/dsh-v-cosmos/queue")).body.queue;
  const queued = pulse.queues.ws1.entries.find((entry) => entry.buttonName === "ReviewPulse");
  assert.ok(queued, "脉冲队列出现转投条目");
  assert.equal(queued.state, "queued", "转投条目以普通快照条目落队尾");
}

/* ── 4b. 触发沿（index 级）：手动关联会话收尾 → 下降沿复查；状态翻转不触发 ── */
{
  const { ctx } = boot({ warpPlan: { bars: [{ name: "Review" }, { name: "Apply" }] } });
  await postJson("/warp/pause", { wsId: "ws1" });
  await postJson("/warp/attach", { wsId: "ws1", targetKind: "proposal", targetKey: "add-a" });
  let snapshot = await warpOfApi();
  assert.deepEqual(snapshot.warps.ws1.entries.map((entry) => entry.state), ["ready", "grayed"], "Review 点亮、Apply 置灰");

  /* 手动会话显式绑定到提案（等价用户手动点动作条产出的会话）。 */
  workspaces[0].sessionIds.push("manual-1");
  const bind = await postJson("/bind-session", { sessionId: "manual-1", proposals: ["add-a"] });
  assert.equal(bind.body.ok, true, "手动会话关联绑定成功");
  const status = ctx.listeners.find((record) => record.event === "agent/status");
  status.listener({ agent: { id: "manual-1" }, status: "running" });

  /* 提案状态翻转（无触发沿）→ Apply 仍置灰。 */
  writeFileSync(join(proposalA, ".state.json"), JSON.stringify({ version: 1, state: "reviewed", setBy: "test", at: 3 }));
  snapshot = await warpOfApi();
  assert.equal(afterWarpEntry(snapshot, "Apply").state, "grayed", "状态翻转本身不触发复查（红线）");

  /* 手动任务完整结束 → 活动计数下降沿 → 复查点亮 Apply（暂停只挡点火）。 */
  status.listener({ agent: { id: "manual-1" }, status: "idle" });
  await sleep(20);
  snapshot = await warpOfApi();
  assert.equal(afterWarpEntry(snapshot, "Apply").state, "ready", "关联会话收尾触发复查（手动推进不卡死）");

  /* 清场：恢复提案状态与工作区会话表。 */
  writeFileSync(join(proposalA, ".state.json"), JSON.stringify({ version: 1, state: "created", setBy: "test", at: 1 }));
  workspaces[0].sessionIds.length = 0;
}

/* ── 4c. 附着时已点燃 slug 即展开（不等 proto 跑完） ── */
{
  const ignitedDir = join(changesDir, "ig");
  mkdirSync(ignitedDir, { recursive: true });
  writeFileSync(join(ignitedDir, "tasks.md"), "- [ ] one");
  writeFileSync(join(ignitedDir, ".state.json"), JSON.stringify({ version: 1, state: "created", setBy: "test", at: 5 }));
  writeFileSync(join(pendingDir, "ig.json"), JSON.stringify({ name: "ig", by: "explore", at: 5, sessionId: "explorer-2" }));
  boot({ warpPlan: { bars: [{ name: "New" }, { name: "Review" }] } });
  await postJson("/warp/pause", { wsId: "ws1" });
  const attached = await postJson("/warp/attach", {
    wsId: "ws1",
    targetKind: "embryo",
    targetKey: "explorer-2",
    anchorSlugs: ["ig"],
    explorerSessionId: "explorer-2"
  });
  assert.equal(attached.status, 200);
  assert.deepEqual(attached.body.expanded, ["ig"], "附着响应声明已展开目标");
  const snapshot = await warpOfApi();
  const targets = new Set(snapshot.warps.ws1.entries.map((entry) => entry.targetKey));
  assert.equal(targets.has("explorer-2"), true, "proto 条目附着到星胚目标");
  assert.equal(targets.has("ig"), true, "已点燃 slug 立即展开（非 proto 条目附着）");
  assert.equal(snapshot.warps.ws1.entries.filter((entry) => entry.targetKey === "ig")[0].state, "ready", "展开后立即复查点亮");
  rmSync(ignitedDir, { recursive: true, force: true });
  rmSync(join(pendingDir, "ig.json"), { force: true });
}

/* ── 5. 曲率计划保存悬空引用拒绝（/config PUT） ── */
{
  boot();
  await sleep(30); // 等 ensureSeeded 完成（revision 1）
  const baseRevision = (await getJson("/api/dsh-v-cosmos/config")).body.revision;
  const bad = await putJson("/config", {
    baseRevision,
    sections: { warpPlan: { bars: [{ name: "Ghost" }] } }
  });
  assert.equal(bad.status, 400, "悬空引用保存拒绝");
  assert.equal(bad.body.error, "invalid");
  assert.ok(String(bad.body.reason).includes("不存在"), "拒绝原因指出动作条不存在");
  const good = await putJson("/config", {
    baseRevision,
    sections: { warpPlan: { bars: [{ name: "Review" }, { name: "Apply", rule: "queue" }] } }
  });
  assert.equal(good.status, 200, "合法计划保存成功");
  assert.equal(good.body.revision, baseRevision + 1);
  const config = (await getJson("/api/dsh-v-cosmos/config")).body;
  assert.deepEqual(config.value.warpPlan, { bars: [{ name: "Review" }, { name: "Apply", rule: "queue" }] }, "生效计划最小形");
}

/* ── 6. 星胚移除清理（/dismiss-embryo → 目标全部条目） ── */
{
  boot();
  await postJson("/warp/pause", { wsId: "ws1" });
  const attached = await postJson("/warp/attach", {
    wsId: "ws1",
    targetKind: "embryo",
    targetKey: "explorer-1",
    anchorSlugs: ["s1", "s2"],
    explorerSessionId: "explorer-1"
  });
  assert.equal(attached.status, 200);
  const dismissed = await postJson("/dismiss-embryo", { workspaceId: "ws1", slug: "s2" });
  assert.equal(dismissed.body.outcome, "deleted");
  const warp = await warpOfApi();
  assert.deepEqual(warp.warps.ws1?.entries ?? [], [], "星胚移除 → 该目标全部曲率条目清理");
  /* 清场：恢复锚点供其他段落使用 */
  writeFileSync(join(pendingDir, "s2.json"), JSON.stringify({ name: "s2", by: "explore", at: 4, sessionId: "explorer-1" }));
}

/* ── 7. 重启对账三态 + 工作区不在册清理 ── */
{
  const launching = {
    id: "w-launch",
    wsId: "ws1",
    targetKey: "add-a",
    targetKind: "proposal",
    targetLabel: "add-a",
    proposalDir: proposalDirPath(wsRoot, "add-a"),
    button: { name: "Review", prompt: "执行 Review", preState: "created" },
    rule: "direct",
    state: "launching",
    enqueuedAt: 1,
    stateAt: 1
  };
  const executing = {
    ...launching,
    id: "w-exec",
    state: "executing",
    sessionId: "session-idle",
    startedAt: 1
  };
  const controller = makeSessionController({ listResult: { items: [{ sessionId: "session-idle", running: false }] } });
  boot({
    sessionController: controller,
    preload: { version: WARP_VERSION, warps: { ws1: { paused: false, pausedAt: 0, entries: [launching, executing] } } }
  });
  await sleep(60);
  const warp = await warpOfApi();
  const entries = warp.warps.ws1?.entries ?? [];
  assert.equal(entries.find((entry) => entry.id === "w-launch").state, "failed", "launching → failed(restart-lost-launch)");
  assert.equal(entries.find((entry) => entry.id === "w-launch").reason, "restart-lost-launch");
  assert.equal(entries.some((entry) => entry.id === "w-exec"), false, "executing 冷读终态 → 完成收敛出队");

  /* 工作区不在册 → 清空该星座曲率队列 */
  workspaces.length = 0;
  const after = await warpOfApi();
  assert.deepEqual(after.warps, {}, "工作区不在册 → 清空曲率队列");
  workspaces.push({ id: "ws1", title: "WS One", path: wsRoot, sessionIds: [] });
}

/* ── 8. 提案归档清理（fs.watch → 扫描 → 清非在途条目） ── */
{
  boot();
  await postJson("/warp/pause", { wsId: "ws1" });
  await postJson("/warp/attach", { wsId: "ws1", targetKind: "proposal", targetKey: "add-a" });
  assert.equal((await warpOfApi()).warps.ws1.entries.length > 0, true, "归档前条目在册");
  await getJson("/api/dsh-v-cosmos/scene"); // 建立 fs.watch（首次扫描）
  rmSync(proposalA, { recursive: true, force: true });
  await sleep(2600); // 扫描防抖（SCAN_DEBOUNCE_MS = 2000）
  const warp = await warpOfApi();
  assert.equal((warp.warps.ws1?.entries ?? []).some((entry) => entry.targetKey === "add-a"), false, "提案归档 → 清非在途曲率条目");
  assert.equal(existsSync(proposalA), false, "提案目录已删除（夹具自检）");
}

/* ── 收尾：注销工作区并拉一次 scene 摘除 fs.watch ── */
workspaces.length = 0;
await getJson("/api/dsh-v-cosmos/scene");

for (const dir of cleanupDirs) rmSync(dir, { recursive: true, force: true });
assert.equal(existsSync(wsRoot), false, "临时工作区已清理");
console.log("warp-wiring-smoke: all assertions passed");
