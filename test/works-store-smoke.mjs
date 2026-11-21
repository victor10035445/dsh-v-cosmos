/**
 * 作品存储冒烟（p1-add-cosmos-works-service 1.4）：净房 / 去重 / 上限 / 最小形 /
 * 容器键回收 / 批量原子（含批内第 N 条非法整批拒绝）/ 原子写往返 / 快照投影。
 * 运行：node test/works-store-smoke.mjs
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  WORKS_LIMIT,
  WORKS_VERSION,
  addWorkEntries,
  baseNameOf,
  createWorksStore,
  emptyWorksDoc,
  extensionOf,
  findWork,
  kindOf,
  normalizeRelPath,
  normalizeWorkEntry,
  normalizeWorksDoc,
  publicWorkOf,
  publicWorksSnapshotOf,
  removeWorkEntry,
  resolveWorksStorePath,
  touchLaunched,
  updateWorkEntry,
  worksOf
} from "../src/works-store.mjs";

const NOW = 1_700_000_000_000;
let idSeq = 0;
const idFactory = () => `w-${idSeq++}`;
const add = (doc, relPaths, extra = {}) => addWorkEntries(doc, { wsId: "ws-1", relPaths, now: NOW, idFactory, ...extra });

/* ── 1. 扩展名 → kind 映射（design D4 执行白名单的唯一判据） ── */
assert.equal(kindOf("tools/build.bat"), "exec", "bat → exec");
assert.equal(kindOf("tools/RUN.CMD"), "exec", "cmd 大小写不敏感 → exec");
assert.equal(kindOf("bin/tool.EXE"), "exec", "exe → exec");
assert.equal(kindOf("docs/spec.md"), "md", "md → md");
assert.equal(kindOf("docs/spec.pdf"), "pdf", "pdf → pdf");
assert.equal(kindOf("demo/index.html"), "html", "html → html");
assert.equal(kindOf("scripts/run.ps1"), "other", "ps1 明确不入执行白名单（design D4）");
assert.equal(kindOf("data/notes.txt"), "other", "清单外扩展名 → other");
assert.equal(kindOf("Makefile"), "other", "无扩展名 → other");
assert.equal(kindOf("dir.v2/Makefile"), "other", "仅文件名部分取扩展名（目录点号不算）");
assert.equal(extensionOf("a/b.TXT"), "txt", "扩展名小写化");
assert.equal(baseNameOf("a/b/c.md"), "c.md", "文件名部分");

/* ── 2. relPath 净房（spec「路径净房」场景） ── */
assert.deepEqual(normalizeRelPath("tools\\build.bat"), { ok: true, relPath: "tools/build.bat" }, "反斜杠归一");
assert.deepEqual(normalizeRelPath("./tools//build.bat"), { ok: true, relPath: "tools/build.bat" }, "./ 与空段消去");
assert.deepEqual(normalizeRelPath("  docs/spec.md  "), { ok: true, relPath: "docs/spec.md" }, "首尾空白裁剪");
assert.deepEqual(normalizeRelPath("tools\\..\\tools\\build.bat"), { ok: false, reason: "out-of-root" }, "含 .. 段拒绝（spec 同款用例）");
assert.deepEqual(normalizeRelPath("..\\etc"), { ok: false, reason: "out-of-root" }, "起首 .. 段拒绝");
assert.deepEqual(normalizeRelPath("/etc/passwd"), { ok: false, reason: "out-of-root" }, "绝对路径拒绝");
assert.deepEqual(normalizeRelPath("\\windows\\x"), { ok: false, reason: "out-of-root" }, "反斜杠绝对路径拒绝");
assert.deepEqual(normalizeRelPath("C:\\proj\\a.bat"), { ok: false, reason: "out-of-root" }, "盘符路径拒绝");
assert.deepEqual(normalizeRelPath("//host/share/x"), { ok: false, reason: "out-of-root" }, "UNC 拒绝");
assert.deepEqual(normalizeRelPath(""), { ok: false, reason: "invalid" }, "空串拒绝");
assert.deepEqual(normalizeRelPath("   "), { ok: false, reason: "invalid" }, "空白拒绝");
assert.deepEqual(normalizeRelPath("."), { ok: false, reason: "invalid" }, "仅 . → invalid");
assert.deepEqual(normalizeRelPath(42), { ok: false, reason: "invalid" }, "非字符串拒绝");
assert.deepEqual(normalizeRelPath("a\u0000b"), { ok: false, reason: "invalid" }, "NUL 拒绝");

