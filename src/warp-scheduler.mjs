/**
 * dsh-v-cosmos — 曲率引擎状态机（two-add-cosmos-proposal-warp 3.1–3.6 / design D2–D8）。
 *
 * 纯状态机 + 注入面（零框架依赖；门控/投递/转投/展开/冷读全部由调用方注入，冒烟可直测）：
 *
 * ```
 *  grayed ──(复查：门控匹配)──► ready ──(直航)──► launching ──► executing ——(任务完整结束)──► 出队
 *                                   │                              │
 *                                   ├─(rule=queue)─► 转入脉冲队列队尾 → **立即出队**（转投即完成）
 *                                   ├─(执行时刻复验不过)──► skipped（残留）
 *                                   └─(投递失败)──────────► failed（残留，不暂停、不回落前台）
 * ```
 *
 * 核心不变量（design D2/D3/D6）：
 *  - **复查唯一触发沿 = 与目标相关的动作任务完整结束**（活跃→沉默 ∧ 无待决策）——由调用方
 *    `onTaskSettled` / 条目完成收尾喂入；提案状态翻转本身 MUST NOT 触发复查。骨架扫描
 *    变更只作**载体重查**（`onScanChanged`）：仅重查已打开过触发沿的目标，不点火新目标。
 *  - **同提案串行**由 preState 单调链天然保证；**跨目标并行**受每星座并发上限
 *    （`WARP_CONCURRENCY_LIMIT = 3`）约束，只计 `launching + executing`。
 *  - **暂停只挡点火**：复查与点亮照常，`ready` 保持待发（含转投形态）；在途条目不干预。
 *  - **转投即完成**：`rule: "queue"` 转投落定（含脉冲侧重复拒绝）即移出曲率条目，曲率侧
 *    零跟踪；脉冲在途满 → 保持 ready 下轮重试；复验不过 → skipped。
 *  - **proto 安静投递**：星胚目标的 proto 条目执行前要求探索会话活动计数归零；否则保持
 *    ready「等待会话空闲」子态（呈现子态由 `activityOf` 派生，不落枚举）。
 *  - **完成判定**（与脉冲同口径）：投递成功 → 见过 running → running=false ∧ 无 pendingInteraction
 *    → 出队 + 触发目标复查（星胚 proto 收尾先展开）。首忙窗内从未 running → failed。
 *
 * 事件面（宿主 agent 作用域）由调用方（index.mjs）转发：`onAgentStatus` /
 * `onInteractionExit`（`interactionEnter` 只进共享会话态缓存、曲率无需接收：`waiting`
 * 从共享读面取）。事件先于投递返回到达也安全：读取注入的共享会话态缓存回填。
 */

/** 每星座曲率并发上限（design D6：对齐引擎 fx 队列 P1 前例；实施期可调常量）。 */
export const WARP_CONCURRENCY_LIMIT = 3;
/** 首忙等待窗（与脉冲同值：投递成功后窗内从未进入 running → 投递异常 failed）。 */
export const WARP_FIRST_BUSY_WINDOW_MS = 5 * 60 * 1000;
/** 重启冷读失败后的重试间隔。 */
export const WARP_COLD_RETRY_MS = 15_000;
/** 冷读不可用的总尝试次数（≈5 分钟；耗尽 → 显式 failed，避免 executing 永久锁定）。 */
export const WARP_COLD_READ_MAX_ATTEMPTS = 20;

