/**
 * dsh-v-cosmos — 宿主半区。
 *
 * 星空骨架与关联引擎（add-cosmos-entry，design.md 架构图左半）：
 *  - GET  /api/dsh-v-cosmos/scene  星空骨架 JSON（星座/恒星/连线/星云/关联边；
 *                                 **会话不在其列**——会话事实走浏览器半区官方镜像）
 *  - GET  /api/dsh-v-cosmos/events SSE 轻帧广播：`proposals-changed` /
 *                                 `associations-changed`（帧体不带载荷，客户端收到
 *                                 后自行重拉 scene——hive 同款；心跳注释防代理断连）。
 *                                 另：`role=cosmos-window` 连接 = Cosmos 独立窗口占位
 *                                 （add-cosmos-standalone-window D2），占位计数经
 *                                 `cosmos-presence-changed` 帧（`{type, count}`，计数即
 *                                 载荷）在连接建立/增量/断开时广播；断开自动清位。
 *  - GET/PUT /api/dsh-v-cosmos/config 动作按钮配置（add-cosmos-proposal-actions）：
 *                                 GET 返回 `{status, revision, value, base, user, writable}`
 *                                 （base = 补丁层 entry config，user = 共享存储节，
 *                                 value = base ← user 逐节覆盖）；PUT = CAS 写入
 *                                 `{baseRevision, sections}`（null = unset 该节），
 *                                 200 / 409 conflict / 400 invalid / 503 busy / 500 io。
 *                                 存储 = `$DSH_HOME/dsh-v-cosmos.config.json`（configstore.mjs）。
 *  - POST /api/dsh-v-cosmos/archive-sessions 会话扫尾批量归档
 *                                 （add-cosmos-archive-session-sweep）：请求 `{sessionIds}`
 *                                 （条目非空、去重后 ≤32，空数组合法）；先按
 *                                 `archivedSessionIds` 预过滤（already-archived），其余按
 *                                 数组序**依次** `archiveSession`（**不带 stopActivity**——
 *                                 在跑工作只跳过不杀），逐会话 outcome
 *                                 archived / skipped+activity / missing / failed，恒 200；
 *                                 重复调用幂等。分流规则见 sweep.mjs。
 *  - POST /api/dsh-v-cosmos/rename-session 会话扫尾前缀改名：请求
 *                                 `{sessionId, prefix}`（prefix 非空、UTF-8 ≤64 字节）；
 *                                 读原题（sessionTitle.get）→ 空题回退 `prefix+未命名` /
 *                                 已带前缀幂等 no-op（unchanged）→ `sessionTitle.rename`
 *                                 （超长宿主按 maxTitleBytes 保头截尾、改名钉住标题）；
 *                                 200 `{outcome, title}` / 404 session/unknown /
 *                                 503 rename-unavailable（部署未挂载 session-title）/
 *                                 400 invalid / 500。sessionTitle 经 ctx.get 请求期惰性
 *                                 可选查找、**不入 inject**（design D9）。
 *  - POST /api/dsh-v-cosmos/bind-session 显式会话关联绑定（fix-cosmos-association-scope）：
 *                                 请求 `{sessionId, proposals}`（sessionId 原样保留；
 *                                 proposals trim/去重/≤16）；工作区复用启发式归属同源解析
 *                                 （registry sessionIds 反查优先 → 会话 cwd 相等兜底），
 *                                 解析不到 400 `workspace/unknown`；写入 = **替换**
 *                                 （该会话在该工作区的关联恰为清单，origin=explicit）；
 *                                 仅实际变更时落盘 + 广播 `associations-changed`（幂等
 *                                 重绑零写入零广播）；200 `{ok, bound}`。持有 explicit
 *                                 条目的会话被启发式两条规则压制（见 runHeuristics）。
 *  - POST /api/dsh-v-cosmos/dismiss-embryo 星胚移除（add-cosmos-embryo-dismiss 2.1 /
 *                                 CONTRACT §6.3：**仅用户显式点击驱动**，禁止任何推导触发）：
 *                                 请求 `{workspaceId, slug}`；守卫链依序执行 = workspace
 *                                 解析（未在册 → missing-workspace，不碰文件系统）→ slug
 *                                 白名单（`^[A-Za-z0-9][A-Za-z0-9._-]*$` 且不含 `..` 子串，
 *                                 不匹配 → failed 且**不解析任何路径**）→ 同名提案目录守卫
 *                                 （`changes/<slug>/` 存在 → guard-dir-exists，零删除）→
 *                                 锚点存在性（缺失 → already-missing，幂等）→ `unlinkSync`
 *                                 仅删 `pending-changes/<slug>.json`（捕 ENOENT 归
 *                                 already-missing，其余删除异常归 failed）；**恒 200** +
 *                                 `{outcome, reason?}`（deleted / already-missing /
 *                                 guard-dir-exists / missing-workspace / failed）。
 *                                 `.state.json` 与 `changes/<name>/` 恒不触碰。
 *  - 关联存储：$DSH_HOME/storages/dsh-v-cosmos.json（storage-json 同款语义：内存态即
 *    全量、temp 写 + rename 原子替换）。**MUST NOT 落盘到 openspec 工件**——
 *    工作区目录恒只读（零侵入纪律，任务 3.6 冒烟断言）；唯一例外 = `/dismiss-embryo`
 *    的用户显式动词单文件删除（见上）。旧名 dsh-cosmos 的存量
 *    存储首启回读迁移（读取回落，写入恒走新名）。
 *  - 启发式 v1（design.md 优先级）：
 *      1. 会话归属该工作区（registry sessionIds / cwd）且近期上下文文本
 *         （ctx.agents 快照最近消息）含提案 slug → 关联；
 *      2. 提案目录出现（stat.birthtime，取不到回落 fs.watch 检测时刻）±30min
 *         窗口内该工作区唯一活跃会话 → 关联；
 *    origin: "heuristic" 全部记录；已存在三元关联不重写（幂等，重扫零抖动）。
 *  - fs.watch 增量监听（生命周期对齐 hive「懒启动 / 补挂 / 摘除」请求期对账）：
 *    per-workspace `openspec/` recursive watch（add-celestial-states 2.3：从 changes/
 *    扩至 openspec/ 根，覆盖提案目录与 pending-changes/ 锚点；受监门槛 =
 *    existsSync(openspec)），事件 ≥2s 防抖后仅重扫脏工作区；骨架指纹变化 →
 *    proposals-changed，关联变化 → associations-changed。
 *  - 注册→骨架链路（add-cosmos-add-workspace D3）：`/scene` 请求期比对在册工作区
 *    **id 集合指纹**（`idSetFingerprint`）与骨架 id 集合，不一致 → 全量扫描——宿主
 *    workspaceRegistry 无注册事件，这是「新增/注销工作区」在插件边界内的唯一收敛点。
 *
 * 数据源边界（对齐 hive 数据流原则）：宿主半区只读 registry/agents 头信息与
 * openspec 工件（唯一写例外 = `/dismiss-embryo` 的锚点硬删除，仅用户点击驱动）；
 * displayTitle / pendingInteraction / todos 等投影字段只存在于
 * 浏览器半区，宿主不产出也不需要。
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, closeSync, writeSync, fdatasyncSync, renameSync, unlinkSync, watch, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { buildSkeleton } from "./scan.mjs";
import { normalizeView, createConfigStore, resolveConfigStorePath } from "./configstore.mjs";
import {
  normalizeArchiveRequest,
  normalizeRenameRequest,
  classifyArchiveError,
  composePrefixedTitle,
  normalizeRenameResult
} from "./sweep.mjs";
import {
  ASSOC_VERSION,
  normalizeAssociations,
  pruneArchivedSessions,
  projectionOf,
  upsertAssociation,
  applyContextHeuristic,
  applyBirthtimeHeuristic,
  resolveWorkspacePath,
  normalizeBindRequest,
  applyBinding,
  explicitBoundSessionIds
} from "./associations.mjs";
/* 独立窗口占位注册表（add-cosmos-standalone-window design D2）：纯逻辑模块，`/events` 的
   `role=cosmos-window` 连接在此登记；计数帧经既有 SSE 通道广播（不另起通道）。 */
