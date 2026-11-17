/**
 * Cosmos 独立窗口纯逻辑（add-cosmos-standalone-window design D1/D5/D7；
 * 桌面判据经 fix-cosmos-standalone-desktop-degrade D1 加宽为非 http(s) 协议）。
 *
 * 形态 = 同源「根 URL + 查询参数」：`window.open(location.origin + "/?cosmos=window")`。
 * 否决独立端口（webServer 单监听 / 异 origin 无 Cookie / localStorage 分裂 / SSE 跨源）与
 * 路径式 URL（frontend-static fallback 只在根渲染 SPA、`<base href="./">` 冻结资源目录）。
 *
 * 本模块只收敛**浏览器侧可判定的纯函数面**（零依赖、可冒烟直测）：
 *  - 独立窗口检测（`?cosmos=window` 精确匹配 + 非 http(s) 桌面形态排除）；
 *  - 独立窗口 URL 构造；
 *  - 启动分流（launchMode × 桌面降级）；
 *  - 座位锁定 / 双窗提示 / 关页动作裁决；
 *  - 无壳样式常量（`[data-slot]` 选择器集中定义，D3）。
 * DOM 标记、`window.open` / `window.close` 调用与 React 呈现留在 client.jsx（编排层）。
 */

/** 独立窗口查询参数名与值（精确匹配：同名不同值 MUST NOT 进入独立窗口态）。 */
export const COSMOS_WINDOW_PARAM = "cosmos";
export const COSMOS_WINDOW_VALUE = "window";

/**
 * 查询串单键取值（手写解析：不依赖 `URLSearchParams` 的存在性，`+` 按空格解码；
 * 解码失败/无该键 → null）。
 * @param {unknown} search `location.search` 形态（可带/不带前导 `?`）
 * @param {string} name 键名
 * @returns {string|null}
 */
function paramOf(search, name) {
  const text = typeof search === "string" ? search : "";
  const body = text.charAt(0) === "?" ? text.slice(1) : text;
  if (!body) return null;
  for (const pair of body.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const rawKey = eq < 0 ? pair : pair.slice(0, eq);
    const rawValue = eq < 0 ? "" : pair.slice(eq + 1);
    let key;
    let value;
    try {
      key = decodeURIComponent(rawKey.replace(/\+/g, " "));
      value = decodeURIComponent(rawValue.replace(/\+/g, " "));
    } catch {
      continue; // 坏段忽略（不影响其余键）
    }
    if (key === name) return value;
  }
  return null;
}

/**
 * 独立窗口查询检测（design D5「精确查询串匹配」）：`cosmos=window` 才算；
 * `cosmos=1` / `cosmo=window` / 大小写变体一律否。
 * @param {unknown} search `location.search`
 * @returns {boolean}
 */
export function isStandaloneSearch(search) {
  return paramOf(search, COSMOS_WINDOW_PARAM) === COSMOS_WINDOW_VALUE;
}

/**
 * 桌面形态判据（fix-cosmos-standalone-desktop-degrade D1；前身见 add-cosmos-standalone-window D7）：
 * 独立窗口的语义根基是**同源 HTTP origin**（SSE 同播、localStorage 设置桥、Cookie 同池），
 * 页面协议非 `http:` 亦非 `https:`（`dsh-app://` 桌面壳、`file://` 及未来自定义协议壳）即判桌面。
 * 判定取浏览器侧可观察事实，MUST NOT 依赖宿主探测。
 *
 * 缺省守卫：非字符串 / 空串回落 false（`pageProtocol()` 缺席返回空串，按非桌面处理——
 * Node/旧宿主降级面；宽口径 MUST NOT 翻转该既有语义）。
 * @param {unknown} protocol `location.protocol`
 * @returns {boolean}
 */
export function isDesktopProtocol(protocol) {
  if (typeof protocol !== "string" || protocol === "") return false;
  const normalized = protocol.toLowerCase();
  return normalized !== "http:" && normalized !== "https:";
}

/**
 * 独立窗口态判定 = 查询参数命中 **且** 非桌面形态。
 * 桌面壳（D1：非 http(s) 协议——`dsh-app://` 或 `file://`）页面没有可作为独立窗口地基的
 * 同源 HTTP origin，故查询参数在桌面形态 MUST NOT 生效（降级为普通内嵌形态，无副作用）。
 * @param {{search?: unknown, protocol?: unknown}} [input]
 * @returns {boolean}
 */
export function isStandalonePage(input) {
  const source = input !== null && typeof input === "object" ? input : {};
  return isStandaloneSearch(source.search) && !isDesktopProtocol(source.protocol);
}

