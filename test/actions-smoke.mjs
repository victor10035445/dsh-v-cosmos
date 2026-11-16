/**
 * 动作执行链路冒烟（add-cosmos-proposal-actions 4.2–4.6 / fix-cosmos-action-draft-block 4.1）；
 * 消息组装双方向、草稿等校验、一次性标记（覆盖/过期/按 token 清除/目标 SessionId 与落稿意图）、
 * 执行链路（恒新建 → 标记先于导航 → 关页/保持、降级回落 keep、失败清理、防重入）、
 * hero 双口径消费（id 精确匹配 + 空稿落稿 + 草稿等校验兜底、先切后发、切换失败不阻断）、
 * 零写 openspec 工件。运行：node test/actions-smoke.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ACTION_COOLDOWN_MS,
  PENDING_ACTION_TTL_MS,
  assembleEmbryoMessage,
  assembleMessage,
  consumePendingAction,
  createActionExecutor,
  createActionGate,
  createEmbryoActionExecutor,
  createPendingActionStore,
  draftMatches,
  explorationTargetOf
} from "../src/actions.mjs";
import { proposalKeyOf } from "../src/panel.mjs";

const card = {
  key: proposalKeyOf("ws1", "add-a"),
  id: "add-a",
  name: "add-a",
  wsId: "ws1",
  wsName: "alpha",
  wsPath: "C:/proj/alpha",
  lifecycle: "created",
  dir: "C:/proj/alpha/openspec/changes/add-a"
};
const button = { name: "审查", prompt: "请使用 /cosmos-review 审查本提案", autoSend: false, newSession: true };

/* ── 1. 消息组装（spec 两个组装场景） ── */
{
  assert.equal(
    assembleMessage({ ...button, prepend: true }, card),
    "请使用 /cosmos-review 审查本提案\n@C:/proj/alpha/openspec/changes/add-a",
    "提示词在前"
  );
  assert.equal(
    assembleMessage({ ...button }, card),
    "@C:/proj/alpha/openspec/changes/add-a\n请使用 /cosmos-review 审查本提案",
    "引用在前（缺省方向）"
  );
  assert.equal(
    assembleMessage({ ...button, prepend: false }, card),
    "@C:/proj/alpha/openspec/changes/add-a\n请使用 /cosmos-review 审查本提案",
    "prepend 缺省/false 同向"
  );
  assert.equal(assembleMessage(button, null), "", "无目标卡片 → 空消息（调用方拒执行）");
  assert.equal(assembleMessage(button, { dir: "" }), "", "卡片无目录（工作区 path 不可得）→ 空消息");
  assert.equal(
    assembleMessage({ prompt: "p", prepend: true }, { dir: "C:/a b/openspec/changes/x y" }),
    "p\n@C:/a b/openspec/changes/x y",
    "含空格路径不加引号（不污染送达内容）"
  );
}

/* ── 1b. 星胚动作消息组装（add-cosmos-action-prestate-gate 3.1 / spec ⑤①） ── */
{
  const embryoCard = { lifecycle: "proto", act: 0, sessionId: "sess-S", slugs: ["add-a"] };
  assert.equal(assembleEmbryoMessage({ prompt: "请继续推进" }, embryoCard), "请继续推进", "单 slug 组消息恰为 prompt");
  assert.equal(assembleEmbryoMessage({ prompt: "请继续推进", prepend: true }, embryoCard), "请继续推进", "prepend 恒忽略（星胚消息无 @引用）");
  assert.equal(
    assembleEmbryoMessage({ prompt: "请继续推进" }, { ...embryoCard, slugs: ["add-a", "add-b", "add-c"] }),
    "请继续推进\nadd-a\nadd-b\nadd-c",
    "多 slug 逐行附清单（纯文本）"
  );
  assert.equal(assembleEmbryoMessage({ prompt: "p" }, { ...embryoCard, slugs: [] }), "p", "无 slug → 恰为 prompt");
  assert.equal(assembleEmbryoMessage({ prompt: "p" }, { ...embryoCard, slugs: ["add-a", " ", ""] }), "p", "非法 slug 过滤后单条不附");
  assert.equal(assembleEmbryoMessage({ prompt: "p" }, null), "p", "无卡片 → 仍为 prompt（slug 清单缺席）");
  assert.equal(assembleEmbryoMessage({ prompt: "  " }, embryoCard), "", "空 prompt → 空消息（拒执行）");
}

/* ── 1c. 探索会话目标解析（3.4 / spec ②⑤） ── */
{
  assert.deepEqual(explorationTargetOf({ sessionId: "s1" }), { ok: true, reason: "ok", sessionId: "s1" }, "镜像不可达 → 不做在册判定（老宿主降级）");
  assert.equal(explorationTargetOf({}).reason, "no-session", "空 sessionId → no-session（旧锚点）");
  assert.equal(explorationTargetOf({ sessionId: "  " }).reason, "no-session", "空白 sessionId → no-session");
  assert.equal(explorationTargetOf({ sessionId: "s1", sessionIds: ["s1"] }).ok, true, "在册");
  assert.equal(explorationTargetOf({ sessionId: "s1", sessionIds: ["s2"] }).reason, "missing", "不在册 → missing");
  assert.equal(explorationTargetOf({ sessionId: "s1", archivedSessionIds: ["s1"] }).reason, "archived", "归档 → archived");
  assert.equal(explorationTargetOf({ sessionId: "s1", sessionIds: ["s1"], archivedSessionIds: ["s1"] }).reason, "archived", "归档优先于在册");
}

/* ── 2. 草稿等校验（spec「草稿不一致不误发」） ── */
{
  const message = "@C:/proj/alpha/openspec/changes/add-a\n请使用 /cosmos-review 审查本提案";
  assert.equal(draftMatches(message, message), true, "逐字符一致");
  assert.equal(draftMatches(message + "  ", message), true, "尾部空白归一后一致");
  assert.equal(draftMatches(message.replace(/\n/g, "\r\n"), message), true, "CRLF 归一后一致");
  assert.equal(draftMatches("用户自己的旧草稿", message), false, "用户旧草稿 ≠ 组装消息（不提交）");
  assert.equal(draftMatches("", message), false, "空草稿不匹配");
  assert.equal(draftMatches(message, ""), false, "空消息不匹配（防误发）");
  assert.equal(draftMatches(null, message), false, "非字符串草稿不匹配");
}

