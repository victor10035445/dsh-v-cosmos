/**
 * Cosmos 页面设置纯逻辑（真机反馈：WASD 平移速度可配置化；add-cosmos-skin-themes 3.3：
 * 皮肤偏好并入同一存储面，版本 v1 → v2；add-cosmos-zoom-focus-nav 1.3：缩放导航三键
 * 并入同一存储面，版本 v2 → v3；add-cosmos-session-list-panel 3.3：会话面板展开态
 * 版本 v3 → v4；add-cosmos-native-composer 1.1：星座动作「发送前编辑」呈现分支
 * 版本 v4 → v5）。
 *
 * 独立模块——client.jsx 消费（store 装载/引擎注入）、test/engine-smoke.mjs /
 * test/settings-panel-smoke.mjs 冒烟直测。
 * 零依赖（仅形态依赖皮肤注册表的 **id 枚举**，不触碰 DOM）：localStorage 读写带守卫
 * （Node/隐私模式缺席 → 缺省），键 `dsh-v-cosmos:settings`（旧名 `dsh-cosmos:settings`
 * 存量读取回落迁移，写入恒走新键）。
 *
 * 设置面（version 5）：
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
 *    结构性死锁后拆除，native 语义归位「关页跳转」。执行器每次 run 现读，保存即时生效）。
 * 后续设置 UI 直接调 `saveCosmosSettings`（写侧净房内置），引擎经 `engine.setTuning` /
 * `engine.setSkin` 热更新（无需重开整页）。
 */

import { COSMOS_DEFAULT_SKIN, COSMOS_SKIN_IDS } from "./cosmos/skin-registry.mjs";

const SETTINGS_KEY = "dsh-v-cosmos:settings";
/** 品牌更名前的 localStorage 键（仅读取回落，SHALL NOT 写入）。 */
const LEGACY_SETTINGS_KEY = "dsh-cosmos:settings";
export const COSMOS_SETTINGS_KEY = SETTINGS_KEY;
/** 设置面版本（v5 = add-cosmos-native-composer 新增星座动作发送前编辑分支；v1–v4 载荷读出补默认）。 */
export const COSMOS_SETTINGS_VERSION = 5;

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
  constPreflight: COSMOS_DEFAULT_PREFLIGHT
});

/** 界（写侧 400 的前置净房界；越界值落回界内端点，SHALL NOT 抛错）。
    保持纯数值 `[min,max]` 形状——枚举界（skin）以 `COSMOS_SKIN_IDS` 表达、布尔键
    （zoomPointerFocus / sessionPanelOpen）以独立净化分支表达，不混入本表。 */
export const COSMOS_SETTINGS_BOUNDS = Object.freeze({
  panSpeed: [20, 600],
  panShiftBoost: [1, 10],
  zoomDiveRatio: [60, 140],
  zoomFlyOutRatio: [10, 50]
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
 * 布尔键净房（zoomPointerFocus / sessionPanelOpen）：`typeof === "boolean"` 之外一律回落
 * 该键的出厂默认（独立净化分支，与 skin 枚举分支同构，SHALL NOT 抛错）。
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
 * 设置净房（纯函数）：未知键剥离、非法/越界值落回缺省或界内端点。
 * @param {unknown} raw 原始设置对象（v1 载荷无 `skin` 键、v2 载荷无缩放导航三键、
 *        v3 载荷无会话面板展开态、v4 载荷无 `constPreflight` → 逐键补默认）
 * @returns {{ panSpeed: number, panShiftBoost: number, skin: string, zoomDiveRatio: number, zoomFlyOutRatio: number, zoomPointerFocus: boolean, sessionPanelOpen: boolean, constPreflight: "native"|"float" }}
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
    constPreflight: preflightOf(source.constPreflight)
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
