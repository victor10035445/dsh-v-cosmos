/**
 * 皮肤注册表冒烟（add-cosmos-skin-themes 1.6 / spec「皮肤注册与内置清单」「皮肤语义契约」）。
 *
 * 覆盖：
 *  - 12 套内置清单（id 唯一、顺序 = 设置页卡片顺序、默认 `rosepine`）；
 *  - 接口完备（palette 四态 prop + 五态 sess、dust 双色、bgStarColor、background/drawBody、
 *    无 captionHTML）；
 *  - background + drawBody 按**引擎实喂条目形状**全分支桩执行（dust/constline{ a,b,alpha }/
 *    orbit/star/planet/suborbit/sat/comet/wsghost/nova/meteor，含 birth/colorMix/fx/surge/
 *    ignite/stamp/view/degraded/bornK）；
 *  - 器皿帧内去重（同帧同星座只绘制一次；换帧重开）；
 *  - HUD 令牌表完备 + deepspace 基线现值逐枚相等 + 令牌下发与 `data-cos-mode`；
 *  - 卡片进度形状通道（p1-add-cosmos-card-progress-bars 4.3/4.4）：12 套 `progressShape`
 *    枚举完备且与指派表一致、`progressShapeOf` clamp、`data-cos-progress` 下发；
 *  - 未知 id 回落默认 + 实例按 id 缓存隔离。
 *
 * 运行：node test/skin-registry-smoke.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* DOM 桩必须先于注册表绘制面使用（注册表 import 期零 DOM 副作用，实例创建不碰 document）。 */
globalThis.document = {
  createElement() {
    const canvas = {
      width: 0,
      height: 0,
      getContext() {
        return countingCtx(() => {}).ctx;
      }
    };
    return canvas;
  }
};

const {
  COSMOS_DEFAULT_SKIN,
  COSMOS_HUD_TOKENS,
  COSMOS_PROGRESS_SHAPE_DEFAULT,
  COSMOS_PROGRESS_SHAPES,
  COSMOS_SKIN_IDS,
  COSMOS_SKINS,
  applySkinTokens,
  createSkin,
  progressShapeOf,
  resolvedSkinEntry,
  skinCardOf,
  skinEntryOf,
  skinHudOf
} = await import("../src/cosmos/skin-registry.mjs");

/** 计数 ctx：记录所有方法调用次数（器皿去重按「同帧同星座绘制原语数」比较）。 */
function countingCtx(onOp) {
  const state = { ops: 0 };
  const grad = { addColorStop() { onOp(); state.ops += 1; } };
  const ctx = new Proxy({}, {
    get(_target, key) {
      if (key === "createLinearGradient" || key === "createRadialGradient" || key === "createPattern") {
        return () => {
          onOp();
          state.ops += 1;
          return grad;
        };
      }
      return function () {
        onOp();
        state.ops += 1;
      };
    },
    set(_target, key, value) {
      if (key === "globalAlpha" || key === "fillStyle" || key === "strokeStyle" || key === "lineWidth") {
        onOp();
        state.ops += 1;
      }
      return true;
    }
  });
  return { ctx, state };
}

const EXPECTED_IDS = [
  "deepspace", "rosepine", "fidenza", "linear", "obsidian",
  "reagent", "chamber", "fluoro", "lotus", "migration", "circuit", "fermata"
];

/* ── 1. 清单形状 ── */
{
  assert.deepEqual([...COSMOS_SKIN_IDS], EXPECTED_IDS, "12 套内置皮肤 id 与顺序（design D2 表）");
  assert.equal(new Set(COSMOS_SKIN_IDS).size, COSMOS_SKIN_IDS.length, "id 唯一");
  assert.equal(COSMOS_SKINS.length, 12, "注册表长度");
  assert.equal(COSMOS_DEFAULT_SKIN, "rosepine", "默认皮肤 = 星图玫瑰松（spec）");
  assert.equal(skinEntryOf("nope"), null, "未知 id → null（entry 查询面）");
  assert.equal(resolvedSkinEntry("nope").id, COSMOS_DEFAULT_SKIN, "未知 id → 回落默认");
  assert.equal(resolvedSkinEntry(undefined).id, COSMOS_DEFAULT_SKIN, "缺省 id → 回落默认");
  assert.equal(resolvedSkinEntry(42).id, COSMOS_DEFAULT_SKIN, "非字符串 id → 回落默认（不抛错）");

  const modes = COSMOS_SKINS.filter((entry) => entry.mode === "light").map((entry) => entry.id);
  assert.deepEqual(modes, ["fidenza"], "唯一 light 模式皮肤 = fidenza（design D2）");
  for (const entry of COSMOS_SKINS) {
    assert.equal(typeof entry.name, "string", entry.id + ": name");
    assert.equal(typeof entry.ref, "string", entry.id + ": ref");
    assert.equal(typeof entry.create, "function", entry.id + ": create 工厂");
    assert.ok(entry.instance && entry.instance.skin === entry.id, entry.id + ": 缓存实例");
    assert.ok(entry.base && entry.base.bg && entry.base.accent, entry.id + ": base 色板");
  }
}