import { createPresenceRegistry, isCosmosWindowRole, presenceFrameOf } from "./presence.mjs";

export const name = "dsh-v-cosmos";

/**
 * cordis 注入声明：`sessions` 是核心服务（活会话解析，恒在；先例 archived-session-gate
 * 的 `inject: ['agents', 'sessions', 'workspaceRegistry']`）。`sessionTitle` MUST NOT
 * 入 inject——它是可选插件服务，声明而未挂载会让 fiber 等待激活，未装
 * dsh-session-title 的部署中整个插件停摆（scene/events/config 全灭，design D9）；
 * 改经请求期 `ctx.get("sessionTitle")` 惰性可选查找，缺失 → rename 端点 503 降级。
 */
export const inject = ["webServer", "agents", "workspaceRegistry", "sessions"];

const API_PREFIX = "/api/dsh-v-cosmos";
/** 旧插件名（品牌更名前的存储文件名，读取回落迁移用；写入恒走新名）。 */
const LEGACY_STORAGE_FILENAME = "dsh-cosmos.json";
const DOC_VERSION = 1;
/** fs.watch 事件防抖（design.md ≥2s）。 */
const SCAN_DEBOUNCE_MS = 2000;
/** 规则 1 近期上下文的事件窗口上限（防超长会话全量扫描）。 */
const CONTEXT_EVENT_WINDOW = 200;
/** 单工作区活跃会话参与启发式的数量上限（异常大会话面兜底）。 */
const HEURISTIC_SESSION_CAP = 64;

/**
 * 星胚移除的 slug 白名单（CONTRACT §6.3 / spec「星胚移除服务端端点」）：
 * `^[A-Za-z0-9][A-Za-z0-9._-]*$` **且不含 `..` 子串**。首字符非点 + 无路径分隔符本已使
 * 穿越不可达；显式拒 `..` 是防御纵深（并使「含 `..` 恒拒」的断言字面成立）。
 * 校验 MUST 先于任何路径解析——不合法输入恒不触达文件系统。
 * @param {unknown} slug
 * @returns {boolean}
 */
export function isDismissableSlug(slug) {
  return (
    typeof slug === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(slug) &&
    !slug.includes("..")
  );
}

/* ── 存储路径：$DSH_HOME（非空）优先，否则 ~/.dsh（对齐 hive storagePath 语义） ── */

export function storagePath(env = process.env) {
  const envHome = typeof env.DSH_HOME === "string" ? env.DSH_HOME.trim() : "";
  const home = envHome || join(homedir(), ".dsh");
  return join(home, "storages", "dsh-v-cosmos.json");
}

/** 旧名存储路径（品牌更名前；仅读取回落，SHALL NOT 写入）。 */
export function legacyStoragePath(env = process.env) {
  const envHome = typeof env.DSH_HOME === "string" ? env.DSH_HOME.trim() : "";
  const home = envHome || join(homedir(), ".dsh");
  return join(home, "storages", LEGACY_STORAGE_FILENAME);
}

/**
 * 动作按钮配置的共享存储路径（`$DSH_HOME/dsh-v-cosmos.config.json`）。
 * 与关联存储（`storages/dsh-v-cosmos.json`）完全独立：互不读写对方数据。
 * @param {Record<string, string|undefined>} [env]
 * @returns {string}
 */
export function configStoragePath(env = process.env) {
  return resolveConfigStorePath({ env });
}

