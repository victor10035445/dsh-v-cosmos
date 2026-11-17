/**
 * 星座动作链路冒烟（add-cosmos-constellation-actions 2.1/4.4 / fix-cosmos-action-draft-block 4.2 /
 * rework：浮动原生窗口设计经宿主槽位核查为结构性死锁后拆除——native 分支呈现归位「关页跳转
 * 原生会话页」，缺省分支翻转为 float（星空保持优先）；spec「点击执行链路（星座模式）」
 * 「autoSend 分流与标记隔离」「浮窗输入器」「发送前编辑呈现设置」）：纯提示词组装、
 * 恒新建（目标 SessionId + 落稿意图）→ 导航、native 关页、降级回落 replace、autoSend
 * 分流到两条标记通道、共享防重入门、失败清理、浮窗标记 TTL 与一次性消费、门控、
 * 双通道标记互不可见。
 * 运行：node test/constellation-actions-smoke.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ACTION_COOLDOWN_MS, PENDING_ACTION_TTL_MS, createActionExecutor, createActionGate, createPendingActionStore, draftMatches } from "../src/actions.mjs";
import {
  FLOAT_MARKER_TTL_MS,
  constellationMessageOf,
  createConstellationExecutor,
  createFloatMarkerStore,
  floatPresentationOf
} from "../src/constellation-actions.mjs";

const group = { wsId: "ws1", wsName: "alpha", wsPath: "C:/proj/alpha" };
const button = { name: "探索新需求", prompt: "请使用 /cosmos-explore 探索新需求并准备发起新提案", autoSend: false, newSession: true };

/* ── 1. 消息 = 纯 prompt（spec 场景「消息为纯提示词」） ── */
{
  assert.equal(constellationMessageOf(button), button.prompt, "消息恰为提示词原文");
  assert.ok(!constellationMessageOf(button).includes("@"), "无 @引用");
  assert.equal(constellationMessageOf({ prompt: "  " }), "  ", "非空判定交给执行器（原文透传）");
  assert.equal(constellationMessageOf(null), "", "无按钮 → 空消息");
  assert.equal(constellationMessageOf({ prompt: 3 }), "", "非字符串 prompt → 空消息");
}

/* ── 2. 缺省分流 = float（rework：星空保持优先；spec「发送前编辑呈现设置」缺省场景）：
    浮窗标记通道登记（targetSessionId + 落稿意图）、**整页保持打开（零关页）**、
    hero 通道零登记 ── */
{
  const calls = [];
  const hero = createPendingActionStore();
  const floats = createFloatMarkerStore();
  const executor = createConstellationExecutor({
    pending: hero,
    floats,
    createSession: async (...args) => {
      calls.push({ kind: "create", argc: args.length, wsId: args[0], group: args[1] });
      return "const-sess-1";
    },
    openSession: (sessionId) => calls.push({ kind: "open", sessionId, armedAtOpen: floats.peek()?.targetSessionId ?? null }),
    closePage: () => calls.push({ kind: "close" }),
    startSession: () => {
      throw new Error("恒新建主路径 MUST NOT 调用 startSession");
    },
    now: () => 10_000
  });
  const result = await executor.run({ button, group });
  assert.equal(result.ok, true);
  assert.equal(result.message, button.prompt, "导航前组装消息 = 纯提示词");
  assert.equal(result.channel, "float", "未勾选 autoSend + 缺省设置 → float 分支（缺省翻转）");
  assert.equal(result.degraded, false);
  assert.equal(result.sessionId, "const-sess-1");
  assert.deepEqual(calls.map((call) => call.kind), ["create", "open"], "恒新建 → 导航（无 startSession、**零关页**——整页保持打开）");
  assert.equal(calls[0].wsId, "ws1", "目标 = 当前钻取星座的工作区");
  assert.equal(calls[0].group, group, "分组（含 wsPath）透传给实现侧做权威解析");
  assert.equal(calls[0].argc, 2, "仅 (workspaceId, group) —— 无 sessionId 形参（宿主缺省恒新建）");
  assert.equal(calls[1].sessionId, "const-sess-1", "导航目标 = 新建会话");
  assert.equal(calls[1].armedAtOpen, "const-sess-1", "标记先于 openSession 登记");
  assert.equal(floats.peek()?.message, button.prompt, "浮窗标记携带组装消息");
  assert.equal(floats.peek()?.submit, false, "浮窗通道不自动提交");
  assert.equal(floats.peek()?.targetSessionId, "const-sess-1", "浮窗标记绑定目标 SessionId");
  assert.equal(floats.peek()?.setDraft, true, "浮窗标记带落稿意图（挂载 setDraft）");
  assert.deepEqual(
    { channel: floats.peek()?.meta?.channel, wsName: floats.peek()?.meta?.wsName, buttonName: floats.peek()?.meta?.buttonName },
    { channel: "float", wsName: "alpha", buttonName: "探索新需求" },
    "浮窗标记 meta 携带分支观测值与标题栏信息"
  );
  assert.equal(hero.peek(), null, "hero 通道零登记（float 分支不进 hero 通道）");
}

