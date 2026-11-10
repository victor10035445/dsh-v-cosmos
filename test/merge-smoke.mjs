/**
 * merge.mjs 冒烟（add-cosmos-entry 4.2/4.7/4.8 / add-celestial-states 3.1–3.5 /
 * add-comet-states-and-star-death 3.1）：行星/彗星分类、blank/子代理/未归属过滤、
 * statuses 四态推导与降级（行星与彗星同通道）、彗星四态与 pendingKind、act 活跃度（含
 * 委托忙碌）、提案归档行星回归彗星、星胚装配、卫星装配/深度折叠/孤儿/上限/委托忙碌、
 * 确定性摆放、属性级补丁 diff（含卫星/生命周期/彗星状态签名）。
 * 运行：node test/merge-smoke.mjs
 */
import assert from "node:assert/strict";
import { mergeScene, sceneDiffLevel, planetStateOf, relativeTime, constellationPositions, starOffset, dustCountOf, hash32, matchWorkspaces, filteredPositions, normalizeWorkspacePath, findRegisteredWorkspace, isWindowsPlatform } from "../src/merge.mjs";

const NOW = 1_000_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;

/** 骨架夹具：两工作区（ws1 双提案+关联，ws2 纯星云）。 */
function skeletonFixture() {
  return {
    version: 1,
    generatedAt: NOW,
    workspaces: [
      {
        id: "ws1",
        name: "dsh-v-cosmos",
        path: "C:/cosmos",
        stars: [
          { id: "add-a", name: "add-a", lifecycle: "created", setBy: "cosmos-new", at: NOW - 2 * 24 * HOUR, tasks: [2, 5], birthMs: NOW - 2 * 24 * HOUR },
          { id: "add-b", name: "add-b", lifecycle: "created", setBy: null, at: null, tasks: [0, 3], birthMs: NOW - 3 * HOUR }
        ],
        pending: [],
        archives: 3,
        links: [[0, 1]],
        associations: [
          { proposal: "add-a", sessionId: "s-planet", origin: "heuristic" },
          { proposal: "add-b", sessionId: "s-planet", origin: "heuristic" }
        ]
      },
      {
        id: "ws2",
        name: "dsh-v-hive",
        path: "C:/hive",
        stars: [],
        pending: [],
        archives: 8,
        links: [],
        associations: []
      }
    ]
  };
}

/** 会话镜像夹具。 */
function sessionsFixture() {
  return {
    ids: ["s-planet", "s-comet", "s-blank", "s-drone", "s-archived", "s-lost"],
    byId: {
      "s-planet": { displayTitle: "apply: add-cosmos-entry", running: true, updatedAt: NOW - 2 * MIN },
      "s-comet": { displayTitle: "自由会话", updatedAt: NOW - 18 * MIN },
      "s-blank": { blank: true, displayTitle: "空白", updatedAt: NOW },
      "s-drone": { origin: "subagent", displayTitle: "无人机", updatedAt: NOW },
      "s-archived": { displayTitle: "已归档", updatedAt: NOW },
      "s-lost": { displayTitle: "无巢野蜂", updatedAt: NOW }
    }
  };
}

function workspacesFixture() {
  return {
    items: [
      { workspaceId: "ws1", sessionIds: ["s-planet", "s-comet", "s-blank", "s-drone", "s-archived"] },
      { workspaceId: "ws2", sessionIds: [] }
    ],
    archivedSessionIds: ["s-archived"]
  };
}

const scene = mergeScene({ skeleton: skeletonFixture(), sessions: sessionsFixture(), workspaces: workspacesFixture(), now: NOW });

/* ── 星座/恒星/星云 ── */
assert.equal(scene.workspaces.length, 2);
const ws1 = scene.workspaces[0];
assert.equal(ws1.name, "dsh-v-cosmos");
assert.equal(ws1.stars.length, 2);
assert.equal(ws1.stars[0].lifecycle, "created");
assert.equal(ws1.stars[0].setBy, "cosmos-new", "setBy 透传");
assert.equal(ws1.stars[0].at, NOW - 2 * 24 * HOUR, "at 透传");
assert.equal(ws1.stars[0].age, "2 天前", "birthMs → 相对时间");
assert.equal(ws1.archives, 3);
assert.equal(ws1.satelliteCount, 0, "无卫星 → 星座 ◇=0");
assert.equal(dustCountOf(3), 165, "星云密度 = archives×55");
assert.equal(dustCountOf(8), 440);
assert.equal(dustCountOf(20), 520, "密度 cap 520");
assert.equal(dustCountOf(100), 520, "密度 cap 520");
assert.deepEqual(ws1.links, [[0, 1]]);

