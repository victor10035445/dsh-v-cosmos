/**
 * 右栏停靠冒烟（add-cosmos-rightbar-dock 5.1，纯逻辑直测 + 源码锚点）：
 *  1. 设置面 v10：枚举 embedded | dock、历史 window → dock 迁移、非法值回落；
 *  2. 入口分流判据：embedded 翻转整页 / dock 打开 tab / 已开揭示 / 无会话与宿主席位缺席
 *     回落内嵌整页 + toast；
 *  3. 关页裁决：embedded 关整页 / dock no-op（跳转尾巴与「打开会话」导航同源）；
 *  4. tab 呈现态投影（openTabs × mounted → active）与回落文案键；
 *  5. 源码锚点：tab 类型/正文槽/guide entry 注册、条件注入、正文不注册全局 Esc、
 *     engine 列形适配、宿主半区 role/presence 机器码零残留。
 *
 * 运行：node test/rightbar-dock-smoke.mjs（无需先 build）
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  COSMOS_DOCK_TAB_ID,
  COSMOS_DOCK_TAB_KIND,
  dockEntryPlanOf,
  dockFallbackNoticeKeyOf,
  dockPresenceOf,
  findDockTabOf,
  pageCloseActionOf
} from "../src/dock.mjs";
import {
  COSMOS_DEFAULT_LAUNCH_MODE,
  COSMOS_LAUNCH_MODES,
  COSMOS_SETTINGS_VERSION,
  sanitizeCosmosSettings,
  settingsFromStorageEvent
} from "../src/settings.mjs";

/* ── 1. 设置面 v12（spec「设置 v10 与历史值迁移」；v12 = 删缩放阈值两键） ── */
assert.equal(COSMOS_SETTINGS_VERSION, 12, "设置面 v12（v10 = dock 迁移，v11 = templateNames，v12 = 删缩放阈值两键）");
assert.deepEqual([...COSMOS_LAUNCH_MODES], ["embedded", "dock"], "打开方式两档 embedded | dock");
assert.equal(COSMOS_DEFAULT_LAUNCH_MODE, "embedded", "缺省 = 内嵌整页");
assert.equal(sanitizeCosmosSettings({}).launchMode, "embedded", "空载荷 → 缺省 embedded");
assert.equal(sanitizeCosmosSettings({ launchMode: "embedded" }).launchMode, "embedded", "embedded 透传");
assert.equal(sanitizeCosmosSettings({ launchMode: "dock" }).launchMode, "dock", "dock 透传");
assert.equal(sanitizeCosmosSettings({ launchMode: "window" }).launchMode, "dock", "v10 迁移：历史 window → dock");
for (const bad of ["WINDOW", "window ", "desktop", "hacker", 1, true, null, undefined, [], {}]) {
  assert.equal(sanitizeCosmosSettings({ launchMode: bad }).launchMode, "embedded", "非法值回落 embedded：" + String(bad));
}
assert.equal(
  settingsFromStorageEvent({ key: "dsh-v-cosmos:settings", newValue: JSON.stringify({ launchMode: "window" }) }).launchMode,
  "dock",
  "storage 跨窗桥同样执行 window → dock 迁移"
);
assert.equal(
  settingsFromStorageEvent({ key: "dsh-cosmos:settings", newValue: JSON.stringify({ launchMode: "window" }) }).launchMode,
  "dock",
  "旧键名存档同样迁移"
);

