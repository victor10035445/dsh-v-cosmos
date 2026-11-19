/**
 * 动作队列（浏览器半区）冒烟（add-cosmos-action-queue 5.1–5.4 / spec cosmos-action-queue
 * 「队列呈现（面板与配套入队钮）」「条目操作矩阵与复验跳过」「持久化与多窗口广播」）：
 *  - panel.mjs 队列投影纯函数：空队列可见性（零布局）/ 执行指示点优先级 / 状态徽标
 *    （含 executing 的两个呈现子态）/ 计数透传与现算兜底 / 行顺序（服务端顺序）/
 *    失败与跳过残留的诊断摘要；操作矩阵（锁定 / 可移出 / 排序可用性）全枚举；
 *    重复入队键集（**仅 queued** 命中、跨工作区唯一）；作用域解析（钻取优先 / 选中兜底 /
 *    空与缺失 → null）；queue 源与 card 源的 cross-hover 同构 + 星胚存活放宽；
 *  - client.jsx 源锚点：api 桥导入与模块级 store、`refreshQueue` 唯一写者、SSE
 *    `queue-changed` 分流、队列面板 DOM/CSS 钩子、动作条配套入队钮（包裹层 / 迷你钮 /
 *    同门控）、CSS 琥珀等待色与呼吸动画、空队列零布局门控，以及**「入队处理不调用
 *    runAction / 冷却门 / 导航 / 草稿」的精确片段断言**。
 *
 * React 组件树在 Node 侧不可挂载（react 为 bundle external），故呈现面走源码锚点 +
 * 纯逻辑直测（与 client-ui-smoke 同法）。
 * 运行：node test/queue-ui-smoke.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  QUEUE_BADGES,
  crossHoverTargets,
  hoverSourceAlive,
  projectQueuePanel,
  queueEnqueuedKeyOf,
  queueEntryLockedOf,
  queueEntryRemovableOf,
  queueOrderFlagsOf,
  queuePendingKeysOf,
  queueScopeOf
} from "../src/panel.mjs";

/* ── 1. 空队列 / 缺失队列 → 零布局（空面板不渲染） ── */
{
  const empty = projectQueuePanel({ queue: { paused: false, entries: [] }, wsId: "ws1", now: 1000 });
  assert.equal(empty.visible, false, "空队列不可见（整面板不渲染 = 零布局）");
  assert.deepEqual(empty.rows, [], "空队列零行");
  assert.equal(empty.indicator, null, "无条目无执行指示点");
  assert.equal(empty.wsId, "ws1", "作用域星座 id 透传");
  assert.equal(empty.paused, false, "paused 透传");
  assert.deepEqual(empty.counts, { total: 0, queued: 0, launching: 0, executing: 0, failed: 0, skipped: 0, active: 0 }, "空队列计数归零");

  const missing = projectQueuePanel({ queue: null, wsId: "ws1" });
  assert.equal(missing.visible, false, "队列缺失 → 不可见（MUST NOT 抛错）");
  assert.deepEqual(missing.rows, [], "缺失零行");
  assert.equal(projectQueuePanel().visible, false, "无参调用 → 空投影");
}