/* ── 行星分类 + 状态推导 + 联星 ── */
assert.equal(ws1.planets.length, 1);
const planet = ws1.planets[0];
assert.equal(planet.id, "s-planet");
assert.equal(planet.title, "apply: add-cosmos-entry");
assert.equal(planet.state, "busy", "running → busy（statuses 缺省回落 summary.running）");
assert.deepEqual(planet.stars, ["add-a", "add-b"], "一会话关联多提案 → 联星数据");
assert.equal(planet.todos, "—");
assert.deepEqual(planet.satellites, [], "无直属卫星 → 空数组");
assert.equal(planet.satelliteCount, 0);
assert.equal(planet.delegatedBusy, false, "无卫星 → 非委托忙碌");

/* ── 彗星：自由会话；blank/子代理/归档/未归属不渲染 ── */
assert.equal(ws1.comets.length, 1, "仅 s-comet 渲染为彗星");
assert.equal(ws1.comets[0].id, "s-comet");
assert.equal(ws1.comets[0].state, "idle", "彗星默认待机（s-comet summary 无 running）");
assert.equal(ws1.comets[0].pendingKind, null, "非 waiting → pendingKind null");
assert.ok(!ws1.comets.some((c) => c.id === "s-blank"), "blank 不渲染");
assert.ok(!ws1.comets.some((c) => c.id === "s-drone"), "子代理不渲染（本体；卫星另装配）");
assert.ok(!ws1.comets.some((c) => c.id === "s-archived"), "归档不渲染");
assert.ok(!ws1.comets.some((c) => c.id === "s-lost"), "未归属工作区不渲染");
assert.equal(scene.workspaces[1].comets.length, 0, "ws2 无会话");

/* ── act 活跃度：busy/waiting 计入，idle/done-unread 不计 ── */
assert.equal(ws1.stars.find((s) => s.id === "add-a").act, 1, "关联会话 busy → act=1");
assert.equal(ws1.stars.find((s) => s.id === "add-b").act, 1);
const waitingScene = mergeScene({
  skeleton: skeletonFixture(),
  sessions: { ids: ["s-planet", "s-comet"], byId: { "s-planet": { displayTitle: "p", running: true, updatedAt: NOW }, "s-comet": { updatedAt: NOW } } },
  workspaces: workspacesFixture(),
  statuses: new Map([["s-planet", { running: true, pendingInteraction: { kind: "approval", key: "k1", sessionId: "s-planet" }, completionUnread: false }]]),
  now: NOW
});
assert.equal(waitingScene.workspaces[0].planets[0].state, "waiting", "statuses.pendingInteraction → waiting（最高优先）");
assert.equal(waitingScene.workspaces[0].planets[0].pendingKind, "approval", "pendingInteraction.kind 透传信息卡");
assert.equal(waitingScene.workspaces[0].stars[0].act, 1, "waiting 也计入 act");

/* ── 彗星状态色数据链（add-comet-states-and-star-death 3.1）：与行星同通道、
      同降级；四态推导 + pendingKind 子类 + 签名 patch 判定 ── */
function cometOnlyScene(statuses, summaryOver = {}) {
  return mergeScene({
    skeleton: { workspaces: [{ id: "ws1", name: "ws-one", stars: [], pending: [], archives: 0, links: [], associations: [] }] },
    sessions: { ids: ["s-comet"], byId: { "s-comet": { displayTitle: "c", updatedAt: NOW, ...summaryOver } } },
    workspaces: { items: [{ workspaceId: "ws1", sessionIds: ["s-comet"] }], archivedSessionIds: [] },
    statuses,
    now: NOW
  });
}
const cWaiting = cometOnlyScene(new Map([["s-comet", { running: false, pendingInteraction: { kind: "plan-review" }, completionUnread: false }]]));
assert.equal(cWaiting.workspaces[0].comets[0].state, "waiting", "彗星待决策（pendingInteraction 最高优先）");
assert.equal(cWaiting.workspaces[0].comets[0].pendingKind, "plan-review", "彗星 pendingKind 子类透传");
const cBusy = cometOnlyScene(new Map([["s-comet", { running: true }]]));
assert.equal(cBusy.workspaces[0].comets[0].state, "busy", "彗星执行中");
assert.equal(cBusy.workspaces[0].comets[0].pendingKind, null, "非 waiting → pendingKind null");
const cDone = cometOnlyScene(new Map([["s-comet", { running: false, completionUnread: true }]]));
assert.equal(cDone.workspaces[0].comets[0].state, "done-unread", "彗星完成未读");
const cIdle = cometOnlyScene(new Map([["s-comet", {}]]));
assert.equal(cIdle.workspaces[0].comets[0].state, "idle", "彗星待机");
const cFallback = cometOnlyScene(null, { running: true }); // statuses 不可达 → summary.running 降级
assert.equal(cFallback.workspaces[0].comets[0].state, "busy", "statuses 不可达：summary.running → busy（降级 idle/busy 两态）");
assert.equal(cometOnlyScene(null).workspaces[0].comets[0].state, "idle", "statuses 不可达：→ idle（降级两态）");
/* 签名 patch 判定：state/pendingKind 变化 → patch（彗星变色走属性级补丁不重建）。 */
assert.equal(sceneDiffLevel(cDone, cIdle), "patch", "彗星 done-unread → idle → patch（查看渐熄属性沿）");
assert.equal(sceneDiffLevel(cWaiting, cBusy), "patch", "彗星 waiting → busy → patch（pendingKind 随签名变化）");
assert.equal(sceneDiffLevel(cBusy, cBusy), "none", "彗星属性不变 → none");

