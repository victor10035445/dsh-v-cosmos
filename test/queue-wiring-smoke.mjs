/**
 * 队列宿主接线冒烟（add-cosmos-action-queue 4.2 / swap-cosmos-queue-native-executor 2.2）：
 * stub ctx 直调 apply() 真调路由 handler，覆盖队列 API 语义 / 广播 / 持久化 / 操作矩阵拒绝 /
 * 进程内会话服务缺席的显式失败 / 会话服务桩的直投路由（成功链、失败显式化、冷读对账）/
 * 宿主 agent 事件面接线。
 * 运行：node test/queue-wiring-smoke.mjs
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply } from "../src/index.mjs";
import { proposalDirOf } from "../src/panel.mjs";
import { proposalDirPath, QUEUE_VERSION } from "../src/queue-store.mjs";
import { deliverPayloadOf, queueTitleOf } from "../src/session-executor.mjs";

const cleanupDirs = [];
const tempDir = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
};

/* ── 夹具：工作区（openspec/changes/add-a）+ 按钮配置 ── */
const wsRoot = tempDir("dsh-cosmos-queue-ws-");
const changesDir = join(wsRoot, "openspec", "changes");
const proposalDir = join(changesDir, "add-a");
mkdirSync(proposalDir, { recursive: true });
writeFileSync(join(proposalDir, "tasks.md"), "- [ ] one\n- [ ] two");
writeFileSync(join(proposalDir, ".state.json"), JSON.stringify({ version: 1, state: "created", setBy: "test", at: 1 }));

const workspaces = [{ id: "ws1", title: "WS One", path: wsRoot, sessionIds: [] }];

const buttonConfig = (name, extra = {}) => ({ name, prompt: "执行 " + name, autoSend: false, ...extra });

let handler = null;
let frames = [];

/**
 * 记录式 sessionController 桩（stub 直调：请求对象即请求体、返回值即结果）。
 * @param {{sessionId?: string, createThrows?: boolean, promptThrows?: boolean,
 *          listThrows?: boolean, listResult?: object}} [options]
 */
function makeSessionController(options = {}) {
  const calls = [];
  const record = (method, args) => calls.push({ method, args });
  return {
    calls,
    async create(...args) {
      record("create", args);
      if (options.createThrows === true) throw new Error("create boom");
      return { sessionId: options.sessionId ?? "session-new" };
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
      if (options.listThrows === true) throw new Error("list boom");
      return options.listResult ?? { items: [] };
    }
  };
}

