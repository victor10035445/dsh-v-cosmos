/**
 * 引擎与皮肤模块冒烟（add-cosmos-entry 4.3/4.4）：模块可导入（import 时零 DOM 副作用）、
 * 皮肤接口形状（palette + background + drawBody，R5 引擎无关）、引擎公共面。
 * 运行：node test/engine-smoke.mjs
 */
import assert from "node:assert/strict";
import { createCosmosEngine, ENGINE_CSS, panCameraTarget, PAN_SPEED, PAN_SHIFT_BOOST, makeNova, stepNovae, buildScenePure, FX_PRIORITY, FX_NOVA_DUR, FX_NOVA_PROTO_DUR, BOOT_DUR, isEditableTarget, boundingSphereOf, fitCameraOf, FILTER_RAMP_DUR, FILTER_SHIFT_DUR, FILTER_FIT_DUR, FILTER_FIT_MARGIN, WS_SHIFT_DUR, WS_BIRTH_HL_DUR, GESTURE_SUPPRESS_MS } from "../src/cosmos/engine.mjs";
import { createSkinD, SKIN_D_PALETTE } from "../src/cosmos/skin-d.mjs";
import { COSMOS_SETTINGS_DEFAULTS, COSMOS_SETTINGS_BOUNDS, sanitizeCosmosSettings, loadCosmosSettings } from "../src/settings.mjs";

/* import 时不允许触碰 document/window（引擎/皮肤均为挂载期才用 DOM）。 */
assert.equal(typeof createCosmosEngine, "function", "engine 工厂导出");
assert.equal(typeof createSkinD, "function", "skin 工厂导出");
assert.ok(ENGINE_CSS.includes(".cos-root"), "ENGINE_CSS 随模块导出（含根容器样式）");
assert.ok(ENGINE_CSS.includes("repeating-linear-gradient"), "扫描线参数保留（风格 D 语言）");

/* 皮肤接口（palette + drawBody 保持引擎无关，design.md R5）。 */
const skin = createSkinD();
assert.equal(skin.skin, "d");
assert.equal(skin.useBand, true);
/* 生命周期四态（add-celestial-states 4.1：三态 draft/in-progress/complete 键退役）。 */
assert.deepEqual(skin.palette.prop, { proto: "#8a9bc0", created: "#9fd8ff", reviewed: "#cfe8ff", executed: "#ffe27a" });
assert.deepEqual(SKIN_D_PALETTE.prop, skin.palette.prop, "导出面与实例同源");
assert.deepEqual(SKIN_D_PALETTE.sess, { idle: "#a8b8d8", busy: "#54c8ff", waiting: "#ffaa4a", "done-unread": "#5affc0", free: "#cfeaff" });
assert.equal(typeof skin.background, "function");
assert.equal(typeof skin.drawBody, "function");
assert.equal(skin.bgStarColor(0.95), "#ffe9cf", "bgStarColor 分段（暖白高星）");
assert.deepEqual(skin.dustColors, ["#5a6ea0", "#7a6ea0"], "星云尘埃双色");

/* 去全局化：引擎工厂在无 container 时应快速失败而不是悄悄产出（构造期 DOM 必需）。 */
assert.throws(() => createCosmosEngine({ container: null, style: skin }), /Cannot read|TypeError|null/, "无容器 → 显式失败");

/* ── WASD 相机平移纯函数（真机追加功能） ── */
function camAt(yaw, pitch, dist) {
  return { target: [0, 0, 0], yaw, pitch, dist };
}
const near = (v, w, eps = 1e-9) => Math.abs(v - w) < eps;

/* 零键位 → 不动、无位移返回值 */
{
  const cam = camAt(-0.7, 0.5, 430);
  assert.equal(panCameraTarget(cam, new Set(), 0.016), false);
  assert.deepEqual(cam.target, [0, 0, 0]);
  assert.equal(panCameraTarget(cam, new Set(["w"]), 0), false, "dt=0 不积分");
}

/* yaw=0 / pitch=0：W = 世界 +Y，A/D = 世界 ±X（固定速度 120/s，与缩放无关） */
{
  const cam = camAt(0, 0, 100);
  panCameraTarget(cam, new Set(["w"]), 1);
  assert.ok(near(cam.target[1], 120), "yaw0/pitch0: W → +Y（固定 120/s）");
  const cam2 = camAt(0, 0, 100);
  panCameraTarget(cam2, new Set(["d"]), 1);
  assert.ok(near(cam2.target[0], 120) && near(cam2.target[2], 0), "D → +X");
  const cam3 = camAt(0, 0, 100);
  panCameraTarget(cam3, new Set(["a"]), 1);
  assert.ok(near(cam3.target[0], -120), "A → -X");
}

/* 缩放无关性（真机反馈）：同一按键/时长在不同 dist 下位移完全一致 */
{
  const nearCam = camAt(-0.7, 0.5, 24);
  const farCam = camAt(-0.7, 0.5, 4200);
  panCameraTarget(nearCam, new Set(["w"]), 0.5);
  panCameraTarget(farCam, new Set(["w"]), 0.5);
  assert.ok(near(nearCam.target[1], farCam.target[1], 1e-9), "dist 24 vs 4200 → 位移一致");
}

/* Shift 加速档：×PAN_SHIFT_BOOST */
{
  const cam = camAt(0, 0, 100);
  panCameraTarget(cam, new Set(["w", "shift"]), 1);
  assert.ok(near(cam.target[1], 360), "Shift → ×3（360/s）");
}

/* ── 平移调参可配置化（settings.mjs 面板） ── */
{
  /* tuning 注入：自定义速度/倍率覆盖出厂常量 */
  const cam = camAt(0, 0, 100);
  panCameraTarget(cam, new Set(["w"]), 1, { speed: 250, boost: 2 });
  assert.ok(near(cam.target[1], 250), "tuning.speed=250 → 250/s");
  const camShift = camAt(0, 0, 100);
  panCameraTarget(camShift, new Set(["w", "shift"]), 1, { speed: 250, boost: 2 });
  assert.ok(near(camShift.target[1], 500), "tuning boost=2 → 500/s");
  /* 非法 tuning 回落出厂常量 */
  const camFallback = camAt(0, 0, 100);
  panCameraTarget(camFallback, new Set(["w"]), 1, { speed: 0, boost: -1 });
  assert.ok(near(camFallback.target[1], PAN_SPEED), "非法 tuning → 出厂 PAN_SPEED");

  /* 设置净房：缺省合并、越界落界内端点、未知键剥离 */
  assert.deepEqual(COSMOS_SETTINGS_DEFAULTS, { panSpeed: 120, panShiftBoost: 3 }, "出厂默认（当前暂用值）");
  assert.deepEqual(sanitizeCosmosSettings({}), COSMOS_SETTINGS_DEFAULTS, "空配置 → 默认");
  assert.deepEqual(
    sanitizeCosmosSettings({ panSpeed: 999, panShiftBoost: 0, hacker: 1 }),
    { panSpeed: COSMOS_SETTINGS_BOUNDS.panSpeed[1], panShiftBoost: COSMOS_SETTINGS_BOUNDS.panShiftBoost[0] },
    "越界落端点 + 未知键剥离"
  );
  assert.deepEqual(sanitizeCosmosSettings({ panSpeed: "not-a-number" }), { panSpeed: 120, panShiftBoost: 3 }, "非法值 → 默认");
  /* Node 无 localStorage → 读面回落默认（持久化读写守卫路径） */
  assert.deepEqual(loadCosmosSettings(), COSMOS_SETTINGS_DEFAULTS, "无存储面 → 默认");
}

/* 方向随 yaw 旋转：yaw=π/2 时 D 沿世界 -X（视图右向量 = [cos yaw, 0, -sin yaw]） */
{
  const cam = camAt(Math.PI / 2, 0, 100);
  panCameraTarget(cam, new Set(["d"]), 1);
  assert.ok(near(cam.target[0], 0, 1e-6) && near(cam.target[2], -120), "yaw=π/2: D → -Z");
}

/* 方向随 pitch 抬升：pitch>0 时 W 带 +Z 分量（屏面上向量 = [sinP·sinY, cosP, sinP·cosY]） */
{
  const cam = camAt(0, Math.PI / 6, 100);
  panCameraTarget(cam, new Set(["w"]), 1);
  assert.ok(cam.target[1] > 0 && cam.target[2] > 0, "pitch=30°: W → +Y+Z（俯视抬起）");
  assert.ok(near(Math.hypot(cam.target[1], cam.target[2]), 120, 1e-6), "模长 = 固定速度×dt");
}

/* 组合键 WASD 同时按住 → 相互抵消：零位移返回 false（不打断 dive 补间） */
{
  const cam = camAt(-0.7, 0.5, 430);
  assert.equal(panCameraTarget(cam, new Set(["w", "s", "a", "d"]), 1), false, "净位移为零 → 非手动位移");
  assert.deepEqual(cam.target, [0, 0, 0], "四键全按 → 零位移");
}

