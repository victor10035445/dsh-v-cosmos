/**
 * dsh-v-cosmos — 提案动作自动执行队列的存储层（add-cosmos-action-queue 2.1）。
 *
 * 纯逻辑 + 单文件持久化：
 *  - 文档形状 `{ version: 1, queues: { <wsId>: { paused, pausedAt, entries: [...] } } }`
 *    ——**每星座恰好一个队列**，全部工作区聚合在单一 JSON（spec「每星座单队列模型」）。
 *  - 条目 = **入队快照**（`button` 为入队时刻按钮配置副本）：
 *      `{ id, wsId, proposalId, proposalDir, button: {name, prompt, model?, prepend?, preState?, team?},
 *         enqueuedAt, state, stateAt, sessionId?, startedAt?, reason?, message? }`
 *    `button.model` 仅在绑定了模型时输出、`button.prepend` 仅在勾选时输出（存储最小形，
 *    与 `buttons.mjs` 同口径）；`preState` / `team` 随快照定格——执行时刻复验用**入队时**的
 *    门控前置状态，不随配置漂移。`sessionId/startedAt/reason/message` 是状态机记账字段
 *    （spec 的条目形状之外的必需增量：没有它就无处放「投递到哪个会话 / 为什么失败」）。
 *  - 状态枚举 `queued | launching | executing | failed | skipped`；`running` / `等待决策`
 *    是 executing 的**呈现**子态（由会话交互态推导，不落枚举——spec 同款）。
 *  - 操作矩阵（spec「条目操作矩阵与复验跳过」）：排序仅 `queued`；移出/清空覆盖 `queued`
 *    与终态残留（failed/skipped）；**重试仅 `failed` 残留**（two-add-cosmos-queue-failed-entry-retry）
 *    ——转回 `queued` 并归队首；skipped 不提供重试（复验跳过语义下条目可随时经入队钮
 *    重新排队）；`launching` / `executing` 完全锁定（服务端拒绝；v1 无中止入口）。
 *    清空保留在途条目。
 *  - 在途上限 32（对齐 `MAX_BUTTONS`），只计 `queued/launching/executing`；终态残留不计数
 *    （残留可被移出/清空，不会无限堆积）；重试转回 `queued` 后重新计数（超限拒绝）。
 *  - 重复入队拒绝：同一 `(wsId, proposalId, button.name)` 已存在 **queued** 条目 → 拒绝
 *    （终态残留不构成重复——用户可重试失败条目；重试沿用**同一口径**：同组合已有 queued
 *    条目时重试被拒绝，failed 残留保持原样）。
 *
 * 原子写：temp 写（`.<uuid>.tmp`）+ `fsync` + `rename` 替换（与 index.mjs 关联存储同款）；
 * 读面容错：文件缺失/损坏/版本漂移 → 空文档（首写即建，无迁移）。
 */

import { randomUUID } from "node:crypto";
import { closeSync, fdatasyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isPreState, normalizeButtonModel } from "./buttons.mjs";

/** 队列文档版本（首版；版本漂移按空文档重建）。 */
export const QUEUE_VERSION = 1;
/** 在途条目上限（与动作按钮上限同量级）。 */
export const QUEUE_INFLIGHT_LIMIT = 32;
/** 条目状态枚举。 */
export const QUEUE_STATES = Object.freeze(["queued", "launching", "executing", "failed", "skipped"]);
/** 终态（残留）状态集合。 */
export const QUEUE_TERMINAL_STATES = Object.freeze(["failed", "skipped"]);
/** 排序方向枚举。 */
export const QUEUE_DIRECTIONS = Object.freeze(["up", "down"]);

const TERMINAL = new Set(QUEUE_TERMINAL_STATES);
const STATES = new Set(QUEUE_STATES);

/**
 * 队列存储文件路径（`$DSH_HOME/storages/dsh-v-cosmos.queues.json`）：
 * 目录与关联存储同级（`storages/`），文件名带插件前缀避免与他插件撞名。
 * @param {{env?: Record<string, string|undefined>, home?: string}} [options]
 * @returns {string}
 */
