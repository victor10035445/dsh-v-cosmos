/**
 * 引擎与皮肤模块冒烟（add-cosmos-entry 4.3/4.4）：模块可导入（import 时零 DOM 副作用）、
 * 皮肤接口形状（palette + background + drawBody，R5 引擎无关）、引擎公共面。
 * 运行：node test/engine-smoke.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCosmosEngine, ENGINE_CSS, panBasis, panCameraTarget, panCameraTargetByDrag, PAN_SPEED, PAN_SHIFT_BOOST, PAN_DRAG_FACTOR, SESSION_OPEN_KEY, makeNova, stepNovae, buildScenePure, FX_PRIORITY, FX_NOVA_DUR, FX_NOVA_PROTO_DUR, BOOT_DUR, isEditableTarget, boundingSphereOf, fitCameraOf, FILTER_RAMP_DUR, FILTER_SHIFT_DUR, FILTER_FIT_DUR, FILTER_FIT_MARGIN, WS_SHIFT_DUR, WS_BIRTH_HL_DUR, GESTURE_SUPPRESS_MS, zoomSwitchVerdict, zoomFocusTargetOf, canvasPointOf, constellationBoundROf, DIVE_REF, SWITCH_COOLDOWN_MS, CENTER_GATE_RATIO, DIVE_SAFE_MARGIN, FLYOUT_DIST_FLOOR_MULT, COMET_WANDER_R, STAR_FOCUS_DIST, STAR_FOCUS_DUR, SHOCK_SPEED, SHOCK_HOLD_MIN, SHOCK_HOLD_MAX, SHOCK_KICK_DUR, SHOCK_GLIDE_DUR, SHOCK_TOTAL_MAX, shockHitOf, shockEjectionAt, shockTotalDurOf, adoptTrailAcrossKinds, resolveBlastCoreOf, CAPTURE_DUR, COMET_WANDER_AMP, COMET_WANDER_FREQ, cometHeadingAt, orbitPointAt, orbitTangentAt, captureRingPointAt, capturePoseAt, TIP_GAP, TIP_LINE, tipLeaderOf, tipLineColorOf } from "../src/cosmos/engine.mjs";
import { createSkinD, createSkinDeepspace, SKIN_D_PALETTE } from "../src/cosmos/skin-d.mjs";
import { COSMOS_SKINS, COSMOS_SKIN_IDS, createSkin } from "../src/cosmos/skin-registry.mjs";
import { COSMOS_SETTINGS_DEFAULTS, COSMOS_SETTINGS_BOUNDS, COSMOS_SETTINGS_VERSION, sanitizeCosmosSettings, loadCosmosSettings, saveCosmosSettings, cosmosLayoutTokensOf } from "../src/settings.mjs";

/* import 时不允许触碰 document/window（引擎/皮肤均为挂载期才用 DOM）。 */
assert.equal(typeof createCosmosEngine, "function", "engine 工厂导出");
assert.equal(typeof createSkinD, "function", "skin 工厂导出");
assert.equal(createSkinD, createSkinDeepspace, "skin-d 导出改名，旧名保留为同一引用别名（1.2）");
assert.ok(ENGINE_CSS.includes(".cos-root"), "ENGINE_CSS 随模块导出（含根容器样式）");
assert.ok(ENGINE_CSS.includes("repeating-linear-gradient"), "扫描线参数保留（风格 D 语言）");

/* 皮肤接口（palette + drawBody 保持引擎无关，design.md R5）。 */
const skin = createSkinD();
assert.equal(skin.skin, "deepspace", "deepspace 皮肤 id（注册表注册名）");
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
  assert.deepEqual(
    COSMOS_SETTINGS_DEFAULTS,
    {
      panSpeed: 120, panShiftBoost: 3, skin: "rosepine", zoomDiveRatio: 100, zoomFlyOutRatio: 25,
      zoomPointerFocus: true, sessionPanelOpen: true, constPreflight: "float", dragPan: false,
      /* 界面尺寸 12 键（add-cosmos-layout-tuning D2）：缺省 = 引入配置面之前的现值。 */
      sessionPanelWidth: 260, sessionPanelHeight: 0, constPanelWidth: 187, constPanelHeight: 0,
      addBtnSize: 44, hudBtnSize: 44, actionBtnWidth: 112, actionBtnHeight: 40,
      constActionHeight: 40, searchWidth: 320, searchHeight: 0, wsTitleSize: 13
    },
    "出厂默认（含默认皮肤、缩放导航三键、会话面板展开态、发送前编辑分支 float、拖拽平移关闭、界面尺寸 12 键 = 现值）"
  );
  assert.equal(COSMOS_SETTINGS_VERSION, 7, "设置面 v7（新增界面尺寸 12 键）");
  assert.deepEqual(sanitizeCosmosSettings({}), COSMOS_SETTINGS_DEFAULTS, "空配置 → 默认");
  assert.deepEqual(
    sanitizeCosmosSettings({ panSpeed: 999, panShiftBoost: 0, hacker: 1 }),
    {
      panSpeed: COSMOS_SETTINGS_BOUNDS.panSpeed[1],
      panShiftBoost: COSMOS_SETTINGS_BOUNDS.panShiftBoost[0],
      skin: "rosepine",
      zoomDiveRatio: 100,
      zoomFlyOutRatio: 25,
      zoomPointerFocus: true,
      sessionPanelOpen: true,
      constPreflight: "float",
      dragPan: false,
      sessionPanelWidth: 260, sessionPanelHeight: 0, constPanelWidth: 187, constPanelHeight: 0,
      addBtnSize: 44, hudBtnSize: 44, actionBtnWidth: 112, actionBtnHeight: 40,
      constActionHeight: 40, searchWidth: 320, searchHeight: 0, wsTitleSize: 13
    },
    "越界落端点 + 未知键剥离"
  );
  assert.deepEqual(
    sanitizeCosmosSettings({ panSpeed: "not-a-number" }),
    { ...COSMOS_SETTINGS_DEFAULTS, panSpeed: 120 },
    "非法值 → 默认"
  );
  /* 页面偏好面 MUST NOT 含「跳转/新建会话」键（二者属按钮配置，见 buttons-schema 冒烟） */
  assert.equal("actionJumpNewSession" in COSMOS_SETTINGS_DEFAULTS, false, "跳转属每按钮配置，不进页面偏好面");
  /* Node 无 localStorage → 读面回落默认（持久化读写守卫路径） */
  assert.deepEqual(loadCosmosSettings(), COSMOS_SETTINGS_DEFAULTS, "无存储面 → 默认");
}

/* ── 皮肤偏好净房（add-cosmos-skin-themes 3.3/3.6 / spec「皮肤选择设置页签」） ── */
{
  assert.deepEqual(
    Object.keys(COSMOS_SETTINGS_BOUNDS).sort(),
    [
      "actionBtnHeight", "actionBtnWidth", "addBtnSize", "constActionHeight",
      "constPanelHeight", "constPanelWidth", "hudBtnSize", "panShiftBoost",
      "panSpeed", "searchHeight", "searchWidth", "sessionPanelHeight",
      "sessionPanelWidth", "wsTitleSize", "zoomDiveRatio", "zoomFlyOutRatio"
    ],
    "BOUNDS 保持纯数值形状（不混入枚举/布尔键；界面尺寸 12 键全为数值界）"
  );
  assert.equal(COSMOS_SKIN_IDS.length, 12, "枚举来源 = 注册表 12 套");
  /* 合法 id 透传（逐枚） */
  for (const id of COSMOS_SKIN_IDS) {
    assert.equal(sanitizeCosmosSettings({ skin: id }).skin, id, "合法皮肤透传：" + id);
  }
  /* 非法/未知值 → 回落默认（不抛错） */
  for (const bad of ["nope", "", 42, null, undefined, {}, [], "DeepSpace", " deepspace "]) {
    assert.equal(sanitizeCosmosSettings({ skin: bad }).skin, "rosepine", "非法皮肤回落默认：" + String(bad));
  }
  /* v1/v2/v3 载荷（无后续新增键）→ 逐键补默认；数值仍按界净房 */
  const v1 = sanitizeCosmosSettings({ panSpeed: 250, panShiftBoost: 4 });
  assert.deepEqual(v1, { ...COSMOS_SETTINGS_DEFAULTS, panSpeed: 250, panShiftBoost: 4 }, "v1 载荷补默认皮肤、缩放导航三键与会话面板展开态");
  /* 写侧净房：合法 skin 不被剥离；未知键仍剥离 */
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key)
  };
  try {
    const saved = saveCosmosSettings({ skin: "lotus" });
    assert.equal(saved.skin, "lotus", "写侧保留合法 skin");
    assert.equal(loadCosmosSettings().skin, "lotus", "读回同一皮肤");
    assert.deepEqual(JSON.parse(store.get("dsh-v-cosmos:settings")), { ...COSMOS_SETTINGS_DEFAULTS, skin: "lotus" }, "落盘形状 = v3 净房结果");
    saveCosmosSettings({ skin: "非法id", hacker: true });
    assert.equal(loadCosmosSettings().skin, "rosepine", "非法皮肤写侧回落默认");
    assert.equal("hacker" in JSON.parse(store.get("dsh-v-cosmos:settings")), false, "未知键写侧剥离");
    /* 手工改坏 localStorage（场景：任意非法字符串）→ 打开时按默认渲染 */
    store.set("dsh-v-cosmos:settings", JSON.stringify({ panSpeed: 120, panShiftBoost: 3, skin: "totally-not-a-skin" }));
    assert.equal(loadCosmosSettings().skin, "rosepine", "持久值非法 → 读面回落默认（无报错）");
    /* v1 旧载荷（磁盘上无 skin 键）→ 补默认 */
    store.set("dsh-v-cosmos:settings", JSON.stringify({ panSpeed: 180, panShiftBoost: 2 }));
    assert.deepEqual(loadCosmosSettings(), { ...COSMOS_SETTINGS_DEFAULTS, panSpeed: 180, panShiftBoost: 2 }, "v1 磁盘载荷兼容（缩放导航键补默认）");
  } finally {
    delete globalThis.localStorage;
  }
}

/* ── 界面尺寸净房 + 布局令牌投影（add-cosmos-layout-tuning 1.3 / D1–D3）：
   缺省 = 现值 / 合法值透传 / 越界夹取 / 非数字回落 / v6 载荷补默认 / 0 = 自适应 ── */
{
  const sizeKeys = [
    "sessionPanelWidth", "sessionPanelHeight", "constPanelWidth", "constPanelHeight",
    "addBtnSize", "hudBtnSize", "actionBtnWidth", "actionBtnHeight",
    "constActionHeight", "searchWidth", "searchHeight", "wsTitleSize"
  ];
  const defaults = {
    sessionPanelWidth: 260, sessionPanelHeight: 0, constPanelWidth: 187, constPanelHeight: 0,
    addBtnSize: 44, hudBtnSize: 44, actionBtnWidth: 112, actionBtnHeight: 40,
    constActionHeight: 40, searchWidth: 320, searchHeight: 0, wsTitleSize: 13
  };
  for (const key of sizeKeys) {
    assert.equal(COSMOS_SETTINGS_DEFAULTS[key], defaults[key], key + " 缺省 = 现值");
    assert.ok(Array.isArray(COSMOS_SETTINGS_BOUNDS[key]) && COSMOS_SETTINGS_BOUNDS[key].length === 2, key + " 界为纯数值 [min,max]");
  }

  /* 合法值透传（逐键取界内端点） */
  const atMax = {};
  for (const key of sizeKeys) atMax[key] = COSMOS_SETTINGS_BOUNDS[key][1];
  const accepted = sanitizeCosmosSettings(atMax);
  for (const key of sizeKeys) assert.equal(accepted[key], atMax[key], key + " 界内端点透传");

  /* 越界落端点 / 非数值回落缺省（含空串、对象、null——SHALL NOT 抛错） */
  const over = {};
  for (const key of sizeKeys) over[key] = COSMOS_SETTINGS_BOUNDS[key][1] + 1000;
  const clamped = sanitizeCosmosSettings(over);
  for (const key of sizeKeys) assert.equal(clamped[key], COSMOS_SETTINGS_BOUNDS[key][1], key + " 越界落上端");
  const bad = {};
  for (const key of sizeKeys) bad[key] = "not-a-number";
  assert.deepEqual(
    sizeKeys.map((key) => sanitizeCosmosSettings(bad)[key]),
    sizeKeys.map((key) => defaults[key]),
    "非数字一律回落缺省（12 键）"
  );

  /* v6 旧载荷（无尺寸键）→ 逐键补默认 */
  const v6 = {
    panSpeed: 120, panShiftBoost: 3, skin: "rosepine", zoomDiveRatio: 100, zoomFlyOutRatio: 25,
    zoomPointerFocus: true, sessionPanelOpen: true, constPreflight: "float", dragPan: false
  };
  const migrated = sanitizeCosmosSettings(v6);
  for (const key of sizeKeys) assert.equal(migrated[key], defaults[key], key + " v6 载荷补默认");

  /* 高度键 0 是合法值（= 自适应），MUST NOT 被 falsy 判定吞掉 */
  assert.equal(sanitizeCosmosSettings({ sessionPanelHeight: 0, searchHeight: 0 }).sessionPanelHeight, 0, "高度 0 透传（自适应）");

  /* 令牌投影（cosmosLayoutTokensOf，纯函数）：缺省 → 现值 px + 高度 none */
  const tokens = cosmosLayoutTokensOf(COSMOS_SETTINGS_DEFAULTS);
  assert.deepEqual(
    tokens,
    {
      "--cos-session-w": "260px",
      "--cos-session-h": "none",
      "--cos-const-panel-w": "187px",
      "--cos-const-panel-h": "none",
      "--cos-add-btn-size": "44px",
      "--cos-hud-btn-size": "44px",
      "--cos-action-btn-w": "112px",
      "--cos-action-btn-h": "40px",
      "--cos-const-action-h": "40px",
      "--cos-search-w": "320px",
      "--cos-search-h": "0px",
      "--cos-ws-title-size": "13px"
    },
    "缺省投影 = 现值字面量（高度 none = 不设上限）"
  );
  const custom = cosmosLayoutTokensOf({
    ...COSMOS_SETTINGS_DEFAULTS,
    sessionPanelWidth: 320, sessionPanelHeight: 600, constPanelWidth: 220,
    hudBtnSize: 56, searchWidth: 420, searchHeight: 36, wsTitleSize: 16
  });
  assert.deepEqual(
    [custom["--cos-session-w"], custom["--cos-session-h"], custom["--cos-const-panel-w"], custom["--cos-hud-btn-size"], custom["--cos-search-w"], custom["--cos-search-h"], custom["--cos-ws-title-size"]],
    ["320px", "600px", "220px", "56px", "420px", "36px", "16px"],
    "自定义投影逐键生效（高度 >0 → Npx）"
  );
  /* 缺键/非法 → 逐键回落现值（令牌层不引入第二套默认值语义） */
  const partial = cosmosLayoutTokensOf({});
  assert.equal(partial["--cos-session-w"], "260px", "缺键回落现值");
  assert.equal(partial["--cos-action-btn-w"], "112px", "缺键回落现值（动作条）");
  assert.equal(cosmosLayoutTokensOf({ wsTitleSize: "x" })["--cos-ws-title-size"], "13px", "非法值回落现值");
}

/* ── 缩放导航纯函数（add-cosmos-zoom-focus-nav 1.1/1.2/2.7）：阈值口径 / 闸门 /
   滞回下限 / 模式隔离 / 守卫 / 聚焦 target 数学 ── */
{
  const base = { minViewportPx: 600 };

  /* 进入：视距等价式（ratio 100 → vz ≤ 155；60 → 258.33；140 → 110.71），方向自洽 */
  assert.equal(DIVE_REF, 155, "钻取参考视距常量");
  assert.equal(SWITCH_COOLDOWN_MS, 800, "切换冷却窗常量");
  assert.equal(CENTER_GATE_RATIO, 0.25, "屏心闸门系数常量");
  assert.equal(FLYOUT_DIST_FLOOR_MULT, 1.35, "返回滞回下限倍率常量");
  assert.deepEqual(
    zoomSwitchVerdict({ mode: "galaxy", vz: 155, centerDistPx: 0, ...base }, { diveRatio: 100 }),
    { dive: true, flyOut: false },
    "进入：ratio=100 → vz=155 恰好触发"
  );
  assert.equal(zoomSwitchVerdict({ mode: "galaxy", vz: 155.001, centerDistPx: 0, ...base }, { diveRatio: 100 }).dive, false, "vz 越过阈值 → 不触发");
  assert.equal(zoomSwitchVerdict({ mode: "galaxy", vz: 155 / 0.6, centerDistPx: 0, ...base }, { diveRatio: 60 }).dive, true, "ratio=60 → 阈值 258.33（越小越早触发）");
  assert.equal(zoomSwitchVerdict({ mode: "galaxy", vz: 155 / 0.6 + 0.001, centerDistPx: 0, ...base }, { diveRatio: 60 }).dive, false, "ratio=60 阈值外不触发");
  assert.equal(zoomSwitchVerdict({ mode: "galaxy", vz: 155 / 1.4, centerDistPx: 0, ...base }, { diveRatio: 140 }).dive, true, "ratio=140 → 阈值 110.71");
  assert.equal(zoomSwitchVerdict({ mode: "galaxy", vz: 110.8, centerDistPx: 0, ...base }, { diveRatio: 140 }).dive, false, "ratio=140 阈值外不触发");
  /* 屏心闸门：min(W,H)×0.25（600 → 150） */
  assert.equal(zoomSwitchVerdict({ mode: "galaxy", vz: 100, centerDistPx: 150, ...base }).dive, true, "闸门边界（≤150）参与");
  assert.equal(zoomSwitchVerdict({ mode: "galaxy", vz: 100, centerDistPx: 150.001, ...base }).dive, false, "闸门外不参与");
  /* 模式隔离：galaxy 只可能 dive、drilled 只可能 flyOut */
  assert.deepEqual(zoomSwitchVerdict({ mode: "galaxy", vz: 10, centerDistPx: 0, ...base }), { dive: true, flyOut: false });
  assert.deepEqual(
    zoomSwitchVerdict({ mode: "drilled", vz: 10, centerDistPx: 0, dist: 5000, boundR: 0, f: 1000, ...base }),
    { dive: false, flyOut: true },
    "钻取态不会反向触发 dive"
  );
  /* 守卫早退：blocked 双 false（即使口径全部满足） */
  assert.deepEqual(
    zoomSwitchVerdict({ mode: "galaxy", blocked: true, vz: 1, centerDistPx: 0, ...base }),
    { dive: false, flyOut: false },
    "blocked → 早退（滚轮补间/拖拽/手势/冷却）"
  );
  assert.deepEqual(
    zoomSwitchVerdict({ mode: "drilled", blocked: true, dist: 5000, boundR: 0, f: 1000, ...base }),
    { dive: false, flyOut: false }
  );
  /* 返回：屏显直径 2·boundR·f/dist ≤ ratio×min(W,H)，且 dist ≥ 155×1.35（显式滞回） */
  const f = (600 * 1.1) / (2 * Math.tan((60 * Math.PI) / 360));
  const floor = DIVE_REF * FLYOUT_DIST_FLOOR_MULT;
  assert.equal(zoomSwitchVerdict({ mode: "drilled", dist: floor, boundR: 12, f, ...base }, { flyOutRatio: 25 }).flyOut, true, "滞回下限处可返回（直径已远小于阈值）");
  assert.equal(zoomSwitchVerdict({ mode: "drilled", dist: floor - 0.01, boundR: 12, f, ...base }, { flyOutRatio: 25 }).flyOut, false, "刚进入（dist=155）绝不误返回");
  assert.equal(zoomSwitchVerdict({ mode: "drilled", dist: 800, boundR: 100, f, ...base }, { flyOutRatio: 25 }).flyOut, true, "直径 ≤ 25% 短边 → 返回");
  assert.equal(zoomSwitchVerdict({ mode: "drilled", dist: 700, boundR: 100, f, ...base }, { flyOutRatio: 25 }).flyOut, false, "直径仍大于阈值 → 不返回");
  assert.equal(zoomSwitchVerdict({ mode: "drilled", dist: 2000, boundR: 100, f, ...base }, { flyOutRatio: 10 }).flyOut, true, "ratio=10（60px 上限）→ 返回");
  assert.equal(zoomSwitchVerdict({ mode: "drilled", dist: 1500, boundR: 100, f, ...base }, { flyOutRatio: 10 }).flyOut, false, "ratio=10 上限外不返回");
  assert.equal(zoomSwitchVerdict({ mode: "drilled", dist: 0, boundR: 12, f, ...base }).flyOut, false, "非法 dist → false");
  assert.equal(zoomSwitchVerdict({ mode: "drilled", dist: 800, boundR: 100, f: 0, ...base }).flyOut, false, "非法 f → false");
  assert.deepEqual(zoomSwitchVerdict(null, null), { dive: false, flyOut: false }, "空入参防御");
}

/* ── 指针聚焦 target 数学（add-cosmos-zoom-focus-nav 1.2/D3）：收敛式 / 端点冻结 /
   中心不动 / yaw·pitch 逆变换（指针世界点在新镜头下仍投影回原屏位） ── */
{
  const testRotY = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c]; };
  const testRotX = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c]; };
  const testProject = (cam, p, W, H) => {
    let v = [p[0] - cam.target[0], p[1] - cam.target[1], p[2] - cam.target[2]];
    v = testRotY(v, -cam.yaw); v = testRotX(v, -cam.pitch);
    const vz = v[2] + cam.dist;
    const fv = (H * 1.1) / (2 * Math.tan((cam.fov ?? 60) * Math.PI / 360));
    return { x: W / 2 + v[0] * fv / vz, y: H / 2 - v[1] * fv / vz, z: vz };
  };
  const cam = { target: [0, 0, 0], yaw: 0, pitch: 0, dist: 100, fov: 60 };
  const f = (600 * 1.1) / (2 * Math.tan(Math.PI / 6));
  /* 中心指针 → target 不动 */
  assert.deepEqual(zoomFocusTargetOf(cam, 400, 300, 800, 600, 80), [0, 0, 0], "屏心指针不移动 target");
  /* 端点 clamp（newDist === dist）/ 非法入参 → 原 target 拷贝 */
  assert.deepEqual(zoomFocusTargetOf(cam, 600, 300, 800, 600, 100), [0, 0, 0], "端点冻结（d1===d0）");
  const noAngles = zoomFocusTargetOf({ target: [2, 3, 4], dist: 100 }, 600, 300, 800, 600, 80);
  assert.ok(
    noAngles.every((v) => Number.isFinite(v)) && near(noAngles[1], 3, 1e-9) && near(noAngles[2], 4, 1e-9),
    "缺 yaw/pitch/fov → 默认 0/0/60（结果有限，不产生 NaN）"
  );
  assert.deepEqual(zoomFocusTargetOf(null, 0, 0, 800, 600, 80), [0, 0, 0], "空 cam 防御");
  assert.deepEqual(zoomFocusTargetOf(cam, NaN, 0, 800, 600, 80), [0, 0, 0], "非法指针坐标 → 冻结");
  assert.deepEqual(zoomFocusTargetOf(cam, 600, 300, 0, 600, 80), [0, 0, 0], "非法视口 → 冻结");
  assert.deepEqual(zoomFocusTargetOf(cam, 600, 300, 800, 600, NaN), [0, 0, 0], "非法 newDist → 冻结");
  /* 收敛式：target += (P − target) × (1 − d1/d0) */
  const step = zoomFocusTargetOf(cam, 600, 300, 800, 600, 80);
  const expectedX = 100 * (200 / f) * (1 - 80 / 100);
  assert.ok(near(step[0], expectedX, 1e-9), "x 方向收敛量 = (P−target)×(1−d1/d0)");
  assert.ok(near(step[1], 0, 1e-9) && near(step[2], 0, 1e-9), "垂直方向不动（屏心 y）");
  /* yaw/pitch：指针世界点在新镜头下仍投影回原屏位（逆变换与收敛式闭环） */
  const cam2 = { target: [10, -5, 3], yaw: 0.7, pitch: -0.4, dist: 250, fov: 55 };
  const W = 1280, H = 720, px = 650, py = 180;
  const f2 = (H * 1.1) / (2 * Math.tan((55 * Math.PI) / 360));
  const offset = testRotY(testRotX([250 * ((px - W / 2) / f2), 250 * ((H / 2 - py) / f2), 0], cam2.pitch), cam2.yaw);
  const P = [cam2.target[0] + offset[0], cam2.target[1] + offset[1], cam2.target[2] + offset[2]];
  const next2 = zoomFocusTargetOf(cam2, px, py, W, H, 180);
  const k = 1 - 180 / 250;
  assert.ok(near(next2[0], cam2.target[0] + offset[0] * k, 1e-9), "yaw/pitch 下 target 收敛（x）");
  assert.ok(near(next2[1], cam2.target[1] + offset[1] * k, 1e-9), "yaw/pitch 下 target 收敛（y）");
  assert.ok(near(next2[2], cam2.target[2] + offset[2] * k, 1e-9), "yaw/pitch 下 target 收敛（z）");
  const proj = testProject({ ...cam2, target: next2, dist: 180 }, P, W, H);
  assert.ok(near(proj.x, px, 1e-6) && near(proj.y, py, 1e-6), "焦点世界点在新镜头下投影回指针位置（聚焦语义闭环）");
}

/* ── canvasPointOf（fix-cosmos-zoom-nav-focus-deadzone 3.1）：rect 换算单源纯函数 ── */
{
  const rect = { left: 100, top: 50, right: 900, bottom: 650, width: 800, height: 600 };
  assert.deepEqual(canvasPointOf(600, 300, rect), { x: 500, y: 250 }, "视图坐标 − rect 原点 → canvas 相对坐标");
  assert.deepEqual(canvasPointOf(100, 50, rect), { x: 0, y: 0 }, "rect 左上角 → 画布原点");
  /* 越界有限坐标 MUST NOT 被截断（指针悬停在动作条等画布外区域：聚焦射线对外延线自洽） */
  assert.deepEqual(canvasPointOf(10, 5, rect), { x: -90, y: -45 }, "画布左上外延 → 负坐标不截断");
  assert.deepEqual(canvasPointOf(1000, 700, rect), { x: 900, y: 650 }, "画布右下外延 → 超画布坐标不截断");
  /* 非法入参 → null（缺坐标的合成事件 / 旧测试桩 → 聚焦回落屏心） */
  assert.equal(canvasPointOf(undefined, 300, rect), null, "缺 clientX → null");
  assert.equal(canvasPointOf(600, undefined, rect), null, "缺 clientY → null");
  assert.equal(canvasPointOf(Number.NaN, 300, rect), null, "NaN clientX → null");
  assert.equal(canvasPointOf(600, Number.POSITIVE_INFINITY, rect), null, "非有限 clientY → null");
  assert.equal(canvasPointOf(600, 300, null), null, "缺 rect → null");
  assert.equal(canvasPointOf(600, 300, {}), null, "rect 缺 left/top → null");
  assert.deepEqual(canvasPointOf("600", "300", rect), { x: 500, y: 250 }, "数值字符串按数处理（Number 口径）");
}

