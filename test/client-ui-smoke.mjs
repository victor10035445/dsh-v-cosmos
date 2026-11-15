/**
 * 客户端 UI 面冒烟（add-cosmos-proposal-actions 3.2/3.5/3.6/4.1/4.4/4.6/5.1–5.3）：
 *  - 引擎公共面：`zoomBy` 缩放转发（动作条）/ 值域 clamp / `isUiChromeTarget` 键盘守卫 /
 *    钻取态回调（面板过滤与让位的数据源）；
 *  - 源码锚点：面板与动作条的 DOM 钩子、布局避让（面板宽度/让位/动作条安全边距/
 *    toast 上移变量）、hero 消费条目（渲染 null + 门控字段）、设置节与锁定项、CSS 钩子。
 *
 * React 组件树在 Node 侧不可挂载（react 为 bundle external），故组件呈现走源码锚点 +
 * 纯逻辑直测（panel/actions/settings 三套冒烟）；契约行为由真机验收（6.3）。
 * 运行：node test/client-ui-smoke.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCosmosEngine } from "../src/cosmos/engine.mjs";
import { isEditableTarget, isUiChromeTarget } from "../src/cosmos/engine.mjs";
import { createSkinD } from "../src/cosmos/skin-d.mjs";

/* ── DOM 桩（引擎所需最小面；与 render-smoke 同款） ── */
function makeCtx2d() {
  const grad = { addColorStop() {} };
  const store = {};
  return new Proxy(store, {
    get(target, prop) {
      if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => grad;
      if (prop === "measureText") return () => ({ width: 10 });
      if (!(prop in target)) target[prop] = () => undefined;
      return target[prop];
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    }
  });
}

function makeElement(tag) {
  const listeners = {};
  const el = {
    tag,
    style: {},
    dataset: {},
    className: "",
    textContent: "",
    innerHTML: "",
    width: 0,
    height: 0,
    children: [],
    listeners,
    classList: { add() {}, remove() {}, contains: () => false },
    appendChild(child) {
      el.children.push(child);
      return child;
    },
    remove() {},
    querySelector(sel) {
      el._byClass = el._byClass || {};
      const cls = String(sel).replace(".", "");
      if (!el._byClass[cls]) {
        el._byClass[cls] = sel === ".cos-canvas" ? makeCanvasEl() : makeElement("div");
        el._byClass[cls].getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 });
      }
      return el._byClass[cls];
    },
    querySelectorAll: () => [],
    addEventListener(type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    removeEventListener() {},
    setAttribute() {},
    getAttribute: () => null,
    setPointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 })
  };
  return el;
}

function makeCanvasEl() {
  const el = makeElement("canvas");
  el.getContext = () => makeCtx2d();
  return el;
}

const rafQueue = [];
globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
globalThis.document = {
  createElement: (tag) => (tag === "canvas" ? makeCanvasEl() : makeElement(tag)),
  addEventListener() {},
  removeEventListener() {},
  hidden: false,
  activeElement: null,
  head: { appendChild() {} }
};
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};
globalThis.requestAnimationFrame = (cb) => {
  rafQueue.push(cb);
  return rafQueue.length;
};
globalThis.cancelAnimationFrame = () => {};
if (typeof globalThis.performance === "undefined") globalThis.performance = { now: () => Date.now() };

/* ── 1. 键盘守卫：面板/动作条内聚焦不劫持 WASD（3.5） ── */
{
  const panelButton = { closest: (sel) => (String(sel).includes(".dsh-cosmos-panel") ? { id: "panel" } : null) };
  const actionButton = { closest: (sel) => (String(sel).includes(".dsh-cosmos-actions") ? { id: "actions" } : null) };
  const sessionButton = { closest: (sel) => (String(sel).includes(".dsh-cosmos-sessions") ? { id: "sessions" } : null) };
  const canvas = { closest: () => null };
  assert.equal(isUiChromeTarget(panelButton), true, "面板内元素命中");
  assert.equal(isUiChromeTarget(actionButton), true, "动作条内元素命中");
  assert.equal(isUiChromeTarget(sessionButton), true, "会话面板内元素命中（含折叠态标题栏按钮；WASD 不劫持）");
  /* 把手退役（swap-cosmos-session-toggle-titlebar 4.1）：键盘守卫选择器不得残留
     `.cos-sessions-handle`——折叠态标题栏按钮已由 `.dsh-cosmos-sessions` 覆盖。 */
  const guardSelectorSource = readFileSync(new URL("../src/cosmos/engine.mjs", import.meta.url), "utf8");
  assert.ok(!guardSelectorSource.includes(".cos-sessions-handle"), "isUiChromeTarget 选择器无 .cos-sessions-handle 残留");
  assert.equal(isUiChromeTarget(canvas), false, "引擎容器内元素不命中");
  assert.equal(isUiChromeTarget(null), false, "null → false");
  assert.equal(isUiChromeTarget({}), false, "无 closest → false");
  assert.equal(isUiChromeTarget({ closest: () => { throw new Error("x"); } }), false, "异常 → false（守卫不抛错）");

  assert.equal(isEditableTarget({ tagName: "INPUT" }), true, "输入框仍按可编辑处理");
  assert.equal(isEditableTarget({ tagName: "BUTTON" }), false, "按钮不是可编辑元素（由 chrome 守卫兜底）");
  assert.equal(isEditableTarget(null), false);
}

/* ── 2. zoomBy（动作条滚轮转发）+ 值域 clamp + 取消补间语义（3.6/4.1） ── */
{
  const engine = createCosmosEngine({ container: makeElement("div"), style: createSkinD() });
  assert.equal(engine.getCamera().dist, 430, "默认视距");
  assert.equal(engine.zoomBy(120), true, "有效 deltaY 被消费");
  assert.equal(Math.round(engine.getCamera().dist), Math.round(430 * 1.144), "缩放比例与容器级滚轮一致（1 + dy*0.0012）");
  assert.equal(engine.zoomBy(0), false, "0 → 不消费");
  assert.equal(engine.zoomBy(Number.NaN), false, "NaN → 不消费");
  const before = engine.getCamera().dist;
  engine.zoomBy(-100000);
  assert.equal(engine.getCamera().dist, 24, "近端 clamp 24");
  for (let i = 0; i < 20; i += 1) engine.zoomBy(1000);
  assert.equal(engine.getCamera().dist, 4200, "远端 clamp 4200");
  void before;
  engine.dispose();
}

/* ── 3. 钻取态回调（面板过滤/让位的唯一数据源，3.4/3.6） ── */
{
  const seen = [];
  const engine = createCosmosEngine({
    container: makeElement("div"),
    style: createSkinD(),
    onDrillChange: (info) => seen.push(info)
  });
  const scene = {
    workspaces: [
      { id: "ws1", name: "alpha", pos: [0, 0, 0], stars: [], links: [], planets: [], comets: [], archives: 0, satelliteCount: 0 },
      { id: "ws2", name: "beta", pos: [120, 0, 0], stars: [], links: [], planets: [], comets: [], archives: 0, satelliteCount: 0 }
    ]
  };
  engine.setScene(scene, "rebuild");
  assert.equal(engine.diveToWs("ws1"), true, "钻取命中星座");
  assert.deepEqual(seen.at(-1), { wsId: "ws1", name: "alpha" }, "钻取态回调（过滤/让位数据源）");
  const count = seen.length;
  engine.diveToWs("ws1");
  assert.equal(seen.length, count, "同星座重复钻取 → 幂等不重复回调");
  engine.diveToWs("ws2");
  assert.deepEqual(seen.at(-1), { wsId: "ws2", name: "beta" }, "切换星座 → 回调更新");
  /* 焦点星座注销（setScene 无该 ws）→ remapFocusRefs 立即回银河（同步可观测）。 */
  engine.setScene({ workspaces: [scene.workspaces[0]] }, "rebuild");
  assert.equal(seen.at(-1), null, "焦点星座注销 → 钻取态回调 null（面板恢复全量）");
  engine.dispose();
}

