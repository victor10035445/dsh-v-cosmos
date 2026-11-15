/**
 * bundle 工厂冒烟（对齐 hive factory-smoke）：lib/client.js 懒 CJS 工厂可求值、
 * 导出面形状正确、external 模块经 stub require 注入不触碰真实 react。
 * 运行：先 npm run build，再 node test/factory-smoke.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const bundlePath = fileURLToPath(new URL("../lib/client.js", import.meta.url));
const source = readFileSync(bundlePath, "utf8");
assert.ok(source.includes("window.__ModuleLoader__.load"), "懒工厂 banner");
assert.ok(source.includes('id: "dsh-v-cosmos"'), "插件 id");

/* 求值：stub window + require（react/@deepseek-ai/* external 由 stub 供给）。 */
const loaded = [];
const sandbox = {
  window: {
    __ModuleLoader__: {
      load(def) {
        loaded.push(def);
      }
    }
  },
  require(name) {
    return new Proxy({}, { get: () => () => ({}) });
  }
};
const compiled = new Function("window", "require", source);
compiled(sandbox.window, sandbox.require);

assert.equal(loaded.length, 1, "单次 load 注册");
const def = loaded[0];
assert.equal(def.id, "dsh-v-cosmos");
assert.equal(typeof def.factory, "function");

const exportsShape = def.factory(sandbox.require);
assert.equal(typeof exportsShape.apply, "function", "apply 入口");
assert.deepEqual(exportsShape.inject, ["slots", "locale", "sessions", "workspaces", "uiSession", "uiWorkspace"], "inject 声明（宿主 cordis 规则：ctx 属性须经 inject 声明方可访问）");
assert.equal(typeof exportsShape.mergeScene, "function", "冒烟观测面导出");
assert.equal(typeof exportsShape.sceneDiffLevel, "function");
assert.equal(typeof exportsShape.createSkinD, "function");
assert.equal(typeof exportsShape.createCosmosEngine, "function");
assert.equal(typeof exportsShape.fetchScene, "function");
assert.equal(typeof exportsShape.subscribeCosmosEvents, "function");
assert.equal(typeof exportsShape.loadCosmosSettings, "function", "设置读面导出（调参消费通道）");
assert.equal(typeof exportsShape.saveCosmosSettings, "function", "设置写面导出");
assert.ok(exportsShape.cosmosOpenStore && typeof exportsShape.cosmosOpenStore.subscribe === "function", "开合 store 导出");

/* ── 动作按钮观测面（add-cosmos-proposal-actions）── */
assert.equal(typeof exportsShape.projectPanel, "function", "面板投影导出");
assert.equal(typeof exportsShape.findCard, "function");
assert.equal(typeof exportsShape.assembleMessage, "function", "消息组装导出");
assert.equal(typeof exportsShape.draftMatches, "function", "草稿等校验导出");
assert.equal(typeof exportsShape.createPendingActionStore, "function", "一次性标记导出");
assert.equal(typeof exportsShape.consumePendingAction, "function", "hero 消费导出");
assert.equal(typeof exportsShape.createActionExecutor, "function", "执行链路导出");
assert.equal(typeof exportsShape.isUiChromeTarget, "function", "键盘守卫导出");
assert.equal(typeof exportsShape.drillStore?.set, "function", "钻取镜像 store 导出");
assert.equal(typeof exportsShape.ProposalPanel, "function", "面板组件导出");
assert.equal(typeof exportsShape.ActionBar, "function", "动作条组件导出");
assert.equal(typeof exportsShape.ActionHeroDock, "function", "hero 消费组件导出");
assert.equal(typeof exportsShape.CosmosSettingsSection, "function", "设置节组件导出");
assert.deepEqual(exportsShape.cosmosButtonsFace.getSnapshot(), { buttons: [] }, "动作条投影初始为空（未接通配置通道）");