/* ── 2. 入口分流判据（spec「dock 形态入口分流」） ── */
assert.deepEqual(
  dockEntryPlanOf({ launchMode: "embedded", available: true, sessionId: "s1", tabOpen: false }),
  { action: "toggle-page", reason: "embedded" },
  "embedded → 翻转整页（零变化）"
);
assert.deepEqual(
  dockEntryPlanOf({ launchMode: "dock", available: false, sessionId: "s1", tabOpen: false }),
  { action: "fallback-page", reason: "host-unavailable" },
  "宿主席位缺席 → 回落内嵌整页"
);
assert.deepEqual(
  dockEntryPlanOf({ launchMode: "dock", available: true, sessionId: undefined, tabOpen: false }),
  { action: "fallback-page", reason: "no-session" },
  "无会话在屏 → 回落内嵌整页"
);
assert.deepEqual(
  dockEntryPlanOf({ launchMode: "dock", available: true, sessionId: "", tabOpen: false }),
  { action: "fallback-page", reason: "no-session" },
  "空 sessionId 同样回落（不打开空白右栏）"
);
assert.deepEqual(
  dockEntryPlanOf({ launchMode: "dock", available: true, sessionId: "s1", tabOpen: false }),
  { action: "open-tab", reason: "dock" },
  "dock + 会话在屏 → 打开 tab"
);
assert.deepEqual(
  dockEntryPlanOf({ launchMode: "dock", available: true, sessionId: "s1", tabOpen: true }),
  { action: "reveal-tab", reason: "already-open" },
  "已开 → 揭示聚焦既有 tab（不新开重复 tab）"
);

/* ── 3. 关页裁决（spec「dock 态动作链路恒 keep」） ── */
assert.equal(pageCloseActionOf("embedded"), "close-page", "embedded 跳转尾巴 = 关整页");
assert.equal(pageCloseActionOf("dock"), "keep-page", "dock 跳转尾巴 = no-op（tab 保持）");
assert.equal(pageCloseActionOf(undefined), "close-page", "未知值保守回落关整页（embedded 语义）");
assert.equal(pageCloseActionOf("window"), "close-page", "历史值不成为 keep 判据");

/* ── 4. tab 呈现态投影与回落文案键 ── */
const tabs = [
  { sessionId: "s1", tabId: "t1", kind: "files", contentId: "dsh-resource://file/a" },
  { sessionId: "s1", tabId: "t2", kind: COSMOS_DOCK_TAB_KIND, contentId: "sidebar://cosmos" },
  { sessionId: "s2", tabId: "t3", kind: COSMOS_DOCK_TAB_KIND, contentId: "sidebar://cosmos" }
];
assert.equal(COSMOS_DOCK_TAB_ID, "dsh-v-cosmos", "tab id = 插件名（宿主唯一性）");
assert.equal(COSMOS_DOCK_TAB_KIND, "cosmos", "tab kind = cosmos");
assert.deepEqual(findDockTabOf(tabs, "s1"), { sessionId: "s1", tabId: "t2", kind: "cosmos" }, "按在屏会话查找 dock tab");
assert.equal(findDockTabOf(tabs, "s3"), null, "无该会话 tab → null");
assert.equal(findDockTabOf(tabs, undefined), null, "无会话 → null");
assert.equal(findDockTabOf(null, "s1"), null, "坏输入 → null（不抛错）");
assert.deepEqual(
  dockPresenceOf({ available: true, tabs, sessionId: "s1" }),
  { available: true, active: true, sessionId: "s1", tabId: "t2" },
  "呈现态：在屏会话已有 Cosmos tab → active"
);
assert.deepEqual(
  dockPresenceOf({ available: true, tabs, sessionId: "s9" }),
  { available: true, active: false, sessionId: "s9", tabId: null },
  "呈现态：无 tab → inactive"
);
assert.deepEqual(
  dockPresenceOf({ available: false, tabs: [], sessionId: undefined }),
  { available: false, active: false, sessionId: undefined, tabId: null },
  "呈现态：宿主席位缺席 → unavailable/inactive"
);
assert.equal(dockFallbackNoticeKeyOf("no-session"), "cosmos.dock.noSession", "无会话回落文案键");
assert.equal(dockFallbackNoticeKeyOf("host-unavailable"), "cosmos.dock.hostUnavailable", "席位缺席回落文案键");
assert.equal(dockFallbackNoticeKeyOf("unknown"), "cosmos.dock.noSession", "未知 reason 保守归无会话口径");

/* ── 5. 源码锚点：注册面 / 正文槽 / guide / 键盘纪律 / 宿主半区清理 ── */
const client = readFileSync(new URL("../src/client.jsx", import.meta.url), "utf8");
const engine = readFileSync(new URL("../src/cosmos/engine.mjs", import.meta.url), "utf8");
const host = readFileSync(new URL("../src/index.mjs", import.meta.url), "utf8");
const api = readFileSync(new URL("../src/api.mjs", import.meta.url), "utf8");

