/**
 * works-face-smoke — p2-add-cosmos-works-face 验收冒烟
 *
 * 覆盖（对照 openspec/changes/p2-add-cosmos-works-face/specs/cosmos-works-face/spec.md）：
 *  A. 模型纯函数：焦点投影（别名/显示名）/ 焦点形状几何（按类型虚线）/
 *     稳定布位（确定性、顺序无关、增量零位移）/ 多源融合波场
 *     （相长提前·相消滞后，MUST NOT 退化为独立包络并集）/ 等势线鞍部 / ASCII 坡 /
 *     粒子确定性可重放 / 皮肤取色色温分拣；
 *  B. 渲染核缓存：稳态同桶零重算、相位桶推进后才重算、ASCII ≤180ms 独立节拍；
 *  C. HUD 铬件：面切换按钮（单枚/图案随面/busy 忽略）、底部＋与编辑工具行、只读信息卡、
 *     作品编辑页（列表/别名/备注/定位/移除/Esc 让位）、
 *     系统文件选择器登记（取消静默/成功 toast/失败 toast/在途防重，无自建模态）；
 *  D. 引擎接线：面状态机（转场完成后翻面、Esc 短交叠、飞回银河静默复位、转场中忽略
 *     切换）、`∿N` 标牌计数、星场隐藏恒星提案名牌/卡片、属性级补丁、works 快照 pending 就位；
 *  E. 设置面：两键缺省/净房/版本顺延/zh-en 文案成对/设置页锚点。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  WORKS_FACE_LIMIT, WORKS_FACE_TRANSITION, WORKS_KIND_GLYPH, WORKS_FOCUS_SHAPE, focusShapePointsOf, WORKS_ASCII_RAMP,
  worksFocusListOf, worksSignatureOf, worksLayoutOf, placeWorksIncremental,
  worksHashOf, worksRng, worksRgba, worksMixHex,
  waveHeightAt, waveUnionAt, waveRevealAt, waveCrestAt,
  faceTransitionPlanOf, contourSegmentsOf, fieldHeightAt, asciiCellOf,
  buildGatherParticles, gatherParticleAt, focusColorOf, createWorksFace
} from "../src/cosmos/works-face.mjs";
import { createWorksFaceUI, WORKS_REASON_TEXT } from "../src/cosmos/works-face-ui.mjs";
import { createSkinD } from "../src/cosmos/skin-d.mjs";

/* ── DOM 桩（engine-smoke 同形紧凑版） ─────────────────────── */

function stubCtx2d() {
  const grad = { addColorStop() {} };
  const store = {};
  return new Proxy(store, {
    get(target, prop) {
      if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => grad;
      if (!(prop in target)) target[prop] = () => undefined;
      return target[prop];
    },
    set(target, prop, value) { target[prop] = value; return true; }
  });
}
let ctxFactory = stubCtx2d;

function classListOf(el) {
  const tokens = () => String(el.className).split(/\s+/).filter(Boolean);
  const write = (list) => { el.className = list.join(" "); };
  return {
    add(...names) { const list = tokens(); for (const n of names) if (n && !list.includes(n)) list.push(n); write(list); },
    remove(...names) { write(tokens().filter((n) => !names.includes(n))); },
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
    insertBefore(child) { el.children.unshift(child); return child; },
    remove() {},
    querySelector(sel) {
      if (!el._by[sel]) {
        const child = stubEl(sel === ".cos-canvas" || sel === ".cos-tiplines" ? "canvas" : "div");
        if (child.tag === "canvas") child.getContext = () => ctxFactory();
        el._by[sel] = child;
      }
      return el._by[sel];
    },
    addEventListener(type, fn) { (el.listeners[type] = el.listeners[type] || []).push(fn); },
    removeEventListener() {},
    setAttribute(k, v) { el.attrs[k] = v; },
    getAttribute(k) { return k in el.attrs ? el.attrs[k] : null; },
    removeAttribute(k) { delete el.attrs[k]; },
    setPointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 })
  };
  el.classList = classListOf(el);
  return el;
}

globalThis.window = {
  devicePixelRatio: 1,
  addEventListener() {},
  removeEventListener() {}
};
globalThis.document = {
  createElement(tag) {
    const el = stubEl(tag);
    if (tag === "canvas") el.getContext = () => ctxFactory();
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
function stepFrame(ms) {
  const cb = rafQ.shift();
  assert.ok(cb, "帧回调在队");
  cb(ms);
}

const { createCosmosEngine } = await import("../src/cosmos/engine.mjs");

/* ── 夹具 ─────────────────────────────────────────────────── */

function focusFixture(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: "w" + i,
    relPath: "tools/f" + i + (i % 2 ? ".md" : ".bat"),
    kind: i % 2 ? "md" : "exec",
    exists: i !== 2,
    addedAt: 1000 + i,
    lastLaunchedAt: i === 0 ? 2000 : 0,
    displayName: "作品" + i
  }));
}

function miniScene() {
  return {
    workspaces: [{
      id: "ws1", name: "ws-one", pos: [0, 0, 0],
      stars: [{ id: "add-a", name: "add-a", lifecycle: "executed", setBy: null, at: null, tasks: [1, 1], age: "刚刚", act: 0, off: [10, 0, 0] }],
      links: [],
      planets: [{ id: "p1", title: "planet", state: "idle", pendingKind: null, stars: ["add-a"], todos: "—", when: "刚刚", satellites: [], satelliteCount: 0, delegatedBusy: false }],
      comets: [{ id: "c1", title: "comet", state: "idle", pendingKind: null, when: "刚刚", satellites: [], satelliteCount: 0, delegatedBusy: false }],
      archives: 0, satelliteCount: 0
    }]
  };
}

