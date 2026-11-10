/**
 * dsh-v-cosmos — 宿主半区。
 *
 * 星空骨架与关联引擎（add-cosmos-entry，design.md 架构图左半）：
 *  - GET  /api/dsh-v-cosmos/scene  星空骨架 JSON（星座/恒星/连线/星云/关联边；
 *                                 **会话不在其列**——会话事实走浏览器半区官方镜像）
 *  - GET  /api/dsh-v-cosmos/events SSE 轻帧广播：`proposals-changed` /
 *                                 `associations-changed`（帧体不带载荷，客户端收到
 *                                 后自行重拉 scene——hive 同款；心跳注释防代理断连）
 *  - 关联存储：$DSH_HOME/storages/dsh-v-cosmos.json（storage-json 同款语义：内存态即
 *    全量、temp 写 + rename 原子替换）。**MUST NOT 落盘到 openspec 工件**——
 *    工作区目录恒只读（零侵入纪律，任务 3.6 冒烟断言）。旧名 dsh-cosmos 的存量
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
 *  - 注册→骨架链路（add-cosmos-add-workspace D3）：`/scene` 请求期比对在册工作区
 *    **id 集合指纹**（`idSetFingerprint`）与骨架 id 集合，不一致 → 全量扫描——宿主
 *    workspaceRegistry 无注册事件，这是「新增/注销工作区」在插件边界内的唯一收敛点。
 *
 * 数据源边界（对齐 hive 数据流原则）：宿主半区只读 registry/agents 头信息与
 * openspec 工件；displayTitle / pendingInteraction / todos 等投影字段只存在于
 * 浏览器半区，宿主不产出也不需要。
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, closeSync, writeSync, fdatasyncSync, renameSync, unlinkSync, watch, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { buildSkeleton } from "./scan.mjs";
import {
  ASSOC_VERSION,
  normalizeAssociations,
  pruneArchivedSessions,
  projectionOf,
  upsertAssociation,
  applyContextHeuristic,
  applyBirthtimeHeuristic,
  resolveWorkspacePath
} from "./associations.mjs";

export const name = "dsh-v-cosmos";

export const inject = ["webServer", "agents", "workspaceRegistry"];

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

/* ── 工作区目录读回调（宿主半区唯一触碰工作区文件的位置；只读） ── */

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
    /* cosmos-spec 契约 v1（add-celestial-states 2.3）：原始条目列表（{name, by, at}），
       归一/非法跳过/目录优先剔除由 scan.mjs 纯层完成。 */
    const dir = join(String(workspacePath), "openspec", "pending-changes");
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && typeof entry.name === "string" && entry.name.endsWith(".json"))
      .map((entry) => {
        try {
          const parsed = JSON.parse(readFileSync(join(dir, entry.name), "utf8"));
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
          return { name: parsed.name, by: parsed.by, at: parsed.at };
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

export function apply(ctx) {
  /** 关联条目（内存态即全量；持久化 = temp 写 + rename）。 */
  let entries = [];
  /** 星空骨架缓存（per-workspace 指纹增量比对）。 */
  let skeleton = { version: DOC_VERSION, generatedAt: 0, workspaces: [] };
  /** 已执行过至少一次全量扫描（懒启动门）。 */
  let scanned = false;
  const sseClients = new Set();
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
      let agent = null;
      try {
        agent = ctx.agents?.get?.(sessionId) ?? null;
      } catch {
        agent = null;
      }
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
      变更时落盘 + 广播 associations-changed；幂等条目不产生广播。 */
  const runHeuristics = (workspacePath, proposalNames, now) => {
    let changed = false;
    const active = activeSessionsOf(workspacePath, now);
    const before = projectionOf(entries).length;
    /* 规则 1：逐活跃会话的近期上下文 × 提案 slug。 */
    for (const session of active) {
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
    /* 规则 2：提案目录出现窗口 × 唯一活跃会话（已有关联的提案跳过）。 */
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
        activeSessions: active.map((s) => ({ sessionId: s.sessionId, lastActivityMs: s.lastActivityMs })),
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
      watch 范围从 changes/ 扩至 openspec/ 根，覆盖 changes/ 与 pending-changes/）。 */
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

          /* ── SSE 轻帧广播 ── */
          if (route === "/events" && req.method === "GET") {
            res.writeHead(200, {
              "content-type": "text/event-stream",
              "cache-control": "no-cache",
              connection: "keep-alive"
            });
            res.write("retry: 3000\n\n");
            res.write(": connected\n\n");
            sseClients.add(res);
            startHeartbeat();
            res.on("close", () => {
              sseClients.delete(res);
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
      if (heartbeat) clearInterval(heartbeat);
    };
  }, "dsh-v-cosmos: api routes");
}

/* 导出供测试与后续 UI 消费的观察面（不改变运行时行为）。 */
export { ASSOC_VERSION, upsertAssociation, normalizeAssociations };
