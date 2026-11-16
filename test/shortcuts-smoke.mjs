/**
 * 快捷键纯逻辑冒烟（add-cosmos-shortcuts 1.4 / spec cosmos-shortcuts「键位池与规范形」
 * 「缺省键位与净房」「跨域唯一性校验」）：规范形往返、修饰键裁决（Shift/Meta 跳过、
 * Ctrl/Alt 精确匹配）、保留键排除、净房漂移回落、优先序冲突回落、查重矩阵
 * （全局×全局 / 全局×按钮 / 按钮×按钮 / 跨列表）断言。
 * 运行：node test/shortcuts-smoke.mjs
 */
import assert from "node:assert/strict";
import {
  SHORTCUT_ALTERNATIVE_OF,
  SHORTCUT_BROWSER_RESERVED,
  SHORTCUT_BUTTON_KEYS,
  SHORTCUT_DEFAULTS,
  SHORTCUT_FIELDS,
  SHORTCUT_GLOBAL_KEYS,
  SHORTCUT_MODIFIERS,
  SHORTCUT_PAN_RESERVED,
  SHORTCUT_RISKY_KEYS,
  SHORTCUT_UI_ORDER,
  canonicalOf,
  canonicalOfEvent,
  isButtonShortcut,
  isGlobalShortcut,
  shortcutConflictOf,
  shortcutConflictOnFieldOf,
  shortcutConflictOnRowOf,
  shortcutLabelOf,
  shortcutMatches,
  shortcutsIssue,
  shortcutsOf
} from "../src/shortcuts.mjs";

const keyEvent = (code, modifiers) => ({
  code,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...(modifiers ?? {})
});

/* ── 1. 规范形往返一致（spec 场景「规范形往返一致」） ── */
{
  assert.equal(canonicalOf({ ctrlKey: true }, "KeyQ"), "Ctrl+KeyQ", "Ctrl+Q → Ctrl+KeyQ");
  assert.equal(canonicalOf({}, "KeyM"), "KeyM", "无修饰 M → KeyM");
  assert.equal(canonicalOf({ altKey: true }, "KeyH"), "Alt+KeyH", "Alt+H → Alt+KeyH");
  assert.equal(canonicalOf({ ctrlKey: true, altKey: true }, "KeyH"), "Ctrl+Alt+KeyH", "双修饰拼接（池外但规范形可构造）");
  assert.equal(canonicalOf({ ctrl: true }, "KeyQ"), "Ctrl+KeyQ", "显式布尔形状（ctrl/alt）亦可");
  assert.equal(canonicalOf({}, ""), "", "空 code → 空串");
  assert.equal(canonicalOf(null, "KeyM"), "KeyM", "null 修饰对象 → 无修饰");
  assert.equal(canonicalOfEvent(keyEvent("Backquote")), "Backquote", "事件 → 规范形（无修饰）");
  assert.equal(canonicalOfEvent(keyEvent("KeyQ", { ctrlKey: true })), "Ctrl+KeyQ", "事件 → 规范形（Ctrl+Q）");
  assert.equal(canonicalOfEvent(null), "", "null 事件 → 空串");
  /* 规范形往返：配置值 === 事件规范形（组合与单键两组） */
  for (const value of ["Escape", "Backquote", "KeyM", "Ctrl+KeyQ", "Alt+KeyH"]) {
    assert.ok(isGlobalShortcut(value), "池内可分配：" + value);
  }
}

