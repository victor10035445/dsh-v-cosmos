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
  canRetryEntry,
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
  retryEntry,
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

/* ── 6. 重试：failed → queued 转态（归队首 / 快照原样 / 记账清除 / 校验族） ──
   （two-add-cosmos-queue-failed-entry-retry / spec「条目操作矩阵与复验跳过」） */
{
  /* 6a. 可重试判定：仅 failed。 */
  assert.equal(canRetryEntry({ state: "failed" }), true, "failed 可重试");
  for (const state of ["queued", "launching", "executing", "skipped", "weird"]) {
    assert.equal(canRetryEntry({ state }), false, state + " 不可重试");
  }
  assert.equal(canRetryEntry(null), false, "null 不可重试");
  assert.equal(canRetryEntry({}), false, "无 state 不可重试");

  /* 6b. 转态：快照原样、记账清除、stateAt 刷新、enqueuedAt 保留、归队首。 */
  const snapshotButton = {
    name: "FULL",
    prompt: "执行 FULL",
    model: { provider: "deepseek", model: "deepseek-chat", reasoningEffort: "high" },
    prepend: true,
    preState: "created"
  };
  const enriched = enqueueEntry(emptyQueueDoc(), input({ id: "q-full", button: snapshotButton }));
  assert.equal(enriched.ok, true, "装配 failed 目标前置入队");
  const otherQueued = enqueueEntry(enriched.doc, input({ id: "q-other", button: { name: "OTHER", prompt: "p" } }));
  const failedDoc = patchQueueEntry(otherQueued.doc, {
    wsId: "ws-1",
    entryId: "q-full",
    patch: {
      state: "failed",
      reason: "insufficient-balance",
      message: "余额不足",
      sessionId: "s-old",
      startedAt: NOW - 4_000
    },
    now: NOW - 1_000
  });
  assert.equal(failedDoc.ok, true, "装配 failed 残留");
  const failedEntry = queueOf(failedDoc.doc, "ws-1").entries[0];
  assert.equal(failedEntry.state, "failed", "残留态就位");
  assert.equal(failedEntry.startedAt, NOW - 4_000, "记账字段 startedAt 就位");

  const retried = retryEntry(failedDoc.doc, { wsId: "ws-1", entryId: "q-full", now: NOW + 7 });
  assert.equal(retried.ok, true, "failed 残留可重试");
  const entriesAfterRetry = queueOf(retried.doc, "ws-1").entries;
  assert.deepEqual(entriesAfterRetry.map((entry) => entry.id), ["q-full", "q-other"], "重试条目归队首（先于既有 queued）");
  const revived = entriesAfterRetry[0];
  assert.equal(revived.state, "queued", "转回 queued");
  assert.equal(revived.stateAt, NOW + 7, "stateAt 刷新为重试时刻");
  assert.equal(revived.enqueuedAt, NOW, "enqueuedAt 保留原值（入队序痕迹）");
  assert.equal(revived.id, "q-full", "id 不漂移（多窗口对账连贯）");
  assert.equal(revived.proposalId, "add-a", "proposalId 原样");
  assert.equal(revived.proposalDir, "C:/ws/openspec/changes/add-a", "proposalDir 原样");
  assert.deepEqual(revived.button, {
    name: "FULL",
    prompt: "执行 FULL",
    model: { provider: "deepseek", model: "deepseek-chat", reasoningEffort: "high" },
    prepend: true,
    preState: "created"
  }, "button 快照逐字保留（model/prepend/preState 不漂移）");
  for (const key of ["reason", "message", "sessionId", "startedAt"]) {
    assert.equal(key in revived, false, "终态记账字段清除：" + key);
  }
  assert.equal(queueCountsOf(queueOf(retried.doc, "ws-1")).active, 2, "转回 queued 重新计入在途（32 上限）");
  assert.equal(queueOf(retried.doc, "ws-1").paused, false, "重试不改队列暂停态（未暂停 → 仍未暂停）");
  assert.equal(nextLaunchable(retried.doc, "ws-1")?.id, "q-full", "非暂停队列 → 重试条目为下一个可启动（队首）");

  /* 暂停态：重试后仍暂停，调度取队首恒 null（kick 在服务端是 no-op）。 */
  const pausedDoc = setQueuePaused(failedDoc.doc, { wsId: "ws-1", paused: true, now: NOW - 900 }).doc;
  const retriedPaused = retryEntry(pausedDoc, { wsId: "ws-1", entryId: "q-full", now: NOW + 8 });
  assert.equal(retriedPaused.ok, true, "暂停队列同样可重试");
  assert.equal(queueOf(retriedPaused.doc, "ws-1").paused, true, "暂停态保持不变");
  assert.equal(nextLaunchable(retriedPaused.doc, "ws-1"), null, "暂停队列不推进（重试不越暂停守卫）");

  /* 6c. 拒绝族：missing / not-failed / duplicate / limit（拒绝时 doc 原样返回）。 */
  assert.equal(retryEntry(failedDoc.doc, { wsId: "ws-1", entryId: "ghost" }).error, "missing", "未知条目 missing");
  assert.equal(retryEntry(failedDoc.doc, { wsId: "ws-1", entryId: "q-other" }).error, "not-failed", "queued 不可重试");
  assert.equal(retryEntry(failedDoc.doc, { wsId: "", entryId: "q-full" }).error, "invalid", "缺 wsId invalid");
  const executingDoc = patchQueueEntry(failedDoc.doc, {
    wsId: "ws-1",
    entryId: "q-other",
    patch: { state: "executing", sessionId: "s-live" },
    now: NOW
  }).doc;
  assert.equal(retryEntry(executingDoc, { wsId: "ws-1", entryId: "q-other" }).error, "not-failed", "executing 不可重试");
  const skippedDoc = patchQueueEntry(failedDoc.doc, {
    wsId: "ws-1",
    entryId: "q-other",
    patch: { state: "skipped", reason: "prestate-drift" },
    now: NOW
  }).doc;
  assert.equal(retryEntry(skippedDoc, { wsId: "ws-1", entryId: "q-other" }).error, "not-failed", "skipped 不提供重试");

  /* 判重：同（提案, 按钮）已有 queued → 拒绝，failed 残留保持原样。 */
  const duplicateDoc = enqueueEntry(failedDoc.doc, input({ id: "q-dup", button: { name: "FULL", prompt: "执行 FULL" } })).doc;
  const duplicate = retryEntry(duplicateDoc, { wsId: "ws-1", entryId: "q-full" });
  assert.equal(duplicate.error, "duplicate", "同组合 queued 命中 → duplicate");
  assert.equal(duplicate.doc, duplicateDoc, "拒绝不产生新文档（failed 残留保持不变）");
  assert.equal(queueOf(duplicate.doc, "ws-1").entries.find((entry) => entry.id === "q-full").state, "failed", "failed 残留仍为 failed");

  /* 超限：32 条在途 + 一条 failed 残留时重试计入在途 → 拒绝（转回 queued 重新计数）。 */
  const saturated = Array.from({ length: QUEUE_INFLIGHT_LIMIT }, (_, index) => ({
    id: `q-f-${index}`,
    wsId: "ws-1",
    proposalId: "add-a",
    proposalDir: "C:/ws/openspec/changes/add-a",
    button: { name: `F${index}`, prompt: "p" },
    enqueuedAt: NOW,
    state: "queued",
    stateAt: NOW
  }));
  saturated.push({
    id: "q-old-failed",
    wsId: "ws-1",
    proposalId: "add-a",
    proposalDir: "C:/ws/openspec/changes/add-a",
    button: { name: "OLD", prompt: "p" },
    enqueuedAt: NOW,
    state: "failed",
    stateAt: NOW,
    reason: "delivery-failed"
  });
  const fullDoc = normalizeQueueDoc({
    version: QUEUE_VERSION,
    queues: { "ws-1": { paused: false, pausedAt: 0, entries: saturated } }
  });
  assert.equal(queueCountsOf(queueOf(fullDoc, "ws-1")).active, QUEUE_INFLIGHT_LIMIT, "在途已满 32（failed 不计）");
  const limitRetry = retryEntry(fullDoc, { wsId: "ws-1", entryId: "q-old-failed" });
  assert.equal(limitRetry.error, "limit", "在途已满 → 重试 limit");
  assert.equal(limitRetry.doc, fullDoc, "超限拒绝不产生新文档");
  assert.equal(queueOf(limitRetry.doc, "ws-1").entries.find((entry) => entry.id === "q-old-failed").state, "failed", "受阻残留保持 failed");

  /* 6d. 与移出/清空共存：重试转回的 queued 条目同语义（可移出、可被清空、可排序）。 */
  const removable = removeEntry(retried.doc, { wsId: "ws-1", entryId: "q-full" });
  assert.equal(removable.ok, true, "重试转回的条目可移出");
  const clearRetried = clearQueue(retried.doc, { wsId: "ws-1" });
  assert.equal(clearRetried.ok, true, "重试后再清空");
  assert.equal(clearRetried.removed, 2, "清空移除重试转回与既有 queued");
  assert.deepEqual(queueOf(clearRetried.doc, "ws-1").entries, [], "清空后无条目");
  const reorderRetried = reorderEntry(retried.doc, { wsId: "ws-1", entryId: "q-full", direction: "down" });
  assert.equal(reorderRetried.ok, true, "重试转回的条目可排序（普通 queued 同语义）");
  assert.deepEqual(
    queueOf(reorderRetried.doc, "ws-1").entries.map((entry) => entry.id),
    ["q-other", "q-full"],
    "排序生效（重试条目不再是队首）"
  );

  /* 6e. 存储句柄：retry 落盘（原子写）+ 注入时钟。 */
  const home = mkdtempSync(join(tmpdir(), "cosmos-queue-retry-"));
  const filePath = join(home, "storages", "dsh-v-cosmos.queues.json");
  try {
    let tick = NOW;
    const store = createQueueStore({ filePath, now: () => tick, idFactory: (() => { let index = 0; return () => `q-retry-${index++}`; })() });
    store.load();
    const added = store.enqueue({ wsId: "ws-1", proposalId: "add-a", proposalDir: "C:/ws/openspec/changes/add-a", button });
    const marked = store.patch({ wsId: "ws-1", entryId: added.entry.id, patch: { state: "failed", reason: "queen-rate-limited" } });
    assert.equal(marked.ok, true, "句柄落 failed");
    tick += 1_000;
    const revivedByStore = store.retry({ wsId: "ws-1", entryId: added.entry.id });
    assert.equal(revivedByStore.ok, true, "句柄重试成功");
    assert.equal(revivedByStore.entry.state, "queued", "句柄重试转回 queued");
    assert.equal(revivedByStore.entry.stateAt, tick, "句柄注入时钟写入 stateAt");
    const onDisk = JSON.parse(readFileSync(filePath, "utf8"));
    assert.equal(onDisk.queues["ws-1"].entries[0].state, "queued", "重试落盘（原子写）");
    assert.equal("reason" in onDisk.queues["ws-1"].entries[0], false, "落盘条目无终态记账字段");
    const reopened = createQueueStore({ filePath, now: () => tick });
    reopened.load();
    assert.equal(reopened.snapshot().queues["ws-1"].entries[0].state, "queued", "重试转态往返可读");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/* ── 7. 暂停/继续与调度取队首 ── */
const pausedDoc = setQueuePaused(two, { wsId: "ws-1", paused: true, now: NOW }).doc;
assert.equal(queueOf(pausedDoc, "ws-1").paused, true, "暂停标记");
assert.equal(nextLaunchable(pausedDoc, "ws-1"), null, "暂停时不启动");
const resumedDoc = setQueuePaused(pausedDoc, { wsId: "ws-1", paused: false, now: NOW }).doc;
assert.equal(nextLaunchable(resumedDoc, "ws-1")?.id, "q-a", "未暂停取队首 queued");
const inflightDoc = patchQueueEntry(resumedDoc, { wsId: "ws-1", entryId: "q-a", patch: { state: "executing", sessionId: "s-1" }, now: NOW }).doc;
assert.equal(nextLaunchable(inflightDoc, "ws-1"), null, "已在途不再启动（单飞）");
assert.equal(queueOf(setQueuePaused(inflightDoc, { wsId: "ws-1", paused: true }).doc, "ws-1").entries[0].state, "executing", "暂停不触碰在途条目");

/* ── 8. 对外投影（不含 prompt 正文；子态推导） ── */
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

/* ── 9. 存储句柄：原子写往返 / 损坏回落 / 注入面 ── */
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
