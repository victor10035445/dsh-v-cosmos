/**
 * 星座作品端点接线冒烟（p1-add-cosmos-works-service 4.1–4.4）：
 * 真实临时工作区 + stub ctx 直调 apply() 真调路由 handler，覆盖
 *  - 4.1 全链（browse → add → 快照 exists → update → open(exec 与 md) → remove → 容器键回收）；
 *  - 4.1b 系统文件选择器登记（picker 注入：取消静默 / 根外 / 重复 / 并发单飞 / 失败 / 上限）；
 *  - 4.2 安全断言（裸 path 注入被忽略 / `../` 与绝对路径全拒 / 符号链接不可导航不可登记 /
 *        手工改库的越界条目 → `out-of-root` / 非 Windows → `platform-unsupported`）；
 *  - 4.3 零侵入（增删改前后工作区逐字节一致、`openspec list` 输出一致）；
 *  - 4.4 帧纪律（add/update/remove/open 各恰一帧、帧体零载荷、reveal 零帧）。
 * 进程启动全程桩注入（零真实进程：测试绝不启动 bat/exe/资源管理器）。
 * 运行：node test/works-wiring-smoke.mjs
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { apply } from "../src/index.mjs";
import {
  addWorks,
  browseWorks,
  fetchWorks,
  openWork,
  pickWorks,
  removeWork,
  revealWork,
  updateWork
} from "../src/api.mjs";
import { WORKS_VERSION } from "../src/works-store.mjs";

const cleanupDirs = [];
const tempDir = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
};
const writeFixture = (root, relPath, text) => {
  const abs = join(root, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
  return abs;
};

/* ── 0. 夹具：工作区（脚本/文档/目录/openspec 工件）+ 作品存储 home ── */
const wsRoot = tempDir("dsh-cosmos-works-ws-");
const files = {
  "tools/build.bat": "@echo off\r\necho built\r\n",
  "docs/readme.md": "# readme\n",
  "docs/spec.pdf": "%PDF-1.4\n",
  /* cmd 元字符文件名（引号纪律回归：`&` 不得被 cmd 当作命令分隔符） */
  "docs/report&notes.md": "# notes & more\n",
  "index.html": "<!doctype html><title>demo</title>\n",
  "scripts/run.ps1": "Write-Host hi\n",
  "bin/tool.exe": "MZ-fake-binary\n",
  "assets/logo.png": "PNG-fake\n"
};
for (const [relPath, text] of Object.entries(files)) writeFixture(wsRoot, relPath, text);
/* 上限夹具：批量 34 条（> WORKS_LIMIT=32，单批即拒） */
const bulkPaths = Array.from({ length: 34 }, (_, index) => `bulk/f${String(index).padStart(2, "0")}.md`);
for (const relPath of bulkPaths) writeFixture(wsRoot, relPath, "# bulk\n");
/* openspec 工件（零侵入断言的 CLI 数据源） */
writeFixture(wsRoot, "openspec/changes/add-a/tasks.md", "- [ ] one\n");
writeFixture(wsRoot, "openspec/changes/add-a/proposal.md", "# Demo\n");

/* 符号链接（Windows 无特权时普通符号链接不可建 → 目录链接改走 junction（同样呈
   `isSymbolicLink()`，零特权可用）；文件符号链接不保证可建，相关断言按可用性跳过） */
const outsideRoot = tempDir("dsh-cosmos-works-outside-");
writeFileSync(join(outsideRoot, "secret.md"), "# secret\n");
const linkDirReady = (() => {
  try {
    symlinkSync(outsideRoot, join(wsRoot, "escape-link"), process.platform === "win32" ? "junction" : "dir");
    return true;
  } catch {
    return false;
  }
})();
const linkFileReady = (() => {
  try {
    symlinkSync(join(outsideRoot, "secret.md"), join(wsRoot, "docs", "link.md"));
    return true;
  } catch {
    return false;
  }
})();

const home = tempDir("dsh-cosmos-works-home-");
process.env.DSH_HOME = home;
const storePath = join(home, "storages", "dsh-v-cosmos.works.json");
const readStore = () => JSON.parse(readFileSync(storePath, "utf8"));

const workspaces = [{ id: "ws1", title: "WS One", path: wsRoot, sessionIds: [] }];

/* ── stub ctx（webServer 捕获 handler）── */
let handler = null;
let frames = [];
let spawnStub = null;

function makeCtx(options = {}) {
  return {
    logger: { warn() {} },
    effect(fn) {
      return fn();
    },
    inject() {},
    on() {
      return () => {};
    },
    webServer: {
      register(def) {
        options.assign?.(def.handler);
        return () => {};
      }
    },
    workspaceRegistry: {
      list: () => workspaces,
      get archivedSessionIds() {
        return new Set();
      }
    },
    agents: { get: () => null },
    sessions: { get: () => null },
    sessionController: null,
    tools: null
  };
}

/** 记录式进程启动桩（error 监听与 unref 均记账；恒返回可链对象）。 */
function makeSpawnStub() {
  const calls = [];
  const spawn = (command, args, spawnOptions) => {
    const record = { command, args, options: spawnOptions, errorBound: false, unrefCalled: false };
    calls.push(record);
    return {
      on(event) {
        if (event === "error") record.errorBound = true;
      },
      unref() {
        record.unrefCalled = true;
      }
    };
  };
  return { calls, spawn };
}

/**
 * 启动一个应用实例（每次启动都把作品存储重置为给定文档，默认空文档——各段断言互不污染）。
 * @param {{platform?: string, preload?: object|null, pickFiles?: Function|null}} [options]
 */
function boot({ platform = "win32", preload = null, pickFiles = null } = {}) {
  mkdirSync(dirname(storePath), { recursive: true });
  const doc = preload ?? { version: WORKS_VERSION, works: {} };
  writeFileSync(storePath, JSON.stringify(doc, null, 2) + "\n");
  frames = [];
  spawnStub = makeSpawnStub();
  let captured = null;
  const ctx = makeCtx({ assign: (value) => { captured = value; } });
  const applyOptions = { platform, spawn: spawnStub.spawn };
  if (typeof pickFiles === "function") applyOptions.pickFiles = pickFiles;
  apply(ctx, { buttons: [] }, applyOptions);
  assert.ok(captured, "apply 注册了 API handler");
  handler = captured;
}

