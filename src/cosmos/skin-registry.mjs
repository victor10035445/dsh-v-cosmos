/**
 * Cosmos 皮肤注册层（add-cosmos-skin-themes 1.1/1.2/1.5 / design D1、D3、D4）。
 *
 * 三条公共面：
 *  - `COSMOS_SKINS` 有序清单（12 套，顺序即设置页卡片顺序）+ `COSMOS_SKIN_IDS` 派生枚举；
 *  - `createSkin(id)` 工厂：未知/非法 id **回落默认**（MUST NOT 抛错），实例按 id 缓存
 *    （切换免重建绘制资源；glow sprite 缓存随实例，天然按皮肤隔离——design D6）；
 *  - `applySkinTokens(rootEl, skin)`：HUD 令牌 + `data-cos-mode` + `data-cos-progress`
 *    的**唯一写者**（design D3：引擎 `setSkin` MUST NOT 触碰 DOM，避免双写漂移）。
 *
 * 注册表项形状：`{ id, name, ref, mode, base, hud, progressShape, create(), instance }`。
 *  - `name/ref` 为中文权威文案（DICT 另有 zh/en 本地化，键 `cosmos.skin.<id>.name/ref`）；
 *  - `mode` = `"dark" | "light"`（light 走根容器 `[data-cos-mode="light"]` CSS 分支）；
 *  - `hud` 为**完整令牌表**（27 枚，见 `COSMOS_HUD_TOKENS`）：deepspace 逐枚等于
 *    改造前的现值（即全部 `var(--cos-*, fallback)` 的 fallback 基线），其余按 `base`
 *    色板派生（design D4；语义别名 `--cos-lc-*` / `--cos-waiting` / `--cos-done` 一律
 *    取自该皮肤 palette，杜绝手抄漂移）；
 *  - `progressShape` 为**可选形状通道**（p1-add-cosmos-card-progress-bars 2.3 / design D4）：
 *    枚举 `segment | bar | ring`（见 `COSMOS_PROGRESS_SHAPES`），与颜色令牌正交——形状是
 *    **结构**语义，CSS 无法读取令牌值切换结构，故经 `data-cos-progress` 根属性下发，
 *    12 套内置皮肤逐肤指派；字段缺席/枚举外一律经 `progressShapeOf` clamp 为 `segment`
 *    （MUST NOT 抛错）。**零新增 HUD 令牌**：进度条取色复用既有 `--cos-accent` /
 *    `--cos-line` 系（`--cos-accent-rgb` 合成半透明轨道），金色直接量仅允许作 fallback 位。
 */

import { createSkinDeepspace } from "./skin-d.mjs";
import { createSkinRosepine } from "./skins/skin-rosepine.mjs";
import { createSkinFidenza } from "./skins/skin-fidenza.mjs";
import { createSkinLinear } from "./skins/skin-linear.mjs";
import { createSkinObsidian } from "./skins/skin-obsidian.mjs";
import { createSkinReagent } from "./skins/skin-reagent.mjs";
import { createSkinChamber } from "./skins/skin-chamber.mjs";
import { createSkinFluoro } from "./skins/skin-fluoro.mjs";
import { createSkinLotus } from "./skins/skin-lotus.mjs";
import { createSkinMigration } from "./skins/skin-migration.mjs";
import { createSkinCircuit } from "./skins/skin-circuit.mjs";
import { createSkinFermata } from "./skins/skin-fermata.mjs";

/** 默认皮肤（design D2：rosepine 是产品默认；deepspace 保留为回归基线）。 */
export const COSMOS_DEFAULT_SKIN = "rosepine";

/** HUD 令牌全集（12 套皮肤必须逐枚齐备；冒烟断言键集完备）。 */
export const COSMOS_HUD_TOKENS = Object.freeze([
  "--cos-bg",
  "--cos-ink",
  "--cos-ink-dim",
  "--cos-accent-ink",
  "--cos-title-ink",
  "--cos-accent",
  "--cos-glow",
  "--cos-line",
  "--cos-line-strong",
  "--cos-hover",
  "--cos-panel",
  "--cos-panel-soft",
  "--cos-panel-strong",
  "--cos-glass",
  "--cos-chip-bg",
  "--cos-card-bg",
  "--cos-scan",
  "--cos-shadow",
  "--cos-lc-created",
  "--cos-lc-reviewed",
  "--cos-lc-executed",
  /* 星胚灰蓝语义色（add-cosmos-embryo-cards 3.3）：面板星胚卡片取色 + 画布星胚同源；
     12 套皮肤自 `palette.prop.proto` 逐肤派生，deepspace 基线 `#8a9bc0`。 */
  "--cos-lc-proto",
  "--cos-waiting",
  "--cos-done",
  /* RGB 通道令牌：CSS 里以 `rgb(var(--cos-x-rgb, r g b) / α)` 合成半透明变体，
     基线（deepspace）逐位等于改造前的 rgba() 现值。 */
  "--cos-accent-rgb",
  "--cos-ink-rgb",
  "--cos-accent-ink-rgb"
]);

