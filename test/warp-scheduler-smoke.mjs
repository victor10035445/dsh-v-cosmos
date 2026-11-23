/**
 * 曲率引擎状态机冒烟（two-add-cosmos-proposal-warp 3.7 / spec cosmos-proposal-warp
 * 「门控接力状态机（复查触发沿）」「完成判定（曲率口径）」「并发上限与点火调度」
 * 「proto 安静投递」「星胚展开」「转入脉冲队列（转投即完成）」「重启对账」）：
 *  - 接力链（Review → Apply → Archive 全链）、触发沿红线（状态翻转不点火）；
 *  - 并发上限 3 / 暂停语义（只挡点火不碰在途）/ proto 安静门（等待会话空闲）；
 *  - 星胚展开（proto 收尾 → 展开非 proto 条目 → 复查接力）；
 *  - 转投即完成（含重复拒绝视为完成、在途满保持待发重试、复验不过 skipped）；
 *  - 完成判定（running → idle ∧ 无待决策 → 出队 + 触发目标复查）/ 投递失败显式残留；
 *  - 重启对账三态（launching → failed、executing 冷读收敛、running 续监视）。
 *
 * 全注入面直测：无 fs、无真实定时器（假定时器数组）、无框架。
 * 运行：node test/warp-scheduler-smoke.mjs
 */
import assert from "node:assert/strict";
import { createWarpScheduler, WARP_CONCURRENCY_LIMIT } from "../src/warp-scheduler.mjs";
import { createWarpStore, emptyWarpDoc } from "../src/warp-store.mjs";

const button = (name, extra = {}) => ({ name, prompt: "执行 " + name, ...extra });

let clock = 1000;
const nextClock = () => {
  clock += 10;
  return clock;
};

/** 内存存储（零 fs；id 递增）。 */
function makeStore() {
  let id = 0;
  return createWarpStore({
    filePath: "C:/virtual/warp.json",
    read: () => null,
    write: () => {},
    now: () => clock,
    idFactory: () => "w-" + (++id)
  });
}