/* ── 1b. 卡片进度形状通道（p1-add-cosmos-card-progress-bars 2.1/4.4 / design D4/D5） ── */
{
  assert.deepEqual([...COSMOS_PROGRESS_SHAPES], ["segment", "bar", "ring"], "形状枚举三值（segment 在首 = 基线）");
  assert.equal(COSMOS_PROGRESS_SHAPE_DEFAULT, "segment", "缺省兜底 = segment");
  /* 逐肤指派表（spec dsh-cosmos「逐肤映射完备」）：常量表在这里**独立重抄**，注册表改动
     必须同步本表——防止「注册表与规格漂移」被自引用断言掩盖。 */
  const ASSIGNED = {
    deepspace: "segment",
    rosepine: "segment",
    fidenza: "segment",
    migration: "segment",
    circuit: "segment",
    linear: "bar",
    obsidian: "bar",
    chamber: "bar",
    reagent: "bar",
    fluoro: "ring",
    lotus: "ring",
    fermata: "ring"
  };
  assert.deepEqual([...COSMOS_SKIN_IDS].sort(), Object.keys(ASSIGNED).sort(), "指派表覆盖全部 12 套内置皮肤（无一缺席/多余）");
  for (const entry of COSMOS_SKINS) {
    assert.equal(typeof entry.progressShape, "string", entry.id + ": progressShape 字段在册（可选字段已落值）");
    assert.ok(COSMOS_PROGRESS_SHAPES.includes(entry.progressShape), entry.id + ": progressShape 落在枚举内");
    assert.equal(entry.progressShape, ASSIGNED[entry.id], entry.id + ": progressShape 与指派表一致");
  }
  const byShape = (shape) => COSMOS_SKINS.filter((entry) => entry.progressShape === shape).map((entry) => entry.id);
  assert.equal(byShape("segment").length, 5, "segment 5 套");
  assert.equal(byShape("bar").length, 4, "bar 4 套");
  assert.equal(byShape("ring").length, 3, "ring 3 套");
  assert.deepEqual(byShape("ring"), ["fluoro", "lotus", "fermata"], "ring 指派（培养皿/涟漪/倚音弧）");
  /* clamp 纯函数（MUST NOT 抛错）：枚举内原样，其余一律 segment。 */
  for (const shape of COSMOS_PROGRESS_SHAPES) assert.equal(progressShapeOf(shape), shape, "枚举内原样：" + shape);
  for (const bad of [undefined, null, "", "nope", 42, {}, [], ["ring"], "Segment", " bar", "bar ", "segment\n"]) {
    assert.equal(progressShapeOf(bad), "segment", "枚举外 clamp 为 segment：" + JSON.stringify(bad));
  }
}

