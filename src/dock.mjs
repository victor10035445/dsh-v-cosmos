/**
 * Cosmos 右栏停靠纯逻辑（add-cosmos-rightbar-dock design D1–D5）。
 *
 * 独立模块——client.jsx 消费（入口分流 / 关页裁决 / dock 呈现态）、
 * test/rightbar-dock-smoke.mjs 冒烟直测。零依赖、零 DOM：
 *  - `dockEntryPlanOf`：入口点击计划（embedded 翻转整页 / dock 打开 tab / 无会话或
 *    宿主席位缺席回落内嵌整页 + toast）；
 *  - `findDockTabOf` / `dockActiveOf`：dock tab 在屏会话内的开合态（入口高亮与
 *    「已开揭示聚焦」判据）；
 *  - `pageCloseActionOf`：动作跳转尾巴与「打开会话」导航的关页裁决（embedded 关页 /
 *    dock no-op 保持 tab）；
 *  - `dockFallbackNoticeKeyOf`：回落 toast 文案键（措辞如实，不承诺未发生的事）。
 */

/** 本插件的 dock tab 类型标识（`sidebarRightTabs.register` 的 id；也是正文槽 key）。 */
export const COSMOS_DOCK_TAB_ID = "dsh-v-cosmos";
/** tab 类型判别值（`openTab(kind)` 的 kind；宿主按 kind 找正文与标题）。 */
export const COSMOS_DOCK_TAB_KIND = "cosmos";

/**
 * 入口点击计划（两入口共用；纯函数）。
 * @param {{launchMode?: unknown, available?: unknown, sessionId?: unknown, tabOpen?: unknown}} [input]
 *        `launchMode` = 设置面当前值；`available` = 宿主席位注入成功；
 *        `sessionId` = `ctx.sidebarRight.mounted` 快照（无会话在屏为 undefined）；
 *        `tabOpen` = 该会话的 dock 列中已存在 Cosmos tab
 * @returns {{action: "toggle-page"|"fallback-page"|"reveal-tab"|"open-tab", reason: string}}
 *          - `toggle-page`：embedded 现状（翻转内嵌整页开合，零变化）；
 *          - `fallback-page`：dock 请求无法落地（宿主席位缺席 / 无会话在屏）→ 打开
 *            内嵌整页并 toast 注明；
 *          - `reveal-tab`：已有 Cosmos tab → 揭示聚焦（不新开重复 tab）；
 *          - `open-tab`：dock 新开 tab（`ctx.sidebarRight.openTab`）。
 */
export function dockEntryPlanOf(input) {
  const source = input !== null && typeof input === "object" ? input : {};
  if (source.launchMode !== "dock") return { action: "toggle-page", reason: "embedded" };
  if (source.available !== true) return { action: "fallback-page", reason: "host-unavailable" };
  if (typeof source.sessionId !== "string" || source.sessionId === "") {
    return { action: "fallback-page", reason: "no-session" };
  }
  if (source.tabOpen === true) return { action: "reveal-tab", reason: "already-open" };
  return { action: "open-tab", reason: "dock" };
}

/**
 * 在屏会话的 dock 列中查找 Cosmos tab（宿主 `openTabs` 快照的只读投影）。
 * @param {readonly {sessionId?: unknown, tabId?: unknown, kind?: unknown}[]|unknown} tabs
 * @param {unknown} sessionId 在屏会话 id
 * @param {string} [kind] tab 类型（缺省本插件的 `cosmos`）
 * @returns {{sessionId: string, tabId: string, kind: string}|null} 命中的 tab（含稳定 tabId）
 */
export function findDockTabOf(tabs, sessionId, kind = COSMOS_DOCK_TAB_KIND) {
  if (!Array.isArray(tabs)) return null;
  if (typeof sessionId !== "string" || sessionId === "") return null;
  for (const tab of tabs) {
    if (tab === null || typeof tab !== "object") continue;
    if (tab.sessionId !== sessionId || tab.kind !== kind) continue;
    if (typeof tab.tabId !== "string" || tab.tabId === "") continue;
    return { sessionId, tabId: tab.tabId, kind };
  }
  return null;
}

/**
 * dock 入口呈现态（`active` = 在屏会话已有 Cosmos tab；供两入口高亮/aria 同源消费）。
 * @param {{tabs?: unknown, sessionId?: unknown}} [input]
 * @returns {{available: boolean, active: boolean, sessionId: string|undefined, tabId: string|null}}
 */
export function dockPresenceOf(input) {
  const source = input !== null && typeof input === "object" ? input : {};
  const sessionId = typeof source.sessionId === "string" && source.sessionId ? source.sessionId : undefined;
  const tab = sessionId === undefined ? null : findDockTabOf(source.tabs, sessionId);
  return {
    available: source.available === true,
    active: tab !== null,
    sessionId,
    tabId: tab === null ? null : tab.tabId
  };
}

/**
 * 关页裁决（动作跳转尾巴 / 「打开会话」导航共用；纯函数）：
 *  - `embedded`：关闭内嵌整页（现状）；
 *  - `dock`：no-op（Cosmos tab 与右栏展开态保持原位，左列原地导航）。
 * @param {unknown} launchMode 设置面当前值（`embedded` | `dock`）
 * @returns {"close-page"|"keep-page"}
 */
export function pageCloseActionOf(launchMode) {
  return launchMode === "dock" ? "keep-page" : "close-page";
}

/**
 * dock 回落 toast 文案键（按 reason 分口径；文案在 DICT 内，本函数只定键）。
 * @param {unknown} reason `dockEntryPlanOf` 的 fallback reason
 * @returns {string} locale 键
 */
export function dockFallbackNoticeKeyOf(reason) {
  return reason === "host-unavailable" ? "cosmos.dock.hostUnavailable" : "cosmos.dock.noSession";
}
