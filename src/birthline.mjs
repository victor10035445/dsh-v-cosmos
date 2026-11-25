/**
 * 点燃谱系台账纯逻辑单点（add-cosmos-panel-birthline-sort 1.1 / design D1–D6；
 * first-add-proposal-dependency-declaration 3.3/3.4 增 `requires` 快照承接）。
 *
 * 独立模块——宿主 index.mjs 消费（持久化 store 接线 / 扫描差分观察 / 骨架投影）、
 * test/birthline-smoke.mjs 冒烟直测。模块**零 node 内建依赖**（对齐 scan.mjs /
 * associations.mjs 惯例）：文件读写由宿主半区注入，本模块只做行校验归一、TTL 清理、
 * sighting 差分、点燃配对与投影——冒烟测试可穷举容错分支。
 *
 * 解决的数据断点（design「点燃即失传」）：
 *
 * ```
 *  星胚期                      点燃（ff）                       点燃后
 *  pending-changes/<slug>.json 创建 changes/<slug>/ + 删锚点   谱系（at / sessionId）失传
 *  { at: T₁, sessionId }                                       只剩目录 birthMs ≈ T₂
 * ```
 *
 * 捕获 = **扫描差分**（不依赖 fs.watch 事件顺序）：
 *  1. **sighting 登记**：本帧在册 pending 锚点 upsert 进持久 sighting 映射
 *     `{ slug → { at, sessionId, seenAt, requires? } }`（跨重启保配对能力）；
 *  2. **点燃配对**：本帧活跃提案 slug 命中 sighting → 写台账行
 *     `{ slug, embryoAt, embryoSessionId, ignitedMs, requires? }` 并消费该 sighting；
 *     未命中（手工 `opsx:new` 创建）→ 不写行，面板走 `birthMs` 兜底；
 *  3. **dismiss 天然不误记**：dismiss 带同名提案目录守卫，锚点消失后同名提案永不
 *     出现 → sighting 仅靠 TTL 过期，不产生台账行。
 *
 * 依赖声明承接（first-add-proposal-dependency-declaration 3.3/3.4）：锚点可选
 * `requires`（`[{ slug, state }]`，schema 与容错唯一定义点 = `dep-resolve.mjs`
 * `normalizeRequires`）。本模块只在**落键与否**上按该容错契约做 syntactic 校验
 * （缺失/非法 → 不落键，原样不二次校验引用语义——前置是否在册、是否成环归解析面）；
 * sighting 与台账行同帧捕获、同 slug 覆盖随新快照更新。台账是依赖声明的**唯一持久
 * 载体**（锚点在 ff 清理步骤即被删除，点燃配对是唯一捕获窗口）。
 *
 * 持久化形状（宿主索引 = 工作区**路径**命名空间，跨工作区同名 slug 互不串扰）：
 *
 * ```json
 * { "version": 1, "workspaces": { "<wsPath>": { "lineages": [...], "sightings": [...] } } }
 * ```
 *
 * 生命周期（design D6）：sighting TTL = 7 天（登记后同名提案目录未出现 = dismiss /
 * 手删残影，不应无限累积）；台账行 upsert 上限 512（按 `ignitedMs` 最旧淘汰）、
 * sighting 上限 512（按 `seenAt` 最旧淘汰）。同 slug 再次点燃覆盖为最新谱系。
 *
 * 容错纪律（spec「台账读取容错」）：损坏 / 缺失 / 解析失败一律按**空台账**兜底，
 * 非法行剔除，SHALL NOT 抛错、SHALL NOT 中断骨架扫描。
 */
import { normalizeRequires } from "./dep-resolve.mjs";

