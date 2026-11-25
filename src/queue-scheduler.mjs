/**
 * dsh-v-cosmos — 提案动作自动执行队列的调度器（add-cosmos-action-queue 3.1–3.3；
 * 停机分类处置见 one-add-cosmos-queue-stop-reason-policy 2.1–3.4）。
 *
 * 纯状态机 + 注入面（零框架依赖；交付/冷读/复验/落盘全部由调用方注入，冒烟可直测）：
 *
 * ```
 *  queued ──► launching ──► executing(*running* ──► 等待决策*) ──► completed(出队)
 *                │                 │
 *                └─ failed         ├─ failed(首忙超窗 / 会话消失)
 *                                  ├─ failed(停机分类处置：欠费/错误/用户中止/截断耗尽)
 *                                  └─ 截断续跑(同会话补投「继续」，有界)
 *  queued ──► skipped（执行时刻前置状态复验不过 → 继续下一条）
 * ```
 *
 * 关键语义（design D3/D5）：
 *  - **单飞**：任意时刻每队列至多一条在途；完成/失败/跳过后才考虑下一条。
 *  - **暂停只挡 advance**：`paused` 只影响「收尾后是否启动下一条」，绝不触碰在途条目。
 *  - **完成判定（状态 + 停机原因双口径）**：投递成功 → 首次 `running=true` → `running=false`
 *    且无 `pendingInteraction` 时，**再查该会话最近一次回合收尾的停机原因**
 *    （宿主 `session/event(turn/end)` 的 `reason.kind` 与 `agent/error` 的错误码，经本调度器的
 *    停机原因缓存读出），按 `STOP_KIND_POLICY` 分类处置：只有 `completed`（及信号缺失兜底）
 *    才完成出队；`max-tokens` → 同会话自动补投「继续」续跑（有界）；其余 → failed + 暂停。
 *  - **信号面次序无关**：`agent/status` idle 可能先于 `turn/end` 抵达 → 完成判定推迟到
 *    `STOP_SIGNAL_GRACE_MS` 内等 `turn/end` 写入；窗内仍缺席 → 按**信号缺失兜底完成**
 *    （老宿主/事件面不可用零回归；冷读对账补漏）。冷读收敛无到达次序问题 → 直接兜底。
 *  - **首忙等待窗**（缺省 5 分钟）：投递成功后窗内从未进入 running → 「投递异常」failed
 *    + 队列暂停（可见可处理）。截断续跑补投成功后**显式重武装**同一窗口（续跑窗）。
 *  - **执行时刻复验**：启动前调用注入的 `reverify(entry)`（与动作条渲染门控同一谓词）；
 *    不过 → skipped + 继续下一条。
 *  - **依赖让位扫描**（second-add-cross-proposal-dependency-gating 2.1）：`advance` 从队首
 *    向后逐条求值注入的 `depsSatisfied(wsId, entry)`（扫描时刻**动态**解析，条目模型零
 *    改动），跳过依赖未达标条目、启动首个达标条目；被跳过条目保持 queued 不落残态，
 *    存储顺序（入队 FIFO）不变——执行序自然收敛为拓扑序。全队列等待 → 闲置态（无条目
 *    启动、暂停标志 MUST NOT 被自动置位；重扫由关联会话收尾触发源整体驱动）。
 *    前置状态复验**不并入**扫描等待（精确相等谓词 + 生命周期单调前进 → 等待无终态），
 *    仍在启动时刻复验、跳过残留并继续。
 *  - **投递失败**（会话服务不可用/命令调用失败）→ failed + 队列暂停；429 有界重试
 *    分支保留（进程内直投无限速，永不触发）。
 *  - **重启对账**：`start()` 时 launching（未取得 sessionId）→ failed；executing 冷读
 *    会话现状（注入 `readSession`）：running → 续监视；终态 → 携带停机原因并按策略表收敛；
 *    会话消失/归档 → failed 且**不暂停**、继续下一条。
 *
 * 事件面（宿主作用域）由调用方（index.mjs）转发：`onAgentStatus` / `onSessionTurnEnd` /
 * `onAgentError` / `interactionEnter` / `interactionExit`。事件**先于**投递返回到达也安全：
 * 会话态（含停机原因）先入有界缓存，条目取得 `sessionId` 时回填（避免「快回合在投递 await
 * 期间跑完」被漏判）。
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
 * 停机分类处置策略表（design D4：常量即契约，改表走提案）。
 *
 * 键 = 宿主 `turn/end` 的 `reason.kind` 词汇表（`dsh-session/src/types.ts`
 * `TurnEndReasonMap`，merge-extensible）；值 = 处置动词。
 */