/* ── 2. 接口完备 + 语义色域 ── */
const PALETTE_PROP_KEYS = ["proto", "created", "reviewed", "executed"];
const PALETTE_SESS_KEYS = ["idle", "busy", "waiting", "done-unread", "free"];
const HEX = /^#[0-9a-f]{6}$/i;
for (const entry of COSMOS_SKINS) {
  const skin = createSkin(entry.id);
  const tag = entry.id + ": ";
  assert.equal(skin.skin, entry.id, tag + "skin id");
  assert.equal(typeof skin.useBand, "boolean", tag + "useBand");
  assert.equal(skin.skin, entry.id, tag + "实例 id 与注册表一致");
  assert.equal(typeof skin.background, "function", tag + "background");
  assert.equal(typeof skin.drawBody, "function", tag + "drawBody");
  assert.equal(typeof skin.bgStarColor, "function", tag + "bgStarColor");
  assert.ok(Array.isArray(skin.dustColors) && skin.dustColors.length === 2, tag + "dust 双色");
  assert.ok(!("captionHTML" in skin), tag + "无 captionHTML（SRC 侧无消费点）");
  assert.deepEqual(Object.keys(skin.palette.prop).sort(), [...PALETTE_PROP_KEYS].sort(), tag + "prop 四态键");
  assert.deepEqual(Object.keys(skin.palette.sess).sort(), [...PALETTE_SESS_KEYS].sort(), tag + "sess 五态键");
  for (const key of PALETTE_PROP_KEYS) assert.match(skin.palette.prop[key], HEX, tag + "prop." + key + " 为 hex");
  for (const key of PALETTE_SESS_KEYS) assert.match(skin.palette.sess[key], HEX, tag + "sess." + key + " 为 hex");
  /* 色域不变式的最小可机检面：金域 executed 必须与冷亮 created / reviewed 都不同；
     星胚 proto 与 created 不同；待决策 waiting 与完成未读 done-unread 不同。 */
  assert.notEqual(skin.palette.prop.executed, skin.palette.prop.created, tag + "executed ≠ created（金域 vs 冷亮域）");
  assert.notEqual(skin.palette.prop.executed, skin.palette.prop.reviewed, tag + "executed ≠ reviewed");
  assert.notEqual(skin.palette.prop.proto, skin.palette.prop.created, tag + "proto ≠ created（星胚可辨）");
  assert.notEqual(skin.palette.prop.reviewed, skin.palette.prop.created, tag + "reviewed 升亮于 created");
  assert.notEqual(skin.palette.sess.waiting, skin.palette.sess["done-unread"], tag + "待决策 ≠ 完成未读");
  for (const m of [0.2, 0.6, 0.95]) assert.equal(typeof skin.bgStarColor(m), "string", tag + "bgStarColor(" + m + ")");
}

