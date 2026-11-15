/**
 * 皮肤 · 荧光显微 Fluoro（add-cosmos-skin-themes 1.4）。
 *
 * 血统：`demo/skins/assets/skin-fluoro.js`（圆括号 IIFE + `window.COSMOS_SKINLIB.util`
 * 全局 + `COSMOS_SKINLIB.define` 注册）——移植为 SRC 侧 ES 模块工厂 `createSkinFluoro()`：
 * 无 window、无全局注册、无 `captionHTML`（SRC 侧无消费点）；每次调用独立 glow sprite
 * 缓存与器皿守卫（design D6/D9），换实例即自然重置。
 *
 * 隐喻：暗场荧光显微镜 —— 星座 = 细胞（磷脂双分子层膜 blob + 跨膜蛋白）· 恒星 = 细胞核
 * （异染色质深斑 + 核膜 + PSF 荧光晕）· 行星 = 线粒体（双膜胶囊 + 内嵴）· 彗星 = 游离
 * 囊泡 · 卫星 = 小囊泡 · 连线 = 微管（波状细丝 + 马达蛋白点）· 轨道 = 胞内运输轨道 ·
 * 星云 = 脂褐素自荧光颗粒 · 超新星 = 荧光染料光漂白爆闪 · 流星 = 荧光微球。
 * 底色纯黑（暗场），主调膜青 `#3ec8c8`；金域 = 荧光金 `#ffc25e`。
 *
 * 转场本地化（D5 消费面全接，口径一律走 skin-kit，只本地化视觉语言）：
 *  - 星胚 proto：虚线核膜轮廓 `[4,5]` + 呼吸 + 淡核；`fx.type === 'ignite'` 时
 *    A 段轮廓收缩（0–0.30）→ B 段白光微爆闪（0.30–0.75）→ C 段色相渐变到 created（>0.55）；
 *  - 已审核 reviewed：金章环 r+6（`fx.type === 'stamp'` 播放落印 ×2.2→1 + α 淡入）；
 *  - 已执行 executed：金涌母语化 = **细胞核处金光钙闪 + 金环外扩渐熄**（1.2s，强度包络
 *    `Math.sin(k * π)`，母语「钙瞬变 calcium transient」）；
 *  - 出生 birth：α × `birthAlphaOf`；`birth.k∈[0.15,0.65]` 白色微爆闪；`degraded` 禁爆闪
 *    （纯 α 坡道）；彗星另乘 `birth.trailAlpha`（尾迹先现、核后亮）；
 *  - 状态色相滑移 `sessColor`（行星/彗星/卫星）+ 注意力信号强度 `mixFade`（waiting 钙闪 /
 *    done-unread halo）；
 *  - 查看渐熄 `viewKOf`：颜色向 done-unread 混、done halo 沿 `1-viewK` 消退；
 *  - 卫星 `satBornKOf`：α × bornK、半径 0→满（easeOutK）；尘埃 born 坡道 `dustBornK`；
 *  - 连线段 `segAlphaOf`（`{a, b, alpha}` 对象形）；nova 风暴降级渐熄最小形态。
 *
 * 器皿（design D9）：双层细胞膜 blob（磷脂双分子层两条同心 wobble 闭合曲线 + 跨膜蛋白
 * 短棒），形状由 `ws.id` 种子确定（逐帧稳定不抖动）；`createVesselGuard()` 保证每帧每
 * 星座仅绘一次，守卫状态存本实例闭包，MUST NOT 挂引擎。
 *
 * 性能纪律：单帧绘制原语量级与 skin-reagent 相当；不改变粒子预算语义（逐粒子只落 1 个
 * arc，ghost/nova 的粒子上限与引擎侧一致，不新增逐帧数组分配）。
 */

import {
  TAU, clamp, lerp, easeOutK, mix, hexA, hashSeed, hashRand,
  makeGlowCache, trailStroke, sessColor, mixFade, viewKOf, birthAlphaOf, segAlphaOf,
  dustBornK, satBornKOf, createVesselGuard, vesselAnchor
} from '../skin-kit.mjs';

/* ── 荧光探针常数（demo 血统：DAPI 蓝 / GFP 绿 / mCherry 暖红 三通道） ── */
const CREATED = '#4a78d8';   // demo draft —— draft/in-progress 中的冷支（DAPI 冷蓝）
const GOLD = '#ffc25e';      // demo complete —— 暖金，金域
const MEMBRANE = '#3ec8c8';  // 膜青：磷脂双分子层 / 微管 / 轨道
const ICE = '#eafcff';       // 冷白：核膜高光 / 白光微爆闪 / hover 标记

