/**
 * 会话卡就地归档纯逻辑单点（add-cosmos-session-archive-action / design D5）。
 *
 * 独立模块——浏览器半区 `client.jsx` 消费（信息卡「归档会话」点击链路）、
 * `test/session-archive-smoke.mjs` 直测。模块**零 DOM / 零网络依赖**（对齐
 * actions.mjs / sweep.mjs 惯例）：只做 outcome 合法性判定、宿主 outcome →
 * toast 文案映射、activity 明细 → 可读摘要；HTTP 与 toast 下发留在 client.jsx。
 *
 * 契约要点（spec cosmos-session-archive「outcome 呈现契约」）：
 *  - outcome ∈ archived / skipped（+ activity 明细）/ already-archived / missing /
 *    failed（五路互斥；单会话场景恒对应一个 outcome，不产生混淆表述）；
 *  - `skipped` = 未归档说明 + activity 摘要（按族列出：族必现、携带条目身份的族
 *    列出条目数、单条目族的条目名可截断）；其余四路天然无明细；
 *  - `already-archived` / `missing` MUST 呈中性文案（MUST NOT 呈现为失败）。
 */

/** 批量归档逐会话 outcome 全集（与宿主端点 `sweep.mjs` 的 ARCHIVE_OUTCOMES 同源同序）。 */
export const SESSION_ARCHIVE_OUTCOMES = Object.freeze([
  "archived",
  "skipped",
  "already-archived",
  "missing",
  "failed"
]);

/**
 * activity 族名 → 领域词汇（宿主活动瀑布的四个准入族：turn / subagent 链 / job /
 * schedule，见 design.md「宿主事实」表）。未登记的族名原样透传（族必现，不吞信息）。
 */
export const ACTIVITY_FAMILY_LABELS = Object.freeze({
  turn: "运行回合",
  subagent: "子代理",
  job: "后台任务",
  schedule: "定时任务"
});

/** 未知 / 缺失族名的兜底名（「族必现」不变式：摘要里恒有族标记）。 */
export const UNKNOWN_ACTIVITY_FAMILY = "unknown";

/** 单条目族的条目名截断预算（字符数口径，含省略号；族名永远完整呈现）。 */
export const ACTIVITY_ITEM_LABEL_MAX_CHARS = 12;

/** 呈现基调（引擎 toast 只有文本通道，tone 供调用方/冒烟区分中性与非中性）。 */
export const ARCHIVE_NOTICE_TONES = Object.freeze(["ok", "neutral", "warn", "error"]);

/**
 * outcome 合法性判定（任务 1.1）：宿主只回报五路之一；其余值按「结果未知」兜底。
 * @param {unknown} value
 * @returns {boolean}
 */
export function isSessionArchiveOutcome(value) {
  return typeof value === "string" && SESSION_ARCHIVE_OUTCOMES.includes(value);
}

/** 字符数截断（按码点，不劈开代理对；超预算时保留 max-1 字符 + 省略号）。 */
function truncateChars(text, max) {
  const chars = Array.from(text);
  if (!(max > 0) || chars.length <= max) return text;
  return chars.slice(0, max - 1).join("") + "…";
}

/**
 * activity 族名 → 呈现词（任务 1.3）：登记族走领域词汇；未登记族原样透传；
 * 缺失 / 非字符串 / 空白 → `unknown`（族必现）。
 * @param {unknown} family
 * @returns {string}
 */
export function activityFamilyLabelOf(family) {
  const name = typeof family === "string" ? family.trim() : "";
  if (!name) return UNKNOWN_ACTIVITY_FAMILY;
  return ACTIVITY_FAMILY_LABELS[name] ?? name;
}

/**
 * 单条目名（任务 1.3）：宿主回报的 `label` 原样透传，按字符预算截断；
 * 无 label（或空白）→ 空串（摘要侧改用条目数聚合，不回显 id）。
 * @param {unknown} item
 * @returns {string}
 */
export function activityItemLabelOf(item) {
  const raw = typeof item?.label === "string" ? item.label : "";
  const text = raw.trim();
  if (!text) return "";
  return truncateChars(text, ACTIVITY_ITEM_LABEL_MAX_CHARS);
}