/* ── 请求桩 ── */
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

const API = "/api/dsh-v-cosmos";
const getJson = async (url) => {
  const state = captureJson();
  await handler({ method: "GET", url }, state.res);
  return state;
};
const postJson = async (path, body) => {
  const state = captureJson();
  await handler(stubBodyReq("POST", API + path, body), state.res);
  return state;
};
const browseUrl = (wsId, dir) =>
  API + "/works/browse?wsId=" + encodeURIComponent(wsId) + (dir === undefined ? "" : "&dir=" + encodeURIComponent(dir));
const browseOf = async (wsId, dir) => getJson(browseUrl(wsId, dir));
const addOf = (wsId, relPaths) => postJson("/works/add", { wsId, relPaths });
const workOf = async (wsId, relPathOfEntry) => {
  const state = await getJson(API + "/works?wsId=" + encodeURIComponent(wsId));
  assert.equal(state.status, 200, "快照 200");
  const entry = state.body.works[wsId].entries.find((item) => item.relPath === relPathOfEntry);
  assert.ok(entry, "快照含目标条目 " + relPathOfEntry);
  return entry;
};

/** SSE 订阅（只收 data 帧；心跳注释与 retry 行不进帧面） */
async function subscribe() {
  const sseRes = {
    writeHead() {},
    write(chunk) {
      const text = String(chunk);
      if (text.startsWith("data: ")) frames.push(text);
    },
    end() {},
    on() {}
  };
  await handler({ method: "GET", url: API + "/events" }, sseRes);
}

const dataFrames = () => frames.map((line) => line.trim()).filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)));
const worksFrames = () => dataFrames().filter((frame) => frame.type === "works-changed");

/* ── 1. 目录浏览（2.2 / spec「目录浏览端点」） ── */
{
  boot();
  const root = await browseOf("ws1");
  assert.equal(root.status, 200, "根浏览 200");
  assert.equal(root.body.ok, true, "根浏览 ok:true");
  assert.equal(root.body.cwd, "", "根 cwd 为根相对标记");
  assert.equal(root.body.parent, "", "根 parent 为空");
  assert.equal(root.body.truncated, false, "小目录不截断");
  const names = root.body.entries.map((entry) => entry.name);
  const dirNames = root.body.entries.filter((entry) => entry.type === "dir").map((entry) => entry.name);
  assert.deepEqual(
    [...dirNames].sort((a, b) => a.localeCompare(b)),
    ["assets", "bin", "bulk", "docs", "openspec", "scripts", "tools"],
    "目录类型齐全"
  );
  assert.equal(names.at(-1), "index.html", "文件在目录之后");
  const firstFileIndex = root.body.entries.findIndex((entry) => entry.type !== "dir");
  assert.equal(
    root.body.entries.slice(0, firstFileIndex).every((entry) => entry.type === "dir"),
    true,
    "目录全部前置（dir 在前、file 在后）"
  );
  assert.deepEqual(
    dirNames,
    [...dirNames].sort((a, b) => a.localeCompare(b)),
    "同类按名称大小写不敏感排序"
  );
  if (linkDirReady) {
    assert.equal(root.body.entries.find((entry) => entry.name === "escape-link")?.type, "symlink", "根内符号链接目录 → type symlink");
  }

  const tools = await browseOf("ws1", "tools");
  assert.equal(tools.status, 200, "子目录浏览 200");
  assert.equal(tools.body.cwd, "tools", "cwd 回显相对路径");
  assert.equal(tools.body.parent, "", "tools 的 parent 为根");
  assert.deepEqual(tools.body.entries.map((entry) => entry.name), ["build.bat"], "子目录条目");
  assert.equal(tools.body.entries[0].type, "file", "文件类型");
  assert.equal(typeof tools.body.entries[0].size, "number", "文件附 size");

  assert.equal((await browseOf("ws1", "docs")).body.parent, "", "docs parent 为空");
  if (linkFileReady) {
    assert.equal(
      (await browseOf("ws1", "docs")).body.entries.find((entry) => entry.name === "link.md")?.type,
      "symlink",
      "文件符号链接 → type symlink（不追随）"
    );
  } else {
    assert.equal(
      (await browseOf("ws1", "docs")).body.entries.some((entry) => entry.name === "link.md"),
      false,
      "无文件符号链接夹具时不出现 link.md"
    );
  }
  assert.equal((await browseOf("ws1", "docs/readme.md")).body.reason, "not-a-directory", "文件路径作 dir → not-a-directory");
  assert.equal((await browseOf("ws1", "nope")).body.reason, "missing-on-disk", "不存在目录 → missing-on-disk");
  assert.equal((await browseOf("ws1", "nope")).status, 404, "缺失目录 404");
  assert.equal((await browseOf("ws1", "../")).body.reason, "out-of-root", "dir=../ 越界拒绝");
  assert.equal((await browseOf("ws1", "C:\\")).body.reason, "out-of-root", "dir=盘符 越界拒绝");
  assert.equal((await browseOf("ws1", "/etc")).body.reason, "out-of-root", "dir=绝对路径 越界拒绝");
  if (linkDirReady) {
    assert.equal((await browseOf("ws1", "escape-link")).body.reason, "symlink", "符号链接目录不可导航进入");
  }
  assert.equal((await browseOf("", undefined)).body.reason, "invalid", "缺 wsId → invalid");
  assert.equal((await browseOf("ghost", undefined)).status, 404, "未在册工作区 404");
  assert.equal((await browseOf("ghost", undefined)).body.reason, "workspace/unknown", "未在册工作区 reason");
  assert.equal(spawnStub.calls.length, 0, "浏览零进程");
}

