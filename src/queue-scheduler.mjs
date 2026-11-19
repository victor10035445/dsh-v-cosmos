/**
 * dsh-v-cosmos — 提案动作自动执行队列的调度器（add-cosmos-action-queue 3.1–3.3）。
 *
 * 纯状态机 + 注入面（零框架依赖；交付/冷读/复验/落盘全部由调用方注入，冒烟可直测）：
 *
 * ```
 *  queued ──► launching ──► executing(*running* ──► 等待决策*) ──► completed(出队)
 *                │                 │
 *                └─ failed         └─ failed(首忙超窗 / 会话消失)
 *  queued ──► skipped（执行时刻前置状态复验不过 → 继续下一条）
 * ```
 *
 * 关键语义（design D3/D5）：
 *  - **单飞**：任意时刻每队列至多一条在途；完成/失败/跳过后才考虑下一条。
 *  - **暂停只挡 advance**：`paused` 只影响「收尾后是否启动下一条」，绝不触碰在途条目。
 *  - **完成判定（状态口径）**：投递成功 → 首次 `running=true` → `running=false` 且无
 *    `pendingInteraction` 即完成并出队。会话出现交互（审批/计划审阅/提问）→「等待决策」
 *    子态挂起，队列不前进；用户在会话内决策、回合跑完（running=false ∧ 无待决策）→
 *    判定成立。
 *  - **首忙等待窗**（缺省 5 分钟）：投递成功后窗内从未进入 running → 「投递异常」failed
 *    + 队列暂停（可见可处理）。
 *  - **执行时刻复验**：启动前调用注入的 `reverify(entry)`（与动作条渲染门控同一谓词）；
 *    不过 → skipped + 继续下一条。
 *  - **投递失败**（会话服务不可用/命令调用失败）→ failed + 队列暂停；429 有界重试
 *    分支保留（进程内直投无限速，永不触发）。
 *  - **重启对账**：`start()` 时 launching（未取得 sessionId）→ failed；executing 冷读
 *    会话现状（注入 `readSession`）：running → 续监视；终态 → 完成收敛；会话消失/归档
 *    → failed 且**不暂停**、继续下一条。
 *
 * 事件面（宿主 agent 作用域）由调用方（index.mjs）转发：`onAgentStatus` /
 * `interactionEnter` / `interactionExit`。事件**先于**投递返回到达也安全：会话态先入
 * 有界缓存，条目取得 `sessionId` 时回填（避免「快回合在投递 await 期间跑完」被漏判）。
 */

/** 首忙等待窗（design D3 建议值 5 分钟）。 */
export const FIRST_BUSY_WINDOW_MS = 5 * 60 * 1000;
/** 限速重试上限（429 有界重试；进程内直投无限速，保留分支永不触发）。 */
export const MAX_RATE_RETRIES = 2;
/** 限速失败族（历史的 queen 429 码；进程内直投不产出，仅保留分支的触发键）。 */
const RATE_LIMIT_REASON = "queen-rate-limited";
/** 429 重试等待上限（毫秒）。 */
export const RATE_RETRY_CAP_MS = 10_000;
/** 会话态缓存上限（防长跑进程无界增长；超出按插入序淘汰）。 */
export const SESSION_CACHE_LIMIT = 512;
/** 冷读失败后的重试间隔。 */
export const COLD_RETRY_MS = 15_000;
/** 冷读不可用的总尝试次数（≈5 分钟；耗尽 → 显式 failed，避免 executing 永久锁定）。 */
export const COLD_READ_MAX_ATTEMPTS = 20;