/* ── statuses 四态推导与降级（add-celestial-states 3.1） ── */
const st = (over) => ({ running: undefined, pendingInteraction: undefined, completionUnread: false, ...over });
const summaryBase = { running: false, updatedAt: NOW };
assert.equal(planetStateOf(summaryBase, st({ pendingInteraction: { kind: "question" }, running: true })), "waiting", "待决策 > 执行中");
assert.equal(planetStateOf(summaryBase, st({ running: true, completionUnread: true })), "busy", "执行中 > 完成未读");
assert.equal(planetStateOf(summaryBase, st({ completionUnread: true })), "done-unread", "completionUnread → 完成未读");
assert.equal(planetStateOf(summaryBase, st({})), "idle", "全否 → 待机中");
assert.equal(planetStateOf({ running: true }, undefined), "busy", "statuses 不可达：summary.running → busy（降级路径）");
assert.equal(planetStateOf({ running: false }, undefined), "idle", "statuses 不可达：→ idle（降级 idle/busy 两态）");
assert.equal(planetStateOf({ pendingInteraction: { x: 1 } }, undefined), "idle", "v1 死分支修复：summary.pendingInteraction 不再被读");
assert.equal(planetStateOf(null, undefined), "idle", "空 summary → idle");
assert.equal(planetStateOf(summaryBase, null), "idle", "statuses=null → 降级");
assert.equal(planetStateOf(summaryBase, "bogus"), "idle", "非法 status 条目 → 降级防御");

/* ── 星胚装配（add-celestial-states 3.2）：pending 锚点 → lifecycle:"proto" 恒星 ── */
const protoSkeleton = skeletonFixture();
protoSkeleton.workspaces[0].pending = [
  { name: "explore-ui", by: "cosmos-explore", at: NOW - 5 * MIN },
  { name: "add-a", by: "dup", at: NOW } // 同名真实目录 → 防御剔除（骨架层已剔，merge 再防御）
];
protoSkeleton.workspaces[1].pending = [{ name: "hive-proto", by: null, at: null }];
const protoScene = mergeScene({ skeleton: protoSkeleton, sessions: sessionsFixture(), workspaces: workspacesFixture(), now: NOW });
const protoWs = protoScene.workspaces[0];
assert.equal(protoWs.stars.length, 3, "2 真实恒星 + 1 星胚（同名锚点被剔除）");
const protoStar = protoWs.stars.find((s) => s.id === "explore-ui");
assert.equal(protoStar.lifecycle, "proto", "星胚 lifecycle=proto");
assert.equal(protoStar.setBy, "cosmos-explore", "锚点 by → setBy");
assert.equal(protoStar.at, NOW - 5 * MIN, "锚点 at 透传");
assert.deepEqual(protoStar.tasks, [0, 0], "星胚无任务进度");
assert.deepEqual(protoStar.off, starOffset("explore-ui", 26), "星胚 off = starOffset(slug) 确定性预占位");
assert.deepEqual(protoWs.links, [[0, 1]], "星胚追加在骨架恒星之后 → links 索引不受影响");
assert.equal(protoScene.workspaces[1].stars.length, 1, "仅锚点无目录的星座也渲染星胚");
assert.equal(protoScene.workspaces[1].stars[0].lifecycle, "proto");

