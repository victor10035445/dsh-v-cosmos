/**
 * cosmos 渲染引擎（自 demo/styles/assets/engine.js 移植 + 去全局化改造，
 * add-cosmos-entry 4.3 / design.md「渲染引擎」）。
 *
 * 移植保持的语义：场景加工 / 相机与透视投影 / 深度排序 / 拾取 / dive-in 补间
 * （1.3s easeInOutCubic → dist 155 / pitch 0.35；返回 1.2s）/ DOM 覆盖层
 * （星座 chip / 恒星名牌 / 信息卡 / 钻取态星座标牌 / 回到银河按钮 / toast）。
 *
 * 去全局化清单（design.md）：
 *  - `window.innerWidth/innerHeight` + `resize` → overlay 容器尺寸（ResizeObserver）；
 *  - `window.addEventListener('keydown')`（Esc/dive 逻辑）→ 收编外壳 Esc 分层，
 *    引擎只暴露 `consumeEscape()`（随 overlay 卸载自动移除，不劫持宿主快捷键）；
 *  - `document.body.appendChild` → 构造参数 `container`（overlay 根容器）；
 *  - `window.COSMOS_STYLE / MOCK_COSMOS` 全局读取 → 构造参数 `style` / `setScene`。
 *
 * 新引擎能力（demo 没有，属新增工作）：
 *  - 事件驱动流星 `spawnEventMeteor(origin)`（会话消亡 / 卫星消亡触发；
 *    demo 流星为随机环境装饰，环境调度保留）；
 *  - 成星捕获动画：彗星螺旋坠入轨道补间（planet.capture 驱动，半径倍率 3.5→1 +
 *    角速度加速），由 `markCapture(sessionId)` 在 scene 补丁时触发；
 *  - 恒星超新星转场（add-comet-states-and-star-death）：引擎级幽灵列表 `E.novae`
 *    （与场景实体解耦，`spawnEventMeteor` 同构模式），`markStarNova(id, worldPos,
 *    color, opts?)` 三段式 2.4s（白炽引爆→冲击波→坍缩归尘）；星胚 intensity 0.3
 *    走低强度消散变体（0.8s）；
 *  - 行星回归彗星反向捕获：`markRegression(sessionId, from)` 与 `E.captures`
 *    完全对称（从行星最后轨道位置 easeOutCubic 滑向游荡点 1.4s，α 前 0.5s 坡道
 *    渐入），替代「回归 = 熄灭流星」的语义错位；
 *  - 渲染节能：`start()/stop()` 显式暂停 rAF（overlay 关闭 / 页签不可见）。
 *
 * 转场编排层（add-transition-choreography）：
 *  - Phase 0 确定性渲染地基：行星/彗星轨道参数 idHash 派生（buildScenePure）、星云
 *    尘埃 per-ws 种子流 + 单位化 off + 渲染期半径缩放（rebuild 零抖动、密度增量稳定）；
 *  - 出生转场 fx `birth`（恒星淡入+微爆闪 / 星胚轮廓坡道 / 行星滑入 / 彗星游入，
 *    卫星 born 坡道）；状态色相滑移 colorMix（0.6s，风暴免疫）；executed 金涌 surge
 *    （1.2s，D4 翻案）；
 *  - 星座出入场：凝聚错峰 birth（0.15s/星）、消散幽灵 E.wsGhosts（1.5s）、钻取焦点
 *    星座消失自动 flyOut；冷启动点亮序曲（bootT0 锚定，1.2s 错峰坡道 + 事件转场
 *    入队延迟，无事件丢失）；
 *  - 最小动画调度器（D7）：P0 属性不经队列；P1 叙事并发 ≤3 + 同 ws 错峰 0.25s；
 *    P2 存在错峰 0.15s；待启动积压 >8 风暴降级（nova 渐熄淡出 / birth 缩 α 坡道），
 *    只延迟启动不打断进行中动画，积压消化阈值比较即恢复。
 *
 * 数据源从 mock 换成 providers：`setScene(scene, level)` 支持 "rebuild"（结构重建）
 * 与 "patch"（属性级就地补丁，保住尘埃粒子/尾迹/镜头焦点）。
 *
 * add-cosmos-add-workspace（工作区注册 + 集合变化滑移）：
 *  - 星座集合变化中心滑移：`captureCenterTweens`（rebuild 前捕获同 id 旧中心）→
 *    `applyCenterSlides`（新场景先置旧位、再起 0.8s easeOutCubic 补间）→ 渲染期单一
 *    访问器 `wsCenter(ws, t)`；`E.centerTweens` 为呈现层瞬态（MUST NOT 进 sceneData）。
 *  - `diveToWs(wsId)`：按 id 复用既有 dive（1300ms，同 chip 点击语义）——注册成功后
 *    客户端在这里消费 pendingDive；未命中返回 false（不抛错）。
 *  - 空星座出生高亮：`markWsBirth(wsId)` + `rebuildOverlayDom` 附加 `cos-chip-new`
 *    （~2s CSS 脉冲 forwards 渐熄，无需 JS 清理）。
 *
 * polish-cosmos-touch-nav（触屏可达性 + HUD 精简 + 计数分级）：
 *  - 输入绑 `.cos-root` 容器级（D1）：wheel 与双指捏合在一处覆盖 canvas + 全部覆盖元素
 *    （消除覆盖元素上的缩放死区）；`touch-action: none` 收敛为容器级一条规则；
 *  - 双指捏合（D2）：`E.pointers` 多指针 Map，第二指落下切 pinch（d0/dist0 → 指距比例
 *    驱动 dist），任意一指抬起结束 pinch 并重置剩指起点，全部抬起清 `E.gesture` 并记
 *    `E.gestureEndAt`；多指期间与结束后 `GESTURE_SUPPRESS_MS` 内的 click/抬指不拾取；
 *  - 目标过滤与捕获策略（D2）：覆盖元素起指不 `setPointerCapture`、抬指不拾取——
 *    保护 chip click（dive 只由自身 click 触发一次）；
 *  - HUD 精简（D5）：删面包屑与右上操作提示；左上改为钻取态星座标牌 `.cos-badge`
 *    （星座名 + 全量计数仪表，沿用旧 crumb 的 `dataset.html` 内容差分守卫）；
 *  - 右下常驻「回到银河」`.cos-home-btn`（D3）：钻取态 = flyOut()，银河根级 = 仅清选中。
 */

/* 引擎 DOM 的样式（自 demo style-d-hud-galaxy.html 移植；扫描线/虚线框/金色角标
   等参数不变）。由浏览器半区随插件样式一次性注入。 */
export const ENGINE_CSS = `
.cos-root { position: absolute; inset: 0; overflow: hidden; font-family: "Segoe UI", system-ui, -apple-system, "Microsoft YaHei", sans-serif; color: #ffe9cf;
  user-select: none; -webkit-user-select: none;
  touch-action: none; /* 容器级唯一一条（D2）：touch-action 沿祖先链取交集，对 canvas、
    全部覆盖元素与未来元素同时生效——逐覆盖元素枚举正是 design D1 批判的脆弱模式。 */ }
.cos-canvas { position: absolute; inset: 0; }
.cos-overlay { position: absolute; inset: 0; pointer-events: none; z-index: 10; }
.cos-scanlines { position: absolute; inset: 0; pointer-events: none; z-index: 5;
  background: repeating-linear-gradient(0deg, rgba(255,230,190,.02) 0 1px, transparent 1px 3px); }
/* 左上星座标牌（HUD 精简后取代面包屑；D4/3.1）：钻取态显示星座名 + 全量计数仪表。
   纯信息元素 → pointer-events: none（MUST NOT 在左上角形成点击死区）；限宽避免与
   中央搜索带重叠（spec「标牌位置 MUST NOT 与搜索框重叠」）：
   搜索带 = min(320px, 34vw) 居中 → 其左缘 = 50% - min(160px, 17vw)；
   标牌右缘 = 16px + max-width，取 min(320px, 50% - 160px) 时在 ≥330px 视口内恒不侵占。 */
.cos-badge { position: absolute; top: 14px; left: 16px; max-width: min(320px, calc(50% - 160px));
  font-size: 13px; color: #ffe3b8; letter-spacing: .5px; pointer-events: none; z-index: 20;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cos-badge b { display: block; font-size: 13px; font-weight: 600; letter-spacing: 1px; text-shadow: 0 0 8px rgba(255,210,140,.55); }
.cos-badge span { display: block; margin-top: 2px; font-size: 10px; letter-spacing: 2px; opacity: .6; }
/* 右下常驻「回到银河」方形按钮（D3/4.1）：风格 D HUD 语言（暖金描边 + 角标），
   触屏点击目标 44px ≥ 40px；钻取态与银河根级均常驻（两态语义见 flyOut 早退分支）。 */
.cos-home-btn { position: absolute; right: 16px; bottom: 16px; z-index: 20; box-sizing: border-box;
  width: 44px; height: 44px; padding: 0; display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; color: #ffe3b8; background: rgba(8,8,16,.72); border: 1px solid rgba(255,210,140,.35);
  font-family: inherit; pointer-events: auto; }
.cos-home-btn::before, .cos-home-btn::after { content: ''; position: absolute; width: 8px; height: 8px; pointer-events: none; }
.cos-home-btn::before { top: -1px; left: -1px; border-top: 2px solid #ffd28a; border-left: 2px solid #ffd28a; }
.cos-home-btn::after { bottom: -1px; right: -1px; border-bottom: 2px solid #ffd28a; border-right: 2px solid #ffd28a; }
.cos-home-btn:hover { border-color: rgba(255,210,140,.85); background: rgba(255,210,140,.12); }
.cos-home-btn:focus-visible { outline: 1px solid rgba(255,210,140,.85); outline-offset: 2px; }
.cos-home-btn svg { display: block; width: 22px; height: 22px; }
.cos-chip { position: absolute; left: 0; top: 0; text-align: center; pointer-events: auto; cursor: pointer; opacity: 0; transition: opacity .25s; will-change: transform;
  color: #ffe3b8; padding: 4px 12px; border: 1px dashed rgba(255,210,140,.4); background: rgba(10,10,20,.45); }
.cos-chip.on { opacity: 1; }
.cos-chip b { display: block; font-size: 13px; font-weight: 600; letter-spacing: 1px; text-shadow: 0 0 8px rgba(255,210,140,.55); }
.cos-chip span { font-size: 10px; opacity: .6; letter-spacing: 2px; }
.cos-chip:hover { border-color: rgba(255,210,140,.85); }
/* 空星座出生高亮（add-cosmos-add-workspace D6/3.2）：~2s 脉冲后渐熄（WS_BIRTH_HL_DUR 同步）。
   发光参数对照风格 D 基线（demo/styles/assets/style-d.js glowSprite：内 rgba(255,210,140,.95)
   / 外 rgba(255,210,140,.22)）。animation forwards → 动画结束即常态，无需 JS 清理；
   只动 border/box-shadow/text-shadow，MUST NOT 动 transform（chip 定位由引擎逐帧写 transform）。 */
.cos-chip.cos-chip-new { animation: cos-chip-birth 2s ease-out forwards; }
.cos-chip.cos-chip-new b { animation: cos-chip-birth-text 2s ease-out forwards; }
@keyframes cos-chip-birth {
  0% { border-color: rgba(255,210,140,.4); box-shadow: 0 0 0 rgba(255,210,140,0); }
  12% { border-color: rgba(255,210,140,.95); box-shadow: 0 0 22px rgba(255,210,140,.45), inset 0 0 14px rgba(255,210,140,.18); }
  45% { border-color: rgba(255,210,140,.6); box-shadow: 0 0 12px rgba(255,210,140,.22); }
  100% { border-color: rgba(255,210,140,.4); box-shadow: 0 0 0 rgba(255,210,140,0); }
}
@keyframes cos-chip-birth-text {
  0% { text-shadow: 0 0 8px rgba(255,210,140,.55); }
  12% { text-shadow: 0 0 18px rgba(255,210,140,.95), 0 0 6px rgba(255,240,210,.8); }
  100% { text-shadow: 0 0 8px rgba(255,210,140,.55); }
}
.cos-slab { position: absolute; left: 0; top: 0; font-size: 11px; white-space: nowrap; color: rgba(255,233,207,.8); letter-spacing: .5px;
  opacity: 0; transition: opacity .2s; pointer-events: none; will-change: transform; text-shadow: 0 0 6px rgba(255,210,140,.4); }
.cos-slab.on { opacity: 1; }
.cos-card { position: absolute; left: 0; top: 0; min-width: 230px; max-width: 280px; padding: 12px 14px; font-size: 12px;
  background: rgba(8,8,16,.88); border: 1px solid rgba(255,210,140,.35); opacity: 0; transition: opacity .15s; pointer-events: none; will-change: transform; }
.cos-card.on { opacity: 1; pointer-events: auto; }
.cos-card::before, .cos-card::after { content: ''; position: absolute; width: 10px; height: 10px; }
.cos-card::before { top: -1px; left: -1px; border-top: 2px solid #ffd28a; border-left: 2px solid #ffd28a; }
.cos-card::after { bottom: -1px; right: -1px; border-bottom: 2px solid #ffd28a; border-right: 2px solid #ffd28a; }
.cd-title { font-size: 13px; font-weight: 600; margin-bottom: 8px; color: #fff3dd; }
.cd-grid { display: grid; grid-template-columns: auto 1fr; gap: 4px 14px; }
.cd-grid span { opacity: .55; }
.cd-grid b { font-weight: 500; }
.cd-btn { margin-top: 10px; padding: 5px 12px; font-size: 12px; cursor: pointer; color: #ffe3b8;
  background: rgba(255,210,140,.08); border: 1px solid rgba(255,210,140,.5); }
.cd-btn:hover { background: rgba(255,210,140,.2); }
.cos-empty { position: absolute; left: 50%; top: 44%; transform: translate(-50%,-50%); text-align: center; font-size: 13px;
  color: rgba(255,233,207,.55); letter-spacing: 2px; z-index: 20; pointer-events: none; }
.cos-empty b { display: block; font-size: 16px; margin-bottom: 8px; color: rgba(255,227,184,.8); }
.cos-toast { position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%); padding: 8px 14px; font-size: 12px;
  background: rgba(8,8,16,.92); border: 1px solid rgba(255,210,140,.5); color: #ffe3b8; opacity: 0; transition: opacity .2s; pointer-events: none; z-index: 30; }
.cos-toast.on { opacity: 1; }
`;

import { relativeTime } from "../merge.mjs";

const TAU = Math.PI * 2;

