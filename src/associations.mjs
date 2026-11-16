/**
 * 会话↔提案关联纯逻辑单点（add-cosmos-entry 3.1–3.5 / design.md「关联规则」）。
 *
 * 独立模块——宿主 index.mjs 消费（存储持久化/启发式引擎/剪除）、
 * test/associations-smoke.mjs 与 test/cross-timing-smoke.mjs 冒烟直测。
 * 模块**零 node 内建依赖**：文件读写由宿主半区注入，纯函数只做归一化、
 * 幂等写入、封顶淘汰、失效剪除与启发式装配。
 *
 * 迁移语义（design.md 键设计）：
 *  - 键含工作区**路径指纹** → 设备/路径迁移后边自然失效；
 *  - 提案归档 → 关联边记录**保留**（可被启发式重新认领 / 后续 UI 手动重建）；
 *  - 会话归档 → 关联条目剪除（行星熄灭，宿主半区持久化写入点执行）；
 *  - MUST NOT 落盘到任何 openspec 工件（存储只写 $DSH_HOME/storages/dsh-v-cosmos.json）。
 *
 * 双轨（fix-cosmos-association-scope）：`origin: "explicit"` 条目是会话的**绑定声明**
 * （bind-session 端点经 `applyBinding` 替换写入），对持有该工作区 explicit 条目的会话，
 * 启发式两条规则均被压制（`explicitBoundSessionIds`）；启发式只对无绑定会话生效。
 */

import { matchProposalSlugs, birthtimeWindowUnique } from "./scan.mjs";

export { matchProposalSlugs };

export const ASSOC_VERSION = 1;
/** 关联条目封顶（对齐 hive `PROPOSAL_STATES_LIMIT` 惯例）：超出按 updatedAt 淘汰最旧。 */
export const ASSOC_ENTRIES_LIMIT = 512;
/** 单次显式绑定声明的提案清单上限（去重后；覆盖全部建议 slug 的探索会话远低于此）。 */
export const BIND_PROPOSALS_LIMIT = 16;

/** 合法 origin：heuristic = 宿主启发式推断；explicit = 会话绑定声明（bind-session 写入）。 */
const ORIGINS = Object.freeze(["heuristic", "explicit"]);

/**
 * 单条关联条目形状判定（纯函数）：workspace/proposal/sessionId 非空字符串、
 * origin 合法、createdAt/updatedAt 有限数。
 */
function validEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const workspace = typeof value.workspace === "string" && value.workspace ? value.workspace : "";
  const proposal = typeof value.proposal === "string" && value.proposal ? value.proposal : "";
  const sessionId = typeof value.sessionId === "string" && value.sessionId ? value.sessionId : "";
  if (!workspace || !proposal || !sessionId) return null;
  const origin = ORIGINS.includes(value.origin) ? value.origin : "heuristic";
  const createdAt = Number(value.createdAt);
  const updatedAt = Number(value.updatedAt);
  if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) return null;
  return { workspace, proposal, sessionId, origin, createdAt, updatedAt };
}

/** 条目键（幂等判定与去重单点；只构造不反解）。 */
function entryKey(entry) {
  return entry.workspace + "\u0000" + entry.proposal + "\u0000" + entry.sessionId;
}

/**
 * 关联条目归一化（纯函数，读档与写入口共用）：
 *  - 非数组 → undefined（文档无此字段）；
 *  - 形状非法条目丢弃；(workspace, proposal, sessionId) 三元重复 → 保留 updatedAt 最新；
 *  - 数量封顶 ASSOC_ENTRIES_LIMIT，超出按 updatedAt 淘汰最旧；
 *  - scope 提供时剪除：`archivedSessionIds` 命中即剪（会话归档 → 行星熄灭）；
 *    **提案归档不剪**（关联边记录保留，spec/状态机语义）；
 *  - 全空 → undefined（宿主写入口据此摘除整键）。
 *
 * @param {unknown} raw 原始条目数组
 * @param {{ archivedSessionIds?: Set<string> }} [scope] 失效判定基准
 * @returns {Array<object>|undefined}
 */
