/**
 * Cosmos 页面设置纯逻辑（真机反馈：WASD 平移速度可配置化；add-cosmos-skin-themes 3.3：
 * 皮肤偏好并入同一存储面，版本 v1 → v2；add-cosmos-zoom-focus-nav 1.3：缩放导航三键
 * 并入同一存储面，版本 v2 → v3；add-cosmos-session-list-panel 3.3：会话面板展开态
 * 版本 v3 → v4；add-cosmos-native-composer 1.1：星座动作「发送前编辑」呈现分支
 * 版本 v4 → v5；add-cosmos-drag-pan-toggle 1.1：右下角「拖拽平移」开关布尔键
 * 版本 v5 → v6；add-cosmos-layout-tuning 1.1：界面尺寸 12 键（面板 / 按钮 / 动作条 /
 * 搜索框 / 星座标题字号）版本 v6 → v7）。
 *
 * 独立模块——client.jsx 消费（store 装载/引擎注入）、test/engine-smoke.mjs /
 * test/settings-panel-smoke.mjs 冒烟直测。
 * 零依赖（仅形态依赖皮肤注册表的 **id 枚举**，不触碰 DOM）：localStorage 读写带守卫
 * （Node/隐私模式缺席 → 缺省），键 `dsh-v-cosmos:settings`（旧名 `dsh-cosmos:settings`
 * 存量读取回落迁移，写入恒走新键）。
 *
 * 设置面（version 9，add-cosmos-standalone-window 1.1 引入 `launchMode` v8 → v9；
 * v8 = add-cosmos-shortcuts 2.1 的 `shortcuts` 子对象，版本号只进不退）：
 *  - panSpeed：WASD 基础平移速度（世界单位/秒），缺省 120；
 *  - panShiftBoost：Shift 加速倍率，缺省 3；
 *  - skin：内置皮肤 id（枚举 = `COSMOS_SKIN_IDS`），缺省 `rosepine`（design D2）；
 *  - zoomDiveRatio：银河态缩放进入阈值的参考尺寸百分比（界 60–140），缺省 100；
 *  - zoomFlyOutRatio：钻取态缩放返回阈值的屏幕短边百分比（界 10–50），缺省 25；
 *  - zoomPointerFocus：缩放以指针为焦点（布尔），缺省 true；
 *  - sessionPanelOpen：左缘会话列表面板展开态（布尔，布局偏好），缺省 true
 *    （add-cosmos-session-list-panel 3.3：与皮肤/导航同级持久化，**非**会话态——
 *    对照搜索查询的「关页重置」明文约束，本键跨页开合保持）；
 *  - constPreflight：星座动作未勾选 `autoSend` 时的「发送前编辑」呈现分支
 *    （枚举 `COSMOS_PREFLIGHT_MODES`：`float` = 浮窗输入器（增强：模型选择/语音转写），
 *    整页保持 / `native` = 关页跳转会话页由原生 composer 承载），缺省 `float`
 *    （rework：星空保持优先——用户裁决；曾试验的「浮动原生窗口」经宿主槽位核查为
 *    结构性死锁后拆除，native 语义归位「关页跳转」。执行器每次 run 现读，保存即时生效）；
 *  - dragPan：右下角「拖拽平移」开关（布尔，导航偏好），缺省 **false**——关闭时鼠标
 *    拖拽 = 旋转视角（现状），开启时鼠标/笔尖拖拽 = 平移相机 target（触屏语义不受影响；
 *    add-cosmos-drag-pan-toggle D4）。与 `zoomPointerFocus` 同构的布尔键净房；开关本体
 *    （引擎内按钮）即设置入口，不另设设置页控件（对照 `sessionPanelOpen` 先例）；
 *  - 界面尺寸 12 键（add-cosmos-layout-tuning D2；缺省 = 引入配置面之前的现值，
 *    默认渲染零变化）：`sessionPanelWidth` / `sessionPanelHeight`（会话列表面板宽 /
 *    高度上限，**0 = 自适应页面**）、`constPanelWidth` / `constPanelHeight`（星座面板
 *    同款）、`addBtnSize`（左下新增按钮边长）、`hudBtnSize`（右下 HUD 按钮边长：
 *    回到银河 + 拖拽平移共用）、`actionBtnWidth` / `actionBtnHeight`（动作条按钮宽 /
 *    高）、`constActionHeight`（星座动作按钮高；宽恒等于面板内容宽）、`searchWidth` /
 *    `searchHeight`（顶部中央搜索框宽 / 最小高度，0 = 自适应）、`wsTitleSize`（顶部
 *    中央星座标题字号）。整页经 `cosmosLayoutTokensOf` 投影为 CSS 变量下发。
 *  - shortcuts：全局快捷键四键（add-cosmos-shortcuts 2.1；`{ closePage, goHome,
 *    togglePan, voiceToggle }`，缺省 `Escape` / `Backquote` / `KeyM` / `Ctrl+KeyQ`）。
 *    净房口径 = `shortcutsOf`（键位池校验回落缺省 + 读面固定优先序冲突回落，恒无重复），
 *    纯逻辑在 `shortcuts.mjs`；v7 及更早载荷读出补默认（零迁移）。
 *  - launchMode：Cosmos 入口打开方式（add-cosmos-standalone-window 1.1/D4）——
 *    枚举 `COSMOS_LAUNCH_MODES`：`embedded`（缺省，现状：shell.overlay 内嵌整页）/
 *    `window`（同源独立窗口，语义见 src/standalone.mjs）。净房 = 枚举校验回落缺省；
 *    v8 及更早载荷读出补缺省（零迁移，渲染零变化）。桌面形态（非 http(s) 协议）的降级判定
 *    不落在设置面（持久值照存，读取侧按协议分流，见 standalone.mjs）。
 * 后续设置 UI 直接调 `saveCosmosSettings`（写侧净房内置），引擎经 `engine.setTuning` /
 * `engine.setShortcuts` / `engine.setSkin` 热更新（无需重开整页）。
 */

