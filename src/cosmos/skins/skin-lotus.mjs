/**
 * 皮肤 · 荷塘月色 Lotus（add-cosmos-skin-themes 移植：demo/skins/assets/skin-lotus.js → SRC ESM）。
 *
 * 血统：demo 的圆括号 IIFE + `window.COSMOS_SKINLIB.define` + `COSMOS_SKINLIB.util` 全局 →
 * 本模块 `createSkinLotus()` 工厂（`palette` + `drawBody` 保持引擎无关；每次调用独立 glow 缓存）。
 * 移植词汇映射（design D5）：prop 键 `draft/in-progress/complete` → `proto/created/reviewed/executed`、
 * `it.data.status` → `it.data.lifecycle`、连线段数组形 `[a, b]` → 对象形 `{a, b, alpha}`、
 * sess 键 `done` → `done-unread`、不迁 demo 的信息卡片段字段（SRC 侧无消费点）。
 *
 * 隐喻：星座 = 一方荷塘（水面 + 塘岸 + 月白反光弧 + 涟漪细线）· 恒星 = 荷花
 * （星胚 = 花苞 / 已创建 = 初绽 / 已审核 = 满开 + 金蕊 / 已执行 = 结莲蓬金涌）·
 * 行星 = 锦鲤（尾叉摆动；等批准 = 鱼跃出水）· 卫星 = 蜻蜓（点水涟漪）·
 * 彗星 = 水黾掠水（水面划痕 + 足影；demo 的蜻蜓母语迁给新分支 sat）·
 * 流星 = 落英划过 · 星云尘埃 = 落英与浮萍藻荇 · 连线 = 涟漪虚线 · 背景 = 月晕 + 水痕 + 流萤。
 *
 * 转场本地化（D5 消费面全部接齐，口径一律取自 skin-kit）：
 *  - 出生：α 乘 `birthAlphaOf`；`birth.k∈[0.15,0.65]` 叠白色微爆闪，`degraded` 只留纯 α 坡道；
 *  - 点燃：A 段花苞轮廓收缩（虚线 `[4,5]` 呼吸圈收向花心）→ B 段白光破水（白闪 + 破水涟漪）→
 *    C 段色相由星胚灰蓝渐变到已创建冷粉（花苞裂开成初绽）；
 *  - 落印：已审核金章环 `stampP` 半径 ×2.2→1、α 淡入；
 *  - 金涌：executed 盛放绽放——花瓣层由内向外张开 + 金蕊点亮 + 金环外扩渐熄（1.2s，sin(kπ) 包络）；
 *  - 色相滑移：行星/卫星/彗星走 `sessColor`；注意力信号强度乘 `mixFade('waiting'/'done-unread')`；
 *  - 查看渐熄：`viewKOf(it, t) > 0` 时颜色向 `done-unread` 混合、done halo 沿 `1-viewK` 消退；
 *  - 其余：星座消散幽灵 wsghost、连线段 `seg.alpha` 坡道、尘埃 `born` 坡道、卫星 `satBornKOf`
 *    （α × bornK、半径 0→满）、nova 三形态（常规三段 / intensity<0.5 消散 / degraded 渐熄）。
 *
 * 结构：`createVesselGuard()` 实现「每帧每星座一次的器皿绘制」（design D9）——守卫状态存皮肤
 * 实例闭包，`setSkin` 换实例即自然重置，MUST NOT 挂引擎。
 */

import {
  TAU, clamp, lerp, easeOutK, mix, hexA, hashSeed, hashRand,
  makeGlowCache, trailStroke, sessColor, mixFade, viewKOf, birthAlphaOf, segAlphaOf,
  dustBornK, satBornKOf, createVesselGuard, vesselAnchor
} from '../skin-kit.mjs';

/* 荷塘色谱（demo 血统）：水色冷青 = 已创建冷亮域（demo draft 的藕荷粉属暖域，按「皮肤语义
   契约」改用荷塘水色；粉调由落英/花瓣绘制承担，不占生命周期编码）· 莲蕊金 = demo complete ·
   墨绿塘底 · 月白 · 落英粉 · 蕊丝橙金 · 流萤暖黄 / 水汽月白。 */
const CREATED = '#a8d4c8';
const GOLD = '#ffd88a';
const PAD = '#2a6a52';
const MOON = '#d8ecdc';
const PETAL_DEEP = '#c890a4';
const STAMEN = '#ffb056';
const BG_WARM = '#ffe89a';
const BG_COOL = '#a8c4b8';

const PROP = Object.freeze({
  proto: '#8c9aa8',
  created: CREATED,
  reviewed: mix(CREATED, '#ffffff', 0.34),
  executed: GOLD
});

const SESS = Object.freeze({
  idle: '#7a8a84',
  busy: '#6ab8c8',
  waiting: '#ff8a5a',
  'done-unread': '#6ac898',
  free: '#cfe8dc'
});

const DUST = Object.freeze(['#d8a0b0', '#2a6a52']);

/** 背景星（流萤）取色：大颗萤火暖黄，小颗水汽月白。 */
function starTint(m) { return m > 0.88 ? BG_WARM : BG_COOL; }

/** 落英瓣路径（尘埃/幽灵/流星共用；调用方负责 translate + rotate，局部 +x 为瓣尖）。 */
function petalPath(ctx, cx, cy, len, wid) {
  ctx.beginPath();
  ctx.moveTo(cx + len, cy);
  ctx.quadraticCurveTo(cx, cy + wid, cx - len, cy);
  ctx.quadraticCurveTo(cx, cy - wid, cx + len, cy);
  ctx.closePath();
}

