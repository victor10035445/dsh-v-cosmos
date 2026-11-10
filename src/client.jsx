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
 *  - Esc 分层（5.3，外壳单点 keydown）：引擎钻取返回 > 清空搜索 > 退全屏 > 关整页；
 *  - 「打开会话」（5.4）：先关整页，再经 ctx.uiWorkspace.openSession 切换右侧
 *    系统会话页（旧宿主回退 ctx.sessions.open）；
 *  - 新增工作区（add-cosmos-add-workspace 4.x）：左下角常驻「新增」按钮 →
 *    ctx.uiWorkspace.pickDirectory + ctx.workspaces.create（官方服务组合，与宿主
 *    「添加工作区」同源）→ 留在银河、引擎 dive-in 新星座（MUST NOT 打开会话/关整页）；
 *    取消静默、幂等重选 toast、失败 toast、busy 防重入；
 *  - 全部官方动词经注入服务使用，不修改任何官方包。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { fetchScene, subscribeCosmosEvents } from "./api.mjs";
import { mergeScene, sceneDiffLevel, planetStateOf, relativeTime, matchWorkspaces, filteredPositions, findRegisteredWorkspace, normalizeWorkspacePath, isWindowsPlatform } from "./merge.mjs";
import { createSkinD, SKIN_D_PALETTE } from "./cosmos/skin-d.mjs";
import { createCosmosEngine, ENGINE_CSS, FX_PRIORITY } from "./cosmos/engine.mjs";
import { cosmosStore } from "./store.mjs";
import { COSMOS_SETTINGS_BOUNDS, COSMOS_SETTINGS_DEFAULTS, loadCosmosSettings, saveCosmosSettings } from "./settings.mjs";

const PLUGIN_ID = "dsh-v-cosmos";
const NS = "dsh-v-cosmos";

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