export function resolveQueueStorePath(options = {}) {
  const env = options.env ?? process.env;
  const envHome = typeof env.DSH_HOME === "string" ? env.DSH_HOME.trim() : "";
  const home = options.home ?? (envHome || join(homedir(), ".dsh"));
  return join(home, "storages", "dsh-v-cosmos.queues.json");
}

/** 空文档。 */
export function emptyQueueDoc() {
  return { version: QUEUE_VERSION, queues: {} };
}

/**
 * 提案目录绝对路径（`<ws.path>/openspec/changes/<name>`，统一正斜杠）。
 *
 * 与 `panel.mjs` 的 `proposalDirOf` **同口径**（宿主半区不引入浏览器模块——
 * panel.mjs 经 merge/templates 链属于客户端产物，宿主侧不可达；此处独立实现并同冒烟
 * 断言）。空工作区路径/提案名 → ""（调用方据此拒绝组装）。
 * @param {unknown} wsPath
 * @param {unknown} name
 * @returns {string}
 */
export function proposalDirPath(wsPath, name) {
  const raw = typeof wsPath === "string" ? wsPath.trim() : "";
  const slug = typeof name === "string" ? name.trim() : "";
  if (!raw || !slug) return "";
  let base = raw.replace(/\\/g, "/");
  const unc = base.startsWith("//");
  base = base.replace(/\/{2,}/g, "/");
  if (unc && !base.startsWith("//")) base = "/" + base;
  base = base.replace(/\/+$/, "");
  return base + "/openspec/changes/" + slug;
}

/**
 * 条目归一化（读面容错）：形状非法 → null（该条丢弃，不波及其余）。
 * @param {unknown} raw
 * @returns {object|null}
 */
export function normalizeQueueEntry(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const wsId = typeof raw.wsId === "string" ? raw.wsId.trim() : "";
  const proposalId = typeof raw.proposalId === "string" ? raw.proposalId.trim() : "";
  const proposalDir = typeof raw.proposalDir === "string" ? raw.proposalDir.trim() : "";
  const state = typeof raw.state === "string" && STATES.has(raw.state) ? raw.state : "queued";
  if (!id || !wsId || !proposalId || !proposalDir) return null;
  const source = raw.button && typeof raw.button === "object" && !Array.isArray(raw.button) ? raw.button : null;
  const name = typeof source?.name === "string" ? source.name.trim() : "";
  const prompt = typeof source?.prompt === "string" ? source.prompt : "";
  if (!name || !prompt.trim()) return null;
  const button = { name, prompt };
  let model;
  try {
    model = normalizeButtonModel(source?.model, name);
  } catch {
    return null;
  }
  if (model !== undefined) button.model = model;
  if (source?.prepend === true) button.prepend = true;
  if (typeof source?.preState === "string" && isPreState(source.preState.trim())) {
    button.preState = source.preState.trim();
  }
  /* 团队启用键（add-cosmos-agent-team-toggle）：仅 true 随快照保留（入队即定格按钮配置；
     启用语义由各投递链自行消费——队列投递不启用，曲率 proto 直投按此启用）。 */
  if (source?.team === true) button.team = true;
  const enqueuedAt = Number.isFinite(Number(raw.enqueuedAt)) ? Number(raw.enqueuedAt) : 0;
  const stateAt = Number.isFinite(Number(raw.stateAt)) ? Number(raw.stateAt) : enqueuedAt;
  const entry = { id, wsId, proposalId, proposalDir, button, enqueuedAt, state, stateAt };
  if (typeof raw.sessionId === "string" && raw.sessionId.trim()) entry.sessionId = raw.sessionId.trim();
  if (Number.isFinite(Number(raw.startedAt)) && Number(raw.startedAt) > 0) entry.startedAt = Number(raw.startedAt);
  if (typeof raw.reason === "string" && raw.reason.trim()) entry.reason = raw.reason.trim();
  if (typeof raw.message === "string" && raw.message.trim()) entry.message = raw.message.trim();
  return entry;
}

