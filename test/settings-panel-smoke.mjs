/**
 * 设置页「快捷动作」冒烟（add-cosmos-proposal-actions 5.1–5.4 /
 * spec cosmos-button-settings「设置页『快捷动作』标签页」「按钮排序交互与顺序语义」）：
 * 暂存-保存、CRUD 回显、`newSession` 锁定、覆盖标记/重置、排序与边界、CAS 409 重试流、
 * 只读降级、模型目录降级与漂移回显、级别默认最高；
 * fix-cosmos-const-float-send-close 4.4：每按钮「执行后跳转」（`jumpNewSession`，
 * 缺省 true）的归一化/草稿/编辑/保存/回显与 UI 锚点（快捷动作行内勾选、参与暂存-保存、
 * 随可写性禁用；星座行不呈现）；行内锁定「新增会话」徽标保持不变。
 * 运行：node test/settings-panel-smoke.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAX_BUTTONS } from "../src/buttons.mjs";
import {
  CONSTELLATION_PROFILE,
  buttonDraftOf,
  buttonIssue,
  constButtonDraftOf,
  constButtonIssue,
  createButtonSettingsController,
  moveButton
} from "../src/button-settings.mjs";
import { catalogOptions, describeButtonModel, highestEffort, modelKeyOf } from "../src/model-catalog.mjs";
import { buttonsSectionOf } from "../src/buttons.mjs";
import {
  shortcutConflictOf,
  shortcutConflictOnRowOf,
  shortcutsIssue
} from "../src/shortcuts.mjs";
import { createPathsSettingsController } from "../src/paths-settings.mjs";

/** 设置作用域桩：set/unset 可编程失败（模拟 CAS 409 / 只读拒绝）。 */
function fakeScope(options = {}) {
  const listeners = new Set();
  const initialValue = { buttons: options.buttons ?? [] };
  const initialBase = { buttons: options.baseButtons ?? [] };
  if (options.constellationButtons !== undefined) initialValue.constellationButtons = options.constellationButtons;
  if (options.baseConstButtons !== undefined) initialBase.constellationButtons = options.baseConstButtons;
  const userOf = () => {
    if (options.user !== undefined) return options.user;
    const parts = {};
    if (options.buttons) parts.buttons = options.buttons;
    if (options.constellationButtons) parts.constellationButtons = options.constellationButtons;
    return Object.keys(parts).length > 0 ? parts : null;
  };
  let state = {
    status: "ready",
    value: initialValue,
    base: initialBase,
    user: userOf(),
    revision: 1,
    writable: options.writable !== false,
    mode: "host"
  };
  const calls = [];
  let failNext = 0;
  const emit = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    calls,
    failNextSet(times = 1) {
      failNext = times;
    },
    patch(next) {
      state = { ...state, ...next };
      emit();
    },
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async set(key, value) {
      calls.push({ op: "set", key, value });
      if (!state.writable) throw new Error("read-only");
      if (failNext > 0) {
        failNext -= 1;
        state = { ...state, revision: state.revision + 1 }; // 他端先写：revision 漂移
        emit();
        throw new Error("conflict 409");
      }
      state = {
        ...state,
        revision: state.revision + 1,
        value: { ...state.value, [key]: value },
        user: { ...(state.user ?? {}), [key]: value }
      };
      emit();
    },
    async unset(key) {
      calls.push({ op: "unset", key });
      if (!state.writable) throw new Error("read-only");
      const value = { ...state.value };
      delete value[key];
      const user = { ...(state.user ?? {}) };
      delete user[key];
      state = { ...state, revision: state.revision + 1, value, user: Object.keys(user).length ? user : null };
      emit();
    }
  };
}

const BUTTON = { name: "审查", prompt: "请使用 /cosmos-review 审查本提案", autoSend: true, newSession: true };

/* ── 1. 草稿构造与校验（newSession 锁定） ── */
{
  assert.deepEqual(buttonDraftOf({ name: "a", prompt: "p" }), {
    name: "a",
    prompt: "p",
    autoSend: false,
    newSession: true
  }, "草稿恒含 newSession: true");
  assert.deepEqual(buttonDraftOf({ name: "a", prompt: "p", prepend: false }), {
    name: "a",
    prompt: "p",
    autoSend: false,
    newSession: true
  }, "prepend=false 不落键");
  assert.deepEqual(buttonDraftOf({ name: "a", prompt: "p", model: { provider: "x", model: "y" } }).model, { provider: "x", model: "y" }, "model 透传");

  assert.equal(buttonIssue([{ name: "", prompt: "p" }]), "buttonNameRequired");
  assert.equal(buttonIssue([{ name: "a", prompt: "" }]), "buttonPromptRequired");
  assert.equal(buttonIssue([{ name: "a", prompt: "p" }, { name: " a ", prompt: "q" }]), "buttonDup", "trim 后重名");
  assert.equal(buttonIssue([{ name: "a", prompt: "p", newSession: false }]), "buttonNewSessionFixed", "newSession 非 true 拒绝");
  assert.equal(buttonIssue(Array.from({ length: MAX_BUTTONS + 1 }, (_v, i) => ({ name: "b" + i, prompt: "p" }))), "tooManyButtons");
  assert.equal(buttonIssue([BUTTON]), "", "合法草稿通过");
}

/* ── 2. CRUD 回显 / 暂存-保存 / 放弃修改 ── */
{
  const scope = fakeScope({ buttons: [BUTTON] });
  const face = createButtonSettingsController(scope);
  let state = face.getSnapshot();
  assert.equal(state.writable, true);
  assert.equal(state.buttonsOverridden, true, "用户层存在 buttons → 覆盖标记");
  assert.deepEqual(state.buttonsDraft, [buttonDraftOf(BUTTON)], "生效值回显为草稿");
  assert.equal(state.buttonsDirty, false);

  face.addButton();
  state = face.getSnapshot();
  assert.equal(state.buttonsDraft.length, 2, "新增追加到尾部");
  assert.equal(state.buttonsDirty, true, "新增即未保存");
  assert.equal(state.buttonsInvalid, true, "空 name 草稿非法");

  face.editButton(1, "name", "审查2");
  face.editButton(1, "prompt", "请使用 /cosmos-apply-change 执行本提案");
  face.editButton(1, "autoSend", false);
  face.editButton(1, "prepend", true);
  state = face.getSnapshot();
  assert.equal(state.buttonsInvalid, false, "补齐后合法");
  assert.equal(state.buttonsDraft[1].prepend, true);
  assert.equal(state.buttonsDraft[1].newSession, true, "newSession 恒 true");

  /* 锁定：直接写 newSession=false 被忽略 */
  face.editButton(1, "newSession", false);
  assert.equal(face.getSnapshot().buttonsDraft[1].newSession, true, "锁定项不可改");

  /* 保存 → 只写配置层 */
  const ok = await face.save();
  assert.equal(ok, true);
  const setCall = scope.calls.find((call) => call.op === "set");
  assert.ok(setCall, "保存经作用域写入");
  assert.deepEqual(setCall.value[1], {
    name: "审查2",
    prompt: "请使用 /cosmos-apply-change 执行本提案",
    autoSend: false,
    newSession: true,
    prepend: true
  }, "保存写出归一化条目（newSession 恒 true、prepend 条件键）");
  assert.ok(!("model" in setCall.value[1]), "未绑定不写 model 键");
  state = face.getSnapshot();
  assert.equal(state.buttonsDirty, false, "保存后回清未保存标记");
  assert.equal(state.failed, false);

  /* 再编辑后放弃 → 回退生效值 */
  face.editButton(0, "name", "临时改名");
  assert.equal(face.getSnapshot().buttonsDirty, true);
  face.discard();
  assert.equal(face.getSnapshot().buttonsDraft[0].name, "审查", "放弃修改回退草稿");
  assert.equal(face.getSnapshot().buttonsDirty, false);

  /* 删除 */
  face.removeButton(1);
  assert.equal(face.getSnapshot().buttonsDraft.length, 1);
  face.dispose();
}

/* ── 3. 模型/级别字段（条件键 + 先切后发的数据面） ── */
{
  const scope = fakeScope({ buttons: [BUTTON] });
  const face = createButtonSettingsController(scope);
  face.editButton(0, "model", { provider: "deepseek", model: "deepseek-chat", reasoningEffort: "max" });
  assert.deepEqual(face.getSnapshot().buttonsDraft[0].model, {
    provider: "deepseek",
    model: "deepseek-chat",
    reasoningEffort: "max"
  }, "模型三元组入草稿");
  await face.save();
  assert.deepEqual(scope.calls.find((call) => call.op === "set").value[0].model, {
    provider: "deepseek",
    model: "deepseek-chat",
    reasoningEffort: "max"
  }, "保存透传模型三元组");

  /* 解绑 → 删除 model 键（不留 undefined） */
  face.editButton(0, "model", undefined);
  assert.ok(!("model" in face.getSnapshot().buttonsDraft[0]), "解绑删除 model 键");
  face.dispose();
}

/* ── 3b. 前置状态（add-cosmos-action-prestate-gate 4.1/4.2）：草稿/保存/回显与 proto 联动 ── */
{
  /* 草稿：preState 尾部键序；proto ⇒ newSession false 且 prepend 不落键。 */
  assert.deepEqual(
    Object.keys(buttonDraftOf({ name: "a", prompt: "p", preState: "reviewed" })),
    ["name", "prompt", "autoSend", "newSession", "preState"],
    "preState 追加尾部"
  );
  assert.deepEqual(buttonDraftOf({ name: "a", prompt: "p", preState: "proto", prepend: true }), {
    name: "a",
    prompt: "p",
    autoSend: false,
    newSession: false,
    preState: "proto"
  }, "proto 行 newSession false、prepend 不落键");
  assert.equal(buttonIssue([{ name: "a", prompt: "p", preState: "proto", newSession: false }]), "", "proto 草稿合法");
  assert.equal(buttonIssue([{ name: "a", prompt: "p", preState: "doing" }]), "buttonPreStateInvalid", "漂移 preState 保存拒绝");
  assert.equal(buttonIssue([{ name: "a", prompt: "p", preState: 7 }]), "buttonPreStateInvalid", "非字符串 preState 拒绝");
  assert.equal(buttonIssue([{ name: "a", prompt: "p", preState: "reviewed", newSession: false }]), "buttonNewSessionFixed", "非 proto 行 newSession 非 true 仍拒绝");

  /* 控制器：下拉切换 → 锁定方向联动 / 保存写出 preState。 */
  const scope = fakeScope({ buttons: [{ name: "推进", prompt: "p", autoSend: false, newSession: false, preState: "proto" }] });
  const face = createButtonSettingsController(scope);
  let state = face.getSnapshot();
  assert.equal(state.buttonsDraft[0].newSession, false, "proto 生效值回显为锁定不勾选");
  assert.equal(state.buttonsDirty, false, "初始不脏");
  face.editButton(0, "preState", "reviewed");
  state = face.getSnapshot();
  assert.equal(state.buttonsDraft[0].preState, "reviewed", "preState 落草稿");
  assert.equal(state.buttonsDraft[0].newSession, true, "切离 proto → 锁定翻回勾选");
  assert.equal(await face.save(), true);
  assert.deepEqual(scope.calls.find((call) => call.op === "set").value[0], {
    name: "推进",
    prompt: "p",
    autoSend: false,
    newSession: true,
    preState: "reviewed"
  }, "保存写出 preState（尾部键序）");
  face.dispose();

  /* 切到「不限」→ 不落 preState 键（存储最小形）。 */
  const scope2 = fakeScope({ buttons: [{ name: "a", prompt: "p", preState: "created", newSession: true }] });
  const face2 = createButtonSettingsController(scope2);
  face2.editButton(0, "preState", undefined);
  assert.equal(await face2.save(), true);
  assert.ok(!("preState" in scope2.calls.find((call) => call.op === "set").value[0]), "不限 → 不写 preState 键");
  face2.dispose();

  /* 漂移值：原样回显（草稿保留）→ 保存被拒（草稿保留可修正，不写配置层）。 */
  const driftScope = fakeScope({ buttons: [{ name: "旧行", prompt: "p", preState: "doing", newSession: true }] });
  const driftFace = createButtonSettingsController(driftScope);
  state = driftFace.getSnapshot();
  assert.equal(state.buttonsDraft[0].preState, "doing", "漂移值原样回显");
  assert.equal(state.buttonsInvalid, true);
  assert.equal(state.buttonsInvalidReason, "buttonPreStateInvalid");
  assert.equal(await driftFace.save(), false, "漂移保存被拒");
  assert.equal(driftScope.calls.filter((call) => call.op === "set").length, 0, "未写配置层");
  assert.equal(driftFace.getSnapshot().buttonsDraft[0].preState, "doing", "草稿保留可修正");
  driftFace.dispose();

  /* proto 行「提示词在前」：编辑 prepend 不落键，保存不写。 */
  const protoScope = fakeScope({ buttons: [{ name: "推进", prompt: "p", preState: "proto", newSession: false }] });
  const protoFace = createButtonSettingsController(protoScope);
  protoFace.editButton(0, "prompt", "推进本提案");
  protoFace.editButton(0, "prepend", true);
  assert.ok(!("prepend" in protoFace.getSnapshot().buttonsDraft[0]), "proto 行 prepend 不落草稿");
  assert.equal(protoFace.getSnapshot().buttonsDirty, true, "其他字段真实改动 → 脏");
  assert.equal(await protoFace.save(), true, "proto 行保存成功");
  assert.ok(!("prepend" in protoScope.calls.find((call) => call.op === "set").value[0]), "proto 行保存不写 prepend");
  protoFace.dispose();

  /* 星座 profile：无前置状态控件（editButton 空操作，保存不写该键）。 */
  const constScope = fakeScope({
    buttons: [],
    constellationButtons: [{ name: "探索", prompt: "p", autoSend: false, newSession: true }]
  });
  const constFace = createButtonSettingsController(constScope, CONSTELLATION_PROFILE);
  assert.equal(CONSTELLATION_PROFILE.supportsPreState, false, "星座 profile 不呈现前置状态");
  constFace.editButton(0, "prompt", "探索本提案");
  constFace.editButton(0, "preState", "proto");
  assert.ok(!("preState" in constFace.getSnapshot().buttonsDraft[0]), "星座行无 preState");
  assert.equal(constFace.getSnapshot().buttonsDirty, true, "其他字段真实改动 → 脏");
  assert.equal(await constFace.save(), true, "星座行保存成功");
  assert.ok(!("preState" in constScope.calls.find((call) => call.op === "set").value[0]), "星座节不写 preState");
  constFace.dispose();
}