/* ── 星座动作观测面（add-cosmos-constellation-actions）── */
assert.equal(typeof exportsShape.normalizeConstButtons, "function", "星座按钮归一化导出");
assert.equal(typeof exportsShape.constButtonsSectionOf, "function", "星座读面投影导出");
assert.equal(typeof exportsShape.constButtonDraftOf, "function", "星座草稿构造导出");
assert.equal(typeof exportsShape.constButtonIssue, "function", "星座草稿校验导出");
assert.equal(typeof exportsShape.CONSTELLATION_PROFILE, "object", "星座设置 profile 导出");
assert.equal(exportsShape.CONSTELLATION_PROFILE.section, "constellationButtons");
assert.equal(typeof exportsShape.createConstellationExecutor, "function", "星座执行链路导出");
assert.equal(typeof exportsShape.createFloatMarkerStore, "function", "浮窗标记通道导出");
assert.equal(exportsShape.createFloatMarkerStore().ttlMs, 10000, "浮窗标记 TTL 10s");
assert.equal(typeof exportsShape.constellationMessageOf, "function", "纯提示词组装导出");
assert.equal(typeof exportsShape.floatPresentationOf, "function", "浮窗门控纯函数导出");
assert.equal(typeof exportsShape.createActionGate, "function", "共享防重入门导出");
assert.equal(typeof exportsShape.createButtonSettingsController, "function", "参数化设置控制器导出");
assert.equal(typeof exportsShape.ConstActionBar, "function", "星座动作条组件导出");
assert.equal(typeof exportsShape.ConstellationFloatDock, "function", "星座浮窗条目组件导出");
assert.equal(exportsShape.ConstellationNativeWindow, undefined, "原生浮动输入窗口组件零残留（rework 拆除死槽位实现）");
assert.equal(exportsShape.nativeWindowOf, undefined, "原生窗口门控纯函数零残留");
assert.equal(typeof exportsShape.actionButtonVisible, "function", "前置状态呈现门控导出");
assert.equal(typeof exportsShape.assembleEmbryoMessage, "function", "星胚消息组装导出");
assert.equal(typeof exportsShape.createEmbryoActionExecutor, "function", "星胚执行链路导出");
assert.equal(typeof exportsShape.explorationTargetOf, "function", "探索会话目标解析导出");
assert.equal(typeof exportsShape.EmbryoActionDock, "function", "星胚 dock 条目组件导出");
assert.deepEqual(exportsShape.cosmosConstButtonsFace.getSnapshot(), { constellationButtons: [] }, "星座投影初始为空（未接通配置通道）");
/* ── 皮肤观测面（add-cosmos-skin-themes）── */
assert.equal(typeof exportsShape.createSkin, "function", "皮肤工厂导出");
assert.equal(typeof exportsShape.applySkinTokens, "function", "HUD 令牌下发导出");
assert.equal(typeof exportsShape.CosmosSkinPanel, "function", "皮肤面板组件导出");
assert.equal(typeof exportsShape.cosmosSkinStore?.getSnapshot, "function", "当前皮肤投影导出");
assert.equal(exportsShape.COSMOS_SKINS.length, 12, "12 套内置皮肤注册表导出");
assert.equal(exportsShape.COSMOS_DEFAULT_SKIN, "rosepine", "默认皮肤 = rosepine");
assert.ok(exportsShape.COSMOS_SKIN_IDS.includes("deepspace"), "id 枚举含回归基线 deepspace");
assert.equal(exportsShape.createSkin("nope").skin, "rosepine", "未知 id → 回落默认（不抛错）");
assert.equal(typeof exportsShape.cosmosSkinStore.getSnapshot().skin, "string", "当前皮肤投影快照含 id");
/* 两族 face 互不读写（各自初始形状只有自己的键）。 */
assert.deepEqual(Object.keys(exportsShape.cosmosButtonsFace.getSnapshot()), ["buttons"]);
assert.deepEqual(Object.keys(exportsShape.cosmosConstButtonsFace.getSnapshot()), ["constellationButtons"]);
/* ── 选择失败观测面（fix-cosmos-skin-select-feedback 1.1/4.1）── */
assert.equal(typeof exportsShape.cosmosSelectHealthOf, "function", "选择失败观测面导出");
assert.deepEqual(
  Object.keys(exportsShape.cosmosSelectHealthOf()).sort(),
  ["controllerAlive", "lastFailure"],
  "观测面形状 = controllerAlive + lastFailure（无 DOM 依赖）"
);

/* ── 会话卡归档观测面（add-cosmos-session-archive-action / design D5）──
   纯逻辑模块随 client.jsx import 链并入 bundle（无 files/check 清单变更），
   导出面同步供 bundle 级冒烟直测。 */