/** 存储文档版本（与宿主 storage-json 同款「超版本即兜底」语义）。 */
export const BIRTHLINE_VERSION = 1;
/** 台账行上限（逐工作区；超出按 ignitedMs 最旧淘汰）。 */
export const BIRTHLINE_LIMIT = 512;
/** sighting 上限（逐工作区；超出按 seenAt 最旧淘汰）。 */
export const SIGHTING_LIMIT = 512;
/** sighting 存活期：登记后 7 天内同名提案目录未出现即过期清理。 */
export const SIGHTING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 码点序比较（确定性字典序；不依赖运行环境 locale/ICU）。 */
function compareText(a, b) {
  const left = String(a ?? "");
  const right = String(b ?? "");
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** 正数毫秒（非有限 / ≤0 → null；台账时间字段的唯一取值口径）。 */
function positiveMs(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

/** 可选 sessionId 归一（非字符串 / 空串 → null；读取方容错，零迁移）。 */
function optionalSessionId(value) {
  return typeof value === "string" && value ? value : null;
}

/**
 * 台账行校验归一（纯函数）：`slug` 空值、`embryoAt` / `ignitedMs` 非正数 → null
 * （整行剔除，spec「非法行剔除」）；`embryoSessionId` 缺失 / 空值 → null；
 * `requires` 缺失 / 非法（非数组 / 条目非法 / 同 slug 重复）→ 不落键，合法则原样
 * 快照（syntactic 校验归 `dep-resolve.normalizeRequires`，本层不二次校验引用语义）。
 * @param {unknown} raw 原始行
 * @returns {{slug: string, embryoAt: number, embryoSessionId: string|null, ignitedMs: number, requires?: Array<{slug: string, state: string}>}|null}
 */
export function normalizeLineageRow(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const slug = typeof raw.slug === "string" ? raw.slug.trim() : "";
  const embryoAt = positiveMs(raw.embryoAt);
  const ignitedMs = positiveMs(raw.ignitedMs);
  if (!slug || embryoAt === null || ignitedMs === null) return null;
  const row = { slug, embryoAt, embryoSessionId: optionalSessionId(raw.embryoSessionId), ignitedMs };
  const requires = normalizeRequires(raw.requires);
  if (requires !== null) row.requires = requires;
  return row;
}

/**
 * 台账行清单归一（纯函数）：逐行校验剔除 → 同 slug 保留 `ignitedMs` 最新（upsert 语义）
 * → 超上限按 `ignitedMs` 最旧淘汰 → slug 码点序输出（确定性，供骨架指纹稳定序列化）。
 * @param {unknown} raw 原始行数组
 * @returns {Array<{slug: string, embryoAt: number, embryoSessionId: string|null, ignitedMs: number}>}
 */
export function normalizeLineages(raw) {
  if (!Array.isArray(raw)) return [];
  const bySlug = new Map();
  for (const item of raw) {
    const row = normalizeLineageRow(item);
    if (!row) continue;
    const existing = bySlug.get(row.slug);
    if (!existing || row.ignitedMs >= existing.ignitedMs) bySlug.set(row.slug, row);
  }
  let rows = [...bySlug.values()];
  if (rows.length > BIRTHLINE_LIMIT) {
    rows.sort((a, b) => a.ignitedMs - b.ignitedMs || compareText(a.slug, b.slug));
    rows = rows.slice(rows.length - BIRTHLINE_LIMIT);
  }
  return rows.sort((a, b) => compareText(a.slug, b.slug));
}

/**
 * sighting 行校验归一（纯函数）：`slug` 空值、`at` / `seenAt` 非正数 → null；
 * `sessionId` 缺失 / 空值 → null；`requires` 缺失 / 非法 → 不落键（同台账行口径）。
 * @param {unknown} raw 原始行
 * @returns {{slug: string, at: number, sessionId: string|null, seenAt: number, requires?: Array<{slug: string, state: string}>}|null}
 */
export function normalizeSightingRow(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const slug = typeof raw.slug === "string" ? raw.slug.trim() : "";
  const at = positiveMs(raw.at);
  const seenAt = positiveMs(raw.seenAt);
  if (!slug || at === null || seenAt === null) return null;
  const row = { slug, at, sessionId: optionalSessionId(raw.sessionId), seenAt };
  const requires = normalizeRequires(raw.requires);
  if (requires !== null) row.requires = requires;
  return row;
}

/**
 * sighting 行清单基础归一（私有，无 TTL / 无上限）：逐行校验剔除 + 同 slug 保留
 * `seenAt` 最新 + slug 码点序输出。观察面据此比较「落盘态」与「清理后态」，
 * 使 TTL 过期 / 上限淘汰本身被识别为变更（陈旧残影最终落盘清理）。
 * @param {unknown} raw 原始行数组
 * @returns {Array<{slug: string, at: number, sessionId: string|null, seenAt: number}>}
 */
function normalizedSightingRows(raw) {
  if (!Array.isArray(raw)) return [];
  const bySlug = new Map();
  for (const item of raw) {
    const row = normalizeSightingRow(item);
    if (!row) continue;
    const existing = bySlug.get(row.slug);
    if (!existing || row.seenAt >= existing.seenAt) bySlug.set(row.slug, row);
  }
  return [...bySlug.values()].sort((a, b) => compareText(a.slug, b.slug));
}

/**
 * sighting 清单归一（纯函数）：逐行校验剔除 → TTL 过期清理（`now - seenAt > TTL`）
 * → 同 slug 保留 `seenAt` 最新 → 超上限按 `seenAt` 最旧淘汰 → slug 码点序输出。
 * @param {unknown} raw 原始行数组
 * @param {number} [now] 判定基准时刻（缺省 Date.now()）
 * @returns {Array<{slug: string, at: number, sessionId: string|null, seenAt: number}>}
 */
export function normalizeSightings(raw, now = Date.now()) {
  const base = Number.isFinite(Number(now)) && Number(now) > 0 ? Number(now) : Date.now();
  let rows = normalizedSightingRows(raw).filter((row) => base - row.seenAt <= SIGHTING_TTL_MS);
  if (rows.length > SIGHTING_LIMIT) {
    rows.sort((a, b) => a.seenAt - b.seenAt || compareText(a.slug, b.slug));
    rows = rows.slice(rows.length - SIGHTING_LIMIT);
  }
  return rows.sort((a, b) => compareText(a.slug, b.slug));
}

/** 空台账文档（损坏 / 缺席 / 超版本的兜底值）。 */
export function emptyBirthlineDoc() {
  return { version: BIRTHLINE_VERSION, workspaces: {} };
}

/**
 * 单工作区台账节归一（纯函数）。
 * @param {unknown} raw 原始节（{ lineages?, sightings? }）
 * @param {number} [now] sighting TTL 判定基准
 * @returns {{lineages: Array<object>, sightings: Array<object>}}
 */
export function normalizeBirthlineWorkspace(raw, now = Date.now()) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return { lineages: normalizeLineages(src.lineages), sightings: normalizeSightings(src.sightings, now) };
}

/**
 * 台账文档解析（纯函数，spec「台账文件损坏兜底重建」）：
 * 非字符串 / 非法 JSON / 非对象 / `version !== 1` / `workspaces` 非对象 → 空台账；
 * 单工作区节非法 → 跳过；空节（无行无 sighting）不保留（写入面零噪声）。
 * @param {unknown} text 台账全文（缺失 → null / ""）
 * @param {number} [now] sighting TTL 判定基准
 * @returns {{version: number, workspaces: Record<string, {lineages: Array<object>, sightings: Array<object>}>}}
 */
export function parseBirthlineDoc(text, now = Date.now()) {
  const fallback = emptyBirthlineDoc();
  if (typeof text !== "string" || !text) return fallback;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fallback;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
  if (parsed.version !== BIRTHLINE_VERSION) return fallback;
  const wsRaw = parsed.workspaces;
  if (!wsRaw || typeof wsRaw !== "object" || Array.isArray(wsRaw)) return fallback;
  const workspaces = {};
  for (const path of Object.keys(wsRaw)) {
    if (!path) continue;
    const value = wsRaw[path];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const normalized = normalizeBirthlineWorkspace(value, now);
    if (normalized.lineages.length === 0 && normalized.sightings.length === 0) continue;
    workspaces[path] = normalized;
  }
  return { version: BIRTHLINE_VERSION, workspaces };
}

/**
 * 台账文档序列化（纯函数，UTF-8 无 BOM 由宿主写出面保证）：
 * 工作区按路径码点序、行按 slug 码点序 → 同内容恒同字节（跨重启零抖动）。
 * sighting 在写出前同口径做 TTL / 上限归一（陈旧残影不落盘）。
 * @param {unknown} doc 台账文档
 * @param {number} [now] sighting TTL 判定基准
 * @returns {string} JSON 文本
 */
export function serializeBirthlineDoc(doc, now = Date.now()) {
  const src = doc && typeof doc === "object" && !Array.isArray(doc) ? doc : {};
  const wsSrc = src.workspaces && typeof src.workspaces === "object" && !Array.isArray(src.workspaces)
    ? src.workspaces
    : {};
  const workspaces = {};
  for (const path of Object.keys(wsSrc).sort(compareText)) {
    if (!path) continue;
    const value = wsSrc[path];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const normalized = normalizeBirthlineWorkspace(value, now);
    if (normalized.lineages.length === 0 && normalized.sightings.length === 0) continue;
    workspaces[path] = normalized;
  }
  return JSON.stringify({ version: BIRTHLINE_VERSION, workspaces }, null, 2);
}

/**
 * 工作区谱系投影（纯函数，merge 层以 slug 回查的数据源；依赖解析面的台账输入）：
 * 台账缺席 / 工作区无记录 → 空清单（调用方按「无谱系」兜底，SHALL NOT 抛错）。
 * `requires` 快照仅在行内存在时透传（旧行零迁移、形状最小）。
 * @param {object|null} doc 台账文档
 * @param {unknown} workspacePath 工作区路径（命名空间键）
 * @returns {Array<{slug: string, embryoAt: number, embryoSessionId: string|null, ignitedMs: number, requires?: Array<{slug: string, state: string}>}>}
 */
export function lineagesOf(doc, workspacePath) {
  const path = typeof workspacePath === "string" ? workspacePath : "";
  if (!path) return [];
  const ws = doc && typeof doc === "object" && doc.workspaces && typeof doc.workspaces === "object"
    ? doc.workspaces[path]
    : null;
  if (!ws || !Array.isArray(ws.lineages)) return [];
  return ws.lineages.map((row) => {
    const projected = {
      slug: row.slug,
      embryoAt: row.embryoAt,
      embryoSessionId: row.embryoSessionId ?? null,
      ignitedMs: row.ignitedMs
    };
    if (Array.isArray(row.requires)) {
      projected.requires = row.requires.map((item) => ({ slug: item.slug, state: item.state }));
    }
    return projected;
  });
}

/** `requires` 快照比较键（缺失与空数组区分；值域已归一 → 序列化确定性）。 */
function requiresKeyOf(requires) {
  return JSON.stringify(requires ?? null);
}

/** 台账行规范签名（变更判定用；值域已归一，逐字段可逆比较；`requires` 入签名
 *  → 锚点声明更新可刷新快照并触发落盘）。 */
function lineageSignature(rows) {
  return rows
    .map((row) => [row.slug, row.embryoAt, row.embryoSessionId ?? "", row.ignitedMs, requiresKeyOf(row.requires)].join("\u0001"))
    .join("\u0002");
}

/** sighting 行规范签名（变更判定用；`requires` 同口径入签名）。 */
function sightingSignature(rows) {
  return rows
    .map((row) => [row.slug, row.at, row.sessionId ?? "", row.seenAt, requiresKeyOf(row.requires)].join("\u0001"))
    .join("\u0002");
}

/**
 * 单工作区扫描差分观察（纯函数，design D2/D3 的收敛点）：登记 sighting → 点燃配对
 * → 返回更新后的**整份台账文档**。宿主每帧装配骨架时逐工作区调用。
 *
 * 语义要点：
 *  - sighting 登记只在本帧锚点取值（`at` / `sessionId` / `requires`）与既有记录**不同**
 *    时刷新 `seenAt`（同值不重写 → 每帧零落盘抖动，但锚点 `requires` 更新可刷新快照）；
 *    `at` 非正数（旧锚点缺 `at`）不登记（配对出的台账行会因 `embryoAt` 非法被剔除，
 *    不如直接走 `birthMs` 兜底）；
 *  - 点燃配对 = 本帧活跃提案 slug ∩ sighting（大小写敏感的精确 slug）；命中即写台账行
 *    并以**当前时刻**作 `ignitedMs`，`requires` 快照与谱系字段**同帧**带入（锚点缺失/
 *    非法该字段 → 行不落该键），随后消费该 sighting（同一 sighting 只配一次）；
 *  - 无 `sessionId` 的 solo 锚点照常登记（配对出 `embryoSessionId: null` 的台账行，
 *    面板按其 slug 自成块）；
 *  - `changed` = 台账行或 sighting 任一有差异（宿主据此落盘）；`lineagesChanged` =
 *    仅台账行有差异（宿主据此判定谱系是否影响骨架指纹 → 广播）。
 *
 * @param {object|null} doc 当前台账文档
 * @param {object} input
 * @param {unknown} input.workspacePath 工作区路径（命名空间键；空 → 不写、返回原文档）
 * @param {Array<{name?: unknown, at?: unknown, sessionId?: unknown, requires?: unknown}>} [input.pending]
 *        本帧在册 pending 锚点（scan.mjs 归一后条目）
 * @param {Array<unknown>} [input.activeSlugs] 本帧活跃提案 slug（扫描恒星 id）
 * @param {number} [input.now] 判定时刻（缺省 Date.now()）
 * @returns {{doc: {version: number, workspaces: Record<string, object>},
 *            changed: boolean, lineagesChanged: boolean,
 *            lineages: Array<object>, sightings: Array<object>}}
 */
export function observeWorkspaceBirthlines(doc, input = {}) {
  const now = positiveMs(input?.now) ?? Date.now();
  const path = typeof input?.workspacePath === "string" ? input.workspacePath : "";
  const base = doc && typeof doc === "object" && !Array.isArray(doc) && doc.version === BIRTHLINE_VERSION
    ? doc
    : emptyBirthlineDoc();
  const wsSrc = base.workspaces && typeof base.workspaces === "object" && !Array.isArray(base.workspaces)
    ? base.workspaces
    : {};
  if (!path) {
    const lineages = [];
    return { doc: base, changed: false, lineagesChanged: false, lineages, sightings: [] };
  }
  const current = wsSrc[path] ?? {};
  let lineages = normalizeLineages(current.lineages);
  let sightings = normalizeSightings(current.sightings, now);
  const beforeLineages = lineageSignature(lineages);
  /* 「落盘态」以**未过 TTL** 的归一清单为基准：TTL 过期与上限淘汰本身即变更，
     宿主据此把清理结果落盘（陈旧残影不无限累积）。 */
  const beforeSightings = sightingSignature(normalizedSightingRows(current.sightings));

  /* 1) sighting 登记：本帧在册锚点 upsert（同值不刷新 seenAt → 扫码零抖动；
        requires 入比较：锚点声明更新可刷新快照）。 */
  const sightingBySlug = new Map(sightings.map((row) => [row.slug, row]));
  for (const anchor of Array.isArray(input.pending) ? input.pending : []) {
    if (!anchor || typeof anchor.name !== "string" || !anchor.name) continue;
    const at = positiveMs(anchor.at);
    if (at === null) continue; // 缺 at 的旧锚点：配对产物必然非法 → 不登记
    const sessionId = optionalSessionId(anchor.sessionId);
    const requires = normalizeRequires(anchor.requires);
    const existing = sightingBySlug.get(anchor.name);
    if (
      existing &&
      existing.at === at &&
      existing.sessionId === sessionId &&
      requiresKeyOf(existing.requires) === requiresKeyOf(requires)
    ) continue;
    const next = { slug: anchor.name, at, sessionId, seenAt: now };
    if (requires !== null) next.requires = requires;
    sightingBySlug.set(anchor.name, next);
  }
  sightings = capSightings([...sightingBySlug.values()]);

  /* 2) 点燃配对：活跃提案 slug ∩ sighting → 台账行（requires 快照同帧带入）+ 消费 sighting。 */
  const lineageBySlug = new Map(lineages.map((row) => [row.slug, row]));
  const activeSet = new Set(
    (Array.isArray(input.activeSlugs) ? input.activeSlugs : []).filter((slug) => typeof slug === "string" && slug)
  );
  const consumed = [];
  for (const sighting of sightings) {
    if (!activeSet.has(sighting.slug)) continue;
    const row = {
      slug: sighting.slug,
      embryoAt: sighting.at,
      embryoSessionId: sighting.sessionId,
      ignitedMs: now
    };
    if (Array.isArray(sighting.requires)) {
      row.requires = sighting.requires.map((item) => ({ slug: item.slug, state: item.state }));
    }
    lineageBySlug.set(sighting.slug, row);
    consumed.push(sighting.slug);
  }
  if (consumed.length > 0) {
    const consumedSet = new Set(consumed);
    sightings = sightings.filter((row) => !consumedSet.has(row.slug));
  }
  /* 上限淘汰 + 码点序输出（内存态与落盘态同形 → 签名比较与序列化均确定性）。 */
  lineages = capLineages([...lineageBySlug.values()]).sort((a, b) => compareText(a.slug, b.slug));
  sightings = capSightings(sightings).sort((a, b) => compareText(a.slug, b.slug));

  /* 3) 装配更新后的整份文档（空节不保留 → 存储零噪声）。 */
  const workspaces = { ...wsSrc };
  if (lineages.length === 0 && sightings.length === 0) delete workspaces[path];
  else workspaces[path] = { lineages, sightings };
  const next = { version: BIRTHLINE_VERSION, workspaces };
  const lineagesChanged = lineageSignature(lineages) !== beforeLineages;
  const changed = lineagesChanged || sightingSignature(sightings) !== beforeSightings;
  return { doc: next, changed, lineagesChanged, lineages, sightings };
}

/** sighting 上限淘汰（按 seenAt 最旧；同刻 slug 码点序兜底 → 确定性）。 */
function capSightings(rows) {
  if (rows.length <= SIGHTING_LIMIT) return rows;
  const sorted = [...rows].sort((a, b) => a.seenAt - b.seenAt || compareText(a.slug, b.slug));
  return sorted.slice(sorted.length - SIGHTING_LIMIT);
}

/** 台账行上限淘汰（按 ignitedMs 最旧；同刻 slug 码点序兜底 → 确定性）。 */
function capLineages(rows) {
  if (rows.length <= BIRTHLINE_LIMIT) return rows;
  const sorted = [...rows].sort((a, b) => a.ignitedMs - b.ignitedMs || compareText(a.slug, b.slug));
  return sorted.slice(sorted.length - BIRTHLINE_LIMIT);
}
