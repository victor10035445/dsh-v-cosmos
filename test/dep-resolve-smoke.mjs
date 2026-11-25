/**
 * 依赖解析面冒烟（first-add-proposal-dependency-declaration 4.1 /
 * spec cosmos-proposal-dependency）：五组断言——
 *  1. 声明归一化容错（非法整体丢弃、空数组合法、不抛错）；
 *  2. 状态序达标谓词（归档两形态 / 后继闭包 / proto 不达标 / 状态缺失兜底 / 逐项求值）；
 *  3. 声明∪推导合并（基数序与序数词两族链 / 显式覆盖 / 同 rank 歧义放弃 / 混族歧义 /
 *     solo 排除 / 前缀边界 / 块隔离 / 台账缺失时声明照常）；
 *  4. 环检测与整体退化（双环 / 自环 / 合并图环 / 回调留痕与异常不外溢）；
 *  5. 输出确定性（Map 键序 / 环成员码点序）。
 * 运行：node test/dep-resolve-smoke.mjs
 */
import assert from "node:assert/strict";
import {
  DEPENDENCY_SOURCES,
  DEPENDENCY_STATES,
  STATE_RANK,
  evaluateDependencies,
  normalizeRequires,
  resolveDependencies,
  resolveWorkspaceDependencies
} from "../src/dep-resolve.mjs";

/** 台账行构造（requires 缺省 → 不落键）。 */
const ledger = (slug, embryoSessionId = null, requires = undefined) => {
  const row = { slug, embryoSessionId };
  if (requires !== undefined) row.requires = requires;
  return row;
};

/** 锚点构造（requires 缺省 → 不落键）。 */
const anchor = (name, requires = undefined) => {
  const row = { name, by: "cosmos-explore", at: 1000 };
  if (requires !== undefined) row.requires = requires;
  return row;
};

/** 依赖项枚举缩写（断言可读性）。 */
const dep = (slug, state = "executed", source = DEPENDENCY_SOURCES.derived) => ({ slug, state, source });

/* ── 1. 声明归一化容错（spec「依赖声明 schema 与容错归一化」） ── */
{
  assert.deepEqual(DEPENDENCY_STATES, ["created", "reviewed", "executed"], "目标状态枚举（proto 不在列）");
  assert.deepEqual(STATE_RANK, { created: 0, reviewed: 1, executed: 2 }, "状态序 created < reviewed < executed");
  assert.equal(normalizeRequires(undefined), null, "字段缺失 → 无声明（null）");
  assert.equal(normalizeRequires(null), null, "null → 无声明");
  assert.equal(normalizeRequires("x"), null, "非数组 → 无声明");
  assert.equal(normalizeRequires({ slug: "a", state: "executed" }), null, "非数组对象 → 无声明");
  assert.deepEqual(normalizeRequires([]), [], "空数组合法（= 显式「无前置」，覆盖推导）");
  assert.deepEqual(
    normalizeRequires([{ slug: "a", state: "executed" }, { slug: "b", state: "reviewed" }]),
    [{ slug: "a", state: "executed" }, { slug: "b", state: "reviewed" }],
    "合法声明 → 规范化副本（新对象，键序 slug/state）"
  );
  /* 非法条目 → **整体**丢弃（不部分保留）。 */
  const invalidDeclarations = [
    [{ slug: "a", state: "executed" }, { slug: "", state: "created" }], // 空 slug
    [{ slug: "a", state: "executed" }, { slug: 42, state: "created" }], // 非字符串 slug
    [{ slug: "a", state: "executed" }, { slug: " a ", state: "created" }], // 首尾空白（永不匹配目录名）
    [{ slug: "a", state: "executed" }, { slug: "b", state: "proto" }], // proto 不可作依赖目标
    [{ slug: "a", state: "executed" }, { slug: "b", state: "done" }], // 枚举外状态
    [{ slug: "a", state: "executed" }, { slug: "b" }], // 缺 state
    [{ slug: "a", state: "executed" }, null], // 非对象条目
    [{ slug: "a", state: "executed" }, "text"], // 非对象条目
    [{ slug: "a", state: "executed" }, [1, 2]], // 数组条目
    [{ slug: "a", state: "executed" }, { slug: "a", state: "reviewed" }] // 同 slug 重复
  ];
  for (const declaration of invalidDeclarations) {
    assert.equal(normalizeRequires(declaration), null, "非法声明整体丢弃（不部分保留）: " + JSON.stringify(declaration));
  }
  /* 容错纪律：任意输入不抛错。 */
  for (const weird of [Symbol("x"), 0, true, () => {}, new Map()]) {
    assert.doesNotThrow(() => normalizeRequires(weird), "任意来源不抛错");
    assert.equal(normalizeRequires(weird), null);
  }
}