/* ── 2. 登记（2.3 / spec「登记端点与批量原子语义」） ── */
{
  boot();
  await subscribe();
  const added = await addOf("ws1", ["tools\\build.bat", "docs/readme.md"]);
  assert.equal(added.status, 200, "批量登记 200");
  assert.equal(added.body.ok, true, "批量登记 ok:true");
  assert.deepEqual(added.body.entries.map((entry) => entry.kind), ["exec", "md"], "kind 逐条映射");
  assert.deepEqual(added.body.entries.map((entry) => entry.relPath), ["tools/build.bat", "docs/readme.md"], "反斜杠归一落盘");
  assert.equal(new Set(added.body.entries.map((entry) => entry.id)).size, 2, "两条各得独立 id");
  assert.equal(worksFrames().length, 1, "登记广播恰一帧 works-changed");

  const stored = readStore();
  assert.equal(stored.version, WORKS_VERSION, "落盘版本");
  assert.deepEqual(
    Object.keys(stored.works.ws1.entries[0]).sort(),
    ["addedAt", "id", "kind", "relPath", "wsId"],
    "落盘最小形（无 name/note/lastLaunchedAt 键）"
  );

  const bytesBefore = readFileSync(storePath);
  const framesBefore = worksFrames().length;
  assert.equal((await addOf("ws1", ["tools/build.bat"])).body.reason, "duplicate", "重复登记 → duplicate");
  assert.equal((await addOf("ws1", ["./docs/./readme.md"])).body.reason, "duplicate", "归一后重复 → duplicate");
  assert.equal(readFileSync(storePath).equals(bytesBefore), true, "重复拒绝后存储逐字节不变");
  assert.equal(worksFrames().length, framesBefore, "重复拒绝零帧");

  /* 批量原子：第 2 条非法 ⇒ 第 1 条不落盘、零帧（spec「批量原子拒绝」） */
  const atomic = await addOf("ws1", ["bin/tool.exe", "nope/missing.exe"]);
  assert.equal(atomic.status, 400, "批量原子拒绝 400");
  assert.equal(atomic.body.reason, "not-a-file", "第 2 条非法 → not-a-file");
  assert.equal(atomic.body.relPath, "nope/missing.exe", "首错定位");
  const afterAtomic = await getJson(API + "/works?wsId=ws1");
  assert.deepEqual(
    afterAtomic.body.works.ws1.entries.map((entry) => entry.relPath),
    ["tools/build.bat", "docs/readme.md"],
    "整批拒绝后第 1 条未落盘（仅前段两条在册）"
  );
  assert.equal(readFileSync(storePath).equals(bytesBefore), true, "整批拒绝后第 1 条未落盘");
  assert.equal(worksFrames().length, framesBefore, "整批拒绝零帧");

  assert.equal((await addOf("ws1", ["assets"])).body.reason, "not-a-file", "目录 → not-a-file");
  assert.equal((await addOf("ws1", ["../evil.bat"])).body.reason, "out-of-root", "含 .. 段 → out-of-root");
  assert.equal((await addOf("ws1", ["C:\\Windows\\notepad.exe"])).body.reason, "out-of-root", "绝对路径 → out-of-root");
  assert.equal((await addOf("ws1", ["/etc/passwd"])).body.reason, "out-of-root", "POSIX 绝对路径 → out-of-root");
  if (linkFileReady) {
    assert.equal((await addOf("ws1", ["docs/link.md"])).body.reason, "symlink", "符号链接文件不可登记");
  }
  if (linkDirReady) {
    assert.equal((await addOf("ws1", ["escape-link"])).body.reason, "symlink", "符号链接目录不可登记");
  }
  assert.equal((await addOf("ghost", ["index.html"])).body.reason, "workspace/unknown", "未在册工作区 → workspace/unknown");
  assert.equal((await postJson("/works/add", { relPaths: ["index.html"] })).body.reason, "invalid", "缺 wsId → invalid");

  /* 请求净房：裸 `path` 字段不参与裁决（只认 relPaths/relPath） */
  const injected = await postJson("/works/add", { wsId: "ws1", relPaths: ["index.html"], path: "../../evil.bat" });
  assert.equal(injected.body.ok, true, "裸 path 字段被忽略，relPaths 正常登记");
  assert.deepEqual(injected.body.entries.map((entry) => entry.relPath), ["index.html"], "只登记合法 relPath");

  /* 上限：单批 34 条 > 32 → limit（整批拒绝） */
  const overLimit = await addOf("ws1", bulkPaths);
  assert.equal(overLimit.body.reason, "limit", "单批超上限 → limit");
  const snapshot = await getJson(API + "/works?wsId=ws1");
  assert.equal(snapshot.body.works.ws1.entries.length, 3, "超限批次零落盘（仍 3 条）");
  assert.equal(spawnStub.calls.length, 0, "登记零进程");
}

