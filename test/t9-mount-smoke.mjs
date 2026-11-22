/**
 * T9 挂载编排与 L 型壳冒烟（src/constellation-t9.mjs + src/client.jsx 壳 CSS，
 * stage4-cosmos-v9-lshape 1.1–1.4 / 2.x / 3.4 / 4.3）。
 *
 * 锁 design D4/D5 与 spec「V9 入口与桥能力探测」「L 型布局壳与卡片零位移」
 * 「L 型态溢出与滚动约束」的**可纯逻辑直测**部分：
 *  - 桥读取矩阵：缺席 / 非对象 / 无 embedPanel → null；旧版 → legacy；新版 → parts；
 *  - 挂载选路：parts 双容器挂载（candidates/input 分别透传、options 原样）、legacy 单容器、
 *    容器缺失 / 桥拒绝（返回 null）/ 桥抛错 → null（不产生半挂载），onError 诊断回调；
 *  - 释放链路：单句柄幂等 dispose（二次调用不再触发）、异常吞并、非法句柄安全；
 *  - 组件接线锚点：t9View 单一状态源、data-t9-mode、双容器 / 旧容器的条件渲染、单句柄释放；
 *  - L 型壳 CSS 不变量：宽度同源 / 键盘列绝对右列等高 / 移除壳 max-height + overflow visible /
 *    备选限幅 + 内部滚动 / 宽度与高度兜底断点与收缩下限**数值成对自洽**。
 *
 * 真机几何（零位移 / 同宽 / 等高 / 底对齐 / 折行 / 旧版回退）由浏览器工装验收：
 * `.dsh-v-explorer/v9-lshape-harness/verify.mjs`（任务 5.1 截图同源）。
 *
 * 运行：node test/t9-mount-smoke.mjs
 */
import { readFileSync } from "node:fs";
import {
  disposeT9Handle,
  mountT9Panel,
  readT9Bridge,
  t9EmbedModeOf
} from "../src/constellation-t9.mjs";

function assert(cond, msg) {
  if (!cond) {
    console.error("t9-mount-smoke FAIL:", msg);
    process.exit(1);
  }
}
function assertEq(a, b, msg) {
  assert(a === b, `${msg}（got ${JSON.stringify(a)}, want ${JSON.stringify(b)}）`);
}

/** 假容器（桥契约只要求「可被宿主给定」，本模块不触 DOM）。 */
const CONTAINERS = Object.freeze({
  candidates: { kind: "candidates" },
  input: { kind: "input" },
  legacy: { kind: "legacy" }
});

/** 记录型假桥：返回句柄带 dispose 计数，可注入拒绝/抛错。 */
function fakeBridge(options = {}) {
  const calls = { parts: [], legacy: [], partsDisposed: 0, legacyDisposed: 0 };
  const bridge = {
    embedPanel(container, panelOptions) {
      calls.legacy.push({ container, panelOptions });
      if (options.throwLegacy === true) throw new Error("legacy boom");
      return options.legacyHandle !== undefined ? options.legacyHandle : { dispose() { calls.legacyDisposed += 1; } };
    }
  };
  if (options.withParts === true) {
    bridge.embedPanelParts = (panelOptions) => {
      calls.parts.push(panelOptions);
      if (options.throwParts === true) throw new Error("parts boom");
      return options.partsHandle !== undefined
        ? options.partsHandle
        : { dispose() { calls.partsDisposed += 1; } };
    };
  }
  return { bridge, calls };
}

/* ── ① 桥读取矩阵（无桥不呈现：浮窗零噪音的判据） ── */
assertEq(readT9Bridge(null), null, "readT9Bridge(null) → null");
assertEq(readT9Bridge(undefined), null, "readT9Bridge(undefined) → null");
assertEq(readT9Bridge({}), null, "无 __dshVT9IME__ → null");
assertEq(readT9Bridge({ __dshVT9IME__: null }), null, "桥为 null → null");
assertEq(readT9Bridge({ __dshVT9IME__: "x" }), null, "桥非对象 → null");
assertEq(readT9Bridge({ __dshVT9IME__: {} }), null, "桥缺 embedPanel → null");
const legacyBridge = { embedPanel() {} };
assertEq(readT9Bridge({ __dshVT9IME__: legacyBridge }), legacyBridge, "旧版桥被读出");
const partsBridge = { embedPanel() {}, embedPanelParts() {} };
assertEq(readT9Bridge({ __dshVT9IME__: partsBridge }), partsBridge, "新版桥被读出");
/* 全局对象缺省（浏览器 window 同口径）：Node 无 __dshVT9IME__ → null。 */
assertEq(readT9Bridge(), null, "readT9Bridge() 缺省 scope → null");