/* ── 3. 一次性标记 store（覆盖 / 过期 / 按 token 清除） ── */
{
  let clock = 1_000;
  const pending = createPendingActionStore({ now: () => clock });
  assert.equal(PENDING_ACTION_TTL_MS, 10_000, "过期窗口 10s");
  assert.equal(pending.read(), null, "未登记 → null");

  const first = pending.arm({ message: "m1", submit: true });
  assert.equal(first.submit, true);
  assert.equal(pending.read().message, "m1");
  assert.equal(pending.clear(first.token + 1), false, "token 不符 → 不清");
  assert.equal(pending.read().message, "m1", "标记仍在");

  /* 登记即覆盖旧标记 */
  const second = pending.arm({ message: "m2", model: { provider: "p", model: "m" }, submit: false });
  assert.notEqual(second.token, first.token);
  assert.equal(pending.read().message, "m2", "新登记覆盖旧标记");
  assert.equal(pending.clear(first.token), false, "旧 token 不能清新标记");
  assert.equal(pending.clear(second.token), true, "匹配 token 清除");
  assert.equal(pending.read(), null);

  /* 过期静默丢弃 */
  const third = pending.arm({ message: "m3" });
  clock += PENDING_ACTION_TTL_MS + 1;
  assert.equal(pending.read(), null, "过期 → null（静默安全失败）");
  assert.equal(pending.peek(), null, "过期即被丢弃");
  assert.equal(pending.clear(third.token), false, "已过期标记不可再清");

  /* 恒新建路径载荷（fix-cosmos-action-draft-block D2/D3）：目标 SessionId + 落稿意图 */
  const bound = pending.arm({ message: "m4", targetSessionId: "sess-9", setDraft: true });
  assert.equal(bound.targetSessionId, "sess-9", "标记绑定目标 SessionId");
  assert.equal(bound.setDraft, true, "标记带落稿意图（消费相位 setDraft）");
  assert.equal(pending.arm({ message: "m5", targetSessionId: "" }).targetSessionId, null, "空 id → null（无 id 判据）");
  assert.equal(pending.arm({ message: "m6" }).setDraft, false, "缺省无落稿意图（降级口径）");
}

