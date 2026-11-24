/**
 * dsh-v-cosmos · 星座星场（作品面）模型与渲染核（p2-add-cosmos-works-face）
 *
 * 命名契约（p2 用户修订，后续迭代以此为准）：
 *  - **作品（Work）**：登记进星座的文件条目（存储 `relPath` / `name` / `note` / …）。
 *  - **作品焦点（Work Focus，简称「焦点」）**：星场中每件作品对应的可视点；代码与
 *    spec MUST 使用该词，MUST NOT 用「star / 恒星」指代作品焦点。
 *  - **别名（Alias）**：用户可编辑的显示名；持久化字段沿用 p1 契约 `name`，投影层
 *    同时暴露 `name` 与 `alias`（同值），新消费方一律读 `alias`。
 *  - **显示名（Display Name）**：`alias` 非空取别名，否则回落文件名（`relPath` 的
 *    basename）——每个焦点**恒有显示名**，别名本身可选。
 *  - **焦点形状（Focus Shape）**：以焦点为中心、按类型绘制的虚线轮廓（exec 六边形 /
 *    html 菱形 / md 方框 / pdf 三角 / other 圆）；替代旧「焦点上方类型字形」。
 *  - **类型徽标（Kind Glyph）**：⚙◈▤▯●，仅用于 DOM 信息卡/编辑页的类型徽标，
 *    MUST NOT 再绘制在焦点上方。
 *
 * 语义：星座钻取态的**另一面**——作品是势场中凝聚成核的**焦点**，场有呼吸、有能量流、
 * 有 ASCII 底纹；换面由多源水波涟漪（真实融合叠加干涉）承载，反向由粒子汇聚归位。
 * 本模块只持有**呈现态**（焦点/场域/转场/特效）与**纯函数**（布位、波场、等势线、
 * ASCII、粒子），不触碰 DOM、不发起网络请求——数据面（works 快照）与 HUD 铬件
 * （面切换按钮/信息卡/编辑页/系统文件选择器）分别由 client.jsx 与 works-face-ui.mjs 承担。
 *
 * 纪律对照（openspec/changes/p2-add-cosmos-works-face/specs/cosmos-works-face/spec.md）：
 *  - 转场揭示 = 低分辨率合成波场高度图（多源叠加，MUST NOT 退化为独立包络并集）——
 *    `waveHeightAt` / `waveUnionAt` / `waveRevealAt` 三个纯函数是唯一真源，渲染与冒烟共用；
 *  - 布位 = 条目 id 哈希播种 + 确定性最小间距松弛；**增量只移动新焦点**（稳定槽位）；
 *  - 场域缓存键 = 焦点集合签名 + 呼吸相位 100ms 桶（稳态帧零重算，`inspect()` 可断言）；
 *  - ASCII 离屏 ≤180ms 重绘；等势线 marching squares（鞍部涌现）；
 *  - 皮肤主题化：焦点/网格/等势线/涨落海取皮肤调色板与表面通道，light 皮肤禁加色；
 *  - 触屏长按（add-cosmos-focus-touch-activate）：呈现态由引擎写入（`holdBegin` /
 *    `holdUpdate` / `holdEnd`），进度环几何走纯函数 `focusShapeProgressPointsOf`（与焦点
 *    同一形状路径，形状语义不破功），触水涟漪复用既有发射机 + accent 通道取色；
 *    取消/激发后 `WORKS_HOLD.retreat` 快退；风暴降级停发涟漪、进度环保留。
 */
const TAU = Math.PI * 2;

/** 服务端条目上限（works-store WORKS_LIMIT 的呈现层镜像：客户端不得依赖服务端模块）。 */
export const WORKS_FACE_LIMIT = 32;

export const FACE_MATTER = "matter";
export const FACE_FIELD = "field";

/** 转场时窗（秒）：toField = 充电拍 + 波前推进；toMatter = 粒子汇聚；crossfade = 降级。 */
export const WORKS_FACE_TRANSITION = Object.freeze({
  toField: 2.46,
  toMatter: 2.3,
  crossfade: 0.6,
  charge: 0.32,
  wave: 2.14
});

/** 类型字形（`exec=⚙ / html=◈ / md=▤ / pdf=▯ / other=●`；仅信息卡/编辑页徽标使用）。 */
export const WORKS_KIND_GLYPH = Object.freeze({
  exec: "\u2699",
  html: "\u25C8",
  md: "\u25A4",
  pdf: "\u25AF",
  other: "\u25CF"
});

/**
 * 焦点形状（Focus Shape）：以作品焦点为中心、按类型绘制的虚线轮廓；替代旧「焦点上方
 * 类型字形」的呈现职责（字形仅保留在 DOM 信息卡/编辑页作类型徽标）。
 *  - exec → 六边形（工业/齿轮感）
 *  - html → 菱形（尖括号）
 *  - md → 方框（文档页）
 *  - pdf → 三角（封签）
 *  - other → 圆
 */
export const WORKS_FOCUS_SHAPE = Object.freeze({
  exec: "hexagon",
  html: "diamond",
  md: "square",
  pdf: "triangle",
  other: "circle"
});

const FOCUS_SHAPE_NAMES = new Set(Object.values(WORKS_FOCUS_SHAPE));

/**
 * 接受 **kind**（html）或 **形状名**（diamond）→ 规范形状名。
 * 绘制链内部传递形状名，外部/测试多传 kind；两者都支持，避免二次映射回落成圆。
 */
export function focusShapeNameOf(kindOrShape) {
  const direct = WORKS_FOCUS_SHAPE[kindOrShape];
  if (direct) return direct;
  return FOCUS_SHAPE_NAMES.has(kindOrShape) ? kindOrShape : WORKS_FOCUS_SHAPE.other;
}

/**
 * 焦点形状顶点（纯函数，便于实验/冒烟断言）：顶点以 `(x,y)` 为中心、半径 `r`。
 * 入参可传 kind（`html`）或形状名（`diamond`）。circle 返回空数组（绘制走 `arc`）。
 * 旋转口径：exec 尖顶六边形；html 上/右/下/左菱形；md 轴对齐方框；pdf 尖顶三角。
 * @returns {Array<{x:number,y:number}>}
 */
export function focusShapePointsOf(kind, x, y, r) {
  const shape = focusShapeNameOf(kind);
  const radius = Number(r) > 0 ? Number(r) : 1;
  const cx = Number(x) || 0;
  const cy = Number(y) || 0;
  const points = [];
  const add = (angle) => points.push({
    x: cx + Math.cos(angle) * radius,
    y: cy + Math.sin(angle) * radius
  });
  if (shape === "hexagon") {
    for (let i = 0; i < 6; i++) add(-Math.PI / 2 + (i * TAU) / 6);
  } else if (shape === "diamond") {
    for (let i = 0; i < 4; i++) add(-Math.PI / 2 + (i * TAU) / 4);
  } else if (shape === "square") {
    for (let i = 0; i < 4; i++) add(-Math.PI / 4 + (i * TAU) / 4);
  } else if (shape === "triangle") {
    for (let i = 0; i < 3; i++) add(-Math.PI / 2 + (i * TAU) / 3);
  }
  return points;
}

/**
 * 触屏长按动效参数（add-cosmos-focus-touch-activate D5；集中校准）。
 *  - `ringPeriod`：触水涟漪重复周期（秒）——每周期 `ringsPerPeriod` 道同心扩散环；
 *  - `ringDur` / `ringAlpha` / `ringMaxR`：hold 专属**细环**包络（alpha 随半径衰减，
 *    与「激发强涟漪」单道粗环可分辨）；
 *  - `retreat`：取消/激发后的动效快退时长（秒）——进度环 alpha 线性归零，无残帧。
 * 进度环的时长不在此：进度 = 引擎长按时钟（`HOLD_MS`），渲染核只按 `k` 描边。
 */
export const WORKS_HOLD = Object.freeze({
  ringPeriod: 0.8,
  ringsPerPeriod: 3,
  ringDur: 0.8,
  ringAlpha: 0.2,
  ringMaxR: 58,
  retreat: 0.2
});

/**
 * 焦点形状**进度折线**（纯函数；进度环几何唯一真源）：自形状首个顶点
 * （exec 尖顶 / 方框左上角 / 三角尖顶）起顺时针截取周长的 `k` 比例，返回折线点。
 * 形状语义不破功（六边形进度仍是六边形）；circle 返回空数组——绘制走 `arc` 角度弧。
 * @param {string} kindOrShape kind（exec）或形状名（hexagon）
 * @param {number} x
 * @param {number} y
 * @param {number} r 周界半径（像素）
 * @param {number} k 进度 0..1（越界 clamp）
 * @returns {Array<{x:number,y:number}>}
 */
export function focusShapeProgressPointsOf(kindOrShape, x, y, r, k) {
  const shape = focusShapeNameOf(kindOrShape);
  if (shape === "circle") return [];
  const points = focusShapePointsOf(shape, x, y, r);
  if (points.length < 2) return [];
  const ratio = clamp(Number(k) || 0, 0, 1);
  if (!(ratio > 0)) return [];
  const edges = [];
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    edges.push({ a, b, len });
    total += len;
  }
  if (!(total > 0)) return [];
  const out = [{ x: points[0].x, y: points[0].y }];
  const EPS = 1e-9;
  const want = total * ratio;
  let acc = 0;
  for (const edge of edges) {
    const remaining = want - acc;
    if (remaining <= EPS) break;
    if (remaining >= edge.len - EPS) {
      out.push({ x: edge.b.x, y: edge.b.y });
      acc += edge.len;
      continue;
    }
    const q = remaining / edge.len;
    out.push({
      x: edge.a.x + (edge.b.x - edge.a.x) * q,
      y: edge.a.y + (edge.b.y - edge.a.y) * q
    });
    acc = want;
    break;
  }
  return out;
}

/** 类型名（信息卡徽标文案；缺键回落「文件」）。 */
export const WORKS_KIND_LABEL = Object.freeze({
  exec: "可执行",
  html: "HTML 文档",
  md: "Markdown 文档",
  pdf: "PDF 文档",
  other: "文件"
});

/** ASCII 字符坡：由稀到密（势场深度 → 字符饱满度，three.js AsciiEffect 同思路）。 */
export const WORKS_ASCII_RAMP = " .:-=+*#";

/** 布位常量（集中定义便于校准）：最小间距 / 虚位排斥半径 / 松弛轮数。 */
export const WORKS_LAYOUT = Object.freeze({
  minDist: 0.155,
  vacancyRadius: 0.105,
  rounds: 24,
  goldenAngle: 2.39996323
});

const WAVE = Object.freeze({
  charge: WORKS_FACE_TRANSITION.charge,
  wave: WORKS_FACE_TRANSITION.wave,
  lamRatio: 0.072,
  decayRatio: 0.55,
  softRatio: 0.09,
  omega: 5.6,
  tailStart: 0.82,
  tailSpan: 0.18
});

/* ── 小工具（纯函数） ──────────────────────────────────── */

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function lerp(a, b, k) { return a + (b - a) * k; }
function smoothstep(k) { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); }
function easeOutCubic(k) { k = clamp(k, 0, 1); return 1 - Math.pow(1 - k, 3); }
function easeInOut(k) { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); }

