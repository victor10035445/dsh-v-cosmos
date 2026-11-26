/**
 * 团队意图宿主半区冒烟（add-cosmos-agent-team-toggle 3.1–3.6 / spec
 * cosmos-agent-team-toggle「团队意图登记端点」「宿主 agent-created 消费挂点」
 * 「意图生命周期与易失性」「星胚路径两相消费」「服务缺席降级」「只启用与幂等」）。
 *
 * 覆盖：
 *  ① 意图集合纯逻辑：幂等 arm / 一次性 consume / TTL 惰性清除 / 非法 id 零状态；
 *  ② 宿主接线（stub ctx 直调 apply → 捕获 `/api/dsh-v-cosmos/team-intent` handler）：
 *     非法请求零状态、即时消费（live root agent）、意图保留 + `agent/created` 一次性消费、
 *     子代理事件不消费、消费抛错自吞且意图已清（不重复）、服务缺席降级（端点恒
 *     serviceAvailable:false 且订阅不注册）；
 *  ③ 曲率 proto 直投：`entry.button.team === true` 时投递前调用团队启用服务，抛错不阻断投递。
 *
 * 运行：node test/team-intent-smoke.mjs
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEAM_INTENT_TTL_MS, createTeamIntentStore } from "../src/team-intent.mjs";
import { apply } from "../src/index.mjs";
import { createWarpProtoDeliverer } from "../src/session-executor.mjs";

const API = "/api/dsh-v-cosmos";

/* ══ 1. 意图集合纯逻辑（3.1） ══ */
{
  let clock = 1000;
  const store = createTeamIntentStore({ now: () => clock, ttlMs: 5000 });
  assert.equal(store.arm(" s1 ").sessionId, "s1", "arm 归一化 id");
  assert.equal(store.arm("s1").armedAt, 1000);
  clock = 1500;
  assert.equal(store.arm("s1").armedAt, 1500, "同 sessionId 重复 arm 刷新时间戳（幂等）");
  assert.equal(store.size(), 1, "不产生重复条目");
  assert.equal(store.has("s1"), true);
  assert.deepEqual(store.consume(" s1 "), { sessionId: "s1", armedAt: 1500 }, "consume 命中即删（trim 口径）");
  assert.equal(store.consume("s1"), null, "一次性消费：第二次未命中");
  assert.equal(store.size(), 0);
  assert.equal(store.arm("   "), null, "空 id → null（零状态变化）");
  assert.equal(store.arm(null), null);
  assert.equal(store.consume(""), null);

  /* TTL 惰性清除：超过 ttlMs 才过期（恰等仍在窗内）。 */
  clock = 2000;
  store.arm("s2");
  clock = 2000 + 5000;
  assert.equal(store.has("s2"), true, "恰好 TTL 边界仍在窗内（> 才过期）");
  clock = 2001 + 5000;
  assert.equal(store.has("s2"), false, "超过 TTL → 惰性清除");
  store.arm("s3");
  clock += 5001;
  assert.equal(store.consume("s3"), null, "过期意图不被消费");
  assert.equal(store.size(), 0, "过期意图已被清除");

  /* TTL 常量与注入兜底。 */
  assert.equal(TEAM_INTENT_TTL_MS, 30 * 60 * 1000, "TTL 缺省 30 分钟");
  assert.equal(createTeamIntentStore({ now: () => 0 }).ttlMs, TEAM_INTENT_TTL_MS, "缺省 TTL 取常量");
  for (const bad of [0, -1, NaN, "x", null]) {
    assert.equal(
      createTeamIntentStore({ now: () => 0, ttlMs: bad }).ttlMs,
      TEAM_INTENT_TTL_MS,
      "非法 ttlMs 回落缺省：" + String(bad)
    );
  }
  const clearable = createTeamIntentStore({ now: () => 0 });
  clearable.arm("x");
  clearable.clear();
  assert.equal(clearable.size(), 0, "clear 清空（测试/卸载用）");
}

/* ══ 夹具：隔离 DSH_HOME + stub ctx ══ */
const home = mkdtempSync(join(tmpdir(), "dsh-cosmos-team-home-"));
process.env.DSH_HOME = home;

/** 事件监听捕获 + agent/created 挂点探针（与真实 Cordis ctx.on 同形）。 */
function makeCtx({ team = null } = {}) {
  const listeners = new Map();
  const calls = { setEnabled: [] };
  const liveAgents = new Map();
  const capture = { handler: null };
  const ctx = {
    logger: { warn() {} },
    effect(fn) {
      const disposer = fn();
      return disposer;
    },
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(listener);
      return () => {
        const list = listeners.get(event);
        const index = list.indexOf(listener);
        if (index >= 0) list.splice(index, 1);
        return index >= 0;
      };
    },
    webServer: {
      register(definition) {
        capture.handler = definition.handler;
        return () => {};
      }
    },
    workspaceRegistry: { list: () => [], archivedSessionIds: [] },
    agents: { get: (id) => liveAgents.get(id) ?? null },
    sessions: {},
    sessionController: {},
    /* 可选服务查找面：仅 agentTeams 可选（缺席 → undefined，触发探测式降级）。 */
    get: (name) => (name === "agentTeams" ? team ?? undefined : undefined)
  };
  return { ctx, listeners, calls, liveAgents, capture };
}