/**
 * 建立曲率调度器。
 *
 * @param {object} options
 * @param {object} options.store 曲率存储句柄（warp-store.mjs `createWarpStore`）
 * @param {(entry: object) => {ok: boolean, reason?: string}} options.gate
 *        门控复查（**同步**；与动作条渲染同一谓词 + 磁盘重扫；proto 目标只核目标存在，
 *        不核会话空闲——空闲门在点火时刻另行复验）
 * @param {(entry: object) => Promise<{ok: true, sessionId: string} |
 *        {ok: false, reason: string, message?: string}>} options.deliver 点火投递器
 * @param {(entry: object) => Promise<{ok: true, duplicate?: boolean} |
 *        {ok: false, reason: string, message?: string}>} options.transfer
 *        转入脉冲队列（服务端进程内直调 enqueue；`limit/busy` 表示脉冲在途满 → 保持待发）
 * @param {(entry: object) => Promise<{targets?: Array<{wsId: string, targetKey: string}>} | null>} options.expand
 *        星胚展开（proto 收尾时调用；返回新展开的提案目标清单）
 * @param {(entry: object) => boolean} [options.explorerBusy] proto 安静门（探索会话活动计数 > 0）
 * @param {(sessionId: string) => Promise<{ok: true, running: boolean, waiting: boolean|number} |
 *        {ok: false, gone: true} | {ok: false, error: string}>} options.readSession 重启冷读
 * @param {(sessionId: string) => ({running: boolean, sawRunning: boolean, waiting: number}|null)} options.readSessionState
 *        共享会话态缓存读面（脉冲调度器 `sessionStateOf`；**唯一数据面**，不建第二份缓存）
 * @param {(sessionId: string) => boolean} [options.isArchived] 归档判定（缺省恒 false）
 * @param {() => void} [options.onChange] 曲率变更后的通知（index.mjs 广播 warp-changed）
 * @param {(message: string, isError?: boolean) => void} [options.notify] toast 面
 * @param {object|null} [options.logger]
 * @param {() => number} [options.now]
 * @param {Function} [options.setTimeout]
 * @param {Function} [options.clearTimeout]
 * @param {number} [options.concurrencyLimit]
 * @param {number} [options.firstBusyWindowMs]
 * @param {number} [options.coldRetryMs]
 * @param {number} [options.coldReadMaxAttempts]
 * @returns {object} 调度器句柄
 */
