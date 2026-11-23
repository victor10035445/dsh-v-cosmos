/**
 * 曲率队列（浏览器半区）冒烟（two-add-cosmos-proposal-warp 6.5 / spec
 * cosmos-proposal-warp「曲率队列呈现（曲率页签与条目行）」「持久化与多窗口广播」+
 * cosmos-action-queue「队列呈现」改写）：
 *  - panel.mjs 曲率投影纯函数：空队列可见性（零布局）/ 状态徽标（含 executing「等待决策」
 *    与 ready「等待会话空闲」两个呈现子态）/ 计数透传与现算兜底 / 行顺序（服务端顺序）/
 *    残留诊断 / 操作矩阵（launching|executing 锁定；其余可移出）/ 作用域解析 /
 *    「已托管」目标键集（非终态命中）/ warp 源 cross-hover 同构；
 *  - client.jsx 源锚点：api 桥（fetchWarp/warpAction）、模块级 `cosmosWarpStore` /
 *    `cosmosWarpPlanStore`、`refreshWarp` 唯一写者、SSE `warp-changed` 分流、页面挂载
 *    同批拉取、双页签面板 DOM 钩子、曲率按钮门控与「零导航」点击链、grayed 降饱和 CSS；
 *  - settings-ui.jsx：曲率引擎页签组件（行多选 + 规则下拉 + 暂存-保存 + 覆盖/重置）。
 *
 * React 组件树在 Node 侧不可挂载（react 为 bundle external），故呈现面走源码锚点 +
 * 纯逻辑直测（与 queue-ui-smoke 同法）。
 * 运行：node test/warp-ui-smoke.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  WARP_BADGES,
  cardIsLinkedOf,
  crossHoverTargets,
  projectWarpPanel,
  warpEntryLockedOf,
  warpEntryRemovableOf,
  warpPendingTargetKeysOf,
  warpScopeOf,
  warpTargetKeyOf
} from "../src/panel.mjs";

/* ── 1. 空队列 / 缺失队列 → 零布局（页签不呈现） ── */
{
  const empty = projectWarpPanel({ warp: { paused: false, entries: [] }, wsId: "ws1", now: 1000 });
  assert.equal(empty.visible, false, "空曲率队列不可见（页签不呈现）");
  assert.deepEqual(empty.rows, [], "空队列零行");
  assert.equal(empty.indicator, null, "无条目无指示点");
  assert.deepEqual(empty.counts, {
    total: 0, grayed: 0, ready: 0, launching: 0, executing: 0, failed: 0, skipped: 0, inflight: 0, pending: 0
  }, "空队列计数归零");
  assert.equal(projectWarpPanel({ warp: null, wsId: "ws1" }).visible, false, "队列缺失 → 不可见（MUST NOT 抛错）");
  assert.equal(projectWarpPanel().visible, false, "无参调用 → 空投影");
  assert.equal(warpScopeOf({}), null, "无作用域 → null");
  assert.equal(warpScopeOf({ drillWsId: null, selectedWsId: "ws1", warps: {} }), null, "空队列星座 → null");
  assert.equal(warpScopeOf({ drillWsId: "ws1", selectedWsId: "ws2", warps: { ws1: { entries: [] } } }), null, "钻取优先但空 → null");
  assert.equal(warpScopeOf({ drillWsId: "ws1", selectedWsId: null, warps: { ws1: { entries: [{ id: "w1" }] } } }), "ws1", "非空 → 作用域");
}