export function normalizeAssociations(raw, scope = null) {
  if (!Array.isArray(raw)) return undefined;
  const byKey = new Map();
  for (const item of raw) {
    const entry = validEntry(item);
    if (!entry) continue;
    const key = entryKey(entry);
    const existing = byKey.get(key);
    if (!existing || entry.updatedAt > existing.updatedAt) byKey.set(key, entry);
  }
  let entries = [...byKey.values()];
  if (scope?.archivedSessionIds) {
    entries = entries.filter((entry) => !scope.archivedSessionIds.has(entry.sessionId));
  }
  if (entries.length > ASSOC_ENTRIES_LIMIT) {
    entries.sort((a, b) => a.updatedAt - b.updatedAt);
    entries = entries.slice(entries.length - ASSOC_ENTRIES_LIMIT);
  }
  if (entries.length === 0) return undefined;
  return entries;
}

/**
 * 幂等写入（纯函数，任务 3.2）：已存在 (workspace, proposal, sessionId) 关联条目时
 * **不重写**（updatedAt/origin 原样保留——重扫零抖动）；不存在则插入 origin 条目。
 * @param {Array<object>|undefined} entries 现有条目
 * @param {{ workspace: string, proposal: string, sessionId: string, origin?: string }} input
 * @param {number} [now] 时间戳（缺省 Date.now()）
 * @returns {{ entries: Array<object>, changed: boolean }}
 */
export function upsertAssociation(entries, input, now = Date.now()) {
  const candidate = validEntry({
    workspace: input?.workspace,
    proposal: input?.proposal,
    sessionId: input?.sessionId,
    origin: input?.origin ?? "heuristic",
    createdAt: now,
    updatedAt: now
  });
  if (!candidate) return { entries: normalizeAssociations(entries) ?? [], changed: false };
  const list = Array.isArray(entries) ? entries : [];
  let existing = null;
  for (const entry of list) {
    const valid = validEntry(entry);
    if (valid && entryKey(valid) === entryKey(candidate)) {
      existing = valid;
      break;
    }
  }
  if (existing) return { entries: normalizeAssociations(list) ?? [existing], changed: false };
  const merged = normalizeAssociations([...list, candidate]);
  return { entries: merged ?? [], changed: true };
}

/**
 * 会话消亡剪除（纯函数，任务 3.5）：返回 null 表示全空（宿主摘除整键）。
 * @param {Array<object>|undefined} entries
 * @param {Set<string>} archivedSessionIds
 * @returns {Array<object>|null}
 */
export function pruneArchivedSessions(entries, archivedSessionIds) {
  const normalized = normalizeAssociations(entries, { archivedSessionIds });
  return normalized ?? null;
}

/**
 * 显式绑定请求归一化（fix-cosmos-association-scope 1.1 / spec「显式会话关联绑定」）：
 * `{ sessionId, proposals }`——`sessionId` 非空字符串（**原样保留**：registry 精确匹配
 * 用原文，仅以 trim 判空）；`proposals` 非空数组、条目以 **trim 后值**为准（trim 后
 * 空 → 非法）、按 trim 后值去重保序、上限 BIND_PROPOSALS_LIMIT（去重后）。
 * 非法 → `{ ok: false, reason }`（宿主映射 400 invalid；口径对齐 sweep 归一化）。
 * @param {unknown} body 请求体（任意 JSON 值）
 * @returns {{ ok: true, sessionId: string, proposals: string[] } | { ok: false, reason: string }}
 */
export function normalizeBindRequest(body) {
  const source = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  if (typeof source.sessionId !== "string" || !source.sessionId.trim()) {
    return { ok: false, reason: "sessionId must be a non-empty string" };
  }
  if (!Array.isArray(source.proposals)) return { ok: false, reason: "proposals must be an array" };
  const proposals = [];
  const seen = new Set();
  for (const value of source.proposals) {
    if (typeof value !== "string") return { ok: false, reason: "proposals entries must be strings" };
    const slug = value.trim();
    if (!slug) return { ok: false, reason: "proposals entries must be non-empty strings" };
    if (seen.has(slug)) continue;
    seen.add(slug);
    proposals.push(slug);
  }
  if (proposals.length === 0) return { ok: false, reason: "proposals must be a non-empty array" };
  if (proposals.length > BIND_PROPOSALS_LIMIT) {
    return { ok: false, reason: `proposals exceeds the limit of ${BIND_PROPOSALS_LIMIT} after dedupe` };
  }
  return { ok: true, sessionId: source.sessionId, proposals };
}

