/**
 * 顶部头部入口冒烟（add-cosmos-header-entry 3.1）：
 *  1. 注入注册面：`conversation.header.leading`（宿主 single / root）+ id / locale / 组件；
 *  2. 组件同源面：订阅 open / presence / launch 三 store、现读 launchMode、locked 短路、
 *     embedded 翻转、window 链路（弹窗拦截 toast 同源）、占位禁用、active / aria-expanded
 *     绑定、独立窗口形态短路、零新 locale 键；
 *  3. 双入口零漂移：同一 store 单件、同一分流纯函数、同一文案键（各恰好 2 处消费）；
 *  4. CSS：28px icon-only 基线 / radius-sm / 令牌 / no-drag 兜底 / active 与禁用态；
 *  5. 侧栏座位纯增量：既有注入与样式零改动。
 *
 * React 组件树在 Node 侧不可挂载（react 为 bundle external），故组件呈现走源码锚点 +
 * 既有纯逻辑直测（seatLockOf / effectiveLaunchModeOf 见 standalone-window-smoke）；
 * 真机交互验收见 walkthrough.md 清单。
 * 运行：node test/header-seat-smoke.mjs（无需先 build）
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL("../src/" + path, import.meta.url), "utf8");
const client = read("client.jsx");

/* ── 1. 注入注册面（2.2 / design D6） ── */
{
  const injectAt = client.indexOf('ctx.slots.inject("conversation.header.leading"');
  assert.ok(injectAt >= 0, "头部座位注入点在册");
  const injectEnd = client.indexOf("/* 3. Cosmos 整页", injectAt);
  assert.ok(injectEnd > injectAt, "注入段可界定（紧随整页注入之前）");
  const registration = client.slice(injectAt, injectEnd);
  assert.ok(registration.includes('name: "conversation.header.leading"'), "槽位名 = 宿主 conversation.header.leading");
  assert.ok(registration.includes('id: "v-cosmos-header-seat"'), "条目 id = v-cosmos-header-seat");
  assert.ok(registration.includes("locale: NS"), "locale 命名空间 = 插件 NS（文案键同源）");
  assert.ok(registration.includes("CosmosHeaderSeat"), "条目组件 = CosmosHeaderSeat");
  assert.ok(!registration.includes("order:"), "single 座位无 order 语义（不引入无效排序字段）");
}

