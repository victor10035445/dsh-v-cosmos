/**
 * merge.mjs 冒烟（add-cosmos-entry 4.2/4.7/4.8 / add-celestial-states 3.1–3.5 /
 * add-comet-states-and-star-death 3.1 / three-use-cosmos-template-sky-layout 3.1–3.5）：
 * 行星/彗星分类、blank/子代理/未归属过滤、statuses 四态推导与降级（行星与彗星同通道）、
 * 彗星四态与 pendingKind、act 活跃度（含委托忙碌）、提案归档行星回归彗星、星胚装配、
 * 卫星装配/深度折叠/孤儿/上限/委托忙碌、确定性摆放（天球投影 + Fibonacci 降级）、
 * 天球方位保真/黄道带松弛/子集向心/降级三态、属性级补丁 diff（含卫星/生命周期/彗星状态签名）、
 * 恒星图样落位（two-use-cosmos-template-star-layout：模板分配确定性、规范序落位、追加
 *    稳定、溢出环形外扩、星胚点燃一致、降级路径、图样线交付与尺度定标数值面）。
 * 运行：node test/merge-smoke.mjs
 */
import assert from "node:assert/strict";
import { mergeScene, sceneDiffLevel, planetStateOf, relativeTime, constellationPositions, skyPositionOf, starOffset, dustCountOf, hash32, matchWorkspaces, embryoGroupsOf, filteredPositions, normalizeWorkspacePath, findRegisteredWorkspace, isWindowsPlatform, starPlanetIdsOf, templateForWorkspace, templateForPosition, templateForFigure, setTemplateOverrides, templateZhOf, starPatternLayout, PATTERN_SCALE, PATTERN_RING_RATIO, PATTERN_SLOT_GAP } from "../src/merge.mjs";
import { TEMPLATE_COUNT, allTemplates, templateOf } from "../src/cosmos/templates.mjs";

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

/* ── 显式绑定的会话恰绕其绑定集（fix-cosmos-association-scope spec「显式绑定的审阅
      会话单星轨道」）：骨架只剩 explicit 单边 → 单星轨道，act 只由真实关联驱动 ── */
{
  const boundSkeleton = skeletonFixture();
  boundSkeleton.workspaces[0].associations = [
    { proposal: "add-a", sessionId: "s-planet", origin: "explicit" }
  ];
  boundSkeleton.workspaces[0].links = [];
  const boundScene = mergeScene({ skeleton: boundSkeleton, sessions: sessionsFixture(), workspaces: workspacesFixture(), now: NOW });
  const boundWs = boundScene.workspaces[0];
  assert.equal(boundWs.planets.length, 1, "绑定不改变会话分类（仍为行星）");
  assert.deepEqual(boundWs.planets[0].stars, ["add-a"], "显式绑定 → 恰绕绑定提案（无联星）");
  assert.equal(boundWs.stars.find((s) => s.id === "add-a").act, 1, "绑定恒星被忙碌会话点亮（act≥1）");
  assert.equal(boundWs.stars.find((s) => s.id === "add-b").act, 0, "未绑定提案 act=0（沉睡暗星，preState 门控按钮可见）");
  assert.deepEqual(boundWs.links, [], "单星关联 → 无联星连线");
}

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
  { name: "explore-ui", by: "cosmos-explore", at: NOW - 5 * MIN, sessionId: "sess-explore" },
  { name: "add-a", by: "dup", at: NOW }, // 同名真实目录 → 防御剔除（骨架层已剔，merge 再防御）
  { name: "explore-old", by: "cosmos-explore", at: NOW - 30 * MIN } // 旧锚点：无 sessionId（零迁移）
];
protoSkeleton.workspaces[1].pending = [{ name: "hive-proto", by: null, at: null }];
const protoScene = mergeScene({ skeleton: protoSkeleton, sessions: sessionsFixture(), workspaces: workspacesFixture(), now: NOW });
const protoWs = protoScene.workspaces[0];
assert.equal(protoWs.stars.length, 4, "2 真实恒星 + 2 星胚（同名锚点被剔除）");
const protoStar = protoWs.stars.find((s) => s.id === "explore-ui");
assert.equal(protoStar.lifecycle, "proto", "星胚 lifecycle=proto");
assert.equal(protoStar.setBy, "cosmos-explore", "锚点 by → setBy");
assert.equal(protoStar.at, NOW - 5 * MIN, "锚点 at 透传");
assert.equal(protoStar.sessionId, "sess-explore", "锚点 sessionId 原样透传（数据链第三跳）");
assert.deepEqual(protoStar.tasks, [0, 0], "星胚无任务进度");
/* 图样落位（two 2.x）：星胚与正式恒星同一条序 → off 恒等图样槽位派生（星胚坐槽，
   决议 3 自然占位；同名点燃后 (at,id) 序不变 → 原位变实）。 */
const protoLayout = starPatternLayout(templateForWorkspace("ws1"), protoWs.stars);
assert.ok(protoLayout, "ws1 命中模板（fixture 星座走图样落位）");
assert.deepEqual(protoStar.off, protoLayout.offs.get("explore-ui"), "星胚 off = 图样槽位（与正式恒星同一条序、自然占位）");
/* 图样全量交付（add-cosmos-template-figure-display 1.2/D1/D2 / 4.2）：`ws.pattern =
   { slots, lines }` —— slots = 模板全部内核主星位（下标 = 模板 stars 下标）、lines = 模板
   lines **原样**（空槽端点不过滤）；门控 = stars 非空（星胚并入 stars 即满足），
   与 links 数据面相互独立。 */
const protoTpl = templateForWorkspace("ws1");
assert.ok(protoTpl && Array.isArray(protoTpl.lines), "ws1 命中模板（图样数据面前提）");
assert.ok(protoWs.pattern && Array.isArray(protoWs.pattern.slots) && Array.isArray(protoWs.pattern.lines), "stars 非空 → 交付 ws.pattern");
assert.equal(protoWs.pattern.slots.length, protoTpl.stars.length, "pattern.slots = 模板全部主星位（全量、非仅被占槽位）");
assert.deepEqual(protoWs.pattern.lines, protoTpl.lines, "pattern.lines = 模板 lines 原样（空槽端点不过滤）");
assert.ok(protoWs.pattern.lines.every((pair) => pair[0] !== pair[1] && pair.every((i) => Number.isInteger(i) && i >= 0 && i < protoWs.pattern.slots.length)), "lines 下标入 slots（合法索引对）");
assert.ok(!("patternLines" in protoWs), "patternLines 字段退役（不再交付场景 stars 下标对）");
assert.deepEqual(protoWs.links, [[0, 1]], "骨架 links 数据面原样独立（星胚追加在骨架恒星之后 → 索引不受影响）");
assert.equal(protoScene.workspaces[1].stars.length, 1, "仅锚点无目录的星座也渲染星胚");
assert.equal(protoScene.workspaces[1].stars[0].lifecycle, "proto");
assert.equal(protoScene.workspaces[1].stars[0].sessionId, null, "缺 sessionId → null（读取方容错）");
assert.equal(protoWs.stars.find((s) => s.id === "explore-old").sessionId, null, "旧锚点（无该字段）→ null");

/* ── 星胚 act 推导（keep-embryo-active-while-exploring 3.1）：锚点探索会话活跃度
      直连判定——与行星 act 同口径（busy ∨ waiting ∨ 委托忙碌）、同快照、同降级路径；
      值域 {0,1}，不参与行星计数。 ── */
function protoActScene({
  statuses = null,
  summary = { displayTitle: "explore", updatedAt: NOW },
  archived = [],
  assignee = "ws1",
  anchor = { name: "embryo-a", by: "cosmos-explore", at: NOW - 5 * MIN, sessionId: "sess-explore" },
  extraSessions = null,
  extraStars = [],
  associations = []
} = {}) {
  const sessions = {
    ids: ["sess-explore", ...(extraSessions?.ids ?? [])],
    byId: { "sess-explore": summary, ...(extraSessions?.byId ?? {}) }
  };
  return mergeScene({
    skeleton: {
      workspaces: [{
        id: "ws1",
        name: "ws-one",
        path: "C:/ws",
        stars: [{ id: "real", name: "real", lifecycle: "created", tasks: [0, 1] }, ...extraStars],
        pending: anchor ? [anchor] : [],
        archives: 0,
        links: [],
        associations
      }]
    },
    sessions,
    workspaces: { items: [{ workspaceId: assignee, sessionIds: sessions.ids }], archivedSessionIds: archived },
    statuses,
    now: NOW
  });
}
const protoActOfScene = (scene, id = "embryo-a") => scene.workspaces[0].stars.find((star) => star.id === id)?.act;