/* ── 4. 排序与边界（spec「按钮排序交互与顺序语义」） ── */
{
  const list = [1, 2, 3, 4].map((n) => ({ name: "b" + n, prompt: "p", newSession: true }));
  assert.deepEqual(moveButton(list, 2, 0).map((b) => b.name), ["b3", "b1", "b2", "b4"], "拖到首位");
  assert.deepEqual(moveButton(list, 0, 3).map((b) => b.name), ["b2", "b3", "b4", "b1"], "拖到末位");
  assert.deepEqual(moveButton(list, 1, 1).map((b) => b.name), ["b1", "b2", "b3", "b4"], "同位空操作");
  assert.deepEqual(moveButton(list, -1, 2).map((b) => b.name), ["b1", "b2", "b3", "b4"], "越界空操作");
  assert.deepEqual(moveButton(list, 0, 9).map((b) => b.name), ["b1", "b2", "b3", "b4"], "越界空操作");
  assert.notEqual(moveButton(list, 0, 1), list, "不 mutate 输入");
  assert.deepEqual(list.map((b) => b.name), ["b1", "b2", "b3", "b4"], "原数组不变");

  const buttons = [BUTTON, { name: "第二个", prompt: "p2", newSession: true }, { name: "第三个", prompt: "p3", newSession: true }];
  const scope = fakeScope({ buttons });
  const face = createButtonSettingsController(scope);
  face.moveButton(2, 0);
  assert.equal(face.getSnapshot().buttonsDirty, true, "排序只改草稿（未保存标记出现）");
  assert.deepEqual(scope.calls.filter((call) => call.op === "set"), [], "排序不写配置层");
  await face.save();
  assert.deepEqual(scope.calls.find((call) => call.op === "set").value.map((b) => b.name), ["第三个", "审查", "第二个"], "保存后数组顺序 = 展示顺序");

  /* 0/1 条时排序为空操作、无未保存标记 */
  const single = fakeScope({ buttons: [BUTTON] });
  const singleFace = createButtonSettingsController(single);
  singleFace.moveButton(0, 1);
  singleFace.moveButton(1, 0);
  assert.equal(singleFace.getSnapshot().buttonsDirty, false, "单条排序不产生未保存标记");
  assert.equal(singleFace.getSnapshot().buttonsDraft[0].name, "审查");
  singleFace.dispose();
}

/* ── 5. 覆盖标记 / 重置回组合层 ── */
{
  const scope = fakeScope({ buttons: [BUTTON], baseButtons: [{ name: "组合层", prompt: "p", autoSend: false, newSession: true }] });
  const face = createButtonSettingsController(scope);
  assert.equal(face.getSnapshot().buttonsOverridden, true);
  assert.equal(face.getSnapshot().baseButtonsCount, 1);
  const ok = await face.resetButtons();
  assert.equal(ok, true);
  assert.deepEqual(scope.calls.find((call) => call.op === "unset"), { op: "unset", key: "buttons" });
  assert.equal(face.getSnapshot().buttonsOverridden, false, "重置后覆盖标记消失");
  assert.deepEqual(face.getSnapshot().buttonsDraft, [], "回退生效值（本桩置空）");
  face.dispose();
}

/* ── 6. CAS 409 重试流（spec 场景「并发保存 CAS」） ── */
{
  const scope = fakeScope({ buttons: [] });
  const face = createButtonSettingsController(scope);
  face.addButton();
  face.editButton(0, "name", "审查");
  face.editButton(0, "prompt", "请审查本提案");
  scope.failNextSet(1);
  const first = await face.save();
  assert.equal(first, false, "冲突 → 保存未生效");
  let state = face.getSnapshot();
  assert.equal(state.failed, true, "失败标记（UI 提示「保存未生效，请重试」）");
  assert.equal(state.buttonsDirty, true, "草稿保留");
  assert.deepEqual(state.buttonsDraft[0], { name: "审查", prompt: "请审查本提案", autoSend: false, newSession: true });
  assert.equal(state.saving, false);

  const retry = await face.save();
  assert.equal(retry, true, "重试成功（revision 已随 409 刷新）");
  state = face.getSnapshot();
  assert.equal(state.failed, false);
  assert.equal(state.buttonsDirty, false);
  assert.equal(scope.calls.filter((call) => call.op === "set").length, 2, "两次写入尝试");
  face.dispose();
}

/* ── 7. 只读降级（三条通道皆缺） ── */
{
  const scope = fakeScope({ buttons: [], writable: false });
  const face = createButtonSettingsController(scope);
  assert.equal(face.getSnapshot().writable, false, "不可写（UI 呈现 notWritable）");
  face.addButton();
  assert.equal(await face.save(), false, "只读 → 保存被拒");
  assert.equal(await face.resetButtons(), false, "只读 → 重置被拒");
  assert.deepEqual(scope.calls, [], "只读路径不发起写入");
  face.dispose();

  /* 不可用快照（合成只读底座形态） */
  const readOnlyFace = createButtonSettingsController({
    getSnapshot: () => ({ status: "ready", value: {}, base: {}, user: null, revision: undefined, writable: false, mode: "host" }),
    subscribe: () => () => {},
    set: () => Promise.reject(new Error("read-only")),
    unset: () => Promise.reject(new Error("read-only"))
  });
  assert.equal(readOnlyFace.getSnapshot().available, true);
  assert.deepEqual(readOnlyFace.getSnapshot().buttonsDraft, []);
  readOnlyFace.dispose();
}

/* ── 8. 模型目录：降级 / 漂移回显 / 级别默认最高 ── */
{
  const catalog = {
    status: "ready",
    groups: [
      {
        id: "deepseek",
        name: "DeepSeek",
        models: [
          { id: "deepseek-chat", name: "Chat", reasoning: { efforts: [{ id: "low" }, { id: "medium" }, { id: "max", name: "Max" }] } },
          { id: "deepseek-reasoner", name: "Reasoner" }
        ]
      },
      { id: "other", name: "Other", models: [{ id: "m1", name: "", reasoning: { efforts: [{ id: "off" }, { id: "high" }] } }] }
    ]
  };
  assert.equal(highestEffort([{ id: "low" }, { id: "max" }, { id: "medium" }]), "max", "已知序取最大");
  assert.equal(highestEffort([{ id: "off" }, { id: "weird" }]), "weird", "未知 id → 列表末项");
  assert.equal(highestEffort([]), undefined, "无等级 → undefined");
  assert.equal(modelKeyOf({ provider: "p", model: "m" }), "p/m");
  assert.equal(modelKeyOf({ provider: "p", model: "m", reasoningEffort: "max" }), "p/m/max");

  const { items, byKey } = catalogOptions(catalog.groups);
  assert.equal(items.length, 3, "候选按 provider 分组展开");
  assert.equal(items[0].label, "DeepSeek · Chat", "label = provider.name · model.name");
  assert.equal(byKey.get("deepseek/deepseek-chat").efforts.length, 3);

  /* 降级：目录不可达 → 仅「跟随会话（默认）」+ 提示 */
  for (const broken of [null, { status: "error", groups: [] }]) {
    const view = describeButtonModel(undefined, broken);
    assert.equal(view.degraded, true, "目录不可达 → degraded");
    assert.deepEqual(view.options, [], "无候选");
    assert.equal(view.key, "", "未绑定 → 跟随");
  }

  /* 已绑定 + 目录正常：回显；级别默认取已存值 */
  const bound = describeButtonModel({ provider: "deepseek", model: "deepseek-chat" }, catalog);
  assert.equal(bound.drift, false);
  assert.equal(bound.key, "deepseek/deepseek-chat");
  assert.equal(bound.levelVisible, true, "带等级元数据 → 渲染级别下拉");
  assert.equal(bound.levelValue, "max", "未存等级 → 默认最高");
  const savedLow = describeButtonModel({ provider: "deepseek", model: "deepseek-chat", reasoningEffort: "low" }, catalog);
  assert.equal(savedLow.levelValue, "low", "已存等级原样回显");

  /* 漂移：模型不在目录 → 原样回显标不可用 */
  const drift = describeButtonModel({ provider: "vend", model: "retired" }, catalog);
  assert.equal(drift.drift, true, "模型漂移");
  assert.equal(drift.key, "vend/retired", "原样回显（不被静默改写）");
  assert.equal(drift.levelVisible, false, "漂移模型无等级元数据");

  /* 等级漂移：模型在册但等级已下线 */
  const levelDrift = describeButtonModel({ provider: "deepseek", model: "deepseek-chat", reasoningEffort: "xhigh" }, catalog);
  assert.equal(levelDrift.levelDrift, true, "等级漂移标记");
  assert.equal(levelDrift.levelValue, "xhigh", "漂移等级原样回显");

  /* 无等级模型 → 不渲染级别下拉 */
  const noLevel = describeButtonModel({ provider: "deepseek", model: "deepseek-reasoner" }, catalog);
  assert.equal(noLevel.levelVisible, false, "无等级元数据 → 不渲染级别下拉");
  assert.equal(noLevel.levelValue, undefined);

  /* 目录降级时的漂移：仍回显原名（不加「不可用」标，由 UI 依 degraded 决定文案） */
  const degradedDrift = describeButtonModel({ provider: "vend", model: "retired" }, null);
  assert.equal(degradedDrift.drift, true);
  assert.equal(degradedDrift.degraded, true);

  /* 换模型后级别按新模型等级重算（spec 场景「级别默认最高与换算」） */
  const switched = describeButtonModel({ provider: "other", model: "m1" }, catalog);
  assert.equal(switched.levelValue, "high", "新模型最高等级");
}

/* ── 9. 投影读面容错（动作条数据面） ── */
{
  const projected = buttonsSectionOf({ buttons: [BUTTON, { name: "", prompt: "x" }] });
  assert.equal(projected.length, 1);
  assert.equal(projected[0].newSession, true);
}