/* ═══ A1. 焦点投影 ═══════════════════════════════════════════ */
{
  const list = worksFocusListOf([
    { id: "a", relPath: "tools\\build.bat", kind: "exec", exists: true },
    { id: "b", relPath: "docs/walkthrough.md", kind: "md", exists: false, name: "走查", note: "n" },
    { id: "c", relPath: "report.pdf", kind: "pdf" },
    { id: "", relPath: "x" },
    { id: "d", relPath: "x", kind: "weird", exists: true }
  ]);
  assert.equal(list.length, 4, "缺 id 条目丢弃");
  assert.equal(list[0].displayName, "build.bat", "显示名回落文件名");
  assert.equal(list[0].alias, null, "未设别名 → alias null");
  assert.equal(list[1].displayName, "走查", "name 覆盖");
  assert.equal(list[1].alias, "走查", "alias 投影 = 持久化 name");
  assert.equal(list[1].exists, false, "exists:false → 失谐");
  assert.equal(list[2].exists, true, "exists 缺席按存在");
  assert.equal(list[3].kind, "other", "kind 池外回落 other");
  assert.equal(WORKS_KIND_GLYPH.exec, "\u2699", "exec 字形 ⚙");
  assert.equal(WORKS_KIND_GLYPH.html, "\u25C8", "html 字形 ◈");
  assert.equal(WORKS_KIND_GLYPH.md, "\u25A4", "md 字形 ▤");
  assert.equal(WORKS_KIND_GLYPH.pdf, "\u25AF", "pdf 字形 ▯");
  /* 焦点形状（Focus Shape）：每类型一种虚线轮廓（不再把字形画在焦点上方） */
  assert.equal(WORKS_FOCUS_SHAPE.exec, "hexagon", "exec 六边形");
  assert.equal(WORKS_FOCUS_SHAPE.html, "diamond", "html 菱形");
  assert.equal(WORKS_FOCUS_SHAPE.md, "square", "md 方框");
  assert.equal(WORKS_FOCUS_SHAPE.pdf, "triangle", "pdf 三角");
  assert.equal(WORKS_FOCUS_SHAPE.other, "circle", "other 圆");
  const hex = focusShapePointsOf("exec", 100, 100, 10);
  assert.equal(hex.length, 6, "六边形 6 顶点");
  assert.ok(hex.every((p) => Math.abs(p.x - 100) <= 10.001 && Math.abs(p.y - 100) <= 10.001), "顶点以焦点为中心");
  assert.ok(Math.abs(hex[0].x - 100) < 0.001 && Math.abs(hex[0].y - 90) < 0.001, "exec 尖顶朝上");
  const diamond = focusShapePointsOf("html", 100, 100, 10);
  assert.equal(diamond.length, 4, "菱形 4 顶点");
  assert.ok(Math.abs(diamond[1].x - 110) < 0.001 && Math.abs(diamond[1].y - 100) < 0.001, "html 菱形右顶点");
  const square = focusShapePointsOf("md", 100, 100, 10);
  assert.equal(square.length, 4, "方框 4 顶点");
  assert.ok(Math.abs(square[0].x - 107.071) < 0.01 && Math.abs(square[0].y - 92.929) < 0.01, "md 轴对齐方框角点");
  assert.equal(focusShapePointsOf("pdf", 100, 100, 10).length, 3, "pdf 三角 3 顶点");
  assert.equal(focusShapePointsOf("other", 100, 100, 10).length, 0, "other 圆走 arc（无顶点）");
  /* 绘制链内部传形状名（diamond）而非 kind（html）；必须同样解析（回归：曾二次映射回落圆）。 */
  assert.equal(focusShapePointsOf("diamond", 100, 100, 10).length, 4, "形状名 diamond 可直接解析");
  assert.equal(focusShapePointsOf("hexagon", 100, 100, 10).length, 6, "形状名 hexagon 可直接解析");
  assert.equal(WORKS_FACE_LIMIT, 32, "每星座 32 条上限（呈现层镜像）");
  assert.equal(worksRgba("#ff0000", 0.5), "rgba(255,0,0,0.500)", "rgba 工具");
  assert.equal(worksMixHex("#000000", "#ffffff", 0.5), "#808080", "粒子捕获混色");
}

/* ═══ A2. 稳定布位 ═══════════════════════════════════════════ */
{
  const entries = focusFixture(8);
  const wall = process.hrtime.bigint();
  const l1 = worksLayoutOf(entries);
  const elapsedMs = Number(process.hrtime.bigint() - wall) / 1e6;
  assert.ok(elapsedMs < 200, "布位纯函数有界（" + elapsedMs.toFixed(1) + "ms）");
  const l2 = worksLayoutOf(entries.slice().reverse());
  assert.deepEqual(Array.from(l1.entries()).sort(), Array.from(l2.entries()).sort(), "同集合同布位（与顺序无关）");
  const l3 = worksLayoutOf(entries);
  for (const [id, p] of l1) assert.deepEqual(l3.get(id), p, "确定性布位 " + id);
  for (const [ia, pa] of l1) for (const [ib, pb] of l1) {
    if (ia >= ib) continue;
    assert.ok(Math.hypot(pa.x - pb.x, pa.y - pb.y) > 0.1, "最小间距 " + ia + "/" + ib);
  }
  // 增量：新增不位移存量、移除不位移存量
  const fixed = new Map(l1);
  const l4 = placeWorksIncremental(entries.concat([{ id: "nn", relPath: "n.exe", kind: "exec" }]), fixed);
  for (const [id, p] of l1) assert.deepEqual(l4.get(id), p, "新增不位移存量 " + id);
  const l5 = placeWorksIncremental(entries.slice(0, 5), fixed);
  for (const [id, p] of fixed) {
    if (l5.has(id)) assert.deepEqual(l5.get(id), p, "移除不位移存量 " + id);
  }
  assert.equal(worksSignatureOf(worksFocusListOf(entries)), worksSignatureOf(worksFocusListOf(entries.slice().reverse())), "签名与顺序无关");
  assert.ok(worksHashOf("x") === worksHashOf("x") && worksHashOf("x") !== worksHashOf("y"), "id 哈希稳定");
  const r1 = worksRng(7); const r2 = worksRng(7);
  assert.deepEqual([r1(), r1()], [r2(), r2()], "确定性随机");
}

