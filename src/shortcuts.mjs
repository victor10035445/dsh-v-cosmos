/**
 * Cosmos 快捷键纯逻辑（add-cosmos-shortcuts 1.1–1.3 / spec cosmos-shortcuts
 * 「键位池与规范形」「缺省键位与净房」「跨域唯一性校验」）。
 *
 * 独立纯逻辑模块——零 DOM、双半区可 import、test/shortcuts-smoke.mjs 直测：
 *  1. **键位池**（单一常量表导出，设置页下拉与之同源）：
 *     - 全局键域 = 单键 `{ Escape, Backquote } ∪ KeyA–KeyZ（不含 WASD 保留键）
 *       ∪ Digit0–Digit9 ∪ { F2, F4, F8, F9 }` + `Ctrl|Alt × 字母`组合键
 *       （不含 WASD、不含浏览器强保留组合；`Ctrl+KeyQ` 例内保留——浮窗语音缺省键、用户裁决）；
 *     - 按钮键域 = `Digit0–Digit9` + `F2/F4/F8/F9`（15 槽；保守枚举从源头减少与全局键
 *       的交叉面，跨域查重再兜底）。
 *  2. **规范形** = `[Ctrl+|Alt+]ev.code`（物理键语义，键位布局无关——与引擎 WASD
 *     `PAN_KEYS` / 空格 `SESSION_OPEN_KEY` 同一口径）；Shift 不作修饰键（WASD 加速档
 *     语义位），Ctrl/Alt 由 canonical 精确匹配裁决（D8b）。
 *  3. **事件匹配器** `shortcutMatches(ev, value)`：Shift/Meta 恒跳过 + canonical 精确相等。
 *  4. **净房** `shortcutsOf(raw)`：逐键池校验回落缺省 + 读面固定优先序冲突回落
 *     （`closePage > goHome > togglePan > voiceToggle`；冲突者回落缺省，缺省亦被占用时
 *     按同一优先序取首个空闲缺省）→ 分发器消费的表恒无冲突（运行时零仲裁）。
 *  5. **跨域唯一性** `shortcutConflictOf` / `shortcutsIssue`：全局四键 ∪ 两列表按钮键
 *     并集查重（「无」= 空串不参与），供设置页草稿校验与保存链共用。
 *
 * 键位行为本身（引擎飞回/开关翻转、关闭分层链、浮窗语音 toggle、动作条触发门控）
 * 分别由 `cosmos/engine.mjs`、`client.jsx` 承载；本模块只描述「什么键、怎么比对」。
 */

/* ---------- 字段与缺省 ---------- */

/**
 * 全局键位字段（**固定顺序 = 读面冲突回落优先序**，spec「缺省键位与净房」）：
 * `closePage > goHome > togglePan > voiceToggle`。
 */
export const SHORTCUT_FIELDS = Object.freeze(["closePage", "goHome", "togglePan", "voiceToggle"]);

/**
 * 「快捷键」设置页签的行序（spec「设置页『快捷键』页签」：回到银河 / 移动开关 /
 * 语音开关 / 关闭页面）——与冲突优先序刻意不同，MUST NOT 混用。
 */
export const SHORTCUT_UI_ORDER = Object.freeze(["goHome", "togglePan", "voiceToggle", "closePage"]);

/**
 * 四键出厂缺省（全部为用户裁决值）：`closePage = Escape`、`goHome = Backquote`、
 * `togglePan = KeyM`、`voiceToggle = Ctrl+KeyQ`。改缺省只动这里一处。
 */
export const SHORTCUT_DEFAULTS = Object.freeze({
  closePage: "Escape",
  goHome: "Backquote",
  togglePan: "KeyM",
  voiceToggle: "Ctrl+KeyQ"
});

/* ---------- 键位池（单一常量表；设置页下拉同源） ---------- */

/** 修饰键域（单修饰；Shift/Meta 不入池——Shift 是 WASD 加速档语义位，Meta 是系统语义）。 */
export const SHORTCUT_MODIFIERS = Object.freeze(["Ctrl", "Alt"]);

/** WASD 平移保留键（`ev.code` 语义，含已废弃的 `code.slice(3)` 口径同源）。 */
export const SHORTCUT_PAN_RESERVED = Object.freeze(["KeyW", "KeyA", "KeyS", "KeyD"]);

/** 字母键（KeyA–KeyZ）。 */
const LETTER_CODES = Object.freeze(
  Array.from({ length: 26 }, (_unused, index) => "Key" + String.fromCharCode(65 + index))
);

