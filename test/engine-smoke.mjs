/**
 * 引擎与皮肤模块冒烟（add-cosmos-entry 4.3/4.4）：模块可导入（import 时零 DOM 副作用）、
 * 皮肤接口形状（palette + background + drawBody，R5 引擎无关）、引擎公共面。
 * 运行：node test/engine-smoke.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCosmosEngine, ENGINE_CSS, panBasis, panCameraTarget, panCameraTargetByDrag, PAN_SPEED, PAN_SHIFT_BOOST, PAN_DRAG_FACTOR, SESSION_OPEN_KEY, makeNova, stepNovae, buildScenePure, FX_PRIORITY, FX_NOVA_DUR, FX_NOVA_PROTO_DUR, BOOT_DUR, isEditableTarget, boundingSphereOf, fitCameraOf, FILTER_RAMP_DUR, FILTER_SHIFT_DUR, FILTER_FIT_DUR, FILTER_FIT_MARGIN, WS_SHIFT_DUR, WS_BIRTH_HL_DUR, WS_SWITCH_FADE, GESTURE_SUPPRESS_MS, zoomSwitchVerdict, zoomFocusTargetOf, canvasPointOf, constellationBoundROf, constellationVitalityOf, wsSwitcherItemsOf, DIVE_REF, SWITCH_COOLDOWN_MS, CENTER_GATE_RATIO, DIVE_SAFE_MARGIN, FLYOUT_DIST_FLOOR_MULT, FLYOUT_DIST_FLOOR, ZOOM_RULER_TICK, ZOOM_RULER_DIST_MIN, ZOOM_RULER_DIST_MAX, ZOOM_METER_EPSILON, ZOOM_RULER_EASE_RATIO, ZOOM_RULER_EASE_MS, zoomMeterTrackOf, zoomRulerMotionOf, DIST_MIN, DIST_MAX, HOME_DIST, COMET_WANDER_R, STAR_FOCUS_DIST, STAR_FOCUS_DUR, SHOCK_SPEED, SHOCK_HOLD_MIN, SHOCK_HOLD_MAX, SHOCK_KICK_DUR, SHOCK_GLIDE_DUR, SHOCK_TOTAL_MAX, shockHitOf, shockEjectionAt, shockTotalDurOf, adoptTrailAcrossKinds, resolveBlastCoreOf, CAPTURE_DUR, COMET_WANDER_AMP, COMET_WANDER_FREQ, cometHeadingAt, orbitPointAt, orbitTangentAt, captureRingPointAt, capturePoseAt, TIP_GAP, TIP_LINE, tipLeaderOf, tipLineColorOf, UI_AVOID, normalizeUiRects, rectsIntersect, boxInRects, pointInRects, boundsBoxOf, tipBoxOf, tipAvoidanceOf, NEBULA_ALPHA_BASE, NEBULA_ALPHA_SWING, patSnapshotOf, patEmptySlotsOf } from "../src/cosmos/engine.mjs";
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
      panSpeed: 120, panShiftBoost: 3, skin: "rosepine",
      zoomPointerFocus: true, sessionPanelOpen: true, constPreflight: "float", dragPan: false,
      /* 界面尺寸 13 键（add-cosmos-layout-tuning D2；add-cosmos-template-reassign 返工扩
         wsToolSize）：缺省 = 引入配置面之前的现值。 */
      sessionPanelWidth: 260, sessionPanelHeight: 0, constPanelWidth: 187, constPanelHeight: 0,
      addBtnSize: 44, hudBtnSize: 44, actionBtnWidth: 112, actionBtnHeight: 40,
      constActionHeight: 40, searchWidth: 320, searchHeight: 0, wsTitleSize: 13,
      /* 全局快捷键四键（add-cosmos-shortcuts 2.1）：缺省遵用户裁决。 */
      shortcuts: { closePage: "Escape", goHome: "Backquote", togglePan: "KeyM", voiceToggle: "Ctrl+KeyQ" },
      /* 入口打开方式（add-cosmos-rightbar-dock）：缺省 embedded = 现状。 */
      launchMode: "embedded",
      /* 星座模板名显示（add-cosmos-template-name-toggle）：缺省关闭 ⇒ 默认渲染零变化。 */
      templateNames: false,
      /* 图样连线亮度（add-cosmos-figure-line-alpha）：缺省 50% = 引擎因子 0.5。 */
      patLineDim: 50,
      /* 顶部模板工具高度（add-cosmos-template-reassign 返工）：缺省 32px。 */
      wsToolSize: 32,
      /* 星场呈现（p2-add-cosmos-works-face）：等势线 / ASCII 底纹缺省均开。 */
      worksContours: true,
      worksAscii: true
    },
    "出厂默认（含默认皮肤、指针聚焦、会话面板展开态、发送前编辑分支 float、拖拽平移关闭、界面尺寸 13 键 = 现值、快捷键四键、入口打开方式 embedded、星座模板名关闭、图样连线亮度 50、顶部工具按钮高 32、星场两开关开；缩放阈值两键已退场）"
  );
  assert.equal(COSMOS_SETTINGS_VERSION, 15, "设置面 v15（v14 → v15 新增 worksContours/worksAscii；v13 → v14 新增 wsToolSize；v12 → v13 新增 patLineDim；v10 = launchMode/dock 迁移，v11 = templateNames，v12 = 删缩放阈值两键）");
  assert.equal("zoomDiveRatio" in COSMOS_SETTINGS_DEFAULTS, false, "进入阈值设置键已退场（阈值 = 引擎常量）");
  assert.equal("zoomFlyOutRatio" in COSMOS_SETTINGS_DEFAULTS, false, "返回阈值设置键已退场（距离单判常量）");
  assert.deepEqual(sanitizeCosmosSettings({}), COSMOS_SETTINGS_DEFAULTS, "空配置 → 默认");
  assert.deepEqual(
    sanitizeCosmosSettings({ panSpeed: 999, panShiftBoost: 0, hacker: 1 }),
    {
      panSpeed: COSMOS_SETTINGS_BOUNDS.panSpeed[1],
      panShiftBoost: COSMOS_SETTINGS_BOUNDS.panShiftBoost[0],
      skin: "rosepine",
      zoomPointerFocus: true,
      sessionPanelOpen: true,
      constPreflight: "float",
      dragPan: false,
      sessionPanelWidth: 260, sessionPanelHeight: 0, constPanelWidth: 187, constPanelHeight: 0,
      addBtnSize: 44, hudBtnSize: 44, actionBtnWidth: 112, actionBtnHeight: 40,
      constActionHeight: 40, searchWidth: 320, searchHeight: 0, wsTitleSize: 13,
      shortcuts: { closePage: "Escape", goHome: "Backquote", togglePan: "KeyM", voiceToggle: "Ctrl+KeyQ" },
      launchMode: "embedded",
      templateNames: false,
      patLineDim: 50,
      wsToolSize: 32,
      worksContours: true,
      worksAscii: true
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
      "panSpeed", "patLineDim", "searchHeight", "searchWidth", "sessionPanelHeight",
      "sessionPanelWidth", "wsTitleSize", "wsToolSize"
    ],
    "BOUNDS 保持纯数值形状（不混入枚举/布尔键；界面尺寸 13 键与 patLineDim 全为数值界；缩放阈值两键已删）"
  );
  assert.deepEqual(
    [
      sanitizeCosmosSettings({ wsToolSize: 20 }).wsToolSize,
      sanitizeCosmosSettings({ wsToolSize: 60 }).wsToolSize,
      sanitizeCosmosSettings({ wsToolSize: 40.6 }).wsToolSize,
      sanitizeCosmosSettings({ wsToolSize: "x" }).wsToolSize
    ],
    [28, 48, 41, 32],
    "顶部工具高度净房：越界落端点 / 取整 / 非数字回落 32"
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
    "非数字一律回落缺省（13 键）"
  );

  /* v6 旧载荷（无尺寸键）→ 逐键补默认 */
  const v6 = {
    panSpeed: 120, panShiftBoost: 3, skin: "rosepine",
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
      "--cos-ws-title-size": "13px",
      "--cos-ws-tool-size": "32px"
    },
    "缺省投影 = 现值字面量（高度 none = 不设上限；顶部工具 32px）"
  );
  const custom = cosmosLayoutTokensOf({
    ...COSMOS_SETTINGS_DEFAULTS,
    sessionPanelWidth: 320, sessionPanelHeight: 600, constPanelWidth: 220,
    hudBtnSize: 56, searchWidth: 420, searchHeight: 36, wsTitleSize: 16, wsToolSize: 40
  });
  assert.deepEqual(
    [custom["--cos-session-w"], custom["--cos-session-h"], custom["--cos-const-panel-w"], custom["--cos-hud-btn-size"], custom["--cos-search-w"], custom["--cos-search-h"], custom["--cos-ws-title-size"], custom["--cos-ws-tool-size"]],
    ["320px", "600px", "220px", "56px", "420px", "36px", "16px", "40px"],
    "自定义投影逐键生效（高度 >0 → Npx）"
  );
  /* 缺键/非法 → 逐键回落现值（令牌层不引入第二套默认值语义） */
  const partial = cosmosLayoutTokensOf({});
  assert.equal(partial["--cos-session-w"], "260px", "缺键回落现值");
  assert.equal(partial["--cos-action-btn-w"], "112px", "缺键回落现值（动作条）");
  assert.equal(cosmosLayoutTokensOf({ wsTitleSize: "x" })["--cos-ws-title-size"], "13px", "非法值回落现值");
}

/* ── 缩放导航纯函数（add-cosmos-zoom-focus-nav 1.1/1.2/2.7；add-cosmos-zoom-ruler
   1.1–1.3 口径收敛）：阈值口径 / 闸门 / 滞回下限 / 距离单判 / 模式隔离 / 守卫 /
   标尺对数映射与缓动分型 ── */
{
  const base = { minViewportPx: 600 };
  const params = { diveRatio: 100 };

  /* 进入：视距口径 = tick 155（阈值常量化，不再有设置键；直测传内部常量） */
  assert.equal(DIVE_REF, 155, "钻取参考视距常量");
  assert.equal(SWITCH_COOLDOWN_MS, 800, "切换冷却窗常量");
  assert.equal(CENTER_GATE_RATIO, 0.25, "屏心闸门系数常量");
  assert.equal(FLYOUT_DIST_FLOOR_MULT, 1.35, "返回滞回下限倍率常量");
  assert.ok(near(FLYOUT_DIST_FLOOR, 209.25, 1e-9), "返回滞回下限距离常量 = 209.25");
  assert.equal(ZOOM_RULER_TICK, 155, "标尺 tick = 钻取参考视距（双向同一刻度）");
  assert.equal(ZOOM_RULER_DIST_MIN, 24, "标尺值域下限 = DIST_MIN");
  assert.equal(ZOOM_RULER_DIST_MAX, 4200, "标尺值域上限 = DIST_MAX");
  assert.equal(DIST_MIN, 24, "镜头距离下限常量");
  assert.equal(DIST_MAX, 4200, "镜头距离上限常量");
  assert.equal(ZOOM_METER_EPSILON, 0.005, "标尺通知门限 0.5%");
  assert.equal(ZOOM_RULER_EASE_RATIO, 0.02, "跳变缓动门限 2%");
  assert.equal(ZOOM_RULER_EASE_MS, 200, "缓动时长 200ms");
  assert.equal(HOME_DIST, 3000, "银河首屏/归位视距常量 = 3000（首屏显示更多星座）");
  assert.deepEqual(
    zoomSwitchVerdict({ mode: "galaxy", vz: 155, centerDistPx: 0, ...base }, params),
    { dive: true, flyOut: false },
    "进入：vz=155（tick）恰好触发"
  );
  assert.equal(zoomSwitchVerdict({ mode: "galaxy", vz: 155.001, centerDistPx: 0, ...base }, params).dive, false, "vz 越过 tick → 不触发");
  /* 屏心闸门：min(W,H)×0.25（600 → 150） */
  assert.equal(zoomSwitchVerdict({ mode: "galaxy", vz: 100, centerDistPx: 150, ...base }).dive, true, "闸门边界（≤150）参与");
  assert.equal(zoomSwitchVerdict({ mode: "galaxy", vz: 100, centerDistPx: 150.001, ...base }).dive, false, "闸门外不参与");
  /* 模式隔离：galaxy 只可能 dive、drilled 只可能 flyOut（距离单判，无需屏显参数） */
  assert.deepEqual(zoomSwitchVerdict({ mode: "galaxy", vz: 10, centerDistPx: 0, ...base }), { dive: true, flyOut: false });
  assert.deepEqual(
    zoomSwitchVerdict({ mode: "drilled", dist: 5000 }, params),
    { dive: false, flyOut: true },
    "钻取态不会反向触发 dive（距离单判，不读视口/屏显尺寸）"
  );
  /* 守卫早退：blocked 双 false（即使口径全部满足） */
  assert.deepEqual(
    zoomSwitchVerdict({ mode: "galaxy", blocked: true, vz: 1, centerDistPx: 0, ...base }),
    { dive: false, flyOut: false },
    "blocked → 早退（滚轮补间/拖拽/手势/冷却）"
  );
  assert.deepEqual(zoomSwitchVerdict({ mode: "drilled", blocked: true, dist: 5000 }), { dive: false, flyOut: false });
  /* 返回：距离单判 dist ≥ 209.25（屏显直径条件已删除——大星座同一距离口径） */
  assert.equal(zoomSwitchVerdict({ mode: "drilled", dist: FLYOUT_DIST_FLOOR }, params).flyOut, true, "滞回下限处可返回");
  assert.equal(zoomSwitchVerdict({ mode: "drilled", dist: FLYOUT_DIST_FLOOR - 0.01 }, params).flyOut, false, "刚进入（dist=155）绝不误返回");
  assert.equal(zoomSwitchVerdict({ mode: "drilled", dist: 155 }, params).flyOut, false, "进入落点（tick）不满足返回");
  /* 大星座单判用例：旧口径 `2·boundR·f/dist ≤ 25%×min(W,H)` 在滞回下限处 ≈11470px ≫ 150px
     → 旧实现不返回；新实现（删除屏显直径条件）照常返回——行为变化显式接受。 */
  assert.equal(
    zoomSwitchVerdict({ mode: "drilled", dist: FLYOUT_DIST_FLOOR, boundR: 400, f: 3000 }, { flyOutRatio: 25 }).flyOut,
    true,
    "大星座在滞回下限照常飞回（屏显直径条件已删除）"
  );
  assert.equal(zoomSwitchVerdict({ mode: "drilled", dist: 0 }, params).flyOut, false, "非法 dist → false");
  assert.equal(zoomSwitchVerdict({ mode: "drilled", dist: "x" }, params).flyOut, false, "非数字 dist → false");
  assert.equal(zoomSwitchVerdict({ mode: "galaxy", vz: 1, centerDistPx: 0 }).dive, false, "缺视口 → galaxy 不判定");
  assert.deepEqual(zoomSwitchVerdict(null, null), { dive: false, flyOut: false }, "空入参防御");

  /* 标尺对数映射四点位（add-cosmos-zoom-ruler D1）：4200→0%、430≈44%、155≈64%、24→100% */
  const trackAt = (dist) => zoomMeterTrackOf(dist);
  assert.ok(near(trackAt(4200), 0, 1e-12), "4200 → 0%（银河缩到最小）");
  assert.ok(near(trackAt(430), Math.log(4200 / 430) / Math.log(4200 / 24), 1e-12), "430 = 对数映射公式");
  assert.ok(near(trackAt(430), 0.4413, 1e-3), "430 ≈ 44%（飞回常驻落点）");
  assert.ok(near(trackAt(155), Math.log(4200 / 155) / Math.log(4200 / 24), 1e-12), "155 = 对数映射公式");
  assert.ok(near(trackAt(155), 0.6389, 1e-3), "155（tick）≈ 64%");
  assert.ok(near(trackAt(24), 1, 1e-12), "24 → 100%（钻取态最大缩放）");
  assert.equal(trackAt(0), 0, "非法 dist → 0（不产生 NaN）");
  assert.equal(zoomMeterTrackOf(430, 100, 50), 0, "退化值域 → 0（安全落位）");
  assert.equal(zoomMeterTrackOf(10), 1, "越界近端 → clamp 到 1");
  assert.equal(zoomMeterTrackOf(99999), 0, "越界远端 → clamp 到 0");

  /* 缓动分型（D5）：≥2% 位移走 ease，连续小步 snap（零可感迟滞） */
  assert.equal(zoomRulerMotionOf(0.1, 0.13), "ease", "位移 3% → ease（跳变门控）");
  assert.equal(zoomRulerMotionOf(0.1, 0.119), "snap", "位移 1.9% → snap（连续小步直接落位）");
  assert.equal(zoomRulerMotionOf(undefined, 0.5), "snap", "首次落位 → snap（无起点不缓动）");
  assert.equal(zoomRulerMotionOf(0.1, NaN), "snap", "非法目标 → snap");
  assert.ok(zoomMeterTrackOf(155) - zoomMeterTrackOf(430) > ZOOM_RULER_EASE_RATIO, "430→155 单步位移属跳变带（dive/flyOut 补间落点走缓动）");
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

/* ── 缩放导航设置退场（add-cosmos-zoom-ruler 3.1/3.3）+ 指针聚焦保留：
   两阈值键从 defaults / bounds / sanitize 全面删除；v11 及更早存量两键读出即弃
   （无迁移动作、无报错）；zoomPointerFocus 布尔净化照旧 ── */
{
  assert.equal("zoomDiveRatio" in COSMOS_SETTINGS_BOUNDS, false, "进入阈值界已删除");
  assert.equal("zoomFlyOutRatio" in COSMOS_SETTINGS_BOUNDS, false, "返回阈值界已删除");
  assert.equal("zoomDiveRatio" in COSMOS_SETTINGS_DEFAULTS, false, "进入阈值缺省已删除");
  assert.equal("zoomFlyOutRatio" in COSMOS_SETTINGS_DEFAULTS, false, "返回阈值缺省已删除");
  /* 旧键（任意值）不进入净房结果：无键、无迁移动作、SHALL NOT 抛错 */
  const legacy = sanitizeCosmosSettings({ zoomDiveRatio: 80, zoomFlyOutRatio: 40 });
  assert.equal("zoomDiveRatio" in legacy, false, "进入阈值旧键读出即弃");
  assert.equal("zoomFlyOutRatio" in legacy, false, "返回阈值旧键读出即弃");
  assert.deepEqual(legacy, COSMOS_SETTINGS_DEFAULTS, "仅含旧键的载荷净化为出厂默认");
  assert.deepEqual(
    sanitizeCosmosSettings({ zoomDiveRatio: 9999, zoomFlyOutRatio: "x", zoomPointerFocus: "yes" }),
    { ...COSMOS_SETTINGS_DEFAULTS, zoomPointerFocus: true },
    "旧键非法值同样弃用；zoomPointerFocus 非布尔净化照旧"
  );
  assert.equal(sanitizeCosmosSettings({ zoomPointerFocus: false }).zoomPointerFocus, false, "布尔 false 透传");
  for (const bad of ["no", 0, 1, null, undefined, {}, []]) {
    assert.equal(sanitizeCosmosSettings({ zoomPointerFocus: bad }).zoomPointerFocus, true, "非布尔独立分支回落 true：" + String(bad));
  }
  assert.equal("zoomPointerFocus" in COSMOS_SETTINGS_BOUNDS, false, "布尔键不进数值界表");
  /* v2/v3 载荷（无新键）→ 补默认；既有键不回归 */
  const v2 = sanitizeCosmosSettings({ panSpeed: 180, panShiftBoost: 2, skin: "lotus" });
  assert.equal(v2.panSpeed, 180, "v2 载荷 panSpeed 保持");
  assert.equal(v2.skin, "lotus", "v2 载荷 skin 保持");
  assert.deepEqual(
    [v2.zoomPointerFocus, v2.sessionPanelOpen],
    [true, true],
    "v2 载荷补指针聚焦默认与会话面板展开态"
  );
  /* v11 存量（含两阈值键 + templateNames）→ 净房弃两键、其余保留；落盘不再含两键 */
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key)
  };
  try {
    store.set("dsh-v-cosmos:settings", JSON.stringify({
      zoomDiveRatio: 80, zoomFlyOutRatio: 40, zoomPointerFocus: false,
      templateNames: true, panSpeed: 150
    }));
    const loaded = loadCosmosSettings();
    assert.deepEqual(
      [loaded.panSpeed, loaded.zoomPointerFocus, loaded.templateNames],
      [150, false, true],
      "v11 存量：两阈值键读出即弃，其余键原样保留"
    );
    assert.equal("zoomDiveRatio" in loaded, false, "读面结果不含进入阈值键");
    assert.equal("zoomFlyOutRatio" in loaded, false, "读面结果不含返回阈值键");
    const saved = saveCosmosSettings({ zoomPointerFocus: true });
    assert.deepEqual(
      [saved.zoomPointerFocus, saved.templateNames],
      [true, true],
      "写侧净房保留指针聚焦与模板名键"
    );
    const disk = JSON.parse(store.get("dsh-v-cosmos:settings"));
    assert.equal("zoomDiveRatio" in disk, false, "落盘形状不含进入阈值键（无迁移动作）");
    assert.equal("zoomFlyOutRatio" in disk, false, "落盘形状不含返回阈值键");
    assert.deepEqual(loadCosmosSettings(), saved, "读回同一设置");
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
/* classList 桩：真实维护 className 令牌集（add / remove / toggle / contains）——星座活力
   两态的 class 翻转（step1-add-constellation-vitality 2.2）必须可在桩上断言；空实现会让
   `classList.toggle` 静默丢失、沉睡态不可观测。 */
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
        /* .cos-canvas 与 .cos-tiplines 同为 canvas 载体（引线层，polish-cosmos-tip-topmost-layer 2.1） */
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
    setPointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 })
  };
  el.classList = classListOf(el);
  return el;
}
/* 记录型 ctx（引线描线断言）：在桩 ctx 之上记录 stroke() 时生效的 strokeStyle 与
   clearRect() 整屏清屏（引线层每帧清空契约，polish-cosmos-tip-topmost-layer 2.4），
   `ops` 保序记录两类调用（清屏先于描线的次序断言），其余方法与桩同形（缺省即惰性 no-op）。 */
