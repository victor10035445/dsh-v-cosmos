/**
 * associations.mjs 冒烟（add-cosmos-entry 3.1–3.4）：归一化 / 幂等写入 / 封顶淘汰 /
 * 归属解析 / 规则 1 / 规则 2 / 联星分组 / 投影。
 * 运行：node test/associations-smoke.mjs
 */
import assert from "node:assert/strict";
import { assignmentProposalSlugs } from "../src/scan.mjs";
import {
  ASSOC_VERSION,
  ASSOC_ENTRIES_LIMIT,
  BIND_PROPOSALS_LIMIT,
  normalizeAssociations,
  upsertAssociation,
  pruneArchivedSessions,
  groupBySession,
  resolveWorkspacePath,
  applyContextHeuristic,
  applyBirthtimeHeuristic,
  multiProposalGroups,
  projectionOf,
  normalizeBindRequest,
  applyBinding,
  explicitBoundSessionIds
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

/* ── 规则 1（restrict-association-heuristics 2.x）：只认用户侧 @指派引用；正文提及不建立；
      幂等重扫零抖动 ── */
{
  /* 正文提及：旧口径会把罗列的 slug 全部挂上；新口径无指派信号 → 零关联。 */
  const narrativeText = "按照 proposal.md，add-a 需要实现骨架路由；顺带建了 add-b。";
  assert.deepEqual(assignmentProposalSlugs(narrativeText), [], "正文罗列 slug → 无指派信号");
  const rule1Narrative = applyContextHeuristic({
    workspacePath: "C:/ws",
    sessionId: "s2",
    proposalNames: ["add-a", "add-b"],
    assignmentSlugs: assignmentProposalSlugs(narrativeText),
    entries: [],
    now: 900
  });
  assert.deepEqual(rule1Narrative.added, [], "正文提及不再建立关联");
  assert.equal(rule1Narrative.entries.length, 0, "无关联条目写入");

  /* 用户侧 @引用（含 Windows 反斜杠写法 + 非活跃提案名）→ 只挂活跃命中项。 */
  const assignedText = "请按 @C:\\ws\\openspec\\changes\\add-a 实施；@C:/ws/openspec/changes/unknown-proposal 先不管";
  const rule1 = applyContextHeuristic({
    workspacePath: "C:/ws",
    sessionId: "s1",
    proposalNames: ["add-a", "add-b"],
    assignmentSlugs: assignmentProposalSlugs(assignedText),
    entries: [],
    now: 1000
  });
  assert.deepEqual(rule1.added, ["add-a"], "指派信号命中活跃提案（非活跃 slug 过滤）");
  assert.equal(rule1.entries.length, 1, "恰一条关联");

  /* 多指派引用 → 多提案联星（去重保序）。 */
  const multi = applyContextHeuristic({
    workspacePath: "C:/ws",
    sessionId: "s3",
    proposalNames: ["add-a", "add-b"],
    assignmentSlugs: assignmentProposalSlugs("@C:/ws/openspec/changes/add-b 与 @C:/ws/openspec/changes/add-a"),
    entries: rule1.entries,
    now: 1100
  });
  assert.deepEqual(multi.added, ["add-b", "add-a"], "多指派引用按出现序建立（联星）");

  /* 幂等重扫：同一指派信号再扫 → 零新增、updatedAt 不刷新。 */
  const rule1Rescan = applyContextHeuristic({
    workspacePath: "C:/ws",
    sessionId: "s1",
    proposalNames: ["add-a", "add-b"],
    assignmentSlugs: assignmentProposalSlugs("再看 @C:/ws/openspec/changes/add-a"),
    entries: multi.entries,
    now: 2000
  });
  assert.equal(rule1Rescan.added.length, 0, "幂等重扫零抖动");
  assert.ok(rule1Rescan.entries.every((e) => e.updatedAt <= 1100), "重扫不重写 updatedAt");
}

/* ── 规则 2：birthtime 窗口唯一会话 → 关联；运行中候选排除（restrict-association-heuristics 3.x） ── */
const now = 10_000_000;
const rule2 = applyBirthtimeHeuristic({
  workspacePath: "C:/ws",
  proposal: { id: "add-c", birthMs: now },
  detectedMs: now - 1000,
  activeSessions: [{ sessionId: "s7", lastActivityMs: now + 60000 }],
  entries: [],
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
const rule2Busy = applyBirthtimeHeuristic({
  workspacePath: "C:/ws",
  proposal: { id: "add-e", birthMs: now },
  detectedMs: now,
  activeSessions: [{ sessionId: "s7", lastActivityMs: now }],
  runningSessionIds: new Set(["s7"]),
  entries: rule2Miss.entries,
  now
});
assert.equal(rule2Busy.added, false, "唯一候选正在运行 → 不建立（忙碌会话不接生新目录）");
const rule2Waiting = applyBirthtimeHeuristic({
  workspacePath: "C:/ws",
  proposal: { id: "add-f", birthMs: now },
  detectedMs: now,
  activeSessions: [{ sessionId: "s9", lastActivityMs: now }],
  runningSessionIds: new Set(), // 等待决策会话 running=false → 不在运行集合 → 保留候选
  entries: rule2Busy.entries,
  now
});
assert.equal(rule2Waiting.added, true, "等待决策（非运行）候选保留 → 照常建立");

/* ── 投影口径（骨架 context.associations） ── */
const projection = projectionOf(rule2.entries);
assert.ok(projection.every((e) => typeof e.workspace === "string" && typeof e.proposal === "string"), "投影字段齐全");
assert.equal(ASSOC_VERSION, 1, "version 字段契约");

/* ── 显式绑定请求归一化（fix-cosmos-association-scope 1.1 / spec「显式会话关联绑定」） ── */
{
  const valid = normalizeBindRequest({ sessionId: " s1 ", proposals: [" add-a ", "add-a", " add-b "] });
  assert.equal(valid.ok, true, "合法请求");
  assert.equal(valid.sessionId, " s1 ", "sessionId 原样保留（registry 精确匹配用原文，仅 trim 判空）");
  assert.deepEqual(valid.proposals, ["add-a", "add-b"], "条目以 trim 后值为准 + 去重保序");

  const maxed = normalizeBindRequest({
    sessionId: "s1",
    proposals: Array.from({ length: BIND_PROPOSALS_LIMIT }, (_, index) => "p-" + index)
  });
  assert.equal(maxed.ok, true, `去重后 ${BIND_PROPOSALS_LIMIT} 条合法（上限内）`);

  const invalidCases = [
    ["缺失/非对象 body", undefined],
    ["缺失 sessionId", { proposals: ["add-a"] }],
    ["sessionId 空白串", { sessionId: "   ", proposals: ["add-a"] }],
    ["sessionId 非字符串", { sessionId: 7, proposals: ["add-a"] }],
    ["proposals 缺失", { sessionId: "s1" }],
    ["proposals 非数组", { sessionId: "s1", proposals: "add-a" }],
    ["proposals 空数组", { sessionId: "s1", proposals: [] }],
    ["条目非字符串", { sessionId: "s1", proposals: ["add-a", 3] }],
    ["条目 trim 后为空", { sessionId: "s1", proposals: ["add-a", "   "] }],
    ["去重后超上限", { sessionId: "s1", proposals: Array.from({ length: BIND_PROPOSALS_LIMIT + 1 }, (_, index) => "p-" + index) }]
  ];
  for (const [label, body] of invalidCases) {
    const result = normalizeBindRequest(body);
    assert.equal(result.ok, false, "非法请求：" + label);
    assert.equal(typeof result.reason, "string", "非法请求携带 reason：" + label);
  }
}

/* ── 替换语义（1.2）：保留恰为清单的 explicit、清其余、origin 切换、范围隔离 ── */
{
  const seed = [
    entry("C:/ws", "add-a", "s1", 10), // heuristic（将重建为 explicit）
    entry("C:/ws", "add-b", "s1", 20), // heuristic（将被删除）
    entry("C:/ws", "add-x", "s1", 40, "explicit"), // 过期 explicit（将被删除）
    entry("C:/ws", "add-a", "s2", 50), // 其他会话（原样保留）
    entry("C:/other", "add-a", "s1", 60, "explicit") // 其他工作区（原样保留）
  ];
  const replaced = applyBinding(seed, { workspace: "C:/ws", sessionId: "s1", proposals: ["add-a"] }, 500);
  assert.equal(replaced.changed, true, "替换产生变更");
  const scope = replaced.entries.filter((item) => item.workspace === "C:/ws" && item.sessionId === "s1");
  assert.deepEqual(scope.map((item) => [item.proposal, item.origin]), [["add-a", "explicit"]], "范围条目恰为清单（origin 切换 = 变更）");
  assert.equal(scope[0].createdAt, 500, "heuristic 重建为 explicit：createdAt = now");
  assert.equal(scope[0].updatedAt, 500, "变更条目 updatedAt = now");
  const outside = replaced.entries.filter((item) => !(item.workspace === "C:/ws" && item.sessionId === "s1"));
  assert.deepEqual(
    outside.map((item) => [item.workspace, item.proposal, item.sessionId, item.origin]),
    [
      ["C:/ws", "add-a", "s2", "heuristic"],
      ["C:/other", "add-a", "s1", "explicit"]
    ],
    "范围外条目（其他会话 / 其他工作区）原样保留"
  );

  /* 幂等：同清单且集合无增删 → changed=false、条目原样（updatedAt 不动 → 宿主零写入零广播） */
  const idempotent = applyBinding(replaced.entries, { workspace: "C:/ws", sessionId: "s1", proposals: ["add-a"] }, 900);
  assert.equal(idempotent.changed, false, "同清单重绑幂等");
  assert.deepEqual(idempotent.entries, replaced.entries, "条目原样（updatedAt 不刷新）");

  /* 清单顺序变化但集合不变 → 仍幂等 */
  const reordered = applyBinding(seed, { workspace: "C:/ws", sessionId: "s1", proposals: ["add-a", "add-b"] }, 500);
  const reorderedAgain = applyBinding(reordered.entries, { workspace: "C:/ws", sessionId: "s1", proposals: ["add-b", "add-a"] }, 700);
  assert.equal(reorderedAgain.changed, false, "集合等价（顺序不同）→ 幂等");

  /* 新增提案：已存 explicit 条目 createdAt/updatedAt 原样，新条目取 now */
  const extended = applyBinding(replaced.entries, { workspace: "C:/ws", sessionId: "s1", proposals: ["add-a", "add-d"] }, 900);
  assert.equal(extended.changed, true, "新增提案 = 变更");
  const keptA = extended.entries.find((item) => item.workspace === "C:/ws" && item.sessionId === "s1" && item.proposal === "add-a");
  assert.equal(keptA.createdAt, 500, "已存 explicit 条目 createdAt 保留");
  assert.equal(keptA.updatedAt, 500, "未实际变更的已存条目 updatedAt 不刷新");
  const freshD = extended.entries.find((item) => item.workspace === "C:/ws" && item.sessionId === "s1" && item.proposal === "add-d");
  assert.equal(freshD.origin, "explicit");
  assert.equal(freshD.createdAt, 900, "补齐条目 createdAt = now");
  assert.equal(freshD.updatedAt, 900);

  /* 收缩清单：过期 explicit 条目删除（替换 = 撤销） */
  const shrunk = applyBinding(extended.entries, { workspace: "C:/ws", sessionId: "s1", proposals: ["add-a"] }, 1200);
  assert.equal(shrunk.changed, true);
  assert.deepEqual(
    shrunk.entries.filter((item) => item.workspace === "C:/ws" && item.sessionId === "s1").map((item) => item.proposal),
    ["add-a"],
    "过期 explicit 条目删除（绑定即完整声明）"
  );

  /* 空清单 → 清空该会话全部条目（端点面已禁止空清单，纯函数仍按集合语义处理） */
  const cleared = applyBinding(seed, { workspace: "C:/ws", sessionId: "s1", proposals: [] }, 1500);
  assert.equal(cleared.changed, true);
  assert.equal(cleared.entries.filter((item) => item.workspace === "C:/ws" && item.sessionId === "s1").length, 0, "空清单清空范围");

  /* 从零写入 */
  const fromScratch = applyBinding(undefined, { workspace: "C:/ws", sessionId: "s9", proposals: ["add-a", "add-b"] }, 42);
  assert.equal(fromScratch.changed, true);
  assert.deepEqual(
    fromScratch.entries.map((item) => [item.proposal, item.origin, item.createdAt]),
    [["add-a", "explicit", 42], ["add-b", "explicit", 42]],
    "从零写入按清单序"
  );
}

/* ── 压制查询（1.3）：仅 explicit 条目、按工作区隔离 ── */
{
  const bound = explicitBoundSessionIds([
    entry("C:/ws", "add-a", "s1", 1, "explicit"),
    entry("C:/ws", "add-b", "s1", 2, "explicit"),
    entry("C:/ws", "add-c", "s2", 3), // heuristic → 不压制
    entry("C:/other", "add-a", "s3", 4, "explicit"), // 其他工作区 → 不压制
    { workspace: "C:/ws", proposal: "add-d", sessionId: "s4", origin: "explicit" }, // 时间戳非法 → 丢弃
    null
  ], "C:/ws");
  assert.deepEqual([...bound], ["s1"], "仅该工作区 explicit 条目的会话（去重）");
  assert.equal(explicitBoundSessionIds(undefined, "C:/ws").size, 0, "无条目 → 空集");
  assert.equal(explicitBoundSessionIds([entry("C:/ws", "add-a", "s1", 1)], "C:/ws").size, 0, "heuristic 不压制");
}

console.log("associations-smoke: all assertions passed");