/* ── 卫星装配（add-celestial-states 3.3）：直属挂父、深层折叠、孤儿剔除 ── */
function satSessionsFixture() {
  return {
    ids: ["s-planet", "s-comet", "sat-1", "sat-2", "sat-deep", "sat-orphan", "sat-orphan2", "sat-blankp", "sat-archp"],
    byId: {
      "s-planet": { displayTitle: "父行星", running: false, updatedAt: NOW },
      "s-comet": { displayTitle: "父彗星", updatedAt: NOW },
      "sat-1": { origin: "subagent", parentSessionId: "s-planet", displayTitle: "卫星1", running: true, updatedAt: NOW },
      "sat-2": { origin: "subagent", parentSessionId: "s-planet", displayTitle: "卫星2", updatedAt: NOW },
      "sat-deep": { origin: "subagent", parentSessionId: "sat-1", displayTitle: "深层卫星", updatedAt: NOW }, // 父亦 subagent → 折叠
      "sat-orphan": { origin: "subagent", parentSessionId: "s-ghost", displayTitle: "孤儿（父不在镜像）", updatedAt: NOW },
      "sat-orphan2": { origin: "subagent", parentSessionId: "s-lost", displayTitle: "孤儿（父未归属）", updatedAt: NOW },
      "sat-blankp": { origin: "subagent", parentSessionId: "s-blank", displayTitle: "孤儿（父 blank）", updatedAt: NOW },
      "sat-archp": { origin: "subagent", parentSessionId: "s-archived", displayTitle: "孤儿（父归档）", updatedAt: NOW }
    }
  };
}
const satMirror = satSessionsFixture();
const satRegistry = {
  items: [{ workspaceId: "ws1", sessionIds: ["s-planet", "s-comet", "s-blank", "s-archived", "s-lost"] }],
  archivedSessionIds: ["s-archived"]
};
// s-lost 未归属工作区 → accountOf 无 → 孤儿
const satScene = mergeScene({
  skeleton: skeletonFixture(),
  sessions: satMirror,
  workspaces: satRegistry,
  now: NOW
});
const satWs = satScene.workspaces[0];
assert.equal(satWs.planets.length, 1);
const satPlanet = satWs.planets[0];
assert.deepEqual(
  satPlanet.satellites.map((s) => s.id),
  ["sat-1", "sat-2"],
  "直属卫星挂父行星（深度 1 可见）"
);
assert.equal(satPlanet.satelliteCount, 3, "全量计数含深层折叠后代（sat-deep 折入顶层行星卡）");
assert.equal(satPlanet.satellites[0].state, "busy", "卫星四态色推导（sat-1 running → busy）");
assert.equal(satPlanet.satellites[1].state, "idle", "卫星四态色推导（sat-2 → idle）");
assert.equal(satPlanet.delegatedBusy, true, "父待机（非 running）+ 直属卫星 busy → 委托忙碌");
assert.equal(satWs.satelliteCount, 3, "星座 ◇ 计数 = 全量（含折叠）");
const satComet = satWs.comets[0];
assert.equal(satComet.id, "s-comet");
assert.equal(satComet.satelliteCount, 0, "彗星无卫星 → 计数 0");
assert.equal(satWs.stars.find((s) => s.id === "add-a").act, 1, "委托忙碌行星计入恒星 act（act 聚合口径扩展）");
assert.ok(satScene.workspaces[0].comets.every((c) => c.satellites.length === 0), "孤儿卫星不渲染（父不在镜像/未归属/blank/归档）");

/* ── 父自身 busy → 非委托忙碌（3.4 条件：父天体自身非 running） ── */
const busyParent = mergeScene({
  skeleton: skeletonFixture(),
  sessions: {
    ids: ["s-planet", "sat-1"],
    byId: {
      "s-planet": { displayTitle: "p", running: true, updatedAt: NOW },
      "sat-1": { origin: "subagent", parentSessionId: "s-planet", displayTitle: "sat", running: true, updatedAt: NOW }
    }
  },
  workspaces: satRegistry,
  now: NOW
});
assert.equal(busyParent.workspaces[0].planets[0].delegatedBusy, false, "父自身 running → 非委托忙碌");

/* ── 上限折叠：单父 8 颗直属 → 可见 6 + 计数 8 ── */
const capIds = [];
const capBy = { "s-comet": { displayTitle: "彗星父", updatedAt: NOW } };
for (let i = 0; i < 8; i++) {
  const id = "cap-sat-" + i;
  capIds.push(id);
  capBy[id] = { origin: "subagent", parentSessionId: "s-comet", displayTitle: "cap" + i, updatedAt: NOW };
}
const capScene = mergeScene({
  skeleton: skeletonFixture(),
  sessions: { ids: ["s-comet", ...capIds], byId: capBy },
  workspaces: { items: [{ workspaceId: "ws1", sessionIds: ["s-comet"] }], archivedSessionIds: [] },
  now: NOW
});
const capComet = capScene.workspaces[0].comets[0];
assert.equal(capComet.satellites.length, 6, "单父可见上限 6");
assert.equal(capComet.satelliteCount, 8, "超出并入折叠计数");
assert.equal(capScene.workspaces[0].satelliteCount, 8, "星座 ◇ 折叠不丢数");