export const STOP_KIND_POLICY = Object.freeze({
  completed: "complete",
  "max-tokens": "continue",
  error: "failed",
  aborted: "failed",
  interrupted: "failed",
  blocked: "failed"
});

/**
 * 策略表兜底（表外原因族 / 信号缺失）：按完成处理。
 *
 * 宿主 `TurnEndReasonMap` 是**可合并扩展**的（插件可并入新变体），把表外变体判成 failed
 * 会让一次宿主升级把队列全面卡死；与「信号缺失兜底完成」同口径，异常由冷读对账补漏。
 */
export const STOP_KIND_FALLBACK = "complete";

/**
 * 欠费族错误码（spike 1.2 定稿：`@deepseek-ai/dsh-llm/src/error.ts` 的 `LLM_FAILURE_CODES`
 * 与 `QUOTA_EXCEEDED_CODE` / `ACCOUNT_QUOTA_EXCEEDED_CODE` 常量链路；`dsh-client-ui-chat`
 * 的 `QuotaNoticeCode = 'QUOTA' | 'ACCOUNT_QUOTA'` 同族，`ACCOUNT_SIGN_IN_REQUIRED` 由
 * `dsh-llm-deepseek-account` 在账户鉴权缺失时抛出）。
 */
export const STOP_QUOTA_CODES = Object.freeze(["QUOTA", "ACCOUNT_QUOTA", "ACCOUNT_SIGN_IN_REQUIRED"]);

/** 连续截断续跑上限（缺省 3 次；耗尽 → failed + 暂停）。 */
export const STOP_TRUNCATION_LIMIT = 3;

/** `agent/status` idle 先于 `turn/end` 到达时的完成判定推迟窗（信号迟到容忍）。 */
export const STOP_SIGNAL_GRACE_MS = 1_000;

/** 停机原因族 → 条目 `reason` 码（failed 残留诊断的原因族枚举扩展）。 */
export const STOP_REASONS = Object.freeze({
  quota: "turn-quota",
  error: "turn-error",
  aborted: "turn-aborted",
  interrupted: "turn-interrupted",
  blocked: "turn-blocked",
  exhausted: "turn-max-tokens-exhausted"
});

/** 停机原因族 → 用户可读文案前缀（通知/诊断行共用；测试按族断言可区分）。 */
const STOP_NOTICES = Object.freeze({
  quota: "会话因欠费停机",
  error: "会话回合以错误结束",
  aborted: "会话回合被用户中止（用户接管）",
  interrupted: "会话回合中断（进程重启残留）",
  blocked: "会话回合被阻塞（未进入执行）",
  exhausted: "输出截断续跑已耗尽"
});

/**
 * 建立调度器。
 *
 * @param {object} options
 * @param {object} options.store 队列存储句柄（queue-store.mjs `createQueueStore`）
 * @param {(entry: object) => Promise<{ok: true, sessionId: string} |
 *        {ok: false, reason: string, message?: string, retryAfterMs?: number}>} options.deliver
 *        投递器（进程内 sessionController 直投，见 session-executor.mjs）
 * @param {(sessionId: string) => Promise<{ok: true, running: boolean, waiting: boolean|number,
 *        stopKind?: string, stopCode?: string, stopCause?: string} |
 *        {ok: false, gone: true} | {ok: false, error: string}>} options.readSession 冷读
 * @param {(input: {sessionId: string, entry?: object}) => Promise<{ok: true} |
 *        {ok: false, reason: string, message?: string}>} [options.resume]
 *        同会话续跑补投（截断自动续跑；缺省 = 无续跑通道 → 按续跑耗尽处置）
 * @param {(entry: object) => Promise<{ok: boolean, reason?: string}>} [options.reverify]
 *        执行时刻前置状态复验（缺省恒过）
 * @param {(wsId: string, entry: object) => boolean} [options.depsSatisfied]
 *        **依赖让位子句**（second-add-cross-proposal-dependency-gating 2.1）：返回该条目
 *        目标提案的依赖是否全部达标（缺省恒 true = 无依赖守卫）。只在 `advance` 的让位
 *        扫描里调用（扫描时刻**动态**求值，条目模型零改动）；被跳过条目保持 queued。
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
 * @param {number} [options.truncationLimit]
 * @param {number} [options.stopGraceMs]
 * @returns {object} 调度器句柄
 */