/* ── 4. 执行链路：恒新建 + 标记先于导航（spec「点击执行链路」+「防重入」） ── */
{
  const calls = [];
  const pending = createPendingActionStore();
  let seq = 0;
  const executor = createActionExecutor({
    pending,
    createSession: async (...args) => {
      const id = "sess-" + (++seq);
      calls.push({ kind: "create", wsId: args[0], dir: args[1]?.dir, argc: args.length, id });
      return id;
    },
    openSession: (sessionId) =>
      calls.push({ kind: "open", sessionId, armedAtOpen: pending.peek()?.targetSessionId ?? null }),
    startSession: () => {
      throw new Error("恒新建主路径 MUST NOT 调用 startSession");
    },
    closePage: () => calls.push({ kind: "closed" }),
    notify: (text) => calls.push({ kind: "notify", text }),
    now: () => 10_000
  });

  const run = await executor.run({ button, card });
  assert.equal(run.ok, true);
  assert.equal(run.message, "@C:/proj/alpha/openspec/changes/add-a\n请使用 /cosmos-review 审查本提案");
  assert.equal(run.degraded, false, "恒新建成功 → 非降级");
  assert.equal(run.sessionId, "sess-1");
  assert.equal(calls[0].kind, "create");
  assert.equal(calls[0].wsId, "ws1", "恒新建创建于提案所属工作区");
  assert.equal(calls[0].dir, card.dir, "createSession 收到卡片（实现侧按路径解析权威 workspaceId）");
  assert.equal(calls[0].argc, 2, "仅 (workspaceId, card) —— 无 sessionId 形参（宿主缺省恒新建）");
  assert.deepEqual(calls.map((call) => call.kind), ["create", "open", "closed"], "恒新建 → 导航 → 关页（缺省跳转）");
  assert.equal(calls[1].sessionId, "sess-1", "导航目标 = 新建会话");
  assert.equal(calls[1].armedAtOpen, "sess-1", "标记先于 openSession 登记（导航完成瞬间 hero 可能已挂载）");
  const entry = pending.peek();
  assert.equal(entry.targetSessionId, "sess-1", "标记绑定目标 SessionId");
  assert.equal(entry.setDraft, true, "标记带落稿意图（openSession 不落稿，消费相位承担）");
  assert.equal(entry.submit, false, "未勾选自动发送 → 仅落稿");
  assert.equal(entry.message, run.message, "标记携带组装消息");
  assert.ok(!calls.some((call) => call.kind === "notify"), "恒新建主路径零降级 toast");

  /* 每按钮「执行后跳转」（fix-cosmos-const-float-send-close 4.3）：false → keepPage；
     true / 缺键 → closePage；不跳转不影响 autoSend 标记（两语义正交）。 */
  const jumpExecutorOf = (clock, log) => createActionExecutor({
    pending: createPendingActionStore(),
    createSession: async () => "jump-sess",
    openSession: (id) => log.push("open:" + id),
    closePage: () => log.push("closed"),
    keepPage: () => log.push("kept"),
    now: () => clock
  });

  const jumpCalls = [];
  const kept = await jumpExecutorOf(70_000, jumpCalls).run({ button: { ...button, jumpNewSession: false }, card });
  assert.equal(kept.ok, true);
  assert.deepEqual(jumpCalls, ["open:jump-sess", "kept"], "jumpNewSession=false → 保持整页（不关页）");

  const jumpCalls2 = [];
  await jumpExecutorOf(80_000, jumpCalls2).run({ button: { ...button, jumpNewSession: true }, card });
  assert.deepEqual(jumpCalls2, ["open:jump-sess", "closed"], "jumpNewSession=true → 关页跳转");

  const jumpCalls3 = [];
  await jumpExecutorOf(90_000, jumpCalls3).run({ button, card });
  assert.deepEqual(jumpCalls3, ["open:jump-sess", "closed"], "缺键 → 缺省跳转（旧配置零迁移）");

  const keepStore = createPendingActionStore();
  const keepWithMark = createActionExecutor({
    pending: keepStore,
    createSession: async () => "keep-sess",
    openSession: () => {},
    keepPage: () => {},
    now: () => 100_000
  });
  await keepWithMark.run({ button: { ...button, jumpNewSession: false, autoSend: true }, card });
  assert.equal(keepStore.peek().submit, true, "不跳转不影响 autoSend 标记（新建会话/发送与跳转正交）");

  /* 防重入：冷却窗内再次点击 → busy，不产生第二次会话创建 */
  const again = await executor.run({ button, card });
  assert.equal(again.ok, false);
  assert.equal(again.reason, "busy", "链路冷却窗内忽略");
  assert.equal(calls.filter((call) => call.kind === "create").length, 1, "未发起第二次会话创建");

  /* 冷却窗外可再次执行（每次点击独立会话）；autoSend=true → 登记 submit 标记 */
  const executorOf = (store, clock, log) => createActionExecutor({
    pending: store,
    createSession: async () => {
      const id = "auto-" + (log.length + 1);
      log.push({ kind: "create", id });
      return id;
    },
    openSession: (id) => log.push({ kind: "open", id }),
    now: () => clock
  });
  const autoStore = createPendingActionStore();
  const autoLog = [];
  const auto = await executorOf(autoStore, 40_000, autoLog).run({ button: { ...button, autoSend: true }, card });
  assert.equal(auto.ok, true);
  assert.equal(autoStore.peek().submit, true, "autoSend=true → 标记 submit");
  assert.equal(autoStore.peek().message, auto.message, "标记携带组装消息");
  assert.equal(autoStore.peek().targetSessionId, "auto-1", "标记绑定本次新建会话");

  /* 连续两次点击（冷窗外）→ 两个独立会话（不复用前一次的空稿 blank） */
  let tick = 200_000;
  const twiceLog = [];
  const twiceStore = createPendingActionStore();
  const twice = createActionExecutor({
    pending: twiceStore,
    createSession: async () => {
      tick += 1;
      const id = "twice-" + tick;
      twiceLog.push(id);
      return id;
    },
    openSession: () => {},
    now: () => (tick += 1_000)
  });
  assert.equal((await twice.run({ button, card })).ok, true);
  assert.equal((await twice.run({ button, card })).ok, true);
  assert.equal(twiceLog.length, 2, "每次点击各新建一个会话");
  assert.notEqual(twiceLog[0], twiceLog[1], "第二次不复用第一次的会话");

  /* 绑定模型 + autoSend=false → 标记 submit=false（hero 仅落稿/切模型） */
  const modelStore = createPendingActionStore();
  const withModel = createActionExecutor({
    pending: modelStore,
    createSession: async () => "model-sess",
    openSession: () => {},
    now: () => 50_000
  });
  await withModel.run({
    button: { ...button, model: { provider: "deepseek", model: "deepseek-chat", reasoningEffort: "max" } },
    card
  });
  assert.equal(modelStore.peek().submit, false, "未勾选自动发送 → 不提交");
  assert.deepEqual(modelStore.peek().model, { provider: "deepseek", model: "deepseek-chat", reasoningEffort: "max" }, "模型三元组随标记");

  /* 未选中/无目录 → 不产生任何动作 */
  const quiet = [];
  const noTarget = createActionExecutor({ pending: createPendingActionStore(), startSession: () => quiet.push("start") });
  assert.equal((await noTarget.run({ button, card: null })).reason, "no-target");
  assert.equal((await noTarget.run({ button, card: { ...card, dir: "" } })).reason, "no-target");
  assert.deepEqual(quiet, [], "无目标卡片 → 不创建会话");

  /* 星胚目标下点击现行提案动作按钮（add-cosmos-embryo-cards 3.4 / design D9）：
     星胚卡 **不携带 dir** → 既有「目标目录缺失」守卫拒绝执行（不发消息、不抛错、
     不提示）；星胚正式动作由 add-cosmos-action-prestate-gate 的 proto 按钮承担。 */
  const embryoCard = {
    key: "proto\u0000ws1\u0000sess-1",
    id: "add-a",
    name: "add-a",
    lifecycle: "proto",
    isEmbryo: true,
    sessionId: "sess-1",
    slugs: ["add-a"],
    at: 1,
    tasks: [0, 0],
    act: 0
  };
  assert.ok(!("dir" in embryoCard), "星胚卡无 dir（目标目录缺失）");
  const embryoQuiet = [];
  const embryoNoTarget = createActionExecutor({
    pending: createPendingActionStore(),
    createSession: async () => { embryoQuiet.push("create"); return "sess-embryo"; },
    openSession: () => embryoQuiet.push("open"),
    startSession: () => embryoQuiet.push("start"),
    notify: (text) => embryoQuiet.push("notify:" + text)
  });
  const embryoOutcome = await embryoNoTarget.run({ button, card: embryoCard });
  assert.equal(embryoOutcome.ok, false);
  assert.equal(embryoOutcome.reason, "no-target", "星胚目标 → 现行提案动作按目标目录缺失守卫拒绝");
  assert.deepEqual(embryoQuiet, [], "星胚目标 → 不创建/不导航/不落稿/不提示（静默拒绝）");

  /* 前置状态点击复验（add-cosmos-action-prestate-gate 2.3）：谓词不过 → 无动作。 */
  const gateStore = createPendingActionStore();
  const gateCalls = [];
  const guarded = createActionExecutor({
    pending: gateStore,
    createSession: async () => {
      gateCalls.push("create");
      return "gate-sess";
    },
    openSession: () => gateCalls.push("open"),
    now: () => 300_000
  });
  assert.equal(
    (await guarded.run({ button: { ...button, preState: "reviewed" }, card: { ...card, lifecycle: "reviewed", act: 1 } })).reason,
    "gate",
    "act≥1 → 复验早退"
  );
  assert.equal(
    (await guarded.run({ button: { ...button, preState: "executed" }, card: { ...card, lifecycle: "reviewed", act: 0 } })).reason,
    "gate",
    "状态不匹配 → 复验早退"
  );
  assert.deepEqual(gateCalls, [], "复验失败零组装零导航");
  assert.equal(
    (await guarded.run({ button: { ...button, preState: "reviewed" }, card: { ...card, lifecycle: "reviewed", act: 0 } })).ok,
    true,
    "沉睡 + 状态匹配 → 正常执行"
  );

  /* 导航失败（createSession 成功、openSession 抛错）→ 清标记、不关页、toast */
  const failStore = createPendingActionStore();
  const failCalls = [];
  const failing = createActionExecutor({
    pending: failStore,
    createSession: async () => "fail-sess",
    openSession: () => {
      throw new Error("navigation lost");
    },
    startSession: () => failCalls.push("start"),
    closePage: () => failCalls.push("closed"),
    notify: (text, isError) => failCalls.push({ text, isError }),
    now: () => 60_000
  });
  const failed = await failing.run({ button: { ...button, autoSend: true }, card });
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, "start-failed");
  assert.equal(failStore.peek(), null, "失败清除标记");
  assert.deepEqual(failCalls.filter((call) => call === "closed"), [], "失败不关页");
  assert.ok(failCalls.some((call) => call.isError === true && String(call.text).includes("创建会话失败")), "失败 toast");

  /* 宿主动词缺席（既无恒新建、也无降级通道）→ unavailable */
  const unavailable = createActionExecutor({ pending: createPendingActionStore(), notify: () => {} });
  const missing = await unavailable.run({ button, card });
  assert.equal(missing.reason, "unavailable");
  assert.equal(ACTION_COOLDOWN_MS, 800, "冷却窗常量");
}