/* ── 2. 状态序达标谓词（spec「状态序达标谓词」） ── */
{
  /* 归档超集：日期前缀 + `-<slug>` 后缀（主形态）。 */
  const archivedSuffix = evaluateDependencies({
    dependencies: [dep("a", "reviewed", DEPENDENCY_SOURCES.declared)],
    archiveNames: ["2026-01-02-a"],
    active: []
  });
  assert.equal(archivedSuffix.satisfied, true, "归档 `-<slug>` 后缀形态 → 达标（归档超集）");
  /* 归档恰名（无日期前缀）→ 达标，杜绝误阻塞。 */
  const archivedExact = evaluateDependencies({
    dependencies: [dep("b", "executed", DEPENDENCY_SOURCES.declared)],
    archiveNames: ["b"]
  });
  assert.equal(archivedExact.satisfied, true, "归档恰名形态 → 达标");
  /* 后缀撞名的极端误达标属少守卫安全方向（spec 已声明）。 */
  const suffixCollision = evaluateDependencies({ dependencies: [dep("add-x", "executed")], archiveNames: ["2026-01-two-add-x"] });
  assert.equal(suffixCollision.satisfied, true, "后缀撞名 → 达标（少守卫安全方向）");
  /* 非归档的近似名不达标。 */
  const similarName = evaluateDependencies({ dependencies: [dep("add-x", "created")], archiveNames: ["2026-01-02-add-xy"] });
  assert.equal(similarName.satisfied, false, "近似名不误判归档");

  /* 状态后继闭包：executed(2) ≥ reviewed(1)。 */
  const closure = evaluateDependencies({
    dependencies: [dep("a", "reviewed", DEPENDENCY_SOURCES.declared)],
    active: [{ slug: "a", state: "executed" }]
  });
  assert.equal(closure.satisfied, true, "executed ≥ reviewed（后继闭包，跳过 review 不阻塞）");
  const forwardOnly = evaluateDependencies({
    dependencies: [dep("a", "executed", DEPENDENCY_SOURCES.declared)],
    active: [{ slug: "a", state: "reviewed" }]
  });
  assert.equal(forwardOnly.satisfied, false, "reviewed < executed → 未达标");

  /* proto 不达标：仍未点燃（活跃清单缺席）或显式 proto。 */
  const protoAbsent = evaluateDependencies({ dependencies: [dep("a", "created")], active: [] });
  assert.equal(protoAbsent.satisfied, false, "未点燃（活跃清单缺席）→ 不达标（无论目标状态）");
  const protoExplicit = evaluateDependencies({ dependencies: [dep("a", "created")], active: [{ slug: "a", state: "proto" }] });
  assert.equal(protoExplicit.satisfied, false, "显式 proto → 不达标");
  /* 活跃清单以对象形态给状态亦可（观察快照两写法）。 */
  const mapActive = evaluateDependencies({ dependencies: [dep("a", "executed")], active: { a: "executed" } });
  assert.equal(mapActive.satisfied, true, "active 对象形态（slug → state）同口径");

  /* 状态文件缺失兜底：活跃提案缺 state / 状态非法 → created(0)。 */
  const missingState = evaluateDependencies({ dependencies: [dep("a", "created")], active: [{ slug: "a" }] });
  assert.equal(missingState.satisfied, true, "缺 state → created 兜底（created 目标达标）");
  const missingStateStricter = evaluateDependencies({ dependencies: [dep("a", "reviewed")], active: [{ id: "a" }] });
  assert.equal(missingStateStricter.satisfied, false, "缺 state 兜底 created 后仍 < reviewed");

  /* 逐项可辨 + 整体态（spec「达标求值逐项可辨」）。 */
  const mixed = evaluateDependencies({
    dependencies: [dep("a", "executed", DEPENDENCY_SOURCES.declared), dep("b", "reviewed")],
    active: [{ slug: "a", state: "executed" }, { slug: "b", state: "created" }]
  });
  assert.equal(mixed.satisfied, false, "存在未达标项 → 整体未达标");
  assert.deepEqual(
    mixed.items.map((item) => [item.slug, item.satisfied]),
    [["a", true], ["b", false]],
    "逐项达标态可辨（未达标项可透出）"
  );
  assert.deepEqual(mixed.unsatisfied.map((item) => item.slug), ["b"], "未达标清单可透出");
  assert.equal(mixed.items[0].source, DEPENDENCY_SOURCES.declared, "来源标记透传");
  /* 求值面容错：非法依赖项跳过、重复去重、非数组 → 空（空依赖恒达标）。 */
  const tolerant = evaluateDependencies({
    dependencies: [null, { slug: "", state: "executed" }, { slug: "a", state: "bad" }, { slug: "b", state: "created" }, { slug: "b", state: "executed" }],
    active: [{ slug: "b", state: "created" }]
  });
  assert.deepEqual(tolerant.items.map((item) => item.slug), ["b"], "非法项跳过 + 同 slug 去重");
  assert.equal(tolerant.items[0].state, "created", "去重保留首项");
  assert.equal(evaluateDependencies({}).satisfied, true, "空依赖集 → 整体达标（无守卫）");
  assert.equal(evaluateDependencies(null).satisfied, true, "缺失输入不抛错 → 空依赖达标");
}

