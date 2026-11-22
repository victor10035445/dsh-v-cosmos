/**
 * 浮窗皮肤作用域冒烟（stage5-cosmos-const-float-skin 4.1–4.3；design D1/D2/D4/D5）。
 *
 * 锁 spec「皮肤与主题双跟随」「V9 面板跟随皮肤」「令牌零泄漏」「皮肤令牌缺席逐值回落」
 * 的**可纯逻辑 / 源码直测**部分：
 *  - ① 作用域接线：组件订阅 `cosmosSkinStore`、portal 根持 ref、`useLayoutEffect` 经
 *    `applySkinTokens` 下发（依赖含 `armed`——开合后必须重下发，否则闭合→打开漏发）；
 *  - ② 映射对账（4.1）：浮窗 CSS 与 **t9ime（新旧两版样式）** 消费的全部色彩令牌
 *    ⊆ 映射表 ∪ 保留表；映射表逐枚可对（18 枚 DSW 别名 + 12 枚 `--t9-*` 钩子），
 *    零手抄：每枚值只引用 27 枚 HUD 令牌之一；
 *  - ③ 零泄漏（4.2）：全 CSS 的 `--dsw-*` / `--t9-*` 声明只出现在 `.dsh-cosmos-const-float`
 *    作用域；`html` / `body` / `documentElement` 零令牌声明与零 inline 写入；运行时
 *    `applySkinTokens` 只写给定元素（假 DOM 直测，诱饵 html/body 零写入）；
 *  - ④ 兜底链（4.3）：全部映射值携带现值兜底（`var(--cos-X, <改造前静态值>)` /
 *    `rgb(var(--cos-X-rgb, <基线通道>) / α)`），逐枚断言非空兜底 + 关键兜底值等于改造前观感；
 *  - ⑤ 保留清单（2.3）+ 语义化微调（3.1/3.2）：错误/录音语义色、圆角不映射；发送钮改
 *    `--cos-accent` + on-accent 前景、角标前景同改、卡片投影走 `--cos-shadow`、backdrop 中性黑。
 *
 * t9ime 源码可达（兄弟工作区 `dsh-v-t9ime/src/panel/styles.js`，或 `DSH_V_T9IME_STYLES`
 * 指定）时做真实令牌提取对账；不可达时退化为**静态契约表**对账（探索会话量化结论固化：
 * 14 枚 DSW 色彩令牌 + 12 枚 `--t9-*` 钩子），并打印跳过说明（跨仓依赖不构成失败）。
 *
 * 真机取色 / 开合 / 换肤即时生效 / 零泄漏三断言由浏览器工装验收：
 * `.dsh-v-explorer/v9-lshape-harness/verify-skin.mjs`（任务 5.1 截图同源）。
 *
 * 运行：node test/t9-skin-smoke.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { COSMOS_HUD_TOKENS, applySkinTokens } from "../src/cosmos/skin-registry.mjs";

function assert(cond, msg) {
  if (!cond) {
    console.error("t9-skin-smoke FAIL:", msg);
    process.exit(1);
  }
}
function assertEq(a, b, msg) {
  assert(a === b, `${msg}（got ${JSON.stringify(a)}, want ${JSON.stringify(b)}）`);
}
const occurrences = (text, needle) => text.split(needle).length - 1;
function slice(text, startMark, endMark, label) {
  const start = text.indexOf(startMark);
  assert(start >= 0, `锚点缺失：${label} 起点 ${JSON.stringify(startMark)}`);
  const end = text.indexOf(endMark, start + startMark.length);
  assert(end > start, `锚点缺失：${label} 终点 ${JSON.stringify(endMark)}`);
  return text.slice(start, end);
}
const stripCssComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "");

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..");
const CLIENT = join(ROOT, "src", "client.jsx");
const clientSource = readFileSync(CLIENT, "utf8");

/* 契约表（design D2 的单一事实来源；改表必须同时改本文件与 CSS 映射块）。 */
const MAPPED_DSW = Object.freeze([
  "--dsw-specific-input-major",
  "--dsw-alias-bg-base",
  "--dsw-alias-label-primary",
  "--dsw-alias-label-secondary",
  "--dsw-alias-label-tertiary",
  "--dsw-alias-label-dimmed",
  "--dsw-alias-border-l1",
  "--dsw-alias-border-l2",
  "--dsw-alias-border-l3",
  "--dsw-alias-border-inverted",
  "--dsw-alias-interactive-bg-hover",
  "--dsw-alias-button-info-fill",
  "--dsw-alias-button-info-hover",
  "--dsw-alias-brand-primary-new-colorprimary-new-color",
  "--dsw-alias-label-on-color",
  "--dsw-alias-button-contrast-fill",
  "--dsw-alias-label-primary-inverted",
  "--dsw-elevation-soft"
]);
/** t9ime `stage4-t9-theme-hook-layer` 契约的 12 枚钩子（上游未发布时映射声明惰性）。 */
const MAPPED_T9_HOOKS = Object.freeze([
  "--t9-surface-bg",
  "--t9-border-l1",
  "--t9-border-l2",
  "--t9-border-l3",
  "--t9-focus-ring",
  "--t9-accent-fill",
  "--t9-accent-fill-hover",
  "--t9-hover-bg",
  "--t9-on-accent",
  "--t9-label-primary",
  "--t9-label-secondary",
  "--t9-elevation-shadow"
]);
/** 保留表（MUST NOT 映射）：错误/录音语义色（用户裁决保留 DSH）+ 圆角形状。 */
const RESERVED_COLOR = Object.freeze([
  "--dsw-alias-state-error-primary",
  "--dsw-alias-state-business-primary"
]);
const RESERVED_SHAPE = Object.freeze(["--dsw-radius-md", "--dsw-radius-panel"]);
/** 结构/尺寸钩子（非色彩，MUST NOT 映射）：浮窗宿主覆写钩子 + t9ime 既有尺寸钩子。
    `--t9-cand-strip-h` = t9ime stage6 尺寸移交的候选条高（宿主经 `--cos-t9-cand-h` 恒高引用），
    与 `--t9-key-h` / `--t9-input-col-w` 同族——形状不随主题，覆写不换色。 */