/* ---------- 颜色工具（注册表内部；不依赖 skin-kit 以免皮肤层反向依赖注册层） ---------- */

function hexToRgb(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbChannels(hex) { return hexToRgb(hex).join(" "); }
function rgba(hex, a) { const c = hexToRgb(hex); return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }
function mixHex(h1, h2, k) {
  const a = hexToRgb(h1), b = hexToRgb(h2);
  const r = Math.round(a[0] + (b[0] - a[0]) * k);
  const g = Math.round(a[1] + (b[1] - a[1]) * k);
  const bl = Math.round(a[2] + (b[2] - a[2]) * k);
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1);
}

/**
 * 由色板基座派生完整令牌表（dark/light 两支）。
 * @param {{bg: string, accent: string, mode: "dark"|"light"}} base
 * @param {{prop: object, sess: object}} palette 皮肤 palette（语义别名来源）
 */
function deriveHud(base, palette) {
  const light = base.mode === "light";
  const accent = base.accent;
  const ink = light ? "#33322e" : mixHex("#ffffff", accent, 0.12);
  const hud = {
    "--cos-bg": base.bg,
    "--cos-ink": ink,
    "--cos-ink-dim": rgba(ink, 0.55),
    "--cos-accent-ink": light ? accent : mixHex(accent, "#ffffff", 0.38),
    "--cos-title-ink": light ? "#1f1e1a" : mixHex(accent, "#ffffff", 0.72),
    "--cos-accent": accent,
    "--cos-glow": rgba(accent, light ? 0.18 : 0.55),
    "--cos-line": rgba(accent, light ? 0.28 : 0.35),
    "--cos-line-strong": accent,
    "--cos-hover": rgba(accent, light ? 0.08 : 0.12),
    "--cos-panel": light ? "rgba(250,247,240,.92)" : rgba(base.bg, 0.88),
    "--cos-panel-soft": light ? "rgba(248,244,235,.86)" : rgba(base.bg, 0.62),
    "--cos-panel-strong": light ? "rgba(251,248,241,.97)" : rgba(base.bg, 0.94),
    "--cos-glass": light ? "rgba(250,247,240,.88)" : rgba(base.bg, 0.72),
    "--cos-chip-bg": light ? "rgba(246,241,230,.72)" : rgba(base.bg, 0.45),
    "--cos-card-bg": light ? "rgba(251,248,241,.9)" : rgba(base.bg, 0.55),
    "--cos-scan": light ? "transparent" : rgba(mixHex(accent, "#ffffff", 0.5), 0.02),
    "--cos-shadow": light ? "0 2px 10px rgba(70,60,40,.14)" : "none",
    "--cos-lc-created": palette.prop.created,
    "--cos-lc-reviewed": palette.prop.reviewed,
    "--cos-lc-executed": palette.prop.executed,
    "--cos-lc-proto": palette.prop.proto,
    "--cos-waiting": palette.sess.waiting,
    "--cos-done": palette.sess["done-unread"],
    "--cos-accent-rgb": rgbChannels(accent),
    "--cos-ink-rgb": rgbChannels(ink),
    "--cos-accent-ink-rgb": rgbChannels(light ? accent : mixHex(accent, "#ffffff", 0.38))
  };
  return Object.freeze(hud);
}

/**
 * deepspace 令牌表：逐枚等于改造前 engine.mjs / client.jsx 的现值（fallback 基线）。
 * 由 palette 派生的语义别名与 `SKIN_D_PALETTE` 同源（proto #8a9bc0 / created #9fd8ff /
 * reviewed #cfe8ff / executed #ffe27a；waiting #ffaa4a / done-unread #5affc0）。
 */