assert.ok(client.includes('tryInject(["sidebarRight", "sidebarRightTabs"]'), "宿主席位条件注入（老宿主缺席不激活）");
assert.ok(client.includes("tabs.register({"), "tab 类型注册");
assert.ok(client.includes("id: COSMOS_DOCK_TAB_ID"), "类型 id = COSMOS_DOCK_TAB_ID");
assert.ok(client.includes("kind: COSMOS_DOCK_TAB_KIND"), "类型 kind = COSMOS_DOCK_TAB_KIND");
assert.ok(client.includes("guide: [{"), "guide entry 注册（引导页/添加控件入口）");
assert.ok(client.includes("icon: CosmosGuideIcon"), "guide entry 携带图标");
assert.ok(client.includes("description: () => sectionT(\"cosmos.guide.description\")"), "guide entry 携带说明");
assert.ok(
  client.includes('ctx.slots.inject("sidebar.right.pane.tab"') && client.includes("key: COSMOS_DOCK_TAB_ID"),
  "正文槽 sidebar.right.pane.tab 按同一 id 注册"
);
assert.ok(!/keepMounted\s*:\s*true/.test(client), "正文不声明 keepMounted（切 tab 即卸载，重挂载自愈）");
assert.ok(client.includes("function CosmosDockBody"), "dock 正文组件在册");
assert.ok(client.includes('className={dock ? "cos-page cos-page-dock" : "cos-page"}'), "覆盖/分栏共用同一呈现面，仅承载容器分叉");
assert.ok(client.includes("if (dock) return undefined;"), "dock 正文不注册全局键盘监听（Esc 归宿主）");
const overlayEsc = client.slice(client.indexOf("/* Esc 分层（5.3"), client.indexOf("const containerStyle = dock"));
assert.ok(!overlayEsc.includes("if (!dock)"), "Esc 链仅 overlay 注册（dock 早退）");
assert.ok(client.includes(".cos-page-dock .cos-card{"), "列形卡盒约束（不越缘）");
assert.ok(client.includes("const [dockSessionPanelOpen, setDockSessionPanelOpen] = useState(false);"), "dock 会话面板默认折叠（本地态，不污染整页偏好）");
assert.ok(client.includes(".cos-page-dock .cos-search{"), "窄列搜索框密度校准");
assert.ok(client.includes("paneId = typeof right.split === \"function\" ? right.split() : undefined;"), "新开先请宿主原生分栏（返新格 id）");
assert.ok(client.includes("right.openTab(COSMOS_DOCK_TAB_KIND, { paneId });"), "Cosmos 落进新格，既有右栏标签保留原格");
assert.ok(client.includes('"cosmos.dock.splitHint"'), "分栏不可用（宽度不足/两格上限）时提示拖宽");
assert.ok(client.includes("right.focus(tab.tabId);"), "已开先聚焦既有格（避免活动格重复开页）");
assert.ok(!/right\.toggleExpanded\(/.test(client), "入口不自 toggleExpanded（fullscreen / 非活动 pane 会误收列）");
assert.ok(engine.includes("const chipX = snap1(clamp(ws.proj.x, 8 + chipHalf, W - 8 - chipHalf));"), "引擎 chip 横向钳制（列视口）");
assert.ok(engine.includes("const slabX = snap1(clamp(scr.x, 8 + slabHalf, W - 8 - slabHalf));"), "引擎名牌横向钳制（列视口）");
assert.ok(engine.includes("cx = Math.max(TIP_LINE.flipMargin + E.tipCardW, cx);"), "信息卡翻转侧左缘钳制（不越列缘）");
assert.ok(!host.includes("presence"), "宿主半区 presence 注册/广播零残留");
assert.ok(!host.includes("cosmos-window"), "宿主半区 role 连接处理零残留");
assert.ok(!api.includes("role"), "api.mjs 订阅面零 role 参数");
assert.ok(!api.includes("cosmos-presence-changed"), "api.mjs 零 presence 帧分支");

console.log("rightbar-dock-smoke: all assertions passed");
