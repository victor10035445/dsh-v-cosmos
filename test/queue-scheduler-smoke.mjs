/**
 * 队列调度器冒烟（add-cosmos-action-queue 3.4）：状态机全迁移路径直测。
 *  - 正常完成出队并前进 / 提问挂起→决策→完成 / 首忙超窗 / 执行时刻复验跳过
 *  - 投递失败暂停 / 暂停挡 advance 不碰在途 / 429 有界重试 / 单飞
 *  - 重启对账三分支（launching→failed、running 续监视、会话消失 failed 继续、归档零请求）
 *  - 投递期事件先到（快回合不漏判）
 * 运行：node test/queue-scheduler-smoke.mjs
 */
import assert from "node:assert/strict";
import { createQueueStore } from "../src/queue-store.mjs";
import { createQueueScheduler, FIRST_BUSY_WINDOW_MS, COLD_RETRY_MS } from "../src/queue-scheduler.mjs";

const NOW = 1_700_000_000_000;
const WS = "ws-1";
const button = (name = "B1") => ({ name, prompt: "prompt " + name, autoSend: false, newSession: true });

/** 假时钟 + 定时器。 */
function makeClock() {
  let clock = NOW;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => clock,
    setTimeout: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { at: clock + Math.max(0, Number(ms) || 0), fn });
      return { id, unref() {} };
    },
    clearTimeout: (timer) => {
      if (timer && typeof timer === "object" && "id" in timer) timers.delete(timer.id);
    },
    async advance(ms) {
      const target = clock + ms;
      for (;;) {
        let next = null;
        for (const [id, timer] of timers) {
          if (timer.at > target) continue;
          if (next === null || timer.at < next.timer.at) next = { id, timer };
        }
        if (next === null) break;
        timers.delete(next.id);
        clock = Math.max(clock, next.timer.at);
        next.timer.fn();
        await flush();
      }
      clock = target;
    },
    get size() {
      return timers.size;
    }
  };
}

const flush = async () => {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
};

/** 造 store（内存写）。 */
function makeStore() {
  let seq = 0;
  return createQueueStore({
    filePath: "mem://queues",
    read: () => null,
    write: () => {},
    now: () => NOW,
    idFactory: () => `q-${++seq}`
  });
}

/** 造可控投递器。 */
function makeDeliver() {
  const calls = [];
  const pending = [];
  return {
    calls,
    deliver: (entry) => new Promise((resolve) => {
      calls.push(entry);
      pending.push(resolve);
    }),
    resolveNext(value) {
      const resolve = pending.shift();
      assert.ok(resolve, "没有待投递调用");
      resolve(value);
      return flush();
    },
    rejectNext(error) {
      const resolve = pending.shift();
      resolve(Promise.reject(error).catch((failure) => { throw failure; }));
      return flush();
    },
    get pendingCount() {
      return pending.length;
    }
  };
}

/** 造调度器（缺省依赖 + 可覆盖）。 */
function makeScheduler(overrides = {}) {
  const store = overrides.store ?? makeStore();
  const clock = overrides.clock ?? makeClock();
  const deliverBox = overrides.deliverBox ?? makeDeliver();
  const events = { changes: 0, notices: [] };
  const scheduler = createQueueScheduler({
    store,
    deliver: deliverBox.deliver,
    readSession: overrides.readSession ?? (async () => ({ ok: true, running: false, waiting: false })),
    reverify: overrides.reverify ?? (async () => ({ ok: true })),
    isArchived: overrides.isArchived ?? (() => false),
    onChange: () => { events.changes += 1; },
    notify: (message, isError) => { events.notices.push({ message, isError }); },
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout
  });
  return { store, clock, deliverBox, scheduler, events };
}

const enqueue = (store, name, overrides = {}) => {
  const result = store.enqueue({
    wsId: WS,
    proposalId: overrides.proposalId ?? "add-a",
    proposalDir: "C:/ws/openspec/changes/add-a",
    button: button(name)
  });
  assert.equal(result.ok, true, `入队 ${name}`);
  return result.entry;
};