/* ── 3. background + drawBody 全分支桩执行（引擎实喂条目形状） ── */
const view = {
  W: 800, H: 600, t: 1.25,
  bgStars: [{ x: 5, y: 5, m: 0.95, a: 0.5 }, { x: 9, y: 9, m: 0.4, a: 0.2 }],
  band: [{ x: 5, y: 5, m: 0.5, a: 0.3 }, { x: 8, y: 2, m: 0.9, a: 0.4 }]
};
const trail = [{ x: 0, y: 0 }, { x: 4, y: 4 }];
function itemsOf(ws) {
  return [
    { kind: "dust", z: 0, pts: [{ x: 1, y: 1, s: 1, a: 0.5, hue: 0.2, born: 0.2 }], ws, alpha: 1 },
    { kind: "constline", z: 0, segs: [
      { a: { x: 0, y: 0 }, b: { x: 9, y: 9 }, alpha: 0.5 },
      /* 关联聚焦段（cosmos-relation-focus 6.2）：rel 标记 = 增强语义——适配皮肤增亮，
         未适配皮肤忽略标记回落普通段（本条让 12 套皮肤都执行到带标记的形状）。 */
      { a: { x: 2, y: 2 }, b: { x: 7, y: 4 }, alpha: 1, rel: true, relAlpha: 0.6 }
    ], ws, alpha: 1 },
    /* 空槽装饰点（add-cosmos-template-figure-display 3.2）：`patdot` 装饰层条目——
       12 套皮肤各自母语取色/基线落地，α 恒低于同皮肤图样线段。 */
    { kind: "patdot", z: 0, pts: [{ x: 3, y: 4, r: 1.4, a: 0.22 }, { x: 7, y: 8, r: 1.1, a: 0.22 }], ws, alpha: 1, pat: true },
    { kind: "orbit", z: 0, orbitPts: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 9, y: 2 }], ws, alpha: 1, data: {}, rel: true, relAlpha: 0.7 },
    /* 恒星：四态 × fx/birth 组合 */
    { kind: "star", z: 0, x: 3, y: 3, r: 6, alpha: 1, hovered: true, selected: false, ws, fx: { type: "surge", t0: 0, dur: 1.2 }, birth: { alpha: 0.6, k: 0.4, degraded: false, trailAlpha: 0.6 }, data: { id: "s-exec", lifecycle: "executed", act: 1, starIndex: 0 } },
    { kind: "star", z: 0, x: 3, y: 3, r: 6, alpha: 1, hovered: false, selected: true, ws, fx: { type: "ignite", t0: 0, dur: 2.2 }, data: { id: "s-proto", lifecycle: "proto", act: 0, starIndex: 1 } },
    { kind: "star", z: 0, x: 3, y: 3, r: 6, alpha: 1, hovered: false, selected: false, ws, fx: { type: "stamp", t0: 0, dur: 1.6 }, data: { id: "s-reviewed", lifecycle: "reviewed", act: 0.5 } },
    { kind: "star", z: 0, x: 3, y: 3, r: 6, alpha: 1, hovered: false, selected: false, ws, fx: null, birth: { alpha: 1, k: 0.2, degraded: true }, data: { id: "s-created", lifecycle: "created", act: 0 } },
    /* 行星：colorMix 滑移 + fx.view 渐熄 + birth + delegatedBusy + trail */
    { kind: "planet", z: 0, x: 4, y: 4, r: 5, alpha: 1, ws, trail, fx: { type: "view", t0: 0, dur: 2.2 }, birth: { alpha: 0.9, k: 0.5, degraded: false }, data: { id: "p1", state: "done-unread", colorMix: { from: "waiting", to: "done-unread", t0: 0, dur: 0.6 }, delegatedBusy: true, phase: 1 } },
    { kind: "planet", z: 0, x: 4, y: 4, r: 5, alpha: 1, ws, trail, fx: null, data: { id: "p2", state: "waiting", colorMix: null, delegatedBusy: false, phase: 0 } },
    { kind: "planet", z: 0, x: 4, y: 4, r: 5, alpha: 1, ws, trail, fx: null, data: { id: "p3", state: "idle", colorMix: { from: "idle", to: "busy", t0: 0.0, dur: 0.6 } } },
    { kind: "suborbit", z: 0, orbitPts: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 9, y: 2 }], ws, alpha: 1, data: { state: "waiting" }, rel: true, relAlpha: 0.5 },
    { kind: "sat", z: 1, x: 5, y: 5, r: 4, alpha: 1, ws, trail, bornK: 0.5, data: { id: "sat1", state: "waiting", colorMix: { from: "idle", to: "waiting", t0: 0, dur: 0.6 } } },
    { kind: "sat", z: 1, x: 5, y: 5, r: 4, alpha: 1, ws, trail, bornK: null, data: { id: "sat2", state: "idle", colorMix: null } },
    { kind: "comet", z: 0, x: 5, y: 5, r: 5, alpha: 1, ws, trail, fx: { type: "view", t0: 0, dur: 2.2 }, birth: { alpha: 0.8, trailAlpha: 0.5, k: 0.5, degraded: false }, data: { id: "c1", state: "waiting", delegatedBusy: true, colorMix: { from: "idle", to: "waiting", t0: 0, dur: 0.6 } } },
    { kind: "comet", z: 0, x: 5, y: 5, r: 5, alpha: 1, ws, trail, fx: null, data: { id: "c2", state: "idle", colorMix: null } },
    { kind: "wsghost", z: 0, dust: [{ x: 1, y: 1, s: 1, a: 0.5, hue: 0.2 }], stars: [{ x: 2, y: 2, r: 6, a: 0.5, color: "#ffffff" }], alpha: 1, k: 0.5 },
    { kind: "nova", z: 0, x: 6, y: 6, r: 6, k: 0.5, alpha: 1, data: { id: "n1", color: "#ffc24a", dur: 2.4, intensity: 1, degraded: false }, drift: { x: 0, y: 0 } },
    { kind: "nova", z: 0, x: 6, y: 6, r: 6, k: 0.5, alpha: 1, data: { id: "n2", color: "#ffc24a", dur: 2.4, intensity: 1, degraded: true }, drift: null },
    { kind: "nova", z: 0, x: 6, y: 6, r: 6, k: 0.5, alpha: 1, data: { id: "n3", color: "#8a9bc0", dur: 0.8, intensity: 0.3 }, drift: null },
    { kind: "meteor", z: 1, x: 6, y: 6, r: 2, alpha: 1, trail }
  ];
}
for (const entry of COSMOS_SKINS) {
  const skin = createSkin(entry.id);
  const { ctx } = countingCtx(() => {});
  assert.doesNotThrow(() => skin.background(ctx, view), entry.id + ": background 可执行");
  const ws = { id: "ws-" + entry.id, proj: { x: 100, y: 100, s: 1.2 }, alpha: 1 };
  for (const item of itemsOf(ws)) {
    assert.doesNotThrow(() => skin.drawBody(ctx, item, view), entry.id + ": drawBody " + item.kind + " 可执行");
  }
  /* 第二帧（t 变化）全分支重跑：器皿守卫跨帧重开、转场窗口位移不抛错。 */
  const view2 = { ...view, t: 1.9 };
  for (const item of itemsOf(ws)) {
    assert.doesNotThrow(() => skin.drawBody(ctx, item, view2), entry.id + ": drawBody " + item.kind + " 次帧可执行");
  }
}