/* ---------- 小工具 ---------- */
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function easeC(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
function rotY(p, a) { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c]; }
function rotX(p, a) { const c = Math.cos(a), s = Math.sin(a); return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c]; }
function rotZ(p, a) { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]]; }
function midOf(pts) {
  let x = 0, y = 0, z = 0;
  const n = pts.length || 1;
  for (const pt of pts) { x += pt[0]; y += pt[1]; z += pt[2]; }
  return [x / n, y / n, z / n];
}
function lerpV(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
function easeOutCubic(k) { k = clamp(k, 0, 1); return 1 - Math.pow(1 - k, 3); }
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

/* 状态标签（add-celestial-states 4.5 扩表；恒星三态 status 退役 → 生命周期四态）。 */
const LIFECYCLE_LABEL = { proto: '待创建', created: '已创建', reviewed: '已审核', executed: '已执行' };
const STATE_LABEL = { idle: '待机中', busy: '执行中', waiting: '待决策', 'done-unread': '完成未读' };
/** 待决策 pendingInteraction.kind 子类文案（v1 统一琥珀视觉，子类只进信息卡）。 */
const PLAN_KIND_LABEL = { approval: '审批', 'plan-review': '方案审查', question: '提问' };

/** 转场时长（demo/states FX 已验证参数：点燃 2.2s / 落印 1.6s / 查看渐熄 2.2s×0.72 渐变段）；
    add-transition-choreography 扩 birth（实体出生，kind 级时长见 FX_BIRTH_DUR）与
    surge（executed 金涌，1.2s——D4 翻案 add-celestial-states「executed 无独立转场」）。 */
const FX_DUR = { ignite: 2.2, stamp: 1.6, view: 2.2, birth: 0.6, surge: 1.2 };

/** birth kind 级时长（design D2 表）：star/proto 0.6s / planet 0.6s / comet 0.8s（游入，尾迹先现）。 */
const FX_BIRTH_DUR = { star: 0.6, planet: 0.6, comet: 0.8 };

/** 超新星转场总时长（三段式约 2.4s，与点燃转场同量级）与星胚消散变体时长（0.8s）。 */
export const FX_NOVA_DUR = 2.4;
export const FX_NOVA_PROTO_DUR = 0.8;

/** 回归反向捕获补间时长（与 E.captures 螺旋坠入 1.4s 完全对称）；α 坡道 0.5s。 */
const REGRESS_DUR = 1.4;
const REGRESS_ALPHA_RAMP = 0.5;

/* ---------- 转场编排常量（add-transition-choreography；初值，spec 不锁数值，集中便于真机调参） ---------- */

/** 尘埃增量渐入（1.2：born α 坡道 0.8s）/ 卫星出生坡道（2.2：0.5s）/ 状态色相滑移（3.1：0.6s）/
    星座消散幽灵（5.1：1.5s）/ 冷启动序曲窗口（6.1：1.2s，ws 错峰 0.1s、单 ws 坡道 0.5s）/
    连线段淡入淡出（8.1：0.4s）。 */
const DUST_BORN_FADE = 0.8;
const SAT_BORN_DUR = 0.5;
export const COLOR_MIX_DUR = 0.6;
const WS_GHOST_DUR = 1.5;
export const BOOT_DUR = 1.2;
const BOOT_WS_STAGGER = 0.1;
const BOOT_WS_RAMP = 0.5;
const LINK_FADE_DUR = 0.4;

/** 调度器优先级（D7）：P0 注意力属性不经队列不降级；P1 叙事并发 ≤3 + 同 ws 错峰 0.25s；
    P2 存在错峰 0.15s；P3 微脉动保留未实现。 */
export const FX_PRIORITY = Object.freeze({ attention: 0, narrative: 1, existence: 2 });
const FXQ = {
  CONCURRENCY_P1: 3,
  STAGGER_P1: 0.25,
  STAGGER_P2: 0.15,
  STORM_BACKLOG: 8 // 待启动积压阈值：>8 → 风暴降级；≤8 阈值比较即自动恢复
};
/** 各类型转场的「进行中」时长（P1 并发上限计数窗口）。 */
const FX_ACTIVE_DUR = {
  nova: FX_NOVA_DUR, ignite: 2.2, stamp: 1.6, view: 2.2, surge: 1.2,
  wsghost: WS_GHOST_DUR, capture: 1.4, regression: REGRESS_DUR, birth: 0.8
};

/* ---------- 搜索过滤（add-cosmos-search-filter 2.2–2.5；初值，spec 不锁数值） ---------- */

/** 过滤 α 淡隐/重显坡道（D7：0.35s easeOutCubic）。 */
export const FILTER_RAMP_DUR = 0.35;
/** 星座位移补间时长（D7：0.7s easeInOutCubic，retarget 打断式续接）。 */
export const FILTER_SHIFT_DUR = 0.7;
/** 重排错峰（D7：0.05s × 规范序；仅新启动的补间错峰，续接不重播延迟）。 */
export const FILTER_SHIFT_STAGGER = 0.05;
/** camera-fit 补间时长（D7：0.8s easeInOutCubic，重定向续接）。 */
export const FILTER_FIT_DUR = 0.8;
/** camera-fit 包围球半径裕量（世界单位：单星座视域留白）。 */
export const FILTER_FIT_MARGIN = 60;
/** 视锥填充系数（投影既有取景口径 f = H*1.1/2tan(fov/2)；1.1 使球面留白一致）。 */
const FILTER_FIT_FILL = 1.1;
/** dist 值域（与滚轮一致：stepTween 直赋 dist，不经过 wheel 的 clamp）。 */
const DIST_MIN = 24;
const DIST_MAX = 4200;
/** α 目标比较阈值（差值小于此值视为一致，不重锚坡道）。 */
const FILTER_ALPHA_EPS = 1e-4;

/* ---------- 触屏手势（polish-cosmos-touch-nav D2） ---------- */

/** 手势结束后 click 抑制窗（ms）：click 在 pointerup 之后才派发，时间窗兜住
    「捏合刚结束就到的 click」——手游/地图类惯例值，集中定义便于调参。 */
export const GESTURE_SUPPRESS_MS = 350;

/** 右下「回到银河」按钮图标（迷你星系：三条同心椭圆轨道 + 中心点；与风格 D 侧栏
    座位星图同源语义，但引擎模块独立自持字符串——不引 client.jsx 常量）。 */
const HOME_ICON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.1" aria-hidden="true">' +
  '<ellipse cx="12" cy="12" rx="9.4" ry="4.1" opacity=".8"/>' +
  '<ellipse cx="12" cy="12" rx="9.4" ry="4.1" transform="rotate(60 12 12)" opacity=".55"/>' +
  '<ellipse cx="12" cy="12" rx="9.4" ry="4.1" transform="rotate(120 12 12)" opacity=".55"/>' +
  '<circle cx="12" cy="12" r="2.1" fill="currentColor" stroke="none"/>' +
  '</svg>';

/* ---------- 星座集合变化中心滑移（add-cosmos-add-workspace D5 / req 星座集合变化位置滑移） ---------- */

/** 中心滑移补间时长（D5：约 0.8s easeOutCubic）。呈现层瞬态：终态 = buildScene 确定性
    摆位原样，不参与 sceneData/`sceneDiffLevel` 判级（重建零抖动断言对象仍是 scene JSON）。 */
export const WS_SHIFT_DUR = 0.8;
/** 空星座 chip 出生高亮时长（D6：约 2s 脉冲后渐熄；ENGINE_CSS 的 animation 时长与此同步）。 */
export const WS_BIRTH_HL_DUR = 2;

/** 32 位 FNV-1a（卫星相位/速度确定性派生；merge hash32 同源算法）。 */
function idHash(text) {
  let h = 0x811c9dc5;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/* ---------- WASD 相机平移（纯函数，导出供冒烟直测） ---------- */

/** 平移键集合（e.code → 小写字母；bindInput 侧过滤修饰键/可编辑焦点）。 */
const PAN_KEYS = Object.freeze(["w", "a", "s", "d"]);

/** 基础平移速度（世界单位/秒，**固定值不随缩放距离缩放**——真机反馈：放大到
    星座尺度后移动步长跟着变小，失去参考系）。 */
export const PAN_SPEED = 120;
/** Shift 加速倍率（缩放很远后跨星座长途移动用）。 */
export const PAN_SHIFT_BOOST = 3;

/**
 * 按键帧积分平移相机 target（纯函数，帧率无关）：
 *  - W/S = 视图平面上/下，A/D = 视图平面左/右——方向向量随 yaw/pitch 旋转
 *    （视图变换 v = rotX(rotY(p, -yaw), -pitch) 的逆旋转）；
 *  - 速度恒定（tuning.speed，Shift ×tuning.boost），**与缩放距离无关**；
 *    tuning 缺省 = 出厂常量（PAN_SPEED / PAN_SHIFT_BOOST）；
 *  - 有位移时返回 true（调用方据此打断 dive-in/飞回补间——手动控制优先）。
 *
 * @param {{ target: number[], yaw: number, pitch: number, dist: number }} cam
 * @param {Set<string>} keys 当前按住的平移键（"w"/"a"/"s"/"d"/"shift"）
 * @param {number} dt 帧间隔秒
 * @param {{ speed?: number, boost?: number }} [tuning] 可配置平移速度/加速倍率
 * @returns {boolean} 是否发生了位移
 */
export function panCameraTarget(cam, keys, dt, tuning) {
  if (!cam || !keys || !(dt > 0)) return false;
  let forward = 0; // W(+1) / S(-1)：视图平面上/下
  let strafe = 0; // D(+1) / A(-1)：视图平面右/左
  if (keys.has("w")) forward += 1;
  if (keys.has("s")) forward -= 1;
  if (keys.has("d")) strafe += 1;
  if (keys.has("a")) strafe -= 1;
  if (forward === 0 && strafe === 0) return false;
  const speed =
    (Number(tuning?.speed) > 0 ? tuning.speed : PAN_SPEED) *
    (keys.has("shift") ? (Number(tuning?.boost) > 0 ? tuning.boost : PAN_SHIFT_BOOST) : 1) *
    dt;
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  /* 视图平面右向量（世界系）与屏面上向量（世界系） */
  const rx = cy, rz = -sy;
  const ux = sp * sy, uy = cp, uz = sp * cy;
  const t = cam.target;
  t[0] += (rx * strafe + ux * forward) * speed;
  t[1] += uy * forward * speed;
  t[2] += (rz * strafe + uz * forward) * speed;
  return true;
}

/**
 * nova 幽灵条目工厂（纯函数，导出供冒烟直测；`markStarNova` 消费）：
 *  - `p0`/`driftTo` 均为标记时定格的世界坐标快照（绘制期逐帧投影，不做实时查询）；
 *  - `intensity` ≥0.5 = 常规三段式超新星（2.4s）；<0.5 = 星胚低强度消散变体（0.8s），
 *    走同一列表与同一绘制路径的强度参数（不开第二条代码路径）。
 *
 * @param {string} id 天体 id（皮肤侧确定性参数种子）
 * @param {number[]} p0 恒星原位世界坐标
 * @param {string} color 恒星临终生命周期色（皮肤向白炽偏移）
 * @param {{intensity?: number, driftTo?: number[]}|null} [opts]
 * @param {number} now 标记时刻（引擎 E.t）
 * @returns {{id: string, p0: number[], color: string, driftTo: number[]|null, intensity: number, t0: number, dur: number, k: number}}
 */
export function makeNova(id, p0, color, opts, now) {
  const intensity = Number(opts?.intensity) > 0 ? opts.intensity : 1;
  return {
    id: id == null ? "__nova" : id,
    p0: Array.isArray(p0) ? p0.slice() : [0, 0, 0],
    color: typeof color === "string" && color ? color : "#ffffff",
    driftTo: Array.isArray(opts?.driftTo) ? opts.driftTo.slice() : null,
    intensity,
    degraded: opts?.degraded === true, // 风暴降级最小形态（7.2：渐熄淡出，skin-d 分支消费）
    t0: now,
    dur: intensity < 0.5 ? FX_NOVA_PROTO_DUR : FX_NOVA_DUR,
    k: 0
  };
}

/**
 * nova 步进（纯函数，导出供冒烟直测；`updateScene` 每帧消费）：
 * k 随 t 推进（无状态推进——E.t 渲染暂停期冻结 → 页签隐藏断点续播），
 * k≥1 过期即摘，返回存活条目（原地写 k，调用方以返回值替换列表）。
 *
 * @param {Array<ReturnType<makeNova>>} novae
 * @param {number} t 引擎时基
 * @returns {Array} 存活条目
 */
export function stepNovae(novae, t) {
  const keep = [];
  for (const n of Array.isArray(novae) ? novae : []) {
    n.k = clamp((t - n.t0) / n.dur, 0, 1);
    if (n.k < 1) keep.push(n);
  }
  return keep;
}

/* ---------- 搜索过滤纯函数（add-cosmos-search-filter 2.5/2.8；导出供冒烟直测） ---------- */

/**
 * 可编辑焦点判定（2.8 导出：引擎键盘劫持守卫，供冒烟断言防回归）：
 * 焦点落在宿主输入框/文本域/选择框/contenteditable 时 SHALL NOT 劫持 WASD 等按键
 * （React 搜索框聚焦时字符进输入框、相机不平移）。
 * @param {object|null} el document.activeElement
 * @returns {boolean}
 */
export function isEditableTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
}

/**
 * 匹配集合包围球（纯函数，2.5 导出供冒烟直测）：AABB 球心 + 最远点半径 + 半径裕量。
 * 「以原点为球心收敛」的子集布局（merge.filteredPositions）使球心接近原点；
 * 半径 = 各目标位到球心的最大距离 + margin（单命中 → radius = margin）。
 * @param {Array<number[]>} points 世界坐标点集
 * @param {number} [margin] 半径裕量（世界单位）
 * @returns {{center: number[], radius: number}|null} 无有效点 → null
 */
export function boundingSphereOf(points, margin = 0) {
  const pts = (Array.isArray(points) ? points : []).filter(function (p) {
    return Array.isArray(p) && p.length === 3 && p.every(function (v) { return Number.isFinite(Number(v)); });
  });
  if (pts.length === 0) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of pts) {
    const x = Number(p[0]), y = Number(p[1]), z = Number(p[2]);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const center = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  let radius = 0;
  for (const p of pts) {
    radius = Math.max(radius, Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2]));
  }
  const m = Number.isFinite(Number(margin)) ? Math.max(0, Number(margin)) : 0;
  return { center, radius: radius + m };
}

/**
 * camera-fit 取景参数（纯函数，2.5 导出供冒烟直测）：
 * `target` = 包围球心；`dist` = 半径 / tan(fov/2) × 填充系数，clamp 到滚轮值域
 * `[24, 4200]`（stepTween 直赋 dist，不经过 wheel 的 clamp）；yaw/pitch 由调用方保持。
 * @param {Array<number[]>} points 匹配集合目标位
 * @param {number} [fov] 垂直视场角（度，引擎 cam.fov）
 * @param {number} [margin] 包围球半径裕量
 * @returns {{target: number[], dist: number, radius: number}|null}
 */
export function fitCameraOf(points, fov = 60, margin = FILTER_FIT_MARGIN) {
  const sphere = boundingSphereOf(points, margin);
  if (!sphere) return null;
  const angle = Number(fov) > 0 ? Number(fov) : 60;
  const dist = clamp(sphere.radius / Math.tan(angle * Math.PI / 360) * FILTER_FIT_FILL, DIST_MIN, DIST_MAX);
  return { target: sphere.center, dist, radius: sphere.radius };
}

/**
 * 场景构建纯函数（add-transition-choreography 1.3 可测性导出；引擎 `buildScene` 薄封装）。
 *
 * 确定性渲染地基（D1）：
 *  - 行星 phase/speed/inc 与彗星 phase 由 `idHash(id)` 哈希切片派生（`makeSatBodies`
 *    既有模式推广；速度倍率区间保持原分布 0.8–1.2×）——共享 `rng` 流不再被天体随机量
 *    消费，恒星增删不再重掷全场景；
 *  - 星云尘埃 per-ws 种子流 `rng(idHash(ws.id))` 固定顺序生成（每粒 6 次取数序不变：
 *    off×3 + s + hue + tw）→ 密度 N→N+1 时前 N 粒逐位相同、仅尾部追加；
 *  - 尘埃 off 存单位化量（[-1,1]，y 分量带 0.38 扁率），星云半径 R = 12 + archives×2.4
 *    只在渲染期乘（buildItems）——半径增长不位移存量粒子；
 *  - `ws.dustCount` 记录已入册粒子数（ws 对象字段，新 ws 从 0 起，免 Map 与清理）；
 *  - 背景星/银河带消费固定长度共享流（420/2600），跨 rebuild 逐位稳定。
 *
 * @param {object|null} sceneData providers 合并 scene
 * @param {Map<string, number>} captures 成星捕获补间（sessionId → t0）
 * @param {Map<string, {t0: number, from: number[]}>} regressions 回归补间（sessionId → entry）
 * @returns {object} 构建场景（逐位确定：同数据两次构建 deepEqual）
 */
export function buildScenePure(sceneData, captures, regressions) {
  const capMap = captures instanceof Map ? captures : new Map();
  const regMap = regressions instanceof Map ? regressions : new Map();
  const rand = rng(20261108); // 仅背景星/银河带消费（固定长度 → 分布跨 rebuild 稳定）
  const scene = { ws: [] };
  const workspaces = Array.isArray(sceneData?.workspaces) ? sceneData.workspaces : [];
  workspaces.forEach(function (w) {
    const ws = {
      id: w.id, name: w.name,
      center: (w.pos || [0, 0, 0]).slice(),
      stars: [], planets: [], comets: [],
      links: (w.links || []).slice(),
      archives: w.archives || 0,
      dust: [], dustCount: 0, // 已入册尘埃粒子数（增量 born 判定基线；patch 重生成时沿用）
      alpha: 1, vis: true, proj: null
    };
    (w.stars || []).forEach(function (st, i) {
      /* off 补存（add-cosmos-search-filter 2.1）：位置补间（filter）帧内重算
         wp = center + off 需要偏移随 body 走；wp 烘焙逻辑与输出逐位不变。 */
      const off = Array.isArray(st.off) ? st.off : [0, 0, 0];
      ws.stars.push({
        id: st.id, name: st.name,
        lifecycle: st.lifecycle || 'created', setBy: st.setBy ?? null, at: st.at ?? null,
        tasks: st.tasks, age: st.age, act: st.act || 0, starIndex: i,
        off: [off[0], off[1], off[2]],
        wp: [ws.center[0] + off[0], ws.center[1] + off[1], ws.center[2] + off[2]]
      });
    });
    (w.planets || []).forEach(function (pl) {
      const stars = ws.stars.filter(function (s) { return pl.stars && pl.stars.indexOf(s.id) >= 0; });
      const isBin = stars.length > 1;
      const c = isBin ? midOf(stars.map(function (s) { return s.wp; })) : (stars[0] ? stars[0].wp : ws.center);
      const r = isBin ? 30 : 16;
      const capture = capMap.get(pl.id);
      /* 轨道参数 id 派生（哈希切片均匀量；与卫星 makeSatBodies 同源模式） */
      const seed = idHash(pl.id);
      ws.planets.push({
        id: pl.id, title: pl.title, state: pl.state,
        pendingKind: pl.pendingKind ?? null,
        delegatedBusy: pl.delegatedBusy === true,
        satelliteCount: pl.satelliteCount || 0,
        stars: stars, todos: pl.todos, when: pl.when,
        center: c, r: r, baseR: r,
        speed: (isBin ? 0.26 : 0.5) * (0.8 + ((seed >>> 8) / 16777216) * 0.4),
        phase: (seed / 4294967296) * TAU,
        inc: (((seed >>> 16) / 65536) - 0.5) * 0.7,
        colorMix: null, // 状态色相滑移（D3，patch 路径检测变更沿挂载）
        sats: makeSatBodiesPure(pl.satellites),
        wp: c.slice(), trail: [], acc: 0,
        captureStart: typeof capture === "number" ? capture : null
      });
    });
    (w.comets || []).forEach(function (cm) {
      /* 回归补间挂接：markRegression 先于 setScene（客户端差分环内调用，时序约束）
         → build 时从 regressions 读取快照；无回归 → from null 走纯游荡方程。 */
      const regression = regMap.get(cm.id);
      ws.comets.push({
        id: cm.id, title: cm.title, when: cm.when,
        state: cm.state, pendingKind: cm.pendingKind ?? null,
        delegatedBusy: cm.delegatedBusy === true,
        satelliteCount: cm.satelliteCount || 0,
        sats: makeSatBodiesPure(cm.satellites),
        phase: (idHash(cm.id) / 4294967296) * TAU, // 游泊相位 id 派生（D1）
        colorMix: null,
        wp: ws.center.slice(), trail: [], acc: 0,
        from: regression ? regression.from.slice() : null,
        regressStart: regression ? regression.t0 : null,
        regressAlpha: regression ? 0 : 1
      });
    });
    ws.satelliteCount = w.satelliteCount || 0; // 星座 ◇（subagent 会话总数，含折叠）
    if (ws.archives > 0) {
      const nDust = Math.min(ws.archives * 55, 520);
      const drand = rng(idHash(ws.id)); // per-ws 种子流：前 N 粒随机量与粒子顺序逐位稳定
      for (let i = 0; i < nDust; i++) {
        ws.dust.push({
          off: [drand() * 2 - 1, (drand() * 2 - 1) * 0.38, drand() * 2 - 1], // 单位化量（R 渲染期乘）
          s: 0.5 + drand() * 1.6, hue: drand(), tw: drand() * TAU,
          born: null // rebuild 路径不标 born（增量渐入只在 patch 重生成路径发生）
        });
      }
      ws.dustCount = nDust;
    }
    scene.ws.push(ws);
  });

  // 背景星(大球面) + 银河带(扁平环带, 预倾斜——风格 D 专用)
  const bg = [];
  for (let i = 0; i < 420; i++) {
    const u = rand() * 2 - 1, th = rand() * TAU, rr = Math.sqrt(1 - u * u);
    bg.push({ p: [rr * Math.cos(th) * 1500, u * 1500, rr * Math.sin(th) * 1500], m: rand() });
  }
  const band = [];
  for (let j = 0; j < 2600; j++) {
    const a = rand() * TAU, r2 = 220 + rand() * 1300;
    const yy = (rand() - 0.5) * (90 + r2 * 0.05);
    let p = [Math.cos(a) * r2, yy, Math.sin(a) * r2];
    p = rotX(p, 0.45); p = rotZ(p, 0.35);
    band.push({ p: p, m: rand() });
  }
  scene.bg = bg; scene.band = band;
  return scene;
}

/** 卫星 body 装配（纯函数版，buildScenePure 消费；born 恒 null——出生坡道只在
    patch 路径 reconcileSatBodies 新建 body 时标记，rebuild 不重播）。 */
function makeSatBodiesPure(satList) {
  return (Array.isArray(satList) ? satList : []).map(function (sat) {
    const seed = idHash(sat.id);
    return {
      id: sat.id, state: sat.state, title: sat.title,
      phase: (seed / 4294967296) * TAU,
      speed: 1.2 + ((seed >>> 8) / 16777216) * 1.2,
      wp: null, trail: [], acc: 0,
      born: null, colorMix: null
    };
  });
}

/**
 * 创建引擎实例。
 * @param {object} opts
 * @param {HTMLElement} opts.container overlay 根容器（Canvas 与 DOM 覆盖层挂载点）
 * @param {object} opts.style 风格皮肤（skin-d 模块产出；palette/background/drawBody）
 * @param {() => boolean} [opts.consumeEscape] 外壳分层钩子占位（保留形状；实际消费走 consumeEscape）
 * @param {(sessionId: string) => void} [opts.onOpenSession] 信息卡「打开会话」回调
 */