function createCosmosController(ctx, notifyToast) {
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
     * 平移调参（后续设置 UI 消费面）：净房写入 localStorage + 引擎热更新
     * （部分写语义；整页开着时立即生效）。返回归一化后的完整设置。
     */
    saveTuning(patch) {
      const merged = saveCosmosSettings(patch);
      engine?.setTuning(merged);
      return merged;
    },
    getTuning() {
      return engine?.getTuning?.() ?? loadCosmosSettings();
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
    /* 事件动画差分（属性补丁/重建都检测；以 id 集合迁移与属性沿为准）。 */
    if (engine) {
      const prevSet = celestialIndex(prev);
      const nextSet = celestialIndex(next);
      const prevWsIds = new Set((prev?.workspaces ?? []).map((w) => w.id));
      const nextWsIds = new Set((next?.workspaces ?? []).map((w) => w.id));
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
                 MUST NOT 叠加 birth。 */
              engine.markCapture(info.id);
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
          if (from) engine.markRegression(info.id, from, { wsId: info.wsId });
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
          if (info.lifecycle === "proto") opts.intensity = 0.3;
          engine.markStarNova(info.id, info.worldPos, SKIN_D_PALETTE.prop[info.lifecycle] ?? "#ffffff", opts);
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
    actions,
    /** Esc 分层的引擎访问点（外壳单点 keydown 消费引擎钻取/选中层）。 */
    getEngine() {
      return engine;
    },
    attach(container) {
      if (engine || disposed || !container) return;
      engine = createCosmosEngine({
        container,
        style: createSkinD(),
        settings: loadCosmosSettings(), // 平移调参（settings.mjs 持久化面；后续设置 UI 经 saveCosmosSettings + setTuning 热更）
        onOpenSession: (sessionId) => actions.openSession(sessionId)
      });
      if (mergedScene) engine.setScene(mergedScene, "rebuild");
      if (filterQuery.trim()) syncFilter(); // 重挂载保持当前查询（引擎落位 + 坡道续接）
      refreshSkeleton(); // 挂载即拉一次（SSE 重连/首次打开双保险）
      if (open && visible) engine.start();
    },
    detach() {
      engine?.dispose();
      engine = null;
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
 * 整页组件
 * ------------------------------------------------------------------ */

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

  /* Esc 分层（5.3，外壳单点 keydown；add-cosmos-search-filter 3.3 插入清空搜索层）：
     钻取返回/清选中 > 清空搜索 > 退全屏 > 关整页。
     引擎自带的 window keydown（demo）已收编——随 overlay 卸载自动移除。
     清空层读查询 MUST 经 ref（effect 依赖不含 query，防陈旧闭包与监听重绑）。 */
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
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        left: degraded ? 0 : pageLeft,
        right: 0,
        overflow: "hidden",
        background: "#070812"
      }}
      data-plugin-anchor="dsh-v-cosmos:page"
    >
      <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />
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
      {showNoMatch ? (
        <div className="cos-search-empty" role="status">
          <b>✦</b>
          {tr("cosmos.search.empty", "无匹配工作区")}
        </div>
      ) : null}
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
      aria-label/title 保留），风格 D HUD 语言（暖金描边 + 角标；基线
      demo/styles/assets/style-d.js：#ffe3b8 主调 / rgba(255,210,140,…) 描边 /
      深底 rgba(8,8,16,.72)）。z 序高于引擎覆盖层（.cos-overlay z=10 / toast z=30）
      与搜索带（z=40）；钻取态不隐藏。 ── */
.cos-add-btn{position:absolute;left:16px;bottom:16px;z-index:45;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:0;
  width:44px;height:44px;padding:0;cursor:pointer;color:#ffe3b8;background:rgba(8,8,16,.72);border:1px solid rgba(255,210,140,.35);
  font-family:inherit;font-size:12px;letter-spacing:2px;line-height:1.2;pointer-events:auto}
.cos-add-btn::before,.cos-add-btn::after{content:'';position:absolute;width:8px;height:8px;pointer-events:none}
.cos-add-btn::before{top:-1px;left:-1px;border-top:2px solid #ffd28a;border-left:2px solid #ffd28a}
.cos-add-btn::after{bottom:-1px;right:-1px;border-bottom:2px solid #ffd28a;border-right:2px solid #ffd28a}
.cos-add-btn:hover:not(:disabled){border-color:rgba(255,210,140,.85);background:rgba(255,210,140,.12)}
.cos-add-btn:focus-visible{outline:1px solid rgba(255,210,140,.85);outline-offset:2px}
.cos-add-btn:disabled{opacity:.45;cursor:progress}
.cos-add-plus{font-size:18px;line-height:1;text-shadow:0 0 8px rgba(255,210,140,.55)}
/* ── 搜索过滤（add-cosmos-search-filter 3.5）：风格 D HUD 语言（暖金描边/角标；参数基线
      demo/styles/assets/style-d.js：主调 #ffe3b8 / 描边 rgba(255,210,140,…) / 深底 rgba(8,8,16,…)） ── */
.cos-search{position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:40;box-sizing:border-box;display:flex;align-items:center;gap:6px;
  width:min(320px,34vw);min-width:180px;padding:3px 6px 3px 10px;background:rgba(8,8,16,.72);border:1px solid rgba(255,210,140,.35);pointer-events:auto}
.cos-search::before,.cos-search::after{content:'';position:absolute;width:8px;height:8px;pointer-events:none}
.cos-search::before{top:-1px;left:-1px;border-top:2px solid #ffd28a;border-left:2px solid #ffd28a}
.cos-search::after{bottom:-1px;right:-1px;border-bottom:2px solid #ffd28a;border-right:2px solid #ffd28a}
.cos-search[data-focused]{border-color:rgba(255,210,140,.7);box-shadow:0 0 12px rgba(255,210,140,.14)}
.cos-search-input{flex:1 1 auto;min-width:0;background:none;border:none;outline:none;color:#ffe3b8;font-family:inherit;font-size:13px;letter-spacing:.5px;padding:3px 0}
.cos-search-input::placeholder{color:rgba(255,227,184,.38);letter-spacing:1px}
.cos-search-clear{flex:none;display:flex;align-items:center;justify-content:center;width:18px;height:18px;padding:0;cursor:pointer;
  background:none;border:1px solid rgba(255,210,140,.35);color:#ffe3b8;font-size:12px;line-height:1}
.cos-search-clear:hover{border-color:rgba(255,210,140,.85);background:rgba(255,210,140,.12)}
.cos-search-empty{position:absolute;top:44%;left:50%;transform:translate(-50%,-50%);z-index:22;pointer-events:none;text-align:center;
  font-size:13px;letter-spacing:2px;color:rgba(255,233,207,.55)}
.cos-search-empty b{display:block;font-size:16px;margin-bottom:8px;color:rgba(255,227,184,.8)}
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

/** 需要的服务：slots（注册）、locale（文案）、sessions/workspaces（官方镜像）、
 *  uiSession（统一会话状态快照，add-celestial-states 5.1）/ uiWorkspace（打开会话导航）。
 *  宿主 cordis 规则：ctx 属性 MUST 经 inject 声明方可访问（未声明访问抛
 *  "cannot get property X without inject"）——uiSession/uiWorkspace 均为 GUI 基础
 *  服务（dsh-client-ui-session / dsh-client-ui-workspace），声明后行星四态与
 *  「打开会话」可用；运行时另有记忆化安全解析兜底（D3 降级路径保留）。 */
export const inject = ["slots", "locale", "sessions", "workspaces", "uiSession", "uiWorkspace"];

export function apply(ctx) {
  installStyles(ctx);

  ctx.effect(() => ctx.locale.register(NS, DICT), "dsh-v-cosmos: dictionaries");
  const t = ctx.locale.bind(NS);

  /* 控制器：providers + 引擎生命周期（与插件 fiber 同寿命）。 */
  ctx.effect(() => {
    controllerRef.current = createCosmosController(ctx, (text) => controllerRef.current?.getEngine?.()?.toast?.(text));
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
}

/* 冒烟测试观测面（hive exports 先例）：只读镜像 + 纯函数引用，供 bundle 级冒烟
   直测导出面与推导口径；运行时行为不受影响。 */
export { cosmosOpenStore, sceneVersionStore, filterStore, mergeScene, sceneDiffLevel, planetStateOf, relativeTime, matchWorkspaces, filteredPositions, findRegisteredWorkspace, normalizeWorkspacePath, isWindowsPlatform, isEmptyConstellation, SKIN_D_PALETTE, createSkinD, createCosmosEngine, fetchScene, subscribeCosmosEvents, loadCosmosSettings, saveCosmosSettings, COSMOS_SETTINGS_DEFAULTS, COSMOS_SETTINGS_BOUNDS, PENDING_DIVE_WAIT_MS };

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
    "cosmos.search.empty": "无匹配工作区"
  },
  en: {
    "cosmos.seat": "Cosmos",
    "cosmos.seat.aria": "Open Cosmos galaxy view",
    "cosmos.add": "Add",
    "cosmos.add.aria": "Add workspace",
    "cosmos.search.placeholder": "Search workspaces…",
    "cosmos.search.aria": "Search workspaces",
    "cosmos.search.clear": "Clear search",
    "cosmos.search.empty": "No matching workspaces"
  }
};
