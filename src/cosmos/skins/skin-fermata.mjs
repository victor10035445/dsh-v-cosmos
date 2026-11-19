/**
 * 皮肤 · 总谱延音 Fermata（add-cosmos-skin-themes 1.4）。
 *
 * 血统：demo/skins/assets/skin-fermata.js（`window.COSMOS_SKINLIB.define` 圆括号 IIFE）
 * → SRC 侧 ES 模块。`createSkinFermata()` 每次调用自建 glow 缓存（design D6：跨皮肤不
 * 串色）；`setSkin` 换实例即自然重置器皿守卫，不挂引擎。
 *
 * 隐喻：深夜音乐厅的乐谱世界——星座 = 乐句（五线谱底 + 乐句环 + 谱号位置）· 恒星 = 主
 * 音符（星胚 = 空心符头 + 虚线轮廓 / 已创建 = 实心符头 + 符干 / 已审核 = 符尾 + 颤音杆 +
 * 金章环 / 已执行 = 金冠全音符）· 行星 = 倚音（装饰小音符绕主音巡行）· 卫星 = 倚音小符
 * 头 · 彗星 = 滑音 glissando（波状尾）· 星云 = 踏板雾 · 连线 = 连句线 slur（上拱弧）·
 * 等批准 = 延长记号 fermata（半圆穹顶 + 顶点，呼吸着等指挥落拍）。
 *
 * 移植词汇映射（design D5）：
 *  - `it.data.status` → `it.data.lifecycle`（draft/in-progress/complete → proto/created/
 *    reviewed/executed）；demo `complete` 的谱金 `#ffd88a` 直接落 executed——总谱本就是
 *    「暖黑 + 谱金」主调，无需再染色；created 取 demo `draft` 的墨白（in-progress 的琥珀
 *    属暖域，按皮肤语义契约改由 waiting 承载注意力语义）；reviewed 由 created 向白升亮
 *    派生（冷亮升亮域）；
 *  - 会话键 `done` → `done-unread`；
 *  - 连线段 `[a, b]` 数组形 → `{a, b, alpha}` 对象形（seg.alpha 承载坡道）；
 *  - 不提供 demo 的说明文案字段（SRC 侧无消费点）。
 *
 * 转场本地化（消费面与其余皮肤逐字同源，只换语言）：
 *  - 星胚点燃 ignite：A 段轮廓收缩 → B 段白光微爆闪 → C 段色相渐变到 created；
 *  - 已审核 stamp：金章环半径 ×2.2→×1 + α 淡入（乐谱「落印」）；
 *  - 已执行 surge：金涌母语化为**金冠全音符**——金色全音符在高亮符头处浮现 + 金冠弧线 +
 *    金环外扩渐熄，强度包络 `Math.sin(k*π)`；
 *  - 状态色相滑移 sessColor + 注意力信号坡道 mixFade（waiting / done-unread）；
 *  - 查看渐熄 viewK：色向 done-unread 混合、halo 沿 `1-viewK` 消退；
 *  - 出生 birth：α × birthAlphaOf、k∈[0.15,0.65) 白色微爆闪、degraded 只留纯 α 坡道；
 *  - 卫星 satBornKOf：α × bornK、半径 0→满（easeOutK）；星云尘埃 dustBornK 坡道。
 */

import {
  TAU, clamp, lerp, easeOutK, mix, hexA, hashSeed, hashRand,
  makeGlowCache, trailStroke, sessColor, mixFade, viewKOf, birthAlphaOf,
  segAlphaOf, dustBornK, satBornKOf, createVesselGuard, vesselAnchor,
  makeDustSprite, dustBatchDraw, patDotDraw
} from '../skin-kit.mjs';

/* 谱金（demo `complete`）——本皮肤唯一的高光色：总谱的暖黑谱金主调。 */
const GOLD = '#ffd88a';
/* 已创建 = 冷亮「谱线蓝」（demo `draft` 的墨白属暖灰，按「皮肤语义契约」冷亮域改用谱线
   蓝灰；暖黑/墨白仍由背景与符头绘制承担，不占生命周期编码）。 */
const CREATED = '#a8bcd8';
const STAFF = '#e8c874';
const IVORY = '#f0e8d8';

