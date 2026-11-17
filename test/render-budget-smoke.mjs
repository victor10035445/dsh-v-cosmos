/**
 * 场景规模渲染预算与降级冒烟（add-cosmos-render-budget 1.1–5.3）。
 *
 * 覆盖五面（spec「场景规模渲染预算与降级」五 scenario 的机械锚点）：
 *  - 预算封顶均摊：n 星座 → per-ws 粒数 = clamp(floor(预算/n), 下限, 自身粒数)，
 *    总粒数 ≤ 预算（下限超卖边界单独断言）；
 *  - 裁剪前缀确定性：预算/星座数变化只改后缀，前 k 粒屏幕坐标逐位不变；
 *    预算不触发时与改造前投影公式逐位一致（零视觉差异）；
 *  - 视口剔除零差异：屏外粒子不进 pts，屏内粒子 MUST 全在（扫掠相机逐帧校验，
 *    无进出闪烁 = 屏内粒子从不缺席；拾取/计数语义不消费 pts）；背景星/银河带同款；
 *  - 低开销原语跨皮肤一致：12 套皮肤 dust 分支经共享原语（缓存 sprite drawImage）、
 *    合成模式逐皮肤保持（light 皮肤无 lighter）、born 坡道沿用、空 pts 零 ctx 调用；
 *  - 零分配投影基建：projectInto 同输入逐位同输出（无脏读）、`out` 槽位身份不变、
 *    近平面不写槽位；条目数组/轨道点/尾迹/屏幕坐标/背景点跨帧槽位复用。
 *
 * 运行：node test/render-budget-smoke.mjs
 */
import assert from "node:assert/strict";
import {
  createCosmosEngine, buildScenePure, dustPerWsOf,
  NEBULA_BUDGET, NEBULA_DUST_FLOOR, NEBULA_CULL_MARGIN,
  NEBULA_ALPHA_BASE, NEBULA_ALPHA_SWING,
  projectInto, projectIntoXYZ
} from "../src/cosmos/engine.mjs";
import { COSMOS_SKINS, createSkin } from "../src/cosmos/skin-registry.mjs";
import { makeDustSprite, dustBatchDraw } from "../src/cosmos/skin-kit.mjs";

/* ── DOM / 帧循环桩（与 engine-smoke / render-smoke 同形） ── */