/**
 * 浏览器强保留组合（spec「键位池与规范形」明文列举；网页 `preventDefault` 拦不住或语义
 * 属浏览器）。池构建时剔除——`Ctrl+Shift+*` 形态因 Shift 不入池天然不可达，保留在表内
 * 作为口径文档与冒烟断言。`Ctrl+KeyQ` **不在**本表（例内保留，见 `SHORTCUT_RISKY_KEYS`）。
 */
export const SHORTCUT_BROWSER_RESERVED = Object.freeze([
  "Ctrl+KeyT",
  "Ctrl+KeyN",
  "Ctrl+KeyW",
  "Ctrl+Shift+KeyN",
  "Ctrl+Shift+KeyT",
  "Ctrl+Shift+KeyW",
  "Ctrl+Tab",
  "Ctrl+Shift+Tab",
  "Ctrl+PageUp",
  "Ctrl+PageDown"
]);

/**
 * 风险键（池内但浏览器可能拦截）：`Ctrl+KeyQ` 在 Chrome/Edge/Firefox（Windows）是浏览器级
 * 「退出浏览器」保留组合，网页 `preventDefault` 拦不住。缺省遵用户裁决保留；设置页 MUST
 * 标注风险并提供替代（`SHORTCUT_ALTERNATIVE_OF`）。
 */
export const SHORTCUT_RISKY_KEYS = Object.freeze(["Ctrl+KeyQ"]);

/** 风险键的替代建议（设置页说明文案用；纯数据，不参与校验）。 */
export const SHORTCUT_ALTERNATIVE_OF = Object.freeze({ "Ctrl+KeyQ": "Alt+KeyQ" });

/**
 * 按钮快捷键域（数字 0–9 + 安全功能键 F2/F4/F8/F9 = **14 槽**）。
 * 注：design D7 的「15 槽」为枚举算术笔误（10 + 4 = 14）；以 spec 枚举
 * （`Digit0`–`Digit9` 与 `F2`/`F4`/`F8`/`F9`）为准，池为纯枚举、后续扩充是向后兼容追加。
 */
export const SHORTCUT_BUTTON_KEYS = Object.freeze([
  "Digit0",
  "Digit1",
  "Digit2",
  "Digit3",
  "Digit4",
  "Digit5",
  "Digit6",
  "Digit7",
  "Digit8",
  "Digit9",
  "F2",
  "F4",
  "F8",
  "F9"
]);

/**
 * 全局键位池（**单一常量表**；设置页四行下拉与冒烟断言同源）。
 * 顺序：单键（Escape / Backquote → 字母 → 数字 → 功能键）→ 组合键（Ctrl → Alt）。
 * @type {ReadonlyArray<string>}
 */
export const SHORTCUT_GLOBAL_KEYS = Object.freeze((function buildGlobalPool() {
  const pool = [];
  const push = function (value) {
    if (!pool.includes(value)) pool.push(value);
  };
  push("Escape");
  push("Backquote");
  for (const code of LETTER_CODES) {
    if (SHORTCUT_PAN_RESERVED.includes(code)) continue;
    push(code);
  }
  for (const key of SHORTCUT_BUTTON_KEYS) push(key);
  for (const modifier of SHORTCUT_MODIFIERS) {
    for (const code of LETTER_CODES) {
      if (SHORTCUT_PAN_RESERVED.includes(code)) continue;
      const value = modifier + "+" + code;
      if (SHORTCUT_BROWSER_RESERVED.includes(value)) continue;
      push(value);
    }
  }
  return pool;
})());

/* ---------- 池判定 ---------- */

/**
 * 全局键位池内判定（非字符串/空串/池外一律 false）。
 * @param {unknown} value
 * @returns {boolean}
 */
export function isGlobalShortcut(value) {
  return typeof value === "string" && SHORTCUT_GLOBAL_KEYS.includes(value);
}

/**
 * 按钮键位域判定（`Digit0–Digit9` / `F2` / `F4` / `F8` / `F9`；非字符串/池外 false）。
 * @param {unknown} value
 * @returns {boolean}
 */
export function isButtonShortcut(value) {
  return typeof value === "string" && SHORTCUT_BUTTON_KEYS.includes(value);
}

/* ---------- 规范形 ---------- */

/**
 * 规范形构造（spec「键位池与规范形」）：`(ctrlKey ? "Ctrl+" : "") + (altKey ? "Alt+" : "") + code`。
 * 修饰键读取兼容事件对象（`ctrlKey`/`altKey`）与显式布尔（`ctrl`/`alt`）两种形状。
 * @param {{ctrlKey?: boolean, ctrl?: boolean, altKey?: boolean, alt?: boolean}|null|undefined} modifiers
 * @param {string} code `ev.code`（物理键）
 * @returns {string} 规范形（空 code → ""）
 */
