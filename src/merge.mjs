/**
 * 骨架 × 会话镜像合并纯函数单点（add-cosmos-entry 4.2/4.7/4.8 / design.md 数据模型）。
 *
 * 独立模块——浏览器 client.jsx 消费（providers 合并）、test/merge-smoke.mjs 冒烟直测。
 * 模块**零 DOM / 零网络依赖**：输入为宿主骨架 JSON + 官方会话镜像快照
 * （ctx.sessions.list / ctx.workspaces.list 的 getSnapshot 形状），输出与
 * demo/styles/assets/mock-cosmos.js 同构的 scene JSON。
 *
 * 数据流原则（对齐 hive）：会话/工作区事实 100% 来自官方镜像；骨架（恒星/星云/
 * 连线）来自宿主扫描；合并时**以骨架为准**——关联提案不在活跃清单 → 行星回归彗星
 * （边记录保留）；行星失去会话锚点（镜像中消失/归档/blank）→ 移除。
 *
 * 天体口径（add-celestial-states spec）：
 *  - 恒星 = 活跃提案 + 星胚（pending 锚点，lifecycle:"proto"）；颜色 = 生命周期四态；
 *    act = 关联会话 busy/waiting/委托忙碌数量（热度通道，不改颜色）；
 *  - 行星 = 有关联条目的会话（state 四态推导：待决策 > 执行中 > 完成未读 > 待机中；
 *    信号源 = statuses（ctx.uiSession.sessionStatus 快照），不可达降级 idle/busy）；
 *  - 卫星 = subagent 会话挂父天体（行星/彗星均可），单层渲染、单父上限 6、深层折叠计数；
 *  - 彗星 = 该工作区内其余非空自由会话（blank/子代理/未归属工作区不渲染）；
 *  - 星云密度 = archives（上限 520 粒由引擎负责）；
 *  - 星座 pos / 恒星 off 由确定性哈希生成（提案增删不打乱其余恒星）。
 */

/** 生命周期枚举（含 merge 层星胚 `proto`；磁盘枚举只有 created/reviewed/executed）。 */
const LIFECYCLE_STATES = new Set(["proto", "created", "reviewed", "executed"]);

