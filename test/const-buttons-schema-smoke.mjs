/**
 * 星座按钮 schema 冒烟（add-cosmos-constellation-actions 1.1 / spec
 * cosmos-constellation-actions「星座按钮配置模型」）：归一化口径、`autoSend` 必填布尔恒输出、
 * `newSession` 语义常量、`prepend` 键拒绝、上限/去重拒绝、可选键最小形状、`model` 三元组
 * 透传、读面容错投影、与提案动作 `buttons` 节零交集。
 * 运行：node test/const-buttons-schema-smoke.mjs
 */
import assert from "node:assert/strict";
import { MAX_CONST_BUTTONS, constButtonsSectionOf, normalizeConstButtons } from "../src/const-buttons.mjs";
import { MAX_PROMPT_CHARS, normalizeButtons } from "../src/buttons.mjs";

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

/* ── 1. 合法星座按钮（spec 场景「合法星座按钮被保存」） ── */
{
  const list = normalizeConstButtons([{
    name: " 探索新需求 ",
    prompt: " 请使用 /cosmos-explore 探索新需求并准备发起新提案 "
  }]);
  assert.equal(list.length, 1);
  assert.deepEqual(list[0], {
    name: "探索新需求",
    prompt: "请使用 /cosmos-explore 探索新需求并准备发起新提案",
    autoSend: false,
    newSession: true
  }, "trim + autoSend/newSession 恒输出");
  assert.deepEqual(Object.keys(list[0]), ["name", "prompt", "autoSend", "newSession"], "键序固定（无可选键）");
  assert.ok(!("prepend" in list[0]), "恒不含 prepend 键");
  assert.equal(MAX_CONST_BUTTONS, 32, "上限 32");
}

/* ── 2. newSession 语义常量（spec 场景「newSession 固定为真」） ── */
{
  for (const bad of [false, 0, "true", 1]) {
    throwsWith(
      () => normalizeConstButtons([{ name: "a", prompt: "p", newSession: bad }]),
      /newSession must be true/,
      `newSession=${JSON.stringify(bad)}`
    );
  }
  const missing = normalizeConstButtons([{ name: "旧", prompt: "p" }]);
  assert.equal(missing[0].newSession, true, "缺失 newSession → 按 true 补齐（零迁移）");
  const nullish = normalizeConstButtons([{ name: "旧2", prompt: "p", newSession: null }]);
  assert.equal(nullish[0].newSession, true, "newSession=null → 按未提供处理");
  const explicit = normalizeConstButtons([{ name: "旧", prompt: "p", newSession: true }]);
  assert.deepEqual(explicit[0], missing[0], "显式 true 与缺省逐字段同形");
}

/* ── 3. prepend 键拒绝（spec 场景「prepend 键拒绝」） ── */
{
  throwsWith(
    () => normalizeConstButtons([{ name: "a", prompt: "p", prepend: true }]),
    /must not contain the prepend key/,
    "prepend=true"
  );
  /* 口径是「模型不含该键」：false 也拒绝（不静默忽略，防配置文件与设置页回显漂移）。 */
  throwsWith(
    () => normalizeConstButtons([{ name: "a", prompt: "p", prepend: false }]),
    /must not contain the prepend key/,
    "prepend=false"
  );
  /* 提案动作按钮仍接受 prepend（两节口径独立）。 */
  const proposal = normalizeButtons([{ name: "a", prompt: "p", prepend: true }]);
  assert.equal(proposal[0].prepend, true, "提案动作的 prepend 语义不受影响");
}

/* ── 4. autoSend 必填布尔恒输出 ── */
{
  assert.equal(normalizeConstButtons([{ name: "a", prompt: "p" }])[0].autoSend, false, "缺省 → false");
  assert.equal(normalizeConstButtons([{ name: "a", prompt: "p", autoSend: null }])[0].autoSend, false, "null → false");
  assert.equal(normalizeConstButtons([{ name: "a", prompt: "p", autoSend: true }])[0].autoSend, true);
  throwsWith(
    () => normalizeConstButtons([{ name: "a", prompt: "p", autoSend: "yes" }]),
    /autoSend must be a boolean/,
    "字符串 autoSend"
  );
  throwsWith(
    () => normalizeConstButtons([{ name: "a", prompt: "p", autoSend: 1 }]),
    /autoSend must be a boolean/,
    "数字 autoSend"
  );
}