/* ── 2b. native 分支（显式 preflight："native"；spec「原生输入器呈现」rework 版）：
    hero 通道只落稿（submit:false）+ 目标 SessionId → openSession 后 **closePage**
    （关整页、原生会话页 composer 承载，与提案动作「执行后跳转」同构）；浮窗通道零登记 ── */
{
  const calls = [];
  const hero = createPendingActionStore();
  const floats = createFloatMarkerStore();
  const executor = createConstellationExecutor({
    pending: hero,
    floats,
    preflight: () => "native",
    createSession: async (...args) => {
      calls.push({ kind: "create", argc: args.length, wsId: args[0], group: args[1] });
      return "native-sess-1";
    },
    openSession: (sessionId) => calls.push({ kind: "open", sessionId, armedAtOpen: hero.peek()?.targetSessionId ?? null }),
    closePage: () => calls.push({ kind: "close" }),
    startSession: () => {
      throw new Error("恒新建主路径 MUST NOT 调用 startSession");
    },
    now: () => 10_500
  });
  const result = await executor.run({ button, group });
  assert.equal(result.ok, true);
  assert.equal(result.channel, "preflight", "显式 native → preflight 通道收口");
  assert.deepEqual(calls.map((call) => call.kind), ["create", "open", "close"], "恒新建 → 导航 → **关整页**（原生会话页承载呈现）");
  assert.equal(hero.peek()?.message, button.prompt, "hero 标记携带组装消息");
  assert.equal(hero.peek()?.submit, false, "native 分支不提交（落稿即所见，发送由原生输入区承担）");
  assert.equal(hero.peek()?.targetSessionId, "native-sess-1", "hero 标记绑定目标 SessionId");
  assert.equal(hero.peek()?.setDraft, true, "hero 标记带落稿意图（消费相位 setDraft）");
  assert.equal(hero.peek()?.meta?.channel, "preflight", "hero 标记 meta.channel = preflight");
  assert.equal(floats.peek(), null, "浮窗通道零登记（native 分支不呈现浮窗）");

  /* 绑定模型随标记登记（spec 场景「绑定模型先切后呈现」）：submit 意图仍为 false，
     消费相位（hero 既有机制）先切模型再落稿呈现，切换失败 toast 不阻断。 */
  const modelHero = createPendingActionStore();
  const modelled = createConstellationExecutor({
    pending: modelHero,
    floats: createFloatMarkerStore(),
    preflight: () => "native",
    createSession: async () => "const-model-sess",
    openSession: () => {},
    closePage: () => {},
    now: () => 11_000
  });
  const withModel = await modelled.run({
    button: { ...button, model: { provider: "deepseek", model: "deepseek-chat", reasoningEffort: "max" } },
    group
  });
  assert.equal(withModel.channel, "preflight", "绑定模型不改变分支");
  assert.equal(modelHero.peek()?.submit, false, "绑定模型不改变 submit 意图（仍只落稿）");
  assert.deepEqual(
    modelHero.peek()?.model,
    { provider: "deepseek", model: "deepseek-chat", reasoningEffort: "max" },
    "模型绑定随 native 标记（hero 相位先切后呈现）"
  );
}

/* ── 2c. 显式 float 分支（设置注入直读；行为与缺省一致——零关页、浮窗通道） ── */
{
  const calls = [];
  const floats = createFloatMarkerStore();
  const executor = createConstellationExecutor({
    pending: createPendingActionStore(),
    floats,
    preflight: () => "float",
    createSession: async () => "const-sess-2",
    openSession: (sessionId) => calls.push("open:" + sessionId),
    closePage: () => calls.push("close"),
    startSession: () => calls.push("start"),
    now: () => 12_000
  });
  const result = await executor.run({ button, group });
  assert.equal(result.ok, true);
  assert.equal(result.channel, "float", "设置 float → 浮窗通道");
  assert.deepEqual(calls, ["open:const-sess-2"], "整页保持打开（零 closePage）");
  assert.equal(floats.peek()?.message, button.prompt, "浮窗标记携带组装消息");
  assert.equal(floats.peek()?.submit, false, "浮窗通道不自动提交");
  assert.equal(floats.peek()?.targetSessionId, "const-sess-2", "浮窗标记绑定目标 SessionId");
  assert.equal(floats.peek()?.setDraft, true, "浮窗标记带落稿意图（挂载 setDraft）");
  assert.equal(floats.peek()?.meta?.channel, "float", "浮窗标记 meta.channel = float");
}

