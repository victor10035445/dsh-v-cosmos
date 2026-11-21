/**
 * 动作按钮执行链路纯逻辑（add-cosmos-proposal-actions 4.2–4.4 / spec cosmos-actions
 * 「点击执行链路」「自动发送 hero 接力」「按钮模型绑定执行语义」）。
 *
 * 独立纯逻辑模块——浏览器 client.jsx 消费（动作条点击、hero 消费器）、
 * test/actions-smoke.mjs 直测。零 DOM：宿主会话动词（`sessions.create` /
 * `uiWorkspace.openSession` / 降级用的 `uiWorkspace.startSession`）、草稿落稿
 * （`inputActions.setDraft`）、提交（`inputActions.submit`）与模型切换
 * （`remote.session.selectModel`）全部由调用方注入。
 *
 * 设计要点（fix-cosmos-action-draft-block D1–D5）：
 *  - 消息 = `prepend` ? `prompt + "\n" + @目录` : `@目录 + "\n" + prompt`；
 *  - **恒新建**：`createSession(工作区)`（宿主 `sessions.create({ workspaceId })`，
 *    MUST NOT 传 `sessionId`）→ 登记标记 → `openSession(新会话 id)`；用户既有会话与其
 *    未发送草稿零接触（不复用、不覆盖、不归档任何 blank，MUST NOT 走
 *    `whenDraftExists` 语义）；
 *  - 一次性 pendingAction 标记（模块/fiber 层，约 10s 过期，登记即覆盖旧标记）绑定
 *    目标 SessionId 并携带落稿意图——消费器以「会话 id 相等」为正确会话判据，草稿
 *    为空时先落稿、恰为消息时消费；
 *  - 降级路径（`sessions.create` 缺席/失败）：回落 `startSession`（keep 语义）+ 注释
 *    toast，标记无 SessionId 判据，消费退回「草稿等校验」口径；
 *  - 一次性消费 → 有绑定模型先切后发（autoSend=false 仅落稿/切模型）→ 成功后清标记；
 *  - 链路防重入（cooldown 窗内的重复点击忽略；`createActionGate` 可跨链路共享——
 *    add-cosmos-constellation-actions 的星座动作与提案动作同门，任一运行中互相忽略）；
 *  - ⑤ 显式关联绑定（fix-cosmos-association-scope）：新会话取得 SessionId 后**非阻断**
 *    调用注入的 `bindSession`（不 await 呈现、失败静默）——降级路径无新会话 id，
 *    天然跳过；绑定只是可视化纠偏，失败退回启发式推断。
 *
 * 星胚动作（add-cosmos-action-prestate-gate 3.x）：`preState: "proto"` 的按钮由
 * `createEmbryoActionExecutor` 承接——消息无 @提案引用（`assembleEmbryoMessage`）、
 * 目标 = 星胚组锚点探索会话（`explorationTargetOf` 做在册/归档解析）、独立标记通道、
 * 恒不新建会话；守卫一律 toast 不回落新建。
 *
 * 星胚直执行（add-cosmos-embryo-dismiss-button 2.x）：`preState: "proto"` ∧
 * `embryoDismiss: true` 的按钮由 `createEmbryoDismissExecutor` 承接——选中星胚合并卡的
 * 整组 `slugs[]` **顺序**调用既有 dismiss 单条请求（不短路），聚合 outcome 经 `notify`
 * 呈现；零会话依赖（不解析 sessionId、不导航、不登记标记/草稿、不关整页），与提案/星胚
 * 执行体共享同一冷却门（整组期间门保持占用）。
 */
import { actionButtonVisible, isEmbryoDismissButton } from "./buttons.mjs";
import { proposalDirOf } from "./panel.mjs";

/** 一次性标记的过期窗口（design D5：约 10s）。 */
export const PENDING_ACTION_TTL_MS = 10_000;
/** 执行链路防重入冷却窗（整页随即关闭，窗仅防同帧/连点竞态）。 */
export const ACTION_COOLDOWN_MS = 800;

/**
 * 链路防重入门（spec cosmos-constellation-actions「防重入」：星座按钮与提案动作按钮
 * **共享**同一冷却门）。
 *
 * 纯状态机：`canEnter()` 只观测，「验证通过后」再 `enter()` 占位（与既有执行器
 * 「先校验、后置位」的顺序一致——非法点击不推进冷却基准）；`exit()` 释放运行位。
 * 两族执行器各自持有一个门，或被注入同一个门实例。
 * @param {{now?: () => number, cooldownMs?: number}} [options]
 * @returns {{canEnter: Function, enter: Function, exit: Function, peek: Function, cooldownMs: number}}
 */
export function createActionGate(options = {}) {
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const cooldownMs = Number.isFinite(options.cooldownMs) ? options.cooldownMs : ACTION_COOLDOWN_MS;
  let running = false;
  let lastAt = Number.NEGATIVE_INFINITY;
  return {
    /** 现在是否可进入（未运行且已过冷却窗）。 */
    canEnter() {
      return !running && now() - lastAt >= cooldownMs;
    },
    /** 占位进入（同时推进冷却基准）；不可进入时返回 false。 */
    enter() {
      if (!this.canEnter()) return false;
      running = true;
      lastAt = now();
      return true;
    },
    /** 释放运行位（冷却基准保留，窗内重复点击仍被忽略）。 */
    exit() {
      running = false;
    },
    /** 观测面（冒烟用）。 */
    peek() {
      return { running, lastAt };
    },
    get cooldownMs() {
      return cooldownMs;
    }
  };
}

