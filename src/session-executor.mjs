/**
 * dsh-v-cosmos — 进程内会话执行器（swap-cosmos-queue-native-executor 1.1，替换 queen-client.mjs）。
 *
 * 执行通道 = 宿主核心服务 `sessionController` 的**进程内直投**（零配置，零外部插件依赖）：
 *
 * ```
 *  create({workspaceId}) → {sessionId}
 *    → selectModel({sessionId, …model})        条目快照绑定模型时（失败 = model-unavailable）
 *    → rename({sessionId, title})              队列·<按钮名>·<提案名>（失败不阻断，warn 继续）
 *    → bindAssociation({sessionId, proposal, workspaceId})
 *                                              显式关联绑定（可选注入；失败不阻断，warn 继续）
 *    → prompt({requestId, sessionId, mode:"queue", content:[{type:"text", text}]}, signal)
 * ```
 *
 * 冷读（重启对账）= 活体优先 `agents.get(id).status`，非活体回落 `list({})` 摘要；两者皆
 * 不可得且归档集合不命中 → `session-gone`（由调度器按既有语义归类）。
 *
 * **失败语义（spec「执行通道」）**：任何不可用/拒绝都返回显式原因，MUST NOT 回落前台
 * hero 通道；`queue-scheduler.mjs` 状态机与注入接口（`deliver` / `readSession`）零改动。
 * 原因族见 `SESSION_FAILURES`。调用签名照抄 queen 生产实证的宿主形状（`prompt` / `list`
 * 为 `(request, signal?)` 双参，`create` / `selectModel` / `rename` 为单参）。
 */

import { randomUUID } from "node:crypto";
import { assembleMessage } from "./message.mjs";

/** 队列标题组装上限（码点；宿主 rename 另按字节预算保头截尾，装饰性失败不阻断投递）。 */
export const SESSION_TITLE_MAX_CHARS = 400;

/** 投递链在 `sessionController` 上依赖的方法（任一缺失 → 零请求显式 `session-controller-unavailable`）。 */
export const REQUIRED_SESSION_METHODS = Object.freeze(["create", "prompt", "selectModel", "rename"]);

/** 投递失败原因族（写入条目 `reason`，UI 呈现/测试断言共用）。 */
export const SESSION_FAILURES = Object.freeze([
  "session-controller-unavailable",
  "create-failed",
  "model-unavailable",
  "prompt-failed",
  "delivery-failed"
]);

/** 永不中止的 signal（官方 `prompt`/`list` 要求调用方提供 signal；网关路径自带）。 */
const NEVER_ABORTED_SIGNAL = new AbortController().signal;

/** 错误 → 可读文本（透出宿主自身说明，便于用户端诊断）。 */
function errorMessageOf(error) {
  const message = error !== null && typeof error?.message === "string" ? error.message : "";
  return message || String(error);
}

/** 逐项探测服务成员（缺方法或非函数都算缺失）。 */
function missingMembersOf(service, members) {
  if (service === undefined || service === null) return [...members];
  return members.filter((member) => typeof service[member] !== "function");
}

/** 告警出口（logger 缺失/形态异常都不放大为投递失败）。 */
function warn(logger, message) {
  try {
    logger?.warn?.("[dsh-v-cosmos] %s", message);
  } catch {
    /* ignore */
  }
}

/**
 * 标题组装（`队列·<按钮名>·<提案名>`，按码点截断）。
 * @param {object} entry 队列条目
 * @returns {string}
 */
export function queueTitleOf(entry) {
  const buttonName = typeof entry?.button?.name === "string" ? entry.button.name : "";
  const proposalId = typeof entry?.proposalId === "string" ? entry.proposalId : "";
  const raw = ["队列", buttonName, proposalId].filter((part) => Boolean(part)).join("·");
  const chars = Array.from(raw);
  return chars.length > SESSION_TITLE_MAX_CHARS ? chars.slice(0, SESSION_TITLE_MAX_CHARS).join("") : raw;
}

/**
 * 投递 payload 组装（纯函数，冒烟直测）：分解为四个命令各自的入参，不再拼单一 HTTP 体。
 *
 * @param {object} entry 队列条目
 * @returns {{ok: true, payload: {workspaceId: string, title: string, text: string, model?: object}} |
 *          {ok: false, reason: string, message: string}}
 */
export function deliverPayloadOf(entry) {
  const wsId = typeof entry?.wsId === "string" ? entry.wsId.trim() : "";
  if (!wsId) return { ok: false, reason: "delivery-failed", message: "条目缺少工作区 id" };
  const dir = typeof entry?.proposalDir === "string" ? entry.proposalDir : "";
  const text = assembleMessage({ prompt: entry?.button?.prompt, prepend: entry?.button?.prepend === true }, { dir });
  if (!text) return { ok: false, reason: "delivery-failed", message: "提案目录缺失，无法组装 @引用消息" };
  const payload = { workspaceId: wsId, title: queueTitleOf(entry), text };
  if (entry?.button?.model !== undefined) payload.model = entry.button.model;
  return { ok: true, payload };
}

/**
 * 建立投递器（`deliver(entry)` 形状见 queue-scheduler.mjs）。
 *
 * @param {object} options
 * @param {object|null} options.sessionController 宿主会话控制面（`inject` 声明的核心服务）
 * @param {object|null} [options.agents] 投递链不使用（仅冷读需要）；保留以与接线处同构构造
 * @param {object|null} [options.logger]
 * @param {(input: {sessionId: string, proposal: string, workspaceId: string}) => (void | Promise<void>)}
 *        [options.bindAssociation] 显式关联绑定（bind-queue-sessions-to-target D5）：
 *        在 rename 之后、prompt 之前 **await** 调用一次，清单恒为条目目标提案（trim 后非空
 *        才调用，空则跳过）。`workspaceId` 是条目工作区 id（宿主半区据此解析工作区**路径**）。
 *        同步/异步失败一律吞掉 + logger warn（不产生新失败原因族）。缺省 = 不绑定。
 * @returns {(entry: object) => Promise<object>}
 */
