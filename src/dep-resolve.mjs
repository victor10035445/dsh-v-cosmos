/**
 * 跨提案依赖声明解析面纯逻辑单点（first-add-proposal-dependency-declaration
 * 1.1–1.3 / 2.1–2.3；spec cosmos-proposal-dependency）。
 *
 * 职责边界（design D6）：
 *  - 输入 = 单工作区观察快照（活跃提案生命周期 / 归档目录名 / 点燃谱系台账行 /
 *    待创建锚点），输出 = 生效依赖集（每项带 `declared | derived` 来源标记）；
 *  - **零 node 内建依赖、零 DOM、零网络、零 openspec CLI 调用、零文件写入**——
 *    本模块既不读盘也不写盘；archive 探测与 `.state.json` 读取由宿主以快照注入，
 *    冒烟测试可穷举容错分支；
 *  - 达标谓词（`cosmos-proposal-dependency`「状态序达标谓词」）在本模块**唯一定义**：
 *    `达标 = 已归档 ∨ (活跃 ∧ 状态序位 ≥ 目标序)`，归档探测接受「恰名」与
 *    `-<slug>` 后缀两种目录名形态。
 *
 * 安全方向（design D5 / spec「环检测与安全退化」）：任何解析失败形态的兜底恒为
 * **无依赖**（等价现状行为）——宁缺守卫、不误阻塞。环检测不抛错：合并图检出环时
 * 整体退化为无依赖，并通过注入回调 `onDegraded({ cycles, members })` 留痕
 * （宿主据此写服务端日志；本模块自身不做 I/O）。
 *
 * 观察快照形状（字段全部容错：非法条目跳过、缺失按空、SHALL NOT 抛错）：
 *
 * ```js
 * {
 *   slug?: string,                     // 目标提案（resolveDependencies 用）
 *   active?: Array<{slug|id|name, state|lifecycle}> | Record<string, state>,
 *   archiveNames?: string[],           // openspec/changes/archive 一级子目录名
 *   lineages?: Array<{slug, embryoSessionId?, requires?}>,  // 点燃谱系台账行
 *   anchors?: Array<{name|slug, requires?}>,               // pending-changes 锚点
 *   onDegraded?: (info: {cycles: string[][], members: string[]}) => void
 * }
 * ```
 *
 * 状态缺失兜底（spec「状态文件缺失兜底」）：观察快照里活跃提案缺 `state` 字段
 * （或值非枚举）按 `created(0)` 兜底——与骨架扫描 `lifecycleOf` 同口径；活跃且
 * 显式 `proto`（未点燃）判不达标；**完全不在活跃清单**（仍未点燃 / 名字不符）判不达标。
 */

/** 依赖目标状态枚举（复用 `.state.json` 状态机；`proto` 不入枚举，不可作依赖目标）。 */
export const DEPENDENCY_STATES = Object.freeze(["created", "reviewed", "executed"]);

/** 状态序位（`created(0) < reviewed(1) < executed(2)`；后继闭包判定基准）。 */
export const STATE_RANK = Object.freeze({ created: 0, reviewed: 1, executed: 2 });

/** 生效依赖来源标记（显式声明 / 谱系块前缀链推导）。 */
export const DEPENDENCY_SOURCES = Object.freeze({ declared: "declared", derived: "derived" });

/**
 * 两族有限序数词表（同 rank 空间；design D4）：
 *  - 基数序 `one`–`twenty`（`one-add-x` / `two-add-y` 族）；
 *  - 英文序数词 `first`–`twentieth`（`first-add-p` / `second-add-q` 族）。
 * 同 rank 命中多 slug（含两族混用）→ 该块推导整体放弃（歧义防护）。
 */
const ORDINAL_RANKS = new Map([
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
  ["eleven", 11],
  ["twelve", 12],
  ["thirteen", 13],
  ["fourteen", 14],
  ["fifteen", 15],
  ["sixteen", 16],
  ["seventeen", 17],
  ["eighteen", 18],
  ["nineteen", 19],
  ["twenty", 20],
  ["first", 1],
  ["second", 2],
  ["third", 3],
  ["fourth", 4],
  ["fifth", 5],
  ["sixth", 6],
  ["seventh", 7],
  ["eighth", 8],
  ["ninth", 9],
  ["tenth", 10],
  ["eleventh", 11],
  ["twelfth", 12],
  ["thirteenth", 13],
  ["fourteenth", 14],
  ["fifteenth", 15],
  ["sixteenth", 16],
  ["seventeenth", 17],
  ["eighteenth", 18],
  ["nineteenth", 19],
  ["twentieth", 20]
]);