/**
 * 按钮模型绑定的容错读取（客户端投影）：非法/缺省 → undefined（未绑定）；
 * 键序固定 provider → model → reasoningEffort，无等级 MUST NOT 输出该键。
 * @param {unknown} raw
 * @returns {{provider: string, model: string, reasoningEffort?: string}|undefined}
 */
export function buttonModelOf(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  const provider = typeof raw.provider === "string" ? raw.provider.trim() : "";
  const id = typeof raw.model === "string" ? raw.model.trim() : "";
  if (!provider || !id) return undefined;
  const effort = typeof raw.reasoningEffort === "string" ? raw.reasoningEffort.trim() : "";
  return effort ? { provider, model: id, reasoningEffort: effort } : { provider, model: id };
}

/**
 * 组装目标消息（spec 两个组装场景 + prepend 语义重定义）：
 * `@<提案目录>` = `@` + 提案目录绝对路径（正斜杠）；`prepend` 为真 = 提示词在前。
 * 目录缺失（工作区 path 不可得）→ ""（调用方 MUST 拒绝执行，不产生半截 @引用）。
 *
 * 实现抽到零依赖 `message.mjs`（add-cosmos-action-queue 3.2）：宿主半区队列投递
 * （session-executor）与浏览器半区动作条链路共用同一口径，避免两端复制后漂移；此处仅
 * 原样转出，调用方 API 不变。
 */
import { assembleMessage } from "./message.mjs";

export { assembleMessage };

/**
 * 星胚动作消息组装（add-cosmos-action-prestate-gate 3.1 / spec「星胚动作执行链路」①）：
 * 消息 = 按钮 `prompt`（纯文本，**无 @提案目录引用**——提案目录尚不存在；`prepend`
 * 恒忽略，「先后」无语义）；选中星胚组含多个推荐 slug 时，prompt 之后逐行附 slug
 * 清单（纯文本，单 slug/无 slug 组不附）。
 * @param {{prompt?: string}|null} button
 * @param {{slugs?: unknown}|null} card 星胚合并卡片（`slugs: string[]`）
 * @returns {string} 空串 = 无 prompt（调用方拒执行）
 */
export function assembleEmbryoMessage(button, card) {
  const prompt = typeof button?.prompt === "string" ? button.prompt : "";
  if (!prompt.trim()) return "";
  const slugs = Array.isArray(card?.slugs)
    ? card.slugs
      .filter((slug) => typeof slug === "string" && slug.trim())
      .map((slug) => slug.trim())
    : [];
  return slugs.length > 1 ? prompt + "\n" + slugs.join("\n") : prompt;
}

/**
 * 探索会话目标解析（add-cosmos-action-prestate-gate 3.4 / spec ②无 sessionId 禁用）：
 * 锚点 `sessionId` 为空 → `no-session`（按钮禁用提示，不组装不导航）；命中归档集合
 * → `archived`；会话镜像可用时不在册 → `missing`；否则 `ok`。镜像不可达
 * （`sessionIds` 非数组）时不做在册判定（老宿主降级，行为不阻断）。
 * @param {{sessionId?: unknown, sessionIds?: string[]|null, archivedSessionIds?: string[]|null}} [input]
 * @returns {{ok: boolean, reason: "ok"|"no-session"|"archived"|"missing", sessionId: string}}
 */
export function explorationTargetOf(input = {}) {
  const sessionId = typeof input.sessionId === "string" ? input.sessionId.trim() : "";
  if (!sessionId) return { ok: false, reason: "no-session", sessionId: "" };
  const archived = Array.isArray(input.archivedSessionIds) ? input.archivedSessionIds : null;
  if (archived !== null && archived.includes(sessionId)) return { ok: false, reason: "archived", sessionId };
  const ids = Array.isArray(input.sessionIds) ? input.sessionIds : null;
  if (ids !== null && !ids.includes(sessionId)) return { ok: false, reason: "missing", sessionId };
  return { ok: true, reason: "ok", sessionId };
}

/**
 * 草稿等校验（spec「草稿不一致不误发」）：归一化后逐字符相等才算一致。
 * 归一化 = 统一换行符 + 去每行尾空白 + trim（编辑器可能重排段落/尾换行，逐字节比较
 * 会把「内容其实一致」误判为不一致而永不自送）。
 * @param {unknown} draft 会话输入区草稿
 * @param {unknown} message 组装消息
 * @returns {boolean}
 */
export function draftMatches(draft, message) {
  if (typeof draft !== "string" || typeof message !== "string" || message === "") return false;
  return normalizeDraft(draft) === normalizeDraft(message);
}

function normalizeDraft(text) {
  return text.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trim();
}

/**
 * 草稿是否为空（spec「自动发送 hero 接力」/「浮窗输入器」的落稿前置）：
 * 恒新建路径下目标会话草稿恒空——空稿才允许 `setDraft` 写入，**既有非空草稿
 * MUST NOT 被改写**。非字符串按空处理（调用方未取到草稿 = 未编辑）。
 * @param {unknown} draft
 * @returns {boolean}
 */