/* ── 卫星走属性补丁路径（3.5 diff 签名）：数组变化 → patch 而非 rebuild ── */
const satBase = mergeScene({ skeleton: skeletonFixture(), sessions: satSessionsFixture(), workspaces: satRegistry, now: NOW });
const satMore = mergeScene({
  skeleton: skeletonFixture(),
  sessions: (() => {
    const m = satSessionsFixture();
    m.ids.push("sat-3");
    m.byId["sat-3"] = { origin: "subagent", parentSessionId: "s-planet", displayTitle: "卫星3", updatedAt: NOW };
    return m;
  })(),
  workspaces: satRegistry,
  now: NOW
});
assert.equal(sceneDiffLevel(satBase, satMore), "patch", "卫星集合变化 → patch（subagent 起停不触发重建）");
const satStateFlip = mergeScene({
  skeleton: skeletonFixture(),
  sessions: (() => {
    const m = satSessionsFixture();
    m.byId["sat-1"] = { ...m.byId["sat-1"], running: false };
    return m;
  })(),
  workspaces: satRegistry,
  now: NOW
});
assert.equal(sceneDiffLevel(satBase, satStateFlip), "patch", "卫星状态翻转 → patch");

/* ── 提案归档 → 行星锚点收缩 / 全部归档 → 行星回归彗星（合并层以骨架为准） ── */
const archivedSkeleton = skeletonFixture();
archivedSkeleton.workspaces[0].stars = [archivedSkeleton.workspaces[0].stars[0]]; // add-b 归档出活跃清单
archivedSkeleton.workspaces[0].links = [];
const partial = mergeScene({ skeleton: archivedSkeleton, sessions: sessionsFixture(), workspaces: workspacesFixture(), now: NOW });
const partialWs = partial.workspaces[0];
assert.equal(partialWs.stars.length, 1, "骨架为准：仅剩 add-a");
assert.equal(partialWs.planets.length, 1, "锚点仍有一个活提案 → 行星保留");
assert.deepEqual(partialWs.planets[0].stars, ["add-a"], "行星锚点收缩到剩余恒星");
assert.ok(partialWs.comets.every((c) => c.id !== "s-planet"), "未回归彗星");

const allGone = JSON.parse(JSON.stringify(archivedSkeleton));
allGone.workspaces[0].stars = []; // 两个提案全部归档
const regressed = mergeScene({ skeleton: allGone, sessions: sessionsFixture(), workspaces: workspacesFixture(), now: NOW });
const regressedWs = regressed.workspaces[0];
assert.ok(regressedWs.planets.every((p) => p.id !== "s-planet"), "失去全部恒星锚点 → 不再是行星");
assert.ok(regressedWs.comets.some((c) => c.id === "s-planet"), "行星回归彗星");
assert.equal(regressedWs.stars.length, 0, "骨架为准：恒星清空");

/* ── 会话消失 → 行星移除 ── */
const goneSessions = sessionsFixture();
delete goneSessions.byId["s-planet"];
const gone = mergeScene({ skeleton: skeletonFixture(), sessions: goneSessions, workspaces: workspacesFixture(), now: NOW });
assert.equal(gone.workspaces[0].planets.length, 0, "行星失去会话锚点 → 移除");

/* ── 确定性摆放（4.7）：同 id 恒定、顺序无关 ── */
const pos1 = constellationPositions([{ id: "ws1" }, { id: "ws2" }]);
const pos2 = constellationPositions([{ id: "ws1" }, { id: "ws2" }]);
assert.deepEqual(pos1.get("ws1"), pos2.get("ws1"), "同输入同摆放（确定性）");
const pos3 = constellationPositions([{ id: "ws2" }, { id: "ws1" }]);
assert.deepEqual(pos1.get("ws1"), pos3.get("ws1"), "顺序无关（哈希锚定）");
assert.deepEqual(starOffset("add-a", 26), starOffset("add-a", 26), "恒星 off 确定性");
assert.notDeepEqual(starOffset("add-a", 26), starOffset("add-b", 26), "不同提案不同 off");
assert.equal(hash32("x"), hash32("x"));

/* ── 3D 球壳分布（真机修订：星座充分利用空间，不再横向排布） ── */
{
  const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const pos = constellationPositions(ids.map((id) => ({ id })));
  assert.equal(pos.size, 8);
  const pts = [...pos.values()];
  const ys = pts.map((p) => p[1]);
  const yExtent = Math.max(...ys) - Math.min(...ys);
  assert.ok(yExtent > 200, `纵向铺开（Y 跨度 ${yExtent.toFixed(0)} > 200，非平面横排）`);
  const dist3 = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      assert.ok(dist3(pts[i], pts[j]) >= 200, `两两间距 ≥200（松弛目标 240，实际 ${dist3(pts[i], pts[j]).toFixed(0)}）`);
    }
  }
  const radius = Math.hypot(...pos.get("a"));
  assert.ok(radius > 150 && radius < 500, "球壳半径量级合理（径向抖动 0.55–1.0×）");
  const determinism = constellationPositions(ids.map((id) => ({ id })));
  assert.deepEqual(pos.get("c"), determinism.get("c"), "3D 摆放确定性");
}