/* ── 4b. 降级路径（spec 场景「create 失败降级」；行为 = 今日 keep 链路） ── */
{
  /* createSession 抛错 → toast 降级 + 回落 startSession keep；标记无 id 判据/落稿意图 */
  const store = createPendingActionStore();
  const calls = [];
  const degrading = createActionExecutor({
    pending: store,
    createSession: async () => {
      throw new Error("host refused");
    },
    openSession: () => calls.push("open"),
    startSession: (wsId, message, cardArg) => calls.push({ kind: "start", wsId, message, dir: cardArg?.dir }),
    closePage: () => calls.push("closed"),
    notify: (text, isError) => calls.push({ kind: "notify", text, isError }),
    now: () => 120_000
  });
  const degraded = await degrading.run({ button: { ...button, autoSend: true }, card });
  assert.equal(degraded.ok, true, "降级仍执行成功（行为 = 今日）");
  assert.equal(degraded.degraded, true, "结果注明降级");
  assert.deepEqual(calls.map((call) => (typeof call === "string" ? call : call.kind)), ["notify", "start", "closed"], "降级 toast → startSession → 关页");
  assert.ok(/已降级/.test(calls[0].text), "降级 toast 注明");
  assert.equal(calls[1].message, degraded.message, "startSession 收到组装消息（由它负责落稿）");
  assert.equal(calls[1].dir, card.dir, "startSession 收到卡片");
  const entry = store.peek();
  assert.equal(entry.submit, true, "降级路径按现行条件登记（autoSend=true）");
  assert.equal(entry.targetSessionId, null, "降级标记无 SessionId 判据（消费走草稿等校验）");
  assert.equal(entry.setDraft, false, "降级标记无落稿意图（startSession 已落稿）");
  assert.ok(!calls.includes("open"), "降级不走 openSession");

  /* 降级 + autoSend=false 且无模型 → 沿用现行条件：不登记标记 */
  const plainStore = createPendingActionStore();
  const plainDegrading = createActionExecutor({
    pending: plainStore,
    createSession: async () => {
      throw new Error("host refused");
    },
    openSession: () => {},
    startSession: () => {},
    now: () => 130_000
  });
  const plainResult = await plainDegrading.run({ button, card });
  assert.equal(plainResult.ok, true);
  assert.equal(plainStore.peek(), null, "降级路径沿用现行登记条件（autoSend=false 且无模型不登记）");

  /* createSession 缺席（老宿主）→ 同样降级；只有 startSession 时行为 = 今日 */
  const legacyStore = createPendingActionStore();
  const legacyCalls = [];
  const legacy = createActionExecutor({
    pending: legacyStore,
    startSession: (wsId, message) => legacyCalls.push({ wsId, message }),
    closePage: () => legacyCalls.push("closed"),
    notify: (text) => legacyCalls.push({ kind: "notify", text }),
    now: () => 140_000
  });
  const legacyResult = await legacy.run({ button: { ...button, autoSend: true }, card });
  assert.equal(legacyResult.ok, true);
  assert.equal(legacyResult.degraded, true, "无恒新建通道 → 降级");
  assert.equal(legacyCalls[1].wsId, "ws1");
  assert.equal(legacyStore.peek().targetSessionId, null);

  /* 降级链路本身失败（startSession 抛错）→ 清标记 + start-failed */
  const brokenStore = createPendingActionStore();
  const broken = createActionExecutor({
    pending: brokenStore,
    createSession: async () => {
      throw new Error("host refused");
    },
    openSession: () => {},
    startSession: () => {
      throw new Error("unknown workspace");
    },
    notify: () => {},
    now: () => 150_000
  });
  const brokenResult = await broken.run({ button: { ...button, autoSend: true }, card });
  assert.equal(brokenResult.ok, false);
  assert.equal(brokenResult.reason, "start-failed");
  assert.equal(brokenStore.peek(), null, "降级失败清除标记");
}