export function isBlankDraft(draft) {
  return typeof draft !== "string" || draft.trim() === "";
}

/**
 * 标记消费就绪判定（双口径；hero 消费器与星座浮窗消费器共用同一口径）。
 *
 * - **新路径**（标记含 `targetSessionId`，fix-cosmos-action-draft-block D2）：
 *   ① 本会话 id MUST 与目标相等——不一致（无关 blank、导航被取代）→ `session`，
 *   MUST NOT 读草稿/落稿/提交/清标记；② 草稿为空且标记带落稿意图 → `fill`
 *   （先 `setDraft` 落稿，等草稿到位后的下一轮再消费——「落稿即所见」不依赖
 *   宿主 `setDraft → submit` 同刻时序）；③ 草稿恰为组装消息 → `consume`。
 * - **降级路径**（标记无 `targetSessionId`，`startSession` 已负责落稿）：
 *   沿用草稿等校验——恰为组装消息才 `consume`（不一致即复用了他人草稿的 blank，
 *   不提交、不清标记）。
 *
 * @param {{entry: object|null, sessionId?: unknown, draft?: unknown}} [input]
 * @returns {{action: "skip"|"fill"|"consume", reason: "idle"|"session"|"draft"|"fill"|"ok"}}
 */
export function pendingReadinessOf(input = {}) {
  const entry = input.entry ?? null;
  if (!entry) return { action: "skip", reason: "idle" };
  const target = typeof entry.targetSessionId === "string" ? entry.targetSessionId : "";
  if (target && input.sessionId !== target) return { action: "skip", reason: "session" };
  if (draftMatches(input.draft, entry.message)) return { action: "consume", reason: "ok" };
  if (entry.setDraft === true && isBlankDraft(input.draft)) return { action: "fill", reason: "fill" };
  return { action: "skip", reason: "draft" };
}

/**
 * 一次性 pendingAction 标记 store（design D5：模块/fiber 作用域，整页卸载不丢）。
 *
 * 除 arm/read/peek/clear 外提供**变更订阅**（`subscribe` + `getVersion`）：
 * 星座浮窗条目在会话内常驻，需要感知「新标记登记」以重新走门控（add-cosmos-
 * constellation-actions 4.1；hero 通道不消费该能力，行为不受影响）。
 * @param {{now?: () => number, ttlMs?: number}} [options]
 * @returns {{arm: Function, read: Function, peek: Function, clear: Function, isArmed: Function,
 *          subscribe: Function, getVersion: Function}}
 */
export function createPendingActionStore(options = {}) {
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : PENDING_ACTION_TTL_MS;
  let current = null;
  let seq = 0;
  let version = 0;
  const listeners = new Set();
  const notify = () => {
    version += 1;
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        console.error("[dsh-v-cosmos] marker store listener failed:", error);
      }
    }
  };
  return {
    /**
     * 登记（登记即覆盖旧标记；返回标记条目，含一次性 token）。
     *
     * `targetSessionId` = 恒新建路径的**目标会话**（`sessions.create` 返回的 id）：
     * 消费器按它精确匹配正确会话（取代草稿等校验作为主判据）；降级路径 MUST 置空
     * （无 id 判据，消费退回草稿等校验）。
     * `setDraft` = 落稿意图：`openSession` 不走宿主 `prepareDraft`，消息只能在消费
     * 相位经 `inputActions.setDraft` 写入——恒新建路径恒 `true`；降级路径由
     * `startSession` 负责落稿，恒 `false`。
     * `meta` 为调用方自用的**不透明负载**（星座浮窗用它携带标题栏信息；hero 通道不用）：
     * 只做「对象或 null」的浅校验，内容语义由消费方拥有。
     */
    arm({ message, model = null, submit = false, targetSessionId = null, setDraft = false, meta = null } = {}) {
      seq += 1;
      current = {
        token: seq,
        message: typeof message === "string" ? message : String(message ?? ""),
        model: model ?? null,
        submit: submit === true,
        targetSessionId: typeof targetSessionId === "string" && targetSessionId ? targetSessionId : null,
        setDraft: setDraft === true,
        meta: meta !== null && typeof meta === "object" && !Array.isArray(meta) ? meta : null,
        at: now()
      };
      notify(); // 新标记 → 通知常驻消费方重新门控（浮窗条目）
      return current;
    },
    /** 读取（过期即丢弃并返回 null：静默安全失败，不丢草稿、不误发）。 */
    read() {
      if (!current) return null;
      if (now() - current.at > ttlMs) {
        current = null;
        return null;
      }
      return current;
    },
    /** 不过期判定的观测面（冒烟用）。 */
    peek() {
      return current;
    },
    /** 清除：带 token 时仅当仍是该标记才清（防误清后登记的新标记）。 */
    clear(token) {
      if (!current) return false;
      if (token !== undefined && current.token !== token) return false;
      current = null;
      notify();
      return true;
    },
    isArmed() {
      return this.read() !== null;
    },
    /** 变更订阅（arm / clear 触发；返回退订函数）。 */
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** 变更版本号（`useSyncExternalStore` 快照面）。 */
    getVersion() {
      return version;
    },
    get ttlMs() {
      return ttlMs;
    }
  };
}

