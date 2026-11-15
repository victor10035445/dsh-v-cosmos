/**
 * 会话扫尾纯逻辑冒烟（add-cosmos-archive-session-sweep 1.4 / spec cosmos-archive-sweep）：
 * 直测 src/sweep.mjs 全部分支——请求归一化（400 invalid 各形态）、宿主错误 →
 * outcome 分流（activity 明细透传）、前缀拼接（空题回退 / 已带前缀幂等）、
 * 改名结果归一化与重跑幂等。零宿主依赖。
 * 运行：node test/sweep-smoke.mjs
 */
import assert from "node:assert/strict";
import {
  ARCHIVE_SESSION_LIMIT,
  PREFIX_MAX_BYTES,
  FALLBACK_TITLE,
  utf8ByteLength,
  normalizeArchiveRequest,
  normalizeRenameRequest,
  normalizeActivity,
  classifyArchiveError,
  composePrefixedTitle,
  normalizeRenameResult
} from "../src/sweep.mjs";

/* ── utf8ByteLength：ASCII / 2 字节 / 3 字节 / 4 字节（代理对） ── */
assert.equal(utf8ByteLength(""), 0);
assert.equal(utf8ByteLength("abc"), 3);
assert.equal(utf8ByteLength("é"), 2);
assert.equal(utf8ByteLength("已归档-"), 10, "三个 CJK（各 3 字节）+ ASCII 连字符（1 字节）");
assert.equal(utf8ByteLength("😀"), 4, "代理对按 4 字节计");
assert.equal(utf8ByteLength(undefined), 0, "非字符串 → 0");

/* ── 批量归档请求归一化：非法形态一律 400 invalid（ok:false） ── */
for (const [label, body] of [
  ["缺失 body", undefined],
  ["缺失 sessionIds", {}],
  ["sessionIds 非数组", { sessionIds: "s-1" }],
  ["sessionIds 为对象", { sessionIds: { 0: "s-1" } }],
  ["body 为数组", ["s-1"]],
  ["含空串条目", { sessionIds: ["s-1", ""] }],
  ["含纯空白条目", { sessionIds: ["s-1", "   "] }],
  ["含非字符串条目", { sessionIds: ["s-1", 42] }],
  ["含 null 条目", { sessionIds: [null] }]
]) {
  const result = normalizeArchiveRequest(body);
  assert.equal(result.ok, false, "非法请求被拒绝：" + label);
  assert.equal(typeof result.reason, "string");
  assert.ok(result.reason.length > 0, "非法请求携带原因：" + label);
}

/* 空数组合法（no-op 成功：零队友提案 / 全已归档重跑无需技能特判） */
assert.deepEqual(normalizeArchiveRequest({ sessionIds: [] }), { ok: true, sessionIds: [] });

/* 去重保序 */
assert.deepEqual(
  normalizeArchiveRequest({ sessionIds: ["b", "a", "b", "c", "a"] }).sessionIds,
  ["b", "a", "c"],
  "去重保留首次出现位置"
);

/* 上限 32：按「去重后」计数 */
const atLimit = Array.from({ length: ARCHIVE_SESSION_LIMIT }, (_, index) => "s-" + index);
assert.equal(normalizeArchiveRequest({ sessionIds: atLimit }).sessionIds.length, ARCHIVE_SESSION_LIMIT, "32 条合法");
assert.equal(normalizeArchiveRequest({ sessionIds: [...atLimit, "s-32"] }).ok, false, "去重后 33 条 → 400");
assert.equal(
  normalizeArchiveRequest({ sessionIds: [...atLimit, "s-0", "s-1"] }).ok,
  true,
  "原始 34 条但去重后 32 条 → 合法（上限看去重后）"
);

/* ── 前缀改名请求归一化 ── */
for (const [label, body] of [
  ["缺失 body", undefined],
  ["缺失 sessionId", { prefix: "已归档-" }],
  ["sessionId 空串", { sessionId: "", prefix: "已归档-" }],
  ["sessionId 纯空白", { sessionId: "  ", prefix: "已归档-" }],
  ["sessionId 非字符串", { sessionId: 7, prefix: "已归档-" }],
  ["缺失 prefix", { sessionId: "s-1" }],
  ["prefix 空串", { sessionId: "s-1", prefix: "" }],
  ["prefix 纯空白", { sessionId: "s-1", prefix: " \t " }],
  ["prefix 非字符串", { sessionId: "s-1", prefix: 5 }],
  ["prefix 超 64 字节", { sessionId: "s-1", prefix: "a".repeat(PREFIX_MAX_BYTES + 1) }],
  ["prefix 多字节超限", { sessionId: "s-1", prefix: "已".repeat(22) }] // 66 字节
]) {
  const result = normalizeRenameRequest(body);
  assert.equal(result.ok, false, "非法改名请求被拒绝：" + label);
  assert.equal(typeof result.reason, "string");
}

assert.deepEqual(
  normalizeRenameRequest({ sessionId: "s-1", prefix: "已归档-" }),
  { ok: true, sessionId: "s-1", prefix: "已归档-" },
  "归档技能的标准请求合法（已归档- = 10 字节）"
);
assert.equal(normalizeRenameRequest({ sessionId: "s-1", prefix: "a".repeat(PREFIX_MAX_BYTES) }).ok, true, "恰好 64 字节合法");
assert.equal(normalizeRenameRequest({ sessionId: "s-1", prefix: "已".repeat(21) }).ok, true, "63 字节合法");