const STRUCTURAL_HOOKS = Object.freeze([
  "--t9-input-w",
  "--t9-key-h",
  "--t9-input-col-w",
  "--t9-cand-strip-h",
  ...RESERVED_SHAPE
]);
/** 浮窗自有布局变量（`--cos-*` 命名空间里的非 HUD 令牌，非色彩）。 */
const STRUCTURAL_COS = Object.freeze(["--cos-float-body-max", "--cos-float-w", "--cos-t9-cand-h"]);
/** t9ime 现状消费的 14 枚 DSW 色彩令牌（探索会话量化结论；跨仓源码不可达时的契约基线）。 */
const T9IME_DSW_CONTRACT = Object.freeze([
  "--dsw-specific-input-major",
  "--dsw-alias-bg-base",
  "--dsw-alias-border-l1",
  "--dsw-alias-border-l2",
  "--dsw-alias-border-l3",
  "--dsw-alias-brand-primary-new-colorprimary-new-color",
  "--dsw-alias-button-info-fill",
  "--dsw-alias-button-info-hover",
  "--dsw-alias-interactive-bg-hover",
  "--dsw-alias-label-on-color",
  "--dsw-alias-label-primary",
  "--dsw-alias-label-secondary",
  "--dsw-elevation-soft"
]);

/* ── ① 作用域接线（1.1 / 1.2 / design D1） ── */
const component = slice(
  clientSource,
  "function ConstellationFloatDock(props) {",
  "\n/* ------------------------------------------------------------------ *\n * 星胚动作消费条目",
  "浮窗组件"
);
assert(
  component.includes("useSyncExternalStore(cosmosSkinStore.subscribe, cosmosSkinStore.getSnapshot)"),
  "浮窗订阅 cosmosSkinStore（同一 store = 冷启动读持久化偏好、换肤即时重下发）"
);
assert(/const floatRootRef = useRef\(null\);/.test(component), "portal 根持 ref（floatRootRef）");
assert(
  component.includes("applySkinTokens(floatRootRef.current, skinState.skin);"),
  "皮肤令牌经 applySkinTokens 下发到 portal 根（复用注册层令牌表，零手抄）"
);
assert(
  /useLayoutEffect\(\(\) => \{\s*applySkinTokens\(floatRootRef\.current, skinState\.skin\);\s*\}, \[skinState\.skin, armed\]\);/
    .test(component),
  "useLayoutEffect 依赖含 armed：闭合→打开后必须重下发（首帧同气 + 开合不漏发）"
);
assertEq(occurrences(component, "applySkinTokens("), 1, "浮窗内只经单一 applySkinTokens 写者");
assert(
  /ref=\{floatRootRef\}\s+className="dsh-cosmos-const-float"/.test(component),
  "ref 挂在 portal 根（映射与令牌同址）"
);
assertEq(
  occurrences(component, "document.body"),
  2,
  "组件对 document.body 只有两处只读用法（portal 目标 + 渲染前置守卫，零令牌写入）"
);
assert(component.includes("    document.body\n  );"), "portal 目标 = document.body（挂载链路不变）");
assert(!component.includes("document.body.style"), "组件不写 body inline style（零泄漏）");
assert(!component.includes("document.documentElement"), "组件不触碰 documentElement");
assert(!/style\.setProperty\("--(?:cos|dsw|t9)-/.test(component), "组件不手写令牌（唯一写者 = applySkinTokens）");
assertEq(occurrences(clientSource, "applySkinTokens("), 2, "全文件仅两处下发：整页根 + 浮窗 portal 根");
assert(
  clientSource.includes("applySkinTokens(frameRef.current, skinId);"),
  "整页根下发链路保持不变（作用域隔离的另一半）"
);

/* ── CSS 区域与规则索引 ── */
const floatCss = slice(
  clientSource,
  "/* ── 星座浮窗输入器",
  "/* ── 动作按钮条",
  "浮窗 CSS 区块"
);
const cssNoComments = stripCssComments(clientSource);

/** 某位置的**最内层**规则选择器（用于零泄漏作用域判定）。 */
function enclosingSelector(text, index) {
  const open = text.lastIndexOf("{", index);
  if (open < 0) return "";
  const before = text.slice(0, open);
  const boundary = Math.max(before.lastIndexOf("}"), before.lastIndexOf("{"), before.lastIndexOf(";"));
  return before.slice(boundary + 1).trim();
}
/** 规则体（选择器首次出现处的最近 `{}`；浮窗规则体内无嵌套块）。 */
function ruleBody(selector) {
  const at = floatCss.indexOf(selector + "{");
  assert(at >= 0, `CSS 缺少规则：${selector}`);
  const close = floatCss.indexOf("}", at);
  assert(close > at, `规则未闭合：${selector}`);
  return floatCss.slice(at, close + 1);
}

/* ── 映射块解析（selector 必须恰为 portal 根） ── */
const mappingMark = "/* ── 浮窗皮肤映射层";
const mappingAt = clientSource.indexOf(mappingMark);
assert(mappingAt >= 0, "映射层注释锚点缺失（design D2）");
const mappingOpen = clientSource.indexOf("{", clientSource.indexOf(".dsh-cosmos-const-float{", mappingAt));
const mappingClose = clientSource.indexOf("\n}", mappingOpen);
assert(mappingOpen > mappingAt && mappingClose > mappingOpen, "映射块边界无法定位");
const mappingSelector = stripCssComments(clientSource.slice(mappingAt, mappingOpen)).trim();
assertEq(mappingSelector, ".dsh-cosmos-const-float", "映射层作用域 = portal 根（不是 :root / html / body）");
const mappingBlock = clientSource.slice(mappingOpen + 1, mappingClose);
const mapped = new Map();
for (const match of mappingBlock.matchAll(/(--(?:dsw|t9)-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
  assert(!mapped.has(match[1]), `映射重复声明：${match[1]}`);
  mapped.set(match[1], match[2].trim());
}

/* ② 映射表逐枚对账（4.1） */
const mappedDsw = [...mapped.keys()].filter((token) => token.startsWith("--dsw-")).sort();
const mappedT9 = [...mapped.keys()].filter((token) => token.startsWith("--t9-")).sort();
assertEq(mappedDsw.join(","), MAPPED_DSW.slice().sort().join(","), "DSW 别名映射表恰为 18 枚（无多无少）");
assertEq(mappedT9.join(","), MAPPED_T9_HOOKS.slice().sort().join(","), "--t9-* 钩子映射恰为 12 枚契约钩子");
assertEq(mapped.size, MAPPED_DSW.length + MAPPED_T9_HOOKS.length, "映射总量 = 18 + 12");
for (const token of RESERVED_COLOR) assert(!mapped.has(token), `保留色彩令牌 MUST NOT 映射：${token}`);
for (const token of RESERVED_SHAPE) assert(!mapped.has(token), `形状令牌 MUST NOT 映射：${token}`);
for (const token of STRUCTURAL_HOOKS) assert(!mapped.has(token), `结构/尺寸钩子 MUST NOT 映射：${token}`);

/* 浮窗 CSS 消费面（含映射块自身的 --cos-* 引用）：色彩令牌 ⊆ 映射 ∪ 保留。
   注释里的示例写法（var(--cos-X, …)）先剥掉，避免解析口径被说明文字污染。 */
const floatCssCode = stripCssComments(floatCss);
const floatConsumed = new Set([...floatCssCode.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]));
const floatHooks = [...floatConsumed].filter((token) => /^--(?:dsw|t9)-/.test(token));
assert(floatHooks.length > 0, "浮窗 CSS 未解析出任何 DSW/t9 令牌（解析口径失效）");
for (const token of floatHooks) {
  assert(
    mapped.has(token) || RESERVED_COLOR.includes(token) || STRUCTURAL_HOOKS.includes(token),
    `浮窗消费的色彩令牌未入映射/保留表：${token}`
  );
}
for (const token of RESERVED_COLOR) {
  assert(floatConsumed.has(token), `保留色彩令牌应仍被浮窗消费（错误/录音语义色 + 角标基础底）：${token}`);
}
assert(floatConsumed.has("--t9-input-w"), "宿主覆写钩子 --t9-input-w 仍是单级消费（不被映射覆盖）");
const floatCos = [...floatConsumed].filter((token) => token.startsWith("--cos-"));
for (const token of floatCos) {
  assert(
    COSMOS_HUD_TOKENS.includes(token) || STRUCTURAL_COS.includes(token),
    `浮窗消费的 --cos-* 令牌不在注册层 HUD 令牌表：${token}`
  );
}

/* t9ime（新旧两版样式）消费面：源码可达 → 真实提取；不可达 → 静态契约表。
   抽取口径 = **`var(--…)` 消费**（注释散文里的示例写法/令牌名清单不算消费点）；
   新版 t9ime 已接 `--t9-*` 钩子链（`var(--t9-x, var(--dsw-y, fallback))`）→ 两枚都落在
   `var(` 之后，同一口径全覆盖；旧版只有 DSW 单级 → 同样被覆盖。 */
const t9imeStylesPath = process.env.DSH_V_T9IME_STYLES
  || resolve(ROOT, "..", "dsh-v-t9ime", "src", "panel", "styles.js");

async function readT9imeConsumedTokens(path) {
  let css = null;
  try {
    const mod = await import(pathToFileURL(path).href);
    if (typeof mod.PANEL_CSS === "string") css = mod.PANEL_CSS;
  } catch {
    /* 非模块 / 无 PANEL_CSS 导出 → 退化为文本抽取（下面按 var( 口径同样安全） */
  }
  if (css === null) {
    const text = readFileSync(path, "utf8");
    const literal = text.match(/PANEL_CSS\s*=\s*`([\s\S]*?)`\s*;/);
    css = literal !== null ? literal[1] : text;
  }
  const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return new Set([...code.matchAll(/var\((--(?:dsw|t9)[a-z0-9-]+)/g)].map((match) => match[1]));
}

let t9imeChecked = false;
if (existsSync(t9imeStylesPath)) {
  const t9imeTokens = await readT9imeConsumedTokens(t9imeStylesPath);
  const t9imeColor = [...t9imeTokens].filter((token) => !STRUCTURAL_HOOKS.includes(token));
  assert(t9imeColor.length >= T9IME_DSW_CONTRACT.length, "t9ime 色彩令牌提取量低于契约基线（解析口径失效）");
  for (const token of t9imeColor) {
    assert(
      mapped.has(token) || RESERVED_COLOR.includes(token),
      `t9ime 消费的色彩令牌未入映射/保留表（宿主侧遗漏）：${token}`
    );
  }
  /* 新版钩子链的可达性证据：上游若已接钩子，必须逐枚有映射（否则宿主侧精修层留空）。 */
  const consumedHooks = [...t9imeTokens].filter((token) => token.startsWith("--t9-")
    && !STRUCTURAL_HOOKS.includes(token));
  for (const hook of consumedHooks) assert(mapped.has(hook), `t9ime 已接钩子但宿主未映射：${hook}`);
  console.log(`t9-skin-smoke: t9ime 源码可达（消费 ${t9imeColor.length} 枚色彩令牌，其中钩子 ${consumedHooks.length} 枚）`);
  t9imeChecked = true;
} else {
  console.log("t9-skin-smoke: t9ime 源码不可达（" + t9imeStylesPath + "）→ 退化为静态契约表对账");
}
for (const token of T9IME_DSW_CONTRACT) {
  assert(
    mapped.has(token) || RESERVED_COLOR.includes(token),
    `t9ime 契约令牌未入映射/保留表：${token}`
  );
}
/* 新版 t9ime 钩子契约（stage4）无论上游是否已发布都必须在映射表内——发布即生效，零改动。 */
for (const hook of MAPPED_T9_HOOKS) assert(mapped.has(hook), `钩子契约缺失：${hook}`);
assert(!MAPPED_T9_HOOKS.some((hook) => RESERVED_COLOR.includes(hook) || STRUCTURAL_HOOKS.includes(hook)),
  "钩子契约与保留/结构表不相交");
console.log("t9-skin-smoke: ① 映射对账通过（浮窗 + t9ime" + (t9imeChecked ? " 真实源码" : " 契约表") + "）");

/* ③ 零泄漏（4.2）：全 CSS 的 DSW/t9 声明只作用于 portal 根 ── */
const declaringTokens = [...cssNoComments.matchAll(/(--(?:dsw|t9)-[a-z0-9-]+)\s*:/g)];
assertEq(declaringTokens.length, mapped.size, "全 CSS 的 DSW/t9 声明数 = 映射表枚数（无第二处声明）");
for (const match of declaringTokens) {
  const selector = enclosingSelector(cssNoComments, match.index);
  assert(
    selector.includes(".dsh-cosmos-const-float"),
    `DSW/t9 令牌声明越界（作用域必须是 portal 根）：${match[1]} @ ${JSON.stringify(selector)}`
  );
  assert(
    !/^(?::root|html|body|\*)$/.test(selector),
    `DSW/t9 令牌 MUST NOT 落在全局选择器：${selector}`
  );
}
const cosDeclarations = [...cssNoComments.matchAll(/(--cos-[a-z0-9-]+)\s*:/g)];
for (const match of cosDeclarations) {
  const selector = enclosingSelector(cssNoComments, match.index);
  assert(
    !/^(?::root|html|body|\*)$/.test(selector),
    `皮肤令牌 MUST NOT 在全局选择器上声明：${match[1]} @ ${selector}`
  );
}
assert(!clientSource.includes("documentElement.style"), "源码零 documentElement inline 写入");
assert(!clientSource.includes("document.body.style"), "源码零 body inline 写入");

/* 运行时：唯一写者只写给定元素（诱饵 html/body 零写入） */
function fakeElement(label) {
  const writes = [];
  return {
    label,
    writes,
    style: { setProperty(name, value) { writes.push([name, value]); } },
    dataset: {}
  };
}
{
  const portalRoot = fakeElement("portal-root");
  const decoyBody = fakeElement("body");
  const decoyHtml = fakeElement("documentElement");
  const previousDocument = globalThis.document;
  globalThis.document = { body: decoyBody, documentElement: decoyHtml };
  let ok = false;
  try {
    ok = applySkinTokens(portalRoot, "deepspace");
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
  assert(ok === true, "applySkinTokens(portalRoot, deepspace) 下发成功");
  assertEq(portalRoot.writes.length, COSMOS_HUD_TOKENS.length, "下发恰好 27 枚 HUD 令牌");
  assert(portalRoot.writes.every(([name]) => COSMOS_HUD_TOKENS.includes(name)), "下发面 ⊆ 注册层令牌表");
  assert(portalRoot.writes.every(([name]) => !/^--(?:dsw|t9)-/.test(name)), "JS 零 DSH/t9 令牌写入（映射全在 CSS）");
  assertEq(portalRoot.dataset.cosMode, "dark", "data-cos-mode 同址下发");
  assertEq(decoyBody.writes.length, 0, "诱饵 body 零写入（零泄漏）");
  assertEq(decoyHtml.writes.length, 0, "诱饵 documentElement 零写入（零泄漏）");
  assertEq(applySkinTokens(portalRoot, "no-such-skin"), false, "非法皮肤回落 false（不抛错、不写色）");
  assertEq(portalRoot.writes.length, COSMOS_HUD_TOKENS.length, "非法皮肤零新增写入");
}
console.log("t9-skin-smoke: ② 零泄漏作用域通过");

/* ④ 兜底链（4.3）：每枚映射值携带现值兜底 + 只引用 HUD 令牌 ── */
const FALLBACK_SPOT = Object.freeze({
  "--dsw-specific-input-major": "rgba(10,10,20,.9)",
  "--dsw-alias-bg-base": "rgba(8,8,16,.96)",
  "--dsw-alias-label-primary": "#ffe9cf",
  "--dsw-alias-label-secondary": "#ffe3b8",
  "--dsw-alias-label-tertiary": "#cbb89a",
  "--dsw-alias-label-primary-inverted": "#151515",
  "--dsw-alias-interactive-bg-hover": "rgb(255 210 140 / .12)",
  "--dsw-alias-button-contrast-fill": "rgb(255 255 255 / .85)",
  "--t9-on-accent": "#ffffff"
});
/** 解析映射值里的 `var(--cos-X, <兜底>)`（括号感知：兜底本身可能是 `rgba(...)`）。 */
function parseCosVar(value) {
  const at = value.indexOf("var(--cos-");
  if (at < 0) return null;
  const openParen = at + 3;
  let depth = 0;
  let commaAt = -1;
  let endAt = -1;
  for (let i = openParen; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) { endAt = i; break; }
    } else if (ch === "," && depth === 1 && commaAt < 0) commaAt = i;
  }
  if (endAt < 0 || commaAt < 0) return null;
  return { name: value.slice(openParen + 1, commaAt).trim(), fallback: value.slice(commaAt + 1, endAt).trim() };
}

for (const [token, value] of mapped) {
  const parsed = parseCosVar(value);
  assert(parsed !== null, `映射值必须形如 var(--cos-X, <现值兜底>)：${token} = ${value}`);
  assert(
    COSMOS_HUD_TOKENS.includes(parsed.name),
    `映射来源必须是注册层 HUD 令牌（零新增令牌/零手抄）：${token} ← ${parsed.name}`
  );
  assert(parsed.fallback.length > 0, `映射兜底 MUST NOT 为空（无无色中间态）：${token}`);
  const expected = FALLBACK_SPOT[token];
  if (expected !== undefined) assertEq(parsed.fallback, expected, `现值兜底对齐改造前观感：${token}`);
}
console.log("t9-skin-smoke: ③ 兜底链通过");

/* ⑤ 保留清单 + 浮窗自有语义化微调（2.3 / 3.1 / 3.2） ── */
const sendRule = ruleBody(".dsh-cosmos-const-float-send");
assert(sendRule.includes("background:var(--cos-accent,#c8963e)"), "发送钮底色改皮肤主色 --cos-accent（兜底 = 原暖金）");
assert(sendRule.includes("color:var(--dsw-alias-label-on-color,#fff)"), "发送钮前景走 on-accent 映射");
assert(!sendRule.includes("state-business-primary"), "发送钮不再消费 business-primary（入保留清单）");

const badgeRule = ruleBody(".dsh-cosmos-const-float-thumb-badge");
assert(badgeRule.includes("color:var(--dsw-alias-label-on-color,#fff)"), "缩略图角标前景改语义 on-accent 色");
assert(badgeRule.includes("background:var(--dsw-alias-state-business-primary,#c8963e)"),
  "角标基础底保留官方 business-primary（保留清单；两态覆盖不可见）");

const removeRule = ruleBody(".dsh-cosmos-const-float-thumb-remove");
assert(removeRule.includes("color:var(--dsw-alias-label-primary-inverted,#151515)"), "移除钮前景经映射随皮肤（on-contrast）");
assert(removeRule.includes("background:var(--dsw-alias-button-contrast-fill,rgb(255 255 255 / .85))"),
  "移除钮对比底经映射改面板语义色");

const cardRule = ruleBody(".dsh-cosmos-const-float-card");
assert(cardRule.includes("box-shadow:var(--cos-shadow,0 18px 48px rgba(0,0,0,.45))"),
  "卡片投影走 --cos-shadow 分支（dark none / light 投影）");
assert(!cardRule.includes("box-shadow:0 18px 48px"), "卡片投影 MUST NOT 硬编码（皮肤分支可切换）");

const backdropRule = ruleBody(".dsh-cosmos-const-float-backdrop");
assert(backdropRule.includes("background:rgba(4,5,12,.55)"), "backdrop 保持中性黑（遮罩非皮肤语义）");
assert(
  floatCss.includes(".dsh-cosmos-const-float[data-cos-mode=light] .dsh-cosmos-const-float-backdrop"),
  "light 皮肤分支降 backdrop α（实施期微调项已落地）"
);

const voiceRule = ruleBody(".dsh-cosmos-const-float-voice[data-state=recording]");
assert(voiceRule.includes("border-color:var(--dsw-alias-state-error-primary,#ff9f9f)"),
  "录音态保留官方 state-error 语义色（用户裁决）");
const uploadRule = ruleBody(".dsh-cosmos-const-float-thumb-badge[data-state=uploading]");
assert(uploadRule.includes("border-top-color:var(--dsw-alias-label-primary,#fff)"),
  "上传转圈环经 label-primary 映射自动随皮肤（无需单独改色）");

console.log("t9-skin-smoke: ④ 保留清单与语义化微调通过");
console.log("t9-skin-smoke: all assertions passed");