import { COSMOS_DEFAULT_SKIN, COSMOS_SKIN_IDS } from "./cosmos/skin-registry.mjs";
import { SHORTCUT_DEFAULTS, shortcutsOf } from "./shortcuts.mjs";

const SETTINGS_KEY = "dsh-v-cosmos:settings";
/** 品牌更名前的 localStorage 键（仅读取回落，SHALL NOT 写入）。 */
const LEGACY_SETTINGS_KEY = "dsh-cosmos:settings";
export const COSMOS_SETTINGS_KEY = SETTINGS_KEY;
/** 设置面版本（v9 = add-cosmos-standalone-window 新增 `launchMode`；v8 = 快捷键子对象；
    v1–v8 载荷读出补默认）。 */
export const COSMOS_SETTINGS_VERSION = 9;

/**
 * Cosmos 入口打开方式枚举（add-cosmos-standalone-window D4）：
 *  - `embedded`（缺省）：shell.overlay 内嵌整页（现状，渲染零变化）；
 *  - `window`：同源独立窗口（`window.open(origin + "/?cosmos=window")`）。
 */
export const COSMOS_LAUNCH_MODES = Object.freeze(["embedded", "window"]);
/** 该键的缺省值（净房与入口分流同源；默认保持现状 = 内嵌）。 */
export const COSMOS_DEFAULT_LAUNCH_MODE = "embedded";

/**
 * 「发送前编辑」呈现分支枚举（add-cosmos-native-composer D1/D5；rework 语义重注）：
 *  - `float`（缺省）：浮窗输入器（增强：模型选择/语音转写），Cosmos 整页保持打开；
 *  - `native`：关页跳转会话页，由原生 composer 承载补写与发送。
 */
export const COSMOS_PREFLIGHT_MODES = Object.freeze(["native", "float"]);
/** 该键的缺省值（净房与执行器兜底同源；星空保持优先——用户裁决）。 */
export const COSMOS_DEFAULT_PREFLIGHT = "float";