/**
 * 显式绑定的替换语义（fix-cosmos-association-scope 1.2 / spec「显式会话关联绑定」）：
 * 以 `(workspace, sessionId)` 为范围，写入「该会话当前工作面」的**完整声明**——
 *  - 保留范围内恰为 `proposals` 的 explicit 条目（createdAt/updatedAt 原样：重绑即零抖动）；
 *  - 同提案 heuristic 条目以 explicit 重建（origin 切换 = 变更；createdAt/updatedAt = now）；
 *  - 删除该范围内其余全部条目（其余 heuristic 与过期 explicit）；
 *  - 补齐缺失提案（explicit，createdAt/updatedAt = now）。
 *
 * 幂等：同清单且集合无增删 → `changed: false`、条目原样（updatedAt 不动）——宿主据此
 * 跳过落盘与广播。范围外条目一律原样保留（含其他会话 / 其他工作区）。
 *
 * @param {Array<object>|undefined} entries 现有条目
 * @param {{ workspace: string, sessionId: string, proposals: string[] }} input
 * @param {number} [now] 时间戳（缺省 Date.now()）
 * @returns {{ entries: Array<object>, changed: boolean }}
 */
export function applyBinding(entries, input, now = Date.now()) {
  const workspace = typeof input?.workspace === "string" ? input.workspace : "";
  const sessionId = typeof input?.sessionId === "string" ? input.sessionId : "";
  const proposals = Array.isArray(input?.proposals) ? input.proposals : [];
  const wanted = new Set(proposals);
  const list = Array.isArray(entries) ? entries : [];
  const next = [];
  let changed = false;
  for (const raw of list) {
    const entry = validEntry(raw);
    if (!entry) {
      changed = true; // 形状非法条目丢弃 = 变更（宿主写入口即清洗）
      continue;
    }
    if (entry.workspace !== workspace || entry.sessionId !== sessionId) {
      next.push(raw);
      continue;
    }
    if (entry.origin === "explicit" && wanted.has(entry.proposal)) {
      next.push(raw); // 已存 explicit 条目原样保留（幂等面）
      continue;
    }
    changed = true; // 其余条目（heuristic / 过期 explicit）删除
  }
  for (const proposal of proposals) {
    const exists = next.some((entry) => {
      const valid = validEntry(entry);
      return valid !== null && valid.workspace === workspace && valid.sessionId === sessionId && valid.proposal === proposal;
    });
    if (exists) continue;
    next.push({ workspace, proposal, sessionId, origin: "explicit", createdAt: now, updatedAt: now });
    changed = true;
  }
  if (!changed) return { entries: list, changed: false };
  return { entries: normalizeAssociations(next) ?? [], changed: true };
}

/**
 * 启发式压制查询（纯函数，fix-cosmos-association-scope 1.3 / spec 压制规则）：
 * 该工作区中持有任意 `origin: "explicit"` 条目的 sessionId 集合。以**存储条目为唯一
 * 依据**（无内存态标志）——进程重启后由存储回读自然恢复压制。
 * @param {Array<object>|undefined} entries
 * @param {string} workspace 工作区路径指纹
 * @returns {Set<string>}
 */
export function explicitBoundSessionIds(entries, workspace) {
  const bound = new Set();
  for (const raw of Array.isArray(entries) ? entries : []) {
    const entry = validEntry(raw);
    if (!entry) continue;
    if (entry.workspace !== workspace || entry.origin !== "explicit") continue;
    bound.add(entry.sessionId);
  }
  return bound;
}

/**
 * 按 sessionId 分组（纯函数，联星数据派生入口）：Map<sessionId, entry[]>。
 * @param {Array<object>} entries
 * @returns {Map<string, object[]>}
 */
export function groupBySession(entries) {
  const map = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const valid = validEntry(entry);
    if (!valid) continue;
    const list = map.get(valid.sessionId);
    if (list) list.push(valid);
    else map.set(valid.sessionId, [valid]);
  }
  return map;
}

/**
 * 会话工作区归属解析（纯函数，规则 1 的两路归属判定核心）：
 * `registry sessionIds` 反查优先，回落 `cwd` 与工作区 path 相等；未归属 → null。
 * @param {object} input
 * @param {string} [input.sessionId]
 * @param {string} [input.cwd] 会话 cwd（宿主从 agent.session.header.cwd 读取）
 * @param {Array<{ path?: string, sessionIds?: string[] }>} input.workspaces 在册工作区
 * @returns {string|null} 工作区路径（路径指纹）
 */
export function resolveWorkspacePath(input) {
  const workspaces = Array.isArray(input?.workspaces) ? input.workspaces : [];
  const sessionId = input?.sessionId;
  if (sessionId) {
    for (const ws of workspaces) {
      if (Array.isArray(ws?.sessionIds) && ws.sessionIds.includes(sessionId)) {
        return typeof ws.path === "string" && ws.path ? ws.path : null;
      }
    }
  }
  const cwd = typeof input?.cwd === "string" ? input.cwd : "";
  if (cwd) {
    for (const ws of workspaces) {
      if (typeof ws?.path === "string" && ws.path && ws.path === cwd) return ws.path;
    }
  }
  return null;
}

