/**
 * 显式关联绑定宿主接线冒烟（fix-cosmos-association-scope 2.1–2.3 / spec「显式会话关联绑定」）：
 * stub ctx 直调 apply()，验证 bind-session 端点语义——归一化 400、workspace/unknown、
 * 替换写入 + 落盘 + 单次 associations-changed 广播、幂等重绑零广播、启发式两条规则对
 * 被绑定会话的压制（规则 1 跳过 / 规则 2 剔除后判唯一）、未绑定会话行为不变、
 * 重启后（新实例从存储回读）压制保持、cwd 兜底归属。
 * 运行：node test/bind-wiring-smoke.mjs
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply, storagePath } from "../src/index.mjs";

/* ── 夹具：临时工作区（openspec/changes/{add-a,add-b}）+ 自定义 DSH_HOME ── */
const wsRoot = mkdtempSync(join(tmpdir(), "dsh-cosmos-bind-ws-"));
const wsRoot2 = mkdtempSync(join(tmpdir(), "dsh-cosmos-bind-ws2-"));
const otherRoot = mkdtempSync(join(tmpdir(), "dsh-cosmos-bind-other-"));
const storageHome = mkdtempSync(join(tmpdir(), "dsh-cosmos-bind-home-"));
process.env.DSH_HOME = storageHome;

const NOW = Date.now();
const OLD = NOW - 2 * 60 * 60 * 1000; // 2h 前（规则 2 的 ±30min 窗口之外）

/** 用户侧消息事件（宿主 dsh-session 形状：`data` 即消息本体，文本块在 `data.content`）。 */
function messageEvents(at, text) {
  return [{
    type: "user/message",
    time: at,
    data: { id: "m", role: "user", source: { kind: "user" }, content: [{ type: "text", text }] }
  }];
}

/** @提案目录 指派引用（规则 1 的唯一信号口径）。 */
const assignRef = (proposal) => "@" + join(wsRoot, "openspec", "changes", proposal);

/** 会话 agent 夹具（header.cwd 供 cwd 兜底归属；snapshotEvents 供规则 1/2）。 */
function agentOf(id, cwd, events) {
  return {
    status: "idle",
    session: { header: { id, origin: "user", cwd }, snapshotEvents: () => events }
  };
}

const agents = new Map([
  /* s1：本会话语境同时 @派活 目标提案与兄弟提案（新口径下引用照常全部建立 → 绑定的替换语义才是修复面）。 */
  ["s1", agentOf("s1", wsRoot, messageEvents(NOW, `继续实现 ${assignRef("add-a")}；顺带注意 ${assignRef("add-b")} 是兄弟提案`))],
  /* s2：未绑定会话（规则 1 照常命中 add-b；活动时刻在窗口外 → 规则 2 不参与）。 */
  ["s2", agentOf("s2", wsRoot, messageEvents(OLD, `${assignRef("add-b")} 的命名讨论`))],
  /* s3：不在 registry，仅 cwd 与工作区 path 相等（cwd 兜底归属）。 */
  ["s3", agentOf("s3", wsRoot, messageEvents(NOW, `把 ${assignRef("add-b")} 收个尾`))],
  /* s4：既不在 registry、cwd 也不归属任何工作区。 */
  ["s4", agentOf("s4", otherRoot, messageEvents(NOW, "游离会话"))]
]);

let workspaceRows = [{ id: "ws1", title: "WS One", path: wsRoot, sessionIds: ["s1"] }];

let handler = null;
let handler2 = null;
const sseWrites = [];