function recordingCtx() {
  const rec = { strokes: [], clears: [], ops: [] };
  return new Proxy({ __rec: rec }, {
    get(target, prop) {
      if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => ({ addColorStop() {} });
      if (prop === "__rec") return rec;
      if (prop === "stroke") return () => { rec.strokes.push(target.strokeStyle ?? null); rec.ops.push("stroke"); };
      if (prop === "clearRect") return (x, y, w, h) => { rec.clears.push([x, y, w, h]); rec.ops.push("clear"); };
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

/* ── 星座活力两态纯函数（step1-add-constellation-vitality D1/D5 / 1.2）：
      存在口径判据 = 恒星（含 proto 星胚）∪ 行星 ∪ 彗星任一非空 → active；全空 → sleep。
      星云（archives）与卫星计数不计入；缺字段/非数组/null 容错不抛错；判据不依赖会话
      状态快照（statuses 不可达无分支）。 ── */
{
  const vit = constellationVitalityOf;
  const ws = (over) => ({ stars: [], planets: [], comets: [], archives: 0, satelliteCount: 0, ...over });
  assert.equal(vit(ws({ stars: [{ id: "s" }] })), "active", "有恒星 → 活跃");
  assert.equal(vit(ws({ stars: [{ id: "p", lifecycle: "proto" }] })), "active", "仅星胚（proto 恒星）→ 活跃");
  assert.equal(vit(ws({ planets: [{ id: "p" }] })), "active", "有行星 → 活跃");
  assert.equal(vit(ws({ comets: [{ id: "c" }] })), "active", "有彗星 → 活跃");
  assert.equal(vit(ws({ archives: 2 })), "sleep", "仅星云（archives>0 且天体全空）→ 沉睡（星云不计入判据）");
  assert.equal(vit(ws({ satelliteCount: 3 })), "sleep", "仅有卫星计数（孤儿卫星）→ 沉睡（卫星不独立计入）");
  assert.equal(vit(ws({})), "sleep", "全空 → 沉睡");
  assert.equal(vit({ stars: [], planets: [], comets: [] }), "sleep", "无 archives / satelliteCount 字段 → 沉睡（缺字段按空处理）");
  assert.equal(vit({}), "sleep", "缺全部天体字段 → 沉睡");
  assert.equal(vit({ stars: null, planets: undefined, comets: "x" }), "sleep", "非数组按空处理（SHALL NOT 抛错）");
  assert.equal(vit(null), "sleep", "null body → 沉睡（不抛错）");
  assert.equal(vit(undefined), "sleep", "undefined body → 沉睡（不抛错）");
  /* 存在口径 ≠ 热度口径：idle（待机）会话同样计入；statuses 快照不参与判据。 */
  assert.equal(vit(ws({ planets: [{ id: "p", state: "idle" }] })), "active", "待机会话仍计活跃（存在口径）");
  assert.equal(
    vit(ws({ planets: [{ id: "p", state: "busy" }], statuses: { p: "busy" } })),
    vit(ws({ planets: [{ id: "p", state: "idle" }] })),
    "statuses 可达/不可达判据不变（无降级分支）"
  );
  const frozen = Object.freeze(ws({ stars: [{ id: "s" }] }));
  assert.equal(vit(frozen), "active", "冻结 body 只读遍历（纯函数，不写回）");
}

/* ── 钻取态可切换星座清单纯函数（step2-add-constellation-switcher D2 / 1.2）：
      清单 = **有提案或星胚**的星座（`stars` 非空；仅会话星座 MUST NOT 入列）∖ 当前；
      环 = 含当前可切换全集按星座名（id 兜底）字典序首尾相接 → 左槽前驱 / 右槽后继；
      边界档位 0 / 1 / ≥2 与 focusWsId 容错（含降级环）。与 step1 活力判据刻意分离。 ── */
{
  const star = (id) => ({ id, name: id, lifecycle: "created" });
  const protoStar = (id) => ({ id, name: id, lifecycle: "proto" });
  const wsOf = (id, name, over = {}) => ({ id, name, stars: [], planets: [], comets: [], archives: 0, ...over });
  const sceneWith = (...list) => ({ ws: list });
  const proposalOf = (name) => ({ stars: [star(name + "-s")] });
  const sessionsOnly = { planets: [{ id: "p-session", state: "idle" }], comets: [{ id: "c-session", state: "idle" }] };
  const idsOf = (items) => items.map((item) => item.wsId);
  const sideOf = (items, wsId) => (items.find((item) => item.wsId === wsId) ?? {}).side ?? null;

  assert.equal(WS_SWITCH_FADE, 0.25, "淡入淡出常量导出（约 .25s，chip .on 同款）");
  assert.equal(constellationVitalityOf(sessionsOnly), "active",
    "仅会话星座在 step1 活力判据中仍为活跃（本切换判据不改变既有活力呈现）");

  /* ① 判据：正式提案 / 星胚入列；仅会话（行星/彗星）、仅星云、全空、孤儿卫星不入列。 */
  const ring5 = sceneWith(
    wsOf("cur", "Current", proposalOf("cur")),
    wsOf("alpha", "Alpha", proposalOf("alpha")),
    wsOf("bravo", "Bravo", proposalOf("bravo")),
    wsOf("charlie", "Charlie", proposalOf("charlie")),
    wsOf("proto", "Proto", { stars: [protoStar("pp")] }),
    wsOf("sessions", "Sessions", sessionsOnly),
    wsOf("nebula", "Nebula", { archives: 3 }),
    wsOf("empty", "Empty"),
    wsOf("orphan", "Orphan", { satelliteCount: 2 })
  );
  const ring5Items = wsSwitcherItemsOf(ring5, "cur");
  assert.deepEqual(idsOf(ring5Items), ["charlie", "proto"], "清单 = 有提案/星胚的星座 ∖ 当前（星胚入列）");
  assert.equal(sideOf(ring5Items, "charlie"), "left", "左槽 = 环上前驱");
  assert.equal(sideOf(ring5Items, "proto"), "right", "右槽 = 环上后继");
  assert.ok(!idsOf(ring5Items).includes("cur"), "当前星座 MUST NOT 出现在清单中");
  assert.ok(!idsOf(ring5Items).includes("sessions"), "仅会话（无提案/星胚）星座 MUST NOT 入列（不再视为可切换活跃）");
  assert.ok(!idsOf(ring5Items).some((id) => ["nebula", "empty", "orphan"].includes(id)),
    "仅星云 / 全空 / 孤儿卫星星座不入清单");

  /* 仅会话星座即便在场景中也不改变环绕序（不占环位）。 */
  const onlySessionsScene = sceneWith(
    wsOf("cur", "Current", proposalOf("cur")),
    wsOf("sessions", "Sessions", sessionsOnly),
    wsOf("nebula", "Nebula", { archives: 2 })
  );
  assert.deepEqual(wsSwitcherItemsOf(onlySessionsScene, "cur"), [], "其他星座仅会话/星云 → 两槽零内容");
  assert.deepEqual(idsOf(wsSwitcherItemsOf(ring5, "sessions")), ["proto", "alpha"],
    "当前为仅会话星座（不在可切换环上）→ 降级环绕序（左末 Proto / 右首 Alpha）");

  /* ② 环绕序（字典序首尾相接）：同一环换焦点 → 前驱/后继随环绕翻转。 */
  assert.deepEqual(idsOf(wsSwitcherItemsOf(ring5, "alpha")), ["proto", "bravo"], "焦点在环上首位：左槽环绕到末位 Proto、右槽后继 Bravo");
  const mid = wsSwitcherItemsOf(ring5, "bravo");
  assert.deepEqual(idsOf(mid), ["alpha", "charlie"], "焦点在中位：左槽前驱 Alpha、右槽后继 Charlie");
  assert.deepEqual(idsOf(wsSwitcherItemsOf(ring5, "proto")), ["cur", "alpha"], "焦点在环上末位：左槽前驱 Current、右槽环绕到首位 Alpha");
  assert.notEqual(sideOf(mid, "alpha"), sideOf(mid, "charlie"), "两侧条目档位恒定（左前驱 / 右后继）");
  assert.ok(wsSwitcherItemsOf(ring5, "alpha").every((item) => item.side === "left" || item.side === "right"), "side 只为 left/right");

  /* ③ 边界档位：0 个其他可切换 → []；恰 1 个 → 仅右槽（去重，MUST NOT 两侧同显）；≥2 → 两侧必不同。 */
  assert.deepEqual(wsSwitcherItemsOf(sceneWith(wsOf("only", "Only", proposalOf("only"))), "only"), [], "唯一可切换星座 → 两槽零内容");
  assert.deepEqual(wsSwitcherItemsOf(sceneWith(wsOf("only", "Only", { archives: 2 })), "only"), [], "无可切换星座 → 空清单（不抛错）");
  const pairItems = wsSwitcherItemsOf(sceneWith(
    wsOf("x", "Xray", proposalOf("x")),
    wsOf("y", "Yankee", proposalOf("y")),
    wsOf("z", "Zulu", sessionsOnly),
    wsOf("n", "Nebula", { archives: 2 })
  ), "x");
  assert.deepEqual(idsOf(pairItems), ["y"], "恰 1 个其他可切换星座 → 单条目（仅会话/星云不计）");
  assert.equal(sideOf(pairItems, "y"), "right", "单条目落右槽（前驱 = 后继去重）");
  for (const focusId of ["cur", "alpha", "bravo", "charlie", "proto"]) {
    const items = wsSwitcherItemsOf(ring5, focusId);
    assert.equal(items.length, 2, focusId + "：≥2 个其他可切换星座 → 左右各一");
    assert.notEqual(items[0].wsId, items[1].wsId, focusId + "：两侧条目必为不同目标（MUST NOT 同显）");
    assert.ok(items[0].wsId !== focusId && items[1].wsId !== focusId, focusId + "：两侧均非当前星座");
  }

  /* ④ 字典序 + id 兜底：同名按 id 排序；空名回落 id 作显示名。 */
  const sameName = sceneWith(
    wsOf("b", "Same", proposalOf("b")),
    wsOf("a", "Same", proposalOf("a")),
    wsOf("c", "", proposalOf("c"))
  );
  assert.deepEqual(idsOf(wsSwitcherItemsOf(sameName, "c")), ["b", "a"], "同名星座按 id 兜底排序（a < b），焦点在首位时左槽环绕到 b");
  assert.equal(wsSwitcherItemsOf(sameName, "c")[0].name, "Same", "显示名取星座名");
  const emptyNameItems = wsSwitcherItemsOf(sceneWith(
    wsOf("blank", "", proposalOf("blank")),
    wsOf("z", "Zulu", proposalOf("z"))
  ), "blank");
  assert.deepEqual(idsOf(emptyNameItems), ["z"], "空名星座参与排序（按 id）且自身不因空名报错");
  assert.deepEqual(wsSwitcherItemsOf(sceneWith(
    wsOf("m", "M", proposalOf("m")),
    wsOf("n", "", proposalOf("n"))
  ), "m").map((item) => item.name), ["n"], "空名条目显示名回落 id");

  /* ⑤ focusWsId 容错 / 当前不在可切换环上（缺失 / 未命中 / 无提案星胚）→ 可切换清单自身成环降级。 */
  const fallback = wsSwitcherItemsOf(ring5, "missing");
  assert.deepEqual(idsOf(fallback), ["proto", "alpha"], "未命中当前 id → 可切换清单自身成环（右首 Alpha、左末 Proto）");
  assert.equal(sideOf(fallback, "alpha"), "right", "降级环右槽 = 字典序首个可切换星座");
  assert.equal(sideOf(fallback, "proto"), "left", "降级环左槽 = 字典序末个可切换星座");
  assert.deepEqual(idsOf(wsSwitcherItemsOf(ring5, "nebula")), ["proto", "alpha"], "当前星座仅星云（不在环上）→ 同一降级路径");
  assert.deepEqual(idsOf(wsSwitcherItemsOf(ring5, null)), ["proto", "alpha"], "缺失当前 id → 不抛错，走降级环");
  assert.deepEqual(idsOf(wsSwitcherItemsOf(ring5, undefined)), ["proto", "alpha"], "undefined 当前 id → 不抛错");
  const fallbackPair = wsSwitcherItemsOf(sceneWith(wsOf("a", "Alpha", proposalOf("a"))), "missing");
  assert.deepEqual(idsOf(fallbackPair), ["a"], "降级环恰 1 个可切换星座 → 单条目落右槽");
  assert.equal(sideOf(fallbackPair, "a"), "right", "降级单条目仍落右槽");

  /* ⑥ 入参形态容错：裸数组 / 空场景 / null / 非法项；输入数组不被排序就地改写（纯函数）。 */
  const bare = [wsOf("a", "Alpha", proposalOf("a")), wsOf("b", "Bravo", proposalOf("b"))];
  const bareCopy = bare.map((item) => item.id);
  assert.deepEqual(idsOf(wsSwitcherItemsOf(bare, "a")), ["b"], "兼容裸数组场景（无 {ws} 包装）");
  assert.deepEqual(bare.map((item) => item.id), bareCopy, "纯函数不就地改写输入数组（排序在副本上）");
  assert.deepEqual(wsSwitcherItemsOf({ ws: [] }, "a"), [], "空场景 → []");
  assert.deepEqual(wsSwitcherItemsOf({}, "a"), [], "缺 ws 字段 → []");
  assert.deepEqual(wsSwitcherItemsOf(null, "a"), [], "null 场景 → []（不抛错）");
  assert.deepEqual(wsSwitcherItemsOf(undefined, undefined), [], "全缺参 → []（不抛错）");
  assert.deepEqual(wsSwitcherItemsOf({ ws: [null, 3, "x", { id: "a", name: "Alpha", stars: [{}] }] }, "a"), [],
    "非法条目跳过、仅 1 个可切换星座且为当前 → []");
  assert.deepEqual(wsSwitcherItemsOf({ ws: [{ id: "a", name: "Alpha", stars: [] }, { id: "b", name: "Bravo", stars: null }] }, "a"), [],
    "stars 缺失 / 非数组按不可切换处理（SHALL NOT 抛错）");
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
  const chips = createdEls.filter((el) => String(el.className).startsWith("cos-chip") && (el.listeners.click?.length ?? 0) > 0);
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

/* ── 星座活力两态呈现（step1-add-constellation-vitality 2.1–2.3 / 3.1–3.3 / D2–D4）：
     银河视图 chip 沉睡态 class（updateOverlay 循环单点 classList.toggle）与两态状态点
     （updateChipText 的 dataset.html 差分守卫）；沉睡 chip 照常钻入；过滤淡隐 inline α
     与沉睡态叠加无侵占；钻取态标牌 cos-ws-life 随 E.focusWs 活力渲染（差分守卫 /
     实时唤醒翻转 / 银河态清空）；仅星云沉睡不触发出生高亮、空星座出生与沉睡共存；
     星座级（存在口径）与恒星级（热度口径）标识在钻取态并列可区分。 ── */
{
  /* ① 样式契约：沉睡态只动颜色属性；两态点取色与 cos-slab-life 同源令牌链。 */
  const sleepRule = /\.cos-chip\.cos-chip-sleep \{([^}]*)\}/.exec(ENGINE_CSS);
  const sleepTextRule = /\.cos-chip\.cos-chip-sleep b \{([^}]*)\}/.exec(ENGINE_CSS);
  const chipLifeActive = /\.cos-chip-life\.active \{([^}]*)\}/.exec(ENGINE_CSS);
  const chipLifeSleep = /\.cos-chip-life\.sleep \{([^}]*)\}/.exec(ENGINE_CSS);
  const wsLifeRule = /\.cos-ws-life \{([^}]*)\}/.exec(ENGINE_CSS);
  const wsLifeActive = /\.cos-ws-life\.active \{([^}]*)\}/.exec(ENGINE_CSS);
  const wsLifeSleep = /\.cos-ws-life\.sleep \{([^}]*)\}/.exec(ENGINE_CSS);
  assert.ok(sleepRule && /border-color/.test(sleepRule[1]), "ENGINE_CSS 含沉睡 chip 描边降 alpha 规则");
  assert.ok(!/opacity|transform/.test(sleepRule[1]), "沉睡态规则 MUST NOT 声明 opacity/transform（逐帧动画面不被侵占）");
  assert.ok(sleepTextRule && /filter: grayscale/.test(sleepTextRule[1]) && /opacity/.test(sleepTextRule[1]),
    "沉睡态名称降饱和 + 降亮度（作用于 b，非 chip 本体）");
  assert.ok(chipLifeActive && chipLifeActive[1].includes("var(--dsw-alias-state-warn-primary, var(--cos-waiting, #ffaa4a))"),
    "chip 活跃点取活力琥珀令牌链（与 cos-slab-life 同源）");
  assert.ok(chipLifeSleep && chipLifeSleep[1].includes("var(--cos-ink-dim"), "chip 沉睡点取暗淡墨色令牌（非固定直量灰）");
  assert.ok(wsLifeRule && /font-size: 9px/.test(wsLifeRule[1]) && !/text-shadow: 0 0/.test(wsLifeRule[1]),
    "标牌活动标识按标牌字号语境缩放、不继承星座名辉光");
  assert.ok(wsLifeActive && wsLifeActive[1].includes("var(--dsw-alias-state-warn-primary"), "标牌活跃点与恒星级标识同源令牌链");
  assert.ok(wsLifeSleep && wsLifeSleep[1].includes("var(--cos-ink-dim"), "标牌沉睡点与恒星级标识同源令牌链");

  const container = stubEl("div");
  const eng = createCosmosEngine({ container, style: createSkinD() });
  const rootEl = container.children[0];
  const overlayEl = rootEl._by[".cos-overlay"];
  const badgeEl = rootEl._by[".cos-badge"];
  const wsOf = (id, over) => ({
    id, name: id, pos: [0, 0, 0], stars: [], links: [], planets: [], comets: [],
    archives: 0, satelliteCount: 0, ...over
  });
  const star = (id, lifecycle = "created") => ({
    id, name: id, lifecycle, setBy: null, at: null, tasks: [1, 2], age: "刚刚", act: 0, off: [0, 0, 0]
  });
  const planet = (id) => ({
    id, title: id, state: "idle", pendingKind: null, stars: [], todos: "—", when: "刚刚",
    satellites: [], satelliteCount: 0, delegatedBusy: false
  });
  const comet = (id) => ({
    id, title: id, state: "idle", pendingKind: null, when: "刚刚", satellites: [], satelliteCount: 0, delegatedBusy: false
  });
  const baseWs = () => [
    wsOf("ws-active", { stars: [star("st-a")] }),
    wsOf("ws-proto", { stars: [star("st-p", "proto")] }),
    wsOf("ws-planet", { planets: [planet("p-1")] }),
    wsOf("ws-comet", { comets: [comet("c-1")] }),
    wsOf("ws-nebula", { archives: 2 }),
    wsOf("ws-empty", {}),
    wsOf("ws-orphan", { satelliteCount: 2 })
  ];
  const sceneWith = (over = {}) => ({
    workspaces: baseWs().map((w) => ({ ...w, ...(over[w.id] || {}) }))
  });
  const chipOf = (id) => overlayEl.children.find((el) =>
    String(el.className).startsWith("cos-chip") && String(el.dataset.html).includes("<b>" + id + "<"));

  eng.setScene(sceneWith(), "rebuild");
  rafQ.length = 0;
  eng.start();
  let tNow = 30000;
  const step1 = (n = 1) => { for (let i = 0; i < n; i++) { tNow += 50; stepFrame(tNow); } };
  step1(30); // 过冷启动序曲 + 至少一帧 class 单点 toggle

  /* ② 判据驱动：四个活跃星座 chip 无沉睡态；星云-only / 全空 / 孤儿卫星-only 三个沉睡。 */
  for (const id of ["ws-active", "ws-proto", "ws-planet", "ws-comet"]) {
    const el = chipOf(id);
    assert.ok(el, id + "：chip 已创建");
    assert.ok(!String(el.className).includes("cos-chip-sleep"), id + "：活跃星座 chip MUST NOT 呈沉睡态");
    assert.ok(String(el.dataset.html).includes("cos-chip-life active"), id + "：活跃状态点亮琥珀");
    assert.ok(!String(el.dataset.html).includes("cos-chip-life sleep"), id + "：活跃状态点无沉睡类");
  }
  for (const id of ["ws-nebula", "ws-empty", "ws-orphan"]) {
    const el = chipOf(id);
    assert.ok(el, id + "：chip 已创建");
    assert.ok(String(el.className).includes("cos-chip-sleep"), id + "：沉睡星座 chip 附加 cos-chip-sleep");
    assert.ok(String(el.dataset.html).includes("cos-chip-life sleep"), id + "：沉睡状态点呈灰");
  }
  assert.ok(String(chipOf("ws-nebula").innerHTML).includes("ws-nebula"), "仅星云星座 chip 照常呈现（历史不隐藏）");

  /* ③ 内容差分守卫：活力未翻转 → 不重写 innerHTML；同名同态 patch 零重写。 */
  const nebulaChip = chipOf("ws-nebula");
  nebulaChip.innerHTML = "MARKER";
  eng.setScene(sceneWith(), "patch");
  step1(1);
  assert.equal(nebulaChip.innerHTML, "MARKER", "活力未变 → chip 内容零重写（dataset.html 差分守卫生效）");
  nebulaChip.innerHTML = String(nebulaChip.dataset.html);

  /* ④ 活力翻转：沉睡 ⇄ 活跃在同一 chip DOM 上收敛（rebuild 差分 + 下一帧 class toggle）。 */
  eng.setScene(sceneWith({ "ws-nebula": { stars: [star("st-n")] } }), "rebuild");
  step1(1);
  assert.equal(chipOf("ws-nebula"), nebulaChip, "rebuild 复用既有 chip DOM（增量对齐，不整表重建）");
  assert.ok(!String(nebulaChip.className).includes("cos-chip-sleep"), "沉睡 → 活跃：沉睡 class 退场");
  assert.ok(String(nebulaChip.dataset.html).includes("cos-chip-life active"), "沉睡 → 活跃：状态点换串重写");
  assert.equal(nebulaChip.dataset.html, String(nebulaChip.innerHTML), "内容守卫值与 DOM 同源");
  eng.setScene(sceneWith(), "rebuild");
  step1(1);
  assert.ok(String(nebulaChip.className).includes("cos-chip-sleep"), "活跃 → 沉睡：沉睡 class 翻回");

  /* ⑤ 过滤淡隐 α（逐帧 inline opacity）与沉睡态（色彩层）叠加不互侵占。 */
  eng.setFilter(new Set(["ws-active"]), new Map([["ws-active", [0, 0, 0]]]));
  step1(2); // FILTER_RAMP_DUR(0.35s) 坡道中
  const dimSleepChip = chipOf("ws-empty");
  assert.ok(String(dimSleepChip.className).includes("cos-chip-sleep"), "过滤期间沉睡态保持（α 通道不清 class）");
  const alphaStr = String(dimSleepChip.style.opacity);
  assert.ok(alphaStr !== "" && Number(alphaStr) < 1, "未匹配星座写入逐帧 inline α（与沉睡态相乘）");
  assert.equal(eng.setFilter(new Set(), new Map()), true, "清空过滤");
  step1(12); // 坡道回满

  /* ⑥ 出生高亮 × 活力：空星座 = 沉睡 ∩ 无星云；仅星云沉睡 MUST NOT 触发出生高亮。 */
  eng.markWsBirth("ws-nebula");
  eng.markWsBirth("ws-empty");
  eng.setScene(sceneWith(), "rebuild");
  step1(1);
  assert.ok(!String(chipOf("ws-nebula").className).includes("cos-chip-new"),
    "仅星云的沉睡星座 MUST NOT 触发出生高亮（D6：空星座 = 沉睡 ∩ 无星云）");
  assert.ok(String(chipOf("ws-nebula").className).includes("cos-chip-sleep"), "仅星云星座仍呈沉睡态");
  assert.ok(String(chipOf("ws-empty").className).includes("cos-chip-new"), "空星座出生高亮照常");
  assert.ok(String(chipOf("ws-empty").className).includes("cos-chip-sleep"),
    "出生高亮与沉睡态共存（animation 优先级压过沉睡描边，无互斥逻辑）");

  /* ⑦ 沉睡 chip 照常钻入；钻取标牌呈星座级沉睡标识（点 + 文案）。 */
  const divesBefore = eng.inspectInput().dives;
  for (const fn of chipOf("ws-nebula").listeners.click ?? []) fn({});
  assert.equal(eng.inspectInput().dives, divesBefore + 1, "沉睡 chip 点击照常触发 dive（活力态不阻断钻取）");
  assert.equal(eng.inspectFilter().focus.diving, true, "沉睡星座可进入钻取态");
  fakeNow += 1300;
  step1(2);
  assert.ok(String(badgeEl.dataset.html).includes("cos-ws-life sleep"), "钻取标牌：沉睡星座灰点标识");
  assert.ok(String(badgeEl.dataset.html).includes("沉睡"), "标牌文案取 E.labels.vitality（沉睡）");
  assert.ok(/✦0 ●0 ◇0 ☄0 ☁2/.test(String(badgeEl.innerHTML)), "标牌计数仪表行不变（星云照常呈现 ☁2）");

  /* 差分守卫：内容不变零重写。 */
  const badgeHtml = String(badgeEl.innerHTML);
  badgeEl.innerHTML = "MARKER";
  step1(1);
  assert.equal(badgeEl.innerHTML, "MARKER", "标牌内容未变 → 零重写（dataset.html 守卫生效）");
  badgeEl.innerHTML = badgeHtml;

  /* ⑧ 实时唤醒：沉睡星座出现首个恒星（SSE 增量 → rebuild）→ 标牌标识翻转，无需整页刷新。 */
  eng.setScene(sceneWith({ "ws-nebula": { stars: [star("st-n")] } }), "rebuild");
  step1(1);
  assert.ok(String(badgeEl.dataset.html).includes("cos-ws-life active") && String(badgeEl.dataset.html).includes("活跃"),
    "唤醒后标牌翻转为活跃态（dataset.html 换串重写）");
  assert.ok(/✦1 ●0 ◇0 ☄0 ☁2/.test(String(badgeEl.innerHTML)), "唤醒后计数行随场景增量更新");

  /* ⑨ 银河态标牌隐藏路径：Esc 飞回 → 标牌清空，活力标识随之移除。 */
  assert.equal(eng.consumeEscape(), true, "Esc 飞回银河");
  fakeNow += 1300;
  step1(2);
  assert.equal(String(badgeEl.dataset.html), "", "银河态标牌清空（dataset.html 守卫值为空串）");
  assert.equal(String(badgeEl.innerHTML), "", "银河态无活力标识残留");

  /* ⑩ 与恒星级活力可区分（spec scenario）：钻取活跃星座 → 标牌活跃（存在口径），
     选中 act=0 恒星 → 名牌沉睡（热度口径）；两标识不同类、并列不混淆。 */
  assert.equal(eng.diveToWs("ws-active"), true, "钻取活跃星座");
  fakeNow += 1300;
  step1(2);
  assert.ok(String(badgeEl.dataset.html).includes("cos-ws-life active") && String(badgeEl.dataset.html).includes("活跃"),
    "活跃星座标牌：琥珀点 + 「活跃」");
  assert.ok(/✦1 ●0 ◇0 ☄0 ☁0/.test(String(badgeEl.innerHTML)), "活跃星座计数行不变");
  assert.equal(eng.focusStar("ws-active", "st-a"), true, "选中 act=0 恒星（名牌活力标识并列观察）");
  step1(2);
  const starSlab = overlayEl.children.find((el) =>
    String(el.className).startsWith("cos-slab") && String(el.dataset.html).includes("cos-slab-life"));
  assert.ok(starSlab && String(starSlab.dataset.html).includes("cos-slab-life sleep"),
    "恒星名牌按热度口径呈沉睡（act=0）");
  assert.ok(String(badgeEl.dataset.html).includes("cos-ws-life active"),
    "同屏标牌按存在口径呈活跃——两层标识判据不同、类名不同（可区分）");
  assert.ok(!String(badgeEl.dataset.html).includes("cos-slab-life"), "标牌不混用恒星级标识类");

  eng.stop();
  eng.dispose();
}

