/**
 * 交叉时序冒烟（add-cosmos-entry 3.5/3.7 / design.md R6）：会话归档、提案归档、
 * 关联失效（路径指纹漂移）三种时序的收敛语义。
 * 运行：node test/cross-timing-smoke.mjs
 */
import assert from "node:assert/strict";
import { pruneArchivedSessions, normalizeAssociations } from "../src/associations.mjs";
import { mergeScene } from "../src/merge.mjs";

const NOW = 1_700_000_000_000;
const entry = (workspace, proposal, sessionId) => ({
  workspace, proposal, sessionId, origin: "heuristic", createdAt: NOW, updatedAt: NOW
});

const skeleton = {
  version: 1,
  generatedAt: NOW,
  workspaces: [{
    id: "ws1", name: "ws1", path: "C:/ws1",
    stars: [{ id: "add-a", name: "add-a", status: "in-progress", tasks: [1, 2], birthMs: NOW }],
    archives: 0, links: [],
    associations: [{ proposal: "add-a", sessionId: "s1", origin: "heuristic" }]
  }]
};
const mirror = {
  ids: ["s1"],
  byId: { s1: { displayTitle: "会话 s1", updatedAt: NOW } }
};
const registry = { items: [{ workspaceId: "ws1", sessionIds: ["s1"] }], archivedSessionIds: [] };

/* ── 时序一：会话归档（s1 进 archivedSessionIds）→ 条目剪除 + 行星移除 ── */
const entries = [entry("C:/ws1", "add-a", "s1")];
const pruned = pruneArchivedSessions(entries, new Set(["s1"]));
assert.equal(pruned, null, "时序一（宿主侧）：归档会话条目剪除至空 → 摘除整键");
const sceneAfterArchive = mergeScene({
  skeleton: { ...skeleton, workspaces: [{ ...skeleton.workspaces[0], associations: [] }] },
  sessions: { ids: ["s1"], byId: mirror.byId },
  workspaces: { ...registry, archivedSessionIds: ["s1"] },
  now: NOW
});
assert.equal(sceneAfterArchive.workspaces[0].planets.length, 0, "时序一（客户端）：行星移除");
assert.equal(sceneAfterArchive.workspaces[0].comets.length, 0, "时序一（客户端）：归档会话不转彗星");
assert.equal(sceneAfterArchive.workspaces[0].stars.length, 1, "时序一（客户端）：恒星仍在");

/* ── 时序二：提案归档（add-a 离开活跃清单）→ 行星回归彗星 + 关联边记录保留 ── */
const entriesKept = [entry("C:/ws1", "add-a", "s1")]; // 宿主不剪（提案归档不剪语义）
assert.equal(normalizeAssociations(entriesKept).length, 1, "时序二（宿主侧）：边记录保留");
const archivedSkeleton = {
  ...skeleton,
  workspaces: [{
    ...skeleton.workspaces[0],
    stars: [], // 提案归档 → 恒星并入星云
    links: [],
    associations: [{ proposal: "add-a", sessionId: "s1", origin: "heuristic" }] // 骨架边投影保留
  }]
};
const sceneRegress = mergeScene({ skeleton: archivedSkeleton, sessions: mirror, workspaces: registry, now: NOW });
assert.equal(sceneRegress.workspaces[0].planets.length, 0, "时序二（客户端）：不再是行星");
assert.ok(sceneRegress.workspaces[0].comets.some((c) => c.id === "s1"), "时序二（客户端）：行星回归彗星");

/* ── 时序三：关联失效（工作区迁移 → 路径指纹漂移）→ 边不落地、骨架重建不报错 ── */
const migratedEntries = [entry("D:/old-machine/ws1", "add-a", "s1")]; // 旧设备路径指纹
assert.equal(normalizeAssociations(migratedEntries).length, 1, "时序三（宿主侧）：旧指纹条目本身合法可存（保留策略）");
const sceneMigrated = mergeScene({
  skeleton: { ...skeleton, workspaces: [{ ...skeleton.workspaces[0], associations: [] }] }, // 新设备路径不命中旧指纹 → 无关联投影
  sessions: { ids: [], byId: {} }, // 新设备无本机会话
  workspaces: { items: [{ workspaceId: "ws1", sessionIds: [] }], archivedSessionIds: [] },
  now: NOW
});
assert.equal(sceneMigrated.workspaces[0].stars.length, 1, "时序三：恒星随工作区文件重建");
assert.equal(sceneMigrated.workspaces[0].archives, 0, "时序三：星云随工作区文件重建");
assert.equal(sceneMigrated.workspaces[0].planets.length, 0, "时序三：无本机会话 → 行星为空");
assert.equal(sceneMigrated.workspaces[0].comets.length, 0, "时序三：彗星为空，插件不报错");

/* ── 重新认领：迁移后启发式可重新长出（规则装配面已有冒烟，此处验证空镜像不崩） ── */
const sceneEmpty = mergeScene({ skeleton: { version: 1, generatedAt: NOW, workspaces: [] }, sessions: { ids: [], byId: {} }, workspaces: { items: [] }, now: NOW });
assert.deepEqual(sceneEmpty.workspaces, [], "空骨架 → 空场景");

console.log("cross-timing-smoke: all assertions passed");