/* ═══ A3. 多源融合波场（干涉不是并集） ═══════════════════════ */
{
  const opt = { width: 800, height: 600 };
  const sources = [
    { x: 200, y: 300, delay: 0, phase: 0 },
    { x: 600, y: 300, delay: 0, phase: 0 }
  ];
  const t = 0.9;
  const half = Math.PI / 5.6; // 半周期（WAVE.omega = 5.6 rad/s）
  const unionA = waveUnionAt(sources, 400, 300, t, opt);
  const unionB = waveUnionAt(sources, 400, 300, t + half, opt);
  assert.ok(Math.abs(unionA - unionB) < 1e-6, "并集基线同值（差异只能来自干涉）");
  const constructive = waveRevealAt(sources, 400, 300, t, opt);
  const destructive = waveRevealAt(sources, 400, 300, t + half, opt);
  assert.ok(Math.abs(constructive - destructive) > 0.05, "相长/相消揭示差异可辨：" + constructive.toFixed(3) + " vs " + destructive.toFixed(3));
  assert.ok(Math.abs(constructive - unionA) > 1e-3 && Math.abs(destructive - unionA) > 1e-3, "揭示 ≠ 独立包络并集");
  assert.ok(waveHeightAt(sources, 400, 300, t, opt) !== 0, "合成场高度非零");
  assert.ok(waveCrestAt(sources, 400, 300, t, opt) >= 0, "crest 由同场驱动");
  // 尾段收敛：转场末所有点 reveal → 1（波前覆盖视口）
  const tail = waveRevealAt([{ x: 100, y: 100 }], 700, 500, WORKS_FACE_TRANSITION.toField - 0.01, opt);
  assert.ok(tail > 0.98, "尾段整体收敛到 1（" + tail.toFixed(3) + "）");
  const plan = faceTransitionPlanOf({ direction: "toField" });
  assert.equal(plan.mode, "narrative", "常态走叙事档");
  assert.equal(plan.duration, WORKS_FACE_TRANSITION.toField, "toField 时长");
  const cross = faceTransitionPlanOf({ direction: "toMatter", storm: true });
  assert.equal(cross.mode, "crossfade", "风暴降级 → 交叉淡变");
  assert.ok(cross.duration <= 0.7, "降级时长 ≤0.7s");
  assert.equal(faceTransitionPlanOf({ direction: "toMatter", crossfade: true }).mode, "crossfade", "Esc 短翻面直连交叉淡变");
}

/* ═══ A4. 等势线鞍部 / ASCII / 粒子 ═════════════════════════ */
{
  const wells = [
    { x: 280, y: 300, s: 1, r: 130 },
    { x: 520, y: 300, s: 1, r: 130 }
  ];
  assert.ok(fieldHeightAt(wells, 400, 300) > 0.8, "两阱中点 = 鞍部（叠加势）");
  const contours = contourSegmentsOf(wells, 800, 600, { cell: 20 });
  assert.ok(contours.levels.every((l) => Array.isArray(l.segments)), "三层等势线结构");
  const bridge = contours.levels[2].segments.filter((s) => {
    const mx = (s.x1 + s.x2) / 2;
    const my = (s.y1 + s.y2) / 2;
    return mx > 360 && mx < 440 && Math.abs(my - 300) > 55 && Math.abs(my - 300) < 150;
  });
  assert.ok(bridge.length > 0, "鞍部间等势线融合涌现（非独立贴环）");
  assert.ok(contours.levels[2].segments.some((s) => (s.x1 + s.x2) / 2 < 240), "同一层级跨左阱");
  assert.ok(contours.levels[2].segments.some((s) => (s.x1 + s.x2) / 2 > 560), "同一层级跨右阱");
  const single = contourSegmentsOf([{ x: 400, y: 300, s: 1, r: 130 }], 800, 600, { cell: 20 });
  assert.ok(single.levels[0].segments.length > 0, "单阱仍有等势线");

  assert.equal(asciiCellOf(0.0, 0.1), null, "远离势阱近乎空白");
  const dense = WORKS_ASCII_RAMP.indexOf(asciiCellOf(0.95, 0.2).char);
  const sparse = WORKS_ASCII_RAMP.indexOf(asciiCellOf(0.08, 0.6).char);
  assert.ok(dense > sparse, "势阱处字符更密（" + dense + " > " + sparse + "）");
  assert.equal(asciiCellOf(0.5, 0.99).pulse, true, "数据脉冲慢掷命中");
  assert.equal(WORKS_ASCII_RAMP, " .:-=+*#", "字符坡集中定义");

  const targetList = [{ key: "s", x: 100, y: 100, color: "#ffe27a" }];
  const input = {
    focuses: [{ sx: 300, sy: 300, s: 1, color: "#9fd8ff" }],
    targets: targetList, seed: 11, width: 800, height: 600
  };
  const parts = buildGatherParticles(input);
  assert.equal(parts.length, 26 + 110, "每焦点 26 + 全场 110 粒子");
  assert.deepEqual(parts, buildGatherParticles(input), "粒子确定性可重放");
  const at0 = gatherParticleAt(parts[0], 0, targetList[0]);
  const at1 = gatherParticleAt(parts[0], 99, targetList[0]);
  assert.equal(at1.k, 1, "粒子抵达");
  assert.equal(at1.y, 100, "抵达目标实时位置（y）");
  assert.equal(at0.color, worksMixHex(parts[0].c0, targetList[0].color, 0), "起点场色");
  const moved = gatherParticleAt(parts[0], 99, { x: 320, y: 260, color: "#ffe27a" });
  assert.equal(moved.x, 320, "目标移动 → 终点实时跟随（x）");
  const pal = { exec: "#ffe27a", html: "#8fe8ef", md: "#9fd8ff", pdf: "#c9a7ff", other: "#a8b8d8", missing: "#8a93b8" };
  assert.equal(focusColorOf("exec", false, pal), pal.exec, "可执行暖金");
  assert.notEqual(focusColorOf("md", false, pal), focusColorOf("exec", false, pal), "文档/可执行色温可辨");
  assert.equal(focusColorOf("exec", true, pal), pal.missing, "失谐去饱和");
}

