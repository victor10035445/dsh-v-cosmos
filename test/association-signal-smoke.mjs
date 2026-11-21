/**
 * 关联启发式信号口径冒烟（restrict-association-heuristics 2.3 / 3.3 / 4.1 / 4.2）：
 * 真调 `apply()` + `GET /scene` 路由（宿主接线面），验证：
 *
 *  1. 用户侧 `@<提案目录>` 指派引用建立 heuristic 关联（含 Windows 反斜杠路径）；
 *  2. 正文罗列 slug、assistant 回显 @引用 → 不建立关联（忙碌会话不点亮未参与工作的提案）；
 *  3. 规则 2 排除判定时刻「正在运行」的会话；空闲唯一候选照常建立；等待决策候选保留；
 *  4. `mergeScene` 派生：指派会话成为绕目标恒星的行星；无关联的忙碌会话是彗星、act 恒 0。
 *
 * 运行：node test/association-signal-smoke.mjs
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply } from "../src/index.mjs";
import { mergeScene } from "../src/merge.mjs";

const storageHome = mkdtempSync(join(tmpdir(), "dsh-cosmos-signal-home-"));
const wsRoot = mkdtempSync(join(tmpdir(), "dsh-cosmos-signal-ws-"));
const dummyRoot = mkdtempSync(join(tmpdir(), "dsh-cosmos-signal-dummy-"));
process.env.DSH_HOME = storageHome;

const NOW = Date.now();
const OLD = NOW - 2 * 60 * 60 * 1000; // 2h 前（规则 2 的 ±30min 窗口之外）
const changesDir = join(wsRoot, "openspec", "changes");
for (const name of ["add-a", "add-b"]) {
  mkdirSync(join(changesDir, name), { recursive: true });
  writeFileSync(join(changesDir, name, "tasks.md"), "- [ ] one\n- [ ] two");
}

/** 用户侧消息事件（宿主 dsh-session 形状：`data` 即消息本体，文本块在 `data.content`）。 */
const userEvent = (time, text) => ({
  type: "user/message",
  time,
  data: { id: "m", role: "user", source: { kind: "user" }, content: [{ type: "text", text }] }
});
/** assistant 消息事件（宿主形状：文本块在 `data.message.content`）。 */
const assistantEvent = (time, text) => ({
  type: "assistant/message",
  time,
  data: { message: { role: "assistant", content: [{ type: "text", text }] } }
});
/** @提案目录 指派引用（Windows 反斜杠路径写法，覆盖分隔符归一）。 */
const assignRef = (proposal) => "@" + join(wsRoot, "openspec", "changes", proposal);

/** 会话事件面（可变：规则 2 的窗口判定读 lastActivityMs）。 */
const eventsById = new Map([
  ["s-assign", [userEvent(OLD, `请按 ${assignRef("add-a")} 实施`)]],
  [
    "s-narrate",
    [
      userEvent(OLD, "顺便聊聊 add-a 与 add-b 的实现思路（正文罗列，无 @ 引用）"),
      assistantEvent(OLD + 1000, `收到，我记下了 ${assignRef("add-b")}`) // assistant 回显 @引用
    ]
  ],
  ["s-busy", [userEvent(NOW, "我先忙着别的活")]],
  ["s-waiting", [userEvent(OLD, "先看看")]]
]);
const agents = new Map();
for (const id of eventsById.keys()) {
  agents.set(id, {
    status: "idle",
    session: { header: { id, origin: "user", cwd: wsRoot }, snapshotEvents: () => eventsById.get(id) ?? [] }
  });
}

const rootRow = {
  id: "ws1",
  title: "WS One",
  path: wsRoot,
  sessionIds: ["s-assign", "s-narrate", "s-busy", "s-waiting"]
};
/** 工作区在册面（dummy 行增删 → id 集合指纹变化 → 请求期全量重扫，免等 fs.watch 防抖）。 */
let dummyOn = false;
let workspaceRows = [rootRow];