/* ── 4. 器皿帧内去重（design D9）：同帧同星座只绘制一次 ──
   口径：空 pts 的 dust 条目 = 「器皿原语 + 该皮肤 dust 分支的固定残余原语（R）」。
   残余 R 用 proj=null 的 ws 单次调用实测（器皿早退 → 只剩残余），因此：
     · 同帧两次调用应 = one + R（器皿只画一次，残余按调用计）；
     · 换帧一次调用应 = one（守卫重开）。 */
for (const entry of COSMOS_SKINS) {
  const skin = createSkin(entry.id);
  const wsOk = { id: "vessel-" + entry.id, proj: { x: 120, y: 90, s: 1.4 }, alpha: 1 };
  const wsNoProj = { id: "vessel-noproj-" + entry.id, proj: null, alpha: 1 };
  const emptyDust = (ws) => ({ kind: "dust", z: 0, pts: [], ws, alpha: 1 });
  const draw = (ctx, ws, t) => skin.drawBody(ctx, emptyDust(ws), { ...view, t });
  const run = (times, ws, t) => {
    const probe = countingCtx(() => {});
    for (let i = 0; i < times; i++) draw(probe.ctx, ws, t);
    return probe.state.ops;
  };
  const residual = run(1, wsNoProj, 3.5); // 器皿早退 → 单次调用的固定残余
  const one = run(1, wsOk, 3.51); // 器皿一次 + 残余
  const twice = run(2, wsOk, 3.52); // 同帧重复条目：器皿仍只一次
  const next = run(1, wsOk, 3.53); // 换帧：守卫重开
  assert.equal(twice, one + residual,
    entry.id + ": 同帧同星座重复条目 → 器皿只绘制一次（one=" + one + " twice=" + twice + " residual=" + residual + "）");
  assert.equal(next, one, entry.id + ": 换帧后守卫重开（同星座再绘制一次）");
}

