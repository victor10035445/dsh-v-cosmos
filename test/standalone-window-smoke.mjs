/**
 * 独立窗口冒烟（add-cosmos-standalone-window 6.1–6.3）：
 *  1. presence 纯逻辑（宿主半区）：角色判据 / 占位登记表（幂等增删、清场）/ 计数帧；
 *  2. 设置面 v9：`launchMode` 缺省与枚举净房 / v8 载荷升级补缺省 / `storage` 事件桥；
 *  3. 浏览器半区纯逻辑：独立窗口检测 / URL 构造 / 桌面降级 / 座位锁定 / 双窗提示 /
 *     关页动作裁决 / 无壳样式选择器；
 *  4. SSE 通道接线（api.mjs）：`role` 查询参数 + presence 帧透传（坏帧丢弃）；
 *  5. 源码锚点：宿主 `/events` 占位登记 + 清位、client 各分流点与词典成对、
 *     settings-ui 通用页签、engine 导航可用性门。
 *
 * 运行：node test/standalone-window-smoke.mjs（无需先 build；factory 面由 factory-smoke 覆盖）
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  COSMOS_PRESENCE_FRAME,
  COSMOS_WINDOW_ROLE,
  createPresenceRegistry,
  isCosmosWindowRole,
  presenceFrameOf
} from "../src/presence.mjs";
import {
  STANDALONE_CSS,
  closeDecisionOf,
  effectiveLaunchModeOf,
  isDesktopProtocol,
  isStandalonePage,
  isStandaloneSearch,
  otherWindowHintOf,
  seatLockOf,
  standaloneUrlOf
} from "../src/standalone.mjs";
import {
  COSMOS_DEFAULT_LAUNCH_MODE,
  COSMOS_LAUNCH_MODES,
  COSMOS_SETTINGS_DEFAULTS,
  COSMOS_SETTINGS_VERSION,
  sanitizeCosmosSettings,
  settingsFromStorageEvent
} from "../src/settings.mjs";

const read = (path) => readFileSync(new URL("../src/" + path, import.meta.url), "utf8");

/* ── 1. presence 纯逻辑（6.1 / design D2） ── */
{
  assert.equal(COSMOS_WINDOW_ROLE, "cosmos-window", "角色标识 = cosmos-window（协议常量单一来源）");
  assert.equal(COSMOS_PRESENCE_FRAME, "cosmos-presence-changed", "轻帧类型名");
  assert.equal(isCosmosWindowRole("cosmos-window"), true, "角色精确命中");
  for (const bad of ["", "COSMOS-WINDOW", "cosmos-window ", "cosmos", null, undefined, 1, {}]) {
    assert.equal(isCosmosWindowRole(bad), false, "非角色值不登记占位：" + String(bad));
  }

  /* 占位登记表：add/delete 幂等（同一连接 MUST NOT 重复计数），count 即占位窗口数 */
  const registry = createPresenceRegistry();
  assert.equal(registry.count(), 0, "净房计数 0");
  const a = { id: "a" };
  const b = { id: "b" };
  assert.equal(registry.add(a), true, "首次登记改变计数");
  assert.equal(registry.count(), 1, "占位 1");
  assert.equal(registry.add(a), false, "重复登记幂等（不重复计数）");
  assert.equal(registry.count(), 1, "幂等后仍为 1");
  assert.equal(registry.add(b), true, "第二窗口登记");
  assert.equal(registry.count(), 2, "双窗占位 2（容忍并存）");
  assert.equal(registry.has(a), true, "在册判据");
  assert.equal(registry.delete(a), true, "断开释放改变计数");
  assert.equal(registry.delete(a), false, "重复释放幂等");
  assert.equal(registry.count(), 1, "释放后计数回落");
  assert.equal(registry.add(null), false, "空 token 不登记（防御）");
  registry.reset();
  assert.equal(registry.count(), 0, "插件卸载清场归零（dispose 语义）");

  /* 计数帧：计数即载荷（最小例外）；非法/负数 → 0 */
  assert.deepEqual(presenceFrameOf(2), { type: COSMOS_PRESENCE_FRAME, count: 2 }, "计数帧体形状");
  assert.deepEqual(presenceFrameOf("3"), { type: COSMOS_PRESENCE_FRAME, count: 3 }, "数字串归一");
  assert.deepEqual(presenceFrameOf(-1), { type: COSMOS_PRESENCE_FRAME, count: 0 }, "负数归零");
  assert.deepEqual(presenceFrameOf("NaN"), { type: COSMOS_PRESENCE_FRAME, count: 0 }, "非法值归零");
  assert.deepEqual(presenceFrameOf(1.9), { type: COSMOS_PRESENCE_FRAME, count: 1 }, "取整");
}