const PROP = Object.freeze({
  proto: '#8c9aa8',                                 // 待创建星胚：低饱和灰蓝（未写下的音）
  created: CREATED,                                 // 已创建：冷亮谱线蓝
  reviewed: mix(CREATED, '#ffffff', 0.34),          // 已审核：冷亮升亮
  executed: GOLD                                    // 已执行：金域（谱金）
});

const SESS = Object.freeze({
  idle: '#8a8680',                                  // 中性灰
  busy: '#8ac4dc',                                  // 冷亮蓝青
  waiting: '#ffb056',                               // 恒暖（延长记号）
  'done-unread': '#86c8a0',                         // 恒冷绿（余音）
  free: '#e8d8b8'                                   // 彗星身份色（羊皮纸）
});

/* 踏板雾双色（星云尘埃；hue < 0.5 取 c1）。 */
const DUST = Object.freeze(['#4a4436', '#6a5a3e']);

/** 创建总谱延音皮肤实例（每次调用独立 glow 缓存与器皿守卫）。 */
export function createSkinFermata() {
  const glow = makeGlowCache();
  const dustBrush = makeDustSprite(); // 尘埃 sprite 缓存（每皮肤实例独立，防跨皮肤串色）
  const palette = { prop: PROP, sess: SESS };
  const vesselOnce = createVesselGuard();

  function drawGlow(ctx, hex, x, y, R, a) { glow.draw(ctx, hex, x, y, R, a); }

  function starColor(m) {
    return m > 0.9 ? '#fff0c8' : (m < 0.5 ? '#a89870' : '#e0d0a8');
  }

  /* ── 符头/符干/符尾/颤音杆：主音符母语（旋转椭圆符头 + 右侧符干） ──
     颤音杆并入符干同一条 path（省一次 stroke，视觉等价）。 */
  function note(ctx, x, y, r, color, alpha, opts) {
    const o = opts || {};
    const rx = r * 1.05, ry = r * 0.72;
    ctx.save();
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.translate(x, y);
    ctx.rotate(-0.38);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
    if (o.hollow) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.3;
      ctx.stroke();
    } else {
      ctx.fillStyle = color;
      ctx.fill();
    }
    const sx = rx * 0.92, top = -r * 3.6;
    if (!o.noStem) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, top);
      if (o.tremolo) {
        /* 颤音杆：符干上两笔斜划（进行中的抖） */
        for (let k = 0; k < 2; k++) {
          const y1 = top + r * 0.9 + k * r * 0.7;
          ctx.moveTo(sx, y1);
          ctx.lineTo(sx + r * 1.5, y1 - r * 0.5);
        }
      }
      ctx.stroke();
      if (o.flag) {
        /* 符尾：自符干顶向下钩出 */
        ctx.beginPath();
        ctx.moveTo(sx, top);
        ctx.quadraticCurveTo(sx + r * 1.7, top + r * 0.9, sx + r * 1.15, top + r * 2.2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /* ── 延长记号 fermata：半圆穹顶 + 顶点（等批准 = 等待指挥落拍） ── */
  function fermataMark(ctx, x, y, r, color, alpha, breath) {
    const s = r * (1 + 0.06 * breath);
    ctx.save();
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, s * 1.5, Math.PI, 0, false);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y - s * 0.42, Math.max(0.7, s * 0.22), 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /* ── 金冠全音符（executed 母语）：无符干空心符头 + 三峰金冠弧线 ── */
  function crownNote(ctx, x, y, r, color, alpha, grow) {
    const rr = Math.max(3, r * (grow == null ? 1 : grow));
    const al = clamp(alpha, 0, 1);
    ctx.save();
    ctx.globalAlpha = al;
    ctx.translate(x, y);
    ctx.rotate(-0.38);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.4, rr * 0.2);
    ctx.beginPath();
    ctx.ellipse(0, 0, rr * 1.25, rr * 0.84, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
    /* 金冠弧线：三峰冠冕压在符头之上（冠 = 总谱的「此曲终成」） */
    ctx.save();
    ctx.globalAlpha = al * 0.85;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x - rr * 1.45, y - rr * 1.05);
    ctx.lineTo(x - rr * 0.72, y - rr * 1.95);
    ctx.lineTo(x, y - rr * 1.05);
    ctx.lineTo(x + rr * 0.72, y - rr * 1.95);
    ctx.lineTo(x + rr * 1.45, y - rr * 1.05);
    ctx.stroke();
    ctx.restore();
  }

  /* ── 已审核金章环（r+6，1.4px）：stamp fx 播放落印（半径 ×2.2→×1 + α 淡入） ── */
  function sealRing(ctx, x, y, rr, a, w, stampP) {
    let rad = rr, aa = a;
    if (stampP >= 0) {
      rad = lerp(rr * 2.2, rr, easeOutK(stampP));
      aa = lerp(0, a, stampP);
    }
    if (aa <= 0.01) return;
    ctx.strokeStyle = hexA(GOLD, aa);
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, TAU);
    ctx.stroke();
  }

  function hoverMark(ctx, it) {
    if (!it.hovered && !it.selected) return;
    ctx.strokeStyle = it.selected ? GOLD : hexA(GOLD, 0.55);
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 6, 0, TAU); ctx.stroke();
    ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 11, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
  }

  /* ── 等批准信号：延长记号（半圆弧 + 点，呼吸）+ 周期扩散环 ── */
  function waitingFermata(ctx, x, y, r, c, t, al, fade, seed, lift) {
    const pulse = Math.sin(t * 2.4 + (seed % 9));
    fermataMark(ctx, x, y - lift, Math.max(1.2, r * 0.9), SESS.waiting, al * 0.95 * fade, pulse);
    const rr = r + 4 + ((t * 20) % 14);
    ctx.strokeStyle = hexA(c, clamp(0.5 * (1 - (rr - r - 4) / 14), 0, 1) * al * fade);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.stroke();
  }

  /* ── 完成未读：冷绿余音 halo 慢脉动（r+9±3，α0.22–0.36，周期 ~3.5s） ── */
  function doneHalo(ctx, x, y, r, t, al, keep, phase) {
    if (keep <= 0.02) return;
    const ph = phase || 0;
    const hr = r + 9 + 3 * Math.sin(t * 1.8 + ph);
    ctx.strokeStyle = hexA(SESS['done-unread'], (0.22 + 0.14 * Math.sin(t * 1.8 + ph)) * al * keep);
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(x, y, hr, 0, TAU); ctx.stroke();
    drawGlow(ctx, SESS['done-unread'], x, y, r * 3.2, 0.18 * al * keep);
  }

  /* ── 滑音 glissando：沿运动法向的正弦波尾（振幅向尾端张开） ── */
  function glissando(ctx, trail, hex, alpha, w, amp) {
    if (!trail || trail.length < 2 || alpha <= 0.01) return;
    const a = trail[0], b = trail[trail.length - 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    ctx.save();
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.strokeStyle = hex;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < trail.length; i++) {
      const q = i / (trail.length - 1);
      const wob = Math.sin(q * Math.PI * 4) * amp * q;
      const px = trail[i].x + nx * wob, py = trail[i].y + ny * wob;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();
  }

  /* ── 器皿：总谱的「五线谱底 + 乐句环 + 谱号位置」（每帧每星座一次，D9） ── */
  function staffVessel(ctx, ws) {
    const p = vesselAnchor(ws);
    if (!p) return;
    const w = 158 * p.s;                 // 谱段半宽
    if (w < 26) return;
    const x = p.x, y = p.y;
    const gap = 7.5 * p.s;               // 谱线间距
    /* 乐句环：这一「句」的归属范围（极淡椭圆，只作归属暗示） */
    ctx.strokeStyle = 'rgba(232,200,116,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(x, y, w * 0.82, gap * 4.2, 0, 0, TAU);
    ctx.stroke();
    /* 五条谱线：本星座的局部五线谱（不横贯全屏） */
    ctx.strokeStyle = 'rgba(232,200,116,0.10)';
    ctx.beginPath();
    for (let i = -2; i <= 2; i++) {
      const yy = Math.round(y + i * gap) + 0.5;
      ctx.moveTo(x - w, yy);
      ctx.lineTo(x + w, yy);
    }
    ctx.stroke();
    /* 谱号位置：左侧谱号柱 + 卷头（高音谱号的记号形态） */
    const cx = x - w + 9 * p.s;
    ctx.strokeStyle = 'rgba(232,200,116,0.22)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx, y - gap * 2.2);
    ctx.lineTo(cx, y + gap * 2.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + 1.6 * p.s, y - gap * 0.6, 3.2 * p.s, Math.PI * 0.9, Math.PI * 2.35);
    ctx.stroke();
  }

  return {
    skin: 'fermata',
    useBand: false,
    palette,
    gold: GOLD,
    bgStarColor(m) { return starColor(m); },
    dustColors: DUST,

    background(ctx, view) {
      /* 音乐厅暗场：暖黑底 + 顶部金色顶光 */
      ctx.fillStyle = '#0b0a09';
      ctx.fillRect(0, 0, view.W, view.H);
      const sp = ctx.createRadialGradient(view.W / 2, view.H * 0.08, 0, view.W / 2, view.H * 0.08, view.H);
      sp.addColorStop(0, 'rgba(232,200,116,0.055)');
      sp.addColorStop(1, 'rgba(232,200,116,0)');
      ctx.fillStyle = sp;
      ctx.fillRect(0, 0, view.W, view.H);
      /* 五线谱底：五条金发丝线（全屏恒定，「这是一页总谱」） */
      const gap = view.H * 0.042;
      const y0 = view.H * 0.52;
      ctx.strokeStyle = 'rgba(232,200,116,0.10)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = -2; i <= 2; i++) {
        const y = Math.round(y0 + i * gap) + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(view.W, y);
      }
      ctx.stroke();
      /* 背景星 = 谱纸上的暖尘（最亮者加一点十字星芒） */
      const bs = view.bgStars;
      for (let i = 0; i < bs.length; i++) {
        const s = bs[i];
        if (s.a < 0.03) continue;
        const size = 0.7 + s.m * 1.4;
        ctx.globalAlpha = s.a * 0.42;
        ctx.fillStyle = starColor(s.m);
        ctx.fillRect(s.x - size / 2, s.y - size / 2, size, size);
        if (s.m > 0.94) {
          ctx.globalAlpha = s.a * 0.3;
          ctx.strokeStyle = IVORY;
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

      /* 器皿：五线谱底 + 乐句环（每帧每星座一次；锚点缺失 → 直接跳过） */
      if (it.ws && vesselOnce(it.ws, t)) staffVessel(ctx, it.ws);

      if (it.kind === 'dust') {
        /* 踏板雾：暖尘粒（共享低开销原语；α 同时乘星座 α——旧分支双乘口径保留）
           + 踏板泛音（母语装饰层：少数亮点浮在雾上，留在原语之外）。 */
        const alphaK = 0.34 * it.alpha;
        dustBatchDraw(dustBrush, ctx, it.pts, DUST, t, { alphaK: alphaK, radiusK: 0.55, minR: 0.7 });
        const pts = it.pts;
        const extraK = 0.26 * it.alpha;
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          if (!(p.hue > 0.65)) continue;
          const bornK = dustBornK(p, t);
          const a = clamp(p.a * bornK * extraK, 0, 1);
          if (!(a > 0)) continue;
          ctx.globalAlpha = a;
          ctx.fillStyle = STAFF;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 0.8, 0, TAU);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        return;
      }

      if (it.kind === 'constline') {
        /* 连句线 slur：上拱弧（段的坡道 seg.alpha ∈[0,1] 参与淡入淡出） */
        it.segs.forEach(function (seg) {
          const a = seg.a, b = seg.b;
          const sa = it.alpha * segAlphaOf(seg);
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2 - Math.hypot(b.x - a.x, b.y - a.y) * 0.16;
          ctx.strokeStyle = hexA(STAFF, 0.26 * sa);
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.quadraticCurveTo(mx, my, b.x, b.y);
          ctx.stroke();
        });
        return;
      }

      if (it.kind === 'patdot') {
        /* 空槽装饰点（add-cosmos-template-figure-display 3.2）：谱线顶点微点符——
           取谱线色、基线 0.26（= 本皮肤连句线基线），点弱化因子由引擎下发；
           纯装饰（不进 picks / 无 hover / 无名牌）。 */
        patDotDraw(ctx, it, STAFF, 0.26);
        return;
      }

      if (it.kind === 'orbit') {
        /* 谱环：倚音巡行的圆滑线环（虚线） */
        ctx.strokeStyle = hexA(STAFF, 0.14 * it.alpha);
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 7]);
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
        const r = Math.max(2.6, it.r * 0.82);

        if (lifecycle === 'proto') {
          /* 星胚 = 空心符头 + 虚线轮廓 `[4,5]` + 呼吸 + 淡核；
             ignite：A 段（→0.3）轮廓收缩，B 段（0.30–0.75）白光微爆闪，
             C 段（>0.55）色相渐变到 created（符头实心化）。 */
          const phase = st.starIndex || 0;
          const breath = (Math.sin(t * 1.6 + phase) + 1) / 2;
          const protoC = palette.prop.proto;
          const igniteP = fx && fx.type === 'ignite' ? clamp((t - fx.t0) / fx.dur, 0, 1) : -1;
          if (igniteP >= 0 && igniteP > 0.55) {
            const cMix = mix(protoC, palette.prop.created, (igniteP - 0.55) / 0.45);
            drawGlow(ctx, cMix, it.x, it.y, Math.min(it.r * 4.4, 52), it.alpha * bAl * (0.36 + act * 0.16));
            note(ctx, it.x, it.y, r, cMix, it.alpha * bAl, { tremolo: act > 0 });
          } else {
            const contract = igniteP >= 0 ? easeOutK(clamp(igniteP / 0.3, 0, 1)) : 0;
            const ro = igniteP >= 0 ? lerp(it.r + 6, it.r * 0.62, contract) : it.r + 6 + breath * 2;
            const oa = igniteP >= 0 ? 0.5 + contract * 0.4 : 0.44 + breath * 0.26;
            drawGlow(ctx, protoC, it.x, it.y, it.r * 3.0, it.alpha * bAl * (0.14 + breath * 0.1));
            /* 空心符头（待写下的那一颗音） */
            note(ctx, it.x, it.y, r, protoC, it.alpha * bAl * (0.5 + breath * 0.3), { hollow: true, noStem: true });
            ctx.save();
            ctx.strokeStyle = hexA(protoC, clamp(oa * it.alpha * bAl, 0, 1));
            ctx.lineWidth = 1.2;
            ctx.setLineDash([4, 5]);
            ctx.lineDashOffset = -t * 8;
            ctx.beginPath();
            ctx.arc(it.x, it.y, ro, 0, TAU);
            ctx.stroke();
            ctx.restore();
            /* 淡核 */
            ctx.globalAlpha = clamp(it.alpha * bAl * 0.3, 0, 1);
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(it.x, it.y, Math.max(0.7, r * 0.16), 0, TAU);
            ctx.fill();
            ctx.globalAlpha = 1;
          }
          if (igniteP >= 0.30 && igniteP < 0.75) {
            const fk = (igniteP - 0.30) / 0.45;
            drawGlow(ctx, '#ffffff', it.x, it.y, it.r * 6.5,
              Math.sin(clamp(fk, 0, 1) * Math.PI) * 0.9 * it.alpha);
          }
        } else {
          const c = palette.prop[lifecycle] || '#ffffff';
          drawGlow(ctx, c, it.x, it.y, Math.min(it.r * 4.8, 62), it.alpha * bAl * (0.42 + act * 0.18));
          if (lifecycle === 'executed') {
            /* 已执行 = 金冠全音符（总谱的「此曲终成」） */
            crownNote(ctx, it.x, it.y, Math.max(3, it.r * 0.9), palette.prop.executed, it.alpha * bAl);
          } else {
            /* created = 实心符头 + 符干；reviewed = 再加符尾 + 颤音杆 */
            note(ctx, it.x, it.y, r, c, it.alpha * bAl, {
              flag: lifecycle === 'reviewed',
              tremolo: lifecycle === 'reviewed' && act > 0
            });
            if (act > 0) {
              /* act 热度：符头高光点 + 谱线耀斑（不参与执行语义，只表活跃） */
              const hot = mix(c, '#ffffff', Math.min(0.5, 0.18 * act));
              ctx.save();
              ctx.globalAlpha = clamp(it.alpha * bAl, 0, 1);
              ctx.fillStyle = 'rgba(255,255,255,0.9)';
              ctx.beginPath();
              ctx.arc(it.x + r * 0.3, it.y - r * 0.2, Math.max(0.8, r * 0.22), 0, TAU);
              ctx.fill();
              if (act >= 1) {
                ctx.strokeStyle = hexA(hot, 0.4 * it.alpha * bAl);
                ctx.lineWidth = 1;
                const L = r * 3.2;
                ctx.beginPath();
                ctx.moveTo(it.x - L, it.y); ctx.lineTo(it.x + L, it.y);
                ctx.moveTo(it.x, it.y - L); ctx.lineTo(it.x, it.y + L);
                ctx.stroke();
              }
              ctx.restore();
            }
          }
          if (lifecycle === 'reviewed') {
            /* 金章环 r+6（1.4px）；stamp 播放落印、随态常驻 */
            const stampP = fx && fx.type === 'stamp' ? clamp((t - fx.t0) / fx.dur, 0, 1) : -1;
            sealRing(ctx, it.x, it.y, it.r + 6, 0.85 * it.alpha, 1.4, stampP);
          }
        }

        /* 出生微爆闪：与 ignite B 段同语言、幅度减半；degraded 禁爆闪（纯 α 坡道） */
        if (it.birth && !it.birth.degraded && it.birth.k >= 0.15 && it.birth.k < 0.65) {
          const fk = (it.birth.k - 0.15) / 0.5;
          drawGlow(ctx, '#ffffff', it.x, it.y, it.r * 6.5,
            Math.sin(clamp(fk, 0, 1) * Math.PI) * 0.45 * it.alpha * bAl);
        }

        /* executed 金涌母语化：金冠全音符浮现（半径 ×2.2→×1）+ 金冠弧线 + 金环外扩渐熄；
           1.2s，强度包络 Math.sin(k*π)（起扬 → 收） */
        if (fx && fx.type === 'surge') {
          const el = t - fx.t0;
          if (el > 0) {
            const kk = clamp(el / fx.dur, 0, 1);
            const env = Math.sin(kk * Math.PI);
            drawGlow(ctx, palette.prop.executed, it.x, it.y,
              Math.min(it.r * 5.4 * lerp(2.2, 1, easeOutK(kk)), 150), env * 0.85 * it.alpha);
            crownNote(ctx, it.x, it.y, Math.max(3.4, it.r * 1.1), palette.prop.executed,
              env * 0.9 * it.alpha * bAl, lerp(2.2, 1, easeOutK(kk)));
            const ringK = easeOutK(clamp(el / (fx.dur * 0.6), 0, 1));
            ctx.strokeStyle = hexA(palette.prop.executed, (1 - ringK) * 0.8 * it.alpha);
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.arc(it.x, it.y, it.r + 6 + ringK * 26, 0, TAU);
            ctx.stroke();
          }
        }
        ctx.globalAlpha = 1;
        hoverMark(ctx, it);
        return;
      }

      if (it.kind === 'planet') {
        const p = it.data || {};
        const state = p.state;
        let c2 = sessColor(palette, 'planet', state, p, t);   // 色相滑移统一取色
        const viewK = viewKOf(it, t);
        if (viewK > 0) c2 = mix(SESS['done-unread'], c2, viewK);
        const al = it.alpha * birthAlphaOf(it);
        const waitFade = mixFade(p, t, 'waiting');
        const doneFade = mixFade(p, t, 'done-unread');
        const waiting = state === 'waiting';
        const seed = hashSeed(p.id || 'planet');
        const r2 = Math.max(2, it.r * 0.72);
        drawGlow(ctx, c2, it.x, it.y, Math.min(it.r * 3.6, 28), al * 0.6);
        trailStroke(ctx, it.trail, c2, 0.22, 0.4, 0.9, al);
        /* 倚音：小符头（idle 无符干；其余带符干） */
        note(ctx, it.x, it.y, r2, c2, al, { noStem: state === 'idle' });
        if (!waiting && state !== 'idle') {
          /* 倚音斜线（装饰音记号：一条斜划划掉小音符） */
          ctx.save();
          ctx.globalAlpha = clamp(0.6 * al, 0, 1);
          ctx.strokeStyle = c2;
          ctx.lineWidth = 0.9;
          ctx.beginPath();
          ctx.moveTo(it.x + r2 * 0.9, it.y - r2 * 3.2);
          ctx.lineTo(it.x + r2 * 2.1, it.y - r2 * 1.2);
          ctx.stroke();
          ctx.restore();
        }
        if (p.delegatedBusy) {
          /* 委托忙碌微光环：cold 蓝青慢呼吸 */
          const busyA = 0.25 * (0.5 + 0.5 * Math.sin(t * Math.PI));
          ctx.strokeStyle = hexA(SESS.busy, busyA * al);
          ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 11, 0, TAU); ctx.stroke();
        }
        if (state === 'done-unread' || viewK > 0) {
          doneHalo(ctx, it.x, it.y, it.r, t, al, (1 - viewK) * doneFade, p.phase);
        }
        if (waiting) {
          /* 等批准 = 延长记号（半圆弧 + 点，呼吸等待指挥落拍） */
          waitingFermata(ctx, it.x, it.y, it.r, c2, t, al, waitFade, seed, r2 * 4.6);
        }
        hoverMark(ctx, it);
        return;
      }

      if (it.kind === 'suborbit') {
        /* 乐句内小圆滑线：状态色虚线折线 */
        const oc = palette.sess[it.data && it.data.state] || palette.sess.idle;
        ctx.strokeStyle = hexA(oc, 0.26 * it.alpha);
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        it.orbitPts.forEach(function (p, i) { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
        ctx.stroke();
        ctx.setLineDash([]);
        return;
      }

      if (it.kind === 'sat') {
        const s = it.data || {};
        /* 出生坡道：α × bornK、半径 0→满（easeOutCubic 短尾） */
        const bornK = satBornKOf(it);
        const rF = easeOutK(bornK);
        const c4 = mix(sessColor(palette, 'sat', s.state, s, t), '#707c9c', 0.3);
        trailStroke(ctx, it.trail, c4, 0.22, 0.4, 0.9, it.alpha * bornK);
        drawGlow(ctx, c4, it.x, it.y, it.r * 2.4, it.alpha * bornK * 0.45);
        /* 倚音小符头（无符干；半径随出生坡道长满） */
        note(ctx, it.x, it.y, Math.max(1.3, it.r * rF), c4, it.alpha * bornK, { noStem: true });
        if (s.state === 'waiting') {
          /* 待决策：迷你延长记号 + 迷你扩散环（强度乘出生坡道与色相滑移坡道） */
          const satFade = bornK * mixFade(s, t, 'waiting');
          fermataMark(ctx, it.x, it.y - it.r * 2.6 - 5, Math.max(1.1, it.r * 0.6),
            SESS.waiting, it.alpha * 0.8 * satFade, Math.sin(t * 2.4));
          const pp = ((t * 22) % 10) / 10;
          const rr = it.r + 2 + pp * 7;
          ctx.strokeStyle = hexA(SESS.waiting, (1 - pp) * 0.5 * it.alpha * satFade);
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(it.x, it.y, rr, 0, TAU); ctx.stroke();
        }
        return;
      }

      if (it.kind === 'comet') {
        const c = it.data || {};
        const state = c.state;
        let c3 = sessColor(palette, 'comet', state, c, t);    // idle 保持 free 身份色
        const viewK = viewKOf(it, t);
        if (viewK > 0) c3 = mix(SESS['done-unread'], c3, viewK);
        /* 出生游入：尾迹先现（trailAlpha）、核后亮（alpha） */
        const birth = it.birth || null;
        const bCore = birth ? birth.alpha : 1;
        const bTrail = birth ? birth.trailAlpha : 1;
        const waitFade = mixFade(c, t, 'waiting');
        const doneFade = mixFade(c, t, 'done-unread');
        const seed = hashSeed(c.id || 'comet');
        /* 滑音 glissando：波状尾（主波 + 内侧细波） */
        glissando(ctx, it.trail, c3, it.alpha * bTrail * 0.5, 1.4, 2.4);
        glissando(ctx, it.trail, mix(c3, '#ffffff', 0.45), it.alpha * bTrail * 0.22, 0.7, 1.4);
        drawGlow(ctx, c3, it.x, it.y, Math.min(it.r * 3.6, 26), it.alpha * bCore * 0.8);
        /* 滑音头：象牙白核（彗星身份辨识）+ 状态色环 */
        ctx.globalAlpha = clamp(it.alpha * bCore, 0, 1);
        ctx.fillStyle = IVORY;
        ctx.beginPath();
        ctx.arc(it.x, it.y, Math.max(1.4, it.r * 0.42), 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = hexA(c3, 0.45 * it.alpha * bCore);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 4, 0, TAU); ctx.stroke();
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
          /* 滑行中的延长记号（等批准的语言与行星同源，位置抬到滑音头之上） */
          waitingFermata(ctx, it.x, it.y, it.r, c3, t, it.alpha * bCore, waitFade, seed, it.r * 2.4 + 8);
        }
        return;
      }

      if (it.kind === 'wsghost') {
        /* 星座消散：踏板雾外散 + 主音符余辉渐熄（不乘 ws.alpha，与场景实体解耦） */
        it.dust.forEach(function (p) {
          const bornK = dustBornK(p, t);
          ctx.globalAlpha = clamp(p.a * bornK * 0.34, 0, 1);
          ctx.fillStyle = DUST[p.hue < 0.5 ? 0 : 1];
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(0.7, p.s * 0.55), 0, TAU);
          ctx.fill();
        });
        ctx.globalAlpha = 1;
        it.stars.forEach(function (st) {
          drawGlow(ctx, st.color, st.x, st.y, Math.min(st.r * 3.0, 40), st.a * 0.55);
          note(ctx, st.x, st.y, Math.max(1.2, st.r * 0.38), st.color, st.a * 0.72, { noStem: true });
        });
        return;
      }

      if (it.kind === 'nova') {
        /* 超新星（总谱母语：一句突然收束的强音）——degraded 渐熄最小形态 /
           intensity<0.5 星胚消散变体 / 常规三段式（A 引爆 → B 冲击波 → C 归尘）。 */
        const n = it.data || {};
        const base = it.r;
        const seed = hashSeed(n.id || 'nova');
        if (n.degraded) {
          /* 风暴降级最小形态：只留辉光衰减 + 少量残骸外散（跳过节拍型冲击环） */
          const pk = it.k;
          drawGlow(ctx, n.color, it.x, it.y, base * 3 * (1 + pk * 0.6), (1 - pk) * 0.3);
          ctx.globalAlpha = (1 - pk) * 0.4;
          ctx.fillStyle = n.color;
          ctx.beginPath();
          ctx.arc(it.x, it.y, Math.max(0.8, base * 0.4 * (1 - pk)), 0, TAU);
          ctx.fill();
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
          /* 星胚低强度消散：虚线残影放大淡出 + 淡核收缩 + 少量微粒外散（0.8s） */
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
          ctx.beginPath();
          ctx.arc(it.x, it.y, Math.max(0.8, base * 0.36 * (1 - pk)), 0, TAU);
          ctx.fill();
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
        const el = it.k * n.dur;   // 已流逝秒
        /* A 引爆（0–0.5s）：核心膨胀 ×1→×3.5 + 向白炽偏移；C 坍缩（0.9s 起）收缩熄灭 */
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
          ctx.beginPath();
          ctx.arc(it.x, it.y, Math.max(1, coreR * 0.5), 0, TAU);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        /* B 冲击波（0.3–1.1s）：双扩散环 + 10 笔放射短划（错峰起爆） */
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
        /* C 坍缩归尘（0.9–dur）：残骸向 driftTo 快照点漂移渐散（无快照 → 原位外散） */
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
        /* 流星 = 装饰音划奏：暖白尾 + 亮头 */
        trailStroke(ctx, it.trail, '#f0e8d8', 0.5, 0.5, 1.4, it.alpha);
        drawGlow(ctx, '#fff8ea', it.x, it.y, 11, it.alpha);
      }
    }
  };
}