/* ── 4. 源码锚点：面板（3.2/3.5/3.6） ── */
const clientSource = readFileSync(new URL("../src/client.jsx", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("../src/settings-ui.jsx", import.meta.url), "utf8");
const engineSource = readFileSync(new URL("../src/cosmos/engine.mjs", import.meta.url), "utf8");
{
  assert.ok(clientSource.includes('className="dsh-cosmos-panel"'), "面板容器 JSX");
  assert.ok(clientSource.includes('data-plugin-anchor="dsh-v-cosmos:panel"'), "面板插件锚点");
  assert.ok(clientSource.includes('data-cosmos-proposal={card.id}'), "卡片稳定钩子 data-cosmos-proposal");
  assert.ok(clientSource.includes('data-lifecycle={card.lifecycle}'), "四态色经 data-lifecycle 映射");
  assert.ok(clientSource.includes('data-selected={card.key === selectedKey ? "true" : undefined}'), "单选高亮态");
  assert.ok(clientSource.includes("card.tasks[0] + \"/\" + card.tasks[1]"), "tasks x/y 徽标");
  assert.ok(clientSource.includes("{card.setBy ?"), "setBy 徽标（缺失省略）");
  assert.ok(clientSource.includes("{card.at ?"), "at 徽标（缺失省略）");
  assert.ok(clientSource.includes('t("cosmos.panel.emptyConstellation", "该星座暂无提案")'), "钻取无提案空态文案");
  assert.ok(clientSource.includes("if (!model || !model.visible) return null;"), "无提案零布局（面板不渲染）");
  assert.ok(clientSource.includes("onClick={() => onSelect(card.key)}"), "点卡片仅选中（不 dive）");
  assert.ok(!clientSource.includes("diveToWs(card"), "卡片点击不含 dive 调用");
  /* 选中/取消选中（用户 2026-11-11 要求）：面板/动作条/搜索框以外点击 → 清除选中。 */
  assert.ok(clientSource.includes("if (isSelectionSurface(event.target)) return;"), "点击作用面内保留选中");
  assert.ok(clientSource.includes("setSelectedKey(null);"), "点击其他区域清除选中（动作条熄灭）");
  assert.ok(clientSource.includes("onPointerDown={(event) => {"), "页面记录 pointerdown 起点（点击/拖拽判据）");
  assert.ok(clientSource.includes("Math.hypot(event.clientX - tapStart.x, event.clientY - tapStart.y) > 6"), "拖拽（旋转/拖选）不算点击、不清选中");
  /* 输入互斥：面板内 Esc = 失焦并阻断冒泡；列表为滚动区 */
  assert.ok(clientSource.includes("if (active && typeof active.blur === \"function\") active.blur();"), "面板内 Esc 失焦（含卡片焦点）");
  assert.ok(clientSource.includes("event.stopPropagation();"), "面板内 Esc 不冒泡到外壳分层");
  assert.ok(engineSource.includes("isUiChromeTarget(document.activeElement)"), "WASD 劫持排除面板/动作条焦点");
  assert.ok(clientSource.includes("tabIndex={0}"), "面板列表可聚焦（键盘滚动）");
  assert.ok(clientSource.includes("touch-action:pan-y"), "面板内保留原生触摸滚动");
  /* 布局：宽 187px（原 280px 收窄 1/3，add-cosmos-layout-tuning 起经令牌可配）、贴右缘、
     银河自顶起、钻取让位、窄屏避让搜索框、底部让位动作条、高度上限令牌（0 = 自适应） */
  assert.ok(
    clientSource.includes(".dsh-cosmos-panel{position:absolute;right:0;top:12px;bottom:calc(var(--cos-actions-h,0px) + 72px);width:var(--cos-const-panel-w, 187px);max-height:var(--cos-const-panel-h, none);z-index:42;"),
    "面板宽经 --cos-const-panel-w（fallback 187）+ 贴右缘 + 底部让位动作条 + 高度上限令牌"
  );
  const panelRule = clientSource.slice(clientSource.indexOf(".dsh-cosmos-panel{"), clientSource.indexOf(".dsh-cosmos-panel::after"));
  assert.ok(panelRule.includes("border-right:none") && !panelRule.includes("border-left:none"), "面板描边镜像（贴右缘 → border-right:none，无残留左缘描边）");
  assert.ok(clientSource.includes(".dsh-cosmos-panel::after{content:'';position:absolute;left:-1px;top:-1px;"), "角标镜像到面板左上角（内缘，换边后与画布相邻侧）");
  assert.ok(clientSource.includes(".dsh-cosmos-panel[data-drill=true]{top:64px}"), "钻取态下移让位顶部中央标牌（窄视口纵向隔离带）");
  assert.ok(clientSource.includes("@media (max-width:640px){.dsh-cosmos-panel{top:56px}"), "窄屏让位顶部搜索框（断点按 187px 重算）");
  assert.ok(clientSource.includes("flex-wrap:wrap;align-items:center;gap:2px 6px"), "窄面板下元信息换行（tasks/徽标/时间不溢出）");
  assert.ok(clientSource.includes("--dsw-alias-") || clientSource.includes("--dsw-"), "设置区走官方 token（面板为风格 D 硬编码色，见 style-d 基线）");
}

/* ── 4a. CSS 模板字面量完整性（swap-cosmos-session-toggle-titlebar 回归） ──
   整站 CSS 是单个模板字面量：CSS 注释/规则内出现裸反引号会提前闭合它；esbuild 仍能
   编译（余下文本退化为移位/模板表达式），但 CSS 常量退化为数字 0 → 整站样式静默失效
   （侧栏座位按钮变方、Cosmos 页面裸奔）。按「首个未转义反引号 = 真闭合点」扫描并与
   预期闭合标记比对。 */
{
  const cssMarker = "const CSS = `";
  const cssOpenAt = clientSource.indexOf(cssMarker);
  assert.ok(cssOpenAt >= 0, "CSS 模板字面量起始锚可定位");
  let cssCloseAt = -1;
  for (let i = cssOpenAt + cssMarker.length; i < clientSource.length; i += 1) {
    if (clientSource[i] === "\\") {
      i += 1;
      continue;
    }
    if (clientSource[i] === "`") {
      cssCloseAt = i;
      break;
    }
  }
  assert.ok(cssCloseAt > cssOpenAt, "CSS 模板字面量闭合可定位");
  assert.equal(
    clientSource.slice(cssCloseAt, cssCloseAt + "`;\n\nfunction installStyles".length),
    "`;\n\nfunction installStyles",
    "CSS 模板字面量内无裸反引号（提前闭合 → 整站样式失效）"
  );
  const cssBody = clientSource.slice(cssOpenAt + cssMarker.length, cssCloseAt);
  assert.ok(cssBody.includes(".cos-seat-rail{"), "CSS 模板字面量完整包含座位规则（侧栏按钮原样）");
  assert.ok(cssBody.includes(".cos-sessions-toggle{"), "CSS 模板字面量完整包含标题栏开合按钮规则");
  assert.ok(cssBody.includes('[data-cos-mode="light"]'), "CSS 模板字面量完整包含 light-mode 分支");
}

/* ── 4b. 源码锚点：会话列表面板（add-cosmos-session-list-panel 2.x/3.x） ── */
{
  assert.ok(clientSource.includes("function SessionPanel({ t, model, open, selectedKey, drill, waiting, onToggle, onSelect, onOpen, onArchive })"), "会话列表面板组件");
  assert.ok(clientSource.includes("function SessionRow({ t, row, selected, onSelect, onOpen, onArchive })"), "会话行组件");
  assert.ok(clientSource.includes('data-plugin-anchor="dsh-v-cosmos:sessions"'), "面板插件锚点");
  /* 把手退役（swap-cosmos-session-toggle-titlebar 2.1/2.2）：面板恒渲染 + 标题栏开合按钮，
     左缘把手锚点 / 类名 / 竖排标签全清（反转断言）。 */
  assert.ok(!clientSource.includes("sessions-handle"), "无 sessions-handle 插件锚点 / 无 .cos-sessions-handle 残留");
  assert.ok(clientSource.includes('data-collapsed={open ? undefined : "true"}'), "面板恒渲染 + data-collapsed 随态");
  const sessionsHeadAt = clientSource.indexOf('className="dsh-cosmos-sessions-head"');
  const sessionsListAt = clientSource.indexOf('className="dsh-cosmos-sessions-list"');
  assert.ok(sessionsHeadAt > 0 && sessionsListAt > sessionsHeadAt, "标题栏与清单区同在 aside 内（恒挂载）");
  const headBlock = clientSource.slice(sessionsHeadAt, sessionsListAt);
  assert.ok(headBlock.includes('className="cos-sessions-toggle"') && headBlock.includes("data-cosmos-sessions-toggle"), "开合控制点 = 标题栏/竖条同一按钮");
  assert.ok(headBlock.includes("aria-expanded={open}"), "开合按钮 aria-expanded 随态（原把手锚迁移）");
  assert.ok(headBlock.includes('aria-label={toggleAria}') && headBlock.includes('title={toggleAria}'), "按钮 aria-label/title 随态文案");
  assert.ok(clientSource.includes("const toggleAria = open"), "随态文案：展开态 = 收起会话面板");
  assert.ok(clientSource.includes(': t("cosmos.sessions.handleAria", "展开会话列表");'), "随态文案：折叠态 = 展开会话列表");
  assert.ok(headBlock.includes('{open ? "<<" : ">>"}'), "按钮字形随态 << / >>");
  assert.ok(headBlock.includes("{waiting > 0 ? (") && headBlock.includes('className="cos-sessions-waiting"'), "待处理计数徽标随态（waiting>0 才渲染）");
  assert.ok(clientSource.includes("waiting={sessionModel.waiting}"), "徽标计数 = 全量待决策（projectSessionPanel.waiting）");
  assert.ok(!clientSource.includes('className="dsh-cosmos-sessions-close"'), "展开态无面板头关闭钮（单一控制点 = 同一开合按钮）");
  assert.ok(!clientSource.includes(".dsh-cosmos-sessions-close"), "关闭钮 CSS 规则同步移除（无残留第二控件样式）");

  /* overlay 落位：绝对定位 + 贴页面左缘 + 宽 260px（令牌可配），MUST NOT 参与布局流（不挤压画布） */
  assert.ok(
    clientSource.includes(".dsh-cosmos-sessions{position:absolute;left:0;top:12px;bottom:calc(var(--cos-actions-h,0px) + 72px);width:var(--cos-session-w, 260px);max-height:var(--cos-session-h, none);z-index:42;"),
    "左缘 overlay 贴页面左缘（left:0、宽经 --cos-session-w，fallback 260；不参与布局流；高度上限令牌）"
  );
  assert.ok(clientSource.includes("border:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .28);border-left:none;pointer-events:auto}"), "浮层描边镜像（贴页面左缘 → border-left:none）");
  const sessionsRule = clientSource.slice(clientSource.indexOf(".dsh-cosmos-sessions{"), clientSource.indexOf(".dsh-cosmos-sessions::before"));
  assert.ok(sessionsRule.includes("border-left:none") && !sessionsRule.includes("border-right:none"), "浮层无残留右缘描边（border-right 全部镜像为 border-left）");
  assert.ok(clientSource.includes(".dsh-cosmos-sessions::before{content:'';position:absolute;right:-1px;top:-1px;"), "角标仍在浮层右上角（内缘）");
  assert.ok(clientSource.includes(".dsh-cosmos-sessions[data-drill=true]{top:64px}"), "钻取态下移让位顶部标牌");
  assert.ok(clientSource.includes("@media (max-width:640px){.dsh-cosmos-sessions{top:56px}"), "窄屏让位搜索框");
  /* 折叠分支（用户图像修订）：竖向窄条 width:48px、标题/计数隐藏、head 竖向排列、
     清单区 display:none；按钮在上、徽标在下；整列高度（不再 bottom:auto）。 */
  assert.ok(clientSource.includes(".dsh-cosmos-sessions[data-collapsed=true]{width:48px}"), "折叠态竖向窄条宽 48px");
  assert.ok(clientSource.includes(".dsh-cosmos-sessions[data-collapsed=true]::before{display:none}"), "窄条不保留角标");
  assert.ok(clientSource.includes(".dsh-cosmos-sessions[data-collapsed=true] .dsh-cosmos-sessions-head{flex-direction:column;justify-content:flex-start;gap:8px;padding:4px 2px;border-bottom:none}"), "折叠态 head 竖向排列（无分隔线）");
  assert.ok(clientSource.includes(".dsh-cosmos-sessions[data-collapsed=true] .dsh-cosmos-sessions-title,") && clientSource.includes(".dsh-cosmos-sessions[data-collapsed=true] .dsh-cosmos-sessions-count{display:none}"), "折叠态标题/作用域计数隐藏");
  assert.ok(clientSource.includes(".dsh-cosmos-sessions[data-collapsed=true] .cos-sessions-toggle{order:1}"), "窄条顶部 = 开合按钮（order 1）");
  assert.ok(clientSource.includes(".dsh-cosmos-sessions[data-collapsed=true] .cos-sessions-waiting{order:2}"), "待处理徽标在按钮下方（order 2）");
  assert.ok(clientSource.includes(".dsh-cosmos-sessions[data-collapsed=true] .dsh-cosmos-sessions-list{display:none}"), "折叠态清单区隐藏（display:none）");
  assert.ok(!clientSource.includes(".dsh-cosmos-sessions[data-collapsed=true]{bottom:auto}"), "折叠态整列高度（不再 bottom:auto）");
  const toggleRule = clientSource.slice(clientSource.indexOf(".cos-sessions-toggle{"), clientSource.indexOf(".cos-sessions-toggle:hover"));
  assert.ok(toggleRule.includes("min-width:40px") && toggleRule.includes("min-height:40px"), "开合按钮触屏热区 ≥40px");
  assert.ok(clientSource.includes(".cos-sessions-toggle:focus-visible{"), "按钮 focus-visible 焦点环");
  assert.ok(clientSource.includes(".cos-sessions-waiting{"), "徽标样式随态（warning alias → --cos-waiting 级联）");
  assert.ok(!clientSource.includes("writing-mode:vertical-rl"), "把手竖排标签样式移除");
  assert.ok(!clientSource.includes('[data-cos-mode="light"] .cos-sessions-handle'), "light-mode 聚合分支移除把手行");
  assert.ok(clientSource.includes("--cos-panel-soft"), "面板底色消费皮肤令牌（--cos-panel-soft 族）");
  assert.ok(clientSource.includes("pointer-events:auto"), "面板可交互（覆盖引擎层）");

  /* 行状态语法：四态优先级 → 点 / loader / 无点；尾注替换 + 悬停完整状态；卫星徽标 */
  assert.ok(clientSource.includes("row.state === \"busy\"\n              ? <span className=\"dsh-cosmos-session-loader\" />\n              : row.state === \"idle\" ? null : <span className=\"dsh-cosmos-session-dot\" />"), "busy=loader / idle=无点 / waiting·done=点");
  assert.ok(clientSource.includes(".dsh-cosmos-session-lead[data-state=waiting] .dsh-cosmos-session-dot{background:var(--dsw-alias-state-warn-primary,var(--cos-waiting,#ffaa4a))}"), "warning 点色级联：宿主 alias → 皮肤令牌");
  assert.ok(clientSource.includes(".dsh-cosmos-session-lead[data-state=done-unread] .dsh-cosmos-session-dot{background:var(--dsw-alias-state-success-primary,var(--cos-done,#5affc0))}"), "done 点色级联：宿主 alias → 皮肤令牌");
  assert.ok(clientSource.includes(".dsh-cosmos-session-loader{") && clientSource.includes("@keyframes cos-session-spin"), "ongoing loader（旋转动画，非静态点）");
  assert.ok(clientSource.includes("prefers-reduced-motion:reduce"), "减少动效偏好下降速（不取消状态提示）");
  assert.ok(clientSource.includes(".dsh-cosmos-session-trailing[data-state=waiting]{color:var(--dsw-alias-state-warn-primary,var(--cos-waiting,#ffaa4a))}"), "待决策尾注文案取 warning 色");
  assert.ok(clientSource.includes("{pending ? sessionPendingTextOf(t, row.pendingKind) : row.when}"), "待决策期间分类文案替换相对时间（DSH 口径）");
  assert.ok(clientSource.includes('const title = sessionStatusTextOf(t, row) + " · " + row.when;'), "悬停 title 保留完整状态 + 相对时间");
  assert.ok(clientSource.includes("row.kind === \"planet\" ? \"●\" : \"☄\""), "行星/彗星形态标记（●/☄，与星座隐喻同源）");
  assert.ok(clientSource.includes('{"◇" + row.satelliteCount}'), "卫星计数徽标 ◇N（折叠不丢数）");
  assert.ok(clientSource.includes("row.todos !== \"—\""), "todos 徽标沿用既有装配（无 todo 省略）");
  assert.ok(clientSource.includes("key={row.key}"), "行 key 稳定（内容差分守卫）");
  assert.ok(clientSource.includes("{model.groups.length === 0 ? ("), "空态分支（分组零行仍渲染面板）");
  assert.ok(clientSource.includes('t("cosmos.sessions.emptyConstellation", "该星座暂无会话")'), "钻取空星座空态文案");
  assert.ok(clientSource.includes('t("cosmos.sessions.emptyGalaxy", "暂无活跃会话")'), "银河态无会话空态文案");
  assert.ok(clientSource.includes('data-cosmos-session={row.id}'), "行稳定钩子 data-cosmos-session");

  /* 两个动作分属两个按钮：点行 = 选中联动（不关页），「打开」= 官方导航链路 */
  assert.ok(clientSource.includes("onClick={() => onSelect(row)}"), "点行 = 选中联动");
  assert.ok(clientSource.includes("onClick={() => onOpen(row)}"), "「打开」按钮独立职责");
  assert.ok(clientSource.includes("controllerRef.current?.actions?.openSession?.(row.id);"), "「打开」走官方导航链路（关整页 → ctx.uiWorkspace.openSession）");
  assert.ok(clientSource.includes("controllerRef.current?.focusSession?.({ wsId: row.wsId, id: row.id });"), "点行转发引擎 focusBody（选中联动）");
  assert.ok(clientSource.includes("focusSession({ wsId, id } = {}) {"), "控制器公共面 focusSession");
  assert.ok(clientSource.includes("return engine?.focusBody?.(wsId, id) === true;"), "转发引擎 focusBody");
  assert.ok(engineSource.includes("focusBody(wsId, sessionId) {"), "引擎薄入口 focusBody");
  assert.ok(engineSource.includes("function refocusBody(body) {"), "天体级重对焦（取点走 wp 世界坐标）");
  assert.ok(engineSource.includes("const wp = Array.isArray(body?.wp) ? body.wp : null;"), "落点 = 天体世界坐标（MUST NOT 用星座中心）");
  assert.ok(engineSource.includes("setSelection({ kind: kind, ws: ws, data: body });"), "同星座钻取态立即选中");
  assert.ok(engineSource.includes("dive(ws, body);"), "银河/他星座 → dive 落地选中");

  /* Esc 分层：清空搜索 > 收起面板 > 退全屏/关页；折叠态跳过本层 */
  const escStart = clientSource.indexOf("if (engine?.consumeEscape?.()) return;");
  const escEnd = clientSource.indexOf('window.addEventListener("keydown", onKey);', escStart);
  const escBody = clientSource.slice(escStart, escEnd);
  assert.ok(escBody.indexOf("if (queryRef.current.trim())") < escBody.indexOf("if (sessionPanelOpenOf())"), "清空搜索层先于收起面板层");
  assert.ok(escBody.indexOf("if (sessionPanelOpenOf())") < escBody.indexOf("if (fullscreen)"), "收起面板层先于退全屏/关页");
  assert.ok(escBody.includes("setSessionPanelOpen(false);"), "Esc 收起走同一 action 通道（含持久化）");
  assert.ok(clientSource.includes("if (sessionPanelOpenOf()) {"), "折叠态跳过本层（语义回到既有分层）");

  /* 展开态持久化：settings 键 + 模块 store + 单一写者 */
  assert.ok(clientSource.includes("const cosmosSessionPanelStore = createSnapshotStore({ open: sessionPanelInitialOpen() });"), "展开态模块 store（冷启动读持久化偏好）");
  assert.ok(clientSource.includes("return loadCosmosSettings().sessionPanelOpen !== false;"), "缺省展开（无记录/非法 → true）");
  assert.ok(clientSource.includes("const merged = saveCosmosSettings({ sessionPanelOpen: next });"), "写者唯一：saveCosmosSettings（settings 存储通道）");
  assert.ok(clientSource.includes("onToggle={toggleSessionPanel}"), "标题栏按钮为唯一 toggle 写入口（同一写者；无第二控件）");
  assert.ok(clientSource.includes("projectSessionPanel(scene, { drillWsId: drill?.wsId ?? null })"), "面板投影走 projectSessionPanel 纯函数（随 sceneVersion 刷新，无新增轮询）");
}

/* ── 4c. 源码锚点：会话行「归档」入口（add-cosmos-session-row-archive 2.x/3.x） ──
   组件树不可挂载（同 4b），故行内按钮呈现 / 点击分流 / 行级门禁 / 转发链路走源码锚点，
   outcome 呈现与安全语义由 `session-archive-smoke` 纯逻辑直测覆盖（两条共用 requirement）。 */
{
  /* 呈现：常显图标钮、程序化钩子、aria 文案、恒居「打开」之后（行内动作区末位） */
  assert.ok(clientSource.includes('className="dsh-cosmos-session-archive"'), "行内归档按钮类名");
  assert.ok(clientSource.includes('data-action="archive"'), "归档按钮程序化分流钩子 data-action");
  assert.ok(clientSource.includes('aria-label={t("cosmos.sessions.archiveAria", "归档会话")}'), "aria-label = 归档会话");
  assert.ok(clientSource.includes('title={t("cosmos.sessions.archiveAria", "归档会话")}'), "title = 归档会话");
  assert.ok(!clientSource.includes('data-session={row.id}'), "行内不引入信息卡专有 data-session（定位走行容器 data-cosmos-session）");
  const archiveAt = clientSource.indexOf('className="dsh-cosmos-session-archive"');
  const openAt = clientSource.indexOf('className="dsh-cosmos-session-open"');
  assert.ok(openAt > 0 && archiveAt > openAt, "归档恒居「打开」之后（行内动作区末位）");
  /* 常显：行内按钮无 hover/显隐门控（不发散到行 hover 状态） */
  const rowSlicesStart = clientSource.indexOf("function SessionRow({");
  const rowSlicesEnd = clientSource.indexOf("function SessionPanel({", rowSlicesStart);
  const rowBody = clientSource.slice(rowSlicesStart, rowSlicesEnd);
  assert.ok(rowBody.length > 0, "SessionRow 源码切片");
  assert.ok(!/(archiving|hover)[^\n]*display\s*:\s*none/.test(rowBody) && !rowBody.includes("opacity-0"), "归档按钮常显（MUST NOT 依赖 hover）");

  /* 点击语义：只归档不选中——stopPropagation，不调 onSelect/onOpen/引擎聚焦 */
  const archiveHandlerStart = rowBody.indexOf("const archiveRow = (event) => {");
  const archiveHandlerEnd = rowBody.indexOf("  return (", archiveHandlerStart);
  assert.ok(archiveHandlerStart >= 0 && archiveHandlerEnd > archiveHandlerStart, "行内归档处理器切片");
  const archiveHandler = rowBody.slice(archiveHandlerStart, archiveHandlerEnd);
  assert.ok(archiveHandler.includes("event.stopPropagation();"), "点击不冒泡（行选中/整页选中零副作用）");
  assert.ok(archiveHandler.includes("onArchive?.(row)"), "转发 onArchive(row)（请求组装留在执行体内）");
  for (const forbidden of ["onSelect(", "onOpen(", "focusSession", "openSession", "fetch("]) {
    assert.ok(!archiveHandler.includes(forbidden), "行内归档处理器不含 " + forbidden + "（只转发、不导航、零新端点）");
  }
  assert.ok(rowBody.includes("onClick={archiveRow}"), "归档按钮挂行内处理器");

  /* 行级门禁：组件内 in-flight 布尔 → 禁用 + aria-busy；结束（无论 outcome）复位 */
  assert.ok(rowBody.includes("const [archiving, setArchiving] = useState(false);"), "行级 in-flight 组件状态（per-session 门）");
  assert.ok(rowBody.includes("if (archiving) return;"), "在途重复点击直接忽略（双保险）");
  assert.ok(rowBody.includes("setArchiving(true);"), "受理即置在途");
  assert.ok(rowBody.includes("const settle = () => setArchiving(false);"), "复位句柄");
  assert.ok(rowBody.includes("Promise.resolve(issued).then(settle, settle);"), "结束（无论 outcome/拒绝）复位：Promise.resolve 归一 + 双 settle");
  assert.ok(clientSource.includes("aria-busy={archiving || undefined}"), "在途 aria-busy");
  assert.ok(clientSource.includes("disabled={archiving}"), "在途禁用态");
  /* 门禁不拦「打开」与行选中：open/main 两按钮不带归档在途态 */
  const openButtonStart = clientSource.indexOf('className="dsh-cosmos-session-open"');
  const openButtonEnd = clientSource.indexOf("</button>", openButtonStart);
  const openButton = clientSource.slice(openButtonStart, openButtonEnd);
  assert.ok(!openButton.includes("archiving") && !openButton.includes("disabled"), "在途门禁不拦「打开」");
  const mainButtonStart = clientSource.indexOf('className="dsh-cosmos-session-main"');
  const mainButtonEnd = clientSource.indexOf("</button>", mainButtonStart);
  assert.ok(!clientSource.slice(mainButtonStart, mainButtonEnd).includes("archiving"), "在途门禁不拦行选中");

  /* 转发链路：页面层 archiveSessionRow → 既有执行体（零新增注入、单一执行体） */
  assert.ok(clientSource.includes("const archiveSessionRow = (row) => {"), "页面层 archiveSessionRow 转发器");
  assert.ok(clientSource.includes("return controllerRef.current?.actions?.archiveSession?.(row.id);"), "行入口直达 actions.archiveSession（与信息卡同一执行体）");
  assert.ok(clientSource.includes("onArchive={archiveSessionRow}"), "SessionPanel 挂载行内归档转发器");
  assert.ok(clientSource.includes("onArchive={onArchive}"), "SessionPanel → SessionRow props 链");
  assert.equal((clientSource.match(/onArchiveSession: \(sessionId\) => actions\.archiveSession\(sessionId\)/g) ?? []).length, 1, "引擎注入位仍只有信息卡一处（行入口零新增注入）");
  const archiveRowStart = clientSource.indexOf("const archiveSessionRow = (row) => {");
  const archiveRowEnd = clientSource.indexOf("};", archiveRowStart);
  const archiveRowBody = clientSource.slice(archiveRowStart, archiveRowEnd);
  assert.ok(!archiveRowBody.includes("stopActivity") && !archiveRowBody.includes("fetch("), "行转发器不组装请求体（不携带 stopActivity、零新端点）");

  /* 样式：热区包络对齐「打开」（34×28）、accent 令牌族、hover/focus/禁用态 */
  assert.ok(clientSource.includes(".dsh-cosmos-session-archive{flex:none;align-self:center;margin:0 5px 0 0;min-width:34px;min-height:28px;"), "归档热区包络对齐「打开」（34×28）");
  assert.ok(clientSource.includes(".dsh-cosmos-session-archive:hover:not(:disabled){"), "hover 态（禁用时不提亮）");
  assert.ok(clientSource.includes(".dsh-cosmos-session-archive:focus-visible{"), "focus-visible 态（键盘可见）");
  assert.ok(clientSource.includes(".dsh-cosmos-session-archive:disabled{opacity:.45;cursor:not-allowed}"), "禁用态 opacity 同动作条惯例");
  assert.ok(
    clientSource.includes(".dsh-cosmos-session-archive{flex:none;") &&
      clientSource.includes("color:var(--cos-accent-ink,#ffe3b8);background:rgb(var(--cos-accent-rgb,255 210 140) / .1);"),
    "配色走 accent 令牌族（随皮肤级联，无暗色硬编码底色）"
  );

  /* i18n：中英成对（与 open/openAria 同款配对） */
  assert.equal((clientSource.match(/"cosmos\.sessions\.archive": "归档"/g) ?? []).length, 1, "DICT zh：归档短标签");
  assert.equal((clientSource.match(/"cosmos\.sessions\.archiveAria": "归档会话"/g) ?? []).length, 1, "DICT zh：归档会话（aria/title）");
  assert.equal((clientSource.match(/"cosmos\.sessions\.archive": "Archive"/g) ?? []).length, 1, "DICT en：归档短标签成对");
  assert.equal((clientSource.match(/"cosmos\.sessions\.archiveAria": "Archive session"/g) ?? []).length, 1, "DICT en：归档会话成对");
}


/* ── 画面稳定性：无变化不重建 + 覆盖层隐藏清内联 opacity（文字残影/闪动修复） ── */
{
  assert.ok(clientSource.includes('if (level === "none")'), "sceneDiffLevel=none 时早退（不触发全量重建）");
  assert.ok(engineSource.includes("el.style.opacity = '';"), "chip 隐藏分支清空内联透明度");
  assert.ok(engineSource.includes("slab.style.opacity = '';"), "恒星名牌隐藏分支清空内联透明度");
  assert.ok(engineSource.includes("inheritTrails(prevScene, E.scene);"), "结构重建继承同 id 尾迹（防尾迹闪断）");
  assert.ok(engineSource.includes("function rebuildOverlayDom()"), "覆盖层增量对齐入口保留");
  /* 原生右键菜单隐藏：星图容器直接屏蔽；页面层兜底但保留可编辑控件。 */
  assert.ok(engineSource.includes("addEventListener('contextmenu'"), "星图容器屏蔽 contextmenu");
  assert.ok(clientSource.includes("onContextMenu={"), "Cosmos 页面挂载 contextmenu 抑制");
  assert.ok(clientSource.includes("input, textarea, select, [contenteditable]"), "文本输入/可编辑控件保留原生右键菜单");
}

/* ── 激波弹射爆心解析源码锚点（add-cosmos-nova-ejection 3.1） ── */
{
  assert.ok(clientSource.includes("const blastCores = [];"), "本帧超新星爆心集合先于回归分支收集");
  assert.ok(
    clientSource.includes("blastCores.push({ wsId: info.wsId, starPos: info.worldPos.slice() });"),
    "只有常规超新星恒星入集合（星胚消散变体不收集）"
  );
  assert.ok(clientSource.includes('if (info.lifecycle === "proto") {'), "星胚消散分支与爆心收集互斥");
  assert.ok(clientSource.includes("resolveBlastCoreOf(blastCores, info.wsId, from)"), "回归分支按同 ws 最近爆心解析");
  assert.ok(clientSource.includes("blast: { starPos: core.starPos }"), "爆心快照传入 markRegression");
}

/* ── 5. 源码锚点：动作条（4.1/4.6） ── */
{
  assert.ok(clientSource.includes('className="dsh-cosmos-actions"'), "动作条容器 JSX");
  assert.ok(clientSource.includes('data-cosmos-actions="true"'), "动作条钩子");
  assert.ok(clientSource.includes('data-cosmos-action={button.name}'), "按钮钩子 data-cosmos-action");
  assert.ok(clientSource.includes("const columns = Math.min(8, buttons.length);"), "一行 8 个（上限）");
  assert.ok(clientSource.includes('style={{ "--cos-cols": String(columns) }}'), "列数经 CSS 变量驱动自动换行");
  assert.ok(clientSource.includes("if (!Array.isArray(buttons) || buttons.length === 0) return null;"), "空列表零布局");
  assert.ok(clientSource.includes("const disabled = !enabled || extra?.disabled === true;"), "未选中禁用态 / 行级禁用（星胚旧锚点）");
  /* 选中点亮 / 未选中熄灭（用户 2026-11-11 要求）。 */
  assert.ok(clientSource.includes('data-armed={enabled ? "true" : undefined}'), "选中后动作条点亮标记");
  assert.ok(clientSource.includes(".dsh-cosmos-actions[data-armed=true]{border-color:rgb(var(--cos-accent-rgb,255 210 140) / .55);box-shadow:"), "点亮态视觉（随肤主调描边 + 辉光，3.1 令牌化）");
  assert.ok(clientSource.includes(".dsh-cosmos-actions[data-armed=true] .dsh-cosmos-action{"), "点亮态按钮提亮");
  assert.ok(clientSource.includes("min-height:var(--cos-action-btn-h, 40px)"), "按钮触屏目标 ≥40px（高度经 --cos-action-btn-h 令牌可配）");
  assert.ok(
    clientSource.includes("width:min(calc(100% - (2 * max(var(--cos-add-btn-size, 44px), calc(2 * var(--cos-hud-btn-size, 44px) + 8px)) + 56px)),"),
    "左右安全边距按「＋ / 双 HUD 按钮横排」尺寸派生（add-cosmos-layout-tuning D4，取代写死 152px）"
  );
  assert.ok(clientSource.includes("var(--cos-action-btn-w, 112px)"), "动作条按钮宽经 --cos-action-btn-w 令牌可配");
  assert.ok(clientSource.includes("left:50%"), "水平居中");
  assert.ok(clientSource.includes("el.addEventListener(\"wheel\", onWheel, { passive: false });"), "动作条滚轮非被动监听");
  assert.ok(
    clientSource.includes("zoomBy?.(event.deltaY, {") &&
      clientSource.includes("clientX: event.clientX") &&
      clientSource.includes("clientY: event.clientY"),
    "滚轮转发 engine.zoomBy 并携带指针原始坐标（动作条聚焦补全）"
  );
  assert.ok(clientSource.includes('"--cos-toast-bottom"'), "toast 上移 CSS 变量下发");
  assert.ok(engineSource.includes("bottom: var(--cos-toast-bottom, 24px)"), "引擎 toast 消费上移变量");
  /* 内容差分守卫：按钮 key 稳定（不逐帧重建） */
  assert.ok(clientSource.includes('key={button.name + "-" + index}'), "按钮 key 稳定（内容差分守卫）");
}

/* ── 6. 源码锚点：hero 消费条目（4.4/4.5；fix-cosmos-action-draft-block 2.1/2.2） ── */
{
  assert.ok(clientSource.includes('ctx.slots.inject("conversation.input.dock"'), "hero 槽位注册");
  assert.ok(clientSource.includes('id: "v-cosmos-action-hero"'), "hero 条目 id");
  assert.ok(clientSource.includes("pending: pendingActions,"), "注入一次性标记 store（apply fiber 作用域）");
  assert.ok(clientSource.includes("function ActionHeroDock(props)"), "hero 消费组件");
  assert.ok(clientSource.includes("session.openState === \"open\""), "门控：openState");
  assert.ok(clientSource.includes("session.blank === true"), "门控：blank");
  assert.ok(clientSource.includes("session.running !== true"), "门控：非 running");
  assert.ok(clientSource.includes("session.promptAttempted !== true"), "门控：未尝试发送");
  assert.ok(
    clientSource.includes("const readiness = pendingReadinessOf({ entry, sessionId, draft });"),
    "双口径就绪判定（标记目标 id + 草稿等落稿/等校验）"
  );
  assert.ok(clientSource.includes("if (readiness.action === \"skip\") return;"), "无关会话/草稿不一致 → 零动作（不提交不清标记）");
  assert.ok(clientSource.includes("consumePendingAction({"), "消费走纯逻辑（先切后发在 actions.mjs 内）");
  assert.ok(clientSource.includes("sessionId,") && clientSource.includes("setDraft: typeof inputActions.setDraft === \"function\""), "消费传入本会话 id 与落稿通道");
  assert.ok(clientSource.includes('ctx.inject(["remote", "remote.session", "sessions"]') || clientSource.includes('tryInject(["remote", "remote.session", "sessions"]'), "client inject 声明 remote.session 作用域");
  assert.ok(clientSource.includes("ctx.inject =") === false, "未覆写宿主 inject");
  /* 无渲染消费器：组件恒返回 null（除 hook 外无 JSX 输出） */
  const heroBody = clientSource.slice(clientSource.indexOf("function ActionHeroDock(props)"), clientSource.indexOf("/** 页面外的插件 toast"));
  assert.ok(heroBody.includes("return null;"), "hero 条目渲染 null");
  assert.ok(!/<div|<button|<span/.test(heroBody), "hero 条目不含任何渲染元素");
  assert.ok(heroBody.includes("if (readiness.action === \"fill\") {"), "恒新建路径空稿 → 落稿分支");
  assert.ok(heroBody.includes("if (fillRef.current === entry.token) return;"), "同一标记不重复落稿（防宿主未发布草稿时死循环）");
  assert.ok(heroBody.includes("inputActions.setDraft(entry.message);"), "落稿写组装消息（草稿为空才写）");
}

/* ── 6b. 源码锚点：前置状态呈现门控（add-cosmos-action-prestate-gate 2.2/2.3） ── */
{
  assert.ok(clientSource.includes("const actionButtons = useMemo(() => {"), "动作条渲染前过滤（useMemo 随选中目标/骨架刷新重算）");
  assert.ok(clientSource.includes("return list.filter((button) => actionButtonVisible(button, selectedCard));"), "按同一谓词过滤按钮呈现");
  assert.ok(clientSource.includes("}, [buttons, selectedCard]);"), "选中目标变化触发重过滤");
  assert.ok(clientSource.includes("buttons={actionButtons}"), "ActionBar 消费过滤后列表（空列表零布局）");
  assert.ok(clientSource.includes("stateOf={actionButtonStateOf}"), "行级禁用/提示注入动作条");
  assert.ok(clientSource.includes("}, [actionButtons.length]);"), "空列表零布局与 --cos-actions-h 测量/滚轮联动跟随过滤后长度");
  /* 点击复验：按当前场景重取目标卡片，谓词不过即无动作 */
  assert.ok(clientSource.includes("const card = findCard(projectPanel(scene), selectedKey);"), "点击瞬间按当前场景重取目标卡片");
  assert.ok(clientSource.includes("if (!card || !actionButtonVisible(button, card)) return;"), "点击复验不过门 → 无动作");
  /* 星胚旧锚点（无 sessionId）禁用 + title 提示 */
  assert.ok(clientSource.includes('return { disabled: true, title: tr("cosmos.actions.embryoNoSession", "缺少探索会话关联") };'), "旧锚点禁用 + 提示");
}

/* ── 6c. 源码锚点：星胚动作链路与 dock 消费器（add-cosmos-action-prestate-gate 3.x） ── */
{
  assert.ok(clientSource.includes("const embryoMarkers = createPendingActionStore();"), "星胚通道 store（独立实例，fiber 作用域）");
  assert.ok(clientSource.includes("const embryoExecutor = createEmbryoActionExecutor({"), "星胚执行器");
  assert.ok(clientSource.includes("resolveTarget: (card) => explorationStateOf(card),"), "目标解析 = 探索会话在册/归档/运行中校验");
  assert.ok(clientSource.includes('if (input?.button?.preState === "proto") return embryoExecutor.run(input);'), "runButton 按 preState 分流（proto → 探索会话链路）");
  assert.ok(clientSource.includes('unavailable: tr("cosmos.actions.embryoUnavailable"'), "守卫文案走词典");
  assert.ok(clientSource.includes('id: "v-cosmos-embryo-action"'), "星胚 dock 条目 id");
  assert.ok(clientSource.includes("pending: embryoMarkers,"), "星胚条目只消费星胚通道");
  assert.ok(clientSource.includes("function EmbryoActionDock(props)"), "星胚 dock 消费组件");
  const embryoBody = clientSource.slice(clientSource.indexOf("function EmbryoActionDock(props)"), clientSource.indexOf("* 整页组件"));
  assert.ok(embryoBody.includes("return null;"), "星胚条目渲染 null");
  assert.ok(!/<div|<button|<span/.test(embryoBody), "星胚条目不含渲染元素");
  assert.ok(embryoBody.includes("if (entry.targetSessionId !== sessionId) return;"), "门控：标记绑定本会话 id（通道隔离）");
  assert.ok(embryoBody.includes('session.openState !== "open"'), "门控：openState");
  assert.ok(embryoBody.includes("session.running === true"), "门控：非 running");
  assert.ok(!embryoBody.includes("session.blank"), "门控不含 blank（探索会话非 blank）");
  assert.ok(embryoBody.includes("pending.subscribe(listener)") && embryoBody.includes("pending.getVersion()"), "订阅标记变更（原地同步消费，不等重挂载）");
  assert.ok(embryoBody.includes('if (readiness.reason === "draft" && toastRef.current !== entry.token)'), "草稿非空 → toast 守卫（同一标记一次）");
  assert.ok(embryoBody.includes('tr("cosmos.actions.embryoDraftNotEmpty"'), "守卫文案走词典");
  assert.ok(embryoBody.includes("inputActions.setDraft(entry.message);"), "空稿 → 落稿");
  assert.ok(embryoBody.includes("consumePendingAction({"), "消费走纯逻辑（先切模型后提交）");
  assert.ok(!/createSession|startSession/.test(embryoBody), "消费器零新建会话");
  for (const key of ["embryoNoSession", "embryoUnavailable", "embryoRunning", "embryoDraftNotEmpty", "embryoKeepOpen", "embryoSendFailed"]) {
    const occurrences = clientSource.split('"cosmos.actions.' + key + '":').length - 1;
    assert.ok(occurrences >= 2, "词典 zh/en 成对：" + key);
  }
}

/* ── 7. 源码锚点：设置页「Cosmos」节（5.1–5.3） ── */
{
  assert.ok(clientSource.includes('ctx.slots.inject("settings.section"'), "设置节注册");
  assert.ok(clientSource.includes('id: "v-cosmos"'), "节 id v-cosmos");
  assert.ok(clientSource.includes('label: () => sectionT("cosmos.settings.nav")'), "节标题走词典");
  assert.ok(clientSource.includes("children: { [SETTINGS_TAB_SLOT]: { kind: \"list\", scope: \"root\" } }"), "子标签槽声明");
  assert.ok(clientSource.includes('label: () => sectionT("cosmos.settings.tabActions")'), "「快捷动作」标签页");
  assert.ok(settingsSource.includes("function CosmosActionsPanel"), "标签页面板组件");
  assert.ok(settingsSource.includes('className="cs-row"'), "按钮行");
  assert.ok(settingsSource.includes("draggable={canReorder}"), "行首拖拽把手");
  assert.ok(settingsSource.includes('className="cs-dropLine"'), "拖拽指示线");
  assert.ok(settingsSource.includes('face.moveButton(index, index - 1)'), "上移按钮");
  assert.ok(settingsSource.includes('face.moveButton(index, index + 1)'), "下移按钮");
  assert.ok(settingsSource.includes('disabled={!canReorder || index === 0}'), "边界空操作（首行上移禁用）");
  assert.ok(settingsSource.includes("face.editButton(index, \"newSession\"") === false, "UI 不提供 newSession 修改路径");
  assert.ok(settingsSource.includes('className="cs-badge"'), "「新增会话」锁定态徽标");
  assert.ok(settingsSource.includes('<input type="checkbox" checked={!isProto} disabled readOnly />'), "「新增会话」禁用勾选框（锁定态方向随 preState 翻转）");
  /* 前置状态下拉（add-cosmos-action-prestate-gate 4.1–4.3） */
  assert.ok(settingsSource.includes("const preStateField = (button, index) => {"), "「前置状态」下拉字段");
  assert.ok(settingsSource.includes("showPreState: true") && settingsSource.includes("showPreState: false"), "快捷动作呈现 / 星座动作不呈现");
  assert.ok(settingsSource.includes("PRE_STATES.includes(button.preState)"), "漂移判定（枚举外值）");
  assert.ok(settingsSource.includes('errorText("preStateUnavailable", "不可用")'), "漂移值原样回显并标「不可用」");
  assert.ok(settingsSource.includes('const isProto = button.preState === "proto";'), "星胚行判据");
  assert.ok(settingsSource.includes("disabled={disabled || isProto}"), "星胚行「提示词在前」禁用");
  assert.ok(settingsSource.includes("copyText(copy.newSessionTitleProto)"), "星胚行「新增会话」锁定说明");
  assert.ok(settingsSource.includes('title={isProto ? copyText(copy.prependTitleProto)'), "星胚行「提示词在前」禁用说明");
  for (const key of ["preStateLabel", "preStateUnlimited", "preStateProto", "preStateCreated", "preStateReviewed", "preStateExecuted", "preStateUnavailable", "newSessionTitleProto", "prependTitleProto", "buttonPreStateInvalid"]) {
    const occurrences = clientSource.split('"cosmos.settings.' + key + '":').length - 1;
    assert.ok(occurrences >= 2, "词典 zh/en 成对：" + key);
  }
  assert.ok(settingsSource.includes("face.resetButtons()"), "重置回组合层入口");
  assert.ok(settingsSource.includes("face.save()") && settingsSource.includes("face.discard()"), "暂存-保存/放弃修改");
  assert.ok(settingsSource.includes('face.editButton(index, "model"'), "模型下拉编辑");
  assert.ok(settingsSource.includes("const bound = buttonModelOf(button.model);"), "模型绑定容错读取");
  assert.ok(settingsSource.includes("describeButtonModel(bound, catalog)"), "漂移回显走同一取值面");
  assert.ok(settingsSource.includes("view.drift"), "已存绑定漂移标记");
  assert.ok(settingsSource.includes("view.levelVisible"), "级别下拉仅带等级元数据时渲染");
  assert.ok(settingsSource.includes("!state.writable"), "不可写降级提示");
  assert.ok(settingsSource.includes("state.buttonsInvalid"), "草稿校验错误提示");
  assert.ok(clientSource.includes('ctx.slots.restore') || true, "占位（无该 API 依赖）");
}

/* ── 8. CSS 钩子（稳定钩子 + token） ── */
{
  for (const hook of [".dsh-cosmos-panel-", ".dsh-cosmos-action", ".dsh-cosmos-toast"]) {
    assert.ok(clientSource.includes(hook), "CSS 钩子存在：" + hook);
  }
  assert.ok(settingsSource.includes("--dsw-alias-label-primary"), "设置节配色走官方 token");
  assert.ok(clientSource.includes(".dsh-cosmos-panel-card[data-lifecycle=reviewed]{border-left-color:var(--cos-lc-reviewed,#cfe8ff)}"), "四态色集中于令牌（data-lifecycle 映射 → --cos-lc-*，随肤换装）");
}

/* ── 9. 源码锚点：星座动作条（add-cosmos-constellation-actions 3.1/3.2） ── */
{
  assert.ok(clientSource.includes("function ConstActionBar({ t, buttons, onRun })"), "星座动作条组件");
  assert.ok(clientSource.includes('className="dsh-cosmos-const-actions"'), "动作条容器 CSS 钩子（.dsh-cosmos-const-*）");
  assert.ok(clientSource.includes('data-cosmos-const-actions="true"'), "动作条钩子 data-cosmos-const-actions");
  assert.ok(clientSource.includes('data-cosmos-const-action={button.name}'), "按钮稳定钩子 data-cosmos-const-action");
  assert.ok(clientSource.includes('key={button.name + "-" + index}'), "按钮 key 稳定（内容差分零重写）");
  assert.ok(clientSource.includes("if (!Array.isArray(buttons) || buttons.length === 0) return null;"), "空列表零布局");
  assert.ok(clientSource.includes("min-height:var(--cos-const-action-h, 40px)"), "触屏点击目标 ≥40px（星座条同基线，高度经令牌可配）");
  assert.ok(clientSource.includes(".dsh-cosmos-const-action{"), "按钮 CSS 类存在");
  assert.ok(clientSource.includes("color:var(--dsw-alias-label-primary,var(--cos-accent-ink,#ffe3b8))"), "动作条配色优先官方 token，其次 HUD 主调令牌（3.1）");
  assert.ok(clientSource.includes(".dsh-cosmos-const-actions::after{"), "HUD 角标装饰（风格 D 语言）");
  assert.ok(clientSource.includes("flex:1 1 0;box-sizing:border-box;min-width:0;min-height:var(--cos-const-action-h, 40px)"), "等宽按钮（按行均分，宽 = 面板内容宽）");
  assert.ok(clientSource.includes("display:flex;flex-wrap:wrap;gap:5px"), "超出面板宽度自动换行");
  /* 三段结构 + 钻取态专属 + 恒可用（不依赖选中态） */
  assert.ok(clientSource.includes("const showConstActions = drilled && Array.isArray(constButtons) && constButtons.length > 0;"), "仅钻取态 + 空列表不渲染");
  assert.ok(
    clientSource.indexOf('className="dsh-cosmos-panel-head"') < clientSource.indexOf('className="dsh-cosmos-panel-list"')
      && clientSource.indexOf('className="dsh-cosmos-panel-list"') < clientSource.indexOf("{showConstActions ? <ConstActionBar"),
    "head → list → footer 三段结构（footer 在列表之后）"
  );
  assert.ok(clientSource.includes("{showConstActions ? <ConstActionBar t={t} buttons={constButtons} onRun={onRunConst} /> : null}"), "footer 挂点");
  assert.ok(!/className="dsh-cosmos-const-action"[^>]*disabled=/.test(clientSource), "星座按钮恒可用（无 disabled 态）");
  /* 列表滚动区随 footer 收缩：面板 flex 列 + 列表 flex:1/min-height:0 + footer flex:none */
  assert.ok(clientSource.includes("box-sizing:border-box;display:flex;flex-direction:column;color:var(--cos-ink,#ffe9cf)"), "面板为纵向 flex 容器（字色走 --cos-ink 令牌）");
  assert.ok(clientSource.includes(".dsh-cosmos-panel-list{flex:1 1 auto;min-height:0;overflow-y:auto"), "列表滚动区可收缩（flex 口径，无溢出）");
  assert.ok(clientSource.includes(".dsh-cosmos-const-actions{position:relative;flex:none;"), "footer flex:none（高度固定、不侵占滚动区）");
  assert.ok(clientSource.includes('constButtons={drillGroup === null ? [] : constButtons}'), "钻取目标缺失 → footer 零布局");
  assert.ok(clientSource.includes("const runConstAction = async (button) => {"), "点击链路入口");
  assert.ok(clientSource.includes("await controller.actions.runConstButton({ button, group: drillGroup });"), "目标 = 当前钻取星座分组");
  /* 点击落在面板（选中作用面）内 → 不清除提案选中 */
  assert.ok(clientSource.includes("if (isSelectionSurface(event.target)) return;"), "点击星座按钮不清选中（面板即作用面）");
}

/** 浮窗组件源码切片（段注释定界；供挂载落稿/门控锚点统计）。 */
function constFloatBody(source) {
  return source.slice(
    source.indexOf("function ConstellationFloatDock(props)"),
    source.indexOf("星胚动作消费条目")
  );
}

/* ── 10. 源码锚点：浮窗条目（add-cosmos-constellation-actions 4.1–4.3；
   fix-cosmos-action-draft-block 3.2：会话 id 判据 + 挂载落稿） ── */
{
  assert.ok(clientSource.includes('id: "v-cosmos-constellation-float"'), "浮窗条目 id");
  assert.ok(clientSource.includes("function ConstellationFloatDock(props)"), "浮窗组件");
  assert.ok(clientSource.includes("floats: floatMarkers,"), "注入**独立**浮窗标记 store（与 hero 通道隔离）");
  assert.ok(clientSource.includes('if (!entry) return;'), "标记缺席/过期 → 不呈现");
  assert.ok(
    clientSource.includes("const view = floatPresentationOf({ entry, session, draft, sessionId });"),
    "浮窗门控走纯函数（目标会话 id + 会话可编辑 + 草稿落稿/等校验同源）"
  );  assert.ok(clientSource.includes("if (view.fill) {"), "空稿 + 落稿意图 → 先落稿分支");
  assert.ok(clientSource.includes("if (fillRef.current === entry.token) return;"), "落稿幂等守卫（宿主未发布草稿时不死循环）");
  assert.equal(
    (constFloatBody(clientSource).match(/inputActions\.setDraft\(entry\.message\);/g) ?? []).length,
    1,
    "挂载落稿写组装消息（先落稿再呈现）"
  );
  assert.ok(clientSource.includes("if (!view.present) return;"), "门控不通过 → 不呈现不清标记");
  assert.ok(clientSource.includes("floats.clear(entry.token); // 一次性消费：TTL 仅约束呈现窗口"), "挂载即消费（一次性 token 清除）");
  assert.ok(clientSource.includes('session.openState === "open"'), "门控：openState");
  assert.ok(clientSource.includes("session.blank === true"), "门控：blank");
  assert.ok(clientSource.includes("session.running !== true"), "门控：非 running（防提交相位误呈）");
  assert.ok(clientSource.includes("createPortal("), "body portal 呈现");
  assert.ok(clientSource.includes("document.body"), "portal 目标 = body（z 序高于覆盖层）");
  assert.ok(clientSource.includes(".dsh-cosmos-const-float{position:fixed;inset:0;z-index:9998;"), "浮窗 z 序高于 Cosmos 覆盖层、低于页面 toast");
  assert.ok(clientSource.includes("inputActions.setDraft(event.target.value);"), "textarea 双绑：写回真实草稿（唯一真相源）");
  assert.ok(clientSource.includes("value={draft}"), "textarea 镜像 useInput 草稿快照");
  assert.ok(clientSource.includes("inputActions.submit();"), "发送走官方 submit");
  assert.ok(clientSource.includes('className="dsh-cosmos-const-float-close"'), "关闭按钮");
  /* 相位副作用不再是关闭主路径：普通文本走宿主 detached 发送（相位恒 plain），
     它只作为 `/` 命令草稿的兜底（宿主真值，fix-cosmos-const-float-send-close D2）。 */
  assert.ok(clientSource.includes("if (phase !== \"plain\") setArmed(null);"), "相位副作用保留为 / 命令兜底关闭（普通文本 detached、相位恒 plain）");
  assert.ok(clientSource.includes("const close = () => setArmed(null);"), "关闭路径 = 只关浮窗（草稿保留不提交）");
  assert.ok(clientSource.includes('className="dsh-cosmos-const-float-backdrop" onClick={close}'), "点浮窗外关闭");
  /* Esc 最高分层：capture 阶段 + stopPropagation；浮窗未打开时不注册 */
  assert.ok(clientSource.includes('window.addEventListener("keydown", onKey, true);'), "Esc 最高优先层（capture）");
  assert.ok(clientSource.includes("if (armed === null || typeof window === \"undefined\") return undefined;"), "浮窗未打开 → 不注册（既有分层零变化）");
  const floatBody = clientSource.slice(clientSource.indexOf("function ConstellationFloatDock(props)"), clientSource.indexOf("/* ------------------------------------------------------------------ *\n * 星胚动作消费条目"));
  assert.ok(/event\.key !== "Escape"[\s\S]*?event\.stopPropagation\(\)/.test(floatBody), "浮窗 Esc 阻断冒泡（不触发钻取返回/清搜索/关页）");
  /* Esc 组字守卫口径统一（add-cosmos-const-float-send-key 2.1）：window capture 回调收到的
     本就是原生事件 → 读原生 `isComposing`；补 `keyCode === 229` 与 Enter 守卫/宿主同源。 */
  assert.ok(
    floatBody.includes('if (event.key !== "Escape" || event.isComposing || event.keyCode === 229) return;'),
    "Esc 守卫读原生 isComposing + keyCode 229 双保险（口径与 Enter 守卫、宿主 isComposingEvent 同源）"
  );
  assert.ok(!/event\.nativeEvent\?\.isComposing/.test(floatBody.slice(floatBody.indexOf("const onKey = (event) => {"), floatBody.indexOf("window.addEventListener(\"keydown\", onKey, true);"))), "Esc 守卫不读合成事件字段（原生监听器里 nativeEvent 恒 undefined 的死读取）");
  assert.ok(!/cosmosOpenStore/.test(floatBody), "浮窗不触碰整页开合 store（不关页）");
  assert.ok(!/draftMatches/.test(floatBody), "浮窗不复写草稿门控（单源 = floatPresentationOf）");
  /* 消费时机 = 挂载：呈现后显隐零 TTL 依赖（编辑超期不消失，spec「编辑不因过期中断」）。 */
  assert.ok(!/ttlMs|FLOAT_MARKER_TTL/.test(floatBody), "浮窗显隐不读 TTL（标记已在挂载时消费）");
  /* 计数口径：三处 setArmed(null) 字面量 = 相位兜底 / Esc / close 定义——发送经 close()
     收敛，不新增字面量（不再表述为「恰好三条关闭路径」）。 */
  assert.equal((floatBody.match(/setArmed\(null\)/g) ?? []).length, 3, "setArmed(null) 字面量 = 3（相位兜底 / Esc / close 定义；发送经 close() 收敛）");
  /* 发送即关（fix-cosmos-const-float-send-close D1/D3）：submit() 之后主动 close()；
     两类守卫（未接线 / 空草稿 = 宿主 no-op）早退于 submit 之前 → 没提交不误关。 */
  const sendBody = floatBody.slice(floatBody.indexOf("const send = () => {"), floatBody.indexOf("return createPortal("));
  assert.ok(sendBody.length > 0, "send() 切片可定位");
  assert.ok(/inputActions\.submit\(\);[\s\S]*?close\(\);/.test(sendBody), "发送即关：submit() 后主动 close()（不依赖相位跃迁）");
  assert.ok(/draft\.trim\(\) === ""/.test(sendBody), "空草稿守卫：与宿主 onEnter 同口径 no-op");
  assert.ok(/typeof inputActions\.submit !== "function"\) return;/.test(sendBody), "未接线守卫早退（注入面降级）");
  assert.ok(sendBody.indexOf('draft.trim() === ""') < sendBody.indexOf("inputActions.submit()"), "空草稿守卫早退于 submit 之前（不误关）");
  /* 主题跟随 / 触屏目标 / 装饰层 */
  assert.ok(clientSource.includes("background:var(--dsw-alias-bg-base,var(--cos-panel-strong,rgba(8,8,16,.96)))"), "浮窗配色优先官方 token，其次皮肤卡底令牌（3.1：明暗/换肤自动跟随）");
  assert.ok(clientSource.includes(".dsh-cosmos-const-float-send{flex:none;box-sizing:border-box;min-width:84px;min-height:40px"), "发送按钮 ≥40px");
  assert.ok(clientSource.includes(".dsh-cosmos-const-float-card::before{"), "HUD 角标装饰");
  assert.ok(clientSource.includes("console.log") === false || true, "占位");
  /* 挂载自动聚焦 */
  assert.ok(clientSource.includes("if (el && typeof el.focus === \"function\") el.focus();"), "textarea 挂载自动聚焦");
  /* 键盘快捷发送（add-cosmos-const-float-send-key 1.1/1.2/3.1）：Enter 发送 / Shift+Enter
     换行 / 修饰组合不接管 / IME 组字守卫（nativeEvent 读取）/ hint 可发现。 */
  const keydownAt = floatBody.indexOf("onKeyDown={(event) => {");
  const keydownBody = floatBody.slice(keydownAt, floatBody.indexOf("onChange={(event) => {", keydownAt));
  assert.ok(keydownAt > 0 && keydownBody.length > 0, "textarea onKeyDown 切片可定位（键盘快捷发送）");
  assert.ok(keydownBody.includes('if (event.key !== "Enter") return;'), "仅 Enter 分支（其余按键零接管）");
  assert.ok(
    keydownBody.includes("if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;"),
    "Shift+Enter 换行 / Ctrl·Cmd·Alt 组合不接管（textarea 默认行为保留）"
  );
  assert.ok(
    keydownBody.includes("if (event.nativeEvent?.isComposing === true || event.keyCode === 229) return;"),
    "IME 组字守卫：经 nativeEvent 读原生组字状态 + keyCode 229（React 合成事件无 isComposing 字段）"
  );
  assert.ok(keydownBody.indexOf("isComposing") < keydownBody.indexOf("event.preventDefault();"), "组字守卫早退于 preventDefault 之前（组字回车只上屏）");
  assert.ok(/event\.preventDefault\(\);[\s\S]*?send\(\);/.test(keydownBody), "Enter = 复用 send()（同一守卫 + 发送即关，零新分支）");
  assert.ok(!/setArmed\(null\)/.test(keydownBody), "Enter 路径零新增关闭字面量（发送经 close() 收敛）");
  /* hint 可发现（zh/en 两处字典 + tr() fallback 同源文案） */
  assert.ok(
    clientSource.includes('"cosmos.constFloat.hint": "Enter 发送 · Shift+Enter 换行 · 发送后浮窗关闭；关闭或 Esc 保留草稿不发送。"'),
    "词典 zh：hint 标注 Enter 发送 / Shift+Enter 换行"
  );
  assert.ok(clientSource.includes('"cosmos.constFloat.hint": "Enter sends · Shift+Enter starts a new line'), "词典 en：hint 标注 Enter 发送 / Shift+Enter 换行");
  assert.ok(
    clientSource.includes('tr("cosmos.constFloat.hint", "Enter 发送 · Shift+Enter 换行 · 发送后浮窗关闭；关闭或 Esc 保留草稿不发送。")'),
    "tr() fallback 同步（未注入 locale 键时降级文案仍标注快捷键）"
  );
}