/* ── ② 路径探测矩阵（能力探测以函数存在性为准） ── */
assertEq(t9EmbedModeOf(null), null, "无桥 → null");
assertEq(t9EmbedModeOf({}), null, "无函数 → null");
assertEq(t9EmbedModeOf({ embedPanel() {} }), "legacy", "只有 embedPanel → legacy");
assertEq(t9EmbedModeOf({ embedPanel() {}, embedPanelParts() {} }), "parts", "embedPanelParts 可用 → parts");
assertEq(t9EmbedModeOf({ embedPanelParts() {} }), null, "只有 parts 无 embedPanel → null（非 t9ime 桥）");
assertEq(t9EmbedModeOf({ embedPanel: 1 }), null, "embedPanel 非函数 → null");
/* 探测只读函数存在性，不呼叫桥（零副作用）。 */
let probed = false;
t9EmbedModeOf({ embedPanel() { probed = true; }, embedPanelParts() { probed = true; } });
assertEq(probed, false, "探测不调用桥函数");

/* ── ③ parts 双容器挂载（L 型） ── */
{
  const { bridge, calls } = fakeBridge({ withParts: true });
  const panelOptions = { sessionId: "s1", instanceId: "cosmos-float", adapter: {}, onClose() {} };
  const handle = mountT9Panel({
    bridge,
    mode: "parts",
    containers: CONTAINERS,
    panelOptions
  });
  assert(handle !== null && typeof handle.dispose === "function", "parts 挂载返回句柄");
  assertEq(calls.parts.length, 1, "parts 挂载调用一次 embedPanelParts");
  assertEq(calls.legacy.length, 0, "parts 路径不触达 embedPanel（互不渗透）");
  const passed = calls.parts[0];
  assertEq(passed.candidates, CONTAINERS.candidates, "备选容器原样透传");
  assertEq(passed.input, CONTAINERS.input, "输入容器原样透传");
  assertEq(passed.sessionId, "s1", "sessionId 透传");
  assertEq(passed.instanceId, "cosmos-float", "instanceId 透传");
  assertEq(passed.adapter, panelOptions.adapter, "adapter 原样透传（单一草稿源）");
  assertEq(passed.onClose, panelOptions.onClose, "onClose 透传");
  assertEq(disposeT9Handle(handle), true, "首释放成功");
  assertEq(calls.partsDisposed, 1, "句柄 dispose 被调用一次");
}

/* ── ④ legacy 单容器挂载（旧版回退，现状零变化） ── */
{
  const { bridge, calls } = fakeBridge();
  const panelOptions = { sessionId: "s2" };
  const handle = mountT9Panel({ bridge, mode: "legacy", containers: CONTAINERS, panelOptions });
  assert(handle !== null, "legacy 挂载返回句柄");
  assertEq(calls.legacy.length, 1, "legacy 调用一次 embedPanel");
  assertEq(calls.legacy[0].container, CONTAINERS.legacy, "单容器原样透传");
  assertEq(calls.legacy[0].panelOptions, panelOptions, "options 原样透传");
  assertEq(calls.parts.length, 0, "legacy 路径不触达 embedPanelParts");
  assertEq(disposeT9Handle(handle), true, "legacy 句柄释放成功");
  assertEq(calls.legacyDisposed, 1, "legacy 句柄 dispose 被调用一次");
}

