/**
 * provider 接线冒烟（step3-cosmos-skill-provider-render 2.3 / 3.2）：
 * stub ctx 直调 apply()，验证——skills 缺席仅 provider 分支不激活（其余能力照常）/
 * provider 注册与同名裁决前提（rank < 本地接线最低 rank）/ 降级三分支（skills 缺席、
 * canonical 缺席空观测、未配置警示）/ 目录表自持失效（watch → invalidate 打桩 +
 * 根切换先摘旧监听再挂新监听）/ 路径令牌读取兜底（漏网令牌修正、未配置指引、
 * 非令牌失败与非路径工具与成功结果恒透传、aborted 透传）。
 * 运行：node test/provider-wiring-smoke.mjs
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply } from "../src/index.mjs";
import { PROVIDER_NAME, PROVIDER_RANK } from "../src/skill-provider.mjs";

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

  /* glob / grep / str_replace_editor 用 path 键 */
  const blockedGlob = await tokenGuard(
    { name: "glob", arguments: { path: "OPENSPEC_PATH/pattern/**" }, signal: { aborted: false } },
    { isError: true, error: { message: "glob failed" } },
    nextPassthrough
  );
  assert.equal(blockedGlob?.kind, "block", "glob 的 path 键同样命中兜底");
  assert.ok((blockedGlob.feedback?.[0]?.text ?? "").includes("C:/os-link/pattern/**"), "glob 反馈含解析路径");

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
  const passthroughOtherTool = await tokenGuard(
    { name: "bash", arguments: { command: "cat OPENSPEC_PATH/x.md" }, signal: { aborted: false } },
    { isError: true, error: { message: "command failed" } },
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
    definition2.content.includes("OPENSPEC_PATH/openspec-demo/SKILL.md"),
    "未配置：令牌路径原样保留"
  );
  assert.ok(
    definition2.content.includes("读取（read 工具）"),
    "未配置：正文原样保留"
  );

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

  /* ══ 实例 3：canonical 缺席（未配置 + packageDir 回退根缺席）→ 空观测 ══ */
  writeStore({ openspecPath: null, cosmosSpecDir: null });
  const cap3 = {};
  const { ctx: ctx3 } = makeCtx({ skills: true, capture: cap3 });
  apply(ctx3, {}, { providerDeps: { packageDir: emptyPkg, debounceMs: 5, watch: () => ({ close() {} }) } });
  const provider3 = cap3.providerFactory({ invalidate() {}, signal: undefined });
  const absentList = await provider3.list({});
  assert.deepEqual(absentList.candidates, [], "canonical 缺席 → 空目录候选集");
  assert.equal(absentList.complete, false, "观测不完整（不缓存，spec「canonical 缺席降级」）");

  /* ══ 实例 4：skills 缺席 → 仅 provider 分支不激活，其余能力照常 ══ */
  const cap4 = {};
  const { ctx: ctx4 } = makeCtx({ skills: false, capture: cap4 });
  apply(ctx4, {});
  assert.ok(cap4.handler, "skills 缺席：webServer API 照常注册");
  assert.equal(cap4.providerFactory, undefined, "skills 缺席：provider 不注册（不抛错）");

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
} finally {
  rmSync(home, { recursive: true, force: true });
  rmSync(canonicalA, { recursive: true, force: true });
  rmSync(canonicalB, { recursive: true, force: true });
  rmSync(emptyPkg, { recursive: true, force: true });
}

console.log("provider-wiring-smoke: all assertions passed");