/* ── 3. autoSend 分流到 hero 通道（spec「autoSend 分流与标记隔离」） ── */
{
  const hero = createPendingActionStore();
  const floats = createFloatMarkerStore();
  const seen = [];
  const executor = createConstellationExecutor({
    pending: hero,
    floats,
    createSession: async () => "hero-sess",
    openSession: (sessionId) => seen.push("open:" + sessionId),
    closePage: () => seen.push("close"),
    startSession: () => seen.push("start"),
    now: () => 20_000
  });
  const auto = await executor.run({
    button: { ...button, autoSend: true, model: { provider: "deepseek", model: "deepseek-chat", reasoningEffort: "max" } },
    group
  });
  assert.equal(auto.ok, true);
  assert.equal(auto.channel, "hero", "勾选 autoSend → hero 通道");
  assert.deepEqual(seen, ["open:hero-sess"], "恒新建后仅导航（零 startSession、零关页——autoSend 分支整页保持）");
  assert.equal(hero.peek()?.submit, true, "hero 标记携带提交意图");
  assert.equal(hero.peek()?.targetSessionId, "hero-sess", "hero 标记绑定目标 SessionId");
  assert.equal(hero.peek()?.setDraft, true, "hero 标记带落稿意图（hero 相位 setDraft 后提交）");
  assert.deepEqual(hero.peek()?.model, { provider: "deepseek", model: "deepseek-chat", reasoningEffort: "max" }, "模型三元组随 hero 标记");
  assert.equal(hero.peek()?.meta?.channel, "hero", "autoSend meta.channel = hero");
  assert.equal(floats.peek(), null, "浮窗通道零标记（分流互斥）");
  /* autoSend 分支不读设置面（分支判定短路口径），注入 float 也不影响 hero 提交语义。 */
  const floatPrefHero = createPendingActionStore();
  const floatPrefExecutor = createConstellationExecutor({
    pending: floatPrefHero,
    floats,
    preflight: () => "float",
    createSession: async () => "hero-sess-2",
    openSession: () => {},
    now: () => 21_000
  });
  const floatPref = await floatPrefExecutor.run({ button: { ...button, autoSend: true }, group });
  assert.equal(floatPref.channel, "hero", "设置 float 不影响 autoSend 分支");
  assert.equal(floatPrefHero.peek()?.submit, true, "autoSend 分支仍提交");
}

/* ── 3b. 独立窗口服务端送达通道（add-cosmos-standalone-jump-feedback D1/D3） ──
   只承接 autoSend 分支：startSession 服务端落稿、不自动提交、不登记标记、模型切换不执行；
   float / native 分支分流不变（native 意图被改写由注入方 preflight 反馈）。 */
{
  /* autoSend + 通道开启：startSession → 注入方反馈；零 create/open/标记/关页 */
  {
    const hero = createPendingActionStore();
    const floats = createFloatMarkerStore();
    const calls = [];
    const notices = [];
    const executor = createConstellationExecutor({
      pending: hero,
      floats,
      standaloneServerChannel: true,
      standaloneNotice: (info) => notices.push(info),
      createSession: async () => {
        calls.push("create");
        return "never";
      },
      openSession: () => calls.push("open"),
      closePage: () => calls.push("close"),
      startSession: async (wsId, message, groupArg) => calls.push({ kind: "start", wsId, message, wsGroup: groupArg }),
      now: () => 25_000
    });
    const auto = await executor.run({
      button: { ...button, autoSend: true, model: { provider: "deepseek", model: "deepseek-chat" } },
      group
    });
    assert.equal(auto.ok, true);
    assert.equal(auto.standalone, true, "结果注明独立窗口通道");
    assert.equal(auto.serverDraft, true, "落稿由 startSession 服务端承担");
    assert.equal(auto.channel, "standalone-server", "通道观测值 = standalone-server");
    assert.equal(auto.autoSendSkipped, true, "autoSend 未执行（提交依赖窗口内输入区）");
    assert.equal(auto.modelSkipped, true, "模型切换未执行");
    assert.equal(auto.marker, null, "不登记标记（零返回标记）");
    assert.deepEqual(calls.map((call) => (typeof call === "string" ? call : call.kind)), ["start"], "只走 startSession（零 create、零 openSession、零关页）");
    assert.equal(calls[0].wsId, "ws1", "startSession 收到工作区 id（replace 语义由注入方承担）");
    assert.equal(calls[0].message, auto.message, "startSession 收到纯提示词消息");
    assert.equal(calls[0].wsGroup, group, "startSession 收到钻取分组（实现侧解析权威 id）");
    assert.deepEqual(notices, [{ autoSend: true }], "通道成功后通知注入方（执行器不感知文案）");
    assert.equal(hero.peek(), null, "hero 通道零标记（登记恒悬空）");
    assert.equal(floats.peek(), null, "浮窗通道零标记（分流互斥）");
  }

  /* 通道开启但未勾选 autoSend：float 分支分流不变（create → open，零关页、零 startSession） */
  {
    const hero = createPendingActionStore();
    const floats = createFloatMarkerStore();
    const calls = [];
    const executor = createConstellationExecutor({
      pending: hero,
      floats,
      standaloneServerChannel: true,
      preflight: () => "float",
      createSession: async () => "float-sess",
      openSession: (sessionId) => calls.push("open:" + sessionId),
      closePage: () => calls.push("close"),
      startSession: () => calls.push("start"),
      now: () => 26_000
    });
    const floatRun = await executor.run({ button, group });
    assert.equal(floatRun.ok, true);
    assert.equal(floatRun.channel, "float", "float 分支分流不变");
    assert.deepEqual(calls, ["open:float-sess"], "恒新建 → 导航（零关页、零 startSession）");
    assert.equal(floats.peek()?.targetSessionId, "float-sess", "浮窗标记按既有语义登记");
  }

  /* 通道开启但未勾选 autoSend：native 分支分流不变（create → open → close） */
  {
    const hero = createPendingActionStore();
    const floats = createFloatMarkerStore();
    const calls = [];
    const executor = createConstellationExecutor({
      pending: hero,
      floats,
      standaloneServerChannel: true,
      preflight: () => "native",
      createSession: async () => "native-sess",
      openSession: () => calls.push("open"),
      closePage: () => calls.push("close"),
      startSession: () => calls.push("start"),
      now: () => 27_000
    });
    const nativeRun = await executor.run({ button, group });
    assert.equal(nativeRun.ok, true);
    assert.equal(nativeRun.channel, "preflight", "native 分支分流不变");
    assert.deepEqual(calls, ["open", "close"], "恒新建 → 导航 → 关页");
  }

  /* startSession 失败 → start-failed（零标记、零关页、toast） */
  {
    const hero = createPendingActionStore();
    const calls = [];
    const executor = createConstellationExecutor({
      pending: hero,
      floats: createFloatMarkerStore(),
      standaloneServerChannel: true,
      createSession: async () => "never",
      openSession: () => calls.push("open"),
      startSession: async () => {
        throw new Error("host refused");
      },
      closePage: () => calls.push("close"),
      notify: (text, isError) => calls.push({ kind: "notify", text, isError }),
      now: () => 28_000
    });
    const failed = await executor.run({ button: { ...button, autoSend: true }, group });
    assert.equal(failed.ok, false);
    assert.equal(failed.reason, "start-failed");
    assert.equal(failed.standalone, true, "失败结果同样注明通道口径");
    assert.deepEqual(calls.map((call) => (typeof call === "string" ? call : call.kind)), ["notify"], "失败 toast、零关页");
    assert.equal(hero.peek(), null, "失败不登记标记");
  }

  /* 缺省关闭：autoSend 行为逐字不变（hero 通道 + 标记提交；零 startSession） */
  {
    const hero = createPendingActionStore();
    const calls = [];
    const executor = createConstellationExecutor({
      pending: hero,
      floats: createFloatMarkerStore(),
      createSession: async () => "hero-default",
      openSession: () => calls.push("open"),
      startSession: () => calls.push("start"),
      now: () => 29_000
    });
    const auto = await executor.run({ button: { ...button, autoSend: true }, group });
    assert.equal(auto.channel, "hero", "缺省关闭 → 既有 hero 通道（行为逐字不变）");
    assert.equal(auto.standalone, undefined, "无通道标记");
    assert.deepEqual(calls, ["open"], "恒新建 → 导航（零 startSession）");
    assert.equal(hero.peek()?.submit, true, "既有提交意图登记不变");
  }
}