/* ── nova 幽灵列表（add-comet-states-and-star-death 1.3）：纯函数面推进/过期/清空 ── */
{
  const nova = makeNova("add-a", [1, 2, 3], "#ffe27a", { driftTo: [0, 0, 0] }, 10);
  assert.equal(nova.dur, FX_NOVA_DUR, "常规 nova = 2.4s 三段式");
  assert.deepEqual(nova.p0, [1, 2, 3], "p0 原位快照");
  assert.deepEqual(nova.driftTo, [0, 0, 0], "driftTo 快照点定格");
  assert.equal(nova.color, "#ffe27a", "临终生命周期色");
  assert.equal(nova.t0, 10, "标记时刻 = 引擎 E.t");
  const p0Copy = [1, 2, 3];
  makeNova("x", p0Copy, "#fff", { driftTo: p0Copy }, 0);
  p0Copy[0] = 99;
  assert.equal(makeNova("y", p0Copy, "#fff", null, 0).p0[0], 99, "入参切片（防御外部变异）");

  const proto = makeNova("proto-1", [0, 0, 0], "#8a9bc0", { intensity: 0.3 }, 5);
  assert.equal(proto.intensity, 0.3, "强度参数透传");
  assert.equal(proto.dur, FX_NOVA_PROTO_DUR, "星胚变体 = 0.8s 消散（同一列表同一参数路径）");

  /* stepNovae：k 随 t 推进 + 过期即摘 + 清空 */
  const list = [makeNova("a", [0, 0, 0], "#fff", null, 0), makeNova("b", [0, 0, 0], "#fff", { intensity: 0.3 }, 0)];
  const mid = stepNovae(list, 0.5);
  assert.equal(mid.length, 2, "0.5s：两枚均在窗口内 → 保留");
  assert.ok(mid[0].k > 0 && mid[0].k < 1, "常规 nova k 推进中（<1）");
  assert.ok(mid[1].k > 0 && mid[1].k < 1, "星胚变体 k 推进中");
  const atProtoEnd = stepNovae(list, 0.81);
  assert.equal(atProtoEnd.length, 1, "0.81s：星胚 0.8s 过期即摘，常规仍在");
  assert.equal(atProtoEnd[0].id, "a", "摘除的是过期条目");
  assert.deepEqual(stepNovae(list, 2.5), [], "2.5s：全部过期 → 列表清空");
  assert.deepEqual(stepNovae(null, 1), [], "非数组防御");
}

/* ── 引擎实例行为（DOM 桩，render-smoke 同款桩形紧凑版）：
      nova 全路径绘制 / 回归补间与摘除 / captures 对称性 / prune / dispose ── */
function stubCtx2d() {
  const grad = { addColorStop() {} };
  const store = {};
  return new Proxy(store, {
    get(target, prop) {
      if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => grad;
      if (!(prop in target)) target[prop] = () => undefined;
      return target[prop];
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    }
  });
}
function stubEl(tag) {
  const el = {
    tag, style: {}, dataset: {}, className: "", innerHTML: "", textContent: "", width: 0, height: 0,
    children: [], listeners: {}, attrs: {}, _by: {},
    classList: { add() {}, remove() {}, contains: () => false },
    appendChild(child) { el.children.push(child); return child; },
    remove() {},
    querySelector(sel) {
      if (!el._by[sel]) {
        const child = stubEl(sel === ".cos-canvas" ? "canvas" : "div");
        if (child.tag === "canvas") child.getContext = () => stubCtx2d();
        el._by[sel] = child;
      }
      return el._by[sel];
    },
    addEventListener(type, fn) { (el.listeners[type] = el.listeners[type] || []).push(fn); },
    removeEventListener() {},
    setAttribute(k, v) { el.attrs[k] = v; },
    getAttribute(k) { return k in el.attrs ? el.attrs[k] : null; },
    setPointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 })
  };
  return el;
}
/* window 监听面记录（add-cosmos-search-filter 2.8：WASD 守卫需要真实派发 keydown）。 */
const windowListeners = { keydown: [], keyup: [], blur: [], resize: [] };
globalThis.window = {
  devicePixelRatio: 1,
  addEventListener(type, fn) { (windowListeners[type] = windowListeners[type] || []).push(fn); },
  removeEventListener() {}
};
/* document.createElement 产物记录（2.7 钻取互斥：经引擎自建 chip 的 click 进入钻取）。 */
const createdEls = [];
globalThis.document = {
  createElement: (t) => {
    const el = stubEl(t);
    if (t === "canvas") el.getContext = () => stubCtx2d(); // 皮肤 glowSprite 直建 canvas
    createdEls.push(el);
    return el;
  },
  addEventListener() {},
  removeEventListener() {},
  hidden: false,
  activeElement: null,
  head: { appendChild() {} }
};
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
const rafQ = [];
globalThis.requestAnimationFrame = (cb) => { rafQ.push(cb); return rafQ.length; };
globalThis.cancelAnimationFrame = () => {};
/* 相机补间时基（tweenTo/stepTween 用 performance.now）→ 可控假时钟：
   过滤 camera-fit 的「重定向续接 / 收尾补 fit」可确定性推进（2.7）。 */
let fakeNow = 0;
globalThis.performance = { now: () => fakeNow };
function stepFrame(ms) {
  const cb = rafQ.shift();
  assert.ok(cb, "帧回调在队");
  cb(ms);
}

/** 最小场景夹具：1 恒星 + 1 行星 + 1 彗星（回归/捕获/nova 直测用）。 */
function miniScene(withCelestials = true) {
  return {
    workspaces: [{
      id: "ws1", name: "ws-one", pos: [0, 0, 0],
      stars: [{ id: "add-a", name: "add-a", lifecycle: "executed", setBy: null, at: null, tasks: [1, 1], age: "刚刚", act: 0, off: [10, 0, 0] }],
      links: [],
      planets: withCelestials
        ? [{ id: "p1", title: "planet", state: "idle", pendingKind: null, stars: ["add-a"], todos: "—", when: "刚刚", satellites: [], satelliteCount: 0, delegatedBusy: false }]
        : [],
      comets: withCelestials
        ? [{ id: "c1", title: "comet", state: "idle", pendingKind: null, when: "刚刚", satellites: [], satelliteCount: 0, delegatedBusy: false }]
        : [],
      archives: 0, satelliteCount: 0
    }]
  };
}
const dist3 = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

/* 引擎实例：nova 推进/过期/清空 + 星胚强度变体路径（皮肤 nova 分支全绘制执行）。
   冷启动序曲（6.1）：boot 窗口内标记 → 转入队延迟（fire = 序曲结束，无事件丢失）。 */
{
  const container = stubEl("div");
  const eng = createCosmosEngine({ container, style: createSkinD() });
  eng.setScene(miniScene(), "rebuild");
  eng.start();
  eng.markStarNova("add-a", [10, 0, 0], "#ffe27a", { driftTo: [0, 0, 0] });
  eng.markStarNova("proto-x", [20, 0, 0], "#8a9bc0", { intensity: 0.3 });
  assert.equal(eng.inspectFxQueue().pending, 2, "冷启动序曲窗口：nova 转 enqueue 延迟（无事件丢失）");
  assert.equal(eng.inspectGhosts().novae, 0, "序曲期间事件转场未启动");
  let tNow = 1000;
  for (let i = 0; i < 27; i++) { tNow += 50; stepFrame(tNow); } // ≈1.32s > boot 1.2s → 序曲结束（首帧 dt=0.016 守卫）
  assert.equal(eng.inspectGhosts().novae, 2, "序曲结束：延迟 nova 启动（两枚在册）");
  for (let i = 0; i < 18; i++) { tNow += 50; stepFrame(tNow); } // 星胚变体 0.8s 过期（+0.9s 余量）
  assert.equal(eng.inspectGhosts().novae, 1, "星胚 0.8s 已过期摘除，常规仍在播放");
  for (let i = 0; i < 34; i++) { tNow += 50; stepFrame(tNow); } // 常规 2.4s 播完（+1.7s 余量）
  assert.equal(eng.inspectGhosts().novae, 0, "常规 nova 播完过期 → 清空");
  eng.stop();
  eng.dispose();
}

/* 引擎实例：回归补间推进/摘除 + 与 captures 的对称性 */
{
  const container = stubEl("div");
  const eng = createCosmosEngine({ container, style: createSkinD() });
  eng.setScene(miniScene(), "rebuild");
  eng.start();
  let tNow = 2000;
  for (let i = 0; i < 27; i++) { tNow += 50; stepFrame(tNow); } // 过冷启动序曲（≈1.4s）
  const from = eng.worldPosOf("comet", "c1").slice(); // 行星最后轨道位置（回归起点）
  eng.markRegression("c1", from);
  for (let i = 0; i < 3; i++) { tNow += 50; stepFrame(tNow); } // 首帧出队启动 + ≈0.1s 补间
  const early = eng.worldPosOf("comet", "c1");
  assert.ok(dist3(early, from) < 8, "回归起步贴近行星轨道位置（easeOutCubic 小 k 补间）");
  assert.equal(eng.inspectGhosts().regressions.length, 1, "回归补间在册");
  for (let i = 0; i < 30; i++) { tNow += 50; stepFrame(tNow); } // > 1.4s
  assert.deepEqual(eng.inspectGhosts().regressions, [], "k≥1 摘除：回归补间退出 Map");
  const late = eng.worldPosOf("comet", "c1");
  assert.ok(dist3(late, from) > dist3(early, from), "彗星滑出至游荡路径");

  /* captures 对称性：螺旋坠入外圈 → 1.4s 后回常规轨道 + Map 摘除 */
  eng.markCapture("p1");
  for (let i = 0; i < 3; i++) { tNow += 50; stepFrame(tNow); }
  const planetCenter = [10, 0, 0]; // 恒星 off = [10,0,0] → 单星行星轨道中心
  const outer = eng.worldPosOf("planet", "p1");
  assert.ok(dist3(outer, planetCenter) > 40, "捕获初期：半径倍率 ~3.5 外圈螺旋");
  for (let i = 0; i < 30; i++) { tNow += 50; stepFrame(tNow); } // > 1.4s
  assert.deepEqual(eng.inspectGhosts().captures, [], "captures 摘除（与 regressions 对称）");
  const settled = eng.worldPosOf("planet", "p1");
  assert.ok(dist3(settled, planetCenter) > 13 && dist3(settled, planetCenter) < 19, "捕获收尾：回常规轨道 r≈16");
  eng.stop();
  eng.dispose();
}

/* 引擎实例：rebuild prune（regressions/captures 中已不存在的 id 同点清理）+ dispose 清空 */
{
  const container = stubEl("div");
  const eng = createCosmosEngine({ container, style: createSkinD() });
  eng.setScene(miniScene(), "rebuild");
  eng.start();
  let tNow = 3000;
  for (let i = 0; i < 27; i++) { tNow += 50; stepFrame(tNow); } // 过冷启动序曲
  eng.markRegression("c1", [50, 0, 0]);
  eng.markCapture("p1");
  stepFrame(tNow += 50); // 回归队列项出队（P2 经调度器启动）
  eng.setScene(miniScene(false), "rebuild"); // 行星/彗星全部移除
  const ghosts = eng.inspectGhosts();
  assert.deepEqual(ghosts.regressions, [], "rebuild prune：回归 Map 摘除已不存在的彗星 id");
  assert.deepEqual(ghosts.captures, [], "rebuild prune：captures 对称清理（防长驻 Map 泄漏）");
  eng.dispose();
  const afterDispose = eng.inspectGhosts();
  assert.deepEqual(
    afterDispose,
    { novae: 0, degradedNovae: 0, regressions: [], captures: [], wsGhosts: 0 },
    "dispose 清空幽灵列表/降级计数/补间 Map/消散幽灵"
  );
  eng.markStarNova("late", [0, 0, 0], "#ffffff", null); // dispose 后标记 → no-op（不跨引擎实例）
  assert.equal(eng.inspectGhosts().novae, 0, "dispose 后 markStarNova 不入册");
}

