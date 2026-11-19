/**
 * 皮肤 · 覆铜星板 Circuit（add-cosmos-skin-themes 1.4）。
 *
 * 血统：`demo/skins/assets/skin-circuit.js`（圆括号 IIFE + `window.COSMOS_SKINLIB.define`
 * 全局注册）→ 去全局化为 `createSkinCircuit()`。隐喻「PCB 母板上的发光世界」原样保留：
 * 星座 = 板区丝印框 · 恒星 = 主控芯片（QFP 引脚 + 晶核发光；星胚 = 空贴位丝印 /
 * 上电 = 冷亮芯片 / 已审核 = 金章落印 / 已执行 = 金手指点亮）· 行星 = 信号脉冲（沿
 * 走线巡游，等批准 = ACK LED 闪烁 + 扩散环）· 彗星 = 飞线跳线（探针头）·
 * 星云 = 覆铜箔蚀刻纹理 · 连线 = 直角折线走线 + 过孔。
 *
 * 视觉：阻焊墨绿底 `#0d1410` + 焊盘格点 + 铜光斜照 + 丝印灰绿 `#d8e0d8`；铜色
 * `#c88a4a`；金域 = demo `complete` 原值 `#ffd88a`（覆铜板是阻焊绿底铜金主调）。
 *
 * 移植词汇映射（design D5）：demo `draft` 的偏冷支抬亮 → `created`（上电冷亮），
 * `in-progress`/`complete` 的暖金收敛为 `executed`（取 `complete` 色值）；`proto` 降
 * 饱和灰蓝、`reviewed` 由 created 向白升亮 0.34；会话键 `done` → `done-unread`。
 *
 * 转场本地化（与 12 套皮肤同口径，只换母语）：ignite = 丝印位收缩 → 白光爆闪 → 芯片
 * 色相渐变；stamp = 金章环落印（半径 ×2.2→1 + α 淡入）；surge = 上电金手指自内向外
 * 点亮 + 走线金脉冲 + 金环外扩渐熄（1.2s，强度包络 sin(k·π)）；waiting = ACK LED；
 * done-unread = halo 慢脉动（view 渐熄沿 1-viewK 消退）；birth = 上电微爆闪（degraded
 * 缩纯 α 坡道）；nova = 芯片过载（板框冲击波 + 45° 走线火花 + 铜渣归尘）。
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

/** demo draft `#9ab0a0` 的偏冷支抬亮、向青偏移（上电冷亮；in-progress 暖金归 executed 金域）。 */
const CREATED = '#6fe0c8';
/** demo complete 原值：铜金（阻焊墨绿底上的金域主调）。 */
const GOLD = '#ffd88a';
const COPPER = '#c88a4a';
const SILK = '#d8e0d8';

const PROP = Object.freeze({
  proto: '#8c9aa8',                        // 待创建：低饱和灰蓝（空贴位丝印）
  created: CREATED,
  reviewed: mix(CREATED, '#ffffff', 0.34), // 冷亮升亮
  executed: GOLD                           // 金域（demo complete）
});

const SESS = Object.freeze({
  idle: '#6a7a72',          // 中性灰（丝印灰）
  busy: '#4ae0ff',          // 冷亮蓝青（数据在跑）
  waiting: '#ffb056',       // 恒暖（等批准的 ACK 暖橙）
  'done-unread': '#5aff9a', // 恒冷绿（完成未读；demo `done` 改名）
  free: '#d8e8d8'           // 飞线身份色（丝印白）
});

/** 覆铜箔双色：铜色 / 阻焊墨绿（星云与消散幽灵共用）。 */
const DUST = Object.freeze(['#8a5a2a', '#4a6a52']);