/* ── 缩放导航设置净房（add-cosmos-zoom-focus-nav 1.3）+ 会话面板展开态（add-cosmos-session-list-panel 3.3）：
   三键默认/界/布尔独立分支/越界与非法净化/旧载荷补默认/持久化读回 ── */
{
  assert.deepEqual(COSMOS_SETTINGS_BOUNDS.zoomDiveRatio, [60, 140], "进入阈值界 60–140");
  assert.deepEqual(COSMOS_SETTINGS_BOUNDS.zoomFlyOutRatio, [10, 50], "返回阈值界 10–50");
  assert.equal(sanitizeCosmosSettings({ zoomDiveRatio: 80 }).zoomDiveRatio, 80, "合法进入阈值透传");
  assert.equal(sanitizeCosmosSettings({ zoomDiveRatio: 9999 }).zoomDiveRatio, 140, "越界进入阈值落上端");
  assert.equal(sanitizeCosmosSettings({ zoomDiveRatio: 1 }).zoomDiveRatio, 60, "越界进入阈值落下端");
  assert.equal(sanitizeCosmosSettings({ zoomDiveRatio: 80.6 }).zoomDiveRatio, 81, "进入阈值取整（clampTo 口径）");
  assert.equal(sanitizeCosmosSettings({ zoomDiveRatio: "nope" }).zoomDiveRatio, 100, "非法进入阈值落默认");
  assert.equal(sanitizeCosmosSettings({ zoomFlyOutRatio: 5 }).zoomFlyOutRatio, 10, "越界返回阈值落下端");
  assert.equal(sanitizeCosmosSettings({ zoomFlyOutRatio: 51 }).zoomFlyOutRatio, 50, "越界返回阈值落上端");
  assert.equal(sanitizeCosmosSettings({ zoomFlyOutRatio: null }).zoomFlyOutRatio, 25, "非法返回阈值落默认");
  assert.equal(sanitizeCosmosSettings({ zoomPointerFocus: false }).zoomPointerFocus, false, "布尔 false 透传");
  for (const bad of ["no", 0, 1, null, undefined, {}, []]) {
    assert.equal(sanitizeCosmosSettings({ zoomPointerFocus: bad }).zoomPointerFocus, true, "非布尔独立分支回落 true：" + String(bad));
  }
  /* v4 会话面板展开态：独立布尔净化分支（缺省展开；非布尔一律回落 true，不进 bounds） */
  assert.equal(sanitizeCosmosSettings({ sessionPanelOpen: false }).sessionPanelOpen, false, "展开态 false 透传（持久收起）");
  for (const bad of ["no", 0, 1, null, undefined, {}, []]) {
    assert.equal(sanitizeCosmosSettings({ sessionPanelOpen: bad }).sessionPanelOpen, true, "非布尔独立分支回落展开：" + String(bad));
  }
  assert.equal("sessionPanelOpen" in COSMOS_SETTINGS_BOUNDS, false, "布尔键不进数值界表");
  /* v2/v3 载荷（无新键）→ 补默认；既有键不回归 */
  const v2 = sanitizeCosmosSettings({ panSpeed: 180, panShiftBoost: 2, skin: "lotus" });
  assert.equal(v2.panSpeed, 180, "v2 载荷 panSpeed 保持");
  assert.equal(v2.skin, "lotus", "v2 载荷 skin 保持");
  assert.deepEqual(
    [v2.zoomDiveRatio, v2.zoomFlyOutRatio, v2.zoomPointerFocus, v2.sessionPanelOpen],
    [100, 25, true, true],
    "v2 载荷补缩放导航默认与会话面板展开态"
  );
  /* 持久化：写 → 读回；落盘为 v3 净房结果（未知键剥离） */
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key)
  };
  try {
    const saved = saveCosmosSettings({ zoomDiveRatio: 80, zoomFlyOutRatio: 40, zoomPointerFocus: false, hacker: 1 });
    assert.deepEqual(
      [saved.zoomDiveRatio, saved.zoomFlyOutRatio, saved.zoomPointerFocus],
      [80, 40, false],
      "写侧净房保留三键"
    );
    assert.deepEqual(loadCosmosSettings(), saved, "读回同一设置");
    assert.equal("hacker" in JSON.parse(store.get("dsh-v-cosmos:settings")), false, "未知键写侧剥离");
    /* 会话面板展开态持久化（3.3 同一存储通道）：收起 → 读回收起。 */
    const collapsed = saveCosmosSettings({ sessionPanelOpen: false });
    assert.equal(collapsed.sessionPanelOpen, false, "收起写侧保留");
    assert.equal(loadCosmosSettings().sessionPanelOpen, false, "重开读回收起态（布局偏好持久化）");
    assert.equal(saveCosmosSettings({ sessionPanelOpen: true }).sessionPanelOpen, true, "展开写侧保留");
    saveCosmosSettings({ zoomDiveRatio: 9999, zoomFlyOutRatio: "x", zoomPointerFocus: "yes" });
    const clean = loadCosmosSettings();
    assert.deepEqual(
      [clean.zoomDiveRatio, clean.zoomFlyOutRatio, clean.zoomPointerFocus],
      [140, 25, true],
      "非法持久值读面净化（无报错）"
    );
  } finally {
    delete globalThis.localStorage;
  }
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
/* canvas 2d 上下文工厂（缺省 = 桩 ctx）：引线冒烟临时换成记录型 ctx，直接数描边调用。 */
let ctxFactory = stubCtx2d;
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
  return el;
}
/* 记录型 ctx（引线描线断言）：在桩 ctx 之上记录 stroke() 时生效的 strokeStyle，
   其余方法与桩同形（缺省即惰性 no-op）。 */
function recordingCtx() {
  const rec = { strokes: [] };
  return new Proxy({ __rec: rec }, {
    get(target, prop) {
      if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => ({ addColorStop() {} });
      if (prop === "__rec") return rec;
      if (prop === "stroke") return () => rec.strokes.push(target.strokeStyle ?? null);
      if (!(prop in target)) target[prop] = () => undefined;
      return target[prop];
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    }
  });
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
    if (t === "canvas") el.getContext = () => ctxFactory(); // 皮肤 glowSprite 直建 canvas
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
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scaleOf = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const lenOf = (a) => Math.hypot(a[0], a[1], a[2]);
const unitOf = (a) => { const L = lenOf(a) || 1; return [a[0] / L, a[1] / L, a[2] / L]; };
const dotOf = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** 缩放导航夹具：单星座在原点、单恒星 off=0、无行星/彗星/归档（boundR = 12）。 */
function zoomScene() {
  return {
    workspaces: [{
      id: "z1", name: "zoom-one", pos: [0, 0, 0],
      stars: [{ id: "z1-s", name: "s", lifecycle: "executed", setBy: null, at: null, tasks: [1, 1], age: "刚刚", act: 0, off: [0, 0, 0] }],
      links: [], planets: [], comets: [], archives: 0, satelliteCount: 0
    }]
  };
}

/* ── 三指拖动平移纯函数（add-cosmos-three-finger-pan 1.1–1.3）：共享方向基 /
   抓取式取反 / dist 比例 / yaw·pitch 不变性 / 非法入参 ── */
{
  /* 共享方向基：yaw0/pitch0 → right=+X、up=+Y；panCameraTarget 消费同一 helper */
  const b0 = panBasis({ yaw: 0, pitch: 0 });
  assert.ok(
    near(b0.rx, 1) && near(b0.rz, 0) && near(b0.ux, 0) && near(b0.uy, 1) && near(b0.uz, 0),
    "panBasis yaw0/pitch0：right=+X、up=+Y"
  );
  assert.equal(panBasis(null), null, "panBasis 空入参 → null");
  const basis = panBasis({ target: [0, 0, 0], yaw: -0.7, pitch: 0.5 });
  assert.ok(near(basis.rx, Math.cos(-0.7)) && near(basis.rz, -Math.sin(-0.7)), "right 随 yaw 旋转");
  assert.ok(
    near(basis.ux, Math.sin(0.5) * Math.sin(-0.7)) &&
    near(basis.uy, Math.cos(0.5)) &&
    near(basis.uz, Math.sin(0.5) * Math.cos(-0.7)),
    "up 随 yaw/pitch 旋转"
  );
  const camW = camAt(0, 0, 100);
  panCameraTarget(camW, new Set(["w"]), 1);
  assert.ok(
    near(camW.target[0], 0) && near(camW.target[1], PAN_SPEED) && near(camW.target[2], 0),
    "W 仍沿共享 up 基（helper 提取零语义漂移）"
  );
  const camD = camAt(0, 0, 100);
  panCameraTarget(camD, new Set(["d"]), 1);
  assert.ok(
    near(camD.target[0], PAN_SPEED) && near(camD.target[1], 0) && near(camD.target[2], 0),
    "D 仍沿共享 right 基"
  );

  /* 抓取式取反：手指右拖 → target 左移；手指下拖 → target 上移（星空随手移动） */
  assert.equal(PAN_DRAG_FACTOR, 0.004, "拖动换算系数 v1 = 0.004（真机可校准）");
  const dragX = camAt(0, 0, 100);
  assert.equal(panCameraTargetByDrag(dragX, 10, 0, 100), true, "非零位移 → true");
  assert.ok(near(dragX.target[0], -10 * 100 * PAN_DRAG_FACTOR), "x：右拖 10px → target 左移 4（dist 100）");
  assert.ok(near(dragX.target[1], 0) && near(dragX.target[2], 0), "x 拖不动 y/z");
  const dragY = camAt(0, 0, 100);
  panCameraTargetByDrag(dragY, 0, 10, 100);
  assert.ok(near(dragY.target[1], 10 * 100 * PAN_DRAG_FACTOR), "y：下拖 10px → target 上移 4（+Y）");
  assert.ok(near(dragY.target[0], 0) && near(dragY.target[2], 0), "y 拖不动 x/z");
  const dragDiag = camAt(0, 0, 100);
  panCameraTargetByDrag(dragDiag, -10, -10, 100);
  assert.ok(near(dragDiag.target[0], 4) && near(dragDiag.target[1], -4), "左上拖 → target 右下（两轴取反）");

  /* yaw/pitch 不变性（方向由共享基旋转决定） */
  const angleCam = camAt(-0.7, 0.5, 430);
  const yaw0 = angleCam.yaw, pitch0 = angleCam.pitch;
  assert.equal(panCameraTargetByDrag(angleCam, 12, -8, 430), true, "斜向拖动 → true");
  assert.equal(angleCam.yaw, yaw0, "平移不改 yaw");
  assert.equal(angleCam.pitch, pitch0, "平移不改 pitch");
  const angleExpected = { target: [0, 0, 0], yaw: -0.7, pitch: 0.5 };
  panCameraTargetByDrag(angleExpected, 12, -8, 430);
  assert.ok(
    near(angleCam.target[0], angleExpected.target[0]) &&
    near(angleCam.target[1], angleExpected.target[1]) &&
    near(angleCam.target[2], angleExpected.target[2]),
    "位移方向由 yaw/pitch 旋转后的共享基决定"
  );

  /* dist 比例关系：同一屏幕位移，世界位移 ∝ dist（近距微调 / 远距跨越） */
  const nearCam = camAt(-0.7, 0.5, 50);
  const farCam = camAt(-0.7, 0.5, 500);
  panCameraTargetByDrag(nearCam, 24, 16, 50);
  panCameraTargetByDrag(farCam, 24, 16, 500);
  const nearMove = lenOf(sub3(nearCam.target, [0, 0, 0]));
  const farMove = lenOf(sub3(farCam.target, [0, 0, 0]));
  assert.ok(near(farMove / nearMove, 10, 1e-9), "dist ×10 → 同一屏幕位移的世界位移 ×10");

  /* tuning 透传 / 非法入参短路（target 不被写） */
  const tunCam = camAt(0, 0, 100);
  panCameraTargetByDrag(tunCam, 10, 0, 100, { factor: 0.008 });
  assert.ok(near(tunCam.target[0], -8), "tuning.factor 覆盖出厂系数");
  const fallbackCam = camAt(0, 0, 100);
  panCameraTargetByDrag(fallbackCam, 10, 0, 100, { factor: -1 });
  assert.ok(near(fallbackCam.target[0], -4), "非法 factor → 回落 PAN_DRAG_FACTOR");
  const frozen = [1, 2, 3];
  const invalidCam = { target: frozen, yaw: 0, pitch: 0 };
  assert.equal(panCameraTargetByDrag(invalidCam, 0, 0, 100), false, "零位移 → false");
  assert.equal(panCameraTargetByDrag(invalidCam, NaN, 1, 100), false, "非法 dx → false");
  assert.equal(panCameraTargetByDrag(invalidCam, 1, Infinity, 100), false, "非法 dy → false");
  assert.equal(panCameraTargetByDrag(invalidCam, 1, 1, 0), false, "dist=0 → false");
  assert.equal(panCameraTargetByDrag(invalidCam, 1, 1, -100), false, "负 dist → false");
  assert.equal(panCameraTargetByDrag(null, 1, 1, 100), false, "空 cam → false");
  assert.deepEqual(frozen, [1, 2, 3], "非法/零位移不改 target");
}

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

  /* captures 对称性：快照缺失 → 回落捕获环外缘点（3.5×）→ 1.4s 后回常规轨道 + Map 摘除 */
  eng.markCapture("p1");
  for (let i = 0; i < 3; i++) { tNow += 50; stepFrame(tNow); }
  const planetCenter = [10, 0, 0]; // 恒星 off = [10,0,0] → 单星行星轨道中心
  const outer = eng.worldPosOf("planet", "p1");
  assert.ok(dist3(outer, planetCenter) > 40, "捕获初期：无快照 → 回落捕获环外缘点（3.5×≈56）");
  for (let i = 0; i < 30; i++) { tNow += 50; stepFrame(tNow); } // > 1.4s
  assert.deepEqual(eng.inspectGhosts().captures, [], "captures 摘除（与 regressions 对称）");
  const settled = eng.worldPosOf("planet", "p1");
  assert.ok(dist3(settled, planetCenter) > 13 && dist3(settled, planetCenter) < 19, "捕获收尾：回常规轨道 r≈16");
  eng.stop();
  eng.dispose();
}

/* ── 成星捕获混合曲线（polish-cosmos-orbit-insertion 4.1）：起点连续 / 终端无缝 /
      切向连续 / 半径单调收缩 / 快照回落 / 风暴降级（纯函数面） ── */
{
  const planet = { center: [10, 0, 0], baseR: 16, phase: 1.2, speed: 0.5, inc: 0.12 };
  const t0 = 12.34;
  const t1 = t0 + CAPTURE_DUR;
  assert.equal(CAPTURE_DUR, 1.4, "捕获补间时长与回归对称（1.4s）");
  const from = [46, 12, -30]; // 彗星游荡位（远离轨道半径 16）
  const heading = unitOf([-0.42, 0.28, 0.86]); // 彗星离场切向（实测游荡方程解析导数）
  const entry = { t0, from, heading };
  const pose = (t) => capturePoseAt(planet, entry, t);

  /* 起点连续：首帧位置严格 = 彗星最后世界坐标 */
  assert.deepEqual(pose(t0).wp, from, "首帧位置 = 彗星最后世界坐标（无起点跳变）");
  assert.equal(pose(t0).k, 0, "首帧 k=0");
  assert.equal(pose(t0).alpha, 1, "非降级：α 恒 1（彗星原位接续，无淡入）");

  /* 切向连续：起行方向 = 彗星离场切向（严格形态，非仅同向） */
  const depart = unitOf(sub3(pose(t0 + 0.01 * CAPTURE_DUR).wp, pose(t0).wp));
  assert.ok(dotOf(depart, heading) > 0.99, "起行方向与彗星离场切向连续（dot>0.99）");

  /* 终点无缝：k=1 位置 = 同帧轨道方程；交接速度 = 稳态轨道速度 */
  const endOrbit = orbitPointAt(planet, t1);
  assert.deepEqual(pose(t1).wp, endOrbit, "k=1 位置 = 稳态轨道方程（r1 = 当前帧轨道点）");
  assert.equal(pose(t1 + 0.3).wp[0], orbitPointAt(planet, t1 + 0.3)[0], "播完后位置恒为轨道方程（无收尾偏差）");
  const eps = 1e-4;
  const vEnd = scaleOf(sub3(pose(t1).wp, pose(t1 - eps).wp), 1 / eps);
  const vOrbit = scaleOf(sub3(orbitPointAt(planet, t1), orbitPointAt(planet, t1 - eps)), 1 / eps);
  assert.ok(dotOf(unitOf(vEnd), unitOf(vOrbit)) > 0.999, "交接速度方向 = 轨道速度（无角速度拐点）");
  assert.ok(Math.abs(lenOf(vEnd) / lenOf(vOrbit) - 1) < 0.02, "交接速度大小 = 轨道速度（无 2× 突跳）");

  /* 半径单调收缩 + 不掠过极点（半径不得跌破轨道半径附近） */
  let prevR = Infinity, minR = Infinity;
  for (let i = 0; i <= 20; i++) {
    const r = dist3(pose(t0 + i / 20 * CAPTURE_DUR).wp, planet.center);
    assert.ok(r <= prevR + 0.6, `半径单调收缩（k=${(i / 20).toFixed(2)}）`);
    prevR = r;
    minR = Math.min(minR, r);
  }
  assert.ok(minR > planet.baseR * 0.9, "半径不穿极点（无「坠心」伪影）");
  assert.ok(Math.abs(prevR - planet.baseR) < 0.2, "收尾半径 = 轨道半径");

  /* 确定性重放（同数据同画面） */
  assert.deepEqual(
    [0, 0.25, 0.5, 0.75, 1].map((k) => pose(t0 + k * CAPTURE_DUR).wp),
    [0, 0.25, 0.5, 0.75, 1].map((k) => pose(t0 + k * CAPTURE_DUR).wp),
    "补间确定性重放"
  );

  /* 快照缺失（竞态）→ 回落捕获环外缘点，且起行方向改用轨道正向切向 */
  const fallbackPose = capturePoseAt(planet, { t0, from: null, heading: null }, t0);
  assert.deepEqual(fallbackPose.wp, captureRingPointAt(planet, t0), "回落点 = 捕获环外缘点（3.5× 轨道半径）");
  assert.ok(Math.abs(dist3(fallbackPose.wp, planet.center) - planet.baseR * 3.5) < 0.2, "回落半径 = 3.5× 轨道半径");
  const fbDepart = unitOf(sub3(
    capturePoseAt(planet, { t0, from: null, heading: null }, t0 + 0.01 * CAPTURE_DUR).wp,
    fallbackPose.wp
  ));
  assert.ok(dotOf(fbDepart, unitOf(orbitTangentAt(planet, t0))) > 0.9, "回落起行方向 = 轨道正向切向");
  assert.deepEqual(
    capturePoseAt(planet, { t0, from: null, heading: null }, t1).wp,
    orbitPointAt(planet, t1),
    "回落转场仍无缝收敛到轨道方程"
  );

  /* 风暴降级：无位移补间（稳态就位）+ α 坡道 */
  const degraded = capturePoseAt(planet, { t0, from, heading, degraded: true }, t0 + 0.25);
  assert.deepEqual(degraded.wp, orbitPointAt(planet, t0 + 0.25), "降级：无位移补间直接按稳态轨道方程就位");
  assert.equal(degraded.degraded, true, "降级标记透出（观测面）");
  assert.equal(degraded.alpha, 0.5, "降级 α 坡道（0.5s 线性渐入）");
  assert.equal(capturePoseAt(planet, { t0, degraded: true }, t0).alpha, 0, "降级首帧 α=0（渐入起点）");
  assert.equal(capturePoseAt(planet, { t0, degraded: true }, t0 + 0.5).alpha, 1, "降级 0.5s 后 α=1");

  /* 彗星离场切向（解析求导）：单位向量 + 与游荡方程有限差分一致 */
  const ph = 2.2, dt = 1e-5;
  const wanderAt = (t) => [
    planet.center[0] + Math.cos(t * COMET_WANDER_FREQ[0] + ph) * COMET_WANDER_AMP[0],
    planet.center[1] + Math.sin(t * COMET_WANDER_FREQ[1] + ph) * COMET_WANDER_AMP[1] + 10,
    planet.center[2] + Math.sin(t * COMET_WANDER_FREQ[2] + ph) * COMET_WANDER_AMP[2]
  ];
  const numeric = unitOf(scaleOf(sub3(wanderAt(t0 + dt), wanderAt(t0 - dt)), 1 / (2 * dt)));
  const analytic = cometHeadingAt(ph, t0);
  assert.ok(Math.abs(lenOf(analytic) - 1) < 1e-9, "离场切向为单位向量");
  assert.ok(dotOf(analytic, numeric) > 0.9999, "离场切向 = 游荡方程解析导数（有限差分校验）");
}

