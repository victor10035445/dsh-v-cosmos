/**
 * dsh-v-cosmos — 曲率队列的存储层（two-add-cosmos-proposal-warp 1.2 / design D1、D8）。
 *
 * 纯逻辑 + 单文件持久化（与 queue-store.mjs 同族模式，独立文件、互不覆盖）：
 *
 *  - 文档形状 `{ version: 1, warps: { <wsId>: { paused, pausedAt, entries: [...] } } }`
 *    —— 每星座一个曲率队列，全部工作区聚合在单一 JSON
 *    （`$DSH_HOME/storages/dsh-v-cosmos.warp.json`）。
 *  - 条目 = **附着快照**：
 *
 *    ```
 *    { id, wsId, targetKey, targetKind: "proposal" | "embryo", targetLabel,
 *      proposalDir?,                       // 仅 proposal 目标（提案目录绝对路径）
 *      anchorSlugs?,                       // 仅 embryo 目标（附着时刻锚点 slug 清单）
 *      explorerSessionId?,                 // 仅 embryo 目标（锚点绑定的探索会话）
 *      deps?,                              // 附着时刻依赖快照 `[{slug, state}]`
 *                                          // （second-add-cross-proposal-dependency-gating 1.1；
 *                                          //  形状与 dep-resolve.normalizeRequires 同形，缺失 = 无守卫）
 *      button: { name, prompt, model?, prepend?, preState? },
 *      rule: "direct" | "queue",
 *      state: "grayed"|"ready"|"launching"|"executing"|"failed"|"skipped",
 *      stateAt, enqueuedAt, sessionId?, startedAt?, reason?, message? }
 *    ```
 *
 *  - `state` 枚举（spec「门控接力状态机（复查触发沿）」）；`running` / `等待决策` /
 *    `等待会话空闲` 是执行/待发态的**呈现**子态（由会话活动推导，不落枚举）。
 *  - 操作矩阵：**无排序语义**；单条移出对 `grayed | ready | failed | skipped` 可用，
 *    `launching | executing` 完全锁定（服务端拒绝）；无整队列清空（spec「条目操作矩阵」）。
 *  - 重复附着拒绝：同 `(wsId, targetKey)` 存在**非终态**条目
 *    （grayed/ready/launching/executing）→ `duplicate`；failed/skipped 残留不构成重复。
 *  - 清理：提案归档清其非在途条目；星胚移除清该星胚目标全部条目；工作区不在册清空
 *    整个星座曲率队列。
 *
 * 原子写：temp 写 + fsync + rename（与 queue-store 同款）；读面容错：缺失/损坏/版本
 * 漂移 → 空文档（首写即建，无迁移）。
 */

import { randomUUID } from "node:crypto";
import { closeSync, fdatasyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isPreState, normalizeButtonModel } from "./buttons.mjs";
import { normalizeRequires } from "./dep-resolve.mjs";

/** 曲率文档版本（首版；版本漂移按空文档重建）。 */
export const WARP_VERSION = 1;
/** 条目状态枚举（顺序即呈现分组顺序；`grayed` 与 `ready` 是待发两态）。 */
export const WARP_STATES = Object.freeze(["grayed", "ready", "launching", "executing", "failed", "skipped"]);
/** 终态（残留）状态集合：可移出、不构成重复附着。 */
export const WARP_TERMINAL_STATES = Object.freeze(["failed", "skipped"]);
/** 在途状态集合（并发额度占用者；操作矩阵锁定）。 */
export const WARP_INFLIGHT_STATES = Object.freeze(["launching", "executing"]);
/** 目标形态枚举。 */
export const WARP_TARGET_KINDS = Object.freeze(["proposal", "embryo"]);
/** 分流规则枚举（缺省 direct）。 */
export const WARP_RULE_KEYS = Object.freeze(["direct", "queue"]);

const STATES = new Set(WARP_STATES);
const TERMINAL = new Set(WARP_TERMINAL_STATES);
const TARGET_KINDS = new Set(WARP_TARGET_KINDS);

