/**
 * 渲染管线无头冒烟（add-celestial-states 追加，启动问题回归防线）：
 * DOM 桩环境下驱动引擎完整路径——rebuild / 帧循环（行星+卫星运动）/ patch
 * （卫星替换与生命周期迁移）/ 生命周期转场 fx / 事件流星 / hover→拾取→信息卡。
 * 任何渲染路径 ReferenceError/TypeError 在此显式失败（真机 GUI 启动问题难复现，
 * 本套件机械捕获渲染面运行时崩溃）。
 * 运行：node test/render-smoke.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCosmosEngine, ENGINE_CSS, WS_SWITCH_FADE } from "../src/cosmos/engine.mjs";
import { createSkinD } from "../src/cosmos/skin-d.mjs";
import { mergeScene } from "../src/merge.mjs";

/* ── DOM 桩（引擎/皮肤所用面） ── */

function makeCtx2d() {
  const grad = { addColorStop() {} };
  const store = {};
  return new Proxy(store, {
    get(target, prop) {
      if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => grad;
      if (prop === "measureText") return () => ({ width: 10 });
      if (!(prop in target)) target[prop] = () => undefined; // 任意方法调用 → no-op
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
globalThis.window = {
  devicePixelRatio: 1,
  addEventListener() {},
  removeEventListener() {}
};
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

/* ── 场景夹具：四态恒星 + 卫星行星 + 带卫星彗星（委托忙碌）+ 星云 ── */

function skeletonFixture() {
  return {
    version: 1,
    generatedAt: 0,
    workspaces: [
      {
        id: "ws1",
        name: "ws-one",
        path: "C:/ws1",
        stars: [
          { id: "add-a", name: "add-a", lifecycle: "created", setBy: "cosmos-new-change", at: 1, tasks: [1, 3], birthMs: 1 },
          { id: "add-b", name: "add-b", lifecycle: "reviewed", setBy: "cosmos-review", at: 2, tasks: [2, 3], birthMs: 2 },
          { id: "add-c", name: "add-c", lifecycle: "executed", setBy: "cosmos-apply-change", at: 3, tasks: [3, 3], birthMs: 3 }
        ],
        pending: [{ name: "proto-1", by: "cosmos-explore", at: 4 }],
        archives: 2,
        links: [[0, 1]],
        associations: [{ proposal: "add-a", sessionId: "p1", origin: "heuristic" }]
      }
    ]
  };
}

function sessionsFixture(satelliteState = "busy") {
  return {
    ids: ["p1", "c1", "sat1", "sat2", "sat3"],
    byId: {
      p1: { displayTitle: "父行星", running: false, updatedAt: 10 },
      c1: { displayTitle: "父彗星", running: false, updatedAt: 11 },
      sat1: { origin: "subagent", parentSessionId: "p1", displayTitle: "卫星1", running: satelliteState === "busy", updatedAt: 12 },
      sat2: { origin: "subagent", parentSessionId: "p1", displayTitle: "卫星2", updatedAt: 13 },
      sat3: { origin: "subagent", parentSessionId: "c1", displayTitle: "卫星3", updatedAt: 14 }
    }
  };
}

function workspacesFixture() {
  return { items: [{ workspaceId: "ws1", sessionIds: ["p1", "c1"] }], archivedSessionIds: [] };
}

const scene1 = mergeScene({ skeleton: skeletonFixture(), sessions: sessionsFixture(), workspaces: workspacesFixture(), now: 1000 });
assert.equal(scene1.workspaces[0].stars.length, 4, "夹具自检：3 恒星 + 1 星胚");
assert.equal(scene1.workspaces[0].planets[0].satellites.length, 2, "夹具自检：行星 2 直属卫星");
assert.equal(scene1.workspaces[0].planets[0].delegatedBusy, true, "夹具自检：父待机 + 卫星 busy → 委托忙碌");

/* ── 引擎装配与帧步进 ── */

const container = makeElement("div");
const engine = createCosmosEngine({ container, style: createSkinD() });

/** 手动步进一帧（dt ≈ 50ms）。 */
function step(ms) {
  const cb = rafQueue.shift();
  assert.ok(cb, "帧回调在队");
  cb(ms);
}

engine.setScene(scene1, "rebuild");
engine.start();
let now = 1000;
for (let i = 0; i < 24; i++) {
  now += 50;
  step(now);
}

/* 世界坐标查询（事件流星起点消费面） */
assert.ok(Array.isArray(engine.worldPosOf("planet", "p1")), "行星世界坐标");
assert.ok(Array.isArray(engine.worldPosOf("comet", "c1")), "彗星世界坐标");
assert.equal(engine.worldPosOf("planet", "missing"), null, "缺失天体 → null");

/* ── 生命周期转场 fx + patch（卫星数组替换 / lifecycle 迁移 / 委托忙碌翻转） ── */
engine.markFx("star", "proto-1", "ignite"); // 星胚点燃
engine.markFx("star", "add-b", "stamp"); // 落印
engine.markFx("planet", "p1", "view"); // 查看渐熄

const scene2 = mergeScene({
  skeleton: (() => {
    const s = skeletonFixture();
    s.workspaces[0].stars[1].lifecycle = "executed"; // reviewed → executed（无转场换色）
    return s;
  })(),
  sessions: sessionsFixture("idle"), // sat1 停止 → 卫星状态翻转 + delegatedBusy 消失
  workspaces: workspacesFixture(),
  now: 2000
});
engine.setScene(scene2, "patch");
for (let i = 0; i < 12; i++) {
  now += 50;
  step(now);
}

/* ── 事件流星 / 成星捕获 / Esc / toast（全公共面走一遍） ── */
engine.spawnEventMeteor([1, 2, 3]);
step(now + 50);
now += 50;
engine.markCapture("p1");
step(now + 50);
now += 50;
assert.equal(engine.consumeEscape(), false, "无钻取无选中 → Esc 不消费");
engine.toast("渲染冒烟 toast");
engine.getTuning();
engine.setTuning({ panSpeed: 200 });
assert.equal(engine.getTuning().panSpeed, 200, "tuning 热更");

/* ── hover 拾取扫掠（覆盖 pickAt → markHovers → updateOverlay → cardHtml 路径） ── */
const canvas = container._byClass ? null : null; // 引擎内部 canvas 经 ensureDom 桩产出
for (let gx = 280; gx <= 520; gx += 30) {
  for (let gy = 180; gy <= 420; gy += 30) {
    const canvasEl = findCanvas(container);
    if (canvasEl) {
      for (const fn of canvasEl.listeners["pointermove"] ?? []) fn({ clientX: gx, clientY: gy, buttons: 0, pointerId: 1 });
    }
    now += 16;
    step(now);
  }
}

/** 从容器桩树里找出引擎的 canvas（ensureDom appendChild(root) → .cos-canvas）。 */
function findCanvas(node) {
  if (node?.tag === "canvas" && typeof node.getContext === "function") return node;
  for (const child of node?.children ?? []) {
    const found = findCanvas(child);
    if (found) return found;
  }
  const byClass = node?._byClass;
  if (byClass) {
    for (const key of Object.keys(byClass)) {
      const found = findCanvas(byClass[key]);
      if (found) return found;
    }
  }
  return null;
}

/* ── 关联聚焦 / 活力状态行 / 决策按钮（cosmos-relation-focus + cosmos-session-decide / 7.1）：
   真实 merge 产物驱动——rel 段/环经 skin-d 绘制（无头 ctx 下不得抛错），信息卡内容断言。 ── */
{
  const root = container.children[0];
  const canvasEl = root._byClass["cos-canvas"];
  const cardEl = root._byClass["cos-card"];
  const fireEv = (el, type, ev) => { for (const fn of el.listeners[type] ?? []) fn(ev); };
  /** 世界坐标 → 屏幕点（与引擎 project 同式：默认 fov 60 / 视口 800×600 桩）。 */
  const screenOf = (world) => {
    const cam = engine.inspectFilter().camera;
    const W = 800, H = 600;
    let v = [world[0] - cam.target[0], world[1] - cam.target[1], world[2] - cam.target[2]];
    const cy = Math.cos(-cam.yaw), sy = Math.sin(-cam.yaw);
    v = [v[0] * cy + v[2] * sy, v[1], -v[0] * sy + v[2] * cy];
    const cx = Math.cos(-cam.pitch), sx = Math.sin(-cam.pitch);
    v = [v[0], v[1] * cx - v[2] * sx, v[1] * sx + v[2] * cx];
    const vz = v[2] + cam.dist;
    const f = (H * 1.1) / (2 * Math.tan(60 * Math.PI / 360));
    const s = f / vz;
    return { x: W / 2 + v[0] * s, y: H / 2 - v[1] * s };
  };
  const hoverWorld = (world) => {
    const p = screenOf(world);
    fireEv(root, "pointermove", { pointerId: 7, clientX: p.x, clientY: p.y, buttons: 0, target: canvasEl });
    for (let i = 0; i < 3; i++) { now += 50; step(now); }
  };
  const starWp = (id) => engine.inspectEntities("ws1").stars.find((s) => s.id === id).wp;

  /* ① 恒星聚焦：关系段/环进入渲染条目（skin-d rel 分支执行），卡面呈现活力行；
     星↔星提案虚线已解除（two-use-cosmos-template-star-layout）：relLast 无 links 面 */
  hoverWorld(starWp("add-a"));
  const relStar = engine.inspectRelation();
  assert.equal(relStar.focusKey, "ws1|star:add-a", "hover 恒星 → 聚焦源");
  assert.ok(relStar.last.segs.length >= 1, "恒星→行星关系段进入渲染条目");
  assert.ok(relStar.last.orbits.some((o) => o.planetId === "p1"), "关联行星轨道环 rel 标记");
  assert.equal(relStar.last.links, undefined, "星↔星提案虚线点亮解除（relLast 无 links 面，two）");
  const starHtml = String(cardEl.innerHTML);
  assert.ok(starHtml.includes("活力"), "恒星信息卡渲染活力状态行");
  assert.ok(/活跃|沉睡/.test(starHtml), "活力行取值为两态之一");

  /* ② 行星聚焦（idle）：关系段/自身环；非待决策 → 无决策按钮 */
  hoverWorld(engine.worldPosOf("planet", "p1"));
  for (let i = 0; i < 3; i++) { now += 50; step(now); } // 旧聚焦集渐熄
  const relPlanet = engine.inspectRelation();
  assert.equal(relPlanet.focusKey, "ws1|planet:p1", "聚焦源切换为行星");
  assert.equal(relPlanet.last.segs.length, 1, "单星行星 → 一条关系段");
  assert.deepEqual(relPlanet.last.orbits.map((o) => o.planetId), ["p1"], "自身轨道环 rel");
  const idleHtml = String(cardEl.innerHTML);
  assert.ok(idleHtml.includes("打开会话") && idleHtml.includes("归档会话"), "行星卡双按钮");
  assert.ok(!idleHtml.includes('data-action="decide"'), "非待决策行星无决策按钮");

  /* ③ 待决策行星（patch → waiting）：决策按钮进入渲染，顺序 打开 → 决策 → 归档 */
  const sceneWait = mergeScene({
    skeleton: skeletonFixture(),
    sessions: sessionsFixture("idle"),
    workspaces: workspacesFixture(),
    statuses: new Map([["p1", { running: false, pendingInteraction: { kind: "approval" } }]]),
    now: 3000
  });
  engine.setScene(sceneWait, "patch");
  for (let i = 0; i < 2; i++) { now += 50; step(now); }
  const waitHtml = String(cardEl.innerHTML);
  assert.ok(waitHtml.includes('data-action="decide"') && waitHtml.includes(">待批准<"), "待决策行星卡渲染决策按钮（待批准）");
  assert.ok(
    waitHtml.indexOf('data-action="open"') < waitHtml.indexOf('data-action="decide"') &&
    waitHtml.indexOf('data-action="decide"') < waitHtml.indexOf('data-action="archive"'),
    "按钮顺序 打开 → 决策 → 归档"
  );
}

/* ── 星座活力两态呈现回归（step1-add-constellation-vitality 2.2/3.1）：真实 merge 场景
   （恒星 + 星胚 + 会话）下 chip 呈活跃态与状态点、不呈沉睡态；钻取入口不被活力态阻断。
   沉睡 ⇄ 活跃 class 翻转与标牌标识由 engine-smoke 以假时钟确定性直测。 ── */
{
  const root = container.children[0];
  const overlay = root._byClass["cos-overlay"];
  const chip = overlay.children.find((el) => String(el.className).startsWith("cos-chip"));
  assert.ok(chip, "真实场景星座 chip 已挂载");
  assert.ok(String(chip.dataset.html).includes("cos-chip-life active"), "真实场景 chip 内容含活跃状态点（存在口径活跃）");
  assert.ok(!String(chip.className).includes("cos-chip-sleep"), "有恒星/会话的星座 chip 不呈沉睡态");
  assert.equal(engine.diveToWs("ws1"), true, "钻取真实星座（活力态不阻断入口）");
  now += 50;
  step(now);
  assert.equal(engine.inspectFilter().focus.diving, true, "钻取态成立");
}

engine.stop();
engine.dispose();
rafQueue.length = 0; // 清掉已停引擎的陈旧帧回调（新增块从确定帧序起步）

/* ── 钻取态可切换星座切换器几何回归（step2-add-constellation-switcher D1/D2/D6 / 2.3）：
   可切换星座 = 有提案或星胚（`stars` 非空）；几何级断言取代旧「逐位定位样式」口径——居中承诺由
   **结构恒成立**证明（两侧条目槽几何完全一致 ⇒ 任意 0/1/≥2 条目组合下标牌页面水平居中），
   容器预算/下限/断点/条目点击目标与显隐纪律逐条钉住；运行时以真实引擎路径验证条目挂载与退场。 ── */
{
  /* ① 结构契约：行容器承接定位与限宽（标牌旧绝对定位/百分比限宽 MUST 已移除）。 */
  const wsbarM = /\.cos-wsbar \{([^}]*)\}/.exec(ENGINE_CSS);
  const sideM = /\.cos-wsbar-side \{([^}]*flex: 0 1[^}]*)\}/.exec(ENGINE_CSS);
  const leftSideM = /\.cos-wsbar-side\[data-side="left"\] \{([^}]*)\}/.exec(ENGINE_CSS);
  const rightSideM = /\.cos-wsbar-side\[data-side="right"\] \{([^}]*)\}/.exec(ENGINE_CSS);
  const badgeM = /\.cos-badge \{([^}]*)\}/.exec(ENGINE_CSS);
  const itemM = /\.cos-wsbar-item \{([^}]*)\}/.exec(ENGINE_CSS);
  assert.ok(wsbarM && sideM && leftSideM && rightSideM && badgeM && itemM, "五组切换器样式规则在册");
  assert.ok(wsbarM[1].includes("left: 50%") && wsbarM[1].includes("transform: translateX(-50%)"), "行容器以 left:50% + translateX(-50%) 页面居中（顶部中央锚点）");
  assert.ok(/position: absolute; top: 14px/.test(wsbarM[1]), "行容器绝对定位 top:14px（既有标牌纵向锚点等价迁移）");
  assert.ok(wsbarM[1].includes("pointer-events: none"), "容器 pointer-events:none（不形成点击死区）");
  assert.ok(wsbarM[1].includes("display: flex") && wsbarM[1].includes("gap: 12px"), "行容器 flex 行 + 固定 12px 间隙");

  /* ② 居中恒成立：两侧槽几何完全一致（仅内对齐方向不同）——条目组合不参与槽宽决定。 */
  assert.ok(!/:has\(|nth-child|nth-of-type|:not\(:empty\)/.test(ENGINE_CSS), "槽宽不依赖条目数量选择器（条目数量不参与 flex 基准）");
  assert.equal(
    leftSideM[1].replace("flex-end", "").replace(/\s+/g, " ").trim(),
    rightSideM[1].replace("flex-start", "").replace(/\s+/g, " ").trim(),
    "左右条目槽规则除对齐方向外逐字一致（等基准/等宽/等收缩 → 标牌中心恒为容器中心）"
  );
  const sideFlexM = /flex: 0 1 var\(--cos-wsbar-side-w, (\d+)px\)/.exec(sideM[1]);
  const sideWidthM = /width: var\(--cos-wsbar-side-w, (\d+)px\)/.exec(sideM[1]);
  assert.ok(sideFlexM && sideWidthM && sideFlexM[1] === sideWidthM[1], "槽 flex 基准与宽度同值（对称固定宽）");
  assert.ok(sideM[1].includes("min-width: 0"), "槽 min-width:0（容器收窄时条目先行省略）");
  assert.equal(WS_SWITCH_FADE, 0.25, "淡入淡出时长常量 = 0.25s");
  assert.ok(itemM[1].includes("transition: opacity .25s"), "条目显隐走 .25s opacity 过渡（与常量同源）");
  assert.ok(/\.cos-wsbar-item\.on \{([^}]*)\}/.exec(ENGINE_CSS)[1].includes("opacity: 1"), ".on 态可见（淡入终态）");

  /* ③ 容器预算与 160px 下限兜底：844 = 标牌 480 + 2×(槽 170 + 间隙 12)；470 = 2×(面板 187 + 48)。 */
  const budgetM = /max-width: max\((\d+)px, min\((\d+)px, calc\(100% - (\d+)px\)\)\)/.exec(wsbarM[1]);
  assert.ok(budgetM, "容器限宽口径可解析（下限 / 上限 / 避让预留）");
  const floor = Number(budgetM[1]);
  const cap = Number(budgetM[2]);
  const reserve = Number(budgetM[3]);
  const sideW = Number(sideFlexM[1]);
  const gap = Number(/gap: (\d+)px/.exec(wsbarM[1])[1]);
  assert.equal(cap, 480 + 2 * (sideW + gap), "上限 = 标牌 480 + 2×(条目槽宽 + 间隙)（结构预算同源）");
  assert.equal(reserve, 470, "避让预留 = 470（187 面板 + 48 安全边距 ×2，既有口径不变）");
  assert.equal(floor, 160, "160px 下限兜底保留（页宽不足时标牌文本仍可读）");
  const containerWidth = (pageW) => Math.max(floor, Math.min(cap, pageW - reserve));
  assert.equal(containerWidth(480), floor, "页宽 480（侧栏在场退化档）：min() 为负 → 下限兜底，容器不塌为 0");
  assert.equal(containerWidth(2000), cap, "超宽页：容器封顶 844（标牌上限 480 不被百分比二次折减）");
  assert.ok(badgeM[1].includes("max-width: 480px") && !badgeM[1].includes("calc(100% - 470px)"),
    "标牌收敛为单一上限 480px（百分比限宽基准 MUST NOT 原样带入）");
  assert.ok(/\.cos-badge b \{[^}]*font-size: var\(--cos-ws-title-size, 13px\)/.test(ENGINE_CSS), "标牌名称视觉样式不变（字号令牌保留）");
  assert.ok(/\.cos-badge span \{[^}]*display: block/.test(ENGINE_CSS), "标牌计数行视觉样式不变");
  assert.ok(badgeM[1].includes("pointer-events: none"), "标牌仍 pointer-events:none（纯信息元素，不形成点击死区）");

  /* ④ 断点：<520px 改挂容器（放宽 + 隐藏条目槽），标牌旧媒体查询 MUST 已退役。 */
  assert.ok(ENGINE_CSS.includes("@media (max-width: 520px) { .cos-wsbar { max-width: calc(100% - 40px); } .cos-wsbar-side { display: none; } }"),
    "窄视口断点改挂行容器：放宽 calc(100% - 40px) + 隐藏条目槽（仅留标牌）");
  assert.ok(!ENGINE_CSS.includes("@media (max-width: 520px) { .cos-badge"), "标牌旧媒体查询已移除（断点不双写）");

  /* ⑤ 条目纪律：≥40px 触屏点击目标 / 暖金描边 HUD 语言 / 皮肤 CSS 变量取色 / 显隐两态指针语义。 */
  assert.ok(itemM[1].includes("min-height: 40px"), "条目点击目标高 ≥40px（触屏下限）");
  assert.ok(itemM[1].includes("border: 1px dashed rgb(var(--cos-accent-rgb, 255 210 140) / .4)"), "条目描边沿用暖金 HUD 语言（--cos-accent-rgb 令牌链）");
  assert.ok(itemM[1].includes("color: var(--cos-accent-ink, #ffe3b8)") && itemM[1].includes("var(--cos-chip-bg"), "条目文字/底色经皮肤 CSS 变量取色（皮肤零改动）");
  assert.ok(itemM[1].includes("pointer-events: none") && /\.cos-wsbar-item\.on \{[^}]*pointer-events: auto/.test(ENGINE_CSS),
    "条目默认不可点、.on 时可点（容器不形成点击死区）");
  assert.ok(/\.cos-wsbar-item i \{[^}]*var\(--dsw-alias-state-warn-primary/.test(ENGINE_CSS), "活跃状态点取活力琥珀令牌链（与 chip/名牌同源）");

  /* ⑥ 运行时：三个可切换星座钻取 → 左右条目挂载；银河态零呈现；退场清内容。 */
  const realPerformance = globalThis.performance;
  let fakeNow = realPerformance.now() + 60000; // 假时钟推进钻取补间（只影响镜头补间时刻口径）
  globalThis.performance = { now: () => fakeNow };
  const container = makeElement("div");
  const switcher = createCosmosEngine({ container, style: createSkinD() });
  try {
    const root = container.children[0];
    /* 桩的 querySelector 键 = 选择器去掉首个 "."（render-smoke 桩约定）。 */
    const leftSlot = root._byClass['cos-wsbar-side[data-side="left"]'];
    const rightSlot = root._byClass['cos-wsbar-side[data-side="right"]'];
    const badgeEl = root._byClass["cos-badge"];
    assert.ok(leftSlot && rightSlot, "左右条目槽 DOM 在册（引擎自建）");
    const leftItem = leftSlot.children[0];
    const rightItem = rightSlot.children[0];
    assert.equal(leftSlot.children.length, 1, "左槽常驻一个条目节点（MUST NOT 逐帧重建）");
    assert.equal(rightSlot.children.length, 1, "右槽常驻一个条目节点");
    const markup = String(root.innerHTML);
    assert.ok(markup.includes("cos-wsbar") && markup.includes('data-side="left"') && markup.includes('data-side="right"'),
      "ensureDom 产物含行容器与左右条目槽");
    const order = ['data-side="left"', "cos-badge", 'data-side="right"'].map((token) => markup.indexOf(token));
    assert.ok(order[0] >= 0 && order[0] < order[1] && order[1] < order[2], "DOM 顺序 [左槽][标牌][右槽]");
    const starOf = (id) => ({ id, name: id, lifecycle: "created", setBy: null, at: null, tasks: [1, 1], age: "刚刚", act: 0, off: [0, 0, 0] });
    const wsOf = (id, name, pos) => ({ id, name, pos, stars: [starOf(id + "-s")], links: [], planets: [], comets: [], archives: 0, satelliteCount: 0 });
    switcher.setScene({
      workspaces: [wsOf("a", "Alpha", [-200, 0, 0]), wsOf("b", "Bravo", [0, 0, 0]), wsOf("c", "Charlie", [200, 0, 0])]
    }, "rebuild");
    switcher.start();
    let frameTs = now;
    const frameStep = (n = 1) => { for (let i = 0; i < n; i++) { frameTs += 50; step(frameTs); } };
    frameStep(30);
    assert.ok(!leftItem.classList.contains("on") && !rightItem.classList.contains("on"), "银河态条目零呈现（零布局）");
    assert.equal(String(leftItem.innerHTML), "", "银河态左槽零内容");
    assert.equal(switcher.diveToWs("b"), true, "钻取中位星座 Bravo");
    fakeNow += 1400; // 钻取补间落地（focusMix → 1）
    frameStep(3);
    assert.equal(switcher.inspectFilter().focus.diving, true, "钻取态成立");
    assert.ok(String(badgeEl.dataset.html).includes("Bravo"), "标牌仍呈当前星座（中央格内容不变）");
    assert.ok(leftItem.classList.contains("on") && String(leftItem.innerHTML).includes("Alpha"), "左槽 = 环上前驱 Alpha");
    assert.ok(rightItem.classList.contains("on") && String(rightItem.innerHTML).includes("Charlie"), "右槽 = 环上后继 Charlie");
    assert.equal(switcher.consumeEscape(), true, "Esc 飞回银河");
    fakeNow += 1400;
    frameStep(3);
    assert.ok(!leftItem.classList.contains("on") && !rightItem.classList.contains("on"), "飞回银河：条目退场（随钻取态整体）");
    frameStep(6);
    assert.equal(String(leftItem.innerHTML), "", "退场淡出满窗后条目零内容");
  } finally {
    switcher.stop();
    switcher.dispose();
    globalThis.performance = realPerformance;
  }
}

