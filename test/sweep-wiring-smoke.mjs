/**
 * 会话扫尾宿主接线冒烟（add-cosmos-archive-session-sweep 3.1 / spec cosmos-archive-sweep）：
 * stub ctx（mock workspaceRegistry / sessions / ctx.get('sessionTitle')）直调 apply()，
 * 验证两个扫尾端点的接线语义——依次串行次序、活动瀑布拒绝映射、已归档预过滤幂等、
 * 404/503 路径（含 sessionTitle 缺席 → 503 且插件整体可用）、400/500 兜底。
 * 运行：node test/sweep-wiring-smoke.mjs
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply, inject } from "../src/index.mjs";

/* ── 注入声明（design D9）：sessions 恒在 → inject；sessionTitle 可选 → 绝不入 inject ── */
assert.ok(inject.includes("sessions"), "sessions（核心服务）入 inject");
assert.ok(!inject.includes("sessionTitle"), "sessionTitle MUST NOT 入 inject（否则未挂载部署整体停摆）");
assert.ok(inject.includes("workspaceRegistry") && inject.includes("webServer"), "既有注入不变");

const storageHome = mkdtempSync(join(tmpdir(), "dsh-cosmos-sweep-home-"));
process.env.DSH_HOME = storageHome;

/** 宿主错误构造（name 是官方包的身份字段）。 */
function hostError(name, message, extra = {}) {
  return Object.assign(new Error(message), { name, ...extra });
}