/* ── 10. 第二控制器实例：星座 profile（add-cosmos-constellation-actions 5.1） ── */
{
  const CONST_BUTTON = { name: "探索新需求", prompt: "请使用 /cosmos-explore 探索新需求", autoSend: false, newSession: true };

  /* 缺省 profile 恒等既有行为（快捷动作回归锁定）。 */
  assert.equal(CONSTELLATION_PROFILE.section, "constellationButtons", "星座 profile 节键");
  assert.equal(CONSTELLATION_PROFILE.supportsPrepend, false, "星座 profile 无 prepend");

  /* 草稿构造：恒无 prepend 键（即使来源带 prepend 也不复制）。 */
  assert.deepEqual(constButtonDraftOf({ name: "a", prompt: "p" }), {
    name: "a",
    prompt: "p",
    autoSend: false,
    newSession: true
  }, "星座草稿恒含 newSession、无 prepend");
  assert.deepEqual(
    Object.keys(constButtonDraftOf({ name: "a", prompt: "p", prepend: true })),
    ["name", "prompt", "autoSend", "newSession"],
    "来源 prepend 不落草稿键"
  );
  assert.deepEqual(
    constButtonDraftOf({ name: "a", prompt: "p", model: { provider: "x", model: "y" } }).model,
    { provider: "x", model: "y" },
    "model 透传"
  );

  /* 校验：星座专属错误键（UI 直接 cosmo s.settings.<key> 取文案）。 */
  assert.equal(constButtonIssue([{ name: "", prompt: "p" }]), "constButtonNameRequired");
  assert.equal(constButtonIssue([{ name: "a", prompt: "" }]), "constButtonPromptRequired");
  assert.equal(constButtonIssue([{ name: "a", prompt: "p" }, { name: " a ", prompt: "q" }]), "constButtonDup");
  assert.equal(constButtonIssue([{ name: "a", prompt: "p", newSession: false }]), "constButtonNewSessionFixed");
  assert.equal(constButtonIssue([{ name: "a", prompt: "p", prepend: true }]), "constButtonPrependRejected", "prepend 键拒绝");
  assert.equal(
    constButtonIssue(Array.from({ length: 33 }, (_v, i) => ({ name: "b" + i, prompt: "p" }))),
    "tooManyConstButtons",
    "星座上限 32（独立计数）"
  );
  assert.equal(constButtonIssue([CONST_BUTTON]), "", "合法星座草稿通过");

  /* CRUD / 保存：写 constellationButtons 节、条目无 prepend、不碰 buttons 节。 */
  const scope = fakeScope({ buttons: [BUTTON], constellationButtons: [] });
  const constFace = createButtonSettingsController(scope, CONSTELLATION_PROFILE);
  const actionFace = createButtonSettingsController(scope);
  assert.deepEqual(constFace.getSnapshot().buttonsDraft, [], "星座实例只读自己的节（buttons 非空也不渗入）");
  assert.deepEqual(actionFace.getSnapshot().buttonsDraft, [buttonDraftOf(BUTTON)], "快捷动作实例不受影响");

  constFace.addButton();
  assert.deepEqual(constFace.getSnapshot().buttonsDraft[0], { name: "", prompt: "", autoSend: false, newSession: true }, "新增行无 prepend 字段");
  constFace.editButton(0, "prepend", true);
  assert.ok(!("prepend" in constFace.getSnapshot().buttonsDraft[0]), "星座行 prepend 编辑是空操作");
  constFace.editButton(0, "name", " 探索 ");
  constFace.editButton(0, "prompt", " 请使用 /cosmos-explore 探索新需求 ");
  constFace.editButton(0, "autoSend", true);
  assert.equal(constFace.getSnapshot().buttonsInvalid, false);
  assert.equal(await constFace.save(), true);
  const setCall = scope.calls.find((call) => call.op === "set");
  assert.equal(setCall.key, "constellationButtons", "写星座节（不碰 buttons）");
  assert.deepEqual(setCall.value, [{ name: "探索", prompt: "请使用 /cosmos-explore 探索新需求", autoSend: true, newSession: true }], "保存条目无 prepend 键");
  assert.equal(scope.calls.filter((call) => call.op === "set" && call.key === "buttons").length, 0, "星座保存零写 buttons");
  assert.deepEqual(scope.getSnapshot().value.buttons, [BUTTON], "buttons 节内容不变");
  assert.equal(constFace.getSnapshot().buttonsOverridden, true, "用户层存在星座节 → 覆盖标记");
  assert.equal(actionFace.getSnapshot().buttonsDirty, false, "另一实例零干扰");

  /* 重置：只 unset 星座节。 */
  const resetScope = fakeScope({ buttons: [BUTTON], constellationButtons: [CONST_BUTTON] });
  const resetFace = createButtonSettingsController(resetScope, CONSTELLATION_PROFILE);
  assert.equal(resetFace.getSnapshot().buttonsOverridden, true);
  assert.equal(await resetFace.resetButtons(), true);
  assert.deepEqual(
    resetScope.calls.find((call) => call.op === "unset"),
    { op: "unset", key: "constellationButtons" },
    "重置只清星座节"
  );
  assert.deepEqual(resetScope.getSnapshot().value.buttons, [BUTTON], "buttons 节保留");

  /* 配置层遗留 prepend 条目：读面/草稿投影剥除该键（归一化口径），草稿本身合法；
     直接携带 prepend 的草稿违规由 constButtonIssue 拦截（上方已直测）。 */
  const leftoverScope = fakeScope({ constellationButtons: [{ name: "a", prompt: "p", prepend: true }] });
  const leftoverFace = createButtonSettingsController(leftoverScope, CONSTELLATION_PROFILE);
  assert.deepEqual(
    leftoverFace.getSnapshot().buttonsDraft,
    [{ name: "a", prompt: "p", autoSend: false, newSession: true }],
    "遗留 prepend 被投影口径剥除（回显为规范形态）"
  );
  assert.equal(leftoverFace.getSnapshot().buttonsInvalid, false);
  assert.equal(await leftoverFace.save(), false, "无修改 → 保存无动作（不产生写入）");

  /* 大小写/节隔离补充：快捷动作 profile 仍支持 prepend（既有语义零改动）。 */
  const plainScope = fakeScope({ buttons: [] });
  const plainFace = createButtonSettingsController(plainScope);
  plainFace.addButton();
  plainFace.editButton(0, "name", "p");
  plainFace.editButton(0, "prompt", "x");
  plainFace.editButton(0, "prepend", true);
  assert.equal(plainFace.getSnapshot().buttonsDraft[0].prepend, true, "快捷动作仍可设 prepend");
  assert.equal(await plainFace.save(), true);
  assert.deepEqual(
    plainScope.calls.find((call) => call.op === "set").value[0],
    { name: "p", prompt: "x", autoSend: false, newSession: true, prepend: true },
    "快捷动作保存仍写 prepend 键"
  );

  constFace.dispose();
  actionFace.dispose();
  resetFace.dispose();
  leftoverFace.dispose();
  plainFace.dispose();
}

/* ── 皮肤页签数据面（add-cosmos-skin-themes 3.4/3.6）：卡片清单与「点选即持久化」链路 ── */
{
  const { COSMOS_DEFAULT_SKIN, COSMOS_SKINS, skinCardOf } = await import("../src/cosmos/skin-registry.mjs");
  const { COSMOS_SETTINGS_VERSION, loadCosmosSettings, sanitizeCosmosSettings, saveCosmosSettings } = await import("../src/settings.mjs");

  assert.equal(COSMOS_SETTINGS_VERSION, 12, "设置面 v12（v10 = launchMode/window→dock 迁移，v11 = templateNames，v12 = 删缩放阈值两键；版本号只进不退）");
  const cards = COSMOS_SKINS.map(skinCardOf);
  assert.equal(cards.length, 12, "12 张卡片");
  assert.deepEqual(cards.map((c) => c.id), COSMOS_SKINS.map((s) => s.id), "卡片顺序 = 注册表顺序");
  assert.equal(cards.filter((c) => c.isDefault).length, 1, "默认徽标唯一");
  assert.equal(cards.find((c) => c.isDefault).id, COSMOS_DEFAULT_SKIN, "默认徽标落在 rosepine");
  for (const card of cards) {
    assert.equal(card.swatches.length, 5, card.id + ": 预览色板 5 色");
    assert.ok(card.name && card.ref, card.id + ": 名称/血统齐备");
    assert.ok(card.mode === "dark" || card.mode === "light", card.id + ": 明暗模式声明");
  }

  /* 选择 → 写持久化 → 读回（页面「所见即所得 + 下次保持」的数据链） */
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key)
  };
  try {
    assert.equal(loadCosmosSettings().skin, COSMOS_DEFAULT_SKIN, "无存储 → 默认皮肤");
    assert.equal(saveCosmosSettings({ skin: "fermata" }).skin, "fermata", "点选写入");
    assert.equal(loadCosmosSettings().skin, "fermata", "重开读回同一皮肤");
    assert.equal(sanitizeCosmosSettings(JSON.parse(store.get("dsh-v-cosmos:settings"))).skin, "fermata", "落盘载荷经净房仍合法");
    assert.equal(saveCosmosSettings({ skin: "not-a-skin" }).skin, COSMOS_DEFAULT_SKIN, "非法值写侧回落默认");
    store.set("dsh-v-cosmos:settings", "{not json");
    assert.equal(loadCosmosSettings().skin, COSMOS_DEFAULT_SKIN, "损坏载荷 → 默认（无报错）");
  } finally {
    delete globalThis.localStorage;
  }
}