{
  /* 活跃三态 → act=1（与行星 act 聚合分支同构） */
  const busy = protoActScene({ statuses: new Map([["sess-explore", { running: true }]]) });
  assert.equal(protoActOfScene(busy), 1, "探索会话执行中（busy）→ 星胚 act=1");
  const waiting = protoActScene({
    statuses: new Map([["sess-explore", { running: false, pendingInteraction: { kind: "approval" } }]])
  });
  assert.equal(protoActOfScene(waiting), 1, "探索会话待决策（waiting）→ 星胚 act=1（与行星口径一致）");
  const delegated = protoActScene({
    statuses: new Map([["sess-explore", { running: false }]]),
    extraSessions: {
      ids: ["sess-child"],
      byId: { "sess-child": { origin: "subagent", parentSessionId: "sess-explore", running: true, updatedAt: NOW } }
    }
  });
  assert.equal(protoActOfScene(delegated), 1, "父待机而直属子代理执行中（委托忙碌）→ 星胚 act=1");

  /* 沉睡两态 → act=0 */
  const idle = protoActScene({ statuses: new Map([["sess-explore", { running: false }]]) });
  assert.equal(protoActOfScene(idle), 0, "探索会话待机（idle）→ 星胚 act=0（门控恢复点亮）");
  const doneUnread = protoActScene({ statuses: new Map([["sess-explore", { running: false, completionUnread: true }]]) });
  assert.equal(protoActOfScene(doneUnread), 0, "探索会话完成未读（done-unread）→ 星胚 act=0");

  /* 活跃信息缺失 → act=0（呈现门控 MUST NOT 因缺失隐藏按钮） */
  assert.equal(
    protoActOfScene(protoActScene({ anchor: { name: "embryo-a", by: "x", at: NOW } })),
    0,
    "无 sessionId 旧锚点 → act=0"
  );
  assert.equal(
    protoActOfScene(protoActScene({ anchor: { name: "embryo-a", by: "x", at: NOW, sessionId: "sess-ghost" } })),
    0,
    "探索会话在镜像中消失 → act=0"
  );
  assert.equal(
    protoActOfScene(protoActScene({ statuses: new Map([["sess-explore", { running: true }]]), archived: ["sess-explore"] })),
    0,
    "探索会话已归档 → act=0（不在 renderable）"
  );
  assert.equal(
    protoActOfScene(protoActScene({
      summary: { blank: true, updatedAt: NOW },
      statuses: new Map([["sess-explore", { running: true }]])
    })),
    0,
    "探索会话为 blank → act=0"
  );

  /* statuses 不可达 → 回落 summary.running（降级 idle/busy 两态） */
  assert.equal(
    protoActOfScene(protoActScene({ summary: { displayTitle: "e", running: true, updatedAt: NOW } })),
    1,
    "statuses 不可达：summary.running → act=1（同一降级路径）"
  );
  assert.equal(protoActOfScene(protoActScene()), 0, "statuses 不可达且未运行 → act=0");

  /* 锚点会话跨工作区可达（renderable 全局表） */
  assert.equal(
    protoActOfScene(protoActScene({
      assignee: "ws2",
      statuses: new Map([["sess-explore", { running: true }]])
    })),
    1,
    "锚点 sessionId 指向其他工作区的会话 → 照常推导（跨工作区可达）"
  );

  /* 畸形关联（associations 引用 proto slug）：proto act 仍按锚点推导，MUST NOT 被行星计数膨胀 */
  const malformed = protoActScene({
    statuses: new Map([["sess-explore", { running: false }]]),
    extraSessions: {
      ids: ["sess-busy"],
      byId: { "sess-busy": { displayTitle: "busy", running: true, updatedAt: NOW } }
    },
    associations: [
      { proposal: "embryo-a", sessionId: "sess-busy", origin: "heuristic" },
      { proposal: "real", sessionId: "sess-busy", origin: "heuristic" }
    ]
  });
  assert.equal(protoActOfScene(malformed), 0, "畸形关联引用 proto slug → 星胚 act 仍按锚点推导（跳过行星计数）");
  assert.equal(protoActOfScene(malformed, "real"), 1, "正式星 act 聚合逐字不变（确实被忙碌会话点亮）");

  /* 差分：act 翻转 → 属性级 patch（星胚呼吸动画不重建） */
  assert.equal(sceneDiffLevel(busy, idle), "patch", "星胚 act 1 → 0 → patch（starPropertySignature 已含 act）");
}

/* ── 星胚归并分组（add-cosmos-embryo-cards 2.2/2.3）：同会话归并 / 旧锚点自组 /
      组间首 slug 字典序 / slugs 字典序 / at 取最早 / act 取组内最大值 ── */
{
  const stars = [
    { id: "add-zeta", lifecycle: "proto", sessionId: "sess-A", at: 300 },
    { id: "add-alpha", lifecycle: "proto", sessionId: "sess-A", at: 100 },
    { id: "add-solo", lifecycle: "proto", at: 200 },
    { id: "add-beta", lifecycle: "proto", sessionId: "sess-A", at: 250 },
    { id: "add-null-at", lifecycle: "proto", sessionId: "sess-B" },
    { id: "real-star", lifecycle: "created", at: 1 } // 非星胚 → 不参与
  ];
  const grouped = embryoGroupsOf(stars);
  assert.deepEqual(grouped, [
    { key: "sess-A", sessionId: "sess-A", slugs: ["add-alpha", "add-beta", "add-zeta"], at: 100, act: 0 },
    { key: "sess-B", sessionId: "sess-B", slugs: ["add-null-at"], at: null, act: 0 },
    { key: "add-solo", sessionId: null, slugs: ["add-solo"], at: 200, act: 0 }
  ], "同会话归并（slugs 字典序 + at 取最早）/ 缺失 sessionId 自组 / 组间按首 slug 字典序 / at 全缺 → null / 无 act → 沉睡 0");
  assert.deepEqual(embryoGroupsOf([...stars].reverse()), grouped, "归并分组与输入顺序解耦（确定性）");
  assert.deepEqual(embryoGroupsOf(null), [], "非数组 → 空组");
  assert.deepEqual(embryoGroupsOf([{ id: "", lifecycle: "proto" }]), [], "空 id → 跳过");
  /* 重复 slug 去重（防御：骨架层不会重复） */
  assert.deepEqual(
    embryoGroupsOf([{ id: "dup", lifecycle: "proto", sessionId: "s" }, { id: "dup", lifecycle: "proto", sessionId: "s" }]),
    [{ key: "s", sessionId: "s", slugs: ["dup"], at: null, act: 0 }],
    "同组同 slug 去重"
  );
  /* 组 act 聚合（keep-embryo-active-while-exploring 2.1/3.2）：组内 proto 星 act 最大值——
     单一 sessionId 归并 → 理论恒单值；max 仅防御未来分组口径漂移。 */
  const actGroups = embryoGroupsOf([
    { id: "g-a", lifecycle: "proto", sessionId: "sess-G", act: 1 },
    { id: "g-b", lifecycle: "proto", sessionId: "sess-G", act: 0 },
    { id: "g-solo", lifecycle: "proto", act: 3 },
    { id: "g-idle", lifecycle: "proto", sessionId: "sess-H", act: 0 }
  ]);
  assert.equal(actGroups.find((group) => group.key === "sess-G").act, 1, "同组任一锚点活跃 → 组 act=1（取最大值）");
  assert.equal(actGroups.find((group) => group.key === "sess-H").act, 0, "组内全沉睡 → 组 act=0");
  assert.equal(actGroups.find((group) => group.key === "g-solo").act, 3, "无 sessionId 的自组按组内最大值透传（值域防御）");
}

/* 星胚 sessionId 纳入恒星属性签名（design D10）：重分组（锚点集合不变）→ patch，
   MUST NOT 被差分守卫误判 none；增删锚点 → rebuild（两条路径全覆盖）。 */
{
  const regroupSkeleton = JSON.parse(JSON.stringify(protoSkeleton));
  regroupSkeleton.workspaces[0].pending[0].sessionId = "sess-other";
  const regroupScene = mergeScene({ skeleton: regroupSkeleton, sessions: sessionsFixture(), workspaces: workspacesFixture(), now: NOW });
  assert.equal(sceneDiffLevel(protoScene, regroupScene), "patch", "sessionId 重分组（锚点集合不变）→ 属性级 patch");
  const dropSkeleton = JSON.parse(JSON.stringify(protoSkeleton));
  dropSkeleton.workspaces[0].pending = dropSkeleton.workspaces[0].pending.slice(0, 1);
  const dropScene = mergeScene({ skeleton: dropSkeleton, sessions: sessionsFixture(), workspaces: workspacesFixture(), now: NOW });
  assert.equal(sceneDiffLevel(protoScene, dropScene), "rebuild", "锚点增删 → rebuild");
  /* 无 sessionId 两侧同为 null/undefined → 签名同值（不产生幽灵 patch） */
  const noSessionSkeleton = JSON.parse(JSON.stringify(protoSkeleton));
  noSessionSkeleton.workspaces[0].pending = [{ name: "only-old", by: null, at: null }];
  noSessionSkeleton.workspaces[1].pending = [];
  const noSessionA = mergeScene({ skeleton: noSessionSkeleton, sessions: sessionsFixture(), workspaces: workspacesFixture(), now: NOW });
  const noSessionB = mergeScene({ skeleton: JSON.parse(JSON.stringify(noSessionSkeleton)), sessions: sessionsFixture(), workspaces: workspacesFixture(), now: NOW });
  assert.equal(sceneDiffLevel(noSessionA, noSessionB), "none", "旧锚点无 sessionId → 无变化判 none（零误判）");
}

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

  /* 子集布局 = 直接以子集调 constellationPositions（薄封装，无第二套实现；center 子集向心） */
  assert.deepEqual(subset.get("c"), constellationPositions([{ id: "c" }, { id: "f" }], { center: true }).get("c"), "复用既有摆放函数（子集向心）");

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