const DEEPSPACE_HUD = Object.freeze({
  "--cos-bg": "#070812",
  "--cos-ink": "#ffe9cf",
  "--cos-ink-dim": "rgba(255,233,207,.55)",
  "--cos-accent-ink": "#ffe3b8",
  "--cos-title-ink": "#fff3dd",
  "--cos-accent": "#ffd28a",
  "--cos-glow": "rgba(255,210,140,.55)",
  "--cos-line": "rgba(255,210,140,.35)",
  "--cos-line-strong": "#ffd28a",
  "--cos-hover": "rgba(255,210,140,.12)",
  "--cos-panel": "rgba(8,8,16,.88)",
  "--cos-panel-soft": "rgba(8,8,16,.62)",
  "--cos-panel-strong": "rgba(8,8,16,.94)",
  "--cos-glass": "rgba(8,8,16,.72)",
  "--cos-chip-bg": "rgba(10,10,20,.45)",
  "--cos-card-bg": "rgba(10,10,20,.55)",
  "--cos-scan": "rgba(255,230,190,.02)",
  "--cos-shadow": "none",
  "--cos-lc-created": "#9fd8ff",
  "--cos-lc-reviewed": "#cfe8ff",
  "--cos-lc-executed": "#ffe27a",
  "--cos-lc-proto": "#8a9bc0",
  "--cos-waiting": "#ffaa4a",
  "--cos-done": "#5affc0",
  "--cos-accent-rgb": "255 210 140",
  "--cos-ink-rgb": "255 233 207",
  "--cos-accent-ink-rgb": "255 227 184"
});

/**
 * 卡片进度形状枚举（p1-add-cosmos-card-progress-bars 2.1 / design D4/D5）：
 * `segment`（满宽格栅，基线）/ `bar`（满宽连续条）/ `ring`（meta 行内小环）。
 * 顺序无 UI 语义（设置页不暴露该维度），仅作 clamp 白名单与冒烟枚举完备断言的单一来源。
 */
export const COSMOS_PROGRESS_SHAPES = Object.freeze(["segment", "bar", "ring"]);

/** 缺省/兜底形状：属性缺失、字段缺席、枚举外值一律回落 `segment`（fallback 基线）。 */
export const COSMOS_PROGRESS_SHAPE_DEFAULT = "segment";

/**
 * 形状值 clamp 纯函数（MUST NOT 抛错）：枚举内原样返回，其余（含 null/undefined/数字/
 * 外部注入皮肤实例的未知写法）一律回落 `segment`。
 *
 * 注册表项是**冻结**对象（`Object.freeze`），运行期无法再清洗；clamp 必须由纯函数接缝
 * 承担：注册点与 `applySkinTokens` 下发点各调一次，冒烟据此直测（2.1 / 4.3）。
 * @param {unknown} value 候选形状值
 * @returns {"segment"|"bar"|"ring"}
 */
export function progressShapeOf(value) {
  return typeof value === "string" && COSMOS_PROGRESS_SHAPES.includes(value)
    ? value
    : COSMOS_PROGRESS_SHAPE_DEFAULT;
}

/**
 * 内置皮肤规格清单（base 只声明派生根：底色 + 主调 + 明暗模式；hud 由 deriveHud 补全）。
 * 顺序 = 设置页卡片顺序（deepspace 首位 = 视觉回归基线）。
 *
 * `progressShape` = 逐肤指派表（design D5，常量表微调零成本）：`segment` 5 套
 * （deepspace / rosepine / fidenza / migration / circuit：基线刻度感、版画齿孔、雁阵离散、
 * LED 格栅）、`bar` 4 套（linear / obsidian / chamber / reagent：界面、图谱、实验记录的
 * 连续量语言）、`ring` 3 套（fluoro / lotus / fermata：培养皿、涟漪、倚音弧）。
 */
