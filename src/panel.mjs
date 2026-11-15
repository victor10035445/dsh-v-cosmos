/**
 * 提案列表面板投影（add-cosmos-proposal-actions 3.1 / spec cosmos-proposal-panel）。
 *
 * 独立纯逻辑模块——浏览器 client.jsx 消费（面板渲染）、test/panel-smoke.mjs 直测。
 * 零 DOM / 零网络：输入为 mergeScene 产出的 scene（含 `ws.path`）与两个过滤输入，
 * 输出分组卡片列表。
 *
 * 口径（spec）：
 *  - 数据源 = 既有场景骨架（恒星 + 工作区 path），零新增宿主接口；
 *  - 银河态 = 全部在册工作区的活跃提案，按工作区分组（组标题 = 星座名），组内按名称
 *    **字典序**（码点序，确定性，与骨架传入顺序解耦）；**无活跃提案的工作区不生成分组**
 *    （自动隐藏，不占位）；
 *  - 钻取态 = 仅当前星座（分组标题保留；无提案时仍渲染空态）；
 *  - 待创建星胚（`lifecycle === "proto"`，即 pending 锚点）**以星胚合并卡片进入列表**：
 *    同工作区内按锚点 `sessionId` 归并为一张卡（缺失 `sessionId` 的旧锚点各自成卡），
 *    排于该组全部正式提案之后（组间按首 slug 字典序，MUST NOT 与正式提案字典序混排）；
 *    **星胚不触发分组**——银河态分组条件仍 = 存在活跃提案（仅星胚的工作区不生成分组、
 *    不渲染空壳面板），钻取态照常呈现；星胚卡不携带 `dir`（动作链路按无目标守卫降级）；
 *  - 搜索过滤 = 分组跟随命中集合（未命中工作区的分组隐藏；命中域 = 工作区名 ∪ 星胚
 *    slug，见 merge.mjs `matchWorkspaces`）；`allCards` 不受过滤影响（正式提案 + 星胚卡），
 *    供「选中目标仍在骨架」判定与 @路径查表使用（选中分组被过滤隐藏时选中保留）；
 *  - 选中作用面 = 面板 / 动作条 / 搜索框（`isSelectionSurface`）：点击其**以外**区域
 *    取消选中（动作条熄灭）；点击其他卡片仅切换动作目标（选中态与动作条可用态保持）。
 *
 * 同文件另有**会话列表面板投影**（add-cosmos-session-list-panel）：`projectSessionPanel`
 * 消费同一份 mergeScene 产物（行星 ∪ 彗星 = 活跃会话），提供银河/钻取作用域分组、
 * 四态行数据、待决策计数与卫星徽标数据——同样零 DOM、冒烟直测。
 */

import { embryoGroupsOf } from "./merge.mjs";

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
  /* 计数口径（add-cosmos-embryo-cards 3.1）：`total` = **正式提案数**（面板可见性 /
     组头计数沿用既定口径，星胚不参与「是否有活跃提案」判定）；`embryoTotal` 纯观察面。 */
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
       钻取到别的星座时选中态仍归该提案（spec「选中跨视图保留」）。 */
    const cards = [];
    for (const star of Array.isArray(ws?.stars) ? ws.stars : []) {
      if (star?.lifecycle === "proto") continue; // 星胚走下方合并卡片路径
      const id = typeof star?.id === "string" && star.id ? star.id : "";
      if (!id) continue;
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
        tasks: [Number(star?.tasks?.[0]) || 0, Number(star?.tasks?.[1]) || 0],
        /* 沉睡判据（add-cosmos-action-prestate-gate 2.1）：scene 星体已聚合 act
           （busy ∨ waiting ∨ 委托忙碌计数），投影纯加法透传；星胚无关联会话恒 0。 */
        act: Number(star?.act) || 0,
        dir: proposalDirOf(wsPath, id)
      };
      cards.push(card);
      allCards.push(card);
      total++;
    }
    /* 组内正式提案字典序（星胚 MUST NOT 参与该混排）。 */
    cards.sort((a, b) => compareText(a.name, b.name) || compareText(a.id, b.id));
    const formalCount = cards.length;
    /* 星胚合并卡片（add-cosmos-embryo-cards 3.1）：同工作区内按锚点 `sessionId` 归并
       （缺失各成组，组间按首 slug 字典序），追加于全部正式提案之后。组数据自 proto 星
       现算——零新增 scene 字段（merge.mjs `embryoGroupsOf`）。 */
    for (const group of embryoGroupsOf(ws?.stars)) {
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
        act: 0
        /* MUST NOT 携带 `dir`：星胚无提案目录，动作链路按「目标目录缺失」守卫
           拒绝执行（add-cosmos-action-prestate-gate 承接正式星胚动作）。 */
      };
      cards.push(card);
      allCards.push(card);
      embryoTotal++;
    }
    if (drillWsId !== null && wsId !== drillWsId) continue;
    /* 银河态：**无活跃提案的工作区不生成分组**（自动隐藏，避免空标题占位）；星胚
       MUST NOT 触发分组——仅星胚的工作区在银河态不生成分组、卡片不呈现（探索残留
       不占空分组位、不渲染零分组空壳面板）；钻取态例外——当前星座无提案时仍渲染该
       分组（含星胚卡片 / 「该星座暂无提案」空态），两种口径可区分。 */
    if (drillWsId === null && formalCount === 0) continue;
    const matched = matchedIds === null || matchedIds.has(wsId);
    groups.push({ wsId, wsName, wsPath, cards, matched });
  }

  /* 分组顺序：星座名字典序（同名以 id 兜底）——与骨架传入顺序解耦。 */
  groups.sort((a, b) => compareText(a.wsName, b.wsName) || compareText(a.wsId, b.wsId));
  /* 搜索过滤：未命中分组隐藏（数据保留，UI 依 matched 显隐；钻取态同理）。 */
  const visibleGroups = matchedIds === null ? groups : groups.filter((group) => group.matched);

  /* 面板可见性：钻取且当前星座仍在册 → 渲染（允许空态）；否则要求存在**活跃提案**
     （仅存星胚锚点的工作区 → 零布局，星胚不参与可见性判定）。 */
  const visible = drillWsId !== null ? drillExists : total > 0;

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
 * 单会话行装配（行星/彗星共用；高亮字段 = 标题/形态/状态/待处理分类/相对时间/todos/
 * 卫星计数——UI 零二次推导）。id 缺失 → null（跳过）。
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
    todos: typeof body?.todos === "string" && body.todos ? body.todos : "—",
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