/**
 * 启发式规则 1 装配（纯函数，任务 3.2）：会话归属该工作区且近期上下文文本含提案
 * slug → 全部命中提案关联。已有关联条目的提案跳过（幂等由 upsertAssociation 兜底）。
 *
 * @param {object} input
 * @param {string} input.workspacePath 工作区路径指纹
 * @param {string} input.sessionId 会话 id
 * @param {string[]} input.proposalNames 活跃提案名（骨架扫描结果）
 * @param {string} input.contextText 该会话近期上下文文本（宿主从 ctx.agents 快照提取）
 * @param {Array<object>} [input.entries] 现有关联条目
 * @param {number} [input.now]
 * @returns {{ entries: Array<object>, added: string[] }}（added = 新增提案名）
 */
export function applyContextHeuristic(input) {
  const proposalNames = Array.isArray(input?.proposalNames) ? input.proposalNames : [];
  const already = new Set(
    (Array.isArray(input?.entries) ? input.entries : [])
      .filter((entry) => entry?.sessionId === input?.sessionId && entry?.workspace === input?.workspacePath)
      .map((entry) => entry?.proposal)
  );
  const matched = matchProposalSlugs(input?.contextText ?? "", proposalNames).filter((name) => !already.has(name));
  const entries = Array.isArray(input?.entries) ? input.entries : [];
  const added = [];
  let current = entries;
  for (const proposal of matched) {
    const result = upsertAssociation(current, {
      workspace: input.workspacePath,
      proposal,
      sessionId: input.sessionId,
      origin: "heuristic"
    }, input?.now);
    current = result.entries;
    if (result.changed) added.push(proposal);
  }
  return { entries: current, added };
}

/**
 * 启发式规则 2 装配（纯函数，任务 3.3）：提案目录出现 ±30min 窗口内该工作区
 * **唯一**活跃会话 → 关联。窗口判定与唯一性在 scan.mjs `birthtimeWindowUnique`；
 * 本函数只做装配与幂等。
 *
 * @param {object} input
 * @param {string} input.workspacePath
 * @param {object} input.proposal 骨架恒星（{ id, birthMs }）
 * @param {number|null} input.detectedMs fs.watch 首次检测时刻（birthMs 取不到时回落）
 * @param {Array<{sessionId: string, lastActivityMs: number}>} input.activeSessions 该工作区活跃会话
 * @param {Array<object>} [input.entries]
 * @param {number} [input.now]
 * @returns {{ entries: Array<object>, added: boolean }}
 */
export function applyBirthtimeHeuristic(input) {
  const matchedId = birthtimeWindowUnique({
    birthMs: input?.proposal?.birthMs ?? null,
    detectedMs: input?.detectedMs,
    sessions: input?.activeSessions ?? []
  });
  const entries = Array.isArray(input?.entries) ? input.entries : [];
  if (!matchedId) return { entries, added: false };
  const result = upsertAssociation(entries, {
    workspace: input.workspacePath,
    proposal: input.proposal.id,
    sessionId: matchedId,
    origin: "heuristic"
  }, input?.now);
  return { entries: result.entries, added: result.changed };
}

/**
 * 会话 → 行星多提案分组视图（纯函数，任务 3.4 联星派生的宿主侧出口）：
 * 客户端合并层按 stars 数组长度走联星轨道；这里把「一会话关联多提案」展开为
 * { sessionId, proposals: string[] } 便于骨架侧观察与冒烟断言。
 * @param {Array<object>} entries
 * @returns {Array<{ sessionId: string, proposals: string[] }>}
 */
export function multiProposalGroups(entries) {
  const groups = [];
  for (const [sessionId, list] of groupBySession(entries)) {
    const proposals = [...new Set(list.map((entry) => entry.proposal))];
    if (proposals.length > 1) groups.push({ sessionId, proposals });
  }
  return groups;
}

/** 骨架下发用的关联投影（宿主 buildSkeleton context.associations 的口径）。 */
export function projectionOf(entries) {
  const normalized = normalizeAssociations(entries);
  return (normalized ?? []).map((entry) => ({
    workspace: entry.workspace,
    proposal: entry.proposal,
    sessionId: entry.sessionId,
    origin: entry.origin,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt
  }));
}