assert.equal(typeof exportsShape.isSessionArchiveOutcome, "function", "outcome 合法性判定导出");
assert.equal(exportsShape.isSessionArchiveOutcome("skipped"), true, "合法 outcome");
assert.equal(exportsShape.isSessionArchiveOutcome("nope"), false, "非法 outcome 拒绝");
assert.equal(typeof exportsShape.activitySummaryOf, "function", "activity 摘要导出");
assert.equal(exportsShape.activitySummaryOf([{ family: "turn" }, { family: "subagent", items: [{ id: "a" }, { id: "b" }] }]), "运行回合；子代理 ×2", "bundle 内 activity 摘要口径");
assert.equal(typeof exportsShape.archiveNoticeOf, "function", "outcome → 文案映射导出");
assert.deepEqual(exportsShape.archiveNoticeOf({ outcome: "already-archived" }), { outcome: "already-archived", tone: "neutral", text: "该会话已归档" }, "bundle 内中性文案口径");
assert.equal(exportsShape.archiveNoticeOf({ outcome: "skipped", activity: [{ family: "job" }] }).text, "会话仍在运行，未归档：后台任务", "bundle 内 skipped 文案口径");
assert.equal(typeof exportsShape.archiveRequestFailureNotice, "function", "请求失败文案导出");
assert.equal(exportsShape.archiveRequestFailureNotice("500").tone, "error", "请求失败基调");

