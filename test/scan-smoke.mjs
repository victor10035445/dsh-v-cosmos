/**
 * scan.mjs 冒烟（add-cosmos-entry 2.1–2.3 + 2.7 / add-celestial-states 2.4）：
 * 清单口径 / 勾选统计 / 归档计数 / 骨架装配 / 连线派生 / slug 匹配 / birthtime 窗口 /
 * 生命周期 state 三枚举与非法兜底 / pending 目录枚举 / pending 同名目录剔除。
 * 运行：node test/scan-smoke.mjs（任何断言失败 → 非零退出）。
 */
import assert from "node:assert/strict";
import {
  collectProposalNames,
  archiveCountOf,
  countCheckboxes,
  lifecycleOf,
  scanProposal,
  scanWorkspace,
  buildSkeleton,
  deriveLinks,
  matchProposalSlugs,
  assignmentProposalSlugs,
  birthtimeWindowUnique,
  collectPendingNames,
  pendingItemsOf,
  joinPendingDir
} from "../src/scan.mjs";

const dirent = (name, dir = true) => ({ name, isDirectory: () => dir });

/* ── collectProposalNames：排除 archive 与隐藏目录，字典序，排除散文件 ── */
assert.deepEqual(
  collectProposalNames([dirent("b"), dirent("a"), dirent("archive"), dirent(".hidden"), dirent("file.md", false)]),
  ["a", "b"],
  "collectProposalNames 口径"
);
assert.deepEqual(collectProposalNames(null), [], "非数组 → 空");
assert.deepEqual(collectProposalNames([]), [], "空目录 → 空");

/* ── archiveCountOf：一级子目录计数（散文件/隐藏目录不计） ── */
assert.equal(archiveCountOf([dirent("2026-09-01-a"), dirent("2026-09-02-b"), dirent(".tmp"), dirent("notes.txt", false)]), 2, "归档计数");
assert.equal(archiveCountOf(null), 0, "archive 缺失 → 0");

/* ── countCheckboxes：任意缩进同口径 + 容错 ── */
/* 宽容口径：`]` 后不要求空格（`- [x]e` 同样计入）——tasks.md 演进容错（R3）。 */
assert.deepEqual(
  countCheckboxes(["# T", "- [x] a", "  - [ ] nested", "\t* [X] c", "+ [ ] d", "not a checkbox", "- [x]e"].join("\n")),
  { done: 3, total: 5, parseable: true },
  "任意缩进 checkbox 同口径计入 done/total"
);
assert.deepEqual(countCheckboxes("no checkboxes here"), { done: 0, total: 0, parseable: true }, "无 checkbox → 可解析 0/0");
assert.deepEqual(countCheckboxes(null), { done: 0, total: 0, parseable: false }, "非文本 → 容错 0/0");

/* ── lifecycleOf：state 三枚举 + 非法/缺失兜底 created（add-celestial-states 2.4） ── */
assert.equal(lifecycleOf(JSON.stringify({ version: 1, state: "created", setBy: "new-change", at: 1 })), "created", "state=created");
assert.equal(lifecycleOf(JSON.stringify({ version: 1, state: "reviewed", setBy: "review", at: 2 })), "reviewed", "state=reviewed");
assert.equal(lifecycleOf(JSON.stringify({ version: 1, state: "executed", setBy: "apply", at: 3 })), "executed", "state=executed");
assert.equal(lifecycleOf(null), "created", "缺失 → created 兜底");
assert.equal(lifecycleOf(undefined), "created", "undefined → created 兜底");
assert.equal(lifecycleOf(""), "created", "空文本 → created 兜底");
assert.equal(lifecycleOf("{not json"), "created", "非法 JSON → created 兜底");
assert.equal(lifecycleOf(JSON.stringify({ version: 2, state: "reviewed" })), "created", "超版本 → created 兜底");
assert.equal(lifecycleOf(JSON.stringify({ version: 1, state: "bogus" })), "created", "枚举外 → created 兜底");
assert.equal(lifecycleOf(JSON.stringify({ version: 1 })), "created", "缺 state → created 兜底");
assert.equal(lifecycleOf("[1,2]"), "created", "数组载荷 → created 兜底");
assert.equal(lifecycleOf('"reviewed"'), "created", "字符串载荷 → created 兜底");

