/**
 * 插件自营共享配置存储（add-cosmos-proposal-actions 2.1 / spec cosmos-button-settings
 * 「按钮配置共享存储」）。
 *
 * 移植自 dsh-v-skill-links 的共享配置存储（同作者、同实测口径），节集合为两条
 * **互不读写**的列表节：
 *  - `buttons`：提案动作按钮（add-cosmos-proposal-actions，`normalizeButtons`）；
 *  - `constellationButtons`：星座动作按钮（add-cosmos-constellation-actions，
 *    `normalizeConstButtons`）。
 * 两节同文件、各自独立覆盖/重置，任一节缺失即回落该节的组合层 base。
 *  - 文件：`<DSH_HOME>/dsh-v-cosmos.config.json`（`$DSH_HOME` 解析与宿主一致：
 *    env 去空白非空优先，`~` 展开，否则 `~/.dsh`）；
 *  - 文件形状：`{ revision: <从 1 起单调递增>, buttons?: [...],
 *    constellationButtons?: [...], migratedFrom? }`；
 *    节**缺席** = 未自定义（回落组合层 base），节**存在**（含空数组）= 显式覆盖；
 *  - 写路径 = 跨进程锁内 CAS + 复制式备份轮转（`.bak.1~3`）+ 临时文件原子替换；
 *    锁等待约 1s 超时 `busy`（HTTP 503）；
 *  - 读路径 = 正式文件 → `.bak.1/2/3` 依次恢复 → 按「存储缺席」回落组合层；
 *  - `fs.watch` 热重载（watch 不可用回落 mtime+size 轮询）。
 *  - **与关联存储（`$DSH_HOME/storages/dsh-v-cosmos.json`）完全独立**：本模块只触碰
 *    `<DSH_HOME>/dsh-v-cosmos.config.json*`，互不读写对方数据。
 *
 * 全部外部依赖（fs / 时钟 / 睡眠 / 日志）可注入，冒烟测试用临时目录 + 假时钟直测
 * 锁语义、CAS、复制式轮转与独占播种（test/configstore-smoke.mjs）。
 */

import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync, watch as fsWatch } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve as pathResolve } from "node:path";
import { normalizeButtons } from "./buttons.mjs";
import { normalizeConstButtons } from "./const-buttons.mjs";

/** 共享存储文件名（`<DSH_HOME>/` 之下）。 */
export const CONFIG_STORE_BASENAME = "dsh-v-cosmos.config.json";
/** 共享存储的节名（顺序即快照字段顺序；两节互不读写）。 */
export const CONFIG_STORE_SECTIONS = ["buttons", "constellationButtons"];
/** 保留的备份份数（`.bak.1` = 上一次写入前内容）。 */
const STORE_BACKUP_COUNT = 3;
/** 锁文件判陈旧阈值：超过即接管重建（进程中途被杀的残留锁自愈）。 */
const STORE_LOCK_STALE_MS = 5_000;
/** 锁等待上限与步进：超时以 503 busy 拒绝，存储保持不变。 */
const STORE_LOCK_WAIT_MS = 1_000;
const STORE_LOCK_STEP_MS = 10;
/** rename 覆盖的退避表（Windows 上另一进程持读句柄时 EPERM 可持续数百毫秒）。 */
const STORE_RENAME_BACKOFF_MS = [20, 40, 80, 120, 150];
/** 单文件监视去抖（Windows 上一次 rename 会连发 2-3 个事件）。 */
const STORE_WATCH_DEBOUNCE_MS = 100;
/** watch 不可用时的轮询间隔（mtime+size 变化即视为变更）。 */
const STORE_WATCH_POLL_MS = 2_000;

/**
 * 解析宿主 home（与宿主 `dsh-home-paths` 同优先级语义）：`env.DSH_HOME` 去空白后非空 →
 * 用之（`~` 前缀按 homedir 展开、再归一为绝对路径），否则 `~/.dsh`。
 * @param {Record<string, string|undefined>} [env]
 * @param {string} [home]
 * @returns {string}
 */