/** 32 位 FNV-1a（确定性摆放的哈希基座；hive bee-model 同源算法）。 */
export function hash32(text) {
  let hash = 0x811c9dc5;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * 会话四态推导（add-celestial-states 3.1，修复 v1 死分支）：
 *  - 待决策 = statuses.pendingInteraction（kind 子类透传信息卡）；
 *  - 执行中 = running（statuses.running 缺省回落 summary.running——statuses 不可达
 *    时自然降级 idle/busy 两态）；
 *  - 完成未读 = statuses.completionUnread（宿主已读信号）；
 *  - 待机中 = 其余。
 * 优先级：待决策 > 执行中 > 完成未读 > 待机中。
 * @param {object} summary 官方镜像 SessionSummary（running 字段可用）
 * @param {{running?: boolean, pendingInteraction?: object, completionUnread?: boolean}|undefined} [status]
 *        ctx.uiSession.sessionStatus 快照条目（不可达 → undefined）
 * @returns {"idle"|"busy"|"waiting"|"done-unread"}
 */
export function planetStateOf(summary, status) {
  if (status && status.pendingInteraction) return "waiting";
  const running = status && typeof status.running === "boolean" ? status.running : Boolean(summary?.running);
  if (running) return "busy";
  if (status && status.completionUnread) return "done-unread";
  return "idle";
}

/** 相对时间（age/when 的统一口径；<60s 刚刚 / <60m N分钟前 / <24h N小时前 / N天前）。 */
export function relativeTime(ms, now) {
  const at = Number(ms);
  if (!Number.isFinite(at) || at <= 0) return "—";
  const delta = Math.max(0, (Number(now) || Date.now()) - at);
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return minutes + " 分钟前";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + " 小时前";
  const days = Math.floor(hours / 24);
  return days + " 天前";
}

/**
 * 星座确定性摆放（纯函数，任务 4.7 真机修订：充分利用 3D 空间）：
 *  - **Fibonacci 球壳**分布（黄金角经度 + 均匀纬度）——星座散布在环绕视点的球面
 *    上（上/下/远/近全方向），替换原 XZ 平面螺旋（默认俯视角下挤成一条横线）；
 *  - 球壳半径随数量外扩（spread × (0.9 + √N × 0.55)），id 哈希做 0.55–1.0× 径向
 *    抖动填充壳厚度；
 *  - 三维最小间距松弛（迭代推挤防碰撞）；
 *  - 输入先按 id 规范排序——位置只依赖工作区 id 集合，与传入顺序无关。
 * @param {Array<{id: string}>} workspaces
 * @param {{ spread?: number, minDist?: number, relaxRounds?: number }} [options]
 * @returns {Map<string, [number, number, number]>} id → pos
 */
export function constellationPositions(workspaces, options = {}) {
  const spread = Number.isFinite(options.spread) ? options.spread : 150;
  const minDist = Number.isFinite(options.minDist) ? options.minDist : 240;
  const rounds = Number.isFinite(options.relaxRounds) ? options.relaxRounds : 24;
  const list = (Array.isArray(workspaces) ? workspaces : [])
    .map((ws, index) => ({ id: ws?.id ?? String(index) }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const count = list.length;
  const golden = Math.PI * (3 - Math.sqrt(5));
  const shellRadius = spread * (0.9 + Math.sqrt(Math.max(1, count)) * 0.55);
  const pts = list.map((ws, index) => {
    const seed = hash32(ws.id);
    /* Fibonacci 球面（规范序第 index 点）：纬度均匀、经度黄金角逐点推进。 */
    const y = count === 1 ? 0 : 1 - ((index + 0.5) * 2) / count;
    const ringR = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * index;
    const radial = shellRadius * (0.55 + ((seed >>> 8) / 16777216) * 0.45); // 哈希径向抖动填壳
    return {
      id: ws.id,
      x: Math.cos(theta) * ringR * radial,
      y: y * radial,
      z: Math.sin(theta) * ringR * radial
    };
  });
  /* 三维最小间距松弛：成对过近时沿连线对称推开（迭代收敛，纯确定性）。 */
  for (let round = 0; round < rounds; round++) {
    let moved = false;
    for (let a = 0; a < pts.length; a++) {
      for (let b = a + 1; b < pts.length; b++) {
        const pa = pts[a], pb = pts[b];
        let dx = pb.x - pa.x, dy = pb.y - pa.y, dz = pb.z - pa.z;
        let dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist >= minDist) continue;
        if (dist < 1e-6) { dx = 1; dy = 0; dz = 0; dist = 1; }
        const push = (minDist - dist) / 2;
        const ux = dx / dist, uy = dy / dist, uz = dz / dist;
        pa.x -= ux * push; pa.y -= uy * push; pa.z -= uz * push;
        pb.x += ux * push; pb.y += uy * push; pb.z += uz * push;
        moved = true;
      }
    }
    if (!moved) break;
  }
  const out = new Map();
  for (const pt of pts) out.set(pt.id, [pt.x, pt.y, pt.z]);
  return out;
}

/**
 * 工作区名称匹配（纯函数，add-cosmos-search-filter 1.1 / design D4；
 * add-cosmos-embryo-cards 3.2 扩展星胚 slug）：
 *  - `query.trim()` 为空（含仅空白）→ **全部工作区命中**（语义 = 过滤关闭）；
 *  - 非空 → 按空白切分多 token，匹配域小写化后**每个 token 都必须是子串**
 *    （AND 语义；小写化只影响 ASCII，中文逐字语义不受影响）；
 *  - 匹配域 = **工作区名称 ∪ 该工作区星胚 slug**（`lifecycle === "proto"` 的恒星 id；
 *    add-cosmos-embryo-cards 3.2：星胚 slug 是唯一可检索的锚点文本）；
 *  - **正式提案名 MUST NOT 参与匹配**（既有契约不变）；
 *  - 输出命中 ws id 的 `Set`（顺序无关：集合语义，重排输入由
 *    `constellationPositions` 内部规范排序保证确定性）。
 *
 * @param {object|null} scene merge 产出的 scene（{ workspaces: [...] }）
 * @param {string} query 原始查询串（未 trim）
 * @returns {Set<string>} 命中工作区 id
 */
export function matchWorkspaces(scene, query) {
  const list = Array.isArray(scene?.workspaces) ? scene.workspaces : [];
  const text = typeof query === "string" ? query.trim() : "";
  const out = new Set();
  if (!text) {
    for (const ws of list) if (ws?.id != null) out.add(ws.id);
    return out;
  }
  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    for (const ws of list) if (ws?.id != null) out.add(ws.id);
    return out;
  }
  for (const ws of list) {
    if (ws?.id == null) continue;
    /* 字段以换行拼接：子串语义只在单个字段内成立，MUST NOT 跨「名称 / slug」边界
       拼出伪命中（例如名称尾部 + slug 头部拼出第三个词）。 */
    const haystack = [String(ws?.name ?? ""), ...embryoSlugsOf(ws)].join("\n").toLowerCase();
    if (tokens.every((token) => haystack.indexOf(token) >= 0)) out.add(ws.id);
  }
  return out;
}

/** 工作区内星胚 slug 清单（`matchWorkspaces` 匹配域；正式提案名不参与）。 */
function embryoSlugsOf(ws) {
  const slugs = [];
  for (const star of Array.isArray(ws?.stars) ? ws.stars : []) {
    if (!star || star.lifecycle !== "proto") continue;
    const slug = typeof star.id === "string" ? star.id : "";
    if (slug) slugs.push(slug);
  }
  return slugs;
}

/**
 * 星胚归并分组（纯函数，add-cosmos-embryo-cards 2.2 / design D3、D10）：
 * 从**单个工作区**的 proto 恒星推导星胚组。**零新增 scene 字段**——不落地到场景，
 * 投影层（panel.mjs `projectPanel`）按需计算；场景差分对 `sessionId` 的比较面由
 * `starPropertySignature` 承担（重分组 → patch，增删锚点 → rebuild）。
 *
 * 口径：
 *  - 归并键 = 锚点 `sessionId`（同一探索会话 → 同一组）；缺失/空值 → **每 slug 自组**
 *    （旧锚点宁可散落不错并，零迁移）；
 *  - 组键 = `sessionId` 或该组唯一 slug（选中键与卡片 key 的稳定组成，跨工作区唯一性
 *    由调用方叠加 wsId 保证）；
 *  - `slugs` 字典序去重（组内展示先后确定，与骨架传入顺序解耦）；
 *  - `at` = 组内**最早**锚点写入时间（有效值全缺失 → null）；
 *  - 组间按**首 slug** 字典序（确定性；正式提案优先与其后的星胚组呈层排列）。
 *
 * @param {Array<object>} stars 单工作区 scene 恒星（仅 `lifecycle === "proto"` 参与）
 * @returns {Array<{key: string, sessionId: string|null, slugs: string[], at: number|null}>}
 */
export function embryoGroupsOf(stars) {
  const list = Array.isArray(stars) ? stars : [];
  /* 内层分桶键带命名空间前缀：`sessionId` 与 slug 的取值域不同，但混合命名会让
     极端同名输入（会话 id 恰好等于某 slug）被错误归并——隔离两域，组键对外仍是裸值。 */
  const buckets = new Map(); // "session\0<id>" | "solo\0<slug>" → { key, sessionId, slugs, at }
  for (const star of list) {
    if (!star || star.lifecycle !== "proto") continue;
    const slug = typeof star.id === "string" ? star.id : "";
    if (!slug) continue;
    const sessionId = typeof star.sessionId === "string" && star.sessionId ? star.sessionId : null;
    const bucketKey = sessionId === null ? "solo\u0000" + slug : "session\u0000" + sessionId;
    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      bucket = { key: sessionId ?? slug, sessionId, slugs: [], at: null };
      buckets.set(bucketKey, bucket);
    }
    if (!bucket.slugs.includes(slug)) bucket.slugs.push(slug);
    const at = Number(star.at) > 0 ? Number(star.at) : null;
    if (at !== null && (bucket.at === null || at < bucket.at)) bucket.at = at;
  }
  const groups = [];
  for (const bucket of buckets.values()) {
    bucket.slugs.sort(compareText);
    groups.push({ key: bucket.key, sessionId: bucket.sessionId, slugs: bucket.slugs, at: bucket.at });
  }
  /* 组间：首 slug 字典序（首 slug 在同一工作区内唯一 → 无需二次兜底，仍给出确定序）。 */
  groups.sort((a, b) => compareText(a.slugs[0], b.slugs[0]));
  return groups;
}

