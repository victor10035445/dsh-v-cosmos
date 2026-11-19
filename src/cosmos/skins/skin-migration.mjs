/**
 * 皮肤 · 雁阵暮色 Migration（add-cosmos-skin-themes 1.4）。
 *
 * 血统：demo/skins/assets/skin-migration.js（圆括号 IIFE + `window.COSMOS_SKINLIB` 全局 +
 * `COSMOS_SKINLIB.define`）。移植口径按 design D5 词汇映射：`it.data.status` →
 * `it.data.lifecycle`（draft/in-progress/complete → proto/created/reviewed/executed）、
 * 会话态 `done` → `done-unread`、连线段 `[a, b]` 数组形 → `{a, b, alpha}` 对象形、
 * 去 `captionHTML`（SRC 侧无消费点）。条目形状以引擎 `skin-d.mjs` 为准。
 *
 * 隐喻：星座 = 上升暖气流区（暮色热气流椭圆 + 层叠上升弧线）· 恒星 = 头雁（星胚 = 灰蓝
 * 翎环 / 已创建 = 冷亮振翅 / 已审核 = 金章落印 / 已执行 = 金羽落定）· 行星 = 盘旋雁群
 * （切向朝向 + 振翅）· 彗星 = 孤雁迁徙 · 星云 = 椋鸟鸟浪 murmuration（活体涌动）·
 * 连线 = 航线 · 等批准 = 俯冲警示（压翼加速 + 暖橙尾迹）。
 *
 * 视觉：暮色四渐层 + 落日余晖 + 层云 + 双道山脊剪影 + 书法式两笔翼 stroke——剪影美学，
 * 拒绝简笔。
 *
 * 转场本地化：ignite = 翎环收缩（A）→ 白光微爆闪（B）→ 色相渐变到 created（C）；
 * stamp = 金章环 ×2.2→1 落印；surge = 金羽自顶点旋转落定 + 金环外扩渐熄（sin 包络）；
 * 出生 = α 坡道（degraded 只走坡道、禁爆闪）；view 渐熄 = 颜色混向 done-unread 且 halo
 * 沿 1-viewK 消退；nova = 常规三段式 / 星胚消散 / 风暴降级渐熄三形态。
 *
 * 结构：`createVesselGuard()` 实现「每帧每星座一次的器皿绘制」（design D9）——守卫状态存
 * 皮肤实例闭包，`setSkin` 换实例即自然重置，MUST NOT 挂引擎。
 */

import {
  TAU, clamp, lerp, easeOutK, mix, hexA, hashSeed, hashRand,
  makeGlowCache, trailStroke, sessColor, mixFade, viewKOf, birthAlphaOf, segAlphaOf,
  dustBornK, satBornKOf, createVesselGuard, vesselAnchor,
  makeDustSprite, dustBatchDraw, patDotDraw
} from '../skin-kit.mjs';

/* ── 肤色（暮色紫橙主调；design D5 词汇映射后的四态 / 五态） ── */
const CREATED = '#8fb6e8';   // 冷亮：暮色里未沉的那抹天光（demo draft 的冷支提亮）
const EXECUTED = '#ffd27a';  // 金域：demo complete（暮色紫橙主调下的暖金）
const GOLD = '#ffc46a';      // demo GOLD：金章环 / 金羽 / 选中环
const INK = '#141018';       // demo INK：山脊剪影的墨色
const DIM = '#707c9c';       // 卫星降饱和的灰蓝去向（states-core dim 同款）

const PROP = Object.freeze({
  proto: '#8c9aa8',                          // 低饱和灰蓝：待创建星胚（暮空里的哑灰翎环）
  created: CREATED,                          // 冷亮
  reviewed: mix(CREATED, '#ffffff', 0.34),   // 冷亮升亮（+34% 白，派生而非硬编码）
  executed: EXECUTED                         // 金域：demo complete
});

const SESS = Object.freeze({
  idle: '#5a5a74',          // 中性灰：盘旋雁待机
  busy: '#6a9ad0',          // 冷亮蓝青：在飞
  waiting: '#ffb056',       // 恒暖：等批准（俯冲警示）
  'done-unread': '#5ab89a', // 恒冷绿：完成未读（demo `done` 更名）
  free: '#c8c8d8'           // 中性浅灰：彗星 idle 身份色
});