/* ── 2. 修饰键裁决（D8b：Shift/Meta 恒跳过；Ctrl/Alt 精确匹配） ── */
{
  assert.equal(shortcutMatches(keyEvent("KeyM"), "KeyM"), true, "无修饰命中单键");
  assert.equal(shortcutMatches(keyEvent("KeyM", { shiftKey: true }), "KeyM"), false, "Shift+M 不触发（加速档语义位）");
  assert.equal(shortcutMatches(keyEvent("KeyM", { metaKey: true }), "KeyM"), false, "Meta+M 不触发（系统语义）");
  assert.equal(shortcutMatches(keyEvent("KeyQ", { ctrlKey: true }), "Ctrl+KeyQ"), true, "组合键精确命中");
  assert.equal(shortcutMatches(keyEvent("KeyQ", { ctrlKey: true, shiftKey: true }), "Ctrl+KeyQ"), false, "Shift+Ctrl+Q 不触发");
  assert.equal(shortcutMatches(keyEvent("KeyQ", { altKey: true }), "Ctrl+KeyQ"), false, "Alt+Q ≠ Ctrl+Q（精确匹配）");
  assert.equal(shortcutMatches(keyEvent("KeyM", { ctrlKey: true }), "KeyM"), false, "Ctrl+M ≠ M（配置不含修饰则不消费）");
  assert.equal(shortcutMatches(keyEvent("KeyH", { altKey: true }), "Alt+KeyH"), true, "组合键改绑命中");
  assert.equal(shortcutMatches(keyEvent("KeyH", { altKey: true, shiftKey: true }), "Alt+KeyH"), false, "Shift+Alt+H 不触发");
  assert.equal(shortcutMatches(keyEvent("KeyM"), "KeyN"), false, "异键不命中");
  assert.equal(shortcutMatches(keyEvent("KeyM"), ""), false, "空配置不命中");
  assert.equal(shortcutMatches(keyEvent("KeyM"), 42), false, "非字符串配置不命中");
  assert.equal(shortcutMatches(null, "KeyM"), false, "null 事件不命中");
  assert.equal(shortcutMatches({ ctrlKey: false }, "KeyM"), false, "缺 code 不命中");
}

/* ── 3. 键位池：保留键排除 / 池同源枚举（spec 场景「保留键不可选」） ── */
{
  /* WASD 与 Shift/Space 绝不入池（单键与组合键两个方向） */
  for (const code of SHORTCUT_PAN_RESERVED) {
    assert.equal(SHORTCUT_GLOBAL_KEYS.includes(code), false, code + " 不入单键池");
    for (const modifier of SHORTCUT_MODIFIERS) {
      assert.equal(SHORTCUT_GLOBAL_KEYS.includes(modifier + "+" + code), false, modifier + "+" + code + " 不入组合键池");
    }
  }
  for (const bad of ["Space", "ShiftLeft", "ShiftRight", "F1", "F3", "F5", "F6", "F7", "F10", "F11", "F12", "Enter", "Tab"]) {
    assert.equal(isGlobalShortcut(bad), false, bad + " 不入池");
  }
  /* 浏览器强保留组合全部排除（Ctrl+Q 不在该表——例内保留） */
  for (const value of SHORTCUT_BROWSER_RESERVED) {
    assert.equal(SHORTCUT_GLOBAL_KEYS.includes(value), false, value + " 强保留组合不入池");
  }
  assert.equal(SHORTCUT_BROWSER_RESERVED.includes("Ctrl+KeyQ"), false, "Ctrl+Q 不在强保留表内（D1 例内保留）");
  assert.ok(SHORTCUT_RISKY_KEYS.includes("Ctrl+KeyQ"), "Ctrl+Q 登记为风险键");
  assert.equal(SHORTCUT_ALTERNATIVE_OF["Ctrl+KeyQ"], "Alt+KeyQ", "风险键提供 Alt+Q 替代");
  assert.ok(SHORTCUT_GLOBAL_KEYS.includes("Alt+KeyQ"), "替代键在主池内");

  /* 池的组成（单一常量表导出，设置页下拉同源） */
  assert.ok(SHORTCUT_GLOBAL_KEYS.includes("Escape"), "Escape 入池");
  assert.ok(SHORTCUT_GLOBAL_KEYS.includes("Backquote"), "Backquote 入池");
  assert.ok(SHORTCUT_GLOBAL_KEYS.includes("KeyQ"), "字母入池");
  assert.ok(SHORTCUT_GLOBAL_KEYS.includes("Ctrl+KeyQ"), "Ctrl+字母入池");
  assert.ok(SHORTCUT_GLOBAL_KEYS.includes("Alt+KeyH"), "Alt+字母入池");
  assert.equal(new Set(SHORTCUT_GLOBAL_KEYS).size, SHORTCUT_GLOBAL_KEYS.length, "池内无重复");
  /* 单键 = 2（Escape/Backquote）+ 22（字母去 WASD）+ 10（数字）+ 4（功能键） */
  const singleCount = SHORTCUT_GLOBAL_KEYS.filter((value) => !value.includes("+")).length;
  assert.equal(singleCount, 2 + 22 + 10 + 4, "单键槽位 = 38");
  /* 组合键 = 2 修饰 × 22 字母 − 2 强保留（Ctrl+T / Ctrl+N；Ctrl+W 已因 WASD 排除） */
  const comboCount = SHORTCUT_GLOBAL_KEYS.length - singleCount;
  assert.equal(comboCount, 2 * 22 - 2, "组合键槽位 = 42");
  /* 四缺省全部在池内且互不相同 */
  const defaults = SHORTCUT_FIELDS.map((field) => SHORTCUT_DEFAULTS[field]);
  assert.equal(new Set(defaults).size, 4, "四缺省互不相同");
  for (const value of defaults) assert.ok(isGlobalShortcut(value), "缺省在池内：" + value);
  assert.deepEqual(
    Object.keys(SHORTCUT_DEFAULTS),
    SHORTCUT_FIELDS,
    "缺省表键序 = 优先序"
  );
}