/* ── 2.5 系统文件选择器登记（用户修订：作品拾取走宿主原生对话框，无自建模态） ── */
{
  let pickCalls = 0;
  let pickImpl = async () => null;
  boot({
    pickFiles: (root) => {
      pickCalls += 1;
      assert.equal(root, wsRoot, "原生选择器初值 = 工作区根");
      return pickImpl(root);
    }
  });
  await subscribe();
  const pickOf = (wsId) => postJson("/works/pick", { wsId });

  /* 取消 = 静默 200，零帧、零落盘 */
  const cancelled = await pickOf("ws1");
  assert.equal(cancelled.status, 200, "取消 200");
  assert.equal(cancelled.body.ok, true, "取消 ok:true");
  assert.equal(cancelled.body.cancelled, true, "取消标记");
  assert.equal(cancelled.body.entries.length, 0, "取消零条目");
  assert.equal(worksFrames().length, 0, "取消零帧");

  /* 绝对路径 → 根内相对路径，整批原子登记；恰一帧 */
  pickImpl = async () => [join(wsRoot, "tools", "build.bat"), join(wsRoot, "docs", "readme.md")];
  const picked = await pickOf("ws1");
  assert.equal(picked.status, 200, "选择登记 200");
  assert.equal(picked.body.ok, true, "选择登记 ok:true");
  assert.equal(picked.body.picked, 2, "选中件数");
  assert.deepEqual(picked.body.entries.map((entry) => entry.relPath), ["tools/build.bat", "docs/readme.md"], "绝对路径收敛为根内相对路径");
  assert.deepEqual(picked.body.entries.map((entry) => entry.kind), ["exec", "md"], "kind 映射同登记链");
  assert.equal(worksFrames().length, 1, "选择登记恰一帧 works-changed");
  assert.equal(pickCalls, 2, "每次请求恰开一次系统对话框");
  assert.equal(spawnStub.calls.length, 0, "注入选择器不触真实进程");

  /* 请求净房：裸 relPaths/path 不参与裁决（只认原生选择器返回的绝对路径） */
  pickImpl = async () => [join(wsRoot, "index.html")];
  const injected = await postJson("/works/pick", {
    wsId: "ws1",
    relPaths: ["../../evil.bat"],
    path: "C:\\Windows\\notepad.exe"
  });
  assert.equal(injected.status, 200, "注入字段被忽略");
  assert.deepEqual(injected.body.entries.map((entry) => entry.relPath), ["index.html"], "只登记选择器返回的文件");

  /* 根外文件 → out-of-root，整批拒绝（首错带文件名） */
  pickImpl = async () => [join(outsideRoot, "secret.md")];
  const outside = await pickOf("ws1");
  assert.equal(outside.status, 400, "根外 400");
  assert.equal(outside.body.reason, "out-of-root", "根外 reason");
  assert.ok(String(outside.body.message).includes("secret.md"), "错误消息点名文件");

  /* 重复/目录/符号链接与登记链同语汇 */
  pickImpl = async () => [join(wsRoot, "tools", "build.bat")];
  assert.equal((await pickOf("ws1")).body.reason, "duplicate", "重复选择 → duplicate");
  pickImpl = async () => [join(wsRoot, "assets")];
  assert.equal((await pickOf("ws1")).body.reason, "not-a-file", "目录 → not-a-file");
  if (linkFileReady) {
    pickImpl = async () => [join(wsRoot, "docs", "link.md")];
    assert.equal((await pickOf("ws1")).body.reason, "symlink", "符号链接 → symlink");
  }

  /* 选择器抛错 → picker-failed；缺 wsId/未知 ws 不打开对话框 */
  pickImpl = async () => { throw new Error("dialog boom"); };
  const failed = await pickOf("ws1");
  assert.equal(failed.status, 500, "选择器失败 500");
  assert.equal(failed.body.reason, "picker-failed", "选择器失败 reason");
  const callsBefore = pickCalls;
  assert.equal((await postJson("/works/pick", {})).body.reason, "invalid", "缺 wsId → invalid");
  assert.equal((await postJson("/works/pick", { wsId: "ghost" })).body.reason, "workspace/unknown", "未知星座 → workspace/unknown");
  assert.equal(pickCalls, callsBefore, "非法请求不打开系统对话框");

  /* 并发单飞：对话框打开期间再次请求 → 409 picker-busy */
  let release;
  const gate = new Promise((resolveGate) => { release = resolveGate; });
  pickImpl = () => gate.then(() => null);
  const first = pickOf("ws1");
  await new Promise((resolveTick) => setTimeout(resolveTick, 20));
  const busy = await pickOf("ws1");
  assert.equal(busy.status, 409, "并发 409");
  assert.equal(busy.body.reason, "picker-busy", "并发 reason");
  release();
  await first;
}

/* ── 3. 快照（2.1 / spec「作品快照端点」） ── */
{
  const snapshot = await getJson(API + "/works");
  assert.equal(snapshot.status, 200, "全量快照 200");
  assert.equal(snapshot.body.ok, true, "快照 ok:true");
  assert.equal(snapshot.body.works.ws1.entries.length, 3, "全量快照含 ws1 条目");
  assert.equal(snapshot.body.works.ws1.entries.every((entry) => typeof entry.exists === "boolean"), true, "逐条 exists 布尔");
  assert.equal(snapshot.body.works.ws1.entries.every((entry) => entry.exists === true), true, "文件在盘 → exists:true");
  assert.equal((await workOf("ws1", "tools/build.bat")).displayName, "build.bat", "无 name → displayName 回落文件名");

  /* 外部删除一条 → 仅该条 exists:false，其余不受影响（端点只读） */
  const readmeAbs = join(wsRoot, "docs", "readme.md");
  const batBefore = readFileSync(join(wsRoot, "tools", "build.bat"), "utf8");
  unlinkSync(readmeAbs);
  const afterDelete = await getJson(API + "/works?wsId=ws1");
  const byPath = Object.fromEntries(afterDelete.body.works.ws1.entries.map((entry) => [entry.relPath, entry.exists]));
  assert.deepEqual(byPath, { "tools/build.bat": true, "docs/readme.md": false, "index.html": true }, "逐条存在性核验");
  assert.equal(readFileSync(join(wsRoot, "tools", "build.bat"), "utf8"), batBefore, "快照不改动文件");
  writeFileSync(readmeAbs, files["docs/readme.md"]);
  assert.equal((await workOf("ws1", "docs/readme.md")).exists, true, "文件恢复 → exists 回 true");

  assert.deepEqual((await getJson(API + "/works?wsId=ghost")).body.works, { ghost: { entries: [] } }, "未知星座 → 空 entries");
  assert.deepEqual(Object.keys((await getJson(API + "/works?wsId=ws1")).body.works), ["ws1"], "wsId 过滤");
}

/* ── 4. 改名/备注（2.4 / spec「改名与备注端点」） ── */
{
  const framesBefore = worksFrames().length;
  const readme = await workOf("ws1", "docs/readme.md");
  const renamed = await postJson("/works/update", { wsId: "ws1", workId: readme.id, name: "说明文档", note: "入口 A" });
  assert.equal(renamed.status, 200, "改名 200");
  assert.equal(renamed.body.entry.name, "说明文档", "name 写入");
  assert.equal(renamed.body.entry.note, "入口 A", "note 写入");
  assert.equal(renamed.body.entry.displayName, "说明文档", "displayName 取 name");
  assert.equal(renamed.body.entry.relPath, readme.relPath, "relPath 不变");
  assert.equal(renamed.body.entry.kind, readme.kind, "kind 不变");
  assert.equal(renamed.body.entry.addedAt, readme.addedAt, "addedAt 不变");
  assert.equal("lastLaunchedAt" in renamed.body.entry, false, "未启动 → 无 lastLaunchedAt");
  assert.equal(worksFrames().length, framesBefore + 1, "改名广播恰一帧");
  const onDisk = readStore().works.ws1.entries.find((entry) => entry.id === readme.id);
  assert.equal(onDisk.name, "说明文档", "name 落盘");
  assert.equal(onDisk.relPath, readme.relPath, "身份字段落盘不变");

  const cleared = await postJson("/works/update", { wsId: "ws1", workId: readme.id, name: "", note: "  " });
  assert.equal("name" in cleared.body.entry, false, "空串 name → 清除");
  assert.equal("note" in cleared.body.entry, false, "空白 note → 清除");
  assert.equal(cleared.body.entry.displayName, "readme.md", "显示名回落文件名");

  const framesNoop = worksFrames().length;
  const unknown = await postJson("/works/update", { wsId: "ws1", workId: "w-ghost", name: "x" });
  assert.equal(unknown.status, 404, "未知条目 404");
  assert.equal(unknown.body.reason, "entry-unknown", "未知条目 reason");
  assert.equal(worksFrames().length, framesNoop, "失败零帧");
  assert.equal((await postJson("/works/update", { wsId: "ws1" })).body.reason, "invalid", "缺 workId → invalid");
}