/* ── 钻取态可切换星座切换条目（step2-add-constellation-switcher 3.1–3.3 / D2–D6）：
      DOM 常驻节点 + 内容差分 / 显隐随钻取态 / 仅会话星座不入列（降级环）/ 边界档位（0/1/≥2）/
      实时进出清单（rebuild 路径）/ 重命名 patch 就地刷新 / 条目 click → diveToWs 同源（目标与
      补间、连点 retarget）/ 手势抑制 / 容器级缩放覆盖（条目上滚轮无死区）/ 无视搜索过滤 /
      过滤排除当前星座 flyOut 后整体退场。 ── */
{
  const container = stubEl("div");
  const eng = createCosmosEngine({ container, style: createSkinD() });
  const rootEl = container.children[0];
  const canvasEl = rootEl._by[".cos-canvas"];
  const leftSide = rootEl._by['.cos-wsbar-side[data-side="left"]'];
  const rightSide = rootEl._by['.cos-wsbar-side[data-side="right"]'];
  assert.equal(leftSide.children.length, 1, "左条目槽在 ensureDom 建一个常驻条目节点（MUST NOT 逐帧重建）");
  assert.equal(rightSide.children.length, 1, "右条目槽在 ensureDom 建一个常驻条目节点");
  const leftItem = leftSide.children[0];
  const rightItem = rightSide.children[0];
  assert.equal(leftItem.className, "cos-wsbar-item", "条目节点类名（HUD 样式挂点）");
  assert.equal(leftItem.disabled, true, "未挂载条目 disabled（键盘不可达）");
  const fire = (el, type, ev) => { for (const fn of el.listeners[type] ?? []) fn(ev); };
  const activeOf = (id, name, pos) => ({
    id, name, pos,
    stars: [{ id: id + "-s", name: id + "-s", lifecycle: "created", setBy: null, at: null, tasks: [1, 1], age: "刚刚", act: 0, off: [0, 0, 0] }],
    links: [], planets: [], comets: [], archives: 0, satelliteCount: 0
  });
  const asleepOf = (id, name, pos) => ({
    id, name, pos, stars: [], links: [], planets: [], comets: [], archives: 0, satelliteCount: 0
  });
  /* 仅会话星座（行星 + 彗星、无提案/星胚）：step1 活力为活跃，但切换清单 MUST NOT 入列。 */
  const sessionsOf = (id, name, pos) => ({
    id, name, pos, stars: [], links: [],
    planets: [{ id: id + "-p", title: id + "-p", state: "idle", pendingKind: null, stars: [], todos: "—", when: "刚刚", satellites: [], satelliteCount: 0, delegatedBusy: false }],
    comets: [{ id: id + "-c", title: id + "-c", state: "idle", pendingKind: null, when: "刚刚", satellites: [], satelliteCount: 0, delegatedBusy: false }],
    archives: 0, satelliteCount: 0
  });
  const ringScene = (over = {}) => ({
    workspaces: [
      activeOf("cur", "Current", [0, 0, 0]),
      activeOf("alpha", "Alpha", [120, 0, 0]),
      activeOf("bravo", "Bravo", [0, 120, 0]),
      activeOf("charlie", "Charlie", [0, -120, 0]),
      sessionsOf("sessions", "Sessions", [0, 0, -200]),
      asleepOf("nebula", "Nebula", [-120, 0, 0])
    ].map((ws) => ({ ...ws, ...(over[ws.id] || {}) }))
  });
  eng.setScene(ringScene(), "rebuild");
  rafQ.length = 0;
  eng.start();
  let tNow = 60000;
  const step1 = (n = 1) => { for (let i = 0; i < n; i++) { tNow += 50; stepFrame(tNow); } };
  step1(30); // 过冷启动序曲 + 至少一帧差分维护

  /* ① 银河态零呈现（显隐随钻取态）。 */
  assert.ok(!leftItem.classList.contains("on") && !rightItem.classList.contains("on"), "银河态条目退场（零布局呈现）");
  assert.equal(String(leftItem.innerHTML), "", "银河态条目零内容");

  /* ①′ 仅会话星座不入列（需求调整）：可钻入、step1 活力仍活跃，但无提案/星胚 → 不占环位；
        当前不在可切换环上时以可切换清单自身成环降级（左末 Current / 右首 Alpha）。 */
  assert.equal(eng.diveToWs("sessions"), true, "钻取仅会话星座（钻取入口不受判据影响）");
  fakeNow += 1300;
  step1(2);
  assert.equal(eng.inspectFilter().focus.id, "sessions", "钻取态成立（仅会话星座）");
  step1(1);
  assert.ok(String(leftItem.innerHTML).includes("Current"), "仅会话当前：降级环左槽 = 字典序末位 Current");
  assert.ok(String(rightItem.innerHTML).includes("Alpha"), "仅会话当前：降级环右槽 = 字典序首位 Alpha");
  assert.ok(!String(leftItem.innerHTML).includes("Sessions") && !String(rightItem.innerHTML).includes("Sessions"),
    "清单 MUST NOT 含仅会话星座自身（即使它是当前星座）");
  assert.equal(eng.consumeEscape(), true, "Esc 飞回银河");
  fakeNow += 1300;
  step1(2);

  /* ② 钻取 cur → 左 Charlie（前驱）/ 右 Alpha（后继）；内容含活跃状态点。 */
  assert.equal(eng.diveToWs("cur"), true, "钻取当前星座");
  fakeNow += 1300;
  step1(2);
  assert.equal(eng.inspectFilter().focus.diving, true, "钻取态成立");
  assert.ok(leftItem.classList.contains("on"), "左槽条目 .on 挂载（淡入）");
  assert.ok(String(leftItem.innerHTML).includes("Charlie") && String(leftItem.innerHTML).includes("<i></i>"),
    "左槽 = 环上前驱 Charlie（星座名 + 活跃状态点）");
  assert.equal(leftItem.dataset.ws, "charlie", "左槽目标写入 dataset（观测钩子）");
  assert.ok(rightItem.classList.contains("on") && String(rightItem.innerHTML).includes("Alpha"), "右槽 = 环上后继 Alpha");
  assert.equal(rightItem.dataset.ws, "alpha", "右槽目标写入 dataset");
  assert.equal(leftItem.disabled, false, "挂载条目恢复可点");

  /* ③ 内容差分守卫：场景/活力未变 → 零重写（dataset.html 同款纪律）。 */
  leftItem.innerHTML = "MARKER";
  step1(1);
  assert.equal(leftItem.innerHTML, "MARKER", "条目内容未变 → 零重写（dataset.html 差分守卫生效）");
  leftItem.innerHTML = String(leftItem.dataset.html);

  /* ④ 实时进出清单（SSE 增量 → rebuild）：星云沉睡星座被唤醒（出现首个恒星）→ 进入环绕序；
        再度沉睡 → 条目淡出、满 0.25s 清内容（环绕序即时收敛）。 */
  eng.setScene(ringScene({ nebula: activeOf("nebula", "Nebula", [-120, 0, 0]) }), "rebuild");
  step1(1);
  assert.ok(String(rightItem.innerHTML).includes("Nebula"), "星座唤醒：进入环上后继（右槽实时换串，无整页刷新）");
  assert.equal(rightItem.dataset.ws, "nebula", "唤醒后右槽目标 = nebula");
  assert.ok(leftItem.classList.contains("on") && String(leftItem.innerHTML).includes("Charlie"), "唤醒不扰动另一侧条目");
  eng.setScene(ringScene(), "rebuild");
  step1(1);
  assert.ok(String(rightItem.innerHTML).includes("Alpha") && rightItem.dataset.ws === "alpha", "星座沉睡：环绕序回退（右槽回到 Alpha）");

  /* ⑤ 重命名 patch 就地刷新（同一节点，目标 id 不变）。 */
  const renamed = ringScene();
  renamed.workspaces[3].name = "Cobra";
  eng.setScene(renamed, "patch");
  step1(1);
  assert.ok(String(leftItem.innerHTML).includes("Cobra"), "重命名经 patch 就地刷新条目内容（节点复用不重建）");
  assert.equal(leftItem.dataset.ws, "charlie", "仅名称刷新，目标 id 不变");

  /* ⑥ 飞回银河：条目淡出退场，满窗后零内容（槽宽由固定宽保留，布局不塌）。 */
  assert.equal(eng.consumeEscape(), true, "Esc 飞回银河");
  fakeNow += 1300;
  step1(2);
  assert.ok(!leftItem.classList.contains("on") && !rightItem.classList.contains("on"), "飞回银河：条目 .on 摘除（切换器随钻取态整体退场）");
  step1(6); // > WS_SWITCH_FADE（0.25s）
  assert.equal(String(leftItem.innerHTML), "", "飞回银河：淡出满窗后条目清内容（零残留）");

  /* ⑦ 边界档位：活跃恰 2 个 → 单条目落右槽、左槽留空（去重，MUST NOT 两侧同显）。 */
  const pair = () => ({
    workspaces: [
      activeOf("cur", "Current", [0, 0, 0]),
      activeOf("alpha", "Alpha", [120, 0, 0]),
      asleepOf("nebula", "Nebula", [-120, 0, 0])
    ]
  });
  eng.setScene(pair(), "rebuild");
  step1(1);
  assert.equal(eng.diveToWs("cur"), true, "钻取 current（活跃恰 2 个）");
  fakeNow += 1300;
  step1(2);
  assert.ok(!leftItem.classList.contains("on"), "2 个可切换星座：左槽留空（前驱 = 后继去重）");
  assert.equal(String(leftItem.innerHTML), "", "2 个可切换星座：左槽零内容");
  assert.ok(rightItem.classList.contains("on") && String(rightItem.innerHTML).includes("Alpha"), "2 个可切换星座：单条目落右槽");

  /* ⑧ 条目点击换座（diveToWs 同源）：目标 / 补间语义 / 连点 retarget 无跳变。 */
  const divesBeforeClick = eng.inspectInput().dives;
  fire(rightItem, "click", {});
  assert.equal(eng.inspectInput().dives, divesBeforeClick + 1, "条目 click 触发单次 dive（无重复）");
  assert.equal(eng.inspectFilter().focus.id, "alpha", "条目 click 钻取到目标星座");
  const clickTween = eng.inspectFilter().tween;
  assert.ok(clickTween && clickTween.mode === "in" && clickTween.dur === 1300, "继承 dive 补间语义（1300ms，与 chip 点击同律）");
  assert.deepEqual(clickTween.to.target, [120, 0, 0], "补间目标 = 目标星座中心（非当前星座）");
  step1(1); // 一帧后环绕序收敛：焦点 alpha → 右槽 = 前焦点 Current
  assert.ok(String(rightItem.innerHTML).includes("Current") && rightItem.dataset.ws === "cur",
    "换座后环绕序即刻收敛（右槽 = Current）");
  fakeNow += 100; // 补间进行中
  const midTweenFrom = eng.inspectFilter().camera.target.slice();
  const divesMid = eng.inspectInput().dives;
  fire(rightItem, "click", {});
  assert.equal(eng.inspectInput().dives, divesMid + 1, "连点：新 dive 单次触发");
  assert.equal(eng.inspectFilter().focus.id, "cur", "连点 retarget 到新目标星座");
  const reTween = eng.inspectFilter().tween;
  assert.deepEqual(reTween.to.target, [0, 0, 0], "retarget 补间目标 = 新目标中心");
  assert.deepEqual(eng.inspectFilter().camera.target, midTweenFrom, "retarget 当下镜头不跳变（从在途位置续接）");
  assert.equal(reTween.mode, "in", "retarget 仍走钻取补间（零新增状态转移）");

  /* ⑨ 容器级缩放覆盖：条目上滚轮照常生效（无缩放死区；容器级绑定不区分覆盖元素）。 */
  const distBeforeWheel = eng.inspectFilter().camera.dist;
  fire(rootEl, "wheel", { preventDefault() {}, deltaY: -120, target: rightItem });
  assert.ok(eng.inspectFilter().camera.dist < distBeforeWheel, "条目上滚轮放大生效（容器级绑定覆盖，无缩放死区）");

  /* ⑩ 多指手势期点击抑制（与 chip 同款判据）：手势中与抑制窗内均不换座，窗过恢复。 */
  const down = (id, x, y) => fire(rootEl, "pointerdown", { pointerId: id, button: 0, clientX: x, clientY: y, target: canvasEl, preventDefault() {} });
  const up = (id) => fire(rootEl, "pointerup", { pointerId: id, button: 0, target: canvasEl });
  eng.diveToWs("cur"); // 回到钻取态（上一步 retarget 后焦点为 cur；此处确保焦点星座确定）
  fakeNow += 1300;
  step1(2);
  const divesBeforeGesture = eng.inspectInput().dives;
  down(11, 300, 300);
  down(12, 340, 300);
  assert.equal(eng.inspectInput().gesture, true, "双指手势激活");
  fire(rightItem, "click", {});
  assert.equal(eng.inspectInput().dives, divesBeforeGesture, "手势期条目点击被抑制（不误触换座）");
  up(12);
  up(11);
  assert.equal(eng.inspectInput().gesture, false, "手势结束");
  assert.equal(eng.inspectInput().suppressed, true, "进入 GESTURE_SUPPRESS_MS 抑制窗");
  fire(rightItem, "click", {});
  assert.equal(eng.inspectInput().dives, divesBeforeGesture, "抑制窗内条目点击仍被抑制");
  fakeNow += GESTURE_SUPPRESS_MS + 1;
  assert.equal(eng.inspectInput().suppressed, false, "抑制窗过期（350ms 后恢复）");
  fire(rightItem, "click", {});
  assert.equal(eng.inspectInput().dives, divesBeforeGesture + 1, "抑制窗过期后条目点击恢复换座（单次）");

  /* ⑪ 搜索过滤：导航铬件——命中集变化不改变条目清单；过滤排除当前星座 → 自动飞回、切换器退场。 */
  fakeNow += 1300;
  step1(2);
  assert.equal(eng.inspectFilter().focus.id, "alpha", "条目换座落地（焦点 = 目标星座）");
  const filterTargetsBefore = [leftItem.dataset.ws, rightItem.dataset.ws];
  const filterHtmlBefore = String(rightItem.innerHTML);
  eng.setFilter(new Set(["bravo", "alpha"]), new Map([["bravo", [0, 120, 0]], ["alpha", [120, 0, 0]]]));
  step1(1);
  assert.deepEqual([leftItem.dataset.ws, rightItem.dataset.ws], filterTargetsBefore, "过滤命中集变化：条目目标不变（MUST NOT 求交集）");
  assert.equal(String(rightItem.innerHTML), filterHtmlBefore, "过滤激活：条目内容零重写（差分守卫 + 无命中过滤）");
  assert.ok(rightItem.classList.contains("on"), "过滤激活不隐藏条目（导航铬件）");
  assert.equal(eng.inspectFilter().focus.id, "alpha", "命中集含当前星座 → 钻取态保持（不飞回）");
  eng.setFilter(new Set(["bravo"]), new Map([["bravo", [0, 120, 0]]]));
  assert.equal(eng.inspectFilter().tween.mode, "out", "过滤排除当前星座 → 引擎裁决自动飞回（flyOut）");
  fakeNow += 1300;
  step1(2);
  assert.equal(eng.inspectFilter().focus.diving, false, "飞回银河：钻取态退场");
  assert.ok(!leftItem.classList.contains("on") && !rightItem.classList.contains("on"), "切换器随钻取态整体退场（条目 .on 摘除）");
  step1(6);
  assert.equal(String(leftItem.innerHTML), "", "退场后条目零内容");
  assert.equal(eng.setFilter(new Set(), new Map()), true, "清空过滤（收尾）");

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
  const slab = overlayEl.children.find((el) => String(el.className).startsWith("cos-slab"));
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
  const wsbarEl = rootEl._by[".cos-wsbar"];
  const badgeClusterEl = rootEl._by[".cos-badge-cluster"];
  const cardEl = rootEl._by[".cos-card"];
  assert.ok(chip && homeBtn && badgeEl && wsbarEl && badgeClusterEl, "覆盖层元素齐备（chip / 回到银河 / 星座标牌 / 切换条目容器 / 右上标牌组）");
  assert.ok(rootEl._by['.cos-wsbar-tools[data-side="left"]'] && rootEl._by['.cos-wsbar-tools[data-side="right"]'], "顶部模板工具左右槽已建（add-cosmos-template-reassign 返工）");
  assert.equal(badgeClusterEl.dataset.drilled, "false", "银河态 data-drilled=false（模板工具零呈现）");

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
  assert.ok(markup.includes("cos-canvas") && markup.includes("cos-wsbar") && markup.includes('class="cos-badge"') && markup.includes("cos-badge-cluster"), "ensureDom 产物含 canvas、切换条目容器、右上标牌组与星座标牌");
  const wsbarLeftAt = markup.indexOf('cos-wsbar-side" data-side="left"');
  const wsbarRightAt = markup.indexOf('cos-wsbar-side" data-side="right"');
  assert.ok(wsbarLeftAt >= 0 && wsbarLeftAt < wsbarRightAt, "顶部中央容器 DOM 顺序 [左条目槽][右条目槽]（切换条目成对）");
  const clusterAt = markup.indexOf("cos-badge-cluster");
  const badgeAt = markup.indexOf('class="cos-badge"');
  const toolLeftAt = markup.indexOf('cos-wsbar-tools" data-side="left"');
  const toolRightAt = markup.indexOf('cos-wsbar-tools" data-side="right"');
  assert.ok(clusterAt >= 0 && clusterAt < badgeAt && badgeAt < toolLeftAt && toolLeftAt < toolRightAt,
    "右上标牌组 DOM 顺序 [星座标牌][指定模板][随机重掷]（名称在左、方形图标在右）");
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

  /* 右键：屏蔽原生菜单，且 MUST NOT 触发拾取/dive（此前 pointerup 会误 dive）。
     add-cosmos-rightdrag-pan：鼠标右键在 canvas 起手改为捕获指针（右键拖拽越界不中断，
     D6）；覆盖元素起手仍不捕获（下方「右键拖拽平移」分组覆盖）。 */
  let ctxPrevented = false;
  fire(rootEl, "contextmenu", { preventDefault() { ctxPrevented = true; } });
  assert.equal(ctxPrevented, true, "容器级 contextmenu 屏蔽浏览器原生右键菜单");
  capCalls.length = 0;
  const divesBeforeRight = input().dives;
  fire(rootEl, "pointerdown", { pointerId: 7, button: 2, clientX: hitPt.x, clientY: hitPt.y, pointerType: "mouse", target: canvasEl, preventDefault() {} });
  assert.deepEqual(capCalls, [7], "鼠标右键 canvas 起手捕获指针（右键拖拽越界不中断，D6）");
  fire(rootEl, "pointerup", { pointerId: 7, button: 2, clientX: hitPt.x, clientY: hitPt.y, pointerType: "mouse", target: canvasEl });
  assert.equal(input().dives, divesBeforeRight, "右键抬指不触发拾取/dive");
  assert.equal(input().pointers, 0, "右键不遗留指针追踪（防下一次单指误判捏合）");
  assert.equal(input().rdrag, false, "右键点按（无位移）不进入右键拖拽态");

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
  assert.equal(badgeClusterEl.dataset.drilled, "true", "钻取态 data-drilled=true（顶部模板工具呈现）");
  assert.ok(String(badgeEl.dataset.html).includes("ws-one"), "标牌含星座名（dataset.html 守卫值已写）");
  assert.ok(String(badgeEl.innerHTML).includes("ws-one"), "标牌渲染星座名");
  assert.ok(/✦1 ●1 ◇0 ☄1 ☁0/.test(String(badgeEl.innerHTML)), "标牌含全量计数仪表 ✦●◇☄☁");
  /* 标牌定位口径（step2-add-constellation-switcher D1：定位/限宽职责移交行容器 `.cos-wsbar`，
     标牌改行内中央格——视觉样式与文本居中不变，几何承诺等价迁移） */
  assert.ok(/\.cos-wsbar \{[^}]*left: 50%; transform: translateX\(-50%\)/.test(ENGINE_CSS), "行容器承接水平居中（left:50% + translateX(-50%)，顶部中央锚点）");
  assert.ok(/\.cos-badge \{[^}]*text-align: right/.test(ENGINE_CSS), "标牌随右上角组右对齐排版（名称 + 计数两行）");
  assert.ok(/\.cos-badge \{[^}]*max-width: min\(480px, 40vw\)/.test(ENGINE_CSS), "标牌上限收敛（右上角组 40vw，避免压住中心切换条目）");
  assert.ok(!/\.cos-badge \{[^}]*position: absolute/.test(ENGINE_CSS), "标牌不再绝对定位（中央格参与 flex 布局）");
  assert.ok(!/\.cos-badge \{[^}]*calc\(100% - 470px\)/.test(ENGINE_CSS), "标牌不挂百分比限宽（基准双重折减防护）");
  assert.ok(/\.cos-wsbar \{[^}]*max-width: max\(160px, min\(844px, calc\(100% - 470px\)\)\)/.test(ENGINE_CSS), "行容器限宽避让左面板（187px）与右缘（470 = 2×(187+48)），160px 下限兜底页面宽度不足");
  assert.ok(ENGINE_CSS.includes("@media (max-width: 520px) { .cos-wsbar { max-width: calc(100% - 40px); }") && ENGINE_CSS.includes(".cos-wsbar-side { display: none; }"), "窄视口（<520px）断点：容器放宽 + 条目槽隐藏（触屏仍有 chip / 搜索路径）");
  assert.ok(/\.cos-badge-cluster \{[^}]*position: absolute; top: 14px; right: 16px/.test(ENGINE_CSS), "标牌组（名称 + 两枚工具）固定右上角（top:14 / right:16）");
  assert.ok(ENGINE_CSS.includes('.cos-badge-cluster[data-drilled="true"] { display: flex; }'), "标牌组仅钻取态 display:flex（银河态整体零呈现）");
  assert.ok(/\.cos-wsbar-tools \{[^}]*width: var\(--cos-ws-tool-size, 32px\);[^}]*height: var\(--cos-ws-tool-size, 32px\)/.test(ENGINE_CSS), "工具槽方形（宽 = 高 = wsToolSize）");
  assert.ok(ENGINE_CSS.includes('.cos-wsbar { position: absolute; top: 14px; left: 50%; transform: translateX(-50%)'), "切换条目容器仍在顶部中央（不被右上标牌组侵占）");
  badgeEl.innerHTML = "MARKER";
  step1(1);
  assert.equal(badgeEl.innerHTML, "MARKER", "内容未变 → 标牌零重写（内容差分守卫生效）");

  const changed = miniScene();
  changed.workspaces[0].satelliteCount = 3;
  changed.workspaces[0].archives = 2;
  eng.setScene(changed, "patch");
  step1(1);
  assert.ok(/✦1 ●1 ◇3 ☄1 ☁2/.test(String(badgeEl.innerHTML)), "计数随场景 patch 实时更新（就地更新，不重建覆盖层）");
  assert.equal(String(chip.innerHTML), '<b>ws-one<i class="cos-chip-life active"></i></b>', "银河态 chip 只写星座名 + 星座级活力状态点（无计数行）");
  assert.ok(!String(chip.innerHTML).includes("<span>"), "银河态 chip 无计数 span");

  /* 右下「回到银河」两态（D3/4.2）：钻取态 = flyOut（与 Esc 等效）；根级 = 仅清选中不关页 */
  fire(homeBtn, "click", {});
  assert.equal(eng.inspectFilter().tween.mode, "out", "钻取态点击 → flyOut 补间（≡ Esc）");
  fakeNow += 1300;
  step1(1);
  assert.equal(eng.inspectFilter().focus.diving, false, "飞回银河：退出钻取");
  assert.equal(String(badgeEl.innerHTML), "", "回到银河后标牌清空（银河视图无标牌）");
  assert.equal(badgeClusterEl.dataset.drilled, "false", "回到银河后 data-drilled=false（顶部模板工具零呈现）");
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

/* ── 双指手势质心平移分量（add-cosmos-two-finger-pan 2.1–2.4 / 2.9）：逐帧分解为
   「质心平移 ⊕ 指距缩放」两正交分量、单源平移数学（同一纯函数同一系数）、复合输入
   两分量独立结算、反向张合近似零平移、值域端点平移照常、拖拽平移开关无关性 ── */
{
  /* 夹具：指针事件助手 + 期望 target 快照（同一纯函数、当帧 dist） */
  const mk = (homeDist, extraSettings) => {
    const mark = createdEls.length;
    const container = stubEl("div");
    const eng = createCosmosEngine({
      container, style: createSkinD(), homeDist,
      settings: { zoomPointerFocus: false, ...(extraSettings ?? {}) }
    });
    eng.setScene(zoomScene(), "rebuild");
    const rootEl = container.children[0];
    const canvasEl = rootEl._by[".cos-canvas"];
    const fire = (el, type, ev) => { for (const fn of el.listeners[type] ?? []) fn(ev); };
    return {
      eng, rootEl, canvasEl,
      cam: () => eng.getCamera(),
      input: () => eng.inspectInput(),
      created: createdEls.slice(mark),
      down: (id, x, y, target = canvasEl) => fire(rootEl, "pointerdown", { pointerId: id, button: 0, clientX: x, clientY: y, target, preventDefault() {} }),
      move: (id, x, y) => fire(rootEl, "pointermove", { pointerId: id, clientX: x, clientY: y, buttons: 1, target: canvasEl }),
      up: (id) => fire(rootEl, "pointerup", { pointerId: id, button: 0, target: canvasEl })
    };
  };
  const pannedOf = (snap, dx, dy) => {
    const c = { target: snap.target.slice(), yaw: snap.yaw, pitch: snap.pitch, dist: snap.dist };
    panCameraTargetByDrag(c, dx, dy, snap.dist);
    return c.target;
  };

  /* 2.1a 单源口径（精确）：指距不变的双指运动 → 缩放分量恒零，target 只按质心增量平移 */
  const a = mk(400);
  const a0 = a.cam();
  a.down(11, 300, 300); a.down(12, 400, 300);
  assert.equal(a.input().mode, "pinch", "第二指落下 → 双指手势（捏合缩放 ⊕ 质心平移）");
  a.move(12, 300, 400); // 绕首指旋转 90°：指距恒 100，质心 (350,300) → (300,350)
  assert.deepEqual(a.cam().target, pannedOf(a0, -50, 50), "质心增量 → 单源 panCameraTargetByDrag（同一系数口径）");
  assert.equal(a.cam().dist, a0.dist, "指距不变 → 缩放分量为零（dist 逐位不变）");
  assert.equal(a.cam().yaw, a0.yaw, "双指平移 MUST NOT 改 yaw");
  assert.equal(a.cam().pitch, a0.pitch, "双指平移 MUST NOT 改 pitch");
  a.up(12); a.up(11);

  /* 2.1b 双指同向拖动（分两帧上报）：逐帧增量式重锚；终态指距回基准 → dist 回基准 */
  a.down(21, 200, 300); a.down(22, 300, 300);
  const bStart = a.cam();
  a.move(22, 340, 300); // 质心 +20（平移）+ 指距 100→140（缩放瞬变）
  assert.deepEqual(a.cam().target, pannedOf(bStart, 20, 0), "首帧：平移分量按质心增量结算（当帧 dist 换算）");
  assert.ok(a.cam().dist < bStart.dist, "同一帧缩放分量同时生效（复合，不被平移吞没）");
  const bMid = a.cam();
  a.move(21, 240, 300); // 质心再 +20、指距回 100 → dist 回基准
  assert.deepEqual(a.cam().target, pannedOf(bMid, 20, 0), "次帧：增量式重锚继续按质心增量平移（无累积漂移）");
  assert.equal(a.cam().dist, bStart.dist, "指距回基准 → 绝对式缩放回到基准 dist");
  assert.equal(a.cam().yaw, bStart.yaw, "同向拖动不改 yaw");
  assert.equal(a.cam().pitch, bStart.pitch, "同向拖动不改 pitch");
  assert.notDeepEqual(a.cam().target, bStart.target, "双指同向拖动 → target 反向平移（星空随手移动）");
  a.up(22); a.up(21);

  /* 2.1c 换算随镜头距离缩放（比例关系断言，单源口径）：同一屏幕位移在 dist 400/800 两态严格 1:2 */
  const runPan = (homeDist) => {
    const g = mk(homeDist);
    const c0 = g.cam();
    g.down(31, 200, 300); g.down(32, 300, 300);
    g.move(32, 350, 300);
    g.move(31, 250, 300);
    g.up(32); g.up(31);
    return { d: sub3(g.cam().target, c0.target), dist: c0.dist };
  };
  const nearRun = runPan(400);
  const farRun = runPan(800);
  assert.ok(near(farRun.dist / nearRun.dist, 2, 1e-12), "两态基准视距恰 2:1");
  assert.ok(
    near(farRun.d[0] / nearRun.d[0], 2, 1e-9) && near(farRun.d[2] / nearRun.d[2], 2, 1e-9),
    "世界位移严格随 dist 比例：近距小幅、远距大幅（单源系数口径）"
  );
  assert.equal(nearRun.d[1], 0, "水平拖动不含竖直世界分量（dy=0）");

  /* 2.2 双指反向张合（质心近似不动）：dist 严格按指距比例；target 漂移仅为
     「逐帧质心增量 × dist 变化」的二阶小量（无独立平移路径、无死区参数） */
  const z = mk(400);
  const z0 = z.cam();
  z.down(41, 300, 300); z.down(42, 500, 300); // d0 = 200
  for (let i = 1; i <= 5; i++) {
    z.move(42, 500 + i * 20, 300); // 右指外移 +20
    z.move(41, 300 - i * 20, 300); // 左指对称外移 -20（每对事件后质心回中点）
  }
  const zDist = z0.dist * 200 / 400; // 终态指距 200 → 400
  assert.ok(near(z.cam().dist, zDist, 1e-9), "反向张合：dist = dist0×d0/d（指距比例，与既往捏合同式）");
  assert.equal(z.cam().yaw, z0.yaw, "反向张合不改 yaw");
  assert.equal(z.cam().pitch, z0.pitch, "反向张合不改 pitch");
  const zDrift = dist3(z.cam().target, z0.target);
  assert.ok(
    zDrift < zDist * 0.03,
    `对称张合 target 仅二阶漂移（${zDrift.toFixed(3)} < ${(zDist * 0.03).toFixed(3)}，无显式平移路径）`
  );
  z.up(42); z.up(41);

  /* 2.3 复合输入：指距与质心同时变化 → 平移与缩放同时生效（两分量独立结算） */
  const c = mk(400);
  const c0 = c.cam();
  c.down(51, 300, 300); c.down(52, 400, 300);
  c.move(52, 460, 330); // 质心 (+30,+15)，指距 100 → √(160²+30²)
  const cPinchD = Math.hypot(160, 30);
  assert.ok(near(c.cam().dist, c0.dist * 100 / cPinchD, 1e-9), "复合输入：缩放分量按指距比例独立结算");
  assert.deepEqual(c.cam().target, pannedOf(c0, 30, 15), "复合输入：平移分量同时生效（当帧 dist 换算，先于缩放）");
  c.up(52); c.up(51);

  /* 2.4 值域端点：dist 冻结在 24 / 4200 时平移分量照常 */
  const eLow = mk(400);
  eLow.eng.zoomBy(-1e6);
  assert.equal(eLow.cam().dist, DIST_MIN, "拉近到值域下限");
  const low0 = eLow.cam();
  eLow.down(61, 300, 300); eLow.down(62, 400, 300);
  eLow.move(62, 300, 400); // 指距不变 → 缩放分量零（质心 (350,300) → (300,350)）
  assert.deepEqual(eLow.cam().target, pannedOf(low0, -50, 50), "端点 24：平移分量照常（端点冻结不阻断平移）");
  assert.equal(eLow.cam().dist, DIST_MIN, "端点 24：dist 冻结");
  eLow.up(62); eLow.up(61);

  const eHigh = mk(400);
  eHigh.eng.zoomBy(1e6);
  assert.equal(eHigh.cam().dist, DIST_MAX, "拉远到值域上限");
  const high0 = eHigh.cam();
  eHigh.down(71, 300, 300); eHigh.down(72, 400, 300);
  eHigh.move(72, 300, 400);
  assert.deepEqual(eHigh.cam().target, pannedOf(high0, -50, 50), "端点 4200：平移分量照常");
  assert.equal(eHigh.cam().dist, DIST_MAX, "端点 4200：dist 冻结");
  eHigh.up(72); eHigh.up(71);

  /* 2.9 开关无关性：dragPan 开/关两态下双指平移分量逐位一致（常开常在） */
  const runSwitch = (dragPan) => {
    const g = mk(400, dragPan ? { dragPan: true } : undefined);
    const btn = g.created.find((el) => el.className === "cos-dragpan-btn");
    const c0 = g.cam();
    g.down(81, 300, 300); g.down(82, 400, 300);
    g.move(82, 350, 300);
    g.move(81, 250, 300);
    g.up(82); g.up(81);
    const c1 = g.cam();
    return {
      delta: sub3(c1.target, c0.target),
      dYaw: c1.yaw - c0.yaw,
      dPitch: c1.pitch - c0.pitch,
      pressed: btn ? btn.attrs["aria-pressed"] : null
    };
  };
  const switchOff = runSwitch(false);
  const switchOn = runSwitch(true);
  assert.equal(switchOff.pressed, "false", "关闭态（缺省）确认");
  assert.equal(switchOn.pressed, "true", "开启态确认（两态确实不同）");
  assert.deepEqual(switchOn.delta, switchOff.delta, "开关两态双指平移分量逐位一致（MUST NOT 受开关影响）");
  assert.equal(switchOn.dYaw, 0, "开关开启态双指平移不改 yaw");
  assert.equal(switchOn.dPitch, 0, "开关开启态双指平移不改 pitch");
  assert.equal(switchOff.dYaw, 0, "开关关闭态双指平移不改 yaw");
  assert.equal(switchOff.dPitch, 0, "开关关闭态双指平移不改 pitch");
}

/* ── 双指平移收指矩阵（add-cosmos-two-finger-pan 2.6）：2→3 切三指平移 / 3→2 重锚
   （含新质心基准）/ 2→1 回单指旋转，全程零跳变、不误拾取 ── */
{
  const container = stubEl("div");
  const eng = createCosmosEngine({ container, style: createSkinD(), homeDist: 400, settings: { zoomPointerFocus: false } });
  eng.setScene(zoomScene(), "rebuild");
  const rootEl = container.children[0];
  const canvasEl = rootEl._by[".cos-canvas"];
  const fire = (el, type, ev) => { for (const fn of el.listeners[type] ?? []) fn(ev); };
  const cam = () => eng.getCamera();
  const input = () => eng.inspectInput();
  const down = (id, x, y) => fire(rootEl, "pointerdown", { pointerId: id, button: 0, clientX: x, clientY: y, target: canvasEl, preventDefault() {} });
  const move = (id, x, y) => fire(rootEl, "pointermove", { pointerId: id, clientX: x, clientY: y, buttons: 1, target: canvasEl });
  const up = (id) => fire(rootEl, "pointerup", { pointerId: id, button: 0, target: canvasEl });
  const pannedOf = (snap, dx, dy) => {
    const c = { target: snap.target.slice(), yaw: snap.yaw, pitch: snap.pitch, dist: snap.dist };
    panCameraTargetByDrag(c, dx, dy, snap.dist);
    return c.target;
  };

  down(11, 300, 300); down(12, 400, 300);
  move(12, 300, 400); // 指距恒 100：纯质心平移
  const camPan2 = cam();

  /* 2→3：落第三指 → 切三指平移，目标/视距零跳变（增量模型两边同源） */
  down(13, 500, 300);
  assert.equal(input().mode, "pan3", "双指平移中落第三指 → 切三指平移");
  assert.deepEqual(cam().target, camPan2.target, "2→3 切换目标零跳变");
  assert.equal(cam().dist, camPan2.dist, "2→3 切换视距不变（捏合基准作废，待 3→2 重锚）");
  move(13, 530, 300); // 三指质心 +10
  const camPan3 = cam();
  assert.deepEqual(camPan3.target, pannedOf(camPan2, 10, 0), "三指平移延续同一纯函数同一系数（无断点）");

  /* 3→2：抬第三指 → 以余下两指重锚（含新质心基准），首帧增量自新中点起算 */
  up(13);
  assert.equal(input().mode, "pinch", "3→2 重锚捏合");
  assert.deepEqual(cam().target, camPan3.target, "3→2 切换目标零跳变");
  const camRe = cam();
  move(12, 330, 400); // 余下两指 (300,300)/(300,400)：中点 x 300 → 315
  assert.deepEqual(cam().target, pannedOf(camRe, 15, 0), "3→2 重锚含新质心基准（增量自余下两指中点起算）");
  const camAfterRe = cam();

  /* 2→1：抬第二指 → 剩指回单指旋转起点（不误拾取、不改 target） */
  up(12);
  assert.equal(input().mode, "rotate", "2→1 → 单指旋转模式");
  assert.deepEqual(cam().target, camAfterRe.target, "2→1 收指不改 target（剩指重置起点，无跳变）");
  const yawBefore = cam().yaw;
  move(11, 360, 330);
  assert.notEqual(cam().yaw, yawBefore, "剩指拖拽回到旋转语义（触屏单指仍旋转）");
  assert.deepEqual(cam().target, camAfterRe.target, "旋转通道不改 target（无平移残留）");
  up(11);
  assert.equal(input().gesture, false, "全部抬起清态");
  assert.equal(input().dives, 0, "双指序列收尾不拾取（零 dive）");
  assert.equal(input().suppressed, true, "收尾进入 GESTURE_SUPPRESS_MS 抑制窗");
  fakeNow += GESTURE_SUPPRESS_MS + 1;
  assert.equal(input().suppressed, false, "抑制窗过期");
}