/** 码点序比较（确定性字典序；不依赖运行环境 locale/ICU，与 panel.mjs 同源口径）。 */
function compareText(a, b) {
  const left = String(a ?? "");
  const right = String(b ?? "");
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * 匹配子集布局（纯函数薄封装，1.2 / design D3）：以命中子集调既有
 * `constellationPositions`（复用不改动——子集布局恒以原点为球心、√N 收缩 →
 * 自动向心聚拢），产出 id → pos Map。
 * 空子集 → 空 Map（过滤关闭语义；调用方据此短路为「不重排」）。
 *
 * @param {Set<string>|string[]|null} matchedIds 命中工作区 id
 * @returns {Map<string, [number, number, number]>} id → 子集布局位置
 */
export function filteredPositions(matchedIds) {
  const ids = matchedIds instanceof Set
    ? [...matchedIds]
    : Array.isArray(matchedIds)
      ? matchedIds.slice()
      : [];
  const valid = ids.filter((id) => id != null);
  if (valid.length === 0) return new Map();
  return constellationPositions(valid.map((id) => ({ id })));
}

/* ------------------------------------------------------------------ *
 * 添加工作区：路径比对（add-cosmos-add-workspace D2/D7；纯函数面）
 * ------------------------------------------------------------------ */

/**
 * 路径比对归一化（幂等重选预判 + 失败/取消呈现的纯逻辑面）：
 *  - 反斜杠归一为正斜杠（Windows 选区路径形态漂移）；
 *  - 折叠重复分隔符（保留 UNC 前缀 `//server/share` 的双斜杠）；
 *  - 去掉尾部路径分隔符（根 `/` 除外）；
 *  - `windows === true` 时折叠 ASCII 大小写（NTFS 大小写不敏感）；
 *  - **MUST NOT** 做 realpath/短名/符号链接解析——客户端无文件系统能力，
 *    漏检降级为正常 create（Host 幂等解析），不产生重复注册。
 *
 * @param {unknown} path 原始路径
 * @param {boolean} [windows] 是否按 Windows 语义折叠大小写
 * @returns {string} 归一化比较键（空/非法 → ""）
 */
export function normalizeWorkspacePath(path, windows = false) {
  let text = typeof path === "string" ? path.trim() : "";
  if (!text) return "";
  text = text.replace(/\\/g, "/");
  const unc = text.startsWith("//");
  text = text.replace(/\/{2,}/g, "/");
  if (unc && !text.startsWith("//")) text = "/" + text; // UNC 前缀还原
  if (text.length > 1) text = text.replace(/\/+$/, "");
  if (!text) return "";
  return windows ? text.toLowerCase() : text;
}

/**
 * 幂等重选预判（D2）：在 `ctx.workspaces.list` 快照 items 中按归一化路径查已注册项。
 * 命中 → 调用方 toast「已在册」并结束（不调 create、无视觉副作用）；
 * 未命中/入参非法 → null（正常 create；Host 幂等兜底）。
 *
 * @param {Array<{path?: string, title?: string}>} items 工作区镜像行
 * @param {unknown} path pickDirectory 返回路径
 * @param {boolean} [windows] Windows 语义（大小写折叠）
 * @returns {object|null} 命中的镜像行
 */
export function findRegisteredWorkspace(items, path, windows = false) {
  const target = normalizeWorkspacePath(path, windows);
  if (!target) return null;
  for (const item of Array.isArray(items) ? items : []) {
    if (!item) continue;
    if (normalizeWorkspacePath(item.path, windows) === target) return item;
  }
  return null;
}

/**
 * Windows 平台判定（大小写折叠开关；MUST NOT 在 POSIX 误用造成误报）。
 * 仅读 navigator 的 UA/platform 提示（浏览器半区），无 navigator（Node 测试）→ false。
 *
 * @param {navigator|null} [nav]
 * @returns {boolean}
 */
export function isWindowsPlatform(nav = typeof navigator !== "undefined" ? navigator : null) {
  try {
    const hint = String(nav?.userAgentData?.platform ?? "")
      + " " + String(nav?.platform ?? "")
      + " " + String(nav?.userAgent ?? "");
    return /win/i.test(hint);
  } catch {
    return false;
  }
}

/**
 * 恒星确定性偏移（纯函数，任务 4.7）：提案 id 哈希在星座半径内散布——
 * 提案增删不打乱其余恒星（offset 只依赖提案自身 id）。
 * @param {string} proposalId
 * @param {number} radius 星座半径（世界单位）
 * @returns {[number, number, number]}
 */
export function starOffset(proposalId, radius = 26) {
  const seed = hash32(proposalId);
  const angle = (seed / 4294967296) * Math.PI * 2;
  const radial = radius * (0.25 + ((seed >>> 8) / 16777216) * 0.75);
  const y = (((seed >>> 16) / 65536) - 0.5) * radius * 0.5;
  return [Math.cos(angle) * radial, y, Math.sin(angle) * radial];
}

/** 星云密度上限（demo 引擎常量沿用；合并层只透传 archives 数值，引擎负责 cap）。 */
export const NEBULA_DUST_CAP = 520;

/** 星云粒子数（archives → 尘埃密度，demo 口径：min(archives*55, 520)）。 */
export function dustCountOf(archives) {
  const count = Math.max(0, Math.round(Number(archives) || 0));
  return Math.min(count * 55, NEBULA_DUST_CAP);
}

/**
 * 骨架 × 镜像合并（纯函数，add-cosmos-entry 4.2 / add-celestial-states 3.1–3.4）：
 * 产出与 demo mock 同构的 scene JSON。
 *
 * @param {object} input
 * @param {object} input.skeleton 宿主骨架（GET /api/dsh-v-cosmos/scene 的 scene）
 * @param {object} input.sessions ctx.sessions.list.getSnapshot()（{ ids, byId }）
 * @param {object} input.workspaces ctx.workspaces.list.getSnapshot()（{ items, archivedSessionIds? }）
 * @param {Map|object} [input.statuses] ctx.uiSession.sessionStatus 快照
 *        （sessionId → {running, pendingInteraction{kind}, completionUnread}；不可达 → null/undefined 降级）
 * @param {number} [input.now] 相对时间基准
 * @returns {object} scene（{ workspaces: [...] }）
 */
export function mergeScene({ skeleton, sessions, workspaces, statuses = null, now = Date.now() }) {
  const byId = sessions?.byId ?? {};
  const sessionIds = Array.isArray(sessions?.ids) ? sessions.ids : [];
  const wsItems = Array.isArray(workspaces?.items) ? workspaces.items : [];
  const archived = new Set(workspaces?.archivedSessionIds ?? []);
  const skeletonWorkspaces = Array.isArray(skeleton?.workspaces) ? skeleton.workspaces : [];

  /* 账号索引：sessionId → 工作区 id（官方分组镜像口径，hive deriveWorld 同款）。 */
  const accountOf = new Map();
  for (const ws of wsItems) {
    for (const sid of ws?.sessionIds ?? []) {
      if (!accountOf.has(sid)) accountOf.set(sid, ws.workspaceId ?? ws.id ?? "");
    }
  }

  /* 统一会话状态快照取值（Map / 平面对象双形态防御；不可达 → undefined = D3 降级路径）。 */
  const statusOf = (sessionId) => {
    if (!statuses) return undefined;
    const entry = typeof statuses.get === "function" ? statuses.get(sessionId) : statuses[sessionId];
    return entry && typeof entry === "object" ? entry : undefined;
  };

  /* 可渲染会话过滤：blank / 归档 / 子代理 / 未归属工作区（本体均不渲染）。 */
  const renderable = new Map();
  for (const id of sessionIds) {
    const s = byId[id];
    if (!s) continue;
    if (archived.has(id)) continue;
    if (s.blank) continue;
    if (s.origin === "subagent") continue;
    const wsId = accountOf.get(id);
    if (!wsId) continue;
    renderable.set(id, { summary: s, workspaceId: wsId });
  }

  /* ── 卫星装配（add-celestial-states 3.3，全局一次）：origin==='subagent' 且有
     parentSessionId 的镜像会话挂到顶层父天体。深度由镜像父子链推导（不依赖
     delegationDepth）：父会话亦为 subagent → 深层折叠，计入顶层祖先天体计数；
     孤儿卫星（父不在镜像/blank/归档/未归属）不渲染。 ── */
  const satVisible = new Map(); // 顶层父 sessionId → 直属卫星 [{id, state, title}]（可见层）
  const satCount = new Map(); // 顶层父 sessionId → 全量计数（直属 + 深层后代折叠）
  for (const id of sessionIds) {
    const s = byId[id];
    if (!s || s.origin !== "subagent" || !s.parentSessionId) continue;
    if (archived.has(id)) continue;
    /* 沿父子链上溯首个非 subagent 会话（顶层父）；环防御上限 16 跳。 */
    let topId = s.parentSessionId;
    let deep = 0;
    for (let hop = 0; hop < 16; hop++) {
      const parent = byId[topId];
      if (!parent || parent.origin !== "subagent") break;
      if (!parent.parentSessionId) { topId = null; break; }
      topId = parent.parentSessionId;
      deep += 1;
    }
    if (!topId) continue;
    const top = byId[topId];
    if (!top || top.blank || archived.has(topId) || !accountOf.get(topId)) continue;
    satCount.set(topId, (satCount.get(topId) ?? 0) + 1);
    if (deep === 0) {
      const entry = { id, state: planetStateOf(s, statusOf(id)), title: s.displayTitle ?? s.title ?? id };
      const list = satVisible.get(topId);
      if (list) list.push(entry);
      else satVisible.set(topId, [entry]);
    }
  }

  /** 天体附件装配（行星/彗星共用）：直属卫星 ≤6 + 全量计数 + 委托忙碌判定。 */
  const satelliteBagOf = (sessionId, summary) => {
    const visible = satVisible.get(sessionId) ?? [];
    const parentRunning = (() => {
      const st = statusOf(sessionId);
      if (st && typeof st.running === "boolean") return st.running;
      return Boolean(summary?.running);
    })();
    return {
      satellites: visible.slice(0, 6), // 单父可见上限 6（超出并入计数）
      satelliteCount: satCount.get(sessionId) ?? 0,
      delegatedBusy: !parentRunning && visible.some((sat) => sat.state === "busy")
    };
  };

  const positions = constellationPositions(skeletonWorkspaces.map((ws) => ({ id: ws.id })));

  const outWorkspaces = skeletonWorkspaces.map((ws) => {
    const pos = positions.get(ws.id) ?? [0, 0, 0];
    /* 恒星生命周期装配（3.2）：骨架 star 的 lifecycle/setBy/at 透传；星胚（pending
       锚点）装配为 lifecycle:"proto" 条目（off = starOffset(slug) 确定性预占位；
       同名真实目录的锚点已在骨架层剔除，此处再防御一次）。索引顺序 = 骨架恒星在前、
       星胚在后——骨架 links 索引不受影响。
       `sessionId`（add-cosmos-embryo-cards 2.2）：锚点可选字段**原样透传**（读取端容错
       已在 scan 层完成；此处空值归一为 null）——画布渲染不读该字段（逐字不变），
       面板投影据此把同一探索会话的锚点归并为一张星胚卡片；同时纳入
       `starPropertySignature`（重分组触发 patch 而非误判 none）。 */
    const stars = (Array.isArray(ws.stars) ? ws.stars : []).map((star) => ({
      id: star.id,
      name: star.name,
      lifecycle: LIFECYCLE_STATES.has(star.lifecycle) ? star.lifecycle : "created",
      setBy: typeof star.setBy === "string" && star.setBy ? star.setBy : null,
      at: Number(star.at) || null,
      tasks: [Number(star.tasks?.[0]) || 0, Number(star.tasks?.[1]) || 0],
      age: relativeTime(star.birthMs, now),
      act: 0,
      off: starOffset(star.id, 26)
    }));
    const starIds = new Set(stars.map((star) => star.id));
    for (const anchor of Array.isArray(ws.pending) ? ws.pending : []) {
      if (!anchor || typeof anchor.name !== "string" || !anchor.name || starIds.has(anchor.name)) continue;
      stars.push({
        id: anchor.name,
        name: anchor.name,
        lifecycle: "proto",
        setBy: typeof anchor.by === "string" && anchor.by ? anchor.by : null,
        at: Number(anchor.at) || null,
        sessionId: typeof anchor.sessionId === "string" && anchor.sessionId ? anchor.sessionId : null,
        tasks: [0, 0],
        age: relativeTime(anchor.at, now),
        act: 0,
        off: starOffset(anchor.name, 26)
      });
    }
    const starIndex = new Map(stars.map((star, i) => [star.id, i]));

    /* 关联条目 → 行星 / 回归彗星（以骨架为准：关联提案不在活跃清单 → 彗星）。 */
    const planets = [];
    const regressedComets = [];
    const associatedBySession = new Map();
    for (const assoc of Array.isArray(ws.associations) ? ws.associations : []) {
      const list = associatedBySession.get(assoc.sessionId);
      if (list) list.push(assoc.proposal);
      else associatedBySession.set(assoc.sessionId, [assoc.proposal]);
    }
    for (const [sessionId, proposals] of associatedBySession) {
      const renderableSession = renderable.get(sessionId);
      const liveProposals = proposals.filter((proposal) => starIndex.has(proposal));
      if (!renderableSession) continue; // 行星失去会话锚点（消失/归档/blank）→ 移除
      if (liveProposals.length === 0) {
        regressedComets.push(sessionId); // 提案归档 → 行星回归彗星（边记录保留）
        continue;
      }
      const summary = renderableSession.summary;
      const state = planetStateOf(summary, statusOf(sessionId));
      planets.push({
        id: sessionId,
        title: summary.displayTitle ?? summary.title ?? sessionId,
        state,
        pendingKind: statusOf(sessionId)?.pendingInteraction?.kind ?? null,
        stars: liveProposals,
        todos: todoBadgeOf(summary),
        when: relativeTime(summary.updatedAt, now),
        updatedAt: Number(summary.updatedAt) || 0,
        ...satelliteBagOf(sessionId, summary)
      });
    }

    /* 活跃度（3.4 扩展口径）：act = 关联会话 busy/waiting 数量 + 委托忙碌行星
       （父待机而直属卫星执行中——活确实在推进）；彗星不关联提案、不计 act。 */
    const actByProposal = new Map();
    for (const planet of planets) {
      const active = planet.state === "busy" || planet.state === "waiting" || planet.delegatedBusy === true;
      if (!active) continue;
      for (const proposal of planet.stars) {
        actByProposal.set(proposal, (actByProposal.get(proposal) ?? 0) + 1);
      }
    }
    for (const star of stars) star.act = actByProposal.get(star.id) ?? 0;

    /* 彗星 = 该工作区其余可渲染自由会话（含回归彗星）；彗星可挂卫星（委托忙碌
       仅附加光环，不计 act——彗星无提案关联）。状态色数据链（add-comet-states-
       and-star-death 3.1）：与行星同一会话状态快照通道、同一降级路径
       （statuses 不可达 → idle/busy 两态），pendingKind 仅 waiting 时进信息卡。 */
    const associatedIds = new Set(associatedBySession.keys());
    const comets = [];
    for (const [sessionId, entry] of renderable) {
      if (entry.workspaceId !== ws.id) continue;
      if (associatedIds.has(sessionId) && !regressedComets.includes(sessionId)) continue;
      const summary = entry.summary;
      comets.push({
        id: sessionId,
        title: summary.displayTitle ?? summary.title ?? sessionId,
        state: planetStateOf(summary, statusOf(sessionId)),
        pendingKind: statusOf(sessionId)?.pendingInteraction?.kind ?? null,
        when: relativeTime(summary.updatedAt, now),
        updatedAt: Number(summary.updatedAt) || 0,
        ...satelliteBagOf(sessionId, summary)
      });
    }

    /* 连线：骨架 links 已由宿主按共享会话派生；恒星增删后索引以骨架为准。 */
    const links = (Array.isArray(ws.links) ? ws.links : [])
      .map((pair) => [Number(pair?.[0]), Number(pair?.[1])])
      .filter((pair) => Number.isInteger(pair[0]) && Number.isInteger(pair[1]) && pair[0] >= 0 && pair[1] >= 0 && pair[0] < stars.length && pair[1] < stars.length && pair[0] !== pair[1]);

    /* 星座级卫星总数（chip ◇N，含深层折叠与超上限折叠，「折叠不丢数」）。 */
    const satelliteCount =
      planets.reduce((n, p) => n + (Number(p.satelliteCount) || 0), 0) +
      comets.reduce((n, c) => n + (Number(c.satelliteCount) || 0), 0);

    return {
      id: ws.id,
      name: ws.name,
      /* 工作区绝对路径透传（add-cosmos-proposal-actions D1 勘误）：提案列表面板的
         @提案目录组装与「工作区归属」共用同一来源；骨架缺席 → 空串（面板侧据此
         拒绝组装 @引用，不产生半截路径）。 */
      path: typeof ws.path === "string" ? ws.path : "",
      pos,
      stars,
      links,
      planets: planets.sort(byUpdatedAtDesc),
      comets: comets.sort(byUpdatedAtDesc),
      archives: Math.max(0, Math.round(Number(ws.archives) || 0)),
      satelliteCount
    };
  });

  return { workspaces: outWorkspaces };
}

/**
 * 恒星 → 关联行星反向索引（cosmos-relation-focus「关联投影纯函数」，design D1）。
 *
 * 行星→恒星方向是现成的 `planet.stars[]`；关联聚焦需要反向路径，故在 merge 层提供
 * 纯投影：输入单星座 merge 产物（`{ stars, planets, ... }`），输出
 * `Map<starId, planetId[]>`。同一恒星被多行星关联、同一行星关联多恒星（联星）
 * 均全量展开——每个 (恒星, 行星) 组合只出现一次；星座无行星 → 空 Map。
 *
 * `planet.stars[]` 条目兼容两形态（同一函数两处消费，零分支调用方）：
 *  - merge 产物 = 提案 id 字符串（本函数的主契约输入）；
 *  - 引擎场景 ws = `buildScenePure` 解析后的恒星对象（带 `wp`，buildItems 现场消费）。
 *
 * MUST 零 DOM、零网络依赖（冒烟直测，test/merge-smoke.mjs）。
 *
 * @param {object|null} ws 单星座（merge 产物或引擎 ws）
 * @returns {Map<string, string[]>} starId → 关联行星 id 列表（按行星在册顺序）
 */
export function starPlanetIdsOf(ws) {
  const out = new Map();
  const planets = Array.isArray(ws?.planets) ? ws.planets : [];
  for (const planet of planets) {
    if (!planet || typeof planet.id !== "string" || !planet.id) continue;
    const stars = Array.isArray(planet.stars) ? planet.stars : [];
    const seen = new Set();
    for (const entry of stars) {
      const sid = typeof entry === "string"
        ? entry
        : (entry && typeof entry.id === "string" ? entry.id : "");
      if (!sid || seen.has(sid)) continue;
      seen.add(sid);
      const list = out.get(sid);
      if (list) list.push(planet.id);
      else out.set(sid, [planet.id]);
    }
  }
  return out;
}

function byUpdatedAtDesc(a, b) {
  return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
}

/** 行星卡 todo 角标（projectionValues.todos → "x/y"，无 todo → "—"）。 */
export function todoBadgeOf(summary) {
  const todos = summary?.projectionValues?.todos;
  if (!Array.isArray(todos) || todos.length === 0) return "—";
  let done = 0;
  for (const item of todos) {
    if (item?.status === "completed" || item?.done === true) done += 1;
  }
  return done + "/" + todos.length;
}

/* ── 属性级补丁 diff（任务 4.8）：骨架/镜像增量到达时，同 id 天体只补属性，
      不全量重建 scene（保住尘埃粒子、尾迹与镜头焦点）。 ── */

/**
 * 场景变更分级（纯函数）：
 *  - "none"：结构键（星座集合/恒星集合/行星彗星集合/连线/pos）与全部可见属性
 *    （名称/路径/lifecycle/tasks/state/todos/age/when 等）完全一致；
 *  - "patch"：集合一致，属性（lifecycle/setBy/at/tasks/act/age/state/delegatedBusy/
 *    satellites/satelliteCount/todos/when/archives/name/path）有差异——引擎按 id 就地补丁
 *    （add-celestial-states 3.5：卫星走属性补丁路径，subagent 起停不触发场景级重建）；
 *    相对时间文本（age/when）必须计入：否则「仅时间桶变化」会被误判为 none，
 *    客户端为刷新文本只能全量重建（画面闪烁）。
 *  - "rebuild"：任一集合/连线/位置变化——引擎全量重建（dust 重播散、覆盖层增量对齐、
 *    同 id 天体的尾迹按中心继承）。
 *
 * @param {object|null} prev 上一帧 scene
 * @param {object} next 下一帧 scene
 * @returns {"none"|"patch"|"rebuild"}
 */
export function sceneDiffLevel(prev, next) {
  if (!prev) return "rebuild";
  const prevWs = Array.isArray(prev?.workspaces) ? prev.workspaces : [];
  const nextWs = Array.isArray(next?.workspaces) ? next.workspaces : [];
  if (prevWs.length !== nextWs.length) return "rebuild";
  let patch = false;
  for (let i = 0; i < nextWs.length; i++) {
    const a = prevWs[i], b = nextWs[i];
    if (!a || a.id !== b.id) return "rebuild";
    if (!sameVec(a.pos, b.pos)) return "rebuild";
    if (!sameIdList(a.stars, b.stars) || !sameIdList(a.planets, b.planets) || !sameIdList(a.comets, b.comets)) return "rebuild";
    if (!sameLinks(a.links, b.links)) return "rebuild";
    /* 名称/路径是面板与 chip 的可见字段（重命名、工作区迁移），必须触发 patch——
       否则会被判 none 而在客户端早退，界面文本停留在旧值。 */
    if (a.name !== b.name || a.path !== b.path) patch = true;
    if (Number(a.archives) !== Number(b.archives)) { patch = true; continue; }
    if (Number(a.satelliteCount ?? 0) !== Number(b.satelliteCount ?? 0)) { patch = true; continue; }
    const starA = new Map(a.stars.map((s) => [s.id, s]));
    for (const star of b.stars) {
      const old = starA.get(star.id);
      if (starPropertySignature(old) !== starPropertySignature(star)) { patch = true; break; }
    }
    if (patch) continue;
    const planetA = new Map(a.planets.map((p) => [p.id, p]));
    for (const planet of b.planets) {
      const old = planetA.get(planet.id);
      if (planetPropertySignature(old) !== planetPropertySignature(planet)) { patch = true; break; }
    }
    if (patch) continue;
    const cometA = new Map(a.comets.map((c) => [c.id, c]));
    for (const comet of b.comets) {
      const old = cometA.get(comet.id);
      if (cometPropertySignature(old) !== cometPropertySignature(comet)) { patch = true; break; }
    }
  }
  return patch ? "patch" : "none";
}

function sameVec(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Number(v) === Number(b[i]));
}