/* ── 4. 按钮键域（15 槽：数字 + F2/F4/F8/F9） ── */
{
  /* 槽位 = 10 数字 + 4 功能键 = 14（spec 枚举为准；design 的「15 槽」为算术笔误）。 */
  assert.equal(SHORTCUT_BUTTON_KEYS.length, 14, "按钮键域 14 槽（0–9 共 10 + F2/F4/F8/F9 共 4）");
  assert.deepEqual(SHORTCUT_BUTTON_KEYS.slice(0, 10), [
    "Digit0", "Digit1", "Digit2", "Digit3", "Digit4",
    "Digit5", "Digit6", "Digit7", "Digit8", "Digit9"
  ], "数字 0–9 顺序枚举（下拉顺序）");
  assert.deepEqual(SHORTCUT_BUTTON_KEYS.slice(10), ["F2", "F4", "F8", "F9"], "安全功能键");
  for (const value of SHORTCUT_BUTTON_KEYS) assert.ok(isButtonShortcut(value), "按钮域内：" + value);
  for (const bad of ["KeyQ", "Ctrl+KeyQ", "Backquote", "Escape", "F1", "F3", "F5", "F12", "Space", "", null, 1]) {
    assert.equal(isButtonShortcut(bad), false, "按钮域外：" + String(bad));
  }
  /* 按钮域 ⊂ 全局单键域（跨域查重的前提） */
  for (const value of SHORTCUT_BUTTON_KEYS) assert.ok(isGlobalShortcut(value), "按钮键亦是全局单键候选：" + value);
}

/* ── 5. 展示标签（设置页下拉 / 浮窗提示同源） ── */
{
  assert.equal(shortcutLabelOf("Escape"), "Esc");
  assert.equal(shortcutLabelOf("Backquote"), "~");
  assert.equal(shortcutLabelOf("KeyM"), "M");
  assert.equal(shortcutLabelOf("Digit1"), "1");
  assert.equal(shortcutLabelOf("F2"), "F2");
  assert.equal(shortcutLabelOf("Ctrl+KeyQ"), "Ctrl+Q");
  assert.equal(shortcutLabelOf("Alt+KeyQ"), "Alt+Q");
  assert.equal(shortcutLabelOf("Alt+KeyH"), "Alt+H");
  assert.equal(shortcutLabelOf(""), "");
  assert.equal(shortcutLabelOf(42), "");
  assert.equal(shortcutLabelOf("Ctrl+PageUp"), "Ctrl+PageUp", "表外键原样回落（不抛错）");
}

