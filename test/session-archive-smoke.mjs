/**
 * 会话卡归档纯逻辑冒烟（add-cosmos-session-archive-action 1.4）：
 *  - outcome 枚举与合法性判定（五路 + 非法值兜底）；
 *  - outcome → 呈现文案映射（archived / already-archived 中性 / missing 中性 /
 *    failed + 宿主消息 / skipped + activity 摘要；单会话「恰好对应一个 outcome」）；
 *  - activity 摘要纯函数（族必现、多族、无条目族、单条目名截断边界、未知族兜底）；
 *  - 请求级失败文案（网络错误 / 非 2xx / 端点不可达重试提示）。
 *
 * 另含引擎点击分流行为直测（2.1/2.2/3.2 的可执行面）：双按钮 data-action 分流、
 * 旧渲染兼容回落、per-session in-flight 防重入、按钮禁用态经直接 DOM 切换。
 * 运行：node test/session-archive-smoke.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ACTIVITY_FAMILY_LABELS,
  ACTIVITY_ITEM_LABEL_MAX_CHARS,
  ARCHIVE_NOTICE_TONES,
  SESSION_ARCHIVE_OUTCOMES,
  UNKNOWN_ACTIVITY_FAMILY,
  activityFamilyLabelOf,
  activityItemLabelOf,
  activitySummaryOf,
  archiveNoticeOf,
  archiveRequestFailureNotice,
  isSessionArchiveOutcome
} from "../src/session-archive.mjs";

/* ── 1. outcome 枚举与合法性判定（1.1） ── */
{
  assert.deepEqual(
    [...SESSION_ARCHIVE_OUTCOMES],
    ["archived", "skipped", "already-archived", "missing", "failed"],
    "五路 outcome 全集（顺序与宿主端点一致）"
  );
  for (const outcome of SESSION_ARCHIVE_OUTCOMES) {
    assert.equal(isSessionArchiveOutcome(outcome), true, "合法 outcome：" + outcome);
  }
  for (const bad of [null, undefined, "", "ARCHIVED", "archived ", " archived", 42, {}, [], true, "unknown"]) {
    assert.equal(isSessionArchiveOutcome(bad), false, "非法 outcome 拒绝：" + String(bad));
  }
  assert.equal(new Set(SESSION_ARCHIVE_OUTCOMES).size, SESSION_ARCHIVE_OUTCOMES.length, "outcome 无重复");
  assert.deepEqual([...ARCHIVE_NOTICE_TONES], ["ok", "neutral", "warn", "error"], "呈现基调全集");
}