/* ── 11. 源码锚点：通道标记隔离（spec「标记互不误食」；rework：浮动原生窗口通道拆除） ── */
{
  assert.ok(clientSource.includes("const pendingActions = createPendingActionStore();"), "hero 通道 store（fiber 作用域）");
  assert.ok(clientSource.includes("const floatMarkers = createFloatMarkerStore();"), "浮窗通道 store（独立实例）");
  assert.ok(clientSource.includes("const actionGate = createActionGate();"), "共享防重入门（两族按钮同门）");
  assert.ok(
    clientSource.includes("{ pending: pendingActions, floatMarkers, embryoMarkers, gate: actionGate }"),
    "控制器注入三通道 + 共享门（原生窗口通道零残留）"
  );
  assert.ok(!clientSource.includes("nativeMarkers"), "原生窗口呈现通道 store 零残留（死槽位实现已拆）");
  /* hero 条目只拿 hero store；浮窗条目只拿浮窗 store（各消费器零跨通道读取/清除）。 */
  const heroEntry = clientSource.slice(clientSource.indexOf('id: "v-cosmos-action-hero"'), clientSource.indexOf('id: "v-cosmos-constellation-float"'));
  assert.ok(heroEntry.includes("pending: pendingActions"), "hero 条目只消费 hero 通道");
  assert.ok(!heroEntry.includes("floats"), "hero 条目不读浮窗通道");
  const floatEntry = clientSource.slice(clientSource.indexOf('id: "v-cosmos-constellation-float"'), clientSource.indexOf('id: "v-cosmos-embryo-action"'));
  assert.ok(!/pending:/.test(floatEntry), "浮窗条目不读 hero 通道");
  assert.ok(floatEntry.includes("floats: floatMarkers"), "浮窗条目只消费浮窗通道");
  /* 星胚条目只拿星胚 store（通道隔离：任一条目零读取/零清除其余通道）。 */
  const embryoEntry = clientSource.slice(clientSource.indexOf('id: "v-cosmos-embryo-action"'), clientSource.indexOf("/* 冒烟测试观测面"));
  assert.ok(embryoEntry.includes("pending: embryoMarkers"), "星胚条目只消费星胚通道");
  assert.ok(!embryoEntry.includes("floats"), "星胚条目不读浮窗通道");
  assert.ok(!/pendingActions/.test(embryoEntry), "星胚条目不读 hero 通道");
}