/* ── 2. 全状态行投影：指示点优先级 / 徽标 / 计数 / 行顺序 / 残留诊断 / 操作矩阵 ── */
{
  const entries = [
    { id: "e1", wsId: "ws1", proposalId: "add-a", buttonName: "执行", state: "queued", enqueuedAt: 1000 },
    { id: "e2", wsId: "ws1", proposalId: "add-b", buttonName: "审阅", state: "launching", enqueuedAt: 2000 },
    { id: "e3", wsId: "ws1", proposalId: "add-c", buttonName: "实施", state: "executing", subState: "waiting", enqueuedAt: 3000 },
    {
      id: "e4",
      wsId: "ws1",
      proposalId: "add-d",
      buttonName: "归档",
      state: "failed",
      enqueuedAt: 4000,
      reason: "queen-unreachable",
      message: "queen 不可达"
    },
    { id: "e5", wsId: "ws1", proposalId: "add-e", buttonName: "探索", state: "executing", subState: "running", enqueuedAt: 5000 },
    { id: "e6", wsId: "ws1", proposalId: "add-f", buttonName: "跳过", state: "skipped", enqueuedAt: 6000 }
  ];
  const model = projectQueuePanel({
    queue: { paused: true, counts: { total: 6 }, entries },
    wsId: "ws1",
    now: 60000
  });

  assert.equal(model.visible, true, "有 queued 条目 → 可见");
  assert.equal(model.paused, true, "暂停态透传");
  assert.equal(model.indicator, "waiting", "存在 executing+waiting → waiting 优先（琥珀）");
  assert.deepEqual(model.rows.map((row) => row.id), ["e1", "e2", "e3", "e4", "e5", "e6"], "行顺序 = 服务端顺序（不二次排序）");
  assert.deepEqual(model.rows.map((row) => row.badgeKey), ["queued", "running", "waiting", "failed", "running", "skipped"], "徽标键（executing+waiting → waiting）");
  assert.deepEqual(model.rows.map((row) => row.badgeLabel), ["等待", "执行中", "等待决策", "失败", "执行中", "跳过"], "徽标文案");
  assert.deepEqual(
    model.counts,
    { total: 6, queued: 1, launching: 1, executing: 2, failed: 1, skipped: 1, active: 4 },
    "counts：服务端 total 透传 + 缺键按 entries 现算（active = queued+launching+executing）"
  );

  /* executing（含等待决策）全锁定：排序 / 移出 / 清空全部禁用 */
  const executingWaiting = model.rows[2];
  assert.equal(executingWaiting.locked, true, "执行中（等待决策）条目锁定");
  assert.equal(executingWaiting.subState, "waiting", "子态透传（呈现用）");
  assert.equal(executingWaiting.canRemove, false, "锁定条目不可移出");
  assert.equal(executingWaiting.canMoveUp, false, "锁定条目不可排序");
  assert.equal(executingWaiting.canMoveDown, false, "锁定条目不可排序（下移）");
  assert.equal(executingWaiting.removeTitle, "执行中条目不可移出", "锁定移出 title 说明");
  assert.equal(executingWaiting.orderTitle, "执行中条目不可调整", "锁定排序 title 说明");

  /* 失败残留：不锁定、可移出、诊断摘要可见 */
  const failed = model.rows[3];
  assert.equal(failed.locked, false, "失败残留不锁定");
  assert.equal(failed.canRemove, true, "失败残留可移出");
  assert.equal(failed.badgeLabel, "失败");
  assert.ok(String(failed.failedDetail).includes("queen 不可达"), "failedDetail 含 message");
  assert.ok(String(failed.failedDetail).includes("queen-unreachable"), "failedDetail 含 reason");
  assert.ok(String(failed.rowTitle).includes("失败"), "rowTitle 含状态文案");
  assert.ok(String(failed.rowTitle).includes("自动发送"), "条目呈现标注「自动发送」（spec 队列执行恒自动发送）");
  assert.ok(String(failed.rowTitle).includes("queen 不可达"), "rowTitle 含可见诊断");

  /* 等待条目：队首上移不可用；下邻 launching 非 queued → 下移同样不可用（邻居锁定） */
  const queuedRow = model.rows[0];
  assert.equal(queuedRow.canMoveUp, false, "队首不可上移");
  assert.equal(queuedRow.canMoveDown, false, "相邻条目非 queued → 不可下移");
  assert.equal(queuedRow.orderTitle, "相邻条目不可调整（仅等待中的条目可排序）", "邻居不可调整的 title 说明");
  assert.equal(queuedRow.canRemove, true, "等待条目可移出");
  assert.equal(queuedRow.removeTitle, "移出队列");

  /* 跳过残留：可移出、诊断可空但状态可见 */
  const skipped = model.rows[5];
  assert.equal(skipped.locked, false);
  assert.equal(skipped.canRemove, true);
  assert.equal(skipped.failedDetail, null, "无 message/reason 的残留 → failedDetail null（MUST NOT 伪造）");
}

