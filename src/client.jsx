/**
 * dsh-v-cosmos — 浏览器半区（由 build.mjs 打包成懒 CJS 工厂 lib/client.js）。
 *
 * 入口与页面（对齐 dsh-v-hive 轨道；add-cosmos-entry 4.1/5.x）：
 *  - sidebar.footer.action 座位：侧栏底部「Cosmos」按钮（座位序 15——Hive(10) 与
 *    Token统计(20) 之间，对齐两插件入口形态）；
 *  - shell.overlay 条目（order 10，move-cosmos-entry-to-dsh-menu）：Windows 桌面端标题栏
 *    菜单条「星群」文字入口——测量宿主 [data-windows-menu] open shadowRoot「编辑」按钮
 *    几何定位其右缘 + 2px（token-insight「用量」同款机制；锚点 `dsh-v-cosmos:menu-seat`
 *    供「用量」链式让位，顺序 = 应用 → 编辑 → 星群 → 用量）；与侧栏座位同源（同一 store、
 *    同一分流纯函数、同一文案键）；非桌面端 / 测量失败渲染 null（侧栏座位兜底）；
 *  - shell.overlay 条目（order 45）：应用内整页帧——left 跟踪侧栏右缘
 *    （usePageLeft 测量 [data-slot="sidebar"] 父列，降级 left:0）、Esc 分层、全屏；
 *  - 页面开合走模块级 cosmosOpenStore（微观察者，hive hiveOpenStore 同款）；
 *  - providers（4.2）：宿主 SSE 轻帧 → 重拉骨架 + 官方会话镜像
 *    （ctx.sessions.list / ctx.workspaces.list）+ 统一会话状态快照
 *    （ctx.uiSession.sessionStatus，add-celestial-states 5.1）→ mergeScene 合并 →
 *    引擎属性级补丁（4.8）；行星四态推导（待决策 > 执行中 > 完成未读 > 待机中，
 *    statuses 不可达降级 idle/busy）在客户端；
 *  - 渲染节能（4.6）：整页关闭 / 页签不可见 → rAF 暂停，恢复继续；
 *  - 搜索过滤（add-cosmos-search-filter 3.x）：整页顶部中央搜索框 → 工作区名称
 *    匹配（大小写不敏感子串 + 空格切分 AND，merge.matchWorkspaces）→ 引擎过滤
 *    呈现态（engine.setFilter：命中保留/未命中 α 淡隐、子集重排、camera-fit）；
 *    查询为会话态（关页重置，MUST NOT 持久化）；
 *  - Esc 分层（5.3，外壳单点 keydown；add-cosmos-session-list-panel 3.4 插入收面板层）：
 *    引擎钻取返回 > 清空搜索 > 收起会话面板（展开态） > 退全屏 > 关整页；
 *  - 会话列表面板（add-cosmos-session-list-panel 2.x/3.x；swap-cosmos-panel-sides 移至左缘；
 *    swap-cosmos-session-toggle-titlebar 把手退役）：左缘可开合清单（标题栏 `<<` / 竖条
 *    `>>` 按钮，折叠态 = 贴左缘竖向窄条）——视图作用域分组、DSH 同行状态语法（四态优先级 +
 *    委托 loader）、点行选中联动（引擎 focusBody）、「打开」官方导航链路、开合态 settings
 *    持久化；数据零新增宿主接口（纯函数投影）。
 *  - 宿主当前会话跟随（add-cosmos-host-session-follow）：dsh 当前会话变化沿（官方侧栏 /
 *    任意外部导航换绑）→ Cosmos 选中该会话天体并定位到所属星座（与面板行点击同一
 *    `focusBody` 机械）；整页打开即定位当前会话；哨兵去重 + 自身切换回声短路；目标不在册 /
 *    引擎缺席全部静默降级（旧宿主回落降级镜像，见 host-session-follow.mjs）。
 *  - 「打开会话」（5.4）：先关整页，再经 ctx.uiWorkspace.openSession 切换右侧
 *    系统会话页（旧宿主回退 ctx.sessions.open）；
 *  - 新增工作区（add-cosmos-add-workspace 4.x）：左下角常驻「新增」按钮 →
 *    ctx.uiWorkspace.pickDirectory + ctx.workspaces.create（官方服务组合，与宿主
 *    「添加工作区」同源）→ 留在银河、引擎 dive-in 新星座（MUST NOT 打开会话/关整页）；
 *    取消静默、幂等重选 toast、失败 toast、busy 防重入；
 *  - dock 形态（add-cosmos-rightbar-dock）：入口按设置面 `launchMode`
 *    （缺省 embedded，零变化）分流——`dock` 时经宿主右栏公开席位打开 Cosmos 停靠 tab
 *    （`ctx.sidebarRightTabs` 类型注册 + `sidebar.right.pane.tab` 正文槽），与左侧会话
 *    主栏并排；同窗口使宿主动词与一次性标记同作用域，动作链路恢复内嵌全额语义
 *    （恒新建 / 关联绑定 / 模型切换 / autoSend），跳转尾巴收敛为 tab 保持（closePage
 *    no-op）。无会话在屏或宿主右栏席位缺席 → 回落内嵌整页 + toast 注明。
 *    web 与 desktop 形态同效（无协议判据）。
 *  - 自动执行队列（add-cosmos-action-queue 5.1–5.4）：模块级 `cosmosQueueStore` 投影服务端
 *    队列快照（GET /queue 页面加载对账 + SSE `queue-changed` 轻帧拉全量；帧类型分流，
 *    队列帧 MUST NOT 触发骨架重拉）；提案面板左邻的队列面板（空队列零布局、星座作用域
 *    = 钻取优先 / 选中兜底、暂停/继续、清空两击确认、排序/移出操作矩阵）与动作条主按钮
 *    内的迷你入队钮（同批同门控、已排队禁用）；入队不是执行——不导航、不落草稿、不消耗
 *    动作条点击冷却门。
 *  - 全部官方动词经注入服务使用，不修改任何官方包。
 */
import { Component, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { fetchScene, subscribeCosmosEvents, bindSession, fetchQueue, queueAction } from "./api.mjs";
/* 入口分流纯逻辑（add-cosmos-rightbar-dock）：设置枚举 / 入口计划 / 关页裁决全部收敛在
   dock.mjs（可冒烟直测）；本文件只做宿主席位与 DOM 编排。 */
import {
  COSMOS_DOCK_TAB_ID,
  COSMOS_DOCK_TAB_KIND,
  dockEntryPlanOf,
  dockFallbackNoticeKeyOf,
  dockPresenceOf,
  findDockTabOf,
  pageCloseActionOf
} from "./dock.mjs";
import { mergeScene, sceneDiffLevel, planetStateOf, relativeTime, matchWorkspaces, filteredPositions, findRegisteredWorkspace, normalizeWorkspacePath, isWindowsPlatform } from "./merge.mjs";
import { createSkinD, SKIN_D_PALETTE } from "./cosmos/skin-d.mjs";
import { COSMOS_DEFAULT_SKIN, COSMOS_SKIN_IDS, COSMOS_SKINS, applySkinTokens, createSkin, skinCardOf } from "./cosmos/skin-registry.mjs";
import { createCosmosEngine, ENGINE_CSS, FX_PRIORITY, isEditableTarget, isUiChromeTarget, resolveBlastCoreOf, zoomMeterTrackOf, zoomRulerMotionOf, ZOOM_RULER_TICK, ZOOM_RULER_DIST_MIN, ZOOM_RULER_DIST_MAX, ZOOM_RULER_EASE_MS } from "./cosmos/engine.mjs";
import { cosmosStore } from "./store.mjs";
import { COSMOS_SETTINGS_BOUNDS, COSMOS_SETTINGS_DEFAULTS, cosmosLayoutTokensOf, loadCosmosSettings, saveCosmosSettings, settingsFromStorageEvent } from "./settings.mjs";
import { actionButtonVisible, buttonsSectionOf } from "./buttons.mjs";
import { constButtonsSectionOf, normalizeConstButtons } from "./const-buttons.mjs";
import { findCard, isSelectionSurface, projectPanel, projectQueuePanel, projectSessionPanel, proposalKeyOf, queueEnqueuedKeyOf, queuePendingKeysOf, queueScopeOf, sessionKeyOf, cardIsLinkedOf, crossHoverTargets, hoverSourceAlive, rowIsLinkedOf } from "./panel.mjs";
import { assembleEmbryoMessage, assembleMessage, consumePendingAction, createActionExecutor, createActionGate, createEmbryoActionExecutor, createPendingActionStore, draftMatches, explorationTargetOf, isBlankDraft, pendingReadinessOf } from "./actions.mjs";
import { activitySummaryOf, archiveNoticeOf, archiveRequestFailureNotice, isSessionArchiveOutcome } from "./session-archive.mjs";
import { FLOAT_ATTACH_WATCH_MS, FLOAT_IMAGE_ACCEPT, FLOAT_IMAGE_TYPES, FLOAT_TEXTAREA_MAX_HEIGHT, FLOAT_TEXTAREA_MIN_HEIGHT, clipboardFilesOf, constellationMessageOf, createAttachFace, createConstellationExecutor, createFloatMarkerStore, floatAttachmentsPendingOf, floatPresentationOf, floatSendPlanOf, floatTextareaHeightOf, floatWatchOutcomeOf, intakeFloatImages, promptFailureTextOf, removeFloatAttachment } from "./constellation-actions.mjs";
/* 宿主当前会话跟随（add-cosmos-host-session-follow）：单点出口 / 变化沿 / 开页定位的
   纯逻辑面收敛在模块内（可冒烟直测），控制器只做接线与 disposers 回收。 */
import { createHostSessionFollow, currentSessionIdOf, wsIdBySessionId } from "./host-session-follow.mjs";
import { catalogOptions, describeButtonModel, highestEffort } from "./model-catalog.mjs";
import {
  CONFIG_API_PATH,
  adaptConfigFormsChannel,
  bindSettingsScopeChannel,
  createActiveScope,
  createApiChannel,
  createButtonsStore,
  createSnapshotStore
} from "./settings-seam.mjs";
import { CONSTELLATION_PROFILE, constButtonDraftOf, constButtonIssue, createButtonSettingsController } from "./button-settings.mjs";
import { createPathsSettingsController } from "./paths-settings.mjs";
import { COSMOS_SETTINGS_CSS, CosmosActionsPanel, CosmosGeneralPanel, CosmosNavPanel, CosmosPathsSection, CosmosShortcutsPanel, CosmosSkinPanel, CosmosSettingsSection, SETTINGS_TAB_SLOT } from "./settings-ui.jsx";
/* 快捷键纯逻辑（add-cosmos-shortcuts）：键位池/规范形/匹配器/净房/跨域查重单一来源——
   外壳分发（关闭链 + 按钮键 + 浮窗语音）与设置面全部经此模块，不散落硬编码。 */
import {
  SHORTCUT_BUTTON_KEYS,
  SHORTCUT_DEFAULTS,
  SHORTCUT_FIELDS,
  SHORTCUT_GLOBAL_KEYS,
  SHORTCUT_UI_ORDER,
  canonicalOfEvent,
  isButtonShortcut,
  shortcutConflictOf,
  shortcutConflictOnFieldOf,
  shortcutConflictOnRowOf,
  shortcutLabelOf,
  shortcutMatches,
  shortcutsIssue,
  shortcutsOf
} from "./shortcuts.mjs";

const PLUGIN_ID = "dsh-v-cosmos";
const NS = "dsh-v-cosmos";
/** 自有批量归档端点（宿主半区 cosmos-archive-sweep 契约）：浏览器半区以单元素数组
 *  消费——信息卡「归档会话」是它的第二个 UI 面（首个是归档技能的扫尾流程）。 */
const ARCHIVE_SESSIONS_PATH = "/api/dsh-v-cosmos/archive-sessions";
/** 星胚移除端点（add-cosmos-embryo-dismiss D5）：画布星胚卡「移除星胚」两击确认后的
 *  唯一出口——dsh-v-cosmos 作为一等清理方的服务端动词（CONTRACT §6.3）。 */
const DISMISS_EMBRYO_PATH = "/api/dsh-v-cosmos/dismiss-embryo";

/** 星胚移除 notice 组装（add-cosmos-embryo-dismiss D9）：`tone` 只供冒烟/调用方区分，
 *  引擎 toast 仅有文本通道；`outcome` 回填宿主原值（未知值原样透传，便于诊断）。 */
function dismissNotice(outcome, tone, text) {
  return { outcome, tone, text };
}

/* ------------------------------------------------------------------ *
 * 页面开合 store（模块级微观察者，hive hiveOpenStore 同款）
 * ------------------------------------------------------------------ */

const cosmosOpenStore = {
  open: false,
  listeners: new Set(),
  getSnapshot() {
    return this.open;
  },
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },
  set(open) {
    if (this.open === open) return;
    this.open = open;
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        /* 订阅者异常不阻断其余通知 */
      }
    }
  }
};

function useCosmosOpen() {
  return useSyncExternalStore(
    (listener) => cosmosOpenStore.subscribe(listener),
    () => cosmosOpenStore.getSnapshot()
  );
}

/* ------------------------------------------------------------------ *
 * 受控镜像 store（add-cosmos-rightbar-dock）
 *
 *  - `cosmosLaunchStore`：`launchMode` 的受控镜像（「通用」页签 face + 入口分流/文案）；
 *    唯一写者 = `applyLaunchMode`（设置页写入）与 `storage` 事件桥（他窗写入）。
 *  - `cosmosDockStore`：右栏 dock 能力的可用性与呈现态（`available` = 宿主席位注入成功；
 *    `active` = 当前在屏会话的 dock 列中已开 Cosmos tab）；写者 = dock 接线内的
 *    `sidebarRight.mounted` / `sidebarRight.openTabs` 订阅 + 入口分流；
 *    入口高亮/aria 与两入口同源同步。
 * ------------------------------------------------------------------ */

const cosmosLaunchStore = createSnapshotStore({ launchMode: loadCosmosSettings().launchMode });
const cosmosDockStore = createSnapshotStore({ available: false, active: false, sessionId: undefined });
/**
 * 星座模板名显示（add-cosmos-template-name-toggle 1.2/D1）：模块级受控镜像——「通用」页签
 * face 的受控读面（与 `cosmosLaunchStore` 同构）。唯一写者 = `saveTemplateNames`（整页存活
 * 时：净房持久化 + 引擎 `setTuning` 热更 + 本 store）与 `templateNamesFace.set` 的整页缺席
 * 回落（仅持久化 + 本 store，下次开页构造读持久值）；`storage` 事件桥同步他窗写入。
 */
const cosmosTemplateNamesStore = createSnapshotStore({ templateNames: loadCosmosSettings().templateNames });

/**
 * 启动方式写入（唯一写者链路）：「配置-Cosmos·通用」face.set → 净房持久化 → 受控镜像。
 * 无引擎热更需求（入口按钮点击时现读配置），故不经控制器，也不受整页存活门控。
 * @param {unknown} mode `embedded` | `dock`（非法值净房回落缺省；历史 window → dock）
 * @returns {{launchMode: "embedded"|"dock"}}
 */
function applyLaunchMode(mode) {
  const merged = saveCosmosSettings({ launchMode: mode });
  cosmosLaunchStore.set({ launchMode: merged.launchMode });
  return cosmosLaunchStore.getSnapshot();
}

/**
 * 当前生效的打开方式（读受控镜像；净房保证 `embedded` / `dock` 二选一）。
 * @returns {"embedded"|"dock"}
 */
function currentLaunchMode() {
  const value = cosmosLaunchStore.getSnapshot()?.launchMode;
  return value === "dock" ? "dock" : "embedded";
}

/* ------------------------------------------------------------------ *
 * 右栏 dock 席位引用与入口分流（add-cosmos-rightbar-dock D1/D2/D8）
 *
 * 宿主席位经 `ctx.inject(["sidebarRight", "sidebarRightTabs"], …)` 条件注入：
 *  - 老宿主缺席 → 回调不执行 → `sidebarDockFace` 恒 null，入口能力探测回落内嵌；
 *  - 注入成功 → 类型注册（`sidebarRightTabs.register`）+ 呈现态订阅（mounted/openTabs）；
 *  - 两入口共用 `launchCosmosEntry`（单一实现，MUST NOT 第二套分流）。
 * ------------------------------------------------------------------ */

let sidebarDockFace = null;

/** 在屏会话 id（`sidebarRight.mounted` ObservableSnapshot；缺席/异常 → undefined）。 */
function dockSessionIdOf() {
  try {
    return sidebarDockFace?.right?.mounted?.getSnapshot?.() ?? undefined;
  } catch {
    return undefined;
  }
}

/** 在册 dock tab 元数据（`sidebarRight.openTabs` ObservableSnapshot；缺席 → 空表）。 */
function dockTabsOf() {
  try {
    const tabs = sidebarDockFace?.right?.openTabs?.getSnapshot?.();
    return Array.isArray(tabs) ? tabs : [];
  } catch {
    return [];
  }
}

/** 把宿主席位事实投影进 `cosmosDockStore`（入口高亮/aria 与「已开揭示」判据同源）。 */
function syncDockStore() {
  const next = dockPresenceOf({
    available: sidebarDockFace !== null && typeof sidebarDockFace?.right?.openTab === "function",
    tabs: dockTabsOf(),
    sessionId: dockSessionIdOf()
  });
  const cur = cosmosDockStore.getSnapshot();
  if (cur.available === next.available && cur.active === next.active && cur.sessionId === next.sessionId) return;
  cosmosDockStore.set(next);
}

/** 回落 toast 文案（措辞如实；`t` = 入口 locale 绑定）。 */
function dockFallbackNoticeOf(t, reason) {
  const fallback = reason === "host-unavailable"
    ? "当前宿主未提供右栏停靠席位，已以内嵌整页打开"
    : "当前无会话在屏，已以内嵌整页打开（分栏需要至少一个打开的会话）";
  try {
    const key = dockFallbackNoticeKeyOf(reason);
    const value = typeof t === "function" ? t(key) : null;
    return typeof value === "string" && value && value !== key ? value : fallback;
  } catch {
    return fallback;
  }
}

/**
 * 入口点击分流（侧栏座位 / 标题栏「星群」共用；`t` = 入口 locale 绑定）。
 * @returns {{action: "toggle-page"|"fallback-page"|"reveal-tab"|"open-tab", reason: string}}
 */
function launchCosmosEntry(t) {
  const mode = currentLaunchMode();
  const sessionId = dockSessionIdOf();
  const tab = sessionId === undefined ? null : findDockTabOf(dockTabsOf(), sessionId);
  const plan = dockEntryPlanOf({
    launchMode: mode,
    available: sidebarDockFace !== null && typeof sidebarDockFace?.right?.openTab === "function",
    sessionId,
    tabOpen: tab !== null
  });
  if (plan.action === "toggle-page") {
    cosmosOpenStore.set(!cosmosOpenStore.getSnapshot());
    return plan;
  }
  if (plan.action === "fallback-page") {
    cosmosOpenStore.set(true);
    showCosmosToast(dockFallbackNoticeOf(t, plan.reason));
    return plan;
  }
  const tr = (key, fallback) => {
    try {
      const value = typeof t === "function" ? t(key) : null;
      return typeof value === "string" && value && value !== key ? value : fallback;
    } catch {
      return fallback;
    }
  };
  try {
    const right = sidebarDockFace.right;
    if (plan.action === "reveal-tab" && tab !== null) {
      /* 已开：先聚焦其所在格（使该格成为活动格），再 openTab 展开列并揭示既有 tab；
         两步都走宿主公开面，且不会在活动格新开重复页 tab。 */
      if (typeof right.focus === "function") right.focus(tab.tabId);
      right.openTab(COSMOS_DOCK_TAB_KIND);
      syncDockStore();
      return plan;
    }
    /* 新开：优先请宿主在活动格右侧分出新格（原生分栏，两格上限/宽度不足时返回
       undefined），再把 Cosmos 落进新格；右栏既有 Files/Bookmarks 保留另一格，
       格间分隔可拖拽调宽。分栏失败仍以标签页打开，并提示先拖宽右栏。 */
    let paneId;
    try {
      paneId = typeof right.split === "function" ? right.split() : undefined;
    } catch {
      paneId = undefined;
    }
    if (typeof paneId === "string" && paneId) {
      right.openTab(COSMOS_DOCK_TAB_KIND, { paneId });
    } else {
      const hadOtherTabs = dockTabsOf().some((item) => item.sessionId === sessionId);
      right.openTab(COSMOS_DOCK_TAB_KIND);
      if (hadOtherTabs) {
        showCosmosToast(tr(
          "cosmos.dock.splitHint",
          "右栏宽度不足或已有两格，Cosmos 暂以标签页打开；拖宽右栏后关闭再打开即可分栏"
        ));
      }
    }
    syncDockStore();
    return plan;
  } catch (error) {
    console.warn("[dsh-v-cosmos] dock entry failed:", error);
    cosmosOpenStore.set(true);
    showCosmosToast(dockFallbackNoticeOf(t, "host-unavailable"));
    return { action: "fallback-page", reason: "host-unavailable" };
  }
}

/** 引导页入口图标（宿主 guide 卡片可选项；无则宿主画方块占位）。 */
function CosmosGuideIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" fill="currentColor" />
      <ellipse cx="12" cy="12" rx="10" ry="4.2" stroke="currentColor" strokeWidth="1.6" transform="rotate(-24 12 12)" />
      <circle cx="20.2" cy="8.2" r="1.4" fill="currentColor" />
    </svg>
  );
}

/* 场景版本号镜像（React 面板跟随合并帧；引擎渲染不受 React 管辖）。 */
const sceneVersionStore = {
  version: 0,
  listeners: new Set(),
  getSnapshot() {
    return this.version;
  },
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },
  bump() {
    this.version += 1;
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        /* ignore */
      }
    }
  }
};

/* 搜索过滤镜像（add-cosmos-search-filter 3.1/3.2）：React 侧只需要「查询 + 命中计数 +
   总数」——呈现态本体在引擎（E.filter）；空态判定用 matched/total。查询为**会话态**：
   MUST NOT 持久化（关页重置，见 CosmosPage 卸载清理）。 */
const filterStore = {
  state: { query: "", matched: 0, total: 0, active: false },
  listeners: new Set(),
  getSnapshot() {
    return this.state;
  },
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },
  set(next) {
    const cur = this.state;
    if (cur.query === next.query && cur.matched === next.matched && cur.total === next.total && cur.active === next.active) return;
    this.state = next;
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        /* 订阅者异常不阻断其余通知 */
      }
    }
  }
};

function useFilterState() {
  return useSyncExternalStore(
    (listener) => filterStore.subscribe(listener),
    () => filterStore.getSnapshot()
  );
}

/* 钻取态镜像（add-cosmos-proposal-actions 3.4/3.6）：引擎在 dive / 回到银河 / 焦点星座
   注销时经 `onDrillChange` 回调推送 `{wsId, name}` 或 null。React 侧据此过滤面板分组、
   隐藏搜索框（polish-cosmos-drilled-hud）与让位顶部中央标牌；引擎仍是钻取态的唯一权威
   （本镜像只读）。 */
const drillStore = {
  state: null,
  listeners: new Set(),
  getSnapshot() {
    return this.state;
  },
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },
  set(next) {
    const value = next && typeof next === "object" && typeof next.wsId === "string" ? { wsId: next.wsId, name: String(next.name ?? "") } : null;
    const current = this.state;
    if (value === null && current === null) return;
    if (value !== null && current !== null && value.wsId === current.wsId && value.name === current.name) return;
    this.state = value;
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        /* 订阅者异常不阻断其余通知 */
      }
    }
  }
};

function useDrill() {
  return useSyncExternalStore(
    (listener) => drillStore.subscribe(listener),
    () => drillStore.getSnapshot()
  );
}

/* 引擎选中镜像（add-cosmos-selection-linkage 3.1/D6）：引擎在选中态**真正变化**时经
   `onSelectChange` 推送 `{kind, wsId, id, lifecycle?}` 或 null（幂等通道，键变才回调）。
   React 侧据此把「视图里选中的恒星」映射回面板选中；引擎仍是选中态的唯一权威（只读镜像）。 */
const engineSelectStore = {
  state: null,
  listeners: new Set(),
  getSnapshot() {
    return this.state;
  },
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },
  set(next) {
    /* 净房：非对象/缺 kind,id → null；字段收敛为字符串，避免上游形状漂移污染 React 侧比较。 */
    const value = next && typeof next === "object" && typeof next.kind === "string" && typeof next.id === "string"
      ? {
        kind: next.kind,
        wsId: typeof next.wsId === "string" ? next.wsId : "",
        id: next.id,
        lifecycle: typeof next.lifecycle === "string" ? next.lifecycle : null
      }
      : null;
    const current = this.state;
    if (value === null && current === null) return;
    if (value !== null && current !== null
      && value.kind === current.kind
      && value.wsId === current.wsId
      && value.id === current.id
      && value.lifecycle === current.lifecycle) return;
    this.state = value;
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        /* 订阅者异常不阻断其余通知 */
      }
    }
  }
};

function useEngineSelection() {
  return useSyncExternalStore(
    (listener) => engineSelectStore.subscribe(listener),
    () => engineSelectStore.getSnapshot()
  );
}

/* 引擎悬停镜像（p2-add-cosmos-cross-hover-markers 1.1）：引擎在**画布指针 hover 键变**时
   经 `onHoverChange` 推送 `{kind, wsId, id}` 或 null（幂等通道，键变才回调；外部注入不进入
   载荷——p1 契约）。React 侧据此把「画布悬停的天体」映射回两侧面板标记；引擎仍是画布悬停
   态的唯一权威（只读镜像，与 `engineSelectStore` 同款纪律）。 */
const engineHoverStore = {
  state: null,
  listeners: new Set(),
  getSnapshot() {
    return this.state;
  },
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },
  set(next) {
    /* 净房：非对象/缺 kind,id → null；字段收敛为字符串（防上游形状漂移污染比较）。 */
    const value = next && typeof next === "object" && typeof next.kind === "string" && typeof next.id === "string"
      ? {
        kind: next.kind,
        wsId: typeof next.wsId === "string" ? next.wsId : "",
        id: next.id
      }
      : null;
    const current = this.state;
    if (value === null && current === null) return;
    if (value !== null && current !== null
      && value.kind === current.kind
      && value.wsId === current.wsId
      && value.id === current.id) return;
    this.state = value;
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        /* 订阅者异常不阻断其余通知 */
      }
    }
  }
};

function useEngineHover() {
  return useSyncExternalStore(
    (listener) => engineHoverStore.subscribe(listener),
    () => engineHoverStore.getSnapshot()
  );
}

function useSceneVersion() {
  return useSyncExternalStore(
    (listener) => sceneVersionStore.subscribe(listener),
    () => sceneVersionStore.getSnapshot()
  );
}

/* ------------------------------------------------------------------ *
 * 控制器：providers + 引擎生命周期单例（apply 的 effect 创建，与插件 fiber 同寿命）
 * ------------------------------------------------------------------ */

/** 注册成功后等待新星座进入场景的窗口（add-cosmos-add-workspace D4/4.2：~8s；超时
    静默清 pending、停留银河——宿主同步延迟星座随后自然出现，不报错不悬挂）。 */
const PENDING_DIVE_WAIT_MS = 8000;

const controllerRef = { current: null };

/** 空星座判定（D6/4.3：「空」= 恒星/行星/彗星均空且无归档星云；与引擎侧同名判定
    双保险——有内容星座 MUST 走既有凝聚/游入转场，不叠加 chip 高亮）。 */
function isEmptyConstellation(ws) {
  return !(Number(ws?.stars?.length) > 0
    || Number(ws?.planets?.length) > 0
    || Number(ws?.comets?.length) > 0
    || Number(ws?.archives) > 0);
}

/**
 * 点击是否落在星图画布上（add-cosmos-selection-linkage 4.1 / design D4 的精确口径）。
 *
 * 引擎只对 `ev.target === canvas` 的 pointerup 做拾取（`onOverlayTarget` 守卫），因此
 * **只有画布起指的点击**可能携带新的拾取结果、进而需要在页面清空守卫里被「放行」。
 * 左下「＋」、星座卡片、天体信息卡等其余区域的点击不经引擎拾取——即使引擎此刻仍有选中
 * （上一次画布点选留下的），也 MUST 按既有语义清除面板选中（spec「点击其他区域取消选中」）。
 *
 * 非 Element 目标（文本节点等）与异常一律保守回落 false（按「非画布」处理，照常清空）。
 * @param {unknown} target 事件目标
 * @returns {boolean} true = 画布起指的点击
 */
function isStarCanvasTarget(target) {
  if (!target || typeof target.closest !== "function") return false;
  try {
    return target.closest(".cos-canvas") !== null;
  } catch {
    return false;
  }
}

function createCosmosController(ctx, notifyToast, channels) {
  let disposed = false;
  let skeleton = null;
  let mergedScene = null;
  let engine = null;
  /* 宿主当前会话跟随器（add-cosmos-host-session-follow）：disposers 就绪后创建；
     镜像/哨兵/订阅随控制器（页开合无关），页关闭时引擎缺席仅记哨兵。 */
  let hostFollow = null;
  let open = false;
  let visible = true;
  let sceneFetchSeq = 0;
  let rafHandle = 0;
  let filterQuery = ""; // 搜索查询（会话态；MUST NOT 持久化——整页关闭即重置）
  let addingWorkspace = false; // 新增流程 busy 门（pick → create 全程防重入，D7）
  let pendingDiveWsId = null; // 注册成功后待 dive-in 的星座 id（D4）
  let pendingDiveTimer = 0; // 等待窗口定时器（超时静默清 pending）
  const heroMarkers = channels.pending;
  const floatMarkers = channels.floatMarkers;
  const actionGate = channels.gate;
  /* 星胚动作**独立标记通道**（add-cosmos-action-prestate-gate 3.2）：与提案 hero、
     星座浮窗三通道隔离——各 store 实例互不读写、互不清除（缺注入时本地兜底实例）。 */
  const embryoMarkers = channels?.embryoMarkers ?? createPendingActionStore();

  /** 词典取值（缺键/宿主降级回落字面量）：控制器内一次性文案（toast）用。 */
  const tr = (key, fallback) => {
    try {
      const value = typeof ctx.locale?.bind === "function" ? ctx.locale.bind(NS)(key) : null;
      return typeof value === "string" && value && value !== key ? value : fallback;
    } catch {
      return fallback;
    }
  };

  /**
   * 权威 workspaceId 解析（提案动作 / 星座动作共用；fix-cosmos-action-draft-block D1）：
   * 骨架 id 在老宿主上可能取 registry 的 `id` 字段，而宿主会话动词要的是工作区镜像的
   * `workspaceId`。按归一化路径在官方镜像里查唯一权威 id，查不到才回落骨架 id。
   * @param {string} workspaceId 骨架工作区 id
   * @param {{wsPath?: string}|null} card 卡片/分组（按路径解析权威 id）
   * @returns {string} 传给宿主会话动词的工作区 id
   */
  const resolveTargetWorkspaceId = (workspaceId, card) => {
    let targetId = workspaceId;
    try {
      const items = ctx.workspaces?.list?.getSnapshot?.()?.items ?? [];
      const registered = findRegisteredWorkspace(items, card?.wsPath ?? "", isWindowsPlatform());
      const resolved = registered ? registered.workspaceId ?? registered.id : "";
      if (typeof resolved === "string" && resolved) targetId = resolved;
    } catch {
      /* 镜像不可达：回落骨架 id（宿主动词内部会给出自己的错误） */
    }
    return targetId;
  };

  /**
   * **恒新建会话**通道（提案动作 / 星座动作主路径）：官方 `ctx.sessions.create({ workspaceId })`
   * 的薄包装。MUST NOT 传 `sessionId`——宿主仅对具名 blank 复用，缺省恒新建 blank；
   * 用户既有会话与其未发送草稿零接触（不复用、不覆盖、不归档）。
   * 通道缺失 / 宿主拒绝 → 抛错（执行器据此走降级回落，行为 = 今日）。
   * @param {string} workspaceId 骨架工作区 id
   * @param {{wsPath?: string}|null} card 卡片/分组
   * @returns {Promise<string>} 新会话 id
   */
  const createSessionVia = async (workspaceId, card) => {
    const sessions = ctx.sessions;
    if (!sessions || typeof sessions.create !== "function") throw new Error("当前宿主未提供会话创建通道");
    const targetId = resolveTargetWorkspaceId(workspaceId, card);
    const sessionId = await sessions.create({ workspaceId: targetId });
    if (typeof sessionId !== "string" || !sessionId) throw new Error("会话创建未返回有效 id");
    return sessionId;
  };

  /**
   * 会话导航（官方 `uiWorkspace.openSession`；旧宿主回落 `ctx.sessions.open`）：
   * 仅「选中会话并呈现其对话」，**不关页、不改写任何草稿**（草稿按会话驻留），
   * 故「执行后跳转」与否只由执行器的 closePage/keepPage 分流决定。
   * @param {string} sessionId 目标会话 id
   * @returns {boolean} 是否真的发起导航
   */
  const openSessionVia = (sessionId) => {
    if (typeof ctx.uiWorkspace?.openSession === "function") {
      ctx.uiWorkspace.openSession(sessionId);
      return true;
    }
    if (typeof ctx.sessions?.open === "function") {
      ctx.sessions.open(sessionId);
      return true;
    }
    throw new Error("当前宿主未提供会话导航通道");
  };

  /**
   * 动作链路「跳转尾巴」（add-cosmos-rightbar-dock D4 / pageCloseActionOf）：
   *  - `embedded`：关整页（现状零变化）；
   *  - `dock`：**no-op**——Cosmos dock tab 保持原位，会话在左列原地导航；动作本体
   *    （恒新建/标记登记/模型切换/autoSend/关联绑定）与外嵌态共用同一链路。
   * 星胚/星座动作不做形态特判（与内嵌同一条链路）。
   */
  const closePageAfterJump = () => {
    if (pageCloseActionOf(currentLaunchMode()) === "close-page") cosmosOpenStore.set(false);
  };

  /**
   * **降级路径**（`sessions.create` 缺席/失败时）的新会话通道：官方
   * `uiWorkspace.startSession(工作区, { prompt[, whenDraftExists] })`。
   * 「复用首个 reusable blank + whenDraftExists 语义」只活在这条路径上。
   * @param {string} workspaceId 骨架工作区 id
   * @param {string} message 落草稿的消息
   * @param {{wsPath?: string}|null} card 卡片/分组（按路径解析权威 id）
   * @param {object} [sessionOptions] 追加的 startSession 选项（星座降级 replace）
   */
  const startSessionVia = (workspaceId, message, card, sessionOptions) => {
    const uiWorkspace = ctx.uiWorkspace;
    if (!uiWorkspace || typeof uiWorkspace.startSession !== "function") {
      throw new Error("当前宿主未提供新会话通道");
    }
    const targetId = resolveTargetWorkspaceId(workspaceId, card);
    uiWorkspace.startSession(
      targetId,
      sessionOptions === undefined ? { prompt: message } : { prompt: message, ...sessionOptions }
    );
  };

  /**
   * 提案动作按钮执行链路（fix-cosmos-action-draft-block 1.x / 2.x / design D1–D5）：
   * 组装 → **恒新建会话**（`ctx.sessions.create`）→ 登记一次性标记（heroMarkers，绑定
   * 目标 SessionId + 落稿意图；无论是否 autoSend/绑定模型均登记）→
   * `uiWorkspace.openSession(新会话 id)` → 按**该按钮** `jumpNewSession`（缺省 true）分流：
   *  - 跳转（缺省）：`closePage` 关闭 Cosmos 整页（既有呈现，页面切换即反馈）；
   *  - 不跳转：`keepPage` 保持整页 → 引擎 toast 补位。
   * 消息落稿在 hero 相位（`inputActions.setDraft`），用户既有草稿零接触；
   * `startSession` 作降级通道。
   */
  const actionExecutor = createActionExecutor({
    pending: heroMarkers,
    gate: actionGate,
    createSession: (workspaceId, card) => createSessionVia(workspaceId, card),
    openSession: (sessionId) => openSessionVia(sessionId),
    startSession: (workspaceId, message, card) => startSessionVia(workspaceId, message, card),
    /* ⑤ 显式关联绑定（fix-cosmos-association-scope 3.2）：新会话 → 目标提案的声明通道。
       执行器保证非阻断、失败静默；端点未升级/不可达只退回启发式（不 toast、不阻断落稿）。 */
    bindSession: (input) => bindSession(input),
    /* 跳转尾巴（add-cosmos-rightbar-dock D4）：embedded 关整页；dock 为 no-op（tab 保持）。 */
    closePage: () => closePageAfterJump(),
    keepPage: () => notifyToast?.(tr("cosmos.actions.keepOpenNotice", "已在新会话填入消息，Cosmos 保持打开")),
    notify: (text) => notifyToast?.(text),
    labels: { degraded: tr("cosmos.actions.degraded", "新建会话通道不可用，已降级为复用空白会话") }
  });

  /**
   * 探索会话存续解析（add-cosmos-action-prestate-gate 3.4 / spec ⑤守卫）：
   * 锚点 `sessionId` → 在册/归档（官方 `ctx.sessions.list` 镜像 + 工作区归档集合）→
   * 运行中（`uiSession.sessionStatus` 优先，回落镜像 `running`）。
   * 镜像不可达（老宿主）时不做在册判定（`sessionIds: null` → 不阻断，行为不劣化）。
   * @param {{sessionId?: string}|null} card 星胚合并卡片
   * @returns {{ok: boolean, reason: "ok"|"no-session"|"archived"|"missing"|"running", sessionId: string}}
   */
  const explorationStateOf = (card) => {
    const sessionId = typeof card?.sessionId === "string" ? card.sessionId : "";
    const mirror = ctx.sessions?.list?.getSnapshot?.() ?? null;
    const sessionIds = mirror !== null && Array.isArray(mirror.ids) ? mirror.ids : null;
    const archivedSessionIds = ctx.workspaces?.list?.getSnapshot?.()?.archivedSessionIds ?? null;
    const target = explorationTargetOf({ sessionId, sessionIds, archivedSessionIds });
    if (!target.ok) return target;
    /* 运行中：统一状态快照优先（实时），缺失时回落会话镜像的 running 标记。 */
    const statuses = resolveSessionStatus()?.getSnapshot?.() ?? null;
    let status = null;
    if (statuses !== null && statuses !== undefined) {
      status = typeof statuses.get === "function" ? statuses.get(sessionId) : statuses[sessionId];
    }
    if (!status || typeof status !== "object") status = mirror?.byId?.[sessionId] ?? null;
    if (status?.running === true) return { ok: false, reason: "running", sessionId };
    return target;
  };

  /**
   * 星胚动作按钮执行链路（add-cosmos-action-prestate-gate 3.1–3.2）：
   * 目标 = 星胚组锚点探索会话（`explorationStateOf` 守卫）→ 消息 = prompt（无 @引用，
   * 多 slug 逐行清单）→ 独立标记（先于导航）→ `openSession(探索会话)` → 按该按钮
   * `jumpNewSession` 分流（跳转关整页 / 不跳转保持 Cosmos）。恒不新建会话。
   */
  const embryoExecutor = createEmbryoActionExecutor({
    pending: embryoMarkers,
    gate: actionGate,
    resolveTarget: (card) => explorationStateOf(card),
    openSession: (sessionId) => openSessionVia(sessionId),
    /* 星胚链路的跳转尾巴（add-cosmos-rightbar-dock D4）：与提案动作同一条 closePage 分流。 */
    closePage: () => closePageAfterJump(),
    keepPage: () => notifyToast?.(tr("cosmos.actions.embryoKeepOpen", "已在探索会话填入消息，Cosmos 保持打开")),
    notify: (text) => notifyToast?.(text),
    labels: {
      unavailable: tr("cosmos.actions.embryoUnavailable", "探索会话不可用"),
      running: tr("cosmos.actions.embryoRunning", "探索会话正在执行，未打断"),
      failed: tr("cosmos.actions.embryoSendFailed", "发送到探索会话失败：")
    }
  });

  /**
   * 星座动作按钮执行链路（fix-cosmos-action-draft-block 3.x / add-cosmos-native-composer 3.1 /
   * rework：浮动原生窗口设计经宿主槽位核查为结构性死锁后拆除，native 呈现归位关页跳转）：
   * 消息 = 纯 prompt；目标 = 当前钻取星座工作区；**恒新建 + openSession**；
   * 三分支分流（共享 processor 冷却门）：
   *  - autoSend → hero 通道（提交意图）→ 整页保持；
   *  - 未勾选 + `constPreflight === "native"` → hero 通道（只落稿/切模型）→ openSession 后
   *    **关整页**，用户落在原生会话页 composer（预填提示词，宿主契约已验证链路）；
   *  - 未勾选 + `constPreflight === "float"`（缺省，星空保持优先）→ 浮窗标记通道 → 整页保持。
   * `preflight` 每次 run 现读设置面（保存即时生效，MUST NOT 构造期缓存）；
   * 降级路径回落 `startSession(replace)`（覆盖语义只活在降级），native 分支降级后同样关页
   * （两路呈现收敛）。
   */
  const constExecutor = createConstellationExecutor({
    pending: heroMarkers,
    floats: floatMarkers,
    gate: actionGate,
    /* preflight 每次 run 现读设置面（保存即时生效，MUST NOT 构造期缓存）。 */
    preflight: () => loadCosmosSettings().constPreflight,
    /* native 分支关整页（embedded）；dock 态 no-op——Cosmos tab 保持，左列原地导航。 */
    closePage: () => closePageAfterJump(),
    createSession: (workspaceId, group) => createSessionVia(workspaceId, group),
    openSession: (sessionId) => openSessionVia(sessionId),
    startSession: (workspaceId, message, group) => startSessionVia(workspaceId, message, group, { whenDraftExists: "replace" }),
    notify: (text) => notifyToast?.(text),
    labels: { degraded: tr("cosmos.actions.degraded", "新建会话通道不可用，已降级为复用空白会话") }
  });

  /** 清 pendingDive（成功消费 / 超时 / 实例销毁共用）。 */
  const clearPendingDive = () => {
    pendingDiveWsId = null;
    if (pendingDiveTimer) {
      clearTimeout(pendingDiveTimer);
      pendingDiveTimer = 0;
    }
  };

  /** 待 dive-in 置位 + 等待窗口（窗口内 rebuild 见到该星座 → dive；超时静默降级）。 */
  const armPendingDive = (wsId) => {
    clearPendingDive();
    pendingDiveWsId = wsId;
    if (typeof setTimeout !== "function") return;
    pendingDiveTimer = setTimeout(() => {
      pendingDiveTimer = 0;
      pendingDiveWsId = null; // 降级：停留银河，星座随后自然出现（含空星座 chip 高亮）
    }, PENDING_DIVE_WAIT_MS);
    pendingDiveTimer?.unref?.(); // Node 侧测试/宿主降级守卫（浏览器定时器无 unref）
  };

  /* uiSession 安全解析（单次记忆，add-celestial-states 5.1）：inject 已声明 uiSession
     （宿主 cordis 规则：ctx 属性 MUST 经 inject 声明方可访问，否则抛 "without
     inject"）；运行时仍防御形态差异——解析失败永久降级 idle/busy（D3），SHALL NOT
     波及 rebuild 帧路径。 */
  let sessionStatusSource;
  let sessionStatusResolved = false;
  const resolveSessionStatus = () => {
    if (!sessionStatusResolved) {
      sessionStatusResolved = true;
      try {
        sessionStatusSource = ctx.uiSession?.sessionStatus ?? null;
      } catch {
        sessionStatusSource = null; // 信号不可达 → 降级 idle/busy 两态
      }
    }
    return sessionStatusSource;
  };

  const scheduleRebuild = () => {
    if (disposed || rafHandle) return;
    rafHandle = requestAnimationFrame(() => {
      rafHandle = 0;
      rebuild();
    });
  };

  const refreshSkeleton = () => {
    if (disposed) return;
    const seq = ++sceneFetchSeq;
    fetchScene().then((result) => {
      if (disposed || seq !== sceneFetchSeq) return;
      if (result.ok) {
        skeleton = result.scene;
        scheduleRebuild();
      } else if (engine) {
        engine.toast("骨架拉取失败：" + result.error);
      }
    });
  };

  /* ---------- 搜索过滤（add-cosmos-search-filter 3.1/3.4） ---------- */

  /**
   * 过滤视图计算（纯函数面 + 最近一次 mergedScene 的自然位置）：
   *  - 空/纯空白查询 → 过滤关闭（matched 空集、pos 空 Map、计数 = 全量）；
   *  - 非空 → matchWorkspaces（名称子串 AND）+ filteredPositions（子集确定性布局）；
   *  - `count` 供 React「无匹配工作区」空态与 DICT 消费。
   */
  const filterViewOf = () => {
    const scene = mergedScene ?? { workspaces: [] };
    const total = Array.isArray(scene.workspaces) ? scene.workspaces.length : 0;
    const text = typeof filterQuery === "string" ? filterQuery.trim() : "";
    if (!text) return { text: "", total, matched: new Set(), pos: new Map(), count: total };
    const matched = matchWorkspaces(scene, filterQuery);
    return { text, total, matched, pos: filteredPositions(matched), count: matched.size };
  };

  /**
   * 过滤下发 + 空态数据源刷新（幂等）：
   *  - 空查询 → `active: false`（引擎过滤关闭，星座回骨架原位置）；
   *  - 非空且 0 命中 → `active: true` + 空集（spec 空匹配：全部淡隐 + React 空态）；
   *  - 引擎 setFilter 逐项相等短路 → SSE 幂等重发零副作用。
   */
  const syncFilter = () => {
    const view = filterViewOf();
    const active = view.text !== "";
    if (engine) engine.setFilter(view.matched, view.pos, { active });
    filterStore.set({ query: filterQuery, matched: view.text ? view.count : view.total, total: view.total, active });
    return view;
  };

  const actions = {
    openSession(sessionId) {
      /* 打开会话导航链路（信息卡按钮 / 空格快捷键 / 会话面板行 / 决策入口）：
         embedded 先关整页再切换右侧系统会话页；dock 态 tab 保持原位（MUST NOT 关闭
         tab / 收起右栏），左列原地导航。 */
      if (pageCloseActionOf(currentLaunchMode()) === "close-page") cosmosOpenStore.set(false);
      try {
        if (typeof ctx.uiWorkspace?.openSession === "function") ctx.uiWorkspace.openSession(sessionId);
        else if (typeof ctx.sessions?.open === "function") ctx.sessions.open(sessionId);
        else console.warn("[dsh-v-cosmos] no session navigation verb available");
      } catch (error) {
        console.warn("[dsh-v-cosmos] openSession failed:", error);
        notifyToast?.("打开会话失败：" + String(error?.message || error));
      }
    },
    refresh() {
      refreshSkeleton();
    },
    /**
     * 信息卡「归档会话」执行链路（add-cosmos-session-archive-action 3.1 / design D1/D2/D8）：
     *  - 单元素请求组装：一次点击只归档卡片实体这一个会话；
     *  - POST 自有批量归档端点：请求体**只有** sessionIds——MUST NOT 携带 stopActivity
     *    （turn / subagent 链 / job / schedule 在跑者只跳过不杀，spec「归档安全语义」）；
     *  - 逐会话 outcome → 呈现文案（session-archive.mjs 纯逻辑）→ 引擎 toast；整页保持
     *    打开（归档发生在覆盖层底下，行星/彗星谢幕与关联边剪除由既有管道承接）；
     *  - 网络失败 / 非 2xx → 失败 toast，可再次点击重试（点击即执行、无确认模态，D2）；
     *  - 防重入的权威门在引擎点击处理器（per-session in-flight，D6）；本方法恒发一个请求。
     * @param {string} sessionId 卡片实体（行星/彗星）的会话 id
     * @returns {Promise<{outcome: string, tone: string, text: string}>} 呈现产物（冒烟观测面）
     */
    async archiveSession(sessionId) {
      const id = typeof sessionId === "string" ? sessionId : "";
      if (!id) {
        const notice = archiveRequestFailureNotice("缺少会话 id");
        engine?.toast(notice.text);
        return notice;
      }
      let response;
      try {
        response = await fetch(ARCHIVE_SESSIONS_PATH, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionIds: [id] })
        });
      } catch (error) {
        const notice = archiveRequestFailureNotice(error);
        engine?.toast(notice.text); // 端点不可达：整页保持打开，可再次点击重试
        return notice;
      }
      /* 端点恒 200 返回 {results}（部分失败仍是 200）；非 2xx = 请求面失败（400 invalid /
         代理错误），按请求级失败呈现。坏 JSON 按空体处理（下落 outcome 兜底）。 */
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const notice = archiveRequestFailureNotice(
          body?.reason || body?.error || response.status + " " + response.statusText
        );
        engine?.toast(notice.text);
        return notice;
      }
      const results = Array.isArray(body?.results) ? body.results : [];
      const entry = results.find((item) => item?.sessionId === id) ?? results[0] ?? null;
      const notice = archiveNoticeOf(entry);
      engine?.toast(notice.text);
      return notice;
    },
    /**
     * 星胚移除执行链路（add-cosmos-embryo-dismiss 4.1 / design D5/D9）：
     *  - 请求体 `{workspaceId, slug}`：画布实体 `ws.id` 与 proto 星 `data.id`（= 锚点 slug）；
     *  - POST 自有 dismiss 端点 → **恒 200** + `{outcome}` → 文案映射 → 引擎 toast；
     *  - 呈现零新增：锚点删除经宿主 fs.watch → `proposals-changed` → 骨架差分，星胚以既有
     *    低强度消散变体退场（本方法 MUST NOT 主动收卡 / 关整页）；
     *  - 防重入的权威门在引擎点击处理器（两击确认 + per-`ws:slug` 在途，D7）；本方法恒发
     *    一个请求；失败可再次点击重试（两击确认每轮重来）。
     * @param {{workspaceId?: string, slug?: string}} input 星实体钩子（`ws.id` / `data.id`）
     * @returns {Promise<{outcome: string, tone: string, text: string}>} 呈现产物（冒烟观测面）
     */
    async dismissEmbryo(input) {
      const workspaceId = typeof input?.workspaceId === "string" ? input.workspaceId : "";
      const slug = typeof input?.slug === "string" ? input.slug : "";
      if (!workspaceId || !slug) {
        const notice = dismissNotice("failed", "error", tr("cosmos.dismiss.noTarget", "缺少星胚定位信息，未移除"));
        engine?.toast(notice.text);
        return notice;
      }
      let response;
      try {
        response = await fetch(DISMISS_EMBRYO_PATH, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workspaceId, slug })
        });
      } catch (error) {
        const notice = dismissNotice(
          "failed",
          "error",
          tr("cosmos.dismiss.requestFailed", "移除请求失败：") + String(error?.message || error || "")
        );
        engine?.toast(notice.text); // 端点不可达：可再次点击重试
        return notice;
      }
      /* 端点恒 200（结果由 outcome 枚举承载）；非 2xx = 请求面失败（代理错误 / 路由不匹配）。 */
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const notice = dismissNotice(
          "failed",
          "error",
          tr("cosmos.dismiss.requestFailed", "移除请求失败：") +
            String(body?.reason || body?.error || response.status + " " + response.statusText)
        );
        engine?.toast(notice.text);
        return notice;
      }
      const outcome = typeof body?.outcome === "string" ? body.outcome : "";
      const reason = typeof body?.reason === "string" ? body.reason : "";
      let notice;
      if (outcome === "deleted") {
        notice = dismissNotice(outcome, "ok", tr("cosmos.dismiss.deleted", "星胚已移除"));
      } else if (outcome === "already-missing") {
        notice = dismissNotice(outcome, "neutral", tr("cosmos.dismiss.alreadyMissing", "该星胚已不存在"));
      } else if (outcome === "guard-dir-exists") {
        notice = dismissNotice(outcome, "warn", tr("cosmos.dismiss.guardDirExists", "同名提案已创建，未移除"));
      } else if (outcome === "missing-workspace") {
        notice = dismissNotice(outcome, "error", tr("cosmos.dismiss.missingWorkspace", "工作区不在册，未移除"));
      } else {
        /* failed（或未知枚举）→ 携带端点 reason 供用户判断；未知枚举原样透传便于诊断。 */
        notice = dismissNotice(
          outcome || "failed",
          "error",
          tr("cosmos.dismiss.failed", "移除失败：") + (reason || tr("cosmos.dismiss.failedUnknown", "未知错误"))
        );
      }
      engine?.toast(notice.text);
      return notice;
    },
    /**
     * 新增工作区（add-cosmos-add-workspace D1/D2/D7 / 4.1）：官方服务组合
     * `pickDirectory` + `workspaces.create`，与宿主「添加工作区」同源。
     *  - 取消（picker → null）→ 静默返回（官方 onCancel 同义）；
     *  - 幂等重选已注册目录 → 归一化路径前置比对（斜杠/尾分隔符/Windows 大小写折叠），
     *    命中即 toast「该目录已在册」，MUST NOT 调 create、无视觉副作用；
     *  - create 拒绝 → toast(error.message)（与官方错误模态同源）；重试 = 再次点击；
     *  - 成功 → 记 pendingDiveWsId + 主动 refresh（拉 /scene → 宿主指纹对账 → 骨架
     *    收敛），留在银河 dive-in 新星座；MUST NOT 调 openWorkspace / 关整页；
     *  - pick → create 全程 busy 防重入（重复点击直接忽略）。
     * @returns {Promise<boolean>} 是否被受理（false = 服务不可用/失败/重入）
     */
    async addWorkspace() {
      if (disposed || addingWorkspace) return false;
      const uiWorkspace = ctx.uiWorkspace ?? null;
      const pick = uiWorkspace?.pickDirectory;
      if (typeof pick !== "function") {
        notifyToast?.("目录选择器不可用（当前宿主未提供）");
        return false;
      }
      if (typeof ctx.workspaces?.create !== "function") {
        notifyToast?.("工作区服务不可用（当前宿主未提供）");
        return false;
      }
      addingWorkspace = true;
      try {
        let path = null;
        try {
          path = await pick.call(uiWorkspace);
        } catch (error) {
          notifyToast?.("打开目录选择器失败：" + String(error?.message || error));
          return false;
        }
        if (!path) return true; // 取消 → 静默（无提示、无视觉变化）
        const windows = isWindowsPlatform();
        const items = ctx.workspaces?.list?.getSnapshot?.()?.items ?? [];
        const existing = findRegisteredWorkspace(items, path, windows);
        if (existing) {
          const title = typeof existing.title === "string" && existing.title ? "：" + existing.title : "";
          notifyToast?.("该目录已在册" + title);
          return true; // 幂等成功：不重复注册
        }
        let workspace = null;
        try {
          workspace = await ctx.workspaces.create({ path });
        } catch (error) {
          notifyToast?.(String(error?.message || error)); // 文案 = WorkspaceCreateError.message
          return false;
        }
        const wsId = typeof workspace?.workspaceId === "string" ? workspace.workspaceId : "";
        if (wsId) armPendingDive(wsId);
        refreshSkeleton(); // 不依赖 SSE 时序：主动拉一次 /scene 触发宿主注册对账
        return true;
      } finally {
        addingWorkspace = false;
      }
    },
    /**
     * 平移调参 / 缩放导航（设置 UI 消费面）：净房写入 localStorage + 引擎热更新
     * （部分写语义；整页开着时立即生效）。缩放导航三键同步进 `cosmosNavStore`
     * （设置页「导航」页签的受控镜像）。返回归一化后的完整设置。
     */
    saveTuning(patch) {
      const merged = saveCosmosSettings(patch);
      engine?.setTuning(merged);
      cosmosNavStore.set(navPrefsOf(merged));
      return merged;
    },
    /** 缩放导航设置写入（「导航」页签 face.set 的唯一落点）：与 saveTuning 同链路。 */
    saveNav(patch) {
      const merged = saveCosmosSettings(patch);
      engine?.setTuning(merged);
      cosmosNavStore.set(navPrefsOf(merged));
      return merged;
    },
    /**
     * 星座模板名显示写入（add-cosmos-template-name-toggle 1.2/D1/D4；「通用」页签 face 的
     * 整页存活落点）：轻量即时偏好——净房持久化 → 已打开整页 `engine.setTuning` 热更
     * （布尔镜像；chip 文本显式刷新、badge 下一帧差分收敛）→ 受控镜像同步（设置页回显）。
     * 与 saveNav 同链路；值恒等时幂等（引擎侧值变才动作），无回环。
     * @param {unknown} enabled 目标开关态（非 `true` 一律按关闭，净房同口径）
     * @returns {object} 净房后的完整设置
     */
    saveTemplateNames(enabled) {
      const merged = saveCosmosSettings({ templateNames: enabled === true });
      engine?.setTuning(merged);
      cosmosTemplateNamesStore.set({ templateNames: merged.templateNames });
      return merged;
    },
    /**
     * 全局快捷键写入（add-cosmos-shortcuts 5.3 / spec「设置页『快捷键』页签」）：
     * 轻量偏好即时保存——净房写盘 → 已打开整页 `engine.setShortcuts` 热更（引擎键位表
     * 翻转/飞回立即跟随）→ 模块 store 同步（关闭链/按钮键分发/浮窗提示经 ref/store 读取）。
     * 部分写语义（patch 只覆盖给出字段）；净房恒无冲突（读面固定优先序回落）。
     * @param {object} patch `{ closePage?, goHome?, togglePan?, voiceToggle? }`
     * @returns {object} 净房后的完整设置
     */
    saveShortcuts(patch) {
      /* 部分写语义：以当前净房值为底合并 patch（缺席键保持原值；非法值由 shortcutsOf
         回落缺省——与 setTuning 的「非法忽略」略异，本键的缺省回落是确定性净房口径）。 */
      const current = loadCosmosSettings().shortcuts;
      const next = shortcutsOf({ ...current, ...(patch && typeof patch === "object" ? patch : {}) });
      const merged = saveCosmosSettings({ shortcuts: next });
      engine?.setShortcuts?.(merged.shortcuts);
      cosmosShortcutsStore.set({ ...merged.shortcuts });
      return merged;
    },
    /**
     * 「发送前编辑」呈现分支写入（add-cosmos-native-composer 4.1；星座动作页签 face.set
     * 的唯一落点）：轻量即时偏好——saveCosmosSettings 净房持久化 → 受控镜像同步；
     * 不触碰按钮草稿面。执行器每次 run 现读持久化值，故「保存即生效」无需重开整页。
     * @param {"native"|"float"} mode 目标分支（非法值由净房回落 `native`）
     * @returns {object} 净房后的完整设置
     */
    savePreflight(mode) {
      const merged = saveCosmosSettings({ constPreflight: mode });
      cosmosPreflightStore.set(preflightPrefsOf(merged));
      return merged;
    },
    getTuning() {
      return engine?.getTuning?.() ?? loadCosmosSettings();
    },
    /**
     * 皮肤选择（add-cosmos-skin-themes 3.4 / spec「皮肤选择设置页签」）：净房写入
     * `dsh-v-cosmos:settings.skin` → 模块 store（整页 React 侧令牌跟随）→ 已打开引擎
     * `setSkin`（呈现层热替，无场景重建）。返回净化后的 id（非法值回落默认）。
     * @param {string} id 皮肤 id（注册表外 → 回落默认）
     * @returns {string} 生效的皮肤 id
     */
    selectSkin(id) {
      const applied = applySkinSelection(id);
      engine?.setSkin?.(createSkin(applied));
      return applied;
    },
    /** 当前皮肤 id（设置页选中态镜像；与整页 token 下发同源）。 */
    getSkin() {
      return currentSkinId();
    },
    /**
     * 搜索过滤（3.1）：查询 → 纯函数匹配/子集布局 → 引擎呈现态。
     * 幂等（引擎短路）；返回过滤视图计数供 React 空态使用。
     */
    setFilter(query) {
      filterQuery = typeof query === "string" ? query : String(query ?? "");
      const view = syncFilter();
      return { query: filterQuery, matched: view.count, total: view.total, active: view.text !== "" };
    },
    /** 只读过滤视图（观测/冒烟面）：不触发任何下发。 */
    getFilterState() {
      const view = filterViewOf();
      return { query: filterQuery, matched: view.text ? view.count : view.total, total: view.total, active: view.text !== "" };
    }
  };

  /**
   * 合并 + 引擎注入（骨架×镜像 → scene；属性级补丁 vs 全量重建）。
   * 事件动画：彗星→行星（同 id 集合迁移）→ 成星捕获；行星/彗星/卫星消失 → 事件
   * 流星；生命周期属性迁移 → 点燃/落印/查看渐熄/executed 金涌（P1 叙事，经引擎
   * 调度器）。转场编排（add-transition-choreography）：实体出生 birth（prev!==null
   * 才播，星座凝聚按 starIndex 错峰）、ws 消散 → 引擎自快照消散幽灵；冷启动/
   * 重挂载（prev===null）不播事件转场，由点亮序曲呈现。
   */
  function rebuild() {
    if (disposed) return;
    const sessions = ctx.sessions?.list?.getSnapshot?.() ?? { ids: [], byId: {} };
    const workspaces = ctx.workspaces?.list?.getSnapshot?.() ?? { items: [] };
    /* 统一会话状态快照（add-celestial-states 5.1）：经记忆化安全解析（解析失败
       → null = merge 侧 D3 降级 idle/busy，SHALL NOT 抛错中断 rebuild）。 */
    const statuses = resolveSessionStatus()?.getSnapshot?.() ?? null;
    const next = mergeScene({ skeleton: skeleton ?? { workspaces: [] }, sessions, workspaces, statuses });
    const prev = mergedScene;
    const level = sceneDiffLevel(prev, next);
    /* "none" = 连相对时间文本都未变（sceneDiffLevel 已计入 age/when）：MUST NOT 进入
       引擎/重建场景。全量 rebuild 会重挂覆盖层并清空尾迹——「无变化也重建」正是画面
       闪烁的来源；会话 activity / 工作区列表 / SSE 刷新等订阅都会走到这里。 */
    if (level === "none") {
      mergedScene = next;
      return;
    }
    /* 事件动画差分（属性补丁/重建都检测；以 id 集合迁移与属性沿为准）。 */
    if (engine) {
      const prevSet = celestialIndex(prev);
      const nextSet = celestialIndex(next);
      const prevWsIds = new Set((prev?.workspaces ?? []).map((w) => w.id));
      const nextWsIds = new Set((next?.workspaces ?? []).map((w) => w.id));
      /* 本帧常规超新星爆心集合（add-cosmos-nova-ejection 3.1）：prevSet 同趟遍历中
         恒星分支先于行星分支执行，回归分支解析时集合已就绪；星胚消散变体与工作区
         注销静默移除不收集（弹射是「恒星归档（超新星）」专属叙事）。 */
      const blastCores = [];
      /* 星座消散幽灵（5.2/D5）：ws 集合减少 → 引擎在 setScene 替换前自快照
         （client prev 场景无尘埃 offsets，MUST NOT 在 client 组装快照）。 */
      if (prev) {
        for (const wsId of prevWsIds) {
          if (!nextWsIds.has(wsId)) engine.markWsGhost?.(wsId);
        }
        /* 空星座出生高亮（D6/4.3）：新进入骨架且无天体内容 → chip 脉冲渐熄，保证新
           注册（无 openspec）星座可见可定位；含内容星座走既有凝聚转场，标记由引擎侧
           空星座守卫二次确认。冷启动（prev === null）不标记。 */
        for (const ws of next?.workspaces ?? []) {
          if (prevWsIds.has(ws.id)) continue;
          if (isEmptyConstellation(ws)) engine.markWsBirth?.(ws.id);
        }
      }
      for (const [key, info] of nextSet) {
        const before = prevSet.get(key);
        if (!before) {
          /* 出生转场（2.3/D2）：prev !== null 才播——冷启动/重挂载（prev===null）
             不触发差分，改由点亮序曲呈现。 */
          if (prev !== null) {
            if (info.kind === "planet" && prevSet.has("comet:" + info.id)) {
              /* 成星捕获（同 id 跨 kind 迁移 comet→planet）：走 markCapture 引力捕获，
                 MUST NOT 叠加 birth。from = 彗星最后世界坐标——worldPosOf MUST 在
                 setScene 前调用（旧场景彗星体仍在才查得到，与 markRegression 同款
                 时序约束）；返回 null（理论竞态）→ 引擎回落捕获环外缘点照常衔接，
                 不报错不中断。离场切向与尾迹快照由引擎侧在标记时就地采集。 */
              const from = engine.worldPosOf?.("comet", info.id) ?? null;
              engine.markCapture(info.id, from, { wsId: info.wsId });
            } else if (info.kind === "star" || info.kind === "planet" || info.kind === "comet") {
              /* 星座凝聚（5.2）：同帧新增 ws 的天体 birth 按 starIndex 错峰 0.15s
                 （delay 为调度器入参，fire 时间统一公式裁决）。 */
              const isNewWs = !prevWsIds.has(info.wsId);
              const wsNext = isNewWs ? (next?.workspaces ?? []).find((w) => w.id === info.wsId) : null;
              const delay = isNewWs && wsNext
                ? 0.15 * (info.kind === "star" ? info.starIndex ?? 0 : wsNext.stars?.length ?? 0)
                : 0;
              engine.enqueueFx?.(info.kind, info.id, "birth", {
                priority: FX_PRIORITY.existence,
                wsId: info.wsId,
                delay
              });
            }
            /* 卫星出生走引擎 body born 坡道（reconcileSatBodies 新建时标记），无需 fx。 */
          }
          continue;
        }
        /* 生命周期转场（5.3）：点燃 proto→created / 落印 created→reviewed（P1 叙事，
           经 D7 调度器）；executed 金涌（4.1/D4 翻案 add-celestial-states「executed
           无独立转场」决定——apply 完成是常驻画面上最有叙事价值的事件之一）。 */
        if (info.kind === "star" && before.lifecycle === "proto" && info.lifecycle !== "proto") {
          engine.enqueueFx?.("star", info.id, "ignite", { priority: FX_PRIORITY.narrative, wsId: info.wsId });
        } else if (info.kind === "star" && before.lifecycle === "created" && info.lifecycle === "reviewed") {
          engine.enqueueFx?.("star", info.id, "stamp", { priority: FX_PRIORITY.narrative, wsId: info.wsId });
        }
        if (info.kind === "star" && (before.lifecycle === "created" || before.lifecycle === "reviewed") && info.lifecycle === "executed") {
          engine.enqueueFx?.("star", info.id, "surge", { priority: FX_PRIORITY.narrative, wsId: info.wsId });
        }
        /* 查看渐熄（5.3）：done-unread → idle 属性沿（P0 注意力沿，不经队列照常
           markFx；行星与彗星同沿，皮肤 fx 驱动谓词消费）。 */
        if (before.state === "done-unread" && info.state === "idle") {
          if (info.kind === "planet") engine.markFx("planet", info.id, "view");
          else if (info.kind === "comet") engine.markFx("comet", info.id, "view");
        }
      }
      for (const [key, info] of prevSet) {
        if (nextSet.has(key)) continue;
        /* 回归判定（反向捕获）：prevSet 行星同帧迁移为 nextSet 彗星（同 id 跨 kind）
           → markRegression 并跳过熄灭流星（回归不是会话消亡）。worldPosOf MUST 在
           setScene 前调用（旧场景行星体仍在才查得到——与卫星消亡流星同款时序约束）；
           返回 null（理论竞态）→ 跳过标记，彗星按游荡方程直接出现，不 lerp 不报错。 */
        if (info.kind === "planet" && nextSet.has("comet:" + info.id)) {
          const from = engine.worldPosOf?.("planet", info.id);
          if (from) {
            /* 爆心解析（add-cosmos-nova-ejection 3.1）：同 ws 最近消亡恒星，并列取
               worldPos x 小者（确定性）；无候选 → 不传 blast（普通回归路径零变化）。 */
            const core = resolveBlastCoreOf(blastCores, info.wsId, from);
            engine.markRegression(info.id, from, core ? { wsId: info.wsId, blast: { starPos: core.starPos } } : { wsId: info.wsId });
          }
          continue;
        }
        /* 成星捕获的镜像守卫（2.3）：彗星同 id 迁移为行星（comet→planet）——跨 kind
           迁移非会话消亡，MUST NOT 播熄灭流星（捕获动画在 nextSet 新 key 分支接线）。 */
        if (info.kind === "comet" && nextSet.has("planet:" + info.id)) continue;
        if (info.kind === "planet" || info.kind === "comet") {
          engine.spawnEventMeteor(info.worldPos); // 会话消亡（同 id 直接消失 = 真死亡）
        } else if (info.kind === "sat") {
          /* 卫星消亡（5.3）：消亡流星起点 = 父天体世界坐标（引擎侧实时查询）。 */
          const origin = engine.worldPosOf?.(info.parentKind, info.parentId) ?? info.worldPos;
          engine.spawnEventMeteor(origin);
        } else if (info.kind === "star") {
          /* 恒星消亡 → 超新星（幽灵列表，add-comet-states-and-star-death）：
             色取临终生命周期态；driftTo = 星座中心快照（标记时定格）。
             工作区注销帧（next 无同名工作区，整星座消失）→ 静默移除、不逐星放炮
             （整星座出入场叙事归 choreography）；星胚（proto）→ 低强度消散变体。 */
          if (!nextWsIds.has(info.wsId)) continue;
          const opts = { driftTo: info.wsPos };
          if (info.lifecycle === "proto") {
            opts.intensity = 0.3; // 星胚消散变体：低强度、无激波 → 不构成爆心
          } else {
            /* 爆心收集（add-cosmos-nova-ejection 3.1）：本帧启动常规超新星的恒星进入
               本帧爆心集合；星胚消散变体与工作区注销静默移除不收集。 */
            blastCores.push({ wsId: info.wsId, starPos: info.worldPos.slice() });
          }
          engine.markStarNova(info.id, info.worldPos, activeSkinPalette().prop[info.lifecycle] ?? "#ffffff", opts);
        }
      }
    }
    mergedScene = next;
    if (engine) engine.setScene(next, level === "patch" ? "patch" : "rebuild");
    /* 过滤幂等重发（3.1/3.4）：MUST 在 setScene 之后——引擎钻取互斥裁决与 rebuild
       落位读到最新 matched；SSE 期间过滤保持、新出现的星座按当前查询即时判定。
       空查询亦刷新（引擎短路 no-op，仅同步空态计数）。 */
    syncFilter();
    /* pendingDive 消费（D4/4.2）：注册成功后目标星座已注入 → dive-in（复用既有钻取
       语义，Esc/右下「回到银河」按钮返回银河）；MUST 在 setScene 之后（新场景 ws 终态已就位）。
       未就绪 → 继续等（窗口由 armPendingDive 的定时器兜底，超时静默降级）。 */
    if (engine && pendingDiveWsId != null) {
      const targetWsId = pendingDiveWsId;
      if ((next?.workspaces ?? []).some((ws) => ws.id === targetWsId)) {
        clearPendingDive();
        engine.diveToWs?.(targetWsId);
      }
    }
    /* 开页定位消费（add-cosmos-host-session-follow 3.1）：首次场景就绪（attach 后首帧
       setScene）把镜头带到宿主当前会话——开页时场景尚未就绪的窗口由此兜底；每次开页
       只执行一次，定位后同步哨兵防同值重放（与变化沿哨兵解耦，见模块 tryOpenLocate）。 */
    hostFollow?.onSceneReady?.();
    sceneVersionStore.bump();
  }

  /**
   * 天体索引（5.3 事件差分）：恒星（含生命周期沿）/行星/彗星/卫星（父引用随行，
   * 消亡流星起点取父天体世界坐标）。
   */
  function celestialIndex(scene) {
    const map = new Map();
    for (const ws of scene?.workspaces ?? []) {
      /* starIndex 随行（choreography 5.2）：星座凝聚时 birth 按 starIndex 错峰 0.15s。 */
      (ws.stars ?? []).forEach((star, i) => {
        /* wsId/wsPos 随行（add-comet-states-and-star-death）：恒星消亡 nova 的
           driftTo = 星座中心快照；工作区注销（next 无同名工作区）→ 静默移除守卫。 */
        map.set("star:" + star.id, {
          kind: "star",
          id: star.id,
          lifecycle: star.lifecycle,
          wsId: ws.id,
          wsPos: ws.pos,
          starIndex: i,
          worldPos: [ws.pos[0] + star.off[0], ws.pos[1] + star.off[1], ws.pos[2] + star.off[2]]
        });
      });
      for (const planet of ws.planets ?? []) {
        map.set("planet:" + planet.id, { kind: "planet", id: planet.id, state: planet.state, wsId: ws.id, worldPos: ws.pos });
        for (const sat of planet.satellites ?? []) {
          map.set("sat:" + sat.id, { kind: "sat", id: sat.id, parentKind: "planet", parentId: planet.id, wsId: ws.id, worldPos: ws.pos });
        }
      }
      for (const comet of ws.comets ?? []) {
        map.set("comet:" + comet.id, { kind: "comet", id: comet.id, state: comet.state, wsId: ws.id, worldPos: ws.pos });
        for (const sat of comet.satellites ?? []) {
          map.set("sat:" + sat.id, { kind: "sat", id: sat.id, parentKind: "comet", parentId: comet.id, wsId: ws.id, worldPos: ws.pos });
        }
      }
    }
    return map;
  }

  const disposers = [];
  disposers.push(ctx.sessions?.list?.subscribe?.(() => scheduleRebuild()));
  disposers.push(ctx.workspaces?.list?.subscribe?.(() => scheduleRebuild()));
  /* 统一会话状态订阅（5.1）：completionUnread / pendingInteraction 随用户打开会话
     与交互实时翻转 → 行星四态与查看渐熄回流。经记忆化安全解析（inject 已声明；
     运行时再防御一次），SHALL NOT 波及插件 apply（GUI 启动路径）。 */
  try {
    const unsubscribe = resolveSessionStatus()?.subscribe?.(() => scheduleRebuild());
    if (typeof unsubscribe === "function") disposers.push(unsubscribe);
  } catch {
    /* 信号不可达 → 降级 idle/busy 两态 */
  }
  /* 宿主轻帧订阅（add-cosmos-entry；add-cosmos-action-queue 5.1 按帧类型分流）：
     - `queue-changed` → **只拉队列快照**（帧体无载荷，收到即 `fetchQueue()` 全量对账；
       MUST NOT 触发 scene 重拉——队列状态翻转频率远高于骨架变更，且批量执行期间帧密集，
       轻帧惯例 = 合帧后拉全量）；
     - `proposals-changed` / `associations-changed` → 重拉 scene（既有行为逐字不变；
       SSE 重订自愈，dock 正文重挂载亦经 attach 的单次 fetch + 本条长连接）。 */
  disposers.push(subscribeCosmosEvents((frame) => {
    if (frame?.type === "queue-changed") {
      refreshQueue();
      return;
    }
    refreshSkeleton();
  }));

  /* 宿主当前会话跟随（add-cosmos-host-session-follow / design D5）：单点出口 + 变化沿
     订阅在**控制器作用域**（页开合无关）——主源 subscribe 与降级镜像跨整页开合存活，
     页关闭时引擎缺席 → 变化沿仅记哨兵，重开页由开页定位兜底。订阅器入 disposers 统一
     回收（可选注入：服务不在册回调不执行 → 降级镜像模式，MUST NOT 阻断加载）。 */
  hostFollow = createHostSessionFollow({
    ctx,
    getEngine: () => engine,
    getScene: () => mergedScene,
    addDisposer: (dispose) => disposers.push(dispose)
  });
  hostFollow.attachUiSession();

  return {
    /* 设置页消费面（add-cosmos-skin-themes / add-cosmos-zoom-focus-nav）：控制器顶层
       暴露扁平方法——设置页签 face 经 `controllerRef.current?.<method>` 调用；`actions`
       子面保留同名方法（既有调用面零变化）。 */
    saveTuning: actions.saveTuning,
    saveNav: actions.saveNav,
    savePreflight: actions.savePreflight,
    getTuning: actions.getTuning,
    selectSkin: actions.selectSkin,
    getSkin: actions.getSkin,
    actions: {
      ...actions,
      /**
       * 动作按钮点击（add-cosmos-proposal-actions 4.3）：目标提案卡片由面板选中态提供；
       * 执行体在 actionExecutor（防重入 / 失败清理 / 关页均在其内）。
       * @param {{button: object, card: object}} input
       */
      runButton(input) {
        /* 星胚动作分流（add-cosmos-action-prestate-gate 3.1）：`preState: "proto"` 固定
           走探索会话链路（恒不新建会话）；其余按钮维持提案动作链路逐字不变。 */
        if (input?.button?.preState === "proto") return embryoExecutor.run(input);
        return actionExecutor.run(input);
      },
      /**
       * 星座动作按钮点击（add-cosmos-constellation-actions 2.2 / add-cosmos-native-composer 2.2）：
       * 目标 = 当前钻取星座分组（`{wsId, wsName, wsPath}`）；执行体在 constExecutor
       * （纯 prompt / replace / autoSend 或 native 或 float 三分支 /
       * 关页只听 native 分支 / 共享冷却门均在其内）。
       * @param {{button: object, group: object}} input
       */
      runConstButton(input) {
        return constExecutor.run(input);
      }
    },
    /** Esc 分层的引擎访问点（外壳单点 keydown 消费引擎钻取/选中层）。 */
    getEngine() {
      return engine;
    },
    /**
     * 聚焦飞行（add-cosmos-selection-linkage 3.3 / D1/D7）：面板点卡片的「带我去那颗星」
     * 入口——银河态/他星座钻取态钻入，同星座短补间重对焦（分派在引擎内）。
     * 引擎未挂载 / 目标缺失 / 星胚 → 静默降级返回 false：面板选中仍有效，动作目标不受影响。
     * @param {{wsId?: string, id?: string}} [target] 提案卡片的工作区 + 恒星 id
     * @returns {boolean} 引擎是否接受聚焦请求
     */
    focusProposal({ wsId, id } = {}) {
      return engine?.focusStar?.(wsId, id) === true;
    },
    /**
     * 会话行聚焦（add-cosmos-session-list-panel 3.1 / design D5）：点会话行 = 引擎选中联动
     * （不是直接开页）。分派在引擎内（`focusBody` 镜像 `focusStar`）：银河态/他星座钻取态
     * → dive 落地选中；同星座钻取态 → 选中 + 天体短补间重对焦。引擎未挂载 / 目标缺失 →
     * 静默降级返回 false（面板选中不因此改写，动作目标不受影响）。
     * @param {{wsId?: string, id?: string}} [target] 会话行的工作区 + 会话 id
     * @returns {boolean} 引擎是否接受聚焦请求
     */
    focusSession({ wsId, id } = {}) {
      return engine?.focusBody?.(wsId, id) === true;
    },
    /**
     * 宿主会话切换（polish-cosmos-session-focus-and-hover-markers 2.1）：复用官方
     * `uiWorkspace.openSession`（旧宿主回落 `ctx.sessions.open`）——**不关整页**，只把
     * 目标会话切为主壳当前会话（侧栏选中 / 主视图跟随）。官方 mainView 保留会清除
     * `completionUnread`，完成未读绿色随查看熄灭（无本地写）。
     * 独立窗口态无主壳会话页 → `openSessionVia` 返回 false（silent no-op）；通道缺失 /
     * 异常 → 捕获后返回 false（行选中联动不受影响）。
     * @param {string} sessionId 目标会话 id
     * @returns {boolean} 是否发起宿主切换
     */
    openSessionInPlace(sessionId) {
      try {
        /* 回声短路前置写入（add-cosmos-host-session-follow 1.3 / design D4）：镜像 + 哨兵
           MUST 早于切换动词——宿主换绑通知可能在动词内部**同步**抵达；未真正发起时回滚
           （净前进只发生在成功路径）。随后到达的同值通知被哨兵短路：无双补间。 */
        hostFollow?.noteOpenedSession?.(sessionId);
        const opened = openSessionVia(sessionId);
        hostFollow?.settleOpenedSession?.(opened === true);
        return opened;
      } catch (error) {
        hostFollow?.settleOpenedSession?.(false);
        console.warn("[dsh-v-cosmos] openSessionInPlace failed:", error);
        return false;
      }
    },
    /**
     * 外部悬停注入（p2-add-cosmos-cross-hover-markers 1.3）：面板行/卡 hover → 引擎
     * tips / 关联关系段（p1 `setExternalHover` 公共面）。引擎未挂载 / 已销毁 / 目标
     * 未命中 → 静默降级返回 false（面板侧标记呈现不受影响，纯展示层解耦）。
     * @param {{wsId?: string, kind?: string, id?: string}|null} desc 悬停描述；null = 清除
     * @returns {boolean} 引擎是否接受注入
     */
    setExternalHover(desc) {
      return engine?.setExternalHover?.(desc) === true;
    },
    /**
     * UI 铬件矩形发布（polish-cosmos-tip-ui-avoidance 2.3 / design D2）：页面组件在**布局
     * 事实变化**时把 chrome 矩形集转发引擎公共面（与 `setExternalHover` 同款可选链接线）。
     * 载荷 = 引擎容器坐标系矩形集 + 容器原点（client 已归一化，引擎只做数组比对）。
     * 引擎未挂载 / 已销毁 / 未升级 → 静默降级返回 false（页面渲染与浮签交互不受影响，
     * 避让退回「矩形契约缺席 = 现状回落」）。
     * @param {Array<{left:number, top:number, right:number, bottom:number, kind?:string}>} rects
     * @param {{x:number, y:number}} [origin] 引擎容器原点（窗口视口坐标）
     * @returns {boolean} 引擎是否接受发布
     */
    setUiChromeRects(rects, origin) {
      return engine?.setUiChromeRects?.({ rects, origin }) === true;
    },
    /** 当前合并场景（面板投影输入；版本由 sceneVersionStore 通知）。 */
    getScene() {
      return mergedScene;
    },
    attach(container) {
      if (engine || disposed || !container) return;
      /* 冷启动按已持久化皮肤构造（3.2）：MUST NOT 先默认后切（首帧闪跳）。HUD 令牌由
         整页 `useLayoutEffect` 与引擎构造同提交内先行下发（首帧同气）。 */
      const settings = loadCosmosSettings();
      const skin = createSkin(settings.skin);
      cosmosSkinStore.set({ skin: skin.skin });
      engine = createCosmosEngine({
        container,
        style: skin,
        settings, // 平移调参（settings.mjs 持久化面；后续设置 UI 经 saveCosmosSettings + setTuning 热更）
        onOpenSession: (sessionId) => actions.openSession(sessionId),
        /* 归档动作（add-cosmos-session-archive-action D4/3.3）：与 onOpenSession 同模式注入，
           整页保持打开；引擎以返回的 Promise 作为按钮在途窗口（D6）。 */
        onArchiveSession: (sessionId) => actions.archiveSession(sessionId),
        /* 星胚移除（add-cosmos-embryo-dismiss 4.1 / D5）：两击确认后的服务端动词出口，
           载荷 = 该星实体 `ws.id` 与 proto 星 `data.id`（锚点 slug）；整页保持打开（消散由
           既有骨架差分 + 星胚低强度消散变体承接）。 */
        onDismissEmbryo: (input) => actions.dismissEmbryo(input),
        /* 决策入口（cosmos-session-decide D6 / 5.3）：与 actions.openSession **同一条官方
           导航链路**——先关 Cosmos 整页 → `ctx.uiWorkspace.openSession`（旧宿主回落
           `ctx.sessions.open`）；决策选项与输入区由 DSH 原生 composer takeover 呈现，
           插件 MUST NOT 自建决策 UI。回调未注入时引擎侧静默 no-op（同既有守卫）。 */
        onDecideSession: (sessionId) => actions.openSession(sessionId),
        /* 信息卡文案注入（5.4 / cosmos-relation-focus D4）：locale DICT 同源，缺键回落
           引擎内中文基线（DICT 与引擎缺省逐字一致，宿主降级不改变呈现）。 */
        labels: {
          decide: {
            approval: tr("cosmos.card.decide.approval", "待批准"),
            "plan-review": tr("cosmos.card.decide.planReview", "计划待审"),
            question: tr("cosmos.card.decide.question", "待回答"),
            fallback: tr("cosmos.card.decide.other", "待决策")
          },
          vitality: {
            label: tr("cosmos.card.vitality", "活力"),
            active: tr("cosmos.card.vitality.active", "活跃"),
            sleep: tr("cosmos.card.vitality.sleep", "沉睡")
          },
          /* 星胚卡「移除星胚」按钮 + 内联确认态文案（add-cosmos-embryo-dismiss D9）：
             仅按钮文案进引擎；outcome toast 映射全在客户端执行体内（actions.dismissEmbryo）。 */
          dismiss: {
            remove: tr("cosmos.card.dismiss.remove", "移除星胚"),
            confirm: tr("cosmos.card.dismiss.confirm", "确认移除？")
          }
        },
        /* 钻取态 → React 面板（过滤/让位）；引擎是唯一权威，镜像只读。 */
        onDrillChange: (info) => drillStore.set(info),
        /* 引擎选中 → React 面板（add-cosmos-selection-linkage 3.1/D6）：同款幂等镜像通道，
           「视图里选中的恒星」据此映射回对应提案卡片。 */
        onSelectChange: (info) => engineSelectStore.set(info),
        /* 画布悬停 → React 面板（p2-add-cosmos-cross-hover-markers 1.1）：同款幂等镜像
           通道；载荷恒为画布指针拾取态（外部注入不回声，p1 契约）。 */
        onHoverChange: (info) => engineHoverStore.set(info),
        /* 拖拽平移开关写穿（add-cosmos-drag-pan-toggle 4.1/D4）：开关本体（引擎内右下按钮）
           即设置入口——引擎已本地翻转镜像与视觉，这里只负责持久化与热更回读的唯一链路：
           净房写盘 → `setTuning` 回读（值恒等，幂等无回环）。与 saveNav 同构，但不触达
           导航 store（该键无设置页控件，对照 sessionPanelOpen 先例）。 */
        onDragPanToggle: (enabled) => {
          const merged = saveCosmosSettings({ dragPan: enabled === true });
          engine?.setTuning(merged);
          return merged;
        },
        /* 浮窗打开态探针（add-cosmos-shortcuts 4.2/D13）：浮窗 armed 即 true——
           引擎 goHome/togglePan 分支据此模态让位（语音键与关闭键不在引擎侧，不受影响）。 */
        isFloatOpen: () => floatOpenOf()
      });
      if (mergedScene) engine.setScene(mergedScene, "rebuild");
      if (filterQuery.trim()) syncFilter(); // 重挂载保持当前查询（引擎落位 + 坡道续接）
      refreshSkeleton(); // 挂载即拉一次（SSE 重连/首次打开双保险）
      /* 队列快照与骨架同批拉取（spec「持久化与多窗口广播」：GET /queue 供页面加载对账）；
         之后由 `queue-changed` 轻帧驱动增量对账，MUST NOT 轮询。 */
      refreshQueue();
      if (open && visible) engine.start();
      /* 开页定位（add-cosmos-host-session-follow 3.1 / design D7）：每次开页执行——
         当前会话在册 → 同链路 focusBody；场景尚未就绪（mergedScene null）时保留，
         由首帧 rebuild 的 onSceneReady 消费。定位后同步哨兵防同值重放。 */
      hostFollow?.onPageAttach?.();
    },
    detach() {
      /* 页关闭期间的变化沿只记哨兵（引擎即将销毁）——撤销未消费的开页定位。 */
      hostFollow?.onPageDetach?.();
      engine?.dispose();
      engine = null;
      drillStore.set(null); // 引擎实例销毁 → 钻取镜像归零（面板恢复全量分组）
      engineSelectStore.set(null); // 引擎实例销毁 → 选中镜像归零（避免陈旧聚焦目标）
      engineHoverStore.set(null); // 引擎实例销毁 → 悬停镜像归零（避免陈旧关联标记）
    },
    setOpen(nextOpen) {
      open = nextOpen;
      if (!engine) return;
      if (open && visible) engine.start();
      else engine.stop(); // 整页关闭 → 渲染暂停（4.6）
    },
    setVisible(nextVisible) {
      visible = nextVisible;
      if (!engine) return;
      if (visible && open) engine.start();
      else engine.stop(); // 页签不可见 → 渲染暂停（4.6）
    },
    dispose() {
      disposed = true;
      clearPendingDive(); // 等待窗口定时器随实例销毁（MUST NOT 泄漏到 fiber 之外）
      hostFollow?.dispose?.(); // 跟随器：撤销待办 + 释放主源引用（订阅经 disposers 回收）
      for (const dispose of disposers) {
        try {
          dispose?.();
        } catch {
          /* ignore */
        }
      }
      if (rafHandle) cancelAnimationFrame(rafHandle);
      engine?.dispose();
      engine = null;
      drillStore.set(null);
      engineSelectStore.set(null);
      engineHoverStore.set(null);
    }
  };
}

/* ------------------------------------------------------------------ *
 * 页面帧左缘 = 侧栏右缘（hive usePageLeft 同款测量）
 * ------------------------------------------------------------------ */

function usePageLeft(frameRef, measuredRef) {
  const [left, setLeft] = useState(null);
  useEffect(() => {
    let ro = null;
    let raf = 0;
    let tries = 90;
    let disposed = false;
    let currentLeft = -1;
    const sidebarColumn = () => {
      try {
        const anchor = document.querySelector('[data-slot="sidebar"]');
        return anchor?.parentElement ?? null;
      } catch {
        return null;
      }
    };
    const apply = () => {
      const column = sidebarColumn();
      const overlay = frameRef.current?.closest("[data-shell-overlay]") ?? null;
      if (!column || !overlay) return false;
      const rect = column.getBoundingClientRect();
      const base = overlay.getBoundingClientRect();
      if (rect.width <= 0 && rect.height <= 0) return false;
      const next = Math.max(0, Math.round(rect.right - base.left));
      if (next !== currentLeft) {
        currentLeft = next;
        measuredRef.current = next;
        setLeft(next);
      }
      return true;
    };
    const scheduleApply = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = 0;
        apply();
      });
    };
    const tick = () => {
      if (disposed) return;
      if (apply()) {
        const column = sidebarColumn();
        if (column && typeof ResizeObserver !== "undefined") {
          ro = new ResizeObserver(scheduleApply);
          ro.observe(column);
        }
        window.addEventListener("resize", scheduleApply);
        return;
      }
      if (tries-- > 0) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener("resize", scheduleApply);
    };
  }, []);
  return left;
}

/* ------------------------------------------------------------------ *
 * 卡片任务进度条挂点（p1-add-cosmos-card-progress-bars 3.1/3.2）
 *
 * 会话行与正式提案卡共用：数据面只有 `progress = {done, total}`（projection 层产出，
 * 提案卡直取 tasks、会话行解析 todos 徽标），呈现层两条规则——
 *  - 双槽同数据：`strip`（满宽底部细条）与 `ring`（meta 行内 12px 小环）恒渲染同一份
 *    progress，**形状切换零 JS 分支**（skin-registry 下发根属性 `data-cos-progress`，
 *    CSS 决定显隐：segment/bar 显条、ring 显环）；
 *  - 上限退化：格数 = `min(total, 12)`，`total > 12` 时不渲染格子、只留单连续 span
 *    （分段在极限下即连续，语义不断裂——design D2）。
 * 条恒 `aria-hidden`（比例增强不新增读屏噪音），精确 `x/y` 仍由既有文本徽标承载。
 * ------------------------------------------------------------------ */

/**
 * 进度数据 → 轨道口径（纯函数；钳制防御，非法输入 → null 零布局）。
 * `percent` = 连续条宽度（= done/total，用于 bar 形态与 ring 填充角）；
 * `segmentCount` = 格数上限 `min(total, 12)`；`degraded` = 超上限退化连续条。
 */
function progressTrackOf(progress) {
  const total = Math.max(0, Math.round(Number(progress?.total) || 0));
  const done = Math.max(0, Math.min(total, Math.round(Number(progress?.done) || 0)));
  if (total <= 0) return null;
  return { done, total, percent: (done / total) * 100, segmentCount: Math.min(total, 12), degraded: total > 12 };
}

/**
 * 分段填充态（design D2 整格语义）：前 `done` 格整格主调色；第 `done+1` 格为进行中格
 * （低透明度 tint，静态无动效——进度条自身不做动效，动效语言只住在 p2 的卡描边层）；其余为空轨。
 * `done === 0` 时首格即进行中格（「进度为 0 也是信息」）。
 */
function progressSegmentFillOf(index, done) {
  if (index < done) return "done";
  return index === done ? "active" : "empty";
}

/** 满宽进度条槽位（会话行 main 按钮末位 / 提案卡末位；`progress` 为空 → 零布局）。 */
function ProgressStrip({ progress }) {
  const track = progressTrackOf(progress);
  if (!track) return null;
  const segments = [];
  if (!track.degraded) {
    for (let index = 0; index < track.segmentCount; index += 1) {
      segments.push(progressSegmentFillOf(index, track.done));
    }
  }
  return (
    <span
      className="dsh-cosmos-progress-strip"
      data-degraded={track.degraded ? "true" : undefined}
      aria-hidden="true"
    >
      {/* 连续条（bar 形态 / 退化路径）：单 span 宽度百分比。 */}
      <span className="dsh-cosmos-progress-fill" style={{ width: track.percent + "%" }} />
      {track.degraded ? null : (
        <span className="dsh-cosmos-progress-segs">
          {segments.map((fill, index) => (
            <span className="dsh-cosmos-progress-seg" data-fill={fill} key={index} />
          ))}
        </span>
      )}
    </span>
  );
}

/** meta 行内环形槽位（ring 形态；其余形态 CSS 隐藏）：填充角经内联数据值传 CSS。 */
function ProgressRing({ progress }) {
  const track = progressTrackOf(progress);
  if (!track) return null;
  return (
    <span
      className="dsh-cosmos-progress-ring"
      style={{ "--cos-prog-turn": track.percent + "%" }}
      aria-hidden="true"
    />
  );
}

/* ------------------------------------------------------------------ *
 * 提案列表面板（add-cosmos-proposal-actions 3.x）
 * ------------------------------------------------------------------ */

/**
 * 左侧提案列表面板：分组卡片（组标题 = 星座名）、四态色、tasks x/y、setBy/at 徽标。
 * 点击卡片 = 单选（不 dive）；面板是内容滚动区（原生滚动/文本选择），聚焦时 Esc 失焦
 * 且 MUST NOT 冒泡到外壳分层（不返回银河、不关页）。
 *
 * 三段结构（add-cosmos-constellation-actions D2）：`head + list + footer`。钻取态
 * （`data-drill`）下 footer 渲染星座动作条——空星座同样可用（列表空态与 footer 挂点解耦），
 * 按钮列表为空时 footer 不渲染（零布局）；银河态无「当前星座」即无动作目标，整条不渲染。
 *
 * 活跃度描边（p2-add-cosmos-card-state-chrome 2.1）：正式/星胚共用卡按钮，`data-act` 由
 * `card.act > 0` 单点门控，星胚卡显式排除——keep-embryo-active-while-exploring 起星胚 `act`
 * 也可为 1，属**数据面口径**（动作条前置状态门控消费），呈现面豁免保持不变
 * （p2 spec「星胚卡无活跃描边」：星胚卡的视觉语言仍是虚线「还没出生」）。
 */
function ProposalPanel({ t, model, selectedKey, onSelect, drill, constButtons, onRunConst, closeKey, crossHover, onHoverCard }) {
  if (!model || !model.visible) return null;
  const drilled = drill !== null && drill !== undefined;
  const showConstActions = drilled && Array.isArray(constButtons) && constButtons.length > 0;
  return (
    <aside
      className="dsh-cosmos-panel"
      data-drill={drilled ? "true" : undefined}
      data-plugin-anchor="dsh-v-cosmos:panel"
      aria-label={t("cosmos.panel.aria", "提案列表")}
    >
      <div className="dsh-cosmos-panel-head">
        <span className="dsh-cosmos-panel-title">{t("cosmos.panel.title", "提案")}</span>
        <span className="dsh-cosmos-panel-count" aria-hidden="true">{model.total}</span>
        {model.embryoTotal > 0 ? (
          /* 星胚附注徽标（add-cosmos-galaxy-embryo-cards D3）：主计数口径仍是「正式提案数」，
             星胚数独立附注（`embryoTotal === 0` 时不渲染）——避免头部「0」与组内星胚卡并置
             被读作缺陷。词典值是纯字符串（无插值引擎）→ 渲染处对 `{n}` 做**单次**替换。 */
          <span className="dsh-cosmos-panel-embryo-count" aria-hidden="true">
            {t("cosmos.panel.embryoCount", "＋{n} 星胚").replace("{n}", String(model.embryoTotal))}
          </span>
        ) : null}
      </div>
      <div
        className="dsh-cosmos-panel-list"
        tabIndex={0}
        onKeyDown={(event) => {
          /* 面板内关闭键 = 失焦：MUST NOT 触发钻取返回或关页（spec「面板内 Esc 失焦」）。
             键位跟随全局配置（add-cosmos-shortcuts 5.1/D3：面板失焦层同键）——经
             canonical 匹配（Shift/Meta 裁决、Ctrl/Alt 精确），组字中让位输入法。
             焦点可能落在卡片按钮或列表容器自身——统一对 document.activeElement 失焦。 */
          if (event.isComposing === true || event.keyCode === 229) return;
          if (!shortcutMatches(event, closeKey ?? "Escape")) return;
          event.preventDefault();
          event.stopPropagation();
          const active = typeof document !== "undefined" ? document.activeElement : null;
          if (active && typeof active.blur === "function") active.blur();
          if (typeof event.currentTarget.blur === "function") event.currentTarget.blur();
        }}
      >
        {model.groups.length === 0 ? (
          <div className="dsh-cosmos-panel-empty">{t("cosmos.panel.noMatch", "无匹配提案")}</div>
        ) : null}
        {model.groups.map((group) => (
          <section className="dsh-cosmos-panel-group" key={group.wsId} data-cosmos-ws={group.wsId}>
            <h3 className="dsh-cosmos-panel-group-title" title={group.wsPath || group.wsName}>
              {group.wsName}
            </h3>
            {group.cards.length === 0 ? (
              <div className="dsh-cosmos-panel-empty">
                {drilled ? t("cosmos.panel.emptyConstellation", "该星座暂无提案") : t("cosmos.panel.noMatch", "无匹配提案")}
              </div>
            ) : (
              group.cards.map((card) => (
                <button
                  type="button"
                  key={card.key}
                  className="dsh-cosmos-panel-card"
                  data-cosmos-proposal={card.id}
                  data-cosmos-ws={card.wsId}
                  data-lifecycle={card.lifecycle}
                  data-embryo={card.isEmbryo ? "true" : undefined}
                  /* 星胚卡不参与活跃度描边（p2 spec「星胚卡无活跃描边」）：星胚 `act`
                     （锚点探索会话活跃度）只作数据面口径供动作条门控消费，呈现面豁免
                     保持不变——虚线「还没出生」语义优先。 */
                  data-act={card.act > 0 && !card.isEmbryo ? "active" : undefined}
                  data-selected={card.key === selectedKey ? "true" : undefined}
                  /* 跨面板悬停关联标记（p2-add-cosmos-cross-hover-markers 3.1/3.2）：
                     受体卡（正式卡按 id、星胚合并卡任一 slug 命中即整卡）呈现 `>`；源卡
                     自身由派生口径排除。装饰走 CSS ::after，零新增 DOM、不改卡片语义。 */
                  data-linked={cardIsLinkedOf(crossHover, card) ? "true" : undefined}
                  onMouseEnter={() => onHoverCard?.(card, true)}
                  onMouseLeave={() => onHoverCard?.(card, false)}
                  aria-pressed={card.key === selectedKey}
                  title={card.isEmbryo ? card.slugs.join("\n") : card.dir || card.name}
                  onClick={() => onSelect(card.key)}
                >
                  {card.isEmbryo ? (
                    /* 星胚合并卡片（add-cosmos-embryo-cards 3.3）：虚线描边 + proto 语义色
                       （CSS `[data-embryo]`）+「星胚」徽标 + slug 逐行清单 + at 时间徽标；
                       MUST 无提案名行与任务进度行，MUST NOT 携带 dir。 */
                    <>
                      <span className="dsh-cosmos-embryo-slugs">
                        {card.slugs.map((slug) => (
                          <span className="dsh-cosmos-embryo-slug" key={slug}>{slug}</span>
                        ))}
                      </span>
                      <span className="dsh-cosmos-panel-meta">
                        <span className="dsh-cosmos-panel-badge dsh-cosmos-panel-badge-embryo">
                          {t("cosmos.panel.embryo", "星胚")}
                        </span>
                        {card.at ? <span className="dsh-cosmos-panel-at">{relativeTime(card.at, Date.now())}</span> : null}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="dsh-cosmos-panel-name">{card.name}</span>
                      <span className="dsh-cosmos-panel-meta">
                        {card.tasks[1] > 0 ? (
                          <span className="dsh-cosmos-panel-tasks">{card.tasks[0] + "/" + card.tasks[1]}</span>
                        ) : null}
                        {/* 进度条环形槽位（ring 皮肤；其余形态 CSS 隐藏）——精确数字仍由
                            左侧 `x/y` 文本徽标承载（条为比例增强，非数字替代）。 */}
                        <ProgressRing progress={card.progress} />
                        {card.setBy ? (
                          <span className="dsh-cosmos-panel-badge" title={t("cosmos.panel.setBy", "落章来源")}>
                            {card.setBy}
                          </span>
                        ) : null}
                        {card.at ? <span className="dsh-cosmos-panel-at">{relativeTime(card.at, Date.now())}</span> : null}
                      </span>
                      {/* 卡底满宽进度条（正式提案专属）：卡内末位子元素；星胚卡分支零接入
                          （`progress` 恒 null，组件自然零布局——spec 星胚无任务进度行纪律）。 */}
                      <ProgressStrip progress={card.progress} />
                    </>
                  )}
                </button>
              ))
            )}
          </section>
        ))}
      </div>
      {showConstActions ? <ConstActionBar t={t} buttons={constButtons} onRun={onRunConst} /> : null}
    </aside>
  );
}

/* ------------------------------------------------------------------ *
 * 会话列表面板（add-cosmos-session-list-panel 2.x/3.x）
 * ------------------------------------------------------------------ */

/**
 * 待处理分类 → 文案键（DSH 会话行 `status.compact.*` / `status.waiting*` 的**同源镜像**；
 * spike 实证见 openspec/changes/add-cosmos-session-list-panel/walkthrough.md）。
 * approval→待审批 / plan→计划待审 / question→待回答：与宿主侧栏行尾注逐字一致。
 */
const SESSION_PENDING_TEXT = {
  approval: ["cosmos.sessions.pending.approval", "待审批"],
  plan: ["cosmos.sessions.pending.plan", "计划待审"],
  question: ["cosmos.sessions.pending.answer", "待回答"],
  other: ["cosmos.sessions.pending.other", "待处理"]
};

/** 待处理分类 → 悬停完整状态文案键（DSH `status.waiting*` 同源镜像）。 */
const SESSION_PENDING_STATUS = {
  approval: ["cosmos.sessions.status.approval", "等待审批"],
  plan: ["cosmos.sessions.status.plan", "计划待审"],
  question: ["cosmos.sessions.status.answer", "等待回答"],
  other: ["cosmos.sessions.status.other", "等待处理"]
};

/** 待处理期间替换尾注的分类文案（approval/plan/question/other 防御兜底）。 */
function sessionPendingTextOf(tr, category) {
  const entry = SESSION_PENDING_TEXT[category] ?? SESSION_PENDING_TEXT.other;
  return tr(entry[0], entry[1]);
}

/** 悬停 title 的完整状态文案（DSH 口径：完整状态 + 相对时间；待机也给出语义）。 */
function sessionStatusTextOf(tr, row) {
  if (row.state === "waiting") {
    const entry = SESSION_PENDING_STATUS[row.pendingKind] ?? SESSION_PENDING_STATUS.other;
    return tr(entry[0], entry[1]);
  }
  if (row.state === "busy") {
    return row.delegatedBusy
      ? tr("cosmos.sessions.status.delegated", "子代理执行中")
      : tr("cosmos.sessions.status.busy", "执行中");
  }
  if (row.state === "done-unread") return tr("cosmos.sessions.status.done", "已完成（未读）");
  return tr("cosmos.sessions.status.idle", "待机");
}

/**
 * 单会话行（形态标记 + 状态点/loader + 标题 + todos/卫星徽标 + 尾注）。
 * 行主体 = 选中联动按钮（不关页）；「打开」= 官方导航链路（关整页 → 切会话页）；
 * 「归档」= 既有归档执行链路的行内入口（add-cosmos-session-row-archive D1：只转发，
 * 不组装请求、不感知端点）——三个职责分属三个按钮，点击行 MUST NOT 直接关闭整页
 * （spec「选中联动与打开链路」「会话行归档动作呈现」）。
 */
function SessionRow({ t, row, selected, onSelect, onOpen, onArchive, linked, onHover }) {
  const pending = row.state === "waiting";
  const title = sessionStatusTextOf(t, row) + " · " + row.when;
  /* 行级防重入门禁（add-cosmos-session-row-archive D2）：每行组件内 in-flight 布尔。
     行按会话键（`row.key`）作 React key，跨场景增量刷新组件身份稳定 → 组件状态即天然
     per-session 门（无需全局 Map）；归档成功后行随场景刷新卸载，状态自然清理。
     门禁口径与信息卡一致：只拦本行「归档」重复请求，**不拦**该行「打开」与行选中。 */
  const [archiving, setArchiving] = useState(false);
  /* 活跃门禁 + 按态说明文案（add-cosmos-session-archive-busy-gate 2.1/D1/D2）：
     busy（投影已折入 delegatedBusy）与 waiting 禁用——与行状态文字/loader 同源零二次推导；
     done-unread/idle 恒可点（done-unread 正是归档主要清扫对象）。两门正交叠加（D4）：
     在途门（archiving）与活跃门声明式组合，随 props 重算，无直接 DOM 覆写面。
     `aria-busy` 语义仍只随「归档请求在途」（瞬态请求态），活跃门是持续状态态、不加。 */
  const archiveDisabled = archiving || row.state === "busy" || row.state === "waiting";
  const archiveTitle = row.state === "busy"
    ? t("cosmos.sessions.archiveBusy", "执行中，暂不可归档")
    : row.state === "waiting"
      ? t("cosmos.sessions.archiveWaiting", "待决策中，暂不可归档")
      : t("cosmos.sessions.archiveAria", "归档会话");
  const archiveRow = (event) => {
    /* 只归档不选中（D4）：点击不冒泡到行主体/整页点击处理器（选中态零副作用）。 */
    event.stopPropagation();
    if (archiving) return; // 双保险：按钮 disabled 已挡点击，状态滞后窗口也不重入
    setArchiving(true);
    const settle = () => setArchiving(false);
    let issued;
    try {
      issued = onArchive?.(row);
    } catch (error) {
      console.warn("[dsh-v-cosmos] archive session row failed:", error);
      settle();
      return;
    }
    /* 请求结束（无论 outcome）复位：`Promise.resolve` 归一让控制器缺席返回的 undefined
       也照常复位；两个 settle 句柄（而非 finally）避免意外 reject 留未处理拒绝。 */
    Promise.resolve(issued).then(settle, settle);
  };
  return (
    <div
      className="dsh-cosmos-session-row"
      data-state={row.state}
      data-kind={row.kind}
      data-selected={selected ? "true" : undefined}
      /* 跨面板悬停关联标记（p2-add-cosmos-cross-hover-markers 3.1）：受体行呈现 `<`；
         源行自身由派生口径排除（`:hover` 底色已表达）。鼠标事件单点绑在行容器——
         行内「打开」「归档」按钮 hover 穿透，不重复绑定。 */
      data-linked={linked ? "true" : undefined}
      data-cosmos-session={row.id}
      data-cosmos-ws={row.wsId}
      onMouseEnter={() => onHover?.(row, true)}
      onMouseLeave={() => onHover?.(row, false)}
    >
      <button
        type="button"
        className="dsh-cosmos-session-main"
        aria-pressed={selected}
        title={title}
        onClick={() => onSelect(row)}
      >
        <span className="dsh-cosmos-session-line">
          <span className="dsh-cosmos-session-lead" data-state={row.state} aria-hidden="true">
            {row.state === "busy"
              ? <span className="dsh-cosmos-session-loader" />
              : row.state === "idle" ? null : <span className="dsh-cosmos-session-dot" />}
          </span>
          {/* 形态标记：● 行星（有关联提案）/ ☄ 彗星（自由会话）——与星座内隐喻同源。 */}
          <span className="dsh-cosmos-session-kind" aria-hidden="true">{row.kind === "planet" ? "●" : "☄"}</span>
          <span className="dsh-cosmos-session-title">{row.title}</span>
        </span>
        <span className="dsh-cosmos-session-meta">
          {row.todos !== "—" ? (
            <span className="dsh-cosmos-session-todo" title={t("cosmos.sessions.todos", "任务进度")}>{row.todos}</span>
          ) : null}
          {/* 进度条环形槽位（ring 皮肤；其余形态 CSS 隐藏）——与行底满宽条同数据双槽。 */}
          <ProgressRing progress={row.progress} />
          {row.satelliteCount > 0 ? (
            <span className="dsh-cosmos-session-sats" title={t("cosmos.sessions.satellites", "子代理会话")}>
              {"◇" + row.satelliteCount}
            </span>
          ) : null}
          {/* 待处理期间以分类文案替换相对时间（DSH 口径）；悬停 title 保留完整状态 + 时间。 */}
          <span className="dsh-cosmos-session-trailing" data-state={row.state}>
            {pending ? sessionPendingTextOf(t, row.pendingKind) : row.when}
          </span>
        </span>
        {/* 行底满宽进度条：main 按钮内末位可视子元素（flex-column 自然落位，不触碰 meta 行
            与行内「打开/归档」按钮区）；`progress` 为空（"—"/畸形串）时组件零布局。 */}
        <ProgressStrip progress={row.progress} />
        {/* 屏幕阅读器状态标签（DSH 行同款：视觉隐藏，语义不丢） */}
        <span className="dsh-cosmos-session-sr">{sessionStatusTextOf(t, row)}</span>
      </button>
      <button
        type="button"
        className="dsh-cosmos-session-open"
        aria-label={t("cosmos.sessions.openAria", "打开会话")}
        title={t("cosmos.sessions.openAria", "打开会话")}
        onClick={() => onOpen(row)}
      >
        {t("cosmos.sessions.open", "打开")}
      </button>
      {/* 行内「归档」常显图标钮（add-cosmos-session-row-archive 2.1/2.2）：恒居动作区末位
          （「打开」之后，与信息卡「归档会话恒居末位」纪律同源）；`data-action="archive"`
          为程序化分流钩子（`data-session` 为信息卡专有，行内不引入），行容器既有
          `data-cosmos-session` 供程序化定位。在途禁用 + `aria-busy`（行级门禁 D2）；
          活跃门禁 + 按态 title/aria-label 随 `archiveDisabled`/`archiveTitle` 声明式切换
          （add-cosmos-session-archive-busy-gate 2.1，spec「活跃会话归档入口禁用」）。 */}
      <button
        type="button"
        className="dsh-cosmos-session-archive"
        data-action="archive"
        aria-label={archiveTitle}
        title={archiveTitle}
        aria-busy={archiving || undefined}
        disabled={archiveDisabled}
        onClick={archiveRow}
      >
        <span className="dsh-cosmos-session-archive-icon" aria-hidden="true">▣</span>
      </button>
    </div>
  );
}

/**
 * 左缘会话列表面板（spec cosmos-session-list）：
 *  - 面板恒渲染于左缘：展开态 = 标题栏 + 会话清单，折叠态 = 贴左缘竖向窄条（约 48px、
 *    整列高度；仅顶部 `>>` 按钮 + 待处理徽标，无横向标题条/「会话」文字/作用域计数；
 *    清单区隐藏）；
 *  - 开合唯一控制点 = 同一按钮：展开态在标题栏内（`<<`）、折叠态在竖条顶部（`>>`），
 *    `aria-expanded` 随态；无左缘把手等第二控件；
 *  - 待处理计数徽标随态呈现（`waiting > 0` 才渲染；全量 waiting 口径，折叠态为唯一
 *    可见性提示）；
 *  - 展开态 = 左缘浮层（overlay 式，MUST NOT 挤压画布——不参与布局流，引擎 host 尺寸不变）；
 *  - 银河态 = 全部活跃会话按星座分组（组头 = 星座名 + 会话数）；钻取态 = 仅当前星座
 *    （无会话仍保留分组标题 + 空态）；全无会话时银河态呈现空态提示（清单元件保留）。
 * 数据全部来自 `projectSessionPanel` 纯函数投影（零二次推导）；本组件只负责呈现与转发
 * 三个动作：点行 = `onSelect`（引擎选中联动）、「打开」= `onOpen`（官方导航链路）、
 * 「归档」= `onArchive`（既有归档执行链路，整页保持打开）。
 */
function SessionPanel({ t, model, open, selectedKey, drill, waiting, onToggle, onSelect, onOpen, onArchive, crossHover, onHoverRow }) {
  const drillActive = drill !== null && drill !== undefined;
  const emptyText = drillActive
    ? t("cosmos.sessions.emptyConstellation", "该星座暂无会话")
    : t("cosmos.sessions.emptyGalaxy", "暂无活跃会话");
  /* 标题栏开合按钮的随态文案（同一 DOM 节点翻转；spec「标题栏按钮开合」）。 */
  const toggleAria = open
    ? t("cosmos.sessions.collapse", "收起会话面板")
    : t("cosmos.sessions.handleAria", "展开会话列表");
  return (
    <aside
      className="dsh-cosmos-sessions"
      data-collapsed={open ? undefined : "true"}
      data-drill={drillActive ? "true" : undefined}
      data-plugin-anchor="dsh-v-cosmos:sessions"
      aria-label={t("cosmos.sessions.aria", "会话列表")}
    >
      {/* 开合唯一控制点 = 同一按钮：展开态在标题栏右侧 `<<`（收起），折叠态在竖条顶部
          `>>`（展开）；折叠态标题/计数隐藏，仅按钮 + 待处理徽标（用户图像修订）。 */}
      <div className="dsh-cosmos-sessions-head">
        <span className="dsh-cosmos-sessions-title">{t("cosmos.sessions.title", "会话")}</span>
        <span className="dsh-cosmos-sessions-count" aria-hidden="true">{model.scopeTotal}</span>
        {waiting > 0 ? (
          <span
            className="cos-sessions-waiting"
            title={t("cosmos.sessions.waitingBadge", "待处理会话") + " " + waiting}
          >{waiting}</span>
        ) : null}
        <button
          type="button"
          className="cos-sessions-toggle"
          data-cosmos-sessions-toggle="true"
          aria-expanded={open}
          aria-label={toggleAria}
          title={toggleAria}
          onClick={onToggle}
        >
          <span className="cos-sessions-toggle-glyph" aria-hidden="true">{open ? "<<" : ">>"}</span>
        </button>
      </div>
      {/* 清单区恒挂载、折叠态由 CSS（[data-collapsed=true]）隐藏：滚动位置跨开合保留，
          `display:none` 同时把清单移出 tab 序与可访问性树。 */}
      <div className="dsh-cosmos-sessions-list">
        {model.groups.length === 0 ? (
          <div className="dsh-cosmos-sessions-empty">{emptyText}</div>
        ) : (
          model.groups.map((group) => (
            <section className="dsh-cosmos-session-group" key={group.wsId} data-cosmos-ws={group.wsId}>
              <h3 className="dsh-cosmos-session-group-title" title={group.wsName}>
                <span className="dsh-cosmos-session-group-name">{group.wsName}</span>
                <span className="dsh-cosmos-session-group-count" aria-hidden="true">{group.count}</span>
              </h3>
              {group.sessions.length === 0 ? (
                <div className="dsh-cosmos-sessions-empty">{emptyText}</div>
              ) : (
                group.sessions.map((row) => (
                  <SessionRow
                    key={row.key}
                    t={t}
                    row={row}
                    selected={row.key === selectedKey}
                    onSelect={onSelect}
                    onOpen={onOpen}
                    onArchive={onArchive}
                    linked={rowIsLinkedOf(crossHover, row)}
                    onHover={onHoverRow}
                  />
                ))
              )}
            </section>
          ))
        )}
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ *
 * 自动执行队列面板（add-cosmos-action-queue 5.2 / design D7 /
 * spec cosmos-action-queue「队列呈现（面板与配套入队钮）」「条目操作矩阵与复验跳过」）
 * ------------------------------------------------------------------ */

/** 清空确认的回弹窗口（与星胚移除两击确认同量级：约 3s 无操作回弹初始态）。 */
const QUEUE_CLEAR_CONFIRM_MS = 3000;

/**
 * 提案面板左邻的**自动队列**窄面板（同宽、同视觉语言：风格 D 暖金描边 + 角标）。
 *
 * 呈现契约：
 *  - **零布局**：`model.visible !== true`（空队列）→ `return null`——无占位、无空态行
 *    （spec「空队列零布局」：页面 MUST NOT 出现任何占位布局变化）；
 *  - 作用域（显式设计决策，见 panel.mjs `queueScopeOf`）：**钻取态恒显示钻取星座**；
 *    **银河态随选中提案所属星座**显示（队列面板是动作条配套面：无选中即无动作目标，
 *    也就没有该显示的队列）。组件只消费投影，不自行推导作用域（数据面单点在父组件）；
 *  - 头部：`自动队列` + 在途计数（`counts.active` = queued+launching+executing）+
 *    执行指示点（`data-indicator`：running = 呼吸点 / waiting = 琥珀，复用会话行
 *    waiting 视觉语言）+ `⏸/▶`（暂停/继续，图标随态）+ `✕`（清空）；
 *  - 清空**一次确认**（spec「清空 SHALL 经一次确认」）：面板内两击确认（armed 态）——
 *    首击按钮提亮 + 文案变「确认」，约 3s 无操作回弹；**不用 `window.confirm`**——整页
 *    覆盖层内的原生模态会夺焦点并冻结引擎渲染循环，且与既有星胚移除的两击确认语言
 *    不一致。清空只清 queued 与终态残留、executing 保留（由服务端保证，前端不重复判定）；
 *  - 条目行：按钮名 + 提案名（溢出省略）+ 状态徽标（`data-badge`）；hover / 键盘聚焦
 *    浮出 `▲`/`▼`/`✕`（非 queued 或边界禁用 + title 说明，与操作矩阵同口径）；
 *    `executing`（含等待决策）条目**全部禁用**（v1 无中止入口，spec「条目操作矩阵」）；
 *  - 失败 / 跳过残留行显示诊断摘要（`failedDetail`），可移出、可清空；
 *  - 条目 hover → 父组件接 cross-hover（与正式提案卡同款联动，spec「队列条目联动
 *    提案卡」）；行容器另按受体集呈现 `>` 标记（复用 `cardIsLinkedOf` 受体判定）。
 */
function QueuePanel({ t, model, drilled, crossHover, onPause, onClear, onReorder, onRemove, onHoverEntry }) {
  const [clearArmed, setClearArmed] = useState(false);
  const clearTimerRef = useRef(0);
  const modelVisible = model !== null && model !== undefined && model.visible === true;
  /** 确认态复位（幂等；同时清掉回弹定时器）。 */
  const disarmClear = () => {
    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = 0;
    }
    setClearArmed((current) => (current ? false : current));
  };
  /* 卸载清理：回弹定时器随组件销毁（MUST NOT 泄漏到整页之外）。 */
  useEffect(() => () => {
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    clearTimerRef.current = 0;
  }, []);
  /* 队列离屏（全部移出 / 清空 / 作用域切换）→ 确认态复位：避免下次出现时已处于
     armed（两击确认的语义前提是「这一眼看到的两击」，spec「误触清空不可恢复」）。 */
  useEffect(() => {
    if (!modelVisible) disarmClear();
  }, [modelVisible]);
  /* 空队列整面板不渲染（零布局）；hooks 已在 return 之前无条件调用完毕。 */
  if (!modelVisible) return null;
  const pauseTitle = model.paused
    ? t("cosmos.queue.resume", "继续队列")
    : t("cosmos.queue.pause", "暂停队列");
  const clearTitle = clearArmed
    ? t("cosmos.queue.clearConfirm", "再次点击确认清空")
    : t("cosmos.queue.clear", "清空队列（执行中条目保留）");
  const handleClear = () => {
    if (clearArmed) {
      disarmClear();
      onClear?.(model.wsId);
      return;
    }
    setClearArmed(true);
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    clearTimerRef.current = setTimeout(() => {
      clearTimerRef.current = 0;
      setClearArmed(false);
    }, QUEUE_CLEAR_CONFIRM_MS);
  };
  return (
    <aside
      className="dsh-cosmos-queue"
      data-drill={drilled ? "true" : undefined}
      data-paused={model.paused ? "true" : undefined}
      data-plugin-anchor="dsh-v-cosmos:queue"
      aria-label={t("cosmos.queue.aria", "自动队列")}
    >
      <div className="dsh-cosmos-queue-head">
        <span className="dsh-cosmos-queue-title">{t("cosmos.queue.title", "自动队列")}</span>
        <span
          className="dsh-cosmos-queue-count"
          title={t("cosmos.queue.countTitle", "在途条目数（等待 + 执行中）")}
          aria-hidden="true"
        >{model.counts.active}</span>
        {model.indicator ? (
          <span
            className="dsh-cosmos-queue-dot"
            data-indicator={model.indicator}
            title={model.indicator === "waiting"
              ? t("cosmos.queue.indicatorWaiting", "有会话等待决策")
              : t("cosmos.queue.indicatorRunning", "队列执行中")}
            aria-hidden="true"
          />
        ) : null}
        {model.paused ? (
          <span className="dsh-cosmos-queue-paused">{t("cosmos.queue.paused", "已暂停")}</span>
        ) : null}
        {/* 恒自动发送标注（spec「队列执行恒自动发送」：条目呈现标注；不占行内宽度）。 */}
        <span
          className="dsh-cosmos-queue-auto"
          title={t("cosmos.queue.autoTitle", "队列执行恒为自动发送：不打开会话、不写草稿")}
        >{t("cosmos.queue.auto", "自动发送")}</span>
        <button
          type="button"
          className="dsh-cosmos-queue-pause"
          data-cosmos-queue-pause="true"
          aria-label={pauseTitle}
          title={pauseTitle}
          onClick={() => onPause?.(model.wsId)}
        >{model.paused ? "▶" : "⏸"}</button>
        <button
          type="button"
          className="dsh-cosmos-queue-clear"
          data-cosmos-queue-clear="true"
          data-armed={clearArmed ? "true" : undefined}
          aria-label={clearTitle}
          title={clearTitle}
          onClick={handleClear}
        >{clearArmed ? t("cosmos.queue.confirm", "确认") : "✕"}</button>
      </div>
      <div className="dsh-cosmos-queue-list">
        {model.rows.map((row) => (
          <div
            className="dsh-cosmos-queue-row"
            key={row.rowKey}
            data-state={row.state}
            data-badge={row.badgeKey}
            data-locked={row.locked ? "true" : undefined}
            data-cosmos-queue={row.id}
            data-cosmos-ws={row.wsId}
            data-linked={row.proposalId && cardIsLinkedOf(crossHover, { wsId: row.wsId, id: row.proposalId }) ? "true" : undefined}
            title={row.rowTitle}
            onMouseEnter={() => onHoverEntry?.(row, true)}
            onMouseLeave={() => onHoverEntry?.(row, false)}
          >
            <span className="dsh-cosmos-queue-main">
              <span className="dsh-cosmos-queue-name">{row.buttonName || row.proposalId}</span>
              <span className="dsh-cosmos-queue-proposal">{row.proposalId}</span>
              {/* 失败 / 跳过残留的可见诊断行（spec「留下可见记录」）：无诊断时零布局。 */}
              {row.failedDetail ? (
                <span className="dsh-cosmos-queue-detail">{row.failedDetail}</span>
              ) : null}
            </span>
            <span className="dsh-cosmos-queue-badge" data-badge={row.badgeKey}>{row.badgeLabel}</span>
            <span className="dsh-cosmos-queue-ops">
              <button
                type="button"
                className="dsh-cosmos-queue-op"
                data-cosmos-queue-op="up"
                aria-label={t("cosmos.queue.moveUp", "前移")}
                title={row.orderTitle}
                disabled={!row.canMoveUp}
                onClick={() => onReorder?.(row, "up")}
              >▲</button>
              <button
                type="button"
                className="dsh-cosmos-queue-op"
                data-cosmos-queue-op="down"
                aria-label={t("cosmos.queue.moveDown", "后移")}
                title={row.orderTitle}
                disabled={!row.canMoveDown}
                onClick={() => onReorder?.(row, "down")}
              >▼</button>
              <button
                type="button"
                className="dsh-cosmos-queue-op"
                data-cosmos-queue-op="remove"
                aria-label={t("cosmos.queue.remove", "移出队列")}
                title={row.removeTitle}
                disabled={!row.canRemove}
                onClick={() => onRemove?.(row)}
              >✕</button>
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ *
 * 星座动作条（add-cosmos-constellation-actions 3.1；面板 footer）
 * ------------------------------------------------------------------ */

/**
 * 星座动作条：面板底部（footer）的一组等宽按钮，超出面板宽度自动换行；与页面底部
 * 提案动作条同视觉语言（风格 D HUD：暖金描边 + 角标；配色优先官方 `--dsw-alias-*`
 * token，token 缺席时回落风格 D 基线），触屏点击目标 ≥40px。
 *
 * 与底部动作条的**刻意差异**：不依赖提案选中态（`disabled` 恒无）；仅钻取态挂载
 * （银河态无唯一当前星座 = 无动作目标）。按钮 key 稳定（内容差分守卫：覆盖层刷新
 * 不逐帧重建按钮 DOM）。
 */
function ConstActionBar({ t, buttons, onRun }) {
  if (!Array.isArray(buttons) || buttons.length === 0) return null;
  return (
    <div
      className="dsh-cosmos-const-actions"
      data-cosmos-const-actions="true"
      role="group"
      aria-label={t("cosmos.constActions.aria", "星座动作")}
    >
      {buttons.map((button, index) => (
        <button
          type="button"
          key={button.name + "-" + index}
          className="dsh-cosmos-const-action"
          data-cosmos-const-action={button.name}
          title={button.prompt || button.name}
          onClick={() => onRun(button)}
        >
          <span className="dsh-cosmos-const-label">{button.name}</span>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 底部动作按钮条（add-cosmos-proposal-actions 4.1）
 * ------------------------------------------------------------------ */

/**
 * 页面正下方居中的动作按钮条：一行 8 个等宽、超出自动换行（上限 32 = 4 行），
 * 左右安全边距避开左下「＋」与右下「回到银河」；无选中提案时整体禁用（熄灭），
 * 选中后 `data-armed="true"` 点亮（暖金描边 + 微辉光）。
 * 滚轮缩放由外层（页面）经 ref 绑定非被动监听转发 `engine.zoomBy`（动作条非滚动区；
 * 携带指针原始坐标 → 引擎侧换算后参与聚焦收敛，缩放按钮仍无坐标、保持屏心）。
 */
/**
 * 页面正下方居中的动作按钮条：一行 8 个等宽、超出自动换行（上限 32 = 4 行），
 * 左右安全边距避开左下「＋」与右下「回到银河」；无选中提案时整体禁用（熄灭），
 * 选中后 `data-armed="true"` 点亮（暖金描边 + 微辉光）。
 *
 * `stateOf(button)` 为可选的**行级禁用/提示**解析（add-cosmos-action-prestate-gate 3.1）：
 * 星胚按钮在旧锚点（无 `sessionId`）时呈禁用 + title 说明，不满足时缺省（仅受整体 enabled）。
 *
 * `onEnqueue(button)` / `enqueueStateOf(button)` 为**配套入队钮**（add-cosmos-action-queue
 * 5.3 / design D7，按用户反馈改版为**同尺寸成对**）：每个主按钮右侧配一个与主按钮
 * **完全同宽同高**的「＋ 入队」按钮（`.dsh-cosmos-action-pair` 内 1fr 1fr 两列），一对
 * 占原动作条一个列宽×2；每行最多 4 对（= 原 8 列满宽，动作条最大宽度不变），仅随对数
 * 换行。迷你钮与主按钮**同批**（同一 map、同一 preState 过滤后列表）、同禁用门
 * （无选中 / 行级禁用 / 已排队 / 请求在途）。入队不是执行：点击只转发 `onEnqueue`，
 * MUST NOT 触碰 `onRun`、导航、草稿或动作条点击冷却门。
 *
 * 滚轮缩放由外层（页面）经 ref 绑定非被动监听转发 `engine.zoomBy`（动作条非滚动区；
 * 携带指针原始坐标 → 引擎侧换算后参与聚焦收敛，缩放按钮仍无坐标、保持屏心）。
 */
function ActionBar({ t, buttons, enabled, onRun, barRef, stateOf, onEnqueue, enqueueStateOf }) {
  if (!Array.isArray(buttons) || buttons.length === 0) return null;
  /* 成对布局（按用户反馈改版）：每个动作按钮右侧配一个**完全同尺寸**的「＋ 入队」按钮，
     一对占一个网格单元；每行最多 4 对（= 原 8 列的满宽），动作条最大宽度不变。 */
  const columns = Math.min(4, buttons.length);
  return (
    <div
      ref={barRef}
      className="dsh-cosmos-actions"
      data-cosmos-actions="true"
      data-armed={enabled ? "true" : undefined}
      role="group"
      aria-label={t("cosmos.actions.aria", "提案动作")}
      style={{ "--cos-cols": String(columns) }}
    >
      {buttons.map((button, index) => {
        const extra = typeof stateOf === "function" ? stateOf(button) : null;
        const disabled = !enabled || extra?.disabled === true;
        /* 配套入队钮门控（spec「配套钮与主按钮同门控」）：与主按钮同一批（同一 map /
           同一 preState 过滤列表）→ 同显隐同启用基线；额外只叠「已在队列中」与
           「请求在途」两条（重复入队拒绝的前端禁用先行，服务端 400 兜底）。 */
        const enqueue = typeof enqueueStateOf === "function" ? enqueueStateOf(button) : null;
        const enqueueDisabled = disabled || enqueue?.disabled === true;
        const enqueueTitle = enqueue?.title || t("cosmos.actions.enqueue", "加入自动队列");
        return (
          /* 成对容器（add-cosmos-action-queue 5.3 改版）：主按钮与「＋ 入队」各占一半
             （网格 1fr 1fr → 两钮完全同宽同高），整对占原动作条一个列宽×2；不独立换行，
             行高与单按钮一致（仅随总对数换行）。 */
          <span className="dsh-cosmos-action-pair" key={button.name + "-" + index}>
            <button
              type="button"
              className="dsh-cosmos-action"
              data-cosmos-action={button.name}
              title={extra?.title || button.prompt || button.name}
              disabled={disabled}
              onClick={() => onRun(button)}
            >
              <span className="dsh-cosmos-action-label">{button.name}</span>
            </button>
            <button
              type="button"
              className="dsh-cosmos-enqueue"
              data-cosmos-enqueue={button.name}
              title={enqueueTitle}
              aria-label={enqueueTitle}
              disabled={enqueueDisabled}
              onClick={(event) => {
                /* 入队不是执行：阻止冒泡/默认行为（不触发整页点击面与表单语义），只转发
                   `onEnqueue`——MUST NOT 调 `onRun`、MUST NOT 导航、MUST NOT 触碰
                   动作条点击冷却门（add-cosmos-action-queue spec「入队链路」）。 */
                event.stopPropagation();
                event.preventDefault();
                if (enqueueDisabled) return;
                onEnqueue?.(button);
              }}
            >
              <span className="dsh-cosmos-action-label">{t("cosmos.actions.enqueueLabel", "＋ 入队")}</span>
            </button>
          </span>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * hero 接力消费条目（add-cosmos-proposal-actions 4.4/4.5）
 * ------------------------------------------------------------------ */

/**
 * `conversation.input.dock` hero 条目：**无渲染消费器**（恒返回 null，仅作输入区
 * 挂载相位钩子）。新 blank 会话首屏挂载时消费一次性标记（fix-cosmos-action-draft-block
 * 2.1/2.2；design D2/D3）：
 *  门控（openState==='open' && blank && !running && !promptAttempted）
 *  → 双口径就绪判定（`consumePendingAction` 内）：
 *    ① 恒新建路径（标记含 targetSessionId）：**本会话 id === 目标** → 草稿为空则先
 *       `inputActions.setDraft` 落稿（不消费，等草稿到位后的下一轮）；草稿恰为消息 →
 *       有绑定模型先切（失败 toast 不阻断）→ autoSend 时 submit() 一次 → 清标记；
 *    ② 降级路径（无 targetSessionId）：沿用草稿等校验（不一致不提交、不清标记）。
 *  匹配失败（无关 blank / 导航被取代）零落稿零提交零清除。
 */
function ActionHeroDock(props) {
  const pending = props.pending ?? null;
  const sessionId = props.sessionId;
  const session = props.session ?? null;
  const useInput = typeof props.useInput === "function" ? props.useInput : null;
  const liveInput = useInput ? useInput((state) => state) : null;
  const zone = liveInput ?? props.input ?? null;
  const draft = zone !== null && typeof zone.draft === "string" ? zone.draft : "";
  const inputActions = props.inputActions ?? null;
  const switchModel = typeof props.switchModel === "function" ? props.switchModel : null;
  const notify = typeof props.notify === "function" ? props.notify : null;
  const t = props.t;
  const busyRef = useRef(false);
  /* 已落稿的标记 token（防宿主未发布草稿时对同一标记反复 setDraft）。 */
  const fillRef = useRef(0);
  const open = session !== null
    && typeof session === "object"
    && session.openState === "open"
    && session.blank === true
    && session.running !== true
    && session.promptAttempted !== true;

  const tr = (key, fallback) => {
    try {
      const value = typeof t === "function" ? t(key) : null;
      return typeof value === "string" && value && value !== key ? value : fallback;
    } catch {
      return fallback;
    }
  };

  useEffect(() => {
    if (!open || pending === null || inputActions === null || busyRef.current) return;
    const entry = pending.read();
    if (!entry) return;
    /* 就绪判定（纯函数，单源）：会话 id 不符 → 不动作；空稿 + 落稿意图 → 先落稿；
       草稿恰为消息 → 消费。降级路径（无 id）沿用草稿等校验——不一致即复用了他人
       草稿的 blank（keep 未写入按钮消息），不提交、不清标记，防误发用户旧草稿。 */
    const readiness = pendingReadinessOf({ entry, sessionId, draft });
    if (readiness.action === "skip") return;
    if (readiness.action === "fill") {
      /* 恒新建路径落稿：空稿才写（既有内容零改写），同步写入后等草稿到位再消费。 */
      if (typeof inputActions.setDraft !== "function") return;
      if (fillRef.current === entry.token) return;
      fillRef.current = entry.token;
      inputActions.setDraft(entry.message);
      return;
    }
    busyRef.current = true;
    consumePendingAction({
      pending,
      sessionId,
      draft,
      setDraft: typeof inputActions.setDraft === "function" ? (text) => inputActions.setDraft(text) : undefined,
      switchModel: switchModel === null ? undefined : (model) => switchModel(sessionId, model),
      submit: typeof inputActions.submit === "function" ? () => inputActions.submit() : undefined,
      notify,
      labels: {
        switchFailed: tr("cosmos.actions.switchFailed", "模型切换失败："),
        switchUnavailable: tr("cosmos.actions.switchUnavailable", "模型切换不可用：当前连接不支持")
      }
    }).catch((error) => {
      console.warn("[dsh-v-cosmos] pending action consume failed:", error);
    }).finally(() => {
      busyRef.current = false;
    });
  }, [open, draft, sessionId]);

  return null;
}

/** 页面外的插件 toast（hero 消费失败提示：此时 Cosmos 整页已关闭，引擎 toast 不可用）。 */
function showCosmosToast(text, isError) {
  if (typeof document === "undefined") return;
  let host = document.getElementById("dsh-v-cosmos-toast");
  if (!host) {
    host = document.createElement("div");
    host.id = "dsh-v-cosmos-toast";
    host.className = "dsh-cosmos-toast";
    document.body.appendChild(host);
  }
  host.textContent = String(text ?? "");
  host.dataset.error = isError ? "true" : "false";
  host.dataset.show = "true";
  clearTimeout(showCosmosToast.timer);
  showCosmosToast.timer = setTimeout(() => {
    host.dataset.show = "false";
  }, isError ? 4000 : 1800);
}

/* ------------------------------------------------------------------ *
 * 星座浮窗输入器（add-cosmos-constellation-actions 4.x；方案 B 草稿镜像）
 * ------------------------------------------------------------------ */

/**
 * 缺省 attachFace（p2-add-const-float-image-attach design D1）：props 缺席（旧宿主 / 降级）
 * 时浮窗只拿到一个 `available === false` 的稳定 face——添加图片钮转置灰可点引导态，
 * 粘贴通道回落原生默认行为，零降级噪音。
 */
const COSMOS_ATTACH_FACE_ABSENT = createAttachFace();

/** 在册附件 id / rail 行的稳定空数组（零附件时不产生新的引用，防无谓重渲染）。 */
const EMPTY_ATTACHMENT_IDS = Object.freeze([]);

/**
 * `conversation.input.dock` 星座浮窗条目（id `v-cosmos-constellation-float`）。
 *
 * 门控（fix-cosmos-action-draft-block 3.2 / design D2/D6）：浮窗标记在册且未过期 &&
 * **本会话 id 与标记目标 SessionId 一致** && 会话 `openState==='open' && blank===true &&
 * running !== true` && **输入区草稿恰为组装消息**（`draftMatches`）→ 以 body portal
 * 呈现浮窗卡片（z 序高于 Cosmos 覆盖层，toast 先例）。草稿为空且标记带落稿意图时先经
 * `inputActions.setDraft` 写入**再**呈现（挂载落稿即呈现——textarea 显示的草稿快照恰
 * 为按钮消息，所见即所得）；草稿非空且不一致 MUST NOT 改写、MUST NOT 呈现，标记保留至过期。
 *
 * 生命周期（design D5）：**挂载即消费**浮窗标记（带 token 清除）——TTL 只约束
 * 「点击 → 正确相位呈现」窗口，呈现后的显隐由浮窗自身打开态驱动，用户编辑中途
 * MUST NOT 因标记过期而消失。
 *
 * 草稿双向绑定（真实会话输入区为唯一真相源）：显示 `useInput().draft`，编辑经
 * `inputActions.setDraft` 写回，发送走 `inputActions.submit()`（`/令牌` 经既有裁决管线
 * 生效）。**发送关闭时机按类别分流**（p2-add-const-float-image-attach design D4）：
 * 纯文本发送保持 **发送即关**（fix-cosmos-const-float-send-close D1/D3）——submit() 之后
 * 主动调 `close()`，宿主对普通文本走 detached 发送路径（源码注释原话「leaves the phase
 * plain」），提交相位全程保持 `plain`，关闭 MUST NOT 依赖相位跃迁；**带在册附件的发送**
 * 改**结果感知关闭**——submit() 后保持打开并进入观察态，成功终态（相位回 plain ∧ 附件自
 * 输入状态清空）后关窗、Host 拒收（promptError 新错误）经浮窗 toast 呈现且浮窗留存、
 * 10s 看门狗兜底；`/` 命令草稿（无论是否带附件）沿用既有「主动立即关闭 + 相位兜底」。
 * 两类守卫早退于 submit() 之前且 MUST NOT 关窗（`inputActions` 缺失；
 * **空输入**——文本空或仅空白字符 **且 无在册附件**，与宿主 `enter` 机器同一判据）
 * ——「点了发送却没提交不误关」。
 * 其余关闭路径 = 关闭按钮 / Esc / 点浮窗外（草稿与附件保留）。
 * 「提交相位离开 `plain` → 关闭」副作用保留为 `/` 命令草稿的**兜底**关闭路径
 * （与主动关闭收敛于同一 `close()`，幂等无害；宿主未来若给普通路径引入非 plain
 * 瞬态亦自动覆盖）。
 * Esc 为**最高优先层**（window capture + stopPropagation）：不触发钻取返回、清搜索、关页。
 * 键盘快捷键（add-cosmos-const-float-send-key）：textarea 内 Enter（无修饰键）= 发送
 * （复用 `send()`，零新分支）、Shift+Enter = 换行（默认行为经 onChange 写回草稿）、
 * Ctrl/Cmd+Enter 及其余组合不接管；组字中 Enter 不发送、Esc 不关窗。
 *
 * 浮窗增强（rework 方案 2「浮窗为主承载」）：
 *  - **模型选择**（注入 `models` face，与设置页同源 `describeButtonModel` 取值面）：
 *    模型下拉 + 级别下拉（仅带等级元数据的模型呈现，默认最高级），切换走
 *    `switchModel`（会话内持久生效）；目录降级 → 只读「会话当前模型」+ 注记；漂移绑定
 *    原样回显标不可用。按钮绑定模型仍链路先行切换，选择器随后回显该绑定。
 *  - **语音转写**（注入 `speech` face，借官方语音 Bundle 的 `remote.speech` 服务层——
 *    官方 VoiceInput UI 挂驻留 composer 槽位，浮窗不可复用其 UI；fix-cosmos-const-float-voice
 *    修复其端到端链路）：麦克风钮按官方 `Recording.stop()` 同构链路录音——MediaRecorder
 *    默认容器**只承担采集** → 解码 → 16 kHz 单声道重采样 → PCM16 WAV → canonical base64
 *    → transcribe → 按 `RemoteResult` 信封取文本 → **追加**到最新草稿尾部（既有内容零改写）。
 *    语音不可用（Bundle 未启用 / 旧宿主 face 缺席，客户端不区分）→ 语音钮**置灰可点**
 *    （引导 toast + Bundle 详情页跳转；MUST NOT 原生 disabled），不再整体隐藏；
 *    权限拒绝/转写失败/空转写 → toast，浮窗留存、草稿不丢。
 */
function ConstellationFloatDock(props) {
  const floats = props.floats ?? null;
  const sessionId = props.sessionId;
  const session = props.session ?? null;
  const useInput = typeof props.useInput === "function" ? props.useInput : null;
  const liveInput = useInput ? useInput((state) => state) : null;
  const zone = liveInput ?? props.input ?? null;
  const draft = zone !== null && typeof zone.draft === "string" ? zone.draft : "";
  const phase = zone !== null && typeof zone.phase === "string" ? zone.phase : "plain";
  /* 在册附件 id（机器状态 = 唯一真相源；p2 design D3：浮窗不维护本地镜像列表）。 */
  const attachmentIds = zone !== null && Array.isArray(zone.attachmentIds) ? zone.attachmentIds : EMPTY_ATTACHMENT_IDS;
  const inputActions = props.inputActions ?? null;
  const switchModel = typeof props.switchModel === "function" ? props.switchModel : null;
  /* 增强注入（rework 方案 2）：models = 模型目录 face（{catalog}快照）、speech = 语音转写
     桥 face（{available}快照 + transcribe/openBundle）；p2 新增 attachFace = conversation 服务
     附件操作的薄包装 face（与两者同构）。缺席（旧宿主/未启用）→ 对应增强面整体降级：
     模型行回落只读标识、语音钮转「置灰可点」引导态、添加图片钮转置灰可点引导态——零新增噪音。 */
  const models = props.models ?? null;
  const speech = props.speech ?? null;
  const attachFace = props.attachFace ?? COSMOS_ATTACH_FACE_ABSENT;
  const notify = typeof props.notify === "function" ? props.notify : null;
  const t = props.t;
  /* 已消费的标记（null = 浮窗未打开）。标记随挂载消费，故呈现后显隐只看本状态。 */
  const [armed, setArmed] = useState(null);
  /* 模型选择面：null = 尚未呈现；否则 { model: 选中模型对象|null（null = 会话当前模型）,
     status: "idle"|"switching"|"failed" }。 */
  const [modelSel, setModelSel] = useState(null);
  /* 语音面："idle"（可点开始）|"recording"（录音中，再点停止）|"transcribing"（转写中）。 */
  const [voiceState, setVoiceState] = useState("idle");
  /* 附件观察态（p2 design D4）：null = 不在观察；否则 `{ baseline }` = submit 前一刻快照的
     `session.promptError`（失败终态「新错误」判据的基线；非 plain 在途期出现的错误同样在回
     plain 后比对命中）。 */
  const [attachWatch, setAttachWatch] = useState(null);
  const fileInputRef = useRef(null);
  /* 在册采集资源与其两枚守卫（fix-cosmos-const-float-voice design D5）：
     - `voiceRefs`：唯一释放目标（recorder + stream），释放后置 null；
     - `voiceRunRef`：采集/转写代次。关窗、卸载、录音中失焦/切后台、设备中断与新一轮
       录音均递增；在途转写回调比对代次，过期即整体丢弃（MUST NOT 以冻结的陈旧草稿基线
       写回、MUST NOT 在已卸载组件上 setState）；
     - `voiceDisposedRef`：释放标志。兜底 stop 触发的 onstop 见标志即早退——只释放采集，
       MUST NOT 误走转写链。 */
  const voiceRefs = useRef({ stream: null, recorder: null });
  const voiceRunRef = useRef(0);
  const voiceDisposedRef = useRef(false);
  /* 落稿基准镜像（design D6）：转写完成读**当时最新**草稿，消除点击录音时的陈旧闭包。 */
  const draftRef = useRef(draft);
  const switchedRef = useRef(false);
  /* 已落稿的标记 token（防宿主未发布草稿时对同一标记反复 setDraft）。 */
  const fillRef = useRef(0);
  const textareaRef = useRef(null);

  const tr = (key, fallback) => {
    try {
      const value = typeof t === "function" ? t(key) : null;
      return typeof value === "string" && value && value !== key ? value : fallback;
    } catch {
      return fallback;
    }
  };

  /* 草稿镜像同步（design D6）：onstop 落稿读 `draftRef.current`（当时最新），不读点击
     录音时冻结的 `draft` 闭包——录音期间的手动输入零丢失。 */
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  /* 释放采集资源（design D5，**只释放、不转写**）：先置释放标志 + 递增代次（既让兜底
     stop 触发的 onstop 早退，又作废在途转写）→ 停在册 recorder → 停全部音轨 → 清 refs。
     零 setState：卸载路径调用安全（复位由各自的打开/交互路径承担）。 */
  const releaseVoice = () => {
    voiceDisposedRef.current = true;
    voiceRunRef.current += 1;
    const recorder = voiceRefs.current.recorder;
    voiceRefs.current.recorder = null;
    if (recorder !== null && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        /* 已在停止流程中：无需再次停止 */
      }
    }
    const stream = voiceRefs.current.stream;
    voiceRefs.current.stream = null;
    for (const track of stream?.getTracks?.() ?? []) {
      try {
        track.stop();
      } catch {
        /* 已停止的音轨：无需再次停止 */
      }
    }
  };

  const sessionOpen = session !== null && typeof session === "object" && session.openState === "open";
  /* `running !== true` 门与 hero 消费器对称：防提交相位窗口内误呈发送键。 */
  const gate = sessionOpen
    && session !== null
    && typeof session === "object"
    && session.blank === true
    && session.running !== true;

  /* 标记通道变更订阅：dock 条目在会话内常驻，用户「取消 → 再点同一按钮」时新标记
     不会改变 draft（同一文本）→ 必须靠版本号驱动重新门控。 */
  const markerVersion = useSyncExternalStore(
    floats === null ? () => () => {} : (listener) => floats.subscribe(listener),
    floats === null ? () => 0 : () => floats.getVersion()
  );

  /* 模型目录快照（settings 页模型下拉同源 face）与语音桥可用性快照。 */
  const modelsState = useSyncExternalStore(
    models === null ? () => () => {} : (listener) => models.subscribe(listener),
    models === null ? () => null : () => models.getSnapshot()
  );
  const speechState = useSyncExternalStore(
    speech === null ? () => () => {} : (listener) => speech.subscribe(listener),
    speech === null ? () => null : () => speech.getSnapshot()
  );
  const speechAvailable = speechState !== null
    && typeof speechState === "object"
    && speechState.available === true;
  /* 生效快捷键（add-cosmos-shortcuts 6.1/6.2）：语音开关键与收卡键跟随全局配置——
     浮窗提示文案动态标注当前生效键（改绑即时生效，无需重开浮窗）。 */
  const shortcutsState = useSyncExternalStore(cosmosShortcutsStore.subscribe, cosmosShortcutsStore.getSnapshot);
  const voiceKey = shortcutsState.voiceToggle;
  const closeKey = shortcutsState.closePage;

  /* ── 附件面（p2-add-const-float-image-attach design D3/D5）──
     数据流恒为「机器状态 → 投影」：`attachmentIds` 是唯一真相源，描述符经 face 的
     `resolveDraftAttachments` 薄包装每轮现算，上传态经 `fileUploads` 快照订阅补齐——
     **MUST NOT 维护本地附件镜像列表**（移除/提交清空全由机器驱动，浮窗纯投影）。 */
  const uploadsState = useSyncExternalStore(attachFace.uploads.subscribe, attachFace.uploads.getSnapshot);
  const resolvedAttachments = useMemo(
    () => (attachmentIds.length === 0 ? EMPTY_ATTACHMENT_IDS : attachFace.resolve(attachmentIds)),
    [attachFace, attachmentIds]
  );
  /* 上传门控（design D5，对齐原生 `InputBar.tsx` 的 uploadsPending）：任一在册附件非 ready
     → 发送禁用（含已输入纯文本的情形）；`uploadImages` 恒 true 下图片恒有上传态。 */
  const uploadsPending = floatAttachmentsPendingOf(resolvedAttachments, uploadsState);
  /* 机器忙（adjudicating / submitting / sending）与上传未就绪同口径拦发送：观察期（phase =
     sending）重提交会让宿主 no-op 并误武装观察态。 */
  const machineBusy = phase === "adjudicating" || phase === "submitting" || phase === "sending";
  const sendBlocked = uploadsPending || machineBusy;
  /* rail 行的呈现投影：缩略图封面 + 上传态角标（uploading 进度 / error 原因）；file 类
     （原生 composer 侧加入的草稿）走文件名占位块，`uploadImages` 恒 true 下浮窗侧恒图片。 */
  const railRows = useMemo(() => {
    if (resolvedAttachments.length === 0) return EMPTY_ATTACHMENT_IDS;
    const states = uploadsState !== null && typeof uploadsState === "object" ? uploadsState : {};
    return resolvedAttachments.map((attachment) => {
      const upload = states[attachment.id];
      const rawState = upload !== undefined && upload !== null && typeof upload.status === "string" ? upload.status : "";
      const state = rawState === "uploading" || rawState === "error" || rawState === "ready"
        ? rawState
        : attachment.kind === "file" ? "uploading" : "ready";
      const isImage = attachment.kind === "image" && typeof attachment.previewUrl === "string" && attachment.previewUrl !== "";
      const name = attachment.file !== null && attachment.file !== undefined && typeof attachment.file.name === "string"
        ? attachment.file.name
        : "";
      return {
        id: attachment.id,
        isImage,
        previewUrl: isImage ? attachment.previewUrl : "",
        name,
        state,
        reason: upload !== undefined && upload !== null && upload.status === "error" ? String(upload.message ?? "") : ""
      };
    });
  }, [resolvedAttachments, uploadsState]);
  /* `uploadImages` = 目标会话非 subagent 续写（浮窗目标恒为新建普通会话 → 恒 true；
     快照缺席按普通会话处理）。 */
  const uploadImages = session === null || typeof session !== "object"
    || session.subagent === null || session.subagent === undefined;

  useEffect(() => {
    if (armed !== null || floats === null) return;
    const entry = floats.read();
    if (!entry) return;
    /* 门控（纯函数，与冒烟同源）：目标会话 id + 会话可编辑 + 草稿就绪；id 不符/草稿
       不一致不呈现、不清标记（无关 blank / 导航被取代时等正确会话或标记自然过期）。 */
    const view = floatPresentationOf({ entry, session, draft, sessionId });
    if (view.fill) {
      /* 挂载落稿（恒新建路径）：草稿为空才写，绝不改写既有内容；写入后在下一轮
         门控里呈现（所见即所得）。 */
      if (inputActions === null || typeof inputActions.setDraft !== "function") return;
      if (fillRef.current === entry.token) return;
      fillRef.current = entry.token;
      inputActions.setDraft(entry.message);
      return;
    }
    if (!view.present) return;
    floats.clear(entry.token); // 一次性消费：TTL 仅约束呈现窗口
    switchedRef.current = false;
    setVoiceState("idle");
    setModelSel({ model: entry.model ?? null, status: "idle" });
    /* 新一次呈现不继承上一次的附件观察态（陈旧 watch 会在新浮窗里误判终态）。 */
    setAttachWatch(null);
    setArmed(entry);
  }, [armed, gate, draft, sessionId, floats, markerVersion]);

  /* 语音资源兜底释放①（spec「关窗释放麦克风」/ design D5）：浮窗关闭（关闭按钮 / Esc /
     点外 / 发送 → `armed` 转空）与组件卸载共用同一条清理路径——释放标志 + 停 recorder +
     停全部音轨；在途转写经代次守卫丢弃（关窗后用户在原生输入区手打的字 MUST NOT 被
     冻结的陈旧草稿基线覆盖）。arm 时返回清理函数 = 只在「打开 → 关闭/卸载」边界触发一次。 */
  useEffect(() => {
    if (armed === null) return undefined;
    return () => releaseVoice();
  }, [armed]);

  /* 语音资源兜底释放②（spec「关窗释放麦克风」组合路径）：录音中窗口失焦 / 切后台
     （window blur / document visibilitychange）。只对**在册录音**生效——空闲态不打扰，
     转写 in-flight 时 recorder 已摘下（`null`）故天然跳过（转写的作废归属关窗/卸载的
     代次守卫，与官方先例同一口径）。监听器随浮窗打开态注册/移除，零泄漏。 */
  useEffect(() => {
    if (armed === null || typeof window === "undefined") return undefined;
    const halt = () => {
      if (voiceRefs.current.recorder === null) return;
      releaseVoice();
      setVoiceState("idle");
    };
    const onVisibility = () => {
      if (typeof document === "undefined" || document.hidden !== true) return;
      halt();
    };
    const doc = typeof document === "undefined" ? null : document;
    window.addEventListener("blur", halt);
    doc?.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", halt);
      doc?.removeEventListener("visibilitychange", onVisibility);
    };
  }, [armed]);

  /* 兜底关闭：`/` 命令草稿的提交相位离开 plain（adjudicating/submitting）→ 关浮窗。
     普通文本走宿主 detached 发送、相位恒 plain，该跃迁不触发——收敛由 send() 的主动
     close() 负责（两路同一动作，幂等）；保留本副作用也覆盖宿主未来给普通路径加
     非 plain 瞬态的情形。**附件观察期 MUST 早退**（p2 design D4）：带在册附件的发送在途
     本就离开 plain（sending），在途瞬态不关窗，终态由观察 effect 判定。 */
  useEffect(() => {
    if (armed === null) return;
    if (attachWatch !== null) return;
    if (phase !== "plain") setArmed(null);
  }, [armed, phase, attachWatch]);

  /* 结果感知关闭·终态判定（p2 design D4 / spec「浮窗图片附件」）：观察态下
     - 成功终态 = 提交相位回 plain ∧ 输入状态 `attachmentIds` 已清空（Host 受理、机器消费
       附件与草稿）→ 关闭浮窗；
     - 失败终态 = 相位回 plain ∧ `session.promptError` 出现**新**错误（与武装基线引用不同）
       → 浮窗 toast（`{message}（{code}）`）+ 解除观察（浮窗留存；草稿与附件在机器中原样
       保留，可移除附件或修改后重发）；
     - 其余 = 继续观察（非 plain 在途期出现的错误同样在回 plain 后比对命中）。
     宿主契约核验（p2 任务 4.4，实施首日确认）：`conversation.input.dock` 槽位的会话 owner
     面 `InputZone.session` 即 `SessionSnapshot`（`dsh-client-ui-conversation`
     `contract/slots.ts`），其 `promptError` 由 `@deepseek-ai/dsh-api-session-controller`
     `buildSnapshot()` 恒定发布（`{ op, error: { code, message } }`；`prompt()` 失败时落值）
     ——浮窗注入快照已含该字段，**无需**补 inject face（design D4 预案未启用）。 */
  useEffect(() => {
    if (armed === null || attachWatch === null) return;
    const outcome = floatWatchOutcomeOf({
      phase,
      attachmentIds,
      promptError: session !== null && typeof session === "object" ? session.promptError ?? null : null,
      baseline: attachWatch.baseline
    });
    if (outcome.kind === "success") {
      close();
      return;
    }
    if (outcome.kind === "failure") {
      setAttachWatch(null);
      notify?.(promptFailureTextOf(outcome) || tr("cosmos.constFloat.sendFailed", "发送失败"), true);
    }
  }, [armed, attachWatch, phase, attachmentIds, session]);

  /* 观察态看门狗（design D4）：10s 内无终态信号（宿主在途悬挂）→ 关闭浮窗（与旧「发送即关」
     的最坏失败面等价，已知局限如实标注）；草稿与附件保留在会话中。主动关闭先解除观察，
     计时器随 watch 清空自动撤销。 */
  useEffect(() => {
    if (attachWatch === null) return undefined;
    const timer = setTimeout(() => {
      close();
    }, FLOAT_ATTACH_WATCH_MS);
    return () => clearTimeout(timer);
  }, [attachWatch]);

  /* Esc 最高分层（add-cosmos-shortcuts 5.1/D3 起**收卡键参数化**）：capture 阶段先于
     Cosmos 外壳的 window 冒泡监听消费并阻断传播（不触发钻取返回 / 清搜索 / 关页）。
     浮窗未打开时不注册 → 既有分层零变化；键位跟随全局关闭键配置（缺省 Esc）。 */
  useEffect(() => {
    if (armed === null || typeof window === "undefined") return undefined;
    const onKey = (event) => {
      /* IME 组字中的收卡键 = 取消输入法候选，MUST NOT 关浮窗（中文输入高频路径）。
         口径统一（add-cosmos-const-float-send-key D3 复核版）：本监听器挂在 window
         capture 上，回调收到的**本就是原生** KeyboardEvent → 直接读原生组字状态
         `event.isComposing`（改读 `event.nativeEvent?.…` 反而是恒 undefined 的死读取）；
         另补 `keyCode === 229`（组字期间 Chromium 以 229 报键）双保险，使本守卫与 Enter
         守卫及宿主 `isComposingEvent` 前两项判据逐字同源。「组字 Esc 不关浮窗」为既有
         行为，本行仅加固，由 spec 场景 + 冒烟锚点钉住防漂移。
         键位匹配 = 全局关闭键的 canonical 精确匹配（Shift/Meta 裁决统一；配置键非 Esc 时
         Esc 不再收卡）。 */
      if (event.isComposing === true || event.keyCode === 229) return;
      if (!shortcutMatches(event, closeKey)) return;
      event.preventDefault();
      event.stopPropagation();
      /* 主动关闭路径先解除附件观察态（p2 design D4：观察态随时可退，草稿与附件保留）。 */
      setAttachWatch(null);
      setArmed(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [armed, closeKey]);

  /* 浮窗打开态计数（add-cosmos-shortcuts 5.2/D13 模态让位）：引擎 `goHome`/`togglePan`
     与外壳按钮键分发据此让位；armed 变化即加减（收卡/卸载自动归零，探针恒无泄漏）。 */
  useEffect(() => {
    if (armed === null) return undefined;
    cosmosFloatArmedCount += 1;
    return () => {
      cosmosFloatArmedCount = Math.max(0, cosmosFloatArmedCount - 1);
    };
  }, [armed]);

  /* 浮窗语音开关键（add-cosmos-shortcuts 6.1 / spec cosmos-constellation-actions
     「浮窗语音快捷键」）：浮窗 armed 时注册、随浮窗卸载移除（浮窗不打开 = 零监听）。
     三态 toggle：`idle` → `startVoice()`（与麦克风钮同一链路）/ `recording` →
     `finishVoice()`（停止并转写追加草稿）/ `transcribing` → no-op（转写中防抖，与麦克风钮
     disabled 语义一致）。语音不可用时 `startVoice` 守卫转同一引导 toast（不起录音，与置灰
     钮点击同语义）。守卫：IME 组字 + repeat + Shift/Meta 跳过（`shortcutMatches`
     内含）；**不做可编辑焦点守卫**——Ctrl/Alt+字母 组合不产字符，浮窗 textarea 聚焦正是
     「边打字边口述」主场景。命中 `preventDefault`（抑制宿主同键默认行为）。 */
  useEffect(() => {
    if (armed === null || typeof window === "undefined") return undefined;
    const onKey = (event) => {
      if (event.isComposing === true || event.keyCode === 229 || event.repeat === true) return;
      if (!shortcutMatches(event, voiceKey)) return;
      event.preventDefault();
      if (voiceState === "recording") finishVoice();
      else if (voiceState === "idle") startVoice();
      /* transcribing → 静默 no-op（转写中不重复开始/停止） */
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [armed, voiceKey, voiceState]);

  /* 按钮绑定模型的链路先行切换（与 hero 同一 modelBridge）：仅在本次呈现内切一次，
     选择器随后反映该绑定。失败 toast 不阻断——选择回落「会话当前模型」（与既有
     「失败不阻断」纪律一致）。 */
  useEffect(() => {
    if (armed === null || switchedRef.current) return undefined;
    const model = armed.model;
    if (!model || typeof model !== "object") return undefined;
    switchedRef.current = true;
    if (switchModel === null) {
      setModelSel({ model: null, status: "failed" });
      notify?.(tr("cosmos.actions.switchUnavailable", "模型切换不可用：当前连接不支持"), true);
      return undefined;
    }
    let cancelled = false;
    setModelSel({ model, status: "switching" });
    Promise.resolve()
      .then(() => switchModel(sessionId, model))
      .then((outcome) => {
        if (cancelled) return;
        if (outcome?.ok === true) setModelSel({ model, status: "idle" });
        else {
          setModelSel({ model: null, status: "failed" });
          notify?.(tr("cosmos.actions.switchFailed", "模型切换失败：") + String(outcome?.error ?? ""), true);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setModelSel({ model: null, status: "failed" });
        notify?.(tr("cosmos.actions.switchFailed", "模型切换失败：") + String(error?.message || error), true);
      });
    return () => {
      cancelled = true;
    };
    /* 依赖只到 armed/sessionId：tr 是本次呈现的派生值，不驱动重跑。 */
  }, [armed, sessionId]);

  /* 挂载自动聚焦：可直接补写，无需先点输入框。 */
  useEffect(() => {
    if (armed === null) return;
    const el = textareaRef.current;
    if (el && typeof el.focus === "function") el.focus();
  }, [armed]);

  /* 文本面自适应增高（p1-align-const-float-native-layout design D2）：`rows=1` +
     `resize:none`，高度由内容测量写入——先 `height='auto'` 读 `scrollHeight`（含垂直
     padding、**不含边框**；border-box 闭合须补 1px × 2 边框，否则每个档位都差 2px 而常驻
     滚动条），再经纯函数夹取（最小 3 行 / 封顶 14 行；封顶后 CSS `overflow-y:auto` 内部
     滚动）。**依赖受控值 `draft`**：用户键入与外部草稿变更（挂载落稿、语音转写追加）走同一
     测量路径——只挂 onChange 会漏掉不触发输入事件的受控回填，多行落稿将呈陈旧高度。
     写 `el.style.height` 是逐元素呈现态，不参与 React 受控值。 */
  useEffect(() => {
    if (armed === null) return;
    const el = textareaRef.current;
    if (el === null) return;
    const style = getComputedStyle(el);
    const borderY = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
    el.style.height = "auto";
    el.style.height = `${floatTextareaHeightOf(el.scrollHeight + borderY, {
      min: FLOAT_TEXTAREA_MIN_HEIGHT,
      max: FLOAT_TEXTAREA_MAX_HEIGHT
    })}px`;
  }, [armed, draft]);

  if (armed === null) return null;
  if (typeof document === "undefined" || !document.body) return null;

  const meta = armed.meta !== null && typeof armed.meta === "object" ? armed.meta : {};
  const title = typeof meta.wsName === "string" && meta.wsName ? meta.wsName : tr("cosmos.constFloat.title", "星座动作");
  const buttonName = typeof meta.buttonName === "string" ? meta.buttonName : "";
  const close = () => {
    /* 主动关闭路径（关闭钮 / Esc / 点浮窗外 / 观察态看门狗）先解除附件观察态，再关窗
       （p2 design D4：观察态随时可退；草稿与在册附件留在机器中原样保留）。 */
    setAttachWatch(null);
    setArmed(null);
  };
  const send = () => {
    /* 守卫①：注入面降级——点了发送却无法提交，浮窗留存（不产生「什么都没发生还关窗」死态）。 */
    if (inputActions === null || typeof inputActions.submit !== "function") return;
    /* 守卫② + 发送分类（p2 design D4）：空输入 = 文本空或仅空白字符 **且 无在册附件**
       （附件使输入非空，宿主 `enter` 机器同一判据）→ 宿主提交为 no-op、不进入发送流程，
       浮窗留存（与守卫①同一「没提交不误关」原则）。 */
    const plan = floatSendPlanOf({ draft, attachmentIds });
    if (plan === "empty") return;
    if (plan === "watch") {
      /* 带在册附件 → 结果感知关闭：submit 前一刻快照 `session.promptError` 作失败判据基线，
         提交后**不关**、进入观察态（成功/失败终态与看门狗见上方两个 effect）。 */
      setAttachWatch({ baseline: session !== null && typeof session === "object" ? session.promptError ?? null : null });
      inputActions.submit();
      return;
    }
    inputActions.submit();
    /* 发送即关：普通文本走宿主 detached 发送、提交相位恒 plain —— 关闭不依赖任何相位
       跃迁；`/` 命令的相位兜底副作用仍在，两路收敛于 close()（幂等）。命令草稿无论是否
       带附件都走本路径（不感知附件消费结果——spec 已知边界）。 */
    close();
  };
  /* ── 附件 intake 两通道（p2 design D2 / spec「浮窗图片附件」）── */
  /** 共享 intake 链路（按钮拾取 + 剪贴板粘贴）：校验 → 铸造 → 登记；outcome → toast。 */
  const intakeFiles = (files) => {
    const result = intakeFloatImages({
      face: attachFace,
      inputActions,
      sessionId,
      files,
      uploadImages
    });
    if (result.kind === "image-only") {
      notify?.(tr("cosmos.constFloat.attachImageOnly", "仅支持添加图片"), true);
      return;
    }
    if (result.kind === "busy") {
      notify?.(tr("cosmos.constFloat.attachBusy", "当前不可添加附件"), true);
      return;
    }
    if (result.kind === "rejected") {
      /* 铸造抛错（如不支持的 MIME）薄透传文案——face 不翻译、不吞错。 */
      notify?.(result.message, true);
    }
  };
  /** 通道①：添加图片钮（降级态置灰可点 → 引导 toast，不打开拾取器）。 */
  const onAttachClick = () => {
    if (attachFace.available !== true) {
      notify?.(tr("cosmos.constFloat.attachUnavailable", "跳转会话页可用原生添加图片"), true);
      return;
    }
    const input = fileInputRef.current;
    if (input !== null && input !== undefined && typeof input.click === "function") input.click();
  };
  /** 隐藏 file input 的 change：拾取批次交给共享链路；**重置 value** 使同文件可重复拾取。 */
  const onPickFiles = (event) => {
    const input = event?.target ?? null;
    const picked = input === null || input === undefined || input.files === null || input.files === undefined
      ? []
      : Array.from(input.files);
    if (input !== null && input !== undefined) {
      try {
        input.value = "";
      } catch {
        /* 只读元素：忽略（value 重置失败不影响本批次） */
      }
    }
    if (picked.length > 0) intakeFiles(picked);
  };
  /** 通道②：textarea 自接 paste（原生 document 路由跳过 editable 起源，不会替浮窗接住）。 */
  const onPaste = (event) => {
    const files = clipboardFilesOf(event?.clipboardData);
    /* 无文件（纯文本/富文本）：默认粘贴行为逐字不变。 */
    if (files.length === 0) return;
    /* 降级态：整批按原生默认粘贴处理（图片与非图片一律忽略，零 toast 零铸造）。 */
    if (attachFace.available !== true) return;
    /* 批内有文件才接管（纯文本粘贴 MUST NOT 被拦截）——零图片批次由共享链路 toast。 */
    event.preventDefault();
    intakeFiles(files);
  };
  /** 移除链路：机器先移除成功、再经 face 释放（顺序同原生；busy 相位拒绝时零释放）。 */
  const removeAttachmentOf = (id) => {
    removeFloatAttachment({ inputActions, face: attachFace, id });
  };

  /* 浮窗提示文案（add-cosmos-shortcuts 6.2 / p2：标注附件入口）：动态标注当前生效的语音键
     与收卡键（改绑即时生效——本组件订阅快捷键 store，无需重开浮窗）。词典为双语占位模板，
     缺键回落中文基线（与引擎/其余浮窗文案同纪律）。 */
  const floatHintText = tr(
    "cosmos.constFloat.hint",
    "Enter 发送 · Shift+Enter 换行 · 点击 ＋ 或粘贴添加图片 · {voice} 语音 · {close} 关闭浮窗（保留草稿不发送）"
  )
    .replace("{voice}", shortcutLabelOf(voiceKey))
    .replace("{close}", shortcutLabelOf(closeKey));

  /* ── 模型选择（rework 方案 2 增强）：目录取值面与设置页同源（describeButtonModel）——
     目录降级 → 下拉仅剩「会话当前模型」+ 降级注记；漂移绑定原样回显标不可用；级别下拉
     仅当所选模型带等级元数据时呈现（默认最高级，settings 页先例）。切换失败不阻断、
     选择回落「会话当前模型」（与按钮绑定切换的失败纪律一致）。 ── */
  const catalog = modelsState !== null && typeof modelsState === "object" ? modelsState.catalog : null;
  const modelView = describeButtonModel(
    modelSel !== null && modelSel.model !== null ? modelSel.model : undefined,
    catalog
  );
  const modelSwitching = modelSel !== null && modelSel.status === "switching";
  const switchTo = (model) => {
    if (switchModel === null) {
      setModelSel({ model: null, status: "failed" });
      notify?.(tr("cosmos.actions.switchUnavailable", "模型切换不可用：当前连接不支持"), true);
      return;
    }
    setModelSel({ model, status: "switching" });
    Promise.resolve()
      .then(() => switchModel(sessionId, model))
      .then((outcome) => {
        if (outcome?.ok === true) setModelSel({ model, status: "idle" });
        else {
          setModelSel({ model: null, status: "failed" });
          notify?.(tr("cosmos.actions.switchFailed", "模型切换失败：") + String(outcome?.error ?? ""), true);
        }
      })
      .catch((error) => {
        setModelSel({ model: null, status: "failed" });
        notify?.(tr("cosmos.actions.switchFailed", "模型切换失败：") + String(error?.message || error), true);
      });
  };
  const pickModelByKey = (key) => {
    if (modelSwitching || key === modelView.key) return;
    if (key === "") {
      switchTo(null);
      return;
    }
    const ready = catalog !== null && typeof catalog === "object" && catalog.status === "ready";
    const { byKey } = catalogOptions(ready ? catalog.groups : []);
    const entry = byKey.get(key);
    if (entry === undefined) return; // 漂移键不可作为新选择（仅回显）
    const base = { provider: entry.provider, model: entry.model };
    /* 换模型时级别顺带解析：当前级别若在新模型的等级表里则沿用，否则取其最高级。 */
    const carried = modelView.levelValue !== undefined && entry.efforts.some((effort) => effort.id === modelView.levelValue)
      ? modelView.levelValue
      : highestEffort(entry.efforts);
    switchTo(typeof carried === "string" && carried !== "" ? { ...base, reasoningEffort: carried } : base);
  };
  const pickEffort = (effortId) => {
    if (modelSwitching || modelView.entry === undefined) return;
    const base = { provider: modelView.entry.provider, model: modelView.entry.model };
    switchTo(typeof effortId === "string" && effortId !== "" ? { ...base, reasoningEffort: effortId } : base);
  };

  /* ── 语音转写（rework 方案 2 增强，借官方语音 Bundle 服务层；fix-cosmos-const-float-voice
     修复端到端链路）：MediaRecorder 默认容器**只承担采集**（与官方 `Recording.start` 同构），
     停止后按官方 `Recording.stop()` 逐字段同构转换——解码 → 16 kHz 单声道重采样 → PCM16
     WAV → canonical base64（无 data URL 前缀）→ `remote.speech.transcribe`；结果按
     `RemoteResult` 信封消费（`ok` / `value.text` / `error.message`）。转写文本**追加**到
     最新草稿尾部（唯一真相源写回，既有内容零改写、只追加）。录音/转写全程状态面上浮
     （按钮自持）；失败 toast 不关窗、不丢草稿。 ── */
  const bytesToBase64 = (bytes) => {
    let binary = "";
    const CHUNK = 0x8000;
    for (let index = 0; index < bytes.length; index += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(index, index + CHUNK));
    }
    return btoa(binary);
  };
  /* canonical PCM16 WAV（RIFF 小端 / 16 kHz / 单声道 / 44 字节头）：宿主 `validateWave`
     的硬校验口径（采样率 16000、byteRate 32000、blockAlign 2、位深 16、RIFF 与 data
     长度自洽）。量化为官方 encodeWave 逐字段同式（负数 ×32768、非负 ×32767 后取整）。 */
  const encodeWave = (samples) => {
    const bytes = new Uint8Array(44 + samples.length * 2);
    const view = new DataView(bytes.buffer);
    const text = (at, value) => {
      for (let index = 0; index < value.length; index += 1) bytes[at + index] = value.charCodeAt(index);
    };
    text(0, "RIFF");
    view.setUint32(4, bytes.length - 8, true);
    text(8, "WAVE");
    text(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true);
    view.setUint32(28, 32000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, "data");
    view.setUint32(40, samples.length * 2, true);
    for (let index = 0; index < samples.length; index += 1) {
      const value = Math.max(-1, Math.min(1, samples[index]));
      view.setInt16(44 + index * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
    }
    return bytes;
  };
  /* 采集产物 → canonical WAV（官方 `Recording.stop()` 同式链路）：容器 blob 解码 →
     OfflineAudioContext 重采样 16 kHz 单声道（样本数与官方同式取 floor、下限 1）→
     PCM16 编码。解码上下文用完即关（不驻留音频设备）；解码能力缺失 / 容器不可解码 →
     抛错，由调用方 toast（缺口 F 不细化错误分类）。 */
  const waveFromBlob = async (blob) => {
    if (typeof AudioContext === "undefined" || typeof OfflineAudioContext === "undefined") {
      throw new Error(tr("cosmos.constFloat.voiceDenied", "无法访问麦克风：请检查浏览器权限与环境"));
    }
    const context = new AudioContext();
    try {
      const decoded = await context.decodeAudioData(await blob.arrayBuffer());
      const offline = new OfflineAudioContext(1, Math.max(1, Math.floor(decoded.duration * 16000)), 16000);
      const source = offline.createBufferSource();
      source.buffer = decoded;
      source.connect(offline.destination);
      source.start();
      const resampled = await offline.startRendering();
      return encodeWave(resampled.getChannelData(0));
    } finally {
      try {
        Promise.resolve(context.close?.()).catch(() => {});
      } catch {
        /* 上下文已关闭：忽略（MUST NOT 掩盖转写产物的成败） */
      }
    }
  };
  const finishVoice = () => {
    const recorder = voiceRefs.current.recorder;
    if (recorder && recorder.state !== "inactive") recorder.stop(); // onstop 承担收尾与转写
  };
  const startVoice = () => {
    if (voiceState !== "idle" || speech === null) return;
    /* 不可用守卫（spec「未启用置灰呈现」）：置灰态下快捷键与按钮同一引导语义——
       不起录音（否则录完必然转写失败，误导用户）。 */
    if (!speechAvailable) {
      voiceUnavailableNotice();
      return;
    }
    if (typeof navigator === "undefined" || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function"
      || typeof MediaRecorder === "undefined" || typeof AudioContext === "undefined" || typeof OfflineAudioContext === "undefined") {
      notify?.(tr("cosmos.constFloat.voiceDenied", "无法访问麦克风：请检查浏览器权限与环境"), true);
      return;
    }
    /* 抢占代次（design D5）：授权期间关窗/失焦/卸载 → releaseVoice 递增代次，本轮授权
       settle 后自我作废并释放轨道（MUST NOT 在已关闭的浮窗上开始采集）。 */
    const run = voiceRunRef.current + 1;
    voiceRunRef.current = run;
    voiceDisposedRef.current = false;
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      if (run !== voiceRunRef.current || voiceDisposedRef.current) {
        for (const track of stream.getTracks?.() ?? []) track.stop();
        return;
      }
      const recorder = new MediaRecorder(stream);
      const chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      };
      /* 设备中断（拔麦 / 系统回收）走同一复位（spec「设备中断复位」）：释放 + 状态复位
         idle；转写中 recorder 已摘下（null）→ 不误伤在途转写。 */
      const onTrackEnded = () => {
        if (run !== voiceRunRef.current || voiceRefs.current.recorder === null) return;
        releaseVoice();
        setVoiceState("idle");
      };
      for (const track of stream.getTracks?.() ?? []) {
        if (typeof track.addEventListener === "function") track.addEventListener("ended", onTrackEnded);
      }
      recorder.onstop = () => {
        /* 释放守卫（design D5）：兜底 stop（关窗 / 卸载 / 失焦 / 切后台）与迟到的旧
           recorder MUST 只释放采集、MUST NOT 进入转写链（否则以冻结的陈旧基线覆盖草稿）。 */
        const disposed = voiceDisposedRef.current || run !== voiceRunRef.current;
        for (const track of voiceRefs.current.stream?.getTracks?.() ?? []) track.stop();
        voiceRefs.current.stream = null;
        voiceRefs.current.recorder = null;
        if (disposed) return;
        const blob = new Blob(chunks, { type: recorder.mimeType });
        setVoiceState("transcribing");
        Promise.resolve()
          .then(() => waveFromBlob(blob))
          .then((wave) => speech.transcribe(bytesToBase64(wave)))
          .then((result) => {
            /* 在途转写守卫（design D5）：关窗/卸载已递增代次 → 整体丢弃——不 setDraft、
               不 setState（杜绝陈旧基线覆盖与卸载态写入）。 */
            if (run !== voiceRunRef.current) return;
            /* 信封消费（design D3）：`RemoteResult` 失败分支如实呈现 `error.message`，
               MUST NOT 与「未识别到语音」混淆。 */
            if (result === null || typeof result !== "object" || result.ok !== true) {
              const message = result !== null && typeof result === "object"
                && result.error !== null && typeof result.error === "object"
                && typeof result.error.message === "string"
                ? result.error.message
                : "";
              setVoiceState("idle");
              notify?.(tr("cosmos.constFloat.voiceFailed", "语音转写失败：") + message, true);
              return;
            }
            const text = result.value !== null && typeof result.value === "object" && typeof result.value.text === "string"
              ? result.value.text
              : "";
            setVoiceState("idle");
            if (text === "") {
              notify?.(tr("cosmos.constFloat.voiceEmpty", "未识别到语音"), true);
              return;
            }
            if (inputActions === null || typeof inputActions.setDraft !== "function") return;
            /* 落稿基准取**最新**草稿镜像（design D6）：录音期间的手动输入零丢失，
               既有内容零改写（仅以单个换行衔接后追加）。 */
            const glue = draftRef.current === "" || draftRef.current.endsWith("\n") ? "" : "\n";
            inputActions.setDraft(draftRef.current + glue + text);
          })
          .catch((error) => {
            if (run !== voiceRunRef.current) return;
            setVoiceState("idle");
            notify?.(tr("cosmos.constFloat.voiceFailed", "语音转写失败：") + String(error?.message || error), true);
          });
      };
      voiceRefs.current.stream = stream;
      voiceRefs.current.recorder = recorder;
      recorder.start();
      setVoiceState("recording");
    }).catch(() => {
      /* 授权失败：浮窗已被关/卸载（代次已变）则静默——MUST NOT 对已关闭的浮窗报错。 */
      if (run !== voiceRunRef.current) return;
      notify?.(tr("cosmos.constFloat.voiceDenied", "无法访问麦克风：请检查浏览器权限与环境"), true);
    });
  };
  /* 置灰钮点击（spec「置灰点击引导」）：toast 指引 + 尝试跳语音 Bundle 详情页；
     `pluginNavigation` 桥缺席或跳转失败由 face 内部降级为纯 toast（零降级噪音）。 */
  const voiceUnavailableNotice = () => {
    notify?.(tr(
      "cosmos.constFloat.voiceUnavailable",
      "需要在配置中开启语音功能：设置 → 插件 → 语音输入"
    ), true);
    try {
      speech?.openBundle?.();
    } catch {
      /* 跳转失败：保留纯 toast 引导（不干扰主流程） */
    }
  };

  return createPortal(
    <div
      className="dsh-cosmos-const-float"
      data-cosmos-const-float="true"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="dsh-cosmos-const-float-backdrop" onClick={close} />
      <div className="dsh-cosmos-const-float-card" onClick={(event) => event.stopPropagation()}>
        <div className="dsh-cosmos-const-float-head">
          <span className="dsh-cosmos-const-float-title" title={title}>{title}</span>
          {buttonName ? <span className="dsh-cosmos-const-float-tag">{buttonName}</span> : null}
          <button
            type="button"
            className="dsh-cosmos-const-float-close"
            aria-label={tr("cosmos.constFloat.close", "关闭")}
            title={tr("cosmos.constFloat.close", "关闭")}
            onClick={close}
          >
            ×
          </button>
        </div>
        {/* ② 附件 rail（p2 design D3/D7）：唯一真相源 = `useInput().attachmentIds`，描述符经
            face 的 `resolveDraftAttachments` 投影、上传态经 `fileUploads` 快照补齐——无本地
            附件镜像列表（移除/提交清空全由机器驱动）。无附件时无子节点 → CSS
            `:empty{display:none}` 空态零布局（display:none 的 flex 子项不产生间隔）。 */}
        <div className="dsh-cosmos-const-float-rail" data-const-float-slot="attachments">
          {railRows.map((row) => (
            <div className="dsh-cosmos-const-float-thumb" key={row.id} data-state={row.state}>
              {row.isImage ? (
                <img className="dsh-cosmos-const-float-thumb-img" src={row.previewUrl} alt={row.name} draggable={false} />
              ) : (
                <span className="dsh-cosmos-const-float-thumb-name" title={row.name}>
                  {row.name === "" ? "FILE" : row.name}
                </span>
              )}
              {/* 上传态角标（HUD 语言）：uploading = 转圈；error = 叹号（title 标注原因）；
                  ready 无角标（对齐原生 rail 的「就绪即纯净」口径）。 */}
              {row.state === "uploading" ? (
                <span className="dsh-cosmos-const-float-thumb-badge" data-state="uploading" aria-hidden="true" />
              ) : null}
              {row.state === "error" ? (
                <span className="dsh-cosmos-const-float-thumb-badge" data-state="error" title={row.reason} aria-hidden="true">
                  !
                </span>
              ) : null}
              <button
                type="button"
                className="dsh-cosmos-const-float-thumb-remove"
                aria-label={tr("cosmos.constFloat.attachRemove", "移除图片")}
                title={tr("cosmos.constFloat.attachRemove", "移除图片")}
                onClick={() => removeAttachmentOf(row.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        {/* ③ 文本面分区（design D2）：`rows=1` + 无 resize 把手，高度由测量 effect 依受控值
            `draft` 写回——最小 3 行、封顶 14 行后内部滚动。 */}
        <div className="dsh-cosmos-const-float-body">
          <textarea
            ref={textareaRef}
            className="dsh-cosmos-const-float-input"
            value={draft}
            rows={1}
            spellCheck={false}
            placeholder={tr("cosmos.constFloat.placeholder", "补写或修改消息，发送后进入当前星座工作区的会话…")}
            aria-label={tr("cosmos.constFloat.inputAria", "消息内容")}
            onKeyDown={(event) => {
              /* 键盘快捷发送（add-cosmos-const-float-send-key D1/D2）：Enter（无修饰键）等效
                 点击发送按钮——同一 `send()`（同一两类守卫 + 同一「发送即关」链路），零新分支。
                 Shift+Enter（宿主 `fixed.newline`）/ Ctrl+Enter / Cmd+Enter / 其余修饰组合一律
                 **不拦**：textarea 默认插入 `\n`，经 `onChange → setDraft` 写回真实草稿。 */
              if (event.key !== "Enter") return;
              if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
              /* IME 组字守卫（D3，判据对齐宿主 `isComposingEvent` 前两项 `isComposing ||
                 keyCode === 229`）：React 合成键盘事件**不透出** `isComposing` 字段（直接读它
                 恒 undefined）→ MUST 经 `nativeEvent` 读原生气泡事件；组字中 Enter 只参与上屏，
                 MUST NOT 发送、MUST NOT 关窗。 */
              if (event.nativeEvent?.isComposing === true || event.keyCode === 229) return;
              /* 发送门控同口径（p2 design D5）：上传未就绪 / 机器忙时与按钮同一 disabled 语义
                 ——不发送（保留 textarea 默认换行行为）。 */
              if (sendBlocked) return;
              event.preventDefault();
              send();
            }}
            onChange={(event) => {
              if (inputActions === null || typeof inputActions.setDraft !== "function") return;
              /* 写回真实会话草稿（唯一真相源）：浮窗是受控镜像。 */
              inputActions.setDraft(event.target.value);
            }}
            onPaste={onPaste}
          />
        </div>
        {/* ④ 工具行（design D3；对齐原生 trailing 簇）：左簇 = 添加图片钮（p2 填充实体钮：
            隐藏 file input 批量拾取 + 降级置灰可点引导）；右簇次序恒为 模型下拉 → 级别下拉
            （仅带等级元数据的模型）→ 语音钮 → 发送钮。窄卡宽度不足靠 `flex-wrap` 换行折行
            （MUST NOT 溢出卡片）。 */}
        <div className="dsh-cosmos-const-float-toolbar">
          <span className="dsh-cosmos-const-float-tools" data-const-float-slot="attach">
            <input
              ref={fileInputRef}
              className="dsh-cosmos-const-float-file"
              type="file"
              multiple
              accept={FLOAT_IMAGE_ACCEPT}
              tabIndex={-1}
              aria-hidden="true"
              onChange={onPickFiles}
            />
            {/* 降级态 = 置灰但**可点**（MUST NOT 原生 disabled：disabled 钮不派发 click，
                引导将永远无法触达；语音钮先例同口径）。 */}
            <button
              type="button"
              className="dsh-cosmos-const-float-attach"
              data-state={attachFace.available === true ? "available" : "unavailable"}
              aria-disabled={attachFace.available === true ? undefined : "true"}
              aria-label={tr("cosmos.constFloat.attach", "添加图片")}
              title={attachFace.available === true
                ? tr("cosmos.constFloat.attach", "添加图片")
                : tr("cosmos.constFloat.attachUnavailable", "跳转会话页可用原生添加图片")}
              onClick={onAttachClick}
            >
              ＋
            </button>
          </span>
          {/* 模型选择面（rework 增强）：目录可达 = 可交互下拉（模型 + 级别）；目录降级 =
              只剩「会话当前模型」+ 注记；按钮绑定模型经链路先行切换后在此回显。模型行容器已
              拆除（「模型」caption 删除——两个 select 自带 aria-label，可访问性不回退），三态
              降级注记随 select 同簇内联呈现，`data-state` 由右簇容器承载。 */}
          <div className="dsh-cosmos-const-float-trailing" data-state={modelSel?.status ?? "idle"}>
            <select
              className="dsh-cosmos-const-float-model-select"
              value={modelView.key}
              aria-label={tr("cosmos.constFloat.modelLabel", "模型")}
              disabled={modelSwitching}
              onChange={(event) => pickModelByKey(event.target.value)}
            >
              <option value="">{tr("cosmos.constFloat.modelDefault", "会话当前模型")}</option>
              {modelView.drift && modelView.key !== "" ? (
                <option value={modelView.key}>
                  {modelView.key}（{tr("cosmos.constFloat.modelDrift", "不可用")}）
                </option>
              ) : null}
              {modelView.options.map((item) => (
                <option key={item.key} value={item.key}>{item.label}</option>
              ))}
            </select>
            {modelView.levelVisible ? (
              <select
                className="dsh-cosmos-const-float-effort-select"
                value={modelView.levelValue ?? ""}
                aria-label={tr("cosmos.constFloat.effortLabel", "级别")}
                disabled={modelSwitching}
                onChange={(event) => pickEffort(event.target.value)}
              >
                {modelView.levelOptions.map((effort) => (
                  <option key={effort.id} value={effort.id}>{effort.name ?? effort.id}</option>
                ))}
              </select>
            ) : null}
            {modelSwitching ? (
              <span className="dsh-cosmos-const-float-model-note">{tr("cosmos.constFloat.switching", "切换中…")}</span>
            ) : null}
            {modelSel !== null && modelSel.status === "failed" ? (
              <span className="dsh-cosmos-const-float-model-note">{tr("cosmos.constFloat.modelFallback", "已按会话当前模型")}</span>
            ) : null}
            {modelView.degraded ? (
              <span className="dsh-cosmos-const-float-model-note">{tr("cosmos.constFloat.modelDegraded", "模型目录不可用")}</span>
            ) : null}
            {/* 语音钮三分支（fix-cosmos-const-float-voice design D4 / spec「未启用置灰呈现」）：
                语音可用 = 正常状态机钮（idle → 语音 / recording → 停止 / transcribing → 转写中…）；
                语音不可用（语音 Bundle 未启用 或 旧宿主 face 缺席，客户端 SHALL NOT 区分）=
                置灰但**可点**钮——MUST NOT 用原生 `disabled` 承载不可用语义（disabled 钮不派发
                click，提示与引导将永远无法触达）；「转写中」门控仍用真 `disabled`（该态无点击行为）。 */}
            {speechAvailable ? (
              <button
                type="button"
                className="dsh-cosmos-const-float-voice"
                data-state={voiceState}
                disabled={voiceState === "transcribing"}
                aria-label={tr("cosmos.constFloat.voiceAria", "语音输入") + " · " + shortcutLabelOf(voiceKey)}
                title={tr("cosmos.constFloat.voiceAria", "语音输入") + " · " + shortcutLabelOf(voiceKey)}
                onClick={() => {
                  if (voiceState === "recording") finishVoice();
                  else if (voiceState === "idle") startVoice();
                }}
              >
                {voiceState === "recording"
                  ? tr("cosmos.constFloat.voiceStop", "停止")
                  : voiceState === "transcribing"
                    ? tr("cosmos.constFloat.voiceBusy", "转写中…")
                    : tr("cosmos.constFloat.voiceStart", "语音")}
              </button>
            ) : (
              <button
                type="button"
                className="dsh-cosmos-const-float-voice"
                data-state="unavailable"
                aria-disabled="true"
                aria-label={tr("cosmos.constFloat.voiceAria", "语音输入")}
                title={tr("cosmos.constFloat.voiceUnavailable", "需要在配置中开启语音功能：设置 → 插件 → 语音输入")}
                onClick={voiceUnavailableNotice}
              >
                {tr("cosmos.constFloat.voiceStart", "语音")}
              </button>
            )}
            {/* 发送钮图标化（design D4）：箭头 path 与原生 `InputBar.tsx` 主发送钮同源
                （viewBox 0 0 16 16），仅文本换图标、配色不变；aria-label / title 复用既有
                「发送」文案键（零新增 locale 键），40×40 触屏目标；点击行为复用同一 send()。
                禁用门控（p2 design D5）：上传未就绪 / 机器忙（adjudicating/submitting/sending）
                ——与原生 `primaryDisabled` 同口径（Enter 走同一 sendBlocked 守卫）。 */}
            <button
              type="button"
              className="dsh-cosmos-const-float-send"
              disabled={sendBlocked}
              aria-label={tr("cosmos.constFloat.send", "发送")}
              title={tr("cosmos.constFloat.send", "发送")}
              onClick={send}
            >
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
                <path
                  d="M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z"
                  fill="currentColor"
                />
              </svg>
            </button>
          </div>
        </div>
        {/* ⑤ hint 行（design D5）：工具行下方独立块级一行（卡内最底分区，对齐原生 composer
            卡下 dock 位次）；文案模板与动态键标注（{voice}/{close}）零改动。 */}
        <div className="dsh-cosmos-const-float-hintline">
          <span className="dsh-cosmos-const-float-hint">
            {floatHintText}
          </span>
        </div>
      </div>
    </div>,
    document.body
  );
}


/* ------------------------------------------------------------------ *
 * 星胚动作消费条目（add-cosmos-action-prestate-gate 3.3）
 * ------------------------------------------------------------------ */

/**
 * `conversation.input.dock` 星胚条目（id `v-cosmos-embryo-action`）：**无渲染消费者**
 * （恒返回 null，仅作探索会话输入区的消费钩子）。
 *
 * 门控（spec「星胚动作执行链路」④）：标记**绑定本会话 id** ∧ `openState === 'open'` ∧
 * `running !== true` ∧ **输入区草稿为空**（探索会话非 blank，故不再要求 blank）。
 * 通过 → `setDraft(消息)` 落稿；勾选 `autoSend` 时（有绑定模型先切后发）经
 * `inputActions.submit()` 提交一次；消费后清标记（一次性，未消费标记 TTL 到期静默丢弃）。
 *
 * 与 hero 消费器的关键差异：
 *  - **订阅标记 store 变更**（同星座浮窗纪律）：`openSession` 幂等不重挂载输入区——
 *    目标已是当前会话时，新标记经订阅原地同步消费，不等新挂载相位；
 *  - 草稿非空（≠消息）→ toast 守卫一次、**不改写、不清标记**（标记保留至过期）；
 *  - 目标会话缺失/归档由执行链路守卫（本条目零新建、零回落）。
 */
function EmbryoActionDock(props) {
  const pending = props.pending ?? null;
  const sessionId = props.sessionId;
  const session = props.session ?? null;
  const useInput = typeof props.useInput === "function" ? props.useInput : null;
  const liveInput = useInput ? useInput((state) => state) : null;
  const zone = liveInput ?? props.input ?? null;
  const draft = zone !== null && typeof zone.draft === "string" ? zone.draft : "";
  const inputActions = props.inputActions ?? null;
  const switchModel = typeof props.switchModel === "function" ? props.switchModel : null;
  const notify = typeof props.notify === "function" ? props.notify : null;
  const t = props.t;
  const busyRef = useRef(false);
  /* 已落稿的标记 token（防宿主未发布草稿时对同一标记反复 setDraft）。 */
  const fillRef = useRef(0);
  /* 已提示「草稿非空」的标记 token（同一标记只 toast 一次）。 */
  const toastRef = useRef(0);

  const tr = (key, fallback) => {
    try {
      const value = typeof t === "function" ? t(key) : null;
      return typeof value === "string" && value && value !== key ? value : fallback;
    } catch {
      return fallback;
    }
  };

  /* 标记通道变更订阅：dock 条目在会话内常驻——新标记登记 / 清除必须触发重新门控。 */
  const markerVersion = useSyncExternalStore(
    pending === null ? () => () => {} : (listener) => pending.subscribe(listener),
    pending === null ? () => 0 : () => pending.getVersion()
  );

  useEffect(() => {
    if (pending === null || inputActions === null) return;
    if (typeof sessionId !== "string" || !sessionId) return;
    const entry = pending.read();
    if (!entry) return;
    /* 通道隔离 + 目标会话判据：不匹配零读取零清除（不消费他人标记）。 */
    if (entry.targetSessionId !== sessionId) return;
    if (session === null || typeof session !== "object" || session.openState !== "open") return;
    if (session.running === true) return;
    /* 就绪判定（与 hero 同一纯函数）：空稿 + 落稿意图 → 先落稿；草稿恰为消息 → 消费；
       草稿非空且不一致 → 守卫（不改写、不提交、不清标记）。 */
    const readiness = pendingReadinessOf({ entry, sessionId, draft });
    if (readiness.action === "skip") {
      if (readiness.reason === "draft" && toastRef.current !== entry.token) {
        toastRef.current = entry.token;
        notify?.(tr("cosmos.actions.embryoDraftNotEmpty", "探索会话已有未发送输入，未改写"), true);
      }
      return;
    }
    if (readiness.action === "fill") {
      if (typeof inputActions.setDraft !== "function") return;
      if (fillRef.current === entry.token) return;
      fillRef.current = entry.token;
      inputActions.setDraft(entry.message);
      return;
    }
    if (busyRef.current) return;
    busyRef.current = true;
    consumePendingAction({
      pending,
      sessionId,
      draft,
      setDraft: typeof inputActions.setDraft === "function" ? (text) => inputActions.setDraft(text) : undefined,
      switchModel: switchModel === null ? undefined : (model) => switchModel(sessionId, model),
      submit: typeof inputActions.submit === "function" ? () => inputActions.submit() : undefined,
      notify,
      labels: {
        switchFailed: tr("cosmos.actions.switchFailed", "模型切换失败："),
        switchUnavailable: tr("cosmos.actions.switchUnavailable", "模型切换不可用：当前连接不支持")
      }
    }).catch((error) => {
      console.warn("[dsh-v-cosmos] embryo action consume failed:", error);
    }).finally(() => {
      busyRef.current = false;
    });
  }, [session, sessionId, draft, markerVersion, pending, inputActions]);

  return null;
}

/* ------------------------------------------------------------------ *
 * 整页组件
 * ------------------------------------------------------------------ */

/* 动作按钮投影（模块级稳定 face：apply 内绑定设置作用域后填充；页面只读订阅）。 */
const cosmosButtonsFace = createSnapshotStore({ buttons: [] });
/* 星座动作按钮投影（独立节、独立 face：与提案动作 face 互不读写）。 */
const cosmosConstButtonsFace = createSnapshotStore({ constellationButtons: [] });
/**
 * 当前皮肤投影（add-cosmos-skin-themes 3.1/3.4）：模块级 store——设置页「皮肤」页签点选 →
 * 本 store 更新（整页 React 侧 `applySkinTokens` 跟随）→ 已打开引擎 `setSkin`（呈现层热替）。
 * 冷启动值取持久化偏好（设置净房已枚举钳制：非法/未知 id 回落默认 `rosepine`）。
 */
const cosmosSkinStore = createSnapshotStore({
  skin: (function initialSkinId() {
    try {
      return loadCosmosSettings().skin;
    } catch {
      return COSMOS_DEFAULT_SKIN;
    }
  })()
});

/** 当前皮肤 id（注册表枚举内；净房已保证）。 */
function currentSkinId() {
  return cosmosSkinStore.getSnapshot().skin;
}

/**
 * 缩放导航 + 界面尺寸偏好投影（add-cosmos-zoom-focus-nav 3.2；add-cosmos-layout-tuning
 * 2.1 扩尺寸 12 键）：模块级 store——设置页「界面」页签的受控镜像；写入唯一链路 =
 * 控制器 `saveNav`（saveCosmosSettings → engine.setTuning → 本 store），冷启动值取持久化
 * 偏好（净房已钳制）。与皮肤 store 同构（设置页不依赖整页）；整页根容器订阅本 store
 * 把尺寸投影成 CSS 变量（`cosmosLayoutTokensOf`）→ 改动即时生效。
 */
const cosmosNavStore = createSnapshotStore(navPrefsOf(loadCosmosSettings()));

/** 完整设置 → 「界面」页签载荷投影（指针聚焦 + 界面尺寸 12 键；最小形）。
    缩放进入/返回阈值两键已退场（add-cosmos-zoom-ruler 3.1/D7）：阈值收敛为引擎常量，
    由顶部缩放标尺呈现，设置页不再有对应控件/镜像字段。 */
function navPrefsOf(settings) {
  return {
    zoomPointerFocus: settings.zoomPointerFocus,
    /* 界面尺寸（add-cosmos-layout-tuning D1/D2）：同页签受控镜像，页根令牌表由其派生。 */
    sessionPanelWidth: settings.sessionPanelWidth,
    sessionPanelHeight: settings.sessionPanelHeight,
    constPanelWidth: settings.constPanelWidth,
    constPanelHeight: settings.constPanelHeight,
    addBtnSize: settings.addBtnSize,
    hudBtnSize: settings.hudBtnSize,
    actionBtnWidth: settings.actionBtnWidth,
    actionBtnHeight: settings.actionBtnHeight,
    constActionHeight: settings.constActionHeight,
    searchWidth: settings.searchWidth,
    searchHeight: settings.searchHeight,
    wsTitleSize: settings.wsTitleSize
  };
}

/**
 * 「发送前编辑」呈现分支投影（add-cosmos-native-composer 4.1）：模块级 store——星座动作
 * 设置区的受控镜像（navFace 同构）。写入唯一链路 = 控制器 `savePreflight`
 * （saveCosmosSettings → 本 store），执行器每次 run 另读持久化值（保存即时生效）。
 * 冷启动值取持久化偏好（settings 净房已枚举钳制：非法 → `native`）。
 */
const cosmosPreflightStore = createSnapshotStore(preflightPrefsOf(loadCosmosSettings()));

/** 完整设置 → 「发送前编辑」单键投影（store 载荷最小形）。 */
function preflightPrefsOf(settings) {
  return { constPreflight: settings.constPreflight };
}

/* ------------------------------------------------------------------ *
 * 全局快捷键投影（add-cosmos-shortcuts 5.3）
 *
 * 模块级 store——设置页「快捷键」页签的受控镜像（navFace 同构）：写入唯一链路 =
 * 控制器 `saveShortcuts`（净房持久化 → 已打开引擎 `setShortcuts` 热更 → 本 store），
 * 冷启动值取持久化偏好（`shortcutsOf` 净房：池校验 + 读面冲突回落，恒无重复）。
 * 关闭链/按钮键分发/浮窗语音键一律经 ref 或本 store 读**当前生效**键位（不按配置重绑
 * 监听——仓库 effect 纪律：监听只绑一次，配置走 ref 读取）。
 * ------------------------------------------------------------------ */

const cosmosShortcutsStore = createSnapshotStore(shortcutsOf(loadCosmosSettings().shortcuts));

/** 当前生效快捷键表（净房后的四键副本；分发器/面板直接消费）。 */
function currentShortcuts() {
  return cosmosShortcutsStore.getSnapshot();
}

/* 两列表按钮草稿投影（跨域唯一性查重的数据面，spec cosmos-shortcuts「跨域唯一性校验」）：
   apply 内把两个按钮设置控制器的快照同步进本 store——「快捷键」页签与两个动作页签据此
   即时判定「全局键 × 按钮键 / 按钮键 × 按钮键 / 跨列表」冲突（行内定位 + 面板提示）。 */
const cosmosButtonDraftsStore = createSnapshotStore({ proposals: [], constellations: [] });

/** 两列表当前草稿（跨域查重输入；形状防御）。 */
function buttonDraftsOf() {
  const snapshot = cosmosButtonDraftsStore.getSnapshot();
  return {
    proposals: Array.isArray(snapshot?.proposals) ? snapshot.proposals : [],
    constellations: Array.isArray(snapshot?.constellations) ? snapshot.constellations : []
  };
}

/* ------------------------------------------------------------------ *
 * 浮窗打开态探针（add-cosmos-shortcuts 4.2/5.2/D13 模态让位）
 *
 * 浮窗（星座补写卡片）是模态上下文：打开时引擎侧 `goHome`/`togglePan` 与外壳按钮键
 * 分发 MUST NOT 生效（语音键与关闭键例外）。浮窗组件 armed 时计数 +1、卸载/收卡 -1；
 * 引擎经注入探针读取（零新增通信面），外壳分发器直接调用同一函数。
 * ------------------------------------------------------------------ */

let cosmosFloatArmedCount = 0;

/** 浮窗是否打开（模态让位判据；计数防御下界 0）。 */
function floatOpenOf() {
  return cosmosFloatArmedCount > 0;
}

/** 当前皮肤实例的调色面（恒星临终色等引擎级标记口径与皮肤同源）。 */
function activeSkinPalette() {
  return createSkin(currentSkinId()).palette;
}

/** 皮肤切换（唯一写者链路）：持久化 → store → 已打开引擎热切。 */
function applySkinSelection(id) {
  const merged = saveCosmosSettings({ skin: id });
  cosmosSkinStore.set({ skin: merged.skin });
  return merged.skin;
}

/**
 * 会话列表面板展开态投影（add-cosmos-session-list-panel 3.3 / design D6）：模块级 store——
 * 标题栏开合按钮与 Esc 分层共用同一写者 `setSessionPanelOpen`（持久化 → store；单一控制点，
 * 无第二写入口）。
 * 冷启动值取持久化偏好（settings 净房已保证布尔；无记录 → 缺省展开）。布局偏好与皮肤
 * 选择同级，**非**会话态（对照：搜索查询有「关页重置」明文约束，本键无）。
 */
const cosmosSessionPanelStore = createSnapshotStore({ open: sessionPanelInitialOpen() });

function sessionPanelInitialOpen() {
  try {
    return loadCosmosSettings().sessionPanelOpen !== false;
  } catch {
    return true;
  }
}

/** 当前会话面板展开态（净房后的布尔镜像；Esc 分层读它，MUST NOT 走陈旧闭包）。 */
function sessionPanelOpenOf() {
  return cosmosSessionPanelStore.getSnapshot().open === true;
}

/**
 * 会话面板展开态写入（唯一写者：标题栏开合按钮 / Esc 层同一 action 通道）。
 * @param {unknown} value 目标展开态（非布尔值按「展开」归一，防御上游形状漂移）
 * @returns {boolean} 净房后的实际展开态
 */
function setSessionPanelOpen(value) {
  const next = value !== false;
  const merged = saveCosmosSettings({ sessionPanelOpen: next });
  const applied = merged.sessionPanelOpen === true;
  cosmosSessionPanelStore.set({ open: applied });
  return applied;
}

/* ------------------------------------------------------------------ *
 * 动作执行队列投影 store（add-cosmos-action-queue 5.1 / design D1/D7）
 *
 * 队列权威在插件服务端（单执行器 + JSON 持久化 + 多窗口广播）；浏览器端**只做投影**
 * （spec「每星座单队列模型」：浏览器 MUST NOT 独立持有权威队列状态）：
 *  - 快照形状 `{status, revisedAt, queues, error?}`——`queues` 原样透传服务端
 *    `GET /api/dsh-v-cosmos/queue` 的 `queues` 映射（每星座
 *    `{paused, pausedAt, counts, entries}`）；本层不重组条目（呈现投影归 panel.mjs
 *    `projectQueuePanel`，条目无 prompt 正文）；
 *  - 写入唯一链路 = `refreshQueue()`：页面挂载（与 scene 拉取同批）、SSE
 *    `queue-changed` 轻帧（帧体无载荷 → 收到即拉全量对账）、队列操作成功后的主动对账；
 *    MUST NOT 引入固定轮询（spec「持久化与多窗口广播」）；
 *  - 拉取失败**保留旧快照**并记录 `error`（面板继续呈现上一份有效投影），绝不抛错、
 *    不阻断 SSE 重连自愈——与 scene 拉取同款容错纪律；
 *  - 快照对象稳定引用（`createSnapshotStore` 契约）：内容等价时**不 set**（防每次 SSE
 *    帧都触发全窗口重渲染）；`getSnapshot` 在两次 `set` 之间恒返回同一引用。
 * ------------------------------------------------------------------ */

const cosmosQueueStore = createSnapshotStore({ status: "idle", revisedAt: 0, queues: {} });

/** 在途快照拉取序号（乱序响应丢弃：只认最后一次 `refreshQueue` 的结果）。 */
let queueFetchSeq = 0;

/** 服务端全量快照 → 本层快照形状（`queues` 防御归一；缺省空映射）。 */
function queueSnapshotOf(queue) {
  const queues = queue?.queues !== null
    && typeof queue?.queues === "object"
    && !Array.isArray(queue.queues)
    ? queue.queues
    : {};
  return { status: "ready", revisedAt: Number(queue?.revisedAt) || 0, queues };
}

/** 快照内容等价判定（稳定引用防线：等价 → 不 set，订阅者零重渲染）。 */
function sameQueueSnapshot(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.status !== b.status || a.revisedAt !== b.revisedAt || (a.error ?? null) !== (b.error ?? null)) return false;
  try {
    return JSON.stringify(a.queues ?? {}) === JSON.stringify(b.queues ?? {});
  } catch {
    return false;
  }
}

/** 发布快照（等价短路；返回发布后的当前快照引用）。 */
function publishQueueSnapshot(next) {
  const current = cosmosQueueStore.getSnapshot();
  if (sameQueueSnapshot(current, next)) return current;
  cosmosQueueStore.set(next);
  return next;
}

/**
 * 队列快照刷新（唯一写者；幂等、容错、不抛）。
 * @returns {Promise<object>} 发布后的快照（失败时 = 保留旧投影 + `error` 记录）
 */
async function refreshQueue() {
  const seq = ++queueFetchSeq;
  let result;
  try {
    result = await fetchQueue();
  } catch (error) {
    /* fetchQueue 自带容错形；此处兜住极端同步异常（MUST NOT 让队列通道抛穿 UI）。 */
    result = { ok: false, error: String(error?.message || error) };
  }
  if (seq !== queueFetchSeq) return cosmosQueueStore.getSnapshot(); // 乱序响应：丢弃
  if (result?.ok === true) return publishQueueSnapshot(queueSnapshotOf(result.queue));
  const current = cosmosQueueStore.getSnapshot();
  return publishQueueSnapshot({
    status: current.status === "ready" ? "ready" : "error",
    revisedAt: current.revisedAt,
    queues: current.queues,
    error: String(result?.error || "queue fetch failed")
  });
}

/* ------------------------------------------------------------------ *
 * 选择失败可观测面（fix-cosmos-skin-select-feedback D1–D3）
 *
 * 「皮肤 / 导航」设置页签的写入链唯一存活依赖 = 整页控制器（controllerRef.current）。
 * 控制器缺席时旧实现以可选链静默回落（点了等于没点），本通道把失败变成可观测事实：
 *  - 独立 health store（不混入偏好真相 store 的快照形状）：载荷最小形
 *    `{ lastFailure: null | { face: "skin"|"nav", code: "controller-missing", at } }`；
 *  - 写守卫（D1）：同 face 同 code 已记录时复用现有快照引用（不 set、不刷新 at），
 *    连续点击不触发多余渲染；
 *  - 警告纪律（D2）：仅状态迁移（null→failure 或 face/code 变化）落印并 console.warn
 *    一次，成功后复位；SHALL NOT 抛错中断设置页渲染；
 *  - 观测面（D3）：`cosmosSelectHealthOf()` 读控制器存活 + 最近失败原因码，冒烟直测。
 * ------------------------------------------------------------------ */

/** 首期唯一原因码（face 缺失在面板侧静态可判，不经此通道）。 */
const SELECT_FAILURE_CONTROLLER_MISSING = "controller-missing";

const cosmosSelectHealthStore = createSnapshotStore({ lastFailure: null });

/** 当前失败记录是否仍处于「已警告」状态（成功路径复位）。 */
let cosmosSelectWarned = false;

/**
 * 标记一次「整页控制器缺失」失败（face 调用边界专用；幂等）。
 * @param {"skin"|"nav"|"preflight"|"shortcuts"} face 失败所属设置页签
 */
function markSelectFailure(face) {
  const current = cosmosSelectHealthStore.getSnapshot().lastFailure;
  const same = current !== null
    && typeof current === "object"
    && current.face === face
    && current.code === SELECT_FAILURE_CONTROLLER_MISSING;
  if (same) return; // 写守卫：同因复用现有快照引用（不 set、不刷新 at）
  cosmosSelectWarned = false; // 状态迁移 → 该状态允许一次新警告
  cosmosSelectHealthStore.set({
    lastFailure: { face, code: SELECT_FAILURE_CONTROLLER_MISSING, at: Date.now() }
  });
  if (!cosmosSelectWarned) {
    cosmosSelectWarned = true;
    console.warn("[dsh-v-cosmos] " + face + " select dead: " + SELECT_FAILURE_CONTROLLER_MISSING);
  }
}

/** 成功路径清除历史失败（提示条自动消失 = 自愈），并复位警告标记。 */
function clearSelectFailure() {
  cosmosSelectWarned = false;
  if (cosmosSelectHealthStore.getSnapshot().lastFailure !== null) {
    cosmosSelectHealthStore.set({ lastFailure: null });
  }
}

/**
 * 选择失败观测面（D3，冒烟直测入口；无 DOM 依赖）。
 * @returns {{controllerAlive: boolean, lastFailure: null | {face: string, code: string, at: number}}}
 */
function cosmosSelectHealthOf() {
  return {
    controllerAlive: controllerRef.current != null,
    lastFailure: cosmosSelectHealthStore.getSnapshot().lastFailure
  };
}

const CosmosPageOverlay = function CosmosPageOverlay(props) {
  const open = useCosmosOpen();
  if (!open) return null;
  return <CosmosSurface mode="overlay" {...props} />;
};

/**
 * 右栏停靠正文（add-cosmos-rightbar-dock D1/D3/D4）：复用整页引擎与面板组件的
 * 同一条 `CosmosSurface` 链路（数据通道 / 动作 / 皮肤 / HUD 全同源），只换承载容器与
 * 键盘纪律——dock 正文内**不注册全局 Esc 分层**（Esc 归宿主会话视图，Cosmos 零消费），
 * 跳转尾巴由执行器 closePage 分流保持 tab。宿主正文槽卸载即 detach 引擎（不声明
 * keepMounted；切 tab / 切会话 / 收起右栏 → 重挂载，场景单次重拉 + SSE 自愈）。
 * @param {{t?: Function, useTabInfo?: Function}} props 槽框架标准 props
 */
function CosmosDockBody(props) {
  const useTabInfo = typeof props.useTabInfo === "function" ? props.useTabInfo : null;
  const tabInfo = useTabInfo ? useTabInfo() : null;
  const visible = tabInfo?.tab?.visible !== false;
  return <CosmosSurface mode="dock" t={props.t} visible={visible} />;
}

/* UI 铬件矩形契约的收集表（polish-cosmos-tip-ui-avoidance 2.1 / design D2）：
   `[选择器, 类别]`——类别随矩形一并发布给引擎，用途有二：
   (1) D3 自遮挡排除（引擎自建 HUD：`wsbar-left/right` 条目槽、`home`、`dragpan` 的
       避让判定必须忽略自身族矩形，否则永远与自己相交）；
   (2) 冒烟断言可辨识的矩形来源。
   **选择器与类别 MUST 单点维护**（此处），引擎与测试 MUST NOT 另抄一份清单。
   `dsh-cosmos-const-float`（星座浮窗）不在此列：它是 `inset:0` + z-9998 的全屏模态，
   其矩形恒等于整屏——引擎侧直接消费既有 `isFloatOpen` 探针即可等价覆盖（零矩形通道、
   零开合订阅），故不必为它建发布触发面。 */
const COSMOS_CHROME_RECTS = [
  [".dsh-cosmos-panel", "panel"],
  [".dsh-cosmos-queue", "queue"],
  [".dsh-cosmos-sessions", "sessions"],
  [".dsh-cosmos-actions", "actions"],
  [".cos-add-btn", "add"],
  [".cos-search", "search"],
  [".cos-home-btn", "home"],
  [".cos-dragpan-btn", "dragpan"],
  ['.cos-wsbar-side[data-side="left"]', "wsbar-left"],
  ['.cos-wsbar-side[data-side="right"]', "wsbar-right"]
];
/* 只在钻取态呈现的类别（银河态槽位仍有布局盒但视觉不可见）：未呈现期 MUST NOT 参与
   判定——否则顶部中央会凭空多出一条隐形阻挡带（chip 点不动）。 */
const COSMOS_CHROME_DRILL_ONLY = new Set(["wsbar-left", "wsbar-right"]);

/* 顶部缩放标尺 tick 的轨道位置（%，add-cosmos-zoom-ruler 2.1/D6）：与引擎
   `zoomMeterTrackOf` 同源单次计算——窗口 resize 不改变对数刻度，无需重算。 */
const ZOOM_RULER_TICK_PCT = zoomMeterTrackOf(ZOOM_RULER_TICK, ZOOM_RULER_DIST_MIN, ZOOM_RULER_DIST_MAX) * 100;

/**
 * Cosmos 呈现面（整页覆盖 / 右栏停靠共享）。
 * @param {object} props `mode` = overlay | dock；其余为槽框架标准 props
 *        （t / useStore / setFullscreen）+ dock 的 `visible`（tab 可见性）
 */
function CosmosSurface(props) {
  const { t, useStore, setFullscreen } = props;
  const mode = props.mode === "dock" ? "dock" : "overlay";
  const dock = mode === "dock";
  /* dock 正文的可见性（宿主 tab 可见性；overlay 恒 true）。 */
  const dockVisible = props.visible !== false;
  /* store props 防御（hive 有 store 注入 useStore/actions；宿主形态差异时降级——
     全屏恒关，Esc 直达关页，页面开合/引擎不受影响）。 */
  const fullscreen = typeof useStore === "function" ? useStore((s) => s.fullscreen) : false;
  const exitFullscreen = () => {
    try {
      setFullscreen?.(false);
    } catch {
      /* store 缺席等框架差异——忽略，Esc 下一层关页 */
    }
  };

  const frameRef = useRef(null);
  const measuredRef = useRef(null);
  /* overlay 才测量侧栏右缘；dock 由停靠列几何决定（hook 恒调用，保持 Hook 顺序）。 */
  const pageLeft = usePageLeft(frameRef, measuredRef);
  const degraded = pageLeft === null;
  const hostRef = useRef(null);

  /* 关闭整页（Esc 分层末层唯一写点；dock 正文不消费 Esc，此回调仅在 overlay 生效）。 */
  const close = () => cosmosOpenStore.set(false);

  /* 全局快捷键生效表（add-cosmos-shortcuts 5.1/5.2）：受控镜像订阅——关闭链、搜索框
     聚焦层、按钮键分发与浮窗提示全部经此读取「当前生效键位」。effect 依赖**不含**配置
     （经 ref 读取，监听绑定一次；陈旧闭包纪律沿用）。 */
  const shortcuts = useSyncExternalStore(cosmosShortcutsStore.subscribe, cosmosShortcutsStore.getSnapshot);

  /* 搜索过滤（add-cosmos-search-filter 3.2/3.3）：受控输入 + 查询 ref。
     查询经 ref 供外壳 Esc 分层读取——keydown effect 不把 query 放依赖（防陈旧闭包
     与监听随键重绑）。 */
  const filter = useFilterState();
  const query = filter.query;
  const queryRef = useRef("");
  const [searchFocused, setSearchFocused] = useState(false);
  /* 新增工作区 busy 态（add-cosmos-add-workspace 4.1/4.4）：pick → create 全程按钮
     disabled；服务侧另有控制器 busy 门（双保险，UI 状态滞后也不重入）。 */
  const [adding, setAdding] = useState(false);
  const addWorkspace = async () => {
    if (adding) return;
    setAdding(true);
    try {
      await controllerRef.current?.actions.addWorkspace?.();
    } finally {
      setAdding(false);
    }
  };
  const tr = (key, fallback) => {
    try {
      const value = typeof t === "function" ? t(key) : null;
      return typeof value === "string" && value && value !== key ? value : fallback;
    } catch {
      return fallback;
    }
  };
  const applyQuery = (next) => {
    const value = typeof next === "string" ? next : String(next ?? "");
    queryRef.current = value;
    controllerRef.current?.actions.setFilter(value);
  };
  /* 「无匹配工作区」空态（React 层 / D6）：有工作区但命中 0 个才显示；场景无任何
     工作区时由引擎「暂无在册工作区」空态独显（互斥）。 */
  const showNoMatch = filter.active && filter.total > 0 && filter.matched === 0;

  /* ── 提案列表面板 + 动作按钮条（add-cosmos-proposal-actions 3.x/4.x） ──
     数据源 = 同一份合并场景（sceneVersionStore 通知刷新）；面板投影走纯函数
     projectPanel（钻取态过滤 + 搜索过滤联动）。 */
  const sceneVersion = useSceneVersion();
  const drill = useDrill();
  /* 引擎选中镜像（add-cosmos-selection-linkage 3.1/3.2）：视图 → 面板的反向通道。 */
  const engineSel = useEngineSelection();
  /* 跨面板悬停（p2-add-cosmos-cross-hover-markers 1.2）：引擎画布悬停只读镜像 +
     面板行/卡本地悬停态（DOM 事件生命周期与组件同寿，卸载自清）。 */
  const engineHover = useEngineHover();
  const [panelHover, setPanelHover] = useState(null);
  /* 会话列表面板展开态（add-cosmos-session-list-panel 3.3）：整页 = settings 持久化
     偏好的只读镜像；dock = **本地态**（默认折叠，窄列优先让出画布；开合不污染整页
     持久偏好——同一插件的两种承载形态互不牵连）。 */
  const [dockSessionPanelOpen, setDockSessionPanelOpen] = useState(false);
  const sessionPanelState = useSyncExternalStore(
    cosmosSessionPanelStore.subscribe,
    cosmosSessionPanelStore.getSnapshot
  );
  const sessionPanelOpen = dock ? dockSessionPanelOpen : sessionPanelState.open === true;
  const buttonsState = useSyncExternalStore(
    (listener) => cosmosButtonsFace.subscribe(listener),
    () => cosmosButtonsFace.getSnapshot()
  );
  const buttons = buttonsState.buttons;
  /* 星座动作按钮（add-cosmos-constellation-actions 2.2/3.1）：独立投影，仅钻取态消费。 */
  const constButtonsState = useSyncExternalStore(
    (listener) => cosmosConstButtonsFace.subscribe(listener),
    () => cosmosConstButtonsFace.getSnapshot()
  );
  const constButtons = Array.isArray(constButtonsState.constellationButtons) ? constButtonsState.constellationButtons : [];
  const [selectedKey, setSelectedKey] = useState(null);
  const selectedCard = useMemo(() => {
    if (!selectedKey) return null;
    const scene = controllerRef.current?.getScene?.() ?? null;
    return findCard(projectPanel(scene), selectedKey);
  }, [sceneVersion, selectedKey]);
  /* 前置状态门控（add-cosmos-action-prestate-gate 2.2）：**渲染前过滤**——预置状态
     按钮仅当选中目标 lifecycle 匹配且沉睡（act === 0）时渲染；未设 preState 恒显示。
     选中目标/骨架刷新（sceneVersion）都会重算；过滤后空列表由 ActionBar 零布局。 */
  const actionButtons = useMemo(() => {
    const list = Array.isArray(buttons) ? buttons : [];
    return list.filter((button) => actionButtonVisible(button, selectedCard));
  }, [buttons, selectedCard]);

  /* ── 动作执行队列（add-cosmos-action-queue 5.1–5.4 / spec cosmos-action-queue
     「队列呈现（面板与配套入队钮）」「持久化与多窗口广播」）──
     数据源 = 模块级 `cosmosQueueStore`（服务端全量快照的只读投影；浏览器 MUST NOT 持有
     权威队列状态）；写入唯一链路 = `refreshQueue()`（页面挂载 / SSE `queue-changed`
     轻帧 / 队列操作成功后对账）。
     **作用域（显式设计决策，见 panel.mjs `queueScopeOf`）**：`drillWsId ?? selectedWsId`
     ——钻取态恒显示钻取星座的队列；银河态随**选中提案所属星座**显示（队列面板是动作条
     的配套面，无选中即无动作目标）；两者皆无或该星座队列为空 → 不渲染（零布局）。 */
  const queueSnapshot = useSyncExternalStore(cosmosQueueStore.subscribe, cosmosQueueStore.getSnapshot);
  const queueScope = useMemo(
    () => queueScopeOf({
      drillWsId: drill?.wsId ?? null,
      selectedWsId: selectedCard?.wsId ?? null,
      queues: queueSnapshot?.queues ?? {}
    }),
    [queueSnapshot, drill?.wsId, selectedCard?.wsId]
  );
  const queueModel = useMemo(
    () => (queueScope === null
      ? null
      : projectQueuePanel({
        queue: queueSnapshot?.queues?.[queueScope] ?? null,
        wsId: queueScope,
        now: Date.now()
      })),
    [queueSnapshot, queueScope]
  );
  /* 「已在队列中」键集（入队钮禁用判定；仅 queued 命中——终态残留不构成重复）。 */
  const queuePendingKeys = useMemo(() => queuePendingKeysOf(queueSnapshot), [queueSnapshot]);
  /* 入队请求在途门（按 wsId/proposalId/buttonName 三元组）：ref = 同步权威判定（防同一帧
     连点双发），state 副本 = 声明式禁用/重渲染触发。 */
  const enqueueBusyRef = useRef(new Set());
  const [enqueueBusy, setEnqueueBusy] = useState({});

  const panelModel = useMemo(() => {
    const scene = controllerRef.current?.getScene?.() ?? null;
    /* 搜索命中集合与引擎过滤同源（matchWorkspaces 纯函数）：面板分组跟随命中集合，
       查询清空恢复全量。 */
    const matchedIds = filter.active && scene ? matchWorkspaces(scene, filter.query) : null;
    return projectPanel(scene, { drillWsId: drill?.wsId ?? null, matchedIds });
  }, [sceneVersion, filter.query, filter.active, drill?.wsId]);

  /* ── 会话列表面板（add-cosmos-session-list-panel 2.1/2.2）──
     数据源 = 同一份合并场景（行星∪彗星 = 活跃会话），投影走纯函数 projectSessionPanel
     （银河/钻取作用域 + 组内 updatedAt 排序 + 待决策计数）；随 sceneVersionStore 刷新，
     MUST NOT 新增轮询。 */
  const sessionModel = useMemo(() => {
    const scene = controllerRef.current?.getScene?.() ?? null;
    return projectSessionPanel(scene, { drillWsId: drill?.wsId ?? null });
  }, [sceneVersion, drill?.wsId]);

  /* ── 跨面板悬停合流（p2-add-cosmos-cross-hover-markers 1.2/2.1/2.2）──
     三源 → 单一悬停描述 → 受体集：
      - 引擎源（画布指针拾取）优先级最高（仲裁沿用 p1：画布 hover > 面板注入 > 选中）；
      - 面板源（行/卡 mouseenter）在引擎源为空时接管；离场即 null。
     受体集由 `crossHoverTargets` 纯函数按悬停源的 `wsId` 单星座派生；`crossHover` 是
     下发给两侧面板的**单一**悬停描述（叠加 `sessionIds` / `proposalIds` 受体集）。 */
  const mergedHover = useMemo(() => {
    if (engineHover && typeof engineHover.kind === "string") {
      return { source: "canvas", kind: engineHover.kind, wsId: engineHover.wsId, id: engineHover.id };
    }
    return panelHover;
  }, [engineHover, panelHover]);
  const crossHover = useMemo(() => {
    if (!mergedHover) return null;
    const scene = controllerRef.current?.getScene?.() ?? null;
    const ws = (Array.isArray(scene?.workspaces) ? scene.workspaces : [])
      .find((item) => item && item.id === mergedHover.wsId) ?? null;
    if (!ws) return null;
    const targets = crossHoverTargets(mergedHover, ws);
    return { ...mergedHover, sessionIds: targets.sessionIds, proposalIds: targets.proposalIds };
  }, [mergedHover, sceneVersion]);

  /* 行选中镜像（视图 → 面板反向通道同款）：引擎选中的行星/彗星 → 会话行高亮键。
     恒星选中不映射会话行（两套列表面相对独立）。 */
  const selectedSessionKey = engineSel && (engineSel.kind === "planet" || engineSel.kind === "comet") && engineSel.wsId
    ? sessionKeyOf(engineSel.wsId, engineSel.id)
    : null;

  /* 会话面板三个动作：点行 = 引擎选中联动（不关页）；「打开」= 官方导航链路（关整页）；
     「归档」= 既有归档执行链路的行内入口（add-cosmos-session-row-archive D1）——与
     `openSessionRow` 同款纯转发：请求组装 / outcome 映射 / toast 全部留在执行体内，
     信息卡的 `onArchiveSession` 引擎注入位已存在，本路径零新增注入、两入口同一执行体。 */
  const toggleSessionPanel = () => {
    if (dock) {
      setDockSessionPanelOpen((open) => !open);
      return;
    }
    setSessionPanelOpen(!sessionPanelOpenOf());
  };
  const focusSessionRow = (row) => {
    if (!row) return;
    /* 行选中 = 引擎选中联动 + 宿主会话切换（polish-cosmos-session-focus-and-hover-markers
       2.2）：先走既有 focusBody（钻取/选中/信息卡），再经 controller 把该会话切为主壳
       当前会话（不关整页）。宿主切换使目标成为 mainView，官方 completionUnread 清除 →
       「已完成未读」绿色经既有场景刷新回落 idle；两路互不阻断（任一缺席静默降级）。 */
    controllerRef.current?.focusSession?.({ wsId: row.wsId, id: row.id });
    controllerRef.current?.openSessionInPlace?.(row.id);
  };
  const openSessionRow = (row) => {
    if (!row) return;
    controllerRef.current?.actions?.openSession?.(row.id);
  };
  const archiveSessionRow = (row) => {
    if (!row) return undefined;
    return controllerRef.current?.actions?.archiveSession?.(row.id);
  };

  /* ── 面板悬停接线（p2-add-cosmos-cross-hover-markers 1.3 / design D5）──
     单点绑在行容器/卡容器：行内「打开」「归档」按钮的 hover 穿透同一行事件（React
     mouseenter/leave 不冒泡重复触发）。行/正式卡悬停 → 合流描述 + 引擎注入（画布 tips /
     关系段）；星胚合并卡只出（参与标记派生），不注入（多 slug 无单一目标）；离场 → 注入
     null。独立窗口座位锁定态（会话导航不可用）下会话行不注入——MUST NOT 让画布 tips 指向
     一个无法打开的会话；面板侧标记呈现不受影响。 */
  const hoverSessionRow = (row, entering) => {
    if (!row) return;
    if (entering) {
      setPanelHover({ source: "row", wsId: row.wsId, kind: row.kind, id: row.id });
      controllerRef.current?.setExternalHover?.({ wsId: row.wsId, kind: row.kind, id: row.id });
      return;
    }
    setPanelHover(null);
    controllerRef.current?.setExternalHover?.(null);
  };
  const hoverProposalCard = (card, entering) => {
    if (!card) return;
    if (!entering) {
      setPanelHover(null);
      controllerRef.current?.setExternalHover?.(null);
      return;
    }
    if (card.isEmbryo === true) {
      setPanelHover({
        source: "embryo",
        wsId: card.wsId,
        kind: "proto",
        id: card.id,
        slugs: Array.isArray(card.slugs) ? card.slugs : []
      });
      return; // 星胚合并卡不注入引擎（p1 注入契约为单目标）
    }
    setPanelHover({ source: "card", wsId: card.wsId, kind: "star", id: card.id });
    controllerRef.current?.setExternalHover?.({ wsId: card.wsId, kind: "star", id: card.id });
  };

  /* 场景刷新残留清理（design D6 / tasks 3.2）：源实体键（源行键/源卡键）不在新清单
     （归档 / 摘除）→ 合流层清除悬停并注入 null；引擎侧目标摘除的自清由 p1 置空通知承接
     （`engineHoverStore` 随 onHoverChange(null) 归零），两侧收场无残影。 */
  useEffect(() => {
    if (!panelHover) return;
    const scene = controllerRef.current?.getScene?.() ?? null;
    if (hoverSourceAlive(scene, panelHover)) return;
    setPanelHover(null);
    controllerRef.current?.setExternalHover?.(null);
  }, [sceneVersion, panelHover]);

  /* 星座动作目标（add-cosmos-constellation-actions 2.2/3.1）：当前钻取星座的分组
     （projectPanel 钻取态输出，携带权威解析所需的 `wsPath`——drillStore 镜像只有
     `{wsId, name}`）。空星座在钻取态仍生成分组（空态文案），故挂点与卡片数解耦；
     钻取目标注销时 engine 把 drill 归零 → 这里为 null → 动作条消失。 */
  const drillGroup = useMemo(() => {
    if (!drill) return null;
    const scene = controllerRef.current?.getScene?.() ?? null;
    const panel = projectPanel(scene, { drillWsId: drill.wsId });
    const group = panel.groups.find((item) => item.wsId === drill.wsId) ?? null;
    if (!group) return null;
    return { wsId: group.wsId, wsName: group.wsName, wsPath: group.wsPath };
  }, [sceneVersion, drill?.wsId]);

  /* 目标消失（归档/工作区注销）→ 立即清除选中（spec「目标消失清除选中」）。 */
  useEffect(() => {
    if (!selectedKey) return;
    const scene = controllerRef.current?.getScene?.() ?? null;
    if (!findCard(projectPanel(scene), selectedKey)) setSelectedKey(null);
  }, [sceneVersion, selectedKey]);

  /* 引擎选中 → 面板选中映射（add-cosmos-selection-linkage 3.2 / D3/D6）：
     仅「可列提案的恒星」（kind = star 且 lifecycle 非 proto）联动；行星/彗星（会话，无提案
     对应物）、星胚（面板不列，写入会成为幽灵键）与引擎清空一律不动面板选中——面板选中的
     清除只由既有「点击选中作用面以外」语义承担，空白画布点击双侧自然同清。
     写入前经 allCards 查表双保险（查表兜住「通知先于骨架就绪」的时序差）；函数式 setState
     做同键短路——回声不产生额外渲染，且不把 selectedKey 纳入依赖（否则用户切卡会被仍在
     引擎选中态里的恒星反复拽回）。 */
  useEffect(() => {
    if (!engineSel || engineSel.kind !== "star" || engineSel.lifecycle === "proto") return;
    if (!engineSel.wsId || !engineSel.id) return;
    const key = proposalKeyOf(engineSel.wsId, engineSel.id);
    const scene = controllerRef.current?.getScene?.() ?? null;
    if (!findCard(projectPanel(scene), key)) return;
    setSelectedKey((current) => (current === key ? current : key));
  }, [engineSel]);

  /* 「点击 vs 拖拽」起点（页面级 pointerdown 记录；取消选中的点击判据）。 */
  const selectionTapRef = useRef(null);

  /* 动作条高度 → 页面 CSS 变量（面板底部让位、引擎 toast 上移）；按钮列表变化时重测。 */
  const actionBarRef = useRef(null);
  const [actionsHeight, setActionsHeight] = useState(0);
  useEffect(() => {
    const el = actionBarRef.current;
    if (!el) {
      setActionsHeight(0);
      return undefined;
    }
    const sync = () => setActionsHeight(el.offsetHeight || 0);
    sync();
    let observer = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(sync);
      observer.observe(el);
    }
    return () => observer?.disconnect();
  }, [actionButtons.length]);

  /* 动作条滚轮缩放转发（spec「动作按钮条上滚轮缩放保持生效」+「动作条上滚轮向指针聚焦」）：
     动作条是引擎容器的兄弟层，事件不进容器级绑定 → 显式非被动监听调 engine.zoomBy
     （同一缩放语义）。随转发携带**原始视图坐标**（clientX/clientY）——换算职责留在
     引擎侧（canvas rect 单源 `canvasPointOf`），聚焦收敛/端点冻结/开关回落全部复用容器内
     滚轮同一段逻辑；公共面恒 `judge:false`（滚轮缩放不触发缩放阈值导航）。 */
  useEffect(() => {
    const el = actionBarRef.current;
    if (!el) return undefined;
    const onWheel = (event) => {
      event.preventDefault();
      controllerRef.current?.getEngine()?.zoomBy?.(event.deltaY, {
        clientX: event.clientX,
        clientY: event.clientY
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [actionButtons.length]);

  /* ── 动作队列操作（add-cosmos-action-queue 5.2–5.4 / design D6/D7）──
     全部经 `queueAction` 单点动词；成功 toast + `refreshQueue()` 对账（服务端同时广播
     `queue-changed`，双重安全）；失败按契约错误码映射 toast（MUST NOT 静默吞错）。 */

  /** 队列提示（引擎 toast 单文本通道；控制器缺席 → 静默 no-op，不阻断队列操作）。 */
  const queueToast = (text) => {
    if (!text) return;
    try {
      controllerRef.current?.getEngine?.()?.toast?.(text);
    } catch {
      /* 引擎不可达：静默（队列状态仍由 refreshQueue 对账呈现） */
    }
  };

  /** 失败码 → 提示文案（契约错误族逐一映射；未知码透出原文）。 */
  const queueFailureText = (result, fallback) => {
    const code = typeof result?.error === "string" ? result.error : "";
    if (code === "duplicate") return tr("cosmos.queue.duplicate", "已在队列中");
    if (code === "limit") return tr("cosmos.queue.limit", "队列已满（32）");
    if (code === "gate") return tr("cosmos.queue.gate", "前置状态不匹配");
    /* 宿主半区尚未加载队列路由（旧宿主进程 / 未重启）→ 明确指引而不是抛生硬的 unknown route。 */
    if (code === "unknown route") {
      return tr("cosmos.queue.hostStale", "宿主半区未加载队列接口：请重启 DSH 后重试");
    }
    if (code === "locked") return tr("cosmos.queue.locked", "执行中条目不可操作");
    if (code === "neighbor-locked") return tr("cosmos.queue.neighborLocked", "相邻条目不可调整（仅等待中的条目可排序）");
    if (code === "boundary") return tr("cosmos.queue.boundary", "已到队列边界");
    if (
      code === "missing"
      || code === "workspace/unknown"
      || code === "proposal/unknown"
      || code === "button/unknown"
    ) {
      return tr("cosmos.queue.missing", "目标已不在队列中（可能已被其他窗口移除）");
    }
    const message = typeof result?.message === "string" && result.message ? result.message : code;
    return message ? fallback + "：" + message : fallback;
  };

  /* 配套入队钮（spec「入队链路与前置状态复验」）：只经服务端 `queue/enqueue` 落快照条目，
     MUST NOT 导航、MUST NOT 打草稿、MUST NOT 调 `runAction`、MUST NOT 消耗动作条点击
     冷却门（`createActionGate`）——入队不是执行（design D7）。点击瞬间按当前场景重取
     目标卡片并复验门控（与主按钮同谓词；骨架秒级刷新窗口内不过即静默 no-op）。 */
  const enqueueAction = async (button) => {
    if (!button || !selectedKey) return;
    const scene = controllerRef.current?.getScene?.() ?? null;
    const card = findCard(projectPanel(scene), selectedKey);
    if (!card || !actionButtonVisible(button, card)) return;
    const busyGate = enqueueBusyRef.current;
    const key = queueEnqueuedKeyOf(card.wsId, card.id, button.name);
    if (busyGate.has(key)) return;
    busyGate.add(key);
    setEnqueueBusy((current) => (current[key] === true ? current : { ...current, [key]: true }));
    try {
      const result = await queueAction("enqueue", {
        wsId: card.wsId,
        proposalId: card.id,
        buttonName: button.name
      });
      if (result?.ok === true) {
        queueToast(tr("cosmos.queue.enqueued", "已加入自动队列"));
      } else {
        queueToast(queueFailureText(result, tr("cosmos.queue.enqueueFailed", "加入队列失败")));
      }
      await refreshQueue();
    } finally {
      busyGate.delete(key);
      setEnqueueBusy((current) => {
        if (current[key] !== true) return current;
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  };

  /* 入队钮禁用/提示（spec「配套钮与主按钮同门控」+「重复入队拒绝」）：与主按钮同批
     （同一 actionButtons 过滤列表），已排队（**仅 queued 命中**——failed/skipped 残留
     不构成禁用，与服务端重复判定同口径，见 `queuePendingKeysOf`）或在途请求 → 禁用。 */
  const enqueueStateOf = (button) => {
    if (!selectedCard || !button) return null;
    const key = queueEnqueuedKeyOf(selectedCard.wsId, selectedCard.id, button.name);
    if (enqueueBusy[key] === true || enqueueBusyRef.current.has(key)) {
      return { disabled: true, title: tr("cosmos.queue.enqueuing", "正在加入…") };
    }
    if (queuePendingKeys.has(key)) {
      return { disabled: true, title: tr("cosmos.queue.pending", "已在队列中") };
    }
    return null;
  };

  /** 暂停 / 继续（暂停只挡收尾后的 advance，MUST NOT 干预 executing 条目——服务端语义）。 */
  const toggleQueuePaused = async () => {
    if (!queueModel) return;
    const wasPaused = queueModel.paused === true;
    const result = await queueAction(wasPaused ? "resume" : "pause", { wsId: queueModel.wsId });
    if (result?.ok === true) {
      queueToast(wasPaused
        ? tr("cosmos.queue.resumed", "队列已继续")
        : tr("cosmos.queue.pausedNotice", "队列已暂停（当前条目照常执行）"));
    } else {
      queueToast(queueFailureText(result, tr("cosmos.queue.opFailed", "队列操作失败")));
    }
    await refreshQueue();
  };

  /** 清空（一次确认在面板内完成；只清 queued 与终态残留，executing 由服务端保留）。 */
  const clearQueue = async () => {
    if (!queueModel) return;
    const result = await queueAction("clear", { wsId: queueModel.wsId });
    if (result?.ok === true) {
      const removed = Number(result.removed);
      queueToast(Number.isFinite(removed) && removed > 0
        ? "已清空 " + removed + " 个条目"
        : tr("cosmos.queue.cleared", "队列已清空"));
    } else {
      queueToast(queueFailureText(result, tr("cosmos.queue.clearFailed", "清空队列失败")));
    }
    await refreshQueue();
  };

  /** 前移 / 后移（仅 queued；邻位非 queued 由服务端拒绝、前端已禁用）。 */
  const reorderQueueEntry = async (row, direction) => {
    if (!row || !row.id) return;
    const result = await queueAction("reorder", { wsId: row.wsId, entryId: row.id, direction });
    if (result?.ok !== true) {
      queueToast(queueFailureText(result, tr("cosmos.queue.reorderFailed", "调整顺序失败")));
    }
    await refreshQueue();
  };

  /** 移出（queued 与 failed/skipped 残留；executing 锁定）。 */
  const removeQueueEntry = async (row) => {
    if (!row || !row.id) return;
    const result = await queueAction("remove", { wsId: row.wsId, entryId: row.id });
    if (result?.ok !== true) {
      queueToast(queueFailureText(result, tr("cosmos.queue.removeFailed", "移出队列失败")));
    }
    await refreshQueue();
  };

  /* 队列条目 hover → 复用既有 cross-hover（spec「队列条目联动提案卡」）：悬停描述与
     正式提案卡**同构**（`kind:"star"`；仅 `source` 标记为 queue——`hoverSourceAlive`
     据此放宽星胚存活判定，见 panel.mjs）；离场 → 清空 + 引擎注入 null（与
     `hoverProposalCard` 同款）。 */
  const hoverQueueEntry = (row, entering) => {
    if (!row || !row.proposalId) return;
    if (!entering) {
      setPanelHover(null);
      controllerRef.current?.setExternalHover?.(null);
      return;
    }
    setPanelHover({ source: "queue", wsId: row.wsId, kind: "star", id: row.proposalId });
    controllerRef.current?.setExternalHover?.({ wsId: row.wsId, kind: "star", id: row.proposalId });
  };

  /* 执行链路（4.3）：组装 → 登记标记 → startSession → 按该按钮的跳转配置关闭/保持
     整页（控制器内防重入/失败清理）。
     点击瞬间按**当前场景**重取目标卡片并复验门控（add-cosmos-action-prestate-gate 2.3：
     骨架刷新有秒级延迟窗口，谓词不过即无动作）；星胚按钮由控制器分流到探索会话链路。 */
  const runAction = async (button) => {
    const controller = controllerRef.current;
    if (!controller || !selectedKey) return;
    const scene = controller.getScene?.() ?? null;
    const card = findCard(projectPanel(scene), selectedKey);
    if (!card || !actionButtonVisible(button, card)) return;
    await controller.actions.runButton({ button, card });
  };

  /* 星胚旧锚点（无 sessionId）→ 按钮禁用 + title 提示（spec「旧锚点禁用提示」：
     不组装、不导航；锚点由后续 explore 重写即自愈）。 */
  const actionButtonStateOf = (button) => {
    if (button?.preState !== "proto") return null;
    if (!selectedCard || selectedCard.lifecycle !== "proto") return null;
    if (typeof selectedCard.sessionId === "string" && selectedCard.sessionId) return null;
    return { disabled: true, title: tr("cosmos.actions.embryoNoSession", "缺少探索会话关联") };
  };

  /* 星座动作链路（add-cosmos-constellation-actions 2.2/3.1）：目标 = 当前钻取星座分组；
     不关页、autoSend 分流、共享冷却门均在控制器执行体内。 */
  const runConstAction = async (button) => {
    const controller = controllerRef.current;
    if (!controller || !drillGroup) return;
    await controller.actions.runConstButton({ button, group: drillGroup });
  };

  /* ── 动作条键盘快捷键分发（add-cosmos-shortcuts 5.2 / spec cosmos-actions「动作条键盘
     快捷键触发」、spec cosmos-constellation-actions「星座动作条键盘快捷键触发」）──
     canonical → 按钮映射（useMemo 重建 + ref 同步给一次绑定的监听 effect）：
      - 数据面 = 已做 preState 渲染过滤的两条动作条按钮列表（隐藏按钮无键通道）；
      - 门控与点击完全等效：提案侧「动作条点亮（有选中）」+ 行级禁用 + 控制器防重入门；
        星座侧「钻取态（drillGroup 存在）」；两者弹 toast/执行链路全部复用点击路径；
      - 守卫（D12 分档）：repeat / IME / **可编辑元素聚焦**；**不含 chrome 聚焦守卫**
        （`isUiChromeTarget` 覆盖提案/会话面板，而「点击卡片选中提案后按键」正是主流程——
        焦点滞留在卡片按钮上；新键位非原生激活、面板内数字/功能键无面板语义）、
        浮窗模态让位、Shift/Meta 跳过（Ctrl/Alt 交 canonical 精确匹配）；
      - 与全局键漂移防御：命中的规范形若恰等于当前全局键则跳过（保存面已查重拒绝，
        手工漂移下确定性优先）；命中 preventDefault。 */
  const buttonShortcutMap = useMemo(() => {
    const map = new Map();
    const add = (list, kind) => {
      for (const button of Array.isArray(list) ? list : []) {
        const value = typeof button?.shortcut === "string" ? button.shortcut.trim() : "";
        /* 只认按钮键域池内值（add-cosmos-shortcuts D7）：手工漂移值在设置页呈「不可用」，
           分发器 MUST NOT 让其成为可触发键（否则漂移会把任意物理键变成动作入口）。 */
        if (!value || !isButtonShortcut(value)) continue;
        if (!map.has(value)) map.set(value, { kind, button });
      }
    };
    add(constButtons, "constellation");
    add(actionButtons, "proposal");
    return map;
  }, [actionButtons, constButtons]);
  const buttonDispatchRef = useRef(null);
  useEffect(() => {
    /* 每次渲染同步一次（不重绑监听）：配置/草稿/选中态全部经该 ref 读取。 */
    buttonDispatchRef.current = {
      map: buttonShortcutMap,
      selectedCard,
      drillGroup,
      stateOf: actionButtonStateOf,
      runAction,
      runConstAction
    };
  });
  useEffect(() => {
    if (dock) return undefined; // dock 正文不注册全局键盘监听（键盘只在整页激活态生效）
    const onKey = (ev) => {
      const view = buttonDispatchRef.current;
      if (!view || view.map.size === 0) return;
      if (ev.repeat === true) return;
      if (ev.isComposing === true || ev.keyCode === 229) return;
      if (ev.shiftKey === true || ev.metaKey === true) return;
      const canonical = canonicalOfEvent(ev);
      if (!canonical) return;
      const entry = view.map.get(canonical);
      if (!entry) return;
      const configured = currentShortcuts();
      if (canonical === configured.closePage || canonical === configured.goHome || canonical === configured.togglePan) return;
      const active = typeof document !== "undefined" ? document.activeElement : null;
      /* 仅可编辑元素让位：卡片/动作条按钮聚焦**不**构成守卫（点击选中后按键是主流程）。 */
      if (isEditableTarget(active)) return;
      if (floatOpenOf()) return; // 浮窗模态让位（D13）
      if (entry.kind === "proposal") {
        if (view.selectedCard === null) return; // 动作条熄灭 → 静默 no-op
        const extra = typeof view.stateOf === "function" ? view.stateOf(entry.button) : null;
        if (extra?.disabled === true) return; // 行级禁用 → 静默 no-op
        ev.preventDefault();
        view.runAction(entry.button);
        return;
      }
      if (view.drillGroup === null) return; // 星座条限钻取态（银河态无动作目标）
      ev.preventDefault();
      view.runConstAction(entry.button);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* 点卡片 = 选中 + 聚焦飞行（add-cosmos-selection-linkage 3.3 / D1）：面板选中先行落定
     （动作条即时点亮、无「先清后选」中间态），随后请引擎「把镜头带到那颗星」——飞行失败
     （骨架时序差 / 已归档 / 星胚）仅静默降级，动作目标不受影响。 */
  const selectProposal = (key) => {
    setSelectedKey(key);
    const card = findCard(panelModel, key);
    if (!card) return;
    /* 星胚组 MUST NOT 触发聚焦飞行（add-cosmos-embryo-cards 3.4 / design D6）：画布星胚
       v1 不可交互，引擎 `focusProposal` 对 proto 恒星恒返回 false（engine.mjs 已证），
       聚焦飞行无处落地——显式跳过调用；面板选中态与动作条点亮照常（面板是动作条目标
       真相，与引擎选中解耦）。 */
    if (card.isEmbryo) return;
    controllerRef.current?.focusProposal?.({ wsId: card.wsId, id: card.id });
  };

  /* ── 皮肤 HUD 令牌（add-cosmos-skin-themes 3.1/3.2）──
     作用域 = 整页根容器 `.cos-page`：引擎 `.cos-root`（hostRef 子级）与 React 面板层
     （提案面板/新增钮/搜索框/动作条）都是它的后代，CSS 自定义属性沿继承链同时生效
     （design D3 已验证：无需逐规则下发）。`useLayoutEffect` → 在 `attach` 的 effect 之前、
     浏览器绘制之前完成下发（首帧同气，无「先默认后切」闪跳）。 */
  const skinState = useSyncExternalStore(cosmosSkinStore.subscribe, cosmosSkinStore.getSnapshot);
  const skinId = skinState.skin;
  useLayoutEffect(() => {
    applySkinTokens(frameRef.current, skinId);
  }, [skinId]);

  /* 界面尺寸令牌（add-cosmos-layout-tuning 2.1/D1）：与皮肤令牌同址（整页根容器），
     数据源 = 「界面」页签受控镜像（cosmosNavStore）——设置里改尺寸 → 本组件重渲染 →
     内联 CSS 变量更新 → 引擎 CSS 与整页 CSS 同一帧生效（无需重开/刷新）。
     纯函数 `cosmosLayoutTokensOf` 负责设置值 → 变量表（含 0 = 自适应语义）。 */
  const navPrefs = useSyncExternalStore(cosmosNavStore.subscribe, cosmosNavStore.getSnapshot);
  const layoutTokens = cosmosLayoutTokensOf(navPrefs);

  /* ── 顶部缩放标尺（add-cosmos-zoom-ruler 2.1–2.4）──
     只读尺度指示：track / tick / thumb 三元素，`pointer-events:none`、不进入键盘焦点链，
     z 序低于搜索框。数据 = 引擎单源 `onZoomMeter`（轨道位移 ≥0.5% 或模式变化才派发），
     本组件只做纯 DOM 写（不重渲染面板树）；跳变（≥2%）走 200ms ease-out，连续小步直接
     落位（零可感迟滞）。dock 布局按搜索框槽宽计算可用宽，<160px 时整体隐藏。 */
  const rulerRef = useRef(null);
  const rulerThumbRef = useRef(null);
  const [rulerNarrow, setRulerNarrow] = useState(false);

  useEffect(() => {
    if (!dock) {
      setRulerNarrow(false);
      return undefined;
    }
    const frame = frameRef.current;
    if (!frame) return undefined;
    const measure = () => {
      const width = Number(frame.clientWidth) || 0;
      const searchW = Math.min(Number(navPrefs?.searchWidth) || 320, Math.max(0, width - 16));
      const available = width - 16 - searchW - 8;
      setRulerNarrow(available < 160);
    };
    measure();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe?.(frame);
    return () => observer?.disconnect?.();
  }, [dock, navPrefs?.searchWidth]);

  /* 引擎挂载：页开即建，页关即毁（Canvas 尺寸随 overlay 容器）。 */
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller || !hostRef.current) return undefined;
    controller.attach(hostRef.current);
    return () => controller.detach();
  }, []);

  /* 标尺数据订阅（必须在引擎挂载 effect 之后声明：同组件 effect 按声明序执行，
     声明在前的 attach 先建引擎，本 effect 运行时可取到公共面）。 */
  useEffect(() => {
    const ruler = rulerRef.current;
    const thumb = rulerThumbRef.current;
    if (!ruler || !thumb) return undefined;
    let easeTimer = 0;
    const clearEase = () => {
      if (easeTimer) { clearTimeout(easeTimer); easeTimer = 0; }
      thumb.classList.remove("cos-zoom-ruler-ease");
    };
    const applyMeter = (meter) => {
      if (!meter || typeof meter !== "object") return;
      const track = zoomMeterTrackOf(meter.dist, meter.distMin, meter.distMax);
      const pct = track * 100;
      const previous = Number(thumb.dataset.pos);
      const motion = Number.isFinite(previous) ? zoomRulerMotionOf(previous / 100, track) : "snap";
      thumb.dataset.pos = String(pct);
      if (motion === "ease") {
        thumb.classList.add("cos-zoom-ruler-ease");
        thumb.style.left = pct.toFixed(3) + "%";
        if (easeTimer) clearTimeout(easeTimer);
        easeTimer = setTimeout(clearEase, ZOOM_RULER_EASE_MS + 60);
      } else {
        clearEase();
        thumb.style.left = pct.toFixed(3) + "%";
      }
    };
    /* 首帧位置：引擎回调下一帧才到（页签不可见时未必有帧）——先按当前相机落位。 */
    const engine = controllerRef.current?.getEngine?.();
    const camera = engine?.getCamera?.();
    if (camera) {
      applyMeter({ dist: camera.dist, distMin: ZOOM_RULER_DIST_MIN, distMax: ZOOM_RULER_DIST_MAX });
    }
    const unsubscribe = typeof engine?.onZoomMeter === "function" ? engine.onZoomMeter(applyMeter) : null;
    const onTransitionEnd = (event) => {
      if (event?.propertyName && event.propertyName !== "left") return;
      clearEase();
    };
    thumb.addEventListener("transitionend", onTransitionEnd);
    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
      thumb.removeEventListener("transitionend", onTransitionEnd);
      clearEase();
    };
  }, []);

  /* ── UI 铬件矩形收集与发布（polish-cosmos-tip-ui-avoidance 2.1/2.2 / design D2） ──
     浮签层（z-46）恒居交互 chrome（搜索 / 面板 / 动作条 / 「＋」/ 引擎自建 HUD）之上
     以保证可读——**呈现与命中分离**的呈现侧在这里：client 只负责**如实报告 chrome 的
     布局矩形**，避让与命中门禁全部由引擎在浮签定位单点内做（引擎帧循环零 DOM 测量）。

     坐标口径（D2）：矩形的坐标系 = **引擎容器坐标**——`getBoundingClientRect()`（窗口
     视口）减去引擎根容器原点（`hostRef`：`.cos-root` 的父级、`inset:0` 铺满整页）。
     整页形态整页自 `--dsh-frame-top-clearance` 与宿主侧栏起排、dock 形态随 dock 列定位，
     窗口原点 ≠ 容器原点（直接发窗口坐标会让判定整体错位）；原点随矩形同批发布。

     触发面 = **布局事实变化**（MUST NOT 逐帧测量）：页面容器与每个已挂载 chrome 各自挂
     ResizeObserver（内容驱动高度变化——面板行数增减改变面板 rect——同样触发）、子节点
     增删走 MutationObserver（面板/搜索框/队列面板的挂载与卸载、引擎 HUD 建树）、钻取态
     让位与搜索框随钻取态挂卸由 `drill` 依赖重建订阅；重算在 rAF 内合并（同帧多次变化只
     发一次）。发布前按签名比对上次值——布局没变就零发布（client 侧缓存）。 */
  useEffect(() => {
    const frame = frameRef.current;
    const host = hostRef.current;
    if (!frame || !host) return undefined;
    let raf = 0;
    let disposed = false;
    let lastSignature = "";
    let resizeObserver = null;
    let mutationObserver = null;
    const observed = new Set();

    /** 按当前 DOM 重挂 ResizeObserver 订阅（元素随呈现态增删，每轮收集后同步一次）。 */
    const syncObserved = () => {
      if (!resizeObserver || disposed) return;
      const next = new Set([frame]);
      for (const [selector] of COSMOS_CHROME_RECTS) {
        for (const node of frame.querySelectorAll(selector)) next.add(node);
      }
      for (const node of observed) {
        if (next.has(node)) continue;
        resizeObserver.unobserve?.(node);
        observed.delete(node);
      }
      for (const node of next) {
        if (observed.has(node)) continue;
        resizeObserver.observe(node);
        observed.add(node);
      }
    };

    /** 收集 → 归一化 → 发布（rAF 合并后的唯一执行体）。 */
    const collect = () => {
      raf = 0;
      if (disposed) return;
      const originBox = host.getBoundingClientRect();
      const originX = Number(originBox.left) || 0;
      const originY = Number(originBox.top) || 0;
      const rects = [];
      const parts = [];
      for (const [selector, kind] of COSMOS_CHROME_RECTS) {
        /* 钻取态才呈现的 chrome（wsbar 槽位）：银河态虽仍有布局盒但视觉不可见，
           MUST NOT 参与判定——否则顶部中央会凭空多出一条隐形阻挡带。 */
        if (drill == null && COSMOS_CHROME_DRILL_ONLY.has(kind)) continue;
        for (const node of frame.querySelectorAll(selector)) {
          if (!node || node.hidden) continue;
          const box = node.getBoundingClientRect();
          if (!(box.width > 0) || !(box.height > 0)) continue;
          const rect = {
            kind,
            left: box.left - originX,
            top: box.top - originY,
            right: box.right - originX,
            bottom: box.bottom - originY
          };
          rects.push(rect);
          parts.push(kind + ":" + rect.left.toFixed(1) + "," + rect.top.toFixed(1)
            + "," + rect.right.toFixed(1) + "," + rect.bottom.toFixed(1));
        }
      }
      const signature = originX.toFixed(1) + "," + originY.toFixed(1) + "|" + parts.join(";");
      if (signature !== lastSignature) {
        /* 引擎未挂载 / 已销毁 → 不写缓存（下次布局事件重试），避免「首帧丢发布后永不重发」。 */
        const applied = controllerRef.current?.setUiChromeRects?.(rects, { x: originX, y: originY }) === true;
        if (applied) lastSignature = signature;
      }
      syncObserved();
    };

    const schedule = () => {
      if (disposed) return;
      if (typeof requestAnimationFrame !== "function") {
        collect();
        return;
      }
      if (!raf) raf = requestAnimationFrame(collect);
    };

    if (typeof ResizeObserver !== "undefined") resizeObserver = new ResizeObserver(schedule);
    if (typeof MutationObserver !== "undefined" && frame.nodeType === 1) {
      mutationObserver = new MutationObserver(schedule);
      mutationObserver.observe(frame, { childList: true, subtree: true });
    }
    schedule(); // 首帧即发布：引擎首帧就要矩形，不能等第一个布局事件
    return () => {
      disposed = true;
      if (raf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
      observed.clear();
    };
  }, [drill]);

  /* 开合 → 渲染循环启停（4.6）；关页重置搜索查询（会话态 MUST NOT 持久化——
     重开是完整银河）。 */
  useEffect(() => {
    controllerRef.current?.setOpen(true);
    return () => {
      controllerRef.current?.setOpen(false);
      queryRef.current = "";
      controllerRef.current?.actions.setFilter("");
    };
  }, []);

  /* 页签可见性 → 渲染循环启停（4.6）：启停唯一听 `document.hidden`（整页关闭一侧见
     上方开合 effect）。窗口失焦不暂停——spec「渲染节能」规定整页打开且页签可见时
     MUST NOT 因失焦暂停（失焦续播）；浏览器 rAF 节流同样以 `document.hidden` 为界，
     失焦但可见时照常满速，故此处不挂 window blur/focus（fix-cosmos-blur-pause D1）。
     dock 正文另乘宿主 tab 可见性（失活 tab / 收起右栏 → 暂停）。 */
  useEffect(() => {
    const sync = () => controllerRef.current?.setVisible(!document.hidden && dockVisible);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
    };
  }, [dockVisible]);

  /* Esc 分层（5.3，外壳单点 keydown；add-cosmos-search-filter 3.3 插入清空搜索层；
     add-cosmos-session-list-panel 3.4 插入收起会话面板层）：
     钻取返回/清选中 > 清空搜索 > 收起会话面板（展开态时） > 退全屏 > 关整页。
     引擎自带的 window keydown（demo）已收编——随 overlay 卸载自动移除。
     **关闭键参数化**（add-cosmos-shortcuts 5.1/D3）：整条链跟随配置键（canonical 匹配，
     缺省 `Escape`）——一条链一个键、一个心智模型；配置键非 `Esc` 时 `Esc` MUST NOT 被
     Cosmos 消费（无任何 Cosmos 行为），宿主语义回归。修饰键裁决与其余键位统一
     （Shift/Meta 恒跳过，Ctrl/Alt 交 canonical 精确匹配；组字中让位输入法）。
     清空层读查询 MUST 经 ref（effect 依赖不含 query，防陈旧闭包与监听重绑）；
     面板展开态读模块 store、快捷键读模块 store（同一理由：不把配置放进依赖重绑监听）。
     **dock 正文不注册本监听**（add-cosmos-rightbar-dock「dock 内不劫持 Esc」）：右侧
     分栏与宿主会话同屏，Esc 归宿主会话视图，Cosmos 零消费、零 preventDefault。 */
  useEffect(() => {
    if (dock) return undefined;
    const onKey = (e) => {
      if (!shortcutMatches(e, currentShortcuts().closePage)) return;
      /* IME 组字中：关闭键归输入法（取消候选），MUST NOT 触发任何 Cosmos 分层。 */
      if (e.isComposing === true || e.keyCode === 229) return;
      const controller = controllerRef.current;
      const engine = controller?.getEngine?.();
      if (engine?.consumeEscape?.()) {
        e.preventDefault();
        return;
      }
      if (queryRef.current.trim()) {
        applyQuery("");
        e.preventDefault();
        return;
      }
      /* 收起会话面板层：仅展开态消费（折叠态跳过，语义回到既有分层）；
         与标题栏开合按钮同一写者（含 settings 持久化）。 */
      if (sessionPanelOpenOf()) {
        setSessionPanelOpen(false);
        e.preventDefault();
        return;
      }
      if (fullscreen) {
        exitFullscreen();
        e.preventDefault();
        return;
      }
      close();
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen, exitFullscreen]);

  const containerStyle = dock
    ? {
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background: "var(--cos-bg, #070812)",
        "--cos-actions-h": actionsHeight + "px",
        "--cos-toast-bottom": (actionsHeight > 0 ? actionsHeight + 32 : 24) + "px",
        ...layoutTokens
      }
    : {
        position: "absolute",
        /* DSH Desktop 顶部窗口 chrome 安全区（Windows caption 40px / macOS 48px）：该带是
           窗口拖拽区（`-webkit-app-region: drag`，按几何而非堆叠生效），覆盖其上的整页若把
           交互控件放进带内，上半部指针事件会被窗口拖拽吞掉（真机：钻取态切换条目只有下半部
           可点）。整页自安全区之下起排——顶部 caption/menu/窗口控件归宿主，页内全部 chrome
           （切换条目、搜索框、两侧面板）随之整体下移，触发区完整可点。宿主以
           `--dsh-frame-top-clearance` 发布（Windows = titlebar 高度、macOS = 48px；浏览器
           形态无该变量 → 0px，行为不变）。 */
        top: "var(--dsh-frame-top-clearance, 0px)",
        bottom: 0,
        left: degraded ? 0 : pageLeft,
        right: 0,
        overflow: "hidden",
        /* 整页底色随肤（3.1：`--cos-bg` 令牌；fallback = 风格 D 现值 `#070812`）。 */
        background: "var(--cos-bg, #070812)",
        /* 动作条高度的两处联动（add-cosmos-proposal-actions 3.6/4.1）：
           --cos-actions-h → 面板底部让位（面板不与动作条重叠）；
           --cos-toast-bottom → 引擎 toast 上移到动作条上缘之上（MUST NOT 被遮挡）。 */
        "--cos-actions-h": actionsHeight + "px",
        "--cos-toast-bottom": (actionsHeight > 0 ? actionsHeight + 32 : 24) + "px",
        /* 界面尺寸令牌（add-cosmos-layout-tuning D1）：12 个 `--cos-*` 变量，含默认
           fallback 双保险（令牌缺席时引擎/整页 CSS 回落现值）。展开在最后 → 尺寸键
           覆盖同名前缀冲突（本组前缀均不与既有令牌重名）。 */
        ...layoutTokens
      };
  return (
    <div
      ref={frameRef}
      className={dock ? "cos-page cos-page-dock" : "cos-page"}
      data-cos-surface={mode}
      onPointerDown={(event) => {
        /* 「点击 vs 拖拽」判据起点（旋转画布/拖选不应被当作取消选中的点击）。 */
        selectionTapRef.current = { x: event.clientX, y: event.clientY };
      }}
      onContextMenu={(event) => {
        /* 原生右键菜单隐藏：Cosmos 页面内一律屏蔽（星图、提案面板、动作条等）；
           仅文本输入/可编辑控件保留浏览器菜单（右键粘贴/输入法辅助）。
           引擎容器另有同名兜底，保证星图区域即使脱离页面层也生效。 */
        if (event.defaultPrevented) return;
        const target = event.target;
        if (target?.closest?.("input, textarea, select, [contenteditable]") || target?.isContentEditable) return;
        event.preventDefault();
      }}
      style={containerStyle}
      data-plugin-anchor={dock ? "dsh-v-cosmos:dock" : "dsh-v-cosmos:page"}
      onClick={(event) => {
        /* 点击「选中作用面」以外的区域 → 取消选中（动作条随之熄灭）。
           作用面 = 面板（卡片切换/列表滚动）、动作条（按钮作用于选中目标）、搜索框
           （过滤联动需跨过滤保留选中）——见 panel.mjs `isSelectionSurface`。
           拖拽（旋转画布/拖选文本，位移 > 6px）不算点击，MUST NOT 清选中。 */
        const tapStart = selectionTapRef.current;
        selectionTapRef.current = null;
        if (!selectedKey) return;
        if (tapStart && Math.hypot(event.clientX - tapStart.x, event.clientY - tapStart.y) > 6) return;
        if (isSelectionSurface(event.target)) return;
        /* 引擎感知守卫（add-cosmos-selection-linkage 4.1 / D4）：引擎拾取发生在 pointerup，
           先于本 click 落定；且只有**画布起指**的点击可能携带新拾取结果（引擎对非 canvas
           目标不拾取）。故「命中画布 + 引擎仍有选中」（恒星/行星/彗星）时 MUST NOT 清空——
           否则点恒星的联动会被本守卫立刻覆写。空白命中时引擎已清 null、点「回到银河」或
           星座卡片时引擎处理器先 flyOut/清选中 → 均照常清空；左下「＋」、天体信息卡等
           非画布区域不受引擎选中影响，照常清除（spec「点击其他区域取消选中」）。 */
        if (isStarCanvasTarget(event.target)
          && controllerRef.current?.getEngine?.()?.inspectSelection?.() != null) return;
        setSelectedKey(null);
      }}
    >
      <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />
      {/* 顶部缩放标尺（add-cosmos-zoom-ruler 2.1–2.4）：只读尺度指示——track / tick /
          thumb 三元素，`pointer-events:none`、不进键盘焦点链、z 序低于搜索框；数据来自
          引擎 `onZoomMeter` 单源回调，DOM 写由订阅 effect 完成（本节点不持有位置 state）。 */}
      <div
        ref={rulerRef}
        className="cos-zoom-ruler"
        aria-hidden="true"
        data-plugin-anchor="dsh-v-cosmos:zoom-ruler"
        data-narrow={rulerNarrow ? "true" : undefined}
      >
        <span className="cos-zoom-ruler-track">
          <span
            className="cos-zoom-ruler-tick"
            style={{ left: ZOOM_RULER_TICK_PCT.toFixed(3) + "%" }}
          />
          <span ref={rulerThumbRef} className="cos-zoom-ruler-thumb" />
        </span>
      </div>
      <ProposalPanel
        t={tr}
        model={panelModel}
        selectedKey={selectedKey}
        onSelect={selectProposal}
        drill={drill}
        /* 跨面板悬停标记（p2-add-cosmos-cross-hover-markers 1.2/1.3）：单一合流描述 +
           卡容器 mouseenter/leave 单点接线。 */
        crossHover={crossHover}
        onHoverCard={hoverProposalCard}
        /* 星座动作条（仅钻取态）：目标分组缺失（钻取目标注销）时传空列表 → footer 零布局。 */
        constButtons={drillGroup === null ? [] : constButtons}
        onRunConst={runConstAction}
        closeKey={shortcuts.closePage}
      />
      {/* 自动执行队列面板（add-cosmos-action-queue 5.2 / design D7）：提案面板左邻、同宽
          同视觉语言；空队列 `visible=false` → 组件 return null（零布局，MUST NOT 占位）。
          作用域 = 钻取星座优先 / 选中提案所属星座兜底（见上方 `queueScopeOf` 注释）。 */}
      <QueuePanel
        t={tr}
        model={queueModel}
        drilled={drill !== null && drill !== undefined}
        crossHover={crossHover}
        onPause={toggleQueuePaused}
        onClear={clearQueue}
        onReorder={reorderQueueEntry}
        onRemove={removeQueueEntry}
        onHoverEntry={hoverQueueEntry}
      />
      {/* 左缘会话列表面板（add-cosmos-session-list-panel；swap-cosmos-panel-sides 移至左缘；
          swap-cosmos-session-toggle-titlebar 把手退役）：overlay 式，不参与布局流（画布零扰动）；
          折叠态 = 贴左缘竖向窄条（仅 `>>` + 待处理徽标）。 */}
      <SessionPanel
        t={tr}
        model={sessionModel}
        open={sessionPanelOpen}
        selectedKey={selectedSessionKey}
        drill={drill}
        waiting={sessionModel.waiting}
        crossHover={crossHover}
        onHoverRow={hoverSessionRow}
        onToggle={toggleSessionPanel}
        onSelect={focusSessionRow}
        onOpen={openSessionRow}
        onArchive={archiveSessionRow}
      />
      <button
        type="button"
        className="cos-add-btn"
        data-plugin-anchor="dsh-v-cosmos:add"
        disabled={adding}
        aria-busy={adding || undefined}
        aria-label={tr("cosmos.add.aria", "新增工作区")}
        title={tr("cosmos.add.aria", "新增工作区")}
        onClick={addWorkspace}
      >
        <span className="cos-add-plus" aria-hidden="true">＋</span>
      </button>
      {/* 钻取态隐藏搜索框（polish-cosmos-drilled-hud 1.1 / D1）：搜索是星座级工具，
          钻入后其主要功能（找星座）已完成，顶部中央让位给星座标牌。门控信号 =
          `drillStore` 镜像（dive 立即置值、flyOut 收尾归零，时序与面板让位同源）；
          查询状态零改动——块卸载即无输入面（冻结是自然结果），MUST NOT 主动清理
          （`filterQuery`/`filterStore`/`syncFilter` 原样，飞回后带原查询重现）。 */}
      {drill == null ? (
        <div
          className="cos-search"
          data-focused={searchFocused || undefined}
          data-plugin-anchor="dsh-v-cosmos:search"
        >
          <input
            type="text"
            className="cos-search-input"
            value={query}
            spellCheck={false}
            autoComplete="off"
            placeholder={tr("cosmos.search.placeholder", "搜索工作区…")}
            aria-label={tr("cosmos.search.aria", "搜索工作区")}
            onChange={(e) => applyQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            onKeyDown={(e) => {
              /* 关闭键参数化（add-cosmos-shortcuts 5.1/D3）：聚焦态关闭键 = 清空 + 失焦，
                 MUST NOT 冒泡到外壳分层（关页/退全屏）；键位跟随全局配置，配置键非 Esc 时
                 Esc 在本框亦不消费（无任何 Cosmos 行为）。组字中让位输入法。 */
              if (e.isComposing === true || e.keyCode === 229) return;
              if (!shortcutMatches(e, shortcuts.closePage)) return;
              e.preventDefault();
              e.stopPropagation();
              applyQuery("");
              e.currentTarget.blur();
            }}
          />
          {query ? (
            <button
              type="button"
              className="cos-search-clear"
              aria-label={tr("cosmos.search.clear", "清除搜索")}
              title={tr("cosmos.search.clear", "清除搜索")}
              onMouseDown={(e) => e.preventDefault() /* 保持输入框焦点 */}
              onClick={() => applyQuery("")}
            >
              ×
            </button>
          ) : null}
        </div>
      ) : null}
      {/* 「无匹配工作区」空态同属搜索面（任务 1.2 核实：本节点是 `.cos-search` 的兄弟
          节点、屏中 top:44%）：钻取态一并隐藏，MUST NOT 出现「搜索框已退场、空态提示
          仍在」的半截态。 */}
      {drill == null && showNoMatch ? (
        <div className="cos-search-empty" role="status">
          <b>✦</b>
          {tr("cosmos.search.empty", "无匹配工作区")}
        </div>
      ) : null}
      <ActionBar
        t={tr}
        buttons={actionButtons}
        enabled={selectedCard !== null}
        onRun={runAction}
        barRef={actionBarRef}
        stateOf={actionButtonStateOf}
        onEnqueue={enqueueAction}
        enqueueStateOf={enqueueStateOf}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 座位（sidebar.footer.action；wide 双形态，hive HiveSeat 同款排版）
 * ------------------------------------------------------------------ */

const COSMOS_ICON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="3.2" fill="currentColor"/><ellipse cx="12" cy="12" rx="10" ry="4.2" stroke="currentColor" stroke-width="1.6" transform="rotate(-24 12 12)"/><circle cx="20.2" cy="8.2" r="1.4" fill="currentColor"/></svg>';

/**
 * 侧栏底部座位「Cosmos」（add-cosmos-rightbar-dock D8 双入口同源分流）：
 *  - 点击时**现读** launchMode（`currentLaunchMode`：embedded / dock，无形态判据）——
 *    embedded 翻转整页开合（现状零变化）；dock 经 `launchCosmosEntry` 打开右栏 tab
 *    （已开揭示聚焦；无会话在屏 / 宿主席位缺席回落内嵌整页 + toast）；
 *  - 两入口高亮/aria 同源：embedded = 整页开合态；dock = 在屏会话已有 Cosmos tab。
 *  - `storage` 事件将 launchMode 变更同步进受控镜像 → 文案/行为即时跟随。
 * @param {{wide?: boolean, t: (key: string) => string}} props
 */
function CosmosSeat({ wide, t }) {
  const open = useCosmosOpen();
  const launchState = useSyncExternalStore(cosmosLaunchStore.subscribe, cosmosLaunchStore.getSnapshot);
  const dockState = useSyncExternalStore(cosmosDockStore.subscribe, cosmosDockStore.getSnapshot);
  const mode = launchState?.launchMode === "dock" ? "dock" : "embedded";
  const active = mode === "dock" ? dockState.active === true : open;
  const tr = (key, fallback) => {
    try {
      const value = typeof t === "function" ? t(key) : null;
      return typeof value === "string" && value && value !== key ? value : fallback;
    } catch {
      return fallback;
    }
  };
  const hint = mode === "dock"
    ? (dockState.active
      ? tr("cosmos.seat.dockActiveAria", "揭示 Cosmos 分栏")
      : tr("cosmos.seat.dockAria", "在右栏分栏打开 Cosmos"))
    : tr("cosmos.seat.aria", "打开 Cosmos 星系视图");
  const toggle = () => {
    launchCosmosEntry(tr);
  };
  if (wide) {
    return (
      <div className="cos-seat" data-active={active || undefined} data-mode={mode}>
        <button
          type="button"
          className="cos-seat-row"
          data-plugin-anchor="dsh-v-cosmos:seat"
          aria-expanded={active}
          title={hint}
          onClick={toggle}
        >
          <span className="cos-seat-icon" dangerouslySetInnerHTML={{ __html: COSMOS_ICON_SVG }} />
          <span className="cos-seat-label">{t("cosmos.seat")}</span>
        </button>
      </div>
    );
  }
  return (
    <div className="cos-seat" data-active={active || undefined} data-mode={mode}>
      <button
        type="button"
        className="cos-seat-rail"
        data-plugin-anchor="dsh-v-cosmos:seat"
        aria-label={hint}
        aria-expanded={active}
        title={hint}
        onClick={toggle}
        dangerouslySetInnerHTML={{ __html: COSMOS_ICON_SVG }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 标题栏菜单「星群」入口（move-cosmos-entry-to-dsh-menu；仅 Windows 桌面端）
 * ------------------------------------------------------------------ *
 * 宿主事实（Desktop preload lib/preload-app.cjs installWindowsMenu()）：
 *  · 菜单栏 = document.body 下 fixed div（`host.dataset.windowsMenu = ""`，
 *    light DOM 属性选择器稳定可达）：top:0 / left: var(--dsh-windows-menu-start,
 *    48px) / z-index 1100 / height: var(--dsh-windows-titlebar-height) /
 *    display:flex; align-items:center；内部 open shadowRoot（mode:"open"）
 *    含 [role=menubar] 与恰好两个硬编码按钮（application / edit）；
 *  · 按钮 chrome（shadow 样式表）：height 28px / padding 0 10px / 6px 圆角 /
 *    `font: inherit` + font-size 14px / 透明底 + label-secondary，hover 与
 *    aria-expanded=true → interactive-bg-hover + label-primary；
 *    按钮间距 = shadow 样式表 [role=menubar] { gap: 2px }；
 *  · 标题栏高度变量 `--dsh-windows-titlebar-height` 由 syncWindowsAppearance()
 *    写在 html 上（40px），属性 `data-windows-titlebar` 同源注入；
 *  · 宿主只在 `[data-shell-overlay]` 出现后才 append 菜单栏 → 挂载是异步的。
 * 宿主未提供任何插件槽位，故本入口自绘按钮贴齐其几何；读取面只有该标记元素
 * 与其 open shadowRoot 的按钮 rect——不读宿主样式表、不改宿主节点、不调其 IPC。
 * 排布契约（design D2）：本按钮占位「编辑」右邻位（token-insight「用量」旧址），
 * 「用量」经其仓链式让位排到本按钮右侧——本组件只声明锚点
 * `dsh-v-cosmos:menu-seat`，不感知「用量」节点。
 */
const COS_MENU_BUTTON_GAP = 2; /* 宿主 shadow 样式表 [role=menubar] gap（见上） */
const COS_MENU_BUTTON_HEIGHT = 28; /* 宿主按钮 height（见上），垂直居中用 */
const COS_MENU_FALLBACK_TITLEBAR_HEIGHT = 40; /* --dsh-windows-titlebar-height 缺省值（见上） */

/** 标题栏高度：读 html 上的 --dsh-windows-titlebar-height，缺席/不可解析回退 40px。 */
function menuTitlebarHeight() {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--dsh-windows-titlebar-height");
    const value = Number.parseFloat(raw);
    if (Number.isFinite(value) && value > 0) return value;
  } catch {
    /* 非浏览器环境或读取异常 → 常量回退 */
  }
  return COS_MENU_FALLBACK_TITLEBAR_HEIGHT;
}

/**
 * 宿主菜单栏几何测量（视口坐标；降级红线：任一环不符即 null，调用侧渲染 null）。
 * left = 「编辑」（shadowRoot 末位按钮）右缘 + 既有按钮间距；top = 标题栏垂直居中位。
 * 纯只读：不写宿主、不做宽度估算（语言切换后一律重读 rect）。
 */
function measureMenuSeat() {
  try {
    if (typeof document === "undefined") return null;
    if (!document.documentElement?.hasAttribute("data-windows-titlebar")) return null;
    const mount = document.querySelector("[data-windows-menu]");
    if (!mount) return null;
    const shadow = mount.shadowRoot; /* preload attachShadow({ mode: "open" }) */
    if (!shadow) return null; /* 结构不符（宿主改版）→ 静默降级 */
    const buttons = shadow.querySelectorAll("button");
    const last = buttons.length > 0 ? buttons[buttons.length - 1] : null;
    if (!last) return null;
    const buttonRect = last.getBoundingClientRect();
    if (!(buttonRect.width > 0 && buttonRect.height > 0)) return null; /* 未上屏/隐藏 */
    const mountRect = mount.getBoundingClientRect();
    /* 垂直居中：宿主菜单栏与标题栏等高（:host height = 标题栏变量），挂载盒实测
       优先、变量/常量回退——不依赖任何静态推算。 */
    const barTop = Number.isFinite(mountRect.top) ? mountRect.top : 0;
    const barHeight = mountRect.height > 0 ? mountRect.height : menuTitlebarHeight();
    return {
      left: Math.round(buttonRect.right + COS_MENU_BUTTON_GAP),
      top: Math.round(barTop + (barHeight - COS_MENU_BUTTON_HEIGHT) / 2)
    };
  } catch {
    return null;
  }
}

/**
 * 标题栏菜单「星群」入口（shell.overlay order 10 条目组件；move-cosmos-entry-to-dsh-menu）。
 * 行为与侧栏座位（CosmosSeat）完全同源：整页开合 / dock 呈现态 / launchMode 三份受控
 * 镜像订阅，点击统一走 `launchCosmosEntry`（embedded 翻转整页；dock 打开/揭示右栏 tab；
 * 无会话或宿主席位缺席回落内嵌整页 + toast）——零第二套行为实现（design D8）。
 * 渲染条件 = `data-windows-titlebar` 在场（Windows 桌面端）且宿主几何测量成功；
 * 任一不满足 → null（静默回退到仅侧栏座位形态：不抛错、不占位、不打 error 日志）。
 * 层级：order 10 低于 Cosmos 整页 45——整页打开期间标题栏菜单条不受覆盖，本入口
 * 常驻可点；`aria-expanded` / `data-active` 绑定真实开合（embedded = 整页开合态；
 * dock = 在屏会话已有 Cosmos tab；高亮 chrome 对齐宿主按钮 aria-expanded 形态）。
 * 定位跟随（design D1，token-insight 同款）：ResizeObserver（挂载元素 + 末按钮）只作
 * 重测触发器（语言切换改变按钮文本宽度）；侧栏收起/展开改写 `--dsh-windows-menu-start`
 * （菜单整体平移而尺寸不变，RO 不触发），另观察 `data-sidebar-collapsed`；两类情形
 * 位置一律重读末按钮实时 rect。MutationObserver 兜底宿主延迟挂载。observer 随组件
 * 卸载断开。坐标系不假设「条目根向上无包含块」——每次几何更新后实测自身 rect，
 * 与目标不符即一次性反向修正（下方校正 effect）。
 * @param {{t?: (key: string) => string}} props
 */
function CosmosMenuSeat({ t }) {
  const open = useCosmosOpen();
  const launchState = useSyncExternalStore(cosmosLaunchStore.subscribe, cosmosLaunchStore.getSnapshot);
  const dockState = useSyncExternalStore(cosmosDockStore.subscribe, cosmosDockStore.getSnapshot);
  const buttonRef = useRef(null);
  const [geometry, setGeometry] = useState(null);
  /* 自校正代数（同一测量代最多校正一次，避免往返抖动）。 */
  const correctionRef = useRef(0);

  useEffect(() => {
    let disposed = false;
    let mount = null;
    let ro = null;
    let bodyMo = null;
    let rootMo = null;
    let collapseMo = null;
    let raf = 0;
    let lastKey = "\u0000"; /* 哨兵：首次测量即使为 null 也要提交一次 */

    const commit = (measurement) => {
      const key = measurement === null ? "null" : `${measurement.left}:${measurement.top}`;
      if (key === lastKey) return;
      lastKey = key;
      correctionRef.current = 0;
      setGeometry(measurement);
    };
    const measureNow = () => {
      if (disposed) return;
      commit(measureMenuSeat());
    };
    const schedule = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = 0;
        measureNow();
      });
    };
    /* 绑定宿主观察：挂载元素尺寸变化（语言切换 → 菜单更宽）作重测触发器；
       末按钮也纳入观察（文本宽度直接变化时同样触发），重定位仍重读其 rect。 */
    const bind = () => {
      let next = null;
      try {
        next = document.querySelector("[data-windows-menu]");
      } catch {
        next = null;
      }
      if (next === mount && next?.isConnected) return;
      mount = next;
      ro?.disconnect();
      ro = null;
      if (!mount || typeof ResizeObserver === "undefined") return;
      ro = new ResizeObserver(schedule);
      ro.observe(mount);
      try {
        const buttons = mount.shadowRoot?.querySelectorAll?.("button");
        const last = buttons && buttons.length > 0 ? buttons[buttons.length - 1] : null;
        if (last) ro.observe(last);
      } catch {
        /* shadow 结构异常：仅观察挂载元素，测量层按降级红线兜底 */
      }
    };

    bind();
    measureNow();

    if (typeof MutationObserver !== "undefined") {
      /* 宿主延迟挂载兜底：稳态下只做 O(1) 的 isConnected 检查，零查询开销。 */
      bodyMo = new MutationObserver(() => {
        if (disposed || mount?.isConnected) return;
        bind();
        measureNow();
      });
      try {
        bodyMo.observe(document.body, { childList: true, subtree: true });
      } catch {
        /* body 未就绪：框架内不会发生，忽略 */
      }
      /* 标题栏标记/高度变量由 preload 写在 html 上，可能与菜单异步：属性变化重测。 */
      rootMo = new MutationObserver(() => {
        if (disposed) return;
        bind();
        measureNow();
      });
      try {
        rootMo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-windows-titlebar", "style"] });
      } catch {
        /* 忽略 */
      }
      /* 侧栏收起/展开改写 --dsh-windows-menu-start——宿主菜单整体平移而尺寸不变，
         ResizeObserver 不会触发，故另观察该状态属性仅作重测触发器：位置仍重读末按钮
         实时 rect（不推算，design D1）。 */
      collapseMo = new MutationObserver(() => {
        if (disposed) return;
        schedule();
      });
      try {
        collapseMo.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ["data-sidebar-collapsed"] });
      } catch {
        /* 忽略 */
      }
    }
    window.addEventListener("resize", schedule);

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      bodyMo?.disconnect();
      rootMo?.disconnect();
      collapseMo?.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, []);

  /* 坐标系实测校正（design D1）：fixed 定位若落在 transform/filter 等包含块下，style
     坐标会被平移。不假设「条目根向上无包含块」——每次几何更新后实测自身 rect，
     与目标不符即反向修正一次；无包含块的常规情形偏差为 0，零额外渲染。 */
  useEffect(() => {
    if (geometry === null) return;
    const node = buttonRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const dx = Math.round(rect.left - geometry.left);
    const dy = Math.round(rect.top - geometry.top);
    if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) return;
    if (correctionRef.current > 0) return;
    correctionRef.current += 1;
    setGeometry({ left: geometry.left - dx, top: geometry.top - dy });
  }, [geometry]);

  const mode = launchState?.launchMode === "dock" ? "dock" : "embedded";
  const active = mode === "dock" ? dockState.active === true : open;
  const tr = (key, fallback) => {
    try {
      const value = typeof t === "function" ? t(key) : null;
      return typeof value === "string" && value && value !== key ? value : fallback;
    } catch {
      return fallback;
    }
  };
  const menuText = tr("cosmos.menu.seat", "星群");
  const menuAriaText = tr("cosmos.menu.seat.aria", "打开 Cosmos 星群视图");
  const dockAriaText = tr("cosmos.seat.dockAria", "在右栏分栏打开 Cosmos");
  const hint = mode === "dock" ? dockAriaText : menuAriaText;
  const toggle = () => {
    launchCosmosEntry(tr);
  };
  if (geometry === null) return null;
  const ref = (element) => {
    buttonRef.current = element;
  };
  return (
    <button
      type="button"
      ref={ref}
      className="cos-menu-seat"
      data-plugin-anchor="dsh-v-cosmos:menu-seat"
      data-active={active || undefined}
      data-mode={mode}
      style={{ left: `${geometry.left}px`, top: `${geometry.top}px` }}
      aria-expanded={active}
      aria-label={hint}
      title={hint}
      onClick={toggle}
    >
      {menuText}
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * 样式注入 + 插件主体
 * ------------------------------------------------------------------ */

const CSS = `
/* ── 座位（hive jyv-seat 同款结构，.cos- 前缀） ── */
div:has(> [data-slot="sidebar.footer.action"]):has(.cos-seat){flex-wrap:wrap}
.cos-seat{display:contents}
.cos-seat-row{box-sizing:border-box;cursor:pointer;width:calc(100% + 4px);height:42px;color:var(--dsw-alias-label-primary);background:0 0;border:none;border-radius:12px;flex:none;align-items:center;gap:8px;margin:4px -2px;padding:0 10px 0 8px;font-family:inherit;font-size:14px;line-height:22px;display:flex;overflow:hidden}
.cos-seat-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.cos-seat-rail{box-sizing:border-box;cursor:pointer;color:var(--dsw-alias-label-primary);background:0 0;border:none;border-radius:50%;justify-content:center;align-items:center;gap:0;width:36px;height:36px;margin:8px 0 10px;padding:0;display:flex}
.cos-seat-rail:hover{background:var(--dsw-alias-interactive-bg-hover)}
.cos-seat[data-active="true"] .cos-seat-row,.cos-seat[data-active="true"] .cos-seat-rail{color:var(--dsw-alias-state-business-primary)}
.cos-seat-row .cos-seat-icon,.cos-seat-rail .cos-seat-icon{display:flex;flex:none}
.cos-seat-row svg,.cos-seat-rail svg{width:16px;height:16px;flex:none}
.cos-seat-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* ── 标题栏菜单「星群」入口（move-cosmos-entry-to-dsh-menu）：Windows 桌面端标题栏
     菜单条「编辑」右邻自绘 fixed 文字按钮；chrome 镜像宿主菜单 shadow 样式表按钮
     （28px 高 / padding 0 10px / 6px 圆角 / 透明底 / label-secondary，hover 与
     aria-expanded=true → interactive-bg-hover + label-primary）；font:inherit 继承
     标题栏字体栈。令牌优先、风格 D 基线回落（回落值 = 插件画布既有暖金基线，
     令牌缺席不裸奔）。「-webkit-app-region:no-drag」兜底（防 app-region 拖拽带
     扩展，宿主 :host 同款语义）。 ── */
.cos-menu-seat{position:fixed;box-sizing:border-box;height:28px;padding:0 10px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,var(--cos-accent-ink,#ffe3b8));font:inherit;font-size:14px;line-height:28px;white-space:nowrap;cursor:pointer;display:inline-flex;align-items:center;-webkit-app-region:no-drag}
@media (hover:hover){.cos-menu-seat:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(255,210,140,.12));color:var(--dsw-alias-label-primary,var(--cos-accent-ink,#ffe3b8))}}
.cos-menu-seat[aria-expanded="true"],.cos-menu-seat[data-active="true"]{background:var(--dsw-alias-interactive-bg-hover,rgba(255,210,140,.12));color:var(--dsw-alias-label-primary,var(--cos-accent-ink,#ffe3b8))}
.cos-menu-seat:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#ffd28a));outline-offset:-2px}
${ENGINE_CSS}
/* ── 新增工作区按钮（add-cosmos-add-workspace 4.4；polish-cosmos-touch-nav 5.1 方形化）：
      左下角常驻，方形 icon-only（44×44，只留「＋」；触屏点击目标 ≥40px，语义经
      aria-label/title 保留），风格 D HUD 语言（暖金描边 + 角标）。
      add-cosmos-skin-themes 3.1：金色系字面量全部收敛为 var(--cos-*, 现值)（fallback =
      风格 D 现值，令牌缺失不裸奔）；令牌由整页根容器 applySkinTokens 单点下发。
      z 序高于引擎覆盖层（.cos-overlay z=10 / toast z=30）与搜索带（z=40）；钻取态不隐藏。 ── */
.cos-add-btn{position:absolute;left:16px;bottom:16px;z-index:45;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:0;
  width:var(--cos-add-btn-size, 44px);height:var(--cos-add-btn-size, 44px);padding:0;cursor:pointer;color:var(--cos-accent-ink,#ffe3b8);background:var(--cos-glass,rgba(8,8,16,.72));border:1px solid var(--cos-line,rgba(255,210,140,.35));
  font-family:inherit;font-size:12px;letter-spacing:2px;line-height:1.2;pointer-events:auto}
.cos-add-btn::before,.cos-add-btn::after{content:'';position:absolute;width:8px;height:8px;pointer-events:none}
.cos-add-btn::before{top:-1px;left:-1px;border-top:2px solid var(--cos-line-strong,#ffd28a);border-left:2px solid var(--cos-line-strong,#ffd28a)}
.cos-add-btn::after{bottom:-1px;right:-1px;border-bottom:2px solid var(--cos-line-strong,#ffd28a);border-right:2px solid var(--cos-line-strong,#ffd28a)}
.cos-add-btn:hover:not(:disabled){border-color:rgb(var(--cos-accent-rgb,255 210 140) / .85);background:var(--cos-hover,rgba(255,210,140,.12))}
.cos-add-btn:focus-visible{outline:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .85);outline-offset:2px}
.cos-add-btn:disabled{opacity:.45;cursor:progress}
.cos-add-plus{font-size:18px;line-height:1;text-shadow:0 0 8px var(--cos-glow,rgba(255,210,140,.55))}
/* ── 搜索过滤（add-cosmos-search-filter 3.5）：风格 D HUD 语言（暖金描边/角标）；
      3.1：同上令牌化（fallback = 风格 D 现值）。 ── */
.cos-search{position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:40;box-sizing:border-box;display:flex;align-items:center;gap:6px;
  width:min(var(--cos-search-w, 320px), 34vw);min-width:180px;min-height:var(--cos-search-h, 0);padding:3px 6px 3px 10px;background:var(--cos-glass,rgba(8,8,16,.72));border:1px solid var(--cos-line,rgba(255,210,140,.35));pointer-events:auto}
.cos-search::before,.cos-search::after{content:'';position:absolute;width:8px;height:8px;pointer-events:none}
.cos-search::before{top:-1px;left:-1px;border-top:2px solid var(--cos-line-strong,#ffd28a);border-left:2px solid var(--cos-line-strong,#ffd28a)}
.cos-search::after{bottom:-1px;right:-1px;border-bottom:2px solid var(--cos-line-strong,#ffd28a);border-right:2px solid var(--cos-line-strong,#ffd28a)}
.cos-search[data-focused]{border-color:rgb(var(--cos-accent-rgb,255 210 140) / .7);box-shadow:0 0 12px rgb(var(--cos-accent-rgb,255 210 140) / .14)}
.cos-search-input{flex:1 1 auto;min-width:0;background:none;border:none;outline:none;color:var(--cos-accent-ink,#ffe3b8);font-family:inherit;font-size:13px;letter-spacing:.5px;padding:3px 0}
.cos-search-input::placeholder{color:rgb(var(--cos-accent-ink-rgb,255 227 184) / .38);letter-spacing:1px}
.cos-search-clear{flex:none;display:flex;align-items:center;justify-content:center;width:18px;height:18px;padding:0;cursor:pointer;
  background:none;border:1px solid var(--cos-line,rgba(255,210,140,.35));color:var(--cos-accent-ink,#ffe3b8);font-size:12px;line-height:1}
.cos-search-clear:hover{border-color:rgb(var(--cos-accent-rgb,255 210 140) / .85);background:var(--cos-hover,rgba(255,210,140,.12))}
.cos-search-empty{position:absolute;top:44%;left:50%;transform:translate(-50%,-50%);z-index:22;pointer-events:none;text-align:center;
  font-size:13px;letter-spacing:2px;color:var(--cos-ink-dim,rgba(255,233,207,.55))}
.cos-search-empty b{display:block;font-size:16px;margin-bottom:8px;color:rgb(var(--cos-accent-ink-rgb,255 227 184) / .8)}
/* ── 顶部缩放标尺（add-cosmos-zoom-ruler 2.3–2.4/D6）：只读尺度指示（track / tick /
      thumb 三元素），对数刻度映射 dist [24,4200]——4200 → 0%、tick(155) ≈ 63.9%、
      24 → 100%。「pointer-events:none」：滚轮/指针事件穿透至画布，不进键盘焦点链（无
      tabindex/语义）。嵌入式：顶缘水平居中、宽 min(520px,44vw)、高 12px、top:0；
      z 序（24）低于搜索框（40）与面板族（42+）。视觉令牌复用风格 D HUD 族。 ── */
.cos-zoom-ruler{position:absolute;top:0;left:50%;transform:translateX(-50%);z-index:24;box-sizing:border-box;
  width:min(520px,44vw);height:12px;padding:5px 0;pointer-events:none}
.cos-zoom-ruler-track{position:relative;display:block;width:100%;height:2px;background:var(--cos-line,rgba(255,210,140,.35))}
.cos-zoom-ruler-tick{position:absolute;top:-4px;width:1px;height:10px;transform:translateX(-50%);
  background:var(--cos-line-strong,#ffd28a);opacity:.62}
.cos-zoom-ruler-thumb{position:absolute;top:50%;left:0;width:9px;height:9px;margin:-4.5px 0 0 -4.5px;
  background:var(--cos-accent,#ffd28a);box-shadow:0 0 8px var(--cos-glow,rgba(255,210,140,.55))}
/* 跳变门控（2.2/D5）：仅不连续跳变（过滤重取景 / flyOut 落点 / 冷启动取景，位移 ≥2%）
   挂过渡；滚轮/捏合连续小步移除本类直接落位（零可感迟滞）。 */
.cos-zoom-ruler-thumb.cos-zoom-ruler-ease{transition:left 200ms ease-out}
/* dock 布局避让（2.4/D6）：左缘 = 搜索框右缘 + 8px、右缘留 8px、宽度上限 min(300px,34vw)；
   可用宽 < 160px（「data-narrow」由 ResizeObserver 实测）→ 整体隐藏。 */
.cos-page-dock .cos-zoom-ruler{left:calc(8px + min(var(--cos-search-w,320px), calc(100% - 16px)) + 8px);right:8px;top:0;
  width:auto;max-width:min(300px,34vw);transform:none}
.cos-page-dock .cos-zoom-ruler[data-narrow="true"]{display:none}
/* ── 提案列表面板（add-cosmos-proposal-actions 3.2/3.6；swap-cosmos-panel-sides 2.3
      移至右缘）：右缘固定 187px（280px × 2/3，用户要求收窄 1/3），内容滚动区（原生滚动/
      文本选择）；银河态自页顶起，钻取态下移让位顶部中央星座标牌（polish-cosmos-drilled-
      hud：标牌由左上移居顶部中央，本规则保留为窄视口降级态（<520px 标牌限宽放宽、允许
      横向重叠）的纵向隔离带）；底部让位动作条，右下让位「回到银河」。
      与搜索框的避让：面板左缘 = 页宽 - 188px、搜索带右缘 = 50% + min(160px,17vw)，视口
      <~570px 开始相交（与左缘口径镜像对称，断点取值不变）→ 取 640px 为断点整体下移到
      搜索带之下（留 70px 余量）。 ── */
.dsh-cosmos-panel{position:absolute;right:0;top:12px;bottom:calc(var(--cos-actions-h,0px) + 72px);width:var(--cos-const-panel-w, 187px);max-height:var(--cos-const-panel-h, none);z-index:42;
  box-sizing:border-box;display:flex;flex-direction:column;color:var(--cos-ink,#ffe9cf);background:var(--cos-panel-soft,rgba(8,8,16,.62));
  border:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .28);border-right:none;pointer-events:auto}
.dsh-cosmos-panel[data-drill=true]{top:64px}
@media (max-width:640px){.dsh-cosmos-panel{top:56px}.dsh-cosmos-panel[data-drill=true]{top:96px}}
.dsh-cosmos-panel::after{content:'';position:absolute;left:-1px;top:-1px;width:8px;height:8px;
  border-top:2px solid var(--cos-line-strong,#ffd28a);border-left:2px solid var(--cos-line-strong,#ffd28a);pointer-events:none}
.dsh-cosmos-panel-head{flex:none;display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .22)}
.dsh-cosmos-panel-title{flex:1;font-size:12px;letter-spacing:2px;color:var(--cos-accent-ink,#ffe3b8)}
.dsh-cosmos-panel-count{font-size:11px;opacity:.6}
/* 头部星胚附注徽标（add-cosmos-galaxy-embryo-cards D3）：主计数（正式提案数）之外的
   独立补注——虚线框 + --cos-lc-proto 与星胚卡同源语义色；星胚数为 0 时组件侧不渲染
   （零布局）。 */
.dsh-cosmos-panel-embryo-count{flex:none;font-size:10px;letter-spacing:.5px;white-space:nowrap;
  padding:0 4px;border:1px dashed var(--cos-lc-proto,#8a9bc0);color:var(--cos-lc-proto,#8a9bc0)}
.dsh-cosmos-panel-list{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;padding:6px 8px 10px;
  touch-action:pan-y;-webkit-user-select:text;user-select:text;outline:none}
.dsh-cosmos-panel-list:focus-visible{outline:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .55);outline-offset:-1px}
.dsh-cosmos-panel-group{margin:0 0 8px}
.dsh-cosmos-panel-group-title{margin:2px 0 4px;font-size:11px;font-weight:600;letter-spacing:1px;
  color:rgb(var(--cos-accent-ink-rgb,255 227 184) / .68);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-cosmos-panel-card{display:flex;flex-direction:column;gap:2px;box-sizing:border-box;width:100%;margin:0 0 4px;padding:5px 8px;
  text-align:left;font:inherit;color:var(--cos-ink,#ffe9cf);background:var(--cos-card-bg,rgba(10,10,20,.55));border:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .22);
  border-left-width:3px;border-radius:0;cursor:pointer}
.dsh-cosmos-panel-card:hover{border-color:rgb(var(--cos-accent-rgb,255 210 140) / .7);background:rgb(var(--cos-accent-rgb,255 210 140) / .08)}
.dsh-cosmos-panel-card:focus-visible{outline:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .85);outline-offset:1px}
/* 星胚合并卡片（add-cosmos-embryo-cards 3.3）：虚线描边 + 星胚灰蓝语义色（HUD 令牌
   --cos-lc-proto，12 套皮肤逐肤派生、fallback #8a9bc0）——与画布星胚虚线轮廓同源，
   与三态正式提案两两可区分。选中态沿用通用 [data-selected=true] 规则（高亮同款），
   虚线描边保留（border-style 不被覆盖）。 */
.dsh-cosmos-panel-card[data-embryo]{border-style:dashed;border-left-width:1px;
  border-color:var(--cos-lc-proto,#8a9bc0);color:var(--cos-lc-proto,#8a9bc0)}
.dsh-cosmos-panel-card[data-embryo]:hover{border-color:var(--cos-lc-proto,#8a9bc0);background:var(--cos-hover,rgba(255,210,140,.12))}
.dsh-cosmos-panel-card[data-selected=true]{background:rgb(var(--cos-accent-rgb,255 210 140) / .16);border-color:var(--cos-accent,#ffd28a);box-shadow:0 0 10px rgb(var(--cos-accent-rgb,255 210 140) / .18)}
/* 星胚卡选中态：与正式提案同一高亮（描边色归主调，虚线样式保留）——选择器置于通用
   选中规则之后，压过 [data-embryo]:hover 的 proto 描边色（选中优先于悬停）。 */
.dsh-cosmos-panel-card[data-embryo][data-selected=true]{border-color:var(--cos-accent,#ffd28a)}
/* 生命周期左缘三色随肤（add-cosmos-skin-themes 3.1：原四态直接量 → --cos-lc-* 令牌） */
.dsh-cosmos-panel-card[data-lifecycle=created]{border-left-color:var(--cos-lc-created,#9fd8ff)}
.dsh-cosmos-panel-card[data-lifecycle=reviewed]{border-left-color:var(--cos-lc-reviewed,#cfe8ff)}
.dsh-cosmos-panel-card[data-lifecycle=executed]{border-left-color:var(--cos-lc-executed,#ffe27a)}
.dsh-cosmos-panel-name{font-size:12px;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-cosmos-panel-meta{display:flex;flex-wrap:wrap;align-items:center;gap:2px 6px;font-size:10px;line-height:14px;
  color:var(--cos-ink-dim,rgba(255,233,207,.55));letter-spacing:.5px}
.dsh-cosmos-panel-tasks{color:rgb(var(--cos-accent-ink-rgb,255 227 184) / .8)}
.dsh-cosmos-panel-badge{max-width:92px;padding:0 5px;border:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .45);border-radius:999px;
  color:var(--cos-accent,#ffd28a);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-cosmos-panel-card[data-lifecycle=reviewed] .dsh-cosmos-panel-badge{background:rgb(var(--cos-accent-rgb,255 210 140) / .18)}
/* 星胚卡面：slug 逐行清单（可读可复制）+「星胚」徽标（与已审核金章徽标同位异色） */
.dsh-cosmos-embryo-slugs{display:flex;flex-direction:column;gap:1px;font-size:12px;line-height:16px}
.dsh-cosmos-embryo-slug{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-cosmos-panel-card[data-embryo] .dsh-cosmos-panel-badge{border-color:var(--cos-lc-proto,#8a9bc0);
  color:var(--cos-lc-proto,#8a9bc0);background:transparent}
.dsh-cosmos-panel-at{white-space:nowrap}
/* ── 卡片任务进度条（p1-add-cosmos-card-progress-bars 3.3）：会话行与正式提案卡共用
      组件族。双挂点同数据——strip（满宽底部细条）+ ring（meta 行内 12px 小环），
      形状切换**零 JS 分支**：根容器 data-cos-progress 属性（skin-registry 唯一写者）
      决定显隐，取值三形态——
        · 属性缺失 / segment（fallback 基线）= 满宽格栅条（3px 高、1px 间隙）；
        · bar = 满宽连续条（宽度 = done/total，格栅隐藏）；
        · ring = meta 行内小环（满宽条整条隐藏）。
      total 超 12 退化 = strip 的 data-degraded 标记（只留单连续 span）。
      取色全走既有 HUD 令牌族（轨道 = accent 通道半透明变体、填充 = --cos-accent；
      金色直接量仅作 fallback 位），**零新增令牌**。 ── */
.dsh-cosmos-progress-strip{display:flex;box-sizing:border-box;width:100%;height:3px;margin:2px 0 0;
  overflow:hidden;background:rgb(var(--cos-accent-rgb,255 210 140) / .14)}
.dsh-cosmos-progress-segs{display:flex;gap:1px;width:100%;height:100%}
.dsh-cosmos-progress-seg{flex:1 1 0;min-width:0;background:rgb(var(--cos-accent-rgb,255 210 140) / .14)}
/* 整格填充语义（design D2）：done 整格主调 / active = 第 done+1 格低透明度 tint（静态，
   动效归 p2-add-cosmos-card-state-chrome）/ empty 空轨。 */
.dsh-cosmos-progress-seg[data-fill=done]{background:var(--cos-accent,#ffd28a)}
.dsh-cosmos-progress-seg[data-fill=active]{background:rgb(var(--cos-accent-rgb,255 210 140) / .42)}
/* 连续条填充（bar 形态 / total > 12 退化路径）：单 span 宽度百分比。 */
.dsh-cosmos-progress-fill{display:none;height:100%;background:var(--cos-accent,#ffd28a)}
/* 形状分支（属性缺失 = segment 基线，故只需为非 segment 形态写显式覆盖）。 */
[data-cos-progress=bar] .dsh-cosmos-progress-segs{display:none}
[data-cos-progress=bar] .dsh-cosmos-progress-fill{display:block}
.dsh-cosmos-progress-strip[data-degraded=true] .dsh-cosmos-progress-segs{display:none}
.dsh-cosmos-progress-strip[data-degraded=true] .dsh-cosmos-progress-fill{display:block}
/* meta 行内小环（ring 形态）：conic-gradient 填充角 = --cos-prog-turn（内联数据值，非形状），
   环带由 mask 径向挖空；默认隐藏，仅 ring 皮肤显形。 */
.dsh-cosmos-progress-ring{display:none;flex:none;width:12px;height:12px;border-radius:50%;
  background:conic-gradient(from -90deg,var(--cos-accent,#ffd28a) 0 var(--cos-prog-turn,0%),
    rgb(var(--cos-accent-rgb,255 210 140) / .18) var(--cos-prog-turn,0%) 100%)}
[data-cos-progress=ring] .dsh-cosmos-progress-strip{display:none}
[data-cos-progress=ring] .dsh-cosmos-progress-ring{display:inline-block}
@supports (mask: radial-gradient(circle,#000 0 3px,transparent 3px)){
  .dsh-cosmos-progress-ring{-webkit-mask:radial-gradient(circle,#000 0 3px,transparent 3px);
    mask:radial-gradient(circle,#000 0 3px,transparent 3px)}
}
/* mask 环带不可用 → ring 形态回落 bar 呈现（满宽连续条），MUST NOT 裸奔实心饼。 */
@supports not (mask: radial-gradient(circle,#000 0 3px,transparent 3px)){
  [data-cos-progress=ring] .dsh-cosmos-progress-strip{display:flex}
  [data-cos-progress=ring] .dsh-cosmos-progress-segs{display:none}
  [data-cos-progress=ring] .dsh-cosmos-progress-fill{display:block}
}
.dsh-cosmos-panel-empty{padding:8px 2px;font-size:11px;letter-spacing:1px;color:rgb(var(--cos-ink-rgb,255 233 207) / .45)}
/* ── 会话列表面板（add-cosmos-session-list-panel 2.1–2.3；swap-cosmos-panel-sides 2.1/2.2
      移至左缘；swap-cosmos-session-toggle-titlebar 2.x/3.x 把手退役）：左缘 overlay
      （MUST NOT 挤压画布——不参与布局流，引擎 host 尺寸与 resize/rebuild 链路零扰动）。
      面板恒渲染：展开态 = 标题栏 + 260px 浮层清单；折叠态 = 贴左缘竖向窄条（约 48px、
      整列高度；标题/计数隐藏，仅顶部「>>」按钮 + 待处理徽标，清单区 display:none）。
      开合唯一控制点 = 同一 DOM 节点上的按钮（展开态标题栏内「<<」/ 折叠态竖条顶部
      「>>」），无左缘把手等其他第二控件；上下留白与右提案面板对称，钻取态同步下移让位
      顶部中央星座标牌。
      状态色两级级联：宿主语义 alias 优先（--dsw-alias-state-warn-primary / -success-primary，
      spike 实证清单名），皮肤令牌兜底（--cos-waiting / --cos-done，随当前皮肤）。loader
      色走 accent 系令牌。 ── */
.dsh-cosmos-sessions{position:absolute;left:0;top:12px;bottom:calc(var(--cos-actions-h,0px) + 72px);width:var(--cos-session-w, 260px);max-height:var(--cos-session-h, none);z-index:42;
  box-sizing:border-box;display:flex;flex-direction:column;color:var(--cos-ink,#ffe9cf);background:var(--cos-panel-soft,rgba(8,8,16,.62));
  border:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .28);border-left:none;pointer-events:auto}
/* 折叠态 = 贴左缘竖向窄条（约 48px、整列高度；用户图像修订）：标题/计数隐藏，
   仅顶部「>>」按钮 + 待处理徽标；清单区隐藏，窄条上不保留角标。 */
.dsh-cosmos-sessions[data-collapsed=true]{width:48px}
.dsh-cosmos-sessions[data-collapsed=true]::before{display:none}
.dsh-cosmos-sessions[data-collapsed=true] .dsh-cosmos-sessions-head{flex-direction:column;justify-content:flex-start;gap:8px;padding:4px 2px;border-bottom:none}
.dsh-cosmos-sessions[data-collapsed=true] .dsh-cosmos-sessions-title,
.dsh-cosmos-sessions[data-collapsed=true] .dsh-cosmos-sessions-count{display:none}
.dsh-cosmos-sessions[data-collapsed=true] .cos-sessions-toggle{order:1}
.dsh-cosmos-sessions[data-collapsed=true] .cos-sessions-waiting{order:2}
.dsh-cosmos-sessions[data-collapsed=true] .dsh-cosmos-sessions-list{display:none}
.dsh-cosmos-sessions[data-drill=true]{top:64px}
@media (max-width:640px){.dsh-cosmos-sessions{top:56px}.dsh-cosmos-sessions[data-drill=true]{top:96px}}
.dsh-cosmos-sessions::before{content:'';position:absolute;right:-1px;top:-1px;width:8px;height:8px;
  border-top:2px solid var(--cos-line-strong,#ffd28a);border-right:2px solid var(--cos-line-strong,#ffd28a);pointer-events:none}
.dsh-cosmos-sessions-head{flex:none;display:flex;align-items:center;gap:8px;padding:4px 6px 4px 10px;
  border-bottom:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .22)}
.dsh-cosmos-sessions-title{flex:1;font-size:12px;letter-spacing:2px;color:var(--cos-accent-ink,#ffe3b8)}
.dsh-cosmos-sessions-count{font-size:11px;opacity:.6}
/* 待处理徽标（标题栏/竖条随态；全量 waiting 口径，折叠态为唯一可见性提示）：
   warning alias → --cos-waiting 级联，与行内状态点同源。 */
.cos-sessions-waiting{flex:none;min-width:16px;padding:0 3px;border-radius:999px;font-size:10px;line-height:16px;text-align:center;
  color:#1c1408;background:var(--dsw-alias-state-warn-primary,var(--cos-waiting,#ffaa4a))}
/* 开合按钮（唯一控制点）：accent 令牌族 + 触屏热区 ≥40px + focus-visible；
   展开态标题栏「<<」/ 折叠态竖条顶部「>>」，同一节点翻转。 */
.cos-sessions-toggle{flex:none;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;
  min-width:40px;min-height:40px;padding:0;cursor:pointer;font:inherit;font-size:14px;line-height:1;letter-spacing:1px;
  color:var(--cos-accent-ink,#ffe3b8);background:rgb(var(--cos-accent-rgb,255 210 140) / .1);
  border:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .45);border-radius:0}
.cos-sessions-toggle:hover{background:rgb(var(--cos-accent-rgb,255 210 140) / .24);border-color:rgb(var(--cos-accent-rgb,255 210 140) / .85)}
.cos-sessions-toggle:focus-visible{outline:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .85);outline-offset:1px}
.cos-sessions-toggle-glyph{display:block;line-height:1}
.dsh-cosmos-sessions-list{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;padding:6px 8px 10px;touch-action:pan-y;overscroll-behavior:contain;
  -webkit-user-select:text;user-select:text}
.dsh-cosmos-sessions-empty{padding:8px 2px;font-size:11px;letter-spacing:1px;color:rgb(var(--cos-ink-rgb,255 233 207) / .45)}
.dsh-cosmos-session-group{margin:0 0 8px}
.dsh-cosmos-session-group-title{display:flex;align-items:center;gap:6px;margin:2px 0 4px;font-size:11px;font-weight:600;letter-spacing:1px;
  color:rgb(var(--cos-accent-ink-rgb,255 227 184) / .68)}
.dsh-cosmos-session-group-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-cosmos-session-group-count{flex:none;font-size:10px;opacity:.6}
.dsh-cosmos-session-row{display:flex;align-items:stretch;gap:2px;box-sizing:border-box;margin:0 0 3px;
  background:var(--cos-card-bg,rgba(10,10,20,.55));border:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .18)}
.dsh-cosmos-session-row:hover{border-color:rgb(var(--cos-accent-rgb,255 210 140) / .6);background:rgb(var(--cos-accent-rgb,255 210 140) / .07)}
.dsh-cosmos-session-row[data-selected=true]{background:rgb(var(--cos-accent-rgb,255 210 140) / .16);border-color:var(--cos-accent,#ffd28a);
  box-shadow:0 0 10px rgb(var(--cos-accent-rgb,255 210 140) / .16)}
.dsh-cosmos-session-main{position:relative;flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px;padding:5px 4px 5px 6px;
  text-align:left;font:inherit;color:inherit;background:none;border:none;cursor:pointer}
.dsh-cosmos-session-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.dsh-cosmos-session-main:focus-visible{outline:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .85);outline-offset:-1px}
.dsh-cosmos-session-line{display:flex;align-items:center;gap:5px;min-width:0}
.dsh-cosmos-session-lead{flex:none;display:inline-flex;align-items:center;justify-content:center;width:7px;height:7px}
.dsh-cosmos-session-dot{width:6px;height:6px;border-radius:50%}
.dsh-cosmos-session-lead[data-state=waiting] .dsh-cosmos-session-dot{background:var(--dsw-alias-state-warn-primary,var(--cos-waiting,#ffaa4a))}
.dsh-cosmos-session-lead[data-state=done-unread] .dsh-cosmos-session-dot{background:var(--dsw-alias-state-success-primary,var(--cos-done,#5affc0))}
.dsh-cosmos-session-loader{width:8px;height:8px;border-radius:50%;box-sizing:border-box;
  border:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .28);border-top-color:var(--cos-accent,#ffd28a);
  animation:cos-session-spin .9s linear infinite}
@keyframes cos-session-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.dsh-cosmos-session-loader{animation-duration:2.4s}}
.dsh-cosmos-session-kind{flex:none;font-size:10px;line-height:1;color:var(--cos-accent,#ffd28a);opacity:.8}
.dsh-cosmos-session-row[data-kind=comet] .dsh-cosmos-session-kind{opacity:.55}
.dsh-cosmos-session-title{flex:1 1 auto;min-width:0;font-size:12px;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-cosmos-session-meta{display:flex;align-items:center;gap:6px;min-width:0;padding-left:13px;font-size:10px;line-height:14px;
  color:var(--cos-ink-dim,rgba(255,233,207,.55));letter-spacing:.5px}
.dsh-cosmos-session-todo{flex:none;color:rgb(var(--cos-accent-ink-rgb,255 227 184) / .8)}
.dsh-cosmos-session-sats{flex:none;padding:0 5px;border:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .45);border-radius:999px;
  color:var(--cos-accent,#ffd28a);white-space:nowrap}
.dsh-cosmos-session-trailing{flex:none;margin-left:auto;white-space:nowrap}
.dsh-cosmos-session-trailing[data-state=waiting]{color:var(--dsw-alias-state-warn-primary,var(--cos-waiting,#ffaa4a))}
.dsh-cosmos-session-open{flex:none;align-self:center;margin:0 5px 0 0;min-width:34px;min-height:28px;padding:2px 6px;cursor:pointer;
  font:inherit;font-size:10px;line-height:14px;color:var(--cos-accent-ink,#ffe3b8);background:rgb(var(--cos-accent-rgb,255 210 140) / .1);
  border:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .45)}
.dsh-cosmos-session-open:hover{background:rgb(var(--cos-accent-rgb,255 210 140) / .24);border-color:rgb(var(--cos-accent-rgb,255 210 140) / .85)}
.dsh-cosmos-session-open:focus-visible{outline:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .85);outline-offset:1px}
/* ── 行内「归档」图标钮（add-cosmos-session-row-archive 2.3 / D3）：常显、恒居「打开」之后
      （行内动作区末位）；热区包络与「打开」同级（min-width 34px / min-height 28px，触屏
      可点，MUST NOT 依赖 hover）；配色沿用行内既有 accent 令牌族（--cos-accent-rgb /
      --cos-accent-ink 随皮肤级联，light 皮肤经同一套令牌自动成立，故无需 [data-cos-mode]
      分支）。在途禁用态 opacity 同动作条惯例（.dsh-cosmos-action:disabled）。 ── */
.dsh-cosmos-session-archive{flex:none;align-self:center;margin:0 5px 0 0;min-width:34px;min-height:28px;padding:2px 6px;
  display:inline-flex;align-items:center;justify-content:center;cursor:pointer;
  font:inherit;font-size:11px;line-height:14px;color:var(--cos-accent-ink,#ffe3b8);background:rgb(var(--cos-accent-rgb,255 210 140) / .1);
  border:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .45)}
.dsh-cosmos-session-archive:hover:not(:disabled){background:rgb(var(--cos-accent-rgb,255 210 140) / .24);border-color:rgb(var(--cos-accent-rgb,255 210 140) / .85)}
.dsh-cosmos-session-archive:focus-visible{outline:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .85);outline-offset:1px}
.dsh-cosmos-session-archive:disabled{opacity:.45;cursor:not-allowed}
.dsh-cosmos-session-archive-icon{display:block;line-height:1}
/* ── 自动执行队列面板（add-cosmos-action-queue 5.2 / design D7 / spec cosmos-action-queue
      「队列呈现（面板与配套入队钮）」）：提案面板左邻（right = 提案面板宽 + 8px 间隙），
      同宽（--cos-const-panel-w 缺省 187px）同视觉语言（风格 D 暖金描边 + 角标）；底部
      让位沿用 --cos-actions-h（与提案面板 / 会话面板同一条规则），右下让位「回到银河」。
      空队列由组件 return null（零布局），本规则不提供空态占位。
      执行指示点两级取色：running = accent 呼吸点（新增 cos-queue-breath）；
      waiting = 宿主 warning alias → --cos-waiting 兜底（与会话行 waiting 同源）。
      条目操作钮组默认半透明、hover / focus-within 浮出（触屏无 hover 时仍可见可点）。 ── */
.dsh-cosmos-queue{position:absolute;right:calc(var(--cos-const-panel-w, 187px) + 8px);top:12px;bottom:calc(var(--cos-actions-h,0px) + 72px);width:var(--cos-const-panel-w, 187px);max-height:var(--cos-const-panel-h, none);z-index:42;
  box-sizing:border-box;display:flex;flex-direction:column;color:var(--cos-ink,#ffe9cf);background:var(--cos-panel-soft,rgba(8,8,16,.62));
  border:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .28);pointer-events:auto}
.dsh-cosmos-queue[data-drill=true]{top:64px}
@media (max-width:640px){.dsh-cosmos-queue{top:56px}.dsh-cosmos-queue[data-drill=true]{top:96px}}
.dsh-cosmos-queue::before{content:'';position:absolute;left:-1px;top:-1px;width:8px;height:8px;
  border-top:2px solid var(--cos-line-strong,#ffd28a);border-left:2px solid var(--cos-line-strong,#ffd28a);pointer-events:none}
.dsh-cosmos-queue::after{content:'';position:absolute;left:-1px;bottom:-1px;width:8px;height:8px;
  border-bottom:2px solid var(--cos-line-strong,#ffd28a);border-left:2px solid var(--cos-line-strong,#ffd28a);pointer-events:none}
.dsh-cosmos-queue-head{flex:none;display:flex;align-items:center;gap:6px;padding:6px 8px;
  border-bottom:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .22)}
.dsh-cosmos-queue-title{flex:none;font-size:12px;letter-spacing:2px;color:var(--cos-accent-ink,#ffe3b8);white-space:nowrap}
.dsh-cosmos-queue-count{flex:none;font-size:11px;opacity:.6}
.dsh-cosmos-queue-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--cos-accent,#ffd28a)}
.dsh-cosmos-queue-dot[data-indicator=running]{animation:cos-queue-breath 2.4s ease-in-out infinite}
.dsh-cosmos-queue-dot[data-indicator=waiting]{background:var(--dsw-alias-state-warn-primary,var(--cos-waiting,#ffaa4a))}
@keyframes cos-queue-breath{0%,100%{opacity:.35;transform:scale(.8)}50%{opacity:1;transform:scale(1.2)}}
@media (prefers-reduced-motion:reduce){
  .dsh-cosmos-queue-dot[data-indicator=running]{animation:none;opacity:1;transform:none}
}
.dsh-cosmos-queue-paused{flex:none;font-size:10px;line-height:14px;padding:0 4px;white-space:nowrap;
  color:var(--dsw-alias-state-warn-primary,var(--cos-waiting,#ffaa4a));
  border:1px solid var(--dsw-alias-state-warn-primary,var(--cos-waiting,#ffaa4a))}
.dsh-cosmos-queue-auto{flex:1 1 auto;min-width:0;text-align:right;font-size:10px;letter-spacing:.5px;
  color:rgb(var(--cos-accent-ink-rgb,255 227 184) / .5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-cosmos-queue-pause,.dsh-cosmos-queue-clear{flex:none;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;
  min-width:22px;height:22px;padding:0 3px;cursor:pointer;font:inherit;font-size:11px;line-height:1;
  color:var(--cos-accent-ink,#ffe3b8);background:rgb(var(--cos-accent-rgb,255 210 140) / .1);
  border:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .45)}
.dsh-cosmos-queue-pause:hover,.dsh-cosmos-queue-clear:hover{background:rgb(var(--cos-accent-rgb,255 210 140) / .24);
  border-color:rgb(var(--cos-accent-rgb,255 210 140) / .85)}
.dsh-cosmos-queue-pause:focus-visible,.dsh-cosmos-queue-clear:focus-visible{outline:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .85);outline-offset:1px}
/* 清空两击确认 armed 态（spec「清空 SHALL 经一次确认」，误触不可恢复）：提亮为警示色，
   约 3s 无操作回弹（定时器在组件内，MUST NOT 依赖 CSS 动画计时）。 */
.dsh-cosmos-queue-clear[data-armed=true]{color:#1c1408;background:var(--dsw-alias-state-warn-primary,var(--cos-waiting,#ffaa4a));
  border-color:var(--dsw-alias-state-warn-primary,var(--cos-waiting,#ffaa4a))}
.dsh-cosmos-queue-list{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;padding:6px 8px 10px;touch-action:pan-y;
  -webkit-user-select:text;user-select:text}
.dsh-cosmos-queue-row{position:relative;display:flex;align-items:center;gap:4px;box-sizing:border-box;margin:0 0 3px;padding:3px 4px 3px 6px;
  background:var(--cos-card-bg,rgba(10,10,20,.55));border:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .18)}
.dsh-cosmos-queue-row:hover{border-color:rgb(var(--cos-accent-rgb,255 210 140) / .6);background:rgb(var(--cos-accent-rgb,255 210 140) / .07)}
.dsh-cosmos-queue-row[data-state=failed],.dsh-cosmos-queue-row[data-state=skipped]{border-style:dashed;border-color:rgba(255,170,120,.4)}
.dsh-cosmos-queue-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px}
.dsh-cosmos-queue-name{font-size:12px;line-height:16px;color:var(--cos-ink,#ffe9cf);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-cosmos-queue-proposal{font-size:10px;line-height:14px;letter-spacing:.5px;color:var(--cos-ink-dim,rgba(255,233,207,.55));
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* 残留诊断行（failed / skipped）：错误色文案 + 单行省略——「留下可见记录」（spec
   「执行时刻复验跳过前进」），无诊断时组件零布局。 */
.dsh-cosmos-queue-detail{font-size:10px;line-height:14px;color:var(--dsw-alias-state-error-primary,#ff9f9f);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-cosmos-queue-badge{flex:none;max-width:52px;padding:0 5px;border-radius:999px;font-size:10px;line-height:14px;
  color:var(--cos-accent,#ffd28a);border:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .45);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-cosmos-queue-badge[data-badge=waiting]{color:var(--dsw-alias-state-warn-primary,var(--cos-waiting,#ffaa4a));
  border-color:var(--dsw-alias-state-warn-primary,var(--cos-waiting,#ffaa4a))}
.dsh-cosmos-queue-badge[data-badge=running]{color:var(--cos-accent-ink,#ffe3b8)}
.dsh-cosmos-queue-badge[data-badge=failed]{color:#ff9f9f;border-color:rgba(255,120,120,.6)}
.dsh-cosmos-queue-badge[data-badge=skipped]{opacity:.7}
.dsh-cosmos-queue-ops{flex:none;display:flex;align-items:center;gap:2px;opacity:.35;transition:opacity .15s}
.dsh-cosmos-queue-row:hover .dsh-cosmos-queue-ops,
.dsh-cosmos-queue-row:focus-within .dsh-cosmos-queue-ops{opacity:1}
.dsh-cosmos-queue-op{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;padding:0;cursor:pointer;
  font:inherit;font-size:10px;line-height:1;color:var(--cos-accent-ink,#ffe3b8);background:rgb(var(--cos-accent-rgb,255 210 140) / .08);
  border:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .35)}
.dsh-cosmos-queue-op:hover:not(:disabled){background:rgb(var(--cos-accent-rgb,255 210 140) / .24);
  border-color:rgb(var(--cos-accent-rgb,255 210 140) / .85)}
.dsh-cosmos-queue-op:focus-visible{outline:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .85);outline-offset:1px}
.dsh-cosmos-queue-op:disabled{opacity:.35;cursor:not-allowed}
/* 队列行受体标记（跨面板悬停联动，spec「队列条目联动提案卡」）：右缘三角指向提案面板
   （与会话行「左缘指左」的方向语义同族：指向受体所在的相邻面板）。 */
.dsh-cosmos-queue-row[data-linked=true]::after{content:"";position:absolute;top:50%;right:-9px;width:0;height:0;
  transform:translateY(-50%);pointer-events:none;
  border-top:7px solid transparent;border-bottom:7px solid transparent;
  border-left:8px solid rgb(var(--cos-accent-rgb,255 210 140) / .95);
  filter:drop-shadow(0 0 5px rgb(var(--cos-accent-rgb,255 210 140) / .55))}
/* ── 状态描边层（p2-add-cosmos-card-state-chrome 2.3–2.6；polish-cosmos-state-chrome-flow
      1.1–1.6）：会话行与正式提案卡的整卡描边随状态呈现——叠加于既有行内点/loader 与
      提案卡左缘生命周期色条之上（MUST NOT 替代）：busy（含 delegatedBusy）与 act>0 =
      宿主进行中通道色流动巡游（派生通道 --cos-flow-channel；令牌缺席回落 accent）；
      done-unread = done 色静态高亮 + glow；waiting = warning 色慢脉冲；
      idle 与 act=0（沉睡）= 现状静默（沉睡 MUST NOT 用虚线——虚线为星胚「还没出生」
      专有语义）。环带层 = 容器 ::before（absolute inset:0），流动态以 padding + 双层
      mask 挖空中心、只留 1px 边环。流动态形态 = 双背景顺时针巡游：底层通道低α 均匀
      常亮基线（描边任意时刻连续可见，无空窗），顶层 conic 单亮带承载流动——彗星尾向
      （design D2 定稿）：亮头为顺时针最前点、渐隐尾迹拖在头后方逆时针侧（transparent
      前半圈余量、末 ~110deg 向亮头渐入，MUST NOT 呈亮尾在前的反向彗星读感）。conic
      角度由 @property 注册的 --cos-chrome-flow 驱动（keyframes 0→360deg 插值 =
      绕环一周，2.4s linear）；**使用处 var(--cos-chrome-flow,0deg) fallback 必写
      （design D1/D4 降级前提）**：@property 不支持的旧内核上未注册自定义属性是
      guaranteed-invalid，缺 fallback 整条 background IACVT 回落透明、环不可见；带
      fallback 则降级为静态光带 + 常亮基线，色信息保留、可用性无损。环带
      pointer-events:none（覆盖整卡，缺省会挡住「打开」钮与卡片命中/悬停）。动画仅由
      状态选择器触发（无常驻）；选中态优先（animation:none + background 覆盖为进行中通道
      α.5 均匀静态色环，MUST NOT 冻结动画中间帧的不对称亮块，MUST NOT 双动画叠在
      同一条边）；reduced-motion 下时长归零 + 同色均匀静态色环（waiting 动画为透明度
      呼吸，时长归零即均匀色，口径维持现状）。取色零新增 HUD 令牌：进行中派生通道
      --cos-flow-channel（宿主 alias 在场随主题换肤级联、缺席经 var 链回落 accent）/
      --cos-done / --cos-waiting 经宿主 alias → 皮肤令牌级联；glow 挂环带层（light 覆盖块只清元素级，
      不触及伪元素）。 ── */
/* 进行中派生通道（align-cosmos-flow-host-color 1.1 / design D2）：挂整页根容器
   「.cos-page」（与皮肤 HUD 令牌同址 → 宿主 alias 在场即随 dsh 主题「进行中」色级联
   换肤；令牌缺席回落当前皮肤 accent，观感与变更前一致）。三处消费：流光族 /
   选中静态降级 / reduced-motion 静态色环。 */
.cos-page{--cos-flow-channel:var(--dsw-alias-state-business-primary,var(--cos-accent,#ffd28a))}
.dsh-cosmos-session-row,.dsh-cosmos-panel-card{position:relative}
.dsh-cosmos-session-row::before,.dsh-cosmos-panel-card::before{content:'';position:absolute;inset:0;
  pointer-events:none;border-radius:inherit}
/* 注册角度自定义属性（design D1）：keyframes 需注册 <angle> 才能对自定义属性插值。 */
@property --cos-chrome-flow{syntax:'<angle>';inherits:false;initial-value:0deg}
.dsh-cosmos-session-row[data-state=busy]::before,
.dsh-cosmos-panel-card[data-act=active]::before{padding:1px;
  background:conic-gradient(from var(--cos-chrome-flow,0deg),transparent 0deg,transparent 250deg,rgb(var(--cos-accent-rgb,255 210 140) / .95) 360deg),
    linear-gradient(rgb(var(--cos-accent-rgb,255 210 140) / .28),rgb(var(--cos-accent-rgb,255 210 140) / .28));
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
  -webkit-mask-composite:xor;
  mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
  mask-composite:exclude;
  animation:cos-state-chrome-flow 2.4s linear infinite}
@keyframes cos-state-chrome-flow{to{--cos-chrome-flow:360deg}}
/* @supports 升级（align-cosmos-flow-host-color 2.1 / design D3）：color-mix 可用时取色
   改走进行中通道——宿主 alias 是 hex（无 RGB 三元组形态），α 叠层（常亮基线 .28 /
   亮带 .95）由 color-mix 与 transparent 组合；不命中（老内核）整块跳过，保留上方
   accent 基线声明（降级态 = 变更前观感，零功能损失）。 */
@supports (background: color-mix(in srgb, red 50%, transparent)){
  .dsh-cosmos-session-row[data-state=busy]::before,
  .dsh-cosmos-panel-card[data-act=active]::before{
    background:conic-gradient(from var(--cos-chrome-flow,0deg),transparent 0deg,transparent 250deg,color-mix(in srgb,var(--cos-flow-channel) 95%,transparent) 360deg),
      linear-gradient(color-mix(in srgb,var(--cos-flow-channel) 28%,transparent),color-mix(in srgb,var(--cos-flow-channel) 28%,transparent))}
}
.dsh-cosmos-session-row[data-state=done-unread]::before{border:1px solid var(--dsw-alias-state-success-primary,var(--cos-done,#5affc0));
  box-shadow:0 0 10px var(--dsw-alias-state-success-primary,var(--cos-done,#5affc0))}
.dsh-cosmos-session-row[data-state=waiting]::before{border:1px solid var(--dsw-alias-state-warn-primary,var(--cos-waiting,#ffaa4a));
  animation:cos-state-chrome-pulse 2.4s ease-in-out infinite}
@keyframes cos-state-chrome-pulse{0%,100%{opacity:.55}50%{opacity:1}}
/* 选中优先（design D3）：busy/active 静态降级为进行中通道 α.5 均匀静态色环（替代动画停帧的
   不对称亮块），waiting 静止帧本就均匀（透明度呼吸），仅停动画——与既有
   [data-selected=true] 高亮同用，无双动画叠在同一条边上。 */
.dsh-cosmos-session-row[data-selected=true][data-state=busy]::before,
.dsh-cosmos-panel-card[data-selected=true][data-act=active]::before{animation:none;
  background:rgb(var(--cos-accent-rgb,255 210 140) / .5)}
/* color-mix 可用时选中静态色环同走进行中通道（accent 基线保留在上，降级态不变）。 */
@supports (background: color-mix(in srgb, red 50%, transparent)){
  .dsh-cosmos-session-row[data-selected=true][data-state=busy]::before,
  .dsh-cosmos-panel-card[data-selected=true][data-act=active]::before{background:color-mix(in srgb,var(--cos-flow-channel) 50%,transparent)}
}
.dsh-cosmos-session-row[data-selected=true][data-state=waiting]::before{animation:none}
@media (prefers-reduced-motion:reduce){
  .dsh-cosmos-session-row[data-state=busy]::before,
  .dsh-cosmos-panel-card[data-act=active]::before{animation-duration:0s;animation-iteration-count:1;
    background:rgb(var(--cos-accent-rgb,255 210 140) / .5)}
  .dsh-cosmos-session-row[data-state=waiting]::before{animation-duration:0s;animation-iteration-count:1}
  /* color-mix 可用时静态色环同走进行中通道（accent 基线保留在上，降级态不变）。 */
  @supports (background: color-mix(in srgb, red 50%, transparent)){
    .dsh-cosmos-session-row[data-state=busy]::before,
    .dsh-cosmos-panel-card[data-act=active]::before{background:color-mix(in srgb,var(--cos-flow-channel) 50%,transparent)}
  }
}
/* ── 跨面板悬停关联标记（polish-cosmos-session-focus-and-hover-markers 1.1）：方向三角
      （CSS 边框绘制，非字符字形）替代 p2 的字符 glyph。会话行标记在**列表右缘**、指向
      **左**（「<」方向）；提案卡标记在**左缘**、指向**右**（「>」方向）——方向语义与 p2
      的「<」/「>」一致，位置按评审把会话行标记移到列表右侧。槽位仍取 ::after
      （::before 归状态描边层）；绝对定位入面板清单 8px 内边距槽（行 right:-9px = 1px
      右边框 + 槽；正式卡 left:-11px = 3px 左边框 + 槽；星胚卡 1px 左边框 → 覆盖
      left:-9px），零布局扰动、不覆盖生命周期色条；content 为空 → 天然不进可访问名；
      pointer-events:none 不拦截命中；静态无动效，微光经 filter 跟随三角形状。 */
.dsh-cosmos-session-row[data-linked=true]::after,
.dsh-cosmos-panel-card[data-linked=true]::after{content:"";position:absolute;top:50%;
  width:0;height:0;transform:translateY(-50%);pointer-events:none;
  border-top:7px solid transparent;border-bottom:7px solid transparent;
  filter:drop-shadow(0 0 5px rgb(var(--cos-accent-rgb,255 210 140) / .55))}
.dsh-cosmos-session-row[data-linked=true]::after{right:-9px;
  border-right:8px solid rgb(var(--cos-accent-rgb,255 210 140) / .95)}
.dsh-cosmos-panel-card[data-linked=true]::after{left:-11px;
  border-left:8px solid rgb(var(--cos-accent-rgb,255 210 140) / .95)}
.dsh-cosmos-panel-card[data-embryo][data-linked=true]::after{left:-9px}
/* ── 星座动作条（add-cosmos-constellation-actions 3.1；swap-cosmos-panel-sides 2.4 角标
      随面板镜像到左下）：面板 footer、钻取态专属。
      等宽按钮（flex-basis 0、按行均分）+ 超出面板宽度自动换行；触屏点击目标 ≥40px；
      配色优先官方 --dsw-alias-* token（主题切换自动跟随），token 缺席时回落风格 D
      基线（暖金 #ffe3b8 / rgba(255,210,140,…)），角标装饰沿用 HUD 语言。 ── */
.dsh-cosmos-const-actions{position:relative;flex:none;box-sizing:border-box;display:flex;flex-wrap:wrap;gap:5px;
  padding:6px 8px;border-top:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .28);background:var(--cos-card-bg,rgba(10,10,20,.55))}
.dsh-cosmos-const-actions::after{content:'';position:absolute;left:-1px;bottom:-1px;width:8px;height:8px;
  border-bottom:2px solid var(--cos-line-strong,#ffd28a);border-left:2px solid var(--cos-line-strong,#ffd28a);pointer-events:none}
.dsh-cosmos-const-action{flex:1 1 0;box-sizing:border-box;min-width:0;min-height:var(--cos-const-action-h, 40px);padding:4px 6px;
  display:flex;align-items:center;justify-content:center;font:inherit;font-size:11px;letter-spacing:.5px;
  color:var(--dsw-alias-label-primary,var(--cos-accent-ink,#ffe3b8));
  background:var(--dsw-alias-interactive-bg-hover,rgb(var(--cos-accent-rgb,255 210 140) / .08));
  border:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .4);border-radius:0;cursor:pointer;
  transition:background .15s,border-color .15s}
.dsh-cosmos-const-action:hover{background:var(--dsw-alias-interactive-bg-hover-solid,rgb(var(--cos-accent-rgb,255 210 140) / .2));
  border-color:rgb(var(--cos-accent-rgb,255 210 140) / .85)}
.dsh-cosmos-const-action:focus-visible{outline:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .85);outline-offset:2px}
.dsh-cosmos-const-label{min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* ── 星座浮窗输入器（add-cosmos-constellation-actions 4.2）：body portal，z 序高于
      Cosmos 覆盖层（页面 toast 9999 之下，toast 仍可见）；配色走官方 --dsw-alias-*
      token（theme 插件换肤自动跟随，明暗主题无需刷新），暖金描边/角标为 HUD 装饰层；
      发送/关闭触屏目标 ≥40px。 ── */
.dsh-cosmos-const-float{position:fixed;inset:0;z-index:9998;box-sizing:border-box;display:flex;align-items:center;
  justify-content:center;padding:24px}
.dsh-cosmos-const-float-backdrop{position:absolute;inset:0;background:rgba(4,5,12,.55)}
.dsh-cosmos-const-float-card{--cos-float-body-max:298px;position:relative;z-index:1;box-sizing:border-box;display:flex;flex-direction:column;gap:8px;
  width:min(560px,100%);padding:12px 14px;color:var(--dsw-alias-label-primary,var(--cos-ink,#ffe9cf));
  background:var(--dsw-alias-bg-base,var(--cos-panel-strong,rgba(8,8,16,.96)));border:1px solid var(--dsw-alias-border-l2,var(--cos-line,rgba(255,210,140,.4)));
  border-radius:10px;box-shadow:0 18px 48px rgba(0,0,0,.45)}
.dsh-cosmos-const-float-card::before,.dsh-cosmos-const-float-card::after{content:'';position:absolute;width:10px;height:10px;pointer-events:none}
.dsh-cosmos-const-float-card::before{top:-1px;left:-1px;border-top:2px solid var(--cos-line-strong,#ffd28a);border-left:2px solid var(--cos-line-strong,#ffd28a)}
.dsh-cosmos-const-float-card::after{bottom:-1px;right:-1px;border-bottom:2px solid var(--cos-line-strong,#ffd28a);border-right:2px solid var(--cos-line-strong,#ffd28a)}
.dsh-cosmos-const-float-head{display:flex;align-items:center;gap:8px}
.dsh-cosmos-const-float-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-size:14px;font-weight:600;letter-spacing:.5px}
.dsh-cosmos-const-float-tag{flex:none;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:1px 8px;
  border-radius:999px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,var(--cos-accent,#ffd28a));
  border:1px solid var(--dsw-alias-border-l2,rgb(var(--cos-accent-rgb,255 210 140) / .45))}
.dsh-cosmos-const-float-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;
  padding:0;cursor:pointer;font:inherit;font-size:18px;line-height:1;border-radius:8px;
  color:var(--dsw-alias-label-tertiary,var(--cos-accent-ink,#ffe3b8));background:transparent;border:1px solid transparent}
.dsh-cosmos-const-float-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgb(var(--cos-accent-rgb,255 210 140) / .14));
  color:var(--dsw-alias-label-primary,var(--cos-title-ink,#fff3dd))}
/* 分区骨架（p1-align-const-float-native-layout design D1）：head → 附件 rail 槽位 → 文本面 →
   工具行 → hint 行。rail 恒渲染（p2 附件挂点）、空态零布局：恒无子节点 → 「:empty」成立；
   「display:none」的 flex 子项不参与布局、不产生 gap（文本面上缘零额外间距）。
   p2 填充（design D7）：单行横向缩略图列表（不折行）、滚动条隐藏——附件量小，不做原生
   rail 的分页箭头与滚轮横滚转发。 */
.dsh-cosmos-const-float-rail{display:flex;flex-wrap:nowrap;gap:6px;min-width:0;overflow-x:auto;overflow-y:hidden;scrollbar-width:none}
.dsh-cosmos-const-float-rail::-webkit-scrollbar{display:none}
.dsh-cosmos-const-float-rail:empty{display:none}
/* 缩略图（design D7 简化原生 rail）：64×64 圆角封面 + 上传态角标 + 移除钮（hover 显 /
   触屏恒显）。配色走官方 token（明暗主题自动跟随）+ HUD 角标语言。 */
.dsh-cosmos-const-float-thumb{position:relative;flex:none;box-sizing:border-box;display:flex;align-items:center;
  justify-content:center;width:64px;height:64px;padding:0;overflow:hidden;border-radius:8px;
  background:var(--dsw-alias-interactive-bg-hover,rgb(var(--cos-accent-rgb,255 210 140) / .08));
  border:1px solid var(--dsw-alias-border-l2,var(--cos-line,rgba(255,210,140,.35)))}
.dsh-cosmos-const-float-thumb-img{display:block;width:100%;height:100%;object-fit:cover}
.dsh-cosmos-const-float-thumb-name{max-width:100%;max-height:100%;padding:2px 4px;overflow:hidden;
  font-size:10px;line-height:12px;letter-spacing:.5px;word-break:break-all;
  color:var(--dsw-alias-label-secondary,var(--cos-accent,#ffd28a))}
.dsh-cosmos-const-float-thumb-badge{position:absolute;top:4px;left:4px;z-index:1;box-sizing:border-box;display:grid;
  place-items:center;width:18px;height:18px;border-radius:50%;font:inherit;font-size:11px;line-height:1;color:#fff;
  background:var(--dsw-alias-state-business-primary,#c8963e)}
.dsh-cosmos-const-float-thumb-badge[data-state=uploading]{background:transparent;
  border:2px solid rgb(255 255 255 / .4);border-top-color:var(--dsw-alias-label-primary,#fff);
  animation:cos-float-attach-spin .9s linear infinite}
@keyframes cos-float-attach-spin{to{transform:rotate(360deg)}}
.dsh-cosmos-const-float-thumb-badge[data-state=error]{background:var(--dsw-alias-state-error-primary,#ff9f9f)}
.dsh-cosmos-const-float-thumb-remove{position:absolute;top:4px;right:4px;z-index:2;display:grid;place-items:center;
  width:20px;height:20px;padding:0;border:none;border-radius:50%;cursor:pointer;font:inherit;font-size:12px;line-height:1;
  color:var(--dsw-alias-label-primary-inverted,#151515);
  background:var(--dsw-alias-button-contrast-fill,rgb(255 255 255 / .85));
  opacity:0;transition:opacity .15s ease-in-out}
.dsh-cosmos-const-float-thumb:hover .dsh-cosmos-const-float-thumb-remove,
.dsh-cosmos-const-float-thumb-remove:focus-visible{opacity:1}
/* 触屏无 hover：移除钮恒显（原生 rail 同口径）。 */
@media (hover: none), (pointer: coarse){
  .dsh-cosmos-const-float-thumb-remove{opacity:1}
}
.dsh-cosmos-const-float-body{min-width:0}
.dsh-cosmos-const-float-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0}
/* 工具行左簇（design D3）：p2 填充 = 隐藏 file input（批量拾取）+ 添加图片钮；零宽空容器
   变成实钮后自然撑开。 */
.dsh-cosmos-const-float-tools{display:flex;flex:none;align-items:center;gap:8px;min-width:0}
.dsh-cosmos-const-float-file{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;
  clip:rect(0 0 0 0);white-space:nowrap;border:0}
/* 添加图片钮（40×40 触屏目标）。降级态 = 置灰但**可点**（引导 toast）：只降视觉权重、
   不吞事件——MUST NOT 写 pointer-events:none 或原生 disabled。 */
.dsh-cosmos-const-float-attach{flex:none;box-sizing:border-box;display:inline-flex;align-items:center;
  justify-content:center;min-width:40px;min-height:40px;padding:0;cursor:pointer;
  font:inherit;font-size:18px;line-height:1;border-radius:8px;
  color:var(--dsw-alias-label-primary,var(--cos-ink,#ffe9cf));background:transparent;
  border:1px solid var(--dsw-alias-border-l2,var(--cos-line,rgba(255,210,140,.4)))}
.dsh-cosmos-const-float-attach:hover{background:var(--dsw-alias-interactive-bg-hover,rgb(var(--cos-accent-rgb,255 210 140) / .14))}
.dsh-cosmos-const-float-attach[data-state=unavailable]{opacity:.6;cursor:not-allowed;
  border-color:var(--dsw-alias-border-l1,var(--cos-line,rgba(255,210,140,.28)))}
.dsh-cosmos-const-float-attach[data-state=unavailable]:hover{background:transparent}
.dsh-cosmos-const-float-attach:focus-visible{outline:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .85);outline-offset:2px}
/* 右簇（design D3，对齐原生 trailing 簇次序）：模型下拉 → 级别下拉 → 语音钮 → 发送钮；
   「margin-left:auto」靠右；允许收缩（「flex:1 1 auto」+「max-width:100%」）——窄卡把收缩后的
   宽度交给内部「flex-wrap」折行，MUST NOT 溢出卡片。 */
.dsh-cosmos-const-float-trailing{display:flex;flex:1 1 auto;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:8px;
  margin-left:auto;min-width:0;max-width:100%;font-size:12px;line-height:16px;
  color:var(--dsw-alias-label-tertiary,var(--cos-ink-dim,#cbb89a))}
.dsh-cosmos-const-float-model-select,.dsh-cosmos-const-float-effort-select{flex:none;min-width:0;max-width:220px;box-sizing:border-box;
  min-height:28px;padding:2px 6px;font:inherit;font-size:12px;border-radius:6px;outline:none;
  color:var(--dsw-alias-label-primary,var(--cos-ink,#ffe9cf));
  background:var(--dsw-alias-bg-base,var(--cos-panel-strong,rgba(10,10,20,.9)));
  border:1px solid var(--dsw-alias-border-l2,var(--cos-line,rgba(255,210,140,.35)))}
.dsh-cosmos-const-float-model-select:focus,.dsh-cosmos-const-float-effort-select:focus{border-color:var(--dsw-alias-border-inverted,rgb(var(--cos-accent-rgb,255 210 140) / .85))}
.dsh-cosmos-const-float-trailing[data-state=switching] .dsh-cosmos-const-float-model-select,
.dsh-cosmos-const-float-trailing[data-state=switching] .dsh-cosmos-const-float-effort-select{opacity:.6}
.dsh-cosmos-const-float-trailing[data-state=failed] .dsh-cosmos-const-float-model-select,
.dsh-cosmos-const-float-trailing[data-state=failed] .dsh-cosmos-const-float-effort-select{border-color:var(--dsw-alias-state-error-primary,#ff9f9f)}
.dsh-cosmos-const-float-model-note{flex:none;font-size:11px;opacity:.7}
/* 文本面（design D2）：JS 依内容写回高度（最小 3 行 = 78px；封顶 14 行 =
   「--cos-float-body-max」298px；border-box 闭合 = 行高 20px × 行数 + 垂直 padding 2×8px +
   上下边框 2×1px），封顶后「overflow-y:auto」内部滚动；「resize:none」= 无手动拉拽把手。 */
.dsh-cosmos-const-float-input{box-sizing:border-box;width:100%;min-height:78px;max-height:var(--cos-float-body-max,298px);
  resize:none;overflow-y:auto;padding:8px 10px;border-radius:8px;
  font:inherit;font-size:13px;line-height:20px;outline:none;color:var(--dsw-alias-label-primary,var(--cos-ink,#ffe9cf));
  background:var(--dsw-alias-bg-base,var(--cos-panel-strong,rgba(10,10,20,.9)));border:1px solid var(--dsw-alias-border-l2,var(--cos-line,rgba(255,210,140,.35)))}
.dsh-cosmos-const-float-input:focus{border-color:var(--dsw-alias-border-inverted,rgb(var(--cos-accent-rgb,255 210 140) / .85))}
.dsh-cosmos-const-float-input::placeholder{color:var(--dsw-alias-label-dimmed,rgb(var(--cos-accent-ink-rgb,255 227 184) / .45))}
/* hint 行（design D5）：工具行下方独立块级一行（卡内最底分区，对齐原生 composer 卡下 dock）。 */
.dsh-cosmos-const-float-hintline{min-width:0}
.dsh-cosmos-const-float-voice{flex:none;box-sizing:border-box;min-width:64px;min-height:40px;padding:8px 12px;cursor:pointer;
  font:inherit;font-size:13px;border-radius:8px;color:var(--dsw-alias-label-primary,var(--cos-ink,#ffe9cf));
  background:transparent;border:1px solid var(--dsw-alias-border-l2,var(--cos-line,rgba(255,210,140,.4)))}
.dsh-cosmos-const-float-voice:hover{background:var(--dsw-alias-interactive-bg-hover,rgb(var(--cos-accent-rgb,255 210 140) / .14))}
.dsh-cosmos-const-float-voice[data-state=recording]{color:#fff;border-color:var(--dsw-alias-state-error-primary,#ff9f9f);
  background:var(--dsw-alias-state-error-primary,rgba(255,120,120,.35))}
.dsh-cosmos-const-float-voice[data-state=transcribing]{opacity:.6;cursor:default}
/* 不可用（语音 Bundle 未启用 / 旧宿主 face 缺席）：置灰但仍可点（点击 → 引导 toast +
   Bundle 详情页跳转），故只降视觉权重、不吞事件——MUST NOT 写 pointer-events:none。 */
.dsh-cosmos-const-float-voice[data-state=unavailable]{opacity:.6;cursor:not-allowed;
  border-color:var(--dsw-alias-border-l1,var(--cos-line,rgba(255,210,140,.28)))}
.dsh-cosmos-const-float-voice[data-state=unavailable]:hover{background:transparent}
.dsh-cosmos-const-float-voice:focus-visible{outline:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .85);outline-offset:2px}
.dsh-cosmos-const-float-hint{display:block;min-width:0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#cbb89a)}
/* 发送钮（design D4）：原生同款箭头图标钮（图标 path 与「InputBar.tsx」主发送钮同源）；
   40×40 触屏目标，配色沿既有 business-primary 底 + 白色前景（仅文本换图标）。 */
.dsh-cosmos-const-float-send{flex:none;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;
  min-width:40px;min-height:40px;padding:0;cursor:pointer;
  border-radius:8px;border:1px solid transparent;color:#fff;
  background:var(--dsw-alias-state-business-primary,#c8963e)}
.dsh-cosmos-const-float-send:hover{filter:brightness(1.08)}
/* 发送禁用（p2 design D5：上传未就绪 / 机器忙）：只降视觉权重，点击由原生 disabled 语义阻断。 */
.dsh-cosmos-const-float-send:disabled{opacity:.5;cursor:default;filter:none}
.dsh-cosmos-const-float-send:focus-visible,.dsh-cosmos-const-float-close:focus-visible{outline:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .85);outline-offset:2px}
/* ── 动作按钮条（4.1）：正下方居中、一行 8 个等宽、自动换行（≤4 行）；左右安全边距
      避开左下「＋」与右下 HUD 按钮（add-cosmos-layout-tuning D4：右缘为「回到银河 +
      拖拽平移」双按钮横排，边距按两簇较宽者与尺寸键派生——不再是只够单列的写死值）；
      触屏目标 ≥40px。滚轮缩放由页面 ref 转发。 ── */
.dsh-cosmos-actions{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);z-index:43;box-sizing:border-box;
  display:grid;grid-template-columns:repeat(var(--cos-cols,4),minmax(0,1fr));gap:6px;
  width:min(calc(100% - (2 * max(var(--cos-add-btn-size, 44px), calc(2 * var(--cos-hud-btn-size, 44px) + 8px)) + 56px)),
    calc((var(--cos-cols,4)) * (2 * var(--cos-action-btn-w, 112px) + 6px) + ((var(--cos-cols,4)) - 1) * 6px));
  padding:6px 8px;background:var(--cos-panel-soft,rgba(8,8,16,.62));border:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .28);pointer-events:auto}
.dsh-cosmos-actions::before{content:'';position:absolute;left:-1px;bottom:-1px;width:8px;height:8px;
  border-bottom:2px solid var(--cos-line-strong,#ffd28a);border-left:2px solid var(--cos-line-strong,#ffd28a);pointer-events:none}
/* ── 配套入队钮（add-cosmos-action-queue 5.3 / design D7；按用户反馈改版：同尺寸、成对）──
   每个动作按钮与「＋ 入队」按钮在一个成对容器内（1fr 1fr）→ 两钮**完全同宽同高**；
   一对占原列宽×2，每行最多 4 对（= 原 8 列满宽），动作条最大宽度不变。入队钮仅以
   虚线描边 + 更淡底色区分主次（不缩小点击目标）；禁用态同主按钮族。 ── */
.dsh-cosmos-action-pair{display:grid;grid-template-columns:1fr 1fr;gap:6px;min-width:0}
.dsh-cosmos-enqueue{box-sizing:border-box;min-height:var(--cos-action-btn-h, 40px);padding:6px 8px;display:flex;align-items:center;justify-content:center;
  font:inherit;font-size:12px;letter-spacing:.5px;color:var(--cos-accent-ink,#ffe3b8);background:rgb(var(--cos-accent-rgb,255 210 140) / .04);
  border:1px dashed rgb(var(--cos-accent-rgb,255 210 140) / .42);cursor:pointer;transition:background .15s,border-color .15s,opacity .15s}
.dsh-cosmos-enqueue:hover:not(:disabled){background:rgb(var(--cos-accent-rgb,255 210 140) / .2);border-color:rgb(var(--cos-accent-rgb,255 210 140) / .85)}
.dsh-cosmos-enqueue:focus-visible{outline:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .85);outline-offset:2px}
.dsh-cosmos-enqueue:disabled{opacity:.35;cursor:not-allowed}
.dsh-cosmos-action{box-sizing:border-box;min-height:var(--cos-action-btn-h, 40px);padding:6px 8px;display:flex;align-items:center;justify-content:center;
  font:inherit;font-size:12px;letter-spacing:.5px;color:var(--cos-accent-ink,#ffe3b8);background:rgb(var(--cos-accent-rgb,255 210 140) / .08);
  border:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .4);cursor:pointer;transition:background .15s,border-color .15s,opacity .15s}
.dsh-cosmos-action:hover:not(:disabled){background:rgb(var(--cos-accent-rgb,255 210 140) / .2);border-color:rgb(var(--cos-accent-rgb,255 210 140) / .85)}
.dsh-cosmos-action:focus-visible{outline:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .85);outline-offset:2px}
.dsh-cosmos-action:disabled{opacity:.45;cursor:not-allowed}
/* 选中提案 → 动作条点亮（无选中时按钮禁用 + 透明度熄灭，见上）。 */
.dsh-cosmos-actions[data-armed=true]{border-color:rgb(var(--cos-accent-rgb,255 210 140) / .55);box-shadow:0 0 16px rgb(var(--cos-accent-rgb,255 210 140) / .12)}
.dsh-cosmos-actions[data-armed=true] .dsh-cosmos-action{color:var(--cos-title-ink,#fff3dd);background:rgb(var(--cos-accent-rgb,255 210 140) / .14);border-color:rgb(var(--cos-accent-rgb,255 210 140) / .6)}
.dsh-cosmos-actions[data-armed=true] .dsh-cosmos-action:hover:not(:disabled){background:rgb(var(--cos-accent-rgb,255 210 140) / .26);border-color:var(--cos-accent,#ffd28a)}
.dsh-cosmos-action-label{min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* ── hero 消费 toast（Cosmos 整页关闭后仍可提示：fixed 定位、页面外节点） ── */
.dsh-cosmos-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:96px;z-index:9999;padding:8px 14px;
  border:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .5);border-radius:4px;background:var(--cos-panel-strong,rgba(8,8,16,.94));color:var(--cos-accent-ink,#ffe3b8);font-size:13px;
  opacity:0;transition:opacity .15s;pointer-events:none}
.dsh-cosmos-toast[data-show=true]{opacity:1}
.dsh-cosmos-toast[data-error=true]{color:#ff9f9f;border-color:rgba(255,120,120,.6)}
/* ── light 模式（纸面皮肤 fidenza；add-cosmos-skin-themes D3/3.1）：纸底卡 + 墨描边 +
      柔影（--cos-shadow），扫描线强制关闭。差异一律由 CSS 分支吸收，MUST NOT 在 JS
      里逐规则改写样式。 ── */
[data-cos-mode="light"] .cos-card,
[data-cos-mode="light"] .dsh-cosmos-panel,
[data-cos-mode="light"] .dsh-cosmos-panel-card,
[data-cos-mode="light"] .dsh-cosmos-sessions,
[data-cos-mode="light"] .dsh-cosmos-queue,
[data-cos-mode="light"] .dsh-cosmos-session-row,
[data-cos-mode="light"] .dsh-cosmos-queue-row,
[data-cos-mode="light"] .dsh-cosmos-actions,
[data-cos-mode="light"] .dsh-cosmos-const-actions,
[data-cos-mode="light"] .cos-search,
[data-cos-mode="light"] .cos-add-btn,
[data-cos-mode="light"] .cos-home-btn,
[data-cos-mode="light"] .cos-chip,
[data-cos-mode="light"] .cos-toast{box-shadow:var(--cos-shadow,none);text-shadow:none}
[data-cos-mode="light"] .cos-scanlines{display:none}
/* ── 右栏停靠正文（add-cosmos-rightbar-dock D1/D7）：承载容器铺满宿主停靠列；列形
      防遮挡微调——信息卡/名牌/chip 的翻转换算由引擎按容器尺寸派生（E.W/E.H），此处只
      约束卡盒与 HUD 的列宽密度：窄列下卡体不越缘（max-width 相对容器）、两侧面板
      按列宽收缩、搜索框与动作条收起固定页宽依赖。 ── */
.cos-page-dock{position:absolute;inset:0;overflow:hidden}
/* 窄列重排（add-cosmos-rightbar-dock D7）：搜索框独占顶部一条，两侧面板自其下起排
   （避免 300px 级列宽下搜索框被面板完全遮挡）；清单面板默认折叠（本地态，不污染
   整页持久偏好），提案面板按列宽收缩，画布始终保有一条可操作带。 */
.cos-page-dock .cos-search{top:10px;left:8px;transform:none;width:min(var(--cos-search-w,320px), calc(100% - 16px));min-width:0;max-width:calc(100% - 16px)}
.cos-page-dock .dsh-cosmos-panel{top:52px;width:min(var(--cos-const-panel-w,187px), 42%)}
.cos-page-dock .dsh-cosmos-panel[data-drill=true]{top:52px}
/* 队列面板的 dock 适配（add-cosmos-action-queue 5.2）：与提案面板同起排线（top:52px），
   宽度按列宽收缩到 34%（比提案面板更窄，给画布留出可操作带）；左邻偏移按提案面板
   **实际渲染宽**回算——否则窄列下 187px 的固定 right 会把队列面板推到提案面板底下
   （right 取与提案面板 width 相同的 min() 表达式 → 两面板恒不重叠）。 */
.cos-page-dock .dsh-cosmos-queue{top:52px;width:min(var(--cos-const-panel-w,187px), 34%);
  right:calc(min(var(--cos-const-panel-w,187px), 42%) + 8px)}
.cos-page-dock .dsh-cosmos-sessions{top:52px;width:min(var(--cos-session-w,260px), 46%)}
.cos-page-dock .dsh-cosmos-sessions[data-collapsed=true]{width:48px}
.cos-page-dock .cos-card{min-width:min(230px, calc(100% - 16px));max-width:min(280px, calc(100% - 16px));
  max-height:calc(100% - 84px);overflow:auto}
.cos-page-dock .cos-chip{max-width:calc(100% - 16px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cos-page-dock .dsh-cosmos-actions{width:calc(100% - 24px);max-width:calc((var(--cos-cols,4)) * (2 * var(--cos-action-btn-w,112px) + 6px) + ((var(--cos-cols,4)) - 1) * 6px)}`;

function installStyles(ctx) {
  if (typeof document === "undefined") return;
  ctx.effect(() => {
    const tag = document.createElement("style");
    tag.dataset.plugin = PLUGIN_ID;
    tag.dataset.pluginCss = PLUGIN_ID + "/cosmos.css";
    tag.textContent = CSS;
    document.head.appendChild(tag);
    return () => tag.remove();
  }, "dsh-v-cosmos: stylesheets");
}

/** 设置页样式（add-cosmos-proposal-actions 5.x）：独立标签，插件卸载随 effect 移除。 */
function installSettingsStyles(ctx) {
  if (typeof document === "undefined") return;
  ctx.effect(() => {
    const tag = document.createElement("style");
    tag.dataset.plugin = PLUGIN_ID;
    tag.dataset.pluginCss = PLUGIN_ID + "/settings.css";
    tag.textContent = COSMOS_SETTINGS_CSS;
    document.head.appendChild(tag);
    return () => tag.remove();
  }, "dsh-v-cosmos: settings stylesheets");
}

/**
 * 模型目录桥（add-cosmos-proposal-actions 5.2 / 4.5；可选注入 `remote`/`remote.session`/
 * `sessions`）：目录与会话模型切换都走官方 client remote（与会话模型菜单同源）。
 * 目录 store 随官方三个 remote 事件重载、连接重置清旧值；失败/不可用 → status "error"。
 */
function createModelBridge(scope) {
  const remote = scope && typeof scope === "object" ? scope.remote : undefined;
  const sessions = scope && typeof scope === "object" ? scope.sessions : undefined;
  const session = remote && typeof remote === "object" ? remote.session : undefined;
  const supportsCatalog = session !== undefined && session !== null && typeof session.modelCatalog === "function";
  const store = createSnapshotStore({ status: "idle", groups: [] });
  let generation = 0;
  let inflight = null;
  const load = () => {
    if (!supportsCatalog) {
      store.set({ status: "error", groups: [] });
      return Promise.resolve();
    }
    if (inflight !== null) return inflight;
    const token = generation;
    store.set({ status: "loading", groups: [] });
    const operation = Promise.resolve()
      .then(() => session.modelCatalog())
      .then((response) => {
        if (token !== generation) return;
        if (!response || response.ok !== true) {
          store.set({ status: "error", groups: [] });
          return;
        }
        const value = response.value;
        store.set({ status: "ready", groups: value && Array.isArray(value.groups) ? value.groups : [] });
      })
      .catch(() => {
        if (token === generation) store.set({ status: "error", groups: [] });
      })
      .finally(() => {
        if (inflight === operation) inflight = null;
      });
    inflight = operation;
    return operation;
  };
  const refresh = () => {
    generation += 1;
    inflight = null;
    load();
  };
  const reset = () => {
    generation += 1;
    inflight = null;
    store.set({ status: "idle", groups: [] });
    load();
  };
  const offs = [];
  if (remote && typeof remote.$on === "function") {
    for (const event of ["llm/adapters-updated", "settings/document-updated", "credentials/reference-updated"]) {
      const off = remote.$on(event, refresh);
      if (typeof off === "function") offs.push(off);
    }
  }
  if (scope && typeof scope.on === "function") {
    const off = scope.on("connection/reset", reset);
    if (typeof off === "function") offs.push(off);
  }
  load();
  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    /** 会话可切换判据：子代理会话与无会话 id 一律 false（新会话恒 true）。 */
    canSwitch(sessionId) {
      if (typeof sessionId !== "string" || sessionId === "") return false;
      if (!sessions || typeof sessions.subagentAddress !== "function") return true;
      return sessions.subagentAddress(sessionId) === undefined;
    },
    /** 切换（显式判结果信封 ok；失败不抛，统一返回给调用方走降级分支）。 */
    async select(sessionId, model) {
      if (session === undefined || session === null || typeof session.selectModel !== "function") {
        return { ok: false, unavailable: true, error: "" };
      }
      const request = {
        sessionId,
        provider: model.provider,
        model: model.model,
        ...(model.reasoningEffort === undefined ? {} : { reasoningEffort: model.reasoningEffort })
      };
      let response;
      try {
        response = await session.selectModel(request);
      } catch (error) {
        return { ok: false, error: String(error?.message || error) };
      }
      if (!response || response.ok !== true) {
        const failure = response && response.error ? response.error : {};
        return { ok: false, error: String(failure.message || failure.code || "") };
      }
      return { ok: true, error: "" };
    },
    dispose() {
      for (const off of offs) {
        try {
          off();
        } catch {
          /* 单个退订失败不阻塞其余 */
        }
      }
      offs.length = 0;
    }
  };
}

/** 需要的服务：slots（注册）、locale（文案）、sessions/workspaces（官方镜像）、
 *  uiSession（统一会话状态快照，add-celestial-states 5.1）/ uiWorkspace（打开会话导航）。
 *  宿主 cordis 规则：ctx 属性 MUST 经 inject 声明方可访问（未声明访问抛
 *  "cannot get property X without inject"）——uiSession/uiWorkspace 均为 GUI 基础
 *  服务（dsh-client-ui-session / dsh-client-ui-workspace），声明后行星四态与
 *  「打开会话」可用；运行时另有记忆化安全解析兜底（D3 降级路径保留）。 */
export const inject = ["slots", "locale", "sessions", "workspaces", "uiSession", "uiWorkspace"];

export function apply(ctx) {
  installStyles(ctx);
  installSettingsStyles(ctx);

  ctx.effect(() => ctx.locale.register(NS, DICT), "dsh-v-cosmos: dictionaries");
  const t = ctx.locale.bind(NS);
  const sectionT = ctx.locale.bind(NS);

  /* ── 设置跨窗口桥（add-cosmos-rightbar-dock 4.1；add-cosmos-template-name-toggle 1.2 扩展）：
     同源 localStorage 是全部窗口共享的唯一设置面——他窗写入 `launchMode` / `templateNames`
     后经 `storage` 事件同步进受控镜像（入口文案/设置页单选与开关即时跟随）；入口按钮点击
     另现读持久值（双保险）。整页在本窗存活时，模板名开关另经 `engine.setTuning` 热更
     （值变才换串，见引擎 3.1）。与本面无关的 storage 键 → `settingsFromStorageEvent`
     返回 null，静默忽略。 */
  ctx.effect(() => {
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") return () => {};
    const onStorage = (event) => {
      const next = settingsFromStorageEvent(event);
      if (next === null) return;
      const prevTemplateNames = cosmosTemplateNamesStore.getSnapshot()?.templateNames === true;
      cosmosLaunchStore.set({ launchMode: next.launchMode });
      cosmosTemplateNamesStore.set({ templateNames: next.templateNames });
      /* 已打开的整页热更（add-cosmos-template-name-toggle 1.2/D4）：仅本键真实翻转时才触达
         引擎——MUST NOT 借同源桥顺带热更其它调参键（那属本提案范围外的行为变更）。 */
      if (prevTemplateNames !== (next.templateNames === true)) {
        try {
          controllerRef.current?.getEngine?.()?.setTuning?.({ templateNames: next.templateNames === true });
        } catch (error) {
          /* 他窗写入的模板名开关热更失败不阻断镜像同步（下次开页构造读持久值兜底）。 */
          console.warn("[dsh-v-cosmos] template names hot update failed:", error);
        }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      try {
        window.removeEventListener("storage", onStorage);
      } catch {
        /* 卸载期窗口已销毁（独立窗口关窗）→ 忽略 */
      }
    };
  }, "dsh-v-cosmos: settings storage bridge");

  /* ── 动作按钮配置通道 + 动作条数据面（add-cosmos-proposal-actions 2.4/5.x） ──
     三通道归一：自营 API（首选，apply 内同步 attach）→ settingsScope / configForms
     fallback → 合成只读（动作条不渲染、设置页只读，插件激活不受阻）。 */
  const activeScope = createActiveScope();
  const apiChannel = createApiChannel({ apiPath: CONFIG_API_PATH });
  const apiHandle = activeScope.attach(apiChannel);
  apiChannel.bind(apiHandle);
  const buttonsStore = createButtonsStore(activeScope, buttonsSectionOf);
  const publishButtons = () => cosmosButtonsFace.set(buttonsStore.getSnapshot());
  const offButtons = buttonsStore.subscribe(publishButtons);
  publishButtons();
  /* 星座动作配置：**独立节 + 独立 face + 独立控制器实例**（与提案动作互不读写）。 */
  const constButtonsStore = createButtonsStore(activeScope, constButtonsSectionOf, { field: "constellationButtons" });
  const publishConstButtons = () => cosmosConstButtonsFace.set(constButtonsStore.getSnapshot());
  const offConstButtons = constButtonsStore.subscribe(publishConstButtons);
  publishConstButtons();
  /* 路径配置面（step2-cosmos-openspec-path-setting 3.1–3.3）：与按钮两节共享同一设置
     作用域（activeScope），控制器只读写 `paths` 对象节（整节 CAS 写、null 键 = 键级
     unset）。web bundle 无 fs 通道 → 不注入 checkDir：存在性检查跳过（MAY 语义、
     非阻断），端点不可达时仅路径区禁用降级（launch 单选走 localStorage 面不受牵连）。 */
  const pathsSettings = createPathsSettingsController(activeScope);
  /* 跨域唯一性（add-cosmos-shortcuts 3.3/5.3/D9）：两个控制器实例的 `crossIssue` 在保存门
     并集查重（本侧草稿 + 另一侧当前草稿 + 全局四键生效值）。侧别经闭包固定；「另一侧」
     经惰性 holder 读取——控制器构造期即会 publish（此时对侧尚未创建，按空列表处理，
     两实例就绪后再经一次 discard 触发重算，见下）。 */
  const controllerSides = { proposals: null, constellations: null };
  const shortcutCrossIssue = (side, entries) => {
    const other = side === "proposals" ? controllerSides.constellations : controllerSides.proposals;
    const otherDrafts = other?.getSnapshot?.()?.buttonsDraft ?? [];
    const own = Array.isArray(entries) ? entries : [];
    return shortcutsIssue(cosmosShortcutsStore.getSnapshot(), {
      proposals: side === "proposals" ? own : otherDrafts,
      constellations: side === "constellations" ? own : otherDrafts
    });
  };
  const buttonSettings = createButtonSettingsController(activeScope, {
    crossIssue: (entries) => shortcutCrossIssue("proposals", entries)
  });
  controllerSides.proposals = buttonSettings;
  const constButtonSettings = createButtonSettingsController(activeScope, {
    ...CONSTELLATION_PROFILE,
    crossIssue: (entries) => shortcutCrossIssue("constellations", entries)
  });
  controllerSides.constellations = constButtonSettings;
  /* 两实例就绪 → 用一次 discard（草稿已为 null，纯重算）让双方按完整「另一侧」重算合法性；
     同时把两列表草稿投影进模块 store（「快捷键」页签 / 动作页签的行内冲突定位数据面）。 */
  const publishButtonDrafts = () => cosmosButtonDraftsStore.set({
    proposals: buttonSettings.getSnapshot()?.buttonsDraft ?? [],
    constellations: constButtonSettings.getSnapshot()?.buttonsDraft ?? []
  });
  const offDraftProposals = buttonSettings.subscribe(publishButtonDrafts);
  const offDraftConstButtons = constButtonSettings.subscribe(publishButtonDrafts);
  buttonSettings.discard();
  constButtonSettings.discard();
  publishButtonDrafts();

  /* 模型目录桥（可选注入；缺失 → 目录降级、切换返回 unavailable）。 */
  let modelBridge = null;
  let offModelBridge = null;
  const modelsStore = createSnapshotStore({ catalog: null });
  const modelsFace = {
    getSnapshot: () => modelsStore.getSnapshot(),
    subscribe: (listener) => modelsStore.subscribe(listener)
  };
  const publishCatalog = () => modelsStore.set({ catalog: modelBridge === null ? null : modelBridge.getSnapshot() });
  const switchSessionModel = (sessionId, model) => (modelBridge === null
    ? Promise.resolve({ ok: false, unavailable: true, error: "" })
    : modelBridge.select(sessionId, model));

  const tryInject = (deps, callback, label) => {
    if (typeof ctx.inject !== "function") return;
    try {
      ctx.inject(deps, (scope) => {
        try {
          return callback(scope);
        } catch (error) {
          console.error(`[dsh-v-cosmos] ${label} failed:`, error);
          return undefined;
        }
      });
    } catch (error) {
      console.error(`[dsh-v-cosmos] ${label} inject rejected:`, error);
    }
  };

  /* fallback 通道 1：web CLI 的 settingsScope（未注册命名空间时自然缺席）。 */
  tryInject(["settingsScope"], (scope) => {
    const channel = bindSettingsScopeChannel(scope);
    return activeScope.attach(channel) ?? undefined;
  }, "settingsScope channel");

  /* fallback 通道 2：桌面端的 configForms。 */
  tryInject(["configForms"], (scope) => {
    const channel = adaptConfigFormsChannel(scope);
    return activeScope.attach(channel) ?? undefined;
  }, "configForms channel");

  /* 模型目录桥（`remote.<namespace>` 是独立服务键 → MUST 声明 "remote.session"）。 */
  tryInject(["remote", "remote.session", "sessions"], (scope) => {
    modelBridge = createModelBridge(scope);
    offModelBridge = modelBridge.subscribe(publishCatalog);
    publishCatalog();
    return () => {
      offModelBridge?.();
      offModelBridge = null;
      modelBridge?.dispose();
      modelBridge = null;
      publishCatalog();
    };
  }, "model bridge");

  /* 语音转写桥（rework 方案 2：浮窗语音钮**借官方语音 Bundle 的服务层**，不复用其 UI——
     官方 VoiceInput 注入 `conversation.input.activity` 驻留槽位，浮窗拿不到）。依赖链：
     语音 Bundle 启用后注册 `remote.speech` Remote face（独立服务键 → MUST 声明
     "remote.speech"）；缺席（未启用）→ face.available=false，浮窗语音钮转「置灰可点」
     引导态（fix-cosmos-const-float-voice，零降级噪音）。
     转写调用 = `speech.transcribe({ audioBase64 })` → `RemoteResult` 信封（`ok` /
     `value.text` / `error.message`，由组件侧消费）；audioBase64 MUST 为 canonical
     16 kHz 单声道 PCM16 WAV（宿主 `validateWave` 硬校验），容器格式由**组件侧**先转码
     （与官方 `Recording.stop()` 同构），桥只做薄透传。
     引导跳转（未安装/未就绪时）经 `pluginNavigation.openBundle`（可选注入，缺席即不可跳）。 */
  let speechBridge = null;
  let pluginNavigationBridge = null;
  const speechStore = createSnapshotStore({ available: false });
  const speechFace = {
    getSnapshot: () => speechStore.getSnapshot(),
    subscribe: (listener) => speechStore.subscribe(listener),
    /** 浏览器录音 → 官方语音服务转写。桥缺席时以结构化拒绝早退（调用方守卫兜底）。 */
    transcribe: (audioBase64) => (speechBridge === null
      ? Promise.reject(new Error("语音输入未启用"))
      : speechBridge.transcribe(audioBase64)),
    /** 打开语音 Bundle 详情页（安装/准备引导）；不可跳返回 false（调用方降级为纯 toast）。 */
    openBundle: () => {
      try {
        if (typeof pluginNavigationBridge?.openBundle !== "function") return false;
        pluginNavigationBridge.openBundle("@deepseek-ai/dsh-experimental-voice-input-bundle");
        return true;
      } catch {
        return false;
      }
    }
  };
  tryInject(["remote", "remote.speech"], (scope) => {
    const speech = scope?.remote?.speech;
    if (!speech || typeof speech.transcribe !== "function") return undefined;
    speechBridge = { transcribe: (audioBase64) => speech.transcribe({ audioBase64 }) };
    speechStore.set({ available: true });
    return () => {
      speechBridge = null;
      speechStore.set({ available: false });
    };
  }, "speech bridge");
  tryInject(["pluginNavigation"], (scope) => {
    pluginNavigationBridge = scope?.pluginNavigation ?? null;
    return undefined;
  }, "plugin navigation");

  /* 附件桥（p2-add-const-float-image-attach design D1）：浮窗图片附件 = `conversation` 服务的
     附件操作（`createDrafts` / `resolveDraftAttachments` / `releaseDraftAttachment` /
     `fileUploads`）——这些是服务的**包内附件操作**，`IConversation` 冻结契约只承诺
     input/blocks/send/updateQueue/cancel/loadOlder，故全部经 `attachFace` 薄包装读取：缺席
     或动词漂移 → `available === false` → 添加图片钮置灰可点引导、粘贴回落原生默认，零噪音。
     上传态经受控镜像 store 投影（`fileUploads` 快照 → `attachUploadsStore`），提供稳定
     订阅面给组件 `useSyncExternalStore`。 */
  let attachConversation = null;
  let offAttachUploads = null;
  const attachUploadsStore = createSnapshotStore({});
  const bindAttachConversation = (service) => {
    if (typeof offAttachUploads === "function") offAttachUploads();
    offAttachUploads = null;
    attachConversation = service ?? null;
    const uploads = attachConversation === null ? null : attachConversation.fileUploads;
    if (uploads !== null && uploads !== undefined
      && typeof uploads.getSnapshot === "function" && typeof uploads.subscribe === "function") {
      attachUploadsStore.set(uploads.getSnapshot());
      offAttachUploads = uploads.subscribe(() => attachUploadsStore.set(uploads.getSnapshot()));
      return;
    }
    attachUploadsStore.set({});
  };
  tryInject(["conversation"], (scope) => {
    bindAttachConversation(scope?.conversation ?? null);
    return () => bindAttachConversation(null);
  }, "conversation attachments");
  const attachFace = createAttachFace({
    service: () => attachConversation,
    uploads: {
      getSnapshot: () => attachUploadsStore.getSnapshot(),
      subscribe: (listener) => attachUploadsStore.subscribe(listener)
    }
  });

  /* ── 宿主右栏停靠席位（add-cosmos-rightbar-dock 3.1/3.4）──
     条件注入 `sidebarRight` + `sidebarRightTabs`：老宿主缺席 → 回调不执行 →
     `sidebarDockFace` 恒 null，入口能力探测回落内嵌整页（MUST NOT 报错）。
     注入成功 → tab 类型注册（含 guide entry：图标 + 标题，引导页/添加控件原生路径）
     + 呈现态订阅（mounted / openTabs → cosmosDockStore，两入口高亮/aria 同源）。 */
  tryInject(["sidebarRight", "sidebarRightTabs"], (scope) => {
    const right = scope?.sidebarRight;
    const tabs = scope?.sidebarRightTabs;
    if (!right || typeof right.openTab !== "function" || !tabs || typeof tabs.register !== "function") {
      return undefined;
    }
    sidebarDockFace = { right, tabs };
    const sync = () => syncDockStore();
    const offMounted = typeof right.mounted?.subscribe === "function" ? right.mounted.subscribe(sync) : null;
    const offTabs = typeof right.openTabs?.subscribe === "function" ? right.openTabs.subscribe(sync) : null;
    const disposeType = tabs.register({
      id: COSMOS_DOCK_TAB_ID,
      kind: COSMOS_DOCK_TAB_KIND,
      /* tab chip 文案：打开时捕获（语言切换后由标题槽/重开承接）。 */
      title: () => sectionT("cosmos.seat"),
      /* 引导页入口卡（MUST NOT 受 launchMode 门控；宿主原生路径）。 */
      guide: [{
        id: "cosmos",
        order: 40,
        title: () => sectionT("cosmos.seat"),
        description: () => sectionT("cosmos.guide.description"),
        icon: CosmosGuideIcon
      }]
    });
    /* 正文槽（与本类型 id 同键；不声明 keepMounted = 切 tab/收起即卸载重挂）。 */
    let disposeBody = null;
    try {
      disposeBody = ctx.slots.inject("sidebar.right.pane.tab", () =>
        ctx.slots.register(
          { name: "sidebar.right.pane.tab", key: COSMOS_DOCK_TAB_ID, locale: NS },
          CosmosDockBody
        )
      );
    } catch (error) {
      console.error("[dsh-v-cosmos] dock body slot unavailable:", error);
    }
    syncDockStore();
    return () => {
      if (typeof disposeBody === "function") disposeBody();
      if (typeof disposeType === "function") disposeType();
      if (typeof offMounted === "function") offMounted();
      if (typeof offTabs === "function") offTabs();
      sidebarDockFace = null;
      syncDockStore();
    };
  }, "dock tab type");

  /* 设置作用域生命周期（与插件 fiber 同寿命）。 */
  ctx.effect(() => () => {
    offButtons?.();
    offConstButtons?.();
    offDraftProposals?.();
    offDraftConstButtons?.();
    buttonSettings.dispose();
    constButtonSettings.dispose();
    buttonsStore.dispose();
    constButtonsStore.dispose();
    pathsSettings.dispose();
    activeScope.dispose();
    cosmosButtonsFace.set({ buttons: [] });
    cosmosConstButtonsFace.set({ constellationButtons: [] });
    cosmosButtonDraftsStore.set({ proposals: [], constellations: [] });
  }, "dsh-v-cosmos: settings scope");

  /* 控制器：providers + 引擎生命周期（与插件 fiber 同寿命）；**三套一次性标记**
     （hero / 星座浮窗 / 星胚）与**共享防重入门**同 fiber 作用域。 */
  const pendingActions = createPendingActionStore();
  const floatMarkers = createFloatMarkerStore();
  /* 星胚动作标记通道（add-cosmos-action-prestate-gate 3.2）：**独立 store 实例**——
     与 hero/浮窗互不读写（通道隔离由实例边界保证，非重复实现）。 */
  const embryoMarkers = createPendingActionStore();
  const actionGate = createActionGate();
  ctx.effect(() => {
    controllerRef.current = createCosmosController(
      ctx,
      (text) => controllerRef.current?.getEngine?.()?.toast?.(text),
      { pending: pendingActions, floatMarkers, embryoMarkers, gate: actionGate }
    );
    return () => {
      controllerRef.current?.dispose();
      controllerRef.current = null;
    };
  }, "dsh-v-cosmos: controller");

  /* 1. 侧栏底部座位「Cosmos」（order 15——Hive(10) 与 Token统计(20) 之间）。 */
  ctx.slots.inject("sidebar.footer.action", () =>
    ctx.slots.register(
      {
        name: "sidebar.footer.action",
        id: "v-cosmos-seat",
        order: 15,
        locale: NS
      },
      CosmosSeat
    )
  );

  /* 2. 标题栏菜单「星群」入口（move-cosmos-entry-to-dsh-menu；Windows 桌面端）：
     `shell.overlay` order 10 自绘 fixed 按钮——测量宿主 `[data-windows-menu]` open
     shadowRoot「编辑」按钮几何定位其右缘 + 2px（token-insight「用量」同款机制，其
     order 10 同级）；锚点 `dsh-v-cosmos:menu-seat` 供「用量」链式让位，共同顺序 =
     应用 → 编辑 → 星群 → 用量。非桌面端 / 测量失败 → 组件渲染 null（侧栏座位兜底）。 */
  ctx.slots.inject("shell.overlay", () =>
    ctx.slots.register(
      {
        name: "shell.overlay",
        id: "v-cosmos-menu-seat",
        order: 10,
        locale: NS
      },
      CosmosMenuSeat
    )
  );

  /* 3. Cosmos 整页（shell.overlay，order 45——Hive(40) 之后）。 */
  ctx.slots.inject("shell.overlay", () =>
    ctx.slots.register(
      {
        name: "shell.overlay",
        id: "v-cosmos-page",
        order: 45,
        store: cosmosStore,
        locale: NS
      },
      function CosmosPageEntry(props) {
        const { t: tProp, useStore, setFullscreen } = props;
        try {
          return <CosmosPageOverlay t={tProp} useStore={useStore} setFullscreen={setFullscreen} />;
        } catch (error) {
          console.error("[dsh-v-cosmos] page render failed:", error);
          throw error;
        }
      }
    )
  );

  /* 3b. 右栏停靠正文槽（add-cosmos-rightbar-dock 3.1/3.2）：类型注册在条件注入内
     （`sidebarRightTabs`），正文按同一 id 注册进宿主键控槽；不声明 keepMounted（默认
     false）——切 tab / 切会话 / 收起右栏即卸载，重进重挂载（场景单次重拉 + SSE 自愈）。
     槽由宿主右栏包声明；席位缺席时该 inject 不执行（老宿主零副作用）。 */
  /* 4. 设置页「Cosmos」节 + 「快捷动作」标签页（add-cosmos-proposal-actions 5.x；
     cosmos 首次拥有设置 UI）。标签目录照官方 settings-plugins 的 sectionInjected 口径：
     slots.entries + slots/locale 复合订阅。 */
  let tabsVersion = -1;
  let tabsRevision = -1;
  let tabsRows = [];
  const resolveTabLabel = (label) => {
    try {
      const value = typeof label === "function" ? label() : label;
      return typeof value === "string" ? value : "";
    } catch {
      return "";
    }
  };
  const tabsFace = {
    getSnapshot: () => {
      const version = ctx.slots.getVersion(SETTINGS_TAB_SLOT);
      const revision = ctx.locale.getSnapshot().revision;
      if (version !== tabsVersion || revision !== tabsRevision) {
        tabsVersion = version;
        tabsRevision = revision;
        tabsRows = ctx.slots.entries(SETTINGS_TAB_SLOT).map((entry) => ({
          id: entry.options.id ?? "",
          order: entry.options.order ?? 0,
          label: resolveTabLabel(entry.options.label)
        })).sort((a, b) => a.order - b.order);
      }
      return tabsRows;
    },
    subscribe: (listener) => {
      const offLedger = ctx.slots.subscribe(SETTINGS_TAB_SLOT, listener);
      const offLocale = ctx.locale.subscribe(listener);
      return () => {
        offLedger();
        offLocale();
      };
    }
  };
  ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      {
        name: "settings.section",
        id: "v-cosmos",
        order: 6, // 通用(0) / 技能管理(5) 之后、模型(10) 之前
        label: () => sectionT("cosmos.settings.nav"),
        locale: NS,
        inject: () => ({ hooks: { tabs: tabsFace } }),
        children: { [SETTINGS_TAB_SLOT]: { kind: "list", scope: "root" } }
      },
      CosmosSettingsSection
    )
  );
  /* 3a. 「通用」标签页（add-cosmos-rightbar-dock）：order -1（置于「快捷动作」(0) 之前）；
      注入 launch face——受控镜像 = 模块级 cosmosLaunchStore，写入 = `applyLaunchMode`
      （净房持久化 + 镜像；无引擎热更需求，故不经整页控制器）。两档在 web 与桌面形态
      同效，无形态判据。 */
  const launchFace = {
    getSnapshot: () => cosmosLaunchStore.getSnapshot(),
    subscribe: (listener) => cosmosLaunchStore.subscribe(listener),
    set: (mode) => applyLaunchMode(mode)
  };
  /* 「通用」页签·星座模板名开关 face（add-cosmos-template-name-toggle 1.2/D1）：受控镜像 =
     模块级 `cosmosTemplateNamesStore`；整页存活 → 控制器 `saveTemplateNames`（净房持久化 +
     引擎 `setTuning` 热更 + 镜像同步）；整页未打开 → 仍即时持久化并同步镜像（无引擎可热更，
     下次开页构造读持久值）。与 launchFace 同款「即时保存、无暂存钮」纪律——装饰偏好的
     配置即事实，MUST NOT 因整页缺席拒绝写入。 */
  const templateNamesFace = {
    getSnapshot: () => cosmosTemplateNamesStore.getSnapshot(),
    subscribe: (listener) => cosmosTemplateNamesStore.subscribe(listener),
    set: (enabled) => {
      const controller = controllerRef.current;
      if (controller != null && typeof controller.saveTemplateNames === "function") {
        const merged = controller.saveTemplateNames(enabled === true);
        return merged != null ? merged : cosmosTemplateNamesStore.getSnapshot();
      }
      const merged = saveCosmosSettings({ templateNames: enabled === true });
      cosmosTemplateNamesStore.set({ templateNames: merged.templateNames });
      return merged;
    }
  };
  ctx.slots.inject(SETTINGS_TAB_SLOT, () =>
    ctx.slots.register(
      {
        name: SETTINGS_TAB_SLOT,
        id: "general",
        order: -1,
        label: () => sectionT("cosmos.settings.tabGeneral"),
        locale: NS,
        inject: () => ({ launch: launchFace, paths: pathsSettings, templateNames: templateNamesFace })
      },
      CosmosGeneralPanel
    )
  );
  ctx.slots.inject(SETTINGS_TAB_SLOT, () =>
    ctx.slots.register(
      {
        name: SETTINGS_TAB_SLOT,
        id: "actions",
        order: 0,
        label: () => sectionT("cosmos.settings.tabActions"),
        locale: NS,
        inject: () => ({ face: buttonSettings, models: modelsFace, shortcuts: shortcutsFace, drafts: buttonDraftsFace })
      },
      CosmosActionsPanel
    )
  );
  /* 3b. 「星座动作」标签页（add-cosmos-constellation-actions 5.3）：同一标签目录、order 1；
     注入**第二控制器实例**（星座节）与同一模型目录面，variant 只换文案/字段呈现。
     add-cosmos-native-composer 4.1：额外注入 `preflight` 轻量 face（「发送前编辑」开关，见下）——
     与按钮 face 正交（即时保存，不进暂存-草稿流）。 */
  /* 「发送前编辑」face（add-cosmos-native-composer 4.1；navFace 同构）：受控镜像 =
     模块级 cosmosPreflightStore；写入唯一链路 = 控制器 `savePreflight`（saveCosmosSettings
     净房持久化 + store 同步）。整页控制器缺失时与皮肤/导航同款：落印 health 失败、
     返回当前快照（不造假持久化——执行器仍读旧值）。 */
  const preflightFace = {
    getSnapshot: () => cosmosPreflightStore.getSnapshot(),
    subscribe: (listener) => cosmosPreflightStore.subscribe(listener),
    set: (mode) => {
      if (controllerRef.current == null) {
        markSelectFailure("preflight");
        return cosmosPreflightStore.getSnapshot();
      }
      const merged = controllerRef.current.savePreflight?.(mode) ?? cosmosPreflightStore.getSnapshot();
      clearSelectFailure();
      return merged;
    }
  };
  ctx.slots.inject(SETTINGS_TAB_SLOT, () =>
    ctx.slots.register(
      {
        name: SETTINGS_TAB_SLOT,
        id: "constellation-actions",
        order: 1,
        label: () => sectionT("cosmos.settings.tabConstActions"),
        locale: NS,
        inject: () => ({ face: constButtonSettings, models: modelsFace, variant: "constellation", preflight: preflightFace, shortcuts: shortcutsFace, drafts: buttonDraftsFace })
      },
      CosmosActionsPanel
    )
  );

  /* 3c. 「皮肤」标签页（add-cosmos-skin-themes 3.4）：同一标签目录、order 2；注入皮肤
      face（选中态 = 模块 store；选择 → 控制器 selectSkin：持久化 + store + 引擎热切）。
      fix-cosmos-skin-select-feedback：face.select 前置控制器存活检查（D1/D3）——缺失时
      落印 `face: "skin"` 失败并返回默认 id（不造假持久化），面板据 health face 呈现
      「未生效」提示；成功链路清除历史失败（自愈）。 */
  const selectHealthFace = {
    getSnapshot: () => cosmosSelectHealthStore.getSnapshot(),
    subscribe: (listener) => cosmosSelectHealthStore.subscribe(listener)
  };
  const skinFace = {
    getSnapshot: () => cosmosSkinStore.getSnapshot(),
    subscribe: (listener) => cosmosSkinStore.subscribe(listener),
    select: (id) => {
      if (controllerRef.current == null) {
        markSelectFailure("skin");
        return COSMOS_DEFAULT_SKIN;
      }
      const applied = controllerRef.current.selectSkin?.(id) ?? COSMOS_DEFAULT_SKIN;
      clearSelectFailure();
      return applied;
    }
  };
  ctx.slots.inject(SETTINGS_TAB_SLOT, () =>
    ctx.slots.register(
      {
        name: SETTINGS_TAB_SLOT,
        id: "skins",
        order: 2,
        label: () => sectionT("cosmos.settings.tabSkins"),
        locale: NS,
        inject: () => ({ skins: skinFace, selectHealth: selectHealthFace })
      },
      CosmosSkinPanel
    )
  );

  /* 3d. 「导航」标签页（add-cosmos-zoom-focus-nav 3.1–3.3）：同一标签目录、order 3；
     注入 nav face（受控镜像 = 模块级 cosmosNavStore；写入 = 控制器 saveNav：净房持久化
     + 已打开整页 engine.setTuning 热更）。轻量偏好语义，无保存钮。
     fix-cosmos-skin-select-feedback：写入同款前置存活检查——控制器缺失时标记
     `face: "nav"` 失败、返回当前快照（受控镜像不流转），面板呈现「未生效」提示。 */
  const navFace = {
    getSnapshot: () => cosmosNavStore.getSnapshot(),
    subscribe: (listener) => cosmosNavStore.subscribe(listener),
    set: (patch) => {
      if (controllerRef.current == null) {
        markSelectFailure("nav");
        return cosmosNavStore.getSnapshot();
      }
      const merged = controllerRef.current.saveNav?.(patch) ?? cosmosNavStore.getSnapshot();
      clearSelectFailure();
      return merged;
    }
  };
  ctx.slots.inject(SETTINGS_TAB_SLOT, () =>
    ctx.slots.register(
      {
        name: SETTINGS_TAB_SLOT,
        id: "nav",
        order: 3,
        label: () => sectionT("cosmos.settings.tabInterface"),
        locale: NS,
        inject: () => ({ nav: navFace, selectHealth: selectHealthFace })
      },
      CosmosNavPanel
    )
  );

  /* 3e. 「快捷键」标签页（add-cosmos-shortcuts 7.1/5.3）：同一标签目录、order 4（「界面」之后）；
      注入 shortcuts face（受控镜像 = 模块级 cosmosShortcutsStore；写入 = 控制器
      saveShortcuts：净房持久化 + 已打开整页 engine.setShortcuts 热更）+ 两列表草稿数据面
      （跨域冲突定位）+ health face（控制器缺失时「未生效」）。冲突在 face.set 前置拒绝。 */
  const shortcutsFace = {
    getSnapshot: () => cosmosShortcutsStore.getSnapshot(),
    subscribe: (listener) => cosmosShortcutsStore.subscribe(listener),
    set: (patch) => {
      if (controllerRef.current == null) {
        markSelectFailure("shortcuts");
        return cosmosShortcutsStore.getSnapshot();
      }
      const current = cosmosShortcutsStore.getSnapshot();
      const candidate = shortcutsOf({ ...current, ...(patch && typeof patch === "object" ? patch : {}) });
      /* 跨域唯一性（D9 保存面）：冲突 → 拒绝写入（面板已做本地预判并回弹选择）。 */
      if (shortcutConflictOf(candidate, buttonDraftsOf()) !== null) return current;
      const merged = controllerRef.current.saveShortcuts?.(candidate) ?? null;
      clearSelectFailure();
      return merged !== null && merged !== undefined && merged.shortcuts ? { ...merged.shortcuts } : cosmosShortcutsStore.getSnapshot();
    }
  };
  const buttonDraftsFace = {
    getSnapshot: () => cosmosButtonDraftsStore.getSnapshot(),
    subscribe: (listener) => cosmosButtonDraftsStore.subscribe(listener)
  };
  ctx.slots.inject(SETTINGS_TAB_SLOT, () =>
    ctx.slots.register(
      {
        name: SETTINGS_TAB_SLOT,
        id: "shortcuts",
        order: 4,
        label: () => sectionT("cosmos.settings.tabShortcuts"),
        locale: NS,
        inject: () => ({ shortcuts: shortcutsFace, drafts: buttonDraftsFace, selectHealth: selectHealthFace })
      },
      CosmosShortcutsPanel
    )
  );

  /* 5. hero 接力消费条目（add-cosmos-proposal-actions 4.4/4.5）：`conversation.input.dock`
     的 session 作用域列表条目，渲染 null，仅作新 blank 会话首屏的相位钩子。 */
  ctx.slots.inject("conversation.input.dock", () =>
    ctx.slots.register(
      {
        name: "conversation.input.dock",
        id: "v-cosmos-action-hero",
        order: 0,
        locale: NS,
        inject: (sessionId) => ({
          pending: pendingActions,
          sessionId,
          switchModel: switchSessionModel,
          notify: (text, isError) => showCosmosToast(text, isError)
        })
      },
      ActionHeroDock
    )
  );

  /* 6. 星座浮窗输入器（add-cosmos-constellation-actions 4.1）：同一插槽的第二条目，
     与 hero 条目共用挂点但**消费各自的标记通道**（双 store 隔离，互不误食）。
     p2：增注入 `attachFace`（浮窗图片附件的附件服务薄包装 face）。 */
  ctx.slots.inject("conversation.input.dock", () =>
    ctx.slots.register(
      {
        name: "conversation.input.dock",
        id: "v-cosmos-constellation-float",
        order: 1,
        locale: NS,
        inject: (sessionId) => ({
          floats: floatMarkers,
          sessionId,
          switchModel: switchSessionModel,
          models: modelsFace,
          speech: speechFace,
          attachFace,
          notify: (text, isError) => showCosmosToast(text, isError)
        })
      },
      ConstellationFloatDock
    )
  );

  /* 7. 星胚动作消费条目（add-cosmos-action-prestate-gate 3.3）：同一插槽的第三条目，
     只消费**星胚通道**（独立 store）；目标会话非 blank，故门控不含 blank。 */
  ctx.slots.inject("conversation.input.dock", () =>
    ctx.slots.register(
      {
        name: "conversation.input.dock",
        id: "v-cosmos-embryo-action",
        order: 2,
        locale: NS,
        inject: (sessionId) => ({
          pending: embryoMarkers,
          sessionId,
          switchModel: switchSessionModel,
          notify: (text, isError) => showCosmosToast(text, isError)
        })
      },
      EmbryoActionDock
    )
  );
}

/* 冒烟测试观测面（hive exports 先例）：只读镜像 + 纯函数引用，供 bundle 级冒烟
   直测导出面与推导口径；运行时行为不受影响。 */
export { cosmosOpenStore, cosmosLaunchStore, cosmosDockStore, cosmosTemplateNamesStore, applyLaunchMode, currentLaunchMode, launchCosmosEntry, CosmosDockBody, dockEntryPlanOf, findDockTabOf, dockPresenceOf, pageCloseActionOf, dockFallbackNoticeKeyOf, COSMOS_DOCK_TAB_ID, COSMOS_DOCK_TAB_KIND, CosmosGeneralPanel, CosmosPathsSection, createPathsSettingsController, sceneVersionStore, filterStore, drillStore, engineSelectStore, engineHoverStore, cosmosButtonsFace, cosmosConstButtonsFace, cosmosSkinStore, cosmosNavStore, cosmosShortcutsStore, cosmosButtonDraftsStore, cosmosSessionPanelStore, cosmosQueueStore, refreshQueue, cosmosSelectHealthOf, currentShortcuts, buttonDraftsOf, floatOpenOf, COSMOS_SKINS, COSMOS_SKIN_IDS, COSMOS_DEFAULT_SKIN, createSkin, applySkinTokens, mergeScene, sceneDiffLevel, planetStateOf, relativeTime, matchWorkspaces, filteredPositions, findRegisteredWorkspace, normalizeWorkspacePath, isWindowsPlatform, isEmptyConstellation, projectPanel, projectQueuePanel, queueScopeOf, queuePendingKeysOf, queueEnqueuedKeyOf, projectSessionPanel, sessionKeyOf, findCard, proposalKeyOf, assembleMessage, assembleEmbryoMessage, actionButtonVisible, draftMatches, isBlankDraft, pendingReadinessOf, createActionGate, createPendingActionStore, createActionExecutor, createEmbryoActionExecutor, consumePendingAction, explorationTargetOf, createModelBridge, ProposalPanel, SessionPanel, QueuePanel, ActionBar, ConstActionBar, ActionHeroDock, ConstellationFloatDock, EmbryoActionDock, CosmosSettingsSection, CosmosActionsPanel, CosmosSkinPanel, CosmosNavPanel, CosmosShortcutsPanel, SKIN_D_PALETTE, createSkinD, createCosmosEngine, isUiChromeTarget, fetchScene, subscribeCosmosEvents, bindSession, fetchQueue, queueAction, loadCosmosSettings, saveCosmosSettings, COSMOS_SETTINGS_DEFAULTS, COSMOS_SETTINGS_BOUNDS, PENDING_DIVE_WAIT_MS, normalizeConstButtons, constButtonsSectionOf, constellationMessageOf, createFloatMarkerStore, createConstellationExecutor, floatPresentationOf, floatTextareaHeightOf, createButtonSettingsController, constButtonDraftOf, constButtonIssue, CONSTELLATION_PROFILE, isSessionArchiveOutcome, activitySummaryOf, archiveNoticeOf, archiveRequestFailureNotice, SHORTCUT_DEFAULTS, SHORTCUT_FIELDS, SHORTCUT_UI_ORDER, SHORTCUT_GLOBAL_KEYS, SHORTCUT_BUTTON_KEYS, shortcutLabelOf, shortcutMatches, shortcutsOf, shortcutConflictOf, shortcutsIssue, currentSessionIdOf, wsIdBySessionId, createHostSessionFollow, FLOAT_IMAGE_TYPES, FLOAT_IMAGE_ACCEPT, FLOAT_ATTACH_WATCH_MS, clipboardFilesOf, createAttachFace, floatSendPlanOf, floatWatchOutcomeOf, floatAttachmentsPendingOf, intakeFloatImages, removeFloatAttachment };

/* 文案（zh/en 成对；引擎内嵌中文提示为 demo 语言的既定呈现）。 */
const DICT = {
  zh: {
    "cosmos.seat": "Cosmos",
    "cosmos.seat.aria": "打开 Cosmos 星系视图",
    /* 右栏 dock 入口语义（add-cosmos-rightbar-dock）：分栏打开 / 已开揭示 / 回落说明 / 引导页。 */
    "cosmos.seat.dockAria": "在右栏分栏打开 Cosmos",
    "cosmos.seat.dockActiveAria": "揭示 Cosmos 分栏",
    "cosmos.dock.noSession": "当前无会话在屏，已以内嵌整页打开（分栏需要至少一个打开的会话）",
    "cosmos.dock.hostUnavailable": "当前宿主未提供右栏停靠席位，已以内嵌整页打开",
    "cosmos.dock.splitHint": "右栏宽度不足或已有两格，Cosmos 暂以标签页打开；拖宽右栏后点「分栏」即可并排",
    "cosmos.guide.description": "工作区星系：提案恒星 / 会话行星 / 星空钻取与动作",
    /* 标题栏菜单「星群」入口（move-cosmos-entry-to-dsh-menu）：菜单条文字与 aria；
       锁定 / 独立窗 / 弹窗拦截文案复用 cosmos.seat.* 同源键。 */
    "cosmos.menu.seat": "星群",
    "cosmos.menu.seat.aria": "打开 Cosmos 星群视图",
    "cosmos.add": "新增",
    "cosmos.add.aria": "新增工作区",
    "cosmos.search.placeholder": "搜索工作区…",
    "cosmos.search.aria": "搜索工作区",
    "cosmos.search.clear": "清除搜索",
    "cosmos.search.empty": "无匹配工作区",
    "cosmos.panel.aria": "提案列表",
    "cosmos.panel.title": "提案",
    "cosmos.panel.noMatch": "无匹配提案",
    "cosmos.panel.emptyConstellation": "该星座暂无提案",
    "cosmos.panel.setBy": "落章来源",
    "cosmos.panel.embryo": "星胚",
    "cosmos.panel.embryoCount": "＋{n} 星胚",
    "cosmos.sessions.title": "会话",
    "cosmos.sessions.aria": "会话列表",
    "cosmos.sessions.handleAria": "展开会话列表",
    "cosmos.sessions.collapse": "收起会话面板",
    "cosmos.sessions.emptyGalaxy": "暂无活跃会话",
    "cosmos.sessions.emptyConstellation": "该星座暂无会话",
    "cosmos.sessions.open": "打开",
    "cosmos.sessions.openAria": "打开会话",
    /* 行内归档图标钮（add-cosmos-session-row-archive 2.5）：`archive` = 短标签（与
       open/openAria 同款配对，图标钮的完整语义走 archiveAria 的 aria-label/title）。 */
    "cosmos.sessions.archive": "归档",
    "cosmos.sessions.archiveAria": "归档会话",
    /* 归档活跃门禁按态说明文案（add-cosmos-session-archive-busy-gate 2.2）。 */
    "cosmos.sessions.archiveBusy": "执行中，暂不可归档",
    "cosmos.sessions.archiveWaiting": "待决策中，暂不可归档",
    "cosmos.sessions.todos": "任务进度",
    "cosmos.sessions.satellites": "子代理会话",
    "cosmos.sessions.waitingBadge": "待处理会话",
    "cosmos.sessions.pending.approval": "待审批",
    "cosmos.sessions.pending.plan": "计划待审",
    "cosmos.sessions.pending.answer": "待回答",
    "cosmos.sessions.pending.other": "待处理",
    "cosmos.sessions.status.approval": "等待审批",
    "cosmos.sessions.status.plan": "计划待审",
    "cosmos.sessions.status.answer": "等待回答",
    "cosmos.sessions.status.other": "等待处理",
    "cosmos.sessions.status.busy": "执行中",
    "cosmos.sessions.status.delegated": "子代理执行中",
    "cosmos.sessions.status.done": "已完成（未读）",
    "cosmos.sessions.status.idle": "待机",
    "cosmos.card.vitality": "活力",
    "cosmos.card.vitality.active": "活跃",
    "cosmos.card.vitality.sleep": "沉睡",
    "cosmos.card.decide.approval": "待批准",
    "cosmos.card.decide.planReview": "计划待审",
    "cosmos.card.decide.question": "待回答",
    "cosmos.card.decide.other": "待决策",
    /* 信息卡「打开会话」导航（dock 态 tab 保持；embedded 关整页）——无禁用态文案。 */
    /* 星胚卡「移除星胚」按钮 / 内联确认态 / outcome toast（add-cosmos-embryo-dismiss D9）。 */
    "cosmos.card.dismiss.remove": "移除星胚",
    "cosmos.card.dismiss.confirm": "确认移除？",
    "cosmos.dismiss.deleted": "星胚已移除",
    "cosmos.dismiss.alreadyMissing": "该星胚已不存在",
    "cosmos.dismiss.guardDirExists": "同名提案已创建，未移除",
    "cosmos.dismiss.missingWorkspace": "工作区不在册，未移除",
    "cosmos.dismiss.failed": "移除失败：",
    "cosmos.dismiss.failedUnknown": "未知错误",
    "cosmos.dismiss.requestFailed": "移除请求失败：",
    "cosmos.dismiss.noTarget": "缺少星胚定位信息，未移除",
    "cosmos.actions.aria": "提案动作",
    "cosmos.actions.switchFailed": "模型切换失败：",
    "cosmos.actions.switchUnavailable": "模型切换不可用：当前连接不支持",
    "cosmos.actions.keepOpenNotice": "已在新会话填入消息，Cosmos 保持打开",
    "cosmos.actions.degraded": "新建会话通道不可用，已降级为复用空白会话",
    "cosmos.actions.embryoNoSession": "缺少探索会话关联",
    "cosmos.actions.embryoUnavailable": "探索会话不可用",
    "cosmos.actions.embryoRunning": "探索会话正在执行，未打断",
    "cosmos.actions.embryoDraftNotEmpty": "探索会话已有未发送输入，未改写",
    "cosmos.actions.embryoKeepOpen": "已在探索会话填入消息，Cosmos 保持打开",
    "cosmos.actions.embryoSendFailed": "发送到探索会话失败：",
    /* 自动执行队列（add-cosmos-action-queue 5.2–5.4）：面板 / 配套入队钮 / 操作与错误码文案。 */
    "cosmos.queue.title": "自动队列",
    "cosmos.queue.aria": "自动队列",
    "cosmos.queue.countTitle": "在途条目数（等待 + 执行中）",
    "cosmos.queue.auto": "自动发送",
    "cosmos.queue.autoTitle": "队列执行恒为自动发送：不打开会话、不写草稿",
    "cosmos.queue.pause": "暂停队列",
    "cosmos.queue.resume": "继续队列",
    "cosmos.queue.paused": "已暂停",
    "cosmos.queue.clear": "清空队列（执行中条目保留）",
    "cosmos.queue.clearConfirm": "再次点击确认清空",
    "cosmos.queue.confirm": "确认",
    "cosmos.queue.indicatorRunning": "队列执行中",
    "cosmos.queue.indicatorWaiting": "有会话等待决策",
    "cosmos.queue.moveUp": "前移",
    "cosmos.queue.moveDown": "后移",
    "cosmos.queue.remove": "移出队列",
    "cosmos.queue.enqueued": "已加入自动队列",
    "cosmos.queue.enqueueFailed": "加入队列失败",
    "cosmos.queue.enqueuing": "正在加入…",
    "cosmos.queue.pending": "已在队列中",
    "cosmos.queue.duplicate": "已在队列中",
    "cosmos.queue.limit": "队列已满（32）",
    "cosmos.queue.gate": "前置状态不匹配",
    "cosmos.queue.hostStale": "宿主半区未加载队列接口：请重启 DSH 后重试",
    "cosmos.queue.locked": "执行中条目不可操作",
    "cosmos.queue.neighborLocked": "相邻条目不可调整（仅等待中的条目可排序）",
    "cosmos.queue.boundary": "已到队列边界",
    "cosmos.queue.missing": "目标已不在队列中（可能已被其他窗口移除）",
    "cosmos.queue.pausedNotice": "队列已暂停（当前条目照常执行）",
    "cosmos.queue.resumed": "队列已继续",
    "cosmos.queue.opFailed": "队列操作失败",
    "cosmos.queue.cleared": "队列已清空",
    "cosmos.queue.clearFailed": "清空队列失败",
    "cosmos.queue.reorderFailed": "调整顺序失败",
    "cosmos.queue.removeFailed": "移出队列失败",
    "cosmos.actions.enqueue": "加入自动队列",
    "cosmos.actions.enqueueLabel": "＋ 入队",
    "cosmos.constActions.aria": "星座动作",
    "cosmos.constFloat.title": "星座动作",
    "cosmos.constFloat.inputAria": "消息内容",
    "cosmos.constFloat.placeholder": "补写或修改消息，发送后进入当前星座工作区的会话…",
    "cosmos.constFloat.send": "发送",
    "cosmos.constFloat.close": "关闭",
    "cosmos.constFloat.hint": "Enter 发送 · Shift+Enter 换行 · 点击 ＋ 或粘贴添加图片 · {voice} 语音 · {close} 关闭浮窗（保留草稿不发送）",
    /* 图片附件（p2-add-const-float-image-attach 5.1）：入口 / 降级引导 / 批次校验 / busy 拒绝
       + 移除钮可访问名。 */
    "cosmos.constFloat.attach": "添加图片",
    "cosmos.constFloat.attachUnavailable": "跳转会话页可用原生添加图片",
    "cosmos.constFloat.attachImageOnly": "仅支持添加图片",
    "cosmos.constFloat.attachBusy": "当前不可添加附件",
    "cosmos.constFloat.attachRemove": "移除图片",
    "cosmos.constFloat.modelLabel": "模型",
    "cosmos.constFloat.switching": "切换中…",
    "cosmos.constFloat.modelFallback": "已按会话当前模型",
    "cosmos.constFloat.modelDefault": "会话当前模型",
    "cosmos.constFloat.modelDrift": "不可用",
    "cosmos.constFloat.modelDegraded": "模型目录不可用",
    "cosmos.constFloat.effortLabel": "级别",
    "cosmos.constFloat.voiceStart": "语音",
    "cosmos.constFloat.voiceStop": "停止",
    "cosmos.constFloat.voiceBusy": "转写中…",
    "cosmos.constFloat.voiceAria": "语音输入",
    "cosmos.constFloat.voiceDenied": "无法访问麦克风：请检查浏览器权限与环境",
    "cosmos.constFloat.voiceFailed": "语音转写失败：",
    "cosmos.constFloat.voiceEmpty": "未识别到语音",
    /* 不可用引导（fix-cosmos-const-float-voice 2.3）：置灰钮 toast + title 同文案。 */
    "cosmos.constFloat.voiceUnavailable": "需要在配置中开启语音功能：设置 → 插件 → 语音输入",
    "cosmos.settings.nav": "Cosmos",
    /* 「通用」页签（add-cosmos-rightbar-dock）：打开方式两档（内嵌整页 / 分栏）+ 即时保存。 */
    "cosmos.settings.tabGeneral": "通用",
    "cosmos.settings.generalUnavailable": "通用设置暂不可用：插件整页未就绪（刷新页面后重试）。",
    "cosmos.settings.launchModeLabel": "打开方式",
    "cosmos.settings.launchModeHint": "内嵌整页 = 在当前 DSH 窗口内以整页覆盖层打开（现状）；分栏 = 在 DSH 右栏打开 Cosmos 停靠页，与左侧会话并排，两边可同时操作且天然联动（存量「独立窗口」配置自动迁移为分栏）。",
    "cosmos.settings.launchModeEmbedded": "内嵌整页（默认）",
    "cosmos.settings.launchModeEmbeddedHint": "在 DSH 主窗口内以整页覆盖层打开（与变更前一致）。",
    "cosmos.settings.launchModeDock": "分栏（右栏停靠）",
    "cosmos.settings.launchModeDockHint": "在 DSH 右栏打开 Cosmos 停靠页，与左侧会话并排；动作与跳转在同一窗口内完成，web 与桌面形态一致。",
    "cosmos.settings.launchModeInstant": "改动立即生效并保存",
    /* 星座模板名显示（add-cosmos-template-name-toggle 1.2）：开关行 label / 装饰用途 hint /
       aria 开关名 + 分组图例（对齐 launch 组）。 */
    "cosmos.settings.templateNamesLegend": "星座装饰",
    "cosmos.settings.templateNamesLabel": "星座模板名显示",
    "cosmos.settings.templateNamesHint": "在银河星座标签与钻取标牌上追加该星座命中模板的中文名（如「猎户座」）；纯装饰文本，不影响布局与交互。",
    "cosmos.settings.templateNamesAria": "星座模板名显示开关",
    "cosmos.settings.pathsLabel": "路径",
    "cosmos.settings.pathsHint": "openspec 路径令牌 OPENSPEC_PATH 的解析值与 cosmos-spec 技能目录：保存后写入本机共享配置并即时生效（无需重启插件或会话）。未配置留空。",
    "cosmos.settings.pathsLoading": "正在加载路径设置…",
    "cosmos.settings.pathsOpenspecLabel": "openspecPath（openspec 技能仓库根）",
    "cosmos.settings.pathsOpenspecHint": "路径令牌 OPENSPEC_PATH 的解析值：渲染技能引用时以该目录为 openspec 根。",
    "cosmos.settings.pathsOpenspecPh": "如 C:\\openspec 或 ~/openspec（留空 = 未配置）",
    "cosmos.settings.pathsCosmosSpecLabel": "cosmosSpecDir（cosmos-spec 目录）",
    "cosmos.settings.pathsCosmosSpecHint": "cosmos-spec canonical 目录：技能渲染的扫描根（技能提供方消费）。",
    "cosmos.settings.pathsCosmosSpecPh": "如 C:\\cosmos-spec（留空 = 未配置）",
    "cosmos.settings.pathsUnavailable": "路径设置暂不可用：插件页面未就绪（刷新页面后重试）。",
    "cosmos.settings.pathsNotWritable": "路径设置在此连接不可用（插件宿主半区未就绪或未升级）：页面其余设置不受影响。",
    "cosmos.settings.pathsSave": "保存",
    "cosmos.settings.pathsSaving": "保存中…",
    "cosmos.settings.pathsSaveFailed": "保存未生效（可能已被他端修改），请重试",
    "cosmos.settings.pathsDiscard": "放弃修改",
    "cosmos.settings.pathsDirMissing": "目录不存在（仍已保存，可先配后建）：",
    "cosmos.settings.tabActions": "快捷动作",
    "cosmos.settings.tabConstActions": "星座动作",
    "cosmos.settings.tabSkins": "皮肤",
    "cosmos.settings.tabInterface": "界面",
    "cosmos.settings.title": "Cosmos",
    "cosmos.settings.intro": "两套动作按钮：提案动作在 Cosmos 整页选中提案后，一键把「提示词 + @提案目录」发进该提案所属工作区的新会话；星座动作在钻取某星座时，把纯提示词（不含 @引用）发进当前星座对应工作区的新会话——勾选自动发送则点击即发；未勾选时按「发送前编辑」设置分流：浮窗补写（缺省，星空保持），或跳转会话页由原生输入区承载。",
    "cosmos.settings.tabsAria": "Cosmos 设置分区",
    "cosmos.settings.buttonsLabel": "动作按钮（作用于选中提案）",
    "cosmos.settings.buttonsHint": "点击按钮在选中提案所属工作区创建新会话：消息 = 提示词与 @提案目录（按「提示词在前」决定先后）；勾选自动发送则经 hero 相位自动提交首回合。保存后立即生效，无需重启。",
    "cosmos.settings.prependDiffHint": "「提示词在前」= 消息里提示词位于 @提案引用之前（与 dsh-v-skill-links 的同名字段语义不同：那里指把提示词前插进既有草稿）。",
    "cosmos.settings.addButton": "新增",
    "cosmos.settings.removeButton": "删除",
    "cosmos.settings.resetButtons": "重置为组合层",
    "cosmos.settings.buttonNamePh": "名称（按钮上显示，可中文）",
    "cosmos.settings.buttonPromptPh": "提示词：随消息进入新会话草稿…",
    "cosmos.settings.autoSendLabel": "自动发送",
    "cosmos.settings.prependLabel": "提示词在前",
    "cosmos.settings.prependTitle": "勾选：消息里提示词位于 @提案引用之前；未勾选：@提案引用在前",
    "cosmos.settings.newSessionLabel": "新增会话",
    "cosmos.settings.newSessionTitle": "固定为「新增会话」：在提案所属工作区创建新会话（不可修改）",
    "cosmos.settings.newSessionTitleProto": "星胚动作固定发往探索会话、不开新会话（不可修改）",
    "cosmos.settings.preStateLabel": "前置状态",
    "cosmos.settings.preStateUnlimited": "不限",
    "cosmos.settings.preStateProto": "待创建（星胚）",
    "cosmos.settings.preStateCreated": "已创建",
    "cosmos.settings.preStateReviewed": "已审核",
    "cosmos.settings.preStateExecuted": "已执行",
    "cosmos.settings.preStateUnavailable": "不可用",
    "cosmos.settings.prependTitleProto": "星胚消息不含 @ 提案引用、先后无语义（不可勾选）",
    "cosmos.settings.buttonPreStateInvalid": "前置状态非法（可选 不限 / 待创建（星胚）/ 已创建 / 已审核 / 已执行）",
    "cosmos.settings.buttonModelLabel": "模型",
    "cosmos.settings.buttonEffortLabel": "级别",
    "cosmos.settings.buttonModelFollow": "跟随会话（默认）",
    "cosmos.settings.modelCatalogFallback": "模型目录不可用：仅可选择「跟随会话（默认）」；绑定模型的按钮执行时跳过切换。",
    "cosmos.settings.modelUnavailable": "不可用",
    "cosmos.settings.gripLabel": "拖动调整顺序",
    "cosmos.settings.moveUp": "上移",
    "cosmos.settings.moveDown": "下移",
    "cosmos.settings.save": "保存",
    "cosmos.settings.saving": "保存中…",
    "cosmos.settings.discard": "放弃修改",
    "cosmos.settings.saveFailed": "保存未生效，请重试",
    "cosmos.settings.notWritable": "当前连接不支持持久设置修改",
    "cosmos.settings.loading": "正在加载设置…",
    "cosmos.settings.buttonsCountPrefix": "动作按钮：",
    "cosmos.settings.jumpLabel": "执行后跳转",
    "cosmos.settings.jumpTitle": "每个按钮独立设置：勾选 = 执行成功后关闭 Cosmos 整页、右侧呈现该会话；取消 = 保持 Cosmos 画面（新会话照常创建，勾选自动发送则照常提交首回合）。",
    "cosmos.settings.buttonNameRequired": "按钮名称不能为空",
    "cosmos.settings.buttonDup": "按钮名称重复",
    "cosmos.settings.buttonPromptRequired": "提示词不能为空",
    "cosmos.settings.buttonNewSessionFixed": "「新增会话」固定为必选项（不接受非 true 值）",
    "cosmos.settings.tooManyButtons": "按钮数量超过上限（32）",
    "cosmos.settings.constButtonsLabel": "星座动作按钮（作用于当前星座）",
    "cosmos.settings.constButtonsHint": "点击按钮在当前星座对应的工作区创建新会话：消息 = 纯提示词（不含 @提案引用）；勾选自动发送则点击即发；未勾选时按下方「发送前编辑」分流——浮窗补写（缺省：星空保持，模型选择/语音转写在浮窗内可用），或跳转会话页由原生输入区承载。保存后立即生效，无需重启。",
    "cosmos.settings.constPreflightLabel": "发送前编辑",
    "cosmos.settings.constPreflightAria": "未勾选自动发送时的发送前编辑方式",
    "cosmos.settings.constPreflightFloat": "浮窗补写（星空保持，缺省）",
    "cosmos.settings.constPreflightNative": "跳转会话页（原生输入区）",
    "cosmos.settings.constPreflightHint": "未勾选自动发送的星座按钮：浮窗补写 = 不关 Cosmos 整页，浮窗卡片补写后手动发送（模型选择与语音转写在浮窗内直接可用；@引用/附件等编辑器能力需选「跳转会话页」在原生输入区完成）；跳转会话页 = 关闭整页，落到新会话的原生输入区（预填提示词，原生能力全量可用）。关闭浮窗或按 Esc 只收卡片，草稿保留。",
    "cosmos.settings.constPreflightInstant": "改动立即生效并保存（不随按钮草稿暂存/放弃）",
    "cosmos.settings.constNewSessionTitle": "固定为「新增会话」：在当前星座对应工作区创建新会话（不可修改）",
    "cosmos.settings.constButtonsCountPrefix": "星座动作按钮：",
    "cosmos.settings.constButtonNameRequired": "按钮名称不能为空",
    "cosmos.settings.constButtonDup": "按钮名称重复",
    "cosmos.settings.constButtonPromptRequired": "提示词不能为空",
    "cosmos.settings.constButtonNewSessionFixed": "「新增会话」固定为必选项（不接受非 true 值）",
    "cosmos.settings.constButtonPrependRejected": "星座动作按钮不支持「提示词在前」（无 @提案引用，没有先后语义）",
    "cosmos.settings.tooManyConstButtons": "按钮数量超过上限（32）",
    "cosmos.settings.skinsHint": "点选即生效：已打开的 Cosmos 整页立即换装（canvas 天体与 HUD 镀铬同气），偏好随即持久化，下次打开仍是它。",
    "cosmos.settings.skinsAria": "皮肤",
    "cosmos.settings.skinsDefault": "默认",
    "cosmos.settings.skinsDark": "暗色",
    "cosmos.settings.skinsLight": "亮色",
    "cosmos.settings.skinsCountPrefix": "内置皮肤：",
    "cosmos.settings.skinsInstant": "选中即预览即保存",
    "cosmos.settings.navHint": "缩放即导航：顶部只读标尺显示当前缩放尺度，刻度 = 钻取参考视距。银河态放大到刻度且最近星座在屏幕中心 25% 范围内即自动进入；钻取态缩小越过刻度下方的滞回下限即自动飞回。两项阈值由引擎常量固定，不设配置项。",
    "cosmos.settings.navFocusLabel": "指针聚焦缩放",
    "cosmos.settings.navFocusAria": "指针聚焦缩放开关",
    "cosmos.settings.navFocusHint": "缩放以指针位置为焦点逐步聚焦（关闭后回落屏幕中心缩放）。",
    "cosmos.settings.navInstant": "改动立即生效并保存",
    "cosmos.settings.sizeGroup": "界面尺寸",
    "cosmos.settings.sizeGroupHint": "像素值，改动立即生效并保存；面板与搜索框的高度 0 = 自适应。",
    "cosmos.settings.sizeSessionW": "会话列表宽",
    "cosmos.settings.sizeSessionH": "会话列表高",
    "cosmos.settings.sizeConstW": "星座列表宽",
    "cosmos.settings.sizeConstH": "星座列表高",
    "cosmos.settings.sizeAddBtn": "新增按钮边长",
    "cosmos.settings.sizeHudBtn": "右下按钮边长",
    "cosmos.settings.sizeActionW": "动作条按钮宽",
    "cosmos.settings.sizeActionH": "动作条按钮高",
    "cosmos.settings.sizeConstActionH": "星座动作按钮高",
    "cosmos.settings.sizeSearchW": "搜索框宽",
    "cosmos.settings.sizeSearchH": "搜索框高",
    "cosmos.settings.sizeWsTitle": "星座标题字号",
    "cosmos.settings.sizeAuto": "0 = 自适应",
    "cosmos.settings.skinUnavailable": "皮肤选择暂不可用：插件整页未就绪（刷新页面后重试）。",
    "cosmos.settings.navUnavailable": "界面设置暂不可用：插件整页未就绪（刷新页面后重试）。",
    "cosmos.settings.skinNotApplied": "皮肤选择未生效：插件整页控制器缺失，请重试或刷新页面后重新选择。",
    "cosmos.settings.navNotApplied": "界面设置未生效：插件整页控制器缺失，请重试或刷新页面后重新调整。",
    /* ── 快捷键（add-cosmos-shortcuts 7.3）：页签 / 四行 / 说明列 / 错误键 / 风险注记 ── */
    "cosmos.settings.tabShortcuts": "快捷键",
    "cosmos.settings.shortcutsHint": "四个全局键 + 两条动作条按钮的自定义快捷键：改动立即生效并保存（无需重启或重开整页）。快捷键只在 Cosmos 整页打开时生效——输入框聚焦、输入法组字、浮窗打开时按纪律让位。键位按物理键位（ev.code）匹配，非 QWERTY 布局下印刷字母可能不同。",
    "cosmos.settings.shortcutsDefault": "默认",
    "cosmos.settings.shortcutGoHome": "回到银河",
    "cosmos.settings.shortcutTogglePan": "移动开关",
    "cosmos.settings.shortcutVoiceToggle": "语音开关（浮窗）",
    "cosmos.settings.shortcutClosePage": "关闭页面",
    "cosmos.settings.shortcutGoHomeHint": "钻取态生效：飞回银河视图（与右下「回到银河」按钮等效）；银河态无动作。",
    "cosmos.settings.shortcutTogglePanHint": "整页打开时生效：翻转右下「拖拽平移」开关（与点击按钮同一状态链，含持久化）。",
    "cosmos.settings.shortcutVoiceToggleHint": "仅浮窗打开时生效：开始/停止语音录入（idle → 录音，录音中 → 停止并转写）；浮窗文本域聚焦时可用。",
    "cosmos.settings.shortcutClosePageHint": "整页打开时生效：关闭/收起链——钻取返回 > 清空搜索 > 收起会话面板 > 退全屏 > 关闭整页（整页关闭时零键盘监听）。",
    "cosmos.settings.shortcutRisky": "浏览器保留组合，可能无法拦截（部分浏览器可能直接退出）",
    "cosmos.settings.shortcutRiskTag": "浏览器保留",
    "cosmos.settings.shortcutRiskyHint": "Ctrl+Q 在部分浏览器是「退出浏览器」的保留组合、网页无法拦截：可改用 Alt+Q 等替代键。",
    "cosmos.settings.shortcutDup": "快捷键冲突：与其它按键（全局键或其它按钮）重复，请改选其它键位",
    "cosmos.settings.shortcutConflictRow": "冲突：该键与「{other}」重复",
    "cosmos.settings.buttonShortcutLabel": "快捷键",
    "cosmos.settings.buttonShortcutSaveHint": "选择后需点击下方「保存」才生效",
    "cosmos.settings.buttonShortcutPreStateHint": "仅当选中提案的前置状态为「{state}」且空闲（该按钮渲染出来）时按键才生效",
    "cosmos.settings.buttonShortcutPreStateShort": "仅「{state}」时生效",
    "cosmos.settings.buttonShortcutNone": "无",
    "cosmos.settings.buttonShortcutUnavailable": "不可用",
    "cosmos.settings.buttonShortcutInvalid": "快捷键非法（可选 无 / 0–9 / F2 / F4 / F8 / F9）",
    "cosmos.settings.constButtonShortcutInvalid": "快捷键非法（可选 无 / 0–9 / F2 / F4 / F8 / F9）",
    "cosmos.settings.shortcutInstant": "改动立即生效并保存",
    "cosmos.settings.shortcutPanelHint": "按钮快捷键与全局键共享同一唯一性域：同一键只属于一个动作（保存时跨列表查重，重复会被拒绝）。选好键位后需点击下方「保存」才生效（与其它按钮字段同一草稿流）。",
    "cosmos.settings.shortcutsUnavailable": "快捷键设置暂不可用：插件整页未就绪（刷新页面后重试）。",
    "cosmos.settings.shortcutsNotApplied": "快捷键未生效：插件整页控制器缺失，请重试或刷新页面后重新设置。",
    "cosmos.settings.shortcutsCount": "全局快捷键：",
    "cosmos.skin.deepspace.name": "深空银河",
    "cosmos.skin.deepspace.ref": "现风格 D（视觉回归基线）",
    "cosmos.skin.rosepine.name": "星图玫瑰松",
    "cosmos.skin.rosepine.ref": "Rosé Pine 官方色板（与现基线血缘最近）",
    "cosmos.skin.fidenza.name": "费登莎暖矿",
    "cosmos.skin.fidenza.ref": "Tyler Hobbs 方法论（纸面透明星空）",
    "cosmos.skin.linear.name": "Linear 靛紫",
    "cosmos.skin.linear.ref": "Linear.app 设计语言",
    "cosmos.skin.obsidian.name": "知识星图",
    "cosmos.skin.obsidian.ref": "Obsidian Graph View",
    "cosmos.skin.reagent.name": "化学反应",
    "cosmos.skin.reagent.ref": "化学实验（培养皿/荧光试剂）",
    "cosmos.skin.chamber.name": "云室",
    "cosmos.skin.chamber.ref": "粒子物理（衰变径迹）",
    "cosmos.skin.fluoro.name": "荧光显微",
    "cosmos.skin.fluoro.ref": "荧光显微摄影（细胞/细胞器）",
    "cosmos.skin.lotus.name": "荷塘月色",
    "cosmos.skin.lotus.ref": "水墨池塘（花期/锦鲤）",
    "cosmos.skin.migration.name": "雁阵暮色",
    "cosmos.skin.migration.ref": "候鸟迁徙（雁群/鸟浪）",
    "cosmos.skin.circuit.name": "覆铜星板",
    "cosmos.skin.circuit.ref": "PCB（芯片/信号脉冲）",
    "cosmos.skin.fermata.name": "总谱延音",
    "cosmos.skin.fermata.ref": "音乐总谱（音符/fermata）"
  },
  en: {
    "cosmos.seat": "Cosmos",
    "cosmos.seat.aria": "Open Cosmos galaxy view",
    "cosmos.seat.dockAria": "Open Cosmos in the right sidebar",
    "cosmos.seat.dockActiveAria": "Reveal the Cosmos split pane",
    "cosmos.dock.noSession": "No session is on screen; opened as the inline page instead (the split pane needs an open session)",
    "cosmos.dock.hostUnavailable": "This host provides no right-sidebar seat; opened as the inline page instead",
    "cosmos.dock.splitHint": "The right sidebar is too narrow or already has two panes; Cosmos opened as a tab. Widen the sidebar, then close and reopen Cosmos to split.",
    "cosmos.guide.description": "Workspace galaxy: proposal stars, session planets, diving and actions",
    /* Menu entry (move-cosmos-entry-to-dsh-menu): titlebar text + aria. */
    "cosmos.menu.seat": "Cosmos",
    "cosmos.menu.seat.aria": "Open the Cosmos galaxy view",
    "cosmos.add": "Add",
    "cosmos.add.aria": "Add workspace",
    "cosmos.search.placeholder": "Search workspaces…",
    "cosmos.search.aria": "Search workspaces",
    "cosmos.search.clear": "Clear search",
    "cosmos.search.empty": "No matching workspaces",
    "cosmos.panel.aria": "Proposal list",
    "cosmos.panel.title": "Proposals",
    "cosmos.panel.noMatch": "No matching proposals",
    "cosmos.panel.emptyConstellation": "No proposals in this constellation",
    "cosmos.panel.setBy": "Stamped by",
    "cosmos.panel.embryo": "Embryo",
    "cosmos.panel.embryoCount": "+{n} embryos",
    "cosmos.sessions.title": "Sessions",
    "cosmos.sessions.aria": "Session list",
    "cosmos.sessions.handleAria": "Open session list",
    "cosmos.sessions.collapse": "Collapse session list",
    "cosmos.sessions.emptyGalaxy": "No active sessions",
    "cosmos.sessions.emptyConstellation": "No sessions in this constellation",
    "cosmos.sessions.open": "Open",
    "cosmos.sessions.openAria": "Open session",
    "cosmos.sessions.archive": "Archive",
    "cosmos.sessions.archiveAria": "Archive session",
    "cosmos.sessions.archiveBusy": "Running — archiving unavailable",
    "cosmos.sessions.archiveWaiting": "Awaiting decision — archiving unavailable",
    "cosmos.sessions.todos": "Task progress",
    "cosmos.sessions.satellites": "Subagent sessions",
    "cosmos.sessions.waitingBadge": "Sessions waiting",
    "cosmos.sessions.pending.approval": "Approval",
    "cosmos.sessions.pending.plan": "Plan review",
    "cosmos.sessions.pending.answer": "Answer",
    "cosmos.sessions.pending.other": "Pending",
    "cosmos.sessions.status.approval": "Waiting for approval",
    "cosmos.sessions.status.plan": "Plan awaiting review",
    "cosmos.sessions.status.answer": "Waiting for answer",
    "cosmos.sessions.status.other": "Waiting for action",
    "cosmos.sessions.status.busy": "Running",
    "cosmos.sessions.status.delegated": "Subagent running",
    "cosmos.sessions.status.done": "Completed (unread)",
    "cosmos.sessions.status.idle": "Idle",
    "cosmos.card.vitality": "Vitality",
    "cosmos.card.vitality.active": "Active",
    "cosmos.card.vitality.sleep": "Dormant",
    "cosmos.card.decide.approval": "Approve",
    "cosmos.card.decide.planReview": "Review plan",
    "cosmos.card.decide.question": "Answer",
    "cosmos.card.decide.other": "Decide",
    "cosmos.card.dismiss.remove": "Remove embryo",
    "cosmos.card.dismiss.confirm": "Confirm removal?",
    "cosmos.dismiss.deleted": "Embryo removed",
    "cosmos.dismiss.alreadyMissing": "That embryo is already gone",
    "cosmos.dismiss.guardDirExists": "A proposal with this name exists; not removed",
    "cosmos.dismiss.missingWorkspace": "Workspace is not registered; not removed",
    "cosmos.dismiss.failed": "Removal failed: ",
    "cosmos.dismiss.failedUnknown": "unknown error",
    "cosmos.dismiss.requestFailed": "Removal request failed: ",
    "cosmos.dismiss.noTarget": "Missing embryo target; not removed",
    "cosmos.actions.aria": "Proposal actions",
    "cosmos.actions.switchFailed": "Model switch failed: ",
    "cosmos.actions.switchUnavailable": "Model switching unavailable on this connection",
    "cosmos.actions.keepOpenNotice": "Message pre-filled in the new session; Cosmos stays open",
    "cosmos.actions.degraded": "New-session channel unavailable; fell back to reusing the workspace blank",
    "cosmos.actions.embryoNoSession": "Missing exploration-session link",
    "cosmos.actions.embryoUnavailable": "Exploration session unavailable",
    "cosmos.actions.embryoRunning": "Exploration session is running; left uninterrupted",
    "cosmos.actions.embryoDraftNotEmpty": "Exploration session already has unsent input; left untouched",
    "cosmos.actions.embryoKeepOpen": "Message pre-filled in the exploration session; Cosmos stays open",
    "cosmos.actions.embryoSendFailed": "Failed to send to the exploration session: ",
    /* Automated action queue (add-cosmos-action-queue 5.2–5.4): panel / enqueue button / operation and error-code copy. */
    "cosmos.queue.title": "Auto queue",
    "cosmos.queue.aria": "Automated action queue",
    "cosmos.queue.countTitle": "In-flight entries (queued + running)",
    "cosmos.queue.auto": "Auto-send",
    "cosmos.queue.autoTitle": "Queued runs are always auto-sent: no session navigation, no draft writes",
    "cosmos.queue.pause": "Pause queue",
    "cosmos.queue.resume": "Resume queue",
    "cosmos.queue.paused": "Paused",
    "cosmos.queue.clear": "Clear queue (running entries are kept)",
    "cosmos.queue.clearConfirm": "Click again to confirm clearing",
    "cosmos.queue.confirm": "Confirm",
    "cosmos.queue.indicatorRunning": "Queue is running",
    "cosmos.queue.indicatorWaiting": "A session is waiting for a decision",
    "cosmos.queue.moveUp": "Move up",
    "cosmos.queue.moveDown": "Move down",
    "cosmos.queue.remove": "Remove from queue",
    "cosmos.queue.enqueued": "Added to the auto queue",
    "cosmos.queue.enqueueFailed": "Could not enqueue",
    "cosmos.queue.enqueuing": "Adding…",
    "cosmos.queue.pending": "Already queued",
    "cosmos.queue.duplicate": "Already queued",
    "cosmos.queue.limit": "Queue is full (32)",
    "cosmos.queue.gate": "Precondition mismatch",
    "cosmos.queue.hostStale": "Host half has not loaded the queue API: restart DSH and retry",
    "cosmos.queue.locked": "Running entries cannot be changed",
    "cosmos.queue.neighborLocked": "Adjacent entry cannot be reordered (only queued entries sort)",
    "cosmos.queue.boundary": "Already at the queue boundary",
    "cosmos.queue.missing": "Target is no longer queued (removed in another window?)",
    "cosmos.queue.pausedNotice": "Queue paused (the current entry keeps running)",
    "cosmos.queue.resumed": "Queue resumed",
    "cosmos.queue.opFailed": "Queue operation failed",
    "cosmos.queue.cleared": "Queue cleared",
    "cosmos.queue.clearFailed": "Could not clear the queue",
    "cosmos.queue.reorderFailed": "Could not reorder",
    "cosmos.queue.removeFailed": "Could not remove from the queue",
    "cosmos.actions.enqueue": "Add to auto queue",
    "cosmos.actions.enqueueLabel": "＋ Queue",
    "cosmos.constActions.aria": "Constellation actions",
    "cosmos.constFloat.title": "Constellation action",
    "cosmos.constFloat.inputAria": "Message",
    "cosmos.constFloat.placeholder": "Extend or edit the message; sending starts the session in the current constellation's workspace…",
    "cosmos.constFloat.send": "Send",
    "cosmos.constFloat.close": "Close",
    "cosmos.constFloat.hint": "Enter sends · Shift+Enter starts a new line · click ＋ or paste to add images · {voice} starts voice · {close} closes the composer (draft kept)",
    "cosmos.constFloat.attach": "Add image",
    "cosmos.constFloat.attachUnavailable": "Open the session page to add images with the native picker",
    "cosmos.constFloat.attachImageOnly": "Only images can be added",
    "cosmos.constFloat.attachBusy": "Attachments cannot be added right now",
    "cosmos.constFloat.attachRemove": "Remove image",
    "cosmos.constFloat.modelLabel": "Model",
    "cosmos.constFloat.switching": "Switching…",
    "cosmos.constFloat.modelFallback": "using the session's current model",
    "cosmos.constFloat.modelDefault": "Session's current model",
    "cosmos.constFloat.modelDrift": "unavailable",
    "cosmos.constFloat.modelDegraded": "Model catalog unavailable",
    "cosmos.constFloat.effortLabel": "Effort",
    "cosmos.constFloat.voiceStart": "Voice",
    "cosmos.constFloat.voiceStop": "Stop",
    "cosmos.constFloat.voiceBusy": "Transcribing…",
    "cosmos.constFloat.voiceAria": "Voice input",
    "cosmos.constFloat.voiceDenied": "Cannot access the microphone: check browser permission and environment",
    "cosmos.constFloat.voiceFailed": "Voice transcription failed: ",
    "cosmos.constFloat.voiceEmpty": "No speech recognized",
    "cosmos.constFloat.voiceUnavailable": "Enable voice input in settings: Settings → Plugins → Voice input",
    "cosmos.settings.nav": "Cosmos",
    "cosmos.settings.tabGeneral": "General",
    "cosmos.settings.generalUnavailable": "General settings are unavailable: the plugin page is not ready (reload the page and retry).",
    "cosmos.settings.launchModeLabel": "Open as",
    "cosmos.settings.launchModeHint": "Inline page = open inside the current DSH window as a full-page overlay (current behaviour); split pane = dock Cosmos in the DSH right sidebar beside the conversation, so both sides stay operable and naturally linked (a stored legacy window value migrates to the split pane automatically).",
    "cosmos.settings.launchModeEmbedded": "Inline page (default)",
    "cosmos.settings.launchModeEmbeddedHint": "Open as a full-page overlay inside the DSH window (unchanged).",
    "cosmos.settings.launchModeDock": "Split pane (right sidebar)",
    "cosmos.settings.launchModeDockHint": "Dock Cosmos in the DSH right sidebar beside the conversation; actions and navigation happen in the same window, identically on web and desktop.",
    "cosmos.settings.launchModeInstant": "Changes apply and persist immediately",
    "cosmos.settings.templateNamesLegend": "Constellation decoration",
    "cosmos.settings.templateNamesLabel": "Show constellation template names",
    "cosmos.settings.templateNamesHint": "Append the matched template's Chinese name (for example 猎户座 / Orion) beneath the galaxy constellation labels and on the drilled-down badge; decorative text only, with no layout or interaction impact.",
    "cosmos.settings.templateNamesAria": "Toggle constellation template names",
    "cosmos.settings.pathsLabel": "Paths",
    "cosmos.settings.pathsHint": "Resolution value of the openspec path token OPENSPEC_PATH and the cosmos-spec skill directory: saved into this machine's shared config and applied immediately (no plugin or session restart). Leave blank for unset.",
    "cosmos.settings.pathsLoading": "Loading path settings…",
    "cosmos.settings.pathsOpenspecLabel": "openspecPath (openspec repo root)",
    "cosmos.settings.pathsOpenspecHint": "Resolution value of the OPENSPEC_PATH token: skill references render against this directory.",
    "cosmos.settings.pathsOpenspecPh": "e.g. C:\\openspec or ~/openspec (blank = unset)",
    "cosmos.settings.pathsCosmosSpecLabel": "cosmosSpecDir (cosmos-spec directory)",
    "cosmos.settings.pathsCosmosSpecHint": "cosmos-spec canonical directory: the scan root for skill rendering.",
    "cosmos.settings.pathsCosmosSpecPh": "e.g. C:\\cosmos-spec (blank = unset)",
    "cosmos.settings.pathsUnavailable": "Path settings are unavailable: the plugin page is not ready (reload the page and retry).",
    "cosmos.settings.pathsNotWritable": "Path settings are unavailable on this connection (host half not ready or outdated); other settings are unaffected.",
    "cosmos.settings.pathsSave": "Save",
    "cosmos.settings.pathsSaving": "Saving…",
    "cosmos.settings.pathsSaveFailed": "Save did not take effect (it may have changed elsewhere); please retry",
    "cosmos.settings.pathsDiscard": "Discard changes",
    "cosmos.settings.pathsDirMissing": "Directory does not exist (saved anyway; configure before creating):",
    "cosmos.settings.tabActions": "Quick actions",
    "cosmos.settings.tabConstActions": "Constellation actions",
    "cosmos.settings.tabSkins": "Skins",
    "cosmos.settings.tabInterface": "Interface",
    "cosmos.settings.title": "Cosmos",
    "cosmos.settings.intro": "Two action families: proposal actions send \"prompt + @proposal directory\" into a new session of the selected proposal's workspace; constellation actions send a plain prompt (no @references) into the current constellation's workspace — with auto-send the click fires immediately; otherwise \"pre-send editing\" decides: a floating native composer window (default; the galaxy stays visible), or the legacy floating composer for edits.",
    "cosmos.settings.tabsAria": "Cosmos settings tabs",
    "cosmos.settings.buttonsLabel": "Action buttons (apply to the selected proposal)",
    "cosmos.settings.buttonsHint": "Click creates a new session in the selected proposal's workspace: message = prompt and @proposal directory (order decided by \"prompt first\"); with auto-send the hero phase submits the first turn. Changes apply immediately on save.",
    "cosmos.settings.prependDiffHint": "\"Prompt first\" = the prompt precedes the @proposal reference in the message (different from the same-named field in dsh-v-skill-links, where it prepends into an existing draft).",
    "cosmos.settings.addButton": "Add",
    "cosmos.settings.removeButton": "Remove",
    "cosmos.settings.resetButtons": "Reset to composition",
    "cosmos.settings.buttonNamePh": "name (shown on the button; any text)",
    "cosmos.settings.buttonPromptPh": "Prompt carried into the new session draft…",
    "cosmos.settings.autoSendLabel": "Auto-send",
    "cosmos.settings.prependLabel": "Prompt first",
    "cosmos.settings.prependTitle": "Checked: the prompt precedes the @proposal reference; unchecked: the reference comes first",
    "cosmos.settings.newSessionLabel": "New session",
    "cosmos.settings.newSessionTitle": "Fixed to \"new session\": creates a new session in the proposal's workspace (not modifiable)",
    "cosmos.settings.newSessionTitleProto": "Embryo actions always go to the exploration session and never open a new one (not modifiable)",
    "cosmos.settings.preStateLabel": "Pre-state",
    "cosmos.settings.preStateUnlimited": "Any",
    "cosmos.settings.preStateProto": "Pending creation (embryo)",
    "cosmos.settings.preStateCreated": "Created",
    "cosmos.settings.preStateReviewed": "Reviewed",
    "cosmos.settings.preStateExecuted": "Executed",
    "cosmos.settings.preStateUnavailable": "Unavailable",
    "cosmos.settings.prependTitleProto": "Embryo messages carry no @ proposal reference, so ordering is meaningless (not selectable)",
    "cosmos.settings.buttonPreStateInvalid": "Invalid pre-state (choose Any / Pending creation (embryo) / Created / Reviewed / Executed)",
    "cosmos.settings.buttonModelLabel": "Model",
    "cosmos.settings.buttonEffortLabel": "Effort",
    "cosmos.settings.buttonModelFollow": "Follow session (default)",
    "cosmos.settings.modelCatalogFallback": "Model catalog unavailable: only \"follow session\" is offered; model-bound buttons skip switching.",
    "cosmos.settings.modelUnavailable": "unavailable",
    "cosmos.settings.gripLabel": "Drag to reorder",
    "cosmos.settings.moveUp": "Move up",
    "cosmos.settings.moveDown": "Move down",
    "cosmos.settings.save": "Save",
    "cosmos.settings.saving": "Saving…",
    "cosmos.settings.discard": "Discard",
    "cosmos.settings.saveFailed": "Save did not land, please retry",
    "cosmos.settings.notWritable": "This connection cannot persist settings",
    "cosmos.settings.loading": "Loading settings…",
    "cosmos.settings.buttonsCountPrefix": "Action buttons: ",
    "cosmos.settings.jumpLabel": "Jump after running",
    "cosmos.settings.jumpTitle": "Per-button: checked = after the action Cosmos closes and the session appears on the right; unchecked = Cosmos stays open (the new session is still created; auto-send submits as usual).",
    "cosmos.settings.buttonNameRequired": "Button name is required",
    "cosmos.settings.buttonDup": "Duplicate button name",
    "cosmos.settings.buttonPromptRequired": "Prompt is required",
    "cosmos.settings.buttonNewSessionFixed": "\"New session\" is fixed (non-true values are rejected)",
    "cosmos.settings.tooManyButtons": "Too many buttons (limit 32)",
    "cosmos.settings.constButtonsLabel": "Constellation action buttons (apply to the current constellation)",
    "cosmos.settings.constButtonsHint": "A click creates a new session in the current constellation's workspace: message = plain prompt (no @proposal reference). With auto-send the click fires it immediately; otherwise the \"pre-send editing\" choice below applies — the floating composer (default: the page stays open, with model picking and voice transcription built in), or jumping to the session page whose native composer carries the edits. Changes apply immediately on save.",
    "cosmos.settings.constPreflightLabel": "Pre-send editing",
    "cosmos.settings.constPreflightAria": "How a constellation button without auto-send is edited before sending",
    "cosmos.settings.constPreflightNative": "Jump to the session page (native composer)",
    "cosmos.settings.constPreflightFloat": "Floating composer (cosmos stays open, default)",
    "cosmos.settings.constPreflightHint": "For a constellation button without auto-send: Floating composer = the Cosmos page stays open and the floating card handles edits and manual sending (model picking and voice transcription are built into the card; @references/attachments and other editor abilities need \"jump to the session page\" and the native composer); Jump = the page closes and you land in the new session's native composer with the prompt pre-filled (full native abilities). Closing the card or pressing Esc only collapses it and keeps the draft.",
    "cosmos.settings.constPreflightInstant": "Changes apply and persist immediately (independent of the button draft)",
    "cosmos.settings.constNewSessionTitle": "Fixed to \"new session\": creates a new session in the current constellation's workspace (not modifiable)",
    "cosmos.settings.constButtonsCountPrefix": "Constellation action buttons: ",
    "cosmos.settings.constButtonNameRequired": "Button name is required",
    "cosmos.settings.constButtonDup": "Duplicate button name",
    "cosmos.settings.constButtonPromptRequired": "Prompt is required",
    "cosmos.settings.constButtonNewSessionFixed": "\"New session\" is fixed (non-true values are rejected)",
    "cosmos.settings.constButtonPrependRejected": "Constellation buttons do not support \"prompt first\" (no @reference, so no ordering)",
    "cosmos.settings.tooManyConstButtons": "Too many buttons (limit 32)",
    "cosmos.settings.skinsHint": "Click to apply instantly: an open Cosmos page repaints at once (canvas bodies and HUD chrome together) and the preference is persisted for the next visit.",
    "cosmos.settings.skinsAria": "Skins",
    "cosmos.settings.skinsDefault": "Default",
    "cosmos.settings.skinsDark": "Dark",
    "cosmos.settings.skinsLight": "Light",
    "cosmos.settings.skinsCountPrefix": "Built-in skins: ",
    "cosmos.settings.skinsInstant": "select = preview = saved",
    "cosmos.settings.navHint": "Zoom is navigation: the read-only ruler at the top shows the current zoom scale, and its tick marks the drill reference distance. In the galaxy view, zooming in to the tick dives into the nearest constellation only when that constellation lies within the central 25% of the screen; when drilled, zooming out past the hysteresis floor below the tick flies back. Both verdicts use fixed engine constants; no setting exposes them.",
    "cosmos.settings.navFocusLabel": "Pointer-focused zoom",
    "cosmos.settings.navFocusAria": "Pointer-focused zoom toggle",
    "cosmos.settings.navFocusHint": "Zoom gradually focuses on the pointer position (turn off to zoom around the screen center).",
    "cosmos.settings.navInstant": "Applies and saves immediately",
    "cosmos.settings.sizeGroup": "Layout sizes",
    "cosmos.settings.sizeGroupHint": "Pixel values; apply and save immediately. Height 0 = auto for panels and the search box.",
    "cosmos.settings.sizeSessionW": "Session list width",
    "cosmos.settings.sizeSessionH": "Session list height",
    "cosmos.settings.sizeConstW": "Constellation list width",
    "cosmos.settings.sizeConstH": "Constellation list height",
    "cosmos.settings.sizeAddBtn": "Add button size",
    "cosmos.settings.sizeHudBtn": "Bottom-right button size",
    "cosmos.settings.sizeActionW": "Action button width",
    "cosmos.settings.sizeActionH": "Action button height",
    "cosmos.settings.sizeConstActionH": "Constellation action height",
    "cosmos.settings.sizeSearchW": "Search box width",
    "cosmos.settings.sizeSearchH": "Search box height",
    "cosmos.settings.sizeWsTitle": "Constellation title size",
    "cosmos.settings.sizeAuto": "0 = auto",
    "cosmos.settings.skinUnavailable": "Skin selection is unavailable: the plugin page is not ready (reload the page and retry).",
    "cosmos.settings.navUnavailable": "Interface settings are unavailable: the plugin page is not ready (reload the page and retry).",
    "cosmos.settings.skinNotApplied": "Skin selection did not apply: the plugin page controller is missing. Retry, or reload the page and select again.",
    "cosmos.settings.navNotApplied": "Interface change did not apply: the plugin page controller is missing. Retry, or reload the page and adjust again.",
    /* ── Shortcuts (add-cosmos-shortcuts 7.3) ── */
    "cosmos.settings.tabShortcuts": "Shortcuts",
    "cosmos.settings.shortcutsHint": "Four global keys plus custom shortcuts for the action-bar buttons. Changes apply and persist immediately (no restart or page reopen). Shortcuts are active only while the Cosmos page is open — they yield to focused inputs, IME composition, and the floating composer. Keys match physical key positions (ev.code), so printed letters may differ on non-QWERTY layouts.",
    "cosmos.settings.shortcutsDefault": "Default",
    "cosmos.settings.shortcutGoHome": "Back to galaxy",
    "cosmos.settings.shortcutTogglePan": "Pan toggle",
    "cosmos.settings.shortcutVoiceToggle": "Voice toggle (composer)",
    "cosmos.settings.shortcutClosePage": "Close page",
    "cosmos.settings.shortcutGoHomeHint": "Active while drilled in: flies back to the galaxy view (same as the bottom-right \"back to galaxy\" button); does nothing in the galaxy view.",
    "cosmos.settings.shortcutTogglePanHint": "Active while the page is open: flips the bottom-right \"drag to pan\" switch (same state chain as clicking it, including persistence).",
    "cosmos.settings.shortcutVoiceToggleHint": "Active only while the floating composer is open: starts/stops voice input (idle → record, recording → stop and transcribe); usable while the composer textarea is focused.",
    "cosmos.settings.shortcutClosePageHint": "Active while the page is open: the close/collapse chain — leave constellation > clear search > collapse session panel > exit fullscreen > close page (no keyboard listeners once the page is closed).",
    "cosmos.settings.shortcutRisky": "Browser-reserved combination, may not be interceptable (some browsers may quit)",
    "cosmos.settings.shortcutRiskTag": "browser-reserved",
    "cosmos.settings.shortcutRiskyHint": "Ctrl+Q is the reserved \"quit browser\" combination in some browsers and cannot be intercepted by a web page: use Alt+Q or another alternative.",
    "cosmos.settings.shortcutDup": "Shortcut conflict: this key duplicates another binding (global key or another button) — pick a different key",
    "cosmos.settings.shortcutConflictRow": "Conflict: this key duplicates \"{other}\"",
    "cosmos.settings.buttonShortcutLabel": "Shortcut",
    "cosmos.settings.buttonShortcutSaveHint": "Pick a key, then click Save below to apply",
    "cosmos.settings.buttonShortcutPreStateHint": "Active only when the selected proposal's pre-state is \"{state}\" and idle (i.e. when this button is rendered)",
    "cosmos.settings.buttonShortcutPreStateShort": "only when \"{state}\"",
    "cosmos.settings.buttonShortcutNone": "None",
    "cosmos.settings.buttonShortcutUnavailable": "Unavailable",
    "cosmos.settings.buttonShortcutInvalid": "Invalid shortcut (choose None / 0–9 / F2 / F4 / F8 / F9)",
    "cosmos.settings.constButtonShortcutInvalid": "Invalid shortcut (choose None / 0–9 / F2 / F4 / F8 / F9)",
    "cosmos.settings.shortcutInstant": "Changes apply and persist immediately",
    "cosmos.settings.shortcutPanelHint": "Button shortcuts share one uniqueness domain with the global keys: each key belongs to exactly one action (cross-list duplicates are rejected on save). Pick a key, then click \"Save\" below to apply it (same draft flow as the other button fields).",
    "cosmos.settings.shortcutsUnavailable": "Shortcut settings are unavailable: the plugin page is not ready (reload the page and retry).",
    "cosmos.settings.shortcutsNotApplied": "Shortcut change did not apply: the plugin page controller is missing. Retry, or reload the page and set it again.",
    "cosmos.settings.shortcutsCount": "Global shortcuts: ",
    "cosmos.skin.deepspace.name": "Deep Space",
    "cosmos.skin.deepspace.ref": "Current style D (visual regression baseline)",
    "cosmos.skin.rosepine.name": "Rosé Pine",
    "cosmos.skin.rosepine.ref": "Official Rosé Pine palette (closest to the current baseline)",
    "cosmos.skin.fidenza.name": "Fidenza Warm Mineral",
    "cosmos.skin.fidenza.ref": "Tyler Hobbs methodology (transparent starry sky on paper)",
    "cosmos.skin.linear.name": "Linear Indigo",
    "cosmos.skin.linear.ref": "Linear.app design language",
    "cosmos.skin.obsidian.name": "Obsidian Graph",
    "cosmos.skin.obsidian.ref": "Obsidian Graph View",
    "cosmos.skin.reagent.name": "Chemical Reaction",
    "cosmos.skin.reagent.ref": "Chemistry lab (petri dish / fluorescent reagent)",
    "cosmos.skin.chamber.name": "Cloud Chamber",
    "cosmos.skin.chamber.ref": "Particle physics (decay tracks)",
    "cosmos.skin.fluoro.name": "Fluorescence",
    "cosmos.skin.fluoro.ref": "Fluorescence microscopy (cells / organelles)",
    "cosmos.skin.lotus.name": "Lotus Pond",
    "cosmos.skin.lotus.ref": "Ink-wash pond (blossoms / koi)",
    "cosmos.skin.migration.name": "Migration Dusk",
    "cosmos.skin.migration.ref": "Bird migration (flocks / murmuration)",
    "cosmos.skin.circuit.name": "Copper Board",
    "cosmos.skin.circuit.ref": "PCB (chips / signal pulses)",
    "cosmos.skin.fermata.name": "Fermata Score",
    "cosmos.skin.fermata.ref": "Music score (notes / fermata)"
  }
};