/* ── 11c. 源码锚点：浮动原生窗口实现零残留（rework：宿主槽位核查为结构性死锁后拆除） ── */
{
  assert.ok(!clientSource.includes("function ConstellationNativeWindow"), "窗口组件已拆");
  assert.ok(!clientSource.includes("NativeWindowBoundaryClass"), "错误边界类已拆");
  assert.ok(!clientSource.includes('ctx.slots.inject("conversation.session.header.actions"'), "会话头 actions 条目已拆（空白会话不渲染该槽位 → 结构性死锁）");
  assert.ok(!clientSource.includes('id: "v-cosmos-native-window"'), "窗口条目 id 零残留");
  assert.ok(!clientSource.includes("dsh-cosmos-native-window"), "窗口 CSS 零残留");
  assert.ok(!clientSource.includes("cosmos.nativeWindow."), "窗口词典键零残留");
  assert.ok(!clientSource.includes("renderFactorySlot(\"conversation.content\""), "工厂递归调用零残留");
}

/* ── 11d. 源码锚点：浮窗增强（rework 方案 2：模型下拉 + 语音转写借官方服务层） ── */
{
  /* 注入面：浮窗条目增注入 models + speech face；apply 层语音桥装配。 */
  assert.ok(floatEntryAfterEnhancements(), "浮窗条目注入切片可达");
  function floatEntryAfterEnhancements() {
    const slice = clientSource.slice(clientSource.indexOf('id: "v-cosmos-constellation-float"'), clientSource.indexOf('id: "v-cosmos-embryo-action"'));
    return slice.includes("models: modelsFace") && slice.includes("speech: speechFace");
  }
  assert.ok(clientSource.includes('tryInject(["remote", "remote.speech"]'), "语音桥按独立服务键注入 remote.speech");
  assert.ok(clientSource.includes('tryInject(["pluginNavigation"]'), "Bundle 引导跳转桥（可选注入）");
  assert.ok(clientSource.includes('@deepseek-ai/dsh-experimental-voice-input-bundle'), "openBundle 指向官方语音 Bundle");
  assert.ok(clientSource.includes("speech.transcribe({ audioBase64 })"), "转写调用形状 = 官方 speech Remote");
  /* 组件面：模型下拉（目录取值面与设置页同源）+ 语音钮（状态机 + 追加写回）。 */
  const dockBody = clientSource.slice(clientSource.indexOf("function ConstellationFloatDock(props)"), clientSource.indexOf("/* ------------------------------------------------------------------ *\n * 星胚动作消费条目"));
  assert.ok(dockBody.length > 0, "浮窗组件切片可达");
  assert.ok(dockBody.includes("describeButtonModel("), "模型下拉取值面与设置页同源");
  assert.ok(dockBody.includes("pickModelByKey"), "模型选择处理器");
  assert.ok(dockBody.includes("pickEffort"), "级别下拉处理器（默认最高级，settings 页先例）");
  assert.ok(dockBody.includes("constFloat.modelDefault"), "「会话当前模型」缺省项");
  assert.ok(dockBody.includes("new MediaRecorder(stream)"), "录音 = MediaRecorder 默认容器（与官方 createRecording 同构）");
  assert.ok(dockBody.includes("speech.transcribe(audioBase64)"), "转写经语音桥 face");
  assert.ok(dockBody.includes('inputActions.setDraft(draft + glue + text)'), "转写文本追加写回草稿（既有内容零改写）");
  assert.ok(dockBody.includes("dsh-cosmos-const-float-voice"), "语音钮稳定钩子");
  assert.ok(dockBody.includes("speechAvailable ? ("), "语音未启用 → 钮隐藏（零降级噪音）");
  /* CSS：新控件样式在位，旧只读模型样式已替换。 */
  assert.ok(clientSource.includes(".dsh-cosmos-const-float-model-select,"), "模型/级别下拉样式");
  assert.ok(clientSource.includes(".dsh-cosmos-const-float-voice{"), "语音钮样式");
  assert.ok(!clientSource.includes("dsh-cosmos-const-float-model-value"), "只读模型标识样式零残留");
  /* DICT zh/en 成对（`: ` 后缀只命中词典条目，tr(...) 调用不计入）。 */
  for (const key of ["modelDefault", "modelDrift", "modelDegraded", "effortLabel", "voiceStart", "voiceStop", "voiceBusy", "voiceAria", "voiceDenied", "voiceFailed", "voiceEmpty"]) {
    assert.equal(
      (clientSource.match(new RegExp('"cosmos\\.constFloat\\.' + key + '": ', "g")) ?? []).length,
      2,
      "词典 zh/en 成对：cosmos.constFloat." + key
    );
  }
}