/* ── 场景未就绪启动（真机「Cannot read 'ws' of null」回归）：无 scene 时 start
   → 帧循环跳帧等待 → 场景到达后正常渲染。 ── */
{
  const container2 = makeElement("div");
  const engine2 = createCosmosEngine({ container: container2, style: createSkinD() });
  engine2.start();
  for (let i = 0; i < 6; i++) {
    now += 16;
    step(now); // E.scene 为 null → 跳帧，SHALL NOT 抛错
  }
  engine2.setScene(scene1, "rebuild"); // 场景迟到到达
  for (let i = 0; i < 6; i++) {
    now += 16;
    step(now); // 场景就绪 → 正常渲染路径
  }
  engine2.stop();
  engine2.dispose();
}

/* ── 整页「新增」入口形态（add-cosmos-add-workspace 4.4/5.1；polish-cosmos-touch-nav 5.1/6.2
      方形 icon-only）：React 与 react-dom 是 bundle external（由宿主 client-modules 引导基线
      提供），Node 冒烟无法挂载整页组件树——此处以源码锚点 + CSS/文案键守卫按钮形态；
      实际 DOM 呈现由真机验收（9.1）。 ── */
{
  const source = readFileSync(new URL("../src/client.jsx", import.meta.url), "utf8");
  assert.ok(source.includes('className="cos-add-btn"'), "整页左下角「新增」按钮 JSX 存在");
  assert.ok(source.includes('data-plugin-anchor="dsh-v-cosmos:add"'), "按钮插件锚点（DOM 断言入口）");
  assert.ok(source.includes(".cos-add-btn{position:absolute;left:16px;bottom:16px"), "按钮常驻左下角（absolute 16px）");
  assert.ok(source.includes("width:var(--cos-add-btn-size, 44px);height:var(--cos-add-btn-size, 44px);padding:0"), "按钮方形 icon-only（边长经 --cos-add-btn-size 令牌，缺省 44）");
  assert.ok(source.includes("justify-content:center"), "方形按钮内容居中（icon-only 定心）");
  assert.ok(!source.includes("cos-add-label"), "文字标签 span 已移除（只留 ＋ 图标）");
  assert.ok(source.includes('className="cos-add-plus"'), "`＋` 图标保留（icon-only 主体）");
  assert.ok(source.includes("z-index:45"), "按钮 z 序在引擎覆盖层/搜索带之上");
  assert.ok(source.includes('"cosmos.add": "新增"') && source.includes('"cosmos.add": "Add"'), "DICT 中英文案（新增 / Add，aria-label/title 语义保留）");
  assert.ok(source.includes("disabled={adding}"), "busy 态禁用（流程进行中防重入）");
  assert.ok(source.includes('aria-busy={adding || undefined}'), "busy 态 aria-busy 保留");
  assert.ok(source.includes("engine.diveToWs?.(targetWsId)"), "注册成功后引擎 dive-in 消费点（D4）");
  assert.ok(source.includes("engine.markWsBirth?.(ws.id)"), "空星座出生高亮接线（D6）");
  /* 成星捕获 from 采集（polish-cosmos-orbit-insertion 3.1）：快照时序与回归同款 */
  assert.ok(source.includes('engine.worldPosOf?.("comet", info.id)'), "捕获 from 采集：worldPosOf 查旧彗星体");
  assert.ok(source.includes("engine.markCapture(info.id, from, { wsId: info.wsId })"), "捕获标记携带 from + wsId（P2 错峰归组）");
  assert.ok(
    source.indexOf("engine.markCapture(info.id, from") < source.indexOf("engine.setScene(next,"),
    "markCapture 先于 setScene（旧彗星体在册才采得到切向/尾迹）"
  );
  /* HUD 精简（2.2）：右上操作提示的覆盖样式已随引擎侧提示行一并删除 */
  assert.ok(!source.includes(".cos-hint"), "client.jsx 无 `.cos-hint` 覆盖样式");
}