/* ── 5. 上限与去重拒绝（spec 场景「上限与去重拒绝」） ── */
{
  const max = Array.from({ length: MAX_CONST_BUTTONS }, (_v, i) => ({ name: "b" + i, prompt: "p" }));
  assert.equal(normalizeConstButtons(max).length, MAX_CONST_BUTTONS, "32 条通过");
  throwsWith(
    () => normalizeConstButtons([...max, { name: "overflow", prompt: "p" }]),
    /exceeds 32 entries/,
    "第 33 条"
  );
  throwsWith(
    () => normalizeConstButtons([{ name: "同名", prompt: "a" }, { name: " 同名 ", prompt: "b" }]),
    /is duplicated/,
    "trim 后重名 → 拒绝（不做静默先到先得）"
  );
  assert.equal(
    normalizeConstButtons([{ name: "A", prompt: "x" }, { name: "a", prompt: "y" }]).length,
    2,
    "大小写不同不算重复（显示名按 trim 精确比较）"
  );
}

/* ── 6. 可选键最小形状与 model 透传 ── */
{
  const [plain] = normalizeConstButtons([{ name: "a", prompt: "p" }]);
  assert.ok(!("model" in plain), "未提供 model → 不输出该键");

  const [bound] = normalizeConstButtons([{
    name: "a",
    prompt: "p",
    model: { provider: "deepseek", model: "deepseek-chat", reasoningEffort: "max" }
  }]);
  assert.deepEqual(bound.model, { provider: "deepseek", model: "deepseek-chat", reasoningEffort: "max" }, "model 三元组原样透传");
  assert.deepEqual(
    Object.keys(bound),
    ["name", "prompt", "autoSend", "newSession", "model"],
    "model 位于 newSession 之后（无 prepend 位）"
  );

  const [noEffort] = normalizeConstButtons([{ name: "a", prompt: "p", model: { provider: "p", model: "m", reasoningEffort: null } }]);
  assert.deepEqual(noEffort.model, { provider: "p", model: "m" }, "无等级 → 输出两键（不补默认值）");

  throwsWith(
    () => normalizeConstButtons([{ name: "a", prompt: "p", model: { provider: "", model: "m" } }]),
    /model\.provider/,
    "model 形状校验（空 provider）"
  );
}

/* ── 7. 空条目 / 半空条目 / 入参形状 ── */
{
  const list = normalizeConstButtons([{ name: "  ", prompt: " " }, { name: "a", prompt: "p" }]);
  assert.equal(list.length, 1, "完全空条目剔除（不阻断整份保存）");
  throwsWith(() => normalizeConstButtons([{ name: "", prompt: "p" }]), /name must not be empty/, "半空（缺 name）");
  throwsWith(() => normalizeConstButtons([{ name: "a", prompt: "" }]), /prompt must not be empty/, "半空（缺 prompt）");
  throwsWith(() => normalizeConstButtons([null]), /non-object/, "非对象条目");
  throwsWith(() => normalizeConstButtons([{ name: 1, prompt: "p" }]), /name must be a string/, "name 非字符串");
  const long = "x".repeat(MAX_PROMPT_CHARS + 1);
  throwsWith(() => normalizeConstButtons([{ name: "a", prompt: long }]), /exceeds 20000/, "prompt 超长");

  assert.equal(
    normalizeConstButtons({ constellationButtons: [{ name: "a", prompt: "p" }] }).length,
    1,
    "{constellationButtons} 形态"
  );
  assert.equal(normalizeConstButtons(null).length, 0, "null → 空列表");
  assert.equal(normalizeConstButtons({}).length, 0, "缺节 → 空列表");
}

/* ── 8. 与提案动作配置隔离（spec 场景「与提案动作配置隔离」） ── */
{
  const proposalSection = { buttons: [{ name: "审查", prompt: "p", autoSend: true, newSession: true, prepend: true }] };
  assert.deepEqual(
    normalizeConstButtons(proposalSection),
    [],
    "星座归一化只认 constellationButtons 节（不读 buttons）"
  );
  assert.deepEqual(
    normalizeButtons({ constellationButtons: [{ name: "a", prompt: "p" }] }).length,
    0,
    "提案归一化只认 buttons 节（不读 constellationButtons）"
  );
  assert.deepEqual(
    constButtonsSectionOf({ buttons: [{ name: "a", prompt: "p" }] }),
    [],
    "星座读面不投影 buttons 节"
  );
}