/* ── 5. 启动（2.6 / spec「启动端点与执行白名单」） ── */
{
  const framesBefore = worksFrames().length;
  const bat = await workOf("ws1", "tools/build.bat");
  const opened = await postJson("/works/open", { wsId: "ws1", workId: bat.id });
  assert.equal(opened.status, 200, "open(exec) 200");
  assert.equal(opened.body.ok, true, "open(exec) ok:true");
  assert.equal(spawnStub.calls.length, 1, "恰一次进程启动");
  const execCall = spawnStub.calls[0];
  assert.equal(execCall.command, "cmd.exe", "bat 经 cmd.exe 启动");
  assert.equal(execCall.args[0], "/c", "bat 经 cmd /c");
  assert.equal(execCall.args[1], '"' + join(wsRoot, "tools", "build.bat") + '"', "目标 = 条目绝对路径（非注入路径；整体加引号）");
  assert.equal(execCall.options.windowsVerbatimArguments, true, "引号由本层权威给出（关掉 Node 二次处理）");
  assert.equal(execCall.options.cwd, join(wsRoot, "tools"), "cwd = 条目所在目录（design D5）");
  assert.equal(execCall.options.detached, true, "detached（即发即忘）");
  assert.equal(execCall.options.stdio, "ignore", "不捕获输出");
  assert.equal(execCall.unrefCalled, true, "unref（不阻塞请求）");
  assert.equal(execCall.errorBound, true, "异步 error 已挂监听（不升级为未捕获异常）");
  assert.equal(typeof opened.body.entry.lastLaunchedAt, "number", "open 回填 lastLaunchedAt");
  assert.equal(worksFrames().length, framesBefore + 1, "open 广播恰一帧");
  const persisted = readStore().works.ws1.entries.find((entry) => entry.id === bat.id);
  assert.equal(typeof persisted.lastLaunchedAt, "number", "lastLaunchedAt 落盘");
  assert.equal(persisted.relPath, bat.relPath, "启动不触碰身份字段");

  /* 文档类走系统默认程序（`start` 即 ShellExecute 语义，绝不以可执行方式运行） */
  const readme = await workOf("ws1", "docs/readme.md");
  const docFrames = worksFrames().length;
  const openedDoc = await postJson("/works/open", { wsId: "ws1", workId: readme.id });
  assert.equal(openedDoc.status, 200, "open(md) 200");
  const docCall = spawnStub.calls.at(-1);
  assert.equal(docCall.command, "cmd.exe", "文档经 shell 打开");
  assert.deepEqual(
    docCall.args,
    ["/c", "start", '""', '"' + join(wsRoot, "docs", "readme.md") + '"'],
    "start + 空标题 + 加引号的绝对路径"
  );
  assert.equal(worksFrames().length, docFrames + 1, "文档 open 同样一帧");

  /* 裸路径不可注入（spec「裸路径不可注入」）：path 字段被完全忽略 */
  const beforeInjection = spawnStub.calls.length;
  const injectedOpen = await postJson("/works/open", {
    wsId: "ws1",
    workId: readme.id,
    path: join(outsideRoot, "secret.md"),
    abs: "C:\\Windows\\System32\\cmd.exe",
    relPath: "../../evil.bat"
  });
  assert.equal(injectedOpen.status, 200, "注入请求按白名单语义正常执行");
  assert.equal(spawnStub.calls.length, beforeInjection + 1, "只启动一次");
  assert.deepEqual(
    spawnStub.calls.at(-1).args,
    ["/c", "start", '""', '"' + join(wsRoot, "docs", "readme.md") + '"'],
    "目标恒为在册条目（注入字段无效）"
  );

  /* 未知条目/未知星座/缺参：零进程 */
  const beforeUnknown = spawnStub.calls.length;
  assert.equal((await postJson("/works/open", { wsId: "ws1", workId: "w-ghost" })).body.reason, "entry-unknown", "未知条目 → entry-unknown");
  assert.equal((await postJson("/works/open", { wsId: "ghost", workId: readme.id })).body.reason, "workspace/unknown", "未知星座 → workspace/unknown");
  assert.equal((await postJson("/works/open", { wsId: "ws1" })).body.reason, "invalid", "缺 workId → invalid");
  assert.equal(spawnStub.calls.length, beforeUnknown, "校验失败零进程（spec「零进程启动」）");

  /* 缺文件守卫：文件被外部删除 → missing-on-disk，零进程 */
  const batAbs = join(wsRoot, "tools", "build.bat");
  unlinkSync(batAbs);
  const framesMissing = worksFrames().length;
  const missing = await postJson("/works/open", { wsId: "ws1", workId: bat.id });
  assert.equal(missing.status, 404, "缺文件 404");
  assert.equal(missing.body.reason, "missing-on-disk", "缺文件 → missing-on-disk");
  assert.equal(spawnStub.calls.length, beforeUnknown, "缺文件零进程");
  assert.equal(worksFrames().length, framesMissing, "缺文件零帧");
  writeFileSync(batAbs, files["tools/build.bat"]);
}

