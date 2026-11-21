/**
 * 风格 D 皮肤（自 demo/styles/assets/style-d.js 移植 + add-celestial-states 状态扩展）。
 *
 * 语言参数（design.md「视觉方向」表 + demo/states/assets/states-core.js「星章」基线）：
 *  - 底色 `#070812` + 过程化银河带（暖白/暖橙粒子，预倾斜扁环带，加色混合）；
 *  - HUD 主调暖金 `#ffd28a`；
 *  - 恒星生命周期四态（BREAKING：in-progress 橙色退场，活跃度走 act 热度通道）：
 *    proto 星胚 `#8a9bc0`（虚线 `[4,5]` 轮廓 + 呼吸）/ created `#9fd8ff` /
 *    reviewed `#cfe8ff` + 金章环 `#ffd28a`（r+6, 1.4px）/ executed `#ffe27a`；
 *  - 行星四态 idle `#a8b8d8` / busy `#54c8ff` / waiting `#ffaa4a`（光柱+扩散环）/
 *    done-unread `#5affc0`（halo 慢脉动）+ 委托忙碌青蓝微光环；
 *  - 卫星：实心圆点（四态色向灰蓝 dim 35%）、子轨道虚线 `[3,5]`、待决策迷你光柱；
 *  - 彗星 `#cfeaff` 白芯长尾；流星暖白 `#ffe9cf`；
 *  - 星云尘埃双色 `#5a6ea0`/`#7a6ea0`；
 *  - 连线虚线 `[2,4]` 金色 0.28α；轨道环虚线 `[4,6]` 金色 0.20α；图样全量线同 0.28α
 *    基线（引擎 `E.patLineDim` 自缩，缺省 0.5）；空槽装饰点 `patdot` 取同色 0.28α 基线 ×
 *    派生点 α（恒低于图样线，add-cosmos-figure-line-alpha 2.3）。
 *
 * 转场编排消费面（add-transition-choreography）：birth 出生绘制（恒星淡入+微爆闪 /
 * 星胚轮廓坡道 / 行星滑入 α / 彗星游入尾迹先现核后亮 / 卫星 born 半径+α 坡道）、
 * colorMix 状态色相滑移统一取色（sessColor）+ 注意力信号强度坡道（mixFade）、
 * executed 金涌 surge（金色内收脉冲 + 金环闪光）、星座消散幽灵 wsghost、连线段
 * 淡入淡出（seg.alpha）、nova 风暴降级最小形态（degraded 渐熄淡出）。
 *
 * 去全局化：demo 读取 `window.COSMOS_UTIL`（clamp/lerp/glowSprite/TAU）——移植为
 * 模块内自带实现；`window.COSMOS_STYLE` 全局注册改为 `createSkinD()` 产出同一接口
 * （skin/useBand/palette/bgStarColor/dustColors/background/drawBody）。
 * skin 接口（palette + drawBody）保持引擎无关（design.md R5：Canvas2D → three.js
 * 升级路径集中在皮肤翻译层）。
 */

const TAU = Math.PI * 2;

/* 共享低开销尘埃原语（add-cosmos-render-budget D2）：缓存 sprite + 分色分组。 */
import { makeDustSprite, dustBatchDraw, patDotDraw } from './skin-kit.mjs';

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function easeOutK(k) { k = clamp(k, 0, 1); return 1 - Math.pow(1 - k, 3); }

/** 颜色混合（act 白热偏移 / 查看渐熄 / 卫星 dim 用；states-core 同款）。 */
function mix(h1, h2, k) {
  k = clamp(k, 0, 1);
  const a = parseInt(h1.slice(1), 16), b = parseInt(h2.slice(1), 16);
  const r = Math.round(lerp((a >> 16) & 255, (b >> 16) & 255, k));
  const g = Math.round(lerp((a >> 8) & 255, (b >> 8) & 255, k));
  const bl = Math.round(lerp(a & 255, b & 255, k));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1);
}

/** 卫星降饱和（向灰蓝收 35%；states-core `dim` 同款）。 */
function dimColor(hex) { return mix(hex, '#707c9c', 0.35); }

/* ---------- 转场编排消费面（add-transition-choreography） ---------- */

/** 星云增量渐入时长（1.2：born α 坡道 0.8s）。 */
const DUST_BORN_FADE = 0.8;

/** 会话天体状态色解析（D3 统一口径）：行星/卫星直查四态表；彗星 idle 保持 ☄ 身份色
    free（add-comet-states 既有语义），非 idle 覆盖状态色。 */
function sessColorOf(palette, kind, state) {
  if (kind === 'comet') {
    return state && state !== 'idle' && palette.sess[state] ? palette.sess[state] : palette.sess.free;
  }
  return palette.sess[state] || '#cccccc';
}

/** 状态色相滑移取色（3.2/D3）：colorMix 存在 → from/to 状态色 easeOutCubic 插值；
    无 mix → 直取状态色（稳态零成本，天生免疫风暴）。 */