/* ── 银河天球布局（three-use-cosmos-template-sky-layout 3.1–3.5）：投影确定性、
   方位保真（θ 旋转锚点 / 北天 y 符号 / 邻接统计）、黄道带松弛承接、子集天球重摆、
   降级三态（缺模板逐座回退 / 整层回退 / 输入域防御） ── */
{
  /* —— 3.2 θ 旋转方向锚点（spec MUST：投影点随 θ 增大自 +x 向 +z，排除镜像实现）—— */
  const R = 100;
  const at = (ra, dec) => skyPositionOf({ ra, dec }, R);
  {
    const [x, y, z] = at(0, 0);
    assert.ok(Math.abs(x - R) < 1e-9 && Math.abs(y) < 1e-9 && Math.abs(z) < 1e-9, "ra=0/dec=0 → +x 轴锚点");
  }
  {
    const [x, y, z] = at(6, 0);
    assert.ok(Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9 && Math.abs(z - R) < 1e-9, "ra=6（θ=π/2）→ +z（右手系钉死，非镜像 z=−sinθ）");
  }
  {
    const [x, y, z] = at(12, 0);
    assert.ok(Math.abs(x + R) < 1e-9 && Math.abs(z) < 1e-9, "ra=12 → −x");
  }
  {
    const [x, y, z] = at(18, 0);
    assert.ok(Math.abs(x) < 1e-9 && Math.abs(z + R) < 1e-9, "ra=18 → −z");
  }
  assert.ok(Math.abs(at(24, 0)[0] - R) < 1e-9, "ra=24 折回 ra=0（域归一 [0,24)）");

  /* —— 3.2 方位保真：北天 y>0 / 南天 y<0 / 近天极纬度分量 —— */
  assert.equal(allTemplates().length, TEMPLATE_COUNT, "模板快照完整（88 条）");
  const templateById = new Map(allTemplates().map((t) => [t.id, t]));
  const umaP = skyPositionOf(templateById.get("uma"), 300);
  const umiP = skyPositionOf(templateById.get("umi"), 300);
  assert.ok(umaP[1] > 0 && umiP[1] > 0, "北天星座（UMa/UMi）投影 y > 0");
  assert.ok(umiP[1] / 300 > 0.9, "UMi dec=78 近天极（y ≈ 0.978R）");
  assert.ok(skyPositionOf(templateById.get("oct"), 300)[1] < 0, "南天星座（Oct）投影 y < 0");

  /* —— 3.2 邻接对统计断言：Ori–Tau、UMa–UMi 显著小于随机对
     （全 88 模板投影成对距离中位数 = 随机对基线；spec 只保方位语义不钉精确角距）—— */
  const pairDist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  {
    const projected = [...templateById.values()].map((t) => skyPositionOf(t, 300));
    const pairs = [];
    for (let i = 0; i < projected.length; i++) {
      for (let j = i + 1; j < projected.length; j++) pairs.push(pairDist(projected[i], projected[j]));
    }
    pairs.sort((a, b) => a - b);
    const median = pairs[Math.floor(pairs.length / 2)];
    const oriTau = pairDist(skyPositionOf(templateById.get("ori"), 300), skyPositionOf(templateById.get("tau"), 300));
    const umaUmi = pairDist(umaP, umiP);
    assert.ok(oriTau < median * 0.6, `Ori–Tau 邻接 ${oriTau.toFixed(0)} < 0.6×随机对中位 ${median.toFixed(0)}`);
    assert.ok(umaUmi < median * 0.6, `UMa–UMi 拱极邻接 ${umaUmi.toFixed(0)} < 0.6×随机对中位 ${median.toFixed(0)}`);
  }

  /* —— 2.1 输入域防御：缺模板 / 非有限 → null；有限越界 → 确定性归一 —— */
  assert.equal(skyPositionOf(null, 100), null, "缺模板 → null（调用方逐座回退）");
  assert.equal(skyPositionOf({ ra: Number.NaN, dec: 10 }, 100), null, "ra 非有限 → null");
  assert.equal(skyPositionOf({ ra: 5, dec: "x" }, 100), null, "dec 非有限 → null");
  assert.equal(skyPositionOf({ ra: 5, dec: 45 }, Number.NaN), null, "投影半径非有限 → null");
  {
    const wrapped = skyPositionOf({ ra: 30, dec: 95 }, 100); // ra 30h → 折回 6h；dec 夹取 +90
    assert.ok(Math.abs(wrapped[0]) < 1e-9 && wrapped[1] > 99 && Math.abs(wrapped[2]) < 1e-9, "有限越界：ra 折回 [0,24)、dec 夹取 +90（y≈R）");
    assert.ok(skyPositionOf({ ra: 3, dec: -95 }, 100)[1] < -99, "dec 夹取下界 −90 → y≈−R");
  }

  /* —— 2.2 星座层接入：布局 = 逐 id 模板投影（hash32 % 88 口径钉死）、
     投影半径 = 既有球壳公式（骨架位不做质心归一，天球绝对方位保留）—— */
  const skyIds = Array.from({ length: 24 }, (_, i) => "sky-ws-" + i);
  const skyLayout = constellationPositions(skyIds.map((id) => ({ id })));
  const skyRaw = constellationPositions(skyIds.map((id) => ({ id })), { relaxRounds: 0 }); // 松弛前裸投影
  assert.equal(skyLayout.size, 24);
  const skyRadius = 150 * (0.9 + Math.sqrt(24) * 0.55);
  for (const id of skyIds) {
    const expected = skyPositionOf(allTemplates()[hash32(id) % TEMPLATE_COUNT], skyRadius);
    const raw = skyRaw.get(id);
    assert.ok(pairDist(raw, expected) < 1e-6, "星座层位置 = hash32(id)%88 模板中心的天球投影（与恒星层同口径）");
    assert.ok(Math.abs(Math.hypot(...raw) - skyRadius) < 1e-6, "投影半径 = 既有球壳半径公式（无径向抖动）");
    /* 松弛为局部微调（design D3）：单座位移远小于 minDist，大局方位观感不破坏 */
    assert.ok(pairDist(skyLayout.get(id), raw) < 240, "松弛推挤为局部微调（位移 < minDist）");
    /* 松弛后成对间距 ≥ minDist（任意真实命中集合同式成立） */
    for (const other of skyIds) {
      if (other <= id) continue;
      assert.ok(pairDist(skyLayout.get(id), skyLayout.get(other)) >= 239.999, "松弛后成对间距 ≥ minDist");
    }
  }

  /* —— 3.1 投影确定性：同集合重放同布局、乱序传入不变 —— */
  const replayed = constellationPositions(skyIds.map((id) => ({ id })));
  const shuffled = constellationPositions([...skyIds].reverse().map((id) => ({ id })));
  for (const id of skyIds) {
    assert.deepEqual(skyLayout.get(id), replayed.get(id), "sky 布局确定性重放");
    assert.deepEqual(skyLayout.get(id), shuffled.get(id), "sky 布局与传入顺序无关");
  }

  /* —— 3.3 黄道带拥挤松弛：12 个黄道宫命中 id（hash32 % 88 确定性搜索）投影后
     推至 ≥ minDist、收敛确定、沿带形态保持 —— */
  const zodiacSet = new Set(["ari", "tau", "gem", "cnc", "leo", "vir", "lib", "sco", "sgr", "cap", "aqr", "psc"]);
  const bandIds = [];
  const bandSeen = new Set();
  for (let i = 0; bandIds.length < 12 && i < 4000; i++) {
    const id = "band-" + i;
    const t = allTemplates()[hash32(id) % TEMPLATE_COUNT];
    if (zodiacSet.has(t.id) && !bandSeen.has(t.id)) { bandSeen.add(t.id); bandIds.push(id); }
  }
  assert.equal(bandIds.length, 12, "确定性搜索到覆盖 12 黄道宫的工作区 id（hash32 % 88 口径）");
  const band = constellationPositions(bandIds.map((id) => ({ id })));
  const bandReplay = constellationPositions(bandIds.map((id) => ({ id })));
  for (let i = 0; i < bandIds.length; i++) {
    for (let j = i + 1; j < bandIds.length; j++) {
      assert.ok(pairDist(band.get(bandIds[i]), band.get(bandIds[j])) >= 239.999, "黄道带拥挤松弛后成对间距 ≥ minDist");
    }
    assert.deepEqual(band.get(bandIds[i]), bandReplay.get(bandIds[i]), "松弛收敛确定（重放一致）");
  }
  {
    const bandShape = (m) => {
      const maxY = Math.max(...bandIds.map((id) => Math.abs(m.get(id)[1])));
      const maxRing = Math.max(...bandIds.map((id) => Math.hypot(m.get(id)[0], m.get(id)[2])));
      return { maxY, maxRing };
    };
    const bandRaw = constellationPositions(bandIds.map((id) => ({ id })), { relaxRounds: 0 });
    const rawShape = bandShape(bandRaw);
    const relaxedShape = bandShape(band);
    /* 投影本身沿赤道带（垂直跨度明显小于纬圈跨度）；松弛承接拥挤不破坏带形（spec） */
    assert.ok(rawShape.maxY < rawShape.maxRing * 0.8, `黄道带投影沿赤道带（裸投影 max|y| ${rawShape.maxY.toFixed(0)} < 0.8×纬圈半径 ${rawShape.maxRing.toFixed(0)}）`);
    assert.ok(relaxedShape.maxY < rawShape.maxY * 1.2, `松弛不破坏沿带形态（松弛后 max|y| ${relaxedShape.maxY.toFixed(0)} ≤ 裸投影 ${rawShape.maxY.toFixed(0)}×1.2）`);
  }

  /* —— spec「同模板重复命中不重合」：多工作区命中同一模板 → 投影初始位重合 →
     松弛分离（成对间距 ≥ minDist；hash32 % 88 确定性搜索重复命中 id 对）—— */
  {
    const dupTarget = allTemplates()[hash32("dup-a") % TEMPLATE_COUNT].id;
    let dupB = null;
    for (let i = 0; i < 4000 && !dupB; i++) {
      const id = "dup-" + i;
      if (allTemplates()[hash32(id) % TEMPLATE_COUNT].id === dupTarget) dupB = id;
    }
    assert.ok(dupB, "确定性搜索到同模板重复命中 id 对");
    const rawPair = constellationPositions([{ id: "dup-a" }, { id: dupB }], { relaxRounds: 0 });
    assert.ok(pairDist(rawPair.get("dup-a"), rawPair.get(dupB)) < 1e-6, "同模板重复命中 → 投影初始位重合");
    const pair = constellationPositions([{ id: "dup-a" }, { id: dupB }]);
    const separated = pairDist(pair.get("dup-a"), pair.get(dupB));
    assert.ok(separated >= 239.999, `松弛分离重复命中（间距 ${separated.toFixed(0)} ≥ minDist）`);
  }

  /* —— 3.4 子集天球重摆：命中子集向心（质心回原点）、投影长度随命中规模收缩、
     清空还原骨架位（布局与子集重摆互不污染）—— */
  const subsetFive = skyIds.slice(0, 5);
  const subsetSky = filteredPositions(new Set(subsetFive));
  {
    const centroid = [...subsetSky.values()].reduce(
      (a, p) => [a[0] + p[0] / subsetFive.length, a[1] + p[1] / subsetFive.length, a[2] + p[2] / subsetFive.length],
      [0, 0, 0]
    );
    assert.ok(Math.hypot(...centroid) < 1e-6, "子集投影云质心平移回原点（向心聚拢）");
  }
  const subsetRadius = 150 * (0.9 + Math.sqrt(5) * 0.55);
  const avgRadiusOf = (map) => {
    const list = [...map.values()];
    return list.reduce((n, p) => n + Math.hypot(p[0], p[1], p[2]), 0) / list.length;
  };
  assert.ok(avgRadiusOf(subsetSky) < subsetRadius, `√N 收缩：|S|=5 子集平均投影半径 ${avgRadiusOf(subsetSky).toFixed(0)} < 球壳 ${subsetRadius.toFixed(0)}`);
  assert.ok(avgRadiusOf(subsetSky) < skyRadius, "子集平均投影半径 < 全集骨架球壳（命中规模收缩）");
  for (const id of subsetFive) {
    const q = subsetSky.get(id);
    assert.ok(pairDist(q, constellationPositions(subsetFive.map((x) => ({ id: x })), { center: true }).get(id)) < 1e-9, "子集布局 = 同一投影管线（center 子集向心，无第二套实现）");
  }
  /* 清空回归：全量骨架布局与子集重摆互不污染（引擎补间回归归 engine-smoke 口径） */
  for (const id of subsetFive) {
    assert.deepEqual(skyLayout.get(id), constellationPositions(skyIds.map((x) => ({ id: x }))).get(id), "清空查询回归骨架天球位");
  }

  /* —— 3.5 降级：缺模板逐座回退 Fibonacci（其余保持天球投影）、整层回退、不抛错 —— */
  {
    const fibGolden = Math.PI * (3 - Math.sqrt(5));
    const fibOf = (id, index, n, radius) => {
      const seed = hash32(id);
      const y = n === 1 ? 0 : 1 - ((index + 0.5) * 2) / n;
      const ringR = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = fibGolden * index;
      const radial = radius * (0.55 + ((seed >>> 8) / 16777216) * 0.45);
      return [Math.cos(theta) * ringR * radial, y * radial, Math.sin(theta) * ringR * radial];
    };
    const dIds = ["dg-a", "dg-b", "dg-c", "dg-d"];
    const dRadius = 150 * (0.9 + 2 * 0.55);
    const inject = (id) => (id === "dg-b" ? null : allTemplates()[hash32(id) % TEMPLATE_COUNT]);
    /* 命中缺席（防御注入）：该座单独回退 Fibonacci，其余星座保持天球投影（混合摆位；
       relaxRounds: 0 剥离松弛推挤，聚焦降级分支本身的位形） */
    const mixedRaw = constellationPositions(dIds.map((id) => ({ id })), { relaxRounds: 0, templateFor: inject });
    assert.deepEqual(mixedRaw.get("dg-b"), fibOf("dg-b", 1, 4, dRadius), "命中缺席星座单独回退 Fibonacci（规范序公式）");
    for (const id of ["dg-a", "dg-c", "dg-d"]) {
      const expected = skyPositionOf(allTemplates()[hash32(id) % TEMPLATE_COUNT], dRadius);
      assert.ok(pairDist(mixedRaw.get(id), expected) < 1e-6, "混合摆位：命中星座保持天球投影");
    }
    /* 松弛后的混合布局仍成立（成对间距 ≥ minDist，含回退星座在内） */
    const mixed = constellationPositions(dIds.map((id) => ({ id })), { templateFor: inject });
    for (let i = 0; i < dIds.length; i++) {
      for (let j = i + 1; j < dIds.length; j++) {
        assert.ok(pairDist(mixed.get(dIds[i]), mixed.get(dIds[j])) >= 239.999, "混合摆位松弛后成对间距 ≥ minDist");
      }
    }
    /* 整层回退：全部命中缺席 → 每座 Fibonacci（relaxRounds: 0，与既有整层口径逐位一致） */
    const legacyRaw = constellationPositions(dIds.map((id) => ({ id })), { relaxRounds: 0, templateFor: () => null });
    for (let i = 0; i < dIds.length; i++) {
      assert.deepEqual(legacyRaw.get(dIds[i]), fibOf(dIds[i], i, 4, dRadius), "整层回退 = 既有 Fibonacci 球壳口径");
    }
    /* 平凡情形：星座数 0/1 走 Fibonacci（单命位 +x 轴 camera-fit 基线不变）；垃圾输入不抛错 */
    assert.equal(constellationPositions([]).size, 0, "星座数 0 → 空 Map");
    const solo = constellationPositions([{ id: "solo" }]);
    assert.equal(solo.get("solo")[1], 0, "星座数 1 → Fibonacci（y=0）");
    assert.ok(constellationPositions(null) instanceof Map, "非数组输入 → 空 Map（不抛错）");
    assert.equal(constellationPositions([{}]).size, 1, "缺 id 条目防御（不抛错）");
  }
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

/* 相对时间文本（age/when）必须计入 patch：否则「仅时间桶变化」被判 none，
   客户端为刷新文本只能全量重建（画面闪烁）。patchScene 已就地更新这些字段。 */
const starAgePatched = JSON.parse(JSON.stringify(sceneA));
starAgePatched.workspaces[0].stars[0].age = "1 分钟前";
assert.equal(sceneDiffLevel(sceneA, starAgePatched), "patch", "恒星相对年龄变化 → patch");
const planetWhenPatched = JSON.parse(JSON.stringify(sceneA));
planetWhenPatched.workspaces[0].planets[0].when = "1 分钟前";
assert.equal(sceneDiffLevel(sceneA, planetWhenPatched), "patch", "行星相对活跃时间变化 → patch");
const cometWhenPatched = JSON.parse(JSON.stringify(sceneA));
cometWhenPatched.workspaces[0].comets[0].when = "1 分钟前";
assert.equal(sceneDiffLevel(sceneA, cometWhenPatched), "patch", "彗星相对活跃时间变化 → patch");
const wsRenamed = JSON.parse(JSON.stringify(sceneA));
wsRenamed.workspaces[0].name = "renamed-ws";
assert.equal(sceneDiffLevel(sceneA, wsRenamed), "patch", "工作区重命名 → patch（chip/面板文本更新，不重建）");
const wsPathMoved = JSON.parse(JSON.stringify(sceneA));
wsPathMoved.workspaces[0].path = "C:/moved";
assert.equal(sceneDiffLevel(sceneA, wsPathMoved), "patch", "工作区路径变化 → patch（面板 @提案路径更新）");

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

/* ── 关联投影纯函数（cosmos-relation-focus「关联投影纯函数」2.2）：恒星→行星反向映射 ── */
{
  /* 单星多行星：同一恒星被三个行星关联 → 全量展开（按行星在册顺序） */
  const single = starPlanetIdsOf({
    stars: [{ id: "s1" }],
    planets: [
      { id: "p1", stars: ["s1"] },
      { id: "p2", stars: ["s1"] },
      { id: "p3", stars: ["s1"] }
    ]
  });
  assert.deepEqual(single.get("s1"), ["p1", "p2", "p3"], "单星多行星：该恒星 id 对应三个行星 id");
  assert.equal(single.size, 1, "单星多行星：映射条目数 = 1");

  /* 联星行星双向可见：某行星关联两颗恒星 → 两颗恒星在映射中均含该行星 */
  const binary = starPlanetIdsOf({
    stars: [{ id: "sa" }, { id: "sb" }],
    planets: [
      { id: "pbin", stars: ["sa", "sb"] },
      { id: "pother", stars: ["sb"] }
    ]
  });
  assert.deepEqual(binary.get("sa"), ["pbin"], "联星：恒星 sa 映射含该行星");
  assert.deepEqual(binary.get("sb"), ["pbin", "pother"], "联星：恒星 sb 映射含该行星（多行星）");

  /* 空星座：无行星（或星座缺席）→ 空 Map，不报错 */
  assert.equal(starPlanetIdsOf({ stars: [{ id: "lonely" }], planets: [] }).size, 0, "空星座 → 空 Map");
  assert.equal(starPlanetIdsOf({}).size, 0, "缺字段 → 空 Map");
  assert.equal(starPlanetIdsOf(null).size, 0, "空入参 → 空 Map（零异常）");

  /* 引擎场景形态兼容：planet.stars 为恒星对象（带 id）时同函数可用 */
  const engineShape = starPlanetIdsOf({
    stars: [{ id: "sx" }, { id: "sy" }],
    planets: [{ id: "px", stars: [{ id: "sx" }, { id: "sy" }] }, { id: "py", stars: [{ id: "sx" }] }]
  });
  assert.deepEqual(engineShape.get("sx"), ["px", "py"], "引擎形态（恒星对象条目）同样反向展开");
  assert.deepEqual(engineShape.get("sy"), ["px"], "引擎形态：第二颗恒星只关联首行星");

  /* 重复条目去重：同一行星重复列出同一恒星 → 该组合只出现一次 */
  const dedup = starPlanetIdsOf({ stars: [{ id: "s1" }], planets: [{ id: "p1", stars: ["s1", "s1", 7, null] }] });
  assert.deepEqual(dedup.get("s1"), ["p1"], "重复/非法条目去重且不抛错");

  /* merge 产物实景：s-planet 关联 add-a/add-b 两颗恒星（联星）→ 双向命中 */
  const merged = starPlanetIdsOf(scene.workspaces[0]);
  assert.deepEqual(merged.get("add-a"), ["s-planet"], "merge 产物：add-a → 联星行星");
  assert.deepEqual(merged.get("add-b"), ["s-planet"], "merge 产物：add-b → 联星行星");
}

/* ── 恒星图样落位（two-use-cosmos-template-star-layout 2.x / 4.1–4.5 merge 层冒烟） ── */
{
  const t = templateOf("ori");
  const bboxCenterOf = (tpl) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of tpl.stars) {
      if (s.x < minX) minX = s.x;
      if (s.y < minY) minY = s.y;
      if (s.x > maxX) maxX = s.x;
      if (s.y > maxY) maxY = s.y;
    }
    return [(minX + maxX) / 2, (minY + maxY) / 2];
  };
  const [cx, cy] = bboxCenterOf(t);
  const slotOf = (tpl, k) => [(tpl.stars[k].x - cx) * PATTERN_SCALE, 0, (tpl.stars[k].y - cy) * PATTERN_SCALE];
  const mk = (ids) => ids.map((id, i) => ({ id, at: NOW + i * MIN }));
  const nn = (pts) => {
    let m = Infinity;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        m = Math.min(m, Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1], pts[i][2] - pts[j][2]));
      }
    }
    return m;
  };

  /* 2.1 模板分配确定性：同 id 恒同模板；导出面可用 */
  assert.equal(templateForWorkspace("ws1"), templateForWorkspace("ws1"), "同 id 同模板（确定性）");
  assert.ok(t, "templateOf 直查命中（ori）");

  /* 4.1 确定性：同输入重放同布局；骨架乱序传入结果不变 */
  const ids5 = ["p-a", "p-b", "p-c", "p-d", "p-e"];
  const l1 = starPatternLayout(t, mk(ids5));
  const l2 = starPatternLayout(t, mk(ids5));
  assert.deepEqual([...l1.offs.entries()], [...l2.offs.entries()], "同输入重放同布局（确定性）");
  const shuffled = starPatternLayout(t, [...mk(ids5)].reverse());
  for (const id of ids5) assert.deepEqual(l1.offs.get(id), shuffled.offs.get(id), `乱序传入结果不变（${id}）`);

  /* 2.3 内核槽位：第 k 颗 = 图样第 k 主星位（包围盒中心对齐星座中心、y=0 水平面） */
  for (let k = 0; k < 5; k++) assert.deepEqual(l1.offs.get(ids5[k]), slotOf(t, k), `第 ${k} 颗占图样第 ${k} 主星位`);
  assert.ok(nn(ids5.map((id) => l1.offs.get(id))) > 0, "内核槽位互异（无重叠）");

  /* 4.2 追加稳定性：前 k 颗 off 逐字节不变，新星落第 k+1 槽（新增不动旧星） */
  const l6 = starPatternLayout(t, mk([...ids5, "p-f"]));
  for (const id of ids5) assert.deepEqual(l1.offs.get(id), l6.offs.get(id), `追加不动旧星（${id}）`);
  assert.deepEqual(l6.offs.get("p-f"), slotOf(t, 5), "新星落第 6 槽");

  /* 4.3 溢出：N+1 / 2N+3 外环槽位、相位确定、间距 ≥ 基准 */
  const N = t.stars.length;
  const mkOver = (n) => Array.from({ length: n }, (_, i) => ({ id: "o-" + i, at: NOW + i * MIN }));
  const over1 = starPatternLayout(t, mkOver(N + 1));
  const firstRing = over1.offs.get("o-" + N);
  const r1 = Math.hypot(firstRing[0], firstRing[2]);
  assert.ok(Math.abs(r1 - PATTERN_SCALE * (1 + PATTERN_RING_RATIO)) < 1e-9, "溢出首颗落第一外环（半径 = 内核尺度 × (1+环距比)）");
  const bigCount = 2 * N + 3;
  const big = starPatternLayout(t, mkOver(bigCount));
  /* 间距下限口径：GAP 约束**外扩区**（环内相邻、环↔环、环↔内核）——内核是忠实星座
     图形（腰带三连星本就近），其内距由下方 2.5 全模板定标断言（≥ 旧口径典型 ×10）承接。 */
  const kernelCount = N;
  const bigKernel = mkOver(kernelCount).map((s) => big.offs.get(s.id));
  const bigRing = mkOver(bigCount).slice(kernelCount).map((s) => big.offs.get(s.id));
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  let minRing = Infinity;
  for (let i = 0; i < bigRing.length; i++) {
    for (let j = i + 1; j < bigRing.length; j++) minRing = Math.min(minRing, dist(bigRing[i], bigRing[j]));
    for (const k of bigKernel) minRing = Math.min(minRing, dist(bigRing[i], k));
  }
  assert.ok(minRing >= PATTERN_SLOT_GAP - 1e-6, `外扩区间距 ≥ 基准（${minRing.toFixed(2)} ≥ ${PATTERN_SLOT_GAP}）`);
  const bigAgain = starPatternLayout(t, mkOver(bigCount));
  assert.deepEqual([...big.offs.entries()], [...bigAgain.offs.entries()], "外扩确定性重放（同集合恒同布局）");
  for (let k = 0; k < N; k++) assert.deepEqual(big.offs.get("o-" + k), slotOf(t, k), "溢出场景内核槽位不受影响");

  /* 4.4 星胚点燃：同名同 (at,id) 序 → off 逐位一致（点燃原位）；at 微调 → 近距滑移不跳出图样 */
  const layReal = starPatternLayout(t, [{ id: "e-1", at: NOW }, { id: "e-2", at: NOW + MIN }, { id: "e-3", at: NOW + 2 * MIN }]);
  const layProto = starPatternLayout(t, [{ id: "e-1", at: NOW }, { id: "e-2", at: NOW + MIN }, { id: "e-3", at: NOW + 2 * MIN, lifecycle: "proto" }]);
  assert.deepEqual(layReal.offs.get("e-3"), layProto.offs.get("e-3"), "星胚与正式恒星同槽位（点燃原位变实）");
  const ignitedShift = starPatternLayout(t, [{ id: "e-1", at: NOW - 3 * MIN }, { id: "e-2", at: NOW + MIN }, { id: "e-3", at: NOW + 2 * MIN }]);
  const slide = Math.hypot(
    ignitedShift.offs.get("e-3")[0] - layProto.offs.get("e-3")[0],
    ignitedShift.offs.get("e-3")[2] - layProto.offs.get("e-3")[2]
  );
  assert.ok(slide <= PATTERN_SCALE * 0.6, `序位微调 → 近距滑移（${slide.toFixed(1)} ≤ 尺度×0.6，不跳出图样）`);

  /* 4.5 降级：模板缺席 / 数据损坏 → null（调用方星座粒度回退 starOffset），不抛错 */
  assert.equal(starPatternLayout(null, mk(ids5)), null, "模板缺席 → null");
  assert.equal(starPatternLayout(undefined, mk(ids5)), null, "非法模板 → null");
  assert.equal(starPatternLayout({ ...t, stars: [] }, mk(ids5)), null, "图样空 → null");
  assert.equal(starPatternLayout(t, []), null, "恒星空 → null");
  assert.equal(starPatternLayout({ stars: [{ x: Number.NaN, y: 0.5 }, { x: 0.2, y: 0.3 }] }, mk(ids5)), null, "坐标非有限（图样损坏）→ null");
  const fallback = starOffset("p-a", 26);
  assert.equal(fallback.length, 3, "降级路径 starOffset 保留可用（旧函数不删）");

  /* 2.6 图样全量交付（add-cosmos-template-figure-display 1.1 / 4.1）：模板 `lines` 原样
     交付（下标入 `slots`，端点可为空槽位——恒星存在性过滤退役）；`slots` = 全部内核
     主星位世界坐标，与恒星集合无关、确定性可重放。 */
  const full = starPatternLayout(t, mkOver(N));
  assert.equal(full.lines.length, t.lines.length, "满员：图样线全量交付");
  assert.equal(l1.slots.length, t.stars.length, "slots = 模板全部主星位（与恒星数无关）");
  for (let k = 0; k < t.stars.length; k++) {
    assert.deepEqual(l1.slots[k], slotOf(t, k), `slots[${k}] = 第 ${k} 主星位世界坐标（同源同式）`);
    assert.equal(l1.slots[k][1], 0, `slots[${k}] 落水平面（y = 0）`);
  }
  const l1Again = starPatternLayout(t, mk(ids5));
  assert.deepEqual(l1Again.slots, l1.slots, "slots 同输入重放逐位相同（确定性）");
  assert.deepEqual(l1Again.lines, l1.lines, "lines 同输入重放逐位相同（确定性）");
  assert.equal(l1.lines.length, t.lines.length, "5 星部分占位：图样线仍全量交付（不再按端点占位过滤）");
  assert.ok(l1.lines.every((pair) => pair[0] !== pair[1] && pair.every((v) => Number.isInteger(v) && v >= 0 && v < t.stars.length)), "lines = 合法槽位下标对（下标入 slots）");
  const partial = starPatternLayout(t, mk(ids5.slice(0, 2)));
  assert.equal(partial.lines.length, t.lines.length, "前 2 颗占位：图样线全量交付（空槽端点对保留）");
  assert.deepEqual(partial.lines, l1.lines, "图样线仅依赖模板（与恒星集合无关）");
  assert.deepEqual(partial.slots, l1.slots, "slots 同样与恒星集合无关（模板派生静态数据）");

  /* 2.5 定标核对（数值面；钻取目测归真机走查 5.2）：全 88 模板满员最小邻距 ≥ 旧口径
     实测典型（≈0.45 世界单位，id 尾字哈希退化最坏基线）×8——「太紧密」的直接解法。 */
  let worstMin = Infinity;
  for (const tpl of allTemplates()) {
    const ids = tpl.stars.map((s, i) => tpl.id + "-" + i);
    const lay = starPatternLayout(tpl, ids.map((id, i) => ({ id, at: i })));
    assert.ok(lay, `模板 ${tpl.id} 落位可用`);
    worstMin = Math.min(worstMin, nn(ids.map((id) => lay.offs.get(id))));
  }
  assert.ok(worstMin >= 8 * 0.45, `全 88 模板最小邻距 ≥ 旧口径典型 ×8（实际 ${worstMin.toFixed(2)} ≥ ${(8 * 0.45).toFixed(2)}）`);

  /* mergeScene 集成面：恒星 off 恒等布局派生 + 图样全量字段随场景交付（links 数据面独立） */
  const twoSkeleton = {
    workspaces: [{
      id: "ws-ori",
      name: "ori-ws",
      path: "C:/ori",
      stars: [
        { id: "prop-x", name: "prop-x", lifecycle: "created", setBy: null, at: NOW, tasks: [1, 2] },
        { id: "prop-y", name: "prop-y", lifecycle: "created", setBy: null, at: NOW + MIN, tasks: [0, 1] },
        { id: "prop-z", name: "prop-z", lifecycle: "created", setBy: null, at: NOW + 2 * MIN, tasks: [0, 0] }
      ],
      pending: [],
      archives: 0,
      links: [[0, 2]],
      associations: []
    }]
  };
  const twoScene = mergeScene({ skeleton: twoSkeleton, sessions: { ids: [], byId: {} }, workspaces: { items: [] }, now: NOW });
  const twoWs = twoScene.workspaces[0];
  const twoLay = starPatternLayout(templateForWorkspace("ws-ori"), twoWs.stars);
  assert.ok(twoLay, "ws-ori 命中模板");
  for (const star of twoWs.stars) {
    assert.deepEqual(star.off, twoLay.offs.get(star.id), `场景恒星 off = 布局派生（${star.id}）`);
  }
  /* 图样全量交付（1.2/4.2）：命中模板 = hash(ws id) % 88（D1，与工作区命名无关）——
     slots = 模板全部主星位世界坐标（下标 = 模板 stars 下标，逐位等于 starPatternLayout
     同源同式派生）；lines = 模板 lines 原样（空槽端点不过滤）；与 links 数据面独立。 */
  const hitTpl = templateForWorkspace("ws-ori");
  assert.ok(hitTpl, "命中模板存在（与落位布局同源）");
  assert.ok(twoWs.pattern, "stars 非空 → ws.pattern 交付");
  assert.deepEqual(twoWs.pattern.slots, twoLay.slots, "pattern.slots = 布局派生的全部内核槽位（同源）");
  assert.deepEqual(twoWs.pattern.lines, hitTpl.lines, "pattern.lines = 模板 lines 原样（空槽端点不过滤）");
  assert.ok(!("patternLines" in twoWs), "patternLines 字段退役（场景 JSON 不再含该字段）");
  assert.deepEqual(twoWs.links, [[0, 2]], "骨架 links 数据面原样透传（引擎不再绘制、面板投影继续消费）");

  /* 门控：星座无恒星（仅会话）→ 不装配 pattern 字段（零图样交付，呈现与引入前一致）。 */
  const emptySkeleton = {
    workspaces: [{
      id: "ws-ori", name: "ori-empty", path: "C:/ori", stars: [], pending: [],
      archives: 0, links: [], associations: []
    }]
  };
  const emptyScene = mergeScene({ skeleton: emptySkeleton, sessions: { ids: [], byId: {} }, workspaces: { items: [] }, now: NOW });
  const emptyWs = emptyScene.workspaces[0];
  assert.ok(!("pattern" in emptyWs), "stars 为空 → 不装配 pattern 字段（零交付）");
  assert.ok(!("patternLines" in emptyWs), "stars 为空 → patternLines 亦零交付（字段已退役）");
  assert.deepEqual(emptyWs.stars, [], "无恒星场景（仅会话）");

  /* 图样恒定不触发 rebuild（1.3/4.2）：同恒星集合重放 → 图样逐位恒等 → none；
     门控翻转（首星装配 / 末星移除）与恒星集合变化同帧 → 走既有 rebuild 判级。 */
  const twoAgain = mergeScene({ skeleton: twoSkeleton, sessions: { ids: [], byId: {} }, workspaces: { items: [] }, now: NOW });
  assert.deepEqual(twoAgain.workspaces[0].pattern, twoScene.workspaces[0].pattern, "同星座重复装配：pattern 逐位恒等（确定性派生）");
  assert.equal(sceneDiffLevel(twoScene, twoAgain), "none", "图样恒定 → 判 none（MUST NOT 触发 rebuild）");
  assert.equal(sceneDiffLevel(emptyScene, twoScene), "rebuild", "门控翻转（末星移除/首星装配）随恒星集合走既有 rebuild 判级");
  /* 防御不变量：同恒星集合而图样存在性不一致 = 不可能态 → rebuild（正常路径零触发）。 */
  const forged = mergeScene({ skeleton: twoSkeleton, sessions: { ids: [], byId: {} }, workspaces: { items: [] }, now: NOW });
  delete forged.workspaces[0].pattern;
  assert.equal(sceneDiffLevel(twoScene, forged), "rebuild", "同恒星集合而图样存在性不一致 → rebuild（防御不变量）");

  /* 冻结快照形态（1.2）：场景 pattern 为逐项拷贝——外部改写不污染后续装配的图样数据。 */
  twoWs.pattern.slots[0][0] = 999;
  const replayPattern = mergeScene({ skeleton: twoSkeleton, sessions: { ids: [], byId: {} }, workspaces: { items: [] }, now: NOW }).workspaces[0].pattern;
  assert.notEqual(replayPattern.slots[0][0], 999, "pattern 快照引用隔离（逐项拷贝，跨装配不共享）");
}

