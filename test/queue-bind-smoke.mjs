/**
 * 队列会话显式关联绑定冒烟（bind-queue-sessions-to-target 2.2 / 3.1 / 3.2）：
 *
 *  1. 投递链在 create 后完成 explicit 绑定（清单 = 条目目标提案）、骨架同拍回填、
 *     存储落盘、单次 associations-changed 广播；
 *  2. 规则 1（用户侧 @指派其他提案）与规则 2（新提案目录出生窗口）均不再对该会话
 *     建立关联（未绑定会话的启发式路径逐字不变——压制只作用于被绑定的那一个会话）；
 *  3. 重启后（新实例从存储回读）压制保持，无需重放绑定；
 *  4. 活跃度扇出与前置状态门控（3.1 的可执行等价证据）：被绑定会话忙碌只点亮目标
 *     提案，其他提案 act 恒 0 → 其门控按钮不消失、条目照常推进不被误跳过；
 *  5. 绑定失败非阻断（3.2）：工作区路径解析不到 → 静默降级 + 可诊断告警，投递与
 *     条目推进照常。
 *
 * 运行：node test/queue-bind-smoke.mjs
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply, storagePath } from "../src/index.mjs";
import { actionButtonVisible } from "../src/buttons.mjs";
import { mergeScene } from "../src/merge.mjs";

const cleanupDirs = [];
const tempDir = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
};
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * 停机原因主信号：`session/event` 的 `turn/end`（真实宿主次序 = `turn/end` 先于
 * `agent/status` idle；one-add-cosmos-queue-stop-reason-policy 1.1 实证）。
 */
function emitTurnEnd(ctx, sessionId, reason) {
  const record = ctx.listeners.find((entry) => entry.event === "session/event");
  assert.ok(record, "session/event 监听已挂");
  record.listener({ id: sessionId }, { type: "turn/end", data: { reason } });
}

/* ── 夹具：临时工作区（openspec/changes/{add-a,add-b}） ── */
const wsRoot = tempDir("dsh-cosmos-qbind-ws-");
const wsRoot2 = tempDir("dsh-cosmos-qbind-ws2-");
const changesDir = join(wsRoot, "openspec", "changes");
for (const name of ["add-a", "add-b"]) {
  mkdirSync(join(changesDir, name), { recursive: true });
  writeFileSync(join(changesDir, name, "tasks.md"), "- [ ] one\n- [ ] two");
}
mkdirSync(join(wsRoot2, "openspec", "changes", "add-z"), { recursive: true });
writeFileSync(join(wsRoot2, "openspec", "changes", "add-z", "tasks.md"), "- [ ] z");

const NOW = Date.now();
const OLD = NOW - 2 * 60 * 60 * 1000; // 2h 前（规则 2 的 ±30min 窗口之外）

/** 会话 agent 夹具（header.cwd 供归属；snapshotEvents 供规则 1/2）。 */
function agentOf(id, cwd, events) {
  return {
    status: "idle",
    session: { header: { id, origin: "user", cwd }, snapshotEvents: () => events }
  };
}
/** 用户侧消息事件（宿主形状：`data` 即消息本体，文本块在 `data.content`）。 */
function messageEvents(at, text) {
  return [{
    type: "user/message",
    time: at,
    data: { id: "m", role: "user", source: { kind: "user" }, content: [{ type: "text", text }] }
  }];
}
/** @提案目录 指派引用（规则 1 的唯一信号口径）。 */
const assignRef = (proposal) => "@" + join(wsRoot, "openspec", "changes", proposal);

/** 会话 agent 面：`session-1`（队列会话）用户侧 @派活 目标提案与兄弟提案（规则 1 的
    诱饵）；`s2` 是未绑定会话（证明启发式未被整体关闭，只是不作用于被绑定会话）。 */
const agents = new Map([
  ["session-1", agentOf("session-1", wsRoot, messageEvents(NOW, `继续实现 ${assignRef("add-a")}；顺带注意 ${assignRef("add-b")} 是兄弟提案`))],
  ["s2", agentOf("s2", wsRoot, messageEvents(OLD, `${assignRef("add-b")} 的命名讨论`))]
]);

/** 工作区在册面（可变：请求期对账与规则判定均读这一份）。 */
let workspaceRows = [{ id: "ws1", title: "WS One", path: wsRoot, sessionIds: [] }];

/** 记录式 sessionController 桩（按序发放 sessionId；create/prompt 可挂钩子模拟故障窗口）。 */
function makeSessionController(options = {}) {
  const calls = [];
  const record = (method, args) => calls.push({ method, args });
  let seq = 0;
  return {
    calls,
    async create(...args) {
      record("create", args);
      options.beforeCreate?.();
      seq += 1;
      return { sessionId: `session-${seq}` };
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
      options.beforePrompt?.();
      return { accepted: true };
    },
    async list(...args) {
      record("list", args);
      return options.listResult ?? { items: [] };
    }
  };
}