/* ── ⑤ 挂载失败矩阵：容器缺失 / 桥拒绝 / 抛错 → null（不产生半挂载） ── */
{
  const { bridge, calls } = fakeBridge({ withParts: true });
  assertEq(mountT9Panel({ bridge, mode: "parts", containers: { candidates: CONTAINERS.candidates } }), null,
    "缺输入容器 → null");
  assertEq(mountT9Panel({ bridge, mode: "parts", containers: { input: CONTAINERS.input } }), null,
    "缺备选容器 → null");
  assertEq(mountT9Panel({ bridge, mode: "legacy", containers: {} }), null, "legacy 缺容器 → null");
  assertEq(calls.parts.length, 0, "容器缺失不调桥");
  assertEq(calls.legacy.length, 0, "容器缺失不调桥（legacy）");

  const legacyOnly = fakeBridge().bridge;
  assertEq(mountT9Panel({ bridge: legacyOnly, mode: "parts", containers: CONTAINERS }), null,
    "旧版桥 + parts 路径 → null（降级由探测保证，不误调）");

  const rejecting = { embedPanel: () => null, embedPanelParts: () => null };
  assertEq(mountT9Panel({ bridge: rejecting, mode: "parts", containers: CONTAINERS }), null, "桥返回 null → null");
  assertEq(mountT9Panel({ bridge: rejecting, mode: "legacy", containers: CONTAINERS }), null, "桥返回 null → null（legacy）");

  const errors = [];
  const throwing = fakeBridge({ withParts: true, throwParts: true });
  assertEq(mountT9Panel({
    bridge: throwing.bridge,
    mode: "parts",
    containers: CONTAINERS,
    onError: (error) => errors.push(error)
  }), null, "桥抛错 → null");
  assertEq(errors.length, 1, "桥抛错 → onError 收到一次");
  assert(String(errors[0]?.message).includes("parts boom"), "onError 收到原始异常");

  /* 诊断回调自身抛错必须吞并（不把宿主浮窗带崩）。 */
  assertEq(mountT9Panel({
    bridge: throwing.bridge,
    mode: "parts",
    containers: CONTAINERS,
    onError: () => { throw new Error("onError boom"); }
  }), null, "onError 自身抛错仍返回 null");

  /* 未知/缺失 mode → null（宿主未锁定路径时不猜）。 */
  assertEq(mountT9Panel({ bridge: fakeBridge({ withParts: true }).bridge, mode: null, containers: CONTAINERS }), null,
    "mode 缺失 → null");
}

/* ── ⑥ 释放链路：幂等 / 异常吞并 / 非法句柄 ── */
{
  let disposed = 0;
  const handle = { dispose() { disposed += 1; } };
  assertEq(disposeT9Handle(handle), true, "首释放 true");
  assertEq(disposeT9Handle(handle), false, "重复释放 false（幂等）");
  assertEq(disposed, 1, "dispose 只被调用一次");

  assertEq(disposeT9Handle({ dispose() { throw new Error("dispose boom"); } }), false, "dispose 抛错 → false");
  assertEq(disposeT9Handle(null), false, "null 句柄安全");
  assertEq(disposeT9Handle(undefined), false, "undefined 句柄安全");
  assertEq(disposeT9Handle({}), false, "无 dispose 句柄安全");
  assertEq(disposeT9Handle("handle"), false, "非对象句柄安全");

  /* 桥返回的 null/undefined 不会被当作句柄。 */
  assertEq(disposeT9Handle(mountT9Panel({
    bridge: { embedPanel: () => undefined },
    mode: "legacy",
    containers: CONTAINERS
  })), false, "桥返回 undefined → 无句柄可释放");
}