/* ── 2. outcome → 呈现文案（1.2） ── */
{
  /* archived：已归档确认（ok） */
  const archived = archiveNoticeOf({ sessionId: "s1", outcome: "archived" });
  assert.equal(archived.outcome, "archived");
  assert.equal(archived.tone, "ok");
  assert.equal(archived.text, "会话已归档");
  assert.ok(!archived.text.includes("失败"), "archived 不含失败措辞");

  /* already-archived：中性的已归档确认（MUST NOT 呈现为失败） */
  const already = archiveNoticeOf({ sessionId: "s1", outcome: "already-archived" });
  assert.equal(already.tone, "neutral", "already-archived 为中性基调");
  assert.notEqual(already.tone, "error", "already-archived 不当失败呈现");
  assert.ok(already.text.includes("已归档"), "already-archived 呈现已归档语义");
  assert.ok(!already.text.includes("失败"), "already-archived 不含失败措辞");

  /* missing：会话已不存在 → 中性说明（等效于无会话可归档） */
  const missing = archiveNoticeOf({ sessionId: "gone", outcome: "missing" });
  assert.equal(missing.tone, "neutral", "missing 为中性基调");
  assert.ok(missing.text.includes("不存在"), "missing 说明会话已不存在");
  assert.ok(!missing.text.includes("失败"), "missing 不含失败措辞");

  /* failed：失败 + 宿主错误消息（error） */
  const failed = archiveNoticeOf({ sessionId: "s1", outcome: "failed", error: "disk full" });
  assert.equal(failed.tone, "error");
  assert.equal(failed.text, "归档失败：disk full", "failed 透传宿主错误消息");
  const failedNoReason = archiveNoticeOf({ sessionId: "s1", outcome: "failed" });
  assert.equal(failedNoReason.text, "归档失败：未知错误", "failed 无消息 → 兜底原因");
  const failedBlank = archiveNoticeOf({ sessionId: "s1", outcome: "failed", error: "   " });
  assert.equal(failedBlank.text, "归档失败：未知错误", "failed 空白消息 → 兜底原因");

  /* skipped：未归档说明 + activity 摘要（spec 场景：turn + subagent ×2） */
  const skipped = archiveNoticeOf({
    sessionId: "s1",
    outcome: "skipped",
    activity: [
      { family: "turn" },
      { family: "subagent", items: [{ id: "a", label: "审查" }, { id: "b", label: "执行" }] }
    ]
  });
  assert.equal(skipped.tone, "warn", "skipped 为提示基调（非失败）");
  assert.equal(skipped.text, "会话仍在运行，未归档：运行回合；子代理 ×2", "spec 场景文案");
  assert.ok(skipped.text.includes("仍在运行"), "skipped 说明仍在运行");
  assert.notEqual(skipped.tone, "error", "skipped 不当失败呈现");

  /* skipped 无 activity 明细 → 不加明细段 */
  const skippedEmpty = archiveNoticeOf({ sessionId: "s1", outcome: "skipped", activity: [] });
  assert.equal(skippedEmpty.text, "会话仍在运行，未归档", "无明细不加冒号段");
  const skippedNonArray = archiveNoticeOf({ sessionId: "s1", outcome: "skipped", activity: "turn" });
  assert.equal(skippedNonArray.text, "会话仍在运行，未归档", "非数组 activity 不加明细段");

  /* 未知 / 缺失 outcome：防御性兜底（error），不抛错 */
  const weird = archiveNoticeOf({ sessionId: "s1", outcome: "quantum" });
  assert.equal(weird.tone, "error");
  assert.equal(weird.text, "归档结果未知：quantum");
  const empty = archiveNoticeOf(null);
  assert.equal(empty.tone, "error");
  assert.equal(empty.text, "归档结果未知");
  assert.equal(archiveNoticeOf({}).text, "归档结果未知", "无 outcome 键 → 结果未知");
  assert.equal(archiveNoticeOf({ outcome: 42 }).text, "归档结果未知", "非字符串 outcome → 结果未知");

  /* 单会话不变式：一个 outcome 只产生一路措辞（不混入其他会话的结果） */
  for (const outcome of SESSION_ARCHIVE_OUTCOMES) {
    const notice = archiveNoticeOf({
      sessionId: "only",
      outcome,
      activity: [{ family: "job", items: [{ id: "j", label: "构建" }] }],
      error: "boom"
    });
    assert.ok(ARCHIVE_NOTICE_TONES.includes(notice.tone), "基调落在全集内：" + outcome);
    assert.equal(typeof notice.text, "string");
    assert.ok(notice.text.length > 0, "文案非空：" + outcome);
    assert.equal(notice.outcome, outcome, "outcome 回填原始值：" + outcome);
  }
  /* 中性两路不得被文案映射成失败基调（spec 显式要求） */
  for (const neutral of ["already-archived", "missing"]) {
    assert.equal(archiveNoticeOf({ outcome: neutral }).tone, "neutral", neutral + " 恒中性");
  }
}

