/**
 * 动作按钮 schema 冒烟（add-cosmos-proposal-actions 2.2/2.5 / spec cosmos-actions
 * 「按钮配置模型」）：归一化口径、`autoSend` 必填布尔恒输出、`newSession` 语义常量、
 * 每按钮 `jumpNewSession`（缺省跳转、仅 false 落键）、上限/去重拒绝、可选键最小形状、
 * `model` 三元组透传、旧数据零迁移、读面容错投影。
 * 运行：node test/buttons-schema-smoke.mjs
 */
import assert from "node:assert/strict";
import { MAX_BUTTONS, MAX_PROMPT_CHARS, PRE_STATES, actionButtonVisible, buttonsSchema, buttonsSectionOf, isEmbryoDismissButton, normalizeButtonModel, normalizeButtons } from "../src/buttons.mjs";

const throwsWith = (fn, pattern, label) => {
  let error = null;
  try {
    fn();
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof TypeError, `${label}: 应抛 TypeError`);
  assert.match(error.message, pattern, `${label}: 错误信息`);
};

/* ── 1. 合法按钮（spec 场景「合法按钮被保存」） ── */
{
  const list = normalizeButtons([{ name: " 审查 ", prompt: " 请使用 /cosmos-review 审查本提案 ", autoSend: true }]);
  assert.equal(list.length, 1);
  assert.deepEqual(list[0], {
    name: "审查",
    prompt: "请使用 /cosmos-review 审查本提案",
    autoSend: true,
    newSession: true
  }, "trim + autoSend/newSession 恒输出");
  assert.deepEqual(Object.keys(list[0]), ["name", "prompt", "autoSend", "newSession"], "键序固定（无可选键）");
}

/* ── 2. newSession 语义常量（spec 场景「newSession 固定为真」「旧数据零迁移」） ── */
{
  for (const bad of [false, 0, "true", 1]) {
    throwsWith(() => normalizeButtons([{ name: "a", prompt: "p", newSession: bad }]), /newSession must be true/, `newSession=${JSON.stringify(bad)}`);
  }
  const missing = normalizeButtons([{ name: "旧", prompt: "p" }]);
  assert.equal(missing[0].newSession, true, "缺失 newSession → 按 true 补齐（零迁移）");
  const nullish = normalizeButtons([{ name: "旧2", prompt: "p", newSession: null }]);
  assert.equal(nullish[0].newSession, true, "newSession=null → 按未提供处理");
  const explicit = normalizeButtons([{ name: "旧", prompt: "p", newSession: true }]);
  assert.deepEqual(explicit[0], missing[0], "显式 true 与缺省逐字段同形");
  assert.ok("newSession" in explicit[0], "恒输出 newSession 键");
}

/* ── 3. autoSend 必填布尔恒输出 ── */
{
  assert.equal(normalizeButtons([{ name: "a", prompt: "p" }])[0].autoSend, false, "缺省 → false");
  assert.equal(normalizeButtons([{ name: "a", prompt: "p", autoSend: null }])[0].autoSend, false, "null → false");
  throwsWith(() => normalizeButtons([{ name: "a", prompt: "p", autoSend: "yes" }]), /autoSend must be a boolean/, "字符串 autoSend");
  throwsWith(() => normalizeButtons([{ name: "a", prompt: "p", autoSend: 1 }]), /autoSend must be a boolean/, "数字 autoSend");
}

/* ── 4. 上限与去重拒绝（spec 场景「上限与去重拒绝」） ── */
{
  const max = Array.from({ length: MAX_BUTTONS }, (_v, i) => ({ name: "b" + i, prompt: "p" }));
  assert.equal(normalizeButtons(max).length, MAX_BUTTONS, "32 条通过");
  throwsWith(() => normalizeButtons([...max, { name: "overflow", prompt: "p" }]), /exceeds 32|exceeds 32 entries/, "第 33 条");

  throwsWith(() => normalizeButtons([
    { name: "同名", prompt: "a" },
    { name: " 同名 ", prompt: "b" }
  ]), /duplicated/, "trim 后重名 → 拒绝（不做静默先到先得）");
  /* 大小写不同的显示名不折叠（显示名允许中文，去重按 trim 精确比较） */
  assert.equal(normalizeButtons([{ name: "A", prompt: "x" }, { name: "a", prompt: "y" }]).length, 2, "大小写不同不算重复");
}