/* ── 2. 全状态行投影：徽标 / 子态 / 指示点 / 计数 / 操作矩阵 ── */
{
  const entries = [
    { id: "e1", wsId: "ws1", targetKey: "add-a", targetKind: "proposal", targetLabel: "提案 A", buttonName: "Review", rule: "direct", state: "grayed", enqueuedAt: 1000 },
    { id: "e2", wsId: "ws1", targetKey: "add-a", targetKind: "proposal", targetLabel: "提案 A", buttonName: "Apply", rule: "queue", state: "ready", subState: "waiting-session", enqueuedAt: 2000 },
    { id: "e3", wsId: "ws1", targetKey: "add-b", targetKind: "proposal", targetLabel: "提案 B", buttonName: "Archive", rule: "direct", state: "executing", subState: "waiting", enqueuedAt: 3000 },
    { id: "e4", wsId: "ws1", targetKey: "sess-1", targetKind: "embryo", targetLabel: "s1/s2", buttonName: "New", rule: "direct", state: "executing", subState: "running", anchorSlugs: ["s1", "s2"], enqueuedAt: 4000 },
    { id: "e5", wsId: "ws1", targetKey: "add-c", targetKind: "proposal", targetLabel: "提案 C", buttonName: "Review", rule: "direct", state: "failed", reason: "busy-timeout", message: "投递异常", enqueuedAt: 5000 },
    { id: "e6", wsId: "ws1", targetKey: "add-d", targetKind: "proposal", targetLabel: "提案 D", buttonName: "Review", rule: "direct", state: "skipped", enqueuedAt: 6000 },
    { id: "e7", wsId: "ws1", targetKey: "add-e", targetKind: "proposal", targetLabel: "提案 E", buttonName: "Review", rule: "direct", state: "launching", enqueuedAt: 7000 }
  ];
  const model = projectWarpPanel({
    warp: { paused: true, counts: { total: 7 }, entries },
    wsId: "ws1",
    now: 60000
  });
  assert.equal(model.visible, true);
  assert.equal(model.paused, true);
  assert.equal(model.indicator, "waiting", "存在 executing+waiting → waiting 优先（琥珀）");
  assert.deepEqual(model.rows.map((row) => row.id), ["e1", "e2", "e3", "e4", "e5", "e6", "e7"], "行顺序 = 服务端顺序（无排序语义）");
  assert.deepEqual(model.rows.map((row) => row.badgeKey), ["grayed", "waiting-session", "waiting", "running", "failed", "skipped", "running"], "徽标键（子态二次分派）");
  assert.deepEqual(model.rows.map((row) => row.badgeLabel), ["置灰", "等待会话空闲", "等待决策", "执行中", "失败", "跳过", "执行中"], "徽标文案");
  assert.deepEqual(model.counts, {
    total: 7, grayed: 1, ready: 1, launching: 1, executing: 2, failed: 1, skipped: 1, inflight: 3, pending: 2
  }, "计数：服务端 total 透传 + 缺键按 entries 现算");

  /* 操作矩阵：grayed/ready/failed/skipped 可移出；launching/executing 锁定 */
  assert.equal(model.rows[0].canRemove, true, "grayed 可移出");
  assert.equal(model.rows[0].locked, false);
  assert.equal(model.rows[1].canRemove, true, "ready 可移出");
  assert.equal(model.rows[2].canRemove, false, "executing（等待决策）锁定");
  assert.equal(model.rows[2].locked, true);
  assert.equal(model.rows[2].removeTitle, "执行中条目不可移出");
  assert.equal(model.rows[4].canRemove, true, "failed 残留可移出");
  assert.equal(model.rows[4].failedDetail.includes("投递异常"), true, "残留诊断含 message");
  assert.equal(model.rows[4].failedDetail.includes("busy-timeout"), true, "残留诊断含 reason");
  assert.equal(model.rows[5].failedDetail, null, "无诊断残留 failedDetail null（MUST NOT 伪造）");
  assert.equal(model.rows[6].canRemove, false, "launching 锁定");

  /* 星胚目标：anchorSlugs 透出（cross-hover 用） + 目标名/动作条名 */
  assert.deepEqual(model.rows[3].anchorSlugs, ["s1", "s2"]);
  assert.equal(model.rows[3].targetKind, "embryo");
  assert.equal(model.rows[3].buttonName, "New");
  assert.equal(model.rows[3].targetLabel, "s1/s2");
  assert.ok(model.rows[3].rowTitle.includes("曲率直航"), "行 title 含分流规则");
  assert.ok(model.rows[1].rowTitle.includes("转入脉冲队列"), "队列规则行 title");
  assert.ok(model.rows[1].rowTitle.includes("等待会话空闲"), "等待会话空闲子态在 title");
  assert.equal(model.rows[1].rule, "queue");

  /* 独立判定函数与徽标常量 */
  assert.equal(warpEntryLockedOf({ state: "executing" }), true);
  assert.equal(warpEntryLockedOf({ state: "launching" }), true);
  assert.equal(warpEntryLockedOf({ state: "ready" }), false);
  assert.equal(warpEntryRemovableOf({ state: "grayed" }), true);
  assert.equal(warpEntryRemovableOf({ state: "executing" }), false);
  assert.equal(warpEntryRemovableOf({ state: "unknown" }), false, "未知状态不可操作");
  assert.deepEqual(WARP_BADGES.ready, { key: "ready", label: "待发" });
  assert.deepEqual(WARP_BADGES.waitingSession, { key: "waiting-session", label: "等待会话空闲" });
}

