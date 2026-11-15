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
 *  - 成星捕获动画（polish-cosmos-orbit-insertion）：彗星→行星的混合曲线补间
 *    （自彗星最后世界坐标出发的渐缩螺旋与稳态轨道方程按 smoothstep 混合，起点连续 /
 *    终点无缝 / 尾迹跨 kind 交接），由 `markCapture(sessionId, from, opts)` 在 scene
 *    补丁前触发、经 P2 存在队列启动；捕获环 3.5×→1× 收缩动画并存；
 *  - 恒星超新星转场（add-comet-states-and-star-death）：引擎级幽灵列表 `E.novae`
 *    （与场景实体解耦，`spawnEventMeteor` 同构模式），`markStarNova(id, worldPos,
 *    color, opts?)` 三段式 2.4s（白炽引爆→冲击波→坍缩归尘）；星胚 intensity 0.3
 *    走低强度消散变体（0.8s）；
 *  - 行星回归彗星反向捕获：`markRegression(sessionId, from)` 与成星捕获转场
 *    完全对称（从行星最后轨道位置 easeOutCubic 滑向游荡点 1.4s，α 前 0.5s 坡道
 *    渐入），替代「回归 = 熄灭流星」的语义错位；
 *  - 恒星归档激波弹射（add-cosmos-nova-ejection）：`markRegression(..., { blast })`
 *    在回归补间内叠 hold（α=0 定格于 from）→ kick（沿爆心→行星径向外抛）→ glide
 *    （汇入游荡），击中时刻按「激波速度 × 距爆心距离」几何错峰；kick 起始帧经
 *    `adoptTrailAcrossKinds` 交接行星空迹（尾巴点燃）；风暴降级回落普通回归；
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
 *  - HUD 精简（D5）：删面包屑与右上操作提示；钻取态星座标牌 `.cos-badge` 居顶部中央
 *    （星座名 + 全量计数仪表，沿用旧 crumb 的 `dataset.html` 内容差分守卫）；
 *    polish-cosmos-drilled-hud：标牌自左上移居顶部中央（钻取态搜索框已隐藏，顶部中央
 *    单一视觉锚点；避让对象改为左面板 + 右缘）；
 *  - 右下常驻「回到银河」`.cos-home-btn`（D3）：钻取态 = flyOut()，银河根级 = 仅清选中。
 *
 * add-cosmos-three-finger-pan（触屏第三自由度：三指按住平移）：
 *  - 输入层手势全景：1 指拖拽旋转 / 2 指捏合缩放 / **3+ 指按住拖动平移**（抓取式映射：
 *    星空随手移动，yaw/pitch 不变；世界位移 = 屏幕位移 × dist × PAN_DRAG_FACTOR，
 *    放大态微调、拉远态跨星座——与捏合指针聚焦同一「场景贴合」哲学）；
 *  - `E.pan3` 状态机（D3）：第三指落下接管（清 pinch/拖拽、记多指质心起点、cancelTween），
 *    2→3 / 3→2 / 3→1 / 3→0 全矩阵经统一收指 helper 重锚（3→2 以余下两指间距重锚捏合）；
 *    第四指及以上仍平移，落指即重锚质心（无基准跳变）；
 *  - 收束补判链 `pinchCarry`（序列级）：捏合越阈后切平移、直接收束时仍以最终 dist
 *    补判一次自动 dive/flyOut（不静默丢失阈值导航）；
 *  - 触控板边界：3 指为 OS 级手势，浏览器不派发第三个 pointerdown → 天然触屏专属，
 *    引擎 MUST NOT 模拟合成三指事件；无惯性滑动、无单指/双击模式切换。
 */

/* 引擎 DOM 的样式（自 demo style-d-hud-galaxy.html 移植）。add-cosmos-skin-themes 2.1：
   全部金色系字面量收敛为 `var(--cos-*, 现值)`——fallback = 现风格 D 值（令牌缺失不裸奔），
   令牌由上层 `applySkinTokens` 下发到整页根容器（唯一写者）；半透明变体走
   `rgb(var(--cos-accent-rgb, 255 210 140) / α)` 通道令牌，基线逐位等于改造前 rgba()。 */
export const ENGINE_CSS = `
.cos-root { position: absolute; inset: 0; overflow: hidden; font-family: "Segoe UI", system-ui, -apple-system, "Microsoft YaHei", sans-serif; color: var(--cos-ink, #ffe9cf);
  user-select: none; -webkit-user-select: none;
  touch-action: none; /* 容器级唯一一条（D2）：touch-action 沿祖先链取交集，对 canvas、
    全部覆盖元素与未来元素同时生效——逐覆盖元素枚举正是 design D1 批判的脆弱模式。 */ }
.cos-canvas { position: absolute; inset: 0; }
.cos-overlay { position: absolute; inset: 0; pointer-events: none; z-index: 10; }
.cos-scanlines { position: absolute; inset: 0; pointer-events: none; z-index: 5;
  background: repeating-linear-gradient(0deg, var(--cos-scan, rgba(255,230,190,.02)) 0 1px, transparent 1px 3px); }
/* ── 钻取态星座标牌（HUD 精简后取代面包屑；polish-cosmos-drilled-hud D3 起居顶部中央）：
   钻取态显示星座名 + 全量计数仪表，水平居中（left:50% + translateX(-50%)）且文本
   居中排版（名称 + 计数两行）。纯信息元素 → pointer-events: none（不形成点击死区）。
   避让对象 = 左侧提案面板（187px）+ 右缘安全边距（钻取态搜索框已隐藏，不再参与避让）：
   限宽 max(160px, min(480px, calc(100% - 470px)))，470 = 2 ×（187 面板 + 48 安全边距）
   ——居中标牌左右各留 48px 余量，≥520px 视口内恒不与面板/右缘相交；<520px 视口经下方
   断点放宽为 calc(100% - 40px)（允许与面板横向重叠降级）。外侧 max(160px, …) 是**页面
   宽度不足时的下限兜底**：Cosmos 整页左缘跟踪 DSH 侧栏（页面宽 = 视口 - 侧栏），侧栏在场
   且窗口窄时 100% - 470px 会为负 → max-width 被钳到 0、标牌文本不可见，违反 spec
   「钻取态页面顶部中央 MUST 呈现标牌」；下限 160px 保证计数行仍可读，此时允许与面板横向
   重叠，纵向由面板钻取态下移 top:64px 隔离（见 client CSS .dsh-cosmos-panel[data-drill=true]）。
   超长名称截断策略与既有一致。 ── */
.cos-badge { position: absolute; top: 14px; left: 50%; transform: translateX(-50%);
  max-width: max(160px, min(480px, calc(100% - 470px))); text-align: center;
  font-size: 13px; color: var(--cos-accent-ink, #ffe3b8); letter-spacing: .5px; pointer-events: none; z-index: 20;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
@media (max-width: 520px) { .cos-badge { max-width: calc(100% - 40px); } }
.cos-badge b { display: block; font-size: 13px; font-weight: 600; letter-spacing: 1px; text-shadow: 0 0 8px var(--cos-glow, rgba(255,210,140,.55)); }
.cos-badge span { display: block; margin-top: 2px; font-size: 10px; letter-spacing: 2px; opacity: .6; }
/* 右下常驻「回到银河」方形按钮（D3/4.1）：风格 D HUD 语言（暖金描边 + 角标），
   触屏点击目标 44px ≥ 40px；钻取态与银河根级均常驻（两态语义见 flyOut 早退分支）。 */
.cos-home-btn { position: absolute; right: 16px; bottom: 16px; z-index: 20; box-sizing: border-box;
  width: 44px; height: 44px; padding: 0; display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; color: var(--cos-accent-ink, #ffe3b8); background: var(--cos-glass, rgba(8,8,16,.72)); border: 1px solid var(--cos-line, rgba(255,210,140,.35));
  font-family: inherit; pointer-events: auto; }
.cos-home-btn::before, .cos-home-btn::after { content: ''; position: absolute; width: 8px; height: 8px; pointer-events: none; }
.cos-home-btn::before { top: -1px; left: -1px; border-top: 2px solid var(--cos-line-strong, #ffd28a); border-left: 2px solid var(--cos-line-strong, #ffd28a); }
.cos-home-btn::after { bottom: -1px; right: -1px; border-bottom: 2px solid var(--cos-line-strong, #ffd28a); border-right: 2px solid var(--cos-line-strong, #ffd28a); }
.cos-home-btn:hover { border-color: rgb(var(--cos-accent-rgb, 255 210 140) / .85); background: var(--cos-hover, rgba(255,210,140,.12)); }
.cos-home-btn:focus-visible { outline: 1px solid rgb(var(--cos-accent-rgb, 255 210 140) / .85); outline-offset: 2px; }
.cos-home-btn svg { display: block; width: 22px; height: 22px; }
.cos-chip { position: absolute; left: 0; top: 0; text-align: center; pointer-events: auto; cursor: pointer; opacity: 0; transition: opacity .25s; will-change: transform;
  color: var(--cos-accent-ink, #ffe3b8); padding: 4px 12px; border: 1px dashed rgb(var(--cos-accent-rgb, 255 210 140) / .4); background: var(--cos-chip-bg, rgba(10,10,20,.45)); }
.cos-chip.on { opacity: 1; }
.cos-chip b { display: block; font-size: 13px; font-weight: 600; letter-spacing: 1px; text-shadow: 0 0 8px var(--cos-glow, rgba(255,210,140,.55)); }
.cos-chip span { font-size: 10px; opacity: .6; letter-spacing: 2px; }
.cos-chip:hover { border-color: rgb(var(--cos-accent-rgb, 255 210 140) / .85); }
/* 空星座出生高亮（add-cosmos-add-workspace D6/3.2）：~2s 脉冲后渐熄（WS_BIRTH_HL_DUR 同步）。
   发光参数对照风格 D 基线（demo/styles/assets/style-d.js glowSprite：内 rgba(255,210,140,.95)
   / 外 rgba(255,210,140,.22)）。animation forwards → 动画结束即常态，无需 JS 清理；
   只动 border/box-shadow/text-shadow，MUST NOT 动 transform（chip 定位由引擎逐帧写 transform）。 */
.cos-chip.cos-chip-new { animation: cos-chip-birth 2s ease-out forwards; }
.cos-chip.cos-chip-new b { animation: cos-chip-birth-text 2s ease-out forwards; }
@keyframes cos-chip-birth {
  0% { border-color: rgb(var(--cos-accent-rgb, 255 210 140) / .4); box-shadow: 0 0 0 rgb(var(--cos-accent-rgb, 255 210 140) / 0); }
  12% { border-color: rgb(var(--cos-accent-rgb, 255 210 140) / .95); box-shadow: 0 0 22px rgb(var(--cos-accent-rgb, 255 210 140) / .45), inset 0 0 14px rgb(var(--cos-accent-rgb, 255 210 140) / .18); }
  45% { border-color: rgb(var(--cos-accent-rgb, 255 210 140) / .6); box-shadow: 0 0 12px rgb(var(--cos-accent-rgb, 255 210 140) / .22); }
  100% { border-color: rgb(var(--cos-accent-rgb, 255 210 140) / .4); box-shadow: 0 0 0 rgb(var(--cos-accent-rgb, 255 210 140) / 0); }
}
@keyframes cos-chip-birth-text {
  0% { text-shadow: 0 0 8px var(--cos-glow, rgba(255,210,140,.55)); }
  12% { text-shadow: 0 0 18px rgb(var(--cos-accent-rgb, 255 210 140) / .95), 0 0 6px rgba(255,240,210,.8); }
  100% { text-shadow: 0 0 8px var(--cos-glow, rgba(255,210,140,.55)); }
}
.cos-slab { position: absolute; left: 0; top: 0; font-size: 11px; white-space: nowrap; color: rgb(var(--cos-ink-rgb, 255 233 207) / .8); letter-spacing: .5px;
  opacity: 0; transition: opacity .2s; pointer-events: none; will-change: transform; text-shadow: 0 0 6px rgb(var(--cos-accent-rgb, 255 210 140) / .4); }
.cos-slab.on { opacity: 1; }
.cos-slab b { font-weight: 500; }
/* 钻取态恒星名牌活力标识（dsh-cosmos「恒星亮度编码活跃度」delta D4）：琥珀点+「活跃」/
   灰点+「沉睡」；星胚（proto）不渲染（引擎侧不产出该节点）。 */
.cos-slab-life { display: inline-block; margin-left: 6px; font-size: 10px; letter-spacing: 0; }
.cos-slab-life i { display: inline-block; width: 5px; height: 5px; border-radius: 50%; margin-right: 4px;
  vertical-align: 1px; background: currentColor; }
.cos-slab-life.active { color: var(--dsw-alias-state-warn-primary, var(--cos-waiting, #ffaa4a)); }
.cos-slab-life.active i { box-shadow: 0 0 6px currentColor; }
.cos-slab-life.sleep { color: var(--cos-ink-dim, rgba(255,233,207,.55)); }
.cos-card { position: absolute; left: 0; top: 0; min-width: 230px; max-width: 280px; padding: 12px 14px; font-size: 12px;
  background: var(--cos-panel, rgba(8,8,16,.88)); border: 1px solid var(--cos-line, rgba(255,210,140,.35)); opacity: 0; transition: opacity .15s; pointer-events: none; will-change: transform; }
.cos-card.on { opacity: 1; pointer-events: auto; }
.cos-card::before, .cos-card::after { content: ''; position: absolute; width: 10px; height: 10px; }
.cos-card::before { top: -1px; left: -1px; border-top: 2px solid var(--cos-line-strong, #ffd28a); border-left: 2px solid var(--cos-line-strong, #ffd28a); }
.cos-card::after { bottom: -1px; right: -1px; border-bottom: 2px solid var(--cos-line-strong, #ffd28a); border-right: 2px solid var(--cos-line-strong, #ffd28a); }
.cd-title { font-size: 13px; font-weight: 600; margin-bottom: 8px; color: var(--cos-title-ink, #fff3dd); }
.cd-grid { display: grid; grid-template-columns: auto 1fr; gap: 4px 14px; }
.cd-grid span { opacity: .55; }
.cd-grid b { font-weight: 500; }
/* 信息卡双按钮（add-cosmos-session-archive-action D4）：行星/彗星卡「打开会话」+
   「归档会话」共用 .cd-btn 一类（同视觉语言、同排布区、间距 8px ⇒ 共享类副作用 =
   打开按钮热区同步变大、行为零变化）。min-height 44px 对齐 .cos-home-btn 先例
   （spec 触屏目标 ≥40px）。配色优先官方 --dsw-alias-* token（token 缺席回落风格 D
   HUD 基线，与星座动作条/浮窗同口径）。归档在途禁用态经直接 DOM 切换（D6：MUST NOT
   经 cardHtml 重渲染呈现——sig 不变不重建，且不应为一颗按钮的禁用态改动 sig）。 */
.cd-actions { display: flex; gap: 8px; margin-top: 10px; }
.cd-btn { flex: 1 1 0; min-width: 0; box-sizing: border-box; min-height: 44px; padding: 5px 12px; font-size: 12px; cursor: pointer;
  color: var(--dsw-alias-label-primary, var(--cos-accent-ink, #ffe3b8));
  background: var(--dsw-alias-interactive-bg-hover, rgb(var(--cos-accent-rgb, 255 210 140) / .08));
  border: 1px solid var(--dsw-alias-border-l2, rgb(var(--cos-accent-rgb, 255 210 140) / .5)); }
.cd-btn:hover { background: var(--dsw-alias-interactive-bg-hover-solid, rgb(var(--cos-accent-rgb, 255 210 140) / .2)); }
.cd-btn:disabled { cursor: default; opacity: .45; }
/* 决策按钮（cosmos-session-decide D5）：琥珀 warning 色——官方 --dsw-alias-* token
   优先（宿主已发布族为 state-warn-primary，见 session-list-panel walkthrough 的 alias
   盘点），token 缺席回落风格 D HUD 暖金基线；触屏目标沿用 .cd-btn 的 44px。 */
.cd-btn-decide { color: var(--dsw-alias-state-warn-primary, var(--cos-waiting, #ffaa4a));
  border-color: var(--dsw-alias-state-warn-primary, rgb(var(--cos-accent-rgb, 255 210 140) / .7));
  background: var(--dsw-alias-interactive-bg-hover, rgb(255 170 74 / .1)); }
.cd-btn-decide:hover { background: var(--dsw-alias-interactive-bg-hover-solid, rgb(255 170 74 / .22)); }
.cos-empty { position: absolute; left: 50%; top: 44%; transform: translate(-50%,-50%); text-align: center; font-size: 13px;
  color: var(--cos-ink-dim, rgba(255,233,207,.55)); letter-spacing: 2px; z-index: 20; pointer-events: none; }
.cos-empty b { display: block; font-size: 16px; margin-bottom: 8px; color: rgb(var(--cos-accent-ink-rgb, 255 227 184) / .8); }
.cos-toast { position: absolute; bottom: var(--cos-toast-bottom, 24px); left: 50%; transform: translateX(-50%); padding: 8px 14px; font-size: 12px;
  background: var(--cos-panel-strong, rgba(8,8,16,.92)); border: 1px solid rgb(var(--cos-accent-rgb, 255 210 140) / .5); color: var(--cos-accent-ink, #ffe3b8); opacity: 0; transition: opacity .2s; pointer-events: none; z-index: 30; }
.cos-toast.on { opacity: 1; }
`;

import { relativeTime, starPlanetIdsOf } from "../merge.mjs";

const TAU = Math.PI * 2;

/* ---------- 小工具 ---------- */
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }

/** 文案注入净化（opts.labels）：只收非空字符串，非法键静默丢弃（回落下沉到 DEFAULT_LABELS）。 */
function textRecordOf(source) {
  const out = {};
  if (!source || typeof source !== 'object') return out;
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (typeof value === 'string' && value) out[key] = value;
  }
  return out;
}
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
/** 端点一阶导为 0 的平滑权重（捕获补间 approach↔轨道方程混合；k=0/1 处零速切换）。 */
function smoothstep(k) { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); }
function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function len3(a) { return Math.hypot(a[0], a[1], a[2]); }
function cross3(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function unit3(a) {
  const L = len3(a);
  return L > 1e-9 ? [a[0] / L, a[1] / L, a[2] / L] : [0, 0, 0];
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

/* 状态标签（add-celestial-states 4.5 扩表；恒星三态 status 退役 → 生命周期四态）。 */
const LIFECYCLE_LABEL = { proto: '待创建', created: '已创建', reviewed: '已审核', executed: '已执行' };
const STATE_LABEL = { idle: '待机中', busy: '执行中', waiting: '待决策', 'done-unread': '完成未读' };
/** 待决策 pendingInteraction.kind 子类文案（v1 统一琥珀视觉，子类只进信息卡）。 */
const PLAN_KIND_LABEL = { approval: '审批', 'plan-review': '方案审查', question: '提问' };

/* 信息卡文案缺省表（cosmos-session-decide 5.4 / cosmos-relation-focus D4）：宿主经
   `opts.labels` 注入 locale 同源文案时覆盖；缺省值 = 中文呈现基线（引擎独立可测）。
   - decide：决策按钮动作文案（键域与 PLAN_KIND_LABEL 一致，值语义不同——那是状态行
     括注「审批/方案审查/提问」，这里是按钮「待批准/计划待审/待回答」）；
   - vitality：恒星活力两态（沉睡 = act=0 / 活跃 = act≥1）行标与取值。 */
const DEFAULT_LABELS = Object.freeze({
  decide: Object.freeze({ approval: '待批准', 'plan-review': '计划待审', question: '待回答', fallback: '待决策' }),
  vitality: Object.freeze({ label: '活力', active: '活跃', sleep: '沉睡' })
});

/** 转场时长（demo/states FX 已验证参数：点燃 2.2s / 落印 1.6s / 查看渐熄 2.2s×0.72 渐变段）；
    add-transition-choreography 扩 birth（实体出生，kind 级时长见 FX_BIRTH_DUR）与
    surge（executed 金涌，1.2s——D4 翻案 add-celestial-states「executed 无独立转场」）。 */
const FX_DUR = { ignite: 2.2, stamp: 1.6, view: 2.2, birth: 0.6, surge: 1.2 };

/** birth kind 级时长（design D2 表）：star/proto 0.6s / planet 0.6s / comet 0.8s（游入，尾迹先现）。 */
const FX_BIRTH_DUR = { star: 0.6, planet: 0.6, comet: 0.8 };

/** 超新星转场总时长（三段式约 2.4s，与点燃转场同量级）与星胚消散变体时长（0.8s）。 */
export const FX_NOVA_DUR = 2.4;
export const FX_NOVA_PROTO_DUR = 0.8;

/** 回归反向捕获补间时长（与成星捕获补间完全对称）；α 坡道 0.5s。 */
const REGRESS_DUR = 1.4;
const REGRESS_ALPHA_RAMP = 0.5;

/* ---------- 成星捕获补间（polish-cosmos-orbit-insertion；初值，spec 不锁数值） ---------- */

/** 捕获补间总时长（与回归 1.4s 对称；真机调参改此常量即可，不进设置页）。 */
export const CAPTURE_DUR = 1.4;
/** approach 段初速增益（× 起点→终点弦长，单位 per 补间单位）：与旧实现径向速度
    （3.5×baseR→baseR 线性 ≈28 世界单位/s）同量级，避免起步过快、切向感被径向吞没。 */
const CAPTURE_LEAD_GAIN = 0.9;
/** 风暴降级 α 坡道（无位移补间直接就位时渐入；与回归渐入同口径 0.5s）。 */
const CAPTURE_ALPHA_RAMP = 0.5;
/** 捕获环首帧半径倍率（3.5×→1× 联动收缩动画；快照缺失回落点与环动画同源）。 */
const CAPTURE_RING_F0 = 3.5;

/* ---------- 激波弹射变体（add-cosmos-nova-ejection；初值，spec 不锁数值，集中便于真机调参） ---------- */

/** 激波扩张速度（世界单位/秒）：击中时刻 = 距爆心距离 / SHOCK_SPEED。以风格 D 基线
    nova B 段冲击环观感标定（跨皮肤逐帧一致非本 change 承诺）。 */
export const SHOCK_SPEED = 40;
/** hold（不可见定格）上下界：下限防近距离瞬发，上限防远轨道行星长时间不可见。 */
export const SHOCK_HOLD_MIN = 0.25;
export const SHOCK_HOLD_MAX = 0.9;
/** kick（径向外抛短冲）与 glide（汇入游荡）时长；总时长上界 = HOLD_MAX + KICK + GLIDE
    ≈ 2.2s，与超新星 2.4s 同场收尾。 */
export const SHOCK_KICK_DUR = 0.45;
export const SHOCK_GLIDE_DUR = 0.85;
export const SHOCK_TOTAL_MAX = SHOCK_HOLD_MAX + SHOCK_KICK_DUR + SHOCK_GLIDE_DUR;
/** kick 距离 = clamp(baseR × ratio, min, max)：短冲克制（≈1.2× 行星轨道半径），
    防 kick 方向与 glide 终点之间的方向反转感。 */
const SHOCK_KICK_RATIO = 1.2;
const SHOCK_KICK_MIN = 6;
const SHOCK_KICK_MAX = 48;

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
/** 关联聚焦 α 坡道（cosmos-relation-focus D3）：0.2s——聚焦是高频瞬态交互，快于连线段
    0.4s 的登场叙事；切换时旧集 out / 新集 in，α 因子进 rel 段与 rel 环的条目数据。 */
export const REL_FADE_DUR = 0.2;

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
  wsghost: WS_GHOST_DUR, capture: CAPTURE_DUR, regression: REGRESS_DUR, birth: 0.8
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
/** 三指拖动平移换算系数（v1，待真机校准）：世界位移 = 屏幕位移 × 镜头距离 × factor。
    与 WASD 的恒速积分不同——位移手势按**位移映射**（放大态微调、拉远态跨星座），
    系数不进 settings 配置面（design D2；`tuning.factor` 透传留缝）。 */
export const PAN_DRAG_FACTOR = 0.004;

/**
 * 视图平面方向基（三指拖动平移与 WASD 平移共享，防两处数学漂移）：
 *  - `(rx, rz)` = 世界系「屏幕右」单位向量；
 *  - `(ux, uy, uz)` = 世界系「屏面上」单位向量。
 * 相机 target 沿 right 移动 → 星空在屏上左移；沿 up 移动 → 星空在屏上下移。
 * @param {{yaw: number, pitch: number}} cam
 * @returns {{rx: number, rz: number, ux: number, uy: number, uz: number}|null}
 */
export function panBasis(cam) {
  if (!cam) return null;
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  return { rx: cy, rz: -sy, ux: sp * sy, uy: cp, uz: sp * cy };
}

/* ---------- 会话打开快捷键（add-cosmos-session-open-hotkey D3） ---------- */

/** 会话打开快捷键（`ev.code` 语义，键位布局无关——与 PAN_KEYS 的 code 切片同源）：
    空格对**当前选中**的行星/彗星触发与信息卡「打开会话」按钮同一回调链。
    v1 固定空格、不进 settings 存储（settings.mjs v3 不动）；将来做键位配置时以该常量
    为缺省值落新键（导出即留缝：冒烟直测 + 宿主侧将来可读）。 */
export const SESSION_OPEN_KEY = "Space";

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
  const basis = panBasis(cam);
  if (!basis) return false;
  const t = cam.target;
  t[0] += (basis.rx * strafe + basis.ux * forward) * speed;
  t[1] += basis.uy * forward * speed;
  t[2] += (basis.rz * strafe + basis.uz * forward) * speed;
  return true;
}

/**
 * 三指按住拖动平移相机 target（纯函数，触屏第三自由度；抓取式映射）：
 *  - 手指拖动方向 = 星空移动方向 → 相机 target **反向**移动（手指右拖 = target 左移，
 *    手指下拖 = target 上移；星空随手移动），yaw/pitch 不变；
 *  - 世界位移 = 屏幕位移 × dist × factor（dist 显式入参：同一 cam 可在不同视距下断言
 *    比例关系；factor 缺省 PAN_DRAG_FACTOR，`tuning.factor` 透传真机校准）；
 *  - 非法入参（含 dist ≤ 0）或零位移返回 false，且有位移才写 target；
 *    有位移返回 true（调用方据此打断相机补间，与 WASD/滚轮/捏合同语义）。
 * @param {{target: number[], yaw: number, pitch: number}} cam
 * @param {number} dx 屏幕横向位移（px，右正）
 * @param {number} dy 屏幕纵向位移（px，下正）
 * @param {number} dist 当前镜头距离（世界单位）
 * @param {{factor?: number}} [tuning] 可选换算系数（v1 不接 settings）
 * @returns {boolean} 是否发生了位移
 */
export function panCameraTargetByDrag(cam, dx, dy, dist, tuning) {
  const basis = panBasis(cam);
  if (!basis) return false;
  const mx = Number(dx), my = Number(dy), d = Number(dist);
  if (!Number.isFinite(mx) || !Number.isFinite(my) || !Number.isFinite(d) || !(d > 0)) return false;
  if (mx === 0 && my === 0) return false;
  const factor = Number(tuning?.factor) > 0 ? tuning.factor : PAN_DRAG_FACTOR;
  const scale = d * factor;
  const t = cam.target;
  t[0] += (-mx * basis.rx + my * basis.ux) * scale;
  t[1] += my * basis.uy * scale;
  t[2] += (-mx * basis.rz + my * basis.uz) * scale;
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

/* ---------- 激波弹射纯函数（add-cosmos-nova-ejection；导出供冒烟直测） ---------- */

/**
 * 激波弹射击中参数（纯函数，导出供冒烟直测；`markRegression` 消费）：
 *  - `hit` = clamp(|from − starPos| / SHOCK_SPEED, HOLD_MIN, HOLD_MAX)——几何推定
 *    错峰：近者先被击中，确定性、不依赖调度器 fire 时刻；
 *  - `kickDir` = normalize(from − starPos)（爆心→行星径向外抛方向；退化取 [1,0,0]）；
 *  - `kickDist` = clamp(baseR × ratio, MIN, MAX)（短冲克制）。
 * @param {number[]} from 行星最后轨道世界坐标（回归快照）
 * @param {number[]} starPos 爆心世界坐标
 * @param {number} [baseR] 行星轨道半径（kick 距离口径；缺失按 16）
 * @returns {{hit:number, kickDist:number, kickDir:number[], dist:number}|null}
 */
export function shockHitOf(from, starPos, baseR) {
  if (!Array.isArray(from) || from.length !== 3 || !Array.isArray(starPos) || starPos.length !== 3) return null;
  const dx = Number(from[0]) - Number(starPos[0]);
  const dy = Number(from[1]) - Number(starPos[1]);
  const dz = Number(from[2]) - Number(starPos[2]);
  if (![dx, dy, dz].every(Number.isFinite)) return null;
  const dist = Math.hypot(dx, dy, dz);
  const kickDir = dist > 1e-6 ? [dx / dist, dy / dist, dz / dist] : [1, 0, 0];
  const r = Number(baseR) > 0 ? Number(baseR) : 16;
  return {
    hit: clamp(dist / SHOCK_SPEED, SHOCK_HOLD_MIN, SHOCK_HOLD_MAX),
    kickDist: clamp(r * SHOCK_KICK_RATIO, SHOCK_KICK_MIN, SHOCK_KICK_MAX),
    kickDir,
    dist
  };
}

/**
 * 激波弹射分段位置/可见性（纯函数，导出供冒烟直测；`updateScene` 彗星分支消费）：
 *  - hold：`elapsed < hit` → wp = from、α = 0（不可见定格；MUST NOT 出现在游荡点）；
 *  - kick：`hit ≤ elapsed < hit + SHOCK_KICK_DUR` → 沿 kickDir 径向外抛
 *    `kickDist × easeOutCubic`（缓出短冲）；
 *  - glide：之后 → 自 kick 末点 easeOutCubic 汇入 wander；
 *  - α 自击中起 REGRESS_ALPHA_RAMP 坡道渐入。
 * 无帧步进状态：k 由 elapsed 推导（E.t 渲染暂停期冻结 → 页签隐藏断点续播）。
 * @param {number} elapsed 距回归启动秒（t − regressStart）
 * @param {{from:number[], hit:number, kickDist:number, kickDir:number[]}} blast 分段参数
 * @param {number[]} wander 当前游荡点
 * @returns {{wp:number[], alpha:number, phase:'hold'|'kick'|'glide', k:number}}
 */
export function shockEjectionAt(elapsed, blast, wander) {
  const from = Array.isArray(blast?.from) && blast.from.length === 3 ? blast.from : [0, 0, 0];
  const target = Array.isArray(wander) && wander.length === 3 ? wander : from;
  const hit = clamp(Number(blast?.hit) || 0, SHOCK_HOLD_MIN, SHOCK_HOLD_MAX);
  const kickDist = Math.max(0, Number(blast?.kickDist) || 0);
  const dir = Array.isArray(blast?.kickDir) && blast.kickDir.length === 3 ? blast.kickDir : [1, 0, 0];
  const t = Number.isFinite(Number(elapsed)) ? Math.max(0, Number(elapsed)) : 0;
  if (t < hit) return { wp: from.slice(0, 3), alpha: 0, phase: 'hold', k: 0 };
  const alpha = clamp((t - hit) / REGRESS_ALPHA_RAMP, 0, 1);
  if (t < hit + SHOCK_KICK_DUR) {
    const k = clamp((t - hit) / SHOCK_KICK_DUR, 0, 1);
    const e = easeOutCubic(k);
    return {
      wp: [
        from[0] + dir[0] * kickDist * e,
        from[1] + dir[1] * kickDist * e,
        from[2] + dir[2] * kickDist * e
      ],
      alpha,
      phase: 'kick',
      k
    };
  }
  const g = clamp((t - hit - SHOCK_KICK_DUR) / SHOCK_GLIDE_DUR, 0, 1);
  const kickEnd = [from[0] + dir[0] * kickDist, from[1] + dir[1] * kickDist, from[2] + dir[2] * kickDist];
  return { wp: lerpV(kickEnd, target, easeOutCubic(g)), alpha, phase: 'glide', k: g };
}

/** 激波弹射分段总长（hit + kick + glide；彗星条目按此收尾摘除，调度器 activeDur 不变）。 */
export function shockTotalDurOf(hit) {
  return clamp(Number(hit) || 0, 0, SHOCK_HOLD_MAX) + SHOCK_KICK_DUR + SHOCK_GLIDE_DUR;
}

/**
 * 跨 kind 尾迹交接（纯函数，导出供冒烟直测；与 polish-cosmos-orbit-insertion
 * 提案共享协议——本 change 先行实现，其入轨方向直接复用）：
 * 世界坐标点直接继承（`inheritTrails` 同语义）；容量超限按**等距重采样**截断
 * （索引空间等距、保留首尾端点；彗星 34 点 → 行星 14 点）。
 * @param {number[][]} prevTrail 旧天体尾迹（世界坐标，旧→新）
 * @param {number} targetCapacity 目标容量
 * @returns {number[][]} 新尾迹（新数组 + 点位浅拷贝）
 */
export function adoptTrailAcrossKinds(prevTrail, targetCapacity) {
  const cap = Math.max(1, Math.floor(Number(targetCapacity) || 1));
  const pts = (Array.isArray(prevTrail) ? prevTrail : []).filter(function (p) {
    return Array.isArray(p) && p.length === 3 && p.every(function (v) { return Number.isFinite(Number(v)); });
  });
  if (pts.length === 0) return [];
  if (pts.length <= cap) return pts.map(function (p) { return [Number(p[0]), Number(p[1]), Number(p[2])]; });
  if (cap === 1) {
    const last = pts[pts.length - 1];
    return [[Number(last[0]), Number(last[1]), Number(last[2])]];
  }
  const out = [];
  for (let i = 0; i < cap; i++) {
    const pos = (i / (cap - 1)) * (pts.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(pts.length - 1, lo + 1);
    const f = pos - lo;
    const a = pts[lo], b = pts[hi];
    out.push([
      lerp(Number(a[0]), Number(b[0]), f),
      lerp(Number(a[1]), Number(b[1]), f),
      lerp(Number(a[2]), Number(b[2]), f)
    ]);
  }
  return out;
}

/* ---------- 成星捕获补间纯函数（polish-cosmos-orbit-insertion；导出供冒烟直测） ---------- */

/**
 * 稳态轨道方程（纯函数，导出供冒烟直测；`updateScene` 行星步进与捕获补间共用）：
 * `center + [cos(a)·R, sin(a)·R·sin(inc)·0.9, sin(a)·R·cos(inc)]`，`a = phase + t·speed`。
 * MUST NOT 在捕获转场期改写 `phase`/`speed`（idHash 确定性：同数据同画面）。
 * @param {{center:number[], baseR:number, phase:number, speed:number, inc:number}} planet 行星 body
 * @param {number} t 时刻（秒）
 * @returns {number[]} 世界坐标
 */
export function orbitPointAt(planet, t) {
  const a = Number(planet.phase) + t * Number(planet.speed);
  const R = Number(planet.baseR) || 0;
  const ca = Math.cos(a) * R, sa = Math.sin(a) * R;
  const ci = Math.cos(Number(planet.inc) || 0), si = Math.sin(Number(planet.inc) || 0);
  const c = planet.center;
  return [c[0] + ca, c[1] + sa * si * 0.9, c[2] + sa * ci];
}

/** 轨道正向切向（纯函数）：稳态轨道方程对时间的单位导数（起行方向缺省值 / 快照回落用）。 */
export function orbitTangentAt(planet, t) {
  const a = Number(planet.phase) + t * Number(planet.speed);
  const R = Number(planet.baseR) || 0;
  const ci = Math.cos(Number(planet.inc) || 0), si = Math.sin(Number(planet.inc) || 0);
  return unit3([-Math.sin(a) * R, Math.cos(a) * R * si * 0.9, Math.cos(a) * R * ci]);
}

/** 快照缺失回落的捕获环外缘点（纯函数）：同一轨道方程按环首帧半径倍率 3.5× 取值
    （与捕获环 3.5×→1× 收缩动画同源——起点即环上，视觉无悬空）。 */
export function captureRingPointAt(planet, t) {
  return orbitPointAt({
    center: planet.center,
    baseR: (Number(planet.baseR) || 0) * CAPTURE_RING_F0,
    phase: planet.phase, speed: planet.speed, inc: planet.inc
  }, t);
}

/**
 * 轨道面正交基（内部工具）：`ex = x̂`、`êy = normalize(0, 0.9·sin(inc), cos(inc))`、
 * `n = ex × êy`。位置在该基下分解为「面内半径 ρ / 面内角 θ / 法向偏移 h」，捕获补间的
 * 全部混合都在**标量通道**上做——MUST NOT 对位置做线性插值、也 MUST NOT 对方向做
 * slerp：approach 点与同帧轨道点方位可能相差近半圈，位置线性插值的中点是弦（掠过极点
 * = 行星穿星而过），方向插值会让混合后的方位被同帧轨道点反向拖拽（角速度反号 = 甩鞭）。
 */
function orbitalBasisOf(planet) {
  const inc = Number(planet.inc) || 0;
  const si = Math.sin(inc), ci = Math.cos(inc);
  const ey = unit3([0, 0.9 * si, ci]);
  const n = cross3([1, 0, 0], ey); // ex ⟂ êy 且两者单位 → n 已是单位向量
  const c = planet.center;
  return {
    ey: ey, n: n,
    /** 世界坐标 → {rho, th, h}（正交基投影，逐位可逆）。 */
    split: function (p) {
      const rel = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
      const u = rel[0], v = dot3(rel, ey), h = dot3(rel, n);
      return { rho: Math.hypot(u, v), th: Math.atan2(v, u), h: h };
    },
    /** {rho, th, h} → 世界坐标。 */
    point: function (rho, th, h) {
      const co = Math.cos(th), sn = Math.sin(th);
      return [
        c[0] + rho * co + h * n[0],
        c[1] + rho * sn * ey[1] + h * n[1],
        c[2] + rho * sn * ey[2] + h * n[2]
      ];
    }
  };
}

/**
 * 捕获补间位姿（纯函数，导出供冒烟直测）——**起点连续 + 终点无缝**的混合曲线：
 *  - `approach` 段（极坐标三通道）：P0 = `from`（首帧位置 = 彗星最后世界坐标，无跳变）、
 *    靶 = 补间结束时刻的轨道位置；每通道 = `smoothstep` 平滑基线 + `k(1-k)²` 起行速度
 *    修正项（k=0 处一阶导 1、k=1 处值与一阶导均为 0）；
 *  - 起行方向：三通道初速取彗星离场切向 H 在正交基上的分量 → 合成速度**恒等于 H**
 *    （「起行方向与彗星离场切向连续」的严格形态）；
 *  - 终端无缝：半径 / 法向通道与同帧稳态轨道方程按 `smoothstep(k)` 混合（标量、单调），
 *    角通道取三次 Hermite（起点斜率 = 离场切向切向分量、终点斜率 = 轨道角速 per-k）——
 *    k=1 位置与速度/角速度逐帧等于稳态轨道方程（无 2× 突跳、无拐点）；
 *  - 半径沿平滑曲线收缩至轨道半径（末段减速 = 缓出），MUST NOT 穿过极点；
 *  - 风暴降级（`degraded`）：**无位移补间**直接就位稳态轨道方程 + α 坡道（与回归渐入
 *    同口径）；已启动的补间照常播完（调度只延迟启动、不打断）。
 *
 * 实现期决议（design「Open Questions」授权以实现期切向连续断言为准）：纯极坐标渐缩螺旋
 * 在 `easeOutCubic` 半径下无法满足任意 3D 离场切向的起点连续性（径向初速被半径曲线
 * 锁定、切向分量需发散才对齐），故半径基线取平滑形态（两端零速、末段减速 = 缓出），
 * 起步速度由彗星离场切向给定——切向连续优先于「快速起步」的形状偏好。
 * @param {object} planet 行星 body（center/baseR/phase/speed/inc）
 * @param {{t0:number, from?:number[]|null, heading?:number[]|null, degraded?:boolean, dur?:number}} entry 捕获条目
 * @param {number} t 时刻（秒）
 * @returns {{wp: number[], k: number, alpha: number, degraded: boolean}}
 */
export function capturePoseAt(planet, entry, t) {
  const t0 = Number(entry?.t0) || 0;
  const dur = Number(entry?.dur) > 0 ? Number(entry.dur) : CAPTURE_DUR;
  const k = clamp((t - t0) / dur, 0, 1);
  const orbit = orbitPointAt(planet, t);
  if (entry?.degraded === true) {
    /* 风暴降级：跳过位移补间（直接就位）+ α 坡道。 */
    return { wp: orbit, k, alpha: clamp((t - t0) / CAPTURE_ALPHA_RAMP, 0, 1), degraded: true };
  }
  /* 播完即交棒：k=1 起位置/速度完全由稳态轨道方程承担（逐帧一致，无收尾偏差）。 */
  if (k >= 1) return { wp: orbit, k: 1, alpha: 1, degraded: false };
  const snap = Array.isArray(entry?.from) && entry.from.length === 3
    && entry.from.every(function (v) { return Number.isFinite(Number(v)); });
  /* 快照缺失（竞态）：回落捕获环外缘点，heading 一并弃用（起行方向改取轨道正向切向）。 */
  const from = snap
    ? [Number(entry.from[0]), Number(entry.from[1]), Number(entry.from[2])]
    : captureRingPointAt(planet, t0);
  const heading = snap && Array.isArray(entry.heading) && entry.heading.length === 3 ? entry.heading : null;
  /* 首帧严格返回快照点（不经极坐标分解往返，避免 1e-15 级浮点残差）。 */
  if (k <= 0) return { wp: [from[0], from[1], from[2]], k: 0, alpha: 1, degraded: false };
  const p1 = orbitPointAt(planet, t0 + dur);
  const basis = orbitalBasisOf(planet);
  const a0 = basis.split(from), a1 = basis.split(p1);
  /* 扫描方向 = 轨道正向（prograde）：行星落位后恒按 `speed>0` 的正向公转，捕获段 MUST
     同向绕行——「最短弧」可能落在反向半区（转半圈后被迫反向接轨 = 甩鞭），故取
     (0, TAU) 的正向角量。 */
  let dth = (a1.th - a0.th) % TAU;
  if (dth < 0) dth += TAU;
  /* 起行速度（正交基三通道分量）：合成后方向恒为彗星离场切向。 */
  const hDir = heading && len3(heading) > 1e-6 ? unit3(heading) : orbitTangentAt(planet, t0);
  const rHat = [Math.cos(a0.th), Math.sin(a0.th) * basis.ey[1], Math.sin(a0.th) * basis.ey[2]];
  const tHat = [-Math.sin(a0.th), Math.cos(a0.th) * basis.ey[1], Math.cos(a0.th) * basis.ey[2]];
  const v0 = Math.hypot(p1[0] - from[0], p1[1] - from[1], p1[2] - from[2]) * CAPTURE_LEAD_GAIN;
  const dRho0 = v0 * dot3(hDir, rHat);
  const dTh0 = a0.rho > 1e-6 ? v0 * dot3(hDir, tHat) / a0.rho : 0;
  const dH0 = v0 * dot3(hDir, basis.n);
  const S = smoothstep(k);
  const corr = k * (1 - k) * (1 - k); // 起行速度修正基（端点值与一阶导均消失）
  /* 角通道：三次 Hermite（θ0→θ1，起点斜率 = 离场切向的切向分量，终点斜率 = 轨道角速
     per-k = dur·speed）——终点角速度由此与稳态轨道方程一致，角通道 MUST NOT 再与同帧
     轨道点做混合：同帧轨道角滞后于靶（差 (1-k)·dur·speed），混合会把已推进的方位反拖
     （角速度反号 = 甩鞭，与本次提案要消除的观感同源）。 */
  const k2 = k * k, k3 = k2 * k;
  const m1 = dur * (Number(planet.speed) || 0);
  const thA = (2 * k3 - 3 * k2 + 1) * a0.th
    + (k3 - 2 * k2 + k) * dTh0
    + (-2 * k3 + 3 * k2) * (a0.th + dth)
    + (k3 - k2) * m1;
  /* 半径 / 法向通道：平滑基线 + 起行速度修正，再与同帧轨道方程的同名通道混合
     （smoothstep；两者都是标量、单调，不会掠过极点，也不会被回拖）。 */
  const o = basis.split(orbit);
  const rho = lerp(a0.rho + (a1.rho - a0.rho) * S + dRho0 * corr, o.rho, S);
  const h = lerp(a0.h * (1 - S) + dH0 * corr, o.h, S);
  return { wp: basis.point(rho, thA, h), k, alpha: 1, degraded: false };
}

/**
 * 回归爆心解析（纯函数，导出供冒烟直测；client `rebuild` 消费）：
 * 同 ws 本帧常规超新星爆心中取距行星最近者；并列取 worldPos x 小者（确定性）。
 * 无候选 → null（普通回归，不报错）。
 * @param {Array<{wsId: string, starPos: number[]}>} cores 本帧爆心集合
 * @param {string} wsId 回归行星所属星座
 * @param {number[]} from 行星最后世界坐标
 * @returns {{wsId: string, starPos: number[]}|null}
 */
export function resolveBlastCoreOf(cores, wsId, from) {
  if (!Array.isArray(cores) || cores.length === 0) return null;
  if (!Array.isArray(from) || from.length !== 3) return null;
  let best = null;
  let bestD = Infinity;
  for (const core of cores) {
    if (!core || core.wsId !== wsId || !Array.isArray(core.starPos) || core.starPos.length !== 3) continue;
    const d = Math.hypot(from[0] - core.starPos[0], from[1] - core.starPos[1], from[2] - core.starPos[2]);
    if (!Number.isFinite(d)) continue;
    if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && (!best || core.starPos[0] < best.starPos[0]))) {
      best = core;
      bestD = d;
    }
  }
  if (!best) return null;
  return { wsId: best.wsId, starPos: best.starPos.slice() };
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
 * 插件覆盖层（提案列表面板 / 动作按钮条 / 会话列表面板）目标判定
 * （add-cosmos-proposal-actions 3.5；add-cosmos-session-list-panel 复用；
 * swap-cosmos-session-toggle-titlebar 移除把手选择器——会话面板恒渲染，折叠态标题栏
 * 按钮亦在 `.dsh-cosmos-sessions` 内，豁免语义零回退）：面板与动作条是
 * `cos-page` 下与引擎根 `.cos-root` **互为兄弟**的覆盖元素，焦点落在其内（含 `tabIndex`
 * 面板容器与非输入控件）时引擎 WASD 平移劫持 MUST NOT 生效——与顶部搜索框同款纪律
 * （否则在面板里按方向键/字母键会把镜头拖走）。
 * @param {object|null} el document.activeElement
 * @returns {boolean}
 */
export function isUiChromeTarget(el) {
  if (!el || typeof el.closest !== "function") return false;
  try {
    return el.closest(".dsh-cosmos-panel, .dsh-cosmos-actions, .dsh-cosmos-sessions") !== null;
  } catch {
    return false;
  }
}

/**
 * 按钮类焦点判定（add-cosmos-session-open-hotkey D1-5）：空格对 `button` /
 * `[role="button"]` / 链接是**原生激活**语义——会话打开快捷键命中这类焦点 MUST 跳过，
 * 否则「原生激活 + 快捷键」双触发。`closest` 查询泛化到将来新增的按钮类覆盖元素；
 * 与 `isUiChromeTarget` 同款防御（伪 DOM 桩无 `closest` → 视为未命中，旧桩零破坏）。
 * @param {object|null} el document.activeElement
 * @returns {boolean}
 */
function isButtonLikeTarget(el) {
  if (!el || typeof el.closest !== "function") return false;
  try {
    return el.closest("button,[role='button'],a") !== null;
  } catch {
    return false;
  }
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

/* ---------- 缩放阈值钻取导航与指针聚焦（add-cosmos-zoom-focus-nav D1–D4/D7） ---------- */

/** 钻取参考视距（dive 补间终态 dist，全部星座统一）。 */
export const DIVE_REF = 155;
/** 视图切换冷却窗（ms）：触发与切换补间收尾双锚点，窗内不再判定（抑制连续振荡）。 */
export const SWITCH_COOLDOWN_MS = 800;
/** 银河态进入判定的屏心闸门系数（× min(W,H)）。 */
export const CENTER_GATE_RATIO = 0.25;
/** 缩放触发 dive 的 diveFrom 安全裕量（把快照 dist 拉出进入触发带）。 */
export const DIVE_SAFE_MARGIN = 1.15;
/** 返回判定的视距下限倍率（× DIVE_REF；显式滞回，保证刚进入的镜头绝不误返回）。 */
export const FLYOUT_DIST_FLOOR_MULT = 1.35;
/* ---------- 彗星游荡方程（确定性；`updateScene` 与捕获离场切向共用单一数值来源） ---------- */

/** 游荡振幅（世界单位）：x±58 / y±16(+10 偏置) / z±46。 */
export const COMET_WANDER_AMP = Object.freeze([58, 16, 46]);
/** 游荡角频率（rad/s）：三轴不同步 → 非闭合漂移路径。 */
export const COMET_WANDER_FREQ = Object.freeze([0.19, 0.31, 0.15]);
/** y 轴抬升偏置（彗星整体浮于黄道面上方）。 */
const COMET_WANDER_Y_BIAS = 10;
/** 彗星确定性游荡包络半径（游荡方程 x±58 / y 至 26 / z±46 的最远点；游离于星云下限）。 */
export const COMET_WANDER_R = Math.hypot(COMET_WANDER_AMP[0], COMET_WANDER_AMP[1] + COMET_WANDER_Y_BIAS, COMET_WANDER_AMP[2]);

/**
 * 彗星离场切向（纯函数，导出供冒烟直测）：游荡方程对时间的解析导数（单位向量）。
 * 捕获补间以它作为起行方向（起点切向连续）；由引擎在 `markCapture` 时按旧彗星体
 * 仍在册的 `phase` 就地求导——**不新增 client 传参**。
 * @param {number} phase 彗星游荡相位（body.phase，idHash 派生）
 * @param {number} t 时刻（秒）
 * @returns {number[]} 单位切向（退化 → 零向量）
 */
export function cometHeadingAt(phase, t) {
  const A = COMET_WANDER_AMP, F = COMET_WANDER_FREQ;
  return unit3([
    -Math.sin(t * F[0] + phase) * F[0] * A[0],
    Math.cos(t * F[1] + phase) * F[1] * A[1],
    Math.cos(t * F[2] + phase) * F[2] * A[2]
  ]);
}

/* ---------- 提案 ↔ 恒星选中联动（add-cosmos-selection-linkage D2/D8） ---------- */

/** 恒星级重对焦终态视距（与 dive 落地同源，取 `min(当前距离, STAR_FOCUS_DIST)`）。 */
export const STAR_FOCUS_DIST = 155;
/** 同星座重对焦补间时长（ms）：短补间，不重播 dive 的全量 1300ms 钻入。 */
export const STAR_FOCUS_DUR = 600;

function positiveOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * 缩放阈值切换判定（纯函数，1.1/D7；引擎在缩放输入处理处内联调用）。
 *
 * 口径（design D1/D2）：
 *  - 进入（银河态）：最近星座中心视距 `vz ≤ DIVE_REF / (zoomDiveRatio/100)`（「星座屏显
 *    尺寸达到钻取参考尺寸的 X%」的视距等价式，与星座大小无关），且该星座屏心距离
 *    `≤ min(W,H) × CENTER_GATE_RATIO`（闸门外不参与）；
 *  - 返回（钻取态）：焦点星座屏显直径 `2·boundR·f/dist ≤ (zoomFlyOutRatio/100) ×
 *    min(W,H)`，且 `dist ≥ DIVE_REF × 1.35`（显式滞回下限）；
 *  - 守卫：`blocked` 由调用方聚合（补间/拖拽/手势/冷却任一在途）→ 早退双 false；
 *    模式隔离：galaxy 只可能 dive、drilled 只可能 flyOut。
 *
 * @param {{mode?: "galaxy"|"drilled", blocked?: boolean, vz?: number, centerDistPx?: number,
 *   minViewportPx?: number, dist?: number, boundR?: number, f?: number}} state
 * @param {{diveRatio?: number, flyOutRatio?: number}} [params]
 * @returns {{dive: boolean, flyOut: boolean}}
 */
export function zoomSwitchVerdict(state, params) {
  const s = state && typeof state === "object" ? state : {};
  if (s.blocked === true) return { dive: false, flyOut: false };
  const diveRatio = positiveOr(params?.diveRatio, 100);
  const flyOutRatio = positiveOr(params?.flyOutRatio, 25);
  const minVp = Number(s.minViewportPx);
  if (!(minVp > 0)) return { dive: false, flyOut: false };
  if (s.mode === "drilled") {
    const dist = Number(s.dist);
    const boundR = Number(s.boundR);
    const f = Number(s.f);
    if (!(dist > 0) || !(boundR >= 0) || !(f > 0)) return { dive: false, flyOut: false };
    const diameter = (2 * boundR * f) / dist;
    const limit = (flyOutRatio / 100) * minVp;
    const hysteresis = dist >= DIVE_REF * FLYOUT_DIST_FLOOR_MULT;
    return { dive: false, flyOut: hysteresis && diameter <= limit };
  }
  const vz = Number(s.vz);
  const centerDistPx = Number(s.centerDistPx);
  if (!Number.isFinite(vz) || !Number.isFinite(centerDistPx) || centerDistPx < 0) {
    return { dive: false, flyOut: false };
  }
  const insideGate = centerDistPx <= minVp * CENTER_GATE_RATIO;
  const threshold = DIVE_REF / (diveRatio / 100);
  return { dive: insideGate && vz <= threshold, flyOut: false };
}

/**
 * 指针视图坐标 → canvas 相对坐标（纯函数，单源换算；fix-cosmos-zoom-nav-focus-deadzone D1）。
 *
 * 容器级 wheel 监听与公共面 `zoomBy` MUST 共用本函数：换算职责归引擎（它拥有 canvas），
 * 页面层只转发原始 `clientX/clientY`——rect 口径单源，杜绝动作条侧自算 rect 的漂移面。
 * 越界有限坐标 MUST NOT 被截断：指针落在动作条等 canvas 外区域时结果可为负/超画布，
 * `zoomFocusTargetOf` 的射线平面求交对画布外延线自洽（截断反而扭曲聚焦方向）；
 * 仅非有限数（缺坐标的合成事件/旧测试桩）回落 `null`（→ 屏心缩放）。
 *
 * @param {number} clientX 指针视图坐标 x（`ev.clientX`）
 * @param {number} clientY 指针视图坐标 y（`ev.clientY`）
 * @param {{left?: number, top?: number}|null} rect `canvas.getBoundingClientRect()` 结果
 * @returns {{x: number, y: number}|null} canvas 相对坐标；非法入参 → null
 */
export function canvasPointOf(clientX, clientY, rect) {
  if (!rect || typeof rect !== "object") return null;
  const cx = Number(clientX);
  const cy = Number(clientY);
  const left = Number(rect.left);
  const top = Number(rect.top);
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
  return { x: cx - left, y: cy - top };
}

/**
 * 指针聚焦缩放的 target 步进（纯函数，1.2/D3/D7；纯数学零 DOM 依赖）。
 *
 * 指针屏幕坐标 → 视图空间射线（`s = f/vz` 直接反解）→ 与**过 cam.target、垂直视线的
 * 平面**求交得世界点 P → `target += (P − target) × (1 − d1/d0)`。多次滚动逐步向指针
 * 位置收敛；`newDist === cam.dist`（端点 clamp）或坐标/尺寸非法 → 返回原 target 拷贝。
 *
 * @param {{target: number[], yaw: number, pitch: number, dist: number, fov?: number}} cam
 * @param {number} px 指针 canvas 相对 x
 * @param {number} py 指针 canvas 相对 y
 * @param {number} W 画布逻辑宽
 * @param {number} H 画布逻辑高
 * @param {number} newDist 本步缩放后的镜头距离
 * @returns {number[]} 新 target（无效输入返回原 target 拷贝）
 */
export function zoomFocusTargetOf(cam, px, py, W, H, newDist) {
  const c = cam && typeof cam === "object" ? cam : null;
  const target = Array.isArray(c?.target) && c.target.length === 3 ? c.target : [0, 0, 0];
  const d0 = Number(c?.dist);
  const d1 = Number(newDist);
  if (!Number.isFinite(d0) || d0 <= 0 || !Number.isFinite(d1) || Math.abs(d1 - d0) < 1e-12) {
    return target.slice();
  }
  const w = Number(W);
  const h = Number(H);
  const x = Number(px);
  const y = Number(py);
  if (!(w > 0) || !(h > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return target.slice();
  const fov = Number(c.fov) > 0 ? Number(c.fov) : 60;
  const f = (h * 1.1) / (2 * Math.tan(fov * Math.PI / 360));
  if (!(f > 0)) return target.slice();
  /* 视图空间：指针射线方向 ∝ ((px−W/2)/f, (H/2−py)/f, 1)；相机在 z=−d0，
     与过 target 的平面 z=0 交于 (d0·dx, d0·dy, 0)。逆变换回世界系（rotY/rotX 反序取反角）。 */
  const yaw = Number.isFinite(Number(c.yaw)) ? Number(c.yaw) : 0;
  const pitch = Number.isFinite(Number(c.pitch)) ? Number(c.pitch) : 0;
  const offset = rotY(rotX([d0 * ((x - w / 2) / f), d0 * ((h / 2 - y) / f), 0], pitch), yaw);
  const k = 1 - d1 / d0;
  return [target[0] + offset[0] * k, target[1] + offset[1] * k, target[2] + offset[2] * k];
}

/**
 * 星座包围球半径（2.1/D4；buildScenePure 构建期预计算、patch 路径同触点更新）。
 *
 * 以 `ws.center` 为圆心度量（钻取终态 target = centerTargetOf(ws)，屏显尺寸围绕星座
 * 中心呈现），取几何包络而非天体当前帧位置快照（行星每帧沿轨道运动，快照既非确定
 * 又随相位陈旧）：
 *  - 恒星：`max(|off|)`；
 *  - 行星：`|c − ws.center| + baseR + (有卫星 ? baseR×2+17 : baseR)`（轨道中心 c 为
 *    构建期已知的簇心恒星 wp / 联星质心；稳态轨道半径 = baseR，捕获螺旋瞬态不纳入）；
 *  - 彗星：确定性游荡包络常量 `COMET_WANDER_R`；
 *  - 下限：星云渲染半径 `12 + archives×2.4`（空星座兜底）。
 * 仅消费于返回阈值判定，MUST NOT 影响布局/绘制。
 *
 * @param {object} ws 场景星座 body
 * @returns {number}
 */
export function constellationBoundROf(ws) {
  const center = Array.isArray(ws?.center) && ws.center.length === 3 ? ws.center : [0, 0, 0];
  let bound = 12 + Math.max(0, Number(ws?.archives) || 0) * 2.4;
  for (const star of Array.isArray(ws?.stars) ? ws.stars : []) {
    const off = Array.isArray(star?.off) ? star.off : [0, 0, 0];
    bound = Math.max(bound, Math.hypot(Number(off[0]) || 0, Number(off[1]) || 0, Number(off[2]) || 0));
  }
  for (const planet of Array.isArray(ws?.planets) ? ws.planets : []) {
    const c = Array.isArray(planet?.center) ? planet.center : center;
    const baseR = Number(planet?.baseR) > 0 ? Number(planet.baseR) : 16;
    const d = Math.hypot(
      (Number(c[0]) || 0) - center[0],
      (Number(c[1]) || 0) - center[1],
      (Number(c[2]) || 0) - center[2]
    );
    const hasSats = Array.isArray(planet?.sats) && planet.sats.length > 0;
    bound = Math.max(bound, d + baseR + (hasSats ? baseR * 2 + 17 : baseR));
  }
  if (Array.isArray(ws?.comets) && ws.comets.length > 0) bound = Math.max(bound, COMET_WANDER_R);
  return bound;
}

/**
 * 回归条目的激波弹射 body 字段（buildScenePure 与 marker fire 共用；无 blast → null）：
 * 快照均为标记时定格（尾迹/爆心不随场景替换消失），rebuild 时从 E.regressions 重挂。
 * @param {object|null} entry 回归补间条目
 * @returns {{blast:{starPos:number[]}, hit:number, kickDist:number, kickDir:number[], blastTrail:number[][]|null, blastTrailAcc:number}|null}
 */
function blastFieldsOf(entry) {
  if (!entry || !entry.blast || !Array.isArray(entry.blast.starPos) || entry.blast.starPos.length !== 3) return null;
  if (!(Number(entry.hit) >= 0)) return null;
  return {
    blast: { starPos: entry.blast.starPos.slice() },
    hit: Number(entry.hit),
    kickDist: Math.max(0, Number(entry.kickDist) || 0),
    kickDir: Array.isArray(entry.kickDir) && entry.kickDir.length === 3 ? entry.kickDir.slice() : [1, 0, 0],
    blastTrail: Array.isArray(entry.trail) ? entry.trail.map(function (p) { return p.slice(); }) : null,
    blastTrailAcc: Number(entry.trailAcc) || 0
  };
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
        /* 成星捕获补间挂接（polish-cosmos-orbit-insertion）：`E.captures` 条目 =
           `{t0, from, heading, trail?, degraded}`——补间在册期 rebuild 从 Map 重挂
           `captureStart`（t0 为 fire 帧重锚值，语义与既有机制不变）；数字形态兼容
           （纯函数调用方可直接传 t0）。 */
        captureStart: typeof capture === "number" ? capture
          : (capture && Number.isFinite(Number(capture.t0)) ? Number(capture.t0) : null),
        captureAlpha: 1, // 捕获 α 因子（风暴降级坡道消费；稳态恒 1）
      });
    });
    (w.comets || []).forEach(function (cm) {
      /* 回归补间挂接：markRegression 先于 setScene（客户端差分环内调用，时序约束）
         → build 时从 regressions 读取快照；无回归 → from null 走纯游荡方程。
         激波弹射变体额外挂 hit/kickDist/尾迹快照（add-cosmos-nova-ejection D2/D4）。 */
      const regression = regMap.get(cm.id);
      const blast = regression ? blastFieldsOf(regression) : null;
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
        regressAlpha: regression ? 0 : 1,
        blast: blast ? blast.blast : null,
        hit: blast ? blast.hit : null,
        kickDist: blast ? blast.kickDist : 0,
        kickDir: blast ? blast.kickDir : null,
        blastTrail: blast ? blast.blastTrail : null,
        blastTrailAcc: blast ? blast.blastTrailAcc : 0
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
    /* 星座包围球半径（add-cosmos-zoom-focus-nav 2.1/D4）：返回阈值判定的屏显直径口径，
       构建期确定性预计算（仅消费于判定，不进布局/绘制）。 */
    ws.boundR = constellationBoundROf(ws);
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
 * 结构重建时继承旧帧尾迹（按 id 键控）：`buildScenePure` 产出全新的 body（trail 为空），
 * 若整帧替换会让行星/彗星/卫星尾迹瞬间消失再重新长出——结构变化（新建会话、关联变化等）
 * 时的可见「闪动」之一。仅在中心未变化时继承（中心滑移/过滤重排时旧尾迹坐标相对旧中心，
 * 继承会留下错位残影）。
 */
function inheritTrails(prevScene, nextScene) {
  if (!prevScene || !nextScene) return;
  const sameVec3 = function (a, b) {
    return Array.isArray(a) && Array.isArray(b) && a.length === 3 && b.length === 3
      && Math.abs(Number(a[0]) - Number(b[0])) < 1e-6
      && Math.abs(Number(a[1]) - Number(b[1])) < 1e-6
      && Math.abs(Number(a[2]) - Number(b[2])) < 1e-6;
  };
  const inheritSats = function (nextSats, oldSats) {
    const byId = new Map((Array.isArray(oldSats) ? oldSats : []).map(function (s) { return [s.id, s]; }));
    (Array.isArray(nextSats) ? nextSats : []).forEach(function (sat) {
      const old = byId.get(sat.id);
      if (!old) return;
      sat.trail = old.trail;
      sat.acc = old.acc;
    });
  };
  const prevWs = new Map(prevScene.ws.map(function (w) { return [w.id, w]; }));
  nextScene.ws.forEach(function (ws) {
    const oldWs = prevWs.get(ws.id);
    if (!oldWs || !sameVec3(oldWs.center, ws.center)) return;
    const oldPlanets = new Map(oldWs.planets.map(function (p) { return [p.id, p]; }));
    ws.planets.forEach(function (p) {
      const old = oldPlanets.get(p.id);
      if (!old || !sameVec3(old.center, p.center)) return;
      p.trail = old.trail;
      p.acc = old.acc;
      inheritSats(p.sats, old.sats);
    });
    const oldComets = new Map(oldWs.comets.map(function (c) { return [c.id, c]; }));
    ws.comets.forEach(function (c) {
      const old = oldComets.get(c.id);
      if (!old) return;
      c.trail = old.trail;
      c.acc = old.acc;
      inheritSats(c.sats, old.sats);
    });
  });
}

/**
 * 创建引擎实例。
 * @param {object} opts
 * @param {HTMLElement} opts.container overlay 根容器（Canvas 与 DOM 覆盖层挂载点）
 * @param {object} opts.style 风格皮肤（skin-d 模块产出；palette/background/drawBody）
 * @param {() => boolean} [opts.consumeEscape] 外壳分层钩子占位（保留形状；实际消费走 consumeEscape）
 * @param {(sessionId: string) => void} [opts.onOpenSession] 信息卡「打开会话」回调
 * @param {(sessionId: string) => (void|Promise<void>)} [opts.onArchiveSession]
 *        信息卡「归档会话」回调（add-cosmos-session-archive-action D4）；返回 Promise 时
 *        引擎以它作为在途窗口（响应到达 → 恢复按钮），同步返回值视为立即完成。
 * @param {(info: {kind: string, wsId: string, id: string, lifecycle?: string}|null) => void} [opts.onSelectChange]
 *        选中态变更回调（add-cosmos-selection-linkage D6）：**幂等**——以 `kind:wsId:id`
 *        键比较，键变才回调一次（置空亦然）；载荷恒星附 `lifecycle` 供客户端排除星胚。
 * @param {(sessionId: string) => void} [opts.onDecideSession]
 *        信息卡「决策」按钮回调（cosmos-session-decide D6）：与 onOpenSession 同模式注入
 *        （客户端复用官方 openSession 链路：先关整页再切到系统会话页，决策面由 DSH 原生
 *        composer takeover 呈现）；未注入 → 静默 no-op（同既有守卫，无视觉副作用）。
 * @param {{decide?: object, vitality?: object}} [opts.labels]
 *        信息卡文案注入位（locale 同源，任务 5.4）：`decide` = 决策按钮 pendingKind 映射
 *        （键域 approval / plan-review / question + fallback），`vitality` = 活力状态行
 *        行标（label）与两态取值（active / sleep）；缺省 = 引擎内 DEFAULT_LABELS。
 */
export function createCosmosEngine(opts) {
  if (!opts?.container) throw new TypeError("createCosmosEngine: container required");
  const E = {
    container: opts.container,
    style: opts.style,
    /* 皮肤热切换代数（add-cosmos-skin-themes D6/2.2，观测面）：仅呈现层替换，不动场景。 */
    skinGen: 0,
    onOpenSession: typeof opts.onOpenSession === "function" ? opts.onOpenSession : null,
    /* 信息卡「归档会话」回调（add-cosmos-session-archive-action D4）：与 onOpenSession
       同模式注入；构造缺失 → 归档按钮点击静默忽略（不抛错）。 */
    onArchiveSession: typeof opts.onArchiveSession === "function" ? opts.onArchiveSession : null,
    /* 信息卡「决策」回调（cosmos-session-decide D6）：与 onOpenSession/onArchiveSession
       同模式；构造缺失 → 决策按钮点击静默 no-op。 */
    onDecideSession: typeof opts.onDecideSession === "function" ? opts.onDecideSession : null,
    /* 信息卡文案注入位（5.4）：locale 同源文案覆盖缺省表（缺键/非字符串回落下沉）。 */
    labels: {
      decide: Object.assign({}, DEFAULT_LABELS.decide, textRecordOf(opts.labels?.decide)),
      vitality: Object.assign({}, DEFAULT_LABELS.vitality, textRecordOf(opts.labels?.vitality))
    },
    /* 归档按钮在途会话 id（权威防重入门，D6）：per-session 单飞——卡片在途重渲染会
       抹掉按钮的 disabled 属性，DOM 只是呈现层，本集合才是「重复点击被忽略」的依据。 */
    archiveInFlight: new Set(),
    /* 钻取态订阅（add-cosmos-proposal-actions 3.4/3.6）：React 面板据当前星座过滤与
       让位顶部中央标牌；polish-cosmos-drilled-hud 起同一信号亦门控搜索框的钻取态隐藏。
       只在钻取态**真正变化**时回调（幂等），null = 回到银河。 */
    onDrillChange: typeof opts.onDrillChange === "function" ? opts.onDrillChange : null,
    drillKey: "\u0000",
    /* 选中态订阅（add-cosmos-selection-linkage D6）：与 onDrillChange 同款幂等通道——
       以 `kind:wsId:id` 键比较，键变才回调（含置空）；载荷命中 D7 `inspectSelection` 同形。 */
    onSelectChange: typeof opts.onSelectChange === "function" ? opts.onSelectChange : null,
    selectKey: "",
    cam: { target: [0, 0, 0], yaw: -0.7, pitch: 0.5, dist: 430, fov: 60 },
    tween: null,
    focusWs: null, focusMix: 0, diveSel: null, diveSelKind: null,
    diveFrom: null, // dive 前的完整镜头快照（Esc 全量回放，平移/缩放语义配套）
    hovered: null, selected: null,
    meteor: null, nextMeteor: 3.2,
    eventMeteors: [],
    captures: new Map(), // sessionId → {t0, from, heading, trail?, trailAcc?, degraded}（成星捕获补间；t0 = fire 帧重锚值）
    regressions: new Map(), // sessionId → {t0, from, blast?, hit?, kickDist?, kickDir?, trail?, trailAcc?}（行星回归补间；blast = 激波弹射变体）
    novae: [], // 超新星幽灵条目（引擎级瞬态，与场景实体解耦——归档帧恒星已不在场景）
    wsGhosts: [], // 星座消散幽灵（D5）：引擎快照尘埃 offsets + 恒星位置/色，外扩飘散 1.5s 自灭
    fx: new Map(), // 'star:<id>' / 'planet:<id>' → {type, t0, dur, degraded?}（点燃/落印/查看渐熄/出生/金涌转场）
    fxQueue: [], // 延迟启动队列（D7）：{priority, wsId, fire(), enqueueAt, delay, bootUntil, activeDur}
    fxActive: [], // 已启动转场进行窗口（P1 并发上限计数；startedAt + activeDur）
    fxLastStart: new Map(), // "priority|wsId" → 上次同 ws 启动时刻（错峰步长基线）
    fxStorm: false, // 风暴降级开关（待启动积压 > 8 时 true，阈值比较即自动恢复）
    linkMix: new Map(), // wsId → Map("aId|bId" → {t0, dir:'in'|'out', pA?, pB?})（D8 连线段淡入淡出，跨 rebuild 键控恒星 id 对）
    /* 关联聚焦坡道（cosmos-relation-focus D3）：键 `wsId|kind:id` → {t0, dir:'in'|'out',
       wsId, kind, id}。跨 rebuild 按键保留（id 基），切换 = 旧键 out + 新键 in；α 因子由
       条目 t0 与帧时刻现算，不落 body（纯派生，无失效路径）。 */
    relMix: new Map(),
    relFocusKey: "", // 当前聚焦源键（"" = 无 hover/选中；E.hovered ?? E.selected）
    relLast: null, // 最近一帧 rel 呈现快照（inspectRelation 观测面）
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
    pan3: null, // {sx, sy, movedX, movedY, pinchCarry}：三指平移质心起点/累计位移（add-cosmos-three-finger-pan D3）
    pinchCarry: false, // 本手势序列曾发生捏合（3→1/3→0 收束补判链，防切平移丢失阈值导航）
    gestureEndAt: -Infinity, // 手势结束时刻（GESTURE_SUPPRESS_MS 抑制窗起点）
    viewSwitchAt: -Infinity, // 视图切换冷却锚点（触发 + 切换补间收尾双写；add-cosmos-zoom-focus-nav D2）
    diveCount: 0, // dive() 调用计数（观测面：容器级重绑「单次 dive」防回归断言）
    panKeys: new Set(), // WASD 按住集合（keydown/keyup 维护，帧循环积分）
    keyListeners: null, // window 键盘监听句柄（dispose 卸载）
    tuning: {
      speed: Number(opts.settings?.panSpeed) > 0 ? opts.settings.panSpeed : PAN_SPEED,
      boost: Number(opts.settings?.panShiftBoost) > 0 ? opts.settings.panShiftBoost : PAN_SHIFT_BOOST,
      /* 缩放导航调参（add-cosmos-zoom-focus-nav 2.6）：与设置面同键装载；非法值回落缺省。 */
      diveRatio: positiveOr(opts.settings?.zoomDiveRatio, 100),
      flyOutRatio: positiveOr(opts.settings?.zoomFlyOutRatio, 25),
      pointerFocus: opts.settings?.zoomPointerFocus !== false
    }, // 可配置平移速度 + 缩放导航（settings.mjs 装载；setTuning 热更新）
    W: 0, H: 0, dpr: 1,
    sceneData: null, // providers 合并 scene（mock 同构）
    scene: null, ctx: null,
    picks: [], screens: {},
    el: {}, chips: {}, slabs: {},
    t: 0, lastTs: 0, raf: 0, running: false, disposed: false,
    resizeObserver: null
  };

  function entKey(e) { return e.kind + ':' + e.data.id; }

  /* ---------- 选中态收口（add-cosmos-selection-linkage D6） ----------
     `E.selected` 的**唯一**写入口：赋值 + 幂等通知。全部位点（pointerup 命中/空白、
     dive 清、flyOut 清、stepTween 落地/飞出、consumeEscape 清、remapFocusRefs 置空）
     一律经此，避免出现「状态变了但订阅方不知道」的漏通知位点。 */

  /** 选中键（kind:wsId:id；null → ""）。wsId 入键：同 id 可同时存在于两个工作区。 */
  function selectionKeyOf(sel) {
    return sel && sel.data ? sel.kind + ':' + (sel.ws?.id ?? '') + ':' + sel.data.id : '';
  }

  /** 选中载荷（onSelectChange / inspectSelection 同形；star 附 lifecycle 供客户端排除星胚）。 */
  function selectionInfoOf(sel) {
    if (!sel || !sel.data) return null;
    const info = { kind: sel.kind, wsId: sel.ws?.id ?? null, id: sel.data.id };
    if (sel.kind === 'star') info.lifecycle = sel.data.lifecycle ?? null;
    return info;
  }

  /** 选中态写入口（幂等通知）：键未变 → 只更新引用（结构重建换代）不回调。 */
  function setSelection(next) {
    E.selected = next || null;
    const key = selectionKeyOf(E.selected);
    if (key === E.selectKey) return;
    E.selectKey = key;
    if (!E.onSelectChange) return;
    try {
      E.onSelectChange(selectionInfoOf(E.selected));
    } catch (error) {
      console.warn('[dsh-v-cosmos] select listener failed:', error);
    }
  }

  /** 实体归属推导 kind（`diveSel` 存实体、无 kind 字段——落地预选必须在此推导，
      否则 entKey 键不合 → 选中环/名牌/信息卡全链不显示，remapFocusRefs 亦误清）。 */
  function kindOfEntity(ws, ent) {
    if (!ws || !ent) return null;
    if ((ws.stars ?? []).indexOf(ent) >= 0) return 'star';
    if ((ws.planets ?? []).indexOf(ent) >= 0) return 'planet';
    if ((ws.comets ?? []).indexOf(ent) >= 0) return 'comet';
    return null;
  }

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

  /** 场景内天体 body 查询（MUST 在 setScene 替换前读取：回归的 from/尾迹快照与
      世界坐标查询都依赖旧场景实体仍在册）。kind 'planet'|'comet'。 */
  function findBodyInScene(kind, id) {
    if (id == null) return null;
    for (const ws of E.scene?.ws ?? []) {
      const list = kind === 'planet' ? ws.planets : kind === 'comet' ? ws.comets : null;
      const found = list?.find(function (b) { return b.id === id; });
      if (found) return found;
    }
    return null;
  }

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

  /* ---------- 关联聚焦（cosmos-relation-focus D1/D3） ---------- */

  /** 聚焦源描述（hover/选中实体 → {wsId, kind, id}；实体残缺 → null）。 */
  function relDescriptorOf(ent) {
    if (!ent || !ent.data || !ent.ws) return null;
    return { wsId: ent.ws.id, kind: ent.kind, id: ent.data.id };
  }

  /** 聚焦源键：wsId 入键（同一 id 可存在于两个星座，标签/关系必须归到正确星座）。 */
  function relKeyOf(desc) {
    return desc ? desc.wsId + '|' + desc.kind + ':' + desc.id : '';
  }

  /** 坡道 α（dir:'in' → 0→1；'out' → 1→0；由条目 t0 与当前帧时刻现算）。 */
  function relAlphaOf(entry, t) {
    if (!entry) return 0;
    const k = clamp((t - entry.t0) / REL_FADE_DUR, 0, 1);
    return entry.dir === 'in' ? k : 1 - k;
  }

  /** 聚焦源切换裁决（每帧一次，buildItems 首部调用）：旧键转 out（重锚 t0 保 α 连续），
      新键转 in（同键复活亦按当前 α 续接，无瞬间跳变）；空源 = 全体 out 渐熄。 */
  function advanceRelFocus(t) {
    const desired = relDescriptorOf(E.hovered || E.selected);
    const key = relKeyOf(desired);
    if (key === E.relFocusKey) return;
    const old = E.relMix.get(E.relFocusKey);
    if (old) {
      const a = relAlphaOf(old, t);
      old.dir = 'out';
      old.t0 = t - (1 - a) * REL_FADE_DUR;
    }
    if (desired) {
      const cur = E.relMix.get(key);
      if (cur) {
        const a = relAlphaOf(cur, t);
        cur.dir = 'in';
        cur.t0 = t - a * REL_FADE_DUR;
      } else {
        E.relMix.set(key, { t0: t, dir: 'in', wsId: desired.wsId, kind: desired.kind, id: desired.id });
      }
    }
    E.relFocusKey = key;
  }

  /** 活动聚焦集（α>0）：播完的 out 条目就地摘除；焦点键自身条目即使 α=0 也保留（下一帧
      可复活续接）。返回 [{wsId, kind, id, alpha}]，由 buildItems 按星座分组消费。 */
  function activeRelFocuses(t) {
    const list = [];
    for (const [key, entry] of E.relMix) {
      const alpha = relAlphaOf(entry, t);
      if (alpha <= 0.001) {
        if (key !== E.relFocusKey) E.relMix.delete(key);
        continue;
      }
      list.push({ wsId: entry.wsId, kind: entry.kind, id: entry.id, alpha: alpha });
    }
    return list;
  }

  /** 单星座关联集派生（D1：纯派生、现场重算、无缓存）：
      - star 聚焦 → 全部关联行星的轨道环 + 该星→各行星关系段 + 该星端点的共享会话段；
      - planet 聚焦 → 自身轨道环 + 行星→各关联星关系段（联星全量）；
      - comet / 无关联 → 空集（不产生任何 rel 增强，SHALL NOT 报错）。
      关系段端点用恒星 wp 与行星当前帧 wp（每帧重算，行星运动线随动）。 */
  function relSetOf(ws, relFocuses, cam, W, H) {
    const mine = relFocuses.filter(function (r) { return r.wsId === ws.id; });
    if (mine.length === 0) return null;
    const orbit = new Map(); // planetId → α（多聚焦源交叉淡变取最大）
    const segByPair = new Map(); // "starId|planetId" → 段（交叉淡变同一关系只画一条，α 取最大）
    const links = new Map(); // starId → α（该星端点的共享会话虚线段）
    const starById = new Map(ws.stars.map(function (s) { return [s.id, s]; }));
    const planetById = new Map(ws.planets.map(function (p) { return [p.id, p]; }));
    const pushSeg = function (starId, planetId, pa, pb, alpha) {
      const key = starId + '|' + planetId;
      const prev = segByPair.get(key);
      if (prev) {
        if (alpha > prev.relAlpha) prev.relAlpha = alpha;
        return;
      }
      segByPair.set(key, { a: pa, b: pb, alpha: 1, rel: true, relAlpha: alpha, starId: starId, planetId: planetId });
    };
    let starPlanetMap = null;
    for (const rel of mine) {
      if (rel.kind === 'star') {
        const star = starById.get(rel.id);
        if (!star) continue;
        if (!starPlanetMap) starPlanetMap = starPlanetIdsOf(ws);
        const ids = starPlanetMap.get(rel.id) || [];
        if (ids.length === 0) continue; // 无关联行星 → 聚焦集空（亦无共享会话端点）
        links.set(rel.id, Math.max(links.get(rel.id) || 0, rel.alpha));
        const pa = project(cam, star.wp, W, H);
        for (const pid of ids) {
          const planet = planetById.get(pid);
          if (!planet) continue;
          orbit.set(pid, Math.max(orbit.get(pid) || 0, rel.alpha));
          const pb = project(cam, planet.wp, W, H);
          if (pa && pb) pushSeg(rel.id, pid, pa, pb, rel.alpha);
        }
      } else if (rel.kind === 'planet') {
        const planet = planetById.get(rel.id);
        if (!planet) continue;
        orbit.set(planet.id, Math.max(orbit.get(planet.id) || 0, rel.alpha));
        const pb = project(cam, planet.wp, W, H);
        for (const star of planet.stars) {
          const pa = project(cam, star.wp, W, H);
          if (pa && pb) pushSeg(star.id, planet.id, pa, pb, rel.alpha);
        }
      }
    }
    return { orbit: orbit, segs: [...segByPair.values()], links: links };
  }

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
        /* 成星捕获补间（polish-cosmos-orbit-insertion）：起点连续的混合曲线——自彗星
           最后世界坐标出发的 approach 段与稳态轨道方程按 smoothstep 混合（见
           capturePoseAt）。k≥1 / 降级 α 坡道完成 → 摘除：body 补间态置空 + E.captures
           条目同步退出（Map 仅在册进行中补间；已消失 id 的残留由 rebuild prune 兜底）。 */
        const cap = p.captureStart != null ? E.captures.get(p.id) : null;
        if (cap) {
          const pose = capturePoseAt(p, cap, t);
          p.wp = pose.wp;
          p.captureAlpha = pose.alpha;
          if (pose.k >= 1 || (pose.degraded === true && pose.alpha >= 1)) {
            p.captureStart = null;
            p.captureAlpha = 1;
            E.captures.delete(p.id);
          }
        } else {
          if (p.captureStart != null) p.captureStart = null; // 条目缺失（防御）→ 稳态就位
          p.wp = orbitPointAt(p, t);
        }
        if (ws.vis) {
          p.acc += dt;
          if (p.acc > 0.05) { p.acc = 0; p.trail.push(p.wp.slice()); if (p.trail.length > 14) p.trail.shift(); }
        }
        stepSatBodies(p.sats, p.wp, p.inc, satOrbitR(p), t, dt, ws.vis);
      });
      ws.comets.forEach(function (c) {
        expireMix(c);
        (c.sats ?? []).forEach(expireMix);
        const WA = COMET_WANDER_AMP, WF = COMET_WANDER_FREQ;
        const wander = [
          center[0] + Math.cos(t * WF[0] + c.phase) * WA[0],
          center[1] + Math.sin(t * WF[1] + c.phase) * WA[1] + COMET_WANDER_Y_BIAS,
          center[2] + Math.sin(t * WF[2] + c.phase) * WA[2]
        ];
        /* 回归反向捕获补间（成星捕获转场的镜像方向）：
           - 普通回归：wp 从行星最后轨道位置 easeOutCubic 滑向游荡点（1.4s），
             α 前 0.5s 坡道 0→1 渐入；
           - 激波弹射变体（add-cosmos-nova-ejection D2）：hold（α=0 定格于 from）→
             kick（沿爆心→行星径向外抛）→ glide（汇入游荡）；kick 起始帧交接行星
             尾迹（跨 kind「尾巴点燃」），按分段总长收尾摘除；
           k 由 t 推导（无帧步进状态）→ 页签隐藏 E.t 冻结天然断点续播。 */
        if (c.regressStart != null && c.from) {
          if (c.blast && c.hit != null) {
            const seg = shockEjectionAt(t - c.regressStart, c, wander);
            c.wp = seg.wp;
            c.regressAlpha = seg.alpha;
            /* 尾迹点燃（D4）：kick 起始帧把行星空迹按跨 kind 协议挂给彗星；快照在
               markRegression 入队时采集（fire 时行星体已随场景替换销毁），消费后清
               条目快照，防 rebuild 重挂时二次交接。 */
            if (seg.phase !== 'hold' && c.blastTrail) {
              c.trail = adoptTrailAcrossKinds(c.blastTrail, 34);
              c.acc = Number(c.blastTrailAcc) || 0;
              c.blastTrail = null;
              const regEntry = E.regressions.get(c.id);
              if (regEntry) regEntry.trail = null;
            }
            if (t - c.regressStart >= shockTotalDurOf(c.hit)) {
              c.regressStart = null; c.from = null;
              c.blast = null; c.blastTrail = null;
              c.hit = null; c.kickDist = 0; c.kickDir = null;
              E.regressions.delete(c.id);
            }
          } else {
            const k = clamp((t - c.regressStart) / REGRESS_DUR, 0, 1);
            c.wp = lerpV(c.from, wander, easeOutCubic(k));
            c.regressAlpha = clamp((t - c.regressStart) / REGRESS_ALPHA_RAMP, 0, 1);
            if (k >= 1) { c.regressStart = null; c.from = null; E.regressions.delete(c.id); }
          }
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
    /* 关联聚焦坡道推进（cosmos-relation-focus D3）：聚焦源 = hovered ?? selected（hover
       优先，选中环呈现不受影响）；条目 α 由帧时刻现算，活动集按星座分组消费。 */
    advanceRelFocus(t);
    const relFocuses = activeRelFocuses(t);
    E.relLast = { focusKey: E.relFocusKey, orbits: [], segs: [], links: [] };

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
      /* 关联聚焦集（D1 纯派生无缓存）：聚焦源限于本星座；star/planet 两分支见 relSetOf，
         comet/无关联 → null（不产生任何 rel 增强）。 */
      const relSet = relSetOf(ws, relFocuses, cam, W, H);
      const segs = [];
      if (ws.links.length && ws.stars.length) {
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
          /* 共享会话虚线点亮（「恒星关联聚焦呈现」）：聚焦恒星作为任一端点 → 整段标 rel；
             无关联行星的恒星不会进入 links 集（relSetOf 早退），故此处天然只点亮有效端点。 */
          const relA = relSet ? Math.max(relSet.links.get(A.id) || 0, relSet.links.get(B.id) || 0) : 0;
          const seg = { a: pa, b: pb, alpha: segAlpha };
          if (relA > 0) {
            seg.rel = true;
            seg.relAlpha = relA;
            E.relLast.links.push({ wsId: ws.id, aId: A.id, bId: B.id, alpha: relA });
          }
          segs.push(seg);
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
      }
      /* 星↔行星关系线段（D2：复用 constline 层 / z 在天体之下；端点每帧重算，行星运动
         线随动）。rel 段与共享会话段同层并列，皮肤按 seg.rel 分流呈现。 */
      if (relSet && relSet.segs.length) {
        for (const seg of relSet.segs) {
          segs.push(seg);
          E.relLast.segs.push({ wsId: ws.id, starId: seg.starId, planetId: seg.planetId, alpha: seg.relAlpha });
        }
      }
      if (segs.length) items.push({ kind: 'constline', z: zOf(cam, center) - 4, segs: segs, ws: ws, alpha: ws.alpha });
      ws.planets.forEach(function (p) {
        const orbitPts = [];
        const orbitR = p.captureStart != null ? p.baseR * lerp(CAPTURE_RING_F0, 1, clamp((t - p.captureStart) / CAPTURE_DUR, 0, 1)) : p.baseR;
        for (let i = 0; i <= 48; i++) {
          const a = p.phase + i / 48 * TAU;
          const ca = Math.cos(a) * orbitR, sa = Math.sin(a) * orbitR;
          const ci = Math.cos(p.inc), si = Math.sin(p.inc);
          const pr = project(cam, [p.center[0] + ca, p.center[1] + sa * si * 0.9, p.center[2] + sa * ci], W, H);
          if (pr) orbitPts.push(pr);
        }
        if (orbitPts.length > 2) {
          /* 轨道环增亮（「行星关联聚焦呈现」/「恒星关联聚焦呈现」）：关联行星自身环标 rel；
             挂卫星时子轨道环同源增亮（下方 pushSatEnvelope 传入同一 α）。 */
          const orbitRel = relSet ? (relSet.orbit.get(p.id) || 0) : 0;
          const orbitItem = { kind: 'orbit', z: zOf(cam, p.center) - 2, orbitPts: orbitPts, ws: ws, alpha: ws.alpha, data: p };
          if (orbitRel > 0) {
            orbitItem.rel = true;
            orbitItem.relAlpha = orbitRel;
            E.relLast.orbits.push({ wsId: ws.id, planetId: p.id, alpha: orbitRel });
          }
          items.push(orbitItem);
        }
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
        /* 捕获 α 因子（风暴降级坡道；稳态恒 1）：条目摘除后 body 字段回 1。 */
        const planetAlpha = ws.alpha * (Number.isFinite(Number(p.captureAlpha)) ? Number(p.captureAlpha) : 1);
        E.screens[key] = { x: px, y: py, r: r };
        const it = { kind: 'planet', z: pr.z, x: px, y: py, r: r, alpha: planetAlpha, data: p, ws: ws, trail: trail, fx: planetFx, birth: birth };
        markHovers(it, 'planet', p.id);
        items.push(it);
        picks.push({ x: px, y: py, r: r + 8, e: { kind: 'planet', ws: ws, data: p } });
        pushSatEnvelope(items, cam, p, W, H, ws, t, planetAlpha, relSet ? (relSet.orbit.get(p.id) || 0) : 0);
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
        const cometAlpha = ws.alpha * (c.regressAlpha != null ? c.regressAlpha : 1);
        const it = {
          kind: 'comet', z: pr.z, x: px, y: py, r: r,
          alpha: cometAlpha, // 回归 α 坡道（0→1 渐入；激波弹射 hold 段 α=0 不可见）
          data: c, ws: ws, trail: trail,
          fx: cometFx, // 查看渐熄（skin fx 驱动谓词消费）
          birth: birth // 游入形态（尾迹先现/核后亮，2.4 skin-d 消费）
        };
        markHovers(it, 'comet', c.id);
        items.push(it);
        picks.push({ x: px, y: py, r: r + 8, e: { kind: 'comet', ws: ws, data: c } });
        pushSatEnvelope(items, cam, c, W, H, ws, t, cometAlpha, 0); // 卫星随父可见度（hold α=0 同隐；彗星无关联聚焦）
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
      bornK：卫星出生坡道（2.2，0.5s 半径 0→满 + α 坡道，skin-d sat 分支消费）。
      relAlpha：关联聚焦子轨道增亮因子（cosmos-relation-focus「挂卫星行星聚焦」SHOULD 同源；
      0 = 无关联增强，条目不带 rel 标记）。 */
  function pushSatEnvelope(items, cam, owner, W, H, ws, t, ownerAlpha, relAlpha) {
    if (!owner.sats || owner.sats.length === 0) return;
    /* 父天体可见度因子（回归 hold α=0 时卫星/子轨道同隐；缺省 = 星座 α 口径不变）。 */
    const alpha = Number.isFinite(Number(ownerAlpha)) ? Number(ownerAlpha) : ws.alpha;
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
    if (ringPts.length > 2) {
      const ring = { kind: 'suborbit', z: zOf(cam, owner.wp) - 1, orbitPts: ringPts, alpha: alpha, data: { state: owner.state || 'idle' } };
      if (relAlpha > 0) { ring.rel = true; ring.relAlpha = relAlpha; }
      items.push(ring);
    }
    owner.sats.forEach(function (sat) {
      const pr = project(cam, sat.wp, W, H);
      if (!pr) return;
      const bornK = sat.born != null ? clamp((t - sat.born) / SAT_BORN_DUR, 0, 1) : null;
      const r = clamp(1.1 * pr.s, 1.6, 5.5);
      const trail = sat.trail.map(function (w) { return project(cam, w, W, H); }).filter(Boolean);
      items.push({ kind: 'sat', z: pr.z + 1, x: pr.x, y: pr.y, r: r, alpha: alpha, data: sat, ws: ws, trail: trail, bornK: bornK });
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
      /* 切换补间收尾重锚冷却窗（add-cosmos-zoom-focus-nav D2）：触发 + 800ms 盖不住
         1300ms 补间收尾，收尾再记一次；被接管中断（cancelTween 不走本分支）由触发
         时刻锚点兜底。 */
      if (mode === 'in' || mode === 'out') E.viewSwitchAt = performance.now();
      if (mode === 'out') { E.focusWs = null; setSelection(null); } // 飞出补间收尾双保险：选中态不外泄到银河视图
      if (mode === 'out') notifyDrill(); // 回到银河：面板恢复全量分组
      /* 落地预选（add-cosmos-selection-linkage D6）：kind 由 dive 时推导的归属决定——
         既有 `E.diveSel.kind` 恒为 undefined（实体无 kind），全链选中因此从未真正生效。 */
      if (mode === 'in' && E.diveSel && E.diveSelKind) {
        setSelection({ kind: E.diveSelKind, ws: E.focusWs, data: E.diveSel });
      }
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
  /** 钻取态快照（null = 银河视图）。 */
  function drillInfo() {
    return E.focusWs ? { wsId: E.focusWs.id, name: E.focusWs.name } : null;
  }

  /** 钻取态变更广播（幂等）：仅在 (wsId, name) 变化时回调订阅方一次。 */
  function notifyDrill() {
    if (!E.onDrillChange) return;
    const info = drillInfo();
    const key = info ? info.wsId + "\u0000" + info.name : "";
    if (key === E.drillKey) return;
    E.drillKey = key;
    try {
      E.onDrillChange(info);
    } catch (error) {
      console.warn("[dsh-v-cosmos] drill listener failed:", error);
    }
  }

  function dive(ws, selectEnt, opts) {
    E.diveCount += 1; // 观测面（D8：容器级重绑「单次 dive」防回归断言）
    E.focusWs = ws; E.diveSel = selectEnt || null;
    /* 预选 kind 随实体一并保存（归属推导）：落地位点据此组装 `{kind, ws, data}`。 */
    E.diveSelKind = selectEnt ? kindOfEntity(ws, selectEnt) : null;
    setSelection(null);
    /* 记住钻取前位置：WASD 平移后 Esc 飞回原处而非硬编码原点（会把视野甩走）。
       缩放触发的 dive（fromSafe，add-cosmos-zoom-focus-nav 2.5/D2）：快照 dist 拉出
       进入触发带（≥ 参考视距 ÷ 进入阈值 × 1.15），飞回落点天然不满足再进入条件，
       从结构上杜绝「深放 → dive → Esc → 立即又 dive」振荡；target/yaw/pitch 保持。
       chip/拾取路径不传 opts → 零影响。 */
    const fromDist = opts?.fromSafe === true
      ? Math.max(E.cam.dist, (DIVE_REF / (E.tuning.diveRatio / 100)) * DIVE_SAFE_MARGIN)
      : E.cam.dist;
    E.diveFrom = {
      target: E.cam.target.slice(), yaw: E.cam.yaw, pitch: E.cam.pitch, dist: fromDist
    };
    E.viewSwitchAt = performance.now(); // 切换触发锚点（缩放/Esc/chip 同口径）
    tweenTo({ target: centerTargetOf(ws), yaw: E.cam.yaw, pitch: 0.35, dist: 155, mix: 1 }, 1300, 'in');
    notifyDrill(); // 钻取态立即生效（面板过滤/让位不用等镜头补间收尾）
  }
  function flyOut() {
    if (E.focusMix <= 0 && !E.focusWs) { setSelection(null); return; }
    E.diveSel = null;
    E.diveSelKind = null;
    /* 离开系统视图即清选中——否则被选恒星的信息卡/名牌随 selected 残留并钉在
       银河视图（卡片底色与夜空近乎同色，只剩标题可见，呈「拖拽残影」）。 */
    setSelection(null);
    /* 完整镜头回放（target/yaw/pitch/dist 全恢复）——平移/旋转/缩放后 Esc 不再
       被拽回出厂视角。 */
    const home = E.diveFrom ?? { target: [0, 0, 0], yaw: E.cam.yaw, pitch: 0.5, dist: 430 };
    E.viewSwitchAt = performance.now(); // 切换触发锚点（同 dive）
    tweenTo({ target: home.target, yaw: home.yaw, pitch: home.pitch, dist: home.dist, mix: 0 }, 1200, 'out');
  }

  /** 恒星级重对焦（add-cosmos-selection-linkage D2/D8/D9）：短补间把相机 target 对准
      恒星的**确定性落位**（`centerTargetOf(ws) + star.off`，MUST NOT 取星座集合滑移/
      过滤位移补间的途中中点）；距离收敛 `min(当前距离, STAR_FOCUS_DIST)`、yaw/pitch
      保持不变；**显式携带 `mix: 1`**——钻取态补间同时驱动 focusMix（stepTween 插值
      from.mix→to.mix），同星座在途覆盖 dive 补间时缺省 `to.mix` 会把 focusMix 冻结在
      起值（半褪态）或得 NaN。用户拖拽/WASD/滚轮经既有 cancelTween 接管取消。 */
  function refocusStar(ws, star) {
    const center = centerTargetOf(ws);
    const off = Array.isArray(star?.off) ? star.off : [0, 0, 0];
    tweenTo({
      target: [center[0] + off[0], center[1] + off[1], center[2] + off[2]],
      yaw: E.cam.yaw,
      pitch: E.cam.pitch,
      dist: Math.min(E.cam.dist, STAR_FOCUS_DIST),
      mix: 1
    }, STAR_FOCUS_DUR, null);
  }

  /** 天体级重对焦（add-cosmos-session-list-panel 3.1 / spec「选中联动与打开链路」）：参数
      纪律逐项复用 `refocusStar`（显式 `mix: 1`、距离收敛 `min(当前, STAR_FOCUS_DIST)`、
      yaw/pitch 保持），落点 = **天体当前世界坐标**（`body.wp`：行星轨道方程 / 彗星游荡
      方程的渲染期坐标）——MUST NOT 用星座中心替代（行星在轨道上、彗星在游荡，中心是空处）。
      `wp` 由 updateScene 逐帧写入，buildScene 亦给初值 → 首帧前点击也有确定落点；
      缺失/非法（理论竞态）→ false，不改镜头（调用方仍可选中，仅不重对焦）。 */
  function refocusBody(body) {
    const wp = Array.isArray(body?.wp) ? body.wp : null;
    if (!wp || wp.length < 3) return false;
    const x = Number(wp[0]), y = Number(wp[1]), z = Number(wp[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
    tweenTo({
      target: [x, y, z],
      yaw: E.cam.yaw,
      pitch: E.cam.pitch,
      dist: Math.min(E.cam.dist, STAR_FOCUS_DIST),
      mix: 1
    }, STAR_FOCUS_DUR, null);
    return true;
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
       右下常驻「回到银河」按钮（触屏）两条等价路径承担；顶部中央位置改由钻取态星座标牌
       `.cos-badge` 占用（D4；polish-cosmos-drilled-hud 起自左上移居于此）。标牌与按钮
       均在此建一次，MUST NOT 逐帧重建（吞 click）。 */
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
      /* 信息卡按钮分流（add-cosmos-session-archive-action D4；cosmos-session-decide D6）：
         - `data-action="open"` → 既有 onOpenSession（行为零变化：先关整页再导航）；
         - `data-action="decide"` → onDecideSession（与打开同链路，决策面由 DSH 原生呈现）；
         - `data-action="archive"` → onArchiveSession（新回调，整页保持打开）；
         - `data-action` 缺席 → 回落 open（旧渲染/外部注入 markup 兼容）。
         归档防重入（D6）：权威门 = E.archiveInFlight（per-session）——重复点击直接忽略；
         禁用态经直接 DOM 切换（cardHtml 不渲染 disabled，见上方 CSS 注释），响应到达
         （无论 outcome）后恢复。回调同步抛错也解锁，不让一次失败永久卡死按钮。
         门禁口径：归档在途 MUST NOT 拦截决策点击（打开类动作同口径），decide 无自身在途门
         （导航动词幂等，D6）。回调未注入 → 静默 no-op（同 onOpenSession 守卫）。 */
      const target = ev.target;
      if (!target || !target.classList || !target.classList.contains('cd-btn')) return;
      const sessionId = target.getAttribute('data-session');
      if (!sessionId) return;
      const action = target.getAttribute('data-action') || 'open';
      if (action === 'decide') {
        if (E.onDecideSession) E.onDecideSession(sessionId);
        return;
      }
      if (action !== 'archive') {
        if (E.onOpenSession) E.onOpenSession(sessionId);
        return;
      }
      if (!E.onArchiveSession) return;
      if (E.archiveInFlight.has(sessionId)) return; // 在途门：MUST NOT 派发第二个请求
      E.archiveInFlight.add(sessionId);
      setArchiveButtonDisabled(true);
      const done = function () {
        E.archiveInFlight.delete(sessionId);
        if (E.disposed) return;
        setArchiveButtonDisabled(false);
      };
      let pending;
      try {
        pending = E.onArchiveSession(sessionId);
      } catch (error) {
        if (typeof console !== 'undefined' && typeof console.warn === 'function') {
          console.warn('[dsh-v-cosmos] archive session failed:', error);
        }
        done();
        return;
      }
      if (pending && typeof pending.then === 'function') pending.then(done, done);
      else done();
    });
  }

  /** 归档按钮在途禁用态（add-cosmos-session-archive-action D6）：直接切换卡片内目标
      按钮的 `disabled` 属性（不经 cardHtml 重渲染——sig 不变不重建，也不应为一颗按钮
      改动 sig）。卡片在途重渲染抹掉该属性时权威门（E.archiveInFlight）仍生效；按钮
      不在卡内（渲染成恒星卡 / 卡片已收）→ 静默跳过（呈现层尽力而为）。 */
  function setArchiveButtonDisabled(disabled) {
    const card = E.el.card;
    if (!card || typeof card.querySelector !== 'function') return;
    const button = card.querySelector('.cd-btn[data-action="archive"]');
    if (button) button.disabled = disabled === true;
  }

  /** 空星座判定（D6：「空」= 恒星/行星/彗星均为空且无归档星云）。出生高亮只对空星座
      生效——含内容星座走既有凝聚/游入转场，MUST NOT 被 chip 高亮替代或叠加（spec）。 */
  function isEmptyConstellation(ws) {
    return (ws?.stars?.length ?? 0) === 0
      && (ws?.planets?.length ?? 0) === 0
      && (ws?.comets?.length ?? 0) === 0
      && !(ws?.archives > 0);
  }

  /** 覆盖层 chip/slab 随场景结构增量对齐（按 id 复用既有 DOM）。
      此前每次 rebuild 先 remove 全部再重建：即便结构没变，所有星座/提案标签也会
      消失并重新淡入（chip 有 .25s transition），是「画面偶尔闪动」的直接可见源。
      增量路径只增删差异项，并把 `cos-chip-new` 出生高亮就地切换（不打断 CSS 动画）。 */
  function rebuildOverlayDom() {
    const liveChips = new Set();
    const liveSlabs = new Set();
    E.scene.ws.forEach(function (ws) {
      const birthT0 = E.wsBirth.get(ws.id);
      const fresh = birthT0 != null && E.t - birthT0 < WS_BIRTH_HL_DUR && isEmptyConstellation(ws);
      if (birthT0 != null && !fresh) E.wsBirth.delete(ws.id); // 过期或非空星座 → 摘除（有内容走凝聚）
      let chip = E.chips[ws.id];
      if (!chip) {
        /* 点击时按 id 回查当前场景对象：DOM 复用后闭包不能持有旧 ws 引用
           （结构重建会替换 ws/body，旧引用会让 dive 用陈旧中心和名称）。 */
        const wsId = ws.id;
        chip = document.createElement('div');
        chip.addEventListener('click', function () {
          /* 手势抑制（D2）：多指手势期间/刚结束（GESTURE_SUPPRESS_MS 内）的 click
             MUST NOT 触发 dive——双指起手落在 chip 上完成捏合会派生 click。 */
          if (gestureSuppressed()) return;
          const target = E.scene.ws.find(function (w) { return w.id === wsId; });
          if (target) dive(target, null);
        });
        E.el.overlay.appendChild(chip);
        E.chips[ws.id] = chip;
      }
      const chipClass = fresh ? 'cos-chip cos-chip-new' : 'cos-chip';
      if (chip.className !== chipClass) chip.className = chipClass;
      liveChips.add(ws.id);
      ws.stars.forEach(function (s) {
        let slab = E.slabs[s.id];
        if (!slab) {
          slab = document.createElement('div');
          slab.className = 'cos-slab';
          slab.dataset.star = s.id; // 观测/测试钩子（呈现内容由 updateOverlay 单点维护）
          E.el.overlay.appendChild(slab);
          E.slabs[s.id] = slab;
        }
        /* 内容（名称 + 活力态标识）由 updateOverlay 的 `dataset.html` 差分守卫单点维护
           （cosmos-relation-focus D4）；此处 MUST NOT 写 textContent——会清掉标识节点。 */
        liveSlabs.add(s.id);
      });
    });
    Object.keys(E.chips).forEach(function (id) {
      if (liveChips.has(id)) return;
      E.chips[id].remove();
      delete E.chips[id];
    });
    Object.keys(E.slabs).forEach(function (id) {
      if (liveSlabs.has(id)) return;
      E.slabs[id].remove();
      delete E.slabs[id];
    });
    updateChipText();
  }

  /** chip 文本（patch 路径下就地更新，不重建 DOM）：银河态只显示星座名——计数仪表
      迁移至钻取态顶部中央标牌（D4/3.3）。沿用 `dataset.html` 内容差分守卫：名字几乎恒定，
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

  /** 决策按钮文案（cosmos-session-decide D5）：决策专用映射（键域与 PLAN_KIND_LABEL
      一致、值语义不同——那是状态行括注文案「审批/方案审查/提问」，这里是按钮动作文案
      「待批准/计划待审/待回答」）；未知 kind 回退「待决策」。 */
  function decideLabelOf(pendingKind) {
    return E.labels.decide[pendingKind] || E.labels.decide.fallback;
  }

  /** 行星决策按钮（D5）：仅行星 waiting 时注入「打开会话」与「归档会话」之间：
      `data-action="decide"` + `data-session` 稳定钩子并存、琥珀 warning 色（.cd-btn-decide）。
      彗星 MUST NOT 注入（v1 行星限定）；非待决策/实体残缺 → 空串（按钮行回落两颗）。
      出现/消失由 sig（state|pendingKind）翻转驱动，MUST NOT 逐帧重建按钮 DOM。 */
  function decideButtonHtml(kind, ent) {
    if (kind !== 'planet' || !ent || ent.state !== 'waiting') return '';
    const id = escapeHtml(ent.id);
    return '<button class="cd-btn cd-btn-decide" type="button" data-action="decide" data-session="' + id + '">' +
      escapeHtml(decideLabelOf(ent.pendingKind)) + '</button>';
  }

  /** 会话卡按钮组（add-cosmos-session-archive-action 2.1 / D4；cosmos-session-decide D5
      / cosmos-session-archive delta 重钉顺序）：行星与彗星信息卡「打开会话」与「归档会话」
      并列，行星待决策时在两者之间插入决策按钮（`lead`，空串 = 两颗）。按钮共用 `.cd-btn`
      一类（同排布区、8px 间距、≥40px 触屏目标）；`data-action` 为程序化分流钩子，
      `data-session` 沿用既有会话 id 钩子——「打开会话」行为零变化（spec「打开会话行为
      不变」）。卫星无信息卡 ⇒ 无入口。MUST NOT 在此渲染 `disabled`：禁用态是点击处理器
      的直接 DOM 职责（D6）。「打开会话」按钮标注空格快捷键
      （add-cosmos-session-open-hotkey 2.1/D4）：`aria-keyshortcuts` + title 为静态 markup
      属性增量（行为不变；归档按钮无快捷键 ⇒ 不标注），sig 差分守卫据此仍按同串比较、
      无逐帧重建问题。 */
  function cardActionsHtml(sessionId, lead) {
    const id = escapeHtml(sessionId);
    return '<div class="cd-actions">' +
      '<button class="cd-btn" type="button" data-action="open" data-session="' + id + '" aria-keyshortcuts="Space" title="打开会话（空格）">打开会话</button>' +
      (lead || '') +
      '<button class="cd-btn" type="button" data-action="archive" data-session="' + id + '">归档会话</button>' +
      '</div>';
  }

  function cardHtml(e) {
    if (e.kind === 'star') {
      const s = e.data;
      const stamp = (s.setBy || s.at)
        ? '<span>落章</span><b>' + escapeHtml(s.setBy || '—') + (s.at ? ' · ' + escapeHtml(relativeTime(s.at)) : '') + '</b>'
        : '';
      /* 活力状态行（dsh-cosmos delta「恒星亮度编码活跃度」/ design D4）：口径沿用 act 现行
         定义——活跃 = act≥1（busy ∨ waiting ∨ 委托忙碌）、沉睡 = act=0；行标「活力」区别于
         生命周期「状态」行（同标不可区分）；星胚（proto）豁免不呈现（无行星语义，避免误导）。 */
      const vitalityRow = s.lifecycle === 'proto' ? '' :
        '<span>' + escapeHtml(E.labels.vitality.label) + '</span><b>' +
        escapeHtml((s.act || 0) > 0 ? E.labels.vitality.active : E.labels.vitality.sleep) + '</b>';
      return '<div class="cd-title">✦ ' + escapeHtml(s.name) + '</div>' +
        '<div class="cd-grid">' +
        '<span>状态</span><b>' + (LIFECYCLE_LABEL[s.lifecycle] || s.lifecycle) + '</b>' +
        vitalityRow +
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
        '</div>' + cardActionsHtml(p.id, decideButtonHtml('planet', p));
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
        '</div>' + cardActionsHtml(c.id);
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

    // 顶部中央星座标牌（D4/3.1–3.2；polish-cosmos-drilled-hud 自左上移居）：
    // 钻取态显示「星座名 + 全量计数仪表」（水平居中 + 文本居中）。沿用旧 crumb 的
    // 内容差分守卫（dataset.html 模式同信息卡 data-sig）：每帧
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
      if (!ws || !ws.vis || E.focusMix > 0.55 || !ws.proj) {
        el.classList.remove('on');
        /* 清内联透明度：显示期写入的 style.opacity 优先级高于 .cos-chip{opacity:0}，
           只删 .on 会让标签永久停在最后一次可见状态（真机「文字残影」根因）。 */
        if (el.style.opacity !== '') el.style.opacity = '';
        return;
      }
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
      if (!info || !scr || !ownerWs || !(inSystem || focused)) {
        slab.classList.remove('on');
        /* 同 chip：清内联 opacity，否则名牌冻结在最后位置、永不消失。 */
        if (slab.style.opacity !== '') slab.style.opacity = '';
        return;
      }
      /* 名称随 patch 更新（重命名不重建场景）；活力状态标识随之（dsh-cosmos delta D4：
         钻取态恒星名牌 MUST 附加活力态标识，琥珀点=活跃 / 灰点=沉睡；星胚不呈现）；
         内容差分守卫沿用 `dataset.html` 模式，act 翻转即时刷新、不变零重写。 */
      const liveness = info.lifecycle === 'proto'
        ? null
        : ((info.act || 0) > 0 ? 'active' : 'sleep');
      const slabHtml = '<b>' + escapeHtml(info.name) + '</b>' + (liveness
        ? '<span class="cos-slab-life ' + liveness + '"><i></i>' + escapeHtml(liveness === 'active' ? E.labels.vitality.active : E.labels.vitality.sleep) + '</span>'
        : '');
      if (slab.dataset.html !== slabHtml) {
        slab.innerHTML = slabHtml;
        slab.dataset.html = slabHtml;
      }
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
       change 的彗星状态行特性直接相关）；签名不变零重写。
       恒星分支追加 act（cosmos-relation-focus D4 修正）：恒星实体无 state/pendingKind
       字段，仅凭既有签名 act 翻转不会触发重渲染 → 活力状态行滞留旧态；行星/彗星分支
       sig 不变（其 waiting 翻转已由 state|pendingKind 覆盖）。 */
    let sig = key2 + '|' + (ent.data?.state ?? '') + '|' + (ent.data?.pendingKind ?? '');
    if (ent.kind === 'star') sig += '|act:' + (ent.data?.act || 0);
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
   *  - **触屏手势三自由度**（add-cosmos-three-finger-pan）：1 指拖拽旋转 / 2 指捏合缩放 /
   *    3+ 指按住平移；第三指落下即接管平移（`E.pan3`），收指转换矩阵见统一收指 helper
   *    `endGesturePointer`（2→3 / 3→2 / 3→1 / 3→0 全路径重锚，无跳变）；
   *  - **目标过滤与捕获策略**（指针重绑新增暗礁）：起指目标为覆盖交互元素（非 canvas）
   *    MUST NOT `setPointerCapture`（捕获会把 pointerup 及派生 click 重定向到 root，
   *    chip 的 dive 永不派发），pointerup 亦 MUST NOT 执行容器级 pickAt 拾取（否则与
   *    chip click 叠加成二次 dive）。指针仍进 Map 参与多指追踪，拖拽旋转照常；
   *  - canvas 起指维持既有捕获 + pointerup 拾取语义（拖拽越界不丢事件、空白处清选中）；
   *  - pointerdown 的 preventDefault 保留：Pointer Events 规范中 click 不属兼容鼠标事件，
   *    不会被其抑制，不影响上述 click 派发。
   *  - 触控板边界：3 指在触控板是 OS 级手势，浏览器不派发第三个 pointerdown → 本手势
   *    天然触屏专属；引擎 MUST NOT 模拟合成三指事件。
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
    /** 双指中点（canvas 相对坐标；add-cosmos-zoom-focus-nav 2.3 指针聚焦焦点）。 */
    function pinchMidpoint() {
      if (E.pointers.size < 2) return { x: NaN, y: NaN };
      const it = E.pointers.values();
      const a = it.next().value, b = it.next().value;
      const rect = canvas.getBoundingClientRect();
      return {
        x: (a.x + b.x) / 2 - rect.left,
        y: (a.y + b.y) / 2 - rect.top
      };
    }
    /** 多指质心（client 坐标；三指平移基准与增量，D3）。 */
    function centroidOfPointers() {
      let x = 0, y = 0, n = 0;
      for (const p of E.pointers.values()) { x += p.x; y += p.y; n += 1; }
      return n > 0 ? { x: x / n, y: y / n } : { x: NaN, y: NaN };
    }
    /** 第二指落下瞬间切 pinch：记基准指距 d0 与基准 dist0，清拖拽累积。 */
    function beginPinch() {
      const d0 = pinchDist();
      if (!(d0 > 0)) return;
      E.pinch = { d0: d0, dist0: E.cam.dist };
      E.gesture = true;
      E.dragging = false; // 捏合起手 MUST NOT 残留拖拽累积（否则收尾误判 wasDrag）
      E.pinchCarry = true; // 本序列曾捏合：3→2 重锚后仍可补判；3→1/3→0 切平移收束不丢判定
    }
    /** 第三指落下进入三指平移（D3）：清捏合/拖拽累积、以多指质心为起点、接管补间；
        第四指及以上再落指只重锚质心起点（无语义切换、无基准跳变）。 */
    function enterPan3() {
      const center = centroidOfPointers();
      if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) return;
      if (E.pan3) {
        E.pan3.sx = center.x;
        E.pan3.sy = center.y;
        return;
      }
      const fromPinch = E.pinch != null;
      E.pan3 = {
        sx: center.x, sy: center.y,
        movedX: 0, movedY: 0,
        pinchCarry: fromPinch || E.pinchCarry === true
      };
      if (E.pan3.pinchCarry) E.pinchCarry = true;
      E.gesture = true;
      E.pinch = null; // 切平移：捏合基准作废（3→2 时以余下两指间距重锚）
      E.dragging = false; // 清单指拖拽累积，防收尾 wasDrag 误判
      cancelTween(); // 平移接管即打断 dive/飞回/取景补间（与拖拽/WASD/滚轮同语义）
    }
    /** 统一收指 helper（pointerup / pointercancel / pointerleave 幽灵清理共用，防两处
        转换矩阵漂移）：按剩余指针数走状态机——
        3+→3+ 仍平移（质心成员变化即重锚起点）；→2 以余下两指当前间距重锚捏合基准；
        →1 剩指重置为单指旋转起点，本序列曾捏合时以最终 dist 补判一次阈值切换；
        →0 清态 + 既有 GESTURE_SUPPRESS_MS 抑制窗。 */
    function endGesturePointer(ev) {
      const wasPinch = E.pinch != null;
      const wasPan3 = E.pan3 != null;
      /* 收束补判链：pinch 在场 ∨ 本序列曾捏合（pan3.pinchCarry / 序列级 pinchCarry）——
        否则「捏合越过阈值 → 落第三指切平移 → 直接收束」会静默丢失自动 dive/flyOut。 */
      const carriesPinch = E.pinchCarry === true || (wasPan3 && E.pan3.pinchCarry === true);
      E.pointers.delete(ev.pointerId);
      if (E.pointers.size >= 3) {
        /* 4+→3：仍按平移处理，质心成员数变化 → 重锚起点（无基准跳变）。 */
        if (E.pan3) {
          const center = centroidOfPointers();
          E.pan3.sx = center.x;
          E.pan3.sy = center.y;
        } else {
          enterPan3(); // 理论竞态兜底：多指在场但 pan3 缺席 → 按进入语义补建
        }
        return;
      }
      if (E.pointers.size === 2) {
        /* 3→2：平移终止，以余下两指当前间距重锚捏合基准（缩放连续无跳变）。 */
        E.pan3 = null;
        E.pinch = null;
        E.dragging = false;
        beginPinch();
        return;
      }
      if (E.pointers.size === 1) {
        /* 3→1 / 2→1：剩指重置为单指旋转起点（否则被 wasDrag 判定吞掉拾取或误续接旋转）。 */
        E.pan3 = null;
        E.pinch = null; // 任意一指抬起结束 pinch（剩指回到单指旋转语义）
        E.dragging = false;
        const rest = E.pointers.values().next().value;
        sx = rest.x; sy = rest.y;
        if (wasPinch || carriesPinch) judgeZoomSwitchAtPinchEnd();
        E.pinchCarry = false; // 序列已离开多指语义，后续单指不重复补判
        return;
      }
      /* 3→0 / 2→0 / 1→0：全部抬起，清态 + 抑制窗。 */
      E.gesture = false;
      E.pinch = null;
      E.pan3 = null;
      E.dragging = false; // 收尾清拖拽累积（否则 hover 恢复被 wasDrag 残留挡住）
      E.gestureEndAt = performance.now();
      if (wasPinch || carriesPinch) judgeZoomSwitchAtPinchEnd();
      E.pinchCarry = false;
    }

    root.addEventListener('pointerdown', function (ev) {
      /* 仅主键（左键/触摸/笔尖）参与导航与拾取：右键的 pointerup 若走拾取会
         在弹出原生菜单的同时误触发 dive/选中，右键语义整体留给 contextmenu 屏蔽。 */
      if (ev.button !== 0) return;
      ev.preventDefault(); // 拖拽起点不触发文本选取/原生拖拽（CSS user-select 兜底）
      E.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (!onOverlayTarget(ev) && typeof canvas.setPointerCapture === 'function') {
        canvas.setPointerCapture(ev.pointerId);
        captured.add(ev.pointerId);
      }
      if (E.pointers.size >= 3) { enterPan3(); return; }
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
      /* 三指平移（D3）：第三指落下即接管；按多指质心增量平移 target，增量式重置
         质心起点（防漂移）；`E.pan3` 在场时下方捏合重锚守卫 MUST NOT 抢回捏合。 */
      if (E.pointers.size >= 3 && E.pan3) {
        const center = centroidOfPointers();
        const dx = center.x - E.pan3.sx;
        const dy = center.y - E.pan3.sy;
        E.pan3.sx = center.x;
        E.pan3.sy = center.y;
        if (dx !== 0 || dy !== 0) {
          E.pan3.movedX += dx;
          E.pan3.movedY += dy;
          if (panCameraTargetByDrag(E.cam, dx, dy, E.cam.dist, E.tuning)) cancelTween();
        }
        return;
      }
      /* 多指仍按着但 pinch 基准已失效（三指中落一指等）→ 以当前指距重锚基准。
         pan3 在场时跳过：平移期间不重建捏合基准（首个 move 红线）。 */
      if (E.pointers.size >= 2 && !E.pinch && E.gesture && !E.pan3) beginPinch();
      /* 捏合缩放（D2）：cam.dist = clamp(dist0 * d0/d)，张开 = 放大，与滚轮同值域；
         捏合接管即取消补间（与拖拽/WASD/滚轮同语义）。指针聚焦（add-cosmos-zoom-focus-nav
         2.3/D3）：以双指中点为焦点，同一收敛式（先按旧 dist 求 target，再落新 dist——
         端点 clamp 后 target 不移动）。 */
      if (E.pointers.size >= 2 && E.pinch) {
        const d = pinchDist();
        if (d > 0) {
          const before = E.cam.dist;
          const next = clamp(E.pinch.dist0 * (E.pinch.d0 / d), DIST_MIN, DIST_MAX);
          cancelTween();
          if (next !== before) {
            const mid = pinchMidpoint();
            applyZoomFocus(mid.x, mid.y, next);
            E.cam.dist = next;
          }
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
      /* 非主键抬指 MUST NOT 拾取（右键在 canvas 上原本会触发一次 dive）；
         仍清追踪状态：pointerup 只在最后一个按键抬起时派发，不应遗留幽灵指针
         （遗留会让下一次单指按落被误判为双指捏合）。 */
      if (ev.button !== 0) {
        captured.delete(ev.pointerId);
        E.pointers.delete(ev.pointerId);
        if (E.pointers.size === 0) E.dragging = false;
        return;
      }
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
      if (!hit) { setSelection(null); return; }
      if (E.focusMix > 0.5) {
        /* 钻取态拾取（add-cosmos-selection-linkage D9）：恒星顺带以同款短补间重对焦
           （与面板同星座路径同一机械/参数）；行星/彗星只选中不动镜头。 */
        setSelection(hit);
        if (hit.kind === 'star') refocusStar(hit.ws, hit.data);
      } else dive(hit.ws, hit.data);
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
         有 pointer capture 的指针仍会收到 pointerup，保留追踪。
         多指手势态走统一收指 helper（D3）：幽灵清理同样覆盖 pan3/pinch 全转换矩阵；
         单指非手势态保持既有「仅清追踪」语义（不新开抑制窗）。 */
      for (const id of [...E.pointers.keys()]) {
        if (captured.has(id)) continue;
        if (E.gesture) endGesturePointer({ pointerId: id });
        else E.pointers.delete(id);
      }
      if (E.pointers.size === 0) {
        E.dragging = false;
        /* 理论竞态兜底：幽灵清理走完仍无指针 → 清手势态并补判一次。 */
        if (E.gesture) {
          E.gesture = false; E.pinch = null; E.pan3 = null;
          E.gestureEndAt = performance.now();
        }
        if (E.pinchCarry) { judgeZoomSwitchAtPinchEnd(); E.pinchCarry = false; }
        return;
      }
      if (E.pinch && E.pointers.size < 2) {
        /* 捕获指针残留 + 捏合基准（幽灵指针清理未覆盖的竞态）→ 同口径收束。 */
        E.pinch = null;
        E.pan3 = null;
        E.dragging = false;
        if (E.pointers.size === 1) {
          const rest = E.pointers.values().next().value;
          sx = rest.x; sy = rest.y;
        }
        judgeZoomSwitchAtPinchEnd(); // 捏合序列收束（剩指回到单指语义）→ 补判一次
        E.pinchCarry = false;
      }
    });
    root.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      /* 滚轮事件坐标 → canvas 相对（与 pointermove 同 rect 口径；换算走模块级纯函数
         `canvasPointOf`，与公共面 `zoomBy` 单源共用）；缺坐标（合成事件/旧测试桩）
         → null，聚焦回落屏心。 */
      const point = canvasPointOf(ev.clientX, ev.clientY, canvas.getBoundingClientRect());
      applyWheelZoom(ev.deltaY, point);
    }, { passive: false });
    /* 星图区域屏蔽浏览器原生右键菜单（画布/chip/信息卡/回到银河按钮均经容器冒泡）。
       页面层（client.jsx）对动作条等非文本 chrome 兜底，同时保留搜索框/提案面板
       等可选中文本区域的原生菜单（复制/粘贴）。 */
    root.addEventListener('contextmenu', function (ev) {
      ev.preventDefault();
    });
  }

  /* ---------- 缩放阈值导航（add-cosmos-zoom-focus-nav D2/D3） ---------- */

  /** 切换判定守卫聚合（滚轮路径）：补间在途 / 拖拽 / 多指手势 / 冷却窗任一 → blocked。 */
  function zoomSwitchBlocked() {
    return E.tween != null
      || E.dragging === true
      || E.gesture === true
      || (performance.now() - E.viewSwitchAt) < SWITCH_COOLDOWN_MS;
  }

  /** 冷却窗守卫（捏合收束路径：此时补间已让位于捏合输入，仅冷却窗约束）。 */
  function zoomSwitchCooling() {
    return (performance.now() - E.viewSwitchAt) < SWITCH_COOLDOWN_MS;
  }

  /** 银河态最近可钻取星座：ws.vis × ws.proj 屏心距离最小者（proj null 跳过；含空星座）。
      vz 取当前镜头对星座中心的实时视距（`ws.proj` 仅用于屏心距离与可见性口径）。 */
  function nearestGalaxyTarget() {
    const W = E.W, H = E.H;
    if (!(W > 0) || !(H > 0)) return null;
    const cx = W / 2, cy = H / 2;
    let best = null, bestD = Infinity;
    for (const ws of E.scene?.ws ?? []) {
      if (ws.vis !== true || !ws.proj) continue;
      const d = Math.hypot(ws.proj.x - cx, ws.proj.y - cy);
      if (d < bestD) { bestD = d; best = ws; }
    }
    if (!best) return null;
    return { ws: best, centerDistPx: bestD, vz: zOf(E.cam, wsCenter(best, E.t)) };
  }

  /**
   * 缩放输入后的阈值判定（滚轮逐次 / 捏合收束）：内联调用 `zoomSwitchVerdict`；
   * 命中进入 → 复用既有 `dive(ws, null, { fromSafe: true })`（与 chip 同一镜头语言）；
   * 命中返回 → 复用既有 `flyOut()`（Esc 等效路径）。判定源无关的冷却锚点在
   * `dive()` / `flyOut()` 与切换补间收尾双写。
   * @param {boolean} blocked 调用方聚合的守卫（见 zoomSwitchBlocked）
   * @returns {boolean} 是否发生切换
   */
  function judgeZoomSwitch(blocked) {
    if (E.disposed || !E.scene) return false;
    const minVp = Math.min(E.W, E.H);
    if (!(minVp > 0)) return false;
    const params = { diveRatio: E.tuning.diveRatio, flyOutRatio: E.tuning.flyOutRatio };
    if (E.focusWs) {
      const f = (E.H * 1.1) / (2 * Math.tan(E.cam.fov * Math.PI / 360));
      const boundR = Number(E.focusWs.boundR) > 0
        ? E.focusWs.boundR
        : 12 + (Number(E.focusWs.archives) || 0) * 2.4;
      const verdict = zoomSwitchVerdict({
        mode: "drilled", blocked, minViewportPx: minVp,
        dist: E.cam.dist, boundR, f
      }, params);
      if (verdict.flyOut) { flyOut(); return true; }
      return false;
    }
    const nearest = nearestGalaxyTarget();
    if (!nearest) return false;
    const verdict = zoomSwitchVerdict({
      mode: "galaxy", blocked, minViewportPx: minVp,
      vz: nearest.vz, centerDistPx: nearest.centerDistPx
    }, params);
    if (verdict.dive) { dive(nearest.ws, null, { fromSafe: true }); return true; }
    return false;
  }

  /** 捏合序列收束补判（手势进行中不判定；收束以最终 dist 判一次，仅冷却窗守卫）。 */
  function judgeZoomSwitchAtPinchEnd() {
    if (E.disposed || !E.scene) return;
    judgeZoomSwitch(zoomSwitchCooling());
  }

  /**
   * 指针聚焦步进（2.2/2.3）：以当前 cam.dist 为 d0、`newDist` 为 d1 求新 target 并落位。
   * MUST 在写 `E.cam.dist` 之前调用（d0 口径）；开关关闭 / 坐标非法 / 端点冻结 → no-op。
   * @returns {boolean} 是否移动了 target
   */
  function applyZoomFocus(px, py, newDist) {
    if (E.tuning.pointerFocus !== true) return false;
    if (!Number.isFinite(px) || !Number.isFinite(py)) return false;
    const next = zoomFocusTargetOf(E.cam, px, py, E.W, E.H, newDist);
    if (next[0] === E.cam.target[0] && next[1] === E.cam.target[1] && next[2] === E.cam.target[2]) {
      return false;
    }
    E.cam.target = next;
    return true;
  }

  /**
   * 滚轮缩放唯一实现（add-cosmos-proposal-actions 3.6：动作条为 `cos-page` 兄弟层，
   * 其 wheel 事件不进引擎容器 → 经公共面 `zoomBy` 转发复用同一段语义）。
   * 滚轮接管即取消补间（add-cosmos-search-filter 2.5）：否则补间期间滚轮输入会被
   * stepTween 逐帧覆写（相机缩放被抢走）。
   * 值域 [24, 4200]：近可贴到恒星表面（dive 视距 155 的一半以下），远可容纳整个星系。
   * 缩放阈值导航（add-cosmos-zoom-focus-nav 2.2/2.4）：滚轮逐次判定；`point` 为滚轮
   * 事件 canvas 相对坐标（指针聚焦焦点）；`opts.judge === false` 时只缩放不判定（动作条
   * `zoomBy` 公共面——spec 口径：公共面缩放恒不参与阈值导航判定，聚焦仍生效）。
   * @param {number} deltaY 原生 wheel 的 deltaY
   * @param {{x: number, y: number}|null} [point] canvas 相对指针坐标
   * @param {{judge?: boolean}} [opts]
   * @returns {boolean} 是否消费（非有限数/0 → false）
   */
  function applyWheelZoom(deltaY, point, opts) {
    const dy = Number(deltaY);
    if (!Number.isFinite(dy) || dy === 0) return false;
    const judge = opts?.judge !== false;
    /* 守卫在 cancelTween 之前聚合：本步滚轮虽然接管了补间，但「到这一步为止补间仍在途」
       的语义要求本步不判定（用户接管优先；下一次滚轮恢复判定）。 */
    const blocked = zoomSwitchBlocked();
    const before = E.cam.dist;
    cancelTween();
    const next = clamp(before * (1 + dy * 0.0012), DIST_MIN, DIST_MAX);
    if (next !== before) {
      applyZoomFocus(point?.x, point?.y, next);
      E.cam.dist = next;
      if (judge) judgeZoomSwitch(blocked);
    }
    return true;
  }

  /* ---------- 键盘层：WASD 平移 + 会话打开快捷键（window 级；随引擎 dispose 卸载） ---------- */

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
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return; // 组合键（Ctrl+W / Ctrl+Space 等）不劫持
      const key = panKeyOf(ev);
      if (key) {
        if (ev.isComposing || isEditableTarget(document.activeElement) || isUiChromeTarget(document.activeElement)) return;
        E.panKeys.add(key);
        ev.preventDefault(); // 吞掉宿主同键默认行为（快速查找等）
        return;
      }
      /* 会话打开快捷键（add-cosmos-session-open-hotkey D1，同一 handler 分支——零新增
         监听面/泄漏面）：空格对**当前选中**的行星/彗星触发与信息卡「打开会话」按钮
         同一回调链（`E.onOpenSession` —— 先关整页再导航，语义零分叉）。守卫按序早退，
         取点与 WASD 层同源（一律 `document.activeElement`，不用 `ev.target`）：
         ① `repeat` 忽略（按住不连发开页级动作）；
         ② `isComposing` 跳过（输入法组合中）；
         ③ 可编辑聚焦跳过（搜索框/提案面板输入/星座浮窗文本域——空格是字符）；
         ④ 面板/动作条 chrome 聚焦跳过（WASD 层「面板内不劫持」同款纪律）；
         ⑤ 按钮类聚焦跳过（空格是原生激活，MUST NOT 双触发）；
         ⑥ 选中非会话（恒星 = 提案 / 无选中）静默 no-op（不弹提示，HUD 极简口径）。
         六道全过才 `preventDefault`（抑制宿主页面滚动）+ 触发。 */
      if (String(ev.code ?? "") !== SESSION_OPEN_KEY) return;
      if (ev.repeat === true) return;
      if (ev.isComposing) return;
      const active = document.activeElement;
      if (isEditableTarget(active)) return;
      if (isUiChromeTarget(active)) return;
      if (isButtonLikeTarget(active)) return;
      const sel = E.selected;
      /* 白名单 `kind ∈ {planet, comet}`：选中模型无卫星 kind（`kindOfEntity` 仅
         star/planet/comet，卫星不可拾取）→ 白名单天然覆盖「卫星场景」。 */
      if (!sel || !sel.data || (sel.kind !== "planet" && sel.kind !== "comet")) return;
      ev.preventDefault();
      /* 与信息卡按钮委托同址复用（关页是客户端回调职责，不在此复制）；回调未注入 →
         静默 no-op（与按钮路径 `if (E.onOpenSession)` 守卫一致）。归档在途门
         （`E.archiveInFlight`）不拦 open——与按钮点击同口径。 */
      if (E.onOpenSession) E.onOpenSession(sel.data.id);
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
    const nextW = Math.max(1, Math.round(rect.width));
    const nextH = Math.max(1, Math.round(rect.height));
    const nextDpr = window.devicePixelRatio || 1;
    /* 尺寸/DPR 未变 → 不改写 canvas.width/height（赋值会清位图，可能被绘制到一帧空白）。
       ResizeObserver 在开页对齐/布局抖动时可能重复回调，此守卫消除无谓闪帧。 */
    if (nextW === E.W && nextH === E.H && nextDpr === E.dpr) return;
    E.W = nextW;
    E.H = nextH;
    E.dpr = nextDpr;
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
      焦点星座消失自动飞回」）。
      add-cosmos-session-archive-action 2.3 复核（design D7）：归档会话 → 官方镜像更新
      → 场景补丁移除天体时，下方「selected 按 id 重新解析」分支因实体不在列表中把
      `E.selected` 置空，`updateOverlay` 的 `!scr2` 早退同时隐藏信息卡——既有守卫已覆盖
      「选中实体被场景移除」，本 capability 无需新增收卡逻辑（行为由冒烟固化）。 */
  function remapFocusRefs() {
    if (E.focusWs) {
      const mapped = E.scene.ws.find(function (w) { return w.id === E.focusWs.id; }) ?? null;
      if (!mapped) {
        E.focusWs = null; // 先清引用再 flyOut（flyOut 以 focusWs/focusMix 判定早退）
        E.diveSel = null;
        E.diveSelKind = null;
        setSelection(null);
        notifyDrill(); // 焦点星座注销 → 面板立即退出钻取过滤
        flyOut();
        return;
      }
      E.focusWs = mapped;
    }
    /* 结构重建后星座名可能变化（重命名）：钻取态信息以最新场景为准。 */
    notifyDrill();
    if (E.selected && E.selected.ws) {
      const ws = E.scene.ws.find(function (w) { return w.id === E.selected.ws.id; });
      if (!ws) { setSelection(null); return; }
      const list = E.selected.kind === 'star' ? ws.stars : E.selected.kind === 'planet' ? ws.planets : ws.comets;
      const data = list.find(function (x) { return x.id === E.selected.data.id; });
      setSelection(data ? { kind: E.selected.kind, ws: ws, data: data } : null);
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
        const prevScene = E.scene;
        E.scene = buildScene(sceneData);
        inheritTrails(prevScene, E.scene); // 同 id 未移动天体的尾迹跨重建保留（防尾迹闪断）
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
    /**
     * 皮肤热切换（add-cosmos-skin-themes D6 / 2.2）：**仅替换呈现层皮肤实例**。
     * MUST NOT 重建场景（恒星/行星/彗星/星云实体、选中态、钻取态、过滤态、相机全部保持）；
     * 在途转场（birth/colorMix/nova/wsghost）状态存于引擎侧，与皮肤解耦，切换后按新皮肤
     * 母语继续消费同一时间线。HUD 令牌与 `data-cos-mode` 由上层 `applySkinTokens` 单点
     * 下发——引擎 MUST NOT 写 DOM 属性（避免双写漂移）。
     * @param {object} style 皮肤实例（palette/background/drawBody）
     * @returns {boolean} 是否发生替换（同实例 / 非法入参 / 已销毁 → false，不抛错）
     */
    setSkin(style) {
      if (E.disposed) return false;
      if (!style || typeof style !== "object" || typeof style.drawBody !== "function") return false;
      if (E.style === style) return false;
      E.style = style;
      E.skinGen += 1;
      return true;
    },
    /** 皮肤观测面（只读快照供冒烟直测）：当前皮肤 id / 热切换代数 / 银河带消费标记。 */
    inspectSkin() {
      return { id: E.style?.skin ?? null, gen: E.skinGen, useBand: E.style?.useBand === true };
    },
    /**
     * 相机快照（观测面：冒烟直测缩放转发/值域，无副作用）。
     * @returns {{target: number[], yaw: number, pitch: number, dist: number}}
     */
    getCamera() {
      return {
        target: E.cam.target.slice(),
        yaw: E.cam.yaw,
        pitch: E.cam.pitch,
        dist: E.cam.dist
      };
    },
    /**
     * 滚轮缩放转发（add-cosmos-proposal-actions 3.6 / spec「动作按钮条上滚轮缩放保持生效」
     * + fix-cosmos-zoom-nav-focus-deadzone「动作条上滚轮向指针聚焦」）：动作条是引擎容器外
     * 的兄弟层，其 wheel 事件不进容器级绑定，经此公共面复用同一段缩放语义（取消补间 +
     * 值域 clamp）。
     *
     * 指针聚焦（fix-cosmos-zoom-nav-focus-deadzone D1/D2）：`point` 收**原始视图坐标**
     * （`ev.clientX/clientY`），引擎内经 canvas rect 单源换算（`canvasPointOf`）后透传
     * `applyWheelZoom`——与容器内滚轮同一收敛式、同一端点冻结、同一开关回落；越界有限
     * 坐标不被截断（MUST NOT clamp）。缺坐标（缩放按钮无坐标 / 合成事件 / 旧调用桩）→
     * `point = null` → 屏心缩放（target 不动），行为与既有一致（向后兼容）。
     * 恒 `judge: false`：公共面缩放 MUST NOT 参与缩放阈值导航判定（D3）。
     * @param {number} deltaY 原生 wheel 的 deltaY
     * @param {{clientX?: number, clientY?: number}|null} [point] 原始视图坐标（可选）
     * @returns {boolean} 是否消费（非有限数/0 → false）
     */
    zoomBy(deltaY, point) {
      if (E.disposed) return false;
      /* 换算职责在引擎侧（rect 口径单源）：页面层只转发原始 clientX/clientY。
         无坐标调用不读 rect（行为与扩参前完全一致）。 */
      const at = point == null
        ? null
        : canvasPointOf(point.clientX, point.clientY, E.el.canvas.getBoundingClientRect());
      return applyWheelZoom(deltaY, at, { judge: false });
    },
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
      if (E.selected) { setSelection(null); return true; }
      return false;
    },
    isDiving() { return isDiving(); },
    flyOut,
    /**
     * 聚焦到指定恒星（add-cosmos-selection-linkage D1/D2/D7/D8）：面板 → 视图的飞行入口。
     * 分派：
     *  - 银河态 / 他星座钻取态 → 复用既有 `dive(ws, star)`（1300ms 钻入 + 落地自动选中）；
     *  - 同星座钻取态 → 立即 `setSelection(star)` + 短补间重对焦（`refocusStar`，600ms）。
     * 未命中 / 星胚（proto，面板不列）/ 已销毁 → `false` 且不抛错（调用方降级，面板选中仍有效）。
     * @param {string} wsId 目标工作区 id
     * @param {string} starId 目标恒星 id
     * @returns {boolean} 是否接受聚焦请求
     */
    focusStar(wsId, starId) {
      if (E.disposed || !E.scene || wsId == null || starId == null) return false;
      const ws = E.scene.ws.find(function (w) { return w.id === wsId; });
      if (!ws) return false;
      const star = ws.stars.find(function (s) { return s.id === starId; });
      if (!star) return false;
      if (star.lifecycle === 'proto') return false;
      if (E.focusWs && E.focusWs.id === ws.id) {
        setSelection({ kind: 'star', ws: ws, data: star });
        refocusStar(ws, star);
        return true;
      }
      dive(ws, star);
      return true;
    },
    /**
     * 聚焦到指定会话天体（add-cosmos-session-list-panel 3.1 / design D5）：会话列表面板 →
     * 视图的飞行入口，分派**镜像** `focusStar`：
     *  - 银河态 / 他星座钻取态 → 复用既有 `dive(ws, body)`（1300ms 钻入 + 落地自动选中；
     *    `kindOfEntity` 天然识别 planet / comet）；
     *  - 同星座钻取态 → 立即 `setSelection({kind, ws, data})` + 天体短补间重对焦（`refocusBody`，
     *    600ms；画布点选行星仍只选中不动镜头——本入口是面板专属的「带我去那个天体」）。
     * 未命中（会话不在场景 / 已归档 / 星座注销）/ 缺参 / 已销毁 → `false` 且不抛错。
     * 归档在途门禁按引擎既有口径：`archiveInFlight` 只拦「归档」重复请求，**不拦本入口**。
     * @param {string} wsId 目标工作区 id
     * @param {string} sessionId 目标会话（行星/彗星 body）id
     * @returns {boolean} 是否接受聚焦请求
     */
    focusBody(wsId, sessionId) {
      if (E.disposed || !E.scene || wsId == null || sessionId == null) return false;
      const ws = E.scene.ws.find(function (w) { return w.id === wsId; });
      if (!ws) return false;
      const planet = (ws.planets ?? []).find(function (p) { return p.id === sessionId; });
      const comet = planet ? null : (ws.comets ?? []).find(function (c) { return c.id === sessionId; });
      const body = planet ?? comet;
      if (!body) return false;
      const kind = planet ? 'planet' : 'comet';
      if (E.focusWs && E.focusWs.id === ws.id) {
        setSelection({ kind: kind, ws: ws, data: body });
        refocusBody(body);
        return true;
      }
      dive(ws, body);
      return true;
    },
    /** 选中态观测面（D4 页面点击守卫消费 + 冒烟直测）：与 onSelectChange 载荷同形。 */
    inspectSelection() {
      return E.disposed ? null : selectionInfoOf(E.selected);
    },
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
          ? {
            mode: E.tween.endMode ?? null, dur: E.tween.dur,
            /* `mix` 入投影（add-cosmos-selection-linkage 2.4）：重对焦 MUST 显式携带 1，
               否则钻取态 focusMix 会冻结起值/得 NaN——冒烟据此断言，防静默回归。 */
            to: { target: E.tween.to.target.slice(), dist: E.tween.to.dist, mix: E.tween.to.mix ?? null }
          }
          : null,
        camera: { target: E.cam.target.slice(), yaw: E.cam.yaw, pitch: E.cam.pitch, dist: E.cam.dist }
      };
    },
    /** 输入观测面（polish-cosmos-touch-nav 6.1/6.3 + add-cosmos-three-finger-pan 2.1，
        只读快照供冒烟直测）：多指针追踪数 / 手势模式 / 捏合基准 / 三指平移起点与累计
        位移 / 手势抑制窗 / dive 计数（容器级重绑「单次 dive」防回归）。 */
    inspectInput() {
      return {
        pointers: E.pointers.size,
        gesture: E.gesture === true,
        mode: E.pan3 ? "pan3" : E.pinch ? "pinch" : E.pointers.size === 1 ? "rotate" : E.gesture ? "multi" : "none",
        pinch: E.pinch ? { d0: E.pinch.d0, dist0: E.pinch.dist0 } : null,
        pan3: E.pan3
          ? {
            sx: E.pan3.sx,
            sy: E.pan3.sy,
            movedX: E.pan3.movedX,
            movedY: E.pan3.movedY,
            pinchCarry: E.pan3.pinchCarry === true
          }
          : null,
        pinchCarry: E.pinchCarry === true,
        gestureEndAt: E.gestureEndAt,
        suppressed: gestureSuppressed(),
        dragging: E.dragging === true,
        dives: E.diveCount
      };
    },
    /** 缩放导航观测面（add-cosmos-zoom-focus-nav 2.7，只读快照供冒烟直测）：
        调参 / 冷却锚点 / diveFrom 快照距离 / 各星座 boundR 与屏显投影。 */
    inspectZoomNav() {
      return {
        tuning: {
          diveRatio: E.tuning.diveRatio,
          flyOutRatio: E.tuning.flyOutRatio,
          pointerFocus: E.tuning.pointerFocus
        },
        switchAt: E.viewSwitchAt,
        diveFromDist: E.diveFrom ? E.diveFrom.dist : null,
        ws: (E.scene?.ws ?? []).map(function (w) {
          return {
            id: w.id,
            boundR: w.boundR,
            vis: w.vis === true,
            proj: w.proj ? { x: w.proj.x, y: w.proj.y, z: w.proj.z } : null
          };
        })
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
    /**
     * 成星捕获转场（polish-cosmos-orbit-insertion）：彗星 sessionId 被关联成行星时调用。
     * `from` = 彗星最后世界坐标，**调用方 MUST 在 setScene 前采集**（旧场景彗星体仍在，
     * `worldPosOf` 才查得到——与 markRegression 同款时序约束）；缺失/非法（理论竞态）
     * → 引擎回落捕获环外缘点照常衔接，不报错不中断。
     *
     * 入队时（setScene 前）一次采齐两件快照：彗星**离场切向**（游荡方程解析求导，
     * 起点切向连续的输入）与**尾迹**（fire 发生在 setScene 之后的渲染帧，届时旧彗星体
     * 已随场景替换销毁，fire 时无从取尾）。
     *
     * P2 存在转场，经 D7 调度器（同 ws 错峰 ≥0.15s / 序曲延迟 / 风暴降级）；补间 t0 在
     * 启动帧重锚（fire 时写 E.captures + body.captureStart，排队窗口内行星先按稳态
     * 轨道方程呈现）；尾迹经 `adoptTrailAcrossKinds` 跨 kind 交接给行星 body（MUST NOT
     * 因转场清零，与 inheritTrails 同限制：星座中心滑移在途时旧尾坐标相对旧中心的错位
     * 残影，接受）。
     */
    markCapture(sessionId, from, opts) {
      if (E.disposed || !sessionId) return;
      const entry = { t0: E.t, from: null, heading: null, trail: null, trailAcc: 0, degraded: false };
      if (Array.isArray(from) && from.length === 3 && from.every(function (v) { return Number.isFinite(Number(v)); })) {
        entry.from = [Number(from[0]), Number(from[1]), Number(from[2])];
      }
      /* setScene 前：旧彗星体仍在册 → 离场切向与尾迹快照一次采齐。 */
      const comet = findBodyInScene('comet', sessionId);
      if (comet) {
        entry.heading = cometHeadingAt(comet.phase, E.t);
        entry.trail = Array.isArray(comet.trail) ? comet.trail.map(function (p) { return p.slice(); }) : null;
        entry.trailAcc = Number(comet.acc) || 0;
      }
      enqueueMarker({
        priority: FX_PRIORITY.existence,
        wsId: opts?.wsId ?? null,
        delay: 0,
        activeDur: FX_ACTIVE_DUR.capture,
        fire: function (degraded) {
          const planet = findBodyInScene('planet', sessionId);
          if (!planet) return; // 行星未落位（理论竞态）→ 不标记，彗星态不变
          entry.t0 = E.t; // 延迟启动（序曲/错峰）→ 补间锚点重置到启动帧
          entry.degraded = degraded === true;
          E.captures.set(sessionId, entry);
          planet.captureStart = entry.t0;
          planet.captureAlpha = degraded === true ? 0 : 1;
          /* 尾迹跨 kind 交接（风暴降级不交接：无位移补间，尾迹按稳态自然生长）。 */
          if (!degraded && entry.trail) {
            planet.trail = adoptTrailAcrossKinds(entry.trail, 14);
            planet.acc = entry.trailAcc;
          }
        }
      });
    },
    /** 行星回归彗星反向捕获（E.captures 镜像）：from = 行星最后轨道世界坐标。
        调用方 MUST 在 setScene 前调用（旧场景行星体仍在，worldPosOf 才查得到——
        与卫星消亡流星同款时序约束）；from 缺失/非法 → 不标记（彗星直接出现）。
        opts.blast = { starPos }：恒星归档同帧传入爆心 → 激波弹射变体（add-cosmos-
        nova-ejection）：几何推定击中时刻 hit、快照行星尾迹（fire 时行星体已销毁，
        MUST 在标记时采集）；marker fire 消费 degraded（风暴）→ 回落普通回归。
        P2 存在转场，经 D7 调度器（错峰/风暴/序曲延迟）；补间 t0 在启动帧重锚。 */
    markRegression(sessionId, from, opts) {
      if (E.disposed || !sessionId || !Array.isArray(from) || from.length !== 3) return;
      const entry = { t0: E.t, from: [from[0], from[1], from[2]] };
      const blastOpt = opts?.blast;
      if (blastOpt && Array.isArray(blastOpt.starPos) && blastOpt.starPos.length === 3) {
        /* setScene 前：旧行星体仍在册 → baseR 与尾迹快照一次采齐。 */
        const planet = findBodyInScene('planet', sessionId);
        const hitInfo = shockHitOf(entry.from, blastOpt.starPos, planet?.baseR);
        if (hitInfo) {
          entry.blast = { starPos: blastOpt.starPos.slice() };
          entry.hit = hitInfo.hit;
          entry.kickDist = hitInfo.kickDist;
          entry.kickDir = hitInfo.kickDir;
          entry.trail = planet ? planet.trail.map(function (p) { return p.slice(); }) : null;
          entry.trailAcc = planet ? (planet.acc || 0) : 0;
        }
      }
      enqueueMarker({
        priority: FX_PRIORITY.existence,
        wsId: opts?.wsId ?? null,
        delay: 0,
        activeDur: FX_ACTIVE_DUR.regression, // 调度器占用/错峰口径不被分段演出延长（D2）
        fire: function (degraded) {
          entry.t0 = E.t; // 延迟启动（序曲/错峰）→ 补间锚点重置到启动帧
          if (degraded) {
            /* 风暴降级（D5）：不带分段 → 普通回归（无 hold/kick/尾迹点燃）。 */
            entry.blast = null;
            entry.trail = null;
            entry.trailAcc = 0;
          }
          E.regressions.set(sessionId, entry);
          for (const ws of E.scene?.ws ?? []) {
            const comet = ws.comets.find((c) => c.id === sessionId);
            if (!comet) continue;
            const blast = blastFieldsOf(entry);
            comet.from = entry.from.slice();
            comet.regressStart = entry.t0;
            comet.regressAlpha = 0;
            comet.blast = blast ? blast.blast : null;
            comet.hit = blast ? blast.hit : null;
            comet.kickDist = blast ? blast.kickDist : 0;
            comet.kickDir = blast ? blast.kickDir : null;
            comet.blastTrail = blast ? blast.blastTrail : null;
            comet.blastTrailAcc = blast ? blast.blastTrailAcc : 0;
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
    /** 关联聚焦观测面（cosmos-relation-focus D1/D2/D3 冒烟直测，只读快照）：当前聚焦源键、
        relMix 坡道条目（dir + 帧时刻 α）、最近一帧 rel 呈现产出（轨道环 / 星↔行星关系段 /
        共享会话虚线段，均含 α）。focusKey 为 ""：无 hover/选中（渐熄窗口内条目仍在册）。 */
    inspectRelation() {
      return {
        focusKey: E.relFocusKey,
        mix: [...E.relMix.entries()].map(function (pair) {
          return { key: pair[0], dir: pair[1].dir, alpha: relAlphaOf(pair[1], E.t) };
        }),
        last: E.relLast ? {
          orbits: E.relLast.orbits.map(function (o) { return { wsId: o.wsId, planetId: o.planetId, alpha: o.alpha }; }),
          segs: E.relLast.segs.map(function (s) { return { wsId: s.wsId, starId: s.starId, planetId: s.planetId, alpha: s.alpha }; }),
          links: E.relLast.links.map(function (l) { return { wsId: l.wsId, aId: l.aId, bId: l.bId, alpha: l.alpha }; })
        } : null
      };
    },
    /** 成星捕获观测面（polish-cosmos-orbit-insertion 4.1 冒烟直测，只读快照）：捕获条目
        （from / 离场切向 / 尾迹快照长度 / degraded / elapsed）与行星 body（wp / α / 补间
        起点 / 尾迹长度与尾点）同帧快照。 */
    inspectCapture(sessionId) {
      const entry = E.captures.get(sessionId) ?? null;
      const planet = findBodyInScene('planet', sessionId);
      return {
        entry: entry ? {
          t0: entry.t0,
          elapsed: Math.max(0, E.t - entry.t0),
          from: Array.isArray(entry.from) ? entry.from.slice() : null,
          heading: Array.isArray(entry.heading) ? entry.heading.slice() : null,
          trail: Array.isArray(entry.trail) ? entry.trail.length : 0,
          degraded: entry.degraded === true
        } : null,
        planet: planet ? {
          wp: (planet.wp ?? [0, 0, 0]).slice(),
          captureStart: planet.captureStart ?? null,
          captureAlpha: Number.isFinite(Number(planet.captureAlpha)) ? Number(planet.captureAlpha) : null,
          trail: Array.isArray(planet.trail) ? planet.trail.length : 0,
          trailHead: Array.isArray(planet.trail) && planet.trail.length ? planet.trail[0].slice() : null,
          trailTail: Array.isArray(planet.trail) && planet.trail.length ? planet.trail[planet.trail.length - 1].slice() : null
        } : null
      };
    },
    /** 激波弹射观测面（add-cosmos-nova-ejection 4.1 冒烟直测，只读快照）：回归条目
        （分段参数/尾迹快照长度/elapsed）与彗星 body（wp/α/分段字段/尾迹）同帧快照。 */
    inspectEjection(sessionId) {
      const entry = E.regressions.get(sessionId) ?? null;
      const comet = findBodyInScene('comet', sessionId);
      return {
        entry: entry ? {
          t0: entry.t0,
          elapsed: Math.max(0, E.t - entry.t0),
          from: entry.from.slice(),
          blast: entry.blast ? { starPos: entry.blast.starPos.slice() } : null,
          hit: entry.hit ?? null,
          kickDist: entry.kickDist ?? null,
          kickDir: Array.isArray(entry.kickDir) ? entry.kickDir.slice() : null,
          trail: Array.isArray(entry.trail) ? entry.trail.length : 0
        } : null,
        comet: comet ? {
          wp: (comet.wp ?? [0, 0, 0]).slice(),
          regressAlpha: comet.regressAlpha,
          blast: comet.blast ? { starPos: comet.blast.starPos.slice() } : null,
          hit: comet.hit ?? null,
          kickDist: comet.kickDist ?? null,
          kickDir: Array.isArray(comet.kickDir) ? comet.kickDir.slice() : null,
          trail: Array.isArray(comet.trail) ? comet.trail.length : 0,
          trailTail: Array.isArray(comet.trail) && comet.trail.length ? comet.trail[comet.trail.length - 1].slice() : null
        } : null
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
    /** 天体世界坐标查询（事件流星起点 / 回归 from 采集）：kind 'planet'|'comet'。 */
    worldPosOf(kind, id) {
      const found = findBodyInScene(kind, id);
      return found ? found.wp.slice() : null;
    },
    toast,
    /** 平移调参 + 缩放导航热更新（设置面持久化后调用，无需重开整页）：
        `{ panSpeed, panShiftBoost, zoomDiveRatio, zoomFlyOutRatio, zoomPointerFocus }`
        （部分写语义：非法/缺席键保持原值）。 */
    setTuning(settings) {
      if (Number(settings?.panSpeed) > 0) E.tuning.speed = settings.panSpeed;
      if (Number(settings?.panShiftBoost) > 0) E.tuning.boost = settings.panShiftBoost;
      if (positiveOr(settings?.zoomDiveRatio, 0) > 0) E.tuning.diveRatio = positiveOr(settings.zoomDiveRatio, E.tuning.diveRatio);
      if (positiveOr(settings?.zoomFlyOutRatio, 0) > 0) E.tuning.flyOutRatio = positiveOr(settings.zoomFlyOutRatio, E.tuning.flyOutRatio);
      if (typeof settings?.zoomPointerFocus === "boolean") E.tuning.pointerFocus = settings.zoomPointerFocus;
    },
    getTuning() {
      return {
        panSpeed: E.tuning.speed,
        panShiftBoost: E.tuning.boost,
        zoomDiveRatio: E.tuning.diveRatio,
        zoomFlyOutRatio: E.tuning.flyOutRatio,
        zoomPointerFocus: E.tuning.pointerFocus
      };
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
      E.relMix.clear(); // 关联聚焦坡道随实例销毁（cosmos-relation-focus D3：呈现层瞬态）
      E.relFocusKey = "";
      E.relLast = null;
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
      /* 包围球半径同触点更新（add-cosmos-zoom-focus-nav 2.1/D4）：archives / 恒星 off /
         行星轨道中心与卫星包络在本补丁内可能变化 → 以最新几何重算（仅影响返回阈值，
         MUST NOT 影响布局/绘制；与 regenerateWsDust 同触点）。 */
      ws.boundR = constellationBoundROf(ws);
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