/* ── 5. 可选键最小形状（spec 场景「可选键最小形状」） ── */
{
  for (const prepend of [false, null, undefined]) {
    const [entry] = normalizeButtons([{ name: "a", prompt: "p", prepend }]);
    assert.ok(!("prepend" in entry), `prepend=${String(prepend)} → 不输出该键`);
  }
  const [pre] = normalizeButtons([{ name: "a", prompt: "p", prepend: true }]);
  assert.equal(pre.prepend, true, "prepend: true → 输出 true");
  assert.deepEqual(Object.keys(pre), ["name", "prompt", "autoSend", "newSession", "prepend"], "prepend 位于 newSession 之后");
  throwsWith(() => normalizeButtons([{ name: "a", prompt: "p", prepend: "yes" }]), /prepend must be a boolean/, "prepend 非布尔");

  const [plain] = normalizeButtons([{ name: "a", prompt: "p" }]);
  assert.ok(!("model" in plain), "未提供 model → 不输出该键");

  const [bound] = normalizeButtons([{
    name: "a",
    prompt: "p",
    model: { provider: "deepseek", model: "deepseek-chat", reasoningEffort: "max" }
  }]);
  assert.deepEqual(bound.model, { provider: "deepseek", model: "deepseek-chat", reasoningEffort: "max" }, "model 三元组原样透传");
  assert.deepEqual(Object.keys(bound.model), ["provider", "model", "reasoningEffort"], "model 键序固定");

  const [noEffort] = normalizeButtons([{ name: "a", prompt: "p", model: { provider: "p", model: "m", reasoningEffort: null } }]);
  assert.deepEqual(noEffort.model, { provider: "p", model: "m" }, "无等级 → 输出两键（不补默认值）");
  assert.ok(!("reasoningEffort" in noEffort.model), "无等级 MUST NOT 输出 reasoningEffort 键");
}

