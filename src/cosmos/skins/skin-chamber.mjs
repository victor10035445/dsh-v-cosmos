/**
 * 皮肤 · 云室 Chamber（add-cosmos-skin-themes 1.4）。
 *
 * 血统：自 demo/skins/assets/skin-chamber.js 移植（圆括号 IIFE + window 全局 + 伞式
 * `COSMOS_SKINLIB.define` → ES 模块 + `createSkinChamber()` 工厂）。词汇按 design D5
 * 重映射：palette 键 `draft/in-progress/complete` → `proto/created/reviewed/executed`；
 * 条目字段 `it.data.status` → `it.data.lifecycle`；连线段 `[a, b]` 数组形 →
 * `{a, b, alpha}` 对象形；`sess.done` → `sess['done-unread']`；器皿锚点取 `ws.proj`；
 * 不保留 `captionHTML`（SRC 侧无消费点）。
 *
 * 隐喻：星座 = 云室腔（酒精蒸气过饱和区）· 恒星 = 衰变顶点（放射状电离径迹 + 沿径迹
 * 液滴链）· 行星 = 绕顶点螺旋径迹 · 彗星 = 穿越腔体的宇宙射线（直线穿越 + 轨迹外推）·
 * 星云 = 电离雾滴 · 连线 = 缠绕径迹对（双虚线 ±1.2px 织带感）· 卫星 = 次级径迹点 ·
 * 等批准 = 同步辐射闪环 · 已审核 = 观测金章环 · 已执行 = 衰变顶点金点爆闪。
 *
 * 视觉：铅灰蓝主调（#8fa8c0）+ 金域（#ffcf6a）；底噪 = 蒸气雾层 + 测量标线 + 底左
 * 标尺 + 电离尘点（探测器摄影质感，暗底 #0a0d12）。
 *
 * 转场本地化（口径一律走 skin-kit，本文件只决定「用什么语言画」）：
 *  - 星胚点燃：A 段虚线轮廓收缩 → B 段白光微爆闪 + 电离雾滴四散 → C 段色相渐变到 created；
 *  - 已审核：金章环随 stampP 从半径 ×2.2 收束落印（α 同步淡入）；
 *  - 已执行金涌：衰变顶点以金点炸开 + 金环外扩渐熄，强度包络 sin(k·π)（1.2s）；
 *  - 出生/查看渐熄/色相滑移/注意力信号坡道/卫星出生/连线段/星云 born：全按消费面乘子。
 *
 * 结构：`createVesselGuard()` 守卫「每帧每星座一次的器皿绘制」（design D9），守卫状态
 * 存皮肤实例闭包，`setSkin` 换实例即自然重置，MUST NOT 挂引擎。
 */

import {
  TAU, clamp, lerp, easeOutK, mix, hexA, hashSeed, hashRand,
  makeGlowCache, trailStroke, sessColor, mixFade, viewKOf, birthAlphaOf, segAlphaOf,
  dustBornK, satBornKOf, createVesselGuard, vesselAnchor,
  makeDustSprite, dustBatchDraw, patDotDraw
} from '../skin-kit.mjs';

/* created 取 demo `draft` 的冷蓝支（#6a8ab8）：另一支 in-progress #e8f4ff 近白，
   reviewed = mix(created, '#fff', 0.34) 的「升亮」将失去可辨差异。 */
const CREATED = '#6a8ab8';
const GOLD = '#ffcf6a';     // demo complete（金域：已执行 / 金章环 / 金涌）
const TRACK = '#c8d8e8';    // 电离径迹线（demo TRACK）
const LEAD = '#8fa8c0';     // 铅灰蓝主调（demo accent）

const PROP = Object.freeze({
  proto: '#8c9aa8',                        // 待创建星胚：低饱和灰蓝（未凝结蒸气）
  created: CREATED,                        // 冷亮（demo draft 冷蓝支）
  reviewed: mix(CREATED, '#ffffff', 0.34), // 冷亮升亮（派生）
  executed: GOLD                           // 金域（demo complete）
});