/* ── 工作区名称搜索匹配（add-cosmos-search-filter 1.1 / design D4） ──
   匹配域仅工作区名称；空/纯空白查询全显；多 token AND；大小写不敏感子串。 */
{
  const searchScene = {
    workspaces: [
      /* ws1：名称不含任何 ASCII，恒星 id 含 "galaxy"（恒星名不进匹配域的反证）。 */
      { id: "ws1", name: "银河项目", stars: [{ id: "add-galaxy" }] },
      { id: "ws2", name: "Api-Gateway", stars: [] },
      /* ws3：名称含 "cosmos"，恒星 id 是中文提案名（同样不进匹配域）。 */
      { id: "ws3", name: "dsh-v-cosmos", stars: [{ id: "银河提案" }] },
      { id: "ws4", name: "银河 项目二期", stars: [] }
    ]
  };
  const idsOf = (set) => [...set].sort();

  /* 空查询 = 全部命中（过滤关闭语义） */
  assert.deepEqual(idsOf(matchWorkspaces(searchScene, "")), ["ws1", "ws2", "ws3", "ws4"], "空查询 → 全量命中");
  assert.deepEqual(idsOf(matchWorkspaces(searchScene, "   \t\n ")), ["ws1", "ws2", "ws3", "ws4"], "仅空白查询 → 全量命中");
  assert.deepEqual(idsOf(matchWorkspaces(searchScene, null)), ["ws1", "ws2", "ws3", "ws4"], "非字符串查询 → 全量命中");
  assert.deepEqual(idsOf(matchWorkspaces(null, "x")), [], "空 scene → 空集合");

  /* 连续子串命中 / 非连续不命中（「银项」跨字 → 不命中） */
  assert.deepEqual(idsOf(matchWorkspaces(searchScene, "银")), ["ws1", "ws4"], "单字子串命中（中文）");
  assert.deepEqual(idsOf(matchWorkspaces(searchScene, "银河项目")), ["ws1"], "整串子串命中");
  assert.deepEqual(idsOf(matchWorkspaces(searchScene, "银项")), [], "非连续字符不命中（子串语义，非子序列）");
  assert.deepEqual(idsOf(matchWorkspaces(searchScene, " 银河 ")), ["ws1", "ws4"], "查询 trim 后匹配");

  /* 多 token AND：每个 token 都必须是子串 */
  assert.deepEqual(idsOf(matchWorkspaces(searchScene, "银河 项目")), ["ws1", "ws4"], "多 token AND（两个 token 均命中）");
  assert.deepEqual(idsOf(matchWorkspaces(searchScene, "银河 二期")), ["ws4"], "多 token AND（仅 ws4 同时含两 token）");
  assert.deepEqual(idsOf(matchWorkspaces(searchScene, "银河 不存在")), [], "任一 token 未命中 → 不命中");
  assert.deepEqual(idsOf(matchWorkspaces(searchScene, "  银河   项目  ")), ["ws1", "ws4"], "多空白切分 + trim");

  /* 大小写不敏感（ASCII） */
  assert.deepEqual(idsOf(matchWorkspaces(searchScene, "api")), ["ws2"], "小写查询命中大写名称");
  assert.deepEqual(idsOf(matchWorkspaces(searchScene, "API-GATEWAY")), ["ws2"], "大写查询命中");
  assert.deepEqual(idsOf(matchWorkspaces(searchScene, "CoSmOs")), ["ws3"], "混合大小写");

  /* 恒星（提案名）MUST NOT 参与匹配域 */
  assert.deepEqual(idsOf(matchWorkspaces(searchScene, "galaxy")), [], "恒星 id 含 galaxy 但名称不含 → 无命中");
  assert.deepEqual(idsOf(matchWorkspaces(searchScene, "提案")), [], "中文提案名不进匹配域");

  /* 顺序无关（集合语义） */
  const reversed = { workspaces: [...searchScene.workspaces].reverse() };
  assert.deepEqual(idsOf(matchWorkspaces(reversed, "银河")), idsOf(matchWorkspaces(searchScene, "银河")), "传入顺序无关");
  assert.deepEqual(idsOf(matchWorkspaces(reversed, "")), idsOf(matchWorkspaces(searchScene, "")), "全量命中亦顺序无关");
}

