/**
 * 会话扫尾纯逻辑单点（add-cosmos-archive-session-sweep / design.md D5/D8）。
 *
 * 独立模块——宿主 index.mjs 消费（两个扫尾端点）、test/sweep-smoke.mjs 直测。
 * 模块**零 node 内建依赖**（对齐 associations.mjs 惯例）：只做请求归一化、
 * 宿主错误 → outcome 分类映射、前缀拼接，HTTP 编排与 `await` 留在宿主半区。
 *
 * 契约要点（spec cosmos-archive-sweep）：
 *  - 批量归档：条目非空字符串、去重后上限 32、空数组合法（no-op）；逐会话
 *    outcome ∈ archived / skipped（+ activity 明细）/ already-archived / missing /
 *    failed，端点恒 200（部分失败不改变整体成功语义）；
 *  - 前缀改名：sessionId 非空、prefix 非空且 UTF-8 ≤ 64 字节；空题回退
 *    `prefix + "未命名"`；已以 prefix 开头 = 幂等 no-op（MUST NOT 双重前缀）；
 *  - 超长截断委托宿主 `maxTitleBytes`（保头截尾，前缀居头部天然保留），本模块
 *    不复制预算常量（design D4）。
 */

/** 批量归档去重后的条目上限（请求面封顶）。 */
export const ARCHIVE_SESSION_LIMIT = 32;
/** 前缀 UTF-8 字节上限（防滥用；真实前缀「已归档-」= 10 字节）。 */
export const PREFIX_MAX_BYTES = 64;
/** 空题回退词（拼接为 `prefix + 未命名`）。 */
export const FALLBACK_TITLE = "未命名";

/** 批量归档 outcome 全集（诊断/冒烟共用）。 */
export const ARCHIVE_OUTCOMES = Object.freeze(["archived", "skipped", "already-archived", "missing", "failed"]);
/** 前缀改名 outcome 全集。 */
export const RENAME_OUTCOMES = Object.freeze(["renamed", "unchanged"]);

/**
 * UTF-8 字节长度（纯函数，零内建依赖；孤立代理项按 3 字节计，与 TextEncoder 一致）。
 * @param {unknown} text
 * @returns {number}
 */
export function utf8ByteLength(text) {
  const value = typeof text === "string" ? text : "";
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.codePointAt(index);
    if (code > 0xffff) {
      bytes += 4;
      index++; // 代理对占两个 UTF-16 码元
    } else if (code > 0x7ff) {
      bytes += 3;
    } else if (code > 0x7f) {
      bytes += 2;
    } else {
      bytes += 1;
    }
  }
  return bytes;
}

/** 非空字符串判定（空白串视同空——请求面校验用）。 */
function nonEmpty(value) {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * 批量归档请求归一化（任务 1.1）：`{ sessionIds: string[] }`。
 *  - 缺失 / 非数组 / 含空串（含空白串）条目 / 去重后超限 → `{ ok: false, reason }`
 *    （宿主映射 400 invalid）；
 *  - 去重保序（首次出现的位置）；空数组合法（no-op 成功，零队友提案与全已归档
 *    重跑无需技能特判）。
 * @param {unknown} body 请求体（任意 JSON 值）
 * @returns {{ ok: true, sessionIds: string[] } | { ok: false, reason: string }}
 */
export function normalizeArchiveRequest(body) {
  const raw = body && typeof body === "object" && !Array.isArray(body) ? body.sessionIds : undefined;
  if (!Array.isArray(raw)) return { ok: false, reason: "sessionIds must be an array" };
  const sessionIds = [];
  const seen = new Set();
  for (const value of raw) {
    if (!nonEmpty(value)) return { ok: false, reason: "sessionIds entries must be non-empty strings" };
    if (seen.has(value)) continue;
    seen.add(value);
    sessionIds.push(value);
  }
  if (sessionIds.length > ARCHIVE_SESSION_LIMIT) {
    return { ok: false, reason: `sessionIds exceeds the limit of ${ARCHIVE_SESSION_LIMIT} after dedupe` };
  }
  return { ok: true, sessionIds };
}

/**
 * 前缀改名请求归一化（任务 1.1）：`{ sessionId, prefix }`。
 * sessionId 非空字符串；prefix 非空字符串且 UTF-8 ≤ PREFIX_MAX_BYTES。
 * @param {unknown} body
 * @returns {{ ok: true, sessionId: string, prefix: string } | { ok: false, reason: string }}
 */
export function normalizeRenameRequest(body) {
  const source = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  if (!nonEmpty(source.sessionId)) return { ok: false, reason: "sessionId must be a non-empty string" };
  if (!nonEmpty(source.prefix)) return { ok: false, reason: "prefix must be a non-empty string" };
  if (utf8ByteLength(source.prefix) > PREFIX_MAX_BYTES) {
    return { ok: false, reason: `prefix exceeds ${PREFIX_MAX_BYTES} UTF-8 bytes` };
  }
  return { ok: true, sessionId: source.sessionId, prefix: source.prefix };
}

/** activity 条目归一化：`{id}` + 可选 `label`；无 id 的条目丢弃。 */
function normalizeActivityItems(raw) {
  const items = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    const id = typeof entry?.id === "string" ? entry.id : "";
    if (!id) continue;
    const item = { id };
    if (typeof entry?.label === "string" && entry.label) item.label = entry.label;
    items.push(item);
  }
  return items;
}

