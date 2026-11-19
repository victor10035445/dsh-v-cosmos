/**
 * 宿主当前会话跟随冒烟（add-cosmos-host-session-follow 4.1–4.4）：
 *
 *  ① 单点出口三态：主源 present / absent 回落镜像 / 形状漂移不采信 / 服务缺席全镜像
 *     （含 getSnapshot 抛错静默）。
 *  ② 会话 id → 星座解析纯函数 `wsIdBySessionId`（行星/彗星命中、未命中、坏输入）。
 *  ③ 变化沿跟随（真引擎）：银河态钻入落地选中、同星座立即选中 + 短补间重对焦、跨星座
 *     替换焦点；落地选中经引擎既有 `onSelectChange` 通知同步（面板行高亮 = 既有镜像，
 *     零第二选中镜像）。
 *  ④ 哨兵去重与回声短路：同值零动作、非 current 刷新零动作、自身切换回声短路（无双补间）。
 *  ⑤ 开页定位时序：场景未就绪保留待执行、首帧场景就绪执行、每次开页执行（与哨兵解耦）、
 *     页关闭期间只记哨兵、重开页按新当前会话定位。
 *  ⑥ 降级静默：会话不在册 / focusBody false / focusBody 抛错 / 引擎缺席 / 订阅随控制器
 *     回收（无悬挂监听）/ 双 attach 幂等 / 服务缺席整能力镜像模式。
 *  ⑦ 控制器接线源码锚点（client.jsx 单点出口 + 四处挂点；页行点击既有链路逐字不变）。
 *
 * 运行：node test/host-session-follow-smoke.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHostSessionFollow, currentSessionIdOf, wsIdBySessionId } from "../src/host-session-follow.mjs";
import { createCosmosEngine, STAR_FOCUS_DUR } from "../src/cosmos/engine.mjs";
import { createSkinD } from "../src/cosmos/skin-d.mjs";

/* ══════════════════════ ① 单点出口 ══════════════════════ */
{
  const present = { uiSession: { adapter: { current: { getSnapshot: () => ({ key: "s-1" }) } } } };
  assert.equal(currentSessionIdOf(present), "s-1", "主源命中：快照 .key 即当前会话 id");
  assert.equal(currentSessionIdOf(present, "s-mirror"), "s-1", "主源命中优先于降级镜像");

  const absent = { uiSession: { adapter: { current: { getSnapshot: () => ({ key: undefined }) } } } };
  assert.equal(currentSessionIdOf(absent, "s-mirror"), "s-mirror", "absent 形态（key: void 0）→ 回落镜像");

  const emptyKey = { uiSession: { adapter: { current: { getSnapshot: () => ({ key: "" }) } } } };
  assert.equal(currentSessionIdOf(emptyKey, "s-mirror"), "s-mirror", "空串 key 不采信（非空字符串才采信）");

  const drift = { uiSession: { adapter: { current: { getSnapshot: () => ({ key: 42 }) } } } };
  assert.equal(currentSessionIdOf(drift, "s-mirror"), "s-mirror", "形状漂移（key 非字符串）→ 回落镜像，不采信、不抛错");

  const throwing = {
    uiSession: {
      adapter: {
        current: {
          getSnapshot() {
            throw new Error("host snapshot exploded");
          }
        }
      }
    }
  };
  let threw = false;
  let value = null;
  try {
    value = currentSessionIdOf(throwing, "s-mirror");
  } catch {
    threw = true;
  }
  assert.equal(threw, false, "宿主快照抛错 → MUST NOT 外抛到事件链");
  assert.equal(value, "s-mirror", "读取异常静默回落镜像");

  assert.equal(currentSessionIdOf(null), null, "服务缺席且无镜像 → null（旧宿主 / 最小桩环境）");
  assert.equal(currentSessionIdOf({}, "s-mirror"), "s-mirror", "服务缺席 → 全镜像");
  assert.equal(currentSessionIdOf({}, 42), null, "非法镜像值不采信（恒返回字符串或 null）");
  assert.equal(currentSessionIdOf(present, 42), "s-1", "主源命中时非法镜像无影响");
}

