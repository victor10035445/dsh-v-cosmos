/**
 * 队列存储冒烟（add-cosmos-action-queue 2.2）：归一化 / 操作矩阵 / 重复与上限拒绝 /
 * 原子写往返 / 对外投影。
 * 运行：node test/queue-store-smoke.mjs
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  QUEUE_INFLIGHT_LIMIT,
  QUEUE_VERSION,
  clearQueue,
  createQueueStore,
  emptyQueueDoc,
  enqueueEntry,
  nextLaunchable,
  normalizeQueueDoc,
  normalizeQueueEntry,
  patchQueueEntry,
  publicEntryOf,
  publicSnapshotOf,
  queueCountsOf,
  queueOf,
  removeEntry,
  reorderEntry,
  resolveQueueStorePath,
  setQueuePaused
} from "../src/queue-store.mjs";

const NOW = 1_700_000_000_000;
const button = { name: "B1", prompt: "执行 B1", autoSend: true, newSession: true };
const input = (overrides = {}) => ({
  wsId: "ws-1",
  proposalId: "add-a",
  proposalDir: "C:/ws/openspec/changes/add-a",
  button,
  id: "q-1",
  now: NOW,
  ...overrides
});

/* ── 1. 条目归一化（入队快照条件键） ── */
const full = normalizeQueueEntry({
  id: "q-1",
  wsId: "ws-1",
  proposalId: "add-a",
  proposalDir: "C:/ws/openspec/changes/add-a",
  button: { name: "B1", prompt: "p", model: { provider: "deepseek", model: "deepseek-chat", reasoningEffort: "high" }, prepend: true, preState: "created" },
  enqueuedAt: NOW,
  state: "queued",
  stateAt: NOW
});
assert.equal(full.button.model.provider, "deepseek", "model 随快照保留");
assert.equal(full.button.model.reasoningEffort, "high", "reasoningEffort 保留");
assert.equal(full.button.prepend, true, "prepend 保留");
assert.equal(full.button.preState, "created", "preState 随快照定格");
assert.equal("autoSend" in full.button, false, "autoSend 不入快照（队列恒自动发送）");
assert.equal("jumpNewSession" in full.button, false, "jumpNewSession 不入快照（对队列无意义）");

const minimal = normalizeQueueEntry({
  id: "q-2", wsId: "ws-1", proposalId: "a", proposalDir: "C:/a",
  button: { name: "B", prompt: "p" }, enqueuedAt: NOW, state: "queued", stateAt: NOW
});
assert.equal("model" in minimal.button, false, "未绑定模型 → 不输出 model 键");
assert.equal("prepend" in minimal.button, false, "未勾选 → 不输出 prepend 键");
assert.equal("preState" in minimal.button, false, "未设前置状态 → 不输出 preState 键");

assert.equal(normalizeQueueEntry(null), null, "非对象 → null");
assert.equal(normalizeQueueEntry({ ...input(), id: "" }), null, "空 id → null");
assert.equal(normalizeQueueEntry({ ...input(), proposalDir: "" }), null, "空目录 → null");
assert.equal(normalizeQueueEntry({ ...input(), button: { name: "", prompt: "p" } }), null, "空按钮名 → null");
assert.equal(normalizeQueueEntry({ ...input(), button: { name: "B", prompt: "   " } }), null, "空 prompt → null");
assert.equal(
  normalizeQueueEntry({ ...input(), button: { name: "B", prompt: "p", preState: "bogus" } }).button.preState,
  undefined,
  "枚举外 preState 丢弃（不阻断条目）"
);
assert.equal(
  normalizeQueueEntry({ ...input(), button: { name: "B", prompt: "p", model: { provider: "x" } } }),
  null,
  "非法 model → 整条丢弃"
);

/* ── 2. 文档归一化 ── */
const doc = normalizeQueueDoc({
  version: QUEUE_VERSION,
  queues: {
    "ws-1": { paused: false, entries: [full, full, { bogus: true }] },
    "ws-empty": { paused: false, entries: [] },
    "ws-paused": { paused: true, pausedAt: NOW, entries: [] }
  }
});
assert.equal(doc.queues["ws-1"].entries.length, 1, "同 id 去重、脏条目丢弃");
assert.equal("ws-empty" in doc.queues, false, "空且未暂停的队列不建档");
assert.equal(doc.queues["ws-paused"].paused, true, "暂停态保留（即使空）");
assert.deepEqual(normalizeQueueDoc({ version: 99, queues: { "ws-1": { entries: [full] } } }), emptyQueueDoc(), "版本漂移 → 空文档");
assert.deepEqual(normalizeQueueDoc("{"), emptyQueueDoc(), "非对象 → 空文档");