export function canonicalOf(modifiers, code) {
  const source = modifiers !== null && typeof modifiers === "object" ? modifiers : {};
  const ctrl = source.ctrlKey === true || source.ctrl === true;
  const alt = source.altKey === true || source.alt === true;
  const key = typeof code === "string" ? code : "";
  if (key === "") return "";
  return (ctrl ? "Ctrl+" : "") + (alt ? "Alt+" : "") + key;
}

/**
 * 事件 → 规范形（`ev.code` 物理键语义；Shift/Meta **不**参与——二者为跳过型修饰，见
 * `shortcutMatches`）。
 * @param {KeyboardEvent|object|null|undefined} ev
 * @returns {string}
 */
export function canonicalOfEvent(ev) {
  if (ev === null || typeof ev !== "object") return "";
  return canonicalOf(ev, ev.code);
}

/**
 * 事件匹配器（分发层唯一匹配口径，D8b 修饰键裁决）：
 *  - `Shift` 按下 MUST NOT 匹配（WASD 加速档语义位——canonical 不含 Shift，不加此裁决
 *    会让 `Shift+M` 漏过）；
 *  - `Meta` 按下 MUST NOT 匹配（系统语义）；
 *  - `Ctrl`/`Alt` 由 canonical **精确**匹配裁决：配置含相应修饰的组合键照常命中，
 *    配置不含时 canonical 不相等自然不消费（修掉初稿「任意修饰即跳过」把组合键绑定
 *    全部变成死绑定的矛盾）。
 * @param {KeyboardEvent|object|null|undefined} ev
 * @param {unknown} value 配置的规范形
 * @returns {boolean}
 */
export function shortcutMatches(ev, value) {
  if (ev === null || typeof ev !== "object") return false;
  if (typeof value !== "string" || value === "") return false;
  if (ev.shiftKey === true || ev.metaKey === true) return false;
  if (typeof ev.code !== "string" || ev.code === "") return false;
  return canonicalOf(ev, ev.code) === value;
}

/* ---------- 展示 ---------- */

/** 单键 → 印刷标签（`Escape` → `Esc`；`Backquote` → `~`；`KeyM` → `M`；`Digit1` → `1`）。 */
function keyLabelOf(code) {
  const text = String(code ?? "");
  if (text === "") return "";
  if (text === "Escape") return "Esc";
  if (text === "Backquote") return "~";
  if (text.startsWith("Key") && text.length === 4) return text.slice(3);
  if (text.startsWith("Digit") && text.length === 6) return text.slice(5);
  return text;
}

/**
 * 规范形 → 界面标签（`Ctrl+KeyQ` → `Ctrl+Q`、`Alt+KeyQ` → `Alt+Q`、`KeyM` → `M`、
 * `Backquote` → `~`、`Escape` → `Esc`）。设置页下拉、浮窗提示文案与按钮行回显共用
 * （**物理键位口径**：非 QWERTY 布局下印刷字母可能与键帽不一致，说明列注明）。
 * @param {unknown} value 规范形
 * @returns {string}
 */
export function shortcutLabelOf(value) {
  if (typeof value !== "string" || value === "") return "";
  for (const modifier of SHORTCUT_MODIFIERS) {
    const prefix = modifier + "+";
    if (value.startsWith(prefix)) return modifier + "+" + keyLabelOf(value.slice(prefix.length));
  }
  return keyLabelOf(value);
}

/* ---------- 净房（读面确定性） ---------- */

/**
 * 快捷键净房（纯函数）：四键逐池校验回落缺省 + 读面冲突固定优先序回落。
 *
 * 规则（spec「缺省键位与净房」）：
 *  1. 池外值 / 非字符串 / 空串 → 该键缺省；
 *  2. 按 `SHORTCUT_FIELDS` 优先序保留首次出现；冲突者回落缺省；
 *  3. 回落缺省本身已被占用（手工把前一键设成后一键的缺省值）→ 按同一优先序取首个
 *     **未被占用**的缺省 → 返回表**恒无重复值**（分发器运行时零仲裁）。
 *
 * @param {unknown} raw `settings.shortcuts` 载荷（缺失/非法 → 全部缺省）
 * @returns {{closePage: string, goHome: string, togglePan: string, voiceToggle: string}}
 */