/* ── 导航页签数据面（add-cosmos-zoom-focus-nav 3.1–3.4）：页签注册 / 三控件 /
   改动即持久化 + 整页热更数据链 / 非法输入净化 ── */
{
  const {
    COSMOS_SETTINGS_DEFAULTS,
    COSMOS_SETTINGS_BOUNDS,
    COSMOS_SETTINGS_VERSION,
    loadCosmosSettings,
    sanitizeCosmosSettings,
    saveCosmosSettings
  } = await import("../src/settings.mjs");

  assert.equal(COSMOS_SETTINGS_VERSION, 12, "设置面 v12（v10 = dock 迁移，v11 = templateNames，v12 = 删缩放阈值两键）");
  assert.deepEqual(
    [COSMOS_SETTINGS_DEFAULTS.zoomPointerFocus, "zoomDiveRatio" in COSMOS_SETTINGS_DEFAULTS, "zoomFlyOutRatio" in COSMOS_SETTINGS_DEFAULTS],
    [true, false, false],
    "导航组仅保留指针聚焦；两阈值键已退场"
  );
  assert.equal(COSMOS_SETTINGS_DEFAULTS.sessionPanelOpen, true, "会话列表面板缺省展开（布局偏好，add-cosmos-session-list-panel 3.3）");
  assert.equal("zoomDiveRatio" in COSMOS_SETTINGS_BOUNDS, false, "进入阈值数值界已删除");
  assert.equal("zoomFlyOutRatio" in COSMOS_SETTINGS_BOUNDS, false, "返回阈值数值界已删除");

  /* 即时生效数据链（纯面）：改动 → 写持久化 → 读回；越界/非法净化 */
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key)
  };
  try {
    const applied = saveCosmosSettings({ zoomPointerFocus: false });
    assert.equal(applied.zoomPointerFocus, false, "指针聚焦改动写入净房结果");
    assert.equal(loadCosmosSettings().zoomPointerFocus, false, "重开读回（持久化）");
    /* v11 存量（含两阈值键）读出即弃：无迁移动作、落盘不再含两键 */
    store.set("dsh-v-cosmos:settings", JSON.stringify({
      zoomDiveRatio: 80, zoomFlyOutRatio: 40, zoomPointerFocus: true, templateNames: true
    }));
    const loaded = loadCosmosSettings();
    assert.deepEqual(
      [loaded.zoomPointerFocus, loaded.templateNames, "zoomDiveRatio" in loaded, "zoomFlyOutRatio" in loaded],
      [true, true, false, false],
      "v11 存量两阈值键读出即弃，其余键保留"
    );
    saveCosmosSettings({}); // 任一写动作 → 落盘净房形状
    const disk = JSON.parse(store.get("dsh-v-cosmos:settings"));
    assert.deepEqual(
      ["zoomDiveRatio" in disk, "zoomFlyOutRatio" in disk],
      [false, false],
      "旧键不落盘（无迁移动作）"
    );
    assert.deepEqual(
      [sanitizeCosmosSettings({ zoomDiveRatio: 9999 }).zoomDiveRatio, sanitizeCosmosSettings({ zoomPointerFocus: "yes" }).zoomPointerFocus],
      [undefined, true],
      "旧阈值键净化即弃 / 非布尔指针聚焦落缺省 true"
    );
    /* 会话面板展开态（add-cosmos-session-list-panel 3.3）：同一存储通道、缺省展开、布尔净化。 */
    assert.equal(saveCosmosSettings({ sessionPanelOpen: false }).sessionPanelOpen, false, "收起写侧保留");
    assert.equal(loadCosmosSettings().sessionPanelOpen, false, "重开读回收起态");
    assert.equal(sanitizeCosmosSettings({ sessionPanelOpen: "collapse" }).sessionPanelOpen, true, "非布尔落缺省展开");
  } finally {
    delete globalThis.localStorage;
  }

  /* UI 锚点：面板组件 + 仅指针聚焦开关（两阈值数字输入退场）+ 触控/aria */
  const ui = readFileSync(new URL("../src/settings-ui.jsx", import.meta.url), "utf8");
  assert.ok(ui.includes("export function CosmosNavPanel"), "界面面板组件");
  assert.ok(ui.includes('data-plugin-anchor="dsh-v-cosmos:settings-nav"'), "界面面板插件锚点（内部 id 保持 nav）");
  assert.ok(!ui.includes('id="cosmos-nav-dive"'), "进入阈值数字输入已删除");
  assert.ok(!ui.includes('id="cosmos-nav-flyout"'), "返回阈值数字输入已删除");
  assert.ok(!ui.includes("zoomDiveRatio") && !ui.includes("zoomFlyOutRatio"), "面板不再读写两阈值键");
  assert.ok(!ui.includes("min={60}") && !ui.includes("min={10}"), "阈值数字输入界已删除");
  assert.ok(ui.includes('type="checkbox"') && ui.includes("zoomPointerFocus"), "指针聚焦开关控件保留");
  assert.ok(!ui.includes("normalize(\"zoomDiveRatio\"") && !ui.includes("commit(\"zoomDiveRatio\""), "阈值 commit/normalize 分支已删除");
  assert.ok(ui.includes("min-height:44px"), "开关触控目标 ≥44px");
  assert.ok(ui.includes('aria-label={tr(t, "cosmos.settings.navFocusAria"'), "开关 aria 文案");
  assert.ok(ui.includes("导航组：仅「指针聚焦缩放」开关"), "导航组注释声明仅剩指针聚焦");
  /* 界面尺寸组（add-cosmos-layout-tuning 5.2）：12 个字段 + 表格化渲染 + 高度键「0 = 自适应」 */
  assert.ok(ui.includes("const COSMOS_SIZE_FIELDS = Object.freeze(["), "尺寸字段表（单一来源）");
  for (const key of [
    "sessionPanelWidth", "sessionPanelHeight", "constPanelWidth", "constPanelHeight",
    "addBtnSize", "hudBtnSize", "actionBtnWidth", "actionBtnHeight",
    "constActionHeight", "searchWidth", "searchHeight", "wsTitleSize"
  ]) {
    assert.ok(ui.includes('key: "' + key + '"'), "尺寸字段注册：" + key);
  }
  for (const id of [
    "cosmos-size-session-w", "cosmos-size-session-h", "cosmos-size-const-w", "cosmos-size-const-h",
    "cosmos-size-add-btn", "cosmos-size-hud-btn", "cosmos-size-action-w", "cosmos-size-action-h",
    "cosmos-size-const-action-h", "cosmos-size-search-w", "cosmos-size-search-h", "cosmos-size-ws-title"
  ]) {
    assert.ok(ui.includes('id: "' + id + '"'), "尺寸输入稳定 id：" + id);
  }
  assert.ok(ui.includes("function CosmosSizeField(props)"), "尺寸输入子组件（本地文本草稿承接键入）");
  assert.ok(ui.includes("min-height:44px") && ui.includes(".cs-sizeInput{"), "尺寸输入触控目标 ≥44px");
  assert.ok(ui.includes('htmlFor={field.id}'), "尺寸输入 label[htmlFor] 原生可达");
  assert.ok(ui.includes("COSMOS_SIZE_FIELDS.map((field) => ("), "尺寸组按字段表渲染（12 行）");
  assert.ok(ui.includes('tr(t, "cosmos.settings.sizeAuto", "0 = 自适应")'), "高度类字段标注 0 = 自适应");
  assert.ok(ui.includes("commit(field, event.target.value, value)"), "界内即时提交（与导航输入同纪律）");
  const navPanel = ui.slice(ui.indexOf("export function CosmosNavPanel"), ui.indexOf("export function CosmosSkinPanel"));
  assert.ok(!/face\.save\(\)/.test(navPanel), "界面页签无「保存」按钮（即时生效语义）");
  assert.ok(navPanel.includes("face?.set?.(patch)"), "改动直接写 face（无草稿-保存）");
  assert.ok(navPanel.includes('tr(t, "cosmos.settings.sizeGroup", "界面尺寸")'), "面板呈现「界面尺寸」分组标题");

  /* 注册与词典（client.jsx 源码面）：order 3、nav face 注入、zh/en 成对、页签更名「界面」 */
  const client = readFileSync(new URL("../src/client.jsx", import.meta.url), "utf8");
  assert.ok(client.includes("CosmosNavPanel"), "面板组件注册");
  assert.ok(client.includes('id: "nav"'), "「界面」标签页注册（slot id 保持 nav）");
  assert.ok(client.includes('label: () => sectionT("cosmos.settings.tabInterface")'), "标签文案走更名后的词典键");
  assert.ok(client.includes("inject: () => ({ nav: navFace, selectHealth: selectHealthFace })"), "注入 nav face（受控镜像 + 写入 + 失败观测面）");
  const navTab = client.slice(client.indexOf('id: "nav"'), client.indexOf("/* 4. hero 接力消费条目"));
  assert.ok(/order: 3,/.test(navTab), "排于「皮肤」(2) 之后");
  assert.ok(client.includes('"cosmos.settings.tabInterface": "界面"'), "词典 zh：页签名「界面」");
  assert.ok(client.includes('"cosmos.settings.tabInterface": "Interface"'), "词典 en：页签名成对");
  assert.ok(!client.includes('"cosmos.settings.navDiveLabel"'), "词典 zh：进入阈值控件文案已删除");
  assert.ok(!client.includes('"cosmos.settings.navFlyOutLabel"'), "词典 zh：返回阈值控件文案已删除");
  assert.ok(!client.includes('"cosmos.settings.navDiveLabel": "Dive into constellation"'), "词典 en：进入阈值控件文案已删除");
  assert.ok(client.includes('"cosmos.settings.navHint": "缩放即导航：顶部只读标尺'), "词典 zh：navHint 改写为标尺描述");
  assert.ok(client.includes("最近星座在屏幕中心 25% 范围内"), "navHint 如实说明屏心闸门语义");
  assert.ok(client.includes('"cosmos.settings.navHint": "Zoom is navigation: the read-only ruler'), "词典 en：navHint 成对改写");
  assert.ok(client.includes('"cosmos.settings.navFocusHint": "Zoom gradually focuses'), "词典 en：开关说明");
  assert.ok(client.includes('"cosmos.settings.sizeGroup": "界面尺寸"'), "词典 zh：尺寸组标题");
  assert.ok(client.includes('"cosmos.settings.sizeGroup": "Layout sizes"'), "词典 en：尺寸组标题成对");
  assert.ok(client.includes('"cosmos.settings.sizeWsTitle": "星座标题字号"'), "词典 zh：星座标题字号");
  assert.ok(client.includes('"cosmos.settings.sizeWsTitle": "Constellation title size"'), "词典 en：星座标题字号成对");
  /* 即时生效数据链（客户端源码面）：saveNav → 净房持久化 → engine.setTuning 热更 → store */
  const saveNavSlice = client.slice(client.indexOf("saveNav(patch)"), client.indexOf("getTuning()"));
  assert.ok(saveNavSlice.includes("saveCosmosSettings(patch)"), "改动即净房持久化");
  assert.ok(saveNavSlice.includes("engine?.setTuning(merged)"), "对打开中整页热更引擎参数（无需重开）");
  assert.ok(saveNavSlice.includes("cosmosNavStore.set(navPrefsOf(merged))"), "受控镜像同步（设置页回显）");
  assert.ok(client.includes("saveNav: actions.saveNav"), "控制器顶层暴露 saveNav（设置页 face 调用链）");
  assert.ok(client.includes("selectSkin: actions.selectSkin"), "控制器顶层暴露 selectSkin（皮肤页既有链路同款）");
}

/* ── 界面尺寸数据面（add-cosmos-layout-tuning 1.3 / D2–D3）：12 键缺省 = 现值、
   合法值透传、越界夹取、非数字回落、v6 旧载荷补默认、高度 0 = 自适应、
    令牌投影（cosmosLayoutTokensOf）逐键生效 ── */
{
  const {
    COSMOS_SETTINGS_BOUNDS,
    COSMOS_SETTINGS_DEFAULTS,
    cosmosLayoutTokensOf,
    loadCosmosSettings,
    sanitizeCosmosSettings,
    saveCosmosSettings
  } = await import("../src/settings.mjs");

  const sizes = {
    sessionPanelWidth: 260, sessionPanelHeight: 0, constPanelWidth: 187, constPanelHeight: 0,
    addBtnSize: 44, hudBtnSize: 44, actionBtnWidth: 112, actionBtnHeight: 40,
    constActionHeight: 40, searchWidth: 320, searchHeight: 0, wsTitleSize: 13
  };
  assert.deepEqual(
    Object.fromEntries(Object.keys(sizes).map((key) => [key, COSMOS_SETTINGS_DEFAULTS[key]])),
    sizes,
    "12 个尺寸键缺省 = 现值（默认渲染零变化）"
  );

  /* 界内端点透传 + 越界夹取 */
  const maxes = {};
  for (const key of Object.keys(sizes)) maxes[key] = COSMOS_SETTINGS_BOUNDS[key][1];
  const overMax = {};
  for (const key of Object.keys(sizes)) overMax[key] = COSMOS_SETTINGS_BOUNDS[key][1] + 999;
  assert.deepEqual(
    Object.fromEntries(Object.keys(sizes).map((key) => [key, sanitizeCosmosSettings(maxes)[key]])),
    maxes,
    "界内端点原样保留"
  );
  assert.deepEqual(
    Object.fromEntries(Object.keys(sizes).map((key) => [key, sanitizeCosmosSettings(overMax)[key]])),
    maxes,
    "越界一律落界内端点"
  );
  assert.deepEqual(
    Object.fromEntries(Object.keys(sizes).map((key) => [key, sanitizeCosmosSettings({ [key]: "x" })[key]])),
    sizes,
    "非数字回落缺省"
  );
  assert.equal(sanitizeCosmosSettings({ sessionPanelHeight: 0 }).sessionPanelHeight, 0, "高度 0 = 自适应（合法值，不被 falsy 吞掉）");
  assert.equal(sanitizeCosmosSettings({ sessionPanelHeight: 640 }).sessionPanelHeight, 640, "高度 >0 透传（上限语义）");

  /* v6 旧载荷（无尺寸键）→ 补默认；持久化往返 */
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key)
  };
  try {
    store.set("dsh-v-cosmos:settings", JSON.stringify({ panSpeed: 120, dragPan: true }));
    assert.equal(loadCosmosSettings().sessionPanelWidth, 260, "v6 旧载荷（无尺寸键）→ 读面补默认");
    const applied = saveCosmosSettings({ sessionPanelWidth: 320, hudBtnSize: 56, searchWidth: 420, wsTitleSize: 16, sessionPanelHeight: 600, searchHeight: 36 });
    assert.deepEqual(
      [applied.sessionPanelWidth, applied.hudBtnSize, applied.searchWidth, applied.wsTitleSize, applied.sessionPanelHeight, applied.searchHeight],
      [320, 56, 420, 16, 600, 36],
      "尺寸写入即净房落盘"
    );
    assert.deepEqual(
      [loadCosmosSettings().sessionPanelWidth, loadCosmosSettings().hudBtnSize],
      [320, 56],
      "重开读回（持久化）"
    );
    assert.equal(JSON.parse(store.get("dsh-v-cosmos:settings")).hudBtnSize, 56, "落盘载荷含尺寸键");
    assert.equal(saveCosmosSettings({ hudBtnSize: 999 }).hudBtnSize, COSMOS_SETTINGS_BOUNDS.hudBtnSize[1], "非法写侧夹取");
  } finally {
    delete globalThis.localStorage;
  }

  /* 令牌投影（纯函数）：缺省 → 现值 + 高度 none；自定义逐键生效；0 → 自适应 */
  const defaults = cosmosLayoutTokensOf(COSMOS_SETTINGS_DEFAULTS);
  assert.equal(defaults["--cos-session-w"], "260px");
  assert.equal(defaults["--cos-session-h"], "none", "面板高度 0 → none（自适应，现状）");
  assert.equal(defaults["--cos-const-panel-h"], "none");
  assert.equal(defaults["--cos-search-h"], "0px", "搜索框最小高 0 = 自适应");
  assert.equal(defaults["--cos-ws-title-size"], "13px");
  const custom = cosmosLayoutTokensOf({ ...COSMOS_SETTINGS_DEFAULTS, sessionPanelHeight: 600, constPanelWidth: 220, addBtnSize: 50, actionBtnHeight: 48, constActionHeight: 44 });
  assert.deepEqual(
    [custom["--cos-session-h"], custom["--cos-const-panel-w"], custom["--cos-add-btn-size"], custom["--cos-action-btn-h"], custom["--cos-const-action-h"]],
    ["600px", "220px", "50px", "48px", "44px"],
    "自定义值逐键投影"
  );
}