/* ── 3. 入队：重复 / 上限 / 终态残留不构成重复 ── */
const enqueued = enqueueEntry(emptyQueueDoc(), input());
assert.equal(enqueued.ok, true, "入队成功");
assert.equal(enqueued.entry.state, "queued", "初始态 queued");
assert.equal(enqueued.entry.enqueuedAt, NOW, "enqueuedAt 取注入时钟");
assert.equal(enqueueEntry(enqueued.doc, input({ id: "q-2" })).error, "duplicate", "同（提案, 按钮）queued 重复拒绝");
/* 终态残留不构成重复 */
const failedDoc = patchQueueEntry(enqueued.doc, { wsId: "ws-1", entryId: "q-1", patch: { state: "failed", reason: "queen-unreachable" }, now: NOW + 1 });
assert.equal(failedDoc.ok, true, "转 failed 成功");
const retry = enqueueEntry(failedDoc.doc, input({ id: "q-2" }));
assert.equal(retry.ok, true, "终态残留不构成重复 → 可重新入队");
assert.equal(queueCountsOf(queueOf(retry.doc, "ws-1")).active, 1, "残留不计入在途");

/* 上限：32 条在途 → 第 33 条拒绝；把一条转为终态后即可再入队 */
let limitDoc = emptyQueueDoc();
for (let index = 0; index < QUEUE_INFLIGHT_LIMIT; index += 1) {
  const result = enqueueEntry(limitDoc, input({ id: `q-${index}`, button: { name: `B${index}`, prompt: "p" } }));
  assert.equal(result.ok, true, `第 ${index + 1} 条入队成功`);
  limitDoc = result.doc;
}
assert.equal(enqueueEntry(limitDoc, input({ id: "q-over", button: { name: "B-over", prompt: "p" } })).error, "limit", "超上限拒绝");
const freed = removeEntry(limitDoc, { wsId: "ws-1", entryId: "q-0" });
assert.equal(freed.ok, true, "queued 可移出");
assert.equal(enqueueEntry(freed.doc, input({ id: "q-over", button: { name: "B-over", prompt: "p" } })).ok, true, "腾位后可入队");

/* ── 4. 操作矩阵：排序 ── */
const two = enqueueEntry(enqueueEntry(emptyQueueDoc(), input({ id: "q-a", button: { name: "A", prompt: "p" } })).doc, input({ id: "q-b", button: { name: "B", prompt: "p" } })).doc;
assert.equal(reorderEntry(two, { wsId: "ws-1", entryId: "q-a", direction: "down" }).ok !== false, true, "queued 下移成功");
const moved = reorderEntry(two, { wsId: "ws-1", entryId: "q-a", direction: "down" });
assert.deepEqual(moved.doc.queues["ws-1"].entries.map((entry) => entry.id), ["q-b", "q-a"], "邻位交换");
assert.equal(reorderEntry(two, { wsId: "ws-1", entryId: "q-a", direction: "up" }).error, "boundary", "队首上移拒绝");
assert.equal(reorderEntry(two, { wsId: "ws-1", entryId: "ghost", direction: "up" }).error, "missing", "未知条目拒绝");
/* 邻位非 queued → 拒绝；executing 条目自身锁定 */
const lockDoc = patchQueueEntry(moved.doc, { wsId: "ws-1", entryId: "q-b", patch: { state: "executing", sessionId: "s-1" }, now: NOW + 2 }).doc;
assert.equal(reorderEntry(lockDoc, { wsId: "ws-1", entryId: "q-a", direction: "up" }).error, "neighbor-locked", "邻位非 queued 拒绝");
assert.equal(reorderEntry(lockDoc, { wsId: "ws-1", entryId: "q-b", direction: "down" }).error, "locked", "executing 条目排序锁定");

/* ── 5. 操作矩阵：移出 / 清空 ── */
assert.equal(removeEntry(lockDoc, { wsId: "ws-1", entryId: "q-b" }).error, "locked", "executing 移出锁定");
assert.equal(removeEntry(lockDoc, { wsId: "ws-1", entryId: "q-a" }).ok, true, "queued 移出成功");
const terminalDoc = patchQueueEntry(lockDoc, { wsId: "ws-1", entryId: "q-b", patch: { state: "skipped", reason: "prestate-drift" }, now: NOW + 3 }).doc;
assert.equal(removeEntry(terminalDoc, { wsId: "ws-1", entryId: "q-b" }).ok, true, "skipped 残留可移出");

const clearTarget = enqueueEntry(enqueueEntry(terminalDoc, input({ id: "q-c", button: { name: "C", prompt: "p" } })).doc, input({ id: "q-d", button: { name: "D", prompt: "p" } })).doc;
const executingDoc = patchQueueEntry(clearTarget, { wsId: "ws-1", entryId: "q-d", patch: { state: "executing", sessionId: "s-9" }, now: NOW + 4 }).doc;
const cleared = clearQueue(executingDoc, { wsId: "ws-1" });
assert.equal(cleared.ok, true, "清空成功");
assert.equal(cleared.removed, 3, "清空移除全部 queued 与终态残留（q-b/q-a/q-c）");
assert.deepEqual(cleared.doc.queues["ws-1"].entries.map((entry) => entry.id), ["q-d"], "executing 条目保留");