/* ── Phase 0 确定性渲染地基（1.3）：buildScenePure 纯函数断言 ── */
{
  function choreoWs(id, opts = {}) {
    return {
      id, name: id, pos: opts.pos ?? [0, 0, 0],
      stars: (opts.stars ?? [
        { id: id + "-s1", name: id + "-s1", lifecycle: "created", setBy: null, at: null, tasks: [1, 1], age: "刚刚", act: 0, off: [8, 0, 0] },
        { id: id + "-s2", name: id + "-s2", lifecycle: "reviewed", setBy: null, at: null, tasks: [1, 1], age: "刚刚", act: 0, off: [-8, 0, 0] }
      ]).slice(),
      links: opts.links ?? [[0, 1]],
      planets: opts.planets ?? [{ id: id + "-p1", title: "p", state: "idle", pendingKind: null, stars: [id + "-s1"], todos: "—", when: "刚刚", satellites: [], satelliteCount: 0, delegatedBusy: false }],
      comets: opts.comets ?? [{ id: id + "-c1", title: "c", state: "idle", pendingKind: null, when: "刚刚", satellites: [], satelliteCount: 0, delegatedBusy: false }],
      archives: opts.archives ?? 2,
      satelliteCount: 0
    };
  }
  const sceneOf = (wsB) => ({ workspaces: [choreoWs("wsA"), wsB] });
  const emptyMap = new Map();

  /* 同数据同画面：两次构建逐位一致 */
  const s1 = buildScenePure(sceneOf(choreoWs("wsB", { pos: [200, 0, 0] })), emptyMap, emptyMap);
  const s2 = buildScenePure(sceneOf(choreoWs("wsB", { pos: [200, 0, 0] })), emptyMap, emptyMap);
  assert.equal(JSON.stringify(s1), JSON.stringify(s2), "确定性：同数据两次构建逐位一致");
  assert.deepEqual(s1.ws[0].stars[0].off, [8, 0, 0], "恒星 body 补存 off（2.1：位置补间重算前提）");
  assert.deepEqual(s1.ws[0].stars[0].wp, [8, 0, 0], "wp 烘焙口径不变（center=0 + off）");
  assert.deepEqual(s1.ws[0].stars[1].off, [-8, 0, 0], "每颗恒星各自补存 off");
  assert.equal(s1.ws[1].dust.length, 110, "archives=2 → 110 粒尘埃");
  assert.equal(s1.ws[1].dustCount, 110, "ws.dustCount 入册粒子数（增量 born 判定基线）");
  let offMax = 0;
  for (const d of s1.ws[1].dust) offMax = Math.max(offMax, Math.abs(d.off[0]), Math.abs(d.off[2]));
  assert.ok(offMax <= 1, "off 单位化（[-1,1]；星云半径渲染期缩放的前提）");
  assert.ok(s1.ws[1].dust.every((d) => d.born === null), "rebuild 路径不标 born（增量渐入只在 patch 路径）");

  /* 重建零抖动：wsB 删一颗星（场景级重建）→ 无关星座相位/尘埃/背景星/银河带不变 */
  const dropped = choreoWs("wsB", { pos: [200, 0, 0], stars: [choreoWs("wsB").stars[0]], links: [] });
  const s3 = buildScenePure(sceneOf(dropped), emptyMap, emptyMap);
  assert.deepEqual(s3.ws[1].dust, s1.ws[1].dust, "重建零抖动：无关星座尘埃逐位不变");
  assert.deepEqual(s3.bg, s1.bg, "重建零抖动：背景星分布不变（共享流长度固定）");
  assert.deepEqual(s3.band, s1.band, "重建零抖动：银河带分布不变");
  assert.equal(s3.ws[0].planets[0].phase, s1.ws[0].planets[0].phase, "行星相位 idHash 派生（不随他座恒星增删变化）");
  assert.equal(s3.ws[0].planets[0].speed, s1.ws[0].planets[0].speed, "行星速度倍率 idHash 派生（原分布区间保持）");
  assert.equal(s3.ws[0].planets[0].inc, s1.ws[0].planets[0].inc, "行星倾角 idHash 派生");
  assert.equal(s3.ws[0].comets[0].phase, s1.ws[0].comets[0].phase, "彗星相位 idHash 派生");

  /* 尘埃增量（D1）：密度 N→N+1 前 N 粒逐位相同（前缀稳定），尾部追加新粒 */
  const denser = choreoWs("wsB", { pos: [200, 0, 0], archives: 3 });
  const s4 = buildScenePure(sceneOf(denser), emptyMap, emptyMap);
  assert.equal(s4.ws[1].dust.length, 165, "archives=3 → 165 粒");
  const sig = (d) => JSON.stringify([d.off, d.s, d.hue, d.tw]);
  assert.deepEqual(
    s4.ws[1].dust.slice(0, 110).map(sig),
    s1.ws[1].dust.map(sig),
    "密度增长：前 110 粒逐位相同（off 单位化 → 不因半径增长位移）"
  );
  assert.notEqual(s4.ws[1].dust[110], undefined, "第 111 粒为尾部追加新粒");
}

/* ── 出生 fx（2.5）：推进/过期/delay 生效 + 卫星 born（2.2）+ 状态色相滑移（3.1） ── */
{
  const container = stubEl("div");
  const eng = createCosmosEngine({ container, style: createSkinD() });
  eng.setScene(miniScene(), "rebuild");
  eng.start();
  let tNow = 2000;
  for (let i = 0; i < 27; i++) { tNow += 50; stepFrame(tNow); } // 过冷启动序曲（≈1.4s > 1.2s）
  eng.markFx("star", "add-a", "birth");
  eng.markFx("comet", "c1", "birth", { delay: 0.4 });
  const fxOf = (key) => eng.inspectFx().find((f) => f.key === key) ?? null;
  const starFx = fxOf("star:add-a");
  const cometFx = fxOf("comet:c1");
  assert.ok(starFx && starFx.type === "birth" && starFx.dur === 0.6, "恒星 birth fx 入册（kind 级 0.6s）");
  assert.ok(cometFx && cometFx.dur === 0.8, "彗星 birth fx kind 级时长（0.8s 游入）");
  assert.ok(Math.abs((cometFx.t0 - starFx.t0) - 0.4) < 0.01, "delay 生效：t0 = E.t + delay");
  for (let i = 0; i < 10; i++) { tNow += 50; stepFrame(tNow); } // +0.5s（未过任一窗口）
  assert.ok(fxOf("star:add-a") && fxOf("comet:c1"), "0.5s：两枚 birth 均在窗口内（t<t0 的 delay 段天然安全）");
  for (let i = 0; i < 4; i++) { tNow += 50; stepFrame(tNow); } // star 0.6s 播完 + 缓冲
  assert.equal(fxOf("star:add-a"), null, "恒星 birth 播完过期即摘");
  assert.ok(fxOf("comet:c1"), "彗星 birth（delay 0.4 + dur 0.8）仍在播");
  for (let i = 0; i < 14; i++) { tNow += 50; stepFrame(tNow); }
  assert.equal(fxOf("comet:c1"), null, "彗星 birth 播完过期即摘");

  /* 卫星出生 born（2.2）：patch 新建 body 打 born = E.t；存量卫星不重播 */
  const withSat = miniScene();
  withSat.workspaces[0].planets[0].satellites = [{ id: "sat0", state: "idle", title: "sat0" }];
  eng.setScene(withSat, "rebuild");
  const grown = miniScene();
  grown.workspaces[0].planets[0].satellites = [
    { id: "sat0", state: "idle", title: "sat0" },
    { id: "sat1", state: "busy", title: "sat1" }
  ];
  eng.setScene(grown, "patch");
  const ent = eng.inspectEntities("ws1");
  const sat0 = ent.planets[0].sats.find((s) => s.id === "sat0");
  const sat1 = ent.planets[0].sats.find((s) => s.id === "sat1");
  assert.equal(sat0.born, null, "存量卫星 born 空（不重播出生坡道）");
  assert.ok(typeof sat1.born === "number" && sat1.born > 0, "新建卫星打 born = E.t（α/半径坡道锚点）");

  /* 状态色相滑移（3.1）：patch 检测 state 沿 → colorMix {from, to, t0, dur:0.6}，k≥1 摘除 */
  assert.equal(ent.planets[0].colorMix, null, "state 未变 → 无 colorMix");
  const busy = miniScene();
  busy.workspaces[0].planets[0].state = "waiting";
  busy.workspaces[0].comets[0].state = "waiting";
  eng.setScene(busy, "patch");
  const mixed = eng.inspectEntities("ws1");
  assert.deepEqual(
    { from: mixed.planets[0].colorMix.from, to: mixed.planets[0].colorMix.to, dur: mixed.planets[0].colorMix.dur },
    { from: "idle", to: "waiting", dur: 0.6 },
    "行星 state 沿 → colorMix"
  );
  assert.deepEqual(
    { from: mixed.comets[0].colorMix.from, to: mixed.comets[0].colorMix.to },
    { from: "idle", to: "waiting" },
    "彗星 state 沿 → colorMix"
  );
  for (let i = 0; i < 14; i++) { tNow += 50; stepFrame(tNow); } // +0.7s > 0.6s
  const expired = eng.inspectEntities("ws1");
  assert.equal(expired.planets[0].colorMix, null, "colorMix k≥1 摘除（行星）");
  assert.equal(expired.comets[0].colorMix, null, "colorMix k≥1 摘除（彗星）");
  eng.stop();
  eng.dispose();
}

