/**
 * 共享配置存储冒烟（add-cosmos-proposal-actions 2.1/2.5 / spec cosmos-button-settings
 * 「按钮配置共享存储」）：路径解析、幂等播种、视图语义（base/user/value）、revision CAS、
 * 复制式备份轮转、损坏恢复链、锁语义（busy / 陈旧接管）、一次性升级、fs.watch 热重载、
 * 与关联存储的独立性。
 * 运行：node test/configstore-smoke.mjs（含 ~1s 的 watch 等待）
 */
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONFIG_STORE_BASENAME,
  ConfigStoreError,
  createConfigStore,
  mergeView,
  normalizeView,
  resolveConfigStorePath,
  resolveDshHome,
  sanitizeStoreDocument,
  storeSectionsOf
} from "../src/configstore.mjs";

const BUTTONS = [{ name: "审查", prompt: "请使用 /cosmos-review 审查本提案", autoSend: true }];
const NORMALIZED = [{ name: "审查", prompt: "请使用 /cosmos-review 审查本提案", autoSend: true, newSession: true }];
const CONST_BUTTONS = [{ name: "探索", prompt: "请使用 /cosmos-explore 探索新需求", autoSend: false }];
const CONST_NORMALIZED = [{ name: "探索", prompt: "请使用 /cosmos-explore 探索新需求", autoSend: false, newSession: true }];

/* ── 1. 路径解析（$DSH_HOME 优先级 / ~ 展开 / 缺省 ~/.dsh） ── */
{
  assert.equal(CONFIG_STORE_BASENAME, "dsh-v-cosmos.config.json", "存储文件名");
  const home = join(tmpdir(), "dsh-home-fixture");
  assert.equal(resolveDshHome({ DSH_HOME: home }, "C:/Users/x"), home, "DSH_HOME 非空优先");
  assert.equal(resolveDshHome({ DSH_HOME: "  " }, "C:/Users/x"), join("C:/Users/x", ".dsh"), "空白 DSH_HOME 回落 ~/.dsh");
  assert.equal(resolveDshHome({}, "C:/Users/x"), join("C:/Users/x", ".dsh"), "无 DSH_HOME → ~/.dsh");
  assert.equal(resolveDshHome({ DSH_HOME: "~/custom" }, "C:/Users/x"), join("C:/Users/x", "custom"), "~ 前缀展开");
  assert.equal(resolveConfigStorePath({ env: { DSH_HOME: home } }), join(home, CONFIG_STORE_BASENAME), "存储绝对路径");
}