/* ── 5c. 前置状态（add-cosmos-action-prestate-gate 1.1）：
   枚举校验 / 最小形 / 尾部键序 / proto ⇒ newSession:false 且 true 拒绝 / 同状态多按钮 ── */
{
  assert.deepEqual([...PRE_STATES], ["proto", "created", "reviewed", "executed"], "枚举四态");
  const [reviewed] = normalizeButtons([{ name: "审查", prompt: "p", preState: "reviewed" }]);
  assert.equal(reviewed.preState, "reviewed", "合法 preState 落键");
  assert.deepEqual(Object.keys(reviewed), ["name", "prompt", "autoSend", "newSession", "preState"], "preState 追加尾部");
  const [withModel] = normalizeButtons([{
    name: "a", prompt: "p", preState: "executed", model: { provider: "p", model: "m" }
  }]);
  assert.deepEqual(Object.keys(withModel), ["name", "prompt", "autoSend", "newSession", "model", "preState"], "model 之后（preState 最后）");
  for (const bad of ["doing", 1, true, ""]) {
    throwsWith(() => normalizeButtons([{ name: "a", prompt: "p", preState: bad }]), /preState must/, `preState=${JSON.stringify(bad)}`);
  }
  for (const missing of [undefined, null]) {
    const [entry] = normalizeButtons([{ name: "a", prompt: "p", preState: missing }]);
    assert.ok(!("preState" in entry), `preState=${String(missing)} → 不输出键（旧配置零迁移）`);
  }
  /* proto：newSession 恒 false；显式 true 拒绝；显式 false 接受。 */
  const [proto] = normalizeButtons([{ name: "推进", prompt: "p", preState: "proto" }]);
  assert.equal(proto.newSession, false, "proto 行 newSession 恒 false");
  assert.deepEqual(Object.keys(proto), ["name", "prompt", "autoSend", "newSession", "preState"], "键序不变");
  const [protoFalse] = normalizeButtons([{ name: "推进", prompt: "p", preState: "proto", newSession: false }]);
  assert.equal(protoFalse.newSession, false, "proto 显式 false 接受");
  throwsWith(() => normalizeButtons([{ name: "推进", prompt: "p", preState: "proto", newSession: true }]), /newSession must be false/, "proto 显式 true 拒绝");
  throwsWith(() => normalizeButtons([{ name: "推进", prompt: "p", preState: "proto", newSession: 0 }]), /newSession must be false/, "proto 非布尔拒绝");
  /* 同一状态多按钮：无唯一性约束（name 去重纪律不变）。 */
  const same = normalizeButtons([
    { name: "审1", prompt: "p", preState: "reviewed" },
    { name: "审2", prompt: "q", preState: "reviewed" },
    { name: "审3", prompt: "r", preState: "reviewed" }
  ]);
  assert.equal(same.length, 3, "同一状态允许多个按钮（互不去重）");
  throwsWith(() => normalizeButtons([
    { name: "同名", prompt: "p", preState: "created" },
    { name: " 同名 ", prompt: "q", preState: "executed" }
  ]), /duplicated/, "name 去重纪律不变（preState 不参与）");
  /* 读面容错：未知 preState 原样保留（设置页漂移回显）；默认严格拒绝。 */
  const [drift] = normalizeButtons([{ name: "旧行", prompt: "p", preState: "doing" }], { tolerateUnknownPreState: true });
  assert.equal(drift.preState, "doing", "容错读保留漂移值");
  assert.equal(drift.newSession, true, "漂移条目按普通行归一（newSession true）");
  const projected = buttonsSectionOf({ buttons: [{ name: "旧行", prompt: "p", preState: "doing" }] });
  assert.equal(projected.length, 1, "读面容错投影不丢漂移条目");
  assert.equal(projected[0].preState, "doing", "漂移值原样保留");
}

/* ── 5d. 前置状态呈现门控：actionButtonVisible 谓词矩阵（1.2） ── */
{
  const open = { lifecycle: "reviewed", act: 0 };
  assert.equal(actionButtonVisible({ name: "a", prompt: "p" }, { lifecycle: "created", act: 3 }), true, "未设 preState → 恒显示");
  assert.equal(actionButtonVisible({ name: "a", prompt: "p" }, null), true, "未设 preState + 无目标 → 仍显示（禁用条内）");
  assert.equal(actionButtonVisible({ name: "a", prompt: "p", preState: "reviewed" }, open), true, "状态匹配且沉睡 → 显示");
  assert.equal(actionButtonVisible({ name: "a", prompt: "p", preState: "reviewed" }, { lifecycle: "created", act: 0 }), false, "状态不匹配 → 隐藏");
  assert.equal(actionButtonVisible({ name: "a", prompt: "p", preState: "reviewed" }, { lifecycle: "reviewed", act: 1 }), false, "活跃即隐藏（双条件缺一不可）");
  assert.equal(actionButtonVisible({ name: "a", prompt: "p", preState: "reviewed" }, { lifecycle: "reviewed" }), true, "act 缺失按 0 处理");
  assert.equal(actionButtonVisible({ name: "a", prompt: "p", preState: "reviewed" }, null), false, "无目标 → preState 行隐藏");
  assert.equal(actionButtonVisible({ name: "a", prompt: "p", preState: "proto" }, { lifecycle: "proto", act: 0 }), true, "星胚目标沉睡 → 显示");
  assert.equal(
    actionButtonVisible({ name: "a", prompt: "p", preState: "proto" }, { lifecycle: "proto", act: 1 }),
    false,
    "星胚目标锚点探索会话活跃（act=1）→ 隐藏（keep-embryo-active-while-exploring）"
  );
  assert.equal(actionButtonVisible({ name: "a", prompt: "p", preState: "doing" }, { lifecycle: "doing", act: 0 }), false, "漂移 preState 永不命中（读面隐藏）");
  assert.equal(actionButtonVisible(null, open), true, "空按钮按未设处理");
}