/* ── 最小调度器（7.3）：错峰 / 并发上限 / 风暴降级 / 积压恢复 ── */
{
  const container = stubEl("div");
  const eng = createCosmosEngine({ container, style: createSkinD() });
  eng.setScene(miniScene(), "rebuild");
  eng.start();
  let tNow = 3000;
  for (let i = 0; i < 27; i++) { tNow += 50; stepFrame(tNow); } // 过冷启动序曲

  /* P2 同 ws 错峰 ≥0.15s：4 枚 birth 逐帧出队 */
  for (let i = 0; i < 4; i++) {
    eng.enqueueFx("star", "b" + i, "birth", { priority: FX_PRIORITY.existence, wsId: "ws1" });
  }
  for (let i = 0; i < 10; i++) { tNow += 50; stepFrame(tNow); }
  const births = eng.inspectFx().filter((f) => f.type === "birth").map((f) => f.t0).sort((a, b) => a - b);
  assert.equal(births.length, 4, "P2 无并发上限 → 全部启动（无丢失）");
  assert.ok(births[1] - births[0] >= 0.15 - 1e-6, "同 ws P2 错峰 ≥0.15s（1）");
  assert.ok(births[2] - births[1] >= 0.15 - 1e-6, "同 ws P2 错峰 ≥0.15s（2）");
  assert.ok(births[3] - births[2] >= 0.15 - 1e-6, "同 ws P2 错峰 ≥0.15s（3）");

  /* P1 并发上限 ≤3：6 枚 surge 无 ws 归组（错峰不适用）→ 同帧 3 启动 3 留队 */
  for (let i = 0; i < 6; i++) {
    eng.enqueueFx("star", "sv" + i, "surge", { priority: FX_PRIORITY.narrative, wsId: null });
  }
  stepFrame(tNow += 50);
  let q = eng.inspectFxQueue();
  assert.equal(q.activeP1, 3, "P1 并发上限 3");
  assert.equal(q.pending, 3, "超出并发部分留在队列");

  /* 风暴降级：再入 10 枚 → 积压 13 > 8 → storm；风暴中启动的降级执行（degraded 标记） */
  for (let i = 0; i < 10; i++) {
    eng.enqueueFx("star", "sg" + i, "surge", { priority: FX_PRIORITY.narrative, wsId: null });
  }
  assert.equal(eng.inspectFxQueue().pending, 13, "待启动积压 13");
  stepFrame(tNow += 50);
  assert.equal(eng.inspectFxQueue().storm, true, "积压 > 8 → 风暴降级开关");
  for (let i = 0; i < 24; i++) { tNow += 50; stepFrame(tNow); } // sv 窗口 1.2s 过 → 队列消化启动
  const degraded = eng.inspectFx().filter((f) => f.type === "surge" && f.degraded);
  assert.ok(degraded.length >= 1, "风暴中启动的 P1 降级执行（fx degraded 标记）");

  /* 积压恢复：排空后阈值比较即退出风暴（无专门退出流程） */
  for (let i = 0; i < 150; i++) { tNow += 50; stepFrame(tNow); } // ~7.5s 排空
  q = eng.inspectFxQueue();
  assert.equal(q.pending, 0, "积压消化完毕");
  assert.equal(q.storm, false, "积压 ≤ 阈值 → 风暴自动恢复");
  eng.stop();
  eng.dispose();
}

/* ── 冷启动点亮序曲（6.1）+ 星座消散幽灵（5.1） ── */
{
  const container = stubEl("div");
  const eng = createCosmosEngine({ container, style: createSkinD() });
  assert.equal(BOOT_DUR, 1.2, "boot 窗口常量导出（序曲窗口锚定语义）");
  eng.setScene(miniScene(), "rebuild");
  eng.start();
  eng.markFx("star", "add-a", "ignite"); // 序曲窗口内到达 → 入队延迟（fire = 序曲结束）
  assert.equal(eng.inspectFx().length, 0, "序曲窗口内：事件转场未启动");
  assert.equal(eng.inspectFxQueue().pending, 1, "序曲窗口内：转场入队延迟（无事件丢失）");
  let tNow = 4000;
  for (let i = 0; i < 26; i++) { tNow += 50; stepFrame(tNow); } // ≈1.3s > 1.2s
  assert.equal(eng.inspectFx().length, 1, "序曲结束：延迟转场启动");
  assert.equal(eng.inspectFxQueue().pending, 0, "延迟队列排空（序曲结束转正常调度）");

  /* ws 消散幽灵：引擎自快照 → 1.5s 自灭；未知 ws no-op */
  const twoWs = {
    workspaces: [
      miniScene().workspaces[0],
      {
        id: "ws2", name: "ws-two", pos: [100, 0, 0],
        stars: [{ id: "s2", name: "s2", lifecycle: "created", setBy: null, at: null, tasks: [1, 1], age: "刚刚", act: 0, off: [6, 0, 0] }],
        links: [], planets: [], comets: [], archives: 2, satelliteCount: 0
      }
    ]
  };
  eng.setScene(twoWs, "rebuild");
  eng.markWsGhost("ws2");
  assert.equal(eng.inspectGhosts().wsGhosts, 1, "消散幽灵入册（引擎在场景替换前后均可自快照在册星座）");
  eng.markWsGhost("missing");
  assert.equal(eng.inspectGhosts().wsGhosts, 1, "未知 ws → no-op");
  for (let i = 0; i < 32; i++) { tNow += 50; stepFrame(tNow); } // 1.6s > 1.5s
  assert.equal(eng.inspectGhosts().wsGhosts, 0, "消散幽灵 1.5s 播完自灭");
  eng.stop();
  eng.dispose();
}

/* ── 搜索过滤（add-cosmos-search-filter 2.2–2.5）：α 坡道 / 位移补间 / retarget /
      rebuild 落位 / camera-fit / 钻取互斥 ── */

/** 过滤夹具：3 星座（各带恒星；ws2 为联星行星 → 中点轨道中心）。 */
function filterScene(posOverride = null) {
  const posOf = (id, fallback) => (posOverride && posOverride[id]) || fallback;
  const starOf = (id, off) => ({ id, name: id, lifecycle: "created", setBy: null, at: null, tasks: [0, 0], age: "刚刚", act: 0, off });
  const planetOf = (id, stars) => ({ id, title: id, state: "idle", pendingKind: null, stars, todos: "—", when: "刚刚", satellites: [], satelliteCount: 0, delegatedBusy: false });
  return {
    workspaces: [
      {
        id: "ws1", name: "银河项目", pos: posOf("ws1", [100, 0, 0]),
        stars: [starOf("ws1-s", [10, 0, 0])], links: [],
        planets: [planetOf("ws1-p", ["ws1-s"])], comets: [], archives: 0, satelliteCount: 0
      },
      {
        id: "ws2", name: "Api-Gateway", pos: posOf("ws2", [0, 100, 0]),
        stars: [starOf("ws2-s1", [0, 10, 0]), starOf("ws2-s2", [0, -10, 0])], links: [[0, 1]],
        planets: [planetOf("ws2-p", ["ws2-s1", "ws2-s2"])], comets: [], archives: 0, satelliteCount: 0
      },
      {
        id: "ws3", name: "dsh-v-cosmos", pos: posOf("ws3", [0, 0, 100]),
        stars: [starOf("ws3-s", [0, 0, 10])], links: [],
        planets: [], comets: [], archives: 0, satelliteCount: 0
      }
    ]
  };
}

/* 观测面对读取器（inspectFilter 的 [id, value] 对列表） */
const pairOf = (pairs, id) => (pairs.find((p) => p[0] === id) ?? [id, null])[1];
const alphaOf = (info, id) => pairOf(info.alphas, id);
const filterAlphaOf = (info, id) => pairOf(info.filterAlphas, id);
const visOf = (info, id) => pairOf(info.vis, id);
const centerOf = (info, id) => pairOf(info.centers, id);
const picksOf = (info, id) => pairOf(info.picks, id);
const closeTo = (a, b, eps = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < eps);
/** 单命中 camera-fit 视距（裕量 / tan(fov/2) × 填充系数 1.1）。 */
const EXPECTED_FIT_DIST = FILTER_FIT_MARGIN / Math.tan(Math.PI / 6) * 1.1;

/* 纯函数面（2.5/2.8 导出）：包围球 / camera-fit 参数 / 输入守卫 */
{
  assert.deepEqual(boundingSphereOf([[0, 0, 0]]), { center: [0, 0, 0], radius: 0 }, "单点包围球");
  assert.deepEqual(boundingSphereOf([[100, 0, 0], [-100, 0, 0]], 60), { center: [0, 0, 0], radius: 160 }, "对称点球心 + 裕量");
  assert.equal(boundingSphereOf([]), null, "空点集 → null");
  assert.equal(boundingSphereOf([[1, 2]]), null, "非法点剔除 → null");

  const singleFit = fitCameraOf([[0, 0, 0]], 60, FILTER_FIT_MARGIN);
  assert.deepEqual(singleFit.target, [0, 0, 0], "fit target = 球心");
  const expected = FILTER_FIT_MARGIN / Math.tan(Math.PI / 6) * 1.1; // 裕量 / tan(fov/2) × 填充系数
  assert.ok(Math.abs(singleFit.dist - expected) < 1e-6, `单命中 dist = ${expected.toFixed(1)}`);
  assert.equal(fitCameraOf([[4000, 0, 0], [-4000, 0, 0]], 60, 60).dist, 4200, "dist clamp 上限 4200");
  assert.equal(fitCameraOf([[0, 0, 0]], 60, 0).dist, 24, "dist clamp 下限 24");
  assert.ok(fitCameraOf([[0, 0, 0]], 90, 60).dist < singleFit.dist, "fov 越大 dist 越小");

  assert.equal(isEditableTarget(null), false, "无焦点 → 非可编辑");
  assert.equal(isEditableTarget({ tagName: "DIV" }), false);
  assert.equal(isEditableTarget({ tagName: "INPUT" }), true, "INPUT = 可编辑（搜索框聚焦守卫）");
  assert.equal(isEditableTarget({ tagName: "TEXTAREA" }), true);
  assert.equal(isEditableTarget({ tagName: "SELECT" }), true);
  assert.equal(isEditableTarget({ tagName: "DIV", isContentEditable: true }), true, "contentEditable = 可编辑");
}