const SKIN_SPECS = [
  {
    id: "deepspace",
    name: "深空银河",
    ref: "现风格 D（视觉回归基线）",
    mode: "dark",
    base: { bg: "#070812", accent: "#ffd28a", mode: "dark" },
    progressShape: "segment",
    create: createSkinDeepspace
  },
  {
    id: "rosepine",
    name: "星图玫瑰松",
    ref: "Rosé Pine 官方色板（与现基线血缘最近）",
    mode: "dark",
    base: { bg: "#191724", accent: "#f6c177", mode: "dark" },
    progressShape: "segment",
    create: createSkinRosepine
  },
  {
    id: "fidenza",
    name: "费登莎暖矿",
    ref: "Tyler Hobbs 方法论（纸面透明星空）",
    mode: "light",
    base: { bg: "#f4efe4", accent: "#33322e", mode: "light" },
    progressShape: "segment",
    create: createSkinFidenza
  },
  {
    id: "linear",
    name: "Linear 靛紫",
    ref: "Linear.app 设计语言",
    mode: "dark",
    base: { bg: "#070809", accent: "#5e6ad2", mode: "dark" },
    progressShape: "bar",
    create: createSkinLinear
  },
  {
    id: "obsidian",
    name: "知识星图",
    ref: "Obsidian Graph View",
    mode: "dark",
    base: { bg: "#121217", accent: "#a882ff", mode: "dark" },
    progressShape: "bar",
    create: createSkinObsidian
  },
  {
    id: "reagent",
    name: "化学反应",
    ref: "化学实验（培养皿/荧光试剂）",
    mode: "dark",
    base: { bg: "#08090d", accent: "#4ad8c8", mode: "dark" },
    progressShape: "bar",
    create: createSkinReagent
  },
  {
    id: "chamber",
    name: "云室",
    ref: "粒子物理（衰变径迹）",
    mode: "dark",
    base: { bg: "#0a0d12", accent: "#8fa8c0", mode: "dark" },
    progressShape: "bar",
    create: createSkinChamber
  },
  {
    id: "fluoro",
    name: "荧光显微",
    ref: "荧光显微摄影（细胞/细胞器）",
    mode: "dark",
    base: { bg: "#030304", accent: "#3ec8c8", mode: "dark" },
    progressShape: "ring",
    create: createSkinFluoro
  },
  {
    id: "lotus",
    name: "荷塘月色",
    ref: "水墨池塘（花期/锦鲤）",
    mode: "dark",
    base: { bg: "#0a1418", accent: "#cfe0d8", mode: "dark" },
    progressShape: "ring",
    create: createSkinLotus
  },
  {
    id: "migration",
    name: "雁阵暮色",
    ref: "候鸟迁徙（雁群/鸟浪）",
    mode: "dark",
    base: { bg: "#191333", accent: "#ffb056", mode: "dark" },
    progressShape: "segment",
    create: createSkinMigration
  },
  {
    id: "circuit",
    name: "覆铜星板",
    ref: "PCB（芯片/信号脉冲）",
    mode: "dark",
    base: { bg: "#0d1410", accent: "#ffc24a", mode: "dark" },
    progressShape: "segment",
    create: createSkinCircuit
  },
  {
    id: "fermata",
    name: "总谱延音",
    ref: "音乐总谱（音符/fermata）",
    mode: "dark",
    base: { bg: "#0b0a09", accent: "#e8c874", mode: "dark" },
    progressShape: "ring",
    create: createSkinFermata
  }
];

/** 注册表项（实例 + 令牌表在模块初始化时一次备齐；皮肤构造期零 DOM 副作用）。 */
export const COSMOS_SKINS = Object.freeze(SKIN_SPECS.map(function (spec) {
  const instance = spec.create();
  /* 标注取色通道（polish-cosmos-tip-leader-line D5：浮签引线配色）：`palette.accent`
     单一来源 = 本项注册规格的 `base.accent`（与 HUD `--cos-accent` 同源）——12 套皮肤
     模块各自手抄一份必漂移，故在注册点统一派生。直接构造的皮肤实例（冒烟 / 外部注入
     `style`）不经此路径，引擎侧回落 `gold`（见 engine `tipLineColorOf`）。 */
  if (instance && instance.palette && typeof instance.palette === "object"
    && typeof instance.palette.accent !== "string") {
    instance.palette.accent = spec.base.accent;
  }
  return Object.freeze({
    id: spec.id,
    name: spec.name,
    ref: spec.ref,
    mode: spec.mode,
    base: Object.freeze({ ...spec.base }),
    hud: spec.id === "deepspace" ? DEEPSPACE_HUD : deriveHud(spec.base, instance.palette),
    /* 形状通道（2.1）：注册点即 clamp（缺席/枚举外 → segment），注册表项冻结后不可再清洗；
       取值经纯函数接缝 → 冒烟可直测（4.3/4.4）。 */
    progressShape: progressShapeOf(spec.progressShape),
    create: spec.create,
    instance
  });
}));

/** id 枚举（派生；设置净房以它做枚举钳制，MUST NOT 手抄第二份清单）。 */
export const COSMOS_SKIN_IDS = Object.freeze(COSMOS_SKINS.map(function (entry) { return entry.id; }));

