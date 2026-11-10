/**
 * Cosmos 页面设置纯逻辑（真机反馈：WASD 平移速度可配置化）。
 *
 * 独立模块——client.jsx 消费（store 装载/引擎注入）、test/engine-smoke.mjs 冒烟直测。
 * 零依赖：localStorage 读写带守卫（Node/隐私模式缺席 → 缺省），键 `dsh-v-cosmos:settings`
 * （旧名 `dsh-cosmos:settings` 存量读取回落迁移，写入恒走新键）。
 *
 * 设置面（version 1）：
 *  - panSpeed：WASD 基础平移速度（世界单位/秒），缺省 120；
 *  - panShiftBoost：Shift 加速倍率，缺省 3。
 * 后续设置 UI 直接调 `saveCosmosSettings`（写侧净房内置），引擎经
 * `engine.setTuning` 热更新（无需重开整页）。
 */

const SETTINGS_KEY = "dsh-v-cosmos:settings";
/** 品牌更名前的 localStorage 键（仅读取回落，SHALL NOT 写入）。 */
const LEGACY_SETTINGS_KEY = "dsh-cosmos:settings";
export const COSMOS_SETTINGS_KEY = SETTINGS_KEY;
export const COSMOS_SETTINGS_VERSION = 1;

/** 出厂默认（「暂时先用现在的默认值」——调参只动这里或用户配置，SHALL NOT 散落硬编码）。 */
export const COSMOS_SETTINGS_DEFAULTS = Object.freeze({
  panSpeed: 120,
  panShiftBoost: 3
});

/** 界（写侧 400 的前置净房界；越界值落回界内端点，SHALL NOT 抛错）。 */
export const COSMOS_SETTINGS_BOUNDS = Object.freeze({
  panSpeed: [20, 600],
  panShiftBoost: [1, 10]
});

function clampTo(key, value, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  const [min, max] = COSMOS_SETTINGS_BOUNDS[key];
  return Math.min(max, Math.max(min, n));
}

/**
 * 设置净房（纯函数）：未知键剥离、非法/越界值落回缺省或界内端点。
 * @param {unknown} raw 原始设置对象
 * @returns {{ panSpeed: number, panShiftBoost: number }}
 */
export function sanitizeCosmosSettings(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    panSpeed: clampTo("panSpeed", source.panSpeed, COSMOS_SETTINGS_DEFAULTS.panSpeed),
    panShiftBoost: clampTo("panShiftBoost", source.panShiftBoost, COSMOS_SETTINGS_DEFAULTS.panShiftBoost)
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