/* ── 双指平移伴随下的收束阈值补判（add-cosmos-two-finger-pan 2.7）：钻取态捏合拉远
   越过返回阈值且平移分量同时生效 → 收束仍以最终 dist 补判一次 flyOut（不静默丢失） ── */
{
  const container = stubEl("div");
  const eng = createCosmosEngine({ container, style: createSkinD(), homeDist: 430, settings: { zoomPointerFocus: false } });
  eng.setScene(zoomScene(), "rebuild");
  rafQ.length = 0;
  fakeNow = 400000;
  let tNow = 400000;
  const step = (n = 1) => { for (let i = 0; i < n; i++) { tNow += 50; stepFrame(tNow); } };
  eng.start();
  step(27);

  const rootEl = container.children[0];
  const canvasEl = rootEl._by[".cos-canvas"];
  const fire = (el, type, ev) => { for (const fn of el.listeners[type] ?? []) fn(ev); };
  const cam = () => eng.getCamera();
  const input = () => eng.inspectInput();
  const down = (id, x, y) => fire(rootEl, "pointerdown", { pointerId: id, button: 0, clientX: x, clientY: y, target: canvasEl, preventDefault() {} });
  const move = (id, x, y) => fire(rootEl, "pointermove", { pointerId: id, clientX: x, clientY: y, buttons: 1, target: canvasEl });
  const up = (id) => fire(rootEl, "pointerup", { pointerId: id, button: 0, target: canvasEl });

  assert.equal(eng.diveToWs("z1"), true, "启动钻取补间");
  fakeNow += 1400;
  step(1);
  assert.equal(eng.inspectFilter().focus.diving, true, "钻取态成立");
  fakeNow += SWITCH_COOLDOWN_MS + 1; // 离开切换冷却窗（捏合收束补判只受冷却约束）
  const dives0 = input().dives;
  const camDrilled = cam();

  down(41, 300, 300); down(42, 400, 300);
  move(42, 350, 300); // 指距 100→50：dist 430 → 860（> FLYOUT_DIST_FLOOR）+ 质心 +25（平移分量）
  assert.ok(cam().dist >= FLYOUT_DIST_FLOOR, "捏合拉远越过返回阈值");
  assert.notDeepEqual(cam().target, camDrilled.target, "同一帧质心平移分量同时生效（复合输入）");
  assert.equal(input().dives, dives0, "捏合进行中不判定（不抢补间）");
  up(42); // 2→1 收束补判
  assert.equal(eng.inspectFilter().tween?.mode, "out", "收束以最终 dist 补判一次 → flyOut（平移分量不吞判定）");
  up(41);
  assert.equal(input().dives, dives0, "flyOut 不新增 dive 计数（无重复触发）");

  eng.stop();
  eng.dispose();
}