/* ── 4. 双通道标记隔离（spec 场景「标记互不误食」） ── */
{
  const hero = createPendingActionStore();
  const floats = createFloatMarkerStore();
  hero.arm({ message: "hero 消息", submit: true });
  assert.equal(floats.read(), null, "浮窗通道读不到 hero 标记");
  hero.clear();
  floats.arm({ message: "浮窗消息", submit: false });
  assert.equal(hero.read(), null, "hero 通道读不到浮窗标记");
  assert.equal(floats.read()?.message, "浮窗消息", "浮窗标记只在本通道可见");
  /* 清浮窗标记不影响 hero 通道（各消费器零清除）。 */
  const heroEntry = hero.arm({ message: "hero 2", submit: true });
  floats.clear();
  assert.equal(hero.read()?.token, heroEntry.token, "清浮窗通道不清 hero 标记");
}

/* ── 5. 共享防重入门（spec 场景「防重入」：两族按钮同门） ── */
{
  const gate = createActionGate({ now: () => 1_000 });
  const hero = createPendingActionStore();
  const floats = createFloatMarkerStore();
  const starts = [];
  const constExecutor = createConstellationExecutor({
    pending: hero,
    floats,
    gate,
    startSession: () => starts.push("const")
  });
  const proposalExecutor = createActionExecutor({
    pending: hero,
    gate,
    startSession: () => starts.push("proposal"),
    closePage: () => {}
  });
  const constCard = { wsId: "ws1", wsPath: "C:/proj/alpha", dir: "C:/proj/alpha/openspec/changes/x" };

  assert.equal((await constExecutor.run({ button, group })).ok, true);
  assert.equal(starts.length, 1);
  /* 同一时刻（冷却窗内）点提案动作按钮 → busy，不发起第二次会话创建。 */
  const blocked = await proposalExecutor.run({ button, card: constCard });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "busy", "星座链路运行后提案动作按钮被同门忽略");
  const constBlocked = await constExecutor.run({ button, group });
  assert.equal(constBlocked.reason, "busy", "冷却窗内重复点击星座按钮被忽略");
  assert.equal(starts.length, 1, "未发起第二次会话创建");

  /* 三分支共享同一冷却门（add-cosmos-native-composer 2.4）：native 运行窗内，
     float / autoSend 分支点击同样 busy，不发起第二次会话创建。 */
  const floatOnSharedGate = createConstellationExecutor({
    pending: hero,
    floats,
    gate,
    preflight: () => "float",
    startSession: () => starts.push("float")
  });
  const autoOnSharedGate = createConstellationExecutor({
    pending: hero,
    floats,
    gate,
    startSession: () => starts.push("auto")
  });
  assert.equal((await floatOnSharedGate.run({ button, group })).reason, "busy", "native 运行窗内 float 分支被同门忽略");
  assert.equal((await autoOnSharedGate.run({ button: { ...button, autoSend: true }, group })).reason, "busy", "native 运行窗内 autoSend 分支被同门忽略");
  assert.equal(starts.length, 1, "三分支共享门：窗内零额外会话创建");

  /* 冷却窗外两族均可执行（同门只挡窗内重复）。 */
  let clock = 1_000 + ACTION_COOLDOWN_MS + 1;
  const gate2 = createActionGate({ now: () => clock });
  const executorA = createConstellationExecutor({ pending: hero, floats, gate: gate2, startSession: () => starts.push("const2") });
  const executorB = createActionExecutor({ pending: hero, gate: gate2, startSession: () => starts.push("proposal2"), closePage: () => {} });
  assert.equal((await executorA.run({ button, group })).ok, true);
  clock += ACTION_COOLDOWN_MS + 1;
  assert.equal((await executorB.run({ button, card: constCard })).ok, true, "冷却窗过后提案动作可执行");
}

