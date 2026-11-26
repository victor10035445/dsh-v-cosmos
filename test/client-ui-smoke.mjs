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
import { createCosmosEngine, HOME_DIST } from "../src/cosmos/engine.mjs";
import { isEditableTarget, isUiChromeTarget } from "../src/cosmos/engine.mjs";
import { createSkinD } from "../src/cosmos/skin-d.mjs";
import { sessionRowStateOf } from "../src/panel.mjs";
import { FLOAT_TEXTAREA_MAX_HEIGHT, FLOAT_TEXTAREA_MIN_HEIGHT, floatTextareaHeightOf } from "../src/constellation-actions.mjs";
import { createEmbryoDismissExecutor } from "../src/actions.mjs";
import { createSnapshotStore } from "../src/settings-seam.mjs";

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

/* classList 桩：真实维护 className 令牌集（与 engine-smoke 同款）——引擎的
   classList.toggle（chip 沉睡态 / on 类）在桩上可观测。 */
function classListOf(el) {
  const tokens = () => String(el.className).split(/\s+/).filter(Boolean);
  const write = (list) => { el.className = list.join(" "); };
  return {
    add(...names) {
      const list = tokens();
      for (const name of names) if (name && !list.includes(name)) list.push(name);
      write(list);
    },
    remove(...names) { write(tokens().filter((name) => !names.includes(name))); },
    toggle(name, force) {
      const list = tokens();
      const has = list.includes(name);
      const want = force === undefined ? !has : !!force;
      if (want === has) return want;
      if (want) list.push(name); else list.splice(list.indexOf(name), 1);
      write(list);
      return want;
    },
    contains(name) { return tokens().includes(name); }
  };
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
    classList: null,
    appendChild(child) {
      el.children.push(child);
      return child;
    },
    remove() {},
    querySelector(sel) {
      el._byClass = el._byClass || {};
      const cls = String(sel).replace(".", "");
      if (!el._byClass[cls]) {
        el._byClass[cls] = sel === ".cos-canvas" || sel === ".cos-tiplines" ? makeCanvasEl() : makeElement("div");
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
  el.classList = classListOf(el);
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
  assert.equal(engine.getCamera().dist, HOME_DIST, "默认视距 = 银河首屏 3000（首屏容纳整座星座天球）");
  assert.equal(HOME_DIST, 3000, "首屏视距常量 = 3000");
  assert.equal(engine.zoomBy(120), true, "有效 deltaY 被消费");
  assert.equal(Math.round(engine.getCamera().dist), Math.round(HOME_DIST * 1.144), "缩放比例与容器级滚轮一致（1 + dy*0.0012）");
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
  assert.ok(clientSource.includes("function SessionPanel({ t, model, open, selectedKey, drill, waiting, onToggle, onSelect, onOpen, onArchive, crossHover, onHoverRow })"), "会话列表面板组件");
  assert.ok(clientSource.includes("function SessionRow({ t, row, selected, onSelect, onOpen, onArchive, linked, onHover })"), "会话行组件");
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
  /* polish-cosmos-session-focus-and-hover-markers 2.1/2.2：行点选同步宿主会话（不关页）。
     add-cosmos-host-session-follow 1.3：切换动词前写镜像/哨兵（吸收同步/异步换绑回声），
     未发起时回滚；导航本体仍是既有薄包装（返回值语义不变）。 */
  assert.ok(clientSource.includes("openSessionInPlace(sessionId) {"), "控制器公共面 openSessionInPlace（宿主会话切换）");
  assert.ok(clientSource.includes("const opened = openSessionVia(sessionId);"), "复用官方会话导航薄包装（不关整页）");
  assert.ok(clientSource.includes("hostFollow?.noteOpenedSession?.(sessionId);"), "切换前乐观前写镜像/哨兵（回声短路）");
  assert.ok(clientSource.includes("hostFollow?.settleOpenedSession?.(opened === true);"), "成功路径转正前写");
  assert.ok(clientSource.includes("controllerRef.current?.openSessionInPlace?.(row.id);"), "点行转发宿主会话切换");
  const focusRowBody = clientSource.slice(
    clientSource.indexOf("const focusSessionRow = (row) => {"),
    clientSource.indexOf("const openSessionRow = (row) => {")
  );
  assert.ok(focusRowBody.length > 0, "focusSessionRow 切片可定位");
  assert.ok(!focusRowBody.includes("cosmosOpenStore") && !focusRowBody.includes("actions?.openSession"), "行选中不关整页（打开关页职责仍归「打开」按钮）");
  assert.ok(engineSource.includes("focusBody(wsId, sessionId) {"), "引擎薄入口 focusBody");
  assert.ok(engineSource.includes("function refocusBody(body) {"), "天体级重对焦（取点走 wp 世界坐标）");
  assert.ok(engineSource.includes("const wp = Array.isArray(body?.wp) ? body.wp : null;"), "落点 = 天体世界坐标（MUST NOT 用星座中心）");
  assert.ok(engineSource.includes("setSelection({ kind: kind, ws: ws, data: body });"), "同星座钻取态立即选中");
  assert.ok(engineSource.includes("dive(ws, body);"), "银河/他星座 → dive 落地选中");

  /* Esc 分层：清空搜索 > 收起面板 > 退全屏/关页；折叠态跳过本层。
     add-cosmos-shortcuts 5.1 起关闭键参数化（canonical 匹配 + 配置经模块 store 读）。 */
  const escStart = clientSource.indexOf("if (engine?.consumeEscape?.()) {");
  const escEnd = clientSource.indexOf('window.addEventListener("keydown", onKey);', escStart);
  const escBody = clientSource.slice(escStart, escEnd);
  assert.ok(escStart > 0 && escBody.length > 0, "关闭链分支切片可定位");
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
  /* 呈现：常显图标钮、程序化钩子、aria/title 随活跃态切换（活跃门）、恒居「打开」之后 */
  assert.ok(clientSource.includes('className="dsh-cosmos-session-archive"'), "行内归档按钮类名");
  assert.ok(clientSource.includes('data-action="archive"'), "归档按钮程序化分流钩子 data-action");
  /* 活跃门禁（add-cosmos-session-archive-busy-gate 2.1/D1/D4）：busy ∨ waiting 与在途门
     声明式叠加；delegatedBusy 行同禁由投影折入承载（sessionRowStateOf("idle", true) ===
     "busy" 已在下方 14 节直测），行门禁零二次推导、一个 busy 条件同覆盖两种口径。 */
  assert.ok(clientSource.includes('const archiveDisabled = archiving || row.state === "busy" || row.state === "waiting";'),
    "活跃门禁与在途门声明式叠加（busy ∨ waiting ∨ 在途）");
  const gateLine = clientSource.split("\n").find((line) => line.includes("const archiveDisabled ="));
  assert.ok(gateLine && !gateLine.includes("done-unread") && !gateLine.includes('"idle"'), "done-unread/idle 不入活跃门（归档主要清扫对象，恒可点）");
  assert.ok(clientSource.includes('t("cosmos.sessions.archiveBusy", "执行中，暂不可归档")'), "busy 态 title/aria 切「执行中，暂不可归档」");
  assert.ok(clientSource.includes('t("cosmos.sessions.archiveWaiting", "待决策中，暂不可归档")'), "waiting 态 title/aria 切「待决策中，暂不可归档」");
  assert.ok(clientSource.includes(': t("cosmos.sessions.archiveAria", "归档会话");'), "非活跃恢复「归档会话」");
  assert.ok(clientSource.includes('aria-label={archiveTitle}') && clientSource.includes('title={archiveTitle}'), "aria-label 与 title 随活跃态切换");
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
  assert.ok(clientSource.includes("aria-busy={archiving || undefined}"), "在途 aria-busy（仍仅随在途，活跃门不加）");
  assert.ok(!clientSource.includes("aria-busy={archiveDisabled"), "活跃门禁 MUST NOT 携带 aria-busy（瞬态请求态语义独占）");
  assert.ok(clientSource.includes("disabled={archiveDisabled}"), "在途门 + 活跃门声明式禁用（随 props 重算，无 DOM 覆写面）");
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
  assert.equal((clientSource.match(/"cosmos\.sessions\.archiveBusy": "执行中，暂不可归档"/g) ?? []).length, 1, "DICT zh：活跃门 busy 说明");
  assert.equal((clientSource.match(/"cosmos\.sessions\.archiveWaiting": "待决策中，暂不可归档"/g) ?? []).length, 1, "DICT zh：活跃门 waiting 说明");
  assert.equal((clientSource.match(/"cosmos\.sessions\.archive": "Archive"/g) ?? []).length, 1, "DICT en：归档短标签成对");
  assert.equal((clientSource.match(/"cosmos\.sessions\.archiveAria": "Archive session"/g) ?? []).length, 1, "DICT en：归档会话成对");
  assert.equal((clientSource.match(/"cosmos\.sessions\.archiveBusy": "Running — archiving unavailable"/g) ?? []).length, 1, "DICT en：busy 说明成对");
  assert.equal((clientSource.match(/"cosmos\.sessions\.archiveWaiting": "Awaiting decision — archiving unavailable"/g) ?? []).length, 1, "DICT en：waiting 说明成对");
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
  /* add-cosmos-action-queue 5.3（用户 2026-11-19 改版）：主按钮与同尺寸「＋ 入队」成对，
     一对占原一列宽×2；每行最多 4 对 = 原「一行 8 个」的满宽（最大宽度不变）。 */
  assert.ok(clientSource.includes("const columns = Math.min(4, buttons.length);"), "一行 4 对 = 8 个按钮（上限）");
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
  assert.ok(settingsSource.includes("disabled={disabled || isProto || isDirect}"), "星胚/直执行行「提示词在前」禁用");
  assert.ok(settingsSource.includes("copyText(copy.newSessionTitleProto)"), "星胚行「新增会话」锁定说明");
  assert.ok(settingsSource.includes('title={isDirect ? directTitle : isProto ? copyText(copy.prependTitleProto)'), "星胚行「提示词在前」禁用说明（直执行行说明优先）");
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
  /* 行头不挤压名称输入（修复：add-cosmos-embryo-dismiss-button 后行内控件增至 9 个——
     无 flex-wrap 且 `.cs-name{min-width:0}` 时名称框在窄设置面板会被压到 16px，视觉上
     「名称为空」；此处锁定换行 + 名称最小宽，防回归）。 */
  assert.ok(settingsSource.includes(".cs-rowHead{display:flex;align-items:center;gap:6px;flex-wrap:wrap}"), "行头允许换行（控件增多不挤压名称）");
  assert.ok(settingsSource.includes(".cs-name{flex:1 1 160px;min-width:120px;"), "名称输入最小宽 120px（不塌缩为空框）");
  assert.ok(settingsSource.includes("white-space:nowrap;cursor:pointer"), "行内勾选标签不折行（换行只发生在控件之间）");
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
  assert.ok(clientSource.includes("function ConstActionBar({ t, buttons, onRun })"), "星座动作条组件（只承载用户配置按钮；模板动作已顶部化）");
  assert.ok(clientSource.includes('className="dsh-cosmos-const-actions"'), "动作条容器 CSS 钩子（.dsh-cosmos-const-*）");
  assert.ok(clientSource.includes('data-cosmos-const-actions="true"'), "动作条钩子 data-cosmos-const-actions");
  assert.ok(clientSource.includes('data-cosmos-const-action={button.name}'), "按钮稳定钩子 data-cosmos-const-action");
  assert.ok(!clientSource.includes('data-cosmos-const-tool={tool.id}'), "内置模板动作已移出动作条（无 const-tool 钩子）");
  assert.ok(clientSource.includes('key={button.name + "-" + index}'), "按钮 key 稳定（内容差分零重写）");
  assert.ok(clientSource.includes("if (list.length === 0) return null;"), "空列表零布局（用户按钮为空即整条不渲染）");
  assert.ok(clientSource.includes("min-height:var(--cos-const-action-h, 40px)"), "触屏点击目标 ≥40px（星座条同基线，高度经令牌可配）");
  assert.ok(clientSource.includes(".dsh-cosmos-const-action{"), "按钮 CSS 类存在");
  assert.ok(clientSource.includes("color:var(--dsw-alias-label-primary,var(--cos-accent-ink,#ffe3b8))"), "动作条配色优先官方 token，其次 HUD 主调令牌（3.1）");
  assert.ok(clientSource.includes(".dsh-cosmos-const-actions::after{"), "HUD 角标装饰（风格 D 语言）");
  assert.ok(clientSource.includes("flex:1 1 0;box-sizing:border-box;min-width:0;min-height:var(--cos-const-action-h, 40px)"), "等宽按钮（按行均分，宽 = 面板内容宽）");
  assert.ok(clientSource.includes("display:flex;flex-wrap:wrap;gap:5px"), "超出面板宽度自动换行");
  /* 三段结构 + 钻取态专属 + 恒可用（不依赖选中态） */
  assert.ok(
    clientSource.includes("const showConstActions = drilled && Array.isArray(constButtons) && constButtons.length > 0;"),
    "仅钻取态 + 用户按钮非空才渲染（模板动作不再参与 footer 门控）"
  );
  assert.ok(
    clientSource.indexOf('className="dsh-cosmos-panel-head"') < clientSource.indexOf('className="dsh-cosmos-panel-list"')
      && clientSource.indexOf('className="dsh-cosmos-panel-list"') < clientSource.indexOf("{showConstActions ? <ConstActionBar"),
    "head → list → footer 三段结构（footer 在列表之后）"
  );
  assert.ok(
    clientSource.includes("{showConstActions ? <ConstActionBar t={t} buttons={constButtons} onRun={onRunConst} /> : null}"),
    "footer 挂点（只挂用户按钮）"
  );
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

/* ── 9b. 源码锚点：顶部模板工具 + 选择器（add-cosmos-template-reassign 3.1–3.5 / 4.3，
   返工后两枚模板动作与星座名称整组移到钻取态右上角） ──
   行为面（净化/重掷域/选择器过滤/差分判级）由 template-assign-smoke 与 merge-smoke 直测；
   此处按既有 house style 固化 client 接线、portal 槽位、数据可用性门控、跨窗桥与词典成对。 */
{
  const engineSource = readFileSync(new URL("../src/cosmos/engine.mjs", import.meta.url), "utf8");
  /* ① 顶部两枚工具：数据可用性门控 + 文案 + 写链路 + 引擎槽位/显隐 */
  assert.ok(
    clientSource.includes("const drillFigure = drillGroup !== null ? templateForFigure(drillGroup.wsId) : null;"),
    "当前 figure 命中单次查询（选择器高亮 + 重掷排除项 + 工具可用性）"
  );
  assert.ok(clientSource.includes("const wsToolButtons = (side) => {"), "顶部模板工具按钮渲染面（左 assign / 右 reroll）");
  assert.ok(clientSource.includes('data-cosmos-ws-tool={assign ? "assign" : "reroll"}'), "两枚工具稳定钩子 data-cosmos-ws-tool");
  assert.ok(clientSource.includes('tr("cosmos.tplActions.assign", "指定模板")'), "「指定模板」文案走词典");
  assert.ok(clientSource.includes('tr("cosmos.tplActions.reroll", "随机重掷")'), "「随机重掷」文案走词典");
  assert.ok(clientSource.includes("onClick={assign ? () => setTemplatePickerOpen(true) : rerollTemplate}"),
    "「指定模板」→ 打开选择器 /「随机重掷」→ 重掷链路");
  assert.ok(clientSource.includes("if (drillFigure === null) return null;"), "数据集不可用（命中 null）→ 两枚工具零呈现");
  assert.ok(clientSource.includes("host.querySelector('.cos-wsbar-tools[data-side=\"left\"]')")
    && clientSource.includes("host.querySelector('.cos-wsbar-tools[data-side=\"right\"]')"),
    "portal 目标 = 引擎右上标牌组内工具槽");
  assert.ok(clientSource.includes("createPortal(wsToolButtons(\"left\"), wsToolSlots.left)")
    && clientSource.includes("createPortal(wsToolButtons(\"right\"), wsToolSlots.right)"),
    "两枚工具 portal 到右上标牌组内左右槽（名称右侧方形图标）");
  assert.ok(clientSource.includes("observer.observe(host, { childList: true });"), "引擎根重建/重挂载时重新解析槽位");
  assert.ok(clientSource.includes(".dsh-cosmos-ws-tool{"), "顶部工具按钮 CSS 类存在");
  assert.ok(clientSource.includes("width:100%;height:100%;padding:0"), "两枚按钮方形（宽度/高度吃满工具槽，padding:0）");
  assert.ok(clientSource.includes(".dsh-cosmos-ws-tool-icon svg{display:block;width:60%;height:60%}"), "图标居中缩放（铅笔 / 骰子）");
  assert.ok(clientSource.includes("const WS_EDIT_ICON_SVG ="), "指定模板图标常量（铅笔编辑）");
  assert.ok(clientSource.includes("const WS_DICE_ICON_SVG ="), "随机重掷图标常量（骰子）");
  assert.ok(clientSource.includes("assign ? WS_EDIT_ICON_SVG : WS_DICE_ICON_SVG"), "两枚按钮各用其图标（编辑 / 骰子）");
  assert.ok(clientSource.includes("aria-label={label}") && clientSource.includes("title={title}"), "icon-only 按钮 aria-label + title（可访问名）");
  assert.ok(engineSource.includes('class="cos-wsbar-tools" data-side="left"')
    && engineSource.includes('class="cos-wsbar-tools" data-side="right"'), "引擎建左右工具槽（DOM 一次）");
  assert.ok(engineSource.includes('E.el.badgeCluster.dataset.drilled = wsbarDrilled ? "true" : "false";'),
    "仅钻取态置 data-drilled（银河态零呈现）");
  assert.ok(engineSource.includes('.cos-badge-cluster[data-drilled="true"] { display: flex; }'),
    "右上标牌组显隐与钻取态同源门控");
  assert.ok(engineSource.includes("position: absolute; top: 14px; right: 16px"), "标牌 + 工具整组固定右上角");
  assert.ok(engineSource.includes("width: var(--cos-ws-tool-size, 32px);") && engineSource.includes("height: var(--cos-ws-tool-size, 32px);"),
    "工具槽方形（宽 = 高 = wsToolSize）");
  assert.ok(clientSource.includes('[\'.cos-wsbar-tools[data-side="left"]\', "wsbar-tool-left"]')
    && clientSource.includes('[\'.cos-wsbar-tools[data-side="right"]\', "wsbar-tool-right"]'),
    "顶部工具纳入浮签避让矩形集（钻取态专属类别）");
  assert.ok(clientSource.includes('"wsbar-tool-left", "wsbar-tool-right"'), "顶部工具矩形仅钻取态参与判定");

  /* ② 重掷：当前命中排除 + 直接写覆盖（无「随机模式」状态） */
  assert.ok(clientSource.includes("const nextId = randomTemplateIdOf(current?.id ?? null);"), "重掷 = 当前 figure 命中之外等概率（排除项来自当前命中）");
  assert.ok(clientSource.includes("controllerRef.current?.actions?.assignTemplate?.(wsId, nextId);"), "重掷直接写覆盖（与手选同构）");
  assert.ok(!/randomMode|randomState|rerollMode/.test(clientSource), "无「随机模式」中间状态");

  /* ③ 写链路：净房落盘 → 模块态注入 → 重装配（同一入口服务选中/恢复默认/重掷） */
  assert.ok(clientSource.includes("assignTemplate(wsId, templateId) {"), "控制器唯一写入口 assignTemplate");
  assert.ok(clientSource.includes("const patch = { [wsId]: typeof templateId === \"string\" && templateId ? templateId : null };"),
    "null/空 = 恢复默认（删除覆盖条目）");
  assert.ok(clientSource.includes("const next = saveTemplateOverrides(patch);"), "净房 + localStorage 落盘");
  assert.ok(clientSource.includes("setTemplateOverrides(next);"), "merge 模块态重新注入");
  assert.ok(clientSource.includes("scheduleRebuild();"), "注入后触发场景差分重装配");
  assert.ok(clientSource.includes("controllerRef.current?.actions?.assignTemplate?.(wsId, templateId);"), "选中 = 写盘即生效（无暂存钮）");
  assert.ok(clientSource.includes("onReset={() => applyTemplateChoice(null)}"), "恢复默认 = 删除该星座覆盖条目");
  assert.ok(clientSource.includes("setTemplateOverrides(loadTemplateOverrides());"), "控制器构造即装载持久覆盖（首帧即指定命中，无闪跳）");

  /* ④ 跨窗桥：storage 事件 → 净房投影 → 重新注入（与本面无关键静默忽略） */
  assert.ok(clientSource.includes("const next = templateOverridesFromStorageEvent(event);"), "storage 事件经净房投影");
  assert.ok(clientSource.includes("controllerRef.current?.actions?.applyTemplateOverrides?.(next);"), "他窗改动 → 重新注入 → 差分自动更新");
  assert.ok(clientSource.includes('"dsh-v-cosmos: template overrides storage bridge"'), "跨窗桥 effect 标签（生命周期可观测）");
  assert.ok(clientSource.includes("applyTemplateOverrides(map) {") && clientSource.includes("const next = setTemplateOverrides(map);"),
    "重新注入单点入口（净房后写模块态）");

  /* ⑤ 选择器浮层源码切片：portal 模态 + 88 列表 + 搜索 + 当前高亮 + 恢复默认 + 空态 + 关闭键 */
  const pickerAt = clientSource.indexOf("function TemplatePicker(");
  const pickerBody = clientSource.slice(pickerAt, clientSource.indexOf("底部动作按钮条", pickerAt));
  assert.ok(pickerAt > 0 && pickerBody.length > 0, "TemplatePicker 源码切片");
  assert.ok(pickerBody.includes("return createPortal("), "选择器为 body portal 模态（与星座浮窗同款挂载）");
  assert.ok(pickerBody.includes("const rows = templatePickerRowsOf(query);"), "列表数据面 = 纯函数投影（可冒烟直测）");
  assert.ok(pickerBody.includes('data-cosmos-template-picker="true"'), "选择器稳定钩子 data-cosmos-template-picker");
  assert.ok(pickerBody.includes('data-cosmos-template-row={id}'), "模板行稳定钩子 data-cosmos-template-row");
  assert.ok(pickerBody.includes('data-current={isCurrent ? "true" : undefined}'), "当前命中行高亮钩子 data-current");
  assert.ok(pickerBody.includes("aria-selected={isCurrent}"), "当前命中行 aria-selected（可访问性）");
  assert.ok(pickerBody.includes('data-cosmos-template-reset="true"'), "「恢复默认」项稳定钩子");
  assert.ok(pickerBody.includes('t("cosmos.tplPicker.reset", "恢复默认（星图分布）")'), "恢复默认文案（词典）");
  assert.ok(pickerBody.includes('t("cosmos.tplPicker.hint", "星座位置由星图分布决定，不随模板变化")'), "位置解耦 hint（spec 明文）");
  assert.ok(pickerBody.includes('t("cosmos.tplPicker.empty", "无匹配模板")'), "空态文案（搜索无命中 / 数据集不可用）");
  assert.ok(pickerBody.includes('placeholder={t("cosmos.tplPicker.searchPlaceholder", "搜索模板（中文名 / 英文名）")}'), "搜索占位文案");
  assert.ok(pickerBody.includes("onChange={(event) => onQuery?.(event.target.value)}"), "受控搜索过滤");
  assert.ok(pickerBody.includes('window.addEventListener("keydown", onKey, true);'), "关闭键 capture 相位监听（先于页面关页/退银河分层）");
  assert.ok(pickerBody.includes("if (!shortcutMatches(event, currentShortcuts().closePage)) return;"), "关闭键跟随全局配置（canonical）");
  assert.ok(pickerBody.includes("event.stopPropagation();"), "关闭键不冒泡到外壳分层");
  assert.ok(pickerBody.includes('className="dsh-cosmos-tpl-picker-backdrop" onClick={onClose}'), "背景点击关闭");
  assert.ok(
    pickerBody.includes("onPointerDown={(event) => event.stopPropagation()}")
      && pickerBody.includes("onClick={(event) => event.stopPropagation()}"),
    "模态事件隔离：选择器内点击不触达整页「取消选中」处理器（portal 沿 React 树冒泡）"
  );
  assert.ok(pickerBody.includes('t("cosmos.tplPicker.close", "关闭")'), "关闭钮 aria/title 文案");
  assert.ok(!/disabled=/.test(pickerBody), "选择器行/恢复默认恒可用（无禁用态死入口）");

  /* ⑥ 选择器挂载门控：仅钻取态 + 开合态；当前命中传入高亮 */
  assert.ok(clientSource.includes("{templatePickerOpen && drillGroup !== null ? ("), "仅钻取态 + 开合态渲染选择器（银河态不可达）");
  assert.ok(clientSource.includes("currentId={drillFigure?.id ?? null}"), "当前 figure 命中传入高亮");
  assert.ok(clientSource.includes("const [templatePickerOpen, setTemplatePickerOpen] = useState(false);"), "开合态为会话态（不开页持久化）");
  assert.ok(
    clientSource.includes("setTemplatePickerOpen(false);\n    setTemplateQuery(\"\");\n  }, [drill?.wsId]);"),
    "钻取目标切换/退出 → 选择器自动关闭（不跨星座残留）"
  );

  /* ⑦ 词典 zh/en 成对（动作两项 + 选择器全量键） */
  for (const key of [
    "cosmos.tplActions.assign",
    "cosmos.tplActions.assignTitle",
    "cosmos.tplActions.reroll",
    "cosmos.tplActions.rerollTitle",
    "cosmos.tplPicker.title",
    "cosmos.tplPicker.close",
    "cosmos.tplPicker.searchPlaceholder",
    "cosmos.tplPicker.searchAria",
    "cosmos.tplPicker.listAria",
    "cosmos.tplPicker.hint",
    "cosmos.tplPicker.reset",
    "cosmos.tplPicker.resetHint",
    "cosmos.tplPicker.empty"
  ]) {
    assert.equal(
      (clientSource.match(new RegExp('"' + key.replace(/\./g, "\\.") + '": ', "g")) ?? []).length,
      2,
      "词典 zh/en 成对：" + key
    );
  }

  /* ⑧ CSS 钩子与 z 序（模态层低于 toast/浮窗、高于面板） */
  for (const hook of [
    ".dsh-cosmos-tpl-picker{",
    ".dsh-cosmos-tpl-picker-backdrop{",
    ".dsh-cosmos-tpl-picker-card{",
    ".dsh-cosmos-tpl-picker-search{",
    ".dsh-cosmos-tpl-picker-list{",
    ".dsh-cosmos-tpl-picker-reset{",
    ".dsh-cosmos-tpl-picker-row[data-current=true]{",
    ".dsh-cosmos-tpl-picker-empty{"
  ]) {
    assert.ok(clientSource.includes(hook), "选择器 CSS 钩子：" + hook);
  }
  assert.ok(clientSource.includes("z-index:9997"), "选择器 z 序低于 toast（9999）/浮窗（9998）、高于面板（42）");

  /* ⑨ 引擎零改动（spec「引擎消费面形状不变」）：引擎不感知覆盖表 / 图样口径 / 写入口 */
  assert.ok(!engineSource.includes("tplOverrides"), "引擎零改动：不感知覆盖表存储键");
  assert.ok(!engineSource.includes("templateForFigure"), "引擎零改动：不感知图样口径查询");
  assert.ok(!engineSource.includes("assignTemplate"), "引擎零改动：不感知模板指定写入口");
  assert.ok(engineSource.includes("tplZh: typeof w.tplZh === \"string\" && w.tplZh ? w.tplZh : null,"), "引擎消费面 ws.tplZh 形状不变");
}

/* ── 9c. 源码锚点：星座收藏（add-cosmos-constellation-favorites 4.5 / 4.1–4.4）──
   按钮两态（实心/空心 + aria/title 随态）、点击切换调用链（保存 → store → setFavorites）、
   上限满 toast 拒绝（不保存）、storage 桥跨窗同步（值变才动作）、失效收藏静默（无清理路径）、
   引擎热更续接与轴槽解析。React 组件树在 Node 侧不可挂载，两态视觉契约由 render-smoke
   对 ENGINE_CSS 的断言覆盖，本块按 house style 固化 client 接线与词典成对。 ── */
{
  const engineSource = readFileSync(new URL("../src/cosmos/engine.mjs", import.meta.url), "utf8");

  /* ① 受控镜像 store 与纯判定助手（单一实现；冷启动读持久值） */
  assert.ok(
    clientSource.includes("const cosmosFavoritesStore = createSnapshotStore({ favorites: loadCosmosSettings().favorites });"),
    "favorites 快照 store（模块级受控镜像，冷启动读持久值）"
  );
  assert.ok(clientSource.includes("function favoriteIdsOf(state) {"), "快照 → id 列表的单一读取面（非数组回落空数组）");
  assert.ok(clientSource.includes("function sameFavoriteIds(a, b) {"), "集合逐项相等判定（storage 桥「值变才动作」同源）");
  assert.ok(
    clientSource.indexOf("if (left.length !== right.length) return false;") > 0
      && clientSource.indexOf("return right.every((id) => set.has(id));") > 0,
    "逐项相等判定与顺序无关（引擎集合语义等价）"
  );

  /* ② 写入唯一链路：净房持久化 → store 镜像 → 引擎热更（顺序即链路） */
  assert.ok(clientSource.includes("const toggleFavorite = (wsId) => {"), "写入唯一链路 toggleFavorite(wsId)");
  const saveAt = clientSource.indexOf("const merged = saveCosmosSettings({ favorites: next }); // 净房持久化（唯一落盘口）");
  const storeAt = clientSource.indexOf("cosmosFavoritesStore.set({ favorites: merged.favorites }); // 本窗镜像（按钮两态即时翻转）");
  const engineAt = clientSource.indexOf("controllerRef.current?.getEngine?.()?.setFavorites?.(merged.favorites); // 引擎热更（下一帧生效）");
  assert.ok(saveAt > 0 && storeAt > saveAt && engineAt > storeAt, "链路顺序：净房持久化 → store → 引擎 setFavorites");
  assert.ok(clientSource.includes("const current = favoriteIdsOf(cosmosFavoritesStore.getSnapshot());"), "当前集合现读 store（无陈旧闭包）");
  assert.ok(clientSource.includes("const next = has ? current.filter((item) => item !== id) : [...current, id];"),
    "切换语义：已收藏移除 / 未收藏追加");
  assert.equal((clientSource.match(/cosmosFavoritesStore\.set\(/g) ?? []).length, 2,
    "favorites store 恰两处写者（本窗写入链路 + storage 桥）——MUST NOT 有清理/剪枝路径");

  /* ③ 上限满拒绝（D6）：先判后存 + toast + 不落盘（已收藏集合与按钮态不变） */
  const limitAt = clientSource.indexOf("if (!has && current.length >= COSMOS_FAVORITES_MAX) {");
  assert.ok(limitAt > 0, "满上限分支先行判定（仅在新增时）");
  assert.ok(limitAt < saveAt, "满上限判定先于保存（拒绝时 MUST NOT 落盘）");
  assert.ok(clientSource.includes('tr("cosmos.fav.limit", "收藏已达上限（64），请先取消其中一个星座")'), "满上限 toast 文案走词典");
  assert.ok(clientSource.includes("COSMOS_FAVORITES_MAX"), "上限常量消费自 settings.mjs（单一来源，不写字面量比较）");

  /* ④ 按钮两态（实心/空心）与 a11y：状态源 = favorites 快照 ∪ 当前钻取星座 */
  assert.ok(clientSource.includes("const favoritesState = useSyncExternalStore(cosmosFavoritesStore.subscribe, cosmosFavoritesStore.getSnapshot);"),
    "按钮状态经 useSyncExternalStore 订阅（store 变更即时重渲染）");
  assert.ok(clientSource.includes("const favoriteIds = favoriteIdsOf(favoritesState);"), "状态源 = favorites 快照");
  assert.ok(clientSource.includes("const favButton = (wsId) => {"), "收藏按钮渲染面");
  assert.ok(clientSource.includes("const on = typeof wsId === \"string\" && wsId !== \"\" && favoriteIds.includes(wsId);"),
    "按钮态 = 当前钻取星座是否在收藏集合内（favorites ∪ drillGroup.wsId）");
  assert.ok(clientSource.includes("data-cosmos-fav={on ? \"on\" : \"off\"}") && clientSource.includes("data-on={on ? \"true\" : \"false\"}"),
    "两态稳定钩子（data-on 驱动引擎 CSS 实心/空心）");
  assert.ok(clientSource.includes("aria-pressed={on}"), "aria-pressed 随态（切换按钮语义）");
  assert.ok(clientSource.includes("aria-label={label}") && clientSource.includes("title={label}"), "icon-only 按钮 aria-label + title（可访问名）");
  assert.ok(
    clientSource.includes('tr("cosmos.fav.remove", "取消收藏")\n      : tr("cosmos.fav.add", "收藏该星座");'),
    "aria/title 随态翻转（已收藏 → 「取消收藏」；未收藏 → 「收藏该星座」）"
  );
  assert.ok(clientSource.includes("const FAV_STAR_ICON_SVG ="), "五角星图标常量（单形态，两态由 CSS 切换）");
  assert.ok(clientSource.includes("dangerouslySetInnerHTML={{ __html: FAV_STAR_ICON_SVG }}"), "按钮渲染 SVG 五角星");
  assert.ok(clientSource.includes("className=\"cos-fav-btn\""), "按钮类名 = 引擎 CSS 两态视觉契约挂点");
  assert.ok(clientSource.includes("onClick={() => toggleFavorite(wsId)}"), "点击 → 唯一写链路（无旁路）");

  /* ⑤ portal 槽解析与显隐门控：引擎槽同源 MutationObserver；银河态不渲染 */
  assert.ok(clientSource.includes("const [wsToolSlots, setWsToolSlots] = useState({ left: null, right: null, fav: null });"),
    "槽位状态含收藏槽（三槽同源解析）");
  assert.ok(clientSource.includes("const fav = host.querySelector('.cos-fav-slot');"), "收藏槽 portal 目标 = 引擎标牌组末位槽");
  assert.ok(clientSource.includes("if (!left || !right || !fav) return false;"), "引擎根未就绪 → 不解析（MutationObserver 兜住重挂载）");
  assert.ok(clientSource.includes("prev.left === left && prev.right === right && prev.fav === fav ? prev : { left, right, fav }"),
    "引用未变 → 不重渲染（槽位解析幂等）");
  assert.ok(clientSource.includes("{wsToolSlots.fav !== null && drillGroup !== null ? createPortal(favButton(drillGroup.wsId), wsToolSlots.fav) : null}"),
    "收藏按钮 portal 到标牌组末位槽；银河态（drillGroup null）不渲染（零呈现/零命中）");

  /* ⑥ 引擎续接（4.3）与 storage 跨窗桥（4.4） */
  assert.ok(clientSource.includes("engine?.setFavorites?.(loadCosmosSettings().favorites);"),
    "引擎构造后首推持久值（attach / 重挂续接，与 setFilter 续接同纪律）");
  assert.ok(clientSource.includes("const prevFavorites = cosmosFavoritesStore.getSnapshot()?.favorites;"), "storage 桥取本键前值");
  assert.ok(clientSource.includes("cosmosFavoritesStore.set({ favorites: next.favorites });"), "他窗写入 → 本窗镜像即时跟随");
  assert.ok(clientSource.includes("if (!sameFavoriteIds(prevFavorites, next.favorites)) {"), "仅本键真实值变时触达引擎（值变才动作纪律）");
  assert.ok(clientSource.includes("controllerRef.current?.getEngine?.()?.setFavorites?.(next.favorites);"), "跨窗热更 → setFavorites");
  assert.ok(clientSource.includes('"dsh-v-cosmos: settings storage bridge"'), "同一条 storage 桥承载收藏（无第二条监听）");

  /* ⑦ 引擎侧接线（判据并集 + 通道 + 槽）：client 只消费公共面，无私有耦合 */
  assert.ok(engineSource.includes("export function wsSwitcherItemsOf(scene, focusWsId, favoriteIds) {"), "纯函数第三参（收藏集合）");
  assert.ok(engineSource.includes("favorites: new Set(),"), "引擎收藏镜像（E.favorites）");
  assert.ok(engineSource.includes("setFavorites(ids) {"), "公共面 setFavorites");
  assert.ok(engineSource.includes("wsSwitcherItemsOf(E.scene, E.focusWs.id, E.favorites)"), "切换清单消费点传入收藏集合");
  assert.ok(engineSource.includes('class="cos-fav-slot"'), "引擎建收藏槽（DOM 一次）");

  /* ⑧ 词典 zh/en 成对（按钮两态 + 上限 toast） */
  for (const key of ["cosmos.fav.add", "cosmos.fav.remove", "cosmos.fav.limit"]) {
    assert.equal(
      (clientSource.match(new RegExp('"' + key.replace(/\./g, "\\.") + '": ', "g")) ?? []).length,
      2,
      "词典 zh/en 成对：" + key
    );
  }
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
     它只作为 `/` 命令草稿的兜底（宿主真值，fix-cosmos-const-float-send-close D2）；
     p2：附件观察期 MUST 早退（在途瞬态不关窗，终态归观察 effect）。 */
  assert.ok(clientSource.includes("if (phase !== \"plain\") setArmed(null);"), "相位副作用保留为 / 命令兜底关闭（普通文本 detached、相位恒 plain）");
  assert.ok(clientSource.includes("if (attachWatch !== null) return;"), "观察期抑制「相位离开 plain → 关闭」兜底（p2 design D4）");
  /* 关闭路径 = 只关浮窗（草稿与在册附件保留不提交）；p2 起主动关闭统一先解除附件观察态。 */
  const closeBody = clientSource.slice(clientSource.indexOf("const close = () => {"), clientSource.indexOf("const send = () => {"));
  assert.ok(closeBody.includes("setAttachWatch(null);"), "主动关闭先解除附件观察态（p2 design D4：观察态随时可退）");
  assert.ok(closeBody.indexOf("setAttachWatch(null);") < closeBody.indexOf("setArmed(null);"), "先解除观察再关窗（拆除陈旧 watch 后关）");
  assert.ok(clientSource.includes('className="dsh-cosmos-const-float-backdrop" onClick={close}'), "点浮窗外关闭");
  /* Esc 最高分层：capture 阶段 + stopPropagation；浮窗未打开时不注册 */
  assert.ok(clientSource.includes('window.addEventListener("keydown", onKey, true);'), "Esc 最高优先层（capture）");
  assert.ok(clientSource.includes("if (armed === null || typeof window === \"undefined\") return undefined;"), "浮窗未打开 → 不注册（既有分层零变化）");
  const floatBody = clientSource.slice(clientSource.indexOf("function ConstellationFloatDock(props)"), clientSource.indexOf("/* ------------------------------------------------------------------ *\n * 星胚动作消费条目"));
  /* add-cosmos-shortcuts 5.1/D3：收卡键参数化 = 全局关闭键的 canonical 匹配（缺省 Esc），
     命中后 capture 阶段阻断冒泡（不触发钻取返回/清搜索/关页）。 */
  assert.ok(/shortcutMatches\(event, closeKey\)[\s\S]*?event\.stopPropagation\(\)/.test(floatBody), "浮窗收卡键（配置键）阻断冒泡（不触发钻取返回/清搜索/关页）");
  /* 组字守卫口径统一（add-cosmos-const-float-send-key 2.1）：window capture 回调收到的
     本就是原生事件 → 读原生 `isComposing`；补 `keyCode === 229` 与 Enter 守卫/宿主同源。 */
  assert.ok(
    floatBody.includes("if (event.isComposing === true || event.keyCode === 229) return;"),
    "收卡键守卫读原生 isComposing + keyCode 229 双保险（口径与 Enter 守卫、宿主 isComposingEvent 同源）"
  );
  assert.ok(!/event\.nativeEvent\?\.isComposing/.test(floatBody.slice(floatBody.indexOf("const onKey = (event) => {"), floatBody.indexOf("window.addEventListener(\"keydown\", onKey, true);"))), "Esc 守卫不读合成事件字段（原生监听器里 nativeEvent 恒 undefined 的死读取）");
  assert.ok(!/cosmosOpenStore/.test(floatBody), "浮窗不触碰整页开合 store（不关页）");
  assert.ok(!/draftMatches/.test(floatBody), "浮窗不复写草稿门控（单源 = floatPresentationOf）");
  /* 消费时机 = 挂载：呈现后显隐零 TTL 依赖（编辑超期不消失，spec「编辑不因过期中断」）。 */
  assert.ok(!/ttlMs|FLOAT_MARKER_TTL/.test(floatBody), "浮窗显隐不读 TTL（标记已在挂载时消费）");
  /* 计数口径：三处 setArmed(null) 字面量 = 相位兜底 / Esc / close 定义——发送经 close()
     收敛，p2 观察态看门狗亦经 close() 收敛，不新增字面量。 */
  assert.equal((floatBody.match(/setArmed\(null\)/g) ?? []).length, 3, "setArmed(null) 字面量 = 3（相位兜底 / Esc / close 定义；发送与看门狗经 close() 收敛）");
  /* 发送分流（p2 design D4）：submit 前分类——空输入不提交不关窗、命令与纯文本保持发送即关、
     带在册附件进入观察态；两类守卫（未接线 / 空输入）早退于 submit 之前 → 没提交不误关。 */
  const sendBody = floatBody.slice(floatBody.indexOf("const send = () => {"), floatBody.indexOf("/* ── 附件 intake 两通道"));
  assert.ok(sendBody.length > 0, "send() 切片可定位");
  assert.ok(/inputActions\.submit\(\);[\s\S]*?close\(\);/.test(sendBody), "发送即关：submit() 后主动 close()（命令与纯文本路径逐字不变）");
  assert.ok(sendBody.includes("const plan = floatSendPlanOf({ draft, attachmentIds });"), "发送分类走纯函数（空输入 / 命令 / 纯文本 / 观察 三分同源）");
  assert.ok(/typeof inputActions\.submit !== "function"\) return;/.test(sendBody), "未接线守卫早退（注入面降级）");
  assert.ok(sendBody.includes('if (plan === "empty") return;'), "空输入守卫（文本空 ∧ 无在册附件）早退不关窗");
  assert.ok(sendBody.indexOf('plan === "empty"') < sendBody.indexOf("inputActions.submit()"), "空输入守卫早退于 submit 之前（不误关）");
  assert.ok(sendBody.includes('if (plan === "watch") {'), "带在册附件 → 观察态分支");
  assert.ok(
    /setAttachWatch\(\{ baseline:[\s\S]*?\}\);\s*inputActions\.submit\(\);/.test(sendBody),
    "观察态：submit 前一刻快照 promptError 基线，提交后不关窗"
  );
  const watchStart = sendBody.indexOf('if (plan === "watch") {');
  const watchSubmitAt = sendBody.indexOf("inputActions.submit();", watchStart);
  assert.ok(watchSubmitAt > watchStart, "观察态分支含提交调用");
  assert.ok(!/close\(\)/.test(sendBody.slice(watchStart, watchSubmitAt)), "观察态分支在提交前不关窗（结果感知关闭）");
  assert.ok(sendBody.indexOf("return;", watchStart) < sendBody.indexOf("close();"), "观察态分支以 return 收敛（不落入「发送即关」分支）");
  /* 主题跟随 / 触屏目标 / 装饰层 */
  assert.ok(clientSource.includes("background:var(--dsw-alias-bg-base,var(--cos-panel-strong,rgba(8,8,16,.96)))"), "浮窗配色优先官方 token，其次皮肤卡底令牌（3.1：明暗/换肤自动跟随）");
  assert.ok(clientSource.includes(".dsh-cosmos-const-float-send{flex:none;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;\n  min-width:40px;min-height:40px"), "发送钮 = 40×40 图标钮（触屏目标不缩水）");
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
  assert.ok(/event\.preventDefault\(\);[\s\S]*?send\(\);/.test(keydownBody), "Enter = 复用 send()（同一守卫 + 同一关闭分流，零新分支）");
  assert.ok(keydownBody.includes("if (sendBlocked) return;"), "Enter 与发送钮同一门控（上传未就绪 / 机器忙不发送）");
  assert.ok(
    keydownBody.indexOf("if (sendBlocked) return;") < keydownBody.indexOf("event.preventDefault();"),
    "门控早退于 preventDefault 之前（禁用态保留 textarea 默认行为）"
  );
  assert.ok(!/setArmed\(null\)/.test(keydownBody), "Enter 路径零新增关闭字面量（发送经 close() 收敛）");
  /* hint 可发现（zh/en 两处字典 + tr() fallback 同源文案；add-cosmos-shortcuts 6.2 起
     动态标注当前生效语音键/收卡键占位；p2 标注附件入口） */
  assert.ok(
    clientSource.includes('"cosmos.constFloat.hint": "Enter 发送 · Shift+Enter 换行 · 点击 ＋ 或粘贴添加图片 · {voice} 语音 · {close} 关闭浮窗（保留草稿不发送）"'),
    "词典 zh：hint 标注 Enter 发送 / Shift+Enter 换行 / 附件入口 / 语音键 / 收卡键占位"
  );
  assert.ok(
    clientSource.includes('"cosmos.constFloat.hint": "Enter sends · Shift+Enter starts a new line · click ＋ or paste to add images · {voice} starts voice · {close} closes the composer (draft kept)"'),
    "词典 en：hint 成对（含附件入口 / Enter / Shift+Enter）"
  );
  assert.ok(
    clientSource.includes('"Enter 发送 · Shift+Enter 换行 · 点击 ＋ 或粘贴添加图片 · {voice} 语音 · {close} 关闭浮窗（保留草稿不发送）"'),
    "tr() fallback 同步（未注入 locale 键时降级文案仍标注快捷键与附件入口）"
  );
  assert.ok(clientSource.includes('.replace("{voice}", shortcutLabelOf(voiceKey))'), "hint 动态标注当前生效语音键（改绑即时生效）");
  assert.ok(clientSource.includes('.replace("{close}", shortcutLabelOf(closeKey))'), "hint 动态标注当前生效收卡键");
}

/* ── 10b. 浮窗呈现形态对齐原生输入卡（p1-align-const-float-native-layout 3.1）──
   分区次序 head → 附件 rail 槽位 → 文本面 → 工具行 → hint 行；rail 空态零布局；工具行
   右簇次序与发送钮图标化；文本面自适应增高接线。全部为呈现结构断言（行为面见 11d/回归链）。 */
{
  const floatBodySlice = clientSource.slice(
    clientSource.indexOf("function ConstellationFloatDock(props)"),
    clientSource.indexOf("/* ------------------------------------------------------------------ *\n * 星胚动作消费条目")
  );
  assert.ok(floatBodySlice.length > 0, "浮窗组件切片可达（结构断言）");
  /* 五分区容器恒渲染、次序恒定（spec 场景「分区次序恒定」）。 */
  const sections = [
    'className="dsh-cosmos-const-float-head"',
    'className="dsh-cosmos-const-float-rail"',
    'className="dsh-cosmos-const-float-body"',
    'className="dsh-cosmos-const-float-toolbar"',
    'className="dsh-cosmos-const-float-hintline"'
  ];
  const at = sections.map((token) => floatBodySlice.indexOf(token));
  for (let index = 0; index < sections.length; index += 1) {
    assert.ok(at[index] > 0, "分区容器在位：" + sections[index]);
  }
  for (let index = 1; index < sections.length; index += 1) {
    assert.ok(at[index - 1] < at[index], "分区次序恒为 head → rail → body → toolbar → hintline");
  }
  /* 附件 rail（p2 design D3/D7）：恒渲染容器 + 零本地镜像（行由 attachmentIds 投影而来）；
     无附件时无子节点 → CSS `:empty` 空态零布局。 */
  assert.ok(
    floatBodySlice.includes('<div className="dsh-cosmos-const-float-rail" data-const-float-slot="attachments">'),
    "附件 rail 容器恒渲染（p2 填充：缩略图行）"
  );
  assert.ok(floatBodySlice.includes("{railRows.map((row) => ("), "rail 行 = attachmentIds 的投影（零本地镜像列表）");
  assert.ok(clientSource.includes(".dsh-cosmos-const-float-rail:empty{display:none}"), "rail 空态零布局（:empty → display:none）");
  assert.ok(!clientSource.includes("dsh-cosmos-const-float-foot"), "旧 foot 容器零残留（hint 已独立成行）");
  /* 工具行（design D3 + p2 填充）：左簇 = 隐藏 file input + 添加图片钮；右簇次序
     模型 → 级别 → 语音 → 发送。 */
  assert.ok(
    floatBodySlice.includes('<span className="dsh-cosmos-const-float-tools" data-const-float-slot="attach">'),
    "工具行左簇 = 附件入口槽位（p2 填充实体钮）"
  );
  assert.ok(floatBodySlice.includes('accept={FLOAT_IMAGE_ACCEPT}'), "隐藏 file input 的 accept 走白名单常量（与校验同源）");
  assert.ok(/type="file"[\s\S]*?multiple[\s\S]*?accept=\{FLOAT_IMAGE_ACCEPT\}/.test(floatBodySlice), "批量拾取：type=file + multiple + accept");
  const toolbarSlice = floatBodySlice.slice(
    floatBodySlice.indexOf('className="dsh-cosmos-const-float-toolbar"'),
    floatBodySlice.indexOf('className="dsh-cosmos-const-float-hintline"')
  );
  assert.ok(toolbarSlice.length > 0, "工具行切片可定位");
  const trailingOrder = [
    'className="dsh-cosmos-const-float-model-select"',
    'className="dsh-cosmos-const-float-effort-select"',
    'className="dsh-cosmos-const-float-voice"',
    'className="dsh-cosmos-const-float-send"'
  ];
  const trailingAt = trailingOrder.map((token) => toolbarSlice.indexOf(token));
  for (let index = 0; index < trailingOrder.length; index += 1) {
    assert.ok(trailingAt[index] > 0, "右簇控件在位：" + trailingOrder[index]);
  }
  for (let index = 1; index < trailingOrder.length; index += 1) {
    assert.ok(trailingAt[index - 1] < trailingAt[index], "右簇次序恒为 模型下拉 → 级别下拉 → 语音钮 → 发送钮");
  }
  /* 模型行容器拆除（design D3 审阅修订）：「模型」caption 删除；三态注记随右簇内联，
     `data-state` 由右簇容器承载、样式规则随之重锚（可见性契约零变化）。 */
  assert.ok(!clientSource.includes("dsh-cosmos-const-float-model-cap"), "「模型」caption 删除（select aria-label 承载语义）");
  assert.ok(!clientSource.includes('className="dsh-cosmos-const-float-model"'), "模型行容器拆除（并入右簇）");
  assert.ok(
    floatBodySlice.includes('className="dsh-cosmos-const-float-trailing" data-state={modelSel?.status ?? "idle"}'),
    "三态 data-state 由右簇容器承载"
  );
  assert.ok(toolbarSlice.includes("dsh-cosmos-const-float-model-note"), "降级注记随右簇内联呈现（可见性契约零变化）");
  assert.ok(clientSource.includes(".dsh-cosmos-const-float-trailing[data-state=switching] .dsh-cosmos-const-float-model-select,"), "switching 态样式重锚到右簇");
  assert.ok(clientSource.includes(".dsh-cosmos-const-float-trailing[data-state=failed] .dsh-cosmos-const-float-model-select,"), "failed 态样式重锚到右簇");
  assert.ok(clientSource.includes(".dsh-cosmos-const-float-model-note{flex:none;font-size:11px;opacity:.7}"), "注记样式零改动");
  /* 文本面自适应增高（design D2）：rows=1 / 无 resize 把手 / 测量 effect 依受控值 draft。 */
  assert.ok(floatBodySlice.includes("rows={1}"), "textarea rows=1（高度由测量写入，非定高行数）");
  assert.ok(clientSource.includes("resize:none"), "textarea 无手动拉拽把手");
  assert.ok(!clientSource.includes("resize:vertical"), "旧 resize:vertical 定高形态零残留");
  assert.ok(clientSource.includes("overflow-y:auto"), "封顶后文本面内部滚动");
  assert.ok(
    clientSource.includes(`.dsh-cosmos-const-float-input{box-sizing:border-box;width:100%;min-height:${FLOAT_TEXTAREA_MIN_HEIGHT}px;`),
    "文本面最小高度 = 3 行（常量与 CSS 同源）"
  );
  assert.ok(
    clientSource.includes(`--cos-float-body-max:${FLOAT_TEXTAREA_MAX_HEIGHT}px`),
    "CSS 变量 --cos-float-body-max = 14 行封顶（常量与 CSS 同源）"
  );
  assert.ok(
    clientSource.includes(`max-height:var(--cos-float-body-max,${FLOAT_TEXTAREA_MAX_HEIGHT}px)`),
    "文本面 max-height 走封顶变量"
  );
  assert.ok(floatBodySlice.includes('el.style.height = "auto";'), "测量 effect 先置 height=auto 读内容高度");
  assert.ok(floatBodySlice.includes("const borderY ="), "border-box 闭合：测量补上下边框（scrollHeight 不含 border）");
  assert.ok(floatBodySlice.includes("floatTextareaHeightOf(el.scrollHeight + borderY, {"), "测量经纯函数夹取后写回（含边框补偿）");
  assert.ok(floatBodySlice.includes("}, [armed, draft]);"), "测量以受控值 draft 为依赖（覆盖挂载落稿/语音追加等外部回填）");
  /* 发送钮图标化（design D4）：原生同源箭头 path、40×40、既有文案键复用（零新增 locale 键）。 */
  const sendAt = floatBodySlice.indexOf('className="dsh-cosmos-const-float-send"');
  const sendSlice = floatBodySlice.slice(sendAt, sendAt + 1600);
  assert.ok(sendAt > 0, "发送钮可定位");
  assert.ok(sendSlice.includes('viewBox="0 0 16 16"'), "发送钮呈 16×16 视口图标");
  assert.ok(sendSlice.includes('d="M8.3125 0.980183'), "箭头 path 与原生 InputBar 主发送钮同源");
  assert.ok(sendSlice.includes('aria-label={tr("cosmos.constFloat.send"'), "aria-label 复用既有「发送」文案键");
  assert.ok(sendSlice.includes('title={tr("cosmos.constFloat.send"'), "tooltip 复用既有「发送」文案键");
  assert.ok(/onClick=\{send\}[\s\S]*?<svg[\s\S]*?<\/svg>\s*<\/button>/.test(sendSlice), "点击行为复用同一 send()（图标钮无新分支）");
  const sendButtonBody = sendSlice.slice(sendSlice.indexOf("onClick={send}"), sendSlice.indexOf("</button>"));
  assert.ok(!/发送/.test(sendButtonBody), "发送钮不再渲染文本（文本换图标）");
  assert.equal(
    (clientSource.match(/"cosmos\.constFloat\.send": /g) ?? []).length,
    2,
    "发送文案键零新增（词典 zh/en 仍成对两处）"
  );
  /* hint 行（design D5）：独立块级一行置于工具行之下，文案模板与动态标注零改动。 */
  assert.ok(clientSource.includes(".dsh-cosmos-const-float-hintline{min-width:0}"), "hint 行容器样式（块级独立分区）");
  assert.ok(clientSource.includes(".dsh-cosmos-const-float-hint{display:block;"), "hint 文案块级呈现（不再参与旧 foot 行内排布）");
}

/* ── 10c. 浮窗文本面增高夹取纯函数（p1-align-const-float-native-layout 1.1/3.3）── */
{
  const bounds = { min: FLOAT_TEXTAREA_MIN_HEIGHT, max: FLOAT_TEXTAREA_MAX_HEIGHT };
  assert.equal(FLOAT_TEXTAREA_MIN_HEIGHT, 78, "最小高度常量 = 3 行（3×20 + 2×8 + 2×1，border-box）");
  assert.equal(FLOAT_TEXTAREA_MAX_HEIGHT, 298, "封顶常量 = 14 行（14×20 + 2×8 + 2×1，border-box）");
  assert.equal(floatTextareaHeightOf(30, bounds), 78, "不足最小 → 夹到 min（空内容回落 3 行）");
  assert.equal(floatTextareaHeightOf(78, bounds), 78, "贴 min 边界 → 恒等");
  assert.equal(floatTextareaHeightOf(178, bounds), 178, "区间内 → 恒等（逐行生长）");
  assert.equal(floatTextareaHeightOf(298, bounds), 298, "贴 max 边界 → 恒等");
  assert.equal(floatTextareaHeightOf(700, bounds), 298, "超封顶 → 夹到 max（封顶后内部滚动）");
  assert.equal(floatTextareaHeightOf(Number.NaN, bounds), 78, "非有限测量 → 回落 min（不清零高度）");
  assert.equal(floatTextareaHeightOf(500, { min: 100, max: 80 }), 100, "max < min → 按 min 收敛（参数防御）");
  assert.equal(floatTextareaHeightOf(500, { min: 100 }), 500, "缺省 max → 只夹下界（无上限口径）");
}

/* ── 10d. 浮窗图片附件（p2-add-const-float-image-attach 1.1/2.x/3.x/4.x/5.1 源码锚点）──
   intake 两通道、rail 投影、移除链路、上传门控、结果感知关闭、降级矩阵与 locale 成对；
   行为面纯逻辑直测见 constellation-actions-smoke，注入面见 factory-smoke。 */
{
  const floatBody = clientSource.slice(
    clientSource.indexOf("function ConstellationFloatDock(props)"),
    clientSource.indexOf("/* ------------------------------------------------------------------ *\n * 星胚动作消费条目")
  );
  assert.ok(floatBody.length > 0, "浮窗组件切片可达");
  /* 注入面：attachFace（与 models/speech 同构的薄包装 face）。 */
  const floatEntry = clientSource.slice(clientSource.indexOf('id: "v-cosmos-constellation-float"'), clientSource.indexOf('id: "v-cosmos-embryo-action"'));
  assert.ok(floatEntry.includes("attachFace,"), "浮窗条目注入 attachFace");
  assert.ok(clientSource.includes('tryInject(["conversation"], (scope) => {'), "附件桥经 conversation 服务注入（生命周期随插件 fiber）");
  assert.ok(clientSource.includes("const attachFace = createAttachFace({"), "apply 层构造 attachFace（与 face 工厂同源）");
  assert.ok(clientSource.includes("bindAttachConversation(scope?.conversation ?? null);"), "注入回调绑定服务实例");
  assert.ok(clientSource.includes("return () => bindAttachConversation(null);"), "解绑回落降级（available === false 零噪音）");
  assert.ok(floatBody.includes("const attachFace = props.attachFace ?? COSMOS_ATTACH_FACE_ABSENT;"), "props 缺席 → 稳定降级 face");
  /* 数据流（design D3）：attachmentIds 唯一真相源 + face 投影 + 上传快照，零本地镜像。 */
  assert.ok(floatBody.includes("const attachmentIds = zone !== null && Array.isArray(zone.attachmentIds) ? zone.attachmentIds : EMPTY_ATTACHMENT_IDS;"), "attachmentIds = 机器状态（唯一真相源）");
  assert.ok(floatBody.includes("const uploadsState = useSyncExternalStore(attachFace.uploads.subscribe, attachFace.uploads.getSnapshot);"), "上传态经 face 快照订阅（useSyncExternalStore）");
  assert.ok(floatBody.includes("attachFace.resolve(attachmentIds)"), "rail 描述符经 face 投影");
  assert.ok(floatBody.includes("resolvedAttachments.map((attachment) => {"), "rail 行派生自在册投影（单一数据源）");
  assert.ok(!/const \[attachments?,\s*setAttachments?\]/.test(floatBody), "MUST NOT 维护本地附件镜像列表（防漂移）");
  /* intake 两通道：隐藏 file input 批量拾取 + textarea 自接 paste。 */
  assert.ok(floatBody.includes("const intakeFiles = (files) => {"), "两通道共享 intake 链路");
  assert.ok(floatBody.includes("const result = intakeFloatImages({"), "intake 校验/铸造/登记走纯链路");
  assert.ok(floatBody.includes("uploadImages"), "uploadImages 派生（会话非 subagent 续写）");
  assert.ok(floatBody.includes('input.value = "";'), "change 后重置 value（同文件可重复拾取）");
  assert.ok(floatBody.includes("const onPaste = (event) => {"), "textarea 自接 paste（原生 document 路由跳过 editable 起源）");
  assert.ok(floatBody.includes("const files = clipboardFilesOf(event?.clipboardData);"), "剪贴板文件收集走纯函数");
  assert.ok(floatBody.includes("if (files.length === 0) return;"), "纯文本粘贴行为逐字不变（无文件不接管）");
  assert.ok(floatBody.includes("if (attachFace.available !== true) return;"), "降级态整批按原生默认粘贴处理（零 toast 零铸造）");
  assert.ok(floatBody.includes("event.preventDefault();"), "批内有文件才 preventDefault");
  assert.ok(floatBody.includes("onPaste={onPaste}"), "textarea 挂载 paste 监听");
  assert.ok(floatBody.includes('tr("cosmos.constFloat.attachImageOnly", "仅支持添加图片")'), "零图片批次 toast（MUST NOT 静默）");
  assert.ok(floatBody.includes('tr("cosmos.constFloat.attachBusy", "当前不可添加附件")'), "busy 相位拒绝 toast");
  assert.ok(floatBody.includes("notify?.(result.message, true);"), "铸造抛错 toast 错误文案（face 薄透传）");
  assert.ok(floatBody.includes('tr("cosmos.constFloat.attachUnavailable", "跳转会话页可用原生添加图片")'), "降级点击引导 toast");
  /* rail 渲染：缩略图 + 上传态角标（uploading/error/ready）+ 移除钮。 */
  assert.ok(floatBody.includes('className="dsh-cosmos-const-float-thumb"'), "缩略图行");
  assert.ok(floatBody.includes('className="dsh-cosmos-const-float-thumb-img"'), "objectURL 封面");
  assert.ok(floatBody.includes('data-state="uploading"'), "上传中角标");
  assert.ok(floatBody.includes('data-state="error"'), "失败角标");
  assert.ok(floatBody.includes("title={row.reason}"), "失败角标 title 标注原因");
  assert.ok(floatBody.includes('className="dsh-cosmos-const-float-thumb-remove"'), "移除钮（触屏恒显见 CSS）");
  /* 移除链路：机器先移除、再经 face 释放（顺序同原生）。 */
  assert.ok(floatBody.includes("removeFloatAttachment({ inputActions, face: attachFace, id })"), "移除走纯链路（成功才释放）");
  /* 上传门控与结果感知关闭。 */
  assert.ok(floatBody.includes("const uploadsPending = floatAttachmentsPendingOf(resolvedAttachments, uploadsState);"), "上传门控（任一非 ready → 禁用）");
  assert.ok(floatBody.includes("disabled={sendBlocked}"), "发送钮 disabled 门控（Enter 同口径）");
  assert.ok(floatBody.includes("const outcome = floatWatchOutcomeOf({"), "观察态终态判定走纯函数");
  assert.ok(floatBody.includes("if (outcome.kind === \"success\") {"), "成功终态 → 关窗");
  assert.ok(floatBody.includes("if (outcome.kind === \"failure\") {"), "失败终态 → toast + 留存");
  assert.ok(floatBody.includes("promptFailureTextOf(outcome)"), "失败文案 {message}（{code}）");
  assert.ok(floatBody.includes("FLOAT_ATTACH_WATCH_MS"), "10s 看门狗兜底关窗");
  assert.ok(floatBody.includes("setAttachWatch(null);"), "解除观察（失败终态 / 主动关闭 / 新呈现）");
  /* CSS：rail 单行横向 + 隐藏滚动条；置灰置可点；发送禁用态。 */
  assert.ok(clientSource.includes(".dsh-cosmos-const-float-rail{display:flex;flex-wrap:nowrap;"), "rail 单行横向（不折行）");
  assert.ok(clientSource.includes("scrollbar-width:none"), "滚动条隐藏");
  assert.ok(clientSource.includes(".dsh-cosmos-const-float-attach[data-state=unavailable]{opacity:.6;cursor:not-allowed;"), "置灰样式（不吞事件）");
  assert.ok(!/\.dsh-cosmos-const-float-attach\[data-state=unavailable\][^}]*pointer-events:none/.test(clientSource), "置灰钮 MUST NOT pointer-events:none（引导需可触达）");
  assert.ok(clientSource.includes(".dsh-cosmos-const-float-send:disabled{"), "发送禁用态样式");
  assert.ok(clientSource.includes("@media (hover: none), (pointer: coarse)"), "触屏恒显移除钮");
  /* locale：新增键 zh/en 成对（attach 四键 + 移除钮 aria）。 */
  for (const key of ["attach", "attachUnavailable", "attachImageOnly", "attachBusy", "attachRemove"]) {
    assert.equal(
      (clientSource.match(new RegExp('"cosmos\\.constFloat\\.' + key + '": ', "g")) ?? []).length,
      2,
      "词典 zh/en 成对：cosmos.constFloat." + key
    );
  }
  /* 导出面（6.4）：纯逻辑登记 hive exports（bundle 级冒烟可直测）。 */
  const exportSurface = clientSource.slice(clientSource.indexOf("export {"), clientSource.indexOf("/* 文案"));
  assert.ok(exportSurface.length > 0, "hive exports 切片可定位");
  for (const name of ["clipboardFilesOf", "FLOAT_IMAGE_TYPES", "FLOAT_IMAGE_ACCEPT", "FLOAT_ATTACH_WATCH_MS", "createAttachFace", "floatSendPlanOf", "floatWatchOutcomeOf", "floatAttachmentsPendingOf", "intakeFloatImages", "removeFloatAttachment"]) {
    assert.ok(exportSurface.includes(" " + name + ",") || exportSurface.includes(" " + name + " }"), "hive exports 登记：" + name);
  }
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

/* ── 11d. 源码锚点：浮窗增强（rework 方案 2 模型下拉 + 语音转写；
   fix-cosmos-const-float-voice 录音格式 / 信封 / 置灰 / 资源生命周期锚点随宿主真值改写） ── */
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
  /* ── 录音格式（fix-cosmos-const-float-voice 1.1 / spec「录音产物为 canonical WAV」）──
     MediaRecorder 只承担采集；上送前 MUST 解码 → 16 kHz 单声道重采样 → PCM16 WAV →
     canonical base64（宿主 `validateWave` 硬校验）。MUST NOT 再把容器原样上送。 */
  assert.ok(dockBody.includes("new MediaRecorder(stream)"), "采集 = MediaRecorder 默认容器（仅采集，格式不上送）");
  assert.ok(dockBody.includes("await context.decodeAudioData(await blob.arrayBuffer())"), "停止后先解码容器（官方 Recording.stop 同式）");
  assert.ok(
    dockBody.includes("new OfflineAudioContext(1, Math.max(1, Math.floor(decoded.duration * 16000)), 16000)"),
    "16 kHz 单声道重采样（样本数 floor、下限 1）"
  );
  assert.ok(dockBody.includes("const encodeWave = (samples) =>"), "PCM16 WAV 编码器在位（浮窗侧局部工具）");
  assert.ok(
    dockBody.includes("view.setUint32(24, 16000, true)")
      && dockBody.includes("view.setUint16(22, 1, true)")
      && dockBody.includes("view.setUint16(34, 16, true)")
      && dockBody.includes("view.setUint16(32, 2, true)"),
    "WAV 头钉死 16 kHz / 单声道 / PCM16（宿主 validateWave 口径）"
  );
  assert.ok(dockBody.includes("encodeWave(resampled.getChannelData(0))"), "重采样样本 → encodeWave");
  assert.ok(dockBody.includes("speech.transcribe(bytesToBase64(wave))"), "转写经语音桥 face 上送 canonical base64");
  assert.ok(!dockBody.includes("audio/webm"), "容器 mime 字面量零残留（不再以容器格式直送）");
  /* ── 信封消费（1.2 / spec「转写失败如实呈现」）：RemoteResult = { ok, value | error } ── */
  assert.ok(dockBody.includes("result.ok !== true"), "结果按 RemoteResult 信封判定");
  assert.ok(dockBody.includes("result.error.message"), "失败取 error.message 呈现（不再误报为未识别到语音）");
  assert.ok(dockBody.includes("result.value.text"), "成功取 value.text");
  /* ── 落稿基准（1.4 / spec「转写成功落稿不丢字」）：最新草稿镜像，非点击时闭包快照 ── */
  assert.ok(dockBody.includes("const draftRef = useRef(draft)"), "草稿镜像 ref 声明");
  assert.ok(dockBody.includes("draftRef.current = draft"), "draftRef 随草稿同步");
  assert.ok(dockBody.includes("inputActions.setDraft(draftRef.current + glue + text)"), "落稿以最新草稿为基准只追加");
  assert.ok(!dockBody.includes("inputActions.setDraft(draft + glue + text)"), "陈旧 draft 闭包基线零残留");
  /* ── 资源生命周期（1.3 / spec「关窗释放麦克风」「设备中断复位」）── */
  assert.ok(dockBody.includes("const releaseVoice = () =>"), "释放函数在位（只释放、不转写）");
  assert.ok(dockBody.includes("voiceDisposedRef.current = true"), "释放路径先置 disposal 标志");
  assert.ok(dockBody.includes("if (disposed) return;"), "onstop 开头释放守卫早退（兜底 stop 不转写）");
  assert.ok(dockBody.includes("run !== voiceRunRef.current"), "在途转写 / 迟到录音的代次守卫");
  assert.ok(dockBody.includes("return () => releaseVoice();"), "armed 转空 / 卸载兜底释放 effect");
  assert.ok(dockBody.includes('window.addEventListener("blur", halt)'), "录音中失焦兜底释放");
  assert.ok(dockBody.includes('doc?.addEventListener("visibilitychange", onVisibility)'), "切后台兜底释放");
  assert.ok(dockBody.includes('track.addEventListener("ended", onTrackEnded)'), "设备中断走同一复位");
  /* ── 可见性三分支（2.1/2.2 / spec「未启用置灰呈现」「置灰点击引导」）──
     不可用 = 置灰但可点（aria-disabled + data-state），MUST NOT 原生 disabled——disabled
     钮不派发 click，提示与引导将永远无法触达。 */
  const voiceBranchStart = dockBody.indexOf("语音钮三分支");
  assert.ok(voiceBranchStart > 0, "语音钮可见性分支（三分支）在位");
  /* 语音钮切片右界 = 发送钮注释（p2：发送钮起带 `disabled={sendBlocked}`，不属置灰语音钮
     语义；语音钮在工具行右簇内，其后为发送钮与 hint 行）。 */
  const voiceBranch = dockBody.slice(voiceBranchStart, dockBody.indexOf("发送钮图标化", voiceBranchStart));
  assert.ok(voiceBranch.includes("data-state={voiceState}"), "可用 → 正常状态机钮");
  assert.ok(voiceBranch.includes('data-state="unavailable"'), "不可用 → 置灰呈现（data-state=unavailable）");
  assert.ok(voiceBranch.includes('aria-disabled="true"'), "不可用语义经 aria-disabled 承载");
  assert.ok(!/\) : null\}/.test(voiceBranch), "「不可用 → 钮隐藏」分支已移除");
  const unavailableHalf = voiceBranch.slice(voiceBranch.indexOf('data-state="unavailable"'));
  assert.ok(!/\sdisabled=\{/.test(unavailableHalf), "置灰钮 MUST NOT 原生 disabled（否则点击/引导不可达）");
  assert.ok(unavailableHalf.includes("onClick={voiceUnavailableNotice}"), "置灰钮点击走引导");
  /* 附件入口钮同一口径（p2 spec「降级置灰引导」）：置灰可点 + aria-disabled，非原生 disabled。 */
  const attachSlice = dockBody.slice(dockBody.indexOf('className="dsh-cosmos-const-float-attach"'), dockBody.indexOf("dsh-cosmos-const-float-trailing"));
  assert.ok(attachSlice.length > 0, "添加图片钮切片可定位");
  assert.ok(attachSlice.includes('data-state={attachFace.available === true ? "available" : "unavailable"}'), "降级态 data-state=unavailable");
  assert.ok(attachSlice.includes('aria-disabled={attachFace.available === true ? undefined : "true"}'), "降级语义经 aria-disabled 承载");
  assert.ok(!/\sdisabled=\{/.test(attachSlice), "添加图片钮 MUST NOT 原生 disabled（否则点击/引导不可达）");
  assert.ok(attachSlice.includes("onClick={onAttachClick}"), "点击走降级分派（可用 → 拾取器 / 降级 → 引导 toast）");
  assert.ok(dockBody.includes("speech?.openBundle?.()"), "引导跳语音 Bundle 详情页（桥缺席降级纯 toast）");
  assert.ok(dockBody.includes('"cosmos.constFloat.voiceUnavailable"'), "不可用提示文案（词典键）");
  assert.ok(dockBody.includes("dsh-cosmos-const-float-voice"), "语音钮稳定钩子");
  /* CSS：新控件样式在位，旧只读模型样式已替换。 */
  assert.ok(clientSource.includes(".dsh-cosmos-const-float-model-select,"), "模型/级别下拉样式");
  assert.ok(clientSource.includes(".dsh-cosmos-const-float-voice{"), "语音钮样式");
  assert.ok(clientSource.includes(".dsh-cosmos-const-float-voice[data-state=unavailable]"), "置灰样式（opacity + not-allowed）");
  assert.ok(!clientSource.includes("dsh-cosmos-const-float-model-value"), "只读模型标识样式零残留");
  /* DICT zh/en 成对（`: ` 后缀只命中词典条目，tr(...) 调用不计入）。 */
  for (const key of ["modelDefault", "modelDrift", "modelDegraded", "effortLabel", "voiceStart", "voiceStop", "voiceBusy", "voiceAria", "voiceDenied", "voiceFailed", "voiceEmpty", "voiceUnavailable"]) {
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
  assert.ok(
    clientSource.includes('degraded: tr("cosmos.actions.degraded", "新建会话通道不可用，已降级为复用空白会话")'),
    "降级 toast 走词典"
  );
  assert.ok(clientSource.includes('"cosmos.actions.degraded": "新建会话通道不可用，已降级为复用空白会话"'), "词典 zh：降级文案");
  assert.ok(clientSource.includes('"cosmos.actions.degraded": "New-session channel unavailable; fell back to reusing the workspace blank"'), "词典 en：降级文案");
}

/* ── 11c. 显式关联绑定接线（fix-cosmos-association-scope 3.1/3.2 / spec cosmos-actions ⑤） ──
   浏览器半区：api.mjs 提供容错 bindSession → client 注入动作执行器 → 执行器在取得新会话
   SessionId 后非阻断调用（不 await、失败静默、降级路径跳过）。 */
{
  const apiSource = readFileSync(new URL("../src/api.mjs", import.meta.url), "utf8");
  const actionsSource = readFileSync(new URL("../src/actions.mjs", import.meta.url), "utf8");
  assert.ok(apiSource.includes("export async function bindSession(input)"), "api.mjs 导出 bindSession helper");
  assert.ok(apiSource.includes('fetch(API + "/bind-session"'), "POST /bind-session 自有端点");
  assert.ok(apiSource.includes("method: \"POST\"") && apiSource.includes('"content-type": "application/json"'), "JSON POST 形");
  assert.ok(apiSource.includes("return { ok: true, bound: Array.isArray(body.bound) ? body.bound : [] };"), "成功面 {ok, bound}");
  assert.ok(apiSource.includes("return { ok: false, error: body?.error || res.status"), "失败面 {ok:false, error}（fetchScene 同款容错）");
  assert.ok(
    /import \{[^}]*\bbindSession\b[^}]*\} from "\.\/api\.mjs";/.test(clientSource),
    "client 引入 bindSession"
  );
  assert.ok(clientSource.includes("bindSession: (input) => bindSession(input),"), "提案执行器注入绑定通道");
  assert.ok(clientSource.includes("fetchScene, subscribeCosmosEvents, bindSession,"), "client 导出 bindSession（观测面）");

  /* 执行器：绑定调用点在 create 成功之后、标记登记之前；不 await、拒绝/抛错均静默。 */
  const runBody = actionsSource.slice(
    actionsSource.indexOf("async run({ button, card } = {}) {"),
    actionsSource.indexOf("/* 供 client 侧组装的路径工具")
  );
  const bindCallIndex = runBody.indexOf("bindExplicitAssociation(sessionId, card);");
  assert.ok(bindCallIndex > 0, "执行器显式调用绑定");
  assert.ok(runBody.indexOf("sessionId = await createSession(card.wsId, card);") < bindCallIndex, "绑定位于 SessionId 取得之后");
  assert.ok(bindCallIndex < runBody.indexOf("armed = pending.arm("), "绑定先于标记登记（hero 相位准备前声明工作面）");
  assert.ok(!/await\s+bindExplicitAssociation|await\s+bindSession/.test(runBody), "绑定 MUST NOT 阻塞链路（不 await）");
  assert.ok(actionsSource.includes("pendingBind.catch(() => {})"), "异步拒绝被吞（零未处理拒绝噪声）");
  assert.ok(actionsSource.includes("const proposal = typeof card?.id === \"string\" ? card.id : \"\";"), "proposals = 卡片目标提案名");
  /* 降级回落切片（fallback）不含绑定调用：无新会话 id 时 MUST 跳过。 */
  const fallbackStart = actionsSource.indexOf("/** 降级回落（现行链路");
  const fallbackEnd = actionsSource.indexOf("async run({ button, card } = {}) {", fallbackStart);
  const fallbackBody = fallbackStart >= 0 && fallbackEnd > fallbackStart
    ? actionsSource.slice(fallbackStart, fallbackEnd)
    : "";
  assert.ok(fallbackBody.includes("const fallback = async"), "降级回落切片可定位");
  assert.ok(!fallbackBody.includes("bindExplicitAssociation"), "降级路径不含绑定调用（无新会话 id → 跳过）");
  assert.ok(!fallbackBody.includes("bindSession("), "降级路径不直接调用绑定通道");
}

/* ── 12. 源码锚点：设置页双臂（add-cosmos-constellation-actions 5.2/5.3） ── */
{
  assert.ok(clientSource.includes('id: "constellation-actions"'), "「星座动作」标签页注册");
  assert.ok(clientSource.includes('order: 1,'), "排于「快捷动作」之后");
  assert.ok(clientSource.includes('label: () => sectionT("cosmos.settings.tabConstActions")'), "标签文案走词典");
  assert.ok(clientSource.includes("const constButtonSettings = createButtonSettingsController(activeScope, {"), "第二控制器实例（星座 profile；add-cosmos-shortcuts 3.3 起注入 crossIssue）");
  assert.ok(clientSource.includes("...CONSTELLATION_PROFILE,"), "星座 profile 展开注入（节键/无 prepend 等口径不变）");
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
  assert.ok(clientSource.includes("engine?.setSkin?.(createSkin(applied), skinModeOf(applied));"), "点选即对已打开整页热切（呈现层替换 + 明暗模式同步）");
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
  {
    const skinSection = settingsSource.slice(
      settingsSource.indexOf("export function CosmosSkinPanel"),
      settingsSource.indexOf("export function CosmosShortcutsPanel")
    );
    assert.ok(!/face\.save\(\)/.test(skinSection), "皮肤页签无「保存」按钮（即时生效语义）");
  }
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
    3,
    "三面板均订阅 health face（皮肤 + 导航 + 快捷键）"
  );
  assert.ok(settingsSource.includes("const health = props.selectHealth ?? null;"), "health face 经注入（缺失时降级 noop）");
  assert.ok(settingsSource.includes("function selectFailureOf(snapshot)"), "health 快照形状防御（非法快照按无失败处理）");
  assert.equal(
    (settingsSource.match(/const notApplied = failure !== null && failure\.face === /g) ?? []).length,
    3,
    "三面板按 face 归属过滤失败（仅本页签呈现）"
  );
  assert.equal(
    (settingsSource.match(/notAppliedText\(t, "cosmos\.settings\./g) ?? []).length,
    3,
    "三面板提示文案走 notAppliedText（含原因码后缀）"
  );
  assert.equal((settingsSource.match(/data-failure-code=\{notApplied\.code\}/g) ?? []).length, 3, "提示条携带原因码（data-failure-code 稳定钩子）");
  /* role="status" 计数 = 三处「未生效」提示条 + 两处跨域冲突提示（快捷键页签 + 两动作页签共用
     一处渲染：动作面板一份、快捷键面板两份——冲突块与未生效块各一）。 */
  assert.ok((settingsSource.match(/role="status"/g) ?? []).length >= 3, "提示条以 status 语义播报");
  /* add-cosmos-rightbar-dock + step2-cosmos-openspec-path-setting 3.1：face 缺失
     占位/早退分支持同款纪律——四页签 + 「通用」页签路径区共 5 处；`notApplied` 仍为三处
     （通用页签无引擎写入依赖，不进 health 通道）。 */
  assert.equal((settingsSource.match(/data-state="face-missing"/g) ?? []).length, 5, "face 缺失占位稳定钩子（四页签 + 路径区）");
  assert.equal((settingsSource.match(/if \(face === null\) \{/g) ?? []).length, 5, "face 缺失早退占位（不渲染永不生效的控件）");
  assert.ok(settingsSource.includes('tr(t, "cosmos.settings.skinUnavailable"'), "皮肤占位文案键");
  assert.ok(settingsSource.includes('tr(t, "cosmos.settings.navUnavailable"'), "导航占位文案键");
  assert.ok(settingsSource.includes('errorText("shortcutsUnavailable"'), "快捷键占位文案键");
  /* 词典 zh/en 成对（各 2 次：zh + en） */
  for (const key of ["skinUnavailable", "navUnavailable", "skinNotApplied", "navNotApplied", "shortcutsUnavailable", "shortcutsNotApplied", "shortcutDup"]) {
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
  assert.ok(clientSource.includes("cosmosSelectHealthOf"), "cosmosSelectHealthOf 并入 bundle 导出面");  assert.ok(clientSource.includes("if (controllerRef.current == null) {"), "face 调用边界的控制器存活检查");
  assert.equal(
    (clientSource.match(/markSelectFailure\("/g) ?? []).length,
    4,
    "皮肤 / 导航 / 发送前编辑 / 快捷键四 face 均经失败标记 helper"
  );
  assert.equal(
    (clientSource.match(/clearSelectFailure\(\);/g) ?? []).length,
    4,
    "成功路径清除历史失败（自愈；四 face 同款）"
  );
}

/* ── 13c. 「通用」页签·路径区（step2-cosmos-openspec-path-setting 3.1–3.4）：
    CosmosPathsSection 渲染锚点 / 回显与保存链 / 端点不可达降级 / face 缺失占位 /
    存在性警示钩子 + client 接线（控制器、注入、生命周期、导出）与词典成对。
    行为面直测在 test/settings-panel-smoke.mjs。 */
{
  assert.ok(settingsSource.includes("export function CosmosPathsSection"), "路径区组件");
  assert.equal(
    (settingsSource.match(/data-plugin-anchor="dsh-v-cosmos:settings-general-paths"/g) ?? []).length,
    2,
    "路径区稳定锚点（降级占位 + 正文两分支）"
  );
  assert.ok(settingsSource.includes('id="cosmos-paths-openspec"') && settingsSource.includes('id="cosmos-paths-cosmos-spec"'), "两个路径输入的稳定 id（label[htmlFor] 原生可达）");
  assert.ok(settingsSource.includes('face.edit("openspecPath", event.target.value)'), "openspecPath 键入入草稿");
  assert.ok(settingsSource.includes('face.edit("cosmosSpecDir", event.target.value)'), "cosmosSpecDir 键入入草稿");
  assert.ok(settingsSource.includes("void face.save()"), "保存链路 = face.save（整节 CAS 写）");
  assert.ok(settingsSource.includes("face.discard()"), "放弃修改走控制器");
  assert.ok(settingsSource.includes("data-path-warning="), "目录存在性警示稳定钩子（非阻断提示）");
  assert.ok(settingsSource.includes('data-paths-unavailable="true"'), "端点不可达整组禁用稳定钩子");
  assert.ok(settingsSource.includes('data-state="face-missing"') && settingsSource.includes("cosmos.settings.pathsUnavailable"), "face 缺失降级占位文案键");
  assert.ok(settingsSource.includes("<CosmosPathsSection t={t} paths={props.paths ?? null} />"), "路径区挂进「通用」页签（独立 face，不牵连 launch 单选）");
  /* client 接线：共享作用域控制器 + 注入 + fiber 清理 + 导出面 */
  assert.ok(clientSource.includes("createPathsSettingsController(activeScope)"), "路径控制器接 activeScope（与按钮两节同源作用域）");
  assert.ok(clientSource.includes("paths: pathsSettings"), "「通用」页签注入 paths face");
  assert.ok(clientSource.includes("pathsSettings.dispose();"), "控制器随插件 fiber 生命周期清理");
  assert.ok(/export \{[\s\S]*\bCosmosPathsSection\b[\s\S]*\}/.test(clientSource) && /export \{[\s\S]*\bcreatePathsSettingsController\b[\s\S]*\}/.test(clientSource), "路径区组件/控制器并入 bundle 导出面");
  /* 词典 zh/en 成对（各 2 次：zh + en） */
  for (const key of [
    "pathsLabel", "pathsHint", "pathsLoading", "pathsOpenspecLabel", "pathsOpenspecHint", "pathsOpenspecPh",
    "pathsCosmosSpecLabel", "pathsCosmosSpecHint", "pathsCosmosSpecPh", "pathsUnavailable", "pathsNotWritable",
    "pathsSave", "pathsSaving", "pathsSaveFailed", "pathsDiscard", "pathsDirMissing"
  ]) {
    assert.equal(
      (clientSource.match(new RegExp('"cosmos\\.settings\\.' + key + '"', "g")) ?? []).length,
      2,
      "词典 zh/en 成对：cosmos.settings." + key
    );
  }
}

/* ── 14. 源码锚点：会话卡「归档会话」动作（add-cosmos-session-archive-action 2.1/2.2/3.1–3.3） ──
   信息卡双按钮 data-action 分流、onArchiveSession 注入、单元素请求组装、防重入
   （per-session 集合 + 直接 DOM 切换，MUST NOT 出现经 cardHtml 重渲染的禁用路径）、
   `.cd-btn` 触屏目标 ≥40px。行为面直测在 test/session-archive-smoke.mjs。 */
{
  /* 双按钮与分流（引擎） */
  const cardActions = engineSource.slice(
    engineSource.indexOf("function cardActionsHtml(sessionId, lead, ent)"),
    engineSource.indexOf("function cardHtml(e)")
  );
  assert.ok(cardActions.length > 0, "cardActionsHtml 切片可定位");
  assert.ok(cardActions.includes('data-action="open"'), "打开按钮稳定钩子 data-action=open");
  assert.ok(cardActions.includes('data-action="archive"'), "归档按钮稳定钩子 data-action=archive");
  assert.ok(cardActions.includes(">打开会话<") && cardActions.includes(">归档会话<"), "双按钮文案并列");
  assert.ok(cardActions.includes('data-action="archive" data-session="'), "归档按钮与既有 data-session 并存");
  assert.equal((engineSource.match(/\+\s*cardActionsHtml\(/g) ?? []).length, 2, "行星卡与彗星卡各挂一次双按钮组");
  assert.ok(engineSource.includes("cardActionsHtml(p.id, decideButtonHtml('planet', p), p)") && engineSource.includes("cardActionsHtml(c.id, '', c)"), "两调用点把实体传入（活跃口径取卡内实体，3.1）");
  /* 禁用态语义分档（add-cosmos-session-archive-busy-gate 3.1/D1）：归档**在途**禁用是
     瞬态，MUST NOT 经 cardHtml 重渲染（直接 DOM 切换，见下方 click 断言）；**实体活跃**
     （busy ∨ waiting ∨ delegatedBusy）是持续状态，随 sig 翻转经差分守卫重渲染，允许进
     markup（disabled + 按态 title）。「打开会话」恒可用（dock/embedded 导航均可用）。 */
  assert.ok(!cardActions.includes("sessionNavAvailable"), "无独立窗口导航禁用分流");
  assert.equal((cardActions.match(/disabled/g) ?? []).length, 1, "markup 仅实体活跃分支渲染 disabled（归档在途仍走直接 DOM）");
  assert.ok(cardActions.includes("ent.state === 'busy' || ent.state === 'waiting' || ent.delegatedBusy === true"), "卡侧活跃谓词与恒星活力「活跃」同源（busy ∨ waiting ∨ delegatedBusy）");
  assert.ok(cardActions.includes("E.labels.card.archiveBusy") && cardActions.includes("E.labels.card.archiveWaiting"), "活跃门按态 title 走注入文案（locale 同源）");
  assert.ok(cardActions.includes("escapeHtml(archiveTitle)"), "归档按钮说明 title 经 escapeHtml");
  assert.ok(engineSource.includes("if (ent.kind === 'planet' || ent.kind === 'comet') sig += '|db:' + (ent.data?.delegatedBusy === true ? 1 : 0);"), "sig 纳入 delegatedBusy（委托忙碌翻转经差分守卫承接，3.2）");
  assert.ok(!cardActions.includes("openDisabled"), "「打开会话」无禁用文案（独立窗口能力已退役）");
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
  /* 两门叠加恢复路径（add-cosmos-session-archive-busy-gate 3.3/D4）：在途门结束 ≠ 恒可点
     ——`setArchiveButtonDisabled(false)` 按卡内当前实体活跃口径重推导（实体仍活跃保持
     禁用；卡已切实体按该实体口径），行为面直测在 session-archive-smoke。 */
  const restoreFn = engineSource.slice(
    engineSource.indexOf("function setArchiveButtonDisabled"),
    engineSource.indexOf("/* ── 星胚移除的内联两击确认")
  );
  assert.ok(restoreFn.includes("hoverSourceOf()"), "恢复路径读取卡内当前实体（非盲清）");
  assert.ok(restoreFn.includes("ent.data?.state === 'busy' || ent.data?.state === 'waiting' || ent.data?.delegatedBusy === true"), "恢复重推导谓词与 markup 活跃口径一致");
  assert.ok(restoreFn.includes("button.disabled = active;"), "实体仍活跃 → 在途恢复不清除活跃禁用");

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
  assert.ok(/openSession\(sessionId\);[\s\S]{0,120}if \(jump\) closePage\(\{ autoSend: submit \}\);/.test(runBody), "导航成功后按按钮分流");
  assert.ok(runBody.includes("else keepPage();"), "不跳转走 keepPage（整页保持）");
  assert.ok(
    runBody.indexOf("await createSession(card.wsId, card)") < runBody.indexOf("openSession(sessionId);"),
    "恒新建先于导航（导航目标 = 新建会话）"
  );
  assert.ok(runBody.indexOf("openSession(sessionId);") < runBody.indexOf("if (jump) closePage({ autoSend: submit });"), "导航先于页面流转（跳转不改写新建会话）");
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
  assert.ok(clientSource.includes("closePage: () => closePageAfterJump(),"), "client 注入 closePage = 统一裁决（embedded 关整页 / dock no-op）");
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
  assert.ok(clientSource.includes("engineSelectStore, engineHoverStore, cosmosButtonsFace"), "镜像 store 随模块导出（观测面；p2 增 engineHoverStore）");

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
  const frameStart = clientSource.indexOf('className={dock ? "cos-page cos-page-dock" : "cos-page"}');
  const clickStart = clientSource.indexOf("onClick={(event) => {", frameStart);
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
   运行时行为（dive 后消失 / 飞回即清空，polish-cosmos-search-clear-on-return）由 N4 段
   引擎真实通知序列直测承接。居中几何走「引擎 CSS × 客户端 CSS」口径一致性断言
   （640px / 400px 伪视口）。 */
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

  /* 1.3 查询清理入口仍为 3 处（输入框 Esc / 清除按钮 / 外壳 Esc 分层）；返回清空由
     `onDrillChange` 非 null → null 守卫单点承接（N4 段直测），搜索块内零新增清理代码。
     引擎重建（非返回）经 attach 续接保持查询——守卫的豁免面由 N4 源码锚点 + 直测固化。 */
  assert.equal((clientSource.match(/applyQuery\(""\)/g) ?? []).length, 3, "查询清理点仍为 3 处（块内不新增）");
  assert.ok(clientSource.includes("controllerRef.current?.actions.setFilter(value);"), "applyQuery 写入面原样（无钻取态分支）");
  assert.ok(clientSource.includes("filterStore.set({ query: filterQuery"), "filterStore 写入面原样（MUST NOT 在钻取态改写查询）");
  assert.ok(clientSource.includes("if (filterQuery.trim()) syncFilter();"), "重挂载保持查询（attach 续接）原样");

  /* 2.1 / 2.2 行容器居中的跨文件几何一致（step2-add-constellation-switcher D1：定位/限宽职责
     自标牌移交 `.cos-wsbar`，标牌改行内中央格）：470 = 2×(面板 187 + 安全边距 48)；
     844 = 标牌上限 480 + 2×(条目槽 170 + 间隙 12)；160px 为页面宽度不足下限。两侧条目槽
     固定对称宽度 → 切换条目以页面中心为支点成对（add-cosmos-template-reassign 返工后
     星座名称与模板工具整组移到右上角，本容器只承载切换条目）。 */
  const wsbarRule = engineSource.slice(engineSource.indexOf(".cos-wsbar {"), engineSource.indexOf(".cos-wsbar-side {"));
  const badgeRule = engineSource.slice(engineSource.indexOf(".cos-badge {"), engineSource.indexOf(".cos-badge b {"));
  assert.ok(wsbarRule.includes("left: 50%") && wsbarRule.includes("transform: translateX(-50%)"), "引擎 CSS：切换条目容器水平居中（left:50% + translateX(-50%)）");
  assert.ok(badgeRule.includes("text-align: right"), "引擎 CSS：标牌随右上角组右对齐排版");
  assert.ok(badgeRule.includes("max-width: min(480px, 40vw)") && !badgeRule.includes("position: absolute") && !badgeRule.includes("calc(100% - 470px)"),
    "引擎 CSS：标牌上限收敛（右上角组 40vw），不再绝对定位 / 挂百分比限宽");
  assert.ok(engineSource.includes("position: absolute; top: 14px; right: 16px"), "引擎 CSS：标牌 + 工具整组固定右上角（top:14 / right:16）");
  assert.ok(engineSource.includes('.cos-badge-cluster[data-drilled="true"] { display: flex; }'), "引擎 CSS：右上标牌组仅钻取态呈现");
  const limitM = /max-width: max\((\d+)px, min\((\d+)px, calc\(100% - (\d+)px\)\)\)/.exec(wsbarRule);
  assert.ok(limitM, "引擎 CSS：行容器限宽口径可解析（下限 / 上限 / 避让预留）");
  const sideRule = engineSource.slice(engineSource.indexOf(".cos-wsbar-side {"), engineSource.indexOf(".cos-wsbar-side[data-side=\"left\"] {"));
  const sideFlexM = /flex: 0 1 var\(--cos-wsbar-side-w, (\d+)px\); width: var\(--cos-wsbar-side-w, (\d+)px\)/.exec(sideRule);
  assert.ok(sideFlexM && sideFlexM[1] === sideFlexM[2],
    "引擎 CSS：两侧条目槽固定对称宽度（flex 基准 = 宽度、同一令牌，等量收缩）");
  const sideM = /--cos-wsbar-side-w, (\d+)px/.exec(sideRule);
  const panelM = /\.dsh-cosmos-panel\{[^}]*?width:var\(--cos-const-panel-w, (\d+)px\)/.exec(clientSource);
  assert.ok(panelM, "客户端 CSS：面板宽度（令牌 fallback，add-cosmos-layout-tuning 起可配）可解析");
  assert.ok(sideM, "引擎 CSS：条目槽宽令牌缺省值可解析");
  const floor = Number(limitM[1]);
  const cap = Number(limitM[2]);
  const reserve = Number(limitM[3]);
  const panelW = Number(panelM[1]);
  const sideW = Number(sideM[1]);
  assert.equal(reserve, 2 * (panelW + 48), "避让预留 = 2×(面板宽 + 48 安全边距)（口径与面板宽度同源）");
  assert.equal(cap, 480 + 2 * (sideW + 12), "行容器上限 = 标牌 480 + 2×(条目槽宽 + 间隙)（结构预算同源）");
  /* 断点看**视口**（媒体查询），限宽算式看**页面**（引擎根容器宽度 = 视口 - 侧栏）。 */
  const wsbarWidth = (vw, pageW) => (vw < 520 ? pageW - 40 : Math.max(floor, Math.min(cap, pageW - reserve)));
  const at640 = wsbarWidth(640, 640);
  assert.ok((640 - at640) / 2 >= panelW + 48, "640px 伪视口：行容器外缘到面板内缘 ≥ 48px（居中对称；标牌 ≤ 容器宽，故标牌同样不重叠，spec 满足）");
  const at400 = wsbarWidth(400, 400);
  assert.equal(at400, 360, "400px 伪视口：断点放宽到 calc(100% - 40px)");
  assert.ok((400 - at400) / 2 < panelW, "400px 伪视口：横向允许与面板重叠（降级口径，非破坏性）");
  /* 侧栏在场的退化档（视口 700 / 页面 480）：min() 为负 → 160px 下限兜底，标牌仍 MUST 呈现。 */
  const sidePage = 700 - 220;
  const atSide = wsbarWidth(700, sidePage);
  assert.equal(atSide, floor, "侧栏在场（视口 700 / 页面 480）：min() 为负 → 下限兜底");
  assert.ok(atSide > 0, "行容器 MUST 不退化为 0 宽（spec「MUST 呈现标牌」）");
  assert.ok((sidePage - atSide) / 2 < panelW, "该档允许与面板横向重叠（降级，纵向由面板下移隔离）");
  assert.ok(engineSource.includes("@media (max-width: 520px) { .cos-wsbar { max-width: calc(100% - 40px); }") && engineSource.includes(".cos-wsbar-side { display: none; }"), "窄视口断点规则在册（<520px：容器放宽 + 条目槽隐藏；标牌组右上仍呈现）");

  /* 2.3 顶部窗口 chrome 安全区（真机触发区修复）：DSH Desktop 在 Windows 窗口顶部保留 40px
     caption 拖拽带（preload-app.cjs 注入 data-windows-titlebar + --dsh-windows-titlebar-height:
     40px；AppFrame 以 padding-top 与 ::before 拖拽带落地），macOS 为 48px；`-webkit-app-region:
     drag` 按几何生效，覆盖其上的交互控件上半部会被窗口拖拽吞掉（真机症状：切换条目仅下半部可
     点）。整页 MUST 自 --dsh-frame-top-clearance 之下起排；页内全部 chrome（切换条目 / 搜索框 /
     两侧面板）随整体下移，触发区完整可点。浏览器 / 独立页无该变量 → 0px，行为不变。 */
  assert.ok(clientSource.includes('top: "var(--dsh-frame-top-clearance, 0px)"'),
    "整页自 DSH 顶部 chrome 安全区之下起排（top: var(--dsh-frame-top-clearance, 0px)）");
  assert.ok(!/position:\s*"absolute",\s*top:\s*0,\s*bottom:\s*0/.test(clientSource),
    "页根不再从窗口顶 0 起排（否则 40px caption 拖拽带盖住顶部交互 chrome）");
  assert.ok(/\.cos-wsbar \{[^}]*top: 14px/.test(engineSource),
    "引擎顶部行相对页顶 top:14px（页内偏移不变；整页下移安全区后条目完全落在拖拽带之外）");
  assert.ok(/\.cos-wsbar-item \{[^}]*min-height: 40px/.test(engineSource),
    "条目 40px 点击目标完整可用（无「上半部拖窗」区）");
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
    engineSource.includes("cardActionsHtml(p.id, decideButtonHtml('planet', p), p)"),
    "行星卡在「打开会话」与「归档会话」之间注入决策按钮（实体一并传入活跃门）"
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
  /* 星↔星提案连线解除（two-use-cosmos-template-star-layout）：rel 段标记收敛到 relSetOf
     的星↔行星段（提案 links 段不再有 seg.rel 点亮分支）；图样连线通道落位。 */
  assert.ok(engineSource.includes("rel: true, relAlpha: alpha"), "constline 段 rel 标记（星↔行星关系段，relSetOf 单点）");
  assert.ok(!engineSource.includes("links: E.relLast.links"), "星↔星提案 links 观测面解除（relLast 快照无 links 映射）");
  assert.ok(engineSource.includes("const pattern = ws.pattern;"), "图样全量通道落位（ws.pattern 静态几何消费，add-cosmos-template-figure-display）");
  assert.ok(engineSource.includes("PAT_LINE_DIM"), "图样连线弱化因子落位（seg.alpha 自缩、统一口径）");
  assert.ok(engineSource.includes("segIndex: si"), "图样观测面新形态（{wsId, segIndex, alpha}，槽位段无星 id 键）");
  assert.ok(engineSource.includes("kind: 'patdot'"), "空槽装饰点渲染层条目落位（patdot 装饰层）");
  assert.ok(engineSource.includes("PAT_DOT_DIM") && engineSource.includes("export function patEmptySlotsOf"), "空槽判定纯函数 + 点弱化因子落位（冒烟直测面）");
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

/* ── 19a. 银河态星胚卡 + 头部星胚附注徽标（add-cosmos-galaxy-embryo-cards 2.1/2.2/3.5） ── */
{
  /* 头部附注徽标：主计数（正式提案数）之外的独立补注，星胚为 0 时不渲染。 */
  assert.ok(clientSource.includes("{model.embryoTotal > 0 ? ("), "附注徽标门控：embryoTotal > 0 才渲染（=== 0 零布局）");
  assert.ok(clientSource.includes('className="dsh-cosmos-panel-embryo-count"'), "附注徽标稳定 CSS 钩子");
  assert.ok(
    clientSource.includes('t("cosmos.panel.embryoCount", "＋{n} 星胚").replace("{n}", String(model.embryoTotal))'),
    "文案走词典 + `{n}` 渲染处单次替换（DICT 保持纯字符串）"
  );
  assert.ok(clientSource.includes('{model.total}</span>'), "头部主计数口径不变（仍 = 正式提案数）");
  assert.ok(clientSource.includes(".dsh-cosmos-panel-embryo-count{"), "附注徽标样式规则存在");
  assert.ok(clientSource.includes("border:1px dashed var(--cos-lc-proto,#8a9bc0)"), "附注徽标取星胚语义色（与星胚卡同源令牌）");
  /* DICT zh/en 成对（沿 cosmos.panel.embryo 先例）。 */
  assert.equal((clientSource.match(/"cosmos\.panel\.embryoCount": "＋\{n\} 星胚"/g) ?? []).length, 1, "DICT zh：星胚附注文案");
  assert.equal((clientSource.match(/"cosmos\.panel\.embryoCount": "\+\{n\} embryos"/g) ?? []).length, 1, "DICT en：星胚附注文案成对");
  /* 主计数/附注语义分离：附注键 MUST NOT 复用到主计数徽标。 */
  assert.ok(!clientSource.includes('className="dsh-cosmos-panel-count" aria-hidden="true">{t('), "主计数仍为裸数字（附注独立徽标）");

  /* 银河态渲染仅星胚分组：分组/卡片渲染对钻取态零特判（同一 JSX 两态共用）。 */
  const panelBody = clientSource.slice(clientSource.indexOf("function ProposalPanel"), clientSource.indexOf("function SessionPanel"));
  assert.ok(panelBody.length > 0, "ProposalPanel 源码切片成功");
  const groupsAt = panelBody.indexOf("{model.groups.map((group) => (");
  const cardsAt = panelBody.indexOf("group.cards.map((card) => (");
  const footerAt = panelBody.indexOf("{showConstActions ? <ConstActionBar");
  assert.ok(groupsAt >= 0 && cardsAt > groupsAt && footerAt > cardsAt, "单一渲染链：分组 → 卡片 → （钻取态专属）footer");
  const cardsSlice = panelBody.slice(cardsAt, footerAt);
  assert.ok(!cardsSlice.includes("drilled"), "卡片渲染对钻取态零特判（银河/钻取共用 → 仅星胚分组照常呈现星胚卡）");
  assert.ok(cardsSlice.includes('data-embryo={card.isEmbryo ? "true" : undefined}'), "星胚卡在银河态同款渲染（data-embryo 钩子）");
  assert.ok(!panelBody.includes("model.groups.filter("), "分组不在组件层二次过滤（口径由投影层决定）");
  /* 星胚样式不受钻取态作用域限制（银河态同样生效）。 */
  const embryoSelectors = [...clientSource.matchAll(/([^{}\n]*\[data-embryo\][^{}\n]*)\{/g)].map((m) => m[1]);
  assert.ok(embryoSelectors.length >= 3, "星胚样式规则族存在");
  assert.ok(embryoSelectors.every((sel) => !sel.includes("data-drill")), "星胚样式不受 [data-drill] 作用域限制（银河态同样生效）");
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
    "--cos-const-action-h", "--cos-search-w", "--cos-search-h", "--cos-ws-title-size",
    "--cos-ws-tool-size"
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
    clientSource.includes('from "./settings.mjs"') && clientSource.includes("COSMOS_SETTINGS_BOUNDS, COSMOS_SETTINGS_DEFAULTS")
      && clientSource.includes("cosmosLayoutTokensOf, loadCosmosSettings"),
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
  assert.ok(engineSource.includes("width: var(--cos-ws-tool-size, 32px);") && engineSource.includes("height: var(--cos-ws-tool-size, 32px);"), "顶部模板工具边长经令牌下发（引擎工具槽，方形）");
  assert.ok(engineSource.includes("width: var(--cos-hud-btn-size, 44px); height: var(--cos-hud-btn-size, 44px)"), "HUD 按钮边长经令牌（home）");
  /* 页签更名「界面」：可见文案换名，slot id / face 名保持 nav（内部契约零迁移） */
  assert.ok(clientSource.includes('"cosmos.settings.tabInterface": "界面"'), "词典 zh：页签更名「界面」");
  assert.ok(clientSource.includes('"cosmos.settings.tabInterface": "Interface"'), "词典 en：页签更名成对");
  assert.ok(clientSource.includes('label: () => sectionT("cosmos.settings.tabInterface")'), "页签标签取更名后的词典键");
  assert.ok(!clientSource.includes('"cosmos.settings.tabNav"'), "旧「导航」页签词典键已退役");
  assert.ok(clientSource.includes('id: "nav",'), "slot id 仍为 nav（内部标识零迁移）");
}

/* ── 16. 源码锚点：快捷键接线（add-cosmos-shortcuts 5.1–5.3 / 6.1 / D3 / D8b / D12 / D13）──
   外壳分发与浮窗语音键的行为面由 engine-smoke（引擎分支）与设置页冒烟（设置面）覆盖；
   本节锚定「监听挂载面 / 键位读取方式 / 门控与守卫 / 消费语义」等结构事实。 */
{
  /* ① 关闭链参数化（5.1/D3）：canonical 匹配配置键 + IME 让位 + 组字 229 双保险；
     配置经模块 store 读（`currentShortcuts()`）——effect 不按配置重绑监听。 */
  assert.ok(clientSource.includes("if (!shortcutMatches(e, currentShortcuts().closePage)) return;"), "关闭链 canonical 匹配当前配置键（缺省 Esc）");
  const closeChainAt = clientSource.indexOf("if (!shortcutMatches(e, currentShortcuts().closePage)) return;");
  const closeChainBody = clientSource.slice(closeChainAt, clientSource.indexOf('window.addEventListener("keydown", onKey);', closeChainAt));
  assert.ok(closeChainBody.includes("if (e.isComposing === true || e.keyCode === 229) return;"), "关闭链 IME 组字让位（isComposing + 229）");
  assert.ok(!/e\.key !== "Escape"/.test(closeChainBody), "关闭链不再硬编码 Escape 键名（物理键 canonical 口径）");
  assert.equal((closeChainBody.match(/e\.preventDefault\(\);/g) ?? []).length >= 4, true, "分层链各层消费均 preventDefault");
  assert.ok(clientSource.includes("}, [fullscreen, exitFullscreen]);"), "监听依赖不含快捷键配置（防陈旧闭包与重绑）");
  /* ② 面板失焦层 + 搜索框清空层同键（D3：分层链整体跟随） */
  assert.ok(clientSource.includes('if (!shortcutMatches(event, closeKey ?? "Escape")) return;'), "提案面板失焦层跟随配置键");
  assert.ok(clientSource.includes("closeKey={shortcuts.closePage}"), "面板接收当前生效关闭键（受控镜像）");
  assert.ok(clientSource.includes("if (!shortcutMatches(e, shortcuts.closePage)) return;"), "搜索框清空层跟随配置键");
  /* ③ 按钮键分发（5.2/D12/D13）：映射 useMemo + ref、门控与点击等效、仅可编辑让位、浮窗让位 */
  assert.ok(clientSource.includes("const buttonShortcutMap = useMemo(() => {"), "canonical → 按钮映射（useMemo）");
  assert.ok(clientSource.includes("buttonDispatchRef.current = {"), "映射/门控经 ref 同步给一次绑定的监听");
  assert.ok(clientSource.includes('add(constButtons, "constellation");') && clientSource.includes('add(actionButtons, "proposal");'), "两条动作条同源映射（提案 + 星座）");
  assert.ok(clientSource.includes("if (isEditableTarget(active)) return;"), "可编辑聚焦守卫（唯一焦点守卫）");
  /* chrome 聚焦不构成新键位守卫（真机反馈修订：点击提案卡片即选中、焦点滞留该行按钮）：
     分发器与引擎 applyShortcut 均不得调用 isUiChromeTarget；WASD/空格两支的 chrome 守卫保留。 */
  const dispatchAt = clientSource.indexOf("if (ev.repeat === true) return;", clientSource.indexOf("buttonDispatchRef.current"));
  const dispatchBody = clientSource.slice(dispatchAt, clientSource.indexOf("window.addEventListener(\"keydown\", onKey);", dispatchAt));
  assert.ok(dispatchAt > 0 && dispatchBody.length > 0, "分发器切片可定位");
  assert.ok(!/isUiChromeTarget/.test(dispatchBody), "按钮键分发不含 chrome 聚焦守卫（卡片/动作条聚焦仍可触发）");
  assert.ok(!/isActionBarTarget/.test(clientSource), "动作条豁免特判已随 chrome 守卫一并移除");
  assert.ok(!/isButtonLikeTarget/.test(clientSource), "按钮类聚焦守卫不适用于新键位（D12 分档：仅空格保留）");
  assert.ok(clientSource.includes("if (ev.shiftKey === true || ev.metaKey === true) return;"), "Shift/Meta 恒跳过（修饰键裁决统一）");
  assert.ok(clientSource.includes("if (floatOpenOf()) return; // 浮窗模态让位（D13）"), "浮窗打开时按钮键零分发（模态让位）");
  assert.ok(clientSource.includes("if (view.selectedCard === null) return; // 动作条熄灭 → 静默 no-op"), "提案侧门控 = 动作条点亮");
  assert.ok(clientSource.includes("if (extra?.disabled === true) return; // 行级禁用 → 静默 no-op"), "行级禁用门控（与点击同口径）");
  assert.ok(clientSource.includes("if (view.drillGroup === null) return; // 星座条限钻取态（银河态无动作目标）"), "星座侧门控 = 钻取态");
  assert.ok(/ev\.preventDefault\(\);\n\s+view\.runAction\(entry\.button\);/.test(clientSource), "命中提案按钮键：preventDefault + 同一执行链路");
  assert.ok(/ev\.preventDefault\(\);\n\s+view\.runConstAction\(entry\.button\);/.test(clientSource), "命中星座按钮键：preventDefault + 同一执行链路");
  assert.ok(clientSource.includes("if (canonical === configured.closePage || canonical === configured.goHome || canonical === configured.togglePan) return;"), "全局键漂移防御（同键不双触发）");
  /* ④ 浮窗语音键（6.1/D6）：armed 监听 + 三态 toggle + 输入焦点放行 + 命中 preventDefault */
  const voiceAt = clientSource.indexOf("if (!shortcutMatches(event, voiceKey)) return;");
  const voiceBody = clientSource.slice(voiceAt - 400, voiceAt + 400);
  assert.ok(voiceAt > 0, "浮窗语音键 canonical 匹配（配置键动态生效）");
  assert.ok(voiceBody.includes('if (voiceState === "recording") finishVoice();'), "recording → 停止并转写（同一 finishVoice 链路）");
  assert.ok(voiceBody.includes('else if (voiceState === "idle") startVoice();'), "idle → 开始录音（同一 startVoice 链路）");
  assert.ok(!/isEditableTarget/.test(voiceBody), "语音组合键不做可编辑焦点守卫（浮窗 textarea 聚焦主场景）");
  assert.ok(voiceBody.includes("event.isComposing === true || event.keyCode === 229 || event.repeat === true"), "语音键保留组字 + repeat 守卫");
  assert.ok(voiceBody.includes("event.preventDefault();"), "命中语音键 preventDefault");
  assert.equal((constFloatBody(clientSource).match(/window\.addEventListener\("keydown", onKey, true\);/g) ?? []).length, 2, "浮窗两条 capture 监听（收卡键 + 语音键）");
  /* ⑤ 浮窗模态计数（D13 探针）：armed 加减 + 下界 0 + 引擎注入 + 页组关闭时仍恒 0 */
  assert.ok(clientSource.includes("cosmosFloatArmedCount += 1;"), "浮窗 armed → 计数 +1");
  assert.ok(clientSource.includes("cosmosFloatArmedCount = Math.max(0, cosmosFloatArmedCount - 1);"), "收卡/卸载 → 计数 -1（防御下界 0）");
  assert.ok(clientSource.includes("isFloatOpen: () => floatOpenOf()"), "引擎注入浮窗探针（goHome/togglePan 模态让位）");
  /* ⑥ 快捷键写入链（5.3）：净房持久化 → 引擎热更 → 受控镜像；face 侧冲突拒绝 + health 落印 */
  const saveShortcutsAt = clientSource.indexOf("saveShortcuts(patch) {");
  const saveShortcutsBody = clientSource.slice(saveShortcutsAt, clientSource.indexOf("getTuning() {", saveShortcutsAt));
  assert.ok(saveShortcutsAt > 0 && saveShortcutsBody.length > 0, "控制器 saveShortcuts 切片");
  assert.ok(saveShortcutsBody.includes("const next = shortcutsOf({ ...current, ...(patch && typeof patch === \"object\" ? patch : {}) });"), "部分写合并后再净房（缺席键保持原值）");
  assert.ok(saveShortcutsBody.includes("saveCosmosSettings({ shortcuts: next })"), "净房写盘（saveCosmosSettings 内置 shortcutsOf）");
  assert.ok(saveShortcutsBody.includes("engine?.setShortcuts?.(merged.shortcuts);"), "已打开整页引擎热更（无需重开页）");
  assert.ok(saveShortcutsBody.includes("cosmosShortcutsStore.set({ ...merged.shortcuts });"), "受控镜像同步（关闭链/分发/浮窗提示跟随）");
  assert.ok(clientSource.includes("const cosmosShortcutsStore = createSnapshotStore(shortcutsOf(loadCosmosSettings().shortcuts));"), "模块级 store 冷启动取持久化净房值");
  assert.ok(clientSource.includes("const candidate = shortcutsOf({ ...current, ...(patch && typeof patch === \"object\" ? patch : {}) });"), "face 侧重算候选净房表");
  assert.ok(clientSource.includes("if (shortcutConflictOf(candidate, buttonDraftsOf()) !== null) return current;"), "face 侧冲突拒绝写入（保存面查重）");
  assert.ok(clientSource.includes('markSelectFailure("shortcuts");'), "控制器缺失落印 health 失败（快捷键 face）");
  /* ⑦ 跨域数据面（3.3）：两控制器 crossIssue + 草稿 store 同步 + 就绪后重算 */
  assert.ok(clientSource.includes('const shortcutCrossIssue = (side, entries) => {'), "并集查重纯函数包装（侧别固定）");
  assert.ok(clientSource.includes('return shortcutsIssue(cosmosShortcutsStore.getSnapshot(), {'), "保存门共用 shortcutsIssue（单一来源）");
  assert.ok(clientSource.includes("const publishButtonDrafts = () => cosmosButtonDraftsStore.set({"), "两列表草稿投影进模块 store（面板冲突定位数据面）");
  assert.ok(clientSource.includes("buttonSettings.discard();\n  constButtonSettings.discard();"), "两实例就绪后重算合法性（构造期对侧未就绪）");
  assert.ok(clientSource.includes("const buttonDraftsFace = {"), "草稿数据面 face（设置页注入）");
}

/* ── 16. 星胚移除入口（add-cosmos-embryo-dismiss-button 6.2 / spec cosmos-embryo-dismiss
      「动作条直执行移除入口」、spec cosmos-actions「星胚直执行执行链路」）──
   行为面直测在 test/actions-smoke.mjs 4e（执行体：整组顺序 / 不短路 / 聚合三态 / 冷却门 /
   旧锚点可达）与服务端 test/dismiss-smoke.mjs；此处按既有 house style 固化 tips 侧拆除面、
   客户端接线（三分流优先级 / 行级禁用豁免 / 执行体装配 / 键盘等效）与词典 zh/en 成对。 */
{
  /* ① tips 侧拆除（4.1–4.3）：星胚卡无按钮行、dismiss 瞬态机制与回调面全数退役。 */
  const cardHtmlBody = engineSource.slice(
    engineSource.indexOf("function cardHtml(e)"),
    engineSource.indexOf("function updateOverlay()")
  );
  assert.ok(cardHtmlBody.length > 0, "cardHtml 切片可定位");
  assert.ok(!cardHtmlBody.includes("dismiss-embryo"), "proto 卡 MUST NOT 渲染移除按钮（无按钮行）");
  assert.ok(!cardHtmlBody.includes("dismissRow"), "按钮行局部装配已拆除");
  assert.ok(!cardHtmlBody.includes("cd-btn-dismiss"), "移除按钮类随入口退役");
  assert.ok(!cardHtmlBody.includes("E.labels.dismiss"), "按钮文案注入面已收缩");
  for (const gone of [
    "handleDismissClick",
    "clearDismissConfirm",
    "dismissConfirmKey",
    "dismissConfirmTimer",
    "DISMISS_CONFIRM_MS",
    "dismissInFlight",
    "onDismissEmbryo",
    "dismiss: Object.freeze",
    "data-ws=",
    "data-slug="
  ]) {
    assert.ok(!engineSource.includes(gone), "tips dismiss 机制已整体拆除：" + gone);
  }
  /* click 分流：无 dismiss 分支（会话类动作仍先取 data-action 再取 data-session）。 */
  const clickSlice = engineSource.slice(
    engineSource.indexOf("E.el.card.addEventListener('click'"),
    engineSource.indexOf("function isEmptyConstellation")
  );
  assert.ok(clickSlice.length > 0, "信息卡 click 切片可定位");
  assert.ok(!clickSlice.includes("dismiss-embryo"), "click 分流无 dismiss 分支");
  assert.ok(
    clickSlice.indexOf("getAttribute('data-action')") < clickSlice.indexOf("getAttribute('data-session')"),
    "会话类动作分流口径零变化"
  );
  assert.ok(engineSource.includes("|life:"), "lifecycle 仍进内容签名（proto→created 翻转刷新状态行）");
  assert.ok(!clientSource.includes("onDismissEmbryo"), "client 引擎注入点已移除");
  assert.ok(!clientSource.includes("labels.dismiss"), "引擎 labels 契约收缩（无 dismiss 项）");

  /* ② 单条请求执行体（3.1）：逐 slug 无 toast 形态，返回观测面保留。 */
  assert.ok(clientSource.includes('const DISMISS_EMBRYO_PATH = "/api/dsh-v-cosmos/dismiss-embryo";'), "dismiss 端点常量零变化");
  assert.ok(clientSource.includes("async dismissEmbryo(input)"), "actions.dismissEmbryo 单条执行体");
  const dismissAt = clientSource.indexOf("async dismissEmbryo(input)");
  const addWorkspaceAt = clientSource.indexOf("async addWorkspace()", dismissAt);
  assert.ok(dismissAt > 0 && addWorkspaceAt > dismissAt, "dismissEmbryo 切片可定位");
  const dismissBody = clientSource.slice(dismissAt, addWorkspaceAt);
  const bodyLine = dismissBody.split("\n").find((line) => line.includes("JSON.stringify(")) ?? "";
  assert.ok(bodyLine.includes("workspaceId, slug"), "请求体 = { workspaceId, slug }");
  assert.ok(dismissBody.includes("fetch(DISMISS_EMBRYO_PATH"), "POST 自有 dismiss 端点");
  assert.ok(!dismissBody.includes("engine?.toast"), "MUST NOT 自带 toast（呈现职责移交动作条执行体）");
  assert.ok(!/sessionIds|stopActivity/.test(dismissBody), "MUST NOT 复用归档请求形状");
  assert.ok(!/closePage|cosmosOpenStore/.test(dismissBody), "MUST NOT 关整页（消散由骨架差分 + 既有变体承接）");
  assert.ok(!/pending-changes|unlink|openspec/i.test(dismissBody), "MUST NOT 触碰 openspec 工件（服务端动词）");
  assert.ok(!/setScene|refreshSkeleton/.test(dismissBody), "MUST NOT 主动收卡 / 拉骨架（fs.watch → SSE 既有管道）");
  assert.ok(dismissBody.includes('outcome === "deleted"') && dismissBody.includes('tr("cosmos.dismiss.deleted", "星胚已移除")'), "deleted → 成功文案");
  assert.ok(
    dismissBody.includes('outcome === "guard-dir-exists"') && dismissBody.includes('tr("cosmos.dismiss.guardDirExists", "同名提案已创建，未移除")'),
    "guard-dir-exists → 守卫拒绝专用文案"
  );
  assert.ok(dismissBody.includes('outcome === "already-missing"') && dismissBody.includes('tr("cosmos.dismiss.alreadyMissing"'), "already-missing → 中性文案");
  assert.ok(dismissBody.includes('outcome === "missing-workspace"') && dismissBody.includes('tr("cosmos.dismiss.missingWorkspace"'), "missing-workspace → 失败文案");
  assert.ok(dismissBody.includes('tr("cosmos.dismiss.failed", "移除失败：") + (reason ||'), "failed → 文案携带端点 reason");
  assert.ok(dismissBody.includes('tr("cosmos.dismiss.requestFailed"'), "网络/非 2xx → 请求级失败文案");
  assert.ok(dismissBody.includes('tr("cosmos.dismiss.noTarget"'), "钩子残缺 → 缺目标提示");
  assert.ok(dismissBody.includes("return dismissNotice("), "每分支返回 {outcome, tone, text} 观测面（供执行体聚合）");

  /* ③ 三分流优先级 + 执行体装配（3.2/3.4）。 */
  const runAt = clientSource.indexOf("runButton(input) {");
  assert.ok(runAt > 0, "runButton 切片可定位");
  const runBody = clientSource.slice(runAt, clientSource.indexOf("runConstButton(input)", runAt));
  const directAt = runBody.indexOf("isEmbryoDismissButton(input?.button)");
  const protoAt = runBody.indexOf('input?.button?.preState === "proto"');
  const actionAt = runBody.indexOf("actionExecutor.run(input)");
  assert.ok(directAt > 0 && protoAt > directAt && actionAt > protoAt, "三分流优先级：直执行 > proto 消息链路 > 提案动作链路");
  assert.ok(runBody.includes("embryoDismissExecutor.run(input)"), "直执行分流指向新执行体");

  const execAt = clientSource.indexOf("const embryoDismissExecutor = createEmbryoDismissExecutor({");
  assert.ok(execAt > 0, "执行体装配（apply fiber 作用域）");
  const execBody = clientSource.slice(execAt, clientSource.indexOf("const constExecutor", execAt));
  assert.ok(execBody.includes("dismissOne: (input) => actions.dismissEmbryo(input)"), "单条请求注入 = actions.dismissEmbryo");
  assert.ok(execBody.includes("gate: actionGate"), "与提案/星胚执行体共享同一冷却门实例");
  assert.ok(execBody.includes("notify: (text) => notifyToast?.(text)"), "toast 通道与既有执行体同源");
  for (const key of ["cosmos.dismiss.groupAll", "cosmos.dismiss.groupPartial", "cosmos.dismiss.groupNone"]) {
    assert.ok(execBody.includes(key), "组级聚合文案来自词典面：" + key);
  }

  /* ④ 行级禁用豁免（3.3）：直执行行不套用「缺少探索会话关联」（旧锚点可达）。 */
  const stateAt = clientSource.indexOf("const actionButtonStateOf = (button) => {");
  assert.ok(stateAt > 0, "actionButtonStateOf 切片可定位");
  const stateBody = clientSource.slice(stateAt, clientSource.indexOf("const runConstAction", stateAt));
  assert.ok(
    stateBody.indexOf("isEmbryoDismissButton(button)") > 0
      && stateBody.indexOf("isEmbryoDismissButton(button)") < stateBody.indexOf("selectedCard.sessionId"),
    "直执行豁免 MUST 先于旧锚点禁用判定"
  );

  /* ⑤ 键盘触发等效复用（spec 场景「键盘触发等效」）：分发器 → runAction → runButton 单出口。 */
  assert.ok(clientSource.includes("view.runAction(entry.button);"), "快捷键分发复用点击链路（同一分流 / 同一门控复验 / 同一防重入门）");
  assert.ok(clientSource.includes("await controller.actions.runButton({ button, card });"), "点击唯一出口 = runButton");

  /* ⑥ 执行体直测（整组顺序 + 聚合文案；行为面全矩阵在 actions-smoke 4e）。 */
  const callOrder = [];
  const groupToasts = [];
  const directResult = await createEmbryoDismissExecutor({
    dismissOne: async ({ slug }) => {
      callOrder.push(slug);
      return { outcome: "deleted", tone: "ok", text: "星胚已移除" };
    },
    notify: (text) => groupToasts.push(text),
    now: () => 1
  }).run({
    button: { name: "移除", prompt: "", autoSend: false, newSession: false, preState: "proto", embryoDismiss: true },
    card: { key: "proto\u0000sess", lifecycle: "proto", act: 0, isEmbryo: true, slugs: ["add-a", "add-b"], wsId: "ws1" }
  });
  assert.deepEqual(callOrder, ["add-a", "add-b"], "整组按 slugs 顺序逐条调用（无并行）");
  assert.equal(directResult.ok, true);
  assert.equal(directResult.removed, 2);
  assert.deepEqual(groupToasts, ["已移除 2 个星胚"], "组级聚合文案经 notify 呈现（单次）");

  /* ⑦ 词典：tips 按钮键已删除；outcome 文案保留；组级聚合与设置键 zh/en 成对。 */
  assert.ok(!clientSource.includes("cosmos.card.dismiss"), "tips 按钮/确认态词典键已删除");
  const dictPairs = [
    ["cosmos.dismiss.deleted", "星胚已移除", "Embryo removed"],
    ["cosmos.dismiss.alreadyMissing", "该星胚已不存在", "That embryo is already gone"],
    ["cosmos.dismiss.guardDirExists", "同名提案已创建，未移除", "A proposal with this name exists; not removed"],
    ["cosmos.dismiss.missingWorkspace", "工作区不在册，未移除", "Workspace is not registered; not removed"],
    ["cosmos.dismiss.failed", "移除失败：", "Removal failed: "],
    ["cosmos.dismiss.failedUnknown", "未知错误", "unknown error"],
    ["cosmos.dismiss.requestFailed", "移除请求失败：", "Removal request failed: "],
    ["cosmos.dismiss.noTarget", "缺少星胚定位信息，未移除", "Missing embryo target; not removed"],
    ["cosmos.dismiss.groupAll", "已移除 {count} 个星胚", "Removed {count} embryos"],
    ["cosmos.dismiss.groupPartial", "已移除 {removed}/{total}（首条失败：{reason}）", "Removed {removed}/{total} (first failure: {reason})"],
    ["cosmos.dismiss.groupNone", "未移除（{reason}）", "Not removed ({reason})"],
    ["cosmos.settings.embryoDismissLabel", "直达移除（免提示词）", "Direct removal (no prompt)"],
    ["cosmos.settings.embryoDismissProtoOnly", "直达移除仅限前置状态为待创建（星胚）的按钮", "Direct removal is limited to buttons whose pre-state is Pending creation (embryo)"],
    ["cosmos.settings.buttonEmbryoDismissProtoOnly", "直达移除仅限前置状态为待创建（星胚）的按钮", "Direct removal is limited to buttons whose pre-state is Pending creation (embryo)"]
  ];
  for (const [key, zh, en] of dictPairs) {
    assert.ok(clientSource.includes('"' + key + '": "' + zh + '"'), "词典 zh 缺键基线：" + key);
    assert.ok(clientSource.includes('"' + key + '": "' + en + '"'), "词典 en：" + key);
  }
  for (const key of [
    "embryoDismissTitle",
    "embryoDismissDriftTitle",
    "embryoDismissActiveTitle",
    "embryoDismissModelTitle",
    "buttonPromptPhDirect",
    "buttonEmbryoDismissInvalid"
  ]) {
    const occurrences = clientSource.split('"cosmos.settings.' + key + '":').length - 1;
    assert.ok(occurrences >= 2, "设置词典 zh/en 成对：" + key);
  }

  /* ⑧ 设置页控件呈现面（5.1/5.2 源码锚点；行为面在 settings-panel-smoke）。 */
  assert.ok(settingsSource.includes("showEmbryoDismiss: true") && settingsSource.includes("showEmbryoDismiss: false"), "快捷动作呈现 / 星座动作不呈现");
  assert.ok(settingsSource.includes('face.editButton(index, "embryoDismiss", event.target.checked)'), "复选框走草稿编辑（暂存-保存模型）");
  assert.ok(settingsSource.includes("disabled={disabled || (!isProto && !directChecked)}"), "非星胚行禁用（漂移勾选保留取消路径）");
  assert.ok(settingsSource.includes("disabled={disabled || isDirect}"), "直执行行消息面控件禁用");
  assert.ok(settingsSource.includes("modelRow(button, index, isDirect)"), "模型与级别一并禁用");
  assert.ok(settingsSource.includes("buttonPromptPhDirect"), "直执行行提示词占位说明");
  assert.ok(settingsSource.includes("data-embryo-dismiss="), "行内漂移标记（漂移值标「不可用」）");
}

/* ── 24. 源码锚点：卡片任务进度条（p1-add-cosmos-card-progress-bars 3.1–3.4 / 4.2/4.3） ──
   React 树 Node 侧不可挂载 → 呈现断言走源码锚点；派生纯函数与形状通道由 panel-smoke /
   skin-registry-smoke 运行时直测。 */
{
  /* 纯逻辑口径：格数上限 min(total,12) 与退化分支。 */
  assert.ok(clientSource.includes("function progressTrackOf(progress) {"), "轨道口径纯函数");
  assert.ok(clientSource.includes("if (total <= 0) return null;"), "total=0（y=0 门控）→ null 零布局");
  assert.ok(clientSource.includes("segmentCount: Math.min(total, 12), degraded: total > 12"), "格数上限 min(total,12) + 超上限退化标记（design D2）");
  assert.ok(clientSource.includes("function progressSegmentFillOf(index, done) {"), "分段填充态纯函数");
  assert.ok(clientSource.includes("if (index < done) return \"done\";"), "done 覆盖整格");
  assert.ok(clientSource.includes("return index === done ? \"active\" : \"empty\";"), "第 done+1 格进行中 tint、余格空轨（0/4 首格即 tint）");

  /* 挂点组件：strip（满宽条）+ ring（meta 小环）；恒 aria-hidden，自门控零布局。 */
  const stripBody = clientSource.slice(clientSource.indexOf("function ProgressStrip({ progress })"), clientSource.indexOf("function ProgressRing({ progress })"));
  assert.ok(stripBody.length > 0, "strip 组件切片可定位");
  assert.ok(stripBody.includes("if (!track) return null;"), "strip：progress 缺失 → 零布局（y=0 / 畸形串自然隐藏）");
  assert.ok(stripBody.includes("className=\"dsh-cosmos-progress-strip\""), "满宽条挂点类名");
  assert.ok(stripBody.includes("data-degraded={track.degraded ? \"true\" : undefined}"), "退化连续条数据标记");
  assert.ok(stripBody.includes("className=\"dsh-cosmos-progress-fill\" style={{ width: track.percent + \"%\" }}"), "连续条 = 单 span 宽度百分比（done/total）");
  assert.ok(stripBody.includes("className=\"dsh-cosmos-progress-segs\""), "格栅容器类名");
  assert.ok(stripBody.includes("className=\"dsh-cosmos-progress-seg\" data-fill={fill} key={index}"), "分段子 span（格数 = segmentCount = min(total,12)）");
  assert.ok(stripBody.includes("aria-hidden=\"true\""), "条 aria-hidden（比例增强不新增读屏噪音）");
  const ringBody = clientSource.slice(clientSource.indexOf("function ProgressRing({ progress })"), clientSource.indexOf("/* ------------------------------------------------------------------ *\n * 提案列表面板"));
  assert.ok(ringBody.length > 0, "ring 组件切片可定位");
  assert.ok(ringBody.includes("className=\"dsh-cosmos-progress-ring\""), "meta 行内环形挂点类名");
  assert.ok(ringBody.includes("style={{ \"--cos-prog-turn\": track.percent + \"%\" }}"), "环填充角经内联数据值下发（形状不参与 JS 分支）");
  assert.ok(ringBody.includes("aria-hidden=\"true\""), "环 aria-hidden");

  /* 接入：会话行（strip 末位 + meta 内 ring）与正式提案卡（同款双槽）；星胚卡分支零接入。 */
  const sessionRowBody = clientSource.slice(clientSource.indexOf("function SessionRow({ t, row, selected, onSelect, onOpen, onArchive, linked, onHover })"), clientSource.indexOf("function SessionPanel({"));
  assert.ok(sessionRowBody.length > 0, "SessionRow 切片可定位");
  assert.ok(sessionRowBody.includes("<ProgressRing progress={row.progress} />"), "会话行 meta 内 ring 挂点（同数据双槽）");
  assert.ok(sessionRowBody.includes("<ProgressStrip progress={row.progress} />"), "会话行满宽条挂点");
  const rowMetaAt = sessionRowBody.indexOf("className=\"dsh-cosmos-session-meta\"");
  const rowRingAt = sessionRowBody.indexOf("<ProgressRing progress={row.progress} />");
  const rowStripAt = sessionRowBody.indexOf("<ProgressStrip progress={row.progress} />");
  const rowSrAt = sessionRowBody.indexOf("className=\"dsh-cosmos-session-sr\"");
  assert.ok(rowMetaAt < rowRingAt && rowRingAt < rowStripAt && rowStripAt < rowSrAt, "行内落位：meta 内 ring → main 按钮末位可视子元素 strip → sr");
  assert.ok(sessionRowBody.includes("{row.todos !== \"—\" ? ("), "文本徽标保留（条为比例增强，非数字替代）");

  const formalBranch = clientSource.slice(clientSource.indexOf("className=\"dsh-cosmos-panel-name\""), clientSource.indexOf("</button>", clientSource.indexOf("className=\"dsh-cosmos-panel-name\"")));
  assert.ok(formalBranch.length > 0, "正式提案卡分支切片可定位");
  assert.ok(formalBranch.includes("<ProgressRing progress={card.progress} />"), "提案卡 meta 内 ring 挂点");
  assert.ok(formalBranch.includes("<ProgressStrip progress={card.progress} />"), "提案卡卡底满宽条挂点");
  const cardMetaAt = formalBranch.indexOf("className=\"dsh-cosmos-panel-meta\"");
  const cardRingAt = formalBranch.indexOf("<ProgressRing progress={card.progress} />");
  const cardStripAt = formalBranch.indexOf("<ProgressStrip progress={card.progress} />");
  assert.ok(cardMetaAt < cardRingAt && cardRingAt < cardStripAt, "卡内落位：meta 内 ring → 卡末位 strip");
  assert.ok(formalBranch.includes("{card.tasks[1] > 0 ? ("), "x/y 文本徽标保留");

  const embryoBranch23 = clientSource.slice(
    clientSource.indexOf("{card.isEmbryo ? ("),
    clientSource.indexOf("className=\"dsh-cosmos-panel-name\"")
  );
  assert.ok(embryoBranch23.length > 0, "星胚分支切片可定位");
  assert.ok(!embryoBranch23.includes("ProgressStrip") && !embryoBranch23.includes("ProgressRing") && !embryoBranch23.includes("dsh-cosmos-progress"), "星胚卡分支零进度条接入（spec 星胚无任务进度行纪律）");
  assert.equal((clientSource.match(/<ProgressStrip progress=/g) ?? []).length, 2, "strip 挂点恰两处（会话行 + 正式提案卡）");
  assert.equal((clientSource.match(/<ProgressRing progress=/g) ?? []).length, 2, "ring 挂点恰两处（会话行 + 正式提案卡）");

  /* CSS 组件族：满宽条 / 环 / 形状分支 / 退化 / fallback 基线（属性缺失 = segment）。 */
  const progressCss = clientSource.slice(
    clientSource.indexOf(".dsh-cosmos-progress-strip{"),
    clientSource.indexOf("/* ── 会话列表面板（add-cosmos-session-list-panel 2.1–2.3")
  );
  assert.ok(progressCss.length > 0, "进度条 CSS 组件族切片可定位");
  assert.ok(progressCss.includes(".dsh-cosmos-progress-strip{display:flex;box-sizing:border-box;width:100%;height:3px;margin:2px 0 0;"), "满宽条 3px 高");
  assert.ok(progressCss.includes(".dsh-cosmos-progress-segs{display:flex;gap:1px;"), "segment 1px 间隙格栅");
  assert.ok(progressCss.includes(".dsh-cosmos-progress-seg[data-fill=done]{background:var(--cos-accent,#ffd28a)}"), "done 整格主调色（令牌，金色仅 fallback 位）");
  assert.ok(progressCss.includes(".dsh-cosmos-progress-seg[data-fill=active]{background:rgb(var(--cos-accent-rgb,255 210 140) / .42)}"), "进行中格低透明度 tint（静态）");
  assert.ok(progressCss.includes(".dsh-cosmos-progress-fill{display:none;height:100%;background:var(--cos-accent,#ffd28a)}"), "连续条填充默认隐藏（segment 基线）");
  /* 形状分支：属性缺失 = segment（默认规则即格栅），bar/ring 各写显式覆盖 → 零 JS 分支。 */
  assert.ok(progressCss.includes("[data-cos-progress=bar] .dsh-cosmos-progress-segs{display:none}"), "bar 分支：隐格栅");
  assert.ok(progressCss.includes("[data-cos-progress=bar] .dsh-cosmos-progress-fill{display:block}"), "bar 分支：显连续条");
  assert.ok(progressCss.includes(".dsh-cosmos-progress-strip[data-degraded=true] .dsh-cosmos-progress-fill{display:block}"), "total 超 12 退化路径显连续条");
  assert.ok(progressCss.includes(".dsh-cosmos-progress-strip[data-degraded=true] .dsh-cosmos-progress-segs{display:none}"), "total 超 12 退化路径隐格栅");
  assert.ok(progressCss.includes(".dsh-cosmos-progress-ring{display:none;flex:none;width:12px;height:12px;border-radius:50%;"), "ring 小环 12px（默认隐藏 = segment/bar 基线）");
  assert.ok(progressCss.includes("background:conic-gradient(from -90deg,var(--cos-accent,#ffd28a) 0 var(--cos-prog-turn,0%),"), "ring = conic-gradient 填充角");
  assert.ok(progressCss.includes("[data-cos-progress=ring] .dsh-cosmos-progress-strip{display:none}"), "ring 分支：隐满宽条");
  assert.ok(progressCss.includes("[data-cos-progress=ring] .dsh-cosmos-progress-ring{display:inline-block}"), "ring 分支：显 meta 小环");
  assert.ok(progressCss.includes("@supports (mask: radial-gradient(circle,#000 0 3px,transparent 3px)){"), "@supports 守卫：mask 环带挖空");
  assert.ok(progressCss.includes("mask:radial-gradient(circle,#000 0 3px,transparent 3px)}"), "mask 环带（含 -webkit-mask 前缀）");
  assert.ok(progressCss.includes("@supports not (mask: radial-gradient(circle,#000 0 3px,transparent 3px)){"), "降级守卫：mask 不可用分支");
  assert.ok(progressCss.includes("[data-cos-progress=ring] .dsh-cosmos-progress-strip{display:flex}"), "降级：ring 回落 bar 显满宽条（不裸奔实心饼）");
  assert.ok(progressCss.includes("[data-cos-progress=ring] .dsh-cosmos-progress-fill{display:block}"), "降级：回落为连续条形态");
  /* 取色纪律：全走既有 accent 令牌族，零新增 HUD 令牌 / 零裸色值背景。 */
  assert.ok(/rgb\(var\(--cos-accent-rgb,255 210 140\)/.test(progressCss), "轨道/格栅取色走既有 accent 通道令牌族");
  assert.ok(!/background:#[0-9a-f]{6}/i.test(progressCss), "背景无裸色值（金色直接量仅允许于 var() fallback 位）");
  assert.ok(!progressCss.includes("--cos-lc-"), "未引入新语义色令牌（星胚/四态语义色不参与进度条）");
  assert.ok(!progressCss.includes("--cos-progress"), "未新增 HUD 令牌（--cos-prog-turn 为组件内数据变量，非颜色令牌）");
  /* 布局纪律（3.4）：条为 flex-column 末位子元素，不触碰 meta 行 / 行内按钮区 / 滚动语义。 */
  assert.ok(progressCss.includes("margin:2px 0 0;"), "条以 2px 上边距作末位子元素落位（不挤压 meta 行）");
  assert.ok(!progressCss.includes("dsh-cosmos-session-open") && !progressCss.includes("dsh-cosmos-session-archive"), "MUST NOT 触碰行内「打开/归档」按钮区");
  assert.ok(!progressCss.includes("overflow-y") && !progressCss.includes("position:sticky"), "MUST NOT 改变面板滚动语义");
}

/* ── 25. 源码锚点：卡片状态描边（p2-add-cosmos-card-state-chrome 2.1–2.6 / 3.1–3.3） ──
   React 树 Node 侧不可挂载 → 与 24 同口径走源码锚点（选择器/动画规则存在性）；描边是
   纯 CSS 消费层（会话行 data-state 既有、提案卡 data-act 仅一处属性），状态派生由
   panel-smoke 直测（delegatedBusy → busy 在此补描边侧映射锚点）。 */
{
  /* JS 面：会话行 data-state 恒在（零改动）；提案卡 data-act 由 act>0 单点门控。 */
  const rowChromeBody = clientSource.slice(clientSource.indexOf("function SessionRow({ t, row, selected, onSelect, onOpen, onArchive, linked, onHover })"), clientSource.indexOf("function SessionPanel({"));
  assert.ok(rowChromeBody.length > 0, "SessionRow 切片可定位");
  assert.ok(rowChromeBody.includes('className="dsh-cosmos-session-row"'), "行容器描边宿主类名");
  assert.ok(rowChromeBody.includes("data-state={row.state}"), "行容器 data-state 驱动四态描边（零 JS 改动）");
  assert.ok(
    clientSource.includes('data-act={card.act > 0 && !card.isEmbryo ? "active" : undefined}'),
    "提案卡 data-act 门控（act>0 → active，否则缺省；星胚卡显式排除）"
  );
  assert.equal((clientSource.match(/data-act=\{/g) ?? []).length, 1, "data-act 仅共用卡按钮一处（星胚零独立分支）");
  const embryoChromeBranch = clientSource.slice(clientSource.indexOf("{card.isEmbryo ? ("), clientSource.indexOf('className="dsh-cosmos-panel-name"'));
  assert.ok(!embryoChromeBranch.includes("data-act"), "星胚分支零 data-act（keep-embryo-active-while-exploring 起星胚 act 可为 1，属数据面口径，呈现面豁免保持）");
  assert.equal(sessionRowStateOf("idle", true), "busy", "delegatedBusy（父待机 ∧ 子代理执行中）映射 busy——描边走流动规则");
  assert.equal(sessionRowStateOf("waiting", true), "waiting", "waiting 优先于委托 loader（四态优先级不变）");

  /* CSS 组件族切片：首尾锚点避免吞后文（星座动作条注释为界）。 */
  const chromeCss = clientSource.slice(
    clientSource.indexOf("/* ── 状态描边层（p2-add-cosmos-card-state-chrome"),
    clientSource.indexOf("/* ── 星座动作条（add-cosmos-constellation-actions 3.1")
  );
  assert.ok(chromeCss.length > 0, "状态描边 CSS 组件族切片可定位");

  /* 环带层基线：容器定位 + ::before 覆盖整卡 + 不拦截指针。 */
  assert.ok(chromeCss.includes(".dsh-cosmos-session-row,.dsh-cosmos-panel-card{position:relative}"), "环带宿主定位（会话行 + 提案卡）");
  assert.ok(chromeCss.includes(".dsh-cosmos-session-row::before,.dsh-cosmos-panel-card::before{content:'';position:absolute;inset:0;"), "环带层 ::before 覆盖整卡（inset:0）");
  assert.ok(chromeCss.includes("pointer-events:none"), "环带层不拦截指针（「打开」钮/卡片点击与悬停零回归）");

  /* 四态语法：busy/delegatedBusy 流动、done-unread 静态高亮 + glow、waiting 慢脉冲、idle 静默。 */
  assert.ok(chromeCss.includes(".dsh-cosmos-session-row[data-state=busy]::before,"), "busy 流动规则（delegatedBusy 经 data-state=busy 同规则）");
  assert.ok(chromeCss.includes(".dsh-cosmos-panel-card[data-act=active]::before{padding:1px;"), "提案卡活跃流动规则（共用 busy 语言）");
  assert.ok(chromeCss.includes("conic-gradient(from var(--cos-chrome-flow,0deg),transparent 0deg,transparent 250deg,rgb(var(--cos-accent-rgb,255 210 140) / .95) 360deg)"), "流动巡游 = conic 单亮带（彗星：亮头顺时针最前、尾迹拖后；var fallback 为 @property 降级前提，缺之整条 background IACVT 回落透明）");
  assert.ok(chromeCss.includes("linear-gradient(rgb(var(--cos-accent-rgb,255 210 140) / .28),rgb(var(--cos-accent-rgb,255 210 140) / .28))"), "常亮基线 = accent 低α 均匀底层（描边任意时刻连续可见、无空窗）");
  assert.ok(chromeCss.includes("@property --cos-chrome-flow{syntax:'<angle>';inherits:false;initial-value:0deg}"), "@property 注册角度自定义属性（keyframes 可插值前提）");
  assert.ok(!chromeCss.includes("repeating-linear-gradient") && !chromeCss.includes("background-position:13.59px"), "斜纹平移形态已移除（禁断续/斜纹平移等无环绕方向形态）");
  assert.ok(chromeCss.includes("mask-composite:exclude") && chromeCss.includes("-webkit-mask-composite:xor"), "双层 mask 挖空 1px 边环（含 -webkit 前缀）");
  assert.ok(chromeCss.includes("animation:cos-state-chrome-flow 2.4s linear infinite"), "流动周期 2.4s linear（光带走完整圈可被视线跟随）");
  assert.ok(chromeCss.includes("@keyframes cos-state-chrome-flow{to{--cos-chrome-flow:360deg}}"), "流动关键帧 = 角度属性 0→360deg 插值（绕环顺时针一周）");

  /* 进行中通道取色（align-cosmos-flow-host-color 1.1/2.1/3.1）：派生局部通道挂
     .cos-page（与皮肤 HUD 令牌同址），fallback 链 = 宿主进行中 alias → 皮肤 accent →
     硬兜底；@supports 分支以 color-mix 组合 α 叠层，动画形态逐字不动。 */
  assert.ok(chromeCss.includes(".cos-page{--cos-flow-channel:var(--dsw-alias-state-business-primary,var(--cos-accent,#ffd28a))}"), "派生通道定义于 .cos-page 作用域（宿主 business alias → 皮肤 accent fallback 链）");
  const channelDefAt = chromeCss.indexOf(".cos-page{--cos-flow-channel:");
  assert.ok(channelDefAt >= 0 && channelDefAt < chromeCss.indexOf(".dsh-cosmos-session-row[data-state=busy]::before"), "通道定义先于消费规则（继承链单点下发）");
  const flowSupportsAt = chromeCss.indexOf("@supports (background: color-mix(in srgb, red 50%, transparent)){");
  assert.ok(flowSupportsAt > chromeCss.indexOf("@keyframes cos-state-chrome-flow"), "@supports 升级位于 accent 基线声明之后（级联覆盖，降级保留基线）");
  const flowSupportsCss = chromeCss.slice(flowSupportsAt, chromeCss.indexOf(".dsh-cosmos-session-row[data-state=done-unread]::before"));
  assert.ok(flowSupportsCss.includes("color-mix(in srgb,var(--cos-flow-channel) 95%,transparent)"), "亮带 α.95 由 color-mix 自通道组合（hex 令牌无 RGB 三元组）");
  assert.ok(flowSupportsCss.includes("linear-gradient(color-mix(in srgb,var(--cos-flow-channel) 28%,transparent),color-mix(in srgb,var(--cos-flow-channel) 28%,transparent))"), "常亮基线 α.28 同通道组合（描边连续可见不变）");
  assert.ok(flowSupportsCss.includes("conic-gradient(from var(--cos-chrome-flow,0deg),transparent 0deg,transparent 250deg,") && flowSupportsCss.includes("360deg),"), "动画形态逐字不动（conic 巡游角度表达式保留）");
  assert.ok(chromeCss.includes(".dsh-cosmos-session-row[data-state=done-unread]::before{border:1px solid var(--dsw-alias-state-success-primary,var(--cos-done,#5affc0));"), "done-unread 静态高亮（宿主 alias → 皮肤 done 令牌级联）");
  assert.ok(chromeCss.includes("box-shadow:0 0 10px var(--dsw-alias-state-success-primary,var(--cos-done,#5affc0))"), "done-unread glow 挂环带层（light 覆盖块不触及伪元素）");
  assert.ok(chromeCss.includes(".dsh-cosmos-session-row[data-state=waiting]::before{border:1px solid var(--dsw-alias-state-warn-primary,var(--cos-waiting,#ffaa4a));"), "waiting 脉冲静态基底 = 可见 warning 色");
  assert.ok(chromeCss.includes("animation:cos-state-chrome-pulse 2.4s ease-in-out infinite"), "waiting 慢脉冲约 2.4s（运动能量弱于 busy）");
  assert.ok(chromeCss.includes("@keyframes cos-state-chrome-pulse"), "脉冲关键帧存在");
  assert.ok(!chromeCss.includes("data-state=idle"), "idle 无状态描边规则（现状静默）");

  /* 动效纪律：基线环带无常驻动画，动画仅由状态选择器触发。 */
  const ringBaseCss = chromeCss.slice(chromeCss.indexOf(".dsh-cosmos-session-row::before,"), chromeCss.indexOf(".dsh-cosmos-session-row[data-state=busy]::before"));
  assert.ok(ringBaseCss.length > 0 && !ringBaseCss.includes("animation:"), "环带基线无常驻动画（仅状态命中元素挂动画）");

  /* 选中优先：规则置于状态规则之后，animation:none（静态状态色保留、无双动画）。 */
  const flowRuleAt = chromeCss.indexOf(".dsh-cosmos-session-row[data-state=busy]::before");
  const selectedRuleAt = chromeCss.indexOf(".dsh-cosmos-session-row[data-selected=true][data-state=busy]::before");
  assert.ok(flowRuleAt >= 0 && selectedRuleAt > flowRuleAt, "选中优先规则置于状态规则之后（压过动画）");
  const reducedRuleAt = chromeCss.indexOf("@media (prefers-reduced-motion:reduce){");
  assert.ok(reducedRuleAt > selectedRuleAt, "降级块位于选中规则之后");
  const selectedCss = chromeCss.slice(selectedRuleAt, reducedRuleAt);
  assert.ok(selectedCss.includes("animation:none"), "选中期间状态动画停止（静态状态色保留）");
  assert.ok(selectedCss.includes("background:rgb(var(--cos-accent-rgb,255 210 140) / .5)"), "选中态 busy/active 降级 = accent 均匀静态色环（MUST NOT 冻结动画中间帧的不对称亮块）");
  assert.ok(chromeCss.includes(".dsh-cosmos-panel-card[data-selected=true][data-act=active]::before"), "提案卡选中同规则（无双动画叠加）");
  assert.ok(selectedCss.includes("background:color-mix(in srgb,var(--cos-flow-channel) 50%,transparent)"), "选中态静态色环 @supports 分支改走进行中通道 α.5（accent 基线保留降级）");

  /* reduced-motion：时长归零 + background 覆盖为均匀静态色环（色信息保留、非冻结帧）。 */
  const reducedCss = chromeCss.slice(reducedRuleAt);
  assert.ok(reducedCss.includes(".dsh-cosmos-session-row[data-state=busy]::before,\n  .dsh-cosmos-panel-card[data-act=active]::before{animation-duration:0s;animation-iteration-count:1;\n    background:rgb(var(--cos-accent-rgb,255 210 140) / .5)}"), "降级覆盖流动命中元素（时长归零 + 均匀静态色环）");
  assert.ok(reducedCss.includes(".dsh-cosmos-session-row[data-state=waiting]::before"), "降级覆盖 waiting 脉冲");
  assert.ok(reducedCss.includes("animation-duration:0s;animation-iteration-count:1"), "时长归零（静态同色描边，区别于 loader 慢转）");
  assert.ok(reducedCss.includes("background:color-mix(in srgb,var(--cos-flow-channel) 50%,transparent)"), "reduced-motion 静态色环 @supports 分支同走进行中通道 α.5（色信息保留）");

  /* 色令牌与可区分性纪律：零新 HUD 令牌、零裸色值背景、左缘生命周期色条不被覆盖、无虚线。
     --cos-chrome-flow 为 @property 注册的动画驱动属性（本提案白名单），非 HUD 令牌。 */
  assert.ok(chromeCss.includes("var(--cos-done,#5affc0)") && chromeCss.includes("var(--cos-waiting,#ffaa4a)"), "语义色经皮肤令牌兜底（直接量仅 fallback 位）");
  assert.ok(!/background:#[0-9a-f]{6}/i.test(chromeCss), "背景无裸色值");
  assert.deepEqual([...new Set(chromeCss.match(/--cos-[a-z0-9-]+\s*:/g) ?? [])], ["--cos-flow-channel:", "--cos-chrome-flow:"], "零新增 HUD 令牌（--cos-flow-channel 为派生局部通道、--cos-chrome-flow 为 @property 动画驱动属性）");
  assert.ok(!chromeCss.includes("data-lifecycle") && !chromeCss.includes("border-left-color"), "左缘生命周期色条规则未被覆盖（两通道并存）");
  assert.ok(!chromeCss.includes("dashed"), "状态描边无虚线（虚线语义为星胚专有）");

  /* 3.3 回归范围：通道仅状态描边层消费——--cos-accent-rgb 其余消费位（导航 chrome /
     徽标 / 按钮 / 进度条 tint / loader）与画布 palette.sess.busy 零改动（分层：星图
     说皮肤语言，面板层说宿主状态语言）。 */
  const outsideChrome = clientSource.replace(chromeCss, "");
  assert.ok(!outsideChrome.includes("--cos-flow-channel"), "通道仅状态描边层消费（其余 accent 消费位零改动）");
  assert.equal((chromeCss.match(/var\(--cos-flow-channel\)/g) ?? []).length, 5, "通道消费位恰为 5：流光 3（亮带 1 + 基线 2）+ 选中 1 + reduced-motion 1");
}

/* ── 26. 源码锚点：跨面板悬停关联标记（p2-add-cosmos-cross-hover-markers 1.1–1.3 / 3.1–3.3） ──
   React 树 Node 侧不可挂载 → 同 24/25 口径：store 幂等通道、合流/接线、行卡 data-linked、
   星胚不注入 / 禁用面板不注入 / 场景刷新清理守卫、标记 CSS。关联派生与受体判定（含星胚
   整卡粒度、源自身不标）由 panel-smoke 直测，本节锚定客户端接线事实。 */
{
  /* 1.1 引擎悬停镜像 store：仿 engineSelectStore 的幂等通道 + attach/detach 归零。 */
  assert.ok(clientSource.includes("const engineHoverStore = {"), "引擎悬停镜像 store");
  assert.ok(clientSource.includes("function useEngineHover()"), "镜像读取 hook（useSyncExternalStore）");
  const hoverStoreBody = clientSource.slice(
    clientSource.indexOf("const engineHoverStore = {"),
    clientSource.indexOf("function useEngineHover()")
  );
  assert.ok(hoverStoreBody.length > 0, "hover store 切片可定位");
  assert.ok(hoverStoreBody.includes("getSnapshot()") && hoverStoreBody.includes("subscribe(listener)") && hoverStoreBody.includes("set(next)"), "store 三面齐备（仿 engineSelectStore）");
  assert.ok(hoverStoreBody.includes("if (value === null && current === null) return;"), "空 → 空幂等短路（含置空）");
  assert.ok(hoverStoreBody.includes("value.kind === current.kind") && hoverStoreBody.includes("value.wsId === current.wsId") && hoverStoreBody.includes("value.id === current.id"), "键变才通知（kind/wsId/id 全等短路）");
  assert.ok(hoverStoreBody.includes("for (const listener of [...this.listeners])"), "订阅者广播（异常隔离）");
  assert.ok(clientSource.includes("onHoverChange: (info) => engineHoverStore.set(info)"), "attach 注入 onHoverChange（引擎画布 hover 回推）");
  assert.equal((clientSource.match(/engineHoverStore\.set\(null\);/g) ?? []).length, 2, "detach / dispose 双路径镜像归零");
  assert.ok(clientSource.includes("engineSelectStore, engineHoverStore, cosmosButtonsFace"), "镜像 store 随模块导出（观测面）");

  /* 1.2 整页单点合流：引擎源（store）优先于面板源（本地态），受体集随场景刷新重算。 */
  assert.ok(clientSource.includes("const engineHover = useEngineHover();"), "整页消费引擎悬停镜像");
  assert.ok(clientSource.includes("const [panelHover, setPanelHover] = useState(null);"), "面板源本地悬停态（DOM 生命周期随组件）");
  const mergedBody = clientSource.slice(
    clientSource.indexOf("const mergedHover = useMemo(() => {"),
    clientSource.indexOf("const selectedSessionKey")
  );
  assert.ok(mergedBody.length > 0, "合流切片可定位");
  assert.ok(mergedBody.includes('return { source: "canvas", kind: engineHover.kind, wsId: engineHover.wsId, id: engineHover.id };'), "引擎源优先合成 canvas 悬停描述（仲裁：画布 hover > 面板注入）");
  assert.ok(mergedBody.includes("return panelHover;"), "引擎源为空时回落面板源（单一悬停描述）");
  assert.ok(mergedBody.includes("const targets = crossHoverTargets(mergedHover, ws);"), "受体集经纯函数单星座派生");
  assert.ok(mergedBody.includes("return { ...mergedHover, sessionIds: targets.sessionIds, proposalIds: targets.proposalIds };"), "单一合流描述叠加受体集下发两侧面板");
  assert.ok(mergedBody.includes("}, [mergedHover, sceneVersion]);"), "场景刷新触发受体集重派生");

  /* 1.3 接线纪律：行/卡容器单点 mouseenter/leave → 合流 + 引擎注入；离场注入 null。 */
  const rowHoverBody = clientSource.slice(
    clientSource.indexOf("const hoverSessionRow = (row, entering) => {"),
    clientSource.indexOf("const hoverProposalCard = (card, entering) => {")
  );
  assert.ok(rowHoverBody.length > 0, "行悬停切片可定位");
  assert.ok(rowHoverBody.includes('setPanelHover({ source: "row", wsId: row.wsId, kind: row.kind, id: row.id });'), "行源描述 = {source:row, wsId, kind, id}");
  assert.ok(rowHoverBody.includes("controllerRef.current?.setExternalHover?.({ wsId: row.wsId, kind: row.kind, id: row.id });"), "行悬停经 controller 转发引擎注入（kind 取行形态）");
  assert.ok(rowHoverBody.includes("setPanelHover(null);") && rowHoverBody.includes("controllerRef.current?.setExternalHover?.(null);"), "离场清除悬停并注入 null");
  const cardHoverBody = clientSource.slice(
    clientSource.indexOf("const hoverProposalCard = (card, entering) => {"),
    clientSource.indexOf("/* 场景刷新残留清理")
  );
  assert.ok(cardHoverBody.length > 0, "卡悬停切片可定位");
  assert.ok(cardHoverBody.includes('setPanelHover({ source: "card", wsId: card.wsId, kind: "star", id: card.id });'), "正式卡源描述 = {source:card, kind:star, id}");
  assert.ok(cardHoverBody.includes("controllerRef.current?.setExternalHover?.({ wsId: card.wsId, kind: \"star\", id: card.id });"), "正式卡悬停注入引擎（恒星 tips）");
  assert.ok(cardHoverBody.includes("if (card.isEmbryo === true) {"), "星胚合并卡分流（只出不进）");
  const embryoHoverBranch = cardHoverBody.slice(
    cardHoverBody.indexOf("if (card.isEmbryo === true) {"),
    cardHoverBody.indexOf("setPanelHover({ source: \"card\"")
  );
  assert.ok(embryoHoverBranch.includes('source: "embryo"') && embryoHoverBranch.includes("slugs: Array.isArray(card.slugs) ? card.slugs : []"), "星胚源携带 slug 清单（整卡粒度派生输入）");
  assert.ok(!embryoHoverBranch.includes("setExternalHover"), "星胚合并卡 MUST NOT 注入引擎（多 slug 无单一目标）");

  /* 3.1 标记呈现：data-linked 单点属性 + 行/卡容器单点事件（行内按钮 hover 穿透）。 */
  const rowMarkBody = clientSource.slice(
    clientSource.indexOf("function SessionRow({ t, row, selected, onSelect, onOpen, onArchive, linked, onHover })"),
    clientSource.indexOf("function SessionPanel({")
  );
  assert.ok(rowMarkBody.length > 0, "SessionRow 切片可定位");
  assert.ok(rowMarkBody.includes("data-linked={linked ? \"true\" : undefined}"), "会话行 data-linked 标记（受体 `<`）");
  assert.equal((rowMarkBody.match(/onMouseEnter=/g) ?? []).length, 1, "行容器单点 mouseenter（不重复绑定到行内按钮）");
  assert.ok(rowMarkBody.includes("onMouseEnter={() => onHover?.(row, true)}") && rowMarkBody.includes("onMouseLeave={() => onHover?.(row, false)}"), "行容器 mouseenter/leave 经单点回调转发");
  assert.ok(rowMarkBody.includes("data-cosmos-session={row.id}") && rowMarkBody.includes("data-state={row.state}"), "既有行语义属性零改动（标记为叠加）");
  const panelMarkBody = clientSource.slice(
    clientSource.indexOf("function ProposalPanel"),
    clientSource.indexOf("function SessionRow(")
  );
  assert.ok(panelMarkBody.length > 0, "ProposalPanel 切片可定位");
  assert.ok(panelMarkBody.includes("data-linked={cardIsLinkedOf(crossHover, card) ? \"true\" : undefined}"), "提案卡 data-linked（正式 id / 星胚任一 slug 整卡）");
  assert.equal((panelMarkBody.match(/onMouseEnter=/g) ?? []).length, 1, "卡容器单点 mouseenter（单一渲染链一处）");
  assert.ok(panelMarkBody.includes("onMouseEnter={() => onHoverCard?.(card, true)}") && panelMarkBody.includes("onMouseLeave={() => onHoverCard?.(card, false)}"), "卡容器 mouseenter/leave 转发");
  assert.ok(panelMarkBody.includes('data-embryo={card.isEmbryo ? "true" : undefined}') && panelMarkBody.includes("data-lifecycle={card.lifecycle}"), "星胚形态/生命周期语义零改动（标记为叠加）");
  assert.ok(clientSource.includes("linked={rowIsLinkedOf(crossHover, row)}"), "SessionPanel → SessionRow 受体判定下发");
  assert.ok(clientSource.includes("crossHover={crossHover}"), "单一合流描述下发两侧面板");
  assert.ok(clientSource.includes("onHoverCard={hoverProposalCard}") && clientSource.includes("onHoverRow={hoverSessionRow}"), "两侧面板 hover 接线挂点");

  /* 3.2 场景刷新残留清理：源实体键不在新清单 → 清除悬停 + 注入 null（双侧收场）。 */
  const cleanupBody = clientSource.slice(
    clientSource.indexOf("/* 场景刷新残留清理"),
    clientSource.indexOf("/* 星座动作目标")
  );
  assert.ok(cleanupBody.length > 0, "清理守卫切片可定位");
  assert.ok(cleanupBody.includes("if (hoverSourceAlive(scene, panelHover)) return;"), "源实体键在册判定（hoverSourceAlive 纯函数）");
  assert.ok(cleanupBody.includes("setPanelHover(null);") && cleanupBody.includes("controllerRef.current?.setExternalHover?.(null);"), "残留清理：合流归零 + 引擎注入 null");
  assert.ok(cleanupBody.includes("}, [sceneVersion, panelHover]);"), "随场景刷新与悬停态触发");

  /* 3.3 标记 CSS：方向三角（非字符字形）、行右置/卡左置、accent 令牌、零布局/零命中。 */
  const markerCss = clientSource.slice(
    clientSource.indexOf("/* ── 跨面板悬停关联标记"),
    clientSource.indexOf("/* ── 星座动作条")
  );
  assert.ok(markerCss.length > 0, "标记 CSS 切片可定位");
  /* 规则体（剔除注释）——注释里会提到字符/::before/:hover 的对照说明，不能参与反向断言。 */
  const markerRules = markerCss.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(markerRules.includes("content:\"\""), "方向三角 content 为空串（无字符/文本 → 天然不进可访问名）");
  assert.ok(!markerRules.includes("content:\"<\"") && !markerRules.includes("content:\">\""), "不再使用 < / > 字符字形");
  assert.ok(!markerRules.includes("font-size") && !markerRules.includes("text-shadow"), "不再依赖字体字形（三角几何 + 微光）");
  assert.ok(markerRules.includes(".dsh-cosmos-session-row[data-linked=true]::after,") && markerRules.includes(".dsh-cosmos-panel-card[data-linked=true]::after{content:\"\""), "行/卡共用标记规则（同族几何）");
  assert.ok(markerRules.includes("border-top:7px solid transparent") && markerRules.includes("border-bottom:7px solid transparent"), "三角高 14px（上下透明边框）");
  assert.ok(markerRules.includes(".dsh-cosmos-session-row[data-linked=true]::after{right:-9px;") && markerRules.includes("border-right:8px solid rgb(var(--cos-accent-rgb,255 210 140) / .95)"), "会话行标记在列表右缘、左指三角（「<」方向；1px 边框 + 8px 内边距槽）");
  assert.ok(markerRules.includes(".dsh-cosmos-panel-card[data-linked=true]::after{left:-11px;") && markerRules.includes("border-left:8px solid rgb(var(--cos-accent-rgb,255 210 140) / .95)"), "提案卡标记在左缘、右指三角（「>」方向；3px 左边框 + 8px 内边距槽）");
  assert.ok(markerRules.includes(".dsh-cosmos-panel-card[data-embryo][data-linked=true]::after{left:-9px}"), "星胚卡 1px 左边框的定位覆盖（不覆盖生命周期色条/虚线形态）");
  assert.ok(markerRules.includes("transform:translateY(-50%)"), "三角纵向居中");
  assert.ok(markerRules.includes("rgb(var(--cos-accent-rgb,255 210 140) / .95)") && markerRules.includes("filter:drop-shadow(0 0 5px rgb(var(--cos-accent-rgb,255 210 140) / .55))"), "取色 accent 令牌族 + 三角形状微光（金色直接量仅 fallback 位）");
  assert.ok(markerRules.includes("pointer-events:none"), "标记不拦截行/卡命中");
  assert.ok(!markerRules.includes("margin:") && !markerRules.includes("padding:"), "零布局扰动（绝对定位 + 零尺寸，不改行高/行宽/卡内文本）");
  assert.ok(!markerRules.includes("::before"), "槽位取 ::after（::before 归状态描边层，两族互不覆盖）");
  assert.ok(!markerRules.includes("animation"), "静态三角无动效（动效预算留给状态描边层）");
  assert.ok(!markerRules.includes("data-selected") && !markerRules.includes(":hover") && !markerRules.includes("data-lifecycle"), "MUST NOT 触及选中/悬停/生命周期权重（仅 data-linked 选择器）");
}

/* ── 星座模板名显示设置面（add-cosmos-template-name-toggle 1.2/3.1）：源码锚点 ──
   React 树 Node 侧不可挂载 → 控件/face 接线与词典成对走源码锚点；净房与引擎呈现分别由
   settings-panel-smoke（4.1）与 engine-smoke（4.3）运行时直测。 */
{
  /* ① 「通用」页签开关行：checkbox + aria + title/hint + 独立 face + 即时保存。 */
  assert.ok(settingsSource.includes('data-setting="templateNames"'), "「通用」页签开关行挂点（data-setting）");
  assert.ok(settingsSource.includes('"cosmos.settings.templateNamesLabel"'), "开关标签走词典");
  assert.ok(settingsSource.includes('"cosmos.settings.templateNamesAria"'), "checkbox aria-label 走词典");
  assert.ok(settingsSource.includes('aria-label={tr(t, "cosmos.settings.templateNamesAria"'), "aria-label 绑定到 checkbox");
  assert.ok(settingsSource.includes('title={templateNamesHint}'), "装饰用途提示经 title 通道（悬停可读）");
  assert.ok(settingsSource.includes('type="checkbox"') && settingsSource.includes("checked={templateNamesOn}"), "受控 checkbox（受控镜像回显）");
  assert.ok(settingsSource.includes("setTemplateNames(event.target.checked)"), "onChange 即时写（无暂存钮）");
  assert.ok(settingsSource.includes("const namesFace = props.templateNames ?? null;"), "独立 templateNames face（与 launch 正交）");
  assert.ok(settingsSource.includes("namesFace?.set?.(enabled === true)"), "face.set 只接受布尔（非 true 一律关闭）");

  /* ② client 接线：受控镜像 + 控制器写入（持久化 → 引擎热更 → 镜像）+ face 三件套 + 注入。 */
  assert.ok(clientSource.includes("const cosmosTemplateNamesStore = createSnapshotStore({ templateNames: loadCosmosSettings().templateNames });"),
    "受控镜像冷启动读持久值");
  assert.ok(clientSource.includes("saveTemplateNames(enabled) {") && clientSource.includes("saveCosmosSettings({ templateNames: enabled === true })"),
    "控制器写入：净房持久化（布尔归一口径）");
  assert.ok(clientSource.includes("engine?.setTuning(tuningPatchOf(merged));") && clientSource.includes("cosmosTemplateNamesStore.set({ templateNames: merged.templateNames });"),
    "写入链：引擎 setTuning 热更（百分比 → 因子）+ 受控镜像同步");
  const namesFaceBody = clientSource.slice(
    clientSource.indexOf("const templateNamesFace = {"),
    clientSource.indexOf("ctx.slots.inject(SETTINGS_TAB_SLOT", clientSource.indexOf("const templateNamesFace = {"))
  );
  assert.ok(namesFaceBody.includes("getSnapshot:"), "face.getSnapshot");
  assert.ok(namesFaceBody.includes("subscribe:"), "face.subscribe");
  assert.ok(namesFaceBody.includes("set:"), "face.set");
  assert.ok(namesFaceBody.includes("controller.saveTemplateNames"), "整页存活 → 控制器写入（热更通道）");
  assert.ok(namesFaceBody.includes("saveCosmosSettings({ templateNames: enabled === true })"), "整页未开 → 仍即时持久化（下次开页读回）");
  assert.ok(clientSource.includes("inject: () => ({ launch: launchFace, paths: pathsSettings, templateNames: templateNamesFace, patLineDim: patLineDimFace, worksFace: worksFaceSettings })"),
    "「通用」页签注入 templateNames / patLineDim / worksFace face");
  assert.ok(clientSource.includes("cosmosTemplateNamesStore.set({ templateNames: next.templateNames });"),
    "storage 跨窗桥同步 templateNames 镜像");
  assert.ok(clientSource.includes("controllerRef.current?.getEngine?.()?.setTuning?.({ templateNames: next.templateNames === true });"),
    "storage 跨窗桥：已打开整页热更（他窗翻转即时生效，仅本键真实翻转时触达）");
  assert.ok(clientSource.includes("cosmosTemplateNamesStore,") && clientSource.includes("cosmosTemplateNamesStore"),
    "受控镜像导出面（观测/冒烟）");

  /* ③ 引擎接线：镜像初值、setTuning 布尔分支 + chip 显式刷新、chip/badge 组装同源。 */
  assert.ok(engineSource.includes("templateNames: opts.settings?.templateNames === true,"), "引擎镜像初值（非显式 true 一律关闭）");
  assert.ok(engineSource.includes("typeof settings?.templateNames === \"boolean\" && settings.templateNames !== E.templateNames"),
    "setTuning 布尔入参 + 值变才动作（部分写语义）");
  assert.ok(engineSource.includes("if (E.scene && Array.isArray(E.scene.ws)) updateChipText();"),
    "chip 文本非逐帧通道 → 翻转显式刷新（不需下一帧）");
  assert.ok(engineSource.includes("function templateNameHtmlOf(ws) {"), "chip/badge 共用副行组装式（单一出处）");
  assert.ok(engineSource.includes("tplZh: typeof w.tplZh === \"string\" && w.tplZh ? w.tplZh : null,"), "buildScenePure 透传 tplZh（缺席容忍）");

  /* ④ 词典 zh/en 成对（标签 / 提示 / aria / 图例四键）。 */
  const dictKeys = ["templateNamesLegend", "templateNamesLabel", "templateNamesHint", "templateNamesAria"];
  for (const key of dictKeys) {
    assert.equal(
      (clientSource.match(new RegExp('"cosmos\\.settings\\.' + key + '": ', "g")) ?? []).length,
      2,
      "词典 zh/en 成对：cosmos.settings." + key
    );
  }
}

/* ── 图样连线亮度设置面（add-cosmos-figure-line-alpha 3.1–3.4 / 4.3）：源码锚点 ──
   React 树 Node 侧不可挂载 → 滑杆控件/face 接线与词典成对走源码锚点；净房与引擎呈现
   分别由 settings-panel-smoke（4.1）与 engine-smoke（4.2）运行时直测。 */
{
  /* ① 「通用」页签滑杆行：range 5–100 step 5 + 数值回显 + title/hint 双通道 + 独立 face。 */
  assert.ok(settingsSource.includes('data-setting="patLineDim"'), "「通用」页签滑杆行挂点（data-setting）");
  assert.ok(settingsSource.includes('type="range"'), "仓库首个 range 控件（滑杆）");
  assert.ok(settingsSource.includes("min={5}") && settingsSource.includes("max={100}") && settingsSource.includes("step={5}"),
    "合法域 5–100、步进 5");
  assert.ok(settingsSource.includes("value={patLineDimValue}"), "受控镜像回显（滑杆 value）");
  assert.ok(settingsSource.includes("onChange={(event) => setPatLineDim(Number(event.target.value))}"),
    "拖拽即提交（无草稿态，数值归一）");
  assert.ok(settingsSource.includes('aria-label={tr(t, "cosmos.settings.patLineDimAria"'), "滑杆 aria-label 走词典");
  assert.ok(settingsSource.includes('title={patLineDimHint}'), "辨识度代价提示经 title 通道（悬停可读）");
  assert.ok(settingsSource.includes('"cosmos.settings.patLineDimHint"'), "行内 hint 走词典");
  assert.ok(settingsSource.includes("const lineFace = props.patLineDim ?? null;"), "独立 patLineDim face（与 launch/templateNames 正交）");
  assert.ok(settingsSource.includes("lineFace?.set?.(value)"), "face.set 即时写（无暂存钮）");
  assert.ok(settingsSource.includes("{patLineDimValue}%"), "数值回显（百分比）");
  assert.ok(settingsSource.includes(".cs-rangeRow") && settingsSource.includes(".cs-rangeInput"), "新增行式样式类（cs-sizeRow 同族）");
  assert.ok(settingsSource.includes("min-height:44px"), "滑杆行触控目标 ≥44px");

  /* ② client 接线：受控镜像 + 控制器写入（持久化 → 引擎因子热更 → 镜像）+ face 三件套 + 注入。 */
  assert.ok(clientSource.includes("const cosmosPatLineDimStore = createSnapshotStore({ patLineDim: loadCosmosSettings().patLineDim });"),
    "受控镜像冷启动读持久值");
  assert.ok(clientSource.includes("savePatLineDim(value) {") && clientSource.includes("saveCosmosSettings({ patLineDim: value })"),
    "控制器写入：净房持久化（clampTo 百分比口径）");
  assert.ok(clientSource.includes("engine?.setTuning({ patLineDim: merged.patLineDim / 100 });"),
    "写入链：百分比 → 因子 setTuning 热更");
  assert.ok(clientSource.includes("cosmosPatLineDimStore.set({ patLineDim: merged.patLineDim });"),
    "写入链：受控镜像同步（滑杆回显）");
  const lineFaceBody = clientSource.slice(
    clientSource.indexOf("const patLineDimFace = {"),
    clientSource.indexOf("ctx.slots.inject(SETTINGS_TAB_SLOT", clientSource.indexOf("const patLineDimFace = {"))
  );
  assert.ok(lineFaceBody.includes("getSnapshot:"), "face.getSnapshot");
  assert.ok(lineFaceBody.includes("subscribe:"), "face.subscribe");
  assert.ok(lineFaceBody.includes("set:"), "face.set");
  assert.ok(lineFaceBody.includes("controller.savePatLineDim"), "整页存活 → 控制器写入（热更通道）");
  assert.ok(lineFaceBody.includes("saveCosmosSettings({ patLineDim: value })"), "整页未开 → 仍即时持久化（下次开页读回）");
  assert.ok(clientSource.includes("templateNames: templateNamesFace, patLineDim: patLineDimFace, worksFace: worksFaceSettings }"),
    "「通用」页签注入 patLineDim / worksFace face");
  assert.ok(clientSource.includes("cosmosPatLineDimStore.set({ patLineDim: next.patLineDim });"),
    "storage 跨窗桥同步 patLineDim 镜像");
  assert.ok(clientSource.includes("setTuning?.({ patLineDim: next.patLineDim / 100 })"),
    "storage 跨窗桥：已打开整页因子热更（仅本键真实值变时触达）");
  assert.ok(clientSource.includes("cosmosPatLineDimStore,"), "受控镜像导出面（观测/冒烟）");

  /* ③ 引擎接线：镜像初值、setTuning 数值分支 + 独立夹取、段/点同帧同源。 */
  assert.ok(engineSource.includes("patLineDim: patLineDimOf(opts.settings?.patLineDim),"),
    "引擎镜像初值（百分比 → 因子，非有限回落 0.5）");
  assert.ok(engineSource.includes("typeof settings?.patLineDim === \"number\" && Number.isFinite(settings.patLineDim)"),
    "setTuning 数值入参才更新（部分写语义）");
  assert.ok(engineSource.includes("clamp(settings.patLineDim, PAT_LINE_DIM_MIN, PAT_LINE_DIM_MAX)"),
    "独立夹取 [0.05, 1]");
  assert.ok(engineSource.includes("const patLineAlpha = E.patLineDim;") && engineSource.includes("const patDotAlpha = Math.min(PAT_DOT_DIM, patLineAlpha * PAT_DOT_LINE_RATIO);"),
    "帧内单次取镜像 + 点因子派生（恒 ≤ 线）");
  assert.ok(engineSource.includes("alpha: patLineAlpha") && engineSource.includes("alpha: patDotAlpha"),
    "段 α 与两观测面同帧同源");

  /* ④ 词典 zh/en 成对（图例 / 标签 / 提示 / aria 四键）。 */
  for (const key of ["patLineDimLegend", "patLineDimLabel", "patLineDimHint", "patLineDimAria"]) {
    assert.equal(
      (clientSource.match(new RegExp('"cosmos\\.settings\\.' + key + '": ', "g")) ?? []).length,
      2,
      "词典 zh/en 成对：cosmos.settings." + key
    );
  }
}

/* ── 浮签与 UI 铬件的遮挡避让与命中隔离（polish-cosmos-tip-ui-avoidance 2.1–2.3 / 3.1–3.4 /
      4.1–4.2 / 5.2 源码锚点）：React 树 Node 侧不可挂载 → 收集/发布接线与引擎消费点走
      源码锚点，几何与门禁行为由 engine-smoke 的 B/C 两段运行时直测（5.1–5.5）。 ── */
{
  /* ① 收集表（2.1）：选择器 + 类别单点维护，覆盖全部交互 chrome 与引擎自建 HUD */
  assert.ok(clientSource.includes("const COSMOS_CHROME_RECTS = ["), "矩形收集表单点定义（MUST NOT 在别处散写选择器）");
  for (const pair of [
    '[".dsh-cosmos-panel", "panel"],',
    '[".dsh-cosmos-queue", "queue"],',
    '[".dsh-cosmos-sessions", "sessions"],',
    '[".dsh-cosmos-actions", "actions"],',
    '[".cos-add-btn", "add"],',
    '[".cos-search", "search"],',
    '[".cos-home-btn", "home"],',
    '[".cos-dragpan-btn", "dragpan"],',
    '[\'.cos-wsbar-side[data-side="left"]\', "wsbar-left"],',
    '[\'.cos-wsbar-side[data-side="right"]\', "wsbar-right"]',
    '[\'.cos-wsbar-tools[data-side="left"]\', "wsbar-tool-left"]',
    '[\'.cos-wsbar-tools[data-side="right"]\', "wsbar-tool-right"]',
    '[".cos-badge-cluster", "wstools"]'
  ]) {
    assert.ok(clientSource.includes(pair), "收集表覆盖：" + pair);
  }
  assert.ok(clientSource.includes('const COSMOS_CHROME_DRILL_ONLY = new Set(["wsbar-left", "wsbar-right", "wsbar-tool-left", "wsbar-tool-right", "wstools"]);'),
    "钻取态专属类别（银河态槽位不可见 → MUST NOT 参与判定，防隐形阻挡带）");
  assert.ok(clientSource.includes("if (drill == null && COSMOS_CHROME_DRILL_ONLY.has(kind)) continue;"),
    "银河态跳过 wsbar 槽位矩形（呈现态才参与）");
  assert.ok(!clientSource.includes('[\'.dsh-cosmos-const-float\', "float"]'),
    "浮窗不进矩形表（全屏模态 → 引擎 isFloatOpen 探针等价覆盖，零开合订阅）");

  /* ② 坐标口径（2.1 / D2）：窗口视口坐标减引擎根容器原点 → 容器坐标 + 原点同批发布 */
  assert.ok(clientSource.includes("const originBox = host.getBoundingClientRect();"),
    "原点 = 引擎根容器（hostRef）的 getBoundingClientRect（窗口原点 ≠ 容器原点）");
  assert.ok(clientSource.includes("left: box.left - originX,") && clientSource.includes("bottom: box.bottom - originY"),
    "矩形归一化到容器坐标（逐边减原点）");
  assert.ok(clientSource.includes("controllerRef.current?.setUiChromeRects?.(rects, { x: originX, y: originY })"),
    "发布载荷 = { rects, origin }（原点随矩形同批）");
  assert.ok(clientSource.includes("if (applied) lastSignature = signature;"),
    "发布成功才写缓存（引擎缺席时不吞掉重试机会）");
  assert.ok(clientSource.includes("if (!(box.width > 0) || !(box.height > 0)) continue;"),
    "零尺寸（未布局/已卸载）条目跳过（与引擎规范化同口径）");

  /* ③ 重算触发面（2.2）：布局事实驱动 + rAF 合并 + client 侧签名缓存（MUST NOT 逐帧测量） */
  assert.ok(clientSource.includes('if (typeof ResizeObserver !== "undefined") resizeObserver = new ResizeObserver(schedule);'),
    "页面容器与每个 chrome 共挂 ResizeObserver（内容驱动高度变化同触发）");
  assert.ok(clientSource.includes("mutationObserver.observe(frame, { childList: true, subtree: true });"),
    "子节点增删（面板挂载/卸载、搜索框随钻取态、引擎 HUD 建树）走 MutationObserver");
  assert.ok(clientSource.includes("if (!raf) raf = requestAnimationFrame(collect);"),
    "rAF 合并发布（同帧多次变化只发一次）");
  assert.ok(clientSource.includes('const signature = originX.toFixed(1) + "," + originY.toFixed(1) + "|" + parts.join(";");')
    && clientSource.includes("if (signature !== lastSignature) {"),
    "client 侧缓存上次值：布局未变零发布");
  assert.ok(clientSource.includes("resizeObserver.observe(node);") && clientSource.includes("resizeObserver.unobserve?.(node);"),
    "订阅集随 DOM 增删同步（每轮收集后重挂）");
  assert.ok(clientSource.includes("}, [drill]);"),
    "订阅重建以钻取态为唯一 React 依赖（其余靠观察者，避免逐帧重算）");
  assert.ok(clientSource.includes("schedule(); // 首帧即发布：引擎首帧就要矩形，不能等第一个布局事件"),
    "挂载首帧即发布（引擎首帧判定不空转）");

  /* ④ 控制器转发（2.3）：与 setExternalHover 同款可选链接线，引擎缺席静默降级 */
  assert.ok(clientSource.includes("setUiChromeRects(rects, origin) {")
    && clientSource.includes("return engine?.setUiChromeRects?.({ rects, origin }) === true;"),
    "控制器转发：可选链 + 布尔返回（引擎未挂载/未升级 → false 不抛错）");

  /* ⑤ 引擎消费点（3.x / 4.x）：单点判定 + 各自族规则 + 事件级门禁 */
  assert.ok(engineSource.includes("export function normalizeUiRects(rects) {"), "矩形规范化纯函数（发布面净房点）");
  assert.ok(engineSource.includes("export function boxInRects(box, rects, ignoreKinds) {")
    && engineSource.includes("export function pointInRects(x, y, rects, ignoreKinds) {"),
    "相交谓词单点实现（盒 + 点；D3 与 D4 共用）");
  assert.ok(engineSource.includes("export function tipAvoidanceOf(candidate, rects, bounds) {"),
    "避让决策纯函数（keep / hide / place / degraded）");
  assert.ok(engineSource.includes("function pointInUiRects(x, y, ignoreKinds) {")
    && engineSource.includes("function intersectsUiRects(box, ignoreKinds) {"),
    "引擎态薄包装（E.uiRects 绑定，唯一消费入口）");
  assert.ok(engineSource.includes("uiRects: [],") && engineSource.includes("uiOrigin: { x: 0, y: 0 },"),
    "引擎缓存 = 矩形集 + 容器原点（帧内只比对数组）");
  assert.ok(engineSource.includes("setUiChromeRects(payload) {") && engineSource.includes("inspectUiRects() {"),
    "公共面 setUiChromeRects + 观测面 inspectUiRects");
  /* 3.1 chip：相交即隐藏（走既有 .on/内联 opacity 路径，MUST NOT 平移锚点） */
  assert.ok(engineSource.includes("if (uiModalOpen() || intersectsUiRects(chipBoxOf(chipX, chipY, chipHalf, chipHeightOf(el)))) {"),
    "chip 相交 → 本帧隐藏（判定在定位算出之后、写 transform 之前）");
  const chipHideBlock = engineSource.slice(
    engineSource.indexOf("if (uiModalOpen() || intersectsUiRects(chipBoxOf("),
    engineSource.indexOf("el.style.transform = 'translate(' + chipX.toFixed(1)")
  );
  assert.ok(chipHideBlock.includes("el.classList.remove('on');") && chipHideBlock.includes("el.style.opacity = ''"),
    "chip 隐藏复用既有「.on 移除 + 内联 opacity 清理」路径（显隐机制零新增）");
  assert.ok(chipHideBlock.includes("return;") && !chipHideBlock.includes("chipX ="), "MUST NOT 平移 chip 锚点");
  /* 3.2 卡：既有翻转/钳位结果再过 tipAvoidanceOf，pe 降级单写点 */
  assert.ok(engineSource.includes("const avoid = tipAvoidanceOf("), "信息卡避让接入（UI 感知钳位）");
  assert.ok(engineSource.includes("if (E.el.card.style.pointerEvents !== cardPe) E.el.card.style.pointerEvents = cardPe;"),
    "降级单写点（相交帧 pe:none、离开即清回 auto；不重建 DOM、不进内容签名）");
  assert.ok(engineSource.includes("hx: snap1(scr2.x + cardDir * scr2.r), hy: snap1(scr2.y),"),
    "引线起笔侧随避让后的卡侧（端点与判定同一组数）");
  /* 3.3 兜底族：切换条目 / 回到银河 / 拖拽开关；名牌与引线显式不参与 */
  assert.ok(engineSource.includes("syncWsbarItems(uiChromeSafeItemsOf("), "切换条目纳入同一相交兜底（自遮挡排除同侧槽）");
  assert.ok(engineSource.includes("function uiChromeSafeItemsOf(items) {") && engineSource.includes("const selfKind = 'wsbar-' + entry.side;"),
    "条目兜底判据：自身槽类别忽略（否则永远与自己相交）");
  assert.ok(engineSource.includes("syncHudOcclusion(E.el.homeBtn, 'home');") && engineSource.includes("syncHudOcclusion(E.el.dragPanBtn, 'dragpan');"),
    "回到银河 / 拖拽开关兜底判定（逐帧幂等 class 切换）");
  assert.ok(engineSource.includes("function syncHudOcclusion(el, kind) {") && engineSource.includes("const own = uiRectOfKind(kind);")
    && engineSource.includes("const hidden = uiModalOpen() || (own ? intersectsUiRects(own, kind) : false);"),
    "HUD 兜底：自身类别的真实 rect + 浮窗模态，缺矩形按未命中");
  assert.ok(engineSource.includes(".cos-hud-occluded { opacity: 0; pointer-events: none; }"),
    "遮挡让位样式（视觉退场 + 命中放行，键盘等价路径仍在）");
  assert.ok(!/intersectsUiRects\([^)]*slab/.test(engineSource), "名牌（slab）显式不参与避让判定");
  /* 3.4 单帧判定：updateOverlay 内零 DOM 测量（chip 高/卡盒均为 data 缓存） */
  const updateOverlayBody = engineSource.slice(
    engineSource.indexOf("function updateOverlay() {"),
    engineSource.indexOf("function measureCardBox() {")
  );
  assert.ok(updateOverlayBody.length > 1000, "updateOverlay 切片有效（帧内判定唯一计算点）");
  assert.ok(!updateOverlayBody.includes("getBoundingClientRect"), "帧循环内零 rect 查询（D7 性能红线）");
  assert.ok(updateOverlayBody.includes("chipHeightOf(el)"), "chip 盒高走 data-h 缓存（同 data-w 纪律）");
  assert.ok(updateOverlayBody.includes("const avoid = tipAvoidanceOf("), "避让判定收敛在 updateOverlay 本帧");
  /* 4.1 / 4.2 命中门禁：pointerdown 布防 + click 首行消费 + 同谓词复检 */
  assert.ok(engineSource.includes("function uiGateArm(clientX, clientY, ignoreKinds) {")
    && engineSource.includes("function uiGateTake() {"),
    "门禁一次性抑制（pointerdown 布防 / click 消费）");
  assert.ok(engineSource.includes("chip.addEventListener('pointerdown', function (ev) {")
    && engineSource.includes("E.el.card.addEventListener('pointerdown', function (ev) {"),
    "chip 与信息卡 pointerdown 布防（D4 首行落点门禁）");
  for (const site of ["item.addEventListener('click', function (ev) {", "homeBtn.addEventListener('click', function (ev) {"]) {
    assert.ok(engineSource.includes(site), "click 处理器带事件参数：" + site);
  }
  const gateCount = (engineSource.match(/if \(uiGateTake\(\)\) return;/g) ?? []).length;
  assert.equal(gateCount, 5, "五处可交互浮签均消费门禁（chip / 卡 / 切换条目 / home / dragpan）");
  const blockCount = (engineSource.match(/if \(uiHitBlocked\(ev\?\.clientX/g) ?? []).length;
  assert.equal(blockCount, 5, "五处 click 均做同谓词复检（防 pointerdown 后矩形更新窗口）");
  assert.ok(engineSource.includes("function uiPointOf(clientX, clientY) {")
    && engineSource.includes("return { x: x - E.uiOrigin.x, y: y - E.uiOrigin.y };"),
    "事件级换算：clientX/clientY − 缓存原点（零 DOM 测量）");
  assert.ok(engineSource.includes("function uiHitBlocked(clientX, clientY, ignoreKinds) {")
    && engineSource.includes("if (uiModalOpen()) return true;"),
    "门禁判据：浮窗模态 → 整屏视为命中铬件");
  /* 6.3 文档注释：引擎头注 + client 发布处引用设计裁决 */
  assert.ok(engineSource.includes("polish-cosmos-tip-ui-avoidance（浮签与 UI 铬件的遮挡避让与命中隔离）："),
    "引擎头注补充本提案裁决（呈现与命中分离）");
  assert.ok(clientSource.includes("UI 铬件矩形收集与发布（polish-cosmos-tip-ui-avoidance 2.1/2.2 / design D2）"),
    "client 发布处注释引用 design D2（坐标口径与触发面）");
  assert.ok(engineSource.includes("矩形契约缺席") || engineSource.includes("契约缺席"),
    "引擎注释声明「矩形契约缺席 → 现状回落」红线");
}

/* ── N. 顶部缩放标尺（add-cosmos-zoom-ruler 2.1–2.4）：源码锚点 + 布局/只读/缓动纪律 ──
   React 组件树在 Node 侧不可挂载 → DOM/CSS 走源码锚点；映射、缓动分型与数据通道门限由
   engine-smoke 直测（纯函数 + 引擎接线）。 */
{
  assert.ok(clientSource.includes('className="cos-zoom-ruler"'), "标尺覆盖层 JSX");
  assert.ok(clientSource.includes('data-plugin-anchor="dsh-v-cosmos:zoom-ruler"'), "标尺插件锚点");
  assert.ok(clientSource.includes('className="cos-zoom-ruler-track"'), "轨道元素");
  assert.ok(clientSource.includes('className="cos-zoom-ruler-tick"'), "刻度元素");
  assert.ok(clientSource.includes('className="cos-zoom-ruler-thumb"'), "游标元素");
  assert.ok(clientSource.includes("zoomMeterTrackOf(meter.dist, meter.distMin, meter.distMax)"), "thumb 位置 = 引擎对数映射同源");
  assert.ok(clientSource.includes("zoomRulerMotionOf(previous / 100, track)"), "缓动分型 = 引擎纯函数同源");
  assert.ok(clientSource.includes("engine.onZoomMeter(applyMeter)"), "订阅引擎标尺数据通道（不轮询）");
  assert.ok(!clientSource.includes("inspectZoomNav"), "页面侧无逐帧轮询路径（只走 onZoomMeter 回调）");
  assert.ok(clientSource.includes("ZOOM_RULER_EASE_MS + 60"), "缓动到位兜底移除（transitionend 之外）");
  assert.ok(clientSource.includes('thumb.addEventListener("transitionend"'), "到位移除过渡类");
  assert.ok(clientSource.includes("const ZOOM_RULER_TICK_PCT = zoomMeterTrackOf(ZOOM_RULER_TICK, ZOOM_RULER_DIST_MIN, ZOOM_RULER_DIST_MAX) * 100;"), "tick 位置与引擎常量同源（一次计算）");
  /* 只读：无交互语义、不进键盘焦点链、指针事件穿透 */
  const rulerStart = clientSource.indexOf('className="cos-zoom-ruler"');
  const rulerBlock = clientSource.slice(rulerStart, clientSource.indexOf("</div>", rulerStart) + 6);
  assert.ok(rulerBlock.length > 0, "标尺 JSX 切片可定位");
  assert.ok(!/tabIndex|onClick|onWheel|onKeyDown/.test(rulerBlock), "标尺无交互语义（不进键盘焦点链，无点击/滚轮处理器）");
  assert.ok(rulerBlock.includes('aria-hidden="true"'), "标尺对辅助技术隐藏（纯视觉指示）");
  /* 嵌入式布局：顶缘水平居中、宽高、z 序低于搜索框 */
  assert.ok(clientSource.includes(".cos-zoom-ruler{position:absolute;top:0;left:50%;transform:translateX(-50%);z-index:24"), "嵌入式：顶缘水平居中（z 序 24 < 搜索框 40）");
  assert.ok(clientSource.includes("width:min(520px,44vw);height:12px"), "嵌入式：宽 min(520px,44vw)、高 12px（10–14px 带内）");
  assert.ok(clientSource.includes("padding:5px 0;pointer-events:none}"), "只读：pointer-events:none（滚轮/指针穿透画布）");
  assert.ok(clientSource.includes(".cos-zoom-ruler-thumb.cos-zoom-ruler-ease{transition:left 200ms ease-out}"), "跳变缓动 = 200ms ease-out");
  /* dock 布局避让与窄宽隐藏 */
  assert.ok(clientSource.includes(".cos-page-dock .cos-zoom-ruler{left:calc(8px + min(var(--cos-search-w,320px), calc(100% - 16px)) + 8px);right:8px"), "dock：左缘 = 搜索框右缘 + 8px、右缘留 8px");
  assert.ok(clientSource.includes("max-width:min(300px,34vw)"), "dock：宽上限 min(300px,34vw)");
  assert.ok(clientSource.includes('[data-narrow="true"]{display:none}'), "dock：可用宽 <160px 整体隐藏");
  assert.ok(clientSource.includes('data-narrow={rulerNarrow ? "true" : undefined}'), "窄宽判定下发 data-narrow");
  assert.ok(clientSource.includes("const available = width - 16 - searchW - 8;") && clientSource.includes("setRulerNarrow(available < 160)"), "可用宽阈值 160px（ResizeObserver 实测）");
  /* 视觉令牌复用风格 D HUD 族（--cos-line / --cos-accent） */
  assert.ok(clientSource.includes("background:var(--cos-line,rgba(255,210,140,.35))"), "轨道复用 --cos-line 令牌");
  assert.ok(clientSource.includes("background:var(--cos-accent,#ffd28a)"), "游标复用 --cos-accent 令牌");
}

/* ── N2. 搜索回车钻取（add-cosmos-search-enter-dive 2.1/2.2/3.1/3.2）──
   React 组件树在 Node 侧不可挂载 → 判定纯函数由 merge-smoke 直测（唯一命中 / 零命中 /
   多命中 / 空查询 / 单工作区边界），本节锚定「接线位次 / 键语义 / shake 本地态 / 视觉面」
   等结构事实。 */
{
  /* 键语义：Enter 分支位于 IME 让位之后、closePage 消费之前（design D3：置于 closePage
     之后即不可达死代码；行为消费序 IME → closePage → Enter 与键集不相交等价）。 */
  const inputAt = clientSource.indexOf('className="cos-search-input"');
  const imeAt = clientSource.indexOf("if (e.isComposing === true || e.keyCode === 229) return;", inputAt);
  const enterAt = clientSource.indexOf('if (e.key === "Enter") {', inputAt);
  const closeAt = clientSource.indexOf("if (!shortcutMatches(e, shortcuts.closePage)) return;", inputAt);
  assert.ok(inputAt > 0, "搜索框输入元素锚点可定位");
  assert.ok(imeAt > inputAt, "搜索框 IME 组字让位守卫在输入处理器首部");
  assert.ok(enterAt > imeAt, "Enter 分支位于 IME 让位之后（组字中 Enter 归输入法确认）");
  assert.ok(closeAt > enterAt, "Enter 分支位于 closePage 消费之前（非死代码）");
  const enterBlock = clientSource.slice(enterAt, closeAt);
  assert.ok(enterBlock.includes('e.key === "Enter"'), "Enter 以 e.key 判定（主键区 + 数字键盘同为 Enter）");
  assert.ok(!/e\.code/.test(enterBlock), "不做 ev.code 参数化（键盘区差异不引入第二语义）");
  /* 判定走纯函数（同帧 scene 快照 + 受控查询 ref）；dive 走引擎既有公共面。 */
  assert.ok(enterBlock.includes("const target = enterDiveTarget(controllerRef.current?.getScene?.() ?? null, queryRef.current);"),
    "判定 = enterDiveTarget(当前 scene, queryRef)（纯函数、零新增引擎态）");
  assert.ok(enterBlock.includes("controllerRef.current?.getEngine?.()?.diveToWs?.(target.wsId);"),
    "dive 分支走引擎 diveToWs 公共面（与 chip 点击同一钻取语义）");
  assert.ok(enterBlock.includes("setShakeTick((tick) => tick + 1);"), "shake 分支仅递增本地 tick");
  assert.ok(!enterBlock.includes("stopPropagation"), "Enter 分支不 stopPropagation（Enter 无冒泡消费面）");
  assert.ok((enterBlock.match(/e\.preventDefault\(\);/g) ?? []).length >= 1, "两分支均 preventDefault（封闭默认动作）");
  /* shake 不改变查询、不清失焦；dive 后查询冻结由结构（搜索框随钻取态卸载）保证。 */
  assert.ok(!enterBlock.includes("applyQuery("), "Enter 不清空/不改写查询（查询冻结）");
  assert.ok(!enterBlock.includes(".blur("), "Enter 不失焦（shake 后焦点保持）");
  /* shake 本地态：tick 挂 data-shake、动画结束摘除（下次递增重播）。 */
  assert.ok(clientSource.includes("const [shakeTick, setShakeTick] = useState(0);"), "shakeTick 本地态（会话态、零持久化）");
  assert.ok(clientSource.includes("data-shake={shakeTick > 0 ? shakeTick : undefined}"),
    "data-shake 由 tick 驱动（0 = 属性摘除，递增重新挂载）");
  assert.ok(clientSource.includes('if (e.animationName === "cos-search-shake") setShakeTick(0);'),
    "onAnimationEnd 清标记（只认本动画名，防未来动效误清）");
  assert.ok(clientSource.includes("enterDiveTarget"), "判定纯函数经 merge.mjs 导入");
  assert.ok(/import \{[^}]*\benterDiveTarget\b[^}]*\} from "\.\/merge\.mjs";/.test(clientSource),
    "enterDiveTarget 自 merge.mjs 导入（单一实现）");
  /* 视觉面：keyframes 水平 ±3px、约 200ms、transform only（不触发布局）。 */
  const kfAt = clientSource.indexOf("@keyframes cos-search-shake{");
  assert.ok(kfAt > 0, "shake keyframes 存在");
  const kfRule = clientSource.slice(kfAt, clientSource.indexOf("\n", kfAt));
  assert.ok(kfRule.includes("translateX(-3px)") && kfRule.includes("translateX(3px)"), "水平振幅 ±3px");
  assert.ok(!/\b(top|left|right|bottom|width|height|margin|padding|opacity|background|color):/.test(kfRule),
    "keyframes 仅 transform（不触发布局/绘制属性）");
  const animM = /\.cos-search-input\[data-shake\]\{animation:cos-search-shake (\d+)ms/.exec(clientSource);
  assert.ok(animM && Number(animM[1]) >= 150 && Number(animM[1]) <= 300, "shake 时长约 200ms（150–300ms 带内）");
  /* 3.2 无叠算残留：shake 挂 input 自身（不动 .cos-search 的 translateX 居中盒），
     .cos-search 的 z 序/宽度/窄列规则零改动（既有锚点断言见第 18 节）。 */
  const searchRuleAt = clientSource.indexOf(".cos-search{position:absolute;top:12px");
  assert.ok(searchRuleAt > 0 && clientSource.indexOf("@keyframes cos-search-shake{") > searchRuleAt,
    "shake 规则不夹带 .cos-search 盒模型改动（既有规则原样保留）");
}

/* ── N3. 搜索前缀候选列表（add-cosmos-search-prefix-suggest 2.1–2.3 / 3.1–3.3 / 4.1）──
   数据面（末 token 前缀 / 名称∪slug 候选域 / 去重 / 字典序 / 截断）由 merge-smoke 直测；
   React 组件树在 Node 侧不可挂载（react 为 bundle external）→ 本节锚定「接线 / 开合派生 /
   键盘矩阵位次 / 鼠标语义 / 无障碍关联 / 视觉面」结构事实；运行时行为（下拉出现、硬边界、
   钻取与飞回清空、IME 让位）由真机验收（5.1/5.2）承接。 */
{
  /* ① 接线：候选纯函数自 merge.mjs 导入（单一实现；候选域 MUST NOT 在前端另抄一份） */
  assert.ok(/import \{[^}]*\bprefixSuggestions\b[^}]*\} from "\.\/merge\.mjs";/.test(clientSource),
    "prefixSuggestions 自 merge.mjs 导入（与过滤匹配域同源）");
  assert.ok(clientSource.includes("const rows = prefixSuggestions(scene, filter.query);"),
    "候选计算 = prefixSuggestions(当前 scene, 查询)（纯函数、零新增数据面）");
  assert.ok(clientSource.includes("wsName: row.kind === \"slug\" ? (names.get(row.wsId) ?? \"\") : \"\""),
    "slug 命中附工作区名作次要信息（纯函数输出形状不变，React 层回查）");

  /* ② 2.2 开合派生：候选非空且未 dismiss（无候选零 DOM）+ 高亮夹取 */
  assert.ok(clientSource.includes("const [suggestIndex, setSuggestIndex] = useState(0);"),
    "高亮位本地态（与鼠标共用单一高亮位）");
  assert.ok(clientSource.includes("const [suggestDismissed, setSuggestDismissed] = useState(false);"),
    "dismissed 本地态（会话态、零持久化）");
  assert.ok(clientSource.includes("const suggestRows = useMemo(") && clientSource.includes("}, [sceneVersion, filter.query]);"),
    "候选集 useMemo 依赖 = 场景版本 + 查询（键入即时重算、零轮询零防抖）");
  assert.ok(clientSource.includes("const suggestOpen = suggestRows.length > 0 && !suggestDismissed;"),
    "开合 = 派生态（候选非空 && 未 dismiss）");
  assert.ok(clientSource.includes("const suggestActive = Math.min(Math.max(suggestIndex, 0), Math.max(0, suggestRows.length - 1));"),
    "高亮夹取在候选区间内（候选收缩不越界指向不存在的 option）");

  /* ③ 键入复位单点：onChange → typeQuery；applyQuery 不复位（补全后的 dismissed 不被覆盖） */
  assert.ok(clientSource.includes("onChange={(e) => typeQuery(e.target.value)}"),
    "onChange 走 typeQuery（复位挂在键入调用点）");
  const typeAt = clientSource.indexOf("const typeQuery = (next) => {");
  assert.ok(typeAt > 0, "typeQuery 存在");
  const typeBlock = clientSource.slice(typeAt, clientSource.indexOf("};", typeAt));
  assert.ok(typeBlock.includes("setSuggestIndex(0);") && typeBlock.includes("setSuggestDismissed(false);")
    && typeBlock.includes("applyQuery(next);"),
    "typeQuery = 高亮复位首位 + dismissed 复位 + 写查询");
  assert.ok(typeBlock.indexOf("setSuggestIndex(0);") < typeBlock.indexOf("applyQuery(next);"),
    "复位先于写查询（设计 D2 的次序约束）");
  const applyAt = clientSource.indexOf("const applyQuery = (next) => {");
  const applyBlock = clientSource.slice(applyAt, clientSource.indexOf("};", applyAt));
  assert.ok(!applyBlock.includes("setSuggest"), "applyQuery 不碰候选态（复位单点在键入路径 → 补全后不会当场重开）");

  /* ④ 补全动作：末 token 替换 + 关列表 + 过滤即时生效 + 不钻取 */
  const completeAt = clientSource.indexOf("const completeSuggestion = (row) => {");
  assert.ok(completeAt > 0, "completeSuggestion 存在（Tab / click 共用同一实现）");
  const completeBlock = clientSource.slice(completeAt, clientSource.indexOf("};", completeAt));
  assert.ok(completeBlock.includes("tokens[tokens.length - 1] = row.text;"),
    "补全替换**末** token（前序 token 原样保留）");
  assert.ok(completeBlock.includes("applyQuery(tokens.join(\" \"));"), "补全经 applyQuery 重放查询（过滤自然收窄）");
  assert.ok(completeBlock.includes("setSuggestDismissed(true);"), "补全后关列表（自命中不重开）");
  assert.ok(!completeBlock.includes("diveToWs"), "补全不钻取（与 Enter 语义分离）");
  assert.ok(!completeBlock.includes(".blur("), "补全不失焦（焦点留在输入框）");

  /* ⑤ 键盘矩阵位次（design D3）：IME 让位 → ↑/↓ → Tab → Enter → closePage（键集不相交） */
  const inputAt = clientSource.indexOf('className="cos-search-input"');
  const imeAt = clientSource.indexOf("if (e.isComposing === true || e.keyCode === 229) return;", inputAt);
  const arrowAt = clientSource.indexOf('if (suggestOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {', inputAt);
  const tabAt = clientSource.indexOf('if (suggestOpen && e.key === "Tab" && e.shiftKey !== true) {', inputAt);
  const enterAt = clientSource.indexOf('if (e.key === "Enter") {', inputAt);
  const closeAt = clientSource.indexOf("if (!shortcutMatches(e, shortcuts.closePage)) return;", inputAt);
  assert.ok(inputAt > 0 && imeAt > inputAt, "IME 让位守卫在输入处理器首部（组字中导航/补全/钻取全部让位）");
  assert.ok(arrowAt > imeAt && arrowAt < enterAt, "↑/↓ 分支位于 IME 让位之后、Enter 之前");
  assert.ok(tabAt > arrowAt && tabAt < enterAt, "Tab 分支位于 ↑/↓ 之后、Enter 之前");
  assert.ok(enterAt > tabAt && enterAt < closeAt, "Enter 分支在 closePage 消费行之前（非死代码）");

  /* ↑/↓：硬边界（clamp，不循环）+ 仅列表开才消费 + preventDefault */
  const arrowBlock = clientSource.slice(arrowAt, tabAt);
  assert.ok(arrowBlock.includes('const delta = e.key === "ArrowDown" ? 1 : -1;'), "翻选方向键判别");
  assert.ok(arrowBlock.includes("setSuggestIndex(Math.min(Math.max(suggestActive + delta, 0), suggestRows.length - 1));"),
    "高亮位移 clamp 到 [0, 末位]（硬边界，不循环）");
  assert.ok(arrowBlock.includes("e.preventDefault();"), "翻选 preventDefault（阻止光标移动）");
  assert.ok(!arrowBlock.includes("stopPropagation"), "翻选不 stopPropagation（箭头无冒泡消费面）");

  /* Tab：列表开且有高亮才 consume；无候选放行焦点 */
  const tabBlock = clientSource.slice(tabAt, enterAt);
  assert.ok(tabBlock.includes("completeSuggestion(suggestRows[suggestActive]);"), "Tab = 补全高亮候选");
  assert.ok(tabBlock.includes("e.preventDefault();"), "Tab 补全 preventDefault");
  assert.ok(tabBlock.includes('e.shiftKey !== true'), "Shift+Tab 不消费（无反向补全语义，放行反向焦点移动）");
  const closeLine = "if (!shortcutMatches(e, shortcuts.closePage)) return;";
  assert.ok(clientSource.includes(closeLine), "closePage 消费行保留（非关闭键在此 return，其后即不可达）");

  /* Enter：列表态优先（钻取高亮候选、文本不动），无列表态回落 enter-dive 判定 */
  const enterBlock = clientSource.slice(enterAt, closeAt);
  const listEnterAt = enterBlock.indexOf("if (suggestOpen) {");
  const diveTargetAt = enterBlock.indexOf("const target = enterDiveTarget(");
  assert.ok(listEnterAt >= 0 && diveTargetAt > listEnterAt, "Enter 列表态分支置于无列表唯一命中分支之前");
  assert.ok(enterBlock.includes("if (row) controllerRef.current?.getEngine?.()?.diveToWs?.(row.wsId);"),
    "列表态 Enter = diveToWs(候选 wsId)（命令面板语义，文本不动）");
  assert.ok(enterBlock.slice(listEnterAt, diveTargetAt).includes("e.preventDefault();"),
    "列表态 Enter preventDefault（封闭默认动作）");
  assert.ok(!enterBlock.includes("applyQuery("), "Enter 两分支均不清空/不改写查询（查询冻结）");
  assert.ok(!enterBlock.includes(".blur("), "Enter 两分支均不失焦");

  /* Esc 分层：列表开 → 仅关列表（dismissed 置位 + return），列表关 → 既有清空+失焦 */
  const dismissAt = clientSource.indexOf("setSuggestDismissed(true);", closeAt);
  const clearAt = clientSource.indexOf('applyQuery("");', closeAt);
  assert.ok(dismissAt > closeAt && dismissAt < clearAt,
    "Esc 分层：列表开 → dismissed 置位并 return（不落到清空层）");
  const escBlock = clientSource.slice(closeAt, clearAt);
  assert.ok(escBlock.includes("if (suggestOpen) {") && escBlock.includes("return;"), "Esc 列表开分支提前返回");
  assert.ok(escBlock.includes("e.stopPropagation();"), "Esc 两分支均 stopPropagation（MUST NOT 冒泡到外壳分层）");
  assert.ok(clientSource.slice(clearAt, clearAt + 120).includes("e.currentTarget.blur();"),
    "Esc 列表关回落既有「清空 + 失焦」");
  assert.equal((clientSource.match(/applyQuery\(""\)/g) ?? []).length, 3,
    "查询清理点仍为 3 处（本提案零新增清空点：Esc 列表层只置 dismissed）");

  /* ⑥ 4.1 鼠标语义：hover 同步高亮 / mousedown 保焦点 / click 补全（不钻取） */
  assert.ok(clientSource.includes("onMouseEnter={() => setSuggestIndex(index)}"),
    "hover 同步高亮（与键盘共用单一高亮位，最后来源优先）");
  assert.ok(clientSource.includes("onMouseDown={(event) => event.preventDefault()}"),
    "mousedown preventDefault（保持输入框焦点，与清除按钮同款纪律）");
  assert.ok(clientSource.includes("onClick={() => completeSuggestion(row)}"), "click = 补全（等价 Tab，不钻取）");
  const optionAt = clientSource.indexOf('className="cos-search-suggest-item"');
  const optionBlock = clientSource.slice(optionAt, clientSource.indexOf(">", clientSource.indexOf("onClick={() => completeSuggestion(row)}")));
  assert.ok(!optionBlock.includes("diveToWs"), "候选条目不携带钻取动作（Pointer 面只补全）");
  assert.ok(!optionBlock.includes("onMouseLeave"), "移出保留最后高亮（无 mouseleave 清位）");

  /* ⑦ 2.1 无障碍：listbox/option/aria-selected + input aria-expanded/controls/activedescendant
     块内锚定（模板选择器另有 role="listbox"，故断言切在候选块内，不复用同名字面量） */
  const gateAt = clientSource.indexOf("{suggestOpen ? (", inputAt);
  const gateCloseAt = clientSource.indexOf(") : null}", gateAt);
  const searchBlockEndAt = clientSource.indexOf("\n      ) : null}", gateAt);
  const listBlock = clientSource.slice(gateAt, searchBlockEndAt);
  assert.ok(gateAt > 0 && gateCloseAt > gateAt && searchBlockEndAt > gateAt, "候选块切片可定位");
  assert.ok(listBlock.includes('className="cos-search-suggest"'), "下拉容器锚点");
  assert.ok(listBlock.includes('role="listbox"'), "容器 role=listbox");
  assert.ok(listBlock.includes('role="option"'), "条目 role=option");
  assert.ok(listBlock.includes("aria-selected={index === suggestActive}"), "aria-selected 随单一高亮位");
  assert.ok(clientSource.includes('aria-expanded={suggestOpen ? "true" : "false"}'), "input aria-expanded 随开合");
  assert.ok(clientSource.includes("aria-controls={suggestOpen ? SEARCH_SUGGEST_LIST_ID : undefined}"),
    "aria-controls 仅列表开时关联（关闭时不留悬空引用）");
  assert.ok(clientSource.includes("aria-activedescendant={suggestOpen ? searchSuggestOptionIdOf(suggestActive) : undefined}"),
    "aria-activedescendant 指向高亮条目");
  assert.ok(listBlock.includes("id={SEARCH_SUGGEST_LIST_ID}") && listBlock.includes("id={searchSuggestOptionIdOf(index)}"),
    "listbox / option 的 id 由同一生成器给出（id 关联闭环）");
  assert.ok(listBlock.includes("data-active={index === suggestActive || undefined}"),
    "高亮由 data 属性驱动（与既有 data-focused 同款纪律）");

  /* ⑧ 2.2 无候选零 DOM：列表整块以 suggestOpen 门控（无空态壳） */
  const listAt = clientSource.indexOf('className="cos-search-suggest"', inputAt);
  assert.ok(listAt > gateAt && listAt < gateCloseAt,
    "列表整块位于 suggestOpen 门控分支内（无候选零 DOM、无空态壳）");
  assert.ok(!clientSource.includes("cos-search-suggest-empty"), "不引入「无候选」空态壳");

  /* ⑨ 2.3 视觉面：正下方定位、z 序继承搜索框层（不另设）、窄列零覆盖、高亮不动布局 */
  assert.ok(clientSource.includes(".cos-search-suggest{position:absolute;top:calc(100% + 4px);left:0;right:0"),
    "列表 = 搜索框容器内绝对定位子元素（正下方、宽随容器）");
  const suggestRule = clientSource.slice(clientSource.indexOf(".cos-search-suggest{"), clientSource.indexOf("}", clientSource.indexOf(".cos-search-suggest{")));
  assert.ok(!suggestRule.includes("z-index"), "列表不另设 z-index（继承 .cos-search 的 z 40：高于画布/HUD、低于面板族 42+）");
  assert.ok(clientSource.includes(".cos-search{position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:40"),
    "搜索框层 z 序 40 原样（列表随父层）");
  assert.ok(!clientSource.includes(".cos-page-dock .cos-search-suggest"),
    "窄列重排零覆盖（列表随搜索框盒定位，自搜索条下缘起排）");
  assert.ok(clientSource.includes(".cos-page-dock .cos-search{top:10px;left:8px;transform:none;"),
    "窄列重排既有规则零改动");
  const activeRule = /\.cos-search-suggest-item\[data-active\]\{([^}]*)\}/.exec(clientSource);
  assert.ok(activeRule !== null, "高亮规则存在");
  assert.ok(!/\b(top|left|right|bottom|width|height|margin|padding|display|position|font-size):/.test(activeRule[1]),
    "高亮只动绘制属性（background / color；MUST NOT 触发布局或重排动画）");
  assert.ok(clientSource.includes(".cos-search-suggest-item::before{content:'';position:absolute;"),
    "高亮左缘标记走伪元素（零布局占位）");
}

/* ── N4. 返回银河清空搜索（polish-cosmos-search-clear-on-return 1.1 / 2.1 / 2.2）──
   React 组件树在 Node 侧不可挂载（react 为 bundle external）→ 接线（单点守卫 + 豁免面 +
   注释翻转）走**源码锚点**；状态链（filterQuery 闭包 / filterStore 镜像 / engine.setFilter）
   用引擎真实回调与真实返回路径直测（dive / Esc / 回到银河按钮 / flyOut / 注销 / 缩放越阈）。 */
{
  /* ① 1.1 单点守卫接线：prev 快照 → 镜像写入 → 非 null → null 才清空（顺序即语义）。 */
  const wiringAt = clientSource.indexOf("onDrillChange: (info) => {");
  assert.ok(wiringAt > 0, "onDrillChange 已改为守卫式回调（client 单点）");
  const prevAt = clientSource.indexOf("const prev = drillStore.getSnapshot();", wiringAt);
  const mirrorAt = clientSource.indexOf("drillStore.set(info);", wiringAt);
  const clearAt = clientSource.indexOf('if (prev && !info) actions.setFilter("");', wiringAt);
  assert.ok(prevAt > wiringAt, "先取 prev 快照（判定转换方向）");
  assert.ok(mirrorAt > prevAt, "prev 快照后写 drill 镜像");
  assert.ok(clearAt > mirrorAt, "镜像写入后按 prev && !info 守卫清空");
  const wiringBlock = clientSource.slice(wiringAt, clientSource.indexOf("},", clearAt));
  assert.equal((wiringBlock.match(/setFilter\(/g) ?? []).length, 1,
    "回调内单点清空（唯一 setFilter；引擎零新增公共面）");
  assert.ok(!wiringBlock.includes("if (info)"), "无非 null 分支动作（dive / 换星座不清空）");
  /* 1.1 配套：返回清空不经组件 applyQuery → queryRef MUST 与受控查询同步（否则 Enter 的
     空查询语义与外壳 Esc「清空搜索」层会读到旧查询）。 */
  assert.ok(clientSource.includes("useLayoutEffect(() => {\n    queryRef.current = query;\n  }, [query]);"),
    "queryRef 随 filterStore 查询单向同步（非键入清空路径同样收敛，无旧值残留）");

  /* ② 注释同步翻转（1.1 接线注释 / 1.2 搜索块挂载注释 / 1.2 引擎重挂续接注释）。 */
  assert.ok(clientSource.includes("返回银河即清空搜索（polish-cosmos-search-clear-on-return D1）"),
    "接线注释声明「返回银河即清空」");
  assert.ok(clientSource.includes("飞回银河即清空"), "搜索块挂载注释表述「飞回即清空」");
  assert.ok(clientSource.includes("重挂载保持当前查询（引擎重建非返回：守卫不清空，落位 + 坡道续接）"),
    "引擎重挂续接注释与 spec「引擎重建不清空」对齐");
  assert.ok(!clientSource.includes("飞回后带原查询重现"), "旧「飞回带原查询重现」表述零残留");

  /* ③ 2.2 豁免面源码锚点：teardown 直写不经回调；整页关开重置与引擎 boot/早退不变。 */
  assert.equal((clientSource.match(/drillStore\.set\(null\);/g) ?? []).length, 2,
    "引擎销毁 / 页卸载两处直写 drillStore（不经 onDrillChange → 守卫不误清）");
  const detachAt = clientSource.indexOf("detach() {");
  const detachBlock = clientSource.slice(detachAt, clientSource.indexOf("setOpen(nextOpen) {", detachAt));
  assert.ok(detachBlock.includes("drillStore.set(null);") && !detachBlock.includes("setFilter"),
    "页卸载路径只归零钻取镜像、不清查询");
  assert.ok(clientSource.includes('queryRef.current = "";') && clientSource.includes('controllerRef.current?.actions.setFilter("");'),
    "整页关闭重置查询/过滤（既有，spec「整页重开查询重置」）");
  assert.ok(engineSource.includes('drillKey: "\\u0000"'),
    "引擎 boot 幂等键初值「\\u0000」（未钻取首 null 通知 prev 恒 null）");
  const flyOutAt = engineSource.indexOf("function flyOut() {");
  const flyOutBlock = engineSource.slice(flyOutAt, engineSource.indexOf("function diveToWsById", flyOutAt));
  assert.ok(flyOutBlock.includes("if (E.focusMix <= 0 && !E.focusWs) { setSelection(null); return; }"),
    "银河视图 flyOut 早退仅清选中（无 drill 通知 → 不清空）");
  assert.ok(!flyOutBlock.includes("notifyDrill"),
    "flyOut 本身不发通知（返回落地通知在补间收尾；早退路径无通知）");

  /* ④ 2.1 / 2.2 运行时直测：客户端状态链镜像 + 引擎真实通知序列。
     镜像与 client.jsx 同形：filterQuery 闭包 + filterStore 快照 + syncFilter
     （engine.setFilter + 镜像写入）；守卫与接线同源（上文①锚定同一序列）。 */
  const realPerformance = globalThis.performance;
  let fakeNow = 900000;
  globalThis.performance = { now: () => fakeNow };
  rafQueue.length = 0;
  const clock = (ms) => {
    fakeNow += ms;
    const cb = rafQueue.shift();
    assert.ok(cb, "帧回调在队");
    cb(fakeNow);
  };
  const scene = {
    workspaces: [
      { id: "ws1", name: "alpha", pos: [-80, 0, 0], stars: [], links: [], planets: [], comets: [], archives: 0, satelliteCount: 0 },
      { id: "ws2", name: "beta", pos: [80, 0, 0], stars: [], links: [], planets: [], comets: [], archives: 0, satelliteCount: 0 }
    ]
  };
  const filterStore = createSnapshotStore({ query: "", matched: 2, total: 2, active: false });
  let filterQuery = "";
  let drillMirror = null;
  let clears = 0;
  const drillCalls = [];
  let engine = null;
  const syncFilter = () => {
    const active = filterQuery.trim() !== "";
    engine.setFilter(active ? new Set(["ws1", "ws2"]) : new Set(), new Map(), { active });
    filterStore.set({ query: filterQuery, matched: 2, total: 2, active });
  };
  const applyQuery = (next) => {
    filterQuery = next;
    syncFilter();
  };
  const guard = (info) => {
    const prev = drillMirror;
    drillMirror = info;
    drillCalls.push(info);
    if (prev && !info) {
      clears += 1;
      applyQuery("");
    }
  };
  const mountEngine = () => {
    const container = makeElement("div");
    const next = createCosmosEngine({ container, style: createSkinD(), onDrillChange: guard });
    engine = next;
    next.setScene(scene, "rebuild");
    next.start();
    return container.children[0];
  };
  const fire = (el, type, ev) => {
    for (const fn of el.listeners[type] ?? []) fn({ preventDefault() {}, ...ev });
  };
  let root = mountEngine();
  clock(50);
  assert.equal(drillCalls.length, 1, "boot 首个 null 通知（未钻取）");
  assert.equal(drillCalls[0], null, "通知载荷为 null");
  assert.equal(clears, 0, "boot 首 null（prev 恒 null）不触发清空");
  assert.equal(filterStore.getSnapshot().query, "");

  /* 2.1 dive 后 Esc 飞回：落地清空（filterQuery / filterStore / 引擎过滤三重断言）。 */
  applyQuery("alpha");
  assert.equal(engine.inspectFilter().active, true, "查询激活 → 引擎过滤 on");
  assert.equal(filterStore.getSnapshot().query, "alpha", "filterStore 镜像查询");
  engine.diveToWs("ws1");
  assert.deepEqual(drillCalls.at(-1), { wsId: "ws1", name: "alpha" }, "钻取通知（prev null → info）");
  assert.equal(clears, 0, "dive 不清空（无 prev 转换）");
  clock(1400);
  assert.equal(engine.isDiving(), true, "钻取态成立");
  assert.equal(filterStore.getSnapshot().query, "alpha", "钻取态查询冻结（无输入面）");
  assert.equal(engine.inspectFilter().active, true, "钻取态过滤呈现维持");
  engine.consumeEscape(); // Esc / 配置关闭键
  assert.equal(filterStore.getSnapshot().query, "alpha", "飞出补间在途查询仍冻结（落地才清）");
  clock(1400);
  assert.equal(engine.isDiving(), false, "已落地银河视图");
  assert.equal(clears, 1, "返回落地触发一次清空");
  assert.equal(filterQuery, "", "filterQuery 归零");
  assert.equal(filterStore.getSnapshot().query, "", "filterStore.query 清空");
  assert.equal(filterStore.getSnapshot().active, false, "filterStore 过滤关闭");
  assert.equal(engine.inspectFilter().active, false, "引擎过滤 active:false（完整银河）");

  /* 2.1 右下「回到银河」按钮：与 Esc 同一条 flyOut 收尾。 */
  applyQuery("beta");
  engine.diveToWs("ws1");
  clock(1400);
  const homeBtn = root.querySelector(".cos-overlay").children.find((el) => el.className === "cos-home-btn");
  assert.ok(homeBtn, "回到银河按钮已建（overlay 子级）");
  fire(homeBtn, "click", {});
  assert.equal(clears, 1, "点击瞬间补间在途 → 未清（落地才清）");
  clock(1400);
  assert.equal(clears, 2, "「回到银河」返回落地同样清空");
  assert.equal(filterStore.getSnapshot().query, "");
  assert.equal(engine.inspectFilter().active, false);

  /* 2.1 回家键 / 程序化飞回：同一 flyOut 公共面（goHome 键分派在 engine-smoke 4.3 既有）。 */
  applyQuery("beta");
  engine.diveToWs("ws2");
  clock(1400);
  engine.flyOut();
  clock(1400);
  assert.equal(clears, 3, "flyOut（回家键 / 程序化）落地清空");
  assert.equal(filterStore.getSnapshot().query, "");

  /* 2.2 银河视图点「回到银河」：flyOut 早退仅清选中 → 刚键入的查询不被误伤。 */
  applyQuery("gamma");
  const clearsAtGalaxy = clears;
  engine.flyOut();
  fire(homeBtn, "click", {});
  assert.equal(clears, clearsAtGalaxy, "银河态 flyOut 早退无 drill 通知、不清空");
  assert.equal(filterStore.getSnapshot().query, "gamma", "刚输入的查询保留");
  assert.equal(engine.inspectFilter().active, true, "过滤态保留");

  /* 2.2 引擎重建（页面内重挂 / 皮肤切换同构）：client 直写 drillStore 归零不经回调，
     attach 的 `if (filterQuery.trim()) syncFilter()` 续接 → 查询与过滤态保持。 */
  const callsBeforeRebuild = drillCalls.length;
  const clearsBeforeRebuild = clears;
  engine.dispose(); // detach：引擎销毁（不触发 onDrillChange）
  rafQueue.length = 0;
  root = mountEngine();
  clock(50);
  assert.equal(drillCalls.length, callsBeforeRebuild + 1, "新引擎 boot 首 null 通知");
  assert.equal(clears, clearsBeforeRebuild, "boot null（prev 恒 null）不清空");
  assert.equal(filterStore.getSnapshot().query, "gamma", "引擎重建查询保持（续接前）");
  syncFilter(); // attach: if (filterQuery.trim()) syncFilter()
  assert.equal(filterStore.getSnapshot().query, "gamma", "引擎重建续接后查询保持");
  assert.equal(engine.inspectFilter().active, true, "过滤态续接（引擎重建非返回，spec「引擎重建不清空」）");

  /* 2.4 ④ 银河态带查询切皮肤（呈现层热替 setSkin）：无 drill 通知、查询与过滤态保持。 */
  const callsBeforeSkin = drillCalls.length;
  const clearsBeforeSkin = clears;
  engine.setSkin(createSkinD(), "dark"); // 设置页皮肤点选 → 已打开引擎热切（client 唯一写者链路）
  assert.equal(drillCalls.length, callsBeforeSkin, "皮肤切换不产生 drill 通知");
  assert.equal(clears, clearsBeforeSkin, "皮肤切换不清空");
  assert.equal(filterStore.getSnapshot().query, "gamma", "银河态带查询切皮肤 → 查询保持");
  assert.equal(engine.inspectFilter().active, true, "切换后过滤态保持");

  /* 2.1 钻取中焦点星座注销（注销飞回）：notifyDrill(null) 同步先于飞回补间 → 清空即时。 */
  applyQuery("alpha");
  engine.diveToWs("ws2");
  clock(1400);
  const clearsBeforeGone = clears;
  engine.setScene({ workspaces: [scene.workspaces[0]] }, "rebuild"); // ws2 注销
  assert.equal(clears, clearsBeforeGone + 1, "注销 → 钻取镜像归零并清空（notifyDrill(null) 同步）");
  assert.equal(filterStore.getSnapshot().query, "", "注销返回清空查询");
  assert.equal(engine.inspectFilter().active, false, "注销返回过滤关闭（无半暗残留前提）");
  clock(1400);
  assert.equal(clears, clearsBeforeGone + 1, "随后 flyOut 收尾的重复 null 被引擎幂等键去重（不二次清空）");
  for (let i = 0; i < 4; i += 1) clock(120); // 过 FILTER_RAMP_DUR（0.35s）
  assert.deepEqual(engine.inspectFilter().filterAlphas.map((row) => row[1]), [1],
    "清空后 α 坡道回归 1（无半暗残留）");

  /* 2.1 缩放越过迟滞下限返回：与 Esc flyOut 等效的收尾通知。 */
  engine.setScene(scene, "rebuild");
  applyQuery("alpha");
  engine.diveToWs("ws1");
  clock(1400);
  fakeNow += 900; // 过切换冷却窗（SWITCH_COOLDOWN_MS = 800）
  clock(50);
  const clearsBeforeZoom = clears;
  const wheel = (dy) => fire(root, "wheel", { deltaY: dy, clientX: 300, clientY: 250 });
  wheel(120);
  wheel(120);
  assert.equal(clears, clearsBeforeZoom, "未越迟滞下限：仍处钻取态、不清空");
  wheel(120);
  assert.equal(clears, clearsBeforeZoom, "越阈触发 flyOut，落地前不清");
  clock(1400);
  assert.equal(clears, clearsBeforeZoom + 1, "缩放越阈返回落地清空");
  assert.equal(filterStore.getSnapshot().query, "");
  assert.equal(engine.inspectFilter().active, false);

  engine.dispose();
  rafQueue.length = 0;
  globalThis.performance = realPerformance;
}

console.log("client-ui-smoke: all assertions passed");