/* ── 3. 声明∪推导合并（spec「声明与推导合并解析」） ── */
{
  /* 基数序族链：one → two → three（后序依赖紧邻前序 executed）。 */
  const cardinalLineages = [
    ledger("one-add-x", "S1"),
    ledger("two-add-y", "S1"),
    ledger("three-add-z", "S1")
  ];
  const chainTwo = resolveDependencies({ slug: "two-add-y", lineages: cardinalLineages });
  assert.deepEqual(chainTwo.dependencies, [dep("one-add-x")], "two-add-y 推导依赖 one-add-x（executed, derived）");
  assert.equal(chainTwo.degraded, false);
  const chainThree = resolveDependencies({ slug: "three-add-z", lineages: cardinalLineages });
  assert.deepEqual(chainThree.dependencies, [dep("two-add-y")], "three-add-z 推导依赖紧邻前序 two-add-y");
  const chainHead = resolveDependencies({ slug: "one-add-x", lineages: cardinalLineages });
  assert.deepEqual(chainHead.dependencies, [], "链首无推导依赖");
  const workspaceChain = resolveWorkspaceDependencies({ lineages: cardinalLineages });
  assert.deepEqual(workspaceChain.dependencies.get("one-add-x"), [], "全量解析：链首空依赖");
  assert.deepEqual(workspaceChain.dependencies.get("three-add-z"), [dep("two-add-y")], "全量解析：后序依赖");

  /* 英文序数词族链（两族词表并存）。 */
  const ordinalLineages = [ledger("first-add-p", "S2"), ledger("second-add-q", "S2")];
  assert.deepEqual(
    resolveDependencies({ slug: "second-add-q", lineages: ordinalLineages }).dependencies,
    [dep("first-add-p")],
    "second-add-q 推导依赖 first-add-p（序数词族）"
  );

  /* 显式声明覆盖推导（不叠加）。 */
  const override = resolveDependencies({
    slug: "two-add-y",
    lineages: [
      ledger("one-add-x", "S1"),
      ledger("two-add-y", "S1", [{ slug: "one-add-x", state: "reviewed" }])
    ]
  });
  assert.deepEqual(
    override.dependencies,
    [{ slug: "one-add-x", state: "reviewed", source: DEPENDENCY_SOURCES.declared }],
    "显式声明覆盖推导（沿用声明状态，不叠加 derived）"
  );
  /* 显式空声明 = 显式「无前置」，同样覆盖推导。 */
  const emptyOverride = resolveDependencies({
    slug: "two-add-y",
    lineages: [ledger("one-add-x", "S1"), ledger("two-add-y", "S1", [])]
  });
  assert.deepEqual(emptyOverride.dependencies, [], "显式空声明覆盖推导（无前置）");

  /* 同 rank 歧义 → 整块放弃推导（显式声明不受影响）。 */
  const ambiguous = [
    ledger("one-add-x", "S1"),
    ledger("one-add-w", "S1"),
    ledger("two-add-y", "S1"),
    ledger("three-add-z", "S1")
  ];
  for (const slug of ["one-add-x", "one-add-w", "two-add-y", "three-add-z"]) {
    assert.deepEqual(resolveDependencies({ slug, lineages: ambiguous }).dependencies, [], "同 rank 歧义 → 块内无 derived 依赖: " + slug);
  }
  const ambiguousDeclared = resolveDependencies({
    slug: "three-add-z",
    lineages: [...ambiguous.filter((row) => row.slug !== "three-add-z"), ledger("three-add-z", "S1", [{ slug: "one-add-x", state: "executed" }])]
  });
  assert.deepEqual(
    ambiguousDeclared.dependencies,
    [{ slug: "one-add-x", state: "executed", source: DEPENDENCY_SOURCES.declared }],
    "歧义块内显式声明不受影响"
  );

  /* 两族混用同 rank → 歧义放弃。 */
  const mixedFamily = [ledger("one-add-x", "S1"), ledger("first-add-y", "S1"), ledger("two-add-z", "S1")];
  assert.deepEqual(resolveDependencies({ slug: "two-add-z", lineages: mixedFamily }).dependencies, [], "两族混用同 rank → 块内推导整体放弃");

  /* solo 行（embryoSessionId 为 null / 缺失）不参与推导。 */
  const solo = [ledger("one-add-x", null), ledger("two-add-y"), ledger("three-add-z", "")];
  for (const slug of ["two-add-y", "three-add-z"]) {
    assert.deepEqual(resolveDependencies({ slug, lineages: solo }).dependencies, [], "solo 行不参与推导: " + slug);
  }

  /* 单序数 / 表外前缀 → 无推导；「序数词 + `-`」kebab 边界排除同前缀串。 */
  assert.deepEqual(
    resolveDependencies({ slug: "one-add-y", lineages: [ledger("onedrive-x", "S1"), ledger("one-add-y", "S1")] }).dependencies,
    [],
    "仅单个序数 rank → 无推导"
  );
  const boundary = [ledger("onedrive-x", "S1"), ledger("one-add-y", "S1"), ledger("two-add-z", "S1")];
  assert.deepEqual(resolveDependencies({ slug: "two-add-z", lineages: boundary }).dependencies, [dep("one-add-y")], "同前缀串不参与链（kebab 边界）");
  assert.deepEqual(resolveDependencies({ slug: "onedrive-x", lineages: boundary }).dependencies, [], "表外前缀无推导");

  /* 块隔离：不同 embryoSessionId 各自成链，同 rank 跨块不构成歧义。 */
  const twoBlocks = [
    ledger("one-add-x", "S1"),
    ledger("two-add-y", "S1"),
    ledger("one-add-p", "S2"),
    ledger("two-add-q", "S2")
  ];
  assert.deepEqual(resolveDependencies({ slug: "two-add-y", lineages: twoBlocks }).dependencies, [dep("one-add-x")], "块 S1 链推导");
  assert.deepEqual(resolveDependencies({ slug: "two-add-q", lineages: twoBlocks }).dependencies, [dep("one-add-p")], "块 S2 链推导（跨块同 rank 不歧义）");
  assert.deepEqual(
    resolveDependencies({ slug: "two-add-y", lineages: [ledger("one-add-x", "S1"), ledger("two-add-y", "S2")] }).dependencies,
    [],
    "不同块各单 rank → 无推导（块隔离）"
  );

  /* 中间节点显式声明不影响其后续节点的链邻接。 */
  const middleOverride = [
    ledger("one-add-x", "S1"),
    ledger("two-add-y", "S1", [{ slug: "one-add-x", state: "reviewed" }]),
    ledger("three-add-z", "S1")
  ];
  assert.deepEqual(resolveDependencies({ slug: "three-add-z", lineages: middleOverride }).dependencies, [dep("two-add-y")], "显式覆盖不打断链邻接");

  /* 台账缺失 / 损坏（空台账兜底）→ 显式声明照常、推导无域（spec「台账缺失时显式声明照常」）。 */
  const noLedger = resolveDependencies({
    slug: "two-add-y",
    lineages: [],
    anchors: [anchor("two-add-y", [{ slug: "one-add-x", state: "executed" }])]
  });
  assert.deepEqual(
    noLedger.dependencies,
    [{ slug: "one-add-x", state: "executed", source: DEPENDENCY_SOURCES.declared }],
    "台账缺失 → 显式声明照常解析（推导域为空）"
  );
  assert.equal(noLedger.degraded, false);
  /* 非法 requires（锚点 / 台账行）→ 按无声明，推导兜底照常。 */
  const invalidThenDerived = resolveDependencies({
    slug: "two-add-y",
    lineages: [ledger("one-add-x", "S1"), ledger("two-add-y", "S1", "not-an-array")],
    anchors: [anchor("two-add-y", [{ slug: "", state: "created" }])]
  });
  assert.deepEqual(invalidThenDerived.dependencies, [dep("one-add-x")], "非法 requires（两承载）→ 无声明，推导兜底适用");
  /* 目标完全不在册（无锚点 / 无台账 / 不在活跃清单）→ 空依赖（无守卫，安全方向）。 */
  assert.deepEqual(resolveDependencies({ slug: "ghost-proposal", lineages: [] }).dependencies, [], "目标不在任何承载 → 空依赖");
  assert.deepEqual(resolveDependencies({ slug: "", lineages: [] }).dependencies, [], "空 slug → 空依赖（不抛错）");
}