/**
 * 建立调度器。
 *
 * @param {object} options
 * @param {object} options.store 队列存储句柄（queue-store.mjs `createQueueStore`）
 * @param {(entry: object) => Promise<{ok: true, sessionId: string} |
 *        {ok: false, reason: string, message?: string, retryAfterMs?: number}>} options.deliver
 *        投递器（进程内 sessionController 直投，见 session-executor.mjs）
 * @param {(sessionId: string) => Promise<{ok: true, running: boolean, waiting: boolean} |
 *        {ok: false, gone: true} | {ok: false, error: string}>} options.readSession 冷读
 * @param {(entry: object) => Promise<{ok: boolean, reason?: string}>} [options.reverify]
 *        执行时刻前置状态复验（缺省恒过）
 * @param {(sessionId: string) => boolean} [options.isArchived] 归档判定（缺省恒 false）
 * @param {() => void} [options.onChange] 队列变更后的通知（index.mjs 广播 queue-changed）
 * @param {(message: string, isError?: boolean) => void} [options.notify] toast 面
 * @param {object|null} [options.logger]
 * @param {() => number} [options.now]
 * @param {Function} [options.setTimeout]
 * @param {Function} [options.clearTimeout]
 * @param {number} [options.firstBusyWindowMs]
 * @param {number} [options.coldRetryMs]
 * @param {number} [options.maxRateRetries]
 * @returns {object} 调度器句柄
 */