/**
 * 队列归一化：`{paused, pausedAt, entries}`；脏条目丢弃、去重（同 id 先到先得）。
 * @param {unknown} raw
 * @returns {object}
 */
export function normalizeQueue(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const seen = new Set();
  const entries = [];
  for (const item of Array.isArray(source.entries) ? source.entries : []) {
    const entry = normalizeQueueEntry(item);
    if (entry === null || seen.has(entry.id)) continue;
    seen.add(entry.id);
    entries.push(entry);
  }
  const paused = source.paused === true;
  const pausedAt = paused && Number.isFinite(Number(source.pausedAt)) && Number(source.pausedAt) > 0
    ? Number(source.pausedAt)
    : 0;
  return { paused, pausedAt, entries };
}

/**
 * 文档归一化（版本漂移/损坏 → 空文档）。
 * @param {unknown} raw
 * @returns {{version: number, queues: Record<string, object>}}
 */
export function normalizeQueueDoc(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyQueueDoc();
  if (raw.version !== QUEUE_VERSION) return emptyQueueDoc();
  const queues = {};
  const source = raw.queues && typeof raw.queues === "object" && !Array.isArray(raw.queues) ? raw.queues : {};
  for (const [wsId, value] of Object.entries(source)) {
    const id = typeof wsId === "string" ? wsId.trim() : "";
    if (!id) continue;
    const queue = normalizeQueue(value);
    if (queue.entries.length === 0 && queue.paused !== true) continue;
    queues[id] = queue;
  }
  return { version: QUEUE_VERSION, queues };
}

/** 某星座队列（缺席 → 空队列；**不做持久化**）。 */
export function queueOf(doc, wsId) {
  const id = typeof wsId === "string" ? wsId.trim() : "";
  const queue = id ? doc?.queues?.[id] : undefined;
  return queue ?? { paused: false, pausedAt: 0, entries: [] };
}

/** 条目查找。 */
export function findEntry(doc, wsId, entryId) {
  const id = typeof entryId === "string" ? entryId : "";
  return queueOf(doc, wsId).entries.find((entry) => entry.id === id) ?? null;
}

/** 计数（`active` = 计入在途上限的数量）。 */
export function queueCountsOf(queue) {
  const entries = Array.isArray(queue?.entries) ? queue.entries : [];
  const counts = { total: entries.length, queued: 0, launching: 0, executing: 0, failed: 0, skipped: 0 };
  for (const entry of entries) {
    if (entry.state in counts) counts[entry.state] += 1;
  }
  counts.active = counts.queued + counts.launching + counts.executing;
  return counts;
}

/**
 * 入队（服务端按当前按钮配置落快照）。**入队复验已由调用方完成**（本函数只做形状与
 * 操作矩阵约束）。
 *
 * @param {object} doc
 * @param {{wsId: string, proposalId: string, proposalDir: string, button: object,
 *          id?: string, now?: number}} input
 * @returns {{ok: true, doc: object, entry: object} | {ok: false, doc: object, error: string}}
 *          error 枚举：invalid / duplicate / limit
 */
export function enqueueEntry(doc, input) {
  const wsId = typeof input?.wsId === "string" ? input.wsId.trim() : "";
  const proposalId = typeof input?.proposalId === "string" ? input.proposalId.trim() : "";
  const proposalDir = typeof input?.proposalDir === "string" ? input.proposalDir.trim() : "";
  if (!wsId || !proposalId || !proposalDir) return { ok: false, doc, error: "invalid" };
  const snapshot = normalizeQueueEntry({
    id: typeof input?.id === "string" && input.id.trim() ? input.id.trim() : "q_" + randomUUID(),
    wsId,
    proposalId,
    proposalDir,
    button: input?.button,
    enqueuedAt: Number(input?.now) || Date.now(),
    state: "queued",
    stateAt: Number(input?.now) || Date.now()
  });
  if (snapshot === null) return { ok: false, doc, error: "invalid" };
  const queue = queueOf(doc, wsId);
  if (queueCountsOf(queue).active >= QUEUE_INFLIGHT_LIMIT) return { ok: false, doc, error: "limit" };
  const duplicated = queue.entries.some(
    (entry) => entry.state === "queued" && entry.proposalId === proposalId && entry.button.name === snapshot.button.name
  );
  if (duplicated) return { ok: false, doc, error: "duplicate" };
  const next = {
    version: QUEUE_VERSION,
    queues: {
      ...doc.queues,
      [wsId]: { ...queue, entries: [...queue.entries, snapshot] }
    }
  };
  return { ok: true, doc: next, entry: snapshot };
}