export function createCosmosEngine(opts) {
  if (!opts?.container) throw new TypeError("createCosmosEngine: container required");
  const E = {
    container: opts.container,
    style: opts.style,
    onOpenSession: typeof opts.onOpenSession === "function" ? opts.onOpenSession : null,
    cam: { target: [0, 0, 0], yaw: -0.7, pitch: 0.5, dist: 430, fov: 60 },
    tween: null,
    focusWs: null, focusMix: 0, diveSel: null,
    diveFrom: null, // dive 前的完整镜头快照（Esc 全量回放，平移/缩放语义配套）
    hovered: null, selected: null,
    meteor: null, nextMeteor: 3.2,
    eventMeteors: [],
    captures: new Map(), // sessionId → t0（成星捕获补间）
    regressions: new Map(), // sessionId → {t0, from}（行星回归彗星反向捕获补间，captures 镜像）
    novae: [], // 超新星幽灵条目（引擎级瞬态，与场景实体解耦——归档帧恒星已不在场景）
    wsGhosts: [], // 星座消散幽灵（D5）：引擎快照尘埃 offsets + 恒星位置/色，外扩飘散 1.5s 自灭
    fx: new Map(), // 'star:<id>' / 'planet:<id>' → {type, t0, dur, degraded?}（点燃/落印/查看渐熄/出生/金涌转场）
    fxQueue: [], // 延迟启动队列（D7）：{priority, wsId, fire(), enqueueAt, delay, bootUntil, activeDur}
    fxActive: [], // 已启动转场进行窗口（P1 并发上限计数；startedAt + activeDur）
    fxLastStart: new Map(), // "priority|wsId" → 上次同 ws 启动时刻（错峰步长基线）
    fxStorm: false, // 风暴降级开关（待启动积压 > 8 时 true，阈值比较即自动恢复）
    linkMix: new Map(), // wsId → Map("aId|bId" → {t0, dir:'in'|'out', pA?, pB?})（D8 连线段淡入淡出，跨 rebuild 键控恒星 id 对）
    filter: null, // 搜索过滤态（2.2）：null = 关闭 | {matched: Set<wsId>, pos: Map<wsId,[x,y,z]>}
    filterRamp: new Map(), // wsId → {from, to, t0}（α 坡道；**引擎级**：跨 rebuild 存活，MUST NOT 挂 ws body）
    filterFitPending: false, // 「过滤排除」flyOut 收尾补 fit 标志（2.5/D3）
    lastFilterFit: null, // 最近一次 camera-fit 参数快照（观测面）
    centerTweens: new Map(), // wsId → {from, to, t0}（星座集合变化中心滑移捕获；D5/2.1，呈现层瞬态）
    wsBirth: new Map(), // wsId → t0（空星座 chip 出生高亮标记；D6/3.2，CSS 2s 渐熄后自动常态）
    bootT0: null, // 冷启动点亮序曲锚点（首帧场景注入 / start 场景已在；null = 未锚定不启用序曲）
    px: -1, py: -1, pointerIn: false, dragging: false,
    pointers: new Map(), // pointerId → {x, y}（多指针追踪：pinch 基准指距与剩指重置，D2）
    gesture: false, // 多指手势激活中（pointerup 拾取 / chip click 抑制依据）
    pinch: null, // {d0, dist0}：捏合基准指距与基准镜头距离（张开 = 放大）
    gestureEndAt: -Infinity, // 手势结束时刻（GESTURE_SUPPRESS_MS 抑制窗起点）
    diveCount: 0, // dive() 调用计数（观测面：容器级重绑「单次 dive」防回归断言）
    panKeys: new Set(), // WASD 按住集合（keydown/keyup 维护，帧循环积分）
    keyListeners: null, // window 键盘监听句柄（dispose 卸载）
    tuning: {
      speed: Number(opts.settings?.panSpeed) > 0 ? opts.settings.panSpeed : PAN_SPEED,
      boost: Number(opts.settings?.panShiftBoost) > 0 ? opts.settings.panShiftBoost : PAN_SHIFT_BOOST
    }, // 可配置平移速度（settings.mjs 装载；setTuning 热更新）
    W: 0, H: 0, dpr: 1,
    sceneData: null, // providers 合并 scene（mock 同构）
    scene: null, ctx: null,
    picks: [], screens: {},
    el: {}, chips: {}, slabs: {},
    t: 0, lastTs: 0, raf: 0, running: false, disposed: false,
    resizeObserver: null
  };

  function entKey(e) { return e.kind + ':' + e.data.id; }

  /** 卫星 body 装配（确定性相位/速度由 id 哈希派生——patch 替换不跳变）。
      born 恒 null：出生坡道只在 reconcileSatBodies 新建 body（patch 路径）标记，
      rebuild 不重播（2.2）。 */
  function makeSatBodies(satList) {
    return (Array.isArray(satList) ? satList : []).map(function (sat) {
      const seed = idHash(sat.id);
      return {
        id: sat.id, state: sat.state, title: sat.title,
        phase: (seed / 4294967296) * TAU,
        speed: 1.2 + ((seed >>> 8) / 16777216) * 1.2,
        wp: null, trail: [], acc: 0,
        born: null, colorMix: null
      };
    });
  }

  /** 卫星数组就地替换（属性补丁路径）：仍在册的 body 保留 trail/相位只更属性；
      state 沿 → colorMix（D3 色相滑移）；新建 body 打 born = E.t（卫星出生坡道）。 */
  function reconcileSatBodies(oldBodies, satList) {
    const next = Array.isArray(satList) ? satList : [];
    const byId = new Map((Array.isArray(oldBodies) ? oldBodies : []).map(function (b) { return [b.id, b]; }));
    return next.map(function (sat) {
      const old = byId.get(sat.id);
      if (old) {
        if (old.state !== sat.state) old.colorMix = { from: old.state, to: sat.state, t0: E.t, dur: COLOR_MIX_DUR };
        old.state = sat.state; old.title = sat.title;
        return old;
      }
      const body = makeSatBodies([sat])[0];
      body.born = E.t;
      return body;
    });
  }

  /** 卫星子轨道半径（demo satdemo 公式：pr×2+17；彗星无 baseR → 固定值）。 */
  function satOrbitR(owner) { return (Number(owner.baseR) > 0 ? owner.baseR * 2 + 17 : 24); }

  /* ---------- 场景加工 ---------- */

  /** buildScenePure 薄封装（补间 Map 注入；场景构建已导出为可测纯函数，1.3）。 */
  function buildScene(sceneData) {
    return buildScenePure(sceneData, E.captures, E.regressions);
  }

  /** 星云尘埃重生成（patch 路径，1.2/D1）：per-ws 同种子流固定顺序 → 前 dustCount 粒
      逐位相同（含既有 born 历史），超出部分为增量并标 born = E.t（绘制 α 坡道 0.8s）；
      off 单位化 + 半径渲染期乘 → 半径增长不位移存量粒子。 */
  function regenerateWsDust(ws) {
    const n = ws.archives > 0 ? Math.min(ws.archives * 55, 520) : 0;
    const drand = rng(idHash(ws.id));
    const prior = ws.dustCount ?? 0;
    const dust = [];
    for (let i = 0; i < n; i++) {
      const old = i < prior ? ws.dust[i] : null;
      dust.push({
        off: [drand() * 2 - 1, (drand() * 2 - 1) * 0.38, drand() * 2 - 1],
        s: 0.5 + drand() * 1.6, hue: drand(), tw: drand() * TAU,
        born: old ? (old.born ?? null) : E.t // 存量保留 born 历史；新粒子标标记时刻
      });
    }
    ws.dust = dust;
    ws.dustCount = n;
  }

  /** 连线段键（D8/8.1）：恒星 id 对（无序）——links 是索引对，恒星插删漂移索引，
      按索引比对新旧段会错配；差分时解析成 id 对再比对。 */
  function linkKey(aId, bId) { return aId < bId ? aId + '|' + bId : bId + '|' + aId; }

  /** 连线集合变化段状态捕获（8.1，setScene rebuild 替换前调用）：跨旧/新场景差分
      （sameLinks 判级为 rebuild，段状态 MUST 跨重建保留）——新增段 dir 'in'（α 坡道
      0→1），移除段 dir 'out'（冻结端点世界坐标渐熄幽灵）。 */
  function captureLinkMix(oldScene, sceneData) {
    const oldWs = Array.isArray(oldScene?.ws) ? oldScene.ws : [];
    const nextWs = Array.isArray(sceneData?.workspaces) ? sceneData.workspaces : [];
    for (const old of oldWs) {
      const next = nextWs.find(function (w) { return w.id === old.id; });
      const nextKeys = new Set();
      if (next) {
        (next.links ?? []).forEach(function (L) {
          const a = next.stars?.[L[0]], b = next.stars?.[L[1]];
          if (a && b) nextKeys.add(linkKey(a.id, b.id));
        });
      }
      const oldKeys = new Set();
      let mix = E.linkMix.get(old.id) ?? null;
      const ensure = function () {
        if (!mix) { mix = new Map(); E.linkMix.set(old.id, mix); }
        return mix;
      };
      (old.links ?? []).forEach(function (L) {
        const a = old.stars?.[L[0]], b = old.stars?.[L[1]];
        if (!a || !b) return;
        oldKeys.add(linkKey(a.id, b.id));
        if (nextKeys.has(linkKey(a.id, b.id))) return;
        ensure().set(linkKey(a.id, b.id), { t0: E.t, dir: 'out', pA: (a.wp ?? [0, 0, 0]).slice(), pB: (b.wp ?? [0, 0, 0]).slice() });
      });
      if (!next) continue;
      (next.links ?? []).forEach(function (L) {
        const a = next.stars?.[L[0]], b = next.stars?.[L[1]];
        if (!a || !b) return;
        if (oldKeys.has(linkKey(a.id, b.id))) return;
        ensure().set(linkKey(a.id, b.id), { t0: E.t, dir: 'in' });
      });
    }
  }

  /** 星座快照（D5/5.1）：尘埃世界 offsets（≤520，含当时半径 R）+ 恒星 {p, color}
      （生命周期色经皮肤映射）。MUST 在 setScene 替换前调用（client 差分先于 setScene，
      时序成立）。 */
  function snapshotWsGhost(wsId) {
    const ws = E.scene?.ws?.find(function (w) { return w.id === wsId; });
    if (!ws) return null;
    const R = 12 + (ws.archives || 0) * 2.4;
    const prop = E.style?.palette?.prop ?? {};
    return {
      wsId,
      center: wsCenter(ws, E.t), // 快照取当前可见中心（滑移/过滤位移在途时定格于可见位）
      dust: (ws.dust ?? []).slice(0, 520).map(function (d) {
        return { off: [d.off[0] * R, d.off[1] * R, d.off[2] * R], hue: d.hue };
      }),
      stars: (ws.stars ?? []).map(function (s) {
        return { p: (s.wp ?? [0, 0, 0]).slice(), color: prop[s.lifecycle] ?? '#ffffff' };
      }),
      t0: E.t, dur: WS_GHOST_DUR
    };
  }

  /** 冷启动点亮序曲坡道（6.1/D6）：boot 窗口内各 ws alpha 按 wsIndex×0.1s 错峰点亮
      （单 ws 坡道 0.5s）；窗口外恒 1。E.bootT0 未锚定 → 1（不启用序曲）。 */
  function bootRampOf(t, wsIndex) {
    if (E.bootT0 == null) return 1;
    const el = t - E.bootT0 - wsIndex * BOOT_WS_STAGGER;
    if (el >= BOOT_WS_RAMP) return 1;
    return clamp(el / BOOT_WS_RAMP, 0, 1);
  }

  /* ---------- 搜索过滤（add-cosmos-search-filter 2.2–2.5 / design D1–D3、D5–D6） ----------
     过滤是**呈现态**不是数据态：providers 数据流零改动；SSE 增量照常工作。
     隐藏走纯 α 坡道（filterRamp）→ ws.vis=false → 早退不产 render item → 不进 picks
     → chip 隐藏 → 尾迹停步；MUST NOT 走 E.wsGhosts（该通道语义专属工作区注销）。 */

  /** 钻取态判定（camera-fit 互斥：钻取中不取景，避免与钻取镜头打架）。 */
  function isDiving() { return E.focusMix > 0.05 || !!E.focusWs; }

  /** 过滤 α 目标：无过滤 → 1；过滤激活 → 命中 1 / 未命中 0。 */
  function filterTargetOf(wsId) {
    if (!E.filter) return 1;
    return E.filter.matched.has(wsId) ? 1 : 0;
  }

  /** 过滤 α 现值（坡道中 → 插值；无坡道 → 目标值）。 */
  function filterAlphaAt(ws, t) {
    const ramp = E.filterRamp.get(ws.id);
    if (!ramp) return ws.filterAlpha == null ? filterTargetOf(ws.id) : ws.filterAlpha;
    const k = clamp((t - ramp.t0) / FILTER_RAMP_DUR, 0, 1);
    return k >= 1 ? ramp.to : lerp(ramp.from, ramp.to, easeOutCubic(k));
  }

  /** α 坡道推进（updateScene 每帧）：写 ws.filterAlpha；k≥1 摘除条目（稳态零成本）。 */
  function advanceFilterRamp(ws, t) {
    const ramp = E.filterRamp.get(ws.id);
    if (!ramp) { ws.filterAlpha = filterTargetOf(ws.id); return; }
    const k = clamp((t - ramp.t0) / FILTER_RAMP_DUR, 0, 1);
    if (k >= 1) { E.filterRamp.delete(ws.id); ws.filterAlpha = ramp.to; return; }
    ws.filterAlpha = lerp(ramp.from, ramp.to, easeOutCubic(k));
  }

  /** α 坡道重锚（setFilter 应用时）：按「当前有效值 → 目标值」起坡；差值趋零即摘除。
      `fromValue` 显式给出时以它为准（应用前对旧过滤态快照——MUST NOT 在替换
      E.filter 之后才读当前值，否则 fresh body 会把新目标当起点、失去坡道）。 */
  function anchorFilterRamp(ws, t, fromValue) {
    const from = Number.isFinite(fromValue) ? fromValue : filterAlphaAt(ws, t);
    const to = filterTargetOf(ws.id);
    if (Math.abs(from - to) <= FILTER_ALPHA_EPS) {
      E.filterRamp.delete(ws.id);
      ws.filterAlpha = to;
      return;
    }
    ws.filterAlpha = from;
    E.filterRamp.set(ws.id, { from, to, t0: t });
  }

  /** 应用前快照各 ws 当前有效 α（旧过滤态的目标/在途坡道值）。 */
  function captureFilterAlphas(t) {
    const map = new Map();
    for (const ws of E.scene?.ws ?? []) map.set(ws.id, filterAlphaAt(ws, t));
    return map;
  }

  /** α 坡道全量重锚（开启/逐键增减/清空统一入口）。 */
  function anchorFilterRamps(t, fromAlphas) {
    for (const ws of E.scene?.ws ?? []) anchorFilterRamp(ws, t, fromAlphas ? fromAlphas.get(ws.id) : undefined);
  }

  /** 星座三处位置重算（2.3）：ws.center → 恒星 wp = center + off → 行星轨道中心
      （单星 = 该星 wp / 联星 = 中点 / 无恒星 = 星座中心——与 buildScenePure 口径一致）。
      MUST NOT 用投影期组偏移（触点太多），三处重算点收敛且可测。 */
  function applyWsCenter(ws, center) {
    ws.center = [center[0], center[1], center[2]];
    for (const s of ws.stars) {
      const off = Array.isArray(s.off) ? s.off : [0, 0, 0];
      s.wp = [ws.center[0] + off[0], ws.center[1] + off[1], ws.center[2] + off[2]];
    }
    for (const p of ws.planets) {
      const stars = Array.isArray(p.stars) ? p.stars : [];
      if (stars.length > 1) p.center = midOf(stars.map(function (s) { return s.wp; }));
      else if (stars.length === 1) p.center = stars[0].wp.slice();
      else p.center = ws.center.slice();
    }
  }

  /** 星座当前有效中心（补间中 → 插值；否则 ws.center）。ease 缺省 easeInOutCubic
      （过滤位移既有语义），星座集合滑移通道显式传 easeOutCubic。 */
  function currentCenterOf(ws, t) {
    const a = ws.centerAnim;
    if (!a) return ws.center.slice();
    const k = clamp((t - a.t0 - (a.delay || 0)) / a.dur, 0, 1);
    return lerpV(a.from, a.to, (a.ease ?? easeC)(k));
  }

  /**
   * 渲染期**单一中心访问器**（D5/2.2）：恒星/行星/彗星/星云定位、links 投影与
   * chip DOM 定位（经 ws.proj）MUST 经此取值，渲染路径 SHALL NOT 旁路直读
   * `ws.center` 做投影。位置同步由 `applyWsCenter`（center → 恒星 wp → 行星轨道
   * 中心三处重算）保证：访问器与补间推进共用同一 `ws.centerAnim` 状态源。
   *  - 在途补间 → 由 from/to + ease 插值（连续，无跳变）；
   *  - 仅捕获未起坡（过滤接管等）→ 按 `E.centerTweens` 的 from → ws.center 慢照
   *    公式 `lerpV(from, ws.center, k)`；
   *  - 其余 → ws.center 原样。
   */
  function wsCenter(ws, t) {
    if (ws.centerAnim) return currentCenterOf(ws, t);
    const tw = E.centerTweens.get(ws.id);
    if (tw) {
      const k = clamp((t - tw.t0) / WS_SHIFT_DUR, 0, 1);
      if (k < 1) return lerpV(tw.from, ws.center, easeOutCubic(k));
    }
    return ws.center.slice();
  }

  /** 补间终态中心（稳定钻取目标：MUST 取确定性落位而非途中的补间中点）。 */
  function centerTargetOf(ws) {
    const a = ws.centerAnim;
    return a ? a.to.slice() : ws.center.slice();
  }

  /**
   * 星座集合变化中心捕获（D5/2.1，`setScene` rebuild 路径、`buildScene` 替换前调用）：
   * 新旧场景**同 id** 且中心不同的星座 → `E.centerTweens.set(id, {from, to, t0})`。
   * 新 id（出生走凝聚/chip 高亮）与消失 id（消散幽灵负责）不捕获；冷启动/重挂载
   * （旧场景 null）天然无捕获 → 不滑移（spec：冷启动不滑移）。
   * 旧中心取「当前有效中心」——过滤位移在途时续接可见位置，MUST NOT 从补间起点重跳。
   * @returns {Map<string, {from: number[], to: number[], t0: number}>}
   */
  function captureCenterTweens(oldScene, sceneData) {
    E.centerTweens.clear();
    const oldWs = Array.isArray(oldScene?.ws) ? oldScene.ws : null;
    if (!oldWs) return E.centerTweens; // 冷启动/整页重挂载：无前一帧中心
    for (const next of sceneData?.workspaces ?? []) {
      if (next?.id == null || !Array.isArray(next.pos) || next.pos.length !== 3) continue;
      const prev = oldWs.find(function (w) { return w.id === next.id; });
      if (!prev) continue; // 新 id → 出生转场，不滑移
      const from = currentCenterOf(prev, E.t);
      const to = [Number(next.pos[0]) || 0, Number(next.pos[1]) || 0, Number(next.pos[2]) || 0];
      if (Math.abs(from[0] - to[0]) < 1e-6 && Math.abs(from[1] - to[1]) < 1e-6 && Math.abs(from[2] - to[2]) < 1e-6) continue;
      E.centerTweens.set(next.id, { from, to, t0: E.t });
    }
    return E.centerTweens;
  }

  /**
   * 滑移起坡（rebuild 落位后）：对捕获条目把新场景星座**先置于旧中心**，再起
   * `WS_SHIFT_DUR` 补间滑向确定性新中心（buildScene 输出）。恒星 wp / 行星轨道中心由
   * `applyWsCenter` 逐帧重算 → 滑移期间天体与星云同步移动。
   * 过滤激活时整体跳过（过滤位置接管落位——可见集已按子集布局直接落位，隐藏集不产
   * 画面，叠加聚拢补间只会放大噪音；与既有 2.4「rebuild 落位不重播位移补间」一致）。
   */
  function applyCenterSlides(t) {
    if (E.centerTweens.size === 0) return;
    if (E.filter) { E.centerTweens.clear(); return; }
    for (const [id, tw] of [...E.centerTweens]) {
      const ws = E.scene?.ws?.find(function (w) { return w.id === id; });
      if (!ws) { E.centerTweens.delete(id); continue; }
      const target = ws.center.slice(); // buildScene 确定性终态（此刻仍为新位）
      applyWsCenter(ws, tw.from);
      retargetCenter(ws, target, 0, t, WS_SHIFT_DUR, easeOutCubic);
    }
  }

  /** 位移补间启动/续接（2.3）：新动画带规范序错峰 delay；在途动画改终点续接
      （from = 当前有效中心、t0 重锚、delay 归零），MUST NOT 重启全程动画。
      dur/ease 可选（过滤位移缺省 0.7s easeInOutCubic；星座集合滑移显式 0.8s easeOutCubic）。 */
  function retargetCenter(ws, to, order, t, dur, ease) {
    const target = [Number(to[0]) || 0, Number(to[1]) || 0, Number(to[2]) || 0];
    const anim = ws.centerAnim;
    const from = anim ? currentCenterOf(ws, t) : ws.center.slice();
    if (Math.abs(from[0] - target[0]) < 1e-6 && Math.abs(from[1] - target[1]) < 1e-6 && Math.abs(from[2] - target[2]) < 1e-6) {
      ws.centerAnim = null;
      applyWsCenter(ws, target); // 目标与现值一致 → 直接落位（不留漂浮残差）
      return false;
    }
    const shiftDur = Number(dur) > 0 ? Number(dur) : FILTER_SHIFT_DUR;
    ws.centerAnim = {
      from,
      to: target,
      t0: t,
      delay: anim ? 0 : FILTER_SHIFT_STAGGER * Math.max(0, Number(order) || 0),
      dur: shiftDur,
      ease: typeof ease === "function" ? ease : easeC
    };
    return true;
  }

  /** 位移补间推进（updateScene 每帧）：delay 段不动（错峰）；k≥1 落位摘除。 */
  function advanceCenterAnim(ws, t) {
    const a = ws.centerAnim;
    if (!a) return;
    const el = t - a.t0 - (a.delay || 0);
    if (el < 0) return;
    const k = clamp(el / a.dur, 0, 1);
    applyWsCenter(ws, lerpV(a.from, a.to, (a.ease ?? easeC)(k)));
    if (k >= 1) ws.centerAnim = null;
  }

  /** 过滤目标位集合：过滤激活 → 命中子集目标位；关闭 → 骨架原确定性位置。 */
  function filterTargetPositions() {
    const targets = new Map();
    if (E.filter) {
      for (const id of E.filter.matched) {
        const pos = E.filter.pos.get(id);
        if (Array.isArray(pos)) targets.set(id, pos);
      }
      return targets;
    }
    for (const w of E.sceneData?.workspaces ?? []) {
      if (w?.id != null && Array.isArray(w.pos)) targets.set(w.id, w.pos);
    }
    return targets;
  }

  /** 应用过滤位置（2.3）：命中/回归目标位逐 ws 补间；错峰按规范序（id 升序 =
      constellationPositions 内部排序，确定性纪律保持）。未命中 ws 不动（已隐藏，无需重排）。 */
  function applyFilterPositions(t) {
    const wsList = E.scene?.ws ?? [];
    const targets = filterTargetPositions();
    const byId = new Map(wsList.map(function (w) { return [w.id, w]; }));
    const order = new Map([...targets.keys()].sort().map(function (id, i) { return [id, i]; }));
    for (const [id, pos] of targets) {
      const ws = byId.get(id);
      if (!ws) continue;
      retargetCenter(ws, pos, order.get(id) ?? 0, t);
    }
  }

  /** rebuild 落位（2.4）：过滤激活时命中星座**直接置于过滤目标位**（不重播位移补间——
      rebuild 本身已重播尘埃重散/chips 重挂，再叠聚拢动画只会放大噪音）；filterRamp
      存活于引擎级 Map → 不闪帧。过滤关闭路径与现状逐位一致。 */
  function placeFilterTargets() {
    if (!E.filter) return;
    for (const ws of E.scene?.ws ?? []) {
      if (!E.filter.matched.has(ws.id)) continue;
      const pos = E.filter.pos.get(ws.id);
      if (!Array.isArray(pos)) continue;
      ws.centerAnim = null;
      applyWsCenter(ws, pos);
    }
  }

  /** 过滤态按新场景集合收敛（rebuild）：摘除已消失 ws 的 α 坡道/命中位。
      过滤的「开/关」由 setFilter 决定（query 语义在 client）——此处 MUST NOT 因命中
      集合清空而自行关闭（否则重建帧会闪回全显；client 随后幂等重发修正目标位）。 */
  function pruneFilterScene() {
    const ids = new Set((E.scene?.ws ?? []).map(function (w) { return w.id; }));
    for (const id of [...E.filterRamp.keys()]) {
      if (!ids.has(id)) E.filterRamp.delete(id);
    }
    if (!E.filter) return;
    for (const id of [...E.filter.matched]) {
      if (!ids.has(id)) E.filter.matched.delete(id);
    }
    for (const id of [...E.filter.pos.keys()]) {
      if (!ids.has(id)) E.filter.pos.delete(id);
    }
  }

  /** camera-fit（2.5/D3）：目标位集合 + 半径裕量求包围球 → tweenTo 重定向
      （target = 球心、dist clamp、yaw/pitch 保持；from 恒为当前镜头实况 → 连续
      重定向天然 retarget 无跳变）。空匹配与钻取态跳过。 */
  function fitCameraToFilterTargets() {
    if (isDiving()) return false;
    const points = [...filterTargetPositions().values()];
    if (points.length === 0) return false;
    const fit = fitCameraOf(points, E.cam.fov, FILTER_FIT_MARGIN);
    if (!fit) return false;
    E.lastFilterFit = { target: fit.target.slice(), dist: fit.dist, radius: fit.radius, t0: performance.now() };
    tweenTo({ target: fit.target, yaw: E.cam.yaw, pitch: E.cam.pitch, dist: fit.dist, mix: E.focusMix }, FILTER_FIT_DUR, null);
    return true;
  }

  /** 钻取互斥裁决（2.2/D5，引擎侧**单一状态源**——覆盖 client 所有 setFilter 调用路径）：
      应用过滤后焦点星座掉出 matched → 带「过滤排除」标志触发 flyOut（收尾按需补 fit，
      2.5/D3）；焦点星座命中 → 照常保留（α 相乘不变。）。 */
  function adjudicateFilterFocus() {
    if (!E.filter || !E.focusWs) return false;
    if (E.filter.matched.has(E.focusWs.id)) return false;
    E.filterFitPending = true;
    flyOut();
    return true;
  }

  /** 过滤态逐项相等判定（setFilter 短路：防 SSE 幂等重发重锚坡道/重起补间）。 */
  function sameFilterState(next) {
    const cur = E.filter;
    if (!cur && !next) return true;
    if (!cur || !next) return false;
    if (cur.matched.size !== next.matched.size) return false;
    for (const id of next.matched) if (!cur.matched.has(id)) return false;
    if (cur.pos.size !== next.pos.size) return false;
    for (const [id, p] of next.pos) {
      const q = cur.pos.get(id);
      if (!q || q[0] !== p[0] || q[1] !== p[1] || q[2] !== p[2]) return false;
    }
    return true;
  }

  /** 过滤位置入参归一化（Map / 平面对象双形态防御；非法条目剔除）。 */
  function normalizeFilterPos(posMap) {
    const pos = new Map();
    const entries = posMap instanceof Map ? posMap.entries() : Object.entries(posMap ?? {});
    for (const [id, p] of entries) {
      if (id == null || !Array.isArray(p) || p.length !== 3) continue;
      pos.set(id, [Number(p[0]) || 0, Number(p[1]) || 0, Number(p[2]) || 0]);
    }
    return pos;
  }

  /** birth fx 绘制信息（2.1/2.4）：delay 段（t < t0）全 0 → 不可见（过期判定对
      t<t0 天然安全）；degraded（风暴）缩纯 α 坡道；comet 游入形态——尾迹先现
      （长度坡道 0.45s 内铺满）+ 核后亮（α 坡道延后 0.3s 启动）。 */
  function birthInfoOf(fxEntry, t, kind) {
    if (!fxEntry || fxEntry.type !== 'birth') return null;
    const elapsed = t - fxEntry.t0;
    const dur = fxEntry.dur;
    if (elapsed <= 0) return { k: 0, alpha: 0, trailAlpha: 0, trailFrac: 0, degraded: fxEntry.degraded === true };
    const k = clamp(elapsed / dur, 0, 1);
    if (fxEntry.degraded === true) return { k, alpha: k, trailAlpha: k, trailFrac: k, degraded: true };
    if (kind === 'comet') {
      return {
        k,
        alpha: clamp((elapsed - 0.3) / Math.max(0.01, dur - 0.3), 0, 1),
        trailAlpha: clamp(elapsed / 0.15, 0, 1),
        trailFrac: easeOutCubic(clamp(elapsed / 0.45, 0, 1)),
        degraded: false
      };
    }
    return { k, alpha: k, trailAlpha: 1, trailFrac: 1, degraded: false };
  }

  function updateScene(t, dt) {
    const scene = E.scene;
    pumpFxQueue(t); // 延迟启动队列出队（D7：boot 窗口/错峰/并发上限/风暴降级统一裁决）
    /** 状态色相滑移摘除（3.1/D3）：k≥1 摘除（skin-d 侧按 t 现算 k，无状态推进）。 */
    const expireMix = function (b) { if (b.colorMix && t - b.colorMix.t0 >= b.colorMix.dur) b.colorMix = null; };
    scene.ws.forEach(function (ws) {
      /* 过滤 α 坡道推进（2.2）+ 位移补间推进（2.3）——先于行星/彗星步进：
         planet.wp 由 p.center（本帧可能已被补间重写）派生。 */
      advanceFilterRamp(ws, t);
      advanceCenterAnim(ws, t);
      /* 本帧有效中心（渲染期单一访问器，D5/2.2）：滑移/过滤位移在途 → 插值中心。 */
      const center = wsCenter(ws, t);
      ws.planets.forEach(function (p) {
        expireMix(p);
        (p.sats ?? []).forEach(expireMix);
        /* 成星捕获补间（新引擎能力）：半径倍率 3.5→1、角速度 4×→1× 的螺旋坠入。
           k≥1 摘除：body 补间态置空 + E.captures Map 条目同步退出（Map 仅在册
           进行中补间；已消失 id 的残留由 rebuild prune 兜底）。 */
        let radiusF = 1, speedF = 1;
        if (p.captureStart != null) {
          const k = clamp((t - p.captureStart) / 1.4, 0, 1);
          radiusF = lerp(3.5, 1, k);
          speedF = lerp(4, 1, k);
          if (k >= 1) { p.captureStart = null; E.captures.delete(p.id); }
        }
        const orbitR = p.baseR * radiusF;
        const a = p.phase + t * p.speed * speedF;
        const ca = Math.cos(a) * orbitR, sa = Math.sin(a) * orbitR;
        const ci = Math.cos(p.inc), si = Math.sin(p.inc);
        p.wp = [p.center[0] + ca, p.center[1] + sa * si * 0.9, p.center[2] + sa * ci];
        if (ws.vis) {
          p.acc += dt;
          if (p.acc > 0.05) { p.acc = 0; p.trail.push(p.wp.slice()); if (p.trail.length > 14) p.trail.shift(); }
        }
        stepSatBodies(p.sats, p.wp, p.inc, satOrbitR(p), t, dt, ws.vis);
      });
      ws.comets.forEach(function (c) {
        expireMix(c);
        (c.sats ?? []).forEach(expireMix);
        const wander = [
          center[0] + Math.cos(t * 0.19 + c.phase) * 58,
          center[1] + Math.sin(t * 0.31 + c.phase) * 16 + 10,
          center[2] + Math.sin(t * 0.15 + c.phase) * 46
        ];
        /* 回归反向捕获补间（E.captures 螺旋坠入的镜像）：wp 从行星最后轨道位置
           easeOutCubic 滑向游荡点（1.4s），α 前 0.5s 坡道 0→1 渐入；k≥1 摘除
           （body 补间态置空 + Map 条目同步退出，与 captures 同款收尾）。 */
        if (c.regressStart != null && c.from) {
          const k = clamp((t - c.regressStart) / REGRESS_DUR, 0, 1);
          c.wp = lerpV(c.from, wander, easeOutCubic(k));
          c.regressAlpha = clamp((t - c.regressStart) / REGRESS_ALPHA_RAMP, 0, 1);
          if (k >= 1) { c.regressStart = null; c.from = null; E.regressions.delete(c.id); }
        } else {
          c.wp = wander;
        }
        if (ws.vis) {
          c.acc += dt;
          if (c.acc > 0.05) { c.acc = 0; c.trail.push(c.wp.slice()); if (c.trail.length > 34) c.trail.shift(); }
        }
        stepSatBodies(c.sats, c.wp, 0, satOrbitR(c), t, dt, ws.vis);
      });
    });
    /* 星座集合滑移捕获条目过期清理（D5/2.1 观测面兜底——补间本体在 ws.centerAnim，
       捕获 Map 不参与渲染裁决；播完即摘，稳态零驻留）。 */
    for (const [twId, tw] of [...E.centerTweens]) {
      if (t - tw.t0 >= WS_SHIFT_DUR) E.centerTweens.delete(twId);
    }
    // 环境流星调度（demo 保留）
    if (!E.meteor && t > E.nextMeteor && scene.ws.length > 0) {
      const ws0 = scene.ws[Math.floor(Math.random() * scene.ws.length)];
      const c0 = wsCenter(ws0, t);
      const p0 = [c0[0] + (Math.random() - 0.5) * 500, c0[1] + 60 + Math.random() * 120, c0[2] + (Math.random() - 0.5) * 500];
      E.meteor = makeMeteor(p0, t, 1.3 + Math.random() * 0.5);
    }
    if (E.meteor) {
      if (stepMeteor(E.meteor, t, dt)) E.meteor = null;
    }
    // 事件驱动流星（新引擎能力）：会话消亡/卫星消亡触发
    E.eventMeteors = E.eventMeteors.filter(function (m) { return !stepMeteor(m, t, dt); });
    // nova 幽灵列表步进（超新星转场）：k 推进 + 过期即摘（E.t 冻结期断点续播，同 fx 语义）
    E.novae = stepNovae(E.novae, t);
    // 星座消散幽灵步进（5.1）：dur 播完即摘（1.5s 自灭，与场景实体解耦）
    E.wsGhosts = E.wsGhosts.filter(function (g) { return t - g.t0 < g.dur; });
    // 连线段淡入淡出过期清理（8.1）：段状态跨 rebuild 保留，0.4s 播完即摘 + 空 Map 回收
    for (const [wsId, mix] of E.linkMix) {
      for (const [key, entry] of mix) {
        if (t - entry.t0 > LINK_FADE_DUR + 0.05) mix.delete(key);
      }
      if (mix.size === 0) E.linkMix.delete(wsId);
    }
    // 转场 fx 过期清理（点燃/落印/查看渐熄/出生/金涌播完即摘；t<t0 的 delay 段天然安全）
    for (const [key, fx] of E.fx) {
      if (t - fx.t0 > fx.dur + 0.05) E.fx.delete(key);
    }
  }

  /** 卫星绕父天体步进（子轨道面随父 inc；父 wp 每帧更新后卫星跟随）。 */
  function stepSatBodies(sats, center, inc, rOrb, t, dt, vis) {
    if (!sats || sats.length === 0) return;
    const ci = Math.cos(inc || 0), si = Math.sin(inc || 0);
    sats.forEach(function (sat) {
      const a = sat.phase + t * sat.speed;
      const ca = Math.cos(a) * rOrb, sa = Math.sin(a) * rOrb;
      sat.wp = [center[0] + ca, center[1] + sa * si * 0.9, center[2] + sa * ci];
      if (vis) {
        sat.acc += dt;
        if (sat.acc > 0.06) { sat.acc = 0; sat.trail.push(sat.wp.slice()); if (sat.trail.length > 9) sat.trail.shift(); }
      }
    });
  }

  function makeMeteor(p0, t, dur) {
    const dir = [(Math.random() - 0.5), -0.25 - Math.random() * 0.3, (Math.random() - 0.5)];
    const L = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const speed = 480 + Math.random() * 160;
    return { p0: p0, v: [dir[0] / L * speed, dir[1] / L * speed, dir[2] / L * speed], t0: t, dur: dur, trail: [], acc: 0 };
  }

  /** 流星步进；返回 true = 已熄灭。 */
  function stepMeteor(m, t, dt) {
    const k = (t - m.t0) / m.dur;
    if (k >= 1) return true;
    m.head = [m.p0[0] + m.v[0] * (t - m.t0), m.p0[1] + m.v[1] * (t - m.t0), m.p0[2] + m.v[2] * (t - m.t0)];
    m.acc = (m.acc || 0) + dt;
    if (m.acc > 0.04) { m.acc = 0; m.trail.push(m.head.slice()); if (m.trail.length > 16) m.trail.shift(); }
    return false;
  }

  /* ---------- 投影 ---------- */

  function project(cam, p, W, H) {
    let v = [p[0] - cam.target[0], p[1] - cam.target[1], p[2] - cam.target[2]];
    v = rotY(v, -cam.yaw); v = rotX(v, -cam.pitch);
    const vz = v[2] + cam.dist;
    if (vz < 12) return null;
    const f = (H * 1.1) / (2 * Math.tan(cam.fov * Math.PI / 360));
    const s = f / vz;
    return { x: W / 2 + v[0] * s, y: H / 2 - v[1] * s, s: s, z: vz };
  }
  function zOf(cam, p) {
    let v = [p[0] - cam.target[0], p[1] - cam.target[1], p[2] - cam.target[2]];
    v = rotY(v, -cam.yaw); v = rotX(v, -cam.pitch);
    return v[2] + cam.dist;
  }

  /* ---------- 组装绘制条目 ---------- */

  function buildItems(t) {
    const cam = E.cam, W = E.W, H = E.H;
    const items = [], picks = [];
    E.screens = {};

    E.scene.ws.forEach(function (ws, wsIndex) {
      /* α 三因子相乘（2.2）：过滤 α × focus 因子（钻取半暗）× 点亮序曲坡道。
         焦点判定按 id 比较（引用会随结构重建换代——remapFocusRefs 重映射 + id 基
         双保险，防 dive 焦点失配导致全场景塌到未聚焦亮度）。既有 ws.vis 判定天然
         承载「淡隐到 0 → 早退不产 item → 不进 picks → chip 隐藏 → 尾迹停步」全链，
         无需逐项排除代码。 */
      const filterAlpha = ws.filterAlpha == null ? filterTargetOf(ws.id) : ws.filterAlpha;
      ws.alpha = filterAlpha
        * (E.focusMix <= 0 ? 1 : (E.focusWs && ws.id === E.focusWs.id ? 1 : 1 - 0.88 * E.focusMix))
        * bootRampOf(t, wsIndex); // 冷启动点亮序曲（6.1）：wsIndex×0.1s 错峰坡道
      ws.vis = ws.alpha > 0.02;
      if (!ws.vis) return;
      /* 渲染期单一中心访问器（D5/2.2）：星座集合滑移 / 过滤位移在途 → 插值中心；
         恒星 wp 与行星轨道中心由 applyWsCenter 同步重算，故 dust/星云/连线/chip
         （经 ws.proj）全部随星座中心移动。MUST NOT 旁路直读 ws.center。 */
      const center = wsCenter(ws, t);
      ws.proj = project(cam, center, W, H);

      if (ws.archives > 0) {
        const pts = [];
        const R = 12 + ws.archives * 2.4; // 星云半径渲染期缩放（off 单位化 → 密度增长不位移存量粒子，D1）
        ws.dust.forEach(function (d) {
          const pr = project(cam, [center[0] + d.off[0] * R, center[1] + d.off[1] * R, center[2] + d.off[2] * R], W, H);
          if (pr) pts.push({ x: pr.x, y: pr.y, s: d.s * pr.s * 3, a: ws.alpha * (0.22 + 0.3 * (0.5 + 0.5 * Math.sin(t * 1.3 + d.tw))), hue: d.hue, born: d.born ?? null });
        });
        if (pts.length) items.push({ kind: 'dust', z: zOf(cam, center) - 6, pts: pts, ws: ws, alpha: ws.alpha });
      }
      if (ws.links.length && ws.stars.length) {
        const segs = [];
        ws.links.forEach(function (L) {
          const A = ws.stars[L[0]], B = ws.stars[L[1]];
          if (!A || !B) return;
          const pa = project(cam, A.wp, W, H), pb = project(cam, B.wp, W, H);
          if (!pa || !pb) return;
          /* 段淡入坡道（8.1）：以恒星 id 对键控（索引漂移不致错配）；无段状态 → 1。 */
          const mixEntry = E.linkMix.get(ws.id)?.get(linkKey(A.id, B.id));
          const segAlpha = mixEntry && mixEntry.dir === 'in'
            ? clamp((t - mixEntry.t0) / LINK_FADE_DUR, 0, 1)
            : 1;
          segs.push({ a: pa, b: pb, alpha: segAlpha });
        });
        /* 移除段渐熄幽灵（8.1）：冻结端点世界坐标 α→0（实体已不在新场景）。 */
        const ghostMix = E.linkMix.get(ws.id);
        if (ghostMix) {
          for (const entry of ghostMix.values()) {
            if (entry.dir !== 'out') continue;
            const k = clamp((t - entry.t0) / LINK_FADE_DUR, 0, 1);
            const pa = project(cam, entry.pA, W, H), pb = project(cam, entry.pB, W, H);
            if (pa && pb) segs.push({ a: pa, b: pb, alpha: 1 - k });
          }
        }
        if (segs.length) items.push({ kind: 'constline', z: zOf(cam, center) - 4, segs: segs, ws: ws, alpha: ws.alpha });
      }
      ws.planets.forEach(function (p) {
        const orbitPts = [];
        const orbitR = p.captureStart != null ? p.baseR * lerp(3.5, 1, clamp((t - p.captureStart) / 1.4, 0, 1)) : p.baseR;
        for (let i = 0; i <= 48; i++) {
          const a = p.phase + i / 48 * TAU;
          const ca = Math.cos(a) * orbitR, sa = Math.sin(a) * orbitR;
          const ci = Math.cos(p.inc), si = Math.sin(p.inc);
          const pr = project(cam, [p.center[0] + ca, p.center[1] + sa * si * 0.9, p.center[2] + sa * ci], W, H);
          if (pr) orbitPts.push(pr);
        }
        if (orbitPts.length > 2) items.push({ kind: 'orbit', z: zOf(cam, p.center) - 2, orbitPts: orbitPts, ws: ws, alpha: ws.alpha, data: p });
      });
      ws.stars.forEach(function (s) {
        const pr = project(cam, s.wp, W, H);
        if (!pr) return;
        const act = s.act || 0;
        const dimF = act === 0 ? 0.4 : 1;
        /* act 热度通道：活跃时轻微脉动（颜色不变，in-progress 半径加成退场）。 */
        const pulse = act > 0 ? 1 + 0.06 * Math.sin(t * 2.4 + s.starIndex * 2) : 1;
        const r = clamp((2.4 + act * 0.9) * pr.s * 1.05, 2, 26) * pulse;
        const key = 'star:' + s.id;
        const starFx = E.fx.get(key) ?? null;
        E.screens[key] = { x: pr.x, y: pr.y, r: r };
        const it = {
          kind: 'star', z: pr.z, x: pr.x, y: pr.y, r: r, alpha: ws.alpha * dimF,
          data: s, ws: ws, fx: starFx,
          birth: birthInfoOf(starFx, t, 'star') // 出生绘制信息（2.4 skin-d 消费；delay 段 α=0）
        };
        markHovers(it, 'star', s.id);
        items.push(it);
        picks.push({ x: pr.x, y: pr.y, r: r + 8, e: { kind: 'star', ws: ws, data: s } });
      });
      ws.planets.forEach(function (p) {
        const pr = project(cam, p.wp, W, H);
        if (!pr) return;
        const planetFx = E.fx.get('planet:' + p.id) ?? null;
        const birth = birthInfoOf(planetFx, t, 'planet');
        let px = pr.x, py = pr.y;
        if (birth && !birth.degraded && birth.k > 0 && birth.k < 1) {
          /* 出生滑入（D2）：从所属恒星方向短滑入——位移 = baseR×1.5→0（easeOutCubic），
             起点贴近恒星、滑至轨道位。风暴降级（degraded）缩纯 α 坡道、无位移。 */
          const s = (1 - easeOutCubic(birth.k)) * p.baseR * 1.5;
          const dx = p.wp[0] - p.center[0], dy = p.wp[1] - p.center[1], dz = p.wp[2] - p.center[2];
          const L = Math.hypot(dx, dy, dz) || 1;
          const prB = project(cam, [p.wp[0] - dx / L * s, p.wp[1] - dy / L * s, p.wp[2] - dz / L * s], W, H);
          if (prB) { px = prB.x; py = prB.y; }
        }
        const waiting = p.state === 'waiting';
        const pulse = waiting ? 1 + 0.12 * Math.sin(t * 5) : 1;
        const r = clamp(1.6 * pr.s * 1.15, 2.2, 14) * pulse;
        const trail = p.trail.map(function (w) { return project(cam, w, W, H); }).filter(Boolean);
        const key = 'planet:' + p.id;
        E.screens[key] = { x: px, y: py, r: r };
        const it = { kind: 'planet', z: pr.z, x: px, y: py, r: r, alpha: ws.alpha, data: p, ws: ws, trail: trail, fx: planetFx, birth: birth };
        markHovers(it, 'planet', p.id);
        items.push(it);
        picks.push({ x: px, y: py, r: r + 8, e: { kind: 'planet', ws: ws, data: p } });
        pushSatEnvelope(items, cam, p, W, H, ws, t);
      });
      ws.comets.forEach(function (c) {
        const pr = project(cam, c.wp, W, H);
        if (!pr) return;
        const cometFx = E.fx.get('comet:' + c.id) ?? null;
        const birth = birthInfoOf(cometFx, t, 'comet');
        let trail = c.trail.map(function (w) { return project(cam, w, W, H); }).filter(Boolean);
        let px = pr.x, py = pr.y;
        if (birth && !birth.degraded) {
          /* 尾迹先现（trail 长度坡道）：可见尾迹按 trailFrac 从头截取。 */
          if (birth.trailFrac < 1) trail = trail.slice(0, Math.max(2, Math.round(trail.length * birth.trailFrac)));
          if (birth.k > 0 && birth.k < 1) {
            /* 游入（D2）：从星座外缘滑向游荡位——位移 110→0（easeOutCubic）；
               核后亮由 birth.alpha（延后 0.3s 坡道）在皮肤侧完成。 */
            const s = (1 - easeOutCubic(birth.k)) * 110;
            const dx = c.wp[0] - center[0], dy = c.wp[1] - center[1], dz = c.wp[2] - center[2];
            const L = Math.hypot(dx, dy, dz) || 1;
            const prB = project(cam, [c.wp[0] + dx / L * s, c.wp[1] + dy / L * s, c.wp[2] + dz / L * s], W, H);
            if (prB) { px = prB.x; py = prB.y; }
          }
        }
        const r = clamp(1.6 * pr.s, 2.4, 14);
        const key = 'comet:' + c.id;
        E.screens[key] = { x: px, y: py, r: r };
        const it = {
          kind: 'comet', z: pr.z, x: px, y: py, r: r,
          alpha: ws.alpha * (c.regressAlpha != null ? c.regressAlpha : 1), // 回归 α 坡道（0→1 渐入）
          data: c, ws: ws, trail: trail,
          fx: cometFx, // 查看渐熄（skin fx 驱动谓词消费）
          birth: birth // 游入形态（尾迹先现/核后亮，2.4 skin-d 消费）
        };
        markHovers(it, 'comet', c.id);
        items.push(it);
        picks.push({ x: px, y: py, r: r + 8, e: { kind: 'comet', ws: ws, data: c } });
        pushSatEnvelope(items, cam, c, W, H, ws, t);
      });
    });

    if (E.meteor) pushMeteorItem(items, cam, E.meteor, t);
    E.eventMeteors.forEach(function (m) { pushMeteorItem(items, cam, m, t); });
    // nova 幽灵条目（超新星转场）：世界坐标逐帧投影、参与 z 排序；自持幽灵不乘
    // ws.alpha（钻取淡出/非焦点星座中照常播完，与 eventMeteors 同语义）
    E.novae.forEach(function (n) {
      const pr = project(cam, n.p0, W, H);
      if (!pr) return;
      const drift = n.driftTo ? project(cam, n.driftTo, W, H) : null;
      const r = clamp(2.4 * pr.s * 1.05, 2, 26); // 恒星本体屏显半径（act=0 口径，引擎侧定格）
      items.push({ kind: 'nova', z: pr.z, x: pr.x, y: pr.y, r: r, k: n.k, alpha: 1, data: n, drift: drift });
    });
    // 星座消散幽灵条目（5.1/D5）：尘埃外扩漂散（off ×1→×2.2 easeOutCubic）+ 恒星余辉
    // 渐熄（α→0），与场景实体解耦；自持幽灵不乘 ws.alpha（同 nova/eventMeteors 语义）
    E.wsGhosts.forEach(function (g) {
      const k = clamp((t - g.t0) / g.dur, 0, 1);
      const spread = lerp(1, 2.2, easeOutCubic(k));
      const dust = [];
      for (const d of g.dust) {
        const pr = project(cam, [g.center[0] + d.off[0] * spread, g.center[1] + d.off[1] * spread, g.center[2] + d.off[2] * spread], W, H);
        if (pr) dust.push({ x: pr.x, y: pr.y, s: 1.2 * pr.s * 3, a: 1 - k, hue: d.hue });
      }
      const stars = [];
      for (const st of g.stars) {
        const pr = project(cam, st.p, W, H);
        if (pr) stars.push({ x: pr.x, y: pr.y, r: clamp(2.4 * pr.s * 1.05, 2, 26), a: 1 - k, color: st.color });
      }
      if (dust.length || stars.length) items.push({ kind: 'wsghost', z: zOf(cam, g.center), dust: dust, stars: stars, alpha: 1, k: k });
    });

    items.sort(function (a, b) { return b.z - a.z; });
    E.picks = picks;
    return items;
  }

  function pushMeteorItem(items, cam, m, t) {
    const k = (t - m.t0) / m.dur;
    const pr = project(cam, m.head, E.W, E.H);
    if (!pr) return;
    const trail = m.trail.map(function (w) { return project(cam, w, E.W, E.H); }).filter(Boolean);
    items.push({ kind: 'meteor', z: 1, x: pr.x, y: pr.y, r: 2, alpha: Math.sin(Math.PI * k), data: { id: m.id ?? '__meteor' }, trail: trail });
  }

  function markHovers(it, kind, id) {
    const key = kind + ':' + id;
    it.hovered = !!(E.hovered && entKey(E.hovered) === key);
    it.selected = !!(E.selected && entKey(E.selected) === key);
  }

  /** 子轨道环 + 卫星条目装配（卫星 MUST NOT 参与拾取：不进 picks/screens，hover 穿透父天体）。
      bornK：卫星出生坡道（2.2，0.5s 半径 0→满 + α 坡道，skin-d sat 分支消费）。 */
  function pushSatEnvelope(items, cam, owner, W, H, ws, t) {
    if (!owner.sats || owner.sats.length === 0) return;
    const rOrb = satOrbitR(owner);
    const ci = Math.cos(owner.inc || 0), si = Math.sin(owner.inc || 0);
    const ringPts = [];
    for (let i = 0; i <= 40; i++) {
      const a = i / 40 * TAU;
      const pr = project(cam, [
        owner.wp[0] + Math.cos(a) * rOrb,
        owner.wp[1] + Math.sin(a) * rOrb * si * 0.9,
        owner.wp[2] + Math.sin(a) * rOrb * ci
      ], W, H);
      if (pr) ringPts.push(pr);
    }
    if (ringPts.length > 2) items.push({ kind: 'suborbit', z: zOf(cam, owner.wp) - 1, orbitPts: ringPts, alpha: ws.alpha, data: { state: owner.state || 'idle' } });
    owner.sats.forEach(function (sat) {
      const pr = project(cam, sat.wp, W, H);
      if (!pr) return;
      const bornK = sat.born != null ? clamp((t - sat.born) / SAT_BORN_DUR, 0, 1) : null;
      const r = clamp(1.1 * pr.s, 1.6, 5.5);
      const trail = sat.trail.map(function (w) { return project(cam, w, W, H); }).filter(Boolean);
      items.push({ kind: 'sat', z: pr.z + 1, x: pr.x, y: pr.y, r: r, alpha: ws.alpha, data: sat, ws: ws, trail: trail, bornK: bornK });
    });
  }

  function pickAt(x, y) {
    let best = null, bd = Infinity;
    E.picks.forEach(function (p) {
      const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
      const rr = p.r + 6;
      if (d <= rr * rr && d < bd) { bd = d; best = p.e; }
    });
    return best;
  }

  /* ---------- 相机动画 ---------- */

  function tweenTo(to, dur, endMode) {
    E.tween = {
      t0: performance.now(), dur: dur, endMode: endMode || null,
      from: { target: E.cam.target.slice(), yaw: E.cam.yaw, pitch: E.cam.pitch, dist: E.cam.dist, mix: E.focusMix },
      to: to
    };
  }
  function stepTween(t) {
    if (!E.tween) return;
    const tw = E.tween;
    const k = easeC(clamp((performance.now() - tw.t0) / tw.dur, 0, 1));
    E.cam.target = lerpV(tw.from.target, tw.to.target, k);
    E.cam.yaw = lerp(tw.from.yaw, tw.to.yaw, k);
    E.cam.pitch = lerp(tw.from.pitch, tw.to.pitch, k);
    E.cam.dist = lerp(tw.from.dist, tw.to.dist, k);
    E.focusMix = lerp(tw.from.mix, tw.to.mix, k);
    if (k >= 1) {
      const mode = tw.endMode;
      E.tween = null;
      if (mode === 'out') { E.focusWs = null; E.selected = null; } // 飞出补间收尾双保险：选中态不外泄到银河视图
      if (mode === 'in' && E.diveSel) E.selected = { kind: E.diveSel.kind, ws: E.focusWs, data: E.diveSel };
      /* 「过滤排除」flyOut 收尾补一次 camera-fit（2.5/D3）：钻取早于过滤输入时
         diveFrom 是过滤前旧取景，直接飞回会停在旧景（画面近空而匹配簇在画外）；
         普通 Esc flyOut 不带标志、不补。 */
      if (mode === 'out' && E.filterFitPending) {
        E.filterFitPending = false;
        if (E.filter) fitCameraToFilterTargets();
      }
    }
    void t;
  }
  function dive(ws, selectEnt) {
    E.diveCount += 1; // 观测面（D8：容器级重绑「单次 dive」防回归断言）
    E.focusWs = ws; E.diveSel = selectEnt || null;
    E.selected = null;
    /* 记住钻取前位置：WASD 平移后 Esc 飞回原处而非硬编码原点（会把视野甩走）。 */
    E.diveFrom = {
      target: E.cam.target.slice(), yaw: E.cam.yaw, pitch: E.cam.pitch, dist: E.cam.dist
    };
    tweenTo({ target: centerTargetOf(ws), yaw: E.cam.yaw, pitch: 0.35, dist: 155, mix: 1 }, 1300, 'in');
  }
  function flyOut() {
    if (E.focusMix <= 0 && !E.focusWs) { E.selected = null; return; }
    E.diveSel = null;
    /* 离开系统视图即清选中——否则被选恒星的信息卡/名牌随 selected 残留并钉在
       银河视图（卡片底色与夜空近乎同色，只剩标题可见，呈「拖拽残影」）。 */
    E.selected = null;
    /* 完整镜头回放（target/yaw/pitch/dist 全恢复）——平移/旋转/缩放后 Esc 不再
       被拽回出厂视角。 */
    const home = E.diveFrom ?? { target: [0, 0, 0], yaw: E.cam.yaw, pitch: 0.5, dist: 430 };
    tweenTo({ target: home.target, yaw: home.yaw, pitch: home.pitch, dist: home.dist, mix: 0 }, 1200, 'out');
  }

  /** 用户接管取消相机补间（拖拽/WASD/滚轮；add-cosmos-search-filter 2.5）：
      丢弃 tween 且放弃「过滤排除」收尾补 fit——控制权在用户手里，镜头 SHALL NOT
      再被自动改道。 */
  function cancelTween() {
    E.tween = null;
    E.filterFitPending = false;
  }

  /** 手势抑制判定（D2/1.3）：多指手势激活中，或手势结束后 GESTURE_SUPPRESS_MS 内。
      click 在 pointerup 之后才派发 → 时间窗兜住「捏合结束后才到的 click」；
      chip click 与容器级 pointerup 拾取共用此判据。 */
  function gestureSuppressed() {
    return E.gesture === true || (performance.now() - E.gestureEndAt) < GESTURE_SUPPRESS_MS;
  }

  /* ---------- DOM 覆盖层（容器内挂载，去 document.body） ---------- */

  function ensureDom() {
    const root = document.createElement('div');
    root.className = 'cos-root';
    /* HUD 精简（D5/2.1–2.2）：面包屑与右上操作提示已移除——返回银河由 Esc（桌面）与
       右下常驻「回到银河」按钮（触屏）两条等价路径承担；左上位置改由钻取态星座标牌
       `.cos-badge` 占用（D4）。标牌与按钮均在此建一次，MUST NOT 逐帧重建（吞 click）。 */
    root.innerHTML =
      '<canvas class="cos-canvas"></canvas>' +
      '<div class="cos-scanlines"></div>' +
      '<div class="cos-overlay">' +
      '  <div class="cos-badge"></div>' +
      '  <div class="cos-card"></div>' +
      '  <div class="cos-empty" style="display:none"><b>COSMOS</b></div>' +
      '</div>' +
      '<div class="cos-toast"></div>';
    E.container.appendChild(root);
    E.el.root = root;
    E.el.canvas = root.querySelector('.cos-canvas');
    E.el.overlay = root.querySelector('.cos-overlay');
    E.el.badge = root.querySelector('.cos-badge');
    E.el.card = root.querySelector('.cos-card');
    E.el.empty = root.querySelector('.cos-empty');
    E.el.toast = root.querySelector('.cos-toast');
    E.ctx = E.el.canvas.getContext('2d');

    /* 右下「回到银河」（D3/4.1–4.2）：引擎 overlay 自建（功能纯引擎，零新 API 暴露），
       DOM 只建一次、不参与逐帧 innerHTML 更新——否则一次 mousedown→mouseup 之间元素被
       换掉，click 永不派发。行为完全复刻原面包屑「银河」按钮：钻取态 = flyOut()（与 Esc
       同一函数），银河根级 flyOut 早退仅清选中、不关页。 */
    const homeBtn = document.createElement('button');
    homeBtn.className = 'cos-home-btn';
    homeBtn.setAttribute('type', 'button');
    homeBtn.setAttribute('aria-label', '回到银河');
    homeBtn.setAttribute('title', '回到银河');
    homeBtn.innerHTML = HOME_ICON_SVG;
    homeBtn.addEventListener('click', function () { flyOut(); });
    E.el.overlay.appendChild(homeBtn);
    E.el.homeBtn = homeBtn;
    E.el.card.addEventListener('click', function (ev) {
      if (ev.target && ev.target.classList.contains('cd-btn')) {
        const sessionId = ev.target.getAttribute('data-session');
        if (sessionId && E.onOpenSession) E.onOpenSession(sessionId);
      }
    });
  }

  /** 空星座判定（D6：「空」= 恒星/行星/彗星均为空且无归档星云）。出生高亮只对空星座
      生效——含内容星座走既有凝聚/游入转场，MUST NOT 被 chip 高亮替代或叠加（spec）。 */
  function isEmptyConstellation(ws) {
    return (ws?.stars?.length ?? 0) === 0
      && (ws?.planets?.length ?? 0) === 0
      && (ws?.comets?.length ?? 0) === 0
      && !(ws?.archives > 0);
  }

  /** 覆盖层 chip/slab 随场景结构重建（星座集合/恒星集合变化时）。空星座出生高亮
      （D6/3.2）：markWsBirth 在册、窗口内（~2s）且为空星座的 chip 附加 `cos-chip-new`
      ——CSS 动画 forwards 收尾即常态，无需 JS 清理；窗口外条目就地摘除。 */
  function rebuildOverlayDom() {
    for (const chip of Object.values(E.chips)) chip.remove();
    for (const slab of Object.values(E.slabs)) slab.remove();
    E.chips = {}; E.slabs = {};
    E.scene.ws.forEach(function (ws) {
      const birthT0 = E.wsBirth.get(ws.id);
      const fresh = birthT0 != null && E.t - birthT0 < WS_BIRTH_HL_DUR && isEmptyConstellation(ws);
      if (birthT0 != null && !fresh) E.wsBirth.delete(ws.id); // 过期或非空星座 → 摘除（有内容走凝聚）
      const chip = document.createElement('div');
      chip.className = fresh ? 'cos-chip cos-chip-new' : 'cos-chip';
      chip.addEventListener('click', function () {
        /* 手势抑制（D2）：多指手势期间/刚结束（GESTURE_SUPPRESS_MS 内）的 click
           MUST NOT 触发 dive——双指起手落在 chip 上完成捏合会派生 click。 */
        if (gestureSuppressed()) return;
        dive(ws, null);
      });
      E.el.overlay.appendChild(chip);
      E.chips[ws.id] = chip;
      ws.stars.forEach(function (s) {
        const slab = document.createElement('div');
        slab.className = 'cos-slab';
        slab.textContent = s.name;
        E.el.overlay.appendChild(slab);
        E.slabs[s.id] = slab;
      });
    });
    updateChipText();
  }

  /** chip 文本（patch 路径下就地更新，不重建 DOM）：银河态只显示星座名——计数仪表
      迁移至钻取态左上标牌（D4/3.3）。沿用 `dataset.html` 内容差分守卫：名字几乎恒定，
      逐帧重写 innerHTML 是无谓开销，且会让 chip 内部元素活不过一帧；
      `cos-chip-new` 出生高亮关键帧只作用于 border/box-shadow/b 的 text-shadow，
      无 span 依赖（移除计数行不影响高亮）。 */
  function updateChipText() {
    E.scene.ws.forEach(function (ws) {
      const chip = E.chips[ws.id];
      if (!chip) return;
      const html = '<b>' + escapeHtml(ws.name) + '</b>';
      if (chip.dataset.html !== html) { chip.innerHTML = html; chip.dataset.html = html; }
    });
  }

  /** 星座计数仪表文本（D4/3.2）：✦ 含星胚、◇ = subagent 会话总数（含折叠）、
      ☁ = 归档数；全量五档常显（仪表语义，无内容也显 0）。 */
  function countsHtml(ws) {
    const nS = ws.stars.length, nP = ws.planets.length, nC = ws.comets.length;
    const nSat = ws.satelliteCount || 0;
    const nArc = ws.archives || 0;
    return '✦' + nS + ' ●' + nP + ' ◇' + nSat + ' ☄' + nC + ' ☁' + nArc;
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  let toastTimer = null;
  function toast(msg) {
    E.el.toast.textContent = msg;
    E.el.toast.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { E.el.toast.classList.remove('on'); }, 2400);
  }

  function cardHtml(e) {
    if (e.kind === 'star') {
      const s = e.data;
      const stamp = (s.setBy || s.at)
        ? '<span>落章</span><b>' + escapeHtml(s.setBy || '—') + (s.at ? ' · ' + escapeHtml(relativeTime(s.at)) : '') + '</b>'
        : '';
      return '<div class="cd-title">✦ ' + escapeHtml(s.name) + '</div>' +
        '<div class="cd-grid">' +
        '<span>状态</span><b>' + (LIFECYCLE_LABEL[s.lifecycle] || s.lifecycle) + '</b>' +
        stamp +
        '<span>任务</span><b>' + s.tasks[0] + '/' + s.tasks[1] + '</b>' +
        '<span>年龄</span><b>' + escapeHtml(s.age ?? '—') + '</b>' +
        '<span>活跃会话</span><b>' + (s.act || 0) + '</b>' +
        '</div>';
    }
    if (e.kind === 'planet') {
      const p = e.data;
      const stars = p.stars.map(function (x) { return x.name; }).join(' · ');
      const kindText = p.state === 'waiting' && p.pendingKind
        ? '（' + escapeHtml(PLAN_KIND_LABEL[p.pendingKind] || p.pendingKind) + '）'
        : '';
      const satRow = (p.satelliteCount || 0) > 0
        ? '<span>子代理</span><b>×' + p.satelliteCount + '</b>'
        : '';
      return '<div class="cd-title">● ' + escapeHtml(p.title) + '</div>' +
        '<div class="cd-grid">' +
        '<span>类型</span><b>行星 · openspec 会话</b>' +
        '<span>状态</span><b>' + (STATE_LABEL[p.state] || p.state) + kindText + '</b>' +
        '<span>关联恒星</span><b>' + escapeHtml(stars || '—') + '</b>' +
        satRow +
        '<span>todo</span><b>' + escapeHtml(p.todos ?? '—') + '</b>' +
        '<span>活跃</span><b>' + escapeHtml(p.when ?? '—') + '</b>' +
        '</div><button class="cd-btn" data-session="' + escapeHtml(p.id) + '">打开会话</button>';
    }
    if (e.kind === 'comet') {
      const c = e.data;
      const kindText = c.state === 'waiting' && c.pendingKind
        ? '（' + escapeHtml(PLAN_KIND_LABEL[c.pendingKind] || c.pendingKind) + '）'
        : '';
      const satRow = (c.satelliteCount || 0) > 0
        ? '<span>子代理</span><b>×' + c.satelliteCount + '</b>'
        : '';
      return '<div class="cd-title">☄ ' + escapeHtml(c.title) + '</div>' +
        '<div class="cd-grid">' +
        '<span>类型</span><b>彗星 · 自由会话</b>' +
        '<span>状态</span><b>' + (STATE_LABEL[c.state] || c.state || STATE_LABEL.idle) + kindText + '</b>' +
        satRow +
        '<span>活跃</span><b>' + escapeHtml(c.when ?? '—') + '</b>' +
        '</div><button class="cd-btn" data-session="' + escapeHtml(c.id) + '">打开会话</button>';
    }
    return '';
  }

  function updateOverlay() {
    const W = E.W, H = E.H;
    // 空态（任务 5.7）：无工作区 → 居中提示，隐藏 chip（右上提示行已随 HUD 精简移除）
    const hasWs = E.scene.ws.length > 0;
    E.el.empty.style.display = hasWs ? 'none' : 'block';
    if (!hasWs) {
      E.el.empty.innerHTML = '<b>COSMOS</b>暂无在册工作区 —— 在 DSH 中登记工作区后，星座将在此点亮';
    }

    // 左上星座标牌（D4/3.1–3.2）：钻取态显示「星座名 + 全量计数仪表」，位置取代已移除的
    // 面包屑。沿用旧 crumb 的内容差分守卫（dataset.html 模式同信息卡 data-sig）：每帧
    // innerHTML 重写会让内部元素活不过一帧——旧面包屑「点击银河无响应」的根因
    // （add-comet-states-and-star-death 5.1）；内容不变零重写。
    // 显示阈值沿用旧 crumb 的 focusMix > 0.4（与钻取镜头推进同步，不闪）。
    let badge = '';
    if (E.focusWs && E.focusMix > 0.4) {
      badge = '<b>' + escapeHtml(E.focusWs.name) + '</b><span>' + countsHtml(E.focusWs) + '</span>';
    }
    if (E.el.badge.dataset.html !== badge) { E.el.badge.innerHTML = badge; E.el.badge.dataset.html = badge; }

    // 星座 chip(仅银河视图)
    Object.keys(E.chips).forEach(function (id) {
      const ws = E.scene.ws.filter(function (x) { return x.id === id; })[0];
      const el = E.chips[id];
      if (!ws || !ws.vis || E.focusMix > 0.55 || !ws.proj) { el.classList.remove('on'); return; }
      el.classList.add('on');
      el.style.opacity = String(clamp(ws.alpha * (1 - E.focusMix * 1.6), 0, 1));
      el.style.transform = 'translate(' + ws.proj.x.toFixed(1) + 'px,' + (ws.proj.y - 26).toFixed(1) + 'px) translate(-50%,-100%)';
    });

    // 恒星名牌（钻取态显示 + hover/selected 焦点显示）
    Object.keys(E.slabs).forEach(function (id) {
      const slab = E.slabs[id];
      let info = null, ownerWs = null;
      E.scene.ws.forEach(function (ws) {
        if (!ws.vis) return;
        ws.stars.forEach(function (s) { if (s.id === id) { info = s; ownerWs = ws; } });
      });
      const key = 'star:' + id;
      const scr = E.screens[key];
      const inSystem = ownerWs && E.focusWs && ownerWs.id === E.focusWs.id && E.focusMix > 0.5;
      const focused = (E.selected && entKey(E.selected) === key) || (E.hovered && entKey(E.hovered) === key);
      if (!info || !scr || !ownerWs || !(inSystem || focused)) { slab.classList.remove('on'); return; }
      slab.classList.add('on');
      slab.style.opacity = String(focused ? 1 : clamp(ownerWs.alpha * 0.9, 0, 1));
      slab.style.transform = 'translate(' + scr.x.toFixed(1) + 'px,' + (scr.y + scr.r + 6).toFixed(1) + 'px) translate(-50%,0)';
    });

    // 信息卡
    const ent = E.hovered || E.selected;
    if (!ent) { E.el.card.classList.remove('on'); return; }
    const key2 = entKey(ent);
    const scr2 = E.screens[key2];
    if (!scr2) { E.el.card.classList.remove('on'); return; }
    /* 内容签名差分（data-sig = kind:id + state + pendingKind）：hover 中状态翻转
       即时刷新状态行——data-key = kind:id 恒不变导致文案滞留旧态（修复点与本
       change 的彗星状态行特性直接相关）；签名不变零重写。 */
    const sig = key2 + '|' + (ent.data?.state ?? '') + '|' + (ent.data?.pendingKind ?? '');
    if (E.el.card.dataset.sig !== sig) {
      E.el.card.innerHTML = cardHtml(ent);
      E.el.card.dataset.sig = sig;
      E.el.card.setAttribute('data-key', key2);
    }
    E.el.card.classList.add('on');
    const flip = scr2.x > W - 300;
    const cx = flip ? scr2.x - 18 : scr2.x + 18;
    const cy = clamp(scr2.y - 10, 70, H - 240);
    E.el.card.style.transform = 'translate(' + cx.toFixed(1) + 'px,' + cy.toFixed(1) + 'px)' + (flip ? ' translateX(-100%)' : '');
  }

  /* ---------- 输入（容器级绑定；坐标经 canvas 相对化，去 window 全屏假设） ---------- */

  /**
   * 指针输入绑定（polish-cosmos-touch-nav D1/D2：绑 `.cos-root` 容器，非 canvas、非逐元素）：
   *  - wheel / pinch 统一在容器级（一处覆盖 canvas + 全部覆盖元素，未来元素自动继承），
   *    消除「覆盖元素上的缩放死区」——兄弟 DOM（chip/信息卡）挡事件是根因；
   *  - **目标过滤与捕获策略**（指针重绑新增暗礁）：起指目标为覆盖交互元素（非 canvas）
   *    MUST NOT `setPointerCapture`（捕获会把 pointerup 及派生 click 重定向到 root，
   *    chip 的 dive 永不派发），pointerup 亦 MUST NOT 执行容器级 pickAt 拾取（否则与
   *    chip click 叠加成二次 dive）。指针仍进 Map 参与多指追踪，拖拽旋转照常；
   *  - canvas 起指维持既有捕获 + pointerup 拾取语义（拖拽越界不丢事件、空白处清选中）；
   *  - pointerdown 的 preventDefault 保留：Pointer Events 规范中 click 不属兼容鼠标事件，
   *    不会被其抑制，不影响上述 click 派发。
   */
  function bindInput(root) {
    const canvas = E.el.canvas;
    let sx = 0, sy = 0;
    /* 已 setPointerCapture 的指针 id：这类指针离开容器仍会收到 pointerup（捕获语义），
       区别于无捕获指针（触屏从覆盖元素起手划出边界）需在 pointerleave 时清理。 */
    const captured = new Set();

    /** 起指/抬指目标是否落在覆盖元素上（非 canvas）。 */
    function onOverlayTarget(ev) {
      return ev.target !== canvas;
    }
    /** 当前两指针间距（pinch 用；不足两指 → 0）。 */
    function pinchDist() {
      if (E.pointers.size < 2) return 0;
      const it = E.pointers.values();
      const a = it.next().value, b = it.next().value;
      return Math.hypot(b.x - a.x, b.y - a.y);
    }
    /** 第二指落下瞬间切 pinch：记基准指距 d0 与基准 dist0，清拖拽累积。 */
    function beginPinch() {
      const d0 = pinchDist();
      if (!(d0 > 0)) return;
      E.pinch = { d0: d0, dist0: E.cam.dist };
      E.gesture = true;
      E.dragging = false; // 捏合起手 MUST NOT 残留拖拽累积（否则收尾误判 wasDrag）
    }
    /** 手势收尾：清 pinch/拖拽累积；全部抬起 → 清 gesture 并开抑制窗。 */
    function endGesturePointer(ev) {
      E.pointers.delete(ev.pointerId);
      if (E.pointers.size === 0) {
        E.gesture = false;
        E.pinch = null;
        E.dragging = false; // 收尾清拖拽累积（否则 hover 恢复被 wasDrag 残留挡住）
        E.gestureEndAt = performance.now();
        return;
      }
      /* 剩指重置为单指起点（D2）：否则结束捏合瞬间被 wasDrag 判定吞掉拾取或误续接旋转。 */
      const rest = E.pointers.values().next().value;
      sx = rest.x; sy = rest.y;
      E.dragging = false;
      E.pinch = null; // 任意一指抬起结束 pinch（剩指回到单指旋转语义）
    }

    root.addEventListener('pointerdown', function (ev) {
      ev.preventDefault(); // 拖拽起点不触发文本选取/原生拖拽（CSS user-select 兜底）
      E.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (!onOverlayTarget(ev) && typeof canvas.setPointerCapture === 'function') {
        canvas.setPointerCapture(ev.pointerId);
        captured.add(ev.pointerId);
      }
      if (E.pointers.size === 2) { beginPinch(); return; }
      if (E.pointers.size === 1) {
        sx = ev.clientX; sy = ev.clientY;
        E.dragging = false;
      }
    });
    root.addEventListener('pointermove', function (ev) {
      /* hover 探针只在 canvas 上跟随（保持既有语义）：覆盖元素（信息卡/chip/按钮）
         上移动指针 MUST NOT 改写命中点——否则指针移向信息卡时命中变 null，卡片在
         指针抵达「打开会话」按钮前就消失（canvas 单绑时天然成立，容器级重绑必须显式保留）。
         拖拽旋转/捏合仍对任意起指目标生效（用的是 dx/dy 与多指针 Map，不经 hover 探针）。 */
      if (!onOverlayTarget(ev)) {
        const rect = canvas.getBoundingClientRect();
        E.px = ev.clientX - rect.left; E.py = ev.clientY - rect.top;
        E.pointerIn = true;
      }
      const tracked = E.pointers.get(ev.pointerId);
      if (tracked) { tracked.x = ev.clientX; tracked.y = ev.clientY; }
      /* 多指仍按着但 pinch 基准已失效（三指中落一指等）→ 以当前指距重锚基准。 */
      if (E.pointers.size >= 2 && !E.pinch && E.gesture) beginPinch();
      /* 捏合缩放（D2）：cam.dist = clamp(dist0 * d0/d)，张开 = 放大，与滚轮同值域；
         捏合接管即取消补间（与拖拽/WASD/滚轮同语义）。 */
      if (E.pointers.size >= 2 && E.pinch) {
        const d = pinchDist();
        if (d > 0) {
          cancelTween();
          E.cam.dist = clamp(E.pinch.dist0 * (E.pinch.d0 / d), DIST_MIN, DIST_MAX);
        }
        return;
      }
      if (ev.buttons & 1) {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (E.dragging || Math.abs(dx) + Math.abs(dy) > 4) {
          E.dragging = true;
          cancelTween();
          E.cam.yaw += dx * 0.005;
          E.cam.pitch = clamp(E.cam.pitch + dy * 0.005, -1.35, 1.35);
          sx = ev.clientX; sy = ev.clientY;
        }
      }
    });
    root.addEventListener('pointerup', function (ev) {
      captured.delete(ev.pointerId);
      /* 多指手势收尾（D2）：手势期间 pointerup MUST NOT 拾取；全部抬起后 record
         手势结束时刻，供 click 抑制窗使用。 */
      if (E.gesture) { endGesturePointer(ev); return; }
      E.pointers.delete(ev.pointerId);
      const wasDrag = E.dragging;
      E.dragging = false;
      if (wasDrag) return;
      /* 手势抑制窗（D2）：捏合结束后 350ms 内的抬指不拾取（防误 dive）。 */
      if (gestureSuppressed()) return;
      /* 目标过滤（D2）：覆盖元素起指的抬指不拾取——chip 点击已由自身 click 触发 dive，
         容器级拾取叠加会变成二次 dive。 */
      if (onOverlayTarget(ev)) return;
      const rect = canvas.getBoundingClientRect();
      const hit = pickAt(ev.clientX - rect.left, ev.clientY - rect.top);
      if (!hit) { E.selected = null; return; }
      if (E.focusMix > 0.5) E.selected = hit;
      else dive(hit.ws, hit.data);
    });
    /* 指针被系统取消（触屏手势被浏览器接管等）：只清追踪，MUST NOT 拾取。 */
    root.addEventListener('pointercancel', function (ev) {
      captured.delete(ev.pointerId);
      if (E.gesture) { endGesturePointer(ev); return; }
      E.pointers.delete(ev.pointerId);
      E.dragging = false;
    });
    root.addEventListener('pointerleave', function () {
      E.pointerIn = false;
      /* 无捕获指针离开容器后其 pointerup 不再回到 root（触屏从覆盖元素起手划出边界后
         抬起）→ 清掉这类「幽灵指针」：否则下一次单指点按会被误判为双指捏合。
         有 pointer capture 的指针仍会收到 pointerup，保留追踪。 */
      for (const id of [...E.pointers.keys()]) {
        if (!captured.has(id)) E.pointers.delete(id);
      }
      if (E.pointers.size === 0) {
        E.dragging = false;
        if (E.gesture) { E.gesture = false; E.pinch = null; E.gestureEndAt = performance.now(); }
        return;
      }
      if (E.pinch && E.pointers.size < 2) {
        E.pinch = null;
        const rest = E.pointers.values().next().value;
        sx = rest.x; sy = rest.y;
        E.dragging = false;
      }
    });
    root.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      /* 滚轮接管即取消补间（add-cosmos-search-filter 2.5）：现状滚轮只改 dist 不取消
         tween，补间期间滚轮输入会被 stepTween 逐帧覆写（相机缩放被抢走）——与拖拽/
         WASD 的既有取消语义对齐。 */
      cancelTween();
      /* 值域 [24, 4200]：近可贴到恒星表面（dive 视距 155 的一半以下），
         远可容纳整个星系（默认 430 的近 10 倍）——真机反馈 90/1200 太局促。 */
      E.cam.dist = clamp(E.cam.dist * (1 + ev.deltaY * 0.0012), DIST_MIN, DIST_MAX);
    }, { passive: false });
  }

  /* ---------- WASD 平移键（window 级；随引擎 dispose 卸载） ---------- */

  /* 焦点落在可编辑元素（宿主输入框/文本域/contenteditable）时 SHALL NOT 劫持按键
     ——守卫为模块级纯函数 `isEditableTarget`（2.8 导出供冒烟断言防回归；React
     搜索框聚焦时字符进输入框、相机不平移）。 */

  function bindPanKeys() {
    const panKeyOf = function (ev) {
      const code = String(ev.code ?? "");
      if (code === "ShiftLeft" || code === "ShiftRight") return "shift"; // 加速档
      const key = code.slice(3).toLowerCase(); // KeyW → "w"（键位布局无关）
      return PAN_KEYS.indexOf(key) >= 0 ? key : null;
    };
    const onKeyDown = function (ev) {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return; // 组合键（Ctrl+W 等）不劫持
      const key = panKeyOf(ev);
      if (!key) return;
      if (ev.isComposing || isEditableTarget(document.activeElement)) return;
      E.panKeys.add(key);
      ev.preventDefault(); // 吞掉宿主同键默认行为（快速查找等）
    };
    const onKeyUp = function (ev) {
      const key = panKeyOf(ev);
      if (!key) return;
      E.panKeys.delete(key);
    };
    const clearKeys = function () { E.panKeys.clear(); }; // 失焦/隐藏后 keyup 丢失 → 清键防漂移
    const onVisibility = function () { if (document.hidden) clearKeys(); };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clearKeys);
    document.addEventListener("visibilitychange", onVisibility);
    E.keyListeners = function () {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clearKeys);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }

  /* ---------- 尺寸（ResizeObserver 跟踪容器，去 window.innerWidth） ---------- */

  function resize() {
    const rect = E.container.getBoundingClientRect();
    E.W = Math.max(1, Math.round(rect.width));
    E.H = Math.max(1, Math.round(rect.height));
    E.dpr = window.devicePixelRatio || 1;
    const c = E.el.canvas;
    c.width = Math.round(E.W * E.dpr);
    c.height = Math.round(E.H * E.dpr);
    c.style.width = E.W + 'px';
    c.style.height = E.H + 'px';
  }

  /* ---------- 主循环 ---------- */

  function frame(ts) {
    if (!E.running || E.disposed) return;
    const dt = E.lastTs ? clamp((ts - E.lastTs) / 1000, 0, 0.1) : 0.016;
    E.lastTs = ts;
    E.t += dt;
    stepTween(E.t);
    /* WASD 平移（按住持续、帧率无关；手动位移打断 dive/飞回补间）。 */
    if (panCameraTarget(E.cam, E.panKeys, dt, E.tuning)) cancelTween();
    /* 场景未就绪守卫：attach 先于首帧 providers merge 时（首开竞态 / 上游重建
       失败），E.scene 为 null——跳帧等待而非崩溃（Cannot read 'ws' of null）。 */
    if (!E.scene) { E.raf = requestAnimationFrame(frame); return; }
    updateScene(E.t, dt);

    const ctx = E.ctx, style = E.style;
    ctx.setTransform(E.dpr, 0, 0, E.dpr, 0, 0);

    const cam = E.cam;
    const bgStars = [];
    E.scene.bg.forEach(function (b) {
      const pr = project(cam, b.p, E.W, E.H);
      if (pr) bgStars.push({ x: pr.x, y: pr.y, m: b.m, a: clamp(1 - pr.z / 2400, 0.04, 0.8) * (0.45 + 0.55 * b.m) });
    });
    let band = null;
    if (style.useBand) {
      band = [];
      E.scene.band.forEach(function (b) {
        const pr = project(cam, b.p, E.W, E.H);
        if (pr) band.push({ x: pr.x, y: pr.y, m: b.m, a: clamp(1 - pr.z / 2600, 0.02, 0.5) * (0.3 + 0.7 * b.m) });
      });
    }
    const view = { W: E.W, H: E.H, t: E.t, bgStars: bgStars, band: band };

    style.background(ctx, view);

    const items = buildItems(E.t);
    for (let i = 0; i < items.length; i++) style.drawBody(ctx, items[i], view);

    E.hovered = (E.pointerIn && !E.dragging) ? pickAt(E.px, E.py) : null;
    E.el.canvas.style.cursor = E.hovered ? 'pointer' : (E.dragging ? 'grabbing' : 'grab');

    updateOverlay();
    E.raf = requestAnimationFrame(frame);
  }

  /** 结构重建后按 id 迁移焦点/选中引用（buildScene 产出全新 ws/body 对象——旧引用
      失配会让 dive 焦点判断落空 → 全场景塌到未聚焦亮度，真机「运行一会儿全暗」
      根因；工作区消失时一并清钻取/选中态）。
      add-transition-choreography 5.3：钻取中焦点星座被注销 → 补 flyOut()——修复
      只清引用不清 focusMix、镜头卡 1 全场景停 0.12 半暗态的 wart（spec「钻取中
      焦点星座消失自动飞回」）。 */
  function remapFocusRefs() {
    if (E.focusWs) {
      const mapped = E.scene.ws.find(function (w) { return w.id === E.focusWs.id; }) ?? null;
      if (!mapped) {
        E.focusWs = null; // 先清引用再 flyOut（flyOut 以 focusWs/focusMix 判定早退）
        E.diveSel = null;
        E.selected = null;
        flyOut();
        return;
      }
      E.focusWs = mapped;
    }
    if (E.selected && E.selected.ws) {
      const ws = E.scene.ws.find(function (w) { return w.id === E.selected.ws.id; });
      if (!ws) { E.selected = null; return; }
      const list = E.selected.kind === 'star' ? ws.stars : E.selected.kind === 'planet' ? ws.planets : ws.comets;
      const data = list.find(function (x) { return x.id === E.selected.data.id; });
      E.selected = data ? { kind: E.selected.kind, ws: ws, data: data } : null;
    }
  }

  /** 结构重建后按新集合 prune 幽灵补间 Map（回归须彗星仍在册、捕获须行星仍在册）——
      E.captures 现状只在 dispose 清，同点补对称清理，防长驻 Map 泄漏。 */
  function pruneGhostMaps() {
    const cometIds = new Set(), planetIds = new Set();
    for (const ws of E.scene.ws) {
      for (const c of ws.comets) cometIds.add(c.id);
      for (const p of ws.planets) planetIds.add(p.id);
    }
    for (const id of [...E.regressions.keys()]) {
      if (!cometIds.has(id)) E.regressions.delete(id);
    }
    for (const id of [...E.captures.keys()]) {
      if (!planetIds.has(id)) E.captures.delete(id);
    }
  }

  /* ---------- 转场编排（add-transition-choreography：D6 序曲 / D7 调度器） ---------- */

  const bootEndAt = function () { return E.bootT0 != null ? E.bootT0 + BOOT_DUR : Infinity; };
  /** 冷启动序曲窗口判定：boot 锚定后 1.2s 内 → true（窗口内事件转场转 enqueue 延迟）。 */
  function isBooting(t) { return E.bootT0 != null && t - E.bootT0 < BOOT_DUR; }
  function staggerOf(priority) {
    return priority === FX_PRIORITY.narrative ? FXQ.STAGGER_P1
      : priority === FX_PRIORITY.existence ? FXQ.STAGGER_P2 : 0;
  }
  const stagKey = function (priority, wsId) { return priority + "|" + wsId; };

  /** fx 条目写入（2.1）：t0 = E.t + delay——delay 段 k=0 天然不可见，fx 过期判定对
      t<t0 安全；degraded = 风暴降级形态（birth 缩纯 α 坡道，skin-d 消费）。 */
  function applyFx(kind, id, type, dur, degraded, delay) {
    E.fx.set(kind + ':' + id, { type, t0: E.t + (delay || 0), dur, degraded: degraded === true });
  }

  /** 延迟启动队列入队（D7 统一入口）：bootUntil = 序曲窗口内入队 → 序曲结束时刻
      （转场延迟启动而非丢弃——属性沿差分当帧已消费，直接丢弃则永久丢失）。 */
  function enqueueMarker(item) {
    item.enqueueAt = E.t;
    item.bootUntil = isBooting(E.t) ? bootEndAt() : null;
    item.fireAt = item.enqueueAt + (item.delay || 0); // 观测面字段（真实裁决在 pump：错峰/并发/风暴）
    E.fxQueue.push(item);
    return item;
  }

  /** 每帧出队（D7/7.1/7.2）：启动条件 = max(bootUntil, enqueueAt+delay, 上一同 ws
      启动时刻+错峰步长) ≤ t 且 P1 并发 < 3；风暴（待启动积压 > 阈值）时未启动
      P1/P2 降级执行、P0 不经队列；只延迟启动，MUST NOT 打断进行中动画（已启动
      条目在 fxActive 窗口内照常播完）。积压消化后阈值比较即自动恢复（无退出流程）。 */
  function pumpFxQueue(t) {
    E.fxActive = E.fxActive.filter(function (a) { return t - a.startedAt < a.activeDur; });
    const storm = E.fxQueue.length > FXQ.STORM_BACKLOG;
    let activeP1 = 0;
    for (const a of E.fxActive) if (a.priority === FX_PRIORITY.narrative) activeP1++;
    const keep = [];
    for (const item of E.fxQueue) {
      const last = item.wsId != null
        ? (E.fxLastStart.get(stagKey(item.priority, item.wsId)) ?? -Infinity)
        : -Infinity;
      const notBefore = Math.max(item.bootUntil ?? 0, item.enqueueAt + (item.delay || 0), last + staggerOf(item.priority));
      if (t < notBefore || (item.priority === FX_PRIORITY.narrative && activeP1 >= FXQ.CONCURRENCY_P1)) {
        keep.push(item);
        continue;
      }
      item.fire(storm); // 降级开关在启动帧裁决——只影响未启动事件
      E.fxActive.push({ priority: item.priority, startedAt: t, activeDur: item.activeDur || 1 });
      if (item.wsId != null) E.fxLastStart.set(stagKey(item.priority, item.wsId), t);
      if (item.priority === FX_PRIORITY.narrative) activeP1++;
    }
    E.fxQueue = keep;
    E.fxStorm = E.fxQueue.length > FXQ.STORM_BACKLOG; // 积压消化 → 阈值比较即退出风暴
  }

  /* ---------- 公共面 ---------- */

  const engine = {
    /** providers 合并 scene 注入：level "rebuild"（结构重建）| "patch"（属性补丁）。 */
    setScene(sceneData, level) {
      E.sceneData = sceneData;
      if (!E.scene || level === 'rebuild') {
        captureLinkMix(E.scene, sceneData); // 连线集合变化段状态跨 rebuild 差分（8.1，替换前捕获）
        captureCenterTweens(E.scene, sceneData); // 星座集合变化中心捕获（D5/2.1，替换前捕获）
        E.scene = buildScene(sceneData);
        pruneFilterScene(); // 过滤态按新集合收敛（已消失 ws 的坡道/命中位摘除；全消失 → 关闭）
        placeFilterTargets(); // 过滤激活 → 命中星座直接落位（2.4，不重播位移补间；filterRamp 存活不闪帧）
        applyCenterSlides(E.t); // 存量星座滑移起坡（D5：终态仍为 buildScene 确定性输出）
        pruneGhostMaps(); // rebuild 后按新集合清理幽灵补间 Map（regressions/captures）
        remapFocusRefs();
        if (E.el.root) rebuildOverlayDom();
      } else {
        // 属性级补丁：同 id 天体就地更新（act/lifecycle/tasks/state/todos/when/卫星/计数）
        patchScene(E.scene, sceneData);
        updateChipText();
      }
      /* 冷启动点亮序曲锚定（6.1/D6）：首帧场景注入即计时；重挂载场景已在则 start()
         亦锚定（E.t 渲染暂停期冻结 → 页关期间注入的序曲在开页后照播）。 */
      if (E.bootT0 == null) E.bootT0 = E.t;
    },
    /** 上一帧 providers scene（客户端补丁判定用）。 */
    getScene() { return E.sceneData; },
    start() {
      if (E.disposed || E.running) return;
      E.running = true;
      E.lastTs = 0;
      if (E.scene && E.bootT0 == null) E.bootT0 = E.t; // 重挂载场景已在 → start 即锚定序曲（6.1）
      E.raf = requestAnimationFrame(frame);
    },
    stop() {
      E.running = false;
      if (E.raf) { cancelAnimationFrame(E.raf); E.raf = 0; }
    },
    /** Esc 分层消费（外壳单点 keydown 调用）：钻取返回/清选中 → true；无消费 → false。 */
    consumeEscape() {
      if (E.focusMix > 0.05 || E.focusWs) { flyOut(); return true; }
      if (E.selected) { E.selected = null; return true; }
      return false;
    },
    isDiving() { return isDiving(); },
    flyOut,
    /** 钻取到指定星座（add-cosmos-add-workspace D4/3.1）：按 id 在场景查星座，命中 →
        复用既有 `dive(ws, null)`（tweenTo 1300ms，与 chip 点击同一语义；钻取态下替换
        焦点）；未命中（星座尚未注入）→ 返回 false，不抛错（调用方自行决定降级）。 */
    diveToWs(wsId) {
      if (E.disposed || !E.scene || wsId == null) return false;
      const ws = E.scene.ws.find(function (w) { return w.id === wsId; });
      if (!ws) return false;
      dive(ws, null);
      return true;
    },
    /**
     * 搜索过滤应用（add-cosmos-search-filter 2.2 公共面 / design D1）：
     *  - `matchedIds` 为空集 = **过滤关闭**（回到全显 + 骨架原位置）——但查询无匹配时
     *    需要「全部隐藏 + 空态」这一不同态：由 `opts.active === true` 显式声明过滤
     *    已激活（spec 空匹配场景），此时空集 = 命中 0 个（全部淡隐、不触发 fit）；
     *  - 与当前过滤态（matched 集合 + pos 逐项）相等 → 短路 no-op（防 SSE 幂等
     *    重发重锚坡道/重起补间）；
     *  - 应用后顺序：α 坡道重锚 → 位移补间/回归 → 钻取互斥裁决 → camera-fit 重定向
     *    （空匹配/钻取态跳过；钻取排除留收尾补 fit）。
     * @param {Set<string>|string[]} matchedIds 命中工作区 id
     * @param {Map<string, number[]>|object} [posMap] 命中子集布局位置（id → [x,y,z]）
     * @param {{active?: boolean}} [opts] active: 空集时是否仍视为「过滤激活」
     * @returns {boolean} 是否真正应用（false = 短路/无场景/已销毁）
     */
    setFilter(matchedIds, posMap, opts) {
      if (E.disposed || !E.scene) return false;
      const matched = matchedIds instanceof Set
        ? new Set(matchedIds)
        : new Set(Array.isArray(matchedIds) ? matchedIds : []);
      const pos = normalizeFilterPos(posMap);
      const active = typeof opts?.active === "boolean" ? opts.active : matched.size > 0;
      const next = active ? { matched, pos } : null;
      if (sameFilterState(next)) return false;
      const fromAlphas = captureFilterAlphas(E.t); // 旧过滤态快照（必须在替换 E.filter 之前）
      E.filter = next;
      anchorFilterRamps(E.t, fromAlphas);
      applyFilterPositions(E.t);
      const excluded = adjudicateFilterFocus();
      if (!excluded) fitCameraToFilterTargets();
      return true;
    },
    /** 过滤观测面（2.6，只读快照供冒烟直测）：过滤态/命中集合/目标位/在途位移补间数/
        未完成 α 坡道数/各 ws 过滤 α 与最终 α/vis/中心/拾取数/camera-fit 参数/镜头实况。 */
    inspectFilter() {
      const wsList = E.scene?.ws ?? [];
      const t = E.t;
      const pickCount = new Map();
      for (const pick of E.picks) {
        const wsId = pick?.e?.ws?.id;
        if (wsId != null) pickCount.set(wsId, (pickCount.get(wsId) ?? 0) + 1);
      }
      return {
        active: E.filter != null,
        matched: E.filter ? [...E.filter.matched].sort() : [],
        pos: E.filter ? [...E.filter.pos.entries()].map(function (pair) { return [pair[0], pair[1].slice()]; }) : [],
        anims: wsList.filter(function (w) { return w.centerAnim != null; }).length,
        ramps: [...E.filterRamp.values()].filter(function (r) { return t - r.t0 < FILTER_RAMP_DUR; }).length,
        alphas: wsList.map(function (w) { return [w.id, w.alpha]; }), // 最终 α（三因子相乘）
        filterAlphas: wsList.map(function (w) { return [w.id, w.filterAlpha == null ? null : w.filterAlpha]; }),
        vis: wsList.map(function (w) { return [w.id, w.vis === true]; }),
        centers: wsList.map(function (w) { return [w.id, w.center.slice()]; }),
        picks: wsList.map(function (w) { return [w.id, pickCount.get(w.id) ?? 0]; }),
        fit: E.lastFilterFit
          ? { target: E.lastFilterFit.target.slice(), dist: E.lastFilterFit.dist, radius: E.lastFilterFit.radius }
          : null,
        focus: { id: E.focusWs?.id ?? null, diving: isDiving(), fitPending: E.filterFitPending === true },
        tween: E.tween
          ? { mode: E.tween.endMode ?? null, dur: E.tween.dur, to: { target: E.tween.to.target.slice(), dist: E.tween.to.dist } }
          : null,
        camera: { target: E.cam.target.slice(), yaw: E.cam.yaw, pitch: E.cam.pitch, dist: E.cam.dist }
      };
    },
    /** 输入观测面（polish-cosmos-touch-nav 6.1/6.3，只读快照供冒烟直测）：
        多指针追踪数 / 捏合基准 / 手势抑制窗 / dive 计数（容器级重绑「单次 dive」防回归）。 */
    inspectInput() {
      return {
        pointers: E.pointers.size,
        gesture: E.gesture === true,
        pinch: E.pinch ? { d0: E.pinch.d0, dist0: E.pinch.dist0 } : null,
        gestureEndAt: E.gestureEndAt,
        suppressed: gestureSuppressed(),
        dragging: E.dragging === true,
        dives: E.diveCount
      };
    },
    /** 事件驱动流星（新引擎能力）：origin 为天体世界坐标（缺省银河上缘随机点）。 */
    spawnEventMeteor(origin) {
      const ws0 = E.scene?.ws?.[0];
      const c0 = ws0 ? wsCenter(ws0, E.t) : null;
      const p0 = Array.isArray(origin) && origin.length === 3
        ? origin.slice()
        : [c0 ? c0[0] : 0, 80, c0 ? c0[2] : 0];
      E.eventMeteors.push(Object.assign(makeMeteor(p0, E.t, 1.4), { id: '__event' }));
    },
    /** 成星捕获动画（新引擎能力）：彗星 sessionId 被关联成行星时调用。 */
    markCapture(sessionId) {
      if (!sessionId) return;
      E.captures.set(sessionId, E.t);
      for (const ws of E.scene?.ws ?? []) {
        const planet = ws.planets.find((p) => p.id === sessionId);
        if (planet) planet.captureStart = E.t;
      }
    },
    /** 行星回归彗星反向捕获（E.captures 镜像）：from = 行星最后轨道世界坐标。
        调用方 MUST 在 setScene 前调用（旧场景行星体仍在，worldPosOf 才查得到——
        与卫星消亡流星同款时序约束）；from 缺失/非法 → 不标记（彗星直接出现）。
        P2 存在转场，经 D7 调度器（错峰/风暴/序曲延迟）；补间 t0 在启动帧重锚。 */
    markRegression(sessionId, from, opts) {
      if (E.disposed || !sessionId || !Array.isArray(from) || from.length !== 3) return;
      const entry = { t0: E.t, from: [from[0], from[1], from[2]] };
      enqueueMarker({
        priority: FX_PRIORITY.existence,
        wsId: opts?.wsId ?? null,
        delay: 0,
        activeDur: FX_ACTIVE_DUR.regression,
        fire: function () {
          entry.t0 = E.t; // 延迟启动（序曲/错峰）→ 补间锚点重置到启动帧
          E.regressions.set(sessionId, entry);
          for (const ws of E.scene?.ws ?? []) {
            const comet = ws.comets.find((c) => c.id === sessionId);
            if (comet) { comet.from = entry.from.slice(); comet.regressStart = entry.t0; comet.regressAlpha = 0; }
          }
        }
      });
    },
    /** 恒星超新星转场（幽灵列表）：worldPos 原位、color = 恒星临终生命周期色；
        opts.intensity 0.3 = 星胚低强度消散变体（0.8s，无爆闪/冲击波）；
        opts.driftTo = 残骸漂移目标快照点（星座中心，标记时定格）；opts.wsId = 星座 id
        （P1 叙事，经 D7 调度器：并发 ≤3 + 同 ws 错峰 ≥0.25s + 风暴降级 + 序曲延迟）。 */
    markStarNova(id, worldPos, color, opts) {
      if (E.disposed) return; // 幽灵瞬态 SHALL NOT 跨引擎实例（dispose 后标记为 no-op）
      enqueueMarker({
        priority: FX_PRIORITY.narrative,
        wsId: opts?.wsId ?? null,
        delay: 0,
        activeDur: FX_ACTIVE_DUR.nova,
        fire: function (degraded) {
          const o = degraded ? Object.assign({}, opts, { degraded: true }) : opts;
          E.novae.push(makeNova(id, worldPos, color, o, E.t));
        }
      });
    },
    /** 星座消散幽灵（5.1/D5）：ws 集合减少时由 client 差分调用——引擎在 setScene
        替换前自快照该星座尘埃 offsets 与恒星位置/色（client prev 场景无尘埃 offsets，
        MUST NOT 在 client 组装快照）；序曲窗口内 → 快照即取、延迟到序曲结束入列表。 */
    markWsGhost(wsId) {
      if (E.disposed) return;
      const ghost = snapshotWsGhost(wsId);
      if (!ghost) return;
      if (isBooting(E.t)) {
        enqueueMarker({
          priority: FX_PRIORITY.narrative, wsId: null, delay: 0, activeDur: WS_GHOST_DUR,
          fire: function () { ghost.t0 = E.t; E.wsGhosts.push(ghost); } // 快照定格，t0 锚定启动帧
        });
        return;
      }
      E.wsGhosts.push(ghost);
    },
    /** 幽灵/瞬态观测面（冒烟直测/调试，只读快照）：nova 条目数（含降级计数）+
        补间 Map 在册 id + 消散幽灵条目数。 */
    inspectGhosts() {
      return {
        novae: E.novae.length,
        degradedNovae: E.novae.filter(function (n) { return n.degraded === true; }).length,
        regressions: [...E.regressions.keys()],
        captures: [...E.captures.keys()],
        wsGhosts: E.wsGhosts.length
      };
    },
    /** 中心滑移观测面（add-cosmos-add-workspace 2.3 冒烟直测，只读快照）：捕获条目
        （E.centerTweens）+ 在途位移补间 id + 各 ws 当前中心（ws.center 由补间逐帧重算）。 */
    inspectSlides() {
      return {
        tweens: [...E.centerTweens.entries()].map(function (pair) {
          return { id: pair[0], from: pair[1].from.slice(), to: pair[1].to.slice(), t0: pair[1].t0 };
        }),
        anims: (E.scene?.ws ?? []).filter(function (w) { return w.centerAnim != null; }).map(function (w) { return w.id; }),
        centers: (E.scene?.ws ?? []).map(function (w) { return [w.id, w.center.slice()]; })
      };
    },
    /** 空星座出生高亮标记（add-cosmos-add-workspace D6/3.2）：client 差分对「新进入骨架
        且无天体内容」的星座调用；`rebuildOverlayDom` 为命中 chip 附加 `cos-chip-new`
        （~2s 脉冲渐熄 CSS，`forwards` 收尾即常态——无需 JS 清理；过期条目下次重建摘除）。 */
    markWsBirth(wsId) {
      if (E.disposed || wsId == null) return;
      E.wsBirth.set(String(wsId), E.t);
    },
    /** 转场 fx 观测面（2.5 冒烟直测用）：{key, type, t0, dur, degraded} 只读快照。 */
    inspectFx() {
      return [...E.fx.entries()].map(function (pair) {
        return { key: pair[0], type: pair[1].type, t0: pair[1].t0, dur: pair[1].dur, degraded: pair[1].degraded === true };
      });
    },
    /** 调度器观测面（7.3 冒烟直测用，D7 最小观测面）：待启动积压/P1 进行中并发/
        风暴开关/队列条目快照。 */
    inspectFxQueue() {
      return {
        pending: E.fxQueue.length,
        activeP1: E.fxActive.filter(function (a) { return a.priority === FX_PRIORITY.narrative; }).length,
        storm: E.fxStorm === true,
        items: E.fxQueue.map(function (i) { return { priority: i.priority, wsId: i.wsId, enqueueAt: i.enqueueAt, fireAt: i.fireAt, bootUntil: i.bootUntil }; })
      };
    },
    /** 天体实体观测面（2.2/2.5/3.1 冒烟直测用）：星座内行星/彗星（含卫星 born/
        colorMix）与尘埃计数只读快照。 */
    inspectEntities(wsId) {
      const ws = E.scene?.ws?.find(function (w) { return w.id === wsId; });
      if (!ws) return null;
      const satOf = function (s) { return { id: s.id, state: s.state, born: s.born ?? null, colorMix: s.colorMix ? { ...s.colorMix } : null }; };
      return {
        /* 恒星 off/wp（add-cosmos-search-filter 2.1/2.3）：位置补间三处重算点的观测面 —
           `wp === center + off`；off 为 body 补存字段（rebuild/patch 两路径一致）。 */
        stars: ws.stars.map(function (s) {
          return { id: s.id, off: (s.off ?? [0, 0, 0]).slice(), wp: (s.wp ?? [0, 0, 0]).slice() };
        }),
        planets: ws.planets.map(function (p) {
          return {
            id: p.id, state: p.state, colorMix: p.colorMix ? { ...p.colorMix } : null,
            center: (p.center ?? [0, 0, 0]).slice(), baseR: p.baseR,
            sats: (p.sats ?? []).map(satOf)
          };
        }),
        comets: ws.comets.map(function (c) {
          return { id: c.id, state: c.state, colorMix: c.colorMix ? { ...c.colorMix } : null, sats: (c.sats ?? []).map(satOf) };
        }),
        dustCount: ws.dustCount ?? 0,
        dustBornCount: (ws.dust ?? []).filter(function (d) { return d.born != null; }).length
      };
    },
    /** 转场编排（客户端属性差分触发）：ignite 点燃（proto→created，2.2s）/ stamp 落印
        （created→reviewed，1.6s）/ view 查看渐熄（done-unread→idle，2.2s×0.72 渐变段）/
        birth 出生（kind 级时长 FX_BIRTH_DUR）/ surge executed 金涌（1.2s——4.1 翻案
        add-celestial-states「executed 无独立转场」决定：apply 完成是常驻画面上最有
        叙事价值的事件之一）。
        opts.delay 延迟启动（星座凝聚错峰入参，t0 = E.t + delay；真实裁决经调度器）；
        opts.degraded 风暴降级形态；opts.wsId 供序曲延迟入队归组。
        冷启动序曲窗口内 → 转入队延迟（fire = 序曲结束，无事件丢失）。 */
    markFx(kind, id, type, opts) {
      if (E.disposed || !id) return;
      const dur = type === 'birth' ? (FX_BIRTH_DUR[kind] ?? FX_DUR.birth) : FX_DUR[type];
      if (!dur) return;
      if (isBooting(E.t)) {
        enqueueMarker({
          priority: type === 'birth' ? FX_PRIORITY.existence : FX_PRIORITY.narrative,
          wsId: opts?.wsId ?? null,
          delay: Math.max(0, Number(opts?.delay) || 0),
          activeDur: FX_ACTIVE_DUR[type] ?? dur,
          fire: function (degraded) { applyFx(kind, id, type, dur, degraded); }
        });
        return;
      }
      applyFx(kind, id, type, dur, opts?.degraded === true, Math.max(0, Number(opts?.delay) || 0));
    },
    /** 延迟启动队列入队（D7/7.1 公共面）：客户端 P1/P2 事件转场统一入口——
        fire 时间 = max(enqueueAt + delay, 上一同 ws 启动时刻 + 错峰步长)（序曲窗口内
        再取序曲结束）；P1 叙事并发 ≤3、同 ws 错峰 ≥0.25s；P2 存在错峰 ≥0.15s；
        P0（attention 属性）MUST NOT 经此——照常 markFx 直接启动。 */
    enqueueFx(kind, id, type, opts) {
      if (E.disposed || !id) return;
      const priority = Number.isFinite(Number(opts?.priority)) ? Number(opts.priority) : FX_PRIORITY.existence;
      if (priority === FX_PRIORITY.attention) { engine.markFx(kind, id, type, opts); return; }
      if (type !== 'birth' && !FX_DUR[type]) return;
      const dur = type === 'birth' ? (FX_BIRTH_DUR[kind] ?? FX_DUR.birth) : FX_DUR[type];
      const delay = Math.max(0, Number(opts?.delay) || 0);
      enqueueMarker({
        priority,
        wsId: opts?.wsId ?? null,
        delay,
        activeDur: FX_ACTIVE_DUR[type] ?? dur,
        fire: function (degraded) { applyFx(kind, id, type, dur, degraded); }
      });
    },
    /** 天体世界坐标查询（事件流星起点）：kind 'planet'|'comet'。 */
    worldPosOf(kind, id) {
      for (const ws of E.scene?.ws ?? []) {
        const list = kind === 'planet' ? ws.planets : kind === 'comet' ? ws.comets : [];
        const found = list.find((p) => p.id === id);
        if (found) return found.wp.slice();
      }
      return null;
    },
    toast,
    /** 平移调参热更新（设置面持久化后调用，无需重开整页）：{ panSpeed, panShiftBoost }。 */
    setTuning(settings) {
      if (Number(settings?.panSpeed) > 0) E.tuning.speed = settings.panSpeed;
      if (Number(settings?.panShiftBoost) > 0) E.tuning.boost = settings.panShiftBoost;
    },
    getTuning() {
      return { panSpeed: E.tuning.speed, panShiftBoost: E.tuning.boost };
    },
    dispose() {
      E.disposed = true;
      engine.stop();
      E.keyListeners?.(); // WASD window 监听卸载（SHALL NOT 泄漏宿主按键面）
      E.panKeys.clear();
      E.captures.clear();
      E.regressions.clear();
      E.novae.length = 0; // 幽灵瞬态随引擎实例销毁（SHALL NOT 跨实例续播）
      E.wsGhosts.length = 0; // 消散幽灵随实例销毁（5.1）
      E.fxQueue.length = 0; // 延迟启动队列随实例销毁
      E.fxActive.length = 0;
      E.fxLastStart.clear();
      E.fxStorm = false;
      E.linkMix.clear(); // 连线段状态随实例销毁（8.1）
      /* 搜索过滤态随引擎实例销毁（2.6）：查询为会话态、MUST NOT 跨实例/跨页开合。
         位移补间挂 ws body（scene 置空即弃），α 坡道为引擎级 Map 需显式清。 */
      E.filter = null;
      E.filterRamp.clear();
      E.filterFitPending = false;
      E.lastFilterFit = null;
      E.centerTweens.clear(); // 中心滑移捕获随实例销毁（D5：呈现层瞬态）
      E.wsBirth.clear(); // 空星座出生高亮标记随实例销毁（D6）
      E.bootT0 = null;
      E.fx.clear();
      E.resizeObserver?.disconnect();
      E.el.root?.remove();
      E.scene = null;
      E.chips = {}; E.slabs = {};
    }
  };

  /** 属性级补丁（任务 4.8 引擎侧消费）：保住 dust/trail/镜头，只更新属性。
      add-celestial-states：卫星数组就地替换（属性补丁路径，subagent 起停不重建）、
      恒星 lifecycle/setBy/at、行星 delegatedBusy/satelliteCount。
      add-comet-states-and-star-death：彗星 state/pendingKind（状态色 patch 级换色）。 */
  function patchScene(scene, sceneData) {
    const nextWs = Array.isArray(sceneData?.workspaces) ? sceneData.workspaces : [];
    for (const next of nextWs) {
      const ws = scene.ws.find((w) => w.id === next.id);
      if (!ws) continue;
      ws.name = next.name ?? ws.name;
      const prevArchives = ws.archives;
      ws.archives = next.archives ?? ws.archives;
      /* 星云增量（1.2/D1）：archives 变化（patch 级判级）→ 按同 per-ws 种子流重生成
         该 ws 尘埃——前缀稳定使重生成安全（存量粒子位不移动），超出旧 dustCount 的
         新粒子标 born（绘制 α 坡道 0.8s）。 */
      if (ws.archives !== prevArchives) regenerateWsDust(ws);
      ws.satelliteCount = next.satelliteCount ?? ws.satelliteCount;
      ws.links = (next.links ?? ws.links).slice();
      // 恒星属性补丁（集合不变由 diffLevel 保证）
      (next.stars ?? []).forEach(function (star, i) {
        const local = ws.stars.find((s) => s.id === star.id);
        if (!local) return;
        local.name = star.name;
        local.lifecycle = star.lifecycle ?? local.lifecycle;
        local.setBy = star.setBy ?? null;
        local.at = star.at ?? null;
        local.tasks = star.tasks; local.age = star.age; local.act = star.act || 0;
        local.starIndex = i;
        const off = star.off ?? [0, 0, 0];
        /* off 同步（add-cosmos-search-filter 2.1）：本段本就以 star.off 重写 wp——
           不同步 local.off 则后续（过滤）位移补间会用陈旧偏移重算 wp。 */
        local.off = [off[0], off[1], off[2]];
        local.wp = [ws.center[0] + off[0], ws.center[1] + off[1], ws.center[2] + off[2]];
      });
      // 行星属性补丁（capture 时刻保留；卫星数组就地替换；state 沿 → colorMix 滑移，3.1）
      (next.planets ?? []).forEach(function (planet) {
        const local = ws.planets.find((p) => p.id === planet.id);
        if (!local) return;
        if (local.state !== planet.state) {
          local.colorMix = { from: local.state, to: planet.state, t0: E.t, dur: COLOR_MIX_DUR };
        }
        local.title = planet.title; local.state = planet.state;
        local.pendingKind = planet.pendingKind ?? null;
        local.delegatedBusy = planet.delegatedBusy === true;
        local.satelliteCount = planet.satelliteCount ?? local.satelliteCount;
        local.todos = planet.todos; local.when = planet.when;
        local.sats = reconcileSatBodies(local.sats, planet.satellites);
        const starRefs = ws.stars.filter((s) => (planet.stars ?? []).indexOf(s.id) >= 0);
        if (starRefs.length > 0) {
          const isBin = starRefs.length > 1;
          local.stars = starRefs;
          local.center = isBin ? midOf(starRefs.map((s) => s.wp)) : starRefs[0].wp;
          local.baseR = isBin ? 30 : 16;
        }
      });
      // 彗星属性补丁（卫星数组就地替换；state/pendingKind 状态色数据链触点 3——
      // 彗星变色走 patch 级，MUST NOT 触发场景级重建；state 沿 → colorMix 滑移，3.1）
      (next.comets ?? []).forEach(function (comet) {
        const local = ws.comets.find((c) => c.id === comet.id);
        if (!local) return;
        if (local.state !== comet.state) {
          local.colorMix = { from: local.state, to: comet.state, t0: E.t, dur: COLOR_MIX_DUR };
        }
        local.title = comet.title; local.when = comet.when;
        local.state = comet.state;
        local.pendingKind = comet.pendingKind ?? null;
        local.delegatedBusy = comet.delegatedBusy === true;
        local.satelliteCount = comet.satelliteCount ?? local.satelliteCount;
        local.sats = reconcileSatBodies(local.sats, comet.satellites);
      });
    }
  }

  /* ---------- 启动 ---------- */
  ensureDom();
  resize();
  if (typeof ResizeObserver !== "undefined") {
    E.resizeObserver = new ResizeObserver(function () { resize(); });
    E.resizeObserver.observe(E.container);
  }
  bindInput(E.el.root);
  bindPanKeys();
  return engine;
}