/* ═══ A5. 渲染核：缓存 / 效果 / 属性级补丁 ═══════════════════ */
{
  const calls = [];
  const ctx = new Proxy({}, {
    get(target, prop) {
      if (prop === "createImageData") return (w, h) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)) });
      if (prop === "createRadialGradient") return () => ({ addColorStop() {} });
      return (...args) => { calls.push([prop, args]); };
    },
    set(target, prop, value) {
      if (prop === "font" || prop === "shadowBlur") calls.push(["set:" + prop, [value]]);
      target[prop] = value;
      return true;
    }
  });
  let now = 10;
  let stormMode = false;
  const host = {
    size: () => ({ width: 800, height: 600, dpr: 1 }),
    time: () => now,
    skin: () => ({
      palette: {
        prop: { proto: "#8a9bc0", created: "#9fd8ff", reviewed: "#cfe8ff", executed: "#ffe27a" },
        sess: { idle: "#a8b8d8", busy: "#54c8ff", waiting: "#ffaa4a", done: "#5affc0", free: "#cfeaff" }
      },
      gold: "#ffd28a",
      light: false
    }),
    scene: () => null,
    focusWs: () => null,
    activity: () => "active",
    storm: () => stormMode,
    options: () => ({ contours: true, ascii: true }),
    project: () => null
  };
  const field = createWorksFace(host);
  field.setWorks(focusFixture(4));
  field.update(0.016);
  field.draw(ctx, {});
  let insp = field.inspect();
  assert.equal(insp.count, 4, "焦点集合数");
  assert.ok(insp.focuses.every((f) => f.x > 0 && f.y > 0), "焦点已落位");
  assert.equal(insp.focuses[0].shape, "hexagon", "焦点形状按类型（exec）");
  assert.equal(insp.focuses[1].shape, "square", "焦点形状按类型（md）");
  const drawnTexts = calls.filter(([name]) => name === "fillText").map(([, args]) => String(args[0]));
  assert.equal(drawnTexts.some((text) => /[\u2699\u25C8\u25A4\u25AF\u25CF]/.test(text)), false, "焦点上方不再绘制类型字形");
  assert.ok(drawnTexts.includes("作品0"), "显示名仍在 canvas 文本层");
  const drawnFonts = calls.filter(([name]) => name === "set:font").map(([, args]) => String(args[0]));
  assert.ok(drawnFonts.some((font) => parseFloat(font) >= 12), "显示名字号加大（≥12px 基准）");
  const grid1 = insp.cache.gridBuilds;
  const contour1 = insp.cache.contourBuilds;
  now += 0.02;
  field.update(0.016);
  field.draw(ctx, {});
  insp = field.inspect();
  assert.equal(insp.cache.gridBuilds, grid1, "稳态同相位桶：网格零重算");
  assert.equal(insp.cache.contourBuilds, contour1, "稳态同相位桶：等势线零重算");
  now += 0.2;
  field.update(0.016);
  field.draw(ctx, {});
  assert.ok(field.inspect().cache.gridBuilds > grid1, "相位桶推进 → 重算");
  // 风暴降级：等势线/ASCII 保持缓存帧（不重算），辐射涟漪停发
  const stormContours = field.inspect().cache.contourBuilds;
  const stormAscii = field.inspect().cache.asciiBuilds;
  stormMode = true;
  const emissionBefore = field.inspect().effects.emissions;
  for (let i = 0; i < 6; i++) { now += 0.1; field.update(0.016); field.draw(ctx, {}); }
  const stormInfo = field.inspect();
  assert.equal(stormInfo.cache.contourBuilds, stormContours, "风暴期等势线保持缓存帧");
  assert.equal(stormInfo.cache.asciiBuilds, stormAscii, "风暴期 ASCII 保持缓存帧");
  assert.ok(stormInfo.effects.emissions <= emissionBefore, "风暴期辐射涟漪停发");
  stormMode = false;

  // 新增属性级补丁：凝聚入场、存量零位移
  const before = field.inspect().focuses.map((f) => [f.id, f.x, f.y]);
  const more = focusFixture(5);
  field.setWorks(more);
  now += 0.016;
  field.update(0.016);
  const after = field.inspect().focuses.filter((f) => f.id !== "w4");
  assert.deepEqual(after.map((f) => [f.id, f.x, f.y]), before, "新增不位移存量焦点");
  assert.ok(field.inspect().effects.spirals > 0, "凝聚动画起效");

  // 改名就地：同一焦点对象内容更新（无重建）
  const renamed = more.map((f) => f.id === "w1" ? { ...f, displayName: "构建入口", note: "入口 A" } : f);
  field.setWorks(renamed);
  now += 0.016;
  field.update(0.016);
  assert.equal(field.focusById("w1").displayName, "构建入口", "改名就地更新");
  // lastLaunchedAt 前进 → 余辉重放
  const launched = renamed.map((f) => f.id === "w1" ? { ...f, lastLaunchedAt: 99999 } : f);
  field.setWorks(launched);
  assert.ok(field.focusById("w1").bright > 0.9, "余辉重放（bright 置满）");

  // 移除：蒸发出场（dying + s 衰减后摘除）
  field.setWorks(more.filter((f) => f.id !== "w4"));
  now += 0.016;
  field.update(0.016);
  assert.equal(field.focusById("w4")?.dying, true, "移除 → 蒸发出场");
  for (let i = 0; i < 40; i++) { now += 0.05; field.update(0.05); }
  assert.equal(field.focusById("w4"), null, "蒸发完成摘除");

  // 命中 / 悬停 / 激活
  const f0 = field.inspect().focuses[0];
  const hit = field.hitTest(f0.x, f0.y);
  assert.equal(hit?.type, "focus", "焦点命中");
  assert.equal(field.hitTest(5, 5)?.type || null, null, "空白处不命中");
  const hoverId = field.updateHover(f0.x, f0.y, true);
  assert.equal(hoverId, f0.id, "hover 命中焦点");
  const act = field.activate(f0.id);
  assert.equal(act?.type, "launch", "激活返回 launch");
  assert.ok(field.inspect().effects.ripples > 0, "激发强涟漪");

  // 失谐不参与正常激发（点击仍是 toast 引导——引擎侧消费 exists）
  const missing = worksFocusListOf([{ id: "m", relPath: "gone.pdf", kind: "pdf", exists: false }]);
  field.setWorks(missing);
  now += 0.016;
  field.update(0.016);
  assert.equal(field.focusById("m").exists, false, "失谐态呈现");
  assert.equal(field.activate("m").focus.exists, false, "失谐激活由引擎 toast 引导");

  // 无作品 → 虚位（渐入）
  field.setWorks([]);
  for (let i = 0; i < 40; i++) { now += 0.05; field.update(0.05); }
  assert.ok(field.inspect().vacancyK > 0.2, "清空后虚位渐入");
  assert.equal(field.hitTest(400, 330)?.type, "vacancy", "虚位可点击");

  // 开关：ASCII/等势线关闭 → 零绘制（不再增长构建计数）
  const asciiBefore = field.inspect().cache.asciiBuilds;
  field.setWorks(focusFixture(3));
  field.update(0.016);
  now += 1;
  field.draw(ctx, {});
  assert.ok(field.inspect().cache.asciiBuilds > asciiBefore, "ASCII 离屏低频重绘");

  // HTML 条目 → 菱形焦点形状（回归：kind 正确时形状必须是 diamond，不得回落圆）
  field.setWorks([{
    id: "html1", relPath: "demo/index.html", kind: "html", name: "星场demo", note: null,
    displayName: "星场demo", exists: true, addedAt: 1, lastLaunchedAt: 0, hasLastLaunched: false
  }]);
  field.update(0.05);
  const htmlFocus = field.inspect().focuses.find((focus) => focus.id === "html1");
  assert.equal(htmlFocus?.kind, "html", "html 条目 kind 保持");
  assert.equal(htmlFocus?.shape, "diamond", "html 条目焦点形状 = 菱形");
}

