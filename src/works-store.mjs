/**
 * dsh-v-cosmos — 星座作品（快捷入口）的存储层（p1-add-cosmos-works-service 1.1–1.3）。
 *
 * 纯逻辑 + 单文件持久化（queue-store 同族第四件）：
 *  - 文档形状 `{ version: 1, works: { <wsId>: { entries: [...] } } }`；
 *  - 条目形状 `{ id, wsId, relPath, kind, addedAt, lastLaunchedAt?, name?, note? }`：
 *      `relPath` = 工作区**相对路径**（统一正斜杠；存相对路径使工作区同机迁移后条目仍可
 *      按新注册根解析——design D2）；`kind` 由扩展名映射（design D4 执行白名单的**唯一**
 *      判据来源：`exe/bat/cmd → exec`，其余一律非 exec）；`name`/`note` 为存储最小形
 *      （仅设置时输出，缺席键 = 回落文件名/无备注——`buttons.mjs` 同口径，design D8）。
 *
 * 净房 = **纯形态校验**：`name`/`note` trim 后空串按未设置处理（键删除），SHALL NOT 抛错；
 * `relPath` 写入面归一化（反斜杠 → `/`、`./` 段消去）后必须为工作区根内相对路径，含 `..`
 * 段、绝对/盘符路径一律拒绝；**读面**只做读取归一（`readRelPathOf`：越界形态原样保留），
 * 由端点 `resolve` 包含性裁决 fail-closed 返回 `out-of-root`（手工改库的逃逸条目不会被
 * 静默吞成 `entry-unknown`）。**存在性/符号链接/包含性不在本模块**——那是端点与文件系统
 * 的裁决（本模块只认形态，故可在无盘环境下完整单测）。
 *
 * 批量登记**整批原子**（design D7）：任一条非法（形态/重复/超上限/`checkFile` 注入的磁盘
 * 裁决）即整批拒绝，返回首个错误的结构化 reason，文档零变化。
 *
 * 原子写：temp 写（`.<uuid>.tmp`）+ `fsync` + `rename` 替换（队列/关联存储同款）；
 * 读面容错：文件缺失/损坏/版本漂移 → 空文档（首写即建，无迁移）。
 * 零浏览器半区依赖：本模块只 import node 内建，宿主半区与冒烟测试共享（双半区可 import）。
 */