const DUST = Object.freeze(['#181022', '#3a2438']); // 鸟浪尘埃双色（暮色暗部）

/* ---------- 剪影母语（模块级纯几何；无 DOM、无实例状态） ---------- */

/** 书法雁：两笔翼 stroke + 身（demo 母语逐字保留）。
 *  flap ∈ [-1,1] 控制翼梢扬抑；ang = 航向（航向随速度方向 = 切向朝向）。 */
function bird(ctx, x, y, s, flap, ang, color, alpha) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1, s * 0.26);
  const drop = flap;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(-s * 0.45, -s * (0.5 + drop * 0.22), -s * 1.05, -s * (0.22 + drop * 0.5));
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(s * 0.45, -s * (0.5 + drop * 0.22), s * 1.05, -s * (0.22 + drop * 0.5));
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.3, s * 0.13, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
  ctx.globalAlpha = 1;
}

/** 金羽：一枚羽自顶点旋转落定（executed 金涌母语）。羽轴 + 两笔羽枝。 */
function feather(ctx, x, y, s, ang, color, alpha) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(0.9, s * 0.15);
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.quadraticCurveTo(s * 0.18, 0, 0, s);
  ctx.stroke();
  ctx.lineWidth = Math.max(0.7, s * 0.11);
  for (let i = 0; i < 2; i++) {
    const sx = i === 0 ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.82);
    ctx.quadraticCurveTo(sx * s * 0.46, -s * 0.05, 0, s * 0.66);
    ctx.stroke();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

/** 航向 = 尾迹末段速度方向（切向朝向；尾迹不足两点 → 0）。 */
function trailAngle(tr) {
  if (!tr || tr.length < 2) return 0;
  return Math.atan2(tr[tr.length - 1].y - tr[tr.length - 2].y, tr[tr.length - 1].x - tr[tr.length - 2].x);
}

/** 振翅相位：t 驱动，振幅 / 频率随 act 热度上扬（鸟浪涌动）。 */
function flapOf(t, act, phase) {
  return Math.sin(t * (2.2 + act * 4.3) + phase) * (0.2 + act * 0.62);
}

/** 山脊剪影：远脊淡、近脊实（暮色里的两道墨色边）。 */
function ridges(ctx, W, H) {
  ctx.fillStyle = hexA(INK, 0.5);
  ctx.beginPath();
  ctx.moveTo(0, H);
  const fy = H * 0.87;
  ctx.lineTo(0, fy + 10);
  ctx.quadraticCurveTo(W * 0.2, fy - 20, W * 0.4, fy + 6);
  ctx.quadraticCurveTo(W * 0.62, fy + 22, W * 0.82, fy - 10);
  ctx.quadraticCurveTo(W * 0.93, fy - 20, W, fy + 6);
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = hexA(INK, 0.85);
  ctx.beginPath();
  ctx.moveTo(0, H);
  const ny = H * 0.94;
  ctx.lineTo(0, ny + 6);
  ctx.quadraticCurveTo(W * 0.22, ny - 16, W * 0.42, ny + 2);
  ctx.quadraticCurveTo(W * 0.62, ny + 16, W * 0.78, ny - 6);
  ctx.quadraticCurveTo(W * 0.9, ny - 14, W, ny + 6);
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();
}