/* ── scanProposal：容错（读 tasks 抛错 → 0/0；birthMs/state 取不到 → null/created 兜底） ── */
const proposal = scanProposal("add-x", "/ws/openspec/changes/add-x", () => "- [x] a\n- [ ] b\n  - [ ] c", () => 12345, () => JSON.stringify({ version: 1, state: "reviewed", setBy: "cosmos-review", at: 777 }));
assert.deepEqual(proposal, { id: "add-x", name: "add-x", lifecycle: "reviewed", setBy: "cosmos-review", at: 777, tasks: [1, 3], birthMs: 12345 }, "scanProposal 正常路径（lifecycle+setBy+at）");
const broken = scanProposal("add-y", "/x", () => { throw new Error("EACCES"); }, () => { throw new Error("EPERM"); }, () => { throw new Error("ENOENT"); });
assert.deepEqual(broken, { id: "add-y", name: "add-y", lifecycle: "created", setBy: null, at: null, tasks: [0, 0], birthMs: null }, "scanProposal 容错路径（全回调缺失 → created 兜底）");
const legacy = scanProposal("add-z", "/x", () => "- [x] a", () => null, () => "{broken");
assert.equal(legacy.lifecycle, "created", "非法 state.json → created 兜底");
assert.equal(legacy.setBy, null, "非法 state.json → setBy null");
assert.equal(legacy.at, null, "非法 state.json → at null");

/* ── collectPendingNames：*.json 一级文件枚举，子目录/散文件不计（2.4） ── */
assert.deepEqual(
  collectPendingNames([dirent("explore-ui.json", false), dirent("refactor-db.json", false), dirent("notes.txt", false), dirent("sub.json", true)]),
  ["explore-ui", "refactor-db"],
  "pending slug 枚举（字典序、剔子目录与散文件）"
);
assert.deepEqual(collectPendingNames(null), [], "pending 目录缺失 → 空");
assert.deepEqual(collectPendingNames([]), [], "pending 目录空 → 空");

/* ── pendingItemsOf：非法条目跳过 + 目录优先剔除（2.4）＋ sessionId 容错
      （add-cosmos-embryo-cards 2.1：字符串非空才采纳，缺失/非法 → null） ── */
const rawPending = [
  { name: "explore-ui", by: "cosmos-explore", at: 100, sessionId: "sess-1" },
  { name: "add-a", by: "cosmos-explore", at: 200 }, // 同名真实目录 → 剔除
  { name: "", at: 300 }, // 非法：空名
  null, // 非法：非对象
  { by: "x" }, // 非法：缺 name
  { name: "no-at" }, // 合法：at 缺省 → null；sessionId 缺省 → null
  { name: "bad-session", at: 400, sessionId: 42 }, // 非法 sessionId（非字符串）→ null
  { name: "empty-session", at: 500, sessionId: "" } // 空串 → null
];
assert.deepEqual(
  pendingItemsOf(rawPending, new Set(["add-a", "add-b"])),
  [
    { name: "bad-session", by: null, at: 400, sessionId: null },
    { name: "empty-session", by: null, at: 500, sessionId: null },
    { name: "explore-ui", by: "cosmos-explore", at: 100, sessionId: "sess-1" },
    { name: "no-at", by: null, at: null, sessionId: null }
  ],
  "pending 归一：同名目录剔除 + 非法跳过 + 缺省补 null + sessionId 读取方容错"
);
assert.deepEqual(pendingItemsOf(null, []), [], "pending 条目缺失 → 空");

/* ── scanWorkspace：目录缺失 → 空骨架不抛错；state/pending 接线 ── */
const readers = {
  readChangesDir: (path) => [dirent("add-a"), dirent("add-b"), dirent("archive"), dirent(".hid")],
  readArchiveDir: () => [dirent("2026-01-a"), dirent("2026-01-b")],
  readTasks: (dir) => (dir.endsWith("add-a") ? "- [x] one" : null),
  readBirthMs: (dir) => (dir.endsWith("add-a") ? 1000 : null),
  readState: (dir) => (dir.endsWith("add-a") ? JSON.stringify({ version: 1, state: "executed", setBy: "cosmos-apply", at: 42 }) : null),
  readPendingDir: () => [
    { name: "explore-ui", by: "cosmos-explore", at: 300, sessionId: "sess-ws" },
    { name: "add-a", by: "cosmos-explore", at: 400 } // 同名真实目录 → 此层剔除
  ]
};
const ws = scanWorkspace({ id: "ws1", name: "", title: "WS One", path: "C:/ws" }, readers);
assert.equal(ws.id, "ws1");
assert.equal(ws.name, "WS One", "name 回退链 title");
assert.equal(ws.stars.length, 2);
assert.equal(ws.stars[0].lifecycle, "executed", "state.json → lifecycle");
assert.equal(ws.stars[0].setBy, "cosmos-apply", "setBy 透传");
assert.equal(ws.stars[0].at, 42, "at 透传");
assert.equal(ws.stars[1].lifecycle, "created", "readState 缺失 → created 兜底");
assert.equal(ws.stars[1].setBy, null, "缺失兜底 → setBy null");
assert.equal(ws.archives, 2);
assert.deepEqual(ws.pending, [{ name: "explore-ui", by: "cosmos-explore", at: 300, sessionId: "sess-ws" }], "pending 挂入骨架（同名目录剔除 + sessionId 透传）");
const missing = scanWorkspace({ id: "ws2", path: "C:/none" }, { readChangesDir: () => null, readArchiveDir: () => null, readPendingDir: () => null });
assert.deepEqual(missing.stars, [], "目录缺失 → 空骨架");
assert.equal(missing.archives, 0);
assert.deepEqual(missing.pending, [], "pending 目录缺失 → 空（不抛错）");
const noReadersPending = scanWorkspace({ id: "ws3", path: "C:/x" }, { readChangesDir: () => [] });
assert.deepEqual(noReadersPending.pending, [], "readPendingDir 未注入 → pending 空数组");