/* ── 匹配子集布局（1.2 / design D3）：复用 constellationPositions，√N 向心聚拢 ── */
{
  const allIds = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const full = constellationPositions(allIds.map((id) => ({ id })));
  const subsetIds = new Set(["c", "f"]);
  const subset = filteredPositions(subsetIds);

  assert.ok(subset instanceof Map, "filteredPositions → Map");
  assert.deepEqual([...subset.keys()].sort(), ["c", "f"], "子集布局只含命中 id");
  assert.deepEqual(filteredPositions(new Set()), new Map(), "空子集 → 空 Map（过滤关闭语义）");
  assert.equal(filteredPositions(null).size, 0, "非集合输入防御 → 空 Map");
  assert.deepEqual(filteredPositions(["c", "f"]), subset, "数组与 Set 输入等价");

  /* 子集布局 = 直接以子集调 constellationPositions（薄封装，无第二套实现） */
  assert.deepEqual(subset.get("c"), constellationPositions([{ id: "c" }, { id: "f" }]).get("c"), "复用既有摆放函数");

  /* 确定性：同一子集任意时刻两次一致（同子集同画面） */
  assert.deepEqual(filteredPositions(subsetIds).get("f"), subset.get("f"), "子集布局确定性");

  /* √N 聚拢几何：子集壳半径 < 全集壳半径 */
  const radiusOf = (map) => Math.max(...[...map.values()].map((p) => Math.hypot(p[0], p[1], p[2])));
  const avgRadiusOf = (map) => {
    const list = [...map.values()];
    return list.reduce((n, p) => n + Math.hypot(p[0], p[1], p[2]), 0) / list.length;
  };
  assert.ok(radiusOf(subset) < radiusOf(full), `√N 收缩：2 子集壳半径 ${radiusOf(subset).toFixed(0)} < 全集 ${radiusOf(full).toFixed(0)}`);
  assert.ok(avgRadiusOf(subset) < avgRadiusOf(full), "√N 收缩：子集平均半径更小（向心聚拢）");

  /* 「以原点为球心收敛」：子集质心贴近原点（camera-fit 包围球推理基线） */
  const centroid = [...subset.values()].reduce((acc, p) => [acc[0] + p[0] / 2, acc[1] + p[1] / 2, acc[2] + p[2] / 2], [0, 0, 0]);
  assert.ok(Math.hypot(...centroid) < avgRadiusOf(subset), "子集质心靠近原点（布局球心）");

  /* 单命中：确定位，落在 +x 方向 120–218 世界单位（explorer 取证口径；camera-fit 的必要性基线） */
  const single = filteredPositions(new Set(["c"]));
  assert.equal(single.size, 1);
  const p = single.get("c");
  assert.equal(Math.abs(p[1]) + Math.abs(p[2]), 0, "单命中落在 +x 轴（y=z=0，屏幕中心之外）");
  assert.ok(p[0] >= 110 && p[0] <= 230, `单命中径向 ${p[0].toFixed(0)} ∈ [110,230]`);
  assert.deepEqual(filteredPositions(new Set(["c"])).get("c"), p, "单命定位确定性");
  assert.ok(p[0] !== filteredPositions(new Set(["d"])).get("d")[0], "不同 id 单命中径向不同（哈希抖动）");
}

/* ── 相对时间 ── */
assert.equal(relativeTime(NOW - 30_000, NOW), "刚刚");
assert.equal(relativeTime(NOW - 5 * MIN, NOW), "5 分钟前");
assert.equal(relativeTime(NOW - 3 * HOUR, NOW), "3 小时前");
assert.equal(relativeTime(null, NOW), "—");

