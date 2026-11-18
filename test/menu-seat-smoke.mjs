/**
 * 标题栏菜单「星群」入口冒烟（move-cosmos-entry-to-dsh-menu）：
 *  1. 注入注册面：`shell.overlay` order 10 条目（id `v-cosmos-menu-seat`）+ locale + 组件；
 *  2. 组件同源面：订阅 open / presence / launch 三 store、现读 launchMode、locked 短路、
 *     embedded 翻转、window 链路（弹窗拦截 toast 同源）、占位禁用、active / aria-expanded
 *     绑定、独立窗口形态短路；
 *  3. 测量与跟随：`data-windows-titlebar` + 测量成功双门闩、宿主 `[data-windows-menu]`
 *     open shadowRoot 末按钮 rect、gap 2 / 40px 回退常量、RO + 三类 MO + resize 触发器、
 *     坐标系实测自校正；
 *  4. 排布契约：锚点 `dsh-v-cosmos:menu-seat` 在册；源码零 `token-insight` 引用（不读
 *     「用量」节点）、组件面零 `createElement`（零宿主节点注入）；
 *  5. 头部入口残留零：`CosmosHeaderSeat` / `cos-header-seat` / `v-cosmos-header-seat` /
 *     `conversation.header.leading` 全源零命中；
 *  6. locale：`cosmos.menu.seat` / `cosmos.menu.seat.aria` zh-en 成对，其余复用
 *     `cosmos.seat.*`（家族键数不变）；
 *  7. CSS：宿主菜单按钮 chrome 镜像（fixed / 28px / padding 0 10px / 6px 圆角 / 令牌 /
 *     hover 与 aria-expanded 高亮 / 焦点环 / 禁用态）、纯文字（无 svg 规则）；
 *  8. 双入口零漂移：同一 store 单件、同一分流纯函数、同一文案键（各恰好 2 处消费）；
 *  9. 侧栏座位纯增量：既有注入与样式零改动。
 *
 * React 组件树在 Node 侧不可挂载（react 为 bundle external），故组件呈现走源码锚点 +
 * 既有纯逻辑直测；真机交互验收见 walkthrough.md 清单。
 * 运行：node test/menu-seat-smoke.mjs（无需先 build）
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL("../src/" + path, import.meta.url), "utf8");
const client = read("client.jsx");

/* ── 1. 注入注册面（design D1） ── */
{
  const injectAt = client.indexOf('ctx.slots.inject("shell.overlay"');
  assert.ok(injectAt >= 0, "菜单座位注入点在册");
  const injectEnd = client.indexOf("/* 3. Cosmos 整页", injectAt);
  assert.ok(injectEnd > injectAt, "注入段可界定（紧随整页注入之前）");
  const registration = client.slice(injectAt, injectEnd);
  assert.ok(registration.includes('name: "shell.overlay"'), "槽位名 = 宿主 shell.overlay");
  assert.ok(registration.includes('id: "v-cosmos-menu-seat"'), "条目 id = v-cosmos-menu-seat");
  assert.ok(registration.includes("order: 10"), "order 10（低于整页 45，与「用量」同级同机制）");
  assert.ok(registration.includes("locale: NS"), "locale 命名空间 = 插件 NS（文案键同源）");
  assert.ok(registration.includes("CosmosMenuSeat"), "条目组件 = CosmosMenuSeat");
}

/* ── 2. 组件同源面（design D3 / spec「与侧栏入口同源行为」） ── */
const seatStart = client.indexOf("function CosmosMenuSeat(");
const seatEnd = client.indexOf("/* ------------------------------------------------------------------ *\n * 样式注入", seatStart);
assert.ok(seatStart >= 0 && seatEnd > seatStart, "CosmosMenuSeat 组件切片可达");
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
  assert.ok(seat.includes("const hint = locked ? lockedText : (windowMode ? windowText : menuAriaText);"), "提示文案三态合成");

  /* 文案键：语义文案复用 cosmos.seat.*；菜单文字 / aria 用新 cosmos.menu.seat 键。 */
  assert.ok(seat.includes("aria-label={hint}"), "按钮 aria-label 携带语义");
  assert.ok(seat.includes("title={hint}"), "原生 title 提示（不引宿主 primitives）");
  for (const key of ["cosmos.seat.locked", "cosmos.seat.windowAria", "cosmos.seat.popupBlocked"]) {
    assert.ok(seat.includes(`tr("${key}"`), "复用侧栏座位文案键：" + key);
  }
  assert.ok(seat.includes('tr("cosmos.menu.seat", "星群")'), "菜单文字键 cosmos.menu.seat（缺省回退 zh「星群」）");
  assert.ok(seat.includes('tr("cosmos.menu.seat.aria", "打开 Cosmos 星群视图")'), "菜单 aria 键 cosmos.menu.seat.aria");

  /* 独立窗口形态：该页不呈现任何入口控件（spec「独立窗口形态不呈现」）。 */
  assert.ok(seat.includes("if (STANDALONE) return null;"), "?cosmos=window 页显式短路（不补位入口）");
}