/* ── joinPendingDir：路径拼装单点 ── */
assert.equal(joinPendingDir("C:/ws/"), "C:/ws/openspec/pending-changes", "尾部斜杠归一");
assert.equal(joinPendingDir("C:/ws"), "C:/ws/openspec/pending-changes");

/* ── buildSkeleton + deriveLinks：共享会话派生连线（骨架为准）+ pending 透传 ── */
const associations = [
  { workspace: "C:/ws", proposal: "add-a", sessionId: "s1", origin: "heuristic" },
  { workspace: "C:/ws", proposal: "add-b", sessionId: "s1", origin: "heuristic" },
  { workspace: "C:/ws", proposal: "add-a", sessionId: "s2", origin: "heuristic" },
  { workspace: "C:/elsewhere", proposal: "add-a", sessionId: "s3", origin: "heuristic" }
];
const skeleton = buildSkeleton(
  [{ id: "ws1", title: "WS", path: "C:/ws" }],
  readers,
  { now: 42, associations }
);
assert.equal(skeleton.version, 1);
assert.equal(skeleton.generatedAt, 42);
const skeletonWs = skeleton.workspaces[0];
assert.equal(skeletonWs.associations.length, 3, "路径指纹过滤（他工作区条目不并入）");
assert.deepEqual(skeletonWs.links, [[0, 1]], "共享会话 s1 → add-a×add-b 连线");
assert.deepEqual(skeletonWs.pending, ws.pending, "pending 随骨架透传");
assert.deepEqual(
  buildSkeleton([], readers, { now: 0, associations: [] }).workspaces,
  [],
  "空 registry → 空骨架"
);

/* ── 点燃谱系骨架投影（add-cosmos-panel-birthline-sort 2.2 / spec「骨架投影」）：
      宿主回调 `lineagesOf` 在同一帧扫描结果上配对，骨架按工作区挂 lineages；回调缺席 /
      抛错 / 返非数组 → 空清单（读取失败按空谱系兜底，不中断扫描）。 ── */
{
  const ledger = [
    { slug: "add-x", embryoAt: 111, embryoSessionId: "s-x", ignitedMs: 222 },
    { slug: "add-y", embryoAt: 333, embryoSessionId: null, ignitedMs: 444 }
  ];
  const withLineages = buildSkeleton(
    [{ id: "ws1", title: "WS", path: "C:/ws" }, { id: "ws2", title: "Other", path: "C:/other" }],
    readers,
    {
      now: 42,
      associations: [],
      lineagesOf: (workspacePath) => (workspacePath === "C:/ws" ? ledger : [])
    }
  );
  assert.deepEqual(withLineages.workspaces[0].lineages, ledger, "台账 2 条合法行原样透传（字段不改写）");
  assert.deepEqual(withLineages.workspaces[1].lineages, [], "其他工作区 lineages 为空清单（路径命名空间不串扰）");
  /* 回调缺席 / 抛错 / 非数组 → 空清单（容错纪律） */
  assert.deepEqual(buildSkeleton([{ id: "ws1", path: "C:/ws" }], readers, { now: 1 }).workspaces[0].lineages, [], "回调缺席 → lineages 空数组");
  assert.deepEqual(
    buildSkeleton([{ id: "ws1", path: "C:/ws" }], readers, { now: 1, lineagesOf: () => { throw new Error("boom"); } }).workspaces[0].lineages,
    [],
    "回调抛错 → 按空谱系兜底（SHALL NOT 中断扫描）"
  );
  assert.deepEqual(
    buildSkeleton([{ id: "ws1", path: "C:/ws" }], readers, { now: 1, lineagesOf: () => "bad" }).workspaces[0].lineages,
    [],
    "回调返非数组 → 空清单"
  );
  /* 回调输入 = 同一帧扫描结果（pending 锚点 + 活跃提案 slug，点燃配对的数据源） */
  let observedInput = null;
  buildSkeleton([{ id: "ws1", path: "C:/ws" }], readers, {
    now: 1,
    lineagesOf: (workspacePath, scanned) => {
      observedInput = { workspacePath, pending: scanned.pending, activeSlugs: scanned.stars.map((star) => star.id) };
      return [];
    }
  });
  assert.equal(observedInput.workspacePath, "C:/ws", "回调收到工作区路径（台账命名空间键）");
  assert.deepEqual(observedInput.activeSlugs, ["add-a", "add-b"], "回调收到活跃提案 slug（点燃配对输入）");
  assert.deepEqual(observedInput.pending, [{ name: "explore-ui", by: "cosmos-explore", at: 300, sessionId: "sess-ws" }], "回调收到本帧 pending 锚点（sighting 登记输入）");
}