/* ── 3. 条目归一化：最小形 + kind 重算 + 脏条目丢弃 ── */
const stored = normalizeWorkEntry({
  id: "w-1",
  wsId: "ws-1",
  relPath: "tools\\build.bat",
  kind: "other", // 手工改库不能扩大执行面：kind 恒由扩展名重算
  addedAt: NOW
});
assert.deepEqual(Object.keys(stored).sort(), ["addedAt", "id", "kind", "relPath", "wsId"], "未设置的可选键不输出（最小形）");
assert.equal(stored.relPath, "tools/build.bat", "读面同样归一 relPath");
assert.equal(stored.kind, "exec", "kind 由扩展名重算（不信任存量 kind）");
/* 读面容错**不净房**：越界形态留到端点裁决（否则 spec「越界与缺文件守卫」会降级成
   entry-unknown）。写入面仍严格拒绝（见第 4 段）。 */
assert.equal(
  normalizeWorkEntry({ id: "w", wsId: "ws", relPath: "../outside.bat", addedAt: NOW }).relPath,
  "../outside.bat",
  "读面保留 .. 段（端点据此返回 out-of-root）"
);
assert.equal(
  normalizeWorkEntry({ id: "w", wsId: "ws", relPath: "C:\\Windows\\x.bat", addedAt: NOW }).relPath,
  "C:/Windows/x.bat",
  "读面保留盘符形态（resolve 后必然越界）"
);
assert.equal(normalizeWorkEntry({ id: "w", wsId: "ws", relPath: "  ", addedAt: NOW }), null, "空白 relPath → 条目丢弃");
assert.equal(normalizeWorkEntry({ id: "w", wsId: "ws", relPath: 42, addedAt: NOW }), null, "非字符串 relPath → 条目丢弃");
assert.equal(normalizeWorkEntry({ id: "", wsId: "ws", relPath: "a.md", addedAt: NOW }), null, "空 id → 丢弃");
assert.equal(normalizeWorkEntry(null), null, "非对象 → 丢弃");
const rich = normalizeWorkEntry({ id: "w-2", wsId: "ws-1", relPath: "a.md", kind: "md", addedAt: NOW, lastLaunchedAt: NOW + 5, name: " 文档 ", note: " 备注 " });
assert.equal(rich.name, "文档", "name trim");
assert.equal(rich.note, "备注", "note trim");
assert.equal(rich.lastLaunchedAt, NOW + 5, "lastLaunchedAt 保留");
assert.equal("name" in normalizeWorkEntry({ id: "w-3", wsId: "ws-1", relPath: "b.md", addedAt: NOW, name: "   " }), false, "空白 name → 键删除");

/* ── 4. 登记：落盘形状（spec「登记条目落盘形状」） ── */
const first = add(emptyWorksDoc(), ["tools\\build.bat"]);
assert.equal(first.ok, true, "登记成功");
assert.deepEqual(
  Object.keys(first.entries[0]).sort(),
  ["addedAt", "id", "kind", "relPath", "wsId"],
  "新增条目不含 name/note/lastLaunchedAt（存储最小形）"
);
assert.equal(first.entries[0].relPath, "tools/build.bat", "落盘 relPath 已归一");
assert.equal(first.entries[0].kind, "exec", "落盘 kind 映射");
assert.equal(first.entries[0].addedAt, NOW, "addedAt 取注入时钟");
assert.equal(first.entries[0].wsId, "ws-1", "条目自包含 wsId");

/* 去重（在册 + 批内） */
assert.equal(add(first.doc, ["tools/build.bat"]).reason, "duplicate", "同归一化 relPath 重复拒绝");
assert.equal(add(first.doc, [".\\tools\\.\\build.bat"]).reason, "duplicate", "归一后重复同样拒绝");
assert.equal(add(first.doc, ["docs/a.md", "docs/./a.md"]).reason, "duplicate", "批内重复拒绝");
assert.equal(add(first.doc, []).reason, "invalid", "空批次拒绝");
assert.equal(add(first.doc, ["   "]).reason, "invalid", "空白路径拒绝");
assert.equal(add(emptyWorksDoc(), []).reason, "invalid", "空文档空批次拒绝");

/* 批量成功：一次两条各得独立 id */
const batch = add(first.doc, ["docs/a.md", "demo/index.html"]);
assert.equal(batch.ok, true, "批量登记成功");
assert.deepEqual(batch.entries.map((entry) => entry.kind), ["md", "html"], "批内逐条 kind 映射");
assert.equal(new Set(batch.entries.map((entry) => entry.id)).size, 2, "两条各得独立 id");
assert.equal(worksOf(batch.doc, "ws-1").entries.length, 3, "批量三条同批在册");