/* ── 3. activity 摘要（1.3） ── */
{
  assert.equal(activitySummaryOf([]), "", "空数组 → 空串（调用方不加明细段）");
  assert.equal(activitySummaryOf(null), "", "非数组 → 空串");
  assert.equal(activitySummaryOf(undefined), "", "缺失 → 空串");
  assert.equal(activitySummaryOf("turn"), "", "字符串 → 空串");

  /* 族必现透传 + 多族顺序 */
  assert.equal(activitySummaryOf([{ family: "turn" }]), "运行回合", "无条目族 → 族名领域词汇");
  assert.equal(
    activitySummaryOf([
      { family: "turn" },
      { family: "subagent", items: [{ id: "a" }, { id: "b" }] },
      { family: "job", items: [{ id: "j" }] },
      { family: "schedule" }
    ]),
    "运行回合；子代理 ×2；后台任务 ×1；定时任务",
    "多族按宿主回报顺序列出（条目数聚合 + 单条目无 label → ×1）"
  );
  assert.equal(
    activitySummaryOf([{ family: "turn" }, { family: "subagent-items", items: [{ id: "a" }, { id: "b" }] }]),
    "运行回合；subagent-items ×2",
    "族名必现：未登记族原样透传（不吞信息）"
  );

  /* 单条目族带 label → 族名（条目名） */
  assert.equal(
    activitySummaryOf([{ family: "job", items: [{ id: "j", label: "构建" }] }]),
    "后台任务（构建）",
    "单条目族呈现条目名"
  );
  assert.equal(
    activitySummaryOf([{ family: "job", items: [{ id: "j", label: "   " }] }]),
    "后台任务 ×1",
    "空白 label → 回退条目数"
  );
  assert.equal(
    activitySummaryOf([{ family: "job", items: [{ id: "j" }] }]),
    "后台任务 ×1",
    "无 label → 回退条目数（不回显 id）"
  );

  /* 条目名截断预算（字符数口径，含省略号） */
  const budget = ACTIVITY_ITEM_LABEL_MAX_CHARS;
  const exact = "字".repeat(budget);
  const over = "字".repeat(budget + 1);
  assert.equal(activityItemLabelOf({ label: exact }), exact, "恰好等于预算 → 不截断");
  const truncated = activityItemLabelOf({ label: over });
  assert.equal(Array.from(truncated).length, budget, "超预算 → 截断到预算字符数");
  assert.ok(truncated.endsWith("…"), "截断以省略号收尾");
  assert.equal(Array.from(truncated).slice(0, -1).join(""), "字".repeat(budget - 1), "保留前 budget-1 字符");
  assert.ok(
    activitySummaryOf([{ family: "job", items: [{ id: "j", label: over }] }]).includes(truncated),
    "摘要内嵌截断后的条目名"
  );
  /* 代理对不劈开（emoji 按码点计 1 字符） */
  const emojiLabel = "🚀".repeat(budget + 2);
  const emojiOut = activityItemLabelOf({ label: emojiLabel });
  assert.equal(Array.from(emojiOut).length, budget, "代理对按码点计数（不劈开）");
  assert.ok(!/[\uD800-\uDBFF]$/.test(emojiOut.replace("…", "")), "截断不留下孤立高位代理");

  /* 族名 / 条目名辅助函数 */
  for (const known of Object.keys(ACTIVITY_FAMILY_LABELS)) {
    assert.equal(activityFamilyLabelOf(known), ACTIVITY_FAMILY_LABELS[known], "登记族走领域词汇：" + known);
  }
  assert.equal(activityFamilyLabelOf("unknown"), UNKNOWN_ACTIVITY_FAMILY, "宿主兜底族保持 unknown");
  for (const bad of [null, undefined, "", "  ", 42, {}, []]) {
    assert.equal(activityFamilyLabelOf(bad), UNKNOWN_ACTIVITY_FAMILY, "缺失族名兜底 unknown：" + String(bad));
  }
  assert.equal(activityItemLabelOf(null), "", "无条目 → 空标签");
  assert.equal(activityItemLabelOf({ label: 42 }), "", "非字符串 label → 空标签");

  /* 兼容宿主原始形状（{kind, items}）与空 activity 条目 */
  assert.equal(
    activitySummaryOf([{ kind: "turn" }, { kind: "subagent", items: [{ id: "a" }, { id: "b" }] }, {}]),
    "运行回合；子代理 ×2；unknown",
    "原始 kind 形状兼容 + 空条目族兜底 unknown（族必现）"
  );
}