/** 创建雁阵暮色皮肤实例（每次调用独立 glow 缓存 + 独立器皿守卫）。 */
export function createSkinMigration() {
  const glow = makeGlowCache();
  const dustBrush = makeDustSprite(); // 尘埃 sprite 缓存（每皮肤实例独立，防跨皮肤串色）
  const palette = { prop: PROP, sess: SESS };
  const vesselOnce = createVesselGuard();

  function drawGlow(ctx, hex, x, y, R, a) { glow.draw(ctx, hex, x, y, R, a); }

  /* ── 器皿：暮色热气流区（暖流椭圆 + 层叠上升弧线 + 两道「人」字航迹；
        每帧每星座一次，锚点缺失（ws.proj 未就绪）直接 return） ── */
  function drawVessel(ctx, ws) {
    const p = vesselAnchor(ws);
    if (!p) return;
    const rx = 96 * p.s, ry = rx * 0.34;
    if (rx < 12) return;
    const x = p.x, y = p.y;
    /* 暖流底：两支暮色（暖褐 / 暗紫）按星座 id 定色——气流也有自己的天色 */
    const tint = hashSeed(ws.id) % 2 === 0 ? '96,52,40' : '58,38,72';
    ctx.fillStyle = 'rgba(' + tint + ',0.24)';
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,196,106,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(x, y, rx * 0.84, ry * 0.84, 0, 0, TAU); ctx.stroke();
    /* 层叠上升弧线：两道错高的气流（越外越淡），弧口朝上 */
    for (let i = 0; i < 2; i++) {
      ctx.strokeStyle = 'rgba(255,196,106,' + (0.18 - i * 0.05).toFixed(3) + ')';
      ctx.lineWidth = 1.1 - i * 0.25;
      ctx.beginPath();
      ctx.ellipse(x, y - ry * (0.2 + i * 0.34), rx * (0.64 + i * 0.18), ry * (0.62 + i * 0.2),
        0, Math.PI * 1.06, Math.PI * 1.74);
      ctx.stroke();
    }
    /* 气流顶缘暖光（上升最亮的一段） */
    ctx.strokeStyle = 'rgba(255,214,150,0.28)';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, Math.PI * 1.12, Math.PI * 1.66); ctx.stroke();
    /* 两道「人」字航迹挂在气流上方（雁阵的排队方向；合为一条 path 一次 stroke） */
    ctx.strokeStyle = 'rgba(255,214,150,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let j = 0; j < 2; j++) {
      const cx = x + (j === 0 ? -rx * 0.16 : rx * 0.24);
      const cy = y - ry * (1.15 + j * 0.55);
      const w = rx * (0.1 - j * 0.02);
      ctx.moveTo(cx - w, cy); ctx.lineTo(cx, cy - w * 0.72); ctx.lineTo(cx + w, cy);
    }
    ctx.stroke();
  }

  /* ── 星胚（待创建头雁的翎环）：虚线 [4,5] + 呼吸 + 淡核；
        igniteP∈[0,0.3] 翎环收缩（点燃 A 段，B/C 段由调用方接棒） ── */
  function protoRing(ctx, x, y, r, c, t, al, phase, igniteP) {
    const breath = (Math.sin(t * 1.6 + phase) + 1) / 2;
    drawGlow(ctx, c, x, y, r * 3.0, al * (0.14 + breath * 0.1));
    ctx.globalAlpha = al * 0.5;
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(x, y, Math.max(1.2, r * 0.38), 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    const contract = igniteP >= 0 ? easeOutK(clamp(igniteP / 0.3, 0, 1)) : 0;
    const ro = igniteP >= 0 ? lerp(r + 5, r * 0.6, contract) : r + 5 + breath * 2;
    const oa = igniteP >= 0 ? 0.5 + contract * 0.4 : 0.45 + breath * 0.25;
    ctx.save();
    ctx.strokeStyle = hexA(c, oa * al);
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 5]);
    ctx.lineDashOffset = -t * 8;
    ctx.beginPath(); ctx.arc(x, y, ro, 0, TAU); ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = al * 0.3;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(x, y, Math.max(0.7, r * 0.14), 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }

  /* ── 已审核金章环（r+6）：stampP≥0 播放落印（半径 ×2.2→1 easeOut + α 淡入） ── */
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

  /* ── 俯冲警示（等批准）：琥珀扩散环 + 两道错峰俯冲气流（压翼加速的尾流） ── */
  function diveSignal(ctx, x, y, r, c, t, al, fade, seed) {
    const rr = r + 3 + ((t * 26) % 16);
    ctx.strokeStyle = hexA(c, clamp(0.65 * (1 - (rr - r - 3) / 16), 0, 1) * al * fade);
    ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.stroke();
    ctx.lineCap = 'round';
    for (let i = 0; i < 2; i++) {
      const k = (t * 0.9 + hashRand(seed + i * 13.7) * 7) % 1;
      const d0 = r + 3 + k * r * 1.8;
      ctx.strokeStyle = hexA(c, (1 - k) * 0.45 * al * fade);
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(x - d0 * 0.62, y - d0 * 0.78);
      ctx.lineTo(x - d0 * 0.3, y - d0 * 0.36);
      ctx.stroke();
    }
  }

  /* ── 完成未读 halo：冷绿慢脉动（r+9±3px，周期 ~3.5s）；view 渐熄沿 keep 消退 ── */
  function doneHalo(ctx, x, y, r, t, al, keep, phase) {
    if (keep <= 0.02) return;
    const ph = phase || 0;
    const hr = r + 9 + 3 * Math.sin(t * 1.8 + ph);
    ctx.strokeStyle = hexA(SESS['done-unread'], (0.22 + 0.14 * Math.sin(t * 1.8 + ph)) * al * keep);
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, hr, 0, TAU); ctx.stroke();
    drawGlow(ctx, SESS['done-unread'], x, y, r * 3.2, 0.16 * al * keep);
  }

  function hoverMark(ctx, it) {
    if (!it.hovered && !it.selected) return;
    ctx.strokeStyle = it.selected ? GOLD : hexA(GOLD, 0.5);
    ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 6, 0, TAU); ctx.stroke();
    if (it.selected) {
      ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 11, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function bgStar(m) { return m > 0.9 ? '#ffe9cf' : m > 0.5 ? '#e8dcc8' : '#b4aab8'; }

  return {
    skin: 'migration',
    useBand: false,
    palette,
    gold: GOLD,
    bgStarColor(m) { return bgStar(m); },
    dustColors: DUST,

    background(ctx, view) {
      /* 暮色四渐层：靛紫天顶 → 绛紫 → 赤褐 → 地平暖橙 */
      const g = ctx.createLinearGradient(0, 0, 0, view.H);
      g.addColorStop(0, '#191333');
      g.addColorStop(0.5, '#34203c');
      g.addColorStop(0.8, '#6a3630');
      g.addColorStop(1, '#b85a32');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, view.W, view.H);
      /* 落日余晖（地平线以上的暖晕） */
      const hg = ctx.createRadialGradient(view.W / 2, view.H, 0, view.W / 2, view.H, view.W * 0.62);
      hg.addColorStop(0, 'rgba(240,150,80,0.16)');
      hg.addColorStop(1, 'rgba(240,150,80,0)');
      ctx.fillStyle = hg;
      ctx.fillRect(0, 0, view.W, view.H);
      /* 层云：横陈暮云（缓移，sub-pixel 相位由 t 驱动） */
      for (let c = 0; c < 4; c++) {
        const cy = view.H * (0.22 + 0.16 * c);
        const cw = view.W * (0.5 + 0.14 * (c % 3));
        ctx.fillStyle = 'rgba(20,16,40,0.10)';
        ctx.beginPath();
        ctx.ellipse(view.W * (0.3 + 0.18 * c) + Math.sin(view.t * 0.03 + c) * 20, cy, cw, view.H * 0.022, 0, 0, TAU);
        ctx.fill();
      }
      /* 山脊剪影（远脊 + 近脊） */
      ridges(ctx, view.W, view.H);
      /* 早星：只留山脊以上（低空的被暮色吃掉了） */
      const bs = view.bgStars;
      for (let i = 0; i < bs.length; i++) {
        const s = bs[i];
        if (s.a < 0.04 || s.y > view.H * 0.68) continue;
        const c = bgStar(s.m);
        ctx.globalAlpha = s.a * 0.75;
        ctx.fillStyle = c;
        ctx.fillRect(s.x - 0.5, s.y - 0.5, 1.2, 1.2);
        if (s.m > 0.94) {
          /* 天顶最亮的那几颗带十字芒（暮色里唯一锐利的东西） */
          ctx.globalAlpha = s.a * 0.45;
          ctx.strokeStyle = c;
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
      /* 器皿（D9）：同一帧同一星座只画一次气流区 */
      if (it.ws && vesselOnce(it.ws, t)) drawVessel(ctx, it.ws);

      if (it.kind === 'dust') {
        /* 鸟浪 murmuration：活体涌动的小点群——方点 sprite 批量 + 逐粒换位抖动
           （posX/posY 母语参数；born 坡道 0.8s 沿用）。 */
        dustBatchDraw(dustBrush, ctx, it.pts, DUST, t, {
          shape: 'square', alphaK: 0.5, radiusK: 0, minR: 0.6,
          posX: function (p, tt) { return p.x + Math.sin(tt * 1.3 + p.hue * 21) * 1.6; },
          posY: function (p, tt) { return p.y + Math.cos(tt * 1.1 + p.hue * 33) * 1.2; }
        });
        return;
      }

      if (it.kind === 'constline') {
        /* 航线：暖白虚线（每段 α 乘段坡道——新增段渐入 / 移除段渐熄幽灵） */
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        it.segs.forEach(function (seg) {
          const sa = it.alpha * segAlphaOf(seg);
          ctx.strokeStyle = 'rgba(232,210,180,' + (0.24 * sa).toFixed(3) + ')';
          ctx.beginPath();
          ctx.moveTo(seg.a.x, seg.a.y);
          ctx.lineTo(seg.b.x, seg.b.y);
          ctx.stroke();
        });
        ctx.setLineDash([]);
        return;
      }

      if (it.kind === 'patdot') {
        /* 空槽装饰点（add-cosmos-template-figure-display 3.2）：航线顶点微标——
           暖白、基线 0.24（= 本皮肤航线基线），点弱化因子由引擎下发；
           纯装饰（不进 picks / 无 hover / 无名牌）。 */
        patDotDraw(ctx, it, '#e8d2b4', 0.24);
        return;
      }

      if (it.kind === 'orbit') {
        /* 雁阵航线环：极淡虚线（不抢头雁） */
        ctx.strokeStyle = hexA('#e8d2b4', 0.1 * it.alpha);
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 6]);
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
        const phase = st.starIndex || 0;
        const bAl = birthAlphaOf(it);
        const al = it.alpha * bAl;
        if (lifecycle === 'proto') {
          /* 星胚 = 待创建头雁的灰蓝翎环；ignite 三段：A 收缩 / B 爆闪 / C 色相渐变 */
          const igniteP = fx && fx.type === 'ignite' ? clamp((t - fx.t0) / fx.dur, 0, 1) : -1;
          if (igniteP >= 0 && igniteP > 0.55) {
            /* C 段：色相渐变到 created，雁形接棒（翎环散、头雁起） */
            const cC = mix(PROP.proto, PROP.created, (igniteP - 0.55) / 0.45);
            drawGlow(ctx, cC, it.x, it.y, Math.min(it.r * 5.2, 64), al * (0.26 + act * 0.26));
            bird(ctx, it.x, it.y, Math.max(3.4, it.r * 1.15), flapOf(t, act, phase), -0.1, cC, al);
          } else {
            protoRing(ctx, it.x, it.y, it.r, PROP.proto, t, al, phase, igniteP);
          }
          if (igniteP >= 0.30 && igniteP < 0.75) {
            /* B 段：白光微爆闪（点燃的瞬间） */
            const fk = (igniteP - 0.30) / 0.45;
            drawGlow(ctx, '#ffffff', it.x, it.y, it.r * 6.5,
              Math.sin(clamp(fk, 0, 1) * Math.PI) * 0.9 * it.alpha);
          }
        } else {
          const c = PROP[lifecycle] || '#ffffff';
          const s = Math.max(3.4, it.r * 1.15);
          const flap = flapOf(t, act, phase);
          /* act 热度：白热 + 振翅加速（鸟浪涌动），executed 保持金域不被漂白 */
          const col = act > 0 && lifecycle !== 'executed' ? hexA('#ffffff', 0.92) : c;
          drawGlow(ctx, c, it.x, it.y, Math.min(it.r * 5.2, 64), al * (0.26 + act * 0.26));
          bird(ctx, it.x, it.y, s, flap, -0.1, col, al);
          if (lifecycle === 'executed') {
            /* 金羽描边：同翼形上移 1px 的金色回声（demo complete 母语） */
            bird(ctx, it.x, it.y - 1, s * 1.04, flap * 0.9, -0.1, hexA(GOLD, 0.25), al * 0.7);
          }
          if (lifecycle === 'reviewed') {
            /* 金章环 r+6：stamp 播放落印（半径 ×2.2→1 + α 淡入），随态常驻 */
            const stampP = fx && fx.type === 'stamp' ? clamp((t - fx.t0) / fx.dur, 0, 1) : -1;
            sealRing(ctx, it.x, it.y, it.r + 6, 0.85 * it.alpha, 1.4, stampP);
          }
        }
        /* 出生微爆闪：k∈[0.15,0.65]；degraded 只走纯 α 坡道（禁爆闪） */
        if (it.birth && !it.birth.degraded && it.birth.k >= 0.15 && it.birth.k < 0.65) {
          const fk = (it.birth.k - 0.15) / 0.5;
          drawGlow(ctx, '#ffffff', it.x, it.y, it.r * 6.5,
            Math.sin(clamp(fk, 0, 1) * Math.PI) * 0.45 * it.alpha * bAl);
        }
        /* executed 金涌母语化 = 金羽落定：自顶点旋转落下 + 金环外扩渐熄（sin 包络，1.2s） */
        if (fx && fx.type === 'surge') {
          const el = t - fx.t0;
          if (el > 0) {
            const kk = clamp(el / fx.dur, 0, 1);
            const env = Math.sin(kk * Math.PI);
            drawGlow(ctx, PROP.executed, it.x, it.y,
              Math.min(it.r * 5.4 * lerp(2.2, 1, easeOutK(kk)), 150), env * 0.8 * it.alpha);
            /* 金羽：顶点（y - r×2.4）随 easeOut 落到星位，边落边转正 */
            feather(ctx,
              it.x + Math.sin(kk * Math.PI) * it.r * 0.6,
              lerp(it.y - it.r * 2.4, it.y, easeOutK(kk)),
              Math.max(3.2, it.r * 0.9), lerp(-1.0, 0.22, easeOutK(kk)),
              GOLD, 0.85 * env * it.alpha);
            /* 金环外扩渐熄 */
            const ringK = easeOutK(clamp(el / (fx.dur * 0.6), 0, 1));
            ctx.strokeStyle = hexA(GOLD, (1 - ringK) * 0.85 * it.alpha);
            ctx.lineWidth = 1.6;
            ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 6 + ringK * 26, 0, TAU); ctx.stroke();
          }
        }
        ctx.globalAlpha = 1;
        hoverMark(ctx, it);
        return;
      }

      if (it.kind === 'planet') {
        /* 盘旋雁：切向朝向 + 振翅；等批准 = 压翼俯冲 + 暖橙尾迹 */
        const p = it.data || {};
        const state = p.state;
        let c2 = sessColor(palette, 'planet', state, p, t);
        const viewK = viewKOf(it, t);
        if (viewK > 0) c2 = mix(SESS['done-unread'], c2, viewK);
        const al = it.alpha * birthAlphaOf(it);
        const waitFade = mixFade(p, t, 'waiting');
        const doneFade = mixFade(p, t, 'done-unread');
        const ang = trailAngle(it.trail);
        const s = Math.max(2.4, it.r);
        drawGlow(ctx, c2, it.x, it.y, Math.min(it.r * 4, 30), al * 0.6);
        /* 尾迹随航向：等批准态 c2 即暖橙 SESS.waiting（加速俯冲的尾焰） */
        trailStroke(ctx, it.trail, c2, 0.26, 0.5, 1.2, al);
        if (state === 'waiting') {
          /* 俯冲：压翼（flap -0.9）+ 航向前压 + 琥珀扩散环／俯冲气流 */
          bird(ctx, it.x, it.y, s * 1.12, -0.9, ang + 0.5, c2, al);
          diveSignal(ctx, it.x, it.y, it.r, c2, t, al, waitFade, 7.7);
        } else {
          bird(ctx, it.x, it.y, s, Math.sin(t * 5.5 + (p.phase || 0)) * 0.7, ang, c2, al);
        }
        /* 盘旋空域环 */
        ctx.strokeStyle = hexA(c2, 0.3 * al);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 3.5, 0, TAU); ctx.stroke();
        if (p.delegatedBusy) {
          /* 委托忙碌微光环：空域环外青蓝 α~0.25 慢呼吸（周期 ~2s） */
          const busyA = 0.25 * (0.5 + 0.5 * Math.sin(t * Math.PI));
          ctx.strokeStyle = hexA(SESS.busy, busyA * al);
          ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 11, 0, TAU); ctx.stroke();
        }
        if (state === 'done-unread' || viewK > 0) {
          doneHalo(ctx, it.x, it.y, it.r, t, al, (1 - viewK) * doneFade, p.phase);
        }
        ctx.globalAlpha = 1;
        hoverMark(ctx, it);
        return;
      }

      if (it.kind === 'suborbit') {
        /* 卫星子航线圈：细虚线，色随父天体状态 */
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
        /* 幼雁（卫星）：一笔「人」字翼 + 核点；born 坡道 → α×bornK、半径 0→满 */
        const s = it.data || {};
        const bornK = satBornKOf(it);
        const rF = easeOutK(bornK);
        const c4 = mix(sessColor(palette, 'sat', s.state, s, t), DIM, 0.3);
        trailStroke(ctx, it.trail, c4, 0.22, 0.5, 1.0, it.alpha * bornK);
        drawGlow(ctx, c4, it.x, it.y, it.r * 2.6, it.alpha * bornK * 0.45);
        const al4 = it.alpha * bornK;
        const w = Math.max(1.6, it.r * rF * 1.4);
        ctx.strokeStyle = hexA(c4, 0.9 * al4);
        ctx.lineWidth = 0.9;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(it.x - w, it.y + w * 0.42);
        ctx.lineTo(it.x, it.y - w * 0.5);
        ctx.lineTo(it.x + w, it.y + w * 0.42);
        ctx.stroke();
        ctx.globalAlpha = al4;
        ctx.fillStyle = c4;
        ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(0.9, it.r * rF * 0.55), 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        if (s.state === 'waiting') {
          /* 待决策幼雁：琥珀迷你光柱 + 迷你扩散环（强度乘 bornK 与色相滑移坡道） */
          const satFade = bornK * mixFade(s, t, 'waiting');
          const h = it.r * 2.6 + 6;
          const g2 = ctx.createLinearGradient(it.x, it.y - h, it.x, it.y);
          g2.addColorStop(0, hexA(SESS.waiting, 0));
          g2.addColorStop(1, hexA(SESS.waiting, 0.7 * it.alpha * satFade));
          ctx.strokeStyle = g2; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.moveTo(it.x, it.y - h); ctx.lineTo(it.x, it.y - 2); ctx.stroke();
          const pp = ((t * 22) % 10) / 10;
          const rr = it.r + 2 + pp * 7;
          ctx.strokeStyle = hexA(SESS.waiting, (1 - pp) * 0.5 * it.alpha * satFade);
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(it.x, it.y, rr, 0, TAU); ctx.stroke();
        }
        return;
      }

      if (it.kind === 'comet') {
        /* 孤雁迁徙：长尾迹 + 两笔翼；四态色（idle 保持 free 身份色） */
        const c = it.data || {};
        const state = c.state;
        let c3 = sessColor(palette, 'comet', state, c, t);
        const viewK = viewKOf(it, t);
        if (viewK > 0) c3 = mix(SESS['done-unread'], c3, viewK);
        /* 出生游入：尾迹先现（trailAlpha 快渐入）、核后亮（alpha 延后坡道） */
        const birth = it.birth || null;
        const bCore = birth ? birth.alpha : 1;
        const bTrail = birth ? birth.trailAlpha : 1;
        const waitFade = mixFade(c, t, 'waiting');
        const doneFade = mixFade(c, t, 'done-unread');
        trailStroke(ctx, it.trail, c3, 0.45, 0.6, 1.8, it.alpha * bTrail);
        drawGlow(ctx, c3, it.x, it.y, Math.min(it.r * 3.8, 26), it.alpha * bCore * 0.8);
        bird(ctx, it.x, it.y, Math.max(2.6, it.r),
          Math.sin(t * 4.5 + (c.phase || 0)) * 0.75, trailAngle(it.trail), c3, it.alpha * bCore);
        if (c.delegatedBusy) {
          /* 委托忙碌微光环（行星分支同款）：空域外青蓝慢呼吸 */
          const busyA = 0.25 * (0.5 + 0.5 * Math.sin(t * Math.PI));
          ctx.strokeStyle = hexA(SESS.busy, busyA * it.alpha * bCore);
          ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 11, 0, TAU); ctx.stroke();
        }
        if (state === 'done-unread' || viewK > 0) {
          doneHalo(ctx, it.x, it.y, it.r, t, it.alpha * bCore, (1 - viewK) * doneFade, c.phase);
        }
        if (state === 'waiting') {
          diveSignal(ctx, it.x, it.y, it.r, c3, t, it.alpha * bCore, waitFade, 3.3);
        }
        ctx.globalAlpha = 1;
        return;
      }

      if (it.kind === 'wsghost') {
        /* 星座消散：鸟浪散点外扩 + 头雁余辉渐熄（与场景实体解耦，不乘 ws.alpha） */
        it.dust.forEach(function (p) {
          ctx.globalAlpha = clamp(p.a * 0.5, 0, 1);
          ctx.fillStyle = DUST[p.hue < 0.5 ? 0 : 1];
          ctx.fillRect(p.x - 0.6, p.y - 0.6, 1.2, 1.2);
        });
        ctx.globalAlpha = 1;
        it.stars.forEach(function (st) {
          drawGlow(ctx, st.color, st.x, st.y, Math.min(st.r * 3.0, 40), st.a * 0.6);
          ctx.globalAlpha = st.a * 0.7;
          ctx.fillStyle = st.color;
          ctx.beginPath(); ctx.arc(st.x, st.y, Math.max(1, st.r * 0.4), 0, TAU); ctx.fill();
        });
        ctx.globalAlpha = 1;
        return;
      }

      if (it.kind === 'nova') {
        /* 超新星（雁阵母语）：头雁陨落 —— 常规三段式 A 引爆 / B 冲击波 / C 坍缩归尘；
           intensity<0.5 = 星胚低强度消散变体；degraded = 风暴降级渐熄最小形态。 */
        const n = it.data || {};
        const base = it.r;
        const seed = hashSeed(n.id);
        if (n.degraded) {
          /* 风暴降级最小形态：只留辉光衰减 + 少量残骸外散（跳过火花与冲击环） */
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
          /* 星胚消散变体：虚线翎环放大淡出 + 淡核收缩 + 少量微粒 puff */
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
        const el = it.k * n.dur; // 已流逝秒（dur 2.4s ↔ 设计归一化窗 0.21/0.46/1.0）
        /* A 引爆（0–0.5s）：核心膨胀 ×1→×3.5 + 色向白炽偏移；C 段（0.9s 起）收缩熄灭 */
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
        /* B 冲击波（0.3–1.1s）：双扩散环 + 10 道放射火花（错峰起爆，短流星） */
        if (el >= 0.3 && el <= 1.1) {
          const b = (el - 0.3) / 0.8;
          for (let d = 0; d < 2; d++) {
            const delay = d * 0.18;
            const bk = easeOutK(clamp((b - delay) / (1 - delay), 0, 1));
            if (bk <= 0 || bk >= 1) continue;
            ctx.strokeStyle = hexA(mix(n.color, '#ffffff', 0.4), (1 - bk) * 0.55);
            ctx.lineWidth = 1.6;
            ctx.beginPath(); ctx.arc(it.x, it.y, base * lerp(1, 4, bk), 0, TAU); ctx.stroke();
          }
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
        /* C 坍缩归尘（0.9–dur）：残骸向 driftTo 快照点漂移渐散（无快照点 → 原位外散） */
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
            ctx.fillStyle = DUST[i % 2];
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
        /* 流星 = 落单的雁羽（暖金尾 + 白热头） */
        trailStroke(ctx, it.trail, '#ffd8a0', 0.55, 0.5, 1.6, it.alpha);
        drawGlow(ctx, '#fff3e0', it.x, it.y, 11, it.alpha);
      }
    }
  };
}