/* ── 6. 定位（2.7 / spec「资源管理器定位端点」） ── */
{
  const bat = await workOf("ws1", "tools/build.bat");
  const framesBefore = worksFrames().length;
  const beforeCalls = spawnStub.calls.length;
  const revealed = await postJson("/works/reveal", { wsId: "ws1", workId: bat.id });
  assert.equal(revealed.status, 200, "reveal 200");
  assert.equal(revealed.body.ok, true, "reveal ok:true");
  assert.equal(spawnStub.calls.length, beforeCalls + 1, "定位一次");
  const revealCall = spawnStub.calls.at(-1);
  assert.equal(revealCall.command, "explorer.exe", "经资源管理器定位");
  assert.deepEqual(revealCall.args, ["/select," + join(wsRoot, "tools", "build.bat")], "/select 单参数语义");
  assert.equal(revealCall.options.detached, true, "即发即忘");
  assert.equal(worksFrames().length, framesBefore, "定位零帧广播（无文档变更）");

  /* 校验链同源：文件缺失 → missing-on-disk，零管理器窗口 */
  const readme = await workOf("ws1", "docs/readme.md");
  const readmeAbs = join(wsRoot, "docs", "readme.md");
  unlinkSync(readmeAbs);
  const beforeMissing = spawnStub.calls.length;
  const missing = await postJson("/works/reveal", { wsId: "ws1", workId: readme.id });
  assert.equal(missing.status, 404, "缺文件 404");
  assert.equal(missing.body.reason, "missing-on-disk", "reveal 缺文件 → missing-on-disk");
  assert.equal(spawnStub.calls.length, beforeMissing, "零管理器窗口");
  writeFileSync(readmeAbs, files["docs/readme.md"]);
  assert.equal((await postJson("/works/reveal", { wsId: "ws1" })).body.reason, "invalid", "缺 workId → invalid");
}

/* ── 7. 移除（2.5 / spec「移除端点」）+ 容器键回收 ── */
{
  const snapshot = await getJson(API + "/works?wsId=ws1");
  const entries = snapshot.body.works.ws1.entries;
  assert.equal(entries.length, 3, "移除前 3 条");
  const bat = entries.find((entry) => entry.relPath === "tools/build.bat");
  const framesBefore = worksFrames().length;
  const removed = await postJson("/works/remove", { wsId: "ws1", workId: bat.id });
  assert.equal(removed.status, 200, "移除 200");
  assert.deepEqual(removed.body.removed, { id: bat.id, relPath: "tools/build.bat" }, "回执定位被移除条目");
  assert.equal(existsSync(join(wsRoot, "tools", "build.bat")), true, "仅删条目不删文件");
  assert.equal(worksFrames().length, framesBefore + 1, "移除广播恰一帧");
  const framesNoop = worksFrames().length;
  assert.equal((await postJson("/works/remove", { wsId: "ws1", workId: "w-ghost" })).body.reason, "entry-unknown", "未知条目 → entry-unknown");
  assert.equal(worksFrames().length, framesNoop, "失败零帧");

  /* 清空星座 → 容器键回收（文档回落最小形） */
  for (const entry of entries.filter((item) => item.id !== bat.id)) {
    assert.equal((await postJson("/works/remove", { wsId: "ws1", workId: entry.id })).status, 200, "逐条移除 200");
  }
  const emptied = readStore();
  assert.deepEqual(emptied, { version: WORKS_VERSION, works: {} }, "清空星座 → wsId 容器键回收");
  assert.deepEqual((await getJson(API + "/works?wsId=ws1")).body.works, { ws1: { entries: [] } }, "空星座快照为空 entries");
}

/* ── 7.5 cmd 元字符纪律：经 cmd 解析的启动参数必须整体加引号 ──
   白名单保证「启动哪个条目」，引号保证「条目名里的 `&`/`|`/`>` 不被 cmd 当作命令分隔符」
   （否则任意文件名即可成为命令拼接原语，绕过三层收窄）。 */
{
  boot();
  const edge = await addOf("ws1", ["docs/report&notes.md"]);
  assert.equal(edge.body.ok, true, "含 & 的文件名可登记");
  const entry = edge.body.entries[0];
  assert.equal(entry.kind, "md", "& 不影响扩展名映射");
  assert.equal((await postJson("/works/open", { wsId: "ws1", workId: entry.id })).status, 200, "含 & 的条目可打开");
  const edgeCall = spawnStub.calls.at(-1);
  assert.deepEqual(
    edgeCall.args,
    ["/c", "start", '""', '"' + join(wsRoot, "docs", "report&notes.md") + '"'],
    "路径整体加引号（& 落在引号内 → 不是命令分隔符）"
  );
  assert.equal(edgeCall.options.windowsVerbatimArguments, true, "引号由本层权威给出");
  /* 加引号后的字符串里，路径整体被一对引号包住（无引号逃逸） */
  const quoted = edgeCall.args.at(-1);
  assert.equal(quoted.startsWith('"') && quoted.endsWith('"'), true, "首尾成对引号");
  assert.equal(quoted.slice(1, -1), join(wsRoot, "docs", "report&notes.md"), "引号内即原始绝对路径（未转义丢失）");
  assert.equal(quoted.includes('""') && quoted.slice(1, -1).includes('"'), false, "路径内无引号 → 无需双写");
}