/** 出厂默认（「暂时先用现在的默认值」——调参只动这里或用户配置，SHALL NOT 散落硬编码）。 */
export const COSMOS_SETTINGS_DEFAULTS = Object.freeze({
  panSpeed: 120,
  panShiftBoost: 3,
  skin: COSMOS_DEFAULT_SKIN,
  zoomDiveRatio: 100,
  zoomFlyOutRatio: 25,
  zoomPointerFocus: true,
  sessionPanelOpen: true,
  constPreflight: COSMOS_DEFAULT_PREFLIGHT,
  /* 拖拽平移开关（add-cosmos-drag-pan-toggle D4）：缺省关闭 ⇒ 鼠标拖拽保持旋转语义
     （「默认关闭」为 spec 明文；开启后鼠标/笔尖拖拽改为平移相机 target）。 */
  dragPan: false,
  /* ── 界面尺寸（add-cosmos-layout-tuning 1.1/D2）：缺省 = 引入配置面之前的现值 ⇒
     默认渲染零变化；高度类键 `0` = 自适应页面高度（>0 = 高度上限，max-height 语义）。 ── */
  sessionPanelWidth: 260,
  sessionPanelHeight: 0,
  constPanelWidth: 187,
  constPanelHeight: 0,
  addBtnSize: 44,
  hudBtnSize: 44,
  actionBtnWidth: 112,
  actionBtnHeight: 40,
  constActionHeight: 40,
  searchWidth: 320,
  searchHeight: 0,
  wsTitleSize: 13,
  /* ── 全局快捷键四键（add-cosmos-shortcuts 2.1/D11）：缺省遵用户裁决
     `closePage=Escape` / `goHome=Backquote` / `togglePan=KeyM` / `voiceToggle=Ctrl+KeyQ`；
     净房走 `shortcutsOf`（池校验 + 读面冲突固定优先序回落），子对象冻结防误改。 ── */
  shortcuts: Object.freeze({ ...SHORTCUT_DEFAULTS }),
  /* ── 入口打开方式（add-cosmos-standalone-window 1.1/D4）：缺省 embedded = 现状
     （内嵌整页，渲染零变化）；`window` = 同源独立窗口（仅 web 形态可用）。 ── */
  launchMode: COSMOS_DEFAULT_LAUNCH_MODE
});

/** 界（写侧 400 的前置净房界；越界值落回界内端点，SHALL NOT 抛错）。
    保持纯数值 `[min,max]` 形状——枚举界（skin）以 `COSMOS_SKIN_IDS` 表达、布尔键
    （zoomPointerFocus / sessionPanelOpen / dragPan）以独立净化分支表达，不混入本表。
    界面尺寸键全部为数值界（含高度类 `0` 端点 = 自适应）。 */
export const COSMOS_SETTINGS_BOUNDS = Object.freeze({
  panSpeed: [20, 600],
  panShiftBoost: [1, 10],
  zoomDiveRatio: [60, 140],
  zoomFlyOutRatio: [10, 50],
  sessionPanelWidth: [200, 420],
  sessionPanelHeight: [0, 2000],
  constPanelWidth: [140, 360],
  constPanelHeight: [0, 2000],
  addBtnSize: [40, 64],
  hudBtnSize: [40, 72],
  actionBtnWidth: [80, 200],
  actionBtnHeight: [40, 72],
  constActionHeight: [40, 72],
  searchWidth: [180, 640],
  searchHeight: [0, 64],
  wsTitleSize: [10, 24]
});

function clampTo(key, value, fallback) {
  /* 非数值形态（null / 空串 / 布尔 / 对象 / 数组）一律按非法落默认——MUST NOT 依赖
     `Number(null)===0` 之类的隐式强转把非法值夹到界内端点（spec「非法持久值净化」）。 */
  if (
    value === null || value === undefined ||
    (typeof value === "string" && value.trim() === "") ||
    (typeof value !== "number" && typeof value !== "string")
  ) {
    return fallback;
  }
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  const [min, max] = COSMOS_SETTINGS_BOUNDS[key];
  return Math.min(max, Math.max(min, n));
}