import { randomUUID } from "node:crypto";
import { closeSync, fdatasyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** 作品文档版本（首版；版本漂移按空文档重建）。 */
export const WORKS_VERSION = 1;
/** 每星座条目上限（spec「每星座条目上限 32 条」）。 */
export const WORKS_LIMIT = 32;
/** 条目类型枚举（`kind` 全量取值）。 */
export const WORKS_KINDS = Object.freeze(["exec", "html", "md", "pdf", "other"]);
/** 可执行白名单扩展名（design D4：**仅**这三类走后台运行，ps1 明确排除）。 */
export const WORKS_EXEC_EXTENSIONS = Object.freeze(["exe", "bat", "cmd"]);
/** 错误 reason 枚举（端点透传；本模块只产出形态/重复/上限相关子集）。 */
export const WORKS_REASONS = Object.freeze([
  "invalid",
  "duplicate",
  "limit",
  "out-of-root",
  "not-a-file",
  "missing-on-disk",
  "symlink"
]);

const EXEC_EXTENSIONS = new Set(WORKS_EXEC_EXTENSIONS);

/**
 * 作品存储文件路径（`$DSH_HOME/storages/dsh-v-cosmos.works.json`）：
 * 目录与关联/队列/谱系存储同级（`storages/`），文件名带插件前缀避免与他插件撞名。
 * @param {{env?: Record<string, string|undefined>, home?: string}} [options]
 * @returns {string}
 */
export function resolveWorksStorePath(options = {}) {
  const env = options.env ?? process.env;
  const envHome = typeof env.DSH_HOME === "string" ? env.DSH_HOME.trim() : "";
  const home = options.home ?? (envHome || join(homedir(), ".dsh"));
  return join(home, "storages", "dsh-v-cosmos.works.json");
}

/** 空文档。 */
export function emptyWorksDoc() {
  return { version: WORKS_VERSION, works: {} };
}

/**
 * 扩展名（小写，不含点；无扩展名 → ""）。
 * @param {unknown} relPath
 * @returns {string}
 */
export function extensionOf(relPath) {
  const text = typeof relPath === "string" ? relPath : "";
  const name = text.slice(text.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * 文件名部分（`relPath` 已归一为 `/`；无分隔符 → 原串）。
 * @param {unknown} relPath
 * @returns {string}
 */
export function baseNameOf(relPath) {
  const text = typeof relPath === "string" ? relPath : "";
  return text.slice(text.lastIndexOf("/") + 1);
}

/**
 * 扩展名 → `kind` 映射（spec「作品存储」；大小写不敏感，无扩展名 → `other`）。
 * `exec` 是**执行白名单**的唯一来源（design D4）：清单外的任何扩展名都不进入执行面。
 * @param {unknown} relPath
 * @returns {"exec"|"html"|"md"|"pdf"|"other"}
 */
export function kindOf(relPath) {
  const ext = extensionOf(relPath);
  if (EXEC_EXTENSIONS.has(ext)) return "exec";
  if (ext === "html") return "html";
  if (ext === "md") return "md";
  if (ext === "pdf") return "pdf";
  return "other";
}

/**
 * `relPath` 归一/净房（**纯形态**，不触碰文件系统）：
 *  - 反斜杠归一为 `/`、空段与 `./` 段消去（`tools\build.bat` / `./tools//build.bat` → 接受）；
 *  - 含 `..` 段 → `out-of-root`（`tools\..\tools\build.bat` 被拒，spec 净房场景）；
 *  - 绝对路径 / 盘符路径 / UNC（`/x`、`C:/x`、`//host/share`）→ `out-of-root`；
 *  - 非字符串 / 空白 / 空 NUL 等不可用形态 → `invalid`。
 * @param {unknown} raw
 * @returns {{ok: true, relPath: string} | {ok: false, reason: string}}
 */
export function normalizeRelPath(raw) {
  if (typeof raw !== "string") return { ok: false, reason: "invalid" };
  const text = raw.trim();
  if (!text || text.includes("\u0000")) return { ok: false, reason: "invalid" };
  /* 盘符（`C:` / `C:/x`）与绝对路径（`/x` / `\x` / UNC）在归一前判定：
     归一后再判会丢掉「本来就是绝对路径」的语义。 */
  if (/^[A-Za-z]:/.test(text)) return { ok: false, reason: "out-of-root" };
  const value = text.replace(/\\/g, "/");
  if (value.startsWith("/")) return { ok: false, reason: "out-of-root" };
  const segments = [];
  for (const segment of value.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") return { ok: false, reason: "out-of-root" };
    segments.push(segment);
  }
  if (segments.length === 0) return { ok: false, reason: "invalid" };
  return { ok: true, relPath: segments.join("/") };
}

/**
 * 读面容错用 `relPath` 读取（**不净房**）：只归一反斜杠与 `.`/空段，`..` 段与绝对形态
 * **原样保留**——手工改库的逃逸路径必须活到端点，由 `resolve` 包含性裁决返回
 * `out-of-root`（spec「越界与缺文件守卫」）；读面擅自丢弃条目会把安全拒绝降级成
 * `entry-unknown`（丢失可诊断语义）。
 * 写入面（`add`）仍必须严格净房（`normalizeRelPath`，spec「路径段含 `..` MUST 拒绝」）。
 * @param {unknown} raw
 * @returns {string} 归一后的相对路径形态（不可用 → ""）
 */
export function readRelPathOf(raw) {
  if (typeof raw !== "string") return "";
  const text = raw.trim();
  if (!text || text.includes("\u0000")) return "";
  const value = text.replace(/\\/g, "/");
  const segments = [];
  for (const segment of value.split("/")) {
    if (segment === "" || segment === ".") continue;
    segments.push(segment);
  }
  if (segments.length === 0) return "";
  /* 绝对形态保留（含盘符与 UNC）：端点 `resolve` 后必然越界 → out-of-root。 */
  if (/^[A-Za-z]:/.test(value)) return segments.join("/");
  if (value.startsWith("/")) return "/" + segments.join("/");
  return segments.join("/");
}

/**
 * 条目归一化（读面容错）：形状非法 → null（该条丢弃，不波及其余）。
 * `kind` 恒由 `relPath` 重算（扩展名是唯一权威，手工改库的 `kind` 不会扩大执行面）。
 * `relPath` 只做读取归一（见 `readRelPathOf`）：越界形态留待端点裁决。
 * @param {unknown} raw
 * @returns {object|null}
 */
export function normalizeWorkEntry(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const wsId = typeof raw.wsId === "string" ? raw.wsId.trim() : "";
  if (!id || !wsId) return null;
  const relPath = readRelPathOf(raw.relPath);
  if (!relPath) return null;
  const addedAt = Number.isFinite(Number(raw.addedAt)) && Number(raw.addedAt) > 0 ? Number(raw.addedAt) : 0;
  const entry = { id, wsId, relPath, kind: kindOf(relPath), addedAt };
  if (Number.isFinite(Number(raw.lastLaunchedAt)) && Number(raw.lastLaunchedAt) > 0) {
    entry.lastLaunchedAt = Number(raw.lastLaunchedAt);
  }
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (name) entry.name = name;
  const note = typeof raw.note === "string" ? raw.note.trim() : "";
  if (note) entry.note = note;
  return entry;
}

/**
 * 星座作品容器归一化：脏条目丢弃；同 `id` 与同归一化 `relPath` 先到先得去重。
 * @param {unknown} raw
 * @returns {{entries: Array<object>}}
 */
export function normalizeWorks(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const ids = new Set();
  const paths = new Set();
  const entries = [];
  for (const item of Array.isArray(source.entries) ? source.entries : []) {
    const entry = normalizeWorkEntry(item);
    if (entry === null || ids.has(entry.id) || paths.has(entry.relPath)) continue;
    ids.add(entry.id);
    paths.add(entry.relPath);
    entries.push(entry);
  }
  return { entries };
}

/**
 * 文档归一化（版本漂移/损坏 → 空文档）；空星座容器键不建档（存储最小形）。
 * @param {unknown} raw
 * @returns {{version: number, works: Record<string, {entries: Array<object>}>}}
 */
export function normalizeWorksDoc(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyWorksDoc();
  if (raw.version !== WORKS_VERSION) return emptyWorksDoc();
  const works = {};
  const source = raw.works && typeof raw.works === "object" && !Array.isArray(raw.works) ? raw.works : {};
  for (const [wsId, value] of Object.entries(source)) {
    const id = typeof wsId === "string" ? wsId.trim() : "";
    if (!id) continue;
    const container = normalizeWorks(value);
    if (container.entries.length === 0) continue;
    works[id] = container;
  }
  return { version: WORKS_VERSION, works };
}

/** 某星座容器（缺席 → 空容器；**不做持久化**）。 */
export function worksOf(doc, wsId) {
  const id = typeof wsId === "string" ? wsId.trim() : "";
  const container = id ? doc?.works?.[id] : undefined;
  return container ?? { entries: [] };
}

/** 条目查找。 */
export function findWork(doc, wsId, workId) {
  const id = typeof workId === "string" ? workId : "";
  return worksOf(doc, wsId).entries.find((entry) => entry.id === id) ?? null;
}

/** 写入收口：容器为空 → 回收 wsId 键（存储最小形，spec「清空星座回收容器键」）。 */
function withEntries(doc, wsId, entries) {
  const works = { ...(doc?.works ?? {}) };
  if (entries.length === 0) {
    delete works[wsId];
  } else {
    works[wsId] = { entries };
  }
  return { version: WORKS_VERSION, works };
}

/**
 * 批量登记（**整批原子**，design D7）：形态净房 → 批内/在册去重 → 上限 → 磁盘裁决（注入）。
 * 任一条失败即整批拒绝，`doc` 原样返回（零变化）。
 *
 * @param {object} doc
 * @param {{wsId: string, relPaths: string[]|string, now?: number, idFactory?: () => string,
 *          checkFile?: (relPath: string) => ({ok: true}|{ok: false, reason: string})}} input
 * @returns {{ok: true, doc: object, entries: Array<object>} |
 *          {ok: false, doc: object, reason: string, relPath?: string}}
 *          reason 枚举：invalid / duplicate / limit / out-of-root / not-a-file / missing-on-disk / symlink
 */
export function addWorkEntries(doc, input) {
  const wsId = typeof input?.wsId === "string" ? input.wsId.trim() : "";
  if (!wsId) return { ok: false, doc, reason: "invalid" };
  const raw = input?.relPaths;
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : null;
  if (!list || list.length === 0) return { ok: false, doc, reason: "invalid" };
  const container = worksOf(doc, wsId);
  const known = new Set(container.entries.map((entry) => entry.relPath));
  const normalized = [];
  for (const item of list) {
    const parsed = normalizeRelPath(item);
    if (parsed.ok !== true) {
      return { ok: false, doc, reason: parsed.reason, relPath: typeof item === "string" ? item : "" };
    }
    if (known.has(parsed.relPath)) {
      return { ok: false, doc, reason: "duplicate", relPath: parsed.relPath };
    }
    known.add(parsed.relPath); // 批内后续同路径同样命中 duplicate（批内 + 在册共用一张已见表）
    normalized.push(parsed.relPath);
  }
  if (container.entries.length + normalized.length > WORKS_LIMIT) {
    return { ok: false, doc, reason: "limit" };
  }
  /* 磁盘裁决（包含性/符号链接/文件类型）由调用方注入：本模块保持纯形态，
     裁决失败同样**整批**拒绝（第 N 条非法 ⇒ 前 N-1 条也不落盘）。 */
  const checkFile = typeof input?.checkFile === "function" ? input.checkFile : null;
  if (checkFile !== null) {
    for (const relPath of normalized) {
      let verdict;
      try {
        verdict = checkFile(relPath);
      } catch {
        verdict = { ok: false, reason: "not-a-file" };
      }
      if (verdict?.ok !== true) {
        const reason = typeof verdict?.reason === "string" && verdict.reason ? verdict.reason : "not-a-file";
        return { ok: false, doc, reason, relPath };
      }
    }
  }
  const now = Number.isFinite(Number(input?.now)) ? Number(input.now) : Date.now();
  const idFactory = typeof input?.idFactory === "function" ? input.idFactory : () => "w_" + randomUUID();
  const created = normalized.map((relPath) => ({
    id: String(idFactory()),
    wsId,
    relPath,
    kind: kindOf(relPath),
    addedAt: now
  }));
  return { ok: true, doc: withEntries(doc, wsId, [...container.entries, ...created]), entries: created };
}

/**
 * 显示名/备注写入（**存储最小形**，design D8）：trim 后空串/缺席/非字符串 = 清除键
 * （spec「改名回落文件名」；端点 update 语义「缺席/空白串 = 清除」）。
 * @param {object} target
 * @param {"name"|"note"} key
 * @param {unknown} value
 */
function applyOptionalText(target, key, value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text) {
    target[key] = text;
  } else {
    delete target[key];
  }
}

/**
 * 改名/备注覆盖（`name`/`note` **全额覆盖**：缺席或空白 = 清除回落，spec 端点语义）。
 * `relPath/kind/addedAt/lastLaunchedAt` 逐字节不变。
 *
 * @param {object} doc
 * @param {{wsId: string, workId: string, name?: string, note?: string}} input
 * @returns {{ok: true, doc: object, entry: object} | {ok: false, doc: object, reason: string}}
 */
export function updateWorkEntry(doc, input) {
  const wsId = typeof input?.wsId === "string" ? input.wsId.trim() : "";
  const workId = typeof input?.workId === "string" ? input.workId : "";
  if (!wsId || !workId) return { ok: false, doc, reason: "invalid" };
  const container = worksOf(doc, wsId);
  const index = container.entries.findIndex((entry) => entry.id === workId);
  if (index < 0) return { ok: false, doc, reason: "entry-unknown" };
  const next = { ...container.entries[index] };
  applyOptionalText(next, "name", input?.name);
  applyOptionalText(next, "note", input?.note);
  const entries = [...container.entries];
  entries[index] = next;
  return { ok: true, doc: withEntries(doc, wsId, entries), entry: next };
}

/**
 * 移除条目（**只删条目不触碰文件系统**）；清空后回收容器键。
 * @param {object} doc
 * @param {{wsId: string, workId: string}} input
 * @returns {{ok: true, doc: object, removed: object} | {ok: false, doc: object, reason: string}}
 */
export function removeWorkEntry(doc, input) {
  const wsId = typeof input?.wsId === "string" ? input.wsId.trim() : "";
  const workId = typeof input?.workId === "string" ? input.workId : "";
  if (!wsId || !workId) return { ok: false, doc, reason: "invalid" };
  const container = worksOf(doc, wsId);
  const removed = container.entries.find((entry) => entry.id === workId);
  if (!removed) return { ok: false, doc, reason: "entry-unknown" };
  const entries = container.entries.filter((entry) => entry.id !== workId);
  return { ok: true, doc: withEntries(doc, wsId, entries), removed };
}

/**
 * 启动记账（`lastLaunchedAt`；open 成功后的唯一文档变更）。
 * @param {object} doc
 * @param {{wsId: string, workId: string, now?: number}} input
 * @returns {{ok: true, doc: object, entry: object} | {ok: false, doc: object, reason: string}}
 */
export function touchLaunched(doc, input) {
  const wsId = typeof input?.wsId === "string" ? input.wsId.trim() : "";
  const workId = typeof input?.workId === "string" ? input.workId : "";
  if (!wsId || !workId) return { ok: false, doc, reason: "invalid" };
  const container = worksOf(doc, wsId);
  const index = container.entries.findIndex((entry) => entry.id === workId);
  if (index < 0) return { ok: false, doc, reason: "entry-unknown" };
  const now = Number.isFinite(Number(input?.now)) ? Number(input.now) : Date.now();
  const entry = { ...container.entries[index], lastLaunchedAt: now };
  const entries = [...container.entries];
  entries[index] = entry;
  return { ok: true, doc: withEntries(doc, wsId, entries), entry };
}

/**
 * 条目对外投影：存储最小形 + 服务端追加 `displayName`（`name` 缺席 → `relPath` 文件名）
 * 与 `exists`（文件仍存在；由调用方注入判定，端点用 `fs.statSync`）。
 * @param {object} entry
 * @param {boolean} [exists]
 * @returns {object}
 */
export function publicWorkOf(entry, exists = false) {
  const out = {
    id: entry.id,
    wsId: entry.wsId,
    relPath: entry.relPath,
    kind: entry.kind,
    addedAt: entry.addedAt
  };
  if (entry.lastLaunchedAt !== undefined) out.lastLaunchedAt = entry.lastLaunchedAt;
  if (entry.name !== undefined) out.name = entry.name;
  if (entry.note !== undefined) out.note = entry.note;
  out.displayName = entry.name ?? baseNameOf(entry.relPath);
  out.exists = exists === true;
  return out;
}

/**
 * 全量/单星座快照（`GET /works`）：缺席星座 → 空 entries（SHALL NOT 报错）。
 * `knownOf` 用于「工作区不在册 → 空 entries」的规范语义（spec「空星座快照」）：
 * 注册表里已消失的星座即使存储残留条目也不投影内容（只报空，不报错）。
 * @param {object} doc
 * @param {{wsId?: string, existsOf?: (wsId: string, entry: object) => boolean,
 *          knownOf?: (wsId: string) => boolean}} [options]
 * @returns {{version: number, works: Record<string, {entries: Array<object>}>}}
 */
export function publicWorksSnapshotOf(doc, options = {}) {
  const wsId = typeof options?.wsId === "string" ? options.wsId.trim() : "";
  const existsOf = typeof options?.existsOf === "function" ? options.existsOf : null;
  const knownOf = typeof options?.knownOf === "function" ? options.knownOf : null;
  const all = doc?.works ?? {};
  const emptyContainer = { entries: [] };
  const source = wsId
    ? { [wsId]: knownOf !== null && knownOf(wsId) === false ? emptyContainer : all[wsId] ?? emptyContainer }
    : all;
  const works = {};
  for (const [id, container] of Object.entries(source)) {
    works[id] = {
      entries: container.entries.map((entry) => publicWorkOf(entry, existsOf ? existsOf(id, entry) === true : false))
    };
  }
  return { version: WORKS_VERSION, works };
}

/**
 * 原子写（temp + fsync + rename；rename 失败清理临时文件并抛出）。
 * @param {string} path
 * @param {string} text
 */
export function writeWorksDocAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(dirname(path), "." + randomUUID() + ".tmp");
  const fd = openSync(tmp, "w");
  try {
    writeSync(fd, text, 0, "utf8");
    try {
      fdatasyncSync(fd);
    } catch {
      /* 平台不支持时跳过（rename 已保证替换原子性） */
    }
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, path);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw error;
  }
}