/* ── 3. 测量与跟随（design D1 / spec「标题栏菜单 Cosmos 入口（星群）」） ── */
{
  const helperStart = client.indexOf('const COS_MENU_BUTTON_GAP = 2;');
  const helperEnd = client.indexOf("function CosmosMenuSeat(");
  assert.ok(helperStart >= 0 && helperEnd > helperStart, "测量常量与纯函数切片可达");
  const helpers = client.slice(helperStart, helperEnd);
  /* 常量 = 宿主 shadow 样式表事实（gap 2px / 按钮 28px / 标题栏 40px 回退）。 */
  assert.ok(helpers.includes("COS_MENU_BUTTON_GAP = 2"), "按钮间距常量 2px（宿主 [role=menubar] gap）");
  assert.ok(helpers.includes("COS_MENU_BUTTON_HEIGHT = 28"), "宿主按钮高度常量 28px（垂直居中用）");
  assert.ok(helpers.includes("COS_MENU_FALLBACK_TITLEBAR_HEIGHT = 40"), "标题栏高度回退常量 40px");
  /* 测量门闩与几何口径（降级红线）。 */
  assert.ok(
    helpers.includes('!document.documentElement?.hasAttribute("data-windows-titlebar")'),
    "呈现门闩一：data-windows-titlebar 在场（Windows 桌面端）"
  );
  assert.ok(helpers.includes('document.querySelector("[data-windows-menu]")'), "挂载点 = 宿主 [data-windows-menu] 标记元素");
  assert.ok(helpers.includes("mount.shadowRoot"), "几何读取 = open shadowRoot");
  assert.ok(helpers.includes('shadow.querySelectorAll("button")'), "按钮集合 = shadowRoot 内按钮");
  assert.ok(helpers.includes("buttons[buttons.length - 1]"), "锚点按钮 = 末位（「编辑」）");
  assert.ok(helpers.includes("buttonRect.right + COS_MENU_BUTTON_GAP"), "left = 末按钮右缘 + 间距（无宽度估算）");
  assert.ok(helpers.includes("menuTitlebarHeight()"), "标题栏高度变量/常量回退口径");
  assert.ok(helpers.includes("getBoundingClientRect"), "一律重读实时 rect（语言切换零残差）");

  /* 跟随触发器与自校正（组件 effect 内）。 */
  for (const token of [
    'document.querySelector("[data-windows-menu]")',
    "new ResizeObserver(schedule)",
    "ro.observe(mount)",
    "new MutationObserver",
    'childList: true, subtree: true',
    'attributeFilter: ["data-windows-titlebar", "style"]',
    'attributeFilter: ["data-sidebar-collapsed"]',
    'window.addEventListener("resize", schedule)'
  ]) {
    assert.ok(seat.includes(token), "跟随触发器在册：" + token);
  }
  assert.ok(seat.includes("const key = measurement === null ? \"null\" :"), "测量提交以坐标键去重（null 亦提交一次）");
  assert.ok(seat.includes("correctionRef.current += 1;"), "坐标系实测自校正（同代最多一次）");
  assert.ok(seat.includes("setGeometry({ left: geometry.left - dx, top: geometry.top - dy });"), "反向修正公式");
  /* 观察器随组件卸载断开。 */
  for (const call of ["ro?.disconnect()", "bodyMo?.disconnect()", "rootMo?.disconnect()", "collapseMo?.disconnect()", 'window.removeEventListener("resize", schedule)']) {
    assert.ok(seat.includes(call), "卸载清理在册：" + call);
  }
}

