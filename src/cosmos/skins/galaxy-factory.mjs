/**
 * 「星系系」配置型皮肤工厂（add-cosmos-skin-themes 1.3）。
 *
 * 对应 demo/skins/assets/skinlib.js 的 makeBackground/makeDrawBody 通用工厂，但**接齐
 * 引擎实喂的全量条目分支与转场消费面**（design D5）：
 *   dust / constline（{a,b,alpha} 段对象）/ orbit / star（proto 星胚 + ignite/stamp/surge +
 *   birth + act 热度）/ planet（colorMix + fx.view + birth + waiting + done-unread +
 *   delegatedBusy + trail）/ suborbit / sat（bornK + colorMix + 迷你光柱）/ comet（同上 +
 *   渐熄）/ wsghost（消散幽灵）/ nova（常规三段 + 星胚低强度 + 风暴降级）/ meteor。
 *
 * 引擎实喂口径与 demo mock 的差异在此一次吸收（design D5 词汇映射）：
 * `it.data.lifecycle`（非 status）、`seg.a/seg.b`（非数组）、`it.birth/it.fx/it.bornK`。
 * 皮肤的差异全部来自 `cfg`（色板 + 气质参数），因此三套配置型皮肤 = 三份 cfg。
 *
 * 纸面模式（fidenza）不走本工厂——水彩/版画语言需要独立 background/drawBody（D8：
 * MUST NOT 用 lighter 加色）。
 */

import {
  TAU, clamp, lerp, easeOutK, mix, hexA, dimColor, hashSeed, hashRand,
  makeGlowCache, trailStroke, sessColor, mixFade, viewKOf, birthAlphaOf, segAlphaOf,
  dustBornK, satBornKOf
} from '../skin-kit.mjs';

function resolveBgStars(cfg) {
  if (typeof cfg.bgStars === 'function') return cfg.bgStars;
  const s = cfg.bgStars || { dim: '#a8b8d8', mid: '#eef6ff', bright: '#ffe9cf' };
  return function (m) { return m > 0.9 ? s.bright : (m < 0.5 ? s.dim : s.mid); };
}

/**
 * 创建配置型皮肤实例。
 * @param {object} cfg 皮肤配置（见下方各 skin-*.mjs）
 * @returns {{skin: string, useBand: boolean, palette: object, gold: string, bgStarColor: Function, dustColors: string[], background: Function, drawBody: Function}}
 */