/** 假定时器（收集不执行；clearTimeout 从列表移除）。 */
function makeTimers() {
  const timers = [];
  return {
    timers,
    setTimeout(fn, ms) {
      const timer = { fn, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      if (timer) timer.cleared = true;
    }
  };
}

/**
 * 建立调度器夹具。
 * @param {object} [options]
 * @param {object} options.store 曲率存储
 * @param {Function} [options.gate]
 * @param {Function} [options.deliver]
 * @param {Function} [options.transfer]
 * @param {Function} [options.expand]
 * @param {Function} [options.explorerBusy]
 * @param {Function} [options.readSession]
 * @param {Function} [options.isArchived]
 */
function makeScheduler(options = {}) {
  const sessionStates = new Map(); // sessionId → {running, sawRunning, waiting}
  const timers = makeTimers();
  const calls = { deliver: [], transfer: [], expand: [], changes: 0, notify: [] };
  const userDeliver = options.deliver;
  const userTransfer = options.transfer;
  const userExpand = options.expand;
  const scheduler = createWarpScheduler({
    store: options.store,
    gate: options.gate ?? (() => ({ ok: true })),
    deliver: async (entry) => {
      calls.deliver.push(entry);
      if (typeof userDeliver === "function") return userDeliver(entry);
      return { ok: true, sessionId: "session-" + entry.id };
    },
    transfer: async (entry) => {
      calls.transfer.push(entry);
      if (typeof userTransfer === "function") return userTransfer(entry);
      return { ok: true };
    },
    expand: async (entry) => {
      calls.expand.push(entry);
      if (typeof userExpand === "function") return userExpand(entry);
      return { targets: [] };
    },
    explorerBusy: options.explorerBusy ?? (() => false),
    readSession: options.readSession ?? (async () => ({ ok: true, running: false, waiting: false })),
    readSessionState: (sessionId) => {
      const state = sessionStates.get(sessionId);
      return state === undefined ? null : { ...state };
    },
    isArchived: options.isArchived ?? (() => false),
    onChange: () => {
      calls.changes += 1;
    },
    notify: (message, isError) => calls.notify.push({ message, isError }),
    now: () => clock,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    firstBusyWindowMs: 5000,
    coldRetryMs: 1000,
    coldReadMaxAttempts: 2
  });
  return { scheduler, sessionStates, timers, calls };
}

/** 附着一组条目（默认 proposal 目标；id 由存储工厂递增）。 */
function attach(store, targetKey, entries, options = {}) {
  const now = nextClock();
  return store.attach({
    wsId: options.wsId ?? "ws1",
    targetKey,
    targetKind: options.targetKind ?? "proposal",
    targetLabel: options.targetLabel ?? targetKey,
    proposalDir: options.proposalDir ?? ("C:/ws/openspec/changes/" + targetKey),
    anchorSlugs: options.anchorSlugs,
    explorerSessionId: options.explorerSessionId,
    entries,
    now
  });
}

const entryStates = (store, wsId = "ws1") => store.warp(wsId).entries.map((entry) => ({
  id: entry.id,
  targetKey: entry.targetKey,
  state: entry.state,
  rule: entry.rule,
  reason: entry.reason
}));

/** 让投递/转投的异步收尾跑完（微任务 + 宏任务一轮）。 */
const flush = () => new Promise((done) => setImmediate(done));

/* ── 1. 接力链：附着 → 点亮 → 完成 → 下一级（Review → Apply → Archive） ── */
{
  const store = makeStore();
  store.load();
  const probe = { lifecycle: "created" };
  const { scheduler, sessionStates, calls } = makeScheduler({
    store,
    gate: (entry) => (
      !entry.button.preState || probe.lifecycle === entry.button.preState
        ? { ok: true }
        : { ok: false, reason: "prestate-drift" }
    )
  });
  attach(store, "add-a", [
    { button: button("Review", { preState: "created" }) },
    { button: button("Apply", { preState: "reviewed" }) },
    { button: button("Archive", { preState: "executed" }) }
  ]);
  await scheduler.start();
  assert.deepEqual(entryStates(store).map((entry) => entry.state), ["executing", "grayed", "grayed"], "附着即复查点亮 Review 并点火");
  assert.equal(calls.deliver.length, 1, "仅 Review 点火");
  assert.equal(calls.deliver[0].button.name, "Review");

  /* 完成判定：running → idle（无待决策）→ 出队 + 触发目标复查 */
  const sessionId = calls.deliver[0].sessionId ?? "session-w-1";
  scheduler.onAgentStatus({ sessionId, status: "running" });
  sessionStates.set(sessionId, { running: false, sawRunning: true, waiting: 0 });
  probe.lifecycle = "reviewed";
  scheduler.onAgentStatus({ sessionId, status: "idle" });
  await new Promise((done) => setImmediate(done));
  const afterReview = entryStates(store);
  assert.deepEqual(afterReview.map((entry) => entry.id), ["w-2", "w-3"], "Review 完成后出队");
  assert.deepEqual(afterReview.map((entry) => entry.state), ["executing", "grayed"], "Apply 接力点亮并点火，Archive 保持置灰");

  /* Apply 完成 → Archive（executed）点亮 */
  const applyId = calls.deliver[1].sessionId ?? "session-w-2";
  scheduler.onAgentStatus({ sessionId: applyId, status: "running" });
  sessionStates.set(applyId, { running: false, sawRunning: true, waiting: 0 });
  probe.lifecycle = "executed";
  scheduler.onAgentStatus({ sessionId: applyId, status: "idle" });
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(entryStates(store).map((entry) => entry.state), ["executing"], "Archive 接力点亮");

  /* 等待决策子态：挂起不完成 */
  const archiveId = calls.deliver[2].sessionId ?? "session-w-3";
  scheduler.onAgentStatus({ sessionId: archiveId, status: "running" });
  sessionStates.set(archiveId, { running: false, sawRunning: true, waiting: 1 });
  scheduler.onAgentStatus({ sessionId: archiveId, status: "idle" });
  assert.equal(entryStates(store).length, 1, "等待决策 → 挂起不完成");
  assert.equal(scheduler.activityOf("ws1", store.warp("ws1").entries[0]).waiting, 1, "等待决策子态透出");

  /* 决策完成 → 出队 */
  sessionStates.set(archiveId, { running: false, sawRunning: true, waiting: 0 });
  scheduler.onInteractionExit(archiveId);
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(entryStates(store), [], "决策完成 → 出队");
}

/* ── 2. 触发沿红线：门控翻转本身不触发复查 / 任务结束才触发 ── */
{
  const store = makeStore();
  const probe = { lifecycle: "created" };
  const { scheduler, calls } = makeScheduler({
    store,
    gate: (entry) => (
      !entry.button.preState || probe.lifecycle === entry.button.preState ? { ok: true } : { ok: false }
    ),
    deliver: async (entry) => ({ ok: true, sessionId: "s-" + entry.id })
  });
  attach(store, "add-b", [
    { button: button("Review", { preState: "created" }) },
    { button: button("Apply", { preState: "reviewed" }) }
  ]);
  scheduler.reviewTarget("ws1", "add-b");
  await flush();
  assert.deepEqual(entryStates(store).map((entry) => entry.state), ["executing", "grayed"], "Review 点火，Apply 置灰");
  /* 提案 lifecycle 翻转（状态变化）——没有任何触发沿 */
  probe.lifecycle = "reviewed";
  assert.deepEqual(entryStates(store).map((entry) => entry.state), ["executing", "grayed"], "状态翻转不主动复查（红线）");
  /* 任务完整结束 → 下降沿触发复查 */
  scheduler.onTaskSettled("ws1", "add-b");
  const states = entryStates(store).map((entry) => entry.state);
  assert.equal(calls.deliver.length >= 1, true);
  assert.ok(states.length === 2, "仍有两级条目（Review 在途，Apply 点亮或等待）");
}

/* ── 3. 并发上限 3（跨目标并行）× 超限待发 ── */
{
  const store = makeStore();
  const gates = { ok: true };
  const { scheduler, calls } = makeScheduler({
    store,
    gate: () => gates,
    deliver: async (entry) => ({ ok: true, sessionId: "s-" + entry.targetKey })
  });
  for (const name of ["a", "b", "c", "d"]) {
    attach(store, name, [{ button: button("Review", { preState: "created" }) }]);
  }
  scheduler.reviewAll();
  await flush();
  const states = entryStates(store).map((entry) => entry.state);
  assert.equal(states.filter((state) => state === "executing" || state === "launching").length, WARP_CONCURRENCY_LIMIT, "并发上限 3");
  assert.equal(states.filter((state) => state === "ready").length, 1, "超限条目保持 ready 待发");
}

/* ── 4. 暂停语义：点亮照常、点火被挡、在途不干预、继续后点火 ── */
{
  const store = makeStore();
  store.load();
  const { scheduler, calls } = makeScheduler({
    store,
    deliver: async (entry) => ({ ok: true, sessionId: "s-" + entry.targetKey })
  });
  store.setPaused({ wsId: "ws1", paused: true });
  attach(store, "add-c", [{ button: button("Review", { preState: "created" }) }]);
  attach(store, "add-d", [{ button: button("Review", { preState: "created" }) }]);
  scheduler.reviewAll();
  assert.deepEqual(entryStates(store).map((entry) => entry.state), ["ready", "ready"], "暂停期间点亮照常、不点火");
  assert.equal(calls.deliver.length, 0, "暂停不投递");
  store.setPaused({ wsId: "ws1", paused: false });
  scheduler.kick("ws1");
  await flush();
  assert.deepEqual(entryStates(store).map((entry) => entry.state), ["executing", "executing"], "继续后按序点火");
  assert.equal(calls.deliver.length, 2);
}

/* ── 5. proto 安静门：会话占用 → 等待会话空闲；归零才点火 ── */
{
  const store = makeStore();
  let busy = true;
  const { scheduler, calls } = makeScheduler({
    store,
    gate: () => ({ ok: true }),
    explorerBusy: () => busy,
    deliver: async (entry) => ({ ok: true, sessionId: "explorer-1" })
  });
  attach(store, "explorer-1", [{ button: button("New", { preState: "proto" }) }], {
    targetKind: "embryo",
    anchorSlugs: ["s1", "s2"],
    explorerSessionId: "explorer-1"
  });
  scheduler.reviewAll();
  assert.equal(entryStates(store)[0].state, "ready", "会话占用 → 保持 ready");
  assert.deepEqual(
    scheduler.activityOf("ws1", store.warp("ws1").entries[0]),
    { waitingSession: true },
    "等待会话空闲子态透出"
  );
  assert.equal(calls.deliver.length, 0, "安静门挡住点火");
  busy = false;
  scheduler.onTaskSettled("ws1", "explorer-1");
  await flush();
  assert.equal(calls.deliver.length, 1, "会话归零 → 点火投递");
  assert.equal(calls.deliver[0].explorerSessionId, "explorer-1", "投递目标是既有探索会话");
  assert.equal("prompt" in calls.deliver[0], false, "投递器收到原始快照（prompt 在 button）");
}

/* ── 5b. 同一探索会话多条 proto 条目串行（plan 可含多条 proto 动作条） ── */
{
  const store = makeStore();
  const delivered = [];
  const { scheduler, sessionStates } = makeScheduler({
    store,
    explorerBusy: () => false,
    deliver: async (entry) => {
      delivered.push(entry.id);
      return { ok: true, sessionId: entry.explorerSessionId };
    }
  });
  attach(store, "explorer-9", [
    { button: button("New", { preState: "proto" }) },
    { button: button("New2", { preState: "proto" }) }
  ], { targetKind: "embryo", anchorSlugs: ["s1"], explorerSessionId: "explorer-9" });
  scheduler.reviewAll();
  await flush();
  assert.deepEqual(delivered, ["w-1"], "同一探索会话仅一条 proto 在途");
  assert.equal(entryStates(store)[1].state, "ready", "第二条保持 ready 待发");
  scheduler.onAgentStatus({ sessionId: "explorer-9", status: "running" });
  sessionStates.set("explorer-9", { running: false, sawRunning: true, waiting: 0 });
  scheduler.onAgentStatus({ sessionId: "explorer-9", status: "idle" });
  await flush();
  assert.deepEqual(delivered, ["w-1", "w-2"], "第一条收尾后第二条点火（串行）");
}

/* ── 6. 星胚展开：proto 收尾 → 展开非 proto 条目（grayed）并立即复查 ── */
{
  const store = makeStore();
  let expandCalls = 0;
  const { scheduler, calls } = makeScheduler({
    store,
    deliver: async (entry) => ({
      ok: true,
      sessionId: entry.targetKind === "embryo" ? entry.explorerSessionId : "s-" + entry.id
    }),
    expand: async (entry) => {
      expandCalls += 1;
      const attached = attach(store, "ignited-1", [
        { button: button("Apply", { preState: "reviewed" }) }
      ]);
      return { targets: attached.ok === true ? [{ wsId: "ws1", targetKey: "ignited-1" }] : [] };
    }
  });
  attach(store, "explorer-2", [{ button: button("New", { preState: "proto" }) }], {
    targetKind: "embryo",
    anchorSlugs: ["s1", "s2"],
    explorerSessionId: "explorer-2"
  });
  scheduler.reviewAll();
  await flush();
  const sessionId = "explorer-2";
  scheduler.onAgentStatus({ sessionId, status: "running" });
  scheduler.onAgentStatus({ sessionId, status: "idle" });
  await new Promise((done) => setImmediate(done));
  assert.equal(expandCalls, 1, "proto 收尾触发展开");
  const states = entryStates(store);
  assert.deepEqual(states.map((entry) => entry.targetKey), ["ignited-1"], "展开条目入场");
  assert.equal(states[0].state, "executing", "展开后立即复查并接力点火（Apply 门控通过）");
}

/* ── 7. 转投即完成（含重复拒绝 / 在途满 / 复验不过 / 暂停） ── */
{
  /* 7a. 转投落定 → 立即移出 */
  const store = makeStore();
  const transferred = [];
  const { scheduler, calls } = makeScheduler({
    store,
    transfer: async (entry) => {
      transferred.push(entry.button.name);
      return { ok: true, duplicate: false };
    }
  });
  attach(store, "add-q", [
    { button: button("Review", { preState: "created" }), rule: "queue" },
    { button: button("Apply", { preState: "reviewed" }), rule: "direct" }
  ]);
  scheduler.reviewTarget("ws1", "add-q");
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(transferred, ["Review"], "转投脉冲队列");
  const remaining = entryStates(store);
  assert.equal(remaining.length, 1, "转投落定即移出（曲率侧零跟踪）");
  assert.equal(remaining[0].state, "executing", "仅剩 direct 条目（Apply 已按门控点火）");

  /* 7b. 重复拒绝同样视为完成移出 */
  const duplicateStore = makeStore();
  const { scheduler: dupScheduler } = makeScheduler({
    store: duplicateStore,
    transfer: async () => ({ ok: true, duplicate: true })
  });
  attach(duplicateStore, "add-q2", [{ button: button("Review"), rule: "queue" }]);
  dupScheduler.reviewTarget("ws1", "add-q2");
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(entryStates(duplicateStore), [], "脉冲侧重复拒绝 → 曲率条目视为完成移出");

  /* 7c. 脉冲在途满 → 保持 ready 待发（下轮重试） */
  const busyStore = makeStore();
  let attempts = 0;
  const { scheduler: busyScheduler } = makeScheduler({
    store: busyStore,
    transfer: async () => {
      attempts += 1;
      return attempts === 1 ? { ok: false, reason: "limit" } : { ok: true };
    }
  });
  attach(busyStore, "add-q3", [{ button: button("Review"), rule: "queue" }]);
  busyScheduler.reviewTarget("ws1", "add-q3");
  await new Promise((done) => setImmediate(done));
  assert.equal(entryStates(busyStore)[0].state, "ready", "在途满 → 保持待发");
  busyScheduler.reviewTarget("ws1", "add-q3");
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(entryStates(busyStore), [], "下轮复查重试成功 → 移出");

  /* 7d. 转投复验不过 → skipped 残留（首次复查通过点亮，转投时刻复验失败） */
  const gateStore = makeStore();
  let gateCalls = 0;
  const { scheduler: gateScheduler } = makeScheduler({
    store: gateStore,
    gate: () => {
      gateCalls += 1;
      return gateCalls === 1 ? { ok: true } : { ok: false, reason: "prestate-drift" };
    },
    transfer: async () => ({ ok: true })
  });
  attach(gateStore, "add-q4", [{ button: button("Review", { preState: "created" }), rule: "queue" }]);
  gateScheduler.reviewTarget("ws1", "add-q4");
  await new Promise((done) => setImmediate(done));
  const skipped = entryStates(gateStore)[0];
  assert.equal(skipped.state, "skipped", "复验不过 → skipped 残留");
  assert.equal(skipped.reason, "prestate-drift");

  /* 7e. 暂停期间转投挡下（待发），继续后转投 */
  const pausedStore = makeStore();
  const pausedTransfers = [];
  const { scheduler: pausedScheduler } = makeScheduler({
    store: pausedStore,
    transfer: async (entry) => {
      pausedTransfers.push(entry.id);
      return { ok: true };
    }
  });
  pausedStore.setPaused({ wsId: "ws1", paused: true });
  attach(pausedStore, "add-q5", [{ button: button("Review"), rule: "queue" }]);
  pausedScheduler.reviewTarget("ws1", "add-q5");
  await new Promise((done) => setImmediate(done));
  assert.equal(pausedTransfers.length, 0, "暂停挡转投");
  assert.equal(entryStates(pausedStore)[0].state, "ready", "暂停期间保持 ready");
  pausedStore.setPaused({ wsId: "ws1", paused: false });
  pausedScheduler.kick("ws1");
  await new Promise((done) => setImmediate(done));
  assert.equal(pausedTransfers.length, 1, "继续后转投");
}

/* ── 8. 失败显式残留 + 失败收尾触发复查；首忙窗超时 failed ── */
{
  const store = makeStore();
  const { scheduler, calls, timers } = makeScheduler({
    store,
    deliver: async () => ({ ok: false, reason: "prompt-failed", message: "宿主拒绝" })
  });
  attach(store, "add-fail", [{ button: button("Review", { preState: "created" }) }]);
  scheduler.reviewTarget("ws1", "add-fail");
  await new Promise((done) => setImmediate(done));
  const failed = entryStates(store)[0];
  assert.equal(failed.state, "failed", "投递失败显式残留");
  assert.equal(failed.reason, "prompt-failed");
  assert.equal(store.warp("ws1").paused, false, "失败不暂停曲率队列");
  assert.equal(calls.notify.length >= 1, true, "失败 toast");
  assert.equal(timers.timers.length, 0, "投递失败不武装首忙窗定时器");

  /* 首忙窗超时：投递成功但会话从未 running → failed(busy-timeout) */
  const store2 = makeStore();
  const { scheduler: scheduler2, calls: calls2, timers: timers2 } = makeScheduler({
    store: store2,
    deliver: async () => ({ ok: true, sessionId: "never-runs" })
  });
  attach(store2, "add-timeout", [{ button: button("Review") }]);
  scheduler2.reviewTarget("ws1", "add-timeout");
  await new Promise((done) => setImmediate(done));
  const busyTimer = timers2.timers.find((timer) => timer.ms === 5000 && !timer.cleared);
  assert.ok(busyTimer, "首忙窗定时器已武装");
  busyTimer.fn();
  const timedOut = entryStates(store2)[0];
  assert.equal(timedOut.state, "failed");
  assert.equal(timedOut.reason, "busy-timeout");
  assert.equal(calls2.notify.length >= 1, true, "超时通知");
}

/* ── 9. 重启对账三态 ── */
{
  /* 9a. launching → failed(restart-lost-launch) */
  const store = makeStore();
  store.load();
  attach(store, "add-r", [{ button: button("Review") }]);
  store.patch({ wsId: "ws1", entryId: "w-1", patch: { state: "launching", startedAt: 1 } });
  const { scheduler } = makeScheduler({ store });
  await scheduler.start();
  assert.equal(entryStates(store)[0].state, "failed");
  assert.equal(entryStates(store)[0].reason, "restart-lost-launch");

  /* 9b. executing 冷读 idle → 完成收敛出队 */
  const store2 = makeStore();
  store2.load();
  attach(store2, "add-r2", [{ button: button("Review") }]);
  store2.patch({ wsId: "ws1", entryId: "w-1", patch: { state: "executing", sessionId: "s-idle" } });
  const read = [];
  const { scheduler: scheduler2 } = makeScheduler({
    store: store2,
    readSession: async (sessionId) => {
      read.push(sessionId);
      return { ok: true, running: false, waiting: 0 };
    }
  });
  await scheduler2.start();
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(entryStates(store2), [], "冷读终态 → 完成收敛");
  assert.deepEqual(read, ["s-idle"]);

  /* 9c. executing 冷读 running → 续监视；归档 → failed */
  const store3 = makeStore();
  store3.load();
  attach(store3, "add-r3", [{ button: button("Review") }]);
  store3.patch({ wsId: "ws1", entryId: "w-1", patch: { state: "executing", sessionId: "s-live" } });
  const { scheduler: scheduler3 } = makeScheduler({
    store: store3,
    readSession: async () => ({ ok: true, running: true, waiting: false })
  });
  await scheduler3.start();
  assert.equal(entryStates(store3)[0].state, "executing", "running → 续监视");
  /* 会合后 idle → 完成 */
  store3.patch({ wsId: "ws1", entryId: "w-1", patch: { state: "executing" } });
  scheduler3.onAgentStatus({ sessionId: "s-live", status: "idle" });
  assert.equal(entryStates(store3).length, 0, "续监视后运行结束 → 出队");

  const store4 = makeStore();
  store4.load();
  attach(store4, "add-r4", [{ button: button("Review") }]);
  store4.patch({ wsId: "ws1", entryId: "w-1", patch: { state: "executing", sessionId: "s-gone" } });
  const { scheduler: scheduler4 } = makeScheduler({
    store: store4,
    isArchived: (sessionId) => sessionId === "s-gone",
    readSession: async () => ({ ok: false, gone: true })
  });
  await scheduler4.start();
  assert.equal(entryStates(store4)[0].state, "failed");
  assert.equal(entryStates(store4)[0].reason, "session-gone", "归档会话 → failed");
}

/* ── 10. 骨架扫描补查：仅已有触发沿目标 ── */
{
  const store = makeStore();
  const probe = { lifecycle: "created" };
  const { scheduler } = makeScheduler({
    store,
    gate: (entry) => (
      !entry.button.preState || probe.lifecycle === entry.button.preState ? { ok: true } : { ok: false }
    ),
    deliver: async (entry) => ({ ok: true, sessionId: "s-" + entry.id })
  });
  attach(store, "add-scan", [
    { button: button("Review", { preState: "created" }) },
    { button: button("Apply", { preState: "reviewed" }) }
  ]);
  scheduler.reviewTarget("ws1", "add-scan"); // 打开触发沿（Review 点亮）
  await flush();
  probe.lifecycle = "reviewed"; // 门控条件变化但无触发沿
  scheduler.onScanChanged();
  assert.equal(entryStates(store).length, 2, "扫描补查不改变在途/置灰结构");
  /* Review 完成（触发复查被调用）→ Apply 点亮 */
  scheduler.onAgentStatus({ sessionId: "s-w-1", status: "running" });
  scheduler.onAgentStatus({ sessionId: "s-w-1", status: "idle" });
  await flush();
  assert.equal(entryStates(store).length, 1, "完成出队 + 接力");
}

/* ── 收尾 ── */
assert.equal(WARP_CONCURRENCY_LIMIT, 3, "并发上限常量 = 3（spec 定稿）");
console.log("warp-scheduler-smoke: all assertions passed");