/* ── 6. 失败、降级与边界：清标记、关页只听 native 分支（D4）、无目标/无按钮/不可用 ── */
{
  const floats = createFloatMarkerStore();
  const notices = [];
  const failCalls = [];
  const failing = createConstellationExecutor({
    pending: createPendingActionStore(),
    floats,
    preflight: () => "float",
    createSession: async () => "fail-sess",
    openSession: () => {
      throw new Error("navigation lost");
    },
    closePage: () => failCalls.push("close"),
    startSession: () => {},
    notify: (text, isError) => notices.push({ text, isError }),
    now: () => 30_000
  });
  const failed = await failing.run({ button, group });
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, "start-failed");
  assert.equal(floats.peek(), null, "失败清除本链路标记");
  assert.deepEqual(failCalls, [], "失败不关页（float 分支）");
  assert.ok(notices.some((notice) => notice.isError === true && notice.text.includes("创建会话失败")), "失败 toast");

  /* 降级路径（createSession 抛错）+ float：toast 注明 + 回落 startSession（replace 由注入方承担）
     + 整页保持（旧行为逐字） */
  const degradeFloats = createFloatMarkerStore();
  const degradeCalls = [];
  const notifying = [];
  const degrading = createConstellationExecutor({
    pending: createPendingActionStore(),
    floats: degradeFloats,
    preflight: () => "float",
    createSession: async () => {
      throw new Error("host refused");
    },
    openSession: () => degradeCalls.push("open"),
    closePage: () => degradeCalls.push("close"),
    startSession: (wsId, message, groupArg) => degradeCalls.push({ kind: "start", wsId, message, group: groupArg }),
    notify: (text) => notifying.push(text),
    now: () => 35_000
  });
  const degraded = await degrading.run({ button, group });
  assert.equal(degraded.ok, true, "降级仍执行成功（行为 = 今日 replace 链路）");
  assert.equal(degraded.degraded, true, "结果注明降级");
  assert.equal(degraded.channel, "float", "float 分支降级仍走浮窗通道");
  assert.deepEqual(degradeCalls.map((call) => (typeof call === "string" ? call : call.kind)), ["start"], "降级只走 startSession（零 openSession、零关页）");
  assert.equal(degradeCalls[0].message, button.prompt);
  assert.ok(notifying.some((text) => /已降级/.test(text)), "降级 toast 注明");
  assert.equal(degradeFloats.peek()?.targetSessionId, null, "降级标记无 SessionId 判据");
  assert.equal(degradeFloats.peek()?.setDraft, false, "降级标记无落稿意图（startSession 已落稿）");

  /* 降级路径 + native：导航（startSession）后**关页**（与主路径呈现收敛于原生会话页），
     hero 标记只落稿；浮窗标记 MUST NOT 登记。 */
  const nativeDegradeHero = createPendingActionStore();
  const nativeDegradeFloats = createFloatMarkerStore();
  const nativeDegradeCalls = [];
  const nativeDegrading = createConstellationExecutor({
    pending: nativeDegradeHero,
    floats: nativeDegradeFloats,
    preflight: () => "native",
    createSession: async () => {
      throw new Error("host refused");
    },
    openSession: () => nativeDegradeCalls.push("open"),
    closePage: () => nativeDegradeCalls.push("close"),
    startSession: () => nativeDegradeCalls.push("start"),
    now: () => 36_000
  });
  const nativeDegraded = await nativeDegrading.run({ button, group });
  assert.equal(nativeDegraded.ok, true);
  assert.equal(nativeDegraded.degraded, true, "降级标注保留");
  assert.equal(nativeDegraded.channel, "preflight", "native 分支降级仍按 native 通道收口");
  assert.deepEqual(nativeDegradeCalls, ["start", "close"], "native 降级：startSession 导航后关页（与主路径呈现收敛）");
  assert.equal(nativeDegradeHero.peek()?.submit, false, "native 降级 hero 标记 submit:false（不自动提交）");
  assert.equal(nativeDegradeHero.peek()?.targetSessionId, null, "降级标记无 SessionId 判据");
  assert.equal(nativeDegradeHero.peek()?.setDraft, false, "降级标记无落稿意图（startSession 已落稿）");
  assert.equal(nativeDegradeFloats.peek(), null, "native 分支降级不登记浮窗标记");

  /* 「未提供新建通道」（canCreateNew=false）+ native：降级同样关页 */
  const noVerbCalls = [];
  const noVerbNative = createConstellationExecutor({
    pending: createPendingActionStore(),
    floats: createFloatMarkerStore(),
    preflight: () => "native",
    startSession: () => noVerbCalls.push("start"),
    closePage: () => noVerbCalls.push("close"),
    now: () => 37_000
  });
  assert.equal((await noVerbNative.run({ button, group })).degraded, true);
  assert.deepEqual(noVerbCalls, ["start", "close"], "无新建通道降级：native 同样关页");

  /* autoSend 分支降级保持整页（不关页） */
  const autoDegradeCalls = [];
  const autoDegrading = createConstellationExecutor({
    pending: createPendingActionStore(),
    floats: createFloatMarkerStore(),
    createSession: async () => {
      throw new Error("host refused");
    },
    openSession: () => autoDegradeCalls.push("open"),
    closePage: () => autoDegradeCalls.push("close"),
    startSession: () => autoDegradeCalls.push("start"),
    now: () => 38_000
  });
  assert.equal((await autoDegrading.run({ button: { ...button, autoSend: true }, group })).degraded, true);
  assert.deepEqual(autoDegradeCalls, ["start"], "autoSend 分支降级保持整页打开（零关页）");

  const quiet = [];
  const noTarget = createConstellationExecutor({ floats, startSession: () => quiet.push("start") });
  assert.equal((await noTarget.run({ button, group: null })).reason, "no-target", "无分组 → 不执行");
  assert.equal((await noTarget.run({ button, group: { wsId: "" } })).reason, "no-target", "分组无 wsId → 不执行");
  assert.equal((await noTarget.run({ button: { prompt: "   " }, group })).reason, "no-button", "空提示词 → 不执行");
  assert.deepEqual(quiet, [], "无效输入零会话创建");

  const unavailableNotice = [];
  const noVerb = createConstellationExecutor({ floats, notify: (text, isError) => unavailableNotice.push({ text, isError }) });
  const unavailable = await noVerb.run({ button, group });
  assert.equal(unavailable.reason, "unavailable");
  assert.equal(floats.peek(), null, "宿主动词缺席不留标记");
  assert.ok(unavailableNotice.some((notice) => notice.isError === true), "不可用 toast");

  /* 通道缺失（装配错误）→ unavailable，不半执行。 */
  const noChannel = createConstellationExecutor({ startSession: () => quiet.push("start") });
  assert.equal((await noChannel.run({ button, group })).reason, "unavailable");
  assert.deepEqual(quiet, [], "通道缺失不创建会话");
}