export function shortcutsOf(raw) {
  const source = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const taken = new Set();
  const out = {};
  for (const field of SHORTCUT_FIELDS) {
    const fallback = SHORTCUT_DEFAULTS[field];
    const value = source[field];
    let picked = isGlobalShortcut(value) ? value : fallback;
    if (taken.has(picked)) {
      /* 冲突者先回落**本键缺省**；本键缺省亦被占用时按同一优先序取首个空闲缺省。 */
      let next = taken.has(fallback) ? "" : fallback;
      if (next === "") {
        for (const other of SHORTCUT_FIELDS) {
          const candidate = SHORTCUT_DEFAULTS[other];
          if (!taken.has(candidate)) {
            next = candidate;
            break;
          }
        }
      }
      /* 理论不可达：四缺省互异且当前键之前至多 3 个已占用值 → 必有空闲缺省。
         兜底仍取本键缺省，SHALL NOT 抛错（渲染端兜底纪律）。 */
      picked = next === "" ? fallback : next;
    }
    taken.add(picked);
    out[field] = picked;
  }
  return out;
}

/* ---------- 跨域唯一性（保存面） ---------- */

/** 冲突双方的可定位描述（设置页行内错误与面板定位提示共用）。 */
function globalSide(field, value) {
  return { kind: "global", field, name: "", index: -1, value };
}

function buttonSide(list, button, index, value) {
  return {
    kind: "button",
    field: "",
    list,
    index,
    name: typeof button?.name === "string" ? button.name.trim() : "",
    value
  };
}

/**
 * 跨域唯一性查重（纯函数，spec「跨域唯一性校验」）：并集 = 4 全局键 ∪ 提案按钮全部
 * `shortcut` ∪ 星座按钮全部 `shortcut`；同规范形值即冲突（空串「无」不参与）。
 * 返回 null（无冲突）或 `{ value, sides: [先出现方, 冲突方] }`。
 *
 * @param {unknown} shortcuts 全局快捷键表（草稿或净房值；非对象按空处理）
 * @param {{proposals?: Array<object>, constellations?: Array<object>}} [lists] 两列表草稿
 * @returns {null|{value: string, sides: Array<{kind: string, field: string, list?: string,
 *          index: number, name: string, value: string}>}}
 */
export function shortcutConflictOf(shortcuts, lists) {
  const table = shortcuts !== null && typeof shortcuts === "object" ? shortcuts : {};
  const source = lists !== null && typeof lists === "object" ? lists : {};
  const proposals = Array.isArray(source.proposals) ? source.proposals : [];
  const constellations = Array.isArray(source.constellations) ? source.constellations : [];
  const seen = new Map();
  const register = function (value, side) {
    if (typeof value !== "string" || value === "") return null;
    const previous = seen.get(value);
    if (previous !== undefined) return { value, sides: [previous, side] };
    seen.set(value, side);
    return null;
  };
  for (const field of SHORTCUT_FIELDS) {
    const value = typeof table[field] === "string" ? table[field] : "";
    const hit = register(value, globalSide(field, value));
    if (hit !== null) return hit;
  }
  for (const [list, buttons] of [["proposals", proposals], ["constellations", constellations]]) {
    for (let index = 0; index < buttons.length; index += 1) {
      const button = buttons[index];
      const value = typeof button?.shortcut === "string" ? button.shortcut : "";
      const hit = register(value, buttonSide(list, button, index, value));
      if (hit !== null) return hit;
    }
  }
  return null;
}

/**
 * 保存面查重（控制器 `issue` 契约：返回 "" 或词典键）：`shortcutConflictOf` 的键化投影。
 * @param {unknown} shortcuts
 * @param {{proposals?: Array<object>, constellations?: Array<object>}} [lists]
 * @returns {""|"shortcutDup"}
 */
export function shortcutsIssue(shortcuts, lists) {
  return shortcutConflictOf(shortcuts, lists) === null ? "" : "shortcutDup";
}

/**
 * 冲突是否落在某个列表的第 index 行（设置页行内错误定位用）。
 * @param {ReturnType<typeof shortcutConflictOf>} conflict
 * @param {string} list `proposals` | `constellations`
 * @param {number} index 行号
 * @returns {boolean}
 */
export function shortcutConflictOnRowOf(conflict, list, index) {
  if (conflict === null || typeof conflict !== "object" || !Array.isArray(conflict.sides)) return false;
  return conflict.sides.some((side) => side?.kind === "button" && side.list === list && side.index === index);
}

/**
 * 冲突是否涉及某个全局键位字段（「快捷键」页签行内错误定位用）。
 * @param {ReturnType<typeof shortcutConflictOf>} conflict
 * @param {string} field
 * @returns {boolean}
 */
export function shortcutConflictOnFieldOf(conflict, field) {
  if (conflict === null || typeof conflict !== "object" || !Array.isArray(conflict.sides)) return false;
  return conflict.sides.some((side) => side?.kind === "global" && side.field === field);
}