/* ── activity 明细透传（族必现；条目 id/名称按宿主回报） ── */
assert.deepEqual(
  normalizeActivity([{ kind: "job", items: [{ id: "job-1", label: "构建" }, { id: "job-2" }] }]),
  [{ family: "job", items: [{ id: "job-1", label: "构建" }, { id: "job-2" }] }],
  "job 族携带条目 id + 名称（无名称条目不带 label 键）"
);
assert.deepEqual(normalizeActivity([{ kind: "turn" }]), [{ family: "turn" }], "turn 族无逐条身份 → 不携带 items");
assert.deepEqual(
  normalizeActivity([{ kind: "subagent", items: [{ id: "child-9", label: "探针" }, { label: "无 id" }] }, { kind: "schedule", items: [] }]),
  [{ family: "subagent", items: [{ id: "child-9", label: "探针" }] }, { family: "schedule" }],
  "无 id 条目丢弃；空 items 不输出该键"
);
assert.deepEqual(normalizeActivity([{ items: [{ id: "x" }] }]), [{ family: "unknown", items: [{ id: "x" }] }], "未知族兜底 unknown（族必现）");
assert.deepEqual(normalizeActivity(undefined), []);
assert.deepEqual(normalizeActivity("nope"), []);

/* ── 宿主错误 → outcome 分类（design D8 映射表） ── */
const activeError = Object.assign(new Error("cannot archive session 's-1': the session is active (job)"), {
  name: "WorkspaceActiveSessionError",
  sessionId: "s-1",
  activity: [{ kind: "job", items: [{ id: "job-1", label: "构建" }] }]
});
assert.deepEqual(
  classifyArchiveError(activeError),
  { outcome: "skipped", activity: [{ family: "job", items: [{ id: "job-1", label: "构建" }] }] },
  "活动瀑布拒绝 → skipped + activity 明细"
);

const codeOnlyActive = Object.assign(new Error("active"), { code: "workspace/session-active", activity: [{ kind: "turn" }] });
assert.deepEqual(classifyArchiveError(codeOnlyActive), { outcome: "skipped", activity: [{ family: "turn" }] }, "code 兜底识别活动拒绝");

const unknownError = Object.assign(new Error("cannot archive session 's-x': live sessions and session persistence hold no such session"), {
  name: "WorkspaceUnknownSessionError",
  sessionId: "s-x"
});
assert.deepEqual(classifyArchiveError(unknownError), { outcome: "missing" }, "未知会话 → missing");

assert.deepEqual(
  classifyArchiveError(new Error("storage exploded")),
  { outcome: "failed", error: "storage exploded" },
  "其他错误 → failed + message"
);
assert.deepEqual(classifyArchiveError(undefined), { outcome: "failed", error: "undefined" }, "非 Error 兜底 → failed（不抛）");

/* ── 前缀拼接：空题回退 / 正常拼接 / 已带前缀幂等 ── */
assert.deepEqual(composePrefixedTitle(undefined, "已归档-"), { title: "已归档-" + FALLBACK_TITLE, unchanged: false }, "无标题 → 回退未命名");
assert.deepEqual(composePrefixedTitle("", "已归档-"), { title: "已归档-" + FALLBACK_TITLE, unchanged: false }, "空串标题 → 回退未命名");
assert.deepEqual(composePrefixedTitle("   ", "已归档-"), { title: "已归档-" + FALLBACK_TITLE, unchanged: false }, "纯空白标题 → 回退未命名");
assert.deepEqual(composePrefixedTitle("归档提案的扫尾", "已归档-"), { title: "已归档-归档提案的扫尾", unchanged: false }, "正常拼接");
assert.deepEqual(composePrefixedTitle("  原题  ", "已归档-"), { title: "已归档-原题", unchanged: false }, "首尾空白裁掉（对齐宿主清洗）");
assert.deepEqual(
  composePrefixedTitle("已归档-原题", "已归档-"),
  { title: "已归档-原题", unchanged: true },
  "已带前缀 → 幂等 no-op（不产生双重前缀）"
);
assert.deepEqual(composePrefixedTitle("已归档-未命名", "已归档-"), { title: "已归档-未命名", unchanged: true }, "回退标题重跑仍幂等");

/* 幂等重跑：连续两次拼接，第二次必为 unchanged 且标题不变 */
const first = composePrefixedTitle("扫尾提案", "已归档-");
const second = composePrefixedTitle(first.title, "已归档-");
assert.equal(first.unchanged, false);
assert.equal(second.unchanged, true, "重跑幂等");
assert.equal(second.title, first.title, "重跑标题不变");
assert.ok(!second.title.startsWith("已归档-已归档-"), "MUST NOT 双重前缀");

/* ── 改名结果归一化：renamed / unchanged / failed ── */
assert.deepEqual(normalizeRenameResult({ unchanged: false, accepted: { title: "已归档-原题" } }), {
  outcome: "renamed",
  title: "已归档-原题"
}, "宿主接受 → renamed + 最终标题");
assert.deepEqual(normalizeRenameResult({ unchanged: true, title: "已归档-原题" }), {
  outcome: "unchanged",
  title: "已归档-原题"
}, "已带前缀 → unchanged（不写标题）");
assert.deepEqual(normalizeRenameResult({ unchanged: false, accepted: { title: "x".repeat(400) } }), {
  outcome: "renamed",
  title: "x".repeat(400)
}, "超长由宿主截断，本层不预判预算");
assert.equal(normalizeRenameResult({ unchanged: false, accepted: {} }).outcome, "failed", "宿主未接受标题 → failed 兜底");
assert.equal(normalizeRenameResult({ unchanged: false, accepted: { title: "" } }).outcome, "failed", "空接受标题 → failed 兜底");

console.log("sweep-smoke: all assertions passed");