/**
 * 条目补丁（状态机内部记账：`sessionId/startedAt/state/stateAt/reason/message`）。
 * 形状非法/条目不存在 → `{ok:false}`。
 * @param {object} doc
 * @param {{wsId: string, entryId: string, patch: object, now?: number}} input
 * @returns {{ok: true, doc: object, entry: object} | {ok: false, doc: object, error: string}}
 */
export function patchQueueEntry(doc, input) {
  const wsId = typeof input?.wsId === "string" ? input.wsId.trim() : "";
  const queue = queueOf(doc, wsId);
  const entryId = typeof input?.entryId === "string" ? input.entryId : "";
  const index = queue.entries.findIndex((entry) => entry.id === entryId);
  if (index < 0) return { ok: false, doc, error: "missing" };
  const patch = input?.patch && typeof input.patch === "object" ? input.patch : {};
  const current = queue.entries[index];
  const merged = { ...current };
  if (typeof patch.state === "string") {
    if (!STATES.has(patch.state)) return { ok: false, doc, error: "invalid" };
    merged.state = patch.state;
  }
  if (typeof patch.sessionId === "string" && patch.sessionId.trim()) merged.sessionId = patch.sessionId.trim();
  if (Number.isFinite(Number(patch.startedAt)) && Number(patch.startedAt) > 0) merged.startedAt = Number(patch.startedAt);
  if (typeof patch.reason === "string" && patch.reason.trim()) merged.reason = patch.reason.trim();
  if (typeof patch.message === "string" && patch.message.trim()) merged.message = patch.message.trim();
  merged.stateAt = Number.isFinite(Number(input?.now)) ? Number(input.now) : Date.now();
  const entries = [...queue.entries];
  entries[index] = merged;
  return {
    ok: true,
    doc: { version: QUEUE_VERSION, queues: { ...doc.queues, [wsId]: { ...queue, entries } } },
    entry: merged
  };
}

/**
 * 出队（**调度器内部完成/收敛专用**：完成即出队，不受用户操作矩阵的 executing 锁定约束）。
 * 用户面的移出请走 `removeEntry`（矩阵校验）。
 * @returns {{ok: true, doc: object, removed: object} | {ok: false, doc: object, error: string}}
 */
export function dropEntry(doc, input) {
  const wsId = typeof input?.wsId === "string" ? input.wsId.trim() : "";
  const entryId = typeof input?.entryId === "string" ? input.entryId : "";
  const queue = queueOf(doc, wsId);
  const index = queue.entries.findIndex((entry) => entry.id === entryId);
  if (index < 0) return { ok: false, doc, error: "missing" };
  const entry = queue.entries[index];
  const entries = queue.entries.filter((item) => item.id !== entryId);
  return { ok: true, doc: { version: QUEUE_VERSION, queues: { ...doc.queues, [wsId]: { ...queue, entries } } }, removed: entry };
}

/**
 * 移出条目（queued 与 failed/skipped 残留可用；launching/executing 锁定）。
 * @returns {{ok: true, doc: object, removed: object} | {ok: false, doc: object, error: string}}
 */
export function removeEntry(doc, input) {
  const wsId = typeof input?.wsId === "string" ? input.wsId.trim() : "";
  const entryId = typeof input?.entryId === "string" ? input.entryId : "";
  const queue = queueOf(doc, wsId);
  const index = queue.entries.findIndex((entry) => entry.id === entryId);
  if (index < 0) return { ok: false, doc, error: "missing" };
  const entry = queue.entries[index];
  if (!TERMINAL.has(entry.state) && entry.state !== "queued") return { ok: false, doc, error: "locked" };
  const entries = queue.entries.filter((item) => item.id !== entryId);
  return { ok: true, doc: { version: QUEUE_VERSION, queues: { ...doc.queues, [wsId]: { ...queue, entries } } }, removed: entry };
}