/* ── 1. 正常完成：投递 → running → idle → 出队并启动下一条 ── */
{
  const { store, deliverBox, scheduler, clock } = makeScheduler();
  const first = enqueue(store, "B1");
  enqueue(store, "B2");
  scheduler.kick(WS);
  await flush();
  assert.equal(deliverBox.calls.length, 1, "启动队首投递");
  assert.equal(store.find(WS, first.id).state, "launching", "投递中 launching");
  await deliverBox.resolveNext({ ok: true, sessionId: "s-1" });
  assert.equal(store.find(WS, first.id).state, "executing", "投递成功 → executing");
  assert.deepEqual(scheduler.activityOf(WS, store.find(WS, first.id)), { running: false, waiting: 0 }, "尚未 busy 子态");
  scheduler.onAgentStatus({ sessionId: "s-1", status: "running" });
  assert.deepEqual(scheduler.activityOf(WS, store.find(WS, first.id)), { running: true, waiting: 0 }, "running 子态");
  assert.equal(deliverBox.calls.length, 1, "执行中不启动下一条（单飞）");
  scheduler.onAgentStatus({ sessionId: "s-1", status: "idle" });
  await flush();
  assert.equal(store.find(WS, first.id), null, "完成即出队");
  assert.equal(deliverBox.calls.length, 2, "完成后启动下一条");
  assert.equal(store.counts(WS).executing + store.counts(WS).launching, 1, "仍只有一条在途");
  scheduler.dispose();
  void clock;
}

/* ── 2. 提问挂起 → 决策 → 完成（等待决策子态挂起队列） ── */
{
  const { store, deliverBox, scheduler } = makeScheduler();
  const entry = enqueue(store, "B1");
  enqueue(store, "B2");
  scheduler.kick(WS);
  await flush();
  await deliverBox.resolveNext({ ok: true, sessionId: "s-2" });
  scheduler.onAgentStatus({ sessionId: "s-2", status: "running" });
  scheduler.interactionEnter("s-2");
  assert.equal(scheduler.activityOf(WS, store.find(WS, entry.id)).waiting, 1, "进入等待决策");
  scheduler.onAgentStatus({ sessionId: "s-2", status: "idle" });
  assert.notEqual(store.find(WS, entry.id), null, "等待决策不算完成（还挂在队列里）");
  assert.equal(deliverBox.calls.length, 1, "挂起期间不前进");
  /* 用户决策 → 回合继续跑（真实时序：等待期间回合阻塞、仍 running；决策后继续到 idle） */
  scheduler.onAgentStatus({ sessionId: "s-2", status: "running" });
  scheduler.interactionExit("s-2");
  await flush();
  assert.notEqual(store.find(WS, entry.id), null, "决策后回合未跑完不算完成");
  scheduler.onAgentStatus({ sessionId: "s-2", status: "idle" });
  assert.equal(store.find(WS, entry.id), null, "回合跑完 → 完成出队");
  scheduler.dispose();
}

/* ── 3. 首忙超窗 → 投递异常 failed + 暂停 ── */
{
  const { store, deliverBox, scheduler, clock, events } = makeScheduler();
  const entry = enqueue(store, "B1");
  enqueue(store, "B2");
  scheduler.kick(WS);
  await flush();
  await deliverBox.resolveNext({ ok: true, sessionId: "s-3" });
  await clock.advance(FIRST_BUSY_WINDOW_MS - 1000);
  assert.equal(store.find(WS, entry.id).state, "executing", "窗内保持执行中");
  await clock.advance(2000);
  const failed = store.find(WS, entry.id);
  assert.equal(failed.state, "failed", "超窗 → failed");
  assert.equal(failed.reason, "busy-timeout", "失败原因 = 投递异常");
  assert.equal(store.queue(WS).paused, true, "队列暂停");
  assert.equal(deliverBox.calls.length, 1, "失败后不启动下一条");
  assert.equal(events.notices.at(-1)?.isError, true, "toast 提示（错误色）");
  scheduler.dispose();
}

