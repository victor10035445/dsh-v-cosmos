/**
 * 星胚移除端点冒烟（add-cosmos-embryo-dismiss 5.1 / spec cosmos-embryo-dismiss
 * 「星胚移除服务端端点」）：stub ctx（真实临时工作区目录）直调 apply()，验证
 *  - slug 白名单矩阵（`/` `\` `..` 子串如 `a..b` 恒拒；拒绝形态零文件访问）；
 *  - outcome 枚举全分支：deleted / already-missing / guard-dir-exists /
 *    missing-workspace / failed（删除异常）；
 *  - 守卫链顺序语义：miss 工作区不碰文件系统、目录守卫零删除、幂等重删；
 *  - 只删锚点单文件：`.state.json` 与 `changes/` 内容零变化；
 *  - 恒 200 口径（含非法请求体 / 非 POST 方法兜底 404）；
 *  - fs.watch 覆盖删除事件（既有范围，不改）：锚点删除 → 2s 防抖重扫 →
 *    `proposals-changed` 轻帧 → 骨架 pending 条目消失。
 * 运行：node test/dismiss-smoke.mjs
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply, isDismissableSlug } from "../src/index.mjs";

/* ── slug 白名单矩阵（CONTRACT §6.3）：首字符非点 / 无路径分隔符 / 不含 `..` 子串 ── */
{
  for (const slug of ["add-user-auth", "a", "9lives", "a.b_c-d", "A_B.c-9", "x..y".replace("..", ".z.")]) {
    assert.equal(isDismissableSlug(slug), true, "合法 slug：" + slug);
  }
  for (const slug of [
    "", " ", ".hidden", "a/b", "a\\b", "../x", "..", "a..b", "..a", "a..", "a b",
    "a:b", "a*b", "-leading", "_leading", "中文锚点", "a/b/../c"
  ]) {
    assert.equal(isDismissableSlug(slug), false, "非法 slug 恒拒：" + JSON.stringify(slug));
  }
  for (const value of [null, undefined, 42, {}, [], true]) {
    assert.equal(isDismissableSlug(value), false, "非字符串入参恒拒：" + String(value));
  }
}

const storageHome = mkdtempSync(join(tmpdir(), "dsh-cosmos-dismiss-home-"));
const wsRoot = mkdtempSync(join(tmpdir(), "dsh-cosmos-dismiss-ws-"));
process.env.DSH_HOME = storageHome;

const pendingDir = join(wsRoot, "openspec", "pending-changes");
const changesDir = join(wsRoot, "openspec", "changes");

const anchorPath = (slug) => join(pendingDir, slug + ".json");
const proposalDir = (name) => join(changesDir, name);

function writeAnchor(slug) {
  writeFileSync(anchorPath(slug), JSON.stringify({
    name: slug, by: "cosmos-explore", at: 1700000000000, sessionId: "sess-explore"
  }), "utf8");
}

/** 目录内容快照（相对路径 → sha256；断言「只删锚点单文件」用）。 */
function snapshotTree(root) {
  const out = new Map();
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? prefix + "/" + entry.name : entry.name;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, rel);
      else out.set(rel, createHash("sha256").update(readFileSync(full)).digest("hex"));
    }
  };
  walk(root, "");
  return out;
}