/* ═══ B. HUD 铬件（面按钮 / fab / 信息卡 / 系统文件选择器） ═════════ */
{
  const root = stubEl("div");
  const overlay = stubEl("div");
  root.appendChild(overlay);
  const toasts = [];
  const faceRequests = [];
  const updates = [];
  const reveals = [];
  const removes = [];
  const evaporated = [];
  let pickCalls = 0;
  let pickImpl = async () => ({ ok: true, cancelled: true, entries: [] });
  let worksRows = [
    { id: "w1", relPath: "tools/build.bat", kind: "exec", name: null, note: null, displayName: "build.bat", exists: true },
    { id: "w2", relPath: "docs/guide.md", kind: "md", name: "指南", note: "旧备注", displayName: "指南", exists: true }
  ];
  const actions = {
    pick: (wsId) => {
      pickCalls += 1;
      assert.equal(wsId, "ws1", "pick 收到当前星座 id");
      return pickImpl();
    },
    update: async (wsId, id, patch) => { updates.push({ wsId, id, patch }); return { ok: true }; },
    remove: async (wsId, id) => { removes.push({ wsId, id }); return { ok: true }; },
    open: async () => ({ ok: true }),
    reveal: async (wsId, id) => { reveals.push({ wsId, id }); return { ok: true }; }
  };
  const host = {
    root,
    overlay,
    toast: (text, isError) => toasts.push({ text, isError }),
    onFaceRequest: (face) => { faceRequests.push(face); return true; },
    getCount: () => worksRows.length,
    getWorksId: () => "ws1",
    getWorks: () => worksRows,
    getFocus: (id) => worksRows.find((row) => row.id === id) || null,
    onLaunched: () => {},
    onEvaporate: (id) => evaporated.push(id),
    onAdded: () => {},
    actions
  };
  const ui = createWorksFaceUI(host);
  ui.syncFaceButton({ face: "matter", busy: false, drilled: false });
  let uiInfo = ui.inspect();
  assert.equal(uiInfo.faceButton.on, false, "银河态（未钻取）面切换按钮零呈现");
  assert.equal(uiInfo.faceButton.icon, "matter", "星座视图图案 = 引力场（去星场）");
  const faceBtn = uiInfo.elements.faceButton;
  assert.equal(faceBtn.className, "cos-face-btn", "右下控制簇单枚按钮");
  assert.ok(String(faceBtn.innerHTML).includes("<svg"), "图案为内联 SVG");
  ui.syncFaceButton({ face: "matter", busy: false, drilled: true });
  assert.equal(ui.inspect().faceButton.on, true, "钻取态呈现");
  assert.equal(faceBtn.getAttribute("aria-label"), "切换到星场", "星座视图 → 点击去星场");
  faceBtn.listeners.click[0]();
  assert.deepEqual(faceRequests, ["field"], "点击请求切到星场");
  ui.syncFaceButton({ face: "matter", busy: true, drilled: true });
  faceBtn.listeners.click[0]();
  assert.deepEqual(faceRequests, ["field"], "转场忙态忽略切换请求");
  ui.syncFaceButton({ face: "field", busy: false, drilled: true });
  assert.equal(ui.inspect().faceButton.icon, "field", "星场视图图案 = 星座连线（回星座）");
  assert.equal(faceBtn.getAttribute("aria-label"), "切换到星座视图", "星场 → 点击回星座视图");
  faceBtn.listeners.click[0]();
  assert.deepEqual(faceRequests, ["field", "matter"], "星场视图点击请求切回星座");
  ui.syncFab(true);
  assert.equal(ui.inspect().fab.on, true, "星场态 fab 常驻");
  ui.syncFab(false);
  assert.equal(ui.inspect().fab.on, false, "天体面 fab 隐藏");

  // 信息卡：只读简化（类型 + 显示名 + 路径 + 失谐提示；MUST NOT 再内有动作按钮）
  const focus = { ...worksRows[0], displayName: "构建入口", note: "备注", exists: false };
  ui.showCard(focus);
  assert.equal(ui.inspect().card.open, true, "卡打开");
  const cardHtml = String(cardOf(ui).innerHTML);
  assert.ok(cardHtml.includes("构建入口"), "显示名");
  assert.ok(cardHtml.includes("tools/build.bat"), "相对路径");
  assert.ok(cardHtml.includes("文件不存在，无法激发"), "失谐提示保留（只读）");
  assert.equal(cardHtml.includes("data-act"), false, "tips 不再含动作按钮");
  assert.equal(cardHtml.includes("打开所在目录"), false, "tips 不再含定位按钮");
  assert.equal(cardHtml.includes("从未激发"), false, "tips 内容简化（无时间元信息）");
  const geo = ui.placeCard({ x: 300, y: 300, r: 30, width: 800, height: 600 });
  assert.ok(geo && Number.isFinite(geo.anchor.x) && Number.isFinite(geo.anchor.y), "引线端点有限");
  assert.ok(geo.x >= 0, "卡体视口钳制");
  ui.hideCard();
  assert.equal(ui.inspect().card.open, false, "收卡");

  // 系统文件选择器：取消静默 / 成功 toast / 失败 toast / 在途防重
  const toastBase = toasts.length;
  assert.equal(await ui.pickFiles(), true, "取消 = 受理成功");
  assert.equal(pickCalls, 1, "取消也恰开一次系统对话框");
  assert.equal(toasts.length, toastBase, "取消静默（零新增 toast）");
  pickImpl = async () => ({ ok: true, picked: 2, entries: [{ id: "n1" }, { id: "n2" }] });
  assert.equal(await ui.pickFiles(), true, "选择登记受理");
  assert.equal(pickCalls, 2, "再次打开系统对话框");
  assert.ok(toasts.some((t) => String(t.text).includes("已凝聚 2 件作品（系统文件浏览器）")), "成功 toast 注明件数与来源");
  pickImpl = async () => ({ ok: false, reason: "out-of-root", error: "out-of-root" });
  assert.equal(await ui.pickFiles(), false, "根外失败");
  assert.equal(toasts.at(-1).isError, true, "失败以错误 toast 呈现");
  assert.ok(String(toasts.at(-1).text).includes("所选文件不在当前工作区内"), "结构化 reason 文案");
  let releasePick;
  pickImpl = () => new Promise((resolvePick) => { releasePick = resolvePick; });
  const pendingPick = ui.pickFiles();
  await new Promise((resolveTick) => setTimeout(resolveTick, 0));
  assert.equal(ui.inspect().fab.picking, true, "在途标记");
  const duplicatePick = await ui.pickFiles();
  assert.equal(duplicatePick, false, "在途期间再次点击被忽略");
  releasePick({ ok: true, cancelled: true, entries: [] });
  assert.equal(await pendingPick, true, "在途请求完成");
  assert.equal(ui.inspect().fab.picking, false, "在途标记复位");
  assert.equal(WORKS_REASON_TEXT["missing-on-disk"].includes("文件已被删除"), true, "结构化 reason 文案");

  // 底部工具行：＋ 旁出现编辑按钮（48px icon-only），编辑页列出全部作品
  assert.equal(ui.inspect().elements.editButton.className, "cos-wfield-edit", "编辑按钮");
  assert.ok(String(ui.inspect().elements.editButton.innerHTML).includes("<svg"), "铅笔图案");
  ui.syncFab(true);
  assert.equal(ui.inspect().fab.on, true, "星场态工具行常驻（＋ + 编辑）");
  assert.equal(ui.openEditor(), true, "编辑页打开");
  let editorInfo = ui.inspect().editor;
  assert.equal(editorInfo.open, true, "编辑页打开态");
  assert.equal(editorInfo.rows, 2, "列出全部已加入文件");
  const editor = ui.inspect().elements.editor;
  const editorList = editor.querySelector('[data-role="editor-list"]');
  let editorHtml = String(editorList.innerHTML);
  assert.ok(editorHtml.includes("build.bat") && editorHtml.includes("docs/guide.md"), "行含文件与路径");
  assert.ok(editorHtml.includes('data-field="name"') && editorHtml.includes('data-field="note"'), "别名/备注输入");
  assert.ok(editorHtml.includes("打开所在目录"), "行内定位入口");
  assert.ok(editorHtml.includes("移除"), "移除入口（life-cycle 保留）");

  // 编辑 w1 的别名与备注 → 保存 → update 载荷 + 行内即时刷新
  const fieldEvent = (id, field, value) => ({
    target: { getAttribute: (key) => (key === "data-id" ? id : key === "data-field" ? field : null), value }
  });
  editor.listeners.input[0](fieldEvent("w1", "name", "构建入口"));
  editor.listeners.input[0](fieldEvent("w1", "note", "入口 A"));
  const actEvent = (act, id) => ({
    target: { getAttribute: (key) => (key === "data-act" ? act : key === "data-id" ? id : null) }
  });
  editor.listeners.click[0](actEvent("save", "w1"));
  await tick();
  assert.deepEqual(updates.at(-1), { wsId: "ws1", id: "w1", patch: { name: "构建入口", note: "入口 A" } }, "保存别名/备注走 updateWork");
  assert.ok(String(editorList.innerHTML).includes("构建入口"), "保存后行内显示名刷新");
  assert.equal(ui.inspect().editor.open, true, "保存不关页");

  // 打开所在目录
  editor.listeners.click[0](actEvent("reveal", "w2"));
  await tick();
  assert.deepEqual(reveals.at(-1), { wsId: "ws1", id: "w2" }, "定位走 reveal");

  // 移除两击确认 + 蒸发动画先起
  editor.listeners.click[0](actEvent("remove", "w2"));
  assert.equal(ui.inspect().editor.armedRemoveId, "w2", "首击进入确认态");
  editor.listeners.click[0](actEvent("remove", "w2"));
  await tick();
  assert.deepEqual(removes.at(-1), { wsId: "ws1", id: "w2" }, "确认后移除");
  assert.deepEqual(evaporated, ["w2"], "先起蒸发动画");
  assert.equal(ui.inspect().editor.rows, 1, "行随移除收起");

  // 关闭（Esc 由引擎 consumeEscape 优先关页）
  editor.listeners.click[0]({ target: { getAttribute: (key) => (key === "data-act" ? "close-editor" : null) } });
  assert.equal(ui.inspect().editor.open, false, "关闭编辑页");
  ui.dispose();
}