/* ── 5. HUD 令牌表完备 + deepspace 基线现值 ── */
{
  assert.equal(COSMOS_HUD_TOKENS.length, 27, "令牌全集 27 枚（24 色 + 3 通道；add-cosmos-embryo-cards 26→27）");
  for (const entry of COSMOS_SKINS) {
    const hud = skinHudOf(entry.id);
    assert.equal(Object.keys(hud).length, COSMOS_HUD_TOKENS.length, entry.id + ": 令牌键数");
    for (const name of COSMOS_HUD_TOKENS) {
      assert.equal(typeof hud[name], "string", entry.id + ": 令牌 " + name);
      assert.ok(hud[name].length > 0, entry.id + ": 令牌 " + name + " 非空");
    }
    /* 语义别名与 palette 同源（杜绝手抄漂移） */
    const skin = createSkin(entry.id);
    assert.equal(hud["--cos-lc-created"], skin.palette.prop.created, entry.id + ": lc-created 取自 palette");
    assert.equal(hud["--cos-lc-reviewed"], skin.palette.prop.reviewed, entry.id + ": lc-reviewed 取自 palette");
    assert.equal(hud["--cos-lc-executed"], skin.palette.prop.executed, entry.id + ": lc-executed 取自 palette");
    assert.equal(hud["--cos-lc-proto"], skin.palette.prop.proto, entry.id + ": lc-proto 取自 palette（星胚卡随肤取色）");
    assert.equal(hud["--cos-waiting"], skin.palette.sess.waiting, entry.id + ": waiting 语义别名");
    assert.equal(hud["--cos-done"], skin.palette.sess["done-unread"], entry.id + ": done 语义别名");
    assert.match(hud["--cos-accent-rgb"], /^\d{1,3} \d{1,3} \d{1,3}$/, entry.id + ": accent 通道令牌格式");
  }
  /* deepspace = 改造前现值（全部 var(--cos-*, fallback) 的 fallback 基线） */
  const base = skinHudOf("deepspace");
  assert.equal(base["--cos-bg"], "#070812");
  assert.equal(base["--cos-ink"], "#ffe9cf");
  assert.equal(base["--cos-accent-ink"], "#ffe3b8");
  assert.equal(base["--cos-accent"], "#ffd28a");
  assert.equal(base["--cos-glow"], "rgba(255,210,140,.55)");
  assert.equal(base["--cos-line"], "rgba(255,210,140,.35)");
  assert.equal(base["--cos-line-strong"], "#ffd28a");
  assert.equal(base["--cos-panel"], "rgba(8,8,16,.88)");
  assert.equal(base["--cos-chip-bg"], "rgba(10,10,20,.45)");
  assert.equal(base["--cos-hover"], "rgba(255,210,140,.12)");
  assert.equal(base["--cos-scan"], "rgba(255,230,190,.02)");
  assert.equal(base["--cos-shadow"], "none");
  assert.equal(base["--cos-lc-created"], "#9fd8ff");
  assert.equal(base["--cos-lc-reviewed"], "#cfe8ff");
  assert.equal(base["--cos-lc-executed"], "#ffe27a");
  assert.equal(base["--cos-lc-proto"], "#8a9bc0", "deepspace 星胚灰蓝基线（与 skin-d palette.prop.proto 同值）");
  assert.equal(base["--cos-waiting"], "#ffaa4a");
  assert.equal(base["--cos-done"], "#5affc0");
  assert.equal(base["--cos-accent-rgb"], "255 210 140");
  assert.equal(base["--cos-ink-rgb"], "255 233 207");
  assert.equal(base["--cos-accent-ink-rgb"], "255 227 184");
  assert.equal(skinHudOf("nope"), skinHudOf(COSMOS_DEFAULT_SKIN), "未知 id → 默认皮肤令牌表");
}