let handler = null;
const listeners = [];
const ctx = {
  logger: { warn() {} },
  effect(fn) {
    return fn();
  },
  inject() {},
  on(event, listener, listenerOptions) {
    listeners.push({ event, listener, listenerOptions });
    return () => {};
  },
  webServer: {
    register(def) {
      handler = def.handler;
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
  sessions: { get: () => null }
};

apply(ctx);
assert.ok(handler, "apply 注册了 API handler");

const listenerOf = (event) => listeners.filter((record) => record.event === event).pop();
const emitStatus = (sessionId, status) => listenerOf("agent/status").listener({ agent: { id: sessionId }, status });
const assocPairs = (scene) => (scene.workspaces.find((ws) => ws.id === "ws1")?.associations ?? [])
  .map((entry) => [entry.proposal, entry.sessionId, entry.origin])
  .sort();
const starsOf = (scene) => scene.workspaces.find((ws) => ws.id === "ws1")?.stars ?? [];
const bump = () => {
  dummyOn = !dummyOn;
  workspaceRows = dummyOn
    ? [rootRow, { id: "ws-dummy", title: "Dummy", path: dummyRoot, sessionIds: [] }]
    : [rootRow];
};
/** 请求期全量重扫：骨架 id 集合指纹失效即触发（免等 fs.watch 防抖）。 */
const forceScan = async () => {
  bump();
  return sceneOf();
};
/** 规则 2 的判定对象取自**上一轮**骨架（既有装配语义：新提案先入骨架、下一跳才评估窗口），
    因此每个目录出生场景连扫两跳。 */
const forceScans = async (count = 1) => {
  let scene = null;
  for (let i = 0; i < count; i++) scene = await forceScan();
  return scene;
};

try {
  /* 忙碌会话的会话态在首扫前入缓存（服务端可达状态 running；与队列复验同源）。 */
  emitStatus("s-busy", "running");

  /* ── 1. 首扫：只有用户侧 @指派引用建立关联；正文/assistant 回显不建立；
         运行中的唯一窗口候选不接生（add-b 无关联） ── */
  let scene = await sceneOf();
  assert.deepEqual(assocPairs(scene), [["add-a", "s-assign", "heuristic"]], "仅用户侧 @指派引用建立关联");
  assert.ok(
    !assocPairs(scene).some(([, sessionId]) => sessionId === "s-narrate"),
    "正文罗列 slug 与 assistant 回显 @引用均不建立关联"
  );
  assert.ok(
    !assocPairs(scene).some(([proposal]) => proposal === "add-b"),
    "运行中的唯一窗口候选被排除 → 被叙述提及的提案无关联"
  );

  /* ── 2. mergeScene：无关联的忙碌叙述会话是彗星，不给任何提案加速度（4.1 等价工装） ── */
  const merged = mergeScene({
    skeleton: scene,
    sessions: {
      ids: ["s-assign", "s-narrate"],
      byId: {
        "s-assign": { id: "s-assign", blank: false, origin: "user", running: false, updatedAt: NOW },
        "s-narrate": { id: "s-narrate", blank: false, origin: "user", running: true, updatedAt: NOW }
      }
    },
    workspaces: { items: [{ id: "ws1", sessionIds: ["s-assign", "s-narrate"] }] },
    statuses: new Map([["s-narrate", { running: true }]]),
    now: NOW
  });
  const mergedWs = merged.workspaces.find((ws) => ws.id === "ws1");
  const starOf = (id) => mergedWs.stars.find((star) => star.id === id);
  assert.equal(starOf("add-a").act, 0, "忙碌的未关联会话不给提案增加活跃度");
  assert.equal(starOf("add-b").act, 0, "被叙述提及的提案保持沉睡（act 0）");
  assert.ok(mergedWs.comets.some((comet) => comet.id === "s-narrate"), "无关联的忙碌会话是彗星");
  assert.ok(!mergedWs.planets.some((planet) => planet.id === "s-narrate"), "未关联会话不成为行星");

  /* ── 3. 规则 2 忙碌排除：新目录出现时唯一窗口候选恰为运行中会话 → 不建立 ── */
  mkdirSync(join(changesDir, "add-c"), { recursive: true });
  writeFileSync(join(changesDir, "add-c", "tasks.md"), "- [ ] c");
  scene = await forceScans(2); // 第一跳入骨架、第二跳评估出生窗口（判定对象 = 上一轮骨架）
  assert.ok(starsOf(scene).some((star) => star.id === "add-c"), "新提案已入骨架（规则 2 的判定对象存在）");
  assert.ok(
    !assocPairs(scene).some(([proposal]) => proposal === "add-c"),
    "唯一候选正在运行 → 新目录不挂靠（忙碌会话不接生新目录）"
  );

  /* ── 4. 差分对照：同一会话空闲后，同一目录照常挂靠（证明前一步非时间窗巧合） ── */
  emitStatus("s-busy", "idle");
  mkdirSync(join(changesDir, "add-cc"), { recursive: true });
  writeFileSync(join(changesDir, "add-cc", "tasks.md"), "- [ ] cc");
  scene = await forceScans(2);
  assert.deepEqual(
    assocPairs(scene).filter(([proposal]) => proposal === "add-cc"),
    [["add-cc", "s-busy", "heuristic"]],
    "空闲唯一候选照常建立关联（排除只针对运行中）"
  );
  assert.deepEqual(
    assocPairs(scene).filter(([proposal]) => proposal === "add-c"),
    [["add-c", "s-busy", "heuristic"]],
    "同一目录在会话空闲后即挂靠（差分成因 = 运行态排除，非窗口漂移）"
  );

  /* ── 5. 等待决策候选保留：running=false ∧ waiting>0 的会话照常接生 ── */
  eventsById.set("s-busy", [userEvent(OLD, "我先忙着别的活")]); // 移出窗口
  eventsById.set("s-waiting", [userEvent(NOW, "先看看")]); // 入窗
  const approval = listenerOf("approval/request");
  assert.ok(approval, "审批瀑布监听已挂（交互进入沿 → 等待决策）");
  /* next 返回挂起 promise：interactionEnter 的注销沿（finally）不执行 → waiting 恒 1。 */
  void approval.listener({ agent: { session: { header: { id: "s-waiting" } } } }, () => new Promise(() => {}));
  mkdirSync(join(changesDir, "add-d"), { recursive: true });
  writeFileSync(join(changesDir, "add-d", "tasks.md"), "- [ ] d");
  scene = await forceScans(2);
  assert.deepEqual(
    assocPairs(scene).filter(([proposal]) => proposal === "add-d"),
    [["add-d", "s-waiting", "heuristic"]],
    "等待决策（非运行）候选保留 → 照常建立关联"
  );

  /* ── 6. 行星绕行（4.2 等价工装）：指派会话成为绕目标恒星的行星 ── */
  const mergedAssigned = mergeScene({
    skeleton: scene,
    sessions: {
      ids: ["s-assign"],
      byId: { "s-assign": { id: "s-assign", blank: false, origin: "user", running: false, updatedAt: NOW } }
    },
    workspaces: { items: [{ id: "ws1", sessionIds: ["s-assign"] }] },
    statuses: new Map(),
    now: NOW
  });
  const assignedPlanet = mergedAssigned.workspaces
    .find((ws) => ws.id === "ws1")
    .planets.find((planet) => planet.id === "s-assign");
  assert.ok(assignedPlanet, "用户侧 @派活的会话成为行星");
  assert.deepEqual(assignedPlanet.stars, ["add-a"], "行星恰绕指派的目标提案运行");
} finally {
  /* 注销全部工作区并各拉一次 /scene：摘除 fs.watch（Windows 上删除仍被递归监视的
     目录会让 libuv 在进程关闭阶段自旋；本套件自建自删临时目录）。 */
  workspaceRows = [];
  if (handler) await sceneOf();
  rmSync(wsRoot, { recursive: true, force: true });
  rmSync(dummyRoot, { recursive: true, force: true });
  rmSync(storageHome, { recursive: true, force: true });
}

console.log("association-signal-smoke: all assertions passed");

/* ── 工具 ── */

async function sceneOf() {
  const state = captureJson();
  await handler({ method: "GET", url: "/api/dsh-v-cosmos/scene" }, state.res);
  assert.equal(state.status, 200, "GET /scene 200");
  return state.body.scene;
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