/**
 * 在册工作区 id 集合指纹（add-cosmos-add-workspace D3 注册→骨架对账键）：
 * 排序 join（集合等价，顺序无关；NUL 分隔防 id 拼接歧义）。指纹**仅含 id 集合**：
 * 注册/注销检测是本案范围，重命名（title）刻意不入指纹（触发面控制——重命名传播
 * 维持既有滞后行为）。
 * @param {Array<string>} ids
 * @returns {string}
 */
export function idSetFingerprint(ids) {
  const list = Array.isArray(ids) ? ids : [];
  const clean = [];
  for (const value of list) {
    const id = typeof value === "string" ? value : "";
    if (id) clean.push(id);
  }
  clean.sort();
  return clean.join("\u0000");
}

/* ── 原子读写（storage-json 同款：temp 写 + fsync + rename 替换） ── */

function atomicWrite(path, text) {
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

/** 读关联文档；无文件/损坏/超版本 → 默认文档（version 1、空条目）。 */
export function parseStoredDoc(text) {
  const fallback = { version: DOC_VERSION, entries: [] };
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
    if (parsed.version !== DOC_VERSION) return fallback;
    const entries = normalizeAssociations(parsed.entries);
    return { version: DOC_VERSION, entries: entries ?? [] };
  } catch {
    return fallback;
  }
}

/* ── 工作区目录读回调（宿主半区触碰工作区文件的位置；读 + dismiss 端点单文件删除） ── */

const readers = {
  readChangesDir(workspacePath) {
    return readdirSync(join(String(workspacePath), "openspec", "changes"), { withFileTypes: true });
  },
  readArchiveDir(workspacePath) {
    return readdirSync(join(String(workspacePath), "openspec", "changes", "archive"), { withFileTypes: true });
  },
  readTasks(proposalDir) {
    return readFileSync(join(String(proposalDir), "tasks.md"), "utf8");
  },
  readBirthMs(proposalDir) {
    return statSync(String(proposalDir)).birthtimeMs;
  },
  readState(proposalDir) {
    return readFileSync(join(String(proposalDir), ".state.json"), "utf8");
  },
  readPendingDir(workspacePath) {
    /* cosmos-spec 契约 v1（add-celestial-states 2.3 / add-cosmos-embryo-cards 2.1）：
       原始条目列表（{name, by, at, sessionId?}），归一/非法跳过/目录优先剔除由 scan.mjs
       纯层完成。`sessionId` 为可选加法扩展——**三跳第一跳**，此处漏透传即静默退化为
       旧锚点（各自成卡），故原样携带、不做解释。 */
    const dir = join(String(workspacePath), "openspec", "pending-changes");
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && typeof entry.name === "string" && entry.name.endsWith(".json"))
      .map((entry) => {
        try {
          const parsed = JSON.parse(readFileSync(join(dir, entry.name), "utf8"));
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
          return { name: parsed.name, by: parsed.by, at: parsed.at, sessionId: parsed.sessionId };
        } catch {
          return null; // 非法文件跳过
        }
      })
      .filter(Boolean);
  }
};

/* ── JSON 响应 ── */

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

/* ── 近期上下文文本提取（规则 1 信号源；容错读面，异常一律空串） ── */

/**
 * 提取会话近期上下文文本：snapshotEvents 末窗（CONTEXT_EVENT_WINDOW）内全部
 * assistant/user 消息的 text 块拼接。事件形状漂移容忍：无 content 数组即跳过。
 * @param {object} agent ctx.agents.get(sessionId) 形
 * @returns {string}
 */
export function contextTextOf(agent) {
  try {
    const events = agent?.session?.snapshotEvents?.() ?? [];
    const window = typeof events.slice === "function" ? events.slice(-CONTEXT_EVENT_WINDOW) : [];
    const parts = [];
    for (const event of window) {
      const blocks = event?.data?.message?.content;
      if (!Array.isArray(blocks)) continue;
      for (const block of blocks) {
        if (block?.type === "text" && typeof block.text === "string" && block.text) parts.push(block.text);
      }
    }
    return parts.join("\n");
  } catch {
    return "";
  }
}

/**
 * 会话最近活动时刻：末个携带数值时间戳字段的事件；取不到 → now（把会话视为
 * 「正在进行」参与规则 2 窗口判定——宁可保守命中也不漏）。
 * @param {object} agent
 * @param {number} now
 * @returns {number}
 */
export function lastActivityMsOf(agent, now) {
  try {
    const events = agent?.session?.snapshotEvents?.() ?? [];
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];
      for (const key of ["at", "ts", "time", "timestamp"]) {
        const value = Number(event?.[key]);
        if (Number.isFinite(value) && value > 0) return value;
      }
    }
  } catch {
    /* fallthrough */
  }
  return now;
}

/* ── 插件主体 ── */

/**
 * @param {object} ctx 宿主 cordis 上下文
 * @param {object} [config] 补丁层 entry config（动作按钮配置的组合层 base：
 *        `buttons` 提案动作 + `constellationButtons` 星座动作，两节互不读写；
 *        共享存储的同名节分别覆盖各自 base。缺省 = 无自定义按钮）
 */