/* 上限：32 条后第 33 条拒绝 */
let limitDoc = emptyWorksDoc();
for (let index = 0; index < WORKS_LIMIT; index += 1) {
  const step = add(limitDoc, [`files/f${index}.md`], { idFactory: () => `lim-${index}` });
  assert.equal(step.ok, true, `第 ${index + 1} 条登记成功`);
  limitDoc = step.doc;
}
const overLimit = add(limitDoc, ["files/over.md"]);
assert.equal(overLimit.reason, "limit", "第 33 条拒绝（reason=limit）");
assert.equal(worksOf(overLimit.doc, "ws-1").entries.length, WORKS_LIMIT, "超限拒绝后存储不变");
const overBatch = add(emptyWorksDoc(), Array.from({ length: WORKS_LIMIT + 1 }, (_, i) => `x/${i}.md`));
assert.equal(overBatch.reason, "limit", "单批超上限同样拒绝");

/* ── 5. 批量原子：批内第 N 条非法 ⇒ 整批拒绝、前序条目不落盘 ── */
const atomicBase = add(first.doc, ["ok/one.md"]).doc;
const rejected = add(atomicBase, ["ok/two.md", "dir/notafile"], {
  checkFile: (relPath) => (relPath === "dir/notafile" ? { ok: false, reason: "not-a-file" } : { ok: true })
});
assert.equal(rejected.ok, false, "第 2 条非法 → 整批拒绝");
assert.equal(rejected.reason, "not-a-file", "reason 透传首错");
assert.equal(rejected.relPath, "dir/notafile", "首错定位到具体 relPath");
assert.equal(rejected.doc, atomicBase, "整批拒绝后文档同一性不变（第 1 条未落盘）");
assert.equal(findWork(rejected.doc, "ws-1", "w-none"), null, "拒绝后无新增条目");
const accepted = add(atomicBase, ["ok/two.md"], { checkFile: () => ({ ok: true }) });
assert.equal(accepted.ok, true, "全部通过 → 整批落盘");
assert.equal(worksOf(accepted.doc, "ws-1").entries.length, 3, "通过后两条同批在册");

/* checkFile 抛错归 not-a-file（端点裁决异常不得炸穿端点） */
const throwing = add(emptyWorksDoc(), ["a.md"], { checkFile: () => { throw new Error("boom"); } });
assert.equal(throwing.reason, "not-a-file", "裁决异常 → not-a-file");
/* 形态错误先于磁盘裁决（不浪费 IO，reason 不被覆盖） */
const formFirst = add(emptyWorksDoc(), ["../escape.md"], { checkFile: () => { throw new Error("should not run"); } });
assert.equal(formFirst.reason, "out-of-root", "形态净房先于磁盘裁决");

/* ── 6. 改名/备注：最小形与清除回落 ── */
const named = updateWorkEntry(batch.doc, { wsId: "ws-1", workId: batch.entries[0].id, name: "构建脚本", note: "入口 A" });
assert.equal(named.ok, true, "改名成功");
assert.equal(named.entry.name, "构建脚本", "name 写入");
assert.equal(named.entry.note, "入口 A", "note 写入");
assert.equal(named.entry.relPath, "docs/a.md", "relPath 不变");
assert.equal(named.entry.kind, "md", "kind 不变");
assert.equal(named.entry.addedAt, NOW, "addedAt 不变");
const cleared = updateWorkEntry(named.doc, { wsId: "ws-1", workId: batch.entries[0].id, name: "", note: "   " });
assert.equal("name" in cleared.entry, false, "空串 name → 键删除（回落文件名）");
assert.equal("note" in cleared.entry, false, "空白 note → 键删除");
assert.equal(JSON.stringify(cleared.entry), JSON.stringify(batch.entries[0]), "清除后逐字节回到最小形");
const absentClears = updateWorkEntry(named.doc, { wsId: "ws-1", workId: batch.entries[0].id });
assert.equal("name" in absentClears.entry, false, "缺席 = 清除（端点语义：全额覆盖）");
const noteOnly = updateWorkEntry(named.doc, { wsId: "ws-1", workId: batch.entries[0].id, note: "只改备注" });
assert.equal("name" in noteOnly.entry, false, "仅传 note 时 name 缺席 → 同样清除");
assert.equal(noteOnly.entry.note, "只改备注", "note 生效");
assert.equal(updateWorkEntry(named.doc, { wsId: "ws-1", workId: "ghost", name: "x" }).reason, "entry-unknown", "未知条目 → entry-unknown");