/* ── 2. 设置面 v9：launchMode（6.2 / design D4） ── */
{
  assert.equal(COSMOS_SETTINGS_VERSION, 9, "设置面 v9（v8 = shortcuts，v9 = launchMode）");
  assert.deepEqual(COSMOS_LAUNCH_MODES, ["embedded", "window"], "枚举两档（embedded 在前 = 缺省）");
  assert.equal(COSMOS_DEFAULT_LAUNCH_MODE, "embedded", "缺省 = 现状（内嵌整页）");
  assert.equal(COSMOS_SETTINGS_DEFAULTS.launchMode, "embedded", "净房缺省同源");
  assert.equal(sanitizeCosmosSettings({}).launchMode, "embedded", "空载荷 → 缺省");
  assert.equal(sanitizeCosmosSettings({ launchMode: "window" }).launchMode, "window", "合法值透传");
  for (const bad of ["", "Window", "standalone", 1, null, true, {}, []]) {
    assert.equal(sanitizeCosmosSettings({ launchMode: bad }).launchMode, "embedded", "枚举外回落缺省：" + String(bad));
  }

  /* v8 载荷（含 shortcuts、无 launchMode）→ 读出补缺省（零迁移） */
  const v8Payload = {
    panSpeed: 120, panShiftBoost: 3, skin: "rosepine", zoomDiveRatio: 100, zoomFlyOutRatio: 25,
    zoomPointerFocus: true, sessionPanelOpen: true, constPreflight: "float", dragPan: false,
    shortcuts: { closePage: "Escape", goHome: "Backquote", togglePan: "KeyM", voiceToggle: "Ctrl+KeyQ" }
  };
  const upgraded = sanitizeCosmosSettings(v8Payload);
  assert.equal(upgraded.launchMode, "embedded", "v8 载荷补缺省 launchMode");
  assert.deepEqual(upgraded.shortcuts, v8Payload.shortcuts, "v8 既有键零改写");

  /* storage 事件桥（跨窗口即时生效的纯函数面） */
  const key = "dsh-v-cosmos:settings";
  assert.equal(settingsFromStorageEvent({ key: "other-plugin", newValue: "{}" }), null, "无关键 → null（静默忽略）");
  assert.equal(settingsFromStorageEvent(null), null, "无事件 → null");
  assert.equal(settingsFromStorageEvent({ key }).launchMode, "embedded", "缺 newValue 按净房空载荷");
  assert.equal(settingsFromStorageEvent({ key, newValue: "" }).launchMode, "embedded", "空串载荷 → 缺省");
  assert.equal(settingsFromStorageEvent({ key, newValue: "{bad" }).launchMode, "embedded", "坏 JSON → 缺省（不抛错）");
  assert.equal(
    settingsFromStorageEvent({ key, newValue: JSON.stringify({ launchMode: "window" }) }).launchMode,
    "window",
    "他窗写入 window → 桥接读出新值"
  );
  assert.equal(
    settingsFromStorageEvent({ key: "dsh-cosmos:settings", newValue: JSON.stringify({ launchMode: "window" }) }).launchMode,
    "window",
    "旧名键同样桥接（读取回落迁移同源）"
  );
  assert.equal(
    settingsFromStorageEvent({ key, newValue: JSON.stringify({ launchMode: "hacker" }) }).launchMode,
    "embedded",
    "事件载荷同样净房（未知值回落）"
  );
}