/* ── 3. 执行指示点：waiting 优先 / running 次之 / 无执行条目 → null ── */
{
  const entriesOf = (entries) => projectQueuePanel({ queue: { entries }, wsId: "ws", now: 1 });
  assert.equal(
    entriesOf([
      { id: "a", wsId: "ws", proposalId: "p1", buttonName: "b", state: "executing", subState: "running" },
      { id: "b", wsId: "ws", proposalId: "p2", buttonName: "b", state: "executing", subState: "waiting" }
    ]).indicator,
    "waiting",
    "running + waiting 并存 → waiting（琥珀优先）"
  );
  assert.equal(
    entriesOf([{ id: "a", wsId: "ws", proposalId: "p1", buttonName: "b", state: "executing" }]).indicator,
    "running",
    "仅 executing（无子态）→ running"
  );
  assert.equal(
    entriesOf([{ id: "a", wsId: "ws", proposalId: "p1", buttonName: "b", state: "launching" }]).indicator,
    "running",
    "launching → running"
  );
  assert.equal(
    entriesOf([{ id: "a", wsId: "ws", proposalId: "p1", buttonName: "b", state: "queued" }]).indicator,
    null,
    "仅等待条目 → 无执行指示点"
  );
  assert.equal(
    entriesOf([{ id: "a", wsId: "ws", proposalId: "p1", buttonName: "b", state: "failed" }]).indicator,
    null,
    "仅残留 → 无执行指示点"
  );
  const noSubState = entriesOf([{ id: "a", wsId: "ws", proposalId: "p1", buttonName: "b", state: "executing" }]).rows[0];
  assert.equal(noSubState.badgeKey, "running", "executing 无子态 → running");
  assert.equal(noSubState.badgeLabel, "执行中");
}

/* ── 4. counts：服务端透传优先、缺键按 entries 现算兜底 ── */
{
  const model = projectQueuePanel({
    queue: {
      counts: { total: 9, queued: 2, active: 5 },
      entries: [{ id: "x", wsId: "ws", proposalId: "p", buttonName: "b", state: "queued" }]
    },
    wsId: "ws",
    now: 1
  });
  assert.equal(model.counts.total, 9, "服务端 total 透传");
  assert.equal(model.counts.queued, 2, "服务端 queued 透传");
  assert.equal(model.counts.active, 5, "服务端 active 透传");
  assert.equal(model.counts.launching, 0, "缺键 → 按 entries 现算");
  assert.equal(model.counts.executing, 0, "缺键 → 按 entries 现算（executing）");
  assert.equal(model.counts.failed, 0);
  assert.equal(model.counts.skipped, 0);
}

/* ── 5. 操作矩阵：锁定全枚举（launching / executing 含子态恒锁定） ── */
{
  for (const state of ["queued", "failed", "skipped"]) {
    assert.equal(queueEntryLockedOf({ state }), false, state + " 不锁定");
    assert.equal(queueEntryLockedOf({ state, subState: "waiting" }), false, state + " 带 subState 仍不锁定（子态只服务 executing）");
  }
  for (const state of ["launching", "executing"]) {
    assert.equal(queueEntryLockedOf({ state }), true, state + " 锁定");
    assert.equal(queueEntryLockedOf({ state, subState: "running" }), true, state + " + running 锁定");
    assert.equal(queueEntryLockedOf({ state, subState: "waiting" }), true, state + " + waiting 锁定（等待决策同锁）");
  }
  assert.equal(queueEntryLockedOf({ state: "weird" }), false, "未知状态不锁定（但操作矩阵另按不可用处理）");
  assert.equal(queueEntryLockedOf(null), false, "null → false");
  assert.equal(queueEntryLockedOf({}), false, "无 state → false");
}

/* ── 6. 操作矩阵：可移出全枚举（queued + 终态残留；executing 锁定） ── */
{
  const cases = { queued: true, failed: true, skipped: true, launching: false, executing: false, weird: false };
  for (const [state, expected] of Object.entries(cases)) {
    assert.equal(queueEntryRemovableOf({ state }), expected, state + " 可移出 = " + expected);
  }
  assert.equal(queueEntryRemovableOf(null), false, "null → false");
  assert.equal(queueEntryRemovableOf({}), false, "无 state → false");
  assert.equal(queueEntryRemovableOf({ state: "executing", subState: "waiting" }), false, "等待决策不可移出");
}