/* ── 6. 净房：缺省 / v7 补默认 / 漂移回落（spec 场景「v7 载荷零迁移补默认」「漂移值净化」） ── */
{
  const defaults = shortcutsOf(null);
  assert.deepEqual(defaults, { ...SHORTCUT_DEFAULTS }, "空载荷 → 四键缺省");
  assert.deepEqual(shortcutsOf(undefined), defaults, "undefined 同缺省");
  assert.deepEqual(shortcutsOf({}), defaults, "空对象同缺省");
  assert.deepEqual(shortcutsOf([]), defaults, "数组按非法 → 缺省");
  assert.deepEqual(shortcutsOf("x"), defaults, "字符串按非法 → 缺省");
  /* v7 载荷（settings 无 shortcuts 子对象 / 子对象为 undefined）→ 补默认（零迁移） */
  assert.deepEqual(shortcutsOf(undefined), defaults, "v7 载荷补默认");
  /* 漂移值净化：池外 / 非字符串 / 空串逐键回落 */
  assert.equal(shortcutsOf({ goHome: "F5" }).goHome, "Backquote", "池外 F5 → 回落缺省 ~");
  assert.equal(shortcutsOf({ goHome: 123 }).goHome, "Backquote", "非字符串 → 回落缺省");
  assert.equal(shortcutsOf({ goHome: "" }).goHome, "Backquote", "空串 → 回落缺省");
  assert.equal(shortcutsOf({ closePage: "KeyW" }).closePage, "Escape", "WASD 保留键 → 回落缺省");
  assert.equal(shortcutsOf({ closePage: "Ctrl+KeyT" }).closePage, "Escape", "浏览器强保留组合 → 回落缺省");
  assert.equal(shortcutsOf({ voiceToggle: "Alt+KeyQ" }).voiceToggle, "Alt+KeyQ", "合法替代值透传");
  assert.equal(shortcutsOf({ closePage: "F2" }).closePage, "F2", "关闭键改绑 F2 合法（spec 场景）");
  /* 键序稳定（分发/序列化依赖） */
  assert.deepEqual(Object.keys(shortcutsOf({})), SHORTCUT_FIELDS, "输出键序 = 优先序");
}

/* ── 7. 读面冲突固定优先序回落（spec 场景「手工冲突读面确定性」） ── */
{
  /* closePage 与 goHome 同为 KeyN → closePage 保留、goHome 回落缺省 */
  const pair = shortcutsOf({ closePage: "KeyN", goHome: "KeyN" });
  assert.equal(pair.closePage, "KeyN", "closePage 按优先序保留");
  assert.equal(pair.goHome, "Backquote", "goHome 冲突回落缺省");
  assert.equal(new Set(Object.values(pair)).size, 4, "冲突回落结果恒无重复");

  /* 三键同值：首个保留、其余依次回落不同缺省（表恒无冲突） */
  const triple = shortcutsOf({ closePage: "KeyN", goHome: "KeyN", togglePan: "KeyN", voiceToggle: "KeyN" });
  assert.equal(triple.closePage, "KeyN");
  assert.equal(new Set(Object.values(triple)).size, 4, "三键冲突后仍无重复");

  /* 优先序覆盖全部四键：voiceToggle 最后回落 */
  const order = shortcutsOf({ closePage: "F2", goHome: "F2", togglePan: "F2", voiceToggle: "F2" });
  assert.deepEqual(
    Object.keys(order).map((field) => order[field]),
    ["F2", "Backquote", "KeyM", "Ctrl+KeyQ"],
    "优先序 closePage > goHome > togglePan > voiceToggle 逐位回落"
  );

  /* 缺省本身被前一键占用 → 取首个空闲缺省（仍无重复） */
  const stolen = shortcutsOf({ closePage: "Backquote", goHome: "Backquote" });
  assert.equal(stolen.closePage, "Backquote", "closePage 保留手工值");
  assert.notEqual(stolen.goHome, "Backquote", "goHome 的缺省被占用 → 取其它空闲缺省");
  assert.equal(new Set(Object.values(stolen)).size, 4, "无重复");
  const stolenAll = shortcutsOf({ closePage: "Backquote", goHome: "Backquote", togglePan: "Backquote", voiceToggle: "Backquote" });
  assert.equal(new Set(Object.values(stolenAll)).size, 4, "全部冲突后仍无重复");
}