/** 字符串稳定哈希（id 播种；同 id 同序列，跨会话一致）。 */
export function worksHashOf(text) {
  const s = String(text ?? "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 确定性随机（转场粒子/焦相位用；MUST NOT 用 Math.random）。 */
export function worksRng(seed) {
  let s = seed >>> 0;
  return function rnd() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexOf(value) {
  return typeof value === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim())
    ? value.trim()
    : null;
}

function rgbOf(hex) {
  const h = hexOf(hex);
  if (!h) return null;
  const body = h.slice(1);
  if (body.length === 3) {
    return [parseInt(body[0] + body[0], 16), parseInt(body[1] + body[1], 16), parseInt(body[2] + body[2], 16)];
  }
  return [parseInt(body.slice(0, 2), 16), parseInt(body.slice(2, 4), 16), parseInt(body.slice(4, 6), 16)];
}

/** `#rrggbb` + α → `rgba(...)`（非法色值回落冷白，MUST NOT 抛错）。 */
export function worksRgba(color, alpha) {
  const rgb = rgbOf(color) || [200, 220, 255];
  return "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + clamp(Number(alpha) || 0, 0, 1).toFixed(3) + ")";
}

/** 颜色线性混合（粒子捕获混色用；非法色值回落端点自身）。 */
export function worksMixHex(a, b, k) {
  const ca = rgbOf(a) || rgbOf("#c8dcff");
  const cb = rgbOf(b) || rgbOf("#c8dcff");
  const t = clamp(Number(k) || 0, 0, 1);
  const ch = (i) => Math.round(lerp(ca[i], cb[i], t));
  return "#" + ((1 << 24) + (ch(0) << 16) + (ch(1) << 8) + ch(2)).toString(16).slice(1);
}

/* ── 焦点视图模型 ──────────────────────────────────────── */

/**
 * works 快照条目 → 焦点视图模型（spec「焦点呈现与稳定布位」/ tasks 1.1）。
 * 容错归一：id 缺失条目丢弃；`kind` 池外落 `other`；显示名回落文件名；`exists:false`
 * 即失谐。纯函数、可冒烟直测。
 * @param {Array<object>} entries 服务端 `GET /works` 条目（含 displayName/exists）
 * @returns {Array<object>}
 */
export function worksFocusListOf(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const out = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (!id) continue;
    const relPath = typeof raw.relPath === "string" ? raw.relPath.trim() : "";
    const kind = typeof raw.kind === "string" && WORKS_KIND_GLYPH[raw.kind] ? raw.kind : "other";
    const name = typeof raw.name === "string" && raw.name.trim() !== "" ? raw.name : null;
    const note = typeof raw.note === "string" && raw.note.trim() !== "" ? raw.note : null;
    const fileName = relPath.split(/[\\/]+/).filter(Boolean).pop() || relPath || id;
    const displayName = typeof raw.displayName === "string" && raw.displayName.trim() !== ""
      ? raw.displayName
      : (name || fileName);
    const addedAt = Number(raw.addedAt);
    const lastLaunchedAt = Number(raw.lastLaunchedAt);
    out.push({
      id,
      relPath,
      kind,
      name,
      /* 规范别名：与 `name` 同值（p1 存储/端点仍用 name）；新消费方读 alias。 */
      alias: name,
      note,
      displayName,
      exists: raw.exists !== false,
      addedAt: Number.isFinite(addedAt) ? addedAt : 0,
      lastLaunchedAt: Number.isFinite(lastLaunchedAt) ? lastLaunchedAt : 0,
      hasLastLaunched: Number.isFinite(lastLaunchedAt) && lastLaunchedAt > 0
    });
  }
  return out;
}

/** 焦点集合签名（缓存失效键；与顺序无关，稳定字符串）。 */
export function worksSignatureOf(focuses) {
  const list = Array.isArray(focuses) ? focuses : [];
  return list
    .map((f) => String(f.id) + ":" + String(f.kind) + ":" + (f.exists === false ? "0" : "1"))
    .sort()
    .join("|");
}

/* ── 稳定布位（id 哈希播种 + 最小间距松弛） ───────────────── */

function clampPoint(p) {
  return { x: clamp(p.x, 0.075, 0.925), y: clamp(p.y, 0.11, 0.89) };
}

/** id 播种的候选点：黄金角探针（第 k 个候选沿同一 id 序列外扩，与集合无关）。 */
function seedPointOf(id, k) {
  const h = worksHashOf(id);
  const rnd = worksRng(h);
  const ang = rnd() * TAU + k * WORKS_LAYOUT.goldenAngle;
  const rad = 0.095 + ((h % 1000) / 1000) * 0.05 + k * 0.03;
  return clampPoint({ x: 0.5 + Math.cos(ang) * rad, y: 0.5 + Math.sin(ang) * rad * 0.8 });
}

function distOf(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * 松弛：`movable` 内的点参与位移，其余为锁定槽位（增量语义 = 存量零位移）。
 * 确定性：成对遍历顺序由传入 id 序列固定（调用侧按哈希排序）。
 */
function relaxLayout(layout, order, movable, minDist, vacancyRadius, rounds) {
  const ids = order.filter((id) => layout.has(id));
  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const ai = layout.get(ids[i]);
        const bj = layout.get(ids[j]);
        const movA = movable.has(ids[i]);
        const movB = movable.has(ids[j]);
        if (!movA && !movB) continue;
        let dx = ai.x - bj.x;
        let dy = ai.y - bj.y;
        let d = Math.hypot(dx, dy);
        if (d >= minDist) continue;
        if (d < 1e-6) { dx = 0.001; dy = 0.001; d = Math.hypot(dx, dy); }
        const push = (minDist - d) / 2;
        const ux = dx / d;
        const uy = dy / d;
        if (movA && movB) {
          ai.x += ux * push; ai.y += uy * push;
          bj.x -= ux * push; bj.y -= uy * push;
        } else if (movA) {
          ai.x += ux * push * 2; ai.y += uy * push * 2;
        } else {
          bj.x -= ux * push * 2; bj.y -= uy * push * 2;
        }
      }
    }
    // 虚位中心排斥（保距下限）：避免首个焦点落在虚位正上方造成跳变观感。
    for (const id of ids) {
      if (!movable.has(id)) continue;
      const p = layout.get(id);
      const dx = p.x - 0.5;
      const dy = p.y - 0.5;
      const d = Math.hypot(dx, dy);
      if (d >= vacancyRadius) continue;
      if (d < 1e-6) { p.x += vacancyRadius; continue; }
      p.x = 0.5 + (dx / d) * vacancyRadius;
      p.y = 0.5 + (dy / d) * vacancyRadius;
    }
    for (const id of ids) {
      const p = layout.get(id);
      const c = clampPoint(p);
      p.x = c.x; p.y = c.y;
    }
  }
  return layout;
}

/**
 * 稳定布位（纯函数）：同集合同布位、与条目顺序无关；实体为归一化坐标（0..1）。
 * @param {Array<object>} entries works 快照条目
 * @param {{minDist?: number, vacancyRadius?: number, rounds?: number}} [options]
 * @returns {Map<string, {x:number,y:number}>}
 */
export function worksLayoutOf(entries, options = {}) {
  return placeWorksIncremental(entries, new Map(), options);
}

/**
 * 增量布位（稳定槽位语义）：`fixed` 内焦点坐标逐位不变，只为新 id 落位并只移动新点。
 * 新点从 id 播种候选出发，碰撞时沿同一 id 的黄金角探针外扩（确定性）。
 * @param {Array<object>} entries
 * @param {Map<string, {x:number,y:number}>} fixed 已锁定槽位
 * @param {{minDist?: number, vacancyRadius?: number, rounds?: number}} [options]
 * @returns {Map<string, {x:number,y:number}>}
 */
export function placeWorksIncremental(entries, fixed, options = {}) {
  const list = worksFocusListOf(entries);
  const minDist = Number.isFinite(options.minDist) ? options.minDist : WORKS_LAYOUT.minDist;
  const vacancyRadius = Number.isFinite(options.vacancyRadius) ? options.vacancyRadius : WORKS_LAYOUT.vacancyRadius;
  const rounds = Number.isFinite(options.rounds) ? options.rounds : WORKS_LAYOUT.rounds;
  const layout = new Map();
  const known = new Set();
  for (const f of list) {
    const lock = fixed instanceof Map ? fixed.get(f.id) : null;
    if (lock && Number.isFinite(lock.x) && Number.isFinite(lock.y)) {
      layout.set(f.id, clampPoint({ x: lock.x, y: lock.y }));
      known.add(f.id);
    }
  }
  const missing = list
    .filter((f) => !known.has(f.id))
    .map((f) => ({ id: f.id, h: worksHashOf(f.id) }))
    .sort((a, b) => (a.h - b.h) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const movable = new Set(missing.map((m) => m.id));
  for (const item of missing) {
    let chosen = seedPointOf(item.id, 0);
    for (let probe = 1; probe < 28; probe++) {
      let ok = true;
      for (const p of layout.values()) {
        if (distOf(chosen, p) < minDist * 0.82) { ok = false; break; }
      }
      if (ok) break;
      chosen = seedPointOf(item.id, probe);
    }
    layout.set(item.id, chosen);
  }
  const order = Array.from(layout.keys()).sort((a, b) => {
    const ha = worksHashOf(a);
    const hb = worksHashOf(b);
    return (ha - hb) || (a < b ? -1 : a > b ? 1 : 0);
  });
  return relaxLayout(layout, order, movable, minDist, vacancyRadius, rounds);
}

/* ── 多源水波场（融合叠加；转场揭示唯一真源） ─────────────── */

function waveOptionsOf(options = {}) {
  const width = Number(options.width) > 0 ? Number(options.width) : 1280;
  const height = Number(options.height) > 0 ? Number(options.height) : 720;
  const lam = Math.max(46, Math.min(width, height) * WAVE.lamRatio);
  return {
    width,
    height,
    lam,
    k: TAU / lam,
    decay: Math.max(120, Math.min(width, height) * WAVE.decayRatio),
    soft: Math.max(18, Math.min(width, height) * WAVE.softRatio),
    rFar: Math.hypot(width, height) * 0.62,
    wave: WAVE.wave,
    charge: WAVE.charge,
    omega: WAVE.omega,
    tailStart: WAVE.tailStart,
    tailSpan: WAVE.tailSpan
  };
}

function sourceState(src, x, y, elapsed, opts) {
  const delay = Number(src?.delay) || 0;
  const e = elapsed - delay;
  if (!(e > 0)) return { gate: 0, h: 0, amp: 0 };
  const q = clamp(e / opts.wave, 0, 1);
  const radius = easeOutCubic(q) * opts.rFar;
  const d = Math.hypot(x - Number(src.x || 0), y - Number(src.y || 0));
  const gate = smoothstep((radius + opts.soft * 0.5 - d) / opts.soft);
  if (gate <= 0) return { gate: 0, h: 0, amp: 0 };
  const amp = (1 - 0.55 * q) * Math.exp(-d / opts.decay);
  const h = amp * Math.sin(opts.k * d - opts.omega * e + (Number(src.phase) || 0)) * gate;
  return { gate, h, amp };
}

/** 合成波场高度（逐点叠加；相长区 |h| 增强、相消区抵消）。 */
export function waveHeightAt(sources, x, y, elapsed, options = {}) {
  const opts = waveOptionsOf(options);
  let h = 0;
  for (const src of Array.isArray(sources) ? sources : []) h += sourceState(src, x, y, elapsed, opts).h;
  return h;
}

/** 各源独立包络并集（对照基线；spec 明令揭示 MUST NOT 退化为本式）。 */
export function waveUnionAt(sources, x, y, elapsed, options = {}) {
  const opts = waveOptionsOf(options);
  let union = 0;
  for (const src of Array.isArray(sources) ? sources : []) {
    union = Math.max(union, sourceState(src, x, y, elapsed, opts).gate);
  }
  return union;
}

/**
 * 揭示进度（0..1）：融合波场驱动——合成场相长区提前增强、相消区延迟减弱；
 * 尾段（最后约 18% 时窗）整体收敛到 1，保证波前覆盖视口后星场完全显形。
 */
export function waveRevealAt(sources, x, y, elapsed, options = {}) {
  const opts = waveOptionsOf(options);
  let union = 0;
  let h = 0;
  let denom = 0;
  for (const src of Array.isArray(sources) ? sources : []) {
    const st = sourceState(src, x, y, elapsed, opts);
    union = Math.max(union, st.gate);
    h += st.h;
    denom += st.amp * st.gate;
  }
  const interference = denom > 1e-6 ? h / denom : 0;
  const tail = smoothstep((elapsed - opts.charge - opts.wave * opts.tailStart) / (opts.wave * opts.tailSpan));
  const modulated = clamp(union * (0.62 + 0.55 * interference), 0, 1);
  return clamp(modulated * (1 - tail) + tail, 0, 1);
}

/** crest 亮度（同一合成场驱动：波峰正半周提亮，波谷不发光）。 */
export function waveCrestAt(sources, x, y, elapsed, options = {}) {
  const opts = waveOptionsOf(options);
  let positive = 0;
  let denom = 0;
  for (const src of Array.isArray(sources) ? sources : []) {
    const st = sourceState(src, x, y, elapsed, opts);
    positive += Math.max(0, st.h);
    denom += st.amp * st.gate;
  }
  if (denom <= 1e-6) return 0;
  return clamp(positive / denom, 0, 1);
}

/**
 * 面转场计划（冻结时基的纯函数；engine 在启动转场时调用一次）：
 * - 风暴降级 / 显式 crossfade → 简单交叉淡变 0.6s（无涟漪列车与压暗动势）；
 * - 否则 toField = 2.46s 叙事、toMatter = 2.3s 叙事。
 * @param {{direction: "toField"|"toMatter", storm?: boolean, crossfade?: boolean}} input
 * @returns {{direction: string, mode: "narrative"|"crossfade", duration: number}}
 */
export function faceTransitionPlanOf(input = {}) {
  const direction = input.direction === "toMatter" ? "toMatter" : "toField";
  const crossfade = input.crossfade === true || input.storm === true;
  return {
    direction,
    mode: crossfade ? "crossfade" : "narrative",
    duration: crossfade ? WORKS_FACE_TRANSITION.crossfade : WORKS_FACE_TRANSITION[direction]
  };
}

/* ── 势场 / 等势线（marching squares） ───────────────────── */

/** 叠加势场高度（高斯势阱求和；等势线、ASCII、网格位移共用）。 */
export function fieldHeightAt(wells, x, y) {
  let h = 0;
  for (const w of Array.isArray(wells) ? wells : []) {
    const dx = x - w.x;
    const dy = y - w.y;
    const r = Number(w.r) > 1 ? Number(w.r) : 1;
    h += (Number(w.s) || 0) * Math.exp(-(dx * dx + dy * dy) / (r * r));
  }
  return h;
}

const CONTOUR_LEVELS = Object.freeze([0.16, 0.34, 0.55]);
const CONTOUR_ALPHAS = Object.freeze([0.10, 0.15, 0.22]);

/**
 * 等势线采样 + marching squares：以**叠加势场**刻画形貌（多焦点邻近处鞍部涌现，
 * MUST NOT 逐焦点独立贴环）。返回分段线段（纯数据，便于缓存与冒烟断言）。
 * @param {Array<{x:number,y:number,s:number,r:number}>} wells
 * @param {number} width
 * @param {number} height
 * @param {{cell?: number, levels?: number[]}} [options]
 */
export function contourSegmentsOf(wells, width, height, options = {}) {
  const W = Math.max(1, Number(width) || 1);
  const H = Math.max(1, Number(height) || 1);
  const u = Math.min(W, H) / 900;
  const cell = Math.max(20, Number(options.cell) || 25 * Math.max(0.7, u));
  const cols = Math.max(1, Math.ceil(W / cell));
  const rows = Math.max(1, Math.ceil(H / cell));
  const values = new Float64Array((cols + 1) * (rows + 1));
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      values[j * (cols + 1) + i] = fieldHeightAt(wells, i * cell, j * cell);
    }
  }
  const levels = Array.isArray(options.levels) && options.levels.length
    ? options.levels
    : CONTOUR_LEVELS;
  const out = [];
  const at = (i, j) => values[j * (cols + 1) + i];
  for (let lv = 0; lv < levels.length; lv++) {
    const iso = levels[lv];
    const alpha = CONTOUR_ALPHAS[lv] ?? 0.15;
    const segments = [];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const v0 = at(i, j);
        const v1 = at(i + 1, j);
        const v2 = at(i + 1, j + 1);
        const v3 = at(i, j + 1);
        const idx = (v0 > iso ? 8 : 0) | (v1 > iso ? 4 : 0) | (v2 > iso ? 2 : 0) | (v3 > iso ? 1 : 0);
        if (idx === 0 || idx === 15) continue;
        const x0 = i * cell;
        const y0 = j * cell;
        const ip = (a, b) => (iso - a) / ((b - a) || 1e-9);
        const tp = { x: x0 + cell * ip(v0, v1), y: y0 };
        const rp = { x: x0 + cell, y: y0 + cell * ip(v1, v2) };
        const bp = { x: x0 + cell * ip(v3, v2), y: y0 + cell };
        const lp = { x: x0, y: y0 + cell * ip(v0, v3) };
        const seg = (a, b) => segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
        switch (idx) {
          case 1: seg(lp, bp); break;
          case 2: seg(bp, rp); break;
          case 3: seg(lp, rp); break;
          case 4: seg(tp, rp); break;
          case 5: seg(lp, tp); seg(bp, rp); break;
          case 6: seg(tp, bp); break;
          case 7: seg(lp, tp); break;
          case 8: seg(lp, tp); break;
          case 9: seg(tp, bp); break;
          case 10: seg(lp, bp); seg(tp, rp); break;
          case 11: seg(tp, rp); break;
          case 12: seg(lp, rp); break;
          case 13: seg(bp, rp); break;
          case 14: seg(lp, bp); break;
          default: break;
        }
      }
    }
    out.push({ iso, alpha, segments });
  }
  return { cell, cols, rows, levels: out };
}