/* ── 4c. 星胚动作执行链路（add-cosmos-action-prestate-gate 3.1/3.2/3.4） ── */
{
  const embryoButton = { name: "推进", prompt: "请继续推进", autoSend: false, newSession: false, preState: "proto" };
  const embryoCard = {
    key: "proto\u0000sess-explore",
    lifecycle: "proto",
    act: 0,
    sessionId: "sess-explore",
    slugs: ["add-a", "add-b"],
    wsId: "ws1"
  };
  const runEmbryo = (options = {}) => createEmbryoActionExecutor({
    pending: options.pending ?? createPendingActionStore(),
    openSession: options.openSession ?? (() => {}),
    closePage: options.closePage ?? (() => {}),
    keepPage: options.keepPage ?? (() => {}),
    notify: options.notify ?? (() => {}),
    resolveTarget: options.resolveTarget,
    gate: options.gate,
    now: options.now ?? (() => 10_000)
  });

  /* 主路径：目标 = 锚点 sessionId；标记先于导航；缺省跳转关页；恒不新建会话。 */
  {
    const store = createPendingActionStore();
    const calls = [];
    const result = await runEmbryo({
      pending: store,
      openSession: (sessionId) => calls.push({ kind: "open", sessionId, armedAtOpen: store.peek()?.targetSessionId ?? null }),
      closePage: () => calls.push("closed")
    }).run({ button: embryoButton, card: embryoCard });
    assert.equal(result.ok, true);
    assert.equal(result.sessionId, "sess-explore", "目标 = 探索会话锚点");
    assert.deepEqual(calls.map((call) => (typeof call === "string" ? call : call.kind)), ["open", "closed"], "导航 → 关页（缺省跳转）");
    assert.equal(calls[0].sessionId, "sess-explore", "openSession 目标 = 探索会话");
    assert.equal(calls[0].armedAtOpen, "sess-explore", "标记先于导航登记");
    const entry = store.peek();
    assert.equal(entry.targetSessionId, "sess-explore", "标记绑定探索会话 id");
    assert.equal(entry.setDraft, true, "标记带落稿意图");
    assert.equal(entry.submit, false, "未勾选自动发送 → 仅落稿");
    assert.equal(entry.message, "请继续推进\nadd-a\nadd-b", "消息 = prompt + 逐行 slug 清单");
    assert.equal(entry.model, null, "未绑定模型 → null");
    assert.ok(!("createSession" in result), "恒不新建会话");
  }

  /* autoSend + 模型绑定 → 标记 submit + 模型三元组（dock 先切后发）。 */
  {
    const store = createPendingActionStore();
    const result = await runEmbryo({ pending: store, now: () => 20_000 }).run({
      button: { ...embryoButton, autoSend: true, model: { provider: "p", model: "m", reasoningEffort: "max" } },
      card: embryoCard
    });
    assert.equal(result.ok, true);
    assert.equal(store.peek().submit, true, "autoSend → submit");
    assert.deepEqual(store.peek().model, { provider: "p", model: "m", reasoningEffort: "max" }, "模型三元组随标记");
  }

  /* 页面流转分流：jumpNewSession=false → keepPage（不关页）。 */
  {
    const calls = [];
    const result = await runEmbryo({
      pending: createPendingActionStore(),
      keepPage: () => calls.push("kept"),
      closePage: () => calls.push("closed"),
      now: () => 30_000
    }).run({ button: { ...embryoButton, jumpNewSession: false }, card: embryoCard });
    assert.equal(result.ok, true);
    assert.deepEqual(calls, ["kept"], "jumpNewSession=false → 保持整页（探索会话在覆盖层底下落稿）");
  }

  /* 守卫：无 sessionId 静默（呈现层禁用）；缺失/归档/运行中 toast 且不导航。 */
  {
    const silentCalls = [];
    const silent = await runEmbryo({
      pending: createPendingActionStore(),
      resolveTarget: () => ({ ok: false, reason: "no-session", sessionId: "" }),
      openSession: () => silentCalls.push("open"),
      notify: (text) => silentCalls.push(text),
      now: () => 40_000
    }).run({ button: embryoButton, card: { ...embryoCard, sessionId: undefined } });
    assert.equal(silent.reason, "no-session");
    assert.deepEqual(silentCalls, [], "旧锚点 → 静默早退（不导航不组装不 toast）");

    for (const [reason, pattern] of [["missing", /不可用/], ["archived", /不可用/], ["running", /未打断/]]) {
      const calls = [];
      const store = createPendingActionStore();
      const result = await runEmbryo({
        pending: store,
        resolveTarget: () => ({ ok: false, reason, sessionId: "sess-x" }),
        openSession: () => calls.push("open"),
        notify: (text, isError) => calls.push({ text, isError }),
        now: () => 50_000
      }).run({ button: embryoButton, card: embryoCard });
      assert.equal(result.ok, false, reason + " → 不执行");
      assert.equal(result.reason, reason);
      assert.equal(calls.length, 1, reason + " → toast 一次");
      assert.match(String(calls[0].text), pattern, reason + " → 文案");
      assert.equal(calls[0].isError, true, reason + " → 错误样式");
      assert.equal(store.peek(), null, reason + " → 不登记标记（不回落新建）");
    }
  }

  /* 调度/复验守卫：非 proto 拒绝；门控谓词不过（act≥1）早退。 */
  {
    assert.equal((await runEmbryo({ pending: createPendingActionStore(), now: () => 60_000 })
      .run({ button: { ...embryoButton, preState: "reviewed" }, card: embryoCard })).reason, "not-proto", "非星胚按钮不走本链路");
    assert.equal((await runEmbryo({ pending: createPendingActionStore(), now: () => 70_000 })
      .run({ button: embryoButton, card: { ...embryoCard, act: 1 } })).reason, "gate", "点击复验：act≥1 → 早退");
    assert.equal((await runEmbryo({ pending: createPendingActionStore(), now: () => 70_500 })
      .run({ button: { ...embryoButton, prompt: "  " }, card: embryoCard })).reason, "no-message", "空 prompt → 拒执行");
  }

  /* 共享防重入门：与提案动作同门（冷却窗内 busy）。 */
  {
    const gate = createActionGate({ now: () => 95_000 });
    const first = await runEmbryo({ pending: createPendingActionStore(), gate, now: () => 95_000 })
      .run({ button: embryoButton, card: embryoCard });
    assert.equal(first.ok, true);
    const second = await runEmbryo({ pending: createPendingActionStore(), gate, now: () => 95_000 })
      .run({ button: embryoButton, card: embryoCard });
    assert.equal(second.reason, "busy", "冷却窗内重复点击忽略（与提案动作共享门）");
  }

  /* 导航失败 → 清标记（不残留半截落稿意图）。 */
  {
    const store = createPendingActionStore();
    const result = await runEmbryo({
      pending: store,
      openSession: () => {
        throw new Error("navigation lost");
      },
      notify: () => {},
      now: () => 100_000
    }).run({ button: embryoButton, card: embryoCard });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "send-failed");
    assert.equal(store.peek(), null, "失败清除标记");
  }

  /* 通道隔离：星胚 store 与 hero store 互不覆盖、互不清除。 */
  {
    const hero = createPendingActionStore();
    const embryo = createPendingActionStore();
    await runEmbryo({ pending: embryo, now: () => 120_000 }).run({ button: embryoButton, card: embryoCard });
    const embryoEntry = embryo.peek();
    assert.ok(embryoEntry, "星胚通道登记标记");
    assert.equal(hero.peek(), null, "hero 通道零登记");
    hero.arm({ message: "hero-msg", submit: true });
    assert.deepEqual(embryo.peek(), embryoEntry, "hero 登记不覆盖星胚标记");
    await consumePendingAction({ pending: hero, sessionId: "sess-explore", draft: "hero-msg", submit: () => {} });
    assert.equal(hero.peek(), null, "hero 标记消费完成");
    assert.deepEqual(embryo.peek(), embryoEntry, "hero 消费不清除星胚标记");
  }
}