/* ══════════════════════ ② 会话 id → 星座解析 ══════════════════════ */
{
  const scene = {
    workspaces: [
      { id: "wa", planets: [{ id: "pa" }, { id: "pa2" }], comets: [{ id: "ca" }] },
      { id: "wb", planets: [{ id: "pb" }], comets: [] }
    ]
  };
  assert.equal(wsIdBySessionId(scene, "pa"), "wa", "行星命中 → 所属星座");
  assert.equal(wsIdBySessionId(scene, "ca"), "wa", "彗星命中 → 所属星座");
  assert.equal(wsIdBySessionId(scene, "pb"), "wb", "跨星座命中正确");
  assert.equal(wsIdBySessionId(scene, "ghost"), null, "不在册 → null");
  assert.equal(wsIdBySessionId(null, "pa"), null, "缺场景 → null 不抛错");
  assert.equal(wsIdBySessionId({}, "pa"), null, "坏场景形状 → null");
  assert.equal(wsIdBySessionId(scene, ""), null, "空 id → null");
  assert.equal(wsIdBySessionId(scene, 42), null, "非字符串 id → null");
  assert.equal(wsIdBySessionId({ workspaces: [null, { id: "wc", planets: [{ id: "pc" }] }] }, "pc"), "wc", "空工作区条目容错");
}

/* ══════════════════════ 引擎 DOM 桩（真引擎飞行直测） ══════════════════════ */
function ctx2d() {
  const grad = { addColorStop() {} };
  const store = {};
  return new Proxy(store, {
    get(target, prop) {
      if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => grad;
      if (!(prop in target)) target[prop] = () => undefined;
      return target[prop];
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    }
  });
}

function classListOf(el) {
  const tokens = () => String(el.className).split(/\s+/).filter(Boolean);
  const write = (list) => {
    el.className = list.join(" ");
  };
  return {
    add(...names) {
      const list = tokens();
      for (const name of names) if (name && !list.includes(name)) list.push(name);
      write(list);
    },
    remove(...names) {
      write(tokens().filter((name) => !names.includes(name)));
    },
    toggle(name, force) {
      const list = tokens();
      const has = list.includes(name);
      const want = force === undefined ? !has : !!force;
      if (want === has) return want;
      if (want) list.push(name);
      else list.splice(list.indexOf(name), 1);
      write(list);
      return want;
    },
    contains(name) {
      return tokens().includes(name);
    }
  };
}