/* 生命周期四态（demo prop 键 draft/in-progress/complete → proto/created/reviewed/executed） */
const PROP = Object.freeze({
  proto: '#8c9aa8',                        // 低饱和灰蓝：待创建星胚（未激发荧光核）
  created: CREATED,                        // 冷亮：荧光素基态 → 激发
  reviewed: mix(CREATED, '#ffffff', 0.34), // 冷亮升亮：审核态
  executed: GOLD                           // 金域：已执行
});

/* 会话五态（demo done 键更名为 done-unread；waiting 恒暖 / done-unread 恒冷绿） */
const SESS = Object.freeze({
  idle: '#848a8e',           // 中性灰（休眠线粒体）
  busy: '#38d8e8',           // 冷亮蓝青
  waiting: '#ffb056',        // 恒暖（钙闪）
  'done-unread': '#5ae89a',  // 恒冷绿（未读完成）
  free: '#7ad0e0'            // 彗星 idle 身份色
});

/* 脂褐素自荧光颗粒双色（暗场里自发光的细胞垃圾） */
const DUST = Object.freeze(['#b8a75a', '#6a9a58']);

/* ---------- 纯路径件（无绘制状态依赖，可跨实例复用） ---------- */

/** 线粒体胶囊闭合路径（调用方负责 translate/rotate）。 */
function capsulePath(ctx, len, wid) {
  const hl = len / 2 - wid / 2;
  ctx.beginPath();
  ctx.arc(-hl, 0, wid / 2, Math.PI / 2, Math.PI * 1.5);
  ctx.lineTo(hl, -wid / 2);
  ctx.arc(hl, 0, wid / 2, Math.PI * 1.5, Math.PI / 2);
  ctx.closePath();
}

/** 不规则闭合细胞膜 blob：点列已含 wobble，按 scale 收缩到双层膜的某一叶（四次曲线过中点）。 */
function membranePath(ctx, cx, cy, px, py, n, scale) {
  const mx = (px[0] + px[1]) / 2, my = (py[0] + py[1]) / 2;
  ctx.beginPath();
  ctx.moveTo(cx + (mx - cx) * scale, cy + (my - cy) * scale);
  for (let j = 1; j <= n; j++) {
    const a = j % n, b = (j + 1) % n;
    const mx2 = (px[a] + px[b]) / 2, my2 = (py[a] + py[b]) / 2;
    ctx.quadraticCurveTo(
      cx + (px[a] - cx) * scale, cy + (py[a] - cy) * scale,
      cx + (mx2 - cx) * scale, cy + (my2 - cy) * scale
    );
  }
}