/* ── ASCII 底纹（势场深度 → 字符坡 + 慢掷数据脉冲） ───────── */

/**
 * ASCII 单元格（纯函数）：返回 null = 空白；`pulse` 为确定性掷点（0..1）。
 * 势阱附近字符渐密，远离势阱趋于空白；数据脉冲偶发亮字符（非连续闪烁）。
 */
export function asciiCellOf(depth, pulse) {
  const d = clamp(Number(depth) || 0, 0, 1);
  const p = clamp(Number(pulse) || 0, 0, 1);
  if (p > 0.965) return { char: WORKS_ASCII_RAMP[WORKS_ASCII_RAMP.length - 1], alpha: 0.13, pulse: true };
  if (d < 0.05 && p < 0.55) return null;
  const idx = Math.max(1, Math.min(WORKS_ASCII_RAMP.length - 1,
    Math.floor((d * 0.8 + p * 0.25) * WORKS_ASCII_RAMP.length)));
  return { char: WORKS_ASCII_RAMP[idx], alpha: 0.035 + d * 0.055, pulse: false };
}

/* ── 转场粒子（确定性可重放） ───────────────────────────── */

/**
 * 粒子汇聚初始化（toMatter）：每焦点 ~26 颗（携带该焦点类型色）+ 涨落海全场 ~110 颗
 * （携带场色）。目标在绘制时按**实时**位置解析（`gatherParticleAt`），故这里只存目标序号。
 * @param {{focuses: Array<object>, targets: Array<object>, seed: number, width: number,
 *          height: number, perFocus?: number, fieldCount?: number, fieldColor?: string}} input
 */
export function buildGatherParticles(input = {}) {
  const focuses = Array.isArray(input.focuses) ? input.focuses : [];
  const targets = Array.isArray(input.targets) ? input.targets : [];
  const W = Number(input.width) > 0 ? Number(input.width) : 1280;
  const H = Number(input.height) > 0 ? Number(input.height) : 720;
  const perFocus = Number.isFinite(input.perFocus) ? Math.max(0, Math.round(input.perFocus)) : 26;
  const fieldCount = Number.isFinite(input.fieldCount) ? Math.max(0, Math.round(input.fieldCount)) : 110;
  const fieldColor = hexOf(input.fieldColor) || "#aac0f0";
  const rnd = worksRng(Number(input.seed) >>> 0 || 1);
  const parts = [];
  const targetCount = targets.length;
  const pickTarget = () => (targetCount ? Math.floor(rnd() * targetCount) : -1);
  for (const f of focuses) {
    if (!f || f.s <= 0.05) continue;
    const c0 = hexOf(f.color) || fieldColor;
    for (let i = 0; i < perFocus; i++) {
      const tIdx = pickTarget();
      parts.push({
        sx: f.sx + (rnd() - 0.5) * 18,
        sy: f.sy + (rnd() - 0.5) * 18,
        targetIndex: tIdx,
        delay: rnd() * 0.3,
        dur: 1 + rnd() * 0.7,
        swirl: (rnd() < 0.5 ? 1 : -1) * (26 + rnd() * 46),
        c0,
        c1: targetCount ? (hexOf(targets[tIdx]?.color) || fieldColor) : fieldColor,
        size: 2.2 + rnd() * 1.6,
        seed: Math.floor(rnd() * 1e6),
        arrived: false
      });
    }
  }
  for (let j = 0; j < fieldCount; j++) {
    const tIdx = pickTarget();
    parts.push({
      sx: rnd() * W,
      sy: rnd() * H,
      targetIndex: tIdx,
      delay: rnd() * 0.42,
      dur: 1.1 + rnd() * 0.8,
      swirl: (rnd() < 0.5 ? 1 : -1) * (30 + rnd() * 60),
      c0: fieldColor,
      c1: targetCount ? (hexOf(targets[tIdx]?.color) || fieldColor) : fieldColor,
      size: 1.6 + rnd() * 1.4,
      seed: Math.floor(rnd() * 1e6),
      arrived: false
    });
  }
  return parts;
}

/**
 * 粒子位置与混色（纯函数）：直线插值 + 垂向正弦旋摆（渐收），颜色由场色渐变为目标色。
 * @param {object} part `buildGatherParticles` 产出
 * @param {number} elapsed 转场已播秒数
 * @param {{x:number,y:number,color?:string}} target 目标实时屏幕位置
 */
export function gatherParticleAt(part, elapsed, target) {
  const p = part || {};
  const tx = Number(target?.x) || 0;
  const ty = Number(target?.y) || 0;
  const q = clamp((Number(elapsed) - (Number(p.delay) || 0)) / Math.max(0.05, Number(p.dur) || 1), 0, 1);
  const k = easeInOut(q);
  const dx = tx - (Number(p.sx) || 0);
  const dy = ty - (Number(p.sy) || 0);
  const len = Math.hypot(dx, dy) || 1;
  const amp = Math.sin(q * Math.PI) * (Number(p.swirl) || 0);
  return {
    x: (Number(p.sx) || 0) + dx * k + (-dy / len) * amp,
    y: (Number(p.sy) || 0) + dy * k + (dx / len) * amp,
    k,
    q,
    color: worksMixHex(p.c0, target?.color || p.c1, k)
  };
}

/* ── 皮肤取色（焦点色温分拣 + 场域通道） ─────────────────── */

/** 焦点色：可执行恒暖金、文档恒冷色系（跨皮肤可辨；缺失去饱和）。 */
export function focusColorOf(kind, missing, palette) {
  const pal = palette || {};
  if (missing) return pal.missing || "#8a93b8";
  return pal[kind] || pal.other || "#a8b8d8";
}

/* ── 渲染核（createWorksFace） ─────────────────────────── */

/**
 * 星场渲染核。
 *
 * host 契约（引擎注入；只读、不得反向调用引擎内部）：
 * - `size()` → `{width, height, dpr}`
 * - `time()` → 秒（页面可见才推进；页签冻结由引擎渲染节能保证）
 * - `skin()` → `{palette: {prop,sess}, gold, light}`
 * - `scene()` / `focusWs()` → 引擎场景与当前钻取星座
 * - `activity()` → `"active"|"sleep"`（星座活力存在口径）
 * - `options()` → `{contours, ascii}`
 * - `project(worldPos)` → `{x,y}|null`（天体曲率足迹；视口外 null = 剔除）
 *
 * @param {object} host
 */