/* ── 8. 安全断言（4.2）：手工改库的越界/目录/符号链接条目 + 非 Windows 降级 ── */
{
  const tampered = {
    version: WORKS_VERSION,
    works: {
      ws1: {
        entries: [
          { id: "w-escape", wsId: "ws1", relPath: "../outside.bat", kind: "exec", addedAt: 1 },
          { id: "w-dir", wsId: "ws1", relPath: "assets", kind: "other", addedAt: 1 },
          { id: "w-abs", wsId: "ws1", relPath: "C:/Windows/notepad.exe", kind: "exec", addedAt: 1 },
          ...(linkDirReady ? [
            { id: "w-link", wsId: "ws1", relPath: "escape-link/secret.md", kind: "md", addedAt: 1 },
            { id: "w-junction", wsId: "ws1", relPath: "escape-link", kind: "other", addedAt: 1 }
          ] : [])
        ]
      },
      /* 已从注册表消失的星座：存储残留条目 —— 快照 MUST 呈现空 entries（spec「空星座快照」）。 */
      "ws-gone": { entries: [{ id: "w-gone", wsId: "ws-gone", relPath: "tools/build.bat", kind: "exec", addedAt: 1 }] }
    }
  };
  boot({ preload: tampered });
  const framesBefore = worksFrames().length;
  assert.equal((await postJson("/works/open", { wsId: "ws1", workId: "w-escape" })).body.reason, "out-of-root", "改库逃逸条目 → out-of-root");
  assert.equal((await postJson("/works/open", { wsId: "ws1", workId: "w-abs" })).body.reason, "out-of-root", "改库盘符条目 → out-of-root");
  assert.equal((await postJson("/works/open", { wsId: "ws1", workId: "w-dir" })).body.reason, "not-a-file", "改库目录条目 → not-a-file");
  if (linkDirReady) {
    assert.equal((await postJson("/works/open", { wsId: "ws1", workId: "w-link" })).body.reason, "out-of-root", "父级符号链接逃逸 → out-of-root");
    assert.equal((await postJson("/works/reveal", { wsId: "ws1", workId: "w-link" })).body.reason, "out-of-root", "reveal 同源拒绝");
    assert.equal((await postJson("/works/open", { wsId: "ws1", workId: "w-junction" })).body.reason, "symlink", "条目本身为符号链接 → symlink");
  }
  assert.equal(spawnStub.calls.length, 0, "全部拒绝零进程");
  assert.equal(worksFrames().length, framesBefore, "全部拒绝零帧");
  /* 改库条目仍在快照中（exists:false），不静默消失——诊断语义可读 */
  const snapshot = await getJson(API + "/works?wsId=ws1");
  assert.equal(snapshot.body.works.ws1.entries.every((entry) => entry.exists === false), true, "越界条目 exists:false");
  /* 不在册星座：存储残留条目不投影（空 entries，不报错） */
  const goneSnapshot = await getJson(API + "/works?wsId=ws-gone");
  assert.equal(goneSnapshot.status, 200, "不在册星座快照 200");
  assert.deepEqual(goneSnapshot.body.works, { "ws-gone": { entries: [] } }, "不在册星座 → 空 entries（不报错）");

  /* 非 Windows：启动与定位结构化降级（spec「平台降级」） */
  boot({ platform: "linux" });
  const legal = await addOf("ws1", ["tools/build.bat"]);
  assert.equal(legal.body.ok, true, "非 Windows 登记照常");
  const bat = await workOf("ws1", "tools/build.bat");
  const platformOpen = await postJson("/works/open", { wsId: "ws1", workId: bat.id });
  assert.equal(platformOpen.status, 400, "非 Windows open 400");
  assert.equal(platformOpen.body.reason, "platform-unsupported", "非 Windows open → platform-unsupported");
  assert.equal((await postJson("/works/reveal", { wsId: "ws1", workId: bat.id })).body.reason, "platform-unsupported", "非 Windows reveal → platform-unsupported");
  assert.equal(spawnStub.calls.length, 0, "非 Windows 零进程（不抛未捕获异常）");
}

/* ── 9. 零侵入（4.3 / spec「零侵入不被破坏」） ── */
function hashTree(root) {
  const out = new Map();
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix + entry.name;
      if (entry.isDirectory()) {
        out.set(rel + "/", "dir");
        walk(join(dir, entry.name), rel + "/");
      } else if (entry.isSymbolicLink()) {
        out.set(rel, "symlink");
      } else {
        out.set(rel, createHash("sha256").update(readFileSync(join(dir, entry.name))).digest("hex"));
      }
    }
  };
  walk(root, "");
  return out;
}