/**
 * 条目可重试判定（spec「条目操作矩阵与复验跳过」）：**仅 `failed`** 残留可重试。
 * skipped 不提供重试（复验跳过语义下条目可随时经入队钮重新排队）；其余状态（含未知态）
 * 一律不可重试（防御：MUST NOT 放行未知态）。
 * @param {unknown} entry
 * @returns {boolean}
 */
export function canRetryEntry(entry) {
  return entry?.state === "failed";
}

/**
 * 重试 failed 残留（spec「条目操作矩阵与复验跳过」/ design D1–D3）：
 * `failed → queued` 转态**复用条目对象**——`button` 快照逐字保留（model/prepend/preState
 * 随快照定格语义不变）、`reason`/`message`/`sessionId`/`startedAt` 等终态记账字段清除、
 * `stateAt` 刷新为重试时刻、`enqueuedAt` 保留原值；转回位置 = **队首**（失败任务往往是
 * 链头，修复后最先推进最符合「恢复依赖链」直觉）。
 *
 * 校验顺序与 `enqueueEntry` 同族：missing → not-failed → limit（转回 queued 使其重新计入
 * 32 上限）→ duplicate（同组合已有 queued 条目拒绝，failed 残留保持不变）。
 * **不改变队列暂停态**：推进与否由调度器 `nextLaunchable` 的暂停守卫决定（调用方在转态
 * 成功后与入队同语义 kick 一次）。
 *
 * @param {object} doc
 * @param {{wsId: string, entryId: string, now?: number}} input
 * @returns {{ok: true, doc: object, entry: object} | {ok: false, doc: object, error: string}}
 *          error 枚举：invalid / missing / not-failed / limit / duplicate
 */
export function retryEntry(doc, input) {
  const wsId = typeof input?.wsId === "string" ? input.wsId.trim() : "";
  const entryId = typeof input?.entryId === "string" ? input.entryId : "";
  if (!wsId) return { ok: false, doc, error: "invalid" };
  const queue = queueOf(doc, wsId);
  const index = queue.entries.findIndex((entry) => entry.id === entryId);
  if (index < 0) return { ok: false, doc, error: "missing" };
  const entry = queue.entries[index];
  if (!canRetryEntry(entry)) return { ok: false, doc, error: "not-failed" };
  if (queueCountsOf(queue).active >= QUEUE_INFLIGHT_LIMIT) return { ok: false, doc, error: "limit" };
  const duplicated = queue.entries.some(
    (item) => item.state === "queued" && item.proposalId === entry.proposalId && item.button.name === entry.button.name
  );
  if (duplicated) return { ok: false, doc, error: "duplicate" };
  const now = Number.isFinite(Number(input?.now)) ? Number(input.now) : Date.now();
  /* 转态 = 快照原样 + 记账清除：白名单重建（MUST NOT 用展开合并——终态字段没有「删除」
     语义，`patchQueueEntry` 的合并口径不适用本转态）。 */
  const revived = {
    id: entry.id,
    wsId: entry.wsId,
    proposalId: entry.proposalId,
    proposalDir: entry.proposalDir,
    button: { ...entry.button },
    enqueuedAt: entry.enqueuedAt,
    state: "queued",
    stateAt: now
  };
  const entries = queue.entries.filter((item) => item.id !== entryId);
  entries.unshift(revived);
  return {
    ok: true,
    doc: { version: QUEUE_VERSION, queues: { ...doc.queues, [wsId]: { ...queue, entries } } },
    entry: revived
  };
}

/**
 * 清空：移除 queued 与终态残留，**保留** launching/executing（spec「清空保留执行中条目」）。
 * @returns {{ok: true, doc: object, removed: number} | {ok: false, doc: object, error: string}}
 */