const SESS = Object.freeze({
  idle: '#6e7680',        // 中性灰（去掉 demo #5a6a80 的蓝偏，仍压得住暗底）
  busy: '#7ac8e8',        // 冷亮蓝青
  waiting: '#ffb056',     // 恒暖（同步辐射闪环）
  'done-unread': '#7ae89a', // 恒冷绿（done halo）
  free: '#a8c8e0'         // 彗星待机身份色（宇宙射线冷白蓝）
});

const DUST = Object.freeze(['#2a3a52', '#4a6a8a']); // 电离雾滴双色（demo dust）

/** 创建云室皮肤实例（每次调用独立 glow 缓存 + 独立器皿守卫）。 */
export function createSkinChamber() {
  const glow = makeGlowCache();
  const dustBrush = makeDustSprite(); // 尘埃 sprite 缓存（每皮肤实例独立，防跨皮肤串色）
  const palette = { prop: PROP, sess: SESS };
  const vesselOnce = createVesselGuard();

  function drawGlow(ctx, hex, x, y, R, a) { glow.draw(ctx, hex, x, y, R, a); }

  /** 电离尘点色（背景星 = 腔内散射的放射性尘粒；m 为亮度档）。 */
  function bgStarColor(m) { return m > 0.85 ? '#e8f4ff' : (m < 0.5 ? '#7f93a8' : '#b8d0e0'); }

  /* ── 器皿：云室腔（雾层 + 腔壁双环 + 辐射状标尺刻度 + 中心十字；每帧每星座一次） ── */
  function chamberVessel(ctx, ws) {
    const p = vesselAnchor(ws);
    if (!p) return;
    const R = 88 * p.s;
    if (R < 12) return;
    const x = p.x, y = p.y;
    /* 腔内蒸气雾（source-over 柔雾，非加色——探测器腔内的散射光） */
    glow.wash(ctx, '#7c96ae', x, y, R * 1.05, 0.12);
    /* 腔壁：内壁弱环 + 主环（双环腔壁语言；每帧每星座一次的预算内） */
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(168,196,214,0.09)';
    ctx.beginPath(); ctx.arc(x, y, R * 0.93, 0, TAU); ctx.stroke();
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = 'rgba(168,196,214,0.30)';
    ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.stroke();
    /* 辐射状标尺刻度 + 中心十字（同一条路径一次 stroke：
       8 向刻度（0°/90°/180°/270° 长刻度，斜向短刻度）+ 顶点准星） */
    ctx.strokeStyle = 'rgba(196,220,236,0.24)';
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const ang = i / 8 * TAU - Math.PI / 2;
      const cs = Math.cos(ang), sn = Math.sin(ang);
      const len = i % 2 === 0 ? 7 : 3.5;
      ctx.moveTo(x + cs * R, y + sn * R);
      ctx.lineTo(x + cs * (R + len), y + sn * (R + len));
    }
    ctx.moveTo(x - 5, y); ctx.lineTo(x + 5, y);
    ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5);
    ctx.stroke();
  }

  /* ── 已审核金章环（观测落印：stampP≥0 时半径 ×2.2→1 收束 + α 淡入） ── */
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

  /* ── 悬停/选中：准星虚线环（选中再补一道外环） ── */
  function hoverMark(ctx, it) {
    if (!it.hovered && !it.selected) return;
    ctx.strokeStyle = it.selected ? '#e8f4ff' : hexA('#e8f4ff', 0.5);
    ctx.lineWidth = 1.1;
    ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 7, 0, TAU); ctx.stroke();
    if (it.selected) {
      ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 12, 0, TAU); ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  /* ── 完成未读冷绿 halo（慢脉动；查看渐熄沿 keep=1-viewK 消退） ── */
  function doneHalo(ctx, x, y, r, t, al, keep, phase) {
    if (keep <= 0.02) return;
    const ph = phase || 0;
    const hr = r + 9 + 3 * Math.sin(t * 1.8 + ph);
    ctx.strokeStyle = hexA(SESS['done-unread'], (0.22 + 0.14 * Math.sin(t * 1.8 + ph)) * al * keep);
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(x, y, hr, 0, TAU); ctx.stroke();
    drawGlow(ctx, SESS['done-unread'], x, y, r * 3.2, 0.18 * al * keep);
  }

  /* ── 委托忙碌微光环（准星环外蓝青慢呼吸，周期 ~2s） ── */
  function busyRing(ctx, x, y, r, t, al) {
    const a = 0.25 * (0.5 + 0.5 * Math.sin(t * Math.PI));
    ctx.strokeStyle = hexA(SESS.busy, a * al);
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(x, y, r + 11, 0, TAU); ctx.stroke();
  }

  /* ── 等批准：同步辐射闪环（双环周期外扩；强度乘色相滑移 waitFade） ── */
  function waitingRing(ctx, x, y, r, c, t, al, fade) {
    const span = 18;
    const phase = (t * 30) % span;
    const p1 = r + 3 + phase;
    const p2 = r + 3 + (phase + span * 0.5) % span;
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = hexA(c, clamp(0.75 * (1 - (p1 - r - 3) / span), 0, 1) * al * fade);
    ctx.beginPath(); ctx.arc(x, y, p1, 0, TAU); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = hexA(c, clamp(0.4 * (1 - (p2 - r - 3) / span), 0, 1) * al * fade);
    ctx.beginPath(); ctx.arc(x, y, p2, 0, TAU); ctx.stroke();
  }

  return {
    skin: 'chamber',
    useBand: false,
    palette,
    gold: GOLD,
    bgStarColor,
    dustColors: DUST,

    background(ctx, view) {
      ctx.fillStyle = '#0a0d12';
      ctx.fillRect(0, 0, view.W, view.H);
      /* 蒸气雾层（3 层缓慢漂移；wash = source-over 柔雾，避免大量逐帧径向渐变） */
      for (let f = 0; f < 3; f++) {
        const fx = view.W * (0.24 + 0.27 * f) + Math.sin(view.t * 0.05 + f * 2.1) * 46;
        const fy = view.H * (0.32 + 0.11 * (f % 2)) + Math.cos(view.t * 0.04 + f * 1.3) * 34;
        const fr = Math.max(view.W, view.H) * 0.28;
        glow.wash(ctx, f === 1 ? '#6f8aa4' : LEAD, fx, fy, fr, 0.12);
      }
      /* 测量标线（探测器腔外的定位网格） */
      ctx.strokeStyle = 'rgba(160,190,210,0.035)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let gx = 0.5; gx < view.W; gx += 64) { ctx.moveTo(gx, 0); ctx.lineTo(gx, view.H); }
      for (let gy = 0.5; gy < view.H; gy += 64) { ctx.moveTo(0, gy); ctx.lineTo(view.W, gy); }
      ctx.stroke();
      /* 底左标尺：基线 + 5 根刻度（同一路径一次 stroke） */
      ctx.strokeStyle = 'rgba(180,205,225,0.22)';
      const rx = 18, ry = view.H - 24;
      ctx.beginPath();
      ctx.moveTo(rx, ry); ctx.lineTo(rx + 80, ry);
      for (let k = 0; k <= 4; k++) {
        ctx.moveTo(rx + k * 20, ry);
        ctx.lineTo(rx + k * 20, ry - (k % 2 === 0 ? 6 : 3));
      }
      ctx.stroke();
      /* 电离尘点 */
      const bs = view.bgStars;
      for (let i = 0; i < bs.length; i++) {
        const s = bs[i];
        if (s.a < 0.04) continue;
        ctx.globalAlpha = s.a * 0.5;
        ctx.fillStyle = bgStarColor(s.m);
        ctx.fillRect(s.x - 0.5, s.y - 0.5, 1.2, 1.2);
      }
      ctx.globalAlpha = 1;
    },

    drawBody(ctx, it, view) {
      const t = view.t;
      if (it.ws && vesselOnce(it.ws, t)) chamberVessel(ctx, it.ws);

      if (it.kind === 'dust') {
        /* 电离雾滴（星云）：共享低开销原语（缓存 dot sprite + 分色分组 + born 0.8s
           坡道）。空星云由原语首行早退（零 ctx 调用——器皿帧内去重判定按调用原语数比）。 */
        dustBatchDraw(dustBrush, ctx, it.pts, DUST, t, { alphaK: 0.42, radiusK: 0.4, minR: 0.6 });
        return;
      }

      if (it.kind === 'constline') {
        /* 缠绕径迹对：双虚线 ±1.2px 沿法线错位（织带感），段 α 坡道参与 */
        it.segs.forEach(function (seg) {
          const a = seg.a, b = seg.b;
          const sa = it.alpha * segAlphaOf(seg);
          if (sa <= 0.01) return;
          const dx = b.x - a.x, dy = b.y - a.y;
          const len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len * 1.2, ny = dx / len * 1.2;
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 3]);
          for (let side = 0; side < 2; side++) {
            const ox = side === 0 ? nx : -nx, oy = side === 0 ? ny : -ny;
            ctx.strokeStyle = hexA(TRACK, (side === 0 ? 0.30 : 0.22) * sa);
            ctx.lineDashOffset = side * 3.5;
            ctx.beginPath();
            ctx.moveTo(a.x + ox, a.y + oy);
            ctx.lineTo(b.x + ox, b.y + oy);
            ctx.stroke();
          }
          ctx.setLineDash([]);
          ctx.lineDashOffset = 0;
        });
        return;
      }

      if (it.kind === 'patdot') {
        /* 空槽装饰点（add-cosmos-template-figure-display 3.2）：径迹顶点微滴——
           取径迹同色、基线 0.22（低于本皮肤图样线段），点弱化因子由引擎下发；
           纯装饰（不进 picks / 无 hover / 无名牌）。 */
        patDotDraw(ctx, it, TRACK, 0.22);
        return;
      }

      if (it.kind === 'orbit') {
        /* 离子化轨道径迹：弱实线 + 每 8 点一粒液滴（液滴并入单路径批量填充，
           原语量与同分支虚线环同阶，不做逐点独立 fill） */
        const pts = it.orbitPts;
        ctx.strokeStyle = hexA(TRACK, 0.09 * it.alpha);
        ctx.lineWidth = 1;
        ctx.beginPath();
        pts.forEach(function (p, i) { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
        ctx.stroke();
        ctx.fillStyle = hexA(TRACK, 0.16 * it.alpha);
        ctx.beginPath();
        for (let i = 0; i < pts.length; i += 8) {
          ctx.moveTo(pts[i].x + 0.8, pts[i].y);
          ctx.arc(pts[i].x, pts[i].y, 0.8, 0, TAU);
        }
        ctx.fill();
        return;
      }

      if (it.kind === 'star') {
        /* 衰变顶点：星胚 = 未凝结的过饱和蒸气微滴（虚线轮廓 + 呼吸 + 淡核）；
           created/reviewed/executed = 顶点核 + 放射状电离径迹 + 沿径迹液滴链。 */
        const st = it.data;
        const lifecycle = st.lifecycle || 'created';
        const act = st.act || 0;
        const fx = it.fx;
        const bAl = birthAlphaOf(it);
        const al = it.alpha * bAl;
        const seed = hashSeed(st.id);

        if (lifecycle === 'proto') {
          const phase = st.starIndex || 0;
          const breath = (Math.sin(t * 1.6 + phase) + 1) / 2;
          const igniteP = fx && fx.type === 'ignite' ? clamp((t - fx.t0) / fx.dur, 0, 1) : -1;
          /* A 段收缩：虚线轮廓 r+5 → 0.6r（easeOutCubic）；C 段色相渐变到 created */
          const contract = igniteP >= 0 ? easeOutK(clamp(igniteP / 0.3, 0, 1)) : 0;
          const rc = igniteP > 0.55 ? mix(PROP.proto, PROP.created, (igniteP - 0.55) / 0.45) : PROP.proto;
          const ro = igniteP >= 0 ? lerp(it.r + 5, it.r * 0.6, contract) : it.r + 5 + breath * 2;
          const oa = igniteP >= 0 ? 0.55 + contract * 0.35 : 0.42 + breath * 0.3;
          drawGlow(ctx, rc, it.x, it.y, it.r * 3.0, al * 0.18);
          ctx.globalAlpha = al * 0.55;
          ctx.fillStyle = rc;
          ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(1.2, it.r * 0.4), 0, TAU); ctx.fill();
          ctx.globalAlpha = 1;
          ctx.save();
          ctx.strokeStyle = hexA(rc, oa * al);
          ctx.lineWidth = 1.2;
          ctx.setLineDash([4, 5]);
          ctx.lineDashOffset = -t * 8;
          ctx.beginPath(); ctx.arc(it.x, it.y, ro, 0, TAU); ctx.stroke();
          ctx.restore();
          if (igniteP >= 0.30 && igniteP < 0.75) {
            /* B 段：白光微爆闪 + 电离雾滴四散（蒸气瞬间电离） */
            const fk = (igniteP - 0.30) / 0.45;
            const env = Math.sin(clamp(fk, 0, 1) * Math.PI);
            drawGlow(ctx, '#ffffff', it.x, it.y, it.r * 6.5, env * 0.9 * al);
            const sparkC = mix(PROP.created, '#ffffff', 0.35);
            for (let i = 0; i < 4; i++) {
              const ang = hashRand(seed + i * 7.3) * TAU;
              const d = it.r * (1.2 + easeOutK(fk) * 2.6);
              ctx.fillStyle = hexA(sparkC, (1 - fk) * 0.7 * al);
              ctx.beginPath();
              ctx.arc(it.x + Math.cos(ang) * d, it.y + Math.sin(ang) * d, 1.1, 0, TAU);
              ctx.fill();
            }
          }
        } else {
          const c = PROP[lifecycle] || '#ffffff';
          drawGlow(ctx, c, it.x, it.y, Math.min(it.r * 5.2, 64), al * (0.5 + act * 0.2));
          /* 顶点核 + 活跃白热核（act 只提亮/延长径迹，不改生命周期色） */
          ctx.globalAlpha = al;
          ctx.fillStyle = c;
          ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(1.6, it.r * 0.45), 0, TAU); ctx.fill();
          if (act > 0) {
            ctx.fillStyle = 'rgba(255,255,255,0.95)';
            ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(0.8, it.r * 0.2), 0, TAU); ctx.fill();
          }
          ctx.globalAlpha = 1;
          /* 放射状电离径迹：3 根确定性方向径迹（顶点 0.5r 起）+ 沿径迹 2 粒电离液滴。
             两条路径分别批量落笔（径迹一次 stroke、液滴一次 fill），原语量与
             skin-reagent 的富分支（行星 ≈40 次调用）同量级。 */
          const spokes = [];
          for (let k = 0; k < 3; k++) {
            const ang = hashRand(seed + k * 7.3) * TAU;
            spokes.push({
              x0: it.x + Math.cos(ang) * it.r * 0.5,
              y0: it.y + Math.sin(ang) * it.r * 0.5,
              cs: Math.cos(ang),
              sn: Math.sin(ang),
              len: it.r * (1.7 + hashRand(seed + k * 3.1) * (act > 0 ? 2.4 : 1.3)) - it.r * 0.5
            });
          }
          ctx.strokeStyle = hexA(c, 0.26 * al);
          ctx.lineWidth = 0.9;
          ctx.beginPath();
          for (let k = 0; k < 3; k++) {
            const sp = spokes[k];
            ctx.moveTo(sp.x0, sp.y0);
            ctx.lineTo(sp.x0 + sp.cs * sp.len, sp.y0 + sp.sn * sp.len);
          }
          ctx.stroke();
          ctx.fillStyle = hexA(c, clamp(0.3 * al, 0, 1));
          ctx.beginPath();
          for (let k = 0; k < 3; k++) {
            const sp = spokes[k];
            for (let j = 1; j <= 2; j++) {
              const kk = j / 2;
              const dx = sp.x0 + sp.cs * sp.len * kk;
              const dy = sp.y0 + sp.sn * sp.len * kk;
              ctx.moveTo(dx + 0.9, dy);
              ctx.arc(dx, dy, 0.9, 0, TAU);
            }
          }
          ctx.fill();
          if (lifecycle === 'reviewed') {
            /* 已审核：观测金章环 r+6 常驻；stamp fx 播放落印（×2.2→1 + α 淡入） */
            const stampP = fx && fx.type === 'stamp' ? clamp((t - fx.t0) / fx.dur, 0, 1) : -1;
            sealRing(ctx, it.x, it.y, it.r + 6, 0.85 * al, 1.4, stampP);
          }
        }
        /* 出生微爆闪：与点燃 B 段同语言、幅度减半（0.45）；风暴降级 → 纯 α 坡道无爆闪 */
        if (it.birth && !it.birth.degraded && it.birth.k >= 0.15 && it.birth.k < 0.65) {
          const fk = (it.birth.k - 0.15) / 0.5;
          drawGlow(ctx, '#ffffff', it.x, it.y, it.r * 6.5,
            Math.sin(clamp(fk, 0, 1) * Math.PI) * 0.45 * al);
        }
        /* 已执行金涌（云室母语）：衰变顶点金点炸开 + 金环外扩渐熄，强度包络 sin(k·π) */
        if (fx && fx.type === 'surge') {
          const el = t - fx.t0;
          if (el > 0) {
            const kk = clamp(el / fx.dur, 0, 1);
            const env = Math.sin(kk * Math.PI);
            drawGlow(ctx, GOLD, it.x, it.y,
              Math.min(it.r * 5.4 * lerp(2.2, 1, easeOutK(kk)), 150), env * 0.85 * al);
            const hot = mix(GOLD, '#ffffff', 0.45);
            for (let i = 0; i < 4; i++) {
              const ang = hashRand(seed + i * 7.3) * TAU;
              const d = it.r * lerp(0.6, 3.2, easeOutK(kk));
              ctx.fillStyle = hexA(hot, env * 0.75 * al);
              ctx.beginPath();
              ctx.arc(it.x + Math.cos(ang) * d, it.y + Math.sin(ang) * d, 1.2, 0, TAU);
              ctx.fill();
            }
            const ringK = easeOutK(clamp(el / (fx.dur * 0.6), 0, 1));
            ctx.strokeStyle = hexA(GOLD, (1 - ringK) * 0.82 * al);
            ctx.lineWidth = 1.6;
            ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 6 + ringK * 28, 0, TAU); ctx.stroke();
          }
        }
        ctx.globalAlpha = 1;
        hoverMark(ctx, it);
        return;
      }

      if (it.kind === 'planet') {
        /* 绕顶点螺旋径迹粒子：核 + 螺旋尾迹 + 径迹环；等批准 = 同步辐射闪环 */
        const p = it.data;
        const state = p.state;
        let c2 = sessColor(palette, 'planet', state, p, t); // 色相滑移统一取色（D3）
        /* 查看渐熄（fx.view）：起点 done-unread 冷绿，随 viewK→1 褪回目标态色
           （等价于「c2 向 done-unread 混 1-viewK」，与 done halo 的 1-viewK 消退同源） */
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
        ctx.strokeStyle = hexA(c2, 0.3 * al);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 3.5, 0, TAU); ctx.stroke();
        ctx.strokeStyle = 'rgba(240,250,255,0.5)';
        ctx.lineWidth = 0.9;
        ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(1.4, it.r * 0.42), -2.4, -1.2); ctx.stroke();
        ctx.globalAlpha = 1;
        if (p.delegatedBusy) busyRing(ctx, it.x, it.y, it.r, t, al);
        if (state === 'done-unread' || viewK > 0) {
          doneHalo(ctx, it.x, it.y, it.r, t, al, (1 - viewK) * doneFade, p.phase);
        }
        if (state === 'waiting') waitingRing(ctx, it.x, it.y, it.r, c2, t, al, waitFade);
        hoverMark(ctx, it);
        return;
      }

      if (it.kind === 'suborbit') {
        /* 次级径迹环（卫星子轨道）：虚线 [3,5]，色随父天体状态 */
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
        /* 卫星 = 顶点旁的次级径迹点：α×bornK、半径 0→满（easeOutCubic） */
        const s = it.data;
        const bornK = satBornKOf(it);
        const rF = easeOutK(bornK);
        const c4 = mix(sessColor(palette, 'sat', s.state, s, t), '#707c9c', 0.3); // 降饱和 30%
        const al = it.alpha * bornK;
        trailStroke(ctx, it.trail, c4, 0.22, 0.5, 1.0, al);
        drawGlow(ctx, c4, it.x, it.y, it.r * 2.6, al * 0.45);
        ctx.globalAlpha = al;
        ctx.fillStyle = c4;
        ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(1.3, it.r * rF), 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        if (s.state === 'waiting') {
          /* 待决策卫星：迷你同步辐射闪环（强度乘出生坡道 × 色相滑移坡道） */
          const fade = bornK * mixFade(s, t, 'waiting');
          const pp = ((t * 22) % 10) / 10;
          const rr = it.r + 2 + pp * 7;
          ctx.strokeStyle = hexA(SESS.waiting, (1 - pp) * 0.5 * it.alpha * fade);
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(it.x, it.y, rr, 0, TAU); ctx.stroke();
        }
        return;
      }

      if (it.kind === 'comet') {
        /* 宇宙射线：直线穿越 + 轨迹外推 + 白芯长尾；待机保持 free 身份色 */
        const c = it.data;
        const state = c.state;
        let c3 = sessColor(palette, 'comet', state, c, t);
        const viewK = viewKOf(it, t);
        if (viewK > 0) c3 = mix(SESS['done-unread'], c3, viewK);
        const birth = it.birth || null;
        const bCore = birth ? birth.alpha : 1;      // 核后亮（延后 0.3s 坡道）
        const bTrail = birth ? birth.trailAlpha : 1; // 尾迹先现
        const waitFade = mixFade(c, t, 'waiting');
        const doneFade = mixFade(c, t, 'done-unread');
        trailStroke(ctx, it.trail, c3, 0.5, 0.5, 1.5, it.alpha * bTrail);
        /* 轨迹外推：径迹前缘再延 36px（穿越腔体的直线轨迹感） */
        const tr = it.trail;
        if (tr && tr.length > 1 && bTrail > 0.02) {
          const ax = tr[tr.length - 1].x - tr[tr.length - 2].x;
          const ay = tr[tr.length - 1].y - tr[tr.length - 2].y;
          const l = Math.hypot(ax, ay) || 1;
          ctx.strokeStyle = hexA(c3, 0.18 * it.alpha * bTrail);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(it.x, it.y);
          ctx.lineTo(it.x + ax / l * 36, it.y + ay / l * 36);
          ctx.stroke();
        }
        drawGlow(ctx, c3, it.x, it.y, Math.min(it.r * 3.8, 26), it.alpha * bCore * 0.8);
        ctx.globalAlpha = it.alpha * bCore;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(1.2, it.r * 0.4), 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        if (c.delegatedBusy) busyRing(ctx, it.x, it.y, it.r, t, it.alpha * bCore);
        if (state === 'done-unread' || viewK > 0) {
          doneHalo(ctx, it.x, it.y, it.r, t, it.alpha * bCore, (1 - viewK) * doneFade, c.phase);
        }
        if (state === 'waiting') waitingRing(ctx, it.x, it.y, it.r, c3, t, it.alpha * bCore, waitFade);
        return;
      }

      if (it.kind === 'wsghost') {
        /* 星座消散：电离雾滴外扩漂散 + 衰变顶点余辉渐熄（born 坡道同 dust） */
        it.dust.forEach(function (q) {
          ctx.globalAlpha = clamp(q.a * dustBornK(q, t) * 0.42, 0, 1);
          ctx.fillStyle = DUST[q.hue < 0.5 ? 0 : 1];
          ctx.beginPath();
          ctx.arc(q.x, q.y, Math.max(0.6, q.s * 0.4), 0, TAU);
          ctx.fill();
        });
        ctx.globalAlpha = 1;
        it.stars.forEach(function (st) {
          drawGlow(ctx, st.color, st.x, st.y, Math.min(st.r * 3, 40), st.a * 0.55);
          ctx.globalAlpha = st.a * 0.7;
          ctx.fillStyle = st.color;
          ctx.beginPath(); ctx.arc(st.x, st.y, Math.max(1, st.r * 0.4), 0, TAU); ctx.fill();
        });
        ctx.globalAlpha = 1;
        return;
      }

      if (it.kind === 'nova') {
        /* 超新星（云室母语）：顶点爆燃 → 冲击标环 + 放射径迹火花 → 电离雾滴归尘。
           degraded = 风暴降级渐熄最小形态；intensity<0.5 = 星胚低强度消散变体。 */
        const n = it.data;
        const base = it.r;
        const seed = hashSeed(n.id);
        if (n.degraded) {
          /* 风暴降级最小形态：只留辉光衰减 + 少量雾滴外散（跳过爆闪/冲击环） */
          const pk = it.k;
          drawGlow(ctx, n.color, it.x, it.y, base * 3 * (1 + pk * 0.6), (1 - pk) * 0.3);
          ctx.globalAlpha = (1 - pk) * 0.4;
          ctx.fillStyle = n.color;
          ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(0.8, base * 0.4 * (1 - pk)), 0, TAU); ctx.fill();
          for (let i = 0; i < 6; i++) {
            const ang = hashRand(seed + i * 7.3) * TAU;
            const d = base * (0.5 + hashRand(seed + i * 3.1) * 1.2) * easeOutK(pk);
            ctx.globalAlpha = (1 - pk) * 0.32;
            ctx.fillStyle = DUST[i % 2];
            ctx.beginPath();
            ctx.arc(it.x + Math.cos(ang) * d, it.y + Math.sin(ang) * d, 0.9, 0, TAU);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
          return;
        }
        if (n.intensity < 0.5) {
          /* 星胚低强度消散：虚线轮廓外扩淡出 + 淡核收缩 + 5 粒雾滴 puff */
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
          const puffC = mix(n.color, DUST[1], 0.4);
          for (let i = 0; i < 5; i++) {
            const ang = hashRand(seed + i * 7.3) * TAU;
            const d = base * (0.6 + hashRand(seed + i * 3.1) * 1.4) * easeOutK(pk);
            ctx.fillStyle = hexA(puffC, (1 - pk) * 0.45);
            ctx.beginPath();
            ctx.arc(it.x + Math.cos(ang) * d, it.y + Math.sin(ang) * d, 1.1, 0, TAU);
            ctx.fill();
          }
          return;
        }
        const el = it.k * n.dur; // 已流逝秒
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
          ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(1, coreR * 0.5), 0, TAU); ctx.fill();
          ctx.globalAlpha = 1;
        }
        /* B 冲击标环（0.3–1.1s）：双环外扩渐熄 + 10 道放射径迹火花（错峰起爆） */
        if (el >= 0.3 && el <= 1.1) {
          const b = (el - 0.3) / 0.8;
          for (let dly = 0; dly < 2; dly++) {
            const bk = easeOutK(clamp((b - dly * 0.18) / (1 - dly * 0.18), 0, 1));
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
        /* C 坍缩归尘（0.9–dur）：13 粒电离雾滴向 drift 快照点漂移渐散 */
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
        /* 流星 = 掠过腔顶的短径迹 */
        trailStroke(ctx, it.trail, '#dff2ff', 0.55, 0.5, 1.6, it.alpha);
        drawGlow(ctx, '#ffffff', it.x, it.y, 11, it.alpha);
      }
    }
  };
}