/* ── 骨架指纹涵盖 pending 条目整体序列化（add-cosmos-embryo-cards 2.1）：宿主
      `skeletonFingerprint` 以 `ws.pending` 整体入键 → 仅 sessionId 值增改即触发增量。 ── */
{
  const pendingSerializationOf = (sessionId) => JSON.stringify(
    buildSkeleton(
      [{ id: "ws1", title: "WS", path: "C:/ws" }],
      {
        ...readers,
        readPendingDir: () => [{ name: "explore-ui", by: "cosmos-explore", at: 300, sessionId }]
      },
      { now: 42, associations: [] }
    ).workspaces[0].pending
  );
  assert.notEqual(
    pendingSerializationOf("sess-1"),
    pendingSerializationOf("sess-2"),
    "sessionId 值增改 → pending 序列化变化（骨架指纹 → 增量重扫）"
  );
  assert.equal(
    pendingSerializationOf(undefined),
    pendingSerializationOf(null),
    "缺失/非字符串 → 同归 null（旧锚点零迁移，无幽灵增量）"
  );
}

/* ── matchProposalSlugs：词边界 slug 匹配 ── */
assert.deepEqual(matchProposalSlugs("plan for add-cosmos-entry and more", ["add-cosmos-entry", "add-other"]), ["add-cosmos-entry"], "slug 命中");
assert.deepEqual(matchProposalSlugs("prefix_add-cosmos-entry-suffix", ["add-cosmos-entry"]), [], "子串不误命中");
assert.deepEqual(matchProposalSlugs("", ["add-a"]), [], "空文本 → 空");
assert.deepEqual(matchProposalSlugs("text", []), [], "空清单 → 空");

/* ── assignmentProposalSlugs：@提案目录指派引用解析（restrict-association-heuristics 1.2） ── */
assert.deepEqual(
  assignmentProposalSlugs("按 @C:/ws/openspec/changes/add-cosmos-entry 实施"),
  ["add-cosmos-entry"],
  "正斜杠路径命中（连字符 slug 不被截断）"
);
assert.deepEqual(
  assignmentProposalSlugs("按 @C:\\ws\\openspec\\changes\\add-cosmos-entry 实施"),
  ["add-cosmos-entry"],
  "反斜杠路径：分隔符归一后命中"
);
assert.deepEqual(
  assignmentProposalSlugs("@C:/ws/openspec/changes/add-a 与 @D:/other/openspec/changes/add-b 都要"),
  ["add-a", "add-b"],
  "多命中按出现序返回"
);
assert.deepEqual(
  assignmentProposalSlugs("@C:/ws/openspec/changes/add-a 再提 @C:/ws/openspec/changes/add-a"),
  ["add-a"],
  "重复引用去重保序"
);
assert.deepEqual(
  assignmentProposalSlugs("聊聊 add-a 与 add-b 的命名（正文提及，无 @ 路径引用）"),
  [],
  "正文提及（无 @ 引用）不产生指派信号"
);
assert.deepEqual(
  assignmentProposalSlugs("@C:/ws/openspec/changes/add-a，然后 @C:/ws/openspec/changes/add-b。"),
  ["add-a", "add-b"],
  "尾随中英文标点不并入 slug"
);
assert.deepEqual(
  assignmentProposalSlugs("@C:/ws/openspec/changes/add-a/tasks.md"),
  ["add-a"],
  "提案目录内子路径引用仍取提案 slug"
);
assert.deepEqual(
  assignmentProposalSlugs("@C:/ws/openspec/changes/add-a#L12-L30"),
  ["add-a"],
  "行号锚点（#L12）不并入 slug"
);
assert.deepEqual(assignmentProposalSlugs("@C:/ws/openspec/changes/add-a-extra"), ["add-a-extra"], "slug 词边界：连字符整体保留");
assert.deepEqual(assignmentProposalSlugs("只写 add-a 不加 @ 引用"), [], "缺 @ 前缀不命中");
assert.deepEqual(assignmentProposalSlugs("@C:/ws/openspec/changes/"), [], "路径缺 slug → 不命中");
assert.deepEqual(assignmentProposalSlugs(""), [], "空文本 → 空");
assert.deepEqual(assignmentProposalSlugs(null), [], "非文本 → 空");

