/**
 * 星空骨架扫描纯逻辑单点（add-cosmos-entry 2.1–2.3 / design.md「提案扫描口径」）。
 *
 * 独立模块——宿主 index.mjs 消费（路由/监听对账）、test/scan-smoke.mjs 冒烟直测。
 * 模块**零 node 内建依赖**：目录枚举 / tasks.md 读取 / stat 全部由调用方以回调注入，
 * 纯函数只做过滤、统计与装配——冒烟测试不必伪造文件系统，容错分支可穷举。
 *
 * 口径（对齐 hive `collectProposalNames` + design.md 修订）：
 *  - 活跃提案 = `<ws>/openspec/changes/` 的一级子目录，排除 `archive` 与 `.` 开头隐藏目录；
 *  - lifecycle：`<proposal>/.state.json`（cosmos-spec 契约 v1）判定
 *    created/reviewed/executed，缺失/非法一律兜底 "created"，SHALL NOT 抛错；
 *  - tasks：tasks.md 中**任意缩进**的 checkbox 行同口径计入 done 与 total
 *    （design 修订：原「一级统计 + 嵌套计入总数」两口径并存会让嵌套未勾项永远
 *    无法 complete，修订为同口径）；
 *  - pending：`<ws>/openspec/pending-changes/*.json` 待创建锚点（{name, by, at, sessionId?}，
 *    一文件一条目）；同名真实提案目录的锚点剔除（目录优先）；`sessionId` 为可选加法
 *    扩展（add-cosmos-embryo-cards 2.1：字符串非空才采纳，否则 null——读取方容错，
 *    旧锚点零迁移）；
 *  - 星云 = `archive/` 一级子目录计数；
 *  - 点燃谱系（add-cosmos-panel-birthline-sort 2.2）：`lineages` 由宿主注入回调投影
 *    （同一帧扫描结果上做 sighting 登记与点燃配对），本模块只负责挂载；回调缺席 /
 *    抛错 / 返回非数组 → `lineages: []`（读取失败按空清单兜底，不中断扫描）；
 *  - 容错（R3）：tasks.md / .state.json / pending 条目不可读/解析失败 → 按缺失兜底，
 *    SHALL NOT 抛错、不中断整工作区扫描。
 */

/** 目录项形状（调用方注入的 readdirSync(dir, { withFileTypes: true }) 结果）。 */

/**
 * 活跃提案名清单（纯函数）：排除 `archive/` 与 `.` 开头隐藏目录，名称字典序。
 * 非目录条目（散文件）同样排除——提案目录口径 SHALL NOT 收文件。
 * @param {Array<{name: string, isDirectory?: function(): boolean}>} entries
 * @returns {string[]}
 */