/* ── 4. 环检测与整体退化（spec「环检测与安全退化」） ── */
{
  const cycleLedger = [
    ledger("a", null, [{ slug: "b", state: "executed" }]),
    ledger("b", null, [{ slug: "a", state: "executed" }]),
    ledger("c", null, [{ slug: "a", state: "executed" }])
  ];
  const degraded = resolveWorkspaceDependencies({ lineages: cycleLedger, onDegraded: () => {} });
  assert.equal(degraded.degraded, true, "检出环 → 整体退化标记");
  assert.deepEqual(degraded.members, ["a", "b"], "环成员可观测（码点序）");
  assert.equal(degraded.cycles.length, 1);
  assert.deepEqual(degraded.cycles[0], ["a", "b", "a"], "环路径首尾同节点（日志可辨）");
  for (const slug of ["a", "b", "c"]) {
    assert.deepEqual(degraded.dependencies.get(slug), [], "整体退化为无依赖（含无关成员 c）: " + slug);
  }
  const single = resolveDependencies({ slug: "a", lineages: cycleLedger, onDegraded: () => {} });
  assert.deepEqual(single.dependencies, [], "单提案解析随工作区整体退化");
  assert.equal(single.degraded, true);
  assert.deepEqual(single.cycles, [["a", "b", "a"]]);

  /* 自环同样计入环。 */
  const selfCycle = resolveWorkspaceDependencies({ lineages: [ledger("self", null, [{ slug: "self", state: "created" }])], onDegraded: () => {} });
  assert.equal(selfCycle.degraded, true);
  assert.deepEqual(selfCycle.cycles, [["self", "self"]], "自身依赖 → 成环");

  /* 合并图环：显式声明反向 + 推导向前 → 成环整体退化。 */
  const merged = resolveWorkspaceDependencies({
    lineages: [
      ledger("one-add-x", "S1", [{ slug: "two-add-y", state: "created" }]),
      ledger("two-add-y", "S1")
    ],
    onDegraded: () => {}
  });
  assert.equal(merged.degraded, true, "显式 ∪ 推导合并图成环 → 退化");
  assert.deepEqual(merged.members, ["one-add-x", "two-add-y"]);

  /* 日志留痕：注入回调收到环成员；回调抛错不外溢（解析面永远不抛错）。 */
  let logged = null;
  resolveWorkspaceDependencies({ lineages: cycleLedger, onDegraded: (info) => { logged = info; } });
  assert.deepEqual(logged?.members, ["a", "b"], "onDegraded 收到环成员（宿主据此写服务端日志）");
  assert.deepEqual(logged?.cycles, [["a", "b", "a"]], "onDegraded 收到环路径");
  assert.doesNotThrow(
    () => resolveWorkspaceDependencies({ lineages: cycleLedger, onDegraded: () => { throw new Error("logger boom"); } }),
    "日志回调异常不外溢"
  );
  /* 缺省回落：未注入回调时 console.warn 留痕（spec「退化 SHALL 留服务端日志（含环成员）」）。 */
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => { warnings.push(args.map((arg) => String(arg)).join(" ")); };
  try {
    resolveWorkspaceDependencies({ lineages: cycleLedger });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 1, "成环缺省回落 console.warn（服务端日志可观测）");
  assert.equal(warnings[0].includes("a, b"), true, "日志含环成员: " + warnings[0]);
  /* 无环 → 不触发回调。 */
  let unexpected = 0;
  resolveWorkspaceDependencies({ lineages: [ledger("a", null, [{ slug: "b", state: "executed" }])], onDegraded: () => { unexpected += 1; } });
  assert.equal(unexpected, 0, "无环不触发退化回调");
}