/**
 * 宿主活动瀑布明细归一化（任务 1.2）：宿主 `WorkspaceActiveSessionError.activity`
 * = `[{ kind, items?: [{id, label?}] }]` → `[{ family, items? }]`。
 *  - 族（`family`）必现：无逐条身份的族（如 `turn`）不携带 items；未知 kind 兜底
 *    `"unknown"`（保持「族必现」不变式）；
 *  - 条目 id/名称按宿主回报透传（label 缺席即不带该键）。
 * @param {unknown} activity
 * @returns {Array<{ family: string, items?: Array<{ id: string, label?: string }> }>}
 */
export function normalizeActivity(activity) {
  const out = [];
  for (const entry of Array.isArray(activity) ? activity : []) {
    const family =
      (typeof entry?.kind === "string" && entry.kind) ||
      (typeof entry?.family === "string" && entry.family) ||
      "unknown";
    const item = { family };
    const items = normalizeActivityItems(entry?.items);
    if (items.length > 0) item.items = items;
    out.push(item);
  }
  return out;
}

/**
 * 归档错误 → outcome 分类（任务 1.2 / design D8）：
 *  - `WorkspaceActiveSessionError`（`workspace/session-active`）→ `skipped` + activity；
 *  - `WorkspaceUnknownSessionError` → `missing`；
 *  - 其余 → `failed` + message。
 * 宿主错误以 `name` 为权威身份（官方包构造器设置），`code` 作为兼容兜底。
 * @param {unknown} error 宿主 archiveSession 抛出的错误
 * @returns {{ outcome: "skipped", activity: Array<object> }
 *          | { outcome: "missing" }
 *          | { outcome: "failed", error: string }}
 */
export function classifyArchiveError(error) {
  const name = typeof error?.name === "string" ? error.name : "";
  const code = typeof error?.code === "string" ? error.code : "";
  if (name === "WorkspaceActiveSessionError" || code === "workspace/session-active") {
    return { outcome: "skipped", activity: normalizeActivity(error?.activity) };
  }
  if (name === "WorkspaceUnknownSessionError" || code === "workspace/session-unknown") {
    return { outcome: "missing" };
  }
  return { outcome: "failed", error: String(error?.message || error) };
}

/**
 * 前缀拼接（任务 1.3 / design D4）：
 *  - 空题（含纯空白 / 非字符串）→ `prefix + "未命名"`；
 *  - 已以 prefix 开头 → 幂等 no-op（`unchanged: true`，标题原样，MUST NOT 双重前缀）；
 *  - 否则 `prefix + 原题`（超长交宿主 `maxTitleBytes` 保头截尾，本函数不预判）。
 * @param {unknown} currentTitle 宿主标题快照的 title（无标题时为空串/undefined）
 * @param {string} prefix
 * @returns {{ title: string, unchanged: boolean }}
 */
export function composePrefixedTitle(currentTitle, prefix) {
  const head = typeof prefix === "string" ? prefix : "";
  const title = (typeof currentTitle === "string" ? currentTitle : "").trim();
  if (!title) return { title: head + FALLBACK_TITLE, unchanged: false };
  if (head && title.startsWith(head)) return { title, unchanged: true };
  return { title: head + title, unchanged: false };
}

/**
 * 改名结果归一化（任务 1.2）：`renamed`（宿主接受的最终标题，含截断结果）/
 * `unchanged`（幂等 no-op，标题未写）/ `failed`（宿主未接受任何可见标题的兜底）。
 * @param {{ unchanged?: boolean, title?: string, accepted?: { title?: unknown } }} input
 * @returns {{ outcome: "unchanged", title: string }
 *          | { outcome: "renamed", title: string }
 *          | { outcome: "failed", error: string }}
 */
export function normalizeRenameResult(input) {
  const inputTitle = typeof input?.title === "string" ? input.title : "";
  if (input?.unchanged === true) return { outcome: "unchanged", title: inputTitle };
  const acceptedTitle = typeof input?.accepted?.title === "string" ? input.accepted.title : "";
  if (!acceptedTitle) return { outcome: "failed", error: "session title service accepted no visible title" };
  return { outcome: "renamed", title: acceptedTitle };
}