/**
 * 曲率存储文件路径（`$DSH_HOME/storages/dsh-v-cosmos.warp.json`）：与关联/队列/谱系/
 * 作品存储同族（`storages/`），文件名带插件前缀避免他插件撞名。
 * @param {{env?: Record<string, string|undefined>, home?: string}} [options]
 * @returns {string}
 */
export function resolveWarpStorePath(options = {}) {
  const env = options.env ?? process.env;
  const envHome = typeof env.DSH_HOME === "string" ? env.DSH_HOME.trim() : "";
  const home = options.home ?? (envHome || join(homedir(), ".dsh"));
  return join(home, "storages", "dsh-v-cosmos.warp.json");
}

/** 空文档。 */
export function emptyWarpDoc() {
  return { version: WARP_VERSION, warps: {} };
}

/** 非空字符串归一（trim；非字符串 → ""）。 */
function textOf(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 条目归一化（读面容错）：形状非法 → null（该条丢弃，不波及其余）。
 * @param {unknown} raw
 * @returns {object|null}
 */
export function normalizeWarpEntry(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const id = textOf(raw.id);
  const wsId = textOf(raw.wsId);
  const targetKey = textOf(raw.targetKey);
  const targetKind = textOf(raw.targetKind);
  if (!id || !wsId || !targetKey || !TARGET_KINDS.has(targetKind)) return null;
  const targetLabel = textOf(raw.targetLabel) || targetKey;
  const state = typeof raw.state === "string" && STATES.has(raw.state) ? raw.state : "grayed";
  const source = raw.button && typeof raw.button === "object" && !Array.isArray(raw.button) ? raw.button : null;
  const name = textOf(source?.name);
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
  let preState;
  if (typeof source?.preState === "string" && isPreState(source.preState.trim())) {
    preState = source.preState.trim();
    button.preState = preState;
  }
  const entry = {
    id,
    wsId,
    targetKey,
    targetKind,
    targetLabel,
    button,
    rule: raw.rule === "queue" ? "queue" : "direct",
    state,
    enqueuedAt: Number.isFinite(Number(raw.enqueuedAt)) ? Number(raw.enqueuedAt) : 0,
    stateAt: Number.isFinite(Number(raw.stateAt)) ? Number(raw.stateAt) : 0
  };
  if (targetKind === "proposal") {
    const proposalDir = textOf(raw.proposalDir);
    if (!proposalDir) return null;
    entry.proposalDir = proposalDir;
  } else {
    const slugs = [];
    const seen = new Set();
    for (const item of Array.isArray(raw.anchorSlugs) ? raw.anchorSlugs : []) {
      const slug = textOf(item);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      slugs.push(slug);
    }
    if (slugs.length === 0) return null;
    entry.anchorSlugs = slugs;
  }
  if (typeof raw.explorerSessionId === "string" && raw.explorerSessionId.trim()) {
    entry.explorerSessionId = raw.explorerSessionId.trim();
  }
  /* 依赖快照（second-add-cross-proposal-dependency-gating 1.1）：归一口径单点 =
     `dep-resolve.normalizeRequires`（非法/重复 → 整份按无依赖，安全方向恒少守卫）。
     空数组不落键（存储最小形：无守卫 = 无字段）。 */
  const deps = normalizeRequires(raw.deps);
  if (deps !== null && deps.length > 0) entry.deps = deps;
  if (typeof raw.sessionId === "string" && raw.sessionId.trim()) entry.sessionId = raw.sessionId.trim();
  if (Number.isFinite(Number(raw.startedAt)) && Number(raw.startedAt) > 0) entry.startedAt = Number(raw.startedAt);
  if (typeof raw.reason === "string" && raw.reason.trim()) entry.reason = raw.reason.trim();
  if (typeof raw.message === "string" && raw.message.trim()) entry.message = raw.message.trim();
  return entry;
}

/**
 * 单星座曲率队列归一化：`{paused, pausedAt, entries}`；脏条目丢弃、同 id 去重。
 * @param {unknown} raw
 * @returns {object}
 */
export function normalizeWarp(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const seen = new Set();
  const entries = [];
  for (const item of Array.isArray(source.entries) ? source.entries : []) {
    const entry = normalizeWarpEntry(item);
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
 * @returns {{version: number, warps: Record<string, object>}}
 */
export function normalizeWarpDoc(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyWarpDoc();
  if (raw.version !== WARP_VERSION) return emptyWarpDoc();
  const warps = {};
  const source = raw.warps && typeof raw.warps === "object" && !Array.isArray(raw.warps) ? raw.warps : {};
  for (const [wsId, value] of Object.entries(source)) {
    const id = textOf(wsId);
    if (!id) continue;
    const warp = normalizeWarp(value);
    if (warp.entries.length === 0 && warp.paused !== true) continue;
    warps[id] = warp;
  }
  return { version: WARP_VERSION, warps };
}

/** 某星座曲率队列（缺席 → 空队列；**不做持久化**）。 */
export function warpOf(doc, wsId) {
  const id = textOf(wsId);
  const warp = id ? doc?.warps?.[id] : undefined;
  return warp ?? { paused: false, pausedAt: 0, entries: [] };
}

/** 条目查找。 */
export function findWarpEntry(doc, wsId, entryId) {
  const id = typeof entryId === "string" ? entryId : "";
  return warpOf(doc, wsId).entries.find((entry) => entry.id === id) ?? null;
}

/** 目标是否已有非终态条目（重复附着 / 「已托管」判定）。 */
export function hasActiveWarpTarget(doc, wsId, targetKey) {
  const key = textOf(targetKey);
  if (!key) return false;
  return warpOf(doc, wsId).entries.some(
    (entry) => entry.targetKey === key && !TERMINAL.has(entry.state)
  );
}

/** 计数（`total` 全部条目；`inflight` = launching + executing）。 */
export function warpCountsOf(warp) {
  const entries = Array.isArray(warp?.entries) ? warp.entries : [];
  const counts = { total: entries.length, grayed: 0, ready: 0, launching: 0, executing: 0, failed: 0, skipped: 0 };
  for (const entry of entries) {
    if (entry.state in counts) counts[entry.state] += 1;
  }
  counts.inflight = counts.launching + counts.executing;
  counts.pending = counts.grayed + counts.ready;
  return counts;
}

/**
 * 目标活动计数聚合读面（服务端触发沿用）：文档内全部去重目标。
 *  - proposal：`{wsId, targetKey, targetKind:"proposal"}`；
 *  - embryo：附带该目标条目上出现的 `explorerSessionId`（可能为空）。
 * @param {object} doc
 * @returns {Array<{wsId: string, targetKey: string, targetKind: string, explorerSessionId: string|null}>}
 */
export function warpTargetsOf(doc) {
  const seen = new Set();
  const out = [];
  for (const [wsId, warp] of Object.entries(doc?.warps ?? {})) {
    for (const entry of Array.isArray(warp?.entries) ? warp.entries : []) {
      const key = wsId + "\u0000" + entry.targetKey;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        wsId,
        targetKey: entry.targetKey,
        targetKind: entry.targetKind,
        explorerSessionId: typeof entry.explorerSessionId === "string" && entry.explorerSessionId
          ? entry.explorerSessionId
          : null
      });
    }
  }
  return out;
}

/** 以新条目列表替换单星座队列（内部工具）。 */
function withEntries(doc, wsId, warp, entries) {
  return { version: WARP_VERSION, warps: { ...doc.warps, [wsId]: { ...warp, entries } } };
}

/**
 * 依赖反向索引（second-add-cross-proposal-dependency-gating 1.3）：`wsId\0<依赖提案 slug>`
 * → 等待它的目标集合 `[{wsId, targetKey}]`。
 *
 * 口径：
 *  - 输入 = 文档内**非终态**条目（grayed/ready/launching/executing）的 deps 快照——
 *    failed/skipped 残留不再参与调度，自然不唤醒；
 *  - **不独立持久化**：索引每次都从条目集现算（「随条目集变更重算」= 无缓存漂移面），
 *    重启对账时条目 deps 随存储回读，索引自动等价重建（design D2）；
 *  - 同 `(wsId, targetKey)` 对同 slug 去重（同目标多按钮条目共享一份等待关系）。
 * @param {object} doc 曲率文档
 * @returns {Map<string, Array<{wsId: string, targetKey: string}>>}
 */
export function warpDependencyWaitersOf(doc) {
  const index = new Map();
  for (const [wsId, warp] of Object.entries(doc?.warps ?? {})) {
    for (const entry of Array.isArray(warp?.entries) ? warp.entries : []) {
      if (!entry || entry.state === "failed" || entry.state === "skipped") continue;
      const deps = Array.isArray(entry.deps) ? entry.deps : [];
      if (deps.length === 0) continue;
      for (const dep of deps) {
        const slug = typeof dep?.slug === "string" ? dep.slug : "";
        if (!slug) continue;
        const key = wsId + "\u0000" + slug;
        const row = { wsId, targetKey: entry.targetKey };
        const list = index.get(key);
        if (list === undefined) {
          index.set(key, [row]);
          continue;
        }
        if (!list.some((item) => item.wsId === row.wsId && item.targetKey === row.targetKey)) list.push(row);
      }
    }
  }
  return index;
}

/**
 * 单条依赖反向索引键（等待关系查询用；与 `warpDependencyWaitersOf` 同域）。
 * @param {unknown} wsId
 * @param {unknown} slug
 * @returns {string}
 */
export function warpDependencyKeyOf(wsId, slug) {
  return String(wsId ?? "") + "\u0000" + String(slug ?? "");
}

/**
 * 附着曲率计划快照（服务端按当前按钮配置解析后的条目入队）。
 * 重复附着（同目标非终态条目）→ `duplicate`；空条目 → `empty`。
 *
 * @param {object} doc
 * @param {{wsId: string, targetKey: string, targetKind: string, targetLabel?: string,
 *          proposalDir?: string, anchorSlugs?: string[], explorerSessionId?: string,
 *          deps?: Array<{slug: string, state: string}>, entries: Array<{button: object, rule?: string}>, now?: number,
 *          idFactory?: () => string}} input
 * @returns {{ok: true, doc: object, entries: object[]} | {ok: false, doc: object, error: string}}
 *          error 枚举：invalid / empty / duplicate
 */
export function attachWarpEntries(doc, input) {
  const wsId = textOf(input?.wsId);
  const targetKey = textOf(input?.targetKey);
  const targetKind = textOf(input?.targetKind);
  const list = Array.isArray(input?.entries) ? input.entries : [];
  if (!wsId || !targetKey || !TARGET_KINDS.has(targetKind) || list.length === 0) {
    return { ok: false, doc, error: "invalid" };
  }
  const now = Number.isFinite(Number(input?.now)) ? Number(input.now) : Date.now();
  const idFactory = typeof input?.idFactory === "function" ? input.idFactory : () => "w_" + randomUUID();
  /* 依赖快照（附着时刻解析结果；调用方已完成解析，本层只做形状归一）。 */
  const deps = normalizeRequires(input?.deps);
  const warp = warpOf(doc, wsId);
  const duplicated = warp.entries.some((entry) => entry.targetKey === targetKey && !TERMINAL.has(entry.state));
  if (duplicated) return { ok: false, doc, error: "duplicate" };
  const snapshots = [];
  for (const item of list) {
    const snapshot = normalizeWarpEntry({
      id: idFactory(),
      wsId,
      targetKey,
      targetKind,
      targetLabel: textOf(input?.targetLabel) || targetKey,
      proposalDir: targetKind === "proposal" ? textOf(input?.proposalDir) : undefined,
      anchorSlugs: targetKind === "embryo" ? input?.anchorSlugs : undefined,
      explorerSessionId: targetKind === "embryo" ? textOf(input?.explorerSessionId) : undefined,
      deps: deps !== null && deps.length > 0 ? deps : undefined,
      button: item?.button,
      rule: item?.rule,
      enqueuedAt: now,
      state: "grayed",
      stateAt: now
    });
    if (snapshot === null) return { ok: false, doc, error: "invalid" };
    snapshots.push(snapshot);
  }
  return { ok: true, doc: withEntries(doc, wsId, warp, [...warp.entries, ...snapshots]), entries: snapshots };
}

/**
 * 条目补丁（状态机内部记账：`state/sessionId/explorerSessionId/startedAt/reason/message`）。
 * @returns {{ok: true, doc: object, entry: object} | {ok: false, doc: object, error: string}}
 */
export function patchWarpEntry(doc, input) {
  const wsId = textOf(input?.wsId);
  const warp = warpOf(doc, wsId);
  const entryId = typeof input?.entryId === "string" ? input.entryId : "";
  const index = warp.entries.findIndex((entry) => entry.id === entryId);
  if (index < 0) return { ok: false, doc, error: "missing" };
  const patch = input?.patch && typeof input.patch === "object" ? input.patch : {};
  const current = warp.entries[index];
  const merged = { ...current };
  if (typeof patch.state === "string") {
    if (!STATES.has(patch.state)) return { ok: false, doc, error: "invalid" };
    merged.state = patch.state;
  }
  if (typeof patch.sessionId === "string" && patch.sessionId.trim()) merged.sessionId = patch.sessionId.trim();
  if (typeof patch.explorerSessionId === "string" && patch.explorerSessionId.trim()) {
    merged.explorerSessionId = patch.explorerSessionId.trim();
  }
  if (Number.isFinite(Number(patch.startedAt)) && Number(patch.startedAt) > 0) merged.startedAt = Number(patch.startedAt);
  if (typeof patch.reason === "string" && patch.reason.trim()) merged.reason = patch.reason.trim();
  if (typeof patch.message === "string" && patch.message.trim()) merged.message = patch.message.trim();
  merged.stateAt = Number.isFinite(Number(input?.now)) ? Number(input.now) : Date.now();
  const entries = [...warp.entries];
  entries[index] = merged;
  return { ok: true, doc: withEntries(doc, wsId, warp, entries), entry: merged };
}

/**
 * 出队（**调度器内部完成/收敛专用**：完成即出队，不受用户操作矩阵约束）。
 * @returns {{ok: true, doc: object, removed: object} | {ok: false, doc: object, error: string}}
 */
export function dropWarpEntry(doc, input) {
  const wsId = textOf(input?.wsId);
  const entryId = typeof input?.entryId === "string" ? input.entryId : "";
  const warp = warpOf(doc, wsId);
  const index = warp.entries.findIndex((entry) => entry.id === entryId);
  if (index < 0) return { ok: false, doc, error: "missing" };
  const removed = warp.entries[index];
  const entries = warp.entries.filter((entry) => entry.id !== entryId);
  return { ok: true, doc: withEntries(doc, wsId, warp, entries), removed };
}

/**
 * 单条移出（用户操作矩阵）：`grayed | ready | failed | skipped` 可移出；
 * `launching | executing` 锁定。
 * @returns {{ok: true, doc: object, removed: object} | {ok: false, doc: object, error: string}}
 *          error 枚举：missing / locked
 */
export function removeWarpEntry(doc, input) {
  const wsId = textOf(input?.wsId);
  const entryId = typeof input?.entryId === "string" ? input.entryId : "";
  const warp = warpOf(doc, wsId);
  const index = warp.entries.findIndex((entry) => entry.id === entryId);
  if (index < 0) return { ok: false, doc, error: "missing" };
  const entry = warp.entries[index];
  if (entry.state === "launching" || entry.state === "executing") {
    return { ok: false, doc, error: "locked" };
  }
  const entries = warp.entries.filter((item) => item.id !== entryId);
  return { ok: true, doc: withEntries(doc, wsId, warp, entries), removed: entry };
}

/**
 * 清空某目标条目（生命周期清理）：
 *  - `includeInflight=false`（提案归档）：只清非在途条目（launching/executing 保留至自然收敛）；
 *  - `includeInflight=true`（星胚移除）：清全部条目。
 * @returns {{ok: true, doc: object, removed: number}}
 */
export function clearWarpTarget(doc, input) {
  const wsId = textOf(input?.wsId);
  const targetKey = textOf(input?.targetKey);
  if (!wsId || !targetKey) return { ok: false, doc, error: "invalid" };
  const warp = warpOf(doc, wsId);
  const includeInflight = input?.includeInflight === true;
  const entries = warp.entries.filter((entry) => {
    if (entry.targetKey !== targetKey) return true;
    return !includeInflight && (entry.state === "launching" || entry.state === "executing");
  });
  const removed = warp.entries.length - entries.length;
  if (removed === 0) return { ok: true, doc, removed: 0 };
  return { ok: true, doc: withEntries(doc, wsId, warp, entries), removed };
}

/**
 * 提案归档清理：清该提案目标（`targetKind === "proposal"` ∧ `targetKey === proposalId`）
 * 的全部**非在途**条目。
 * @returns {{ok: true, doc: object, removed: number}}
 */
export function clearWarpProposal(doc, input) {
  const wsId = textOf(input?.wsId);
  const proposalId = textOf(input?.proposalId);
  if (!wsId || !proposalId) return { ok: false, doc, error: "invalid" };
  const warp = warpOf(doc, wsId);
  const entries = warp.entries.filter(
    (entry) => !(entry.targetKind === "proposal" && entry.targetKey === proposalId)
      || entry.state === "launching" || entry.state === "executing"
  );
  const removed = warp.entries.length - entries.length;
  if (removed === 0) return { ok: true, doc, removed: 0 };
  return { ok: true, doc: withEntries(doc, wsId, warp, entries), removed };
}

/**
 * 星胚移除清理：凡 `anchorSlugs` 含该 slug 的星胚目标 → 清该目标**全部**条目。
 * @returns {{ok: true, doc: object, removed: number, targets: string[]}}
 */
export function clearWarpEmbryoSlug(doc, input) {
  const wsId = textOf(input?.wsId);
  const slug = textOf(input?.slug);
  if (!wsId || !slug) return { ok: false, doc, error: "invalid" };
  const warp = warpOf(doc, wsId);
  const targets = new Set();
  for (const entry of warp.entries) {
    if (entry.targetKind !== "embryo") continue;
    if (!Array.isArray(entry.anchorSlugs) || !entry.anchorSlugs.includes(slug)) continue;
    targets.add(entry.targetKey);
  }
  if (targets.size === 0) return { ok: true, doc, removed: 0, targets: [] };
  const entries = warp.entries.filter((entry) => !(entry.targetKind === "embryo" && targets.has(entry.targetKey)));
  return {
    ok: true,
    doc: withEntries(doc, wsId, warp, entries),
    removed: warp.entries.length - entries.length,
    targets: [...targets]
  };
}

/**
 * 工作区不在册：清空整个星座曲率队列。
 * @returns {{ok: true, doc: object, removed: number}}
 */
export function clearWarp(doc, input) {
  const wsId = textOf(input?.wsId);
  if (!wsId) return { ok: false, doc, error: "invalid" };
  if (!doc?.warps?.[wsId]) return { ok: true, doc, removed: 0 };
  const warps = { ...doc.warps };
  const removed = Array.isArray(warps[wsId].entries) ? warps[wsId].entries.length : 0;
  delete warps[wsId];
  return { ok: true, doc: { version: WARP_VERSION, warps }, removed };
}

/**
 * 暂停/继续（只改队列标志，不触碰在途条目）。
 * @returns {{ok: true, doc: object, paused: boolean}}
 */
export function setWarpPaused(doc, input) {
  const wsId = textOf(input?.wsId);
  if (!wsId) return { ok: false, doc, error: "invalid" };
  const warp = warpOf(doc, wsId);
  const paused = input?.paused === true;
  const now = Number.isFinite(Number(input?.now)) ? Number(input.now) : Date.now();
  return {
    ok: true,
    doc: { version: WARP_VERSION, warps: { ...doc.warps, [wsId]: { ...warp, paused, pausedAt: paused ? now : 0 } } },
    paused
  };
}

/**
 * 对外条目投影（API/UI 消费，**不含 prompt 正文**）。
 *
 * `activity` 由调用方（调度器）传入：
 *  - `{ running?: boolean, waiting?: number }`：executing 条目的会话子态
 *    （waiting > 0 → 「等待决策」；running → 呼吸点）；
 *  - `{ waitingSession?: boolean }`：ready 的 proto 条目「等待会话空闲」呈现子态。
 *
 * `wait` 由调用方（宿主依赖求值）传入（second-add-cross-proposal-dependency-gating 1.2）：
 *  - `{ dep: string, reason?: "repair" }`：grayed 条目的依赖未达标呈现信息——条目
 *    `subState` 派生为 `waiting-dependency`（呈现子态，不落枚举），`dep` = 首个未达标
 *    依赖提案 slug、`reason` = 等修复原因码（缺省 = 正常等待前置推进）。
 *
 * @param {object} entry
 * @param {object|null} [activity]
 * @param {{dep: string, reason?: string}|null} [wait]
 * @returns {object}
 */
export function publicWarpEntryOf(entry, activity = null, wait = null) {
  const waiting = activity?.waiting === true || (Number.isFinite(activity?.waiting) && activity.waiting > 0);
  const depWait = wait !== null && typeof wait === "object" && typeof wait.dep === "string" && wait.dep ? wait : null;
  let subState = null;
  if (entry.state === "executing") subState = waiting ? "waiting" : activity?.running === true ? "running" : null;
  else if (entry.state === "ready" && activity?.waitingSession === true) subState = "waiting-session";
  else if (entry.state === "grayed" && depWait !== null) subState = "waiting-dependency";
  const out = {
    id: entry.id,
    wsId: entry.wsId,
    targetKey: entry.targetKey,
    targetKind: entry.targetKind,
    targetLabel: entry.targetLabel,
    buttonName: entry.button.name,
    rule: entry.rule,
    state: entry.state,
    stateAt: entry.stateAt,
    enqueuedAt: entry.enqueuedAt
  };
  if (subState !== null) out.subState = subState;
  if (depWait !== null) {
    out.waiting = { dep: depWait.dep };
    if (typeof depWait.reason === "string" && depWait.reason) out.waiting.reason = depWait.reason;
  }
  if (entry.targetKind === "embryo" && Array.isArray(entry.anchorSlugs)) out.anchorSlugs = [...entry.anchorSlugs];
  if (entry.startedAt !== undefined) out.startedAt = entry.startedAt;
  if (entry.sessionId !== undefined) out.sessionId = entry.sessionId;
  if (entry.reason !== undefined) out.reason = entry.reason;
  if (entry.message !== undefined) out.message = entry.message;
  return out;
}

/**
 * 全量对外快照（`GET /warp`）：每队列 `{paused, pausedAt, counts, entries}`。
 * @param {object} doc
 * @param {(wsId: string, entry: object) => (object|null)} [activityOf]
 * @param {(wsId: string, entry: object) => ({dep: string, reason?: string}|null)} [waitOf]
 *        依赖未达标等待信息（宿主注入；缺省 null = 无等待呈现）
 * @returns {{version: number, warps: Record<string, object>}}
 */
export function publicWarpSnapshotOf(doc, activityOf = null, waitOf = null) {
  const warps = {};
  for (const [wsId, warp] of Object.entries(doc.warps ?? {})) {
    warps[wsId] = {
      paused: warp.paused === true,
      pausedAt: warp.pausedAt ?? 0,
      counts: warpCountsOf(warp),
      entries: warp.entries.map((entry) => publicWarpEntryOf(
        entry,
        typeof activityOf === "function" ? activityOf(wsId, entry) : null,
        typeof waitOf === "function" ? waitOf(wsId, entry) : null
      ))
    };
  }
  return { version: WARP_VERSION, warps };
}

/**
 * 原子写（temp + fsync + rename；rename 失败清理临时文件并抛出）。
 * @param {string} path
 * @param {string} text
 */
export function writeWarpDocAtomic(path, text) {
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
 * 建立曲率存储句柄（内存态即全量；落盘 = 原子写整文档）。
 *
 * @param {object} [options]
 * @param {string} [options.filePath] 存储路径（缺省 `resolveWarpStorePath()`）
 * @param {() => number} [options.now] 时钟（测试注入）
 * @param {() => string} [options.idFactory] 条目 id 生成（测试注入）
 * @param {(path: string, text: string) => void} [options.write] 落盘（测试注入）
 * @param {(path: string) => string|null} [options.read] 读盘（测试注入）
 * @param {{warn?: Function}|null} [options.logger]
 * @returns {object} 句柄
 */
export function createWarpStore(options = {}) {
  const filePath = typeof options.filePath === "string" && options.filePath ? options.filePath : resolveWarpStorePath(options);
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const idFactory = typeof options.idFactory === "function" ? options.idFactory : () => "w_" + randomUUID();
  const write = typeof options.write === "function" ? options.write : writeWarpDocAtomic;
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
  let doc = emptyWarpDoc();
  let revisedAt = 0;

  /** 装载（文件缺失/损坏/版本漂移 → 空文档）。 */
  function load() {
    const text = read(filePath);
    if (typeof text === "string" && text) {
      try {
        doc = normalizeWarpDoc(JSON.parse(text));
      } catch {
        doc = emptyWarpDoc();
        logger?.warn?.("[dsh-v-cosmos] 曲率存储损坏，按空队列重建");
      }
    } else {
      doc = emptyWarpDoc();
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
      logger?.warn?.("[dsh-v-cosmos] 曲率存储落盘失败: %s", String(error?.message || error));
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
    snapshot: () => publicWarpSnapshotOf(doc),
    warp: (wsId) => warpOf(doc, wsId),
    counts: (wsId) => warpCountsOf(warpOf(doc, wsId)),
    find: (wsId, entryId) => findWarpEntry(doc, wsId, entryId),
    hasActiveTarget: (wsId, targetKey) => hasActiveWarpTarget(doc, wsId, targetKey),
    targets: () => warpTargetsOf(doc),
    attach(input) {
      return commit(attachWarpEntries(doc, {
        ...input,
        now: input?.now ?? now(),
        idFactory: input?.idFactory ?? idFactory
      }));
    },
    patch(input) {
      return commit(patchWarpEntry(doc, { ...input, now: input?.now ?? now() }));
    },
    /** 调度器内部出队（完成收敛，无矩阵校验）。 */
    drop(input) {
      return commit(dropWarpEntry(doc, input));
    },
    remove(input) {
      return commit(removeWarpEntry(doc, input));
    },
    clearTarget(input) {
      return commit(clearWarpTarget(doc, input));
    },
    clearProposal(input) {
      return commit(clearWarpProposal(doc, input));
    },
    clearEmbryoSlug(input) {
      return commit(clearWarpEmbryoSlug(doc, input));
    },
    clearWarp(input) {
      return commit(clearWarp(doc, input));
    },
    setPaused(input) {
      return commit(setWarpPaused(doc, { ...input, now: input?.now ?? now() }));
    }
  };
}