/** 默认按钮面：B1 无前置状态；G 带 `preState: "created"`（门控断言用）。 */
const BUTTONS = [
  { name: "B1", prompt: "执行 B1" },
  { name: "G", prompt: "执行 G", preState: "created" }
];

let handler = null;
const allHandlers = [];
let frames = [];
let warns = [];

function makeCtx(assign, sessionController) {
  const listeners = [];
  return {
    logger: {
      warn(...args) {
        warns.push(args.map(String).join(" "));
      }
    },
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
        assign(def.handler);
        return () => {};
      }
    },
    workspaceRegistry: {
      list: () => workspaceRows,
      get archivedSessionIds() {
        return new Set();
      }
    },
    agents: { get: (id) => agents.get(id) ?? null },
    sessions: { get: () => null },
    sessionController,
    tools: null,
    listeners
  };
}

/** 启动应用实例（home 缺省 = 新建临时 DSH_HOME；传入同一 home 即「重启」）。 */
function boot({ home = null, sessionController = null, buttons = BUTTONS } = {}) {
  const storageHome = home ?? tempDir("dsh-cosmos-qbind-home-");
  process.env.DSH_HOME = storageHome;
  frames = [];
  warns = [];
  let captured = null;
  const ctx = makeCtx((value) => {
    captured = value;
  }, sessionController);
  apply(ctx, { buttons });
  assert.ok(captured, "apply 注册了 API handler");
  handler = captured;
  allHandlers.push(handler);
  return { home: storageHome, ctx };
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

async function sceneOf() {
  const state = await getJson("/api/dsh-v-cosmos/scene");
  assert.equal(state.status, 200, "GET /scene 200");
  return state.body.scene;
}

async function queueOf() {
  const state = await getJson("/api/dsh-v-cosmos/queue");
  assert.equal(state.status, 200, "GET /queue 200");
  return state.body.queue;
}

async function subscribeSse() {
  const sseRes = {
    writeHead() {},
    write(chunk) {
      frames.push(String(chunk));
    },
    end() {},
    on() {}
  };
  await handler({ method: "GET", url: "/api/dsh-v-cosmos/events" }, sseRes);
}

const dataFrames = () => frames
  .map((line) => line.trim())
  .filter((line) => line.startsWith("data: "))
  .map((line) => JSON.parse(line.slice(6)));
const assocFrameCount = () => dataFrames().filter((frame) => frame.type === "associations-changed").length;

const assocPairsOf = (scene) => {
  const ws = scene.workspaces.find((item) => item.id === "ws1");
  return (ws?.associations ?? []).map((item) => [item.proposal, item.sessionId, item.origin]).sort();
};
const storedEntries = () => {
  try {
    return JSON.parse(readFileSync(storagePath(), "utf8")).entries ?? [];
  } catch {
    return [];
  }
};

try {
  const first = boot({ sessionController: makeSessionController() });
  await subscribeSse();
  await sceneOf(); // 首次扫描（scanned = true）
  assert.deepEqual(assocPairsOf(await sceneOf()), [], "初始无关联（队列会话尚未创建）");

  /* ── 1. 投递链完成显式绑定：explicit 在位 + 骨架同拍回填 + 单次广播 + 落盘 ── */
  assert.equal((await postJson("/queue/pause", { wsId: "ws1" })).body.paused, true, "暂停入队前置");
  const enqueued = await postJson("/queue/enqueue", { wsId: "ws1", proposalId: "add-a", buttonName: "B1" });
  assert.equal(enqueued.status, 200, "入队 200（暂停态不投递）");
  const framesBeforeDelivery = assocFrameCount();
  assert.equal((await postJson("/queue/resume", { wsId: "ws1" })).status, 200, "恢复 200");
  await sleep(40);

  const queueAfterDelivery = await queueOf();
  const runningEntry = queueAfterDelivery.queues.ws1.entries[0];
  assert.equal(runningEntry.state, "executing", "投递成功 → executing");
  assert.equal(runningEntry.sessionId, "session-1", "条目回填新会话 id");
  assert.equal(assocFrameCount(), framesBeforeDelivery + 1, "绑定实际变更 → 恰一次 associations-changed 广播");
  const sceneAfterDelivery = await sceneOf();
  assert.deepEqual(
    assocPairsOf(sceneAfterDelivery),
    [["add-a", "session-1", "explicit"]],
    "队列会话出生即被认领：explicit 条目在位且骨架同拍回填（客户端重拉即见新边）"
  );
  const wsAfterDelivery = sceneAfterDelivery.workspaces.find((item) => item.id === "ws1");
  assert.deepEqual(wsAfterDelivery.links, [], "单提案关联 → 无联星虚线（行星恰绕目标宿主轨道）");
  assert.deepEqual(
    storedEntries().map((entry) => [entry.workspace, entry.proposal, entry.sessionId, entry.origin]),
    [[wsRoot, "add-a", "session-1", "explicit"]],
    "explicit 条目落盘（存储为唯一事实源）"
  );
  assert.deepEqual(
    warns.filter((line) => line.includes("关联绑定")),
    [],
    "正常路径零绑定告警"
  );

  /* ── 2. 规则 1 压制：用户侧 @add-b 指派也不回连；未绑定会话 s2 照常命中 ── */
  workspaceRows[0].sessionIds.push("session-1", "s2");
  workspaceRows = [...workspaceRows, { id: "ws2", title: "WS Two", path: wsRoot2, sessionIds: [] }];
  let scene = await sceneOf(); // 注册 id 集合变化 → 全量重扫（启发式两条规则同轮评估）
  assert.deepEqual(
    assocPairsOf(scene),
    [
      ["add-a", "session-1", "explicit"],
      ["add-b", "s2", "heuristic"]
    ],
    "规则 1：被绑定会话跳过（add-b 不回连）；未绑定会话 s2 的启发式路径逐字不变"
  );

  /* ── 3. 规则 2 压制：新提案目录出生窗口不再挂靠被绑定会话 ── */
  mkdirSync(join(changesDir, "add-c"), { recursive: true });
  writeFileSync(join(changesDir, "add-c", "tasks.md"), "- [ ] c");
  /* 第一跳重扫把 add-c 装入骨架（规则 2 的判定对象），第二跳才用旧骨架评估窗口。 */
  workspaceRows = [workspaceRows[0]];
  await sceneOf();
  workspaceRows = [...workspaceRows, { id: "ws2", title: "WS Two", path: wsRoot2, sessionIds: [] }];
  scene = await sceneOf();
  const wsRule2 = scene.workspaces.find((item) => item.id === "ws1");
  assert.ok(wsRule2.stars.some((star) => star.id === "add-c"), "新提案已入骨架（判定对象存在）");
  assert.deepEqual(
    assocPairsOf(scene),
    [
      ["add-a", "session-1", "explicit"],
      ["add-b", "s2", "heuristic"]
    ],
    "规则 2：被绑定会话剔除后无唯一候选 → add-c 不误挂（s2 活动在窗口外）"
  );

  /* ── 4. 活跃度扇出与门控（3.1）：被绑定会话忙碌只点亮目标提案 ── */
  const statusListener = first.ctx.listeners.find((record) => record.event === "agent/status");
  assert.ok(statusListener, "agent/status 监听已挂");
  statusListener.listener({ agent: { id: "session-1" }, status: "running" });

  /* 渲染门控同一谓词（纯函数链）：mergeScene 的 act 只看关联边 —— 被绑定会话只给
     add-a 计数，add-b act = 0 → 其前置状态按钮不消失。 */
  scene = await sceneOf();
  const merged = mergeScene({
    skeleton: scene,
    sessions: {
      ids: ["session-1"],
      byId: { "session-1": { id: "session-1", blank: false, origin: "user", running: true, updatedAt: NOW } }
    },
    workspaces: { items: [{ id: "ws1", sessionIds: ["session-1"] }] },
    statuses: new Map([["session-1", { running: true }]]),
    now: NOW
  });
  const mergedWs = merged.workspaces.find((item) => item.id === "ws1");
  const starOf = (id) => mergedWs.stars.find((star) => star.id === id);
  assert.equal(starOf("add-a").act, 1, "目标提案活跃度 = 1（行星忙碌扇出）");
  assert.equal(starOf("add-b").act, 0, "未参与工作的提案保持沉睡（act 0）");
  assert.equal(
    actionButtonVisible({ preState: "created" }, { lifecycle: starOf("add-b").lifecycle, act: starOf("add-b").act }),
    true,
    "沉睡提案的前置状态门控按钮不消失（act = 0 → 渲染）"
  );
  assert.equal(
    actionButtonVisible({ preState: "created" }, { lifecycle: starOf("add-a").lifecycle, act: starOf("add-a").act }),
    false,
    "忙碌提案的门控按钮按既有语义隐藏（差分对照：act 扇出真实生效）"
  );
  const planetOf = mergedWs.planets.find((planet) => planet.id === "session-1");
  assert.deepEqual(planetOf.stars, ["add-a"], "会话行星只绕目标提案运行（单星轨道）");

  /* 条目不被误跳过：执行时刻复验与入队复验同一谓词（queueActivityActOf ×
     actionButtonVisible）。被绑定会话忙碌时 add-b（act 0）门控入队 200；add-a（act 1）
     门控入队 400 gate —— 误跳过只可能发生在被误挂的提案上，而误挂已被绑定消除。 */
  const gatedOther = await postJson("/queue/enqueue", { wsId: "ws1", proposalId: "add-b", buttonName: "G" });
  assert.equal(gatedOther.status, 200, "忙碌被绑定会话 → 其他提案门控通过（act 恒 0）");
  const gatedSame = await postJson("/queue/enqueue", { wsId: "ws1", proposalId: "add-a", buttonName: "G" });
  assert.equal(gatedSame.status, 400, "忙碌目标提案复验不过（既有语义：前置状态漂移）");
  assert.equal(gatedSame.body.error, "gate", "失败原因 = gate（无新失败原因族）");

  /* 回合跑完 → 完成出队 → 下一条（add-b）推进而不是被误判 prestate-drift 跳过。 */
  emitTurnEnd(first.ctx, "session-1", { kind: "completed" });
  statusListener.listener({ agent: { id: "session-1" }, status: "idle" });
  await sleep(40);
  const afterIdle = await queueOf();
  const advancedEntry = afterIdle.queues.ws1.entries.find((entry) => entry.proposalId === "add-b");
  assert.ok(advancedEntry, "add-b 条目留在队列中并推进");
  assert.equal(advancedEntry.state, "executing", "下一条照常投递执行（MUST NOT 误判 prestate-drift 跳过）");
  assert.equal(advancedEntry.reason, undefined, "无 skipped 原因");

  /* ── 5. 重启回读：explicit 压制保持，无需重放绑定 ── */
  boot({ home: first.home, sessionController: makeSessionController() });
  workspaceRows = [{ id: "ws1", title: "WS One", path: wsRoot, sessionIds: ["session-1"] }];
  const sceneAfterRestart = await sceneOf();
  assert.deepEqual(
    assocPairsOf(sceneAfterRestart).filter((pair) => pair[1] === "session-1"),
    [["add-a", "session-1", "explicit"]],
    "重启实例从存储回读 explicit 条目，压制保持（不因上下文/目录窗口回连 add-b）"
  );

  /* ── 6. 绑定失败非阻断（3.2）：工作区路径解析不到 → 静默降级 + 告警，投递照常推进 ── */
  const savedRows = [{ id: "ws1", title: "WS One", path: wsRoot, sessionIds: [] }];
  const failingController = makeSessionController({
    /* create 之后、bind 之前把工作区从在册面摘除（模拟解析不到路径的失败窗口），
       prompt 时恢复（绑定步骤已在窗口内静默跳过）。 */
    beforeCreate: () => {
      workspaceRows = [];
    },
    beforePrompt: () => {
      workspaceRows = savedRows.slice();
    }
  });
  boot({ sessionController: failingController });
  workspaceRows = savedRows.slice();
  await subscribeSse();
  await sceneOf();
  await postJson("/queue/pause", { wsId: "ws1" });
  assert.equal((await postJson("/queue/enqueue", { wsId: "ws1", proposalId: "add-b", buttonName: "B1" })).status, 200, "入队 200");
  const framesBeforeDegraded = assocFrameCount();
  await postJson("/queue/resume", { wsId: "ws1" });
  await sleep(40);
  const degradedQueue = await queueOf();
  const degradedEntry = degradedQueue.queues.ws1.entries[0];
  assert.ok(degradedEntry, "绑定失败不影响条目推进（条目仍在）");
  assert.equal(degradedEntry.state, "executing", "投递链照常推进到 executing");
  assert.equal(degradedQueue.queues.ws1.paused, false, "绑定失败不暂停队列（无新失败原因族）");
  assert.equal(
    failingController.calls.some((call) => call.method === "prompt"),
    true,
    "prompt 照常发出（绑定失败非阻断）"
  );
  assert.equal(assocFrameCount(), framesBeforeDegraded, "绑定被跳过 → 零 associations-changed 广播");
  assert.deepEqual(storedEntries(), [], "绑定失败 → 无 explicit 条目落盘（该会话退回启发式，无脏写入）");
  assert.equal(
    warns.some((line) => line.includes("关联绑定跳过") || line.includes("关联绑定失败")),
    true,
    "日志可见降级记录（3.2：可诊断但不阻断）"
  );

  /* ── 收尾：注销全部工作区并让每个实例各拉一次 /scene，摘除 fs.watch ── */
  workspaceRows = [];
  for (const instanceHandler of allHandlers) {
    await instanceHandler({ method: "GET", url: "/api/dsh-v-cosmos/scene" }, captureJson().res);
  }
} finally {
  for (const dir of cleanupDirs) rmSync(dir, { recursive: true, force: true });
}

console.log("queue-bind-smoke: all assertions passed");