/* ── 6. 暂停/继续与调度取队首 ── */
const pausedDoc = setQueuePaused(two, { wsId: "ws-1", paused: true, now: NOW }).doc;
assert.equal(queueOf(pausedDoc, "ws-1").paused, true, "暂停标记");
assert.equal(nextLaunchable(pausedDoc, "ws-1"), null, "暂停时不启动");
const resumedDoc = setQueuePaused(pausedDoc, { wsId: "ws-1", paused: false, now: NOW }).doc;
assert.equal(nextLaunchable(resumedDoc, "ws-1")?.id, "q-a", "未暂停取队首 queued");
const inflightDoc = patchQueueEntry(resumedDoc, { wsId: "ws-1", entryId: "q-a", patch: { state: "executing", sessionId: "s-1" }, now: NOW }).doc;
assert.equal(nextLaunchable(inflightDoc, "ws-1"), null, "已在途不再启动（单飞）");
assert.equal(queueOf(setQueuePaused(inflightDoc, { wsId: "ws-1", paused: true }).doc, "ws-1").entries[0].state, "executing", "暂停不触碰在途条目");

/* ── 7. 对外投影（不含 prompt 正文；子态推导） ── */
const projected = publicEntryOf({ ...full, sessionId: "s-1", startedAt: NOW }, { running: true, waiting: false });
assert.equal(projected.subState, "running", "running 子态");
assert.equal("prompt" in projected, false, "投影不含 prompt 正文");
assert.equal("button" in projected, false, "投影不逐字暴露按钮快照");
assert.equal(projected.autoSend, true, "投影标注恒自动发送");
assert.equal(projected.buttonName, "B1", "按钮名透出");
assert.equal(publicEntryOf(full, { running: false, waiting: true }).subState, "waiting", "等待决策子态优先");
assert.equal(publicEntryOf(full, null).subState, undefined, "无活动信号不输出子态");
const snapshot = publicSnapshotOf(two, (wsId, entry) => (entry.id === "q-a" ? { running: true } : null));
assert.equal(snapshot.queues["ws-1"].counts.queued, 2, "快照计数");
assert.equal(snapshot.queues["ws-1"].entries[0].id, "q-a", "快照保序");

/* ── 8. 存储句柄：原子写往返 / 损坏回落 / 注入面 ── */
const home = mkdtempSync(join(tmpdir(), "cosmos-queue-store-"));
const filePath = join(home, "storages", "dsh-v-cosmos.queues.json");
try {
  assert.equal(resolveQueueStorePath({ env: { DSH_HOME: home } }), filePath, "存储路径 = $DSH_HOME/storages/dsh-v-cosmos.queues.json");
  let tick = NOW;
  const store = createQueueStore({ filePath, now: () => tick, idFactory: (() => { let index = 0; return () => `q-gen-${index++}`; })() });
  store.load();
  const added = store.enqueue({ wsId: "ws-1", proposalId: "add-a", proposalDir: "C:/ws/openspec/changes/add-a", button });
  assert.equal(added.ok, true, "句柄入队成功");
  assert.equal(added.entry.id, "q-gen-0", "注入 idFactory 生效");
  assert.equal(added.entry.enqueuedAt, NOW, "注入 now 生效");
  const onDisk = JSON.parse(readFileSync(filePath, "utf8"));
  assert.equal(onDisk.version, QUEUE_VERSION, "落盘版本");
  assert.equal(onDisk.queues["ws-1"].entries.length, 1, "落盘条目");
  /* 新句柄回读 */
  tick += 1000;
  const reopened = createQueueStore({ filePath, now: () => tick });
  reopened.load();
  assert.equal(reopened.snapshot().queues["ws-1"].entries[0].id, "q-gen-0", "原子写往返可读");
  assert.equal(reopened.counts("ws-1").queued, 1, "回读计数");
  /* 损坏文件 → 空队列（首写即建） */
  const damaged = createQueueStore({ filePath, read: () => "{not json", write: () => {} });
  damaged.load();
  assert.deepEqual(damaged.doc, emptyQueueDoc(), "损坏文件 → 空文档");
  /* 注入 read：缺失文件 → 空文档 */
  const missing = createQueueStore({ filePath: join(home, "nope.json"), read: () => null });
  missing.load();
  assert.deepEqual(missing.doc, emptyQueueDoc(), "文件缺失 → 空文档");
  /* 写失败不抛出（内存态权威） */
  const failing = createQueueStore({ filePath, write: () => { throw new Error("disk full"); } });
  failing.load();
  assert.equal(failing.enqueue({ wsId: "ws-1", proposalId: "a", proposalDir: "C:/a", button }).ok, true, "写失败仍返回成功（内存态）");
} finally {
  rmSync(home, { recursive: true, force: true });
}

console.log("queue-store-smoke: all assertions passed");