export function clearQueue(doc, input) {
  const wsId = typeof input?.wsId === "string" ? input.wsId.trim() : "";
  if (!wsId) return { ok: false, doc, error: "invalid" };
  const queue = queueOf(doc, wsId);
  const entries = queue.entries.filter((entry) => !TERMINAL.has(entry.state) && entry.state !== "queued");
  const removed = queue.entries.length - entries.length;
  return { ok: true, doc: { version: QUEUE_VERSION, queues: { ...doc.queues, [wsId]: { ...queue, entries } } }, removed };
}

/**
 * 排序（前移/后移）：仅 queued 条目；**立即邻位也必须 queued**（spec：邻位非 queued 拒绝）。
 * @returns {{ok: true, doc: object} | {ok: false, doc: object, error: string}}
 *          error 枚举：invalid / missing / locked / neighbor-locked / boundary
 */
export function reorderEntry(doc, input) {
  const wsId = typeof input?.wsId === "string" ? input.wsId.trim() : "";
  const entryId = typeof input?.entryId === "string" ? input.entryId : "";
  const direction = input?.direction === "up" ? "up" : input?.direction === "down" ? "down" : "";
  if (!wsId || !direction) return { ok: false, doc, error: "invalid" };
  const queue = queueOf(doc, wsId);
  const index = queue.entries.findIndex((entry) => entry.id === entryId);
  if (index < 0) return { ok: false, doc, error: "missing" };
  if (queue.entries[index].state !== "queued") return { ok: false, doc, error: "locked" };
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= queue.entries.length) return { ok: false, doc, error: "boundary" };
  if (queue.entries[target].state !== "queued") return { ok: false, doc, error: "neighbor-locked" };
  const entries = [...queue.entries];
  [entries[index], entries[target]] = [entries[target], entries[index]];
  return { ok: true, doc: { version: QUEUE_VERSION, queues: { ...doc.queues, [wsId]: { ...queue, entries } } } };
}

/**
 * 暂停/继续（只改队列标志，不触碰在途条目）。
 * @returns {{ok: true, doc: object, paused: boolean} | {ok: false, doc: object, error: string}}
 */
export function setQueuePaused(doc, input) {
  const wsId = typeof input?.wsId === "string" ? input.wsId.trim() : "";
  if (!wsId) return { ok: false, doc, error: "invalid" };
  const queue = queueOf(doc, wsId);
  const paused = input?.paused === true;
  const now = Number.isFinite(Number(input?.now)) ? Number(input.now) : Date.now();
  const next = {
    version: QUEUE_VERSION,
    queues: {
      ...doc.queues,
      [wsId]: { ...queue, paused, pausedAt: paused ? now : 0 }
    }
  };
  return { ok: true, doc: next, paused };
}

/**
 * 取下一个可启动条目（**不改状态**）：队列未暂停、无在途条目、队首 queued。
 *
 * 依赖让位（second-add-cross-proposal-dependency-gating 2.1）**不在此层**：本函数只做
 * 「结构可启动」判定（暂停 / 在途 / 顺序），依赖子句在调度器扫描时逐条求值——存储层
 * 不感知依赖，条目模型零改动（design D5）。
 * @returns {object|null}
 */
export function nextLaunchable(doc, wsId) {
  return launchableEntries(doc, wsId)[0] ?? null;
}

/**
 * 让位扫描候选集（**不改状态**，second-add-cross-proposal-dependency-gating 2.1）：
 * 队列未暂停且无在途条目时返回全部 queued 条目（入队序）；否则空数组。
 *
 * 依赖求值由调度器按此顺序逐条进行（跳过依赖未达标者，启动首个达标条目）——存储顺序
 * （入队 FIFO）保持权威，执行序经扫描自然收敛为拓扑序。
 * @param {object} doc
 * @param {string} wsId
 * @returns {Array<object>}
 */
export function launchableEntries(doc, wsId) {
  const queue = queueOf(doc, wsId);
  if (queue.paused) return [];
  const inflight = queue.entries.some((entry) => entry.state === "launching" || entry.state === "executing");
  if (inflight) return [];
  return queue.entries.filter((entry) => entry.state === "queued");
}

/**
 * 该工作区是否存在在途条目（launching/executing）。
 * @param {object} doc
 * @param {string} wsId
 * @returns {boolean}
 */