export function createQueueScheduler(options = {}) {
  const store = options.store;
  const deliver = options.deliver;
  const readSession = options.readSession;
  const resume = typeof options.resume === "function" ? options.resume : null;
  const reverify = typeof options.reverify === "function" ? options.reverify : async () => ({ ok: true });
  const depsSatisfied = typeof options.depsSatisfied === "function" ? options.depsSatisfied : () => true;
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
  const truncationLimit = Number.isInteger(options.truncationLimit) && options.truncationLimit >= 0
    ? options.truncationLimit
    : STOP_TRUNCATION_LIMIT;
  const stopGraceMs = Number.isFinite(options.stopGraceMs) && options.stopGraceMs >= 0
    ? options.stopGraceMs
    : STOP_SIGNAL_GRACE_MS;

  /** entryId → 运行态（投递后建立；出队/失败时销毁）。 */
  const runtimes = new Map();
  /**
   * sessionId → 会话态缓存（`{running, sawRunning, waiting, stopKind, stopCode, stopCause,
   * updatedAt}`）。停机原因是**共享**数据面：本调度器是唯一写者，曲率只读（design D2）。
   */
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

  /* ── 会话态缓存（含停机原因） ── */

  const cacheOf = (sessionId) => {
    if (typeof sessionId !== "string" || !sessionId) return null;
    let state = sessionCache.get(sessionId);
    if (state === undefined) {
      state = {
        running: false,
        sawRunning: false,
        waiting: 0,
        stopKind: null,
        stopCode: null,
        stopCause: null,
        updatedAt: now()
      };
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
    /* 续跑重武装专用：新回合尚未开始，必须把「见过 running」记账清零（否则续跑窗的
       首忙定时器不会重设，`settleEntry` 也会把上一回合的收尾误当本回合）。 */
    if (patch.sawRunningReset === true) state.sawRunning = false;
    if (patch.waitingDelta !== undefined) {
      state.waiting = Math.max(0, state.waiting + patch.waitingDelta);
    }
    if (patch.waitingReset === true) state.waiting = 0;
    state.updatedAt = now();
    return state;
  };

  /**
   * 写停机原因（**只增覆盖**：最新一次回合收尾覆盖旧的；缓存淘汰口径不变）。
   *
   * - 带 `kind`（`turn/end` 到达）→ 覆盖 kind/cause；`code` 缺省时按族清理或保留：
   *   `error` 族保留既有错误码（`agent/error` 可能先到），非 `error` 族清空；
   * - 只带 `code`（`agent/error` 到达）→ 仅补齐错误码，不改 kind。
   * @param {string} sessionId
   * @param {{kind?: string|null, code?: string, cause?: string}} input
   * @returns {object|null} 缓存态
   */
  const writeStop = (sessionId, input) => {
    const state = cacheOf(sessionId);
    if (state === null) return null;
    const kind = typeof input?.kind === "string" && input.kind ? input.kind : null;
    if (kind !== null) {
      state.stopKind = kind;
      state.stopCause = typeof input?.cause === "string" && input.cause ? input.cause : null;
    }
    if (typeof input?.code === "string" && input.code) {
      state.stopCode = input.code;
    } else if (kind !== null && kind !== "error") {
      state.stopCode = null;
    }
    state.updatedAt = now();
    return state;
  };

  /* 清停机原因（新回合开始 / 处置已消费后）：避免陈旧原因污染下一次判定。 */
  const clearStop = (sessionId) => {
    const state = sessionCache.get(sessionId);
    if (state === undefined) return;
    state.stopKind = null;
    state.stopCode = null;
    state.stopCause = null;
    state.updatedAt = now();
  };

  /** 缓存态 → 停机原因读数（无 kind 视为「信号缺失」）。 */
  const stopOf = (state) => {
    if (state === null || state === undefined) return null;
    if (typeof state.stopKind !== "string" || !state.stopKind) return null;
    return {
      kind: state.stopKind,
      code: typeof state.stopCode === "string" && state.stopCode ? state.stopCode : "",
      cause: typeof state.stopCause === "string" && state.stopCause ? state.stopCause : ""
    };
  };

  const isQuotaCode = (code) => typeof code === "string" && STOP_QUOTA_CODES.includes(code);

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
    cancelTimer(runtime.graceTimer);
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
   * 停机分类处置（策略表落地）：完成出队 / 截断续跑 / failed（+ 暂停）。
   * @param {string} wsId
   * @param {object} entry
   * @param {{kind: string, code: string, cause: string}|null} stop 停机原因（null = 信号缺失）
   */
  const applyStopPolicy = (wsId, entry, stop) => {
    if (disposed) return;
    const policy = stop === null
      ? STOP_KIND_FALLBACK
      : (STOP_KIND_POLICY[stop.kind] ?? STOP_KIND_FALLBACK);
    if (policy === "complete") {
      clearStop(entry.sessionId);
      completeEntry(wsId, entry.id);
      advance(wsId);
      return;
    }
    if (policy === "continue") {
      void continueEntry(wsId, entry, stop);
      return;
    }
    const verdict = stopFailureOf(stop);
    clearStop(entry.sessionId);
    finishEntry(wsId, entry.id, { state: "failed", reason: verdict.reason, message: verdict.message });
    if (verdict.paused) {
      store.setPaused({ wsId, paused: true, now: now() });
      onChange();
      notify(`队列已暂停：${verdict.message}`, true);
      return;
    }
    /* 不暂停族（宿主 disposed 释放会话 = 既有 session-gone 口径）：队列继续推进。 */
    advance(wsId);
  };

  /**
   * 停机原因 → failed 收尾口径（reason 码 + 用户可读说明 + 是否暂停队列）。
   * @param {{kind: string, code: string, cause: string}|null} stop
   * @returns {{reason: string, message: string, paused: boolean}}
   */
  const stopFailureOf = (stop) => {
    if (stop === null) {
      /* 兜底族不该走到这里（信号缺失按完成处理）；保留以防表被显式改错。 */
      return { reason: STOP_REASONS.error, message: "会话以未知停机原因结束，队列已暂停", paused: true };
    }
    const codeSuffix = stop.code ? `（错误码 ${stop.code}）` : "";
    if (stop.kind === "max-tokens") {
      return {
        reason: STOP_REASONS.exhausted,
        message: `连续 ${truncationLimit} 次输出截断（自动续跑已耗尽），队列已暂停`,
        paused: true
      };
    }
    if (stop.kind === "error") {
      if (isQuotaCode(stop.code)) {
        return {
          reason: STOP_REASONS.quota,
          message: `${STOP_NOTICES.quota}${codeSuffix}，队列已暂停（欠费不盲目重试）`,
          paused: true
        };
      }
      return {
        reason: STOP_REASONS.error,
        message: `${STOP_NOTICES.error}${codeSuffix}，队列已暂停`,
        paused: true
      };
    }
    if (stop.kind === "aborted") {
      if (stop.cause === "disposed") {
        /* 宿主释放/归档会话（AgentCancelCause.disposed）：归既有 session-gone 分支，不暂停。 */
        return { reason: "session-gone", message: "会话已被宿主释放（disposed），队列继续下一条", paused: false };
      }
      return { reason: STOP_REASONS.aborted, message: `${STOP_NOTICES.aborted}，队列已暂停`, paused: true };
    }
    if (stop.kind === "interrupted") {
      return { reason: STOP_REASONS.interrupted, message: `${STOP_NOTICES.interrupted}，队列已暂停`, paused: true };
    }
    if (stop.kind === "blocked") {
      return { reason: STOP_REASONS.blocked, message: `${STOP_NOTICES.blocked}，队列已暂停`, paused: true };
    }
    return {
      reason: STOP_REASONS.error,
      message: `会话以未知停机原因结束（${stop.kind}）${codeSuffix}，队列已暂停`,
      paused: true
    };
  };

  /**
   * 截断自动续跑（design D5）：同会话补投「继续」，有界重试；补投成功后**显式重武装**
   * 续跑等待窗（`bindRuntime` 只在 `sawRunning !== true` 时武装首忙定时器，续跑后必须重设，
   * 否则补投被死会话静默吞掉时条目永久 executing，单飞锁死整条队列）。
   * @param {string} wsId
   * @param {object} entry
   * @param {{kind: string, code: string, cause: string}} stop
   */
  const continueEntry = async (wsId, entry, stop) => {
    if (disposed) return;
    const runtime = runtimeOf(entry.id);
    if (runtime === null) return;
    const sessionId = runtime.sessionId;
    runtime.truncations = (Number.isInteger(runtime.truncations) ? runtime.truncations : 0) + 1;
    clearStop(sessionId);
    if (runtime.truncations >= truncationLimit || resume === null) {
      const verdict = resume === null
        ? { reason: STOP_REASONS.exhausted, message: "未注入续跑补投通道（resume），无法自动续跑；队列已暂停" }
        : stopFailureOf({ kind: "max-tokens", code: "", cause: "" });
      finishEntry(wsId, entry.id, { state: "failed", reason: verdict.reason, message: verdict.message });
      store.setPaused({ wsId, paused: true, now: now() });
      onChange();
      notify(`队列已暂停：${verdict.message}`, true);
      return;
    }
    let result;
    try {
      result = await resume({ sessionId, entry, attempt: runtime.truncations });
    } catch (error) {
      result = { ok: false, reason: "delivery-failed", message: String(error?.message || error) };
    }
    if (disposed) return;
    const latest = store.find(wsId, entry.id);
    if (!latest || latest.state !== "executing") return;
    if (result?.ok !== true) {
      const reason = typeof result?.reason === "string" && result.reason ? result.reason : "delivery-failed";
      const detail = typeof result?.message === "string" && result.message ? result.message : "会话服务不可用";
      const message = `续跑补投失败（${detail}）`;
      finishEntry(wsId, entry.id, { state: "failed", reason, message });
      store.setPaused({ wsId, paused: true, now: now() });
      onChange();
      notify(`队列已暂停：${message}`, true);
      return;
    }
    /* 补投落定：重置该会话的回合记账（新回合尚未开始）并重武装续跑窗。 */
    writeCache(sessionId, { running: false, sawRunningReset: true, waitingReset: true });
    armBusyWindow(wsId, entry, runtime, true);
  };

  /**
   * 首忙 / 续跑等待窗：窗内会话从未进入 running → 投递异常 failed + 队列暂停。
   * @param {string} wsId
   * @param {object} entry
   * @param {object} runtime
   * @param {boolean} [continuation] 续跑窗（文案区分）
   */
  const armBusyWindow = (wsId, entry, runtime, continuation = false) => {
    cancelTimer(runtime.busyTimer);
    runtime.busyTimer = null;
    const sessionId = runtime.sessionId;
    runtime.busyTimer = armTimer(() => {
      runtime.busyTimer = null;
      if (disposed) return;
      const latest = store.find(wsId, entry.id);
      if (!latest || latest.state !== "executing") return;
      const cached = sessionCache.get(sessionId);
      if (cached !== undefined && cached.sawRunning === true) return;
      const minutes = Math.round(firstBusyWindowMs / 60000);
      const message = continuation
        ? `续跑补投后 ${minutes} 分钟内会话未重新进入运行态（续跑被吞）`
        : `投递后 ${minutes} 分钟内会话未进入运行态（投递异常）`;
      finishEntry(wsId, entry.id, { state: "failed", reason: "busy-timeout", message });
      store.setPaused({ wsId, paused: true, now: now() });
      onChange();
      notify(continuation ? "队列已暂停：续跑补投未生效（会话未重新运行）" : "队列已暂停：投递异常（会话未进入运行态）", true);
    }, firstBusyWindowMs);
  };

  /**
   * 收尾判定（同一入口：status idle、交互退出、turn/end 写入、冷读收敛）。
   * 条件：已见过 running ∧ 当前非 running ∧ 无待决策 ∧ 停机原因已就绪（或已过推迟窗）。
   * @param {string} wsId
   * @param {object} entry
   * @param {{cold?: boolean}} [flags] `cold` = 冷读收敛（无信号到达次序问题，直接兜底）
   */
  const settleEntry = (wsId, entry, flags = {}) => {
    if (disposed) return;
    const runtime = runtimeOf(entry.id);
    if (runtime === null) return;
    if (typeof runtime.sessionId !== "string") return;
    const state = sessionCache.get(runtime.sessionId);
    if (state === undefined || state.sawRunning !== true) return;
    if (state.running === true) return;
    if (state.waiting > 0) return;
    const stop = stopOf(state);
    if (stop === null) {
      /* 冷读恢复的终态条目不会再有 `turn/end` 到达（回合在重启前已收尾）→ 直接兜底；
         活体路径则推迟等 `turn/end`（`agent/status` idle 可能先到）。 */
      if (flags.cold === true || runtime.coldSettle === true) {
        runtime.coldSettle = false;
        applyStopPolicy(wsId, entry, null);
        return;
      }
      armStopGrace(wsId, entry, runtime);
      return;
    }
    cancelTimer(runtime.graceTimer);
    runtime.graceTimer = null;
    applyStopPolicy(wsId, entry, stop);
  };

  /**
   * 推迟窗：`agent/status` idle 先到时不立即以「信号缺失」兜底判完成，等 `turn/end`
   * 写入停机原因；窗内仍缺席（老宿主/事件面不可用）→ 兜底完成（零回归）。
   */
  const armStopGrace = (wsId, entry, runtime) => {
    if (runtime.graceTimer !== null && runtime.graceTimer !== undefined) return;
    runtime.graceTimer = armTimer(() => {
      runtime.graceTimer = null;
      if (disposed) return;
      const latest = store.find(wsId, entry.id);
      if (!latest || latest.state !== "executing") return;
      const state = sessionCache.get(runtime.sessionId);
      if (stopOf(state) !== null) {
        settleEntry(wsId, latest);
        return;
      }
      applyStopPolicy(wsId, latest, null);
    }, stopGraceMs);
  };

  /**
   * 依赖子句判定（容错：求值异常按「达标」处理——宁缺守卫不误阻塞，与解析面同方向）。
   * @param {string} wsId
   * @param {object} entry
   * @returns {boolean}
   */
  const entryDepsSatisfied = (wsId, entry) => {
    try {
      return depsSatisfied(wsId, entry) !== false;
    } catch (error) {
      warn(`依赖求值异常（按达标处理）: ${String(error?.message || error)}`);
      return true;
    }
  };

  /**
   * 让位扫描的下一个可执行条目（**只读**；不改状态）：从队首向后跳过依赖未达标条目，
   * 返回首个依赖达标的 queued 条目；全等待 / 暂停 / 有在途 → null。
   *
   * 呈现面（脉冲页签「下一执行」指示 / 闲置态）与 `advance` 共用本函数——指示与实际
   * 启动条目必然一致（单点判定，零二次推导）。
   * @param {string} wsId
   * @returns {object|null}
   */
  const nextExecutableOf = (wsId) => {
    if (disposed) return null;
    for (const entry of store.launchable(wsId)) {
      if (entryDepsSatisfied(wsId, entry)) return entry;
    }
    return null;
  };

  /**
   * 推进一条队列：无在途且未暂停 → **依赖让位扫描**后同步占位（queued→launching）并启动。
   *
   * 让位（second-add-cross-proposal-dependency-gating 2.1 / design D4）：从队首向后逐条
   * 求值依赖子句（扫描时刻动态解析），跳过未达标条目、启动首个达标条目；被跳过条目
   * **保持 queued 不出队、不落残态**（存储顺序不变，执行序自然收敛拓扑序）。全队列等待
   * → 无条目启动（闲置态：暂停标志 MUST NOT 被自动置位）。
   *
   * 前置状态复验语义保持不变（仍由 `launch` 在启动时刻做、跳过残留并继续）——前置状态
   * 精确相等且生命周期单调前进，扫描层等待将无终态，故不并入本扫描。
   *
   * 先占位再 await 是单飞的关键：并发的 kick 不会再取到同一条目。
   * @param {string} wsId
   */
  const advance = (wsId) => {
    if (disposed) return;
    const next = nextExecutableOf(wsId);
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
      settleEntry(wsId, executing.entry);
      return;
    }
    /* 429 有界重试（按 retry-after 等一拍，仍失败才落 failed + 暂停）。
       进程内直投无限速 → 该分支永不触发（保留以兼容历史族/未来限速面，无害）。 */
    if (result?.reason === RATE_LIMIT_REASON && attempt < maxRateRetries) {
      const waitMs = Math.min(
        RATE_RETRY_CAP_MS,
        Number.isFinite(result.retryAfterMs) && result.retryAfterMs > 0 ? result.retryAfterMs : 1000
      );
      const runtime = runtimes.get(entry.id) ?? { wsId, entryId: entry.id, sessionId: null, busyTimer: null, retryTimer: null, graceTimer: null, attempt };
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
   *
   * 注意（design D5 实现要点）：只有在**尚未见过 running** 时才武装首忙等待窗；截断续跑
   * 之后必须由调用方显式 `armBusyWindow(…, true)` 重新武装，不能指望这里自然重设。
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
      graceTimer: null,
      attempt: 0,
      truncations: 0,
      coldSettle: false
    };
    runtimes.set(entry.id, runtime);
    boundEntries.set(sessionId, entry.id);
    const state = cacheOf(sessionId);
    if (state === null || state.sawRunning !== true) {
      armBusyWindow(wsId, entry, runtime, false);
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
      /* 会话重新跑起来 → 冷读兜底标记作废（新回合会重新带来 `turn/end`）。 */
      runtime.coldSettle = false;
      return;
    }
    const entry = store.find(runtime.wsId, entryId);
    if (entry) settleEntry(runtime.wsId, entry);
  };

  /**
   * 宿主 `session/event` 的 `turn/end` 转发（**主信号**）：写入停机原因并（若该会话有绑定
   * 条目）立即按策略表处置。
   *
   * spike 实证次序（`dsh-agent-loop/src/agent.ts` turn() 的 finally/throwError）：error 路径
   * `agent/error` → `turn/end` → `agent/status(idle)`；completed / max-tokens / aborted 路径
   * `turn/end` → `agent/status(idle)`。实现按「次序无关」编写：idle 先到则推迟，
   * `turn/end` 先到则即时判定。
   * @param {string} sessionId 会话 id（`session.id`）
   * @param {{kind?: string, error?: {code?: string}, reason?: {kind?: string}}} reason `reason.kind` 词汇表
   */
  const onSessionTurnEnd = (sessionId, reason) => {
    const id = typeof sessionId === "string" ? sessionId : "";
    if (!id) return;
    const kind = typeof reason?.kind === "string" && reason.kind ? reason.kind : "";
    if (!kind) return;
    const code = kind === "error" && typeof reason?.error?.code === "string" ? reason.error.code : "";
    /* `aborted` 的取消原因（user/parent/hook/disposed/legacy）：disposed 归 session-gone。 */
    const cause = kind === "aborted" && typeof reason?.reason?.kind === "string" ? reason.reason.kind : "";
    writeStop(id, { kind, code, cause });
    wakeBound(id);
  };

  /**
   * 宿主 `agent/error` 转发（**错误码明细**）：error 路径活体边界事件，载荷含 `LlmError`
   * （`.code` / `.failure.code`）。`turn/end` 已按「回合错误」收尾而后到的欠费码 → 补齐改判。
   * @param {string} sessionId
   * @param {unknown} error 抛出的错误对象（`LlmError` 实例）
   */
  const onAgentError = (sessionId, error) => {
    const id = typeof sessionId === "string" ? sessionId : "";
    if (!id) return;
    const code = errorCodeOf(error);
    if (!code) return;
    writeStop(id, { code });
    /* `turn/end` 已先到并按「回合错误」收尾（runtime 已销毁、绑定已解除）→ 按会话 id
       找回该条 failed 残留并改判欠费族（spec：欠费族归类随错误码补齐修正）。 */
    upgradeFailedEntryOf(id, code);
    wakeBound(id);
  };

  /** `LlmError` 错误码读取（实例/序列化失败事实两种形态都认）。 */
  const errorCodeOf = (error) => {
    if (error === null || typeof error !== "object") return "";
    const direct = typeof error.code === "string" ? error.code : "";
    if (direct) return direct;
    const failure = error.failure;
    if (failure !== null && typeof failure === "object" && typeof failure.code === "string") return failure.code;
    return "";
  };

  /** 已绑定条目按当前会话态重新收尾（事件到达沿的统一入口）。 */
  const wakeBound = (sessionId) => {
    const entryId = boundEntries.get(sessionId);
    if (entryId === undefined) return;
    const runtime = runtimes.get(entryId);
    if (runtime === null || runtime === undefined) return;
    const entry = store.find(runtime.wsId, entryId);
    if (entry) settleEntry(runtime.wsId, entry);
  };

  /**
   * 错误码补齐修正：`turn/end` 先到时按「回合错误」收尾，后到的欠费族错误码改判为
   * 「欠费停机」（spec：欠费族归类随错误码补齐修正）。
   */
  const upgradeStopFamily = (wsId, entry, code) => {
    if (!isQuotaCode(code)) return;
    if (entry?.state !== "failed" || entry?.reason !== STOP_REASONS.error) return;
    const message = `${STOP_NOTICES.quota}（错误码 ${code}），队列已暂停（欠费不盲目重试）`;
    store.patch({ wsId, entryId: entry.id, patch: { reason: STOP_REASONS.quota, message }, now: now() });
    onChange();
    notify(`队列已暂停：${message}`, true);
  };

  /**
   * 按会话 id 找回「已按回合错误收尾」的 failed 残留并改判（错误码晚到的补齐路径：
   * 收尾后 runtime/boundEntries 已销毁，只能经存储定位；每条条目绑定单一会话）。
   * @param {string} sessionId
   * @param {string} code 错误码
   */
  const upgradeFailedEntryOf = (sessionId, code) => {
    if (!isQuotaCode(code)) return;
    const queues = store.doc?.queues ?? {};
    for (const [wsId, queue] of Object.entries(queues)) {
      const entries = Array.isArray(queue?.entries) ? queue.entries : [];
      for (const entry of entries) {
        if (entry?.sessionId !== sessionId) continue;
        if (entry.state !== "failed" || entry.reason !== STOP_REASONS.error) continue;
        upgradeStopFamily(wsId, entry, code);
        return;
      }
    }
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
    wakeBound(sessionId);
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
      /* 冷读携带的停机原因先入共享缓存（策略表只读缓存面），不可得则维持「信号缺失」。 */
      if (typeof read.stopKind === "string" && read.stopKind) {
        writeStop(sessionId, {
          kind: read.stopKind,
          code: typeof read.stopCode === "string" ? read.stopCode : "",
          cause: typeof read.stopCause === "string" ? read.stopCause : ""
        });
      }
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
      if (latest && running !== true) {
        /* 冷读判定「已达终态」：该回合的 `turn/end` 不会再来 → 允许一次即时兜底收敛。 */
        const runtime = runtimeOf(entry.id);
        if (runtime) runtime.coldSettle = true;
      }
      if (latest) settleEntry(wsId, latest, { cold: true });
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
      wsId, entryId: entry.id, sessionId, busyTimer: null, retryTimer: null, graceTimer: null, attempt: 0, truncations: 0
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
    /**
     * 让位扫描的下一可执行条目（**只读**，呈现面「下一执行」/ 闲置态判定共用；
     * 与 `kick` 的扫描单点同源）。
     */
    nextExecutable: (wsId) => nextExecutableOf(wsId),
    onAgentStatus,
    onSessionTurnEnd,
    onAgentError,
    interactionEnter,
    interactionExit,
    activityOf,
    runtimeOf: (entryId) => {
      const runtime = runtimes.get(entryId);
      return runtime === undefined
        ? null
        : {
          sessionId: runtime.sessionId,
          attempt: runtime.attempt,
          truncations: runtime.truncations ?? 0
        };
    },
    /** 观察面（冒烟用）：会话态缓存只读投影（含停机原因，曲率经此只读）。 */
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