/* ── 拖拽平移开关净房（add-cosmos-drag-pan-toggle 1.2 / D4）：v5 → v6 布尔键
   `dragPan`，缺省 false（默认关闭）、合法 true 透传、手工坏值回落、v5 旧载荷补默认 ── */
{
  const {
    COSMOS_SETTINGS_DEFAULTS,
    COSMOS_SETTINGS_VERSION,
    loadCosmosSettings,
    sanitizeCosmosSettings,
    saveCosmosSettings
  } = await import("../src/settings.mjs");

  assert.equal(COSMOS_SETTINGS_VERSION, 12, "设置面版本（拖拽平移键仍在册；v10 = dock，v11 = templateNames，v12 = 删缩放阈值两键）");
  assert.equal(COSMOS_SETTINGS_DEFAULTS.dragPan, false, "出厂默认关闭（鼠标拖拽保持旋转）");
  assert.equal(sanitizeCosmosSettings({}).dragPan, false, "空载荷 → false");
  assert.equal(sanitizeCosmosSettings({ dragPan: true }).dragPan, true, "合法 true 透传（开启态）");
  assert.equal(sanitizeCosmosSettings({ dragPan: false }).dragPan, false, "显式 false 保留");
  for (const bad of ["on", "true", "", 1, 0, null, undefined, {}, []]) {
    assert.equal(sanitizeCosmosSettings({ dragPan: bad }).dragPan, false, "非布尔回落 false：" + String(bad));
  }

  /* v5 载荷（无 dragPan 键）→ 补默认 false（无迁移动作、无报错） */
  const v5Payload = {
    panSpeed: 120, panShiftBoost: 3, skin: "rosepine",
    zoomPointerFocus: true, sessionPanelOpen: true, constPreflight: "float"
  };
  assert.equal(sanitizeCosmosSettings(v5Payload).dragPan, false, "v5 载荷读出补默认 false");

  /* 净房键互相零影响（同批写入不干扰既有键） */
  const mixed = sanitizeCosmosSettings({ ...COSMOS_SETTINGS_DEFAULTS, dragPan: true });
  assert.deepEqual(
    [mixed.constPreflight, mixed.skin, mixed.zoomPointerFocus],
    ["float", "rosepine", true],
    "dragPan 写入不扰动其余键"
  );

  /* 持久化读写（同一存储通道）：开启 → 读回开启；手工坏值 → 净化落缺省 */
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key)
  };
  try {
    assert.equal(saveCosmosSettings({ dragPan: true }).dragPan, true, "开关开启写侧保留");
    assert.equal(loadCosmosSettings().dragPan, true, "重开读回开启态（持久化）");
    assert.equal(JSON.parse(store.get("dsh-v-cosmos:settings")).dragPan, true, "落盘载荷含 dragPan=true");
    assert.equal(saveCosmosSettings({ dragPan: "on" }).dragPan, false, "非法写侧回落 false");
    store.set("dsh-v-cosmos:settings", JSON.stringify({ ...v5Payload }));
    assert.equal(loadCosmosSettings().dragPan, false, "磁盘 v5 载荷（无该键）→ 读面补默认");
    store.set("dsh-v-cosmos:settings", JSON.stringify({ ...v5Payload, dragPan: 1 }));
    assert.equal(loadCosmosSettings().dragPan, false, "磁盘手工坏值（数字）→ 净化落缺省（无报错）");
  } finally {
    delete globalThis.localStorage;
  }

  /* 写穿链路（add-cosmos-drag-pan-toggle 4.1；client.jsx 源码锚点——Controller 需 React
     context 不可在 Node 直测，与 saveNav 同款静态面断言）：引擎点击 → 净房持久化 →
     既有 setTuning 热更回读（值恒等幂等，无第二写入通道）。 */
  const client = readFileSync(new URL("../src/client.jsx", import.meta.url), "utf8");
  assert.equal((client.match(/onDragPanToggle:/g) ?? []).length, 1, "开关回调注入唯一（引擎创建 opts 单点）");
  const toggleSlice = client.slice(client.indexOf("onDragPanToggle:"), client.indexOf("onDragPanToggle:") + 420);
  assert.ok(toggleSlice.includes("saveCosmosSettings({ dragPan: enabled === true })"), "回调净房写盘（唯一持久化通道）");
  assert.ok(toggleSlice.includes("engine?.setTuning(merged)"), "既有 setTuning 热更回读（无需重开整页）");
  assert.ok(toggleSlice.includes("return merged"), "回传净房后的完整设置（观测值）");
  const attachSlice = client.slice(client.indexOf("attach(container) {"), client.indexOf("detach() {"));
  assert.ok(attachSlice.includes("settings, // 平移调参"), "引擎创建透传设置面（dragPan 初值同源，冷启动即开启态）");
  assert.ok(!/cosmosNavStore\.set\([^)]*dragPan/.test(client), "开关不进导航 store（无设置页控件，对照 sessionPanelOpen 先例）");
}

/* ── 每按钮「执行后跳转」（fix-cosmos-const-float-send-close 4.1/4.2/4.4）：
   按钮配置可选 `jumpNewSession`（缺省 true = 跳转；仅 false 落键）；草稿/编辑/保存
   与归一化同形；UI 面 = 快捷动作行内勾选框（缺省勾选、参与暂存-保存、随可写性禁用；
   星座行不呈现）。页面偏好面 MUST NOT 含该语义。 ── */
{
  const { buttonDraftOf: draftOf, buttonIssue: issueOf, createButtonSettingsController: createController, CONSTELLATION_PROFILE: CONST_PROFILE } = await import("../src/button-settings.mjs");
  const { normalizeButtons } = await import("../src/buttons.mjs");

  /* 归一化：缺省/true 不落键，false 落键，非布尔拒绝 */
  assert.equal("jumpNewSession" in normalizeButtons([{ name: "a", prompt: "p" }])[0], false, "缺省 → 不落键（缺省跳转）");
  assert.equal(normalizeButtons([{ name: "a", prompt: "p", jumpNewSession: true }])[0].jumpNewSession, undefined, "显式 true → 不落键（存储最小形）");
  assert.equal(normalizeButtons([{ name: "a", prompt: "p", jumpNewSession: false }])[0].jumpNewSession, false, "false 透传落键");
  assert.throws(() => normalizeButtons([{ name: "a", prompt: "p", jumpNewSession: "no" }]), /jumpNewSession must be a boolean/, "非布尔拒绝");
  assert.deepEqual(
    Object.keys(normalizeButtons([{ name: "a", prompt: "p", jumpNewSession: false, prepend: true }])[0]),
    ["name", "prompt", "autoSend", "newSession", "jumpNewSession", "prepend"],
    "键序：jumpNewSession 位于 newSession 与 prepend 之间"
  );

  /* 草稿构造：缺省不带键；取消勾选落 false；恢复勾选删键 */
  const base = draftOf({ name: "a", prompt: "p" });
  assert.equal("jumpNewSession" in base, false, "草稿缺省不带跳转键");
  assert.equal(draftOf({ name: "a", prompt: "p", jumpNewSession: false }).jumpNewSession, false, "草稿保留 false");
  assert.equal("jumpNewSession" in draftOf({ name: "a", prompt: "p", jumpNewSession: true }), false, "草稿 true 归一为缺键");
  assert.equal(issueOf([base]), "", "合法草稿通过（缺键）");

  /* 控制器：编辑 → 草稿脏；保存 → 落键；恢复勾选 → 删键并干净 */
  const scope = fakeScope({ buttons: [{ ...BUTTON }] });
  const face = createController(scope);
  face.editButton(0, "jumpNewSession", false);
  let state = face.getSnapshot();
  assert.equal(state.buttonsDraft[0].jumpNewSession, false, "取消勾选进草稿");
  assert.equal(state.buttonsDirty, true, "跳转编辑触发未保存标记");
  assert.equal(state.invalid, false, "跳转字段不产生校验错误");
  assert.equal(await face.save(), true);
  assert.equal(scope.calls.find((call) => call.op === "set").value[0].jumpNewSession, false, "保存落 jumpNewSession: false");
  face.editButton(0, "jumpNewSession", true);
  state = face.getSnapshot();
  assert.equal("jumpNewSession" in state.buttonsDraft[0], false, "恢复勾选删除键");
  assert.equal(state.buttonsDirty, true, "相对已存 false 仍有差异");
  await face.save();
  assert.equal("jumpNewSession" in scope.calls.filter((call) => call.op === "set").pop().value[0], false, "恢复跳转后保存不写键");
  face.dispose();

  /* 星座 profile：不支持跳转字段（编辑为空操作、保存不写键） */
  const cscope = fakeScope({ constellationButtons: [{ name: "c", prompt: "p" }] });
  const cface = createController(cscope, CONST_PROFILE);
  cface.editButton(0, "jumpNewSession", false);
  assert.equal("jumpNewSession" in cface.getSnapshot().buttonsDraft[0], false, "星座草稿不产生跳转键");
  cface.dispose();

  /* UI 锚点（settings-ui.jsx 源码面） */
  const ui = readFileSync(new URL("../src/settings-ui.jsx", import.meta.url), "utf8");
  assert.ok(ui.includes("showJump: true") && ui.includes("showJump: false"), "跳转勾选框按 variant 门控（星座不呈现）");
  assert.ok(ui.includes("{copy.showJump ? ("), "行内跳转勾选框按 copy 门控");
  assert.ok(ui.includes('checked={button.jumpNewSession !== false}'), "勾选态 = 缺省跳转");
  assert.ok(/face\.editButton\(index, "jumpNewSession", event\.target\.checked\)/.test(ui), "切换走按钮行草稿编辑（暂存-保存模型）");
  assert.ok(ui.includes('disabled={disabled}'), "行内编辑控件随可写性禁用（既有纪律）");
  assert.ok(ui.includes('className="cs-auto cs-locked"'), "行内「新增会话」锁定徽标保留");
  assert.ok(ui.includes("copyText(copy.newSessionTitle)"), "锁定徽标 title 保留");
  assert.ok(!/cs-pref/.test(ui), "页面级设置区已移除（跳转下沉为每按钮配置）");
}