/**
 * 标记消费（fix-cosmos-action-draft-block D2/D3；spec「自动发送 hero 接力」）。
 * 调用方负责相位门控（hero 挂载面）与草稿读取；本函数只做就绪判定与
 * 「落稿 / 可选切换 → 可选提交 → 清标记」的原子序列。
 *
 * 双口径（`pendingReadinessOf`）：
 *  - 标记含 `targetSessionId`：id 不符 → `mismatch`（零落稿零提交零清除）；
 *    草稿为空 → 经 `setDraft` 落稿并返回 `filled`（标记保留，等草稿到位后下一轮
 *    消费——落稿即所见，不依赖宿主 `setDraft → submit` 同刻时序）；草稿恰为消息
 *    → 消费。
 *  - 标记无 `targetSessionId`（降级路径）：草稿等校验，不一致 → `mismatch`。
 *
 * @param {object} input
 * @param {object} input.pending createPendingActionStore
 * @param {string} [input.sessionId] 当前会话 id（恒新建路径的正确会话判据）
 * @param {string} input.draft 当前会话输入区草稿
 * @param {(text: string) => void} [input.setDraft] `inputActions.setDraft`（落稿）
 * @param {(model: object) => Promise<{ok: boolean, unavailable?: boolean, error?: string}>} [input.switchModel]
 * @param {() => void} [input.submit] `inputActions.submit`
 * @param {(text: string, isError?: boolean) => void} [input.notify] toast 通道
 * @param {object} [input.labels] 文案（switchFailed / switchUnavailable）
 * @returns {Promise<{status: "idle"|"mismatch"|"filled"|"submitted"|"switched",
 *          reason?: "idle"|"session"|"draft"|"no-draft-writer", token?: number, switched?: boolean}>}
 */
export async function consumePendingAction(input) {
  const pending = input?.pending;
  if (!pending) return { status: "idle" };
  const entry = pending.read();
  if (!entry) return { status: "idle" };
  const readiness = pendingReadinessOf({ entry, sessionId: input.sessionId, draft: input.draft });
  if (readiness.action === "skip") {
    /* 会话 id 不符 / 草稿不一致（降级路径复用了已有草稿的 blank / 导航被取代 / 无关
       blank 挂载）：MUST NOT 落稿、MUST NOT 提交、MUST NOT 清标记——等正确会话出现
       或标记过期。 */
    return { status: "mismatch", reason: readiness.reason };
  }
  if (readiness.action === "fill") {
    /* 空稿落稿：只写草稿，标记保留（下一轮草稿到位后按提交意图消费）。 */
    if (typeof input.setDraft !== "function") return { status: "mismatch", reason: "no-draft-writer" };
    input.setDraft(entry.message);
    return { status: "filled", token: entry.token };
  }
  let switched = false;
  if (entry.model) {
    let outcome = null;
    try {
      outcome = await input.switchModel?.(entry.model);
    } catch (error) {
      outcome = { ok: false, error: String(error?.message || error) };
    }
    switched = outcome?.ok === true;
    if (!switched) {
      /* 切换失败 MUST NOT 阻断后续动作：toast 提示，autoSend 仍以会话当前模型提交。 */
      const unavailable = outcome?.unavailable === true;
      const detail = typeof outcome?.error === "string" ? outcome.error : "";
      input.notify?.(
        unavailable ? input.labels?.switchUnavailable ?? "模型切换不可用" : (input.labels?.switchFailed ?? "模型切换失败：") + detail,
        true
      );
    }
  }
  if (entry.submit) input.submit?.();
  pending.clear(entry.token);
  return { status: entry.submit ? "submitted" : "switched", switched };
}

/**
 * 点击执行链路（fix-cosmos-action-draft-block D1/D3/D4/D5；spec「点击执行链路」+「防重入」）：
 * 组装 → **恒新建会话**（`createSession`）→ 登记标记（绑定目标 SessionId + 落稿意图，
 * 无论 `autoSend`/模型是否配置均登记）→ `openSession(新会话 id)` → 页面流转：
 * 按**该按钮**的 `jumpNewSession`（缺省 true = 跳转）分流——跳转 = `closePage()`；
 * 不跳转 = `keepPage()`（整页保持，新会话已在覆盖层底下创建；草稿由 hero 相位落稿）。
 *
 * 用户既有会话与其未发送草稿**零接触**：MUST NOT 复用/覆盖/归档任何既有 blank，
 * 主路径 MUST NOT 调用 `startSession`（其 `whenDraftExists` 语义只活在降级路径）。
 *
 * **降级路径**：`createSession` 缺席或抛错 → toast 注明降级 + 回落
 * `startSession(工作区, 消息)`（keep 语义；`startSession` 自身负责落稿，标记无
 * SessionId 判据、消费退回草稿等校验）。各步失败 → 清标记 + toast，页面保持。
 *
 * @param {object} options
 * @param {object} options.pending createPendingActionStore
 * @param {(wsId: string, card: object) => Promise<string>} [options.createSession] 官方
 *        `ctx.sessions.create({ workspaceId })` 的薄包装（返回新会话 id；MUST NOT 传
 *        `sessionId`——缺省恒新建 blank）
 * @param {(sessionId: string) => void} [options.openSession] 官方
 *        `ctx.uiWorkspace.openSession(会话 id)` 的薄包装（仅导航，不关页、不改草稿）
 * @param {(wsId: string, message: string, card: object) => unknown} [options.startSession]
 *        **降级路径**用的官方 `uiWorkspace.startSession(workspaceId, { prompt })` 薄包装
 *        （第三参为卡片，供实现侧按路径解析权威 workspaceId）
 * @param {(input: {sessionId: string, proposals: string[]}) => Promise<unknown>} [options.bindSession]
 *        **⑤ 显式关联绑定**：新会话 SessionId 取得后非阻断调用（不 await、失败静默；
 *        缺省不绑定——老宿主/测试面行为不变）。降级路径（无新会话 id）MUST 跳过。
 * @param {(context?: {autoSend?: boolean}) => void} [options.closePage] 按钮
 *        `jumpNewSession !== false` 时调用（关页跳转）；`context.autoSend` 供注入方在
 *        独立窗口「跳转被抑制」时附加如实反馈（MUST NOT 据此承诺自动发送）
 * @param {() => void} [options.keepPage] 按钮 `jumpNewSession === false` 时调用（保持整页，
 *        由注入方呈现反馈 toast）
 * @param {(text: string, isError?: boolean) => void} [options.notify]
 * @param {object} [options.labels] 文案（degraded——降级注释；缺省内置中文）
 * @param {() => number} [options.now] 私有门的时钟（未注入 gate 时生效）
 * @param {number} [options.cooldownMs] 私有门的冷却窗（未注入 gate 时生效）
 * @param {object} [options.gate] **跨链路共享**的防重入门（星座动作与提案动作同门；
 *        缺省=私有门，行为与从前逐字一致）
 * @returns {{run: (input: {button: object, card: object}) => Promise<object>}}
 */
