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
assert.equal(typeof exportsShape.bindSession, "function", "显式关联绑定通道导出（fix-cosmos-association-scope 3.1）");
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
assert.equal(typeof exportsShape.floatTextareaHeightOf, "function", "浮窗文本面增高夹取纯函数导出（p1-align-const-float-native-layout 3.3）");
assert.equal(typeof exportsShape.createActionGate, "function", "共享防重入门导出");
assert.equal(typeof exportsShape.createButtonSettingsController, "function", "参数化设置控制器导出");
assert.equal(typeof exportsShape.ConstActionBar, "function", "星座动作条组件导出");
assert.equal(typeof exportsShape.ConstellationFloatDock, "function", "星座浮窗条目组件导出");
/* ── 浮窗图片附件观测面（p2-add-const-float-image-attach 1.1/1.2/6.4）── */
assert.equal(typeof exportsShape.createAttachFace, "function", "attachFace 工厂导出（注入面与缺席形态可直测）");
assert.equal(typeof exportsShape.clipboardFilesOf, "function", "剪贴板文件收集纯函数导出");
assert.ok(Array.isArray(exportsShape.FLOAT_IMAGE_TYPES), "图片 MIME 白名单导出");
assert.deepEqual(
  [...exportsShape.FLOAT_IMAGE_TYPES],
  ["image/png", "image/jpeg", "image/webp", "image/gif"],
  "白名单 = 宿主 isImageMediaType 四类（本地复刻）"
);
assert.equal(exportsShape.FLOAT_IMAGE_ACCEPT, "image/png,image/jpeg,image/webp,image/gif", "accept 值与白名单同源");
assert.equal(exportsShape.FLOAT_ATTACH_WATCH_MS, 10000, "附件观察态看门狗 10s");
for (const name of ["floatSendPlanOf", "floatWatchOutcomeOf", "floatAttachmentsPendingOf", "intakeFloatImages", "removeFloatAttachment"]) {
  assert.equal(typeof exportsShape[name], "function", "附件纯逻辑导出：" + name);
}
assert.equal(exportsShape.floatSendPlanOf({ draft: "  ", attachmentIds: [] }), "empty", "空输入分类（观察面可用）");
/* 缺席形态（旧宿主 / 服务不可达）：available=false、mint 抛错、resolve 恒空、uploads 稳定空面。 */
{
  const absent = exportsShape.createAttachFace();
  assert.equal(absent.available, false, "face 缺席 → available=false");
  assert.throws(() => absent.mint("s", [], true), /附件铸造不可用/, "缺席 mint 抛错（MUST NOT 静默成功）");
  assert.deepEqual(absent.resolve(["a"]), [], "缺席 resolve 恒空（rail 零布局）");
  assert.equal(typeof absent.release, "function", "缺席 release 为 no-op");
  assert.equal(absent.uploads.getSnapshot(), absent.uploads.getSnapshot(), "缺席上传快照引用稳定（useSyncExternalStore 契约）");
  const off = absent.uploads.subscribe(() => {});
  assert.equal(typeof off, "function", "缺席上传订阅返回退订函数");
}
/* 注入形态（动词齐备）：available=true、mint 薄透传 ids、抛错原样上抛、uploads 委托服务。 */
{
  const calls = [];
  const service = {
    createDrafts: (sessionId, files, uploadImages) => files.map((file) => ({ id: "draft-" + file.name, kind: "image" })),
    resolveDraftAttachments: (ids) => ids.map((id) => ({ id, kind: "image" })),
    releaseDraftAttachment: (id) => calls.push(id),
    fileUploads: { getSnapshot: () => ({ draft: { status: "uploading" } }), subscribe: () => () => {} }
  };
  const face = exportsShape.createAttachFace({
    service: () => service,
    uploads: { getSnapshot: () => service.fileUploads.getSnapshot(), subscribe: () => () => {} }
  });
  assert.equal(face.available, true, "四件齐备 → available=true");
  assert.deepEqual(face.mint("s1", [{ name: "a.png" }], true).ids, ["draft-a.png"], "mint 返回有序 ids");
  assert.deepEqual(face.resolve(["x"]), [{ id: "x", kind: "image" }], "resolve 薄透传");
  face.release("x");
  assert.deepEqual(calls, ["x"], "release 薄透传");
  assert.deepEqual(face.uploads.getSnapshot(), { draft: { status: "uploading" } }, "uploads 引用注入面（apply 侧受控镜像）");
  const broken = exportsShape.createAttachFace({
    service: () => ({ ...service, createDrafts: () => { throw new Error("unsupported image media type: image/bmp"); } })
  });
  assert.throws(() => broken.mint("s1", [], true), /unsupported image media type/, "mint 抛错薄透传（face MUST NOT 吞错）");
  assert.equal(exportsShape.createAttachFace({ service: () => ({ createDrafts: () => [] }) }).available, false, "动词缺失 → 降级");
}
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

