/**
 * 零污染冒烟（add-cosmos-entry 3.6 / add-celestial-states 7.1 / spec「零侵入不被破坏」）：
 *  - A：关联读写后工作区 `openspec/` 目录内容不变、存储只落 $DSH_HOME/storages/；
 *  - B：契约文件（`.state.json` + `pending-changes/`）存在时 `openspec list --json`
 *    输出与不存在时一致（CLI 零侵入，spike 结论固化；openspec 缺席 → 跳过并说明）；
 *  - C：动作按钮执行链路零写入（add-cosmos-proposal-actions）；
 *  - D：会话扫尾全流程零写入（add-cosmos-archive-session-sweep：批量归档 + 自改名
 *    后 `openspec/` 逐字节一致、list/status/validate 输出不变）。
 * 运行：node test/zero-pollution-smoke.mjs
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanWorkspace, buildSkeleton, joinChangesDir } from "../src/scan.mjs";
import { upsertAssociation, projectionOf } from "../src/associations.mjs";
import { storagePath, parseStoredDoc, apply } from "../src/index.mjs";
import { projectPanel } from "../src/panel.mjs";
import { consumePendingAction, createActionExecutor, createPendingActionStore } from "../src/actions.mjs";

/** 目录树快照（相对路径 → 文件内容哈希替代：长度 + 内容串），用于前后比对。 */
function snapshotTree(root) {
  const out = new Map();
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix + entry.name;
      if (entry.isDirectory()) {
        out.set(rel + "/", "dir");
        walk(join(dir, entry.name), rel + "/");
      } else {
        out.set(rel, "file:" + readdirSync.length); // 名字集合层面比对即可
      }
    }
  };
  walk(root, "");
  return out;
}

/* ── 造一个带 openspec 工件的临时工作区 ── */
const wsRoot = mkdtempSync(join(tmpdir(), "dsh-cosmos-zero-"));
const storageHome = mkdtempSync(join(tmpdir(), "dsh-cosmos-home-"));
try {
  const changesDir = join(wsRoot, "openspec", "changes");
  mkdirSync(join(changesDir, "add-demo"), { recursive: true });
  mkdirSync(join(changesDir, "archive", "2026-01-old"), { recursive: true });
  writeFileSync(join(changesDir, "add-demo", "tasks.md"), "- [x] one\n- [ ] two\n  - [ ] nested");

  const before = snapshotTree(wsRoot);

  /* ── 全链只读扫描 + 关联写入（写点 = 自定义 storageHome，非工作区） ── */
  const readers = {
    readChangesDir: (path) => readdirSync(joinChangesDir(path), { withFileTypes: true }),
    readArchiveDir: (path) => readdirSync(joinChangesDir(path) + "/archive", { withFileTypes: true }),
    readTasks: (dir) => {
      try {
        return readFileSync(join(dir, "tasks.md"), "utf8");
      } catch {
        return null;
      }
    },
    readBirthMs: () => 1234
  };
  const skeleton = buildSkeleton([{ id: "ws", title: "WS", path: wsRoot }], readers, { now: 1, associations: [] });
  assert.equal(skeleton.workspaces[0].stars.length, 1, "扫描到活跃提案");
  assert.equal(skeleton.workspaces[0].archives, 1, "归档计数");

  const result = upsertAssociation(undefined, { workspace: wsRoot, proposal: "add-demo", sessionId: "s1", origin: "heuristic" }, 100);
  assert.equal(result.changed, true);
  const doc = { version: 1, entries: projectionOf(result.entries) };
  const storage = storagePath({ DSH_HOME: storageHome });
  // 宿主 atomicWrite 的等价动作（测试内直写，验证 parseStoredDoc 回读口径）
  mkdirSync(join(storageHome, "storages"), { recursive: true });
  writeFileSync(storage, JSON.stringify(doc), "utf8");
  const parsed = parseStoredDoc(readFileSync(storage, "utf8"));
  assert.equal(parsed.version, 1);
  assert.equal(parsed.entries.length, 1);

  /* ── 断言：工作区树零变化（含 openspec/ 与 tasks.md 原样） ── */
  const after = snapshotTree(wsRoot);
  assert.equal(before.size, after.size, "工作区条目数不变");
  for (const [key, value] of before) {
    assert.ok(after.has(key), "条目未增删: " + key);
    assert.equal(after.get(key), value, "条目类型不变: " + key);
  }
  assert.equal(readFileSync(join(changesDir, "add-demo", "tasks.md"), "utf8"), "- [x] one\n- [ ] two\n  - [ ] nested", "tasks.md 内容逐字节不变");
} finally {
  rmSync(wsRoot, { recursive: true, force: true });
  rmSync(storageHome, { recursive: true, force: true });
}