/* 引擎实例：过滤呈现态全路径 */
{
  const container = stubEl("div");
  const eng = createCosmosEngine({ container, style: createSkinD() });
  eng.setScene(filterScene(), "rebuild");
  rafQ.length = 0; // 清掉已停引擎残留的帧回调（cancelAnimationFrame 为桩）→ 帧计数与时间严格对齐
  eng.start();
  let tNow = 7000;
  fakeNow = 500000;
  const step = (n = 1) => { for (let i = 0; i < n; i++) { tNow += 50; stepFrame(tNow); } };

  /* 初始：无过滤；序曲期 α 三因子里 bootRamp 仍生效 */
  step(1);
  let info = eng.inspectFilter();
  assert.equal(info.active, false, "初始无过滤态");
  assert.deepEqual(info.matched, []);
  assert.equal(filterAlphaOf(info, "ws1"), 1, "无过滤 → filterAlpha = 1");
  assert.ok(alphaOf(info, "ws1") < 1, "序曲窗口内最终 α < 1（bootRamp 因子保留）");
  step(26); // ≈1.35s > 序曲 1.2s
  info = eng.inspectFilter();
  assert.ok(alphaOf(info, "ws1") > 0.999, "序曲结束 α → 1");

  /* 应用过滤（命中 ws1 → 目标位 [-200,0,0]）：α 坡道 + 位移补间 + camera-fit */
  assert.equal(eng.setFilter(new Set(["ws1"]), new Map([["ws1", [-200, 0, 0]]])), true, "首次应用 → applied");
  step(1);
  info = eng.inspectFilter();
  assert.equal(info.active, true);
  assert.deepEqual(info.matched, ["ws1"], "命中集合");
  assert.equal(info.ramps, 2, "未命中两星座起 α 坡道");
  assert.equal(info.anims, 1, "命中星座起位移补间");
  assert.ok(info.tween && info.tween.dur === FILTER_FIT_DUR && info.tween.mode === null, "camera-fit 补间 0.8s、无 endMode");
  assert.deepEqual(info.fit.target, [-200, 0, 0], "单命中：fit target = 命中位（居中可读）");
  assert.ok(Math.abs(info.fit.dist - EXPECTED_FIT_DIST) < 1e-6, "单命中 dist = 裕量/tan(fov/2)×1.1");

  /* 位移补间推进：0.5s 在途（<0.7s）→ +0.4s 完成落位 */
  step(10);
  info = eng.inspectFilter();
  assert.equal(info.anims, 1, `位移补间在途（${FILTER_SHIFT_DUR}s 未到）`);
  const midway = centerOf(info, "ws1");
  assert.ok(midway[0] > -200 && midway[0] < 100, "补间推进（中间值位于起点与终点之间）");
  step(8);
  info = eng.inspectFilter();
  assert.equal(info.anims, 0, "位移补间完成即摘");
  assert.equal(info.ramps, 0, "α 坡道完成即摘（0.35s）");
  assert.ok(closeTo(centerOf(info, "ws1"), [-200, 0, 0]), "位移终值 = 过滤目标位（子集布局）");

  /* 过滤呈现：命中保留、未命中淡隐 → 不产 item/picks（不可拾取/chip 隐藏） */
  assert.equal(visOf(info, "ws1"), true);
  assert.equal(visOf(info, "ws2"), false, "未命中星座淡隐至 vis=false");
  assert.equal(visOf(info, "ws3"), false);
  assert.equal(filterAlphaOf(info, "ws2"), 0, "未命中 filterAlpha = 0");
  assert.equal(picksOf(info, "ws2"), 0, "隐藏星座不产 picks");
  assert.equal(picksOf(info, "ws3"), 0);
  assert.ok(picksOf(info, "ws1") >= 2, "命中星座仍可拾取（恒星 + 行星）");

  /* 三处重算点（2.3）：wp = center + off；单星行星 center = 该星 wp */
  let ent = eng.inspectEntities("ws1");
  assert.deepEqual(ent.stars[0].off, [10, 0, 0], "恒星 body 补存 off（2.1）");
  assert.deepEqual(ent.stars[0].wp, [-190, 0, 0], "恒星 wp = center + off（重算点①）");
  assert.deepEqual(ent.planets[0].center, [-190, 0, 0], "单星行星轨道中心 = 该星 wp（重算点②）");

  /* 联星行星轨道中心 = 恒星中点（重算点③） */
  assert.equal(eng.setFilter(new Set(["ws2"]), new Map([["ws2", [50, 0, 0]]])), true);
  step(20);
  ent = eng.inspectEntities("ws2");
  assert.deepEqual(ent.stars.map((s) => s.wp), [[50, 10, 0], [50, -10, 0]], "联星两星 wp 同步重算");
  assert.ok(closeTo(ent.planets[0].center, [50, 0, 0]), "联星行星轨道中心 = 恒星中点");

  /* 逐键 retarget：在途改终点续接（t0 重锚，MUST NOT 重启） */
  eng.setFilter(new Set(["ws2"]), new Map([["ws2", [400, 0, 0]]]));
  step(3);
  const inFlight = centerOf(eng.inspectFilter(), "ws2");
  assert.ok(inFlight[0] > 50 && inFlight[0] < 400, `补间在途（x=${inFlight[0].toFixed(1)}）`);
  eng.setFilter(new Set(["ws2"]), new Map([["ws2", [-500, 0, 0]]]));
  step(1);
  const resumed = centerOf(eng.inspectFilter(), "ws2");
  assert.ok(Math.abs(resumed[0] - inFlight[0]) < 25, "retarget 下一帧贴近续接点（无重启跳变）");
  assert.equal(eng.inspectFilter().anims, 1, "续接复用同一补间（不叠加/不重播）");
  step(20);
  assert.ok(closeTo(centerOf(eng.inspectFilter(), "ws2"), [-500, 0, 0]), "retarget 终点生效");

  /* setFilter 短路 no-op（幂等重发不重锚坡道/不重起补间） */
  eng.setFilter(new Set(["ws3"]), new Map([["ws3", [0, 0, 120]]]));
  for (let i = 0; i < 16; i++) {
    assert.equal(eng.setFilter(new Set(["ws3"]), new Map([["ws3", [0, 0, 120]]])), false, "同态重发 → false");
    step(1);
  }
  info = eng.inspectFilter();
  assert.equal(info.ramps, 0, "幂等重发不重锚 α 坡道（0.35s 内正常坡完）");
  assert.equal(info.anims, 0, "幂等重发不重起位移补间（0.7s 内正常走完）");
  assert.ok(closeTo(centerOf(info, "ws3"), [0, 0, 120]), "幂等重发后仍达目标位");

  /* rebuild 落位（2.4）：命中星座直接处于过滤目标位；filterRamp 存活不闪帧 */
  eng.setFilter(new Set(["ws1"]), new Map([["ws1", [-100, 0, 0]]])); // ws1 隐→显、ws3 显→隐
  step(1);
  const preRebuild = eng.inspectFilter();
  assert.equal(preRebuild.ramps, 2, "rebuild 前 α 坡道在途（两星座目标翻转）");
  eng.setScene(filterScene({ ws1: [10, 0, 0], ws2: [20, 0, 0], ws3: [30, 0, 0] }), "rebuild");
  const postRebuild = eng.inspectFilter();
  assert.ok(closeTo(centerOf(postRebuild, "ws1"), [-100, 0, 0]), "rebuild 后命中星座直接落位（不重播位移补间）");
  assert.equal(postRebuild.anims, 0, "rebuild 不叠位移补间");
  assert.equal(postRebuild.ramps, 2, "filterRamp 跨 rebuild 存活（引擎级 Map → 不闪帧）");
  step(8); // +0.4s
  const afterRamp = eng.inspectFilter();
  assert.equal(afterRamp.ramps, 0);
  assert.equal(visOf(afterRamp, "ws1"), true, "重建后命中星座按坡道显形（无闪帧跳变）");
  assert.equal(visOf(afterRamp, "ws3"), false, "重建后未命中星座保持隐藏（过滤持续生效）");
  assert.ok(closeTo(centerOf(afterRamp, "ws3"), [30, 0, 0]), "未命中星座停在骨架位（隐藏态无需重排）");

  /* patch 路径 off 同步（2.1） */
  const patchedData = filterScene();
  patchedData.workspaces[0].stars[0].off = [30, 0, 0];
  eng.setScene(patchedData, "patch");
  ent = eng.inspectEntities("ws1");
  assert.deepEqual(ent.stars[0].off, [30, 0, 0], "patch 同步 body.off");
  const centerNow = centerOf(eng.inspectFilter(), "ws1");
  assert.deepEqual(ent.stars[0].wp, [centerNow[0] + 30, centerNow[1], centerNow[2]], "patch 以新 off 重写 wp");

  /* camera-fit：远距 clamp / 空匹配跳过 / 清空回全集取景 */
  eng.setFilter(new Set(["ws1", "ws2"]), new Map([["ws1", [3000, 0, 0]], ["ws2", [-3000, 0, 0]]]));
  assert.equal(eng.inspectFilter().fit.dist, 4200, "大范围匹配 → dist clamp 4200");
  const fitBefore = eng.inspectFilter().fit;
  eng.setFilter(new Set(), new Map(), { active: true }); // 空匹配：过滤激活但 0 命中
  assert.deepEqual(eng.inspectFilter().fit, fitBefore, "空匹配 MUST NOT 触发 camera-fit");
  step(20);
  const allHidden = eng.inspectFilter();
  assert.ok(allHidden.active, "空匹配仍为过滤激活态（「无匹配工作区」空态数据源）");
  assert.ok(allHidden.vis.every(([, v]) => v === false), "空匹配 → 全部星座淡隐");
  assert.ok(allHidden.picks.every(([, n]) => n === 0), "空匹配 → 无可拾取天体");
  assert.equal(eng.setFilter(new Set(), new Map()), true, "显式空集 = 过滤关闭（active 缺省）");
  assert.equal(eng.inspectFilter().active, false, "过滤关闭");
  step(20);
  const restored = eng.inspectFilter();
  assert.ok(restored.vis.every(([, v]) => v === true), "清空查询 → 全部星座重显");
  /* 清空 → fit 全集：target = 骨架原位置集合的包围球心
     （patch 后的 [100,0,0] / [0,100,0] / [0,0,100] → [50,50,50]）。 */
  assert.ok(closeTo(restored.fit.target, [50, 50, 50]), "清空 → camera-fit 回到骨架全集取景");
  assert.ok(restored.fit.dist > EXPECTED_FIT_DIST, "全集取景 dist 大于单命中（视野拉开）");

  /* 钻取互斥（2.2/D5）：焦点星座掉出 matched → 带标志 flyOut；收尾补 fit（2.5/D3） */
  eng.setFilter(new Set(["ws1"]), new Map([["ws1", [0, 0, 0]]]));
  step(20);
  const rootEl = createdEls.filter((el) => el.className === "cos-root").pop();
  const chips = createdEls.filter((el) => el.className === "cos-chip" && (el.listeners.click?.length ?? 0) > 0);
  const chip = chips.pop();
  assert.ok(chip, "星座 chip 已挂载（引擎覆盖层自建）");
  for (const fn of chip.listeners.click) fn(); // 银河视图点击 chip = dive(ws)
  let focus = eng.inspectFilter().focus;
  assert.equal(focus.diving, true, "进入钻取态");
  assert.ok(focus.id, "焦点星座已记");
  const focusId = focus.id;
  assert.equal(eng.inspectFilter().tween.mode, "in", "钻取补间在途（endMode in）");

  /* 钻取中焦点星座仍命中 → 钻取保持、不触发 fit（避免镜头打架） */
  const fitBeforeDive = eng.inspectFilter().fit;
  eng.setFilter(new Set([focusId]), new Map([[focusId, [-80, 0, 0]]]));
  const inDive = eng.inspectFilter();
  assert.equal(inDive.focus.diving, true, "焦点星座命中 → 钻取视图保持");
  assert.deepEqual(inDive.fit, fitBeforeDive, "钻取态 MUST NOT 触发 camera-fit");
  assert.equal(inDive.tween.mode, "in", "钻取补间未被 fit 改写");

  /* 焦点星座被过滤排除 → flyOut（标志）→ 收尾补 fit 当前匹配集合 */
  const other = ["ws1", "ws2", "ws3"].find((id) => id !== focusId);
  eng.setFilter(new Set([other]), new Map([[other, [120, 0, 0]]]));
  focus = eng.inspectFilter().focus;
  assert.equal(focus.fitPending, true, "「过滤排除」标志已挂（收尾补 fit）");
  assert.equal(eng.inspectFilter().tween.mode, "out", "焦点被排除 → flyOut（endMode out）");
  fakeNow += 1300; // 飞回 1.2s 完成
  step(1);
  const tail = eng.inspectFilter();
  assert.equal(tail.focus.diving, false, "flyOut 收尾：退出钻取态");
  assert.equal(tail.focus.fitPending, false, "标志消费一次即清");
  assert.ok(closeTo(tail.fit.target, [120, 0, 0]), "收尾补 fit：取景当前匹配集合（不停在过滤前旧景）");

  /* 滚轮接管即取消补间（2.5：本 change 补齐——现状滚轮被 tween 逐帧覆写）
     polish-cosmos-touch-nav D1/6.1：wheel 绑在 `.cos-root` 容器级（非 canvas） */
  eng.setFilter(new Set(["ws2"]), new Map([["ws2", [0, 40, 0]]]));
  assert.ok(eng.inspectFilter().tween, "fit 补间在途");
  assert.ok(rootEl?.listeners.wheel?.length, "wheel 监听已绑在容器级（.cos-root）");
  for (const fn of rootEl.listeners.wheel) fn({ preventDefault() {}, deltaY: 120, target: rootEl._by?.[".cos-canvas"] });
  assert.equal(eng.inspectFilter().tween, null, "滚轮接管 → 相机补间立即取消");
  assert.ok(eng.inspectFilter().camera.dist !== 430, "滚轮缩放已生效（用户控制优先）");

  /* 用户接管优先：排除 flyOut 过程中的滚轮取消 → tween 与「收尾补 fit」标志一并丢弃 */
  for (const fn of chip.listeners.click) fn(); // 再次钻取（同一 chip）
  eng.setFilter(new Set([focusId]), new Map([[focusId, [60, 0, 0]]]));
  assert.equal(eng.inspectFilter().focus.fitPending, false, "焦点命中 → 不挂排除标志");
  eng.setFilter(new Set([other]), new Map([[other, [90, 0, 0]]]));
  assert.equal(eng.inspectFilter().focus.fitPending, true, "焦点被排除 → 排除标志已挂");
  for (const fn of rootEl.listeners.wheel) fn({ preventDefault() {}, deltaY: -120, target: rootEl._by?.[".cos-canvas"] });
  const afterTakeover = eng.inspectFilter();
  assert.equal(afterTakeover.tween, null, "滚轮接管取消 flyOut 补间");
  assert.equal(afterTakeover.focus.fitPending, false, "用户接管 → 放弃收尾补 fit（镜头归用户）");

  eng.stop();
  eng.dispose();
  const disposedInfo = eng.inspectFilter();
  assert.equal(disposedInfo.active, false, "dispose 清空过滤态");
  assert.equal(disposedInfo.ramps, 0, "dispose 清空 α 坡道");
}