/* ── 4. 执行时刻复验不过 → skipped 并继续下一条 ── */
{
  const { store, deliverBox, scheduler } = makeScheduler({
    reverify: async (entry) => (entry.button.name === "B1" ? { ok: false, reason: "prestate-drift" } : { ok: true })
  });
  const first = enqueue(store, "B1");
  const second = enqueue(store, "B2");
  scheduler.kick(WS);
  await flush();
  await flush();
  assert.equal(store.find(WS, first.id).state, "skipped", "复验不过 → skipped");
  assert.equal(store.find(WS, first.id).message.includes("跳过"), true, "带可见说明");
  assert.equal(deliverBox.calls.length, 1, "跳过不投递，直接下一条");
  assert.equal(deliverBox.calls[0].id, second.id, "投递的是下一条");
  scheduler.dispose();
}

/* ── 5. 投递失败 → failed + 暂停 + 原因透出 ── */
{
  const { store, deliverBox, scheduler, events } = makeScheduler();
  const entry = enqueue(store, "B1");
  enqueue(store, "B2");
  scheduler.kick(WS);
  await flush();
  await deliverBox.resolveNext({ ok: false, reason: "queen-unconfigured", message: "未配置 queen token" });
  const failed = store.find(WS, entry.id);
  assert.equal(failed.state, "failed", "投递失败 → failed");
  assert.equal(failed.reason, "queen-unconfigured", "原因透出");
  assert.equal(failed.message, "未配置 queen token", "说明透出");
  assert.equal(store.queue(WS).paused, true, "队列暂停");
  assert.equal(deliverBox.calls.length, 1, "不启动下一条");
  assert.equal(events.notices.length, 1, "toast 提示");
  scheduler.dispose();
}

/* ── 6. 暂停挡 advance 不碰在途；继续后立即启动 ── */
{
  const { store, deliverBox, scheduler } = makeScheduler();
  const first = enqueue(store, "B1");
  enqueue(store, "B2");
  scheduler.kick(WS);
  await flush();
  await deliverBox.resolveNext({ ok: true, sessionId: "s-6" });
  store.setPaused({ wsId: WS, paused: true });
  scheduler.onAgentStatus({ sessionId: "s-6", status: "running" });
  scheduler.onAgentStatus({ sessionId: "s-6", status: "idle" });
  assert.equal(store.find(WS, first.id), null, "暂停不拦截在途条目的收尾");
  assert.equal(deliverBox.calls.length, 1, "暂停期间不启动下一条");
  store.setPaused({ wsId: WS, paused: false });
  scheduler.kick(WS);
  await flush();
  assert.equal(deliverBox.calls.length, 2, "继续后立即启动队首");
  scheduler.dispose();
}

/* ── 7. 429 有界重试后成功 ── */
{
  const { store, deliverBox, scheduler, clock } = makeScheduler();
  enqueue(store, "B1");
  scheduler.kick(WS);
  await flush();
  await deliverBox.resolveNext({ ok: false, reason: "queen-rate-limited", retryAfterMs: 1200, message: "rate" });
  assert.equal(deliverBox.calls.length, 1, "先失败等待重试");
  assert.equal(store.queue(WS).entries[0].state, "launching", "重试窗内保持 launching");
  await clock.advance(1300);
  assert.equal(deliverBox.calls.length, 2, "retry-after 后重试投递");
  await deliverBox.resolveNext({ ok: true, sessionId: "s-7" });
  assert.equal(store.queue(WS).entries[0].state, "executing", "重试成功 → executing");
  scheduler.dispose();
}

/* ── 8. 单飞：并发 kick 只投递一次 ── */
{
  const { store, deliverBox, scheduler } = makeScheduler();
  enqueue(store, "B1");
  enqueue(store, "B2");
  scheduler.kick(WS);
  await flush();
  scheduler.kick(WS);
  await flush();
  scheduler.kick(WS);
  await flush();
  assert.equal(deliverBox.calls.length, 1, "并发 kick 只占位一次");
  await deliverBox.resolveNext({ ok: true, sessionId: "s-8" });
  scheduler.onAgentStatus({ sessionId: "s-8", status: "running" });
  scheduler.onAgentStatus({ sessionId: "s-8", status: "idle" });
  await flush();
  assert.equal(deliverBox.calls.length, 2, "完成后才取下一条");
  scheduler.dispose();
}