/* ── 激活冒烟（apply 走通：注册表形状 + 无异常 + 通道降级） ──
   React 组件不挂载（bundle external），但 apply 的接线逻辑（槽位注册/通道装配/
   控制器创建/清理）在 stub ctx 上真实执行——捕获激活期 TypeError/ReferenceError。 */
{
  const effects = [];
  const registered = [];
  const cleanups = [];
  const slotService = {
    inject(name, fn) {
      const result = fn();
      if (typeof result === "function") cleanups.push(result);
      return result;
    },
    register(options, component) {
      registered.push({ options, component });
      return () => {};
    },
    entries: () => [],
    getVersion: () => 0,
    subscribe: () => () => {}
  };
  const locale = {
    register: () => () => {},
    bind: () => (key) => key,
    getSnapshot: () => ({ revision: 1 }),
    subscribe: () => () => {}
  };
  const stubCtx = {
    slots: slotService,
    locale,
    effect(fn) {
      effects.push(fn);
      const disposer = fn();
      if (typeof disposer === "function") cleanups.push(disposer);
      return () => {};
    },
    inject(_deps, callback) {
      callback({});
      return () => {};
    },
    logger: { warn() {} }
  };
  exportsShape.apply(stubCtx);
  /* 样式 effect 在无 document 的 Node 环境跳过；词典 + 设置作用域 + 控制器 ≥3。 */
  assert.ok(effects.length >= 3, "ctx.effect 注册（词典/设置作用域/控制器）");
  const names = registered.map((entry) => entry.options.name);
  assert.ok(names.includes("sidebar.footer.action"), "座位槽位注册");
  assert.ok(names.includes("shell.overlay"), "整页槽位注册");
  assert.ok(names.includes("settings.section"), "设置节注册");
  assert.ok(names.includes("settings.v-cosmos.tab"), "设置标签页注册");
  assert.ok(names.includes("conversation.input.dock"), "hero 消费条目注册");
  assert.ok(!names.includes("conversation.session.header.actions"), "会话头 actions 条目零残留（rework：空白会话不渲染该槽位 → 结构性死锁）");
  assert.ok(!registered.some((entry) => entry.options.id === "v-cosmos-native-window"), "窗口条目零残留");
  /* 浮窗条目增强注入（rework 方案 2：模型目录 face + 语音转写桥 face）。 */
  const floatDockEntry = registered.find((entry) => entry.options.id === "v-cosmos-constellation-float");
  assert.ok(floatDockEntry, "浮窗条目 id");
  const floatDockEnhanced = floatDockEntry.options.inject("float-sess");
  assert.equal(floatDockEnhanced.sessionId, "float-sess", "浮窗条目注入目标会话 id");
  assert.equal(typeof floatDockEnhanced.models?.getSnapshot, "function", "浮窗条目注入模型目录 face");
  assert.equal(typeof floatDockEnhanced.speech?.getSnapshot, "function", "浮窗条目注入语音转写桥 face");
  assert.equal(typeof floatDockEnhanced.speech?.transcribe, "function", "语音 face 暴露 transcribe");
  assert.equal(typeof floatDockEnhanced.speech?.openBundle, "function", "语音 face 暴露 openBundle 引导");
  assert.equal(typeof floatDockEntry.component, "function", "浮窗组件为函数组件");
  const section = registered.find((entry) => entry.options.name === "settings.section");
  assert.equal(section.options.id, "v-cosmos");
  assert.equal(typeof section.options.children["settings.v-cosmos.tab"], "object", "子标签槽声明");
  assert.equal(typeof section.options.inject, "function", "节 inject（hooks.tabs）");
  const tabs = registered.filter((entry) => entry.options.name === "settings.v-cosmos.tab");
  assert.equal(tabs.length, 4, "四条标签页（快捷动作 / 星座动作 / 皮肤 / 导航）");
  const actionTab = tabs.find((entry) => entry.options.id === "actions");
  const constTab = tabs.find((entry) => entry.options.id === "constellation-actions");
  const skinTab = tabs.find((entry) => entry.options.id === "skins");
  const navTab = tabs.find((entry) => entry.options.id === "nav");
  assert.ok(actionTab && constTab && skinTab && navTab, "标签页 id 齐备");
  assert.equal(actionTab.options.order, 0, "快捷动作 order 0");
  assert.equal(constTab.options.order, 1, "星座动作 order 1（排于其后）");
  assert.equal(skinTab.options.order, 2, "皮肤 order 2（add-cosmos-skin-themes 3.4）");
  assert.equal(navTab.options.order, 3, "导航 order 3（add-cosmos-zoom-focus-nav 3.1）");
  assert.equal(typeof skinTab.options.label, "function", "皮肤标签文案走词典");
  assert.equal(typeof navTab.options.label, "function", "导航标签文案走词典");
  const navInjected = navTab.options.inject();
  assert.equal(typeof navInjected.nav?.getSnapshot, "function", "导航标签页注入 face.getSnapshot");
  assert.equal(typeof navInjected.nav?.subscribe, "function", "导航标签页注入 face.subscribe");
  assert.equal(typeof navInjected.nav?.set, "function", "导航标签页注入 face.set（改动即生效）");
  const navSnapshot = navInjected.nav.getSnapshot();
  assert.deepEqual(
    [navSnapshot.zoomDiveRatio, navSnapshot.zoomFlyOutRatio, navSnapshot.zoomPointerFocus],
    [100, 25, true],
    "face 快照含缩放导航三键默认"
  );
  /* 数据链直测（add-cosmos-zoom-focus-nav 3.2/3.4）：face.set → 控制器 saveNav →
     净房持久化（Node 无 localStorage → 合并净房结果）→ 受控镜像同步。engine 未 attach
     时 setTuning 为 no-op（热更链理由 engine-smoke/浏览器走查覆盖）。 */
  const navSetResult = navInjected.nav.set({ zoomDiveRatio: 80, zoomFlyOutRatio: 40, zoomPointerFocus: false });
  const navAfter = navInjected.nav.getSnapshot();
  assert.deepEqual(
    [navAfter.zoomDiveRatio, navAfter.zoomFlyOutRatio, navAfter.zoomPointerFocus],
    [80, 40, false],
    "导航 face.set 即时写回受控镜像（改动即生效）"
  );
  navInjected.nav.set({ zoomDiveRatio: 100, zoomFlyOutRatio: 25, zoomPointerFocus: true });
  assert.deepEqual(
    [navInjected.nav.getSnapshot().zoomDiveRatio, navInjected.nav.getSnapshot().zoomFlyOutRatio, navInjected.nav.getSnapshot().zoomPointerFocus],
    [100, 25, true],
    "恢复默认（避免污染后续断言）"
  );
  assert.equal(typeof navTab.component, "function", "导航面板为函数组件");
  const skinInjected = skinTab.options.inject();
  assert.equal(typeof skinInjected.skins?.getSnapshot, "function", "皮肤标签页注入 face.getSnapshot");
  assert.equal(typeof skinInjected.skins?.subscribe, "function", "皮肤标签页注入 face.subscribe");
  assert.equal(typeof skinInjected.skins?.select, "function", "皮肤标签页注入 face.select（点选即生效）");
  assert.equal(typeof skinInjected.skins.getSnapshot().skin, "string", "face 快照含当前皮肤 id");
  assert.equal(typeof skinTab.component, "function", "皮肤面板为函数组件");
  /* 皮肤 face.select → 控制器顶层 selectSkin（与导航页签同款暴露）：选择即时写回 store。 */
  assert.equal(skinInjected.skins.select("fermata"), "fermata", "皮肤面点选 → 控制器 selectSkin 生效");
  assert.equal(exportsShape.cosmosSkinStore.getSnapshot().skin, "fermata", "选择即时写回皮肤 store");
  skinInjected.skins.select("rosepine"); // 恢复默认，避免污染后续断言
  const injected = actionTab.options.inject();
  assert.equal(typeof injected.face?.save, "function", "快捷动作标签页注入设置控制器 face");
  assert.equal(typeof injected.models?.subscribe, "function", "标签页注入模型目录 face");
  assert.equal(injected.variant, undefined, "快捷动作标签页缺省 variant");
  const constInjected = constTab.options.inject();
  assert.equal(typeof constInjected.face?.save, "function", "星座标签页注入第二控制器实例");
  assert.notEqual(constInjected.face, injected.face, "两标签页控制器实例互相独立");
  assert.equal(constInjected.variant, "constellation", "星座标签页 variant 注入");
  assert.equal(constInjected.models, injected.models, "模型目录面同源共享（只读）");

  const docks = registered.filter((entry) => entry.options.name === "conversation.input.dock");
  assert.equal(docks.length, 3, "三条 dock 条目（hero + 星座浮窗 + 星胚）");
  const hero = docks.find((entry) => entry.options.id === "v-cosmos-action-hero");
  const float = docks.find((entry) => entry.options.id === "v-cosmos-constellation-float");
  const embryo = docks.find((entry) => entry.options.id === "v-cosmos-embryo-action");
  assert.ok(hero && float && embryo, "dock 条目 id 齐备");
  const heroInjected = hero.options.inject("sess-1");
  assert.equal(heroInjected.pending?.ttlMs, 10000, "hero 注入同一 pendingAction 实例（fiber 作用域）");
  assert.equal(typeof heroInjected.switchModel, "function", "hero 注入模型切换通道");
  assert.equal(typeof heroInjected.notify, "function", "hero 注入 toast 通道");
  assert.equal(heroInjected.floats, undefined, "hero 条目不持有浮窗通道");
  assert.equal(typeof hero.component, "function", "hero 组件为函数组件（渲染 null）");
  const floatInjected = float.options.inject("sess-1");
  assert.equal(floatInjected.floats?.ttlMs, 10000, "浮窗条目注入独立浮窗标记实例（TTL 10s）");
  assert.notEqual(floatInjected.floats, heroInjected.pending, "双通道 store 互相独立（标记不误食）");
  assert.equal(floatInjected.pending, undefined, "浮窗条目不持有 hero 通道");
  assert.equal(typeof floatInjected.switchModel, "function", "浮窗注入模型切换通道（链路先行）");
  assert.equal(typeof floatInjected.notify, "function", "浮窗注入 toast 通道");
  assert.equal(typeof float.component, "function", "浮窗组件为函数组件（无标记时渲染 null）");
  /* 星胚条目（add-cosmos-action-prestate-gate 3.3）：第三通道独立 store、零跨通道读取。 */
  const embryoInjected = embryo.options.inject("sess-1");
  assert.equal(embryoInjected.pending?.ttlMs, 10000, "星胚条目注入独立标记实例（TTL 10s）");
  assert.notEqual(embryoInjected.pending, heroInjected.pending, "星胚通道与 hero 通道互相独立");
  assert.notEqual(embryoInjected.pending, floatInjected.floats, "星胚通道与浮窗通道互相独立");
  assert.equal(embryoInjected.floats, undefined, "星胚条目不持有浮窗通道");
  assert.equal(typeof embryoInjected.switchModel, "function", "星胚注入模型切换通道（先切后发）");
  assert.equal(typeof embryoInjected.notify, "function", "星胚注入 toast 通道（守卫提示）");
  assert.equal(typeof embryo.component, "function", "星胚组件为函数组件（渲染 null）");
  /* 清理器可执行（插件卸载路径不抛错）。 */
  for (const cleanup of cleanups) cleanup();
}