/* ── 4. 请求级失败文案（3.1 失败分支的纯逻辑面） ── */
{
  const network = archiveRequestFailureNotice(new Error("Failed to fetch"));
  assert.equal(network.outcome, "failed");
  assert.equal(network.tone, "error");
  assert.ok(network.text.startsWith("归档请求失败："), "请求失败前缀");
  assert.ok(network.text.includes("Failed to fetch"), "透传网络错误消息");

  const status = archiveRequestFailureNotice("500 Internal Server Error");
  assert.equal(status.text, "归档请求失败：500 Internal Server Error", "透传非 2xx 状态行");

  const bare = archiveRequestFailureNotice(null);
  assert.equal(bare.tone, "error");
  assert.ok(bare.text.includes("重试"), "无消息 → 不可达 + 可重试提示");
  assert.equal(archiveRequestFailureNotice("  ").text, bare.text, "空白消息与无消息同文案");
}

/* ── 5. 引擎点击分流与防重入（2.1/2.2/3.2 的可执行面） ──
   Node 侧以最小 DOM 桩驱动引擎：信息卡 click 监听器按 data-action 分流、旧渲染
   （无 data-action）回落 open、per-session in-flight 集合忽略重复点击、按钮禁用态
   经直接 DOM 切换（不经 cardHtml 重渲染）。 */
function stubCtx2d() {
  const grad = { addColorStop() {} };
  const store = {};
  return new Proxy(store, {
    get(target, prop) {
      if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => grad;
      if (prop === "measureText") return () => ({ width: 10 });
      if (!(prop in target)) target[prop] = () => undefined;
      return target[prop];
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    }
  });
}

function makeElement(tag) {
  const listeners = {};
  const classes = new Set();
  const el = {
    tag,
    style: {},
    dataset: {},
    className: "",
    textContent: "",
    innerHTML: "",
    width: 0,
    height: 0,
    disabled: false,
    children: [],
    listeners,
    attrs: {},
    _by: {},
    classList: {
      add(name) {
        classes.add(name);
      },
      remove(name) {
        classes.delete(name);
      },
      contains(name) {
        return classes.has(name);
      },
      toggle(name, on) {
        if (on === undefined ? !classes.has(name) : on) classes.add(name);
        else classes.delete(name);
      }
    },
    appendChild(child) {
      el.children.push(child);
      return child;
    },
    remove() {},
    querySelector(sel) {
      if (!el._by[sel]) {
        const child = makeElement(sel === ".cos-canvas" ? "canvas" : "div");
        if (child.tag === "canvas") child.getContext = () => stubCtx2d();
        el._by[sel] = child;
      }
      return el._by[sel];
    },
    querySelectorAll: () => [],
    addEventListener(type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    removeEventListener() {},
    setAttribute(k, v) {
      el.attrs[k] = v;
    },
    getAttribute(k) {
      return k in el.attrs ? el.attrs[k] : null;
    },
    setPointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 })
  };
  return el;
}

globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
globalThis.document = {
  createElement: (tag) => {
    const el = makeElement(tag);
    if (tag === "canvas") el.getContext = () => stubCtx2d();
    return el;
  },
  addEventListener() {},
  removeEventListener() {},
  hidden: false,
  activeElement: null,
  head: { appendChild() {} }
};
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};
if (typeof globalThis.performance === "undefined") globalThis.performance = { now: () => Date.now() };

const { createCosmosEngine, ENGINE_CSS } = await import("../src/cosmos/engine.mjs");
const { createSkinD } = await import("../src/cosmos/skin-d.mjs");

/** 信息卡按钮事件桩（click 监听器按 target 分流，故 target 必须带 classList/getAttribute）。 */
function buttonTarget(action, sessionId) {
  return {
    disabled: false,
    classList: { contains: (cls) => cls === "cd-btn" },
    getAttribute: (key) => (key === "data-action" ? action : key === "data-session" ? sessionId : null)
  };
}