/* ── 5e. 每按钮「执行后跳转」（fix-cosmos-const-float-send-close 4.1）：
   缺省 true（跳转）= 不落键；仅 false 落键（不跳转）；非布尔拒绝。 ── */
{
  for (const jump of [true, null, undefined]) {
    const [entry] = normalizeButtons([{ name: "a", prompt: "p", jumpNewSession: jump }]);
    assert.ok(!("jumpNewSession" in entry), `jumpNewSession=${String(jump)} → 不输出该键（缺省跳转）`);
  }
  const [stay] = normalizeButtons([{ name: "a", prompt: "p", jumpNewSession: false }]);
  assert.equal(stay.jumpNewSession, false, "jumpNewSession: false → 输出 false（取消跳转）");
  assert.deepEqual(Object.keys(stay), ["name", "prompt", "autoSend", "newSession", "jumpNewSession"], "跳转键位于 newSession 之后");
  const [both] = normalizeButtons([{ name: "a", prompt: "p", jumpNewSession: false, prepend: true }]);
  assert.deepEqual(Object.keys(both), ["name", "prompt", "autoSend", "newSession", "jumpNewSession", "prepend"], "键序：jumpNewSession 在 prepend 之前");
  throwsWith(() => normalizeButtons([{ name: "a", prompt: "p", jumpNewSession: "no" }]), /jumpNewSession must be a boolean/, "跳转非布尔拒绝");
  assert.equal(normalizeButtons([{ name: "a", prompt: "p" }])[0].jumpNewSession, undefined, "缺省 = 跳转（零迁移）");
}

/* ── 6. model 形状校验（不丢弃、不改写、不补默认值） ── */
{
  assert.equal(normalizeButtonModel(undefined, "a"), undefined, "未提供 → undefined");
  throwsWith(() => normalizeButtonModel("model", "a"), /must be an object/, "非对象");
  throwsWith(() => normalizeButtonModel([], "a"), /must be an object/, "数组");
  throwsWith(() => normalizeButtonModel({ provider: " ", model: "m" }, "a"), /model\.provider/, "空 provider");
  throwsWith(() => normalizeButtonModel({ provider: "p", model: "" }, "a"), /model\.model/, "空 model");
  throwsWith(() => normalizeButtonModel({ provider: "p", model: "m", reasoningEffort: 3 }, "a"), /reasoningEffort must be a string/, "非字符串等级");
  throwsWith(() => normalizeButtonModel({ provider: "p", model: "m", reasoningEffort: "  " }, "a"), /reasoningEffort must not be empty/, "空等级");
}

/* ── 7. 空条目与半空条目 ── */
{
  const list = normalizeButtons([
    { name: "  ", prompt: " " },
    { name: "a", prompt: "p" }
  ]);
  assert.equal(list.length, 1, "完全空条目剔除（不阻断整份保存）");
  throwsWith(() => normalizeButtons([{ name: "", prompt: "p" }]), /name must not be empty/, "半空（缺 name）");
  throwsWith(() => normalizeButtons([{ name: "a", prompt: "" }]), /prompt must not be empty/, "半空（缺 prompt）");
  throwsWith(() => normalizeButtons([null]), /non-object/, "非对象条目");
  throwsWith(() => normalizeButtons([{ name: 1, prompt: "p" }]), /name must be a string/, "name 非字符串");
  const long = "x".repeat(MAX_PROMPT_CHARS + 1);
  throwsWith(() => normalizeButtons([{ name: "a", prompt: long }]), /exceeds 20000/, "prompt 超长");
}