/* ── 星座模板中文名交付（add-cosmos-template-name-toggle 2.1/4.2 / D2）：
   `ws.tplZh` 由模板分配契约单一出处派生（= 命中模板 `zh`），同 id 恒同名、与其他工作区
   增删无关；命中缺席/缺 zh/非字符串归一 null；`sceneDiffLevel` 纳入防御不变量
   （同 id 值不一致 = 不可能态 → rebuild），且不进 patch 属性签名。 ── */
{
  const base = skeletonFixture();
  const sceneA = mergeScene({ skeleton: base, sessions: sessionsFixture(), workspaces: workspacesFixture(), now: NOW });
  for (const ws of sceneA.workspaces) {
    const hit = templateForWorkspace(ws.id);
    assert.ok(hit && typeof hit.zh === "string" && hit.zh, ws.id + "：命中模板带中文名（数据面前提）");
    assert.equal(ws.tplZh, hit.zh, ws.id + "：tplZh = 命中模板 zh（单一出处派生）");
  }

  /* 确定性：同 id 多次装配恒同名；其他工作区注册/注销不影响既有交付（D1 同口径）。 */
  const sceneA2 = mergeScene({ skeleton: skeletonFixture(), sessions: sessionsFixture(), workspaces: workspacesFixture(), now: NOW });
  assert.deepEqual(
    sceneA.workspaces.map((ws) => ws.tplZh),
    sceneA2.workspaces.map((ws) => ws.tplZh),
    "同骨架重复装配：tplZh 逐座恒等（确定性）"
  );
  const extra = skeletonFixture();
  extra.workspaces.push({ id: "ws-extra", name: "ws-extra", path: "C:/extra", stars: [], pending: [], archives: 0, links: [], associations: [] });
  const sceneExtra = mergeScene({ skeleton: extra, sessions: sessionsFixture(), workspaces: workspacesFixture(), now: NOW });
  for (const ws of sceneA.workspaces) {
    assert.equal(
      sceneExtra.workspaces.find((w) => w.id === ws.id).tplZh,
      ws.tplZh,
      ws.id + "：新增其他工作区不改变既有 tplZh（不受增删影响）"
    );
  }

  /* 命中缺席 / 缺 zh / 非字符串 → null（防御性归一，呈现端按无名称处理）。 */
  assert.equal(templateZhOf(null), null, "命中缺席 → null");
  assert.equal(templateZhOf(undefined), null, "undefined → null");
  assert.equal(templateZhOf({}), null, "缺 zh → null");
  assert.equal(templateZhOf({ zh: "" }), null, "空串 → null");
  assert.equal(templateZhOf({ zh: 42 }), null, "非字符串（数字）→ null");
  assert.equal(templateZhOf({ zh: null }), null, "null → null");
  assert.equal(templateZhOf({ zh: "猎户座" }), "猎户座", "合法中文名透传");

  /* 场景差分：确定性派生字段同值 → 判 none；同 id 值不一致 = 防御不变量 → rebuild。 */
  assert.equal(sceneDiffLevel(sceneA, sceneA2), "none", "重复装配（含 tplZh 恒等）→ none");
  const forgedZh = JSON.parse(JSON.stringify(sceneA));
  forgedZh.workspaces[0].tplZh = "伪造座";
  assert.equal(sceneDiffLevel(sceneA, forgedZh), "rebuild", "同 id tplZh 不一致 → rebuild（防御不变量）");
  const nulledZh = JSON.parse(JSON.stringify(sceneA));
  nulledZh.workspaces[0].tplZh = null;
  assert.equal(sceneDiffLevel(sceneA, nulledZh), "rebuild", "tplZh 有值 → null 亦判 rebuild");
  /* 呈现层开关不进场景差分：同名同值 patch 判定与 tplZh 无耦合（关/开切换不触达场景级）。 */
  const renamed = JSON.parse(JSON.stringify(sceneA));
  renamed.workspaces[0].name = renamed.workspaces[0].name + "-renamed";
  assert.equal(sceneDiffLevel(sceneA, renamed), "patch", "仅名称变化仍判 patch（tplZh 不进 patch 属性签名）");
}