/* ── 9. 投递期事件先到（快回合）→ 不漏判 ── */
{
  const { store, deliverBox, scheduler } = makeScheduler();
  const entry = enqueue(store, "B1");
  scheduler.kick(WS);
  await flush();
  /* 事件先于投递响应到达（会话 id 已知：queen 先建会话再回复）。 */
  scheduler.onAgentStatus({ sessionId: "s-9", status: "running" });
  scheduler.onAgentStatus({ sessionId: "s-9", status: "idle" });
  await deliverBox.resolveNext({ ok: true, sessionId: "s-9" });
  assert.equal(store.find(WS, entry.id), null, "回合已跑完 → 立即完成出队");
  scheduler.dispose();
}

/* ── 10. 重启对账三分支 ── */
{
  /* 共用 store：先造出 pending 现场，再新建调度器模拟重启载入。 */
  const store = makeStore();
  const first = enqueue(store, "B1");
  const second = enqueue(store, "B2");
  const third = enqueue(store, "B3");
  store.patch({ wsId: WS, entryId: first.id, patch: { state: "launching", startedAt: NOW } });
  store.patch({ wsId: WS, entryId: second.id, patch: { state: "executing", sessionId: "s-run" } });
  store.patch({ wsId: WS, entryId: third.id, patch: { state: "executing", sessionId: "s-gone" } });
  const reads = [];
  const clock = makeClock();
  const deliverBox = makeDeliver();
  const scheduler = createQueueScheduler({
    store,
    deliver: deliverBox.deliver,
    readSession: async (sessionId) => {
      reads.push(sessionId);
      if (sessionId === "s-run") return { ok: true, running: true, waiting: false };
      if (sessionId === "s-gone") return { ok: false, gone: true };
      return { ok: true, running: false, waiting: false };
    },
    isArchived: () => false,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout
  });
  await scheduler.start();
  assert.equal(store.find(WS, first.id).state, "failed", "launching 未取得 sessionId → failed");
  assert.equal(store.find(WS, first.id).reason, "restart-lost-launch", "failed 原因");
  assert.equal(store.find(WS, second.id).state, "executing", "running → 续监视");
  assert.equal(store.find(WS, third.id).state, "failed", "会话消失 → failed");
  assert.equal(store.find(WS, third.id).reason, "session-gone", "会话消失原因");
  assert.equal(scheduler.sessionStateOf("s-run").running, true, "冷读 running 入缓存");
  /* 会话消失**不暂停**；launching 失败**不暂停**（spec：重启对账不自动暂停） */
  assert.equal(store.queue(WS).paused, false, "重启对账不自动暂停");
  /* running 续监视：后续 idle → 完成 */
  scheduler.onAgentStatus({ sessionId: "s-run", status: "idle" });
  assert.equal(store.find(WS, second.id), null, "续监视后完成出队");
  scheduler.dispose();
  assert.equal(reads.includes("s-gone"), true, "冷读确实发过请求");
}

/* ── 11. 归档会话零请求 → failed 继续 ── */
{
  const store = makeStore();
  const entry = enqueue(store, "B1");
  enqueue(store, "B2");
  store.patch({ wsId: WS, entryId: entry.id, patch: { state: "executing", sessionId: "s-arch" } });
  let reads = 0;
  const clock = makeClock();
  const deliverBox = makeDeliver();
  const scheduler = createQueueScheduler({
    store,
    deliver: deliverBox.deliver,
    readSession: async () => { reads += 1; return { ok: true, running: false, waiting: false }; },
    isArchived: (sessionId) => sessionId === "s-arch",
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout
  });
  await scheduler.start();
  assert.equal(reads, 0, "归档判定先行（零冷读请求）");
  assert.equal(store.find(WS, entry.id).state, "failed", "归档 → failed");
  assert.equal(store.find(WS, entry.id).reason, "session-gone", "归档原因");
  assert.equal(deliverBox.calls.length, 1, "队列继续下一条（不暂停）");
  scheduler.dispose();
}