/* ── 双指平移拾取抑制（add-cosmos-two-finger-pan 2.8）：双指平移起手在 chip 上 →
   全部抬起零 dive；手势抑制窗照旧 ── */
{
  const before = createdEls.length;
  const container = stubEl("div");
  const eng = createCosmosEngine({ container, style: createSkinD(), homeDist: 430, settings: { zoomPointerFocus: false } });
  eng.setScene(zoomScene(), "rebuild");
  rafQ.length = 0;
  fakeNow = 500000;
  let tNow = 500000;
  const step = (n = 1) => { for (let i = 0; i < n; i++) { tNow += 50; stepFrame(tNow); } };
  eng.start();
  step(27);

  const mine = createdEls.slice(before);
  const rootEl = mine.find((el) => el.className === "cos-root");
  const canvasEl = rootEl._by[".cos-canvas"];
  const chipEl = mine.find((el) => String(el.className).startsWith("cos-chip"));
  assert.ok(chipEl, "chip 存在（拾取抑制用例）");
  const fire = (el, type, ev) => { for (const fn of el.listeners[type] ?? []) fn(ev); };
  const input = () => eng.inspectInput();
  const downOn = (id, x, y, target) => fire(rootEl, "pointerdown", { pointerId: id, button: 0, clientX: x, clientY: y, target, preventDefault() {} });
  const move = (id, x, y) => fire(rootEl, "pointermove", { pointerId: id, clientX: x, clientY: y, buttons: 1, target: canvasEl });
  const up = (id) => fire(rootEl, "pointerup", { pointerId: id, button: 0, target: canvasEl });

  const dives0 = input().dives;
  downOn(91, 300, 300, chipEl); downOn(92, 400, 300, chipEl);
  assert.equal(input().mode, "pinch", "双指在 chip 上起手 → 同样进入双指手势（无平移死区）");
  move(92, 440, 300); move(91, 340, 300); // 同向拖动（质心 +40）
  up(92); up(91);
  assert.equal(input().gesture, false, "全部抬起 → 手势结束");
  assert.equal(input().dives, dives0, "双指平移起手在 chip 上 → 抬起不拾取（零 dive）");
  assert.equal(input().suppressed, true, "收尾进入手势抑制窗");
  fire(chipEl, "click", {});
  assert.equal(input().dives, dives0, "抑制窗内 chip click 不 dive（多指抑制通道照旧）");
  fakeNow += GESTURE_SUPPRESS_MS + 1;
  step(1);
  assert.equal(input().suppressed, false, "抑制窗过期");
  fire(chipEl, "click", {});
  assert.equal(input().dives, dives0 + 1, "窗过后 chip click 恢复单次 dive（零残留）");

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

/* ── 右键拖拽平移（add-cosmos-rightdrag-pan：常开零设置 / 仅 mouse / 独立 E.rdrag /
   共享 hover·光标·缩放阈值守卫 / 共按优先级与锚点交接 / 起手域与指针捕获） ── */
{
  const before = createdEls.length;
  const eng = createCosmosEngine({ container: stubEl("div"), style: createSkinD() });
  eng.setScene(miniScene(), "rebuild");
  rafQ.length = 0;
  eng.start();
  let tNow = 130000;
  const step = (n = 1) => { for (let i = 0; i < n; i++) { tNow += 50; stepFrame(tNow); } };
  step(27); // 过冷启动序曲

  const mine = createdEls.slice(before);
  const rootEl = mine.find((el) => el.className === "cos-root");
  const canvasEl = rootEl._by[".cos-canvas"];
  const cardEl = rootEl._by[".cos-card"];
  const chip = mine.filter((el) => String(el.className).startsWith("cos-chip")).pop();
  assert.ok(rootEl && chip && cardEl, "右键用例前提：根容器 / 星座卡片 / 信息卡齐备");
  const fire = (el, type, ev) => { for (const fn of el.listeners[type] ?? []) fn(ev); };
  const cam = () => eng.inspectFilter().camera;
  const input = () => eng.inspectInput();
  const starScr = () => Object.entries(eng.inspectScreens()).find(([k]) => k.startsWith("star:"))?.[1];
  const down2 = (id, x, y, target = canvasEl) => fire(rootEl, "pointerdown", { pointerId: id, button: 2, clientX: x, clientY: y, pointerType: "mouse", target, preventDefault() {} });
  const move2 = (id, x, y, buttons = 2, target = canvasEl) => fire(rootEl, "pointermove", { pointerId: id, clientX: x, clientY: y, buttons, pointerType: "mouse", target });
  const up2 = (id, x, y) => fire(rootEl, "pointerup", { pointerId: id, button: 2, clientX: x, clientY: y, pointerType: "mouse", target: canvasEl });
  /* 期望 target：同一纯函数（三指平移 / 开关平移 / 右键平移单源）、同一系数口径 */
  const expectedPan = (snapshot, dx, dy) => {
    const expected = { target: snapshot.target.slice(), yaw: snapshot.yaw, pitch: snapshot.pitch };
    panCameraTargetByDrag(expected, dx, dy, snapshot.dist);
    return expected.target;
  };
  const nearTarget = (actual, expected, msg) => assert.ok(
    actual.length === expected.length && actual.every((v, i) => near(v, expected[i])),
    msg
  );
  const star0 = starScr();
  assert.ok(star0, "星体屏幕投影可读（hover / 拾取用例前提）");

  /* 3.6 共享反馈（D5）：hover 探针抑制 + grabbing 光标按「左键或右键拖拽态任一在场」判定。
     出/回对称拖拽（增量抵消）→ 相机与天体屏幕位置复原，可严格断言抑制而非位置漂移。 */
  fire(rootEl, "pointermove", { pointerId: 90, clientX: star0.x, clientY: star0.y, buttons: 0, target: canvasEl });
  step(1);
  assert.ok(cardEl.dataset.sig, "起手前：指针在天体上 → hover 命中已写入（探针基线）");
  const sigBeforeDrag = String(cardEl.dataset.sig);
  const camHover = cam();
  down2(61, star0.x, star0.y);
  move2(61, star0.x + 8, star0.y);       // 越 4px 阈值 → 进入右键拖拽态（平移 8px）
  move2(61, star0.x, star0.y);           // 拖回原位：增量平移抵消 → 天体回到指针下
  assert.equal(input().rdrag, true, "越阈 → 右键拖拽态独立成字段（E.rdrag）");
  assert.equal(input().dragging, false, "右键拖拽全程不写 E.dragging（状态隔离，D5）");
  cardEl.dataset.sig = "";               // 重置标记：抑制成立则本帧不回写签名
  step(1);
  assert.equal(String(cardEl.dataset.sig), "", "右键拖拽中 hover 探针暂停（不因拖拽路经天体改写命中）");
  assert.equal(String(canvasEl.style.cursor), "grabbing", "右键拖拽中光标呈 grabbing（共享反馈）");
  up2(61, star0.x, star0.y);
  assert.equal(input().rdrag, false, "右键抬起 → 拖拽态收束（pointerup(button=2)）");
  step(1);
  assert.equal(String(cardEl.dataset.sig), sigBeforeDrag, "松开后 hover 探针恢复（同一命中）");
  assert.notEqual(String(canvasEl.style.cursor), "grabbing", "松开后光标脱离 grabbing");
  assert.deepEqual(cam().target, camHover.target, "出/回对称拖拽 → target 增量抵消（增量锚点模型）");

  /* 3.1 平移数学单源 + 常开（无开关）：默认关闭态下右键拖拽即平移（不依赖 dragPan 开关） */
  const capCalls = [];
  canvasEl.setPointerCapture = (id) => { capCalls.push(id); };
  const cam0 = cam();
  down2(62, 100, 500);
  assert.deepEqual(capCalls, [62], "3.7 非覆盖元素（canvas）起手 → setPointerCapture（拖出窗口边缘不中断）");
  move2(62, 140, 530);
  assert.equal(cam().yaw, cam0.yaw, "右键平移 MUST NOT 改 yaw");
  assert.equal(cam().pitch, cam0.pitch, "右键平移 MUST NOT 改 pitch");
  nearTarget(cam().target, expectedPan(cam0, 40, 30), "3.1 右键平移与三指/开关平移同一纯函数、同一换算（target 逐位一致）");
  const camOut = cam();
  move2(62, 900, 300); // 指针移出画布右缘（宽 800）→ 捕获语义下平移不中断
  nearTarget(cam().target, expectedPan(camOut, 760, -230), "3.7 拖出窗口边缘继续平移（指针捕获生效、无边界截断）");
  up2(62, 900, 300);
  assert.equal(input().rdrag, false, "越过窗口边缘松开 → 拖拽态完全收束");

  /* 3.2 阈值与让位（D4）：≤4px 松开 = no-op；进入拖拽态即打断在途补间 */
  const camTap = cam();
  const divesTap = input().dives;
  down2(63, 400, 300);
  move2(63, 402, 301);
  assert.deepEqual(cam().target, camTap.target, "位移 ≤4px：未进入拖拽态 → target 不动");
  assert.equal(input().rdrag, false, "位移 ≤4px：不进拖拽态（阈值口径同左键）");
  up2(63, 402, 301);
  assert.deepEqual(cam().target, camTap.target, "3.2 低于阈值松开为 no-op（相机不动）");
  assert.equal(input().dives, divesTap, "3.2 低于阈值松开不拾取（普通右键点按无任何动作）");
  assert.equal(eng.diveToWs("ws1"), true, "启动在途补间");
  assert.ok(eng.inspectFilter().tween, "补间在途");
  down2(64, 200, 420);
  move2(64, 240, 420);
  assert.equal(eng.inspectFilter().tween, null, "3.2 右键平移进入拖拽态 → 在途补间立即让位（cancelTween 同语义）");
  up2(64, 240, 420);
  fakeNow += 1400;
  step(1);

  /* 3.3 共按优先级 + 锚点交接（D3/D7）：左键先按下、再按右键（规范不派发第二个
     pointerdown）→ 由 pointermove 的 buttons 位图补锚定并接管；右键松开沿（仍为
     pointermove）重锚左键起点，后续旋转不吃进右键期间位移（无跳变）。 */
  const camCo = cam();
  const yawCo = camCo.yaw;
  fire(rootEl, "pointerdown", { pointerId: 65, button: 0, clientX: 300, clientY: 200, pointerType: "mouse", target: canvasEl, preventDefault() {} });
  move2(65, 360, 200, 3); // buttons = 左|右：补锚定（不越阈 → 仅登记）
  assert.equal(input().rdrag, false, "共按首个 move 只补锚定（未越阈）");
  assert.equal(cam().yaw, yawCo, "右键按下当帧不旋转（右键接管）");
  const camCoMid = cam();
  move2(65, 420, 200, 3); // 右键拖拽 60px（左键仍按着）
  nearTarget(cam().target, expectedPan(camCoMid, 60, 0), "3.3 右键按住期间相机按平移语义移动");
  assert.equal(cam().yaw, yawCo, "3.3 右键按住期间左键拖拽不旋转（共按优先级）");
  const yawRelease = cam().yaw;
  move2(65, 420, 200, 1); // 右键松开（左键仍按着）：释放切换沿 → 重锚 sx/sy
  assert.equal(input().rdrag, false, "释放切换沿 → 右键拖拽态清（不依赖 pointerup）");
  assert.equal(cam().yaw, yawRelease, "释放切换沿本帧 dx/dy 归零 → 不旋转");
  move2(65, 440, 200, 1); // 左键继续移动 20px
  assert.ok(near(cam().yaw, yawRelease + 20 * 0.005), "3.3 右键释放后左键旋转仅按后续 20px 生效（MUST NOT 吃进右键期间 60px 位移）");
  fire(rootEl, "pointerup", { pointerId: 65, button: 0, clientX: 440, clientY: 200, pointerType: "mouse", target: canvasEl });

  /* 3.4 作用域排除（D2）：pen 笔杆键（button=2 + pointerType=pen）不平移不旋转；
     触屏单指仍为旋转（三自由度手势矩阵零变化） */
  const camPen = cam();
  fire(rootEl, "pointerdown", { pointerId: 70, button: 2, clientX: 200, clientY: 400, pointerType: "pen", target: canvasEl, preventDefault() {} });
  fire(rootEl, "pointermove", { pointerId: 70, clientX: 300, clientY: 460, buttons: 2, pointerType: "pen", target: canvasEl });
  assert.deepEqual(cam().target, camPen.target, "3.4 pen 笔杆键不平移（作用域仅 mouse）");
  assert.equal(cam().yaw, camPen.yaw, "pen 笔杆键不旋转（既有行为零变化）");
  assert.equal(input().rdrag, false, "pen 不进入右键拖拽态");
  fire(rootEl, "pointerup", { pointerId: 70, button: 2, pointerType: "pen", target: canvasEl });
  const camTouch = cam();
  fire(rootEl, "pointerdown", { pointerId: 71, button: 0, clientX: 200, clientY: 400, pointerType: "touch", target: canvasEl, preventDefault() {} });
  fire(rootEl, "pointermove", { pointerId: 71, clientX: 240, clientY: 400, buttons: 1, pointerType: "touch", target: canvasEl });
  assert.notEqual(cam().yaw, camTouch.yaw, "3.4 触屏单指拖拽仍为旋转（触屏行为零变化）");
  fire(rootEl, "pointerup", { pointerId: 71, button: 0, clientX: 240, clientY: 400, pointerType: "touch", target: canvasEl });

  /* 3.7 起手域与捕获（D6/D8）：覆盖元素起手同样平移、MUST NOT 捕获；非捕获指针离场
     走幽灵清理收束（防拖拽态残留卡住 hover/光标） */
  const camOv = cam();
  const capOv = [];
  canvasEl.setPointerCapture = (id) => { capOv.push(id); };
  fire(rootEl, "pointerdown", { pointerId: 72, button: 2, clientX: 760, clientY: 560, pointerType: "mouse", target: chip, preventDefault() {} });
  assert.deepEqual(capOv, [], "3.7 覆盖元素起手 MUST NOT setPointerCapture（捕获会吞 click 派发）");
  move2(72, 780, 570, 2, chip);
  assert.equal(input().rdrag, true, "覆盖元素起手上的右键拖拽同样进入拖拽态");
  nearTarget(cam().target, expectedPan(camOv, 20, 10), "3.7 覆盖元素起手同样平移（任意起指目标既例）");
  fire(rootEl, "pointerleave", {});
  assert.equal(input().rdrag, false, "非捕获指针离开容器 → 右键拖拽态收束（幽灵清理兜底）");

  /* 3.5 拾取链不受污染：右键拖拽收束后左键点击照常拾取（rdrag 独立、不吞 wasDrag） */
  const starLater = starScr();
  assert.ok(starLater, "星体屏幕投影可读（拾取用例前提）");
  const divesPick = input().dives;
  fire(rootEl, "pointerdown", { pointerId: 73, button: 0, clientX: starLater.x, clientY: starLater.y, pointerType: "mouse", target: canvasEl, preventDefault() {} });
  fire(rootEl, "pointerup", { pointerId: 73, button: 0, clientX: starLater.x, clientY: starLater.y, pointerType: "mouse", target: canvasEl });
  assert.equal(input().dives, divesPick + 1, "3.5 右键拖拽后左键点击照常拾取（wasDrag 链未被污染）");

  /* 3.7 覆盖元素自身点击语义不受影响（chip click 既有链路照常 dive 一次） */
  const divesChip = input().dives;
  fire(chip, "click", {});
  assert.equal(input().dives, divesChip + 1, "3.7 覆盖元素点击语义不受影响（chip 单次 dive）");

  eng.stop();
  eng.dispose();
}

/* ── 右键拖拽期间缩放阈值导航守卫（add-cosmos-rightdrag-pan D5：zoomSwitchBlocked 含
   E.rdrag；滚轮逐次判定口径不变） ── */
{
  const container = stubEl("div");
  const eng = createCosmosEngine({ container, style: createSkinD(), settings: { zoomPointerFocus: false }, homeDist: 430 });
  eng.setScene(zoomScene(), "rebuild");
  const rootEl = container.children[0];
  const canvasEl = rootEl._by[".cos-canvas"];
  const fire = (el, type, ev) => { for (const fn of el.listeners[type] ?? []) fn(ev); };
  const fireWheel = (deltaY) => fire(rootEl, "wheel", { preventDefault() {}, deltaY, clientX: 400, clientY: 300, target: canvasEl });
  rafQ.length = 0;
  fakeNow = 160000;
  let tNow = 160000;
  const step = () => { tNow += 50; stepFrame(tNow); };
  eng.start();
  step();
  assert.equal(eng.inspectInput().dives, 0, "初始银河态无钻取");

  fire(rootEl, "pointerdown", { pointerId: 81, button: 2, clientX: 300, clientY: 300, pointerType: "mouse", target: canvasEl, preventDefault() {} });
  fire(rootEl, "pointermove", { pointerId: 81, clientX: 320, clientY: 310, buttons: 2, pointerType: "mouse", target: canvasEl });
  assert.equal(eng.inspectInput().rdrag, true, "右键拖拽态在场");
  for (let i = 0; i < 7; i++) fireWheel(-120);
  assert.ok(eng.getCamera().dist < DIVE_REF, "滚轮已把 dist 压进钻取阈值带");
  assert.equal(eng.inspectInput().dives, 0, "3.6 右键拖拽进行中不触发 dive/flyOut（zoomSwitchBlocked 含 E.rdrag）");
  fire(rootEl, "pointerup", { pointerId: 81, button: 2, clientX: 320, clientY: 310, pointerType: "mouse", target: canvasEl });
  assert.equal(eng.inspectInput().rdrag, false, "pointerup(button=2) 收束右键拖拽态");
  fireWheel(-120);
  assert.equal(eng.inspectInput().dives, 1, "3.6 松开后同一滚轮照常判定 → 自动 dive（守卫不残留）");
  eng.dispose();
}

/* ── 捏合越阈切平移，收束仍补判阈值导航（spec「捏合越阈切平移收束仍补判」）。
   add-cosmos-two-finger-pan 起双指含质心平移分量：本用例改为「先拉近阈带上沿 + 小幅
   平移」轨迹——星座仍留在屏心闸门内（gate = min(W,H)×0.25 = 150px），断言平移分量
   不吞掉收束补判 ── */
{
  const before = createdEls.length;
  const eng = createCosmosEngine({ container: stubEl("div"), style: createSkinD(), homeDist: 430 });
  eng.setScene(zoomScene(), "rebuild");
  eng.setTuning({ zoomPointerFocus: false }); // 聚焦关闭：target 只随双指平移分量动（判定链隔离）
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
  eng.zoomBy(-446); // 430 → ≈199.9：先拉近阈带上沿（公共面 zoomBy 不判定，无自动 dive）
  assert.ok(eng.getCamera().dist < 210 && eng.getCamera().dist > 190, "捏合前镜头距离已接近阈值");
  const camBeforePinch = eng.getCamera();
  down(41, 100, 300); down(42, 200, 300);
  move(42, 250, 300); // 质心 +25（平移分量）+ 指距 100 → 150：dist ≈199.9 → ≈133 < DIVE_REF 155（越阈）
  assert.ok(eng.getCamera().dist < DIVE_REF, "捏合越过钻取阈值");
  assert.notDeepEqual(eng.getCamera().target, camBeforePinch.target, "同一帧质心平移分量同时生效（复合输入）");
  assert.equal(input().dives, 0, "捏合进行中不判定（不抢补间）");
  step(1); // 更新场景投影（小幅平移后星座仍在屏心闸门内）

  down(43, 450, 300); // 第三指切平移
  assert.equal(input().mode, "pan3", "捏合中落第三指 → 切平移");
  assert.equal(input().pan3.pinchCarry, true, "平移记住本序列曾捏合");
  move(43, 460, 300); // 平移一点（dist 不变）
  assert.equal(input().dives, 0, "平移进行中仍不判定");
  step(1); // 更新投影（pan3 小幅平移仍在闸门内）
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
  const eng = createCosmosEngine({ container, style: createSkinD(), settings: { zoomPointerFocus: false }, homeDist: 430 });
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
  assert.equal(eng.inspectZoomNav().ws[0].boundR, 12, "空星座 boundR = 星云下限 12（保留为引擎数据/观测面字段）");
  assert.ok(eng.inspectZoomNav().ws[0].proj, "首帧渲染产出星座投影（最近星座选择前提）");
  /* 观测面改形（add-cosmos-zoom-ruler 1.3）：标尺几何 + 指针聚焦；阈值设置字段退场 */
  const navShape = eng.inspectZoomNav();
  assert.deepEqual(
    [navShape.tickDist, navShape.flyOutFloorDist, navShape.distMin, navShape.distMax],
    [155, 209.25, 24, 4200],
    "inspectZoomNav 暴露标尺几何（tick / 滞回下限 / 值域端点）"
  );
  assert.deepEqual(navShape.tuning, { pointerFocus: false }, "tuning 仅含指针聚焦（阈值设置字段退场）");
  assert.equal("diveRatio" in navShape.tuning, false, "观测面不含进入阈值设置字段");
  assert.equal("flyOutRatio" in navShape.tuning, false, "观测面不含返回阈值设置字段");

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

  /* 冷却过期后继续缩小：越过 dist 滞回下限 209.25（距离单判，不问屏显尺寸）→ 自动 flyOut */
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

/* ── 标尺数据通道（add-cosmos-zoom-ruler 1.2/D4）：订阅 / 0.5% 门限 / 模式变化 /
   载荷形状 / 卸载 / dispose 清理 ── */
{
  const container = stubEl("div");
  const eng = createCosmosEngine({ container, style: createSkinD(), settings: { zoomPointerFocus: false }, homeDist: 430 });
  eng.setScene(zoomScene(), "rebuild");
  rafQ.length = 0;
  fakeNow = 72500;
  let tNow = 72500;
  const step = () => { tNow += 50; stepFrame(tNow); };
  const events = [];
  const off = eng.onZoomMeter((meter) => events.push(meter));
  assert.equal(typeof off, "function", "onZoomMeter 返回卸载函数");
  eng.start();
  step();
  assert.equal(events.length, 1, "订阅后首帧强制补发当前标尺值（冷启动即有位置）");
  assert.deepEqual(Object.keys(events[0]).sort(), ["dist", "distMax", "distMin", "tickDist"], "载荷形状 = dist/tickDist/distMin/distMax");
  assert.deepEqual(
    [events[0].tickDist, events[0].distMin, events[0].distMax],
    [155, 24, 4200],
    "载荷几何常量与引擎单源一致"
  );
  assert.ok(near(events[0].dist, 430, 1e-9), "初始距离 = 银河常驻落点 430");
  const before = events.length;
  step();
  assert.equal(events.length, before, "轨道位置未变 → 不重复通知（无逐帧写）");
  /* 大幅滚轮（轨道位移 ≫0.5%）→ 下一帧通知一次 */
  eng.zoomBy(400); // 430 → ≈636（judge:false，不触发阈值导航）
  step();
  assert.equal(events.length, before + 1, "轨道位移 ≥0.5% → 通知一次");
  assert.ok(events[events.length - 1].dist > 430, "载荷距离反映实际相机距离");
  /* 亚门限小步（≈0.02% 轨道位）→ 不通知 */
  const beforeSmall = events.length;
  eng.zoomBy(1);
  step();
  assert.equal(events.length, beforeSmall, "轨道位移 <0.5% → 不通知（门限挡住高频无谓写）");
  /* 模式变化（银河 → 钻取）→ 派发一次（标尺双模式共用同一刻度） */
  const beforeMode = events.length;
  eng.diveToWs("z1");
  step();
  assert.equal(events.length, beforeMode + 1, "模式变化 → 派发（双模式同刻度，切换时订阅方同步）");
  /* 卸载后不再回调 */
  off();
  const beforeOff = events.length;
  eng.zoomBy(-400);
  step();
  assert.equal(events.length, beforeOff, "卸载函数生效（不再回调）");
  /* 回调异常不中断引擎帧循环（console.warn 吞掉） */
  const origWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.map(String).join(" "));
  const offThrow = eng.onZoomMeter(() => { throw new Error("meter boom"); });
  eng.zoomBy(400);
  step();
  console.warn = origWarn;
  assert.ok(warnings.some((line) => line.includes("zoom meter listener failed")), "回调异常按 console.warn 记录（不中断帧循环）");
  offThrow();
  eng.dispose();
  const afterDispose = events.length;
  assert.equal(typeof eng.onZoomMeter(() => {}), "function", "dispose 后订阅返回空卸载函数（不抛错）");
  assert.equal(events.length, afterDispose, "dispose 后无回调");
}

/* ── 银河首屏视距（HOME_DIST=3000）：进入 Cosmos 页面默认拉开到整座星座天球可见 ── */
{
  /* 天球壳半径口径（merge.constellationPositions）：150 × (0.9 + √|S| × 0.55)；
     88 座松弛前 ≈909、松弛后壳顶实测 ≈1117 世界单位。首屏垂直半幅 =
     tan(fov/2) × HOME_DIST ≈ 1732 > 1117（88 座投影全部落屏；旧 430 仅 19 座落屏）。 */
  const shellRadius88 = 150 * (0.9 + Math.sqrt(88) * 0.55);
  assert.ok(Math.tan((60 / 2) * Math.PI / 180) * HOME_DIST > 1117, "首屏垂直半幅覆盖松弛后的整座星座天球（88 座壳顶 ≈1117）");
  assert.ok(HOME_DIST > shellRadius88, "首屏视距位于天球壳外（整壳可入画）");
  assert.ok(430 < shellRadius88, "旧首屏 430 位于天球壳内 → 只能看到部分星座（本改动动机）");

  const def = createCosmosEngine({ container: stubEl("div"), style: createSkinD() });
  assert.equal(def.getCamera().dist, HOME_DIST, "默认初始镜头距离 = HOME_DIST（3000）");
  assert.deepEqual(def.getCamera().target, [0, 0, 0], "初始 target = 天球中心（原点）");
  def.dispose();
  const custom = createCosmosEngine({ container: stubEl("div"), style: createSkinD(), homeDist: 430 });
  assert.equal(custom.getCamera().dist, 430, "homeDist 构造覆盖（测试夹具 / 自定义首屏）");
  custom.dispose();
  const clamped = createCosmosEngine({ container: stubEl("div"), style: createSkinD(), homeDist: 99999 });
  assert.equal(clamped.getCamera().dist, DIST_MAX, "homeDist 越界 clamp 到 DIST_MAX");
  clamped.dispose();
  const bad = createCosmosEngine({ container: stubEl("div"), style: createSkinD(), homeDist: "x" });
  assert.equal(bad.getCamera().dist, HOME_DIST, "非法 homeDist 回落 HOME_DIST");
  bad.dispose();
}

/* ── 空星座同样自动进入（spec scenario）：仅 chip、无恒星/行星/彗星，boundR = 下限 12 ── */
{
  const data = zoomScene();
  data.workspaces[0].stars = [];
  const container = stubEl("div");
  const eng = createCosmosEngine({ container, style: createSkinD(), settings: { zoomPointerFocus: false }, homeDist: 430 });
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

  /* getTuning（add-cosmos-zoom-ruler 1.1/D3）：只暴露平移调参与指针聚焦；
     旧阈值键入参被忽略（阈值已常量化，SHALL NOT 报错） */
  eng.setTuning({ zoomDiveRatio: 80, zoomFlyOutRatio: 40, zoomPointerFocus: false });
  assert.deepEqual(
    eng.getTuning(),
    { panSpeed: 120, panShiftBoost: 3, zoomPointerFocus: false },
    "setTuning/getTuning 不再含阈值字段（旧键入参被忽略）"
  );
  assert.equal("zoomDiveRatio" in eng.getTuning(), false, "getTuning 不含进入阈值");
  assert.equal("zoomFlyOutRatio" in eng.getTuning(), false, "getTuning 不含返回阈值");
  eng.dispose();
}

{
  /* 捏合中点聚焦（2.3）：同一收敛式 + canvas 相对坐标（rect 转换）。
     add-cosmos-two-finger-pan D2/D3：单指下移使质心 +20 → 先结算质心平移分量
     （单源纯函数、以当帧 dist 换算），再以双指中点做指针聚焦。 */
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
  /* 期望值 = 复现同一结算顺序：① 质心增量 (0,+20) 单源平移（当帧 dist = cam0.dist）→
     ② 以平移后相机 + 当前中点 (200,120) 做指针聚焦 */
  const panned = { target: cam0.target.slice(), yaw: cam0.yaw, pitch: cam0.pitch, dist: cam0.dist };
  assert.equal(panCameraTargetByDrag(panned, 0, 20, cam0.dist), true, "质心平移分量先结算（有位移）");
  assert.deepEqual(
    cam1.target,
    zoomFocusTargetOf(panned, 200, 120, 800, 600, pinchNext),
    "复合结算：质心平移分量在前、中点聚焦在后（同一纯函数同一收敛式）"
  );
  fire("pointerup", { pointerId: 12, button: 0 });
  fire("pointerup", { pointerId: 11, button: 0 });
  assert.equal(eng.inspectInput().dives, 0, "proj 缺席 → 收束判定无目标（不误 dive）");
  eng.dispose();
}

{
  /* 捏合收束判定（2.3/2.4）：手势进行中不判定，收束以最终 dist 补判一次 → 自动 dive */
  const container = stubEl("div");
  const eng = createCosmosEngine({ container, style: createSkinD(), settings: { zoomPointerFocus: false }, homeDist: 430 });
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
  const eng = createCosmosEngine({ container, style: createSkinD(), homeDist: 430 });
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
  const actionsAt = engineSource.indexOf("function cardActionsHtml(sessionId, lead, ent)");
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
  /* 星↔星提案连线解除（two-use-cosmos-template-star-layout）：relLast 无 links 面，
     提案 links 段（ra↔rb）不再绘制、不再聚焦点亮——直线通道让位图样连线。 */
  assert.equal(rel.last.links, undefined, "星↔星提案虚线点亮解除（relLast 无 links 面）");
  assert.deepEqual(eng.inspectPatternLines(), [], "提案 links 不进图样线通道（fixture 无 ws.pattern）");
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
  assert.equal(rel.last.links, undefined, "行星聚焦亦无星↔星面（通道整体解除，two）");

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
  const slabOf = (id) => overlayEl.children.find((el) => String(el.className).startsWith("cos-slab") && el.dataset.star === id);
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
   谓词）、取色通道（palette.accent → 热切换随动）、卫星无引线、引线不参与拾取。

   polish-cosmos-tip-leader-upward（斜出段向上）：`TIP_GAP.cardLift` 抬卡位 → 卡近缘
   中点位于星心上方 → dy<0 故折线默认右上 45°（翻转侧左上镜像）；顶部钳制把中点压回
   星心下方时回落为下行（钳制例外路径），端点仍 = 钳后卡缘。以下 A/B 两段各自追加
   「向上 / 左上镜像 / 钳制例外」断言，既有向下（钳制）与端点同源断言不回退。 */

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
  /* 信息卡上浮（polish-cosmos-tip-leader-upward 1.1 / 2.1）：spec 锁「卡近缘中点在星心
     上方」的相对语义，数值集中 TIP_GAP.cardLift；上浮量 < 间距−tail → 斜出段仍标准 45°。 */
  assert.ok(TIP_GAP.cardLift > 0, "信息卡上浮幅度 > 0（卡近缘中点在星心上方）");
  assert.ok(TIP_GAP.cardLift < TIP_GAP.card - TIP_LINE.tail,
    "上浮幅度 < 间距 − tail（向上斜出段保持标准 45°，不触横向封顶）");

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
  /* 向上斜出（polish-cosmos-tip-leader-upward 1.3 / 2.1）：卡近缘中点在星心上方（默认
     形态，由 TIP_GAP.cardLift 抬卡保证）→ dy<0 → 斜出段向上；未翻转侧呈右上 45°。 */
  const cardUp = tipLeaderOf({ kind: "card", hx: 520, hy: 300, x: 600, y: 270 });
  assert.equal(cardUp.pts.length, 3, "向上形态仍为两段折线");
  assert.ok(cardUp.pts[1].y < cardUp.pts[0].y, "dy<0 → 斜出段向上（折点 y 高于星缘点）");
  assert.ok(cardUp.pts[1].x > cardUp.pts[0].x, "未翻转侧 → 右上出笔（折点偏向卡侧）");
  assert.equal(
    Math.abs(cardUp.pts[1].x - cardUp.pts[0].x),
    Math.abs(cardUp.pts[1].y - cardUp.pts[0].y),
    "向上斜出段仍是 45°（|dx| === |dy|）"
  );
  assert.equal(cardUp.pts[2].y, cardUp.pts[1].y, "向上形态：水平段仍水平止于卡近缘");
  /* 翻转侧同一语义镜像：卡在星左侧 + 卡近缘中点在星心上方 → 左上 45° */
  const cardUpFlip = tipLeaderOf({ kind: "card", hx: 280, hy: 300, x: 200, y: 270 });
  assert.ok(cardUpFlip.pts[1].y < cardUpFlip.pts[0].y, "翻转侧 dy<0 → 斜出段仍向上");
  assert.ok(cardUpFlip.pts[1].x < cardUpFlip.pts[0].x, "翻转侧 → 左上出笔（镜像）");
  assert.equal(
    Math.abs(cardUpFlip.pts[1].x - cardUpFlip.pts[0].x),
    Math.abs(cardUpFlip.pts[1].y - cardUpFlip.pts[0].y),
    "左上镜像仍是 45°（|dx| === |dy|）"
  );
  /* 纵向钳制：dy 超过「间距 − tail」→ 斜出段横向跨度封顶（更陡），水平段仍水平且不短于 tail */
  const cardClamp = tipLeaderOf({ kind: "card", hx: 520, hy: 80, x: 600, y: 200 });
  assert.equal(cardClamp.pts[1].y, 200, "钳制侧：斜出段 y 收到（钳后）卡中点");
  assert.equal(cardClamp.pts[1].x - cardClamp.pts[0].x, 80 - TIP_LINE.tail, "钳制侧：横向跨度封顶 = 间距 − tail");
  assert.equal(cardClamp.pts[2].y, cardClamp.pts[1].y, "钳制侧：水平段不受 dy 影响");
  /* 钳制例外取向（2.2 纯函数面）：中点被钳回星心下方 → dy>0 → 斜出段局部向下 */
  assert.ok(cardClamp.pts[1].y > cardClamp.pts[0].y, "钳制例外：dy>0 → 斜出段向下（取向随实际落差）");
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
  const eng = createCosmosEngine({ container, style: stubStyle("#00ff88"), homeDist: 430 });
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
    const slabEl = overlayEl.children.find((el) => String(el.className).startsWith("cos-slab"));
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
    assert.ok(
      near(Math.abs(cardGeo.pts[1].x - cardGeo.pts[0].x), Math.abs(cardGeo.pts[1].y - cardGeo.pts[0].y), 1e-9),
      "斜出段 45°：|dx| === |dy|（缓存端点的几何换算）"
    );
    assert.ok(cardGeo.pts[2].x - cardGeo.pts[1].x >= TIP_LINE.tail - 1e-9, "水平段不短于 TIP_LINE.tail");
    /* 向上出笔（polish-cosmos-tip-leader-upward 2.1 / 2.3）：卡近缘中点 = 星心 − cardLift
       → 端点高于起笔（dy<0）→ 折点向上（未翻转侧 = 右上 45°）；端点同源断言（上面同一
       组数）不回退，仅方向语义反转。取整链 snap1 ×3（hy / cy / 端点）→ 余量 0.2。 */
    assert.ok(cardLine.y < cardLine.hy, "卡近缘中点在星心上方（向上出笔：端点 y < 起笔 y）");
    assert.ok(Math.abs((cardLine.hy - cardLine.y) - TIP_GAP.cardLift) <= 0.2,
      "上浮量 = TIP_GAP.cardLift（卡近缘中点 = 星心y − cardLift）");
    assert.ok(cardGeo.pts[1].y < cardGeo.pts[0].y, "斜出段向上（折点 y 高于星缘起笔点）");
    assert.ok(cardGeo.pts[1].x > cardGeo.pts[0].x, "未翻转侧 → 右上出笔（折点偏向卡侧）");
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
    /* 翻转侧向上镜像（2.1）：卡近缘中点仍高于星心 → 左上 45°（折点向上向左） */
    assert.ok(flipLine.y < flipLine.hy, "翻转侧：卡近缘中点仍在星心上方（向上出笔）");
    const flipGeo = tipLeaderOf(flipLine);
    assert.ok(flipGeo.pts[1].y < flipGeo.pts[0].y, "翻转侧：斜出段向上");
    assert.ok(flipGeo.pts[1].x < flipGeo.pts[0].x, "翻转侧：左上出笔（右上出笔的镜像）");

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
    /* 钳制例外取向（2.2）：`星心y − cardLift − 卡半高 < 70` → cy 钳到 70，卡近缘中点被
       压回星心下方 → dy 翻正 → 斜出段局部向下；端点仍是钳后卡缘（上面已断言，不悬空）。 */
    assert.ok(clampAt.y === 70 && clampLine.y > clampLine.hy,
      "钳制例外：中点落回星心下方（dy>0）——向上语义以未钳制态为准");
    const clampGeo = tipLeaderOf(clampLine);
    assert.ok(clampGeo.pts.length >= 2, "钳制帧仍产出折线（不画空引线）");
    if (clampGeo.pts.length >= 3) {
      assert.ok(clampGeo.pts[1].y > clampGeo.pts[0].y, "钳制例外：折点向下（取向随实际落差）");
    }
    assert.deepEqual({ x: clampGeo.pts[clampGeo.pts.length - 1].x, y: clampGeo.pts[clampGeo.pts.length - 1].y },
      { x: clampLine.x, y: clampLine.y }, "钳制例外：引线终点字面 = 钳后卡缘端点（同源）");

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

/* ── 浮签与 UI 铬件的遮挡避让与命中隔离（polish-cosmos-tip-ui-avoidance 1.1–1.3 / 2.x /
      3.x / 4.x / 5.1–5.5） ──
   覆盖：① 矩形契约纯函数（规范化 / 点-盒相交谓词 / 避让决策序列：短轴推出 → 翻转 →
   钳回容器 → 降级；空集与非法入参回落）；② 引擎集成（公共面发布与矩形缺席回落、chip
   相交隐藏且不产引线、信息卡 UI 感知钳位与 `pe:none` 降级、pointerdown 门禁 + click
   复检、引擎自建 HUD 兜底与自遮挡排除、逐帧可逆无点击死区）。 */

/* A. 纯函数：规范化 / 谓词 / 避让决策（1.1–1.3 / 5.1，无 DOM） */
{
  /* 矩形规范化：反序坐标归一、零尺寸/非法/残缺条目丢弃、kind 归一 */
  const rects = normalizeUiRects([
    { left: 10, top: 20, right: 110, bottom: 120, kind: "panel" },
    { left: 110, top: 120, right: 10, bottom: 20 }, // 反序 → 归一
    { left: 0, top: 0, right: 0, bottom: 50 }, // 零宽（未布局）→ 丢弃
    { left: 5, top: 5, right: 50, bottom: 5 }, // 零高 → 丢弃
    { left: NaN, top: 0, right: 10, bottom: 10 }, // 非法数 → 丢弃
    null, "x", { left: 1, top: 2 }, // 残缺 → 丢弃
    { left: -50, top: -20, right: 20, bottom: 10, kind: "home" } // 容器内负坐标合法（整页偏移）
  ]);
  assert.equal(rects.length, 3, "规范化：合法矩形入列、反序归一、零尺寸/非法残缺丢弃");
  assert.deepEqual(rects[0], { left: 10, top: 20, right: 110, bottom: 120, kind: "panel" }, "矩形字段与类别原样保留");
  assert.deepEqual(rects[1], { left: 10, top: 20, right: 110, bottom: 120, kind: "" }, "反序坐标归一（min/max），缺 kind → 空串");
  assert.deepEqual(rects[2], { left: -50, top: -20, right: 20, bottom: 10, kind: "home" }, "容器内负坐标合法（引擎容器 ≠ 窗口原点）");
  assert.deepEqual(normalizeUiRects(null), [], "非数组 → 零矩形集（契约缺席回落）");
  assert.deepEqual(normalizeUiRects([]), [], "空集 → 零矩形集");

  /* 相交谓词：盒 = 开边界（贴边不算重叠）、点 = 闭区间（边缘也算命中） */
  const box = { left: 100, top: 100, right: 200, bottom: 200 };
  assert.equal(rectsIntersect(box, { left: 200, top: 100, right: 300, bottom: 200 }), false, "盒仅边缘相贴 → 不相交");
  assert.equal(rectsIntersect(box, { left: 199, top: 100, right: 300, bottom: 200 }), true, "盒 1px 重叠 → 相交");
  assert.equal(boxInRects({ left: 300, top: 300, right: 400, bottom: 400 }, rects), false, "盒与矩形集不相交");
  assert.equal(boxInRects(box, [{ left: 150, top: 150, right: 160, bottom: 160, kind: "add" }]), true, "盒包住小矩形 → 相交");
  assert.equal(boxInRects(box, [{ left: 150, top: 150, right: 160, bottom: 160, kind: "home" }], "home"), false,
    "ignoreKinds：自遮挡排除（浮签自身族矩形不参与）");
  assert.equal(boxInRects(box, [{ left: 150, top: 150, right: 160, bottom: 160, kind: "home" }], ["home"]), false,
    "ignoreKinds 接受数组形态");
  assert.equal(pointInRects(200, 200, [{ left: 0, top: 0, right: 200, bottom: 200, kind: "panel" }]), true, "点落在矩形右/下边缘 → 命中（闭区间）");
  assert.equal(pointInRects(200.5, 120, [{ left: 0, top: 0, right: 200, bottom: 200, kind: "panel" }]), false, "点越界 → 未命中");
  assert.equal(pointInRects(120, 120, []), false, "空矩形集 → 恒未命中（契约缺席）");
  assert.equal(pointInRects(NaN, 120, rects), false, "非法点 → 未命中（MUST NOT 抛错）");
  assert.equal(pointInRects(15, 25, [{ left: 10, top: 20, right: 110, bottom: 120, kind: "panel" }], "panel"), false,
    "ignoreKinds 生效于点谓词");

  /* 边界盒与候选位包围盒（定位点口径与 DOM transform 单点同源） */
  assert.deepEqual(boundsBoxOf({ W: 800, H: 600 }), { left: 0, top: 0, right: 800, bottom: 600 }, "boundsBoxOf：{W,H} → 容器盒");
  assert.deepEqual(boundsBoxOf({ width: 320, height: 240 }), { left: 0, top: 0, right: 320, bottom: 240 }, "boundsBoxOf：宽高别名");
  assert.equal(boundsBoxOf(null), null, "bounds 缺席 → null（不约束）");
  assert.deepEqual(tipBoxOf({ kind: "chip", x: 100, y: 50, w: 96, h: 26 }), { left: 52, top: 24, right: 148, bottom: 50 },
    "chip 盒：定位点 = 底缘中点（translate(-50%,-100%)）");
  assert.deepEqual(tipBoxOf({ kind: "card", x: 300, y: 100, w: 240, h: 96, dir: 1 }), { left: 300, top: 100, right: 540, bottom: 196 },
    "card 盒（未翻转）：定位点 = 左缘上角");
  assert.deepEqual(tipBoxOf({ kind: "card", x: 300, y: 100, w: 240, h: 96, dir: -1 }), { left: 60, top: 100, right: 300, bottom: 196 },
    "card 盒（翻转）：定位点 = 右缘上角（translateX(-100%)）");
  assert.equal(tipBoxOf({ kind: "chip", x: NaN, y: 0 }), null, "非法候选位 → null（不参与判定）");

  /* 决策：chip 相交 → hide；空集/不相交/非法 → keep */
  const chipRects = [{ left: 60, top: 10, right: 160, bottom: 60, kind: "actions" }];
  const chipDecision = tipAvoidanceOf({ kind: "chip", x: 100, y: 50, w: 96, h: 26 }, chipRects, { W: 800, H: 600 });
  assert.equal(chipDecision.action, "hide", "chip 与铬件矩形相交 → hide（锚定语义优先，不钳位）");
  assert.equal(chipDecision.degraded, false, "hide 不是降级（chip 无 pe 态）");
  assert.equal(tipAvoidanceOf({ kind: "chip", x: 100, y: 50, w: 96, h: 26 }, [], { W: 800, H: 600 }).action, "keep",
    "空矩形集 → keep（契约缺席 = 现状回落）");
  assert.equal(tipAvoidanceOf({ kind: "chip", x: 400, y: 50, w: 96, h: 26 }, chipRects, { W: 800, H: 600 }).action, "keep",
    "不相交 → keep");
  assert.equal(tipAvoidanceOf(null, chipRects, null).action, "keep", "非法候选位 → keep（MUST NOT 抛错）");

  /* 决策：card 短轴推出（相交带在上方 → 向下推出最小位移） */
  const pushDecision = tipAvoidanceOf(
    { kind: "card", x: 300, y: 100, w: 240, h: 147, dir: 1 },
    [{ left: 300, top: 40, right: 540, bottom: 140, kind: "actions" }],
    { W: 800, H: 600 }
  );
  assert.equal(pushDecision.action, "place", "卡相交 → place（几何避让，非隐藏）");
  assert.equal(pushDecision.degraded, false, "推出成功 → 不降级");
  assert.equal(pushDecision.y, 140, "沿卡体短轴（纵向）推出最小位移：卡顶 = 矩形下缘");
  assert.equal(pushDecision.x, 300, "推出只动短轴，横向锚点不变");
  assert.equal(pushDecision.dir, 1, "推出不改伸展方向");

  /* 决策：纵向推出无解（全高面板）→ 翻转（镜像候选位自由） */
  const flipDecision = tipAvoidanceOf(
    { kind: "card", x: 600, y: 200, w: 240, h: 147, dir: 1, altX: 300 },
    [{ left: 600, top: 0, right: 800, bottom: 600, kind: "panel" }],
    { W: 800, H: 600 }
  );
  assert.equal(flipDecision.action, "place", "纵向全高遮挡 → place（翻转路径）");
  assert.equal(flipDecision.dir, -1, "翻转：伸展方向取反（调用方缀 translateX(-100%)）");
  assert.equal(flipDecision.x, 300, "翻转位 = 镜像候选位原样落位");
  assert.equal(flipDecision.degraded, false, "翻转到自由区 → 不降级");

  /* 决策：推出/翻转皆无解（极窄容器 + 整屏遮挡）→ 钳回容器并降级 */
  const degradeDecision = tipAvoidanceOf(
    { kind: "card", x: 40, y: 200, w: 240, h: 147, dir: 1, altX: 300 },
    [{ left: 0, top: 0, right: 320, bottom: 600, kind: "panel" }],
    { W: 320, H: 600 }
  );
  assert.equal(degradeDecision.action, "place", "无自由空间仍给落位（视觉保留）");
  assert.equal(degradeDecision.degraded, true, "无自由空间 → degraded（调用方整卡 pe:none）");
  assert.ok(degradeDecision.x >= UI_AVOID.margin && degradeDecision.x + 240 <= 320 - UI_AVOID.margin + 0.01,
    "降级态卡盒仍钳在容器留白内（可读，不出画）");
}

/* B. 引擎集成：矩形发布 / chip 隐藏 / 卡避让与降级 / 命中门禁 / HUD 兜底（2.x–4.x / 5.2–5.5） */
{
  const container = stubEl("div");
  let openedSessions = 0;
  const eng = createCosmosEngine({
    container,
    style: createSkinD(),
    homeDist: 430,
    onOpenSession: () => { openedSessions += 1; }
  });
  try {
    const rootEl = container.children[0];
    const overlayEl = rootEl._by[".cos-overlay"];
    const canvasEl = rootEl._by[".cos-canvas"];
    const cardEl = rootEl._by[".cos-card"];
    const fire = (el, type, ev) => { for (const fn of el.listeners[type] ?? []) fn(ev); };
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
    const starOf = (id) => ({
      id, name: id, lifecycle: "executed", setBy: null, at: null,
      tasks: [1, 1], age: "刚刚", act: 0, off: [0, 0, 0]
    });
    const twoWsScene = (ws1Pos = [0, 0, 0]) => ({
      workspaces: [
        { id: "ws1", name: "ws-one", pos: ws1Pos.slice(), stars: [starOf("add-a")], links: [], planets: [], comets: [], archives: 0, satelliteCount: 0 },
        { id: "ws2", name: "ws-two", pos: [150, 40, -30], stars: [starOf("add-b")], links: [], planets: [], comets: [], archives: 0, satelliteCount: 0 }
      ]
    });
    const falseBtn = (action, sessionId) => ({
      classList: { contains: (name) => name === "cd-btn" },
      getAttribute: (name) => (name === "data-action" ? action : name === "data-session" ? sessionId : null)
    });
    const tips = () => eng.inspectTipLines();
    const uiRects = () => eng.inspectUiRects();

    eng.setScene(twoWsScene(), "rebuild");
    rafQ.length = 0;
    eng.start();
    let tNow = 90000;
    const step = (n = 1) => { for (let i = 0; i < n; i++) { tNow += 50; stepFrame(tNow); } };
    step(27); // 过冷启动序曲

    const chipEl = overlayEl.children.find((el) => String(el.className).startsWith("cos-chip"));
    assert.ok(chipEl, "银河态 chip 已建树（避让集成前置）");

    /* ① 矩形契约缺席：零矩形集 → 行为回落现状（chip 可见、无 pe、无报错） */
    assert.deepEqual(uiRects(), { rects: [], origin: { x: 0, y: 0 } }, "① 未发布 → 零矩形集（契约缺席）");
    step(1);
    assert.ok(chipEl.classList.contains("on"), "① 契约缺席：chip 照常可见（现状回落）");
    assert.equal(chipEl.style.pointerEvents, undefined, "① 契约缺席：chip 无内联 pe 改写");
    assert.ok(tips().some((line) => line.kind === "chip"), "① 契约缺席：chip 引线照常产出");

    /* ② 场景 A（spec「chip 压在动作条按钮上被隐藏」）：投影落进动作条矩形 → chip 隐藏、无引线 */
    const chipAt0 = parseTranslate(chipEl.style.transform);
    assert.ok(chipAt0, "① chip 已有定位（DOM transform）");
    const chipLines0 = tips().filter((line) => line.kind === "chip").length;
    assert.equal(chipLines0, 2, "① 银河态两个星座各一条 chip 引线（夹具确认）");
    const chipRect = { kind: "actions", left: chipAt0.x - 60, top: chipAt0.y - 40, right: chipAt0.x + 60, bottom: chipAt0.y + 40 };
    assert.equal(eng.setUiChromeRects({ rects: [chipRect], origin: { x: 0, y: 0 } }), true, "② 公共面接受发布");
    assert.deepEqual(uiRects().rects, [chipRect], "② 矩形集入缓存（引擎侧只比对数组）");
    step(1);
    assert.ok(!chipEl.classList.contains("on"), "② chip 与动作条矩形相交 → 本帧淡出隐藏");
    assert.equal(chipEl.style.opacity, "", "② 隐藏帧清内联 opacity（与既有显隐路径同一条，无残影）");
    assert.equal(tips().filter((line) => line.kind === "chip").length, chipLines0 - 1,
      "② 隐藏帧该 chip 不产引线条目（引线随可见性同帧不画）");

    /* ③ 命中门禁（spec「命中门禁兜底竞态帧」）：pointerdown 落点门禁 + click 一次性消费 */
    const dives0 = eng.inspectInput().dives;
    fire(chipEl, "pointerdown", { clientX: chipAt0.x, clientY: chipAt0.y - 10 });
    eng.setUiChromeRects({ rects: [], origin: { x: 0, y: 0 } }); // 矩形瞬时空（模拟重发布的窗口）
    fire(chipEl, "click", { clientX: chipAt0.x, clientY: chipAt0.y - 10 });
    assert.equal(eng.inspectInput().dives, dives0, "③ pointerdown 命中铬件 → 随后 click 被一次性抑制（竞态帧不 dive）");
    /* click 复检单独生效（无 pointerdown 布防）：落点仍在矩形内 → 不 dive */
    eng.setUiChromeRects({ rects: [chipRect], origin: { x: 0, y: 0 } });
    step(1);
    fire(chipEl, "click", { clientX: chipAt0.x, clientY: chipAt0.y - 10 });
    assert.equal(eng.inspectInput().dives, dives0, "③ click 落点复检：矩形更新窗口内同样不 dive");
    /* 一次性抑制自愈：下一次独立点击不被误杀 */
    eng.setUiChromeRects({ rects: [], origin: { x: 0, y: 0 } });
    step(1);

    /* ④ 逐帧可逆（spec「chip 随相机漂移即时收敛」）：移除矩形 → 复现；再发布 → 再隐藏 */
    assert.ok(chipEl.classList.contains("on"), "④ 矩形移除后下一帧复现（逐帧可逆）");
    const chipAt1 = parseTranslate(chipEl.style.transform);
    eng.setUiChromeRects({ rects: [{ kind: "panel", left: chipAt1.x - 60, top: chipAt1.y - 40, right: chipAt1.x + 60, bottom: chipAt1.y + 40 }], origin: { x: 0, y: 0 } });
    step(1);
    assert.ok(!chipEl.classList.contains("on"), "④ 再次落入矩形 → 再次隐藏（无滞回、无记忆）");
    /* 相机/布局漂移把 chip 移出固定矩形 → 同一帧链上复现 */
    eng.setScene(twoWsScene([220, 0, 0]), "rebuild");
    step(2);
    const chipAt2 = parseTranslate(chipEl.style.transform);
    assert.ok(chipEl.classList.contains("on"), "④ 投影漂移离开矩形 → 复现（相机连续性）");
    assert.ok(chipAt2.x > chipAt1.x + 80, "④ 夹具确认：chip 确实移开（世界 +220 → 屏显右移）");

    /* ⑤ 信息卡 UI 感知钳位（spec「信息卡钳位到自由区」+「浮签不拦截铬件命中」） */
    eng.setScene(twoWsScene(), "rebuild"); // 回到原点星座：卡的自然侧 = 右（翻转 MUST 由面板引起）
    step(16); // 等重建后的星座中心滑移补间收尾（投影稳定后再取 hover 点）
    const starWorld = eng.inspectEntities("ws1").stars[0].wp;
    const starScreen = screenPoint(starWorld);
    const hoverStar = () => { fire(rootEl, "pointermove", { pointerId: 71, clientX: starScreen.x, clientY: starScreen.y, buttons: 0, target: canvasEl }); };
    hoverStar();
    step(3);
    assert.ok(cardEl.classList.contains("on"), "⑤ hover 恒星 → 信息卡呈现（避让前置）");
    const cardAt0 = parseTranslate(cardEl.style.transform);
    assert.ok(!String(cardEl.style.transform).includes("translateX(-100%)"), "⑤ 无铬件时卡在星右侧（自然形态，翻转断言归因前置）");
    const panelRect = { kind: "panel", left: Math.round(starScreen.x), top: 0, right: 800, bottom: 600 };
    eng.setUiChromeRects({ rects: [panelRect], origin: { x: 0, y: 0 } });
    step(2);
    const cardAt1 = parseTranslate(cardEl.style.transform);
    assert.ok(String(cardEl.style.transform).includes("translateX(-100%)"), "⑤ 全高面板遮挡 → 卡翻转至面板另一侧（dir 取反）");
    assert.ok(cardAt1.x <= panelRect.left, "⑤ 翻转后卡右缘落在面板左缘之外（自由区落位）");
    assert.ok(cardAt1.x !== cardAt0.x, "⑤ 落位确实被避让改写（非原候选位）");
    const cardLine1 = tips().find((line) => line.kind === "card");
    assert.ok(cardLine1, "⑤ 钳位帧仍有引线（不画空线）");
    assert.equal(cardLine1.x, cardAt1.x, "⑤ 引线止点 = 避让后 DOM translate 的同一组数（端点同源）");
    assert.ok(cardLine1.x < cardLine1.hx, "⑤ 翻转侧引线自星左缘折向卡右近缘（起笔随卡侧）");
    const tipGeo = tipLeaderOf(cardLine1);
    assert.ok(tipGeo && tipGeo.pts.length >= 2, "⑤ 引线折点可用（引线连续不截断）");
    /* 面板行/按钮不被抢：落点在面板矩形内的卡内按钮点击 MUST NOT 执行动作 */
    const openedBefore = openedSessions;
    fire(cardEl, "click", { target: falseBtn("open", "sess-1"), clientX: 600, clientY: 300 });
    assert.equal(openedSessions, openedBefore, "⑤ 落点在铬件矩形内 → 卡内动作被门禁拦截（面板行不被抢）");
    /* 离开相交（矩形撤除）→ 点击直达（事件级判定、无持久 DOM 改写） */
    eng.setUiChromeRects({ rects: [], origin: { x: 0, y: 0 } });
    step(2);
    fire(cardEl, "click", { target: falseBtn("open", "sess-1"), clientX: 600, clientY: 300 });
    assert.equal(openedSessions, openedBefore + 1, "⑤ 矩形撤除后同一按钮点击直达 onOpenSession（无死区残留）");

    /* ⑥ 场景 C（spec「极端窄容器降级放行」+「矩形契约缺席安全降级」） */
    eng.setUiChromeRects({ rects: [{ kind: "panel", left: 0, top: 0, right: 800, bottom: 600 }], origin: { x: 0, y: 0 } });
    step(2);
    assert.equal(cardEl.style.pointerEvents, "none", "⑥ 无自由空间 → 整卡 pe:none 降级（命中放行）");
    assert.ok(cardEl.classList.contains("on"), "⑥ 降级帧卡体仍呈现（可读）");
    assert.ok(tips().some((line) => line.kind === "card"), "⑥ 降级帧引线仍在（视觉保留）");
    eng.setUiChromeRects({ rects: [], origin: { x: 0, y: 0 } });
    step(2);
    assert.equal(cardEl.style.pointerEvents, "", "⑥ 离开相交 → 恢复 pe:auto（内联单点清回）");
    assert.ok(!cardEl.style.pointerEvents, "⑥ 恢复为内联空值（回落到 CSS 的 pe:auto）");
    assert.equal(eng.setUiChromeRects(null), true, "⑥ 公共面接受 null = 清空矩形集（安全降级）");
    assert.deepEqual(uiRects().rects, [], "⑥ null → 零矩形集");
    assert.equal(eng.setUiChromeRects({ rects: "bad" }), false, "⑥ 非法载荷 → false 且不抛错");
    assert.deepEqual(uiRects().rects, [], "⑥ 非法载荷不改缓存");

    /* ⑦ 复现后点击 chip 直达 dive（无死区残留；随后进入钻取态供 HUD 兜底断言） */
    eng.setUiChromeRects({ rects: [], origin: { x: 0, y: 0 } });
    step(2);
    const chipAt3 = parseTranslate(chipEl.style.transform);
    const dives1 = eng.inspectInput().dives;
    assert.ok(chipEl.classList.contains("on"), "⑦ 契约撤除后 chip 可见（复现）");
    fire(chipEl, "click", { clientX: chipAt3.x, clientY: chipAt3.y - 10 });
    assert.equal(eng.inspectInput().dives, dives1 + 1, "⑦ 复现后点击 chip 直达 dive（无持久命中死区）");

    /* ⑧ 引擎自建 HUD 兜底（3.3）：切换条目相交退场 / 自遮挡排除 / 离开恢复 */
    fakeNow += 1300;
    step(3);
    const rightSide = rootEl._by['.cos-wsbar-side[data-side="right"]'];
    const wsItem = rightSide?.children?.[0];
    assert.ok(wsItem, "⑧ 钻取态切换条目已建树");
    assert.ok(wsItem.classList.contains("on"), "⑧ 钻取态：另一星座条目挂载可见");
    const selfRect = { kind: "wsbar-right", left: 100, top: 10, right: 300, bottom: 60 };
    eng.setUiChromeRects({ rects: [selfRect], origin: { x: 0, y: 0 } });
    step(1);
    assert.ok(wsItem.classList.contains("on"), "⑧ 只有自身槽矩形 → 自遮挡排除生效（条目未与自己相交）");
    eng.setUiChromeRects({
      rects: [selfRect, { kind: "panel", left: 0, top: 0, right: 400, bottom: 100 }],
      origin: { x: 0, y: 0 }
    });
    step(1);
    assert.ok(!wsItem.classList.contains("on"), "⑧ 条目槽与面板矩形相交 → 该侧条目退场（兜底）");
    eng.setUiChromeRects({
      rects: [selfRect, { kind: "panel", left: 600, top: 0, right: 800, bottom: 100 }],
      origin: { x: 0, y: 0 }
    });
    step(1);
    assert.ok(wsItem.classList.contains("on"), "⑧ 离开相交 → 条目恢复（幂等、可逆）");

    /* ⑨ 回到银河 / 拖拽开关：相交让位（class 单点）+ 命中门禁 */
    const homeEl = overlayEl.children.find((el) => String(el.className).startsWith("cos-home-btn"));
    const dragEl = overlayEl.children.find((el) => String(el.className).startsWith("cos-dragpan-btn"));
    assert.ok(homeEl && dragEl, "⑨ 引擎自建 HUD 已建树");
    const homeRect = { kind: "home", left: 700, top: 500, right: 744, bottom: 544 };
    eng.setUiChromeRects({
      rects: [homeRect, { kind: "actions", left: 600, top: 520, right: 800, bottom: 600 }],
      origin: { x: 0, y: 0 }
    });
    step(1);
    assert.ok(homeEl.classList.contains("cos-hud-occluded"), "⑨ home 与动作条矩形相交 → 遮挡让位（视觉退场 + 命中放行）");
    assert.ok(!dragEl.classList.contains("cos-hud-occluded"), "⑨ dragpan 自身矩形未发布 → 不参与（按未命中）");
    for (let i = 0; i < 80 && eng.inspectFilter().tween; i += 1) { fakeNow += 120; step(1); }
    assert.equal(eng.inspectFilter().tween, null, "⑨ 钻取补间已收尾（门禁断言前置）");
    fire(homeEl, "click", { clientX: 720, clientY: 530 });
    assert.equal(eng.inspectFilter().tween, null, "⑨ 遮挡态点击 home 不执行 flyOut（门禁兜底，键盘 Esc 仍在）");
    eng.setUiChromeRects({
      rects: [homeRect, { kind: "actions", left: 0, top: 0, right: 100, bottom: 100 }],
      origin: { x: 0, y: 0 }
    });
    step(1);
    assert.ok(!homeEl.classList.contains("cos-hud-occluded"), "⑨ 离开相交 → home 恢复");
    fire(homeEl, "click", { clientX: 720, clientY: 530 });
    assert.ok(eng.inspectFilter().tween, "⑨ 恢复后点击 home 正常 flyOut（补间已启动）");
  } finally {
    eng.stop();
    eng.dispose();
  }
}

/* C. 浮窗模态等价覆盖（D2 / 「矩形契约缺席安全降级」等价面）：`isFloatOpen` 探针为真
      ⇒ `.dsh-cosmos-const-float`（inset:0 + z-9998 全屏 backdrop）的「矩形」恒等于整屏，
      浮签整体让位——零矩形通道、零开合订阅。 */
{
  const container = stubEl("div");
  const eng = createCosmosEngine({ container, style: createSkinD(), isFloatOpen: () => true });
  try {
    const rootEl = container.children[0];
    const overlayEl = rootEl._by[".cos-overlay"];
    eng.setScene(miniScene(), "rebuild");
    rafQ.length = 0;
    eng.start();
    let t = 30000;
    for (let i = 0; i < 28; i += 1) { t += 50; stepFrame(t); }
    const chipEl = overlayEl.children.find((el) => String(el.className).startsWith("cos-chip"));
    assert.ok(chipEl, "⑩ 模态引擎：chip 已建树");
    assert.ok(!chipEl.classList.contains("on"), "⑩ 浮窗模态 → chip 让位（等价整屏矩形，零矩形发布）");
    assert.ok(!eng.inspectTipLines().some((line) => line.kind === "chip"), "⑩ 模态态不产 chip 引线");
    assert.deepEqual(eng.inspectUiRects().rects, [], "⑩ 模态态不必发布矩形（探针即整屏）");
  } finally {
    eng.stop();
    eng.dispose();
  }
}

/* ── 浮签呈现层级与引线层（polish-cosmos-tip-topmost-layer 2.4 / 3.2 静态面）：
      overlay 抬层 46（压过交互 HUD ≤45、压不过 toast 47/浮窗/提示行 58）、详情卡
      overlay 内 z:25 恒压过 chip/slab、引擎 toast 47 恒压过浮签；引线层 = overlay
      首子 canvas、与主画布恒等尺寸、pointer-events:none；摘除帧清屏先于空帧早退
      （无残影）。 ── */
{
  /* ① CSS 契约（静态规则抽取）：选择器+花括号字面量只在真实规则处出现，首个命中即规则体 */
  const ruleOf = (selector) => {
    const m = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}").exec(ENGINE_CSS);
    return m ? m[1] : "";
  };
  assert.ok(/z-index:\s*46/.test(ruleOf(".cos-overlay")), "overlay z-index 46（压过全部交互 HUD ≤45 档）");
  assert.ok(/z-index:\s*25/.test(ruleOf(".cos-card")), "详情卡 overlay 内 z-index 25（恒压过 chip/slab 与 wsbar/home 20）");
  assert.ok(/z-index:\s*47/.test(ruleOf(".cos-toast")), "引擎 toast z-index 47（反馈层恒高于浮签 46）");
  assert.ok(!/z-index/.test(ruleOf(".cos-chip")), "chip 无 z-index（auto，DOM 序）——重叠时详情卡恒在其上");
  const tipRule = ruleOf(".cos-tiplines");
  assert.ok(/pointer-events:\s*none/.test(tipRule), "引线层 pointer-events:none（MUST NOT 参与拾取）");
  assert.ok(/position:\s*absolute/.test(tipRule) && /inset:\s*0/.test(tipRule), "引线层继承 overlay 定位（absolute inset 0 铺满全层）");

  /* ② DOM 结构与尺寸同步（同一 resize 路径）：引线 canvas 为 overlay 首子元素，
     位图与 CSS 尺寸与主画布恒等（MUST NOT 层间尺寸漂移）。 */
  const container = stubEl("div");
  const eng = createCosmosEngine({ container, style: createSkinD() });
  try {
    const rootEl = container.children[0];
    const markup = String(rootEl.innerHTML);
    const overlayAt = markup.indexOf('<div class="cos-overlay">');
    assert.ok(overlayAt >= 0, "overlay 容器在册（ensureDom 产物）");
    assert.ok(/^<div class="cos-overlay">\s*<canvas class="cos-tiplines"><\/canvas>/.test(markup.slice(overlayAt)),
      "引线层为 overlay 首子元素（首子位 = 引线恒居浮签本体之下）");
    const mainCanvas = rootEl._by[".cos-canvas"];
    const tipCanvas = rootEl._by[".cos-tiplines"];
    assert.equal(tipCanvas.tag, "canvas", "引线层为 canvas 载体（非 DOM/SVG 图形元素）");
    assert.equal(typeof tipCanvas.getContext, "function", "引线层可取 2d context");
    assert.equal(tipCanvas.width, mainCanvas.width, "引线层位图宽 = 主画布位图宽（同一 resize 路径）");
    assert.equal(tipCanvas.height, mainCanvas.height, "引线层位图高 = 主画布位图高");
    assert.equal(tipCanvas.style.width, mainCanvas.style.width, "引线层 CSS 宽 = 主画布 CSS 宽");
    assert.equal(tipCanvas.style.height, mainCanvas.style.height, "引线层 CSS 高 = 主画布 CSS 高");
  } finally {
    eng.stop();
    eng.dispose();
  }

  /* ③ 每帧清空契约：记录型 ctx 直挂引线层——可见帧「清屏先于描线」、摘除帧清屏仍执行
     且零描边（无残影）；清屏以 CSS 像素坐标覆盖整层。桩皮肤 drawBody/background 零描边
     ⇒ stroke()/clearRect() 只可能来自引线描线入口。 */
  const ctxRec = recordingCtx();
  ctxFactory = () => ctxRec;
  const rec = ctxRec.__rec;
  const layerStyle = {
    skin: "stub-tiplayer", useBand: false,
    palette: {
      prop: { proto: "#8a9bc0", created: "#9fd8ff", reviewed: "#cfe8ff", executed: "#ffe27a" },
      sess: { idle: "#a8b8d8", busy: "#54c8ff", waiting: "#ffaa4a", "done-unread": "#5affc0", free: "#cfeaff" },
      accent: "#00ff88"
    },
    gold: "#ff00ff",
    background() {},
    drawBody() {}
  };
  const layerContainer = stubEl("div");
  const layerEng = createCosmosEngine({ container: layerContainer, style: layerStyle });
  try {
    layerEng.setScene(miniScene(), "rebuild");
    rafQ.length = 0;
    layerEng.start();
    let tNow = 90000;
    const step = (n = 1) => { for (let i = 0; i < n; i++) { tNow += 50; stepFrame(tNow); } };
    step(27); // 过冷启动序曲

    /* 可见帧：chip 引线描线，清屏恰好一次、覆盖整层且先于描线 */
    rec.strokes.length = 0; rec.clears.length = 0; rec.ops.length = 0;
    step(1);
    assert.equal(layerEng.inspectTipLines().length, 1, "银河态 chip 引线在册（可见帧前置）");
    assert.deepEqual(rec.clears, [[0, 0, 800, 600]], "可见帧清屏恰好一次且覆盖整层（CSS 像素全幅）");
    assert.equal(rec.ops[0], "clear", "清屏先于描线（操作序首位 = 清屏）");
    assert.equal(rec.ops.length, 2, "可见帧操作序 = 清屏 + 描线（无多余写层）");
    assert.equal(rec.strokes.length, 1, "可见帧每浮签一次描边");

    /* 摘除帧：场景清空（浮签全摘）→ 清屏仍执行、零描边——独立引线层不被主循环
       清屏，早退不清屏会残留上一帧引线（spec「MUST NOT 残影」红线）。 */
    layerEng.setScene({ workspaces: [] }, "rebuild");
    rec.strokes.length = 0; rec.clears.length = 0; rec.ops.length = 0;
    step(1);
    assert.deepEqual(layerEng.inspectTipLines(), [], "摘除帧：E.tipLines 空");
    assert.deepEqual(rec.clears, [[0, 0, 800, 600]], "摘除帧清屏仍执行（清屏先于空帧早退）");
    assert.equal(rec.ops.length, 1, "摘除帧操作序 = 仅清屏（无描边）");
    assert.equal(rec.strokes.length, 0, "摘除帧零描边（引线层无残影）");
    step(2);
    assert.equal(rec.clears.length, 3, "连续空帧每帧都清（早退不清屏的回归路径被契约覆盖）");
  } finally {
    layerEng.stop();
    layerEng.dispose();
    ctxFactory = stubCtx2d;
  }
}

/* ── 4.3 全局快捷键键位（add-cosmos-shortcuts 4.3）：goHome（缺省 ~，钻取态 flyOut /
      银河态 no-op）/ togglePan（缺省 M，翻转 + 持久化回调）/ 组合键改绑命中 / 修饰键与
      焦点守卫 / 组字与连发 / 按钮聚焦不守卫 / 热更改绑 / 浮窗模态让位。
      与 WASD/空格**同一 window keydown handler**（零新增监听面）。 ── */
{
  /** 单星座单恒星夹具（off=0 → 屏心可拾取；diveToWs 确定可达）。 */
  function shortcutScene() {
    return {
      workspaces: [{
        id: "sc", name: "shortcut-ws", pos: [0, 0, 0],
        stars: [{ id: "sc-s", name: "s", lifecycle: "executed", setBy: null, at: null, tasks: [1, 1], age: "刚刚", act: 0, off: [0, 0, 0] }],
        links: [], planets: [], comets: [], archives: 0, satelliteCount: 0
      }]
    };
  }
  const before = windowListeners.keydown.length;
  /* 卸载观测：桩 window 的 removeEventListener 恒 no-op → 本段临时记录解绑调用，
     断言 dispose 真实移除了本引擎的 window keydown 监听（页关零监听）。 */
  const removed = [];
  const prevRemove = globalThis.window.removeEventListener;
  globalThis.window.removeEventListener = (type, fn) => { removed.push({ type, fn }); };
  const toggles = [];
  let floatOpen = false;
  const container = stubEl("div");
  const eng = createCosmosEngine({
    container,
    style: createSkinD(),
    settings: {
      panSpeed: 120, panShiftBoost: 3,
      zoomPointerFocus: true, dragPan: false,
      shortcuts: { closePage: "Escape", goHome: "Backquote", togglePan: "KeyM", voiceToggle: "Ctrl+KeyQ" }
    },
    onDragPanToggle: (enabled) => toggles.push(enabled),
    isFloatOpen: () => floatOpen
  });
  const root = container.children[0];
  const dragBtn = createdEls.filter((el) => el.className === "cos-dragpan-btn").pop();
  const handlers = windowListeners.keydown.slice(before);
  assert.equal(handlers.length, 1, "快捷键与 WASD/空格共享同一 window keydown handler（零新增监听面）");
  const press = (code, modifiers) => {
    let prevented = false;
    const ev = {
      code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
      isComposing: false, repeat: false, keyCode: 0,
      preventDefault() { prevented = true; },
      ...(modifiers ?? {})
    };
    for (const fn of handlers) fn(ev);
    return prevented;
  };
  rafQ.length = 0;
  fakeNow = 900000;
  let tNow = 900000;
  const step = () => { tNow += 50; stepFrame(tNow); };
  eng.setScene(shortcutScene(), "rebuild");
  eng.start();
  for (let i = 0; i < 27; i++) step(); // 过冷启动序曲

  /* ① 构造初值：设置注入的快捷键表（净房同源） */
  assert.deepEqual(eng.getShortcuts(), {
    closePage: "Escape", goHome: "Backquote", togglePan: "KeyM", voiceToggle: "Ctrl+KeyQ"
  }, "构造读 settings.shortcuts 初值");

  /* ② 银河态 `~` → no-op（不清选中、不动镜头、不拦截默认行为） */
  assert.equal(eng.isDiving(), false, "初始银河态");
  const camBefore = JSON.stringify(eng.inspectFilter().tween ?? null);
  assert.equal(press("Backquote"), false, "银河态 ~ → no-op（不 preventDefault、不清选中）");
  assert.equal(eng.inspectSelection(), null, "银河态 ~ 不产生选中变化");
  assert.equal(JSON.stringify(eng.inspectFilter().tween ?? null), camBefore, "银河态 ~ 不动镜头补间");

  /* ③ togglePan：`M` 翻转开关 → 与按钮点击同一状态链（视觉 + 持久化回调） */
  assert.equal(eng.getTuning().dragPan, undefined, "开关镜像不进 getTuning（既有口径不变）");
  assert.equal(dragBtn.attrs["aria-pressed"], "false", "初始关闭态");
  assert.equal(press("KeyM"), true, "M 命中 → preventDefault");
  assert.equal(dragBtn.attrs["aria-pressed"], "true", "键盘翻转 → aria-pressed 同步点亮");
  assert.deepEqual(toggles, [true], "持久化回调写穿目标态（与按钮同一链路）");
  assert.equal(press("KeyM"), true, "再按一次");
  assert.equal(dragBtn.attrs["aria-pressed"], "false", "再按翻回关闭");
  assert.deepEqual(toggles, [true, false], "回调每次目标态写穿");

  /* ④ 按钮点击与键盘三入口一致（键盘翻到开启后点按钮 → 关闭语义） */
  assert.equal(press("KeyM"), true);
  assert.equal(dragBtn.attrs["aria-pressed"], "true", "键盘翻至开启");
  for (const fn of dragBtn.listeners.click ?? []) fn({});
  assert.equal(dragBtn.attrs["aria-pressed"], "false", "点击按「关闭」语义翻转（无双写分叉）");
  assert.deepEqual(toggles, [true, false, true, false], "按钮与键盘共用同一条状态链");

  /* ⑤ 修饰键裁决（D8b）：Shift/Meta 恒跳过；Ctrl/Alt 精确匹配（配置不含则不消费） */
  const togglesBefore = toggles.length;
  assert.equal(press("KeyM", { shiftKey: true }), false, "Shift+M 不触发（加速档语义位）");
  assert.equal(press("KeyM", { metaKey: true }), false, "Meta+M 不触发（系统语义）");
  assert.equal(press("KeyM", { ctrlKey: true }), false, "Ctrl+M ≠ M（配置不含修饰 → 不消费）");
  assert.equal(press("KeyM", { altKey: true }), false, "Alt+M ≠ M");
  assert.equal(toggles.length, togglesBefore, "修饰键组合零翻转");

  /* ⑥ 组字与连发守卫 */
  assert.equal(press("KeyM", { isComposing: true }), false, "组字中 M 不触发（键归输入法）");
  assert.equal(press("KeyM", { keyCode: 229 }), false, "keyCode 229（Chromium 组字报键）不触发");
  assert.equal(press("KeyM", { repeat: true }), false, "按住连发忽略（不抖动）");
  assert.equal(toggles.length, togglesBefore, "守卫命中零翻转");

  /* ⑦ 输入聚焦守卫（可编辑元素让位）；**chrome 聚焦不构成守卫**（D12 分档 + 真机反馈修订：
     点击提案卡片/会话行后焦点滞留在面板内按钮上，「选中后按键」是主流程） */
  globalThis.document.activeElement = { tagName: "INPUT", isContentEditable: false };
  assert.equal(press("KeyM"), false, "可编辑聚焦 → M 不触发（字符进输入框）");
  assert.equal(press("Backquote"), false, "可编辑聚焦 → ~ 不触发");
  globalThis.document.activeElement = null;
  const chromeEl = { tagName: "BUTTON", isContentEditable: false };
  chromeEl.closest = (sel) => (String(sel).includes(".dsh-cosmos-panel") ? { tagName: "ASIDE" } : null);
  globalThis.document.activeElement = chromeEl;
  assert.equal(press("KeyM"), true, "面板卡片（chrome 内按钮）聚焦 → M 照常触发（chrome 不构成守卫）");
  assert.equal(toggles.length, togglesBefore + 1, "面板卡片聚焦路径完成一次翻转");
  const chromeDiv = { tagName: "DIV", isContentEditable: false };
  chromeDiv.closest = (sel) => (String(sel).includes(".dsh-cosmos-sessions") ? { tagName: "ASIDE" } : null);
  globalThis.document.activeElement = chromeDiv;
  assert.equal(press("KeyM"), true, "会话面板容器聚焦 → M 照常触发（同上）");
  assert.equal(toggles.length, togglesBefore + 2, "会话面板路径完成一次翻转");
  globalThis.document.activeElement = null;
  const btnEl = { tagName: "BUTTON", isContentEditable: false, closest: () => null };
  globalThis.document.activeElement = btnEl;
  assert.equal(press("KeyM"), true, "按钮聚焦 → M 照常触发（非原生激活键，按钮聚焦不构成守卫）");
  assert.equal(toggles.length, togglesBefore + 3, "按钮聚焦路径完成一次翻转");
  globalThis.document.activeElement = null;
  assert.equal(toggles.length, togglesBefore + 3);

  /* ⑧ 钻取态 `~` → flyOut（与右下按钮 / Esc 第一层等效） */
  const settle = () => { fakeNow += 1400; for (let i = 0; i < 30; i += 1) step(); };
  assert.equal(eng.diveToWs("sc"), true, "钻取到快捷键场景");
  fakeNow += 1400;
  step();
  assert.equal(eng.isDiving(), true, "钻取态成立");
  assert.equal(press("Backquote"), true, "钻取态 ~ 命中 → preventDefault");
  settle();
  assert.equal(eng.isDiving(), false, "~ 飞回银河（同一 flyOut 链路，补间收尾后状态归零）");
  assert.equal(press("Backquote"), false, "飞回后再按 → 银河态 no-op（不拦截）");

  /* ⑨ 组合键改绑热更命中（Alt+KeyH）；旧键失效 */
  eng.setShortcuts({ goHome: "Alt+KeyH" });
  assert.equal(eng.getShortcuts().goHome, "Alt+KeyH", "热更写穿");
  assert.equal(eng.diveToWs("sc"), true, "再次钻取");
  fakeNow += 1400;
  step();
  assert.equal(press("Backquote"), false, "改绑后旧键 ~ 不再命中");
  assert.equal(eng.isDiving(), true, "旧键零行为（仍在钻取态）");
  assert.equal(press("KeyH"), false, "无修饰 H 不命中组合键绑定");
  assert.equal(press("KeyH", { altKey: true }), true, "Alt+H 精确命中 → preventDefault");
  settle();
  assert.equal(eng.isDiving(), false, "组合键飞回银河");
  assert.equal(press("KeyH", { altKey: true, shiftKey: true }), false, "Shift+Alt+H 不触发（Shift 裁决跳过）");

  /* ⑩ setShortcuts 部分写语义（非法值/缺席键保持原值；幂等；净房无重复） */
  eng.setShortcuts({ goHome: "F5" });
  assert.equal(eng.getShortcuts().goHome, "Alt+KeyH", "池外值被忽略（保持原值，不抛错）");
  eng.setShortcuts({ goHome: 42 });
  assert.equal(eng.getShortcuts().goHome, "Alt+KeyH", "非字符串被忽略");
  eng.setShortcuts(null);
  assert.equal(eng.getShortcuts().goHome, "Alt+KeyH", "null 入参不抛错");
  eng.setShortcuts({ togglePan: "F2", goHome: "F2" });
  const hot = eng.getShortcuts();
  assert.equal(new Set(Object.values(hot)).size, 4, "热更后净房表恒无重复（冲突按优先序回落）");
  assert.equal(hot.goHome, "F2", "goHome 按优先序保留 F2");
  assert.notEqual(hot.togglePan, "F2", "togglePan 冲突回落缺省（KeyM）");

  /* ⑪ 浮窗模态让位（D13）：浮窗打开时 goHome/togglePan 不分发；收起即恢复 */
  assert.equal(eng.diveToWs("sc"), true, "再次钻取（让位断言前置）");
  fakeNow += 1400;
  step();
  assert.equal(eng.isDiving(), true, "钻取态成立");
  const togglesAtFloat = toggles.length;
  floatOpen = true;
  assert.equal(press("F2"), false, "浮窗打开 → goHome（F2）零分发");
  assert.equal(press("KeyM"), false, "浮窗打开 → togglePan（M）零分发");
  assert.equal(eng.isDiving(), true, "星空状态零变化（仍在钻取态）");
  assert.equal(toggles.length, togglesAtFloat, "浮窗打开 → 零翻转");
  floatOpen = false;
  assert.equal(press("F2"), true, "浮窗关闭 → goHome 立即恢复");
  settle();
  assert.equal(eng.isDiving(), false, "恢复后完成飞回");
  assert.equal(press("KeyM"), true, "浮窗关闭 → togglePan 恢复");
  assert.equal(toggles.length, togglesAtFloat + 1, "恢复后完成一次翻转");

  /* ⑫ 卸载零监听（整页关闭后 Cosmos 不持有键盘监听） */
  eng.dispose();
  assert.ok(
    removed.some((entry) => entry.type === "keydown" && entry.fn === handlers[0]),
    "dispose 真实移除本引擎的 window keydown 监听（页关零监听）"
  );
  assert.equal(windowListeners.keydown.length, before + 1, "创建时注册一个、卸载时移除同一函数（无监听面泄漏）");
  assert.equal(press("F2"), false, "卸载后不再消费任何键位");
  globalThis.window.removeEventListener = prevRemove;
}

/* ── 星胚移除入口迁出 tips（add-cosmos-embryo-dismiss-button 4.x / spec cosmos-embryo-dismiss
      「画布卡不再承载移除入口」「动作条直执行移除入口」）──
   覆盖：proto 星卡**无按钮行**（无 dismiss 钩子 / 无确认态文案 / 无禁用态）、正式提案星卡
   同样无按钮行、卡内点击分流保持既有会话动作口径（旧 dismiss markup 静默忽略）、
   proto→created 同 id 翻转仍重建卡片（状态行刷新、无 dismiss 残留）。
   直执行链路行为面直测在 test/actions-smoke.mjs 4e。 */
{

  const dismissScene = (protoLifecycle = "proto") => ({
    workspaces: [{
      id: "emb", name: "embryo-ws", pos: [0, 0, 0],
      stars: [
        { id: "embryo-a", name: "embryo-a", lifecycle: protoLifecycle, setBy: "cosmos-explore", at: 1700000000000, tasks: [0, 0], age: "刚刚", act: 0, off: [-26, 0, 0] },
        { id: "formal-b", name: "formal-b", lifecycle: "reviewed", setBy: "cosmos-review", at: 1700000000001, tasks: [1, 2], age: "刚刚", act: 0, off: [26, 0, 0] }
      ],
      links: [], planets: [], comets: [], archives: 0, satelliteCount: 0
    }]
  });

  /** 引擎装配（每例独立实例；返回 hover/click/帧步进工具）。 */
  const harness = (extra) => {
    const container = stubEl("div");
    const eng = createCosmosEngine({ container, style: createSkinD(), ...(extra ?? {}) });
    const rootEl = container.children[0];
    rafQ.length = 0;
    fakeNow = 830000;
    let tNow = fakeNow;
    eng.setScene(dismissScene(), "rebuild");
    eng.start();
    const step = (n = 1) => { for (let i = 0; i < n; i++) { tNow += 50; stepFrame(tNow); } };
    step(27); // 过冷启动序曲
    const canvasEl = rootEl._by[".cos-canvas"];
    const cardEl = rootEl._by[".cos-card"];
    const fire = (type, ev) => { for (const fn of rootEl.listeners[type] ?? []) fn(ev); };
    /* 世界 → 屏幕（与引擎 project 同式：默认 fov 60 / 视口 800×600 桩）。 */
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
    const hoverStar = (id) => {
      const star = eng.inspectEntities("emb").stars.find((s) => s.id === id);
      const p = screenOf(star.wp);
      fire("pointermove", { pointerId: 1, clientX: p.x, clientY: p.y, buttons: 0, target: canvasEl });
      step(3); // 第 1 帧写入 E.hovered，第 2 帧起落卡
    };
    const click = (target) => { for (const fn of cardEl.listeners.click ?? []) fn({ target }); };
    return { eng, rootEl, canvasEl, cardEl, step, hoverStar, click };
  };

  /** 信息卡按钮桩：`.cd-btn` 分流桩（旧 dismiss markup 已无渲染，本桩只作外部陈旧 DOM 回归）。 */
  const buttonTargetOf = (action, sessionId) => ({
    disabled: false,
    textContent: "",
    classList: { contains: (cls) => cls === "cd-btn" },
    getAttribute: (key) => ({
      "data-action": action,
      "data-session": sessionId
    })[key] ?? null
  });

  /* ① proto 星卡无按钮行；正式提案星卡同样无按钮（移除入口已迁动作条） */
  {
    const h = harness();
    h.hoverStar("embryo-a");
    const protoHtml = String(h.cardEl.innerHTML);
    assert.ok(!protoHtml.includes("dismiss-embryo"), "星胚卡 MUST NOT 呈现移除按钮");
    assert.ok(!protoHtml.includes("移除星胚"), "tips 按钮文案面已退役（无确认态残留）");
    assert.ok(!protoHtml.includes("cd-actions"), "星胚卡「无」按钮行（回归纯信息呈现）");
    assert.ok(protoHtml.includes("待创建") && !protoHtml.includes("活力"), "星胚卡：生命周期待创建 + 豁免活力行（既有口径）");

    h.hoverStar("formal-b");
    const formalHtml = String(h.cardEl.innerHTML);
    assert.ok(!formalHtml.includes("dismiss-embryo"), "正式提案恒星卡同样无移除按钮");
    assert.ok(!formalHtml.includes("cd-actions"), "正式提案恒星卡保持无按钮行");
    h.eng.dispose();
  }

  /* ② 卡内点击分流：旧 dismiss markup（外部注入 / 陈旧 DOM）静默忽略；会话类动作零变化 */
  {
    const opened = [];
    const h = harness({ onOpenSession: (sessionId) => opened.push(sessionId) });
    h.hoverStar("embryo-a");
    const htmlBefore = String(h.cardEl.innerHTML);
    const sigBefore = String(h.cardEl.dataset.sig);
    const stale = {
      disabled: false,
      textContent: "移除星胚",
      classList: { contains: (cls) => cls === "cd-btn" },
      getAttribute: (key) => ({
        "data-action": "dismiss-embryo",
        "data-ws": "emb",
        "data-slug": "embryo-a"
      })[key] ?? null
    };
    assert.doesNotThrow(() => {
      h.click(stale);
      h.click(stale);
    }, "旧 dismiss 分支已拆除 → 点击静默（无回调面、不抛错）");
    assert.equal(stale.textContent, "移除星胚", "无确认态切换（两击确认已退役）");
    assert.equal(stale.disabled, false, "无在途禁用态（在途门随机制拆除）");
    assert.equal(String(h.cardEl.innerHTML), htmlBefore, "卡片 markup 零变化");
    assert.equal(String(h.cardEl.dataset.sig), sigBefore, "内容签名零变化");
    /* 会话类动作分流口径零变化：带 data-session 的 open 按钮仍走 onOpenSession。 */
    h.click(buttonTargetOf("open", "sess-x"));
    assert.deepEqual(opened, ["sess-x"], "「打开会话」分流逐字不变");
    h.eng.dispose();
  }

  /* ③ proto→created 同 id 翻转：lifecycle 仍在内容签名 → 重建（状态行刷新、无残留） */
  {
    const h = harness();
    h.hoverStar("embryo-a");
    assert.ok(String(h.cardEl.innerHTML).includes("待创建"), "翻转前：状态行「待创建」");
    h.eng.setScene(dismissScene("created"), "patch");
    h.step(2);
    const html = String(h.cardEl.innerHTML);
    assert.ok(html.includes("已创建"), "卡片按新生命周期重建（life: 仍在 sig 内）");
    assert.ok(!html.includes("dismiss-embryo") && !html.includes("移除星胚"), "翻转路径无 dismiss 残留引用");
    h.eng.dispose();
  }

}

/* ── 星云尘埃 α 弱化（polish-cosmos-nebula-faint 3.1/3.2/1.3）：
      引擎侧单点基带 [0.14, 0.34]（原 [0.22, 0.52] ×0.65），全部皮肤同源变淡；
      密度编码（520 上限 / per-ws 播种 / 增量渐入）零变化；闪烁动态范围等比保留。 ── */
{
  assert.equal(NEBULA_ALPHA_BASE, 0.14, "α 基带下界常量（真机校准唯一点）");
  assert.equal(NEBULA_ALPHA_SWING, 0.20, "α 闪烁摆幅常量（动态范围等比保留）");
  assert.ok(NEBULA_ALPHA_BASE + NEBULA_ALPHA_SWING < 1, "α 上界 < 天体本体 α（弱于关系由常量保证）");

  const dustScene = {
    workspaces: [{
      id: "neb", name: "nebula", pos: [0, 0, 0],
      stars: [{ id: "neb-star", name: "neb-star", lifecycle: "executed", setBy: null, at: null, tasks: [1, 1], age: "刚刚", act: 2, off: [0, 0, 0] }],
      links: [], planets: [], comets: [],
      archives: 2, satelliteCount: 0
    }]
  };
  const capture = { dust: null, star: null, nova: null, ghost: null };
  const nebStyle = createSkinD();
  nebStyle.drawBody = function (ctx, it) {
    if (it.ws?.id === "neb") {
      if (it.kind === "dust") capture.dust = it;
      else if (it.kind === "star") capture.star = it;
    }
    if (it.kind === "nova") capture.nova = it;
    if (it.kind === "wsghost") capture.ghost = it;
  };
  const eng = createCosmosEngine({ container: stubEl("div"), style: nebStyle });
  eng.setScene(dustScene, "rebuild");
  rafQ.length = 0;
  eng.start();
  let nebTs = 0;
  const advance = (ms) => { nebTs += ms; stepFrame(nebTs); };
  for (let i = 0; i < 60; i++) advance(40); // 2.4s：序曲（1.2s）/单 ws 点亮坡道（0.5s）均已过 → 稳态

  /* 3.1 α 区间：逐粒 ∈ [BASE, BASE+SWING]；稳态上界（(BASE+SWING)×ws.alpha）< 恒星本体 α。 */
  assert.ok(capture.dust && capture.star, "稳态帧产出尘埃与恒星条目");
  assert.equal(capture.dust.pts.length, 110, "archives=2 → 110 粒（密度编码零变化）");
  assert.ok(Math.abs(capture.dust.alpha - 1) < 1e-12, "稳态 ws.alpha = 1（无过滤/焦点因子）");
  for (const p of capture.dust.pts) {
    assert.ok(p.a >= NEBULA_ALPHA_BASE - 1e-12, "逐粒 α ≥ BASE（born 坡道期亦不低于基带）");
    assert.ok(p.a <= NEBULA_ALPHA_BASE + NEBULA_ALPHA_SWING + 1e-12, "逐粒 α ≤ BASE+SWING");
  }
  const dustMax = Math.max(...capture.dust.pts.map((p) => p.a));
  assert.ok(dustMax < capture.star.alpha,
    "尘埃 α 上界（" + dustMax.toFixed(3) + "）严格弱于恒星本体 α（" + capture.star.alpha.toFixed(3) + "）");

  /* 3.2 动态保留：同一粒 α 随 t 波动，振幅 = SWING（非恒定灰雾）。 */
  const alphaSamples = [];
  for (let i = 0; i < 130; i++) { advance(40); alphaSamples.push(capture.dust.pts[0].a); }
  const span = Math.max(...alphaSamples) - Math.min(...alphaSamples);
  assert.ok(span > NEBULA_ALPHA_SWING * 0.995, "同粒 α 波动幅度 ≈ SWING（实测 " + span.toFixed(4) + "）");
  assert.ok(span <= NEBULA_ALPHA_SWING + 1e-12, "波动幅度不超过 SWING（整体压暗、动态等比）");
  assert.ok(new Set(alphaSamples.map((v) => v.toFixed(6))).size > 100, "α 逐帧变化（非恒定）");

  /* 1.3 回归：消散幽灵 / 超新星归尘不消费引擎 α 基带 → 本变更零影响，转场叙事不变。 */
  capture.ghost = null;
  eng.markWsGhost("neb");
  advance(16);
  assert.ok(capture.ghost, "星座消散幽灵条目在册");
  assert.equal(capture.ghost.alpha, 1, "幽灵条目 α 恒 1（不乘 ws.alpha / 尘埃基带）");
  assert.ok(capture.ghost.k > 0 && capture.ghost.k < 1, "幽灵进度 k ∈ (0,1)");
  capture.ghost.dust.forEach((p) => assert.equal(p.a, 1 - capture.ghost.k, "幽灵尘埃 α = 1−k（独立于星云基带）"));
  capture.ghost.stars.forEach((s) => assert.equal(s.a, 1 - capture.ghost.k, "幽灵恒星余辉 α = 1−k"));
  capture.ghost = null;
  for (let i = 0; i < 40; i++) advance(40); // 1.6s > WS_GHOST_DUR(1.5s)
  capture.ghost = null;
  advance(16);
  assert.equal(capture.ghost, null, "幽灵过期自灭（1.5s 叙事时长不变）");

  capture.nova = null;
  eng.markStarNova("neb-star", [0, 0, 0], "#ffd28a", {});
  advance(16);
  assert.ok(capture.nova, "超新星条目在册（非序曲窗口立即启动）");
  assert.equal(capture.nova.alpha, 1, "nova 自持幽灵 α 恒 1（不乘 ws.alpha / 尘埃基带）");
  assert.ok(capture.nova.k >= 0 && capture.nova.k < 1, "nova 进度 k 由 t 驱动");
  for (let i = 0; i < 70; i++) advance(40); // 2.8s > FX_NOVA_DUR(2.4s)
  capture.nova = null;
  advance(16);
  assert.equal(capture.nova, null, "nova 播完自灭（2.4s 三段叙事不变）");

  eng.stop();
  eng.dispose();
  rafQ.length = 0;
}

/* ── 皮肤 dust 分支消费链（polish-cosmos-nebula-faint 3.3 / add-cosmos-render-budget
      4.1–4.3）：抽测 deepspace / circuit / chamber / lotus——p.a 下游仅固定因子（born 坡道
      常 1），无本地时间二次覆盖、无二次取基（α 与 p.a 严格线性）→ 引擎单点改动跨皮肤
      一致生效。**口径更新**：尘埃改走共享低开销原语（缓存 sprite + 逐粒 drawImage），
      逐粒「填充类」调用 = `fill`/`fillRect`/`drawImage` 三类之一（单粒恰一次）。 ── */
{
  function alphaRecorder() {
    const draws = [];
    const target = { globalAlpha: 1, __draws: draws };
    return new Proxy(target, {
      get(t, prop) {
        if (prop === "__draws") return draws;
        if (prop === "fill" || prop === "fillRect" || prop === "drawImage") {
          return () => draws.push(t.globalAlpha);
        }
        if (!(prop in t)) t[prop] = () => undefined;
        return t[prop];
      },
      set(t, prop, value) { t[prop] = value; return true; }
    });
  }
  const dustAlphaAt = function (skin, a, hue, t) {
    const ctx = alphaRecorder();
    skin.drawBody(ctx, {
      kind: "dust", ws: null, alpha: 1,
      pts: [{ x: 10, y: 10, s: 2, hue, a, born: null }]
    }, { t, W: 800, H: 600 });
    assert.equal(ctx.__draws.length, 1, skin.skin + "：单粒尘埃恰一次绘制（共享原语）");
    return ctx.__draws[0];
  };
  const upper = NEBULA_ALPHA_BASE + NEBULA_ALPHA_SWING;
  ["deepspace", "circuit", "chamber", "lotus"].forEach(function (id) {
    const skin = createSkin(id);
    /* 双 hue 支（lotus/circuit 有分档绘制）均消费 p.a。 */
    for (const hue of [0.2, 0.9]) {
      const low = dustAlphaAt(skin, NEBULA_ALPHA_BASE, hue, 0);
      assert.ok(low > 0, id + "：dust α 由 p.a 驱动（hue=" + hue + "）");
      assert.equal(dustAlphaAt(skin, NEBULA_ALPHA_BASE, hue, 3.7), low,
        id + "：born 完成后无本地时间二次覆盖（p.a 下游仅固定因子）");
      const high = dustAlphaAt(skin, upper, hue, 0);
      assert.ok(Math.abs(high / low - upper / NEBULA_ALPHA_BASE) < 1e-12,
        id + "：α 与 p.a 线性（比例 = 基带上界/下界，hue=" + hue + "）");
    }
  });
}

/* ── 外部悬停注入（p1-add-cosmos-external-hover 4.1 / spec cosmos-external-hover） ──
   覆盖：注入接受 / 幂等 / 降级（未知 ws、未知 kind/id、无场景、已销毁 → false 不抛错）；
   三级仲裁（画布 hover 遮蔽注入、注入遮蔽选中、金色选中环数据标记不受影响）；tips 呈现
   （注入恒星名牌 + 信息卡 data-key、注入行星/彗星信息卡、无投影静默降级）；关联聚焦
   （恒星→行星关系段 / 轨道环 / 共享会话段、彗星聚焦集空、注入切换坡道连续）；悬停通知
   幂等（键变一次、拖拽门禁至多一次置空且无逐天体通知、摘除置空、注入不回声）；跨星座
   同 id 键隔离（通知键互不吞并、注入/悬停不误点亮另一星座同 id 天体）；
   inspectExternalHover 快照；注入/降级零相机位移。 */
{
  /** 探针皮肤：每帧记录天体条目的 hovered/selected（`markHovers` 观测面；background 帧首清空）。 */
  const markRecorder = () => {
    const marks = [];
    return {
      marks,
      style: {
        skin: "probe",
        palette: { accent: "#00ff88", prop: {} },
        useBand: false,
        background() { marks.length = 0; },
        drawBody(ctx, item) {
          if (item && (item.kind === "star" || item.kind === "planet" || item.kind === "comet")) {
            marks.push({
              kind: item.kind, id: item.data?.id ?? null, wsId: item.ws?.id ?? null,
              hovered: item.hovered === true, selected: item.selected === true
            });
          }
        }
      }
    };
  };
  /** 夹具：ext1（三星 + 联星行星 + 彗星，含星胚）；ext2 带**同 id** 恒星 xa + 独立恒星 ya。 */
  const extScene = () => ({
    workspaces: [{
      id: "ext1", name: "ext-one", pos: [0, 0, 0],
      stars: [
        { id: "xa", name: "xa", lifecycle: "created", setBy: null, at: null, tasks: [1, 2], age: "刚刚", act: 1, off: [-16, -2, 0] },
        { id: "xb", name: "xb", lifecycle: "executed", setBy: null, at: null, tasks: [2, 2], age: "刚刚", act: 0, off: [16, 6, 0] },
        { id: "xproto", name: "xproto", lifecycle: "proto", setBy: null, at: null, tasks: [0, 0], age: "刚刚", act: 0, off: [0, 26, 0] }
      ],
      links: [[0, 1]],
      planets: [{
        id: "xbin", title: "bin", state: "waiting", pendingKind: "approval",
        stars: ["xa", "xb"], todos: "1/2", when: "刚刚", satellites: [], satelliteCount: 0, delegatedBusy: false
      }],
      comets: [{ id: "xc", title: "comet", state: "waiting", pendingKind: "question", when: "刚刚", satellites: [], satelliteCount: 0, delegatedBusy: false }],
      archives: 0, satelliteCount: 0
    }, {
      id: "ext2", name: "ext-two", pos: [200, 0, 120],
      stars: [
        { id: "xa", name: "xa-two", lifecycle: "created", setBy: null, at: null, tasks: [1, 1], age: "刚刚", act: 1, off: [0, 0, 0] },
        { id: "ya", name: "ya-two", lifecycle: "created", setBy: null, at: null, tasks: [0, 1], age: "刚刚", act: 0, off: [10, 14, 0] }
      ],
      links: [], planets: [], comets: [], archives: 0, satelliteCount: 0
    }]
  });

  const rec = markRecorder();
  const notes = [];
  const container = stubEl("div");
  const eng = createCosmosEngine({
    container,
    style: rec.style,
    onHoverChange: (info) => notes.push(info)
  });
  const rootEl = container.children[0];
  const canvasEl = rootEl._by[".cos-canvas"];
  const overlayEl = rootEl._by[".cos-overlay"];
  const cardEl = rootEl._by[".cos-card"];
  const fire = (el, type, ev) => { for (const fn of el.listeners[type] ?? []) fn(ev); };
  const markOf = (wsId, kind, id) => rec.marks.find((m) => m.wsId === wsId && m.kind === kind && m.id === id) ?? null;
  /* 信息卡实体钩子：`data-key` 经 setAttribute 写（stub 元素 dataset 不联动）→ 统一读 attrs。 */
  const cardKey = () => String(cardEl.getAttribute("data-key") ?? "");
  /** 世界坐标 → 屏幕点（与引擎 project 同式：fov 60 / 视口 800×600 桩）。 */
  const screenOf = (world) => {
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
  const starWp = (wsId, id) => eng.inspectEntities(wsId).stars.find((s) => s.id === id).wp;
  const pointerAt = (world, pointerId = 31) => {
    const p = screenOf(world);
    fire(rootEl, "pointermove", { pointerId, clientX: p.x, clientY: p.y, buttons: 0, target: canvasEl });
    return p;
  };

  eng.setScene(extScene(), "rebuild");
  rafQ.length = 0;
  eng.start();
  let tNow = 90000;
  const step = (n = 1) => { for (let i = 0; i < n; i++) { tNow += 50; stepFrame(tNow); } };
  step(27); // 过冷启动序曲

  /* ① 注入接受 / 观测面 / 幂等短路 / 零相机位移 */
  {
    const camBefore = eng.getCamera();
    assert.equal(eng.setExternalHover({ wsId: "ext1", kind: "planet", id: "xbin" }), true, "在册目标 → 接受注入");
    assert.deepEqual(eng.inspectExternalHover(), { wsId: "ext1", kind: "planet", id: "xbin" }, "观测面与入参同形");
    assert.equal(eng.setExternalHover({ wsId: "ext1", kind: "planet", id: "xbin" }), true, "同键重复注入幂等接受");
    assert.deepEqual(eng.inspectExternalHover(), { wsId: "ext1", kind: "planet", id: "xbin" }, "幂等重注入状态不变");
    assert.deepEqual(eng.getCamera(), camBefore, "注入 MUST NOT 移动相机");
    assert.equal(eng.inspectFilter().focus.diving, false, "注入 MUST NOT 触发钻取");
    step(2);
    assert.equal(eng.inspectRelation().focusKey, "ext1|planet:xbin", "注入目标成为关联聚焦源");
    const planetMark = markOf("ext1", "planet", "xbin");
    assert.ok(planetMark && planetMark.hovered === true, "注入目标获得与画布 hover 同形的皮肤 hover 标记");
    assert.equal(planetMark.selected, false, "注入不冒充选中");
    assert.equal(cardKey(), "planet:xbin", "注入行星信息卡呈现（data-key）");
    assert.equal(cardEl.dataset.sig, "planet:xbin|waiting|approval|db:0", "注入行星卡内容签名沿既有管线（含 delegatedBusy 分量）");

    /* 幂等不重置关联聚焦坡道：坡道到满后重注入，α 保持 1（未被重锚） */
    step(4);
    assert.equal(eng.inspectRelation().mix.find((m) => m.key === "ext1|planet:xbin").alpha, 1, "坡道到满");
    eng.setExternalHover({ wsId: "ext1", kind: "planet", id: "xbin" });
    step(1);
    assert.equal(eng.inspectRelation().mix.find((m) => m.key === "ext1|planet:xbin").alpha, 1, "同键重注入不重置渐入坡道");
  }

  /* ② 降级契约：未命中 / 非法 / 无场景 / 星胚口径 → false 不抛错、既有态不受影响 */
  {
    const camBefore = eng.getCamera();
    assert.equal(eng.setExternalHover({ wsId: "nope", kind: "planet", id: "xbin" }), false, "未知 ws → false");
    assert.equal(eng.setExternalHover({ wsId: "ext1", kind: "moon", id: "xbin" }), false, "未知 kind → false");
    assert.equal(eng.setExternalHover({ wsId: "ext1", kind: "planet", id: "nope" }), false, "未知 id → false");
    assert.equal(eng.setExternalHover({}), false, "残缺入参 → false");
    assert.equal(eng.setExternalHover("nope"), false, "非对象入参 → false");
    assert.deepEqual(eng.inspectExternalHover(), { wsId: "ext1", kind: "planet", id: "xbin" }, "降级不改变既有注入态");
    assert.deepEqual(eng.getCamera(), camBefore, "降级路径零相机位移");
    assert.equal(eng.setExternalHover({ wsId: "ext1", kind: "star", id: "xproto" }), true, "星胚同口径接受注入（排除属客户端职责）");
    assert.deepEqual(eng.inspectExternalHover(), { wsId: "ext1", kind: "star", id: "xproto" });
    eng.setExternalHover({ wsId: "ext1", kind: "planet", id: "xbin" });
    step(1);
    assert.equal(notes.length, 0, "客户端自设注入 / 清除 MUST NOT 回声（通知通道只报画布指针态）");
  }

  /* ③ null 清除：注入目标聚焦渐熄、三源皆空回落常态 */
  {
    assert.equal(eng.setExternalHover(null), true, "null → 清除注入");
    assert.equal(eng.inspectExternalHover(), null, "清除后观测面为 null");
    step(2);
    assert.equal(eng.inspectRelation().focusKey, "", "三源皆空 → 聚焦源置空");
    step(6); // > REL_FADE_DUR
    assert.deepEqual(eng.inspectRelation().mix, [], "渐熄播完 → relMix 条目摘除（回落常态）");
    assert.equal(notes.length, 0, "清除注入亦不回声");
  }

  /* ④ 悬停通知：键变一次 / 跨星座同 id 键互不吞并 / markHovers 跨星座隔离 */
  {
    notes.length = 0;
    fire(rootEl, "pointerleave", {});
    step(2); // 初态（指针不在画布）→ 无 hover 通知（键恒 ""）
    assert.deepEqual(notes, [], "无指针 hover → 无通知");
    pointerAt(starWp("ext1", "xa"));
    step(2);
    assert.deepEqual(notes, [{ kind: "star", wsId: "ext1", id: "xa" }], "hover 键变恰一次回调（kind:wsId:id 键）");
    step(3);
    assert.equal(notes.length, 1, "同键多帧不重复回调（幂等）");
    /* 画布 hover 沿用既有 `entKey` 口径（kind:id，**无 ws**，行为零变化）：同 id 跨星座
       同时点亮属既有语义，不在本提案收紧范围；**注入**的并集判定才必须 wsId 入键（下方断言）。 */
    assert.equal(markOf("ext1", "star", "xa").hovered, true, "hover 目标点亮皮肤环");
    assert.equal(markOf("ext2", "star", "xa").hovered, true, "画布 hover 沿既有 entKey 口径（同 id 跨星座同亮，行为零变化）");
    /* 跨星座同 id：键含 wsId → 两条通知互不吞并 */
    pointerAt(starWp("ext2", "xa"));
    step(2);
    assert.equal(notes.length, 2, "跨星座同 id 的 hover 键变 MUST NOT 被裸键吞并");
    assert.deepEqual(notes[1], { kind: "star", wsId: "ext2", id: "xa" }, "第二条通知携带正确 wsId");
    assert.equal(markOf("ext2", "star", "xa").hovered, true, "当前 hover 目标点亮");
    /* 注入 + 画布 hover 并集：注入 ext1 xa 不误点亮 ext2 xa */
    fire(rootEl, "pointerleave", {});
    step(2);
    notes.length = 0;
    eng.setExternalHover({ wsId: "ext1", kind: "star", id: "xa" });
    step(2);
    assert.equal(markOf("ext1", "star", "xa").hovered, true, "注入目标点亮皮肤 hover 环");
    assert.equal(markOf("ext2", "star", "xa").hovered, false, "注入 MUST NOT 跨星座误点亮同 id 天体（键含 wsId）");
    assert.equal(notes.length, 0, "注入不产生画布 hover 通知");
    eng.setExternalHover(null);
    step(1);
  }

  /* ⑤ 拖拽门禁：置空至多一次、扫过多个天体无逐天体通知；抬指后恢复键变通知 */
  {
    pointerAt(starWp("ext1", "xa"));
    step(2);
    notes.length = 0;
    const start = screenOf(starWp("ext1", "xa"));
    fire(rootEl, "pointerdown", { pointerId: 71, button: 0, clientX: start.x, clientY: start.y, target: canvasEl, preventDefault() {} });
    fire(rootEl, "pointermove", { pointerId: 71, clientX: start.x + 40, clientY: start.y + 24, buttons: 1, target: canvasEl });
    step(2);
    assert.deepEqual(notes, [null], "拖拽开始 → hover 置空恰一次");
    for (const id of ["xb", "xproto"]) {
      const p = screenOf(starWp("ext1", id));
      fire(rootEl, "pointermove", { pointerId: 71, clientX: p.x, clientY: p.y, buttons: 1, target: canvasEl });
      step(1);
    }
    assert.equal(notes.length, 1, "拖拽扫过多个天体 → 无逐天体 hover 通知");
    fire(rootEl, "pointerup", { pointerId: 71, button: 0, clientX: 400, clientY: 300, target: canvasEl });
    step(1);
    pointerAt(starWp("ext1", "xb"), 72);
    step(2);
    assert.deepEqual(notes[notes.length - 1], { kind: "star", wsId: "ext1", id: "xb" }, "拖拽结束 → 恢复键变通知");
    fire(rootEl, "pointerleave", {});
    step(2);
    assert.equal(notes[notes.length - 1], null, "指针离场 → 置空通知");
  }

  /* ⑥ 场景差分：引用重映射（patch 触达）/ 目标摘除自清置空 / 客户端自设不回声 */
  {
    notes.length = 0;
    assert.equal(eng.setExternalHover({ wsId: "ext1", kind: "planet", id: "xbin" }), true);
    step(3);
    assert.equal(notes.length, 0, "自设注入不回声");
    eng.setScene(extScene(), "rebuild");
    assert.deepEqual(eng.inspectExternalHover(), { wsId: "ext1", kind: "planet", id: "xbin" }, "目标仍在册 → 注入保留");
    const patched = extScene();
    patched.workspaces[0].planets[0].state = "busy";
    patched.workspaces[0].planets[0].pendingKind = null;
    eng.setScene(patched, "patch");
    step(2);
    assert.equal(cardKey(), "planet:xbin", "重建后信息卡仍呈现注入目标");
    assert.equal(cardEl.dataset.sig, "planet:xbin|busy||db:0", "ws/data 引用已重映射 → 后续 patch 触达（非陈旧快照）");
    /* 目标被场景摘除 → 引擎静默清除 + 置空通知恰一次 */
    const pruned = extScene();
    pruned.workspaces[0].planets = [];
    const before = notes.length;
    eng.setScene(pruned, "rebuild");
    assert.equal(eng.inspectExternalHover(), null, "目标摘除 → 注入自清");
    assert.deepEqual(notes.slice(before), [null], "自清置空通知（客户端共享态不滞留）");
    step(2);
    assert.equal(notes.length, before + 1, "置空通知幂等（后续帧不重复）");
    eng.setScene(extScene(), "rebuild");
    step(2);
  }

  /* ⑦ tips 呈现 + 关联聚焦（钻取态注入恒星 / 行星 / 彗星；切换坡道连续） */
  {
    /* 去重跨星座同 id：浮签名牌 / 屏幕槽位按 id 共享是既有实现口径（ws-less），tips 段改用
       唯一 id 夹具，避免既有槽位覆盖干扰名牌归属判定。 */
    const solo = extScene();
    solo.workspaces[1].stars = solo.workspaces[1].stars.filter((s) => s.id !== "xa");
    eng.setScene(solo, "rebuild");
    step(2);
    assert.equal(eng.diveToWs("ext1"), true, "钻取 ext1");
    fakeNow += 1300;
    step(2);
    const slabOf = (id) => overlayEl.children.find((el) => String(el.className).startsWith("cos-slab") && el.dataset.star === id);

    assert.equal(eng.setExternalHover({ wsId: "ext1", kind: "star", id: "xa" }), true);
    step(2);
    let rel = eng.inspectRelation();
    assert.equal(rel.focusKey, "ext1|star:xa", "注入恒星成为聚焦源");
    assert.deepEqual(rel.last.orbits.map((o) => o.planetId), ["xbin"], "注入恒星 → 关联行星轨道环点亮");
    assert.deepEqual(rel.last.segs.map((s) => [s.starId, s.planetId]), [["xa", "xbin"]], "恒星→行星关系段");
    assert.equal(rel.last.links, undefined, "星↔星提案虚线点亮解除（relLast 无 links 面，two）");
    assert.ok(rel.mix.find((m) => m.key === "ext1|star:xa").alpha < 1, "聚焦坡道渐入（无瞬间跳变）");
    const slabXa = slabOf("xa");
    assert.ok(slabXa, "注入恒星名牌已创建");
    assert.equal(slabXa.style.opacity, "1", "注入恒星名牌以 focused α 呈现");
    assert.equal(cardKey(), "star:xa", "注入恒星信息卡（data-key）");
    let tips = eng.inspectTipLines();
    assert.ok(tips.some((l) => l.kind === "slab") && tips.some((l) => l.kind === "card"), "名牌与信息卡引线同帧产出");
    step(4);

    /* 恒星 A → B：旧集渐熄 + 新集渐显（既有 REL_FADE_DUR，零新增逻辑） */
    eng.setExternalHover({ wsId: "ext1", kind: "star", id: "xb" });
    step(1);
    rel = eng.inspectRelation();
    assert.equal(rel.focusKey, "ext1|star:xb", "切换注入目标");
    assert.ok(rel.mix.some((m) => m.key === "ext1|star:xa" && m.dir === "out"), "旧聚焦键转 out 渐熄");
    assert.ok(rel.mix.some((m) => m.key === "ext1|star:xb" && m.dir === "in"), "新聚焦键转 in 渐显");
    step(6); // 旧集渐熄播完（> REL_FADE_DUR）

    /* 注入行星：自身轨道环 + 联星双关系段；不点亮共享会话段 */
    eng.setExternalHover({ wsId: "ext1", kind: "planet", id: "xbin" });
    step(6); // 旧星聚焦集渐熄播完
    rel = eng.inspectRelation();
    assert.equal(rel.focusKey, "ext1|planet:xbin", "注入行星成为聚焦源");
    assert.deepEqual(rel.last.orbits.map((o) => o.planetId), ["xbin"], "行星自身轨道环点亮");
    assert.equal(rel.last.segs.length, 2, "联星行星 → 两条关系段");
    assert.equal(rel.last.links, undefined, "行星聚焦不点亮星↔星段（通道解除，two）");
    assert.equal(cardKey(), "planet:xbin", "注入行星信息卡呈现");

    /* 注入彗星：聚焦集空（无 rel 增强）+ 信息卡照常 + 不报错 */
    assert.equal(eng.setExternalHover({ wsId: "ext1", kind: "comet", id: "xc" }), true);
    step(6); // 旧行星聚焦集渐熄播完
    rel = eng.inspectRelation();
    assert.equal(rel.focusKey, "ext1|comet:xc", "注入彗星成为聚焦源");
    assert.equal(rel.last.segs.length, 0, "彗星聚焦集空：无关系段");
    assert.equal(rel.last.orbits.length, 0, "彗星聚焦集空：无轨道环增亮");
    assert.equal(cardKey(), "comet:xc", "彗星信息卡照常呈现");
    tips = eng.inspectTipLines();
    assert.ok(tips.some((l) => l.kind === "card"), "彗星信息卡引线随既有管线");
    eng.setExternalHover(null);
    step(4);
  }

  /* ⑧ 三级仲裁：选中 < 注入 < 画布 hover；选中环数据标记不受影响 */
  {
    const pt = screenOf(eng.worldPosOf("planet", "xbin"));
    fire(rootEl, "pointerup", { pointerId: 81, button: 0, clientX: pt.x, clientY: pt.y, target: canvasEl });
    step(2);
    assert.deepEqual(eng.inspectSelection(), { kind: "planet", wsId: "ext1", id: "xbin" }, "钻取态点选行星（不动镜头）");
    assert.equal(eng.inspectRelation().focusKey, "ext1|planet:xbin", "无 hover/注入 → 聚焦源回落选中");

    eng.setExternalHover({ wsId: "ext1", kind: "star", id: "xa" });
    step(2);
    assert.equal(eng.inspectRelation().focusKey, "ext1|star:xa", "外部注入优先于选中");
    assert.deepEqual(eng.inspectSelection(), { kind: "planet", wsId: "ext1", id: "xbin" }, "注入不改变选中态");
    assert.equal(markOf("ext1", "planet", "xbin").selected, true, "金色选中环数据标记不受注入影响（聚焦与选中解耦）");

    pointerAt(starWp("ext1", "xb"), 82);
    step(3);
    assert.equal(eng.inspectRelation().focusKey, "ext1|star:xb", "画布指针 hover 遮蔽外部注入");
    assert.equal(cardKey(), "star:xb", "信息卡实体 = 画布指针目标");
    assert.deepEqual(eng.inspectExternalHover(), { wsId: "ext1", kind: "star", id: "xa" }, "被遮蔽期间注入态仍在册");
    fire(rootEl, "pointermove", { pointerId: 83, clientX: 790, clientY: 590, buttons: 0, target: canvasEl });
    step(2);
    assert.equal(eng.inspectRelation().focusKey, "ext1|star:xa", "指针离开天体 → 注入即时生效");

    eng.setExternalHover(null);
    step(2);
    assert.equal(eng.inspectRelation().focusKey, "ext1|planet:xbin", "清除注入 → 回落选中聚焦集");
    fire(rootEl, "pointerup", { pointerId: 84, button: 0, clientX: 12, clientY: 12, target: canvasEl });
    step(4);
    assert.equal(eng.inspectSelection(), null, "空白处点选清空选中");
    assert.equal(eng.inspectRelation().focusKey, "", "三源皆空 → 聚焦源置空");
  }

  /* ⑨ 可见性降级：无当前帧屏幕投影（隐藏星座）→ 浮签不呈现、不报错、相机不动 */
  {
    eng.setFilter(new Set(["ext1"]));
    step(8); // > FILTER_RAMP_DUR
    const camBefore = eng.getCamera();
    cardEl.setAttribute("data-key", "");
    cardEl.dataset.sig = "";
    assert.equal(eng.setExternalHover({ wsId: "ext2", kind: "star", id: "ya" }), true, "隐藏星座的目标仍在册 → 注入接受");
    assert.doesNotThrow(() => step(2), "无投影注入不抛错");
    assert.equal(cardKey(), "", "无投影 → 信息卡空投影早退（不呈现）");
    const slabYa = overlayEl.children.find((el) => String(el.className).startsWith("cos-slab") && el.dataset.star === "ya");
    assert.ok(!slabYa || slabYa.style.opacity === "", "无投影 → 恒星名牌不呈现（内联 opacity 未写/已清）");
    assert.deepEqual(eng.inspectExternalHover(), { wsId: "ext2", kind: "star", id: "ya" }, "注入态保留（仅呈现降级）");
    assert.deepEqual(eng.getCamera(), camBefore, "注入零相机位移（降级路径同样成立）");
    eng.setExternalHover(null);
    eng.setFilter([]);
    step(2);
  }

  /* ⑩ 销毁 / 无场景守卫：false 不抛错；观测面 null */
  {
    const noScene = createCosmosEngine({ container: stubEl("div"), style: createSkinD() });
    assert.equal(noScene.setExternalHover({ wsId: "ext1", kind: "star", id: "xa" }), false, "无场景 → false 不抛错");
    assert.equal(noScene.inspectExternalHover(), null, "无场景观测面 → null");
    noScene.dispose();
    const dead = createCosmosEngine({ container: stubEl("div"), style: createSkinD() });
    dead.dispose();
    assert.equal(dead.setExternalHover({ wsId: "ext1", kind: "star", id: "xa" }), false, "已销毁 → false 不抛错");
    assert.equal(dead.setExternalHover(null), false, "已销毁 → 清除亦 false");
    assert.equal(dead.inspectExternalHover(), null, "已销毁观测面 → null");
  }

  eng.stop();
  eng.dispose();
  rafQ.length = 0;
}

/* ── 全量图样 + 空槽装饰点（add-cosmos-template-figure-display 2.x / 3.x / 4.3）：
   `ws.pattern` 纯消费（统一弱 α、星座级淡入淡出、无逐段坡道）、空槽判定纯函数确定性、
   空槽装饰点（α 恒低于图样线、门控同源、不叠加被占槽位）、旧字段容忍、观测面新形态
   （segIndex / slotIndex）。 ── */
{
  /* ① 空槽判定纯函数（3.1）：前 min(N, L) 个内核槽位被占，余下为空；边界档位确定。 */
  const patOf = (n) => ({ slots: Array.from({ length: n }, (_, k) => [k * 10, 0, 0]), lines: [] });
  assert.deepEqual(patEmptySlotsOf(patOf(7), 3), [3, 4, 5, 6], "前 3 颗占前序槽位 → 空槽 = 3..6（升序）");
  assert.deepEqual(patEmptySlotsOf(patOf(7), 7), [], "满员 → 零空槽");
  assert.deepEqual(patEmptySlotsOf(patOf(7), 9), [], "溢出环恒星不参与内核槽位判定（L > N 仍无空槽）");
  assert.deepEqual(patEmptySlotsOf(patOf(7), 0), [0, 1, 2, 3, 4, 5, 6], "零恒星 → 全部内核槽位为空");
  assert.deepEqual(patEmptySlotsOf(patOf(7), 1), [1, 2, 3, 4, 5, 6], "1 颗恒星 → 首槽被占（规范序前序占位）");
  assert.deepEqual(patEmptySlotsOf(null, 3), [], "图样缺席 → 零空槽（不抛错）");
  assert.deepEqual(patEmptySlotsOf({}, 3), [], "缺 slots 字段 → 零空槽（不抛错）");
  assert.deepEqual(patEmptySlotsOf(patOf(2), -1), [0, 1], "非法恒星数 → 按 0 兜底（防御）");

  /* ② 图样快照容忍（2.5）：缺席 / 空 / 畸形按无图样处理；结构性损坏索引对剔除。 */
  assert.equal(patSnapshotOf(undefined), null, "pattern 缺席 → null（旧场景快照互读安全）");
  assert.equal(patSnapshotOf(null), null, "pattern = null → null");
  assert.equal(patSnapshotOf({}), null, "缺 slots → null（按无图样处理）");
  assert.equal(patSnapshotOf({ slots: [] }), null, "空 slots → null");
  assert.deepEqual(
    patSnapshotOf({ slots: [[1, 2, 3], 'bad'], lines: [[0, 1], [1, 1], [0, 9], 'x', [0, 1]] }),
    { slots: [[1, 2, 3], [Number.NaN, Number.NaN, Number.NaN]], lines: [[0, 1], [0, 1]] },
    "畸形槽位归一 NaN（渲染期跳过）、自环/越界/非法索引对剔除（不抛错）"
  );

  /** 夹具：单星座三星（5 内核槽位 → 2 空槽；图样含空-空段 [3,4]，提案 links 跨接对刻意异构）。 */
  const patternScene = () => ({
    workspaces: [{
      id: "pat1", name: "pat-one", pos: [0, 0, 0],
      stars: [
        { id: "pa", name: "pa", lifecycle: "created", setBy: null, at: null, tasks: [0, 0], age: "刚刚", act: 0, off: [-20, 0, 0] },
        { id: "pb", name: "pb", lifecycle: "created", setBy: null, at: null, tasks: [0, 0], age: "刚刚", act: 0, off: [0, 0, 8] },
        { id: "pc", name: "pc", lifecycle: "created", setBy: null, at: null, tasks: [0, 0], age: "刚刚", act: 0, off: [20, 0, 0] }
      ],
      pattern: {
        slots: [[-22, 0, 0], [0, 0, 10], [22, 0, 0], [0, 0, -12], [14, 0, -14]],
        lines: [[0, 1], [1, 2], [3, 4]]
      },
      links: [[0, 2]], // 提案关联数据面保留（面板投影消费）；引擎不再绘制
      planets: [], comets: [], archives: 0, satelliteCount: 0
    }]
  });
  const container = stubEl("div");
  const eng = createCosmosEngine({ container, style: createSkinD() });
  eng.setScene(patternScene(), "rebuild");
  rafQ.length = 0;
  eng.start();
  let tNow = 9000;
  const step = (n = 1) => { for (let i = 0; i < n; i++) { tNow += 50; stepFrame(tNow); } };
  step(1);

  /* ③ 段集合与统一亮度（2.1/2.2）：模板 lines 逐对投影（含空-空段 [3,4]）；
     段 α 恒 = PAT_LINE_DIM（首帧即稳态——无逐段淡入坡道）；星↔星提案 links 段缺席。 */
  let rows = eng.inspectPatternLines();
  assert.deepEqual(rows.map((r) => r.segIndex), [0, 1, 2], "图样段 = 模板 lines 全量（含空-空段，segIndex = lines 序号）");
  assert.ok(rows.every((r) => Math.abs(r.alpha - 0.5) < 1e-9), "统一弱化 α（0.5 = PAT_LINE_DIM；有星段与空槽段同一亮度）");
  assert.ok(rows.every((r) => !('aId' in r) && !('bId' in r)), "观测面新形态（2.4）：槽位段无星 id 键");
  assert.equal(rows.length, 3, "提案 links（pa↔pc）不进图样段（星↔星直线通道已解除）");
  step(6); // 累计 > 旧 LINK_FADE_DUR（0.4s）：静态几何不受时间影响
  rows = eng.inspectPatternLines();
  assert.ok(rows.every((r) => Math.abs(r.alpha - 0.5) < 1e-9), "无逐段坡道：稳态 α 恒 0.5（星座级 α 另行缩放）");

  /* ④ 空槽装饰点（3.1–3.3）：occupied = min(N, L) = 3 → 空槽 = [3, 4]；
     α 恒低于图样线；被占槽位不叠加。 */
  let dots = eng.inspectPatternDots();
  assert.deepEqual(dots.map((r) => r.slotIndex), [3, 4], "空槽 = 前 min(N, L) 槽位之后的余下内核槽位");
  assert.ok(dots.every((r) => r.alpha > 0 && r.alpha < 0.5), `装饰点 α MUST 低于图样线（${dots.map((r) => r.alpha)} < 0.5）`);
  assert.ok(!dots.some((r) => r.slotIndex < 3), "被占槽位不叠加装饰点（恒星本体覆盖）");

  /* ④b 设置面映射与热更（add-cosmos-figure-line-alpha 2.1–2.3 / 4.2）：显式值映射、
     setTuning 防御夹取与非数值忽略、点因子派生式（线 0.2 → 点 0.088；线 0.1 → 点 0.044；
     恒 < 线）、观测面口径与段/点同帧一致。 */
  eng.setTuning({ patLineDim: 0.2 });
  step(1);
  rows = eng.inspectPatternLines();
  assert.ok(rows.every((r) => Math.abs(r.alpha - 0.2) < 1e-9), "显式设置值映射：0.2 → 段 α 0.2（当帧生效）");
  dots = eng.inspectPatternDots();
  assert.ok(dots.every((r) => Math.abs(r.alpha - 0.088) < 1e-9), "派生点 α = min(0.22, 0.2 × 0.44) = 0.088");
  assert.ok(dots.every((r) => r.alpha < rows[0].alpha), "点恒弱于线（显式值 0.088 < 0.2）");
  eng.setTuning({ patLineDim: 0.1 });
  step(1);
  rows = eng.inspectPatternLines();
  dots = eng.inspectPatternDots();
  assert.ok(rows.every((r) => Math.abs(r.alpha - 0.1) < 1e-9), "线 0.1 → 段 α 0.1");
  assert.ok(dots.every((r) => Math.abs(r.alpha - 0.044) < 1e-9), "线 0.1 → 点 α 0.044（min(0.22, 0.044)）");
  assert.ok(dots.every((r) => r.alpha < rows[0].alpha), "点恒弱于线（线 0.1 时 0.044 < 0.1）");
  /* 防御夹取：下界 0.05 / 上界 1（界外落端点）；非数值忽略（保持原值）；缺键部分写幂等。 */
  eng.setTuning({ patLineDim: 0.001 });
  step(1);
  rows = eng.inspectPatternLines();
  dots = eng.inspectPatternDots();
  assert.ok(rows.every((r) => Math.abs(r.alpha - 0.05) < 1e-9), "下越界 → 夹到 0.05");
  assert.ok(dots.every((r) => Math.abs(r.alpha - 0.022) < 1e-9), "点随线下越界 → 0.022");
  eng.setTuning({ patLineDim: 7 });
  step(1);
  rows = eng.inspectPatternLines();
  dots = eng.inspectPatternDots();
  assert.ok(rows.every((r) => Math.abs(r.alpha - 1) < 1e-9), "上越界 → 夹到 1");
  assert.ok(dots.every((r) => Math.abs(r.alpha - 0.22) < 1e-9), "线 1 → 点 = min(0.22, 0.44) = 0.22（上限兜底）");
  eng.setTuning({ patLineDim: "0.3" });
  step(1);
  assert.ok(eng.inspectPatternLines().every((r) => Math.abs(r.alpha - 1) < 1e-9), "非数值入参忽略（保持 1）");
  eng.setTuning({});
  step(1);
  assert.ok(eng.inspectPatternLines().every((r) => Math.abs(r.alpha - 1) < 1e-9), "缺键部分写幂等（保持 1）");
  eng.setTuning({ patLineDim: 0.5 });
  step(1);
  rows = eng.inspectPatternLines();
  assert.ok(rows.every((r) => Math.abs(r.alpha - 0.5) < 1e-9), "复位 0.5（后续段回归基线）");
  assert.ok(eng.inspectPatternDots().every((r) => Math.abs(r.alpha - 0.22) < 1e-9), "复位点 0.22");

  /* ④c 构造期显式设置映射（2.1）：settings.patLineDim 百分比 → 因子；非法值回落 0.5。 */
  const preset = createCosmosEngine({ container: stubEl("div"), style: createSkinD(), settings: { patLineDim: 20 } });
  preset.setScene(patternScene(), "rebuild");
  preset.start();
  step(1);
  assert.ok(preset.inspectPatternLines().every((r) => Math.abs(r.alpha - 0.2) < 1e-9), "构造期 20% → 因子 0.2（首帧即生效）");
  assert.ok(preset.inspectPatternDots().every((r) => Math.abs(r.alpha - 0.088) < 1e-9), "构造期点因子派生 0.088");
  preset.stop();
  preset.dispose();
  const invalidPreset = createCosmosEngine({ container: stubEl("div"), style: createSkinD(), settings: { patLineDim: "bright" } });
  invalidPreset.setScene(patternScene(), "rebuild");
  invalidPreset.start();
  step(1);
  assert.ok(invalidPreset.inspectPatternLines().every((r) => Math.abs(r.alpha - 0.5) < 1e-9), "非法构造值回落 0.5（缺省渲染零变化）");
  invalidPreset.stop();
  invalidPreset.dispose();

  /* ⑤ patch 不重播、段/点恒等（2.1/D2）：恒星 off 滑位只改恒星落位，图样为模板静态几何。 */
  const shifted = patternScene();
  shifted.workspaces[0].stars[0].off = [-40, 0, 6];
  eng.setScene(shifted, "patch");
  step(2);
  assert.deepEqual(eng.inspectPatternLines(), rows, "patch 滑位 → 段集合/α 恒等（图样端点恒等槽位坐标）");
  assert.deepEqual(eng.inspectPatternDots().map((r) => r.slotIndex), [3, 4], "patch 滑位 → 空槽集合不变");

  /* ⑥ 门控与恒星数联动（3.1）：恒星降至 1 颗 → 空槽扩为 [1..4]；图样段不变（模板派生）。 */
  const sparse = patternScene();
  sparse.workspaces[0].stars = [sparse.workspaces[0].stars[0]];
  eng.setScene(sparse, "rebuild");
  step(1);
  assert.deepEqual(eng.inspectPatternDots().map((r) => r.slotIndex), [1, 2, 3, 4], "恒星数下降 → 空槽按 min(N, L) 扩增");
  assert.deepEqual(eng.inspectPatternLines().map((r) => r.segIndex), [0, 1, 2], "图样段仅由模板派生（与恒星集合无关）");

  /* ⑦ 空槽判定确定性（3.1）：同恒星集合以不同数组序重放 → 空槽集合与顺序完全一致。 */
  const shuffled = patternScene();
  shuffled.workspaces[0].stars = [shuffled.workspaces[0].stars[1], shuffled.workspaces[0].stars[2], shuffled.workspaces[0].stars[0]];
  eng.setScene(shuffled, "rebuild");
  step(1);
  assert.deepEqual(eng.inspectPatternDots().map((r) => r.slotIndex), [3, 4], "乱序重放 → 空槽集合确定性一致（与装配顺序无关）");

  /* ⑧ 旧字段容忍（2.5）：pattern 缺席 / 显式旧字段 patternLines → 零图样、不抛错。 */
  const legacy = patternScene();
  delete legacy.workspaces[0].pattern;
  legacy.workspaces[0].patternLines = [[0, 1], [1, 2]]; // 旧场景快照字段（已退役，按无图样忽略）
  eng.setScene(legacy, "rebuild");
  step(1);
  assert.deepEqual(eng.inspectPatternLines(), [], "pattern 缺席 → 零图样段（不抛错）");
  assert.deepEqual(eng.inspectPatternDots(), [], "pattern 缺席 → 零装饰点");
  assert.equal(eng.getScene().workspaces[0].patternLines.length, 2, "旧字段原样留在 sceneData（引擎不消费、不清理）");

  /* ⑨ 门控关闭（无恒星 / 空图样）→ 零图样（呈现与引入本能力前一致）。 */
  const noStars = patternScene();
  noStars.workspaces[0].stars = [];
  eng.setScene(noStars, "rebuild");
  step(1);
  assert.deepEqual(eng.inspectPatternLines(), [], "无恒星 → 零图样段（门控）");
  assert.deepEqual(eng.inspectPatternDots(), [], "无恒星 → 零装饰点（门控同源）");
  const emptyPattern = patternScene();
  emptyPattern.workspaces[0].pattern = { slots: [], lines: [] };
  eng.setScene(emptyPattern, "rebuild");
  step(1);
  assert.deepEqual(eng.inspectPatternLines(), [], "空 slots → 零图样（按无图样处理）");

  /* ⑩ 真实绘制面（4.4 机器可验证部分）：图样线 / 装饰点确实进入皮肤 drawBody（引擎不旁路
     渲染）；段 α 统一、点弱化因子恒低于段 α、点半径为正（屏幕可辨）。皮肤经 setSkin 热换
     为探针包装（不触碰 DOM、不重建场景）——兼验「切皮肤无破图」的条目形状契约。 */
  const seen = [];
  const baseSkin = createSkinD();
  eng.setSkin({
    ...baseSkin,
    drawBody(ctx, it, view) { seen.push(it); return baseSkin.drawBody(ctx, it, view); }
  });
  eng.setScene(patternScene(), "rebuild");
  step(1);
  const patLines = seen.filter((it) => it.kind === 'constline' && it.pat === true);
  const patDots = seen.filter((it) => it.kind === 'patdot');
  assert.equal(patLines.length, 1, "图样线段条目到达皮肤（单条 constline、pat 装饰层标记）");
  assert.deepEqual(patLines[0].segs.map((s) => s.alpha), [0.5, 0.5, 0.5], "统一弱化 α（有星段与空-空段同亮度）");
  assert.equal(patDots.length, 1, "空槽装饰点条目到达皮肤（patdot）");
  assert.deepEqual(patDots[0].pts.map((p) => p.a), [0.22, 0.22], "点弱化因子恒低于段 α（0.22 < 0.5）");
  assert.ok(patDots[0].pts.every((p) => p.r > 0), "装饰点半径为正（微点可辨）");
  assert.equal(patDots[0].pts.length, 2, "装饰点数 = 空槽数（2）");
  eng.setSkin(baseSkin);

  /* 观测面守卫：无场景实例 → 空数组不抛错 */
  const dead = createCosmosEngine({ container: stubEl("div"), style: createSkinD() });
  assert.deepEqual(dead.inspectPatternLines(), [], "无场景 → 空段观测面");
  assert.deepEqual(dead.inspectPatternDots(), [], "无场景 → 空点观测面");
  dead.dispose();

  eng.stop();
  eng.dispose();
  rafQ.length = 0;
}

/* ── 星座模板名呈现（add-cosmos-template-name-toggle 3.1–3.4 / 4.3 / D3/D4）：
   装饰样式契约（10px 低 α 宽字距、皮肤令牌取色）；chip 副文本与钻取标牌副行的四象限
   呈现判定（仅「开关开 ∩ tplZh 非空」出 DOM，其余三态零 DOM 且关闭态串逐字节如旧）；
   escapeHtml 转义；`dataset.html` 差分守卫（值未变幂等零重写 / 换串重写）；
   `setTuning` 热翻转：chip 显式刷新通道即时生效、badge 下一帧差分收敛；部分写语义。 ── */
{
  /* ① 装饰样式契约（3.4）：chip / badge 共用专用 class，浅/深色双主题走同一皮肤令牌。 */
  const tplRule = /\.cos-chip \.cos-chip-tpl,\s*\.cos-badge \.cos-chip-tpl \{([^}]*)\}/.exec(ENGINE_CSS);
  assert.ok(tplRule, "ENGINE_CSS 含 .cos-chip-tpl 装饰样式（chip + badge 共用槽）");
  assert.ok(/font-size: 10px/.test(tplRule[1]), "副行 10px（chip 副行槽既有字号）");
  assert.ok(/letter-spacing: 1\.6px/.test(tplRule[1]), "宽字距装饰口径");
  assert.ok(/opacity: \.5/.test(tplRule[1]), "低 α（弱于计数/活力仪表串）");
  assert.ok(/var\(--cos-ink-dim/.test(tplRule[1]), "取色走皮肤令牌 --cos-ink-dim（浅/深色主题同源，非硬编码）");

  const container = stubEl("div");
  const eng = createCosmosEngine({ container, style: createSkinD(), settings: { templateNames: true } });
  const rootEl = container.children[0];
  const overlayEl = rootEl._by[".cos-overlay"];
  const badgeEl = rootEl._by[".cos-badge"];
  const wsOf = (id, over) => ({
    id, name: id, pos: [0, 0, 0], stars: [], links: [], planets: [], comets: [],
    archives: 0, satelliteCount: 0, ...over
  });
  const scene = {
    workspaces: [
      wsOf("ws-named", { tplZh: "猎户座" }),
      wsOf("ws-plain", { tplZh: null }),
      wsOf("ws-escape", { tplZh: '<img src=x onerror=1>&"' })
    ]
  };
  const chipOf = (id) => overlayEl.children.find((el) =>
    String(el.className).startsWith("cos-chip") && String(el.dataset.html).includes("<b>" + id + "<"));

  eng.setScene(scene, "rebuild");
  rafQ.length = 0;
  eng.start();
  fakeNow = 400000;
  let tNow = 400000;
  const step1 = (n = 1) => { for (let i = 0; i < n; i++) { tNow += 50; fakeNow += 50; stepFrame(tNow); } };
  step1(3);

  /* ② 四象限呈现在 chip：开+有 → 副行；开+null → 无副行；关闭态（后续翻转覆盖）
     + 有/null 均无副行，且关闭态串与既有格式逐字节一致。 */
  const namedChip = chipOf("ws-named");
  const plainChip = chipOf("ws-plain");
  assert.ok(namedChip && plainChip, "两个星座 chip 均已创建");
  assert.ok(String(namedChip.dataset.html).includes('<span class="cos-chip-tpl">猎户座</span>'),
    "开 + tplZh 非空 → 名称行后追加模板名副行");
  assert.ok(!String(plainChip.dataset.html).includes("cos-chip-tpl"), "开 + tplZh null → 不渲染副行（防御一致性）");
  assert.match(String(plainChip.dataset.html), /^<b>ws-plain<i class="cos-chip-life (active|sleep)"><\/i><\/b>$/,
    "无模板名时 chip 串 = 引入本设置前的逐字节格式（零 DOM 变化）");

  /* ③ 转义纪律：模板名入 HTML 串前经既有 escapeHtml（不注入标签/属性）。 */
  const escapeChip = chipOf("ws-escape");
  assert.ok(escapeChip, "含特殊字符模板名的 chip 已创建");
  assert.ok(!String(escapeChip.dataset.html).includes("<img"), "模板名中的标签被转义（不注入元素）");
  assert.ok(String(escapeChip.dataset.html).includes("&lt;img src=x onerror=1&gt;&amp;&quot;"),
    "转义与引擎统一 escapeHtml 同源");

  /* ④ 关闭态：chip 立即换串（setTuning 显式触发 updateChipText），且 badge 下一帧差分收敛。 */
  eng.setTuning({ templateNames: false });
  assert.ok(!String(namedChip.dataset.html).includes("cos-chip-tpl"), "关闭 → chip 副行即时退场（无需等待下一帧）");
  assert.match(String(namedChip.dataset.html), /^<b>ws-named<i class="cos-chip-life (active|sleep)"><\/i><\/b>$/,
    "关闭 → chip 串回落逐字节旧格式");
  eng.setTuning({ templateNames: true });
  assert.ok(String(namedChip.dataset.html).includes("猎户座"), "再开 → chip 副行即时回归");

  /* ⑤ 部分写 / 幂等：非布尔入参忽略；同值布尔入参不触达 DOM（差分守卫 + 值变才动作）。 */
  eng.setTuning({ templateNames: "off" });
  assert.ok(String(namedChip.dataset.html).includes("猎户座"), "非布尔入参被忽略（部分写语义）");
  namedChip.innerHTML = "MARKER";
  eng.setTuning({ templateNames: true });
  assert.equal(namedChip.innerHTML, "MARKER", "同值布尔入参幂等（不刷新 chip）");
  namedChip.innerHTML = String(namedChip.dataset.html);

  /* ⑥ 钻取标牌副行（3.3）：计数行后追加同形副行；关闭后下一帧差分收敛；计数仪表不动。 */
  assert.equal(eng.diveToWs("ws-named"), true, "钻取命中模板名的星座");
  fakeNow += 1300;
  step1(2);
  assert.ok(String(badgeEl.dataset.html).includes('<span class="cos-chip-tpl">猎户座</span>'),
    "开 + tplZh 非空 → 钻取标牌计数行后追加模板名副行");
  assert.ok(/<span>✦0 ●0 ◇0 ☄0 ☁0<\/span>/.test(String(badgeEl.dataset.html)), "计数仪表串逐字不变");
  eng.setTuning({ templateNames: false });
  step1(1);
  assert.ok(!String(badgeEl.dataset.html).includes("cos-chip-tpl"), "关闭 → 标牌副行随下一帧差分退场");
  assert.ok(/<span>✦0 ●0 ◇0 ☄0 ☁0<\/span>/.test(String(badgeEl.dataset.html)), "关闭后计数仪表仍照常");
  eng.setTuning({ templateNames: true });
  step1(1);
  assert.ok(String(badgeEl.dataset.html).includes("猎户座"), "再开 → 标牌副行随差分回归");

  /* ⑦ 冷启动镜像：缺省（未显式 true）→ 关闭 = 默认渲染零变化（同一场景另起实例）。 */
  const offContainer = stubEl("div");
  const offEngine = createCosmosEngine({ container: offContainer, style: createSkinD() });
  const offRoot = offContainer.children[0];
  const offOverlay = offRoot._by[".cos-overlay"];
  offEngine.setScene(scene, "rebuild");
  const offChips = offOverlay.children.filter((el) => String(el.className).startsWith("cos-chip"));
  assert.ok(offChips.length > 0, "缺省实例 chip 已创建");
  assert.ok(offChips.every((el) => !String(el.dataset.html).includes("cos-chip-tpl")),
    "缺省关闭 → 不渲染任何模板名副行（渲染与引入前一致）");
  offEngine.dispose();

  eng.stop();
  eng.dispose();
  rafQ.length = 0;
}

console.log("engine-smoke: all assertions passed");
