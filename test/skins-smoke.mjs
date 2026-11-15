/**
 * 皮肤收藏馆运行时冒烟（demo/skins）。
 *
 * 在 Node VM 沙箱里逐个加载 skinlib + 17 套皮肤，断言 COSMOS_STYLE 接口完整，
 * 并以桩 ctx 真实执行 background 与 drawBody 的全部天体分支（dust/constline/
 * orbit/star/planet/comet/meteor × 深空/纸面两种合成模式）。
 *
 * 运行: node test/skins-smoke.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const SKINS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "demo", "skins");
const SKINS = [
  "rosepine", "fidenza", "linear", "obsidian",
  "reagent", "chamber", "fluoro", "lotus", "migration", "circuit", "fermata"
];
const BAND_SKINS = new Set(["rosepine"]);

function assert(cond, msg) {
  if (!cond) {
    console.error("skins-smoke FAIL:", msg);
    process.exit(1);
  }
}

const sandbox = { console };
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
sandbox.window.COSMOS_UTIL = {
  clamp(v, a, b) { return v < a ? a : v > b ? b : v; },
  lerp(a, b, t) { return a + (b - a) * t; },
  glowSprite() { return {}; },
  TAU: Math.PI * 2
};
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(SKINS_DIR, "assets", "skinlib.js"), "utf8"), sandbox);
assert(typeof sandbox.window.COSMOS_SKINLIB?.define === "function", "skinlib.define 缺失");

/** 桩 ctx：方法全吞，渐变返回带 addColorStop 的对象；属性赋值走默认 set。 */
function stubCtx() {
  return new Proxy({}, {
    get(_t, key) {
      if (key === "createLinearGradient" || key === "createRadialGradient") {
        return () => ({ addColorStop() {} });
      }
      return () => {};
    }
  });
}

const view = { W: 800, H: 600, t: 1.25, bgStars: [{ x: 5, y: 5, m: 0.95, a: 0.5 }], band: [{ x: 5, y: 5, m: 0.5, a: 0.3 }] };
const trail = [{ x: 0, y: 0 }, { x: 4, y: 4 }];
const bodies = [
  { kind: "dust", pts: [{ x: 1, y: 1, s: 1, a: 0.5, hue: 0.2 }], alpha: 1 },
  { kind: "constline", segs: [[{ x: 0, y: 0 }, { x: 9, y: 9 }]], alpha: 1 },
  { kind: "orbit", orbitPts: [{ x: 0, y: 0 }, { x: 5, y: 5 }], alpha: 1 },
  { kind: "star", x: 3, y: 3, r: 6, alpha: 1, hovered: true, selected: false, data: { status: "in-progress", act: 1 } },
  { kind: "star", x: 3, y: 3, r: 6, alpha: 1, hovered: false, selected: true, data: { status: "complete", act: 0 } },
  { kind: "planet", x: 4, y: 4, r: 5, alpha: 1, trail, data: { state: "waiting" } },
  { kind: "planet", x: 4, y: 4, r: 5, alpha: 1, trail, data: { state: "idle" } },
  { kind: "comet", x: 5, y: 5, r: 5, alpha: 1, trail },
  { kind: "meteor", x: 6, y: 6, r: 2, alpha: 1, trail }
];

for (const id of SKINS) {
  const file = join(SKINS_DIR, "assets", `skin-${id}.js`);
  vm.runInContext(readFileSync(file, "utf8"), sandbox);
  const s = sandbox.window.COSMOS_STYLE;
  assert(s && s.skin === id, `${id}: COSMOS_STYLE.skin 不符`);
  assert(typeof s.background === "function", `${id}: background 缺失`);
  assert(typeof s.drawBody === "function", `${id}: drawBody 缺失`);
  assert(typeof s.bgStarColor === "function", `${id}: bgStarColor 缺失`);
  assert(typeof s.captionHTML === "string" && s.captionHTML.length > 40, `${id}: captionHTML 异常`);
  assert(s.palette.prop && s.palette.prop["draft"] && s.palette.prop["in-progress"] && s.palette.prop["complete"], `${id}: prop 三态缺失`);
  assert(s.palette.sess && ["idle", "busy", "waiting", "done", "free"].every((k) => s.palette.sess[k]), `${id}: sess 五态缺失`);
  assert(Array.isArray(s.dustColors) && s.dustColors.length === 2, `${id}: dustColors 非双色`);
  assert(typeof s.useBand === "boolean", `${id}: useBand 缺失`);

  const ctx = stubCtx();
  s.background(ctx, view);
  for (const body of bodies) s.drawBody(ctx, body, view);
  assert(s.useBand === BAND_SKINS.has(id), `${id}: useBand 与银河带皮肤清单不符`);
}

console.log(`skins-smoke ok · ${SKINS.length} 套皮肤 × background + ${bodies.length} 天体分支`);