/* ── 5. 输出确定性（同输入恒同结果；Map 键序 / 成员序稳定） ── */
{
  const input = {
    lineages: [ledger("two-add-b", "S1"), ledger("one-add-a", "S1"), ledger("three-add-c", "S1"), ledger("x", null, [{ slug: "y", state: "executed" }])],
    anchors: [anchor("proto-z", [{ slug: "x", state: "reviewed" }])]
  };
  const first = resolveWorkspaceDependencies(input);
  const second = resolveWorkspaceDependencies(input);
  assert.deepEqual([...first.dependencies.keys()], [...second.dependencies.keys()], "Map 键序确定（码点序）");
  assert.deepEqual([...first.dependencies.keys()], ["one-add-a", "proto-z", "three-add-c", "two-add-b", "x"], "节点集合 = 台账 ∪ 锚点（码点序）");
  assert.deepEqual(first.dependencies.get("proto-z"), [{ slug: "x", state: "reviewed", source: DEPENDENCY_SOURCES.declared }], "锚点显式声明生效");
  assert.deepEqual(JSON.stringify([...first.dependencies]), JSON.stringify([...second.dependencies]), "同输入恒同输出");
  /* 解析面零写入：函数返回后再解析同输入仍一致（无隐藏状态）。 */
  assert.deepEqual(resolveDependencies({ slug: "three-add-c", lineages: input.lineages }).dependencies, [dep("two-add-b")]);
}

console.log("dep-resolve-smoke: all assertions passed");