/* 端到端：隐藏星座不产任何 render item（计数皮肤直测 2.7「不产 render item」） */
{
  const skin = createSkinD();
  const drawn = new Map();
  const drawBody = skin.drawBody.bind(skin);
  skin.drawBody = function (ctx, it, view) {
    if (it.ws?.id) drawn.set(it.ws.id, (drawn.get(it.ws.id) ?? 0) + 1);
    return drawBody(ctx, it, view);
  };
  const eng = createCosmosEngine({ container: stubEl("div"), style: skin });
  eng.setScene(filterScene(), "rebuild");
  rafQ.length = 0;
  eng.start();
  let t = 9000;
  for (let i = 0; i < 27; i++) { t += 50; stepFrame(t); } // 过序曲
  eng.setFilter(new Set(["ws1"]), new Map([["ws1", [0, 0, 0]]]));
  for (let i = 0; i < 20; i++) { t += 50; stepFrame(t); } // 过 α 坡道（0.35s）
  drawn.clear();
  t += 50; stepFrame(t); // 稳态单帧
  assert.ok((drawn.get("ws1") ?? 0) > 0, "命中星座产 render item");
  assert.equal(drawn.get("ws2") ?? 0, 0, "未命中星座不产 render item（淡隐至 vis=false 早退）");
  assert.equal(drawn.get("ws3") ?? 0, 0, "空星座（无行星）同样不产 item");
  eng.stop();
  eng.dispose();
}

/* ── 输入守卫（2.8）：搜索框聚焦时 WASD MUST NOT 被引擎劫持 ── */
{
  const before = windowListeners.keydown.length;
  const container = stubEl("div");
  const eng = createCosmosEngine({ container, style: createSkinD() });
  eng.setScene(miniScene(), "rebuild");
  const handlers = windowListeners.keydown.slice(before);
  assert.equal(handlers.length, 1, "引擎注册一个 window keydown 监听");
  const press = (target) => {
    globalThis.document.activeElement = target;
    let prevented = false;
    const ev = {
      code: "KeyW", ctrlKey: false, metaKey: false, altKey: false, isComposing: false,
      preventDefault() { prevented = true; }
    };
    for (const fn of handlers) fn(ev);
    return prevented;
  };
  assert.equal(press({ tagName: "INPUT", isContentEditable: false }), false, "INPUT 聚焦 → 不劫持（字符进搜索框）");
  assert.equal(press({ tagName: "TEXTAREA" }), false, "TEXTAREA 聚焦 → 不劫持");
  assert.equal(press({ tagName: "DIV", isContentEditable: true }), false, "contentEditable → 不劫持");
  assert.equal(press({ tagName: "SELECT" }), false, "SELECT 聚焦 → 不劫持");
  assert.equal(press({ tagName: "DIV", isContentEditable: false }), true, "普通元素聚焦 → 劫持 WASD");
  assert.equal(press(null), true, "无焦点 → 劫持 WASD（吞宿主同键默认行为）");
  globalThis.document.activeElement = null;
  eng.dispose();
}

