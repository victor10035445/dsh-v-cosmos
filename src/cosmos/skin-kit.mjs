/**
 * Cosmos 皮肤共享工具（add-cosmos-skin-themes 1.3/1.4 的公共底座）。
 *
 * 定位：皮肤模块是**引擎无关**的纯绘制层（design D1/R5），但转场编排消费面（D5）在
 * 12 套皮肤里必须逐字一致——出生 α 坡道、状态色相滑移 colorMix、注意力信号强度坡道
 * mixFade、查看渐熄 fx.view、风暴降级 degraded、卫星 bornK、连线段 seg.alpha、星云
 * 尘埃 born 坡道。这些「口径」集中在本模块，皮肤只决定**用什么语言画**。
 *
 * 本模块 import 期零 DOM 副作用（glow sprite 惰性创建，仅绘制时才碰 document）；
 * Node 冒烟以桩 document 直接执行。
 *
 * 与 demo/skins/assets/skinlib.js 的差异（移植词汇映射，design D5）：
 *  - palette 键 `draft/in-progress/complete` → `proto/created/reviewed/executed`；
 *  - 条目字段 `it.data.status` → `it.data.lifecycle`；
 *  - 连线段 `[a, b]` 数组形 → `{a, b, alpha}` 对象形；
 *  - 不保留 `captionHTML`（SRC 侧无消费点）。
 */

export const TAU = Math.PI * 2;

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function easeOutK(k) { k = clamp(k, 0, 1); return 1 - Math.pow(1 - k, 3); }

/** 颜色混合（hex → hex；act 白热偏移 / 色相滑移 / 卫星降饱和共用）。 */
export function mix(h1, h2, k) {
  k = clamp(k, 0, 1);
  const a = parseInt(h1.slice(1), 16), b = parseInt(h2.slice(1), 16);
  const r = Math.round(lerp((a >> 16) & 255, (b >> 16) & 255, k));
  const g = Math.round(lerp((a >> 8) & 255, (b >> 8) & 255, k));
  const bl = Math.round(lerp(a & 255, b & 255, k));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1);
}

/** hex + α → rgba() 字符串（α 取三位小数，跨帧同值避免字符串抖动）。 */
export function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}

/** 卫星降饱和（向灰蓝收 35%；states-core `dim` 同款）。 */
export function dimColor(hex, k, toward) {
  return mix(hex, toward || '#707c9c', k == null ? 0.35 : k);
}

/** 字符串种子（nova 火花/残骸确定性参数基座；跨帧同值 → 无闪烁）。 */
export function hashSeed(text) {
  let h = 0;
  const s = String(text);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** 确定性伪随机 [0,1)（sin-hash；同一 seed 逐帧恒定）。 */
export function hashRand(seed) {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/* ---------- 转场编排消费面（design D5；12 套皮肤共用同一口径） ---------- */

/** 星云增量渐入时长（1.2：born α 坡道 0.8s）。 */
export const DUST_BORN_FADE = 0.8;

/** 尘埃粒子出生坡道（borne 空 = 存量粒子恒 1）。 */
export function dustBornK(p, t) {
  return p && p.born != null ? clamp((t - p.born) / DUST_BORN_FADE, 0, 1) : 1;
}

/** 出生 α（skin 侧乘子；delay 段为 0 → 不可见）。 */
export function birthAlphaOf(it) {
  return it && it.birth ? it.birth.alpha : 1;
}

/** 连线段坡道（8.1：{a,b,alpha} 对象形；alpha 缺省 1）。 */
export function segAlphaOf(seg) {
  return seg && seg.alpha != null ? seg.alpha : 1;
}

/** 会话天体状态色解析（D3 统一口径）：行星/卫星直查四态表；彗星 idle 保持身份色
    `free`（add-comet-states 既有语义），非 idle 覆盖状态色。 */
export function sessColorOf(palette, kind, state) {
  if (kind === 'comet') {
    return state && state !== 'idle' && palette.sess[state] ? palette.sess[state] : palette.sess.free;
  }
  return palette.sess[state] || '#cccccc';
}

/** 状态色相滑移取色（3.2/D3）：colorMix 存在 → from/to 状态色 easeOutCubic 插值；
    无 mix → 直取状态色（稳态零成本，天生免疫风暴）。 */
export function sessColor(palette, kind, state, body, t) {
  const cm = body && body.colorMix;
  if (!cm) return sessColorOf(palette, kind, state);
  const k = easeOutK(clamp((t - cm.t0) / cm.dur, 0, 1));
  return mix(sessColorOf(palette, kind, cm.from), sessColorOf(palette, kind, cm.to), k);
}

/** 注意力信号强度坡道（3.2）：有 colorMix 时按插值进度对来源/目标态加权。 */
export function mixFade(body, t, state) {
  const cm = body && body.colorMix;
  if (!cm) return 1;
  const k = easeOutK(clamp((t - cm.t0) / cm.dur, 0, 1));
  let w = 0;
  if (cm.from === state) w += 1 - k;
  if (cm.to === state) w += k;
  return clamp(w, 0, 1);
}

/** 查看渐熄进度（fx.view，fx 驱动谓词）：k∈[0,1]，无 fx → 0。
    不以 state 为前提——markFx 与 state 翻转同帧，state 前提恒假会致渐变空转瞬切。 */
export function viewKOf(it, t) {
  const fx = it && it.fx;
  if (!fx || fx.type !== 'view') return 0;
  return easeOutK(clamp((t - fx.t0) / (fx.dur * 0.72), 0, 1));
}

/** 卫星出生坡道（2.2：引擎按 born/SAT_BORN_DUR 计；null = 稳态）。 */
export function satBornKOf(it) {
  return it && it.bornK != null ? clamp(it.bornK, 0, 1) : 1;
}

/* ---------- 绘制底层件 ---------- */

/** 辉光 sprite 缓存（**每个皮肤实例独立**——杜绝跨皮肤串色，design D6）。
    返回 {sprite, draw, wash}：draw = lighter 加色（深空系），wash = source-over 低 α
    （纸面/水彩系，MUST NOT 用 lighter，design D8）。 */
export function makeGlowCache() {
  const cache = {};
  function sprite(hex) {
    if (!cache[hex]) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, hexA(hex, 0.95));
      gr.addColorStop(0.3, hexA(hex, 0.22));
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 64);
      cache[hex] = c;
    }
    return cache[hex];
  }
  return {
    sprite,
    /** 加色辉光（深空皮肤）。 */
    draw(ctx, hex, x, y, R, a) {
      if (R < 2 || a <= 0.01) return;
      ctx.save();
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(sprite(hex), x - R, y - R, R * 2, R * 2);
      ctx.restore();
    },
    /** 透明水彩晕（纸面皮肤；source-over 低 α，MUST NOT 加色）。 */
    wash(ctx, hex, x, y, R, a) {
      if (R < 2 || a <= 0.01) return;
      ctx.save();
      ctx.globalAlpha = clamp(a, 0, 1) * 0.4;
      ctx.drawImage(sprite(hex), x - R, y - R, R * 2, R * 2);
      ctx.restore();
    }
  };
}