/* ── 宿主当前会话跟随观测面（add-cosmos-host-session-follow）──
   纯逻辑模块随 client.jsx import 链并入 bundle（无 files/check 清单变更），
   导出面同步供 bundle 级冒烟直测（行为直测在 host-session-follow-smoke）。 */
assert.equal(typeof exportsShape.currentSessionIdOf, "function", "单点出口导出");
assert.equal(exportsShape.currentSessionIdOf({
  uiSession: { adapter: { current: { getSnapshot: () => ({ key: "s-bundle" }) } } }
}), "s-bundle", "bundle 内单点出口采信主源快照");
assert.equal(exportsShape.currentSessionIdOf(null, "s-mirror"), "s-mirror", "bundle 内单点出口回落镜像");
assert.equal(typeof exportsShape.wsIdBySessionId, "function", "会话 id → 星座解析导出");
assert.equal(exportsShape.wsIdBySessionId({
  workspaces: [{ id: "w-bundle", planets: [{ id: "p-bundle" }], comets: [] }]
}, "p-bundle"), "w-bundle", "bundle 内星座解析口径");
assert.equal(typeof exportsShape.createHostSessionFollow, "function", "跟随器工厂导出");

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
  assert.equal(tabs.length, 6, "六条标签页（通用 / 快捷动作 / 星座动作 / 皮肤 / 界面 / 快捷键）");
  const generalTab = tabs.find((entry) => entry.options.id === "general");
  const actionTab = tabs.find((entry) => entry.options.id === "actions");
  const constTab = tabs.find((entry) => entry.options.id === "constellation-actions");
  const skinTab = tabs.find((entry) => entry.options.id === "skins");
  const navTab = tabs.find((entry) => entry.options.id === "nav");
  const shortcutsTab = tabs.find((entry) => entry.options.id === "shortcuts");
  assert.ok(generalTab && actionTab && constTab && skinTab && navTab && shortcutsTab, "标签页 id 齐备");
  assert.equal(generalTab.options.order, -1, "通用 order -1（置于「快捷动作」之前，add-cosmos-rightbar-dock）");
  assert.equal(actionTab.options.order, 0, "快捷动作 order 0");
  assert.equal(constTab.options.order, 1, "星座动作 order 1（排于其后）");
  assert.equal(skinTab.options.order, 2, "皮肤 order 2（add-cosmos-skin-themes 3.4）");
  assert.equal(navTab.options.order, 3, "导航 order 3（add-cosmos-zoom-focus-nav 3.1）");
  assert.equal(shortcutsTab.options.order, 4, "快捷键 order 4（排于「界面」之后，add-cosmos-shortcuts 7.1）");
  assert.equal(typeof skinTab.options.label, "function", "皮肤标签文案走词典");
  assert.equal(typeof navTab.options.label, "function", "导航标签文案走词典");
  /* 「通用」页签注入面（add-cosmos-rightbar-dock）：launch face（两档，无形态判据） */
  const generalInjected = generalTab.options.inject();
  assert.equal(typeof generalInjected.launch?.getSnapshot, "function", "通用标签页注入 launch face.getSnapshot");
  assert.equal(typeof generalInjected.launch?.subscribe, "function", "通用标签页注入 launch face.subscribe");
  assert.equal(typeof generalInjected.launch?.set, "function", "通用标签页注入 launch face.set（改动即保存）");
  assert.equal(generalInjected.desktop, undefined, "无桌面形态注入（dock 双端同效）");
  assert.equal(generalInjected.launch.getSnapshot().launchMode, "embedded", "face 快照含缺省 launchMode（内嵌）");
  assert.equal(generalInjected.launch.set("dock").launchMode, "dock", "face.set 写穿（Node 无 localStorage → 净房合并结果）");
  assert.equal(generalInjected.launch.set("window").launchMode, "dock", "历史 window 值迁移为 dock");
  assert.equal(generalInjected.launch.set("hacker").launchMode, "embedded", "非法值写侧回落缺省");
  /* 「通用」页签·星座模板名开关 face（add-cosmos-template-name-toggle 1.2）：三件套 + 写穿 */
  assert.equal(typeof generalInjected.templateNames?.getSnapshot, "function", "通用标签页注入 templateNames face.getSnapshot");
  assert.equal(typeof generalInjected.templateNames?.subscribe, "function", "通用标签页注入 templateNames face.subscribe");
  assert.equal(typeof generalInjected.templateNames?.set, "function", "通用标签页注入 templateNames face.set（即时保存）");
  assert.equal(generalInjected.templateNames.getSnapshot().templateNames, false, "face 快照含缺省 templateNames（关闭 = 默认渲染零变化）");
  assert.equal(generalInjected.templateNames.set(true).templateNames, true, "face.set 写穿（Node 无 localStorage → 净房合并结果）");
  assert.equal(generalInjected.templateNames.set(false).templateNames, false, "face.set 关闭写穿");
  assert.equal(generalInjected.templateNames.set("hacker").templateNames, false, "非布尔写侧回落缺省 false");
  assert.ok(exportsShape.cosmosTemplateNamesStore && typeof exportsShape.cosmosTemplateNamesStore.subscribe === "function",
    "templateNames 受控镜像导出（设置页受控读面）");
  /* dock 分流纯逻辑与 store 导出（add-cosmos-rightbar-dock） */
  for (const name of ["dockEntryPlanOf", "findDockTabOf", "dockPresenceOf", "pageCloseActionOf", "dockFallbackNoticeKeyOf"]) {
    assert.equal(typeof exportsShape[name], "function", "dock 纯逻辑导出：" + name);
  }
  assert.ok(exportsShape.cosmosLaunchStore && typeof exportsShape.cosmosLaunchStore.subscribe === "function", "launchMode 受控镜像导出");
  assert.ok(exportsShape.cosmosDockStore && typeof exportsShape.cosmosDockStore.subscribe === "function", "dock 呈现态 store 导出");
  assert.deepEqual(exportsShape.cosmosDockStore.getSnapshot(), { available: false, active: false, sessionId: undefined }, "dock 冷启动不可用（Node 无宿主席位）");
  assert.equal(typeof exportsShape.CosmosDockBody, "function", "dock 正文组件导出");
  assert.equal(typeof exportsShape.launchCosmosEntry, "function", "入口分流导出");
  assert.equal(exportsShape.COSMOS_DOCK_TAB_ID, "dsh-v-cosmos", "dock tab id 常量");
  assert.equal(exportsShape.COSMOS_DOCK_TAB_KIND, "cosmos", "dock tab kind 常量");
  const navInjected = navTab.options.inject();
  assert.equal(typeof navInjected.nav?.getSnapshot, "function", "导航标签页注入 face.getSnapshot");
  assert.equal(typeof navInjected.nav?.subscribe, "function", "导航标签页注入 face.subscribe");
  assert.equal(typeof navInjected.nav?.set, "function", "导航标签页注入 face.set（改动即生效）");
  const navSnapshot = navInjected.nav.getSnapshot();
  assert.deepEqual(
    Object.keys(navSnapshot).sort(),
    [
      "actionBtnHeight", "actionBtnWidth", "addBtnSize", "constActionHeight",
      "constPanelHeight", "constPanelWidth", "hudBtnSize", "searchHeight",
      "searchWidth", "sessionPanelHeight", "sessionPanelWidth", "wsTitleSize",
      "zoomPointerFocus"
    ],
    "face 快照 = 指针聚焦 + 界面尺寸 12 键（缩放阈值两键已退场）"
  );
  assert.equal(navSnapshot.zoomPointerFocus, true, "指针聚焦缺省开");
  assert.equal("zoomDiveRatio" in navSnapshot, false, "快照不含进入阈值键");
  assert.equal("zoomFlyOutRatio" in navSnapshot, false, "快照不含返回阈值键");
  /* 数据链直测（add-cosmos-zoom-focus-nav 3.2/3.4）：face.set → 控制器 saveNav →
     净房持久化（Node 无 localStorage → 合并净房结果）→ 受控镜像同步。engine 未 attach
     时 setTuning 为 no-op（热更链理由 engine-smoke/浏览器走查覆盖）。
     add-cosmos-zoom-ruler 3.2：导航组仅剩指针聚焦开关。 */
  navInjected.nav.set({ zoomPointerFocus: false });
  const navAfter = navInjected.nav.getSnapshot();
  assert.equal(navAfter.zoomPointerFocus, false, "导航 face.set 即时写回受控镜像（指针聚焦关闭）");
  navInjected.nav.set({ zoomPointerFocus: true });
  assert.equal(navInjected.nav.getSnapshot().zoomPointerFocus, true, "恢复默认（避免污染后续断言）");
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
  /* p2 附件注入面：conversation 服务缺席（stub ctx 的 inject 回空 scope）→ 降级 face 在场。 */
  assert.equal(typeof floatInjected.attachFace, "object", "浮窗条目注入 attachFace（p2）");
  assert.equal(floatInjected.attachFace.available, false, "服务不可达 → available=false（添加图片钮置灰可点）");
  assert.equal(typeof floatInjected.attachFace.mint, "function", "降级 face 仍暴露 mint（组件统一调用面）");
  assert.deepEqual(floatInjected.attachFace.uploads.getSnapshot(), {}, "降级上传快照恒空");
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
  navFace.set({ zoomPointerFocus: false });
  const navAfter = navFace.getSnapshot();
  assert.equal(navAfter.zoomPointerFocus, navBefore.zoomPointerFocus, "控制器缺失 → 受控镜像不流转（返回当前快照）");
  assert.equal(navAfter.zoomPointerFocus, true, "死控制器不改写指针聚焦缺省");
  const navFailure = fresh.cosmosSelectHealthOf().lastFailure;
  assert.equal(navFailure?.face, "nav", "失败记录迁移至 nav");
  assert.equal(navFailure?.code, "controller-missing", "nav 同原因码");
  assert.ok(!Object.is(navFailure, failureRef), "face 迁移产生新快照（状态迁移语义）");

  /* 界面面板提示（2.3）+ face 缺失占位（add-cosmos-layout-tuning 起页签更名「界面」）。 */
  const navTree = collectElements(fresh.CosmosNavPanel({ t: (key) => key, nav: navFace, selectHealth: navInjected.selectHealth }));
  const navNotice = navTree.find((el) => el.props.className === "cs-error");
  assert.ok(navNotice && textOf(navNotice).includes("界面设置未生效"), "界面面板渲染「未生效」提示条");
  assert.ok(textOf(navNotice).includes("controller-missing"), "界面提示含原因码后缀");
  /* 导航组收敛（add-cosmos-zoom-ruler 3.2）：仅指针聚焦开关；两阈值数字输入退场。 */
  assert.ok(!navTree.some((el) => el.props.id === "cosmos-nav-dive"), "面板不再渲染进入阈值输入");
  assert.ok(!navTree.some((el) => el.props.id === "cosmos-nav-flyout"), "面板不再渲染返回阈值输入");
  const focusToggle = navTree.find((el) => el.props.type === "checkbox");
  assert.ok(focusToggle, "指针聚焦开关仍在");
  assert.equal(typeof focusToggle.props.onChange, "function", "开关可写（face.set zoomPointerFocus）");
  assert.ok(textOf(navTree).includes("25%"), "navHint 如实说明屏心 25% 闸门");
  const navPlaceholder = collectElements(fresh.CosmosNavPanel({ t: (key) => key, nav: null }));
  assert.ok(textOf(navPlaceholder).includes("界面设置暂不可用"), "nav face 缺失 → 降级占位文案");
  assert.ok(!navPlaceholder.some((el) => el.props.className === "cs-navInput"), "占位不渲染数字输入控件");
  assert.ok(!navPlaceholder.some((el) => el.props.id === "cosmos-nav-dive"), "占位不渲染进入阈值输入（已退场）");
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
  navFace.set({ zoomPointerFocus: false });
  assert.equal(fresh.cosmosSelectHealthOf().lastFailure, null, "导航成功写入后保持无失败记录");
  assert.equal(navFace.getSnapshot().zoomPointerFocus, false, "复活后导航写入生效（受控镜像流转）");
  navFace.set({ zoomPointerFocus: true });
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