/**
 * 皮肤枚举净房：注册表外 id / 非字符串 / 缺省 → 回落默认皮肤（SHALL NOT 抛错，
 * 与数值「越界落界内」纪律同构）。
 * @param {unknown} value
 * @returns {string}
 */
function skinOf(value) {
  return typeof value === "string" && COSMOS_SKIN_IDS.includes(value)
    ? value
    : COSMOS_DEFAULT_SKIN;
}

/**
 * 布尔键净房（zoomPointerFocus / sessionPanelOpen / dragPan）：`typeof === "boolean"` 之外
 * 一律回落该键的出厂默认（独立净化分支，与 skin 枚举分支同构，SHALL NOT 抛错）。
 * @param {unknown} value
 * @param {boolean} fallback 该键的出厂默认
 * @returns {boolean}
 */
function boolOf(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * 「发送前编辑」呈现分支净房（add-cosmos-native-composer 1.1）：枚举外值（含缺失、
 * 非字符串、未知 id）一律回落缺省 `native`，与 `skinOf` 枚举分支同构，SHALL NOT 抛错。
 * @param {unknown} value
 * @returns {"native"|"float"}
 */
function preflightOf(value) {
  return typeof value === "string" && COSMOS_PREFLIGHT_MODES.includes(value)
    ? value
    : COSMOS_DEFAULT_PREFLIGHT;
}

/**
 * 入口打开方式净房（add-cosmos-standalone-window 1.1）：枚举外值（含缺失、非字符串、
 * 未知 id）一律回落缺省 `embedded`，与 `skinOf` / `preflightOf` 枚举分支同构，SHALL NOT 抛错。
 * @param {unknown} value
 * @returns {"embedded"|"window"}
 */
function launchModeOf(value) {
  return typeof value === "string" && COSMOS_LAUNCH_MODES.includes(value)
    ? value
    : COSMOS_DEFAULT_LAUNCH_MODE;
}

/**
 * 设置净房（纯函数）：未知键剥离、非法/越界值落回缺省或界内端点。
 * @param {unknown} raw 原始设置对象（v1 载荷无 `skin` 键、v2 载荷无缩放导航三键、
 *        v3 载荷无会话面板展开态、v4 载荷无 `constPreflight`、v5 载荷无 `dragPan`、
 *        v6 载荷无界面尺寸 12 键、v7 载荷无 `shortcuts` 子对象、v8 载荷无 `launchMode` →
 *        逐键补默认）
 * @returns {{ panSpeed: number, panShiftBoost: number, skin: string, zoomDiveRatio: number, zoomFlyOutRatio: number, zoomPointerFocus: boolean, sessionPanelOpen: boolean, constPreflight: "native"|"float", dragPan: boolean, sessionPanelWidth: number, sessionPanelHeight: number, constPanelWidth: number, constPanelHeight: number, addBtnSize: number, hudBtnSize: number, actionBtnWidth: number, actionBtnHeight: number, constActionHeight: number, searchWidth: number, searchHeight: number, wsTitleSize: number, shortcuts: {closePage: string, goHome: string, togglePan: string, voiceToggle: string}, launchMode: "embedded"|"window" }}
 */
export function sanitizeCosmosSettings(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    panSpeed: clampTo("panSpeed", source.panSpeed, COSMOS_SETTINGS_DEFAULTS.panSpeed),
    panShiftBoost: clampTo("panShiftBoost", source.panShiftBoost, COSMOS_SETTINGS_DEFAULTS.panShiftBoost),
    skin: skinOf(source.skin),
    zoomDiveRatio: clampTo("zoomDiveRatio", source.zoomDiveRatio, COSMOS_SETTINGS_DEFAULTS.zoomDiveRatio),
    zoomFlyOutRatio: clampTo("zoomFlyOutRatio", source.zoomFlyOutRatio, COSMOS_SETTINGS_DEFAULTS.zoomFlyOutRatio),
    zoomPointerFocus: boolOf(source.zoomPointerFocus, COSMOS_SETTINGS_DEFAULTS.zoomPointerFocus),
    sessionPanelOpen: boolOf(source.sessionPanelOpen, COSMOS_SETTINGS_DEFAULTS.sessionPanelOpen),
    constPreflight: preflightOf(source.constPreflight),
    /* 拖拽平移开关（add-cosmos-drag-pan-toggle 1.1/D4）：布尔键同构净房——字符串 "on" /
       数字 1 等手工坏值一律回落缺省 false（SHALL NOT 抛错）。 */
    dragPan: boolOf(source.dragPan, COSMOS_SETTINGS_DEFAULTS.dragPan),
    /* 界面尺寸（add-cosmos-layout-tuning 1.1/D2）：逐键数值界净房（越界落端点、非数字
       回落缺省）；高度类键 0 为合法值（= 自适应），MUST NOT 被 falsy 判定吞掉。 */
    sessionPanelWidth: clampTo("sessionPanelWidth", source.sessionPanelWidth, COSMOS_SETTINGS_DEFAULTS.sessionPanelWidth),
    sessionPanelHeight: clampTo("sessionPanelHeight", source.sessionPanelHeight, COSMOS_SETTINGS_DEFAULTS.sessionPanelHeight),
    constPanelWidth: clampTo("constPanelWidth", source.constPanelWidth, COSMOS_SETTINGS_DEFAULTS.constPanelWidth),
    constPanelHeight: clampTo("constPanelHeight", source.constPanelHeight, COSMOS_SETTINGS_DEFAULTS.constPanelHeight),
    addBtnSize: clampTo("addBtnSize", source.addBtnSize, COSMOS_SETTINGS_DEFAULTS.addBtnSize),
    hudBtnSize: clampTo("hudBtnSize", source.hudBtnSize, COSMOS_SETTINGS_DEFAULTS.hudBtnSize),
    actionBtnWidth: clampTo("actionBtnWidth", source.actionBtnWidth, COSMOS_SETTINGS_DEFAULTS.actionBtnWidth),
    actionBtnHeight: clampTo("actionBtnHeight", source.actionBtnHeight, COSMOS_SETTINGS_DEFAULTS.actionBtnHeight),
    constActionHeight: clampTo("constActionHeight", source.constActionHeight, COSMOS_SETTINGS_DEFAULTS.constActionHeight),
    searchWidth: clampTo("searchWidth", source.searchWidth, COSMOS_SETTINGS_DEFAULTS.searchWidth),
    searchHeight: clampTo("searchHeight", source.searchHeight, COSMOS_SETTINGS_DEFAULTS.searchHeight),
    wsTitleSize: clampTo("wsTitleSize", source.wsTitleSize, COSMOS_SETTINGS_DEFAULTS.wsTitleSize),
    /* 全局快捷键（add-cosmos-shortcuts 2.1/D11）：子对象净房走 `shortcutsOf`——池外值 /
       非字符串 / 空串逐键回落缺省，读面冲突按固定优先序回落（返回表恒无重复）；v7 及更早
       载荷（无该子对象）补默认，旧配置零迁移。 */
    shortcuts: shortcutsOf(source.shortcuts),
    /* 入口打开方式（add-cosmos-standalone-window 1.1/D4）：枚举净房；v8 及更早载荷
       （无该键）补缺省 `embedded`，默认行为与渲染零变化。 */
    launchMode: launchModeOf(source.launchMode)
  };
}