/* ── ⑦ 组件接线锚点（client.jsx：单一状态源 + 双容器条件渲染 + 单句柄释放） ── */
const source = readFileSync(new URL("../src/client.jsx", import.meta.url), "utf8");
assert(source.includes('from "./constellation-t9.mjs"'), "client 引用 T9 编排模块");
assert(source.includes("const handle = mountT9Panel({"), "挂载经 mountT9Panel 编排");
assert(source.includes("if (handle === null) {"), "挂载失败 → 收起 V9（无空壳）");
assert(source.includes("disposeT9Handle(handle);"), "effect cleanup 经单句柄释放");
assert(!source.includes("bridge.embedPanelParts"), "client 不直接调用 embedPanelParts（逻辑收敛）");
assert(!source.includes("bridge.embedPanel("), "client 不直接调用 embedPanel（逻辑收敛）");
assert(source.includes('data-t9-mode={t9View === null ? undefined : t9View.mode}'), "壳输出 data-t9-mode（路径锁定可见）");
assert(source.includes('aria-pressed={t9View !== null}'), "V9 钮 aria-pressed 随单一状态源");
assert(source.includes("onClick={toggleT9}"), "V9 钮经 toggleT9（打开瞬间锁定路径）");
assert(source.includes("const closeT9 = () => setT9View(null);"), "onClose / 关闭收敛于 closeT9");
assert(source.includes('className="dsh-cosmos-const-float-t9-candidates"'), "备选容器渲染");
assert(source.includes('className="dsh-cosmos-const-float-t9-input"'), "输入容器渲染");
assert(source.includes('className="dsh-cosmos-const-float-t9"'), "旧版单容器渲染（并排回退）");
assert(source.includes('ref={t9CandidatesRef}') && source.includes('ref={t9InputRef}') && source.includes('ref={t9ContainerRef}'),
  "三块容器各自持 ref（路径互不渗透）");

/* ── ⑧ L 型壳 CSS 不变量 ── */
const ruleOf = (selector) => {
  const at = source.indexOf(selector + "{");
  assert(at >= 0, `CSS 缺少规则：${selector}`);
  const end = source.indexOf("}", at);
  return source.slice(at, end + 1);
};
const shellBase = ruleOf(".dsh-cosmos-const-float-shell");
assert(shellBase.includes("--cos-float-w:min(560px,100%)"), "宽度同源变量 --cos-float-w");
assert(shellBase.includes("--cos-t9-cand-h:calc(var(--t9-cand-strip-h,44px) + 12px)"),
  "备选高度 = 候选条高令牌引用（t9ime stage6 钩子 + parts 本体上下内边距）");