function makeCtx(assign) {
  return {
    logger: { warn() {} },
    effect(fn) {
      return fn();
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
    agents: {
      get: (id) => agents.get(id) ?? null
    }
  };
}

try {
  const changesDir = join(wsRoot, "openspec", "changes");
  for (const name of ["add-a", "add-b"]) {
    mkdirSync(join(changesDir, name), { recursive: true });
    writeFileSync(join(changesDir, name, "tasks.md"), "- [ ] one\n- [ ] two");
  }
  const changesDir2 = join(wsRoot2, "openspec", "changes");
  mkdirSync(join(changesDir2, "add-z"), { recursive: true });
  writeFileSync(join(changesDir2, "add-z", "tasks.md"), "- [ ] z");

  apply(makeCtx((captured) => {
    handler = captured;
  }));
  assert.ok(handler, "apply 注册了 API handler");

  const sseRes = stubRes(sseWrites);
  await handler({ method: "GET", url: "/api/dsh-v-cosmos/events" }, sseRes);
  const dataFrames = () => sseWrites
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)));
  const assocFrameCount = () => dataFrames().filter((frame) => frame.type === "associations-changed").length;

  /* ── 初始扫描：规则 1 把 s1 的两个 @指派引用同时挂上（绑定替换语义的对照面） ── */
  await handler({ method: "GET", url: "/api/dsh-v-cosmos/scene" }, captureJson().res);
  let scene = await sceneOf(handler);
  let ws = scene.workspaces.find((item) => item.id === "ws1");
  assert.deepEqual(
    ws.associations.map((item) => [item.proposal, item.sessionId, item.origin]).sort(),
    [
      ["add-a", "s1", "heuristic"],
      ["add-b", "s1", "heuristic"]
    ],
    "初始启发式：用户侧双 @指派引用全部关联（绑定前的对照面）"
  );
  assert.deepEqual(ws.links, [[0, 1]], "初始双关联 → 星座内联星虚线（行星被误挂两个提案）");
  const framesBeforeBind = assocFrameCount();
  const changesDirBeforeBind = readdirSync(changesDir).sort();

  /* ── 绑定：替换语义——恰为清单、origin=explicit、错误边删除、单次广播 ── */
  const bound = await post(handler, "/api/dsh-v-cosmos/bind-session", { sessionId: "s1", proposals: [" add-a ", "add-a"] });
  assert.equal(bound.status, 200, "绑定成功 200");
  assert.deepEqual(bound.body, { ok: true, bound: ["add-a"] }, "响应 bound = 归一化后清单（trim/去重）");
  assert.equal(assocFrameCount(), framesBeforeBind + 1, "实际变更 → 恰一次 associations-changed 广播");
  assert.deepEqual(readdirSync(changesDir).sort(), changesDirBeforeBind, "绑定零写入 openspec 目录（关联只存插件存储）");

  scene = await sceneOf(handler);
  ws = scene.workspaces.find((item) => item.id === "ws1");
  assert.deepEqual(
    ws.associations.map((item) => [item.proposal, item.sessionId, item.origin]),
    [["add-a", "s1", "explicit"]],
    "替换清掉 add-b 的错误边；骨架同拍回填（客户端重拉即见新边）"
  );
  assert.deepEqual(ws.links, [], "错误边清除 → 联星虚线消失（行星恰绕单星轨道）");
  const storedAfterBind = JSON.parse(readFileSync(storagePath(), "utf8"));
  assert.deepEqual(
    storedAfterBind.entries.map((entry) => [entry.workspace, entry.proposal, entry.sessionId, entry.origin]),
    [[wsRoot, "add-a", "s1", "explicit"]],
    "explicit 条目落盘（存储为唯一事实源）"
  );

  /* ── 幂等重绑：同清单第二次 → 零写入零广播抖动 ── */
  const framesBeforeIdempotent = assocFrameCount();
  const storageTextBefore = readFileSync(storagePath(), "utf8");
  const rebind = await post(handler, "/api/dsh-v-cosmos/bind-session", { sessionId: "s1", proposals: ["add-a"] });
  assert.equal(rebind.status, 200, "幂等重绑仍 200");
  assert.equal(assocFrameCount(), framesBeforeIdempotent, "幂等重绑零广播（MUST NOT 抖动）");
  assert.equal(readFileSync(storagePath(), "utf8"), storageTextBefore, "幂等重绑零写入");

  /* ── 规则 1 压制：注册新工作区触发全量重扫，s1 上下文仍有 @add-b 引用也不回连 ── */
  workspaceRows = [...workspaceRows, { id: "ws2", title: "WS Two", path: wsRoot2, sessionIds: [] }];
  let framesBeforeRescan = assocFrameCount();
  scene = await sceneOf(handler);
  ws = scene.workspaces.find((item) => item.id === "ws1");
  assert.deepEqual(
    ws.associations.map((item) => [item.proposal, item.sessionId, item.origin]),
    [["add-a", "s1", "explicit"]],
    "规则 1 跳过被绑定会话：重扫不回连 add-b"
  );
  assert.equal(assocFrameCount(), framesBeforeRescan, "重扫零抖动（压制即无新增关联 → 无广播）");

  /* ── 规则 2 压制：绑定期间新出现的提案目录，唯一活跃会话仍是被绑定的 s1 → 不关联 ── */
  mkdirSync(join(changesDir, "add-c"), { recursive: true });
  writeFileSync(join(changesDir, "add-c", "tasks.md"), "- [ ] c");
  framesBeforeRescan = assocFrameCount();
  /* 注册 id 集合再次变化（注销 ws2）→ 触发全量重扫；此时 s1 是该工作区唯一活跃会话，
     且 add-c 目录刚出现（birthtime ≈ now，落在 s1 活动时刻的 ±30min 窗口内）。 */
  workspaceRows = [workspaceRows[0]];
  scene = await sceneOf(handler);
  ws = scene.workspaces.find((item) => item.id === "ws1");
  assert.ok(ws.stars.some((star) => star.id === "add-c"), "新提案已入骨架（规则 2 的判定对象存在）");
  assert.deepEqual(
    ws.associations.map((item) => [item.proposal, item.sessionId, item.origin]),
    [["add-a", "s1", "explicit"]],
    "规则 2 剔除被绑定会话后再判唯一性 → add-c 不误连（否则唯一活跃会话即 s1）"
  );
  assert.equal(assocFrameCount(), framesBeforeRescan, "规则 2 压制同样零新增关联");

  /* ── 未绑定会话行为逐字不变：s2 注册进工作区后，规则 1 照常建立 add-b 关联 ── */
  workspaceRows = [{ id: "ws1", title: "WS One", path: wsRoot, sessionIds: ["s1", "s2"] }];
  /* 注册 id 集合变化（新增 s2 不改变 id 集合 → 追加一次工作区增删以触发全量重扫）。 */
  workspaceRows = [...workspaceRows, { id: "ws2", title: "WS Two", path: wsRoot2, sessionIds: [] }];
  scene = await sceneOf(handler);
  ws = scene.workspaces.find((item) => item.id === "ws1");
  const pairs = ws.associations.map((item) => [item.proposal, item.sessionId, item.origin]).sort();
  assert.deepEqual(
    pairs,
    [
      ["add-a", "s1", "explicit"],
      ["add-b", "s2", "heuristic"]
    ],
    "未绑定会话 s2 的启发式路径与从前一致；被绑定会话 s1 保持单 explicit 边"
  );
  assert.ok(!ws.associations.some((item) => item.sessionId === "s2" && item.proposal === "add-c"), "s2 在窗口外 → 规则 2 不命中（证明压制测试的窗口前提成立）");

  /* ── 重启后压制保持：新宿主实例从存储回读 explicit 条目，无需重新绑定 ── */
  workspaceRows = [{ id: "ws1", title: "WS One", path: wsRoot, sessionIds: ["s1", "s2"] }];
  const sseWrites2 = [];
  /* 第二实例的 webServer 捕获到 handler2；SSE 复用同一写桩（广播等价）。 */
  apply(makeCtx((captured) => {
    handler2 = captured;
  }));
  assert.ok(handler2, "第二实例注册了 handler");
  await handler2({ method: "GET", url: "/api/dsh-v-cosmos/events" }, stubRes(sseWrites2));
  const sceneAfterRestart = await sceneOf(handler2);
  const wsAfterRestart = sceneAfterRestart.workspaces.find((item) => item.id === "ws1");
  assert.ok(
    wsAfterRestart.associations.some((item) => item.proposal === "add-a" && item.sessionId === "s1" && item.origin === "explicit"),
    "重启实例回读 explicit 条目"
  );
  assert.ok(
    !wsAfterRestart.associations.some((item) => item.sessionId === "s1" && item.proposal !== "add-a"),
    "重启后压制保持：s1 不因上下文/目录窗口被启发式回连"
  );
  assert.ok(
    wsAfterRestart.associations.some((item) => item.proposal === "add-b" && item.sessionId === "s2" && item.origin === "heuristic"),
    "重启后未绑定会话仍走启发式"
  );

  /* ── cwd 兜底归属：registry 未登记但 header.cwd 与工作区 path 相等 ── */
  const cwdBind = await post(handler, "/api/dsh-v-cosmos/bind-session", { sessionId: "s3", proposals: ["add-b"] });
  assert.equal(cwdBind.status, 200, "cwd 兜底解析成功");
  assert.deepEqual(cwdBind.body.bound, ["add-b"]);
  const storedAfterCwd = JSON.parse(readFileSync(storagePath(), "utf8"));
  assert.ok(
    storedAfterCwd.entries.some((entry) => entry.sessionId === "s3" && entry.proposal === "add-b" && entry.origin === "explicit"),
    "cwd 兜底绑定落盘（工作区 = 路径指纹）"
  );
  const sceneAfterCwd = await sceneOf(handler);
  assert.ok(
    sceneAfterCwd.workspaces.find((item) => item.id === "ws1").associations.some((item) => item.sessionId === "s3"),
    "cwd 兜底绑定随骨架下发"
  );

  /* 其他会话的显式/启发式条目不受影响（替换只作用于该 (workspace, sessionId) 范围） */
  const storedFinal = JSON.parse(readFileSync(storagePath(), "utf8"));
  assert.ok(storedFinal.entries.some((entry) => entry.sessionId === "s2" && entry.origin === "heuristic"), "范围外条目原样保留");

  /* ── 请求面：归一化失败 400 invalid / 归属解析失败 400 workspace/unknown ── */
  const framesBeforeInvalid = assocFrameCount();
  const storageBeforeInvalid = readFileSync(storagePath(), "utf8");
  const invalidCases = [
    ["缺失 sessionId", { proposals: ["add-a"] }],
    ["空清单", { sessionId: "s1", proposals: [] }],
    ["条目空白", { sessionId: "s1", proposals: ["add-a", "  "] }],
    ["超上限", { sessionId: "s1", proposals: Array.from({ length: 17 }, (_, index) => "p-" + index) }],
    ["proposals 非数组", { sessionId: "s1", proposals: "add-a" }]
  ];
  for (const [label, body] of invalidCases) {
    const response = await post(handler, "/api/dsh-v-cosmos/bind-session", body);
    assert.equal(response.status, 400, "非法请求 400：" + label);
    assert.equal(response.body.error, "invalid", "错误码 invalid：" + label);
  }
  const unknownWorkspace = await post(handler, "/api/dsh-v-cosmos/bind-session", { sessionId: "s4", proposals: ["add-a"] });
  assert.equal(unknownWorkspace.status, 400, "sessionId 不归属任何在册工作区 → 400");
  assert.equal(unknownWorkspace.body.error, "workspace/unknown", "错误码 workspace/unknown（registry 与 cwd 均未命中）");
  assert.equal(assocFrameCount(), framesBeforeInvalid, "400 路径零广播");
  assert.equal(readFileSync(storagePath(), "utf8"), storageBeforeInvalid, "400 路径零写入");

  /* 未知路由仍 404（新端点未破坏兜底） */
  const nope = captureJson();
  await handler({ method: "GET", url: "/api/dsh-v-cosmos/nope" }, nope.res);
  assert.equal(nope.status, 404);

  /* 清理前注销全部工作区并各拉一次 /scene：请求期对账摘除 fs.watch（Windows 上
     删除仍被递归监视的目录会让 libuv 在进程关闭阶段自旋；本套件自建自删临时目录）。 */
  workspaceRows = [];
  await sceneOf(handler);
  await sceneOf(handler2);
} finally {
  rmSync(wsRoot, { recursive: true, force: true });
  rmSync(wsRoot2, { recursive: true, force: true });
  rmSync(otherRoot, { recursive: true, force: true });
  rmSync(storageHome, { recursive: true, force: true });
}

console.log("bind-wiring-smoke: all assertions passed");

/* ── 工具 ── */

async function sceneOf(target) {
  const state = captureJson();
  await target({ method: "GET", url: "/api/dsh-v-cosmos/scene" }, state.res);
  assert.equal(state.status, 200, "GET /scene 200");
  return state.body.scene;
}

async function post(target, url, body) {
  const state = captureJson();
  await target(stubBodyReq("POST", url, body), state.res);
  return state;
}

function stubRes(sink) {
  return {
    writeHead() {},
    write(chunk) {
      sink.push(String(chunk));
    },
    end() {},
    on() {}
  };
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

/** 带 JSON 体的请求桩（handler 以 `for await (const chunk of req)` 读体）。 */
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