/**
 * `storage` 事件 → 设置投影（add-cosmos-standalone-window 2.1；跨窗口即时生效的纯函数面）。
 *
 * 同源 localStorage 是全部窗口共享的唯一设置面：窗口 A 的「通用」页签写入后，窗口 B
 * 收到 `storage` 事件——本函数只负责「是否与本设置面相关 + 净房后的完整设置」，
 * 监听绑定/store 同步留在 client.jsx。与本面无关的键（官方设置、其它插件）→ `null`。
 * `newValue === null`（clear）与坏 JSON 一律按「净房空载荷」= 出厂缺省（与读面同语义）。
 * @param {{key?: unknown, newValue?: unknown}|null|undefined} event StorageEvent 形状子集
 * @returns {object|null} 净房后的完整设置；null = 与本设置面无关
 */
export function settingsFromStorageEvent(event) {
  if (event === null || typeof event !== "object") return null;
  const key = event.key;
  if (key !== SETTINGS_KEY && key !== LEGACY_SETTINGS_KEY) return null;
  let raw = {};
  if (typeof event.newValue === "string" && event.newValue) {
    try {
      raw = JSON.parse(event.newValue);
    } catch {
      raw = {};
    }
  }
  return sanitizeCosmosSettings(raw);
}

/**
 * 布局令牌投影（add-cosmos-layout-tuning 1.2/D1，纯函数）：设置面 → 整页根容器的
 * CSS 自定义属性表。缺省/非法一律回落现值字面量（与 CSS `var(--x, 现值)` 双保险，
 * 令牌层不再引入第二套默认值语义）；高度类键 `0` = 自适应 →
 * 面板 `max-height` 用 `none`、搜索框 `min-height` 用 `0px`。
 * @param {object} [settings] 净房后的完整设置（缺键亦可：逐键回落现值）
 * @returns {Record<string, string>} CSS 变量名 → 值（全部为字符串）
 */