{
  const container = makeElement("div");
  const calls = [];
  const pending = [];
  const engine = createCosmosEngine({
    container,
    style: createSkinD(),
    onOpenSession: (id) => calls.push(["open", id]),
    onArchiveSession: (id) => {
      calls.push(["archive", id]);
      return new Promise((resolve) => pending.push(resolve));
    }
  });
  const rootEl = container.children[0];
  const cardEl = rootEl._by[".cos-card"];
  const fireClick = (ev) => {
    for (const fn of cardEl.listeners.click ?? []) fn(ev);
  };
  const archiveCalls = () => calls.filter((entry) => entry[0] === "archive").length;
  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };
  const archiveBtn = () => cardEl._by['.cd-btn[data-action="archive"]'];

  /* 双按钮分流（2.1/2.2）：open → onOpenSession，archive → onArchiveSession */
  fireClick({ target: buttonTarget("open", "sess-1") });
  assert.deepEqual(calls.at(-1), ["open", "sess-1"], "data-action=open → 既有打开会话回调（行为零变化）");
  fireClick({ target: buttonTarget("archive", "sess-2") });
  assert.deepEqual(calls.at(-1), ["archive", "sess-2"], "data-action=archive → 归档回调");
  assert.equal(archiveCalls(), 1, "首次点击派发一个归档请求");

  /* 防重入（3.2）：请求在途期间重复点击被忽略（权威门 = per-session in-flight 集合） */
  fireClick({ target: buttonTarget("archive", "sess-2") });
  fireClick({ target: buttonTarget("archive", "sess-2") });
  assert.equal(archiveCalls(), 1, "在途重复点击不派发第二个请求");
  /* 直接抹掉按钮 disabled（模拟卡片在途重渲染抹属性）→ 权威门仍生效 */
  archiveBtn().disabled = false;
  fireClick({ target: buttonTarget("archive", "sess-2") });
  assert.equal(archiveCalls(), 1, "disabled 属性被抹后权威门仍忽略重复点击");
  /* 不同会话互不阻塞（per-session 门，非全局单飞） */
  fireClick({ target: buttonTarget("archive", "sess-3") });
  assert.equal(archiveCalls(), 2, "不同会话可并行归档");

  /* 禁用态经直接 DOM 切换（D6）：处理器按 data-action 精确定位卡片内归档按钮 */
  assert.ok(archiveBtn(), "归档按钮经选择器直接定位（非 cardHtml 重渲染）");
  assert.equal(archiveBtn().disabled, true, "归档按钮在途禁用");

  /* 响应到达（无论 outcome）→ 恢复可点 */
  pending[0]();
  await flush();
  assert.equal(archiveBtn().disabled, false, "响应到达后恢复可点");
  fireClick({ target: buttonTarget("archive", "sess-2") });
  assert.equal(archiveCalls(), 3, "恢复后可再次归档（重试路径）");
  pending[1]();
  pending[2]();
  await flush();
  assert.equal(archiveCalls(), 3, "全部响应后无多余请求");

  /* 回调抛错同样解锁（不让一次失败永久卡住按钮） */
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const throwingContainer = makeElement("div");
    const throwing = createCosmosEngine({
      container: throwingContainer,
      style: createSkinD(),
      onArchiveSession: () => {
        throw new Error("boom");
      }
    });
    const throwingCard = throwingContainer.children[0]._by[".cos-card"];
    for (const fn of throwingCard.listeners.click ?? []) fn({ target: buttonTarget("archive", "sess-x") });
    assert.equal(throwingCard._by['.cd-btn[data-action="archive"]'].disabled, false, "回调抛错 → 解锁（不永久禁用）");
    throwing.dispose();
  } finally {
    console.warn = originalWarn;
  }

  /* 旧渲染兼容（2.2）：data-action 缺席 → 回落 open，行为零变化 */
  fireClick({ target: buttonTarget(null, "sess-legacy") });
  assert.deepEqual(calls.at(-1), ["open", "sess-legacy"], "data-action 缺席 → 回落打开会话（旧渲染兼容）");
  /* 无 data-session / 非按钮 target → 不派发（既有守卫保持） */
  const before = calls.length;
  fireClick({ target: buttonTarget("archive", null) });
  fireClick({ target: { classList: { contains: () => false }, getAttribute: () => "sess-x" } });
  assert.equal(calls.length, before, "非按钮 target 或缺 sessionId → 不派发");
  engine.dispose();
}