function sessColor(palette, kind, state, body, t) {
  const cm = body?.colorMix;
  if (!cm) return sessColorOf(palette, kind, state);
  const k = easeOutK(clamp((t - cm.t0) / cm.dur, 0, 1));
  return mix(sessColorOf(palette, kind, cm.from), sessColorOf(palette, kind, cm.to), k);
}

/** 注意力信号强度坡道（3.2）：有 colorMix 时按插值进度对来源/目标态加权（淡入淡出
    跟随色相——waiting 光柱/扩散环、done-unread halo）；无 mix → 1（不改既有信号）。 */
function mixFade(body, t, state) {
  const cm = body?.colorMix;
  if (!cm) return 1;
  const k = easeOutK(clamp((t - cm.t0) / cm.dur, 0, 1));
  let w = 0;
  if (cm.from === state) w += 1 - k;
  if (cm.to === state) w += k;
  return clamp(w, 0, 1);
}

/** 字符串种子（nova 火花/残骸确定性参数基座；跨帧同值 → 无闪烁）。 */
function hashSeed(text) {
  let h = 0;
  const s = String(text);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** 确定性伪随机 [0,1)（sin-hash；同一 seed 逐帧恒定）。 */
function hashRand(seed) {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function glowSprite(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, inner);
  gr.addColorStop(0.3, outer);
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return c;
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}

const BAND_COLORS = ['#c9d6ff', '#ffe1c4', '#ffffff'];
/* 生命周期四态（states-core prop 键：proto/created/reviewed/done——`done` 键对齐为
   `executed`，色值不变）；行星会话四态（done 键更名为 done-unread，色值不变）。 */
const PROP = { proto: '#8a9bc0', created: '#9fd8ff', reviewed: '#cfe8ff', executed: '#ffe27a' };
const SESS = { idle: '#a8b8d8', busy: '#54c8ff', waiting: '#ffaa4a', 'done-unread': '#5affc0', free: '#cfeaff' };
const GOLD = '#ffd28a';

/**
 * 创建风格 D（内置皮肤 `deepspace`）实例（引擎构造参数形态；每次创建独立 glow sprite 缓存）。
 *
 * add-cosmos-skin-themes 1.2：导出改名 `createSkinDeepspace`（注册表按 `deepspace` 注册，
 * 其 HUD 令牌表 = 改造前现值，即全部 `var(--cos-*, fallback)` 的 fallback 基线）；
 * 旧名 `createSkinD` 保留为具名兼容别名（外壳/冒烟既有引用零改动）。
 */
export function createSkinDeepspace() {
  const spriteCache = {};
  const dustBrush = makeDustSprite(); // 尘埃 sprite 缓存（每皮肤实例独立，防跨皮肤串色）
  function glow(hex) {
    if (!spriteCache[hex]) spriteCache[hex] = glowSprite(hexA(hex, 0.95), hexA(hex, 0.22));
    return spriteCache[hex];
  }
  function drawGlow(ctx, hex, x, y, R, a) {
    if (R < 2 || a <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(glow(hex), x - R, y - R, R * 2, R * 2);
    ctx.restore();
  }

  /* ── 恒星本体（created/reviewed/executed 共用；风格 D 语言 + act 热度通道）。
     颜色 = 生命周期态色；act≥1 附加白热核 + 十字耀斑（L=r×3.4，色向白偏移 ≤0.5），
     颜色通道不再承担执行语义（in-progress 橙色退场）。 ── */
  function drawStarBody(ctx, x, y, r, c, act, al, t) {
    act = act || 0;
    drawGlow(ctx, c, x, y, Math.min(r * 5.4, 70), al * (0.5 + act * 0.2));
    ctx.globalAlpha = al;
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(x, y, Math.max(1.4, r * 0.5), 0, TAU); ctx.fill();
    if (act > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath(); ctx.arc(x, y, Math.max(0.8, r * 0.26), 0, TAU); ctx.fill();
      const hot = mix(c, '#ffffff', Math.min(0.5, 0.18 * act));
      ctx.strokeStyle = hexA(hot, 0.45 * al);
      ctx.lineWidth = 1;
      const L = r * 3.4;
      ctx.beginPath();
      ctx.moveTo(x - L, y); ctx.lineTo(x + L, y);
      ctx.moveTo(x, y - L); ctx.lineTo(x, y + L);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /* ── 星胚（方案一「星章」dash-outline）：虚线轮廓 `[4,5]` + 呼吸 ±2px / α0.45–0.70
     + 淡核；igniteP∈[0,0.3] 轮廓收缩（点燃转场 A 段，B/C 段由调用方接棒）。 ── */
  function drawProtoStar(ctx, x, y, r, c, t, al, phase, breath, igniteP) {
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

  /* ── 已审核金色印章环（seal-ring）：stampP≥0 播放落印（半径 r×2.2→r+6 easeOut + α 淡入）。 ── */
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

  return {
    skin: 'deepspace',
    useBand: true,
    palette: { prop: PROP, sess: SESS },
    gold: GOLD,
    bgStarColor: function (m) { return m > 0.9 ? '#ffe9cf' : (m < 0.5 ? '#a8d8ff' : '#eef6ff'); },
    dustColors: ['#5a6ea0', '#7a6ea0'],

    background: function (ctx, view) {
      ctx.fillStyle = '#070812';
      ctx.fillRect(0, 0, view.W, view.H);
      // 银河带(加色混合, 密度即亮度)
      if (view.band) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const band = view.band;
        for (let i = 0; i < band.length; i++) {
          const b = band[i];
          if (b.a < 0.02) continue;
          ctx.globalAlpha = b.a * 0.6;
          ctx.fillStyle = BAND_COLORS[(b.m * 3) | 0] || '#ffffff';
          const size = 0.7 + b.m * 1.4;
          ctx.fillRect(b.x - size / 2, b.y - size / 2, size, size);
        }
        ctx.restore();
      }
      // 背景星
      const bs = view.bgStars;
      for (let j = 0; j < bs.length; j++) {
        const s = bs[j];
        if (s.a < 0.03) continue;
        const c = this.bgStarColor(s.m);
        const size2 = 0.7 + s.m * 1.4;
        if (s.m > 0.9) drawGlow(ctx, c, s.x, s.y, 3.6, s.a * 0.8);
        ctx.globalAlpha = s.a;
        ctx.fillStyle = c;
        ctx.fillRect(s.x - size2 / 2, s.y - size2 / 2, size2, size2);
      }
      ctx.globalAlpha = 1;
    },

    drawBody: function (ctx, it, view) {
      const t = view.t;
      const self = this;

      if (it.kind === 'dust') {
        /* 星云尘埃：共享低开销原语（缓存 dot sprite + 分色分组；born 坡道 0.8s 沿用）。
           风格 D 为深空系 → lighter 加色（合成模式声明在原语调用）。 */
        dustBatchDraw(dustBrush, ctx, it.pts, self.dustColors, t, {
          composite: 'lighter',
          alphaK: 0.5,
          radiusK: 0.42,
          minR: 0.6
        });
        return;
      }
      if (it.kind === 'constline') {
        /* 连线段淡入淡出（8.1）：段状态以恒星 id 对为键（引擎侧差分），seg.alpha
           ∈[0,1] 携带坡道（新增段渐入 / 移除段渐熄幽灵）。
           关联聚焦段（cosmos-relation-focus D2/D8，风格 D 参考实现）：seg.rel 金色虚线
           增亮——α = 基线 0.28 → 聚焦坡道因子 × 0.8 上限（design D8：低于选中实金环，
           保持辅助层定位）。未适配皮肤忽略标记即回落普通段——本分支 else 路径即降级基线。 */
        ctx.setLineDash([2, 4]);
        it.segs.forEach(function (seg) {
          const segK = seg.alpha ?? 1;
          const relK = seg.rel ? clamp(seg.relAlpha ?? 1, 0, 1) : 0;
          const alpha = (0.28 + 0.52 * relK) * it.alpha * segK;
          ctx.strokeStyle = 'rgba(255,214,150,' + alpha.toFixed(3) + ')';
          ctx.lineWidth = 1 + 0.6 * relK;
          ctx.beginPath();
          ctx.moveTo(seg.a.x, seg.a.y);
          ctx.lineTo(seg.b.x, seg.b.y);
          ctx.stroke();
        });
        ctx.setLineDash([]);
        return;
      }
      if (it.kind === 'patdot') {
        /* 空槽装饰点（add-cosmos-template-figure-display 3.2）：图样线顶点的微点——
           取线与行星环同源的暖金，基线 0.28 × 派生点 α（引擎 pt.a < E.patLineDim），
           恒弱于本皮肤的图样线段；纯装饰（不进 picks / 无 hover / 无名牌）。 */
        patDotDraw(ctx, it, '#ffd696', 0.28);
        return;
      }
      if (it.kind === 'orbit') {
        /* 轨道环常显 0.20α；关联聚焦环（rel，cosmos-relation-focus D2/D8）增亮至
           0.20+0.42×relAlpha、线宽 1→1.8 —— 低于选中实金环（辅助层定位）。 */
        const relK = it.rel ? clamp(it.relAlpha ?? 1, 0, 1) : 0;
        ctx.strokeStyle = 'rgba(255,214,150,' + ((0.20 + 0.42 * relK) * it.alpha).toFixed(3) + ')';
        ctx.lineWidth = 1 + 0.8 * relK;
        ctx.setLineDash([4, 6]);
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
        const t = view.t;
        const fx = it.fx;
        /* 出生 α 坡道（2.4/D2）：delay 段 alpha=0 → 不可见；风暴降级只缩 α（无爆闪）。 */
        const birth = it.birth ?? null;
        const bAl = birth ? birth.alpha : 1;
        if (lifecycle === 'proto') {
          /* 星胚：呼吸 + 虚线轮廓；点燃转场 B 段白光爆闪（0.30–0.75）、
             C 段（>0.55）色相渐变为已创建（A 段收缩在 drawProtoStar 内）。 */
          const phase = st.starIndex || 0;
          const breath = (Math.sin(t * 1.6 + phase) + 1) / 2;
          const protoC = this.palette.prop.proto;
          const igniteP = fx && fx.type === 'ignite' ? clamp((t - fx.t0) / fx.dur, 0, 1) : -1;
          if (igniteP >= 0 && igniteP > 0.55) {
            drawStarBody(ctx, it.x, it.y, it.r, mix(protoC, this.palette.prop.created, (igniteP - 0.55) / 0.45), act, it.alpha * bAl, t);
          } else {
            drawProtoStar(ctx, it.x, it.y, it.r, protoC, t, it.alpha * bAl, phase, breath, igniteP);
          }
          if (igniteP >= 0.30 && igniteP < 0.75) {
            const fk = (igniteP - 0.30) / 0.45;
            drawGlow(ctx, '#ffffff', it.x, it.y, it.r * 6.5, Math.sin(clamp(fk, 0, 1) * Math.PI) * 0.9 * it.alpha);
          }
        } else {
          const c = this.palette.prop[lifecycle] || '#ffffff';
          drawStarBody(ctx, it.x, it.y, it.r, c, act, it.alpha * bAl, t);
          if (lifecycle === 'reviewed') {
            /* 金色印章环 r+6（1.4px）；stamp fx 播放落印，随态常驻。 */
            const stampP = fx && fx.type === 'stamp' ? clamp((t - fx.t0) / fx.dur, 0, 1) : -1;
            sealRing(ctx, it.x, it.y, it.r + 6, 0.85 * it.alpha, 1.4, stampP);
          }
        }
        /* 出生微爆闪（2.4/D2）：点燃 B 段同语言、幅度减半（0.45），时窗 k∈[0.15,0.65]。 */
        if (birth && !birth.degraded && birth.k >= 0.15 && birth.k < 0.65) {
          const fk = (birth.k - 0.15) / 0.5;
          drawGlow(ctx, '#ffffff', it.x, it.y, it.r * 6.5, Math.sin(clamp(fk, 0, 1) * Math.PI) * 0.45 * it.alpha * bAl);
        }
        /* executed 金涌（4.2/D4 翻案）：金色 #ffe27a 辉光内收脉冲（半径 ×2.2→×1，
           α 先扬后收）+ 金环一次闪光（外扩渐熄），1.2s easeOutCubic。 */
        if (fx && fx.type === 'surge') {
          const el = t - fx.t0;
          if (el > 0) {
            const kk = clamp(el / fx.dur, 0, 1);
            drawGlow(ctx, this.palette.prop.executed, it.x, it.y, Math.min(it.r * 5.4 * lerp(2.2, 1, easeOutK(kk)), 150), Math.sin(kk * Math.PI) * 0.85 * it.alpha);
            const ringK = easeOutK(clamp(el / (fx.dur * 0.6), 0, 1));
            ctx.strokeStyle = hexA(this.palette.prop.executed, (1 - ringK) * 0.8 * it.alpha);
            ctx.lineWidth = 1.6;
            ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 6 + ringK * 26, 0, TAU); ctx.stroke();
          }
        }
        ctx.globalAlpha = 1;
        if (it.hovered || it.selected) {
          ctx.strokeStyle = it.selected ? GOLD : hexA(GOLD, 0.55);
          ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 6, 0, TAU); ctx.stroke();
          ctx.setLineDash([2, 4]);
          ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 11, 0, TAU); ctx.stroke();
          ctx.setLineDash([]);
        }
        return;
      }
      if (it.kind === 'planet') {
        const p = it.data;
        const state = p.state;
        let c2 = sessColor(this.palette, 'planet', state, p, t); // 色相滑移统一取色（3.2/D3）
        /* 查看渐熄转场（fx.view）——谓词 fx 驱动（行星/彗星共用，与彗星渐熄同款）：
           原实现以 state==='done-unread' 为前提，而 markFx 与 state 翻转同帧
           （client 差分环内标记 → patch 后 state 已 idle），前提恒假致渐变空转
           （实际瞬切）；窗口内（k<1）照播插值，状态中途翻转非目标态也播至结束。 */
        const viewK = it.fx && it.fx.type === 'view' ? easeOutK(clamp((t - it.fx.t0) / (it.fx.dur * 0.72), 0, 1)) : 0;
        if (viewK > 0) c2 = mix(this.palette.sess['done-unread'], c2, viewK);
        /* 出生 α 坡道（2.4）：滑入位移在引擎侧完成，这里只乘 α；delay 段不可见。
           注意力信号坡道（3.2）：waiting 光柱/扩散环、done-unread halo 强度随色相
           滑移淡入淡出（无 colorMix → 恒 1，不改既有信号）。 */
        const bAl = it.birth ? it.birth.alpha : 1;
        const al = it.alpha * bAl;
        const waitFade = mixFade(p, t, 'waiting');
        const doneFade = mixFade(p, t, 'done-unread');
        const waiting = state === 'waiting';
        drawGlow(ctx, c2, it.x, it.y, Math.min(it.r * 4.4, 36), al * 0.85);
        if (it.trail && it.trail.length > 1) {
          ctx.lineCap = 'round';
          for (let i = 1; i < it.trail.length; i++) {
            const k = i / it.trail.length;
            ctx.strokeStyle = hexA(c2, (k * 0.3 * al).toFixed(3));
            ctx.lineWidth = 0.5 + k * 1.3;
            ctx.beginPath();
            ctx.moveTo(it.trail[i - 1].x, it.trail[i - 1].y);
            ctx.lineTo(it.trail[i].x, it.trail[i].y);
            ctx.stroke();
          }
        }
        ctx.globalAlpha = al;
        ctx.fillStyle = c2;
        ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(1.6, it.r * 0.55), 0, TAU); ctx.fill();
        // 双重准星环
        ctx.strokeStyle = hexA(c2, 0.4 * al);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 4, 0, TAU); ctx.stroke();
        ctx.strokeStyle = hexA(c2, 0.18 * al);
        ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 8, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
        if (p.delegatedBusy) {
          /* 委托忙碌微光环：准星环外青蓝 α~0.25 慢呼吸（周期 ~2s）。 */
          const busyA = 0.25 * (0.5 + 0.5 * Math.sin(t * Math.PI));
          ctx.strokeStyle = hexA(this.palette.sess.busy, busyA * al);
          ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 11, 0, TAU); ctx.stroke();
        }
        if (state === 'done-unread' || viewK > 0) {
          /* 完成未读：薄荷绿 halo 慢脉动（r+9±3px，α0.22–0.36，周期 ~3.5s）；
             view 转场沿 keep=1-viewK 渐熄（fx 驱动谓词——state 翻转同帧后照播消退）。 */
          const keep = (1 - viewK) * doneFade;
          if (keep > 0.02) {
            const ph = p.phase || 0;
            const hr = it.r + 9 + 3 * Math.sin(t * 1.8 + ph);
            ctx.strokeStyle = hexA(this.palette.sess['done-unread'], (0.22 + 0.14 * Math.sin(t * 1.8 + ph)) * al * keep);
            ctx.lineWidth = 1.6;
            ctx.beginPath(); ctx.arc(it.x, it.y, hr, 0, TAU); ctx.stroke();
            drawGlow(ctx, this.palette.sess['done-unread'], it.x, it.y, it.r * 3.2, 0.18 * al * keep);
          }
        }
        if (waiting) {
          // 等批准注意力信号：琥珀光柱 + 周期扩散环（spec「等批准行星可一眼定位」）
          const g = ctx.createLinearGradient(it.x, it.y - 36, it.x, it.y);
          g.addColorStop(0, hexA(c2, 0));
          g.addColorStop(1, hexA(c2, 0.85 * al * waitFade));
          ctx.strokeStyle = g; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(it.x, it.y - 36); ctx.lineTo(it.x, it.y - 4); ctx.stroke();
          const rr = it.r + 4 + ((t * 26) % 16);
          ctx.strokeStyle = hexA(c2, clamp(0.7 * (1 - (rr - it.r - 4) / 16), 0, 1) * al * waitFade);
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(it.x, it.y, rr, 0, TAU); ctx.stroke();
        }
        if (it.hovered || it.selected) {
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
        return;
      }
      if (it.kind === 'suborbit') {
        /* 卫星子轨道虚线环 `[3,5]`（色随父天体状态，0.28α；states-core drawSubOrbit 同款）。
           挂卫星行星聚焦时子轨道环同源增亮（cosmos-relation-focus「挂卫星行星聚焦」
           SHOULD：rel 标记 + 同一 relAlpha）。 */
        const oc = this.palette.sess[it.data?.state] || this.palette.sess.idle;
        const relK = it.rel ? clamp(it.relAlpha ?? 1, 0, 1) : 0;
        ctx.strokeStyle = hexA(oc, (0.28 + 0.42 * relK) * it.alpha);
        ctx.lineWidth = 1 + 0.8 * relK;
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        it.orbitPts.forEach(function (p, i) { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
        ctx.stroke();
        ctx.setLineDash([]);
        return;
      }
      if (it.kind === 'sat') {
        /* 卫星：实心圆点（四态色 dim 35%）+ 弧形尾迹 + 待决策迷你光柱/迷你扩散环。
           不参与拾取、无独立信息卡（引擎不为其挂 picks）。 */
        const s = it.data;
        /* 出生坡道（2.2）：bornK ∈[0,1]（引擎侧按 born/SAT_BORN_DUR 计），α×bornK、
           半径 0→满（easeOutCubic 短尾）；dim 色域内同款色相滑移（3.2）。 */
        const bornK = it.bornK != null ? clamp(it.bornK, 0, 1) : 1;
        const rF = easeOutK(bornK);
        const c4 = dimColor(sessColor(this.palette, 'sat', s.state, s, t));
        if (it.trail && it.trail.length > 1) {
          ctx.lineCap = 'round';
          for (let i = 1; i < it.trail.length; i++) {
            const k = i / it.trail.length;
            ctx.strokeStyle = hexA(c4, (k * 0.22 * it.alpha * bornK).toFixed(3));
            ctx.lineWidth = 0.5 + k * 1.1;
            ctx.beginPath();
            ctx.moveTo(it.trail[i - 1].x, it.trail[i - 1].y);
            ctx.lineTo(it.trail[i].x, it.trail[i].y);
            ctx.stroke();
          }
        }
        drawGlow(ctx, c4, it.x, it.y, it.r * 2.6, it.alpha * bornK * 0.45);
        ctx.globalAlpha = it.alpha * bornK;
        ctx.fillStyle = c4;
        ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(1.4, it.r * rF), 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        if (s.state === 'waiting') {
          // 待决策卫星：迷你琥珀光柱 + 迷你扩散环（states-core drawSatellite 同款；
          // 强度乘出生坡道与色相滑移坡道，3.2）
          const satWaitFade = bornK * mixFade(s, t, 'waiting');
          const h = it.r * 2.6 + 6;
          const g = ctx.createLinearGradient(it.x, it.y - h, it.x, it.y);
          g.addColorStop(0, hexA(this.palette.sess.waiting, 0));
          g.addColorStop(1, hexA(this.palette.sess.waiting, 0.7 * it.alpha * satWaitFade));
          ctx.strokeStyle = g; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.moveTo(it.x, it.y - h); ctx.lineTo(it.x, it.y - 2); ctx.stroke();
          const p = ((t * 22) % 10) / 10;
          const rr = it.r + 2 + p * 7;
          ctx.strokeStyle = hexA(this.palette.sess.waiting, (1 - p) * 0.5 * it.alpha * satWaitFade);
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(it.x, it.y, rr, 0, TAU); ctx.stroke();
        }
        return;
      }
      if (it.kind === 'comet') {
        const c = it.data;
        const state = c.state;
        /* 四态色（add-comet-states-and-star-death）：待机保持 ☄ 身份色 free（已拍板）；
           非 idle 覆盖状态色——染 glow/尾迹/准星环，彗核恒白（☄ 身份辨识，视觉主量
           在长尾迹，外围染色足以承载状态可读性）。 */
        let c3 = sessColor(this.palette, 'comet', state, c, t); // 色相滑移统一取色（3.2/D3，idle 保持 free 身份色）
        /* 查看渐熄（fx.view，fx 驱动谓词，行星/彗星共用同一修复）：done-unread 薄荷绿
           渐褪回目标色、halo 消退。不以 state==='done-unread' 为前提——markFx 与 state
           翻转同帧（client 差分环内标记 → patch），state 前提恒假致渐变空转瞬切。 */
        const viewK = it.fx && it.fx.type === 'view' ? easeOutK(clamp((t - it.fx.t0) / (it.fx.dur * 0.72), 0, 1)) : 0;
        if (viewK > 0) c3 = mix(this.palette.sess['done-unread'], c3, viewK);
        /* 出生游入（2.4/D2）：尾迹先现（引擎侧长度坡道 + trailAlpha 快渐入）、
           核后亮（coreAlpha 延后 0.3s 坡道）；风暴降级 → 纯 α 坡道。 */
        const birth = it.birth ?? null;
        const bCore = birth ? birth.alpha : 1;
        const bTrail = birth ? birth.trailAlpha : 1;
        const waitFade = mixFade(c, t, 'waiting');
        const doneFade = mixFade(c, t, 'done-unread');
        if (it.trail && it.trail.length > 1) {
          ctx.lineCap = 'round';
          for (let j = 1; j < it.trail.length; j++) {
            const k2 = j / it.trail.length;
            ctx.strokeStyle = hexA(c3, (k2 * 0.5 * it.alpha * bTrail).toFixed(3));
            ctx.lineWidth = 0.6 + k2 * 1.9;
            ctx.beginPath();
            ctx.moveTo(it.trail[j - 1].x, it.trail[j - 1].y);
            ctx.lineTo(it.trail[j].x, it.trail[j].y);
            ctx.stroke();
          }
        }
        drawGlow(ctx, c3, it.x, it.y, Math.min(it.r * 4.2, 32), it.alpha * bCore * 0.9);
        ctx.globalAlpha = it.alpha * bCore;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(1.4, it.r * 0.45), 0, TAU); ctx.fill();
        ctx.strokeStyle = hexA(c3, 0.45 * it.alpha * bCore);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 4, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
        if (c.delegatedBusy) {
          /* 委托忙碌微光环（行星分支同款三行；卫星渲染 requirement 对「父天体
             （行星或彗星）」已 MUST，彗星分支补齐）：准星环外青蓝 α~0.25 慢呼吸。 */
          const busyA = 0.25 * (0.5 + 0.5 * Math.sin(t * Math.PI));
          ctx.strokeStyle = hexA(this.palette.sess.busy, busyA * it.alpha * bCore);
          ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(it.x, it.y, it.r + 11, 0, TAU); ctx.stroke();
        }
        {
          /* 完成未读 halo 慢脉动；view 渐熄沿 keep=1-viewK 消退（fx 驱动谓词）；
             色相滑移沿 doneFade 坡道淡入淡出（3.2）。 */
          const keep = (1 - viewK) * doneFade * bCore;
          if (keep > 0.02 && (state === 'done-unread' || viewK > 0)) {
            const ph = c.phase || 0;
            const hr = it.r + 9 + 3 * Math.sin(t * 1.8 + ph);
            ctx.strokeStyle = hexA(this.palette.sess['done-unread'], (0.22 + 0.14 * Math.sin(t * 1.8 + ph)) * it.alpha * keep);
            ctx.lineWidth = 1.6;
            ctx.beginPath(); ctx.arc(it.x, it.y, hr, 0, TAU); ctx.stroke();
            drawGlow(ctx, this.palette.sess['done-unread'], it.x, it.y, it.r * 3.2, 0.18 * it.alpha * keep);
          }
        }
        if (state === 'waiting') {
          // 待决策注意力信号：琥珀光柱 + 周期扩散环（行星待决策同款几何，spec 信号对齐；
          // 强度乘 waitFade 色相滑移坡道，3.2）
          const g = ctx.createLinearGradient(it.x, it.y - 36, it.x, it.y);
          g.addColorStop(0, hexA(c3, 0));
          g.addColorStop(1, hexA(c3, 0.85 * it.alpha * bCore * waitFade));
          ctx.strokeStyle = g; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(it.x, it.y - 36); ctx.lineTo(it.x, it.y - 4); ctx.stroke();
          const rr = it.r + 4 + ((t * 26) % 16);
          ctx.strokeStyle = hexA(c3, clamp(0.7 * (1 - (rr - it.r - 4) / 16), 0, 1) * it.alpha * bCore * waitFade);
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(it.x, it.y, rr, 0, TAU); ctx.stroke();
        }
        return;
      }
      if (it.kind === 'wsghost') {
        /* 星座消散幽灵（5.1/D5）：尘埃外扩漂散（引擎侧 off ×1→×2.2）+ 恒星余辉渐熄
           （α→0，色为快照时生命周期态色），与场景实体解耦、不乘 ws.alpha。 */
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        it.dust.forEach(function (p) {
          ctx.globalAlpha = clamp(p.a * 0.5, 0, 1);
          ctx.fillStyle = self.dustColors[p.hue < 0.5 ? 0 : 1];
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
        /* 超新星转场（引擎级幽灵条目，add-comet-states-and-star-death）：
           常规 = 三段式 A 引爆 → B 冲击波 → C 坍缩归尘（B/C 时窗有意重叠——坍缩
           从冲击波中段开始）；intensity<0.5 = 星胚低强度消散变体（0.8s，无爆闪/
           冲击波）。段内时窗按秒（dur 2.4s ↔ 设计归一化窗 0.21/0.46/1.0）。 */
        const n = it.data;
        const base = it.r;
        const seed = hashSeed(n.id);
        if (n.degraded) {
          /* 风暴降级最小形态（7.2/D7）：渐熄淡出——仅辉光衰减 + 少量残骸外散，
             跳过 B 段火花与冲击环（「调度不打断进行中动画」：只影响未启动事件）。 */
          const pk = it.k;
          drawGlow(ctx, n.color, it.x, it.y, base * 3 * (1 + pk * 0.6), (1 - pk) * 0.3);
          ctx.globalAlpha = (1 - pk) * 0.4;
          ctx.fillStyle = n.color;
          ctx.beginPath();
          ctx.arc(it.x, it.y, Math.max(0.8, base * 0.4 * (1 - pk)), 0, TAU);
          ctx.fill();
          ctx.globalAlpha = 1;
          const grains = 6;
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          for (let i = 0; i < grains; i++) {
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
          const pk = it.k; // 0..1（0.8s 总长）
          drawGlow(ctx, n.color, it.x, it.y, base * 3 * (1 + pk * 0.8), (1 - pk) * 0.25);
          /* 虚线轮廓放大淡出 + 淡核收缩。 */
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
          /* 4~6 微粒 puff（取中值 5，错峰外散）。 */
          const puffs = 5;
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          for (let i = 0; i < puffs; i++) {
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
        const el = it.k * n.dur; // 已流逝秒
        /* A 引爆（0–0.5s）：核心膨胀 ×1→×3.5 + 色向白炽偏移（mix ≤0.7）；
           B 段起核保持峰值过渡；C 坍缩（0.9s 起）收缩熄灭。 */
        const coreP = el < 0.5 ? easeOutK(el / 0.5) : clamp((el - 0.9) / Math.max(0.01, n.dur - 0.9), 0, 1);
        const coreR = base * (el < 0.5 ? lerp(1, 3.5, coreP) : lerp(3.5, 0, coreP));
        const coreA = el < 0.9 ? 1 : 1 - coreP;
        const hotC = mix(n.color, '#ffffff', 0.7);
        if (coreR > 0.8 && coreA > 0.01) {
          drawGlow(ctx, hotC, it.x, it.y, Math.max(2, coreR * 5.4), coreA * 0.85);
          drawGlow(ctx, '#ffffff', it.x, it.y, Math.max(2, coreR * 6.5), coreA * Math.sin(Math.PI * clamp(el / 0.5, 0, 1)) * 0.9);
          ctx.globalAlpha = coreA;
          ctx.fillStyle = hotC;
          ctx.beginPath(); ctx.arc(it.x, it.y, Math.max(1, coreR * 0.5), 0, TAU); ctx.fill();
          ctx.globalAlpha = 1;
        }
        /* B 冲击波（0.3–1.1s）：双扩散环（半径至恒星屏显半径 ×4，α 衰减；画法同
           waiting 扩散环）+ 8~12 放射火花（随机方向短流星，长 12~26px，错峰起爆）。 */
        if (el >= 0.3 && el <= 1.1) {
          const b = (el - 0.3) / 0.8;
          [0, 0.18].forEach(function (delay) {
            const bk = easeOutK(clamp((b - delay) / (1 - delay), 0, 1));
            if (bk <= 0 || bk >= 1) return;
            ctx.strokeStyle = hexA(mix(n.color, '#ffffff', 0.4), (1 - bk) * 0.55);
            ctx.lineWidth = 1.6;
            ctx.beginPath(); ctx.arc(it.x, it.y, base * lerp(1, 4, bk), 0, TAU); ctx.stroke();
          });
          const sparks = 10;
          ctx.lineCap = 'round';
          for (let i = 0; i < sparks; i++) {
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
        /* C 坍缩归尘（0.9–dur）：残骸 10~16 粒（星云尘埃双色 #5a6ea0/#7a6ea0）
           向 driftTo 快照点漂移渐散（无快照点 → 原位外散渐熄），α→0。 */
        if (el >= 0.9) {
          const ck = clamp((el - 0.9) / Math.max(0.01, n.dur - 0.9), 0, 1);
          const grains = 13;
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          for (let i = 0; i < grains; i++) {
            const lag = hashRand(seed + i * 17.9) * 0.25;
            const gk = clamp((ck - lag) / (1 - lag), 0, 1);
            if (gk <= 0) continue;
            const ang = hashRand(seed + i * 7.3) * TAU;
            const r0 = base * (0.5 + hashRand(seed + i * 5.7) * 0.9); // 起散半径（恒星偏移量级）
            const ex = it.drift ? it.drift.x : it.x + Math.cos(ang) * base * 2;
            const ey = it.drift ? it.drift.y : it.y + Math.sin(ang) * base * 2;
            ctx.globalAlpha = (1 - gk) * 0.55;
            ctx.fillStyle = i % 2 === 0 ? '#5a6ea0' : '#7a6ea0';
            ctx.beginPath();
            ctx.arc(lerp(it.x + Math.cos(ang) * r0, ex, easeOutK(gk)), lerp(it.y + Math.sin(ang) * r0, ey, easeOutK(gk)), 0.9 + hashRand(seed + i * 11.3) * 1.1, 0, TAU);
            ctx.fill();
          }
          ctx.restore();
        }
        return;
      }
      if (it.kind === 'meteor') {
        if (it.trail && it.trail.length > 1) {
          ctx.lineCap = 'round';
          for (let q2 = 1; q2 < it.trail.length; q2++) {
            const k3 = q2 / it.trail.length;
            ctx.strokeStyle = hexA('#ffe9cf', (k3 * 0.6 * it.alpha).toFixed(3));
            ctx.lineWidth = 0.5 + k3 * 1.7;
            ctx.beginPath();
            ctx.moveTo(it.trail[q2 - 1].x, it.trail[q2 - 1].y);
            ctx.lineTo(it.trail[q2].x, it.trail[q2].y);
            ctx.stroke();
          }
        }
        drawGlow(ctx, '#fff3e0', it.x, it.y, 12, it.alpha);
      }
    }
  };
}

/* 供外壳/面板复用的调色常量（HUD 卡等待用；键为生命周期/会话四态枚举）。 */
export const SKIN_D_PALETTE = Object.freeze({ prop: Object.freeze({ ...PROP }), sess: Object.freeze({ ...SESS }), gold: GOLD });

/** 兼容别名（add-cosmos-skin-themes 1.2：导出改名，旧名保留；行为与 `createSkinDeepspace` 同一引用）。 */
export const createSkinD = createSkinDeepspace;