export function createQueueDeliverer(options = {}) {
  const sessionController = options.sessionController ?? null;
  const logger = options.logger ?? null;
  const bindAssociation = typeof options.bindAssociation === "function" ? options.bindAssociation : null;
  /* 工厂建立时探测一次：服务缺席/方法残缺 → 每条投递零请求显式失败（不抛穿调度器）。 */
  const missing = missingMembersOf(sessionController, REQUIRED_SESSION_METHODS);
  return async function deliver(entry) {
    if (missing.length > 0) {
      return {
        ok: false,
        reason: "session-controller-unavailable",
        message: `会话服务不可用（sessionController 缺少命令方法：${missing.join("/")}）`
      };
    }
    const built = deliverPayloadOf(entry);
    if (built.ok !== true) return built;
    const { workspaceId, title, text, model } = built.payload;

    let created;
    try {
      created = await sessionController.create({ workspaceId });
    } catch (error) {
      return { ok: false, reason: "create-failed", message: errorMessageOf(error) };
    }
    const sessionId = typeof created?.sessionId === "string" ? created.sessionId.trim() : "";
    if (!sessionId) {
      return { ok: false, reason: "create-failed", message: "会话服务未返回 sessionId" };
    }

    /* 模型不做预校验（用户决议 2026-11-19）：直接试 selectModel，失败即显式失败。
       快照形状 `{provider, model, reasoningEffort?}` 与宿主入参同名，直接透传。 */
    if (model !== undefined && model !== null && typeof model === "object") {
      try {
        await sessionController.selectModel({ sessionId, ...model });
      } catch (error) {
        return { ok: false, reason: "model-unavailable", message: errorMessageOf(error) };
      }
    }

    /* 标题纯装饰（辨识度非功能）：改名失败只告警，不阻断投递。
       宿主入参是**单对象**（`rename(sessionId, title)` 位置参数是 queen adapter 的包装）。 */
    try {
      await sessionController.rename({ sessionId, title });
    } catch (error) {
      warn(logger, `队列投递改名失败（不阻断投递）: ${errorMessageOf(error)}`);
    }

    /* 显式关联绑定（bind-queue-sessions-to-target 1.1 / spec「执行通道」）：队列会话出生
       即被认领——清单 = 条目目标提案（trim 后为空则跳过）。**先于 prompt 完成**（design D1：
       压制必须先于该会话任何上下文产生，宿主启发式首扫即生效）。失败语义与改名同级降级
       （design D3）：同步/异步/被拒一律吞掉 + warn，不产生新失败原因族、不影响条目成败
       判定；缺省不注入 = 不绑定，老调用方行为逐字不变。 */
    const proposal = typeof entry?.proposalId === "string" ? entry.proposalId.trim() : "";
    if (bindAssociation !== null && proposal) {
      try {
        await bindAssociation({ sessionId, proposal, workspaceId });
      } catch (error) {
        warn(logger, `队列会话关联绑定失败（不阻断投递）: ${errorMessageOf(error)}`);
      }
    }

    try {
      await sessionController.prompt(
        { requestId: randomUUID(), sessionId, mode: "queue", content: [{ type: "text", text }] },
        NEVER_ABORTED_SIGNAL
      );
    } catch (error) {
      return { ok: false, reason: "prompt-failed", message: errorMessageOf(error) };
    }
    return { ok: true, sessionId };
  };
}

/**
 * 建立冷读器（`readSession(sessionId)` 形状见 queue-scheduler.mjs）。
 *
 * 三分支：活体 `agents.get(id).status` → `list({})` 摘要命中 → 未命中 `gone`；
 * `list` 抛错/服务缺席 → `{ok:false, error}`（调度器保持 executing + 有界重试，耗尽显式失败）。
 *
 * @param {object} options
 * @param {object|null} options.sessionController
 * @param {object|null} options.agents
 * @returns {(sessionId: string) => Promise<object>}
 */
export function createSessionReader(options = {}) {
  const sessionController = options.sessionController ?? null;
  const agents = options.agents ?? null;
  return async function readSession(sessionId) {
    const id = typeof sessionId === "string" ? sessionId.trim() : "";
    if (!id) return { ok: false, gone: true };

    let agent = null;
    try {
      agent = agents?.get?.(id) ?? null;
    } catch {
      agent = null;
    }
    /* 活体优先：`agent.status` 与 `agent/status` 事件同口径（"idle" 之外一律视为运行中）。
       宿主侧不可见 pendingInteraction，`waiting` 恒 false——活体会话的等待态由实时瀑布
       观测覆盖（既有行为），重启时错过的那次瀑布无重放（spec 已知局限）。 */
    if (agent !== null && typeof agent?.status === "string") {
      return { ok: true, running: agent.status !== "idle", waiting: false };
    }

    if (typeof sessionController?.list !== "function") {
      return { ok: false, error: "会话服务不可用（sessionController.list 缺失）" };
    }
    let page;
    try {
      page = await sessionController.list({}, NEVER_ABORTED_SIGNAL);
    } catch (error) {
      return { ok: false, error: errorMessageOf(error) };
    }
    const items = Array.isArray(page?.items) ? page.items : [];
    const item = items.find((candidate) => candidate?.sessionId === id);
    if (item === undefined) return { ok: false, gone: true };
    return { ok: true, running: item.running === true, waiting: false };
  };
}