try {
  /* ── 会话面夹具 ── */
  const liveSessions = new Map(); // sessionId → 活会话对象（identity 参与 rename 校验）
  const seededSessions = ["idle-1", "busy-1", "done-1", "gone-1", "boom-1", "self-1", "titled-1"];
  for (const id of seededSessions) liveSessions.set(id, { id, snapshotEvents: () => [] });

  let archived = new Set(["done-1"]);
  const archiveCalls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const activeIds = new Set(["busy-1"]);
  const unknownIds = new Set(["gone-1"]);
  const failingIds = new Set(["boom-1"]);

  /** 标题服务桩（get/rename 与官方契约同形）。 */
  const titles = {
    current: new Map([
      ["idle-1", "空闲会话"],
      ["busy-1", "忙碌会话"],
      ["self-1", "归档提案的会话"],
      ["titled-1", "已归档-已带前缀"]
    ]),
    renameCalls: [],
    get(session) {
      return this.current.has(session.id) ? { title: this.current.get(session.id), source: "user" } : undefined;
    },
    rename(session, title) {
      if (this.current.get(session.id) === title) throw new Error("renamed title failed to fold");
      this.renameCalls.push({ sessionId: session.id, title });
      this.current.set(session.id, title);
      return { title, eventSeq: this.renameCalls.length };
    }
  };
  let titlesMounted = true;
  let renameThrows = false;

  const ctx = {
    logger: { warn() {} },
    effect(fn) {
      return fn();
    },
    webServer: {
      register(def) {
        handler = def.handler;
        return () => {};
      }
    },
    workspaceRegistry: {
      list: () => [],
      get archivedSessionIds() {
        return archived;
      },
      async archiveSession(sessionId, options) {
        archiveCalls.push({ sessionId, argumentCount: arguments.length, options });
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        try {
          await sleep(5); // 拉开窗口：并发实现会被 maxInFlight 抓到
          if (archived.has(sessionId)) return; // 宿主语义：已归档 id 不询问直接 resolve
          if (unknownIds.has(sessionId)) {
            throw hostError(
              "WorkspaceUnknownSessionError",
              `cannot archive session '${sessionId}': live sessions and session persistence hold no such session`,
              { sessionId }
            );
          }
          if (activeIds.has(sessionId)) {
            throw hostError("WorkspaceActiveSessionError", `cannot archive session '${sessionId}': the session is active (job)`, {
              sessionId,
              activity: [{ kind: "job", items: [{ id: "job-1", label: "构建" }, { id: "job-2" }] }]
            });
          }
          if (failingIds.has(sessionId)) throw new Error("storage exploded");
          archived = new Set([...archived, sessionId]);
        } finally {
          inFlight -= 1;
        }
      }
    },
    agents: { get: () => null },
    sessions: { get: (sessionId) => liveSessions.get(sessionId) },
    get(name) {
      if (name === "sessionTitle") return titlesMounted ? titles : undefined;
      return undefined;
    }
  };
  let handler = null;

  apply(ctx);
  assert.ok(handler, "apply 注册了 API handler");

  /* ── 扫尾端点排在既有端点之后：sessionTitle 缺席时插件整体仍激活（design D9） ── */
  titlesMounted = false;
  const offlineScene = captureJson();
  await handler({ method: "GET", url: "/api/dsh-v-cosmos/scene" }, offlineScene.res);
  assert.equal(offlineScene.status, 200, "sessionTitle 缺席时 /scene 照常 200（插件未因等待服务停摆）");
  const offlineConfig = captureJson();
  await handler({ method: "GET", url: "/api/dsh-v-cosmos/config" }, offlineConfig.res);
  assert.equal(offlineConfig.status, 200, "sessionTitle 缺席时 /config 照常 200");
  const offlineRename = captureJson();
  await handler(stubBodyReq("POST", "/api/dsh-v-cosmos/rename-session", { sessionId: "idle-1", prefix: "已归档-" }), offlineRename.res);
  assert.equal(offlineRename.status, 503, "sessionTitle 缺席 → rename 503");
  assert.equal(offlineRename.body.error, "rename-unavailable");
  assert.equal(titles.renameCalls.length, 0, "503 不产生任何标题写入");
  titlesMounted = true;

  /* ── 批量归档：依次串行 + 逐会话分流 + 恒 200 ── */
  const before = archiveCalls.length;
  const archiveRes = captureJson();
  await handler(
    stubBodyReq("POST", "/api/dsh-v-cosmos/archive-sessions", {
      sessionIds: ["idle-1", "busy-1", "done-1", "gone-1", "boom-1"]
    }),
    archiveRes.res
  );
  assert.equal(archiveRes.status, 200, "部分失败不改变整体成功语义（恒 200）");
  assert.deepEqual(
    archiveRes.body.results.map((item) => [item.sessionId, item.outcome]),
    [
      ["idle-1", "archived"],
      ["busy-1", "skipped"],
      ["done-1", "already-archived"],
      ["gone-1", "missing"],
      ["boom-1", "failed"]
    ],
    "逐会话 outcome 与请求同序"
  );

  /* 已归档预过滤：doc「对已归档 id 从不询问」→ 端点连询问都不发起 */
  assert.deepEqual(
    archiveCalls.slice(before).map((call) => call.sessionId),
    ["idle-1", "busy-1", "gone-1", "boom-1"],
    "already-archived 走预过滤，不调用 archiveSession"
  );

  /* 依次（串行）：并发上限 1，且次序 = 数组序 */
  assert.equal(maxInFlight, 1, "端点内部依次串行（绝不同时归档两个会话）");

  /* 绝不自动停止在跑工作：每次调用只传 sessionId（无 stopActivity） */
  for (const call of archiveCalls.slice(before)) {
    assert.equal(call.argumentCount, 1, "archiveSession 只传 sessionId（options 未传）");
    assert.equal(call.options, undefined, "MUST NOT 传入 stopActivity / options");
  }

  /* 活动瀑布明细透传（族必现；条目 id/名称） */
  const busy = archiveRes.body.results.find((item) => item.sessionId === "busy-1");
  assert.deepEqual(busy.activity, [{ family: "job", items: [{ id: "job-1", label: "构建" }, { id: "job-2" }] }], "skipped 透传 activity 明细");
  assert.ok(!archived.has("busy-1"), "在跑会话未被归档");
  assert.ok(!("activity" in archiveRes.body.results[0]), "archived 不携带 activity 键");
  assert.equal(
    archiveRes.body.results.find((item) => item.sessionId === "boom-1").error,
    "storage exploded",
    "failed 携带宿主消息"
  );

  /* ── 幂等重跑：同一请求第二次全部 already-archived（含首轮 missing/failed 的复核语义） ── */
  const rerun = captureJson();
  await handler(stubBodyReq("POST", "/api/dsh-v-cosmos/archive-sessions", { sessionIds: ["idle-1", "busy-1", "done-1"] }), rerun.res);
  assert.equal(rerun.status, 200);
  assert.deepEqual(
    rerun.body.results.map((item) => item.outcome),
    ["already-archived", "skipped", "already-archived"],
    "重跑幂等（已归档不再询问；在跑仍 skipped）"
  );
  const callsAfterRerun = archiveCalls.length;
  const rerunAgain = captureJson();
  await handler(stubBodyReq("POST", "/api/dsh-v-cosmos/archive-sessions", { sessionIds: ["done-1"] }), rerunAgain.res);
  assert.equal(archiveCalls.length, callsAfterRerun, "已归档重跑零询问");

  /* ── 去重 + 空数组 + 非法请求 ── */
  const callsBeforeDedupe = archiveCalls.length;
  const dedupe = captureJson();
  await handler(
    stubBodyReq("POST", "/api/dsh-v-cosmos/archive-sessions", { sessionIds: ["idle-1", "idle-1", "idle-1"] }),
    dedupe.res
  );
  assert.equal(dedupe.status, 200);
  assert.equal(dedupe.body.results.length, 1, "请求内去重（单条 outcome）");
  assert.equal(archiveCalls.length, callsBeforeDedupe, "已归档 → 零询问");

  const empty = captureJson();
  await handler(stubBodyReq("POST", "/api/dsh-v-cosmos/archive-sessions", { sessionIds: [] }), empty.res);
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body, { results: [] }, "空数组合法 = no-op 成功（零队友提案无需技能特判）");

  for (const [label, body] of [
    ["缺失 sessionIds", {}],
    ["含空串条目", { sessionIds: ["idle-1", ""] }],
    ["非数组", { sessionIds: "idle-1" }],
    ["去重后超 32", { sessionIds: Array.from({ length: 33 }, (_, index) => "many-" + index) }]
  ]) {
    const callsBefore = archiveCalls.length;
    const invalid = captureJson();
    await handler(stubBodyReq("POST", "/api/dsh-v-cosmos/archive-sessions", body), invalid.res);
    assert.equal(invalid.status, 400, "非法请求 400 invalid：" + label);
    assert.equal(invalid.body.error, "invalid");
    assert.equal(archiveCalls.length, callsBefore, "400 不执行任何归档：" + label);
  }

  /* ── 前缀改名：成功（钉住）/ 幂等 / 空题回退 ── */
  const renameRes = captureJson();
  await handler(stubBodyReq("POST", "/api/dsh-v-cosmos/rename-session", { sessionId: "self-1", prefix: "已归档-" }), renameRes.res);
  assert.equal(renameRes.status, 200);
  assert.deepEqual(renameRes.body, { outcome: "renamed", title: "已归档-归档提案的会话" }, "读原题 → 前缀拼接 → 回传 accepted title");
  assert.deepEqual(titles.renameCalls, [{ sessionId: "self-1", title: "已归档-归档提案的会话" }], "经 sessionTitle.rename 写入（钉住）");

  const unchangedRes = captureJson();
  await handler(stubBodyReq("POST", "/api/dsh-v-cosmos/rename-session", { sessionId: "self-1", prefix: "已归档-" }), unchangedRes.res);
  assert.equal(unchangedRes.status, 200);
  assert.deepEqual(unchangedRes.body, { outcome: "unchanged", title: "已归档-归档提案的会话" }, "已带前缀幂等 no-op");
  assert.equal(titles.renameCalls.length, 1, "幂等 no-op 不产生写入（MUST NOT 双重前缀）");

  const prefixed = captureJson();
  await handler(stubBodyReq("POST", "/api/dsh-v-cosmos/rename-session", { sessionId: "titled-1", prefix: "已归档-" }), prefixed.res);
  assert.deepEqual(prefixed.body, { outcome: "unchanged", title: "已归档-已带前缀" }, "宿主快照已带前缀 → unchanged");

  const emptyTitle = captureJson();
  await handler(stubBodyReq("POST", "/api/dsh-v-cosmos/rename-session", { sessionId: "done-1", prefix: "已归档-" }), emptyTitle.res);
  assert.deepEqual(emptyTitle.body, { outcome: "renamed", title: "已归档-未命名" }, "空题回退「已归档-未命名」");

  /* ── 前缀改名：404 / 400 / 500 ── */
  const unknown = captureJson();
  await handler(stubBodyReq("POST", "/api/dsh-v-cosmos/rename-session", { sessionId: "nobody", prefix: "已归档-" }), unknown.res);
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error, "session/unknown");

  for (const [label, body] of [
    ["缺失 sessionId", { prefix: "已归档-" }],
    ["缺失 prefix", { sessionId: "idle-1" }],
    ["prefix 超 64 字节", { sessionId: "idle-1", prefix: "已".repeat(22) }]
  ]) {
    const invalid = captureJson();
    await handler(stubBodyReq("POST", "/api/dsh-v-cosmos/rename-session", body), invalid.res);
    assert.equal(invalid.status, 400, "非法改名请求 400：" + label);
    assert.equal(invalid.body.error, "invalid");
  }

  renameThrows = true;
  titles.rename = function throwingRename() {
    throw hostError("SessionTitleInvalidError", "session title must contain visible characters");
  };
  const failedWrite = captureJson();
  await handler(stubBodyReq("POST", "/api/dsh-v-cosmos/rename-session", { sessionId: "idle-1", prefix: "已归档-" }), failedWrite.res);
  assert.equal(failedWrite.status, 500, "宿主 rename 抛错 → 500（不阻断扫尾）");
  assert.equal(failedWrite.body.error, "internal");
  assert.ok(String(failedWrite.body.reason).includes("visible characters"), "500 携带宿主消息");
  renameThrows = false;

  /* 未知路由仍 404（新端点未破坏兜底） */
  const nope = captureJson();
  await handler({ method: "GET", url: "/api/dsh-v-cosmos/nope" }, nope.res);
  assert.equal(nope.status, 404);
} finally {
  rmSync(storageHome, { recursive: true, force: true });
}

console.log("sweep-wiring-smoke: all assertions passed");

/* ── 工具 ── */

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

/** 带 JSON 体的请求桩（handler 以 `for await (const chunk of req)` 读体）。 */
function stubBodyReq(method, url, body) {
  const chunks = [Buffer.from(JSON.stringify(body ?? {}), "utf8")];
  return {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    }
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