function openspecListJson(cwd) {
  try {
    // Windows：openspec 为 .cmd shim → 经 shell 解析（固定字面量整串命令，无注入面）
    if (process.platform === "win32") {
      const result = spawnSync("openspec list --json", { cwd, encoding: "utf8", shell: true });
      return result.status === 0 ? result.stdout : null;
    }
    return execFileSync("openspec", ["list", "--json"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return null;
  }
}

{
  boot();
  await subscribe();
  const treeBefore = hashTree(wsRoot);
  const openspecBefore = openspecListJson(wsRoot);
  assert.ok(openspecBefore !== null, "openspec list 基线可读（零侵入断言需要 CLI）");

  const added = await addOf("ws1", ["tools/build.bat", "index.html"]);
  assert.equal(added.body.ok, true, "零侵入夹具登记成功");
  const bat = added.body.entries[0];
  assert.equal((await postJson("/works/update", { wsId: "ws1", workId: bat.id, name: "构建" })).status, 200, "零侵入夹具改名");
  assert.equal((await postJson("/works/open", { wsId: "ws1", workId: bat.id })).status, 200, "零侵入夹具启动（进程桩）");
  assert.equal((await postJson("/works/reveal", { wsId: "ws1", workId: bat.id })).status, 200, "零侵入夹具定位（进程桩）");
  for (const entry of added.body.entries) {
    assert.equal((await postJson("/works/remove", { wsId: "ws1", workId: entry.id })).status, 200, "零侵入夹具移除");
  }

  const treeAfter = hashTree(wsRoot);
  assert.deepEqual([...treeAfter.entries()], [...treeBefore.entries()], "增删改前后工作区目录逐字节一致（零新增文件）");
  assert.equal(openspecListJson(wsRoot), openspecBefore, "增删改前后 `openspec list --json` 输出逐字节一致");
  assert.equal(existsSync(join(wsRoot, "dsh-v-cosmos")), false, "工作区无插件存储残留");
}

/* ── 10. 帧纪律（4.4）：每动作恰一帧、帧体零载荷 ── */
{
  boot();
  await subscribe();
  const added = await addOf("ws1", ["bin/tool.exe"]);
  assert.equal(worksFrames().length, 1, "add 恰一帧");
  const exe = added.body.entries[0];
  assert.equal((await postJson("/works/update", { wsId: "ws1", workId: exe.id, name: "工具" })).status, 200, "更新 200");
  assert.equal(worksFrames().length, 2, "update 恰一帧");
  assert.equal((await postJson("/works/open", { wsId: "ws1", workId: exe.id })).status, 200, "启动 200");
  assert.equal(worksFrames().length, 3, "open 恰一帧");
  assert.equal((await postJson("/works/reveal", { wsId: "ws1", workId: exe.id })).status, 200, "定位 200");
  assert.equal(worksFrames().length, 3, "reveal 零帧（无文档变更）");
  assert.equal((await postJson("/works/remove", { wsId: "ws1", workId: exe.id })).status, 200, "移除 200");
  assert.equal(worksFrames().length, 4, "remove 恰一帧");
  assert.equal((await addOf("ws1", ["../evil.bat"])).body.ok, false, "失败动作不广播");
  assert.equal(worksFrames().length, 4, "失败零帧");

  const frameTexts = frames.map((line) => line.trim());
  assert.equal(frameTexts.every((line) => line === "data: {\"type\":\"works-changed\"}"), true, "帧体零载荷（仅类型标记）");
  for (const frame of worksFrames()) {
    assert.deepEqual(Object.keys(frame), ["type"], "帧无载荷字段");
    assert.equal(frame.type, "works-changed", "帧类型");
  }
  /* exec 分派：exe 直接 spawn（不经 cmd /c） */
  const exeCall = spawnStub.calls.find((call) => call.command === join(wsRoot, "bin", "tool.exe"));
  assert.ok(exeCall, "exe 直接 spawn");
  assert.deepEqual(exeCall.args, [], "exe 无参数");
  assert.equal(exeCall.options.cwd, join(wsRoot, "bin"), "exe cwd = 条目目录");
  /* start / select 不得混入 exe 启动 */
  assert.equal(spawnStub.calls.some((call) => call.args[0] === "start"), false, "exe 不走 start 打开语义");
}

/* ── 11. 客户端桥（3.1 / spec「客户端 API 桥」） ── */
{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(String(url), "http://127.0.0.1");
    const method = String(init.method ?? "GET").toUpperCase();
    const state = captureJson();
    if (method === "GET") {
      await handler({ method, url: parsed.pathname + parsed.search }, state.res);
    } else {
      await handler(stubBodyReq(method, parsed.pathname + parsed.search, JSON.parse(String(init.body ?? "{}"))), state.res);
    }
    return new Response(JSON.stringify(state.body), {
      status: state.status || 200,
      headers: { "content-type": "application/json" }
    });
  };
  try {
    boot({ pickFiles: async () => [join(wsRoot, "docs", "readme.md")] });
    const added = await addWorks("ws1", ["docs/spec.pdf"]);
    assert.equal(added.ok, true, "addWorks 透传 ok:true");
    assert.equal(added.entries[0].kind, "pdf", "addWorks 载荷透传（无二次包装）");
    const spec = added.entries[0];

    const snapshot = await fetchWorks("ws1");
    assert.equal(snapshot.ok, true, "fetchWorks 成功");
    assert.equal(snapshot.works.ws1.entries[0].relPath, "docs/spec.pdf", "fetchWorks 快照载荷");
    assert.equal((await fetchWorks()).ok, true, "fetchWorks 无参 = 全量");

    const browsed = await browseWorks("ws1", "docs");
    assert.equal(browsed.ok, true, "browseWorks 成功");
    assert.equal(browsed.cwd, "docs", "browseWorks 回显 cwd");

    const picked = await pickWorks("ws1");
    assert.equal(picked.ok, true, "pickWorks 成功");
    assert.deepEqual(picked.entries.map((entry) => entry.relPath), ["docs/readme.md"], "pickWorks 载荷透传");

    const updated = await updateWork("ws1", spec.id, { name: "规格书", note: "v1" });
    assert.equal(updated.ok, true, "updateWork 成功");
    assert.equal(updated.entry.name, "规格书", "updateWork 回执");

    const opened = await openWork("ws1", spec.id);
    assert.equal(opened.ok, true, "openWork 成功");
    assert.equal(typeof opened.entry.lastLaunchedAt, "number", "openWork 回执含记账");

    const revealed = await revealWork("ws1", spec.id);
    assert.equal(revealed.ok, true, "revealWork 成功");

    const removed = await removeWork("ws1", spec.id);
    assert.equal(removed.ok, true, "removeWork 成功");
    assert.equal(removed.removed.relPath, "docs/spec.pdf", "removeWork 回执");

    /* 端点失败：容错形（不抛出） */
    const failed = await openWork("ws1", spec.id);
    assert.equal(failed.ok, false, "失败 → ok:false");
    assert.equal(failed.reason, "entry-unknown", "失败透传 reason");
    assert.equal((await browseWorks("ws1", "../")).reason, "out-of-root", "browse 失败透传 reason");

    /* 端点不可达（连接拒绝）：全部返回 {ok:false,error} 而非抛出 */
    globalThis.fetch = async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:3080");
    };
    for (const [label, call] of [
      ["fetchWorks", () => fetchWorks("ws1")],
      ["browseWorks", () => browseWorks("ws1")],
      ["addWorks", () => addWorks("ws1", ["a.md"])],
      ["pickWorks", () => pickWorks("ws1")],
      ["updateWork", () => updateWork("ws1", "w", { name: "x" })],
      ["removeWork", () => removeWork("ws1", "w")],
      ["openWork", () => openWork("ws1", "w")],
      ["revealWork", () => revealWork("ws1", "w")]
    ]) {
      const result = await call();
      assert.equal(result.ok, false, label + " 不可达 → ok:false");
      assert.equal(typeof result.error, "string", label + " 带 error 说明");
      assert.equal(result.error.includes("ECONNREFUSED"), true, label + " error 透出原始原因");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
}

/* ── 11.5 系统选择器登记的上限（32 条）由登记链裁决 ── */
{
  const full = Array.from({ length: 32 }, (_, index) => ({
    id: "cap-" + index, wsId: "ws1", relPath: "bulk/f" + index + ".md", kind: "md", addedAt: 1
  }));
  boot({
    preload: { version: WORKS_VERSION, works: { ws1: { entries: full } } },
    pickFiles: async () => [join(wsRoot, "index.html")]
  });
  const limit = await postJson("/works/pick", { wsId: "ws1" });
  assert.equal(limit.status, 400, "超上限 400");
  assert.equal(limit.body.reason, "limit", "超上限 → limit");
}

/* ── 清理 ── */
for (const dir of cleanupDirs) rmSync(dir, { recursive: true, force: true });
assert.equal(existsSync(wsRoot), false, "临时工作区已清理");
assert.equal(existsSync(home), false, "临时 home 已清理");
console.log(
  "works-wiring-smoke: all assertions passed" +
    "（符号链接夹具：目录链接" +
    (linkDirReady ? "可用" : "不可用（相关断言跳过）") +
    " / 文件链接" +
    (linkFileReady ? "可用" : "不可用（相关断言跳过）") +
    "）"
);
