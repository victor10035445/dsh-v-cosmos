/**
 * 皮肤 · 化学反应 Reagent（add-cosmos-skin-themes 1.4）。
 *
 * 隐喻：星座 = 培养皿 · 恒星 = 荧光反应核（星胚 = 淡青试剂 / 已创建 = 剧烈反应冒泡 /
 * 已审核 = 稳定液面 + 金环落印 / 已执行 = 析出八面体结晶金涌）· 行星 = 悬浮颗粒
 * （等批准 = 沸腾）· 彗星 = 滴管液滴 · 星云 = 皿底沉淀 · 连线 = 虹吸导管。
 *
 * 视觉：暗色实验台 + 玻璃器皿高光 + 化学荧光（皿沿双环 / 弧光 / 液面高光全套玻璃语言）。
 *
 * 结构：`createVesselGuard()` 实现「每帧每星座一次的器皿绘制」（design D9）——守卫状态
 * 存皮肤实例闭包，`setSkin` 换实例即自然重置，MUST NOT 挂引擎。
 */

import {
  TAU, clamp, lerp, easeOutK, mix, hexA, hashSeed, hashRand,
  makeGlowCache, trailStroke, sessColor, mixFade, viewKOf, birthAlphaOf, segAlphaOf,
  dustBornK, satBornKOf, createVesselGuard, vesselAnchor,
  makeDustSprite, dustBatchDraw, patDotDraw
} from '../skin-kit.mjs';

const CREATED = '#6fd8d8';
const GOLD = '#ffc24a';
const GLASS = '#a8c8dc';

const PROP = Object.freeze({
  proto: '#8c9aa8',
  created: CREATED,
  reviewed: mix(CREATED, '#ffffff', 0.36),
  executed: GOLD
});

const SESS = Object.freeze({
  idle: '#7a8a9c',
  busy: '#4ad8c8',
  waiting: '#ffb84a',
  'done-unread': '#6ae89a',
  free: '#9adff0'
});

const DUST = Object.freeze(['#5a5a48', '#3f6a68']);