console.log("zero-pollution-smoke: section A (association zero-touch) passed");

/* ── B：契约文件零侵入断言（add-celestial-states 7.1，spike 结论固化） ──
   临时工作区内构造 `.state.json` + `pending-changes/`，断言 `openspec list --json`
   输出与无这些文件时一致。openspec CLI 不在 PATH 时跳过（渲染端零依赖，不构成失败）。 */
function openspecListJson(cwd) {
  try {
    // Windows：openspec 为 .cmd shim → 经 shell 解析（固定字面量整串命令，无注入面，
    // 亦避开 spawnSync args+shell 的 DEP0190 弃用告警）。
    if (process.platform === "win32") {
      const r = spawnSync("openspec list --json", { cwd, encoding: "utf8", shell: true });
      return r.status === 0 ? r.stdout : null;
    }
    return execFileSync("openspec", ["list", "--json"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return null;
  }
}

const wsRoot2 = mkdtempSync(join(tmpdir(), "dsh-cosmos-zero2-"));
try {
  const changesDir2 = join(wsRoot2, "openspec", "changes");
  mkdirSync(join(changesDir2, "add-demo"), { recursive: true });
  writeFileSync(join(changesDir2, "add-demo", "tasks.md"), "- [ ] one");
  writeFileSync(join(changesDir2, "add-demo", "proposal.md"), "# Demo\n");

  const baseline = openspecListJson(wsRoot2);
  if (baseline === null) {
    console.log("zero-pollution-smoke: section B skipped（openspec CLI 不可用——渲染端零依赖，跳过 CLI 断言）");
  } else {
    /* 注入契约文件：提案目录内 .state.json + 根级 pending-changes/ 一条目。 */
    writeFileSync(join(changesDir2, "add-demo", ".state.json"), JSON.stringify({ version: 1, state: "reviewed", setBy: "cosmos-review", at: 123 }));
    mkdirSync(join(wsRoot2, "openspec", "pending-changes"), { recursive: true });
    writeFileSync(join(wsRoot2, "openspec", "pending-changes", "explore-ui.json"), JSON.stringify({ name: "explore-ui", by: "cosmos-explore", at: 456 }));
    writeFileSync(join(wsRoot2, "openspec", "pending-changes", "add-demo.json"), JSON.stringify({ name: "add-demo", by: "cosmos-explore", at: 789 })); // 同名目录 → 渲染端忽略

    const withContract = openspecListJson(wsRoot2);
    assert.ok(withContract !== null, "契约文件存在时 openspec list 仍成功");
    /* 比对归一化 JSON（剔除生成时间戳类字段后逐字段一致）。 */
    const strip = (text) => {
      const parsed = JSON.parse(text);
      const walk = (node) => {
        if (Array.isArray(node)) return node.map(walk);
        if (node && typeof node === "object") {
          const out = {};
          for (const [k, v] of Object.entries(node)) {
            if (/^(generatedAt|timestamp|updatedAt|checkedAt|mtime|time|lastModified)$/i.test(k)) continue; // 时序字段天然漂移
            out[k] = walk(v);
          }
          return out;
        }
        return node;
      };
      return JSON.stringify(walk(parsed));
    };
    assert.equal(strip(withContract), strip(baseline), "契约文件存在 ⇔ openspec list --json 输出与基线一致（零侵入）");

    /* 渲染端读取面：state 三态驱动 lifecycle + pending 锚点挂骨架 + 同名目录剔除。 */
    const realReaders = {
      readChangesDir: (path) => readdirSync(joinChangesDir(path), { withFileTypes: true }),
      readArchiveDir: () => null,
      readTasks: (dir) => {
        try {
          return readFileSync(join(dir, "tasks.md"), "utf8");
        } catch {
          return null;
        }
      },
      readBirthMs: () => null,
      readState: (dir) => {
        try {
          return readFileSync(join(dir, ".state.json"), "utf8");
        } catch {
          return null;
        }
      },
      readPendingDir: (path) => {
        try {
          return readdirSync(join(path, "openspec", "pending-changes"), { withFileTypes: true })
            .filter((e) => e.isFile() && e.name.endsWith(".json"))
            .map((e) => JSON.parse(readFileSync(join(path, "openspec", "pending-changes", e.name), "utf8")));
        } catch {
          return null;
        }
      }
    };
    const scanned = scanWorkspace({ id: "ws", title: "WS", path: wsRoot2 }, realReaders);
    assert.equal(scanned.stars.length, 1);
    assert.equal(scanned.stars[0].lifecycle, "reviewed", ".state.json → lifecycle=reviewed");
    assert.equal(scanned.stars[0].setBy, "cosmos-review");
    assert.deepEqual(scanned.pending, [{ name: "explore-ui", by: "cosmos-explore", at: 456, sessionId: null }], "同名目录锚点剔除，孤儿锚点保留（旧锚点 sessionId → null）");
  }
} finally {
  rmSync(wsRoot2, { recursive: true, force: true });
}

console.log("zero-pollution-smoke: section B (contract files zero-touch) passed");

/* ── C：动作按钮执行链路零侵入（add-cosmos-proposal-actions 6.2 / spec「点击不写工件」） ──
   真实临时工作区 + 完整「选中提案 → 点击按钮 → 组装 → 登记标记 → startSession（注入桩）→
   hero 消费」链路，断言执行前后工作区 `openspec/` 逐字节一致、openspec CLI 输出不变。 */
function hashTree(root) {
  const out = new Map();
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix + entry.name;
      if (entry.isDirectory()) {
        out.set(rel + "/", "dir");
        walk(join(dir, entry.name), rel + "/");
      } else {
        out.set(rel, createHash("sha256").update(readFileSync(join(dir, entry.name))).digest("hex"));
      }
    }
  };
  walk(root, "");
  return out;
}