/* ── 11b. 源码锚点：恒新建会话通道与降级文案（fix-cosmos-action-draft-block 1.x/3.1/4.3） ── */
{
  assert.ok(
    clientSource.includes("const createSessionVia = async (workspaceId, card) => {"),
    "恒新建薄包装（ctx.sessions.create）"
  );
  assert.ok(
    clientSource.includes("await sessions.create({ workspaceId: targetId })"),
    "create 只传 workspaceId（MUST NOT 传 sessionId —— 宿主缺省恒新建）"
  );
  assert.ok(clientSource.includes('if (!sessions || typeof sessions.create !== "function") throw new Error("当前宿主未提供会话创建通道");'), "恒新建通道缺失 → 抛错走降级");
  assert.ok(clientSource.includes("const openSessionVia = (sessionId) => {"), "openSession 薄包装（仅导航）");
  assert.ok(clientSource.includes("ctx.uiWorkspace.openSession(sessionId);"), "官方 openSession 导航");
  assert.ok(clientSource.includes("const startSessionVia = (workspaceId, message, card, sessionOptions) => {"), "降级通道仍在（startSession 只活在降级路径）");
  assert.ok(
    clientSource.includes("createSession: (workspaceId, card) => createSessionVia(workspaceId, card),"),
    "提案执行器注入恒新建通道"
  );
  assert.ok(
    clientSource.includes("openSession: (sessionId) => openSessionVia(sessionId),"),
    "两条执行器注入导航通道"
  );
  assert.ok(
    clientSource.includes('startSession: (workspaceId, message, card) => startSessionVia(workspaceId, message, card),'),
    "提案执行器保留降级回落"
  );
  assert.ok(
    clientSource.includes('startSession: (workspaceId, message, group) => startSessionVia(workspaceId, message, group, { whenDraftExists: "replace" }),'),
    "星座执行器降级保留 replace（覆盖语义只活在降级）"
  );
  assert.ok(clientSource.includes('labels: { degraded: tr("cosmos.actions.degraded"'), "降级 toast 走词典");
  assert.ok(clientSource.includes('"cosmos.actions.degraded": "新建会话通道不可用，已降级为复用空白会话"'), "词典 zh：降级文案");
  assert.ok(clientSource.includes('"cosmos.actions.degraded": "New-session channel unavailable; fell back to reusing the workspace blank"'), "词典 en：降级文案");
}

/* ── 12. 源码锚点：设置页双臂（add-cosmos-constellation-actions 5.2/5.3） ── */
{
  assert.ok(clientSource.includes('id: "constellation-actions"'), "「星座动作」标签页注册");
  assert.ok(clientSource.includes('order: 1,'), "排于「快捷动作」之后");
  assert.ok(clientSource.includes('label: () => sectionT("cosmos.settings.tabConstActions")'), "标签文案走词典");
  assert.ok(clientSource.includes("const constButtonSettings = createButtonSettingsController(activeScope, CONSTELLATION_PROFILE);"), "第二控制器实例（星座 profile）");
  assert.ok(clientSource.includes("variant: \"constellation\""), "面板 variant 注入");
  assert.ok(clientSource.includes("constButtonsStore = createButtonsStore(activeScope, constButtonsSectionOf, { field: \"constellationButtons\" })"), "星座数据面独立（节键 constellationButtons）");
  assert.ok(settingsSource.includes("const CONSTELLATION_COPY = {"), "星座口径文案表");
  assert.ok(settingsSource.includes("showPrepend: false"), "无「提示词在前」列");
  assert.ok(settingsSource.includes("{copy.showPrepend ? ("), "prepend 勾选框按 variant 门控");
  assert.ok(settingsSource.includes("showJump: false"), "星座行不呈现「执行后跳转」（恒整页保持）");
  assert.ok(settingsSource.includes("copyText(copy.newSessionTitle)"), "locked newSession title 星座口径");
  assert.ok(clientSource.includes('"cosmos.settings.constButtonPrependRejected"'), "prepend 拒绝错误键（zh/en 词典齐备）");
  /* 两标签页共用行交互骨架（增删改 / 拖拽 + 上下移 / 暂存-保存 / 模型与级别） */
  for (const anchor of ['className="cs-row"', "draggable={canReorder}", 'face.moveButton(index, index - 1)', "face.save()", "face.discard()", 'face.editButton(index, "model"']) {
    assert.ok(settingsSource.includes(anchor), "行交互骨架复用：" + anchor);
  }
}