export function createActionExecutor(options = {}) {
  const pending = options.pending;
  const createSession = typeof options.createSession === "function" ? options.createSession : null;
  const openSession = typeof options.openSession === "function" ? options.openSession : null;
  const startSession = options.startSession;
  const closePage = typeof options.closePage === "function" ? options.closePage : () => {};
  const keepPage = typeof options.keepPage === "function" ? options.keepPage : () => {};
  const notify = typeof options.notify === "function" ? options.notify : () => {};
  const bindSession = typeof options.bindSession === "function" ? options.bindSession : null;
  const degradedLabel = typeof options.labels?.degraded === "string" && options.labels.degraded
    ? options.labels.degraded
    : "新建会话通道不可用，已降级为复用空白会话";
  const canCreateNew = createSession !== null && openSession !== null;
  const gate = options.gate ?? createActionGate({ now: options.now, cooldownMs: options.cooldownMs });

  /**
   * ⑤ 显式关联绑定（fix-cosmos-association-scope 3.2 / spec cosmos-actions ⑤）：
   * 新会话取得后**非阻断**声明目标提案的工作面——不 await（呈现不等待）、同步/异步
   * 失败一律吞掉（无 toast、无重试、不影响落稿与提交）。绑定失败只退回启发式推断。
   */
  const bindExplicitAssociation = (sessionId, card) => {
    if (bindSession === null) return;
    const proposal = typeof card?.id === "string" ? card.id : "";
    if (!proposal) return;
    try {
      const pendingBind = bindSession({ sessionId, proposals: [proposal] });
      if (pendingBind && typeof pendingBind.catch === "function") pendingBind.catch(() => {});
    } catch {
      /* 静默：绑定失败不影响链路其余步骤 */
    }
  };

  /** 降级回落（现行链路：`startSession` keep + 现行登记条件——`startSession` 已落稿）。 */
  const fallback = async (button, card, message, model, submit, jump, detail) => {
    notify(degradedLabel + (detail ? "：" + detail : ""));
    if (typeof startSession !== "function") {
      notify("创建会话不可用（当前宿主未提供）", true);
      return { ok: false, reason: "unavailable", degraded: true };
    }
    /* 降级路径沿用现行条件：仅需 hero 相位时（autoSend / 绑定模型）登记标记；
       标记无 SessionId 判据、无落稿意图（startSession 已把消息写进草稿）。 */
    const armed = submit || model !== undefined ? pending.arm({ message, model, submit }) : null;
    try {
      await startSession(card.wsId, message, card);
    } catch (error) {
      if (armed) pending.clear(armed.token); // 降级链路自身失败 → 清标记（外层报 start-failed）
      throw error;
    }
    if (jump) closePage({ autoSend: submit });
    else keepPage();
    return { ok: true, message, armed, degraded: true };
  };

  return {
    async run({ button, card } = {}) {
      if (!gate.canEnter()) return { ok: false, reason: "busy" };
      if (!card || typeof card.dir !== "string" || !card.dir) return { ok: false, reason: "no-target" };
      if (!button || typeof button.prompt !== "string") return { ok: false, reason: "no-button" };
      /* 点击复验（add-cosmos-action-prestate-gate 2.3 / spec「点击复验不过门即忽略」）：
         与渲染门控同一谓词；骨架刷新有秒级延迟窗口，复验失败按无动作处理（不组装、
         不导航、不消耗冷却窗）。调用方 MUST 传入点击瞬间的实时目标卡片。 */
      if (!actionButtonVisible(button, card)) return { ok: false, reason: "gate" };
      const message = assembleMessage(button, card);
      if (!message) return { ok: false, reason: "no-target" };
      if (!canCreateNew && typeof startSession !== "function") {
        notify("创建会话不可用（当前宿主未提供）", true);
        return { ok: false, reason: "unavailable" };
      }
      const model = buttonModelOf(button.model);
      const submit = button.autoSend === true;
      /* 每按钮「执行后跳转」：缺省 = 跳转（旧配置零迁移）。 */
      const jump = button.jumpNewSession !== false;
      if (!gate.enter()) return { ok: false, reason: "busy" };
      let armed = null;
      try {
        if (!canCreateNew) {
          /* 宿主未提供恒新建通道（老宿主）：直接降级，行为 = 今日。 */
          return await fallback(button, card, message, model, submit, jump, "当前宿主未提供新建会话通道");
        }
        let sessionId = "";
        try {
          sessionId = await createSession(card.wsId, card);
          if (typeof sessionId !== "string" || !sessionId) throw new Error("会话创建未返回有效 id");
        } catch (error) {
          /* 恒新建不可用（宿主拒绝/通道异常）：回落现行链路，toast 注明降级。 */
          return await fallback(button, card, message, model, submit, jump, String(error?.message || error));
        }
        /* ⑤ 显式关联绑定（spec ⑤）：取得 SessionId 后**非阻断**声明目标提案工作面；
           失败静默跳过（该会话退回启发式）。降级路径无新会话 id，天然不经过这里。 */
        bindExplicitAssociation(sessionId, card);
        /* 标记必须先于 openSession：新会话 hero 相位可能在导航完成瞬间挂载。
           恒新建路径恒登记（autoSend=false 也要落稿），判据 = 目标 SessionId。 */
        armed = pending.arm({ message, model, submit, targetSessionId: sessionId, setDraft: true });
        openSession(sessionId);
        if (jump) closePage({ autoSend: submit });
        else keepPage();
        return { ok: true, message, armed, sessionId, degraded: false };
      } catch (error) {
        if (armed) pending.clear(armed.token);
        const detail = String(error?.message || error);
        notify("创建会话失败：" + detail, true);
        return { ok: false, reason: "start-failed", error: detail };
      } finally {
        gate.exit();
      }
    }
  };
}