/* ── 4d. 显式关联绑定（fix-cosmos-association-scope 3.2 / spec cosmos-actions ⑤） ── */
{
  /* 成功路径：取得 SessionId 后调用（create → bind → open），proposals = 目标提案清单。 */
  {
    const calls = [];
    const executor = createActionExecutor({
      pending: createPendingActionStore(),
      createSession: async () => {
        calls.push("create");
        return "sess-bind";
      },
      bindSession: (input) => {
        calls.push("bind");
        calls.push(input);
        return Promise.resolve({ ok: true, bound: ["add-a"] });
      },
      openSession: () => calls.push("open"),
      closePage: () => calls.push("close"),
      now: () => 200_000
    });
    const run = await executor.run({ button, card });
    assert.equal(run.ok, true, "绑定不改变链路成功语义");
    assert.deepEqual(calls.slice(0, 2), ["create", "bind"], "取得新会话 id 后立即绑定（先于导航）");
    assert.deepEqual(calls[2], { sessionId: "sess-bind", proposals: ["add-a"] }, "请求 = {sessionId, proposals:[目标提案名]}");
    assert.equal(calls[3], "open", "绑定非阻断：导航照常紧随");
    assert.equal(calls.filter((item) => item === "bind").length, 1, "每次点击恰一次绑定");
  }

  /* 非阻断：bindSession 返回悬决 Promise → run 照常完成；拒绝被吞（无 toast、无未处理拒绝）。 */
  {
    let unhandled = null;
    const onUnhandled = (reason) => {
      unhandled = reason;
    };
    process.on("unhandledRejection", onUnhandled);
    const calls = [];
    const executor = createActionExecutor({
      pending: createPendingActionStore(),
      createSession: async () => "sess-hang",
      bindSession: () => new Promise(() => {}), // 永悬决：若被 await，run 不会返回
      openSession: () => calls.push("open"),
      closePage: () => {},
      notify: (text) => calls.push("notify:" + text),
      now: () => 300_000
    });
    const run = await executor.run({ button, card });
    assert.equal(run.ok, true, "悬决的绑定不阻塞链路（不 await 呈现）");
    assert.deepEqual(calls, ["open"], "链路其余步骤照常呈现（零绑定相关 toast）");

    const rejecting = createActionExecutor({
      pending: createPendingActionStore(),
      createSession: async () => "sess-reject",
      bindSession: () => Promise.reject(new Error("endpoint 404")),
      openSession: () => {},
      closePage: () => {},
      now: () => 400_000
    });
    const rejectedRun = await rejecting.run({ button, card });
    assert.equal(rejectedRun.ok, true, "绑定拒绝不改变链路结果");
    await new Promise((resolve) => setTimeout(resolve, 10));
    process.removeListener("unhandledRejection", onUnhandled);
    assert.equal(unhandled, null, "绑定拒绝被吞（无未处理 Promise 拒绝噪声）");

    let thrown = 0;
    const throwing = createActionExecutor({
      pending: createPendingActionStore(),
      createSession: async () => "sess-throw",
      bindSession: () => {
        thrown += 1;
        throw new Error("sync failure");
      },
      openSession: () => {},
      closePage: () => {},
      notify: () => {},
      now: () => 500_000
    });
    const thrownRun = await throwing.run({ button, card });
    assert.equal(thrown, 1, "同步抛错的绑定确实被调用");
    assert.equal(thrownRun.ok, true, "同步抛错同样静默（不影响链路）");
  }

  /* 降级路径跳过绑定：create 失败回落 startSession（无新会话 id）→ bindSession 零调用。 */
  {
    let bound = 0;
    const executor = createActionExecutor({
      pending: createPendingActionStore(),
      createSession: async () => {
        throw new Error("create unavailable");
      },
      bindSession: () => {
        bound += 1;
        return Promise.resolve({ ok: true });
      },
      startSession: () => {},
      closePage: () => {},
      notify: () => {},
      now: () => 600_000
    });
    const run = await executor.run({ button, card });
    assert.equal(run.ok, true);
    assert.equal(run.degraded, true, "降级路径照常");
    assert.equal(bound, 0, "降级路径 MUST 跳过绑定");

    let legacyBound = 0;
    const legacy = createActionExecutor({
      pending: createPendingActionStore(),
      bindSession: () => {
        legacyBound += 1;
        return Promise.resolve({ ok: true });
      },
      startSession: () => {},
      notify: () => {},
      now: () => 700_000
    });
    const legacyRun = await legacy.run({ button, card });
    assert.equal(legacyRun.degraded, true, "老宿主（无恒新建通道）→ 降级");
    assert.equal(legacyBound, 0, "老宿主降级同样不绑定");
  }

  /* 缺目标提案名（卡片无 id）→ 不发起绑定（不产生空清单请求）。 */
  {
    let bound = 0;
    const executor = createActionExecutor({
      pending: createPendingActionStore(),
      createSession: async () => "sess-noid",
      bindSession: () => {
        bound += 1;
        return Promise.resolve({ ok: true });
      },
      openSession: () => {},
      closePage: () => {},
      now: () => 800_000
    });
    const noIdCard = { ...card, id: "" };
    const run = await executor.run({ button, card: noIdCard });
    assert.equal(run.ok, true);
    assert.equal(bound, 0, "缺目标提案名不绑定（端点面禁止空清单）");
  }
}

