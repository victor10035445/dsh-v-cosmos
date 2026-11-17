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
 *    **字典序**（码点序，确定性，与骨架传入顺序解耦）；**无活跃提案且无星胚锚点的工作区
 *    不生成分组**（自动隐藏，不占位）；
 *  - 钻取态 = 仅当前星座（分组标题保留；无提案时仍渲染空态）；
 *  - 待创建星胚（`lifecycle === "proto"`，即 pending 锚点）**以星胚合并卡片进入列表**：
 *    同工作区内按锚点 `sessionId` 归并为一张卡（缺失 `sessionId` 的旧锚点各自成卡），
 *    排于该组全部正式提案之后（组间按首 slug 字典序，MUST NOT 与正式提案字典序混排）；
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
 */

import { embryoGroupsOf, starPlanetIdsOf } from "./merge.mjs";

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
       钻取到别的星座时选中态仍归该提案（spec「选中跨视图保留」）。 */
    const cards = [];
    for (const star of Array.isArray(ws?.stars) ? ws.stars : []) {
      if (star?.lifecycle === "proto") continue; // 星胚走下方合并卡片路径
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
    }
    if (drillWsId !== null && wsId !== drillWsId) continue;
    /* 银河态：**无活跃提案且无星胚锚点的工作区不生成分组**（自动隐藏，避免空标题
       占位）；分组条件 = 活跃提案 ∨ 星胚锚点（add-cosmos-galaxy-embryo-cards D1：仅星胚
       的工作区照常生成分组、组内仅星胚合并卡片）。星胚计数复用上面**已装配的卡片数**
       （`cards.length - formalCount`），MUST NOT 二次调用 `embryoGroupsOf`；无 slug 的
       畸形锚点不产卡 → 与「无锚点」同口径维持隐藏。钻取态例外——当前星座既无提案也无
       锚点时仍渲染该分组（「该星座暂无提案」空态），两种口径可区分。 */
    const embryoCount = cards.length - formalCount;
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

  /* 星胚合并卡源（多 slug；不注入引擎，只参与行标记派生）。 */
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
    return { sessionIds: uniqueIds(sessionIds), proposalIds: [] };
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
    return stars.some((star) => star && star.id === id && (hover.source === "canvas" || star.lifecycle !== "proto"));
  }
  if (hover.kind === "planet") return hasBody(ws.planets);
  if (hover.kind === "comet") return hasBody(ws.comets);
  return false;
}