export function cosmosLayoutTokensOf(settings) {
  const px = function (key, fallback) {
    const n = Number(settings?.[key]);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) + "px" : fallback;
  };
  /** 高度上限语义：>0 → `Npx`；其余（含 0 / 非法）→ `none`（不设上限 = 现状自适应填充）。 */
  const cap = function (key) {
    const n = Number(settings?.[key]);
    return Number.isFinite(n) && n > 0 ? Math.round(n) + "px" : "none";
  };
  return {
    "--cos-session-w": px("sessionPanelWidth", "260px"),
    "--cos-session-h": cap("sessionPanelHeight"),
    "--cos-const-panel-w": px("constPanelWidth", "187px"),
    "--cos-const-panel-h": cap("constPanelHeight"),
    "--cos-add-btn-size": px("addBtnSize", "44px"),
    "--cos-hud-btn-size": px("hudBtnSize", "44px"),
    "--cos-action-btn-w": px("actionBtnWidth", "112px"),
    "--cos-action-btn-h": px("actionBtnHeight", "40px"),
    "--cos-const-action-h": px("constActionHeight", "40px"),
    "--cos-search-w": px("searchWidth", "320px"),
    "--cos-search-h": px("searchHeight", "0px"),
    "--cos-ws-title-size": px("wsTitleSize", "13px")
  };
}

function readLocal() {
  try {
    let raw = localStorage?.getItem(SETTINGS_KEY);
    if (raw === null || raw === undefined) {
      // 旧名键回落（更名迁移；下次 saveCosmosSettings 落新键）
      raw = localStorage?.getItem(LEGACY_SETTINGS_KEY);
    }
    if (raw === null || raw === undefined) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeLocal(value) {
  try {
    localStorage?.setItem(SETTINGS_KEY, JSON.stringify(value));
  } catch {
    /* 隐私模式等写不进就算了（本次会话内设置仍生效） */
  }
}

/** 读当前设置（localStorage 缺席/损坏 → 出厂默认）。 */
export function loadCosmosSettings() {
  return sanitizeCosmosSettings(readLocal());
}

/** 合并写入（部分写语义：patch 只覆盖给出的键；净房后落盘）。 */
export function saveCosmosSettings(patch) {
  const merged = sanitizeCosmosSettings({ ...loadCosmosSettings(), ...(patch && typeof patch === "object" ? patch : {}) });
  writeLocal(merged);
  return merged;
}