/**
 * 星胚动作执行链路（add-cosmos-action-prestate-gate 3.1–3.2 / spec「星胚动作执行链路」）：
 *
 * `preState === "proto"` 的按钮**固定把消息发往当初探索的会话**（星胚组锚点 `sessionId`），
 * MUST NOT 创建任何会话、MUST NOT 回落新建：
 *  ① 目标解析（`resolveTarget`，缺省 = 卡片 `sessionId` 直接判空）：无 `sessionId`
 *     → `no-session`（呈现层禁用提示，不组装不导航）；缺失/归档 → toast
 *     「探索会话不可用」；运行中 → toast 不打断；
 *  ② 消息 = `assembleEmbryoMessage`（prompt，无 @引用；多 slug 附逐行清单）；
 *  ③ 一次性标记（**独立通道 store**，与提案 hero、星座浮窗互不读写）绑定探索会话 id
 *     与落稿意图，**先于导航**登记；
 *  ④ `openSession(探索会话)`（当前会话幂等）→ 按该按钮 `jumpNewSession` 分流：
 *     跳转（缺省）= `closePage`；不跳转 = `keepPage`（探索会话在覆盖层底下落稿/发送）。
 *
 * 防重入与提案动作**共享同一冷却门**（`options.gate`）。
 *
 * @param {object} options
 * @param {object} options.pending 星胚专用一次性标记 store（`createPendingActionStore`）
 * @param {(card: object) => {ok: boolean, reason: string, sessionId: string}} [options.resolveTarget]
 *        目标解析（客户端注入：镜像在册 + 归档集合 + 运行中状态；缺省仅判空）
 * @param {(sessionId: string) => void} [options.openSession] 官方 `uiWorkspace.openSession`
 * @param {() => void} [options.closePage] 跳转分支（关整页）
 * @param {() => void} [options.keepPage] 不跳转分支（保持整页，注入方呈现 toast）
 * @param {(text: string, isError?: boolean) => void} [options.notify]
 * @param {{unavailable?: string, running?: string, failed?: string}} [options.labels]
 * @param {object} [options.gate] 与提案动作共享的防重入门
 * @returns {{run: (input: {button: object, card: object}) => Promise<object>}}
 */