/* ── 2. 组件同源面（2.1 / spec「同源行为」） ── */
const seatStart = client.indexOf("function CosmosHeaderSeat(");
const seatEnd = client.indexOf("const CSS = `", seatStart);
assert.ok(seatStart >= 0 && seatEnd > seatStart, "CosmosHeaderSeat 组件切片可达");
const seat = client.slice(seatStart, seatEnd);
{
  /* 三 store 订阅（与侧栏座位同构：open / presence / launch）。 */
  assert.ok(seat.includes("useCosmosOpen()"), "整页开合态订阅（useCosmosOpen）");
  assert.ok(
    seat.includes("useSyncExternalStore(cosmosPresenceStore.subscribe, cosmosPresenceStore.getSnapshot)"),
    "占位计数受控镜像订阅（cosmosPresenceStore）"
  );
  assert.ok(
    seat.includes("useSyncExternalStore(cosmosLaunchStore.subscribe, cosmosLaunchStore.getSnapshot)"),
    "launchMode 受控镜像订阅（cosmosLaunchStore，含 storage 跨窗桥更新）"
  );

  /* 行为分支：现读 launchMode → locked 短路 → window / embedded 分流。 */
  assert.ok(
    seat.includes("effectiveLaunchModeOf({ launchMode: launchState?.launchMode, protocol: pageProtocol() })"),
    "点击时现读配置 + 桌面形态降级（与侧栏座位同一纯函数）"
  );
  assert.ok(seat.includes("seatLockOf(presenceState?.count)"), "占位锁判据 = seatLockOf（同一纯函数）");
  const toggleAt = seat.indexOf("const toggle = () => {");
  assert.ok(toggleAt >= 0, "点击处理器（toggle）可界定");
  const lockedSkipAt = seat.indexOf("if (locked) return;", toggleAt);
  const windowBranchAt = seat.indexOf("if (windowMode) {", toggleAt);
  const popupToastAt = seat.indexOf('tr("cosmos.seat.popupBlocked"', windowBranchAt);
  const embedFlipAt = seat.indexOf("cosmosOpenStore.set(!cosmosOpenStore.getSnapshot());", toggleAt);
  assert.ok(lockedSkipAt > toggleAt, "locked 短路在位（竞态窗口兜底）");
  assert.ok(lockedSkipAt < windowBranchAt, "locked 短路先于 mode 分流（禁用态点击静默 no-op）");
  assert.ok(windowBranchAt > toggleAt && popupToastAt > windowBranchAt, "window 分支内取弹窗拦截文案");
  assert.ok(
    seat.includes(
      'openStandaloneWindow(tr("cosmos.seat.popupBlocked", "浏览器拦截了独立窗口，请放行弹窗后重试"));'
    ),
    "window 分支走同一 openStandaloneWindow（阻塞文案经 locale 同源键注入）"
  );
  assert.ok(embedFlipAt > windowBranchAt, "embedded 分支翻转同一整页 store（单一状态源）");

  /* 占位禁用态 + active / aria-expanded 绑定真实开合。 */
  assert.ok(seat.includes("disabled={locked}"), "占位锁：按钮 disabled");
  assert.ok(seat.includes("aria-disabled={locked || undefined}"), "占位锁：aria-disabled 同步");
  assert.ok(seat.includes("data-locked={locked || undefined}"), "占位锁：data-locked 呈现钩子");
  assert.ok(seat.includes("data-active={open || undefined}"), "active 数据态绑定真实开合态");
  assert.ok(
    seat.includes("aria-expanded={windowMode || locked ? undefined : open}"),
    "aria-expanded 语义与侧栏座位一致（window / locked 不谎报开合）"
  );
  assert.ok(seat.includes("const hint = locked ? lockedText : (windowMode ? windowText : embeddedText);"), "提示文案三态合成");

  /* aria / title / 文案键：全部复用 cosmos.seat.*（零新 locale 键）。 */
  assert.ok(seat.includes("aria-label={hint}"), "icon-only 按钮的 aria-label 携带语义");
  assert.ok(seat.includes("title={hint}"), "原生 title 提示（不引宿主 primitives）");
  for (const key of ["cosmos.seat.locked", "cosmos.seat.windowAria", "cosmos.seat.aria", "cosmos.seat.popupBlocked"]) {
    assert.ok(seat.includes(`tr("${key}"`), "复用侧栏座位文案键：" + key);
  }
  assert.ok(!/cosmos\.(header|topbar|titlebar)\./.test(seat), "组件面零新增 locale 键");
  const dict = client.slice(client.indexOf("const DICT = {"));
  assert.equal(
    (dict.match(/"cosmos\.seat(\.[A-Za-z]+)?":/g) ?? []).length,
    10,
    "cosmos.seat.* 家族零新增键（5 键 × zh/en）"
  );

  /* 独立窗口形态：该页不呈现任何入口控件（spec「独立窗口形态不呈现」）。 */
  assert.ok(seat.includes("if (STANDALONE) return null;"), "?cosmos=window 页显式短路（不补位入口）");

  /* 呈现形态：icon-only + 稳定程序化钩子。 */
  assert.ok(seat.includes('type="button"'), "button 元素（键盘可达）");
  assert.ok(seat.includes('className="cos-header-seat"'), "样式类名 cos-header-seat");
  assert.ok(seat.includes('data-plugin-anchor="dsh-v-cosmos:header-seat"'), "程序化观测钩子锚点");
  assert.ok(seat.includes("COSMOS_ICON_SVG"), "复用既有星系图标（不引新资源）");
}

