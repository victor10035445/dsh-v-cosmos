/**
 * 宿主接线冒烟（add-cosmos-entry 2.4–2.6 + 3.2/3.3/3.5）：stub ctx 直调 apply()，
 * 验证 /scene 骨架下发、SSE 轻帧、fs.watch 防抖重扫、启发式关联落盘与会话剪除。
 * 运行：node test/host-wiring-smoke.mjs（含 ~3s 防抖等待）
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply, storagePath, birthlineStoragePath, configStoragePath, contextTextOf, userContextTextOf, lastActivityMsOf, idSetFingerprint } from "../src/index.mjs";

/* ── 注册指纹纯函数（add-cosmos-add-workspace D3/1.1）：排序 join、集合等价 ── */
assert.equal(idSetFingerprint(["b", "a"]), idSetFingerprint(["a", "b"]), "指纹顺序无关（集合等价）");
assert.equal(idSetFingerprint([]), "", "空集合 → 空串");
assert.notEqual(idSetFingerprint(["a"]), idSetFingerprint(["a", "b"]), "新增 id → 指纹变化");
assert.notEqual(idSetFingerprint(["a", "b"]), idSetFingerprint(["a"]), "注销 id → 指纹变化");
assert.equal(idSetFingerprint(["a", ""]), idSetFingerprint(["a"]), "空 id 忽略");
assert.notEqual(idSetFingerprint(["ab", "c"]), idSetFingerprint(["a", "bc"]), "NUL 分隔防 id 拼接歧义");

/* ── 夹具：临时工作区（openspec/changes/add-demo）+ 自定义 DSH_HOME ── */
const wsRoot = mkdtempSync(join(tmpdir(), "dsh-cosmos-ws-"));
const wsRoot2 = mkdtempSync(join(tmpdir(), "dsh-cosmos-ws2-")); // 注册对账（第二个工作区）
const storageHome = mkdtempSync(join(tmpdir(), "dsh-cosmos-home-"));
process.env.DSH_HOME = storageHome; // storagePath(env) 读 process.env