/* ── 模板指定覆盖注入面（add-cosmos-template-reassign 2.1–2.3/4.2 / design D1/D3）：
   位置口径恒哈希（MUST NOT 感知覆盖）；图样/名称口径覆盖优先、哈希兜底；注入手柄
   优先级 = 防御注入 > 覆盖 > 哈希；覆盖变化经 tplZh 差分判 rebuild，同模板零差分；
   非法/空/危险覆盖回落哈希；复位后逐字节回到基线。 ── */
{
  const ori = templateOf("ori");
  const uma = templateOf("uma");
  assert.ok(ori && uma, "测试模板存在（ori / uma）");

  const fixture = () => ({
    workspaces: [{
      id: "ws-ori",
      name: "ori-ws",
      path: "C:/ori",
      stars: [
        { id: "prop-x", name: "prop-x", lifecycle: "created", setBy: null, at: NOW, tasks: [1, 2] },
        { id: "prop-y", name: "prop-y", lifecycle: "created", setBy: null, at: NOW + MIN, tasks: [0, 1] }
      ],
      pending: [],
      archives: 0,
      links: [[0, 1]],
      associations: []
    }]
  });
  const build = (options) => mergeScene({
    skeleton: fixture(),
    sessions: { ids: [], byId: {} },
    workspaces: { items: [] },
    now: NOW
  }, options);

  setTemplateOverrides({});
  const base = build();
  const hashHit = templateForWorkspace("ws-ori");
  assert.ok(hashHit, "基线哈希命中存在");
  assert.equal(base.workspaces[0].tplZh, hashHit.zh, "无覆盖：tplZh = 哈希命中 zh（默认零变化）");

  /* ① 分流基线：无覆盖时 position 与 figure 命中同一条目（锁定口径漂移风险）。 */
  assert.equal(templateForPosition("ws-ori"), templateForFigure("ws-ori"), "无覆盖：position 与 figure 命中同一条目");

  /* ② 有覆盖：position 恒哈希、figure 随覆盖；场景位置不变、图样/名称换条目。 */
  const injectedMap = setTemplateOverrides({ "ws-ori": "ori" });
  assert.equal(injectedMap["ws-ori"], "ori", "注入返回净房结果（可读回）");
  assert.equal(templateForPosition("ws-ori"), hashHit, "有覆盖：position 恒哈希（MUST NOT 感知覆盖）");
  assert.equal(templateForFigure("ws-ori"), ori, "有覆盖：figure = 指定模板");

  const overridden = build();
  const basePos = base.workspaces[0].pos;
  assert.deepEqual(overridden.workspaces[0].pos, basePos, "指定覆盖不改变星座位置（天球地理承诺不因装饰重排）");
  assert.equal(overridden.workspaces[0].tplZh, ori.zh, "指定覆盖后 tplZh = 指定模板 zh");
  const oriLayout = starPatternLayout(ori, overridden.workspaces[0].stars);
  assert.ok(oriLayout, "指定模板图样布局可用");
  assert.deepEqual(overridden.workspaces[0].pattern.slots, oriLayout.slots, "指定覆盖后 pattern.slots 来自指定模板");
  assert.deepEqual(overridden.workspaces[0].pattern.lines, ori.lines, "指定覆盖后 pattern.lines = 指定模板 lines");
  for (const star of overridden.workspaces[0].stars) {
    assert.deepEqual(star.off, oriLayout.offs.get(star.id), `指定覆盖后恒星 off 来自指定模板（${star.id}）`);
  }

  /* ③ 差分判级：指定不同模板 → rebuild（tplZh/图样变）；同覆盖重复装配 → none；
     指定值 = 哈希缺省 → 场景逐字节恒等 + none（用户显式操作但零跳变）。 */
  assert.equal(sceneDiffLevel(base, overridden), "rebuild", "指定不同模板 → rebuild 判级");
  assert.equal(sceneDiffLevel(overridden, build()), "none", "同覆盖重复装配 → none（确定性）");
  setTemplateOverrides({ "ws-ori": hashHit.id });
  const sameAsHash = build();
  assert.deepEqual(sameAsHash, base, "指定值 = 哈希缺省 → 场景逐字节恒等");
  assert.equal(sceneDiffLevel(base, sameAsHash), "none", "指定同模板 → 零差分（无 rebuild、无呈现跳变）");

  /* ④ 撤销指定 → 回落哈希；位置恒不变。 */
  setTemplateOverrides({});
  const reset = build();
  assert.deepEqual(reset, base, "恢复默认（清覆盖）→ 逐字节回到基线");
  assert.deepEqual(reset.workspaces[0].pos, basePos, "撤销指定位置不变");

  /* ⑤ 注入手柄优先级：防御注入 > 覆盖 > 哈希（位置口径不受注入影响）。 */
  const injected = build({ templateFor: () => uma });
  assert.equal(injected.workspaces[0].tplZh, uma.zh, "注入手柄压过哈希（无覆盖时）");
  setTemplateOverrides({ "ws-ori": "ori" });
  const injectedOver = build({ templateFor: () => uma });
  assert.equal(injectedOver.workspaces[0].tplZh, uma.zh, "注入手柄压过覆盖（防御注入 > 覆盖 > 哈希）");
  assert.deepEqual(injectedOver.workspaces[0].pos, basePos, "注入手柄不影响位置口径（位置恒哈希）");

  /* ⑥ 非法 / 空 / 危险覆盖 → 回落哈希（SHALL NOT 抛错）。 */
  setTemplateOverrides({ "ws-ori": "not-a-template" });
  assert.deepEqual(build(), base, "非法覆盖条目经净房剔除 → 回落哈希");
  setTemplateOverrides("junk");
  assert.deepEqual(build(), base, "非对象注入 → 清空覆盖");
  setTemplateOverrides([["ws-ori", "ori"]]);
  assert.deepEqual(build(), base, "数组注入 → 清空覆盖");
  setTemplateOverrides(JSON.parse('{"__proto__":"ori"}'));
  assert.deepEqual(build(), base, "危险键注入 → 净房清空（不污染原型）");
  const degraded = build({ templateFor: () => null });
  assert.ok(degraded.workspaces[0].stars.every((star) => Array.isArray(star.off)), "注入命中缺席 → 恒星回退 starOffset 散布");
  assert.equal(degraded.workspaces[0].tplZh, null, "注入命中缺席 → tplZh 归一 null");

  /* ⑦ 图样存在性门控不受覆盖影响：空星座（无恒星）仍零图样交付，但名称层随 figure 口径。 */
  setTemplateOverrides({ "ws-ori": "ori" });
  const empty = mergeScene({
    skeleton: { workspaces: [{ id: "ws-ori", name: "ori-empty", path: "C:/ori", stars: [], pending: [], archives: 0, links: [], associations: [] }] },
    sessions: { ids: [], byId: {} },
    workspaces: { items: [] },
    now: NOW
  });
  assert.ok(!("pattern" in empty.workspaces[0]), "空星座 + 覆盖 → 仍不装配 pattern（门控 = stars 非空）");
  assert.equal(empty.workspaces[0].tplZh, ori.zh, "空星座 + 覆盖 → tplZh 仍随 figure 口径（名称层独立于图样门控）");
  assert.equal(sceneDiffLevel(empty, overridden), "rebuild", "图样存在性翻转（首星装配）+ tplZh → 既有 rebuild 判级");

  /* 复位模块态：后续断言不受本块覆盖污染。 */
  setTemplateOverrides({});
  assert.deepEqual(build(), base, "模块态复位 → 基线逐字节复现");
}