/* ── 7. 移除：仅条目 + 容器键回收 ── */
const withOnly = add(emptyWorksDoc(), ["only.md"], { idFactory: () => "w-only" }).doc;
const removedLast = removeWorkEntry(withOnly, { wsId: "ws-1", workId: "w-only" });
assert.equal(removedLast.ok, true, "移除成功");
assert.equal("ws-1" in removedLast.doc.works, false, "清空星座 → wsId 容器键回收（存储最小形）");
assert.deepEqual(removedLast.doc, emptyWorksDoc(), "文档回落空文档");
const removedOne = removeWorkEntry(batch.doc, { wsId: "ws-1", workId: batch.entries[0].id });
assert.equal(worksOf(removedOne.doc, "ws-1").entries.length, 2, "还有其余条目 → 容器保留");
assert.equal(removeWorkEntry(batch.doc, { wsId: "ws-1", workId: "ghost" }).reason, "entry-unknown", "未知条目移除 → entry-unknown");

/* ── 8. 启动记账 ── */
const launched = touchLaunched(batch.doc, { wsId: "ws-1", workId: batch.entries[1].id, now: NOW + 999 });
assert.equal(launched.ok, true, "记账成功");
assert.equal(launched.entry.lastLaunchedAt, NOW + 999, "lastLaunchedAt 写入");
assert.equal(launched.entry.relPath, "demo/index.html", "记账不触碰身份字段");
assert.equal(touchLaunched(batch.doc, { wsId: "ws-1", workId: "ghost" }).reason, "entry-unknown", "未知条目记账 → entry-unknown");

/* ── 9. 文档归一化（版本漂移/脏数据/空容器） ── */
const dirty = normalizeWorksDoc({
  version: WORKS_VERSION,
  works: {
    "ws-1": { entries: [batch.entries[0], batch.entries[0], { bogus: true }] },
    "ws-empty": { entries: [] },
    "  ": { entries: [batch.entries[1]] }
  }
});
assert.equal(dirty.works["ws-1"].entries.length, 1, "同 id 去重、脏条目丢弃");
assert.equal("ws-empty" in dirty.works, false, "空容器不建档（最小形）");
assert.equal("" in dirty.works, false, "空白 wsId 丢弃");
assert.deepEqual(normalizeWorksDoc({ version: 99, works: { "ws-1": { entries: [batch.entries[0]] } } }), emptyWorksDoc(), "版本漂移 → 空文档");
assert.deepEqual(normalizeWorksDoc("not a doc"), emptyWorksDoc(), "非对象 → 空文档");
const samePathDifferentId = normalizeWorksDoc({
  version: WORKS_VERSION,
  works: { "ws-1": { entries: [{ id: "a", wsId: "ws-1", relPath: "a.md", addedAt: NOW }, { id: "b", wsId: "ws-1", relPath: "a.md", addedAt: NOW }] } }
});
assert.equal(samePathDifferentId.works["ws-1"].entries.length, 1, "同归一化 relPath 去重（读面容错）");

/* ── 10. 快照投影（exists / displayName / wsId 过滤 / 空星座） ── */
const snapshot = publicWorksSnapshotOf(named.doc, {
  existsOf: (wsId, entry) => entry.relPath !== "demo/index.html"
});
assert.equal(snapshot.version, WORKS_VERSION, "快照版本");
assert.deepEqual(
  snapshot.works["ws-1"].entries.map((entry) => entry.relPath),
  ["tools/build.bat", "docs/a.md", "demo/index.html"],
  "快照按登记序（stable，未做重排语义）"
);
assert.equal(snapshot.works["ws-1"].entries[0].displayName, "build.bat", "name 缺席 → displayName 回落文件名");
assert.equal(snapshot.works["ws-1"].entries[1].displayName, "构建脚本", "设置 name → displayName 取 name");
assert.equal(snapshot.works["ws-1"].entries[1].exists, true, "exists 由注入判定");
assert.equal(snapshot.works["ws-1"].entries[2].exists, false, "逐条 exists 独立判定");
assert.equal(snapshot.works["ws-1"].entries.length, 3, "全量快照含全部条目");
const filtered = publicWorksSnapshotOf(named.doc, { wsId: "ws-1" });
assert.deepEqual(Object.keys(filtered.works), ["ws-1"], "wsId 过滤");
const unknown = publicWorksSnapshotOf(named.doc, { wsId: "ghost" });
assert.deepEqual(unknown.works, { ghost: { entries: [] } }, "未知/空星座 → 空 entries（不报错）");
const unregistered = publicWorksSnapshotOf(named.doc, { wsId: "ws-1", knownOf: () => false });
assert.deepEqual(unregistered.works, { "ws-1": { entries: [] } }, "工作区不在册 → 空 entries（残留条目不投影）");
const noResolver = publicWorksSnapshotOf(named.doc);
assert.equal(noResolver.works["ws-1"].entries.every((entry) => entry.exists === false), true, "无判定注入 → exists 恒 false");
const projected = publicWorkOf({ id: "x", wsId: "ws-1", relPath: "a/b.md", kind: "md", addedAt: NOW });
assert.deepEqual(projected, {
  id: "x", wsId: "ws-1", relPath: "a/b.md", kind: "md", addedAt: NOW, displayName: "b.md", exists: false
}, "投影字段集固定（可选键不输出）");