/** 码点序比较（确定性字典序；不依赖运行环境 locale/ICU）。 */
function compareText(a, b) {
  const left = String(a ?? "");
  const right = String(b ?? "");
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** 依赖目标状态是否合法（枚举内；`proto` / 未知值一律非法）。 */
function isDependencyState(value) {
  return value === "created" || value === "reviewed" || value === "executed";
}

/** 活跃提案生命周期归一：枚举内原样、`proto` 原样（不达标特例）、其余 → created 兜底。 */
function normalizeActiveState(value) {
  if (value === "proto") return "proto"; // 未点燃：显式保留 → 谓词判不达标
  if (isDependencyState(value)) return value;
  return "created";
}

/** 非空字符串（slug 取值的唯一口径；不做 trim 改写，避免与目录名失配）。 */
function isSlugText(value) {
  return typeof value === "string" && value !== "";
}

/**
 * 依赖声明归一化（纯函数，spec「依赖声明 schema 与容错归一化」）：`requires`
 * 形状 `[{ slug, state }]` →
 *  - 非数组 / 数组含任一非法条目（条目非对象、`slug` 空值/非字符串/含首尾空白、
 *    `state` 枚举外）/ 同 `slug` 重复出现 → **整个声明按无声明处理**（返回 null，
 *    MUST NOT 部分保留——半份声明比没有更危险）；
 *  - 空数组合法（= 显式「无前置」声明，覆盖推导）；
 *  - SHALL NOT 抛错。
 * @param {unknown} raw 任意来源（锚点 / 台账行 / 调用方构造）
 * @returns {Array<{slug: string, state: "created"|"reviewed"|"executed"}>|null}
 *          合法声明的规范化副本（新对象；非法 → null）
 */
export function normalizeRequires(raw) {
  if (!Array.isArray(raw)) return null;
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const slug = item.slug;
    /* 首尾空白视同非法：带空白的 slug 永不匹配目录名，保留会形成永久误阻塞。 */
    if (!isSlugText(slug) || slug.trim() !== slug) return null;
    if (!isDependencyState(item.state)) return null;
    if (seen.has(slug)) return null;
    seen.add(slug);
    out.push({ slug, state: item.state });
  }
  return out;
}

/** 观察快照里单条依赖的 slug/state 提取（兼容 `slug` / `id` / `name` 三写法）。 */
function dependencyTargetOf(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const slug = typeof item.slug === "string" ? item.slug : typeof item.id === "string" ? item.id : typeof item.name === "string" ? item.name : "";
  return isSlugText(slug) ? slug : null;
}

/**
 * 观察快照归一（纯函数，私有）：活跃提案状态 / 归档目录名 / 台账行 / 锚点
 * 全部容错——非法条目跳过、缺失按空，SHALL NOT 抛错。
 * @param {unknown} input 观察快照
 * @returns {{states: Map<string, string>, archiveNames: string[],
 *            lineages: Array<{slug: string, embryoSessionId: string|null, requires: Array<object>|null}>,
 *            anchors: Array<{slug: string, requires: Array<object>|null}>}}
 */
function normalizeObservation(input) {
  const src = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const states = new Map();
  const active = src.active;
  if (Array.isArray(active)) {
    for (const item of active) {
      const slug = dependencyTargetOf(item);
      if (!slug) continue;
      states.set(slug, normalizeActiveState(item.state ?? item.lifecycle));
    }
  } else if (active && typeof active === "object") {
    for (const slug of Object.keys(active)) {
      if (!isSlugText(slug)) continue;
      states.set(slug, normalizeActiveState(active[slug]));
    }
  }
  const archiveNames = [];
  if (Array.isArray(src.archiveNames)) {
    for (const name of src.archiveNames) {
      if (typeof name === "string" && name) archiveNames.push(name);
    }
  }
  const lineages = [];
  for (const row of Array.isArray(src.lineages) ? src.lineages : []) {
    const slug = dependencyTargetOf(row);
    if (!slug) continue;
    const embryoSessionId = typeof row.embryoSessionId === "string" && row.embryoSessionId ? row.embryoSessionId : null;
    const requires = normalizeRequires(row.requires);
    lineages.push({ slug, embryoSessionId, requires });
  }
  const anchors = [];
  for (const row of Array.isArray(src.anchors) ? src.anchors : []) {
    const slug = dependencyTargetOf(row);
    if (!slug) continue;
    anchors.push({ slug, requires: normalizeRequires(row.requires) });
  }
  return { states, archiveNames, lineages, anchors };
}