/**
 * 建立作品存储句柄（内存态即全量；落盘 = 原子写整文档）。
 *
 * @param {object} [options]
 * @param {string} [options.filePath] 存储路径（缺省 `resolveWorksStorePath()`）
 * @param {() => number} [options.now] 时钟（测试注入）
 * @param {() => string} [options.idFactory] 条目 id 生成（测试注入）
 * @param {(path: string, text: string) => void} [options.write] 落盘（测试注入）
 * @param {(path: string) => string|null} [options.read] 读盘（测试注入）
 * @param {{warn?: Function}|null} [options.logger]
 * @returns {object} 句柄
 */
export function createWorksStore(options = {}) {
  const filePath = typeof options.filePath === "string" && options.filePath ? options.filePath : resolveWorksStorePath(options);
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const idFactory = typeof options.idFactory === "function" ? options.idFactory : () => "w_" + randomUUID();
  const write = typeof options.write === "function" ? options.write : writeWorksDocAtomic;
  const read = typeof options.read === "function"
    ? options.read
    : (path) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    };
  const logger = options.logger ?? null;
  let doc = emptyWorksDoc();
  let revisedAt = 0;

  /** 装载（文件缺失/损坏/版本漂移 → 空文档）。 */
  function load() {
    const text = read(filePath);
    if (typeof text === "string" && text) {
      try {
        doc = normalizeWorksDoc(JSON.parse(text));
      } catch {
        doc = emptyWorksDoc();
        logger?.warn?.("[dsh-v-cosmos] 作品存储损坏，按空作品表重建");
      }
    } else {
      doc = emptyWorksDoc();
    }
    revisedAt = now();
    return doc;
  }

  /** 落盘（写失败只告警：内存态权威，投影不中断）。 */
  function save() {
    try {
      write(filePath, JSON.stringify(doc, null, 2) + "\n");
      revisedAt = now();
      return true;
    } catch (error) {
      logger?.warn?.("[dsh-v-cosmos] 作品存储落盘失败: %s", String(error?.message || error));
      return false;
    }
  }

  /** 统一写入收口：成功才落盘。 */
  function commit(result) {
    if (result?.ok === true && result.doc !== doc) {
      doc = result.doc;
      save();
    }
    return result;
  }

  return {
    filePath,
    load,
    save,
    get doc() {
      return doc;
    },
    get revisedAt() {
      return revisedAt;
    },
    snapshot: (snapshotOptions = {}) => publicWorksSnapshotOf(doc, snapshotOptions),
    works: (wsId) => worksOf(doc, wsId),
    find: (wsId, workId) => findWork(doc, wsId, workId),
    add(input) {
      return commit(addWorkEntries(doc, { ...input, idFactory: input?.idFactory ?? idFactory, now: input?.now ?? now() }));
    },
    update(input) {
      return commit(updateWorkEntry(doc, input));
    },
    remove(input) {
      return commit(removeWorkEntry(doc, input));
    },
    touch(input) {
      return commit(touchLaunched(doc, { ...input, now: input?.now ?? now() }));
    }
  };
}