let ctxFactory = stubCtx2d;
function stubCtx2d() {
  return new Proxy({}, {
    get(target, prop) {
      if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => ({ addColorStop() {} });
      if (prop === "measureText") return () => ({ width: 10 });
      if (!(prop in target)) target[prop] = () => undefined;
      return target[prop];
    },
    set(target, prop, value) { target[prop] = value; return true; }
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
function stubEl(tag) {
  const el = {
    tag, style: {}, dataset: {}, className: "", innerHTML: "", textContent: "", width: 0, height: 0,
    children: [], listeners: {}, attrs: {}, _by: {},
    classList: null,
    appendChild(child) { el.children.push(child); return child; },
    remove() {},
    querySelector(sel) {
      if (!el._by[sel]) {
        const child = stubEl(sel === ".cos-canvas" ? "canvas" : "div");
        if (child.tag === "canvas") child.getContext = () => ctxFactory();
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
  el.classList = classListOf(el);
  return el;
}
const windowListeners = { keydown: [], keyup: [], blur: [], resize: [] };
globalThis.window = {
  devicePixelRatio: 1,
  addEventListener(type, fn) { (windowListeners[type] = windowListeners[type] || []).push(fn); },
  removeEventListener() {}
};
globalThis.document = {
  createElement(t) {
    const el = stubEl(t);
    if (t === "canvas") el.getContext = () => ctxFactory();
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
let fakeNow = 0;
globalThis.performance = { now: () => fakeNow };
function stepFrame(ts) {
  const cb = rafQ.shift();
  assert.ok(cb, "帧回调在队");
  cb(ts);
}

/* ── 场景夹具与观测皮肤 ── */

const W = 800, H = 600;

/** 星座夹具（1 恒星 + 可选行星/彗星 + archives 尘埃）。 */
function wsOf(i, archives, x, opts = {}) {
  const stars = [{ id: "star-" + i, name: "star-" + i, lifecycle: "executed", setBy: null, at: null, tasks: [1, 1], age: "刚刚", act: 0, off: [6, 0, 0] }];
  const planets = opts.planet
    ? [{ id: "p-" + i, title: "p", state: "idle", pendingKind: null, stars: ["star-" + i], todos: "—", when: "刚刚", satellites: [], satelliteCount: 0, delegatedBusy: false }]
    : [];
  const comets = opts.comet
    ? [{ id: "c-" + i, title: "c", state: "idle", pendingKind: null, when: "刚刚", satellites: [], satelliteCount: 0, delegatedBusy: false }]
    : [];
  return {
    id: "ws-" + i, name: "ws-" + i, pos: [x, 0, 0],
    stars, links: [], planets, comets,
    archives, satelliteCount: 0
  };
}
function sceneOf(workspaces) { return { workspaces }; }

/** 观测皮肤（背景与 drawBody 只记录 view/items，真实投影仍由引擎产出）。 */
function spyStyle(useBand = false) {
  const style = {
    skin: "spy",
    useBand,
    palette: {
      prop: { proto: "#8a9bc0", created: "#9fd8ff", reviewed: "#cfe8ff", executed: "#ffe27a" },
      sess: { idle: "#a8b8d8", busy: "#54c8ff", waiting: "#ffaa4a", "done-unread": "#5affc0", free: "#cfeaff" }
    },
    gold: "#ffd28a",
    dustColors: ["#5a6ea0", "#7a6ea0"],
    bgStarColor: () => "#ffffff",
    views: [],
    log: [],
    background(ctx, view) { style.views.push(view); },
    drawBody(ctx, it, view) { style.log.push({ t: view.t, it: it }); }
  };
  return style;
}

/** 引擎 + 相对时间基准（每引擎独立时钟：E.t 推进逐位可复现）。 */
function bootEngine(sceneData, style) {
  const container = stubEl("div");
  const engine = createCosmosEngine({ container, style });
  engine.setScene(sceneData, "rebuild");
  engine.start();
  let now = 0;
  return {
    engine,
    step(n, dt = 40) {
      for (let i = 0; i < n; i++) { now += dt; stepFrame(now); }
    },
    now() { return now; }
  };
}
function lastKind(style, kind) {
  for (let i = style.log.length - 1; i >= 0; i--) if (style.log[i].it.kind === kind) return style.log[i];
  return null;
}
function lastDust(style) { return lastKind(style, "dust"); }

/** 改造前投影公式（独立实现，逐位比对用；fov = 引擎缺省 60）。 */
function oldProject(cam, p, w, h) {
  let v = [p[0] - cam.target[0], p[1] - cam.target[1], p[2] - cam.target[2]];
  const cy = Math.cos(-cam.yaw), sy = Math.sin(-cam.yaw);
  v = [v[0] * cy + v[2] * sy, v[1], -v[0] * sy + v[2] * cy];
  const cx = Math.cos(-cam.pitch), sx = Math.sin(-cam.pitch);
  v = [v[0], v[1] * cx - v[2] * sx, v[1] * sx + v[2] * cx];
  const vz = v[2] + cam.dist;
  const f = (h * 1.1) / (2 * Math.tan((cam.fov ?? 60) * Math.PI / 360));
  const s = f / vz;
  return { x: w / 2 + v[0] * s, y: h / 2 - v[1] * s, s: s, z: vz };
}

/** 反投影：求「中心恰好落在屏幕 x = screenX、y = 屏心」的世界坐标（相机默认视角）。 */
const DEFAULT_CAM = { target: [0, 0, 0], yaw: -0.7, pitch: 0.5, dist: 430, fov: 60 };
function worldAtScreenX(screenX) {
  const f = (H * 1.1) / (2 * Math.tan(DEFAULT_CAM.fov * Math.PI / 360));
  const s = f / DEFAULT_CAM.dist;
  const x1 = (screenX - W / 2) / s;
  /* rotX/rotY 逆变换（与引擎 project 的 -yaw/-pitch 正变换互逆）。 */
  const a = DEFAULT_CAM.pitch, b = DEFAULT_CAM.yaw;
  const ca = Math.cos(a), sa = Math.sin(a);
  const v2 = [x1, 0, 0];
  const v1y = v2[1] * ca - v2[2] * sa;
  const v1z = v2[1] * sa + v2[2] * ca;
  const cb = Math.cos(b), sb = Math.sin(b);
  return [v2[0] * cb + v1z * sb, v1y, -v2[0] * sb + v1z * cb];
}

/* ── 1. 预算常量与均摊纯函数（1.1/1.2） ── */

assert.equal(NEBULA_BUDGET, 4000, "全局尘埃预算初值（引擎级常量，真机校准点）");
assert.equal(NEBULA_DUST_FLOOR, 60, "均摊保底下限初值");
assert.ok(NEBULA_CULL_MARGIN >= 16, "视口剔除基础余量 ≥ 16px（覆盖粒子渲染色）");
assert.equal(dustPerWsOf(0), 0, "无尘埃星座 → 0");
assert.equal(dustPerWsOf(-3), 0, "非法 n → 0（防御）");
assert.equal(dustPerWsOf(1), NEBULA_BUDGET, "单星座：预算全额");
assert.equal(dustPerWsOf(40), 100, "40 星座均摊 = floor(4000/40)");
assert.equal(dustPerWsOf(30), 133, "30 星座均摊 = floor(4000/30)");
assert.equal(dustPerWsOf(67), NEBULA_DUST_FLOOR, "67 星座：floor < 下限 → 取下限（接受超卖）");
/* 预算有效性：n ≤ floor(预算/下限) 时总粒数严格 ≤ 预算。 */
for (let n = 1; n <= Math.floor(NEBULA_BUDGET / NEBULA_DUST_FLOOR); n++) {
  assert.ok(n * dustPerWsOf(n) <= NEBULA_BUDGET, "n=" + n + "：总粒数不超预算");
  assert.ok(dustPerWsOf(n) >= NEBULA_DUST_FLOOR, "n=" + n + "：不低于保底下限");
}

/* ── 2. 零分配投影基建（3.1/3.3） ── */

{
  const cams = [
    { target: [0, 0, 0], yaw: -0.7, pitch: 0.5, dist: 430, fov: 60 },
    { target: [12, -30, 8], yaw: 1.31, pitch: -0.22, dist: 120, fov: 60 },
    { target: [-500, 40, 900], yaw: 0, pitch: 0, dist: 2000, fov: 60 }
  ];
  const points = [
    [0, 0, 0], [10, 5, -20], [-300, 40, 120], [0.5, -0.25, 0.125], [1000, -800, 600]
  ];
  const out = { x: 0, y: 0, s: 0, z: 0 };
  const snapshot = (o) => ({ x: o.x, y: o.y, s: o.s, z: o.z });

  /* 2.1 与改造前公式逐位一致（标量推导同运算顺序）；近平面外一致返回 false。 */
  for (const cam of cams) {
    for (const p of points) {
      const ref = oldProject(cam, p, W, H);
      if (ref.z < 12) {
        assert.equal(projectInto(cam, p, W, H, out), false, "近平面外（z=" + ref.z.toFixed(2) + "）→ false");
        continue;
      }
      assert.equal(projectInto(cam, p, W, H, out), true, "可见点投影成功");
      assert.deepEqual(snapshot(out), { x: ref.x, y: ref.y, s: ref.s, z: ref.z }, "投影逐位一致（cam=" + cam.dist + "）");
    }
  }

  /* 2.2 同参数连续两次 → 逐位一致（scratch 无脏读）。 */
  const camA = cams[0], pA = points[1];
  assert.equal(projectInto(camA, pA, W, H, out), true);
  const first = snapshot(out);
  assert.equal(projectInto(camA, pA, W, H, out), true);
  assert.deepEqual(snapshot(out), first, "连续两次同参数投影逐位一致");

  /* 2.3 交叉投影（A → B → A）不污染：B 投影后 A 结果仍同值。 */
  assert.equal(projectInto(camA, points[2], W, H, out), true);
  const mid = snapshot(out);
  assert.notDeepEqual(mid, first, "不同点投影结果不同（对照组）");
  assert.equal(projectInto(camA, pA, W, H, out), true);
  assert.deepEqual(snapshot(out), first, "交叉投影后 A 点结果不脏（模块级 scratch 无残留）");

  /* 2.4 槽位身份：返回 boolean、结果直写调用方对象（零分配结构证明）。 */
  const slot = { x: 0, y: 0, s: 0, z: 0 };
  const ret = projectInto(camA, pA, W, H, slot);
  assert.equal(typeof ret, "boolean", "projectInto 返回布尔（不产结果对象）");
  assert.equal(projectIntoXYZ(camA, pA[0], pA[1], pA[2], W, H, slot), true, "标量版可用");
  assert.deepEqual(snapshot(slot), first, "标量版与数组版同值");

  /* 2.5 近平面：vz < 12 → false 且槽位不被改写。 */
  const behind = { x: 7, y: 8, s: 9, z: 10 };
  const camBehind = { target: [0, 0, 0], yaw: 0, pitch: 0, dist: 1, fov: 60 };
  assert.equal(projectInto(camBehind, [0, 0, -100], W, H, behind), false, "近平面外（相机身后）→ false");
  assert.deepEqual(behind, { x: 7, y: 8, s: 9, z: 10 }, "失败投影不改写槽位");
}

/* ── 3. 预算不触发：与改造前行为逐位一致（1.4） ── */

{
  const data = sceneOf([wsOf(0, 2, 0)]);
  const pure = buildScenePure(data, new Map(), new Map());
  const style = spyStyle();
  const run = bootEngine(data, style);
  run.step(80); // 3.2s：序曲 1.2s + 单 ws 坡道 0.5s 已过 → α = 1
  const dust = lastDust(style);
  const t = dust.t;
  assert.ok(dust, "稳态帧产出尘埃条目");
  assert.equal(dust.it.pts.length, 110, "archives=2 → 110 粒全部渲染（预算不触发）");
  assert.ok(Math.abs(dust.it.alpha - 1) < 1e-12, "稳态 ws.alpha = 1");

  const cam = run.engine.getCamera();
  const ws = pure.ws[0];
  const R = 12 + ws.archives * 2.4;
  for (let i = 0; i < ws.dust.length; i++) {
    const d = ws.dust[i];
    const ref = oldProject(cam, [ws.center[0] + d.off[0] * R, ws.center[1] + d.off[1] * R, ws.center[2] + d.off[2] * R], W, H);
    const pt = dust.it.pts[i];
    assert.equal(pt.x, ref.x, "第 " + i + " 粒 x 逐位一致");
    assert.equal(pt.y, ref.y, "第 " + i + " 粒 y 逐位一致");
    assert.equal(pt.s, d.s * ref.s * 3, "第 " + i + " 粒屏显尺寸一致");
    const expectA = 1 * (NEBULA_ALPHA_BASE + NEBULA_ALPHA_SWING * (0.5 + 0.5 * Math.sin(t * 1.3 + d.tw)));
    assert.equal(pt.a, expectA, "第 " + i + " 粒 α 与基带公式一致");
    assert.equal(pt.hue, d.hue, "第 " + i + " 粒 hue 透传");
  }
  /* 预算只裁渲染前缀，不改数据面（ws.dust / dustCount 不变）。 */
  assert.equal(dust.it.ws.dust.length, 110, "渲染裁剪 MUST NOT 改 ws.dust 数据");
  assert.equal(dust.it.ws.dustCount, 110, "ws.dustCount 不变");
  run.engine.stop();
  run.engine.dispose();
  rafQ.length = 0;
}

/* ── 4. 预算封顶均摊 + 前缀裁剪确定性（1.2/1.3） ── */

/** 40 星座满归档（archives=10 → 520 粒/星座，总 20800 粒）。 */
const BIG = sceneOf(Array.from({ length: 40 }, (_, i) => wsOf(i, 10, i * 8 - 156)));
const bigPure = buildScenePure(BIG, new Map(), new Map());
let bigRun = null;
let bigStyle = null;
let bigCam = null;
let bigT = 0;
{
  const style = spyStyle();
  const run = bootEngine(BIG, style);
  run.step(130); // 5.2s：40 星座错峰（39×0.1s）+ 单 ws 坡道全部过完
  bigRun = run; bigStyle = style; bigCam = run.engine.getCamera();
  const dust = lastDust(style);
  bigT = dust.t;
  assert.ok(dust, "40 星座场景产出尘埃条目");

  /* 收集本帧全部尘埃条目（每星座一条） */
  const perWs = new Map();
  for (const entry of style.log) {
    if (entry.t !== dust.t || entry.it.kind !== "dust") continue;
    perWs.set(entry.it.ws.id, entry.it);
  }
  assert.equal(perWs.size, 40, "40 个星座各产出尘埃条目");
  const limit = dustPerWsOf(40);
  assert.equal(limit, 100, "均摊上限 = floor(4000/40) = 100");
  let total = 0;
  for (const [id, it] of perWs) {
    assert.equal(it.pts.length, limit, id + "：预算触发 → 裁剪到 100 粒前缀");
    assert.equal(it.ws.dust.length, 520, id + "：数据面仍 520 粒（渲染期前缀裁剪）");
    total += it.pts.length;
  }
  assert.equal(total, NEBULA_BUDGET, "渲染尘埃总粒数恰为预算上限（≤ 预算断言成立）");

  /* 前缀性：pts 前 100 个槽位 = 种子流前 100 粒的投影（无重排、无取样偏移）。 */
  const ws0 = bigPure.ws[0];
  const R = 12 + ws0.archives * 2.4;
  const it0 = perWs.get("ws-0");
  for (let i = 0; i < limit; i++) {
    const d = ws0.dust[i];
    const ref = oldProject(bigCam, [ws0.center[0] + d.off[0] * R, ws0.center[1] + d.off[1] * R, ws0.center[2] + d.off[2] * R], W, H);
    assert.equal(it0.pts[i].x, ref.x, "前缀第 " + i + " 粒 = 种子流第 " + i + " 粒（原位）");
    assert.equal(it0.pts[i].y, ref.y, "前缀第 " + i + " 粒 = 种子流第 " + i + " 粒（原位 y）");
  }
}

/* 4.1 前缀确定性：星座数 40 → 30（k 100 → 133）时存量前 100 粒逐位不变。 */
{
  const SMALL = sceneOf(Array.from({ length: 30 }, (_, i) => wsOf(i, 10, i * 8 - 156)));
  const style = spyStyle();
  const run = bootEngine(SMALL, style);
  run.step(130);
  const dust = lastDust(style);
  const it0 = (function () {
    for (let i = style.log.length - 1; i >= 0; i--) {
      if (style.log[i].t === dust.t && style.log[i].it.kind === "dust" && style.log[i].it.ws.id === "ws-0") return style.log[i].it;
    }
    return null;
  })();
  assert.ok(it0, "30 星座场景 ws-0 尘埃条目在册");
  assert.equal(it0.pts.length, dustPerWsOf(30), "30 星座 → 133 粒前缀");
  /* 与 40 星座场景（前 100 粒）逐位比对。 */
  for (const entry of bigStyle.log) {
    if (entry.t !== bigT || entry.it.kind !== "dust" || entry.it.ws.id !== "ws-0") continue;
    const prev = entry.it.pts;
    assert.equal(prev.length, 100, "对照帧前缀长度 100");
    for (let i = 0; i < prev.length; i++) {
      assert.equal(it0.pts[i].x, prev[i].x, "存量第 " + i + " 粒 x 零跳变（40↔30 星座）");
      assert.equal(it0.pts[i].y, prev[i].y, "存量第 " + i + " 粒 y 零跳变（40↔30 星座）");
    }
    break;
  }
  run.engine.stop();
  run.engine.dispose();
  rafQ.length = 0;
}

/* ── 5. 视口剔除（2.1/2.2） ── */

/* 5.1 完全离屏星座：不产尘埃条目（不投影不绘制）。 */
{
  const style = spyStyle();
  const run = bootEngine(sceneOf([wsOf(0, 2, 20000)]), style);
  run.step(80);
  assert.equal(lastDust(style), null, "完全离屏的星座不产尘埃条目");
  run.engine.stop();
  run.engine.dispose();
  rafQ.length = 0;
}

/* 5.2 画界穿越的星座：屏外不绘、屏内全绘、余量内坐标有界。 */
{
  const edgePos = worldAtScreenX(W + 10); // 星云中心落在右缘外 ≈10px（默认镜头）
  const EDGE = sceneOf([Object.assign(wsOf(0, 2, 0), { pos: edgePos })]);
  const style = spyStyle();
  const run = bootEngine(EDGE, style);
  run.step(80);
  const dust = lastDust(style);
  assert.ok(dust, "跨界星座产出尘埃条目（部分屏内）");
  const cam = run.engine.getCamera();
  const pure = buildScenePure(EDGE, new Map(), new Map());
  const ws = pure.ws[0];
  const R = 12 + ws.archives * 2.4;
  assert.ok(dust.it.pts.length > 0 && dust.it.pts.length < 110, "部分粒子被剔除（" + dust.it.pts.length + "/110）");
  /* 剔除边界：每个绘制点都满足 |center| ≤ 基础余量 + 自身屏显尺寸。 */
  for (const pt of dust.it.pts) {
    const pad = NEBULA_CULL_MARGIN + pt.s;
    assert.ok(pt.x >= -pad && pt.x <= W + pad && pt.y >= -pad && pt.y <= H + pad, "绘制点不越出剔除余量");
  }
  /* 屏内粒子一个不落（像素级零差异）。 */
  const drawn = new Set(dust.it.pts.map((p) => p.x.toFixed(6) + "|" + p.y.toFixed(6)));
  let onScreen = 0;
  for (const d of ws.dust) {
    const pr = oldProject(cam, [ws.center[0] + d.off[0] * R, ws.center[1] + d.off[1] * R, ws.center[2] + d.off[2] * R], W, H);
    if (pr.x >= 0 && pr.x <= W && pr.y >= 0 && pr.y <= H) {
      onScreen += 1;
      assert.ok(drawn.has(pr.x.toFixed(6) + "|" + pr.y.toFixed(6)), "屏内粒子必须绘制（无缺失/闪烁）");
    }
  }
  assert.ok(onScreen > 0, "跨界场景确有屏内粒子（对照组有效）");
  run.engine.stop();
  run.engine.dispose();
  rafQ.length = 0;
}

/* 5.3 快速平移扫掠：逐帧校验「屏内粒子全在 + 屏外不越界」，无进出闪烁。 */
{
  const style = spyStyle();
  const run = bootEngine(sceneOf([wsOf(0, 4, 0)]), style); // archives=4 → 220 粒
  run.step(80);
  const pure = buildScenePure(sceneOf([wsOf(0, 4, 0)]), new Map(), new Map());
  const ws = pure.ws[0];
  const R = 12 + ws.archives * 2.4;
  const keydown = function (code) {
    for (const fn of windowListeners.keydown) {
      fn({ code, key: code, repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false, preventDefault() {} });
    }
  };
  keydown("KeyD"); // 按住 D → 相机 target 持续右移（场景相对左移，穿越画界）
  let crossedFrames = 0;
  let totalOnScreen = 0;
  for (let f = 0; f < 70; f++) {
    run.step(1, 16);
    const dust = lastDust(style);
    assert.ok(dust, "扫掠过程持续产出尘埃条目");
    const cam = run.engine.getCamera();
    const drawn = new Set(dust.it.pts.map((p) => p.x.toFixed(6) + "|" + p.y.toFixed(6)));
    let anyIn = false;
    for (const d of ws.dust) {
      const pr = oldProject(cam, [ws.center[0] + d.off[0] * R, ws.center[1] + d.off[1] * R, ws.center[2] + d.off[2] * R], W, H);
      if (pr.x >= 0 && pr.x <= W && pr.y >= 0 && pr.y <= H) {
        anyIn = true;
        totalOnScreen += 1;
        assert.ok(drawn.has(pr.x.toFixed(6) + "|" + pr.y.toFixed(6)), "扫掠第 " + f + " 帧：屏内粒子必须绘制");
      }
    }
    if (anyIn) crossedFrames += 1;
    for (const pt of dust.it.pts) {
      const pad = NEBULA_CULL_MARGIN + pt.s;
      assert.ok(pt.x >= -pad && pt.x <= W + pad && pt.y >= -pad && pt.y <= H + pad, "扫掠第 " + f + " 帧：绘制点有界");
    }
  }
  assert.ok(crossedFrames > 10, "扫掠确有屏内帧（" + crossedFrames + " 帧）");
  assert.ok(totalOnScreen > 500, "屏内粒子累计样本充足（" + totalOnScreen + "）");
  keydown("KeyD"); // 松开（keyup 清理路径同源；此处仅显式成对）
  for (const fn of windowListeners.keyup) {
    fn({ code: "KeyD", key: "d", repeat: false, preventDefault() {} });
  }
  run.engine.stop();
  run.engine.dispose();
  rafQ.length = 0;
}

/* ── 6. 背景星 / 银河带剔除与槽位复用（3.2 附带收益） ── */

{
  const style = spyStyle(true); // useBand=true → 银河带参与
  const run = bootEngine(sceneOf([wsOf(0, 1, 0)]), style);
  run.step(10);
  const v0 = style.views[style.views.length - 1];
  assert.ok(v0.bgStars.length > 0 && v0.bgStars.length <= 420, "背景星剔除后数量有界");
  assert.ok(v0.band && v0.band.length <= 2600, "银河带剔除后数量有界");
  const bg0 = v0.bgStars;
  const band0 = v0.band;
  const slot0 = bg0[0];
  run.step(1);
  const v1 = style.views[style.views.length - 1];
  assert.equal(v1, v0, "view 对象跨帧复用（零容器分配）");
  assert.equal(v1.bgStars, bg0, "背景星数组跨帧复用");
  assert.equal(v1.band, band0, "银河带数组跨帧复用");
  assert.equal(v1.bgStars[0], slot0, "背景星逐点槽位跨帧复用");
  for (const b of v1.bgStars) {
    assert.ok(b.x >= -NEBULA_CULL_MARGIN - 4 && b.x <= W + NEBULA_CULL_MARGIN + 4, "背景星绘制点有界（x）");
  }
  run.engine.stop();
  run.engine.dispose();
  rafQ.length = 0;
}

/* ── 7. 条目结构槽位复用 + E.screens 陈旧键清理（3.2/3.4） ── */

{
  const data = sceneOf([wsOf(0, 2, 0, { planet: true, comet: true })]);
  const style = spyStyle();
  const run = bootEngine(data, style);
  run.step(80);
  let dust = lastDust(style);
  const pts = dust.it.pts;
  const pt0 = pts[0];
  const proj0 = dust.it.ws.proj;
  const orbit = lastKind(style, "orbit");
  const planet = lastKind(style, "planet");
  assert.ok(orbit && planet, "轨道/行星条目在册");
  const orbitPts = orbit.it.orbitPts;
  const orbitSlot = orbitPts[0];
  const trail = planet.it.trail;
  /* 稳定运行两帧（无相位翻转）后对比对象身份。 */
  run.step(1);
  dust = lastDust(style);
  assert.equal(dust.it.pts, pts, "尘埃 pts 数组跨帧复用");
  assert.equal(dust.it.pts[0], pt0, "尘埃逐粒槽位跨帧复用");
  assert.equal(dust.it.ws.proj, proj0, "ws.proj 投影槽位跨帧复用");
  assert.equal(lastKind(style, "orbit").it.orbitPts, orbitPts, "轨道点数组跨帧复用");
  assert.equal(lastKind(style, "orbit").it.orbitPts[0], orbitSlot, "轨道点槽位跨帧复用");
  assert.equal(lastKind(style, "planet").it.trail, trail, "行星尾迹数组跨帧复用");

  /* 屏幕坐标：键集合在册；场景移除行星/彗星后陈旧键被帧末清理。 */
  let screens = run.engine.inspectScreens();
  assert.ok(screens["star:star-0"], "恒星屏幕坐标在册");
  assert.ok(screens["planet:p-0"], "行星屏幕坐标在册");
  assert.ok(screens["comet:c-0"], "彗星屏幕坐标在册");
  const starScr = screens["star:star-0"];
  run.step(1);
  assert.deepEqual(run.engine.inspectScreens()["star:star-0"], starScr, "同一天体屏幕坐标跨帧稳定");
  /* 结构重建：只留恒星（行星/彗星消失）。 */
  run.engine.setScene(sceneOf([wsOf(0, 2, 0)]), "rebuild");
  run.step(2);
  screens = run.engine.inspectScreens();
  assert.ok(screens["star:star-0"], "恒星坐标仍在");
  assert.equal(screens["planet:p-0"], undefined, "消失行星的屏幕坐标键被清理（无陈旧坐标）");
  assert.equal(screens["comet:c-0"], undefined, "消失彗星的屏幕坐标键被清理（无陈旧坐标）");
  run.engine.stop();
  run.engine.dispose();
  rafQ.length = 0;
}

/* ── 8. 共享尘埃原语：12 套皮肤（4.1–4.3） ── */

/* 8.1 sprite 缓存：同键同对象、异形/异色/异旋转档互异。 */
{
  const brush = makeDustSprite();
  const dot = brush.sprite("#ff0000", "dot");
  assert.equal(brush.sprite("#ff0000", "dot"), dot, "同键 sprite 缓存复用（逐帧零创建）");
  assert.notEqual(brush.sprite("#00ff00", "dot"), dot, "异色 sprite 独立");
  assert.notEqual(brush.sprite("#ff0000", "square"), dot, "异形 sprite 独立");
  const petals = new Set();
  for (let b = 0; b < 8; b++) petals.add(brush.sprite("#ff0000", "petal", b));
  assert.equal(petals.size, 8, "荷瓣 8 个旋转档各一 sprite");
  const brush2 = makeDustSprite();
  assert.notEqual(brush2.sprite("#ff0000", "dot"), dot, "每皮肤实例独立缓存（防跨皮肤串色）");
}

/* 8.2 原语行为：空/不可见点零 ctx 调用；born 坡道；合成模式声明。 */
{
  const brush = makeDustSprite();
  const ops = [];
  const composites = [];
  const ctx = new Proxy({ globalAlpha: 1 }, {
    get(t, prop) {
      if (prop === "drawImage") return () => ops.push({ op: "drawImage", a: t.globalAlpha });
      if (prop === "fill" || prop === "fillRect") return () => ops.push({ op: prop, a: t.globalAlpha });
      if (!(prop in t)) t[prop] = () => undefined;
      return t[prop];
    },
    set(t, prop, value) {
      if (prop === "globalCompositeOperation") composites.push(value);
      t[prop] = value;
      return true;
    }
  });
  dustBatchDraw(brush, ctx, [], ["#fff"], 0, {});
  assert.equal(ops.length, 0, "空 pts → 零 ctx 调用（器皿守卫残余口径）");
  dustBatchDraw(brush, ctx, [{ x: 1, y: 1, s: 2, a: 0, hue: 0.1, born: null }], ["#fff"], 0, {});
  assert.equal(ops.length, 0, "α=0 → 不绘制");
  dustBatchDraw(brush, ctx, [
    { x: 1, y: 1, s: 2, a: 0.4, hue: 0.1, born: 0 },
    { x: 2, y: 2, s: 2, a: 0.4, hue: 0.2, born: null }
  ], ["#fff"], 0.2, { composite: "lighter" });
  assert.equal(ops.length, 2, "两点各一次 drawImage");
  assert.equal(ops[0].a, 0.4 * (0.2 / 0.8), "born 坡道 0.8s 线性生效（t=0.2 → 0.25）");
  assert.equal(ops[1].a, 0.4, "存量粒子（born=null）恒 1");
  assert.deepEqual(composites, ["lighter"], "合成模式显式声明（save/restore 一次）");
}

/* 8.3 12 套皮肤 dust 分支：共享原语（drawImage ≥ 粒数）、合成模式、born 坡道。 */
{
  function dustRecorder() {
    const rec = { ops: [], composites: [] };
    const ctx = new Proxy({ globalAlpha: 1 }, {
      get(t, prop) {
        if (prop === "drawImage") return (spr) => rec.ops.push({ op: "drawImage", a: t.globalAlpha, spr });
        if (prop === "arc") return () => rec.ops.push({ op: "arc", a: t.globalAlpha });
        if (prop === "fill" || prop === "fillRect") return () => rec.ops.push({ op: prop, a: t.globalAlpha });
        if (!(prop in t)) t[prop] = () => undefined;
        return t[prop];
      },
      set(t, prop, value) {
        if (prop === "globalCompositeOperation") rec.composites.push(value);
        t[prop] = value;
        return true;
      }
    });
    return { ctx, rec };
  }
  const LIGHTER_SKINS = new Set(["deepspace", "rosepine", "linear", "obsidian"]);
  const N = 50;
  const pts = [];
  for (let i = 0; i < N; i++) pts.push({ x: 10 + i, y: 20, s: 2, hue: (i % 10) / 10, a: 0.2, born: 0 });
  for (const entry of COSMOS_SKINS) {
    const skin = createSkin(entry.id);
    const { ctx, rec } = dustRecorder();
    skin.drawBody(ctx, { kind: "dust", z: 0, pts, ws: null, alpha: 1 }, { t: 0.4, W, H });
    const draws = rec.ops.filter((o) => o.op === "drawImage");
    assert.ok(draws.length >= N, entry.id + "：逐粒经共享原语 drawImage（" + draws.length + "/" + N + "）");
    const arcs = rec.ops.filter((o) => o.op === "arc").length;
    assert.ok(arcs < N, entry.id + "：主质量不走逐粒 arc 路径（arc=" + arcs + "）");
    const pathFills = rec.ops.filter((o) => o.op === "fill").length;
    assert.ok(pathFills < N, entry.id + "：主质量不走逐粒 fill 路径（fill=" + pathFills + "）");
    const hasLighter = rec.composites.includes("lighter");
    assert.equal(hasLighter, LIGHTER_SKINS.has(entry.id),
      entry.id + "：合成模式保持现状（" + (LIGHTER_SKINS.has(entry.id) ? "深空系 lighter" : "非 lighter") + "）");
    /* born 坡道：同批次粒子在 t=0.4（bornK=0.5）与 t=0.8（bornK=1）的 α 成 2 倍关系。 */
    const { ctx: ctx2, rec: rec2 } = dustRecorder();
    skin.drawBody(ctx2, { kind: "dust", z: 0, pts, ws: null, alpha: 1 }, { t: 0.8, W, H });
    const draws2 = rec2.ops.filter((o) => o.op === "drawImage");
    assert.equal(draws2.length, draws.length, entry.id + "：同批粒子两次绘制数量一致");
    const maxA1 = Math.max(...draws.map((o) => o.a));
    const maxA2 = Math.max(...draws2.map((o) => o.a));
    assert.ok(maxA1 > 0, entry.id + "：born 粒子可绘制");
    assert.ok(Math.abs(maxA2 / maxA1 - 2) < 1e-9,
      entry.id + "：born 坡道 0.8s 线性（t=0.4/0.8 α 比 ≈ 2，实测 " + (maxA2 / maxA1).toFixed(6) + "）");
  }
  /* light 皮肤（fidenza）MUST NOT 引入 lighter：单独反断言（spec 明文）。 */
  const light = createSkin("fidenza");
  const rec = dustRecorder();
  light.drawBody(rec.ctx, { kind: "dust", z: 0, pts, ws: null, alpha: 1 }, { t: 0.4, W, H });
  assert.equal(rec.rec.composites.includes("lighter"), false, "纸面皮肤 dust 分支无 lighter 加色");
  /* 绘制结果为 sprite canvas（缓存对象），非路径填充。 */
  assert.ok(rec.rec.ops.some((o) => o.op === "drawImage" && o.spr && typeof o.spr.getContext === "function"), "drawImage 参数为缓存 sprite");
}

console.log("render-budget-smoke: all assertions passed");
