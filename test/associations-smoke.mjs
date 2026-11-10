/**
 * associations.mjs 冒烟（add-cosmos-entry 3.1–3.4）：归一化 / 幂等写入 / 封顶淘汰 /
 * 归属解析 / 规则 1 / 规则 2 / 联星分组 / 投影。
 * 运行：node test/associations-smoke.mjs
 */
import assert from "node:assert/strict";
import {
  ASSOC_VERSION,
  ASSOC_ENTRIES_LIMIT,
  normalizeAssociations,
  upsertAssociation,
  pruneArchivedSessions,
  groupBySession,
  resolveWorkspacePath,
  applyContextHeuristic,
  applyBirthtimeHeuristic,
  multiProposalGroups,
  projectionOf
} from "../src/associations.mjs";

const entry = (workspace, proposal, sessionId, updatedAt, origin = "heuristic") => ({
  workspace, proposal, sessionId, origin, createdAt: updatedAt - 1, updatedAt
});

/* ── 归一化：形状判定 + 三元去重保新 ── */
const normalized = normalizeAssociations([
  entry("C:/ws", "add-a", "s1", 100),
  entry("C:/ws", "add-a", "s1", 200), // 三元重复 → 保 updatedAt 最新
  { workspace: "", proposal: "x", sessionId: "y", createdAt: 0, updatedAt: 0 }, // 非法丢弃
  null,
  entry("C:/ws", "add-b", "s2", 300, "explicit")
]);
assert.equal(normalized.length, 2);
assert.equal(normalized[0].updatedAt, 200, "三元重复保最新");
assert.equal(normalized[1].origin, "explicit", "origin 保留");
assert.equal(normalizeAssociations("nope"), undefined, "非数组 → undefined");
assert.equal(normalizeAssociations([]), undefined, "空数组 → undefined（摘除整键语义）");

/* ── 封顶淘汰（updatedAt 淘汰最旧） ── */
const flood = [];
for (let i = 0; i < ASSOC_ENTRIES_LIMIT + 10; i++) flood.push(entry("C:/ws", "p" + i, "s" + i, i));
const capped = normalizeAssociations(flood);
assert.equal(capped.length, ASSOC_ENTRIES_LIMIT, "封顶 512");
assert.equal(Math.min(...capped.map((e) => e.updatedAt)), 10, "最旧 10 条被淘汰");

/* ── 幂等写入：已存在三元不重写（updatedAt/origin 不动） ── */
const first = upsertAssociation(undefined, { workspace: "C:/ws", proposal: "add-a", sessionId: "s1", origin: "heuristic" }, 100);
assert.equal(first.changed, true);
const again = upsertAssociation(first.entries, { workspace: "C:/ws", proposal: "add-a", sessionId: "s1", origin: "heuristic" }, 999);
assert.equal(again.changed, false, "幂等：不产生变更");
assert.equal(again.entries[0].updatedAt, 100, "updatedAt 不被重写");
const third = upsertAssociation(first.entries, { workspace: "C:/ws", proposal: "add-b", sessionId: "s1" }, 200);
assert.equal(third.changed, true);
assert.equal(third.entries.length, 2);
assert.equal(third.entries[1].origin, "heuristic", "缺省 origin=heuristic（任务 3.4 origin 记录）");

/* ── 会话归档剪除（任务 3.5 一半）：归档会话条目剪、其余保留 ── */
const pruned = pruneArchivedSessions(normalized, new Set(["s1"]));
assert.equal(pruned.length, 1, "归档会话剪除");
assert.equal(pruned[0].sessionId, "s2");
assert.equal(pruneArchivedSessions(normalized, new Set(["s1", "s2"])), null, "全空 → null（摘除整键）");
assert.equal(pruneArchivedSessions(undefined, new Set()), null);

/* ── 分组与联星派生（任务 3.4） ── */
const entries = [
  entry("C:/ws", "add-a", "s1", 1),
  entry("C:/ws", "add-b", "s1", 2),
  entry("C:/ws", "add-c", "s2", 3)
];
assert.equal(groupBySession(entries).get("s1").length, 2, "按会话分组");
assert.deepEqual(multiProposalGroups(entries), [{ sessionId: "s1", proposals: ["add-a", "add-b"] }], "一会话多提案 → 联星组");

/* ── 归属解析（规则 1 前置）：sessionIds 优先、cwd 兜底、未归属 null ── */
const workspaces = [
  { path: "C:/a", sessionIds: ["s1"] },
  { path: "C:/b", sessionIds: [] }
];
assert.equal(resolveWorkspacePath({ sessionId: "s1", workspaces }), "C:/a", "sessionIds 反查");
assert.equal(resolveWorkspacePath({ sessionId: "s2", cwd: "C:/b", workspaces }), "C:/b", "cwd 兜底");
assert.equal(resolveWorkspacePath({ sessionId: "s3", cwd: "C:/elsewhere", workspaces }), null, "未归属 → null");

/* ── 规则 1：归属 + 近期上下文含 slug → 关联；幂等重扫零抖动 ── */
const rule1 = applyContextHeuristic({
  workspacePath: "C:/ws",
  sessionId: "s1",
  proposalNames: ["add-a", "add-b"],
  contextText: "按照 proposal.md，add-a 需要实现骨架路由；顺带建了 add-b。",
  entries: [],
  now: 1000
});
assert.equal(rule1.added.length, 2, "双 slug 命中双关联");
const rule1Rescan = applyContextHeuristic({
  workspacePath: "C:/ws",
  sessionId: "s1",
  proposalNames: ["add-a", "add-b"],
  contextText: "add-a add-b 再提一次",
  entries: rule1.entries,
  now: 2000
});
assert.equal(rule1Rescan.added.length, 0, "幂等重扫零抖动");
assert.ok(rule1Rescan.entries.every((e) => e.updatedAt === 1000), "重扫不重写 updatedAt");

/* ── 规则 2：birthtime 窗口唯一会话 → 关联 ── */
const now = 10_000_000;
const rule2 = applyBirthtimeHeuristic({
  workspacePath: "C:/ws",
  proposal: { id: "add-c", birthMs: now },
  detectedMs: now - 1000,
  activeSessions: [{ sessionId: "s7", lastActivityMs: now + 60000 }],
  entries: rule1.entries,
  now
});
assert.equal(rule2.added, true, "窗口内唯一会话关联");
const rule2Miss = applyBirthtimeHeuristic({
  workspacePath: "C:/ws",
  proposal: { id: "add-d", birthMs: now },
  detectedMs: now,
  activeSessions: [
    { sessionId: "s7", lastActivityMs: now },
    { sessionId: "s8", lastActivityMs: now }
  ],
  entries: rule2.entries,
  now
});
assert.equal(rule2Miss.added, false, "多会话不关联");

/* ── 投影口径（骨架 context.associations） ── */
const projection = projectionOf(rule2.entries);
assert.ok(projection.every((e) => typeof e.workspace === "string" && typeof e.proposal === "string"), "投影字段齐全");
assert.equal(ASSOC_VERSION, 1, "version 字段契约");

console.log("associations-smoke: all assertions passed");