/** 尾迹描线（由细到粗、由淡到浓；α 逐段乘 k）。 */
export function trailStroke(ctx, trail, hex, kAlpha, wBase, wGrow, alpha) {
  if (!trail || trail.length < 2) return;
  ctx.lineCap = 'round';
  for (let i = 1; i < trail.length; i++) {
    const k = i / trail.length;
    ctx.strokeStyle = hexA(hex, (k * kAlpha * alpha).toFixed(3));
    ctx.lineWidth = wBase + k * wGrow;
    ctx.beginPath();
    ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
    ctx.lineTo(trail[i].x, trail[i].y);
    ctx.stroke();
  }
}

/** 版画四芒星（纸上星图 glyph；fidenza 用）。 */
export function engraveStar(ctx, x, y, s, color) {
  ctx.fillStyle = color;
  for (let k = 0; k < 2; k++) {
    const a = k * Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * s, y + Math.sin(a) * s);
    ctx.quadraticCurveTo(x + Math.cos(a + Math.PI / 2) * s * 0.18, y + Math.sin(a + Math.PI / 2) * s * 0.18, x + Math.cos(a + Math.PI) * s, y + Math.sin(a + Math.PI) * s);
    ctx.quadraticCurveTo(x + Math.cos(a - Math.PI / 2) * s * 0.18, y + Math.sin(a - Math.PI / 2) * s * 0.18, x + Math.cos(a) * s, y + Math.sin(a) * s);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * 每帧每星座一次的「器皿」绘制守卫（design D9）：同一帧内同一 ws 仅绘制一次。
 * 帧判定 = `view.t` 值比较（同帧全部条目共享同一 t 数字）；状态存皮肤实例闭包，
 * `setSkin` 换实例即自然重置，MUST NOT 挂引擎。
 *
 * @returns {(ws: object|null, t: number) => boolean} true = 本帧首次（应绘制）
 */
export function createVesselGuard() {
  let lastT = -1;
  let served = new Set();
  return function vesselOnce(ws, t) {
    if (t !== lastT) { lastT = t; served = new Set(); }
    const key = ws && ws.id != null ? String(ws.id) : '';
    if (key === '') return false;
    if (served.has(key)) return false;
    served.add(key);
    return true;
  };
}

/**
 * 星座器皿的屏幕锚点：`ws.proj` 由引擎逐帧写入（投影中心 + 缩放 s）；缺失 → null。
 * 隐喻皮肤的「培养皿/细胞膜/板框/池塘/气流区/乐句环」都以它为圆心。
 */
export function vesselAnchor(ws) {
  const p = ws && ws.proj;
  if (!p || !(p.s > 0)) return null;
  return { x: p.x, y: p.y, s: p.s };
}