/* ── 3. 浏览器半区纯逻辑（6.3 / design D1/D5/D7） ── */
{
  /* 检测：精确查询串匹配（同名不同值/大小写变体一律否） */
  assert.equal(isStandaloneSearch("?cosmos=window"), true, "命中独立窗口参数");
  assert.equal(isStandaloneSearch("cosmos=window"), true, "无前导 ? 亦可（容错）");
  assert.equal(isStandaloneSearch("?x=1&cosmos=window"), true, "多参数中命中");
  assert.equal(isStandaloneSearch("?cosmos=window&x=1"), true, "命中在首参");
  assert.equal(isStandaloneSearch("?cosmos=1"), false, "同名不同值否");
  assert.equal(isStandaloneSearch("?cosmos=Window"), false, "大小写变体否");
  assert.equal(isStandaloneSearch("?cosmos"), false, "空值否");
  assert.equal(isStandaloneSearch(""), false, "空查询否");
  assert.equal(isStandaloneSearch(undefined), false, "缺值否");
  assert.equal(isStandaloneSearch("?%E0%A4%A=window"), false, "坏编码段不抛错");

  /* 桌面降级（D1）：页面协议非 http(s) 即桌面（dsh-app: 桌面壳 / file:） */
  assert.equal(isDesktopProtocol("file:"), true, "file: 判桌面");
  assert.equal(isDesktopProtocol("dsh-app:"), true, "dsh-app: 桌面壳判桌面");
  assert.equal(isDesktopProtocol("DSH-APP:"), true, "大小写归一判桌面");
  assert.equal(isDesktopProtocol("custom-shell:"), true, "未来自定义协议同样判桌面（宽口径）");
  assert.equal(isDesktopProtocol("http:"), false);
  assert.equal(isDesktopProtocol("https:"), false);
  assert.equal(isDesktopProtocol("HTTP:"), false, "HTTP: 归一保持非桌面");
  assert.equal(isDesktopProtocol("HTTPS:"), false, "HTTPS: 归一保持非桌面");
  assert.equal(isDesktopProtocol(""), false, "空协议按非桌面（缺省守卫）");
  assert.equal(isDesktopProtocol(undefined), false, "缺省按非桌面");
  assert.equal(isDesktopProtocol(null), false, "非字符串按非桌面");
  assert.equal(isStandalonePage({ search: "?cosmos=window", protocol: "http:" }), true, "web 命中独立窗口");
  assert.equal(isStandalonePage({ search: "?cosmos=window", protocol: "https:" }), true, "https web 命中独立窗口");
  assert.equal(isStandalonePage({ search: "?cosmos=window", protocol: "file:" }), false, "桌面形态不进入独立窗口态");
  assert.equal(isStandalonePage({ search: "?cosmos=window", protocol: "dsh-app:" }), false, "dsh-app: 桌面壳不进入独立窗口态");
  assert.equal(isStandalonePage({ search: "?cosmos=1", protocol: "http:" }), false, "未命中参数不进入");
  assert.equal(isStandalonePage(), false, "空输入安全");

  /* URL 构造：origin + 根路径 + 查询参数（尾斜杠归一，origin 缺席回落相对根） */
  assert.equal(standaloneUrlOf("http://127.0.0.1:3080"), "http://127.0.0.1:3080/?cosmos=window", "标准 origin");
  assert.equal(standaloneUrlOf("http://127.0.0.1:3080/"), "http://127.0.0.1:3080/?cosmos=window", "尾斜杠归一");
  assert.equal(standaloneUrlOf(""), "/?cosmos=window", "origin 缺席 → 相对根");
  assert.equal(standaloneUrlOf(null), "/?cosmos=window", "非字符串安全");

  /* 启动分流：桌面形态恒 embedded（忽略历史 window 配置，MUST NOT 报错） */
  assert.equal(effectiveLaunchModeOf({ launchMode: "window", protocol: "http:" }), "window", "web + window → 独立窗口");
  assert.equal(effectiveLaunchModeOf({ launchMode: "window", protocol: "file:" }), "embedded", "桌面忽略 window 配置");
  assert.equal(effectiveLaunchModeOf({ launchMode: "window", protocol: "dsh-app:" }), "embedded", "dsh-app: 桌面忽略 window 配置");
  assert.equal(effectiveLaunchModeOf({ launchMode: "embedded", protocol: "http:" }), "embedded", "embedded 保持内嵌");
  assert.equal(effectiveLaunchModeOf({ launchMode: "bogus", protocol: "http:" }), "embedded", "非法配置回落内嵌");
  assert.equal(effectiveLaunchModeOf({}), "embedded", "空输入 → 内嵌");
  assert.equal(effectiveLaunchModeOf(), "embedded", "无参 → 内嵌");

  /* 座位锁定（presence 互斥）：计数 ≥1 禁用 */
  assert.equal(seatLockOf(0), false, "无占位可用");
  assert.equal(seatLockOf(1), true, "单占位锁定");
  assert.equal(seatLockOf("2"), true, "计数串归一");
  assert.equal(seatLockOf(-1), false, "负数不锁");
  assert.equal(seatLockOf(null), false, "空值不锁");
  assert.equal(seatLockOf(undefined), false, "缺值不锁");

  /* 双窗提示：standalone 且 count ≥ 2 */
  assert.equal(otherWindowHintOf({ standalone: true, count: 2 }), true, "双窗提示");
  assert.equal(otherWindowHintOf({ standalone: true, count: 1 }), false, "单窗不提示");
  assert.equal(otherWindowHintOf({ standalone: false, count: 9 }), false, "内嵌态不提示");
  assert.equal(otherWindowHintOf({}), false, "空输入不提示");

  /* 关页动作裁决（D5）：内嵌关整页；独立窗口关窗；关窗被拒 → 保持整页 + 提示 */
  assert.deepEqual(closeDecisionOf({ standalone: false }), { action: "close-page", hint: false }, "内嵌态关整页");
  assert.deepEqual(closeDecisionOf({ standalone: true, closed: true }), { action: "closed", hint: false }, "关窗成功");
  assert.deepEqual(closeDecisionOf({ standalone: true, closed: false }), { action: "keep-page", hint: true }, "关窗被拒 → 保持整页 + 提示");
  assert.deepEqual(closeDecisionOf(), { action: "close-page", hint: false }, "空输入按内嵌");

  /* 无壳样式：选择器集中定义（官方壳 DOM 演进只改这一处） */
  for (const selector of [
    'html[data-cosmos-standalone] [data-slot="sidebar"]',
    'div:has(> [data-slot="sidebar"])',
    "html[data-cosmos-standalone] [data-shell-bottom]",
    "html[data-cosmos-standalone] [data-shell-leading]"
  ]) {
    assert.ok(STANDALONE_CSS.includes(selector), "无壳选择器在册：" + selector);
  }
  assert.ok(STANDALONE_CSS.includes("display:none!important"), "隐藏规则 !important（压过官方内联/层叠）");
}