export function apply(ctx, config) {
  /** 关联条目（内存态即全量；持久化 = temp 写 + rename）。 */
  let entries = [];
  /** 组合层视图（entry config；宿主半区不注册 settings 命名空间——design D7）。 */
  const baseView = normalizeView(config);
  /** 动作按钮配置共享存储（`$DSH_HOME/dsh-v-cosmos.config.json`）。 */
  const configStore = createConfigStore({ logger: ctx.logger ?? null });
  /** 星空骨架缓存（per-workspace 指纹增量比对）。 */
  let skeleton = { version: DOC_VERSION, generatedAt: 0, workspaces: [] };
  /** 已执行过至少一次全量扫描（懒启动门）。 */
  let scanned = false;
  const sseClients = new Set();
  /* 独立窗口占位登记（add-cosmos-standalone-window D2）：token = 该窗口的 `/events`
     连接对象，连接断开即清位（无崩溃残留、无 TTL）。计数经 `cosmos-presence-changed`
     轻帧广播；主壳座位据此禁用（入口互斥）。 */
  const presence = createPresenceRegistry();
  let heartbeat = null;
  /** 提案目录首次检测时刻（birthMs 取不到时规则 2 的回落基准）。 */
  const firstSeenMs = new Map();
  /** 脏工作区路径集合（fs.watch 防抖后的重扫范围）。 */
  const dirtyWorkspaces = new Set();
  let scanTimer = null;
  /** per-workspace watcher 映射（key = workspaceId）。 */
  const watchers = new Map();

  const broadcast = (event) => {
    const line = "data: " + JSON.stringify(event) + "\n\n";
    for (const res of sseClients) {
      try {
        res.write(line);
      } catch {
        /* 写失败由 close 统一清理 */
      }
    }
  };

  /** 占位计数全量帧广播（连接建立/占位增量/释放共用：客户端据此自愈，重连无需补发请求）。 */
  const broadcastPresence = () => broadcast(presenceFrameOf(presence.count()));

  const startHeartbeat = () => {
    if (heartbeat) return;
    heartbeat = setInterval(() => {
      for (const res of sseClients) {
        try {
          res.write(": ping\n\n");
        } catch {
          /* ignore */
        }
      }
    }, 25000);
    heartbeat.unref?.();
  };
  const maybeStopHeartbeat = () => {
    if (heartbeat && sseClients.size === 0) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };

  /** 关联持久化 + associations-changed 轻帧（帧体不带载荷）。 */
  const persistAssociations = () => {
    try {
      atomicWrite(storagePath(), JSON.stringify({ version: DOC_VERSION, entries }, null, 2));
    } catch (error) {
      ctx.logger?.warn?.("[dsh-v-cosmos] 关联存储落盘失败: %s", String(error?.message || error));
    }
    broadcast({ type: "associations-changed" });
  };

  /**
   * 在册工作区清单（registry 未就绪/抛错 → null，**不当作空集**）：注册指纹对账
   * MUST NOT 把「registry 暂不可达」误判为「全部注销」而清空骨架。
   */
  const listedWorkspaces = () => {
    try {
      const list = ctx.workspaceRegistry?.list?.();
      return Array.isArray(list) ? list : null;
    } catch {
      return null;
    }
  };

  /** 在册工作区清单（registry 不可达 → 空表，不抛错）。 */
  const listWorkspaces = () => listedWorkspaces() ?? [];

  /** 工作区实体 id（`id ?? workspaceId` 双写兜底，对齐 hive workspaceEntityId）。 */
  const workspaceEntityId = (workspace) => {
    const id = typeof workspace?.id === "string" && workspace.id ? workspace.id : "";
    if (id) return id;
    const alt = typeof workspace?.workspaceId === "string" && workspace.workspaceId ? workspace.workspaceId : "";
    return alt;
  };

  /** 归档会话集合（registry 缺席 → 空集，不剪）。 */
  const archivedSessionIds = () => {
    try {
      return new Set(ctx.workspaceRegistry?.archivedSessionIds ?? []);
    } catch {
      return new Set();
    }
  };

  /**
   * 会话标题服务惰性可选查找（add-cosmos-archive-session-sweep design D9）：
   * `sessionTitle` 是可选插件服务，不入 inject；请求期经 `ctx.get` 沙箱查找
   * （无需声明），缺失 / 查找失败 → undefined（rename 端点 503 rename-unavailable）。
   */
  const sessionTitleService = () => {
    try {
      return ctx.get?.("sessionTitle") ?? undefined;
    } catch {
      return undefined;
    }
  };

  /** 活会话对象解析（rename 要求 exact live session；缺席 → 404 session/unknown）。 */
  const liveSessionOf = (sessionId) => {
    try {
      return ctx.sessions?.get?.(sessionId) ?? undefined;
    } catch {
      return undefined;
    }
  };

  /** 会话 agent 对象容错解析（ctx.agents 镜像；缺席/抛错 → null）。 */
  const agentOf = (sessionId) => {
    try {
      return ctx.agents?.get?.(sessionId) ?? null;
    } catch {
      return null;
    }
  };

  /**
   * 会话→工作区归属解析（bind-session 端点复用启发式同源逻辑）：
   * registry `sessionIds` 反查优先，回落会话 cwd（`agent.session.header.cwd`）与工作区
   * path 相等；解析不到 → null（宿主映射 400 workspace/unknown）。
   */
  const resolveSessionWorkspace = (sessionId) => {
    const header = agentOf(sessionId)?.session?.header ?? null;
    const cwd = typeof header?.cwd === "string" ? header.cwd : "";
    return resolveWorkspacePath({ sessionId, cwd, workspaces: listWorkspaces() });
  };

  /**
   * workspaceId → 工作区路径（dismiss 端点守卫链第一跳）：在册工作区按实体 id 反查，
   * 未登记 / 路径空 → null（端点映射 missing-workspace，不触碰文件系统）。
   */
  const workspacePathOf = (workspaceId) => {
    if (typeof workspaceId !== "string" || !workspaceId) return null;
    for (const workspace of listWorkspaces()) {
      if (workspaceEntityId(workspace) !== workspaceId) continue;
      const path = typeof workspace?.path === "string" ? workspace.path : "";
      if (path) return path;
    }
    return null;
  };

  /**
   * 该工作区的活跃会话面（启发式输入）：registry sessionIds ∩ ctx.agents 在册、
   * 非子代理（header.origin）、非 blank（header 可见时）、未归档。
   * @returns {Array<{ sessionId: string, agent: object, lastActivityMs: number }>}
   */
  const activeSessionsOf = (workspacePath, now) => {
    const workspace = listWorkspaces().find((ws) => typeof ws?.path === "string" && ws.path === workspacePath);
    const ids = Array.isArray(workspace?.sessionIds) ? workspace.sessionIds : [];
    const archived = archivedSessionIds();
    const out = [];
    for (const sessionId of ids) {
      if (archived.has(sessionId)) continue;
      const agent = agentOf(sessionId);
      if (!agent) continue;
      const header = agent?.session?.header ?? null;
      if (header?.origin === "subagent") continue; // 无人机不渲染也不计活跃度（v1）
      if (header?.blank === true) continue; // blank 会话（header 可见时的防御检查）
      out.push({ sessionId, agent, lastActivityMs: lastActivityMsOf(agent, now) });
      if (out.length >= HEURISTIC_SESSION_CAP) break;
    }
    return out;
  };

  /** 启发式执行（单工作区）：规则 1（归属+slug）优先、规则 2（birthtime 窗口）兜底。
      变更时落盘 + 广播 associations-changed；幂等条目不产生广播。

      显式绑定压制（fix-cosmos-association-scope 2.2 / spec「显式会话关联绑定」）：
      以存储中 explicit 条目为**唯一依据**（无内存标志，重启由回读恢复）——规则 1 循环
      跳过被绑定会话；规则 2 的活跃集合先剔除被绑定会话再判唯一性。未绑定会话路径
      逐字不变。 */
  const runHeuristics = (workspacePath, proposalNames, now) => {
    let changed = false;
    const active = activeSessionsOf(workspacePath, now);
    const bound = explicitBoundSessionIds(entries, workspacePath);
    const heuristicActive = active.filter((session) => !bound.has(session.sessionId));
    const before = projectionOf(entries).length;
    /* 规则 1：逐活跃会话的近期上下文 × 提案 slug（被绑定会话跳过）。 */
    for (const session of heuristicActive) {
      const text = contextTextOf(session.agent);
      if (!text) continue;
      const result = applyContextHeuristic({
        workspacePath,
        sessionId: session.sessionId,
        proposalNames,
        contextText: text,
        entries,
        now
      });
      entries = result.entries;
      if (result.added.length > 0) changed = true;
    }
    /* 规则 2：提案目录出现窗口 × 唯一活跃会话（已有关联的提案跳过；被绑定会话不参与
       唯一性判定——否则刚绑定的忙碌会话会误连后续新提案目录）。 */
    const associated = new Set(entries.filter((e) => e.workspace === workspacePath).map((e) => e.proposal));
    const wsSkeleton = skeleton.workspaces.find((ws) => ws.path === workspacePath);
    for (const proposal of wsSkeleton?.stars ?? []) {
      if (associated.has(proposal.id)) continue;
      const birthMs = typeof proposal.birthMs === "number" ? proposal.birthMs : null;
      const seenKey = workspacePath + "\u0000" + proposal.id;
      if (!firstSeenMs.has(seenKey)) firstSeenMs.set(seenKey, now);
      const result = applyBirthtimeHeuristic({
        workspacePath,
        proposal: { id: proposal.id, birthMs },
        detectedMs: birthMs ?? firstSeenMs.get(seenKey),
        activeSessions: heuristicActive.map((s) => ({ sessionId: s.sessionId, lastActivityMs: s.lastActivityMs })),
        entries,
        now
      });
      entries = result.entries;
      if (result.added) changed = true;
    }
    if (changed) persistAssociations();
    void before; // 变更判定以 added 语义为准（before 仅观察用）
    return changed;
  };

  /** 会话归档剪除（任务 3.5）：持久化写入点执行；剪动才广播。 */
  const pruneAssociations = () => {
    const archived = archivedSessionIds();
    if (archived.size === 0) return false;
    const pruned = pruneArchivedSessions(entries, archived);
    const before = entries.length;
    if ((pruned?.length ?? 0) === before) return false;
    entries = pruned ?? [];
    persistAssociations();
    return true;
  };

  /** 单工作区骨架指纹（增量比对键）：stars 含 lifecycle/setBy/at（add-celestial-states），pending 锚点一并入指纹。 */
  const skeletonFingerprint = (ws) => JSON.stringify({ s: ws.stars, a: ws.archives, p: ws.pending, l: ws.links, assoc: ws.associations });

  /**
   * 全量扫描（懒启动/请求期对账/watch 防抖共用入口）：
   * registry 清单 × 目录扫描 → 会话剪除 → 启发式 → 骨架装配（含关联边投影回填）。
   * 骨架变化 → proposals-changed；关联变化 → associations-changed（persist 内广播）。
   */
  const scanAll = ({ scope } = {}) => {
    const now = Date.now();
    const workspaces = listWorkspaces();
    const pruned = pruneAssociations();
    let next = buildSkeleton(workspaces, readers, { now, associations: projectionOf(entries) });
    const entriesBefore = next.workspaces.reduce((n, ws) => n + ws.associations.length, 0);
    for (const ws of next.workspaces) {
      if (scope && !scope.has(ws.path)) continue;
      runHeuristics(ws.path, ws.stars.map((star) => star.id), now);
    }
    /* 关联投影回填：剪除或本轮启发式建立了新关联时重建骨架（否则关联边缺席一拍）。
       重建廉价（目录再读一轮），以正确性优先。 */
    const entriesAfter = projectionOf(entries).length;
    if (pruned || entriesAfter !== entriesBefore) {
      next = buildSkeleton(workspaces, readers, { now, associations: projectionOf(entries) });
    }
    let skeletonChanged = pruned;
    const prevWsIds = new Set(skeleton.workspaces.map((ws) => ws.id));
    const nextWsIds = new Set();
    for (const ws of next.workspaces) {
      nextWsIds.add(ws.id);
      if (scope && !scope.has(ws.path)) continue;
      const prev = skeleton.workspaces.find((old) => old.id === ws.id);
      if (!prev || skeletonFingerprint(prev) !== skeletonFingerprint(ws)) skeletonChanged = true;
    }
    /* 注销（id 消失）同样是骨架变化：上面的循环只看新集合，删空时无条目可比较
       （add-cosmos-add-workspace D3：请求期指纹对账依赖 proposals-changed 广播把
       注销传播给等其他客户端）。 */
    if (prevWsIds.size !== nextWsIds.size) {
      skeletonChanged = true;
    } else {
      for (const id of prevWsIds) {
        if (!nextWsIds.has(id)) {
          skeletonChanged = true;
          break;
        }
      }
    }
    skeleton = next;
    scanned = true;
    reconcileWatchers();
    if (skeletonChanged) broadcast({ type: "proposals-changed" });
    return skeleton;
  };

  /* ── fs.watch 生命周期（懒启动 / 补挂 / 摘除，对齐 hive 请求期对账） ── */

  /** 受监听工作区清单：有 `openspec/` 目录且已登记 workspaceId（add-celestial-states 2.3：
      watch 范围从 changes/ 扩至 openspec/ 根，覆盖 changes/ 与 pending-changes/；星胚移除
      的锚点 `unlink` 同样是该目录下的事件，零新增通道）。 */
  const watchableWorkspaces = () => {
    const out = [];
    for (const workspace of listWorkspaces()) {
      const workspaceId = workspaceEntityId(workspace);
      const path = typeof workspace?.path === "string" ? workspace.path : "";
      if (!workspaceId || !path) continue;
      out.push({ workspaceId, path, dir: join(path, "openspec") });
    }
    return out;
  };

  const dropWatcher = (workspaceId) => {
    const entry = watchers.get(workspaceId);
    if (!entry) return;
    watchers.delete(workspaceId);
    try {
      entry.watcher.close();
    } catch {
      /* 已关闭 */
    }
  };

  /** 请求期对账：(a) 摘除已消失工作区 (b) 摘除 error 条目 (c) 补挂合格工作区。 */
  const reconcileWatchers = () => {
    const live = watchableWorkspaces();
    const liveIds = new Set(live.map((entry) => entry.workspaceId));
    for (const workspaceId of [...watchers.keys()]) {
      if (!liveIds.has(workspaceId)) dropWatcher(workspaceId);
    }
    for (const { workspaceId, path, dir } of live) {
      const existing = watchers.get(workspaceId);
      if (existing && !existing.errored) continue;
      if (existing?.errored) dropWatcher(workspaceId);
      if (!existsSync(dir)) continue;
      try {
        const watcher = watch(dir, { recursive: true, persistent: false }, () => markDirty(path));
        watcher.on("error", () => {
          const entry = watchers.get(workspaceId);
          if (entry) entry.errored = true;
        });
        watchers.set(workspaceId, { watcher, dir, errored: false });
      } catch {
        /* 启动失败（网络盘/权限/EMFILE/平台不支持）→ 静默降级：客户端保持拉取语义 */
      }
    }
  };

  /** watch 事件 → 标记脏工作区 + 单次 2s 防抖重扫（只重扫脏集）。 */
  const markDirty = (workspacePath) => {
    dirtyWorkspaces.add(workspacePath);
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      const scope = new Set(dirtyWorkspaces);
      dirtyWorkspaces.clear();
      try {
        scanAll({ scope });
      } catch (error) {
        ctx.logger?.warn?.("[dsh-v-cosmos] 脏工作区重扫失败: %s", String(error?.message || error));
      }
    }, SCAN_DEBOUNCE_MS);
    scanTimer.unref?.(); // 硬要求：SHALL NOT 拖着事件循环（含测试进程）
  };

  /* ── 插件主体（ctx.effect 生命周期） ── */

  ctx.effect(() => {
    /* 启动即加载关联文档（损坏/超版本即默认重建）；新名存储缺席时回读旧名档
       （品牌更名迁移：读取回落，下次 persistAssociations 落新名文件）。 */
    let doc = null;
    for (const path of [storagePath(), legacyStoragePath()]) {
      try {
        doc = parseStoredDoc(readFileSync(path, "utf8"));
        break;
      } catch {
        doc = null; // 缺席/损坏 → 尝试下一路径
      }
    }
    entries = Array.isArray(doc?.entries) ? doc.entries : [];
    entries = normalizeAssociations(entries) ?? [];

    /* ── 动作按钮配置共享存储（configstore.mjs） ──
       装载 + 幂等播种（组合层视图 = entry config；空视图 ⇒ 只写 revision/migratedFrom
       骨架文件，节缺席 = 未自定义）+ fs.watch 热重载（他端进程写入 → 重读）。 */
    configStore.refresh();
    void configStore.ensureSeeded(baseView, { source: "entry-config" }).catch((error) => {
      ctx.logger?.warn?.("[dsh-v-cosmos] 配置存储播种失败: %s", String(error?.message || error));
    });
    const stopConfigWatch = configStore.watch(() => {
      try {
        configStore.refresh();
      } catch (error) {
        ctx.logger?.warn?.("[dsh-v-cosmos] 配置存储热重载失败: %s", String(error?.message || error));
      }
    });

    const readJsonBody = async (req) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) return {};
      try {
        return JSON.parse(text);
      } catch {
        return {};
      }
    };

    const dispose = ctx.webServer.register({
      kind: "prefix",
      path: API_PREFIX,
      handler: async (req, res) => {
        const url = new URL(req.url, "http://localhost");
        const route = url.pathname.slice(API_PREFIX.length) || "/";
        try {
          /* ── 星空骨架 ── */
          if (route === "/scene" && req.method === "GET") {
            if (!scanned) {
              scanAll();
            } else {
              /* 注册→骨架对账（add-cosmos-add-workspace D3）：在册 id 集合指纹与骨架
                 id 集合不一致（新登记/注销工作区）→ 全量重扫（scanAll 内含
                 reconcileWatchers 与 proposals-changed 广播）。宿主侧无注册事件，
                 故对账收敛在插件自身的请求期钩子；常态请求零增量。
                 registry 不可达（null）→ 不误判为「全部注销」，维持既有轻量对账。 */
              const registry = listedWorkspaces();
              const registryIds = registry ? registry.map(workspaceEntityId) : null;
              const idSetChanged = registryIds !== null
                && idSetFingerprint(registryIds) !== idSetFingerprint(skeleton.workspaces.map((ws) => ws.id));
              if (idSetChanged) {
                scanAll();
              } else {
                reconcileWatchers(); // 请求期对账（新登记工作区/摘除消失工作区）
                /* 会话归档不产生 fs.watch 事件 → 剪除挂在每次拉取（时序一收敛入口）；
                   剪动才重建骨架切片并广播。 */
                if (pruneAssociations()) {
                  skeleton = buildSkeleton(listWorkspaces(), readers, { now: Date.now(), associations: projectionOf(entries) });
                  broadcast({ type: "proposals-changed" });
                }
              }
            }
            json(res, 200, { ok: true, scene: skeleton });
            return;
          }

          /* ── 动作按钮配置：读（视图语义 base/user/value；存储缺席按 revision 0 空存储） ── */
          if (route === "/config" && req.method === "GET") {
            configStore.refresh();
            json(res, 200, configStore.snapshot(baseView));
            return;
          }

          /* ── 动作按钮配置：CAS 写入 `{ baseRevision, sections }`（null = unset 该节） ── */
          if (route === "/config" && req.method === "PUT") {
            const body = await readJsonBody(req);
            let outcome;
            try {
              outcome = await configStore.writeSections(body);
            } catch (error) {
              if (error?.code === "conflict") {
                json(res, 409, {
                  error: "conflict",
                  revision: typeof error.revision === "number" ? error.revision : configStore.revision()
                });
                return;
              }
              if (error?.code === "invalid") {
                json(res, 400, { error: "invalid", reason: String(error?.message || error) });
                return;
              }
              if (error?.code === "busy") {
                json(res, 503, { error: "busy" });
                return;
              }
              json(res, 500, { error: "io", reason: String(error?.message || error) });
              return;
            }
            json(res, 200, { revision: outcome.revision });
            return;
          }

          /* ── 会话扫尾：批量归档（add-cosmos-archive-session-sweep 2.2） ──
             预过滤 `archivedSessionIds`（幂等）→ 按数组序**依次**逐个
             `await archiveSession`——**不带 stopActivity**：turn / subagent 链 /
             job / schedule 由宿主活动瀑布判定，在跑工作只跳过不杀。部分失败不改变
             整体成功语义（逐会话 outcome，恒 200）。 */
          if (route === "/archive-sessions" && req.method === "POST") {
            const request = normalizeArchiveRequest(await readJsonBody(req));
            if (!request.ok) {
              json(res, 400, { error: "invalid", reason: request.reason });
              return;
            }
            const archived = archivedSessionIds();
            const results = [];
            for (const sessionId of request.sessionIds) {
              if (archived.has(sessionId)) {
                results.push({ sessionId, outcome: "already-archived" });
                continue;
              }
              let outcome;
              try {
                await ctx.workspaceRegistry.archiveSession(sessionId);
                outcome = { outcome: "archived" };
                archived.add(sessionId); // 单请求内重复 id 已被归一化去重，此处仅保持集合语义
              } catch (error) {
                outcome = classifyArchiveError(error);
              }
              results.push({ sessionId, ...outcome });
            }
            json(res, 200, { results });
            return;
          }

          /* ── 会话扫尾：前缀改名（2.3） ──
             会话先解析为 live 对象（标题服务要求 exact live session）→
             `sessionTitle` 惰性查找（缺失 → 503）→ 读原题 → 前缀拼接（空题回退 /
             已带前缀幂等 no-op）→ rename（超长由宿主 maxTitleBytes 保头截尾）。 */
          if (route === "/rename-session" && req.method === "POST") {
            const request = normalizeRenameRequest(await readJsonBody(req));
            if (!request.ok) {
              json(res, 400, { error: "invalid", reason: request.reason });
              return;
            }
            const session = liveSessionOf(request.sessionId);
            if (!session) {
              json(res, 404, { error: "session/unknown", sessionId: request.sessionId });
              return;
            }
            const titles = sessionTitleService();
            if (!titles) {
              json(res, 503, { error: "rename-unavailable" });
              return;
            }
            let current = "";
            try {
              const snapshot = titles.get?.(session);
              current = typeof snapshot?.title === "string" ? snapshot.title : "";
            } catch (error) {
              json(res, 500, { error: "internal", reason: String(error?.message || error) });
              return;
            }
            const composed = composePrefixedTitle(current, request.prefix);
            if (composed.unchanged) {
              json(res, 200, normalizeRenameResult({ unchanged: true, title: composed.title }));
              return;
            }
            let accepted;
            try {
              accepted = titles.rename?.(session, composed.title);
            } catch (error) {
              json(res, 500, { error: "internal", reason: String(error?.message || error) });
              return;
            }
            const result = normalizeRenameResult({ unchanged: false, accepted });
            if (result.outcome === "failed") {
              json(res, 500, { error: "internal", reason: result.error });
              return;
            }
            json(res, 200, result);
            return;
          }

          /* ── 显式会话关联绑定（fix-cosmos-association-scope 2.1 / spec「显式会话关联绑定」） ──
             归一化失败 400 invalid；工作区复用启发式归属同源解析（registry sessionIds
             反查 → 会话 cwd 兜底），解析不到 400 workspace/unknown（存储/广播零变化）；
             替换语义写入后**仅 changed 时**落盘 + 广播（persistAssociations 无条件广播，
             幂等重绑 MUST 跳过）；200 {ok, bound}（bound = 归一化后清单）。 */
          if (route === "/bind-session" && req.method === "POST") {
            const request = normalizeBindRequest(await readJsonBody(req));
            if (!request.ok) {
              json(res, 400, { error: "invalid", reason: request.reason });
              return;
            }
            const workspace = resolveSessionWorkspace(request.sessionId);
            if (!workspace) {
              json(res, 400, { error: "workspace/unknown", sessionId: request.sessionId });
              return;
            }
            const result = applyBinding(entries, {
              workspace,
              sessionId: request.sessionId,
              proposals: request.proposals
            });
            entries = result.entries;
            if (result.changed) {
              /* 关联投影随骨架下发：已在册骨架需同拍重建（客户端收到
                 associations-changed 后会重拉 /scene——不回填即返回旧边）。 */
              if (scanned) {
                skeleton = buildSkeleton(listWorkspaces(), readers, { now: Date.now(), associations: projectionOf(entries) });
              }
              persistAssociations();
            }
            json(res, 200, { ok: true, bound: request.proposals });
            return;
          }

          /* ── 星胚移除（add-cosmos-embryo-dismiss 2.1 / CONTRACT §6.3） ──
             dsh-v-cosmos 一等清理方：用户在星胚信息卡两击确认后，硬删除
             `openspec/pending-changes/<slug>.json` 单文件。**仅用户显式点击驱动**——本端点
             不挂任何定时/推导触发者。恒 200 + outcome 枚举（照 archive-sessions 口径）：
             workspace 解析 → slug 白名单（零路径解析）→ 同名提案目录守卫 → 锚点存在性
             幂等 → `unlinkSync`（捕 ENOENT 归幂等，其余异常 failed + reason）。 */
          if (route === "/dismiss-embryo" && req.method === "POST") {
            const body = await readJsonBody(req);
            const workspacePath = workspacePathOf(body?.workspaceId);
            if (!workspacePath) {
              json(res, 200, { outcome: "missing-workspace" });
              return;
            }
            const slug = body?.slug;
            if (!isDismissableSlug(slug)) {
              /* 白名单先于任何路径解析：路径穿越输入（/ \ ..）恒不可达文件系统。 */
              json(res, 200, { outcome: "failed", reason: "非法 slug" });
              return;
            }
            /* 目录守卫先行：同名真实提案目录存在 → 绝不触碰（锚点按目录优先本就被忽略）。 */
            if (existsSync(join(workspacePath, "openspec", "changes", slug))) {
              json(res, 200, { outcome: "guard-dir-exists" });
              return;
            }
            const anchorPath = join(workspacePath, "openspec", "pending-changes", slug + ".json");
            /* 锚点存在性：缺失 = 幂等（重复移除 / ff 已清理）。 */
            if (!existsSync(anchorPath)) {
              json(res, 200, { outcome: "already-missing" });
              return;
            }
            try {
              unlinkSync(anchorPath);
            } catch (error) {
              /* 存在性检查与删除之间被 ff / explore 并发清理 → 归幂等（恒 200 不破）。 */
              if (error?.code === "ENOENT") {
                json(res, 200, { outcome: "already-missing" });
                return;
              }
              json(res, 200, { outcome: "failed", reason: String(error?.message || error) });
              return;
            }
            json(res, 200, { outcome: "deleted" });
            return;
          }

          /* ── SSE 轻帧广播（add-cosmos-standalone-window D2 扩 `role` 角色连接） ──
             独立窗口以 `?role=cosmos-window` 连接 → 登记占位；连接建立（含重连）即广播
             当前全量计数（客户端自愈）；占位增量/释放（连接 close）再广播一次。既有心跳、
             proposals/associations 帧机制零改动。 */
          if (route === "/events" && req.method === "GET") {
            res.writeHead(200, {
              "content-type": "text/event-stream",
              "cache-control": "no-cache",
              connection: "keep-alive"
            });
            res.write("retry: 3000\n\n");
            res.write(": connected\n\n");
            sseClients.add(res);
            const windowRole = isCosmosWindowRole(url.searchParams.get("role"));
            if (windowRole) presence.add(res);
            startHeartbeat();
            /* 连接建立即广播全量计数（含本连接）：任何客户端重连后按当前计数校正按钮态。 */
            broadcastPresence();
            res.on("close", () => {
              const wasWindow = presence.delete(res);
              sseClients.delete(res);
              /* 占位释放 → 全体客户端（主壳座位）即时解锁。 */
              if (wasWindow) broadcastPresence();
              maybeStopHeartbeat();
            });
            return;
          }

          json(res, 404, { error: "unknown route" });
        } catch (error) {
          json(res, 400, { error: String(error?.message || error) });
        }
      }
    });

    return () => {
      dispose();
      stopConfigWatch();
      for (const workspaceId of [...watchers.keys()]) dropWatcher(workspaceId);
      if (scanTimer) {
        clearTimeout(scanTimer);
        scanTimer = null;
      }
      for (const res of sseClients) {
        try {
          res.end();
        } catch {
          /* 已断开 */
        }
      }
      sseClients.clear();
      /* 插件卸载清场：占位归零（连接随后全部 end；本集合是判定权威，MUST NOT 留残余）。 */
      presence.reset();
      if (heartbeat) clearInterval(heartbeat);
    };
  }, "dsh-v-cosmos: api routes");
}

/* 导出供测试与后续 UI 消费的观察面（不改变运行时行为）。 */
export { ASSOC_VERSION, upsertAssociation, normalizeAssociations };