/* ── 8. 入参形状：数组 / {buttons} 双形态 ── */
{
  assert.equal(normalizeButtons({ buttons: [{ name: "a", prompt: "p" }] }).length, 1, "{buttons} 形态");
  assert.equal(normalizeButtons(null).length, 0, "null → 空列表");
  assert.equal(normalizeButtons({}).length, 0, "缺节 → 空列表");
}

/* ── 9. 读面容错投影（非法条目单条跳过，不抛错） ── */
{
  const projected = buttonsSectionOf({
    buttons: [
      { name: "ok", prompt: "p", autoSend: true, prepend: true, model: { provider: "x", model: "y" } },
      { name: "bad-model", prompt: "p", model: { provider: "", model: "y" } },
      { name: "", prompt: "p" },
      null,
      { name: "ok2", prompt: "q" }
    ]
  });
  assert.equal(projected.length, 2, "非法条目单条跳过");
  assert.deepEqual(projected[0], {
    name: "ok",
    prompt: "p",
    autoSend: true,
    newSession: true,
    prepend: true,
    model: { provider: "x", model: "y" }
  }, "合法条目重建走同一路径（含 newSession）");
  assert.equal(projected[1].newSession, true, "旧数据投影补 newSession");
  assert.deepEqual(buttonsSectionOf(null), [], "无节 → 空");
  assert.deepEqual(buttonsSectionOf({ buttons: "x" }), [], "节非数组 → 空");
}

/* ── 10. 设置命名空间 schema（形状契约） ── */
{
  const schema = buttonsSchema();
  assert.deepEqual(schema({ buttons: [{ name: "a", prompt: "p" }] }).buttons[0], {
    name: "a",
    prompt: "p",
    autoSend: false,
    newSession: true
  }, "schema 归一化同口径");
  assert.equal(schema.type, "object");
  assert.equal(typeof schema.toJSON, "function");
  assert.throws(() => schema({ buttons: "x" }), /must be an array/, "节非数组 → 抛错");
}

