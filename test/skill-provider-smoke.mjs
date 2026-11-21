/**
 * 技能 provider 纯逻辑冒烟（step3-cosmos-skill-provider-render 1.3；
 * step5-cosmos-path-render-convergence 1.2 扩展）：
 * canonical 根解析序 / 技能束枚举与 frontmatter / 扫描完整性信号 / 令牌渲染（整词替换、
 * 双分隔符折叠、路径中部与左边界不替换、裸令牌不构成出现、未配置警示）/ 渲染服务报告
 * 五键 / 兜底路径解析与反馈组合 / last-good 候选集（不可信回退、可信空覆盖、根切换不跨根
 * 回退、根缺失不回退、dispose 清空）/ canonical 文件字节不变（渲染只作用于返回值）。
 * 运行：node test/skill-provider-smoke.mjs
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PROVIDER_NAME,
  PROVIDER_RANK,
  PATH_TOKEN,
  CANONICAL_WATCH_DEBOUNCE_MS,
  stripTrailingSeparators,
  isTokenOccurrenceAt,
  hasTokenOccurrence,
  findTokenCommandPath,
  isValidSkillName,
  renderSkillContent,
  renderSkillTextReport,
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

  /* ── 状态化警示行（step4 D2）：未配置 / 读取异常两分支可区分，均携带设置入口 ── */
  const warningUnset = unsolvedTokenWarningLine();
  const warningReadError = unsolvedTokenWarningLine("read-error");
  assert.notEqual(warningUnset, warningReadError, "两态文案可区分");
  assert.ok(warningUnset.includes("尚未配置"), "未配置文案指明未配置");
  assert.ok(!warningReadError.includes("尚未配置"), "读取异常文案不说「未配置」");
  assert.ok(warningReadError.includes("装载失败"), "读取异常文案指明共享配置存储装载失败");
  assert.ok(warningReadError.includes("读取异常"), "读取异常文案指明配置存在但读取失败");
  assert.ok(warningReadError.includes("插件日志"), "读取异常文案提示查阅插件日志");
  for (const [label, line] of [["未配置", warningUnset], ["读取异常", warningReadError]]) {
    assert.ok(line.includes("设置-cosmos"), `${label}文案携带设置入口`);
    assert.ok(line.includes("「通用」页签"), `${label}文案携带「通用」页签`);
    assert.ok(line.includes("openspecPath"), `${label}文案携带 openspecPath 字段`);
    assert.equal(line.includes("\n"), false, `${label}文案为单行`);
  }
  assert.equal(unsolvedTokenWarningLine("ok"), warningUnset, "非 read-error（ok）落未配置文案口径");
  assert.equal(unsolvedTokenWarningLine("bogus"), warningUnset, "非法状态值落未配置文案口径");
  assert.equal(unsolvedTokenWarningLine("read-error"), warningReadError, "read-error 状态取读取异常文案");

  /* renderSkillContent 第三参状态（缺省 "unset" 向后兼容） */
  const unsetReadError = renderSkillContent(body, null, "read-error");
  assert.ok(unsetReadError.startsWith(warningReadError), "第三参 read-error → 读取异常警示行");
  assert.ok(unsetReadError.endsWith(body), "读取异常同样正文原样保留");
  assert.equal(renderSkillContent(body, null), unset, "第三参缺省 → 未配置文案（向后兼容）");
  assert.equal(
    renderSkillContent(body, "C:/openspec", "read-error"),
    rendered,
    "已配置时状态参数不影响渲染（警示分支不可达）"
  );

  /* resolveValue 函数形态（每次渲染取最新值） */
  let current = "C:/a";
  const dynamic = renderSkillContent("x OPENSPEC_PATH/1.md", () => current);
  assert.equal(dynamic, "x C:/a/1.md", "resolveValue 函数形态生效");
  current = "C:/b";
  assert.equal(renderSkillContent("x OPENSPEC_PATH/1.md", () => current), "x C:/b/1.md", "热生效：取值随配置更新");

  /* ── 渲染服务报告五键（step5 D1/D2，端点响应面纯逻辑） ── */
  assert.equal(hasTokenOccurrence("见 OPENSPEC_PATH/x.md"), true, "含令牌出现");
  assert.equal(hasTokenOccurrence("裸提及 OPENSPEC_PATH 与 docs/OPENSPEC_PATH-notes.md"), false, "裸令牌 / 路径中部不构成出现");
  assert.equal(hasTokenOccurrence(""), false, "空文本无令牌");
  assert.equal(hasTokenOccurrence(null), false, "非字符串无令牌");

  const reportConfigured = renderSkillTextReport("见 OPENSPEC_PATH/a.md 与 bare OPENSPEC_PATH", "C:/os/");
  assert.deepEqual(Object.keys(reportConfigured).sort(), ["configured", "containsToken", "content", "rendered", "warning"], "响应恰五键");
  assert.equal(reportConfigured.content, "见 C:/os/a.md 与 bare OPENSPEC_PATH", "content 为渲染后整段文本");
  assert.equal(reportConfigured.rendered, true, "已配置 + 令牌出现 → 发生替换");
  assert.equal(reportConfigured.configured, true);
  assert.equal(reportConfigured.containsToken, true, "裸令牌不改变 containsToken（出现判定同渲染谓词）");
  assert.equal(reportConfigured.warning, null, "已配置 → warning null");
  assert.equal(reportConfigured.content, renderSkillContent("见 OPENSPEC_PATH/a.md 与 bare OPENSPEC_PATH", "C:/os/"), "报告 content 与 renderSkillContent 完全一致");

  const reportUnset = renderSkillTextReport("见 OPENSPEC_PATH/a.md", null);
  assert.equal(reportUnset.rendered, false, "未配置降级形态：替换未发生 → rendered=false");
  assert.equal(reportUnset.configured, false);
  assert.equal(reportUnset.containsToken, true);
  assert.equal(reportUnset.warning, unsolvedTokenWarningLine(), "warning 与 provider 降级警示同一函数产出");
  assert.equal(reportUnset.content, unsolvedTokenWarningLine() + "\n\n见 OPENSPEC_PATH/a.md", "content = 头部警示行 + 原文");
  assert.equal(reportUnset.content, renderSkillContent("见 OPENSPEC_PATH/a.md", null), "降级形态与 provider 完全一致");

  const reportReadError = renderSkillTextReport("见 OPENSPEC_PATH/a.md", null, "read-error");
  assert.equal(reportReadError.warning, unsolvedTokenWarningLine("read-error"), "读取异常状态 → 状态化警示区分两态");
  assert.ok(reportReadError.content.startsWith(unsolvedTokenWarningLine("read-error")));

  const plainText = "纯文本技能说明，无任何路径令牌。";
  assert.deepEqual(renderSkillTextReport(plainText, null), {
    content: plainText, rendered: false, configured: false, containsToken: false, warning: null
  }, "无令牌文本原样返回（未配置也不加警示）");
  assert.deepEqual(renderSkillTextReport("docs/OPENSPEC_PATH-notes.md 与裸 OPENSPEC_PATH", null), {
    content: "docs/OPENSPEC_PATH-notes.md 与裸 OPENSPEC_PATH",
    rendered: false,
    configured: false,
    containsToken: false,
    warning: null
  }, "路径中部 / 裸令牌均不构成出现 → 原样且无警示");
  assert.deepEqual(renderSkillTextReport("", "C:/os"), {
    content: "", rendered: false, configured: true, containsToken: false, warning: null
  }, "空文本原样（无令牌）");
  assert.deepEqual(renderSkillTextReport(42, "C:/os"), {
    content: "", rendered: false, configured: true, containsToken: false, warning: null
  }, "非字符串按空文本防御（端点在此之前已 400）");
  assert.equal(reportConfigured.rendered, true);
  let liveValue = "C:/one";
  const reportHotFirst = renderSkillTextReport("OPENSPEC_PATH/x", () => liveValue);
  liveValue = "C:/two";
  const reportHotSecond = renderSkillTextReport("OPENSPEC_PATH/x", () => liveValue);
  assert.equal(reportHotFirst.content, "C:/one/x");
  assert.equal(reportHotSecond.content, "C:/two/x", "报告同样实时取配置（热生效）");

  /* ── 兜底：resolveTokenPath + composeTokenFeedback ── */
  assert.equal(resolveTokenPath("OPENSPEC_PATH/openspec-explore/SKILL.md", "C:/openspec"), "C:/openspec/openspec-explore/SKILL.md", "兜底路径解析");
  assert.equal(resolveTokenPath("OPENSPEC_PATH//x", "C:/os/"), "C:/os/x", "兜底路径同样折叠分隔符");
  assert.equal(resolveTokenPath("docs/OPENSPEC_PATH/a", "C:/os"), null, "非开头整词不解析");
  assert.equal(resolveTokenPath("OPENSPEC_PATH/a", null), null, "未配置 → null（走指引分支）");

  /* ── 命令串令牌词提取（step4 D3 findTokenCommandPath） ── */
  assert.equal(
    findTokenCommandPath("cat OPENSPEC_PATH/openspec-explore/SKILL.md"),
    "OPENSPEC_PATH/openspec-explore/SKILL.md",
    "命令中部令牌：全文扫描不要求命令开头"
  );
  assert.equal(
    findTokenCommandPath("echo $(cat OPENSPEC_PATH/x.md)"),
    "OPENSPEC_PATH/x.md",
    "命令替换：路径词终止于右括号"
  );
  assert.equal(
    findTokenCommandPath("cat \"OPENSPEC_PATH/my dir/x.md\""),
    "OPENSPEC_PATH/my",
    "引号边界：引号非终止符、空白为终止符（design 已知取舍）"
  );
  assert.equal(
    findTokenCommandPath("cat OPENSPEC_PATH/x.md>out.txt"),
    "OPENSPEC_PATH/x.md",
    "重定向符为终止字符"
  );
  assert.equal(findTokenCommandPath("cat OPENSPEC_PATH/a.md | head"), "OPENSPEC_PATH/a.md", "管道符为终止字符");
  assert.equal(findTokenCommandPath("cat OPENSPEC_PATH/a.md && echo ok"), "OPENSPEC_PATH/a.md", "`&&` 为终止字符");
  assert.equal(findTokenCommandPath("cat OPENSPEC_PATH/a.md\r\necho done"), "OPENSPEC_PATH/a.md", "行尾换行为终止字符");
  assert.equal(findTokenCommandPath("cat `OPENSPEC_PATH/a.md`"), "OPENSPEC_PATH/a.md", "反引号为终止字符");
  assert.equal(findTokenCommandPath("read OPENSPEC_PATH\\design\\README.md"), "OPENSPEC_PATH\\design\\README.md", "反斜杠形态原样保留");
  assert.equal(findTokenCommandPath("ls docs/OPENSPEC_PATH-notes.md"), null, "路径中部令牌不构成出现");
  assert.equal(findTokenCommandPath("echo OPENSPEC_PATH"), null, "裸令牌（无分隔符）不提取");
  assert.equal(findTokenCommandPath("echo xOPENSPEC_PATH/a"), null, "左接标识符不构成出现");
  assert.equal(findTokenCommandPath(""), null, "空命令 → null");
  assert.equal(findTokenCommandPath(null), null, "非字符串 → null");
  assert.equal(
    resolveTokenPath(findTokenCommandPath("cat OPENSPEC_PATH/x.md"), "C:/os/"),
    "C:/os/x.md",
    "提取子串复用 resolveTokenPath 同一拼接口径"
  );
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

  /* 扫描根提示行（step4 D5/D6）：两分支均适用；缺省 / 空串省略该行（既有形状不变） */
  const rootHint = "C:/repo/cosmos-spec/skills";
  const feedbackWithRoot = composeTokenFeedback({
    rawPath: "OPENSPEC_PATH/a.md",
    resolved: "C:/os/a.md",
    originalError: "ENOENT",
    skillRootHint: rootHint
  });
  assert.ok(
    feedbackWithRoot.includes("cosmos-spec 技能目录扫描根：" + rootHint),
    "已配置分支附扫描根提示行"
  );
  assert.ok(feedbackWithRoot.includes("C:/os/a.md"), "附扫描根不改变解析路径行");
  assert.ok(feedbackWithRoot.endsWith("原始错误信息：ENOENT"), "原始错误仍在反馈末尾（内容通道保留）");
  const feedbackUnsetWithRoot = composeTokenFeedback({
    rawPath: "OPENSPEC_PATH/a.md",
    resolved: null,
    originalError: "ENOENT",
    skillRootHint: rootHint
  });
  assert.ok(
    feedbackUnsetWithRoot.includes("cosmos-spec 技能目录扫描根：" + rootHint),
    "未配置分支同样附扫描根提示行（root 与 openspecPath 互相独立）"
  );
  assert.ok(!feedbackUnset.includes("cosmos-spec 技能目录扫描根"), "缺省 skillRootHint → 省略该行");
  assert.ok(
    !composeTokenFeedback({ rawPath: "OPENSPEC_PATH/a.md", resolved: null, skillRootHint: "" })
      .includes("cosmos-spec 技能目录扫描根"),
    "空串 skillRootHint → 省略该行"
  );

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

  const scan = enumerateSkillBundles({ root: scanRoot });
  const bundles = scan.bundles;
  assert.equal(scan.complete, true, "两层目录读取均成功 → 扫描可信（step5 D3）");
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

  /* ── 扫描完整性信号（step5 D3）：「层读取失败」≠「层缺席」 ── */
  const flatOnlyRoot = join(root, "flat-only");
  mkdirSync(join(flatOnlyRoot, "cosmos-only-flat"), { recursive: true });
  writeFileSync(join(flatOnlyRoot, "cosmos-only-flat", "SKILL.md"), "---\nname: cosmos-only-flat\ndescription: 扁平布局\n---\n", "utf8");
  const flatOnlyScan = enumerateSkillBundles({ root: flatOnlyRoot });
  assert.equal(flatOnlyScan.complete, true, "skills/ 层缺席是合法形态（不得误判不可信）");
  assert.deepEqual(flatOnlyScan.bundles.map((bundle) => bundle.name), ["cosmos-only-flat"]);

  const rootLayerFail = enumerateSkillBundles({
    root: scanRoot,
    io: {
      readdir(dir) {
        if (dir === scanRoot) throw new Error("EIO: root layer");
        return readdirSync(dir, { withFileTypes: true });
      }
    }
  });
  assert.equal(rootLayerFail.complete, false, "根层存在却读取失败 → 不可信");
  assert.deepEqual(rootLayerFail.bundles.map((bundle) => bundle.name).sort(), ["cosmos-nested"], "失败层之外仍返回已观测束");

  const skillsLayerFail = enumerateSkillBundles({
    root: scanRoot,
    io: {
      readdir(dir) {
        if (dir === skillsDir) throw new Error("EACCES: skills layer");
        return readdirSync(dir, { withFileTypes: true });
      }
    }
  });
  assert.equal(skillsLayerFail.complete, false, "skills/ 层存在却读取失败 → 不可信");
  assert.deepEqual(skillsLayerFail.bundles.map((bundle) => bundle.name), ["cosmos-flat"], "已读层成果保留（回退语义由 provider 承接）");

  const bundleReadFail = enumerateSkillBundles({
    root: scanRoot,
    io: {
      readText(file) {
        if (file === nestedFile) throw new Error("EIO: bundle body");
        return readFileSync(file, "utf8");
      }
    }
  });
  assert.equal(bundleReadFail.complete, true, "单束正文读取失败不拖垮观测（仍可信）");
  assert.deepEqual(bundleReadFail.bundles.map((bundle) => bundle.name), ["cosmos-flat"], "失败束按非技能束跳过");

  /* 浅层同名优先 */
  mkdirSync(join(skillsDir, "cosmos-flat"), { recursive: true });
  writeFileSync(join(skillsDir, "cosmos-flat", "SKILL.md"), "---\nname: cosmos-flat\ndescription: 深层重复\n---\n", "utf8");
  const dedupBundles = enumerateSkillBundles({ root: scanRoot }).bundles;
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

  /* ── 解析根暴露与读取状态注入（step4 D1/D2/D5） ── */
  assert.equal(typeof provider.resolveRoot, "function", "返回面暴露 resolveRoot（供兜底反馈读扫描根）");
  assert.equal(provider.resolveRoot(), scanRoot, "resolveRoot = 解析序结果（配置的 cosmosSpecDir 即权威）");
  const statusProvider = createCosmosSpecProvider({
    readPaths: () => ({ openspecPath: null, cosmosSpecDir: scanRoot }),
    readPathsStatus: () => "read-error",
    packageDir: join(root, "no-pkg"),
    invalidate: () => {},
    deps: { debounceMs: 5 }
  });
  const statusCandidates = await statusProvider.list({});
  const statusDefinition = await statusProvider.get(statusCandidates.find((candidate) => candidate.name === "cosmos-nested"), {});
  assert.ok(
    statusDefinition.content.startsWith(unsolvedTokenWarningLine("read-error")),
    "注入 read-error → 渲染读取异常警示行（与未配置可区分）"
  );
  statusProvider.dispose();
  const throwingStatusProvider = createCosmosSpecProvider({
    readPaths: () => ({ openspecPath: null, cosmosSpecDir: scanRoot }),
    readPathsStatus: () => {
      throw new Error("status boom");
    },
    packageDir: join(root, "no-pkg"),
    invalidate: () => {},
    deps: { debounceMs: 5 }
  });
  const throwingCandidates = await throwingStatusProvider.list({});
  const throwingDefinition = await throwingStatusProvider.get(throwingCandidates.find((candidate) => candidate.name === "cosmos-nested"), {});
  assert.ok(
    throwingDefinition.content.startsWith(unsolvedTokenWarningLine("read-error")),
    "状态注入面抛错 → 防御兜底归 read-error"
  );
  throwingStatusProvider.dispose();
  const noStatusProvider = createCosmosSpecProvider({
    readPaths: () => ({ openspecPath: null, cosmosSpecDir: scanRoot }),
    packageDir: join(root, "no-pkg"),
    invalidate: () => {},
    deps: { debounceMs: 5 }
  });
  const noStatusCandidates = await noStatusProvider.list({});
  const noStatusDefinition = await noStatusProvider.get(noStatusCandidates.find((candidate) => candidate.name === "cosmos-nested"), {});
  assert.ok(
    noStatusDefinition.content.startsWith(unsolvedTokenWarningLine()),
    "未注入读取状态 → 缺省 unset 文案（行为与现状一致，向后兼容）"
  );
  noStatusProvider.dispose();

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

  /* ── last-good 候选集（step5 D3）：不可信回退 / 可信空覆盖 / 不跨根回退 / dispose 清空 ── */
  const lgRoot = join(root, "lg-root");
  mkdirSync(join(lgRoot, "skills", "cosmos-lg"), { recursive: true });
  writeFileSync(
    join(lgRoot, "skills", "cosmos-lg", "SKILL.md"),
    "---\nname: cosmos-lg\ndescription: last-good 根技能\n---\n正文",
    "utf8"
  );
  let failLgScan = false;
  const lgWarns = [];
  const lgProvider = createCosmosSpecProvider({
    readPaths: () => ({ openspecPath: null, cosmosSpecDir: lgRoot }),
    packageDir: join(root, "no-pkg"),
    invalidate: () => {},
    logger: { warn: (message) => lgWarns.push(String(message)) },
    deps: {
      debounceMs: 5,
      watch: () => ({ close() {} }),
      io: {
        readdir(dir) {
          if (failLgScan && dir === lgRoot) throw new Error("EIO: transient scan failure");
          return readdirSync(dir, { withFileTypes: true });
        }
      }
    }
  });
  const lgTrusted = await lgProvider.list({});
  assert.ok(Array.isArray(lgTrusted), "可信扫描 → 候选数组（complete-discovery 简写）");
  assert.deepEqual(lgTrusted.map((candidate) => candidate.name), ["cosmos-lg"], "可信扫描结果");

  failLgScan = true;
  const lgFallback = await lgProvider.list({});
  assert.equal(lgFallback.complete, false, "不可信扫描 → 观测不完整（宿主不缓存，下次重试）");
  assert.deepEqual(lgFallback.candidates.map((candidate) => candidate.name), ["cosmos-lg"], "不可信扫描回退最近一次可信候选集（不出现空候选窗口）");
  assert.equal(lgFallback.candidates[0].rank, PROVIDER_RANK, "回退候选保持同一投影形状（rank / locator 均在）");
  assert.equal(typeof lgFallback.candidates[0].locator?.file, "string", "回退候选携带 locator");
  const lgFallbackAgain = await lgProvider.list({});
  assert.deepEqual(lgFallbackAgain.candidates.map((candidate) => candidate.name), ["cosmos-lg"], "持续不可信 → 持续回退");
  assert.equal(
    lgWarns.filter((message) => message.includes("回退最近一次可信候选集")).length,
    1,
    "不可信回退 warn 一次（warn-once）"
  );

  /* 可信空扫描覆盖 last-good（不悬挂陈旧候选） */
  rmSync(join(lgRoot, "skills", "cosmos-lg"), { recursive: true, force: true });
  failLgScan = false;
  const lgEmpty = await lgProvider.list({});
  assert.deepEqual(lgEmpty, [], "可信空扫描如实返回空候选（数组简写）并覆盖 last-good");
  failLgScan = true;
  const lgAfterEmpty = await lgProvider.list({});
  assert.deepEqual(lgAfterEmpty.candidates, [], "last-good 已被可信空结果覆盖（不可信时不悬挂陈旧候选）");
  assert.equal(lgAfterEmpty.complete, false);
  failLgScan = false;
  const lgRecovered = await lgProvider.list({});
  assert.deepEqual(lgRecovered, [], "恢复可信后仍如实空结果");
  lgProvider.dispose();

  /* 根切换不跨根回退：A 可信 → 切 B 首次扫描不可信 → 空候选（绝不给 A 的 last-good） */
  const rootA = join(root, "lg-root-a");
  const rootB = join(root, "lg-root-b");
  mkdirSync(join(rootA, "cosmos-a"), { recursive: true });
  writeFileSync(join(rootA, "cosmos-a", "SKILL.md"), "---\nname: cosmos-a\ndescription: 根 A 技能\n---\n", "utf8");
  mkdirSync(rootB, { recursive: true }); // 空目录：B 的可信扫描本就为空
  let liveRoot = rootA;
  let failB = false;
  const switchProvider = createCosmosSpecProvider({
    readPaths: () => ({ openspecPath: null, cosmosSpecDir: liveRoot }),
    packageDir: join(root, "no-pkg"),
    invalidate: () => {},
    logger: { warn() {} },
    deps: {
      debounceMs: 5,
      watch: () => ({ close() {} }),
      io: {
        readdir(dir) {
          if (failB && dir === rootB) throw new Error("EIO: root B first scan");
          return readdirSync(dir, { withFileTypes: true });
        }
      }
    }
  });
  const rootAList = await switchProvider.list({});
  assert.deepEqual(rootAList.map((candidate) => candidate.name), ["cosmos-a"], "根 A 可信扫描建立 last-good");
  liveRoot = rootB;
  failB = true;
  const rootBUntrusted = await switchProvider.list({});
  assert.equal(rootBUntrusted.complete, false);
  assert.deepEqual(rootBUntrusted.candidates, [], "根切换后首次扫描不可信 → 空候选（旧根候选 MUST NOT 跨根回退）");
  failB = false;
  const rootBTrusted = await switchProvider.list({});
  assert.deepEqual(rootBTrusted, [], "根 B 可信扫描如实为空（不悬挂根 A 候选）");
  switchProvider.dispose();

  /* 解析根缺失不回退；根恢复后不跨根回退陈旧候选（根身份变化已清空 last-good） */
  let liveRootMissing = rootA;
  let failMissing = false;
  const missingProvider = createCosmosSpecProvider({
    readPaths: () => ({ openspecPath: null, cosmosSpecDir: liveRootMissing }),
    packageDir: join(root, "no-pkg"),
    invalidate: () => {},
    logger: { warn() {} },
    deps: {
      debounceMs: 5,
      watch: () => ({ close() {} }),
      io: {
        readdir(dir) {
          if (failMissing) throw new Error("EIO: all scans");
          return readdirSync(dir, { withFileTypes: true });
        }
      }
    }
  });
  const missingFirst = await missingProvider.list({});
  assert.deepEqual(missingFirst.map((candidate) => candidate.name), ["cosmos-a"], "根 A 可信扫描建立 last-good");
  liveRootMissing = null; // 真缺席（未配置且回退根不存在）
  const missingRootList = await missingProvider.list({});
  assert.deepEqual(missingRootList, { candidates: [], complete: false }, "解析根缺失 → 空观测（真缺席，不回退 last-good）");
  liveRootMissing = rootA; // 根恢复，但扫描不可信 → 不得回退根 A 的陈旧 last-good（根变化已清空）
  failMissing = true;
  const afterRootReturn = await missingProvider.list({});
  assert.deepEqual(afterRootReturn, { candidates: [], complete: false }, "根恢复后首次扫描不可信 → 空候选（不跨根回退）");
  failMissing = false;
  const afterRootReturnTrusted = await missingProvider.list({});
  assert.deepEqual(afterRootReturnTrusted.map((candidate) => candidate.name), ["cosmos-a"], "可信扫描重新建立 last-good");
  missingProvider.dispose();

  /* dispose 清空 last-good：销毁后不可信扫描不回退 */
  let failAfterDispose = false;
  const disposeProvider = createCosmosSpecProvider({
    readPaths: () => ({ openspecPath: null, cosmosSpecDir: rootA }),
    packageDir: join(root, "no-pkg"),
    invalidate: () => {},
    logger: { warn() {} },
    deps: {
      debounceMs: 5,
      watch: () => ({ close() {} }),
      io: {
        readdir(dir) {
          if (failAfterDispose) throw new Error("EIO: after dispose");
          return readdirSync(dir, { withFileTypes: true });
        }
      }
    }
  });
  const beforeDispose = await disposeProvider.list({});
  assert.deepEqual(beforeDispose.map((candidate) => candidate.name), ["cosmos-a"]);
  failAfterDispose = true;
  disposeProvider.dispose();
  const afterDisposeFallback = await disposeProvider.list({});
  assert.deepEqual(afterDisposeFallback.candidates, [], "dispose 清空 last-good（销毁后不可信扫描不回退）");
  assert.equal(afterDisposeFallback.complete, false);

  /* signal 中止维持现状（空候选 complete=false，不触碰 last-good） */
  const abortedList = await provider.list({ signal: { aborted: true } });
  assert.deepEqual(abortedList, { candidates: [], complete: false }, "signal 中止 → 维持空候选现状");

  provider.dispose();
  /* dispose 后再调 list 不抛错（句柄已摘除） */
  const afterDispose = await provider.list({});
  assert.equal(Array.isArray(afterDispose) || (afterDispose && typeof afterDispose === "object"), true, "dispose 后 list 不抛错");
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("skill-provider-smoke: all assertions passed");
