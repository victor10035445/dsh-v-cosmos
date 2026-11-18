/**
 * 场景规模渲染预算压测（add-cosmos-render-budget 5.2；**手动运行**，不进 npm test）。
 *
 * 两种口径：
 *  - **引擎帧成本**：40 星座 × archives=10（每星座 520 粒、总 20800 粒）+ 每星座 1 行星，
 *    在无头 Canvas2D 桩上跑帧循环（皮肤 background/drawBody 为 no-op，隔离引擎侧成本：
 *    投影 + 条目装配 + 场景更新）。对比改造前引擎（可选基线树）与当前引擎；
 *  - **皮肤尘埃绘制成本**：4000 粒尘埃条目 × 200 次 drawBody（隔离皮肤侧成本：
 *    旧逐粒 arc/fillRect vs 新共享 sprite 原语）。注意无头桩只测 JS 侧开销，
 *    Canvas2D 真实光栅化成本需真机核对（本脚本不承诺 GPU/光栅化数值）。
 *
 * 运行：
 *   node --expose-gc test/render-budget-bench.mjs
 *   COSMOS_BASELINE=<改造前源码树 src 目录> node --expose-gc test/render-budget-bench.mjs
 *
 * 基线树取法（示例，构造改造前版本）：
 *   git show HEAD:src/cosmos/engine.mjs > <base>/src/cosmos/engine.mjs ...
 *   本仓库基线 = git HEAD（大改造前的已提交引擎）；walkthrough 记录实测口径。
 */
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { PerformanceObserver } from "node:perf_hooks";

/* ── DOM / raf 桩 ── */
function stubCtx() {
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
        const child = stubEl(sel === ".cos-canvas" || sel === ".cos-tiplines" ? "canvas" : "div");
        if (child.tag === "canvas") child.getContext = () => stubCtx();
        el._by[sel] = child;
      }
      return el._by[sel];
    },
    addEventListener() {},
    removeEventListener() {},
    setAttribute(k, v) { el.attrs[k] = v; },
    getAttribute(k) { return k in el.attrs ? el.attrs[k] : null; },
    setPointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 })
  };
  el.classList = classListOf(el);
  return el;
}
let clock = 0;
const rafQ = [];
globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
globalThis.document = {
  createElement(t) { const el = stubEl(t); if (t === "canvas") el.getContext = () => stubCtx(); return el; },
  addEventListener() {}, removeEventListener() {},
  hidden: false, activeElement: null, head: { appendChild() {} }
};
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
globalThis.requestAnimationFrame = (cb) => { rafQ.push(cb); return rafQ.length; };
globalThis.cancelAnimationFrame = () => {};
globalThis.performance = { now: () => clock };

function stepOnce(dtMs) {
  clock += dtMs;
  const cb = rafQ.shift();
  if (!cb) throw new Error("bench: 帧回调缺失");
  cb(clock);
}

/* ── 场景夹具：40 星座 × archives=10（520 粒）+ 1 行星 ── */
function bigScene() {
  const workspaces = [];
  for (let i = 0; i < 40; i++) {
    workspaces.push({
      id: "ws-" + i, name: "ws-" + i, pos: [i * 8 - 156, 0, 0],
      stars: [{ id: "star-" + i, name: "star-" + i, lifecycle: "executed", setBy: null, at: null, tasks: [1, 1], age: "刚刚", act: 0, off: [6, 0, 0] }],
      links: [],
      planets: [{ id: "p-" + i, title: "p", state: "idle", pendingKind: null, stars: ["star-" + i], todos: "—", when: "刚刚", satellites: [], satelliteCount: 0, delegatedBusy: false }],
      comets: [],
      archives: 10, satelliteCount: 0
    });
  }
  return { workspaces };
}

function noopStyle() {
  return {
    skin: "bench", useBand: false,
    palette: { prop: { proto: "#8a9bc0", created: "#9fd8ff", reviewed: "#cfe8ff", executed: "#ffe27a" }, sess: { idle: "#a8b8d8", busy: "#54c8ff", waiting: "#ffaa4a", "done-unread": "#5affc0", free: "#cfeaff" } },
    gold: "#ffd28a", dustColors: ["#5a6ea0", "#7a6ea0"], bgStarColor: () => "#fff",
    background() {}, drawBody() {}
  };
}

function pct(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}
function fmt(v, digits = 2) { return v.toFixed(digits); }

/* ── 引擎帧成本 ── */
async function benchEngine(moduleUrl, label) {
  const mod = await import(moduleUrl);
  rafQ.length = 0;
  clock = 0;
  const engine = mod.createCosmosEngine({ container: stubEl("div"), style: noopStyle() });
  engine.setScene(bigScene(), "rebuild");
  engine.start();
  for (let i = 0; i < 40; i++) { stepOnce(16); await new Promise((r) => setImmediate(r)); } // 预热
  const FRAMES = 120;
  const times = [];
  let minorGC = 0, majorGC = 0, gcMs = 0;
  const obs = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      const kind = e.detail?.kind ?? e.kind;
      if (kind === 1) minorGC += 1;
      else majorGC += 1;
      gcMs += e.duration;
    }
  });
  try { obs.observe({ entryTypes: ["gc"] }); } catch { /* 旧 Node 无 gc entry */ }
  for (let i = 0; i < FRAMES; i++) {
    const t0 = process.hrtime.bigint();
    stepOnce(16);
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    await new Promise((r) => setImmediate(r)); // 让 GC 观测回调落地（不影响帧内耗时口径）
  }
  obs.disconnect();
  engine.stop();
  engine.dispose();
  rafQ.length = 0;
  const sorted = [...times].sort((a, b) => a - b);
  return {
    label,
    avg: times.reduce((a, b) => a + b, 0) / times.length,
    p95: pct(sorted, 0.95),
    max: sorted[sorted.length - 1],
    minorGC,
    majorGC,
    gcMs
  };
}