export function createEmbryoActionExecutor(options = {}) {
  const pending = options.pending;
  const openSession = typeof options.openSession === "function" ? options.openSession : null;
  const closePage = typeof options.closePage === "function" ? options.closePage : () => {};
  const keepPage = typeof options.keepPage === "function" ? options.keepPage : () => {};
  const notify = typeof options.notify === "function" ? options.notify : () => {};
  const resolveTarget = typeof options.resolveTarget === "function"
    ? options.resolveTarget
    : (card) => explorationTargetOf({ sessionId: card?.sessionId });
  const unavailableLabel = typeof options.labels?.unavailable === "string" && options.labels.unavailable
    ? options.labels.unavailable
    : "探索会话不可用";
  const runningLabel = typeof options.labels?.running === "string" && options.labels.running
    ? options.labels.running
    : "探索会话正在执行，未打断";
  const failedLabel = typeof options.labels?.failed === "string" && options.labels.failed
    ? options.labels.failed
    : "发送到探索会话失败：";
  const gate = options.gate ?? createActionGate({ now: options.now, cooldownMs: options.cooldownMs });

  return {
    async run({ button, card } = {}) {
      if (!gate.canEnter()) return { ok: false, reason: "busy" };
      if (!button || typeof button.prompt !== "string") return { ok: false, reason: "no-button" };
      /* 调度守卫：非星胚按钮 MUST NOT 走本链路（页面按此判据分流）。 */
      if (button.preState !== "proto") return { ok: false, reason: "not-proto" };
      /* 点击复验：与渲染门控同一谓词（前置于目标解析，失败不组装不导航）。 */
      if (!actionButtonVisible(button, card)) return { ok: false, reason: "gate" };
      const target = resolveTarget(card);
      const targetReason = typeof target?.reason === "string" ? target.reason : "missing";
      if (!target || target.ok !== true) {
        /* 无 sessionId = 旧锚点：呈现层禁用 + title 提示，点击静默早退（不导航不组装）。 */
        if (targetReason === "no-session") return { ok: false, reason: targetReason };
        notify(targetReason === "running" ? runningLabel : unavailableLabel, true);
        return { ok: false, reason: targetReason };
      }
      if (pending === null || typeof pending?.arm !== "function") return { ok: false, reason: "unavailable" };
      const message = assembleEmbryoMessage(button, card);
      if (!message) return { ok: false, reason: "no-message" };
      if (openSession === null) {
        notify(unavailableLabel, true);
        return { ok: false, reason: "unavailable" };
      }
      const model = buttonModelOf(button.model);
      const submit = button.autoSend === true;
      const jump = button.jumpNewSession !== false;
      if (!gate.enter()) return { ok: false, reason: "busy" };
      let armed = null;
      try {
        /* 标记必须先于 openSession：探索会话已为当前会话时 dock 经订阅原地消费。 */
        armed = pending.arm({ message, model, submit, targetSessionId: target.sessionId, setDraft: true });
        openSession(target.sessionId);
        if (jump) closePage();
        else keepPage();
        return { ok: true, message, armed, sessionId: target.sessionId };
      } catch (error) {
        if (armed) pending.clear(armed.token);
        const detail = String(error?.message || error);
        notify(failedLabel + detail, true);
        return { ok: false, reason: "send-failed", error: detail };
      } finally {
        gate.exit();
      }
    }
  };
}

/** 计为成功的 outcome（幂等重删 `already-missing` 按中性成功计）。 */
const DISMISS_SUCCESS_OUTCOMES = new Set(["deleted", "already-missing"]);

/** 组级聚合文案键（`getDismissLabels` 读取面；缺键回落内置中文基线）。 */
const DISMISS_GROUP_LABEL_KEYS = Object.freeze(["all", "partial", "none"]);

/**
 * 组级聚合文案基线（中文；客户端经 `getDismissLabels` 注入 locale 同源词典。
 * 占位：`{count}` 全部成功计数、`{removed}`/`{total}` 部分成功分数、`{reason}` 首条失败文案）。
 */
const DEFAULT_DISMISS_GROUP_LABELS = Object.freeze({
  all: "已移除 {count} 个星胚",
  partial: "已移除 {removed}/{total}（首条失败：{reason}）",
  none: "未移除（{reason}）"
});

/**
 * 星胚直执行链路（add-cosmos-embryo-dismiss-button 2.1–2.5 / spec cosmos-actions
 * 「星胚直执行执行链路」、spec cosmos-embryo-dismiss「动作条直执行移除入口」）：
 *
 * `preState === "proto"` 且 `embryoDismiss === true` 的按钮点击即**整组顺序删**——
 *  ① 目标解析：选中面板卡须 `isEmbryo === true`；目标 = `card.wsId` 与整组 `card.slugs[]`
 *     （数组防御：非字符串/空白 slug 过滤，过滤后为空 → `no-target` 静默早退；缺卡/非星胚
 *     卡同样静默早退，不 toast）；
 *  ② 点击复验：与渲染门控同一谓词（`actionButtonVisible`：proto ∧ 沉睡），不过 → `gate`
 *     早退（不消耗冷却窗、零请求）；
 *  ③ 逐条 `await dismissOne({workspaceId, slug})`：**单条失败不短路**（后续 slug 照常
 *     发出）；客户端 `dismissEmbryo` 单条执行体恒返回 `{outcome, tone, text}`，抛错按
 *     `failed` 计；
 *  ④ 聚合：`deleted` / `already-missing` 计成功（幂等重删按中性计）；单 slug 组沿用单条
 *     outcome 文案；多 slug 组三态——全部成功 / 部分成功（携带首条失败理由）/ 全部失败，
 *     经 `notify` 呈现（与提案/星胚执行体同源通道）；
 *  ⑤ 防重入：与提案/星胚动作**共享同一冷却门**（`options.gate` 注入），`gate.enter()`
 *     覆盖整组、`finally` 释放——组内请求期间重复点击被忽略；
 *  ⑥ 零副作用：MUST NOT 解析 sessionId、不导航、不登记标记/落草稿、不关整页、不写任何
 *     openspec 工件（删除仅经服务端端点）；呈现收敛交给既有 fs.watch → 骨架差分管道。
 *
 * @param {object} options
 * @param {(input: {workspaceId: string, slug: string}) => Promise<{outcome?: string, tone?: string, text?: string}>}
 *        [options.dismissOne] 单条移除请求（客户端 `actions.dismissEmbryo`；toast 已拆出）
 * @param {(text: string) => void} [options.notify] 呈现通道（与提案/星胚执行体同源 toast）
 * @param {() => ({all?: string, partial?: string, none?: string})} [options.getDismissLabels]
 *        组级聚合文案源（词典读取面；缺键/抛错回落内置中文基线）。占位：
 *        `{count}` / `{removed}` / `{total}` / `{reason}`
 * @param {object} [options.gate] 与提案/星胚动作共享的防重入门
 * @param {() => number} [options.now] 私有门的时钟（未注入 gate 时生效）
 * @param {number} [options.cooldownMs] 私有门的冷却窗（未注入 gate 时生效）
 * @returns {{run: (input: {button: object, card: object}) => Promise<object>}}
 */