/* ── 成星捕获引擎接线（4.1 引擎面）：from/切向/尾迹采集时序 / P2 排队 / 尾迹跨 kind
      交接 / k≥1 摘除 / 风暴降级就位 ── */
{
  const container = stubEl("div");
  const eng = createCosmosEngine({ container, style: createSkinD() });
  /* 同一会话 id 跨 kind 迁移夹具（真实捕获路径：markCapture 在 setScene 前调用，
     彼时旧彗星体仍在册 → from/切向/尾迹三件快照都采得到）。 */
  const captureScene = function (asPlanet) {
    return {
      workspaces: [{
        id: "ws1", name: "ws-one", pos: [0, 0, 0],
        stars: [{ id: "add-a", name: "add-a", lifecycle: "executed", setBy: null, at: null, tasks: [1, 1], age: "刚刚", act: 0, off: [10, 0, 0] }],
        links: [],
        planets: asPlanet
          ? [{ id: "s1", title: "planet", state: "idle", pendingKind: null, stars: ["add-a"], todos: "—", when: "刚刚", satellites: [], satelliteCount: 0, delegatedBusy: false }]
          : [],
        comets: asPlanet
          ? []
          : [{ id: "s1", title: "comet", state: "idle", pendingKind: null, when: "刚刚", satellites: [], satelliteCount: 0, delegatedBusy: false }],
        archives: 0, satelliteCount: 0
      }]
    };
  };
  eng.setScene(captureScene(false), "rebuild");
  eng.start();
  let tNow = 8000;
  for (let i = 0; i < 45; i++) { tNow += 50; stepFrame(tNow); } // 过序曲 + 彗星尾迹长满
  const cometPos = eng.worldPosOf("comet", "s1").slice(); // 彗星最后世界坐标（setScene 前采集）
  eng.markCapture("s1", cometPos, { wsId: "ws1" });
  assert.equal(eng.inspectFxQueue().pending, 1, "捕获转场经 P2 存在队列（不再直调）");
  eng.setScene(captureScene(true), "rebuild"); // 场景替换：彗星 → 行星（同一会话 id）
  assert.deepEqual(eng.inspectGhosts().captures, [], "排队窗口内 E.captures 尚未在册（行星先按稳态呈现）");
  stepFrame(tNow += 50); // fire（场景替换后的下一渲染帧；单例 delay 0）
  const fired = eng.inspectCapture("s1");
  assert.ok(fired.entry, "fire 帧写入 E.captures（t0 重锚到启动帧）");
  assert.deepEqual(fired.entry.from, cometPos, "条目保存 from 快照");
  assert.ok(Math.abs(lenOf(fired.entry.heading) - 1) < 1e-9, "标记时采集离场切向（单位向量）");
  assert.ok(fired.entry.trail >= 14, "标记时按旧彗星体快照尾迹（fire 时旧体已销毁）");
  assert.deepEqual(fired.planet.wp, cometPos, "fire 帧行星位置 = 彗星最后世界坐标（起点连续）");
  assert.equal(fired.planet.trail, 14, "尾迹跨 kind 交接：彗星尾迹按行星容量 14 等距重采样");
  assert.ok(dist3(fired.planet.trailTail, cometPos) < 6, "交接尾点 ≈ 彗星原位（尾迹不清零）");
  /* 首帧后一小段：位置自彗星原位滑出（不是瞬移），且沿离场切向起步 */
  const p0 = fired.planet.wp;
  for (let i = 0; i < 3; i++) { tNow += 50; stepFrame(tNow); }
  const moving = eng.worldPosOf("planet", "s1");
  assert.ok(dist3(moving, p0) > 0.5 && dist3(moving, p0) < 40, "起步连续推进（无单帧瞬移）");
  const departDir = unitOf(sub3(moving, p0));
  assert.ok(dotOf(departDir, fired.entry.heading) > 0.7, "起行方向贴合彗星离场切向（无反向甩鞭）");
  for (let i = 0; i < 30; i++) { tNow += 50; stepFrame(tNow); } // > 1.4s
  assert.deepEqual(eng.inspectGhosts().captures, [], "k≥1 摘除：捕获条目退出 Map");
  assert.equal(eng.inspectCapture("s1").planet.captureStart, null, "k≥1 摘除：body 补间态置空");
  const settled = eng.worldPosOf("planet", "s1");
  assert.ok(dist3(settled, [10, 0, 0]) > 13 && dist3(settled, [10, 0, 0]) < 19, "收尾落在常规轨道 r≈16");

  /* 风暴降级（fire 消费 degraded）：无位移补间 + α 坡道（条目随坡道完成摘除） */
  eng.setScene(captureScene(false), "rebuild"); // 回彗星态，再走一次捕获
  stepFrame(tNow += 50);
  for (let i = 0; i < 10; i++) {
    eng.enqueueFx("star", "storm" + i, "surge", { priority: FX_PRIORITY.existence, wsId: null, delay: 5 });
  }
  const cometPos2 = eng.worldPosOf("comet", "s1").slice();
  eng.markCapture("s1", cometPos2, { wsId: "ws1" });
  eng.setScene(captureScene(true), "rebuild");
  stepFrame(tNow += 50); // 积压 > 8 → storm，本枚降级执行
  const storm = eng.inspectCapture("s1");
  assert.equal(storm.entry.degraded, true, "风暴中启动的捕获降级执行");
  assert.ok(
    Math.abs(dist3(storm.planet.wp, [10, 0, 0]) - 16) < 2,
    "降级：无位移补间，直接就位稳态轨道（r≈16，不在彗星原位）"
  );
  assert.ok(storm.planet.captureAlpha < 1, "降级：α 坡道渐入（未直接跳到 1）");
  for (let i = 0; i < 12; i++) { tNow += 50; stepFrame(tNow); } // > 0.5s α 坡道
  assert.deepEqual(eng.inspectGhosts().captures, [], "降级 α 坡道完成 → 条目摘除");
  assert.equal(eng.inspectCapture("s1").planet.captureAlpha, 1, "降级收尾 α=1（稳态）");
  eng.stop();
  eng.dispose();
}
/* ── 激波弹射变体（add-cosmos-nova-ejection 4.1）：击中几何 / 分段演出 / 尾迹交接 /
      爆心解析（纯函数面） ── */
{
  const starPos = [10, 0, 0];
  const nearFrom = [22, 0, 0]; // 距爆心 12 → hit = 12 / SHOCK_SPEED
  const farFrom = [10, 0, 47]; // 距爆心 47 → 钳制 HOLD_MAX
  const near = shockHitOf(nearFrom, starPos, 16);
  const far = shockHitOf(farFrom, starPos, 16);
  assert.ok(Math.abs(near.hit - 12 / SHOCK_SPEED) < 1e-9, "击中时刻 = 距爆心距离 / 激波速度");
  assert.ok(near.hit < far.hit, "距爆心近者先被击中（几何错峰）");
  assert.equal(far.hit, SHOCK_HOLD_MAX, "远轨道行星钳制上界（不可见时长有界）");
  assert.deepEqual(near.kickDir, [1, 0, 0], "径向外抛方向 = 爆心→行星");
  assert.ok(Math.abs(near.kickDist - 19.2) < 1e-9, "kick 距离 ≈1.2× 行星轨道半径");
  assert.deepEqual(shockHitOf(nearFrom, starPos, 16), near, "同输入同输出（确定性重放）");
  const degenerate = shockHitOf(starPos, starPos, 16);
  assert.deepEqual(degenerate.kickDir, [1, 0, 0], "退化方向确定性兜底");
  assert.equal(degenerate.hit, SHOCK_HOLD_MIN, "退化距离钳制下界");
  assert.equal(shockHitOf(nearFrom, [0, 0], 16), null, "非法爆心 → null（守卫）");

  const wander = [30, 10, 40];
  const blast = { from: nearFrom, hit: near.hit, kickDist: near.kickDist, kickDir: near.kickDir };
  const hold = shockEjectionAt(near.hit - 0.01, blast, wander);
  assert.equal(hold.phase, "hold", "击中前 = hold 段");
  assert.deepEqual(hold.wp, nearFrom, "hold 定格于 from（不是游荡点）");
  assert.equal(hold.alpha, 0, "hold α=0（不可见定格）");
  const kickMid = shockEjectionAt(near.hit + SHOCK_KICK_DUR / 2, blast, wander);
  assert.equal(kickMid.phase, "kick", "击中后 = kick 段");
  assert.ok(kickMid.alpha > 0 && kickMid.alpha < 1, "α 随击中起 0.5s 坡道渐入");
  assert.ok(kickMid.wp[0] > nearFrom[0], "kick 沿爆心→行星径向外抛");
  assert.ok(
    Math.abs(kickMid.wp[1]) < 1e-9 && Math.abs(kickMid.wp[2]) < 1e-9,
    "kick 方向锁定径向（无侧向漂移）"
  );
  const kickEnd = shockEjectionAt(near.hit + SHOCK_KICK_DUR, blast, wander);
  assert.ok(Math.abs(kickEnd.wp[0] - (nearFrom[0] + near.kickDist)) < 1e-9, "kick 末点 = from + kickDist");
  const glideMid = shockEjectionAt(near.hit + SHOCK_KICK_DUR + SHOCK_GLIDE_DUR / 2, blast, wander);
  assert.equal(glideMid.phase, "glide", "kick 后 = glide 段");
  assert.ok(
    Math.abs(glideMid.wp[0] - wander[0]) < Math.abs(kickEnd.wp[0] - wander[0]),
    "glide 向游荡点收敛"
  );
  const glideEnd = shockEjectionAt(near.hit + SHOCK_KICK_DUR + SHOCK_GLIDE_DUR, blast, wander);
  assert.deepEqual(glideEnd.wp, wander, "glide 收尾 = 游荡点（接棒既有滑行）");
  assert.equal(glideEnd.alpha, 1, "α 坡道完成");
  assert.ok(SHOCK_TOTAL_MAX <= 2.2 + 1e-9, "分段总长上界 ≈2.2s（与 nova 同场收尾）");
  assert.ok(
    Math.abs(shockTotalDurOf(near.hit) - (near.hit + SHOCK_KICK_DUR + SHOCK_GLIDE_DUR)) < 1e-9,
    "总长 = hit + kick + glide"
  );
  const replay = () =>
    [0, 0.2, 0.4, 0.6, 0.8, 1, 1.2, 1.4].map((dt) => shockEjectionAt(near.hit + dt, blast, wander));
  assert.deepEqual(replay(), replay(), "分段演出确定性重放");

  /* 尾迹跨 kind 交接（与 orbit-insertion 共享协议） */
  const planetTrail = Array.from({ length: 14 }, (_, i) => [i, 0, 0]);
  const inherited = adoptTrailAcrossKinds(planetTrail, 34);
  assert.equal(inherited.length, 14, "容量足够：行星空迹原样继承");
  assert.notEqual(inherited[0], planetTrail[0], "点位浅拷贝（不共享旧数组）");
  assert.deepEqual(inherited[13], [13, 0, 0], "尾点保留");
  const longTrail = Array.from({ length: 34 }, (_, i) => [i * 2, 0, 0]);
  const sampled = adoptTrailAcrossKinds(longTrail, 14);
  assert.equal(sampled.length, 14, "容量超限 → 重采样到目标容量（彗星 34 → 行星 14）");
  assert.deepEqual(sampled[0], [0, 0, 0], "重采样保留首端点");
  assert.deepEqual(sampled[13], [66, 0, 0], "重采样保留末端点");
  for (let i = 1; i < sampled.length; i++) assert.ok(sampled[i][0] > sampled[i - 1][0], "等距重采样单调");
  assert.deepEqual(adoptTrailAcrossKinds(null, 34), [], "空尾迹 → 空（不报错）");
  assert.deepEqual(adoptTrailAcrossKinds([[0, 0, 0], [1, 1, 1]], 1), [[1, 1, 1]], "cap=1 → 保留最新点");

  /* 爆心解析：同 ws 最近 + 并列 x 小者 + 无候选守卫 */
  const cores = [
    { wsId: "w1", starPos: [0, 0, 0] },
    { wsId: "w1", starPos: [12, 0, 0] },
    { wsId: "w2", starPos: [1, 0, 0] }
  ];
  assert.deepEqual(resolveBlastCoreOf(cores, "w1", [20, 0, 0]), { wsId: "w1", starPos: [12, 0, 0] }, "同 ws 最近爆心");
  assert.deepEqual(resolveBlastCoreOf(cores, "w2", [20, 0, 0]), { wsId: "w2", starPos: [1, 0, 0] }, "跨 ws 候选被排除");
  assert.equal(resolveBlastCoreOf(cores, "w3", [20, 0, 0]), null, "无同 ws 候选 → null（普通回归）");
  assert.equal(resolveBlastCoreOf([], "w1", [0, 0, 0]), null, "空集合 → null");
  assert.deepEqual(
    resolveBlastCoreOf([{ wsId: "w1", starPos: [15, 0, 0] }, { wsId: "w1", starPos: [5, 0, 0] }], "w1", [10, 0, 0]),
    { wsId: "w1", starPos: [5, 0, 0] },
    "并列距离 → worldPos x 小者（确定性）"
  );
}

/** 双彗星夹具：无行星（爆心由调用方显式传入，用于验几何错峰）。 */
function ejectionScene() {
  return {
    workspaces: [{
      id: "ws1", name: "ws-one", pos: [0, 0, 0],
      stars: [{ id: "add-a", name: "add-a", lifecycle: "executed", setBy: null, at: null, tasks: [1, 1], age: "刚刚", act: 0, off: [10, 0, 0] }],
      links: [], planets: [],
      comets: [
        { id: "c1", title: "comet-1", state: "idle", pendingKind: null, when: "刚刚", satellites: [], satelliteCount: 0, delegatedBusy: false },
        { id: "c2", title: "comet-2", state: "idle", pendingKind: null, when: "刚刚", satellites: [], satelliteCount: 0, delegatedBusy: false }
      ],
      archives: 0, satelliteCount: 0
    }]
  };
}

/** 回归前帧夹具：行星与彗星同 id（模拟 setScene 前 planet→comet 迁移的差分帧，
    markRegression 才能在旧场景查到行星 baseR/尾迹）。 */
function regressionPlanetScene() {
  const scene = miniScene();
  scene.workspaces[0].planets[0].id = "c1";
  scene.workspaces[0].planets[0].title = "planet-to-comet";
  return scene;
}

/* 引擎实例：激波弹射变体（hold 不可见定格 → kick 径向外抛）——近者先击中 / 分段收尾 */
{
  const container = stubEl("div");
  const eng = createCosmosEngine({ container, style: createSkinD() });
  eng.setScene(ejectionScene(), "rebuild");
  eng.start();
  let tNow = 5000;
  for (let i = 0; i < 27; i++) { tNow += 50; stepFrame(tNow); } // 过冷启动序曲
  const starPos = [10, 0, 0];
  /* wsId null → 同帧出队（无 P2 同 ws 错峰），只验几何错峰 */
  eng.markRegression("c1", [22, 0, 0], { wsId: null, blast: { starPos } });
  eng.markRegression("c2", [10, 0, 47], { wsId: null, blast: { starPos } });
  stepFrame(tNow += 50); // 同帧 fire（t0 重锚）
  const e1 = eng.inspectEjection("c1");
  const e2 = eng.inspectEjection("c2");
  assert.ok(e1.entry && e1.entry.blast && e2.entry && e2.entry.blast, "两枚弹射条目在册（爆心快照）");
  assert.ok(e1.entry.hit < e2.entry.hit, "近者 hit 更短（几何错峰）");
  assert.deepEqual(e1.comet.wp, [22, 0, 0], "hold 定格 from（c1）");
  assert.deepEqual(e2.comet.wp, [10, 0, 47], "hold 定格 from（c2）");
  assert.equal(e1.comet.regressAlpha, 0, "hold α=0（不可见）");
  assert.equal(e2.comet.regressAlpha, 0, "hold α=0（c2 尚未被击中）");
  for (let i = 0; i < 8; i++) { tNow += 50; stepFrame(tNow); } // ≈0.4s：c1 已 kick、c2 仍 hold
  const k1 = eng.inspectEjection("c1");
  const k2 = eng.inspectEjection("c2");
  assert.ok(k1.comet.regressAlpha > 0, "c1 已击中：α 坡道起（可见）");
  assert.ok(k1.comet.wp[0] > 22, "c1 沿爆心→行星径向外抛");
  assert.equal(k2.comet.regressAlpha, 0, "c2 未击中仍 α=0（远者后击中）");
  assert.deepEqual(k2.comet.wp, [10, 0, 47], "c2 仍定格 from");
  for (let i = 0; i < 50; i++) { tNow += 50; stepFrame(tNow); } // > 分段总长 2.2s
  assert.deepEqual(eng.inspectGhosts().regressions, [], "分段总长收尾摘除（两枚）");
  assert.equal(eng.inspectEjection("c1").comet.hit, null, "收尾清理分段字段（hit）");
  assert.equal(eng.inspectEjection("c1").comet.blast, null, "收尾清理分段字段（爆心）");
  eng.stop();
  eng.dispose();
}