/* ── 皮肤尘埃绘制成本 ── */
const DUST_N = 4000;
function dustPts() {
  const pts = [];
  for (let i = 0; i < DUST_N; i++) {
    pts.push({ x: (i * 37) % 800, y: (i * 53) % 600, s: 1 + (i % 5) * 0.4, a: 0.2, hue: (i % 10) / 10, born: null });
  }
  return pts;
}
function benchSkinDraw(skin, pts) {
  const ctx = stubCtx();
  const item = { kind: "dust", z: 0, pts, ws: null, alpha: 1 };
  const view = { t: 1.25, W: 800, H: 600 };
  for (let i = 0; i < 3; i++) skin.drawBody(ctx, item, view); // 预热（sprite 懒创建）
  const N = 200;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) skin.drawBody(ctx, item, view);
  return Number(process.hrtime.bigint() - t0) / 1e6 / N;
}

/* ── 主流程 ── */
const HERE = new URL("../src/cosmos/", import.meta.url);
const baselineRoot = process.env.COSMOS_BASELINE ?? null;
const currentEngine = new URL("engine.mjs", HERE).href;

console.log("== 引擎帧成本（40 星座 × 520 粒 + 40 行星；无头 Canvas2D 桩 / 120 帧）==");
const afterEngine = await benchEngine(currentEngine, "after");
const rows = [afterEngine];
if (baselineRoot) {
  const baseEngine = pathToFileURL(join(baselineRoot, "cosmos", "engine.mjs")).href;
  if (existsSync(join(baselineRoot, "cosmos", "engine.mjs"))) rows.unshift(await benchEngine(baseEngine, "before"));
  else console.log("未找到基线引擎：" + baseEngine);
}
for (const r of rows) {
  console.log(`  ${r.label.padEnd(7)} avg ${fmt(r.avg)}ms  p95 ${fmt(r.p95)}ms  max ${fmt(r.max)}ms  minorGC ${r.minorGC} 次  majorGC ${r.majorGC} 次  GC 暂停合计 ${fmt(r.gcMs)}ms`);
}
if (rows.length === 2) {
  console.log(`  → 帧均值 ${fmt(rows[0].avg)}ms → ${fmt(rows[1].avg)}ms（×${fmt(rows[0].avg / rows[1].avg)} 提升）`);
}

console.log("");
console.log("== 皮肤尘埃绘制成本（4000 粒 × 200 次 drawBody；无头桩只测 JS 侧）==");
const pts = dustPts();
const afterSkins = [];
{
  const { COSMOS_SKINS, createSkin } = await import(new URL("skin-registry.mjs", HERE).href);
  for (const entry of COSMOS_SKINS) afterSkins.push({ id: entry.id, ms: benchSkinDraw(createSkin(entry.id), pts) });
}
let beforeSkins = [];
if (baselineRoot && existsSync(join(baselineRoot, "cosmos", "skin-d.mjs"))) {
  const baseRoot = pathToFileURL(join(baselineRoot, "cosmos") + "/").href;
  const factories = {
    deepspace: async () => (await import(new URL("skin-d.mjs", baseRoot).href)).createSkinDeepspace(),
    rosepine: async () => (await import(new URL("skins/skin-rosepine.mjs", baseRoot).href)).createSkinRosepine(),
    linear: async () => (await import(new URL("skins/skin-linear.mjs", baseRoot).href)).createSkinLinear(),
    obsidian: async () => (await import(new URL("skins/skin-obsidian.mjs", baseRoot).href)).createSkinObsidian(),
    fidenza: async () => (await import(new URL("skins/skin-fidenza.mjs", baseRoot).href)).createSkinFidenza(),
    reagent: async () => (await import(new URL("skins/skin-reagent.mjs", baseRoot).href)).createSkinReagent(),
    chamber: async () => (await import(new URL("skins/skin-chamber.mjs", baseRoot).href)).createSkinChamber(),
    fluoro: async () => (await import(new URL("skins/skin-fluoro.mjs", baseRoot).href)).createSkinFluoro(),
    lotus: async () => (await import(new URL("skins/skin-lotus.mjs", baseRoot).href)).createSkinLotus(),
    migration: async () => (await import(new URL("skins/skin-migration.mjs", baseRoot).href)).createSkinMigration(),
    circuit: async () => (await import(new URL("skins/skin-circuit.mjs", baseRoot).href)).createSkinCircuit(),
    fermata: async () => (await import(new URL("skins/skin-fermata.mjs", baseRoot).href)).createSkinFermata()
  };
  for (const id of Object.keys(factories)) beforeSkins.push({ id, ms: benchSkinDraw(await factories[id](), pts) });
}
const beforeById = new Map(beforeSkins.map((s) => [s.id, s.ms]));
for (const s of afterSkins) {
  const before = beforeById.get(s.id);
  console.log(`  ${s.id.padEnd(11)} ${before != null ? fmt(before) + "ms → " : ""}${fmt(s.ms)}ms/次${before != null ? "（×" + fmt(before / s.ms) + "）" : ""}`);
}
const afterSum = afterSkins.reduce((a, s) => a + s.ms, 0);
if (beforeSkins.length) {
  const beforeSum = beforeSkins.reduce((a, s) => a + s.ms, 0);
  console.log(`  合计       ${fmt(beforeSum)}ms → ${fmt(afterSum)}ms（×${fmt(beforeSum / afterSum)}）`);
}
console.log("");
console.log("注：无头桩的 ctx 方法为 no-op，只反映 JS 侧路径/对象/状态机开销；Canvas2D 真实光栅化成本需真机核对。");