/* ── 3. 计数透传与现算兜底 ── */
{
  const model = projectWarpPanel({
    wsId: "ws1",
    warp: {
      counts: { total: 9, grayed: 2, ready: 3 },
      entries: [
        { id: "a", state: "grayed" },
        { id: "b", state: "ready" },
        { id: "c", state: "executing" }
      ]
    }
  });
  assert.equal(model.counts.total, 9, "服务端 total 透传");
  assert.equal(model.counts.grayed, 2, "服务端 grayed 透传");
  assert.equal(model.counts.ready, 3, "服务端 ready 透传");
  assert.equal(model.counts.executing, 1, "缺键 → 按 entries 现算");
  assert.equal(model.counts.inflight, 1, "inflight 现算");
  assert.equal(model.counts.pending, 5, "pending = grayed + ready");
}

/* ── 4. 「已托管」目标键集 + 跨工作区唯一键 ── */
{
  const warp = {
    warps: {
      ws1: {
        entries: [
          { id: "e1", wsId: "ws1", targetKey: "add-a", state: "grayed" },
          { id: "e2", wsId: "ws1", targetKey: "add-b", state: "ready" },
          { id: "e3", wsId: "ws1", targetKey: "add-c", state: "launching" },
          { id: "e4", wsId: "ws1", targetKey: "add-d", state: "executing" },
          { id: "e5", wsId: "ws1", targetKey: "add-e", state: "failed" },
          { id: "e6", wsId: "ws1", targetKey: "add-f", state: "skipped" }
        ]
      },
      ws2: { entries: [{ id: "e7", wsId: "ws2", targetKey: "add-a", state: "ready" }] }
    }
  };
  const keys = warpPendingTargetKeysOf(warp);
  assert.equal(keys.has(warpTargetKeyOf("ws1", "add-a")), true, "grayed 命中已托管");
  assert.equal(keys.has(warpTargetKeyOf("ws1", "add-b")), true, "ready 命中");
  assert.equal(keys.has(warpTargetKeyOf("ws1", "add-c")), true, "launching 命中");
  assert.equal(keys.has(warpTargetKeyOf("ws1", "add-d")), true, "executing 命中");
  assert.equal(keys.has(warpTargetKeyOf("ws1", "add-e")), false, "failed 残留不构成重复");
  assert.equal(keys.has(warpTargetKeyOf("ws1", "add-f")), false, "skipped 残留不构成重复");
  assert.equal(keys.has(warpTargetKeyOf("ws2", "add-a")), true, "同目标名跨工作区唯一键");
  assert.equal(warpTargetKeyOf("ws1", "add-a").includes("\u0000"), true, "NUL 分隔（防拼接歧义）");
}

/* ── 5. warp 源 cross-hover（提案卡 / 星胚合并卡） ── */
{
  const ws = {
    id: "ws1",
    stars: [
      { id: "add-a", lifecycle: "created" },
      { id: "add-z", lifecycle: "created" },
      { id: "s1", lifecycle: "proto" }
    ],
    links: [[0, 1]],
    planets: [{ id: "planet-1", stars: ["s1"] }],
    comets: []
  };
  const targets = crossHoverTargets({ source: "warp", wsId: "ws1", kind: "star", id: "add-a" }, ws);
  assert.deepEqual(targets.proposalIds, ["add-z"], "warp 源提案目标联动共享会话的提案卡（与队列源同构）");
  const protoTargets = crossHoverTargets({ source: "warp", wsId: "ws1", kind: "proto", slugs: ["s1"] }, ws);
  assert.deepEqual(protoTargets.sessionIds, ["planet-1"], "星胚合并卡 → 关联会话行");
  assert.deepEqual(protoTargets.proposalIds, ["s1"], "warp 源星胚条目联动该星胚合并卡（slug 受体）");
  const embryoCard = { wsId: "ws1", isEmbryo: true, slugs: ["s1", "s2"] };
  assert.equal(
    cardIsLinkedOf({ wsId: "ws1", proposalIds: protoTargets.proposalIds }, embryoCard),
    true,
    "星胚合并卡受体判定命中"
  );
}