function stubEl(tag) {
  const el = {
    tag,
    style: {},
    dataset: {},
    className: "",
    innerHTML: "",
    textContent: "",
    width: 0,
    height: 0,
    children: [],
    listeners: {},
    attrs: {},
    _by: {},
    classList: null,
    appendChild(child) {
      el.children.push(child);
      return child;
    },
    remove() {},
    querySelector(sel) {
      if (!el._by[sel]) {
        const child = stubEl(sel === ".cos-canvas" || sel === ".cos-tiplines" ? "canvas" : "div");
        if (child.tag === "canvas") child.getContext = () => ctx2d();
        el._by[sel] = child;
      }
      return el._by[sel];
    },
    addEventListener(type, fn) {
      (el.listeners[type] = el.listeners[type] || []).push(fn);
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
  el.classList = classListOf(el);
  return el;
}

globalThis.window = {
  devicePixelRatio: 1,
  addEventListener() {},
  removeEventListener() {}
};
globalThis.document = {
  createElement: (tag) => {
    const el = stubEl(tag);
    if (tag === "canvas") el.getContext = () => ctx2d();
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
const rafQueue = [];
globalThis.requestAnimationFrame = (cb) => {
  rafQueue.push(cb);
  return rafQueue.length;
};
globalThis.cancelAnimationFrame = () => {};
let fakeNow = 0;
globalThis.performance = { now: () => fakeNow };
function stepFrame(ms) {
  const cb = rafQueue.shift();
  assert.ok(cb, "帧回调在队");
  cb(ms);
}

/* 双星座场景（行星 + 彗星），与面板投影职责一致（会话只作行星/彗星）。 */
function flightScene() {
  const star = (id) => ({
    id,
    name: id,
    lifecycle: "created",
    setBy: null,
    at: null,
    tasks: [1, 2],
    age: "刚刚",
    act: 0,
    off: [0, 0, 0]
  });
  return {
    workspaces: [
      {
        id: "ba",
        name: "alpha",
        pos: [0, 0, 0],
        stars: [star("sa")],
        links: [],
        planets: [
          {
            id: "pa",
            title: "pa",
            state: "idle",
            pendingKind: null,
            stars: ["sa"],
            todos: "—",
            when: "刚刚",
            updatedAt: 200,
            satellites: [],
            satelliteCount: 2,
            delegatedBusy: false
          }
        ],
        comets: [
          {
            id: "ca",
            title: "ca",
            state: "busy",
            pendingKind: null,
            when: "刚刚",
            updatedAt: 100,
            satellites: [],
            satelliteCount: 0,
            delegatedBusy: false
          }
        ],
        archives: 0,
        satelliteCount: 2
      },
      {
        id: "bb",
        name: "beta",
        pos: [400, 0, 0],
        stars: [star("sb")],
        links: [],
        planets: [
          {
            id: "pb",
            title: "pb",
            state: "waiting",
            pendingKind: "approval",
            stars: ["sb"],
            todos: "—",
            when: "刚刚",
            updatedAt: 300,
            satellites: [],
            satelliteCount: 0,
            delegatedBusy: false
          }
        ],
        comets: [],
        archives: 0,
        satelliteCount: 0
      }
    ]
  };
}

/**
 * 跟随器测试夹具：可控 uiSession 快照 + 订阅者集合 + disposers。
 * @param {object} [options]
 */
function makeHarness({ key = null, scene = null, engine = null, withService = true } = {}) {
  let snapshot = { key };
  const listeners = new Set();
  let unsubscribeCount = 0;
  const current = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        if (listeners.delete(listener)) unsubscribeCount += 1;
      };
    }
  };
  const uiSession = { adapter: { current } };
  const injectedDeps = [];
  const ctx = {
    /* 服务缺席 = 宿主 ctx 上无 uiSession 属性（旧宿主 / 最小桩环境）。 */
    ...(withService ? { uiSession } : {}),
    inject(deps, callback) {
      injectedDeps.push([...deps]);
      /* 服务不在册 → 回调不执行（可选注入语义）。 */
      if (withService) callback({ uiSession });
      return { dispose() {} };
    }
  };
  const engineRef = { value: engine };
  const sceneRef = { value: scene };
  const disposers = [];
  const follow = createHostSessionFollow({
    ctx,
    getEngine: () => engineRef.value,
    getScene: () => sceneRef.value,
    addDisposer: (dispose) => disposers.push(dispose)
  });
  return {
    follow,
    engineRef,
    sceneRef,
    listeners,
    injectedDeps,
    get unsubscribeCount() {
      return unsubscribeCount;
    },
    setKey(next) {
      snapshot = { key: next };
    },
    fire() {
      for (const listener of [...listeners]) listener();
    },
    release() {
      for (const dispose of disposers) dispose();
      follow.dispose();
    }
  };
}

/* ══════════════════════ ③ 变化沿跟随（真引擎：与面板行点击同一机械） ══════════════════════ */
{
  const scene = flightScene();
  const notifications = [];
  const eng = createCosmosEngine({
    container: stubEl("div"),
    style: createSkinD(),
    onSelectChange: (info) => notifications.push(info)
  });
  rafQueue.length = 0;
  fakeNow = 500000;
  let tNow = 500000;
  const step = () => {
    tNow += 50;
    stepFrame(tNow);
  };
  eng.setScene(scene, "rebuild");
  eng.start();
  for (let i = 0; i < 27; i += 1) step();

  const h = makeHarness({ key: "pa", scene, engine: eng });
  h.follow.attachUiSession();

  /* 银河态：变化沿 → dive 钻入所属星座 → 落地选中（与面板行点击同参数）。 */
  const dives0 = eng.inspectInput().dives;
  assert.equal(h.follow.applyCurrentSession(), true, "变化沿接受一次聚焦请求");
  assert.equal(eng.inspectInput().dives, dives0 + 1, "银河态变化沿 → 复用既有 dive（零新增引擎入口）");
  assert.equal(eng.inspectFilter().tween.mode, "in", "dive 补间（endMode in）");
  fakeNow += 1400;
  step();
  assert.deepEqual(eng.inspectSelection(), { kind: "planet", wsId: "ba", id: "pa" }, "落地选中目标行星");
  assert.deepEqual(notifications.at(-1), { kind: "planet", wsId: "ba", id: "pa" }, "面板行高亮经既有 onSelectChange 通知同步（零第二镜像）");

  /* 同星座钻取态：立即选中 + 短补间重对焦（不重播全量钻入）。 */
  eng.zoomBy(400); // 拉远，使视距 > STAR_FOCUS_DIST（观察距离收敛）
  assert.ok(eng.getCamera().dist > 155, "拉远后视距超过近距档");
  const divesSame = eng.inspectInput().dives;
  h.setKey("ca");
  h.fire(); // 宿主换绑通知（官方侧栏切换的模拟沿）
  assert.equal(h.follow.applyCurrentSession(), false, "同一沿已被订阅回调消费（哨兵已更新）");
  assert.equal(eng.inspectInput().dives, divesSame, "同星座不重播钻入");
  assert.deepEqual(eng.inspectSelection(), { kind: "comet", wsId: "ba", id: "ca" }, "同星座立即选中彗星（kind=comet）");
  const refocus = eng.inspectFilter().tween;
  assert.equal(refocus.mode, null, "重对焦无 endMode（与面板行点击同参数）");
  assert.equal(refocus.dur, STAR_FOCUS_DUR, "重对焦短补间时长逐字一致");
  assert.equal(refocus.to.mix, 1, "显式携带 mix:1");
  assert.deepEqual(notifications.at(-1), { kind: "comet", wsId: "ba", id: "ca" }, "面板行高亮随重对焦同步彗星");

  /* 跨星座钻取态：替换焦点（dive 同语义）。 */
  const divesCross = eng.inspectInput().dives;
  h.setKey("pb");
  h.fire();
  assert.equal(eng.inspectInput().dives, divesCross + 1, "跨星座 → dive 替换焦点");
  assert.equal(eng.inspectFilter().focus.id, "bb", "焦点星座即时切换");
  fakeNow += 1400;
  step();
  assert.deepEqual(eng.inspectSelection(), { kind: "planet", wsId: "bb", id: "pb" }, "跨星座落地选中");
  eng.dispose();
}

/* ══════════════════════ ④ 哨兵去重与回声短路 ══════════════════════ */
{
  const scene = flightScene();
  const calls = [];
  const engine = {
    focusBody(wsId, id) {
      calls.push([wsId, id]);
      return true;
    }
  };

  /* 同值零动作 / 非 current 刷新零动作（列表镜像刷新不走跟随入口）。 */
  const h = makeHarness({ key: "pa", scene, engine });
  h.follow.attachUiSession();
  assert.equal(h.follow.applyCurrentSession(), true, "首个变化沿跟随一次");
  assert.deepEqual(calls, [["ba", "pa"]], "聚焦目标 = 解析后的星座 + 会话 id");
  assert.equal(h.follow.applyCurrentSession(), false, "哨兵同值 → 零动作");
  assert.equal(h.follow.applyCurrentSession(), false, "再次同值仍零动作");
  h.fire(); // 列表状态刷新等非 current 变化不会经过订阅（此处同值沿同样零动作）
  assert.equal(calls.length, 1, "非 current 刷新不重触发飞行");

  /* 自身切换回声（异步通知）：openSessionInPlace 前写（镜像 + 哨兵）→ 换绑通知随后到达。 */
  const echoCalls = [];
  const echoEngine = {
    focusBody(wsId, id) {
      echoCalls.push([wsId, id]);
      return true;
    }
  };
  const echo = makeHarness({ key: "pa", scene, engine: echoEngine });
  echo.follow.attachUiSession();
  echo.follow.noteOpenedSession("pb"); // 面板行点击：openSessionInPlace 的乐观前写
  echo.follow.settleOpenedSession(true); // 导航动词已发起（前写转正）
  assert.equal(echo.follow.mirrorSessionIdOf(), "pb", "成功发起的目标写入降级镜像");
  assert.equal(echo.follow.lastFollowedOf(), "pb", "乐观预写同时推进哨兵");
  echo.setKey("pb");
  echo.fire(); // 宿主换绑通知随后到达（同值）
  assert.equal(echoCalls.length, 0, "回声被哨兵短路——MUST NOT 二次镜头补间");

  /* 自身切换回声（宿主在动词内部**同步**通知）：前写早于动词 → 同一哨兵短路。 */
  const syncCalls = [];
  const sync = makeHarness({
    key: "pa",
    scene,
    engine: {
      focusBody(wsId, id) {
        syncCalls.push([wsId, id]);
        return true;
      }
    }
  });
  sync.follow.attachUiSession();
  sync.follow.noteOpenedSession("pb"); // 动词调用之前
  sync.setKey("pb");
  sync.fire(); // 动词内部同步换绑通知
  sync.follow.settleOpenedSession(true);
  assert.equal(syncCalls.length, 0, "同步回声同样被短路（前写 MUST 早于切换动词）");

  /* 未发起（通道缺失 / 异常）→ 回滚前写：镜像/哨兵净前进只发生在成功路径。 */
  const rollback = makeHarness({ key: "pa", scene });
  rollback.follow.attachUiSession();
  rollback.follow.noteOpenedSession("pb");
  assert.equal(rollback.follow.mirrorSessionIdOf(), "pb", "在途窗口镜像前写（absent 窗口出口自洽）");
  assert.equal(rollback.follow.lastFollowedOf(), "pb", "在途窗口哨兵前写");
  assert.equal(rollback.follow.settleOpenedSession(false), true, "未发起 → 执行回滚");
  assert.equal(rollback.follow.mirrorSessionIdOf(), null, "镜像回滚到前值");
  assert.equal(rollback.follow.lastFollowedOf(), null, "哨兵回滚到前值");

  /* 降级镜像在 absent 窗口自洽：主源缺席时出口读回镜像。 */
  echo.setKey(undefined);
  assert.equal(echo.follow.currentSessionId(), "pb", "absent 窗口 → 出口回落镜像");
  echo.fire();
  assert.equal(echoCalls.length, 0, "absent 与镜像同值 → 仍零动作（不自造飞行）");

  /* 无重复飞行：连续两次同值沿只聚焦一次。 */
  const once = makeHarness({ key: "pa", scene, engine: { focusBody: () => { calls.push("once"); return true; } } });
  once.follow.applyCurrentSession();
  once.follow.applyCurrentSession();
  assert.equal(calls.filter((entry) => entry === "once").length, 1, "连续同值沿只聚焦一次（无队列堆积）");
}

/* ══════════════════════ ⑤ 开页定位时序 ══════════════════════ */
{
  const scene = {
    workspaces: [
      { id: "wa", planets: [{ id: "sa" }], comets: [] },
      { id: "wb", planets: [], comets: [{ id: "sb" }] }
    ]
  };
  const calls = [];
  const engine = {
    focusBody(wsId, id) {
      calls.push([wsId, id]);
      return true;
    }
  };
  const h = makeHarness({ key: "sa", scene: null, engine });
  h.follow.attachUiSession();

  /* 场景未就绪（attach 时 mergedScene null）→ 保留待执行。 */
  assert.equal(h.follow.onPageAttach(), false, "场景未就绪 → 本帧不发起镜头");
  assert.equal(calls.length, 0, "无镜头动作");
  h.sceneRef.value = scene;
  assert.equal(h.follow.onSceneReady(), true, "首帧场景就绪 → 开页定位执行");
  assert.deepEqual(calls.at(-1), ["wa", "sa"], "定位到当前会话天体（同链路 focusBody）");
  assert.equal(h.follow.lastFollowedOf(), "sa", "定位后同步哨兵");

  /* 开页后同值刷新不重复飞行。 */
  assert.equal(h.follow.applyCurrentSession(), false, "定位后同值刷新零动作");
  assert.equal(h.follow.onSceneReady(), false, "定位已消费 → 后续场景重建不重复定位");

  /* 每次开页都执行（与哨兵解耦）：重开页即使当前会话未变也重新定位。 */
  h.follow.onPageDetach();
  const before = calls.length;
  assert.equal(h.follow.onPageAttach(), true, "重开页定位执行（哨兵同值不阻断）");
  assert.deepEqual(calls.at(-1), ["wa", "sa"], "重开页重新定位当前会话");
  assert.equal(calls.length, before + 1, "每次开页一次镜头");

  /* 页关闭期间的变化沿只记哨兵；重开页按新当前会话定位。 */
  h.follow.onPageDetach();
  h.engineRef.value = null; // 页关闭 → 引擎销毁
  h.setKey("sb");
  h.fire();
  assert.equal(h.follow.lastFollowedOf(), "sb", "页关闭 → 仅更新哨兵");
  assert.equal(calls.length, before + 1, "页关闭期间无镜头动作");
  h.engineRef.value = engine;
  h.follow.onPageAttach();
  assert.deepEqual(calls.at(-1), ["wb", "sb"], "重开页按新当前会话兜底定位");

  /* 无当前会话 → 开页定位静默放弃（不抛错）。 */
  const idle = makeHarness({ key: null, scene, engine });
  assert.equal(idle.follow.onPageAttach(), false, "无当前会话 → 无定位");
}

/* ══════════════════════ ⑥ 降级静默 ══════════════════════ */
{
  const scene = flightScene();

  /* 会话不在册（已归档 / 工作区未注册）：只记哨兵、无镜头、无报错。 */
  const missing = makeHarness({ key: "ghost", scene, engine: { focusBody: () => assert.fail("不在册 MUST NOT 调用 focusBody") } });
  missing.follow.attachUiSession();
  assert.equal(missing.follow.applyCurrentSession(), false, "不在册 → 静默 false");
  assert.equal(missing.follow.lastFollowedOf(), "ghost", "仅更新哨兵");
  assert.equal(missing.follow.currentSessionId(), "ghost", "出口仍如实返回当前会话");

  /* 引擎聚焦降级失败（骨架时序差）：返回 false，不抛错。 */
  const rejected = makeHarness({ key: "pa", scene, engine: { focusBody: () => false } });
  rejected.follow.attachUiSession();
  assert.equal(rejected.follow.applyCurrentSession(), false, "focusBody false → 静默");

  /* 引擎聚焦抛错：捕获、不外抛（订阅回调链不断）。 */
  const exploding = makeHarness({
    key: "pa",
    scene,
    engine: {
      focusBody() {
        throw new Error("engine exploded");
      }
    }
  });
  exploding.follow.attachUiSession();
  let explodingThrew = false;
  try {
    exploding.follow.applyCurrentSession();
    exploding.fire();
  } catch {
    explodingThrew = true;
  }
  assert.equal(explodingThrew, false, "聚焦/读取异常全链静默（MUST NOT 外抛到事件链）");

  /* 引擎未挂载（页关闭）：只记哨兵。 */
  const closed = makeHarness({ key: "pa", scene, engine: null });
  closed.follow.attachUiSession();
  assert.equal(closed.follow.applyCurrentSession(), false, "引擎缺席 → 无镜头");
  assert.equal(closed.follow.lastFollowedOf(), "pa", "哨兵照常推进");

  /* 服务缺席（旧宿主）：可选注入回调不执行 → 镜像模式可用。 */
  const degraded = makeHarness({ key: "pa", scene, withService: false });
  degraded.follow.attachUiSession();
  assert.equal(degraded.injectedDeps.length, 1, "降级态仍尝试可选注入（服务不在册回调不执行）");
  assert.deepEqual(degraded.injectedDeps[0], ["uiSession"], "依赖声明 = uiSession");
  assert.equal(degraded.listeners.size, 0, "服务不在册 → 主源未接线（无 subscribe）");
  assert.equal(degraded.follow.currentSessionId(), null, "降级态开页初值 = null（无主源、无镜像）");
  degraded.follow.noteOpenedSession("pb");
  assert.equal(degraded.follow.currentSessionId(), "pb", "降级态镜像：成功发起的切换后出口返回该目标");

  /* 双 attach 幂等（ctx.inject 回调晚到不产生双订阅）。 */
  const twice = makeHarness({ key: "pa", scene, engine: { focusBody: () => true } });
  twice.follow.attachUiSession();
  twice.follow.attachUiSession();
  assert.equal(twice.listeners.size, 1, "重复接线不产生第二订阅");

  /* 订阅随控制器回收（disposers）：监听清空、后续沿零动作、镜像可释放。 */
  const recycled = makeHarness({ key: "pa", scene, engine: { focusBody: () => true } });
  recycled.follow.attachUiSession();
  assert.equal(recycled.listeners.size, 1, "订阅已接线");
  recycled.release();
  assert.equal(recycled.listeners.size, 0, "控制器回收 → 无悬挂监听");
  assert.equal(recycled.unsubscribeCount, 1, "退订函数被调用一次（幂等）");
  assert.equal(recycled.follow.currentSessionId(), null, "跟随器销毁后出口恒定 null");
  assert.equal(recycled.follow.applyCurrentSession(), false, "销毁后零动作");
}

/* ══════════════════════ ⑦ 控制器接线源码锚点 ══════════════════════ */
{
  const clientSource = readFileSync(new URL("../src/client.jsx", import.meta.url), "utf8");
  const moduleSource = readFileSync(new URL("../src/host-session-follow.mjs", import.meta.url), "utf8");

  assert.ok(
    clientSource.includes('import { createHostSessionFollow, currentSessionIdOf, wsIdBySessionId } from "./host-session-follow.mjs";'),
    "控制器导入跟随器与单点出口纯函数"
  );
  assert.ok(clientSource.includes("hostFollow = createHostSessionFollow({"), "跟随器在控制器 setup 创建（页开合无关）");
  assert.ok(clientSource.includes("hostFollow.attachUiSession();"), "可选主源接线在控制器 setup 执行");
  assert.ok(clientSource.includes("addDisposer: (dispose) => disposers.push(dispose)"), "订阅器入控制器 disposers 统一回收");
  assert.ok(clientSource.includes("hostFollow?.noteOpenedSession?.(sessionId);"), "openSessionInPlace 前写镜像/哨兵（MUST 早于切换动词）");
  assert.ok(clientSource.includes("hostFollow?.settleOpenedSession?.(opened === true);"), "openSessionInPlace 成功路径转正前写");
  assert.ok(clientSource.includes("hostFollow?.settleOpenedSession?.(false);"), "openSessionInPlace 未发起路径回滚前写");
  assert.ok(clientSource.includes("hostFollow?.onPageAttach?.();"), "attach 挂点：开页定位");
  assert.ok(clientSource.includes("hostFollow?.onSceneReady?.();"), "rebuild 挂点：场景就绪后消费开页定位");
  assert.ok(clientSource.includes("hostFollow?.onPageDetach?.();"), "detach 挂点：撤销未消费的开页定位");
  assert.ok(clientSource.includes("hostFollow?.dispose?.();"), "控制器销毁：跟随器释放");
  const createAt = clientSource.indexOf("hostFollow = createHostSessionFollow({");
  const attachAt = clientSource.indexOf("hostFollow.attachUiSession();", createAt);
  assert.ok(createAt > 0 && attachAt > createAt, "创建先于接线（order 确定）");

  /* 单点出口唯一性：client.jsx MUST NOT 直读宿主快照散字段（出口只在模块内）。 */
  assert.equal(clientSource.includes("adapter.current"), false, "client.jsx 零直读 adapter.current（单点出口）");
  assert.ok(moduleSource.includes("ctx?.uiSession?.adapter?.current"), "模块内是唯一一处宿主快照读取");

  /* 无第二选中镜像 / 无第二聚焦机械：跟随只经引擎既有 focusBody。 */
  assert.equal(moduleSource.includes("engineSelectStore"), false, "跟随模块零选中镜像写入（面板高亮走既有 onSelectChange）");
  assert.equal(moduleSource.includes("setSelection"), false, "跟随模块零引擎内部选中调用");
  assert.ok(moduleSource.includes("engine.focusBody?.(wsId, sessionId)"), "跟随链路 = 引擎既有 focusBody（与面板行点击同一机械）");
  assert.ok(clientSource.includes("onSelectChange: (info) => engineSelectStore.set(info)"), "面板行高亮仍经既有 onSelectChange 镜像（零第二镜像）");

  /* 既有面板行点击链路逐字不变（本能力是第三触发源，不改旧触发源）。 */
  const focusRow = clientSource.slice(
    clientSource.indexOf("const focusSessionRow = (row) => {"),
    clientSource.indexOf("const openSessionRow = (row) => {")
  );
  assert.ok(focusRow.length > 0, "focusSessionRow 切片可定位");
  assert.ok(focusRow.includes("controllerRef.current?.focusSession?.({ wsId: row.wsId, id: row.id });"), "行点击仍先走引擎 focusBody");
  assert.ok(focusRow.includes("controllerRef.current?.openSessionInPlace?.(row.id);"), "行点击仍随后切换宿主会话");

  /* dsh → Cosmos 单向：跟随模块零宿主切换动词（动作面仍只在既有面板行链路）。 */
  assert.equal(moduleSource.includes("openSessionVia"), false, "跟随模块零宿主会话导航动词（单向：dsh → Cosmos）");
  assert.equal(moduleSource.includes("ctx.sessions"), false, "跟随模块零 ctx.sessions 访问");
  assert.equal(moduleSource.includes("uiWorkspace"), false, "跟随模块零 uiWorkspace 依赖");
}

console.log("ALL HOST SESSION FOLLOW SMOKE TESTS PASSED");