/* ── 12. 冷读不可用 → 保持 executing 并稍后重试 ── */
{
  const store = makeStore();
  const entry = enqueue(store, "B1");
  store.patch({ wsId: WS, entryId: entry.id, patch: { state: "executing", sessionId: "s-retry" } });
  const clock = makeClock();
  let calls = 0;
  const scheduler = createQueueScheduler({
    store,
    deliver: async () => ({ ok: true, sessionId: "s-retry" }),
    readSession: async () => {
      calls += 1;
      return calls === 1 ? { ok: false, error: "queen unreachable" } : { ok: true, running: false, waiting: false };
    },
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout
  });
  await scheduler.start();
  assert.equal(store.find(WS, entry.id).state, "executing", "冷读失败 → 保持 executing（不误判）");
  await clock.advance(COLD_RETRY_MS + 10);
  assert.equal(calls, 2, "冷读重试");
  assert.equal(store.find(WS, entry.id), null, "重试拿到终态 → 完成收敛");
  scheduler.dispose();
}

/* ── 13. 等待决策冷读回填（重启时 pending） ── */
{
  const store = makeStore();
  const entry = enqueue(store, "B1");
  store.patch({ wsId: WS, entryId: entry.id, patch: { state: "executing", sessionId: "s-wait" } });
  const clock = makeClock();
  const scheduler = createQueueScheduler({
    store,
    deliver: async () => ({ ok: true, sessionId: "s-wait" }),
    readSession: async () => ({ ok: true, running: false, waiting: true }),
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout
  });
  await scheduler.start();
  assert.notEqual(store.find(WS, entry.id), null, "等待决策挂起（冷读后不误判完成）");
  assert.deepEqual(scheduler.activityOf(WS, store.find(WS, entry.id)), { running: false, waiting: 1 }, "等待决策子态回填");
  scheduler.interactionExit("s-wait");
  assert.equal(store.find(WS, entry.id), null, "决策完成后（running=false ∧ 无待决策）→ 完成");
  scheduler.dispose();
}

/* ── 14. 冷读永久失败 → 立即显式 failed（不无限锁定 executing） ── */
{
  const store = makeStore();
  const entry = enqueue(store, "B1");
  enqueue(store, "B2");
  store.patch({ wsId: WS, entryId: entry.id, patch: { state: "executing", sessionId: "s-dead" } });
  const clock = makeClock();
  const deliverBox = makeDeliver();
  const scheduler = createQueueScheduler({
    store,
    deliver: deliverBox.deliver,
    readSession: async () => ({ ok: false, error: "queen token 无效", permanent: true }),
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout
  });
  await scheduler.start();
  await flush();
  assert.equal(store.find(WS, entry.id).state, "failed", "永久性冷读失败 → failed");
  assert.equal(store.find(WS, entry.id).reason, "cold-read-unavailable", "失败原因");
  assert.equal(store.queue(WS).paused, false, "不暂停（与 session-gone 同口径）");
  assert.equal(deliverBox.calls.length, 1, "队列继续下一条");
  scheduler.dispose();
}

/* ── 15. 冷读临时失败重试耗尽 → 显式 failed ── */
{
  const store = makeStore();
  const entry = enqueue(store, "B1");
  store.patch({ wsId: WS, entryId: entry.id, patch: { state: "executing", sessionId: "s-flaky" } });
  const clock = makeClock();
  let attempts = 0;
  const scheduler = createQueueScheduler({
    store,
    deliver: async () => ({ ok: true, sessionId: "s-flaky" }),
    readSession: async () => {
      attempts += 1;
      return { ok: false, error: "timeout" };
    },
    coldReadMaxAttempts: 2,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout
  });
  await scheduler.start();
  assert.equal(attempts, 1, "首次冷读失败保持 executing");
  await clock.advance(COLD_RETRY_MS + 10);
  assert.equal(attempts, 2, "重试一次");
  assert.equal(store.find(WS, entry.id).state, "failed", "尝试耗尽 → 显式 failed（不永久锁定）");
  assert.equal(store.find(WS, entry.id).reason, "cold-read-unavailable", "耗尽原因");
  scheduler.dispose();
}

console.log("queue-scheduler-smoke: all assertions passed");