/* ── 6. client.jsx 源锚点 ── */
const clientSource = readFileSync(new URL("../src/client.jsx", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("../src/settings-ui.jsx", import.meta.url), "utf8");
{
  /* 6a. api 桥 + 投影 store + 唯一写者 + 帧分流 + 页面挂载同批 */
  assert.ok(
    clientSource.includes("fetchWarp, warpAction"),
    "api 桥导入 fetchWarp / warpAction"
  );
  assert.ok(
    clientSource.includes("projectWarpPanel") && clientSource.includes("warpPendingTargetKeysOf") && clientSource.includes("warpScopeOf"),
    "panel.mjs 曲率投影函数导入"
  );
  assert.ok(
    clientSource.includes("const cosmosWarpStore = createSnapshotStore({ status: \"idle\", revisedAt: 0, warps: {} });"),
    "模块级曲率投影 store"
  );
  assert.ok(
    clientSource.includes("const cosmosWarpPlanStore = createSnapshotStore({ bars: [] });"),
    "曲率计划生效值镜像 store（按钮门控）"
  );
  assert.ok(clientSource.includes("async function refreshWarp()"), "refreshWarp 唯一写者");
  assert.ok(clientSource.includes("if (result?.ok === true) return publishWarpSnapshot(warpSnapshotOf(result.warp));"), "成功发布快照");
  assert.ok(clientSource.includes('if (frame?.type === "warp-changed") {'), "SSE warp-changed 帧类型分流");
  assert.ok(clientSource.includes("refreshWarp();"), "warp-changed → 拉取全量快照对账");
  assert.ok(clientSource.includes("      refreshWarp();"), "页面挂载与 scene / queue 同批拉取曲率快照");

  /* 6b. 双页签面板 DOM 钩子（脉冲语义保留 + 曲率页签） */
  assert.ok(clientSource.includes('className="dsh-cosmos-queue-tabs"'), "页签行容器");
  assert.ok(clientSource.includes('data-cosmos-queue-tab="pulse"'), "脉冲页签钩子");
  assert.ok(clientSource.includes('data-cosmos-queue-tab="warp"'), "曲率页签钩子");
  assert.ok(clientSource.includes('data-cosmos-warp-pause="true"'), "曲率暂停/继续钮");
  assert.ok(clientSource.includes('data-cosmos-warp-op="remove"'), "曲率单条移出钮");
  assert.ok(clientSource.includes('data-cosmos-warp={row.id}'), "曲率条目行钩子");
  assert.ok(clientSource.includes("data-cosmos-warp-target={row.targetKey}"), "曲率条目目标钩子");
  assert.ok(clientSource.includes("setActiveTab"), "页签本地选中态（客户端 UI 态）");
  assert.ok(clientSource.includes("const pulseVisible = model !== null"), "双队列可见性投影");
  assert.ok(clientSource.includes("if (!modelVisible) return null;"), "双队列皆空 → 整面板隐藏（零布局）");
  assert.ok(
    clientSource.includes('const next = pulseVisible ? "pulse" : "warp";'),
    "单侧非空自动选中（默认页签 = 唯一非空侧）"
  );
  assert.ok(
    clientSource.includes('if (current === "pulse" && pulseVisible) return current;')
      && clientSource.includes('const next = pulseVisible ? "pulse" : "warp";'),
    "当前页签清空自动切换到另一非空页签"
  );
  const warpTabSource = clientSource.slice(
    clientSource.indexOf('data-warp-head="true"'),
    clientSource.indexOf("</aside>", clientSource.indexOf('data-warp-head="true"'))
  );
  assert.ok(!warpTabSource.includes("data-cosmos-queue-clear"), "曲率页签无清空钮");
  assert.ok(!warpTabSource.includes("data-cosmos-queue-op"), "曲率页签无排序钮");

  /* 6c. 曲率按钮（动作条右侧独立一枚；零导航点击链） */
  assert.ok(clientSource.includes('data-cosmos-warp="true"'), "曲率按钮钩子");
  assert.ok(clientSource.includes('onWarpAttach={attachWarpPlan}'), "按钮挂到附着链路");
  assert.ok(clientSource.includes('const result = await warpAction("attach", body);'), "附着 = POST /warp/attach");
  const attachSource = clientSource.slice(
    clientSource.indexOf("const attachWarpPlan ="),
    clientSource.indexOf("/** 暂停 / 继续", clientSource.indexOf("const attachWarpPlan ="))
  );
  assert.ok(!attachSource.includes("runAction("), "附着不调用动作执行链路");
  assert.ok(!attachSource.includes("closePage"), "附着不导航（零页面流转）");
  assert.ok(!attachSource.includes("gate.enter"), "附着不触碰动作条点击冷却门");
  assert.ok(
    clientSource.includes(".dsh-cosmos-warp{position:absolute;top:6px;bottom:6px;left:calc(100% + 10px)"),
    "曲率按钮独立定位在动作条右缘外并与主按钮同高"
  );
  assert.ok(clientSource.includes("min-width:88px"), "曲率按钮加宽（约一个主按钮宽度）");
  assert.ok(clientSource.includes(".dsh-cosmos-warp::before"), "曲率按钮轨道弧装饰（独特视觉语汇）");
  assert.ok(clientSource.includes("font-size:14px;line-height:1;letter-spacing:4px"), "曲率按钮字号/字距强化的独立语汇");
  assert.ok(clientSource.includes(".dsh-cosmos-queue-row[data-state=grayed]{opacity:.55;filter:saturate(.35)}"), "grayed 整行降饱和");

  /* 6d. 设置页「曲率引擎」页签注册（order 5 = 第 7 个页签） */
  assert.ok(clientSource.includes('id: "warp-engine"'), "「曲率引擎」标签页注册");
  assert.ok(clientSource.includes('order: 5,'), "排于「快捷键」（4）之后");
  assert.ok(clientSource.includes('label: () => sectionT("cosmos.settings.tabWarp")'), "标签文案走词典");
  assert.ok(clientSource.includes("inject: () => ({ face: warpPlanSettings })"), "注入曲率计划控制器 face");
  assert.ok(clientSource.includes("CosmosWarpPanel"), "面板组件注册");
  assert.ok(settingsSource.includes("export function CosmosWarpPanel"), "曲率引擎面板组件");
  assert.ok(settingsSource.includes('data-cosmos-warp-plan="true"'), "面板稳定钩子");
  assert.ok(settingsSource.includes('data-cosmos-warp-plan-row={row.name}'), "行钩子");
  assert.ok(settingsSource.includes("<option value=\"direct\">") && settingsSource.includes("<option value=\"queue\">"), "规则下拉两档");
  assert.ok(settingsSource.includes("face.edit(row.name, { checked: event.target.checked })"), "多选编辑");
  assert.ok(settingsSource.includes("face.edit(row.name, { rule: event.target.value === \"queue\" ? \"queue\" : \"direct\" })"), "规则编辑");
  assert.ok(settingsSource.includes("state.dirty !== true || disabled"), "保存门（dirty + writable/saving）");
  assert.ok(settingsSource.includes("face.reset?.()"), "重置入口（覆盖标记）");

  /* 6e. 词典 zh/en 成对 */
  for (const key of [
    "cosmos.warp.title",
    "cosmos.warp.button",
    "cosmos.warp.attach",
    "cosmos.warp.planEmpty",
    "cosmos.warp.attached",
    "cosmos.warp.pausedNotice",
    "cosmos.warp.remove",
    "cosmos.settings.tabWarp"
  ]) {
    const pattern = new RegExp('"' + key.replace(/\./g, "\\.") + '":', "g");
    assert.equal((clientSource.match(pattern) ?? []).length, 2, "词典 zh/en 成对：" + key);
  }

  /* 6f. 导出清单 */
  assert.ok(clientSource.includes("cosmosWarpStore, cosmosWarpPlanStore, refreshWarp"), "曲率 store / refresh 进入导出清单");
  assert.ok(clientSource.includes("projectWarpPanel, queueScopeOf, warpScopeOf"), "曲率投影进入导出清单");
  assert.ok(clientSource.includes("CosmosWarpPanel"), "曲率引擎面板进入导出清单");
  assert.ok(clientSource.includes("fetchWarp, warpAction"), "曲率 api 桥进入导出清单");
}

console.log("warp-ui-smoke: all assertions passed");