/* ── 11. 快捷键可选键（add-cosmos-shortcuts 3.1/3.4 / spec cosmos-actions「按钮配置模型」）：
      合法键落盘、键序尾部、缺省不落键、池外拒绝、无键序列化逐字节不变 ── */
{
  /* 合法键落盘（spec 场景「合法 shortcut 被保存」） */
  const [withKey] = normalizeButtons([{ name: "审查", prompt: "p", shortcut: "Digit1" }]);
  assert.equal(withKey.shortcut, "Digit1", "Digit1 落键");
  assert.deepEqual(
    Object.keys(withKey),
    ["name", "prompt", "autoSend", "newSession", "shortcut"],
    "shortcut 追加尾部（无 preState 时紧随 newSession）"
  );
  /* 键序：preState 之后（全键最大值） */
  const [full] = normalizeButtons([{
    name: "全键",
    prompt: "p",
    autoSend: true,
    jumpNewSession: false,
    prepend: true,
    model: { provider: "x", model: "y" },
    preState: "reviewed",
    shortcut: "F4"
  }]);
  assert.deepEqual(
    Object.keys(full),
    ["name", "prompt", "autoSend", "newSession", "jumpNewSession", "prepend", "model", "preState", "shortcut"],
    "键序固定：shortcut 恒在尾部（preState 之后）"
  );
  /* trim 后落键 */
  assert.equal(normalizeButtons([{ name: "a", prompt: "p", shortcut: " F8 " }])[0].shortcut, "F8", "trim 后落键");
  /* 全部按钮键域值可用 */
  for (const value of ["Digit0", "Digit9", "F2", "F4", "F8", "F9"]) {
    assert.equal(normalizeButtons([{ name: "a", prompt: "p", shortcut: value }])[0].shortcut, value, "按钮键域值：" + value);
  }
  /* 缺省/null/空串 → 不落键（存储最小形） */
  for (const absent of [undefined, null, "", "   "]) {
    const [entry] = normalizeButtons([{ name: "a", prompt: "p", shortcut: absent }]);
    assert.equal("shortcut" in entry, false, "缺省不落键：" + JSON.stringify(absent));
  }
  /* 无键序列化逐字节不变（spec 场景「无 shortcut 序列化逐字节不变」） */
  const legacy = { name: "旧", prompt: "p", autoSend: true, newSession: true, model: { provider: "x", model: "y" } };
  assert.equal(
    JSON.stringify(normalizeButtons([legacy])[0]),
    JSON.stringify({ name: "旧", prompt: "p", autoSend: true, newSession: true, model: { provider: "x", model: "y" } }),
    "既有条目（无 shortcut）序列化逐字节不变"
  );
  /* 池外拒绝（spec 场景「非法 shortcut 被拒绝」）：字母 / 组合键 / 数字 / 保留键 */
  for (const bad of ["KeyQ", "Ctrl+KeyQ", "Backquote", "Escape", "F1", "F3", "F5", "F12", "Space", 1, {}, true]) {
    assert.throws(
      () => normalizeButtons([{ name: "a", prompt: "p", shortcut: bad }]),
      /shortcut must be (a string|one of)/,
      "池外/非字符串拒绝：" + String(bad)
    );
  }
  /* 读面容错投影：池外快捷键**原样保留**（设置页回显「不可用」，分发器不可触发） */
  const projected = buttonsSectionOf({
    buttons: [
      { name: "ok", prompt: "p", shortcut: "Digit3" },
      { name: "drift", prompt: "p", shortcut: "KeyQ" },
      { name: "ok2", prompt: "q" }
    ]
  });
  assert.equal(projected.length, 3, "池外快捷键条目保留（漂移回显，非静默丢弃）");
  assert.equal(projected[0].shortcut, "Digit3", "读面保留合法快捷键");
  assert.equal(projected[1].shortcut, "KeyQ", "读面容错保留漂移原值（设置页「不可用」）");
  assert.equal("shortcut" in projected[2], false, "无键条目不落键");
}