/**
 * 独立窗口 URL（design D1）：同源根 URL + 查询参数；origin 缺席（无法判定时）回落
 * 相对根路径——`window.open` 对相对路径同样按当前 origin 解析。
 * @param {unknown} origin `location.origin`
 * @returns {string}
 */
export function standaloneUrlOf(origin) {
  const query = "?" + COSMOS_WINDOW_PARAM + "=" + COSMOS_WINDOW_VALUE;
  const base = typeof origin === "string" ? origin.trim().replace(/\/+$/, "") : "";
  return base ? base + "/" + query : "/" + query;
}

/**
 * 启动方式分流（design D1/D2；前身见 add-cosmos-standalone-window D4/D7）：桌面形态
 * （非 http(s) 协议）恒 `embedded`——忽略历史 `window` 配置、MUST NOT 尝试打开独立窗口、
 * MUST NOT 报错；其余（web 形态）按配置，非法值回落 `embedded`。
 * @param {{launchMode?: unknown, protocol?: unknown}} [input]
 * @returns {"embedded"|"window"}
 */
export function effectiveLaunchModeOf(input) {
  const source = input !== null && typeof input === "object" ? input : {};
  if (isDesktopProtocol(source.protocol)) return "embedded";
  return source.launchMode === "window" ? "window" : "embedded";
}

/**
 * 座位锁定判据（presence requirement）：占位计数 ≥1 ⇒ 主壳入口禁用（入口互斥）。
 * @param {unknown} count 宿主广播的占位计数
 * @returns {boolean}
 */
export function seatLockOf(count) {
  const n = Number(count);
  return Number.isFinite(n) && n >= 1;
}

/**
 * 双窗提示判据（D2/D5）：独立窗口收到 `count ≥ 2` ⇒ 页内提示「已有另一 Cosmos 窗口」；
 * 不阻断浏览、不强制关闭他窗（Web 无可靠关闭他人窗口的机制）。
 * @param {{standalone?: unknown, count?: unknown}} [input]
 * @returns {boolean}
 */
export function otherWindowHintOf(input) {
  const source = input !== null && typeof input === "object" ? input : {};
  if (source.standalone !== true) return false;
  const n = Number(source.count);
  return Number.isFinite(n) && n >= 2;
}

/**
 * 关页动作裁决（design D5）：内嵌态 = 关整页；独立窗口态 = 关窗（脚本打开合法），
 * 被浏览器拒绝（直输 URL 无 opener）⇒ 保持整页 + 手动关窗提示——页面级 SSE 随页面存活，
 * 静默关整页会留下持续持有占位的无壳空窗（主壳锁定却无可见 Cosmos）。
 * @param {{standalone?: unknown, closed?: unknown}} [input] `closed` = `window.close()`
 *        之后观测到的 `window.closed`
 * @returns {{action: "close-page"|"closed"|"keep-page", hint: boolean}}
 */
export function closeDecisionOf(input) {
  const source = input !== null && typeof input === "object" ? input : {};
  if (source.standalone !== true) return { action: "close-page", hint: false };
  if (source.closed === true) return { action: "closed", hint: false };
  return { action: "keep-page", hint: true };
}

/**
 * 无壳样式（design D3；选择器集中定义，官方壳 DOM 演进只改这一处）：
 *  - 侧栏锚点（渲染层 `display:contents` 锚点）隐藏即隐藏整棵子树；其**父列**（grid 轨道
 *    容器）经 `:has()` 直取隐藏 → `usePageLeft` 量不到列 → 整页左缘降级 0（铺满视口）。
 *    `:has()` 不支持时（旧内核）列仍在，客户端另有「standalone ⇒ left:0」显式兜底，
 *    失效模式只是观感（页面仍全幅覆盖）。
 *  - 底部条 / leading 座位：官方 AppFrame 的稳定数据属性（`data-shell-*`）。
 *  - 根级滚动抑制：独立窗口是单页应用面，MUST NOT 出现壳滚动条。
 * 由 client.jsx 拼进插件样式表（`html[data-cosmos-standalone]` 作用域，内嵌态零生效）。
 */
export const STANDALONE_CSS = `
/* ── 独立窗口无壳呈现（add-cosmos-standalone-window design D3） ── */
html[data-cosmos-standalone] [data-slot="sidebar"],
html[data-cosmos-standalone] div:has(> [data-slot="sidebar"]),
html[data-cosmos-standalone] [data-shell-bottom],
html[data-cosmos-standalone] [data-shell-leading]{display:none!important}
html[data-cosmos-standalone]{overflow:hidden}
html[data-cosmos-standalone] body{overscroll-behavior:none}
`;