/* 引擎实例：行星尾迹交接 + 页签隐藏冻结续播 + 风暴降级回落普通回归 */
{
  const container = stubEl("div");
  const eng = createCosmosEngine({ container, style: createSkinD() });
  eng.setScene(regressionPlanetScene(), "rebuild");
  eng.start();
  let tNow = 6000;
  for (let i = 0; i < 27; i++) { tNow += 50; stepFrame(tNow); } // 过冷启动序曲
  const starPos = [10, 0, 0];
  const planetPos = eng.worldPosOf("planet", "c1").slice(); // 行星最后轨道位置
  eng.markRegression("c1", planetPos, { wsId: null, blast: { starPos } });
  stepFrame(tNow += 50); // fire
  const first = eng.inspectEjection("c1");
  assert.ok(first.entry.hit > 0 && first.entry.trail > 0, "标记时采齐 hit 与行星空迹快照");
  assert.deepEqual(first.comet.wp, planetPos, "hold 定格于行星最后位置");
  assert.equal(first.comet.regressAlpha, 0, "hold 不可见");

  /* 页签隐藏：E.t 冻结 → 墙钟跳变不推进补间，恢复后只走一帧 */
  eng.stop();
  const frozen = eng.inspectEjection("c1");
  tNow += 5000; // 墙钟飞逝（无帧 → E.t 冻结）
  eng.start();
  stepFrame(tNow);
  const resumed = eng.inspectEjection("c1");
  assert.ok(resumed.entry.elapsed - frozen.entry.elapsed <= 0.11, "冻结续播：恢复后只推进一帧（无跳帧）");
  assert.deepEqual(resumed.comet.wp, planetPos, "冻结续播仍在 hold（未瞬移至游荡点）");
  assert.equal(resumed.comet.regressAlpha, 0, "冻结续播仍不可见");

  const need = Math.ceil((resumed.entry.hit - resumed.entry.elapsed) / 0.05) + 3;
  for (let i = 0; i < need; i++) { tNow += 50; stepFrame(tNow); }
  const kicked = eng.inspectEjection("c1");
  assert.ok(kicked.comet.regressAlpha > 0, "kick：α 起坡（可见）");
  assert.ok(kicked.comet.trail >= 14, "尾迹点燃：行星空迹按跨 kind 协议交接");
  const dir = kicked.entry.kickDir;
  const dv = [kicked.comet.wp[0] - planetPos[0], kicked.comet.wp[1] - planetPos[1], kicked.comet.wp[2] - planetPos[2]];
  assert.ok(dv[0] * dir[0] + dv[1] * dir[1] + dv[2] * dir[2] > 0, "kick 沿径向外抛（爆心→行星）");
  assert.ok(
    Math.abs(dv[0] * dir[1] - dv[1] * dir[0]) < 1e-6 && Math.abs(dv[1] * dir[2] - dv[2] * dir[1]) < 1e-6,
    "kick 无侧向偏移（外积为 0）"
  );

  for (let i = 0; i < 50; i++) { tNow += 50; stepFrame(tNow); } // > 分段总长
  assert.deepEqual(eng.inspectGhosts().regressions, [], "分段总长收尾摘除");

  /* 风暴降级（fire 消费 degraded）：不设 blast → 普通回归（无 hold 不可见段） */
  for (let i = 0; i < 10; i++) {
    eng.enqueueFx("star", "storm" + i, "surge", { priority: FX_PRIORITY.existence, wsId: null, delay: 5 });
  }
  const from2 = [planetPos[0] + 2, planetPos[1], planetPos[2]];
  eng.markRegression("c1", from2, { wsId: null, blast: { starPos } });
  stepFrame(tNow += 50); // 积压 11 > 8 → storm，本枚降级执行
  const degraded = eng.inspectEjection("c1");
  assert.equal(degraded.entry.blast, null, "风暴降级：条目不带爆心分段");
  assert.equal(degraded.comet.hit, null, "风暴降级：无 hold/kick 字段");
  for (let i = 0; i < 3; i++) { tNow += 50; stepFrame(tNow); }
  const plain = eng.inspectEjection("c1");
  assert.ok(plain.comet.regressAlpha > 0, "普通回归：α 立即起坡（无 hold 不可见段）");
  assert.notDeepEqual(plain.comet.wp, from2, "普通回归：立即滑动（无 hold 定格）");
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

/* ── 星座包围球半径 ws.boundR（add-cosmos-zoom-focus-nav 2.1/D4）：构建期预计算 +
   恒星 / 行星轨道包络 / 卫星包络 / 彗星游荡包络 / 星云下限 + 确定性 ── */
{
  const star = (id, off) => ({ id, name: id, lifecycle: "created", setBy: null, at: null, tasks: [1, 1], age: "刚刚", act: 0, off });
  const planetOf = (id, starIds, sats = []) => ({
    id, title: id, state: "idle", pendingKind: null, stars: starIds, todos: "—", when: "刚刚",
    satellites: sats, satelliteCount: sats.length, delegatedBusy: false
  });
  const cometOf = { id: "cm", title: "cm", state: "idle", pendingKind: null, when: "刚刚", satellites: [], satelliteCount: 0, delegatedBusy: false };
  const sceneOfWs = (ws) => ({ workspaces: [{ id: "b", name: "b", pos: [0, 0, 0], links: [], archives: 0, satelliteCount: 0, ...ws }] });
  const build = (ws) => buildScenePure(sceneOfWs(ws), new Map(), new Map()).ws[0];

  assert.equal(build({ stars: [], planets: [], comets: [] }).boundR, 12, "空星座下限 = 星云半径 12");
  assert.equal(build({ stars: [], planets: [], comets: [], archives: 3 }).boundR, 12 + 3 * 2.4, "archives 增大星云下限");
  assert.equal(build({ stars: [star("s", [30, 0, 0])], planets: [], comets: [] }).boundR, 30, "恒星 off 半径");
  assert.equal(
    build({ stars: [star("s0", [10, 0, 0])], planets: [planetOf("p", ["s0"])], comets: [] }).boundR,
    10 + 16 + 16,
    "单星行星 = |c−ws.center| + baseR + 本体"
  );
  assert.equal(
    build({
      stars: [star("s0", [10, 0, 0])],
      planets: [planetOf("p", ["s0"], [{ id: "sat", state: "idle", title: "sat" }])],
      comets: []
    }).boundR,
    10 + 16 + (16 * 2 + 17),
    "有卫星行星 = 轨道中心距 + baseR + 卫星子轨道"
  );
  assert.equal(
    build({
      stars: [star("s0", [10, 0, 0]), star("s1", [-10, 0, 0])],
      planets: [planetOf("p", ["s0", "s1"])],
      comets: []
    }).boundR,
    0 + 30 + 30,
    "联星质心落在 ws.center → baseR 30 + 本体 30"
  );
  const cometScene = build({ stars: [], planets: [], comets: [cometOf] });
  assert.equal(cometScene.boundR, COMET_WANDER_R, "彗星游荡包络常量");
  assert.ok(Math.abs(COMET_WANDER_R - Math.hypot(58, 26, 46)) < 1e-12, "包络 = hypot(58,26,46)");
  const combo = { stars: [star("s0", [10, 0, 0])], planets: [planetOf("p", ["s0"])], comets: [cometOf] };
  const b1 = build(combo);
  const b2 = build(combo);
  assert.equal(b1.boundR, Math.max(10 + 16 + 16, COMET_WANDER_R), "取各包络最大值");
  assert.equal(b1.boundR, b2.boundR, "同数据两次构建 boundR 逐位一致");
  const s1 = JSON.stringify(buildScenePure(sceneOfWs(combo), new Map(), new Map()));
  const s2 = JSON.stringify(buildScenePure(sceneOfWs(combo), new Map(), new Map()));
  assert.equal(s1, s2, "含 boundR 的整场景确定性（deepEqual 红线）");
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

  const container = stubEl("div");
  const eng = createCosmosEngine({ container, style: createSkinD() });
  const rootEl = container.children[0];
  const overlayEl = rootEl._by[".cos-overlay"];
  const withStar = miniScene().workspaces[0];
  const emptyWs = { id: "ws-empty", name: "空星座", pos: [0, 0, 0], stars: [], links: [], planets: [], comets: [], archives: 0, satelliteCount: 0 };
  const two = () => ({ workspaces: [withStar, emptyWs] });
  const chipsNow = () => overlayEl.children.filter((el) => String(el.className).startsWith("cos-chip"));
  eng.setScene(two(), "rebuild");
  let chips = chipsNow();
  assert.equal(chips.length, 2, "两星座各产一个 chip");
  const chipStar = chips[0];
  const chipEmpty = chips[1];

  eng.markWsBirth("ws-empty");
  eng.setScene(two(), "rebuild");
  chips = chipsNow();
  assert.equal(chips.length, 2, "增量对齐：重建后 chip 数量不变");
  assert.equal(chips[0], chipStar, "既有 chip DOM 复用（MUST NOT 整表重建）");
  assert.equal(chips[1], chipEmpty, "空星座 chip DOM 复用");
  assert.ok(String(chips[1].className).includes("cos-chip-new"), "空星座 chip 就地附加出生高亮类");
  assert.ok(!String(chips[0].className).includes("cos-chip-new"), "含恒星星座不受影响（凝聚转场照旧）");

  eng.markWsBirth("ws1");
  eng.setScene(two(), "rebuild");
  chips = chipsNow();
  assert.ok(!String(chips[0].className).includes("cos-chip-new"), "有内容星座即便被标记也 MUST NOT 播空星座高亮（引擎侧守卫）");

  /* 高亮窗口过期：~2s 后就地摘除类（CSS forwards 收尾即常态，无 JS 清理残留） */
  rafQ.length = 0;
  eng.start();
  let tNow = 0;
  for (let i = 0; i < 45; i++) { tNow += 50; stepFrame(tNow); } // E.t ≈ 2.25s > 2s
  eng.setScene(two(), "rebuild");
  chips = chipsNow();
  assert.ok(!String(chips[1].className).includes("cos-chip-new"), "高亮窗口过后空星座 chip 回落常态");
  assert.equal(chips[1], chipEmpty, "过期摘类不重建 DOM");
  eng.stop();
  eng.dispose();
}

/* ── 覆盖层隐藏必须清内联 opacity（真机「恒星名/星座名残影」回归） ── */
{
  const container = stubEl("div");
  const eng = createCosmosEngine({ container, style: createSkinD() });
  const rootEl = container.children[0];
  const overlayEl = rootEl._by[".cos-overlay"];
  eng.setScene(miniScene(), "rebuild");
  rafQ.length = 0;
  eng.start();
  let tNow = 50000;
  const step1 = (n = 1) => { for (let i = 0; i < n; i++) { tNow += 50; stepFrame(tNow); } };
  step1(27); // 过冷启动序曲

  const chip = overlayEl.children.find((el) => String(el.className).startsWith("cos-chip"));
  const slab = overlayEl.children.find((el) => el.className === "cos-slab");
  assert.ok(chip && slab, "chip / 恒星名牌已创建");
  assert.notEqual(chip.style.opacity, "", "银河态 chip 写入内联透明度");
  assert.equal(slab.style.opacity, "", "银河态未聚焦恒星名牌隐藏（无内联透明度）");

  /* 钻取：名牌显示、chip 隐藏 → 隐藏分支必须清空内联 opacity */
  assert.equal(eng.diveToWs("ws1"), true, "钻取目标星座");
  fakeNow += 1300;
  step1(1);
  assert.equal(eng.inspectFilter().focus.diving, true, "钻取态成立");
  assert.notEqual(slab.style.opacity, "", "钻取态恒星名牌写内联透明度");
  assert.equal(chip.style.opacity, "", "钻取态 chip 隐藏时清空内联透明度");

  /* 退出钻取：名牌转入隐藏分支；若不清内联 opacity，文字会永久钉在最后位置 */
  assert.equal(eng.consumeEscape(), true, "Esc 飞回银河");
  fakeNow += 1300;
  step1(1);
  assert.equal(eng.inspectFilter().focus.diving, false, "已回到银河");
  assert.equal(slab.style.opacity, "", "退出钻取后名牌清空内联透明度（不残留）");
  assert.notEqual(chip.style.opacity, "", "银河态 chip 恢复内联透明度");
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
  assert.ok(
    /\.cos-home-btn \{[^}]*width: var\(--cos-hud-btn-size, 44px\); height: var\(--cos-hud-btn-size, 44px\)/.test(ENGINE_CSS),
    "按钮方形且边长经 --cos-hud-btn-size 令牌可配（缺省 44，add-cosmos-layout-tuning D2）"
  );
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
  fire(rootEl, "pointerdown", { pointerId: 5, button: 0, clientX: hitPt.x, clientY: hitPt.y, target: canvasEl, preventDefault() {} });
  assert.deepEqual(capCalls, [5], "canvas 起指维持 setPointerCapture（拖拽越界不丢事件）");
  fire(rootEl, "pointerup", { pointerId: 5, button: 0, clientX: hitPt.x, clientY: hitPt.y, target: canvasEl });
  assert.equal(input().dives, divesBeforeCanvas + 1, "canvas 起指抬指维持 pickAt 拾取语义（点击天体 dive）");

  /* 覆盖元素起指：MUST NOT 捕获、MUST NOT 容器级拾取；chip 自身 click 恰好 dive 一次（D8 防回归） */
  capCalls.length = 0;
  const divesBeforeChip = input().dives;
  fire(rootEl, "pointerdown", { pointerId: 3, button: 0, clientX: hitPt.x, clientY: hitPt.y, target: chip, preventDefault() {} });
  assert.deepEqual(capCalls, [], "覆盖元素起指 MUST NOT setPointerCapture（捕获会吞掉 click 派发）");
  fire(rootEl, "pointerup", { pointerId: 3, button: 0, clientX: hitPt.x, clientY: hitPt.y, target: chip });
  assert.equal(input().dives, divesBeforeChip, "覆盖元素抬指 MUST NOT 执行容器级拾取（防与 chip click 叠加）");
  fire(chip, "click", {});
  assert.equal(input().dives, divesBeforeChip + 1, "chip 单指点按 dive 单次触发（不重不叠）");

  /* 右键：屏蔽原生菜单，且 MUST NOT 触发拾取/dive（此前 pointerup 会误 dive） */
  let ctxPrevented = false;
  fire(rootEl, "contextmenu", { preventDefault() { ctxPrevented = true; } });
  assert.equal(ctxPrevented, true, "容器级 contextmenu 屏蔽浏览器原生右键菜单");
  capCalls.length = 0;
  const divesBeforeRight = input().dives;
  fire(rootEl, "pointerdown", { pointerId: 7, button: 2, clientX: hitPt.x, clientY: hitPt.y, target: canvasEl, preventDefault() {} });
  assert.deepEqual(capCalls, [], "右键起指不捕获指针");
  fire(rootEl, "pointerup", { pointerId: 7, button: 2, clientX: hitPt.x, clientY: hitPt.y, target: canvasEl });
  assert.equal(input().dives, divesBeforeRight, "右键抬指不触发拾取/dive");
  assert.equal(input().pointers, 0, "右键不遗留指针追踪（防下一次单指误判捏合）");

  /* 双指捏合（D2）：第二指落下切 pinch、指距比例驱动 dist、接管即取消补间 */
  const distBase = cam().dist;
  fire(rootEl, "pointerdown", { pointerId: 11, button: 0, clientX: 100, clientY: 100, target: canvasEl, preventDefault() {} });
  fire(rootEl, "pointerdown", { pointerId: 12, button: 0, clientX: 200, clientY: 100, target: canvasEl, preventDefault() {} });
  assert.equal(input().gesture, true, "第二指落下 → 切捏合手势");
  assert.equal(input().pointers, 2, "多指针追踪在册");
  assert.deepEqual(input().pinch, { d0: 100, dist0: distBase }, "捏合基准 = 基准指距 + 基准镜头距离");
  fire(rootEl, "pointermove", { pointerId: 12, clientX: 300, clientY: 100, buttons: 1, target: canvasEl });
  assert.ok(Math.abs(cam().dist - distBase * 0.5) < 1e-6, "指距张开一倍 → dist 减半（张开 = 放大）");
  assert.equal(eng.inspectFilter().tween, null, "捏合接管 → 相机补间立即让位");

  /* 手势收尾：剩指重置为单指起点（拖拽旋转续接），全部抬起记抑制窗 */
  fire(rootEl, "pointerup", { pointerId: 12, button: 0, target: canvasEl });
  assert.equal(input().gesture, true, "一指仍在按 → 手势未结束（抑制持续）");
  const yawBeforeDrag = cam().yaw;
  fire(rootEl, "pointermove", { pointerId: 11, clientX: 140, clientY: 130, buttons: 1, target: canvasEl });
  assert.notEqual(cam().yaw, yawBeforeDrag, "剩指重置起点后回到单指拖拽旋转语义");
  fire(rootEl, "pointerup", { pointerId: 11, button: 0, target: canvasEl });
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

  /* 钻取态顶部中央标牌（D4/3.2；polish-cosmos-drilled-hud 移居）：星座名 + 全量计数仪表 */
  fakeNow += 1300; // 钻取补间播完（E.focusMix → 1）
  step1(1);
  assert.equal(eng.inspectFilter().focus.diving, true, "钻取态成立");
  assert.ok(String(badgeEl.dataset.html).includes("ws-one"), "标牌含星座名（dataset.html 守卫值已写）");
  assert.ok(String(badgeEl.innerHTML).includes("ws-one"), "标牌渲染星座名");
  assert.ok(/✦1 ●1 ◇0 ☄1 ☁0/.test(String(badgeEl.innerHTML)), "标牌含全量计数仪表 ✦●◇☄☁");
  /* 标牌定位口径（polish-cosmos-drilled-hud 2.1/2.2）：居中 + 文本居中 + 避让左面板与右缘 */
  assert.ok(/\.cos-badge \{[^}]*left: 50%; transform: translateX\(-50%\)/.test(ENGINE_CSS), "标牌水平居中（left:50% + translateX(-50%)，顶部中央锚点）");
  assert.ok(/\.cos-badge \{[^}]*text-align: center/.test(ENGINE_CSS), "标牌文本居中排版（名称 + 计数两行）");
  assert.ok(/\.cos-badge \{[^}]*max-width: max\(160px, min\(480px, calc\(100% - 470px\)\)\)/.test(ENGINE_CSS), "标牌限宽避让左面板（187px）与右缘（470 = 2×(187+48)），160px 下限兜底页面宽度不足");
  assert.ok(!/\.cos-badge \{[^}]*left: 16px/.test(ENGINE_CSS), "左上定位已移除（已移居顶部中央）");
  assert.ok(!/\.cos-badge \{[^}]*calc\(50% - 160px\)/.test(ENGINE_CSS), "旧「避让中央搜索带」口径已移除（钻取态搜索框隐藏）");
  assert.ok(ENGINE_CSS.includes("@media (max-width: 520px) { .cos-badge { max-width: calc(100% - 40px); } }"), "窄视口（<520px）断点放宽限宽（允许与面板重叠降级）");
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

/* ── 三指按住平移手势状态机（add-cosmos-three-finger-pan 2.1–2.3 / 3.1）：2→3 首个
   move 红线 / 第四指质心重锚 / 3→2 重锚捏合 / 3→1 回旋转 / 3→0 抑制窗 / 幽灵清理 ── */
{
  const before = createdEls.length;
  const eng = createCosmosEngine({ container: stubEl("div"), style: createSkinD() });
  eng.setScene(miniScene(), "rebuild");
  rafQ.length = 0;
  eng.start();
  let tNow = 40000;
  const step = (n = 1) => { for (let i = 0; i < n; i++) { tNow += 50; stepFrame(tNow); } };
  step(27); // 过冷启动序曲

  const mine = createdEls.slice(before);
  const rootEl = mine.find((el) => el.className === "cos-root");
  const canvasEl = rootEl._by[".cos-canvas"];
  const chipEl = mine.find((el) => String(el.className).startsWith("cos-chip"));
  const fire = (el, type, ev) => { for (const fn of el.listeners[type] ?? []) fn(ev); };
  const input = () => eng.inspectInput();
  const cam = () => eng.getCamera();
  const downOn = (id, x, y, target) => fire(rootEl, "pointerdown", { pointerId: id, button: 0, clientX: x, clientY: y, target, preventDefault() {} });
  const down = (id, x, y) => downOn(id, x, y, canvasEl);
  const move = (id, x, y) => fire(rootEl, "pointermove", { pointerId: id, clientX: x, clientY: y, buttons: 1, target: canvasEl });
  const up = (id) => fire(rootEl, "pointerup", { pointerId: id, button: 0, target: canvasEl });
  const expectPan = (snapshot, dx, dy) => {
    const expected = { target: snapshot.target.slice(), yaw: snapshot.yaw, pitch: snapshot.pitch };
    panCameraTargetByDrag(expected, dx, dy, snapshot.dist);
    return expected.target;
  };

  /* 2→3：捏合中落第三指 → 平移接管（清 pinch/拖拽、质心起点、cancelTween） */
  down(11, 100, 100); down(12, 200, 100);
  assert.equal(input().mode, "pinch", "双指 → pinch 模式");
  assert.deepEqual(input().pinch, { d0: 100, dist0: cam().dist }, "捏合基准建立");
  const distBeforePan = cam().dist;
  down(13, 300, 100);
  assert.equal(input().mode, "pan3", "第三指落下 → pan3 模式");
  assert.equal(input().pinch, null, "pan3 清捏合基准");
  assert.equal(input().gesture, true, "pan3 属多指手势（拾取抑制通道）");
  assert.deepEqual(
    input().pan3,
    { sx: 200, sy: 100, movedX: 0, movedY: 0, pinchCarry: true },
    "平移起点 = 三指质心；自捏合切入记 pinchCarry"
  );
  assert.equal(input().pinchCarry, true, "序列级 pinchCarry（收束补判链）");
  assert.equal(cam().dist, distBeforePan, "进入平移不改 dist");
  assert.equal(eng.inspectFilter().tween, null, "无在途补间");

  /* 2→3 后首个 move 红线：不被捏合重锚守卫抢回（仍平移、dist 不变） */
  const panBefore = cam();
  move(13, 330, 100); // 质心 200 → 210（dx=10）
  assert.equal(input().mode, "pan3", "首个 move 仍为平移（重锚守卫被 !E.pan3 挡住）");
  assert.equal(input().pinch, null, "首个 move 不重建捏合基准");
  assert.equal(cam().dist, distBeforePan, "平移不改 dist（语义未被捏合抢回）");
  const expected1 = expectPan(panBefore, 10, 0);
  assert.ok(
    near(cam().target[0], expected1[0]) && near(cam().target[1], expected1[1]) && near(cam().target[2], expected1[2]),
    "质心 dx=10 → target 按抓取式映射移动"
  );
  assert.ok(near(input().pan3.movedX, 10) && near(input().pan3.movedY, 0), "累计位移镜像 movedX=10 / movedY=0");
  assert.equal(cam().yaw, panBefore.yaw, "平移不改 yaw");
  assert.equal(cam().pitch, panBefore.pitch, "平移不改 pitch");

  /* 第四指：仍平移，质心起点重锚（累计位移保留、无跳变） */
  down(14, 400, 200);
  assert.equal(input().mode, "pan3", "第四指仍平移（不换语义）");
  assert.deepEqual(
    input().pan3,
    { sx: 257.5, sy: 125, movedX: 10, movedY: 0, pinchCarry: true },
    "第四指落点 → 质心起点重锚，累计位移保留"
  );
  const panBefore4 = cam();
  move(14, 404, 200); // 质心 x 257.5 → 258.5（dx=1，四指 1/4 增量）
  const expected4 = expectPan(panBefore4, 1, 0);
  assert.ok(
    near(cam().target[0], expected4[0]) && near(cam().target[1], expected4[1]),
    "第四指 move 按 1/4 质心增量平移（无跳变）"
  );
  assert.ok(near(input().pan3.movedX, 11), "累计位移随质心增量继续累计");

  up(14); // 4→3：仍平移，质心回三指
  assert.equal(input().mode, "pan3", "抬第四指 → 仍为 pan3");
  assert.deepEqual(
    input().pan3,
    { sx: 210, sy: 100, movedX: 11, movedY: 0, pinchCarry: true },
    "4→3 质心起点重锚（累计位移保留）"
  );

  /* 3→2：以余下两指间距重锚捏合，缩放连续无跳变 */
  const distBeforeReanchor = cam().dist;
  up(13);
  assert.equal(input().mode, "pinch", "3→2 → 重锚 pinch");
  assert.equal(input().pan3, null, "3→2 清 pan3");
  assert.deepEqual(input().pinch, { d0: 100, dist0: distBeforeReanchor }, "以余下两指间距重锚捏合基准");
  assert.equal(input().gesture, true, "手势延续（抑制持续）");
  move(12, 300, 100); // 指距 100 → 200
  assert.ok(Math.abs(cam().dist - distBeforeReanchor * 0.5) < 1e-6, "重锚后捏合续接（张开一倍 → dist 减半）");

  /* 3→1：捏合收束补判一次，剩指回单指旋转 */
  up(12);
  assert.equal(input().mode, "rotate", "2→1 → 单指旋转模式");
  assert.equal(input().pinch, null, "2→1 清 pinch");
  assert.equal(input().pinchCarry, false, "捏合收束补判后清 pinchCarry");
  assert.equal(input().gesture, true, "剩指仍属手势（抑制持续）");
  const yawBeforeDrag = cam().yaw;
  move(11, 140, 130);
  assert.notEqual(cam().yaw, yawBeforeDrag, "剩指重置起点后回到单指拖拽旋转语义");

  /* 3→0：全部抬起清态 + 抑制窗 */
  up(11);
  assert.equal(input().gesture, false, "全部抬起 → 手势结束");
  assert.equal(input().mode, "none", "无手势模式");
  assert.equal(input().pan3, null, "pan3 已清");
  assert.equal(input().suppressed, true, "三指收尾进入 GESTURE_SUPPRESS_MS 抑制窗");
  fakeNow += GESTURE_SUPPRESS_MS + 1;
  assert.equal(input().suppressed, false, "抑制窗过期");

  /* pointerleave 幽灵清理共用同一收指 helper（覆盖元素起手 = 无捕获指针） */
  assert.ok(chipEl, "chip 存在（幽灵清理用例）");
  downOn(31, 100, 100, chipEl); downOn(32, 200, 100, chipEl); downOn(33, 300, 100, chipEl);
  assert.equal(input().mode, "pan3", "覆盖元素三指起手同样进入平移");
  assert.equal(input().pointers, 3, "三指在册（均无捕获）");
  fire(rootEl, "pointerleave", {});
  assert.equal(input().pointers, 0, "无捕获幽灵指针全部清理");
  assert.equal(input().gesture, false, "pointerleave 收指 helper 清手势态");
  assert.equal(input().pan3, null, "pan3 随幽灵清理清态");
  assert.equal(input().suppressed, true, "幽灵清理收尾进入抑制窗");

  /* pointercancel（触屏手势被浏览器接管等）同样走统一收指 helper */
  fakeNow += GESTURE_SUPPRESS_MS + 1; // 离开上一抑制窗
  down(41, 100, 100); down(42, 200, 100); down(43, 300, 100);
  assert.equal(input().mode, "pan3", "三指再次进入平移");
  fire(rootEl, "pointercancel", { pointerId: 43 });
  assert.equal(input().mode, "pinch", "pointercancel 3→2 重锚捏合（与 pointerup 同 helper）");
  fire(rootEl, "pointercancel", { pointerId: 42 });
  assert.equal(input().mode, "rotate", "pointercancel 2→1 回单指旋转");
  fire(rootEl, "pointercancel", { pointerId: 41 });
  assert.equal(input().gesture, false, "pointercancel 全部清态");
  assert.equal(input().suppressed, true, "pointercancel 收尾进入抑制窗");

  eng.stop();
  eng.dispose();
}

/* ── 三指平移拾取抑制与收尾窗（spec「三指期间不拾取」） ── */
{
  const before = createdEls.length;
  const eng = createCosmosEngine({ container: stubEl("div"), style: createSkinD() });
  eng.setScene(miniScene(), "rebuild");
  rafQ.length = 0;
  eng.start();
  let tNow = 60000;
  const step = (n = 1) => { for (let i = 0; i < n; i++) { tNow += 50; stepFrame(tNow); } };
  step(27);

  const mine = createdEls.slice(before);
  const rootEl = mine.find((el) => el.className === "cos-root");
  const canvasEl = rootEl._by[".cos-canvas"];
  const cardEl = rootEl._by[".cos-card"];
  const fire = (el, type, ev) => { for (const fn of el.listeners[type] ?? []) fn(ev); };
  const input = () => eng.inspectInput();
  const down = (id, x, y) => fire(rootEl, "pointerdown", { pointerId: id, button: 0, clientX: x, clientY: y, target: canvasEl, preventDefault() {} });
  const up = (id, x, y) => fire(rootEl, "pointerup", { pointerId: id, button: 0, clientX: x, clientY: y, target: canvasEl });

  /* 找命中天体的屏幕点（拾取面自检；与既有输入块同法） */
  cardEl.dataset.sig = "";
  let hitPt = null;
  for (let gx = 368; gx <= 432 && !hitPt; gx += 4) {
    for (let gy = 268; gy <= 332 && !hitPt; gy += 4) {
      fire(rootEl, "pointermove", { pointerId: 90, clientX: gx, clientY: gy, buttons: 0, target: canvasEl });
      step(1);
      if (cardEl.dataset.sig) hitPt = { x: gx, y: gy };
    }
  }
  assert.ok(hitPt, "找到可拾取天体的屏幕点");

  const dives0 = input().dives;
  /* 三指起手落在命中天体上（第二指建立捏合；第三指切平移）→ 全部抬起 */
  down(21, hitPt.x - 30, hitPt.y);
  down(22, hitPt.x, hitPt.y);
  down(23, hitPt.x + 30, hitPt.y);
  assert.equal(input().mode, "pan3", "三指落下进入平移");
  assert.equal(input().gesture, true, "三指手势抑制通道激活");
  up(23, hitPt.x + 30, hitPt.y);
  up(22, hitPt.x, hitPt.y);
  up(21, hitPt.x - 30, hitPt.y);
  assert.equal(input().gesture, false, "全部抬起 → 手势结束");
  assert.equal(input().suppressed, true, "收尾进入抑制窗");
  assert.equal(input().dives, dives0, "三指期间 pointerup MUST NOT 拾取（dive 不触发）");

  /* 抑制窗内单指点击命中天体：仍不拾取；窗过恢复 */
  down(24, hitPt.x, hitPt.y);
  up(24, hitPt.x, hitPt.y);
  assert.equal(input().dives, dives0, "抑制窗内单指抬指不拾取");
  fakeNow += GESTURE_SUPPRESS_MS + 1;
  assert.equal(input().suppressed, false, "抑制窗过期");
  down(25, hitPt.x, hitPt.y);
  up(25, hitPt.x, hitPt.y);
  assert.equal(input().dives, dives0 + 1, "窗过后命中天体拾取恢复（三指序列零残留）");

  eng.stop();
  eng.dispose();
}

/* ── 三指平移打断在途补间（spec「平移打断补间」） ── */
{
  const before = createdEls.length;
  const eng = createCosmosEngine({ container: stubEl("div"), style: createSkinD() });
  eng.setScene(zoomScene(), "rebuild");
  rafQ.length = 0;
  eng.start();
  let tNow = 70000;
  const step = (n = 1) => { for (let i = 0; i < n; i++) { tNow += 50; stepFrame(tNow); } };
  step(27);

  const mine = createdEls.slice(before);
  const rootEl = mine.find((el) => el.className === "cos-root");
  const canvasEl = rootEl._by[".cos-canvas"];
  const fire = (el, type, ev) => { for (const fn of el.listeners[type] ?? []) fn(ev); };
  const down = (id, x, y) => fire(rootEl, "pointerdown", { pointerId: id, button: 0, clientX: x, clientY: y, target: canvasEl, preventDefault() {} });
  const up = (id) => fire(rootEl, "pointerup", { pointerId: id, button: 0, target: canvasEl });

  assert.equal(eng.diveToWs("z1"), true, "启动钻取补间");
  assert.ok(eng.inspectFilter().tween, "补间在途");
  down(31, 100, 300); down(32, 200, 300); down(33, 300, 300);
  assert.equal(eng.inspectInput().mode, "pan3", "三指落下切平移");
  assert.equal(eng.inspectFilter().tween, null, "平移接管 → 在途补间立即让位");
  up(33); up(32); up(31);
  assert.equal(eng.inspectInput().gesture, false, "收尾清手势");

  eng.stop();
  eng.dispose();
}

/* ── 右下「拖拽平移」开关（add-cosmos-drag-pan-toggle 2.1–2.3 / 3.1–3.3）：
   按钮几何与 a11y / 默认关闭且旋转不变 / 开启后鼠标平移（yaw·pitch 不变）/
   touch 仍旋转 / 笔尖同鼠标 / 补间让位 / setTuning 镜像 / 点击回调参数 /
   aria-pressed 翻转 / 手势中切换下一 move 生效 / DOM 只建一次 ── */
{
  const before = createdEls.length;
  const keydownBefore = windowListeners.keydown.length;
  const keyupBefore = windowListeners.keyup.length;
  const toggles = [];
  const eng = createCosmosEngine({
    container: stubEl("div"),
    style: createSkinD(),
    onDragPanToggle: (enabled) => toggles.push(enabled)
  });
  eng.setScene(miniScene(), "rebuild");
  rafQ.length = 0;
  eng.start();
  let tNow = 90000;
  const step = (n = 1) => { for (let i = 0; i < n; i++) { tNow += 50; stepFrame(tNow); } };
  step(27); // 过冷启动序曲

  const mine = createdEls.slice(before);
  const rootEl = mine.find((el) => el.className === "cos-root");
  const overlayEl = rootEl._by[".cos-overlay"];
  const canvasEl = rootEl._by[".cos-canvas"];
  const dragBtn = mine.find((el) => el.className === "cos-dragpan-btn");
  const homeBtn = mine.find((el) => el.className === "cos-home-btn");
  const fire = (el, type, ev) => { for (const fn of el.listeners[type] ?? []) fn(ev); };
  const cam = () => eng.inspectFilter().camera;
  const dragMouse = (from, to, pointerType = "mouse", id = 21) => {
    fire(rootEl, "pointerdown", { pointerId: id, button: 0, clientX: from.x, clientY: from.y, pointerType, target: canvasEl, preventDefault() {} });
    fire(rootEl, "pointermove", { pointerId: id, clientX: to.x, clientY: to.y, buttons: 1, pointerType, target: canvasEl });
    fire(rootEl, "pointerup", { pointerId: id, button: 0, clientX: to.x, clientY: to.y, pointerType, target: canvasEl });
  };
  /* 期望 target：同一纯函数（三指平移）同一系数口径 */
  const expectedPan = (snapshot, dx, dy) => {
    const expected = { target: snapshot.target.slice(), yaw: snapshot.yaw, pitch: snapshot.pitch };
    panCameraTargetByDrag(expected, dx, dy, snapshot.dist);
    return expected.target;
  };

  /* 3.1/3.2 按钮形态：与 home 并存、挂在覆盖层、边长令牌、与 home 横向排列（左侧）、
     风格 D 角标（add-cosmos-layout-tuning D4 落位修正：不再堆叠于上方） */
  assert.ok(dragBtn && homeBtn, "拖拽平移开关与回到银河按钮并存");
  assert.ok(overlayEl.children.indexOf(dragBtn) >= 0, "开关挂在覆盖层（与 home 同一容器）");
  assert.equal(dragBtn.attrs["aria-label"], "拖拽平移", "aria-label 提供");
  assert.equal(dragBtn.attrs.title, "拖拽平移", "title 提供");
  assert.equal(dragBtn.attrs["aria-pressed"], "false", "默认关闭（aria-pressed=false）");
  assert.ok(String(dragBtn.innerHTML).includes("<svg"), "内联四向移动图标");
  assert.ok(
    /\.cos-dragpan-btn \{[^}]*width: var\(--cos-hud-btn-size, 44px\); height: var\(--cos-hud-btn-size, 44px\)/.test(ENGINE_CSS),
    "按钮方形且边长经 --cos-hud-btn-size 令牌可配（与 home 共用）"
  );
  assert.ok(
    /\.cos-dragpan-btn \{[^}]*right: calc\(16px \+ var\(--cos-hud-btn-size, 44px\) \+ 8px\); bottom: 16px/.test(ENGINE_CSS),
    "横向排列于 home 左侧（right = 16 + 边长 + 8）且同 bottom:16 基线"
  );
  assert.ok(!/\.cos-dragpan-btn \{[^}]*bottom: 68px/.test(ENGINE_CSS), "旧「堆叠于 home 上方」（bottom:68）落位已移除");
  assert.ok(/\.cos-home-btn \{[^}]*right: 16px; bottom: 16px/.test(ENGINE_CSS), "home 仍在右缘最外（right:16 / bottom:16）");
  assert.ok(ENGINE_CSS.includes(".cos-dragpan-btn::before"), "风格 D 暖金角标伪元素复用");
  assert.ok(ENGINE_CSS.includes(".cos-dragpan-btn:hover"), "hover 态样式");
  assert.ok(ENGINE_CSS.includes(".cos-dragpan-btn:focus-visible"), "focus-visible 态样式");
  assert.ok(ENGINE_CSS.includes('.cos-dragpan-btn[aria-pressed="true"]'), "开启态点亮样式（aria-pressed 驱动）");

  /* 2.3 关闭态（缺省）：鼠标拖拽 = yaw/pitch 旋转，target 不动（现状零变化） */
  const camOff = cam();
  dragMouse({ x: 400, y: 300 }, { x: 460, y: 330 });
  assert.notEqual(cam().yaw, camOff.yaw, "关闭态鼠标拖拽旋转 yaw");
  assert.notEqual(cam().pitch, camOff.pitch, "关闭态鼠标拖拽旋转 pitch");
  assert.deepEqual(cam().target, camOff.target, "关闭态 target 不动（仍是旋转语义）");

  /* 3.1/3.3 点击开启：回调参数 true + aria-pressed 翻转（DOM 不重建） */
  fire(dragBtn, "click", {});
  assert.deepEqual(toggles, [true], "点击回调携带目标态 enabled=true");
  assert.equal(dragBtn.attrs["aria-pressed"], "true", "开启态 aria-pressed=true（点亮样式依据）");

  /* 2.2/2.3 开启态：鼠标拖拽 = 平移（抓取式映射），yaw/pitch 不变，target 与纯函数逐位一致 */
  const camOn = cam();
  dragMouse({ x: 300, y: 250 }, { x: 340, y: 280 }, "mouse", 22);
  assert.equal(cam().yaw, camOn.yaw, "开启态鼠标拖拽 MUST NOT 改 yaw");
  assert.equal(cam().pitch, camOn.pitch, "开启态鼠标拖拽 MUST NOT 改 pitch");
  const expectedMouse = expectedPan(camOn, 40, 30);
  assert.ok(
    near(cam().target[0], expectedMouse[0]) && near(cam().target[1], expectedMouse[1]) && near(cam().target[2], expectedMouse[2]),
    "鼠标位移按三指平移同一纯函数/同一系数映射（星空随手移动）"
  );

  /* 逐位等于「与三指平移同一函数同一系数口径」：把同一位移喂给三指手势，target 增量一致 */
  const camBeforeThree = cam();
  fire(rootEl, "pointerdown", { pointerId: 31, button: 0, clientX: 100, clientY: 300, target: canvasEl, preventDefault() {} });
  fire(rootEl, "pointerdown", { pointerId: 32, button: 0, clientX: 200, clientY: 300, target: canvasEl, preventDefault() {} });
  fire(rootEl, "pointerdown", { pointerId: 33, button: 0, clientX: 300, clientY: 300, target: canvasEl, preventDefault() {} });
  fire(rootEl, "pointermove", { pointerId: 33, clientX: 340, clientY: 330, buttons: 1, target: canvasEl });
  const expectedThree = expectedPan(camBeforeThree, 40 / 3, 30 / 3);
  assert.ok(
    near(cam().target[0], expectedThree[0]) && near(cam().target[1], expectedThree[1]),
    "三指平移与鼠标平移共用 panCameraTargetByDrag（系数口径同源，无第二套数学）"
  );
  fire(rootEl, "pointerup", { pointerId: 33, button: 0, target: canvasEl });
  fire(rootEl, "pointerup", { pointerId: 32, button: 0, target: canvasEl });
  fire(rootEl, "pointerup", { pointerId: 31, button: 0, target: canvasEl });
  fakeNow += GESTURE_SUPPRESS_MS + 1; // 离开手势抑制窗

  /* 触屏语义不受开关影响（D1）：开关开启时 touch 单指仍旋转，target 不动 */
  const camTouch = cam();
  dragMouse({ x: 300, y: 250 }, { x: 360, y: 280 }, "touch", 23);
  assert.notEqual(cam().yaw, camTouch.yaw, "开启态触屏单指仍旋转 yaw");
  assert.deepEqual(cam().target, camTouch.target, "开启态触屏单指 MUST NOT 平移 target");

  /* 笔尖同鼠标（作用域 mouse|pen） */
  const camPen = cam();
  dragMouse({ x: 300, y: 250 }, { x: 320, y: 260 }, "pen", 24);
  assert.equal(cam().yaw, camPen.yaw, "开启态笔尖拖拽不改 yaw");
  assert.deepEqual(cam().target, expectedPan(camPen, 20, 10), "笔尖拖拽 = 平移（与鼠标同分支）");

  /* 2.3 位移返回 true → 补间让位：在途补间立即被平移输入接管 */
  assert.equal(eng.diveToWs("ws1"), true, "启动钻取补间");
  assert.ok(eng.inspectFilter().tween, "补间在途");
  fire(rootEl, "pointerdown", { pointerId: 25, button: 0, clientX: 300, clientY: 300, pointerType: "mouse", target: canvasEl, preventDefault() {} });
  fire(rootEl, "pointermove", { pointerId: 25, clientX: 340, clientY: 300, buttons: 1, pointerType: "mouse", target: canvasEl });
  assert.equal(eng.inspectFilter().tween, null, "平移拖拽接管 → 在途补间立即让位（与旋转/WASD/滚轮同语义）");
  fire(rootEl, "pointerup", { pointerId: 25, button: 0, clientX: 340, clientY: 300, pointerType: "mouse", target: canvasEl });
  fakeNow += 1400;
  step(1);

  /* 抬指不拾取（wasDrag 抑制）：越过阈值后抬指不触发 dive */
  const camPick = cam();
  const dives0 = eng.inspectInput().dives;
  dragMouse({ x: 400, y: 300 }, { x: 460, y: 340 }, "mouse", 26);
  assert.equal(eng.inspectInput().dives, dives0, "平移拖拽越阈抬指不拾取（wasDrag 抑制，无新增误触面）");
  assert.equal(cam().yaw, camPick.yaw, "拖拽期间无旋转副作用");

  /* 手势中切换开关：自下一个 move 事件起生效（增量模型无基准重锚） */
  fire(rootEl, "pointerdown", { pointerId: 27, button: 0, clientX: 300, clientY: 300, pointerType: "mouse", target: canvasEl, preventDefault() {} });
  fire(rootEl, "pointermove", { pointerId: 27, clientX: 340, clientY: 300, buttons: 1, pointerType: "mouse", target: canvasEl }); // 仍平移
  const camMid = cam();
  fire(dragBtn, "click", {}); // 手势进行中翻转为关闭
  assert.deepEqual(toggles, [true, false], "手势中点击 → 回调携带目标态 false");
  assert.equal(dragBtn.attrs["aria-pressed"], "false", "视觉随翻转回落未点亮");
  fire(rootEl, "pointermove", { pointerId: 27, clientX: 380, clientY: 300, buttons: 1, pointerType: "mouse", target: canvasEl });
  assert.notEqual(cam().yaw, camMid.yaw, "翻转关闭后自下一个 move 起回到旋转（无跳变、无重锚）");
  assert.deepEqual(cam().target, camMid.target, "旋转分支不改 target（开关值按每 move 当下值判定）");
  fire(rootEl, "pointerup", { pointerId: 27, button: 0, clientX: 380, clientY: 300, pointerType: "mouse", target: canvasEl });

  /* 2.1/4.1 setTuning 镜像（部分写 + 幂等）：布尔才更新，恒等不触达；视觉跟随权威 */
  eng.setTuning({ dragPan: true });
  assert.equal(dragBtn.attrs["aria-pressed"], "true", "setTuning 热更 → 镜像与视觉同步点亮");
  const camTuned = cam();
  dragMouse({ x: 300, y: 250 }, { x: 330, y: 265 }, "mouse", 28);
  assert.deepEqual(cam().target, expectedPan(camTuned, 30, 15), "热更后鼠标拖拽即平移（无需重开整页）");
  eng.setTuning({ dragPan: true }); // 幂等：值未变
  assert.equal(dragBtn.attrs["aria-pressed"], "true", "同值热更幂等（状态不抖）");
  eng.setTuning({ dragPan: "yes" }); // 非布尔 → 部分写忽略
  assert.equal(dragBtn.attrs["aria-pressed"], "true", "非布尔入参不更新镜像（非法值不降级）");
  assert.equal(eng.getTuning().dragPan, undefined, "开关镜像是引擎级状态：MUST NOT 进 getTuning 返回值");

  /* 4.2 既有导航通道零回归（开关**开启态**下逐通道验证 spec「既有导航通道零回归」）：
     开关只分叉「鼠标/笔尖单指拖拽」一条路径，其余通道数学与入口均未被触碰。 */
  const distWheel = cam().dist;
  fire(rootEl, "wheel", { preventDefault() {}, deltaY: 120, clientX: 400, clientY: 300, target: canvasEl });
  assert.ok(cam().dist > distWheel, "开启态滚轮缩放照常（含指针聚焦路径）");

  const distPinch = cam().dist;
  fire(rootEl, "pointerdown", { pointerId: 51, button: 0, clientX: 200, clientY: 300, pointerType: "touch", target: canvasEl, preventDefault() {} });
  fire(rootEl, "pointerdown", { pointerId: 52, button: 0, clientX: 300, clientY: 300, pointerType: "touch", target: canvasEl, preventDefault() {} });
  fire(rootEl, "pointermove", { pointerId: 52, clientX: 400, clientY: 300, buttons: 1, pointerType: "touch", target: canvasEl });
  assert.ok(cam().dist < distPinch, "开启态双指捏合照常（指距张开 → 放大）");
  fire(rootEl, "pointerup", { pointerId: 52, button: 0, target: canvasEl });
  fire(rootEl, "pointerup", { pointerId: 51, button: 0, target: canvasEl });
  fakeNow += GESTURE_SUPPRESS_MS + 1;

  const camW = cam();
  for (const fn of windowListeners.keydown.slice(keydownBefore)) {
    fn({ code: "KeyW", ctrlKey: false, metaKey: false, altKey: false, isComposing: false, preventDefault() {} });
  }
  step(2);
  for (const fn of windowListeners.keyup.slice(keyupBefore)) fn({ code: "KeyW" });
  assert.notDeepEqual(cam().target, camW.target, "开启态 WASD 平移照常（窗口键面与帧积分零改动）");
  assert.equal(cam().yaw, camW.yaw, "WASD 平移不改 yaw（既有语义）");

  /* 3.3 DOM 只建一次：钻取往返 / 场景重建后仍是同一实例（未参与逐帧重建） */
  eng.setScene(miniScene(), "rebuild");
  step(1);
  eng.diveToWs("ws1");
  fakeNow += 1400;
  step(1);
  eng.consumeEscape();
  fakeNow += 1400;
  step(1);
  const dragBtnsAgain = createdEls.slice(before).filter((el) => el.className === "cos-dragpan-btn");
  assert.equal(dragBtnsAgain.length, 1, "开关 DOM 全程只建一次（场景重建/钻取往返不重建）");
  assert.equal(dragBtnsAgain[0], dragBtn, "同一实例（click 派发不被吞）");

  eng.stop();
  eng.dispose();
}

/* ── 拖拽平移开关：创建 opts 初值（持久化 true 冷启动即开启）/ 未注入回调静默 ── */
{
  const before = createdEls.length;
  const eng = createCosmosEngine({
    container: stubEl("div"),
    style: createSkinD(),
    settings: { dragPan: true }
  });
  eng.setScene(miniScene(), "rebuild");
  rafQ.length = 0;
  eng.start();
  let tNow = 120000;
  const step = (n = 1) => { for (let i = 0; i < n; i++) { tNow += 50; stepFrame(tNow); } };
  step(27);

  const mine = createdEls.slice(before);
  const rootEl = mine.find((el) => el.className === "cos-root");
  const canvasEl = rootEl._by[".cos-canvas"];
  const dragBtn = mine.find((el) => el.className === "cos-dragpan-btn");
  const fire = (el, type, ev) => { for (const fn of el.listeners[type] ?? []) fn(ev); };
  const cam = () => eng.inspectFilter().camera;

  assert.equal(dragBtn.attrs["aria-pressed"], "true", "持久化 true → 冷启动按钮即呈开启态（构建期同步 aria）");
  const camOn = cam();
  fire(rootEl, "pointerdown", { pointerId: 41, button: 0, clientX: 300, clientY: 250, pointerType: "mouse", target: canvasEl, preventDefault() {} });
  fire(rootEl, "pointermove", { pointerId: 41, clientX: 330, clientY: 265, buttons: 1, pointerType: "mouse", target: canvasEl });
  assert.equal(cam().yaw, camOn.yaw, "冷启动开启态：鼠标拖拽即平移（不改 yaw）");
  assert.notDeepEqual(cam().target, camOn.target, "冷启动开启态：target 随拖拽移动");
  fire(rootEl, "pointerup", { pointerId: 41, button: 0, clientX: 330, clientY: 265, pointerType: "mouse", target: canvasEl });

  /* 未注入回调：点击只做本地翻转（静默 no-op，不抛错） */
  fire(dragBtn, "click", {});
  assert.equal(dragBtn.attrs["aria-pressed"], "false", "未注入回调仍本地翻转（不抛错）");

  eng.stop();
  eng.dispose();
}

/* ── 捏合越阈切平移，收束仍补判阈值导航（spec「捏合越阈切平移收束仍补判」） ── */
{
  const before = createdEls.length;
  const eng = createCosmosEngine({ container: stubEl("div"), style: createSkinD() });
  eng.setScene(zoomScene(), "rebuild");
  eng.setTuning({ zoomPointerFocus: false }); // 聚焦关闭：target 不动，闸门保持屏心（判定链隔离）
  rafQ.length = 0;
  eng.start();
  let tNow = 80000;
  const step = (n = 1) => { for (let i = 0; i < n; i++) { tNow += 50; stepFrame(tNow); } };
  step(27);

  const mine = createdEls.slice(before);
  const rootEl = mine.find((el) => el.className === "cos-root");
  const canvasEl = rootEl._by[".cos-canvas"];
  const fire = (el, type, ev) => { for (const fn of el.listeners[type] ?? []) fn(ev); };
  const input = () => eng.inspectInput();
  const down = (id, x, y) => fire(rootEl, "pointerdown", { pointerId: id, button: 0, clientX: x, clientY: y, target: canvasEl, preventDefault() {} });
  const move = (id, x, y) => fire(rootEl, "pointermove", { pointerId: id, clientX: x, clientY: y, buttons: 1, target: canvasEl });
  const up = (id) => fire(rootEl, "pointerup", { pointerId: id, button: 0, target: canvasEl });

  assert.equal(input().dives, 0, "初始未钻取");
  down(41, 100, 300); down(42, 200, 300);
  move(42, 800, 300); // 指距 100 → 700：dist 430 → 61.4 < DIVE_REF 155（越阈）
  assert.ok(eng.getCamera().dist < DIVE_REF, "捏合越过钻取阈值");
  assert.equal(input().dives, 0, "捏合进行中不判定（不抢补间）");
  step(1); // 更新场景投影（target 未动 → 星座仍在屏心闸门内）

  down(43, 450, 300); // 第三指切平移
  assert.equal(input().mode, "pan3", "捏合中落第三指 → 切平移");
  assert.equal(input().pan3.pinchCarry, true, "平移记住本序列曾捏合");
  move(43, 500, 300); // 平移一点（dist 不变）
  assert.equal(input().dives, 0, "平移进行中仍不判定");
  up(43); // 3→2 重锚捏合
  assert.equal(input().mode, "pinch", "3→2 重锚捏合");
  up(42); // 2→1 收束补判
  assert.equal(input().dives, 1, "收束以最终 dist 补判一次 → 自动 dive（不因切平移丢失）");
  up(41); // 1→0 不重复判定
  assert.equal(input().dives, 1, "收束补判只发生一次（无重复 dive）");

  eng.stop();
  eng.dispose();
}

/* ── 皮肤热切换（add-cosmos-skin-themes D6/2.2/2.4）：呈现层替换，场景零重建 ── */
{
  const container = stubEl("div");
  const eng = createCosmosEngine({ container, style: createSkinD() });
  eng.setScene(miniScene(), "rebuild");
  eng.start();
  let tNow = 9000;
  const step = () => { tNow += 50; stepFrame(tNow); };
  for (let i = 0; i < 27; i++) step(); // 冷启动序曲窗口结束（1.2s）

  /* 在途转场：超新星（幽灵）+ executed 金涌（fx）——切换后必须续播、不被清理 */
  eng.markStarNova("add-a", [10, 0, 0], "#ffe27a", { driftTo: [0, 0, 0] });
  eng.markFx("star", "add-a", "surge");
  for (let i = 0; i < 4; i++) step();
  assert.ok(eng.inspectGhosts().novae > 0, "切换前存在在途超新星");
  assert.ok(eng.inspectFx().some((fx) => fx.type === "surge"), "切换前存在在途金涌");

  eng.diveToWs("ws1");
  fakeNow += 1400;
  for (let i = 0; i < 4; i++) step();
  assert.equal(eng.isDiving(), true, "切换前：钻取态");

  const sceneRef = eng.getScene();
  const entities0 = eng.inspectEntities("ws1");
  const fx0 = eng.inspectFx();
  const ghosts0 = eng.inspectGhosts();
  const filter0 = eng.inspectFilter();
  const camera0 = eng.getCamera();
  const skin0 = eng.inspectSkin();
  assert.equal(skin0.id, "deepspace", "初始皮肤 = 构造参数（deepspace）");
  assert.equal(skin0.gen, 0, "初始热切换代数 0");

  const rose = createSkin("rosepine");
  assert.equal(eng.setSkin(rose), true, "setSkin 替换呈现层皮肤（仅 E.style）");
  assert.deepEqual(eng.inspectSkin(), { id: "rosepine", gen: 1, useBand: true }, "皮肤观测面：id / 代数 / 银河带标记");
  assert.equal(eng.setSkin(rose), false, "同实例 → 幂等 false");
  assert.equal(eng.setSkin(null), false, "非法入参 → false 不抛错");
  assert.equal(eng.setSkin({}), false, "缺 drawBody → false");
  assert.equal(eng.inspectSkin().gen, 1, "拒绝路径不改代数");

  assert.equal(eng.getScene(), sceneRef, "场景数据引用恒等（MUST NOT 重建场景）");
  assert.deepEqual(eng.inspectEntities("ws1"), entities0, "天体实体保持（恒星/行星/彗星/卫星）");
  assert.deepEqual(eng.inspectFx(), fx0, "在途转场 fx 不被清理（跨皮肤续播同一时间线）");
  assert.deepEqual(eng.inspectGhosts(), ghosts0, "nova / 星座消散幽灵条目保持");
  assert.equal(eng.isDiving(), true, "钻取态保持");
  assert.deepEqual(eng.getCamera(), camera0, "相机保持（target / yaw / pitch / dist）");
  assert.deepEqual(eng.inspectFilter().vis, filter0.vis, "过滤可见态保持");
  assert.deepEqual(eng.inspectFilter().centers, filter0.centers, "星座落位保持");
  assert.equal(eng.inspectFxQueue().pending, 0, "切换不新增调度队列条目");

  /* 下一帧即用新皮肤绘制（无重建、无额外 API） */
  let roseCalls = 0;
  const origDraw = rose.drawBody;
  rose.drawBody = function (ctx, it, view) { roseCalls += 1; return origDraw.call(this, ctx, it, view); };
  try {
    step();
  } finally {
    rose.drawBody = origDraw;
  }
  assert.ok(roseCalls > 0, "换肤后下一帧即由新皮肤绘制");
  assert.ok(eng.inspectGhosts().novae > 0, "超新星跨皮肤续播（仍在册）");

  /* 钻取态下切回 deepspace：仍无重建 */
  assert.equal(eng.setSkin(createSkinD()), true, "钻取态下回切 deepspace");
  step();
  assert.equal(eng.inspectSkin().id, "deepspace");
  assert.equal(eng.getScene(), sceneRef, "回切后场景数据仍恒等");

  eng.dispose();
  assert.equal(eng.setSkin(rose), false, "dispose 后 setSkin → false（不抛错）");
}

/* ── 缩放阈值钻取导航接线（add-cosmos-zoom-focus-nav 2.2–2.5）：滚轮逐次进入 /
   捏合收束判定 / 返回阈值 / diveFrom 安全化 / 冷却锚点双写 / 振荡红线 ── */
{
  const container = stubEl("div");
  const eng = createCosmosEngine({ container, style: createSkinD(), settings: { zoomPointerFocus: false } });
  eng.setScene(zoomScene(), "rebuild");
  const root = container.children[0];
  const fireWheel = (deltaY, x = 400, y = 300) => {
    for (const fn of root.listeners.wheel ?? []) {
      fn({ preventDefault() {}, deltaY, clientX: x, clientY: y, target: root._by[".cos-canvas"] });
    }
  };
  rafQ.length = 0;
  fakeNow = 70000;
  let tNow = 70000;
  const step = () => { tNow += 50; stepFrame(tNow); };
  eng.start();
  step();
  assert.equal(eng.inspectInput().dives, 0, "初始银河态无钻取");
  assert.equal(eng.inspectZoomNav().ws[0].boundR, 12, "空星座 boundR = 星云下限 12");
  assert.ok(eng.inspectZoomNav().ws[0].proj, "首帧渲染产出星座投影（最近星座选择前提）");

  /* 进入：7 次滚轮放大后 dist 144.8 < 155 → 自动 dive（滚轮逐次判定） */
  for (let i = 0; i < 6; i++) fireWheel(-120);
  assert.equal(eng.inspectInput().dives, 0, "未过阈值（dist≈169）不触发");
  fireWheel(-120);
  assert.equal(eng.inspectInput().dives, 1, "越过参考视距 → 自动 dive");
  const navIn = eng.inspectZoomNav();
  assert.equal(navIn.switchAt, fakeNow, "切换触发时刻写冷却锚点");
  assert.ok(near(navIn.diveFromDist, DIVE_REF * DIVE_SAFE_MARGIN, 1e-9), "diveFrom 安全化：快照 dist ≥ 155×1.15");
  assert.equal(eng.inspectFilter().focus.diving, true, "钻取态立即生效（不等补间收尾）");
  assert.equal(eng.inspectFilter().tween.mode, "in", "复用既有 dive 补间（1300ms）");
  assert.equal(eng.inspectFilter().tween.dur, 1300, "与 chip 点击同一镜头语言（不做短时长变体）");

  /* 补间收尾：dist=155、冷却锚点双写 */
  fakeNow += 1400;
  step();
  assert.ok(near(eng.getCamera().dist, DIVE_REF, 1e-9), "钻取终态 dist = 参考视距 155");
  assert.equal(eng.inspectZoomNav().switchAt, fakeNow, "补间收尾再次刷新冷却锚点（双写）");
  assert.equal(eng.inspectFilter().tween, null, "补间已收尾");

  /* 冷却窗内反向缩放：只缩放、不判定（刚进入不误返回） */
  fireWheel(120);
  assert.equal(eng.inspectFilter().tween, null, "冷却窗内不触发切换补间");
  assert.equal(eng.inspectZoomNav().switchAt, fakeNow, "冷却锚点未被冷却窗内输入改写");

  /* 冷却过期后继续缩小：越过 dist 下限（209.25）+ 屏显直径阈值 → 自动 flyOut */
  fakeNow += SWITCH_COOLDOWN_MS + 100;
  fireWheel(120);
  fireWheel(120);
  assert.equal(eng.inspectFilter().tween.mode, "out", "缩小越过返回阈值 → 自动飞回（Esc 等效）");
  assert.ok(near(eng.inspectZoomNav().diveFromDist, DIVE_REF * DIVE_SAFE_MARGIN, 1e-9), "飞回落点 = 安全化快照");
  fakeNow += 1300;
  step();
  assert.equal(eng.inspectFilter().focus.diving, false, "飞回收尾退出钻取态");
  assert.ok(near(eng.getCamera().dist, DIVE_REF * DIVE_SAFE_MARGIN, 1e-9), "落点 dist = 178.25（触发带外）");
  assert.equal(eng.inspectInput().dives, 1, "无缩放输入不自动再次进入（振荡红线）");
  eng.dispose();
}

/* ── 空星座同样自动进入（spec scenario）：仅 chip、无恒星/行星/彗星，boundR = 下限 12 ── */
{
  const data = zoomScene();
  data.workspaces[0].stars = [];
  const container = stubEl("div");
  const eng = createCosmosEngine({ container, style: createSkinD(), settings: { zoomPointerFocus: false } });
  eng.setScene(data, "rebuild");
  const root = container.children[0];
  const fireWheel = (deltaY) => {
    for (const fn of root.listeners.wheel ?? []) {
      fn({ preventDefault() {}, deltaY, clientX: 400, clientY: 300, target: root._by[".cos-canvas"] });
    }
  };
  rafQ.length = 0;
  fakeNow = 71000;
  let tNow = 71000;
  eng.start();
  stepFrame(tNow += 50);
  assert.equal(eng.inspectZoomNav().ws[0].boundR, 12, "空星座 boundR = 星云下限");
  for (let i = 0; i < 7; i++) fireWheel(-120);
  assert.equal(eng.inspectInput().dives, 1, "空星座（仅 chip）同样按阈值自动 dive（与点击空星座 chip 一致）");
  eng.dispose();
}

/* ── 指针聚焦缩放接线（2.2/2.3）：滚轮坐标焦点 / zoomBy 屏心 / 端点冻结 / 开关 /
   捏合中点与收束判定 ── */
{
  /* 不做首帧渲染（proj null）→ 最近星座不可选，聚焦行为可孤立断言 */
  const container = stubEl("div");
  const eng = createCosmosEngine({ container, style: createSkinD() });
  eng.setScene(zoomScene(), "rebuild");
  const root = container.children[0];
  const fireWheel = (deltaY, x = 400, y = 300) => {
    for (const fn of root.listeners.wheel ?? []) {
      fn({ preventDefault() {}, deltaY, clientX: x, clientY: y, target: root._by[".cos-canvas"] });
    }
  };
  fakeNow = 76000;
  const cam0 = eng.getCamera();
  fireWheel(-120, 600, 300);
  const cam1 = eng.getCamera();
  assert.ok(cam1.dist < cam0.dist, "滚轮缩放生效");
  assert.notDeepEqual(cam1.target, cam0.target, "指针偏离屏心 → 镜头 target 向指针聚焦");
  assert.deepEqual(
    cam1.target,
    zoomFocusTargetOf(cam0, 600, 300, 800, 600, cam0.dist * (1 - 120 * 0.0012)),
    "引擎聚焦 = 纯函数收敛式（d1 = d0×(1+dy×0.0012)）"
  );

  /* zoomBy 公共面：屏心缩放（target 不动），且不触发阈值导航 */
  const targetBeforeZoomBy = eng.getCamera().target.slice();
  eng.zoomBy(-120);
  assert.deepEqual(eng.getCamera().target, targetBeforeZoomBy, "动作条 zoomBy 屏心缩放（无指针坐标）");
  assert.equal(eng.inspectInput().dives, 0, "zoomBy 不触发阈值导航");

  /* zoomBy 带坐标（fix-cosmos-zoom-nav-focus-deadzone D1/D2）：动作条滚轮聚焦收敛 ——
     与容器内滚轮同一收敛式（引擎内 canvas rect 单源换算；测试桩 rect 原点 → 坐标直通） */
  const camA = eng.getCamera();
  const divesA = eng.inspectInput().dives;
  assert.equal(eng.zoomBy(-120, { clientX: 600, clientY: 300 }), true, "带坐标调用被消费（有效 deltaY）");
  const camB = eng.getCamera();
  assert.ok(camB.dist < camA.dist, "动作条 zoomBy 带坐标缩放生效");
  assert.notDeepEqual(camB.target, camA.target, "动作条带坐标 → target 向指针聚焦（缩放死区消除）");
  assert.deepEqual(
    camB.target,
    zoomFocusTargetOf(camA, 600, 300, 800, 600, camA.dist * (1 - 120 * 0.0012)),
    "动作条聚焦 = 容器内滚轮同一收敛式（rect 换算后透传 applyWheelZoom）"
  );
  assert.equal(eng.inspectInput().dives, divesA, "带坐标路径不触发阈值导航（judge:false 分型）");
  /* 缺坐标 / 非法坐标 → point=null → 屏心回落（向后兼容：旧调用桩/合成事件） */
  const camC = eng.getCamera();
  eng.zoomBy(-120);
  assert.deepEqual(eng.getCamera().target, camC.target, "缺坐标 → 屏心");
  eng.zoomBy(-120, { clientX: undefined, clientY: undefined });
  assert.deepEqual(eng.getCamera().target, camC.target, "坐标字段缺失 → 屏心（换算失败回落 null）");
  assert.equal(eng.zoomBy(0, { clientX: 600, clientY: 300 }), false, "带坐标但 0 deltaY → 不消费");

  /* 端点冻结：dist 已贴 4200 仍滚轮 → target 不漂移 */
  eng.zoomBy(100000);
  assert.ok(near(eng.getCamera().dist, 4200, 1e-9), "zoomBy 值域 clamp 到 4200");
  const endpointTarget = eng.getCamera().target.slice();
  fireWheel(120, 600, 300);
  assert.deepEqual(eng.getCamera().target, endpointTarget, "端点 clamp 后 target MUST NOT 移动（无抖动漂移）");
  assert.ok(near(eng.getCamera().dist, 4200, 1e-9), "端点距离不变");
  /* 端点冻结纪律对公共面带坐标路径同样生效（D4：纯透传，零新分支） */
  eng.zoomBy(120, { clientX: 600, clientY: 300 });
  assert.deepEqual(eng.getCamera().target, endpointTarget, "动作条带坐标在端点同样冻结 target");
  assert.ok(near(eng.getCamera().dist, 4200, 1e-9), "动作条带坐标在端点距离不变");

  /* 开关：关闭指针聚焦 → 回落屏心（阈值导航仍可独立工作） */
  eng.setTuning({ zoomPointerFocus: false });
  assert.equal(eng.getTuning().zoomPointerFocus, false, "setTuning 关闭指针聚焦");
  const targetOff = eng.getCamera().target.slice();
  fireWheel(-120, 600, 300);
  assert.deepEqual(eng.getCamera().target, targetOff, "关闭后缩放 target 不动（现状行为）");
  eng.zoomBy(-120, { clientX: 600, clientY: 300 });
  assert.deepEqual(eng.getCamera().target, targetOff, "关闭后动作条带坐标同样回落屏心（开关守卫沿用）");

  /* getTuning 扩键（2.6） */
  eng.setTuning({ zoomDiveRatio: 80, zoomFlyOutRatio: 40 });
  assert.deepEqual(
    eng.getTuning(),
    { panSpeed: 120, panShiftBoost: 3, zoomDiveRatio: 80, zoomFlyOutRatio: 40, zoomPointerFocus: false },
    "setTuning/getTuning 扩三键（部分写语义）"
  );
  eng.dispose();
}

{
  /* 捏合中点聚焦（2.3）：同一收敛式 + canvas 相对坐标（rect 转换） */
  const container = stubEl("div");
  const eng = createCosmosEngine({ container, style: createSkinD(), settings: { zoomPointerFocus: true } });
  eng.setScene(zoomScene(), "rebuild");
  const root = container.children[0];
  const canvas = root._by[".cos-canvas"];
  const fire = (type, ev) => {
    for (const fn of root.listeners[type] ?? []) fn({ preventDefault() {}, target: canvas, ...ev });
  };
  fakeNow = 78000;
  const cam0 = eng.getCamera();
  fire("pointerdown", { pointerId: 11, button: 0, clientX: 100, clientY: 100 });
  fire("pointerdown", { pointerId: 12, button: 0, clientX: 300, clientY: 100 });
  assert.equal(eng.inspectInput().gesture, true, "双指落下切捏合手势");
  fire("pointermove", { pointerId: 12, clientX: 300, clientY: 140, buttons: 1 });
  const cam1 = eng.getCamera();
  const pinchD = Math.hypot(200, 40);
  const pinchNext = cam0.dist * 200 / pinchD;
  assert.ok(near(cam1.dist, pinchNext, 1e-9), "捏合距离 = dist0×d0/d");
  assert.notDeepEqual(cam1.target, cam0.target, "捏合以双指中点为焦点移动 target");
  assert.deepEqual(
    cam1.target,
    zoomFocusTargetOf(cam0, 200, 120, 800, 600, pinchNext),
    "捏合聚焦 = 同一收敛式（中点 canvas 相对坐标）"
  );
  fire("pointerup", { pointerId: 12, button: 0 });
  fire("pointerup", { pointerId: 11, button: 0 });
  assert.equal(eng.inspectInput().dives, 0, "proj 缺席 → 收束判定无目标（不误 dive）");
  eng.dispose();
}

{
  /* 捏合收束判定（2.3/2.4）：手势进行中不判定，收束以最终 dist 补判一次 → 自动 dive */
  const container = stubEl("div");
  const eng = createCosmosEngine({ container, style: createSkinD(), settings: { zoomPointerFocus: false } });
  eng.setScene(zoomScene(), "rebuild");
  const root = container.children[0];
  const canvas = root._by[".cos-canvas"];
  const fire = (type, ev) => {
    for (const fn of root.listeners[type] ?? []) fn({ preventDefault() {}, target: canvas, ...ev });
  };
  rafQ.length = 0;
  fakeNow = 80000;
  let tNow = 80000;
  eng.start();
  stepFrame(tNow += 50);
  eng.zoomBy(-446); // 430 → ≈199.9（judge=false，模拟已放大到接近阈值）
  assert.ok(eng.getCamera().dist < 210 && eng.getCamera().dist > 190, "捏合前镜头距离已接近阈值");
  const dives0 = eng.inspectInput().dives;
  fire("pointerdown", { pointerId: 21, button: 0, clientX: 100, clientY: 300 });
  fire("pointerdown", { pointerId: 22, button: 0, clientX: 200, clientY: 300 });
  fire("pointermove", { pointerId: 22, clientX: 300, clientY: 300, buttons: 1 });
  assert.equal(eng.inspectInput().dives, dives0, "捏合手势进行中不判定（不抢补间）");
  assert.ok(eng.getCamera().dist <= DIVE_REF, "捏合后最终距离已越过进入阈值");
  fire("pointerup", { pointerId: 22, button: 0 });
  assert.equal(eng.inspectInput().dives, dives0 + 1, "捏合收束以最终 dist 补判一次 → 自动 dive");
  eng.dispose();
}

/* ── 动作条公共面缩放不参与阈值导航（fix-cosmos-zoom-nav-focus-deadzone 3.2/3.3 红线）：
   同一阈值带：容器级滚轮（判定通道）会自动 dive/flyOut，公共面 zoomBy（带坐标）恒不判定；
   带坐标多步滚动逐步向指针聚焦收敛（渐进，MUST NOT 一次到位） ── */
{
  const container = stubEl("div");
  const eng = createCosmosEngine({ container, style: createSkinD() });
  eng.setScene(zoomScene(), "rebuild");
  const root = container.children[0];
  const fireWheel = (deltaY, x = 400, y = 300) => {
    for (const fn of root.listeners.wheel ?? []) {
      fn({ preventDefault() {}, deltaY, clientX: x, clientY: y, target: root._by[".cos-canvas"] });
    }
  };
  rafQ.length = 0;
  fakeNow = 85000;
  let tNow = 85000;
  const step = () => { tNow += 50; stepFrame(tNow); };
  eng.start();
  step();

  /* 进入侧红线：7 次动作条滚轮（带坐标）越过进入阈值，仍不 dive（judge:false） */
  let prev = eng.getCamera();
  const dists = [];
  const incs = [];
  for (let i = 0; i < 7; i++) {
    eng.zoomBy(-120, { clientX: 600, clientY: 300 });
    const cam = eng.getCamera();
    dists.push(cam.dist);
    incs.push(cam.target[0] - prev.target[0]);
    prev = cam;
  }
  assert.ok(dists.every((d, i) => i === 0 || d < dists[i - 1]), "动作条滚轮每步都缩放（距离单调下降）");
  assert.ok(dists[6] < DIVE_REF, "动作条 7 步滚轮越过进入阈值（步长与容器内滚轮一致）");
  assert.equal(eng.inspectInput().dives, 0, "动作条滚轮不触发自动 dive（阈值导航分型红线）");
  assert.ok(incs.every((v) => v > 0), "每步 target 都向指针（+x）方向移动（无聚焦死区）");
  assert.ok(incs.every((v, i) => i === 0 || v < incs[i - 1]), "步进量逐步收敛（渐进聚焦而非一次到位）");

  /* 返回侧红线：钻取态 + 冷却过期后，动作条拉远跨过返回阈值带 → 不自动飞回 */
  assert.equal(eng.diveToWs("z1"), true, "钻取进入（构造返回阈值场景）");
  fakeNow += 1400;
  step(); // 钻取补间收尾（切换补间收尾重锚冷却窗）
  assert.equal(eng.inspectFilter().focus.diving, true, "钻取态成立");
  fakeNow += SWITCH_COOLDOWN_MS + 100;
  step();
  const zoomOuts = [];
  for (let i = 0; i < 3; i++) {
    eng.zoomBy(120, { clientX: 400, clientY: 300 });
    zoomOuts.push(eng.getCamera().dist);
  }
  assert.ok(zoomOuts[2] > DIVE_REF * FLYOUT_DIST_FLOOR_MULT, "动作条已拉远越过返回阈值迟滞线");
  assert.equal(eng.inspectFilter().focus.diving, true, "动作条拉远不触发自动飞回（恒不判定）");
  assert.equal(eng.inspectFilter().tween, null, "无 flyOut 补间（不判定）");
  /* 对照：同一距离带内走容器级滚轮（判定通道）→ 立即 flyOut（判定分型仍在，红线只针对公共面） */
  fireWheel(120, 400, 300);
  assert.equal(eng.inspectFilter().tween?.mode, "out", "容器级滚轮同条件触发飞回（分型对照）");
  eng.dispose();
}

/* ── patch 路径 boundR 同触点更新（2.1）：archives / 恒星 off 变化后返回阈值半径同步 ── */
{
  const container = stubEl("div");
  const eng = createCosmosEngine({ container, style: createSkinD() });
  eng.setScene(zoomScene(), "rebuild");
  assert.equal(eng.inspectZoomNav().ws[0].boundR, 12, "初始 boundR = 12");
  const archived = zoomScene();
  archived.workspaces[0].archives = 10;
  eng.setScene(archived, "patch");
  assert.equal(eng.inspectZoomNav().ws[0].boundR, 12 + 10 * 2.4, "patch：archives 增长 → 星云下限同步");
  const moved = zoomScene();
  moved.workspaces[0].stars[0].off = [40, 0, 0];
  eng.setScene(moved, "patch");
  assert.equal(eng.inspectZoomNav().ws[0].boundR, 40, "patch：恒星 off 变化 → 恒星包络同步");
  eng.dispose();
}

/* ── 硬编码清零口径（spec「HUD 镀铬主题化」/ 2.4）：
      金色系字面量仅允许出现在 `var(--cos-*, fallback)` 的 fallback 位。 ── */
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
  const engineSource = readFileSync(new URL("../src/cosmos/engine.mjs", import.meta.url), "utf8");
  const offenders = goldLiteralsOutsideVarFallback(engineSource);
  assert.deepEqual(offenders, [], "engine.mjs 金色系字面量仅存在于 var() fallback 位");
  for (const token of ["--cos-ink", "--cos-scan", "--cos-line-strong", "--cos-panel", "--cos-glow", "--cos-title-ink", "--cos-accent-rgb", "--cos-chip-bg", "--cos-ink-dim"]) {
    assert.ok(engineSource.includes("var(" + token), "engine.mjs 注入 CSS 消费令牌 " + token);
  }
  assert.ok(engineSource.includes("repeating-linear-gradient(0deg, var(--cos-scan"), "扫描线走令牌（纸面皮肤可关）");
  assert.ok(engineSource.includes("border-top: 2px solid var(--cos-line-strong"), "角标 2px 实线走令牌");
}

/* ── 选中收口 / 幂等通知 / 落地预选 kind（add-cosmos-selection-linkage 1.1–1.2 / D6） ──
   既有 wart：`E.diveSel` 存实体（实体无 `kind` 字段）→ 落地写 `kind: E.diveSel.kind`
   恒为 undefined → entKey 键不合，选中环/名牌/信息卡全链不显示。收口后 kind 由实体
   归属推导，落地即全链可见（信息卡按 `data-key = star:<id>` 解析成功）。 */
{
  /* 赋值点收口：引擎源码内 `E.selected =` 仅剩 setSelection 内一处（grep 断言）。 */
  const engineSource = readFileSync(new URL("../src/cosmos/engine.mjs", import.meta.url), "utf8");
  assert.equal((engineSource.match(/E\.selected\s*=/g) ?? []).length, 1, "E.selected 直接赋值仅剩 1 处（setSelection 收口）");
  const setterAt = engineSource.indexOf("function setSelection(next)");
  const setterEnd = engineSource.indexOf("function kindOfEntity");
  assert.ok(setterAt > 0 && setterEnd > setterAt, "setSelection 收口切片可定位");
  assert.ok(/E\.selected\s*=/.test(engineSource.slice(setterAt, setterEnd)), "唯一赋值点位于 setSelection 内");
  assert.ok((engineSource.match(/setSelection\(/g) ?? []).length >= 10, "全部选中变更位点均经 setSelection（≥10 处调用）");

  const notifications = [];
  const container = stubEl("div");
  const eng = createCosmosEngine({
    container, style: createSkinD(),
    onSelectChange: (info) => notifications.push(info)
  });
  const root = container.children[0];
  const canvas = root._by[".cos-canvas"];
  const card = root._by[".cos-card"];
  const fire = (type, ev) => {
    for (const fn of root.listeners[type] ?? []) fn({ preventDefault() {}, target: canvas, ...ev });
  };
  rafQ.length = 0;
  fakeNow = 200000;
  let tNow = 200000;
  const step = () => { tNow += 50; stepFrame(tNow); };
  eng.setScene(zoomScene(), "rebuild");
  eng.start();
  for (let i = 0; i < 27; i++) step(); // 过冷启动序曲（1.2s）

  assert.equal(eng.inspectSelection(), null, "初始无选中");
  assert.equal(notifications.length, 0, "初始不产出空通知（selectKey 初值即空键）");

  /* 银河态聚焦 → dive 先清；落地预选 kind 正确（全链可见口径）。 */
  assert.equal(eng.focusStar("z1", "z1-s"), true, "银河态聚焦恒星 → dive");
  assert.equal(eng.inspectSelection(), null, "dive 同步清空引擎选中（先清后亮）");
  fakeNow += 1400;
  step();
  assert.deepEqual(
    eng.inspectSelection(),
    { kind: "star", wsId: "z1", id: "z1-s", lifecycle: "executed" },
    "落地预选选中键 = star:<id>（kind 由实体归属推导，非 undefined）"
  );
  assert.deepEqual(notifications.at(-1), eng.inspectSelection(), "通知载荷与 inspectSelection 同形");
  assert.equal(card.attrs["data-key"], "star:z1-s", "信息卡按 entKey 解析成功（选中环/名牌/信息卡全链可见口径）");

  /* 幂等：同实体重复拾取 → 键未变不回调。 */
  const notifiedAt = notifications.length;
  fire("pointerup", { pointerId: 31, button: 0, clientX: 400, clientY: 300 });
  assert.equal(eng.inspectSelection()?.id, "z1-s", "钻取态拾取恒星（选中保持）");
  assert.equal(notifications.length, notifiedAt, "同实体重复拾取仅一次回调（幂等）");

  /* 空白命中 → 置空通知。 */
  fire("pointerup", { pointerId: 32, button: 0, clientX: 12, clientY: 588 });
  assert.equal(eng.inspectSelection(), null, "空白拾取清空引擎选中");
  assert.equal(notifications.at(-1), null, "清空位点产出 null 通知");

  /* flyOut（Esc 层）清选中并通知；飞出补间收尾不重复通知。 */
  fire("pointerup", { pointerId: 33, button: 0, clientX: 400, clientY: 300 });
  assert.equal(eng.inspectSelection()?.id, "z1-s", "再次点选恒星");
  assert.equal(eng.consumeEscape(), true, "Esc 飞出");
  assert.equal(notifications.at(-1), null, "flyOut 清选中并通知");
  const afterFlyOut = notifications.length;
  fakeNow += 1400;
  step();
  assert.equal(eng.inspectSelection(), null, "飞回收尾仍无选中");
  assert.equal(notifications.length, afterFlyOut, "飞出补间收尾不重复通知（幂等）");

  /* 场景重建摘除选中天体 → remapFocusRefs 置空并通知（单次）。 */
  eng.focusStar("z1", "z1-s");
  fakeNow += 1400;
  step();
  assert.equal(eng.inspectSelection()?.id, "z1-s", "再次聚焦落地选中");
  const beforeRemap = notifications.length;
  const noStar = zoomScene();
  noStar.workspaces[0].stars = [];
  eng.setScene(noStar, "rebuild");
  assert.equal(eng.inspectSelection(), null, "实体被场景摘除 → 选中置空");
  assert.equal(notifications.at(-1), null, "remapFocusRefs 置空产出 null 通知");
  assert.equal(notifications.length, beforeRemap + 1, "重建只通知一次");
  eng.dispose();
}

/* ── focusStar 公共面：三分派 / 降级 / 确定性落位 / 重飞（add-cosmos-selection-linkage 2.1–2.4 / D1–D2/D7–D8） ── */
{
  const starOf = (id, off, lifecycle = "created") => ({
    id, name: id, lifecycle, setBy: null, at: null, tasks: [1, 2], age: "刚刚", act: 0, off
  });
  function linkageScene(posA = [0, 0, 0], posB = [400, 0, 0]) {
    return {
      workspaces: [
        {
          id: "wa", name: "alpha", pos: posA,
          stars: [starOf("sa", [6, 0, 0]), starOf("pa", [-6, 0, 0], "proto")],
          links: [], planets: [], comets: [], archives: 0, satelliteCount: 0
        },
        {
          id: "wb", name: "beta", pos: posB,
          stars: [starOf("sb", [0, 4, 0])],
          links: [], planets: [], comets: [], archives: 0, satelliteCount: 0
        }
      ]
    };
  }
  const container = stubEl("div");
  const eng = createCosmosEngine({ container, style: createSkinD() });
  rafQ.length = 0;
  fakeNow = 300000;
  let tNow = 300000;
  const step = () => { tNow += 50; stepFrame(tNow); };
  eng.setScene(linkageScene(), "rebuild");
  eng.start();
  for (let i = 0; i < 27; i++) step();

  /* 1) 银河态 → dive 分派（1300ms / dist 155 / 落地预选，零新参数）。 */
  const dives0 = eng.inspectInput().dives;
  assert.equal(eng.focusStar("wa", "sa"), true, "银河态 focusStar 接受");
  assert.equal(eng.inspectInput().dives, dives0 + 1, "银河态 → 复用既有 dive");
  const diveTween = eng.inspectFilter().tween;
  assert.equal(diveTween.mode, "in", "dive 补间（endMode in）");
  assert.equal(diveTween.dur, 1300, "dive 时长原样");
  assert.equal(diveTween.to.dist, 155, "dive 落地距离原样");
  fakeNow += 1400;
  step();
  assert.deepEqual(eng.inspectSelection(), { kind: "star", wsId: "wa", id: "sa", lifecycle: "created" }, "落地选中目标恒星");

  /* 2) 降级路径：未知星座 / 未知恒星 / 星胚 / 缺参 → false 且不抛错、不 dive、选中不动。 */
  const dives1 = eng.inspectInput().dives;
  assert.equal(eng.focusStar("nope", "sa"), false, "未知星座 → false");
  assert.equal(eng.focusStar("wa", "nope"), false, "未知恒星 → false");
  assert.equal(eng.focusStar("wa", "pa"), false, "星胚（proto）→ false（面板不列，不聚焦）");
  assert.equal(eng.focusStar(null, "sa"), false, "缺参 → false");
  assert.equal(eng.inspectInput().dives, dives1, "降级不触发 dive");
  assert.equal(eng.inspectSelection().id, "sa", "降级不影响引擎选中（动作目标不受影响）");

  /* 3) 同星座钻取态 → 立即选中 + 短补间重对焦（确定性落位 + 显式 mix:1）。 */
  eng.zoomBy(400); // 拉远：当前视距 > 155
  assert.ok(eng.getCamera().dist > STAR_FOCUS_DIST, "拉远后视距超过 STAR_FOCUS_DIST");
  assert.equal(eng.focusStar("wa", "sa"), true, "同星座再聚焦接受");
  const refocus = eng.inspectFilter().tween;
  assert.equal(refocus.mode, null, "重对焦无 endMode（不改写钻取冷却锚点）");
  assert.equal(refocus.dur, STAR_FOCUS_DUR, "重对焦 600ms");
  assert.equal(refocus.to.mix, 1, "显式携带 mix:1（缺省会冻结半褪态或得 NaN）");
  assert.deepEqual(refocus.to.target, [6, 0, 0], "落点 = 星座确定性中心 + 恒星偏移");
  assert.equal(refocus.to.dist, STAR_FOCUS_DIST, "距离收敛 min(当前, 155) → 155");
  assert.equal(STAR_FOCUS_DIST, 155, "STAR_FOCUS_DIST 与 dive 落地距离同源");
  fakeNow += 700;
  step();
  assert.deepEqual(eng.getCamera().target, [6, 0, 0], "重对焦落定到恒星");
  assert.equal(eng.getCamera().dist, STAR_FOCUS_DIST, "重对焦落定视距收敛");

  /* 用户已拉得更近 → 保持更近距离（min 语义的另一侧）。 */
  eng.zoomBy(-400);
  const nearDist = eng.getCamera().dist;
  assert.ok(nearDist < STAR_FOCUS_DIST, "拉近后视距小于 STAR_FOCUS_DIST");
  eng.focusStar("wa", "sa");
  assert.equal(eng.inspectFilter().tween.to.dist, nearDist, "用户更近则保持更近距离（MUST NOT 反向拉远）");
  fakeNow += 700;
  step();

  /* 4) 重复点击重飞：在途补间被新请求覆盖，落点仍为确定性终态（无累积/无排队）。 */
  eng.focusStar("wa", "sa");
  fakeNow += 200;
  step(); // 在途
  eng.zoomBy(200); // 外部接管取消在途补间（拖拽/滚轮同款语义）
  assert.equal(eng.inspectFilter().tween, null, "用户接管取消在途重对焦");
  assert.equal(eng.focusStar("wa", "sa"), true, "重复点击再次聚焦（显式重飞）");
  const again = eng.inspectFilter().tween;
  assert.deepEqual(again.to.target, [6, 0, 0], "重飞落点不变（确定性终态）");
  assert.equal(again.dur, STAR_FOCUS_DUR, "重飞仍为短补间");
  fakeNow += 700;
  step();
  assert.deepEqual(eng.getCamera().target, [6, 0, 0], "重飞后仍落在恒星");

  /* 5) 跨星座钻取态 → 替换焦点（dive 同语义）。 */
  const dives2 = eng.inspectInput().dives;
  assert.equal(eng.focusStar("wb", "sb"), true, "跨星座聚焦接受");
  assert.equal(eng.inspectInput().dives, dives2 + 1, "跨星座 → dive（替换焦点）");
  assert.equal(eng.inspectFilter().focus.id, "wb", "焦点星座即时切换");
  fakeNow += 1400;
  step();
  assert.deepEqual(eng.inspectSelection(), { kind: "star", wsId: "wb", id: "sb", lifecycle: "created" }, "跨星座落地选中");
  assert.equal(eng.isDiving(), true, "钻取态成立");

  /* 6) 星座集合滑移在途 → 落点取确定性终态而非途中中点。 */
  eng.focusStar("wa", "sa"); // 回到 wa 钻取态
  fakeNow += 1400;
  step();
  eng.setScene(linkageScene([40, 12, 0]), "rebuild"); // wa 中心移动 → centerAnim 在途
  assert.ok(eng.inspectSlides().anims.includes("wa"), "星座中心滑移在途（centerAnim 已挂）");
  assert.equal(eng.focusStar("wa", "sa"), true, "滑移在途同星座聚焦接受");
  assert.deepEqual(eng.inspectFilter().tween.to.target, [46, 12, 0], "落点取终态中心 + 恒星偏移（MUST NOT 途中中点）");

  /* 7) inspectSelection 快照与销毁降级。 */
  assert.deepEqual(eng.inspectSelection(), { kind: "star", wsId: "wa", id: "sa", lifecycle: "created" }, "inspectSelection 快照（选中已立即落定）");
  eng.dispose();
  assert.equal(eng.focusStar("wa", "sa"), false, "已销毁 → false 不抛错");
  assert.equal(eng.inspectSelection(), null, "已销毁 → 快照 null");
}

/* ── focusBody 公共面：会话列表面板 → 视图（add-cosmos-session-list-panel 3.1 / design D5）：
   银河/他星座 → dive；同星座 → 立即选中 + 天体世界坐标短补间重对焦；降级 false ── */
{
  const starAt = (id, off, lifecycle = "created") => ({
    id, name: id, lifecycle, setBy: null, at: null, tasks: [1, 2], age: "刚刚", act: 0, off
  });
  const bodyScene = () => ({
    workspaces: [
      {
        id: "ba", name: "alpha", pos: [0, 0, 0],
        stars: [starAt("sa", [0, 0, 0])],
        links: [],
        planets: [{
          id: "pa", title: "pa", state: "idle", pendingKind: null, stars: ["sa"], todos: "—", when: "刚刚",
          updatedAt: 200, satellites: [], satelliteCount: 2, delegatedBusy: false
        }],
        comets: [{
          id: "ca", title: "ca", state: "busy", pendingKind: null, when: "刚刚",
          updatedAt: 100, satellites: [], satelliteCount: 0, delegatedBusy: false
        }],
        archives: 0, satelliteCount: 2
      },
      {
        id: "bb", name: "beta", pos: [400, 0, 0],
        stars: [starAt("sb", [0, 0, 0])],
        links: [], planets: [{
          id: "pb", title: "pb", state: "waiting", pendingKind: "approval", stars: ["sb"], todos: "—", when: "刚刚",
          updatedAt: 300, satellites: [], satelliteCount: 0, delegatedBusy: false
        }],
        comets: [], archives: 0, satelliteCount: 0
      }
    ]
  });
  const container = stubEl("div");
  const eng = createCosmosEngine({ container, style: createSkinD() });
  rafQ.length = 0;
  fakeNow = 500000;
  let tNow = 500000;
  const step = () => { tNow += 50; stepFrame(tNow); };
  eng.setScene(bodyScene(), "rebuild");
  eng.start();
  for (let i = 0; i < 27; i++) step();

  /* 1) 银河态 → dive 分派（与 focusStar 同机械：1300ms / dist 155 / 落地预选）。 */
  const dives0 = eng.inspectInput().dives;
  assert.equal(eng.focusBody("ba", "pa"), true, "银河态 focusBody 接受");
  assert.equal(eng.inspectInput().dives, dives0 + 1, "银河态 → 复用既有 dive");
  assert.equal(eng.inspectFilter().tween.mode, "in", "dive 补间（endMode in）");
  assert.equal(eng.inspectFilter().tween.dur, 1300, "dive 时长原样");
  fakeNow += 1400;
  step();
  assert.deepEqual(eng.inspectSelection(), { kind: "planet", wsId: "ba", id: "pa" }, "落地选中目标行星");

  /* 2) 同星座钻取态 → 立即选中 + 天体世界坐标短补间（显式 mix:1 / min 距离 / yaw-pitch 保持）。 */
  eng.zoomBy(400); // 拉远：当前视距 > 155
  assert.ok(eng.getCamera().dist > STAR_FOCUS_DIST, "拉远后视距超过 STAR_FOCUS_DIST");
  const planetWp = eng.worldPosOf("planet", "pa");
  assert.ok(Array.isArray(planetWp) && planetWp.length === 3, "行星世界坐标可查（wp 通道）");
  assert.equal(eng.focusBody("ba", "pa"), true, "同星座 focusBody 接受");
  const refocus = eng.inspectFilter().tween;
  assert.equal(refocus.mode, null, "重对焦无 endMode（不改写钻取冷却锚点）");
  assert.equal(refocus.dur, STAR_FOCUS_DUR, "重对焦 600ms（与恒星级同参数）");
  assert.equal(refocus.to.mix, 1, "显式携带 mix:1");
  assert.deepEqual(refocus.to.target, planetWp, "落点 = 天体当前世界坐标");
  assert.notDeepEqual(refocus.to.target, [0, 0, 0], "行星在轨道上——落点不是星座中心");
  assert.equal(refocus.to.dist, STAR_FOCUS_DIST, "距离收敛 min(当前, 155)");
  fakeNow += 700;
  step();
  assert.deepEqual(eng.getCamera().target, planetWp, "重对焦落定到天体");

  /* 3) 彗星行同星座：kind=comet 选中 + 游荡坐标重对焦。 */
  const cometWp = eng.worldPosOf("comet", "ca");
  assert.ok(Array.isArray(cometWp) && cometWp.length === 3, "彗星世界坐标可查");
  assert.equal(eng.focusBody("ba", "ca"), true, "彗星行同星座接受");
  assert.deepEqual(eng.inspectSelection(), { kind: "comet", wsId: "ba", id: "ca" }, "立即选中彗星（kind=comet）");
  assert.deepEqual(eng.inspectFilter().tween.to.target, cometWp, "彗星落点 = 游荡方程当前坐标");

  /* 4) 跨星座钻取态 → 替换焦点（dive 同语义）。 */
  const dives1 = eng.inspectInput().dives;
  assert.equal(eng.focusBody("bb", "pb"), true, "跨星座 focusBody 接受");
  assert.equal(eng.inspectInput().dives, dives1 + 1, "跨星座 → dive（替换焦点）");
  assert.equal(eng.inspectFilter().focus.id, "bb", "焦点星座即时切换");
  fakeNow += 1400;
  step();
  assert.deepEqual(eng.inspectSelection(), { kind: "planet", wsId: "bb", id: "pb" }, "跨星座落地选中");

  /* 5) 降级：未知星座/未知会话/他星座 id 越权/缺参 → false，不触发 dive。 */
  const dives2 = eng.inspectInput().dives;
  assert.equal(eng.focusBody("nope", "pa"), false, "未知星座 → false");
  assert.equal(eng.focusBody("ba", "nope"), false, "未知会话 → false");
  assert.equal(eng.focusBody("ba", "sb"), false, "他星座会话 id 不越权匹配");
  assert.equal(eng.focusBody(null, "pa"), false, "缺参 → false");
  assert.equal(eng.focusBody("ba"), false, "缺会话 id → false");
  assert.equal(eng.inspectInput().dives, dives2, "降级不触发 dive");
  eng.dispose();
  assert.equal(eng.focusBody("ba", "pa"), false, "已销毁 → false 不抛错");
}

/* ── 钻取态画布点选（D9）：恒星顺带重对焦；行星只选中不动镜头 ── */
{
  function pickScene() {
    return {
      workspaces: [{
        id: "z9", name: "pick", pos: [0, 0, 0],
        stars: [{ id: "z9-s", name: "s", lifecycle: "executed", setBy: null, at: null, tasks: [1, 1], age: "刚刚", act: 0, off: [0, 0, 0] }],
        links: [],
        planets: [{ id: "z9-p", title: "p", state: "idle", pendingKind: null, stars: ["z9-s"], todos: "—", when: "刚刚", satellites: [], satelliteCount: 0, delegatedBusy: false }],
        comets: [], archives: 0, satelliteCount: 0
      }]
    };
  }
  const container = stubEl("div");
  const eng = createCosmosEngine({ container, style: createSkinD() });
  const root = container.children[0];
  const canvas = root._by[".cos-canvas"];
  const fire = (type, ev) => {
    for (const fn of root.listeners[type] ?? []) fn({ preventDefault() {}, target: canvas, ...ev });
  };
  rafQ.length = 0;
  fakeNow = 400000;
  let tNow = 400000;
  const step = () => { tNow += 50; stepFrame(tNow); };
  eng.setScene(pickScene(), "rebuild");
  eng.start();
  for (let i = 0; i < 27; i++) step();
  eng.diveToWs("z9");
  fakeNow += 1400;
  step();
  assert.equal(eng.isDiving(), true, "钻取态成立");

  /* 恒星 off=0 → 屏心命中：点选即选中 + 同款短补间重对焦。 */
  fire("pointerup", { pointerId: 41, button: 0, clientX: 400, clientY: 300 });
  assert.deepEqual(eng.inspectSelection(), { kind: "star", wsId: "z9", id: "z9-s", lifecycle: "executed" }, "点选恒星立即选中");
  const refocused = eng.inspectFilter().tween;
  assert.equal(refocused.dur, STAR_FOCUS_DUR, "点选恒星顺带重对焦（600ms，与面板同机械同参数）");
  assert.equal(refocused.to.mix, 1, "重对焦补间携带 mix:1");
  assert.deepEqual(refocused.to.target, [0, 0, 0], "重对焦落点 = 星座中心 + 恒星偏移");

  /* 行星命中：只选中，不新建镜头补间（D9 仅恒星）。 */
  let planetHit = null;
  for (let gx = 300; gx <= 500 && !planetHit; gx += 6) {
    for (let gy = 200; gy <= 400 && !planetHit; gy += 6) {
      const before = JSON.stringify(eng.inspectFilter().tween);
      fire("pointerup", { pointerId: 42, button: 0, clientX: gx, clientY: gy });
      const sel = eng.inspectSelection();
      if (sel && sel.kind === "planet") {
        planetHit = { x: gx, y: gy };
        assert.equal(JSON.stringify(eng.inspectFilter().tween), before, "行星命中不动镜头（MUST NOT 重对焦）");
      }
    }
  }
  assert.ok(planetHit, "找到可拾取行星的屏幕点（拾取面自检）");
  assert.equal(eng.inspectInput().dives, 1, "钻取态拾取不触发新 dive");
  eng.dispose();
}

/* ── 会话打开快捷键（add-cosmos-session-open-hotkey D1–D4）：空格对**当前选中**的
      行星/彗星触发与信息卡「打开会话」按钮同一回调链（`onOpenSession(会话 id)`）；
      六道守卫按序早退（repeat / isComposing / 可编辑聚焦 / 面板 chrome 聚焦 / 按钮类
      聚焦 / 非会话选中 no-op），组合键豁免沿用 WASD 层第一道守卫。 ── */
{
  assert.equal(SESSION_OPEN_KEY, "Space", "键位常量 = 空格（ev.code 语义，v1 固定）");
  function hotkeyScene() {
    return {
      workspaces: [{
        id: "hk", name: "hotkey", pos: [0, 0, 0],
        stars: [{ id: "hk-s", name: "s", lifecycle: "executed", setBy: null, at: null, tasks: [1, 1], age: "刚刚", act: 0, off: [0, 0, 0] }],
        links: [],
        planets: [{ id: "hk-p", title: "p", state: "idle", pendingKind: null, stars: ["hk-s"], todos: "—", when: "刚刚", satellites: [], satelliteCount: 0, delegatedBusy: false }],
        /* 彗星挂一颗卫星：卫星无拾取项（选中模型无 sat kind）→ 白名单天然覆盖该场景 */
        comets: [{ id: "hk-c", title: "c", state: "idle", pendingKind: null, when: "刚刚", satellites: [{ id: "hk-sat", title: "sat", state: "idle" }], satelliteCount: 1, delegatedBusy: false }],
        archives: 0, satelliteCount: 1
      }]
    };
  }
  const before = windowListeners.keydown.length;
  const opened = [];
  const archiveCalls = [];
  const container = stubEl("div");
  const eng = createCosmosEngine({
    container, style: createSkinD(),
    onOpenSession: (id) => opened.push(id),
    /* 永挂 promise：让 per-session 在途门（archiveInFlight）长期在册（3.4 断言用） */
    onArchiveSession: (id) => { archiveCalls.push(id); return new Promise(() => {}); }
  });
  const root = container.children[0];
  const canvas = root._by[".cos-canvas"];
  const card = root._by[".cos-card"];
  const handlers = windowListeners.keydown.slice(before);
  const keyupHandlers = windowListeners.keyup.slice(before);
  assert.equal(handlers.length, 1, "快捷键复用既有 window keydown handler（不新开监听面）");
  const fire = (type, ev) => {
    for (const fn of root.listeners[type] ?? []) fn({ preventDefault() {}, target: canvas, ...ev });
  };
  const pressSpace = (opts) => {
    let prevented = false;
    const ev = {
      code: SESSION_OPEN_KEY, ctrlKey: false, metaKey: false, altKey: false,
      isComposing: false, repeat: false,
      preventDefault() { prevented = true; },
      ...(opts ?? {})
    };
    for (const fn of handlers) fn(ev);
    return prevented;
  };
  /* 拾取面自检（与 D9 行星拾取同款）：钻取态扫屏点直到命中目标 kind；先 6px 网格，
     未命中再 3px 网格精扫（拾取有效半径 ≥14px，6px 网格理论必中，3px 兜不测相位）。 */
  const findPickOf = (kind) => {
    for (const gap of [6, 3]) {
      for (let gy = gap / 2; gy <= 600; gy += gap) {
        for (let gx = gap / 2; gx <= 800; gx += gap) {
          fire("pointerup", { pointerId: 81, button: 0, clientX: gx, clientY: gy });
          const sel = eng.inspectSelection();
          if (sel && sel.kind === kind) return sel;
        }
      }
    }
    return null;
  };
  rafQ.length = 0;
  fakeNow = 600000;
  let tNow = 600000;
  const step = () => { tNow += 50; stepFrame(tNow); };
  eng.setScene(hotkeyScene(), "rebuild");
  eng.start();
  for (let i = 0; i < 27; i++) step(); // 过冷启动序曲（1.2s）
  assert.equal(eng.diveToWs("hk"), true, "钻取到快捷键场景");
  fakeNow += 1400;
  step();
  assert.equal(eng.isDiving(), true, "钻取态成立（选中态只产生于钻取/拾取链）");

  /* ① 无选中 → 静默 no-op（不消费、不调用、无提示面） */
  assert.equal(eng.inspectSelection(), null, "钻取落地无预选");
  assert.equal(pressSpace(), false, "无选中 → 不 preventDefault（静默 no-op）");
  assert.deepEqual(opened, [], "无选中 → 不打开会话");

  /* ② 恒星（提案非会话）选中 → 静默 no-op */
  assert.ok(findPickOf("star"), "找到恒星拾取屏点（拾取面自检）");
  assert.equal(eng.inspectSelection().kind, "star", "选中 = 恒星");
  assert.equal(pressSpace(), false, "恒星选中 → 不 preventDefault");
  assert.deepEqual(opened, [], "恒星（提案）无「打开会话」语义");

  /* ③ 行星选中 → 授权位点：守卫全过才 preventDefault + 触发一次 */
  const planetSel = findPickOf("planet");
  assert.ok(planetSel, "找到行星拾取屏点（拾取面自检）");
  assert.equal(planetSel.id, "hk-p", "行星 id 即会话 id");
  assert.deepEqual(opened, [], "扫屏点只改选中，不触发打开会话");

  /* ④ 守卫聚合：任一命中 → 不消费、不触发 */
  assert.equal(pressSpace({ repeat: true }), false, "repeat → 不消费（按住不连发）");
  assert.equal(pressSpace({ isComposing: true }), false, "isComposing → 不触发（输入法组合中）");
  globalThis.document.activeElement = { tagName: "INPUT", isContentEditable: false };
  assert.equal(pressSpace(), false, "可编辑聚焦 → 不消费（空格是字符，字符进输入框）");
  globalThis.document.activeElement = null;
  const chromeEl = { tagName: "DIV", isContentEditable: false };
  chromeEl.closest = (sel) => (String(sel).includes(".dsh-cosmos-panel") ? { tagName: "DIV" } : null);
  globalThis.document.activeElement = chromeEl;
  assert.equal(pressSpace(), false, "面板/动作条/会话面板 chrome 聚焦 → 不触发（与 WASD 层同款纪律）");
  globalThis.document.activeElement = null;
  const btnEl = { tagName: "BUTTON", isContentEditable: false };
  btnEl.closest = (sel) => (sel === "button,[role='button'],a" ? { tagName: "BUTTON" } : null);
  globalThis.document.activeElement = btnEl;
  assert.equal(pressSpace(), false, "按钮类聚焦 → 不消费（保留原生激活，MUST NOT 双触发）");
  globalThis.document.activeElement = null;
  assert.equal(pressSpace({ ctrlKey: true }), false, "Ctrl+Space 组合键 → 不消费");
  assert.equal(pressSpace({ metaKey: true }), false, "Meta+Space 组合键 → 不消费");
  assert.equal(pressSpace({ altKey: true }), false, "Alt+Space 组合键 → 不消费");
  assert.deepEqual(opened, [], "六道守卫全命中 → 零调用");

  /* ⑤ 守卫全过 → preventDefault + 触发一次（与按钮同一回调链） */
  assert.equal(pressSpace(), true, "守卫全过 → preventDefault（抑制宿主页面滚动）");
  assert.deepEqual(opened, ["hk-p"], "空格对选中行星触发一次 onOpenSession（会话 id）");

  /* ⑥ 彗星（自由会话）同语义 */
  const cometSel = findPickOf("comet");
  assert.ok(cometSel, "找到彗星拾取屏点（拾取面自检）");
  assert.equal(cometSel.id, "hk-c", "彗星 id 即会话 id");
  opened.length = 0;
  assert.equal(pressSpace(), true, "彗星选中 → 空格消费");
  assert.deepEqual(opened, ["hk-c"], "彗星与行星同语义（同一 onOpenSession 回调链）");

  /* ⑦ 归档在途门不拦 open（与按钮点击同口径） */
  const archiveBtn = {
    disabled: false,
    classList: { contains: (cls) => cls === "cd-btn" },
    getAttribute: (k) => (k === "data-action" ? "archive" : k === "data-session" ? cometSel.id : null)
  };
  for (const fn of card.listeners.click ?? []) fn({ target: archiveBtn });
  assert.deepEqual(archiveCalls, [cometSel.id], "归档点击进入在途态（promise 未 settle）");
  opened.length = 0;
  assert.equal(pressSpace(), true, "归档在途 → 空格仍消费");
  assert.deepEqual(opened, [cometSel.id], "archiveInFlight 在册不拦打开会话（open 不参与归档防重入）");

  /* ⑧ 呈现层标注（2.1）/ 拾取面白名单（卫星不可选中）/ 既有键位零侵入（3.3） */
  const engineSource = readFileSync(new URL("../src/cosmos/engine.mjs", import.meta.url), "utf8");
  const actionsAt = engineSource.indexOf("function cardActionsHtml(sessionId, lead)");
  const actionsEnd = engineSource.indexOf("function cardHtml(e)");
  assert.ok(actionsAt > 0 && actionsEnd > actionsAt, "cardActionsHtml 切片可定位");
  const actionsBody = engineSource.slice(actionsAt, actionsEnd);
  const openAt = actionsBody.indexOf('data-action="open"');
  const ariaAt = actionsBody.indexOf('aria-keyshortcuts="Space"');
  const titleAt = actionsBody.indexOf('title="打开会话（空格）"');
  assert.ok(openAt >= 0 && ariaAt > openAt, "打开按钮标注 aria-keyshortcuts=Space");
  assert.ok(titleAt > openAt, "打开按钮带快捷键 title 提示");
  assert.equal((actionsBody.match(/aria-keyshortcuts/g) ?? []).length, 1, "仅打开按钮标注（归档按钮无快捷键）");
  assert.ok(actionsBody.includes(">打开会话<"), "按钮文案不变（aria/title 仅为属性增量）");
  const pickKinds = [...engineSource.matchAll(/picks\.push\([^)]*kind:\s*'(\w+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(pickKinds, ["comet", "planet", "star"], "拾取面仅 star/planet/comet（无卫星选中态 → 白名单天然覆盖卫星场景）");
  let wPrevented = false;
  for (const fn of handlers) {
    fn({ code: "KeyW", ctrlKey: false, metaKey: false, altKey: false, isComposing: false, preventDefault() { wPrevented = true; } });
  }
  assert.equal(wPrevented, true, "WASD 平移层零变化（同一 handler 加分支不侵入既有键位语义）");
  for (const fn of keyupHandlers) fn({ code: "KeyW" }); // 释放平移键
  globalThis.document.activeElement = null;
  eng.dispose();
}

/* ── 关联聚焦 / 恒星活力两态 / 决策按钮（cosmos-relation-focus + cosmos-session-decide） ──
   覆盖：聚焦集纯派生（星 / 行星 / 彗星 / 无关联星胚）、relMix 0.2s 坡道与离场渐熄、
   hover 优先与选中粘性、共享会话段点亮、活力状态行 + 名牌标识 + act 翻转 sig、
   决策按钮注入/文案映射/分流/未注入静默/归档在途不拦/非待决策与彗星不注入。 */
{
  /** 关联聚焦夹具：两恒星（links 相连）+ 联星待决策行星 + 待决策彗星 + 无关联星胚。 */
  const relScene = (overrides = {}) => ({
    workspaces: [{
      id: "rel1", name: "rel-one", pos: [0, 0, 0],
      stars: [
        { id: "ra", name: "ra", lifecycle: "created", setBy: null, at: null, tasks: [1, 2], age: "刚刚", act: overrides.raAct ?? 1, off: [-14, 0, 0] },
        { id: "rb", name: "rb", lifecycle: "executed", setBy: null, at: null, tasks: [2, 2], age: "刚刚", act: 0, off: [14, 0, 0] },
        { id: "rproto", name: "rproto", lifecycle: "proto", setBy: null, at: null, tasks: [0, 0], age: "刚刚", act: 0, off: [0, 30, 0] }
      ],
      links: [[0, 1]],
      planets: [{
        id: "rbin", title: "bin", state: overrides.binState ?? "waiting", pendingKind: overrides.binKind ?? "approval",
        stars: ["ra", "rb"], todos: "1/2", when: "刚刚", satellites: [], satelliteCount: 0, delegatedBusy: false
      }],
      comets: [{
        id: "rc", title: "comet", state: "waiting", pendingKind: "question",
        when: "刚刚", satellites: [], satelliteCount: 0, delegatedBusy: false
      }],
      archives: 0, satelliteCount: 0
    }]
  });

  const container = stubEl("div");
  const opened = [], decided = [];
  const eng = createCosmosEngine({
    container,
    style: createSkinD(),
    onOpenSession: (id) => opened.push(id),
    onArchiveSession: () => new Promise(() => {}), // 永不 settle：保持归档在途窗口
    onDecideSession: (id) => decided.push(id)
  });
  const rootEl = container.children[0];
  const canvasEl = rootEl._by[".cos-canvas"];
  const cardEl = rootEl._by[".cos-card"];
  const overlayEl = rootEl._by[".cos-overlay"];
  const fire = (el, type, ev) => { for (const fn of el.listeners[type] ?? []) fn(ev); };
  eng.setScene(relScene(), "rebuild");
  rafQ.length = 0;
  eng.start();
  let tNow = 30000;
  const step1 = (n = 1) => { for (let i = 0; i < n; i++) { tNow += 50; stepFrame(tNow); } };
  step1(27); // 过冷启动序曲

  /** 世界坐标 → 屏幕点（与引擎 project 同式：默认 fov 60 / 视口 800×600 桩）。 */
  const screenOf = (world) => {
    const cam = eng.inspectFilter().camera;
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
  const starWp = (id) => eng.inspectEntities("rel1").stars.find((s) => s.id === id).wp;
  const hoverScreen = (world) => {
    const p = screenOf(world);
    fire(rootEl, "pointermove", { pointerId: 1, clientX: p.x, clientY: p.y, buttons: 0, target: canvasEl });
    step1(3); // 第 1 帧写入 E.hovered，第 2 帧起坡道键控，第 3 帧 rel 集落条目数据
  };
  const hoverStar = (id) => hoverScreen(starWp(id));

  /* ① 恒星聚焦：关联行星轨道环 + 关系段 + 该星端点共享会话段，0.2s 坡道淡入 */
  hoverStar("ra");
  let rel = eng.inspectRelation();
  assert.equal(rel.focusKey, "rel1|star:ra", "聚焦源 = hover 恒星（hovered ?? selected）");
  assert.deepEqual(rel.last.orbits.map((o) => o.planetId), ["rbin"], "关联行星轨道环进入 rel 集");
  assert.equal(rel.last.segs.length, 1, "一条恒星→行星关系段");
  assert.deepEqual([rel.last.segs[0].starId, rel.last.segs[0].planetId], ["ra", "rbin"], "关系段端点=聚焦恒星与关联行星");
  assert.deepEqual(rel.last.links.map((l) => [l.aId, l.bId]), [["ra", "rb"]], "该星端点的共享会话虚线点亮");
  let entry = rel.mix.find((m) => m.key === "rel1|star:ra");
  assert.ok(entry && entry.dir === "in", "新聚焦键 in 坡道");
  assert.ok(entry.alpha > 0 && entry.alpha < 1, "0.2s 窗口内处于淡入中（MUST NOT 瞬间跳变）");
  const htmlActive = String(cardEl.innerHTML);
  assert.ok(htmlActive.includes("活力") && htmlActive.includes("活跃"), "恒星卡呈现「活力：活跃」（act≥1）");
  step1(4); // 累计 > 0.2s
  entry = eng.inspectRelation().mix.find((m) => m.key === "rel1|star:ra");
  assert.equal(entry.alpha, 1, "坡道到满（0.2s）");

  /* ② act 翻转：星卡 sig 纳入 act → 活力行即时刷新为沉睡（MUST NOT 滞留旧态） */
  eng.setScene(relScene({ raAct: 0 }), "patch");
  step1(2);
  assert.ok(String(cardEl.innerHTML).includes("沉睡"), "act 1→0 → 星卡重渲染为「沉睡」（sig 含 act）");
  assert.ok(!String(cardEl.innerHTML).includes(">活跃<"), "旧态文案不残存");

  /* ③ 行星聚焦：自身轨道环 + 联星双关系段；旧恒星聚焦集转 out 渐熄（交叉淡变） */
  hoverScreen(eng.worldPosOf("planet", "rbin"));
  rel = eng.inspectRelation();
  assert.equal(rel.focusKey, "rel1|planet:rbin", "聚焦源切换为行星");
  assert.ok(rel.mix.some((m) => m.key === "rel1|star:ra" && m.dir === "out"), "旧聚焦键转 out 渐熄");
  assert.deepEqual(rel.last.orbits.map((o) => o.planetId), ["rbin"], "行星自身轨道环 rel");
  step1(3); // 旧集渐熄播完（0.2s）
  rel = eng.inspectRelation();
  assert.equal(rel.last.segs.length, 2, "联星行星 → 连到全部关联星的两条关系段");
  assert.equal(rel.last.links.length, 0, "行星聚焦不点亮共享会话段（spec 只要求恒星端点）");

  /* ④ 决策按钮：waiting 行星注入 → 文案/顺序/钩子；点击分流 onDecideSession */
  const htmlBin = String(cardEl.innerHTML);
  assert.ok(htmlBin.includes('data-action="decide"'), "待决策行星卡注入决策按钮");
  assert.ok(htmlBin.includes('data-action="decide" data-session="rbin"'), "决策按钮带 data-session 稳定钩子");
  assert.ok(htmlBin.includes(">待批准<"), "pendingKind=approval → 文案「待批准」");
  assert.ok(htmlBin.indexOf('data-action="open"') < htmlBin.indexOf('data-action="decide"'), "决策按钮在「打开会话」之后");
  assert.ok(htmlBin.indexOf('data-action="decide"') < htmlBin.indexOf('data-action="archive"'), "决策按钮在「归档会话」之前");
  const decideBtn = {
    classList: { contains: (cls) => cls === "cd-btn" },
    getAttribute: (k) => (k === "data-action" ? "decide" : k === "data-session" ? "rbin" : null)
  };
  for (const fn of cardEl.listeners.click ?? []) fn({ target: decideBtn });
  assert.deepEqual(decided, ["rbin"], "决策点击 → onDecideSession（会话 id）");
  assert.deepEqual(opened, [], "决策点击不误走 open 分支");

  /* ⑤ 归档在途不拦决策（打开类动作同口径）；sig 不变 → 按钮 DOM 不逐帧重建 */
  const archiveBtn = {
    classList: { contains: (cls) => cls === "cd-btn" },
    getAttribute: (k) => (k === "data-action" ? "archive" : k === "data-session" ? "rbin" : null)
  };
  for (const fn of cardEl.listeners.click ?? []) fn({ target: archiveBtn });
  for (const fn of cardEl.listeners.click ?? []) fn({ target: decideBtn });
  assert.deepEqual(decided, ["rbin", "rbin"], "归档在途时决策点击照常派发（不拦截）");
  const keep = String(cardEl.innerHTML);
  cardEl.innerHTML = "__keep__";
  step1(3);
  assert.equal(cardEl.innerHTML, "__keep__", "sig 不变 → 信息卡不逐帧重建（点击可派发）");
  cardEl.innerHTML = keep;

  /* ⑥ 文案映射：未知 kind 回退「待决策」；非待决策行星不注入 */
  eng.setScene(relScene({ binKind: "mystery" }), "patch");
  step1(2);
  assert.ok(String(cardEl.innerHTML).includes(">待决策<"), "未知 pendingKind → 回退「待决策」");
  eng.setScene(relScene({ binState: "busy", binKind: null }), "patch");
  step1(2);
  assert.ok(!String(cardEl.innerHTML).includes('data-action="decide"'), "非待决策行星 MUST NOT 呈现决策按钮");

  /* ⑦ 彗星：等待中也不注入决策按钮；聚焦集空（无关系线，旧集渐熄后归零） */
  hoverScreen(eng.worldPosOf("comet", "rc"));
  rel = eng.inspectRelation();
  assert.equal(rel.focusKey, "rel1|comet:rc", "聚焦源切换为彗星");
  step1(3); // 旧行星关系段渐熄播完
  rel = eng.inspectRelation();
  assert.equal(rel.last.segs.length, 0, "彗星聚焦集空 → 不呈现关系线");
  assert.equal(rel.last.orbits.length, 0, "彗星无轨道 rel");
  const htmlComet = String(cardEl.innerHTML);
  assert.ok(htmlComet.includes("打开会话") && htmlComet.includes("归档会话"), "彗星卡保持两按钮");
  assert.ok(!htmlComet.includes('data-action="decide"'), "彗星卡 MUST NOT 注入决策按钮（v1 行星限定）");

  /* ⑧ 无关联恒星（星胚）：聚焦集空 + 豁免活力状态行/名牌标识 */
  hoverStar("rproto");
  rel = eng.inspectRelation();
  assert.equal(rel.focusKey, "rel1|star:rproto", "星胚可拾取并成为聚焦源");
  assert.equal(rel.last.segs.length, 0, "无关联行星 → 不呈现关系线");
  assert.equal(rel.last.orbits.length, 0, "无关联行星 → 无环增亮");
  const htmlProto = String(cardEl.innerHTML);
  assert.ok(htmlProto.includes("待创建"), "星胚卡呈现生命周期「待创建」");
  assert.ok(!htmlProto.includes("活力"), "星胚豁免活力状态行");

  /* ⑨ 钻取态：选中粘性 + hover 优先 + 指针离场回落选中 */
  assert.equal(eng.diveToWs("rel1"), true, "钻取目标星座");
  fakeNow += 1300;
  step1(1);
  assert.equal(eng.focusBody("rel1", "rbin"), true, "同星座行星聚焦 → 选中");
  step1(2);
  assert.deepEqual(eng.inspectSelection(), { kind: "planet", wsId: "rel1", id: "rbin" }, "行星选中落定");
  assert.equal(eng.inspectRelation().focusKey, "rel1|planet:rbin", "无 hover → 聚焦源回落选中行星");
  hoverStar("ra");
  assert.equal(eng.inspectRelation().focusKey, "rel1|star:ra", "hover 优先：选中存在时聚焦集即时切换");
  assert.deepEqual(eng.inspectSelection(), { kind: "planet", wsId: "rel1", id: "rbin" }, "选中态保持（金色环不受影响）");
  fire(rootEl, "pointerleave", {});
  step1(3);
  assert.equal(eng.inspectRelation().focusKey, "rel1|planet:rbin", "指针离场 → 聚焦源回落选中");
  assert.equal(eng.consumeEscape(), true, "Esc 清空选中并飞回银河");
  fakeNow += 1300;
  step1(2);
  assert.equal(eng.inspectRelation().focusKey, "", "清空选中 + 指针离场 → 聚焦源置空");
  step1(6); // > 0.2s 渐熄
  assert.deepEqual(eng.inspectRelation().mix, [], "渐熄播完 → relMix 条目摘除（回落常态）");

  /* ⑩ 名牌活力标识：钻取态恒星名牌含琥珀/灰点文案，星胚不呈现 */
  eng.setScene(relScene(), "patch");
  step1(2);
  assert.equal(eng.diveToWs("rel1"), true, "再次钻取");
  fakeNow += 1300;
  step1(2);
  const slabOf = (id) => overlayEl.children.find((el) => el.className === "cos-slab" && el.dataset.star === id);
  const slabRa = slabOf("ra"), slabProto = slabOf("rproto");
  assert.ok(slabRa && String(slabRa.dataset.html).includes("cos-slab-life active") && String(slabRa.dataset.html).includes("活跃"),
    "active 恒星名牌：琥珀点 + 「活跃」");
  assert.ok(slabProto && !String(slabProto.dataset.html).includes("cos-slab-life"), "星胚名牌不呈现活力标识");
  const slabRb = slabOf("rb");
  assert.ok(slabRb && String(slabRb.dataset.html).includes("cos-slab-life sleep"), "沉睡恒星名牌：灰点 + 「沉睡」");

  assert.equal(eng.inspectRelation().focusKey, "", "收尾：无 hover/选中");
  eng.stop();
  eng.dispose();

  /* ⑪ onDecideSession 未注入 → 决策点击静默 no-op（不抛错、无视觉副作用） */
  const bare = stubEl("div");
  const bareEng = createCosmosEngine({ container: bare, style: createSkinD() });
  const bareCard = bare.children[0]._by[".cos-card"];
  assert.doesNotThrow(() => {
    for (const fn of bareCard.listeners.click ?? []) fn({ target: decideBtn });
  }, "回调未注入 → 静默 no-op（同 onOpenSession 守卫）");
  bareEng.dispose();
}

/* ── 浮签引线与避让间距（polish-cosmos-tip-leader-line 1.1–1.3 / 2.1–2.3） ──
   覆盖：避让常量下限与集中化（1.1）、引线几何纯函数（翻转/钳制/退化）、端点同源
   （D3 唯一硬红线：DOM transform 串与引线端点 = 字面同一组数）、显隐同源（α / .on
   谓词）、取色通道（palette.accent → 热切换随动）、卫星无引线、引线不参与拾取。 */

/* A. 常量 / 几何 / 取色（纯函数级，无 DOM） */
{
  /* 常量块：spec 锁下限，实现集中定义便于真机校准 */
  assert.ok(TIP_GAP.chip >= 40, "星座 chip 避让间距 ≥40（spec 下限）");
  assert.ok(TIP_GAP.slab >= 28, "恒星名牌避让间距 ≥28（spec 下限）");
  assert.ok(TIP_GAP.card >= 40, "信息卡避让间距（星缘起算）≥40（spec 下限）");
  assert.ok(Object.isFrozen(TIP_GAP) && Object.isFrozen(TIP_LINE), "避让/引线常量为冻结常量块（单点校准入口）");
  assert.ok(TIP_LINE.alphaMax > 0 && TIP_LINE.alphaMax <= 0.5, "引线 α 上限 ≤0.5（弱于浮签本体）");
  assert.ok(TIP_LINE.tail > 0 && TIP_LINE.tail < TIP_GAP.card, "水平段最短长度 < 避让间距（45° 斜出段有横向余量）");
  assert.ok(TIP_LINE.tick > 0 && TIP_LINE.cardFallbackH > 0 && TIP_LINE.cardFallbackW > 0, "起笔短横与卡盒兜底为正");
  assert.ok(TIP_GAP.chip > 40 && TIP_GAP.card > 40, "用户回访：三族间距整体抬高（严格大于 spec 下限）");

  /* chip：竖直单段 + 起笔短横 */
  const chipLine = tipLeaderOf({ kind: "chip", hx: 300, hy: 200, x: 300, y: 156 });
  assert.equal(chipLine.pts.length, 2, "chip 引线 = 单段竖直线");
  assert.deepEqual(chipLine.pts[0], { x: 300, y: 200 }, "chip 起笔 = 星座投影中心");
  assert.deepEqual(chipLine.pts[1], { x: 300, y: 156 }, "chip 止点 = chip 底缘");
  assert.equal(chipLine.pts[0].x, chipLine.pts[1].x, "chip 引线竖直（x 不变）");
  assert.deepEqual(
    chipLine.tick,
    { x: 300 - TIP_LINE.tick, y: 200, x2: 300 + TIP_LINE.tick, y2: 200 },
    "起笔端短横 = 锚点处 2×tick 横线（锚点标记）"
  );

  /* slab：同形竖直线，但起笔在星缘、止于名牌顶缘 */
  const slabLineGeo = tipLeaderOf({ kind: "slab", hx: 420, hy: 310, x: 420, y: 344 });
  assert.equal(slabLineGeo.pts.length, 2, "名牌引线 = 单段竖直线");
  assert.equal(slabLineGeo.pts[0].y, 310, "名牌引线起笔 = 星缘下缘点");
  assert.equal(slabLineGeo.pts[1].y, 344, "名牌引线止点 = 名牌顶缘");
  assert.ok(slabLineGeo.tick, "名牌引线带起笔短横");

  /* card：两段折线（45° 斜出 + 水平），无 tick */
  const cardRight = tipLeaderOf({ kind: "card", hx: 520, hy: 300, x: 600, y: 330 });
  assert.equal(cardRight.pts.length, 3, "信息卡引线 = 两段折线");
  assert.deepEqual(cardRight.pts[0], { x: 520, y: 300 }, "折线起笔 = 星缘侧点（高度对齐星心）");
  assert.equal(cardRight.pts[1].x, 520 + 30, "45° 斜出段：横向跨距 = 纵向落差（dy=30）");
  assert.equal(cardRight.pts[1].y, 330, "斜出段 y 收到卡近缘中点高度");
  assert.equal(
    Math.abs(cardRight.pts[1].x - cardRight.pts[0].x),
    Math.abs(cardRight.pts[1].y - cardRight.pts[0].y),
    "斜出段为 45°（|dx| === |dy|）"
  );
  assert.equal(cardRight.pts[2].y, cardRight.pts[1].y, "水平段保持水平");
  assert.equal(cardRight.pts[2].x, 600, "水平段止于卡近缘");
  assert.ok(cardRight.pts[2].x - cardRight.pts[1].x >= TIP_LINE.tail - 1e-9, "水平段不短于 TIP_LINE.tail");
  assert.equal(cardRight.tick, null, "折线无起笔 tick（线头方向已由折点表达）");
  /* 翻转镜像：卡在星左侧 → 折线与水平段整体向左（同样 45°） */
  const cardFlip = tipLeaderOf({ kind: "card", hx: 280, hy: 300, x: 200, y: 330 });
  assert.equal(cardFlip.pts[1].x, 280 - 30, "翻转侧：45° 斜出段向左");
  assert.ok(cardFlip.pts[2].x < cardFlip.pts[1].x, "翻转侧：水平段向左止于卡近缘");
  /* 纵向钳制：dy 超过「间距 − tail」→ 斜出段横向跨度封顶（更陡），水平段仍水平且不短于 tail */
  const cardClamp = tipLeaderOf({ kind: "card", hx: 520, hy: 80, x: 600, y: 200 });
  assert.equal(cardClamp.pts[1].y, 200, "钳制侧：斜出段 y 收到（钳后）卡中点");
  assert.equal(cardClamp.pts[1].x - cardClamp.pts[0].x, 80 - TIP_LINE.tail, "钳制侧：横向跨度封顶 = 间距 − tail");
  assert.equal(cardClamp.pts[2].y, cardClamp.pts[1].y, "钳制侧：水平段不受 dy 影响");
  /* 退化与防御：dy≈0 → 纯水平；间距 ≤ tail → 直连；非法坐标 → null（不画） */
  assert.equal(tipLeaderOf({ kind: "card", hx: 300, hy: 200, x: 380, y: 200 }).pts.length, 2, "dy≈0 → 纯水平线（无折点）");
  assert.equal(tipLeaderOf({ kind: "card", hx: 300, hy: 200, x: 308, y: 260 }).pts.length, 2, "间距 ≤ tail → 退化直连（无反向折点）");
  assert.equal(tipLeaderOf(null), null, "空入参 → null");
  assert.equal(tipLeaderOf({ kind: "chip", hx: NaN, hy: 0, x: 0, y: 1 }), null, "非有限坐标 → null");

  /* 取色通道（D5）：12 套皮肤 accent 自注册规格单点派生，引线取色与之逐肤一致 */
  for (const entry of COSMOS_SKINS) {
    assert.equal(entry.instance.palette.accent, entry.base.accent, entry.id + "：palette.accent = 注册规格 base.accent（单点派生）");
    assert.equal(tipLineColorOf(entry.instance), entry.base.accent, entry.id + "：引线取色 = 该皮肤 accent");
  }
  assert.equal(tipLineColorOf({ palette: { accent: "#123456" }, gold: "#ffffff" }), "#123456", "accent 优先于 gold");
  assert.equal(tipLineColorOf({ palette: {}, gold: "#0f0f0f" }), "#0f0f0f", "缺 accent → 回落 gold（直接构造的皮肤实例）");
  assert.equal(tipLineColorOf({ palette: { prop: { executed: "#abcdef" } } }), "#abcdef", "缺 accent/gold → 回落执行态色板色");
  assert.equal(tipLineColorOf(null), "#ffffff", "无皮肤色板 → 中性白（MUST NOT 硬编码金色字面量）");
  assert.equal(tipLineColorOf({ palette: { accent: "not-a-hex" }, gold: 7 }), "#ffffff", "非法取色 → 中性白");
}

/* B. 引擎集成：端点同源 / 避让间距 / 显隐同源 / 配色随动 / 拾取隔离 */
{
  const ctxRec = recordingCtx();
  ctxFactory = () => ctxRec;
  const rec = ctxRec.__rec;
  const resetRec = () => { rec.strokes.length = 0; };
  /* 桩皮肤：drawBody/background 零描边 → 本帧 stroke() 只可能来自引线描线 */
  const stubStyle = (accent) => ({
    skin: "stub-leader", useBand: false,
    palette: {
      prop: { proto: "#8a9bc0", created: "#9fd8ff", reviewed: "#cfe8ff", executed: "#ffe27a" },
      sess: { idle: "#a8b8d8", busy: "#54c8ff", waiting: "#ffaa4a", "done-unread": "#5affc0", free: "#cfeaff" },
      accent: accent
    },
    gold: "#ff00ff", // 与 accent 刻意不同色：证明取色走 accent 通道而非兜底
    background() {},
    drawBody() {}
  });
  const container = stubEl("div");
  const eng = createCosmosEngine({ container, style: stubStyle("#00ff88") });
  try {
    const rootEl = container.children[0];
    const overlayEl = rootEl._by[".cos-overlay"];
    const canvasEl = rootEl._by[".cos-canvas"];
    const cardEl = rootEl._by[".cos-card"];
    const fire = (el, type, ev) => { for (const fn of el.listeners[type] ?? []) fn(ev); };
    /** DOM transform 串里第一组 translate(x,y)（chip/slab/card 的定位数）。 */
    const parseTranslate = (value) => {
      const m = /translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\s*\)/.exec(String(value));
      return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
    };
    /** 世界坐标 → 屏幕点（与引擎 project 同式：fov 60 / 视口 800×600 桩）。 */
    const screenPoint = (world) => {
      const cam = eng.getCamera();
      const W = 800, H = 600;
      let v = [world[0] - cam.target[0], world[1] - cam.target[1], world[2] - cam.target[2]];
      const cy = Math.cos(-cam.yaw), sy = Math.sin(-cam.yaw);
      v = [v[0] * cy + v[2] * sy, v[1], -v[0] * sy + v[2] * cy];
      const cx = Math.cos(-cam.pitch), sx = Math.sin(-cam.pitch);
      v = [v[0], v[1] * cx - v[2] * sx, v[1] * sx + v[2] * cx];
      const f = (H * 1.1) / (2 * Math.tan(60 * Math.PI / 360));
      const s = f / (v[2] + cam.dist);
      return { x: W / 2 + v[0] * s, y: H / 2 - v[1] * s };
    };
    const tips = () => eng.inspectTipLines();
    /* 卡盒测量口径（D5：MUST NOT 逐帧强制布局）：桩元素用计数 getter 表达真实
       `offsetWidth/Height`（240×147 ≈ 真机恒星卡实测盒），断言只在内容签名变更时读一次。
       卡宽同时是翻转阈值（「星缘 + 间距 + 卡宽 + 留白」）的输入。 */
    const CARD_H = 147;
    const CARD_HALF = CARD_H / 2;
    const CARD_W = 240;
    let cardHReads = 0;
    Object.defineProperty(cardEl, "offsetHeight", {
      configurable: true,
      get() { cardHReads += 1; return CARD_H; }
    });
    Object.defineProperty(cardEl, "offsetWidth", {
      configurable: true,
      get() { cardHReads += 1; return CARD_W; }
    });
    const hoverWorld = (world, pointerId = 61) => {
      const p = screenPoint(world);
      fire(rootEl, "pointermove", { pointerId: pointerId, clientX: p.x, clientY: p.y, buttons: 0, target: canvasEl });
      return p;
    };
    const strokeAlpha = (style) => Number(String(style).match(/,([\d.]+)\)$/)?.[1] ?? NaN);

    const scene = miniScene();
    scene.workspaces[0].planets[0].satellites = [{ id: "sat-a", state: "busy", title: "sat a" }];
    eng.setScene(scene, "rebuild");
    rafQ.length = 0;
    eng.start();
    let tNow = 60000;
    const step1 = (n = 1) => { for (let i = 0; i < n; i++) { tNow += 50; stepFrame(tNow); } };
    step1(27); // 过冷启动序曲

    /* ① 银河态 chip：一条竖直引线，端点 = DOM transform 的同一组数（D3 硬红线） */
    const chipEl = overlayEl.children.find((el) => String(el.className).startsWith("cos-chip"));
    assert.ok(chipEl, "chip 已创建");
    resetRec();
    step1(1);
    let lines = tips();
    assert.equal(lines.length, 1, "银河态唯一可见浮签 = chip → 唯一引线");
    assert.equal(lines[0].kind, "chip");
    assert.deepEqual({ x: lines[0].x, y: lines[0].y }, parseTranslate(chipEl.style.transform), "chip 引线止点 = DOM translate 的同一组数（端点同源）");
    assert.equal(lines[0].hx, lines[0].x, "chip 引线竖直");
    assert.ok(Math.abs((lines[0].hy - lines[0].y) - TIP_GAP.chip) <= 0.15, "chip 避让间距 = TIP_GAP.chip（线长即间距本身）");
    assert.equal(lines[0].alpha, Number(chipEl.style.opacity), "chip 引线 α = 同帧 inline opacity（同一表达式）");
    assert.equal(rec.strokes.length, 1, "每可见浮签一次描边（起笔短横与竖线同路径）");
    assert.ok(String(rec.strokes[0]).startsWith("rgba(0,255,136,"), "引线取色 = 活跃皮肤 accent（Canvas 取色通道）");
    assert.ok(strokeAlpha(rec.strokes[0]) <= TIP_LINE.alphaMax + 1e-9, "引线 α ≤ 上限（弱于浮签本体）");

    /* ② 钻取态名牌：chip 引线随浮签隐藏、名牌引线出现；端点/α 同源 */
    assert.equal(eng.diveToWs("ws1"), true, "钻取目标星座");
    fakeNow += 1300;
    step1(2);
    const slabEl = overlayEl.children.find((el) => el.className === "cos-slab");
    lines = tips();
    const slabLine = lines.find((line) => line.kind === "slab");
    assert.ok(slabLine, "钻取态：恒星名牌引线出现");
    assert.ok(lines.every((line) => line.kind !== "chip"), "chip 浮签隐藏的同一帧其引线不再产出（无残影窗口）");
    assert.deepEqual({ x: slabLine.x, y: slabLine.y }, parseTranslate(slabEl.style.transform), "名牌引线止点 = DOM translate 同组件数");
    assert.ok(Math.abs((slabLine.y - slabLine.hy) - TIP_GAP.slab) <= 0.15, "名牌避让间距 = TIP_GAP.slab（自星缘起算）");
    assert.equal(slabLine.alpha, Number(slabEl.style.opacity), "名牌引线 α 与 inline opacity 同源");

    /* ③ 退出钻取：名牌引线同帧消失、chip 引线恢复 */
    assert.equal(eng.consumeEscape(), true, "Esc 飞回银河");
    fakeNow += 1300;
    step1(2);
    lines = tips();
    assert.deepEqual(lines.map((line) => line.kind), ["chip"], "退出钻取：名牌引线摘除、chip 引线恢复");

    /* ④ 信息卡：hover 恒星 → 折线引线；止点 = 卡近缘中点；α 跟随 .on 谓词 */
    cardEl.dataset.sig = "";
    let hit = null;
    for (let gx = 364; gx <= 440 && !hit; gx += 4) {
      for (let gy = 264; gy <= 340 && !hit; gy += 4) {
        fire(rootEl, "pointermove", { pointerId: 60, clientX: gx, clientY: gy, buttons: 0, target: canvasEl });
        step1(1);
        if (String(cardEl.dataset.sig).startsWith("star:")) hit = { x: gx, y: gy };
      }
    }
    assert.ok(hit, "找到恒星 hover 命中点（拾取面自检）");
    resetRec();
    step1(1);
    lines = tips();
    const cardLine = lines.find((line) => line.kind === "card");
    const cardAt = parseTranslate(cardEl.style.transform);
    assert.ok(cardLine, "hover 恒星 → 信息卡折线引线");
    assert.equal(cardLine.x, cardAt.x, "信息卡引线止点 x = DOM translate 同源");
    assert.equal(cardLine.y, cardAt.y + CARD_HALF, "折线止于卡近缘中点（半高取自内容签名缓存测量）");
    assert.equal(cardLine.alpha, 1, "信息卡引线 α 跟随 .on 布尔可见性谓词（与浮签同源）");
    assert.ok(Math.abs(Math.abs(cardLine.x - cardLine.hx) - TIP_GAP.card) <= 0.15, "信息卡避让间距 = TIP_GAP.card（自星缘起算）");
    assert.ok(cardLine.x > cardLine.hx, "卡在星右侧：折线向右发散（east 侧水平段）");
    assert.equal(rec.strokes.length, lines.length, "同帧描边数 = 引线条目数（每浮签一条线）");
    /* 折线为 45° 斜出段（横向跨距 = 纵向落差）+ 不短于 tail 的水平段 */
    const cardGeo = tipLeaderOf(cardLine);
    assert.equal(cardGeo.pts.length, 3, "信息卡引线 = 两段折线（45° 斜出 + 水平）");
    assert.equal(
      Math.abs(cardGeo.pts[1].x - cardGeo.pts[0].x),
      Math.abs(cardGeo.pts[1].y - cardGeo.pts[0].y),
      "斜出段 45°：|dx| === |dy|（缓存端点的几何换算）"
    );
    assert.ok(cardGeo.pts[2].x - cardGeo.pts[1].x >= TIP_LINE.tail - 1e-9, "水平段不短于 TIP_LINE.tail");
    /* 卡体不越出右缘（翻转阈值随「星缘 + 间距 + 卡宽」派生） */
    assert.ok(cardAt.x + CARD_W <= 800, "非翻转帧：卡右缘不越出视口（阈值与卡宽同源）");

    /* ④b 卡端测量口径（D5）：内容签名变更时才读 offsetHeight，稳态零强制布局 */
    const readsIdle = cardHReads;
    step1(6);
    assert.equal(cardHReads, readsIdle, "稳态帧 MUST NOT 重复读取卡高（无逐帧强制布局）");
    const actScene = miniScene();
    actScene.workspaces[0].stars[0].act = 5; // sig 追加 act → 内容签名变更 → 重测一次
    eng.setScene(actScene, "patch");
    step1(2);
    assert.ok(cardHReads > readsIdle, "内容签名变更 → 重新测量（act 翻转；patched 场景可能跨帧换 sig）");

    /* ⑤ 翻转：星移到右缘（x > W−300）→ 卡翻左侧，折线随之向左（端点用翻转后坐标） */
    const rightScene = miniScene();
    rightScene.workspaces[0].stars[0].off = [150, 0, 0];
    rightScene.workspaces[0].planets = [];
    rightScene.workspaces[0].comets = [];
    eng.setScene(rightScene, "rebuild");
    step1(2);
    hoverWorld(eng.inspectEntities("ws1").stars[0].wp, 62);
    step1(3);
    lines = tips();
    const flipLine = lines.find((line) => line.kind === "card");
    assert.ok(flipLine, "右缘星 hover → 信息卡引线");
    assert.ok(String(cardEl.style.transform).includes("translateX(-100%)"), "翻转阈值（星缘+间距+卡宽派生）生效（卡翻至星左侧）");
    assert.ok(flipLine.x < flipLine.hx, "翻转侧：引线自星右缘折向卡片左近缘（端点用翻转后坐标）");
    assert.equal(flipLine.x, parseTranslate(cardEl.style.transform).x, "翻转帧端点仍与 DOM transform 同源");
    assert.ok(parseTranslate(cardEl.style.transform).x - CARD_W >= 0, "翻转帧：卡左缘不越出视口（同一派生的镜像侧）");

    /* ⑥ 钳制：星贴近上缘 → 卡纵向钳在 70，引线止于钳后卡缘（MUST NOT 悬空） */
    const topScene = miniScene();
    topScene.workspaces[0].stars[0].off = [0, 180, 0];
    topScene.workspaces[0].planets = [];
    topScene.workspaces[0].comets = [];
    eng.setScene(topScene, "rebuild");
    step1(2);
    hoverWorld(eng.inspectEntities("ws1").stars[0].wp, 63);
    step1(3);
    lines = tips();
    const clampLine = lines.find((line) => line.kind === "card");
    const clampAt = parseTranslate(cardEl.style.transform);
    assert.ok(clampLine, "近上缘星 hover → 信息卡引线");
    assert.equal(clampAt.y, 70, "纵向钳制生效（70..H−240 下界）");
    assert.equal(clampLine.y, 70 + CARD_HALF, "钳制时引线止于钳后卡缘（MUST NOT 指向钳前虚拟位）");
    assert.equal(clampLine.y, clampAt.y + CARD_HALF, "钳制帧端点仍与 DOM transform 同源");

    /* ⑦ 卫星无引线：行星挂卫星的星座里，引线族仍只有 chip/slab/card */
    const satScene = miniScene();
    satScene.workspaces[0].planets[0].satellites = [
      { id: "sat-a", state: "busy", title: "sat a" },
      { id: "sat-b", state: "waiting", title: "sat b" }
    ];
    eng.setScene(satScene, "rebuild");
    step1(2);
    assert.equal(eng.inspectEntities("ws1").planets[0].sats.length, 2, "夹具确认：行星挂 2 颗卫星");
    hoverWorld(eng.worldPosOf("planet", "p1"), 64);
    step1(3);
    const satKinds = [...new Set(tips().map((line) => line.kind))].sort();
    assert.deepEqual(satKinds, ["card", "chip"], "引线族仅 chip/slab/card——卫星无浮签故无引线");
    assert.ok(tips().some((line) => line.kind === "card"), "行星 hover → 信息卡引线仍在");

    /* ⑧ 皮肤热切换：引线取色即时随动（accent 通道），逐帧描边数仍等于引线数 */
    eng.setSkin(stubStyle("#123456"));
    resetRec();
    step1(1);
    lines = tips();
    assert.equal(rec.strokes.length, lines.length, "换肤帧：描边数 = 引线条目数");
    assert.ok(String(rec.strokes[0]).startsWith("rgba(18,52,86,"), "皮肤热切换 → 引线取新皮肤 accent（#123456）");
    assert.ok(!String(rec.strokes[0]).includes("255,0,255"), "MUST NOT 回落 gold（accent 通道优先）");

    /* ⑨ 引线不参与拾取：点击引线段不触发 dive / 选中 */
    const chipLineNow = tips().find((line) => line.kind === "chip") ?? tips()[0];
    assert.ok(chipLineNow, "存在可见引线（拾取隔离断言前置）");
    const lineMid = { x: chipLineNow.hx, y: (chipLineNow.hy + chipLineNow.y) / 2 };
    const divesBefore = eng.inspectInput().dives;
    fire(rootEl, "pointerdown", { pointerId: 65, button: 0, clientX: lineMid.x, clientY: lineMid.y, target: canvasEl, preventDefault() {} });
    fire(rootEl, "pointerup", { pointerId: 65, button: 0, clientX: lineMid.x, clientY: lineMid.y, target: canvasEl });
    step1(1);
    assert.equal(eng.inspectInput().dives, divesBefore, "点击引线段不触发 dive（Canvas 层不在命中集合内）");
    assert.equal(eng.inspectSelection(), null, "点击引线段不产生选中（引线不参与指针拾取）");
  } finally {
    eng.stop();
    eng.dispose();
    ctxFactory = stubCtx2d;
  }
}

console.log("engine-smoke: all assertions passed");