export function createQueueScheduler(options = {}) {
  const store = options.store;
  const deliver = options.deliver;
  const readSession = options.readSession;
  const reverify = typeof options.reverify === "function" ? options.reverify : async () => ({ ok: true });
  const isArchived = typeof options.isArchived === "function" ? options.isArchived : () => false;
  const onChange = typeof options.onChange === "function" ? options.onChange : () => {};
  const notify = typeof options.notify === "function" ? options.notify : () => {};
  const logger = options.logger ?? null;
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const setTimer = typeof options.setTimeout === "function" ? options.setTimeout : setTimeout;
  const clearTimer = typeof options.clearTimeout === "function" ? options.clearTimeout : clearTimeout;
  const firstBusyWindowMs = Number.isFinite(options.firstBusyWindowMs) ? options.firstBusyWindowMs : FIRST_BUSY_WINDOW_MS;
  const coldRetryMs = Number.isFinite(options.coldRetryMs) ? options.coldRetryMs : COLD_RETRY_MS;
  const coldReadMaxAttempts = Number.isInteger(options.coldReadMaxAttempts) && options.coldReadMaxAttempts > 0
    ? options.coldReadMaxAttempts
    : COLD_READ_MAX_ATTEMPTS;
  const maxRateRetries = Number.isInteger(options.maxRateRetries) && options.maxRateRetries >= 0
    ? options.maxRateRetries
    : MAX_RATE_RETRIES;

  /** entryId → 运行态（投递后建立；出队/失败时销毁）。 */
  const runtimes = new Map();
  /** sessionId → 会话态缓存（`{running, sawRunning, waiting, updatedAt}`）。 */
  const sessionCache = new Map();
  /** sessionId → entryId（激活中的绑定）。 */
  const boundEntries = new Map();
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

  /* ── 会话态缓存 ── */

  const cacheOf = (sessionId) => {
    if (typeof sessionId !== "string" || !sessionId) return null;
    let state = sessionCache.get(sessionId);
    if (state === undefined) {
      state = { running: false, sawRunning: false, waiting: 0, updatedAt: now() };
      sessionCache.set(sessionId, state);
      if (sessionCache.size > SESSION_CACHE_LIMIT) {
        const oldest = sessionCache.keys().next();
        if (oldest.done !== true) sessionCache.delete(oldest.value);
      }
    }
    return state;
  };

  const writeCache = (sessionId, patch) => {
    const state = cacheOf(sessionId);
    if (state === null) return null;
    if (patch.running !== undefined) state.running = patch.running;
    if (patch.sawRunning === true) state.sawRunning = true;
    if (patch.waitingDelta !== undefined) {
      state.waiting = Math.max(0, state.waiting + patch.waitingDelta);
    }
    state.updatedAt = now();
    return state;
  };

  /** 对外活动信号（公开快照用）：只有 in-flight 条目才有子态。 */
  const activityOf = (wsId, entry) => {
    if (entry?.state !== "executing" || typeof entry.sessionId !== "string") return null;
    const state = sessionCache.get(entry.sessionId);
    if (state === undefined) return { running: false, waiting: 0 };
    return { running: state.running, waiting: state.waiting };
  };

  /* ── 收尾与推进 ── */

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

  const completeEntry = (wsId, entryId) => {
    clearRuntime(entryId);
    store.drop({ wsId, entryId });
    onChange();
  };

  /**
   * 完成判定（同一入口：status idle、交互退出、冷读收敛）。
   * 条件：已见过 running ∧ 当前非 running ∧ 无待决策。
   */
  const maybeComplete = (wsId, entry) => {
    if (disposed) return;
    const runtime = runtimeOf(entry.id);
    if (runtime === null) return;
    if (typeof runtime.sessionId !== "string") return;
    const state = sessionCache.get(runtime.sessionId);
    if (state === undefined || state.sawRunning !== true) return;
    if (state.running === true) return;
    if (state.waiting > 0) return;
    completeEntry(wsId, entry.id);
    advance(wsId);
  };

  /**
   * 推进一条队列：无在途且未暂停 → **同步**占位队首（queued→launching）后启动。
   * 先占位再 await 是单飞的关键：并发的 kick 不会再取到同一条目。
   * @param {string} wsId
   */
  const advance = (wsId) => {
    if (disposed) return;
    const next = store.nextLaunchable(wsId);
    if (!next) return;
    const claimed = store.patch({
      wsId,
      entryId: next.id,
      patch: { state: "launching", startedAt: now() },
      now: now()
    });
    if (claimed?.ok !== true) return;
    onChange();
    void launch(wsId, claimed.entry);
  };

  /**
   * 启动一条已占位（launching）的条目：复验 → 投递（429 有界重试）→ executing（首忙窗）。
   */
  const launch = async (wsId, entry) => {
    /* 执行时刻复验（与入队/渲染同一谓词）：不过 → skipped + 继续下一条。 */
    let verdict = { ok: true };
    try {
      verdict = await reverify(entry);
    } catch (error) {
      warn(`执行时刻复验异常（按通过处理）: ${String(error?.message || error)}`);
      verdict = { ok: true };
    }
    if (disposed) return;
    const current = store.find(wsId, entry.id);
    if (!current || current.state !== "launching") return;
    if (verdict?.ok !== true) {
      finishEntry(wsId, entry.id, {
        state: "skipped",
        reason: typeof verdict?.reason === "string" && verdict.reason ? verdict.reason : "prestate-drift",
        message: "前置状态已变化，已跳过该条目"
      });
      advance(wsId);
      return;
    }
    await deliverWithRetry(wsId, current, 0);
  };

  const deliverWithRetry = async (wsId, entry, attempt) => {
    if (disposed) return;
    let result;
    try {
      result = await deliver(entry);
    } catch (error) {
      /* 投递器缺陷路径（正常失败恒以 `{ok:false, reason}` 返回）：归保留族。 */
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
    /* 429 有界重试（按 retry-after 等一拍，仍失败才落 failed + 暂停）。
       进程内直投无限速 → 该分支永不触发（保留以兼容历史族/未来限速面，无害）。 */
    if (result?.reason === RATE_LIMIT_REASON && attempt < maxRateRetries) {
      const waitMs = Math.min(
        RATE_RETRY_CAP_MS,
        Number.isFinite(result.retryAfterMs) && result.retryAfterMs > 0 ? result.retryAfterMs : 1000
      );
      const runtime = runtimes.get(entry.id) ?? { wsId, entryId: entry.id, sessionId: null, busyTimer: null, retryTimer: null, attempt };
      runtimes.set(entry.id, runtime);
      runtime.retryTimer = armTimer(() => {
        runtime.retryTimer = null;
        void deliverWithRetry(wsId, entry, attempt + 1);
      }, waitMs);
      return;
    }
    const reason = typeof result?.reason === "string" && result.reason ? result.reason : "delivery-failed";
    const message = typeof result?.message === "string" && result.message ? result.message : "无法投递（会话服务不可用）";
    finishEntry(wsId, entry.id, { state: "failed", reason, message });
    store.setPaused({ wsId, paused: true, now: now() });
    onChange();
    notify(`队列已暂停：${message}`, true);
  };

  /**
   * 绑定运行态：回填投递期间已到达的会话事件（快回合不漏判）。
   */
  const bindRuntime = (wsId, entry) => {
    const sessionId = entry.sessionId;
    clearRuntime(entry.id);
    const runtime = {
      wsId,
      entryId: entry.id,
      sessionId,
      busyTimer: null,
      retryTimer: null,
      attempt: 0
    };
    runtimes.set(entry.id, runtime);
    boundEntries.set(sessionId, entry.id);
    const state = cacheOf(sessionId);
    if (state !== null && state.sawRunning === true && state.running === false && state.waiting === 0) {
      /* 投递 await 期间回合已跑完（running→idle 都见过）→ 直接完成。 */
      return;
    }
    if (state === null || state.sawRunning !== true) {
      /* 首忙等待窗：窗内从未 busy → 投递异常。 */
      runtime.busyTimer = armTimer(() => {
        runtime.busyTimer = null;
        if (disposed) return;
        const latest = store.find(wsId, entry.id);
        if (!latest || latest.state !== "executing") return;
        const cached = sessionCache.get(sessionId);
        if (cached !== undefined && cached.sawRunning === true) return;
        finishEntry(wsId, entry.id, {
          state: "failed",
          reason: "busy-timeout",
          message: `投递后 ${Math.round(firstBusyWindowMs / 60000)} 分钟内会话未进入运行态（投递异常）`
        });
        store.setPaused({ wsId, paused: true, now: now() });
        onChange();
        notify("队列已暂停：投递异常（会话未进入运行态）", true);
      }, firstBusyWindowMs);
    }
  };

  /* ── 事件面 ── */

  /**
   * 宿主 `agent/status` 转发。
   * @param {{sessionId?: string, status?: string}} input
   */
  const onAgentStatus = (input) => {
    const sessionId = typeof input?.sessionId === "string" ? input.sessionId : "";
    if (!sessionId) return;
    const running = input?.status !== "idle";
    writeCache(sessionId, { running, sawRunning: running });
    const entryId = boundEntries.get(sessionId);
    if (entryId === undefined) return;
    const runtime = runtimes.get(entryId);
    if (runtime === null || runtime === undefined) return;
    if (running) {
      cancelTimer(runtime.busyTimer);
      runtime.busyTimer = null;
      return;
    }
    const entry = store.find(runtime.wsId, entryId);
    if (entry) maybeComplete(runtime.wsId, entry);
  };

  /** 交互瀑布进入沿（审批/计划审阅/提问）。 */
  const interactionEnter = (sessionId) => {
    if (typeof sessionId !== "string" || !sessionId) return;
    writeCache(sessionId, { waitingDelta: 1 });
  };

  /** 交互瀑布退出沿（决策完成）。 */
  const interactionExit = (sessionId) => {
    if (typeof sessionId !== "string" || !sessionId) return;
    writeCache(sessionId, { waitingDelta: -1 });
    const entryId = boundEntries.get(sessionId);
    if (entryId === undefined) return;
    const runtime = runtimes.get(entryId);
    if (runtime === null || runtime === undefined) return;
    const entry = store.find(runtime.wsId, entryId);
    if (entry) maybeComplete(runtime.wsId, entry);
  };

  /* ── 冷读对账 ── */

  const coldReconcileEntry = async (wsId, entry) => {
    if (entry.state === "launching") {
      /* 重启时刻仍在 launching（未取得 sessionId）→ failed，队列继续（不暂停）。 */
      finishEntry(wsId, entry.id, { state: "failed", reason: "restart-lost-launch", message: "服务端重启时投递未完成" });
      return;
    }
    const sessionId = typeof entry.sessionId === "string" ? entry.sessionId : "";
    if (!sessionId) {
      finishEntry(wsId, entry.id, { state: "failed", reason: "restart-lost-session", message: "执行中条目缺少会话 id" });
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
      const waiting = read.waiting === true || (Number.isFinite(read.waiting) && read.waiting > 0);
      writeCache(sessionId, { running, sawRunning: true });
      if (waiting) writeCache(sessionId, { waitingDelta: 1 });
      bindRuntime(wsId, entry);
      const cached = sessionCache.get(sessionId);
      if (cached !== undefined && cached.sawRunning === true) {
        /* 冷读证明已启动过：不再受首忙窗约束。 */
        const runtime = runtimeOf(entry.id);
        if (runtime) {
          cancelTimer(runtime.busyTimer);
          runtime.busyTimer = null;
        }
      }
      const latest = store.find(wsId, entry.id);
      if (latest) maybeComplete(wsId, latest);
      return;
    }
    if (read?.gone === true) {
      finishEntry(wsId, entry.id, { state: "failed", reason: "session-gone", message: "会话已不存在" });
      return;
    }
    /* 冷读不可用（会话服务不可达）：保持 executing，稍后重试；活会话事件仍可收敛。
       永久性失败（read 自带 `permanent`，进程内实现当前不产出）与重试耗尽都落显式
       failed——executing 条目在 v1 完全锁定，不能让它永久卡死（队列继续，不自动暂停，
       与 session-gone 同口径）。 */
    const permanent = read?.permanent === true;
    const existing = runtimes.get(entry.id);
    const attempts = (existing?.coldAttempts ?? 0) + 1;
    if (permanent || attempts >= coldReadMaxAttempts) {
      finishEntry(wsId, entry.id, {
        state: "failed",
        reason: "cold-read-unavailable",
        message: permanent
          ? `重启对账无法读取会话状态（${String(read?.error || "会话服务不可用")}）`
          : `重启对账冷读连续 ${attempts} 次失败（会话服务不可达）`
      });
      advance(wsId);
      return;
    }
    warn(`重启对账冷读失败（条目保持执行中，稍后重试）: ${String(read?.error || "unknown")}`);
    const runtime = existing ?? {
      wsId, entryId: entry.id, sessionId, busyTimer: null, retryTimer: null, attempt: 0
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
   * 启动：冷读对账全部在途条目（launching/executing），然后逐队列推进。
   * @returns {Promise<void>}
   */
  const start = async () => {
    disposed = false;
    const doc = store.doc;
    const tasks = [];
    for (const [wsId, queue] of Object.entries(doc?.queues ?? {})) {
      for (const entry of queue.entries) {
        if (entry.state === "launching" || entry.state === "executing") {
          tasks.push(coldReconcileEntry(wsId, entry));
        }
      }
    }
    if (tasks.length > 0) {
      onChange();
      await Promise.all(tasks);
    }
    for (const wsId of Object.keys(store.doc?.queues ?? {})) advance(wsId);
  };

  /** 卸载：清定时器、停止推进（不触碰持久化状态）。 */
  const dispose = () => {
    disposed = true;
    for (const entryId of [...runtimes.keys()]) clearRuntime(entryId);
    boundEntries.clear();
  };

  return {
    start,
    dispose,
    kick: (wsId) => advance(wsId),
    onAgentStatus,
    interactionEnter,
    interactionExit,
    activityOf,
    runtimeOf: (entryId) => {
      const runtime = runtimes.get(entryId);
      return runtime === undefined ? null : { sessionId: runtime.sessionId, attempt: runtime.attempt };
    },
    /** 观察面（冒烟用）：会话态缓存只读投影。 */
    sessionStateOf: (sessionId) => {
      const state = sessionCache.get(sessionId);
      return state === undefined ? null : { ...state };
    },
    /** 观察面：当前活动绑定。 */
    boundSessionOf: (entryId) => runtimeOf(entryId)?.sessionId ?? null,
    get disposed() {
      return disposed;
    }
  };
}