assert(!/clamp\(\s*120px/.test(shellBase), "备选区不再使用视口相关限幅（旧限幅退役）");
/* 钩子缺席（t9ime 未升级 / 旧版多行网格）惰性兜底：44px + 12px = 56px 恒高，不随视口变化。 */
const candHFallback = (() => {
  const match = shellBase.match(/--cos-t9-cand-h:calc\(var\(--t9-cand-strip-h,(\d+)px\) \+ (\d+)px\)/);
  assert(match !== null, "备选高度公式 = calc(条高钩子 + 内边距)");
  return Number(match[1]) + Number(match[2]);
})();
assertEq(candHFallback, 56, "钩子缺席兜底 = 44px + 12px = 56px（恒高，不随视口）");
assert(!/clamp\(\s*120px/.test(source), "全文件无旧视口限幅口径残留（120px 下限已退役）");

const partsRule = ruleOf(".dsh-cosmos-const-float-shell[data-t9-mode=parts]");
assert(partsRule.includes("width:var(--cos-float-w)"), "L 型壳宽锚定卡片（同源变量）");
assert(partsRule.includes("max-height:none"), "L 型态移除壳自身 max-height");
assert(!partsRule.includes("max-height:calc"), "L 型态 MUST NOT 保留受限 max-height");
assert(partsRule.includes("overflow:visible"), "L 型态 overflow 可见（键盘列溢出不被裁剪）");
assert(partsRule.includes("margin-bottom:calc(-1 * (12px + var(--cos-t9-cand-h)))"),
  "垂直锚定：负 margin 抵消备选区增量（开合零位移）");
assert(ruleOf(".dsh-cosmos-const-float-shell[data-t9-mode=parts] .dsh-cosmos-const-float-card")
  .includes("width:var(--cos-float-w)"), "L 型卡片宽 = 同源变量");

const candRule = ruleOf(".dsh-cosmos-const-float-t9-candidates");
assert(candRule.includes("width:100%"), "备选容器宽 = 壳宽（= 卡片宽）");
assert(candRule.includes("height:var(--cos-t9-cand-h)"), "备选容器高度走恒高令牌（缺省 56px）");
assert(candRule.includes("overflow-y:auto"), "overflow-y 保留为版本错配防御性兜底（恒高条下不触发）");
assert(source.includes("降级为版本错配防御性兜底"), "备选容器注释记录兜底语义（旧版多行网格承接为容器内滚动）");

const inputRule = ruleOf(".dsh-cosmos-const-float-t9-input");
assert(inputRule.includes("position:absolute"), "键盘列绝对定位");
assert(inputRule.includes("left:calc(100% + 12px)"), "键盘列贴卡片右缘 + 12px");
assert(inputRule.includes("top:0"), "键盘列顶边 = 卡片顶边");
assert(inputRule.includes("height:auto") && inputRule.includes("min-height:100%"),
  "键盘列高 = max(壳内容高, 键盘自然高)（键帽放大时向下生长，不裁切）");
assert(inputRule.includes("min-width:max-content"), "键盘列宽不小于键区自然宽（键区不裁切）");
assert(inputRule.includes("width:clamp(256px,calc(50vw - 316px),max(var(--t9-input-w,320px),calc(5 * var(--t9-key-h,44px) + 36px)))"),
  "键盘列定宽基线保持 + 跟随 t9ime 键帽边长（5 列键区）+ 中段视口自适应收缩（宿主可覆写 --t9-input-w）");
assert(partsRule.includes("transform:translateX(min(0px,calc((50vw - 316px) - (5 * var(--t9-key-h,44px) + 36px))))"),
  "键盘放不下时 L 型整体左移补齐（键盘完整优先于卡片居中）");

/* 断点与收缩下限成对自洽（数值强耦合，tasks 2.4 ↔ 2.5）：
   宽度断点 1144px ⟹ 50vw - 316px = 256px（5 × 44px 键列 + gap + 内边距 + 余量）；
   高度断点 = 垂直居中折行阈值（零余量口径）：卡片上限 448 + 2 × (间距 12 + 恒高备选 56)
   + 外层 padding 48 = 632px（备选高每减 1px 阈值降 2px；旧限幅 120px 时即 760px；
   纯加和 448 + 12 + 56 + 48 = 564 会低估阈值，禁用）。 */
const widthFold = source.match(/@media \(max-width:(\d+)px\),\(max-height:(\d+)px\)\{/);
assert(widthFold !== null, "两维度同构兜底断点存在");
const foldW = Number(widthFold[1]);
const foldH = Number(widthFold[2]);
assertEq(foldW / 2 - 316, 256, "宽度断点与收缩下限成对（1144/2 - 316 = 256）");
assertEq((foldH - 448 - 48) / 2 - 12, candHFallback, "高度断点按居中公式与恒高备选成对（(632-448-48)/2 - 12 = 56）");
assertEq(foldH, 632, "高度兜底断点 = 632px（零余量居中口径）");
const foldRule = ruleOf("@media (max-width:" + foldW + "px),(max-height:" + foldH + "px)");
assert(source.includes(".dsh-cosmos-const-float-t9-input{position:static"), "兜底折行：输入列回归文档流");
assert(source.includes(".dsh-cosmos-const-float-t9-candidates{height:auto;max-height:none}"),
  "兜底折行：备选容器高度回归自适应（height:auto）");
assert(foldRule.includes("margin-bottom:0"), "兜底折行：取消垂直锚定负 margin");
assert(foldRule.includes("transform:none"), "兜底折行：取消 L 型整体左移");
assert(source.includes("width:100%;min-width:0;height:auto;min-height:0;flex:0 0 auto"),
  "兜底折行：输入列占满卡片宽、宽高回归文档流（重置 min-width / min-height）");

/* 旧版并排（legacy）既有口径保留：窄屏 ≤980px 折行。 */
const legacyFoldAt = source.indexOf("@media (max-width:980px){");
assert(legacyFoldAt >= 0, "旧版并排窄屏断点保留");
assert(source.slice(legacyFoldAt, legacyFoldAt + 400).includes("[data-t9-mode=legacy]"), "旧版窄屏折行仅作用于 legacy 路径");
assert(ruleOf(".dsh-cosmos-const-float-t9").includes("max-width:360px"), "旧版单容器宽 360px（现状）");

console.log("t9-mount-smoke: all assertions passed");