/* ── 2. 视图纯函数（normalizeView / mergeView / storeSectionsOf / sanitize） ── */
{
  const view = normalizeView({ buttons: [{ name: "a", prompt: "p" }] });
  assert.equal(view.buttons.length, 1, "组合层视图归一化");
  assert.deepEqual(normalizeView({ buttons: "x" }).buttons, [], "节级非法 → 空（不抛错）");
  assert.deepEqual(normalizeView(null).buttons, [], "缺省 → 空");

  const merged = mergeView({ buttons: [] }, { buttons: NORMALIZED });
  assert.deepEqual(merged.buttons, NORMALIZED, "存储节覆盖 base");
  assert.deepEqual(mergeView({ buttons: NORMALIZED }, null).buttons, NORMALIZED, "节缺席回落 base");
  assert.deepEqual(mergeView({ buttons: NORMALIZED }, {}).buttons, NORMALIZED, "空节对象回落 base");

  assert.equal(storeSectionsOf({ revision: 1 }), null, "无节 → user: null");
  assert.deepEqual(storeSectionsOf({ revision: 1, buttons: [] }), { buttons: [] }, "空数组节 = 显式覆盖");

  assert.equal(sanitizeStoreDocument({ version: 1, buttons: [] }), null, "revision 缺失 → 判损");
  assert.equal(sanitizeStoreDocument({ revision: 0 }), null, "revision 0 → 判损");
  assert.deepEqual(sanitizeStoreDocument({ revision: 2, buttons: [{ name: "a", prompt: "p" }] }).buttons, [
    { name: "a", prompt: "p", autoSend: false, newSession: true }
  ], "装载归一化（补 autoSend/newSession）");
  const dropped = sanitizeStoreDocument({ revision: 2, buttons: [{ name: "", prompt: "p" }] });
  assert.deepEqual(dropped, { revision: 2 }, "节级非法 → 丢弃该节、整份文件不判损");

  /* 读面容错（add-cosmos-action-prestate-gate 4.1）：preState 漂移值原样保留
     （设置页回显「不可用」）；严格视图 / 写路径仍拒绝。 */
  const driftDoc = sanitizeStoreDocument({ revision: 2, buttons: [{ name: "旧行", prompt: "p", preState: "doing" }] });
  assert.equal(driftDoc.buttons[0].preState, "doing", "装载读面保留漂移 preState");
  assert.equal(
    normalizeView({ buttons: [{ name: "旧行", prompt: "p", preState: "doing" }] }, { tolerateUnknownPreState: true }).buttons[0].preState,
    "doing",
    "读面容错投影保留漂移值"
  );
  assert.deepEqual(
    normalizeView({ buttons: [{ name: "旧行", prompt: "p", preState: "doing" }] }).buttons,
    [],
    "严格视图丢弃漂移节（写路径口径）"
  );

  /* ── 星座动作节（add-cosmos-constellation-actions 1.2）：独立节、互不读写 ── */
  assert.deepEqual(normalizeView({}).constellationButtons, [], "缺省 → 空");
  assert.deepEqual(
    normalizeView({ constellationButtons: CONST_BUTTONS }).constellationButtons,
    CONST_NORMALIZED,
    "组合层星座节归一化（无 prepend 键）"
  );
  assert.deepEqual(
    normalizeView({ constellationButtons: [{ name: "a", prompt: "p", prepend: true }] }).constellationButtons,
    [],
    "星座节含 prepend → 节级非法按空（写入另有拦截）"
  );
  assert.equal(normalizeView({ buttons: BUTTONS }).constellationButtons.length, 0, "buttons 节不渗进星座视图");
  assert.equal(normalizeView({ constellationButtons: CONST_BUTTONS }).buttons.length, 0, "星座节不渗进 buttons 视图");

  const bothMerged = mergeView({ buttons: [], constellationButtons: [] }, { constellationButtons: CONST_NORMALIZED });
  assert.deepEqual(bothMerged.constellationButtons, CONST_NORMALIZED, "星座节覆盖各自 base");
  assert.deepEqual(bothMerged.buttons, [], "星座覆盖不影响 buttons 节");
  const independent = mergeView(
    { buttons: NORMALIZED, constellationButtons: CONST_NORMALIZED },
    { buttons: [] }
  );
  assert.deepEqual(independent.buttons, [], "buttons 节覆盖生效");
  assert.deepEqual(independent.constellationButtons, CONST_NORMALIZED, "未覆盖的星座节回落 base（逐节独立）");

  assert.deepEqual(
    storeSectionsOf({ revision: 1, constellationButtons: [] }),
    { constellationButtons: [] },
    "星座空数组节 = 显式覆盖"
  );
  assert.deepEqual(
    storeSectionsOf({ revision: 1, buttons: [], constellationButtons: CONST_NORMALIZED }),
    { buttons: [], constellationButtons: CONST_NORMALIZED },
    "两节并存各自登记"
  );
  assert.deepEqual(
    sanitizeStoreDocument({ revision: 2, constellationButtons: CONST_BUTTONS }).constellationButtons,
    CONST_NORMALIZED,
    "装载归一化星座节（补 autoSend/newSession）"
  );
  const constDropped = sanitizeStoreDocument({ revision: 2, buttons: BUTTONS, constellationButtons: [{ name: "a", prompt: "p", prepend: true }] });
  assert.deepEqual(constDropped, { revision: 2, buttons: NORMALIZED }, "星座节非法只丢该节（buttons 节保留）");

  /* paths 对象节视图语义（step2-cosmos-openspec-path-setting 1.2）：净房恒两键显式、
     节级整体替换、对象节 = 显式覆盖。 */
  assert.deepEqual(normalizeView({}).paths, { openspecPath: null, cosmosSpecDir: null }, "paths 缺省 → 未配置形状");
  assert.deepEqual(
    normalizeView({ paths: { openspecPath: " C:/openspec ", cosmosSpecDir: 1 } }).paths,
    { openspecPath: "C:/openspec", cosmosSpecDir: null },
    "组合层 paths 净房（trim 非空保留字面量 / 非字符串→null）"
  );
  assert.deepEqual(
    mergeView({ paths: { openspecPath: "base" } }, { paths: { openspecPath: "user", cosmosSpecDir: "u" } }).paths,
    { openspecPath: "user", cosmosSpecDir: "u" },
    "paths 节级整体替换（user 存在即整体遮蔽 base，与按钮两节同构）"
  );
  assert.deepEqual(
    mergeView({}, { paths: { openspecPath: "user", cosmosSpecDir: null } }).paths,
    { openspecPath: "user", cosmosSpecDir: null },
    "存储 paths 节覆盖缺省 base"
  );
  assert.deepEqual(
    storeSectionsOf({ revision: 1, paths: { openspecPath: "x", cosmosSpecDir: null } }),
    { paths: { openspecPath: "x", cosmosSpecDir: null } },
    "对象节 = 显式覆盖（含单键配置）"
  );
  assert.deepEqual(
    sanitizeStoreDocument({ revision: 2, paths: { openspecPath: 42, cosmosSpecDir: "  " } }).paths,
    { openspecPath: null, cosmosSpecDir: null },
    "paths 装载归一（垃圾键值 → 未配置形状，不判损）"
  );
}

