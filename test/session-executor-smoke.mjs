/**
 * 进程内会话执行器冒烟（swap-cosmos-queue-native-executor 1.2）：
 * 投递失败码族 / 成功链调用序与入参形状 / 冷读三分支 / payload 组装回归。
 * 运行：node test/session-executor-smoke.mjs
 */
import assert from "node:assert/strict";
import {
  SESSION_FAILURES,
  SESSION_TITLE_MAX_CHARS,
  createQueueDeliverer,
  createSessionReader,
  deliverPayloadOf,
  queueTitleOf
} from "../src/session-executor.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 条目夹具：@目录 + prompt、快照模型。 */
const entry = {
  wsId: "ws1",
  proposalId: "add-a",
  proposalDir: "C:/ws/openspec/changes/add-a",
  button: {
    name: "B1",
    prompt: "执行",
    prepend: false,
    model: { provider: "deepseek", model: "deepseek-chat" }
  }
};

/**
 * 记录式 sessionController 桩：逐方法可注入抛错/返回值，可整体省略某方法（能力残缺现场）。
 * @param {{createThrows?: boolean, selectModelThrows?: boolean, renameThrows?: boolean,
 *          promptThrows?: boolean, listThrows?: boolean, createResult?: object,
 *          listResult?: object, omit?: string[]}} [options]
 */