/** 创建化学反应皮肤实例。 */
export function createSkinReagent() {
  const glow = makeGlowCache();
  const dustBrush = makeDustSprite(); // 尘埃 sprite 缓存（每皮肤实例独立，防跨皮肤串色）
  const palette = { prop: PROP, sess: SESS };
  const vesselOnce = createVesselGuard();

  function drawGlow(ctx, hex, x, y, R, a) { glow.draw(ctx, hex, x, y, R, a); }

  /* ── 器皿：培养皿（皿底液 + 双环皿沿 + 弧光高光；每帧每星座一次） ── */
  function dish(ctx, ws) {
    const p = vesselAnchor(ws);
    if (!p) return;
    const rx = 92 * p.s, ry = rx * 0.36;
    if (rx < 12) return;
    const x = p.x, y = p.y;
    const tint = hashSeed(ws.id) % 2 === 0 ? '27,58,74' : '42,30,62';
    ctx.fillStyle = 'rgba(' + tint + ',0.30)';
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(168,200,220,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(x, y, rx * 0.86, ry * 0.86, 0, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(168,200,220,0.38)';
    ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(168,200,220,0.14)';
    ctx.beginPath(); ctx.ellipse(x, y, rx * 1.06, ry * 1.06, 0, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(220,240,255,0.32)';
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, Math.PI * 1.15, Math.PI * 1.62); ctx.stroke();
    ctx.strokeStyle = 'rgba(220,240,255,0.12)';
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, Math.PI * 0.2, Math.PI * 0.55); ctx.stroke();
  }

  /* ── 上升气泡（反应剧烈度；强度随 act） ── */
  function bubbles(ctx, x, y, r, t, seed, color, alpha) {
    for (let i = 0; i < 4; i++) {
      const ph = hashRand(seed + i * 13.7);
      const k = (t * 0.45 + ph) % 1;
      const bx = x + Math.sin(t * 2 + i * 2.2 + ph * 7) * r * 0.9;
      const by = y - k * r * 2.4 - r * 0.5;
      ctx.globalAlpha = (1 - k) * 0.55 * alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.arc(bx, by, 1.1 + ph * 1.3, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /* ── 八面体结晶（已执行态母语；executed 金涌 = 结晶成形 + 金环） ── */
  function crystal(ctx, x, y, s, color, alpha, grow) {
    s = Math.max(3.2, s * (grow == null ? 1 : grow));
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.72, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s * 0.72, y);
    ctx.closePath();
    ctx.fillStyle = hexA(color, 0.30); ctx.fill();
    ctx.strokeStyle = hexA(color, 0.85); ctx.lineWidth = 1; ctx.stroke();
    ctx.strokeStyle = hexA(color, 0.35);
    ctx.beginPath();
    ctx.moveTo(x, y - s); ctx.lineTo(x, y + s);
    ctx.moveTo(x - s * 0.72, y); ctx.lineTo(x + s * 0.72, y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /* ── 已审核落印：玻璃金环（stampP≥0 播放落印） ── */
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

  function hoverMark(ctx, it) {
    if (!it.hovered && !it.selected) return;
    ctx.strokeStyle = it.selected ? '#e8f4ff' : hexA('#e8f4ff', 0.5);
    ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 6, 0, TAU); ctx.stroke();
    if (it.selected) {
      ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 11, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  /* ── 等批准：沸腾（扩散环 + 微泡上升；P0 常驻） ── */
  function waitingSignal(ctx, x, y, r, c, t, al, fade, seed) {
    const rr = r + 3 + ((t * 24) % 15);
    ctx.strokeStyle = hexA(c, clamp(0.7 * (1 - (rr - r - 3) / 15), 0, 1) * al * fade);
    ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.stroke();
    bubbles(ctx, x, y - 2, Math.max(2, r * 0.8), t * 1.4, seed, c, al * fade);
  }

  function doneHalo(ctx, x, y, r, t, al, keep, phase) {
    if (keep <= 0.02) return;
    const ph = phase || 0;
    const hr = r + 9 + 3 * Math.sin(t * 1.8 + ph);
    ctx.strokeStyle = hexA(SESS['done-unread'], (0.22 + 0.14 * Math.sin(t * 1.8 + ph)) * al * keep);
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(x, y, hr, 0, TAU); ctx.stroke();
    drawGlow(ctx, SESS['done-unread'], x, y, r * 3.2, 0.18 * al * keep);
  }

  return {
    skin: 'reagent',
    useBand: false,
    palette,
    gold: GOLD,
    bgStarColor(m) { return m > 0.85 ? '#e8f4ff' : '#9fc4d8'; },
    dustColors: DUST,

    background(ctx, view) {
      const g = ctx.createLinearGradient(0, 0, 0, view.H);
      g.addColorStop(0, '#0c0f15');
      g.addColorStop(1, '#080a0f');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, view.W, view.H);
      /* 实验台格网 */
      ctx.strokeStyle = 'rgba(150,180,200,0.028)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let gx = 0.5; gx < view.W; gx += 56) { ctx.moveTo(gx, 0); ctx.lineTo(gx, view.H); }
      for (let gy = 0.5; gy < view.H; gy += 56) { ctx.moveTo(0, gy); ctx.lineTo(view.W, gy); }
      ctx.stroke();
      /* 玻璃反光尘埃 */
      const bs = view.bgStars;
      for (let i = 0; i < bs.length; i++) {
        const s = bs[i];
        if (s.a < 0.03) continue;
        ctx.globalAlpha = s.a * 0.7;
        ctx.fillStyle = s.m > 0.85 ? '#e8f4ff' : '#9fc4d8';
        ctx.fillRect(s.x - 0.6, s.y - 0.6, 1.2, 1.2);
        if (s.m > 0.94) {
          ctx.globalAlpha = s.a * 0.5;
          ctx.strokeStyle = '#e8f4ff';
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
      if (it.ws && vesselOnce(it.ws, t)) dish(ctx, it.ws);

      if (it.kind === 'dust') {
        /* 皿底沉淀：共享低开销原语（dot sprite + 分色分组 + born 坡道 0.8s）。 */
        dustBatchDraw(dustBrush, ctx, it.pts, DUST, t, { alphaK: 0.4, radiusK: 0.4, minR: 0.7 });
        return;
      }

      if (it.kind === 'constline') {
        /* 虹吸导管：主管 + 高光 + 两端接口（段 α 坡道参与） */
        it.segs.forEach(function (seg) {
          const a = seg.a, b = seg.b;
          const dx = b.x - a.x, dy = b.y - a.y;
          const len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len, ny = dx / len;
          const sa = it.alpha * segAlphaOf(seg);
          ctx.strokeStyle = hexA(GLASS, 0.32 * sa);
          ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          ctx.strokeStyle = 'rgba(235,248,255,' + (0.20 * sa).toFixed(3) + ')';
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.moveTo(a.x + nx, a.y + ny);
          ctx.lineTo(b.x + nx, b.y + ny);
          ctx.stroke();
          [a, b].forEach(function (e) {
            ctx.strokeStyle = hexA(GLASS, 0.4 * sa);
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(e.x, e.y, 2.2, 0, TAU); ctx.stroke();
          });
        });
        return;
      }

      if (it.kind === 'patdot') {
        /* 空槽装饰点（add-cosmos-template-figure-display 3.2）：导管顶点微泡——
           取玻璃色、基线 0.32（= 本皮肤导管主管系数），点弱化因子由引擎下发；
           纯装饰（不进 picks / 无 hover / 无名牌）。 */
        patDotDraw(ctx, it, GLASS, 0.32);
        return;
      }

      if (it.kind === 'orbit') {
        ctx.strokeStyle = hexA(GLASS, 0.14 * it.alpha);
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 6]);
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
        const seed = hashSeed(st.id);
        if (lifecycle === 'proto') {
          /* 星胚 = 淡青试剂滴 + 玻片虚线圈（点火 = 试剂瞬间反应爆闪） */
          const phase = st.starIndex || 0;
          const breath = (Math.sin(t * 1.6 + phase) + 1) / 2;
          const igniteP = fx && fx.type === 'ignite' ? clamp((t - fx.t0) / fx.dur, 0, 1) : -1;
          const contract = igniteP >= 0 ? easeOutK(clamp(igniteP / 0.3, 0, 1)) : 0;
          const ro = igniteP >= 0 ? lerp(it.r + 5, it.r * 0.6, contract) : it.r + 5 + breath * 2;
          const oa = igniteP >= 0 ? 0.55 + contract * 0.35 : 0.42 + breath * 0.3;
          drawGlow(ctx, PROP.proto, it.x, it.y, it.r * 3.0, it.alpha * bAl * 0.18);
          ctx.globalAlpha = it.alpha * bAl * 0.55;
          ctx.fillStyle = PROP.proto;
          ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(1.2, it.r * 0.4), 0, TAU); ctx.fill();
          ctx.globalAlpha = 1;
          ctx.save();
          ctx.strokeStyle = hexA(PROP.proto, oa * it.alpha * bAl);
          ctx.lineWidth = 1.2;
          ctx.setLineDash([4, 5]);
          ctx.lineDashOffset = -t * 8;
          ctx.beginPath(); ctx.arc(it.x, it.y, ro, 0, TAU); ctx.stroke();
          ctx.restore();
          if (igniteP >= 0.30 && igniteP < 0.75) {
            const fk = (igniteP - 0.30) / 0.45;
            drawGlow(ctx, '#ffffff', it.x, it.y, it.r * 6.5,
              Math.sin(clamp(fk, 0, 1) * Math.PI) * 0.9 * it.alpha);
            bubbles(ctx, it.x, it.y, Math.max(2, it.r), t * 1.6, seed, hexA(PROP.created, 1),
              it.alpha * Math.sin(clamp(fk, 0, 1) * Math.PI));
          }
        } else {
          const c = PROP[lifecycle] || '#ffffff';
          drawGlow(ctx, c, it.x, it.y, Math.min(it.r * 5.2, 64), it.alpha * bAl * (0.5 + act * 0.2));
          ctx.globalAlpha = it.alpha * bAl;
          if (lifecycle === 'executed') {
            crystal(ctx, it.x, it.y, Math.max(3, it.r * 0.85), c, it.alpha * bAl);
          } else {
            ctx.fillStyle = c;
            ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(1.6, it.r * 0.52), 0, TAU); ctx.fill();
            if (act > 0) {
              ctx.fillStyle = 'rgba(255,255,255,0.92)';
              ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(0.9, it.r * 0.24), 0, TAU); ctx.fill();
            }
            if (lifecycle === 'reviewed') {
              /* 稳定液面：双圈液面 + 金环落印 */
              ctx.strokeStyle = hexA(c, 0.4 * it.alpha * bAl);
              ctx.lineWidth = 1;
              ctx.beginPath(); ctx.ellipse(it.x, it.y, it.r + 5, (it.r + 5) * 0.55, 0, 0, TAU); ctx.stroke();
              const stampP = fx && fx.type === 'stamp' ? clamp((t - fx.t0) / fx.dur, 0, 1) : -1;
              sealRing(ctx, it.x, it.y, it.r + 6, 0.85 * it.alpha, 1.4, stampP);
            }
            if (act > 0) {
              bubbles(ctx, it.x, it.y, Math.max(2, it.r), t, seed, hexA(c, 1), it.alpha * (0.4 + act * 0.25));
            }
          }
          ctx.globalAlpha = 1;
          /* executed 金涌母语化：结晶成形闪（金环外扩 + 结晶从 0 长出） */
          if (fx && fx.type === 'surge') {
            const el = t - fx.t0;
            if (el > 0) {
              const kk = clamp(el / fx.dur, 0, 1);
              crystal(ctx, it.x, it.y, Math.max(3.5, it.r * 1.15), GOLD,
                Math.sin(kk * Math.PI) * 0.85 * it.alpha, lerp(0.2, 1.35, easeOutK(kk)));
              const ringK = easeOutK(clamp(el / (fx.dur * 0.6), 0, 1));
              ctx.strokeStyle = hexA(GOLD, (1 - ringK) * 0.85 * it.alpha);
              ctx.lineWidth = 1.6;
              ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 6 + ringK * 26, 0, TAU); ctx.stroke();
            }
          }
        }
        if (it.birth && !it.birth.degraded && it.birth.k >= 0.15 && it.birth.k < 0.65) {
          const fk = (it.birth.k - 0.15) / 0.5;
          drawGlow(ctx, '#ffffff', it.x, it.y, it.r * 6.5,
            Math.sin(clamp(fk, 0, 1) * Math.PI) * 0.45 * it.alpha * bAl);
        }
        ctx.globalAlpha = 1;
        hoverMark(ctx, it);
        return;
      }

      if (it.kind === 'planet') {
        const p = it.data;
        const state = p.state;
        let c2 = sessColor(palette, 'planet', state, p, t);
        const viewK = viewKOf(it, t);
        if (viewK > 0) c2 = mix(SESS['done-unread'], c2, viewK);
        const al = it.alpha * birthAlphaOf(it);
        const waitFade = mixFade(p, t, 'waiting');
        const doneFade = mixFade(p, t, 'done-unread');
        drawGlow(ctx, c2, it.x, it.y, Math.min(it.r * 4, 30), al * 0.7);
        trailStroke(ctx, it.trail, c2, 0.25, 0.5, 1.1, al);
        ctx.globalAlpha = al;
        ctx.fillStyle = c2;
        ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(1.7, it.r * 0.55), 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(240,250,255,0.55)';
        ctx.lineWidth = 0.9;
        ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(1.4, it.r * 0.42), -2.4, -1.2); ctx.stroke();
        ctx.strokeStyle = hexA(c2, 0.3 * al);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 3.5, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
        if (p.delegatedBusy) {
          const busyA = 0.25 * (0.5 + 0.5 * Math.sin(t * Math.PI));
          ctx.strokeStyle = hexA(SESS.busy, busyA * al);
          ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 11, 0, TAU); ctx.stroke();
        }
        if (state === 'done-unread' || viewK > 0) {
          doneHalo(ctx, it.x, it.y, it.r, t, al, (1 - viewK) * doneFade, p.phase);
        }
        if (state === 'waiting') waitingSignal(ctx, it.x, it.y, it.r, c2, t, al, waitFade, 7.7);
        hoverMark(ctx, it);
        return;
      }

      if (it.kind === 'suborbit') {
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
        const s = it.data;
        const bornK = satBornKOf(it);
        const rF = easeOutK(bornK);
        const c4 = mix(sessColor(palette, 'sat', s.state, s, t), '#707c9c', 0.3);
        trailStroke(ctx, it.trail, c4, 0.22, 0.5, 1.0, it.alpha * bornK);
        drawGlow(ctx, c4, it.x, it.y, it.r * 2.6, it.alpha * bornK * 0.45);
        ctx.globalAlpha = it.alpha * bornK;
        ctx.fillStyle = c4;
        ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(1.3, it.r * rF), 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(240,250,255,0.45)';
        ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(1.1, it.r * rF * 0.7), -2.3, -1.2); ctx.stroke();
        ctx.globalAlpha = 1;
        if (s.state === 'waiting') {
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
        drawGlow(ctx, c3, it.x, it.y, Math.min(it.r * 3.8, 26), it.alpha * bCore * 0.8);
        /* 液滴：泪滴形沿运动方向 */
        let ang = 0;
        const tr = it.trail;
        if (tr && tr.length > 1) ang = Math.atan2(tr[tr.length - 1].y - tr[tr.length - 2].y, tr[tr.length - 1].x - tr[tr.length - 2].x);
        const rr = Math.max(2, it.r * 0.8);
        ctx.save();
        ctx.globalAlpha = it.alpha * bCore;
        ctx.translate(it.x, it.y);
        ctx.rotate(ang);
        ctx.beginPath();
        ctx.moveTo(rr * 1.25, 0);
        ctx.quadraticCurveTo(rr * 0.25, rr * 0.7, -rr * 0.9, 0);
        ctx.quadraticCurveTo(rr * 0.25, -rr * 0.7, rr * 1.25, 0);
        ctx.closePath();
        ctx.fillStyle = c3; ctx.fill();
        ctx.strokeStyle = 'rgba(240,250,255,0.4)';
        ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.arc(rr * 0.1, 0, rr * 0.4, -2.2, -1.1); ctx.stroke();
        ctx.restore();
        ctx.globalAlpha = 1;
        if (c.delegatedBusy) {
          const busyA = 0.25 * (0.5 + 0.5 * Math.sin(t * Math.PI));
          ctx.strokeStyle = hexA(SESS.busy, busyA * it.alpha * bCore);
          ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 11, 0, TAU); ctx.stroke();
        }
        if (state === 'done-unread' || viewK > 0) {
          doneHalo(ctx, it.x, it.y, it.r, t, it.alpha * bCore, (1 - viewK) * doneFade, c.phase);
        }
        if (state === 'waiting') waitingSignal(ctx, it.x, it.y, it.r, c3, t, it.alpha * bCore, waitFade, 3.3);
        return;
      }

      if (it.kind === 'wsghost') {
        /* 星座消散：沉淀上浮外散 + 反应核余辉渐熄 */
        it.dust.forEach(function (p) {
          ctx.globalAlpha = clamp(p.a * 0.4, 0, 1);
          ctx.fillStyle = DUST[p.hue < 0.5 ? 0 : 1];
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(0.7, p.s * 0.4), 0, TAU);
          ctx.fill();
        });
        ctx.globalAlpha = 1;
        it.stars.forEach(function (st) {
          drawGlow(ctx, st.color, st.x, st.y, Math.min(st.r * 3.0, 40), st.a * 0.55);
          ctx.globalAlpha = st.a * 0.7;
          ctx.fillStyle = st.color;
          ctx.beginPath(); ctx.arc(st.x, st.y, Math.max(1, st.r * 0.4), 0, TAU); ctx.fill();
          ctx.globalAlpha = 1;
        });
        return;
      }

      if (it.kind === 'nova') {
        /* 超新星（化学母语）：反应失控爆燃 → 冲击波（玻璃环）+ 火花 → 沉淀归底 */
        const n = it.data;
        const base = it.r;
        const seed = hashSeed(n.id);
        if (n.degraded) {
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
          bubbles(ctx, it.x, it.y, Math.max(2, base), it.k * 2, seed + 5, hexA(n.color, 1), (1 - pk) * 0.5);
          return;
        }
        const el = it.k * n.dur;
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
        trailStroke(ctx, it.trail, '#dff2ff', 0.55, 0.5, 1.6, it.alpha);
        drawGlow(ctx, '#ffffff', it.x, it.y, 11, it.alpha);
      }
    }
  };
}