/* ── 3. 播种 + 快照语义 + CAS + 备份轮转 + 损坏恢复 ── */
const dir = mkdtempSync(join(tmpdir(), "dsh-cosmos-config-"));
const filePath = join(dir, "custom.config.json");
try {
  const store = createConfigStore({ filePath, logger: { warn() {} } });
  assert.equal(store.refresh(), null, "存储缺席 → null");

  /* 缺席快照：revision 0 / user null / value = base */
  {
    const snap = store.snapshot({ buttons: BUTTONS });
    assert.equal(snap.status, "ready");
    assert.equal(snap.revision, 0);
    assert.equal(snap.user, null);
    assert.equal(snap.writable, true);
    assert.deepEqual(snap.value.buttons, [{ name: "审查", prompt: "请使用 /cosmos-review 审查本提案", autoSend: true, newSession: true }], "value = base（归一化）");
  }

  /* 空视图播种：只写 revision/migratedFrom（节缺席 = 未自定义） */
  {
    const outcome = await store.ensureSeeded({}, { source: "entry-config" });
    assert.equal(outcome.action, "seeded", "首次播种");
    const doc = JSON.parse(readFileSync(filePath, "utf8"));
    assert.equal(doc.revision, 1);
    assert.equal(doc.migratedFrom, "entry-config");
    assert.ok(!("buttons" in doc), "空视图不写节");
    assert.equal(store.revision(), 1);

    const again = await store.ensureSeeded({ buttons: BUTTONS }, { source: "entry-config" });
    assert.equal(again.action, "upgraded", "空存储 + 非空组合层 → 一次性升级");
    const upgraded = JSON.parse(readFileSync(filePath, "utf8"));
    assert.equal(upgraded.revision, 1, "升级保持 revision 1");
    assert.deepEqual(upgraded.buttons, NORMALIZED, "升级写入归一化组合层");
    assert.equal((await store.ensureSeeded({ buttons: [] })).action, "kept", "含节 → 不动（幂等）");
  }

  /* CAS 写入：baseRevision 匹配 → revision+1；过期 → conflict */
  {
    store.refresh();
    assert.equal(store.revision(), 1);
    const first = await store.writeSections({ baseRevision: 1, sections: { buttons: [{ name: "draft", prompt: "p" }] } });
    assert.equal(first.revision, 2, "CAS 成功递增");
    assert.equal(store.revision(), 2, "内存态同步");
    let conflict = null;
    try {
      await store.writeSections({ baseRevision: 1, sections: { buttons: [] } });
    } catch (error) {
      conflict = error;
    }
    assert.ok(conflict instanceof ConfigStoreError);
    assert.equal(conflict.code, "conflict", "过期 revision → conflict");
    assert.equal(conflict.revision, 2, "conflict 携带服务端当前 revision");
    assert.equal(store.revision(), 2, "冲突不改变存储");

    /* unset（null）移除节；再 set 回来 */
    const unset = await store.writeSections({ baseRevision: 2, sections: { buttons: null } });
    assert.equal(unset.revision, 3);
    assert.equal(store.sections(), null, "unset → user: null");
    const set = await store.writeSections({ baseRevision: 3, sections: { buttons: BUTTONS } });
    assert.equal(set.revision, 4);
    assert.deepEqual(store.sections().buttons, NORMALIZED, "写入落归一化输出");

    /* 星座节：独立 CAS 写入/清除，buttons 节逐字不变（spec 场景「与提案动作配置隔离」）。 */
    const buttonsSnapshot = JSON.stringify(store.sections().buttons);
    const constWrite = await store.writeSections({ baseRevision: 4, sections: { constellationButtons: CONST_BUTTONS } });
    assert.equal(constWrite.revision, 5, "星座节写入递增 revision");
    assert.deepEqual(store.sections().constellationButtons, CONST_NORMALIZED, "星座节落归一化输出（无 prepend）");
    assert.equal(JSON.stringify(store.sections().buttons), buttonsSnapshot, "星座写入不改写 buttons 节");
    const constClear = await store.writeSections({ baseRevision: 5, sections: { constellationButtons: null } });
    assert.equal(constClear.revision, 6);
    assert.deepEqual(store.sections(), { buttons: NORMALIZED }, "只清星座节（buttons 节保留）");
    const constAgain = await store.writeSections({ baseRevision: 6, sections: { constellationButtons: CONST_BUTTONS } });
    assert.equal(constAgain.revision, 7);

    /* paths 节（step2-cosmos-openspec-path-setting 1.1/1.3）：对象节 CAS 写入、净房、
       键级 unset、节级 unset 与 conflict——与按钮两节同链路、互不读写。 */
    const pathsWrite = await store.writeSections({
      baseRevision: 7,
      sections: { paths: { openspecPath: "  C:/openspec  ", cosmosSpecDir: 42 } }
    });
    assert.equal(pathsWrite.revision, 8, "对象节写入递增 revision");
    assert.deepEqual(
      store.sections().paths,
      { openspecPath: "C:/openspec", cosmosSpecDir: null },
      "paths 落归一化输出（trim 非空保留字面量 / 非字符串→null）"
    );
    assert.deepEqual(store.snapshot({}).value.paths, { openspecPath: "C:/openspec", cosmosSpecDir: null }, "快照 value.paths 回显配置值");

    /* 键级 unset = 写整节、单键置 null；同节其余键保持（trim 后反斜杠字面量原样）。 */
    const keyUnset = await store.writeSections({ baseRevision: 8, sections: { paths: { openspecPath: null, cosmosSpecDir: " D:\\cosmos-spec " } } });
    assert.equal(keyUnset.revision, 9);
    assert.deepEqual(store.sections().paths, { openspecPath: null, cosmosSpecDir: "D:\\cosmos-spec" }, "键级 unset（null→未配置），余键保留字面量");

    /* 节补丁缺席键按 null：净房输出恒两键显式（快照回显形状稳定）。 */
    const partial = await store.writeSections({ baseRevision: 9, sections: { paths: { openspecPath: "   " } } });
    assert.equal(partial.revision, 10);
    assert.deepEqual(store.sections().paths, { openspecPath: null, cosmosSpecDir: null }, "空白/缺席键净房为 null（恒两键显式）");

    /* 节级 unset（null）移除节：按钮两节逐字保留。 */
    const pathsUnset = await store.writeSections({ baseRevision: 10, sections: { paths: null } });
    assert.equal(pathsUnset.revision, 11);
    assert.deepEqual(store.sections(), { buttons: NORMALIZED, constellationButtons: CONST_NORMALIZED }, "paths 节级 unset 移除节（既有节保留）");
    assert.deepEqual(store.snapshot({}).value.paths, { openspecPath: null, cosmosSpecDir: null }, "unset 后快照回显未配置形状");

    /* paths CAS 冲突（过期 revision → conflict 携带服务端 revision，存储保持不变）。 */
    let pathsConflict = null;
    try {
      await store.writeSections({ baseRevision: 10, sections: { paths: { openspecPath: "x" } } });
    } catch (error) {
      pathsConflict = error;
    }
    assert.ok(pathsConflict instanceof ConfigStoreError && pathsConflict.code === "conflict", "过期 revision 写 paths → conflict");
    assert.equal(pathsConflict.revision, 11, "conflict 携带服务端当前 revision");
    assert.equal(store.sections().paths, undefined, "conflict 不改变存储（paths 未被写入）");
  }

  /* 非法请求：400 语义（invalid） */
  {
    for (const body of [
      {},
      { baseRevision: -1, sections: { buttons: [] } },
      { baseRevision: 0, sections: {} },
      { baseRevision: 0, sections: { unknown: [] } },
      { baseRevision: 0, sections: { buttons: "x" } },
      { baseRevision: 0, sections: { buttons: [{ name: "a", prompt: "p", newSession: false }] } },
      { baseRevision: 0, sections: { buttons: [{ name: "a", prompt: "p", preState: "doing" }] } },
      { baseRevision: 7, sections: { constellationButtons: [{ name: "a", prompt: "p", prepend: true }] } },
      { baseRevision: 0, sections: { paths: "x" } },
      { baseRevision: 0, sections: { paths: [] } },
      { baseRevision: 0, sections: { buttons: { openspecPath: "x" } } }
    ]) {
      let error = null;
      try {
        await store.writeSections(body);
      } catch (caught) {
        error = caught;
      }
      assert.ok(error instanceof ConfigStoreError && error.code === "invalid", "非法请求 → invalid: " + JSON.stringify(body));
    }
  }

  /* 复制式备份轮转 + 损坏恢复链 */
  {
    const before = readFileSync(filePath, "utf8");
    await store.writeSections({ baseRevision: 11, sections: { buttons: [{ name: "r5", prompt: "p" }] } }); // → r12, bak.1 = r11
    await store.writeSections({ baseRevision: 12, sections: { buttons: [{ name: "r6", prompt: "p" }] } }); // → r13, bak.1 = r12, bak.2 = r11
    assert.ok(existsSync(`${filePath}.bak.1`) && existsSync(`${filePath}.bak.2`), "备份轮转生成 .bak.1/.bak.2");
    assert.notEqual(readFileSync(`${filePath}.bak.1`, "utf8"), before, ".bak.1 = 上一次写入前内容");

    /* 损坏正式文件 → 从 .bak.1 恢复（最近完好版本 = r12） */
    writeFileSync(filePath, "{ corrupt", "utf8");
    const recovered = store.refresh();
    assert.ok(recovered, "损坏 → 恢复链读回");
    assert.equal(recovered.revision, 12, "恢复最近完好版本（.bak.1 = r12）");

    /* 三份备份也损坏 → 按存储缺席回落（revision 0、value = base） */
    for (const suffix of [".bak.1", ".bak.2", ".bak.3"]) {
      if (existsSync(filePath + suffix)) writeFileSync(filePath + suffix, "nope", "utf8");
    }
    assert.equal(store.refresh(), null, "全损 → 存储缺席");
    const degraded = store.snapshot({ buttons: BUTTONS });
    assert.equal(degraded.revision, 0);
    assert.deepEqual(degraded.value.buttons, NORMALIZED, "回落组合层");
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

/* ── 3b. paths 节旧文件兼容与装载归一（step2-cosmos-openspec-path-setting 1.3） ── */
{
  const legacyDir = mkdtempSync(join(tmpdir(), "dsh-cosmos-paths-legacy-"));
  try {
    const legacyPath = join(legacyDir, "legacy.config.json");
    const store = createConfigStore({ filePath: legacyPath, logger: { warn() {} } });

    /* 旧文件（无 paths 节）读出按未配置：user 不含 paths、生效值未配置形状。 */
    writeFileSync(legacyPath, JSON.stringify({ revision: 3, buttons: NORMALIZED }), "utf8");
    store.refresh();
    assert.deepEqual(store.sections(), { buttons: NORMALIZED }, "旧文件无 paths 节 → user 只有既有节");
    assert.deepEqual(store.snapshot({}).value.paths, { openspecPath: null, cosmosSpecDir: null }, "无 paths 节 → 生效值未配置形状");
    assert.equal(store.revision(), 3, "旧文件 revision 照常装载");

    /* 装载归一：垃圾键值（数字/空白串）→ 净房为未配置形状（不判损、不抛错）。 */
    writeFileSync(legacyPath, JSON.stringify({ revision: 4, paths: { openspecPath: 42, cosmosSpecDir: "   " } }), "utf8");
    store.refresh();
    assert.deepEqual(store.sections().paths, { openspecPath: null, cosmosSpecDir: null }, "垃圾键值装载归一为 null（节保留）");
    assert.equal(store.revision(), 4, "归一不丢 revision");

    /* 数组形状（对象节的非法形态）→ 净房为未配置形状（不判损）。 */
    writeFileSync(legacyPath, JSON.stringify({ revision: 5, paths: ["C:/openspec"] }), "utf8");
    store.refresh();
    assert.deepEqual(store.sections().paths, { openspecPath: null, cosmosSpecDir: null }, "数组形状装载归一为未配置（不判损）");
    assert.equal(store.revision(), 5, "归一不丢 revision");

    /* 播种/升级非空判定：全 null paths 视图不播种节（spec「全 null = 未配置」）。 */
    const freshPath = join(legacyDir, "fresh.config.json");
    const fresh = createConfigStore({ filePath: freshPath, logger: { warn() {} } });
    const outcome = fresh.seed({ paths: { openspecPath: null, cosmosSpecDir: null } }, { source: "test" });
    assert.equal(outcome.seeded, true, "全 null paths 播种成功");
    const freshDoc = JSON.parse(readFileSync(freshPath, "utf8"));
    assert.ok(!("paths" in freshDoc), "全 null paths 不写节（无内容）");
    const upgraded = await fresh.ensureSeeded({ paths: { openspecPath: "C:/openspec", cosmosSpecDir: null } }, { source: "test" });
    assert.equal(upgraded.action, "upgraded", "已配置 paths → 一次性升级写入");
    assert.deepEqual(JSON.parse(readFileSync(freshPath, "utf8")).paths, { openspecPath: "C:/openspec", cosmosSpecDir: null }, "升级写入已配置 paths 节");
  } finally {
    rmSync(legacyDir, { recursive: true, force: true });
  }
}

/* ── 4. 锁语义：busy 超时 / 陈旧锁接管 ── */
const lockDir = mkdtempSync(join(tmpdir(), "dsh-cosmos-lock-"));
try {
  const lockPath = join(lockDir, "locked.config.json.lock");
  const store = createConfigStore({ filePath: join(lockDir, "locked.config.json"), lockWaitMs: 40, lockStepMs: 10, logger: { warn() {} } });
  store.seed({}, { source: "test" });

  /* 新鲜锁（另一写者持锁）→ busy */
  writeFileSync(lockPath, JSON.stringify({ pid: process.pid, at: Date.now() }), "utf8");
  let busy = null;
  try {
    await store.writeSections({ baseRevision: 1, sections: { buttons: [] } });
  } catch (error) {
    busy = error;
  }
  assert.ok(busy instanceof ConfigStoreError);
  assert.equal(busy.code, "busy", "锁等待超时 → busy（HTTP 503）");
  assert.equal(store.revision(), 1, "busy 不改变存储");

  /* 陈旧锁（超阈值）→ 接管重建并成功写入 */
  writeFileSync(lockPath, JSON.stringify({ pid: 999999, at: Date.now() - 60_000 }), "utf8");
  const taken = await store.writeSections({ baseRevision: 1, sections: { buttons: [{ name: "after-stale", prompt: "p" }] } });
  assert.equal(taken.revision, 2, "陈旧锁被接管，写入成功");
  assert.ok(!existsSync(lockPath), "写完释放锁文件");
} finally {
  rmSync(lockDir, { recursive: true, force: true });
}

/* ── 5. fs.watch 热重载（他端写入 → 回调） ── */
const watchDir = mkdtempSync(join(tmpdir(), "dsh-cosmos-watch-"));
try {
  const filePath = join(watchDir, "watch.config.json");
  const store = createConfigStore({ filePath, watchDebounceMs: 20, logger: { warn() {} } });
  store.ensureSeeded({}, { source: "test" });
  let changes = 0;
  const stop = store.watch(() => {
    changes += 1;
  });
  /* 模拟他端进程写入（整份替换） */
  writeFileSync(filePath, JSON.stringify({ revision: 7, buttons: NORMALIZED }), "utf8");
  await sleep(400);
  assert.ok(changes >= 1, "watch 回调触发（秒级内）");
  store.refresh();
  assert.equal(store.revision(), 7, "refresh 读到外部 revision");
  stop();
  const settled = changes;
  writeFileSync(filePath, JSON.stringify({ revision: 8, buttons: [] }), "utf8");
  await sleep(200);
  assert.equal(changes, settled, "stop 后不再回调");
} finally {
  rmSync(watchDir, { recursive: true, force: true });
}

/* ── 6. 与关联存储独立（只触碰 `<DSH_HOME>/dsh-v-cosmos.config.json*`） ── */
{
  const home = mkdtempSync(join(tmpdir(), "dsh-cosmos-home-indep-"));
  try {
    const storageDir = join(home, "storages");
    mkdirSync(storageDir, { recursive: true });
    const assocPath = join(storageDir, "dsh-v-cosmos.json");
    writeFileSync(assocPath, JSON.stringify({ version: 1, entries: [] }), "utf8");
    const assocBefore = readFileSync(assocPath, "utf8");

    const store = createConfigStore({ filePath: resolveConfigStorePath({ env: { DSH_HOME: home } }), logger: { warn() {} } });
    await store.ensureSeeded({ buttons: BUTTONS }, { source: "test" });
    await store.writeSections({ baseRevision: 1, sections: { buttons: [] } });
    await store.writeSections({ baseRevision: 2, sections: { buttons: null } });
    assert.equal(readFileSync(assocPath, "utf8"), assocBefore, "按钮配置读写不改动关联存储");
    assert.ok(existsSync(join(home, CONFIG_STORE_BASENAME)), "配置存储落在 $DSH_HOME 根");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/* ── 7. 备份复制语义：写入期间正式文件不出现缺席窗口（onBeforeReplace 钩子） ── */
{
  const dir2 = mkdtempSync(join(tmpdir(), "dsh-cosmos-atomic-"));
  try {
    const filePath = join(dir2, "atomic.config.json");
    let observed = null;
    const store = createConfigStore({
      filePath,
      logger: { warn() {} },
      onBeforeReplace: () => {
        observed = existsSync(filePath);
      }
    });
    store.seed({ buttons: BUTTONS }, { source: "test" });
    await store.writeSections({ baseRevision: 1, sections: { buttons: [{ name: "b", prompt: "p" }] } });
    assert.equal(observed, true, "临时文件替换前正式文件仍在（无缺席窗口）");
    assert.ok(!existsSync(`${filePath}.tmp`), "临时文件已 rename 消费");
    /* 备份内容 = 替换前正式文件（复制式） */
    assert.deepEqual(JSON.parse(readFileSync(`${filePath}.bak.1`, "utf8")).buttons, NORMALIZED, ".bak.1 为上一次内容");
    copyFileSync(`${filePath}.bak.1`, join(dir2, "verify.json")); // 可读性守卫
  } finally {
    rmSync(dir2, { recursive: true, force: true });
  }
}

console.log("configstore-smoke: all assertions passed");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