/* ── 5b. 归档成功后的收卡承接（2.3 / design D7：不新增逻辑，验证既有守卫） ──
   归档 → 宿主镜像更新 → 场景补丁移除天体；被 hover/选中实体消失时信息卡必须收场。
   本段以真实帧循环驱动：hover 命中天体（卡片呈现）→ 下一场景移除该实体 → 卡片收起。 */
{
  /** 最小场景夹具：1 恒星 + 1 行星（无彗星，拾取面只留两类天体）。 */
  const sceneWith = (withPlanet) => ({
    workspaces: [{
      id: "ws1",
      name: "ws-one",
      pos: [0, 0, 0],
      stars: [{ id: "add-a", name: "add-a", lifecycle: "executed", setBy: null, at: null, tasks: [1, 1], age: "刚刚", act: 0, off: [10, 0, 0] }],
      links: [],
      planets: withPlanet
        ? [{ id: "p1", title: "planet", state: "idle", pendingKind: null, stars: ["add-a"], todos: "—", when: "刚刚", satellites: [], satelliteCount: 0, delegatedBusy: false }]
        : [],
      comets: [],
      archives: 0,
      satelliteCount: 0
    }]
  });

  const rafQueue = [];
  globalThis.requestAnimationFrame = (cb) => {
    rafQueue.push(cb);
    return rafQueue.length;
  };
  globalThis.cancelAnimationFrame = () => {};

  const container = makeElement("div");
  const engine = createCosmosEngine({ container, style: createSkinD() });
  const rootEl = container.children[0];
  const canvasEl = rootEl._by[".cos-canvas"];
  const cardEl = rootEl._by[".cos-card"];
  engine.setScene(sceneWith(true), "rebuild");
  rafQueue.length = 0;
  engine.start();
  let clock = 60000;
  const step = (n = 1) => {
    for (let i = 0; i < n; i += 1) {
      clock += 50;
      const cb = rafQueue.shift();
      assert.ok(cb, "帧回调在队");
      cb(clock);
    }
  };
  step(27); // 过冷启动序曲（1.2s）

  cardEl.dataset.sig = "";
  let hit = null;
  for (let gx = 368; gx <= 432 && !hit; gx += 4) {
    for (let gy = 268; gy <= 332 && !hit; gy += 4) {
      for (const fn of rootEl.listeners.pointermove ?? []) {
        fn({ pointerId: 9, clientX: gx, clientY: gy, buttons: 0, target: canvasEl });
      }
      step(1);
      if (cardEl.dataset.sig) hit = { x: gx, y: gy, sig: cardEl.dataset.sig };
    }
  }
  assert.ok(hit, "找到可拾取天体的屏幕点（拾取面自检）");
  const [kind, entityId] = String(hit.sig).split("|")[0].split(":");
  assert.ok(["planet", "comet", "star"].includes(kind), "命中天体类型：" + kind);
  assert.equal(cardEl.classList.contains("on"), true, "hover 命中 → 信息卡呈现");

  /* 归档成功的场景投影：被 hover 的实体从场景消失（恒星消亡时连同其行星） */
  const next = sceneWith(true);
  const ws = next.workspaces[0];
  if (kind === "planet") ws.planets = ws.planets.filter((p) => p.id !== entityId);
  else if (kind === "comet") ws.comets = ws.comets.filter((c) => c.id !== entityId);
  else {
    ws.stars = ws.stars.filter((s) => s.id !== entityId);
    ws.planets = [];
  }
  engine.setScene(next, "rebuild");
  step(1);
  assert.equal(cardEl.classList.contains("on"), false, "被 hover 的实体被场景移除 → 信息卡收卡（既有守卫承接）");

  /* 选中路径同源：remapFocusRefs 把选中引用重解析为 null，updateOverlay 的 !scr2 早退
     隐藏卡片——静态锚点固化该守卫仍在（回归时不至静默丢失）。add-cosmos-selection-linkage
     1.1 把写入收口为 setSelection（赋值 + 幂等通知），此处断言锚点随收口更新，语义不变。 */
  const engineSource = readFileSync(new URL("../src/cosmos/engine.mjs", import.meta.url), "utf8");
  const remap = engineSource.slice(
    engineSource.indexOf("function remapFocusRefs()"),
    engineSource.indexOf("function pruneGhostMaps()")
  );
  assert.ok(remap.includes("setSelection(data ? { kind: E.selected.kind, ws: ws, data: data } : null);"), "选中实体消失 → 选中引用置空（既有守卫，经 setSelection 收口）");
  assert.ok(remap.includes("if (!ws) { setSelection(null); return; }"), "所属星座消失 → 选中引用置空（既有守卫，经 setSelection 收口）");
  assert.ok(engineSource.includes("if (!scr2) { E.el.card.classList.remove('on'); return; }"), "投影缺失 → 信息卡早退隐藏（既有守卫）");
  engine.stop();
  engine.dispose();
}