export function hasInflight(doc, wsId) {
  return queueOf(doc, wsId).entries.some((entry) => entry.state === "launching" || entry.state === "executing");
}

/**
 * 对外投影（API/UI 消费，**不含 prompt 正文**）：`subState` 由调用方传入的运行态推导
 * （`waiting` 优先于 `running`；两者皆无 → null）。
 *
 * `wait` 由调用方（宿主依赖求值）传入（second-add-cross-proposal-dependency-gating 2.1 /
 * 呈现 3.2）：`{dep: string, reason?: "repair"}` —— queued 条目的依赖未达标等待信息；
 * 条目 `subState` 派生为 `waiting-dependency`（呈现子态，不落枚举），条目模型零改动。
 * @param {object} entry 队列条目
 * @param {{running?: boolean, waiting?: boolean}|null} [activity]
 * @param {{dep: string, reason?: string}|null} [wait]
 * @returns {object}
 */
export function publicEntryOf(entry, activity = null, wait = null) {
  /* `waiting` 兼容布尔与计数两种形态：调度器活动信号用计数（同会话可并存多个交互），
     外部调用方可能只给布尔；>0 / true 皆视为「等待决策」。 */
  const waiting = activity?.waiting === true || (Number.isFinite(activity?.waiting) && activity.waiting > 0);
  const depWait = wait !== null && typeof wait === "object" && typeof wait.dep === "string" && wait.dep ? wait : null;
  const subState = waiting
    ? "waiting"
    : activity?.running === true
      ? "running"
      : entry.state === "queued" && depWait !== null
        ? "waiting-dependency"
        : null;
  const out = {
    id: entry.id,
    wsId: entry.wsId,
    proposalId: entry.proposalId,
    buttonName: entry.button.name,
    autoSend: true,
    enqueuedAt: entry.enqueuedAt,
    state: entry.state,
    stateAt: entry.stateAt
  };
  if (subState !== null) out.subState = subState;
  if (depWait !== null) {
    out.waiting = { dep: depWait.dep };
    if (typeof depWait.reason === "string" && depWait.reason) out.waiting.reason = depWait.reason;
  }
  if (entry.startedAt !== undefined) out.startedAt = entry.startedAt;
  if (entry.sessionId !== undefined) out.sessionId = entry.sessionId;
  if (entry.reason !== undefined) out.reason = entry.reason;
  if (entry.message !== undefined) out.message = entry.message;
  return out;
}

/**
 * 全量对外快照（`GET /queue`）：每队列 `{paused, pausedAt, entries, counts}`。
 * @param {object} doc
 * @param {(wsId: string, entry: object) => ({running?: boolean, waiting?: boolean}|null)} [activityOf]
 * @param {(wsId: string, entry: object) => ({dep: string, reason?: string}|null)} [waitOf]
 *        依赖未达标等待信息（宿主注入；缺省 null = 无等待呈现）
 * @returns {{version: number, revisedAt: number, queues: Record<string, object>}}
 */
export function publicSnapshotOf(doc, activityOf = null, waitOf = null) {
  const queues = {};
  for (const [wsId, queue] of Object.entries(doc.queues ?? {})) {
    queues[wsId] = {
      paused: queue.paused === true,
      pausedAt: queue.pausedAt ?? 0,
      counts: queueCountsOf(queue),
      entries: queue.entries.map((entry) => publicEntryOf(
        entry,
        typeof activityOf === "function" ? activityOf(wsId, entry) : null,
        typeof waitOf === "function" ? waitOf(wsId, entry) : null
      ))
    };
  }
  return { version: QUEUE_VERSION, queues };
}

/**
 * 原子写（temp + fsync + rename；rename 失败清理临时文件并抛出）。
 * @param {string} path
 * @param {string} text
 */
export function writeQueueDocAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(dirname(path), "." + randomUUID() + ".tmp");
  const fd = openSync(tmp, "w");
  try {
    writeSync(fd, text, 0, "utf8");
    try {
      fdatasyncSync(fd);
    } catch {
      /* 平台不支持时跳过（rename 已保证替换原子性） */
    }
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, path);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw error;
  }
}