/* ── 星座集合变化中心滑移（add-cosmos-add-workspace D5/2.1–2.3）：捕获 / 滑移 /
      终态确定性 / 冷启动不滑移 / sceneData 零污染 / 与消散幽灵共存 / dive 目标终态 ── */
{
  const eng = createCosmosEngine({ container: stubEl("div"), style: createSkinD() });
  eng.setScene(filterScene(), "rebuild"); // 冷启动：旧场景 null
  assert.deepEqual(eng.inspectSlides().tweens, [], "冷启动无中心捕获（无前一帧中心）");
  assert.deepEqual(eng.inspectSlides().anims, [], "冷启动无滑移补间（点亮序曲直出确定性位）");
  rafQ.length = 0;
  eng.start();
  let tNow = 11000;
  const step = (n = 1) => { for (let i = 0; i < n; i++) { tNow += 50; stepFrame(tNow); } };
  step(1);

  /* 集合 N→N+1 且存量位变化：存量捕获滑移、新 id 不捕获（出生转场） */
  const grown = filterScene({ ws1: [300, 0, 0], ws2: [0, 300, 0], ws3: [0, 0, 300] });
  grown.workspaces.push({
    id: "ws4", name: "新星座", pos: [0, -300, 0],
    stars: [], links: [], planets: [], comets: [], archives: 0, satelliteCount: 0
  });
  const dataSnapshot = JSON.stringify(grown);
  eng.setScene(grown, "rebuild"); // ws 集合变化必然 sceneDiffLevel=rebuild 路径
  let slides = eng.inspectSlides();
  assert.equal(slides.tweens.length, 3, "同 id 且 center 变化的存量星座全部捕获");
  assert.ok(!slides.tweens.some((tw) => tw.id === "ws4"), "新 id 不捕获（出生走凝聚 / chip 高亮）");
  assert.deepEqual(slides.anims.slice().sort(), ["ws1", "ws2", "ws3"], "存量星座起滑移补间（新星座不起）");
  assert.equal(eng.getScene(), grown, "sceneData 原引用透传");
  assert.equal(JSON.stringify(eng.getScene()), dataSnapshot, "滑移为呈现层瞬态：MUST NOT 写 sceneData");
  assert.ok(closeTo(centerOf(eng.inspectSlides(), "ws1"), [100, 0, 0]), "滑移起点 = 旧中心（不瞬移）");
  step(8); // +0.4s < 0.8s
  const midX = centerOf(eng.inspectSlides(), "ws1")[0];
  assert.ok(midX > 100 && midX < 300, `补间中位于旧/新位之间（x=${midX.toFixed(1)}）`);
  step(12); // 累计 +1.0s > 0.8s
  slides = eng.inspectSlides();
  assert.deepEqual(slides.anims, [], "0.8s 播完即摘（无补间残差）");
  assert.ok(closeTo(centerOf(slides, "ws1"), [300, 0, 0]), "终态 = 确定性新位（ws1）");
  assert.ok(closeTo(centerOf(slides, "ws3"), [0, 0, 300]), "终态 = 确定性新位（ws3）");
  /* 终态逐位等于 buildScene 确定性输出（重建零抖动断言对象不受补间影响） */
  const pure = buildScenePure(grown, new Map(), new Map());
  for (const ws of pure.ws) {
    assert.ok(closeTo(centerOf(eng.inspectSlides(), ws.id), ws.center, 1e-9), `终态逐位一致（${ws.id}）`);
  }
  assert.equal(JSON.stringify(eng.getScene()), dataSnapshot, "滑移结束 sceneData 仍逐位不变（判级不受影响）");

  /* 注销：幸存星座滑移内收 + 被删星座消散幽灵同帧共存 */
  step(10); // 过冷启动序曲窗口（1.2s）——boot 内 markWsGhost 会延迟入列（既有语义）
  eng.markWsGhost("ws3");
  const shrunk = filterScene({ ws1: [120, 0, 0], ws2: [0, 120, 0] });
  shrunk.workspaces = shrunk.workspaces.slice(0, 2); // 注销 ws3（filterScene 夹具恒带三星座）
  eng.setScene(shrunk, "rebuild");
  assert.equal(eng.inspectGhosts().wsGhosts, 1, "被删星座消散幽灵在册");
  const removed = eng.inspectSlides();
  assert.equal(removed.tweens.length, 2, "注销后幸存星座捕获滑移（内收）");
  assert.ok(removed.anims.includes("ws1") && removed.anims.includes("ws2"), "幸存者滑移与消散幽灵同帧共存");
  step(20);
  assert.ok(closeTo(centerOf(eng.inspectSlides(), "ws1"), [120, 0, 0]), "注销内收终态 = 确定性输出");
  assert.ok(!eng.inspectSlides().centers.some((pair) => pair[0] === "ws3"), "注销星座已移出场景");

  /* diveToWs（D4/3.1）：命中复用既有 dive，目标取补间终态（非途中点）；未命中 false */
  const moving = filterScene({ ws1: [600, 0, 0], ws2: [0, 600, 0] });
  eng.setScene(moving, "rebuild"); // 120 → 600 起滑移
  assert.equal(eng.inspectSlides().anims.length > 0, true, "dive 前滑移在途（目标仍须为终态）");
  assert.equal(eng.diveToWs("missing"), false, "未命中星座 → false 不抛错");
  assert.equal(eng.diveToWs("ws1"), true, "命中星座 → 进入钻取");
  const diveTween = eng.inspectFilter().tween;
  assert.ok(diveTween && diveTween.dur === 1300, "复用既有 dive 补间（1300ms，同 chip 点击语义）");
  assert.deepEqual(diveTween.to.target, [600, 0, 0], "dive 目标 = 补间终态确定性位（不追补间中点）");
  assert.equal(eng.inspectFilter().focus.diving, true, "钻取态成立");
  assert.equal(eng.consumeEscape(), true, "Esc 消费：退出钻取返回银河");
  eng.stop();
  eng.dispose();
  assert.deepEqual(eng.inspectSlides(), { tweens: [], anims: [], centers: [] }, "dispose 清空滑移捕获与场景");
}

/* ── 空星座 chip 出生高亮（add-cosmos-add-workspace D6/3.2/3.3） ── */
{
  assert.equal(WS_SHIFT_DUR, 0.8, "中心滑移常量导出（约 0.8s）");
  assert.equal(WS_BIRTH_HL_DUR, 2, "出生高亮常量导出（约 2s）");
  assert.ok(ENGINE_CSS.includes(".cos-chip.cos-chip-new"), "ENGINE_CSS 含 cos-chip-new 规则");
  assert.ok(ENGINE_CSS.includes("@keyframes cos-chip-birth"), "ENGINE_CSS 含出生高亮关键帧（forwards 渐熄）");

  const eng = createCosmosEngine({ container: stubEl("div"), style: createSkinD() });
  const withStar = miniScene().workspaces[0];
  const emptyWs = { id: "ws-empty", name: "空星座", pos: [0, 0, 0], stars: [], links: [], planets: [], comets: [], archives: 0, satelliteCount: 0 };
  const two = () => ({ workspaces: [withStar, emptyWs] });
  eng.setScene(two(), "rebuild");

  /** 重建产出的 chip（createdEls 顺序 = 场景 ws 顺序）。 */
  const rebuildChips = () => {
    const before = createdEls.length;
    eng.setScene(two(), "rebuild");
    return createdEls.slice(before).filter((el) => String(el.className).startsWith("cos-chip"));
  };

  eng.markWsBirth("ws-empty");
  let chips = rebuildChips();
  assert.equal(chips.length, 2, "重建为两星座各产一个 chip");
  assert.ok(String(chips[1].className).includes("cos-chip-new"), "空星座 chip 附加出生高亮类");
  assert.ok(!String(chips[0].className).includes("cos-chip-new"), "含恒星星座不受影响（凝聚转场照旧）");

  eng.markWsBirth("ws1");
  chips = rebuildChips();
  assert.ok(!String(chips[0].className).includes("cos-chip-new"), "有内容星座即便被标记也 MUST NOT 播空星座高亮（引擎侧守卫）");

  /* 高亮窗口过期：~2s 后重建不再附加（CSS forwards 收尾即常态，无 JS 清理残留） */
  rafQ.length = 0;
  eng.start();
  let tNow = 0;
  for (let i = 0; i < 45; i++) { tNow += 50; stepFrame(tNow); } // E.t ≈ 2.25s > 2s
  chips = rebuildChips();
  assert.ok(!String(chips[1].className).includes("cos-chip-new"), "高亮窗口过后空星座 chip 回落常态");
  eng.stop();
  eng.dispose();
}