/* ── 6. CSS 钩子：双按钮排布 + 触屏目标（2.1 / spec 呈现要求） ── */
{
  const btnRule = ENGINE_CSS.match(/\.cd-btn \{[^}]*\}/);
  assert.ok(btnRule, ".cd-btn 规则存在");
  const minHeight = Number((btnRule[0].match(/min-height:\s*(\d+)px/) ?? [])[1]);
  assert.ok(minHeight >= 40, "`.cd-btn` 触屏点击目标 ≥40px（实测 " + minHeight + "px）");
  assert.equal(minHeight, 44, "档位对齐 .cos-home-btn 44px 先例");
  assert.ok(/\.cd-actions \{[^}]*gap:\s*8px/.test(ENGINE_CSS), "双按钮同排布区、间距 8px");
  assert.ok(/\.cd-actions \{[^}]*display:\s*flex/.test(ENGINE_CSS), "双按钮横排（flex）");
  assert.ok(ENGINE_CSS.includes(".cd-btn:disabled"), "在途禁用态有视觉表达（灰化）");
  /* 配色优先官方 token、缺席回落风格 D 基线（spec「信息卡归档动作呈现」） */
  assert.ok(
    /\.cd-btn \{[^}]*color:\s*var\(--dsw-alias-label-primary,\s*var\(--cos-accent-ink/.test(ENGINE_CSS),
    "按钮字色优先官方 label token（缺席回落风格 D 基线）"
  );
  assert.ok(
    /\.cd-btn \{[^}]*border:\s*1px solid var\(--dsw-alias-border-l2/.test(ENGINE_CSS),
    "按钮描边优先官方 border token（缺席回落风格 D 基线）"
  );
  assert.ok(
    /\.cd-btn:hover \{[^}]*var\(--dsw-alias-interactive-bg-hover-solid/.test(ENGINE_CSS),
    "悬停底色优先官方交互 token（缺席回落风格 D 基线）"
  );
}

/* ── 7. 源码锚点：引擎卡片双按钮 + client 接线（2.1/2.2/3.1–3.3） ── */
{
  const engineSource = readFileSync(new URL("../src/cosmos/engine.mjs", import.meta.url), "utf8");
  const clientSource = readFileSync(new URL("../src/client.jsx", import.meta.url), "utf8");

  /* 行星卡与彗星卡共用双按钮组（一张卡一份 markup，两次挂载） */
  const actionsBody = engineSource.slice(
    engineSource.indexOf("function cardActionsHtml(sessionId, lead)"),
    engineSource.indexOf("function cardHtml(e)")
  );
  assert.ok(actionsBody.length > 0, "cardActionsHtml 切片");
  assert.equal((actionsBody.match(/data-action="archive"/g) ?? []).length, 1, "归档按钮稳定钩子 data-action=archive");
  /* 「打开会话」按导航可用性渲染两条分支（add-cosmos-standalone-window D6）：内嵌态带
     `aria-keyshortcuts` + 快捷键 title；独立窗口态 `disabled` + 禁用提示 title。两分支都
     保留 `data-action="open"` 稳定钩子，故切片内出现两次。 */
  assert.equal((actionsBody.match(/data-action="open"/g) ?? []).length, 2, "打开按钮稳定钩子 data-action=open（可用 / 禁用两分支）");
  assert.ok(actionsBody.includes("E.sessionNavAvailable"), "导航可用性分流（独立窗口态禁用）");
  assert.ok(actionsBody.includes('data-action="archive" data-session="'), "归档按钮与既有 data-session 钩子并存");
  assert.ok(actionsBody.includes(">打开会话<"), "按钮文案「打开会话」");
  assert.ok(actionsBody.includes(">归档会话<"), "按钮文案「归档会话」");
  assert.equal((engineSource.match(/\+\s*cardActionsHtml\(/g) ?? []).length, 2, "行星卡与彗星卡都挂双按钮组");
  /* 归档在途禁用态只走直接 DOM 切换；markup 内的唯一 disabled = 导航不可用分支
     （页面生命周期常量，不进 sig 瞬态）。 */
  assert.equal((actionsBody.match(/disabled/g) ?? []).length, 1, "markup 仅导航不可用分支渲染 disabled（归档在途仍走直接 DOM）");

  /* click 分流 + 权威门 + 直接 DOM 切换 */
  const clickBody = engineSource.slice(
    engineSource.indexOf("E.el.card.addEventListener('click'"),
    engineSource.indexOf("function isEmptyConstellation")
  );
  assert.ok(clickBody.includes("data-action"), "click 处理器读取 data-action");
  assert.ok(clickBody.includes("onArchiveSession"), "archive → onArchiveSession");
  assert.ok(clickBody.includes("onOpenSession"), "open → 既有 onOpenSession");
  assert.ok(clickBody.includes("archiveInFlight"), "per-session in-flight 集合（权威防重入门）");
  assert.ok(/querySelector\(/.test(clickBody) && /\.disabled = /.test(clickBody), "按钮禁用态经直接 DOM 切换");

  /* client 接线（3.1–3.3） */
  assert.ok(clientSource.includes("sessionIds: [id]"), "单元素请求组装（{ sessionIds: [id] }）");
  assert.ok(clientSource.includes('"/api/dsh-v-cosmos/archive-sessions"'), "POST 自有批量归档端点");
  assert.ok(clientSource.includes("onArchiveSession: (sessionId) => actions.archiveSession(sessionId)"), "引擎构造注入 onArchiveSession");
  assert.ok(clientSource.includes("archiveNoticeOf("), "outcome → 文案映射经纯逻辑模块");
  assert.ok(clientSource.includes("archiveRequestFailureNotice("), "请求失败 → 错误 toast");
  assert.ok(clientSource.includes("engine?.toast(notice.text)"), "呈现通道 = 引擎 toast（整页内）");
  const archiveAction = clientSource.slice(
    clientSource.indexOf("async archiveSession(sessionId)"),
    clientSource.indexOf("async addWorkspace()")
  );
  assert.ok(archiveAction.length > 0, "actions.archiveSession 切片");
  const bodyLine = archiveAction.split("\n").find((line) => line.includes("JSON.stringify(")) ?? "";
  assert.ok(bodyLine.includes("sessionIds: [id]"), "请求体只组装 sessionIds");
  assert.ok(!/stopActivity/.test(bodyLine), "请求体不带 stopActivity（在跑工作只跳过不杀）");
  assert.ok(!/closePage|cosmosOpenStore/.test(archiveAction), "MUST NOT 关整页（归档在覆盖层底下）");
  assert.ok(!/openspec/i.test(archiveAction), "MUST NOT 触碰 openspec 工件（零侵入）");
  assert.ok(/fetch\(/.test(archiveAction), "链路自带 HTTP 提交");
  assert.ok(/method: "POST"/.test(archiveAction), "POST 语义");
  assert.ok(/response\.ok/.test(archiveAction), "非 2xx 走失败分支");
}

console.log("session-archive-smoke: all assertions passed");
