/**
 * provider 接线冒烟（step3-cosmos-skill-provider-render 2.3 / 3.2；
 * step4-cosmos-path-unset-visibility 4.1 扩展；
 * step5-cosmos-path-render-convergence 2.2 扩展）：
 * stub ctx 直调 apply()，验证——skills 缺席仅 provider 分支不激活（其余能力照常）/
 * provider 注册与同名裁决前提（rank < 本地接线最低 rank）/ 降级三分支（skills 缺席、
 * canonical 缺席空观测、未配置警示）/ 目录表自持失效（watch → invalidate 打桩 +
 * 根切换先摘旧监听再挂新监听）/ 路径令牌读取兜底（漏网令牌修正、未配置指引、
 * 命令类工具 bash/pwsh 拦截与透传、glob/grep pattern 键拦截、零命中非 error 透传、
 * 反馈扫描根提示行、非令牌失败与非路径工具与成功结果恒透传、aborted 透传）/
 * 存储损坏装载结局 → 读取异常警示行与 warn-once /
 * 渲染服务端点（已配置渲染命中、未配置降级形态与 provider 一致、无令牌原样、
 * 读取异常状态化警示、400 净房、零磁盘写入）。
 * 运行：node test/provider-wiring-smoke.mjs
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { apply } from "../src/index.mjs";
import { PROVIDER_NAME, PROVIDER_RANK, unsolvedTokenWarningLine } from "../src/skill-provider.mjs";

/* ── 夹具：隔离 DSH_HOME + canonical 根 A/B + 打桩面 ── */
const home = mkdtempSync(join(tmpdir(), "dsh-cosmos-provider-home-"));
const canonicalA = mkdtempSync(join(tmpdir(), "dsh-cosmos-provider-canonical-a-"));
const canonicalB = mkdtempSync(join(tmpdir(), "dsh-cosmos-provider-canonical-b-"));
const emptyPkg = mkdtempSync(join(tmpdir(), "dsh-cosmos-provider-empty-pkg-"));
process.env.DSH_HOME = home;

const storePath = join(home, "dsh-v-cosmos.config.json");

function writeStore(paths) {
  writeFileSync(storePath, JSON.stringify({ revision: 1, paths }), "utf8");
}

function writeSkill(canonicalRoot, dirName, skillName, description) {
  const dir = join(canonicalRoot, "skills", dirName);
  mkdirSync(dir, { recursive: true });
  const text = [
    "---",
    "name: " + skillName,
    "description: " + description,
    "---",
    "",
    "读取（read 工具）OPENSPEC_PATH/openspec-" + skillName.replace(/^cosmos-/, "") + "/SKILL.md，执行这个提案。"
  ].join("\n");
  writeFileSync(join(dir, "SKILL.md"), text, "utf8");
  return join(dir, "SKILL.md");
}

const skillAFile = writeSkill(canonicalA, "cosmos-demo", "cosmos-demo", "A 根演示技能");
const skillBFile = writeSkill(canonicalB, "cosmos-b", "cosmos-b", "B 根演示技能");

function makeCtx({ skills = true, capture = {} } = {}) {
  const listeners = new Map();
  const ctx = {
    logger: { warn() {} },
    effect(fn) {
      return fn();
    },
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(listener);
      return () => {
        const list = listeners.get(event);
        const index = list.indexOf(listener);
        if (index >= 0) list.splice(index, 1);
      };
    },
    inject(deps, callback) {
      const available = deps.every((dep) => (dep === "skills" ? skills : true));
      if (!available) return { dispose() {} };
      return callback(ctx);
    },
    webServer: {
      register(def) {
        capture.handler = def.handler;
        return () => {};
      }
    },
    workspaceRegistry: { list: () => [] },
    agents: { get: () => null },
    sessions: {},
    tools: {}
  };
  if (skills) {
    ctx.skills = {
      registerProvider(create) {
        capture.providerFactory = create;
        return () => {};
      }
    };
  }
  return { ctx, listeners };
}

