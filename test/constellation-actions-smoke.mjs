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
  FLOAT_ATTACH_WATCH_MS,
  FLOAT_IMAGE_ACCEPT,
  FLOAT_IMAGE_TYPES,
  FLOAT_MARKER_TTL_MS,
  clipboardFilesOf,
  constellationMessageOf,
  createAttachFace,
  createConstellationExecutor,
  createFloatMarkerStore,
  floatAttachmentsPendingOf,
  floatImagesOf,
  floatPresentationOf,
  floatSendPlanOf,
  floatWatchOutcomeOf,
  intakeFloatImages,
  isFloatImageType,
  promptFailureTextOf,
  removeFloatAttachment
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
        assert.deepEqual(calls, ["open"], "恒新建 → 导航（零 startSession）");
    assert.equal(hero.peek()?.submit, true, "既有提交意图登记不变");
  }

/* ── 3b. 团队意图登记（add-cosmos-agent-team-toggle 4.2/4.4 / spec
   cosmos-constellation-actions「星座执行链路团队意图登记」）：登记先于标记与 openSession、
   autoSend 等待 / float·native 非等待、三分支同一登记时点、缺席 toast 一次、未勾选与降级零行为 ── */
{
  const makeExecutor = (options = {}) => createConstellationExecutor({
    pending: createPendingActionStore(),
    floats: createFloatMarkerStore(),
    createSession: async () => "team-sess",
    openSession: () => {},
    closePage: () => {},
    now: () => 900_000,
    ...options
  });

  /* autoSend 等待落地 + 登记先于标记（arm 时标记仍为空）。 */
  {
    const order = [];
    const hero = createPendingActionStore();
    let releaseTeam;
    const executor = createConstellationExecutor({
      pending: hero,
      floats: createFloatMarkerStore(),
      createSession: async () => {
        order.push("create");
        return "team-auto";
      },
      armTeamIntent: ({ sessionId }) => {
        order.push("team:" + sessionId);
        assert.equal(hero.peek(), null, "团队登记先于标记登记");
        return new Promise((resolve) => {
          releaseTeam = () => resolve({ ok: true, serviceAvailable: true });
        });
      },
      openSession: (sessionId) => order.push("open:" + sessionId),
      now: () => 910_000
    });
    const running = executor.run({ button: { ...button, autoSend: true, team: true }, group });
    await new Promise((done) => setTimeout(done, 10));
    assert.deepEqual(order, ["create", "team:team-auto"], "autoSend 分支等待登记落地（openSession 未提前）");
    releaseTeam();
    const run = await running;
    assert.equal(run.ok, true);
    assert.equal(run.channel, "hero");
    assert.deepEqual(order, ["create", "team:team-auto", "open:team-auto"], "登记落地后链路照常");
    assert.equal(hero.peek()?.targetSessionId, "team-auto", "标记在团队登记之后登记");
  }

  /* float 分支非等待（登记永不落地也不阻塞）：同一登记时点。 */
  {
    const order = [];
    const executor = makeExecutor({
      armTeamIntent: () => {
        order.push("team");
        return new Promise(() => {}); // 永悬决
      },
      openSession: () => order.push("open"),
      now: () => 920_000
    });
    const run = await executor.run({ button: { ...button, team: true, autoSend: false }, group });
    assert.equal(run.ok, true);
    assert.equal(run.channel, "float");
    assert.deepEqual(order, ["team", "open"], "float 非等待，链路照常");
  }

  /* native 分支同样登记（三分支同一时点）。 */
  {
    const order = [];
    const executor = makeExecutor({
      preflight: () => "native",
      armTeamIntent: ({ sessionId }) => {
        order.push("team:" + sessionId);
        return Promise.resolve({ ok: true, serviceAvailable: true });
      },
      openSession: () => order.push("open"),
      closePage: () => order.push("close"),
      now: () => 930_000
    });
    const run = await executor.run({ button: { ...button, team: true, autoSend: false }, group });
    assert.equal(run.ok, true);
    assert.equal(run.channel, "preflight");
    assert.deepEqual(order, ["team:team-sess", "open", "close"], "native 分支登记 + 关页");
  }

  /* 服务缺席 toast 一次 + 链路照常。 */
  {
    const notices = [];
    const executor = makeExecutor({
      armTeamIntent: async () => ({ ok: false, serviceAvailable: false }),
      notify: (text, isError) => notices.push({ text, isError }),
      labels: { teamUnavailable: "团队不可用（测试）" },
      now: () => 940_000
    });
    const run = await executor.run({ button: { ...button, team: true, autoSend: true }, group });
    assert.equal(run.ok, true);
    assert.equal(notices.length, 1, "缺席 toast 恰一次");
    assert.deepEqual(notices[0], { text: "团队不可用（测试）", isError: true });
  }

  /* 未勾选零行为 + 降级跳过（仅既有降级 toast）。 */
  {
    let arms = 0;
    const plain = makeExecutor({
      armTeamIntent: () => {
        arms += 1;
        return Promise.resolve({ ok: true, serviceAvailable: true });
      },
      now: () => 950_000
    });
    const plainRun = await plain.run({ button, group });
    assert.equal(plainRun.ok, true);
    assert.equal(arms, 0, "未勾选 → 零登记请求");

    const notices = [];
    const degrading = createConstellationExecutor({
      pending: createPendingActionStore(),
      floats: createFloatMarkerStore(),
      createSession: async () => {
        throw new Error("create failed");
      },
      armTeamIntent: () => {
        arms += 1;
        return Promise.resolve({ ok: true, serviceAvailable: true });
      },
      startSession: async () => {},
      notify: (text) => notices.push(text),
      now: () => 960_000
    });
    const degraded = await degrading.run({ button: { ...button, team: true, autoSend: true }, group });
    assert.equal(degraded.ok, true);
    assert.equal(degraded.degraded, true);
    assert.equal(arms, 0, "降级路径跳过登记");
    assert.equal(notices.length, 1, "仅既有降级 toast（不追加团队 toast）");
    assert.ok(notices[0].includes("新建会话通道不可用"), "既有降级文案");
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

/* ── 12. 浮窗图片附件纯逻辑（p2-add-const-float-image-attach 1.2/2.x/4.x；spec
   「浮窗图片附件」）：MIME 白名单本地复刻、剪贴板收集、attachFace 注入面与缺席形态、
   intake 校验/铸造登记/拒绝释放、移除链路、发送三分、上传门控、观察终态判定。 ── */
{
  /* 12a. 白名单（宿主 isImageMediaType 四类本地复刻；bundle 纯洁性禁止跨插件 import）。 */
  assert.deepEqual(
    [...FLOAT_IMAGE_TYPES],
    ["image/png", "image/jpeg", "image/webp", "image/gif"],
    "白名单 = 四类栅格图（与宿主同源）"
  );
  assert.ok(Object.isFrozen(FLOAT_IMAGE_TYPES), "白名单冻结（防运行期改写）");
  assert.equal(FLOAT_IMAGE_ACCEPT, "image/png,image/jpeg,image/webp,image/gif", "accept 值与白名单同源");
  assert.equal(isFloatImageType("image/png"), true);
  assert.equal(isFloatImageType("image/svg+xml"), false, "svg 不在白名单（宿主同口径）");
  assert.equal(isFloatImageType(undefined), false, "非字符串 MIME → false");
  assert.equal(FLOAT_ATTACH_WATCH_MS, 10000, "观察态看门狗 10s");

  /* 12b. 剪贴板收集（多文件 / 无文件 / null 项 / 目录成员忽略 / jsdom 索引形状）。 */
  const png = { name: "a.png", type: "image/png" };
  const jpg = { name: "b.jpg", type: "image/jpeg" };
  const pdf = { name: "c.pdf", type: "application/pdf" };
  const item = (file, kind = "file") => ({ kind, getAsFile: () => file });
  assert.deepEqual(
    clipboardFilesOf({ items: [item(png), item(jpg)] }),
    [png, jpg],
    "多文件按剪贴板顺序收集"
  );
  assert.deepEqual(clipboardFilesOf({ items: [item(pdf)] }), [pdf], "非图片也先收集（白名单过滤在 intake 面）");
  assert.deepEqual(clipboardFilesOf({ items: [item(null)] }), [], "getAsFile 返回 null → 跳过");
  assert.deepEqual(clipboardFilesOf({ items: [item(png, "string")] }), [], "非 file 成员（文本）跳过");
  assert.deepEqual(clipboardFilesOf({ items: [{ kind: "file" }] }), [], "缺 getAsFile → 跳过（形状防御）");
  assert.deepEqual(clipboardFilesOf({ items: [] }), [], "空剪贴板 → 空");
  assert.deepEqual(clipboardFilesOf(null), [], "无 clipboardData → 空（零异常）");
  assert.deepEqual(clipboardFilesOf({}), [], "无 items → 空");
  /* jsdom 的 DataTransferItemList 是「带 length 的索引对象」（非数组、无可迭代器）。 */
  assert.deepEqual(
    clipboardFilesOf({ items: { 0: item(png), 1: item(pdf), length: 2 } }),
    [png, pdf],
    "jsdom 索引形状逐索引读取"
  );
  /* 目录成员：与宿主差异（宿主用 webkitGetAsEntry 识别）——本能力忽略目录语义，仍按文件收。 */
  assert.deepEqual(
    clipboardFilesOf({ items: [{ kind: "file", getAsFile: () => png, webkitGetAsEntry: () => ({ isDirectory: true }) }] }),
    [png],
    "目录语义不在图片能力面内（成员按文件收集，由 MIME 过滤）"
  );

  /* 12c. intake 校验纯片段。 */
  assert.deepEqual(floatImagesOf([png, pdf, jpg]), { images: [png, jpg], files: 3 }, "图片子集 + 批内文件计数");
  assert.deepEqual(floatImagesOf([pdf]), { images: [], files: 1 }, "零图片批次（触发「仅支持添加图片」）");
  assert.deepEqual(floatImagesOf([]), { images: [], files: 0 }, "空批次");
  assert.deepEqual(floatImagesOf(null), { images: [], files: 0 }, "非数组 → 空批次");

  /* 12d. attachFace：缺席形态（零噪音降级）。 */
  {
    const absent = createAttachFace();
    assert.equal(absent.available, false, "服务不可达 → available=false");
    assert.throws(() => absent.mint("s", [], true), /附件铸造不可用/, "缺席 mint 抛错（MUST NOT 静默成功/返回 null）");
    assert.deepEqual(absent.resolve(["a"]), [], "缺席 resolve 恒空（rail 零布局）");
    assert.doesNotThrow(() => absent.release("a"), "缺席 release = no-op（零抛错）");
    assert.equal(absent.uploads.getSnapshot(), absent.uploads.getSnapshot(), "缺席上传快照引用稳定");
    assert.equal(typeof absent.uploads.subscribe(() => {}), "function", "缺席上传订阅返回退订函数");
    /* 动词漂移（缺一即降级——客户端 SHALL NOT 区分原因）。 */
    assert.equal(createAttachFace({ service: () => ({ createDrafts: () => [] }) }).available, false, "仅 createDrafts → 降级");
    assert.equal(
      createAttachFace({
        service: () => ({
          createDrafts: () => [],
          resolveDraftAttachments: () => [],
          releaseDraftAttachment: () => {},
          fileUploads: {}
        })
      }).available,
      false,
      "fileUploads 面不完整 → 降级"
    );
    /* 解析器抛错 → 视同缺席（零降级噪音）。 */
    assert.equal(createAttachFace({ service: () => { throw new Error("boom"); } }).available, false, "解析器抛错 → 降级");
  }

  /* 12e. attachFace：可用形态（薄包装语义）。 */
  {
    const calls = [];
    const drafts = [{ id: "d1", kind: "image" }, { id: "d2", kind: "image" }];
    const service = {
      createDrafts: (sessionId, files, uploadImages) => {
        calls.push({ op: "mint", sessionId, files, uploadImages });
        return drafts;
      },
      resolveDraftAttachments: (ids) => ids.map((id) => ({ id })),
      releaseDraftAttachment: (id) => calls.push({ op: "release", id }),
      fileUploads: { getSnapshot: () => ({ d1: { status: "uploading" } }), subscribe: () => () => {} }
    };
    const face = createAttachFace({
      service: () => service,
      uploads: { getSnapshot: () => service.fileUploads.getSnapshot(), subscribe: () => () => {} }
    });
    assert.equal(face.available, true, "四件齐备 → available=true");
    assert.deepEqual(face.mint("s1", [png, jpg], true), { ids: ["d1", "d2"] }, "mint 返回有序 ids");
    assert.deepEqual(calls[0], { op: "mint", sessionId: "s1", files: [png, jpg], uploadImages: true }, "createDrafts 形参透传");
    assert.deepEqual(face.resolve(["d1"]), [{ id: "d1" }], "resolve 薄透传");
    face.release("d1");
    assert.deepEqual(calls.at(-1), { op: "release", id: "d1" }, "release 薄透传");
    assert.deepEqual(face.uploads.getSnapshot(), { d1: { status: "uploading" } }, "uploads 取注入面快照");
    /* 抛错薄透传（组件层 toast error.message；face MUST NOT 吞错）。 */
    const broken = createAttachFace({
      service: () => ({ ...service, createDrafts: () => { throw new Error("unsupported image media type: image/bmp"); } })
    });
    assert.throws(() => broken.mint("s1", [], true), /unsupported image media type/, "mint 抛错原样上抛");
    /* 非对象/空 id 的草稿被过滤（防御脏返回值）。 */
    assert.deepEqual(
      createAttachFace({ service: () => ({ ...service, createDrafts: () => [null, {}, { id: "" }, { id: "ok" }] }) }).mint("s", [], true),
      { ids: ["ok"] },
      "非法草稿条目过滤"
    );
  }

  /* 12f. intake 链路：登记成功 / busy 释放 / 铸造抛错 / 零图片 / 服务缺席。 */
  {
    const added = [];
    const released = [];
    const inputActions = {
      addAttachments: (ids) => {
        added.push(ids);
        return true;
      }
    };
    const face = createAttachFace({ service: () => ({ createDrafts: () => [{ id: "d1" }, { id: "d2" }] }), uploads: { getSnapshot: () => ({}), subscribe: () => () => {} } });
    /* 该 face 因其余动词缺失而 available=false → 先构造完整服务。 */
    assert.equal(face.available, false);
    const service = {
      createDrafts: () => [{ id: "d1" }, { id: "d2" }],
      resolveDraftAttachments: () => [],
      releaseDraftAttachment: (id) => released.push(id),
      fileUploads: { getSnapshot: () => ({}), subscribe: () => () => {} }
    };
    const fullFace = createAttachFace({ service: () => service, uploads: { getSnapshot: () => ({}), subscribe: () => () => {} } });
    assert.deepEqual(
      intakeFloatImages({ face: fullFace, inputActions, sessionId: "s1", files: [png], uploadImages: true }),
      { kind: "added", ids: ["d1", "d2"] },
      "铸造 → addAttachments 登记成功"
    );
    assert.deepEqual(added, [["d1", "d2"]], "登记 ids 原样透传");
    assert.deepEqual(released, [], "成功路径零释放");
    /* busy 相位拒绝（addAttachments 返回 false）→ 释放已铸造草稿 + busy outcome。 */
    const busyActions = { addAttachments: () => false };
    assert.deepEqual(
      intakeFloatImages({ face: fullFace, inputActions: busyActions, sessionId: "s1", files: [png] }),
      { kind: "busy" },
      "busy 拒绝 → 结构化 busied outcome"
    );
    assert.deepEqual(released, ["d1", "d2"], "busy 拒绝释放已铸造草稿（objectURL 回收/上传中止）");
    /* 铸造抛错 → rejected 携带 error.message（组件 toast 原样文案）。 */
    const throwing = createAttachFace({
      service: () => ({ ...service, createDrafts: () => { throw new Error("unsupported image media type: image/bmp"); } }),
      uploads: { getSnapshot: () => ({}), subscribe: () => () => {} }
    });
    assert.deepEqual(
      intakeFloatImages({ face: throwing, inputActions, sessionId: "s1", files: [png] }),
      { kind: "rejected", message: "unsupported image media type: image/bmp" },
      "铸造抛错 → rejected（不吞错）"
    );
    /* 校验优先级：零图片批次 / 空批 / 服务缺席。 */
    assert.deepEqual(
      intakeFloatImages({ face: fullFace, inputActions, files: [pdf] }),
      { kind: "image-only" },
      "批内含文件但零图片 → image-only（toast「仅支持添加图片」）"
    );
    assert.deepEqual(
      intakeFloatImages({ face: fullFace, inputActions, files: [] }),
      { kind: "empty" },
      "空批 → empty（零 toast）"
    );
    assert.deepEqual(
      intakeFloatImages({ face: createAttachFace(), inputActions, files: [png] }),
      { kind: "unavailable" },
      "服务缺席 → unavailable（降级粘贴零噪音）"
    );
    /* uploadImages 缺省 true（浮窗目标恒普通会话）/ 显式 false 透传。 */
    const captured = [];
    const spyFace = createAttachFace({
      service: () => ({ ...service, createDrafts: (sid, files, uploadImages) => { captured.push(uploadImages); return [{ id: "x" }]; } }),
      uploads: { getSnapshot: () => ({}), subscribe: () => () => {} }
    });
    intakeFloatImages({ face: spyFace, inputActions, sessionId: "s", files: [png] });
    intakeFloatImages({ face: spyFace, inputActions, sessionId: "s", files: [png], uploadImages: false });
    assert.deepEqual(captured, [true, false], "uploadImages 缺省 true、可显式关闭");
    /* 零残留（task 2.3）：intake 链路不写草稿、不动文本面——只经 addAttachments 入机器状态。 */
    const draftWrites = [];
    const residueActions = {
      setDraft: (text) => draftWrites.push(text),
      addAttachments: () => true,
      submit: () => draftWrites.push("submit")
    };
    intakeFloatImages({ face: fullFace, inputActions: residueActions, sessionId: "s1", files: [png] });
    assert.deepEqual(draftWrites, [], "intake 零草稿写入零提交（草稿文本与输入状态零残留）");
  }

  /* 12g. 移除链路：机器成功 → 释放；busy 拒绝 → 零释放。 */
  {
    const released = [];
    const face = createAttachFace({ service: () => ({ releaseDraftAttachment: (id) => released.push(id) }) });
    assert.equal(removeFloatAttachment({ face, inputActions: { removeAttachment: () => true }, id: "d1" }), true, "移除成功 → 释放");
    assert.deepEqual(released, ["d1"], "释放顺序 = 机器移除之后");
    assert.equal(removeFloatAttachment({ face, inputActions: { removeAttachment: () => false }, id: "d2" }), false, "busy 相位拒绝 → 失败");
    assert.deepEqual(released, ["d1"], "拒绝时 MUST NOT 释放（机器仍持有该 id）");
    assert.equal(removeFloatAttachment({ face, inputActions: { removeAttachment: () => undefined }, id: "d3" }), true, "void 返回按成功处理（InputActions 契约为 void）");
    assert.equal(removeFloatAttachment({ face, inputActions: null, id: "d4" }), false, "输入面缺失 → false（零抛错）");
    assert.equal(removeFloatAttachment({ face, inputActions: { removeAttachment: () => true }, id: "" }), false, "非法 id → false");
  }

  /* 12h. 发送三分（含空输入判据扩展）。 */
  assert.equal(floatSendPlanOf({ draft: "", attachmentIds: [] }), "empty", "空文本 + 无附件 → empty（宿主 no-op）");
  assert.equal(floatSendPlanOf({ draft: "   \n", attachmentIds: [] }), "empty", "仅空白字符 → empty");
  assert.equal(floatSendPlanOf({ draft: "hi", attachmentIds: [] }), "text", "纯文本 → text（发送即关）");
  assert.equal(floatSendPlanOf({ draft: "/goal x", attachmentIds: [] }), "command", "命令草稿 → command（既有链路）");
  assert.equal(floatSendPlanOf({ draft: "/goal x", attachmentIds: ["a"] }), "command", "命令 + 附件 → command 优先（已知边界）");
  assert.equal(floatSendPlanOf({ draft: "", attachmentIds: ["a"] }), "watch", "空文本 + 有附件 → watch（附件使输入非空）");
  assert.equal(floatSendPlanOf({ draft: "hi", attachmentIds: ["a"] }), "watch", "文本 + 附件 → watch（结果感知关闭）");
  assert.equal(floatSendPlanOf({}), "empty", "缺省参数防御");
  assert.equal(floatSendPlanOf({ draft: 3, attachmentIds: null }), "empty", "非字符串/非数组 → 按空输入");

  /* 12i. 上传门控（对齐原生 uploadsPending 口径）。 */
  const image = (id) => ({ id, kind: "image" });
  const file = (id) => ({ id, kind: "file" });
  assert.equal(floatAttachmentsPendingOf([image("a")], { a: { status: "uploading" } }), true, "uploading → 待就绪");
  assert.equal(floatAttachmentsPendingOf([image("a")], { a: { status: "error" } }), true, "error → 待就绪（失败也拦发送）");
  assert.equal(floatAttachmentsPendingOf([image("a")], { a: { status: "ready", receiptId: "r" } }), false, "全部 ready → 解禁");
  assert.equal(floatAttachmentsPendingOf([image("a")], {}), false, "图片无上传态 → 视为就绪（原生口径）");
  assert.equal(floatAttachmentsPendingOf([file("a")], {}), true, "file 无上传态 → 未就绪（原生口径）");
  assert.equal(floatAttachmentsPendingOf([image("a"), image("b")], { a: { status: "ready" }, b: { status: "uploading" } }), true, "任一非 ready → 拦");
  assert.equal(floatAttachmentsPendingOf([], {}), false, "零附件 → 不拦");
  assert.equal(floatAttachmentsPendingOf(null, null), false, "参数防御");

  /* 12j. 观察态终态判定（成功 / 失败 / 在途）。 */
  const baseline = null;
  assert.deepEqual(floatWatchOutcomeOf({ phase: "sending", attachmentIds: ["a"], promptError: null, baseline }), { kind: "pending" }, "在途 → 继续观察");
  assert.deepEqual(floatWatchOutcomeOf({ phase: "plain", attachmentIds: [], promptError: null, baseline }), { kind: "success" }, "附件清空 + plain → 成功终态");
  const err1 = { op: "send", error: { code: "session/attachment-invalid", message: "too many images" } };
  assert.deepEqual(
    floatWatchOutcomeOf({ phase: "plain", attachmentIds: ["a"], promptError: err1, baseline }),
    { kind: "failure", message: "too many images", code: "session/attachment-invalid" },
    "plain + 新错误 → 失败终态（草稿与附件保留）"
  );
  assert.deepEqual(
    floatWatchOutcomeOf({ phase: "plain", attachmentIds: ["a"], promptError: err1, baseline: err1 }),
    { kind: "pending" },
    "与武装基线同一错误对象 → 非新错误（继续观察）"
  );
  const err2 = { op: "send", error: { code: "session/attachment-invalid", message: "too many images" } };
  assert.equal(
    floatWatchOutcomeOf({ phase: "plain", attachmentIds: ["a"], promptError: err2, baseline: err1 }).kind,
    "failure",
    "同文案新错误实例（引用不同）→ 仍是新错误"
  );
  assert.deepEqual(
    floatWatchOutcomeOf({ phase: "plain", attachmentIds: ["a"], promptError: { op: "send" }, baseline }),
    { kind: "pending" },
    "promptError 形状不含 error → 不误判失败"
  );
  assert.deepEqual(
    floatWatchOutcomeOf({ phase: "plain", attachmentIds: ["a"], promptError: null, baseline: err1 }),
    { kind: "pending" },
    "基线有错、当前清空（成功提交清错）且附件仍在 → 继续观察"
  );
  assert.deepEqual(floatWatchOutcomeOf({}), { kind: "success" }, "缺省（plain + 零附件）→ 成功");
  /* 失败文案（spec：{message}（{code}））。 */
  assert.equal(promptFailureTextOf({ message: "too many images", code: "session/attachment-invalid" }), "too many images（session/attachment-invalid）", "message（code）");
  assert.equal(promptFailureTextOf({ message: "boom", code: "" }), "boom", "无错误码 → 仅 message");
  assert.equal(promptFailureTextOf({ message: "", code: "e/code" }), "e/code", "无 message → 仅 code");
  assert.equal(promptFailureTextOf({ message: "", code: "" }), "", "两者皆空 → 空串（调用方回落文案）");
  assert.equal(promptFailureTextOf(null), "", "null 防御");
}

console.log("constellation-actions-smoke: all assertions passed");