/** 归档在案探测（恰名 / `-<slug>` 后缀两形态；宽松后缀撞名属少守卫安全方向）。 */
function isArchived(archiveNames, slug) {
  if (!slug) return false;
  for (const name of archiveNames) {
    if (name === slug || name.endsWith("-" + slug)) return true;
  }
  return false;
}

/**
 * 单项依赖达标谓词（纯函数；唯一判定点 = 本模块 + spec「状态序达标谓词」）：
 * `已归档 ∨ (活跃 ∧ 状态序位 ≥ 目标序)`。
 * @param {{states: Map<string, string>, archiveNames: string[]}} observation 归一后的观察快照
 * @param {{slug: string, state: string}} dependency 依赖项
 * @returns {boolean}
 */
function satisfiedOf(observation, dependency) {
  if (isArchived(observation.archiveNames, dependency.slug)) return true; // 归档必先执行 → 全序满足
  const state = observation.states.get(dependency.slug);
  if (!state) return false; // 仍未点燃（proto / 锚点仅在册）→ 不达标
  const current = STATE_RANK[state];
  if (typeof current !== "number") return false; // 显式 proto / 状态未知 → 不达标
  return current >= STATE_RANK[dependency.state];
}

/**
 * 序数前缀 rank（「序数词 + `-`」kebab 边界）：`one-add-x` → 1、`first-add-p` → 1；
 * 非序数前缀（`onedrive-x` / `add-one-x`）→ null。
 * @param {string} slug
 * @returns {number|null}
 */
function prefixRankOf(slug) {
  const dash = slug.indexOf("-");
  if (dash <= 0) return null;
  const rank = ORDINAL_RANKS.get(slug.slice(0, dash));
  return typeof rank === "number" ? rank : null;
}

/**
 * 单谱系块推导（纯函数，design D4）：同 `embryoSessionId` 块内「序数词 + `-`」命中
 * ≥2 个不同 rank 的 slug → 按 rank 升序构成线性链（后序依赖紧邻前序的 `executed`）；
 * 同 rank 命中多 slug（含两族混用）→ 整块放弃；命中 <2 个 rank → 无推导。
 * @param {Array<{slug: string}>} rows 块内台账行（按 slug 去重后）
 * @returns {Map<string, Array<{slug: string, state: "executed"}>>} slug → 推导依赖
 */
function deriveBlock(rows) {
  const hits = [];
  const byRank = new Map();
  for (const row of rows) {
    const rank = prefixRankOf(row.slug);
    if (rank === null) continue;
    hits.push({ slug: row.slug, rank });
    if (!byRank.has(rank)) byRank.set(rank, []);
    byRank.get(rank).push(row.slug);
  }
  for (const slugs of byRank.values()) {
    if (slugs.length > 1) return new Map(); // 同 rank 撞名（含两族混用）→ 该块整体放弃
  }
  if (byRank.size < 2) return new Map(); // 单序数 / 全表外前缀 → 无推导
  hits.sort((a, b) => a.rank - b.rank || compareText(a.slug, b.slug));
  const derived = new Map();
  for (let i = 1; i < hits.length; i += 1) {
    derived.set(hits[i].slug, [{ slug: hits[i - 1].slug, state: "executed" }]);
  }
  return derived;
}

/**
 * 全工作区推导兜底（纯函数）：按谱系块分组（`embryoSessionId` 为 null 的 solo 行
 * MUST NOT 参与），逐块调用 `deriveBlock`；slug 在台账内唯一，跨块不叠加。
 * @param {Array<{slug: string, embryoSessionId: string|null}>} lineages
 * @returns {Map<string, Array<{slug: string, state: "executed"}>>}
 */
