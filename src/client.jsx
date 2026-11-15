/**
 * dsh-v-cosmos — 浏览器半区（由 build.mjs 打包成懒 CJS 工厂 lib/client.js）。
 *
 * 入口与页面（对齐 dsh-v-hive 轨道；add-cosmos-entry 4.1/5.x）：
 *  - sidebar.footer.action 座位：侧栏底部「Cosmos」按钮（座位序 15——Hive(10) 与
 *    Token统计(20) 之间，对齐两插件入口形态）；
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
 *  - 「打开会话」（5.4）：先关整页，再经 ctx.uiWorkspace.openSession 切换右侧
 *    系统会话页（旧宿主回退 ctx.sessions.open）；
 *  - 新增工作区（add-cosmos-add-workspace 4.x）：左下角常驻「新增」按钮 →
 *    ctx.uiWorkspace.pickDirectory + ctx.workspaces.create（官方服务组合，与宿主
 *    「添加工作区」同源）→ 留在银河、引擎 dive-in 新星座（MUST NOT 打开会话/关整页）；
 *    取消静默、幂等重选 toast、失败 toast、busy 防重入；
 *  - 全部官方动词经注入服务使用，不修改任何官方包。
 */
import { Component, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { fetchScene, subscribeCosmosEvents } from "./api.mjs";
import { mergeScene, sceneDiffLevel, planetStateOf, relativeTime, matchWorkspaces, filteredPositions, findRegisteredWorkspace, normalizeWorkspacePath, isWindowsPlatform } from "./merge.mjs";
import { createSkinD, SKIN_D_PALETTE } from "./cosmos/skin-d.mjs";
import { COSMOS_DEFAULT_SKIN, COSMOS_SKIN_IDS, COSMOS_SKINS, applySkinTokens, createSkin, skinCardOf } from "./cosmos/skin-registry.mjs";
import { createCosmosEngine, ENGINE_CSS, FX_PRIORITY, isUiChromeTarget, resolveBlastCoreOf } from "./cosmos/engine.mjs";
import { cosmosStore } from "./store.mjs";
import { COSMOS_SETTINGS_BOUNDS, COSMOS_SETTINGS_DEFAULTS, loadCosmosSettings, saveCosmosSettings } from "./settings.mjs";
import { actionButtonVisible, buttonsSectionOf } from "./buttons.mjs";
import { constButtonsSectionOf, normalizeConstButtons } from "./const-buttons.mjs";
import { findCard, isSelectionSurface, projectPanel, projectSessionPanel, proposalKeyOf, sessionKeyOf } from "./panel.mjs";
import { assembleEmbryoMessage, assembleMessage, consumePendingAction, createActionExecutor, createActionGate, createEmbryoActionExecutor, createPendingActionStore, draftMatches, explorationTargetOf, isBlankDraft, pendingReadinessOf } from "./actions.mjs";
import { activitySummaryOf, archiveNoticeOf, archiveRequestFailureNotice, isSessionArchiveOutcome } from "./session-archive.mjs";
import { constellationMessageOf, createConstellationExecutor, createFloatMarkerStore, floatPresentationOf } from "./constellation-actions.mjs";
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
import { COSMOS_SETTINGS_CSS, CosmosActionsPanel, CosmosNavPanel, CosmosSkinPanel, CosmosSettingsSection, SETTINGS_TAB_SLOT } from "./settings-ui.jsx";

const PLUGIN_ID = "dsh-v-cosmos";
const NS = "dsh-v-cosmos";
/** 自有批量归档端点（宿主半区 cosmos-archive-sweep 契约）：浏览器半区以单元素数组
 *  消费——信息卡「归档会话」是它的第二个 UI 面（首个是归档技能的扫尾流程）。 */
const ARCHIVE_SESSIONS_PATH = "/api/dsh-v-cosmos/archive-sessions";

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
   */
  const openSessionVia = (sessionId) => {
    if (typeof ctx.uiWorkspace?.openSession === "function") {
      ctx.uiWorkspace.openSession(sessionId);
      return;
    }
    if (typeof ctx.sessions?.open === "function") {
      ctx.sessions.open(sessionId);
      return;
    }
    throw new Error("当前宿主未提供会话导航通道");
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
   * `startSession` 只作降级通道（`whenDraftExists` 语义不进入主路径）。
   */
  const actionExecutor = createActionExecutor({
    pending: heroMarkers,
    gate: actionGate,
    createSession: (workspaceId, card) => createSessionVia(workspaceId, card),
    openSession: (sessionId) => openSessionVia(sessionId),
    startSession: (workspaceId, message, card) => startSessionVia(workspaceId, message, card),
    closePage: () => cosmosOpenStore.set(false),
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
    closePage: () => cosmosOpenStore.set(false),
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
    preflight: () => loadCosmosSettings().constPreflight,
    closePage: () => cosmosOpenStore.set(false),
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
      /* 先关整页（spec「打开会话」：Cosmos 整页关闭 → 右侧系统会话页切换）。 */
      cosmosOpenStore.set(false);
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
  disposers.push(subscribeCosmosEvents(() => refreshSkeleton()));

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
          }
        },
        /* 钻取态 → React 面板（过滤/让位）；引擎是唯一权威，镜像只读。 */
        onDrillChange: (info) => drillStore.set(info),
        /* 引擎选中 → React 面板（add-cosmos-selection-linkage 3.1/D6）：同款幂等镜像通道，
           「视图里选中的恒星」据此映射回对应提案卡片。 */
        onSelectChange: (info) => engineSelectStore.set(info)
      });
      if (mergedScene) engine.setScene(mergedScene, "rebuild");
      if (filterQuery.trim()) syncFilter(); // 重挂载保持当前查询（引擎落位 + 坡道续接）
      refreshSkeleton(); // 挂载即拉一次（SSE 重连/首次打开双保险）
      if (open && visible) engine.start();
    },
    detach() {
      engine?.dispose();
      engine = null;
      drillStore.set(null); // 引擎实例销毁 → 钻取镜像归零（面板恢复全量分组）
      engineSelectStore.set(null); // 引擎实例销毁 → 选中镜像归零（避免陈旧聚焦目标）
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
 */
function ProposalPanel({ t, model, selectedKey, onSelect, drill, constButtons, onRunConst }) {
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
      </div>
      <div
        className="dsh-cosmos-panel-list"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          /* 面板内 Esc = 失焦：MUST NOT 触发钻取返回或关页（spec「面板内 Esc 失焦」）。
             焦点可能落在卡片按钮或列表容器自身——统一对 document.activeElement 失焦。 */
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
                  data-selected={card.key === selectedKey ? "true" : undefined}
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
                        {card.setBy ? (
                          <span className="dsh-cosmos-panel-badge" title={t("cosmos.panel.setBy", "落章来源")}>
                            {card.setBy}
                          </span>
                        ) : null}
                        {card.at ? <span className="dsh-cosmos-panel-at">{relativeTime(card.at, Date.now())}</span> : null}
                      </span>
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
function SessionRow({ t, row, selected, onSelect, onOpen, onArchive }) {
  const pending = row.state === "waiting";
  const title = sessionStatusTextOf(t, row) + " · " + row.when;
  /* 行级防重入门禁（add-cosmos-session-row-archive D2）：每行组件内 in-flight 布尔。
     行按会话键（`row.key`）作 React key，跨场景增量刷新组件身份稳定 → 组件状态即天然
     per-session 门（无需全局 Map）；归档成功后行随场景刷新卸载，状态自然清理。
     门禁口径与信息卡一致：只拦本行「归档」重复请求，**不拦**该行「打开」与行选中。 */
  const [archiving, setArchiving] = useState(false);
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
      data-cosmos-session={row.id}
      data-cosmos-ws={row.wsId}
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
          `data-cosmos-session` 供程序化定位。在途禁用 + `aria-busy`（行级门禁 D2）。 */}
      <button
        type="button"
        className="dsh-cosmos-session-archive"
        data-action="archive"
        aria-label={t("cosmos.sessions.archiveAria", "归档会话")}
        title={t("cosmos.sessions.archiveAria", "归档会话")}
        aria-busy={archiving || undefined}
        disabled={archiving}
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
function SessionPanel({ t, model, open, selectedKey, drill, waiting, onToggle, onSelect, onOpen, onArchive }) {
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
 * 滚轮缩放由外层（页面）经 ref 绑定非被动监听转发 `engine.zoomBy`（动作条非滚动区；
 * 携带指针原始坐标 → 引擎侧换算后参与聚焦收敛，缩放按钮仍无坐标、保持屏心）。
 */
function ActionBar({ t, buttons, enabled, onRun, barRef, stateOf }) {
  if (!Array.isArray(buttons) || buttons.length === 0) return null;
  const columns = Math.min(8, buttons.length);
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
        return (
          <button
            type="button"
            key={button.name + "-" + index}
            className="dsh-cosmos-action"
            data-cosmos-action={button.name}
            title={extra?.title || button.prompt || button.name}
            disabled={disabled}
            onClick={() => onRun(button)}
          >
            <span className="dsh-cosmos-action-label">{button.name}</span>
          </button>
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
 * 生效）。**发送即关**（fix-cosmos-const-float-send-close D1/D3）：submit() 之后主动调
 * `close()`——宿主对普通文本走 detached 发送路径（源码注释原话「leaves the phase
 * plain」），提交相位全程保持 `plain`，关闭 MUST NOT 依赖相位跃迁；两类守卫早退于
 * submit() 之前且 MUST NOT 关窗（`inputActions` 缺失；空草稿——宿主 `onEnter` 对
 * `trimmed === ""` 直接 no-op、不进入发送流程）——「点了发送却没提交不误关」。
 * 其余关闭路径 = 关闭按钮 / Esc / 点浮窗外（草稿保留）。
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
 *    官方 VoiceInput UI 挂驻留 composer 槽位，浮窗不可复用其 UI）：麦克风钮
 *    MediaRecorder 默认容器（与官方 createRecording 同构）→ base64 → transcribe →
 *    转写文本**追加**到草稿尾部（既有内容零改写）。Bundle 未启用 → 语音钮隐藏；
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
  const inputActions = props.inputActions ?? null;
  const switchModel = typeof props.switchModel === "function" ? props.switchModel : null;
  /* 增强注入（rework 方案 2）：models = 模型目录 face（{catalog}快照）、speech = 语音转写
     桥 face（{available}快照 + transcribe/openBundle）。缺席（旧宿主/未启用）→ 对应增强
     面整体降级：模型行回落只读标识、语音钮隐藏——零新增噪音。 */
  const models = props.models ?? null;
  const speech = props.speech ?? null;
  const notify = typeof props.notify === "function" ? props.notify : null;
  const t = props.t;
  /* 已消费的标记（null = 浮窗未打开）。标记随挂载消费，故呈现后显隐只看本状态。 */
  const [armed, setArmed] = useState(null);
  /* 模型选择面：null = 尚未呈现；否则 { model: 选中模型对象|null（null = 会话当前模型）,
     status: "idle"|"switching"|"failed" }。 */
  const [modelSel, setModelSel] = useState(null);
  /* 语音面："idle"（可点开始）|"recording"（录音中，再点停止）|"transcribing"（转写中）。 */
  const [voiceState, setVoiceState] = useState("idle");
  const voiceRefs = useRef({ stream: null, recorder: null, chunks: [] });
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
    setArmed(entry);
  }, [armed, gate, draft, sessionId, floats, markerVersion]);

  /* 兜底关闭：`/` 命令草稿的提交相位离开 plain（adjudicating/submitting）→ 关浮窗。
     普通文本走宿主 detached 发送、相位恒 plain，该跃迁不触发——收敛由 send() 的主动
     close() 负责（两路同一动作，幂等）；保留本副作用也覆盖宿主未来给普通路径加
     非 plain 瞬态的情形。 */
  useEffect(() => {
    if (armed === null) return;
    if (phase !== "plain") setArmed(null);
  }, [armed, phase]);

  /* Esc 最高分层：capture 阶段先于 Cosmos 外壳的 window 冒泡监听消费并阻断传播
     （不触发钻取返回 / 清搜索 / 关页）。浮窗未打开时不注册 → 既有分层零变化。 */
  useEffect(() => {
    if (armed === null || typeof window === "undefined") return undefined;
    const onKey = (event) => {
      /* IME 组字中的 Esc = 取消输入法候选，MUST NOT 关浮窗（中文输入高频路径）。
         口径统一（add-cosmos-const-float-send-key D3 复核版）：本监听器挂在 window
         capture 上，回调收到的**本就是原生** KeyboardEvent → 直接读原生组字状态
         `event.isComposing`（改读 `event.nativeEvent?.…` 反而是恒 undefined 的死读取）；
         另补 `keyCode === 229`（组字期间 Chromium 以 229 报键）双保险，使本守卫与 Enter
         守卫及宿主 `isComposingEvent` 前两项判据逐字同源。「组字 Esc 不关浮窗」为既有
         行为，本行仅加固，由 spec 场景 + 冒烟锚点钉住防漂移。 */
      if (event.key !== "Escape" || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      event.stopPropagation();
      setArmed(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [armed]);

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

  if (armed === null) return null;
  if (typeof document === "undefined" || !document.body) return null;

  const meta = armed.meta !== null && typeof armed.meta === "object" ? armed.meta : {};
  const title = typeof meta.wsName === "string" && meta.wsName ? meta.wsName : tr("cosmos.constFloat.title", "星座动作");
  const buttonName = typeof meta.buttonName === "string" ? meta.buttonName : "";
  const close = () => setArmed(null);
  const send = () => {
    /* 守卫①：注入面降级——点了发送却无法提交，浮窗留存（不产生「什么都没发生还关窗」死态）。 */
    if (inputActions === null || typeof inputActions.submit !== "function") return;
    /* 守卫②：空草稿 = 宿主 no-op（`onEnter` 对 `trimmed === ""` 直接 return []，不进入
       发送流程、相位恒 plain）→ 同样不关（与守卫①同一「没提交不误关」原则）。 */
    if (draft.trim() === "") return;
    inputActions.submit();
    /* 发送即关：普通文本走宿主 detached 发送、提交相位恒 plain —— 关闭不依赖任何相位
       跃迁；`/` 命令的相位兜底副作用仍在，两路收敛于 close()（幂等）。 */
    close();
  };

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

  /* ── 语音转写（rework 方案 2 增强，借官方语音 Bundle 服务层）：MediaRecorder 默认容器
     （与官方 UI 的 createRecording 同构）→ base64 → `remote.speech.transcribe` → 转写文本
     追加到草稿尾部（唯一真相源写回，既有内容零改写、只追加）。录音/转写全程状态面上浮
     （按钮自持）；失败 toast 不关窗、不丢草稿。 ── */
  const bytesToBase64 = (bytes) => {
    let binary = "";
    const CHUNK = 0x8000;
    for (let index = 0; index < bytes.length; index += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(index, index + CHUNK));
    }
    return btoa(binary);
  };
  const finishVoice = () => {
    const recorder = voiceRefs.current.recorder;
    if (recorder && recorder.state !== "inactive") recorder.stop(); // onstop 承担收尾与转写
  };
  const startVoice = () => {
    if (voiceState !== "idle" || speech === null) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function" || typeof MediaRecorder === "undefined") {
      notify?.(tr("cosmos.constFloat.voiceDenied", "无法访问麦克风：请检查浏览器权限与环境"), true);
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      const recorder = new MediaRecorder(stream);
      const chunks = voiceRefs.current.chunks;
      chunks.length = 0;
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        /* 收尾：释放麦克风 → 组 Blob → 转写 → 追加草稿。任一步失败 toast，浮窗留存。 */
        for (const track of voiceRefs.current.stream?.getTracks?.() ?? []) track.stop();
        voiceRefs.current.stream = null;
        voiceRefs.current.recorder = null;
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        setVoiceState("transcribing");
        Promise.resolve()
          .then(() => blob.arrayBuffer())
          .then((buffer) => bytesToBase64(new Uint8Array(buffer)))
          .then((audioBase64) => speech.transcribe(audioBase64))
          .then((result) => {
            const text = result !== null && typeof result === "object" && typeof result.text === "string" ? result.text : "";
            if (text === "") {
              notify?.(tr("cosmos.constFloat.voiceEmpty", "未识别到语音"), true);
            } else if (inputActions !== null && typeof inputActions.setDraft === "function") {
              const glue = draft === "" || draft.endsWith("\n") ? "" : "\n";
              inputActions.setDraft(draft + glue + text);
            }
            setVoiceState("idle");
          })
          .catch((error) => {
            setVoiceState("idle");
            notify?.(tr("cosmos.constFloat.voiceFailed", "语音转写失败：") + String(error?.message || error), true);
          });
      };
      voiceRefs.current.stream = stream;
      voiceRefs.current.recorder = recorder;
      recorder.start();
      setVoiceState("recording");
    }).catch(() => {
      notify?.(tr("cosmos.constFloat.voiceDenied", "无法访问麦克风：请检查浏览器权限与环境"), true);
    });
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
        {/* 模型行（rework 增强）：目录可达 = 可交互下拉（模型 + 级别）；目录降级 =
            只剩「会话当前模型」+ 注记；按钮绑定模型经链路先行切换后在此回显。 */}
        <div className="dsh-cosmos-const-float-model" data-state={modelSel?.status ?? "idle"}>
          <span className="dsh-cosmos-const-float-model-cap">{tr("cosmos.constFloat.modelLabel", "模型")}</span>
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
        </div>
        <textarea
          ref={textareaRef}
          className="dsh-cosmos-const-float-input"
          value={draft}
          rows={4}
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
            event.preventDefault();
            send();
          }}
          onChange={(event) => {
            if (inputActions === null || typeof inputActions.setDraft !== "function") return;
            /* 写回真实会话草稿（唯一真相源）：浮窗是受控镜像。 */
            inputActions.setDraft(event.target.value);
          }}
        />
        <div className="dsh-cosmos-const-float-foot">
          {speechAvailable ? (
            <button
              type="button"
              className="dsh-cosmos-const-float-voice"
              data-state={voiceState}
              disabled={voiceState === "transcribing"}
              aria-label={tr("cosmos.constFloat.voiceAria", "语音输入")}
              title={tr("cosmos.constFloat.voiceAria", "语音输入")}
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
          ) : null}
          <span className="dsh-cosmos-const-float-hint">
            {tr("cosmos.constFloat.hint", "Enter 发送 · Shift+Enter 换行 · 发送后浮窗关闭；关闭或 Esc 保留草稿不发送。")}
          </span>
          <button type="button" className="dsh-cosmos-const-float-send" onClick={send}>
            {tr("cosmos.constFloat.send", "发送")}
          </button>
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
 * 缩放导航偏好投影（add-cosmos-zoom-focus-nav 3.2）：模块级 store——设置页「导航」页签
 * 的受控镜像；写入唯一链路 = 控制器 `saveNav`（saveCosmosSettings → engine.setTuning →
 * 本 store），冷启动值取持久化偏好（净房已钳制）。与皮肤 store 同构（设置页不依赖整页）。
 */
const cosmosNavStore = createSnapshotStore(navPrefsOf(loadCosmosSettings()));

/** 完整设置 → 导航三键投影（store 载荷最小形）。 */
function navPrefsOf(settings) {
  return {
    zoomDiveRatio: settings.zoomDiveRatio,
    zoomFlyOutRatio: settings.zoomFlyOutRatio,
    zoomPointerFocus: settings.zoomPointerFocus
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
 * @param {"skin"|"nav"|"preflight"} face 失败所属设置页签
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
  return <CosmosPage {...props} />;
};

function CosmosPage(props) {
  const { t, useStore, setFullscreen } = props;
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
  const pageLeft = usePageLeft(frameRef, measuredRef);
  const degraded = pageLeft === null;
  const hostRef = useRef(null);

  const close = () => cosmosOpenStore.set(false);

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
  /* 会话列表面板展开态（add-cosmos-session-list-panel 3.3）：settings 持久化偏好的只读
     镜像；写者唯一 = `setSessionPanelOpen`（标题栏开合按钮 / Esc 层同通道）。 */
  const sessionPanelState = useSyncExternalStore(
    cosmosSessionPanelStore.subscribe,
    cosmosSessionPanelStore.getSnapshot
  );
  const sessionPanelOpen = sessionPanelState.open === true;
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
    setSessionPanelOpen(!sessionPanelOpenOf());
  };
  const focusSessionRow = (row) => {
    if (!row) return;
    controllerRef.current?.focusSession?.({ wsId: row.wsId, id: row.id });
  };
  const openSessionRow = (row) => {
    if (!row) return;
    controllerRef.current?.actions?.openSession?.(row.id);
  };
  const archiveSessionRow = (row) => {
    if (!row) return undefined;
    return controllerRef.current?.actions?.archiveSession?.(row.id);
  };

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

  /* 引擎挂载：页开即建，页关即毁（Canvas 尺寸随 overlay 容器）。 */
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller || !hostRef.current) return undefined;
    controller.attach(hostRef.current);
    return () => controller.detach();
  }, []);

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

  /* 页签可见性 → 渲染循环启停（4.6）。 */
  useEffect(() => {
    const onVisibility = () => controllerRef.current?.setVisible(!document.hidden);
    const onBlur = () => controllerRef.current?.setVisible(false);
    const onFocus = () => controllerRef.current?.setVisible(true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  /* Esc 分层（5.3，外壳单点 keydown；add-cosmos-search-filter 3.3 插入清空搜索层；
     add-cosmos-session-list-panel 3.4 插入收起会话面板层）：
     钻取返回/清选中 > 清空搜索 > 收起会话面板（展开态时） > 退全屏 > 关整页。
     引擎自带的 window keydown（demo）已收编——随 overlay 卸载自动移除。
     清空层读查询 MUST 经 ref（effect 依赖不含 query，防陈旧闭包与监听重绑）；
     面板展开态读模块 store（同一理由：不把 open 放进依赖重绑监听）。 */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      const controller = controllerRef.current;
      const engine = controller?.getEngine?.();
      if (engine?.consumeEscape?.()) return;
      if (queryRef.current.trim()) {
        applyQuery("");
        return;
      }
      /* 收起会话面板层：仅展开态消费（折叠态跳过，语义回到既有分层）；
         与标题栏开合按钮同一写者（含 settings 持久化）。 */
      if (sessionPanelOpenOf()) {
        setSessionPanelOpen(false);
        return;
      }
      if (fullscreen) {
        exitFullscreen();
        return;
      }
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen, exitFullscreen]);

  return (
    <div
      ref={frameRef}
      className="cos-page"
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
      style={{
        position: "absolute",
        top: 0,
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
        "--cos-toast-bottom": (actionsHeight > 0 ? actionsHeight + 32 : 24) + "px"
      }}
      data-plugin-anchor="dsh-v-cosmos:page"
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
      <ProposalPanel
        t={tr}
        model={panelModel}
        selectedKey={selectedKey}
        onSelect={selectProposal}
        drill={drill}
        /* 星座动作条（仅钻取态）：目标分组缺失（钻取目标注销）时传空列表 → footer 零布局。 */
        constButtons={drillGroup === null ? [] : constButtons}
        onRunConst={runConstAction}
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
              if (e.key !== "Escape") return;
              /* 聚焦态 Esc = 清空 + 失焦，MUST NOT 冒泡到外壳分层（关页/退全屏）。 */
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
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 座位（sidebar.footer.action；wide 双形态，hive HiveSeat 同款排版）
 * ------------------------------------------------------------------ */

const COSMOS_ICON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="3.2" fill="currentColor"/><ellipse cx="12" cy="12" rx="10" ry="4.2" stroke="currentColor" stroke-width="1.6" transform="rotate(-24 12 12)"/><circle cx="20.2" cy="8.2" r="1.4" fill="currentColor"/></svg>';

function CosmosSeat({ wide, t }) {
  const open = useCosmosOpen();
  const toggle = () => cosmosOpenStore.set(!cosmosOpenStore.getSnapshot());
  if (wide) {
    return (
      <div className="cos-seat" data-active={open || undefined}>
        <button
          type="button"
          className="cos-seat-row"
          data-plugin-anchor="dsh-v-cosmos:seat"
          aria-expanded={open}
          onClick={toggle}
        >
          <span className="cos-seat-icon" dangerouslySetInnerHTML={{ __html: COSMOS_ICON_SVG }} />
          <span className="cos-seat-label">{t("cosmos.seat")}</span>
        </button>
      </div>
    );
  }
  return (
    <div className="cos-seat" data-active={open || undefined}>
      <button
        type="button"
        className="cos-seat-rail"
        data-plugin-anchor="dsh-v-cosmos:seat"
        aria-label={t("cosmos.seat.aria")}
        aria-expanded={open}
        title={t("cosmos.seat")}
        onClick={toggle}
        dangerouslySetInnerHTML={{ __html: COSMOS_ICON_SVG }}
      />
    </div>
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
${ENGINE_CSS}
/* ── 新增工作区按钮（add-cosmos-add-workspace 4.4；polish-cosmos-touch-nav 5.1 方形化）：
      左下角常驻，方形 icon-only（44×44，只留「＋」；触屏点击目标 ≥40px，语义经
      aria-label/title 保留），风格 D HUD 语言（暖金描边 + 角标）。
      add-cosmos-skin-themes 3.1：金色系字面量全部收敛为 var(--cos-*, 现值)（fallback =
      风格 D 现值，令牌缺失不裸奔）；令牌由整页根容器 applySkinTokens 单点下发。
      z 序高于引擎覆盖层（.cos-overlay z=10 / toast z=30）与搜索带（z=40）；钻取态不隐藏。 ── */
.cos-add-btn{position:absolute;left:16px;bottom:16px;z-index:45;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:0;
  width:44px;height:44px;padding:0;cursor:pointer;color:var(--cos-accent-ink,#ffe3b8);background:var(--cos-glass,rgba(8,8,16,.72));border:1px solid var(--cos-line,rgba(255,210,140,.35));
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
  width:min(320px,34vw);min-width:180px;padding:3px 6px 3px 10px;background:var(--cos-glass,rgba(8,8,16,.72));border:1px solid var(--cos-line,rgba(255,210,140,.35));pointer-events:auto}
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
/* ── 提案列表面板（add-cosmos-proposal-actions 3.2/3.6；swap-cosmos-panel-sides 2.3
      移至右缘）：右缘固定 187px（280px × 2/3，用户要求收窄 1/3），内容滚动区（原生滚动/
      文本选择）；银河态自页顶起，钻取态下移让位顶部中央星座标牌（polish-cosmos-drilled-
      hud：标牌由左上移居顶部中央，本规则保留为窄视口降级态（<520px 标牌限宽放宽、允许
      横向重叠）的纵向隔离带）；底部让位动作条，右下让位「回到银河」。
      与搜索框的避让：面板左缘 = 页宽 - 188px、搜索带右缘 = 50% + min(160px,17vw)，视口
      <~570px 开始相交（与左缘口径镜像对称，断点取值不变）→ 取 640px 为断点整体下移到
      搜索带之下（留 70px 余量）。 ── */
.dsh-cosmos-panel{position:absolute;right:0;top:12px;bottom:calc(var(--cos-actions-h,0px) + 72px);width:187px;z-index:42;
  box-sizing:border-box;display:flex;flex-direction:column;color:var(--cos-ink,#ffe9cf);background:var(--cos-panel-soft,rgba(8,8,16,.62));
  border:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .28);border-right:none;pointer-events:auto}
.dsh-cosmos-panel[data-drill=true]{top:64px}
@media (max-width:640px){.dsh-cosmos-panel{top:56px}.dsh-cosmos-panel[data-drill=true]{top:96px}}
.dsh-cosmos-panel::after{content:'';position:absolute;left:-1px;top:-1px;width:8px;height:8px;
  border-top:2px solid var(--cos-line-strong,#ffd28a);border-left:2px solid var(--cos-line-strong,#ffd28a);pointer-events:none}
.dsh-cosmos-panel-head{flex:none;display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .22)}
.dsh-cosmos-panel-title{flex:1;font-size:12px;letter-spacing:2px;color:var(--cos-accent-ink,#ffe3b8)}
.dsh-cosmos-panel-count{font-size:11px;opacity:.6}
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
.dsh-cosmos-sessions{position:absolute;left:0;top:12px;bottom:calc(var(--cos-actions-h,0px) + 72px);width:260px;z-index:42;
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
/* ── 星座动作条（add-cosmos-constellation-actions 3.1；swap-cosmos-panel-sides 2.4 角标
      随面板镜像到左下）：面板 footer、钻取态专属。
      等宽按钮（flex-basis 0、按行均分）+ 超出面板宽度自动换行；触屏点击目标 ≥40px；
      配色优先官方 --dsw-alias-* token（主题切换自动跟随），token 缺席时回落风格 D
      基线（暖金 #ffe3b8 / rgba(255,210,140,…)），角标装饰沿用 HUD 语言。 ── */
.dsh-cosmos-const-actions{position:relative;flex:none;box-sizing:border-box;display:flex;flex-wrap:wrap;gap:5px;
  padding:6px 8px;border-top:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .28);background:var(--cos-card-bg,rgba(10,10,20,.55))}
.dsh-cosmos-const-actions::after{content:'';position:absolute;left:-1px;bottom:-1px;width:8px;height:8px;
  border-bottom:2px solid var(--cos-line-strong,#ffd28a);border-left:2px solid var(--cos-line-strong,#ffd28a);pointer-events:none}
.dsh-cosmos-const-action{flex:1 1 0;box-sizing:border-box;min-width:0;min-height:40px;padding:4px 6px;
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
.dsh-cosmos-const-float-card{position:relative;z-index:1;box-sizing:border-box;display:flex;flex-direction:column;gap:8px;
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
.dsh-cosmos-const-float-model{display:flex;align-items:center;gap:8px;min-width:0;font-size:12px;line-height:16px;
  color:var(--dsw-alias-label-tertiary,var(--cos-ink-dim,#cbb89a))}
.dsh-cosmos-const-float-model-cap{flex:none;opacity:.75}
.dsh-cosmos-const-float-model-select,.dsh-cosmos-const-float-effort-select{flex:none;min-width:0;max-width:220px;box-sizing:border-box;
  min-height:28px;padding:2px 6px;font:inherit;font-size:12px;border-radius:6px;outline:none;
  color:var(--dsw-alias-label-primary,var(--cos-ink,#ffe9cf));
  background:var(--dsw-alias-bg-base,var(--cos-panel-strong,rgba(10,10,20,.9)));
  border:1px solid var(--dsw-alias-border-l2,var(--cos-line,rgba(255,210,140,.35)))}
.dsh-cosmos-const-float-model-select:focus,.dsh-cosmos-const-float-effort-select:focus{border-color:var(--dsw-alias-border-inverted,rgb(var(--cos-accent-rgb,255 210 140) / .85))}
.dsh-cosmos-const-float-model[data-state=switching] .dsh-cosmos-const-float-model-select,
.dsh-cosmos-const-float-model[data-state=switching] .dsh-cosmos-const-float-effort-select{opacity:.6}
.dsh-cosmos-const-float-model[data-state=failed] .dsh-cosmos-const-float-model-select,
.dsh-cosmos-const-float-model[data-state=failed] .dsh-cosmos-const-float-effort-select{border-color:var(--dsw-alias-state-error-primary,#ff9f9f)}
.dsh-cosmos-const-float-model-note{flex:none;font-size:11px;opacity:.7}
.dsh-cosmos-const-float-input{box-sizing:border-box;width:100%;min-height:96px;resize:vertical;padding:8px 10px;border-radius:8px;
  font:inherit;font-size:13px;line-height:20px;outline:none;color:var(--dsw-alias-label-primary,var(--cos-ink,#ffe9cf));
  background:var(--dsw-alias-bg-base,var(--cos-panel-strong,rgba(10,10,20,.9)));border:1px solid var(--dsw-alias-border-l2,var(--cos-line,rgba(255,210,140,.35)))}
.dsh-cosmos-const-float-input:focus{border-color:var(--dsw-alias-border-inverted,rgb(var(--cos-accent-rgb,255 210 140) / .85))}
.dsh-cosmos-const-float-input::placeholder{color:var(--dsw-alias-label-dimmed,rgb(var(--cos-accent-ink-rgb,255 227 184) / .45))}
.dsh-cosmos-const-float-foot{display:flex;align-items:center;gap:10px}
.dsh-cosmos-const-float-voice{flex:none;box-sizing:border-box;min-width:64px;min-height:40px;padding:8px 12px;cursor:pointer;
  font:inherit;font-size:13px;border-radius:8px;color:var(--dsw-alias-label-primary,var(--cos-ink,#ffe9cf));
  background:transparent;border:1px solid var(--dsw-alias-border-l2,var(--cos-line,rgba(255,210,140,.4)))}
.dsh-cosmos-const-float-voice:hover{background:var(--dsw-alias-interactive-bg-hover,rgb(var(--cos-accent-rgb,255 210 140) / .14))}
.dsh-cosmos-const-float-voice[data-state=recording]{color:#fff;border-color:var(--dsw-alias-state-error-primary,#ff9f9f);
  background:var(--dsw-alias-state-error-primary,rgba(255,120,120,.35))}
.dsh-cosmos-const-float-voice[data-state=transcribing]{opacity:.6;cursor:default}
.dsh-cosmos-const-float-voice:focus-visible{outline:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .85);outline-offset:2px}
.dsh-cosmos-const-float-hint{flex:1;min-width:0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#cbb89a)}
.dsh-cosmos-const-float-send{flex:none;box-sizing:border-box;min-width:84px;min-height:40px;padding:8px 16px;cursor:pointer;
  font:inherit;font-size:13px;border-radius:8px;border:1px solid transparent;color:#fff;
  background:var(--dsw-alias-state-business-primary,#c8963e)}
.dsh-cosmos-const-float-send:hover{filter:brightness(1.08)}
.dsh-cosmos-const-float-send:focus-visible,.dsh-cosmos-const-float-close:focus-visible{outline:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .85);outline-offset:2px}
/* ── 动作按钮条（4.1）：正下方居中、一行 8 个等宽、自动换行（≤4 行）；左右安全边距
      避开左下「＋」与右下「回到银河」；触屏目标 ≥40px。滚轮缩放由页面 ref 转发。 ── */
.dsh-cosmos-actions{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);z-index:43;box-sizing:border-box;
  display:grid;grid-template-columns:repeat(var(--cos-cols,8),minmax(0,1fr));gap:6px;
  width:min(calc(100% - 152px),calc((var(--cos-cols,8)) * 112px + (var(--cos-cols,8) - 1) * 6px));
  padding:6px 8px;background:var(--cos-panel-soft,rgba(8,8,16,.62));border:1px solid rgb(var(--cos-accent-rgb,255 210 140) / .28);pointer-events:auto}
.dsh-cosmos-actions::before{content:'';position:absolute;left:-1px;bottom:-1px;width:8px;height:8px;
  border-bottom:2px solid var(--cos-line-strong,#ffd28a);border-left:2px solid var(--cos-line-strong,#ffd28a);pointer-events:none}
.dsh-cosmos-action{box-sizing:border-box;min-height:40px;padding:6px 8px;display:flex;align-items:center;justify-content:center;
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
[data-cos-mode="light"] .dsh-cosmos-session-row,
[data-cos-mode="light"] .dsh-cosmos-actions,
[data-cos-mode="light"] .dsh-cosmos-const-actions,
[data-cos-mode="light"] .cos-search,
[data-cos-mode="light"] .cos-add-btn,
[data-cos-mode="light"] .cos-home-btn,
[data-cos-mode="light"] .cos-chip,
[data-cos-mode="light"] .cos-toast{box-shadow:var(--cos-shadow,none);text-shadow:none}
[data-cos-mode="light"] .cos-scanlines{display:none}
`;

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
  const buttonSettings = createButtonSettingsController(activeScope);
  const constButtonSettings = createButtonSettingsController(activeScope, CONSTELLATION_PROFILE);

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
     "remote.speech"）；缺席（未启用）→ face.available=false，浮窗语音钮隐藏，零降级噪音。
     转写调用 = `speech.transcribe({ audioBase64 })` → `{ text }`；录音格式与官方 UI 同构
     （浏览器默认 MediaRecorder 容器 base64——官方 `createRecording` 即此做法）。
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

  /* 设置作用域生命周期（与插件 fiber 同寿命）。 */
  ctx.effect(() => () => {
    offButtons?.();
    offConstButtons?.();
    buttonSettings.dispose();
    constButtonSettings.dispose();
    buttonsStore.dispose();
    constButtonsStore.dispose();
    activeScope.dispose();
    cosmosButtonsFace.set({ buttons: [] });
    cosmosConstButtonsFace.set({ constellationButtons: [] });
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

  /* 2. Cosmos 整页（shell.overlay，order 45——Hive(40) 之后）。 */
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

  /* 3. 设置页「Cosmos」节 + 「快捷动作」标签页（add-cosmos-proposal-actions 5.x；
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
  ctx.slots.inject(SETTINGS_TAB_SLOT, () =>
    ctx.slots.register(
      {
        name: SETTINGS_TAB_SLOT,
        id: "actions",
        order: 0,
        label: () => sectionT("cosmos.settings.tabActions"),
        locale: NS,
        inject: () => ({ face: buttonSettings, models: modelsFace })
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
        inject: () => ({ face: constButtonSettings, models: modelsFace, variant: "constellation", preflight: preflightFace })
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
        label: () => sectionT("cosmos.settings.tabNav"),
        locale: NS,
        inject: () => ({ nav: navFace, selectHealth: selectHealthFace })
      },
      CosmosNavPanel
    )
  );

  /* 4. hero 接力消费条目（add-cosmos-proposal-actions 4.4/4.5）：`conversation.input.dock`
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

  /* 5. 星座浮窗输入器（add-cosmos-constellation-actions 4.1）：同一插槽的第二条目，
     与 hero 条目共用挂点但**消费各自的标记通道**（双 store 隔离，互不误食）。 */
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
          notify: (text, isError) => showCosmosToast(text, isError)
        })
      },
      ConstellationFloatDock
    )
  );

  /* 6. 星胚动作消费条目（add-cosmos-action-prestate-gate 3.3）：同一插槽的第三条目，
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
export { cosmosOpenStore, sceneVersionStore, filterStore, drillStore, engineSelectStore, cosmosButtonsFace, cosmosConstButtonsFace, cosmosSkinStore, cosmosNavStore, cosmosSessionPanelStore, cosmosSelectHealthOf, COSMOS_SKINS, COSMOS_SKIN_IDS, COSMOS_DEFAULT_SKIN, createSkin, applySkinTokens, mergeScene, sceneDiffLevel, planetStateOf, relativeTime, matchWorkspaces, filteredPositions, findRegisteredWorkspace, normalizeWorkspacePath, isWindowsPlatform, isEmptyConstellation, projectPanel, projectSessionPanel, sessionKeyOf, findCard, proposalKeyOf, assembleMessage, assembleEmbryoMessage, actionButtonVisible, draftMatches, isBlankDraft, pendingReadinessOf, createActionGate, createPendingActionStore, createActionExecutor, createEmbryoActionExecutor, consumePendingAction, explorationTargetOf, createModelBridge, ProposalPanel, SessionPanel, ActionBar, ConstActionBar, ActionHeroDock, ConstellationFloatDock, EmbryoActionDock, CosmosSettingsSection, CosmosActionsPanel, CosmosSkinPanel, CosmosNavPanel, SKIN_D_PALETTE, createSkinD, createCosmosEngine, isUiChromeTarget, fetchScene, subscribeCosmosEvents, loadCosmosSettings, saveCosmosSettings, COSMOS_SETTINGS_DEFAULTS, COSMOS_SETTINGS_BOUNDS, PENDING_DIVE_WAIT_MS, normalizeConstButtons, constButtonsSectionOf, constellationMessageOf, createFloatMarkerStore, createConstellationExecutor, floatPresentationOf, createButtonSettingsController, constButtonDraftOf, constButtonIssue, CONSTELLATION_PROFILE, isSessionArchiveOutcome, activitySummaryOf, archiveNoticeOf, archiveRequestFailureNotice };

/* 文案（zh/en 成对；引擎内嵌中文提示为 demo 语言的既定呈现）。 */
const DICT = {
  zh: {
    "cosmos.seat": "Cosmos",
    "cosmos.seat.aria": "打开 Cosmos 星系视图",
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
    "cosmos.constActions.aria": "星座动作",
    "cosmos.constFloat.title": "星座动作",
    "cosmos.constFloat.inputAria": "消息内容",
    "cosmos.constFloat.placeholder": "补写或修改消息，发送后进入当前星座工作区的会话…",
    "cosmos.constFloat.send": "发送",
    "cosmos.constFloat.close": "关闭",
    "cosmos.constFloat.hint": "Enter 发送 · Shift+Enter 换行 · 发送后浮窗关闭；关闭或 Esc 保留草稿不发送。",
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
    "cosmos.settings.nav": "Cosmos",
    "cosmos.settings.tabActions": "快捷动作",
    "cosmos.settings.tabConstActions": "星座动作",
    "cosmos.settings.tabSkins": "皮肤",
    "cosmos.settings.tabNav": "导航",
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
    "cosmos.settings.navHint": "缩放即导航：银河态放大到阈值自动进入星座视图，钻取态缩小到阈值自动返回。两项阈值改动即时生效并持久化，下次打开保持。",
    "cosmos.settings.navDiveLabel": "进入星座视图",
    "cosmos.settings.navDiveAria": "进入星座视图阈值（百分比）",
    "cosmos.settings.navDiveHint": "星座放大到钻取参考尺寸的 X% 时自动进入（界 60–140，越小越早触发）。",
    "cosmos.settings.navFlyOutLabel": "返回银河视图",
    "cosmos.settings.navFlyOutAria": "返回银河视图阈值（百分比）",
    "cosmos.settings.navFlyOutHint": "星座缩小到屏幕短边的 X% 时自动返回（界 10–50，默认约 1/4）。",
    "cosmos.settings.navFocusLabel": "指针聚焦缩放",
    "cosmos.settings.navFocusAria": "指针聚焦缩放开关",
    "cosmos.settings.navFocusHint": "缩放以指针位置为焦点逐步聚焦（关闭后回落屏幕中心缩放）。",
    "cosmos.settings.navInstant": "改动立即生效并保存",
    "cosmos.settings.skinUnavailable": "皮肤选择暂不可用：插件整页未就绪（刷新页面后重试）。",
    "cosmos.settings.navUnavailable": "导航设置暂不可用：插件整页未就绪（刷新页面后重试）。",
    "cosmos.settings.skinNotApplied": "皮肤选择未生效：插件整页控制器缺失，请重试或刷新页面后重新选择。",
    "cosmos.settings.navNotApplied": "导航设置未生效：插件整页控制器缺失，请重试或刷新页面后重新调整。",
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
    "cosmos.constActions.aria": "Constellation actions",
    "cosmos.constFloat.title": "Constellation action",
    "cosmos.constFloat.inputAria": "Message",
    "cosmos.constFloat.placeholder": "Extend or edit the message; sending starts the session in the current constellation's workspace…",
    "cosmos.constFloat.send": "Send",
    "cosmos.constFloat.close": "Close",
    "cosmos.constFloat.hint": "Enter sends · Shift+Enter starts a new line · The composer closes after sending; closing or Esc keeps the draft unsent.",
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
    "cosmos.settings.nav": "Cosmos",
    "cosmos.settings.tabActions": "Quick actions",
    "cosmos.settings.tabConstActions": "Constellation actions",
    "cosmos.settings.tabSkins": "Skins",
    "cosmos.settings.tabNav": "Navigation",
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
    "cosmos.settings.navHint": "Zoom is navigation: in the galaxy view, zooming in past the threshold dives into the nearest constellation; when drilled, zooming out past the threshold flies back. Both thresholds apply instantly and persist for next time.",
    "cosmos.settings.navDiveLabel": "Dive into constellation",
    "cosmos.settings.navDiveAria": "Dive threshold (percent)",
    "cosmos.settings.navDiveHint": "Dive automatically when the constellation reaches X% of the drill reference size (range 60–140; lower triggers earlier).",
    "cosmos.settings.navFlyOutLabel": "Return to galaxy",
    "cosmos.settings.navFlyOutAria": "Return threshold (percent)",
    "cosmos.settings.navFlyOutHint": "Fly back when the constellation shrinks below X% of the screen's short edge (range 10–50; default about 1/4).",
    "cosmos.settings.navFocusLabel": "Pointer-focused zoom",
    "cosmos.settings.navFocusAria": "Pointer-focused zoom toggle",
    "cosmos.settings.navFocusHint": "Zoom gradually focuses on the pointer position (turn off to zoom around the screen center).",
    "cosmos.settings.navInstant": "Applies and saves immediately",
    "cosmos.settings.skinUnavailable": "Skin selection is unavailable: the plugin page is not ready (reload the page and retry).",
    "cosmos.settings.navUnavailable": "Navigation settings are unavailable: the plugin page is not ready (reload the page and retry).",
    "cosmos.settings.skinNotApplied": "Skin selection did not apply: the plugin page controller is missing. Retry, or reload the page and select again.",
    "cosmos.settings.navNotApplied": "Navigation change did not apply: the plugin page controller is missing. Retry, or reload the page and adjust again.",
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