/* ── 点燃谱系透传（add-cosmos-panel-birthline-sort 3.1/3.2 / spec cosmos-proposal-panel
   「点燃谱系写入即时刷新」）：恒星投影增 `birthMs` 数值 + 台账三字段（`embryoAt` /
   `embryoSessionId` / `ignitedMs`）；谱系写入 MUST 判属性级 patch（MUST NOT 误判 none）。 */
{
  const anchorAt = NOW - 5 * 60 * MIN;
  const buildLedgerScene = (lineages) => mergeScene({
    skeleton: {
      workspaces: [{
        id: "wsL",
        name: "ledger",
        path: "/proj/ledger",
        archives: 0,
        pending: [],
        lineages,
        links: [],
        associations: [],
        stars: [
          { id: "add-lit", name: "add-lit", lifecycle: "reviewed", setBy: "cosmos-review", at: null, tasks: [1, 2], birthMs: NOW - 2 * MIN },
          { id: "add-plain", name: "add-plain", lifecycle: "created", setBy: null, at: null, tasks: [0, 0], birthMs: null }
        ]
      }]
    },
    sessions: { ids: [], byId: {} },
    workspaces: { items: [], archivedSessionIds: [] },
    now: NOW
  });

  const withoutLedger = buildLedgerScene([]);
  const [litPlain] = withoutLedger.workspaces[0].stars;
  assert.equal(litPlain.birthMs, NOW - 2 * MIN, "birthMs 数值透传（age 文本之外的排序兜底位）");
  assert.equal(litPlain.embryoAt, null, "台账未命中 → embryoAt null（面板走 birthMs 兜底）");
  assert.equal(litPlain.embryoSessionId, null, "台账未命中 → embryoSessionId null");
  assert.equal(litPlain.ignitedMs, null, "台账未命中 → ignitedMs null");
  assert.equal(withoutLedger.workspaces[0].stars[1].birthMs, null, "birthMs 缺失 → null（块殿后）");

  const withLedger = buildLedgerScene([
    { slug: "add-lit", embryoAt: anchorAt, embryoSessionId: "sess-ledger", ignitedMs: NOW - MIN }
  ]);
  const lit = withLedger.workspaces[0].stars[0];
  assert.equal(lit.embryoAt, anchorAt, "台账 embryoAt 按 slug 回查透传");
  assert.equal(lit.embryoSessionId, "sess-ledger", "台账 embryoSessionId 透传（块键来源）");
  assert.equal(lit.ignitedMs, NOW - MIN, "台账 ignitedMs 透传（块内同刻次序兜底）");
  assert.equal(withLedger.workspaces[0].stars[1].embryoAt, null, "未命中 slug → null（无谱系提案各自成块）");

  /* 差分守卫：谱系写入（null → 有值）MUST 判 patch（MUST NOT 误判 none 而面板停留旧序） */
  assert.equal(sceneDiffLevel(withoutLedger, withLedger), "patch", "谱系写入 → 属性级 patch（点燃谱系写入即时刷新）");
  assert.equal(
    sceneDiffLevel(withLedger, buildLedgerScene([{ slug: "add-lit", embryoAt: anchorAt, embryoSessionId: "sess-ledger", ignitedMs: NOW - MIN }])),
    "none",
    "同台账重复装配 → none（零抖动）"
  );
  /* 台账时间线数值变化（embryoAt / ignitedMs）同判 patch */
  const retimed = buildLedgerScene([
    { slug: "add-lit", embryoAt: anchorAt + MIN, embryoSessionId: "sess-ledger", ignitedMs: NOW }
  ]);
  assert.equal(sceneDiffLevel(withLedger, retimed), "patch", "embryoAt / ignitedMs 变化 → patch");
  /* 非法台账行（已在 birthline 层归一）缺席此处也 SHALL NOT 抛错：空/畸形 lineages 走兜底 */
  const malformed = buildLedgerScene([{ slug: "" }, null, { slug: "add-lit", embryoAt: 0, ignitedMs: 0 }]);
  assert.equal(malformed.workspaces[0].stars[0].embryoAt, null, "畸形台账行 → 按无谱系兜底（不抛错）");
  assert.equal(sceneDiffLevel(withoutLedger, malformed), "none", "畸形行不产生幽灵 patch");
}

console.log("merge-smoke: all assertions passed");