/* ── 7. 浮窗标记 TTL 与一次性消费（spec「过期安全失败」「编辑不因过期中断」静态面） ── */
{
  let clock = 0;
  const floats = createFloatMarkerStore({ now: () => clock });
  assert.equal(FLOAT_MARKER_TTL_MS, 10_000, "浮窗标记呈现窗口 10s");
  assert.equal(PENDING_ACTION_TTL_MS, FLOAT_MARKER_TTL_MS, "与 hero 通道同量级（语义不同的只有消费时机）");
  const entry = floats.arm({ message: "m", submit: false });
  assert.equal(floats.read()?.token, entry.token, "窗口内可读");
  /* 挂载即消费：一次性（带 token 清除），之后编辑再久也不受 TTL 影响。 */
  assert.equal(floats.clear(entry.token), true, "挂载消费");
  assert.equal(floats.clear(entry.token + 1), false, "重复清除 no-op");
  clock += FLOAT_MARKER_TTL_MS * 10;
  assert.equal(floats.read(), null, "消费后无标记（浮窗显隐由自身打开态驱动）");

  /* 呈现前过期 → 静默丢弃（草稿保留在会话里）。 */
  const expired = createFloatMarkerStore({ now: () => clock });
  expired.arm({ message: "m2" });
  clock += FLOAT_MARKER_TTL_MS + 1;
  assert.equal(expired.read(), null, "呈现窗口过期 → null（不呈现浮窗，不报错）");
}