/* ── birthtimeWindowUnique：±30min 唯一活跃会话 ── */
const now = 1_000_000;
const WINDOW = 30 * 60 * 1000;
assert.equal(
  birthtimeWindowUnique({ birthMs: now, detectedMs: 0, sessions: [{ sessionId: "s1", lastActivityMs: now + 1000 }] }),
  "s1",
  "窗口内唯一会话命中"
);
assert.equal(
  birthtimeWindowUnique({ birthMs: now, detectedMs: 0, sessions: [{ sessionId: "s1", lastActivityMs: now + WINDOW * 2 }] }),
  null,
  "窗外会话不命中"
);
assert.equal(
  birthtimeWindowUnique({ birthMs: now, detectedMs: 0, sessions: [{ sessionId: "s1", lastActivityMs: now }, { sessionId: "s2", lastActivityMs: now }] }),
  null,
  "多会话 → null（唯一性不满足）"
);
assert.equal(
  birthtimeWindowUnique({ birthMs: null, detectedMs: now - 5000, sessions: [{ sessionId: "s9", lastActivityMs: now }] }),
  "s9",
  "birthMs 缺失回落检测时刻"
);

/* ── birthtimeWindowUnique：运行中会话候选排除（restrict-association-heuristics 3.3） ── */
assert.equal(
  birthtimeWindowUnique({
    birthMs: now,
    detectedMs: now,
    sessions: [{ sessionId: "s1", lastActivityMs: now }],
    runningSessionIds: new Set(["s1"])
  }),
  null,
  "窗口内唯一候选正在运行 → 不建立（忙碌会话不接生新目录）"
);
assert.equal(
  birthtimeWindowUnique({
    birthMs: now,
    detectedMs: now,
    sessions: [{ sessionId: "s1", lastActivityMs: now }, { sessionId: "s2", lastActivityMs: now }],
    runningSessionIds: ["s1"]
  }),
  "s2",
  "运行中候选剔除后仅剩一个空闲候选 → 照常建立"
);
assert.equal(
  birthtimeWindowUnique({
    birthMs: now,
    detectedMs: now,
    sessions: [{ sessionId: "s1", lastActivityMs: now }, { sessionId: "s2", lastActivityMs: now }],
    runningSessionIds: new Set(["s2"])
  }),
  "s1",
  "剔除运行中候选后唯一空闲候选 → 建立"
);
assert.equal(
  birthtimeWindowUnique({
    birthMs: now,
    detectedMs: now,
    sessions: [
      { sessionId: "s1", lastActivityMs: now },
      { sessionId: "s2", lastActivityMs: now },
      { sessionId: "s3", lastActivityMs: now }
    ],
    runningSessionIds: ["s3"]
  }),
  null,
  "剔除运行中候选后仍两个空闲候选 → 唯一性不满足（不建立）"
);
assert.equal(
  birthtimeWindowUnique({
    birthMs: now,
    detectedMs: now,
    sessions: [{ sessionId: "s1", lastActivityMs: now }],
    runningSessionIds: new Set()
  }),
  "s1",
  "无运行中会话（空集合）→ 旧口径不变"
);
assert.equal(
  birthtimeWindowUnique({ birthMs: now, detectedMs: now, sessions: [{ sessionId: "s1", lastActivityMs: now }] }),
  "s1",
  "runningSessionIds 缺失 → 不排除（容错退回旧口径）"
);

console.log("scan-smoke: all assertions passed");