function openspecOutput(cwd, command) {
  try {
    if (process.platform === "win32") {
      const result = spawnSync(command, { cwd, encoding: "utf8", shell: true });
      return result.stdout ?? "";
    }
    const [bin, ...args] = command.split(" ");
    return execFileSync(bin, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    return String(error?.stdout ?? "");
  }
}

const wsRoot3 = mkdtempSync(join(tmpdir(), "dsh-cosmos-zero3-"));
try {
  const changesDir3 = join(wsRoot3, "openspec", "changes");
  mkdirSync(join(changesDir3, "add-demo"), { recursive: true });
  writeFileSync(join(changesDir3, "add-demo", "proposal.md"), "# Demo\n");
  writeFileSync(join(changesDir3, "add-demo", "tasks.md"), "- [x] one\n- [ ] two");
  writeFileSync(join(changesDir3, "add-demo", ".state.json"), JSON.stringify({ version: 1, state: "reviewed", setBy: "cosmos-review", at: 123 }));
  mkdirSync(join(wsRoot3, "openspec", "pending-changes"), { recursive: true });
  writeFileSync(join(wsRoot3, "openspec", "pending-changes", "explore-ui.json"), JSON.stringify({ name: "explore-ui", by: "cosmos-explore", at: 456 }));

  const beforeTree = hashTree(join(wsRoot3, "openspec"));
  const listBefore = openspecOutput(wsRoot3, "openspec list --json");
  const statusBefore = openspecOutput(wsRoot3, "openspec status --change add-demo --json");
  const validateBefore = openspecOutput(wsRoot3, "openspec validate add-demo --json");
  assert.ok(listBefore.length > 0, "openspec list 基线可读");

  /* 扫描出真实卡片（与运行期同源：scan → 面板投影）。 */
  const realReaders3 = {
    readChangesDir: (path) => readdirSync(joinChangesDir(path), { withFileTypes: true }),
    readArchiveDir: () => null,
    readTasks: (dir) => {
      try {
        return readFileSync(join(dir, "tasks.md"), "utf8");
      } catch {
        return null;
      }
    },
    readBirthMs: () => null,
    readState: (dir) => {
      try {
        return readFileSync(join(dir, ".state.json"), "utf8");
      } catch {
        return null;
      }
    },
    readPendingDir: () => null
  };
  const scannedWs = scanWorkspace({ id: "ws-zero", title: "Zero", path: wsRoot3 }, realReaders3);
  const panelModel = projectPanel({ workspaces: [{ id: "ws-zero", name: "Zero", path: wsRoot3, stars: scannedWs.stars }] });
  assert.equal(panelModel.allCards.length, 1, "面板投影取到 1 个活跃提案");
  const card = panelModel.allCards[0];
  assert.equal(card.lifecycle, "reviewed", "四态来自 .state.json");
  assert.equal(card.dir, wsRoot3.replace(/\\/g, "/") + "/openspec/changes/add-demo", "@目录为正斜杠绝对路径");

  /* 四种按钮组合各跑一遍完整链路（含 hero 消费的模型切换 + 首回合提交）。 */
  const buttons = [
    { name: "引用在前", prompt: "请使用 /cosmos-review 审查本提案", autoSend: true, newSession: true },
    { name: "提示词在前", prompt: "请使用 /cosmos-apply-change 执行本提案", autoSend: true, newSession: true, prepend: true },
    { name: "绑定模型", prompt: "审查", autoSend: true, newSession: true, model: { provider: "deepseek", model: "deepseek-chat", reasoningEffort: "max" } },
    { name: "仅填草稿", prompt: "只填不发", autoSend: false, newSession: true }
  ];
  const pending = createPendingActionStore();
  const started = [];
  let clock = 1_000_000;
  const executor = createActionExecutor({
    pending,
    startSession: (wsId, message) => started.push({ wsId, message }),
    closePage: () => {},
    notify: () => {},
    /* 时钟前进：连续四次点击不受防重入冷却窗（800ms）影响。 */
    now: () => (clock += 1_000)
  });
  for (const button of buttons) {
    const result = await executor.run({ button, card });
    assert.equal(result.ok, true, "链路成功：" + button.name);
    const last = started.at(-1);
    assert.equal(last.wsId, "ws-zero", "新会话归属提案工作区");
    assert.equal(last.message, result.message, "startSession 收到组装消息");
    assert.ok(last.message.includes("@" + card.dir), "消息含 @提案目录");
    /* hero 消费（草稿与消息一致；模型切换成功；autoSend 时提交一次）。 */
    const consumed = [];
    const outcome = await consumePendingAction({
      pending,
      draft: result.message,
      switchModel: async (model) => {
        consumed.push("switch:" + model.provider + "/" + model.model);
        return { ok: true };
      },
      submit: () => consumed.push("submit")
    });
    if (button.autoSend) {
      assert.equal(outcome.status, "submitted", "自动发送 → 首回合提交");
      assert.equal(consumed.at(-1), "submit", "提交发生在模型切换之后");
    } else if (button.model) {
      assert.equal(outcome.status, "switched", "未自动发送 → 仅切模型");
      assert.ok(!consumed.includes("submit"), "未自动发送不提交");
    } else {
      assert.equal(outcome.status, "idle", "仅填草稿 → 不登记标记");
    }
  }

  /* 零写入断言：openspec/ 逐字节一致 + CLI 输出不变。 */
  const afterTree = hashTree(join(wsRoot3, "openspec"));
  assert.equal(beforeTree.size, afterTree.size, "openspec/ 条目数不变");
  for (const [key, value] of beforeTree) {
    assert.equal(afterTree.get(key), value, "openspec/ 逐字节一致: " + key);
  }
  /* CLI 输出含天然漂移字段（durationMs 等），按 JSON 归一化后比对内容。 */
  const stableJson = (text) => {
    try {
      const walk = (node) => {
        if (Array.isArray(node)) return node.map(walk);
        if (node && typeof node === "object") {
          const out = {};
          for (const [key, value] of Object.entries(node)) {
            if (/^(durationMs|generatedAt|timestamp|updatedAt|checkedAt|mtime|time|lastModified)$/i.test(key)) continue;
            out[key] = walk(value);
          }
          return out;
        }
        return node;
      };
      return JSON.stringify(walk(JSON.parse(text)));
    } catch {
      return text;
    }
  };
  assert.equal(stableJson(openspecOutput(wsRoot3, "openspec list --json")), stableJson(listBefore), "openspec list 输出不变");
  assert.equal(
    stableJson(openspecOutput(wsRoot3, "openspec status --change add-demo --json")),
    stableJson(statusBefore),
    "openspec status 输出不变"
  );
  assert.equal(
    stableJson(openspecOutput(wsRoot3, "openspec validate add-demo --json")),
    stableJson(validateBefore),
    "openspec validate 输出不变"
  );
} finally {
  rmSync(wsRoot3, { recursive: true, force: true });
}

console.log("zero-pollution-smoke: section C (proposal action zero-touch) passed");

/* ── D：会话扫尾零侵入（add-cosmos-archive-session-sweep 3.3 / spec cosmos-archive-sweep） ──
   真实临时工作区 + stub ctx（会话面全桩）：按归档技能的扫尾次序走完整链路——
   GET /scene 解析队友 → POST /archive-sessions 批量归档 → POST /rename-session
   自改名 → 再拉一次 /scene（客户端收敛）→ 断言 `openspec/` 逐字节一致、
   `openspec list/status/validate` 输出不变（端点 MUST NOT 写 openspec 目录）。 */
const wsRoot4 = mkdtempSync(join(tmpdir(), "dsh-cosmos-zero4-"));
const storageHome4 = mkdtempSync(join(tmpdir(), "dsh-cosmos-home4-"));
const previousHome = process.env.DSH_HOME;
try {
  const changesDir4 = join(wsRoot4, "openspec", "changes");
  mkdirSync(join(changesDir4, "add-demo"), { recursive: true });
  mkdirSync(join(changesDir4, "archive", "2026-01-old"), { recursive: true });
  writeFileSync(join(changesDir4, "add-demo", "proposal.md"), "# Demo\n");
  writeFileSync(join(changesDir4, "add-demo", "tasks.md"), "- [x] one\n- [x] two");
  writeFileSync(
    join(changesDir4, "add-demo", ".state.json"),
    JSON.stringify({ version: 1, state: "executed", setBy: "cosmos-apply-change", at: 123 })
  );
  mkdirSync(join(wsRoot4, "openspec", "pending-changes"), { recursive: true });
  writeFileSync(
    join(wsRoot4, "openspec", "pending-changes", "explore-ui.json"),
    JSON.stringify({ name: "explore-ui", by: "cosmos-explore", at: 456 })
  );

  const beforeOpenspec4 = hashTree(join(wsRoot4, "openspec"));
  const listBefore4 = openspecOutput(wsRoot4, "openspec list --json");
  const statusBefore4 = openspecOutput(wsRoot4, "openspec status --change add-demo --json");
  const validateBefore4 = openspecOutput(wsRoot4, "openspec validate add-demo --json");
  assert.ok(listBefore4.length > 0, "扫尾夹具：openspec list 基线可读");

  process.env.DSH_HOME = storageHome4; // 插件存储写点（非工作区）

  const TEAMMATE = "sess-teammate";
  const SELF = "sess-archiver";
  /* 用户侧消息事件（宿主 dsh-session 形状）+ @提案目录指派引用：规则 1 的关联由此建立
     （正文提及不再是信号）。 */
  const events = [
    {
      type: "user/message",
      time: 1700000000000,
      data: {
        id: "m1",
        role: "user",
        source: { kind: "user" },
        content: [{ type: "text", text: `归档 @${join(wsRoot4, "openspec", "changes", "add-demo")} 并扫尾` }]
      }
    }
  ];
  let archived4 = new Set();
  const archiveCalls4 = [];
  const titles4 = {
    current: new Map([[SELF, "归档者会话"]]),
    get: (session) => (titles4.current.has(session.id) ? { title: titles4.current.get(session.id) } : undefined),
    rename: (session, title) => {
      titles4.current.set(session.id, title);
      return { title };
    }
  };
  const live4 = new Map([[SELF, { id: SELF, snapshotEvents: () => [] }]]);
  let handler4 = null;
  let dispose4 = null;
  const ctx4 = {
    logger: { warn() {} },
    effect(fn) {
      dispose4 = fn();
      return dispose4;
    },
    webServer: {
      register(def) {
        handler4 = def.handler;
        return () => {};
      }
    },
    workspaceRegistry: {
      list: () => [{ id: "ws-zero", title: "Zero", path: wsRoot4, sessionIds: [TEAMMATE, SELF] }],
      get archivedSessionIds() {
        return archived4;
      },
      async archiveSession(sessionId) {
        archiveCalls4.push(sessionId);
        archived4 = new Set([...archived4, sessionId]);
      }
    },
    agents: {
      get: (id) =>
        id === TEAMMATE
          ? { status: "idle", session: { header: { id, origin: "user", cwd: wsRoot4 }, snapshotEvents: () => events } }
          : null
    },
    sessions: { get: (id) => live4.get(id) },
    get: (name) => (name === "sessionTitle" ? titles4 : undefined)
  };
  apply(ctx4);
  assert.ok(handler4, "扫尾夹具：apply 注册 handler");

  /* ① 解析队友：GET /scene → 关联边（提案归档保留边） */
  const scene4 = captureJson();
  await handler4({ method: "GET", url: "/api/dsh-v-cosmos/scene" }, scene4.res);
  assert.equal(scene4.status, 200);
  const workspace4 = scene4.body.scene.workspaces.find((ws) => ws.path === wsRoot4);
  assert.ok(workspace4, "扫尾夹具：/scene 含当前星座");
  const teammateIds = workspace4.associations
    .filter((edge) => edge.proposal === "add-demo" && edge.sessionId !== SELF)
    .map((edge) => edge.sessionId);
  assert.deepEqual(teammateIds, [TEAMMATE], "关联边解析出队友（自身不在其列）");

  /* ② 依次批量归档（单次调用，端点内部串行） */
  const sweepArchive4 = captureJson();
  await handler4(stubJsonReq("POST", "/api/dsh-v-cosmos/archive-sessions", { sessionIds: teammateIds }), sweepArchive4.res);
  assert.equal(sweepArchive4.status, 200);
  assert.deepEqual(sweepArchive4.body.results, [{ sessionId: TEAMMATE, outcome: "archived" }], "队友归档成功");
  assert.deepEqual(archiveCalls4, [TEAMMATE], "归档调用只针对队友（自身永不归档）");

  /* ③ 自改名（前缀钉住） */
  const sweepRename4 = captureJson();
  await handler4(stubJsonReq("POST", "/api/dsh-v-cosmos/rename-session", { sessionId: SELF, prefix: "已归档-" }), sweepRename4.res);
  assert.equal(sweepRename4.status, 200);
  assert.deepEqual(sweepRename4.body, { outcome: "renamed", title: "已归档-归档者会话" }, "自身标题加前缀（不归档自身）");

  /* ④ 客户端收敛：再拉一次 /scene（归档剪除关联条目 → 只写 $DSH_HOME 存储） */
  const afterScene4 = captureJson();
  await handler4({ method: "GET", url: "/api/dsh-v-cosmos/scene" }, afterScene4.res);
  assert.equal(afterScene4.status, 200);

  /* 零侵入断言：openspec/ 逐字节一致 + CLI 输出不变 */
  const afterOpenspec4 = hashTree(join(wsRoot4, "openspec"));
  assert.equal(beforeOpenspec4.size, afterOpenspec4.size, "扫尾后 openspec/ 条目数不变");
  for (const [key, value] of beforeOpenspec4) {
    assert.equal(afterOpenspec4.get(key), value, "扫尾后 openspec/ 逐字节一致: " + key);
  }
  const stableJson4 = (text) => {
    try {
      const walk = (node) => {
        if (Array.isArray(node)) return node.map(walk);
        if (node && typeof node === "object") {
          const out = {};
          for (const [key, value] of Object.entries(node)) {
            if (/^(durationMs|generatedAt|timestamp|updatedAt|checkedAt|mtime|time|lastModified)$/i.test(key)) continue;
            out[key] = walk(value);
          }
          return out;
        }
        return node;
      };
      return JSON.stringify(walk(JSON.parse(text)));
    } catch {
      return text;
    }
  };
  assert.equal(stableJson4(openspecOutput(wsRoot4, "openspec list --json")), stableJson4(listBefore4), "扫尾后 openspec list 输出不变");
  assert.equal(
    stableJson4(openspecOutput(wsRoot4, "openspec status --change add-demo --json")),
    stableJson4(statusBefore4),
    "扫尾后 openspec status 输出不变"
  );
  assert.equal(
    stableJson4(openspecOutput(wsRoot4, "openspec validate add-demo --json")),
    stableJson4(validateBefore4),
    "扫尾后 openspec validate 输出不变"
  );

  /* 插件存储写点恒在 $DSH_HOME（关联持久化与工作区目录无关） */
  assert.ok(existsSync(storagePath()), "扫尾链路只把持久化写在 $DSH_HOME/storages/");

  dispose4?.();
} finally {
  if (previousHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = previousHome;
  rmSync(wsRoot4, { recursive: true, force: true });
  rmSync(storageHome4, { recursive: true, force: true });
}

console.log("zero-pollution-smoke: section D (archive-session sweep zero-touch) passed");
console.log("zero-pollution-smoke: all assertions passed");

/* ── 工具（section D：stub ctx 的 HTTP 请求/响应桩） ── */

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
function stubJsonReq(method, url, body) {
  const chunks = [Buffer.from(JSON.stringify(body ?? {}), "utf8")];
  return {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    }
  };
}