/* ── 3. 双入口零漂移（spec「状态跨入口同步」） ── */
{
  /* 模块级单件：两入口读同一 store（MUST NOT 另立第二套状态源）。 */
  for (const decl of [
    "const cosmosPresenceStore = createSnapshotStore",
    "const cosmosLaunchStore = createSnapshotStore",
    "const cosmosOpenStore = {"
  ]) {
    assert.equal(client.split(decl).length - 1, 1, "状态源单件唯一定义：" + decl);
  }
  assert.equal(
    (client.match(/const open = useCosmosOpen\(\);/g) ?? []).length,
    3,
    "整页 + 两入口共用同一整页 store（3 处消费，无第二套状态源）"
  );
  assert.equal(
    (client.match(/seatLockOf\(presenceState\?\.count\)/g) ?? []).length,
    2,
    "两入口共用同一占位锁判据"
  );
  assert.equal(
    (client.match(/effectiveLaunchModeOf\(\{ launchMode: launchState\?\.launchMode, protocol: pageProtocol\(\) \}\)/g) ?? []).length,
    2,
    "两入口共用同一 launchMode 现读分流"
  );
  assert.equal(
    (client.match(/tr\("cosmos\.seat\.popupBlocked"/g) ?? []).length,
    2,
    "两入口共用弹窗拦截引导文案"
  );

  /* 侧栏座位纯增量：注入与样式保持不变（不移除、不搬家）。 */
  assert.ok(client.includes('ctx.slots.inject("sidebar.footer.action"'), "侧栏底部座位注入保持");
  assert.ok(client.includes('id: "v-cosmos-seat"'), "侧栏座位条目 id 不变");
  assert.ok(client.includes(".cos-seat-row{"), "侧栏座位样式段保持");
  assert.ok(client.includes(".cos-seat-rail{"), "侧栏 rail 形态样式保持");
}

/* ── 4. CSS 呈现规范（2.3 / spec「入口座位」呈现规范） ── */
{
  const cssStart = client.indexOf("const CSS = `");
  assert.ok(cssStart >= 0, "CSS 模板字面量起点在册");
  const cssClose = client.indexOf("`;\n\nfunction installStyles", cssStart);
  assert.ok(cssClose > cssStart, "CSS 模板字面量闭合（整站样式不被截断）");
  const css = client.slice(cssStart, cssClose);
  const headerCssStart = css.indexOf(".cos-header-seat{");
  assert.ok(headerCssStart >= 0, "头部入口样式段在册");
  const engineAt = css.indexOf("${ENGINE_CSS}", headerCssStart);
  assert.ok(engineAt > headerCssStart, "样式段位于既有座位段之后、引擎样式之前");
  const headerCss = css.slice(headerCssStart, engineAt);
  for (const token of [
    "width:28px",
    "height:28px",
    "display:inline-flex",
    "padding:0",
    "border-radius:var(--dsw-radius-sm,8px)",
    "color:var(--dsw-alias-label-secondary,var(--cos-accent-ink,#ffe3b8))",
    "var(--dsw-alias-interactive-bg-hover,rgba(255,210,140,.12))",
    "outline:var(--dsw-focus-ring-width,2px) solid",
    "flex:none",
    "-webkit-app-region:no-drag"
  ]) {
    assert.ok(headerCss.includes(token), "头部入口样式令牌：" + token);
  }
  assert.ok(headerCss.includes(".cos-header-seat:focus-visible"), "键盘焦点环样式（宿主 --dsw-focus-ring-* 同构）");
  assert.ok(headerCss.includes("var(--cos-accent-ink,#ffe3b8)"), "风格 D 基线回落（令牌缺席不裸奔）");
  assert.ok(headerCss.includes('.cos-header-seat[data-active="true"]'), "active 态样式（真实开合换色）");
  assert.ok(headerCss.includes(".cos-header-seat:disabled"), "禁用态样式（占位锁呈现）");
  assert.ok(headerCss.includes(".cos-header-seat svg{width:16px"), "图标 16px（与侧栏/宿主 icon 同尺寸）");
  assert.ok(!headerCss.includes("position:absolute"), "不脱离头部 leading flex 流（不参与挤压）");
}

console.log("header-seat-smoke: all assertions passed");