/* ── 7. 排序可用性：仅自身 queued 且相邻 queued ── */
{
  const list = [
    { state: "queued" },
    { state: "queued" },
    { state: "executing" },
    { state: "queued" },
    { state: "failed" }
  ];
  assert.deepEqual(queueOrderFlagsOf(list, 0), { canMoveUp: false, canMoveDown: true }, "队首：上移 false / 下移 true");
  assert.deepEqual(queueOrderFlagsOf(list, 1), { canMoveUp: true, canMoveDown: false }, "下邻 executing → 下移 false");
  assert.deepEqual(queueOrderFlagsOf(list, 2), { canMoveUp: false, canMoveDown: false }, "非 queued 条目不可排序");
  assert.deepEqual(queueOrderFlagsOf(list, 3), { canMoveUp: false, canMoveDown: false }, "上邻 executing / 下邻 failed → 双 false");
  assert.deepEqual(queueOrderFlagsOf(list, 4), { canMoveUp: false, canMoveDown: false }, "终态残留不可排序");
  assert.deepEqual(queueOrderFlagsOf([{ state: "queued" }], 0), { canMoveUp: false, canMoveDown: false }, "单条：两端边界");
  assert.deepEqual(queueOrderFlagsOf([{ state: "queued" }, { state: "queued" }], 1), { canMoveUp: true, canMoveDown: false }, "队尾：上移 true / 下移 false");
  assert.deepEqual(queueOrderFlagsOf(list, 99), { canMoveUp: false, canMoveDown: false }, "越界 → 双 false");
  assert.deepEqual(queueOrderFlagsOf(list, -1), { canMoveUp: false, canMoveDown: false }, "负下标 → 双 false");
  assert.deepEqual(queueOrderFlagsOf(null, 0), { canMoveUp: false, canMoveDown: false }, "非数组 → 双 false");
}

/* ── 8. 重复入队键集：仅 queued 命中 + 跨工作区唯一 + 防御形状 ── */
{
  const snapshot = {
    version: 3,
    revisedAt: 1700000000000,
    queues: {
      ws1: {
        paused: false,
        entries: [
          { id: "a", wsId: "ws1", proposalId: "add-a", buttonName: "执行", state: "queued" },
          { id: "b", wsId: "ws1", proposalId: "add-b", buttonName: "审阅", state: "failed" },
          { id: "c", wsId: "ws1", proposalId: "add-c", buttonName: "实施", state: "skipped" }
        ]
      },
      ws2: {
        paused: false,
        entries: [{ id: "d", wsId: "ws2", proposalId: "add-a", buttonName: "执行", state: "queued" }]
      }
    }
  };
  const keys = queuePendingKeysOf(snapshot);
  assert.equal(keys.size, 2, "仅 queued 命中（failed / skipped 残留不构成「已排队」）");
  assert.ok(keys.has(queueEnqueuedKeyOf("ws1", "add-a", "执行")), "ws1 queued 键命中");
  assert.ok(keys.has(queueEnqueuedKeyOf("ws2", "add-a", "执行")), "ws2 同三元组键独立（跨工作区唯一）");
  assert.ok(!keys.has(queueEnqueuedKeyOf("ws1", "add-b", "审阅")), "failed 残留不命中");
  assert.ok(!keys.has(queueEnqueuedKeyOf("ws1", "add-c", "实施")), "skipped 残留不命中");
  assert.equal(queueEnqueuedKeyOf("ws1", "add-a", "执行"), "ws1\u0000add-a\u0000执行", "NUL 分隔三元组");

  /* 防御形状：单星座队列对象 / 缺失 / 空映射 / 畸形条目 */
  assert.equal(
    queuePendingKeysOf({ entries: [{ wsId: "ws1", proposalId: "add-a", buttonName: "执行", state: "queued" }] }).size,
    1,
    "单星座队列形状同样可用"
  );
  assert.equal(queuePendingKeysOf(null).size, 0, "缺失 → 空集");
  assert.equal(queuePendingKeysOf({ queues: {} }).size, 0, "空映射 → 空集");
  assert.equal(
    queuePendingKeysOf({ queues: { ws1: { entries: [{ state: "queued", proposalId: "p", buttonName: "b" }] } } }).size,
    0,
    "缺 wsId 的畸形条目不产生空键（MUST NOT 跨条目碰撞）"
  );
}