try {
  /* ── 夹具：openspec 工件（真实提案目录 + 锚点 + 穿越靶 + 删除异常靶） ── */
  mkdirSync(pendingDir, { recursive: true });
  mkdirSync(proposalDir("add-existing"), { recursive: true });
  mkdirSync(proposalDir("guard-embryo"), { recursive: true });
  writeFileSync(join(proposalDir("add-existing"), ".state.json"), JSON.stringify({
    version: 1, state: "reviewed", setBy: "cosmos-review", at: 1700000000001
  }), "utf8");
  writeFileSync(join(proposalDir("add-existing"), "tasks.md"), "- [ ] 1.1 do the thing\n", "utf8");
  writeFileSync(join(proposalDir("guard-embryo"), ".state.json"), JSON.stringify({
    version: 1, state: "created", setBy: "cosmos-ff-change", at: 1700000000002
  }), "utf8");

  writeAnchor("fresh-embryo");
  writeAnchor("repeat-embryo");
  writeAnchor("guard-embryo"); // 同名真实提案目录存在 → 目录优先（锚点本就被忽略）
  writeAnchor("keep-embryo"); // missing-workspace 用例：工作区不解析 → 零删除
  writeAnchor("a..b"); // `..` 子串：白名单必须拒绝（文件保留）
  writeAnchor("watch-embryo"); // fs.watch 端到端用例
  writeFileSync(join(wsRoot, "evil.json"), "OUTSIDE-OPENSPEC", "utf8"); // 穿越靶：MUST 存活
  mkdirSync(anchorPath("broken-anchor"), { recursive: true }); // unlink 抛错（非 ENOENT）→ failed

  const workspace = { id: "ws-alpha", workspaceId: "ws-alpha", name: "alpha", path: wsRoot, sessionIds: [] };

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
    workspaceRegistry: { list: () => [workspace], archivedSessionIds: [] },
    agents: { get: () => null },
    sessions: { get: () => null },
    get: () => undefined
  };
  let handler = null;
  apply(ctx);
  assert.ok(handler, "apply 注册了 API handler");

  const post = async (body) => {
    const res = captureJson();
    await handler(stubBodyReq("POST", "/api/dsh-v-cosmos/dismiss-embryo", body), res.res);
    return res;
  };

  /* ── deleted：硬删除锚点单文件 ── */
  const beforeDelete = snapshotTree(join(wsRoot, "openspec"));
  const deleted = await post({ workspaceId: "ws-alpha", slug: "fresh-embryo" });
  assert.equal(deleted.status, 200, "成功删除恒 200");
  assert.deepEqual(deleted.body, { outcome: "deleted" }, "outcome = deleted");
  assert.equal(existsSync(anchorPath("fresh-embryo")), false, "锚点文件已硬删除");
  const afterDelete = snapshotTree(join(wsRoot, "openspec"));
  const removed = [...beforeDelete.keys()].filter((key) => !afterDelete.has(key));
  assert.deepEqual(removed, ["pending-changes/fresh-embryo.json"], "只删锚点单文件（其余工件零变化）");
  for (const [key, digest] of afterDelete) {
    assert.equal(beforeDelete.get(key), digest, "内容零变化：" + key);
  }

  /* ── already-missing：重复移除幂等 ── */
  const repeat = await post({ workspaceId: "ws-alpha", slug: "fresh-embryo" });
  assert.equal(repeat.status, 200, "幂等重删恒 200");
  assert.deepEqual(repeat.body, { outcome: "already-missing" }, "锚点缺失 → already-missing（无报错）");

  /* ── guard-dir-exists：同名真实提案目录守卫先行（零删除） ── */
  const guardDir = snapshotTree(proposalDir("guard-embryo"));
  const guarded = await post({ workspaceId: "ws-alpha", slug: "guard-embryo" });
  assert.equal(guarded.status, 200);
  assert.deepEqual(guarded.body, { outcome: "guard-dir-exists" }, "同名提案目录存在 → 拒绝");
  assert.equal(existsSync(anchorPath("guard-embryo")), true, "守卫拒绝：锚点保持原样");
  assert.deepEqual(snapshotTree(proposalDir("guard-embryo")), guardDir, "守卫拒绝：提案目录内容零变化");

  /* ── missing-workspace：未在册工作区不触碰文件系统 ── */
  const noWs = await post({ workspaceId: "ws-ghost", slug: "keep-embryo" });
  assert.equal(noWs.status, 200, "未在册工作区仍恒 200");
  assert.deepEqual(noWs.body, { outcome: "missing-workspace" });
  assert.equal(existsSync(anchorPath("keep-embryo")), true, "missing-workspace 零文件操作");

  /* ── 路径穿越恒拒绝（含 `/` `\` `..` 子串）且零文件访问 ── */
  for (const slug of ["../../evil", "..\\..\\evil", "../pending-changes/fresh-embryo", "a../..", "a..b"]) {
    const rejected = await post({ workspaceId: "ws-alpha", slug });
    assert.equal(rejected.status, 200, "穿越输入恒 200：" + slug);
    assert.equal(rejected.body.outcome, "failed", "穿越输入 → failed：" + slug);
    assert.ok(typeof rejected.body.reason === "string" && rejected.body.reason, "failed 携带 reason：" + slug);
  }
  assert.equal(existsSync(join(wsRoot, "evil.json")), true, "穿越靶文件存活（白名单先于任何路径解析）");
  assert.equal(readFileSync(join(wsRoot, "evil.json"), "utf8"), "OUTSIDE-OPENSPEC", "穿越靶内容不变");
  assert.equal(existsSync(anchorPath("a..b")), true, "`..` 子串 slug 被拒、其锚点保留");

  /* ── failed：删除异常（锚点为目录 → unlink 非 ENOENT） ── */
  const failed = await post({ workspaceId: "ws-alpha", slug: "broken-anchor" });
  assert.equal(failed.status, 200, "删除异常仍恒 200");
  assert.equal(failed.body.outcome, "failed", "unlink 异常 → failed");
  assert.ok(typeof failed.body.reason === "string" && failed.body.reason, "failed 携带可读 reason");
  assert.equal(existsSync(anchorPath("broken-anchor")), true, "删除失败：目标保持原样");

  /* ── 非法请求体 / 方法：恒 200 的 outcome 兜底、非 POST 走 404 ── */
  for (const [label, body] of [
    ["空请求体", {}],
    ["缺 slug", { workspaceId: "ws-alpha" }],
    ["缺 workspaceId", { slug: "keep-embryo" }],
    ["slug 非字符串", { workspaceId: "ws-alpha", slug: 7 }],
    ["全空", null]
  ]) {
    const res = captureJson();
    await handler(stubBodyReq("POST", "/api/dsh-v-cosmos/dismiss-embryo", body), res.res);
    assert.equal(res.status, 200, "非法请求体仍恒 200：" + label);
    assert.ok(["failed", "missing-workspace"].includes(res.body.outcome), "非法请求体走 outcome 兜底：" + label);
  }
  const badJson = captureJson();
  await handler(
    {
      method: "POST",
      url: "/api/dsh-v-cosmos/dismiss-embryo",
      async *[Symbol.asyncIterator]() {
        yield Buffer.from("{not json", "utf8");
      }
    },
    badJson.res
  );
  assert.equal(badJson.status, 200, "坏 JSON 体不抛错（恒 200）");
  assert.equal(existsSync(anchorPath("keep-embryo")), true, "坏请求体零删除");
  const wrongMethod = captureJson();
  await handler({ method: "GET", url: "/api/dsh-v-cosmos/dismiss-embryo" }, wrongMethod.res);
  assert.equal(wrongMethod.status, 404, "只有 POST 注册（GET 落 unknown route）");

  /* ── fs.watch 覆盖删除事件（任务 2.2：既有 watch 范围，不改；此处端到端固化） ──
     锚点删除 → 2s 防抖脏集重扫 → 骨架指纹变化 → `proposals-changed` 轻帧。 */
  {
    const scene1 = captureJson();
    await handler({ method: "GET", url: "/api/dsh-v-cosmos/scene" }, scene1.res);
    assert.equal(scene1.status, 200);
    const pendingOf = (scene) =>
      (scene?.workspaces ?? []).flatMap((ws) => (ws.pending ?? []).map((item) => item.name));
    assert.ok(pendingOf(scene1.body.scene).includes("watch-embryo"), "扫描起点：锚点在骨架 pending 中");

    const sse = captureJson();
    const frames = [];
    sse.res.write = (chunk) => { frames.push(String(chunk)); };
    await handler({ method: "GET", url: "/api/dsh-v-cosmos/events" }, sse.res);
    assert.equal(sse.status, 200, "SSE 通道建立");

    const watched = await post({ workspaceId: "ws-alpha", slug: "watch-embryo" });
    assert.deepEqual(watched.body, { outcome: "deleted" }, "watch 用例：锚点已删");

    const gotProposals = await waitFor(
      () => frames.some((frame) => frame.includes("proposals-changed")),
      8000
    );
    assert.ok(gotProposals, "锚点删除经 fs.watch → proposals-changed 轻帧（2s 防抖内）");

    const scene2 = captureJson();
    await handler({ method: "GET", url: "/api/dsh-v-cosmos/scene" }, scene2.res);
    assert.equal(
      pendingOf(scene2.body.scene).includes("watch-embryo"),
      false,
      "重扫后骨架 pending 不再含该锚点（星胚从场景消失）"
    );
  }

  /* ── 收尾：契约工件仍只被删了预期的锚点（state/changes 零触碰） ── */
  const stateOfExisting = JSON.parse(readFileSync(join(proposalDir("add-existing"), ".state.json"), "utf8"));
  assert.deepEqual(stateOfExisting, { version: 1, state: "reviewed", setBy: "cosmos-review", at: 1700000000001 }, ".state.json 内容零变化");
  assert.deepEqual(
    readdirSync(changesDir).sort(),
    ["add-existing", "guard-embryo"],
    "changes/ 目录集合零变化（目录守卫绝不触碰）"
  );
} finally {
  rmSync(storageHome, { recursive: true, force: true });
  rmSync(wsRoot, { recursive: true, force: true });
}

console.log("dismiss-smoke: all assertions passed");

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

async function waitFor(predicate, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return predicate();
}
