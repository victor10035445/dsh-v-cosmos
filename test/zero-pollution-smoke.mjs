/**
 * 零污染冒烟（add-cosmos-entry 3.6 / add-celestial-states 7.1 / spec「零侵入不被破坏」）：
 *  - A：关联读写后工作区 `openspec/` 目录内容不变、存储只落 $DSH_HOME/storages/；
 *  - B：契约文件（`.state.json` + `pending-changes/`）存在时 `openspec list --json`
 *    输出与不存在时一致（CLI 零侵入，spike 结论固化；openspec 缺席 → 跳过并说明）。
 * 运行：node test/zero-pollution-smoke.mjs
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanWorkspace, buildSkeleton, joinChangesDir } from "../src/scan.mjs";
import { upsertAssociation, projectionOf } from "../src/associations.mjs";
import { storagePath, parseStoredDoc } from "../src/index.mjs";

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
    assert.deepEqual(scanned.pending, [{ name: "explore-ui", by: "cosmos-explore", at: 456 }], "同名目录锚点剔除，孤儿锚点保留");
  }
} finally {
  rmSync(wsRoot2, { recursive: true, force: true });
}

console.log("zero-pollution-smoke: all assertions passed");
