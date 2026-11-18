/**
 * 技能 provider 纯逻辑冒烟（step3-cosmos-skill-provider-render 1.3）：
 * canonical 根解析序 / 技能束枚举与 frontmatter / 令牌渲染（整词替换、双分隔符折叠、
 * 路径中部与左边界不替换、裸令牌不构成出现、未配置警示）/ 兜底路径解析与反馈组合 /
 * canonical 文件字节不变（渲染只作用于返回值）。
 * 运行：node test/skill-provider-smoke.mjs
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PROVIDER_NAME,
  PROVIDER_RANK,
  PATH_TOKEN,
  CANONICAL_WATCH_DEBOUNCE_MS,
  stripTrailingSeparators,
  isTokenOccurrenceAt,
  isValidSkillName,
  renderSkillContent,
  unsolvedTokenWarningLine,
  resolveTokenPath,
  composeTokenFeedback,
  resolveCosmosSpecRoot,
  parseFrontmatter,
  enumerateSkillBundles,
  createCosmosSpecProvider
} from "../src/skill-provider.mjs";

const root = mkdtempSync(join(tmpdir(), "dsh-cosmos-skill-provider-"));

try {
  /* ── 常量与基础谓词 ── */
  assert.equal(PROVIDER_NAME, "cosmos-spec");
  assert.ok(PROVIDER_RANK < 100, "provider rank MUST < 100（压过本地接线 100–600，同层 rank 小者胜）");
  assert.equal(PATH_TOKEN, "OPENSPEC_PATH");
  assert.ok(CANONICAL_WATCH_DEBOUNCE_MS >= 2000, "canonical watch 防抖 ≥2s");
  assert.ok(isValidSkillName("cosmos-apply-change"), "kebab-case 合法");
  assert.ok(!isValidSkillName("Cosmos"), "大写非法");
  assert.ok(!isValidSkillName("cosmos_apply"), "下划线非法");
  assert.equal(stripTrailingSeparators("C:/openspec///"), "C:/openspec", "尾部连续分隔符去重");
  assert.equal(stripTrailingSeparators("C:/openspec"), "C:/openspec", "无尾分隔符原样");

  /* 令牌出现判定：右界必须紧跟分隔符；左界不得为路径延续字符 */
  assert.ok(isTokenOccurrenceAt("OPENSPEC_PATH/x", 0), "行首令牌构成出现");
  assert.ok(isTokenOccurrenceAt("read OPENSPEC_PATH\\y", 5), "空格后反斜杠形构成出现");
  assert.ok(!isTokenOccurrenceAt("OPENSPEC_PATH", 0), "裸令牌（无分隔符）不构成出现");
  assert.ok(!isTokenOccurrenceAt("xOPENSPEC_PATH/a", 1), "左接字母不构成出现");
  assert.ok(!isTokenOccurrenceAt("docs/OPENSPEC_PATH-notes.md", 5), "左接 / 不构成出现（路径中部）");
  assert.ok(!isTokenOccurrenceAt("opopenspec_path/x", 0), "大小写敏感");

  /* ── 渲染：整词替换一次命中 ── */
  const body = [
    "---",
    "name: demo",
    "description: 演示",
    "---",
    "",
    "读取（read 工具）OPENSPEC_PATH/openspec-apply-change/SKILL.md，执行这个提案。",
    "另见 OPENSPEC_PATH\\design\\README.md 与 docs/OPENSPEC_PATH-notes.md。"
  ].join("\n");
  const rendered = renderSkillContent(body, "C:/openspec");
  assert.ok(
    rendered.includes("C:/openspec/openspec-apply-change/SKILL.md"),
    "正斜杠形替换：配置值 + 恰好一个分隔符 + 原片段"
  );
  assert.ok(rendered.includes("C:/openspec\\design\\README.md"), "反斜杠形替换保留原分隔符形态");
  assert.ok(
    rendered.includes("docs/OPENSPEC_PATH-notes.md"),
    "路径中部同名子串不替换（契约场景）"
  );
  assert.equal(
    rendered.split("C:/openspec").length - 1,
    2,
    "恰两处替换（第三处为路径中部，不替换）"
  );

  /* 双分隔符：配置值以分隔符结尾 → 去尾后拼接，无 // 残留 */
  const withTrailing = renderSkillContent("见 OPENSPEC_PATH/a/b.md", "C:/openspec/");
  assert.equal(withTrailing, "见 C:/openspec/a/b.md", "配置值尾分隔符去重，不产生 // ");
  const doubleSep = renderSkillContent("见 OPENSPEC_PATH//a/b.md", "C:/openspec/");
  assert.equal(doubleSep, "见 C:/openspec/a/b.md", "文本侧连续分隔符同样折叠为恰好一个");

  /* 大小写敏感与片段原样保留 */
  const mixed = renderSkillContent("A OPENSPEC_PATH/X.md 与 openspec_path/Y.md", "D:\\os\\");
  assert.ok(mixed.includes("D:\\os/X.md"), "大小写敏感整词替换（拼接保留文本侧分隔符）");
  assert.ok(mixed.includes("openspec_path/Y.md"), "小写同形不替换");

  /* 不含令牌出现 → 原样（含裸提及令牌名也不触发警示） */
  const bare = "单独提及 OPENSPEC_PATH 令牌名，无分隔符。";
  assert.equal(renderSkillContent(bare, null), bare, "裸令牌未配置时原样且不触发警示");
  assert.equal(renderSkillContent(bare, "C:/os"), bare, "裸令牌已配置时也不替换");

  /* 未配置降级：正文原样 + 头部一行警示 */
  const unset = renderSkillContent(body, null);
  assert.ok(unset.endsWith(body), "未配置：正文原样保留（警示仅追加在头部）");
  assert.ok(unset.startsWith(unsolvedTokenWarningLine()), "警示行在正文头部");
  assert.equal(unsolvedTokenWarningLine().includes("\n"), false, "警示为单行");
  assert.ok(unset.includes("OPENSPEC_PATH/openspec-apply-change/SKILL.md"), "令牌路径原样保留");

  /* resolveValue 函数形态（每次渲染取最新值） */
  let current = "C:/a";
  const dynamic = renderSkillContent("x OPENSPEC_PATH/1.md", () => current);
  assert.equal(dynamic, "x C:/a/1.md", "resolveValue 函数形态生效");
  current = "C:/b";
  assert.equal(renderSkillContent("x OPENSPEC_PATH/1.md", () => current), "x C:/b/1.md", "热生效：取值随配置更新");

  /* ── 兜底：resolveTokenPath + composeTokenFeedback ── */
  assert.equal(resolveTokenPath("OPENSPEC_PATH/openspec-explore/SKILL.md", "C:/openspec"), "C:/openspec/openspec-explore/SKILL.md", "兜底路径解析");
  assert.equal(resolveTokenPath("OPENSPEC_PATH//x", "C:/os/"), "C:/os/x", "兜底路径同样折叠分隔符");
  assert.equal(resolveTokenPath("docs/OPENSPEC_PATH/a", "C:/os"), null, "非开头整词不解析");
  assert.equal(resolveTokenPath("OPENSPEC_PATH/a", null), null, "未配置 → null（走指引分支）");
  const feedbackResolved = composeTokenFeedback({
    rawPath: "OPENSPEC_PATH/a.md",
    resolved: "C:/os/a.md",
    originalError: "ENOENT: no such file"
  });
  assert.ok(feedbackResolved.includes("C:/os/a.md"), "已配置反馈含解析后绝对路径");
  assert.ok(feedbackResolved.includes("重试"), "已配置反馈含重试指引");
  assert.ok(feedbackResolved.includes("ENOENT: no such file"), "原错误文本内嵌进反馈");
  const feedbackUnset = composeTokenFeedback({
    rawPath: "OPENSPEC_PATH/a.md",
    resolved: null,
    originalError: "ENOENT"
  });
  assert.ok(feedbackUnset.includes("cosmos"), "未配置反馈指引设置-cosmos");
  assert.ok(feedbackUnset.includes("OPENSPEC_PATH/a.md"), "未配置反馈含失败路径");
  assert.ok(feedbackUnset.includes("ENOENT"), "未配置反馈同样保留原错误文本");

  /* ── frontmatter 解析 ── */
  const fmText = [
    "---",
    "name: cosmos-demo",
    "description: \"说明：含冒号与引号\"",
    "license: MIT",
    "when-to-use: 需要时",
    "metadata:",
    "  author: somebody",
    "  version: \"1.0\"",
    "disable-model-invocation: false",
    "user-invocable: true",
    "---",
    "",
    "正文 OPENSPEC_PATH/a"
  ].join("\n");
  const fm = parseFrontmatter(fmText);
  assert.equal(fm.name, "cosmos-demo");
  assert.equal(fm.description, "说明：含冒号与引号", "引号剥除、冒号不截断");
  assert.equal(fm.whenToUse, "需要时");
  assert.equal(fm.disableModelInvocation, false, "布尔字面量识别");
  assert.equal(fm.userInvocable, true);
  assert.equal(fm.body.startsWith("\n正文 OPENSPEC_PATH/a"), true, "body 从围栏后起");
  const noFm = parseFrontmatter("直接正文");
  assert.equal(noFm.body, "直接正文", "无围栏 → 全文为 body");
  const unterminated = parseFrontmatter("---\nname: x\n无闭合");
  assert.equal(unterminated.body, "---\nname: x\n无闭合", "围栏未闭合 → 视为无 frontmatter");

  /* ── canonical 根解析序 ── */
  const pkgDir = join(root, "pkg");
  const fallbackRoot = join(pkgDir, "cosmos-spec");
  mkdirSync(fallbackRoot, { recursive: true });
  assert.equal(
    resolveCosmosSpecRoot({ paths: { openspecPath: null, cosmosSpecDir: null }, packageDir: pkgDir }),
    fallbackRoot,
    "未配置 → 回退 <packageDir>/cosmos-spec（存在时）"
  );
  assert.equal(
    resolveCosmosSpecRoot({ paths: { openspecPath: null, cosmosSpecDir: null }, packageDir: join(root, "no-pkg") }),
    null,
    "两者皆缺 → null（空目录观测）"
  );
  const configuredMissing = join(root, "configured-missing");
  assert.equal(
    resolveCosmosSpecRoot({ paths: { openspecPath: null, cosmosSpecDir: configuredMissing }, packageDir: pkgDir }),
    configuredMissing,
    "配置即权威：配置值指向不存在目录不静默回退（空观测由调用方降级）"
  );
  assert.equal(
    resolveCosmosSpecRoot({ paths: { openspecPath: "C:/os", cosmosSpecDir: "  " }, packageDir: pkgDir }),
    fallbackRoot,
    "空白串配置值按未配置（净房口径一致）"
  );

  /* ── 技能束枚举：即时层 + skills/ 层，frontmatter 净房 ── */
  const scanRoot = join(root, "canonical");
  const flatDir = join(scanRoot, "cosmos-flat");
  const skillsDir = join(scanRoot, "skills");
  const nestedDir = join(skillsDir, "cosmos-nested");
  const badNameDir = join(scanRoot, "Bad_Name");
  const noDescDir = join(scanRoot, "cosmos-nodesc");
  mkdirSync(flatDir, { recursive: true });
  mkdirSync(nestedDir, { recursive: true });
  mkdirSync(badNameDir, { recursive: true });
  mkdirSync(noDescDir, { recursive: true });
  const nestedFile = join(nestedDir, "SKILL.md");
  const nestedOriginal = [
    "---",
    "name: cosmos-nested",
    "description: 嵌套层技能",
    "disable-model-invocation: true",
    "user-invocable: false",
    "---",
    "入口：OPENSPEC_PATH/openspec-nested/SKILL.md"
  ].join("\n");
  writeFileSync(nestedFile, nestedOriginal, "utf8");
  writeFileSync(join(flatDir, "SKILL.md"), "---\nname: cosmos-flat\ndescription: 即时层技能\n---\n正文", "utf8");
  writeFileSync(join(badNameDir, "SKILL.md"), "---\ndescription: 名字非法的束\n---\n", "utf8");
  writeFileSync(join(noDescDir, "SKILL.md"), "---\nname: cosmos-nodesc\n---\n", "utf8");
  writeFileSync(join(scanRoot, "loose.md"), "平铺散文件不是目录束", "utf8");

  const bundles = enumerateSkillBundles({ root: scanRoot });
  assert.deepEqual(
    bundles.map((bundle) => bundle.name).sort(),
    ["cosmos-flat", "cosmos-nested"],
    "枚举：目录束双层扫描；非法名/缺 description/散文件跳过"
  );
  const nested = bundles.find((bundle) => bundle.name === "cosmos-nested");
  assert.equal(nested.dir, nestedDir, "skills/ 子层束的 dir 指向真实目录");
  assert.equal(nested.file, nestedFile);
  assert.deepEqual(
    nested.invocation,
    { modelInvocable: false, userInvocable: false },
    "invocation 键解析：disable-model-invocation / user-invocable"
  );
  assert.equal(nested.description, "嵌套层技能");

  /* 浅层同名优先 */
  mkdirSync(join(skillsDir, "cosmos-flat"), { recursive: true });
  writeFileSync(join(skillsDir, "cosmos-flat", "SKILL.md"), "---\nname: cosmos-flat\ndescription: 深层重复\n---\n", "utf8");
  const dedupBundles = enumerateSkillBundles({ root: scanRoot });
  assert.equal(
    dedupBundles.find((bundle) => bundle.name === "cosmos-flat").description,
    "即时层技能",
    "同名以浅层（即时层）为准"
  );
  rmSync(join(skillsDir, "cosmos-flat"), { recursive: true, force: true });

  /* ── provider 控制器：list/get/渲染/canonical 字节不变 ── */
  const provider = createCosmosSpecProvider({
    readPaths: () => ({ openspecPath: "C:/openspec", cosmosSpecDir: scanRoot }),
    packageDir: join(root, "no-pkg"), // 回退根缺席：扫描完全由配置驱动
    invalidate: () => {},
    logger: { warn() {} },
    deps: { debounceMs: 5 }
  });
  assert.equal(provider.name, PROVIDER_NAME);
  const candidates = await provider.list({});
  assert.deepEqual(candidates.map((candidate) => candidate.name).sort(), ["cosmos-flat", "cosmos-nested"]);
  for (const candidate of candidates) {
    assert.equal(candidate.rank, PROVIDER_RANK, "候选 rank = provider 常量");
    assert.equal(candidate.provider, PROVIDER_NAME, "候选归属 provider");
    assert.equal(candidate.source, PROVIDER_NAME);
    assert.equal(typeof candidate.description, "string", "候选 description 非空字符串");
    assert.deepEqual(
      Object.keys(candidate.invocation).sort(),
      ["modelInvocable", "userInvocable"],
      "候选 invocation 双布尔"
    );
    assert.equal(typeof candidate.locator?.file, "string", "候选携带 opaque locator");
  }
  const nestedCandidate = candidates.find((candidate) => candidate.name === "cosmos-nested");
  const definition = await provider.get(nestedCandidate, {});
  assert.ok(
    definition.content.includes("C:/openspec/openspec-nested/SKILL.md"),
    "get() 渲染：注入正文为真实路径（模型首次 read 即命中）"
  );
  assert.equal(definition.name, nestedCandidate.name, "definition.name 与候选一致（registry 校验点）");
  assert.deepEqual(definition.invocation, { modelInvocable: false, userInvocable: false });
  assert.deepEqual(definition.resourceBase, { kind: "directory", path: nested.dir }, "resourceBase = 束目录");
  assert.equal(definition.path, nested.file, "definition 保留指令文件绝对路径");

  /* canonical 文件字节不变：渲染只发生在返回值 */
  assert.equal(readFileSync(nestedFile, "utf8"), nestedOriginal, "磁盘 canonical SKILL.md 字节不变");
  assert.ok(
    readFileSync(nestedFile, "utf8").includes("OPENSPEC_PATH/openspec-nested/SKILL.md"),
    "canonical 仍含令牌原文"
  );

  /* 热生效：配置变更后下一次 get() 以新值渲染 */
  let livePaths = { openspecPath: "C:/one", cosmosSpecDir: scanRoot };
  const hot = createCosmosSpecProvider({
    readPaths: () => livePaths,
    packageDir: join(root, "no-pkg"),
    invalidate: () => {},
    deps: { debounceMs: 5 }
  });
  const hotCandidates = await hot.list({});
  const hotFirst = await hot.get(hotCandidates.find((candidate) => candidate.name === "cosmos-nested"), {});
  assert.ok(hotFirst.content.includes("C:/one/"), "首次渲染取 A 值");
  livePaths = { openspecPath: "C:/two/", cosmosSpecDir: scanRoot };
  const hotSecond = await hot.get(hotCandidates.find((candidate) => candidate.name === "cosmos-nested"), {});
  assert.ok(hotSecond.content.includes("C:/two/openspec-nested/SKILL.md"), "配置改 B 后无需重启即以 B 渲染");
  assert.ok(!hotSecond.content.includes("C:/two//"), "无双分隔符残留");
  hot.dispose();

  /* 缺席降级：两者皆缺（未配置 + 回退根缺席）→ 空候选且观测不完整（不抛错） */
  const absent = createCosmosSpecProvider({
    readPaths: () => ({ openspecPath: null, cosmosSpecDir: null }),
    packageDir: join(root, "no-pkg"),
    invalidate: () => {}
  });
  const absentList = await absent.list({});
  assert.deepEqual(absentList.candidates, [], "canonical 缺席 → 空候选集");
  assert.equal(absentList.complete, false, "观测不完整（不缓存，下次重试）");
  /* 配置即权威：cosmosSpecDir 指向缺失目录 → 扫描得空集（complete 简写，无候选可贡献） */
  const configuredMissingProvider = createCosmosSpecProvider({
    readPaths: () => ({ openspecPath: null, cosmosSpecDir: join(root, "missing-dir") }),
    packageDir: join(root, "no-pkg"),
    invalidate: () => {},
    logger: { warn() {} },
    deps: { debounceMs: 5 }
  });
  const configuredMissingList = await configuredMissingProvider.list({});
  assert.deepEqual(configuredMissingList, [], "配置指向缺失目录 → 空候选数组（不抛错）");
  configuredMissingProvider.dispose();
  const absentGet = await absent.get({ name: "x", locator: { file: join(root, "missing.md") } }, {});
  assert.equal(absentGet, undefined, "读失败 get → undefined（不再可加载，不抛错）");
  absent.dispose();

  provider.dispose();
  /* dispose 后再调 list 不抛错（句柄已摘除） */
  const afterDispose = await provider.list({});
  assert.equal(Array.isArray(afterDispose) || (afterDispose && typeof afterDispose === "object"), true, "dispose 后 list 不抛错");
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("skill-provider-smoke: all assertions passed");