/* ── 12. 星胚直执行键（add-cosmos-embryo-dismiss-button 1.1–1.4 / spec cosmos-actions
      「按钮配置模型」）：proto 绑定 / 尾部键序 / 空 prompt 豁免 / 缺省不落键 /
      无键序列化逐字节不变 / 漂移读面容错 ── */
{
  /* 合法直执行保存（spec 场景「直执行按钮免提示词保存」）：空 prompt 豁免 + 键序最末。 */
  const [direct] = normalizeButtons([{
    name: "移除", prompt: "", autoSend: false, preState: "proto", embryoDismiss: true
  }]);
  assert.deepEqual(direct, {
    name: "移除",
    prompt: "",
    autoSend: false,
    newSession: false,
    preState: "proto",
    embryoDismiss: true
  }, "直执行保存：prompt 恒 \"\"、proto 行 newSession false、embryoDismiss true");
  assert.deepEqual(
    Object.keys(direct),
    ["name", "prompt", "autoSend", "newSession", "preState", "embryoDismiss"],
    "键序：embryoDismiss 位于 preState 之后（尾部）"
  );
  /* 与 shortcut 共存：embryoDismiss 恒在最末。 */
  const [full] = normalizeButtons([{
    name: "全键",
    prompt: "   ",
    autoSend: true,
    jumpNewSession: false,
    prepend: true,
    model: { provider: "x", model: "y" },
    preState: "proto",
    shortcut: "F4",
    embryoDismiss: true
  }]);
  assert.deepEqual(
    Object.keys(full),
    ["name", "prompt", "autoSend", "newSession", "jumpNewSession", "prepend", "model", "preState", "shortcut", "embryoDismiss"],
    "键序固定：embryoDismiss 恒在 shortcut 之后（最末）"
  );
  assert.equal(full.prompt, "", "trim 后空串仍恒输出空串（键序不变）");

  /* 非 proto / 缺省 preState + true → 保存拒绝（可读错误）。 */
  for (const preState of ["created", "reviewed", "executed", undefined, null]) {
    throwsWith(
      () => normalizeButtons([{ name: "a", prompt: "p", preState, embryoDismiss: true }]),
      /直达移除仅限前置状态为待创建（星胚）的按钮/,
      "非 proto 直执行拒绝：" + String(preState)
    );
  }
  /* 非布尔值拒绝（false/null/缺省按未提供处理，不落键不拒绝）。 */
  for (const bad of [1, 0, "true", "yes", {}]) {
    throwsWith(
      () => normalizeButtons([{ name: "a", prompt: "p", preState: "proto", embryoDismiss: bad }]),
      /embryoDismiss must be a boolean/,
      "非布尔 embryoDismiss 拒绝：" + JSON.stringify(bad)
    );
  }
  for (const absent of [false, null, undefined]) {
    const [entry] = normalizeButtons([{ name: "a", prompt: "p", preState: "proto", embryoDismiss: absent }]);
    assert.ok(!("embryoDismiss" in entry), "embryoDismiss=" + String(absent) + " → 不落键（最小形）");
  }
  /* 豁免仅限直执行行：非直执行空 prompt 仍拒绝（逐字不变）。 */
  throwsWith(() => normalizeButtons([{ name: "a", prompt: "" }]), /prompt must not be empty/, "普通行空 prompt 仍拒绝");
  throwsWith(
    () => normalizeButtons([{ name: "a", prompt: "", preState: "proto" }]),
    /prompt must not be empty/,
    "proto 行未勾直执行 → 空 prompt 仍拒绝"
  );

  /* 无该键条目重新落盘逐字节不变（spec 场景「直执行键缺省序列化逐字节不变」）。 */
  const legacyNoShortcut = { name: "旧", prompt: "p", autoSend: true, newSession: true, model: { provider: "x", model: "y" } };
  assert.equal(
    JSON.stringify(normalizeButtons([legacyNoShortcut])[0]),
    JSON.stringify({ name: "旧", prompt: "p", autoSend: true, newSession: true, model: { provider: "x", model: "y" } }),
    "既有条目（无 embryoDismiss）序列化逐字节不变"
  );
  const legacyWithShortcut = { name: "旧2", prompt: "p", autoSend: false, newSession: true, preState: "reviewed", shortcut: "F8" };
  assert.equal(
    JSON.stringify(normalizeButtons([legacyWithShortcut])[0]),
    JSON.stringify({ name: "旧2", prompt: "p", autoSend: false, newSession: true, preState: "reviewed", shortcut: "F8" }),
    "含 shortcut 的既有条目序列化逐字节不变（新键追加尾部且缺省不落键）"
  );

  /* 漂移读面容错（spec 场景「直执行键漂移读面容错」）：非 proto 行 + true 原样保留。 */
  const driftItem = { name: "旧行", prompt: "p", preState: "reviewed", embryoDismiss: true };
  const [drift] = normalizeButtons([driftItem], { tolerateUnknownEmbryoDismiss: true });
  assert.equal(drift.embryoDismiss, true, "容错读保留漂移值（不静默改写/丢弃）");
  const projected = buttonsSectionOf({ buttons: [driftItem] });
  assert.equal(projected.length, 1, "读面容错投影不丢漂移条目");
  assert.equal(projected[0].embryoDismiss, true, "漂移值原样保留（设置页标「不可用」并拒绝保存）");
  /* 免提示词条目在动作条读面投影中不被丢弃（空 prompt 豁免同口径）。 */
  const projectedDirect = buttonsSectionOf({
    buttons: [
      { name: "移除", prompt: "", preState: "proto", embryoDismiss: true, autoSend: false },
      { name: "空行", prompt: "" }
    ]
  });
  assert.equal(projectedDirect.length, 1, "免提示词直执行条目保留；普通空 prompt 条目仍跳过");
  assert.equal(projectedDirect[0].embryoDismiss, true, "直执行键随投影保留");
  assert.equal(projectedDirect[0].prompt, "", "空 prompt 原样回显");

  /* 单一谓词（客户端分流 / 行级禁用豁免 / 设置控件共用）。 */
  assert.equal(isEmbryoDismissButton({ preState: "proto", embryoDismiss: true }), true, "proto + true → 直执行");
  assert.equal(isEmbryoDismissButton({ preState: "proto" }), false, "proto 无键 → 消息链路");
  assert.equal(isEmbryoDismissButton({ preState: "reviewed", embryoDismiss: true }), false, "漂移值不算直执行");
  assert.equal(isEmbryoDismissButton(null), false, "空值 → false");
}