/* ── 5. hero 消费（spec「自动发送 hero 接力」「按钮模型绑定执行语义」） ── */
{
  /* 未登记 → idle */
  assert.deepEqual(await consumePendingAction({ pending: createPendingActionStore(), draft: "x" }), { status: "idle" });

  /* 草稿不一致 → mismatch：不提交、不清标记（防无关 blank 误消费） */
  {
    const pending = createPendingActionStore();
    pending.arm({ message: "目标消息", submit: true });
    const seen = [];
    const result = await consumePendingAction({
      pending,
      draft: "用户旧草稿",
      submit: () => seen.push("submit"),
      switchModel: async () => {
        seen.push("switch");
        return { ok: true };
      }
    });
    assert.equal(result.status, "mismatch");
    assert.deepEqual(seen, [], "不一致 → 不切换、不提交");
    assert.equal(pending.peek().message, "目标消息", "标记保留（等正确会话或过期）");
  }

  /* 有绑定模型 + submit：先切后发，成功后清标记 */
  {
    const pending = createPendingActionStore();
    pending.arm({ message: "目标消息", model: { provider: "p", model: "m", reasoningEffort: "max" }, submit: true });
    const order = [];
    const result = await consumePendingAction({
      pending,
      draft: "目标消息",
      switchModel: async (model) => {
        order.push("switch:" + model.provider + "/" + model.model + "/" + model.reasoningEffort);
        await Promise.resolve();
        return { ok: true };
      },
      submit: () => order.push("submit")
    });
    assert.equal(result.status, "submitted");
    assert.equal(result.switched, true);
    assert.deepEqual(order, ["switch:p/m/max", "submit"], "先切后发（提交发生在 await 之后）");
    assert.equal(pending.peek(), null, "提交后清除标记");
  }

  /* autoSend=false + 绑定模型 → 仅切模型（不提交），清标记 */
  {
    const pending = createPendingActionStore();
    pending.arm({ message: "目标消息", model: { provider: "p", model: "m" }, submit: false });
    const order = [];
    const result = await consumePendingAction({
      pending,
      draft: "目标消息",
      switchModel: async () => {
        order.push("switch");
        return { ok: true };
      },
      submit: () => order.push("submit")
    });
    assert.equal(result.status, "switched");
    assert.deepEqual(order, ["switch"], "仅切模型，不提交");
    assert.equal(pending.peek(), null, "切换完成即清标记");
  }

  /* 切换失败 → toast 不阻断（仍提交），草稿不丢（我们不动草稿） */
  {
    const pending = createPendingActionStore();
    pending.arm({ message: "目标消息", model: { provider: "p", model: "gone" }, submit: true });
    const order = [];
    const result = await consumePendingAction({
      pending,
      draft: "目标消息",
      switchModel: async () => ({ ok: false, error: "model retired" }),
      submit: () => order.push("submit"),
      notify: (text, isError) => order.push({ text, isError }),
      labels: { switchFailed: "模型切换失败：" }
    });
    assert.equal(result.status, "submitted");
    assert.equal(result.switched, false);
    assert.deepEqual(order, [{ text: "模型切换失败：model retired", isError: true }, "submit"], "toast 后仍以会话当前模型提交");
    assert.equal(pending.peek(), null, "失败也不阻断链路（标记清除）");
  }

  /* 切换抛错 → 同样不阻断 */
  {
    const pending = createPendingActionStore();
    pending.arm({ message: "m", model: { provider: "p", model: "m" }, submit: true });
    let submitted = false;
    const result = await consumePendingAction({
      pending,
      draft: "m",
      switchModel: () => {
        throw new Error("connection lost");
      },
      submit: () => {
        submitted = true;
      },
      notify: () => {}
    });
    assert.equal(result.switched, false);
    assert.equal(submitted, true, "切换异常不阻断提交");
  }

  /* 不可用降级文案（unavailable） */
  {
    const pending = createPendingActionStore();
    pending.arm({ message: "m", model: { provider: "p", model: "m" }, submit: false });
    const notices = [];
    const result = await consumePendingAction({
      pending,
      draft: "m",
      switchModel: async () => ({ ok: false, unavailable: true, error: "" }),
      notify: (text, isError) => notices.push({ text, isError }),
      labels: { switchUnavailable: "模型切换不可用" }
    });
    assert.equal(result.status, "switched");
    assert.deepEqual(notices, [{ text: "模型切换不可用", isError: true }]);
  }

  /* 未绑定模型 → 零模型调用（spec「未绑定零动作」） */
  {
    const pending = createPendingActionStore();
    pending.arm({ message: "m", submit: true });
    let switchCalls = 0;
    let submitted = 0;
    await consumePendingAction({
      pending,
      draft: "m",
      switchModel: async () => {
        switchCalls += 1;
        return { ok: true };
      },
      submit: () => {
        submitted += 1;
      }
    });
    assert.equal(switchCalls, 0, "未绑定 → MUST NOT 发起模型切换调用");
    assert.equal(submitted, 1);
  }

  /* 标记过期 → idle（草稿保留、不发送） */
  {
    let clock = 0;
    const pending = createPendingActionStore({ now: () => clock });
    pending.arm({ message: "m", submit: true });
    clock += PENDING_ACTION_TTL_MS + 5;
    let submitted = 0;
    const result = await consumePendingAction({ pending, draft: "m", submit: () => (submitted += 1) });
    assert.equal(result.status, "idle");
    assert.equal(submitted, 0, "过期未消费 → 不发送（安全失败）");
  }
}