function sameIdList(a, b) {
  const la = Array.isArray(a) ? a : [];
  const lb = Array.isArray(b) ? b : [];
  if (la.length !== lb.length) return false;
  return la.every((item, i) => lb[i]?.id === item?.id);
}

function sameLinks(a, b) {
  const la = (Array.isArray(a) ? a : []).map((p) => p.join(":")).sort();
  const lb = (Array.isArray(b) ? b : []).map((p) => p.join(":")).sort();
  return la.length === lb.length && la.every((v, i) => v === lb[i]);
}

function satellitesSignature(satellites) {
  return (Array.isArray(satellites) ? satellites : []).map((s) => s?.id + ":" + s?.state).join(",");
}

function starPropertySignature(star) {
  if (!star) return "";
  /* `sessionId`（add-cosmos-embryo-cards 2.2）：星胚归并分组的唯一输入——手工编辑某
     锚点的 sessionId（锚点集合不变）必须判为属性级 patch，MUST NOT 被差分守卫误判
     none（否则客户端早退、星胚卡片停留旧分组）。 */
  return [star.name, star.lifecycle, star.setBy ?? "", star.at ?? "", star.sessionId ?? "", star.tasks?.[0], star.tasks?.[1], star.act, star.age ?? ""].join("|");
}

function planetPropertySignature(planet) {
  if (!planet) return "";
  return [
    planet.state,
    planet.pendingKind ?? "",
    planet.delegatedBusy ? 1 : 0,
    planet.satelliteCount ?? 0,
    satellitesSignature(planet.satellites),
    planet.stars?.join(","),
    planet.todos,
    planet.title,
    planet.when ?? ""
  ].join("|");
}

function cometPropertySignature(comet) {
  if (!comet) return "";
  return [
    comet.state,
    comet.pendingKind ?? "",
    comet.delegatedBusy ? 1 : 0,
    comet.satelliteCount ?? 0,
    satellitesSignature(comet.satellites),
    comet.title,
    comet.when ?? ""
  ].join("|");
}