/** 创建荷塘月色皮肤实例。 */
export function createSkinLotus() {
  const glow = makeGlowCache();
  const palette = { prop: PROP, sess: SESS };
  const vesselOnce = createVesselGuard();

  function drawGlow(ctx, hex, x, y, R, a) { glow.draw(ctx, hex, x, y, R, a); }

  /* ── 器皿：池塘水面（墨绿水面 + 塘岸 + 月白反光弧 + 两圈涟漪细线；每帧每星座一次） ── */
  function drawVessel(ctx, ws) {
    const p = vesselAnchor(ws);
    if (!p) return;
    const rx = 102 * p.s, ry = rx * 0.4;
    if (rx < 14) return;
    const x = p.x, y = p.y;
    ctx.fillStyle = 'rgba(8,26,28,0.52)';
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill();
    /* 塘岸一圈 */
    ctx.strokeStyle = hexA(PAD, 0.5);
    ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.stroke();
    /* 月白反光弧（上沿受月一侧） */
    ctx.strokeStyle = hexA(MOON, 0.3);
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.ellipse(x, y, rx * 0.94, ry * 0.94, 0, Math.PI * 1.12, Math.PI * 1.68); ctx.stroke();
    /* 涟漪细线：两圈内收 */
    ctx.strokeStyle = hexA(MOON, 0.07);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(x, y, rx * 0.7, ry * 0.7, 0, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(x, y, rx * 0.44, ry * 0.44, 0, 0, TAU); ctx.stroke();
  }

  /* ── 荷花瓣：基点出发的贝塞尔纺锤（局部 -y 指向瓣尖；demo 同源） ── */
  function petal(ctx, x, y, ang, len, wid, fill, alpha) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(wid, -len * 0.45, 0, -len);
    ctx.quadraticCurveTo(-wid, -len * 0.45, 0, 0);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /* ── 荷叶垫（托住整株花期；墨绿椭圆 + 两笔叶脉） ── */
  function lotusPad(ctx, x, y, s, al) {
    ctx.globalAlpha = al;
    ctx.fillStyle = hexA(PAD, 0.62);
    ctx.beginPath(); ctx.ellipse(x, y + s * 0.9, s * 2.1, s * 0.9, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(10,26,20,0.32)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.9); ctx.lineTo(x + s * 1.6, y + s * 1.12);
    ctx.moveTo(x, y + s * 0.9); ctx.lineTo(x - s * 1.6, y + s * 1.12);
    ctx.stroke();
  }

  /* ── 星胚 = 花苞：合抱三瓣 + 虚线轮廓 `[4,5]` 呼吸 + 淡核；
     ignite A 段轮廓收缩（r+5 → ×0.62），B/C 段由调用方接棒。 ── */
  function bud(ctx, x, y, s, c, r, al, t, breath, igniteP) {
    const contract = igniteP >= 0 ? easeOutK(clamp(igniteP / 0.3, 0, 1)) : 0;
    const ro = igniteP >= 0 ? lerp(r + 5, r * 0.62, contract) : r + 5 + breath * 2;
    const oa = igniteP >= 0 ? 0.52 + contract * 0.4 : 0.42 + breath * 0.3;
    const tight = 0.18 + contract * 0.12;
    /* 淡核 */
    drawGlow(ctx, c, x, y, s * 3.0, al * (0.14 + breath * 0.1));
    /* 花苞三瓣（合抱；越近点燃越收紧） */
    petal(ctx, x, y + s * 0.5, 0, s * (1.9 - contract * 0.5), s * 0.62, hexA(c, 0.92), al);
    petal(ctx, x, y + s * 0.5, tight, s * 1.55, s * 0.44, hexA(c, 0.8), al);
    petal(ctx, x, y + s * 0.5, -tight, s * 1.55, s * 0.44, hexA(c, 0.8), al);
    /* 虚线轮廓 + 呼吸 */
    ctx.save();
    ctx.strokeStyle = hexA(c, oa * al);
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 5]);
    ctx.lineDashOffset = -t * 8;
    ctx.beginPath(); ctx.arc(x, y, ro, 0, TAU); ctx.stroke();
    ctx.restore();
    /* 淡核高光 */
    ctx.globalAlpha = al * 0.3;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(x, y, Math.max(0.7, s * 0.16), 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }

  /* ── 初绽（已创建 / 点燃 C 段）：外四瓣半张 + 内一瓣 + 月白花心 ── */
  function halfBloom(ctx, x, y, s, c, al, act) {
    const pale = mix(c, '#ffffff', 0.52);
    petal(ctx, x, y + s * 0.3, -0.86, s * 1.8, s * 0.55, hexA(c, 0.86), al);
    petal(ctx, x, y + s * 0.3, 0.86, s * 1.8, s * 0.55, hexA(c, 0.86), al);
    petal(ctx, x, y + s * 0.3, -0.4, s * 2.1, s * 0.62, hexA(pale, 0.92), al);
    petal(ctx, x, y + s * 0.3, 0.4, s * 2.1, s * 0.62, hexA(pale, 0.92), al);
    petal(ctx, x, y + s * 0.3, 0, s * 1.5, s * 0.5, hexA(mix(c, MOON, 0.35), 0.95), al);
    /* 花心（月白，随活跃度微亮） */
    ctx.globalAlpha = al * (0.5 + Math.min(act, 3) * 0.12);
    ctx.fillStyle = MOON;
    ctx.beginPath(); ctx.arc(x, y - s * 0.05, Math.max(0.9, s * 0.2), 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    drawGlow(ctx, c, x, y - s * 0.5, s * 3, al * 0.2 * (0.7 + act * 0.3));
  }

  /* ── 满开（已审核）：六瓣满张 + 金蕊（莲心 + 六丝放射，蕊丝单笔成路径） ── */
  function fullBloom(ctx, x, y, s, c, al, act) {
    const spreads = [-1.15, -0.7, -0.28, 0.28, 0.7, 1.15];
    for (let i = 0; i < spreads.length; i++) {
      const lean = Math.abs(spreads[i]);
      const fc = i % 2 ? mix(c, PETAL_DEEP, 0.45) : mix(c, '#ffffff', 0.26);
      petal(ctx, x, y + s * 0.25, spreads[i], s * (2.2 - lean * 0.7), s * 0.6, hexA(fc, 0.92), al);
    }
    ctx.globalAlpha = al;
    ctx.fillStyle = hexA(GOLD, 0.92);
    ctx.beginPath(); ctx.arc(x, y + s * 0.05, Math.max(1.1, s * 0.34), 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = hexA(STAMEN, 0.75 * al);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const sa = (i / 6) * TAU + 0.3;
      ctx.moveTo(x + Math.cos(sa) * s * 0.3, y + s * 0.05 + Math.sin(sa) * s * 0.24);
      ctx.lineTo(x + Math.cos(sa) * s * 0.72, y + s * 0.05 + Math.sin(sa) * s * 0.56);
    }
    ctx.stroke();
    drawGlow(ctx, GOLD, x, y, Math.min(s * 3.4, 62), al * (0.2 + Math.min(act, 3) * 0.05));
  }

  /* ── 结莲蓬（已执行定妆）：外张残瓣 + 倒锥花托 + 金莲面与莲孔 ── */
  function seedPod(ctx, x, y, s, al) {
    const outer = mix(PROP.reviewed, PETAL_DEEP, 0.35);
    petal(ctx, x, y + s * 0.35, -1.24, s * 1.9, s * 0.5, hexA(outer, 0.78), al);
    petal(ctx, x, y + s * 0.35, 1.24, s * 1.9, s * 0.5, hexA(outer, 0.78), al);
    const w = s * 0.82, h = s * 0.92;
    ctx.globalAlpha = al;
    ctx.beginPath();
    ctx.moveTo(x - w, y - s * 0.12);
    ctx.quadraticCurveTo(x - w * 0.62, y + h, x, y + h);
    ctx.quadraticCurveTo(x + w * 0.62, y + h, x + w, y - s * 0.12);
    ctx.closePath();
    ctx.fillStyle = hexA(PAD, 0.62);
    ctx.fill();
    ctx.strokeStyle = hexA(GOLD, 0.8);
    ctx.lineWidth = 1;
    ctx.stroke();
    /* 金莲面 + 莲孔 */
    ctx.beginPath();
    ctx.ellipse(x, y - s * 0.12, w, w * 0.3, 0, 0, TAU);
    ctx.fillStyle = hexA(GOLD, 0.7);
    ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const sa = (i / 5) * TAU + 0.4;
      const hx = x + Math.cos(sa) * w * 0.42;
      const hy = y - s * 0.12 + Math.sin(sa) * w * 0.12;
      const hr = Math.max(0.55, s * 0.1);
      ctx.moveTo(hx + hr, hy);   /* 每孔单起子路径，避免连线 */
      ctx.arc(hx, hy, hr, 0, TAU);
    }
    ctx.fillStyle = 'rgba(58,34,10,0.55)';
    ctx.fill();
    ctx.globalAlpha = 1;
    drawGlow(ctx, GOLD, x, y, Math.min(s * 3.2, 56), al * 0.26);
  }

  /* ── executed 金涌母语化：盛放绽放（1.2s，强度包络 sin(kπ)）——
     花瓣层由内向外张开（外层延迟 0.22 起张）→ 金蕊点亮 → 金环外扩渐熄。 ── */
  function bloomSurge(ctx, x, y, s, t, fx, alpha) {
    const el = t - fx.t0;
    if (el <= 0) return;
    const kk = clamp(el / fx.dur, 0, 1);
    const env = Math.sin(kk * Math.PI);
    if (env <= 0.01) return;
    const open = easeOutK(kk);
    const layers = [
      { n: 3, spread: 0.62, len: 1.55, wid: 0.46, delay: 0, c: mix(GOLD, '#ffffff', 0.42) },
      { n: 5, spread: 1.18, len: 2.15, wid: 0.56, delay: 0.22, c: GOLD }
    ];
    for (let li = 0; li < layers.length; li++) {
      const L = layers[li];
      const lk = clamp((open - L.delay) / (1 - L.delay), 0, 1);
      if (lk <= 0) continue;
      for (let i = 0; i < L.n; i++) {
        const frac = (i / (L.n - 1)) * 2 - 1;
        petal(ctx, x, y + s * 0.3, frac * L.spread * lk, s * L.len * (0.35 + 0.65 * lk),
          s * L.wid, hexA(L.c, 0.85 * env), alpha);
      }
    }
    /* 金蕊点亮 */
    ctx.globalAlpha = alpha * env;
    ctx.fillStyle = mix(GOLD, '#ffffff', 0.6);
    ctx.beginPath(); ctx.arc(x, y, Math.max(1.2, s * 0.32), 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    /* 金环外扩渐熄 */
    const ringK = easeOutK(clamp(el / (fx.dur * 0.6), 0, 1));
    ctx.strokeStyle = hexA(GOLD, (1 - ringK) * 0.85 * alpha);
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(x, y, s * 0.9 + 6 + ringK * 26, 0, TAU); ctx.stroke();
    drawGlow(ctx, GOLD, x, y, Math.min(s * 5.4 * lerp(2.2, 1, open), 150), env * 0.85 * alpha);
  }

  /* ── 已审核金章环：stampP≥0 播放落印（半径 ×2.2→1 easeOut + α 淡入） ── */
  function sealRing(ctx, x, y, rr, a, w, stampP) {
    let rad = rr, aa = a;
    if (stampP >= 0) {
      rad = lerp(rr * 2.2, rr, easeOutK(stampP));
      aa = lerp(0, a, stampP);
    }
    ctx.strokeStyle = hexA(GOLD, aa);
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.stroke();
  }

  /* ── 活跃度：绕花流萤（act 越高越多，上限 3；demo 同源） ── */
  function bloomFlies(ctx, x, y, s, t, act, seed, al) {
    if (!(act > 0)) return;
    const n = Math.min(act, 3);
    ctx.fillStyle = BG_WARM;
    ctx.globalAlpha = al * 0.8;
    for (let i = 0; i < n; i++) {
      const fa = t * (1.1 + i * 0.5) + i * 2.4 + (seed % 7);
      ctx.beginPath();
      ctx.arc(x + Math.cos(fa) * s * 2.7, y + Math.sin(fa) * s * 1.4 - s * 0.6, 0.9, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ── 锦鲤（行星）：白身 + 状态色斑 + 尾叉摆动 ── */
  function koi(ctx, x, y, ang, s, wag, patch, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(ang);
    const tailY = wag * s * 0.9;
    ctx.beginPath();
    ctx.moveTo(s * 1.6, 0);
    ctx.quadraticCurveTo(s * 0.6, s * 0.78, -s * 1.0, tailY * 0.5);
    /* 尾叉 */
    ctx.quadraticCurveTo(-s * 1.8, tailY * 0.5 + s * 0.55, -s * 2.35, tailY + s * 0.25);
    ctx.quadraticCurveTo(-s * 1.75, tailY * 0.5, -s * 1.0, tailY * 0.5);
    ctx.quadraticCurveTo(-s * 1.8, tailY * 0.5 - s * 0.55, -s * 2.35, tailY - s * 0.25);
    ctx.quadraticCurveTo(-s * 1.75, tailY * 0.5, -s * 1.0, -tailY * 0.5);
    ctx.quadraticCurveTo(s * 0.6, -s * 0.78, s * 1.6, 0);
    ctx.closePath();
    ctx.fillStyle = 'rgba(242,240,232,0.94)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(24,44,40,0.35)';
    ctx.lineWidth = 0.7;
    ctx.stroke();
    /* 状态色斑 */
    ctx.beginPath();
    ctx.ellipse(s * 0.25, 0, s * 0.72, s * 0.42, 0, 0, TAU);
    ctx.fillStyle = hexA(patch, 0.7);
    ctx.fill();
    /* 眼 */
    ctx.fillStyle = 'rgba(20,30,28,0.85)';
    ctx.beginPath(); ctx.arc(s * 1.12, s * 0.16, s * 0.09 + 0.4, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /* ── 蜻蜓（卫星）：四翼（振翅）+ 身线 + 头部；朝向由尾迹决定，尺度受 bornK 缩放 ── */
  function dragonfly(ctx, x, y, trail, rr, c, alpha, t, seed) {
    const s = rr * 0.9;
    if (s < 1.3) return;
    let ang = -Math.PI / 2;
    if (trail && trail.length > 1) {
      ang = Math.atan2(trail[trail.length - 1].y - trail[trail.length - 2].y,
        trail[trail.length - 1].x - trail[trail.length - 2].x);
    }
    const flap = 0.55 + 0.45 * Math.sin(t * 9 + seed % 11);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.fillStyle = hexA(MOON, 0.34);
    for (let wg = 0; wg < 4; wg++) {
      const side = wg < 2 ? 1 : -1;
      ctx.beginPath();
      ctx.ellipse(s * 0.3, side * s * 0.42, s * 1.15 * flap, s * 0.24,
        side * (0.5 + (wg % 2) * 0.22), 0, TAU);
      ctx.fill();
    }
    ctx.strokeStyle = hexA(c, 0.9);
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(-s * 1.5, 0);
    ctx.lineTo(s * 0.9, 0);
    ctx.stroke();
    ctx.fillStyle = hexA(mix(c, '#ffffff', 0.3), 0.9);
    ctx.beginPath(); ctx.arc(s * 1.0, 0, s * 0.2 + 0.4, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /* ── 水黾（彗星）：身后 V 形水面划痕 + 躯干与三对足影 + 首节萤核 ── */
  function strider(ctx, x, y, trail, s, c, alpha) {
    let ang = 0;
    if (trail && trail.length > 1) {
      ang = Math.atan2(trail[trail.length - 1].y - trail[trail.length - 2].y,
        trail[trail.length - 1].x - trail[trail.length - 2].x);
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(ang);
    /* 水面划痕（V 形双水纹） */
    ctx.strokeStyle = hexA(MOON, 0.26);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-s * 0.6, 0); ctx.lineTo(-s * 2.6, s * 1.15);
    ctx.moveTo(-s * 0.6, 0); ctx.lineTo(-s * 2.6, -s * 1.15);
    ctx.stroke();
    /* 躯干 + 三对足影 */
    ctx.strokeStyle = hexA(c, 0.85);
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(-s * 1.1, 0); ctx.lineTo(s * 0.9, 0);
    ctx.moveTo(s * 0.15, 0); ctx.lineTo(s * 0.95, s * 0.8);
    ctx.moveTo(s * 0.15, 0); ctx.lineTo(s * 0.95, -s * 0.8);
    ctx.moveTo(-s * 0.5, 0); ctx.lineTo(s * 0.2, s * 0.9);
    ctx.moveTo(-s * 0.5, 0); ctx.lineTo(s * 0.2, -s * 0.9);
    ctx.stroke();
    /* 首节萤核 */
    ctx.fillStyle = hexA(mix(c, '#ffffff', 0.6), 0.9);
    ctx.beginPath(); ctx.arc(s * 0.95, 0, Math.max(0.7, s * 0.26), 0, TAU); ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /* ── 水面涟漪环（gl > 0 = 纵向压扁比，0 = 正圆） ── */
  function ripple(ctx, x, y, rr, c, a, gl) {
    if (a <= 0.01 || rr <= 0) return;
    ctx.strokeStyle = hexA(c, a);
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (gl > 0) ctx.ellipse(x, y, rr, rr * gl, 0, 0, TAU);
    else ctx.arc(x, y, rr, 0, TAU);
    ctx.stroke();
  }

  /* ── 完成未读：冷绿 halo 慢脉动（view 转场沿 keep=1-viewK 渐熄） ── */
  function doneHalo(ctx, x, y, r, t, al, keep, phase) {
    if (keep <= 0.02) return;
    const ph = phase || 0;
    const hr = r + 9 + 3 * Math.sin(t * 1.8 + ph);
    ctx.strokeStyle = hexA(SESS['done-unread'], (0.22 + 0.14 * Math.sin(t * 1.8 + ph)) * al * keep);
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(x, y, hr, 0, TAU); ctx.stroke();
    drawGlow(ctx, SESS['done-unread'], x, y, r * 3.2, 0.18 * al * keep);
  }

  /* ── 悬停/选中：月白涟漪虚线圈（选中叠金圈） ── */
  function hoverMark(ctx, it) {
    if (!it.hovered && !it.selected) return;
    ctx.strokeStyle = it.selected ? GOLD : hexA(MOON, 0.55);
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 7, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    if (it.selected) {
      ctx.strokeStyle = hexA(GOLD, 0.35);
      ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 12, 0, TAU); ctx.stroke();
    }
  }

  return {
    skin: 'lotus',
    useBand: false,
    palette,
    gold: GOLD,
    bgStarColor(m) { return starTint(m); },
    dustColors: DUST,

    background(ctx, view) {
      const g = ctx.createLinearGradient(0, 0, 0, view.H);
      g.addColorStop(0, '#0e1d22');
      g.addColorStop(0.55, '#0a1418');
      g.addColorStop(1, '#071012');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, view.W, view.H);
      /* 月晕 + 月盘（月白偏绿的水墨月；缺口用池底夜色抹出） */
      const mx = view.W * 0.78, my = view.H * 0.16;
      const mg = ctx.createRadialGradient(mx, my, 0, mx, my, Math.max(view.W, view.H) * 0.4);
      mg.addColorStop(0, 'rgba(216,236,220,0.13)');
      mg.addColorStop(0.25, 'rgba(216,236,220,0.05)');
      mg.addColorStop(1, 'rgba(216,236,220,0)');
      ctx.fillStyle = mg;
      ctx.fillRect(0, 0, view.W, view.H);
      ctx.fillStyle = 'rgba(232,244,236,0.30)';
      ctx.beginPath(); ctx.arc(mx, my, 20, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(7,16,18,0.35)';
      ctx.beginPath(); ctx.arc(mx + 6, my - 4, 17, 0, TAU); ctx.fill();
      /* 水痕（横向波纹，周期由 t 驱动；极低对比） */
      ctx.strokeStyle = 'rgba(159,200,184,0.05)';
      ctx.lineWidth = 1;
      for (let w = 0; w < 4; w++) {
        const wy = view.H * (0.3 + 0.14 * w);
        ctx.beginPath();
        for (let x = 0; x <= view.W; x += 24) {
          const yy = wy + Math.sin(x * 0.012 + w * 2.2 + view.t * 0.14) * 2.4;
          if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
      /* 流萤（背景星即萤火；大颗带辉光） */
      const bs = view.bgStars;
      for (let i = 0; i < bs.length; i++) {
        const s = bs[i];
        if (s.a < 0.06) continue;
        const tw = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(view.t * 1.6 + s.m * 9));
        ctx.globalAlpha = s.a * tw;
        ctx.fillStyle = starTint(s.m);
        ctx.fillRect(s.x - 0.7, s.y - 0.7, 1.4, 1.4);
        if (s.m > 0.9) drawGlow(ctx, BG_WARM, s.x, s.y, 3.4, s.a * tw * 0.8);
      }
      ctx.globalAlpha = 1;
    },

    drawBody(ctx, it, view) {
      const t = view.t;
      /* 器皿：荷塘水面（每帧每星座一次，design D9） */
      if (it.ws && vesselOnce(it.ws, t)) drawVessel(ctx, it.ws);

      if (it.kind === 'dust') {
        /* 落英 / 浮萍藻荇（尘埃 born 坡道 0.8s 渐入） */
        it.pts.forEach(function (p) {
          const bornK = dustBornK(p, t);
          if (p.hue < 0.5) {
            ctx.save();
            ctx.globalAlpha = clamp(p.a * bornK * 0.55, 0, 1);
            ctx.translate(p.x, p.y);
            ctx.rotate(hashRand(p.x * 3.7 + p.y) * TAU);
            petalPath(ctx, 0, 0, 2.2, 1.1);
            ctx.fillStyle = DUST[0];
            ctx.fill();
            ctx.restore();
          } else {
            ctx.globalAlpha = clamp(p.a * bornK * 0.3, 0, 1);
            ctx.fillStyle = DUST[1];
            ctx.beginPath();
            ctx.arc(p.x, p.y, Math.max(1.1, p.s * 0.7), 0, TAU);
            ctx.fill();
          }
        });
        ctx.globalAlpha = 1;
        return;
      }

      if (it.kind === 'constline') {
        /* 涟漪虚线（连线）：段对象形 {a, b, alpha}，段 α 坡道参与（8.1 渐入/渐熄） */
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 5]);
        it.segs.forEach(function (seg) {
          const sa = it.alpha * segAlphaOf(seg);
          if (sa <= 0.01) return;
          ctx.strokeStyle = hexA(MOON, 0.22 * sa);
          ctx.beginPath();
          ctx.moveTo(seg.a.x, seg.a.y);
          ctx.lineTo(seg.b.x, seg.b.y);
          ctx.stroke();
        });
        ctx.setLineDash([]);
        return;
      }

      if (it.kind === 'orbit') {
        /* 荷塘轨道虚线（月白，极低对比） */
        ctx.strokeStyle = hexA(MOON, 0.09 * it.alpha);
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 7]);
        ctx.beginPath();
        it.orbitPts.forEach(function (p, i) { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
        ctx.stroke();
        ctx.setLineDash([]);
        return;
      }

      if (it.kind === 'star') {
        const st = it.data;
        const lifecycle = st.lifecycle || 'created';
        const act = st.act || 0;
        const fx = it.fx;
        const bAl = birthAlphaOf(it);
        const al = it.alpha * bAl;
        const seed = hashSeed(st.id);
        const s = Math.max(2.6, it.r * 0.9);
        const x = it.x, y = it.y;
        lotusPad(ctx, x, y, s, al);
        if (lifecycle === 'proto') {
          /* 星胚 = 花苞：虚线轮廓呼吸；点燃 A 段收缩、B 段白光破水、C 段开成初绽 */
          const phase = st.starIndex || 0;
          const breath = (Math.sin(t * 1.6 + phase) + 1) / 2;
          const igniteP = fx && fx.type === 'ignite' ? clamp((t - fx.t0) / fx.dur, 0, 1) : -1;
          if (igniteP >= 0 && igniteP > 0.55) {
            /* C 段：花苞已裂开，色相由星胚灰蓝渐变到已创建冷粉 */
            halfBloom(ctx, x, y, s, mix(PROP.proto, PROP.created, (igniteP - 0.55) / 0.45), al, act);
          } else {
            bud(ctx, x, y, s, PROP.proto, it.r, al, t, breath, igniteP);
          }
          if (igniteP >= 0.30 && igniteP < 0.75) {
            /* B 段：白光微爆闪 + 破水涟漪（花苞顶水初绽） */
            const fk = (igniteP - 0.30) / 0.45;
            drawGlow(ctx, '#ffffff', x, y, it.r * 6.5, Math.sin(clamp(fk, 0, 1) * Math.PI) * 0.9 * it.alpha);
            ripple(ctx, x, y, it.r + 6 + fk * it.r * 4.5, MOON, (1 - fk) * 0.5 * it.alpha, 0.42);
          }
        } else if (lifecycle === 'reviewed') {
          /* 已审核 = 满开 + 金蕊 + 金章环（stampP 播放落印后常驻） */
          fullBloom(ctx, x, y, s, PROP.reviewed, al, act);
          const stampP = fx && fx.type === 'stamp' ? clamp((t - fx.t0) / fx.dur, 0, 1) : -1;
          sealRing(ctx, x, y, it.r + 6, 0.85 * al, 1.4, stampP);
        } else if (lifecycle === 'executed') {
          /* 已执行 = 结莲蓬（金涌后的定妆） */
          seedPod(ctx, x, y, s, al);
        } else {
          /* 已创建 = 初绽 */
          halfBloom(ctx, x, y, s, PROP.created, al, act);
        }
        /* 开放态才挂绕花流萤 */
        if (lifecycle !== 'proto') bloomFlies(ctx, x, y, s, t, act, seed, al);
        /* 出生微爆闪（2.4/D2）：与点燃 B 段同语言、幅度减半；degraded 时禁爆闪（纯 α 坡道） */
        if (it.birth && !it.birth.degraded && it.birth.k >= 0.15 && it.birth.k < 0.65) {
          const fk = (it.birth.k - 0.15) / 0.5;
          drawGlow(ctx, '#ffffff', x, y, it.r * 6.5, Math.sin(clamp(fk, 0, 1) * Math.PI) * 0.45 * al);
        }
        /* executed 金涌：盛放绽放（1.2s，强度包络 sin(kπ)） */
        if (fx && fx.type === 'surge') bloomSurge(ctx, x, y, s, t, fx, it.alpha);
        ctx.globalAlpha = 1;
        hoverMark(ctx, it);
        return;
      }

      if (it.kind === 'planet') {
        /* 锦鲤：尾叉摆动游弋；等批准 = 鱼跃出水（涟漪环 + 水珠） */
        const p = it.data;
        const state = p.state;
        let c2 = sessColor(palette, 'planet', state, p, t);
        const viewK = viewKOf(it, t);
        if (viewK > 0) c2 = mix(SESS['done-unread'], c2, viewK);
        const al = it.alpha * birthAlphaOf(it);
        const waitFade = mixFade(p, t, 'waiting');
        const doneFade = mixFade(p, t, 'done-unread');
        const tr = it.trail;
        let ang = -Math.PI / 2;
        if (tr && tr.length > 1) {
          ang = Math.atan2(tr[tr.length - 1].y - tr[tr.length - 2].y,
            tr[tr.length - 1].x - tr[tr.length - 2].x);
        }
        const s = Math.max(2.4, it.r);
        const wag = Math.sin(t * 5 + hashSeed(p.id) % 9) * 0.5;
        /* 水下尾迹涟漪 */
        trailStroke(ctx, tr, c2, 0.22, 0.4, 1.1, al);
        if (state === 'waiting') {
          koi(ctx, it.x, it.y, ang - 0.5, s, wag, c2, al);
          const rk = (t * 1.5) % 1;
          ripple(ctx, it.x, it.y + s * 0.8, s * 1.6 + rk * s * 2.6, MOON, (1 - rk) * 0.5 * al * waitFade, 0.4);
          ctx.fillStyle = hexA(MOON, 0.6 * al * waitFade);
          for (let dr = 0; dr < 3; dr++) {
            const dk = (t * 1.2 + dr * 0.33) % 1;
            ctx.beginPath();
            ctx.arc(it.x + (dr - 1) * s * 0.5, it.y - dk * s * 2.2, 0.8, 0, TAU);
            ctx.fill();
          }
          drawGlow(ctx, c2, it.x, it.y, s * 3.4, 0.3 * al * waitFade);
        } else {
          koi(ctx, it.x, it.y, ang, s, wag, c2, al);
        }
        if (p.delegatedBusy) {
          /* 委托忙碌微光环：准星外青蓝慢呼吸（周期 ~2s） */
          const busyA = 0.25 * (0.5 + 0.5 * Math.sin(t * Math.PI));
          ctx.strokeStyle = hexA(SESS.busy, busyA * al);
          ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 11, 0, TAU); ctx.stroke();
        }
        if (state === 'done-unread' || viewK > 0) {
          doneHalo(ctx, it.x, it.y, it.r, t, al, (1 - viewK) * doneFade, p.phase);
        }
        hoverMark(ctx, it);
        return;
      }

      if (it.kind === 'suborbit') {
        /* 卫星子轨道虚线环 `[3,5]`（色随父天体状态，0.28α） */
        const oc = SESS[(it.data && it.data.state) || ''] || SESS.idle;
        ctx.strokeStyle = hexA(oc, 0.28 * it.alpha);
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        it.orbitPts.forEach(function (p, i) { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
        ctx.stroke();
        ctx.setLineDash([]);
        return;
      }

      if (it.kind === 'sat') {
        /* 蜻蜓（卫星）：出生坡道 α×bornK、尺度 0→满；等批准 = 点水涟漪 */
        const sd = it.data;
        const bornK = satBornKOf(it);
        const rF = easeOutK(bornK);
        const al = it.alpha * bornK;
        const c4 = mix(sessColor(palette, 'sat', sd.state, sd, t), PAD, 0.3);
        if (rF > 0.02) {
          trailStroke(ctx, it.trail, c4, 0.2, 0.5, 1.0, al);
          drawGlow(ctx, c4, it.x, it.y, it.r * 2.6, al * 0.45);
          dragonfly(ctx, it.x, it.y, it.trail, Math.max(1.6, it.r * rF), c4, al, t, hashSeed(sd.id));
        }
        if (sd.state === 'waiting') {
          /* 待决策：点水涟漪扩散（强度乘 bornK 与色相坡道） */
          const satFade = bornK * mixFade(sd, t, 'waiting');
          const pp = ((t * 22) % 10) / 10;
          ripple(ctx, it.x, it.y, it.r + 2 + pp * 7, c4, (1 - pp) * 0.5 * al * satFade, 0.42);
          drawGlow(ctx, c4, it.x, it.y, it.r * 2.6 + 6, 0.22 * al * satFade);
        }
        return;
      }

      if (it.kind === 'comet') {
        /* 水黾掠水（彗星）：尾迹先现（trailAlpha）、核后亮（alpha）；
           色相滑移 sessColor（idle 保持身份色 free）+ 查看渐熄向 done-unread 混 */
        const c = it.data;
        const state = c.state;
        let c3 = sessColor(palette, 'comet', state, c, t);
        const viewK = viewKOf(it, t);
        if (viewK > 0) c3 = mix(SESS['done-unread'], c3, viewK);
        const birth = it.birth || null;
        const bCore = birth ? birth.alpha : 1;
        const bTrail = birth ? birth.trailAlpha : 1;
        const waitFade = mixFade(c, t, 'waiting');
        const doneFade = mixFade(c, t, 'done-unread');
        trailStroke(ctx, it.trail, c3, 0.45, 0.6, 1.7, it.alpha * bTrail);
        drawGlow(ctx, c3, it.x, it.y, Math.min(it.r * 3.8, 28), it.alpha * bCore * 0.8);
        strider(ctx, it.x, it.y, it.trail, Math.max(2, it.r * 0.9), c3, it.alpha * bCore);
        if (c.delegatedBusy) {
          const busyA = 0.25 * (0.5 + 0.5 * Math.sin(t * Math.PI));
          ctx.strokeStyle = hexA(SESS.busy, busyA * it.alpha * bCore);
          ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 11, 0, TAU); ctx.stroke();
        }
        if (state === 'done-unread' || viewK > 0) {
          doneHalo(ctx, it.x, it.y, it.r, t, it.alpha * bCore, (1 - viewK) * doneFade, c.phase);
        }
        if (state === 'waiting') {
          /* 待决策：水面升起的水汽柱 + 双涟漪错峰（强度乘 waitFade） */
          const h = it.r * 2.6 + 6;
          const g2 = ctx.createLinearGradient(it.x, it.y - h, it.x, it.y);
          g2.addColorStop(0, hexA(c3, 0));
          g2.addColorStop(1, hexA(c3, 0.6 * it.alpha * bCore * waitFade));
          ctx.strokeStyle = g2;
          ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.moveTo(it.x, it.y - h); ctx.lineTo(it.x, it.y - 2); ctx.stroke();
          const kk = (t * 1.3) % 1;
          ripple(ctx, it.x, it.y + it.r * 0.4, it.r + 3 + kk * 16, c3,
            (1 - kk) * 0.55 * it.alpha * bCore * waitFade, 0.4);
          const k2 = (kk + 0.5) % 1;
          ripple(ctx, it.x, it.y + it.r * 0.4, it.r + 3 + k2 * 16, c3,
            (1 - k2) * 0.35 * it.alpha * bCore * waitFade, 0.4);
        }
        return;
      }

      if (it.kind === 'wsghost') {
        /* 星座消散幽灵：落英与浮萍漂散 + 残荷余辉渐熄（不乘 ws.alpha） */
        (it.dust || []).forEach(function (p) {
          if (p.hue < 0.5) {
            ctx.save();
            ctx.globalAlpha = clamp(p.a * 0.55, 0, 1);
            ctx.translate(p.x, p.y);
            ctx.rotate(hashRand(p.x * 3.7 + p.y) * TAU);
            petalPath(ctx, 0, 0, 2.2, 1.1);
            ctx.fillStyle = DUST[0];
            ctx.fill();
            ctx.restore();
          } else {
            ctx.globalAlpha = clamp(p.a * 0.3, 0, 1);
            ctx.fillStyle = DUST[1];
            ctx.beginPath();
            ctx.arc(p.x, p.y, Math.max(1, p.s * 0.6), 0, TAU);
            ctx.fill();
          }
        });
        ctx.globalAlpha = 1;
        (it.stars || []).forEach(function (st) {
          drawGlow(ctx, st.color, st.x, st.y, Math.min(st.r * 3.0, 40), st.a * 0.55);
          ctx.globalAlpha = st.a * 0.7;
          ctx.fillStyle = st.color;
          ctx.beginPath(); ctx.arc(st.x, st.y, Math.max(1, st.r * 0.4), 0, TAU); ctx.fill();
          ctx.globalAlpha = 1;
        });
        return;
      }

      if (it.kind === 'nova') {
        /* 落瓣爆燃（nova 三形态）：常规三段 / intensity<0.5 星胚消散 / degraded 渐熄最小形态 */
        const n = it.data;
        const base = it.r;
        const seed = hashSeed(n.id);
        if (n.degraded) {
          /* 风暴降级最小形态（7.2/D7）：仅余辉衰减 + 少量残萤外散（无爆闪无冲击环） */
          const pk = it.k;
          drawGlow(ctx, n.color, it.x, it.y, base * 3 * (1 + pk * 0.6), (1 - pk) * 0.3);
          ctx.globalAlpha = (1 - pk) * 0.4;
          ctx.fillStyle = n.color;
          ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(0.8, base * 0.4 * (1 - pk)), 0, TAU); ctx.fill();
          ctx.globalAlpha = 1;
          for (let i = 0; i < 6; i++) {
            const ang = hashRand(seed + i * 7.3) * TAU;
            const d = base * (0.5 + hashRand(seed + i * 3.1) * 1.2) * easeOutK(pk);
            ctx.globalAlpha = (1 - pk) * 0.3;
            ctx.fillStyle = hexA(n.color, 0.7);
            ctx.beginPath();
            ctx.arc(it.x + Math.cos(ang) * d, it.y + Math.sin(ang) * d, 1, 0, TAU);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
          return;
        }
        if (n.intensity < 0.5) {
          /* 星胚消散变体（0.8s）：虚线轮廓放大淡出 + 淡核收缩 + 落英 puff */
          const pk = it.k;
          drawGlow(ctx, n.color, it.x, it.y, base * 3 * (1 + pk * 0.8), (1 - pk) * 0.25);
          ctx.save();
          ctx.strokeStyle = hexA(n.color, (1 - pk) * 0.5);
          ctx.lineWidth = 1.2;
          ctx.setLineDash([4, 5]);
          ctx.beginPath();
          ctx.arc(it.x, it.y, base * lerp(1.1, 2.4, easeOutK(pk)), 0, TAU);
          ctx.stroke();
          ctx.restore();
          ctx.globalAlpha = (1 - pk) * 0.45;
          ctx.fillStyle = n.color;
          ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(0.8, base * 0.36 * (1 - pk)), 0, TAU); ctx.fill();
          ctx.globalAlpha = 1;
          for (let i = 0; i < 5; i++) {
            const ang = hashRand(seed + i * 7.3) * TAU;
            const d = base * (0.6 + hashRand(seed + i * 3.1) * 1.4) * easeOutK(pk);
            ctx.globalAlpha = (1 - pk) * 0.4;
            ctx.fillStyle = hexA(DUST[i % 2], 0.85);
            ctx.beginPath();
            ctx.arc(it.x + Math.cos(ang) * d, it.y + Math.sin(ang) * d, 1.1, 0, TAU);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
          return;
        }
        const el = it.k * n.dur;
        /* A 段 引爆（0–0.5s）：花心白炽膨胀 ×1→×3.5 */
        const coreP = el < 0.5 ? easeOutK(el / 0.5) : clamp((el - 0.9) / Math.max(0.01, n.dur - 0.9), 0, 1);
        const coreR = base * (el < 0.5 ? lerp(1, 3.5, coreP) : lerp(3.5, 0, coreP));
        const coreA = el < 0.9 ? 1 : 1 - coreP;
        const hotC = mix(n.color, '#ffffff', 0.7);
        if (coreR > 0.8 && coreA > 0.01) {
          drawGlow(ctx, hotC, it.x, it.y, Math.max(2, coreR * 5.4), coreA * 0.85);
          drawGlow(ctx, '#ffffff', it.x, it.y, Math.max(2, coreR * 6.5),
            coreA * Math.sin(Math.PI * clamp(el / 0.5, 0, 1)) * 0.9);
          ctx.globalAlpha = coreA;
          ctx.fillStyle = hotC;
          ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(1, coreR * 0.5), 0, TAU); ctx.fill();
          ctx.globalAlpha = 1;
        }
        /* B 段 冲击（0.3–1.1s）：双涟漪扩散环 + 10 片落英飞散（短流星线，错峰起爆） */
        if (el >= 0.3 && el <= 1.1) {
          const b = (el - 0.3) / 0.8;
          [0, 0.18].forEach(function (delay) {
            const bk = easeOutK(clamp((b - delay) / (1 - delay), 0, 1));
            if (bk <= 0 || bk >= 1) return;
            ctx.strokeStyle = hexA(mix(n.color, '#ffffff', 0.4), (1 - bk) * 0.55);
            ctx.lineWidth = 1.6;
            ctx.beginPath(); ctx.arc(it.x, it.y, base * lerp(1, 4, bk), 0, TAU); ctx.stroke();
          });
          ctx.lineCap = 'round';
          for (let i = 0; i < 10; i++) {
            const lag = hashRand(seed + i * 13.7) * 0.35;
            const sk = (b - lag) / (1 - lag);
            if (sk <= 0 || sk >= 1) continue;
            const ang = hashRand(seed + i * 7.3) * TAU;
            const len = 12 + hashRand(seed + i * 3.1) * 14;
            const d0 = base * lerp(1, 4, easeOutK(sk));
            ctx.strokeStyle = hexA(mix(n.color, '#ffffff', 0.5), (1 - sk) * 0.8);
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(it.x + Math.cos(ang) * d0, it.y + Math.sin(ang) * d0);
            ctx.lineTo(it.x + Math.cos(ang) * (d0 + len), it.y + Math.sin(ang) * (d0 + len));
            ctx.stroke();
          }
        }
        /* C 段 归尘（0.9–dur）：13 片残瓣向 drift 快照点漂散渐熄（无快照点 → 原位外散） */
        if (el >= 0.9) {
          const ck = clamp((el - 0.9) / Math.max(0.01, n.dur - 0.9), 0, 1);
          for (let i = 0; i < 13; i++) {
            const lag = hashRand(seed + i * 17.9) * 0.25;
            const gk = clamp((ck - lag) / (1 - lag), 0, 1);
            if (gk <= 0) continue;
            const ang = hashRand(seed + i * 7.3) * TAU;
            const r0 = base * (0.5 + hashRand(seed + i * 5.7) * 0.9);
            const ex = it.drift ? it.drift.x : it.x + Math.cos(ang) * base * 2;
            const ey = it.drift ? it.drift.y : it.y + Math.sin(ang) * base * 2;
            ctx.globalAlpha = (1 - gk) * 0.55;
            ctx.fillStyle = i % 2 === 0 ? DUST[0] : DUST[1];
            ctx.beginPath();
            ctx.arc(lerp(it.x + Math.cos(ang) * r0, ex, easeOutK(gk)),
              lerp(it.y + Math.sin(ang) * r0, ey, easeOutK(gk)),
              0.9 + hashRand(seed + i * 11.3) * 1.1, 0, TAU);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        }
        return;
      }

      if (it.kind === 'meteor') {
        /* 落英划过（流星）：萤黄尾迹 + 一朵旋转落瓣 */
        trailStroke(ctx, it.trail, BG_WARM, 0.55, 0.5, 1.5, it.alpha);
        drawGlow(ctx, BG_WARM, it.x, it.y, 11, it.alpha * 0.9);
        ctx.save();
        ctx.globalAlpha = it.alpha * 0.9;
        ctx.translate(it.x, it.y);
        ctx.rotate((t * 2.2) % TAU);
        petalPath(ctx, 0, 0, 2.6, 1.3);
        ctx.fillStyle = DUST[0];
        ctx.fill();
        ctx.restore();
        ctx.globalAlpha = 1;
      }
    }
  };
}