/** 创建荧光显微皮肤实例。 */
export function createSkinFluoro() {
  const glow = makeGlowCache();
  const palette = { prop: PROP, sess: SESS };
  const vesselOnce = createVesselGuard();

  function drawGlow(ctx, hex, x, y, R, a) { glow.draw(ctx, hex, x, y, R, a); }

  /* 暗场尘点色（背景星按视星等分三档：亮尘偏冷白，暗尘压向深灰） */
  function bgStarColor(m) {
    return m > 0.85 ? '#c8e6ee' : (m > 0.5 ? '#7e9aa6' : '#41525e');
  }

  /* ── 器皿：双层细胞膜（磷脂双分子层两条同心 wobble 闭合曲线 + 跨膜蛋白短棒；
        每帧每星座一次 —— 形状由 ws.id 种子确定，逐帧稳定不抖） ── */
  function drawVessel(ctx, ws) {
    const p = vesselAnchor(ws);
    if (!p) return;
    const R = 100 * p.s;
    if (R < 14) return;
    const seed = hashSeed(ws.id) % 17;
    const n = 14;
    const px = new Array(n), py = new Array(n);
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * TAU;
      const rr = R * (1 + 0.10 * Math.sin(ang * 3 + seed) + 0.05 * Math.sin(ang * 5 + seed * 2));
      px[i] = p.x + Math.cos(ang) * rr;
      py[i] = p.y + Math.sin(ang) * rr * 0.92;
    }
    /* 脂质双层：外叶（胞外面）+ 内叶（胞质面） */
    membranePath(ctx, p.x, p.y, px, py, n, 1);
    ctx.fillStyle = 'rgba(24,52,66,0.08)';
    ctx.fill();
    ctx.strokeStyle = hexA(MEMBRANE, 0.42);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    membranePath(ctx, p.x, p.y, px, py, n, 0.94);
    ctx.strokeStyle = hexA(MEMBRANE, 0.16);
    ctx.lineWidth = 0.8;
    ctx.stroke();
    /* 膜蛋白点缀：跨膜短棒（种子确定 → 跨帧不闪烁） */
    ctx.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const ang = hashRand(seed + i * 9.1) * TAU;
      const rr = R * (1 + 0.10 * Math.sin(ang * 3 + seed) + 0.05 * Math.sin(ang * 5 + seed * 2));
      const ux = Math.cos(ang), uy = Math.sin(ang) * 0.92;
      ctx.strokeStyle = hexA(i % 2 === 0 ? '#8adfe0' : MEMBRANE, 0.5);
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(p.x + ux * rr * 0.965, p.y + uy * rr * 0.965);
      ctx.lineTo(p.x + ux * rr * 1.035, p.y + uy * rr * 1.035);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  /* ── 细胞核本体（created/reviewed/executed 共用）：PSF 荧光晕 + 核质 + 异染色质
        深斑 + 核膜 + act 白热核 ── */
  function drawNucleus(ctx, x, y, r, c, act, al, seed) {
    drawGlow(ctx, c, x, y, Math.min(r * 5.5, 66), al * (0.42 + act * 0.16));
    const nr = Math.max(2.2, r * 0.78);
    ctx.globalAlpha = clamp(al * 0.92, 0, 1);
    ctx.fillStyle = hexA(c, 0.78);
    ctx.beginPath(); ctx.arc(x, y, nr, 0, TAU); ctx.fill();
    /* 异染色质深斑（亮核里的暗域；种子确定 → 形状跨帧稳定） */
    ctx.fillStyle = 'rgba(4,8,12,0.30)';
    for (let k = 0; k < 6; k++) {
      const ang = hashRand(seed + k * 7.3) * TAU;
      const br = 1.2 + hashRand(seed + k * 3.1) * nr * 0.28;
      const d = hashRand(seed + k * 5.7) * (nr * 0.78 - br);
      ctx.beginPath();
      ctx.arc(x + Math.cos(ang) * d, y + Math.sin(ang) * d, br, 0, TAU);
      ctx.fill();
    }
    /* 核膜 */
    ctx.globalAlpha = clamp(al, 0, 1);
    ctx.strokeStyle = hexA(c, 0.85);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, nr, 0, TAU); ctx.stroke();
    if (act > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath(); ctx.arc(x, y, Math.max(0.8, nr * 0.24), 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ── 星胚（未激发荧光核）：虚线核膜轮廓 `[4,5]` + 呼吸 ±2px + 淡核；
        igniteP≥0 时 A 段轮廓收缩（0–0.30 easeOutCubic 到 ×0.6） ── */
  function drawProtoNucleus(ctx, x, y, r, c, al, phase, breath, igniteP, t) {
    drawGlow(ctx, c, x, y, r * 3.0, al * (0.14 + breath * 0.1));
    ctx.globalAlpha = clamp(al * 0.5, 0, 1);
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(x, y, Math.max(1.2, r * 0.38), 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    const contract = igniteP >= 0 ? easeOutK(clamp(igniteP / 0.3, 0, 1)) : 0;
    const ro = igniteP >= 0 ? lerp(r + 5, r * 0.6, contract) : r + 5 + breath * 2;
    const oa = igniteP >= 0 ? 0.5 + contract * 0.4 : 0.45 + breath * 0.25;
    ctx.save();
    ctx.strokeStyle = hexA(c, clamp(oa * al, 0, 1));
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 5]);
    ctx.lineDashOffset = -t * 8;
    ctx.beginPath(); ctx.arc(x, y, ro, 0, TAU); ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = clamp(al * 0.3, 0, 1);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(x, y, Math.max(0.7, r * 0.14), 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }

  /* ── 已审核金章环：stampP≥0 播放落印（半径 ×2.2→×1 + α 淡入） ── */
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

  /* ── 已执行金涌母语化：细胞核处金光钙闪 + 金环外扩渐熄（1.2s，包络 sin(k·π)） ── */
  function goldSurge(ctx, it, t, al, fx) {
    const el = t - fx.t0;
    if (el <= 0) return;
    const kk = clamp(el / fx.dur, 0, 1);
    const env = Math.sin(kk * Math.PI);
    /* 钙瞬变：核区金晕内收脉冲（半径 ×2.2→×1）+ 内层金光 */
    drawGlow(ctx, GOLD, it.x, it.y,
      Math.min(it.r * 5.4 * lerp(2.2, 1, easeOutK(kk)), 150), env * 0.9 * al);
    drawGlow(ctx, '#fff0c8', it.x, it.y, Math.max(2, it.r * 3.2), env * 0.55 * al);
    /* 金环外扩渐熄（双线：主环 + 内侧薄环） */
    const ringK = easeOutK(clamp(el / (fx.dur * 0.6), 0, 1));
    ctx.strokeStyle = hexA(GOLD, (1 - ringK) * 0.85 * al);
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 6 + ringK * 26, 0, TAU); ctx.stroke();
    ctx.strokeStyle = hexA('#fff0c8', (1 - ringK) * 0.4 * al);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 6 + ringK * 20, 0, TAU); ctx.stroke();
  }

  /* ── hover / selected：核膜外冷白标记环（选中再套一圈虚线） ── */
  function hoverMark(ctx, it) {
    if (!it.hovered && !it.selected) return;
    ctx.strokeStyle = it.selected ? ICE : hexA(ICE, 0.55);
    ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 6, 0, TAU); ctx.stroke();
    if (it.selected) {
      ctx.setLineDash([2, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 11, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  /* ── 完成未读：冷绿 done halo 慢脉动（r+9±3px，周期 ~3.5s）；keep 沿 1-viewK 渐熄 ── */
  function doneHalo(ctx, x, y, r, t, al, keep, phase) {
    if (keep <= 0.02) return;
    const ph = phase || 0;
    const hr = r + 9 + 3 * Math.sin(t * 1.8 + ph);
    ctx.strokeStyle = hexA(SESS['done-unread'], (0.22 + 0.14 * Math.sin(t * 1.8 + ph)) * al * keep);
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(x, y, hr, 0, TAU); ctx.stroke();
    drawGlow(ctx, SESS['done-unread'], x, y, r * 3.2, 0.18 * al * keep);
  }

  /* ── 等批准：钙闪（calcium flash）——暖色扩散环 + 白光核闪 + 常驻近环；
        强度乘色相滑移坡道 fade（mixFade(p, t, 'waiting')） ── */
  function waitingSignal(ctx, x, y, r, c, t, al, fade) {
    if (fade <= 0.02) return;
    const pulse = (t * 1.6) % 1;
    ctx.strokeStyle = hexA(SESS.waiting, (1 - pulse) * 0.62 * al * fade);
    ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.arc(x, y, r + 3 + pulse * 16, 0, TAU); ctx.stroke();
    drawGlow(ctx, '#ffffff', x, y, 20, (1 - pulse) * 0.45 * al * fade);
    ctx.strokeStyle = hexA(c, 0.5 * al * fade);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, r + 3.5, 0, TAU); ctx.stroke();
  }

  /* ── 卫星待决策：迷你钙闪（暖色光柱 + 扩散环；强度乘 bornK 与色相滑移坡道） ── */
  function satSignal(ctx, x, y, r, t, al) {
    if (al <= 0.02) return;
    const h = r * 2.6 + 6;
    const g = ctx.createLinearGradient(x, y - h, x, y);
    g.addColorStop(0, hexA(SESS.waiting, 0));
    g.addColorStop(1, hexA(SESS.waiting, 0.7 * al));
    ctx.strokeStyle = g;
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x, y - h); ctx.lineTo(x, y - 2); ctx.stroke();
    const pp = ((t * 22) % 10) / 10;
    ctx.strokeStyle = hexA(SESS.waiting, (1 - pp) * 0.5 * al);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, r + 2 + pp * 7, 0, TAU); ctx.stroke();
  }

  return {
    skin: 'fluoro',
    useBand: false,
    palette,
    gold: GOLD,
    bgStarColor,
    dustColors: DUST,

    background(ctx, view) {
      /* 暗场：纯黑底 + 极淡目镜晕（场中心微亮、场边缘压暗）+ 暗场尘点 */
      ctx.fillStyle = '#030304';
      ctx.fillRect(0, 0, view.W, view.H);
      const vg = ctx.createRadialGradient(
        view.W / 2, view.H / 2, 0,
        view.W / 2, view.H / 2, Math.max(view.W, view.H) * 0.7
      );
      vg.addColorStop(0, 'rgba(20,30,34,0.10)');
      vg.addColorStop(1, 'rgba(0,0,0,0.4)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, view.W, view.H);
      const bs = view.bgStars;
      for (let i = 0; i < bs.length; i++) {
        const s = bs[i];
        if (s.a < 0.03) continue;
        ctx.globalAlpha = clamp(s.a * 0.5, 0, 1);
        ctx.fillStyle = bgStarColor(s.m);
        const sz = 0.7 + s.m * 1.3;
        ctx.fillRect(s.x - sz / 2, s.y - sz / 2, sz, sz);
        if (s.m > 0.94) {
          /* 最亮尘点带一记十字衍射星芒（PSF 的十字旁瓣） */
          ctx.globalAlpha = clamp(s.a * 0.35, 0, 1);
          ctx.strokeStyle = ICE;
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.moveTo(s.x - 3, s.y); ctx.lineTo(s.x + 3, s.y);
          ctx.moveTo(s.x, s.y - 3); ctx.lineTo(s.x, s.y + 3);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    },

    drawBody(ctx, it, view) {
      const t = view.t;
      /* 器皿（D9）：双层细胞膜，每帧每星座仅绘一次 */
      if (it.ws && vesselOnce(it.ws, view.t)) drawVessel(ctx, it.ws);

      if (it.kind === 'dust') {
        /* 脂褐素自荧光颗粒（增量渐入：born 坡道 0.8s，存量粒子恒 1） */
        it.pts.forEach(function (p) {
          const bornK = dustBornK(p, t);
          ctx.globalAlpha = clamp(p.a * bornK * 0.4, 0, 1);
          ctx.fillStyle = DUST[p.hue < 0.5 ? 0 : 1];
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(0.7, p.s * 0.42), 0, TAU);
          ctx.fill();
        });
        ctx.globalAlpha = 1;
        return;
      }

      if (it.kind === 'constline') {
        /* 微管：波状细丝（8 段正弦 wobble）+ 马达蛋白点；段 α 坡道参与
           （新增段渐入 / 移除段渐熄幽灵） */
        it.segs.forEach(function (seg) {
          const a = seg.a, b = seg.b;
          const dx = b.x - a.x, dy = b.y - a.y;
          const len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len, ny = dx / len;
          const sa = it.alpha * segAlphaOf(seg);
          ctx.strokeStyle = hexA(MEMBRANE, 0.22 * sa);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          for (let j = 1; j <= 8; j++) {
            const q = j / 8;
            const wob = Math.sin(q * Math.PI * 3) * 1.6;
            ctx.lineTo(a.x + dx * q + nx * wob, a.y + dy * q + ny * wob);
          }
          ctx.stroke();
          ctx.fillStyle = MEMBRANE;
          ctx.globalAlpha = clamp(0.3 * sa, 0, 1);
          for (let k = 2; k < 8; k += 2) {
            const q2 = k / 8;
            const wob2 = Math.sin(q2 * Math.PI * 3) * 1.6;
            ctx.beginPath();
            ctx.arc(a.x + dx * q2 + nx * wob2, a.y + dy * q2 + ny * wob2, 1.1, 0, TAU);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        });
        return;
      }

      if (it.kind === 'orbit') {
        /* 胞内运输轨道：膜青点线 */
        ctx.strokeStyle = hexA(MEMBRANE, 0.12 * it.alpha);
        ctx.lineWidth = 1;
        ctx.setLineDash([1, 4]);
        ctx.beginPath();
        it.orbitPts.forEach(function (p, i) { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
        ctx.stroke();
        ctx.setLineDash([]);
        return;
      }

      if (it.kind === 'star') {
        const st = it.data || {};
        const lifecycle = st.lifecycle || 'created';
        const act = st.act || 0;
        const fx = it.fx;
        const bAl = birthAlphaOf(it);
        const seed = hashSeed(st.id);
        if (lifecycle === 'proto') {
          /* 星胚 = 未激发荧光核：虚线核膜 + 呼吸 + 淡核；点燃 = 荧光激发 */
          const phase = st.starIndex || 0;
          const breath = (Math.sin(t * 1.6 + phase) + 1) / 2;
          const igniteP = fx && fx.type === 'ignite' ? clamp((t - fx.t0) / fx.dur, 0, 1) : -1;
          if (igniteP >= 0 && igniteP > 0.55) {
            /* C 段：色相渐变到 created（荧光素被激发，冷亮接管） */
            const cMix = mix(PROP.proto, PROP.created, (igniteP - 0.55) / 0.45);
            drawNucleus(ctx, it.x, it.y, it.r, cMix, act, it.alpha * bAl, seed);
          } else {
            /* A 段：轮廓收缩（drawProtoNucleus 内按 igniteP∈[0,0.3] 收） */
            drawProtoNucleus(ctx, it.x, it.y, it.r, PROP.proto, it.alpha * bAl, phase, breath, igniteP, t);
          }
          if (igniteP >= 0.30 && igniteP < 0.75) {
            /* B 段：白光微爆闪（激发雪崩电离） */
            const fk = clamp((igniteP - 0.30) / 0.45, 0, 1);
            drawGlow(ctx, '#ffffff', it.x, it.y, it.r * 6.5, Math.sin(fk * Math.PI) * 0.9 * it.alpha * bAl);
          }
        } else {
          const c = PROP[lifecycle] || '#ffffff';
          drawNucleus(ctx, it.x, it.y, it.r, c, act, it.alpha * bAl, seed);
          if (lifecycle === 'reviewed') {
            /* 已审核：金章环 r+6；stamp fx 播放落印（×2.2→1 + α 淡入） */
            const stampP = fx && fx.type === 'stamp' ? clamp((t - fx.t0) / fx.dur, 0, 1) : -1;
            sealRing(ctx, it.x, it.y, it.r + 6, 0.85 * it.alpha * bAl, 1.4, stampP);
          }
        }
        /* 出生微爆闪（与点燃 B 段同语言、幅度减半）：k∈[0.15,0.65]；degraded 禁爆闪 */
        const birth = it.birth;
        if (birth && !birth.degraded && birth.k >= 0.15 && birth.k < 0.65) {
          const fk = (birth.k - 0.15) / 0.5;
          drawGlow(ctx, '#ffffff', it.x, it.y, it.r * 6.5,
            Math.sin(clamp(fk, 0, 1) * Math.PI) * 0.45 * it.alpha * bAl);
        }
        /* 已执行金涌：钙闪 + 金环外扩渐熄 */
        if (fx && fx.type === 'surge') goldSurge(ctx, it, t, it.alpha * bAl, fx);
        ctx.globalAlpha = 1;
        hoverMark(ctx, it);
        return;
      }

      if (it.kind === 'planet') {
        const p = it.data;
        const state = p.state;
        /* 色相滑移统一取色（D3）；查看渐熄把色向 done-unread 混 */
        let c2 = sessColor(palette, 'planet', state, p, t);
        const viewK = viewKOf(it, t);
        if (viewK > 0) c2 = mix(SESS['done-unread'], c2, viewK);
        const al = it.alpha * birthAlphaOf(it);
        const waitFade = mixFade(p, t, 'waiting');
        const doneFade = mixFade(p, t, 'done-unread');
        drawGlow(ctx, c2, it.x, it.y, Math.min(it.r * 3.6, 26), al * 0.55);
        trailStroke(ctx, it.trail, c2, 0.22, 0.5, 1.1, al);
        /* 线粒体：双膜胶囊（外膜 + 内膜两条轮廓）+ 3 条内嵴；轴向随运动方向 */
        const tr = it.trail;
        let ang = 0;
        if (tr && tr.length > 1) {
          ang = Math.atan2(tr[tr.length - 1].y - tr[tr.length - 2].y,
            tr[tr.length - 1].x - tr[tr.length - 2].x);
        }
        const len = Math.max(5, it.r * 2.8), wid = Math.max(2.4, it.r * 1.15);
        ctx.save();
        ctx.globalAlpha = clamp(al, 0, 1);
        ctx.translate(it.x, it.y);
        ctx.rotate(ang);
        capsulePath(ctx, len, wid);
        ctx.fillStyle = hexA(c2, 0.72);
        ctx.fill();
        ctx.strokeStyle = hexA(ICE, 0.38);
        ctx.lineWidth = 0.9;
        ctx.stroke();
        /* 内膜（双层线粒体被膜）：同轴收缩一条 */
        capsulePath(ctx, len * 0.84, wid * 0.74);
        ctx.strokeStyle = hexA(c2, 0.55);
        ctx.lineWidth = 0.7;
        ctx.stroke();
        /* 内嵴 */
        ctx.strokeStyle = 'rgba(4,8,12,0.42)';
        ctx.lineWidth = 0.8;
        for (let j = -1; j <= 1; j++) {
          ctx.beginPath();
          ctx.moveTo(j * len * 0.2, -wid * 0.26);
          ctx.lineTo(j * len * 0.2, wid * 0.26);
          ctx.stroke();
        }
        ctx.restore();
        ctx.globalAlpha = 1;
        if (p.delegatedBusy) {
          /* 委托忙碌微光环：膜外冷亮蓝青 α~0.25 慢呼吸（周期 ~2s） */
          const busyA = 0.25 * (0.5 + 0.5 * Math.sin(t * Math.PI));
          ctx.strokeStyle = hexA(SESS.busy, busyA * al);
          ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 11, 0, TAU); ctx.stroke();
        }
        if (state === 'done-unread' || viewK > 0) {
          doneHalo(ctx, it.x, it.y, it.r, t, al, (1 - viewK) * doneFade, p.phase);
        }
        if (state === 'waiting') waitingSignal(ctx, it.x, it.y, it.r, c2, t, al, waitFade);
        hoverMark(ctx, it);
        return;
      }

      if (it.kind === 'suborbit') {
        /* 卫星子轨道虚线环 `[3,5]`（色随父天体状态，0.28α） */
        const oc = SESS[it.data && it.data.state] || SESS.idle;
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
        /* 小囊泡（卫星）：四态色向灰蓝收 30% + 弧形膜高光 + 尾迹；
           出生坡道 bornK：α×bornK、半径 0→满（easeOutK 短尾）；不参与拾取 */
        const s = it.data;
        const bornK = satBornKOf(it);
        const rF = easeOutK(bornK);
        const c4 = mix(sessColor(palette, 'sat', s.state, s, t), '#6f8291', 0.3);
        trailStroke(ctx, it.trail, c4, 0.22, 0.5, 1.0, it.alpha * bornK);
        drawGlow(ctx, c4, it.x, it.y, it.r * 2.6, it.alpha * bornK * 0.45);
        ctx.globalAlpha = clamp(it.alpha * bornK, 0, 1);
        ctx.fillStyle = c4;
        ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(1.3, it.r * rF), 0, TAU); ctx.fill();
        ctx.strokeStyle = hexA(ICE, 0.5);
        ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(1.1, it.r * rF), -2.3, -1.15); ctx.stroke();
        ctx.globalAlpha = 1;
        if (s.state === 'waiting') {
          satSignal(ctx, it.x, it.y, it.r, t, it.alpha * bornK * mixFade(s, t, 'waiting'));
        }
        return;
      }

      if (it.kind === 'comet') {
        const c = it.data;
        const state = c.state;
        /* 四态色：待机保持身份色 free（add-comet-states 既有语义），非 idle 覆盖状态色 */
        let c3 = sessColor(palette, 'comet', state, c, t);
        const viewK = viewKOf(it, t);
        if (viewK > 0) c3 = mix(SESS['done-unread'], c3, viewK);
        /* 出生游入：尾迹先现（trailAlpha）、核后亮（alpha）；degraded 纯 α 坡道 */
        const birth = it.birth;
        const bCore = birth ? birth.alpha : 1;
        const bTrail = birth ? birth.trailAlpha : 1;
        const waitFade = mixFade(c, t, 'waiting');
        const doneFade = mixFade(c, t, 'done-unread');
        trailStroke(ctx, it.trail, c3, 0.3, 0.5, 1.3, it.alpha * bTrail);
        drawGlow(ctx, c3, it.x, it.y, Math.min(it.r * 3.6, 24), it.alpha * bCore * 0.6);
        /* 游离囊泡：双层膜 + 腔内货物 */
        const rr = Math.max(1.8, it.r * 0.62);
        ctx.globalAlpha = clamp(it.alpha * bCore, 0, 1);
        ctx.fillStyle = hexA(c3, 0.7);
        ctx.beginPath(); ctx.arc(it.x, it.y, rr, 0, TAU); ctx.fill();
        ctx.strokeStyle = hexA(ICE, 0.45);
        ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.arc(it.x, it.y, rr, 0, TAU); ctx.stroke();
        ctx.strokeStyle = hexA(c3, 0.6);
        ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(0.8, rr * 0.6), 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
        if (c.delegatedBusy) {
          /* 委托忙碌微光环（行星同款三行）：膜外冷亮蓝青慢呼吸 */
          const busyA = 0.25 * (0.5 + 0.5 * Math.sin(t * Math.PI));
          ctx.strokeStyle = hexA(SESS.busy, busyA * it.alpha * bCore);
          ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 11, 0, TAU); ctx.stroke();
        }
        if (state === 'done-unread' || viewK > 0) {
          doneHalo(ctx, it.x, it.y, it.r, t, it.alpha * bCore, (1 - viewK) * doneFade, c.phase);
        }
        if (state === 'waiting') waitingSignal(ctx, it.x, it.y, it.r, c3, t, it.alpha * bCore, waitFade);
        return;
      }

      if (it.kind === 'wsghost') {
        /* 星座消散幽灵（D5）：脂褐素颗粒外扩漂散 + 核余辉渐熄（与场景实体解耦，
           不乘 ws.alpha；尘埃 born 坡道同 dust 分支） */
        it.dust.forEach(function (p) {
          const bornK = dustBornK(p, t);
          ctx.globalAlpha = clamp(p.a * bornK * 0.4, 0, 1);
          ctx.fillStyle = DUST[p.hue < 0.5 ? 0 : 1];
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(0.7, p.s * 0.42), 0, TAU);
          ctx.fill();
        });
        ctx.globalAlpha = 1;
        it.stars.forEach(function (st) {
          drawGlow(ctx, st.color, st.x, st.y, Math.min(st.r * 3.0, 40), st.a * 0.55);
          ctx.globalAlpha = clamp(st.a * 0.7, 0, 1);
          ctx.fillStyle = st.color;
          ctx.beginPath(); ctx.arc(st.x, st.y, Math.max(1, st.r * 0.4), 0, TAU); ctx.fill();
          ctx.globalAlpha = 1;
        });
        return;
      }

      if (it.kind === 'nova') {
        /* 超新星 = 荧光染料光漂白爆闪（引擎级幽灵条目）：
           常规三段式 A 核膨胀 → B 冲击波 + 放射火花 → C 坍缩归尘（B/C 时窗有意重叠）；
           intensity<0.5 = 星胚低强度消散变体（0.8s）；degraded = 风暴降级渐熄最小形态。 */
        const n = it.data;
        const base = it.r;
        const seed = hashSeed(n.id);
        if (n.degraded) {
          /* 降级最小形态（D7）：辉光衰减 + 少量残骸外散，跳过火花与冲击环 */
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
            ctx.arc(it.x + Math.cos(ang) * d, it.y + Math.sin(ang) * d, 0.9, 0, TAU);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
          return;
        }
        if (n.intensity < 0.5) {
          /* 星胚消散变体：虚线轮廓放大淡出 + 淡核收缩 + 少量微粒 puff */
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
            ctx.fillStyle = hexA(n.color, 0.8);
            ctx.beginPath();
            ctx.arc(it.x + Math.cos(ang) * d, it.y + Math.sin(ang) * d, 1.1, 0, TAU);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
          return;
        }
        const el = it.k * n.dur;
        /* A 引爆（0–0.5s）：核心膨胀 ×1→×3.5 + 色向白炽偏移（mix ≤0.7）；
           C 坍缩（0.9s 起）收缩熄灭。 */
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
        /* B 冲击波（0.3–1.1s）：双扩散环（半径至 ×4）+ 10 放射火花（错峰起爆） */
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
            const len2 = 12 + hashRand(seed + i * 3.1) * 14;
            const d0 = base * lerp(1, 4, easeOutK(sk));
            ctx.strokeStyle = hexA(mix(n.color, '#ffffff', 0.5), (1 - sk) * 0.8);
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(it.x + Math.cos(ang) * d0, it.y + Math.sin(ang) * d0);
            ctx.lineTo(it.x + Math.cos(ang) * (d0 + len2), it.y + Math.sin(ang) * (d0 + len2));
            ctx.stroke();
          }
          ctx.lineCap = 'butt';
        }
        /* C 坍缩归尘（0.9–dur）：13 粒脂褐素残骸向 drift 快照点漂移渐散（无快照 → 原位外散） */
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
        /* 流星 = 荧光微球拖尾 */
        trailStroke(ctx, it.trail, '#dff2ff', 0.55, 0.5, 1.6, it.alpha);
        drawGlow(ctx, '#ffffff', it.x, it.y, 11, it.alpha);
      }
    }
  };
}