/* ── 4. SSE 通道接线（6.1 / 3.4 / api.mjs）：role 查询 + presence 帧透传 ── */
{
  /* EventSource 桩：捕获连接 URL 并手工派发帧（api.mjs 只在调用期引用全局). */
  const sources = [];
  globalThis.EventSource = class {
    constructor(url) {
      this.url = url;
      this.closed = false;
      sources.push(this);
    }
    close() {
      this.closed = true;
    }
    emit(payload) {
      this.onmessage({ data: typeof payload === "string" ? payload : JSON.stringify(payload) });
    }
  };
  const { subscribeCosmosEvents } = await import("../src/api.mjs");
  try {
    const frames = [];
    const off = subscribeCosmosEvents((frame) => frames.push(frame), { role: COSMOS_WINDOW_ROLE });
    assert.equal(sources.length, 1, "建立单条连接");
    assert.equal(sources[0].url, "/api/dsh-v-cosmos/events?role=cosmos-window", "独立窗口连接携带 role 标识");
    sources[0].emit({ type: "proposals-changed" });
    sources[0].emit({ type: "associations-changed" });
    sources[0].emit({ type: "cosmos-presence-changed", count: 2 });
    sources[0].emit({ type: "cosmos-presence-changed", count: "bad" });
    sources[0].emit({ type: "unknown-frame" });
    sources[0].emit("{bad json");
    assert.deepEqual(
      frames,
      [{ type: "proposals-changed" }, { type: "associations-changed" }, { type: "cosmos-presence-changed", count: 2 }],
      "轻帧透传（坏的 presence 计数 / 未知帧 / 坏 JSON 全部丢弃）"
    );
    off();
    assert.equal(sources[0].closed, true, "卸载关闭连接（占位随之释放）");

    /* 内嵌态：无 role → 无查询参数（不登记占位） */
    globalThis.EventSource = class {
      constructor(url) {
        this.url = url;
      }
      close() {}
    };
    const plain = [];
    const offPlain = subscribeCosmosEvents(() => plain.push(1));
    const last = plain; // 保持引用（无副作用）
    assert.equal(last.length, 0, "未收到帧前无回调");
    offPlain();
  } finally {
    delete globalThis.EventSource;
  }
}