/* ── 「发送前编辑」呈现设置 `constPreflight`（add-cosmos-native-composer 1.1/1.2/4.1–4.3；
   rework：缺省翻转为 float（星空保持优先）、native 语义归位「关页跳转会话页」）：
   v5 枚举键净房（缺省 float / 非法回落 / 合法双值透传 / 其余键零影响）+ 持久化 +
   星座动作页签开关（独立轻量 face：即时写回、不随按钮暂存-保存、不受按钮 saving 门控） ── */
{
  const {
    COSMOS_DEFAULT_PREFLIGHT,
    COSMOS_PREFLIGHT_MODES,
    COSMOS_SETTINGS_DEFAULTS,
    loadCosmosSettings,
    sanitizeCosmosSettings,
    saveCosmosSettings
  } = await import("../src/settings.mjs");

  /* 枚举与缺省（rework：缺省 float = 浮窗输入器、星空保持；native = 关页跳转会话页） */
  assert.deepEqual([...COSMOS_PREFLIGHT_MODES], ["native", "float"], "枚举恰为 native / float");
  assert.equal(COSMOS_DEFAULT_PREFLIGHT, "float", "缺省分支 = float（星空保持优先）");
  assert.equal(COSMOS_SETTINGS_DEFAULTS.constPreflight, "float", "出厂默认 = float");
  assert.ok(Object.isFrozen(COSMOS_PREFLIGHT_MODES), "枚举表冻结（只读）");
  /* 缺省读出：空载荷 / v4 旧载荷（无该键）→ float */
  assert.equal(sanitizeCosmosSettings({}).constPreflight, "float", "空载荷 → float");
  assert.equal(
    sanitizeCosmosSettings({ skin: "lotus", sessionPanelOpen: false }).constPreflight,
    "float",
    "v4 旧载荷 → float（逐键补默认）"
  );
  /* 非法值回落缺省（含近义串 / 非字符串 / 空串），SHALL NOT 抛错 */
  for (const bad of ["auto", "", "Native", " native ", "FLOAT", "floaty", 123, null, undefined, true, {}, [], 0]) {
    assert.equal(sanitizeCosmosSettings({ constPreflight: bad }).constPreflight, "float", "非法值回落 float：" + String(bad));
  }
  /* 合法双值透传 */
  assert.equal(sanitizeCosmosSettings({ constPreflight: "native" }).constPreflight, "native");
  assert.equal(sanitizeCosmosSettings({ constPreflight: "float" }).constPreflight, "float");
  /* 其余键零影响 */
  const { constPreflight: _baselineMode, ...baselineRest } = COSMOS_SETTINGS_DEFAULTS;
  for (const mode of COSMOS_PREFLIGHT_MODES) {
    const applied = sanitizeCosmosSettings({ ...COSMOS_SETTINGS_DEFAULTS, constPreflight: mode });
    const { constPreflight: modeOut, ...rest } = applied;
    assert.equal(modeOut, mode, "枚举透传：" + mode);
    assert.deepEqual(rest, baselineRest, "切换 " + mode + " 不波及其余设置键");
  }

  /* 写侧持久化：切换即时写回 → 重开读回（执行器每次 run 现读的事实基础） */
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key)
  };
  try {
    assert.equal(loadCosmosSettings().constPreflight, "float", "无存储 → 缺省 float");
    store.set("dsh-v-cosmos:settings", JSON.stringify({ panSpeed: 200 }));
    assert.equal(loadCosmosSettings().constPreflight, "float", "v4 旧载荷（无该键）读出 float");
    assert.equal(saveCosmosSettings({ constPreflight: "native" }).constPreflight, "native", "切换写侧保留");
    assert.equal(loadCosmosSettings().constPreflight, "native", "重开读回 native（切换即时生效）");
    assert.equal(saveCosmosSettings({ constPreflight: "bogus" }).constPreflight, "float", "非法写侧回落 float");
    assert.equal(saveCosmosSettings({ constPreflight: "float", skin: "fermata" }).skin, "fermata", "同批写入不互相干扰");

    /* 按钮草稿流与本键正交：暂存 / 放弃 / 保存 / 重置均不读写该键 */
    saveCosmosSettings({ constPreflight: "float" });
    const scope = fakeScope({ buttons: [{ ...BUTTON }] });
    const face = createButtonSettingsController(scope);
    face.editButton(0, "autoSend", false);
    assert.equal(loadCosmosSettings().constPreflight, "float", "按钮草稿编辑不动该键");
    face.discard();
    assert.equal(loadCosmosSettings().constPreflight, "float", "放弃按钮草稿不回滚该键");
    face.editButton(0, "autoSend", true);
    await face.save();
    assert.equal(loadCosmosSettings().constPreflight, "float", "保存按钮草稿不覆盖该键");
    face.dispose();
    const resetScope = fakeScope({ buttons: [{ ...BUTTON }] });
    const resetFace = createButtonSettingsController(resetScope);
    await resetFace.resetButtons();
    assert.equal(loadCosmosSettings().constPreflight, "float", "重置按钮为组合层不动该键");
    resetFace.dispose();
  } finally {
    delete globalThis.localStorage;
  }

  /* UI 锚点（settings-ui.jsx 源码面）：星座动作页签顶部下拉，独立 face、即时写回 */
  const ui = readFileSync(new URL("../src/settings-ui.jsx", import.meta.url), "utf8");
  assert.ok(ui.includes("showPreflight: true") && ui.includes("showPreflight: false"), "开关按页签门控（快捷动作不呈现）");
  assert.ok(ui.includes("{copy.showPreflight ? ("), "星座动作页签渲染开关块");
  assert.ok(ui.includes('id="cosmos-const-preflight"'), "开关控件稳定 id");
  assert.ok(ui.includes('data-preflight={preflightMode}'), "开关态稳定钩子");
  assert.ok(ui.includes("preflight ? preflight.subscribe : noopSubscribe"), "订阅 preflight face（受控镜像回显）");
  assert.ok(ui.includes("preflight?.set?.(mode);"), "切换走 face.set（无草稿-保存）");
  assert.ok(ui.includes('value="native"') && ui.includes('value="float"'), "两分支选项齐备");
  /* rework：缺省翻转 → 非显式 native 一律按 float（受控镜像兜底方向） */
  assert.ok(ui.includes('preflightState.constPreflight === "native"'), "镜像取值只认显式 native");
  assert.ok(ui.includes('htmlFor="cosmos-const-preflight"') && ui.includes("aria-describedby=\"cosmos-const-preflight-hint\""), "标签关联 + hint 描述（可达性）");
  assert.ok(ui.includes("min-height:44px"), "开关行触控目标 ≥44px");
  const block = ui.slice(
    ui.indexOf('data-plugin-anchor="dsh-v-cosmos:settings-const-preflight"'),
    ui.indexOf("{catalogDegraded ?")
  );
  assert.ok(block.length > 0, "开关块切片可达");
  assert.ok(!/disabled=/.test(block), "开关不受按钮 writable/saving 门控禁用");
  assert.ok(!/face\.editButton/.test(block), "开关不写按钮草稿（MUST NOT 纳入暂存-保存流）");

  /* 注册与词典（client.jsx 源码面） */
  const client = readFileSync(new URL("../src/client.jsx", import.meta.url), "utf8");
  assert.ok(
    client.includes('inject: () => ({ face: constButtonSettings, models: modelsFace, variant: "constellation", preflight: preflightFace, shortcuts: shortcutsFace, drafts: buttonDraftsFace })'),
    "星座动作页签注入 preflight face（与按钮 face 正交；add-cosmos-shortcuts 起并注入快捷键/跨域数据面）"
  );
  const pfFace = client.slice(client.indexOf("const preflightFace = {"), client.indexOf('id: "constellation-actions"'));
  assert.ok(pfFace.includes("controllerRef.current == null"), "控制器存活前置检查同款");
  assert.ok(pfFace.includes('markSelectFailure("preflight")'), "控制器缺失落印 health 失败（可观测）");
  assert.ok(pfFace.includes("controllerRef.current.savePreflight?.(mode)"), "写入唯一链路 = 控制器 savePreflight");
  assert.ok(client.includes("savePreflight: actions.savePreflight"), "控制器顶层暴露 savePreflight（face 调用链）");
  const savePreflightSlice = client.slice(client.indexOf("savePreflight(mode) {"), client.indexOf("getTuning() {"));
  assert.ok(savePreflightSlice.includes("saveCosmosSettings({ constPreflight: mode })"), "改动即净房持久化");
  assert.ok(savePreflightSlice.includes("cosmosPreflightStore.set(preflightPrefsOf(merged))"), "受控镜像同步（设置页回显）");
  assert.ok(client.includes("const cosmosPreflightStore = createSnapshotStore(preflightPrefsOf(loadCosmosSettings()));"), "模块级镜像 store 冷启动取持久化值");
  /* 执行链路接线（3.1）：每次 run 现读设置面 + native 分支关整页 */
  const constExecutorBody = client.slice(
    client.indexOf("const constExecutor = createConstellationExecutor({"),
    client.indexOf("const clearPendingDive")
  );
  assert.ok(
    constExecutorBody.includes("preflight: () => loadCosmosSettings().constPreflight,"),
    "执行器现读设置面（MUST NOT 构造期缓存；无形态改写）"
  );
  assert.ok(
    constExecutorBody.includes("closePage: () => closePageAfterJump(),"),
    "native 分支关页经统一裁决（embedded 关整页 / dock no-op）"
  );
  assert.ok(constExecutorBody.includes("pending: heroMarkers,") && constExecutorBody.includes("floats: floatMarkers,"), "双通道注入不变（native 复用 hero / float 保留浮窗）");
  /* 回归确认（3.2）：hero 消费器零改动即承接 native 落稿；浮窗组件承载增强（不读 preflight 设置——分流在执行器） */
  const heroDockBody = client.slice(
    client.indexOf("function ActionHeroDock(props)"),
    client.indexOf("function ConstellationFloatDock(props)")
  );
  assert.ok(heroDockBody.length > 0 && !/preflight/.test(heroDockBody), "hero 消费器零改动（meta.channel 不参与消费判定）");
  const floatDockBody = client.slice(
    client.indexOf("function ConstellationFloatDock(props)"),
    client.indexOf("星胚动作消费条目")
  );
  assert.ok(!/preflight/.test(floatDockBody), "浮窗组件不读呈现分支设置（分流在执行器）");
  assert.ok(client.includes('id: "v-cosmos-constellation-float"'), "浮窗注册条目保留");
  /* DICT zh/en 成对（各 2 次：zh + en） */
  for (const key of ["constPreflightLabel", "constPreflightAria", "constPreflightNative", "constPreflightFloat", "constPreflightHint", "constPreflightInstant"]) {
    assert.equal(
      (client.match(new RegExp('"cosmos\\.settings\\.' + key + '"', "g")) ?? []).length,
      2,
      "词典 zh/en 成对：cosmos.settings." + key
    );
  }
  assert.ok(client.includes('"cosmos.settings.constPreflightNative": "跳转会话页（原生输入区）"'), "词典 zh：native 分支语义 = 关页跳转会话页");
  assert.ok(client.includes('"cosmos.settings.constPreflightNative": "Jump to the session page (native composer)"'), "词典 en：native 分支语义成对");
  assert.ok(client.includes('"cosmos.settings.constPreflightFloat": "浮窗补写（星空保持，缺省）"'), "词典 zh：float 分支 = 浮窗（缺省）");
  assert.ok(client.includes('"cosmos.settings.constPreflightFloat": "Floating composer (cosmos stays open, default)"'), "词典 en：float 分支语义成对");
  assert.ok(client.includes("模型选择与语音转写在浮窗内直接可用"), "词典 zh：hint 标注浮窗增强能力");
  assert.ok(client.includes("with model picking and voice transcription built in"), "词典 en：hint 成对（浮窗增强）");
  /* 设置面板选项兜底文案同步（settings-ui 源码面） */
  assert.ok(ui.includes('errorText("constPreflightNative", "跳转会话页（原生输入区）")'), "面板 native 选项兜底文案");
  assert.ok(ui.includes('errorText("constPreflightFloat", "浮窗补写（星空保持，缺省）")'), "面板 float 选项兜底文案");
  /* 提示口径核对：缺省 = 浮窗（星空保持）；旧「浮动原生窗口」死设计口径零残留 */
  assert.ok(client.includes('未勾选时按下方「发送前编辑」分流'), "词典 zh：星座 hint 与开关语义对齐");
  assert.ok(!/浮动原生输入窗口/.test(client) && !/原生窗口呈现通道/.test(client), "词典不得残留「浮动原生窗口」死设计口径");
}

