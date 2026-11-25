/**
 * 提案列表面板投影（add-cosmos-proposal-actions 3.1 / spec cosmos-proposal-panel）。
 *
 * 独立纯逻辑模块——浏览器 client.jsx 消费（面板渲染）、test/panel-smoke.mjs 直测。
 * 零 DOM / 零网络：输入为 mergeScene 产出的 scene（含 `ws.path`）与两个过滤输入，
 * 输出分组卡片列表。
 *
 * 口径（spec）：
 *  - 数据源 = 既有场景骨架（恒星 + 工作区 path），零新增宿主接口；
 *  - 银河态 = 全部在册工作区的活跃提案，按工作区分组（组标题 = 星座名）；**组内按
 *    孕育时间线排列**（add-cosmos-panel-birthline-sort 4.1/4.2，修订语义）：组内按
 *    **谱系块**排序——块按星胚出生时间升序（活锚点组内最早 `at` → 台账 `embryoAt`
 *    → 兜底目录出生 `birthMs`，全缺的块殿后、块键码点序兜底）；块内星胚合并卡
 *    （仍在册时）恒打头、其点燃提案按创建顺序（`birthMs` 升序 → 台账 `ignitedMs`
 *    升序 → id 码点序）。无台账谱系的提案各自按 id 成块、以 `birthMs` 插入时间线
 *    （**不加任何视觉标注**）；**无活跃提案且无星胚锚点的工作区不生成分组**；
 *  - 钻取态 = 仅当前星座（分组标题保留；无提案时仍渲染空态）；
 *  - 待创建星胚（`lifecycle === "proto"`，即 pending 锚点）**以星胚合并卡片进入列表**：
 *    同工作区内按锚点 `sessionId` 归并为一张卡（缺失 `sessionId` 的旧锚点各自成卡），
 *    作为其谱系**块头**呈现（MUST NOT 再强制排于组内全部正式提案之后）；
 *    **星胚锚点同样触发分组**（add-cosmos-galaxy-embryo-cards D1：银河态分组条件 =
 *    活跃提案 ∨ 星胚锚点——仅星胚的工作区照常生成分组、组内仅星胚合并卡片）；星胚卡
 *    不携带 `dir`（动作链路按无目标守卫降级）；
 *  - 搜索过滤 = 分组跟随命中集合（未命中工作区的分组隐藏；命中域 = 工作区名 ∪ 星胚
 *    slug，见 merge.mjs `matchWorkspaces`）；`allCards` 不受过滤影响（正式提案 + 星胚卡），
 *    供「选中目标仍在骨架」判定与 @路径查表使用（选中分组被过滤隐藏时选中保留）；
 *  - 选中作用面 = 面板 / 动作条 / 搜索框（`isSelectionSurface`）：点击其**以外**区域
 *    取消选中（动作条熄灭）；点击其他卡片仅切换动作目标（选中态与动作条可用态保持）。
 *
 * 同文件另有**会话列表面板投影**（add-cosmos-session-list-panel）：`projectSessionPanel`
 * 消费同一份 mergeScene 产物（行星 ∪ 彗星 = 活跃会话），提供银河/钻取作用域分组、
 * 四态行数据、待决策计数与卫星徽标数据——同样零 DOM、冒烟直测。
 *
 * 进度数字对（p1-add-cosmos-card-progress-bars 1.3 / design D3 派生口径）：
 *  - 会话行 `progress` = 行 `todos` 徽标字符串的**防御解析**（`"done/total"` →
 *    `{done, total}`；`"—"`、格式外串、越界值一律 null）。格式由 merge 层
 *    `todoBadgeOf` 单点构造，本层只兜底（解析失败 = 隐藏进度条，MUST NOT 抛错）；
 *  - 提案卡 `progress` = 正式提案 `tasks` 数字对**直取**（`tasks[1] > 0` 才给值）；
 *    星胚合并卡恒 null（星胚无任务进度行纪律，spec cosmos-proposal-panel）；
 *  - 投影层只产出真实数字对，**上限退化语义不在本层**（呈现层按 `min(total, 12)` 分格、
 *    `total > 12` 时段间归零退化为连续条）。
 *
 * 另含**跨面板悬停关联派生**（p2-add-cosmos-cross-hover-markers 2.1/2.2）：
 * `crossHoverTargets` 由合流悬停描述 + 单星座 merge 产物派生受体集
 * （`{sessionIds, proposalIds}`，联星全量 / 星胚并集 / 彗星空集 / 画布源自含语义）；
 * `rowIsLinkedOf` / `cardIsLinkedOf` 为受体判定（星胚合并卡按任一 slug 命中整卡）；
 * `hoverSourceAlive` 供场景刷新残留清理守卫（源实体键仍在册判定）——全部零 DOM、
 * 零网络、冒烟直测。
 *
 * 再含**动作队列投影**（add-cosmos-action-queue 5.1–5.4 / spec cosmos-action-queue
 * 「队列呈现（面板与配套入队钮）」「条目操作矩阵与复验跳过」）：`projectQueuePanel`
 * 把服务端权威队列快照（条目投影无 prompt 正文）投影为面板行数据（徽标 / 锁定 /
 * 排序与移出/重试可用性 / title 文案）；`queueEntryLockedOf` /
 * `queueEntryRemovableOf` / `queueEntryRetryableOf` / `queueOrderFlagsOf` 为操作矩阵
 * 单一来源（前端禁用先行、服务端 400 兜底，design D6）；`queuePendingKeysOf` 供动作条
 * 配套入队钮的「已在队列中」
 * 禁用判定（**仅 queued 命中**——failed/skipped 残留不构成重复，与服务端同口径）；
 * `queueScopeOf` 决定面板作用域（钻取优先 / 选中兜底 / 空队列零布局）——同样零 DOM、
 * 零网络、冒烟直测。
 */

import { embryoGroupsOf, relativeTime, starPlanetIdsOf } from "./merge.mjs";

/** 可列出的**正式提案**生命周期（proto 星胚走独立合并卡片路径，见 `embryoKeyOf`）。 */
const LISTABLE_LIFECYCLE = new Set(["created", "reviewed", "executed"]);