/* ── 9. 作用域：钻取优先 / 选中兜底 / 空与缺失 → null ── */
{
  const queues = {
    ws1: { paused: false, entries: [{ id: "a", wsId: "ws1", proposalId: "p", buttonName: "b", state: "queued" }] },
    ws2: { paused: false, entries: [] }
  };
  assert.equal(queueScopeOf({ drillWsId: "ws1", selectedWsId: "ws2", queues }), "ws1", "钻取优先于选中");
  assert.equal(queueScopeOf({ drillWsId: null, selectedWsId: "ws1", queues }), "ws1", "银河态选中兜底");
  assert.equal(queueScopeOf({ drillWsId: null, selectedWsId: null, queues }), null, "无作用域 → null");
  assert.equal(queueScopeOf({ drillWsId: "", selectedWsId: "", queues }), null, "空串视为无作用域");
  assert.equal(queueScopeOf({ drillWsId: "ws2", selectedWsId: "ws1", queues }), null, "作用域队列为空（entries 0）→ null");
  assert.equal(queueScopeOf({ drillWsId: "missing", selectedWsId: null, queues }), null, "队列不存在 → null");
  assert.equal(queueScopeOf({ drillWsId: "ws1", selectedWsId: null, queues: null }), null, "快照缺失 → null");
  assert.equal(queueScopeOf(), null, "无参 → null");
}

/* ── 10. cross-hover：queue 源与 card 源同构 + 星胚存活放宽 ── */
{
  const ws = {
    id: "ws1",
    name: "alpha",
    stars: [
      { id: "add-a", lifecycle: "reviewed" },
      { id: "proto-p1", lifecycle: "proto" }
    ],
    links: [],
    planets: [{ id: "s1", stars: ["add-a"] }],
    comets: []
  };
  assert.deepEqual(
    crossHoverTargets({ source: "queue", wsId: "ws1", kind: "star", id: "add-a" }, ws),
    crossHoverTargets({ source: "card", wsId: "ws1", kind: "star", id: "add-a" }, ws),
    "queue 源与 card 源派生同一受体集（source 不改变 star 分支口径）"
  );
  assert.deepEqual(
    crossHoverTargets({ source: "queue", wsId: "ws1", kind: "star", id: "add-a" }, ws).sessionIds,
    ["s1"],
    "关联会话行受体不变（队列条目 hover → 对应会话行联动）"
  );
  assert.equal(
    hoverSourceAlive({ workspaces: [ws] }, { source: "queue", wsId: "ws1", kind: "star", id: "proto-p1" }),
    true,
    "queue 源认星胚恒星（preState:proto 按钮同样可入队）"
  );
  assert.equal(
    hoverSourceAlive({ workspaces: [ws] }, { source: "card", wsId: "ws1", kind: "star", id: "proto-p1" }),
    false,
    "card 源口径不变（星胚走合并卡分支）"
  );
  assert.equal(
    hoverSourceAlive({ workspaces: [ws] }, { source: "queue", wsId: "ws1", kind: "star", id: "gone" }),
    false,
    "queue 源实体被摘除 → 清理"
  );
}

/* ── 11. 文案常量表（徽标键集与设计约定一致） ── */
{
  assert.deepEqual(QUEUE_BADGES.queued, { key: "queued", label: "等待" });
  assert.deepEqual(QUEUE_BADGES.launching, { key: "running", label: "执行中" });
  assert.deepEqual(QUEUE_BADGES.executing, { key: "running", label: "执行中" });
  assert.deepEqual(QUEUE_BADGES.waiting, { key: "waiting", label: "等待决策" });
  assert.deepEqual(QUEUE_BADGES.failed, { key: "failed", label: "失败" });
  assert.deepEqual(QUEUE_BADGES.skipped, { key: "skipped", label: "跳过" });
}