export function collectProposalNames(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const names = [];
  for (const entry of list) {
    if (!entry || typeof entry.name !== "string" || !entry.name) continue;
    if (entry.name === "archive" || entry.name.startsWith(".")) continue;
    if (typeof entry.isDirectory === "function" && !entry.isDirectory()) continue;
    names.push(entry.name);
  }
  return names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * archive 一级子目录计数（纯函数）：星云密度数据源。`archive/` 不存在 → 0；
 * 内部散文件不计（星云 = 归档**变更**集合，目录口径）。
 * @param {Array<{name: string, isDirectory?: function(): boolean}>} entries `archive/` 目录项
 * @returns {number}
 */
export function archiveCountOf(entries) {
  const list = Array.isArray(entries) ? entries : [];
  let count = 0;
  for (const entry of list) {
    if (!entry || typeof entry.name !== "string") continue;
    if (entry.name.startsWith(".")) continue;
    if (typeof entry.isDirectory === "function" && !entry.isDirectory()) continue;
    count += 1;
  }
  return count;
}

/** checkbox 行（任意缩进，`- [x]` / `- [ ]` / `* [X]` / `+ [ ]` 同口径）。 */
const CHECKBOX_RE = /^\s*[-*+]\s+\[([ xX])\]/;

/** 生命周期枚举（cosmos-spec 契约 v1；`proto` 仅由 merge 层星胚装配产出，不入磁盘枚举）。 */
const LIFECYCLE_STATES = new Set(["created", "reviewed", "executed"]);

/** .state.json 宽容解析（私有）：非字符串/非法 JSON/非对象 → null。 */
function parseStateDoc(text) {
  if (typeof text !== "string") return null;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 提案生命周期判定（纯函数，cosmos-spec 契约 v1）：
 *  - `.state.json` 缺失/非法 JSON/非对象/`version !== 1`/`state` 枚举外
 *    → 一律 `"created"` 兜底（spec「缺失兜底」），SHALL NOT 抛错。
 * @param {string|null} text `.state.json` 全文（缺失 → null）
 * @returns {"created"|"reviewed"|"executed"}
 */
export function lifecycleOf(text) {
  const doc = parseStateDoc(text);
  if (!doc || doc.version !== 1 || !LIFECYCLE_STATES.has(doc.state)) return "created";
  return doc.state;
}

/**
 * tasks.md 勾选统计（纯函数）：文本不可解析（非字符串）→ `{ done: 0, total: 0, parseable: false }`；
 * 可解析但无 checkbox → `{ done: 0, total: 0, parseable: true }`（状态走 draft，不是容错分支）。
 * @param {string} text tasks.md 全文
 * @returns {{done: number, total: number, parseable: boolean}}
 */
export function countCheckboxes(text) {
  if (typeof text !== "string") return { done: 0, total: 0, parseable: false };
  let done = 0;
  let total = 0;
  for (const line of text.split(/\r?\n/)) {
    const m = CHECKBOX_RE.exec(line);
    if (!m) continue;
    total += 1;
    if (m[1] !== " ") done += 1;
  }
  return { done, total, parseable: true };
}

/**
 * 单提案扫描装配（纯函数，注入读写回调）：
 *  - `readTasks(proposalDir)` 返回 tasks.md 文本（缺失/不可读 → null）；
 *  - `readBirthMs(proposalDir)` 返回目录创建毫秒（取不到 → null，宿主回落检测时刻）；
 *  - `readState(proposalDir)` 返回 `.state.json` 文本（缺失/不可读 → null）。
 * 容错（R3）：回调抛错一律按缺失处理，SHALL NOT 中断整工作区扫描。
 * star 形状（add-celestial-states 2.1）：`lifecycle` + `setBy`/`at` 取代三态
 * `status` 字段（任务进度保留在 `tasks`）。
 *
 * @param {string} proposalName 提案名
 * @param {string} proposalDir 该提案目录绝对路径
 * @returns {{ id: string, name: string, lifecycle: string, setBy: string|null, at: number|null, tasks: [number, number], birthMs: number|null }}
 */
export function scanProposal(proposalName, proposalDir, readTasks, readBirthMs, readState) {
  let text = null;
  try {
    text = typeof readTasks === "function" ? readTasks(proposalDir) : null;
  } catch {
    text = null;
  }
  const tasks = countCheckboxes(text);
  let birthMs = null;
  try {
    birthMs = typeof readBirthMs === "function" ? readBirthMs(proposalDir) : null;
  } catch {
    birthMs = null;
  }
  let stateText = null;
  try {
    stateText = typeof readState === "function" ? readState(proposalDir) : null;
  } catch {
    stateText = null;
  }
  const doc = parseStateDoc(stateText);
  const valid = Boolean(doc) && doc.version === 1 && LIFECYCLE_STATES.has(doc.state);
  return {
    id: proposalName,
    name: proposalName,
    lifecycle: lifecycleOf(stateText),
    setBy: valid && typeof doc.setBy === "string" && doc.setBy ? doc.setBy : null,
    at: valid && Number.isFinite(Number(doc.at)) ? Number(doc.at) : null,
    tasks: [tasks.done, tasks.total],
    birthMs: typeof birthMs === "number" && Number.isFinite(birthMs) ? birthMs : null
  };
}

/**
 * pending 锚点 slug 清单（纯函数，add-celestial-states 2.2）：
 * `openspec/pending-changes/` 一级 `*.json` 文件 → 去 `.json` 后缀的锚点名。
 * 子目录与非 `.json` 散文件不计；结果字典序。
 * @param {Array<{name: string, isDirectory?: function(): boolean}>} entries pending 目录项
 * @returns {string[]}
 */
export function collectPendingNames(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const names = [];
  for (const entry of list) {
    if (!entry || typeof entry.name !== "string") continue;
    if (!entry.name.endsWith(".json")) continue;
    if (typeof entry.isDirectory === "function" && entry.isDirectory()) continue;
    names.push(entry.name.slice(0, -5));
  }
  return names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * pending 锚点条目归一（纯函数，add-celestial-states 2.2 / add-cosmos-embryo-cards 2.1）：
 * `readPendingDir` 产出的原始条目 → 合法 `{name, by, at, sessionId}` 列表（非法文件跳过）；
 * 同名真实提案目录的锚点剔除（目录优先）。
 * `sessionId` 读取方容错：字符串非空才采纳，缺失/空值/非字符串一律归一为 null
 * （= 无关联，该锚点独立成星胚卡片），SHALL NOT 抛错。
 * @param {Array<{name?: unknown, by?: unknown, at?: unknown, sessionId?: unknown}>} items 原始条目
 * @param {Set<string>} activeNames 活跃提案名集合（目录优先剔除基准）
 * @returns {Array<{name: string, by: string|null, at: number|null, sessionId: string|null}>}
 */
export function pendingItemsOf(items, activeNames) {
  const active = activeNames instanceof Set ? activeNames : new Set(Array.isArray(activeNames) ? activeNames : []);
  const list = Array.isArray(items) ? items : [];
  const out = [];
  for (const item of list) {
    if (!item || typeof item.name !== "string" || !item.name) continue;
    if (active.has(item.name)) continue; // 同名真实提案目录存在 → 锚点剔除（目录优先）
    const at = Number(item.at);
    out.push({
      name: item.name,
      by: typeof item.by === "string" && item.by ? item.by : null,
      at: Number.isFinite(at) && at > 0 ? at : null,
      sessionId: typeof item.sessionId === "string" && item.sessionId ? item.sessionId : null
    });
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * 单工作区骨架装配（纯函数，注入读目录回调）：
 *  - `readChangesDir(wsPath)` → `openspec/changes` 目录项（目录缺失 → null）；
 *  - `readArchiveDir(wsPath)` → `openspec/changes/archive` 目录项（缺失 → null）；
 *  - `readPendingDir(wsPath)` → `openspec/pending-changes/*.json` 的 `{name, by, at, sessionId?}`
 *    原始条目列表（目录缺失/不可读 → null，非法文件由调用方跳过）。
 * 目录缺失 → 该工作区产出空骨架（`stars: []`、`archives: 0`、`pending: []`），
 * SHALL NOT 抛错（对齐 hive「无 openspec 目录者空组不抛错」两侧分写口径）。
 *
 * @param {{ id: string, name?: string, path: string, title?: string }} workspace 在册工作区实体投影
 * @param {object} readers 读回调组
 * @returns {{ id: string, name: string, path: string, stars: object[], archives: number, pending: object[] }}
 */
export function scanWorkspace(workspace, readers) {
  const id = String(workspace?.id ?? "");
  const path = String(workspace?.path ?? "");
  const name = typeof workspace?.name === "string" && workspace.name ? workspace.name : (typeof workspace?.title === "string" && workspace.title ? workspace.title : id);
  const changesDir = path ? joinChangesDir(path) : null;
  const archiveDir = path ? joinArchiveDir(path) : null;
  let changeEntries = null;
  try {
    changeEntries = typeof readers?.readChangesDir === "function" ? readers.readChangesDir(path) : null;
  } catch {
    changeEntries = null;
  }
  let archiveEntries = null;
  try {
    archiveEntries = typeof readers?.readArchiveDir === "function" ? readers.readArchiveDir(path) : null;
  } catch {
    archiveEntries = null;
  }
  let pendingItems = null;
  try {
    pendingItems = typeof readers?.readPendingDir === "function" ? readers.readPendingDir(path) : null;
  } catch {
    pendingItems = null;
  }
  const activeNames = new Set(collectProposalNames(changeEntries));
  const stars = [...activeNames].map((proposalName) =>
    scanProposal(proposalName, joinProposalDir(changesDir, proposalName), readers?.readTasks, readers?.readBirthMs, readers?.readState)
  );
  return {
    id,
    name,
    path,
    stars,
    archives: archiveCountOf(archiveEntries),
    pending: pendingItemsOf(pendingItems, activeNames)
  };
}

/** `openspec/changes` 目录绝对路径（单点；路径只构造不反解）。 */
export function joinChangesDir(workspacePath) {
  return String(workspacePath).replace(/[\\/]+$/, "") + "/openspec/changes";
}

/** `openspec/changes/archive` 目录绝对路径。 */
export function joinArchiveDir(workspacePath) {
  return joinChangesDir(workspacePath) + "/archive";
}

/** `openspec/pending-changes` 目录绝对路径（待创建锚点，cosmos-spec 契约 v1）。 */
export function joinPendingDir(workspacePath) {
  return String(workspacePath).replace(/[\\/]+$/, "") + "/openspec/pending-changes";
}

/** 提案目录绝对路径。 */
export function joinProposalDir(changesDir, proposalName) {
  return String(changesDir).replace(/[\\/]+$/, "") + "/" + proposalName;
}

/**
 * 星空骨架装配（纯函数）：全在册工作区 × 提案扫描 + 共享会话关联派生连线。
 * 关联边（`associations`）由宿主关联引擎提供后并入；`deriveLinks` 依共享会话
 * 派生星座内恒星连线（v1 数据源，design.md「星座内提案关联虚线」）。
 *
 * @param {Array<object>} workspaces 在册工作区实体投影
 * @param {object} readers 读回调组（readChangesDir / readArchiveDir / readTasks / readBirthMs / readState / readPendingDir）
 * @param {{ now: number, associations: Array<{workspace: string, proposal: string, sessionId: string, origin?: string}>,
 *           lineagesOf?: (workspacePath: string, scanned: {stars: object[], pending: object[]}) => Array<object> }} [context]
 *        now = 生成时刻；associations = 归一化后的关联条目（workspace 为路径指纹）；
 *        lineagesOf = 点燃谱系台账投影回调（add-cosmos-panel-birthline-sort 2.2）——由
 *        宿主注入，**在同一帧扫描结果上**做 sighting 登记与点燃配对后返回该工作区谱系行；
 *        缺席 / 抛错 → `lineages: []`（读取失败按空清单兜底，不中断扫描）
 * @returns {object} 骨架 JSON（version/generatedAt/workspaces[].{stars,archives,pending,lineages,links,associations}）
 */
export function buildSkeleton(workspaces, readers, context) {
  const now = Number(context?.now) || Date.now();
  const associations = Array.isArray(context?.associations) ? context.associations : [];
  const lineagesOf = typeof context?.lineagesOf === "function" ? context.lineagesOf : null;
  const workspacesOut = [];
  for (const workspace of Array.isArray(workspaces) ? workspaces : []) {
    const scanned = scanWorkspace(workspace, readers);
    const wsAssociations = associations
      .filter((entry) => entry && entry.workspace === scanned.path)
      .map((entry) => ({ proposal: String(entry.proposal ?? ""), sessionId: String(entry.sessionId ?? ""), origin: entry.origin === "explicit" ? "explicit" : "heuristic" }))
      .filter((entry) => entry.proposal && entry.sessionId);
    /* 点燃谱系投影（add-cosmos-panel-birthline-sort 2.2）：回调在同一帧的 pending /
       活跃提案清单上完成「锚点在册 → 同名提案目录出现」的差分配对，返回该工作区台账行；
       容错与目录扫描同款——失败按空清单兜底，SHALL NOT 中断其余工作区扫描。 */
    let lineages = [];
    if (lineagesOf) {
      try {
        const rows = lineagesOf(scanned.path, { stars: scanned.stars, pending: scanned.pending });
        lineages = Array.isArray(rows) ? rows : [];
      } catch {
        lineages = [];
      }
    }
    workspacesOut.push({
      id: scanned.id,
      name: scanned.name,
      path: scanned.path,
      stars: scanned.stars,
      archives: scanned.archives,
      pending: scanned.pending,
      lineages,
      links: deriveLinks(scanned.stars, wsAssociations),
      associations: wsAssociations
    });
  }
  return { version: 1, generatedAt: now, workspaces: workspacesOut };
}

/**
 * 星座内提案连线派生（纯函数，v1 = 共享会话）：同一会话关联同星座 ≥2 恒星 →
 * 两两连线（恒星索引对，升序）。提案不在活跃清单的关联不产线（骨架为准）。
 * @param {Array<{id: string}>} stars 活跃恒星
 * @param {Array<{proposal: string, sessionId: string}>} associations 星座关联条目
 * @returns {Array<[number, number]>}
 */
export function deriveLinks(stars, associations) {
  const index = new Map();
  (Array.isArray(stars) ? stars : []).forEach((star, i) => index.set(star?.id, i));
  /** sessionId → 恒星索引集合 */
  const bySession = new Map();
  for (const entry of Array.isArray(associations) ? associations : []) {
    const i = index.get(entry?.proposal);
    if (i === undefined) continue;
    const sid = entry?.sessionId;
    if (!sid) continue;
    const set = bySession.get(sid);
    if (set) set.add(i);
    else bySession.set(sid, new Set([i]));
  }
  const links = [];
  const seen = new Set();
  for (const set of bySession.values()) {
    if (set.size < 2) continue;
    const ordered = [...set].sort((a, b) => a - b);
    for (let a = 0; a < ordered.length; a++) {
      for (let b = a + 1; b < ordered.length; b++) {
        const key = ordered[a] + ":" + ordered[b];
        if (seen.has(key)) continue;
        seen.add(key);
        links.push([ordered[a], ordered[b]]);
      }
    }
  }
  return links.sort((x, y) => (x[0] - y[0]) || (x[1] - y[1]));
}

/** 提案 slug 正则形态（启发式规则 1 匹配用）：提案名整体按词边界出现。 */
function escapeRe(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 文本 × 提案名匹配（纯函数，历史启发式规则 1 的匹配核心；restrict-association-heuristics
 * 收紧信号口径后**保留供其他消费面**——规则 1 已改用 `assignmentProposalSlugs` 的指派引用，
 * 纯匹配语义逐字不变）：提案名（如 `add-xxx`）在文本中按词边界出现即命中。多提案命中
 * 全部返回（design.md：多条命中 → 多提案联星）。空文本/空清单 → 空数组。
 * @param {string} text 近期上下文文本
 * @param {string[]} proposalNames 活跃提案名
 * @returns {string[]}
 */
export function matchProposalSlugs(text, proposalNames) {
  if (typeof text !== "string" || text.length === 0) return [];
  const names = Array.isArray(proposalNames) ? proposalNames.filter((n) => typeof n === "string" && n) : [];
  if (names.length === 0) return [];
  const matched = [];
  for (const name of names) {
    const re = new RegExp("(?<![\\w-])" + escapeRe(name) + "(?![\\w-])");
    if (re.test(text)) matched.push(name);
  }
  return matched;
}

/**
 * `@<提案目录>` 指派引用解析（纯函数，restrict-association-heuristics 1.1 / design D1）：
 * 会话**用户侧**消息文本 → 其中 `@` 引用路径所指向的提案 slug 清单（去重保序）。
 *
 * 口径：
 *  - 路径分隔符先归一（`\` → `/`，Windows 反斜杠写法可命中）；@ 引用须含
 *    `openspec/changes/<slug>` 片段，slug 取 `[\w-]+`（词边界：尾随标点 / 子路径 /
 *    `#L12` 等不并入 slug）；
 *  - 普通正文提及（未带 `@` 前缀）不算——「提到」不是「派活」；
 *  - 解析失败 / 空文本 → 空数组（宁缺勿滥：欠关联优于错误关联）。
 *
 * 本函数只做**路径引用解析**，不与活跃提案清单取交集（该过滤在装配层
 * `applyContextHeuristic` 完成，纯匹配语义单一职责）。
 *
 * @param {string} text 用户侧消息文本（多块拼接）
 * @returns {string[]} 指派信号 slug 清单（去重保序）
 */
export function assignmentProposalSlugs(text) {
  if (typeof text !== "string" || text.length === 0) return [];
  const normalized = text.replace(/\\/g, "/");
  const slugs = [];
  const seen = new Set();
  for (const match of normalized.matchAll(/@[^\s]*?openspec\/changes\/([\w-]+)/g)) {
    const slug = match[1];
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    slugs.push(slug);
  }
  return slugs;
}

/**
 * 提案目录出现窗口 × 唯一活跃会话判定（纯函数，启发式规则 2）：
 * 提案目录出现时刻 T（birthMs，取不到回落检测时刻）±30min 窗口内，该工作区
 * **唯一**活跃会话（lastActivityMs 落窗内）→ 返回该 sessionId；0 个或 ≥2 个 → null。
 *
 * 忙碌排除（restrict-association-heuristics 3.1 / design D4）：判定时刻「正在运行」的
 * 会话不参与候选——忙碌会话不可能是新目录的接生者。排除后仍按唯一性语义判定
 * （0 个或 ≥2 个 → null）；`runningSessionIds` 缺失/非法 → 不排除（行为退回旧口径）。
 *
 * @param {{ birthMs: number|null, detectedMs: number, sessions: Array<{sessionId: string, lastActivityMs: number}>,
 *           runningSessionIds?: Set<string>|string[] }} input
 * @returns {string|null}
 */
export function birthtimeWindowUnique(input) {
  const WINDOW_MS = 30 * 60 * 1000;
  const birth = Number.isFinite(input?.birthMs) ? input.birthMs : Number(input?.detectedMs);
  if (!Number.isFinite(birth)) return null;
  const rawRunning = input?.runningSessionIds;
  const running = rawRunning instanceof Set
    ? rawRunning
    : new Set(Array.isArray(rawRunning) ? rawRunning : []);
  const sessions = Array.isArray(input?.sessions) ? input.sessions : [];
  let inWindow = [];
  for (const session of sessions) {
    const at = Number(session?.lastActivityMs);
    if (!Number.isFinite(at)) continue;
    if (Math.abs(at - birth) > WINDOW_MS) continue;
    const sessionId = String(session.sessionId ?? "");
    if (!sessionId || running.has(sessionId)) continue;
    inWindow.push(sessionId);
  }
  return inWindow.length === 1 ? inWindow[0] : null;
}