/* ── 12. 团队启用键（add-cosmos-agent-team-toggle 2.1/2.3 / spec cosmos-actions
   「按钮团队启用键」）：最小形 / 非布尔拒绝 / 键序最末 / 序列化逐字节不变 / 漂移读面容错 ── */
{
  const [plain] = normalizeButtons([{ name: "a", prompt: "p" }]);
  assert.ok(!("team" in plain), "缺省 team → 不输出键（默认关）");

  const [enabled] = normalizeButtons([{ name: "a", prompt: "p", team: true }]);
  assert.deepEqual(
    enabled,
    { name: "a", prompt: "p", autoSend: false, newSession: true, team: true },
    "team: true 落键"
  );
  assert.deepEqual(
    Object.keys(enabled),
    ["name", "prompt", "autoSend", "newSession", "team"],
    "键序最末（newSession 之后）"
  );

  /* 与直执行键共存：team 恒在 embryoDismiss 之后。 */
  const [withDismiss] = normalizeButtons([{
    name: "移除", prompt: "", preState: "proto", embryoDismiss: true, team: true
  }]);
  assert.deepEqual(
    Object.keys(withDismiss),
    ["name", "prompt", "autoSend", "newSession", "preState", "embryoDismiss", "team"],
    "team 位于 embryoDismiss 之后（最末）"
  );

  for (const absent of [false, null, undefined]) {
    const [entry] = normalizeButtons([{ name: "a", prompt: "p", team: absent }]);
    assert.ok(!("team" in entry), "team=" + String(absent) + " → 不落键（存储最小形，不拒绝）");
  }
  for (const bad of [1, 0, "true", "yes", {}]) {
    throwsWith(
      () => normalizeButtons([{ name: "a", prompt: "p", team: bad }]),
      /team must be a boolean/,
      "非布尔 team 拒绝：" + JSON.stringify(bad)
    );
  }

  /* 无该键条目重新落盘逐字节不变（spec 场景「团队键序列化逐字节不变」）。 */
  const legacy = {
    name: "旧",
    prompt: "p",
    autoSend: true,
    newSession: true,
    jumpNewSession: false,
    prepend: true,
    model: { provider: "x", model: "y" },
    preState: "reviewed",
    shortcut: "F8"
  };
  assert.equal(JSON.stringify(normalizeButtons([legacy])[0]), JSON.stringify(legacy), "既有条目（无 team）序列化逐字节不变");

  /* 漂移读面容错：非布尔原值保留（设置页标「不可用」并拒绝保存）。 */
  const driftItem = { name: "旧行", prompt: "p", team: "yes" };
  throwsWith(() => normalizeButtons([driftItem]), /team must be a boolean/, "默认严格读面同样拒绝");
  const [drift] = normalizeButtons([driftItem], { tolerateUnknownTeam: true });
  assert.equal(drift.team, "yes", "容错读保留漂移原值");
  const projected = buttonsSectionOf({ buttons: [driftItem] });
  assert.equal(projected.length, 1, "读面容错投影不丢漂移条目");
  assert.equal(projected[0].team, "yes", "漂移值随投影原样保留");
}

console.log("buttons-schema-smoke: all assertions passed");