export function createGalaxySkin(cfg) {
  const glow = makeGlowCache();
  const palette = { prop: cfg.prop, sess: cfg.sess };
  const bgStarColor = resolveBgStars(cfg);
  const gold = cfg.gold;
  const selection = cfg.selection || gold;
  const glowK = cfg.glowK == null ? 1 : cfg.glowK;
  const dustAlpha = cfg.dustAlpha == null ? 1 : cfg.dustAlpha;
  const line = cfg.line || { dash: [2, 4], alpha: 0.28 };
  const lineColor = line.color || gold;
  const orbit = cfg.orbit || { dash: [4, 6], alpha: 0.20, off: false };
  const meteor = cfg.meteor || { trail: '#ffe9cf', head: '#fff3e0' };
  const bg = cfg.bg || { mode: 'flat', base: '#0b0d12' };
  let grad = null, gradKey = '';
  let vig = null, vigKey = '';

  function drawGlow(ctx, hex, x, y, R, a) { glow.draw(ctx, hex, x, y, R, a * glowK); }

  /* ── act 热度耀斑（颜色不承担执行语义；风格 D 之外按皮肤气质选形） ── */
  function heatFlare(ctx, c, x, y, r, act, al, t) {
    if (cfg.flare === 'none') return;
    if (cfg.flare === 'rays') {
      ctx.strokeStyle = hexA(c, 0.42 * al);
      ctx.lineWidth = 1;
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * TAU + t * 0.15;
        const Lg = r * (k % 2 === 0 ? 3.4 : 2.2);
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(ang) * r * 0.9, y + Math.sin(ang) * r * 0.9);
        ctx.lineTo(x + Math.cos(ang) * Lg, y + Math.sin(ang) * Lg);
        ctx.stroke();
      }
      return;
    }
    if (cfg.flare === 'halo') {
      ctx.strokeStyle = hexA(c, 0.4 * al);
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      ctx.beginPath(); ctx.arc(x, y, r * 2.1 + Math.sin(t * 2) * 1.5, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      return;
    }
    /* cross（默认 = 风格 D 十字耀斑） */
    const hot = mix(c, '#ffffff', Math.min(0.5, 0.18 * act));
    ctx.strokeStyle = hexA(hot, 0.45 * al);
    ctx.lineWidth = 1;
    const L = r * 3.4;
    ctx.beginPath();
    ctx.moveTo(x - L, y); ctx.lineTo(x + L, y);
    ctx.moveTo(x, y - L); ctx.lineTo(x, y + L);
    ctx.stroke();
  }

  /* ── 恒星本体（created/reviewed/executed 共用；act 只加白热核 + 耀斑） ── */
  function starCore(ctx, x, y, r, c, act, al, t) {
    act = act || 0;
    drawGlow(ctx, c, x, y, Math.min(r * 5.4, 70), al * (0.5 + act * 0.2));
    ctx.globalAlpha = al;
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(x, y, Math.max(1.4, r * 0.5), 0, TAU); ctx.fill();
    if (act > 0) {
      ctx.fillStyle = cfg.hotCore === false ? hexA(c, 0.9) : 'rgba(255,255,255,0.95)';
      ctx.beginPath(); ctx.arc(x, y, Math.max(0.8, r * 0.26), 0, TAU); ctx.fill();
      heatFlare(ctx, c, x, y, r, act, al, t);
    }
    ctx.globalAlpha = 1;
  }

  /* ── 星胚（方案一「星章」dash-outline）：虚线轮廓 + 呼吸 + 淡核；
     igniteP∈[0,0.3] 轮廓收缩（点燃转场 A 段）。 ── */
  function protoStar(ctx, x, y, r, c, t, al, phase, breath, igniteP) {
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

  /* ── 已审核印章环：stampP≥0 播放落印（半径 ×2.2→1 easeOut + α 淡入） ── */
  function sealRing(ctx, x, y, rr, a, w, stampP) {
    let rad = rr, aa = a;
    if (stampP >= 0) {
      rad = lerp(rr * 2.2, rr, easeOutK(stampP));
      aa = lerp(0, a, stampP);
    }
    ctx.strokeStyle = hexA(gold, aa);
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.stroke();
  }

  /* ── executed 金涌（4.2/D4）：金色辉光内收脉冲 + 金环一次闪光 ── */
  function surgeFx(ctx, it, t) {
    const fx = it.fx;
    if (!fx || fx.type !== 'surge') return;
    const el = t - fx.t0;
    if (el <= 0) return;
    const kk = clamp(el / fx.dur, 0, 1);
    drawGlow(ctx, palette.prop.executed, it.x, it.y,
      Math.min(it.r * 5.4 * lerp(2.2, 1, easeOutK(kk)), 150),
      Math.sin(kk * Math.PI) * 0.85 * it.alpha);
    const ringK = easeOutK(clamp(el / (fx.dur * 0.6), 0, 1));
    ctx.strokeStyle = hexA(palette.prop.executed, (1 - ringK) * 0.8 * it.alpha);
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 6 + ringK * 26, 0, TAU); ctx.stroke();
  }

  /* ── 悬停/选中标记（三种皮肤气质：圆环+虚环 / 单环 / 方括号） ── */
  function hoverMark(ctx, it) {
    if (!it.hovered && !it.selected) return;
    const c = it.selected ? selection : hexA(selection, 0.55);
    ctx.lineWidth = 1.2;
    if (cfg.hover === 'brackets') {
      const d = it.r + 7, q = 5;
      ctx.strokeStyle = c;
      ctx.beginPath();
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (sx) {
        const cx = it.x + sx[0] * d, cy = it.y + sx[1] * d;
        ctx.moveTo(cx, cy + sx[1] * -q); ctx.lineTo(cx, cy); ctx.lineTo(cx + sx[0] * -q, cy);
      });
      ctx.stroke();
      return;
    }
    ctx.strokeStyle = c;
    ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 6, 0, TAU); ctx.stroke();
    if (cfg.hover === 'ring') return;
    ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 11, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
  }

  /* ── 等批准注意力信号（P0 常驻属性，MUST NOT 降级；强度乘 colorMix 坡道） ── */
  function waitingSignal(ctx, x, y, r, c, t, al, fade) {
    if (cfg.waiting === 'pulse') {
      const pr = r + 4 + ((t * 22) % 14);
      ctx.strokeStyle = hexA(c, clamp(0.65 * (1 - (pr - r - 4) / 14), 0, 1) * al * fade);
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(x, y, pr, 0, TAU); ctx.stroke();
      return;
    }
    const g = ctx.createLinearGradient(x, y - 36, x, y);
    g.addColorStop(0, hexA(c, 0));
    g.addColorStop(1, hexA(c, 0.85 * al * fade));
    ctx.strokeStyle = g; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y - 36); ctx.lineTo(x, y - 4); ctx.stroke();
    const rr = r + 4 + ((t * 26) % 16);
    ctx.strokeStyle = hexA(c, clamp(0.7 * (1 - (rr - r - 4) / 16), 0, 1) * al * fade);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.stroke();
  }

  /* ── 完成未读 halo（薄荷绿慢脉动；view 渐熄沿 keep 消退） ── */
  function doneHalo(ctx, x, y, r, t, al, keep, phase) {
    if (keep <= 0.02) return;
    const ph = phase || 0;
    const hr = r + 9 + 3 * Math.sin(t * 1.8 + ph);
    const cDone = palette.sess['done-unread'];
    ctx.strokeStyle = hexA(cDone, (0.22 + 0.14 * Math.sin(t * 1.8 + ph)) * al * keep);
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(x, y, hr, 0, TAU); ctx.stroke();
    drawGlow(ctx, cDone, x, y, r * 3.2, 0.18 * al * keep);
  }

  function delegatedRing(ctx, x, y, r, t, al) {
    const busyA = 0.25 * (0.5 + 0.5 * Math.sin(t * Math.PI));
    ctx.strokeStyle = hexA(palette.sess.busy, busyA * al);
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(x, y, r + 11, 0, TAU); ctx.stroke();
  }

  return {
    skin: cfg.id,
    useBand: !!(bg.mode === 'band'),
    palette,
    gold,
    bgStarColor,
    dustColors: cfg.dust,

    background(ctx, view) {
      if (bg.mode === 'gradient') {
        const key = view.W + 'x' + view.H;
        if (gradKey !== key || !grad) {
          grad = ctx.createRadialGradient(view.W / 2, view.H / 2, 0, view.W / 2, view.H / 2, Math.max(view.W, view.H) * 0.75);
          grad.addColorStop(0, bg.stops[0]);
          grad.addColorStop(0.6, bg.stops[1]);
          grad.addColorStop(1, bg.stops[2]);
          gradKey = key;
        }
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, view.W, view.H);
      } else {
        ctx.fillStyle = bg.base;
        ctx.fillRect(0, 0, view.W, view.H);
        if (bg.mode === 'band' && view.band) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          const colors = bg.colors || ['#ffffff'];
          for (let i = 0; i < view.band.length; i++) {
            const b = view.band[i];
            if (b.a < 0.02) continue;
            ctx.globalAlpha = b.a * 0.6;
            ctx.fillStyle = colors[(b.m * colors.length) | 0] || '#ffffff';
            const size = 0.7 + b.m * 1.4;
            ctx.fillRect(b.x - size / 2, b.y - size / 2, size, size);
          }
          ctx.restore();
        }
      }
      if (cfg.vignette) {
        const vkey = view.W + 'x' + view.H;
        if (vigKey !== vkey || !vig) {
          vig = ctx.createRadialGradient(view.W / 2, view.H / 2, 0, view.W / 2, view.H / 2, Math.max(view.W, view.H) * 0.72);
          vig.addColorStop(0, cfg.vignette[1] || bg.base);
          vig.addColorStop(1, cfg.vignette[0]);
          vigKey = vkey;
        }
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, view.W, view.H);
      }
      const bs = view.bgStars;
      for (let j = 0; j < bs.length; j++) {
        const s = bs[j];
        if (s.a < 0.03) continue;
        const c = bgStarColor(s.m);
        const size2 = 0.7 + s.m * 1.3;
        if (s.m > 0.9) drawGlow(ctx, c, s.x, s.y, 3.6, s.a * 0.8);
        ctx.globalAlpha = s.a;
        ctx.fillStyle = c;
        ctx.fillRect(s.x - size2 / 2, s.y - size2 / 2, size2, size2);
      }
      ctx.globalAlpha = 1;
    },

    drawBody(ctx, it, view) {
      const t = view.t;

      if (it.kind === 'dust') {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        it.pts.forEach(function (p) {
          const bornK = dustBornK(p, t);
          ctx.globalAlpha = clamp(p.a * bornK * 0.5 * dustAlpha, 0, 1);
          ctx.fillStyle = cfg.dust[p.hue < 0.5 ? 0 : 1];
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(0.6, p.s * 0.42), 0, TAU);
          ctx.fill();
        });
        ctx.restore();
        return;
      }

      if (it.kind === 'constline') {
        ctx.lineWidth = 1;
        ctx.setLineDash(line.dash || []);
        it.segs.forEach(function (seg) {
          ctx.strokeStyle = hexA(lineColor, (line.alpha * it.alpha * segAlphaOf(seg)).toFixed(3));
          ctx.beginPath();
          ctx.moveTo(seg.a.x, seg.a.y);
          ctx.lineTo(seg.b.x, seg.b.y);
          ctx.stroke();
        });
        ctx.setLineDash([]);
        return;
      }

      if (it.kind === 'orbit') {
        if (orbit.off) return;
        ctx.strokeStyle = hexA(lineColor, (orbit.alpha * it.alpha).toFixed(3));
        ctx.lineWidth = 1;
        ctx.setLineDash(orbit.dash || []);
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
        if (lifecycle === 'proto') {
          const phase = st.starIndex || 0;
          const breath = (Math.sin(t * 1.6 + phase) + 1) / 2;
          const protoC = palette.prop.proto;
          const igniteP = fx && fx.type === 'ignite' ? clamp((t - fx.t0) / fx.dur, 0, 1) : -1;
          if (igniteP >= 0 && igniteP > 0.55) {
            starCore(ctx, it.x, it.y, it.r,
              mix(protoC, palette.prop.created, (igniteP - 0.55) / 0.45), act, it.alpha * bAl, t);
          } else {
            protoStar(ctx, it.x, it.y, it.r, protoC, t, it.alpha * bAl, phase, breath, igniteP);
          }
          if (igniteP >= 0.30 && igniteP < 0.75) {
            const fk = (igniteP - 0.30) / 0.45;
            drawGlow(ctx, '#ffffff', it.x, it.y, it.r * 6.5, Math.sin(clamp(fk, 0, 1) * Math.PI) * 0.9 * it.alpha);
          }
        } else {
          const c = palette.prop[lifecycle] || '#ffffff';
          starCore(ctx, it.x, it.y, it.r, c, act, it.alpha * bAl, t);
          if (lifecycle === 'reviewed') {
            const stampP = fx && fx.type === 'stamp' ? clamp((t - fx.t0) / fx.dur, 0, 1) : -1;
            sealRing(ctx, it.x, it.y, it.r + 6, 0.85 * it.alpha, 1.4, stampP);
          }
        }
        if (it.birth && !it.birth.degraded && it.birth.k >= 0.15 && it.birth.k < 0.65) {
          const fk = (it.birth.k - 0.15) / 0.5;
          drawGlow(ctx, '#ffffff', it.x, it.y, it.r * 6.5,
            Math.sin(clamp(fk, 0, 1) * Math.PI) * 0.45 * it.alpha * bAl);
        }
        surgeFx(ctx, it, t);
        ctx.globalAlpha = 1;
        hoverMark(ctx, it);
        return;
      }

      if (it.kind === 'planet') {
        const p = it.data;
        const state = p.state;
        let c2 = sessColor(palette, 'planet', state, p, t);
        const viewK = viewKOf(it, t);
        if (viewK > 0) c2 = mix(palette.sess['done-unread'], c2, viewK);
        const al = it.alpha * birthAlphaOf(it);
        const waitFade = mixFade(p, t, 'waiting');
        const doneFade = mixFade(p, t, 'done-unread');
        drawGlow(ctx, c2, it.x, it.y, Math.min(it.r * 4.4, 36), al * 0.85);
        trailStroke(ctx, it.trail, c2, 0.3, 0.5, 1.3, al);
        ctx.globalAlpha = al;
        ctx.fillStyle = c2;
        ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(1.6, it.r * 0.55), 0, TAU); ctx.fill();
        if (cfg.rings === 'double') {
          ctx.strokeStyle = hexA(c2, 0.4 * al);
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 4, 0, TAU); ctx.stroke();
          ctx.strokeStyle = hexA(c2, 0.18 * al);
          ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 8, 0, TAU); ctx.stroke();
        } else if (cfg.rings === 'single') {
          ctx.strokeStyle = hexA(c2, 0.45 * al);
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 4, 0, TAU); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        if (p.delegatedBusy) delegatedRing(ctx, it.x, it.y, it.r, t, al);
        if (state === 'done-unread' || viewK > 0) {
          doneHalo(ctx, it.x, it.y, it.r, t, al, (1 - viewK) * doneFade, p.phase);
        }
        if (state === 'waiting') waitingSignal(ctx, it.x, it.y, it.r, c2, t, al, waitFade);
        hoverMark(ctx, it);
        return;
      }

      if (it.kind === 'suborbit') {
        const oc = palette.sess[it.data && it.data.state] || palette.sess.idle;
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
        const c4 = dimColor(sessColor(palette, 'sat', s.state, s, t));
        trailStroke(ctx, it.trail, c4, 0.22, 0.5, 1.1, it.alpha * bornK);
        drawGlow(ctx, c4, it.x, it.y, it.r * 2.6, it.alpha * bornK * 0.45);
        ctx.globalAlpha = it.alpha * bornK;
        ctx.fillStyle = c4;
        ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(1.4, it.r * rF), 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        if (s.state === 'waiting') {
          const satWaitFade = bornK * mixFade(s, t, 'waiting');
          const h = it.r * 2.6 + 6;
          const g = ctx.createLinearGradient(it.x, it.y - h, it.x, it.y);
          g.addColorStop(0, hexA(palette.sess.waiting, 0));
          g.addColorStop(1, hexA(palette.sess.waiting, 0.7 * it.alpha * satWaitFade));
          ctx.strokeStyle = g; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.moveTo(it.x, it.y - h); ctx.lineTo(it.x, it.y - 2); ctx.stroke();
          const pp = ((t * 22) % 10) / 10;
          const rr = it.r + 2 + pp * 7;
          ctx.strokeStyle = hexA(palette.sess.waiting, (1 - pp) * 0.5 * it.alpha * satWaitFade);
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
        if (viewK > 0) c3 = mix(palette.sess['done-unread'], c3, viewK);
        const birth = it.birth || null;
        const bCore = birth ? birth.alpha : 1;
        const bTrail = birth ? birth.trailAlpha : 1;
        const waitFade = mixFade(c, t, 'waiting');
        const doneFade = mixFade(c, t, 'done-unread');
        trailStroke(ctx, it.trail, c3, 0.5, 0.6, 1.9, it.alpha * bTrail);
        drawGlow(ctx, c3, it.x, it.y, Math.min(it.r * 4.2, 32), it.alpha * bCore * 0.9);
        ctx.globalAlpha = it.alpha * bCore;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(1.4, it.r * 0.45), 0, TAU); ctx.fill();
        ctx.strokeStyle = hexA(c3, 0.45 * it.alpha * bCore);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 4, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
        if (c.delegatedBusy) delegatedRing(ctx, it.x, it.y, it.r, t, it.alpha * bCore);
        if (state === 'done-unread' || viewK > 0) {
          doneHalo(ctx, it.x, it.y, it.r, t, it.alpha * bCore, (1 - viewK) * doneFade, c.phase);
        }
        if (state === 'waiting') waitingSignal(ctx, it.x, it.y, it.r, c3, t, it.alpha * bCore, waitFade);
        return;
      }

      if (it.kind === 'wsghost') {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        it.dust.forEach(function (p) {
          ctx.globalAlpha = clamp(p.a * 0.5, 0, 1);
          ctx.fillStyle = cfg.dust[p.hue < 0.5 ? 0 : 1];
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(0.6, p.s * 0.42), 0, TAU);
          ctx.fill();
        });
        it.stars.forEach(function (st) {
          drawGlow(ctx, st.color, st.x, st.y, Math.min(st.r * 3.0, 40), st.a * 0.6);
          ctx.globalAlpha = st.a * 0.7;
          ctx.fillStyle = st.color;
          ctx.beginPath(); ctx.arc(st.x, st.y, Math.max(1, st.r * 0.4), 0, TAU); ctx.fill();
        });
        ctx.restore();
        ctx.globalAlpha = 1;
        return;
      }

      if (it.kind === 'nova') {
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
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          for (let i = 0; i < 6; i++) {
            const ang = hashRand(seed + i * 7.3) * TAU;
            const d = base * (0.5 + hashRand(seed + i * 3.1) * 1.2) * easeOutK(pk);
            ctx.globalAlpha = (1 - pk) * 0.3;
            ctx.fillStyle = hexA(n.color, 0.7);
            ctx.beginPath();
            ctx.arc(it.x + Math.cos(ang) * d, it.y + Math.sin(ang) * d, 1.0, 0, TAU);
            ctx.fill();
          }
          ctx.restore();
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
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          for (let i = 0; i < 5; i++) {
            const ang = hashRand(seed + i * 7.3) * TAU;
            const d = base * (0.6 + hashRand(seed + i * 3.1) * 1.4) * easeOutK(pk);
            ctx.globalAlpha = (1 - pk) * 0.4;
            ctx.fillStyle = hexA(n.color, 0.8);
            ctx.beginPath();
            ctx.arc(it.x + Math.cos(ang) * d, it.y + Math.sin(ang) * d, 1.1, 0, TAU);
            ctx.fill();
          }
          ctx.restore();
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
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          for (let i = 0; i < 13; i++) {
            const lag = hashRand(seed + i * 17.9) * 0.25;
            const gk = clamp((ck - lag) / (1 - lag), 0, 1);
            if (gk <= 0) continue;
            const ang = hashRand(seed + i * 7.3) * TAU;
            const r0 = base * (0.5 + hashRand(seed + i * 5.7) * 0.9);
            const ex = it.drift ? it.drift.x : it.x + Math.cos(ang) * base * 2;
            const ey = it.drift ? it.drift.y : it.y + Math.sin(ang) * base * 2;
            ctx.globalAlpha = (1 - gk) * 0.55;
            ctx.fillStyle = i % 2 === 0 ? cfg.dust[0] : cfg.dust[1];
            ctx.beginPath();
            ctx.arc(lerp(it.x + Math.cos(ang) * r0, ex, easeOutK(gk)),
              lerp(it.y + Math.sin(ang) * r0, ey, easeOutK(gk)),
              0.9 + hashRand(seed + i * 11.3) * 1.1, 0, TAU);
            ctx.fill();
          }
          ctx.restore();
        }
        return;
      }

      if (it.kind === 'meteor') {
        trailStroke(ctx, it.trail, meteor.trail, 0.6, 0.5, 1.7, it.alpha);
        drawGlow(ctx, meteor.head, it.x, it.y, 12, it.alpha);
      }
    }
  };
}