/**
 * activity 明细 → 摘要文案（任务 1.3）：条目以「；」分隔，按宿主回报顺序呈现。
 *  - 无条目族（如 `turn`）→ 族名（领域词汇）；
 *  - 多条目族 → `族名 ×N`（条目数聚合，条目名不展开）；
 *  - 单条目族 → `族名（条目名）`，条目名缺省则回退 `族名 ×1`。
 * @param {unknown} activity 宿主 `skipped` outcome 的 activity 数组
 *        （`[{family, items?: [{id, label?}]}]`；兼容原始 `{kind}` 形状）
 * @returns {string} 空数组 / 非数组 → 空串（调用方决定不加明细段）
 */
export function activitySummaryOf(activity) {
  const parts = [];
  for (const entry of Array.isArray(activity) ? activity : []) {
    const family = activityFamilyLabelOf(entry?.family ?? entry?.kind);
    const items = Array.isArray(entry?.items) ? entry.items : [];
    if (items.length === 0) {
      parts.push(family);
      continue;
    }
    if (items.length === 1) {
      const label = activityItemLabelOf(items[0]);
      parts.push(label ? family + "（" + label + "）" : family + " ×1");
      continue;
    }
    parts.push(family + " ×" + items.length);
  }
  return parts.join("；");
}

/** 文案产物（`outcome` 回填原始值，供调用方/冒烟断言；`text` 直接进引擎 toast）。 */
function noticeOf(outcome, tone, text) {
  return { outcome, tone, text };
}

/** 宿主错误消息兜底（`failed` outcome 的可读原因）。 */
function errorTextOf(error) {
  const text = typeof error === "string" ? error.trim() : "";
  return text || "未知错误";
}

/**
 * outcome → 呈现文案（任务 1.2 / spec「outcome 呈现契约」）：
 *  - `archived` → 已归档确认（ok）；
 *  - `already-archived` → 中性的已归档确认（neutral，MUST NOT 呈现为失败）；
 *  - `missing` → 中性说明：会话已不存在，等效于无会话可归档（neutral）；
 *  - `skipped` → 「会话仍在运行，未归档」+（有明细时）activity 摘要（warn）；
 *  - `failed` → 失败 + 宿主错误消息（error）；
 *  - 其余 / 缺失 outcome → 「归档结果未知」（error，防御性兜底）。
 * @param {{sessionId?: string, outcome?: string, activity?: unknown, error?: unknown}|null} result
 * @returns {{outcome: string, tone: string, text: string}}
 */
export function archiveNoticeOf(result) {
  const outcome = typeof result?.outcome === "string" ? result.outcome : "";
  if (outcome === "archived") return noticeOf(outcome, "ok", "会话已归档");
  if (outcome === "already-archived") return noticeOf(outcome, "neutral", "该会话已归档");
  if (outcome === "missing") return noticeOf(outcome, "neutral", "会话已不存在，无需归档");
  if (outcome === "skipped") {
    const summary = activitySummaryOf(result?.activity);
    return noticeOf(
      outcome,
      "warn",
      summary ? "会话仍在运行，未归档：" + summary : "会话仍在运行，未归档"
    );
  }
  if (outcome === "failed") {
    return noticeOf(outcome, "error", "归档失败：" + errorTextOf(result?.error));
  }
  return noticeOf(
    outcome || UNKNOWN_ACTIVITY_FAMILY,
    "error",
    outcome ? "归档结果未知：" + outcome : "归档结果未知"
  );
}

/**
 * 请求级失败（网络错误 / 非 2xx / 端点不可达）→ 呈现文案（任务 3.1 的失败分支）。
 * @param {unknown} error Error 实例 / 宿主 reason 文本 / 状态行
 * @returns {{outcome: "failed", tone: "error", text: string}}
 */
export function archiveRequestFailureNotice(error) {
  const message = typeof error === "string"
    ? error.trim()
    : String(error?.message ?? "").trim();
  return noticeOf("failed", "error", "归档请求失败：" + (message || "端点不可达，可再次点击重试"));
}