/* ── 12. client.jsx 源锚点（store / SSE 分流 / 面板 / 入队钮 / CSS） ── */
const clientSource = readFileSync(new URL("../src/client.jsx", import.meta.url), "utf8");
{
  /* 12a. api 桥与投影 store */
  assert.ok(
    clientSource.includes('import { fetchScene, subscribeCosmosEvents, bindSession, fetchQueue, queueAction } from "./api.mjs";'),
    "api 桥导入 fetchQueue / queueAction"
  );
  assert.ok(
    clientSource.includes("projectQueuePanel") && clientSource.includes("queuePendingKeysOf") && clientSource.includes("queueScopeOf"),
    "panel.mjs 队列投影函数导入"
  );
  assert.ok(
    clientSource.includes("const cosmosQueueStore = createSnapshotStore({ status: \"idle\", revisedAt: 0, queues: {} });"),
    "模块级队列投影 store（快照对象稳定引用）"
  );
  assert.ok(clientSource.includes("async function refreshQueue()"), "refreshQueue 唯一写者（失败保留旧快照 + error）");
  assert.ok(clientSource.includes("if (result?.ok === true) return publishQueueSnapshot(queueSnapshotOf(result.queue));"), "成功发布快照");
  assert.ok(clientSource.includes("status: current.status === \"ready\" ? \"ready\" : \"error\","), "失败保留旧投影并记录错误");
  assert.ok(clientSource.includes('if (frame?.type === "queue-changed") {'), "SSE 帧类型分流");
  assert.ok(clientSource.includes("refreshQueue();"), "queue-changed → 拉取全量快照对账");
  assert.ok(clientSource.includes("refreshSkeleton();"), "proposals / associations 帧维持既有骨架重拉");
  assert.ok(clientSource.includes("      refreshQueue();"), "页面挂载与 scene 同批拉取队列快照");

  /* 12b. 队列面板 DOM 钩子与零布局门控 */
  assert.ok(clientSource.includes('className="dsh-cosmos-queue"'), "队列面板容器 JSX");
  assert.ok(clientSource.includes('data-plugin-anchor="dsh-v-cosmos:queue"'), "队列面板插件锚点");
  assert.ok(clientSource.includes("data-indicator={model.indicator}"), "执行指示点 data-indicator");
  assert.ok(clientSource.includes('data-cosmos-queue-pause="true"'), "暂停/继续钮钩子");
  assert.ok(clientSource.includes('data-cosmos-queue-clear="true"'), "清空钮钩子");
  assert.ok(clientSource.includes('data-armed={clearArmed ? "true" : undefined}'), "清空两击确认 armed 态");
  assert.ok(
    clientSource.includes('data-cosmos-queue-op="up"')
      && clientSource.includes('data-cosmos-queue-op="down"')
      && clientSource.includes('data-cosmos-queue-op="remove"'),
    "条目操作钮三件套（▲ / ▼ / ✕）"
  );
  assert.ok(clientSource.includes("disabled={!row.canMoveUp}") && clientSource.includes("disabled={!row.canRemove}"), "非 queued / 边界禁用（操作矩阵前端先行）");
  assert.ok(clientSource.includes("{row.failedDetail ? ("), "失败 / 跳过残留显示可见诊断行（message + reason）");
  assert.ok(clientSource.includes(".dsh-cosmos-queue-detail{"), "残留诊断行 CSS（单行省略）");
  assert.ok(
    clientSource.includes("const modelVisible = model !== null && model !== undefined && model.visible === true;")
      && clientSource.includes("if (!modelVisible) return null;"),
    "空队列整面板不渲染（visible 门控 = 零布局）"
  );
  assert.ok(clientSource.includes("onHoverEntry={hoverQueueEntry}"), "条目 hover 接线（cross-hover）");
  assert.ok(
    clientSource.includes('setPanelHover({ source: "queue", wsId: row.wsId, kind: "star", id: row.proposalId })'),
    "queue 源悬停描述与卡源同构"
  );
  assert.ok(clientSource.includes("<QueuePanel"), "主页面 JSX 挂点（ProposalPanel 之后）");
  assert.ok(clientSource.includes("drilled={drill !== null && drill !== undefined}"), "钻取态样式标记");
  assert.ok(!/window\.confirm\s*\(/.test(clientSource), "清空确认不调用 window.confirm（面板内 armed 态，注释提及不算）");

  /* 12c. CSS：定位 / 零占位 / 等待琥珀 / 呼吸动画 / dock 适配 / 操作钮 hover 浮出 */
  assert.ok(
    clientSource.includes(".dsh-cosmos-queue{position:absolute;right:calc(var(--cos-const-panel-w, 187px) + 8px)"),
    "队列面板定位（提案面板左邻）"
  );
  assert.ok(
    clientSource.includes(".dsh-cosmos-queue{") && clientSource.includes("bottom:calc(var(--cos-actions-h,0px) + 72px)"),
    "底部让位动作条规则（与提案 / 会话面板同源）"
  );
  assert.ok(clientSource.includes("@keyframes cos-queue-breath"), "执行指示点呼吸动画");
  assert.ok(clientSource.includes("--cos-waiting"), "等待决策琥珀色表达（宿主 alias → --cos-waiting 级联）");
  assert.ok(clientSource.includes(".dsh-cosmos-queue-badge[data-badge=waiting]"), "等待决策徽标取色");
  assert.ok(clientSource.includes(".dsh-cosmos-queue-clear[data-armed=true]"), "清空 armed 提亮规则");
  assert.ok(clientSource.includes(".dsh-cosmos-queue-row:hover .dsh-cosmos-queue-ops"), "操作钮 hover 浮出");
  assert.ok(clientSource.includes(".dsh-cosmos-queue-row[data-linked=true]::after"), "队列行受体标记（跨面板联动）");
  assert.ok(clientSource.includes(".cos-page-dock .dsh-cosmos-queue{"), "dock 窄列适配规则（宽度不撑破 / 右邻偏移回算）");
  assert.ok(clientSource.includes('data-cos-mode="light"] .dsh-cosmos-queue'), "light 模式队列面板并入阴影族");

  /* 12d. 动作条配套入队钮（同尺寸成对 / 同门控 / 不导航） */
  assert.ok(clientSource.includes('className="dsh-cosmos-action-pair"'), "主按钮与入队钮成对容器");
  assert.ok(clientSource.includes('className="dsh-cosmos-enqueue"'), "同尺寸入队钮");
  assert.ok(clientSource.includes("data-cosmos-enqueue={button.name}"), "入队钮钩子 data-cosmos-enqueue");
  assert.ok(clientSource.includes("const enqueueDisabled = disabled || enqueue?.disabled === true;"), "入队钮与主按钮同禁用门");
  assert.ok(clientSource.includes("if (enqueueDisabled) return;"), "禁用态点击短路");
  assert.ok(
    clientSource.includes("event.stopPropagation();") && clientSource.includes("event.preventDefault();"),
    "入队点击阻止冒泡 / 默认行为（不触发整页点击面）"
  );
  assert.ok(clientSource.includes("onEnqueue={enqueueAction}") && clientSource.includes("enqueueStateOf={enqueueStateOf}"), "主页面接线入队 props");
  assert.ok(clientSource.includes("queuePendingKeysOf(queueSnapshot)"), "已排队键集用于入队钮禁用");
  assert.ok(clientSource.includes("if (queuePendingKeys.has(key)) {"), "已排队 → 禁用分支");
  assert.ok(clientSource.includes('title: tr("cosmos.queue.pending", "已在队列中")'), "已排队 title 文案");
  assert.ok(
    clientSource.includes(".dsh-cosmos-action-pair{display:grid;grid-template-columns:1fr 1fr;gap:6px;min-width:0}"),
    "成对容器 CSS（1fr 1fr → 两钮完全同宽）"
  );
  assert.ok(
    clientSource.includes(".dsh-cosmos-enqueue{box-sizing:border-box;min-height:var(--cos-action-btn-h, 40px);padding:6px 8px;")
      && clientSource.includes(".dsh-cosmos-action{box-sizing:border-box;min-height:var(--cos-action-btn-h, 40px);padding:6px 8px;"),
    "入队钮与主按钮同尺寸几何（同 min-height / padding / flex）"
  );
  assert.ok(!clientSource.includes(".dsh-cosmos-enqueue{position:absolute"), "入队钮不再绝对定位（同尺寸成对，非迷你钮）");
  assert.ok(clientSource.includes("const columns = Math.min(4, buttons.length);"), "每行最多 4 对（= 原 8 列满宽，动作条最大宽度不变）");
  assert.ok(clientSource.includes(".dsh-cosmos-enqueue:disabled{opacity:.35;cursor:not-allowed}"), "入队钮禁用视觉");
  assert.ok(clientSource.includes('"cosmos.actions.enqueueLabel": "＋ 入队"'), "词典 zh：入队钮标签");
  assert.ok(clientSource.includes('"cosmos.actions.enqueueLabel": "＋ Queue"'), "词典 en：入队钮标签");

  /* 12e. 入队处理 MUST NOT 走执行链路（精确片段断言） */
  const enqueueStart = clientSource.indexOf("const enqueueAction = async (button) => {");
  const enqueueEnd = clientSource.indexOf("const enqueueStateOf = (button) => {");
  assert.ok(enqueueStart > 0 && enqueueEnd > enqueueStart, "enqueueAction 片段可定位");
  const enqueueBody = clientSource.slice(enqueueStart, enqueueEnd);
  assert.ok(!enqueueBody.includes("runAction("), "入队处理 MUST NOT 调用 runAction（入队不是执行）");
  assert.ok(!enqueueBody.includes("createActionGate"), "入队处理 MUST NOT 消耗动作条点击冷却门");
  assert.ok(!enqueueBody.includes("openSession"), "入队处理 MUST NOT 导航 / 打开会话");
  assert.ok(!enqueueBody.includes("setDraft"), "入队处理 MUST NOT 打草稿");
  assert.ok(!enqueueBody.includes("actions.runButton"), "入队处理 MUST NOT 经控制器执行体");
  assert.ok(enqueueBody.includes('queueAction("enqueue"'), "入队只经服务端 enqueue 动词");
  assert.ok(
    enqueueBody.includes("wsId: card.wsId") && enqueueBody.includes("proposalId: card.id") && enqueueBody.includes("buttonName: button.name"),
    "入队载荷符合冻结契约 {wsId, proposalId, buttonName}"
  );
  assert.ok(enqueueBody.includes("if (!card || !actionButtonVisible(button, card)) return;"), "入队点击瞬间复验前置门控（与主按钮同谓词）");

  /* 12f. 错误码映射与词典成对 */
  assert.ok(clientSource.includes('if (code === "duplicate") return tr("cosmos.queue.duplicate", "已在队列中");'), "duplicate → 已在队列中");
  assert.ok(clientSource.includes('if (code === "limit") return tr("cosmos.queue.limit", "队列已满（32）");'), "limit → 队列已满（32）");
  assert.ok(clientSource.includes('if (code === "gate") return tr("cosmos.queue.gate", "前置状态不匹配");'), "gate → 前置状态不匹配");
  assert.ok(
    clientSource.includes('if (code === "unknown route")')
      && clientSource.includes('tr("cosmos.queue.hostStale", "宿主半区未加载队列接口：请重启 DSH 后重试")'),
    "unknown route（宿主半区未重启）→ 明确重启指引"
  );
  assert.ok(clientSource.includes('"cosmos.queue.title": "自动队列"'), "词典 zh：队列面板标题");
  assert.ok(clientSource.includes('"cosmos.queue.title": "Auto queue"'), "词典 en：队列面板标题");

  /* 12g. 导出面（bundle 级冒烟观测点） */
  assert.ok(clientSource.includes("ProposalPanel, SessionPanel, QueuePanel, ActionBar"), "QueuePanel 进入导出清单");
  assert.ok(clientSource.includes("cosmosQueueStore, refreshQueue"), "cosmosQueueStore / refreshQueue 进入导出清单");
  assert.ok(
    clientSource.includes("fetchScene, subscribeCosmosEvents, bindSession, fetchQueue, queueAction"),
    "fetchQueue / queueAction 进入导出清单"
  );
}

console.log("queue-ui-smoke: all assertions passed");