/* ── 5. 源码锚点（宿主 + client + settings-ui + engine） ── */
{
  /* 宿主半区：/events 解析 role → 登记占位；断开清位并广播；dispose 清场 */
  const host = read("index.mjs");
  assert.ok(host.includes("createPresenceRegistry, isCosmosWindowRole, presenceFrameOf"), "宿主导入 presence 纯逻辑模块");
  assert.ok(host.includes('url.searchParams.get("role")'), "读取 role 查询参数");
  assert.ok(host.includes("presence.add(res)"), "独立窗口连接登记占位");
  assert.ok(host.includes("const wasWindow = presence.delete(res);"), "断开释放占位（无崩溃残留）");
  assert.ok(host.includes("if (wasWindow) broadcastPresence();"), "释放后广播计数（主壳解锁）");
  assert.ok(host.includes("broadcastPresence();") && host.includes("const broadcastPresence = () => broadcast(presenceFrameOf(presence.count()));"), "计数帧走既有 SSE 广播通道（不另起通道）");
  assert.ok(host.includes("presence.reset();"), "插件卸载清场归零");
  assert.ok(!/setInterval\([^)]*presence/.test(host), "占位不依赖轮询/TTL（连接即心跳）");

  /* client 半区：检测 / 无壳 / 自动开页 / 关窗收口 / 分流 / 导航短路 */
  const client = read("client.jsx");
  assert.ok(client.includes('from "./standalone.mjs"'), "纯逻辑导入（检测/URL/分流/关页裁决/样式单一来源）");
  assert.ok(client.includes('from "./presence.mjs"'), "角色常量与宿主同源");
  assert.ok(client.includes("const STANDALONE = (function detectStandalone()"), "模块根一次性检测（URL 参数为页面不变量）");
  assert.ok(client.includes('document.documentElement.setAttribute("data-cosmos-standalone", "1")'), "根级无壳标记");
  assert.ok(client.includes("cosmosOpenStore.set(true);") && client.includes("if (STANDALONE && typeof document !== \"undefined\")"), "独立窗口自动开整页");
  assert.ok(client.includes("${STANDALONE_CSS}"), "无壳样式拼进插件样式表（选择器集中定义）");
  assert.ok(client.includes("left: STANDALONE || degraded ? 0 : pageLeft"), "整页显式全幅（:has 失效兜底）");

  /* 关页收口：唯一写点 + 被拒提示 */
  assert.ok(client.includes("function requestPageClose()"), "关页唯一收口函数");
  assert.ok(client.includes("const close = () => requestPageClose();"), "整页关闭按钮 / Esc 末层共用收口");
  assert.ok(client.includes("cosmosStandaloneStore.set({ closeHint: true });"), "关窗被拒落手动关窗提示");
  assert.ok(client.includes("if (decision.hint)"), "提示由裁决函数决定（MUST NOT 静默关整页）");

  /* 座位分流：点击现读 launchMode + 弹窗拦截引导 + 占位禁用 */
  const seat = client.slice(client.indexOf("function CosmosSeat({ wide, t })"), client.indexOf("const CSS = `"));
  assert.ok(seat.includes("effectiveLaunchModeOf({ launchMode: launchState?.launchMode, protocol: pageProtocol() })"), "点击时现读配置 + 桌面降级");
  assert.ok(seat.includes("openStandaloneWindow("), "window 模式走 window.open 独立窗口");
  assert.ok(seat.includes("disabled={locked}"), "占位期间禁用（双形态同源）");
  assert.ok(seat.includes('tr("cosmos.seat.locked"'), "禁用提示文案");
  assert.ok(seat.includes('tr("cosmos.seat.windowAria"'), "独立窗口打开文案（跨窗口配置跟随）");
  assert.ok(client.includes('tr("cosmos.seat.popupBlocked", "浏览器拦截了独立窗口，请放行弹窗后重试")'), "弹窗拦截引导（MUST NOT 静默失败）");
  assert.ok(client.includes("showCosmosToast(blockedText, true);"), "拦截提示走页面外 toast（整页未开也可用）");
  assert.ok(
    seat.indexOf("if (windowMode)") >= 0 && seat.indexOf("if (windowMode)") < seat.indexOf("openStandaloneWindow("),
    "window.open 仅在 window 分支内（桌面形态必走 embedded 分支，死提示不可达）"
  );

  /* presence 消费：standalone 连接带 role，不触发骨架重拉 */
  assert.ok(client.includes('}, { role: STANDALONE ? COSMOS_WINDOW_ROLE : "" }));'), "连接角色按 standalone 分流");
  assert.ok(client.includes("cosmosPresenceStore.set({ count });"), "计数帧写受控镜像（同值短路：连接建立的全量帧不触发重渲染）");
  assert.ok(client.includes("if (frame?.type === \"cosmos-presence-changed\")"), "presence 帧单独分流（不回拉骨架）");

  /* 双窗提示渲染 */
  assert.ok(client.includes('data-plugin-anchor="dsh-v-cosmos:standalone-hint"'), "页内提示条锚点");
  assert.ok(client.includes("otherWindowHintOf({ standalone: true, count: presenceState?.count })"), "双窗提示判据单一来源");

  /* 导航短路（design D6）：链路入口先于关页；执行器 / 面板行 / 决策 / 动作尾巴同链 */
  const openAction = client.slice(client.indexOf("openSession(sessionId) {"), client.indexOf("refresh() {"));
  assert.ok(openAction.indexOf("if (STANDALONE) return") < openAction.indexOf("cosmosOpenStore.set(false)"), "standalone 短路先于关整页");
  assert.ok(openAction.includes("ctx.uiWorkspace?.openSession"), "内嵌态既有导航链路零变化");
  assert.ok(client.includes("openSessionVia = (sessionId) => {\n    if (STANDALONE) return false;"), "执行器导航尾巴同款短路");

  /* 动作链路反馈与送达（add-cosmos-standalone-jump-feedback D1–D3）：跳转尾巴按链路口径
     参数化（内嵌关整页零变化 / standalone no-op + 专属 toast）；提案与星座 autoSend 在
     STANDALONE 下开启服务端送达通道（startSession 落稿，不经窗口内标记接力）。 */
  assert.ok(client.includes('const closePageAfterJump = (link = "proposal", context = {}) => {'), "动作跳转尾巴关页收口（按链路口径参数化）");
  const jumpTail = client.slice(
    client.indexOf('const closePageAfterJump = (link = "proposal", context = {}) => {'),
    client.indexOf("const startSessionVia =")
  );
  assert.ok(jumpTail.length > 0, "closePageAfterJump 函数体可定位");
  assert.ok(jumpTail.includes("if (!STANDALONE) {") && jumpTail.includes("cosmosOpenStore.set(false);"), "内嵌态关整页（行为零变化）");
  assert.ok(jumpTail.includes('if (link === "embryo") {'), "星胚链路专属口径分支");
  assert.ok(jumpTail.includes('tr("cosmos.actions.standaloneJumpFeedback"'), "提案反馈文案（会话草稿已在主窗口准备）");
  assert.ok(jumpTail.includes('tr("cosmos.actions.standaloneAutoSendNote"'), "autoSend 未执行说明（MUST NOT 承诺已发送）");
  assert.ok(jumpTail.includes('tr("cosmos.actions.standaloneEmbryoFeedback"'), "星胚引导反馈（探索会话需在主窗口操作）");
  assert.ok((jumpTail.match(/notifyToast\?\./g) ?? []).length >= 2, "独立窗口反馈走 toast（窗口保持打开）");
  assert.ok(!/window\.close/.test(jumpTail), "动作跳转永不关窗（关页短路保持）");
  assert.ok(client.includes('closePage: (context) => closePageAfterJump("proposal", context),'), "提案执行器注入提案口径反馈尾巴");
  assert.ok(client.includes('closePage: () => closePageAfterJump("embryo"),'), "星胚执行器注入星胚口径反馈尾巴");
  assert.equal((client.match(/standaloneServerChannel: STANDALONE,/g) ?? []).length, 2, "提案/星座执行器在 STANDALONE 下开启服务端送达通道（星胚不开启）");
  assert.ok(client.includes("standaloneNotice: () => notifyToast?.("), "星座 autoSend 通道反馈走注入回调（执行器不感知文案）");
  assert.ok(client.includes('tr("cosmos.actions.standaloneConstDraft"'), "星座 autoSend 草稿落盘反馈文案");
  const preflightAt = client.indexOf("preflight: () => {");
  const preflightInjection = client.slice(preflightAt, client.indexOf("standaloneNotice: () => notifyToast?.(", preflightAt));
  assert.ok(preflightInjection.length > 0, "preflight 注入点可定位");
  assert.ok(preflightInjection.includes("const intent = loadCosmosSettings().constPreflight;"), "preflight 每次 run 现读设置面");
  assert.ok(preflightInjection.includes('if (!STANDALONE) return intent;') && preflightInjection.includes('return "float";'), "独立窗口强制 float（星空保持）");
  assert.ok(preflightInjection.includes('if (intent === "native") {'), "仅 native 意图被改写时呈现反馈（float 缺省不 toast）");
  assert.ok(preflightInjection.includes('tr("cosmos.actions.standalonePreflightFeedback"'), "native 改写反馈文案键");

  /* 引擎导航可用性注入 */
  assert.ok(client.includes("sessionNavAvailable: !STANDALONE,"), "引擎注入导航可用性");
  assert.ok(client.includes('tr("cosmos.card.openDisabled"'), "信息卡禁用提示文案注入");

  /* 设置面接线：通用页签 order -1 + launch face + storage 事件桥 */
  assert.ok(client.includes('id: "general"') && client.includes("order: -1,"), "「通用」页签置于「快捷动作」(0) 之前");
  assert.ok(client.includes("CosmosGeneralPanel"), "通用页签组件注册");
  assert.ok(client.includes("inject: () => ({ launch: launchFace, desktop: DESKTOP_PROTOCOL })"), "注入 launch face + 桌面标记");
  assert.ok(client.includes("const launchFace = {"), "launch face（受控镜像 + 写入）");
  assert.ok(client.includes("set: (mode) => applyLaunchMode(mode)"), "写入唯一链路 = applyLaunchMode");
  assert.ok(client.includes("window.addEventListener(\"storage\", onStorage);"), "storage 事件桥绑定");
  assert.ok(client.includes("const next = settingsFromStorageEvent(event);"), "桥接判据走纯函数（无关键静默）");
  const launchWrite = client.slice(client.indexOf("function applyLaunchMode(mode)"), client.indexOf("const STANDALONE_CLOSE_PROBE_MS"));
  assert.ok(launchWrite.includes("saveCosmosSettings({ launchMode: mode })"), "净房持久化");
  assert.ok(launchWrite.includes("cosmosLaunchStore.set({ launchMode: merged.launchMode })"), "受控镜像同步（设置页回显）");

  /* 词典 zh/en 成对（DICT 区块内各 2 次：zh + en；`"<key>":` 形态不进代码调用面） */
  const dict = client.slice(client.indexOf("const DICT = {"));
  for (const key of [
    "cosmos.seat.locked",
    "cosmos.seat.windowAria",
    "cosmos.seat.popupBlocked",
    "cosmos.card.openDisabled",
    "cosmos.standalone.otherWindow",
    "cosmos.standalone.manualClose",
    "cosmos.actions.standaloneJumpFeedback",
    "cosmos.actions.standaloneAutoSendNote",
    "cosmos.actions.standaloneEmbryoFeedback",
    "cosmos.actions.standalonePreflightFeedback",
    "cosmos.actions.standaloneConstDraft",
    "cosmos.settings.tabGeneral",
    "cosmos.settings.launchModeLabel",
    "cosmos.settings.launchModeHint",
    "cosmos.settings.launchModeEmbedded",
    "cosmos.settings.launchModeWindow",
    "cosmos.settings.launchModeDesktop",
    "cosmos.settings.launchModeInstant"
  ]) {
    assert.equal(
      (dict.match(new RegExp('"' + key.replace(/\./g, "\\.") + '":', "g")) ?? []).length,
      2,
      "词典 zh/en 成对：" + key
    );
  }
  /* 桌面降级说明（D3）：不点名具体协议（`dsh-app:` 桌面下「file://」字样自相矛盾） */
  const desktopCopy = dict.match(/"cosmos\.settings\.launchModeDesktop": "([^"]*)"/g) ?? [];
  assert.equal(desktopCopy.length, 2, "桌面降级说明 zh/en 成对");
  assert.ok(desktopCopy.every((line) => !line.includes("file://")), "桌面降级说明不硬编码 file://");
  assert.ok(desktopCopy.every((line) => line.includes("web")), "桌面降级说明点明「仅 web 形态可用」");

  /* settings-ui：通用面板（单选 + 桌面禁用 + 即时保存语义） */
  const ui = read("settings-ui.jsx");
  const panel = ui.slice(ui.indexOf("export function CosmosGeneralPanel"), ui.indexOf("export function CosmosActionsPanel"));
  assert.ok(panel.length > 0, "CosmosGeneralPanel 可定位");
  assert.ok(panel.includes('type="radio"'), "单选控件（非下拉/开关）");
  assert.ok(panel.includes("disabled={desktop}"), "桌面形态控件禁用（非 http(s) 判据联动）");
  assert.ok(panel.includes("data-desktop={desktop ? \"true\" : undefined}"), "禁用态呈现稳定钩子");
  assert.ok(panel.includes('tr(t, "cosmos.settings.launchModeDesktop"'), "桌面降级说明文案");
  assert.ok(!panel.includes("file://"), "settings-ui 桌面降级 fallback 不硬编码 file://");
  assert.ok(panel.includes("face?.set?.(mode)"), "改动即写 face（即时保存，无保存钮）");
  assert.ok(!/face\.save\(\)/.test(panel), "无「保存」按钮（轻量偏好语义）");
  assert.ok(!/controllerRef/.test(panel), "不依赖整页控制器存活（无引擎热更需求）");
  assert.ok(ui.includes("COSMOS_LAUNCH_MODES"), "枚举来源 = settings.mjs（单一来源）");

  /* engine：导航可用性门（按钮禁用渲染 + click 兜底 + 空格早退） */
  const engine = read("cosmos/engine.mjs");
  assert.ok(engine.includes("sessionNavAvailable: opts.sessionNavAvailable !== false"), "缺省可用（内嵌态零变化）");
  assert.ok(engine.includes("sessionNavAvailable: opts.sessionNavAvailable !== false") && engine.includes("card: Object.assign({}, DEFAULT_LABELS.card"), "card 文案注入位并入缺省表");
  const cardActions = engine.slice(engine.indexOf("function cardActionsHtml(sessionId, lead)"), engine.indexOf("function cardHtml(e)"));
  assert.ok(cardActions.includes("const open = E.sessionNavAvailable"), "按钮 markup 按可用性分流");
  assert.ok(cardActions.includes("disabled>打开会话</button>"), "不可用态渲染 disabled");
  assert.ok(cardActions.includes("escapeHtml(E.labels.card.openDisabled)"), "不可用态 title 提示");
  const clickBody = engine.slice(engine.indexOf("E.el.card.addEventListener('click'"), engine.indexOf("function isEmptyConstellation"));
  assert.ok(clickBody.indexOf("if (!E.sessionNavAvailable) return;") < clickBody.indexOf("if (E.onOpenSession)"), "click 兜底先于导航派发");
  const keyBody = engine.slice(engine.indexOf("const onKeyDown = function (ev)"), engine.indexOf("const onKeyUp = function (ev)"));
  assert.ok(keyBody.includes("if (!E.sessionNavAvailable) return;"), "空格快捷键早退（静默 no-op）");
  const guardAt = keyBody.indexOf("if (!E.sessionNavAvailable) return;");
  const guardPreventAt = keyBody.indexOf("ev.preventDefault();", guardAt);
  const openDispatchAt = keyBody.indexOf("if (E.onOpenSession) E.onOpenSession(sel.data.id);");
  assert.ok(
    guardAt >= 0 && guardPreventAt > guardAt && openDispatchAt > guardPreventAt,
    "早退先于本分支 preventDefault 与派发（空格回落宿主语义、不吞默认行为）"
  );
}

console.log("standalone-window-smoke: all assertions passed");