export function createWorksFace(host) {
  const H = host && typeof host === "object" ? host : {};
  const state = {
    focuses: [],
    layout: new Map(),
    layoutSig: "",
    hoverId: null,
    hoverAt: 0,
    /* 触屏长按呈现态（add-cosmos-focus-touch-activate D5）：引擎写入（holdBegin /
       holdUpdate / holdEnd），渲染核只读并绘制进度环 + 触水涟漪。
       `{ id, k, t0, emitAt, fadeT0 }`——fadeT0 非空 = 快退中（retreat 后清空）。 */
    hold: null,
    vacancyK: 0,
    u: 1,
    W: 0,
    H: 0,
    Wdpr: 1,
    foam: null,
    foamCount: 0,
    beads: [],
    effects: { ripples: [], sparks: [], spirals: [] },
    emissions: [],
    trans: null,
    gridCache: null,
    contourCache: null,
    asciiCache: null,
    asciiAt: -9,
    asciiDirty: true,
    off: { layer: null, mask: null, crest: null },
    stats: { gridBuilds: 0, contourBuilds: 0, asciiBuilds: 0, particleBuilds: 0, maskBuilds: 0, layoutBuilds: 0, draws: 0 },
    sparkPool: 0
  };

  /* ── 基础读取 ── */

  function sizeOf() {
    const raw = typeof H.size === "function" ? H.size() : null;
    const width = Math.max(1, Number(raw?.width) || 1);
    const height = Math.max(1, Number(raw?.height) || 1);
    const dpr = Math.max(1, Number(raw?.dpr) || 1);
    return { width, height, dpr };
  }

  function timeOf() { return typeof H.time === "function" ? Number(H.time()) || 0 : 0; }

  function paletteOf() {
    const skin = typeof H.skin === "function" ? H.skin() : {};
    const pal = skin?.palette && typeof skin.palette === "object" ? skin.palette : {};
    const prop = pal.prop && typeof pal.prop === "object" ? pal.prop : {};
    const sess = pal.sess && typeof pal.sess === "object" ? pal.sess : {};
    const gold = hexOf(skin?.gold) || hexOf(prop.executed) || "#ffd28a";
    return {
      light: skin?.light === true,
      additive: skin?.light !== true,
      gold,
      /* accent 通道（add-cosmos-focus-touch-activate D5）：长按进度环/触水涟漪取色，
         与 HUD `--cos-accent` 同源（注册表自 `base.accent` 单点派生）；缺省回落金色。 */
      accent: hexOf(pal.accent) || gold,
      exec: hexOf(prop.executed) || gold,
      html: hexOf(sess.free) || hexOf(prop.reviewed) || "#8fe8ef",
      md: hexOf(prop.created) || "#9fd8ff",
      pdf: hexOf(prop.reviewed) || sess.idle || "#c9a7ff",
      other: hexOf(sess.idle) || "#a8b8d8",
      missing: hexOf(sess.idle) || "#8a93b8",
      grid: hexOf(prop.created) || "#8ca2e0",
      contour: hexOf(sess.free) || "#96c6ff",
      foam: hexOf(sess.idle) || "#acc0f0",
      crest: hexOf(prop.executed) || gold
    };
  }

  function optionsOf() {
    const opts = typeof H.options === "function" ? H.options() : null;
    return { contours: opts?.contours !== false, ascii: opts?.ascii !== false };
  }

  function activityOf() {
    return typeof H.activity === "function" && H.activity() === "active" ? "active" : "sleep";
  }

  /** 渲染风暴态（引擎调度积压探测）：降级矩阵的唯一判据（转场交叉淡变 / 涟漪停发 / 流珠冻结）。 */
  function stormNow() {
    return typeof H.storm === "function" && H.storm() === true;
  }

  

  /* ── 焦点同步 ── */

  function makeFocus(item, t, birthIndex) {
    const phase = (worksHashOf(item.id) % 1000) / 1000 * TAU;
    return {
      id: item.id,
      relPath: item.relPath,
      kind: item.kind,
      shape: WORKS_FOCUS_SHAPE[item.kind] || WORKS_FOCUS_SHAPE.other,
      name: item.name,
      alias: item.alias ?? item.name ?? null,
      note: item.note,
      displayName: item.displayName,
      exists: item.exists,
      addedAt: item.addedAt,
      lastLaunchedAt: item.lastLaunchedAt,
      hasLastLaunched: item.hasLastLaunched,
      phase,
      s: 0,
      sT: 1,
      bright: 0,
      dying: false,
      dieAt: 0,
      emitAt: t + ((worksHashOf(item.id) % 240) / 100) + (birthIndex || 0) * 0.13,
      sx: 0,
      sy: 0
    };
  }

  function addRipple(x, y, invert, delay) {
    const fx = state.effects;
    if (fx.ripples.length > 40) fx.ripples.shift();
    const t = timeOf();
    fx.ripples.push({ x, y, t0: t + (Number(delay) || 0), dur: 0.85, invert: invert === true });
  }

  function addSparks(x, y, n) {
    const fx = state.effects;
    const t = timeOf();
    const rnd = worksRng(worksHashOf("spark:" + Math.round(x) + ":" + Math.round(y) + ":" + Math.round(t * 1000)));
    for (let i = 0; i < n && fx.sparks.length < 220; i++) {
      const a = rnd() * TAU;
      const v = 30 + rnd() * 90;
      fx.sparks.push({
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v * 0.7,
        t0: t + rnd() * 0.12,
        life: 0.5 + rnd() * 0.5
      });
    }
  }

  function addSpiral(x, y) {
    const fx = state.effects;
    const t = timeOf();
    const rnd = worksRng(worksHashOf("spiral:" + Math.round(x) + ":" + Math.round(y)));
    for (let i = 0; i < 22 && fx.spirals.length < 260; i++) {
      fx.spirals.push({
        x, y,
        a0: rnd() * TAU,
        r0: 46 + rnd() * 34,
        w: (1.6 + rnd() * 1.6) * (rnd() < 0.5 ? 1 : -1),
        t0: t + rnd() * 0.25,
        dur: 0.75 + rnd() * 0.35
      });
    }
  }

  /**
   * 焦点辐射涟漪发射（既有发射机；add-cosmos-focus-touch-activate 2.1 起长按复用同一
   * 通道——**不新增绘制体系**）。
   * @param {number} x
   * @param {number} y
   * @param {boolean} strong 强涟漪（hover/激发）；false = 环境稳态弱涟漪
   * @param {string|null} color 缺省回落皮肤 contour 通道
   * @param {{a0?:number,maxR?:number,dur?:number}} [opts] 包络覆写（hold 专属细环）
   */
  function pushEmission(x, y, strong, color, opts) {
    if (state.emissions.length > 30) state.emissions.shift();
    const o = opts && typeof opts === "object" ? opts : null;
    state.emissions.push({
      x, y,
      t0: timeOf(),
      dur: Number(o?.dur) > 0 ? Number(o.dur) : (strong ? 1.1 : 1.5),
      maxR: Number(o?.maxR) > 0
        ? Number(o.maxR)
        : (strong ? 130 : 78 + 26 * ((worksHashOf(x + ":" + y) % 1000) / 1000)),
      a0: Number(o?.a0) > 0 ? Number(o.a0) : (strong ? 0.34 : 0.16),
      color: color || null
    });
  }

  /* ── 触屏长按（add-cosmos-focus-touch-activate D5）：呈现态写入 + 动效 ── */

  /** 一道 hold 触水细环（steam 包络：细、alpha 随半径衰减、取 accent 通道）。 */
  function emitHoldRipple(id) {
    if (stormNow()) return false;
    const f = focusById(id);
    if (!f) return false;
    pushEmission(f.sx, f.sy, false, paletteOf().accent, {
      a0: WORKS_HOLD.ringAlpha,
      maxR: WORKS_HOLD.ringMaxR * state.u,
      dur: WORKS_HOLD.ringDur
    });
    return true;
  }

  /** 长按起步（引擎 pointerdown 命中焦点时调用）：建立呈现态 + 首道触水涟漪。 */
  function holdBegin(id) {
    const f = focusById(id);
    if (!f) return false;
    const t = timeOf();
    const step = WORKS_HOLD.ringPeriod / WORKS_HOLD.ringsPerPeriod;
    state.hold = { id, k: 0, t0: t, emitAt: t + step, fadeT0: null };
    emitHoldRipple(id); // 按下即一道（阈值前 2 秒内保持约 2–3 道同心环在场）
    return true;
  }

  /** 长按帧推进（引擎每帧写入进度 k）：涟漪按周期补发；风暴降级停发（进度环保留）。 */
  function holdUpdate(k) {
    const hold = state.hold;
    if (!hold || hold.fadeT0 != null) return false;
    hold.k = clamp(Number(k) || 0, 0, 1);
    if (stormNow()) { hold.emitAt = timeOf(); return false; } // 不积压：恢复后自当前时刻重新起拍
    const t = timeOf();
    const step = WORKS_HOLD.ringPeriod / WORKS_HOLD.ringsPerPeriod;
    let guard = 0;
    while (t >= hold.emitAt && guard < 8) {
      emitHoldRipple(hold.id);
      hold.emitAt += step;
      guard += 1;
    }
    if (guard >= 8) hold.emitAt = t + step; // 长冻结后不补发满屏历史环
    return true;
  }

  /**
   * 长按结束（取消 / 已激发）：停止补发、进入 `retreat` 快退（进度环 alpha 线性归零）。
   * 引擎侧状态机与呈现态解耦——快退播完由 `update` 回收（无残帧）。
   */
  function holdEnd() {
    const hold = state.hold;
    if (!hold) return false;
    if (hold.fadeT0 == null) hold.fadeT0 = timeOf();
    hold.emitAt = Infinity;
    return true;
  }

  /** 当前 hold 呈现视图（目标焦点 + 未完成快退才返回；进度环与 alpha 的唯一读取点）。 */
  function holdViewOf(id) {
    const hold = state.hold;
    if (!hold || hold.id !== id) return null;
    let alpha = 1;
    if (hold.fadeT0 != null) {
      const p = (timeOf() - hold.fadeT0) / WORKS_HOLD.retreat;
      if (p >= 1) return null;
      alpha = clamp(1 - p, 0, 1);
    }
    return { k: clamp(hold.k, 0, 1), alpha };
  }

  /**
   * works 快照 → 焦点集合**属性级补丁**（tasks 1.1 / 5.1）：
   * 新增 → 凝聚入场；移除 → 蒸发淡出；改名/备注/失谐就地更新；lastLaunchedAt 前进 →
   * 余辉重放。存量槽位零位移（增量布位）。
   * @param {Array<object>} entries
   */
  function setWorks(entries) {
    const t = timeOf();
    const incoming = worksFocusListOf(entries);
    const incomingIds = new Set(incoming.map((f) => f.id));
    const prev = state.focuses;
    const byId = new Map(prev.map((f) => [f.id, f]));
    /* 蒸发中的焦点保留原位（layout 在重建时会被 incoming 过滤掉，需显式回收槽位）。 */
    const dyingKeep = new Map();
    for (const f of prev) {
      if (f.dying) {
        if (state.layout.has(f.id)) dyingKeep.set(f.id, state.layout.get(f.id));
        continue;
      }
      if (!incomingIds.has(f.id)) {
        f.dying = true;
        f.sT = 0;
        f.dieAt = t;
        if (state.hoverId === f.id) state.hoverId = null;
        addRipple(f.sx, f.sy, true, 0);
        addSparks(f.sx, f.sy, 10);
        if (state.layout.has(f.id)) dyingKeep.set(f.id, state.layout.get(f.id));
      }
    }

    const added = [];
    const live = [];
    for (const item of incoming) {
      const existing = byId.get(item.id);
      if (!existing) {
        const fresh = makeFocus(item, t, added.length);
        added.push(fresh);
        live.push(fresh);
        continue;
      }
      const launched = item.lastLaunchedAt > existing.lastLaunchedAt;
      existing.relPath = item.relPath;
      existing.kind = item.kind;
      existing.shape = WORKS_FOCUS_SHAPE[item.kind] || WORKS_FOCUS_SHAPE.other;
      existing.name = item.name;
      existing.alias = item.alias ?? item.name ?? null;
      existing.note = item.note;
      existing.displayName = item.displayName;
      existing.exists = item.exists;
      existing.addedAt = item.addedAt;
      existing.lastLaunchedAt = item.lastLaunchedAt;
      existing.hasLastLaunched = item.hasLastLaunched;
      if (existing.dying) {
        existing.dying = false;
        existing.sT = 1;
      }
      if (launched) {
        existing.bright = 1;
        addRipple(existing.sx, existing.sy, false, 0);
        pushEmission(existing.sx, existing.sy, true, null);
      }
      live.push(existing);
    }
    state.focuses = prev.filter((f) => f.dying).concat(live);

    // 增量布位：存量槽位锁定，只为新 id 落位；蒸发中的焦点保留原槽位。
    const fixed = new Map();
    for (const f of live) {
      if (state.layout.has(f.id)) fixed.set(f.id, state.layout.get(f.id));
    }
    state.layout = placeWorksIncremental(incoming, fixed);
    for (const [id, p] of dyingKeep) {
      if (!state.layout.has(id)) state.layout.set(id, p);
    }
    state.layoutSig = worksSignatureOf(incoming);
    state.stats.layoutBuilds += 1;
    syncScreens();
    // 新焦点定位后再生成凝聚特效（避免特效落在 (0,0)）。
    for (const f of added) {
      addSpiral(f.sx, f.sy);
      addRipple(f.sx, f.sy, false, 0.55);
    }
  }

  /** 蒸发入口（移除请求一发出即播放；快照对账失败会由 setWorks 复位 dying）。 */
  function beginEvaporate(id) {
    const f = state.focuses.find((x) => x.id === id);
    if (!f || f.dying) return false;
    f.dying = true;
    f.sT = 0;
    f.dieAt = timeOf();
    addRipple(f.sx, f.sy, true, 0);
    addSparks(f.sx, f.sy, 8);
    return true;
  }

  function focusById(id) { return state.focuses.find((f) => f.id === id) || null; }
  function liveFocuses() { return state.focuses.filter((f) => !f.dying); }
  function count() { return liveFocuses().length; }

  function screenFor(f) {
    const p = state.layout.get(f.id) || { x: 0.5, y: 0.5 };
    const W = state.W;
    const Hh = state.H;
    const mx = Math.max(46, W * 0.085);
    const mt = Math.max(72, Hh * 0.11);
    const mb = Math.max(100, Hh * 0.15);
    return {
      x: mx + p.x * Math.max(1, W - mx * 2),
      y: mt + p.y * Math.max(1, Hh - mt - mb)
    };
  }

  function syncScreens() {
    const s = sizeOf();
    state.W = s.width;
    state.H = s.height;
    state.Wdpr = s.dpr;
    state.u = Math.max(0.55, Math.min(s.width, s.height) / 900);
    for (const f of state.focuses) {
      const p = screenFor(f);
      f.sx = p.x;
      f.sy = p.y;
    }
  }

  /* ── 势场 ── */

  function wellsOf(t) {
    const u = state.u;
    const wells = [];
    const live = liveFocuses();
    if (!live.length) wells.push({ x: state.W / 2, y: (state.H * 0.55), s: 0.3, r: 120 * u });
    for (const f of state.focuses) {
      if (f.s <= 0.02) continue;
      const breath = 0.9 + 0.1 * Math.sin(t * 0.6 + f.phase);
      wells.push({ x: f.sx, y: f.sy, s: 0.95 * f.s * breath, r: 105 * u });
    }
    const ws = typeof H.focusWs === "function" ? H.focusWs() : null;
    const project = typeof H.project === "function" ? H.project : null;
    if (ws && project) {
      for (const st of ws.stars || []) {
        const p = project(st.wp);
        if (!p) continue;
        wells.push({ x: p.x, y: p.y, s: st.lifecycle === "proto" ? 0.16 : 0.34, r: 150 * u });
      }
      for (const pl of ws.planets || []) {
        const p = project(pl.wp);
        if (!p) continue;
        wells.push({ x: p.x, y: p.y, s: 0.18, r: 110 * u });
      }
      for (const cm of ws.comets || []) {
        const p = project(cm.wp);
        if (!p) continue;
        wells.push({ x: p.x, y: p.y, s: 0.14, r: 100 * u });
      }
      if ((ws.archives || 0) > 0) {
        const h = worksHashOf(ws.id || "");
        const cx = state.W * (0.62 + ((h % 17) / 100));
        const cy = state.H * (0.58 + (((h >> 5) % 15) / 100));
        wells.push({ x: cx, y: cy, s: 0.42, r: 300 * u });
      }
    }
    return wells;
  }

  /* ── 场域元素（泡沫 / 流珠） ── */

  function ensureAmbient() {
    const W = state.W;
    const Hh = state.H;
    if (state.foam && state.foam.length) {
      if (state.foamW === W && state.foamH === Hh) return;
      const kx = W / Math.max(1, state.foamW);
      const ky = Hh / Math.max(1, state.foamH);
      for (const p of state.foam) { p.x *= kx; p.y *= ky; }
      for (const b of state.beads) {
        b.line *= (b.axis === "h" ? ky : kx);
        b.pos *= (b.axis === "h" ? kx : ky);
      }
      state.foamW = W; state.foamH = Hh;
      return;
    }
    const rnd = worksRng(worksHashOf("foam"));
    const foam = [];
    for (let i = 0; i < 170; i++) {
      foam.push({
        x: rnd() * W,
        y: rnd() * Hh,
        phase: rnd() * TAU,
        fq: 0.6 + rnd() * 1.6,
        size: 0.8 + rnd() * 1.1,
        alpha: 0.5 + rnd() * 0.5
      });
    }
    state.foam = foam;
    state.foamW = W;
    state.foamH = Hh;
    const u = state.u;
    const step = Math.max(30, 34 * u);
    const rb = worksRng(worksHashOf("beads"));
    const beads = [];
    for (let b = 0; b < 90; b++) {
      const axis = rb() < 0.5 ? "h" : "v";
      const span = axis === "h" ? Hh : W;
      beads.push({
        axis,
        line: step * 0.5 + Math.floor(rb() * (span / step)) * step,
        pos: rb() * (axis === "h" ? W : Hh),
        speed: 16 + rb() * 26,
        size: 1.1 + rb() * 0.9,
        alpha: 0.35 + rb() * 0.45,
        phase: rb() * TAU,
        dir: rb() < 0.5 ? 1 : -1
      });
    }
    state.beads = beads;
  }

  function nearestSink(x, y, live) {
    let sink = null;
    let best = Infinity;
    for (const f of live) {
      if (f.s < 0.2) continue;
      const d = (f.sx - x) * (f.sx - x) + (f.sy - y) * (f.sy - y);
      if (d < best) { best = d; sink = f; }
    }
    return sink ? { x: sink.sx, y: sink.sy } : null;
  }

  /* ── 缓存：网格 / 等势线 / ASCII ── */

  function phaseBucket(t) { return Math.floor(t * 10); }

  function gridKeyOf(wells) {
    return state.layoutSig + "|" + Math.round(state.W) + "x" + Math.round(state.H) + "|" + phaseBucket(timeOf()) + "|" + wells.length;
  }

  function buildGrid(wells) {
    const u = state.u;
    const step = Math.max(30, 34 * u);
    const seg = Math.max(14, 17 * u);
    const W = state.W;
    const Hh = state.H;
    const cap = 15 * u;
    const disp = (x, y) => {
      let dx = 0;
      let dy = 0;
      for (const w of wells) {
        const ddx = w.x - x;
        const ddy = w.y - y;
        const d = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
        const k = w.s * 30 * u * Math.exp(-(ddx * ddx + ddy * ddy) / (w.r * w.r));
        dx += (ddx / d) * k;
        dy += (ddy / d) * k;
      }
      const m = Math.sqrt(dx * dx + dy * dy);
      if (m > cap) { dx = dx / m * cap; dy = dy / m * cap; }
      return { x: x + dx, y: y + dy };
    };
    const hLines = [];
    for (let y = step * 0.5; y < Hh; y += step) {
      const pts = [];
      for (let x = 0; x <= W + seg; x += seg) {
        const p = disp(Math.min(x, W), y);
        pts.push(p.x, p.y);
      }
      hLines.push(pts);
    }
    const vLines = [];
    for (let x = step * 0.5; x < W; x += step) {
      const pts = [];
      for (let y = 0; y <= Hh + seg; y += seg) {
        const p = disp(x, Math.min(y, Hh));
        pts.push(p.x, p.y);
      }
      vLines.push(pts);
    }
    const key = gridKeyOf(wells);
    state.gridCache = { key, step, seg, hLines, vLines, lines: hLines.concat(vLines) };
    state.stats.gridBuilds += 1;
    return state.gridCache;
  }

  function ensureGrid(wells) {
    const key = gridKeyOf(wells);
    if (state.gridCache && state.gridCache.key === key) return state.gridCache;
    return buildGrid(wells);
  }

  function ensureContours(wells) {
    const key = state.layoutSig + "|" + Math.round(state.W) + "x" + Math.round(state.H) + "|" + phaseBucket(timeOf()) + "|" + wells.length;
    if (state.contourCache && state.contourCache.key === key) return state.contourCache;
    const built = contourSegmentsOf(wells, state.W, state.H, { cell: Math.max(22, 25 * state.u) });
    state.contourCache = { key, data: built };
    state.stats.contourBuilds += 1;
    return state.contourCache;
  }

  function ensureAsciiCanvas() {
    const W = Math.max(1, Math.round(state.W));
    const Hh = Math.max(1, Math.round(state.H));
    if (state.asciiCache && state.asciiCache.w === W && state.asciiCache.h === Hh) return state.asciiCache;
    let canvas = null;
    try {
      if (typeof document !== "undefined" && typeof document.createElement === "function") {
        canvas = document.createElement("canvas");
        canvas.width = W;
        canvas.height = Hh;
        if (typeof canvas.getContext !== "function") canvas = null;
      }
    } catch { canvas = null; }
    if (!canvas) { state.asciiCache = null; return null; }
    let ctx = null;
    try { ctx = canvas.getContext("2d"); } catch { ctx = null; }
    if (!ctx) { state.asciiCache = null; return null; }
    state.asciiCache = { canvas, ctx, w: W, h: Hh };
    state.asciiAt = -9;
    return state.asciiCache;
  }

  function renderAscii(wells) {
    const cache = ensureAsciiCanvas();
    if (!cache) return;
    const g = cache.ctx;
    g.clearRect(0, 0, state.W, state.H);
    const cell = 30;
    const cols = Math.ceil(state.W / cell);
    const rows = Math.ceil(state.H / cell);
    try {
      g.font = '11px Consolas,"Courier New",monospace';
      g.textAlign = "center";
      g.textBaseline = "middle";
    } catch { /* 假 ctx 容错 */ }
    const tick = Math.floor(timeOf() / 1.1);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const x = (i + 0.5) * cell;
        const y = (j + 0.5) * cell;
        const h = fieldHeightAt(wells, x, y);
        const depth = clamp((h - 0.04) / 0.42, 0, 1);
        const pulse = ((Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(tick, 1274126177)) >>> 0) / 4294967296;
        const cellSpec = asciiCellOf(depth, pulse);
        if (!cellSpec) continue;
        g.fillStyle = "rgba(150,170,215," + cellSpec.alpha.toFixed(3) + ")";
        g.fillText(cellSpec.char, x, y);
      }
    }
    state.asciiAt = timeOf();
    state.asciiDirty = false;
    state.stats.asciiBuilds += 1;
  }

  /* ── 特效更新 ── */

  function updateEffects(t, dt) {
    const fx = state.effects;
    fx.ripples = fx.ripples.filter((r) => t - r.t0 < r.dur);
    fx.sparks = fx.sparks.filter((s) => t - s.t0 < s.life);
    fx.spirals = fx.spirals.filter((s) => t - s.t0 < s.dur);
    state.emissions = state.emissions.filter((e) => t - e.t0 < e.dur);
    if (stormNow()) { void dt; return; }
    const live = liveFocuses();
    for (const f of live) {
      if (f.s < 0.3) continue;
      if (!f.emitAt) f.emitAt = t + (worksHashOf(f.id) % 240) / 100;
      if (t >= f.emitAt) {
        pushEmission(f.sx, f.sy, false, null);
        f.emitAt = t + 2.5 + ((worksHashOf(f.id) % 1500) / 1000);
      }
    }
    void dt;
  }

  /* ── 主更新（每帧一次；视觉状态收敛与蒸发收尾） ── */

  function update(dt) {
    const t = timeOf();
    syncScreens();
    ensureAmbient();
    const live = liveFocuses();
    const active = activityOf() === "active";
    const targetCount = active ? 130 : 55;
    state.foamCount += (targetCount - state.foamCount) * Math.min(1, dt * 0.9);
    for (const f of state.focuses) {
      f.s += (f.sT - f.s) * Math.min(1, dt * 3.4);
      if (f.bright > 0) f.bright = Math.max(0, f.bright - dt / 3.5);
    }
    const before = state.focuses.length;
    state.focuses = state.focuses.filter((f) => !(f.dying && f.s < 0.03));
    if (state.focuses.length !== before) {
      for (const f of state.focuses) {
        if (f.dying) continue;
        if (!state.layout.has(f.id)) state.layout.set(f.id, { x: 0.5, y: 0.5 });
      }
      for (const id of Array.from(state.layout.keys())) {
        if (!state.focuses.some((f) => f.id === id)) state.layout.delete(id);
      }
    }
    state.vacancyK += ((live.length ? 0 : 1) - state.vacancyK) * Math.min(1, dt * 2.4);
    updateEffects(t, dt);
    /* 长按快退收尾（add-cosmos-focus-touch-activate 2.3）：retreat 播完即清呈现态。 */
    if (state.hold && state.hold.fadeT0 != null && t - state.hold.fadeT0 >= WORKS_HOLD.retreat) {
      state.hold = null;
    }
    // 泡沫/流珠漂移（入阱回收；活跃度只改"可绘前缀"数量 → 存量零跳变）。
    const sinks = live.length ? live : null;
    const sinkCount = Math.max(0, Math.min(state.foam.length, Math.round(state.foamCount)));
    for (let i = 0; i < sinkCount; i++) {
      const p = state.foam[i];
      const sink = sinks ? nearestSink(p.x, p.y, sinks) : null;
      if (sink) {
        const dx = sink.x - p.x;
        const dy = sink.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        const sp = 10 + 6 * Math.sin(t * 0.7 + p.phase);
        p.x += (dx / d) * sp * dt;
        p.y += (dy / d) * sp * dt;
        if (d < 26) {
          // 入阱回收：按「粒子序号 + 时间桶」确定性重掷，MUST NOT 用 Math.random。
          const rnd = worksRng(worksHashOf("foam:" + i + ":" + Math.round(t * 10)));
          p.x = rnd() * state.W;
          p.y = rnd() * state.H;
        }
      }
      p.x += Math.sin(t * p.fq * 0.5 + p.phase) * 0.12;
      p.y += Math.cos(t * p.fq * 0.4 + p.phase) * 0.12;
      if (p.x < -8) p.x = state.W + 8;
      if (p.x > state.W + 8) p.x = -8;
      if (p.y < -8) p.y = state.H + 8;
      if (p.y > state.H + 8) p.y = -8;
    }
    if (!stormNow()) for (const b of state.beads) {
      const sink = sinks ? nearestSink(b.axis === "h" ? b.pos : b.line, b.axis === "h" ? b.line : b.pos, sinks) : null;
      const tc = sink ? (b.axis === "h" ? sink.x : sink.y) : (b.axis === "h" ? state.W / 2 : state.H / 2);
      b.dir = tc > b.pos ? 1 : -1;
      b.pos += b.dir * b.speed * dt;
      const span = b.axis === "h" ? state.W : state.H;
      if (b.pos < -20 || b.pos > span + 20) b.pos = b.dir > 0 ? -10 : span + 10;
    }
    // 转场推进（时基冻结由引擎 start/stop 保证；此处只累计已播时长）。
    if (state.trans) {
      const elapsed = t - state.trans.t0;
      if (elapsed >= state.trans.duration) state.trans.done = true;
    }
  }

  /* ── 绘制：公用图元 ── */

  const glowCache = new Map();

  function glowSprite(color, light) {
    const key = color + (light ? ":light" : ":lighter");
    if (glowCache.has(key)) return glowCache.get(key);
    let sprite = null;
    try {
      if (typeof document !== "undefined" && typeof document.createElement === "function") {
        const c = document.createElement("canvas");
        c.width = 64;
        c.height = 64;
        const g = typeof c.getContext === "function" ? c.getContext("2d") : null;
        if (g) {
          const gr = typeof g.createRadialGradient === "function"
            ? g.createRadialGradient(32, 32, 0, 32, 32, 32)
            : null;
          if (gr && typeof gr.addColorStop === "function") {
            gr.addColorStop(0, worksRgba(color, 0.95));
            gr.addColorStop(0.3, worksRgba(color, 0.22));
            gr.addColorStop(1, "rgba(0,0,0,0)");
            g.fillStyle = gr;
            g.fillRect(0, 0, 64, 64);
            sprite = c;
          }
        }
      }
    } catch { sprite = null; }
    glowCache.set(key, sprite);
    return sprite;
  }

  function drawGlow(ctx, color, x, y, radius, alpha, pal) {
    if (!(radius > 1) || !(alpha > 0.01)) return;
    const sprite = glowSprite(color, pal.light);
    ctx.save();
    ctx.globalAlpha = clamp(alpha, 0, 1);
    if (pal.additive) ctx.globalCompositeOperation = "lighter";
    else ctx.globalCompositeOperation = "source-over";
    if (sprite) {
      ctx.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
    } else if (typeof ctx.createRadialGradient === "function") {
      const gr = ctx.createRadialGradient(x, y, 0, x, y, radius);
      if (gr && typeof gr.addColorStop === "function") {
        gr.addColorStop(0, worksRgba(color, 0.8));
        gr.addColorStop(0.35, worksRgba(color, 0.2));
        gr.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function strokePolyline(ctx, pts) {
    if (!pts || pts.length < 4) return false;
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.stroke();
    return true;
  }

  function focusColorFor(f, pal) {
    return focusColorOf(f.kind, f.exists === false, pal);
  }

  /* ── 绘制层：ASCII / 泡沫 / 网格 / 流珠 / 等势线 / 特效 / 焦点 / 虚位 ── */

  function drawAscii(ctx, wells, pal) {
    if (!optionsOf().ascii) return;
    if (!stormNow() && (!state.asciiCache || timeOf() - state.asciiAt > 0.18)) renderAscii(wells);
    if (state.asciiCache) {
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.drawImage(state.asciiCache.canvas, 0, 0, state.W, state.H);
      ctx.restore();
    }
    void pal;
  }

  function drawFoam(ctx, t, alpha, pal) {
    const n = Math.max(0, Math.min(state.foam.length, Math.round(state.foamCount)));
    for (let i = 0; i < n; i++) {
      const p = state.foam[i];
      const tw = 0.5 + 0.5 * Math.sin(t * p.fq + p.phase);
      ctx.fillStyle = worksRgba(pal.foam, alpha * (0.10 + 0.42 * tw * p.alpha));
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
  }

  function drawGrid(ctx, alpha, pal) {
    const cache = state.gridCache;
    if (!cache) return;
    ctx.strokeStyle = worksRgba(pal.grid, 0.11 * alpha);
    ctx.lineWidth = 1;
    for (const pts of cache.lines) strokePolyline(ctx, pts);
    // 近焦提亮：与基础网格同相位，仅提亮焦点附近的既有网格段。
    const R = 120 * state.u;
    for (const f of state.focuses) {
      if (f.s < 0.3) continue;
      ctx.strokeStyle = worksRgba(pal.grid, 0.30 * alpha * f.s);
      for (const pts of cache.lines) {
        let runStart = -1;
        for (let i = 0; i < pts.length; i += 2) {
          const near = Math.hypot(pts[i] - f.sx, pts[i + 1] - f.sy) <= R;
          if (near && runStart < 0) runStart = i;
          if ((!near || i + 2 >= pts.length) && runStart >= 0) {
            const end = near ? i : i - 2;
            if (end - runStart >= 2) {
              ctx.beginPath();
              ctx.moveTo(pts[runStart], pts[runStart + 1]);
              for (let j = runStart + 2; j <= end; j += 2) ctx.lineTo(pts[j], pts[j + 1]);
              ctx.stroke();
            }
            runStart = -1;
          }
        }
      }
    }
  }

  function drawBeads(ctx, alpha, pal) {
    const cache = state.gridCache;
    if (!cache) return;
    const W = state.W;
    const Hh = state.H;
    const cap = 15 * state.u;
    const wells = wellsOf(timeOf());
    const disp = (x, y) => {
      let dx = 0;
      let dy = 0;
      for (const w of wells) {
        const ddx = w.x - x;
        const ddy = w.y - y;
        const d = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
        const k = w.s * 30 * state.u * Math.exp(-(ddx * ddx + ddy * ddy) / (w.r * w.r));
        dx += (ddx / d) * k;
        dy += (ddy / d) * k;
      }
      const m = Math.sqrt(dx * dx + dy * dy);
      if (m > cap) { dx = dx / m * cap; dy = dy / m * cap; }
      return { x: x + dx, y: y + dy };
    };
    for (const b of state.beads) {
      if (b.pos < 0 || b.pos > (b.axis === "h" ? W : Hh)) continue;
      const coord = b.axis === "h" ? disp(b.pos, b.line) : disp(b.line, b.pos);
      if (coord.x < -20 || coord.x > W + 20 || coord.y < -20 || coord.y > Hh + 20) continue;
      const h = fieldHeightAt(wells, coord.x, coord.y);
      const a = (b.alpha * 0.5 + Math.min(0.45, h * 0.8)) * alpha;
      const tail = 4 + b.speed * 0.18;
      for (let k = 2; k >= 0; k--) {
        const tp = b.axis === "h"
          ? disp(b.pos - b.dir * tail * k, b.line)
          : disp(b.line, b.pos - b.dir * tail * k);
        ctx.fillStyle = worksRgba(pal.foam, a * (1 - k * 0.28));
        ctx.fillRect(tp.x, tp.y, b.size, b.size);
      }
    }
  }

  function drawContours(ctx, alpha, pal) {
    if (!optionsOf().contours) return;
    const cache = state.contourCache;
    if (!cache) return;
    for (const level of cache.data.levels) {
      if (!level.segments.length) continue;
      ctx.strokeStyle = worksRgba(pal.contour, level.alpha * alpha);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const s of level.segments) {
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);
      }
      ctx.stroke();
    }
  }

  function drawEmissions(ctx, alpha, pal) {
    const t = timeOf();
    for (const r of state.emissions) {
      const p = (t - r.t0) / r.dur;
      if (p < 0 || p > 1) continue;
      const color = r.color || pal.contour;
      ctx.strokeStyle = worksRgba(color, (1 - p) * r.a0 * alpha);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(r.x, r.y, easeOutCubic(p) * r.maxR, 0, TAU);
      ctx.stroke();
    }
  }

  function drawEffects(ctx, alpha, pal) {
    const t = timeOf();
    const fx = state.effects;
    for (const r of fx.ripples) {
      const p = (t - r.t0) / r.dur;
      if (p < 0 || p > 1) continue;
      const rr = r.invert ? lerp(52, 6, easeOutCubic(p)) : lerp(10, 96, easeOutCubic(p));
      ctx.strokeStyle = worksRgba(pal.contour, (1 - p) * 0.5 * alpha);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(r.x, r.y, rr, 0, TAU);
      ctx.stroke();
    }
    for (const s of fx.sparks) {
      const p = (t - s.t0) / s.life;
      if (p < 0 || p > 1) continue;
      const x = s.x + s.vx * p * s.life;
      const y = s.y + s.vy * p * s.life;
      ctx.fillStyle = worksRgba(pal.foam, (1 - p) * 0.8 * alpha);
      ctx.fillRect(x, y, 1.6, 1.6);
    }
    for (const s of fx.spirals) {
      const p = (t - s.t0) / s.dur;
      if (p < 0 || p > 1) continue;
      const rad = lerp(s.r0, 3, easeOutCubic(p));
      const x = s.x + Math.cos(s.a0 + s.w * p * s.dur) * rad;
      const y = s.y + Math.sin(s.a0 + s.w * p * s.dur) * rad * 0.82;
      ctx.fillStyle = worksRgba(pal.foam, 0.75 * alpha);
      ctx.fillRect(x, y, 1.7, 1.7);
    }
  }

  /** 焦点形状路径（虚线轮廓共用；入参 kind 或形状名；circle 走 arc）。 */
  function traceFocusShape(ctx, kindOrShape, x, y, r) {
    const shape = focusShapeNameOf(kindOrShape);
    if (shape === "circle") {
      ctx.arc(x, y, r, 0, TAU);
      return;
    }
    const points = focusShapePointsOf(shape, x, y, r);
    if (!points.length) {
      ctx.arc(x, y, r, 0, TAU);
      return;
    }
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
  }

  /** 描一层焦点形状虚线（save/restore 隔离虚线/线宽，避免污染后续绘制）。 */
  function strokeFocusShape(ctx, shape, x, y, r, color, alpha, dash, width, offset) {
    ctx.save();
    ctx.setLineDash(dash);
    ctx.lineDashOffset = offset || 0;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = worksRgba(color, alpha);
    ctx.lineWidth = width;
    ctx.beginPath();
    traceFocusShape(ctx, shape, x, y, r);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * 沿形状周界描出**单段进度弧**（add-cosmos-focus-touch-activate 2.2）：几何走纯函数
   * `focusShapeProgressPointsOf`（与冒烟同一真源），circle 走 `arc` 角度弧。
   * 调用方负责 save/restore 与 strokeStyle（本函数只写路径）。
   * @returns {boolean} 是否写入路径
   */
  function traceFocusShapeProgress(ctx, kindOrShape, x, y, r, k) {
    const shape = focusShapeNameOf(kindOrShape);
    const ratio = clamp(Number(k) || 0, 0, 1);
    if (!(ratio > 0)) return false;
    if (shape === "circle") {
      const start = -Math.PI / 2;
      ctx.arc(x, y, r, start, start + TAU * ratio);
      return true;
    }
    const points = focusShapeProgressPointsOf(shape, x, y, r, ratio);
    if (points.length < 2) return false;
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    return true;
  }

  function drawFocus(ctx, f, alpha, pal, hoverId) {
    if (f.s < 0.02) return;
    const u = state.u;
    const color = focusColorFor(f, pal);
    const shape = f.shape || WORKS_FOCUS_SHAPE[f.kind] || WORKS_FOCUS_SHAPE.other;
    const t = timeOf();
    const flick = f.exists === false
      ? 0.55 + 0.3 * Math.sin(t * 1.1 + f.phase) * Math.sin(t * 0.37)
      : 1;
    const a = alpha * f.s * flick;
    const x = f.sx;
    const y = f.sy;
    const hovered = f.id === hoverId;
    const breath = 0.96 + 0.04 * Math.sin(t * 0.9 + f.phase);

    /* 凝聚核：双层辉光 + 径向渐变芯 + 清晰内环 + 白热中心（质感层）。
       先绘圆形辉光/核心，再把焦点形状压在最上层——否则宽辉光会洗掉虚线轮廓，
       视觉上退化成「一个圆」。 */
    drawGlow(ctx, color, x, y, (21 + 6 * f.bright) * u, 0.42 * a, pal);
    drawGlow(ctx, color, x, y, (10 + 3 * f.bright) * u, 0.75 * a, pal);
    if (typeof ctx.createRadialGradient === "function") {
      const core = ctx.createRadialGradient(x, y, 0, x, y, 7 * u);
      core.addColorStop(0, worksRgba("#ffffff", 0.96 * a));
      core.addColorStop(0.42, worksRgba(color, 0.88 * a));
      core.addColorStop(1, worksRgba(color, 0));
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(x, y, 7 * u, 0, TAU);
      ctx.fill();
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = worksRgba(color, 0.68 * a);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, 6.2 * u, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = worksRgba("#ffffff", 0.95 * a);
    ctx.beginPath();
    ctx.arc(x, y, 2.3 * u, 0, TAU);
    ctx.fill();

    /* 焦点形状：最上层虚线轮廓（先压一层明暗 underlay 提升暗/亮背景对比，再描类型色）。
       hover 时同形状内环反向快转（内环避开下方名称）。 */
    const baseR = 34 * u * breath;
    const dash = [5 * u, 5.5 * u];
    strokeFocusShape(ctx, shape, x, y, baseR, pal.light ? "#ffffff" : "#000000", 0.42 * a, dash, 3.4, -t * 5);
    strokeFocusShape(ctx, shape, x, y, baseR, color, 0.58 * a + 0.16 * f.bright, dash, 1.35, -t * 5);
    if (hovered) {
      const hoverR = Math.max(12 * u, baseR - 7 * u);
      const hoverDash = [3 * u, 4 * u];
      strokeFocusShape(ctx, shape, x, y, hoverR, pal.light ? "#ffffff" : "#000000", 0.36 * a, hoverDash, 3, t * 24);
      strokeFocusShape(ctx, shape, x, y, hoverR, pal.gold, 0.98 * a, hoverDash, 1.6, t * 24);
    }

    /* 长按进度环（add-cosmos-focus-touch-activate 2.2/D5）：沿该焦点**形状周界**描边，
       进度 = Δt/2000 线性（k 由引擎时钟写入），周界外侧留白一档（baseR + 7u，与 hover
       内环 baseR − 7u 同档）。取消/激发后快退期同路径 alpha 线性归零（无残帧）；
       形状语义不破功——六边形焦点的进度环仍是六边形。绘制序在名称之前：标签恒压环上，
       环扫过底部顶点时不遮字（真机评审仅调半径/线宽，不动层级）。 */
    const holdView = holdViewOf(f.id);
    if (holdView && holdView.k > 0.001 && holdView.alpha > 0.01) {
      const ringR = baseR + 7 * u;
      ctx.save();
      ctx.setLineDash([]);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = worksRgba(pal.accent, 0.92 * a * holdView.alpha);
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      traceFocusShapeProgress(ctx, shape, x, y, ringR, holdView.k);
      ctx.stroke();
      ctx.restore();
    }

    /* 名称：字号加大 + 文字阴影；失谐以 ⚠ 前缀与警示色替代旧「上方字形 + 下方警示」双行。 */
    const label = (f.exists === false ? "\u26A0 " : "") + f.displayName;
    try {
      ctx.font = "600 " + (14 * Math.max(u, 0.9)).toFixed(1) + 'px "Segoe UI","Microsoft YaHei",sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
    } catch { /* 假 ctx 容错 */ }
    ctx.save();
    ctx.shadowColor = pal.light ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.85)";
    ctx.shadowBlur = 6 * u;
    ctx.shadowOffsetY = 1 * u;
    const labelColor = f.exists === false
      ? (pal.light ? "#b23a1e" : "#ffb28a")
      : (pal.light ? "#332f28" : "#ffe9cf");
    ctx.fillStyle = worksRgba(labelColor, (f.exists === false ? 0.88 : (hovered ? 0.94 : 0.82)) * a);
    ctx.fillText(label, x, y + (baseR + 5 * u));
    ctx.restore();
  }

  function drawVacancy(ctx, alpha, pal) {
    if (state.vacancyK < 0.02) return;
    const u = state.u;
    const x = state.W / 2;
    const y = state.H * 0.55;
    const k = state.vacancyK;
    const t = timeOf();
    const breath = 0.4 + 0.22 * Math.sin(t * 1.5);
    ctx.save();
    ctx.globalAlpha = alpha * k;
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = worksRgba(pal.gold, breath);
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(x, y, 20 * u, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = worksRgba(pal.gold, breath * 0.5);
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.arc(x + i * 26 * u, y + 34 * u, 14 * u, Math.PI * 0.25, Math.PI * 0.75);
      ctx.stroke();
    }
    ctx.fillStyle = worksRgba(pal.gold, 0.9);
    try {
      ctx.font = (13 * Math.max(u, 0.9)).toFixed(1) + 'px "Segoe UI Symbol","Segoe UI",sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
    } catch { /* 容错 */ }
    ctx.fillText("\uFF0B", x, y);
    ctx.fillStyle = worksRgba("#ffe9cf", 0.55);
    try {
      ctx.font = (10 * Math.max(u, 0.85)).toFixed(1) + 'px "Segoe UI","Microsoft YaHei",sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
    } catch { /* 容错 */ }
    ctx.fillText("虚位 · 点击凝聚", x, y + 52 * u);
    ctx.restore();
  }

  function drawScene(ctx, view, alpha) {
    const t = timeOf();
    const pal = paletteOf();
    const wells = wellsOf(t);
    syncScreens();
    ensureAmbient();
    ensureGrid(wells);
    /* 风暴降级矩阵（spec「星场渲染预算与降级」）：等势线/ASCII 保持缓存帧（不重算）、
       辐射涟漪停发、流珠冻结（update 侧不再推进）；积压消化后自动恢复。 */
    const storm = stormNow();
    if (!storm && optionsOf().contours) ensureContours(wells);
    drawAscii(ctx, wells, pal);
    drawFoam(ctx, t, alpha, pal);
    drawGrid(ctx, alpha, pal);
    drawBeads(ctx, alpha, pal);
    drawContours(ctx, alpha, pal);
    if (!storm) drawEmissions(ctx, alpha, pal);
    for (const f of state.focuses) drawFocus(ctx, f, alpha, pal, state.hoverId);
    drawEffects(ctx, alpha, pal);
    drawVacancy(ctx, alpha, pal);
    void view;
  }

  /* ── 转场 ── */

  function buildWaveSources() {
    const live = liveFocuses();
    const pal = paletteOf();
    const sources = [];
    if (live.length) {
      live.forEach((f, i) => {
        sources.push({
          x: f.sx,
          y: f.sy,
          delay: (i % 6) * 0.045,
          phase: f.phase,
          color: focusColorFor(f, pal)
        });
      });
      return sources;
    }
    // 无作品回落：虚位 + 星云 + 各恒星/行星/彗星（SHALL NOT 依赖任何作品条目）。
    sources.push({ x: state.W / 2, y: state.H * 0.55, delay: 0, phase: 0, color: pal.gold });
    const ws = typeof H.focusWs === "function" ? H.focusWs() : null;
    const project = typeof H.project === "function" ? H.project : null;
    if (ws && project) {
      if ((ws.archives || 0) > 0) {
        sources.push({ x: state.W * 0.72, y: state.H * 0.66, delay: 0.12, phase: 1.1, color: pal.html });
      }
      const bodies = [...(ws.stars || []), ...(ws.planets || []), ...(ws.comets || [])];
      bodies.slice(0, 8).forEach((b, i) => {
        const p = project(b.wp);
        if (!p) return;
        sources.push({ x: p.x, y: p.y, delay: 0.06 + i * 0.045, phase: i, color: i % 2 ? pal.md : pal.gold });
      });
    }
    return sources;
  }

  function beginTransition(direction, options = {}) {
    const t = timeOf();
    syncScreens();
    const plan = faceTransitionPlanOf({
      direction,
      storm: options.storm === true,
      crossfade: options.crossfade === true
    });
    if (direction === "toField") {
      state.trans = {
        direction,
        mode: plan.mode,
        t0: t,
        duration: plan.duration,
        done: false,
        sources: buildWaveSources(),
        maskW: 0,
        maskH: 0,
        mask: null,
        crest: null
      };
    } else {
      const targets = Array.isArray(options.targets) && options.targets.length
        ? options.targets
        : [{ key: "center", x: state.W / 2, y: state.H * 0.55, color: paletteOf().gold }];
      const focuses = liveFocuses().map((f) => ({ ...f, color: focusColorFor(f, paletteOf()) }));
      const seed = worksHashOf(state.layoutSig + "|toMatter");
      const particles = buildGatherParticles({
        focuses,
        targets,
        seed,
        width: state.W,
        height: state.H,
        fieldColor: paletteOf().foam
      });
      state.stats.particleBuilds += 1;
      state.trans = {
        direction,
        mode: plan.mode,
        t0: t,
        duration: plan.duration,
        done: false,
        particles,
        targets,
        sparkSeed: seed
      };
    }
    return { ...plan };
  }

  /** 引擎每帧注入目标天体的**实时**屏幕位置（目标随天体运动解析）。 */
  function setMatterTargets(targets) {
    if (!state.trans || state.trans.direction !== "toMatter") return;
    if (!Array.isArray(targets) || !targets.length) return;
    state.trans.targets = targets;
    for (const p of state.trans.particles || []) {
      if (p.targetIndex >= 0 && p.targetIndex < targets.length) {
        p.c1 = hexOf(targets[p.targetIndex].color) || p.c1;
      }
    }
  }

  function transitionElapsed() {
    return state.trans ? Math.max(0, timeOf() - state.trans.t0) : 0;
  }

  function transitionDone() {
    return !!(state.trans && state.trans.done);
  }

  function transitionInfo() {
    if (!state.trans) return null;
    return {
      direction: state.trans.direction,
      mode: state.trans.mode,
      duration: state.trans.duration,
      elapsed: transitionElapsed(),
      done: state.trans.done === true,
      sources: state.trans.sources ? state.trans.sources.length : 0,
      particles: state.trans.particles ? state.trans.particles.length : 0
    };
  }

  function finishTransition() {
    state.trans = null;
  }

  /** 揭示采样（物质压暗 + 遮罩同形）；转场外恒 0。 */
  function revealAt(x, y) {
    const trans = state.trans;
    if (!trans || trans.direction !== "toField" || trans.mode === "crossfade") return 0;
    if (!trans.mask || !trans.maskW || !trans.maskH) return 0;
    const gx = clamp(Math.floor((x / state.W) * trans.maskW), 0, trans.maskW - 1);
    const gy = clamp(Math.floor((y / state.H) * trans.maskH), 0, trans.maskH - 1);
    return trans.mask[gy * trans.maskW + gx] || 0;
  }

  /** toMatter 时物质面 α（无黑场间隙：星场先淡出、天体随粒子到达渐显）。 */
  function matterAlphaOf() {
    const trans = state.trans;
    if (!trans || trans.direction !== "toMatter") return 1;
    if (trans.mode === "crossfade") return easeInOut(transitionElapsed() / trans.duration);
    return easeInOut((transitionElapsed() - 0.38) / 1.15);
  }

  function fieldAlphaOf() {
    const trans = state.trans;
    if (!trans || trans.direction !== "toMatter") return 1;
    if (trans.mode === "crossfade") return 1 - easeInOut(transitionElapsed() / trans.duration);
    return 1 - easeInOut(transitionElapsed() / 1.5);
  }

  function ensureTransitionLayer() {
    const W = Math.max(1, Math.round(state.W));
    const Hh = Math.max(1, Math.round(state.H));
    if (!state.off.layer) {
      try {
        if (typeof document !== "undefined" && typeof document.createElement === "function") {
          const c = document.createElement("canvas");
          const g = typeof c.getContext === "function" ? c.getContext("2d") : null;
          if (g) state.off.layer = { canvas: c, ctx: g, w: 0, h: 0 };
        }
      } catch { /* 无 DOM（冒烟）→ 直绘降级 */ }
    }
    const layer = state.off.layer;
    if (!layer) return null;
    if (layer.w !== W || layer.h !== Hh) {
      layer.canvas.width = W;
      layer.canvas.height = Hh;
      layer.w = W;
      layer.h = Hh;
    }
    return layer;
  }

  /** 低分辨率合成波场 → 揭示遮罩 + crest 亮度（同场驱动，ImageData 不可用则矩形降级）。 */
  function buildWaveMask(elapsed) {
    const trans = state.trans;
    if (!trans) return;
    const W = state.W;
    const Hh = state.H;
    const cell = Math.max(3, Math.round(Math.min(W, Hh) / 150));
    const cols = Math.max(8, Math.ceil(W / cell));
    const rows = Math.max(8, Math.ceil(Hh / cell));
    if (!trans.mask || trans.maskW !== cols || trans.maskH !== rows) {
      trans.mask = new Float32Array(cols * rows);
      trans.maskW = cols;
      trans.maskH = rows;
      trans.maskImage = null;
      trans.crestImage = null;
      trans.maskCanvas = null;
      trans.crestCanvas = null;
      try {
        if (typeof document !== "undefined" && typeof document.createElement === "function") {
          const mc = document.createElement("canvas");
          mc.width = cols; mc.height = rows;
          const mg = typeof mc.getContext === "function" ? mc.getContext("2d") : null;
          const cc = document.createElement("canvas");
          cc.width = cols; cc.height = rows;
          const cg = typeof cc.getContext === "function" ? cc.getContext("2d") : null;
          if (mg) trans.maskCanvas = { canvas: mc, ctx: mg };
          if (cg) trans.crestCanvas = { canvas: cc, ctx: cg };
        }
      } catch { /* 冒烟环境无真实 canvas */ }
    }
    const opts = { width: W, height: Hh };
    const pal = paletteOf();
    const crestRgb = rgbOf(pal.crest) || [255, 210, 140];
    let maskImage = null;
    let crestImage = null;
    try {
      if (trans.maskCanvas && !trans.maskImage) trans.maskImage = trans.maskCanvas.ctx.createImageData(cols, rows);
      if (trans.crestCanvas && !trans.crestImage) trans.crestImage = trans.crestCanvas.ctx.createImageData(cols, rows);
      maskImage = trans.maskImage;
      crestImage = trans.crestImage;
    } catch { /* 降级 */ }
    const maskData = maskImage && maskImage.data ? maskImage.data : null;
    const crestData = crestImage && crestImage.data ? crestImage.data : null;
    const fade = clamp(1 - elapsed / Math.max(0.1, trans.duration), 0, 1);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const x = (i + 0.5) * cell;
        const y = (j + 0.5) * cell;
        const reveal = waveRevealAt(trans.sources, x, y, elapsed, opts);
        const crest = waveCrestAt(trans.sources, x, y, elapsed, opts);
        trans.mask[j * cols + i] = reveal;
        const idx = (j * cols + i) * 4;
        if (maskData) {
          maskData[idx] = 255;
          maskData[idx + 1] = 255;
          maskData[idx + 2] = 255;
          maskData[idx + 3] = Math.round(clamp(reveal, 0, 1) * 255);
        }
        if (crestData) {
          crestData[idx] = crestRgb[0];
          crestData[idx + 1] = crestRgb[1];
          crestData[idx + 2] = crestRgb[2];
          crestData[idx + 3] = Math.round(clamp(crest * 0.9 * fade, 0, 1) * 255);
        }
      }
    }
    if (maskImage && trans.maskCanvas) {
      try { trans.maskCanvas.ctx.putImageData(maskImage, 0, 0); } catch { /* 降级 */ }
    }
    if (crestImage && trans.crestCanvas) {
      try { trans.crestCanvas.ctx.putImageData(crestImage, 0, 0); } catch { /* 降级 */ }
    }
    state.stats.maskBuilds += 1;
    trans.fade = fade;
  }

  /** toField 叙事：场层离屏 → 波场遮罩合成 → crest 加色；crossfade 直接整体淡入。 */
  function drawReveal(ctx, view) {
    const trans = state.trans;
    if (!trans) return;
    const elapsed = transitionElapsed();
    const pal = paletteOf();
    if (trans.mode === "crossfade") {
      drawScene(ctx, view, easeInOut(elapsed / trans.duration));
      return;
    }
    buildWaveMask(elapsed);
    const layer = ensureTransitionLayer();
    if (!layer) {
      drawScene(ctx, view, 0.6);
      return;
    }
    layer.ctx.clearRect(0, 0, state.W, state.H);
    drawScene(layer.ctx, view, 1);
    if (trans.maskCanvas) {
      layer.ctx.save();
      if (typeof layer.ctx.globalCompositeOperation === "string") {
        layer.ctx.globalCompositeOperation = "destination-in";
        layer.ctx.drawImage(trans.maskCanvas.canvas, 0, 0, state.W, state.H);
        layer.ctx.globalCompositeOperation = "source-over";
      }
      layer.ctx.restore();
    }
    ctx.drawImage(layer.canvas, 0, 0, state.W, state.H);
    if (trans.crestCanvas) {
      ctx.save();
      if (pal.additive) ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.9;
      ctx.drawImage(trans.crestCanvas.canvas, 0, 0, state.W, state.H);
      ctx.restore();
    }
    // 源点爆亮充电拍（≤0.35s）
    for (const src of trans.sources) {
      const e = elapsed - (Number(src.delay) || 0);
      if (e < 0 || e > 0.35) continue;
      const k = clamp(e / 0.35, 0, 1);
      drawGlow(ctx, src.color || pal.crest, src.x, src.y, 34 * state.u * (0.5 + k), (1 - k) * 0.9, pal);
    }
  }

  /** toMatter 粒子绘制（含捕获混色与抵达迸花）。 */
  function drawParticles(ctx, view) {
    const trans = state.trans;
    if (!trans || trans.direction !== "toMatter") return;
    const elapsed = transitionElapsed();
    const pal = paletteOf();
    const targets = trans.targets || [];
    const fallback = { x: state.W / 2, y: state.H * 0.55, color: pal.crest };
    for (const p of trans.particles || []) {
      const target = p.targetIndex >= 0 && p.targetIndex < targets.length ? targets[p.targetIndex] : fallback;
      const at = gatherParticleAt(p, elapsed, target);
      if (at.q <= 0) continue;
      if (at.q >= 1) {
        if (!p.arrived) {
          p.arrived = true;
          addSparks(target.x, target.y, 2);
        }
        continue;
      }
      drawGlow(ctx, at.color, at.x, at.y, (5.5 - 2 * at.k) * (p.size * 0.5 + 1), 0.8, pal);
    }
    void view;
  }

  /* ── 命中 / 悬停 / 激活 ── */

  function hitRadius() { return Math.max(30, 34 * state.u); }

  function hitTest(x, y) {
    if (state.trans) return null;
    syncScreens();
    for (const f of state.focuses) {
      if (f.dying || f.s < 0.2) continue;
      if (Math.hypot(x - f.sx, y - f.sy) <= hitRadius()) return { type: "focus", id: f.id };
    }
    if (!liveFocuses().length && state.vacancyK > 0.2) {
      const vx = state.W / 2;
      const vy = state.H * 0.55;
      if (Math.hypot(x - vx, y - vy) <= Math.max(34, 34 * state.u)) return { type: "vacancy" };
    }
    return null;
  }

  function updateHover(x, y, inView) {
    if (state.trans || !inView) { state.hoverId = null; return null; }
    const hit = hitTest(x, y);
    const id = hit && hit.type === "focus" ? hit.id : null;
    if (id && id !== state.hoverId) {
      const f = focusById(id);
      if (f) pushEmission(f.sx, f.sy, true, focusColorFor(f, paletteOf()));
    }
    state.hoverId = id;
    if (id) state.hoverAt = timeOf();
    return id;
  }

  function activate(id) {
    const f = focusById(id);
    if (!f) return null;
    if (f.exists === false) {
      addSparks(f.sx, f.sy, 6);
      return { type: "launch", focus: f };
    }
    f.bright = 1;
    addRipple(f.sx, f.sy, false, 0);
    addRipple(f.sx, f.sy, false, 0.12);
    addRipple(f.sx, f.sy, false, 0.24);
    addSparks(f.sx, f.sy, 14);
    pushEmission(f.sx, f.sy, true, focusColorFor(f, paletteOf()));
    return { type: "launch", focus: f };
  }

  function notifyLaunched(id) {
    const f = focusById(id);
    if (!f) return;
    f.bright = 1;
    addRipple(f.sx, f.sy, false, 0);
    pushEmission(f.sx, f.sy, true, focusColorFor(f, paletteOf()));
  }

  /* ── 复位 / 观测面 ── */

  function reset() {
    state.focuses = [];
    state.layout = new Map();
    state.layoutSig = "";
    state.hoverId = null;
    state.vacancyK = 0;
    state.foam = null;
    state.beads = [];
    state.effects = { ripples: [], sparks: [], spirals: [] };
    state.emissions = [];
    state.hold = null;
    state.trans = null;
    state.gridCache = null;
    state.contourCache = null;
    state.asciiCache = null;
    state.stats = { gridBuilds: 0, contourBuilds: 0, asciiBuilds: 0, particleBuilds: 0, maskBuilds: 0, layoutBuilds: 0, draws: 0 };
  }

  function inspect() {
    syncScreens();
    const pal = paletteOf();
    return {
      face: state.trans ? "transition" : "field",
      width: state.W,
      height: state.H,
      count: count(),
      focuses: state.focuses.map((f) => ({
        id: f.id,
        displayName: f.displayName,
        kind: f.kind,
        shape: f.shape,
        exists: f.exists,
        x: Math.round(f.sx * 10) / 10,
        y: Math.round(f.sy * 10) / 10,
        s: Math.round(f.s * 1000) / 1000,
        dying: f.dying
      })),
      layout: Object.fromEntries(Array.from(state.layout.entries()).map(([id, p]) => [id, { x: Math.round(p.x * 10000) / 10000, y: Math.round(p.y * 10000) / 10000 }])),
      signature: state.layoutSig,
      hoverId: state.hoverId,
      /* 长按呈现态（add-cosmos-focus-touch-activate 观测面）：id + 进度 + 是否快退中。 */
      hold: state.hold
        ? {
          id: state.hold.id,
          k: Math.round(clamp(state.hold.k, 0, 1) * 1000) / 1000,
          fading: state.hold.fadeT0 != null
        }
        : null,
      vacancyK: Math.round(state.vacancyK * 1000) / 1000,
      options: optionsOf(),
      activity: activityOf(),
      palette: Object.fromEntries(Object.entries(pal).filter(([, v]) => typeof v === "string")),
      transition: transitionInfo(),
      cache: {
        gridBuilds: state.stats.gridBuilds,
        contourBuilds: state.stats.contourBuilds,
        asciiBuilds: state.stats.asciiBuilds,
        particleBuilds: state.stats.particleBuilds,
        maskBuilds: state.stats.maskBuilds,
        layoutBuilds: state.stats.layoutBuilds,
        gridKey: state.gridCache ? state.gridCache.key : null,
        contourKey: state.contourCache ? state.contourCache.key : null
      },
      effects: {
        ripples: state.effects.ripples.length,
        sparks: state.effects.sparks.length,
        spirals: state.effects.spirals.length,
        emissions: state.emissions.length
      }
    };
  }

  return {
    setWorks,
    beginEvaporate,
    focusById,
    liveFocuses,
    count,
    hitTest,
    updateHover,
    activate,
    notifyLaunched,
    /* 触屏长按呈现面（add-cosmos-focus-touch-activate D5）：引擎状态机唯一写入方。 */
    holdBegin,
    holdUpdate,
    holdEnd,
    update,
    draw(ctx, view, alpha) {
      state.stats.draws += 1;
      const a = Number.isFinite(Number(alpha)) ? clamp(Number(alpha), 0, 1) : 1;
      drawScene(ctx, view, a);
    },
    drawReveal,
    drawParticles,
    beginTransition,
    setMatterTargets,
    transitionElapsed,
    transitionDone,
    transitionInfo,
    finishTransition,
    revealAt,
    matterAlphaOf,
    fieldAlphaOf,
    buildWaveSources,
    wellsOf: () => wellsOf(timeOf()),
    reset,
    inspect,
    /** 供 HUD 取当前焦点屏幕位置（信息卡引线锚点）。 */
    screenOf(id) {
      const f = focusById(id);
      return f ? { x: f.sx, y: f.sy } : null;
    },
    palette() { return paletteOf(); }
  };
}

/** 引擎侧只读辅助：光标/悬停命中半径（冒烟与 UI 共用；MUST ≥30px 等值）。 */
export function worksHitRadiusOf(minSide) {
  const side = Number(minSide) > 0 ? Number(minSide) : 900;
  return Math.max(30, 34 * Math.max(0.55, side / 900));
}