/** 码点序比较（确定性字典序；不依赖运行环境 locale/ICU）。 */
function compareText(a, b) {
  const left = String(a ?? "");
  const right = String(b ?? "");
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * 提案目录绝对路径（`<ws.path>/openspec/changes/<name>`，统一正斜杠）。
 * Windows 反斜杠路径不进消息（spec「点击执行链路」：路径统一正斜杠）；重复分隔符折叠，
 * 尾部斜杠剔除。空工作区路径 → ""（调用方据此拒绝组装）。
 * @param {unknown} wsPath 工作区绝对路径（骨架/mergeScene 透传）
 * @param {unknown} name 提案目录名
 * @returns {string}
 */
export function proposalDirOf(wsPath, name) {
  const raw = typeof wsPath === "string" ? wsPath.trim() : "";
  const slug = typeof name === "string" ? name.trim() : "";
  if (!raw || !slug) return "";
  let base = raw.replace(/\\/g, "/");
  const unc = base.startsWith("//");
  base = base.replace(/\/{2,}/g, "/");
  if (unc && !base.startsWith("//")) base = "/" + base;
  base = base.replace(/\/+$/, "");
  return base + "/openspec/changes/" + slug;
}

/** 选中键（跨工作区唯一：同一提案名可同时存在于两个工作区）。 */
export function proposalKeyOf(wsId, name) {
  return String(wsId ?? "") + "\u0000" + String(name ?? "");
}

/**
 * 星胚合并卡片键（add-cosmos-embryo-cards 3.1 / design D6）：
 * `"proto"` 前缀 + wsId + 组键（NUL 分隔）——与 `proposalKeyOf` **同构**（wsId + 组键，
 * NUL 分隔）但带取值域前缀：提案键恰有一个 NUL、星胚键有两个，两域**不可能撞键**
 * （提案名不含 NUL），跨工作区同样唯一。
 * @param {unknown} wsId 工作区 id
 * @param {unknown} groupKey 星胚组键（`sessionId` 或该组唯一 slug）
 * @returns {string}
 */
export function embryoKeyOf(wsId, groupKey) {
  return "proto" + "\u0000" + String(wsId ?? "") + "\u0000" + String(groupKey ?? "");
}

/* ------------------------------------------------------------------ *
 * 谱系块装配（add-cosmos-panel-birthline-sort 4.1 / design D4）
 * ------------------------------------------------------------------ */

/** 谱系块键命名空间前缀（四族隔离，杜绝裸值跨域串块；沿用 `embryoGroupsOf` 的 NUL 分桶纪律）。 */
const BLOCK_SESSION = "session\u0000"; // 活锚点组 / 已点燃谱系组共用（同会话必须归同一块）
const BLOCK_SOLO = "solo\u0000"; // 无 sessionId 的 solo 锚点 / solo 台账行（按 slug 自立）
const BLOCK_STAR = "star\u0000"; // 无台账谱系的提案（各自成块、按 birthMs 插入时间线）

/** 正数毫秒取值（非有限 / ≤0 → null；排序兜底位的唯一取值口径）。 */
function positiveMs(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

/**
 * 提案星 → 谱系块键（纯函数）：
 *  - 台账 `embryoSessionId` 非空 → 会话族（与同会话活锚点组归同一块）；
 *  - 有台账行但 sessionId 为 null（solo 台账）→ 自律族（按 slug 自立）；
 *  - 无台账谱系 → 恒星族（各自成块，按 `birthMs` 插入时间线）。
 * @param {object} star 场景恒星（正式提案）
 * @returns {string} 命名空间化块键
 */
function blockKeyOfStar(star) {
  const id = typeof star?.id === "string" ? star.id : "";
  const sessionId = typeof star?.embryoSessionId === "string" && star.embryoSessionId ? star.embryoSessionId : null;
  if (sessionId) return BLOCK_SESSION + sessionId;
  if (positiveMs(star?.embryoAt) !== null) return BLOCK_SOLO + id;
  return BLOCK_STAR + id;
}

/**
 * 星胚合并组 → 谱系块键（纯函数）：会话族（同 `sessionId`）或自律族（solo slug）。
 * @param {{key: string, sessionId: string|null}} group `embryoGroupsOf` 产物
 * @returns {string} 命名空间化块键
 */
function blockKeyOfEmbryo(group) {
  const sessionId = typeof group?.sessionId === "string" && group.sessionId ? group.sessionId : null;
  if (sessionId) return BLOCK_SESSION + sessionId;
  return BLOCK_SOLO + String(group?.key ?? group?.slugs?.[0] ?? "");
}

/** 块内提案次序（纯函数）：`birthMs` 升序 → 台账 `ignitedMs` 升序 → id 码点序（缺失值殿后）。 */
function compareBlockStars(a, b) {
  const birthA = positiveMs(a?.birthMs);
  const birthB = positiveMs(b?.birthMs);
  if (birthA !== birthB) {
    if (birthA === null) return 1;
    if (birthB === null) return -1;
    return birthA - birthB;
  }
  const ignitedA = positiveMs(a?.ignitedMs);
  const ignitedB = positiveMs(b?.ignitedMs);
  if (ignitedA !== ignitedB) {
    if (ignitedA === null) return 1;
    if (ignitedB === null) return -1;
    return ignitedA - ignitedB;
  }
  return compareText(a?.id, b?.id);
}

/**
 * 块时间取值链（纯函数，design D4）：活锚点组内最早锚点 `at` → 台账 `embryoAt`
 * （块内最早）→ 兜底提案目录出生 `birthMs`（块内最早）→ 全缺 `null`（块殿后）。
 * @param {{embryo: object|null, stars: Array<object>}} block 谱系块
 * @returns {number|null}
 */
function blockTimeOf(block) {
  const anchorAt = positiveMs(block?.embryo?.at);
  if (anchorAt !== null) return anchorAt;
  let lineageAt = null;
  for (const star of Array.isArray(block?.stars) ? block.stars : []) {
    const at = positiveMs(star?.embryoAt);
    if (at !== null && (lineageAt === null || at < lineageAt)) lineageAt = at;
  }
  if (lineageAt !== null) return lineageAt;
  let birth = null;
  for (const star of Array.isArray(block?.stars) ? block.stars : []) {
    const ms = positiveMs(star?.birthMs);
    if (ms !== null && (birth === null || ms < birth)) birth = ms;
  }
  return birth;
}

/** 块间次序（纯函数）：块时间升序（null 殿后）→ 块键码点序兜底（确定性）。 */
function compareBlocks(a, b) {
  const timeA = a?.time ?? null;
  const timeB = b?.time ?? null;
  if (timeA !== timeB) {
    if (timeA === null) return 1;
    if (timeB === null) return -1;
    return timeA - timeB;
  }
  return compareText(a?.key, b?.key);
}

/**
 * 谱系块装配（纯函数，add-cosmos-panel-birthline-sort 4.1；独立导出供冒烟直测）。
 *
 * 把单工作区恒星集合按**孕育时间线**归块：
 *  - 块键空间 = 活锚点组 `sessionId` / solo slug → 台账 `embryoSessionId` / solo slug
 *    → 无谱系提案按 `id` 各自成块（会话族共用前缀：同一 `sessionId` 的活锚点与其点燃
 *    提案 MUST 归同一块）；
 *  - 块时间 = 活锚点组内最早 `at` → 块内最早 `embryoAt` → 块内最早 `birthMs` → null；
 *  - 块间 = 块时间升序（null 殿后）→ 块键码点序；
 *  - 块内 = 星胚合并组打头（若有）+ 提案按 `birthMs` → `ignitedMs` → id。
 *
 * 输入容错：非数组 → 空清单；无 id 的畸形恒星 / 非正式提案生命周期（proto 走星胚
 * 分组）不产块成员，SHALL NOT 抛错。
 *
 * @param {Array<object>} stars 单工作区 scene 恒星
 * @returns {Array<{key: string, embryo: object|null, stars: Array<object>, time: number|null}>}
 *          块序即呈现序；`embryo` = 该块的星胚合并组（无则 null）
 */
export function birthlineBlocksOf(stars) {
  const list = Array.isArray(stars) ? stars : [];
  const buckets = new Map(); // 块键 → { key, embryo, stars }
  const bucketOf = (key) => {
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { key, embryo: null, stars: [] };
      buckets.set(key, bucket);
    }
    return bucket;
  };
  /* 星胚合并组归块（活锚点组 → 块头卡片；组数据自 proto 星现算）。 */
  for (const group of embryoGroupsOf(list)) {
    bucketOf(blockKeyOfEmbryo(group)).embryo = group;
  }
  /* 正式提案归块（`proto` 走星胚卡片路径；非法 lifecycle 仍按 created 出卡，与投影同口径）。 */
  for (const star of list) {
    if (!star || star.lifecycle === "proto") continue;
    const id = typeof star.id === "string" && star.id ? star.id : "";
    if (!id) continue;
    bucketOf(blockKeyOfStar(star)).stars.push(star);
  }
  const blocks = [];
  for (const bucket of buckets.values()) {
    bucket.stars.sort(compareBlockStars);
    blocks.push({ key: bucket.key, embryo: bucket.embryo, stars: bucket.stars, time: blockTimeOf(bucket) });
  }
  return blocks.sort(compareBlocks);
}

/**
 * 面板投影。
 * @param {object|null} scene mergeScene 产物（`{ workspaces: [...] }`）
 * @param {object} [options]
 * @param {string|null} [options.drillWsId] 钻取态当前星座 id（null/缺省 = 银河态）
 * @param {Set<string>|string[]|null} [options.matchedIds] 搜索命中工作区 id
 *        （null/缺省 = 过滤关闭）
 * @returns {{
 *   allCards: Array<object>, groups: Array<object>, drillWsId: string|null,
 *   drillName: string, visible: boolean, hasProposals: boolean, total: number,
 *   embryoTotal: number
 * }}
 */
export function projectPanel(scene, options = {}) {
  const workspaces = Array.isArray(scene?.workspaces) ? scene.workspaces : [];
  const drillWsId = typeof options.drillWsId === "string" && options.drillWsId ? options.drillWsId : null;
  const matchedIds = options.matchedIds instanceof Set
    ? options.matchedIds
    : Array.isArray(options.matchedIds)
      ? new Set(options.matchedIds)
      : null;

  const allCards = [];
  const groups = [];
  let drillName = "";
  let drillExists = false;
  /* 计数口径（add-cosmos-embryo-cards 3.1 / add-cosmos-galaxy-embryo-cards 1.2）：
     `total` = **正式提案数**（头部徽标主口径、`hasProposals` 判据——星胚不计入）；
     `embryoTotal` = 星胚合并卡片总数，并升级为**银河态可见性输入**之一（存在星胚锚点
     即须渲染面板）。 */
  let total = 0;
  let embryoTotal = 0;

  for (const ws of workspaces) {
    const wsId = typeof ws?.id === "string" ? ws.id : "";
    if (!wsId) continue;
    const wsName = typeof ws?.name === "string" && ws.name ? ws.name : wsId;
    const wsPath = typeof ws?.path === "string" ? ws.path : "";
    if (drillWsId !== null && wsId === drillWsId) {
      drillExists = true;
      drillName = wsName;
    }
    /* 全量卡片（**不受钻取/搜索影响**）：选中校验与 @路径查表的唯一来源——
       钻取到别的星座时选中态仍归该提案（spec「选中跨视图保留」）。
       卡片装配与**呈现序**分离（add-cosmos-panel-birthline-sort 4.2）：下方谱系块
       装配决定组内次序；本循环只负责逐星建卡（键 = 提案键）。 */
    const cards = [];
    const cardOfStar = new Map(); // 恒星对象 → 提案卡片（对象身份，防同名/重复 id 串卡）
    for (const star of Array.isArray(ws?.stars) ? ws.stars : []) {
      if (star?.lifecycle === "proto") continue; // 星胚走下方合并卡片路径
      if (cardOfStar.has(star)) continue; // 同一恒星对象重复入列 → 只建一张卡（计数一致）
      const id = typeof star?.id === "string" && star.id ? star.id : "";
      if (!id) continue;
      /* tasks 数字对（`.state.json` 的完成/总数）→ 卡片进度数据（1.2）：投影层只给真实
         数字对，`y = 0`（无 tasks 文件 / 空清单）→ progress null——与 `x/y` 文本徽标的
         可见性门控（`tasks[1] > 0`）同口径，UI 侧零二次推导。 */
      const tasks = [Number(star?.tasks?.[0]) || 0, Number(star?.tasks?.[1]) || 0];
      const card = {
        key: proposalKeyOf(wsId, id),
        id,
        name: typeof star?.name === "string" && star.name ? star.name : id,
        wsId,
        wsName,
        wsPath,
        lifecycle: LISTABLE_LIFECYCLE.has(star?.lifecycle) ? star.lifecycle : "created",
        setBy: typeof star?.setBy === "string" && star.setBy ? star.setBy : null,
        at: Number(star?.at) > 0 ? Number(star.at) : null,
        tasks,
        progress: tasks[1] > 0 ? { done: tasks[0], total: tasks[1] } : null,
        /* 沉睡判据（add-cosmos-action-prestate-gate 2.1）：scene 星体已聚合 act
           （busy ∨ waiting ∨ 委托忙碌计数），投影纯加法透传。星胚的 act 口径不同
           （keep-embryo-active-while-exploring 2.2：由锚点探索会话状态推导，见下方星胚
           卡），本条只服务正式提案卡。 */
        act: Number(star?.act) || 0,
        dir: proposalDirOf(wsPath, id)
      };
      cardOfStar.set(star, card);
      total++;
    }
    /* 组内装配切为**谱系块**（add-cosmos-panel-birthline-sort 4.2）：块按孕育时间线
       升序；块内星胚合并卡打头、其点燃提案按创建顺序。星胚合并卡片（add-cosmos-embryo-cards
       3.1）仍同工作区内按锚点 `sessionId` 归并（缺失各成组），但其呈现位置由所属谱系块
       决定（MUST NOT 再强制排于组内全部正式提案之后）。 */
    const formalCount = cardOfStar.size;
    let embryoCount = 0;
    const placed = new Set();
    for (const block of birthlineBlocksOf(ws?.stars)) {
      const group = block.embryo;
      if (group) {
        const slug = group.slugs[0] ?? group.key;
        const card = {
          key: embryoKeyOf(wsId, group.key),
          /* id/name 取首 slug：DOM 钩子与 title 兜底都可读（真正的分组身份在 key 与
             `slugs`；会话归并组暴露 `sessionId` 供星胚动作链路解析目标）。 */
          id: slug,
          name: slug,
          wsId,
          wsName,
          wsPath,
          lifecycle: "proto",
          isEmbryo: true,
          sessionId: group.sessionId,
          slugs: group.slugs,
          setBy: null,
          at: group.at,
          tasks: [0, 0],
          /* 星胚合并卡 progress 恒 null（1.2）：spec 已锁星胚卡 MUST 无任务进度行（含进度条），
             组件侧按 null 自然跳过——此处显式落值，杜绝「星胚也被分母为 0 的进度条命中」。 */
          progress: null,
          /* act 透传（keep-embryo-active-while-exploring 2.2 / design D4）：组内 proto 星
             act 最大值（= 锚点探索会话是否活跃，值域 {0,1}），缺省 0 保持沉睡语义。
             动作条门控（`actionButtonVisible`）直接消费本字段：探索会话进行中
             （busy ∨ waiting ∨ 委托忙碌）→ act=1 → `preState:"proto"` 按钮不渲染。 */
          act: Number(group.act) || 0
          /* MUST NOT 携带 `dir`：星胚无提案目录，动作链路按「目标目录缺失」守卫
             拒绝执行（add-cosmos-action-prestate-gate 承接正式星胚动作）。 */
        };
        cards.push(card);
        allCards.push(card);
        embryoTotal++;
        embryoCount++;
      }
      for (const star of block.stars) {
        const card = cardOfStar.get(star);
        if (!card || placed.has(star)) continue;
        placed.add(star);
        cards.push(card);
        allCards.push(card);
      }
    }
    /* 防御补位（正常路径零触发）：块装配未覆盖的正式卡（重复 id / 畸形对象等极端输入）
       仍按骨架原序入列——MUST NOT 因排序装配丢卡（计数与选中目标一致性优先）。 */
    for (const star of Array.isArray(ws?.stars) ? ws.stars : []) {
      const card = cardOfStar.get(star);
      if (!card || placed.has(star)) continue;
      placed.add(star);
      cards.push(card);
      allCards.push(card);
    }
    if (drillWsId !== null && wsId !== drillWsId) continue;
    /* 银河态：**无活跃提案且无星胚锚点的工作区不生成分组**（自动隐藏，避免空标题
       占位）；分组条件 = 活跃提案 ∨ 星胚锚点（add-cosmos-galaxy-embryo-cards D1：仅星胚
       的工作区照常生成分组、组内仅星胚合并卡片）。星胚计数复用上面**已装配的卡片数**
       （MUST NOT 二次调用 `embryoGroupsOf`）；无 slug 的畸形锚点不产卡 → 与「无锚点」
       同口径维持隐藏。钻取态例外——当前星座既无提案也无锚点时仍渲染该分组
       （「该星座暂无提案」空态），两种口径可区分。 */
    if (drillWsId === null && formalCount === 0 && embryoCount === 0) continue;
    const matched = matchedIds === null || matchedIds.has(wsId);
    groups.push({ wsId, wsName, wsPath, cards, matched });
  }

  /* 分组顺序：星座名字典序（同名以 id 兜底）——与骨架传入顺序解耦。 */
  groups.sort((a, b) => compareText(a.wsName, b.wsName) || compareText(a.wsId, b.wsId));
  /* 搜索过滤：未命中分组隐藏（数据保留，UI 依 matched 显隐；钻取态同理）。 */
  const visibleGroups = matchedIds === null ? groups : groups.filter((group) => group.matched);

  /* 面板可见性：钻取且当前星座仍在册 → 渲染（允许空态）；银河态要求存在**活跃提案 ∨
     星胚锚点**（add-cosmos-galaxy-embryo-cards 1.2：全星胚场景照常渲染，MUST NOT 零布局；
     两者皆无 → 零布局）。`hasProposals` 保持「存在活跃提案」原语义。 */
  const visible = drillWsId !== null ? drillExists : total > 0 || embryoTotal > 0;

  return {
    allCards,
    groups: visibleGroups,
    drillWsId,
    drillName,
    drillMissing: drillWsId !== null && !drillExists,
    visible,
    hasProposals: total > 0,
    total,
    embryoTotal
  };
}

/**
 * 按选中键查卡片（`allCards` 不受钻取/搜索过滤影响：目标仍在骨架即有效）。
 * @param {{allCards?: Array<object>}|null} model projectPanel 输出
 * @param {string|null} key
 * @returns {object|null}
 */
export function findCard(model, key) {
  if (!model || !key) return null;
  const cards = Array.isArray(model.allCards) ? model.allCards : [];
  return cards.find((card) => card.key === key) ?? null;
}

/**
 * 选中态维护（纯函数）：目标从骨架消失（归档/工作区注销）→ null；仍在 → 原样保留。
 * @param {object|null} model projectPanel 输出
 * @param {string|null} key
 * @returns {string|null}
 */
export function keepSelection(model, key) {
  if (!key) return null;
  return findCard(model, key) ? key : null;
}

/** 「选中目标的作用面」= 面板（卡片切换 / 列表滚动）、动作条（按钮作用于选中目标）、
    搜索框（过滤联动，选中需跨过滤保留）。**点击这些区域 MUST NOT 清除选中**；
    页面其余区域（银河画布、星座卡片、信息卡、左下「＋」、回到银河…）点击即取消选中。 */
export const SELECTION_SURFACE_SELECTOR = ".dsh-cosmos-panel, .dsh-cosmos-actions, .cos-search";

/**
 * 点击是否落在「选中作用面」内（纯函数，供冒烟直测；客户端点击探针消费）。
 * 鼠标目标可能不是 Element（文本节点等）→ 无 `closest` 时按「非作用面」处理（清除选中），
 * 异常同样保守回落 false（MUST NOT 因探针抛错阻断点击）。
 * @param {unknown} target 事件目标（Element 或任意）
 * @returns {boolean} true = 保留选中
 */
export function isSelectionSurface(target) {
  if (!target || typeof target.closest !== "function") return false;
  try {
    return target.closest(SELECTION_SURFACE_SELECTOR) !== null;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * 会话列表面板投影（add-cosmos-session-list-panel 1.1/1.2 /
 * spec cosmos-session-list「视图作用域与分组投影」「活跃口径与行内容」）
 *
 * 数据源 = mergeScene 产出的 scene（`workspaces[].planets`/`comets`）：renderable 口径
 * （非 blank / 非归档 / 非子代理 / 已归属工作区）在 merge 层已成立——「活跃」即行星 ∪
 * 彗星，卫星（子代理会话）天然不产行（卫星进 `satellites`，折叠计数在 `satelliteCount`）。
 * 零 DOM / 零网络 / 零新增宿主接口：与 `projectPanel` 同一「纯函数投影 + 冒烟直测」纪律。
 *
 * 作用域：银河态 = 全部有活跃会话的星座分组（无会话星座不占位，自动隐藏）；钻取态 = 仅当前
 * 星座（无会话仍保留分组标题 + 空态）。组内显式按 `updatedAt` 降序、同分以 id 字典序兜底
 * ——不隐式依赖 merge 的输入序（与 proposal 投影的确定性纪律同构）。
 * ------------------------------------------------------------------ */

/**
 * 会话行键（跨星座唯一；与引擎选中通道 `{kind, wsId, id}` 同源，选中联动据此映射行）。
 * @param {unknown} wsId 工作区 id
 * @param {unknown} sessionId 会话 id
 * @returns {string}
 */
export function sessionKeyOf(wsId, sessionId) {
  return String(wsId ?? "") + "\u0000" + String(sessionId ?? "");
}

/**
 * 待处理分类归一：宿主 `pendingInteraction.kind` 的枚举是 `approval / plan-review /
 * question`（宿主 `ui-workspace` 行语法实证；历史/别名写法 `plan` 一并接受），
 * 本插件行语法与 DSH 三分类同构（approval→待审批 / plan→计划待审 / question→待回答）。
 * 未知 kind 但仍在等待 → "other"（UI 显示通用「待处理」，MUST NOT 丢点）。
 * @param {unknown} kind
 * @returns {"approval"|"plan"|"question"|"other"}
 */
export function pendingCategoryOf(kind) {
  if (kind === "approval") return "approval";
  if (kind === "plan" || kind === "plan-review") return "plan";
  if (kind === "question") return "question";
  return "other";
}

/**
 * 行显示态（四态优先级 + DSH 委托 loader 口径，design D3）：
 *  - waiting 恒最高（pendingInteraction 优先于 ongoing loader）；
 *  - loader = 自身 busy ∨ 委托执行中（场景 `delegatedBusy`：父待机 ∧ 直属子代理 busy）；
 *  - done-unread 次之；其余 idle（行内无状态点）。
 * 状态来源 = 场景 `planetStateOf` 已推导的 `state`（不二次推导；statuses 不可达时场景
 * 自然只有 idle/busy 两态 → 本函数原样透传，降级路径零分支）。
 * @param {unknown} state 场景四态
 * @param {unknown} delegatedBusy 委托执行中标记
 * @returns {"waiting"|"busy"|"done-unread"|"idle"}
 */
export function sessionRowStateOf(state, delegatedBusy) {
  if (state === "waiting") return "waiting";
  if (state === "busy" || delegatedBusy === true) return "busy";
  if (state === "done-unread") return "done-unread";
  return "idle";
}

/**
 * todos 徽标字符串 → 进度数字对（`"done/total"` → `{done, total}`；其余 → null）。
 *
 * 格式由 merge 层 `todoBadgeOf` 单点构造（`done + "/" + total` 或 `"—"`，无第三形态），
 * 本函数只做**防御解析**（design D3）：`"—"`、格式外串、越界值（`done > total`、
 * `total ≤ 0`、超出安全整数）一律 null——呈现层据此隐藏进度条，MUST NOT 抛错。
 * 上限退化（`total > 12` 时段间归零连续条）属呈现层规则，投影层恒给真实数字对。
 * @param {unknown} text 行 `todos` 徽标字符串
 * @returns {{done: number, total: number}|null}
 */
function progressOfTodos(text) {
  if (typeof text !== "string") return null;
  const match = /^(\d+)\/(\d+)$/.exec(text);
  if (!match) return null;
  const done = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isSafeInteger(done) || !Number.isSafeInteger(total)) return null;
  if (total <= 0 || done > total) return null;
  return { done, total };
}

/**
 * 单会话行装配（行星/彗星共用；高亮字段 = 标题/形态/状态/待处理分类/相对时间/todos/
 * 进度数字对/卫星计数——UI 零二次推导）。id 缺失 → null（跳过）。
 * @param {string} wsId
 * @param {string} wsName
 * @param {object} body 场景天体（`ws.planets[]` / `ws.comets[]`）
 * @param {"planet"|"comet"} kind 形态（行星 = 有关联提案；彗星 = 自由会话）
 * @returns {object|null}
 */
function sessionRowOf(wsId, wsName, body, kind) {
  const id = typeof body?.id === "string" && body.id ? body.id : "";
  if (!id) return null;
  const state = sessionRowStateOf(body?.state, body?.delegatedBusy);
  /* todos 徽标字符串（merge 层装配）→ 进度数字对（1.1）：`"—"`/格式外/越界 → null，
     行内据此不渲染进度条（文本徽标仍按原门控呈现——条是比例增强，非数字替代）。 */
  const todos = typeof body?.todos === "string" && body.todos ? body.todos : "—";
  return {
    key: sessionKeyOf(wsId, id),
    id,
    wsId,
    wsName,
    kind,
    title: typeof body?.title === "string" && body.title ? body.title : id,
    state,
    /* 分类文案只在 waiting 期间替换尾注（DSH 口径）：非 waiting 一律 null。 */
    pendingKind: state === "waiting" ? pendingCategoryOf(body?.pendingKind) : null,
    when: typeof body?.when === "string" && body.when ? body.when : "—",
    updatedAt: Number(body?.updatedAt) || 0,
    todos,
    progress: progressOfTodos(todos),
    satelliteCount: Math.max(0, Math.round(Number(body?.satelliteCount) || 0)),
    delegatedBusy: body?.delegatedBusy === true,
    proposalCount: Array.isArray(body?.stars) ? body.stars.length : 0
  };
}

/** 行排序（组内 / 全量同一口径）：`updatedAt` 降序，同分以 wsId + id 字典序兜底。 */
function compareSessionRows(a, b) {
  const delta = (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  if (delta !== 0) return delta;
  return compareText(a.wsId, b.wsId) || compareText(a.id, b.id);
}

/**
 * 会话列表面板投影（纯函数）。
 *
 * 输出形状：
 *  - `groups`：作用域内分组（`{wsId, wsName, sessions, count}`）；银河态只有非空分组，
 *    钻取态恒有当前星座分组（无会话也保留，空态文案由 UI 给）；
 *  - `allSessions`：**不受钻取影响**的全部活跃行（标题栏徽标计数与跨视图查表来源）；
 *    行内 `progress` 为 `todos` 徽标字符串的防御解析结果（`{done, total}` 或 null，
 *    见 `progressOfTodos`）——UI 只用它判「是否渲染进度条」，数字徽标仍取 `todos` 文本；
 *  - `total` = 全量活跃会话数；`scopeTotal` = 当前作用域行数（面板标题计数）；
 *  - `waiting` = 全量待决策计数（**全局**：钻取到无待决策星座时标题栏徽标不应消失）；
 *  - `drillWsId`/`drillName`/`drillMissing`：钻取态镜像（目标注销 → missing + 无分组）；
 *  - `visible`：面板本体恒可用（空态保留面板与标题栏，与提案面板「无提案零布局」刻意不同）。
 *
 * @param {object|null} scene mergeScene 产物（`{ workspaces: [...] }`）
 * @param {object} [options]
 * @param {string|null} [options.drillWsId] 钻取态当前星座 id（null/缺省 = 银河态）
 * @returns {{
 *   groups: Array<{wsId: string, wsName: string, sessions: Array<object>, count: number}>,
 *   allSessions: Array<object>, total: number, scopeTotal: number, waiting: number,
 *   drillWsId: string|null, drillName: string, drillMissing: boolean, visible: boolean
 * }}
 */
export function projectSessionPanel(scene, options = {}) {
  const workspaces = Array.isArray(scene?.workspaces) ? scene.workspaces : [];
  const drillWsId = typeof options.drillWsId === "string" && options.drillWsId ? options.drillWsId : null;

  const allSessions = [];
  const groups = [];
  let drillName = "";
  let drillFound = false;

  for (const ws of workspaces) {
    const wsId = typeof ws?.id === "string" ? ws.id : "";
    if (!wsId) continue;
    const wsName = typeof ws?.name === "string" && ws.name ? ws.name : wsId;
    const rows = [];
    for (const planet of Array.isArray(ws?.planets) ? ws.planets : []) {
      const row = sessionRowOf(wsId, wsName, planet, "planet");
      if (row) rows.push(row);
    }
    for (const comet of Array.isArray(ws?.comets) ? ws.comets : []) {
      const row = sessionRowOf(wsId, wsName, comet, "comet");
      if (row) rows.push(row);
    }
    rows.sort(compareSessionRows);
    allSessions.push(...rows);
    if (drillWsId !== null && wsId !== drillWsId) continue;
    if (drillWsId !== null) {
      drillFound = true;
      drillName = wsName;
    }
    /* 银河态：无活跃会话的星座不生成分组（自动隐藏，避免空标题占位）；
       钻取态例外——当前星座无会话时仍渲染该分组 + 空态（与提案面板同款纪律）。 */
    if (drillWsId === null && rows.length === 0) continue;
    groups.push({ wsId, wsName, sessions: rows, count: rows.length });
  }

  /* 分组顺序：星座名字典序（同名以 id 兜底）——与骨架传入顺序解耦。 */
  groups.sort((a, b) => compareText(a.wsName, b.wsName) || compareText(a.wsId, b.wsId));
  allSessions.sort(compareSessionRows);

  const scopeTotal = groups.reduce((sum, group) => sum + group.sessions.length, 0);
  const waiting = allSessions.reduce((sum, row) => sum + (row.state === "waiting" ? 1 : 0), 0);

  return {
    groups,
    allSessions,
    total: allSessions.length,
    scopeTotal,
    waiting,
    drillWsId,
    drillName,
    drillMissing: drillWsId !== null && !drillFound,
    visible: true
  };
}

/* ------------------------------------------------------------------ *
 * 跨面板悬停关联派生（p2-add-cosmos-cross-hover-markers 2.1/2.2 / design D2/D3）
 *
 * 输入 = 合流悬停描述（`{source, wsId, kind, id, slugs?}`）+ 单星座 merge 产物；
 * 输出 = 受体集（`{sessionIds, proposalIds}`）。口径：
 *  - 源 `kind = star`（正式卡 / 画布恒星 / 画布星胚）：`sessionIds` 取反向索引
 *    `starPlanetIdsOf` 全量；`proposalIds` 取 `ws.links`（恒星**索引对**，先经
 *    `ws.stars[索引].id` 映射）中与该星共享会话的**其他**恒星 id（排除自身）——
 *    镜像画布 relSet 的星↔星共享段，保证「同实体同亮面」；
 *  - 源 `kind = planet`：`proposalIds = planet.stars` 全量（联星不截断）；画布源
 *    （`source = "canvas"`）时 `sessionIds` 含自身会话 id（对应行 `<`），DOM 源不含；
 *  - 源 `kind = comet`：`proposalIds` 为空；画布源时 `sessionIds` 含自身（彗星无关联
 *    卡，仅画布对应行 `<`）；
 *  - 源 = 星胚合并卡（`source = "embryo"`，slug 清单）：`sessionIds` = 各 slug 反查
 *    会话的并集；不注入引擎、无 `proposalIds`（多 slug 无单一注入目标）；
 *  - 派生以 `wsId` 为界：悬停源属其他星座 → 空集（跨工作区天然无标记）。
 *
 * 纯函数：零 DOM、零网络、不修改入参；非法输入一律空集（MUST NOT 抛错）。
 * ------------------------------------------------------------------ */

/** 空受体集（每次新对象：调用方可安全持有）。 */
function emptyTargets() {
  return { sessionIds: [], proposalIds: [] };
}

/** 数组去重（保留首次出现序；空值剔除）。 */
function uniqueIds(list) {
  const out = [];
  for (const id of list) {
    if (typeof id !== "string" || !id) continue;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * 跨面板悬停关联受体派生（design D2）。
 * @param {{source?: string, wsId?: string, kind?: string, id?: string, slugs?: string[]}|null} hover
 *        合流悬停描述（source ∈ row | card | embryo | canvas）
 * @param {object|null} ws 单星座 merge 产物（`{id, stars, links, planets, comets}`）
 * @returns {{sessionIds: string[], proposalIds: string[]}}
 */
export function crossHoverTargets(hover, ws) {
  if (!hover || typeof hover !== "object" || !ws || typeof ws !== "object") return emptyTargets();
  const wsId = typeof ws.id === "string" ? ws.id : "";
  if (!wsId || hover.wsId !== wsId) return emptyTargets(); // 跨工作区隔离
  const source = typeof hover.source === "string" ? hover.source : "";
  const canvas = source === "canvas";
  const id = typeof hover.id === "string" ? hover.id : "";

  /* 星胚合并卡源（多 slug；不注入引擎，只参与行标记派生）。
     `warp` 源额外把 slug 清单注入 `proposalIds`：曲率条目行 hover 时联动**该星胚合并
     卡本身**（星胚卡受体判定按 slug 命中，见 `cardIsLinkedOf`）——其余源保持仅会话行
     联动（既有行为逐字不变）。 */
  if (source === "embryo" || hover.kind === "proto") {
    const slugs = Array.isArray(hover.slugs)
      ? hover.slugs
      : (id ? [id] : []);
    if (slugs.length === 0) return emptyTargets();
    const starPlanetMap = starPlanetIdsOf(ws);
    const sessionIds = [];
    for (const slug of slugs) {
      if (typeof slug !== "string" || !slug) continue;
      sessionIds.push(...(starPlanetMap.get(slug) ?? []));
    }
    return {
      sessionIds: uniqueIds(sessionIds),
      proposalIds: source === "warp" ? uniqueIds(slugs) : []
    };
  }

  /* 恒星源（正式卡 / 画布恒星）：关联会话行 `<` + 共享会话星卡 `>`（排除自身）。 */
  if (hover.kind === "star") {
    if (!id) return emptyTargets();
    const starPlanetMap = starPlanetIdsOf(ws);
    const sessionIds = uniqueIds(starPlanetMap.get(id) ?? []);
    const stars = Array.isArray(ws.stars) ? ws.stars : [];
    const links = Array.isArray(ws.links) ? ws.links : [];
    const shared = [];
    for (const pair of links) {
      const left = Number(pair?.[0]);
      const right = Number(pair?.[1]);
      if (!Number.isInteger(left) || !Number.isInteger(right)) continue;
      const leftId = typeof stars[left]?.id === "string" ? stars[left].id : "";
      const rightId = typeof stars[right]?.id === "string" ? stars[right].id : "";
      if (leftId === id && rightId && rightId !== id) shared.push(rightId);
      else if (rightId === id && leftId && leftId !== id) shared.push(leftId);
    }
    return { sessionIds, proposalIds: uniqueIds(shared) };
  }

  /* 行星源：星卡 `>` 全量（联星不截断）；画布源时自身对应行 `<`。 */
  if (hover.kind === "planet") {
    if (!id) return emptyTargets();
    const planets = Array.isArray(ws.planets) ? ws.planets : [];
    const planet = planets.find((entry) => entry && entry.id === id) ?? null;
    const proposalIds = [];
    for (const entry of Array.isArray(planet?.stars) ? planet.stars : []) {
      const proposalId = typeof entry === "string" ? entry : (entry && typeof entry.id === "string" ? entry.id : "");
      if (proposalId) proposalIds.push(proposalId);
    }
    return {
      sessionIds: canvas ? [id] : [],
      proposalIds: uniqueIds(proposalIds)
    };
  }

  /* 彗星源：无关联提案卡；画布源时自身对应行 `<`。 */
  if (hover.kind === "comet") {
    return { sessionIds: canvas && id ? [id] : [], proposalIds: [] };
  }

  return emptyTargets();
}

/**
 * 会话行受体判定（tasks 2.2）：`row.id ∈ sessionIds` 且属同一星座。
 * 悬停源自身行不标由派生口径保证（DOM 行源 `sessionIds` 为空集）。
 * @param {{wsId?: string, sessionIds?: string[]}|null} crossHover 合流描述（叠加受体集）
 * @param {{wsId?: string, id?: string}|null} row 会话行
 * @returns {boolean}
 */
export function rowIsLinkedOf(crossHover, row) {
  if (!crossHover || !row || typeof row !== "object") return false;
  if (!crossHover.wsId || row.wsId !== crossHover.wsId) return false;
  const sessionIds = Array.isArray(crossHover.sessionIds) ? crossHover.sessionIds : [];
  return typeof row.id === "string" && sessionIds.includes(row.id);
}

/**
 * 提案卡受体判定（tasks 2.2）：正式卡 `card.id ∈ proposalIds`；星胚合并卡
 * 「任一 slug ∈ proposalIds → 整卡」（不逐 slug 拆分）。源卡自身不标由派生口径保证
 * （恒星源 `proposalIds` 排除自身）。
 * @param {{wsId?: string, proposalIds?: string[]}|null} crossHover 合流描述（叠加受体集）
 * @param {{wsId?: string, id?: string, isEmbryo?: boolean, slugs?: string[]}|null} card 提案卡
 * @returns {boolean}
 */
export function cardIsLinkedOf(crossHover, card) {
  if (!crossHover || !card || typeof card !== "object") return false;
  if (!crossHover.wsId || card.wsId !== crossHover.wsId) return false;
  const proposalIds = Array.isArray(crossHover.proposalIds) ? crossHover.proposalIds : [];
  if (card.isEmbryo === true) {
    const slugs = Array.isArray(card.slugs) ? card.slugs : [];
    return slugs.some((slug) => typeof slug === "string" && proposalIds.includes(slug));
  }
  return typeof card.id === "string" && proposalIds.includes(card.id);
}

/**
 * 悬停源存活判定（design D6 / tasks 3.2）：场景刷新后源实体键（源行键/源卡键）是否仍
 * 在新清单。归档/摘除 → false（合流层据此清除悬停并注入 null，防悬停残影）。
 *
 * 画布源恒按画布口径判定（`source = "canvas"` 时 proto 恒星也在册）；DOM 卡源只认
 * 正式恒星（proto 走星胚合并卡 `kind = "proto"` 分支）。
 * @param {{workspaces?: Array<object>}|null} scene mergeScene 产物
 * @param {{source?: string, wsId?: string, kind?: string, id?: string, slugs?: string[]}|null} hover 悬停描述
 * @returns {boolean}
 */
export function hoverSourceAlive(scene, hover) {
  if (!hover || typeof hover !== "object") return false;
  const workspaces = Array.isArray(scene?.workspaces) ? scene.workspaces : [];
  const ws = workspaces.find((entry) => entry && entry.id === hover.wsId) ?? null;
  if (!ws) return false;
  const id = typeof hover.id === "string" ? hover.id : "";
  const hasBody = (list) => Array.isArray(list) && list.some((entry) => entry && entry.id === id);
  if (hover.kind === "proto" || hover.source === "embryo") {
    const slugs = Array.isArray(hover.slugs) ? hover.slugs : (id ? [id] : []);
    const stars = Array.isArray(ws.stars) ? ws.stars : [];
    return stars.some((star) => star && star.lifecycle === "proto" && slugs.includes(star.id));
  }
  if (hover.kind === "star") {
    const stars = Array.isArray(ws.stars) ? ws.stars : [];
    /* 存活口径（add-cosmos-action-queue 5.2）：`canvas` 与 `queue` 源都认 proto 恒星
       ——队列条目可指向星胚提案（`preState: "proto"` 按钮同样可入队），其源实体在册
       判定必须与画布同口径；`card` 源仍不认 proto（星胚在面板走合并卡分支）。 */
    return stars.some((star) => star && star.id === id
      && (hover.source === "canvas" || hover.source === "queue" || hover.source === "warp" || star.lifecycle !== "proto"));
  }
  if (hover.kind === "planet") return hasBody(ws.planets);
  if (hover.kind === "comet") return hasBody(ws.comets);
  return false;
}

/* ------------------------------------------------------------------ *
 * 动作队列投影（add-cosmos-action-queue 5.1–5.4 / spec cosmos-action-queue
 * 「队列呈现（面板与配套入队钮）」「条目操作矩阵与复验跳过」「持久化与多窗口广播」/ design D6/D7）
 *
 * 数据源 = 服务端权威队列快照（`GET /api/dsh-v-cosmos/queue`；多窗口经 SSE
 * `queue-changed` 轻帧拉全量对账）。本层只做**呈现投影**（浏览器端 MUST NOT 持有权威
 * 队列状态，design D1）：
 *  - 条目投影**无 prompt 正文**（执行快照在服务端，浏览器只拿元数据）；
 *  - 操作矩阵（排序 / 移出 / 清空的可用性）在此单点判定——UI 禁用先行、服务端 400
 *    兜底（design D6）；`executing`（含「等待决策」子态）条目完全锁定（v1 无中止入口）；
 *  - 空队列 → `visible:false`（调用方整面板不渲染 = 零布局、无占位）。
 * 纯函数：零 DOM、零网络、不修改入参；非法输入一律空投影（MUST NOT 抛错）。
 * ------------------------------------------------------------------ */

/**
 * 条目状态 → 徽标（`data-badge` 呈现键 + 文案）。`executing` 的两个**呈现子态**在
 * `queueBadgeOf` 里按 `subState` 二次分派：`waiting` = 琥珀「等待决策」、
 * `running` / 缺省 = 「执行中」——子态不落枚举（spec「每星座单队列模型」）。
 */
export const QUEUE_BADGES = Object.freeze({
  queued: Object.freeze({ key: "queued", label: "等待" }),
  launching: Object.freeze({ key: "running", label: "执行中" }),
  executing: Object.freeze({ key: "running", label: "执行中" }),
  waiting: Object.freeze({ key: "waiting", label: "等待决策" }),
  waitingDependency: Object.freeze({ key: "waiting-dependency", label: "等待依赖" }),
  failed: Object.freeze({ key: "failed", label: "失败" }),
  skipped: Object.freeze({ key: "skipped", label: "跳过" })
});

/** 未知状态兜底徽标（上游形状漂移时可见、可诊断；MUST NOT 伪装成等待 / 执行中）。 */
const QUEUE_BADGE_UNKNOWN = Object.freeze({ key: "unknown", label: "未知" });

/** 计数口径的状态域（`active` = 计入在途上限的三态，与服务端 `queueCountsOf` 同口径）。 */
const QUEUE_STATE_KEYS = Object.freeze(["queued", "launching", "executing", "failed", "skipped"]);

/** 计数键全集（服务端 `counts` 透传的防御归一域）。 */
const QUEUE_COUNT_KEYS = Object.freeze(["total", "queued", "launching", "executing", "failed", "skipped", "active"]);

/**
 * 条目状态归一（未知值 → ""，所有判定按「未知」保守处理：既不放行操作、也不误标态）。
 * @param {unknown} entry
 * @returns {string}
 */
function queueStateOf(entry) {
  const state = typeof entry?.state === "string" ? entry.state : "";
  return QUEUE_STATE_KEYS.includes(state) ? state : "";
}

/**
 * 徽标解析：`executing + subState = "waiting"` → 「等待决策」（琥珀）；
 * `queued + subState = "waiting-dependency"` → 「等待依赖 <前置提案名>」（依赖未达标，
 * 第二件提案 second-add-cross-proposal-dependency-gating 3.2；与「等待决策」同族呈现
 * 子态，不落枚举）；其余按 state 取表，未知状态 → 「未知」兜底。
 * @param {unknown} entry
 * @param {{dependency: string}|null} [labels] 等待依赖文案覆盖（词典注入；缺省中文）
 * @returns {{key: string, label: string}}
 */
function queueBadgeOf(entry, labels = null) {
  const state = queueStateOf(entry);
  if (state === "executing" && entry?.subState === "waiting") return QUEUE_BADGES.waiting;
  if (state === "queued" && entry?.subState === "waiting-dependency") {
    const base = labels !== null && typeof labels?.dependency === "string" && labels.dependency
      ? labels.dependency
      : QUEUE_BADGES.waitingDependency.label;
    const dep = typeof entry?.waiting?.dep === "string" ? entry.waiting.dep : "";
    return { key: QUEUE_BADGES.waitingDependency.key, label: dep ? base + " " + dep : base };
  }
  return QUEUE_BADGES[state] ?? QUEUE_BADGE_UNKNOWN;
}

/**
 * 条目锁定判定（spec「条目操作矩阵与复验跳过」）：`launching` / `executing`（含
 * 「等待决策」子态）→ true——排序、移出、清空全部禁用（v1 SHALL NOT 提供中止入口）。
 * @param {unknown} entry
 * @returns {boolean}
 */
export function queueEntryLockedOf(entry) {
  const state = queueStateOf(entry);
  return state === "launching" || state === "executing";
}

/**
 * 条目可移出判定：`queued` 与终态残留（`failed` / `skipped`）可移出；executing 锁定；
 * 未知状态不可操作（防御：MUST NOT 放行未知态）。
 * @param {unknown} entry
 * @returns {boolean}
 */
export function queueEntryRemovableOf(entry) {
  const state = queueStateOf(entry);
  return state === "queued" || state === "failed" || state === "skipped";
}

/**
 * 条目可重试判定（spec「条目操作矩阵与复验跳过」/ two-add-cosmos-queue-failed-entry-retry）：
 * **仅 `failed`** 残留可重试（skipped 不提供重试——复验跳过语义下经入队钮重新排队即可）；
 * 未知状态不可操作（防御：MUST NOT 放行未知态）。
 * @param {unknown} entry
 * @returns {boolean}
 */
export function queueEntryRetryableOf(entry) {
  return queueStateOf(entry) === "failed";
}

/**
 * 排序可用性（spec「条目排序 SHALL 仅对 queued 条目可用」；邻位非 queued 时服务端拒绝，
 * 前端同口径禁用）：仅当**自身 queued** 且相邻条目存在且同样 queued 时放行。
 * @param {unknown} entries 队列条目数组（服务端顺序）
 * @param {number} index 条目下标
 * @returns {{canMoveUp: boolean, canMoveDown: boolean}}
 */
export function queueOrderFlagsOf(entries, index) {
  const list = Array.isArray(entries) ? entries : [];
  const position = Number.isInteger(index) ? index : -1;
  if (position < 0 || position >= list.length) return { canMoveUp: false, canMoveDown: false };
  if (queueStateOf(list[position]) !== "queued") return { canMoveUp: false, canMoveDown: false };
  const prev = position > 0 ? list[position - 1] : null;
  const next = position + 1 < list.length ? list[position + 1] : null;
  return {
    canMoveUp: queueStateOf(prev) === "queued",
    canMoveDown: queueStateOf(next) === "queued"
  };
}

/**
 * 入队键（跨工作区唯一：同一提案名 / 按钮名可同时存在于两个星座）：NUL 分隔三元组，
 * 与 `proposalKeyOf` 同族（NUL 不进提案名 / 按钮名）。
 * @param {unknown} wsId 工作区 id
 * @param {unknown} proposalId 提案目录名
 * @param {unknown} buttonName 动作按钮名
 * @returns {string}
 */
export function queueEnqueuedKeyOf(wsId, proposalId, buttonName) {
  return String(wsId ?? "") + "\u0000" + String(proposalId ?? "") + "\u0000" + String(buttonName ?? "");
}

/**
 * 队列条目读取（防御两种上游形状）：单星座队列（`{entries}`）或全量快照（`{queues}`）；
 * 其余（null / 畸形）→ 空数组。全量快照按 `Object.values` 顺序拼接（呈现只用于键集
 * 与计数，顺序无语义）。
 * @param {unknown} queue
 * @returns {Array<object>}
 */
function queueEntriesOf(queue) {
  if (!queue || typeof queue !== "object") return [];
  if (Array.isArray(queue.entries)) return queue.entries;
  const queues = queue.queues;
  if (!queues || typeof queues !== "object" || Array.isArray(queues)) return [];
  const entries = [];
  for (const value of Object.values(queues)) {
    if (value && typeof value === "object" && Array.isArray(value.entries)) entries.push(...value.entries);
  }
  return entries;
}

/**
 * 单星座队列解析：`queue` 既可为单队列对象（已按作用域取好），也可为全量快照
 * （`{queues}`，按 `wsId` 取）。缺失 / 畸形 → null。
 * @param {unknown} queue
 * @param {string} wsId
 * @returns {object|null}
 */
function queueQueueOf(queue, wsId) {
  if (!queue || typeof queue !== "object") return null;
  if (Array.isArray(queue.entries)) return queue;
  const queues = queue.queues;
  if (!queues || typeof queues !== "object" || Array.isArray(queues)) return null;
  const found = typeof wsId === "string" && wsId ? queues[wsId] : null;
  return found && typeof found === "object" ? found : null;
}

/**
 * 「已在队列中」键集（动作条配套入队钮的禁用判定）：**仅 `state === "queued"` 的条目
 * 计入**——failed / skipped 残留不构成重复（spec「每星座单队列模型」：残留经移出 /
 * 清空清理，与服务端重复判定同口径）。缺字段的畸形条目不产生键（MUST NOT 拼出
 * 跨条目碰撞的空键）。
 * @param {unknown} queue 单星座队列或全量快照（`{queues}`）
 * @returns {Set<string>}
 */
export function queuePendingKeysOf(queue) {
  const keys = new Set();
  for (const entry of queueEntriesOf(queue)) {
    if (entry?.state !== "queued") continue;
    const wsId = typeof entry.wsId === "string" ? entry.wsId : "";
    const proposalId = typeof entry.proposalId === "string" ? entry.proposalId : "";
    const buttonName = typeof entry.buttonName === "string" ? entry.buttonName : "";
    if (!wsId || !proposalId || !buttonName) continue;
    keys.add(queueEnqueuedKeyOf(wsId, proposalId, buttonName));
  }
  return keys;
}

/**
 * 队列面板作用域（design D7 / 显式设计决策）：`drillWsId ?? selectedWsId ?? null`——
 * 钻取态恒显示钻取星座；银河态随**选中提案所属星座**显示（面板是动作条的配套面，
 * 无选中即无动作目标，也就没有该显示的队列）；两者皆无 → null（不渲染）。
 * 作用域星座的队列不存在 / 为空（`entries` 长度 0）→ null（spec「空队列零布局」）。
 * @param {object} [input]
 * @param {string|null} [input.drillWsId] 钻取星座 id
 * @param {string|null} [input.selectedWsId] 选中提案所属星座 id
 * @param {object|null} [input.queues] 全量快照的 `queues` 映射
 * @returns {string|null} 作用域星座 id
 */
export function queueScopeOf(input = {}) {
  const drillWsId = typeof input?.drillWsId === "string" && input.drillWsId ? input.drillWsId : null;
  const selectedWsId = typeof input?.selectedWsId === "string" && input.selectedWsId ? input.selectedWsId : null;
  const wsId = drillWsId ?? selectedWsId ?? null;
  if (wsId === null) return null;
  const queues = input?.queues;
  if (!queues || typeof queues !== "object" || Array.isArray(queues)) return null;
  const queue = queues[wsId];
  if (!queue || typeof queue !== "object") return null;
  const entries = Array.isArray(queue.entries) ? queue.entries : [];
  return entries.length > 0 ? wsId : null;
}

/**
 * 按 entries 现算计数（服务端 `counts` 缺失 / 畸形时的防线；口径与服务端一致：
 * `active` = queued + launching + executing，failed / skipped 残留不计入上限）。
 * @param {Array<object>} entries
 * @returns {{total: number, queued: number, launching: number, executing: number, failed: number, skipped: number, active: number}}
 */
function queueCountsByEntries(entries) {
  const counts = { total: entries.length, queued: 0, launching: 0, executing: 0, failed: 0, skipped: 0 };
  for (const entry of entries) {
    const state = queueStateOf(entry);
    if (state) counts[state] += 1;
  }
  counts.active = counts.queued + counts.launching + counts.executing;
  return counts;
}

/**
 * 计数归一：服务端 `counts` 优先（透传 = 服务端权威口径），逐键缺失 / 非数值时按
 * entries 现算兜底（MUST NOT 因上游缺字段让面板显示 0）。
 * @param {object|null} queue 单星座队列
 * @param {Array<object>} entries
 * @returns {{total: number, queued: number, launching: number, executing: number, failed: number, skipped: number, active: number}}
 */
function queueCountsOf(queue, entries) {
  const computed = queueCountsByEntries(entries);
  const source = queue?.counts !== null && typeof queue?.counts === "object" && !Array.isArray(queue.counts)
    ? queue.counts
    : {};
  const counts = {};
  for (const key of QUEUE_COUNT_KEYS) {
    const value = Number(source?.[key]);
    counts[key] = Number.isFinite(value) && value >= 0 ? Math.floor(value) : computed[key];
  }
  return counts;
}

/**
 * 停机分类处置的原因族 → 诊断行文案（one-add-cosmos-queue-stop-reason-policy 6.1）。
 *
 * 行内诊断由服务端 `message`（已含事实与错误码）+ 既有 `(reason)` 组成；命中本表的
 * 原因族追加可读族标签，让「截断耗尽 / 欠费 / 回合错误 / 用户停止」在残留行里一眼可辨。
 * 客户端可经 `projectQueuePanel({stopLabels})` / `projectWarpPanel({stopLabels})` 注入
 * 词典文案（zh/en），缺省即本表（与徽标等既有面板文案同口径恒中文）。
 */
export const STOP_REASON_LABELS = Object.freeze({
  "turn-quota": "欠费停机",
  "turn-error": "回合错误",
  "turn-aborted": "用户停止",
  "turn-interrupted": "回合中断",
  "turn-blocked": "回合阻塞",
  "turn-max-tokens-exhausted": "截断耗尽"
});

/**
 * 停机原因族 → 诊断行文案（`projectQueuePanel` / `projectWarpPanel` 的 `stopLabels` 选项）。
 */
function stopLabelsOf(options) {
  const labels = options?.stopLabels;
  return labels !== null && typeof labels === "object" ? labels : null;
}

/**
 * 依赖等待原因 → 行内诊断文案（second-add-cross-proposal-dependency-gating 3.1/3.2）。
 *
 * 原因恒由**依赖提案当前生命周期与其队列条目在册态**实时推导（MUST NOT 新增持久状态）：
 *  - `repair`：前置条目 failed / skipped → 等修复（`failed → queued` 重试成功或将前置
 *    手动推进后经同一触发沿唤醒）；
 *  - 缺失：正常等待前置推进（不附原因）。
 * 客户端可经 `projectQueuePanel({waitLabels})` / `projectWarpPanel({waitLabels})` 注入
 * 词典文案（zh / en），`dependency` 键覆盖「等待依赖」徽标前缀。
 */
export const WAIT_REASON_LABELS = Object.freeze({
  repair: "等修复"
});

/** 等待文案覆盖选择（`waitLabels` 选项；缺省中文基线）。 */
function waitLabelsOf(options) {
  const labels = options?.waitLabels;
  return labels !== null && typeof labels === "object" ? labels : null;
}

/**
 * 等待原因文案（缺省基线 + 词典覆盖；`null` = 无原因）。
 * @param {unknown} reason 原因码（`repair`）
 * @param {{repair?: string}|null} [labels]
 * @returns {string|null}
 */
function waitReasonLabelOf(reason, labels = null) {
  if (typeof reason !== "string" || !reason) return null;
  const custom = labels !== null && typeof labels === "object" ? labels[reason] : undefined;
  if (typeof custom === "string" && custom) return custom;
  const fallback = WAIT_REASON_LABELS[reason];
  return typeof fallback === "string" && fallback ? fallback : null;
}

/**
 * 失败 / 跳过残留的诊断摘要（`message` 与 `reason` 并置；命中停机原因族时追加族标签）。
 * @param {unknown} entry
 * @param {Record<string, string>|null} [labels] 原因族文案覆盖（缺省 `STOP_REASON_LABELS`）
 * @returns {string|null}
 */
function queueEntryDetailOf(entry, labels = null) {
  const state = queueStateOf(entry);
  if (state !== "failed" && state !== "skipped") return null;
  const message = typeof entry?.message === "string" ? entry.message.trim() : "";
  const reason = typeof entry?.reason === "string" ? entry.reason.trim() : "";
  const parts = [];
  if (message) parts.push(message);
  const family = stopReasonLabelOf(reason, labels);
  if (reason) parts.push(family === null ? "(" + reason + ")" : "(" + reason + " · " + family + ")");
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * 停机原因族标签查询（`null` = 非停机原因族 / 未提供文案）。
 * @param {string} reason 条目 `reason` 码
 * @param {Record<string, string>|null} labels 文案覆盖
 * @returns {string|null}
 */
function stopReasonLabelOf(reason, labels) {
  if (typeof reason !== "string" || !reason) return null;
  const table = labels !== null && typeof labels === "object" ? labels : STOP_REASON_LABELS;
  const label = table?.[reason];
  return typeof label === "string" && label ? label : null;
}

/**
 * 单行装配（UI 零二次推导）：徽标 / 锁定 / 排序与移出/重试可用性 / title 文案
 * （排序三档 + 移出 + 重试按暂停态双形态）。
 * @param {object} entry 条目投影（无 prompt 正文）
 * @param {number} index 服务端顺序下标
 * @param {Array<object>} entries 全量条目（排序可用性判定用）
 * @param {string} wsId 作用域星座 id
 * @param {number} now 当前时刻（入队相对时间）
 * @param {boolean} paused 队列暂停态（重试 title 的推进免责语境：暂停态需点继续）
 * @param {Record<string, string>|null} [stopLabels] 停机原因族文案覆盖
 * @param {{dependency?: string, repair?: string}|null} [waitLabels] 依赖等待文案覆盖
 * @returns {object}
 */
function queueRowOf(entry, index, entries, wsId, now, paused = false, stopLabels = null, waitLabels = null) {
  const id = typeof entry?.id === "string" ? entry.id : "";
  const proposalId = typeof entry?.proposalId === "string" ? entry.proposalId : "";
  const buttonName = typeof entry?.buttonName === "string" ? entry.buttonName : "";
  const state = queueStateOf(entry);
  const subState = typeof entry?.subState === "string" ? entry.subState : null;
  const badge = queueBadgeOf(entry, waitLabels);
  const locked = queueEntryLockedOf(entry);
  const flags = queueOrderFlagsOf(entries, index);
  const canRemove = queueEntryRemovableOf(entry);
  const canRetry = queueEntryRetryableOf(entry);
  const failedDetail = queueEntryDetailOf(entry, stopLabels);
  /* 依赖等待子态（3.2）：`waiting.dep` 进徽标文案，等待原因（等修复）进行内诊断与 title。 */
  const waitingDep = typeof entry?.waiting?.dep === "string" ? entry.waiting.dep : "";
  const waitingDetail = waitReasonLabelOf(entry?.waiting?.reason, waitLabels);
  const enqueuedAt = Number(entry?.enqueuedAt) || 0;
  /* title 文案三档（禁用态必须解释为什么，spec「executing 条目操作被拒」）：
     锁定 → 执行中不可调整；非 queued → 仅等待中可排序；相邻非 queued → 邻居不可调整；
     单条 / 双端边界 → 已到队列边界。 */
  const orderTitle = locked
    ? "执行中条目不可调整"
    : state !== "queued"
      ? "仅等待中的条目可调整顺序"
      : flags.canMoveUp || flags.canMoveDown
        ? "调整顺序"
        : entries.length > 1
          ? "相邻条目不可调整（仅等待中的条目可排序）"
          : "已是队列边界";
  const removeTitle = locked
    ? "执行中条目不可移出"
    : canRemove
      ? "移出队列"
      : "该条目不可移出";
  /* 重试 title 按暂停态双形态（design D4）：暂停态明示「需点继续恢复推进」（重试不越
     暂停守卫）；非暂停态自然推进无需免责文案。 */
  const retryTitle = !canRetry
    ? "仅失败条目可重试"
    : paused
      ? "重试：转回队列队首（队列暂停中，需点继续恢复推进）"
      : "重试：转回队列队首";
  /* 行 title：状态徽标 + 自动发送标注（spec「队列执行恒自动发送」：条目呈现标注）+
     残留诊断 + 等待依赖原因 + 入队相对时间。 */
  const rowParts = [badge.label, "自动发送"];
  if (failedDetail) rowParts.push(failedDetail);
  if (waitingDetail) rowParts.push(waitingDetail);
  if (enqueuedAt > 0) rowParts.push("入队 " + relativeTime(enqueuedAt, now));
  return {
    id,
    /* 行键（React key 稳定）：有服务端 id 用 id（队列内唯一）；畸形条目回落三元组 + 下标
       （防重复键导致行身份错乱）。 */
    rowKey: id ? "queue\u0000" + wsId + "\u0000" + id : queueEnqueuedKeyOf(wsId, proposalId, buttonName) + "\u0000" + String(index),
    wsId,
    proposalId,
    buttonName,
    state,
    subState,
    badgeKey: badge.key,
    badgeLabel: badge.label,
    waitingDep,
    waitingDetail,
    locked,
    canMoveUp: flags.canMoveUp,
    canMoveDown: flags.canMoveDown,
    canRemove,
    removeTitle,
    canRetry,
    retryTitle,
    orderTitle,
    rowTitle: rowParts.join(" · "),
    failedDetail
  };
}

/**
 * 队列面板投影（纯函数）。
 *
 * 输出形状：
 *  - `visible`：条目数 > 0 才渲染（空队列零布局，MUST NOT 留占位）；
 *  - `indicator`：存在「等待决策」→ `"waiting"`（琥珀优先，spec「执行指示与状态徽标」）；
 *    否则存在 `executing` / `launching` → `"running"`（呼吸点）；否则 null；
 *  - `counts`：服务端 `counts` 透传（缺键按 entries 现算兜底；`active` = 在途计数）；
 *  - `nextExecution`：让位扫描将启动的下一 queued 条目（`{proposalId, buttonName}`；
 *    服务端透传，缺席 / 畸形 → null）——头部「下一执行」指示的数据源；
 *  - `idle`：**闲置态**（全部 queued 条目依赖未达标、未暂停、无在途）——服务端透传；
 *    与暂停态正交（暂停标志恒未被自动置位），呈现必须用不同标识区分；
 *  - `rows`：服务端顺序逐条投影（顺序即执行顺序，MUST NOT 二次排序）。
 *
 * @param {object} [options]
 * @param {object|null} [options.queue] 单星座队列（`{paused, pausedAt, counts, entries}`）；
 *        亦接受全量快照（`{queues}`）——按 `wsId` 取（防御两种上游形状）
 * @param {string} [options.wsId] 作用域星座 id
 * @param {number} [options.now] 当前时刻（入队相对时间；缺省 Date.now()）
 * @param {Record<string, string>|null} [options.stopLabels] 停机原因族文案覆盖
 * @param {{dependency?: string, repair?: string}|null} [options.waitLabels] 依赖等待文案覆盖
 * @returns {{
 *   visible: boolean, wsId: string, paused: boolean,
 *   counts: {total: number, queued: number, launching: number, executing: number, failed: number, skipped: number, active: number},
 *   indicator: "running"|"waiting"|null,
 *   nextExecution: {proposalId: string, buttonName: string}|null,
 *   idle: boolean,
 *   rows: Array<object>
 * }}
 */
export function projectQueuePanel(options = {}) {
  const wsId = typeof options?.wsId === "string" ? options.wsId : "";
  const rawNow = Number(options?.now);
  const now = Number.isFinite(rawNow) && rawNow > 0 ? rawNow : Date.now();
  const queue = queueQueueOf(options?.queue, wsId);
  const entries = Array.isArray(queue?.entries) ? queue.entries : [];
  const paused = queue?.paused === true;
  const waitLabels = waitLabelsOf(options);
  const rows = entries.map((entry, index) => queueRowOf(entry, index, entries, wsId, now, paused, stopLabelsOf(options), waitLabels));
  const waiting = entries.some((entry) => queueStateOf(entry) === "executing" && entry?.subState === "waiting");
  const running = entries.some((entry) => {
    const state = queueStateOf(entry);
    return state === "executing" || state === "launching";
  });
  return {
    visible: entries.length > 0,
    wsId,
    paused,
    counts: queueCountsOf(queue, entries),
    indicator: waiting ? "waiting" : running ? "running" : null,
    nextExecution: queueNextExecutionOf(queue),
    idle: queue?.idle === true,
    rows
  };
}

/**
 * 「下一执行」透传归一（服务端 `nextExecution`；畸形 → null——指示缺失优于错误指示）。
 * @param {unknown} raw
 * @returns {{proposalId: string, buttonName: string}|null}
 */
function queueNextExecutionOf(queue) {
  const raw = queue?.nextExecution;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const proposalId = typeof raw.proposalId === "string" ? raw.proposalId : "";
  if (!proposalId) return null;
  return {
    proposalId,
    buttonName: typeof raw.buttonName === "string" ? raw.buttonName : ""
  };
}

/* ------------------------------------------------------------------ *
 * 曲率队列投影（two-add-cosmos-proposal-warp 6.2–6.4 / spec
 * cosmos-proposal-warp「曲率队列呈现（曲率页签与条目行）」）
 *
 * 数据源 = 服务端权威曲率快照（`GET /api/dsh-v-cosmos/warp`；多窗口经 SSE
 * `warp-changed` 轻帧拉全量对账）。本层只做**呈现投影**（浏览器端 MUST NOT 持有
 * 权威曲率状态）：
 *  - 条目投影**无 prompt 正文**；`anchorSlugs` 仅用于星胚目标的 cross-hover 派生；
 *  - 操作矩阵（单条移出可用性）在此单点判定——UI 禁用先行、服务端 400 兜底；
 *    **无排序语义、无整队列清空**（用户裁决 2026-11-23）；
 *  - 空队列 → `visible:false`（页签不呈现；双队列皆空由组件整面板隐藏）。
 * 纯函数：零 DOM、零网络、不修改入参；非法输入一律空投影（MUST NOT 抛错）。
 * ------------------------------------------------------------------ */

/**
 * 曲率条目状态 → 徽标。`executing` 的「等待决策」与 `ready` 的「等待会话空闲」两个
 * **呈现子态**由 `subState` 二次分派（子态不落枚举——spec「门控接力状态机」）。
 */
export const WARP_BADGES = Object.freeze({
  grayed: Object.freeze({ key: "grayed", label: "置灰" }),
  ready: Object.freeze({ key: "ready", label: "待发" }),
  launching: Object.freeze({ key: "running", label: "执行中" }),
  executing: Object.freeze({ key: "running", label: "执行中" }),
  waiting: Object.freeze({ key: "waiting", label: "等待决策" }),
  waitingSession: Object.freeze({ key: "waiting-session", label: "等待会话空闲" }),
  waitingDependency: Object.freeze({ key: "waiting-dependency", label: "等待依赖" }),
  failed: Object.freeze({ key: "failed", label: "失败" }),
  skipped: Object.freeze({ key: "skipped", label: "跳过" })
});

/** 未知状态兜底徽标（上游形状漂移时可见、可诊断）。 */
const WARP_BADGE_UNKNOWN = Object.freeze({ key: "unknown", label: "未知" });

/** 曲率状态域（与 warp-store `WARP_STATES` 同口径）。 */
const WARP_STATE_KEYS = Object.freeze(["grayed", "ready", "launching", "executing", "failed", "skipped"]);
/** 曲率计数键全集（服务端 counts 透传的防御归一域）。 */
const WARP_COUNT_KEYS = Object.freeze([
  "total", "grayed", "ready", "launching", "executing", "failed", "skipped", "inflight", "pending"
]);

/** 条目状态归一（未知 → ""，所有判定按保守处理）。 */
function warpStateOf(entry) {
  const state = typeof entry?.state === "string" ? entry.state : "";
  return WARP_STATE_KEYS.includes(state) ? state : "";
}

/**
 * 徽标解析（executing+waiting → 等待决策；ready+waiting-session → 等待会话空闲；
 * grayed+waiting-dependency → 等待依赖 <前置提案名>，second-add-cross-proposal-dependency-
 * gating 3.1——与「等待会话空闲」同级呈现子态，不落枚举）。
 */
function warpBadgeOf(entry, labels = null) {
  const state = warpStateOf(entry);
  if (state === "executing" && entry?.subState === "waiting") return WARP_BADGES.waiting;
  if (state === "ready" && entry?.subState === "waiting-session") return WARP_BADGES.waitingSession;
  if (state === "grayed" && entry?.subState === "waiting-dependency") {
    const base = labels !== null && typeof labels?.dependency === "string" && labels.dependency
      ? labels.dependency
      : WARP_BADGES.waitingDependency.label;
    const dep = typeof entry?.waiting?.dep === "string" ? entry.waiting.dep : "";
    return { key: WARP_BADGES.waitingDependency.key, label: dep ? base + " " + dep : base };
  }
  return WARP_BADGES[state] ?? WARP_BADGE_UNKNOWN;
}

/**
 * 条目锁定判定：`launching` / `executing`（含「等待决策」子态）完全锁定（服务端拒绝移出）。
 * @param {unknown} entry
 * @returns {boolean}
 */
export function warpEntryLockedOf(entry) {
  const state = warpStateOf(entry);
  return state === "launching" || state === "executing";
}

/**
 * 条目可移出判定（spec「条目操作矩阵（无排序，单条移出）」）：`grayed | ready | failed |
 * skipped` 可移出；`launching | executing` 锁定；未知状态不可操作。
 * @param {unknown} entry
 * @returns {boolean}
 */
export function warpEntryRemovableOf(entry) {
  const state = warpStateOf(entry);
  return state === "grayed" || state === "ready" || state === "failed" || state === "skipped";
}

/**
 * 目标键（跨工作区唯一）：wsId + NUL + targetKey（与 queueEnqueuedKeyOf 同族）。
 * @param {unknown} wsId
 * @param {unknown} targetKey
 * @returns {string}
 */
export function warpTargetKeyOf(wsId, targetKey) {
  return String(wsId ?? "") + "\u0000" + String(targetKey ?? "");
}

/** 曲率条目读取（防御单星座队列与全量快照两种上游形状）。 */
function warpEntriesOf(warp) {
  if (!warp || typeof warp !== "object") return [];
  if (Array.isArray(warp.entries)) return warp.entries;
  const warps = warp.warps;
  if (!warps || typeof warps !== "object" || Array.isArray(warps)) return [];
  const entries = [];
  for (const value of Object.values(warps)) {
    if (value && typeof value === "object" && Array.isArray(value.entries)) entries.push(...value.entries);
  }
  return entries;
}

/**
 * 「已托管」目标键集（曲率按钮禁用判定）：**非终态**条目（grayed/ready/launching/executing）
 * 命中——failed/skipped 残留不构成重复（与服务端同口径）。
 * @param {unknown} warp 单星座曲率队列或全量快照（`{warps}`）
 * @returns {Set<string>}
 */
export function warpPendingTargetKeysOf(warp) {
  const keys = new Set();
  for (const entry of warpEntriesOf(warp)) {
    const state = warpStateOf(entry);
    if (!state || state === "failed" || state === "skipped") continue;
    const wsId = typeof entry?.wsId === "string" ? entry.wsId : "";
    const targetKey = typeof entry?.targetKey === "string" ? entry.targetKey : "";
    if (!wsId || !targetKey) continue;
    keys.add(warpTargetKeyOf(wsId, targetKey));
  }
  return keys;
}

/** 单星座曲率解析（单队列对象 / 全量快照 `{warps}` / 裸映射 `{<wsId>: queue}` 三种上游形状）。 */
function warpQueueOf(warp, wsId) {
  if (!warp || typeof warp !== "object") return null;
  if (Array.isArray(warp.entries)) return warp;
  const id = typeof wsId === "string" && wsId ? wsId : "";
  const warps = warp.warps;
  if (warps && typeof warps === "object" && !Array.isArray(warps)) {
    const found = id ? warps[id] : null;
    return found && typeof found === "object" ? found : null;
  }
  const direct = id ? warp[id] : null;
  return direct && typeof direct === "object" ? direct : null;
}

/**
 * 曲率面板作用域（与脉冲队列同一作用域规则）：`drillWsId ?? selectedWsId`；作用域星座
 * 曲率队列为空 → null（该页签不呈现；双空整面板隐藏）。
 * @param {object} [input]
 * @returns {string|null}
 */
export function warpScopeOf(input = {}) {
  const drillWsId = typeof input?.drillWsId === "string" && input.drillWsId ? input.drillWsId : null;
  const selectedWsId = typeof input?.selectedWsId === "string" && input.selectedWsId ? input.selectedWsId : null;
  const wsId = drillWsId ?? selectedWsId ?? null;
  if (wsId === null) return null;
  const warp = warpQueueOf(input?.warps, wsId);
  const entries = Array.isArray(warp?.entries) ? warp.entries : [];
  return entries.length > 0 ? wsId : null;
}

/** 按 entries 现算计数（服务端 counts 缺键兜底）。 */
function warpCountsByEntries(entries) {
  const counts = { total: entries.length, grayed: 0, ready: 0, launching: 0, executing: 0, failed: 0, skipped: 0 };
  for (const entry of entries) {
    const state = warpStateOf(entry);
    if (state) counts[state] += 1;
  }
  counts.inflight = counts.launching + counts.executing;
  counts.pending = counts.grayed + counts.ready;
  return counts;
}

/** 计数归一：服务端 counts 优先，逐键缺失按 entries 现算兜底；派生键按归一后值现算。 */
function warpCountsOf(warp, entries) {
  const computed = warpCountsByEntries(entries);
  const source = warp?.counts !== null && typeof warp?.counts === "object" && !Array.isArray(warp.counts)
    ? warp.counts
    : {};
  const counts = {};
  for (const key of WARP_COUNT_KEYS) {
    const value = Number(source?.[key]);
    counts[key] = Number.isFinite(value) && value >= 0 ? Math.floor(value) : computed[key];
  }
  /* 派生键（inflight / pending）以归一后的分项为准：服务端 counts 缺键时不能凭条目现算
     得到与透传分项不一致的口径。 */
  counts.inflight = counts.launching + counts.executing;
  counts.pending = counts.grayed + counts.ready;
  return counts;
}

/** 失败 / 跳过残留诊断摘要（与脉冲同口径，含停机原因族标签）。 */
function warpEntryDetailOf(entry, labels = null) {
  const state = warpStateOf(entry);
  if (state !== "failed" && state !== "skipped") return null;
  const message = typeof entry?.message === "string" ? entry.message.trim() : "";
  const reason = typeof entry?.reason === "string" ? entry.reason.trim() : "";
  const parts = [];
  if (message) parts.push(message);
  const family = stopReasonLabelOf(reason, labels);
  if (reason) parts.push(family === null ? "(" + reason + ")" : "(" + reason + " · " + family + ")");
  return parts.length > 0 ? parts.join(" ") : null;
}

/** 单行装配（UI 零二次推导）。 */
function warpRowOf(entry, wsId, now, stopLabels = null, waitLabels = null) {
  const id = typeof entry?.id === "string" ? entry.id : "";
  const targetKey = typeof entry?.targetKey === "string" ? entry.targetKey : "";
  const targetKind = entry?.targetKind === "embryo" ? "embryo" : "proposal";
  const targetLabel = typeof entry?.targetLabel === "string" && entry.targetLabel ? entry.targetLabel : targetKey;
  const buttonName = typeof entry?.buttonName === "string" ? entry.buttonName : "";
  const rule = entry?.rule === "queue" ? "queue" : "direct";
  const state = warpStateOf(entry);
  const subState = typeof entry?.subState === "string" ? entry.subState : null;
  const badge = warpBadgeOf(entry, waitLabels);
  const locked = warpEntryLockedOf(entry);
  const canRemove = warpEntryRemovableOf(entry);
  const failedDetail = warpEntryDetailOf(entry, stopLabels);
  /* 依赖等待子态（3.1）：`waiting.dep` 进徽标文案；等待原因（等修复）进 title。 */
  const waitingDep = typeof entry?.waiting?.dep === "string" ? entry.waiting.dep : "";
  const waitingDetail = waitReasonLabelOf(entry?.waiting?.reason, waitLabels);
  const enqueuedAt = Number(entry?.enqueuedAt) || 0;
  const rowParts = [badge.label, rule === "queue" ? "转入脉冲队列" : "曲率直航"];
  if (failedDetail) rowParts.push(failedDetail);
  if (waitingDetail) rowParts.push(waitingDetail);
  if (enqueuedAt > 0) rowParts.push("附着 " + relativeTime(enqueuedAt, now));
  return {
    id,
    rowKey: id ? "warp\u0000" + wsId + "\u0000" + id : "warp\u0000" + wsId + "\u0000" + targetKey + "\u0000" + buttonName,
    wsId,
    targetKey,
    targetKind,
    targetLabel,
    buttonName,
    rule,
    state,
    subState,
    badgeKey: badge.key,
    badgeLabel: badge.label,
    waitingDep,
    waitingDetail,
    locked,
    canRemove,
    removeTitle: locked ? "执行中条目不可移出" : canRemove ? "移出曲率队列" : "该条目不可移出",
    rowTitle: rowParts.join(" · "),
    failedDetail,
    anchorSlugs: Array.isArray(entry?.anchorSlugs)
      ? entry.anchorSlugs.filter((slug) => typeof slug === "string" && slug)
      : []
  };
}

/**
 * 曲率面板投影（纯函数）。
 * @param {object} [options]
 * @param {object|null} [options.warp] 单星座曲率队列或全量快照（`{warps}`）
 * @param {string} [options.wsId]
 * @param {number} [options.now]
 * @param {Record<string, string>|null} [options.stopLabels] 停机原因族文案覆盖
 * @param {{dependency?: string, repair?: string}|null} [options.waitLabels] 依赖等待文案覆盖
 * @returns {{
 *   visible: boolean, wsId: string, paused: boolean,
 *   counts: {total: number, grayed: number, ready: number, launching: number,
 *            executing: number, failed: number, skipped: number, inflight: number, pending: number},
 *   indicator: "running"|"waiting"|null,
 *   rows: Array<object>
 * }}
 */
export function projectWarpPanel(options = {}) {
  const wsId = typeof options?.wsId === "string" ? options.wsId : "";
  const rawNow = Number(options?.now);
  const now = Number.isFinite(rawNow) && rawNow > 0 ? rawNow : Date.now();
  const warp = warpQueueOf(options?.warp, wsId);
  const entries = Array.isArray(warp?.entries) ? warp.entries : [];
  const waitLabels = waitLabelsOf(options);
  const rows = entries.map((entry) => warpRowOf(entry, wsId, now, stopLabelsOf(options), waitLabels));
  const waiting = entries.some((entry) => warpStateOf(entry) === "executing" && entry?.subState === "waiting");
  const running = entries.some((entry) => {
    const state = warpStateOf(entry);
    return state === "executing" || state === "launching";
  });
  return {
    visible: entries.length > 0,
    wsId,
    paused: warp?.paused === true,
    counts: warpCountsOf(warp, entries),
    indicator: waiting ? "waiting" : running ? "running" : null,
    rows
  };
}