function cardOf(ui) { return ui.inspect().elements.card; }
function cardHas(card, text) { return String(card.innerHTML).includes(text); }
function tick() { return new Promise((resolve) => setTimeout(resolve, 0)); }

/* ═══ C. 引擎接线：面状态机 / ∿N / Esc / 静默复位 ═══════════ */
{
  const container = stubEl("div");
  const faceEvents = [];
  const eng = createCosmosEngine({
    container,
    style: createSkinD(),
    settings: {},
    onFaceChange: (info) => faceEvents.push(info),
    worksActions: {
      pick: async () => ({ ok: true, cancelled: true, entries: [] }),
      update: async () => ({ ok: true }),
      remove: async () => ({ ok: true }),
      open: async () => ({ ok: true }),
      reveal: async () => ({ ok: true })
    }
  });
  eng.setScene(miniScene(), "rebuild");
  rafQ.length = 0;
  eng.start();
  let ts = 400000;
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      ts += 50;
      fakeNow += 50;
      stepFrame(ts);
    }
  };
  step(3);

  // 未钻取：翻面被拒；works 快照暂存（pending）不丢
  assert.equal(eng.setFace("field"), false, "未钻取 → 翻面拒绝");
  assert.equal(eng.setWorks("ws1", focusFixture(2)), false, "未钻取 → 快照暂存（false）");

  // 钻取（camera tween 1300ms）→ 快照就位
  assert.equal(eng.diveToWs("ws1"), true, "钻取目标命中");
  step(32);
  let info = eng.inspectFace();
  assert.equal(info.wsId, "ws1", "钻取星座");
  assert.equal(info.worksCount, 2, "pending 快照就位");
  assert.equal(info.field.count, 2, "渲染核收到焦点");

  // 标牌 ∿N：同一帧 updateOverlay 差分重写
  const root = container.children[0];
  const overlayEl = root.querySelector(".cos-overlay");
  const slabEls = () => overlayEl.children.filter((c) => String(c.className).includes("cos-slab"));
  const badge = root.querySelector(".cos-badge");
  step(2);
  assert.ok(String(badge.innerHTML).includes("∿2"), "标牌追加 ∿N（钻取态全量仪表）");
  assert.ok(slabEls().some((el) => el.classList.contains("on")), "天体面恒星名牌在场（提案名+状态）");

  // 翻面：toField 叙事 → 完成后 face=field；转场中再次请求被忽略
  assert.equal(eng.setFace("field"), true, "翻面请求接受");
  info = eng.inspectFace();
  assert.equal(info.busy, true, "转场忙态");
  /* 页签不可见冻结：stop() 后时基不推进（转场断点续播，不跳帧）。 */
  const frozenAt = info.transition.elapsed;
  eng.stop();
  assert.equal(eng.inspectFace().transition.elapsed, frozenAt, "暂停期转场时基冻结");
  eng.start();
  step(3);
  assert.ok(eng.inspectFace().transition.elapsed > frozenAt, "恢复可见后续播");
  assert.equal(info.transition.mode, "narrative", "叙事转场");
  assert.equal(eng.setFace("matter"), false, "转场中忽略切换");
  assert.equal(eng.consumeEscape(), true, "转场中 Esc 被消费（不打断）");
  step(60);
  info = eng.inspectFace();
  assert.equal(info.face, "field", "转场完成 → 星场面");
  assert.equal(info.busy, false, "忙态解除");
  assert.equal(info.field.transition, null, "转场状态回收");
  assert.ok(faceEvents.some((e) => e.face === "field" && e.wsId === "ws1"), "面状态回调（React 让位）");
  // 星场态：fab 常驻、pill 激活段星场
  const uiInfo = info.ui;
  assert.equal(uiInfo.fab.on, true, "星场态 fab 常驻");
  assert.equal(uiInfo.faceButton.face, "field", "按钮图案随面切换");
  assert.ok(info.field.cache.gridBuilds > 0, "星场渲染（网格构建）");
  assert.equal(slabEls().some((el) => el.classList.contains("on")), false, "星场态恒星提案名牌退场");
  assert.equal(
    eng.inspectTipLines().some((tip) => tip.kind === "slab" || tip.kind === "card"),
    false,
    "星场无恒星浮签/引线残留"
  );
  const chipEl = overlayEl.children.find((c) => String(c.className).includes("cos-chip"));
  assert.ok(chipEl && !String(chipEl.innerHTML).includes("∿"), "银河 chip 零计数（∿ 仅钻取标牌）");
  // 稳态帧零重算：20 帧仅随 100ms 相位桶重算（远少于帧数）
  const gridBefore = info.field.cache.gridBuilds;
  for (let i = 0; i < 20; i++) { ts += 10; fakeNow += 10; stepFrame(ts); }
  const gridAfter = eng.inspectFace().field.cache.gridBuilds;
  assert.ok(gridAfter - gridBefore <= 3, "稳态帧零重算（" + (gridAfter - gridBefore) + " 次 / 20 帧）");

  // 属性级补丁：新增 → 计数 +1，存量零位移
  const beforePos = info.field.focuses.map((f) => [f.id, f.x, f.y]);
  eng.setWorks("ws1", focusFixture(3));
  step(3);
  info = eng.inspectFace();
  assert.equal(info.worksCount, 3, "∿ 计数 +1");
  const afterPos = info.field.focuses.filter((f) => f.id !== "w2");
  assert.deepEqual(afterPos.map((f) => [f.id, f.x, f.y]), beforePos, "新增不位移存量");
  step(2);
  assert.ok(String(badge.innerHTML).includes("∿3"), "∿N 随快照重拉维护");

  // 编辑页：Esc 只关页（MUST NOT 冒泡触发换面/返回链）
  assert.equal(eng.openWorksEditor(), true, "编辑页打开");
  info = eng.inspectFace();
  assert.equal(info.ui.editor.open, true, "引擎观测面同步编辑页");
  assert.equal(info.ui.editor.rows, 3, "编辑页列表 = 当前作品快照");
  assert.equal(eng.consumeEscape(), true, "Esc 优先关编辑页");
  info = eng.inspectFace();
  assert.equal(info.ui.editor.open, false, "编辑页关闭");
  assert.equal(info.face, "field", "关页不换面");
  assert.equal(info.busy, false, "关页不启动转场");

  // Esc：短交叠淡变回天体面（直连交叉淡变，≠ 叙事粒子）
  assert.equal(eng.consumeEscape(), true, "星场态 Esc 被消费");
  info = eng.inspectFace();
  assert.equal(info.busy, true, "Esc 转场启动");
  assert.equal(info.transition.mode, "crossfade", "Esc 短翻面走交叉淡变");
  assert.ok(info.transition.duration <= 0.7, "Esc 转场 ≤0.7s");
  step(20);
  info = eng.inspectFace();
  assert.equal(info.face, "matter", "返回天体面");
  assert.equal(info.busy, false, "无转场");
  step(1);
  assert.ok(slabEls().some((el) => el.classList.contains("on")), "返回天体面后恒星名牌恢复");

  // 再次进入星场后飞回银河：面静默复位（无反向叙事）
  eng.setFace("field");
  step(60);
  assert.equal(eng.inspectFace().face, "field", "再次翻面完成");
  eng.flyOut();
  info = eng.inspectFace();
  assert.equal(info.face, "matter", "飞回银河 → 面静默复位");
  assert.equal(info.busy, false, "无反向转场");
  step(30);
  assert.equal(eng.inspectFace().wsId, null, "回银河");
  assert.ok(faceEvents.some((e) => e.face === "matter"), "复位回调");

  // 设置热更：两开关镜像（部分写 + 值变才写），下一帧渲染核读取新值
  eng.setTuning({ worksContours: false, worksAscii: false });
  const tuned = eng.inspectFace().field.options;
  assert.equal(tuned.contours, false, "等势线热更关闭");
  assert.equal(tuned.ascii, false, "ASCII 热更关闭");
  eng.setTuning({ worksContours: true });
  assert.equal(eng.inspectFace().field.options.contours, true, "等势线热更重开");
  assert.equal(eng.getScene().workspaces.length, 1, "零侵入：场景不变");

  eng.dispose();
}