/* ── 9. 读面容错投影（非法条目单条跳过，不抛错） ── */
{
  const projected = constButtonsSectionOf({
    constellationButtons: [
      { name: "ok", prompt: "p", autoSend: true, model: { provider: "x", model: "y" } },
      { name: "bad-prepend", prompt: "p", prepend: true },
      { name: "bad-model", prompt: "p", model: { provider: "", model: "y" } },
      { name: "", prompt: "p" },
      null,
      { name: "ok2", prompt: "q" }
    ]
  });
  assert.equal(projected.length, 2, "非法条目单条跳过（含 prepend 条目）");
  assert.deepEqual(projected[0], {
    name: "ok",
    prompt: "p",
    autoSend: true,
    newSession: true,
    model: { provider: "x", model: "y" }
  }, "合法条目重建走同一路径（含 newSession，无 prepend）");
  assert.equal(projected[1].newSession, true, "旧数据投影补 newSession");
  assert.deepEqual(constButtonsSectionOf(null), [], "无节 → 空");
  assert.deepEqual(constButtonsSectionOf({ constellationButtons: "x" }), [], "节非数组 → 空");
}

/* ── 10. 快捷键可选键（add-cosmos-shortcuts 3.2/3.4）：合法键落盘、键序尾部、
      缺省不落键、池外拒绝、无键序列化逐字节不变 ── */
{
  /* 合法键落盘（spec 场景「合法 shortcut 被保存」） */
  const [withKey] = normalizeConstButtons([{ name: "探索", prompt: "p", shortcut: "F4" }]);
  assert.equal(withKey.shortcut, "F4", "F4 落键");
  assert.deepEqual(
    Object.keys(withKey),
    ["name", "prompt", "autoSend", "newSession", "shortcut"],
    "shortcut 追加尾部（model 之后）"
  );
  const [full] = normalizeConstButtons([
    { name: "全键", prompt: "p", autoSend: true, model: { provider: "x", model: "y" }, shortcut: "Digit9" }
  ]);
  assert.deepEqual(
    Object.keys(full),
    ["name", "prompt", "autoSend", "newSession", "model", "shortcut"],
    "键序固定：model → shortcut"
  );
  /* 缺省/null/空串 → 不落键 */
  for (const absent of [undefined, null, "", "  "]) {
    const [entry] = normalizeConstButtons([{ name: "a", prompt: "p", shortcut: absent }]);
    assert.equal("shortcut" in entry, false, "缺省不落键：" + JSON.stringify(absent));
  }
  /* 无键序列化逐字节不变（spec 场景「无 shortcut 与提案动作同口径零迁移」） */
  const legacy = { name: "旧", prompt: "p", autoSend: true, newSession: true, model: { provider: "x", model: "y" } };
  assert.equal(
    JSON.stringify(normalizeConstButtons([legacy])[0]),
    JSON.stringify({ name: "旧", prompt: "p", autoSend: true, newSession: true, model: { provider: "x", model: "y" } }),
    "既有条目（无 shortcut）序列化逐字节不变"
  );
  /* 池外拒绝（spec 场景「非法 shortcut 被拒绝」）：Backquote / 组合键 / 空对象 / 数字 */
  for (const bad of ["Backquote", "Ctrl+KeyQ", "KeyQ", "Escape", "F1", {}, 2, true]) {
    assert.throws(
      () => normalizeConstButtons([{ name: "a", prompt: "p", shortcut: bad }]),
      /shortcut must be (a string|one of)/,
      "池外/非字符串拒绝：" + String(bad)
    );
  }
  /* 读面容错：池外快捷键原样保留（漂移回显；设置页保存拒绝） */
  const projected = constButtonsSectionOf({
    constellationButtons: [
      { name: "ok", prompt: "p", shortcut: "Digit4" },
      { name: "drift", prompt: "p", shortcut: "KeyQ" }
    ]
  });
  assert.equal(projected.length, 2, "池外快捷键条目保留（漂移回显，非静默丢弃）");
  assert.equal(projected[0].shortcut, "Digit4", "读面保留合法快捷键");
  assert.equal(projected[1].shortcut, "KeyQ", "读面容错保留漂移原值");
  /* 与提案动作同域（按钮键域同表）——两节口径同源 */
  assert.equal(
    normalizeButtons([{ name: "p1", prompt: "p", shortcut: "F2" }])[0].shortcut,
    normalizeConstButtons([{ name: "c1", prompt: "p", shortcut: "F2" }])[0].shortcut,
    "两节共用同一按钮键域"
  );
}

console.log("const-buttons-schema-smoke: all assertions passed");