/* ── 4. 排布契约（design D2 / spec「整页打开态的入口呈现与排布契约」） ── */
{
  assert.ok(seat.includes('data-plugin-anchor="dsh-v-cosmos:menu-seat"'), "锚点声明（供「用量」链式让位）");
  /* 不读、不依赖「用量」节点：锚点选择器面零 token-insight（注释性提及不受限）。 */
  assert.ok(!client.includes("token-insight:"), "源码零 token-insight 锚点引用（不读「用量」节点）");
  assert.ok(!client.includes('data-plugin-anchor="token-insight'), "零「用量」锚点选择器");
  assert.ok(!seat.includes("createElement"), "组件面零 createElement（零宿主节点注入，纯自绘 fixed 按钮）");
  assert.ok(!seat.includes("shadowRoot.append"), "零 shadowRoot 注入（不改宿主菜单栏节点）");
}

/* ── 5. 头部入口残留零（proposal「移除」） ── */
for (const residue of ["CosmosHeaderSeat", "cos-header-seat", "v-cosmos-header-seat", 'conversation.header.leading']) {
  assert.ok(!client.includes(residue), "头部入口残留零：" + residue);
}

/* ── 6. locale（DICT zh-en 成对；既有 cosmos.seat.* 家族键数不变） ── */
{
  const dict = client.slice(client.indexOf("const DICT = {"));
  assert.equal(
    (dict.match(/"cosmos\.seat(\.[A-Za-z]+)?":/g) ?? []).length,
    10,
    "cosmos.seat.* 家族零新增键（5 键 × zh/en）"
  );
  assert.equal((dict.match(/"cosmos\.menu\.seat":/g) ?? []).length, 2, "cosmos.menu.seat zh-en 成对");
  assert.equal((dict.match(/"cosmos\.menu\.seat\.aria":/g) ?? []).length, 2, "cosmos.menu.seat.aria zh-en 成对");
  assert.ok(dict.includes('"cosmos.menu.seat": "星群"'), "zh 菜单文字 = 星群（需求命名）");
  assert.ok(dict.includes('"cosmos.menu.seat": "Cosmos"'), "en 菜单文字 = Cosmos");
}

/* ── 7. CSS 呈现规范（design D4 / spec chrome 镜像） ── */
{
  const cssStart = client.indexOf("const CSS = `");
  assert.ok(cssStart >= 0, "CSS 模板字面量起点在册");
  const cssClose = client.indexOf("`;\n\nfunction installStyles", cssStart);
  assert.ok(cssClose > cssStart, "CSS 模板字面量闭合（整站样式不被截断）");
  const css = client.slice(cssStart, cssClose);
  const menuCssStart = css.indexOf(".cos-menu-seat{");
  assert.ok(menuCssStart >= 0, "菜单入口样式段在册");
  const engineAt = css.indexOf("${ENGINE_CSS}", menuCssStart);
  assert.ok(engineAt > menuCssStart, "样式段位于既有座位段之后、引擎样式之前");
  const menuCss = css.slice(menuCssStart, engineAt);
  for (const token of [
    "position:fixed",
    "height:28px",
    "padding:0 10px",
    "border-radius:6px",
    "color:var(--dsw-alias-label-secondary,var(--cos-accent-ink,#ffe3b8))",
    "var(--dsw-alias-interactive-bg-hover,rgba(255,210,140,.12))",
    "outline:var(--dsw-focus-ring-width,2px) solid",
    "-webkit-app-region:no-drag"
  ]) {
    assert.ok(menuCss.includes(token), "菜单入口样式令牌：" + token);
  }
  assert.ok(menuCss.includes("font:inherit"), "font:inherit 继承标题栏字体栈（宿主按钮同款）");
  assert.ok(menuCss.includes(".cos-menu-seat:focus-visible"), "键盘焦点环样式（宿主 --dsw-focus-ring-* 同构）");
  assert.ok(menuCss.includes(".cos-menu-seat[aria-expanded=\"true\"]"), "整页打开态高亮（宿主 aria-expanded chrome 同构）");
  assert.ok(menuCss.includes(".cos-menu-seat:disabled"), "禁用态样式（占位锁呈现）");
  assert.ok(!menuCss.includes(".cos-menu-seat svg"), "纯文字形态（无图标规则）");
}

/* ── 8. 双入口零漂移（spec「状态跨入口同步」） ── */
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

console.log("menu-seat-smoke: all assertions passed");