/* ── 5b. 恒新建口径的双口径消费（fix-cosmos-action-draft-block 2.1/4.1） ── */
{
  /* 会话 id 不符 → mismatch：零落稿、零提交、零清除（无关 blank / 导航被取代） */
  {
    const pending = createPendingActionStore();
    pending.arm({ message: "目标消息", submit: true, targetSessionId: "sess-A", setDraft: true });
    const seen = [];
    const result = await consumePendingAction({
      pending,
      sessionId: "sess-B",
      draft: "",
      setDraft: (text) => seen.push("set:" + text),
      submit: () => seen.push("submit")
    });
    assert.equal(result.status, "mismatch");
    assert.equal(result.reason, "session", "判据 = 会话 id");
    assert.deepEqual(seen, [], "无关会话零落稿零提交");
    assert.equal(pending.peek()?.targetSessionId, "sess-A", "标记保留（等正确会话或过期）");
  }

  /* 空稿 + 落稿意图 → filled（仅 setDraft，标记保留）；草稿到位后消费（先切后发） */
  {
    const pending = createPendingActionStore();
    pending.arm({
      message: "目标消息",
      model: { provider: "p", model: "m" },
      submit: true,
      targetSessionId: "sess-A",
      setDraft: true
    });
    const filled = [];
    const fill = await consumePendingAction({
      pending,
      sessionId: "sess-A",
      draft: "",
      setDraft: (text) => filled.push(text),
      submit: () => filled.push("submit")
    });
    assert.equal(fill.status, "filled");
    assert.deepEqual(filled, ["目标消息"], "只落稿、不提交");
    assert.ok(pending.peek(), "标记保留（等草稿到位后的下一轮消费）");

    const order = [];
    const consumed = await consumePendingAction({
      pending,
      sessionId: "sess-A",
      draft: "目标消息",
      switchModel: async () => {
        order.push("switch");
        return { ok: true };
      },
      submit: () => order.push("submit")
    });
    assert.equal(consumed.status, "submitted");
    assert.deepEqual(order, ["switch", "submit"], "落稿 → 先切后发");
    assert.equal(pending.peek(), null, "消费后清标记");
  }

  /* 草稿非空且不一致 → mismatch：MUST NOT 改写既有内容、不清标记 */
  {
    const pending = createPendingActionStore();
    pending.arm({ message: "目标消息", submit: true, targetSessionId: "sess-A", setDraft: true });
    const seen = [];
    const result = await consumePendingAction({
      pending,
      sessionId: "sess-A",
      draft: "用户自己的旧草稿",
      setDraft: (text) => seen.push("set:" + text),
      submit: () => seen.push("submit")
    });
    assert.equal(result.status, "mismatch");
    assert.equal(result.reason, "draft");
    assert.deepEqual(seen, [], "既有草稿零改写、零提交");
    assert.ok(pending.peek(), "标记保留至过期");
  }

  /* 空稿但注入面缺 setDraft → 不消费不误清（守卫） */
  {
    const pending = createPendingActionStore();
    pending.arm({ message: "目标消息", submit: true, targetSessionId: "sess-A", setDraft: true });
    const result = await consumePendingAction({ pending, sessionId: "sess-A", draft: "" });
    assert.equal(result.status, "mismatch");
    assert.equal(result.reason, "no-draft-writer");
    assert.ok(pending.peek(), "标记保留");
  }

  /* autoSend=false 且无模型：落稿后消费即清标记（不再重复落稿） */
  {
    const pending = createPendingActionStore();
    pending.arm({ message: "只填不发", submit: false, targetSessionId: "sess-A", setDraft: true });
    const writes = [];
    const filled = await consumePendingAction({
      pending,
      sessionId: "sess-A",
      draft: "",
      setDraft: (text) => writes.push(text)
    });
    assert.equal(filled.status, "filled");
    const done = await consumePendingAction({ pending, sessionId: "sess-A", draft: "只填不发" });
    assert.equal(done.status, "switched", "非提交消费完成（落稿已在上一步）");
    assert.deepEqual(writes, ["只填不发"], "仅一次落稿");
    assert.equal(pending.peek(), null, "消费即清标记（用户清空草稿后不会被再次填充）");
  }

  /* 降级口径（标记无 targetSessionId）：草稿等校验仍生效 */
  {
    const pending = createPendingActionStore();
    pending.arm({ message: "目标消息", submit: true });
    const mismatch = await consumePendingAction({ pending, sessionId: "sess-A", draft: "用户旧草稿", submit: () => {} });
    assert.equal(mismatch.status, "mismatch");
    assert.equal(mismatch.reason, "draft", "降级路径不受会话 id 影响");
    assert.ok(pending.peek());
    let submitted = 0;
    const ok = await consumePendingAction({ pending, sessionId: "sess-A", draft: "目标消息", submit: () => (submitted += 1) });
    assert.equal(ok.status, "submitted");
    assert.equal(submitted, 1);
    assert.equal(pending.peek(), null);
  }
}

/* ── 6. 零写 openspec 工件（spec「点击不写工件」静态面） ── */
{
  const source = readFileSync(new URL("../src/actions.mjs", import.meta.url), "utf8");
  assert.ok(!/node:fs/.test(source), "执行链路纯逻辑不触碰文件系统（无 openspec 工件写入路径）");
  assert.ok(!/\.state\.json|pending-changes/.test(source), "链路源码不引用契约工件路径");
}

console.log("actions-smoke: all assertions passed");