/** stub ctx（webServer 捕获 handler；on 记录监听器）。 */
function makeCtx(options = {}) {
  const listeners = [];
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
 * 启动一个独立 home 的应用实例。
 * @param {{buttons?: object[], preload?: object|null, archived?: string[],
 *          sessionController?: object|null, agentOf?: Function|null}} [options]
 */
function boot({
  buttons = [buttonConfig("B1"), buttonConfig("B2"), buttonConfig("B3")],
  preload = null,
  archived = [],
  sessionController = null,
  agentOf = null
} = {}) {
  const home = tempDir("dsh-cosmos-queue-home-");
  process.env.DSH_HOME = home;
  if (preload !== null) {
    mkdirSync(join(home, "storages"), { recursive: true });
    writeFileSync(join(home, "storages", "dsh-v-cosmos.queues.json"), JSON.stringify(preload, null, 2));
  }
  frames = [];
  let captured = null;
  const ctx = makeCtx({ assign: (value) => { captured = value; }, archived, sessionController, agentOf });
  apply(ctx, { buttons });
  assert.ok(captured, "apply 注册了 API handler");
  handler = captured;
  return { home, ctx };
}

/* ── 请求桩 ── */
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

async function queueOfQueueApi() {
  const state = await getJson("/api/dsh-v-cosmos/queue");
  assert.equal(state.status, 200, "GET /queue 200");
  assert.equal(state.body?.ok, true, "GET /queue ok:true");
  return state.body.queue;
}

const dataFrames = () => frames
  .map((line) => line.trim())
  .filter((line) => line.startsWith("data: "))
  .map((line) => JSON.parse(line.slice(6)));
const queueFrameCount = () => dataFrames().filter((frame) => frame.type === "queue-changed").length;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/* ── 1. 基础路由与入队复验链 ── */
{
  boot();
  /* SSE 订阅（后续帧计数） */
  const sseRes = {
    writeHead() {},
    write(chunk) { frames.push(String(chunk)); },
    end() {},
    on() {}
  };
  await handler({ method: "GET", url: "/api/dsh-v-cosmos/events" }, sseRes);

  const empty = await queueOfQueueApi();
  assert.equal(empty.version, QUEUE_VERSION, "快照版本");
  assert.deepEqual(empty.queues, {}, "初始无队列");
  assert.equal(typeof empty.revisedAt, "number", "快照带 revisedAt");

  /* 先暂停：本段验证「入队落库/去重/复验」的纯路由语义，避免入队即启动
     （那是第 2 段的显式失败面）。 */
  assert.equal((await postJson("/queue/pause", { wsId: "ws1" })).body.paused, true, "暂停队列入队前置");

  assert.equal((await postJson("/queue/enqueue", {})).body.error, "invalid", "缺 wsId → 400 invalid");
  assert.equal((await postJson("/queue/enqueue", { wsId: "ghost", proposalId: "add-a", buttonName: "B1" })).body.error, "workspace/unknown", "未知工作区");
  assert.equal((await postJson("/queue/enqueue", { wsId: "ws1", proposalId: "ghost", buttonName: "B1" })).body.error, "proposal/unknown", "未知提案");
  assert.equal((await postJson("/queue/enqueue", { wsId: "ws1", proposalId: "add-a", buttonName: "ghost" })).body.error, "button/unknown", "未知按钮");

  const framesBefore = queueFrameCount();
  const ok = await postJson("/queue/enqueue", { wsId: "ws1", proposalId: "add-a", buttonName: "B1" });
  assert.equal(ok.status, 200, "入队 200");
  assert.equal(ok.body.ok, true, "入队 ok:true");
  assert.equal(ok.body.entry.buttonName, "B1", "条目投影带按钮名");
  assert.equal(ok.body.entry.state, "queued", "入队即 queued");
  assert.equal(ok.body.entry.autoSend, true, "投影标注恒自动发送");
  assert.equal("prompt" in ok.body.entry, false, "投影不含 prompt 正文");
  assert.equal(queueFrameCount(), framesBefore + 1, "入队广播一次 queue-changed（暂停态无后续推进帧）");

  const snapshot = await queueOfQueueApi();
  assert.equal(snapshot.queues.ws1.entries.length, 1, "快照含条目");
  assert.equal(snapshot.queues.ws1.entries[0].state, "queued", "暂停态条目保持 queued");
  assert.equal(snapshot.queues.ws1.counts.active, 1, "计数含在途");

  /* 持久化：队列文件落盘（原子写） */
  const stored = JSON.parse(readFileSync(join(process.env.DSH_HOME, "storages", "dsh-v-cosmos.queues.json"), "utf8"));
  assert.equal(stored.version, QUEUE_VERSION, "落盘版本");
  assert.equal(stored.queues.ws1.entries[0].button.name, "B1", "落盘条目快照");
  assert.equal(stored.queues.ws1.entries[0].button.prompt, "执行 B1", "落盘 prompt 快照");

  /* 重复入队：同一（ws, proposal, button）queued → 400 duplicate */
  const duplicate = await postJson("/queue/enqueue", { wsId: "ws1", proposalId: "add-a", buttonName: "B1" });
  assert.equal(duplicate.status, 400, "重复入队 400");
  assert.equal(duplicate.body.error, "duplicate", "重复入队 error=duplicate");

  /* 前置状态门控：preState=reviewed 但提案 created → 400 gate */
  boot({ buttons: [buttonConfig("GATED", { preState: "reviewed" })] });
  const gated = await postJson("/queue/enqueue", { wsId: "ws1", proposalId: "add-a", buttonName: "GATED" });
  assert.equal(gated.status, 400, "复验不过 400");
  assert.equal(gated.body.error, "gate", "复验不过 error=gate");
  const gatedSnapshot = await queueOfQueueApi();
  assert.deepEqual(gatedSnapshot.queues, {}, "复验不过零条目");
}

/* ── 2. 预载现场：操作矩阵 / 上限 / 暂停 / clear / 会话服务缺席显式失败 ── */
{
  const preloaded = (paused, entries) => ({
    version: QUEUE_VERSION,
    queues: {
      ws1: { paused, pausedAt: paused ? 1 : 0, entries }
    }
  });
  const entryOf = (index, state = "queued", extra = {}) => ({
    id: `q-${index}`,
    wsId: "ws1",
    proposalId: "add-a",
    proposalDir: proposalDirPath(wsRoot, "add-a"),
    button: { name: `P${index}`, prompt: "p" + index },
    enqueuedAt: 1,
    state,
    stateAt: 1,
    ...extra
  });
  /* 32 条 queued + 暂停（避免启动推进干扰上限断言） */
  const thirtyTwo = Array.from({ length: 32 }, (_, index) => entryOf(index + 1));
  boot({ preload: preloaded(true, thirtyTwo) });

  const pausedSnapshot = await queueOfQueueApi();
  assert.equal(pausedSnapshot.queues.ws1.paused, true, "预载暂停态");
  assert.equal(pausedSnapshot.queues.ws1.counts.queued, 32, "预载 32 条");
  assert.equal(pausedSnapshot.queues.ws1.counts.active, 32, "在途计数 = 32");

  const limit = await postJson("/queue/enqueue", { wsId: "ws1", proposalId: "add-a", buttonName: "B1" });
  assert.equal(limit.status, 400, "超上限 400");
  assert.equal(limit.body.error, "limit", "超上限 error=limit");

  /* 排序：队首上移拒绝（boundary）、末位下移拒绝；相邻移动成功 */
  assert.equal((await postJson("/queue/reorder", { wsId: "ws1", entryId: "q-1", direction: "up" })).body.error, "boundary", "队首上移 boundary");
  assert.equal((await postJson("/queue/reorder", { wsId: "ws1", entryId: "q-32", direction: "down" })).body.error, "boundary", "队尾下移 boundary");
  const moved = await postJson("/queue/reorder", { wsId: "ws1", entryId: "q-2", direction: "up" });
  assert.equal(moved.status, 200, "queued 相邻移动成功");
  const order = (await queueOfQueueApi()).queues.ws1.entries.slice(0, 3).map((entry) => entry.id);
  assert.deepEqual(order, ["q-2", "q-1", "q-3"], "移动后顺序生效");

  /* 暂停幂等 + 恢复 */
  assert.equal((await postJson("/queue/pause", { wsId: "ws1" })).body.paused, true, "重复暂停仍 true（幂等）");
  const resumed = await postJson("/queue/resume", { wsId: "ws1" });
  assert.equal(resumed.status, 200, "恢复 200");
  assert.equal(resumed.body.paused, false, "恢复后 paused=false");

  /* 恢复后调度器立即推进一步：会话服务缺席 → 显式 failed + 队列暂停（不静默降级） */
  await sleep(30);
  const afterKick = await queueOfQueueApi();
  assert.equal(afterKick.queues.ws1.paused, true, "会话服务缺席 → 队列暂停");
  const failed = afterKick.queues.ws1.entries.find((entry) => entry.state === "failed");
  assert.ok(failed, "首条落 failed（可见可处理）");
  assert.equal(failed.reason, "session-controller-unavailable", "失败原因 = 会话服务不可用");
  assert.equal(failed.message.includes("sessionController"), true, "失败说明点出会话服务");

  /* failed 残留可移出（不锁） */
  const removeFailed = await postJson("/queue/remove", { wsId: "ws1", entryId: failed.id });
  assert.equal(removeFailed.status, 200, "failed 残留可移出");

  /* clear：移除 queued 与终态残留，成功返回计数 */
  const cleared = await postJson("/queue/clear", { wsId: "ws1" });
  assert.equal(cleared.status, 200, "清空 200");
  assert.equal(cleared.body.removed >= 30, true, "清空移除全部 queued 残留");
  const afterClear = await queueOfQueueApi();
  assert.deepEqual(afterClear.queues.ws1.entries, [], "清空后无条目");
}

/* ── 3. 执行中条目完全锁定（预载 executing；冷读失败保持 executing） ── */
{
  const executing = {
    id: "q-run",
    wsId: "ws1",
    proposalId: "add-a",
    proposalDir: proposalDirPath(wsRoot, "add-a"),
    button: { name: "RUN", prompt: "run" },
    enqueuedAt: 1,
    state: "executing",
    stateAt: 1,
    sessionId: "session-x",
    startedAt: 1
  };
  const queued = {
    id: "q-wait",
    wsId: "ws1",
    proposalId: "add-a",
    proposalDir: proposalDirPath(wsRoot, "add-a"),
    button: { name: "WAIT", prompt: "wait" },
    enqueuedAt: 1,
    state: "queued",
    stateAt: 1
  };
  /* 会话服务缺席 → 冷读不可用（瞬时失败，调度器保持 executing 并重试）。 */
  boot({ preload: { version: QUEUE_VERSION, queues: { ws1: { paused: false, pausedAt: 0, entries: [executing, queued] } } } });
  await sleep(40);
  assert.equal((await postJson("/queue/remove", { wsId: "ws1", entryId: "q-run" })).body.error, "locked", "executing 移出锁定");
  assert.equal((await postJson("/queue/reorder", { wsId: "ws1", entryId: "q-wait", direction: "up" })).body.error, "neighbor-locked", "邻位 executing → 排序拒绝");
  assert.equal((await postJson("/queue/clear", { wsId: "ws1" })).body.removed, 1, "清空只移除 queued（executing 保留）");
  const snapshot = await queueOfQueueApi();
  assert.deepEqual(snapshot.queues.ws1.entries.map((entry) => entry.id), ["q-run"], "executing 条目保留");
  assert.equal(snapshot.queues.ws1.entries[0].state, "executing", "冷读不可用 → 保持 executing（不误判）");

  /* 归档会话 → 重启对账 failed（不暂停，继续下一条） */
  boot({
    archived: ["session-x"],
    preload: { version: QUEUE_VERSION, queues: { ws1: { paused: false, pausedAt: 0, entries: [executing] } } }
  });
  await sleep(20);
  const afterArchive = await queueOfQueueApi();
  assert.equal(afterArchive.queues.ws1.entries[0].state, "failed", "归档会话 → failed");
  assert.equal(afterArchive.queues.ws1.entries[0].reason, "session-gone", "归档原因");
  assert.equal(afterArchive.queues.ws1.paused, false, "重启对账不自动暂停");
}

/* ── 4. 进程内直投路由：入队 → 恢复 → 投递成功 → 事件面完成出队 ── */
{
  const controller = makeSessionController({ sessionId: "session-new" });
  const { ctx } = boot({
    sessionController: controller,
    buttons: [buttonConfig("B1", { model: { provider: "deepseek", model: "deepseek-chat" } })]
  });
  assert.equal((await postJson("/queue/pause", { wsId: "ws1" })).body.paused, true, "暂停入队前置");
  const enqueued = await postJson("/queue/enqueue", { wsId: "ws1", proposalId: "add-a", buttonName: "B1" });
  assert.equal(enqueued.status, 200, "入队 200");
  assert.equal(controller.calls.length, 0, "暂停态零投递");
  const resumed = await postJson("/queue/resume", { wsId: "ws1" });
  assert.equal(resumed.status, 200, "恢复 200");
  await sleep(30);

  const snapshot = await queueOfQueueApi();
  const running = snapshot.queues.ws1.entries[0];
  assert.equal(running.state, "executing", "恢复后直投 → executing");
  assert.equal(running.sessionId, "session-new", "条目回填 sessionId");
  assert.deepEqual(
    controller.calls.map((call) => call.method),
    ["create", "selectModel", "rename", "prompt"],
    "投递链 = create → selectModel → rename → prompt（单链路）"
  );
  assert.deepEqual(controller.calls[0].args, [{ workspaceId: "ws1" }], "create 入参 {workspaceId}");
  assert.deepEqual(
    controller.calls[1].args,
    [{ sessionId: "session-new", provider: "deepseek", model: "deepseek-chat" }],
    "selectModel 入参 = sessionId + 按钮快照模型"
  );
  assert.deepEqual(
    controller.calls[2].args,
    [{ sessionId: "session-new", title: "队列·B1·add-a" }],
    "rename 入参 = 队列·按钮·提案"
  );
  const promptArgs = controller.calls[3].args;
  assert.equal(promptArgs.length, 2, "prompt 双参签名");
  assert.equal(promptArgs[0].mode, "queue", "prompt.mode = queue（直投首条消息）");
  assert.equal(promptArgs[0].sessionId, "session-new", "prompt.sessionId");
  assert.deepEqual(
    promptArgs[0].content,
    [{ type: "text", text: "@" + proposalDirPath(wsRoot, "add-a") + "\n执行 B1" }],
    "prompt.content = @提案目录 + prompt"
  );
  assert.equal(promptArgs[1]?.aborted, false, "prompt 第二参为永不中止的 signal");

  /* 完成判定：running → idle（宿主 agent 事件面，无页面也照常推进） */
  const statusListener = ctx.listeners.find((record) => record.event === "agent/status");
  assert.ok(statusListener, "agent/status 监听已挂");
  statusListener.listener({ agent: { id: "session-new" }, status: "running" });
  statusListener.listener({ agent: { id: "session-new" }, status: "idle" });
  await sleep(20);
  const afterEvents = await queueOfQueueApi();
  assert.equal(afterEvents.queues.ws1.entries.length, 0, "回合跑完 → 完成出队");
  assert.equal(afterEvents.queues.ws1.paused, false, "正常完成不暂停");
}

/* ── 4.5 投递失败显式化：create 抛错 → failed + 队列暂停 ── */
{
  const controller = makeSessionController({ createThrows: true });
  boot({ sessionController: controller });
  assert.equal((await postJson("/queue/pause", { wsId: "ws1" })).body.paused, true, "暂停入队前置");
  assert.equal((await postJson("/queue/enqueue", { wsId: "ws1", proposalId: "add-a", buttonName: "B1" })).status, 200, "入队 200");
  assert.equal((await postJson("/queue/resume", { wsId: "ws1" })).status, 200, "恢复 200");
  await sleep(30);
  const snapshot = await queueOfQueueApi();
  assert.equal(snapshot.queues.ws1.paused, true, "投递失败 → 队列暂停");
  const failed = snapshot.queues.ws1.entries.find((entry) => entry.state === "failed");
  assert.ok(failed, "条目落 failed（可见可处理）");
  assert.equal(failed.reason, "create-failed", "失败原因 = create-failed");
  assert.equal(failed.message, "create boom", "宿主错误说明透出");
  assert.equal(controller.calls.length, 1, "create 失败即止（不继续投递）");
}

/* ── 4.6 冷读对账：list 摘要终态收敛出队 / 未命中 session-gone ── */
{
  const executing = {
    id: "q-cold",
    wsId: "ws1",
    proposalId: "add-a",
    proposalDir: proposalDirPath(wsRoot, "add-a"),
    button: { name: "COLD", prompt: "cold" },
    enqueuedAt: 1,
    state: "executing",
    stateAt: 1,
    sessionId: "s-cold",
    startedAt: 1
  };
  const done = makeSessionController({ listResult: { items: [{ sessionId: "s-cold", running: false }] } });
  boot({
    sessionController: done,
    preload: { version: QUEUE_VERSION, queues: { ws1: { paused: false, pausedAt: 0, entries: [executing] } } }
  });
  await sleep(40);
  const reconciled = await queueOfQueueApi();
  assert.deepEqual(reconciled.queues.ws1.entries, [], "冷读终态 → 完成收敛出队");
  assert.equal(done.calls.some((call) => call.method === "list"), true, "冷读走 list 摘要");

  const missing = makeSessionController({ listResult: { items: [] } });
  boot({
    sessionController: missing,
    preload: { version: QUEUE_VERSION, queues: { ws1: { paused: false, pausedAt: 0, entries: [executing] } } }
  });
  await sleep(40);
  const goneSnapshot = await queueOfQueueApi();
  assert.equal(goneSnapshot.queues.ws1.entries[0].state, "failed", "会话未命中 → failed");
  assert.equal(goneSnapshot.queues.ws1.entries[0].reason, "session-gone", "未命中原因 = session-gone");
  assert.equal(goneSnapshot.queues.ws1.paused, false, "会话消失不自动暂停");

  /* 活体优先：agents.get 有 status → 不扫 list。 */
  const live = makeSessionController({ listResult: { items: [{ sessionId: "s-cold", running: false }] } });
  boot({
    sessionController: live,
    agentOf: (id) => (id === "s-cold" ? { status: "idle" } : null),
    preload: { version: QUEUE_VERSION, queues: { ws1: { paused: false, pausedAt: 0, entries: [executing] } } }
  });
  await sleep(40);
  const liveSnapshot = await queueOfQueueApi();
  assert.deepEqual(liveSnapshot.queues.ws1.entries, [], "活体 idle → 视为已跑完（完成出队）");
  assert.equal(live.calls.some((call) => call.method === "list"), false, "活体优先 → 零 list 请求");
}

/* ── 5. 宿主 agent 事件面接线：交互瀑布 prepend 观测（挂起不完成） ── */
{
  const running = {
    id: "q-live",
    wsId: "ws1",
    proposalId: "add-a",
    proposalDir: proposalDirPath(wsRoot, "add-a"),
    button: { name: "LIVE", prompt: "live" },
    enqueuedAt: 1,
    state: "executing",
    stateAt: 1,
    sessionId: "session-live",
    startedAt: 1
  };
  const { ctx } = boot({
    preload: { version: QUEUE_VERSION, queues: { ws1: { paused: false, pausedAt: 0, entries: [running] } } }
  });
  await sleep(40);
  const statusListener = ctx.listeners.find((record) => record.event === "agent/status");
  assert.ok(statusListener, "agent/status 监听已挂");
  const approvalListener = ctx.listeners.find((record) => record.event === "approval/request");
  const questionsListener = ctx.listeners.find((record) => record.event === "user-questions/request");
  assert.ok(approvalListener, "approval/request 瀑布监听已挂");
  assert.ok(questionsListener, "user-questions/request 瀑布监听已挂");
  assert.equal(approvalListener.listenerOptions?.prepend, true, "审批瀑布 prepend 观测（浏览器常开也不漏）");
  assert.equal(questionsListener.listenerOptions?.prepend, true, "问答瀑布 prepend 观测");

  /* 交互进入 → 等待决策子态（挂起不完成）；观察者恒 next() 透传 */
  let downstreamCalls = 0;
  let releaseHold = null;
  const hold = new Promise((resolve) => { releaseHold = resolve; });
  void approvalListener.listener(
    { agent: { id: "session-live", session: { header: { id: "session-live" } } } },
    () => {
      downstreamCalls += 1;
      return hold;
    }
  );
  statusListener.listener({ agent: { id: "session-live" }, status: "running" });
  statusListener.listener({ agent: { id: "session-live" }, status: "idle" });
  assert.equal(downstreamCalls, 1, "观察者恒 next() 透传整条瀑布链");
  const waitingSnapshot = await queueOfQueueApi();
  assert.equal(waitingSnapshot.queues.ws1.entries[0].subState, "waiting", "交互存续 → 等待决策子态（不完成）");

  /* 决策：交互退出时回合已恢复（running）→ 不完成；回合跑完 idle → 完成出队 */
  statusListener.listener({ agent: { id: "session-live" }, status: "running" });
  releaseHold();
  await sleep(5);
  const afterDecision = await queueOfQueueApi();
  assert.equal(afterDecision.queues.ws1.entries.length, 1, "决策后回合未跑完 → 仍在队列");
  statusListener.listener({ agent: { id: "session-live" }, status: "idle" });
  await sleep(20);
  const afterEvents = await queueOfQueueApi();
  assert.equal(afterEvents.queues.ws1.entries.length, 0, "事件面判定完成 → 出队（无页面也照常推进）");
}

/* ── 6. 纯逻辑口径对齐：路径 / 标题 / payload（与动作条共享） ── */
{
  const dir = proposalDirPath(wsRoot, "add-a");
  assert.equal(dir, proposalDirOf(wsRoot, "add-a"), "服务端路径口径与 panel.proposalDirOf 逐字一致");
  const built = deliverPayloadOf({
    wsId: "ws1",
    proposalId: "add-a",
    proposalDir: dir,
    button: { name: "B1", prompt: "执行", prepend: false }
  });
  assert.equal(built.payload.title, "队列·B1·add-a", "标题 = 队列·按钮名·提案名");
  assert.equal(built.payload.text, "@" + dir + "\n执行", "消息 = @提案目录 + prompt");
  assert.equal(Array.from(queueTitleOf({ proposalId: "x", button: { name: "y".repeat(500) } })).length, 400, "标题按码点截断 400");
}

/* ── 收尾：注销工作区并拉一次 scene 摘除 fs.watch（Windows 删除监视目录安全） ── */
workspaces.length = 0;
await getJson("/api/dsh-v-cosmos/scene");

for (const dir of cleanupDirs) rmSync(dir, { recursive: true, force: true });

assert.equal(existsSync(wsRoot), false, "临时工作区已清理");
console.log("queue-wiring-smoke: all assertions passed");