/* ── 属性级补丁 diff（4.8 / add-celestial-states 3.5） ── */
const sceneA = mergeScene({ skeleton: skeletonFixture(), sessions: sessionsFixture(), workspaces: workspacesFixture(), now: NOW });
const sceneNone = mergeScene({ skeleton: skeletonFixture(), sessions: sessionsFixture(), workspaces: workspacesFixture(), now: NOW });
assert.equal(sceneDiffLevel(sceneA, sceneNone), "none", "完全一致 → none");
const starPatched = JSON.parse(JSON.stringify(sceneA));
starPatched.workspaces[0].stars[0].tasks = [4, 5];
starPatched.workspaces[0].stars[0].act = 2;
assert.equal(sceneDiffLevel(sceneA, starPatched), "patch", "恒星属性差异 → patch");
const starLifecyclePatched = JSON.parse(JSON.stringify(sceneA));
starLifecyclePatched.workspaces[0].stars[0].lifecycle = "reviewed";
starLifecyclePatched.workspaces[0].stars[0].setBy = "cosmos-review";
assert.equal(sceneDiffLevel(sceneA, starLifecyclePatched), "patch", "恒星 lifecycle 迁移 → patch（点燃/落印属性沿）");
const structChanged = JSON.parse(JSON.stringify(sceneA));
structChanged.workspaces[0].stars.push({ id: "add-c", name: "add-c", lifecycle: "created", setBy: null, at: null, tasks: [0, 0], age: "刚刚", act: 0, off: [1, 2, 3] });
assert.equal(sceneDiffLevel(sceneA, structChanged), "rebuild", "恒星集合变化 → rebuild");
const posChanged = JSON.parse(JSON.stringify(sceneA));
posChanged.workspaces[0].pos = [1, 1, 1];
assert.equal(sceneDiffLevel(sceneA, posChanged), "rebuild", "位置变化 → rebuild");
const planetPatched = JSON.parse(JSON.stringify(sceneA));
planetPatched.workspaces[0].planets[0].state = "done-unread";
assert.equal(sceneDiffLevel(sceneA, planetPatched), "patch", "行星状态（完成未读）→ patch");
const planetDelegated = JSON.parse(JSON.stringify(sceneA));
planetDelegated.workspaces[0].planets[0].delegatedBusy = true;
assert.equal(sceneDiffLevel(sceneA, planetDelegated), "patch", "委托忙碌标记 → patch");
const wsSatCountChanged = JSON.parse(JSON.stringify(sceneA));
wsSatCountChanged.workspaces[0].satelliteCount = 4;
assert.equal(sceneDiffLevel(sceneA, wsSatCountChanged), "patch", "星座 ◇ 计数变化 → patch");
assert.equal(sceneDiffLevel(null, sceneA), "rebuild", "无前帧 → rebuild");
const wsSetChanged = JSON.parse(JSON.stringify(sceneA));
wsSetChanged.workspaces.pop();
assert.equal(sceneDiffLevel(sceneA, wsSetChanged), "rebuild", "星座集合变化 → rebuild");

/* ── 添加工作区：路径比对纯函数（add-cosmos-add-workspace D2/D7/4.1） ── */
{
  /* 归一化：斜杠/尾分隔符/重复分隔符/UNC/Windows 大小写 */
  assert.equal(normalizeWorkspacePath("C:\\work\\demo"), "C:/work/demo", "反斜杠归一");
  assert.equal(normalizeWorkspacePath("C:/work/demo/"), "C:/work/demo", "去尾分隔符");
  assert.equal(normalizeWorkspacePath("  C:/work//demo//  "), "C:/work/demo", "trim + 折叠重复分隔符");
  assert.equal(normalizeWorkspacePath("C:/work/demo", true), "c:/work/demo", "Windows 语义折叠大小写");
  assert.equal(normalizeWorkspacePath("C:/Work/Demo", false), "C:/Work/Demo", "POSIX 精确（不折叠）");
  assert.equal(normalizeWorkspacePath("//server/share/"), "//server/share", "UNC 前缀保留");
  assert.equal(normalizeWorkspacePath("/"), "/", "根路径保持");
  assert.equal(normalizeWorkspacePath(""), "", "空路径 → 空键");
  assert.equal(normalizeWorkspacePath(null), "", "非法路径 → 空键");
  assert.equal(normalizeWorkspacePath("C:\\work\\demo", true), normalizeWorkspacePath("c:/WORK/Demo/", true), "Windows 等价键一致");

  /* 已注册目录预判（D2）：命中返回镜像行；未命中/空路径 → null */
  const items = [
    { workspaceId: "ws1", path: "C:/work/demo", title: "demo" },
    { workspaceId: "ws2", path: "C:/work/other", title: "other" }
  ];
  assert.equal(findRegisteredWorkspace(items, "C:/work/demo/", true)?.workspaceId, "ws1", "尾分隔符不影响命中");
  assert.equal(findRegisteredWorkspace(items, "c:\\WORK\\Demo", true)?.workspaceId, "ws1", "Windows 大小写/斜杠折叠命中");
  assert.equal(findRegisteredWorkspace(items, "c:\\WORK\\Demo", false), null, "POSIX 精确比对不命中");
  assert.equal(findRegisteredWorkspace(items, "C:/work/new", true), null, "未注册路径 → null（走正常 create）");
  assert.equal(findRegisteredWorkspace(items, "", true), null, "空路径 → null");
  assert.equal(findRegisteredWorkspace(null, "C:/work/demo", true), null, "镜像缺席 → null");

  /* 平台判定（大小写折叠开关）：Win 提示命中；POSIX/缺席不命中 */
  assert.equal(isWindowsPlatform({ platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0)" }), true, "Win32 → true");
  assert.equal(isWindowsPlatform({ platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh)" }), false, "macOS → false");
  assert.equal(isWindowsPlatform({ platform: "Linux x86_64", userAgent: "Mozilla/5.0 (X11; Linux)" }), false, "Linux → false");
  assert.equal(isWindowsPlatform(null), false, "无 navigator → false（Node 环境安全默认）");
}

console.log("merge-smoke: all assertions passed");