export function createEmbryoDismissExecutor(options = {}) {
  const dismissOne = typeof options.dismissOne === "function" ? options.dismissOne : null;
  const notify = typeof options.notify === "function" ? options.notify : () => {};
  const getDismissLabels = typeof options.getDismissLabels === "function" ? options.getDismissLabels : null;
  const gate = options.gate ?? createActionGate({ now: options.now, cooldownMs: options.cooldownMs });
  const labelsOf = () => {
    const labels = { ...DEFAULT_DISMISS_GROUP_LABELS };
    if (getDismissLabels === null) return labels;
    try {
      const injected = getDismissLabels();
      if (injected !== null && typeof injected === "object") {
        for (const key of DISMISS_GROUP_LABEL_KEYS) {
          if (typeof injected[key] === "string" && injected[key]) labels[key] = injected[key];
        }
      }
    } catch {
      /* 词典不可达 → 内置中文基线（MUST NOT 阻断移除） */
    }
    return labels;
  };

  return {
    async run({ button, card } = {}) {
      if (!gate.canEnter()) return { ok: false, reason: "busy" };
      /* 调度守卫：非直执行按钮 MUST NOT 走本链路（客户端按同一谓词分流）。 */
      if (!isEmbryoDismissButton(button)) return { ok: false, reason: "not-direct" };
      /* 目标解析（2.2）：缺卡 / 非星胚卡 / 无可用 slug → 静默早退（不 toast、零请求）。 */
      const workspaceId = typeof card?.wsId === "string" ? card.wsId : "";
      const slugs = card?.isEmbryo === true && Array.isArray(card.slugs)
        ? card.slugs
          .filter((slug) => typeof slug === "string" && slug.trim().length > 0)
          .map((slug) => slug.trim())
        : [];
      if (!workspaceId || slugs.length === 0) return { ok: false, reason: "no-target" };
      /* 点击复验：与渲染门控同一谓词（探索会话活跃 → 入口本就不呈现，点击亦不执行）。 */
      if (!actionButtonVisible(button, card)) return { ok: false, reason: "gate" };
      if (dismissOne === null) return { ok: false, reason: "unavailable" };
      if (!gate.enter()) return { ok: false, reason: "busy" };
      try {
        const items = [];
        /* 整组顺序删（2.3）：逐条 await、单条失败不短路。 */
        for (const slug of slugs) {
          let notice = null;
          try {
            notice = await dismissOne({ workspaceId, slug });
          } catch (error) {
            notice = { outcome: "failed", tone: "error", text: String(error?.message || error) };
          }
          items.push({
            slug,
            outcome: typeof notice?.outcome === "string" ? notice.outcome : "",
            tone: typeof notice?.tone === "string" ? notice.tone : "",
            text: typeof notice?.text === "string" ? notice.text : ""
          });
        }
        const total = items.length;
        const failures = items.filter((item) => !DISMISS_SUCCESS_OUTCOMES.has(item.outcome));
        const removed = total - failures.length;
        const firstFailure = failures[0] ?? null;
        let tone = "";
        let text = "";
        if (total === 1) {
          /* 单 slug 组：沿用单条 outcome 文案（行为与旧单星粒度一致）。 */
          tone = items[0].tone;
          text = items[0].text;
        } else if (removed === total) {
          tone = "ok";
          text = labelsOf().all.replace("{count}", String(total));
        } else if (removed === 0) {
          tone = "error";
          text = labelsOf().none.replace("{reason}", firstFailure.text);
        } else {
          tone = "warn";
          text = labelsOf().partial
            .replace("{removed}", String(removed))
            .replace("{total}", String(total))
            .replace("{reason}", firstFailure.text);
        }
        if (text) notify(text);
        /* 执行摘要（2.5，冒烟直测观测面）：`ok` = 组内全部成功。 */
        const summary = {
          ok: removed === total,
          removed,
          total,
          tone,
          text,
          outcome: total === 1 ? items[0].outcome : removed === total ? "deleted" : "partial",
          items
        };
        if (firstFailure !== null) {
          summary.firstFailure = { slug: firstFailure.slug, outcome: firstFailure.outcome, text: firstFailure.text };
        }
        return summary;
      } finally {
        gate.exit();
      }
    }
  };
}

/* 供 client 侧组装的路径工具（与 panel.mjs 同源，避免两处口径漂移）。 */
export { proposalDirOf };