/**
 * 建立队列存储句柄（内存态即全量；落盘 = 原子写整文档）。
 *
 * @param {object} [options]
 * @param {string} [options.filePath] 存储路径（缺省 `resolveQueueStorePath()`）
 * @param {() => number} [options.now] 时钟（测试注入）
 * @param {(id: string) => string} [options.idFactory] 条目 id 生成（测试注入）
 * @param {(path: string, text: string) => void} [options.write] 落盘（测试注入）
 * @param {(path: string) => string|null} [options.read] 读盘（测试注入）
 * @param {{warn?: Function}|null} [options.logger]
 * @returns {object} 句柄
 */
export function createQueueStore(options = {}) {
  const filePath = typeof options.filePath === "string" && options.filePath ? options.filePath : resolveQueueStorePath(options);
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const idFactory = typeof options.idFactory === "function" ? options.idFactory : () => "q_" + randomUUID();
  const write = typeof options.write === "function" ? options.write : writeQueueDocAtomic;
  const read = typeof options.read === "function"
    ? options.read
    : (path) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    };
  const logger = options.logger ?? null;
  let doc = emptyQueueDoc();
  let revisedAt = 0;

  /** 装载（文件缺失/损坏/版本漂移 → 空文档）。 */
  function load() {
    const text = read(filePath);
    if (typeof text === "string" && text) {
      try {
        doc = normalizeQueueDoc(JSON.parse(text));
      } catch {
        doc = emptyQueueDoc();
        logger?.warn?.("[dsh-v-cosmos] 队列存储损坏，按空队列重建");
      }
    } else {
      doc = emptyQueueDoc();
    }
    revisedAt = now();
    return doc;
  }

  /** 落盘（写失败只告警：内存态权威，UI 投影不中断）。 */
  function save() {
    try {
      write(filePath, JSON.stringify(doc, null, 2) + "\n");
      revisedAt = now();
      return true;
    } catch (error) {
      logger?.warn?.("[dsh-v-cosmos] 队列存储落盘失败: %s", String(error?.message || error));
      return false;
    }
  }

  /** 统一写入收口：成功才落盘。 */
  function commit(result) {
    if (result?.ok === true && result.doc !== doc) {
      doc = result.doc;
      save();
    }
    return result;
  }

  return {
    filePath,
    load,
    save,
    get doc() {
      return doc;
    },
    get revisedAt() {
      return revisedAt;
    },
    snapshot: () => publicSnapshotOf(doc),
    queue: (wsId) => queueOf(doc, wsId),
    counts: (wsId) => queueCountsOf(queueOf(doc, wsId)),
    find: (wsId, entryId) => findEntry(doc, wsId, entryId),
    enqueue(input) {
      return commit(enqueueEntry(doc, { ...input, id: input?.id ?? idFactory(), now: input?.now ?? now() }));
    },
    patch(input) {
      return commit(patchQueueEntry(doc, { ...input, now: input?.now ?? now() }));
    },
    remove(input) {
      return commit(removeEntry(doc, input));
    },
    /** failed 残留重试（转回队首 queued；暂停态由调用方保持，不在此处触碰）。 */
    retry(input) {
      return commit(retryEntry(doc, { ...input, now: input?.now ?? now() }));
    },
    /** 调度器内部出队（完成收敛，无矩阵校验）。 */
    drop(input) {
      return commit(dropEntry(doc, input));
    },
    clear(input) {
      return commit(clearQueue(doc, input));
    },
    reorder(input) {
      return commit(reorderEntry(doc, input));
    },
    setPaused(input) {
      return commit(setQueuePaused(doc, { ...input, now: input?.now ?? now() }));
    },
    nextLaunchable: (wsId) => nextLaunchable(doc, wsId),
    /** 让位扫描候选集（未暂停、无在途时返回全部 queued；依赖求值在调度器）。 */
    launchable: (wsId) => launchableEntries(doc, wsId),
    hasInflight: (wsId) => hasInflight(doc, wsId)
  };
}