const BY_ID = new Map(COSMOS_SKINS.map(function (entry) { return [entry.id, entry]; }));

/** 注册表项（未知 id → null；调用方决定回落策略）。 */
export function skinEntryOf(id) {
  return typeof id === "string" ? (BY_ID.get(id) ?? null) : null;
}

/** 注册表项（未知/非法 id 回落默认皮肤；SHALL NOT 抛错）。 */
export function resolvedSkinEntry(id) {
  return skinEntryOf(id) ?? BY_ID.get(COSMOS_DEFAULT_SKIN);
}

/**
 * 皮肤工厂：未知/非法 id 回落默认皮肤（SHALL NOT 抛错）。
 * 实例按 id 缓存（同一 id 恒返回同一实例 → glow sprite 缓存复用、跨皮肤不串色）。
 * @param {string} [id]
 * @returns {{skin: string, useBand: boolean, palette: object, bgStarColor: Function, dustColors: string[], background: Function, drawBody: Function}}
 */
export function createSkin(id) {
  return resolvedSkinEntry(id).instance;
}

/** HUD 令牌表（未知 id 回落默认；冒烟/设置页色板条消费）。 */
export function skinHudOf(id) {
  return resolvedSkinEntry(id).hud;
}

/** 设置页卡片数据（预览色板条取 5 色；顺序 = 注册表顺序）。 */
export function skinCardOf(entry) {
  const hud = entry.hud;
  return {
    id: entry.id,
    name: entry.name,
    ref: entry.ref,
    mode: entry.mode,
    isDefault: entry.id === COSMOS_DEFAULT_SKIN,
    swatches: [
      hud["--cos-bg"],
      hud["--cos-accent"],
      hud["--cos-lc-created"],
      hud["--cos-waiting"],
      hud["--cos-done"]
    ]
  };
}

/**
 * HUD 令牌 + `data-cos-mode` + `data-cos-progress` 下发（design D3：唯一写者）。
 *
 * 作用域 = 整页根容器（引擎 `.cos-root` 与 React 面板层的共同父级）：令牌是 CSS 自定义
 * 属性，沿继承链自动覆盖两侧——`engine.mjs` 的注入 CSS 与 `client.jsx` 的整页 CSS 因此
 * 同时换装，无需逐规则下发。形状属性同址同写者（2.2）：进度条组件只看根属性切形态，
 * 与 `data-cos-mode` 一样在一次下发内落值，杜绝「令牌已换、形状滞后」的中间态。
 *
 * @param {HTMLElement|null} rootEl 整页根容器
 * @param {object|string} skin 皮肤实例 / 注册表项 / 皮肤 id（三者皆可）
 * @returns {boolean} 是否下发成功（根容器缺失或皮肤不可解析 → false，不抛错）
 */
export function applySkinTokens(rootEl, skin) {
  if (!rootEl || typeof rootEl !== "object") return false;
  let entry = null;
  if (typeof skin === "string") entry = skinEntryOf(skin);
  else if (skin && typeof skin === "object" && skin.hud) entry = skinEntryOf(skin.id);
  else if (skin && typeof skin === "object" && typeof skin.skin === "string") entry = skinEntryOf(skin.skin);
  if (!entry) return false;
  const style = rootEl.style;
  const hud = entry.hud;
  for (const name of COSMOS_HUD_TOKENS) {
    const value = hud[name];
    if (value === undefined) continue;
    if (style && typeof style.setProperty === "function") style.setProperty(name, value);
    else if (style) style[name] = value;
  }
  const mode = entry.mode === "light" ? "light" : "dark";
  if (rootEl.dataset) rootEl.dataset.cosMode = mode;
  else if (typeof rootEl.setAttribute === "function") rootEl.setAttribute("data-cos-mode", mode);
  /* 形状通道（2.2）：与 data-cos-mode 同一写者、同一根容器作用域；取值恒经
     `progressShapeOf` clamp（缺席/枚举外 → segment，MUST NOT 抛错）——旧注册表项、
     外部注入实例、异常路径都不可能让属性落在枚举外或缺失。 */
  const progressShape = progressShapeOf(entry.progressShape);
  if (rootEl.dataset) rootEl.dataset.cosProgress = progressShape;
  else if (typeof rootEl.setAttribute === "function") rootEl.setAttribute("data-cos-progress", progressShape);
  return true;
}