try {
  const changesDir = join(wsRoot, "openspec", "changes");
  mkdirSync(join(changesDir, "add-demo"), { recursive: true });
  writeFileSync(join(changesDir, "add-demo", "tasks.md"), "- [x] one\n- [ ] two");

  /* ── stub ctx（webServer 捕获 handler；registry/agents 供给镜像） ── */
  const SESSION_ID = "sess-1";
  /* 事件形状对齐宿主 dsh-session（2026-11-20 安装版）：`user/message` 的 `data`
     即消息本体（无 `.message` 包装，文本块在 `data.content`），assistant 侧才带
     `data.message`；`@提案目录` 引用是规则 1 的指派信号（正文提及不建立关联）。 */
  const events = [
    {
      type: "user/message",
      time: 1700000000000,
      data: {
        id: "u1",
        role: "user",
        source: { kind: "user" },
        content: [{ type: "text", text: "帮我实现 @" + join(wsRoot, "openspec", "changes", "add-demo") + " 的骨架路由" }]
      }
    },
    { type: "assistant/message", time: 1700000000500, data: { message: { content: [{ type: "text", text: "好的，开始 add-demo。" }] } } }
  ];
  let archived = new Set();
  /** 可变工作区清单（注册/注销对账测试需要运行时增删行）。 */
  let workspaceRows = [{ id: "ws1", title: "WS One", path: wsRoot, sessionIds: [SESSION_ID] }];
  const registered = [];
  /** ctx.effect 返回的清理函数（插件卸载清场断言用）。 */
  const cleanups = [];
  const ctx = {
    logger: { warn() {} },
    effect(fn) {
      registered.push(fn);
      const off = fn();
      if (typeof off === "function") cleanups.push(off);
      return off;
    },
    webServer: {
      register(def) {
        capturedHandler = def.handler;
        return () => {};
      }
    },
    workspaceRegistry: {
      list: () => workspaceRows,
      get archivedSessionIds() {
        return archived;
      }
    },
    agents: {
      get: (id) =>
        id === SESSION_ID
          ? {
              status: "running",
              session: {
                header: { id, origin: "user", cwd: wsRoot },
                snapshotEvents: () => events
              }
            }
          : null
    }
  };
  let capturedHandler = null;

  /* ── 纯函数补充覆盖（contextTextOf / userContextTextOf / lastActivityMsOf） ── */
  const agent = ctx.agents.get(SESSION_ID);
  assert.ok(contextTextOf(agent).includes("add-demo"), "assistant 侧上下文文本含 slug（既有读取面保留）");
  assert.ok(userContextTextOf(agent).includes("add-demo"), "用户侧文本通道命中 @提案目录 引用");
  assert.ok(!userContextTextOf(agent).includes("好的，开始"), "用户侧通道不含 assistant 回显（事件类型口径）");
  assert.equal(lastActivityMsOf(agent, 0), 1700000000500, "末事件时间戳");

  /* ── apply → 首次 GET /scene（懒扫描 + 启发式） ── */
  apply(ctx);
  assert.equal(registered.length, 1, "ctx.effect 注册一次");

  const sseWrites = [];
  const sseRes = stubRes(sseWrites);
  /** SSE 数据帧计数（注册对账断言：指纹一致 → 无新增 proposals-changed 广播）。 */
  const dataFrameCount = () => sseWrites.filter((line) => line.trim().startsWith("data: ")).length;
  /** SSE 数据帧解析（任意 sink）。 */
  const framesOf = (sink) => sink
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)));
  /** 轻帧帧体（proposals-changed / associations-changed）。 */
  await capturedHandler({ method: "GET", url: "/api/dsh-v-cosmos/events" }, sseRes);
  await capturedHandler({ method: "GET", url: "/api/dsh-v-cosmos/scene" }, stubRes([]));
  await capturedHandler({ method: "GET", url: "/api/dsh-v-cosmos/scene" }, stubRes([]));
  await drain();

  const sceneFrames = sseWrites.map((line) => line.trim()).filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
  assert.ok(sceneFrames.some((f) => f.type === "proposals-changed"), "骨架变化 → proposals-changed 轻帧");
  assert.ok(sceneFrames.some((f) => f.type === "associations-changed"), "启发式建立关联 → associations-changed 轻帧");

  /* 关联已落盘（自定义 storageHome；工作区零写入由 zero-pollution-smoke 断言） */
  const stored = JSON.parse(readFileSync(storagePath(), "utf8"));
  assert.equal(stored.version, 1);
  assert.ok(
    stored.entries.some((e) => e.workspace === wsRoot && e.proposal === "add-demo" && e.sessionId === SESSION_ID && e.origin === "heuristic"),
    "规则 1：用户侧 @提案目录指派引用 → 关联落盘（origin: heuristic）"
  );

  /* /scene 骨架形状：恒星/生命周期/关联边 */
  const sceneRes = captureJson();
  await capturedHandler({ method: "GET", url: "/api/dsh-v-cosmos/scene" }, sceneRes.res);
  const scene = sceneRes.body.scene;
  assert.equal(scene.version, 1);
  const ws = scene.workspaces.find((w) => w.id === "ws1");
  assert.equal(ws.stars.length, 1);
  assert.equal(ws.stars[0].lifecycle, "created", "无 .state.json → created 兜底");
  assert.equal(ws.stars[0].setBy, null);
  assert.equal(ws.stars[0].at, null);
  assert.deepEqual(ws.stars[0].tasks, [1, 2]);
  assert.deepEqual(ws.pending, [], "无 pending-changes → 空锚点");
  assert.equal(ws.associations.length, 1, "关联边随骨架下发");

  /* ── fs.watch 防抖重扫（≥2s）：新增提案目录 → 骨架增量出现新恒星 ── */
  mkdirSync(join(changesDir, "add-second"), { recursive: true });
  writeFileSync(join(changesDir, "add-second", "tasks.md"), "- [ ] a\n- [ ] b");
  await sleep(3000); // 防抖 2s + 余量（watcher 事件延迟）

  const afterRes = captureJson();
  await capturedHandler({ method: "GET", url: "/api/dsh-v-cosmos/scene" }, afterRes.res);
  const afterStars = afterRes.body.scene.workspaces.find((w) => w.id === "ws1").stars;
  assert.equal(afterStars.length, 2, "fs.watch → 防抖重扫 → 新提案入骨架");
  assert.ok(afterStars.some((s) => s.id === "add-second" && Array.isArray(s.tasks) && s.tasks[1] === 2), "新提案任务计数入骨架（lifecycle created 兜底）");

  /* ── 注册→骨架对账（add-cosmos-add-workspace D3/1.1）：id 集合指纹不一致 → 全量重扫 ── */
  const changesDir2 = join(wsRoot2, "openspec", "changes");
  mkdirSync(join(changesDir2, "add-fresh"), { recursive: true });
  writeFileSync(join(changesDir2, "add-fresh", "tasks.md"), "- [ ] x");
  const framesBeforeRegister = dataFrameCount();
  workspaceRows = [...workspaceRows, { id: "ws2", title: "WS Two", path: wsRoot2, sessionIds: [] }];
  const registerRes = captureJson();
  await capturedHandler({ method: "GET", url: "/api/dsh-v-cosmos/scene" }, registerRes.res);
  await drain();
  const registeredWs = registerRes.body.scene.workspaces.find((w) => w.id === "ws2");
  assert.ok(registeredWs, "注册（id 集合指纹不一致）→ 单次 /scene 立即收录新工作区");
  assert.equal(registeredWs.stars.length, 1, "新工作区提案同轮入骨架（不依赖 fs.watch 防抖窗口）");
  assert.ok(dataFrameCount() > framesBeforeRegister, "注册重扫 → proposals-changed 广播（客户端 SSE 收敛）");

  /* 指纹一致（同一 registry 集合）：不重扫、不重播 proposals-changed（常态请求零增量） */
  const stableFrames = dataFrameCount();
  const stableRes = captureJson();
  await capturedHandler({ method: "GET", url: "/api/dsh-v-cosmos/scene" }, stableRes.res);
  await drain();
  assert.equal(dataFrameCount(), stableFrames, "指纹一致 → 不触发全量重扫广播（幂等 /scene 零抖动）");
  assert.equal(stableRes.body.scene.workspaces.length, 2, "指纹一致 → 骨架保持两星座");

  /* 注销（id 消失）同样命中：骨架收敛移除 + proposals-changed 广播 */
  workspaceRows = [workspaceRows[0]];
  const removeRes = captureJson();
  await capturedHandler({ method: "GET", url: "/api/dsh-v-cosmos/scene" }, removeRes.res);
  await drain();
  assert.ok(!removeRes.body.scene.workspaces.some((w) => w.id === "ws2"), "注销（id 消失）→ 骨架收敛移除该星座");
  assert.ok(dataFrameCount() > stableFrames, "注销重扫 → proposals-changed 广播（等其他客户端也收敛）");

  /* ── 时序一：会话归档 → 剪除 + 行星移除（宿主侧条目剪除） ── */
  archived = new Set([SESSION_ID]);
  const pruneRes = captureJson();
  await capturedHandler({ method: "GET", url: "/api/dsh-v-cosmos/scene" }, pruneRes.res);
  await drain();
  const storedAfterPrune = JSON.parse(readFileSync(storagePath(), "utf8"));
  assert.equal(storedAfterPrune.entries.length, 0, "归档会话关联条目剪除");
  assert.ok(
    sseWrites.some((line) => line.includes("associations-changed")),
    "剪除 → associations-changed 广播"
  );

  /* ── 锚点 sessionId 入骨架指纹（add-cosmos-embryo-cards 2.1）：宿主读取第一跳透传 +
        仅改 sessionId（锚点集合不变）→ 骨架指纹变化 → 增量广播（星胚重分组即时刷新） ── */
  {
    const ANCHOR_AT = 1700000000000;
    const pendingDir = join(wsRoot, "openspec", "pending-changes");
    mkdirSync(pendingDir, { recursive: true });
    const anchorPath = join(pendingDir, "explore-one.json");
    const anchorText = (sessionId) => JSON.stringify({ name: "explore-one", by: "cosmos-explore", at: ANCHOR_AT, sessionId });
    writeFileSync(anchorPath, anchorText("sess-explore-1"), "utf8");
    await sleep(3000); // 防抖窗口（watcher 可能已重扫；未触发则由下方 GET 的请求期指纹对账兜底）

    const firstAnchorRes = captureJson();
    await capturedHandler({ method: "GET", url: "/api/dsh-v-cosmos/scene" }, firstAnchorRes.res);
    await drain();
    const firstPending = firstAnchorRes.body.scene.workspaces.find((w) => w.id === "ws1").pending;
    assert.deepEqual(
      firstPending,
      [{ name: "explore-one", by: "cosmos-explore", at: ANCHOR_AT, sessionId: "sess-explore-1" }],
      "锚点 sessionId 入骨架（宿主 readPendingDir → scan 归一 → 骨架 三跳贯通）"
    );

    const framesBeforeRegroup = dataFrameCount();
    writeFileSync(anchorPath, anchorText("sess-explore-2"), "utf8"); // 仅 sessionId 变化（锚点集合不变）
    await sleep(3000);

    const regroupRes = captureJson();
    await capturedHandler({ method: "GET", url: "/api/dsh-v-cosmos/scene" }, regroupRes.res);
    await drain();
    const regroupPending = regroupRes.body.scene.workspaces.find((w) => w.id === "ws1").pending;
    assert.equal(regroupPending[0].sessionId, "sess-explore-2", "仅 sessionId 变化 → 骨架反映新值");
    assert.ok(
      dataFrameCount() > framesBeforeRegroup,
      "pending 条目整体序列化入 skeletonFingerprint → sessionId 值增改触发增量广播（不依赖客户端轮询）"
    );
  }

  /* ── 点燃谱系台账宿主接线（add-cosmos-panel-birthline-sort 2.1–2.3）：锚点在册 →
        sighting 落盘；同名提案目录出现且锚点删除 → 点燃配对写台账行并随骨架下发
        `lineages`；dismiss（仅删锚点、无同名目录）不误记。 ── */
  {
    const changesRoot = join(wsRoot, "openspec", "changes");
    const pendingDir = join(wsRoot, "openspec", "pending-changes");
    const IGNITE_AT = 1700000001000;
    const igniteAnchor = join(pendingDir, "ignite-one.json");
    writeFileSync(
      igniteAnchor,
      JSON.stringify({ name: "ignite-one", by: "cosmos-explore", at: IGNITE_AT, sessionId: "sess-ignite" }),
      "utf8"
    );
    await sleep(3000); // 防抖窗口（watcher 重扫；未触发则由下方 GET 兜底）
    const anchorRes = captureJson();
    await capturedHandler({ method: "GET", url: "/api/dsh-v-cosmos/scene" }, anchorRes.res);
    await drain();
    const anchorWs = anchorRes.body.scene.workspaces.find((w) => w.id === "ws1");
    assert.ok(anchorWs.pending.some((p) => p.name === "ignite-one"), "锚点在册（sighting 登记来源）");
    assert.deepEqual(anchorWs.lineages, [], "锚点在册帧不写台账行（仅登记 sighting）");
    const sightingStore = JSON.parse(readFileSync(birthlineStoragePath(), "utf8"));
    assert.ok(
      (sightingStore.workspaces?.[wsRoot]?.sightings ?? []).some(
        (row) => row.slug === "ignite-one" && row.at === IGNITE_AT && row.sessionId === "sess-ignite"
      ),
      "sighting 落盘插件自有 store（工作区零写入；跨重启保配对能力）"
    );

    const framesBeforeIgnite = dataFrameCount();
    /* ff / cosmos-ff-change 的点燃两转变：先建提案目录，再删锚点（跨帧到达）→ sighting 兜住。 */
    mkdirSync(join(changesRoot, "ignite-one"), { recursive: true });
    writeFileSync(join(changesRoot, "ignite-one", "tasks.md"), "- [ ] one", "utf8");
    unlinkSync(igniteAnchor);
    await sleep(3000);
    const litRes = captureJson();
    await capturedHandler({ method: "GET", url: "/api/dsh-v-cosmos/scene" }, litRes.res);
    await drain();
    const litWs = litRes.body.scene.workspaces.find((w) => w.id === "ws1");
    const lineage = litWs.lineages.find((row) => row.slug === "ignite-one");
    assert.ok(lineage, "同名提案目录出现 + 锚点删除 → 扫描差分点燃配对写台账行");
    assert.equal(lineage.embryoAt, IGNITE_AT, "台账 embryoAt = 锚点 at（点燃后谱系不失传）");
    assert.equal(lineage.embryoSessionId, "sess-ignite", "台账 embryoSessionId = 锚点 sessionId");
    assert.ok(lineage.ignitedMs > 0, "ignitedMs = 配对时刻");
    assert.ok(dataFrameCount() > framesBeforeIgnite, "lineages 入骨架指纹 → proposals-changed 增量广播（面板即时归块）");
    const litStore = JSON.parse(readFileSync(birthlineStoragePath(), "utf8"));
    assert.ok(
      (litStore.workspaces?.[wsRoot]?.lineages ?? []).some((row) => row.slug === "ignite-one"),
      "台账行落盘（跨重启可回查，不与关联/队列存储互相覆盖）"
    );
    assert.equal(
      (litStore.workspaces?.[wsRoot]?.sightings ?? []).some((row) => row.slug === "ignite-one"),
      false,
      "配对后 sighting 被消费（同一 sighting 只配一次）"
    );

    /* dismiss 不误记：仅删锚点（无同名提案目录）→ 台账无行。 */
    const dismissAnchor = join(pendingDir, "dismiss-one.json");
    writeFileSync(
      dismissAnchor,
      JSON.stringify({ name: "dismiss-one", by: "cosmos-explore", at: IGNITE_AT + 1 }),
      "utf8"
    );
    await sleep(3000);
    await capturedHandler({ method: "GET", url: "/api/dsh-v-cosmos/scene" }, stubRes([]));
    unlinkSync(dismissAnchor);
    await sleep(3000);
    const dismissRes = captureJson();
    await capturedHandler({ method: "GET", url: "/api/dsh-v-cosmos/scene" }, dismissRes.res);
    await drain();
    const dismissWs = dismissRes.body.scene.workspaces.find((w) => w.id === "ws1");
    assert.equal(
      dismissWs.lineages.some((row) => row.slug === "dismiss-one"),
      false,
      "dismiss（锚点消失、无同名提案）→ 台账不误记"
    );
  }

  /* ── 动作按钮配置通道（add-cosmos-proposal-actions 2.3）：GET/PUT + CAS 语义 ── */
  {
    const configHome = configStoragePath();
    assert.ok(configHome.startsWith(storageHome), "配置存储落在 $DSH_HOME 根（与关联存储独立）");
    assert.ok(existsSync(configHome), "apply 幂等播种生成配置文件");

    const initial = captureJson();
    await capturedHandler({ method: "GET", url: "/api/dsh-v-cosmos/config" }, initial.res);
    assert.equal(initial.status, 200);
    assert.equal(initial.body.status, "ready");
    assert.equal(initial.body.revision, 1, "播种 revision 1");
    assert.equal(initial.body.user, null, "空视图播种 → user: null");
    assert.deepEqual(initial.body.value.buttons, [], "无 buttons 节 → 生效值空列表");
    assert.deepEqual(initial.body.base.buttons, [], "组合层（entry config）空");

    const saveRes = captureJson();
    await capturedHandler(
      stubBodyReq("PUT", "/api/dsh-v-cosmos/config", {
        baseRevision: 1,
        sections: { buttons: [{ name: "审查", prompt: "请使用 /cosmos-review 审查本提案", autoSend: true }] }
      }),
      saveRes.res
    );
    assert.equal(saveRes.status, 200, "CAS 写入 200");
    assert.equal(saveRes.body.revision, 2, "revision 递增");

    const afterSave = captureJson();
    await capturedHandler({ method: "GET", url: "/api/dsh-v-cosmos/config" }, afterSave.res);
    assert.equal(afterSave.body.revision, 2);
    assert.deepEqual(afterSave.body.value.buttons, [
      { name: "审查", prompt: "请使用 /cosmos-review 审查本提案", autoSend: true, newSession: true }
    ], "落盘归一化（newSession 恒 true）+ 视图生效");
    assert.deepEqual(afterSave.body.user.buttons, afterSave.body.value.buttons, "user 层即写入内容");

    const conflictRes = captureJson();
    await capturedHandler(
      stubBodyReq("PUT", "/api/dsh-v-cosmos/config", { baseRevision: 1, sections: { buttons: [] } }),
      conflictRes.res
    );
    assert.equal(conflictRes.status, 409, "过期 revision → 409");
    assert.equal(conflictRes.body.revision, 2, "409 携带服务端 revision");

    const invalidRes = captureJson();
    await capturedHandler(
      stubBodyReq("PUT", "/api/dsh-v-cosmos/config", {
        baseRevision: 2,
        sections: { buttons: [{ name: "x", prompt: "p", newSession: false }] }
      }),
      invalidRes.res
    );
    assert.equal(invalidRes.status, 400, "newSession 非 true → 400");
    assert.equal(invalidRes.body.error, "invalid");

    const unsetRes = captureJson();
    await capturedHandler(
      stubBodyReq("PUT", "/api/dsh-v-cosmos/config", { baseRevision: 2, sections: { buttons: null } }),
      unsetRes.res
    );
    assert.equal(unsetRes.status, 200);
    const afterUnset = captureJson();
    await capturedHandler({ method: "GET", url: "/api/dsh-v-cosmos/config" }, afterUnset.res);
    assert.deepEqual(afterUnset.body.user, null, "unset → user: null（回组合层）");

    /* ── 星座动作配置节（add-cosmos-constellation-actions 1.2）：独立节 + 互不读写 ── */
    assert.deepEqual(afterUnset.body.value.constellationButtons, [], "无星座节 → 生效值空列表");
    assert.deepEqual(afterUnset.body.base.constellationButtons, [], "组合层星座节空");

    const constSave = captureJson();
    await capturedHandler(
      stubBodyReq("PUT", "/api/dsh-v-cosmos/config", {
        baseRevision: 3,
        sections: { constellationButtons: [{ name: "探索", prompt: "请使用 /cosmos-explore 探索新需求" }] }
      }),
      constSave.res
    );
    assert.equal(constSave.status, 200, "星座节 CAS 写入 200");
    assert.equal(constSave.body.revision, 4, "revision 递增");

    const afterConstSave = captureJson();
    await capturedHandler({ method: "GET", url: "/api/dsh-v-cosmos/config" }, afterConstSave.res);
    assert.deepEqual(afterConstSave.body.value.constellationButtons, [
      { name: "探索", prompt: "请使用 /cosmos-explore 探索新需求", autoSend: false, newSession: true }
    ], "星座节落盘归一化（newSession 恒 true、无 prepend 键）+ 视图生效");
    assert.deepEqual(afterConstSave.body.user.constellationButtons, afterConstSave.body.value.constellationButtons, "user 层只有星座节");
    assert.deepEqual(afterConstSave.body.value.buttons, [], "写入星座节不改写 buttons 节");

    const constPrepend = captureJson();
    await capturedHandler(
      stubBodyReq("PUT", "/api/dsh-v-cosmos/config", {
        baseRevision: 4,
        sections: { constellationButtons: [{ name: "x", prompt: "p", prepend: true }] }
      }),
      constPrepend.res
    );
    assert.equal(constPrepend.status, 400, "星座按钮 prepend 键 → 400");
    assert.equal(constPrepend.body.error, "invalid");

    const proposalAfterConst = captureJson();
    await capturedHandler(
      stubBodyReq("PUT", "/api/dsh-v-cosmos/config", {
        baseRevision: 4,
        sections: { buttons: [{ name: "审查", prompt: "请使用 /cosmos-review 审查本提案", autoSend: true }] }
      }),
      proposalAfterConst.res
    );
    assert.equal(proposalAfterConst.status, 200);
    const bothView = captureJson();
    await capturedHandler({ method: "GET", url: "/api/dsh-v-cosmos/config" }, bothView.res);
    assert.equal(bothView.body.revision, 5);
    assert.deepEqual(bothView.body.value.constellationButtons, afterConstSave.body.value.constellationButtons, "写 buttons 不改写星座节");
    assert.deepEqual(bothView.body.user.buttons, [
      { name: "审查", prompt: "请使用 /cosmos-review 审查本提案", autoSend: true, newSession: true }
    ], "两节并存各自独立");
  }

  /* ── paths 节端到端（step2-cosmos-openspec-path-setting 2.1/2.2）：零新增路由——
        GET/PUT /config 对对象节透传（节集合注册即通），CAS/400/409 语义不变 ── */
  {
    const initialPaths = captureJson();
    await capturedHandler({ method: "GET", url: "/api/dsh-v-cosmos/config" }, initialPaths.res);
    assert.equal(initialPaths.status, 200);
    assert.deepEqual(initialPaths.body.value.paths, { openspecPath: null, cosmosSpecDir: null }, "未配置 → 生效值未配置形状（恒两键显式）");
    assert.deepEqual(initialPaths.body.base.paths, { openspecPath: null, cosmosSpecDir: null }, "组合层 paths 缺省未配置");
    assert.equal(initialPaths.body.user.paths, undefined, "user 层无 paths 节");

    const savePaths = captureJson();
    await capturedHandler(
      stubBodyReq("PUT", "/api/dsh-v-cosmos/config", {
        baseRevision: 5,
        sections: { paths: { openspecPath: "  C:/openspec  ", cosmosSpecDir: " D:\\cosmos-spec " } }
      }),
      savePaths.res
    );
    assert.equal(savePaths.status, 200, "paths 节 CAS 写入 200");
    assert.equal(savePaths.body.revision, 6, "revision 递增");

    const afterPaths = captureJson();
    await capturedHandler({ method: "GET", url: "/api/dsh-v-cosmos/config" }, afterPaths.res);
    assert.deepEqual(
      afterPaths.body.value.paths,
      { openspecPath: "C:/openspec", cosmosSpecDir: "D:\\cosmos-spec" },
      "PUT → GET 回显（trim 非空保留字面量，反斜杠原样）"
    );
    assert.deepEqual(afterPaths.body.user.paths, { openspecPath: "C:/openspec", cosmosSpecDir: "D:\\cosmos-spec" }, "user 层即写入内容");

    const pathsConflict = captureJson();
    await capturedHandler(
      stubBodyReq("PUT", "/api/dsh-v-cosmos/config", { baseRevision: 5, sections: { paths: { openspecPath: "x" } } }),
      pathsConflict.res
    );
    assert.equal(pathsConflict.status, 409, "过期 revision 写 paths → 409");
    assert.equal(pathsConflict.body.revision, 6, "409 携带服务端 revision");

    const pathsArray = captureJson();
    await capturedHandler(
      stubBodyReq("PUT", "/api/dsh-v-cosmos/config", { baseRevision: 6, sections: { paths: [] } }),
      pathsArray.res
    );
    assert.equal(pathsArray.status, 400, "paths 数组形状 → 400（对象节仅认普通对象）");
    assert.equal(pathsArray.body.error, "invalid");

    const buttonsObject = captureJson();
    await capturedHandler(
      stubBodyReq("PUT", "/api/dsh-v-cosmos/config", { baseRevision: 6, sections: { buttons: { openspecPath: "x" } } }),
      buttonsObject.res
    );
    assert.equal(buttonsObject.status, 400, "buttons 对象形状 → 400（数组节行为不变）");

    const pathsUnset = captureJson();
    await capturedHandler(
      stubBodyReq("PUT", "/api/dsh-v-cosmos/config", { baseRevision: 6, sections: { paths: null } }),
      pathsUnset.res
    );
    assert.equal(pathsUnset.status, 200);
    const afterPathsUnset = captureJson();
    await capturedHandler({ method: "GET", url: "/api/dsh-v-cosmos/config" }, afterPathsUnset.res);
    assert.equal(afterPathsUnset.body.user.paths, undefined, "paths: null → 节移除（unset）");
    assert.deepEqual(afterPathsUnset.body.value.paths, { openspecPath: null, cosmosSpecDir: null }, "unset 后回显未配置形状");
    assert.ok(afterPathsUnset.body.user.buttons, "unset paths 不动 buttons 节（节间互不读写）");
  }


  /* ── 未知路由 404 ── */
  const nfRes = captureJson();
  await capturedHandler({ method: "GET", url: "/api/dsh-v-cosmos/nope" }, nfRes.res);
  assert.equal(nfRes.status, 404);
} finally {
  rmSync(wsRoot, { recursive: true, force: true });
  rmSync(wsRoot2, { recursive: true, force: true });
  rmSync(storageHome, { recursive: true, force: true });
}

console.log("host-wiring-smoke: all assertions passed");

/* ── 工具 ── */

function stubRes(sink) {
  return {
    writeHead() {},
    write(chunk) {
      sink.push(String(chunk));
    },
    end() {},
    on() {}
  };
}

/** SSE 连接桩（add-cosmos-entry）：记录写入并暴露 close 事件派发
    （真实 Node `res` 的 close 在连接断开/窗口关闭时触发一次）。 */
function stubSseRes(sink) {
  const closeHandlers = [];
  return {
    writeHead() {},
    write(chunk) {
      sink.push(String(chunk));
    },
    end() {},
    on(event, fn) {
      if (event === "close" && typeof fn === "function") closeHandlers.push(fn);
    },
    emitClose() {
      for (const fn of closeHandlers.splice(0)) fn();
    }
  };
}

function captureJson() {
  const state = { status: 0, text: "", body: null, res: null };
  state.res = {
    writeHead(status) {
      state.status = status;
    },
    write() {},
    end(chunk) {
      state.text = String(chunk ?? "");
      try {
        state.body = JSON.parse(state.text);
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
  const text = JSON.stringify(body ?? {});
  const chunks = [Buffer.from(text, "utf8")];
  return {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    }
  };
}

function drain() {
  return sleep(30);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