export function createWarpScheduler(options = {}) {
  const store = options.store;
  const gate = typeof options.gate === "function" ? options.gate : () => ({ ok: true });
  const deliver = options.deliver;
  const transfer = options.transfer;
  const expand = typeof options.expand === "function" ? options.expand : async () => null;
  const explorerBusy = typeof options.explorerBusy === "function" ? options.explorerBusy : () => false;
  const readSession = options.readSession;
  const readSessionState = typeof options.readSessionState === "function"
    ? options.readSessionState
    : () => null;
  const isArchived = typeof options.isArchived === "function" ? options.isArchived : () => false;
  const onChange = typeof options.onChange === "function" ? options.onChange : () => {};
  const notify = typeof options.notify === "function" ? options.notify : () => {};
  const logger = options.logger ?? null;
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const setTimer = typeof options.setTimeout === "function" ? options.setTimeout : setTimeout;
  const clearTimer = typeof options.clearTimeout === "function" ? options.clearTimeout : clearTimeout;
  const concurrencyLimit = Number.isInteger(options.concurrencyLimit) && options.concurrencyLimit > 0
    ? options.concurrencyLimit
    : WARP_CONCURRENCY_LIMIT;
  const firstBusyWindowMs = Number.isFinite(options.firstBusyWindowMs)
    ? options.firstBusyWindowMs
    : WARP_FIRST_BUSY_WINDOW_MS;
  const coldRetryMs = Number.isFinite(options.coldRetryMs) ? options.coldRetryMs : WARP_COLD_RETRY_MS;
  const coldReadMaxAttempts = Number.isInteger(options.coldReadMaxAttempts) && options.coldReadMaxAttempts > 0
    ? options.coldReadMaxAttempts
    : WARP_COLD_READ_MAX_ATTEMPTS;

  /** entryId → 运行态（投递后建立；出队/失败时销毁）。 */
  const runtimes = new Map();
  /** sessionId → entryId（激活中的绑定）。 */
  const boundEntries = new Map();
  /** 已打开过触发沿的目标（`wsId\0targetKey`）：骨架扫描变更只重查这些目标。 */
  const openedTargets = new Set();
  /** 正在转投的条目（异步防重，避免同一 ready 条目并发转投两次）。 */
  const transferring = new Set();
  /** 已销毁标记（stop 后不再推进）。 */
  let disposed = false;

  const warn = (message) => {
    try {
      logger?.warn?.("[dsh-v-cosmos] %s", message);
    } catch {
      /* ignore */
    }
  };

  const armTimer = (fn, ms) => {
    const timer = setTimer(fn, ms);
    try {
      timer?.unref?.();
    } catch {
      /* 测试桩定时器无 unref */
    }
    return timer;
  };

  const cancelTimer = (timer) => {
    if (timer === null || timer === undefined) return;
    try {
      clearTimer(timer);
    } catch {
      /* ignore */
    }
  };

  const keyOf = (wsId, targetKey) => String(wsId) + "\u0000" + String(targetKey);
  const inflightCount = (wsId) => store.counts(wsId).inflight;
  const sharedStateOf = (sessionId) => (typeof sessionId === "string" && sessionId ? readSessionState(sessionId) : null);
  const waitingOf = (state) => (Number.isFinite(state?.waiting) ? state.waiting : state?.waiting === true ? 1 : 0);

  /* ── 运行态/绑定 ── */

  const runtimeOf = (entryId) => runtimes.get(entryId) ?? null;

  const clearRuntime = (entryId) => {
    const runtime = runtimes.get(entryId);
    if (runtime === undefined) return;
    cancelTimer(runtime.busyTimer);
    cancelTimer(runtime.retryTimer);
    if (typeof runtime.sessionId === "string" && boundEntries.get(runtime.sessionId) === entryId) {
      boundEntries.delete(runtime.sessionId);
    }
    runtimes.delete(entryId);
  };

  const finishEntry = (wsId, entryId, patch) => {
    clearRuntime(entryId);
    const result = store.patch({ wsId, entryId, patch, now: now() });
    onChange();
    return result;
  };

  /**
   * 绑定运行态（投递成功 / 冷读恢复）：回填投递 await 期间已到达的会话事件。
   * @param {object} entry 已含 sessionId 的条目
   */
  const bindRuntime = (wsId, entry) => {
    const sessionId = typeof entry.sessionId === "string" ? entry.sessionId : "";
    if (!sessionId) return;
    clearRuntime(entry.id);
    const shared = sharedStateOf(sessionId);
    const isEmbryo = entry.targetKind === "embryo";
    /* 新建会话（proposal 直航）：共享缓存里的 sawRunning 可信（投递前不存在）；
       既有探索会话（proto）：只认当前 running（安静门保证投递时空闲，避免把此前用户
       回合的 sawRunning 当成我们的任务——design D4 完成归属局限）。 */
    const sawRunning = isEmbryo ? shared?.running === true : shared?.sawRunning === true;
    const runtime = {
      wsId,
      entryId: entry.id,
      sessionId,
      sawRunning,
      waiting: waitingOf(shared),
      busyTimer: null,
      retryTimer: null,
      coldAttempts: 0
    };
    runtimes.set(entry.id, runtime);
    boundEntries.set(sessionId, entry.id);
    if (runtime.sawRunning) {
      maybeComplete(wsId, entry);
      return;
    }
    runtime.busyTimer = armTimer(() => {
      runtime.busyTimer = null;
      if (disposed) return;
      const latest = store.find(wsId, entry.id);
      if (!latest || latest.state !== "executing") return;
      const cached = sharedStateOf(sessionId);
      if (cached !== null && cached.sawRunning === true) return;
      finishEntry(wsId, entry.id, {
        state: "failed",
        reason: "busy-timeout",
        message: `投递后 ${Math.round(firstBusyWindowMs / 60000)} 分钟内会话未进入运行态（投递异常）`
      });
      notify("曲率：投递异常（会话未进入运行态）", true);
      reviewTarget(wsId, latest.targetKey);
      schedule(wsId);
    }, firstBusyWindowMs);
  };

  /* ── 完成判定 ── */

  const maybeComplete = (wsId, entry) => {
    if (disposed) return;
    const runtime = runtimeOf(entry.id);
    if (runtime === null) return;
    if (runtime.sawRunning !== true) return;
    /* 共享会话态缓存是**唯一数据面**（脉冲调度器写、曲率只读）；冷读恢复的会话在首个
       事件到达前缓存可能尚无条目——此时以冷读记录（`runtime.waiting`）兜底。 */
    const state = sharedStateOf(runtime.sessionId);
    const running = state === null ? false : state.running === true;
    const waiting = state === null ? (Number.isFinite(runtime.waiting) ? runtime.waiting : 0) : waitingOf(state);
    runtime.waiting = waiting;
    if (running) return;
    if (waiting > 0) return;
    completeEntry(wsId, entry.id);
  };

  const completeEntry = (wsId, entryId) => {
    const entry = store.find(wsId, entryId);
    if (!entry) {
      clearRuntime(entryId);
      return;
    }
    const { targetKey, targetKind } = entry;
    clearRuntime(entryId);
    store.drop({ wsId, entryId });
    onChange();
    const settle = async () => {
      if (targetKind === "embryo") {
        try {
          const result = await expand(entry);
          for (const target of Array.isArray(result?.targets) ? result.targets : []) {
            if (target?.targetKey) reviewTarget(target.wsId ?? wsId, target.targetKey);
          }
        } catch (error) {
          warn(`星胚展开失败（不影响已完成条目）: ${String(error?.message || error)}`);
        }
      }
      reviewTarget(wsId, targetKey);
      schedule(wsId);
    };
    void settle();
  };

  /* ── 复查 ── */

  const verdictOf = (entry) => {
    try {
      const verdict = gate(entry);
      return verdict && typeof verdict === "object" ? verdict : { ok: true };
    } catch (error) {
      warn(`门控复查异常（按不匹配处理）: ${String(error?.message || error)}`);
      return { ok: false, reason: "gate-error" };
    }
  };

  /**
   * 目标复查：对全部 grayed 条目求值门控，匹配者点亮；随后尝试点火。
   * 触发沿由调用方喂入（任务完整结束 / 附着 / 重启对账 / 骨架补查）。
   * @param {string} wsId
   * @param {string} targetKey
   */
  const reviewTarget = (wsId, targetKey) => {
    if (disposed) return;
    const warp = store.warp(wsId);
    const grayed = warp.entries.filter(
      (entry) => entry.targetKey === targetKey && entry.state === "grayed"
    );
    openedTargets.add(keyOf(wsId, targetKey));
    let changed = false;
    for (const entry of grayed) {
      const verdict = verdictOf(entry);
      if (verdict.ok !== true) continue;
      store.patch({ wsId, entryId: entry.id, patch: { state: "ready" }, now: now() });
      changed = true;
    }
    if (changed) onChange();
    schedule(wsId);
  };

  const reviewAll = () => {
    const targets = store.targets();
    const wsIds = new Set();
    for (const target of targets) {
      wsIds.add(target.wsId);
      reviewTarget(target.wsId, target.targetKey);
    }
    for (const wsId of wsIds) schedule(wsId);
  };

  /* ── 点火 ── */

  const launch = async (wsId, entry) => {
    let verdict = verdictOf(entry);
    /* proto 安静投递门 + 目标/会话守卫（执行时刻复验，不是复查时刻）。 */
    if (entry.targetKind === "embryo") {
      if (typeof entry.explorerSessionId !== "string" || !entry.explorerSessionId) {
        finishEntry(wsId, entry.id, {
          state: "failed",
          reason: "explorer-session-missing",
          message: "探索会话不可用（锚点未记录会话）"
        });
        notify("曲率：探索会话不可用（锚点未记录会话）", true);
        reviewTarget(wsId, entry.targetKey);
        schedule(wsId);
        return;
      }
      if (isArchived(entry.explorerSessionId) === true) {
        finishEntry(wsId, entry.id, {
          state: "failed",
          reason: "session-archived",
          message: "探索会话已归档（宿主拒绝执行）"
        });
        notify("曲率：探索会话已归档", true);
        reviewTarget(wsId, entry.targetKey);
        schedule(wsId);
        return;
      }
      if (explorerBusy(entry) === true) {
        /* 会话仍被占用：退回 ready 待发（呈现「等待会话空闲」子态）；等下一触发沿。 */
        const current = store.find(wsId, entry.id);
        if (current && current.state === "launching") {
          store.patch({ wsId, entryId: entry.id, patch: { state: "ready" }, now: now() });
          onChange();
        }
        return;
      }
    }
    if (disposed) return;
    const current = store.find(wsId, entry.id);
    if (!current || current.state !== "launching") return;
    if (verdict.ok !== true) {
      finishEntry(wsId, entry.id, {
        state: "skipped",
        reason: typeof verdict.reason === "string" && verdict.reason ? verdict.reason : "prestate-drift",
        message: "前置状态已变化，已跳过该条目"
      });
      reviewTarget(wsId, current.targetKey);
      schedule(wsId);
      return;
    }
    let result;
    try {
      result = await deliver(current);
    } catch (error) {
      result = { ok: false, reason: "delivery-failed", message: String(error?.message || error) };
    }
    if (disposed) return;
    if (result?.ok === true && typeof result.sessionId === "string" && result.sessionId) {
      const executing = store.patch({
        wsId,
        entryId: entry.id,
        patch: { state: "executing", sessionId: result.sessionId },
        now: now()
      });
      if (executing?.ok !== true) return;
      bindRuntime(wsId, executing.entry);
      onChange();
      maybeComplete(wsId, executing.entry);
      return;
    }
    const reason = typeof result?.reason === "string" && result.reason ? result.reason : "delivery-failed";
    const message = typeof result?.message === "string" && result.message ? result.message : "无法投递（会话服务不可用）";
    finishEntry(wsId, entry.id, { state: "failed", reason, message });
    notify(`曲率：投递失败（${message}）`, true);
    reviewTarget(wsId, entry.targetKey);
    schedule(wsId);
  };

  /**
   * 转入脉冲队列（转投即完成）。
   */
  const transferEntry = async (wsId, entry) => {
    if (disposed) return;
    if (transferring.has(entry.id)) return;
    const current = store.find(wsId, entry.id);
    if (!current || current.state !== "ready") return;
    const verdict = verdictOf(current);
    if (verdict.ok !== true) {
      finishEntry(wsId, entry.id, {
        state: "skipped",
        reason: typeof verdict.reason === "string" && verdict.reason ? verdict.reason : "prestate-drift",
        message: "前置状态已变化，已跳过该条目（未转入脉冲队列）"
      });
      reviewTarget(wsId, current.targetKey);
      schedule(wsId);
      return;
    }
    if (transferring.has(entry.id)) return;
    transferring.add(entry.id);
    let result;
    try {
      result = await transfer(current);
    } catch (error) {
      result = { ok: false, reason: "delivery-failed", message: String(error?.message || error) };
    } finally {
      transferring.delete(entry.id);
    }
    if (disposed) return;
    const latest = store.find(wsId, entry.id);
    if (!latest) return; // 用户已移出
    if (result?.ok === true) {
      /* 转投落定（含脉冲侧重复拒绝）即视为完成：曲率侧零跟踪、立即移出。 */
      store.drop({ wsId, entryId: entry.id });
      onChange();
      schedule(wsId);
      return;
    }
    const reason = typeof result?.reason === "string" && result.reason ? result.reason : "delivery-failed";
    if (reason === "limit" || reason === "busy" || reason === "inflight-limit") {
      /* 脉冲在途已满：保持 ready 待发，下轮复查重试。 */
      return;
    }
    if (
      reason === "gate"
      || reason === "prestate-drift"
      || reason === "proposal/unknown"
      || reason === "workspace/unknown"
      || reason === "button/unknown"
    ) {
      finishEntry(wsId, entry.id, {
        state: "skipped",
        reason,
        message: "转投复验不过（提案已不在快照前置状态），未转入脉冲队列"
      });
      reviewTarget(wsId, latest.targetKey);
      schedule(wsId);
      return;
    }
    const message = typeof result?.message === "string" && result.message ? result.message : "转入脉冲队列失败";
    finishEntry(wsId, entry.id, { state: "failed", reason, message });
    notify(`曲率：转入脉冲队列失败（${message}）`, true);
    reviewTarget(wsId, latest.targetKey);
    schedule(wsId);
  };

  /**
   * 点火调度：按条目数组序（附着序 × 计划序）取 ready 条目——转投形态不计并发，
   * 直航形态占用并发额度（上限 3）；超限即停（保持顺序）。
   * @param {string} wsId
   */
  const schedule = (wsId) => {
    if (disposed) return;
    const warp = store.warp(wsId);
    if (warp.paused === true) return;
    for (const snapshotEntry of [...warp.entries]) {
      /* 每步重读条目（上一轮 claim 的 launching 必须对同会话串行判定可见）。 */
      const entry = store.find(wsId, snapshotEntry.id);
      if (!entry || entry.state !== "ready") continue;
      if (entry.rule === "queue") {
        void transferEntry(wsId, entry);
        continue;
      }
      if (entry.targetKind === "embryo") {
        /* 同探索会话的 proto 条目串行（plan 可含多条 proto 动作条）：一条在途时其余
           保持 ready——共享会话的活动信号无法区分两条并发投递的完成归属，串行是
           唯一能保持完成判定正确的形态。 */
        const sessionId = typeof entry.explorerSessionId === "string" ? entry.explorerSessionId : "";
        const sameSessionBusy = store.warp(wsId).entries.some(
          (other) => other.id !== entry.id
            && other.targetKind === "embryo"
            && other.explorerSessionId === sessionId
            && (other.state === "launching" || other.state === "executing")
        );
        if (sameSessionBusy) continue;
        if (explorerBusy(entry)) continue;
      }
      if (inflightCount(wsId) >= concurrencyLimit) return;
      const claimed = store.patch({ wsId, entryId: entry.id, patch: { state: "launching", startedAt: now() } });
      if (claimed?.ok !== true) continue;
      onChange();
      void launch(wsId, claimed.entry);
    }
  };

  /* ── 事件面 ── */

  /**
   * 宿主 `agent/status` 转发（与脉冲共用同一会话态缓存读面）。
   * @param {{sessionId?: string, status?: string}} input
   */
  const onAgentStatus = (input) => {
    const sessionId = typeof input?.sessionId === "string" ? input.sessionId : "";
    if (!sessionId) return;
    const entryId = boundEntries.get(sessionId);
    if (entryId === undefined) return;
    const runtime = runtimes.get(entryId);
    if (!runtime) return;
    const running = input?.status !== "idle";
    if (running) {
      runtime.sawRunning = true;
      cancelTimer(runtime.busyTimer);
      runtime.busyTimer = null;
      runtime.waiting = waitingOf(sharedStateOf(sessionId));
      return;
    }
    const entry = store.find(runtime.wsId, entryId);
    if (entry) maybeComplete(runtime.wsId, entry);
  };

  /** 交互瀑布退出沿（决策完成）：回合可能仍在跑，交给完成判定。 */
  const onInteractionExit = (sessionId) => {
    const entryId = boundEntries.get(typeof sessionId === "string" ? sessionId : "");
    if (entryId === undefined) return;
    const runtime = runtimes.get(entryId);
    if (!runtime) return;
    const entry = store.find(runtime.wsId, entryId);
    if (entry) maybeComplete(runtime.wsId, entry);
  };

  /**
   * 目标活动计数归零沿（index.mjs 按关联存储聚合后喂入）：
   * 与目标相关的动作任务完整结束 → 复查该目标。
   * @param {string} wsId
   * @param {string} targetKey
   */
  const onTaskSettled = (wsId, targetKey) => {
    if (typeof wsId !== "string" || !wsId || typeof targetKey !== "string" || !targetKey) return;
    reviewTarget(wsId, targetKey);
  };

  /**
   * 骨架扫描变更补查：仅重查**已有触发沿**且仍含 grayed 条目的目标（不引入状态变化
   * 主动点火——design D3 红线）。
   */
  const onScanChanged = () => {
    if (disposed) return;
    for (const key of [...openedTargets]) {
      const index = key.indexOf("\u0000");
      if (index < 0) continue;
      const wsId = key.slice(0, index);
      const targetKey = key.slice(index + 1);
      const warp = store.warp(wsId);
      const hasGrayed = warp.entries.some(
        (entry) => entry.targetKey === targetKey && entry.state === "grayed"
      );
      if (hasGrayed) reviewTarget(wsId, targetKey);
      else if (warp.entries.every((entry) => entry.targetKey !== targetKey)) openedTargets.delete(key);
    }
  };

  /* ── 重启对账 ── */

  const coldReconcileEntry = async (wsId, entry) => {
    if (entry.state === "launching") {
      finishEntry(wsId, entry.id, {
        state: "failed",
        reason: "restart-lost-launch",
        message: "服务端重启时投递未完成"
      });
      return;
    }
    const sessionId = typeof entry.sessionId === "string" ? entry.sessionId : "";
    if (!sessionId) {
      finishEntry(wsId, entry.id, {
        state: "failed",
        reason: "restart-lost-session",
        message: "执行中条目缺少会话 id"
      });
      return;
    }
    if (isArchived(sessionId) === true) {
      finishEntry(wsId, entry.id, { state: "failed", reason: "session-gone", message: "会话已归档" });
      return;
    }
    let read;
    try {
      read = await readSession(sessionId);
    } catch (error) {
      read = { ok: false, error: String(error?.message || error) };
    }
    if (disposed) return;
    if (read?.ok === true) {
      const running = read.running === true;
      const runtime = {
        wsId,
        entryId: entry.id,
        sessionId,
        sawRunning: true,
        waiting: waitingOf(read),
        busyTimer: null,
        retryTimer: null,
        coldAttempts: 0
      };
      runtimes.set(entry.id, runtime);
      boundEntries.set(sessionId, entry.id);
      /* 仍在 running → 续监视（等后续 agent/status 收尾）；已达终态 → 完成判定收敛。 */
      if (running) return;
      const latest = store.find(wsId, entry.id);
      if (latest) maybeComplete(wsId, latest);
      return;
    }
    if (read?.gone === true) {
      finishEntry(wsId, entry.id, { state: "failed", reason: "session-gone", message: "会话已不存在" });
      return;
    }
    const existing = runtimes.get(entry.id);
    const attempts = (existing?.coldAttempts ?? 0) + 1;
    if (attempts >= coldReadMaxAttempts) {
      finishEntry(wsId, entry.id, {
        state: "failed",
        reason: "cold-read-unavailable",
        message: `重启对账冷读连续 ${attempts} 次失败（会话服务不可达）`
      });
      return;
    }
    warn(`重启对账冷读失败（条目保持执行中，稍后重试）: ${String(read?.error || "unknown")}`);
    const runtime = existing ?? {
      wsId, entryId: entry.id, sessionId, sawRunning: false, waiting: 0, busyTimer: null, retryTimer: null, coldAttempts: 0
    };
    runtime.coldAttempts = attempts;
    runtimes.set(entry.id, runtime);
    boundEntries.set(sessionId, entry.id);
    runtime.retryTimer = armTimer(() => {
      runtime.retryTimer = null;
      const latest = store.find(wsId, entry.id);
      if (latest && latest.state === "executing") void coldReconcileEntry(wsId, latest);
    }, coldRetryMs);
  };

  /**
   * 启动：冷读对账全部在途条目（launching/executing），随后逐星座复查 + 点火。
   * @returns {Promise<void>}
   */
  const start = async () => {
    disposed = false;
    const tasks = [];
    for (const wsId of Object.keys(store.doc?.warps ?? {})) {
      for (const entry of store.warp(wsId).entries) {
        if (entry.state === "launching" || entry.state === "executing") {
          tasks.push(coldReconcileEntry(wsId, entry));
        }
      }
    }
    if (tasks.length > 0) {
      onChange();
      await Promise.all(tasks);
    }
    if (disposed) return;
    reviewAll();
  };

  /** 卸载：清定时器、停止推进（不触碰持久化状态）。 */
  const dispose = () => {
    disposed = true;
    for (const entryId of [...runtimes.keys()]) clearRuntime(entryId);
    boundEntries.clear();
    transferring.clear();
  };

  /**
   * 对外活动子态（公共快照投影用）：
   *  - executing → 共享会话态（running / waiting 计数）；
   *  - ready 的星胚 proto → 「等待会话空闲」标记（安静门仍占用）。
   * @param {string} wsId
   * @param {object} entry
   * @returns {object|null}
   */
  const activityOf = (wsId, entry) => {
    if (entry.state === "executing" && typeof entry.sessionId === "string") {
      const state = sharedStateOf(entry.sessionId);
      return state === null ? { running: false, waiting: 0 } : { running: state.running, waiting: waitingOf(state) };
    }
    if (entry.state === "ready" && entry.targetKind === "embryo" && entry.rule === "direct") {
      return explorerBusy(entry) === true ? { waitingSession: true } : null;
    }
    return null;
  };

  return {
    start,
    dispose,
    /** 目标复查（attach / resume / 外部触发沿共用入口）。 */
    reviewTarget,
    reviewAll,
    /** 点火调度（暂停恢复 / 变更后主动推进）。 */
    kick: (wsId) => schedule(wsId),
    onAgentStatus,
    onInteractionExit,
    onTaskSettled,
    onScanChanged,
    activityOf,
    get disposed() {
      return disposed;
    },
    /** 观察面（冒烟用）：条目运行态只读投影。 */
    runtimeOf: (entryId) => {
      const runtime = runtimes.get(entryId);
      return runtime === undefined
        ? null
        : {
          wsId: runtime.wsId,
          sessionId: runtime.sessionId,
          sawRunning: runtime.sawRunning,
          waiting: runtime.waiting,
          coldAttempts: runtime.coldAttempts
        };
    }
  };
}
