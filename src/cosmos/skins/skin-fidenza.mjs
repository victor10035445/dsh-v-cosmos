/**
 * 皮肤 · 费登莎暖矿 Fidenza（light 模式；add-cosmos-skin-themes 1.3）。
 *
 * 血统：Tyler Hobbs 方法论（纸面透明星空）。纸纹肌理（斑点 + 纤维）+ 矿物色水彩透明晕；
 * 星光从水彩下层透出，星体为版画四芒星 + 墨描边；等批准 = 朱砂笔圈脉冲。
 *
 * 性能纪律（design D8）：**MUST NOT 使用 `lighter` 加色合成**——一切辉光走 `wash`
 * （source-over 低 α 水彩晕）；扫描线由 HUD 令牌关闭（`--cos-scan: transparent` +
 * `[data-cos-mode="light"]` 分支）。
 *
 * 转场消费面（D5）与星系系同口径：birth α / colorMix 色相滑移 / fx.view 渐熄 /
 * ignite 点燃三态 / stamp 落印 / surge 金涌本地化为「金晕 + 朱砂笔圈」/ nova 风暴降级 /
 * wsghost 消散 / seg.alpha。
 */

import {
  TAU, clamp, lerp, easeOutK, mix, hexA, engraveStar, hashSeed, hashRand,
  makeGlowCache, trailStroke, sessColor, mixFade, viewKOf, birthAlphaOf, segAlphaOf,
  dustBornK, satBornKOf, makeDustSprite, dustBatchDraw, patDotDraw
} from '../skin-kit.mjs';

const CREATED = '#5b84a8';
const INK = '#33322e';
const CINNABAR = '#c0392b';
const GOLD = '#d9a441';

const PROP = Object.freeze({
  proto: '#8d9aa4',
  created: CREATED,
  reviewed: mix(CREATED, '#ffffff', 0.42),
  executed: GOLD
});

const SESS = Object.freeze({
  idle: '#a8a296',
  busy: '#3f6f74',
  waiting: CINNABAR,
  'done-unread': '#7a9a5e',
  free: '#4a8f96'
});

/* 纸纹肌理：斑点 + 纤维丝，一次性生成 256px 图块（惰性，import 期零 DOM）。 */
let paperCanvas = null;
function makePaper() {
  if (paperCanvas) return paperCanvas;
  if (typeof document !== 'object' || !document || typeof document.createElement !== 'function') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#f4efe4';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    const x = hashRand(i * 3.1) * 256, y = hashRand(i * 7.7 + 1) * 256;
    g.globalAlpha = 0.05;
    g.fillStyle = hashRand(i * 1.7) > 0.5 ? '#8a7a5a' : '#b8a888';
    g.fillRect(x, y, 1 + hashRand(i * 5.3) * 1.4, 1);
  }
  g.globalAlpha = 0.035;
  g.strokeStyle = '#9a8a6a';
  g.lineWidth = 0.6;
  for (let f = 0; f < 55; f++) {
    const fx = hashRand(f * 2.3) * 256, fy = hashRand(f * 6.1 + 2) * 256;
    const fl = 4 + hashRand(f * 4.9) * 10, fa = hashRand(f * 8.3) * Math.PI;
    g.beginPath();
    g.moveTo(fx, fy);
    g.lineTo(fx + Math.cos(fa) * fl, fy + Math.sin(fa) * fl);
    g.stroke();
  }
  g.globalAlpha = 1;
  paperCanvas = c;
  return c;
}