export function resolveDshHome(env = process.env, home = homedir()) {
  const raw = typeof env?.DSH_HOME === "string" ? env.DSH_HOME.trim() : "";
  if (!raw) return pathResolve(join(home, ".dsh"));
  if (raw === "~") return pathResolve(home);
  if (raw.startsWith("~/") || raw.startsWith("~\\")) return pathResolve(join(home, raw.slice(2)));
  return pathResolve(raw);
}

/**
 * 共享存储的绝对路径（`<DSH_HOME>/dsh-v-cosmos.config.json`）。
 * @param {{env?: Record<string, string|undefined>, home?: string}} [options]
 * @returns {string}
 */
export function resolveConfigStorePath(options = {}) {
  const home = resolveDshHome(options.env ?? process.env, options.home ?? homedir());
  return join(home, CONFIG_STORE_BASENAME);
}

/** 共享存储语义错误：code ∈ conflict（409）/ invalid（400）/ busy（503）/ io（500）。 */
export class ConfigStoreError extends Error {
  /**
   * @param {"conflict"|"invalid"|"busy"|"io"} code
   * @param {string} message
   * @param {{revision?: number}} [extra] conflict 时携带服务端当前 revision
   */
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "ConfigStoreError";
    this.code = code;
    if (typeof extra.revision === "number") this.revision = extra.revision;
  }
}

/** 节归一化器表（两节：提案动作 buttons / 星座动作 constellationButtons；各自独立口径）。 */
const SECTION_NORMALIZERS = {
  buttons: (raw) => normalizeButtons(raw),
  constellationButtons: (raw) => normalizeConstButtons(raw)
};

/**
 * 节**读面**归一化器表（add-cosmos-action-prestate-gate 4.1；add-cosmos-shortcuts 起
 * 同步容忍 `shortcut` 漂移）：与写路径同口径，但 `preState` 手工编辑漂移（枚举外字符串）
 * 与 `shortcut` 池外字符串**原样保留**——设置页据 value 原样回显「不可用」并在保存时拒绝
 * （写路径仍走严格表）。其余非法形状照旧丢弃该节。
 */
const SECTION_READ_NORMALIZERS = {
  buttons: (raw) => normalizeButtons(raw, { tolerateUnknownPreState: true, tolerateUnknownShortcut: true }),
  constellationButtons: (raw) => normalizeConstButtons(raw, { tolerateUnknownShortcut: true })
};