function makeController(options = {}) {
  const calls = [];
  const record = (method, args) => calls.push({ method, args });
  const full = {
    async create(...args) {
      record("create", args);
      if (options.createThrows === true) throw new Error("create boom");
      return options.createResult ?? { sessionId: "s-1" };
    },
    async selectModel(...args) {
      record("selectModel", args);
      if (options.selectModelThrows === true) throw new Error("model boom");
      return { selected: true };
    },
    async rename(...args) {
      record("rename", args);
      if (options.renameThrows === true) throw new Error("rename boom");
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
  const omitted = new Set(Array.isArray(options.omit) ? options.omit : []);
  const controller = { calls };
  for (const [name, fn] of Object.entries(full)) {
    if (!omitted.has(name)) controller[name] = fn;
  }
  return controller;
}

/* ── 1. payload 组装 / 标题（原 queen-client 口径移入后的回归） ── */
{
  assert.deepEqual(
    [...SESSION_FAILURES],
    [
      "session-controller-unavailable",
      "create-failed",
      "model-unavailable",
      "prompt-failed",
      "delivery-failed"
    ],
    "失败原因族 = 进程内直投族（无 queen-*）"
  );

  const built = deliverPayloadOf(entry);
  assert.equal(built.ok, true, "payload 组装成功");
  assert.deepEqual(
    built.payload,
    {
      workspaceId: "ws1",
      title: "队列·B1·add-a",
      text: "@C:/ws/openspec/changes/add-a\n执行",
      model: { provider: "deepseek", model: "deepseek-chat" }
    },
    "payload 分解为四命令入参（workspaceId / 标题 / @目录+prompt / 模型）"
  );

  const prepended = deliverPayloadOf({ ...entry, button: { ...entry.button, prepend: true } });
  assert.equal(prepended.payload.text, "执行\n@C:/ws/openspec/changes/add-a", "prepend=true → prompt 在前");

  const noModel = deliverPayloadOf({ ...entry, button: { name: "B1", prompt: "执行" } });
  assert.equal("model" in noModel.payload, false, "未绑模型 → payload 无 model 键");
  assert.equal(noModel.payload.title, "队列·B1·add-a", "无模型不影响标题");

  assert.deepEqual(deliverPayloadOf({ ...entry, wsId: "  " }), {
    ok: false,
    reason: "delivery-failed",
    message: "条目缺少工作区 id"
  }, "缺工作区 id → delivery-failed");
  assert.deepEqual(deliverPayloadOf({ ...entry, proposalDir: "" }), {
    ok: false,
    reason: "delivery-failed",
    message: "提案目录缺失，无法组装 @引用消息"
  }, "缺目录 → delivery-failed（不产生半截 @引用）");

  assert.equal(queueTitleOf({ proposalId: "add-a", button: { name: "B1" } }), "队列·B1·add-a", "标题含按钮名与提案名");
  assert.equal(SESSION_TITLE_MAX_CHARS, 400, "标题上限 400 码点");
  assert.equal(
    Array.from(queueTitleOf({ proposalId: "x", button: { name: "y".repeat(500) } })).length,
    SESSION_TITLE_MAX_CHARS,
    "标题按码点截断"
  );
}

/* ── 2. 成功链：调用序 + 入参形状（宿主签名照抄） ── */
{
  const controller = makeController();
  const deliver = createQueueDeliverer({ sessionController: controller, agents: null, logger: null });
  assert.deepEqual(await deliver(entry), { ok: true, sessionId: "s-1" }, "全链成功 → {ok, sessionId}");
  assert.deepEqual(
    controller.calls.map((call) => call.method),
    ["create", "selectModel", "rename", "prompt"],
    "调用序 = create → selectModel → rename → prompt"
  );
  assert.deepEqual(controller.calls[0].args, [{ workspaceId: "ws1" }], "create 单对象入参 {workspaceId}");
  assert.deepEqual(
    controller.calls[1].args,
    [{ sessionId: "s-1", provider: "deepseek", model: "deepseek-chat" }],
    "selectModel 入参 = sessionId + 快照模型字段同名透传"
  );
  assert.deepEqual(
    controller.calls[2].args,
    [{ sessionId: "s-1", title: "队列·B1·add-a" }],
    "rename 单对象入参（位置参数形态是 queen adapter 的包装）"
  );

  const promptCall = controller.calls[3];
  assert.equal(promptCall.args.length, 2, "prompt 双参签名 (request, signal)");
  const request = promptCall.args[0];
  assert.deepEqual(Object.keys(request).sort(), ["content", "mode", "requestId", "sessionId"], "prompt 请求体键集");
  assert.equal(request.sessionId, "s-1", "prompt.sessionId");
  assert.equal(request.mode, "queue", "prompt.mode 恒 queue（直投首条消息）");
  assert.match(request.requestId, UUID_RE, "requestId 每次铸造（uuid）");
  assert.deepEqual(
    request.content,
    [{ type: "text", text: "@C:/ws/openspec/changes/add-a\n执行" }],
    "prompt.content = 单文本块（@目录 + prompt）"
  );
  assert.equal(promptCall.args[1]?.aborted, false, "第二参为永不中止的 signal");
  assert.equal(typeof promptCall.args[1]?.addEventListener, "function", "第二参是 AbortSignal 形状");

  /* 未绑模型 → 跳过 selectModel；reasoningEffort 透传。 */
  const noModelController = makeController();
  const noModelEntry = { ...entry, button: { name: "B1", prompt: "执行", prepend: false } };
  assert.deepEqual(
    await createQueueDeliverer({ sessionController: noModelController })(noModelEntry),
    { ok: true, sessionId: "s-1" }
  );
  assert.deepEqual(
    noModelController.calls.map((call) => call.method),
    ["create", "rename", "prompt"],
    "未绑模型 → 不调用 selectModel"
  );

  const effortController = makeController();
  await createQueueDeliverer({ sessionController: effortController })({
    ...entry,
    button: { ...entry.button, model: { provider: "p", model: "m", reasoningEffort: "high" } }
  });
  assert.deepEqual(
    effortController.calls[1].args,
    [{ sessionId: "s-1", provider: "p", model: "m", reasoningEffort: "high" }],
    "reasoningEffort 随快照透传"
  );

  /* 每次投递 requestId 不重复。 */
  const twice = makeController();
  const deliverTwice = createQueueDeliverer({ sessionController: twice });
  await deliverTwice(entry);
  await deliverTwice(entry);
  const ids = twice.calls.filter((call) => call.method === "prompt").map((call) => call.args[0].requestId);
  assert.equal(new Set(ids).size, 2, "每条投递各自铸造 requestId");
}

/* ── 3. 失败码族：服务缺席 / 方法残缺 / 各调用抛错（rename 不阻断） ── */
{
  const absent = await createQueueDeliverer({})(entry);
  assert.equal(absent.reason, "session-controller-unavailable", "服务缺席 → session-controller-unavailable");
  assert.equal(absent.message.includes("sessionController"), true, "失败说明点出会话服务");
  assert.equal(absent.message.includes("create/prompt/selectModel/rename"), true, "逐个报出缺失方法");

  const emptyService = await createQueueDeliverer({ sessionController: {} })(entry);
  assert.equal(emptyService.reason, "session-controller-unavailable", "空对象服务 → 方法残缺同码族");

  const partial = makeController({ omit: ["selectModel"] });
  const partialResult = await createQueueDeliverer({ sessionController: partial })(entry);
  assert.equal(partialResult.reason, "session-controller-unavailable", "缺 selectModel → 方法残缺");
  assert.equal(partialResult.message.includes("selectModel"), true, "缺失方法名可见");
  assert.equal(partial.calls.length, 0, "方法残缺 → 零请求（不半途建空会话）");

  const createThrows = makeController({ createThrows: true });
  const createResult = await createQueueDeliverer({ sessionController: createThrows })(entry);
  assert.deepEqual(createResult, { ok: false, reason: "create-failed", message: "create boom" }, "create 抛错 → create-failed");
  assert.deepEqual(createThrows.calls.map((call) => call.method), ["create"], "create 失败即止（不继续投递）");

  const noSessionId = makeController({ createResult: {} });
  const noSessionIdResult = await createQueueDeliverer({ sessionController: noSessionId })(entry);
  assert.equal(noSessionIdResult.reason, "create-failed", "create 未返回 sessionId → create-failed");
  assert.equal(noSessionId.calls.length, 1, "无 sessionId 即止");

  const modelThrows = makeController({ selectModelThrows: true });
  const modelResult = await createQueueDeliverer({ sessionController: modelThrows })(entry);
  assert.deepEqual(modelResult, { ok: false, reason: "model-unavailable", message: "model boom" }, "selectModel 抛错 → model-unavailable");
  assert.deepEqual(modelThrows.calls.map((call) => call.method), ["create", "selectModel"], "模型失败即止");

  const promptThrows = makeController({ promptThrows: true });
  const promptResult = await createQueueDeliverer({ sessionController: promptThrows })(entry);
  assert.deepEqual(promptResult, { ok: false, reason: "prompt-failed", message: "prompt boom" }, "prompt 抛错 → prompt-failed");
  assert.deepEqual(
    promptThrows.calls.map((call) => call.method),
    ["create", "selectModel", "rename", "prompt"],
    "prompt 是链尾（失败前已建会话/选模型/改名）"
  );

  const warns = [];
  const renameThrows = makeController({ renameThrows: true });
  const renamedResult = await createQueueDeliverer({
    sessionController: renameThrows,
    logger: { warn: (...args) => warns.push(args.join(" ")) }
  })(entry);
  assert.deepEqual(renamedResult, { ok: true, sessionId: "s-1" }, "rename 抛错不阻断投递");
  assert.equal(warns.length, 1, "改名失败告警一次");
  assert.equal(warns[0].includes("改名失败"), true, "告警内容可读");
  assert.equal(renameThrows.calls.some((call) => call.method === "prompt"), true, "改名失败后 prompt 照常");

  const invalid = makeController();
  const invalidResult = await createQueueDeliverer({ sessionController: invalid })({ ...entry, proposalDir: "" });
  assert.equal(invalidResult.reason, "delivery-failed", "payload 不完整 → delivery-failed");
  assert.equal(invalid.calls.length, 0, "payload 不完整 → 零请求");
}

/* ── 4. 冷读：活体优先 → list 摘要 → gone；list 异常返回错误（调度器有界重试） ── */
{
  const live = makeController();
  const readLive = createSessionReader({
    sessionController: live,
    agents: { get: (id) => (id === "s-live" ? { status: "running" } : null) }
  });
  assert.deepEqual(await readLive("s-live"), { ok: true, running: true, waiting: false }, "活体 running");
  assert.equal(live.calls.length, 0, "活体优先 → 零请求（不扫 list）");

  const readIdle = createSessionReader({
    sessionController: makeController(),
    agents: { get: () => ({ status: "idle" }) }
  });
  assert.deepEqual(await readIdle("s-live"), { ok: true, running: false, waiting: false }, "活体 idle");

  const listHit = makeController({ listResult: { items: [{ sessionId: "s-1", running: true }] } });
  const readList = createSessionReader({ sessionController: listHit, agents: { get: () => null } });
  assert.deepEqual(await readList("s-1"), { ok: true, running: true, waiting: false }, "非活体 → list 命中");
  assert.equal(listHit.calls.length, 1, "list 恰一次");
  assert.deepEqual(listHit.calls[0].args[0], {}, "list 入参 = 空对象");
  assert.equal(listHit.calls[0].args[1]?.aborted, false, "list 第二参为永不中止的 signal");
  assert.equal(listHit.calls[0].args.length, 2, "list 双参签名 (request, signal)");

  const listIdle = makeController({ listResult: { items: [{ sessionId: "s-1", running: false }] } });
  const readListIdle = createSessionReader({ sessionController: listIdle, agents: { get: () => null } });
  assert.deepEqual(await readListIdle("s-1"), { ok: true, running: false, waiting: false }, "list 命中 running=false");

  const listMiss = makeController({ listResult: { items: [{ sessionId: "other", running: true }] } });
  const readMiss = createSessionReader({ sessionController: listMiss, agents: { get: () => null } });
  assert.deepEqual(await readMiss("s-1"), { ok: false, gone: true }, "list 未命中 → gone");

  const listBroken = makeController({ listThrows: true });
  const readBroken = createSessionReader({ sessionController: listBroken, agents: { get: () => null } });
  assert.deepEqual(await readBroken("s-1"), { ok: false, error: "list boom" }, "list 抛错 → 错误（保持执行中重试）");
  assert.equal((await readBroken("s-1")).permanent, undefined, "list 异常属临时失败（无永久标记）");

  /* agent 存在但不带 status（如未激活的壳）→ 回落 list。 */
  const statusless = makeController({ listResult: { items: [{ sessionId: "s-1", running: true }] } });
  const readStatusless = createSessionReader({ sessionController: statusless, agents: { get: () => ({}) } });
  assert.deepEqual(await readStatusless("s-1"), { ok: true, running: true, waiting: false }, "无 status → 回落 list");

  /* agents.get 抛错 → 回落 list（不放大为冷读失败）。 */
  const agentsBroken = makeController({ listResult: { items: [{ sessionId: "s-1", running: false }] } });
  const readAgentsBroken = createSessionReader({
    sessionController: agentsBroken,
    agents: { get: () => { throw new Error("agents boom"); } }
  });
  assert.deepEqual(await readAgentsBroken("s-1"), { ok: true, running: false, waiting: false }, "agents.get 抛错 → 回落 list");

  const noService = createSessionReader({ agents: null });
  const noServiceResult = await noService("s-1");
  assert.equal(noServiceResult.ok, false, "服务缺席 → 冷读不可用");
  assert.equal(noServiceResult.error.includes("sessionController.list"), true, "错误说明点出缺失方法");

  const emptyId = makeController();
  const readEmpty = createSessionReader({ sessionController: emptyId, agents: { get: () => null } });
  assert.deepEqual(await readEmpty("  "), { ok: false, gone: true }, "空会话 id → gone");
  assert.equal(emptyId.calls.length, 0, "空 id 零请求");
}

console.log("session-executor-smoke: all assertions passed");
