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
import { createCosmosEngine } from "../src/cosmos/engine.mjs";
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

  /* ① 恒星聚焦：关系段/环/共享会话段进入渲染条目（skin-d rel 分支执行），卡面呈现活力行 */
  hoverWorld(starWp("add-a"));
  const relStar = engine.inspectRelation();
  assert.equal(relStar.focusKey, "ws1|star:add-a", "hover 恒星 → 聚焦源");
  assert.ok(relStar.last.segs.length >= 1, "恒星→行星关系段进入渲染条目");
  assert.ok(relStar.last.orbits.some((o) => o.planetId === "p1"), "关联行星轨道环 rel 标记");
  assert.ok(relStar.last.links.some((l) => l.aId === "add-a" && l.bId === "add-b"), "共享会话虚线点亮");
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

engine.stop();
engine.dispose();

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
  assert.ok(source.includes("width:44px;height:44px;padding:0"), "按钮方形 44×44 icon-only（触屏目标 ≥40px）");
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

console.log("render-smoke: all assertions passed");