/** 归一化失败的兜底（组合层来源非法时不让插件激活失败）。 */
function safeNormalize(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/**
 * 把一节任意来源的输入归一化为**完整组合层视图**（两节齐备）。
 * 缺节 → 空数组；节级非法 → 按空处理（写入校验另有拦截）。
 * @param {unknown} raw 补丁层 entry config 或 settingsScope 解析值
 * @param {{tolerateUnknownPreState?: boolean}} [options] 读面容错（快照专用：
 *        `preState` / `shortcut` 漂移值原样保留，供设置页回显；seed/upgrade 等写路径恒严格）
 * @returns {{buttons: Array<object>, constellationButtons: Array<object>}}
 */
export function normalizeView(raw, options = {}) {
  const source = raw !== null && typeof raw === "object" ? raw : {};
  const table = options?.tolerateUnknownPreState === true ? SECTION_READ_NORMALIZERS : SECTION_NORMALIZERS;
  return {
    buttons: safeNormalize(() => table.buttons(source.buttons), []),
    constellationButtons: safeNormalize(() => table.constellationButtons(source.constellationButtons), [])
  };
}

/**
 * 生效值 = 组合层 base ← 存储节逐节覆盖（节缺席回落 base）。
 * @param {{buttons: Array<object>, constellationButtons: Array<object>}} base 已归一化视图
 * @param {object|null} sections 存储节（storeSectionsOf 的输出）
 * @returns {{buttons: Array<object>, constellationButtons: Array<object>}}
 */
export function mergeView(base, sections) {
  const out = {
    buttons: Array.isArray(base?.buttons) ? base.buttons : [],
    constellationButtons: Array.isArray(base?.constellationButtons) ? base.constellationButtons : []
  };
  if (sections !== null && typeof sections === "object") {
    for (const key of CONFIG_STORE_SECTIONS) {
      if (Array.isArray(sections[key])) out[key] = sections[key];
    }
  }
  return out;
}

/**
 * 提取存储文件里的「用户层节」：无任何节 → null（快照 `user: null`，UI 不显示覆盖标记）。
 * @param {object|null} doc
 * @returns {object|null}
 */
export function storeSectionsOf(doc) {
  if (doc === null || typeof doc !== "object") return null;
  const out = {};
  let any = false;
  for (const key of CONFIG_STORE_SECTIONS) {
    if (Array.isArray(doc[key])) {
      out[key] = doc[key];
      any = true;
    }
  }
  return any ? out : null;
}

/**
 * 装载期校验：结构非法（非对象 / revision 非正整数）→ null（按损坏处理，走恢复链）；
 * 节级非法 → 丢弃该节（回落 base，不整体判损）。`preState` 漂移值按读面容错原样保留
 * （设置页回显「不可用」；保存时严格校验拒绝）。
 * @param {unknown} raw
 * @returns {{revision: number, buttons?: Array, constellationButtons?: Array, migratedFrom?: string}|null}
 */
export function sanitizeStoreDocument(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const revision = Number.isInteger(raw.revision) && raw.revision > 0 ? raw.revision : null;
  if (revision === null) return null;
  const doc = { revision };
  for (const key of CONFIG_STORE_SECTIONS) {
    if (raw[key] === undefined) continue;
    try {
      doc[key] = SECTION_READ_NORMALIZERS[key](raw[key]);
    } catch {
      /* 节级非法：丢弃该节（该节回落组合层），不把整份文件判损 */
    }
  }
  if (typeof raw.migratedFrom === "string" && raw.migratedFrom) doc.migratedFrom = raw.migratedFrom;
  return doc;
}

/** 告警一次性闩：同一 key 只告警一次，成功路径可清除。 */
function createWarnOnce(logger) {
  const seen = new Set();
  return {
    warn(key, message) {
      if (seen.has(key)) return;
      seen.add(key);
      logger?.warn?.(message);
    },
    clear(key) {
      seen.delete(key);
    }
  };
}

/**
 * 共享配置存储。
 * @param {object} [options]
 * @param {string} [options.filePath] 存储文件绝对路径（缺省 `<DSH_HOME>/dsh-v-cosmos.config.json`）
 * @param {string} [options.home] `~` 展开基准
 * @param {() => number} [options.now] 时钟（测试注入）
 * @param {(ms: number) => Promise<void>} [options.sleep] 等待原语（测试注入）
 * @param {number} [options.lockWaitMs] / [options.lockStepMs] / [options.lockStaleMs]
 * @param {number[]} [options.renameBackoffMs]
 * @param {number} [options.backupCount]
 * @param {number} [options.watchDebounceMs] / [options.watchPollMs]
 * @param {{warn?: Function}} [options.logger]
 * @param {(info: {filePath: string, tmpPath: string, doc: object}) => void} [options.onBeforeReplace] 测试钩子
 * @returns {object} 存储面（refresh/snapshot/seed/upgrade/ensureSeeded/writeSections/watch）
 */
export function createConfigStore(options = {}) {
  const filePath = options.filePath ?? resolveConfigStorePath();
  const home = options.home ?? homedir();
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const sleep = typeof options.sleep === "function" ? options.sleep : (ms) => new Promise((done) => setTimeout(done, ms));
  const lockWaitMs = Number.isFinite(options.lockWaitMs) ? options.lockWaitMs : STORE_LOCK_WAIT_MS;
  const lockStepMs = Number.isFinite(options.lockStepMs) ? options.lockStepMs : STORE_LOCK_STEP_MS;
  const lockStaleMs = Number.isFinite(options.lockStaleMs) ? options.lockStaleMs : STORE_LOCK_STALE_MS;
  const renameBackoffMs = Array.isArray(options.renameBackoffMs) && options.renameBackoffMs.length > 0
    ? [...options.renameBackoffMs] : [...STORE_RENAME_BACKOFF_MS];
  const backupCount = Number.isInteger(options.backupCount) && options.backupCount > 0 ? options.backupCount : STORE_BACKUP_COUNT;
  const watchDebounceMs = Number.isFinite(options.watchDebounceMs) ? options.watchDebounceMs : STORE_WATCH_DEBOUNCE_MS;
  const watchPollMs = Number.isFinite(options.watchPollMs) ? options.watchPollMs : STORE_WATCH_POLL_MS;
  const warnOnce = createWarnOnce(options.logger ?? null);
  const onBeforeReplace = typeof options.onBeforeReplace === "function" ? options.onBeforeReplace : null;

  const lockPath = `${filePath}.lock`;
  const tmpPath = `${filePath}.tmp`;
  /** 当前装载到的文档（null = 存储缺席：播种前 / 全损回落）。 */
  let state = null;

  const backupPath = (index) => `${filePath}.bak.${index}`;

  /**
   * 读一个候选文件。正式文件被 rename 原子替换后不该出现缺席窗口，此处仍对瞬时
   * ENOENT 重试一次作兜底。
   * @returns {string|null}
   */
  function readStoreText(path) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return readFileSync(path, "utf8");
      } catch (error) {
        if (error?.code !== "ENOENT" || attempt === 1) return null;
      }
    }
    return null;
  }

  /**
   * 装载：正式文件 → `.bak.1/2/3` 依次恢复；全败按「存储缺席」处理（恰告警一次）。
   * @returns {object|null}
   */
  function loadDocument() {
    let damaged = false;
    const candidates = [filePath];
    for (let index = 1; index <= backupCount; index += 1) candidates.push(backupPath(index));
    for (let index = 0; index < candidates.length; index += 1) {
      const text = readStoreText(candidates[index]);
      if (text === null) continue;
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      const doc = parsed === null ? null : sanitizeStoreDocument(parsed);
      if (doc === null) {
        damaged = true;
        continue;
      }
      if (index > 0) {
        warnOnce.warn("recovered", `dsh-v-cosmos: config store recovered from ${basename(candidates[index])} (primary file unusable)`);
      } else {
        warnOnce.clear("recovered");
      }
      return doc;
    }
    if (damaged) {
      warnOnce.warn("degraded", "dsh-v-cosmos: config store unusable (file and backups); falling back to layer config");
    }
    return null;
  }

  /** 重新从磁盘装载（watch 触发 / 路由读取前调用）。 */
  function refresh() {
    state = loadDocument();
    return state;
  }

  const currentRevision = () => (state !== null && Number.isInteger(state.revision) ? state.revision : 0);
  const currentSections = () => storeSectionsOf(state);

  /**
   * 同形就绪快照（与客户端 seam 作用域一致）：`base` 组合层、`user` 存储节、`value` 生效值。
   * 存储缺席按 `revision: 0` 的空存储呈现（`user: null`、`value: base`）。
   * @param {unknown} baseView 组合层视图（entry config）
   * @returns {{status: string, revision: number, value: object, base: object, user: object|null, writable: boolean}}
   */
  function snapshot(baseView) {
    const base = normalizeView(baseView, { tolerateUnknownPreState: true });
    const user = currentSections();
    return { status: "ready", revision: currentRevision(), value: mergeView(base, user), base, user, writable: true };
  }

  /** 备份轮转（**复制**式：正式文件自存在起直到被原子替换不存在缺席窗口）。 */
  function rotateBackups() {
    if (!existsSync(filePath)) return;
    for (let index = backupCount - 1; index >= 1; index -= 1) {
      const from = backupPath(index);
      if (existsSync(from)) copyFileSync(from, backupPath(index + 1));
      else {
        try {
          unlinkSync(backupPath(index + 1));
        } catch {
          /* .bak 不存在即无事可做 */
        }
      }
    }
    copyFileSync(filePath, backupPath(1));
  }

  /**
   * rename 覆盖的原子替换，Windows 上有界重试（另一进程持读句柄时 EPERM）。
   * @throws {ConfigStoreError} io
   */
  async function renameWithRetry(from, to) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        renameSync(from, to);
        return;
      } catch (error) {
        const retryable = error?.code === "EPERM" || error?.code === "EACCES" || error?.code === "EBUSY";
        if (!retryable || attempt >= renameBackoffMs.length) {
          try {
            unlinkSync(from);
          } catch {
            /* 临时文件清理失败不掩盖原始错误 */
          }
          throw new ConfigStoreError("io", `atomic replace failed: ${String(error?.code ?? error)}`);
        }
        await sleep(renameBackoffMs[attempt]);
      }
    }
  }

  /** 临时文件 + rename 原子写（调用方须持锁）。 */
  async function writeDocumentAtomic(doc) {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(tmpPath, `${JSON.stringify(doc, null, 2)}\n`);
    onBeforeReplace?.({ filePath, tmpPath, doc });
    await renameWithRetry(tmpPath, filePath);
  }

  /** 锁文件是否陈旧（时间戳超阈值；内容不可读则退回 mtime 判定）。 */
  function lockIsStale() {
    try {
      const stamp = JSON.parse(readFileSync(lockPath, "utf8"))?.at;
      if (typeof stamp === "number" && Number.isFinite(stamp)) return now() - stamp > lockStaleMs;
    } catch {
      /* 坏 JSON / 读不到：退回 mtime */
    }
    try {
      return now() - statSync(lockPath).mtimeMs > lockStaleMs;
    } catch {
      return false;
    }
  }

  /**
   * 跨进程写临界区：锁文件 `wx` 独占创建（内容 pid + 时间戳）→ 执行 fn → 释放。
   * 陈旧锁接管重建；有界等待，超时 `busy`。
   * @param {() => Promise<any>} fn
   * @throws {ConfigStoreError} busy | io
   */
  async function withLock(fn) {
    mkdirSync(dirname(filePath), { recursive: true });
    const deadline = now() + lockWaitMs;
    for (;;) {
      let fd = null;
      try {
        fd = openSync(lockPath, "wx");
      } catch (error) {
        if (error?.code !== "EEXIST") throw new ConfigStoreError("io", `lock create failed: ${String(error?.code ?? error)}`);
        if (lockIsStale()) {
          try {
            unlinkSync(lockPath);
          } catch {
            /* 他人先一步接管：下一轮重试 */
          }
          continue;
        }
        if (now() >= deadline) throw new ConfigStoreError("busy", "config store is locked by another writer");
        await sleep(lockStepMs);
        continue;
      }
      try {
        try {
          writeSync(fd, JSON.stringify({ pid: process.pid, at: now() }));
        } catch {
          /* 锁内容仅用于陈旧判定，写失败仍以 mtime 兜底 */
        }
        return await fn();
      } finally {
        try {
          closeSync(fd);
        } catch {
          /* 已关闭 */
        }
        try {
          unlinkSync(lockPath);
        } catch {
          /* 已被接管删除 */
        }
      }
    }
  }

  /**
   * 幂等播种（**独占创建**，抗双宿主并发）：存储不存在 → 以本机组合层视图写 `revision: 1`。
   * 视图为空的节不写入（空视图 ⇒ 无节存储，待有配置的一端一次性升级）。
   * @param {unknown} baseView
   * @param {{source?: string}} [seedOptions] source 落进 `migratedFrom`
   * @returns {{seeded: boolean, reason: "created"|"exists"|"error"}}
   */
  function seed(baseView, seedOptions = {}) {
    const source = typeof seedOptions.source === "string" && seedOptions.source ? seedOptions.source : "entry-config";
    const view = normalizeView(baseView);
    const doc = { revision: 1 };
    for (const key of CONFIG_STORE_SECTIONS) {
      if (Array.isArray(view[key]) && view[key].length > 0) doc[key] = view[key];
    }
    doc.migratedFrom = source;
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, `${JSON.stringify(doc, null, 2)}\n`, { flag: "wx" });
    } catch (error) {
      if (error?.code === "EEXIST") {
        state = loadDocument();
        return { seeded: false, reason: "exists" };
      }
      warnOnce.warn("seed-failed", `dsh-v-cosmos: config store seed failed: ${String(error?.message || error)}`);
      return { seeded: false, reason: "error" };
    }
    state = doc;
    warnOnce.clear("seed-failed");
    return { seeded: true, reason: "created" };
  }

  /**
   * 一次性覆盖升级（走同一写临界区）：用本机组合层视图覆盖空存储，`revision` 保持 1。
   * @param {unknown} baseView
   * @param {{source?: string}} [upgradeOptions]
   * @returns {Promise<{upgraded: boolean, reason: string}>}
   */
  async function upgrade(baseView, upgradeOptions = {}) {
    const view = normalizeView(baseView);
    const sections = {};
    for (const key of CONFIG_STORE_SECTIONS) {
      if (Array.isArray(view[key]) && view[key].length > 0) sections[key] = view[key];
    }
    if (Object.keys(sections).length === 0) return { upgraded: false, reason: "empty-view" };
    return withLock(async () => {
      const current = loadDocument();
      const doc = { revision: 1, ...sections };
      const migrated = current?.migratedFrom ?? upgradeOptions.source;
      if (typeof migrated === "string" && migrated) doc.migratedFrom = migrated;
      rotateBackups();
      await writeDocumentAtomic(doc);
      state = doc;
      return { upgraded: true, reason: "upgraded" };
    });
  }

  /**
   * 播种 + 一次性升级（宿主激活时的幂等收口）：
   *  - 存储不存在 → 播种（独占创建）；
   *  - 存在但**不含任何节**且本机视图非空 → 覆盖升级（revision 保持 1）；
   *  - 含任意节 → 不动（除非调用方声明本进程抢播的临时视图 `forceUpgrade`）。
   * @param {unknown} baseView
   * @param {{source?: string, forceUpgrade?: boolean}} [seedOptions]
   * @returns {Promise<{action: "seeded"|"upgraded"|"kept"|"error"}>}
   */
  async function ensureSeeded(baseView, seedOptions = {}) {
    const outcome = seed(baseView, seedOptions);
    if (outcome.seeded) return { action: "seeded" };
    if (outcome.reason === "error") return { action: "error" };
    state = loadDocument();
    const forced = seedOptions.forceUpgrade === true;
    if (currentSections() !== null && !forced) return { action: "kept" };
    const view = normalizeView(baseView);
    const nonEmpty = CONFIG_STORE_SECTIONS.some((key) => Array.isArray(view[key]) && view[key].length > 0);
    if (!nonEmpty) return { action: "kept" };
    const result = await upgrade(baseView, seedOptions);
    return { action: result.upgraded ? "upgraded" : "kept" };
  }

  /**
   * CAS 写入：校验（按节复用 normalizeButtons / normalizeConstButtons 语义，落盘归一化输出）
   * → 锁内 CAS 判定 → 复制式备份轮转 → 原子替换。
   * @param {{baseRevision: number, sections: Record<string, Array|null>}} request `null` = unset 该节
   * @returns {Promise<{revision: number}>}
   * @throws {ConfigStoreError} invalid | conflict | busy | io
   */
  async function writeSections(request) {
    const body = request !== null && typeof request === "object" && !Array.isArray(request) ? request : {};
    if (!Number.isInteger(body.baseRevision) || body.baseRevision < 0) {
      throw new ConfigStoreError("invalid", "baseRevision must be a non-negative integer");
    }
    const patch = body.sections;
    if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
      throw new ConfigStoreError("invalid", "sections must be an object");
    }
    const keys = Object.keys(patch);
    if (keys.length === 0) throw new ConfigStoreError("invalid", "sections must contain at least one section");
    const normalized = {};
    for (const key of keys) {
      if (!CONFIG_STORE_SECTIONS.includes(key)) throw new ConfigStoreError("invalid", `unknown section: ${key}`);
      const value = patch[key];
      if (value === null) {
        normalized[key] = null;
        continue;
      }
      if (!Array.isArray(value)) throw new ConfigStoreError("invalid", `section ${key} must be an array or null`);
      try {
        normalized[key] = SECTION_NORMALIZERS[key](value);
      } catch (error) {
        throw new ConfigStoreError("invalid", `section ${key}: ${String(error?.message || error)}`);
      }
    }
    return withLock(async () => {
      const current = loadDocument();
      const revision = current !== null && Number.isInteger(current.revision) ? current.revision : 0;
      if (body.baseRevision !== revision) {
        throw new ConfigStoreError("conflict", `revision mismatch (current ${revision})`, { revision });
      }
      const doc = { revision: revision + 1 };
      for (const key of CONFIG_STORE_SECTIONS) {
        if (current !== null && Array.isArray(current[key])) doc[key] = current[key];
      }
      for (const key of keys) {
        if (normalized[key] === null) delete doc[key];
        else doc[key] = normalized[key];
      }
      if (typeof current?.migratedFrom === "string" && current.migratedFrom) doc.migratedFrom = current.migratedFrom;
      rotateBackups();
      await writeDocumentAtomic(doc);
      state = doc;
      return { revision: doc.revision };
    });
  }

  /**
   * 热重载监视：`fs.watch` + 去抖 → 失败/不可用回退 mtime+size 轮询。
   * 存储文件尚不存在时改监视其父目录并按文件名过滤（Windows 上单文件监视本就是这个
   * 语义），这样播种后立刻回到事件快路径。监视句柄与轮询定时器都 unref。
   * @param {() => void} onChange 去抖后的变更回调
   * @returns {() => void} 停止函数
   */
  function watchStore(onChange) {
    let stopped = false;
    let debounceTimer = null;
    let pollTimer = null;
    let watcher = null;
    const fire = () => {
      if (stopped) return;
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (!stopped) onChange();
      }, watchDebounceMs);
      debounceTimer.unref?.();
    };
    const stamp = () => {
      try {
        const info = statSync(filePath);
        return `${info.mtimeMs}:${info.size}`;
      } catch {
        return "absent";
      }
    };
    const startPolling = () => {
      if (pollTimer !== null || stopped) return;
      let last = stamp();
      pollTimer = setInterval(() => {
        const next = stamp();
        if (next === last) return;
        last = next;
        fire();
      }, watchPollMs);
      pollTimer.unref?.();
    };
    const attach = (target, filter) => {
      const handle = fsWatch(target, (eventType, filename) => {
        void eventType;
        if (filter !== null && filename !== null && filename !== undefined && filename !== filter) return;
        fire();
      });
      handle.on("error", () => {
        try {
          handle.close();
        } catch {
          /* 已关闭 */
        }
        if (watcher === handle) watcher = null;
        startPolling();
      });
      handle.unref?.();
      return handle;
    };
    try {
      watcher = attach(filePath, null);
    } catch {
      try {
        watcher = attach(dirname(filePath), basename(filePath));
      } catch {
        startPolling();
      }
    }
    return () => {
      stopped = true;
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      if (pollTimer !== null) clearInterval(pollTimer);
      try {
        watcher?.close();
      } catch {
        /* 已关闭 */
      }
      watcher = null;
    };
  }

  return {
    filePath,
    lockPath,
    backupPath,
    /** 重新装载并返回文档（null = 存储缺席）。 */
    refresh,
    /** 当前内存文档（不触盘）。 */
    peek: () => state,
    revision: currentRevision,
    sections: currentSections,
    snapshot,
    seed,
    upgrade,
    ensureSeeded,
    writeSections,
    watch: watchStore
  };
}

/* 供冒烟直测的只读常量（与宿主解析口径一致）。 */
export { STORE_BACKUP_COUNT, STORE_LOCK_WAIT_MS };