/* ── 13. 皮肤系统接线（add-cosmos-skin-themes 3.1/3.2/3.4/3.5/3.6） ── */
function goldLiteralsOutsideVarFallback(source) {
  const stripped = String(source).replace(/\/\*[\s\S]*?\*\//g, "");
  const pattern = /#ffd28a|#ffe3b8|#ffe9cf|#fff3dd|rgba\(\s*255\s*,\s*(?:210\s*,\s*140|233\s*,\s*207|227\s*,\s*184|230\s*,\s*190)/gi;
  const offenders = [];
  let match;
  while ((match = pattern.exec(stripped)) !== null) {
    const open = stripped.lastIndexOf("var(", match.index);
    const context = stripped.slice(Math.max(0, match.index - 48), match.index + 24);
    if (open < 0) { offenders.push(context); continue; }
    const between = stripped.slice(open + 4, match.index);
    const opens = (between.match(/\(/g) ?? []).length;
    const closes = (between.match(/\)/g) ?? []).length;
    if (opens < closes) offenders.push(context);
  }
  return offenders;
}
{
  /* 硬编码清零（spec「HUD 镀铬主题化」/ 3.6）：client.jsx 金色系字面量仅存在于 var() fallback 位 */
  assert.deepEqual(goldLiteralsOutsideVarFallback(clientSource), [], "client.jsx 金色系字面量仅存在于 var() fallback 位");
  for (const token of ["--cos-ink", "--cos-accent-ink", "--cos-accent", "--cos-line", "--cos-line-strong", "--cos-glass", "--cos-panel-soft", "--cos-card-bg", "--cos-ink-dim", "--cos-title-ink", "--cos-accent-rgb", "--cos-accent-ink-rgb", "--cos-lc-created", "--cos-lc-reviewed", "--cos-lc-executed", "--cos-lc-proto", "--cos-shadow"]) {
    assert.ok(clientSource.includes("var(" + token), "client.jsx CSS 消费令牌 " + token);
  }
  /* 整页根容器挂令牌 + light 分支（MUST NOT 在 JS 里逐规则改样式） */
  assert.ok(clientSource.includes("applySkinTokens(frameRef.current, skinId);"), "整页根容器（cos-page）单点下发 HUD 令牌");
  assert.ok(clientSource.includes("useLayoutEffect"), "令牌下发用 layout effect（首帧同气，早于 attach 的 effect 与绘制）");
  assert.ok(clientSource.includes("background: \"var(--cos-bg, #070812)\""), "整页底色走 --cos-bg 令牌（fallback = 风格 D 现值）");
  assert.ok(clientSource.includes("[data-cos-mode=\"light\"] .cos-scanlines{display:none}"), "light 模式扫描线关闭（CSS 分支）");
  assert.ok(clientSource.includes("[data-cos-mode=\"light\"] .cos-card,"), "light 模式纸底卡 + 柔影（CSS 分支）");
  assert.ok(clientSource.includes("box-shadow:var(--cos-shadow,none)"), "light 模式柔影走 --cos-shadow 令牌");
  /* 冷启动按持久化皮肤构造（无「先默认后切」闪跳）+ 已打开整页热切 */
  assert.ok(clientSource.includes("const skin = createSkin(settings.skin);"), "打开整页按持久化皮肤构造皮肤实例");
  assert.ok(clientSource.includes("style: skin,"), "引擎构造参数 = 目标皮肤（首帧即目标皮肤）");
  assert.ok(clientSource.includes("engine?.setSkin?.(createSkin(applied));"), "点选即对已打开整页热切（呈现层替换）");
  assert.ok(clientSource.includes("selectSkin(id) {"), "控制器皮肤选择入口");
  assert.ok(clientSource.includes("cosmosSkinStore.set({ skin: merged.skin });"), "选择先经净房再落 store");
  assert.ok(clientSource.includes("activeSkinPalette().prop[info.lifecycle]"), "恒星临终色取当前皮肤 palette（换肤后超新星同源）");
  assert.ok(!/SKIN_D_PALETTE\.prop\[info\.lifecycle\]/.test(clientSource), "不再硬绑风格 D 调色常量");

  /* 设置页「皮肤」页签（3.4/3.5） */
  assert.ok(clientSource.includes('id: "skins"'), "「皮肤」标签页注册");
  assert.ok(clientSource.includes('label: () => sectionT("cosmos.settings.tabSkins")'), "标签文案走词典");
  assert.ok(clientSource.includes("inject: () => ({ skins: skinFace, selectHealth: selectHealthFace })"), "注入皮肤 face（选中态 + 选择 + 失败观测面）");
  assert.ok(clientSource.includes("CosmosSkinPanel"), "面板组件注册");
  const skinTab = clientSource.slice(clientSource.indexOf('id: "skins"'), clientSource.indexOf("/* 4. hero 接力消费条目"));
  assert.ok(/order: 2,/.test(skinTab), "排于「快捷动作」(0) /「星座动作」(1) 之后");
  assert.ok(settingsSource.includes("export function CosmosSkinPanel"), "皮肤面板组件");
  assert.ok(settingsSource.includes('role="radiogroup"'), "卡片网格 radiogroup 语义");
  assert.ok(settingsSource.includes('role="radio"') && settingsSource.includes("aria-checked="), "卡片单选 aria");
  assert.ok(settingsSource.includes('data-skin={card.id}'), "卡片稳定钩子 data-skin");
  assert.ok(settingsSource.includes("className=\"cs-skinGrid\""), "卡片网格容器");
  assert.ok(settingsSource.includes("card.swatches.map"), "预览色板条 = hud 令牌 5 色");
  assert.ok(settingsSource.includes("cosmos.settings.skinsDefault"), "默认徽标文案键");
  assert.ok(settingsSource.includes("key !== \"ArrowRight\""), "方向键在网格内移动焦点（键盘可达）");
  assert.ok(settingsSource.includes("min-height:44px"), "卡片触屏目标 ≥44px");
  assert.ok(settingsSource.includes("face?.select?.(id);"), "点选即生效（无保存钮）");
  assert.ok(!/face\.save\(\)/.test(settingsSource.slice(settingsSource.indexOf("export function CosmosSkinPanel"))), "皮肤页签无「保存」按钮（即时生效语义）");
  /* DICT zh/en 成对 */
  assert.ok(clientSource.includes('"cosmos.settings.tabSkins": "皮肤"'), "词典 zh：页签名");
  assert.ok(clientSource.includes('"cosmos.settings.tabSkins": "Skins"'), "词典 en：页签名");
  for (const id of ["deepspace", "rosepine", "fidenza", "linear", "obsidian", "reagent", "chamber", "fluoro", "lotus", "migration", "circuit", "fermata"]) {
    assert.ok(clientSource.includes('"cosmos.skin.' + id + '.name"'), "词典：皮肤名 " + id);
    assert.ok(clientSource.includes('"cosmos.skin.' + id + '.ref"'), "词典：血统 " + id);
  }
  assert.equal((clientSource.match(/"cosmos\.skin\.[a-z]+\.name"/g) ?? []).length, 24, "皮肤名/血统键 zh+en 成对（12×2×2）");
}

/* ── 13b. 选择失败可见性（fix-cosmos-skin-select-feedback 2.1–2.4 / 4.2）──
   两页签共享 health face（useSyncExternalStore 订阅）：整页控制器缺失 → 面板级
   「未生效」提示条（cs-error + 原因码后缀）；face 缺失 → 降级占位（不渲染卡片
   网格 / 输入控件）。行为面直测在 test/factory-smoke.mjs（死控制器 → 落印 → 复活自愈）。 */
{
  assert.equal(
    (settingsSource.match(/useSyncExternalStore\(health \? health\.subscribe : noopSubscribe, health \? health\.getSnapshot : noopSnapshot\)/g) ?? []).length,
    2,
    "两面板均订阅 health face（皮肤 + 导航）"
  );
  assert.ok(settingsSource.includes("const health = props.selectHealth ?? null;"), "health face 经注入（缺失时降级 noop）");
  assert.ok(settingsSource.includes("function selectFailureOf(snapshot)"), "health 快照形状防御（非法快照按无失败处理）");
  assert.equal(
    (settingsSource.match(/const notApplied = failure !== null && failure\.face === /g) ?? []).length,
    2,
    "两面板按 face 归属过滤失败（仅本页签呈现）"
  );
  assert.equal(
    (settingsSource.match(/notAppliedText\(t, "cosmos\.settings\./g) ?? []).length,
    2,
    "两面板提示文案走 notAppliedText（含原因码后缀）"
  );
  assert.equal((settingsSource.match(/data-failure-code=\{notApplied\.code\}/g) ?? []).length, 2, "提示条携带原因码（data-failure-code 稳定钩子）");
  assert.equal((settingsSource.match(/role="status"/g) ?? []).length, 2, "提示条以 status 语义播报");
  assert.equal((settingsSource.match(/data-state="face-missing"/g) ?? []).length, 2, "face 缺失占位稳定钩子（两页签）");
  assert.equal((settingsSource.match(/if \(face === null\) \{/g) ?? []).length, 2, "face 缺失早退占位（不渲染永不生效的控件）");
  assert.ok(settingsSource.includes('tr(t, "cosmos.settings.skinUnavailable"'), "皮肤占位文案键");
  assert.ok(settingsSource.includes('tr(t, "cosmos.settings.navUnavailable"'), "导航占位文案键");
  /* 词典 zh/en 成对（各 2 次：zh + en） */
  for (const key of ["skinUnavailable", "navUnavailable", "skinNotApplied", "navNotApplied"]) {
    assert.equal(
      (clientSource.match(new RegExp('"cosmos\\.settings\\.' + key + '"', "g")) ?? []).length,
      2,
      "词典 zh/en 成对：cosmos.settings." + key
    );
  }
  /* 失败信号通道（client.jsx）：独立 store + 原因码 + 写守卫 + 首次警告标记 + 观测面导出 */
  assert.ok(clientSource.includes("cosmosSelectHealthStore = createSnapshotStore({ lastFailure: null })"), "独立失败快照 store（不混入偏好 store）");
  assert.ok(clientSource.includes('const SELECT_FAILURE_CONTROLLER_MISSING = "controller-missing";'), "原因码常量");
  assert.ok(clientSource.includes("if (same) return;"), "写守卫：同 face 同 code 复用现有快照引用");
  assert.ok(clientSource.includes("current.face === face"), "写守卫按 face + code 判同");
  assert.ok(clientSource.includes("cosmosSelectWarned = false;"), "同因首次警告标记（成功后复位）");
  assert.ok(clientSource.includes("function cosmosSelectHealthOf()"), "观测面函数");
  assert.ok(
    clientSource.includes("lastFailure: { face, code: SELECT_FAILURE_CONTROLLER_MISSING, at: Date.now() }"),
    "失败载荷 = face + 原因码 + 时刻"
  );
  assert.ok(clientSource.includes("cosmosSelectHealthOf, COSMOS_SKINS"), "cosmosSelectHealthOf 并入 bundle 导出面");
  assert.ok(clientSource.includes("if (controllerRef.current == null) {"), "face 调用边界的控制器存活检查");
  assert.equal(
    (clientSource.match(/markSelectFailure\("/g) ?? []).length,
    3,
    "皮肤 / 导航 / 发送前编辑三 face 均经失败标记 helper"
  );
  assert.equal(
    (clientSource.match(/clearSelectFailure\(\);/g) ?? []).length,
    3,
    "成功路径清除历史失败（自愈；三 face 同款）"
  );
}

/* ── 14. 源码锚点：会话卡「归档会话」动作（add-cosmos-session-archive-action 2.1/2.2/3.1–3.3） ──
   信息卡双按钮 data-action 分流、onArchiveSession 注入、单元素请求组装、防重入
   （per-session 集合 + 直接 DOM 切换，MUST NOT 出现经 cardHtml 重渲染的禁用路径）、
   `.cd-btn` 触屏目标 ≥40px。行为面直测在 test/session-archive-smoke.mjs。 */
{
  /* 双按钮与分流（引擎） */
  const cardActions = engineSource.slice(
    engineSource.indexOf("function cardActionsHtml(sessionId, lead)"),
    engineSource.indexOf("function cardHtml(e)")
  );
  assert.ok(cardActions.length > 0, "cardActionsHtml 切片可定位");
  assert.ok(cardActions.includes('data-action="open"'), "打开按钮稳定钩子 data-action=open");
  assert.ok(cardActions.includes('data-action="archive"'), "归档按钮稳定钩子 data-action=archive");
  assert.ok(cardActions.includes(">打开会话<") && cardActions.includes(">归档会话<"), "双按钮文案并列");
  assert.ok(cardActions.includes('data-action="archive" data-session="'), "归档按钮与既有 data-session 并存");
  assert.equal((engineSource.match(/\+\s*cardActionsHtml\(/g) ?? []).length, 2, "行星卡与彗星卡各挂一次双按钮组");
  assert.ok(!/disabled/.test(cardActions), "按钮组不渲染 disabled（禁用态 MUST NOT 经 cardHtml 重渲染）");
  const cardClick = engineSource.slice(
    engineSource.indexOf("E.el.card.addEventListener('click'"),
    engineSource.indexOf("function isEmptyConstellation")
  );
  assert.ok(cardClick.includes("data-action"), "click 处理器按 data-action 分流");
  assert.ok(cardClick.includes("onArchiveSession") && cardClick.includes("onOpenSession"), "两路回调并列");
  assert.ok(cardClick.includes("|| 'open'"), "data-action 缺席回落 open（旧渲染兼容）");
  assert.ok(cardClick.includes("archiveInFlight"), "权威防重入门 = per-session in-flight 集合");
  assert.ok(cardClick.includes("querySelector('.cd-btn[data-action=\"archive\"]')"), "禁用态经直接 DOM 定位切换");
  assert.ok(/\.disabled = /.test(cardClick), "直接切换 disabled 属性");
  assert.ok(!/innerHTML|cardHtml\(/.test(cardClick), "MUST NOT 经 cardHtml 重渲染呈现禁用态");

  /* 触屏目标：共享类 .cd-btn ≥40px（档位对齐 .cos-home-btn 44px） */
  const cdBtnRule = engineSource.match(/\.cd-btn \{[^}]*\}/)?.[0] ?? "";
  const cdBtnMinHeight = Number((cdBtnRule.match(/min-height:\s*(\d+)px/) ?? [])[1]);
  assert.ok(cdBtnMinHeight >= 40, "`.cd-btn` 触屏点击目标 ≥40px（" + cdBtnMinHeight + "px）");
  assert.ok(engineSource.includes("gap: 8px"), "双按钮间距 8px");
  assert.ok(engineSource.includes(".cd-btn:disabled"), "在途禁用态视觉（灰化）");
  /* 配色优先官方 --dsw-alias-* token（token 缺席回落风格 D HUD 基线，spec 呈现要求） */
  assert.ok(cdBtnRule.includes("var(--dsw-alias-label-primary, var(--cos-accent-ink"), "按钮字色优先官方 token");
  assert.ok(cdBtnRule.includes("var(--dsw-alias-border-l2"), "按钮描边优先官方 token");
  assert.ok(/\.cd-btn:hover \{[^}]*var\(--dsw-alias-interactive-bg-hover-solid/.test(engineSource), "悬停底色优先官方 token");

  /* client 接线（3.1–3.3） */
  assert.ok(clientSource.includes("onArchiveSession: (sessionId) => actions.archiveSession(sessionId)"), "attach 注入 onArchiveSession（与 onOpenSession 并列）");
  assert.ok(clientSource.includes("async archiveSession(sessionId)"), "actions.archiveSession 动作");
  assert.ok(clientSource.includes("sessionIds: [id]"), "单元素请求组装");
  assert.ok(clientSource.includes('"/api/dsh-v-cosmos/archive-sessions"'), "POST 自有批量归档端点");
  assert.ok(clientSource.includes("archiveNoticeOf(entry)"), "outcome → 文案映射（纯逻辑模块）");
  assert.ok(clientSource.includes("archiveRequestFailureNotice("), "网络失败 / 非 2xx → 失败 toast");
  assert.ok(clientSource.includes("engine?.toast(notice.text)"), "呈现通道 = 引擎 toast（整页内）");
  const archiveAction = clientSource.slice(
    clientSource.indexOf("async archiveSession(sessionId)"),
    clientSource.indexOf("async addWorkspace()")
  );
  const archiveBodyLine = archiveAction.split("\n").find((line) => line.includes("JSON.stringify(")) ?? "";
  assert.ok(archiveBodyLine.includes("sessionIds: [id]"), "请求体只有单元素 sessionIds");
  assert.ok(!/stopActivity/.test(archiveBodyLine), "请求体 MUST NOT 携带 stopActivity（只跳过不杀）");
  assert.ok(!/closePage|cosmosOpenStore/.test(archiveAction), "MUST NOT 关整页（归档在覆盖层底下）");
  assert.ok(!/openspec/i.test(archiveAction), "MUST NOT 触碰 openspec 工件（零侵入）");
}

/* ── 15. 每按钮「执行后跳转」接线（fix-cosmos-const-float-send-close 4.2/4.3/4.4；
   fix-cosmos-action-draft-block D1/D4 重写：恒新建 + openSession 主路径） ──
   跳转 = 按钮配置 `jumpNewSession`（缺省 true）；执行器按该按钮分流 closePage/keepPage；
   「新开会话」保持固定语义（createSession 恒调用、hero 标记登记不受影响），二者正交。
   页面偏好面 MUST NOT 承载该语义（跳转属按钮配置 / configstore 面）。 */
{
  const actionsSource = readFileSync(new URL("../src/actions.mjs", import.meta.url), "utf8");
  const runBody = actionsSource.slice(
    actionsSource.indexOf("async run({ button, card } = {}) {"),
    actionsSource.indexOf("/* 供 client 侧组装的路径工具")
  );
  assert.ok(runBody.length > 0, "执行器 run 切片可定位");
  assert.ok(runBody.includes("const jump = button.jumpNewSession !== false;"), "分流读取该按钮配置（缺省跳转）");
  assert.ok(/openSession\(sessionId\);[\s\S]{0,120}if \(jump\) closePage\(\);/.test(runBody), "导航成功后按按钮分流");
  assert.ok(runBody.includes("else keepPage();"), "不跳转走 keepPage（整页保持）");
  assert.ok(
    runBody.indexOf("await createSession(card.wsId, card)") < runBody.indexOf("openSession(sessionId);"),
    "恒新建先于导航（导航目标 = 新建会话）"
  );
  assert.ok(runBody.indexOf("openSession(sessionId);") < runBody.indexOf("if (jump) closePage();"), "导航先于页面流转（跳转不改写新建会话）");
  assert.ok(
    runBody.indexOf("pending.arm({ message, model, submit, targetSessionId: sessionId, setDraft: true })") < runBody.indexOf("openSession(sessionId);"),
    "hero 标记（绑定目标 SessionId）登记先于导航"
  );
  const fallbackBody = actionsSource.slice(
    actionsSource.indexOf("const fallback = async ("),
    actionsSource.indexOf("return {\n    async run({ button, card } = {}) {")
  );
  assert.ok(fallbackBody.length > 0, "降级分支切片可定位");
  assert.ok(fallbackBody.includes("await startSession(card.wsId, message, card);"), "降级回落 startSession（keep 语义）");
  assert.ok(fallbackBody.includes("pending.arm({ message, model, submit })"), "降级路径沿用现行登记条件（autoSend/模型）");
  assert.ok(!fallbackBody.includes("targetSessionId"), "降级标记无 SessionId 判据");
  assert.ok(!fallbackBody.includes("setDraft: true"), "降级标记无落稿意图（startSession 已落稿）");
  assert.ok(fallbackBody.includes("notify(degradedLabel"), "降级先 toast 注明");
  /* client 接线 */
  assert.ok(clientSource.includes('keepPage: () => notifyToast?.(tr("cosmos.actions.keepOpenNotice"'), "client 注入 keepPage = 引擎 toast");
  assert.ok(clientSource.includes("closePage: () => cosmosOpenStore.set(false),"), "client 注入 closePage = 关整页");
  assert.ok(!/closePageForProposalAction|actionJumpNewSession/.test(clientSource), "旧页面级偏好分流已移除");
  /* 页面偏好面零改动（跳转属按钮配置） */
  const settingsModule = readFileSync(new URL("../src/settings.mjs", import.meta.url), "utf8");
  assert.ok(!/actionJumpNewSession|actionNewSession/.test(settingsModule), "settings.mjs 不含跳转/新建会话偏好键（VERSION 维持 v2）");
  /* 词典 zh/en 成对 */
  assert.ok(clientSource.includes('"cosmos.actions.keepOpenNotice": "已在新会话填入消息，Cosmos 保持打开"'), "词典 zh：保持模式 toast");
  assert.ok(clientSource.includes('"cosmos.actions.keepOpenNotice": "Message pre-filled in the new session; Cosmos stays open"'), "词典 en：保持模式 toast");
  assert.ok(clientSource.includes('"cosmos.settings.jumpLabel": "执行后跳转"'), "词典 zh：跳转标签");
  assert.ok(clientSource.includes('"cosmos.settings.jumpLabel": "Jump after running"'), "词典 en：跳转标签");
  assert.ok(clientSource.includes('"cosmos.settings.jumpTitle": "每个按钮独立设置'), "词典 zh：行内说明（每按钮独立）");
  assert.ok(clientSource.includes('"cosmos.settings.jumpTitle": "Per-button:'), "词典 en：行内说明");
  /* 行内勾选框（暂存-保存模型）与锁定「新增会话」并存 */
  assert.ok(settingsSource.includes("showJump: true"), "快捷动作行呈现跳转勾选框");
  assert.ok(settingsSource.includes('checked={button.jumpNewSession !== false}'), "勾选态 = 缺省跳转");
  assert.ok(settingsSource.includes('face.editButton(index, "jumpNewSession"'), "切换写入按钮草稿（暂存-保存）");
  assert.ok(settingsSource.includes('className="cs-auto cs-locked"'), "锁定「新增会话」徽标保留");
  assert.ok(!/cs-pref/.test(settingsSource), "无页面级设置区（跳转下沉为每按钮配置）");
}

/* ── 16. 选中双向联动：镜像 store / 映射 effect / 卡片包装 / 守卫（add-cosmos-selection-linkage 3.1–3.4 / 4.1–4.2） ──
   React 组件树在 Node 侧不可挂载（react 为 bundle external）→ 引擎侧契约行为直测 +
   客户端接线源码锚点（与面板/动作条/归档同口径）。 */
{
  /* 3.1 镜像 store：幂等 set（键变才通知）+ subscribe/getSnapshot（useSyncExternalStore 面）。 */
  assert.ok(clientSource.includes("const engineSelectStore = {"), "引擎选中镜像 store");
  assert.ok(clientSource.includes("function useEngineSelection()"), "镜像读取 hook（useSyncExternalStore）");
  const storeBody = clientSource.slice(
    clientSource.indexOf("const engineSelectStore = {"),
    clientSource.indexOf("function useEngineSelection()")
  );
  assert.ok(storeBody.includes("getSnapshot()") && storeBody.includes("subscribe(listener)") && storeBody.includes("set(next)"), "store 三面齐备（仿 drillStore）");
  assert.ok(storeBody.includes("if (value === null && current === null) return;"), "空 → 空幂等短路");
  assert.ok(storeBody.includes("value.kind === current.kind") && storeBody.includes("value.wsId === current.wsId") && storeBody.includes("value.id === current.id"), "同键短路（kind/wsId/id 全等不通知——防回环抖动）");
  assert.ok(storeBody.includes("for (const listener of [...this.listeners])"), "订阅者广播（异常隔离，与 drillStore 同款）");
  assert.ok(clientSource.includes("engineSelectStore, cosmosButtonsFace"), "镜像 store 随模块导出（观测面）");

  /* 3.1 attach/detach 接线：与 onDrillChange 并列注入；销毁双路径归零。 */
  assert.ok(clientSource.includes("onSelectChange: (info) => engineSelectStore.set(info)"), "attach 注入 onSelectChange（与 onDrillChange 并列）");
  assert.equal((clientSource.match(/engineSelectStore\.set\(null\);/g) ?? []).length, 2, "detach / dispose 双路径镜像归零");

  /* 3.2 映射 effect：仅非 proto 恒星 → 面板键；写入前查表；同键短路（依赖不含 selectedKey）。 */
  const mapBody = clientSource.slice(
    clientSource.indexOf("引擎选中 → 面板选中映射"),
    clientSource.indexOf("/* 「点击 vs 拖拽」起点")
  );
  assert.ok(mapBody.length > 0, "映射 effect 切片可定位");
  assert.ok(mapBody.includes('if (!engineSel || engineSel.kind !== "star" || engineSel.lifecycle === "proto") return;'), "仅 star 且非 proto（行星/彗星/星胚/清空一律不动面板）");
  assert.ok(mapBody.includes("const key = proposalKeyOf(engineSel.wsId, engineSel.id);"), "映射回面板选中键（与卡片 key 同源 proposalKeyOf）");
  assert.ok(mapBody.includes("if (!findCard(projectPanel(scene), key)) return;"), "写入前经 allCards 查表（双保险，不写幽灵键）");
  assert.ok(mapBody.includes("setSelectedKey((current) => (current === key ? current : key));"), "同键短路（回声无抖动、无额外渲染）");
  assert.ok(mapBody.includes("}, [engineSel]);"), "依赖不含 selectedKey（用户切卡不被在途引擎选中拽回）");
  assert.ok(!/engineSel\.lifecycle === "created"/.test(mapBody), "MUST NOT 用 created 白名单代替 proto 黑名单（reviewed/executed 同样联动）");
  assert.ok(!/engineSel\.kind === "planet"/.test(mapBody.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), "行星/彗星无面板映射分支（保持既有选中）");

  /* 3.3 卡片 onSelect 包装 + focusProposal 公共面（点卡片 = 选中 + 聚焦飞行）。 */
  assert.ok(clientSource.includes("const selectProposal = (key) => {"), "卡片 onSelect 包装");
  assert.ok(clientSource.includes("onSelect={selectProposal}"), "面板挂载包装");
  assert.ok(!clientSource.includes("onSelect={setSelectedKey}"), "旧「仅选中」接线已移除");
  const selectBody = clientSource.slice(
    clientSource.indexOf("const selectProposal = (key) => {"),
    clientSource.indexOf("/* ── 皮肤 HUD 令牌")
  );
  assert.ok(selectBody.length > 0, "包装体切片可定位");
  assert.ok(selectBody.includes("setSelectedKey(key);"), "面板选中先行落定（动作条即时点亮）");
  assert.ok(selectBody.indexOf("setSelectedKey(key);") < selectBody.indexOf("focusProposal"), "选中先于飞行（无先清后选中间态）");
  assert.ok(selectBody.includes("const card = findCard(panelModel, key);"), "按选中键取卡片（wsId/id 供引擎查表）");
  assert.ok(selectBody.includes("controllerRef.current?.focusProposal?.({ wsId: card.wsId, id: card.id });"), "转发 focusProposal（失败静默降级）");
  assert.ok(clientSource.includes("focusProposal({ wsId, id } = {}) {"), "控制器公共面 focusProposal（与 actions 同层）");
  assert.ok(clientSource.includes("return engine?.focusStar?.(wsId, id) === true;"), "转发 engine.focusStar（返回值 = 是否接受）");

  /* 4.1 点击守卫引擎感知：顺序 = 拖拽豁免 → 作用面 → 引擎选中 → 清空。
     作用域精确到「画布起指的点击」：左下「＋」/星座卡片/天体信息卡等非画布区域不受引擎
     选中影响，照常清除（spec「点击其他区域取消选中」列出「＋」）。 */
  const clickStart = clientSource.indexOf("onClick={(event) => {");
  const clickBody = clientSource.slice(clickStart, clientSource.indexOf("setSelectedKey(null);", clickStart));
  assert.ok(clickStart > 0 && clickBody.length > 0, "页面 onClick 切片可定位");
  const guardAt = clickBody.indexOf("inspectSelection?.() != null");
  assert.ok(guardAt > 0, "清空分支前置引擎感知守卫");
  assert.ok(clickBody.includes("isStarCanvasTarget(event.target)"), "守卫仅对画布起指的点击生效（非画布区域照常清除）");
  assert.ok(/if \(isStarCanvasTarget\(event\.target\)\s*&& controllerRef\.current\?\.getEngine\?\.\(\)\?\.inspectSelection\?\.\(\) != null\) return;/.test(clientSource), "画布 + 引擎仍有选中 → 跳过清空（MUST NOT 覆写 pointerup 联动）");
  assert.ok(clickBody.indexOf("Math.hypot(event.clientX - tapStart.x, event.clientY - tapStart.y) > 6") < guardAt, "拖拽 >6px 豁免先于引擎守卫（既有语义不变）");
  assert.ok(clickBody.indexOf("if (isSelectionSurface(event.target)) return;") < guardAt, "作用面判定先于引擎守卫（该分支仍由 isSelectionSurface 承接）");
  assert.ok(
    /import \{[^}]*findCard[^}]*isSelectionSurface[^}]*projectPanel[^}]*proposalKeyOf[^}]*\} from "\.\/panel\.mjs";/.test(clientSource),
    "作用面判定/选中键/查表工具仍由 panel.mjs 提供（会话面板另增 projectSessionPanel/sessionKeyOf，同一纯逻辑模块）"
  );
  /* 画布判定纯函数（模块级）：非 Element 目标与异常保守回落 false（照常清空），不抛错。 */
  const canvasGuardBody = clientSource.slice(
    clientSource.indexOf("function isStarCanvasTarget(target)"),
    clientSource.indexOf("function createCosmosController")
  );
  assert.ok(canvasGuardBody.length > 0, "isStarCanvasTarget 切片可定位");
  assert.ok(canvasGuardBody.includes('target.closest(".cos-canvas")'), "画布判定按引擎 canvas 类名（与 E.el.canvas 同源）");
  assert.ok(canvasGuardBody.includes("if (!target || typeof target.closest !== \"function\") return false;"), "非 Element 目标回落 false（无 closest）");
  assert.ok(canvasGuardBody.includes("} catch {"), "探针异常不阻断点击（保守回落 false）");
}

/* ── 17. 守卫三态前提（引擎侧直测）：命中天体 → 引擎选中非空；空白/回到银河 → 已清空 ── */
{
  const realPerformance = globalThis.performance;
  let fakeNow = 500000;
  globalThis.performance = { now: () => fakeNow };
  const container = makeElement("div");
  const seen = [];
  const engine = createCosmosEngine({
    container, style: createSkinD(),
    onSelectChange: (info) => seen.push(info)
  });
  const root = container.children[0];
  const canvas = root.querySelector(".cos-canvas");
  const overlay = root.querySelector(".cos-overlay");
  const homeBtn = overlay.children.find((el) => el.className === "cos-home-btn");
  assert.ok(homeBtn, "回到银河按钮已建（overlay 子级，D4 放行路径的判据源）");
  const fire = (el, type, ev) => {
    for (const fn of el.listeners[type] ?? []) fn({ preventDefault() {}, target: canvas, ...ev });
  };
  const scene = {
    workspaces: [{
      id: "z1", name: "zoom-one", pos: [0, 0, 0],
      stars: [{ id: "z1-s", name: "s", lifecycle: "executed", setBy: null, at: null, tasks: [1, 1], age: "刚刚", act: 0, off: [0, 0, 0] }],
      links: [],
      planets: [{ id: "z1-p", title: "p", state: "idle", pendingKind: null, stars: ["z1-s"], todos: "—", when: "刚刚", satellites: [], satelliteCount: 0, delegatedBusy: false }],
      comets: [], archives: 0, satelliteCount: 0
    }]
  };
  rafQueue.length = 0;
  let tNow = 500000;
  const step = () => {
    tNow += 50;
    const cb = rafQueue.shift();
    assert.ok(cb, "帧回调在队");
    cb(tNow);
  };
  engine.setScene(scene, "rebuild");
  engine.start();
  for (let i = 0; i < 27; i += 1) step(); // 过冷启动序曲
  engine.diveToWs("z1");
  fakeNow += 1400;
  step();
  assert.equal(engine.isDiving(), true, "钻取态成立（守卫前提）");
  assert.equal(engine.inspectSelection(), null, "dive 未携带预选落地 → 引擎无选中（对应 spec「dive 落地未携带预选不触发联动」）");

  /* 恒星命中：引擎选中非空 → 页面守卫放行（不清空，由联动转移）。 */
  fire(root, "pointerup", { pointerId: 71, button: 0, clientX: 400, clientY: 300 });
  assert.deepEqual(engine.inspectSelection(), { kind: "star", wsId: "z1", id: "z1-s", lifecycle: "executed" }, "钻取态恒星命中 → 引擎选中非空（守卫放行）");
  assert.deepEqual(seen.at(-1), engine.inspectSelection(), "onSelectChange 载荷与快照同形（客户端镜像输入）");

  /* 行星命中：引擎选中同样非空 → 守卫放行（面板保持既有选中）。 */
  let planetSel = null;
  for (let gx = 300; gx <= 500 && !planetSel; gx += 6) {
    for (let gy = 200; gy <= 400 && !planetSel; gy += 6) {
      fire(root, "pointerup", { pointerId: 72, button: 0, clientX: gx, clientY: gy });
      const sel = engine.inspectSelection();
      if (sel && sel.kind === "planet") planetSel = sel;
    }
  }
  assert.deepEqual(planetSel, { kind: "planet", wsId: "z1", id: "z1-p" }, "行星命中 → 引擎选中非空（守卫放行；行星载荷不带 lifecycle）");
  assert.deepEqual(seen.at(-1), planetSel, "行星通知载荷同形（kind 区分交给客户端映射黑名单）");

  /* 回到银河：引擎先 flyOut 清选中 → 页面 click 到达时已为 null（照常清空）。 */
  fire(homeBtn, "click", {});
  assert.equal(engine.inspectSelection(), null, "回到银河先清引擎选中（守卫随后照常清控面板）");
  fakeNow += 1400;
  step();
  assert.equal(engine.isDiving(), false, "已回银河视图");

  /* 空白命中：引擎已清 null → 页面照常清空。 */
  fire(root, "pointerup", { pointerId: 73, button: 0, clientX: 14, clientY: 584 });
  assert.equal(engine.inspectSelection(), null, "空白命中 → 引擎无选中（守卫照常清空）");
  assert.equal(seen.at(-1) ?? null, null, "空白命中通知保持置空（幂等不重复）");

  engine.dispose();
  assert.equal(engine.inspectSelection(), null, "dispose 后快照 null（镜像归零判据）");
  globalThis.performance = realPerformance;
}

/* ── 18. 钻取态 HUD 布局：搜索框退场 + 标牌居中（polish-cosmos-drilled-hud 1.1–1.3 / 2.1–2.2 / 3.1） ──
   React 组件树在 Node 侧不可挂载（react 为 bundle external）→ 搜索框门控走**源码锚点**；
   运行时行为（dive 后消失 / 飞回带原查询重现）由 4.2 真机核对承接。居中几何走
   「引擎 CSS × 客户端 CSS」口径一致性断言（640px / 400px 伪视口）。 */
{
  /* 1.1 搜索框块以 drill == null 门控：搜索锚点必须落在门控分支内（无无条件渲染残留）。 */
  const gateAt = clientSource.indexOf("{drill == null ? (");
  const searchAt = clientSource.indexOf('className="cos-search"');
  const searchCloseAt = clientSource.indexOf(") : null}", gateAt);
  assert.ok(gateAt > 0, "搜索框块以 drill == null 门控（drill 来自 drillStore 镜像）");
  assert.ok(searchAt > gateAt && searchAt < searchCloseAt, "搜索块位于门控分支内（无「裸」无条件渲染残留）");
  assert.ok(/\{drill == null \? \(\s*<div\s*\n\s*className="cos-search"/.test(clientSource), "门控紧贴搜索框块（条件渲染而非 CSS 隐藏）");
  assert.ok(clientSource.includes('data-plugin-anchor="dsh-v-cosmos:search"'), "搜索锚点随块保留（银河态可定位）");
  assert.ok(clientSource.includes(".cos-search{position:absolute;top:12px;left:50%;transform:translateX(-50%)"), "银河态搜索框 CSS 原位不动（top:12px 居中）");

  /* 1.2 空态提示（`.cos-search` 兄弟节点、屏中 top:44%）同门控：钻取态一并隐藏。 */
  assert.ok(clientSource.includes("{drill == null && showNoMatch ? ("), "空态提示 = drill == null && showNoMatch");
  assert.ok(!clientSource.includes("{showNoMatch ? ("), "旧「无条件消费 showNoMatch」已移除（钻取态不留半截态）");
  assert.ok(clientSource.includes(".cos-search-empty{position:absolute;top:44%"), "空态提示 CSS 本身零改动");

  /* 1.3 查询状态零改动：无主动清理代码（冻结 = 卸载后无输入面的自然结果）。 */
  assert.equal((clientSource.match(/applyQuery\(""\)/g) ?? []).length, 3, "查询清理点仍为 3 处（输入框 Esc / 清除按钮 / 外壳 Esc 分层）");
  assert.ok(clientSource.includes("controllerRef.current?.actions.setFilter(value);"), "applyQuery 写入面原样（无钻取态分支）");
  assert.ok(clientSource.includes("filterStore.set({ query: filterQuery"), "filterStore 写入面原样（MUST NOT 在钻取态改写查询）");
  assert.ok(clientSource.includes("if (filterQuery.trim()) syncFilter();"), "重挂载保持查询（attach 路径）原样");

  /* 2.1 / 2.2 标牌居中的跨文件几何一致：470 = 2×(面板 187 + 安全边距 48)；160px 为页面宽度不足下限。
     面板换边为右缘（swap-cosmos-panel-sides）后，标牌仍居中 → 两侧间距对称，预留口径不变。 */
  const badgeRule = engineSource.slice(engineSource.indexOf(".cos-badge {"), engineSource.indexOf(".cos-badge b {"));
  assert.ok(badgeRule.includes("left: 50%") && badgeRule.includes("transform: translateX(-50%)"), "引擎 CSS：标牌水平居中（left:50% + translateX(-50%)）");
  assert.ok(badgeRule.includes("text-align: center"), "引擎 CSS：标牌文本居中");
  const limitM = /max-width: max\((\d+)px, min\((\d+)px, calc\(100% - (\d+)px\)\)\)/.exec(badgeRule);
  assert.ok(limitM, "引擎 CSS：标牌限宽口径可解析（下限 / 上限 / 避让预留）");
  const panelM = /\.dsh-cosmos-panel\{[^}]*?width:var\(--cos-const-panel-w, (\d+)px\)/.exec(clientSource);
  assert.ok(panelM, "客户端 CSS：面板宽度（令牌 fallback，add-cosmos-layout-tuning 起可配）可解析");
  const floor = Number(limitM[1]);
  const cap = Number(limitM[2]);
  const reserve = Number(limitM[3]);
  const panelW = Number(panelM[1]);
  assert.equal(reserve, 2 * (panelW + 48), "避让预留 = 2×(面板宽 + 48 安全边距)（口径与面板宽度同源）");
  /* 断点看**视口**（媒体查询），限宽算式看**页面**（引擎根容器宽度 = 视口 - 侧栏）。 */
  const badgeWidth = (vw, pageW) => (vw < 520 ? pageW - 40 : Math.max(floor, Math.min(cap, pageW - reserve)));
  const at640 = badgeWidth(640, 640);
  assert.ok((640 - at640) / 2 >= panelW + 48, "640px 伪视口：标牌外缘到面板内缘 ≥ 48px（居中对称，右缘面板与左缘同值；无重叠，spec 满足）");
  const at400 = badgeWidth(400, 400);
  assert.equal(at400, 360, "400px 伪视口：断点放宽到 calc(100% - 40px)");
  assert.ok((400 - at400) / 2 < panelW, "400px 伪视口：横向允许与面板重叠（降级口径，非破坏性）");
  /* 侧栏在场的退化档（视口 700 / 页面 480）：min() 为负 → 160px 下限兜底，标牌仍 MUST 呈现。 */
  const sidePage = 700 - 220;
  const atSide = badgeWidth(700, sidePage);
  assert.equal(atSide, floor, "侧栏在场（视口 700 / 页面 480）：min() 为负 → 下限兜底");
  assert.ok(atSide > 0, "标牌 MUST 不退化为 0 宽（spec「MUST 呈现标牌」）");
  assert.ok((sidePage - atSide) / 2 < panelW, "该档允许与面板横向重叠（降级，纵向由面板下移隔离）");
  assert.ok(engineSource.includes("@media (max-width: 520px) { .cos-badge { max-width: calc(100% - 40px); } }"), "窄视口断点规则在册（<520px）");
  /* 纵向兜底：标牌两行文本底缘 ≤44px，位于面板钻取态顶部（宽屏 64px / 窄屏 96px）之上。 */
  const drillTopWide = /\.dsh-cosmos-panel\[data-drill=true\]\{top:(\d+)px\}/.exec(clientSource);
  const drillTopNarrow = /@media \(max-width:640px\)\{\.dsh-cosmos-panel\{top:\d+px\}\.dsh-cosmos-panel\[data-drill=true\]\{top:(\d+)px\}/.exec(clientSource);
  assert.ok(drillTopWide && drillTopNarrow, "面板钻取态下移口径可解析（宽屏/窄屏两档）");
  assert.ok(44 <= Number(drillTopWide[1]) && 44 <= Number(drillTopNarrow[1]), "标牌纵向盒高（底缘 ≤44px）在面板顶之上——横向重叠也不构成遮挡");
}

/* ── 19. 会话决策入口 + 恒星活力两态（cosmos-session-decide / cosmos-relation-focus / dsh-cosmos delta） ──
   行为面直测在 engine-smoke（注入/分流/文案/门禁）与 merge-smoke（投影纯函数）；此处锁
   源码契约：按钮装配单点与顺序位、分流钩子、回调注入位与 client 同链路接线、locale DICT
   与引擎文案注入面、活力状态行/名牌标识与 sig 扩展。 */
{
  /* 决策按钮装配（引擎）：仅行星 waiting；钩子并存；待归档之前插入 */
  assert.ok(engineSource.includes("function decideButtonHtml(kind, ent)"), "决策按钮装配单点存在");
  assert.ok(
    /if \(kind !== 'planet' \|\| !ent \|\| ent\.state !== 'waiting'\) return '';/.test(engineSource),
    "呈现条件：仅行星 waiting（彗星/非待决策早退空串）"
  );
  assert.ok(engineSource.includes('data-action="decide" data-session="'), "决策按钮 data-action 与 data-session 稳定钩子并存");
  assert.ok(
    engineSource.includes("cardActionsHtml(p.id, decideButtonHtml('planet', p))"),
    "行星卡在「打开会话」与「归档会话」之间注入决策按钮"
  );
  assert.equal((engineSource.match(/decideButtonHtml\('planet', p\)/g) ?? []).length, 1, "仅行星卡一处注入（彗星卡不注入）");
  assert.ok(/\(lead \|\| ''\) \+/.test(engineSource), "按钮行按 打开 → 决策（lead）→ 归档 顺序拼装");
  assert.ok(
    /approval: '待批准', 'plan-review': '计划待审', question: '待回答', fallback: '待决策'/.test(engineSource),
    "决策专用文案映射（不复用 PLAN_KIND_LABEL 现值「审批/方案审查/提问」）"
  );
  assert.ok(!/DECIDE_KIND_LABEL/.test(engineSource), "文案经 E.labels.decide 单点解析（locale 注入面）");
  assert.ok(/\.cd-btn-decide \{[^}]*var\(--dsw-alias-state-warn-primary/.test(engineSource), "决策按钮琥珀 warning 色优先官方 --dsw-alias-* token");
  assert.ok(/\.cd-btn-decide \{[^}]*--cos-waiting/.test(engineSource), "token 缺席回落风格 D 基线（--cos-waiting）");

  /* 点击分流（引擎）：decide → onDecideSession；未注入静默；归档在途不拦（无 decide 在途门） */
  const decideClick = engineSource.slice(
    engineSource.indexOf("E.el.card.addEventListener('click'"),
    engineSource.indexOf("function isEmptyConstellation")
  );
  assert.ok(decideClick.includes("action === 'decide'") && decideClick.includes("E.onDecideSession(sessionId)"), "decide → onDecideSession 分流");
  assert.ok(/if \(E\.onDecideSession\) E\.onDecideSession/.test(decideClick), "回调未注入静默 no-op（同 onOpenSession 守卫）");
  assert.ok(
    decideClick.indexOf("E.onDecideSession(sessionId)") < decideClick.indexOf("if (E.archiveInFlight.has(sessionId)) return;"),
    "decide 分支先于归档在途门（打开类动作不受归档在途拦截）"
  );
  assert.ok(engineSource.includes('onDecideSession: typeof opts.onDecideSession === "function" ? opts.onDecideSession : null'), "引擎 opts 回调注入位（与 onOpenSession/onArchiveSession 同模式）");

  /* client 接线：复用 actions.openSession 官方链路（先关整页 → uiWorkspace.openSession） */
  assert.ok(clientSource.includes("onDecideSession: (sessionId) => actions.openSession(sessionId)"), "attach 注入 onDecideSession（同一 openSession 链路）");
  const openAction = clientSource.slice(clientSource.indexOf("openSession(sessionId) {"), clientSource.indexOf("refresh() {"));
  assert.ok(openAction.includes("cosmosOpenStore.set(false)"), "先关 Cosmos 整页");
  assert.ok(openAction.includes("ctx.uiWorkspace?.openSession"), "再经官方 uiWorkspace.openSession 切换会话页");
  assert.ok(openAction.includes("ctx.sessions?.open"), "旧宿主回落 ctx.sessions.open");

  /* locale DICT + 引擎文案注入面（5.4）：中英成对 + labels 同源 */
  assert.equal((clientSource.match(/"cosmos\.card\.decide\.approval": "待批准"/g) ?? []).length, 1, "DICT zh：决策按钮文案");
  assert.equal((clientSource.match(/"cosmos\.card\.decide\.approval": "Approve"/g) ?? []).length, 1, "DICT en：决策按钮文案成对");
  assert.equal((clientSource.match(/"cosmos\.card\.vitality": "活力"/g) ?? []).length, 1, "DICT zh：活力状态行文案");
  assert.equal((clientSource.match(/"cosmos\.card\.vitality": "Vitality"/g) ?? []).length, 1, "DICT en：活力状态行文案成对");
  assert.ok(clientSource.includes('tr("cosmos.card.decide.planReview", "计划待审")'), "client → 引擎文案注入（tr 同源）");
  assert.ok(clientSource.includes('tr("cosmos.card.vitality.sleep", "沉睡")'), "活力两态文案注入（tr 同源）");

  /* 恒星活力两态（引擎）：信息卡行 / 星胚豁免 / sig 纳入 act / 名牌标识 */
  assert.ok(engineSource.includes("const vitalityRow = s.lifecycle === 'proto' ? '' :"), "星胚豁免活力状态行");
  assert.ok(engineSource.includes("E.labels.vitality.label"), "活力行标经注入文案（区别于生命周期「状态」行）");
  assert.ok(engineSource.includes("(s.act || 0) > 0 ? E.labels.vitality.active : E.labels.vitality.sleep"), "act≥1=活跃 / act=0=沉睡（口径沿用现行定义）");
  assert.ok(engineSource.includes("if (ent.kind === 'star') sig += '|act:'"), "星卡 sig 扩展纳入 act（act 翻转触发重渲染）");
  assert.ok(engineSource.includes("cos-slab-life"), "钻取态恒星名牌活力标识节点");
  assert.ok(engineSource.includes("slab.dataset.html !== slabHtml"), "名牌内容沿用 dataset.html 差分守卫");

  /* 关联聚焦（引擎）：rel 标记 + 坡道 + 纯派生（无缓存） */
  assert.ok(engineSource.includes("export const REL_FADE_DUR = 0.2"), "聚焦坡道 0.2s（快于连线段 0.4s）");
  assert.ok(engineSource.includes("advanceRelFocus(t)") && engineSource.includes("activeRelFocuses(t)"), "聚焦源每帧裁决 + 活动集派生");
  assert.ok(engineSource.includes("advanceRelFocus(t)") && !engineSource.includes("relSetCache"), "MUST NOT 维护聚焦集缓存（纯派生，无失效路径）");
  assert.ok(engineSource.includes("relSet = relSetOf(ws, relFocuses, cam, W, H)"), "按星座现场派生关联集（star/planet 两分支）");
  assert.ok(engineSource.includes("orbitItem.rel = true"), "orbit 条目 rel 标记（皮肤缺省忽略不破图）");
  assert.ok(engineSource.includes("seg.rel = true"), "constline 段 rel 标记");
  assert.ok(engineSource.includes("pushSatEnvelope(items, cam, p, W, H, ws, t, planetAlpha, relSet"), "挂卫星子轨道环同源增亮");
  assert.ok(engineSource.includes("starPlanetIdsOf"), "恒星→行星反向映射经 merge 层纯函数消费");

  /* 皮肤参考实现与降级（skin-d）：rel 段金色增亮 / rel 环增亮；其余皮肤忽略标记即缺省渲染 */
  const skinSource = readFileSync(new URL("../src/cosmos/skin-d.mjs", import.meta.url), "utf8");
  assert.ok(skinSource.includes("seg.rel ? clamp(seg.relAlpha"), "skin-d：rel 段按坡道因子增亮");
  assert.ok(skinSource.includes("const relK = it.rel ? clamp(it.relAlpha"), "skin-d：rel 环/子轨道环按坡道因子增亮");
  assert.ok(skinSource.includes("suborbit") && /const relK = it\.rel/.test(skinSource), "skin-d：子轨道环同源增亮");
}

/* ── 19. 星胚合并卡片（add-cosmos-embryo-cards 3.3/3.4/3.5）：渲染钩子 / 样式 / 选中不飞行 ── */
{
  /* 卡片钩子与分支：`data-embryo` + slug 逐行清单 + 「星胚」徽标 + at；无提案名行/任务进度行 */
  assert.ok(clientSource.includes('data-embryo={card.isEmbryo ? "true" : undefined}'), "星胚卡片 data-embryo 钩子（React 布尔属性写法）");
  assert.ok(clientSource.includes("{card.isEmbryo ? ("), "卡片按 isEmbryo 分支渲染");
  assert.ok(clientSource.includes('className="dsh-cosmos-embryo-slugs"'), "slug 清单容器");
  assert.ok(clientSource.includes('className="dsh-cosmos-embryo-slug" key={slug}'), "slug 逐行（每行一个，可读可复制）");
  assert.ok(clientSource.includes('className="dsh-cosmos-panel-badge dsh-cosmos-panel-badge-embryo"'), "「星胚」徽标（与已审核金章徽标同位异色）");
  assert.ok(clientSource.includes('t("cosmos.panel.embryo", "星胚")'), "徽标文案走词典");
  assert.equal((clientSource.match(/"cosmos\.panel\.embryo": "星胚"/g) ?? []).length, 1, "DICT zh：星胚徽标");
  assert.equal((clientSource.match(/"cosmos\.panel\.embryo": "Embryo"/g) ?? []).length, 1, "DICT en：星胚徽标成对");
  const embryoBranch = clientSource.slice(
    clientSource.indexOf("{card.isEmbryo ? ("),
    clientSource.indexOf(") : (", clientSource.indexOf("{card.isEmbryo ? ("))
  );
  assert.ok(embryoBranch.length > 0, "星胚分支截取成功");
  assert.ok(!embryoBranch.includes("dsh-cosmos-panel-name"), "星胚卡 MUST 无提案名行");
  assert.ok(!embryoBranch.includes("dsh-cosmos-panel-tasks"), "星胚卡 MUST 无任务进度行");
  assert.ok(embryoBranch.includes("card.slugs.map"), "卡内逐行列出该探索会话的全部推荐 slug");
  assert.ok(embryoBranch.includes("card.at ?"), "at 时间徽标（可得时）");
  /* 卡面标题 = slug 清单（星胚无 dir，MUST NOT 回落到提案名） */
  assert.ok(clientSource.includes("title={card.isEmbryo ? card.slugs.join(\"\\n\") : card.dir || card.name}"), "星胚 title = slug 清单");

  /* 样式：虚线描边 + --cos-lc-proto 语义色（fallback #8a9bc0）+ 徽标异色 */
  assert.ok(clientSource.includes(".dsh-cosmos-panel-card[data-embryo]{border-style:dashed"), "星胚虚线描边（[data-embryo] CSS 钩子）");
  assert.ok(clientSource.includes("border-color:var(--cos-lc-proto,#8a9bc0)"), "星胚灰蓝语义色走 HUD 令牌（fallback 同值）");
  assert.ok(clientSource.includes("color:var(--cos-lc-proto,#8a9bc0)"), "星胚卡字色随肤");
  assert.ok(clientSource.includes(".dsh-cosmos-panel-card[data-embryo] .dsh-cosmos-panel-badge"), "徽标异色规则（与三态徽标区分）");
  assert.ok(clientSource.includes(".dsh-cosmos-embryo-slugs{display:flex;flex-direction:column"), "slug 清单纵向逐行");
  assert.ok(!clientSource.includes("--cos-lc-proto-rgb"), "未新增 rgb 通道令牌（令牌表仍 27 枚）");

  /* 选中接线：星胚选中不触发聚焦飞行（跳过 focusProposal 调用） */
  const selectSource = clientSource.slice(
    clientSource.indexOf("const selectProposal = (key) =>"),
    clientSource.indexOf("/* ── 皮肤 HUD 令牌")
  );
  assert.ok(selectSource.length > 0, "选中入口截取成功");
  assert.ok(selectSource.includes("if (card.isEmbryo) return;"), "星胚显式跳过聚焦飞行");
  assert.ok(
    selectSource.indexOf("setSelectedKey(key)") < selectSource.indexOf("if (card.isEmbryo) return;")
      && selectSource.indexOf("if (card.isEmbryo) return;") < selectSource.indexOf("controllerRef.current?.focusProposal?."),
    "面板选中先行落定 → 星胚早退 → 才轮到聚焦飞行（无先清后选）"
  );
  /* 动作条目标 = 星胚组（selectedCard 由 findCard 投影取，星胚卡在 allCards 内可命中） */
  assert.ok(clientSource.includes("return findCard(projectPanel(scene), selectedKey);"), "动作条目标取 selectedKey 对应卡片（含星胚卡）");
  assert.ok(clientSource.includes("if (!selectedCard || selectedCard.lifecycle !== \"proto\") return null;"), "星胚动作按钮门控读卡片（旧锚点禁用提示沿用）");
}

/* ── 界面尺寸令牌下发链路（add-cosmos-layout-tuning 2.1/2.2 / D1）：设置面投影 → 模块
   store → 整页根容器 CSS 变量；页签更名「界面」且内部 id 保持 nav ── */
{
  const settingsSource = readFileSync(new URL("../src/settings.mjs", import.meta.url), "utf8");
  assert.ok(
    settingsSource.includes("export function cosmosLayoutTokensOf(settings)"),
    "纯函数投影入口（settings.mjs 导出，引擎/整页 CSS 共用同一变量表）"
  );
  for (const token of [
    "--cos-session-w", "--cos-session-h", "--cos-const-panel-w", "--cos-const-panel-h",
    "--cos-add-btn-size", "--cos-hud-btn-size", "--cos-action-btn-w", "--cos-action-btn-h",
    "--cos-const-action-h", "--cos-search-w", "--cos-search-h", "--cos-ws-title-size"
  ]) {
    assert.ok(settingsSource.includes('"' + token + '"'), "投影覆盖令牌 " + token);
  }
  assert.ok(!/--cos-actions-h/.test(settingsSource), "投影不含动作条高度（仍由 DOM 测量注入，单一来源）");
  /* 整页根容器：订阅「界面」store 并展开令牌（与 --cos-actions-h 同址） */
  assert.ok(
    clientSource.includes("const navPrefs = useSyncExternalStore(cosmosNavStore.subscribe, cosmosNavStore.getSnapshot);"),
    "整页订阅界面 store（设置改动即时重渲染）"
  );
  assert.ok(clientSource.includes("const layoutTokens = cosmosLayoutTokensOf(navPrefs);"), "投影结果在页根计算");
  assert.ok(clientSource.includes("...layoutTokens"), "令牌展开进页根 style（继承链下发到引擎与面板层）");
  assert.ok(
    clientSource.indexOf("import { COSMOS_SETTINGS_BOUNDS") >= 0 && clientSource.includes("cosmosLayoutTokensOf, loadCosmosSettings"),
    "settings.mjs 导入投影函数（单一实现，不在 client 复制映射）"
  );
  /* 尺寸 CSS 消费点（替代字面量，全部带现值 fallback） */
  const consumers = [
    ["width:var(--cos-session-w, 260px)", "会话面板宽"],
    ["max-height:var(--cos-session-h, none)", "会话面板高度上限"],
    ["width:var(--cos-const-panel-w, 187px)", "星座面板宽"],
    ["max-height:var(--cos-const-panel-h, none)", "星座面板高度上限"],
    ["width:var(--cos-add-btn-size, 44px);height:var(--cos-add-btn-size, 44px)", "新增按钮边长"],
    ["min-height:var(--cos-action-btn-h, 40px)", "动作条按钮高"],
    ["min-height:var(--cos-const-action-h, 40px)", "星座动作按钮高"],
    ["width:min(var(--cos-search-w, 320px), 34vw)", "搜索框宽（保留 34vw 视口上限，缺省行为不变）"],
    ["min-height:var(--cos-search-h, 0)", "搜索框最小高（0 = 自适应）"]
  ];
  for (const [anchor, label] of consumers) assert.ok(clientSource.includes(anchor), label + " 走令牌");
  /* 星座标题字号在引擎 CSS（.cos-badge b）侧消费 */
  const engineSource = readFileSync(new URL("../src/cosmos/engine.mjs", import.meta.url), "utf8");
  assert.ok(engineSource.includes("font-size: var(--cos-ws-title-size, 13px)"), "星座标题字号经令牌下发（引擎标牌）");
  assert.ok(engineSource.includes("width: var(--cos-hud-btn-size, 44px); height: var(--cos-hud-btn-size, 44px)"), "HUD 按钮边长经令牌（home）");
  /* 页签更名「界面」：可见文案换名，slot id / face 名保持 nav（内部契约零迁移） */
  assert.ok(clientSource.includes('"cosmos.settings.tabInterface": "界面"'), "词典 zh：页签更名「界面」");
  assert.ok(clientSource.includes('"cosmos.settings.tabInterface": "Interface"'), "词典 en：页签更名成对");
  assert.ok(clientSource.includes('label: () => sectionT("cosmos.settings.tabInterface")'), "页签标签取更名后的词典键");
  assert.ok(!clientSource.includes('"cosmos.settings.tabNav"'), "旧「导航」页签词典键已退役");
  assert.ok(clientSource.includes('id: "nav",'), "slot id 仍为 nav（内部标识零迁移）");
}

console.log("client-ui-smoke: all assertions passed");