/** 创建费登莎暖矿皮肤实例（纸面 light 模式）。 */
export function createSkinFidenza() {
  const glow = makeGlowCache();
  const dustBrush = makeDustSprite(); // 尘埃 sprite 缓存（每皮肤实例独立，防跨皮肤串色）
  const palette = { prop: PROP, sess: SESS };

  function wash(ctx, hex, x, y, R, a) { glow.wash(ctx, hex, x, y, R, a); }

  /* ── 版画四芒星 + 墨描边 + 热度墨核（act 通道） ── */
  function engraveBody(ctx, x, y, r, c, act, al, t) {
    wash(ctx, c, x, y, Math.min(r * 4.4, 46), al * 0.42);
    ctx.globalAlpha = al;
    engraveStar(ctx, x, y, Math.max(2.6, r * 1.15), c);
    ctx.strokeStyle = hexA(INK, 0.55);
    ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.arc(x, y, Math.max(1.6, r * 0.42), 0, TAU); ctx.stroke();
    if (act > 0) {
      ctx.fillStyle = hexA(INK, 0.85);
      ctx.beginPath(); ctx.arc(x, y, Math.max(0.8, r * 0.2), 0, TAU); ctx.fill();
      /* 放射短笔触（热度） */
      ctx.strokeStyle = hexA(c, 0.4 * al);
      ctx.lineWidth = 1;
      for (let k = 0; k < 4; k++) {
        const a2 = (k / 4) * TAU + Math.PI / 4 + t * 0.1;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a2) * r * 1.6, y + Math.sin(a2) * r * 1.6);
        ctx.lineTo(x + Math.cos(a2) * r * 2.4, y + Math.sin(a2) * r * 2.4);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  /* ── 星胚：墨虚线刻痕 + 呼吸（版画语言） ── */
  function protoBody(ctx, x, y, r, al, phase, breath, igniteP) {
    const c = PROP.proto;
    wash(ctx, c, x, y, Math.min(r * 4.0, 40), al * 0.3);
    const contract = igniteP >= 0 ? easeOutK(clamp(igniteP / 0.3, 0, 1)) : 0;
    const ro = igniteP >= 0 ? lerp(r + 5, r * 0.6, contract) : r + 5 + breath * 2;
    const oa = igniteP >= 0 ? 0.55 + contract * 0.35 : 0.42 + breath * 0.3;
    ctx.save();
    ctx.strokeStyle = hexA(c, oa * al);
    ctx.lineWidth = 1.1;
    ctx.setLineDash([4, 5]);
    ctx.lineDashOffset = -phase * 3;
    ctx.beginPath(); ctx.arc(x, y, ro, 0, TAU); ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = al * 0.5;
    ctx.fillStyle = INK;
    ctx.beginPath(); ctx.arc(x, y, Math.max(0.9, r * 0.2), 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }

  /* ── 已审核落印：朱砂/金 笔圈（stampP≥0 播放落印） ── */
  function sealRing(ctx, x, y, rr, a, w, stampP) {
    let rad = rr, aa = a;
    if (stampP >= 0) {
      rad = lerp(rr * 2.2, rr, easeOutK(stampP));
      aa = lerp(0, a, stampP);
    }
    ctx.save();
    ctx.strokeStyle = hexA(GOLD, aa);
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.stroke();
    ctx.restore();
  }

  /* ── executed 金涌（母语化：金晕外扩 + 朱砂笔圈一次闪光） ── */
  function surgeFx(ctx, it, t) {
    const fx = it.fx;
    if (!fx || fx.type !== 'surge') return;
    const el = t - fx.t0;
    if (el <= 0) return;
    const kk = clamp(el / fx.dur, 0, 1);
    wash(ctx, PROP.executed, it.x, it.y,
      Math.min(it.r * 5.4 * lerp(2.2, 1, easeOutK(kk)), 150),
      Math.sin(kk * Math.PI) * 0.9 * it.alpha);
    const ringK = easeOutK(clamp(el / (fx.dur * 0.6), 0, 1));
    ctx.save();
    ctx.strokeStyle = hexA(GOLD, (1 - ringK) * 0.85 * it.alpha);
    ctx.lineWidth = 1.6;
    ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 6 + ringK * 26, 0, TAU); ctx.stroke();
    ctx.restore();
  }

  function hoverMark(ctx, it) {
    if (!it.hovered && !it.selected) return;
    ctx.save();
    ctx.strokeStyle = it.selected ? hexA(INK, 0.9) : hexA(INK, 0.5);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 5, 0, TAU); ctx.stroke();
    if (it.selected) {
      ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 9, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }

  /* ── 等批准：朱砂笔圈脉冲（P0 常驻；强度乘 colorMix 坡道） ── */
  function waitingSignal(ctx, x, y, r, t, al, fade) {
    const pr = r + 4 + ((t * 20) % 14);
    ctx.save();
    ctx.strokeStyle = hexA(CINNABAR, clamp(0.7 * (1 - (pr - r - 4) / 14), 0, 1) * al * fade);
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(x, y, pr, 0, TAU); ctx.stroke();
    ctx.restore();
  }

  function doneHalo(ctx, x, y, r, t, al, keep, phase) {
    if (keep <= 0.02) return;
    const ph = phase || 0;
    const hr = r + 9 + 3 * Math.sin(t * 1.8 + ph);
    ctx.save();
    ctx.strokeStyle = hexA(SESS['done-unread'], (0.24 + 0.14 * Math.sin(t * 1.8 + ph)) * al * keep);
    ctx.lineWidth = 1.4;
    ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.arc(x, y, hr, 0, TAU); ctx.stroke();
    ctx.restore();
    wash(ctx, SESS['done-unread'], x, y, r * 3.2, 0.22 * al * keep);
  }

  return {
    skin: 'fidenza',
    useBand: false,
    palette,
    gold: PROP.executed,
    bgStarColor(m) { return INK; },
    dustColors: ['#b8563e', '#3f6f74'],

    background(ctx, view) {
      const paper = makePaper();
      if (paper) {
        const pat = ctx.createPattern(paper, 'repeat');
        ctx.fillStyle = pat || '#f4efe4';
      } else {
        ctx.fillStyle = '#f4efe4';
      }
      ctx.fillRect(0, 0, view.W, view.H);
      /* 矿物色水彩透明晕：星光自晕染下层透出 */
      const washes = [
        { fx: 0.24, fy: 0.3, c: '63,111,116' },
        { fx: 0.72, fy: 0.62, c: '184,86,62' },
        { fx: 0.5, fy: 0.88, c: '217,164,65' }
      ];
      for (let w = 0; w < washes.length; w++) {
        const wx = view.W * washes[w].fx + Math.sin(view.t * 0.02 + w * 2) * 14;
        const wy = view.H * washes[w].fy;
        const wr = Math.max(view.W, view.H) * 0.3;
        const wg = ctx.createRadialGradient(wx, wy, 0, wx, wy, wr);
        wg.addColorStop(0, 'rgba(' + washes[w].c + ',0.07)');
        wg.addColorStop(0.7, 'rgba(' + washes[w].c + ',0.035)');
        wg.addColorStop(1, 'rgba(' + washes[w].c + ',0)');
        ctx.fillStyle = wg;
        ctx.fillRect(wx - wr, wy - wr, wr * 2, wr * 2);
      }
      /* 透明星空：墨点 + 版画小十字 */
      const bs = view.bgStars;
      for (let i = 0; i < bs.length; i++) {
        const s = bs[i];
        if (s.a < 0.1) continue;
        ctx.globalAlpha = s.a * 0.42;
        ctx.fillStyle = INK;
        const d = 0.6 + s.m * 1.0;
        ctx.fillRect(s.x - d / 2, s.y - d / 2, d, d);
        if (s.m > 0.93) {
          ctx.globalAlpha = s.a * 0.38;
          ctx.strokeStyle = INK;
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.moveTo(s.x - 3.4, s.y); ctx.lineTo(s.x + 3.4, s.y);
          ctx.moveTo(s.x, s.y - 3.4); ctx.lineTo(s.x, s.y + 3.4);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    },

    drawBody(ctx, it, view) {
      const t = view.t;

      if (it.kind === 'dust') {
        /* 纸面（light 模式）：共享原语 MUST NOT 引入 lighter——不声明合成模式，
           继承 source-over（与旧逐粒 arc+fill 同合成）；born 坡道 0.8s 沿用。 */
        dustBatchDraw(dustBrush, ctx, it.pts, ['#b8563e', '#3f6f74'], t, {
          alphaK: 0.26,
          radiusK: 0.42,
          minR: 0.7
        });
        return;
      }

      if (it.kind === 'constline') {
        it.segs.forEach(function (seg) {
          ctx.strokeStyle = hexA(INK, (0.3 * it.alpha * segAlphaOf(seg)).toFixed(3));
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(seg.a.x, seg.a.y);
          ctx.lineTo(seg.b.x, seg.b.y);
          ctx.stroke();
        });
        return;
      }

      if (it.kind === 'patdot') {
        /* 空槽装饰点（add-cosmos-template-figure-display 3.2）：版画顶点微印点——
           取墨色、基线 0.3（= 本皮肤连线基线），点弱化因子由引擎下发；
           纯装饰（不进 picks / 无 hover / 无名牌）。 */
        patDotDraw(ctx, it, INK, 0.3);
        return;
      }

      if (it.kind === 'orbit') {
        ctx.save();
        ctx.strokeStyle = hexA(INK, (0.16 * it.alpha).toFixed(3));
        ctx.lineWidth = 0.9;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        it.orbitPts.forEach(function (p, i) { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
        ctx.stroke();
        ctx.restore();
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
          const igniteP = fx && fx.type === 'ignite' ? clamp((t - fx.t0) / fx.dur, 0, 1) : -1;
          if (igniteP >= 0 && igniteP > 0.55) {
            engraveBody(ctx, it.x, it.y, it.r,
              mix(PROP.proto, PROP.created, (igniteP - 0.55) / 0.45), act, it.alpha * bAl, t);
          } else {
            protoBody(ctx, it.x, it.y, it.r, it.alpha * bAl, phase, breath, igniteP);
          }
          if (igniteP >= 0.30 && igniteP < 0.75) {
            const fk = (igniteP - 0.30) / 0.45;
            wash(ctx, '#ffffff', it.x, it.y, it.r * 6.5,
              Math.sin(clamp(fk, 0, 1) * Math.PI) * 0.9 * it.alpha);
          }
        } else {
          const c = PROP[lifecycle] || INK;
          engraveBody(ctx, it.x, it.y, it.r, c, act, it.alpha * bAl, t);
          if (lifecycle === 'reviewed') {
            const stampP = fx && fx.type === 'stamp' ? clamp((t - fx.t0) / fx.dur, 0, 1) : -1;
            sealRing(ctx, it.x, it.y, it.r + 6, 0.9 * it.alpha, 1.2, stampP);
          }
        }
        if (it.birth && !it.birth.degraded && it.birth.k >= 0.15 && it.birth.k < 0.65) {
          const fk = (it.birth.k - 0.15) / 0.5;
          wash(ctx, '#ffffff', it.x, it.y, it.r * 6.5,
            Math.sin(clamp(fk, 0, 1) * Math.PI) * 0.5 * it.alpha * bAl);
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
        if (viewK > 0) c2 = mix(SESS['done-unread'], c2, viewK);
        const al = it.alpha * birthAlphaOf(it);
        const waitFade = mixFade(p, t, 'waiting');
        const doneFade = mixFade(p, t, 'done-unread');
        wash(ctx, c2, it.x, it.y, Math.min(it.r * 3.6, 30), al * 0.5);
        trailStroke(ctx, it.trail, c2, 0.22, 0.5, 1.2, al);
        ctx.globalAlpha = al;
        ctx.fillStyle = c2;
        ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(1.6, it.r * 0.55), 0, TAU); ctx.fill();
        ctx.strokeStyle = hexA(INK, 0.6);
        ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(1.6, it.r * 0.55) + 1.1, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
        if (p.delegatedBusy) {
          const busyA = 0.25 * (0.5 + 0.5 * Math.sin(t * Math.PI));
          ctx.strokeStyle = hexA(SESS.busy, busyA * al);
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 11, 0, TAU); ctx.stroke();
        }
        if (state === 'done-unread' || viewK > 0) {
          doneHalo(ctx, it.x, it.y, it.r, t, al, (1 - viewK) * doneFade, p.phase);
        }
        if (state === 'waiting') waitingSignal(ctx, it.x, it.y, it.r, t, al, waitFade);
        hoverMark(ctx, it);
        return;
      }

      if (it.kind === 'suborbit') {
        const oc = SESS[it.data && it.data.state] || SESS.idle;
        ctx.save();
        ctx.strokeStyle = hexA(oc, 0.28 * it.alpha);
        ctx.lineWidth = 0.9;
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        it.orbitPts.forEach(function (p, i) { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
        ctx.stroke();
        ctx.restore();
        return;
      }

      if (it.kind === 'sat') {
        const s = it.data;
        const bornK = satBornKOf(it);
        const rF = easeOutK(bornK);
        const c4 = mix(sessColor(palette, 'sat', s.state, s, t), INK, 0.3);
        trailStroke(ctx, it.trail, c4, 0.22, 0.5, 1.0, it.alpha * bornK);
        ctx.globalAlpha = it.alpha * bornK;
        ctx.fillStyle = c4;
        ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(1.3, it.r * rF), 0, TAU); ctx.fill();
        ctx.strokeStyle = hexA(INK, 0.55 * bornK);
        ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(1.3, it.r * rF) + 1, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
        if (s.state === 'waiting') {
          const satFade = bornK * mixFade(s, t, 'waiting');
          const pp = ((t * 22) % 10) / 10;
          const rr = it.r + 2 + pp * 7;
          ctx.strokeStyle = hexA(SESS.waiting, (1 - pp) * 0.55 * it.alpha * satFade);
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
        trailStroke(ctx, it.trail, c3, 0.34, 0.5, 1.4, it.alpha * bTrail);
        wash(ctx, c3, it.x, it.y, Math.min(it.r * 3.2, 24), it.alpha * bCore * 0.6);
        ctx.globalAlpha = it.alpha * bCore;
        ctx.fillStyle = c3;
        ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(1.5, it.r * 0.45), 0, TAU); ctx.fill();
        ctx.strokeStyle = hexA(INK, 0.55 * bCore * it.alpha);
        ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(1.5, it.r * 0.45) + 1, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
        if (c.delegatedBusy) {
          const busyA = 0.25 * (0.5 + 0.5 * Math.sin(t * Math.PI));
          ctx.strokeStyle = hexA(SESS.busy, busyA * it.alpha * bCore);
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 11, 0, TAU); ctx.stroke();
        }
        if (state === 'done-unread' || viewK > 0) {
          doneHalo(ctx, it.x, it.y, it.r, t, it.alpha * bCore, (1 - viewK) * doneFade, c.phase);
        }
        if (state === 'waiting') waitingSignal(ctx, it.x, it.y, it.r, t, it.alpha * bCore, waitFade);
        return;
      }

      if (it.kind === 'wsghost') {
        it.dust.forEach(function (p) {
          ctx.globalAlpha = clamp(p.a * 0.3, 0, 1);
          ctx.fillStyle = p.hue < 0.5 ? '#b8563e' : '#3f6f74';
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(0.7, p.s * 0.4), 0, TAU);
          ctx.fill();
        });
        ctx.globalAlpha = 1;
        it.stars.forEach(function (st) {
          wash(ctx, st.color, st.x, st.y, Math.min(st.r * 3.0, 40), st.a * 0.5);
          ctx.globalAlpha = st.a * 0.6;
          ctx.fillStyle = st.color;
          engraveStar(ctx, st.x, st.y, Math.max(2, st.r * 0.5), hexA(st.color, 1));
          ctx.globalAlpha = 1;
        });
        return;
      }

      if (it.kind === 'nova') {
        /* 超新星（纸面母语）：墨晕炸开 + 水彩扩散 + 纸纹碎屑。 */
        const n = it.data;
        const base = it.r;
        const seed = hashSeed(n.id);
        if (n.degraded) {
          const pk = it.k;
          wash(ctx, n.color, it.x, it.y, base * 3 * (1 + pk * 0.6), (1 - pk) * 0.35);
          ctx.globalAlpha = (1 - pk) * 0.35;
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
          wash(ctx, n.color, it.x, it.y, base * 3 * (1 + pk * 0.8), (1 - pk) * 0.3);
          ctx.save();
          ctx.strokeStyle = hexA(n.color, (1 - pk) * 0.5);
          ctx.lineWidth = 1.1;
          ctx.setLineDash([4, 5]);
          ctx.beginPath();
          ctx.arc(it.x, it.y, base * lerp(1.1, 2.4, easeOutK(pk)), 0, TAU);
          ctx.stroke();
          ctx.restore();
          ctx.globalAlpha = (1 - pk) * 0.4;
          ctx.fillStyle = n.color;
          ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(0.8, base * 0.36 * (1 - pk)), 0, TAU); ctx.fill();
          ctx.globalAlpha = 1;
          return;
        }
        const el = it.k * n.dur;
        const coreP = el < 0.5 ? easeOutK(el / 0.5) : clamp((el - 0.9) / Math.max(0.01, n.dur - 0.9), 0, 1);
        const coreR = base * (el < 0.5 ? lerp(1, 3.5, coreP) : lerp(3.5, 0, coreP));
        const coreA = el < 0.9 ? 1 : 1 - coreP;
        if (coreR > 0.8 && coreA > 0.01) {
          wash(ctx, n.color, it.x, it.y, Math.max(2, coreR * 5.4), coreA * 0.8);
          ctx.globalAlpha = coreA;
          ctx.fillStyle = mix(n.color, INK, 0.4);
          ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(1, coreR * 0.5), 0, TAU); ctx.fill();
          ctx.globalAlpha = 1;
        }
        if (el >= 0.3 && el <= 1.1) {
          const b2 = (el - 0.3) / 0.8;
          [0, 0.18].forEach(function (delay) {
            const bk = easeOutK(clamp((b2 - delay) / (1 - delay), 0, 1));
            if (bk <= 0 || bk >= 1) return;
            ctx.strokeStyle = hexA(mix(n.color, INK, 0.3), (1 - bk) * 0.5);
            ctx.lineWidth = 1.3;
            ctx.beginPath(); ctx.arc(it.x, it.y, base * lerp(1, 4, bk), 0, TAU); ctx.stroke();
          });
          ctx.lineCap = 'round';
          for (let i = 0; i < 10; i++) {
            const lag = hashRand(seed + i * 13.7) * 0.35;
            const sk = (b2 - lag) / (1 - lag);
            if (sk <= 0 || sk >= 1) continue;
            const ang = hashRand(seed + i * 7.3) * TAU;
            const len = 10 + hashRand(seed + i * 3.1) * 12;
            const d0 = base * lerp(1, 4, easeOutK(sk));
            ctx.strokeStyle = hexA(mix(n.color, INK, 0.35), (1 - sk) * 0.7);
            ctx.lineWidth = 1.2;
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
            ctx.globalAlpha = (1 - gk) * 0.5;
            ctx.fillStyle = i % 2 === 0 ? '#b8563e' : '#3f6f74';
            ctx.beginPath();
            ctx.arc(lerp(it.x + Math.cos(ang) * r0, ex, easeOutK(gk)),
              lerp(it.y + Math.sin(ang) * r0, ey, easeOutK(gk)),
              0.9 + hashRand(seed + i * 11.3) * 1.0, 0, TAU);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        }
        return;
      }

      if (it.kind === 'meteor') {
        trailStroke(ctx, it.trail, '#b8563e', 0.5, 0.5, 1.5, it.alpha);
        ctx.globalAlpha = it.alpha;
        ctx.fillStyle = INK;
        ctx.beginPath(); ctx.arc(it.x, it.y, 1.5, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  };
}