/* ── 8. 跨域唯一性：全局×全局 / 全局×按钮 / 按钮×按钮 / 跨列表 ── */
{
  const defaults = shortcutsOf(null);
  const empty = shortcutConflictOf(defaults, { proposals: [], constellations: [] });
  assert.equal(empty, null, "默认配置天然无冲突（spec 场景）");
  assert.equal(shortcutsIssue(defaults, { proposals: [], constellations: [] }), "", "issue 无冲突 → 空串");

  /* 全局 × 全局 */
  const gg = shortcutConflictOf({ ...SHORTCUT_DEFAULTS, togglePan: "Backquote" }, {});
  assert.ok(gg, "两全局键同值 → 冲突");
  assert.equal(gg.value, "Backquote");
  assert.equal(gg.sides.length, 2);
  assert.equal(shortcutsIssue({ ...SHORTCUT_DEFAULTS, togglePan: "Backquote" }, {}), "shortcutDup", "issue → shortcutDup");

  /* 全局 × 按钮（spec 场景「全局键与按钮键冲突拒绝」：按钮 F2 后把 togglePan 改 F2） */
  const gb = shortcutConflictOf(
    { ...SHORTCUT_DEFAULTS, togglePan: "F2" },
    { proposals: [{ name: "审查", prompt: "p", shortcut: "F2" }] }
  );
  assert.ok(gb, "全局键与按钮键同值 → 冲突");
  assert.deepEqual(gb.sides.map((side) => side.kind), ["global", "button"], "先全局后按钮（定位双方）");
  assert.equal(gb.sides[1].name, "审查", "冲突按钮带名字");
  assert.equal(gb.sides[1].index, 0, "冲突按钮带行号");
  assert.equal(gb.sides[0].field, "togglePan", "冲突全局键带字段");
  assert.equal(shortcutConflictOnFieldOf(gb, "togglePan"), true, "页码行内定位：全局字段");
  assert.equal(shortcutConflictOnFieldOf(gb, "goHome"), false, "无关字段不定位");
  assert.equal(shortcutConflictOnRowOf(gb, "proposals", 0), true, "行内定位：提案行");
  assert.equal(shortcutConflictOnRowOf(gb, "constellations", 0), false, "跨列表不误定位");

  /* 按钮 × 按钮（同列表） */
  const bb = shortcutConflictOf(defaults, {
    proposals: [
      { name: "甲", prompt: "p" },
      { name: "乙", prompt: "p", shortcut: "Digit1" },
      { name: "丙", prompt: "p", shortcut: "Digit1" }
    ]
  });
  assert.ok(bb, "两按钮同键 → 冲突");
  assert.deepEqual(bb.sides.map((side) => side.index), [1, 2], "定位两条冲突行");
  assert.equal(shortcutConflictOnRowOf(bb, "proposals", 2), true, "第二行在内");
  assert.equal(shortcutConflictOnRowOf(bb, "proposals", 0), false, "无键行不在内");

  /* 跨列表（提案 × 星座，spec「与提案动作条键位不冲突」） */
  const cross = shortcutConflictOf(defaults, {
    proposals: [{ name: "提案键", prompt: "p", shortcut: "Digit2" }],
    constellations: [{ name: "星座键", prompt: "p", shortcut: "Digit2" }]
  });
  assert.ok(cross, "跨列表同键 → 冲突");
  assert.equal(cross.sides[0].list, "proposals");
  assert.equal(cross.sides[1].list, "constellations");
  assert.equal(shortcutConflictOnRowOf(cross, "constellations", 0), true, "星座行可定位");

  /* 「无」不参与：多行无键 + 无键不冲突 */
  assert.equal(shortcutConflictOf(defaults, {
    proposals: [{ name: "a", prompt: "p" }, { name: "b", prompt: "p", shortcut: "" }],
    constellations: [{ name: "c", prompt: "p", shortcut: null }]
  }), null, "缺省/空串/null 不参与查重");

  /* 非对象入参防御 */
  assert.equal(shortcutConflictOf(null, null), null, "null 入参不抛错");
  assert.equal(shortcutConflictOf(undefined, undefined), null, "undefined 入参不抛错");
  assert.equal(shortcutConflictOf(defaults, { proposals: "x", constellations: null }), null, "列表非数组按空");
}

/* ── 9. 设置页行序与优先序解耦 ── */
{
  assert.deepEqual(SHORTCUT_UI_ORDER, ["goHome", "togglePan", "voiceToggle", "closePage"], "页签行序（回到银河 / 移动开关 / 语音开关 / 关闭页面）");
  assert.deepEqual([...SHORTCUT_UI_ORDER].sort(), [...SHORTCUT_FIELDS].sort(), "两表覆盖同一四键");
  assert.notDeepEqual(SHORTCUT_UI_ORDER, SHORTCUT_FIELDS, "行序与冲突优先序刻意不同");
}

console.log("shortcuts-smoke: all assertions passed");