function deriveDependencies(lineages) {
  const blocks = new Map();
  for (const row of lineages) {
    if (!row.embryoSessionId) continue; // solo 行（手工创建 / 旧锚点）不参与推导
    if (!blocks.has(row.embryoSessionId)) blocks.set(row.embryoSessionId, new Map());
    blocks.get(row.embryoSessionId).set(row.slug, row);
  }
  const derived = new Map();
  for (const block of blocks.values()) {
    for (const [slug, deps] of deriveBlock([...block.values()])) derived.set(slug, deps);
  }
  return derived;
}

/**
 * 依赖图环检测（纯函数，design D5）：迭代 DFS 三色标记，返回环成员路径清单
 * （首尾同节点，便于日志辨认）；自身依赖也计入环。不抛错。
 * @param {Map<string, Array<{slug: string}>>} dependencies 合并后的依赖图
 * @returns {string[][]} 环清单（每个环 = 成员路径，首节点在末尾重复一次）
 */
function findCycles(dependencies) {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map();
  const cycles = [];
  for (const start of dependencies.keys()) {
    if ((color.get(start) ?? WHITE) !== WHITE) continue;
    color.set(start, GRAY);
    const path = [start];
    const stack = [{ slug: start, index: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const deps = dependencies.get(frame.slug) ?? [];
      if (frame.index >= deps.length) {
        color.set(frame.slug, BLACK);
        stack.pop();
        path.pop();
        continue;
      }
      const next = deps[frame.index].slug;
      frame.index += 1;
      if (!dependencies.has(next)) continue; // 图外节点无出边，不可能成环
      const state = color.get(next) ?? WHITE;
      if (state === GRAY) {
        const at = path.indexOf(next);
        if (at >= 0) cycles.push([...path.slice(at), next]);
      } else if (state === WHITE) {
        color.set(next, GRAY);
        path.push(next);
        stack.push({ slug: next, index: 0 });
      }
    }
  }
  return cycles;
}

/** 环清单 → 去重成员（码点序；日志可观测用）。 */
function cycleMembersOf(cycles) {
  const members = new Set();
  for (const cycle of cycles) {
    for (const slug of cycle) members.add(slug);
  }
  return [...members].sort(compareText);
}

/** 节点集合（台账 slug ∪ 锚点 slug ∪ 活跃提案 slug；码点序 → 输出确定性）。 */
function nodeSetOf(observation) {
  const nodes = new Set();
  for (const row of observation.lineages) nodes.add(row.slug);
  for (const row of observation.anchors) nodes.add(row.slug);
  for (const slug of observation.states.keys()) nodes.add(slug);
  return [...nodes].sort(compareText);
}

/** 显式声明回查表（台账行优先于锚点——点燃承接的快照是权威值；同源重复取最后）。 */
function declaredMapOf(observation) {
  const declared = new Map();
  for (const row of observation.anchors) {
    if (row.requires !== null) declared.set(row.slug, row.requires);
  }
  for (const row of observation.lineages) {
    if (row.requires !== null) declared.set(row.slug, row.requires);
  }
  return declared;
}

/**
 * 工作区全量解析入口（纯函数，spec「声明与推导合并解析」/「环检测与安全退化」）：
 * 逐 slug 求出生效依赖 = 显式声明覆盖推导（显式存在即不叠加推导结果），再对合并
 * 依赖图做环检测。检出环 → 该工作区本轮**整体**退化为无依赖（全部节点空依赖），
 * 不部分断环、不抛错，`onDegraded` 回调留痕。
 * @param {object} input 观察快照（见文件头；`onDegraded` 可选）
 * @returns {{dependencies: Map<string, Array<{slug: string, state: string, source: string}>>,
 *            degraded: boolean, cycles: string[][], members: string[]}}
 */
export function resolveWorkspaceDependencies(input) {
  const observation = normalizeObservation(input);
  const declared = declaredMapOf(observation);
  const derived = deriveDependencies(observation.lineages);
  const nodes = nodeSetOf(observation);
  const dependencies = new Map();
  for (const slug of nodes) {
    const declaredRequires = declared.get(slug);
    if (declaredRequires !== undefined) {
      dependencies.set(
        slug,
        declaredRequires.map((item) => ({ slug: item.slug, state: item.state, source: DEPENDENCY_SOURCES.declared }))
      );
      continue;
    }
    const derivedRequires = derived.get(slug) ?? [];
    dependencies.set(
      slug,
      derivedRequires.map((item) => ({ slug: item.slug, state: item.state, source: DEPENDENCY_SOURCES.derived }))
    );
  }
  const cycles = findCycles(dependencies);
  const members = cycleMembersOf(cycles);
  if (cycles.length === 0) return { dependencies, degraded: false, cycles: [], members: [] };
  /* 安全退化（design D5）：整体按无依赖。留痕两路——优先注入回调（宿主带 logger 时
     写结构化服务端日志），缺省回落 console.warn（保证环在任何调用路径下可观测；
     spec「退化 SHALL 留服务端日志（含环成员）」）。本模块仍零文件 / 零网络 I/O。 */
  const info = { cycles, members };
  if (typeof input?.onDegraded === "function") {
    try {
      input.onDegraded(info);
    } catch {
      /* 日志回调异常不外溢（解析面永远不抛错） */
    }
  } else {
    try {
      console.warn("[dsh-v-cosmos] 依赖成环，本次解析退化为无依赖；环成员: %s", members.join(", "));
    } catch {
      /* console 不可用（极窄运行面）→ 静默，仍不抛错 */
    }
  }
  const degradedDependencies = new Map();
  for (const slug of nodes) degradedDependencies.set(slug, []);
  return { dependencies: degradedDependencies, degraded: true, cycles, members };
}

/**
 * 单提案生效依赖入口（纯函数，spec「解析服务面」输入 = 工作区 / 目标 slug）：
 * 工作区整体退化（成环）→ 空依赖；目标不在任何承载（无锚点 / 无台账行 / 不在活跃
 * 清单）→ 空依赖（按无守卫处理，安全方向）。
 * @param {object} input 观察快照 + `slug`
 * @returns {{slug: string, dependencies: Array<{slug: string, state: string, source: string}>,
 *            degraded: boolean, cycles: string[][]}}
 */
export function resolveDependencies(input) {
  const slug = typeof input?.slug === "string" ? input.slug : "";
  const workspace = resolveWorkspaceDependencies(input);
  if (workspace.degraded) return { slug, dependencies: [], degraded: true, cycles: workspace.cycles };
  return { slug, dependencies: workspace.dependencies.get(slug) ?? [], degraded: false, cycles: [] };
}

/** 生效依赖清单归一（求值入口容错：非法条目跳过、同 slug 去重、来源标记透传）。 */
function normalizeDependencyList(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const slug = isSlugText(item.slug) && item.slug.trim() === item.slug ? item.slug : "";
    if (!slug || !isDependencyState(item.state) || seen.has(slug)) continue;
    seen.add(slug);
    const source = item.source === DEPENDENCY_SOURCES.declared || item.source === DEPENDENCY_SOURCES.derived
      ? item.source
      : null;
    out.push({ slug, state: item.state, source });
  }
  return out;
}

/**
 * 达标求值入口（纯函数，spec「解析服务面」达标求值）：逐项求值返回逐项达标态 +
 * 整体达标态（未达标项可透出给呈现面）；观察快照缺失/非法 → 逐项按未达标处理
 * （宁缺守卫不误阻塞的消费侧要求：求值自身不抛错）。
 * @param {object} input 观察快照（`active` / `archiveNames`）+ `dependencies`（生效依赖集）
 * @returns {{satisfied: boolean,
 *            items: Array<{slug: string, state: string, source: string|null, satisfied: boolean}>,
 *            unsatisfied: Array<{slug: string, state: string, source: string|null, satisfied: boolean}>}}
 */
export function evaluateDependencies(input) {
  const observation = normalizeObservation(input);
  const items = normalizeDependencyList(input?.dependencies).map((dependency) => ({
    ...dependency,
    satisfied: satisfiedOf(observation, dependency)
  }));
  const unsatisfied = items.filter((item) => !item.satisfied);
  return { satisfied: unsatisfied.length === 0, items, unsatisfied };
}