/* ── 全局快捷键净房 v8（add-cosmos-shortcuts 2.1/2.2 / spec cosmos-shortcuts
      「缺省键位与净房」）：v8 净房、v7 补默认、漂移回落、读面冲突固定优先序
      （设置面随后升 v10 = add-cosmos-rightbar-dock 的 dock 迁移；本块键面无变化）。 ── */
{
  const {
    COSMOS_SETTINGS_DEFAULTS,
    COSMOS_SETTINGS_VERSION,
    loadCosmosSettings,
    sanitizeCosmosSettings,
    saveCosmosSettings
  } = await import("../src/settings.mjs");
  const {
    SHORTCUT_DEFAULTS,
    SHORTCUT_FIELDS,
    SHORTCUT_GLOBAL_KEYS,
    shortcutLabelOf
  } = await import("../src/shortcuts.mjs");

  assert.equal(COSMOS_SETTINGS_VERSION, 12, "设置面 v12（shortcuts 子对象 + launchMode + templateNames + 删缩放阈值两键并入；v10 = dock 迁移）");
  assert.deepEqual(
    COSMOS_SETTINGS_DEFAULTS.shortcuts,
    { closePage: "Escape", goHome: "Backquote", togglePan: "KeyM", voiceToggle: "Ctrl+KeyQ" },
    "四键缺省遵用户裁决"
  );
  assert.deepEqual(Object.keys(COSMOS_SETTINGS_DEFAULTS.shortcuts), SHORTCUT_FIELDS, "子对象键序 = 冲突优先序");
  assert.ok(Object.isFrozen(COSMOS_SETTINGS_DEFAULTS.shortcuts), "缺省子对象冻结（防误改）");
  /* 构造头注记：v10 = add-cosmos-rightbar-dock（v9 = 历史独立窗口变更，v8 = add-cosmos-shortcuts） */
  const settingsSource = readFileSync(new URL("../src/settings.mjs", import.meta.url), "utf8");
  assert.ok(settingsSource.includes("设置面（version 12"), "文档头版本注记同步 v12");
  assert.ok(settingsSource.includes("shortcutsOf(source.shortcuts)"), "净房接线 shortcutsOf（单一来源）");

  /* v8 净房：空载荷 → 四键缺省；合法值透传；与 shortcutsOf 同源 */
  assert.deepEqual(sanitizeCosmosSettings({}).shortcuts, { ...SHORTCUT_DEFAULTS }, "空载荷 → 四键缺省");
  const custom = { closePage: "F2", goHome: "Alt+KeyH", togglePan: "Digit7", voiceToggle: "Alt+KeyQ" };
  assert.deepEqual(sanitizeCosmosSettings({ shortcuts: custom }).shortcuts, custom, "合法四键透传");
  /* v7 载荷（无 shortcuts 键）→ 补默认（零迁移） */
  const v7 = {
    panSpeed: 120, panShiftBoost: 3, skin: "deepspace",
    zoomPointerFocus: true, sessionPanelOpen: true, constPreflight: "float", dragPan: false
  };
  assert.deepEqual(sanitizeCosmosSettings(v7).shortcuts, { ...SHORTCUT_DEFAULTS }, "v7 载荷读出补默认四键");
  /* 漂移值净化（池外 / 非字符串 / 空串 → 回落缺省，不抛错） */
  assert.equal(sanitizeCosmosSettings({ shortcuts: { goHome: "F5" } }).shortcuts.goHome, "Backquote", "池外回落缺省");
  assert.equal(sanitizeCosmosSettings({ shortcuts: { goHome: 123 } }).shortcuts.goHome, "Backquote", "非字符串回落缺省");
  assert.equal(sanitizeCosmosSettings({ shortcuts: { closePage: "" } }).shortcuts.closePage, "Escape", "空串回落缺省");
  /* 读面冲突固定优先序（spec 场景「手工冲突读面确定性」） */
  const conflicted = sanitizeCosmosSettings({ shortcuts: { closePage: "KeyN", goHome: "KeyN" } }).shortcuts;
  assert.equal(conflicted.closePage, "KeyN", "closePage 优先保留");
  assert.equal(conflicted.goHome, "Backquote", "goHome 冲突回落缺省");
  assert.equal(new Set(Object.values(conflicted)).size, 4, "净房结果恒无重复（分发器零仲裁）");
  /* 池同源：设置页下拉候选 = SHORTCUT_GLOBAL_KEYS（单一常量表导出） */
  assert.ok(SHORTCUT_GLOBAL_KEYS.includes("Ctrl+KeyQ"), "缺省语音键在池内");
  assert.equal(shortcutLabelOf("Ctrl+KeyQ"), "Ctrl+Q", "下拉/说明标签同源");

  /* 写穿数据链：save → 落盘 → 读回（轻量偏好即时保存语义） */
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key)
  };
  try {
    assert.deepEqual(loadCosmosSettings().shortcuts, { ...SHORTCUT_DEFAULTS }, "无存储 → 缺省");
    const saved = saveCosmosSettings({ shortcuts: { goHome: "F2" } });
    assert.equal(saved.shortcuts.goHome, "F2", "写侧落新值");
    assert.equal(saved.shortcuts.togglePan, "KeyM", "部分写：其余键保持缺省");
    assert.equal(loadCosmosSettings().shortcuts.goHome, "F2", "读回生效");
    assert.deepEqual(
      JSON.parse(store.get("dsh-v-cosmos:settings")).shortcuts,
      { closePage: "Escape", goHome: "F2", togglePan: "KeyM", voiceToggle: "Ctrl+KeyQ" },
      "落盘形状 = v8 净房结果"
    );
    /* 手工改坏子对象（非对象 / 字符串）→ 读面回落缺省（SHALL NOT 抛错） */
    store.set("dsh-v-cosmos:settings", JSON.stringify({ shortcuts: "nope" }));
    assert.deepEqual(loadCosmosSettings().shortcuts, { ...SHORTCUT_DEFAULTS }, "子对象非对象 → 四键缺省");
    store.set("dsh-v-cosmos:settings", JSON.stringify({ shortcuts: { goHome: "KeyW" } }));
    assert.equal(loadCosmosSettings().shortcuts.goHome, "Backquote", "WASD 保留键落回缺省");
  } finally {
    delete globalThis.localStorage;
  }
}

/* ── 按钮快捷键字段（add-cosmos-shortcuts 3.3/3.4/7.2/7.3 / spec cosmos-button-settings
      「按钮快捷键设置字段」）：草稿尾部落键 / 漂移保留 / 枚举校验 / 保存写穿 /
      跨域并集查重（controller crossIssue 保存门）/ 设置页源码锚点。 ── */
{
  /* 1) 草稿构造：尾部落键（preState 之后）；「无」= 不落键；漂移值原样保留 */
  assert.deepEqual(buttonDraftOf({ name: "a", prompt: "p", shortcut: "Digit1" }), {
    name: "a",
    prompt: "p",
    autoSend: false,
    newSession: true,
    shortcut: "Digit1"
  }, "草稿尾部落 shortcut（键序）");
  assert.equal("shortcut" in buttonDraftOf({ name: "a", prompt: "p", shortcut: "" }), false, "「无」（空串）不落键");
  assert.equal("shortcut" in buttonDraftOf({ name: "a", prompt: "p" }), false, "缺省不落键（存储最小形）");
  assert.deepEqual(
    Object.keys(buttonDraftOf({ name: "a", prompt: "p", preState: "reviewed", model: { provider: "x", model: "y" }, shortcut: "F4" })),
    ["name", "prompt", "autoSend", "newSession", "model", "preState", "shortcut"],
    "键序：shortcut 恒在尾部（preState 之后）"
  );
  assert.equal(buttonDraftOf({ name: "a", prompt: "p", shortcut: "  F8  " }).shortcut, "F8", "trim 后落键");
  assert.equal(buttonDraftOf({ name: "a", prompt: "p", shortcut: "KeyQ" }).shortcut, "KeyQ", "漂移值原样保留（回显「不可用」）");
  assert.deepEqual(
    Object.keys(constButtonDraftOf({ name: "a", prompt: "p", model: { provider: "x", model: "y" }, shortcut: "Digit2" })),
    ["name", "prompt", "autoSend", "newSession", "model", "shortcut"],
    "星座草稿键序：model → shortcut"
  );

  /* 2) 校验：仅按钮键域枚举合法（漂移值可回显、保存拒绝） */
  for (const good of ["Digit0", "Digit9", "F2", "F4", "F8", "F9"]) {
    assert.equal(buttonIssue([{ name: "a", prompt: "p", shortcut: good }]), "", "合法快捷键：" + good);
    assert.equal(constButtonIssue([{ name: "a", prompt: "p", shortcut: good }]), "", "星座合法快捷键：" + good);
  }
  for (const bad of ["KeyQ", "Ctrl+KeyQ", "Backquote", "Escape", "F5", "", 1]) {
    assert.equal(
      buttonIssue([{ name: "a", prompt: "p", shortcut: bad }]),
      bad === "" ? "" : "buttonShortcutInvalid",
      "池外/非法拒绝（空串按「无」）：" + String(bad)
    );
    if (bad !== "") {
      assert.equal(constButtonIssue([{ name: "a", prompt: "p", shortcut: bad }]), "constButtonShortcutInvalid", "星座池外拒绝：" + String(bad));
    }
  }

  /* 3) 保存写穿：选择 → 草稿 dirty → save 写节（键序尾部）；无键条目不落键 */
  const scope = fakeScope({ buttons: [BUTTON] });
  const face = createButtonSettingsController(scope);
  face.editButton(0, "shortcut", "Digit1");
  let state = face.getSnapshot();
  assert.equal(state.buttonsDirty, true, "选键即 dirty（参与暂存-保存流）");
  assert.equal(state.buttonsInvalid, false, "合法值不阻断保存");
  await face.save();
  const written = scope.calls.filter((call) => call.op === "set").pop();
  assert.deepEqual(written.value[0].shortcut, "Digit1", "保存写穿快捷键（键序尾部）");
  assert.deepEqual(Object.keys(written.value[0]), ["name", "prompt", "autoSend", "newSession", "shortcut"], "落盘键序尾部追加");
  face.dispose();

  /* 改回「无」→ 删键（存储最小形：序列化与无快捷键条目逐字同形） */
  const clearScope = fakeScope({ buttons: [{ ...BUTTON, shortcut: "Zip" }] });
  const clearFace = createButtonSettingsController(clearScope);
  assert.equal(clearFace.getSnapshot().buttonsDraft[0].shortcut, "Zip", "漂移值回显保留");
  assert.equal(clearFace.getSnapshot().buttonsInvalid, true, "漂移值使草稿非法（保存拒绝）");
  await clearFace.save();
  assert.equal(clearScope.calls.filter((call) => call.op === "set").length, 0, "漂移值保存被拒绝（零写入）");
  clearFace.editButton(0, "shortcut", undefined);
  assert.equal("shortcut" in clearFace.getSnapshot().buttonsDraft[0], false, "改「无」即删键");
  assert.equal(clearFace.getSnapshot().buttonsInvalid, false, "修正后恢复合法");
  await clearFace.save();
  const cleared = clearScope.calls.filter((call) => call.op === "set").pop();
  assert.equal("shortcut" in cleared.value[0], false, "无快捷键不落键（逐字节同形）");
  clearFace.dispose();

  /* 4) 跨域并集查重（controller crossIssue 保存门）：与全局键冲突 / 两按钮同键 均拒绝 */
  const conflictScope = fakeScope({ buttons: [{ ...BUTTON, shortcut: "F2" }] });
  const localShortcuts = { closePage: "Escape", goHome: "F2", togglePan: "KeyM", voiceToggle: "Ctrl+KeyQ" };
  const conflictFace = createButtonSettingsController(conflictScope, {
    crossIssue: (entries) => shortcutsIssue(localShortcuts, { proposals: entries, constellations: [] })
  });
  assert.equal(conflictFace.getSnapshot().buttonsInvalid, true, "构造期即按跨域冲突判非法（与全局 goHome=F2 冲突）");
  await conflictFace.save();
  assert.equal(conflictScope.calls.filter((call) => call.op === "set").length, 0, "冲突保存被拒绝（零写入）");
  /* 改选唯一键 → 保存恢复可用 */
  conflictFace.editButton(0, "shortcut", "Digit7");
  assert.equal(conflictFace.getSnapshot().buttonsInvalid, false, "冲突解除 → 保存恢复可用");
  await conflictFace.save();
  assert.equal(conflictScope.calls.filter((call) => call.op === "set").length, 1, "解除后保存成功");
  conflictFace.dispose();

  /* 5) 两按钮同键：行内定位（shortcutConflictOnRowOf） */
  const drafts = {
    proposals: [{ name: "甲", prompt: "p", shortcut: "Digit1" }, { name: "乙", prompt: "p", shortcut: "Digit1" }],
    constellations: []
  };
  const hit = shortcutConflictOf(localShortcuts, drafts);
  assert.ok(hit !== null, "两按钮同键 → 冲突");
  assert.equal(shortcutConflictOnRowOf(hit, "proposals", 0), true, "第一行定位");
  assert.equal(shortcutConflictOnRowOf(hit, "proposals", 1), true, "第二行定位");
  assert.equal(shortcutConflictOnRowOf(hit, "constellations", 0), false, "无关列表不定位");

  /* 6) 设置页源码锚点（7.1/7.2/7.3）：快捷键页签结构 + 行内下拉 + 冲突/漂移/风险 */
  const ui = readFileSync(new URL("../src/settings-ui.jsx", import.meta.url), "utf8");
  const client = readFileSync(new URL("../src/client.jsx", import.meta.url), "utf8");
  assert.ok(ui.includes("export function CosmosShortcutsPanel"), "「快捷键」页签组件");
  assert.ok(ui.includes('data-plugin-anchor="dsh-v-cosmos:settings-shortcuts"'), "快捷键页签插件锚点");
  assert.ok(ui.includes("SHORTCUT_UI_ORDER.map((field) =>"), "四行由 UI 行序常量驱动（回到银河/移动开关/语音开关/关闭页面）");
  assert.ok(ui.includes("SHORTCUT_GLOBAL_KEYS.map((key) =>"), "键位下拉与键位池同源（单一常量表）");
  assert.ok(ui.includes("SHORTCUT_RISKY_KEYS.includes(key)"), "Ctrl+Q 选项标注浏览器保留风险");
  assert.ok(ui.includes("SHORTCUT_ALTERNATIVE_OF[value]"), "风险键提供替代键建议（Alt+Q）");
  assert.ok(ui.includes("{errorText(\"shortcutsDefault\", \"默认\")}"), "缺省值「默认」徽标");
  assert.ok(ui.includes("shortcutConflictOf(candidate"), "改选即时冲突预判（拒写 + 行内错误）");
  assert.ok(ui.includes("notAppliedText(t, \"cosmos.settings.shortcutsNotApplied\""), "写失败「未生效」提示（health 口径）");
  assert.ok(ui.includes("const commit = (field, value) => {"), "即时保存（无草稿-保存）");
  assert.ok(ui.includes("shortcutField(button, index)"), "动作行内「快捷键」下拉挂载");
  assert.ok(ui.includes("SHORTCUT_BUTTON_KEYS") && ui.includes("shortcutLabelOf(key)"), "行内候选 = 按钮键域同源 + 标签");
  assert.ok(ui.includes("errorText(\"buttonShortcutUnavailable\", \"不可用\")"), "漂移值回显「不可用」");
  assert.ok(ui.includes("conflictTextOf(t, conflict,"), "冲突行内定位文案（对侧可读名）");
  assert.ok(ui.includes("conflictBlocked"), "冲突阻断保存按钮（面板级）");
  /* 真机反馈补强：保存提示 + 前置状态门控说明（「新建」绑键但当前无星胚 → 该按钮不渲染） */
  assert.ok(ui.includes("errorText(\"buttonShortcutSaveHint\""), "行内提示「需点击下方保存才生效」");
  assert.ok(ui.includes("errorText(\"buttonShortcutPreStateHint\""), "前置状态门控的悬停说明");
  assert.ok(ui.includes("cs-shortcutRowNote"), "带前置状态且已配键的行显示「仅「X」时生效」小字注");
  assert.ok(ui.includes("errorText(\"buttonShortcutPreStateShort\""), "条件小字注文案");
  /* 注册与词典（client.jsx） */
  assert.ok(client.includes('id: "shortcuts"'), "「快捷键」标签页注册");
  assert.ok(client.includes("order: 4,"), "排于「界面」之后（order 4）");
  assert.ok(client.includes('label: () => sectionT("cosmos.settings.tabShortcuts")'), "标签文案走词典");
  assert.ok(client.includes("inject: () => ({ shortcuts: shortcutsFace, drafts: buttonDraftsFace, selectHealth: selectHealthFace })"), "快捷键页签注入 face + 草稿数据面 + health");
  for (const key of [
    "shortcutGoHome", "shortcutTogglePan", "shortcutVoiceToggle", "shortcutClosePage",
    "shortcutRiskTag", "shortcutRiskyHint", "buttonShortcutLabel", "buttonShortcutNone",
    "buttonShortcutUnavailable", "buttonShortcutInvalid", "constButtonShortcutInvalid",
    "shortcutDup", "shortcutConflictRow", "shortcutPanelHint", "buttonShortcutSaveHint",
    "buttonShortcutPreStateHint", "buttonShortcutPreStateShort"
  ]) {
    assert.equal(
      (client.match(new RegExp('"cosmos\\.settings\\.' + key + '"', "g")) ?? []).length,
      2,
      "词典 zh/en 成对：cosmos.settings." + key
    );
  }
}