/* ── 11. 存储句柄：路径 / 原子写往返 / 损坏与缺失回落 / 写失败不抛 ── */
const home = mkdtempSync(join(tmpdir(), "cosmos-works-store-"));
const filePath = join(home, "storages", "dsh-v-cosmos.works.json");
try {
  assert.equal(
    resolveWorksStorePath({ env: { DSH_HOME: home } }),
    filePath,
    "存储路径 = $DSH_HOME/storages/dsh-v-cosmos.works.json"
  );
  let tick = NOW;
  let generated = 0;
  const store = createWorksStore({ filePath, now: () => tick, idFactory: () => `w-gen-${generated++}` });
  store.load();
  const stored1 = store.add({ wsId: "ws-1", relPaths: ["tools/build.bat"] });
  assert.equal(stored1.ok, true, "句柄登记成功");
  assert.equal(stored1.entries[0].id, "w-gen-0", "注入 idFactory 生效");
  assert.equal(stored1.entries[0].addedAt, NOW, "注入 now 生效");
  const onDisk = JSON.parse(readFileSync(filePath, "utf8"));
  assert.equal(onDisk.version, WORKS_VERSION, "落盘版本");
  assert.equal(onDisk.works["ws-1"].entries[0].relPath, "tools/build.bat", "落盘条目");
  assert.equal("name" in onDisk.works["ws-1"].entries[0], false, "落盘最小形（无 name 键）");

  /* 新句柄回读（原子写往返） */
  tick += 1000;
  const reopened = createWorksStore({ filePath, now: () => tick });
  reopened.load();
  assert.equal(reopened.snapshot({ wsId: "ws-1" }).works["ws-1"].entries[0].id, "w-gen-0", "原子写往返可读");
  assert.equal(reopened.find("ws-1", "w-gen-0").kind, "exec", "回读 kind 映射");
  /* 更新/移除/记账也走原子写 */
  assert.equal(reopened.update({ wsId: "ws-1", workId: "w-gen-0", name: "构建" }).ok, true, "句柄改名");
  assert.equal(JSON.parse(readFileSync(filePath, "utf8")).works["ws-1"].entries[0].name, "构建", "改名落盘");
  assert.equal(reopened.touch({ wsId: "ws-1", workId: "w-gen-0" }).ok, true, "句柄记账");
  assert.equal(JSON.parse(readFileSync(filePath, "utf8")).works["ws-1"].entries[0].lastLaunchedAt, NOW + 1000, "记账落盘");
  assert.equal(reopened.remove({ wsId: "ws-1", workId: "w-gen-0" }).ok, true, "句柄移除");
  assert.deepEqual(JSON.parse(readFileSync(filePath, "utf8")), emptyWorksDoc(), "容器键回收落盘");

  /* 损坏文件 → 空文档（首写即建） */
  const damaged = createWorksStore({ filePath, read: () => "{not json", write: () => {} });
  damaged.load();
  assert.deepEqual(damaged.doc, emptyWorksDoc(), "损坏文件 → 空文档");
  /* 注入 read：缺失文件 → 空文档 */
  const missing = createWorksStore({ filePath: join(home, "nope.json"), read: () => null });
  missing.load();
  assert.deepEqual(missing.doc, emptyWorksDoc(), "文件缺失 → 空文档");
  /* 写失败不抛出（内存态权威） */
  const failing = createWorksStore({ filePath, write: () => { throw new Error("disk full"); } });
  failing.load();
  assert.equal(failing.add({ wsId: "ws-1", relPaths: ["a.md"] }).ok, true, "写失败仍返回成功（内存态）");
} finally {
  rmSync(home, { recursive: true, force: true });
}

console.log("works-store-smoke: all assertions passed");