/* ── 渲染循环启停只听页签可见性（fix-cosmos-blur-pause 2.1 / spec「渲染节能」失焦续播）：
   effect 级监听只留 document.visibilitychange；**任何** window blur/focus 监听 MUST NOT 驱动
   渲染启停（挂回即回到「切走程序 → 星图定格」的旧行为）。元素级 `.blur()`（Esc 失焦层）、
   CSS `:focus-visible`、搜索框的 React onBlur/onFocus 回调，以及引擎侧 clearKeys（engine.mjs
   键盘纪律，不在本断言文件的源码范围）均不构成误报——这里只钉 window 级监听与 setVisible
   触发源。
   **唯一豁免（fix-cosmos-const-float-voice 1.3 / spec「关窗释放麦克风」）**：星座浮窗录音中
   窗口失焦须释放麦克风（handler = `halt`，只停在册 recorder / 音轨，零 controller/engine 触碰）。
   豁免以「window blur/focus 监听集合恰为 {halt}（add/remove 成对）+ halt 体内零 setVisible /
   engine 调用」钉住——其余任何 window blur/focus 监听仍属回归。 ── */
{
  const source = readFileSync(new URL("../src/client.jsx", import.meta.url), "utf8");
  const focusHooks = (source.match(/window\.(?:add|remove)EventListener\(\s*["'](?:blur|focus)["']\s*,\s*([A-Za-z_$][\w$]*)/g) ?? [])
    .map((line) => line.replace(/^.*,\s*/, ""));
  assert.deepEqual(
    focusHooks,
    ["halt", "halt"],
    "window blur/focus 监听集合恰为 {halt}（add/remove 成对，仅服务录音释放）"
  );
  const haltBody = source.slice(source.indexOf("const halt = () =>"), source.indexOf('window.addEventListener("blur", halt)'));
  assert.ok(haltBody.includes("releaseVoice()"), "失焦处理器只释放采集资源（releaseVoice）");
  assert.ok(!haltBody.includes("setVisible") && !haltBody.includes("engine."), "失焦处理器 MUST NOT 触碰渲染启停（失焦续播）");
  assert.ok(!source.includes('const onBlur = () => controllerRef.current?.setVisible(false);'), "无「失焦 → setVisible(false)」处理器定义");
  assert.ok(!source.includes('const onFocus = () => controllerRef.current?.setVisible(true);'), "无「回焦 → setVisible(true)」处理器定义");
  assert.ok(source.includes('const sync = () => controllerRef.current?.setVisible(!document.hidden && dockVisible);'), "可见性处理器 = 唯一 setVisible 触发源（document.hidden 取反 × dock tab 可见性）");
  assert.ok(source.includes('document.addEventListener("visibilitychange", sync);'), "visibilitychange 监听在位");
  assert.ok(source.includes('document.removeEventListener("visibilitychange", sync);'), "visibilitychange 清理成对移除（无泄漏）");
  assert.equal((source.match(/controllerRef\.current\?\.setVisible\(/g) ?? []).length, 1, "页面层 setVisible 调用点恰好一处（防焦点分支复归）");
  assert.ok(!source.includes("setVisible(false)") && !source.includes("setVisible(true)"), "无字面量 true/false 的 setVisible 调用（启停恒由可见性裁决）");
  assert.ok(source.includes("窗口失焦不暂停"), "effect 注释钉住「窗口失焦不暂停」依据（spec「渲染节能」，防实现复归）");
  /* 零改动面（1.2）：暂停触发集仍恰为「整页开合 × 页签可见性」两条——控制器裁决式未随删监听而变形。 */
  assert.equal((source.match(/if \(open && visible\) engine\.start\(\);/g) ?? []).length, 2, "attach / setOpen 两处裁决式原样（open && visible）");
  assert.ok(source.includes("if (visible && open) engine.start();"), "setVisible 恢复侧裁决式原样（visible && open）");
  assert.equal((source.match(/else engine\.stop\(\);/g) ?? []).length, 2, "停侧恰好两处（整页关闭 / 页签不可见）");
}

console.log("render-smoke: all assertions passed");