/* ── 路径区控制器（step2-cosmos-openspec-path-setting 3.1–3.4）：快照回显、草稿-保存
      （trim/空白→null 两键显式载荷）、CAS 409 重试流、只读降级、非阻断存在性警示、
      discard/键级 unset。UI 源码锚点在 test/client-ui-smoke.mjs。 ── */
{
  /* 1) 加载回显：effective 值投影为草稿文本（null → ""），未脏。 */
  const scope = fakeScope({ writable: true });
  scope.patch({ value: { buttons: [], paths: { openspecPath: "C:/openspec", cosmosSpecDir: null } } });
  const face = createPathsSettingsController(scope);
  let snap = face.getSnapshot();
  assert.equal(snap.status, "ready", "快照就绪");
  assert.equal(snap.loading, false, "非加载态");
  assert.equal(snap.writable, true, "可写");
  assert.equal(snap.openspecPath, "C:/openspec", "openspecPath 回显生效值");
  assert.equal(snap.cosmosSpecDir, "", "未配置键回显空串");
  assert.equal(snap.dirty, false, "未编辑 → 未脏");
  assert.equal(snap.overridden, false, "user 层无 paths → 无覆盖标记");

  /* 2) 编辑入草稿（原始文本保留供输入框）；载荷 trim 非空保留字面量 / 空白→null。 */
  face.edit("openspecPath", "  C:/openspec-new  ");
  snap = face.getSnapshot();
  assert.equal(snap.openspecPath, "  C:/openspec-new  ", "草稿保留原始文本（输入框回显键入）");
  assert.equal(snap.dirty, true, "编辑 → 未脏翻转");
  await face.save();
  snap = face.getSnapshot();
  assert.deepEqual(
    scope.calls.at(-1),
    { op: "set", key: "paths", value: { openspecPath: "C:/openspec-new", cosmosSpecDir: null } },
    "保存载荷：trim 非空保留字面量 / 缺席键 null（恒两键显式）"
  );
  assert.equal(snap.dirty, false, "保存成功 → 草稿清空、回退生效值");
  assert.equal(snap.openspecPath, "C:/openspec-new", "保存后回显新生效值");
  assert.deepEqual(snap.warnings, [], "无 checkDir 注入 → 无警示（检查跳过，非阻断）");

  /* 3) 键级 unset：已配置键清空 → 载荷该键为 null。 */
  face.edit("openspecPath", "   ");
  await face.save();
  assert.deepEqual(
    scope.calls.at(-1).value,
    { openspecPath: null, cosmosSpecDir: null },
    "清空键 → 键级 unset（null）+ 恒两键显式"
  );

  /* 4) CAS 409 重试流：写失败 → failed 置位、草稿保留；revision 收敛后重试成功。 */
  face.edit("cosmosSpecDir", "D:\\cosmos-spec");
  scope.failNextSet(1);
  const failedOk = await face.save();
  snap = face.getSnapshot();
  assert.equal(failedOk, false, "CAS 冲突 → 保存失败");
  assert.equal(snap.failed, true, "failed 置位（UI「保存未生效，请重试」）");
  assert.equal(snap.cosmosSpecDir, "D:\\cosmos-spec", "草稿保留（修正后重试）");
  assert.equal(snap.dirty, true, "失败不清草稿（dirty 保持）");
  const retried = await face.save();
  snap = face.getSnapshot();
  assert.equal(retried, true, "revision 收敛后重试成功");
  assert.equal(snap.failed, false, "成功清失败态");
  assert.deepEqual(scope.calls.at(-1).value, { openspecPath: null, cosmosSpecDir: "D:\\cosmos-spec" }, "重试载荷只含两路径键（不写其它节）");

  /* 5) 非阻断存在性警示：checkDir 注入 → 目录不存在仍保存成功并出警示（含归一形态）。 */
  const checkScope = fakeScope({ writable: true });
  const checked = [];
  const warnFace = createPathsSettingsController(checkScope, {
    checkDir: (raw) => {
      checked.push(raw);
      if (raw === "C:/missing") return { exists: false, resolved: "C:\\resolved-missing" };
      return { exists: true };
    }
  });
  warnFace.edit("openspecPath", "C:/missing");
  warnFace.edit("cosmosSpecDir", "C:/exists");
  const warnSaved = await warnFace.save();
  snap = warnFace.getSnapshot();
  assert.equal(warnSaved, true, "目录不存在 → 仍保存成功（非阻断）");
  assert.deepEqual(checked, ["C:/missing", "C:/exists"], "检查只针对已配置键（保存前调用）");
  assert.deepEqual(
    snap.warnings,
    [{ key: "openspecPath", raw: "C:/missing", resolved: "C:\\resolved-missing" }],
    "警示含键名与 path.resolve 归一后的实际形态"
  );
  assert.equal(snap.dirty, false, "警示不影响保存成功语义");
  /* checkDir 抛错 → 按「无检查」处理，绝不阻断/抛出。 */
  const boomFace = createPathsSettingsController(checkScope, {
    checkDir: () => {
      throw new Error("fs unavailable");
    }
  });
  boomFace.edit("openspecPath", "C:/x");
  assert.equal(await boomFace.save(), true, "检查器抛错 → 保存照常成功");
  assert.deepEqual(boomFace.getSnapshot().warnings, [], "抛错检查器不产生警示");

  /* 6) 只读降级：writable false → 保存拒绝（零 set 调用）；loading 态置位。 */
  const roScope = fakeScope({ writable: false });
  const roFace = createPathsSettingsController(roScope);
  assert.equal(roFace.getSnapshot().writable, false, "只读快照 → 不可写");
  roFace.edit("openspecPath", "C:/x");
  assert.equal(await roFace.save(), false, "只读 → 保存拒绝");
  assert.equal(roScope.calls.length, 0, "只读保存零写调用");
  const loadScope = fakeScope({ writable: true });
  loadScope.patch({ status: "loading" });
  const loadFace = createPathsSettingsController(loadScope);
  assert.equal(loadFace.getSnapshot().loading, true, "loading 态置位（UI 禁用 + 加载提示）");
  loadFace.dispose();
  roFace.dispose();
  warnFace.dispose();
  boomFace.dispose();

  /* 7) 放弃修改：草稿回退生效值，失败/警示一并清。 */
  face.edit("openspecPath", "C:/draft");
  face.discard();
  snap = face.getSnapshot();
  assert.equal(snap.dirty, false, "discard → 未脏");
  assert.equal(snap.failed, false, "discard 清失败态");
  assert.deepEqual(snap.warnings, [], "discard 清警示");
  face.dispose();
}

/* ── 星座模板名显示设置净房（add-cosmos-template-name-toggle 4.1 / D1）：v10 → v11
   布尔键 `templateNames`，缺省 false（默认渲染零变化）、合法布尔透传、非布尔形态
   （字符串/数字/null/对象）回落缺省且不抛错、v10 旧载荷补默认、持久化往返与既有键零互扰。 ── */
{
  const {
    COSMOS_SETTINGS_BOUNDS,
    COSMOS_SETTINGS_DEFAULTS,
    COSMOS_SETTINGS_VERSION,
    loadCosmosSettings,
    sanitizeCosmosSettings,
    saveCosmosSettings
  } = await import("../src/settings.mjs");

  assert.equal(COSMOS_SETTINGS_VERSION, 12, "设置面 v12（v11 → v12 删缩放阈值两键；v10 → v11 新增 templateNames）");
  assert.equal(COSMOS_SETTINGS_DEFAULTS.templateNames, false, "出厂缺省关闭（关闭态默认渲染零变化）");
  assert.equal(sanitizeCosmosSettings({}).templateNames, false, "空载荷 → false");
  assert.equal(sanitizeCosmosSettings({ templateNames: true }).templateNames, true, "合法 true 透传（开启态）");
  assert.equal(sanitizeCosmosSettings({ templateNames: false }).templateNames, false, "显式 false 保留");
  for (const bad of ["on", "true", "", 1, 0, null, undefined, {}, []]) {
    assert.equal(sanitizeCosmosSettings({ templateNames: bad }).templateNames, false, "非布尔回落 false：" + String(bad));
  }
  /* 布尔键不进数值界表（BOUNDS 恒纯数值 [min,max] 形状） */
  assert.equal(
    Object.prototype.hasOwnProperty.call(COSMOS_SETTINGS_BOUNDS, "templateNames"),
    false,
    "templateNames 以独立布尔净化分支表达，不混入数值界表"
  );
  /* v10 载荷（无 templateNames 键）→ 补缺省 false（零迁移、无报错） */
  const v10Payload = { ...COSMOS_SETTINGS_DEFAULTS };
  delete v10Payload.templateNames;
  assert.equal(sanitizeCosmosSettings(v10Payload).templateNames, false, "v10 载荷读出补缺省 false");

  /* 持久化读写（同一存储通道）：开启 → 读回开启；坏值 → 净房回落缺省；与既有键零互扰。 */
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key)
  };
  try {
    assert.equal(loadCosmosSettings().templateNames, false, "无存储 → 关闭");
    const saved = saveCosmosSettings({ templateNames: true });
    assert.equal(saved.templateNames, true, "开启写入（净房结果）");
    assert.equal(loadCosmosSettings().templateNames, true, "重开读回开启（关闭重开持久保持）");
    assert.equal(loadCosmosSettings().launchMode, "embedded", "同通道既有键不受扰动");
    assert.equal(saveCosmosSettings({ templateNames: "yes" }).templateNames, false, "非法写侧回落缺省 false（SHALL NOT 抛错）");
    store.set("dsh-v-cosmos:settings", JSON.stringify({ templateNames: 1 }));
    assert.equal(loadCosmosSettings().templateNames, false, "持久载荷坏值（数字）→ 净房回落 false");
  } finally {
    delete globalThis.localStorage;
  }
}

console.log("settings-panel-smoke: all assertions passed");