async function waitFor(condition, timeoutMs = 5000, stepMs = 50) {
  const start = Date.now();
  for (;;) {
    if (condition()) return true;
    if (Date.now() - start >= timeoutMs) return condition();
    await new Promise((done) => setTimeout(done, stepMs));
  }
}

try {
  writeStore({ openspecPath: "C:/os-link", cosmosSpecDir: canonicalA });

  /* ══ 实例 1：skills 在 + 配置齐备（渲染 / watch 失效 / 已配置兜底反馈） ══ */
  const cap1 = {};
  const watchTargets = [];
  const closedWatchTargets = [];
  let watchCallback = null;
  const { ctx: ctx1, listeners: listeners1 } = makeCtx({
    skills: true,
    capture: cap1
  });
  ctx1.skills.registerProvider = (create) => {
    cap1.providerFactory = create;
    return () => {};
  };
  let invalidateCalls = 0;
  apply(
    ctx1,
    {},
    {
      providerDeps: {
        debounceMs: 5,
        watch: (target, opts, listener) => {
          watchTargets.push(target);
          watchCallback = listener;
          return {
            close() {
              closedWatchTargets.push(target);
            }
          };
        }
      }
    }
  );
  assert.ok(cap1.handler, "skills 在：API handler 照常注册（其余能力不受 provider 分支影响）");
  assert.equal(typeof cap1.providerFactory, "function", "skills 在：provider 工厂已注册");

  /* 同名裁决前提（spec「渲染变体胜出同名接线」的机制前提）：provider 候选 rank=50，
     严格低于本地接线各根的既有 rank（100–600）——同层内 rank 小者胜。 */
  assert.equal(PROVIDER_NAME, "cosmos-spec");
  assert.ok(PROVIDER_RANK < 100, "provider rank < 本地接线最低 rank 100（同层 rank 裁决必胜）");

  const control1 = { invalidate: () => { invalidateCalls += 1; }, signal: undefined };
  const provider = cap1.providerFactory(control1);
  assert.equal(provider.name, PROVIDER_NAME);

  /* 注册期即挂载 canonical 根监听（自持失效载体）；目标 = 配置的 canonical A */
  await waitFor(() => watchTargets.length > 0);
  assert.deepEqual(watchTargets, [canonicalA], "注册期监听挂在解析根（canonical A）");

  const candidates = await provider.list({});
  assert.ok(Array.isArray(candidates), "扫描成功 → complete-discovery 数组简写");
  assert.deepEqual(candidates.map((candidate) => candidate.name), ["cosmos-demo"], "目录表来自 canonical A");
  assert.equal(candidates[0].rank, PROVIDER_RANK, "候选 rank = 50");

  /* 目录失效触发（打桩）：watch 事件 → ≥防抖 → 注册期 invalidate() */
  const invalidateBeforeFire = invalidateCalls;
  watchCallback("change", "skills");
  await waitFor(() => invalidateCalls > invalidateBeforeFire);
  assert.ok(invalidateCalls > invalidateBeforeFire, "watch 事件 → 防抖 → invalidate()（沿 skills/change 广播由宿主完成）");

  /* 根切换（cosmosSpecDir 配置变更）：config watch 热重载 → 钩子 → 摘旧挂新 + 立即失效 */
  const invalidateBeforeSwitch = invalidateCalls; // 基线先于切换动作取样（切换失效与摘挂同步发生）
  writeStore({ openspecPath: "C:/os-link", cosmosSpecDir: canonicalB });
  await waitFor(() => closedWatchTargets.includes(canonicalA), 8000);
  assert.ok(closedWatchTargets.includes(canonicalA), "根切换先摘旧监听（canonical A closed）");
  await waitFor(() => watchTargets.includes(canonicalB), 8000);
  assert.ok(watchTargets.includes(canonicalB), "根切换再挂新监听（canonical B attached）");
  await waitFor(() => invalidateCalls > invalidateBeforeSwitch, 8000);
  assert.ok(invalidateCalls > invalidateBeforeSwitch, "根切换立即失效（不等防抖）");
  const candidatesB = await provider.list({});
  assert.deepEqual(candidatesB.map((candidate) => candidate.name), ["cosmos-b"], "目录表随解析根切换更新");

  /* get() 渲染：已配置 openspecPath → 正文为真实路径 */
  const definitionB = await provider.get(candidatesB[0], {});
  assert.ok(
    definitionB.content.includes("C:/os-link/openspec-b/SKILL.md"),
    "get() 渲染令牌为配置值（模型首次 read 即命中）"
  );

  /* ── 渲染服务端点（step5 D1/D2）：已配置一次渲染命中 + 五键 + 零磁盘写入 ── */
  const renderPath = "/api/dsh-v-cosmos/render-skill-text";
  const homeBefore = readdirSync(home).sort();
  const storeBefore = readFileSync(storePath);
  const skillABefore = readFileSync(skillAFile, "utf8");
  const skillBBefore = readFileSync(skillBFile, "utf8");
  const skillBText = readFileSync(skillBFile, "utf8");
  const renderConfigured = await post(cap1.handler, renderPath, { text: skillBText });
  assert.equal(renderConfigured.status, 200, "端点 200");
  assert.deepEqual(
    Object.keys(renderConfigured.body).sort(),
    ["configured", "containsToken", "content", "rendered", "warning"],
    "响应恰五键（content / rendered / configured / containsToken / warning）"
  );
  assert.equal(
    renderConfigured.body.content,
    definitionB.content,
    "同一正文的端点 content 与 provider get() 完全一致（同一渲染核心 / 同一配置读取面）"
  );
  assert.ok(renderConfigured.body.content.includes("C:/os-link/openspec-b/SKILL.md"), "已配置：令牌出现处渲染为绝对路径");
  assert.equal(renderConfigured.body.rendered, true, "已配置 + 令牌出现 → rendered=true");
  assert.equal(renderConfigured.body.configured, true);
  assert.equal(renderConfigured.body.containsToken, true);
  assert.equal(renderConfigured.body.warning, null, "已配置 → warning=null");
  const renderMixed = await post(cap1.handler, renderPath, {
    text: "读取 OPENSPEC_PATH/openspec-b/SKILL.md 执行；另见裸提及 OPENSPEC_PATH 与 docs/OPENSPEC_PATH-notes.md。"
  });
  assert.equal(
    renderMixed.body.content,
    "读取 C:/os-link/openspec-b/SKILL.md 执行；另见裸提及 OPENSPEC_PATH 与 docs/OPENSPEC_PATH-notes.md。",
    "仅整词出现处替换：裸令牌 / 路径中部原样保留"
  );
  assert.equal(renderMixed.body.containsToken, true, "整段含真实令牌出现");

  /* 无令牌文本原样（含仅裸提及令牌名） */
  const plainText = "纯文本技能说明，无任何路径令牌。";
  const renderPlain = await post(cap1.handler, renderPath, { text: plainText });
  assert.deepEqual(renderPlain.body, {
    content: plainText, rendered: false, configured: true, containsToken: false, warning: null
  }, "无令牌文本原样返回（rendered=false、warning=null）");
  const bareOnly = await post(cap1.handler, renderPath, { text: "裸提及 OPENSPEC_PATH 与 docs/OPENSPEC_PATH-notes.md" });
  assert.equal(bareOnly.body.content, "裸提及 OPENSPEC_PATH 与 docs/OPENSPEC_PATH-notes.md", "裸令牌不替换、原样返回");
  assert.equal(bareOnly.body.containsToken, false, "裸令牌不构成出现（契约整词判定）");
  assert.equal(bareOnly.body.warning, null, "无出现 → 即使未配置也无警示");

  /* 端点调用零磁盘写入（零侵入纪律）：存储 / canonical / DSH_HOME 均无变化 */
  assert.deepEqual(readdirSync(home).sort(), homeBefore, "端点调用不产生新文件（零持久化）");
  assert.ok(readFileSync(storePath).equals(storeBefore), "端点调用不改共享配置存储");
  assert.equal(readFileSync(skillAFile, "utf8"), skillABefore, "端点调用零写入 canonical A");
  assert.equal(readFileSync(skillBFile, "utf8"), skillBBefore, "端点调用零写入 canonical B");

  /* 请求净房：缺 text / 非字符串 / 非法 JSON → 400（无副作用） */
  const invalidRenders = [
    ["缺 text", {}],
    ["text 非字符串", { text: 42 }],
    ["text 为 null", { text: null }],
    ["text 为数组", { text: ["OPENSPEC_PATH/x"] }]
  ];
  for (const [label, body] of invalidRenders) {
    const invalid = await post(cap1.handler, renderPath, body);
    assert.equal(invalid.status, 400, "非法请求 400：" + label);
    assert.equal(invalid.body.error, "invalid", "错误码 invalid：" + label);
  }
  const invalidJson = await postRaw(cap1.handler, renderPath, "{ 这不是合法 JSON");
  assert.equal(invalidJson.status, 400, "非法 JSON 体 → 400");
  assert.equal(readFileSync(storePath, "utf8").length > 0, true, "400 路径不破坏存储");

  /* ── 路径令牌读取兜底（3.2）：已配置分支 ── */
  const postExecute = listeners1.get("tools/post-execute");
  assert.ok(Array.isArray(postExecute) && postExecute.length === 1, "tools/post-execute 监听已注册");
  const tokenGuard = postExecute[0];
  const PASSTHROUGH = Symbol("passthrough");
  const nextPassthrough = async () => PASSTHROUGH;

  const originalError = "ENOENT: no such file or directory, open 'OPENSPEC_PATH/x.md'";
  const blocked = await tokenGuard(
    { name: "read", arguments: { file_path: "OPENSPEC_PATH/x.md" }, signal: { aborted: false } },
    { isError: true, error: { message: originalError } },
    nextPassthrough
  );
  assert.equal(blocked?.kind, "block", "漏网令牌失败 → block 决策");
  const feedbackText = blocked.feedback?.[0]?.text ?? "";
  assert.ok(feedbackText.includes("C:/os-link/x.md"), "反馈含解析后绝对路径");
  assert.ok(feedbackText.includes("重试"), "反馈含改用该路径重试指引");
  assert.ok(feedbackText.includes(originalError), "原错误文本内嵌进反馈（唯一内容通道）");
  assert.equal(Array.isArray(blocked.feedback), true, "feedback 为 ContentBlock 数组");
  assert.ok(
    feedbackText.includes("cosmos-spec 技能目录扫描根：" + canonicalB),
    "已配置分支反馈附扫描根提示行（桥接 provider 解析根，step4 D5）"
  );

  /* glob / grep / str_replace_editor 用 path 键 */
  const blockedGlob = await tokenGuard(
    { name: "glob", arguments: { path: "OPENSPEC_PATH/pattern/**" }, signal: { aborted: false } },
    { isError: true, error: { message: "glob failed" } },
    nextPassthrough
  );
  assert.equal(blockedGlob?.kind, "block", "glob 的 path 键同样命中兜底");
  assert.ok((blockedGlob.feedback?.[0]?.text ?? "").includes("C:/os-link/pattern/**"), "glob 反馈含解析路径");

  /* glob / grep 的 pattern 键（step4 D4）：令牌前缀开头的照抄形态同样拦截 */
  const blockedGlobPattern = await tokenGuard(
    { name: "glob", arguments: { pattern: "OPENSPEC_PATH/**/*.md" }, signal: { aborted: false } },
    { isError: true, error: { message: "glob pattern failed" } },
    nextPassthrough
  );
  assert.equal(blockedGlobPattern?.kind, "block", "glob 的 pattern 键命中兜底");
  assert.ok(
    (blockedGlobPattern.feedback?.[0]?.text ?? "").includes("C:/os-link/**/*.md"),
    "glob pattern 反馈含解析路径"
  );
  const blockedGrepPattern = await tokenGuard(
    { name: "grep", arguments: { pattern: "OPENSPEC_PATH/openspec-explore" }, signal: { aborted: false } },
    { isError: true, error: { message: "grep pattern failed" } },
    nextPassthrough
  );
  assert.equal(blockedGrepPattern?.kind, "block", "grep 的 pattern 键命中兜底");

  /* 命令类工具（step4 D3）：bash / pwsh 命令串内令牌出现即拦截（不要求命令开头） */
  const blockedBash = await tokenGuard(
    { name: "bash", arguments: { command: "cat OPENSPEC_PATH/x.md" }, signal: { aborted: false } },
    { isError: true, error: { message: "command failed" } },
    nextPassthrough
  );
  assert.equal(blockedBash?.kind, "block", "bash 命令串内令牌 → 兜底拦截");
  const bashFeedback = blockedBash.feedback?.[0]?.text ?? "";
  assert.ok(bashFeedback.includes("C:/os-link/x.md"), "bash 反馈含提取路径词解析后的绝对路径");
  assert.ok(
    bashFeedback.includes("cosmos-spec 技能目录扫描根：" + canonicalB),
    "bash 反馈附扫描根提示行"
  );
  assert.ok(bashFeedback.includes("command failed"), "bash 反馈保留原错误文本");
  const blockedPwsh = await tokenGuard(
    { name: "pwsh", arguments: { command: "Get-Content OPENSPEC_PATH/x.md" }, signal: { aborted: false } },
    { isError: true, error: { message: "pwsh failed" } },
    nextPassthrough
  );
  assert.equal(blockedPwsh?.kind, "block", "pwsh 命令串内令牌 → 兜底拦截");
  assert.ok((blockedPwsh.feedback?.[0]?.text ?? "").includes("C:/os-link/x.md"), "pwsh 反馈含解析路径");

  /* 非令牌失败恒透传（不误伤真实错误） */
  const passthroughNormal = await tokenGuard(
    { name: "read", arguments: { file_path: "C:/normal/missing.md" }, signal: { aborted: false } },
    { isError: true, error: { message: "ENOENT normal" } },
    nextPassthrough
  );
  assert.equal(passthroughNormal, PASSTHROUGH, "非令牌失败 → next() 透传");
  const passthroughBare = await tokenGuard(
    { name: "read", arguments: { file_path: "OPENSPEC_PATH" }, signal: { aborted: false } },
    { isError: true, error: { message: "ENOENT bare" } },
    nextPassthrough
  );
  assert.equal(passthroughBare, PASSTHROUGH, "裸令牌（无分隔符，不构成出现）透传");
  const passthroughMid = await tokenGuard(
    { name: "read", arguments: { file_path: "docs/OPENSPEC_PATH-notes.md" }, signal: { aborted: false } },
    { isError: true, error: { message: "ENOENT mid" } },
    nextPassthrough
  );
  assert.equal(passthroughMid, PASSTHROUGH, "路径中部令牌（非开头整词）透传");
  const passthroughSuccess = await tokenGuard(
    { name: "read", arguments: { file_path: "OPENSPEC_PATH/x.md" }, signal: { aborted: false } },
    { isError: false, value: { ok: true } },
    nextPassthrough
  );
  assert.equal(passthroughSuccess, PASSTHROUGH, "成功结果恒透传（兜底只看 isError）");
  const passthroughGlobNoMatch = await tokenGuard(
    { name: "glob", arguments: { pattern: "OPENSPEC_PATH/**/*.md" }, signal: { aborted: false } },
    { isError: false, value: { matches: [] } },
    nextPassthrough
  );
  assert.equal(passthroughGlobNoMatch, PASSTHROUGH, "glob 零命中但非 error → 透传（真实空结果是合法观测）");
  const passthroughGrepNoMatch = await tokenGuard(
    { name: "grep", arguments: { pattern: "OPENSPEC_PATH/nowhere" }, signal: { aborted: false } },
    { isError: false, value: { matches: [] } },
    nextPassthrough
  );
  assert.equal(passthroughGrepNoMatch, PASSTHROUGH, "grep 零命中但非 error → 透传");
  const passthroughBashClean = await tokenGuard(
    { name: "bash", arguments: { command: "cat /tmp/clean.md" }, signal: { aborted: false } },
    { isError: true, error: { message: "no such file" } },
    nextPassthrough
  );
  assert.equal(passthroughBashClean, PASSTHROUGH, "bash 命令串无令牌 → 透传");
  const passthroughBashMid = await tokenGuard(
    { name: "bash", arguments: { command: "ls docs/OPENSPEC_PATH-notes.md" }, signal: { aborted: false } },
    { isError: true, error: { message: "no such file" } },
    nextPassthrough
  );
  assert.equal(passthroughBashMid, PASSTHROUGH, "bash 路径中部令牌（非整词出现）→ 透传");
  const passthroughPatternMid = await tokenGuard(
    { name: "glob", arguments: { pattern: "docs/OPENSPEC_PATH-notes.md" }, signal: { aborted: false } },
    { isError: true, error: { message: "glob mid failed" } },
    nextPassthrough
  );
  assert.equal(passthroughPatternMid, PASSTHROUGH, "pattern 非开头整词令牌 → 透传");
  const passthroughOtherTool = await tokenGuard(
    { name: "browser_open", arguments: { url: "OPENSPEC_PATH/x.md" }, signal: { aborted: false } },
    { isError: true, error: { message: "other tool failed" } },
    nextPassthrough
  );
  assert.equal(passthroughOtherTool, PASSTHROUGH, "路径键表外工具恒透传");
  const passthroughAborted = await tokenGuard(
    { name: "read", arguments: { file_path: "OPENSPEC_PATH/x.md" }, signal: { aborted: true } },
    { isError: true, error: { message: originalError } },
    nextPassthrough
  );
  assert.equal(passthroughAborted, PASSTHROUGH, "exec.signal 已中止 → 透传（观察 signal）");

  /* ══ 实例 2：openspecPath 未配置（未配置警示 + 未配置兜底指引） ══ */
  writeStore({ openspecPath: null, cosmosSpecDir: canonicalA });
  const cap2 = {};
  const { ctx: ctx2, listeners: listeners2 } = makeCtx({ skills: true, capture: cap2 });
  apply(ctx2, {}, { providerDeps: { debounceMs: 5, watch: () => ({ close() {} }) } });
  assert.equal(typeof cap2.providerFactory, "function");
  const provider2 = cap2.providerFactory({ invalidate() {}, signal: undefined });
  const candidates2 = await provider2.list({});
  assert.deepEqual(candidates2.map((candidate) => candidate.name), ["cosmos-demo"]);
  const definition2 = await provider2.get(candidates2[0], {});
  assert.ok(definition2.content.startsWith("> ⚠️"), "未配置：正文头部附加未解析警示行");
  assert.ok(
    definition2.content.startsWith(unsolvedTokenWarningLine()),
    "未配置：警示行走「未配置」状态文案（step4 D2）"
  );
  assert.ok(definition2.content.includes("尚未配置"), "未配置文案指明未配置");
  assert.ok(definition2.content.includes("设置-cosmos"), "未配置文案携带设置入口");
  assert.ok(
    definition2.content.includes("OPENSPEC_PATH/openspec-demo/SKILL.md"),
    "未配置：令牌路径原样保留"
  );
  assert.ok(
    definition2.content.includes("读取（read 工具）"),
    "未配置：正文原样保留"
  );

  /* 渲染端点未配置降级形态：与 provider 警示一致、rendered=false（替换未发生） */
  const skillAText = readFileSync(skillAFile, "utf8");
  const renderUnset = await post(cap2.handler, renderPath, { text: skillAText });
  assert.equal(renderUnset.status, 200, "未配置：端点仍 200（降级而非报错）");
  assert.equal(renderUnset.body.rendered, false, "降级形态：content 前置警示行但替换未发生 → rendered=false");
  assert.equal(renderUnset.body.configured, false, "未配置 → configured=false");
  assert.equal(renderUnset.body.containsToken, true, "正文含令牌出现");
  assert.equal(renderUnset.body.warning, unsolvedTokenWarningLine(), "warning 与 provider 未配置警示同一函数产出");
  assert.equal(renderUnset.body.content, definition2.content, "降级形态与 provider get() 完全一致（同一渲染核心）");
  assert.ok(renderUnset.body.content.startsWith(unsolvedTokenWarningLine()), "警示行在 content 头部");
  assert.ok(renderUnset.body.content.endsWith(skillAText), "正文原样保留（警示仅追加在头部）");

  const tokenGuard2 = listeners2.get("tools/post-execute")[0];
  const blockedUnset = await tokenGuard2(
    { name: "read", arguments: { file_path: "OPENSPEC_PATH/x.md" }, signal: { aborted: false } },
    { isError: true, error: { message: "ENOENT unset" } },
    nextPassthrough
  );
  assert.equal(blockedUnset?.kind, "block", "未配置漏网令牌仍 block（给指引而非放任失败）");
  const unsetFeedback = blockedUnset.feedback?.[0]?.text ?? "";
  assert.ok(unsetFeedback.includes("cosmos"), "未配置反馈指引设置-cosmos 配置 openspec 路径");
  assert.ok(unsetFeedback.includes("ENOENT unset"), "未配置反馈同样保留原错误文本");
  assert.ok(!unsetFeedback.includes("解析后的绝对路径"), "未配置反馈不给猜测路径");
  assert.ok(
    unsetFeedback.includes("cosmos-spec 技能目录扫描根：" + canonicalA),
    "未配置分支同样附扫描根提示行（root 与 openspecPath 互相独立，step4 D5）"
  );

  /* ══ 实例 3：canonical 缺席（未配置 + packageDir 回退根缺席）→ 空观测 ══ */
  writeStore({ openspecPath: null, cosmosSpecDir: null });
  const cap3 = {};
  const { ctx: ctx3 } = makeCtx({ skills: true, capture: cap3 });
  apply(ctx3, {}, { providerDeps: { packageDir: emptyPkg, debounceMs: 5, watch: () => ({ close() {} }) } });
  const provider3 = cap3.providerFactory({ invalidate() {}, signal: undefined });
  const absentList = await provider3.list({});
  assert.deepEqual(absentList.candidates, [], "canonical 缺席 → 空目录候选集");
  assert.equal(absentList.complete, false, "观测不完整（不缓存，spec「canonical 缺席降级」）");
  assert.equal(provider3.resolveRoot(), null, "解析根不可解析 → resolveRoot() 返回 null（反馈省略提示行）");

  /* ══ 实例 4：skills 缺席 → 仅 provider 分支不激活，其余能力照常 ══ */
  const cap4 = {};
  const { ctx: ctx4, listeners: listeners4 } = makeCtx({ skills: false, capture: cap4 });
  apply(ctx4, {});
  assert.ok(cap4.handler, "skills 缺席：webServer API 照常注册");
  assert.equal(cap4.providerFactory, undefined, "skills 缺席：provider 不注册（不抛错）");
  /* 桥缺席（skills 服务未激活）→ 兜底反馈省略扫描根行，其余指引不变 */
  const tokenGuard4 = listeners4.get("tools/post-execute")[0];
  const blockedNoSkills = await tokenGuard4(
    { name: "read", arguments: { file_path: "OPENSPEC_PATH/x.md" }, signal: { aborted: false } },
    { isError: true, error: { message: "ENOENT no-skills" } },
    nextPassthrough
  );
  assert.equal(blockedNoSkills?.kind, "block", "skills 缺席：兜底主体照常拦截");
  const noSkillsFeedback = blockedNoSkills.feedback?.[0]?.text ?? "";
  assert.ok(noSkillsFeedback.includes("cosmos"), "skills 缺席：未配置指引照常");
  assert.ok(!noSkillsFeedback.includes("cosmos-spec 技能目录扫描根"), "skills 缺席：省略扫描根提示行");

  /* ══ 实例 5：wiring 零写入 openspec 工件与 canonical（零侵入纪律） ══ */
  writeStore({ openspecPath: "C:/os-link", cosmosSpecDir: canonicalA });
  const cap5 = {};
  const { ctx: ctx5 } = makeCtx({ skills: true, capture: cap5 });
  apply(ctx5, {}, { providerDeps: { debounceMs: 5, watch: () => ({ close() {} }) } });
  const provider5 = cap5.providerFactory({ invalidate() {}, signal: undefined });
  const beforeBytes = (await import("node:fs")).readFileSync(skillAFile, "utf8");
  const candidates5 = await provider5.list({});
  await provider5.get(candidates5[0], {});
  assert.equal(
    (await import("node:fs")).readFileSync(skillAFile, "utf8"),
    beforeBytes,
    "provider list/get 全程零写入 canonical SKILL.md（渲染只作用于返回值）"
  );

  /* ══ 实例 6：配置存储损坏（正式文件与备份链全不可用）→ 读取异常警示行 + warn-once ══
     装载结局 damaged 是真实可观测的「配置存在但读取失败」信号（design D1 勘误）。 */
  writeFileSync(storePath, "{ 这不是合法 JSON", "utf8"); // 无 .bak 备份 → damaged
  const warns = [];
  const cap6 = {};
  const { ctx: ctx6 } = makeCtx({ skills: true, capture: cap6 });
  ctx6.logger = { warn: (...args) => warns.push(args.join(" ")) };
  apply(ctx6, {}, { providerDeps: { packageDir: emptyPkg, debounceMs: 5, watch: () => ({ close() {} }) } });
  const provider6 = cap6.providerFactory({ invalidate() {}, signal: undefined });
  const damagedCandidate = { name: "cosmos-demo", locator: { file: skillAFile, dir: dirname(skillAFile) } };
  const damagedDefinition = await provider6.get(damagedCandidate, {});
  assert.ok(
    damagedDefinition.content.startsWith(unsolvedTokenWarningLine("read-error")),
    "存储损坏装载结局 → 渲染「读取异常」状态警示行"
  );
  assert.ok(!damagedDefinition.content.includes("尚未配置"), "读取异常警示不等同于「未配置」");
  assert.ok(damagedDefinition.content.includes("OPENSPEC_PATH"), "读取异常：令牌路径原样保留");
  await provider6.get(damagedCandidate, {});
  const readStatusWarns = warns.filter((message) => message.includes("读取状态"));
  assert.equal(readStatusWarns.length, 1, "同一异常态只 warn 告警一次（warn-once，两次 get 仅一条）");

  /* 渲染端点读取异常状态：状态化警示与 provider 同源可区分「未配置 / 读取异常」 */
  const renderReadError = await post(cap6.handler, renderPath, { text: skillAText });
  assert.equal(renderReadError.status, 200, "读取异常：端点仍 200");
  assert.equal(renderReadError.body.rendered, false, "读取异常：替换未发生 → rendered=false");
  assert.equal(renderReadError.body.configured, false, "读取异常且解析值不可用 → configured=false");
  assert.equal(renderReadError.body.containsToken, true);
  assert.equal(renderReadError.body.warning, unsolvedTokenWarningLine("read-error"), "端点警示行走读取异常状态文案");
  assert.ok(
    renderReadError.body.content.startsWith(unsolvedTokenWarningLine("read-error")),
    "content 头部为读取异常警示（与 provider 完全一致）"
  );
  assert.ok(!renderReadError.body.content.includes("尚未配置"), "读取异常警示不等同于「未配置」");
} finally {
  rmSync(home, { recursive: true, force: true });
  rmSync(canonicalA, { recursive: true, force: true });
  rmSync(canonicalB, { recursive: true, force: true });
  rmSync(emptyPkg, { recursive: true, force: true });
}

console.log("provider-wiring-smoke: all assertions passed");

/* ── 工具：捕获 JSON 响应 / 构造带体请求桩（handler 以 `for await (const chunk of req)` 读体） ── */

async function post(target, url, body) {
  const state = captureJson();
  await target(stubBodyReq("POST", url, body), state.res);
  return state;
}

async function postRaw(target, url, rawText) {
  const state = captureJson();
  await target(stubRawReq("POST", url, rawText), state.res);
  return state;
}

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
  return stubRawReq(method, url, JSON.stringify(body ?? {}));
}

function stubRawReq(method, url, rawText) {
  const chunks = [Buffer.from(rawText, "utf8")];
  return {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    }
  };
}