/* ── 8. 草稿等校验复用 hero 口径（浮窗门控用） ── */
{
  assert.equal(draftMatches("提示词", "提示词"), true);
  assert.equal(draftMatches("别的草稿", "提示词"), false, "不一致 → 不呈现浮窗、不清标记");
}

/* ── 8. 浮窗呈现门控（纯函数；spec「浮窗输入器」门控 + 场景「挂载落稿即呈现」）
   「会话不匹配不呈现」「草稿非空不改写不呈现」 ── */
{
  const entry = { token: 1, message: "提示词", submit: false, model: null, meta: null, at: 0 };
  const bound = { ...entry, targetSessionId: "sess-A", setDraft: true };
  const open = { openState: "open", blank: true, running: false, promptAttempted: false };
  assert.deepEqual(
    floatPresentationOf({ entry, session: open, draft: "提示词" }),
    { present: true, fill: false, reason: "ok" },
    "门控全通过"
  );
  assert.equal(floatPresentationOf({ entry: null, session: open, draft: "提示词" }).reason, "no-marker", "无标记（含过期已丢弃）→ 不呈现");
  assert.equal(floatPresentationOf({ entry, session: null, draft: "提示词" }).present, false, "会话缺失 → 不呈现");
  for (const [patch, label] of [
    [{ openState: "loading" }, "会话未打开"],
    [{ openState: "cold" }, "冷会话"],
    [{ blank: false }, "非 blank（已有回合）"],
    [{ running: true }, "运行中（提交相位窗口）"]
  ]) {
    assert.deepEqual(
      floatPresentationOf({ entry, session: { ...open, ...patch }, draft: "提示词" }),
      { present: false, fill: false, reason: "session" },
      "门控：" + label
    );
  }
  assert.deepEqual(
    floatPresentationOf({ entry, session: open, draft: "用户旧草稿" }),
    { present: false, fill: false, reason: "draft" },
    "草稿不一致 → 不呈现（标记保留，等正确会话或过期）"
  );
  assert.equal(floatPresentationOf({ entry, session: open, draft: "提示词  \r\n" }).present, true, "草稿归一化后一致 → 呈现");
  assert.equal(floatPresentationOf({}).present, false, "空输入 → 不呈现（不抛错）");

  /* 恒新建口径（fix-cosmos-action-draft-block 3.2）：会话 id 判据 + 空稿落稿 */
  assert.deepEqual(
    floatPresentationOf({ entry: bound, session: open, draft: "", sessionId: "sess-B" }),
    { present: false, fill: false, reason: "session-id" },
    "无关 blank（id 不符）→ 零落稿零呈现"
  );
  assert.equal(floatPresentationOf({ entry: bound, session: open, draft: "提示词", sessionId: "sess-A" }).present, true, "id 匹配 + 草稿一致 → 呈现");
  assert.deepEqual(
    floatPresentationOf({ entry: bound, session: open, draft: "   ", sessionId: "sess-A" }),
    { present: false, fill: true, reason: "fill" },
    "空稿 + 落稿意图 → 先落稿（下一轮再呈现）"
  );
  assert.equal(
    floatPresentationOf({ entry: { ...bound, setDraft: false }, session: open, draft: "", sessionId: "sess-A" }).fill,
    false,
    "无落稿意图（降级）空稿 → 不填"
  );
  assert.deepEqual(
    floatPresentationOf({ entry: bound, session: open, draft: "旧草稿", sessionId: "sess-A" }),
    { present: false, fill: false, reason: "draft" },
    "id 匹配但草稿非空不一致 → 不改写不呈现"
  );
}