/* ── 输入层容器级重绑 + 手势 + HUD 精简（polish-cosmos-touch-nav 6.1/6.3 / D1/D2/D5） ── */
{
  const before = createdEls.length;
  const eng = createCosmosEngine({ container: stubEl("div"), style: createSkinD() });
  eng.setScene(miniScene(), "rebuild");
  rafQ.length = 0;
  eng.start();
  let tNow = 20000;
  const step1 = (n = 1) => { for (let i = 0; i < n; i++) { tNow += 50; stepFrame(tNow); } };
  step1(27); // 过冷启动序曲

  const mine = createdEls.slice(before);
  const rootEl = mine.find((el) => el.className === "cos-root");
  assert.ok(rootEl, "引擎根容器已挂载");
  const canvasEl = rootEl._by[".cos-canvas"];
  const chip = mine.filter((el) => String(el.className).startsWith("cos-chip")).pop();
  const homeBtn = mine.find((el) => el.className === "cos-home-btn");
  const badgeEl = rootEl._by[".cos-badge"];
  const cardEl = rootEl._by[".cos-card"];
  assert.ok(chip && homeBtn && badgeEl, "覆盖层元素齐备（chip / 回到银河 / 星座标牌）");

  const fire = (el, type, ev) => { for (const fn of el.listeners[type] ?? []) fn(ev); };
  const input = () => eng.inspectInput();
  const cam = () => eng.inspectFilter().camera;

  /* 绑定点（D1）：容器级单绑——wheel/pointer 均不再绑 canvas、亦不逐覆盖元素枚举 */
  assert.ok((rootEl.listeners.wheel?.length ?? 0) > 0, "wheel 绑在 .cos-root 容器级");
  assert.equal(canvasEl.listeners.wheel, undefined, "canvas 上无独立 wheel 监听（去双绑）");
  assert.ok((rootEl.listeners.pointerdown?.length ?? 0) > 0, "pointerdown 绑容器级");
  assert.equal(canvasEl.listeners.pointerdown, undefined, "canvas 上无独立 pointerdown 监听");
  assert.ok(/\.cos-root \{[^}]*touch-action: none/.test(ENGINE_CSS), "touch-action: none 收敛为容器级一条规则");
  assert.ok(!/\.cos-canvas \{[^}]*touch-action/.test(ENGINE_CSS), "canvas 规则不再重复声明 touch-action");

  /* HUD 精简（D5/6.3）：ensureDom 产物与 ENGINE_CSS 均不再有面包屑/右上提示 */
  const markup = String(rootEl.innerHTML);
  assert.ok(markup.includes("cos-canvas") && markup.includes("cos-badge"), "ensureDom 产物含 canvas 与星座标牌");
  assert.ok(!markup.includes("cos-crumb"), "ensureDom 产物无面包屑");
  assert.ok(!markup.includes("cos-hint"), "ensureDom 产物无右上操作提示");
  assert.ok(!ENGINE_CSS.includes(".cos-crumb"), "ENGINE_CSS 无 .cos-crumb 规则");
  assert.ok(!ENGINE_CSS.includes(".cos-hint"), "ENGINE_CSS 无 .cos-hint 规则");

  /* 右下「回到银河」常驻按钮（D3/4.1）：a11y 属性 + 方形尺寸 + 风格 D 角标 */
  assert.equal(homeBtn.attrs["aria-label"], "回到银河", "按钮 aria-label 提供");
  assert.equal(homeBtn.attrs.title, "回到银河", "按钮 title 提供");
  assert.ok(String(homeBtn.innerHTML).includes("<svg"), "内嵌迷你星系 SVG 图标");
  assert.ok(/\.cos-home-btn \{[^}]*width: 44px; height: 44px/.test(ENGINE_CSS), "按钮方形 44×44（触屏目标 ≥40px）");
  assert.ok(ENGINE_CSS.includes(".cos-home-btn::before"), "风格 D 暖金角标伪元素保留");

  /* 缩放死区修复（D1）：wheel 在覆盖元素（chip）上派发 → 容器级监听同样触发 */
  const distBeforeWheel = cam().dist;
  fire(rootEl, "wheel", { preventDefault() {}, deltaY: 120, target: chip });
  assert.ok(cam().dist > distBeforeWheel, "覆盖元素（chip）上的滚轮缩放生效（无缩放死区）");

  /* 找一个「命中天体」的屏幕点（hover 拾取面：card.dataset.sig 被写入即命中）——
     用它验证捕获/拾取策略：若容器级 pointerup 仍执行 pickAt，会叠出第二次 dive。 */
  cardEl.dataset.sig = "";
  let hitPt = null;
  for (let gx = 368; gx <= 432 && !hitPt; gx += 4) {
    for (let gy = 268; gy <= 332 && !hitPt; gy += 4) {
      fire(rootEl, "pointermove", { pointerId: 99, clientX: gx, clientY: gy, buttons: 0, target: canvasEl });
      step1(1);
      if (cardEl.dataset.sig) hitPt = { x: gx, y: gy };
    }
  }
  assert.ok(hitPt, "找到可拾取天体的屏幕点（拾取面自检）");

  /* hover 探针只在 canvas 上跟随（容器级重绑 MUST NOT 破坏信息卡可达性）：
     指针移到覆盖元素上时命中点不改写——否则信息卡先于「打开会话」点击消失。 */
  const sigOnHit = cardEl.dataset.sig;
  fire(rootEl, "pointermove", { pointerId: 98, clientX: 760, clientY: 560, buttons: 0, target: chip });
  step1(1);
  assert.equal(cardEl.dataset.sig, sigOnHit, "覆盖元素上移动指针不改写 hover 命中（信息卡不闪退）");

  /* canvas 起指：维持既有 setPointerCapture + pointerup 拾取语义（D2 第 2 条） */
  const capCalls = [];
  canvasEl.setPointerCapture = (id) => { capCalls.push(id); };
  const divesBeforeCanvas = input().dives;
  fire(rootEl, "pointerdown", { pointerId: 5, clientX: hitPt.x, clientY: hitPt.y, target: canvasEl, preventDefault() {} });
  assert.deepEqual(capCalls, [5], "canvas 起指维持 setPointerCapture（拖拽越界不丢事件）");
  fire(rootEl, "pointerup", { pointerId: 5, clientX: hitPt.x, clientY: hitPt.y, target: canvasEl });
  assert.equal(input().dives, divesBeforeCanvas + 1, "canvas 起指抬指维持 pickAt 拾取语义（点击天体 dive）");

  /* 覆盖元素起指：MUST NOT 捕获、MUST NOT 容器级拾取；chip 自身 click 恰好 dive 一次（D8 防回归） */
  capCalls.length = 0;
  const divesBeforeChip = input().dives;
  fire(rootEl, "pointerdown", { pointerId: 3, clientX: hitPt.x, clientY: hitPt.y, target: chip, preventDefault() {} });
  assert.deepEqual(capCalls, [], "覆盖元素起指 MUST NOT setPointerCapture（捕获会吞掉 click 派发）");
  fire(rootEl, "pointerup", { pointerId: 3, clientX: hitPt.x, clientY: hitPt.y, target: chip });
  assert.equal(input().dives, divesBeforeChip, "覆盖元素抬指 MUST NOT 执行容器级拾取（防与 chip click 叠加）");
  fire(chip, "click", {});
  assert.equal(input().dives, divesBeforeChip + 1, "chip 单指点按 dive 单次触发（不重不叠）");

  /* 双指捏合（D2）：第二指落下切 pinch、指距比例驱动 dist、接管即取消补间 */
  const distBase = cam().dist;
  fire(rootEl, "pointerdown", { pointerId: 11, clientX: 100, clientY: 100, target: canvasEl, preventDefault() {} });
  fire(rootEl, "pointerdown", { pointerId: 12, clientX: 200, clientY: 100, target: canvasEl, preventDefault() {} });
  assert.equal(input().gesture, true, "第二指落下 → 切捏合手势");
  assert.equal(input().pointers, 2, "多指针追踪在册");
  assert.deepEqual(input().pinch, { d0: 100, dist0: distBase }, "捏合基准 = 基准指距 + 基准镜头距离");
  fire(rootEl, "pointermove", { pointerId: 12, clientX: 300, clientY: 100, buttons: 1, target: canvasEl });
  assert.ok(Math.abs(cam().dist - distBase * 0.5) < 1e-6, "指距张开一倍 → dist 减半（张开 = 放大）");
  assert.equal(eng.inspectFilter().tween, null, "捏合接管 → 相机补间立即让位");

  /* 手势收尾：剩指重置为单指起点（拖拽旋转续接），全部抬起记抑制窗 */
  fire(rootEl, "pointerup", { pointerId: 12, target: canvasEl });
  assert.equal(input().gesture, true, "一指仍在按 → 手势未结束（抑制持续）");
  const yawBeforeDrag = cam().yaw;
  fire(rootEl, "pointermove", { pointerId: 11, clientX: 140, clientY: 130, buttons: 1, target: canvasEl });
  assert.notEqual(cam().yaw, yawBeforeDrag, "剩指重置起点后回到单指拖拽旋转语义");
  fire(rootEl, "pointerup", { pointerId: 11, target: canvasEl });
  assert.equal(input().gesture, false, "全部抬起 → 手势结束");
  assert.equal(input().dragging, false, "捏合收尾清拖拽累积（不吃掉后续拾取）");
  assert.equal(input().suppressed, true, "手势结束进入 GESTURE_SUPPRESS_MS 抑制窗");

  /* 捏合不误触 dive（spec scenario）：抑制窗内 chip click 被抑制，窗过恢复 */
  const divesBeforeSuppress = input().dives;
  fire(chip, "click", {});
  assert.equal(input().dives, divesBeforeSuppress, "抑制窗内 chip click 不 dive（捏合不误触）");
  fakeNow += GESTURE_SUPPRESS_MS + 1;
  assert.equal(input().suppressed, false, "抑制窗过期（350ms 后恢复点击语义）");
  fire(chip, "click", {});
  assert.equal(input().dives, divesBeforeSuppress + 1, "抑制窗过期后 chip click 正常 dive");

  /* 钻取态左上标牌（D4/3.2）：星座名 + 全量计数仪表 + 内容差分守卫 */
  fakeNow += 1300; // 钻取补间播完（E.focusMix → 1）
  step1(1);
  assert.equal(eng.inspectFilter().focus.diving, true, "钻取态成立");
  assert.ok(String(badgeEl.dataset.html).includes("ws-one"), "标牌含星座名（dataset.html 守卫值已写）");
  assert.ok(String(badgeEl.innerHTML).includes("ws-one"), "标牌渲染星座名");
  assert.ok(/✦1 ●1 ◇0 ☄1 ☁0/.test(String(badgeEl.innerHTML)), "标牌含全量计数仪表 ✦●◇☄☁");
  assert.ok(/\.cos-badge \{[^}]*max-width: min\(320px, calc\(50% - 160px\)\)/.test(ENGINE_CSS), "标牌限宽与中央搜索带互不侵占（spec 无重叠）");
  badgeEl.innerHTML = "MARKER";
  step1(1);
  assert.equal(badgeEl.innerHTML, "MARKER", "内容未变 → 标牌零重写（内容差分守卫生效）");

  const changed = miniScene();
  changed.workspaces[0].satelliteCount = 3;
  changed.workspaces[0].archives = 2;
  eng.setScene(changed, "patch");
  step1(1);
  assert.ok(/✦1 ●1 ◇3 ☄1 ☁2/.test(String(badgeEl.innerHTML)), "计数随场景 patch 实时更新（就地更新，不重建覆盖层）");
  assert.equal(String(chip.innerHTML), "<b>ws-one</b>", "银河态 chip 只写星座名（无计数行）");
  assert.ok(!String(chip.innerHTML).includes("<span>"), "银河态 chip 无计数 span");

  /* 右下「回到银河」两态（D3/4.2）：钻取态 = flyOut（与 Esc 等效）；根级 = 仅清选中不关页 */
  fire(homeBtn, "click", {});
  assert.equal(eng.inspectFilter().tween.mode, "out", "钻取态点击 → flyOut 补间（≡ Esc）");
  fakeNow += 1300;
  step1(1);
  assert.equal(eng.inspectFilter().focus.diving, false, "飞回银河：退出钻取");
  assert.equal(String(badgeEl.innerHTML), "", "回到银河后标牌清空（银河视图无标牌）");
  const tweenAtRoot = eng.inspectFilter().tween;
  const divesAtRoot = input().dives;
  fire(homeBtn, "click", {});
  assert.equal(eng.inspectFilter().tween, tweenAtRoot, "根级点击不新建镜头补间（仅清选中，不飞）");
  assert.equal(input().dives, divesAtRoot, "根级点击不触发 dive");
  assert.equal(eng.consumeEscape(), false, "根级无选中/无钻取 → Esc 不消费（整页未被关闭）");

  /* 按钮 DOM 只建一次（D3）：钻取往返后仍是同一实例（未被逐帧重建） */
  const homeBtnAgain = createdEls.slice(before).filter((el) => el.className === "cos-home-btn");
  assert.equal(homeBtnAgain.length, 1, "回到银河按钮全程只建一次 DOM");

  eng.stop();
  eng.dispose();
}

console.log("engine-smoke: all assertions passed");