/* ── 6. 令牌下发（唯一写者）+ data-cos-mode + data-cos-progress ── */
{
  const makeEl = () => {
    const props = new Map();
    return {
      props,
      dataset: {},
      style: { setProperty(name, value) { props.set(name, value); } }
    };
  };
  const dark = makeEl();
  assert.equal(applySkinTokens(dark, "deepspace"), true, "下发 deepspace");
  assert.equal(dark.props.size, COSMOS_HUD_TOKENS.length, "逐枚 setProperty");
  assert.equal(dark.props.get("--cos-bg"), "#070812");
  assert.equal(dark.dataset.cosMode, "dark", "data-cos-mode=dark");
  assert.equal(dark.dataset.cosProgress, "segment", "data-cos-progress=segment（deepspace 指派）");
  const light = makeEl();
  assert.equal(applySkinTokens(light, createSkin("fidenza")), true, "按皮肤实例下发（接口签名）");
  assert.equal(light.dataset.cosMode, "light", "fidenza → data-cos-mode=light");
  assert.equal(light.dataset.cosProgress, "segment", "fidenza → data-cos-progress=segment（按实例 id 解析注册表项）");
  assert.equal(light.props.get("--cos-scan"), "transparent", "纸面皮肤扫描线令牌关闭");
  assert.notEqual(light.props.get("--cos-shadow"), "none", "纸面皮肤柔和投影");

  /* 形状通道逐肤抽查（4.3）：三种形态各取一套，值必须与注册表指派一致。 */
  for (const [id, shape] of [["rosepine", "segment"], ["linear", "bar"], ["obsidian", "bar"], ["fermata", "ring"], ["lotus", "ring"]]) {
    const el = makeEl();
    assert.equal(applySkinTokens(el, id), true, "下发 " + id);
    assert.equal(el.dataset.cosProgress, shape, id + " → data-cos-progress=" + shape);
    assert.equal(el.dataset.cosProgress, skinEntryOf(id).progressShape, id + "：下发值 = 注册表项取值");
  }
  /* 下发点恒经 clamp 纯函数（2.2）：逐肤下发值 = progressShapeOf(注册表项取值)，
     任何路径都不可能把枚举外值写进根属性。 */
  for (const entry of COSMOS_SKINS) {
    const el = makeEl();
    assert.equal(applySkinTokens(el, entry.id), true, "下发 " + entry.id);
    assert.equal(el.dataset.cosProgress, progressShapeOf(entry.progressShape), entry.id + "：下发值经 progressShapeOf clamp");
    assert.ok(COSMOS_PROGRESS_SHAPES.includes(el.dataset.cosProgress), entry.id + "：下发值恒在枚举内");
  }
  /* 外部注入实例（只按 id 解析注册表项）落值同源——注入的未知形状字段不参与下发。 */
  for (const badShape of [undefined, null, "nope", 42, "ring"]) {
    const el = makeEl();
    assert.equal(applySkinTokens(el, { hud: skinHudOf("rosepine"), id: "rosepine", mode: "dark", progressShape: badShape }), true, "外部注入实例下发（形状字段 " + JSON.stringify(badShape) + "）");
    assert.equal(el.dataset.cosProgress, "segment", "外部注入形状字段不参与下发（注册表项为准，恒枚举内）");
  }
  const missing = makeEl();
  assert.equal(applySkinTokens(missing, "nope"), false, "未知皮肤 → false 不抛错");
  assert.equal(missing.props.size, 0, "未知皮肤不写任何令牌");
  assert.equal(missing.dataset.cosProgress, undefined, "未知皮肤不写形状属性（零副作用）");
  assert.equal(applySkinTokens(null, "deepspace"), false, "根容器缺失 → false");
  assert.equal(applySkinTokens(makeEl(), null), false, "皮肤缺失 → false");
}

/* ── 7. 纸面皮肤性能纪律（design D8）：fidenza MUST NOT 使用 lighter 加色路径 ── */
{
  const source = readFileSync(new URL("../src/cosmos/skins/skin-fidenza.mjs", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/globalCompositeOperation\s*=\s*['"]lighter['"]/.test(source), "fidenza: 无 lighter 加色合成（水彩晕走 source-over 低 α）");
  assert.ok(!/glow\.draw\(/.test(source), "fidenza: 不消费加色辉光（只用 wash）");
  assert.ok(/glow\.wash\(|wash\(/.test(source), "fidenza: 走 wash 水彩晕");
  const lightHud = skinHudOf("fidenza");
  assert.equal(lightHud["--cos-scan"], "transparent", "fidenza: 扫描线令牌关闭");
  assert.notEqual(lightHud["--cos-shadow"], "none", "fidenza: 纸面柔影令牌有效");
}

/* ── 8. 实例缓存隔离 + 设置页卡片数据 ── */
{
  assert.equal(createSkin("rosepine"), createSkin("rosepine"), "同 id 返回同一实例（缓存）");
  assert.notEqual(createSkin("rosepine"), createSkin("deepspace"), "不同 id → 不同实例（glow 缓存隔离）");
  assert.notEqual(createSkin("lotus"), createSkin("reagent"), "不同 id → 不同实例");
  const entry = skinEntryOf("chamber");
  assert.notEqual(entry.create(), entry.create(), "工厂每次产出新实例（缓存键不串）");
  for (const id of COSMOS_SKIN_IDS) {
    const card = skinCardOf(skinEntryOf(id));
    assert.equal(card.id, id);
    assert.equal(card.swatches.length, 5, id + ": 预览色板 5 色");
    for (const color of card.swatches) assert.ok(typeof color === "string" && color.length > 0, id + ": 色板色值");
    assert.equal(card.isDefault, id === COSMOS_DEFAULT_SKIN, id + ": 默认徽标仅 rosepine");
  }
  assert.deepEqual(COSMOS_SKINS.map((e) => e.id), [...EXPECTED_IDS], "卡片顺序 = 注册表顺序");
}

console.log("skin-registry-smoke ok · " + COSMOS_SKIN_IDS.length + " 套皮肤 × (接口 / 全分支 / 器皿去重 / 令牌表 / 下发)");