/* ── 选择失败可观测面（fix-cosmos-skin-select-feedback 1.1–1.4 / 2.1–2.4 / 4.1）──
   独立 bundle 实例 + 延迟执行 effect 的 stub（controllerRef 恒 null = 死控制器）：
   直测 face 边界的失败落印 / 写守卫幂等 / 面板「未生效」提示与 face 缺失占位 /
   控制器复活后的自愈。面板用最小 React 桩（hooks 直返快照）+ 捕获型 JSX 桩直接
   调用函数组件——Node 侧不挂载组件树，但返回值可遍历断言（与真机走查互补）。 */
{
  const jsxRuntime = {
    Fragment: Symbol("Fragment"),
    jsx(type, props, key) {
      return { type, key: key === undefined ? null : key, props: props ?? {} };
    },
    jsxs(type, props, key) {
      return { type, key: key === undefined ? null : key, props: props ?? {} };
    }
  };
  const reactStub = {
    useSyncExternalStore(_subscribe, getSnapshot) {
      return getSnapshot();
    },
    useState(initial) {
      return [typeof initial === "function" ? initial() : initial, () => {}];
    },
    useEffect() {},
    useLayoutEffect() {},
    useMemo(factory) {
      return factory();
    },
    useRef(value) {
      return { current: value };
    }
  };
  const panelRequire = (name) => {
    if (name === "react") return reactStub;
    if (name === "react/jsx-runtime") return jsxRuntime;
    return new Proxy({}, { get: () => () => ({}) });
  };
  const collectElements = (node, out = []) => {
    if (Array.isArray(node)) {
      for (const child of node) collectElements(child, out);
      return out;
    }
    if (node === null || node === undefined || typeof node !== "object" || node.type === undefined) return out;
    out.push(node);
    collectElements(node.props.children, out);
    return out;
  };
  const textOf = (node) => {
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(textOf).join("");
    if (node === null || node === undefined || typeof node !== "object") return "";
    return textOf(node.props?.children);
  };

  const fresh = def.factory(panelRequire);
  const recordedEffects = [];
  const registered = [];
  const cleanups = [];
  const slotService = {
    inject(name, fn) {
      const result = fn();
      if (typeof result === "function") cleanups.push(result);
      return result;
    },
    register(options, component) {
      registered.push({ options, component });
      return () => {};
    },
    entries: () => [],
    getVersion: () => 0,
    subscribe: () => () => {}
  };
  const locale = {
    register: () => () => {},
    bind: () => (key) => key,
    getSnapshot: () => ({ revision: 1 }),
    subscribe: () => () => {}
  };
  const stubCtx = {
    slots: slotService,
    locale,
    /* 不执行 effect：控制器创建被推迟 → controllerRef.current 恒 null（死控制器场景）。 */
    effect(fn) {
      recordedEffects.push(fn);
      return () => {};
    },
    inject(_deps, callback) {
      callback({});
      return () => {};
    },
    logger: { warn() {} }
  };
  fresh.apply(stubCtx);

  const tabs = registered.filter((entry) => entry.options.name === "settings.v-cosmos.tab");
  const skinTab = tabs.find((entry) => entry.options.id === "skins");
  const navTab = tabs.find((entry) => entry.options.id === "nav");
  assert.ok(skinTab && navTab, "两页签注册可直取 face");
  const skinInjected = skinTab.options.inject();
  const navInjected = navTab.options.inject();
  const skinFace = skinInjected.skins;
  const navFace = navInjected.nav;
  assert.equal(typeof skinInjected.selectHealth?.subscribe, "function", "皮肤页签注入 health face");
  assert.equal(navInjected.selectHealth, skinInjected.selectHealth, "两页签共享同一 health face（单通道）");

  /* 观测面形状（D3）。 */
  const initialHealth = fresh.cosmosSelectHealthOf();
  assert.deepEqual(Object.keys(initialHealth).sort(), ["controllerAlive", "lastFailure"], "观测面 = controllerAlive + lastFailure");
  assert.equal(initialHealth.controllerAlive, false, "effect 未执行 → 控制器缺席");
  assert.equal(initialHealth.lastFailure, null, "初始无失败记录（不误报）");

  /* 死控制器点选（1.3）：返回默认 id、不造假持久化、落印失败原因。 */
  assert.equal(skinFace.select("fermata"), "rosepine", "控制器缺失 → 返回默认皮肤（调用面零变化）");
  assert.equal(fresh.cosmosSkinStore.getSnapshot().skin, "rosepine", "死控制器不写偏好 store（不做假持久化）");
  const firstFailure = fresh.cosmosSelectHealthOf().lastFailure;
  assert.equal(firstFailure?.face, "skin", "失败记录归属 skin");
  assert.equal(firstFailure?.code, "controller-missing", "原因码 = controller-missing");
  assert.equal(typeof firstFailure?.at, "number", "失败记录含时刻");

  /* 写守卫（1.2）：同 face 同 code 连续失败复用现有快照引用（不 set / 不刷新 at）。 */
  const failureRef = firstFailure;
  skinFace.select("deepspace");
  skinFace.select("fermata");
  assert.ok(Object.is(fresh.cosmosSelectHealthOf().lastFailure, failureRef), "同因连续失败不产生新快照引用（幂等落印）");
  assert.equal(firstFailure.at, fresh.cosmosSelectHealthOf().lastFailure.at, "同因连续失败不刷新 at");

  /* 面板呈现（2.1）：提示条 + 原因码后缀，卡片网格保留（可重试，无白屏）。 */
  const skinElements = collectElements(fresh.CosmosSkinPanel({ t: (key) => key, skins: skinFace, selectHealth: skinInjected.selectHealth }));
  const skinNotice = skinElements.find((el) => el.props.className === "cs-error");
  assert.ok(skinNotice, "失败时皮肤面板渲染「未生效」提示条");
  assert.equal(skinNotice?.props.role, "status", "提示条以 status 语义播报");
  assert.ok(textOf(skinNotice).includes("皮肤选择未生效"), "提示条含未生效文案");
  assert.ok(textOf(skinNotice).includes("controller-missing"), "提示条含原因码后缀");
  assert.ok(skinElements.some((el) => el.props.className === "cs-skinGrid"), "提示条不吞卡片网格（重试入口保留）");
  const fermataCard = skinElements.find((el) => el.props["data-skin"] === "fermata");
  assert.ok(fermataCard && typeof fermataCard.props.onClick === "function", "卡片仍可点击（死控制器不 disabled）");
  fermataCard.props.onClick();
  assert.ok(Object.is(fresh.cosmosSelectHealthOf().lastFailure, failureRef), "卡片点击二次失败仍复用快照引用");

  /* face 缺失降级占位（2.2）：不渲染卡片网格。 */
  const skinPlaceholder = collectElements(fresh.CosmosSkinPanel({ t: (key) => key, skins: null, selectHealth: skinInjected.selectHealth }));
  assert.ok(textOf(skinPlaceholder).includes("皮肤选择暂不可用"), "skins face 缺失 → 降级占位文案");
  assert.ok(!skinPlaceholder.some((el) => el.props.className === "cs-skinGrid"), "占位不渲染卡片网格");

  /* 导航写入（1.4）：受控镜像不流转 + 落印 nav 失败。 */
  const navBefore = navFace.getSnapshot();
  navFace.set({ zoomDiveRatio: 80 });
  const navAfter = navFace.getSnapshot();
  assert.deepEqual(
    [navAfter.zoomDiveRatio, navAfter.zoomFlyOutRatio, navAfter.zoomPointerFocus],
    [navBefore.zoomDiveRatio, navBefore.zoomFlyOutRatio, navBefore.zoomPointerFocus],
    "控制器缺失 → 受控镜像不流转（返回当前快照）"
  );
  const navFailure = fresh.cosmosSelectHealthOf().lastFailure;
  assert.equal(navFailure?.face, "nav", "失败记录迁移至 nav");
  assert.equal(navFailure?.code, "controller-missing", "nav 同原因码");
  assert.ok(!Object.is(navFailure, failureRef), "face 迁移产生新快照（状态迁移语义）");

  /* 界面面板提示（2.3）+ face 缺失占位（add-cosmos-layout-tuning 起页签更名「界面」）。 */
  const navTree = collectElements(fresh.CosmosNavPanel({ t: (key) => key, nav: navFace, selectHealth: navInjected.selectHealth }));
  const navNotice = navTree.find((el) => el.props.className === "cs-error");
  assert.ok(navNotice && textOf(navNotice).includes("界面设置未生效"), "界面面板渲染「未生效」提示条");
  assert.ok(textOf(navNotice).includes("controller-missing"), "界面提示含原因码后缀");
  const navPlaceholder = collectElements(fresh.CosmosNavPanel({ t: (key) => key, nav: null }));
  assert.ok(textOf(navPlaceholder).includes("界面设置暂不可用"), "nav face 缺失 → 降级占位文案");
  assert.ok(!navPlaceholder.some((el) => el.props.className === "cs-navInput"), "占位不渲染数字输入控件");
  assert.ok(!navPlaceholder.some((el) => el.props.className === "cs-sizeInput"), "占位不渲染尺寸输入控件");

  /* 「发送前编辑」face（add-cosmos-native-composer 4.1）：星座动作页签正交注入；
     死控制器同款——镜像不流转 + 落印 preflight 失败（不造假持久化）。 */
  const constTab = tabs.find((entry) => entry.options.id === "constellation-actions");
  assert.ok(constTab, "星座动作页签注册可直取 face");
  const preflightFace = constTab.options.inject().preflight;
  assert.equal(typeof preflightFace?.getSnapshot, "function", "星座动作页签注入 preflight face.getSnapshot");
  assert.equal(typeof preflightFace?.subscribe, "function", "preflight face.subscribe");
  assert.equal(typeof preflightFace?.set, "function", "preflight face.set（改动即生效）");
  assert.deepEqual(Object.keys(preflightFace.getSnapshot()), ["constPreflight"], "face 快照形状 = 单键镜像");
  assert.equal(preflightFace.getSnapshot().constPreflight, "float", "缺省分支 = float（rework 星空保持优先）");
  preflightFace.set("native");
  assert.equal(preflightFace.getSnapshot().constPreflight, "float", "死控制器 → 受控镜像不流转");
  const preflightFailure = fresh.cosmosSelectHealthOf().lastFailure;
  assert.equal(preflightFailure?.face, "preflight", "失败记录归属 preflight");
  assert.equal(preflightFailure?.code, "controller-missing", "preflight 同原因码");

  /* 复活（重载完成 / 页面刷新）：effect 执行 → 控制器就位 → 重选自愈。 */
  for (const effect of recordedEffects) {
    const disposer = effect();
    if (typeof disposer === "function") cleanups.push(disposer);
  }
  assert.equal(fresh.cosmosSelectHealthOf().controllerAlive, true, "effect 执行后控制器复活");

  assert.equal(skinFace.select("fermata"), "fermata", "复活后点选生效（返回生效 id）");
  assert.equal(fresh.cosmosSkinStore.getSnapshot().skin, "fermata", "复活后选择写回 store");
  assert.equal(fresh.cosmosSelectHealthOf().lastFailure, null, "成功路径自愈：失败记录清除");
  navFace.set({ zoomDiveRatio: 80 });
  assert.equal(fresh.cosmosSelectHealthOf().lastFailure, null, "导航成功写入后保持无失败记录");
  assert.equal(navFace.getSnapshot().zoomDiveRatio, 80, "复活后导航写入生效（受控镜像流转）");
  navFace.set({ zoomDiveRatio: 100 });
  skinFace.select("rosepine"); // 恢复默认，避免污染后续断言
  /* 「发送前编辑」切换即时写回（4.1）：控制器就位后 face.set → savePreflight →
     净房结果返回 + 受控镜像流转；非法值回落 float（净房同源，rework 缺省翻转）。 */
  const preflightApplied = preflightFace.set("native");
  assert.equal(preflightApplied?.constPreflight, "native", "切换返回净房后的设置（即时写回）");
  assert.equal(preflightFace.getSnapshot().constPreflight, "native", "复活后切换生效（受控镜像流转）");
  assert.equal(fresh.cosmosSelectHealthOf().lastFailure, null, "成功后无失败记录（自愈）");
  assert.equal(preflightFace.set("bogus")?.constPreflight, "float", "非法分支净房回落 float");
  assert.equal(preflightFace.getSnapshot().constPreflight, "float", "镜像同步回落值");
  preflightFace.set("float"); // 恢复默认，避免污染后续断言

  for (const cleanup of cleanups) cleanup();
}

/* sourcemap 同步产出（宿主 client-modules 探测组装索引 map）。 */
const mapPath = fileURLToPath(new URL("../lib/client.js.map", import.meta.url));
const map = JSON.parse(readFileSync(mapPath, "utf8"));
assert.equal(map.file, "client.js", "map.file 键补齐");
assert.ok(Array.isArray(map.sources) && map.sources.some((s) => s.includes("client.jsx")), "map 回指源码");

console.log("factory-smoke: all assertions passed");