/** 创建覆铜星板皮肤实例（每次调用独立 glow 缓存；器皿守卫随实例重置）。 */
export function createSkinCircuit() {
  const glow = makeGlowCache();
  const dustBrush = makeDustSprite(); // 尘埃 sprite 缓存（每皮肤实例独立，防跨皮肤串色）
  const palette = { prop: PROP, sess: SESS };
  const vesselOnce = createVesselGuard();

  function drawGlow(ctx, hex, x, y, R, a) { glow.draw(ctx, hex, x, y, R, a); }

  /* 焊盘反光：亮焊盘 = 铜金，中/暗 = 丝印灰绿（demo 两档 + 暗档）。 */
  function starColorOf(m) {
    return m > 0.88 ? GOLD : (m < 0.5 ? '#93a89c' : '#c8d4c8');
  }

  /* 阻焊焊盘格点：32px 一格 pattern 平铺（demo 同密度；每实例建一次；桩/无 pattern 环境退回稀疏单路径） */
  let maskPattern = null;
  let maskTried = false;
  function padPattern(ctx) {
    if (maskTried) return maskPattern;
    maskTried = true;
    if (typeof document === 'undefined' || !document.createElement) return null;
    const tile = document.createElement('canvas');
    tile.width = tile.height = 32;
    const g = tile.getContext('2d');
    g.fillStyle = 'rgba(216,224,216,0.1)';
    g.fillRect(15, 15, 1.2, 1.2);
    maskPattern = (typeof ctx.createPattern === 'function' ? ctx.createPattern(tile, 'repeat') : null) || null;
    return maskPattern;
  }

  /* ── 器皿：覆铜板（丝印板框四角倒角 + 四边引脚阵列 + QFP 足印 + 板号丝印位；
     每帧每星座一次，design D9） ── */
  function drawVessel(ctx, ws) {
    const p = vesselAnchor(ws);
    if (!p) return;
    const rx = 118 * p.s, ry = 68 * p.s;
    if (rx < 18) return;
    const x = p.x, y = p.y;
    const ch = Math.min(10 * p.s, rx * 0.18); // 四角倒角
    /* 丝印板框（单路径：四边 + 四倒角） */
    ctx.strokeStyle = hexA(SILK, 0.2);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - rx + ch, y - ry);
    ctx.lineTo(x + rx - ch, y - ry);
    ctx.lineTo(x + rx, y - ry + ch);
    ctx.lineTo(x + rx, y + ry - ch);
    ctx.lineTo(x + rx - ch, y + ry);
    ctx.lineTo(x - rx + ch, y + ry);
    ctx.lineTo(x - rx, y + ry - ch);
    ctx.lineTo(x - rx, y - ry + ch);
    ctx.closePath();
    ctx.stroke();
    /* 四边引脚阵列（每边 6 根，单路径） */
    const pinN = 6, pl = Math.min(4.5 * p.s, 6);
    ctx.strokeStyle = hexA(SILK, 0.3);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < pinN; i++) {
      const u = (i + 0.5) / pinN;
      const px = x - rx + u * rx * 2, py = y - ry + u * ry * 2;
      ctx.moveTo(px, y - ry); ctx.lineTo(px, y - ry - pl);
      ctx.moveTo(px, y + ry); ctx.lineTo(px, y + ry + pl);
      ctx.moveTo(x - rx, py); ctx.lineTo(x - rx - pl, py);
      ctx.moveTo(x + rx, py); ctx.lineTo(x + rx + pl, py);
    }
    ctx.stroke();
    /* QFP 足印角标（方框 + 四边各 3 引脚；板区左上角，单路径） */
    const q = Math.min(7 * p.s, 11);
    if (q >= 3.2) {
      const qx = x - rx * 0.62, qy = y - ry * 0.42;
      ctx.strokeStyle = hexA(SILK, 0.26);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.rect(qx - q, qy - q, q * 2, q * 2);
      for (let i = 0; i < 3; i++) {
        const o = -q * 0.52 + i * q * 0.52;
        ctx.moveTo(qx + o, qy - q); ctx.lineTo(qx + o, qy - q * 1.34);
        ctx.moveTo(qx + o, qy + q); ctx.lineTo(qx + o, qy + q * 1.34);
        ctx.moveTo(qx - q, qy + o); ctx.lineTo(qx - q * 1.34, qy + o);
        ctx.moveTo(qx + q, qy + o); ctx.lineTo(qx + q * 1.34, qy + o);
      }
      ctx.stroke();
    }
    /* 板号丝印文字位置标记（右下角：标尺线 + 三笔示意字，不依赖字体） */
    const lw = Math.min(26 * p.s, 40);
    if (lw >= 8) {
      const lx = x + rx * 0.44, ly = y + ry * 0.62;
      ctx.strokeStyle = hexA(SILK, 0.34);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(lx, ly - lw * 0.22); ctx.lineTo(lx + lw, ly - lw * 0.22);
      for (let i = 0; i < 3; i++) {
        const cx = lx + 1 + i * lw * 0.18;
        ctx.moveTo(cx, ly - lw * 0.12); ctx.lineTo(cx, ly);
      }
      ctx.stroke();
    }
  }

  /* ── 主控芯片（恒星本体）：QFP 封装 + 四边引脚 + 晶核 + 上电信号脉冲 ── */
  function chipBody(ctx, x, y, half, c, act, al, t, seed, goldSilk) {
    drawGlow(ctx, c, x, y, half * 2.6, al * (0.32 + act * 0.15));
    ctx.globalAlpha = al;
    /* 封装体（阻焊墨绿）+ 丝印外框（已执行 = 金框） */
    ctx.fillStyle = '#101a14';
    ctx.fillRect(x - half, y - half, half * 2, half * 2);
    ctx.strokeStyle = hexA(goldSilk ? GOLD : COPPER, 0.72);
    ctx.lineWidth = 1;
    ctx.strokeRect(x - half, y - half, half * 2, half * 2);
    /* 四边引脚：每边 3 根（单路径一次 stroke，原语量级对齐参照实现） */
    const pl = half * 0.3;
    ctx.strokeStyle = hexA(COPPER, 0.6);
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const o = -half * 0.5 + i * half * 0.5;
      ctx.moveTo(x + o, y - half); ctx.lineTo(x + o, y - half - pl);
      ctx.moveTo(x + o, y + half); ctx.lineTo(x + o, y + half + pl);
      ctx.moveTo(x - half, y + o); ctx.lineTo(x - half - pl, y + o);
      ctx.moveTo(x + half, y + o); ctx.lineTo(x + half + pl, y + o);
    }
    ctx.stroke();
    /* 晶核（发光硅片） */
    const die = half * 0.55;
    ctx.fillStyle = hexA(c, 0.28);
    ctx.fillRect(x - die, y - die, die * 2, die * 2);
    ctx.strokeStyle = hexA(c, 0.8);
    ctx.lineWidth = 0.9;
    ctx.strokeRect(x - die, y - die, die * 2, die * 2);
    /* 上电信号脉冲：沿四边引脚巡游（act 调制亮度，created 后常驻的芯片母语） */
    const per = (t * 0.5 + ((seed % 97) / 97)) % 1;
    const side = Math.floor(per * 4);
    const pi = Math.min(2, Math.floor((per * 4 - side) * 3));
    const o2 = -half * 0.5 + pi * half * 0.5;
    let tx, ty;
    if (side === 0) { tx = x + o2; ty = y - half - pl; }
    else if (side === 1) { tx = x + half + pl; ty = y + o2; }
    else if (side === 2) { tx = x + o2; ty = y + half + pl; }
    else { tx = x - half - pl; ty = y + o2; }
    ctx.globalAlpha = clamp(al * (0.45 + act * 0.2), 0, 1);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(tx - 1, ty - 1, 2, 2);
    ctx.globalAlpha = 1;
    /* 已执行：外扩金丝印框（demo complete 母语） */
    if (goldSilk) {
      ctx.strokeStyle = hexA(GOLD, 0.3);
      ctx.lineWidth = 0.8;
      ctx.strokeRect(x - half - 2.5, y - half - 2.5, half * 2 + 5, half * 2 + 5);
    }
  }

  /* ── 星胚（待创建）：空贴位丝印框（虚线 `[4,5]`）+ 呼吸 + 淡核 + pin1 角点；
     ignite A 段轮廓收缩——芯片尚未上电，只有丝印位 ── */
  function protoFootprint(ctx, x, y, r, c, t, al, phase, breath, igniteP) {
    const half = Math.max(4, r * 1.5);
    drawGlow(ctx, c, x, y, half * 2.4, al * (0.14 + breath * 0.1));
    ctx.globalAlpha = al * 0.5;
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(x, y, Math.max(1.2, r * 0.4), 0, TAU); ctx.fill();
    ctx.globalAlpha = al * 0.3;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(x, y, Math.max(0.7, r * 0.16), 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    const contract = igniteP >= 0 ? easeOutK(clamp(igniteP / 0.3, 0, 1)) : 0;
    const hf = igniteP >= 0 ? lerp(half + 5, half * 0.72, contract) : half + 2 + breath * 2;
    const oa = igniteP >= 0 ? 0.5 + contract * 0.4 : 0.45 + breath * 0.25;
    ctx.save();
    ctx.strokeStyle = hexA(c, oa * al);
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 5]);
    ctx.lineDashOffset = -t * 8;
    ctx.strokeRect(x - hf, y - hf, hf * 2, hf * 2);
    ctx.restore();
    /* pin1 角点（丝印位标识） */
    ctx.globalAlpha = al * 0.6;
    ctx.fillStyle = SILK;
    ctx.beginPath(); ctx.arc(x - half * 0.6, y - half * 0.6, 1, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }

  /* ── 已审核金章环（stampP≥0 播放落印：半径 ×2.2→1 + α 淡入） ── */
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

  /* ── 已执行金涌（surge，1.2s）：上电金手指自内向外逐个点亮 + 走线金光脉冲 +
     金环外扩渐熄；整体强度包络 Math.sin(k·π) ── */
  function surgeFingers(ctx, x, y, half, r, al, kk) {
    const pulse = Math.sin(clamp(kk, 0, 1) * Math.PI);
    if (pulse <= 0.005) return;
    /* 金手指触点：底沿 5 个，自内向外依次点亮（错峰滞后） */
    const n = 5;
    const w = Math.max(1.4, half * 0.2);
    const gap = w * 2.1;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(i - (n - 1) / 2);
      const lp = clamp((kk - d * 0.14) / 0.62, 0, 1);
      if (lp <= 0 || lp >= 1) continue;
      ctx.fillStyle = hexA(GOLD, Math.sin(lp * Math.PI) * al * 0.95);
      ctx.fillRect(x + (i - (n - 1) / 2) * gap - w / 2, y + half + 1.5, w, Math.max(2, half * 0.42));
    }
    /* 走线金光脉冲：沿底沿铜箔痕迹自左向右跑 */
    const ty = y + half + Math.max(4, half * 0.7);
    ctx.strokeStyle = hexA(GOLD, pulse * 0.55 * al);
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(x - half - 12, ty); ctx.lineTo(x + half + 12, ty);
    ctx.stroke();
    ctx.globalAlpha = pulse * al * 0.9;
    ctx.fillStyle = '#fff6d8';
    ctx.fillRect(x + (clamp(kk, 0, 1) * 2 - 1) * (half + 12) - 1.5, ty - 1.5, 3, 3);
    ctx.globalAlpha = 1;
    /* 金环外扩渐熄 */
    const ringK = easeOutK(clamp(kk / 0.6, 0, 1));
    ctx.strokeStyle = hexA(GOLD, (1 - ringK) * 0.8 * al);
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(x, y, r + 6 + ringK * 26, 0, TAU); ctx.stroke();
  }

  /* ── ACK LED（等批准母语）：焊盘上方暖橙 LED 闪烁 + 周期扩散环 ── */
  function ackLed(ctx, x, y, r, t, al, fade, scale) {
    if (fade <= 0.01) return;
    const k = scale || 1;
    const blink = Math.sin(t * 7) > 0 ? 0.95 : 0.35;
    const led = Math.max(1.6, r * 0.8 * k);
    const ly = y - r * 2.2 * k - led;
    ctx.globalAlpha = clamp(blink * al * fade, 0, 1);
    ctx.fillStyle = SESS.waiting;
    ctx.fillRect(x - led, ly, led * 2, led * 2);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = hexA(SESS.waiting, 0.5 * al * fade);
    ctx.lineWidth = 0.9;
    ctx.strokeRect(x - led - 1.5, ly - 1.5, led * 2 + 3, led * 2 + 3);
    const rr = r + 4 + ((t * 26) % 16);
    ctx.strokeStyle = hexA(SESS.waiting, clamp(0.6 * (1 - (rr - r - 4) / 16), 0, 1) * al * fade);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.stroke();
  }

  /* ── 完成未读 halo（慢脉动；view 渐熄沿 keep=1-viewK 消退） ── */
  function doneHalo(ctx, x, y, r, t, al, keep, phase) {
    if (keep <= 0.02) return;
    const ph = phase || 0;
    const hr = r + 9 + 3 * Math.sin(t * 1.8 + ph);
    ctx.strokeStyle = hexA(SESS['done-unread'], (0.22 + 0.14 * Math.sin(t * 1.8 + ph)) * al * keep);
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(x, y, hr, 0, TAU); ctx.stroke();
    drawGlow(ctx, SESS['done-unread'], x, y, r * 3.2, 0.18 * al * keep);
  }

  /* ── 委托忙碌微光环（准星环外青蓝慢呼吸，周期 ~2s） ── */
  function busyHalo(ctx, x, y, r, t, al) {
    const busyA = 0.25 * (0.5 + 0.5 * Math.sin(t * Math.PI));
    ctx.strokeStyle = hexA(SESS.busy, busyA * al);
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(x, y, r + 11, 0, TAU); ctx.stroke();
  }

  /* ── 悬停/选中丝印标记（恒星 = 虚线框；行星 = 四角定位角标） ── */
  function silkHover(ctx, it, half) {
    if (!it.hovered && !it.selected) return;
    ctx.strokeStyle = it.selected ? GOLD : hexA(GOLD, 0.55);
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.strokeRect(it.x - half - 5, it.y - half - 5, half * 2 + 10, half * 2 + 10);
    if (it.selected) {
      ctx.setLineDash([]);
      ctx.strokeRect(it.x - half - 9, it.y - half - 9, half * 2 + 18, half * 2 + 18);
    }
    ctx.setLineDash([]);
  }

  function bracketHover(ctx, it) {
    if (!it.hovered && !it.selected) return;
    ctx.strokeStyle = it.selected ? GOLD : hexA(GOLD, 0.55);
    ctx.lineWidth = 1.2;
    const d = it.r + 7, q = 5;
    ctx.beginPath();
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (sx) {
      const cx = it.x + sx[0] * d, cy = it.y + sx[1] * d;
      ctx.moveTo(cx, cy + sx[1] * -q); ctx.lineTo(cx, cy); ctx.lineTo(cx + sx[0] * -q, cy);
    });
    ctx.stroke();
  }

  /* 直角折线走线路径（单段：沿主轴 62% 处两处直角拐弯，PCB 母语） */
  function tracePath(ctx, a, b, horiz, bendX, bendY) {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    if (horiz) {
      ctx.lineTo(bendX, a.y);
      ctx.lineTo(bendX, b.y);
    } else {
      ctx.lineTo(a.x, bendY);
      ctx.lineTo(b.x, bendY);
    }
    ctx.lineTo(b.x, b.y);
  }

  return {
    skin: 'circuit',
    useBand: false,
    palette,
    gold: GOLD,
    bgStarColor(m) { return starColorOf(m); },
    dustColors: DUST,

    background(ctx, view) {
      /* 阻焊墨绿底 */
      ctx.fillStyle = '#0d1410';
      ctx.fillRect(0, 0, view.W, view.H);
      /* 焊盘格点（pattern 平铺，每帧一次 fill；32px 一个阻焊焊盘点） */
      const pat = padPattern(ctx);
      if (pat) {
        ctx.fillStyle = pat;
        ctx.fillRect(0, 0, view.W, view.H);
      } else {
        ctx.fillStyle = 'rgba(216,224,216,0.05)';
        ctx.beginPath();
        for (let gx = 32; gx < view.W; gx += 64) {
          for (let gy = 32; gy < view.H; gy += 64) ctx.rect(gx, gy, 1.2, 1.2);
        }
        ctx.fill();
      }
      /* 铜光斜照 */
      const sheen = ctx.createLinearGradient(0, 0, view.W, view.H);
      sheen.addColorStop(0, 'rgba(200,138,74,0.035)');
      sheen.addColorStop(0.5, 'rgba(200,138,74,0)');
      sheen.addColorStop(1, 'rgba(200,138,74,0.035)');
      ctx.fillStyle = sheen;
      ctx.fillRect(0, 0, view.W, view.H);
      /* 焊盘闪光（bgStars = 板面焊盘反光） */
      const bs = view.bgStars;
      for (let i = 0; i < bs.length; i++) {
        const s = bs[i];
        if (s.a < 0.05) continue;
        ctx.globalAlpha = s.a * 0.6;
        ctx.fillStyle = starColorOf(s.m);
        ctx.fillRect(s.x - 0.6, s.y - 0.6, 1.2, 1.2);
      }
      ctx.globalAlpha = 1;
    },

    drawBody(ctx, it, view) {
      const t = view.t;
      if (it.ws && vesselOnce(it.ws, t)) drawVessel(ctx, it.ws);

      if (it.kind === 'dust') {
        /* 覆铜箔（星云）：方点 sprite 批量（共享低开销原语；分色分组 + born 坡道）。
           铜面蚀刻短斜线是母语装饰层，留在原语调用之外（仅 hue 高的一支）。 */
        dustBatchDraw(dustBrush, ctx, it.pts, DUST, t, {
          shape: 'square', alphaK: 0.42, radiusK: 0, minR: 0.55
        });
        const pts = it.pts;
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          if (!(p.hue > 0.78)) continue;
          const bornK = dustBornK(p, t);
          const a = clamp(p.a * bornK, 0, 1);
          if (!(a > 0)) continue;
          ctx.globalAlpha = a * 0.2;
          ctx.strokeStyle = COPPER;
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(p.x - 2.2, p.y - 1.4); ctx.lineTo(p.x + 2.2, p.y + 1.4);
          ctx.stroke();
        }
        /* 无条件回正 α（空 pts 也回正）：跨条目 α 泄漏会让后续不显式设 α 的绘制
           （过孔/丝印短线等）继承上一项透明度。 */
        ctx.globalAlpha = 1;
        return;
      }

      if (it.kind === 'constline') {
        /* 走线（母语）：直角折线 + 铜底金芯双描 + 两端过孔；段 α 坡道参与 */
        it.segs.forEach(function (seg) {
          const a = seg.a, b = seg.b;
          const sa = it.alpha * segAlphaOf(seg);
          if (sa <= 0.01) return;
          const dx = b.x - a.x, dy = b.y - a.y;
          if (Math.abs(dx) + Math.abs(dy) < 0.8) return;
          const horiz = Math.abs(dx) >= Math.abs(dy);
          const bendX = a.x + dx * 0.62, bendY = a.y + dy * 0.62;
          ctx.strokeStyle = hexA('#8a5a2a', 0.5 * sa);
          ctx.lineWidth = 2.4;
          tracePath(ctx, a, b, horiz, bendX, bendY);
          ctx.stroke();
          ctx.strokeStyle = hexA('#ffcf7a', 0.32 * sa);
          ctx.lineWidth = 0.7;
          tracePath(ctx, a, b, horiz, bendX, bendY);
          ctx.stroke();
          /* 过孔（两端：金环，钻孔留底色） */
          if (Math.abs(dx) + Math.abs(dy) > 10) {
            ctx.strokeStyle = hexA(GOLD, 0.45 * sa);
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.arc(a.x, a.y, 2, 0, TAU);
            ctx.moveTo(b.x + 2, b.y);
            ctx.arc(b.x, b.y, 2, 0, TAU);
            ctx.stroke();
          }
        });
        return;
      }

      if (it.kind === 'patdot') {
        /* 空槽装饰点（add-cosmos-template-figure-display 3.2）：走线顶点焊盘微点——
           取金、基线 0.32（低于本皮肤走线金芯系数），点弱化因子由引擎下发；
           纯装饰（不进 picks / 无 hover / 无名牌）。 */
        patDotDraw(ctx, it, GOLD, 0.32);
        return;
      }

      if (it.kind === 'orbit') {
        /* 轨道 = 板级脉冲走线（铜底 + 金芯双描） */
        ctx.strokeStyle = hexA(COPPER, 0.16 * it.alpha);
        ctx.lineWidth = 2;
        ctx.beginPath();
        it.orbitPts.forEach(function (p, i) { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
        ctx.stroke();
        ctx.strokeStyle = hexA(GOLD, 0.09 * it.alpha);
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        it.orbitPts.forEach(function (p, i) { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
        ctx.stroke();
        return;
      }

      if (it.kind === 'star') {
        const st = it.data;
        const lifecycle = st.lifecycle || 'created';
        const act = st.act || 0;
        const fx = it.fx;
        const bAl = birthAlphaOf(it);
        const seed = hashSeed(st.id);
        const half = Math.max(4, it.r * 1.5);
        if (lifecycle === 'proto') {
          /* 星胚 = 空贴位丝印：ignite A 段收缩 / B 段白光爆闪 / C 段芯片色相渐入 */
          const phase = st.starIndex || 0;
          const breath = (Math.sin(t * 1.6 + phase) + 1) / 2;
          const protoC = PROP.proto;
          const igniteP = fx && fx.type === 'ignite' ? clamp((t - fx.t0) / fx.dur, 0, 1) : -1;
          if (igniteP >= 0 && igniteP > 0.55) {
            const grow = clamp((igniteP - 0.55) / 0.45, 0, 1);
            chipBody(ctx, it.x, it.y, half, mix(protoC, PROP.created, grow), act,
              it.alpha * bAl * (0.25 + grow * 0.75), t, seed, false);
          } else {
            protoFootprint(ctx, it.x, it.y, it.r, protoC, t, it.alpha * bAl, phase, breath, igniteP);
          }
          if (igniteP >= 0.30 && igniteP < 0.75) {
            /* B 段：白光微爆闪（上电瞬态，sin 包络） */
            const fk = (igniteP - 0.30) / 0.45;
            drawGlow(ctx, '#ffffff', it.x, it.y, it.r * 6.5,
              Math.sin(clamp(fk, 0, 1) * Math.PI) * 0.9 * it.alpha);
          }
        } else {
          const c = PROP[lifecycle] || '#ffffff';
          chipBody(ctx, it.x, it.y, half, c, act, it.alpha * bAl, t, seed,
            lifecycle === 'executed');
          if (lifecycle === 'reviewed') {
            /* 金章环 r+6；stamp fx 播放落印，随态常驻 */
            const stampP = fx && fx.type === 'stamp' ? clamp((t - fx.t0) / fx.dur, 0, 1) : -1;
            sealRing(ctx, it.x, it.y, it.r + 6, 0.85 * it.alpha, 1.4, stampP);
          }
        }
        /* 出生微爆闪（与 ignite B 段同语言、幅度减半；degraded 禁爆闪走纯 α 坡道） */
        if (it.birth && !it.birth.degraded && it.birth.k >= 0.15 && it.birth.k < 0.65) {
          const fk = (it.birth.k - 0.15) / 0.5;
          drawGlow(ctx, '#ffffff', it.x, it.y, it.r * 6.5,
            Math.sin(clamp(fk, 0, 1) * Math.PI) * 0.45 * it.alpha * bAl);
        }
        /* executed 金涌（surge）：上电金手指点亮（1.2s，见 surgeFingers） */
        if (fx && fx.type === 'surge') {
          const el = t - fx.t0;
          if (el > 0) surgeFingers(ctx, it.x, it.y, half, it.r, it.alpha, clamp(el / fx.dur, 0, 1));
        }
        ctx.globalAlpha = 1;
        silkHover(ctx, it, half);
        return;
      }

      if (it.kind === 'planet') {
        /* 信号脉冲（沿走线巡游的焊盘光点）：等批准 = ACK LED 闪烁 + 扩散环 */
        const p = it.data;
        const state = p.state;
        let c2 = sessColor(palette, 'planet', state, p, t); // 色相滑移统一取色（3.2/D3）
        const viewK = viewKOf(it, t);
        if (viewK > 0) c2 = mix(SESS['done-unread'], c2, viewK);
        const al = it.alpha * birthAlphaOf(it);
        const waitFade = mixFade(p, t, 'waiting');
        const doneFade = mixFade(p, t, 'done-unread');
        drawGlow(ctx, c2, it.x, it.y, Math.min(it.r * 4.2, 34), al * 0.72);
        trailStroke(ctx, it.trail, c2, 0.3, 0.5, 1.4, al);
        ctx.globalAlpha = al;
        ctx.fillStyle = c2;
        ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(1.7, it.r * 0.55), 0, TAU); ctx.fill();
        /* 焊盘铜环（信号落点）+ 亮芯 */
        ctx.strokeStyle = hexA(COPPER, 0.55 * al);
        ctx.lineWidth = 0.9;
        ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 2.6, 0, TAU); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(0.7, it.r * 0.18), 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        if (p.delegatedBusy) busyHalo(ctx, it.x, it.y, it.r, t, al);
        if (state === 'done-unread' || viewK > 0) {
          doneHalo(ctx, it.x, it.y, it.r, t, al, (1 - viewK) * doneFade, p.phase);
        }
        if (state === 'waiting') ackLed(ctx, it.x, it.y, it.r, t, al, waitFade, 1);
        bracketHover(ctx, it);
        return;
      }

      if (it.kind === 'suborbit') {
        /* 卫星子轨道 = 铜环丝印（虚线 [3,5]；色随父天体状态） */
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
        /* 卫星 = 测试点铜球：出生 α×bornK、半径 0→满（easeOutK）；待决策 = 迷你 ACK LED */
        const s = it.data;
        const bornK = satBornKOf(it);
        const rF = easeOutK(bornK);
        const c4 = mix(sessColor(palette, 'sat', s.state, s, t), '#707c9c', 0.3);
        trailStroke(ctx, it.trail, c4, 0.24, 0.5, 1.0, it.alpha * bornK);
        drawGlow(ctx, c4, it.x, it.y, it.r * 2.6, it.alpha * bornK * 0.45);
        ctx.globalAlpha = it.alpha * bornK;
        ctx.fillStyle = c4;
        ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(1.3, it.r * rF), 0, TAU); ctx.fill();
        /* 过孔环（测试点） */
        ctx.strokeStyle = hexA(COPPER, 0.6 * it.alpha * bornK);
        ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(1.6, it.r * rF + 1.4), 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
        if (s.state === 'waiting') {
          ackLed(ctx, it.x, it.y, it.r, t, it.alpha * bornK, mixFade(s, t, 'waiting'), 0.62);
        }
        return;
      }

      if (it.kind === 'comet') {
        /* 彗星 = 飞线跳线（探针头）：尾迹先现（trailAlpha）、核后亮（alpha） */
        const c = it.data;
        const state = c.state;
        let c3 = sessColor(palette, 'comet', state, c, t); // idle 保持 free 身份色
        const viewK = viewKOf(it, t);
        if (viewK > 0) c3 = mix(SESS['done-unread'], c3, viewK);
        const birth = it.birth || null;
        const bCore = birth ? birth.alpha : 1;
        const bTrail = birth ? birth.trailAlpha : 1;
        const waitFade = mixFade(c, t, 'waiting');
        const doneFade = mixFade(c, t, 'done-unread');
        trailStroke(ctx, it.trail, c3, 0.45, 0.6, 1.7, it.alpha * bTrail);
        drawGlow(ctx, c3, it.x, it.y, Math.min(it.r * 4, 30), it.alpha * bCore * 0.85);
        ctx.globalAlpha = it.alpha * bCore;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(1.4, it.r * 0.45), 0, TAU); ctx.fill();
        /* 探针环 */
        ctx.strokeStyle = hexA(c3, 0.7 * it.alpha * bCore);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(1.4, it.r * 0.45) + 1.8, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
        if (c.delegatedBusy) busyHalo(ctx, it.x, it.y, it.r, t, it.alpha * bCore);
        if (state === 'done-unread' || viewK > 0) {
          doneHalo(ctx, it.x, it.y, it.r, t, it.alpha * bCore, (1 - viewK) * doneFade, c.phase);
        }
        if (state === 'waiting') ackLed(ctx, it.x, it.y, it.r, t, it.alpha * bCore, waitFade, 0.85);
        return;
      }

      if (it.kind === 'wsghost') {
        /* 星座消散：覆铜箔蚀刻颗粒外散 + 芯片余辉渐熄（与场景实体解耦，不乘 ws.alpha） */
        it.dust.forEach(function (p) {
          const bornK = dustBornK(p, t);
          ctx.globalAlpha = clamp(p.a * bornK * 0.42, 0, 1);
          ctx.fillStyle = DUST[p.hue < 0.5 ? 0 : 1];
          ctx.fillRect(p.x - 0.55, p.y - 0.55, 1.1, 1.1);
        });
        ctx.globalAlpha = 1;
        it.stars.forEach(function (st) {
          drawGlow(ctx, st.color, st.x, st.y, Math.min(st.r * 3.0, 40), st.a * 0.55);
          const h = Math.max(1, st.r * 0.42);
          ctx.globalAlpha = st.a * 0.7;
          ctx.fillStyle = st.color;
          ctx.fillRect(st.x - h, st.y - h, h * 2, h * 2);
          ctx.globalAlpha = 1;
        });
        return;
      }

      if (it.kind === 'nova') {
        /* 超新星（电路母语）：芯片过载爆闪 → 板框冲击波 + 45° 走线火花 → 铜渣归尘 */
        const n = it.data;
        const base = it.r;
        const seed = hashSeed(n.id);
        if (n.degraded) {
          /* 风暴降级最小形态：渐熄淡出（辉光衰减 + 少量铜渣外散，跳过 B 段爆闪） */
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
            ctx.fillRect(it.x + Math.cos(ang) * d - 0.6, it.y + Math.sin(ang) * d - 0.6, 1.2, 1.2);
          }
          ctx.globalAlpha = 1;
          return;
        }
        if (n.intensity < 0.5) {
          /* 星胚低强度消散（0.8s）：丝印位虚线外扩淡出 + 淡核收缩 + 微粒 puff */
          const pk = it.k;
          drawGlow(ctx, n.color, it.x, it.y, base * 3 * (1 + pk * 0.8), (1 - pk) * 0.25);
          const h = base * lerp(1.1, 2.4, easeOutK(pk));
          ctx.save();
          ctx.strokeStyle = hexA(n.color, (1 - pk) * 0.5);
          ctx.lineWidth = 1.2;
          ctx.setLineDash([4, 5]);
          ctx.strokeRect(it.x - h, it.y - h, h * 2, h * 2);
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
            ctx.fillRect(it.x + Math.cos(ang) * d - 0.6, it.y + Math.sin(ang) * d - 0.6, 1.2, 1.2);
          }
          ctx.globalAlpha = 1;
          return;
        }
        /* 常规三段式：A 引爆（0–0.5s 晶核膨胀白炽）/ B 冲击波（0.3–1.1s）/
           C 坍缩归尘（0.9–dur）；B/C 时窗有意重叠（坍缩从冲击波中段开始） */
        const el = it.k * n.dur;
        const coreP = el < 0.5 ? easeOutK(el / 0.5) : clamp((el - 0.9) / Math.max(0.01, n.dur - 0.9), 0, 1);
        const coreR = base * (el < 0.5 ? lerp(1, 3.5, coreP) : lerp(3.5, 0, coreP));
        const coreA = el < 0.9 ? 1 : 1 - coreP;
        const hotC = mix(n.color, '#ffffff', 0.7);
        if (coreR > 0.8 && coreA > 0.01) {
          drawGlow(ctx, hotC, it.x, it.y, Math.max(2, coreR * 5.4), coreA * 0.85);
          drawGlow(ctx, '#ffffff', it.x, it.y, Math.max(2, coreR * 6.5),
            coreA * Math.sin(Math.PI * clamp(el / 0.5, 0, 1)) * 0.9);
          const cs = Math.max(1, coreR * 0.5);
          ctx.globalAlpha = coreA;
          ctx.fillStyle = hotC;
          ctx.fillRect(it.x - cs, it.y - cs, cs * 2, cs * 2); // 爆芯 = 过载晶核（方形）
          ctx.globalAlpha = 1;
        }
        if (el >= 0.3 && el <= 1.1) {
          const b = (el - 0.3) / 0.8;
          /* 板框式双扩散方环（波前 = 外扩板边，单路径各一次 stroke） */
          [0, 0.18].forEach(function (delay) {
            const bk = easeOutK(clamp((b - delay) / (1 - delay), 0, 1));
            if (bk <= 0 || bk >= 1) return;
            const q = base * lerp(1, 4, bk);
            ctx.strokeStyle = hexA(mix(n.color, '#ffffff', 0.4), (1 - bk) * 0.55);
            ctx.lineWidth = 1.6;
            ctx.strokeRect(it.x - q, it.y - q, q * 2, q * 2);
          });
          /* 45° 走线火花（10 道，角度吸附 45° 直角布线） */
          ctx.lineCap = 'round';
          for (let i = 0; i < 10; i++) {
            const lag = hashRand(seed + i * 13.7) * 0.35;
            const sk = (b - lag) / (1 - lag);
            if (sk <= 0 || sk >= 1) continue;
            const ang = Math.round(hashRand(seed + i * 7.3) * 7) / 8 * TAU;
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
          /* 铜渣归尘（13 粒，双色覆铜箔料）向 drift 快照点漂移渐散 */
          const ck = clamp((el - 0.9) / Math.max(0.01, n.dur - 0.9), 0, 1);
          for (let i = 0; i < 13; i++) {
            const lag = hashRand(seed + i * 17.9) * 0.25;
            const gk = clamp((ck - lag) / (1 - lag), 0, 1);
            if (gk <= 0) continue;
            const ang = hashRand(seed + i * 7.3) * TAU;
            const r0 = base * (0.5 + hashRand(seed + i * 5.7) * 0.9);
            const ex = it.drift ? it.drift.x : it.x + Math.cos(ang) * base * 2;
            const ey = it.drift ? it.drift.y : it.y + Math.sin(ang) * base * 2;
            const gx = lerp(it.x + Math.cos(ang) * r0, ex, easeOutK(gk));
            const gy = lerp(it.y + Math.sin(ang) * r0, ey, easeOutK(gk));
            const gs = 0.9 + hashRand(seed + i * 11.3) * 1.1;
            ctx.globalAlpha = (1 - gk) * 0.55;
            ctx.fillStyle = DUST[i % 2 === 0 ? 0 : 1];
            ctx.fillRect(gx - gs / 2, gy - gs / 2, gs, gs);
          }
          ctx.globalAlpha = 1;
        }
        return;
      }

      if (it.kind === 'meteor') {
        /* 流星 = 焊锡飞溅：金白尾迹 + 亮核 */
        trailStroke(ctx, it.trail, '#ffe89a', 0.5, 0.5, 1.4, it.alpha);
        drawGlow(ctx, '#fff4d8', it.x, it.y, 11, it.alpha);
        ctx.globalAlpha = it.alpha * 0.85;
        ctx.fillStyle = '#fff6d8';
        ctx.fillRect(it.x - 1, it.y - 1, 2, 2);
        ctx.globalAlpha = 1;
      }
    }
  };
}