/** 构造 root / subagent 假 agent（`isRootAgent` 只看 header.origin）。 */
function fakeAgent(id, origin = "user") {
  return { id, session: { id, header: { id, origin } } };
}

/** JSON 响应捕获 / 带体请求桩（handler 以 `for await (const chunk of req)` 读体）。 */
function captureJson() {
  const state = { status: 0, body: null, res: null };
  state.res = {
    writeHead(status) {
      state.status = status;
    },
    write() {},
    end(chunk) {
      try {
        state.body = JSON.parse(String(chunk ?? ""));
      } catch {
        state.body = null;
      }
    },
    on() {}
  };
  return state;
}

async function post(handler, url, body) {
  const state = captureJson();
  const raw = JSON.stringify(body ?? {});
  const req = {
    method: "POST",
    url,
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(raw, "utf8");
    }
  };
  await handler(req, state.res);
  return state;
}

/** 等待事件监听器（async listener）落地。 */
const settle = () => new Promise((done) => setTimeout(done, 0));

try {
  /* ══ 2. 服务在册：端点 + agent/created 消费（3.2–3.4） ══ */
  {
    const calls = { setEnabled: [] };
    let failNext = false;
    const team = {
      async setEnabled(agent, enabled) {
        calls.setEnabled.push({ id: agent?.id, enabled, origin: agent?.session?.header?.origin });
        if (failNext) {
          failNext = false;
          throw new Error("TEAM_LEAD_REQUIRED: change Team mode from the root Session");
        }
      }
    };
    const { ctx, listeners, liveAgents, capture } = makeCtx({ team });
    apply(ctx, {});
    assert.equal(typeof capture.handler, "function", "webServer 端点已注册");
    assert.equal((listeners.get("agent/created") ?? []).length, 1, "服务在册 → agent/created 订阅已注册");
    const created = listeners.get("agent/created")[0];

    /* 非法请求：缺 sessionId / 非字符串 / 空串 → 400 {ok:false}，零状态变化。 */
    for (const body of [{}, { sessionId: 42 }, { sessionId: "   " }, { sessionId: null }]) {
      const invalid = await post(capture.handler, API + "/team-intent", body);
      assert.equal(invalid.status, 400, "非法请求 400：" + JSON.stringify(body));
      assert.equal(invalid.body?.ok, false, "非法请求 ok:false");
      assert.equal(invalid.body?.serviceAvailable, true, "服务在册 → serviceAvailable:true");
    }
    /* 非法请求未登记意图：随后的 root agent 事件不触发任何 setEnabled。 */
    liveAgents.set("s-ghost", fakeAgent("s-ghost"));
    await created({ agent: liveAgents.get("s-ghost") });
    assert.equal(calls.setEnabled.length, 0, "非法请求零状态变化（无留意图 → 事件不触发启用）");

    /* 即时消费：目标会话已有 live root agent（创建后即发布的 blank agent 场景）。 */
    liveAgents.set("s-live", fakeAgent("s-live"));
    const immediate = await post(capture.handler, API + "/team-intent", { sessionId: "s-live" });
    assert.equal(immediate.status, 200);
    assert.deepEqual(
      immediate.body,
      { ok: true, serviceAvailable: true, immediate: true, armed: false },
      "live root agent → 即时消费、不保留意图"
    );
    assert.deepEqual(calls.setEnabled, [{ id: "s-live", enabled: true, origin: "user" }], "setEnabled(agent, true) 一次");

    /* 即时消费失败（抛错）→ 保留意图：事件到来时消费。 */
    liveAgents.set("s-retry", fakeAgent("s-retry"));
    failNext = true;
    const failedImmediate = await post(capture.handler, API + "/team-intent", { sessionId: "s-retry" });
    assert.equal(failedImmediate.body.ok, true, "即时失败 → 意图已登记（ok:true）");
    assert.equal(failedImmediate.body.immediate, false);
    assert.equal(failedImmediate.body.armed, true);
    assert.equal(calls.setEnabled.length, 2, "即时尝试已发生（抛错被吞）");
    await created({ agent: liveAgents.get("s-retry") });
    assert.deepEqual(calls.setEnabled.at(-1), { id: "s-retry", enabled: true, origin: "user" }, "兜底消费启用");

    /* 无 live agent：意图保留 → 之后根 agent 创建时一次性消费。 */
    const pending = await post(capture.handler, API + "/team-intent", { sessionId: "s-pending" });
    assert.deepEqual(
      pending.body,
      { ok: true, serviceAvailable: true, immediate: false, armed: true },
      "无 live agent → 保留意图"
    );
    const before = calls.setEnabled.length;
    await created({ agent: fakeAgent("s-pending") });
    assert.equal(calls.setEnabled.length, before + 1, "agent/created 命中意图 → 启用一次");
    assert.deepEqual(calls.setEnabled.at(-1), { id: "s-pending", enabled: true, origin: "user" });
    /* 一次性消费：同一会话后续 agent 重建不再触发。 */
    await created({ agent: fakeAgent("s-pending") });
    assert.equal(calls.setEnabled.length, before + 1, "一次性消费：后续重建不再启用");

    /* 子代理（origin=subagent）不消费意图：意图保留，根 agent 到达时仍生效。 */
    const sub = await post(capture.handler, API + "/team-intent", { sessionId: "s-sub" });
    assert.equal(sub.body.armed, true, "子会话目标先保留意图");
    const subBefore = calls.setEnabled.length;
    await created({ agent: fakeAgent("s-sub", "subagent") });
    assert.equal(calls.setEnabled.length, subBefore, "origin=subagent → 不调用 setEnabled");
    await created({ agent: fakeAgent("s-sub", "user") });
    assert.equal(calls.setEnabled.length, subBefore + 1, "根 agent 到达后消费（意图未被子代理事件吃掉）");

    /* 消费抛错：一次性清除且 listener 不抛（announce 不被拒绝）。 */
    const failPending = await post(capture.handler, API + "/team-intent", { sessionId: "s-fail" });
    assert.equal(failPending.body.armed, true);
    failNext = true;
    await created({ agent: fakeAgent("s-fail") });
    const failCalls = calls.setEnabled.length;
    await created({ agent: fakeAgent("s-fail") });
    assert.equal(calls.setEnabled.length, failCalls, "消费抛错后意图已清（不重复尝试）");

    /* 异常载荷自吞（agent.id 非字符串 / 无 agent）：listener 不抛。 */
    await created({ agent: { id: 7 } });
    await created({});
    await created(null);

    /* 卸载：清理函数摘除订阅（不残留监听）。 */
    // apply 返回的清理函数未在此处保存；以监听表断言 apply 期间仅一条订阅即可。
    assert.equal((listeners.get("agent/created") ?? []).length, 1, "订阅数量稳定（不重复注册）");
  }

  /* ══ 3. 服务缺席降级（3.3 / spec「服务缺席降级」） ══ */
  {
    const { ctx, listeners, capture } = makeCtx({ team: null });
    apply(ctx, {});
    assert.equal(typeof capture.handler, "function", "服务缺席：端点照常注册（恒回 serviceAvailable:false）");
    assert.equal(listeners.get("agent/created"), undefined, "服务缺席：agent/created 订阅不注册");
    const response = await post(capture.handler, API + "/team-intent", { sessionId: "s-any" });
    assert.equal(response.status, 200, "服务缺席：端点 200（可判读）");
    assert.deepEqual(response.body, { ok: false, serviceAvailable: false }, "服务缺席：恒 {ok:false, serviceAvailable:false}");
    /* 非法请求在服务缺席时同样按缺席响应（零状态、零启用）。 */
    const invalid = await post(capture.handler, API + "/team-intent", {});
    assert.deepEqual(invalid.body, { ok: false, serviceAvailable: false }, "服务缺席先于请求形态判定");
  }

  /* ══ 4. 曲率 proto 直投的团队启用（3.5 / spec「曲率直投已运行会话即时启用」） ══ */
  {
    const order = [];
    const promptCalls = [];
    const sessionController = {
      async prompt(request) {
        promptCalls.push(request);
        order.push("prompt");
      }
    };
    const baseEntry = {
      explorerSessionId: "s-explore",
      anchorSlugs: ["demo"],
      button: { name: "推进", prompt: "继续探索", team: true }
    };
    const deliver = createWarpProtoDeliverer({
      sessionController,
      enableTeam: async (sessionId) => {
        order.push("team:" + sessionId);
      }
    });
    const result = await deliver(baseEntry);
    assert.equal(result.ok, true, "团队条目投递成功");
    assert.deepEqual(order, ["team:s-explore", "prompt"], "团队启用先于 prompt");

    /* 未勾选团队：零团队调用（未勾选零行为）。 */
    order.length = 0;
    const plain = await deliver({ ...baseEntry, button: { name: "推进", prompt: "继续探索" } });
    assert.equal(plain.ok, true);
    assert.deepEqual(order, ["prompt"], "未勾选 team → 不调用团队启用");

    /* 团队服务抛错：投递照常完成（失败不阻断投递链）。 */
    order.length = 0;
    const failing = createWarpProtoDeliverer({
      sessionController,
      enableTeam: async () => {
        order.push("team");
        throw new Error("team unavailable");
      }
    });
    const stillOk = await failing(baseEntry);
    assert.equal(stillOk.ok, true, "团队启用抛错不阻断投递");
    assert.deepEqual(order, ["team", "prompt"], "抛错后仍继续 prompt");
    assert.equal(promptCalls.length, 3);
  }
} finally {
  rmSync(home, { recursive: true, force: true });
}

console.log("team-intent-smoke: all assertions passed");