/* ═══ D. 设置面 ═════════════════════════════════════════════ */
{
  const settings = await import("../src/settings.mjs");
  assert.equal(settings.COSMOS_SETTINGS_DEFAULTS.worksContours, true, "等势线缺省开");
  assert.equal(settings.COSMOS_SETTINGS_DEFAULTS.worksAscii, true, "ASCII 缺省开");
  for (const bad of ["on", 1, null, undefined, {}, []]) {
    assert.equal(settings.sanitizeCosmosSettings({ worksContours: bad }).worksContours, true, "非布尔回落缺省：" + String(bad));
    assert.equal(settings.sanitizeCosmosSettings({ worksAscii: bad }).worksAscii, true, "非布尔回落缺省：" + String(bad));
  }
  assert.equal(settings.sanitizeCosmosSettings({ worksContours: false }).worksContours, false, "显式关闭保留");
  assert.equal(settings.COSMOS_SETTINGS_VERSION >= 15, true, "设置版本顺延（≥ v15）");
  const v14 = { ...settings.COSMOS_SETTINGS_DEFAULTS };
  delete v14.worksContours;
  delete v14.worksAscii;
  assert.equal(settings.sanitizeCosmosSettings(v14).worksContours, true, "v14 载荷补缺省");
}

/* ═══ E. 源码锚点（client / settings-ui / engine 接线） ═════ */
{
  const client = readFileSync(new URL("../src/client.jsx", import.meta.url), "utf8");
  const uiSource = readFileSync(new URL("../src/settings-ui.jsx", import.meta.url), "utf8");
  const engine = readFileSync(new URL("../src/cosmos/engine.mjs", import.meta.url), "utf8");
  const faceUiSource = readFileSync(new URL("../src/cosmos/works-face-ui.mjs", import.meta.url), "utf8");

  assert.ok(client.includes("fetchWorks, pickWorks, updateWork, removeWork, openWork, revealWork"), "作品桥消费面导入（pickWorks 系统选择器）");
  assert.ok(!client.includes("browseWorks(") && !client.includes("addWorks("), "自建浏览/批量登记桥已从客户端退场");
  assert.ok(client.includes('frame?.type === "works-changed"'), "works-changed 轻帧 → 重拉快照");
  assert.ok(client.includes("if (worksInFlightKey === id) return cosmosWorksStore.getSnapshot();"), "在途防重（per 钻取星座）");
  assert.ok(client.includes("worksCacheByWs.set(id, entries)"), "per 钻取星座缓存");
  assert.ok(client.includes("worksFocusListOf(entries)"), "焦点集合投影（id/relPath/显示名/kind/exists）");
  assert.ok(client.includes("disposers.push(drillStore.subscribe(() => syncWorksScope()));"), "钻取作用域驱动 works 拉取");
  assert.ok(client.includes("inject: () => ({ launch: launchFace, paths: pathsSettings, templateNames: templateNamesFace, patLineDim: patLineDimFace, worksFace: worksFaceSettings })"), "设置页注入 works face");
  assert.ok(!client.includes("fieldMode"), "面切换不改周边界面（无 fieldMode 让位）");
  assert.ok(!(client.match(/\{!fieldMode \? \(/g) ?? []).length, "提案面板/队列/会话面板/动作条两面保持一致");
  assert.ok(client.includes("onFaceChange: (info) =>"), "引擎面状态回调接线（观测面）");
  assert.ok(client.includes("worksContours: loadCosmosSettings().worksContours"), "受控镜像冷启动读持久值");
  for (const key of ["worksFaceLegend", "worksContoursLabel", "worksContoursHint", "worksContoursAria", "worksAsciiLabel", "worksAsciiHint", "worksAsciiAria", "worksFaceInstant"]) {
    const count = (client.match(new RegExp('"cosmos\\.settings\\.' + key + '"', "g")) ?? []).length;
    assert.equal(count, 2, "zh/en 文案成对：" + key);
  }

  assert.ok(uiSource.includes('data-setting="worksContours"'), "设置页等势线开关行");
  assert.ok(uiSource.includes('data-setting="worksAscii"'), "设置页 ASCII 开关行");
  assert.ok(uiSource.includes("type=\"checkbox\""), "开关为复选框");
  assert.ok(uiSource.includes("worksFace !== null"), "face 缺席 → 整组不渲染");

  assert.ok(engine.includes('import { createWorksFace, worksHitRadiusOf, FACE_FIELD, FACE_MATTER, faceTransitionPlanOf }'), "引擎导入星场渲染核");
  assert.ok(engine.includes('import { createWorksFaceUI, WORKS_REASON_TEXT }'), "引擎导入星场 HUD");
  assert.ok(engine.includes("worksCountHtml(E.focusWs)"), "标牌 ∿N 注入");
  assert.ok(engine.includes("∿"), "∿ 字形入计数行");
  assert.ok(engine.includes("E.fieldUI.pickFiles()"), "虚位点击走系统文件选择器");
  assert.ok(!engine.includes("modalOpen") && !engine.includes("cos-wmodal"), "自建拾取模态已退役（零残留）");
  assert.ok(engine.includes("if (E.face === FACE_FIELD) { startFaceTransition(FACE_MATTER, true); return true; }"), "Esc 星场返天体面层（插在钻取返回之前）");
  assert.ok(engine.includes("resetFaceSilently"), "飞回银河静默复位");
  assert.ok(engine.includes("setWorks(wsId, entries)"), "公共 setWorks 注入面");
  assert.ok(engine.includes("inspectFace()"), "面观测面");
  assert.ok(engine.includes(".cos-face-btn"), "单枚面切换按钮 CSS");
  assert.ok(engine.includes("syncFaceButton({ face: E.face, busy: !!E.faceTrans, drilled: drilled })"), "引擎逐帧同步面按钮（图案/忙态/钻取门控）");
  assert.ok(engine.includes("right: calc(16px + 2 * (var(--cos-hud-btn-size, 44px) + 8px))"), "按钮位于「拖拽平移」左侧");
  assert.ok(!engine.includes("cos-face-pill"), "旧双段 pill 已退役");
  assert.ok(faceUiSource.includes("FACE_ICON_GRAVITY") && faceUiSource.includes("FACE_ICON_CONSTELLATION"), "两枚图案（引力场 / 星座连线）");
  assert.ok(faceUiSource.includes("切换到星场") && faceUiSource.includes("切换到星座视图"), "图案语义文案成对");
  assert.ok(engine.includes(".cos-wfield-tools"), "底部工具行 CSS（＋ 与编辑并排）");
  assert.ok(engine.includes(".cos-weditor"), "作品编辑页 CSS");
  assert.ok(engine.includes("openWorksEditor()"), "编辑页公共入口");
  assert.ok(engine.includes("E.fieldUI.editorOpen"), "Esc/指针/键盘编辑页让位");
  assert.ok(!engine.includes(".cos-wcard-btns"), "tips 动作按钮 CSS 已退役");
  assert.ok(faceUiSource.includes("function openEditor") && faceUiSource.includes('data-act="save"'), "编辑页开页与行内保存");
  assert.ok(engine.includes(".cos-wcard"), "信息卡 CSS");
}

console.log("works-face-smoke: all assertions passed");