/* ── 9. 「发送前编辑」分支解析兜底（rework：缺省翻转后兜底方向反转）：只认显式 `"native"`；
   缺注入 / 抛错 / 漂移值一律 float（星空保持优先——保守方向 = 不关页）；SHALL NOT 抛错、
   解析器每次 run 现读（设置保存即时生效） ── */
{
  const cases = [
    { preflight: undefined, label: "缺注入", native: false },
    { preflight: () => "native", label: "显式 native", native: true },
    { preflight: () => undefined, label: "解析 undefined", native: false },
    { preflight: () => null, label: "解析 null", native: false },
    { preflight: () => "auto", label: "漂移值 auto", native: false },
    { preflight: () => 123, label: "非字符串 123", native: false },
    { preflight: () => { throw new Error("boom"); }, label: "解析抛错", native: false }
  ];
  for (const item of cases) {
    const hero = createPendingActionStore();
    const floats = createFloatMarkerStore();
    const closed = [];
    const executor = createConstellationExecutor({
      pending: hero,
      floats,
      preflight: item.preflight,
      createSession: async () => "pf-sess",
      openSession: () => {},
      closePage: () => closed.push("close"),
      now: () => 40_000
    });
    const result = await executor.run({ button, group });
    assert.equal(result.ok, true, "兜底不阻断执行：" + item.label);
    if (item.native) {
      assert.equal(result.channel, "preflight", item.label + " → 显式 native 分支");
      assert.equal(hero.peek()?.submit, false, item.label + " → hero 标记 submit:false");
      assert.equal(floats.peek(), null, item.label + " → 浮窗通道零登记");
      assert.deepEqual(closed, ["close"], item.label + " → openSession 后关整页（原生会话页承载）");
    } else {
      assert.equal(result.channel, "float", item.label + " → 按缺省 float 分支（保守方向不关页）");
      assert.equal(floats.peek()?.targetSessionId, "pf-sess", item.label + " → 浮窗标记在册");
      assert.equal(hero.peek(), null, item.label + " → hero 通道零登记");
      assert.deepEqual(closed, [], item.label + " → 整页保持打开");
    }
  }

  /* 现读（非构造期缓存）：同一执行器内解析值切换，下一次 run 即按新分支。 */
  let mode = "native";
  let clock = 50_000;
  const liveGate = createActionGate({ now: () => clock });
  const liveHero = createPendingActionStore();
  const liveFloats = createFloatMarkerStore();
  const liveClosed = [];
  const live = createConstellationExecutor({
    pending: liveHero,
    floats: liveFloats,
    gate: liveGate,
    preflight: () => mode,
    createSession: async () => "live-sess",
    openSession: () => {},
    closePage: () => liveClosed.push("close"),
    now: () => clock
  });
  const first = await live.run({ button, group });
  assert.equal(first.channel, "preflight", "切换前 → native 分支");
  assert.equal(liveHero.peek()?.targetSessionId, "live-sess", "切换前登记 hero 标记（submit:false）");
  assert.deepEqual(liveClosed, ["close"], "切换前 native 分支关页（原生会话页承载呈现）");
  liveHero.clear();
  mode = "float";
  clock += ACTION_COOLDOWN_MS + 1;
  const second = await live.run({ button, group });
  assert.equal(second.channel, "float", "设置切 float 后下一次点击即按新分支（每次 run 现读）");
  assert.deepEqual(liveClosed, ["close"], "float 分支不再关页（关页计数不变）");
  assert.equal(liveFloats.peek()?.targetSessionId, "live-sess", "float 分支登记浮窗通道");
  assert.equal(liveHero.peek(), null, "float 分支零 hero 标记");
}

/* ── 10. 静态面：链路不触碰文件系统 / 不引用契约工件 / 关页唯一收口在 native 分支 ── */
{
  const source = readFileSync(new URL("../src/constellation-actions.mjs", import.meta.url), "utf8");
  assert.ok(!/node:fs/.test(source), "链路纯逻辑不触碰文件系统（无 openspec 工件写入路径）");
  assert.ok(!/assembleMessage|proposalDirOf/.test(source), "星座链路不含 @提案目录组装");
  /* 关页入口唯一且只被 native 分支经 settlePage 调用（主路径 + 两条降级路径同收口） */
  assert.equal((source.match(/closePage\(\);/g) ?? []).length, 1, "关页调用点唯一（settlePage 内）");
  assert.ok(/const settlePage = \(\) => \{\s*if \(native\) closePage\(\);/.test(source), "关页仅 native 分支生效（float / autoSend 分支整页保持）");
  assert.equal((source.match(/settlePage\(\);/g) ?? []).length, 3, "主路径 + 两条降级路径共三处 settlePage 收口");
  assert.ok(source.includes('preflight() === "native" ? "native" : "float"'), "分支解析兜底：只认显式 native，其余按缺省 float");
  assert.ok(source.includes('export const PREFLIGHT_CHANNEL = "preflight";'), "preflight 通道观测常量保留");
  assert.ok(!/natives|windowMarker|nativeWindowOf/.test(source), "浮动原生窗口呈现通道零残留（死槽位实现已拆除）");
}

/* ── 11. 标记通道变更订阅（常驻 dock 的重新门控信号，spec「取消保留草稿」后再次点击） ── */
{
  const floats = createFloatMarkerStore();
  const seen = [];
  const off = floats.subscribe(() => seen.push(floats.getVersion()));
  const base = floats.getVersion();
  const entry = floats.arm({ message: "m" });
  assert.equal(floats.getVersion(), base + 1, "arm 触发版本递增（新标记 → 重新门控）");
  assert.deepEqual(seen, [base + 1], "订阅者收到通知");
  assert.equal(floats.clear(entry.token), true);
  assert.equal(floats.getVersion(), base + 2, "clear 触发版本递增");
  assert.equal(floats.clear(entry.token), false, "无效清除不通知");
  assert.equal(floats.getVersion(), base + 2);
  off();
  floats.arm({ message: "m2" });
  assert.equal(seen.length, 2, "退订后不再通知");

  /* 两通道版本互不影响（隔离不靠字段分流）。 */
  const hero = createPendingActionStore();
  let heroNotified = 0;
  hero.subscribe(() => {
    heroNotified += 1;
  });
  floats.arm({ message: "x" });
  assert.equal(heroNotified, 0, "浮窗 arm 不通知 hero 通道");
  assert.ok(typeof floats.subscribe === "function" && typeof floats.getVersion === "function", "store 订阅面齐备");
}

console.log("constellation-actions-smoke: all assertions passed");
