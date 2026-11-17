/**
 * 星座动作执行链路与浮窗标记纯逻辑（add-cosmos-constellation-actions 2.1 /
 * fix-cosmos-action-draft-block 3.x / add-cosmos-native-composer 2.x /
 * spec cosmos-constellation-actions「点击执行链路（星座模式）」「autoSend 分流与标记隔离」
 * 「浮窗输入器」「发送前编辑呈现设置」「原生输入器呈现（native 分支）」）。
 *
 * 独立纯逻辑模块——浏览器 client.jsx 消费（星座动作条点击、浮窗门控）、
 * test/constellation-actions-smoke.mjs 直测。零 DOM：宿主会话动词、草稿落稿、模型切换与
 * 提交全部由调用方注入。
 *
 * 三分支分流（add-cosmos-native-composer D1/D2/D3；执行器每次 `run` 现读设置）：
 *  - `autoSend` 勾选 → hero 通道（`submit:true`，点击即发），整页保持打开；
 *  - 未勾选 + `preflight === "native"` → **同一 hero 通道**（`submit:false` 只落稿、
 *    绑定目标 SessionId、`meta.channel: "preflight"`），`openSession` 后 `closePage()`
 *    ——关整页、由原生会话页 composer 承载补写与发送（宿主契约已验证链路）；
 *  - 未勾选 + `preflight === "float"`（**缺省**，星空保持优先）→ 浮窗标记通道，整页
 *    保持打开。曾试验的「浮动原生窗口」经宿主槽位核查为结构性死锁（空白会话不渲染
 *    `conversation.session.header.actions`，而门控要求 blank；备选槽位均不可行），
 *    本文件不承载该呈现。
 *
 * 与提案动作链路（actions.mjs）的**刻意分歧**：
 *  - 消息 = 纯 `prompt`（无 `@提案目录` 组装）；
 *  - 目标工作区 = 当前钻取星座（分组 `wsId`），仍由实现侧按路径做权威解析；
 *  - 只有 native 分支关页（用户落到新会话首屏）；hero / 浮窗分支导航发生在覆盖层
 *    底下，用户视角不跳转、整页保持；
 *  - 未勾选 autoSend 时登记到**独立的浮窗标记通道**或 hero 通道（native 复用 hero；
 *    浮窗通道不与 hero 标记混用——既有 `ActionHeroDock` 对 `submit:false` 标记会走
 *    消费分支并清标记，混用会让浮窗在弹出前被吃掉）。
 *
 * 与提案动作**统一**的口径（fix-cosmos-action-draft-block D1/D2/D6）：
 *  - 恒新建会话（`createSession`）→ 标记绑定目标 SessionId → `openSession`；
 *  - 消息落稿在消费相位（hero / native 或浮窗挂载）经 `setDraft` 写入（标记带落稿意图）；
 *  - **废除** `whenDraftExists: 'replace'` 主路径覆盖语义（BREAKING）；该语义只保留在
 *    `sessions.create` 失败后的降级回落链路。
 *
 * 独立窗口服务端送达通道（add-cosmos-standalone-jump-feedback D1/D2）：
 * 构造期可选 `standaloneServerChannel` 开关**只承接 autoSend 分支**——独立窗口内 hero
 * 相位不可达（标记是每窗口内存 store），开启时该分支跳过「create + hero 标记 +
 * openSession」，改走注入的 `startSession`（调用方带 `whenDraftExists: 'replace'`）
 * 服务端落稿；**不自动提交**（提交依赖窗口内会话输入区）、不登记标记、模型切换不执行。
 * float / native 分支分流逻辑不变（独立窗口的 native 意图由注入方 preflight 强制回
 * float 并附带反馈）。缺省关闭 = 既有行为逐字不变。
 */
import { buttonModelOf, createActionGate, createPendingActionStore, draftMatches, isBlankDraft } from "./actions.mjs";

/** 浮窗标记的呈现窗口（design D5：约 10s；**仅约束「点击 → 浮窗呈现」**）。 */
export const FLOAT_MARKER_TTL_MS = 10_000;

/** 浮窗标记通道键（`meta.channel`，仅供观测/冒烟；消费按实例隔离，不按字段分流）。 */
export const FLOAT_CHANNEL = "float";
/** hero 标记通道键（autoSend 分支）。 */
export const HERO_CHANNEL = "hero";
/**
 * 原生输入器通道键（add-cosmos-native-composer D2：未勾选 autoSend 且
 * `constPreflight === "native"`）。标记仍进 hero store，本常量只作 `meta.channel`
 * 观测值（冒烟区分三分支；消费语义与 hero 同构）。
 */
export const PREFLIGHT_CHANNEL = "preflight";
/** 「发送前编辑」缺省分支（与 settings.mjs 缺省同源；注入缺席/漂移时按此兜底）。
 *  星空保持优先（用户裁决）：float = 浮窗（缺省）、native = 跳转会话页。 */
const DEFAULT_PREFLIGHT = "float";

/**
 * 组装目标消息（spec 场景「消息为纯提示词」）：星座动作消息 = 按钮 `prompt` 原文，
 * **无任何 @引用前后缀**。非字符串 → ""（调用方 MUST 拒绝执行）。
 * @param {{prompt?: string}} button
 * @returns {string}
 */
export function constellationMessageOf(button) {
  return typeof button?.prompt === "string" ? button.prompt : "";
}

/**
 * 浮窗标记 store：与 `createPendingActionStore` **同形同实现**（同工厂双实例，
 * 隔离靠实例而非重复代码），TTL 收敛为浮窗口径。
 * @param {{now?: () => number, ttlMs?: number}} [options]
 * @returns {object} arm/read/peek/clear/isArmed/ttlMs
 */
export function createFloatMarkerStore(options = {}) {
  const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : FLOAT_MARKER_TTL_MS;
  return createPendingActionStore({ ...options, ttlMs });
}

/**
 * 浮窗呈现判定（纯函数；spec「浮窗输入器」门控 + 场景「挂载落稿即呈现」
 * 「会话不匹配不呈现」「草稿非空不改写不呈现」）。
 *
 * 依次成立才呈现：
 * ① 标记在册且未过期（`entry` 由调用方经 `read()` 取得——过期即 null）；
 * ② **本会话 id === 标记目标 SessionId**（恒新建路径的确定性判据；不一致 →
 *   `session-id`，零落稿零呈现零清除）；
 * ③ 目标会话可编辑（`openState==='open' && blank===true && running !== true`）；
 * ④ 草稿恰为组装消息（`draftMatches` 归一化口径）→ 呈现；草稿为空且标记带落稿意图
 *   → `fill`（调用方先 `setDraft` 写入，等草稿到位后的下一轮再呈现——「挂载落稿即
 *   呈现」「所见即所得」）；草稿非空且不一致 → `draft`（MUST NOT 改写、MUST NOT 呈现、
 *   标记保留至过期）。
 *
 * @param {{entry: object|null, session: object|null, draft: unknown, sessionId?: unknown}} input
 * @returns {{present: boolean, fill: boolean, reason: "ok"|"no-marker"|"session-id"|"session"|"fill"|"draft"}}
 */
export function floatPresentationOf(input = {}) {
  const entry = input.entry ?? null;
  if (!entry) return { present: false, fill: false, reason: "no-marker" };
  const target = typeof entry.targetSessionId === "string" ? entry.targetSessionId : "";
  if (target && input.sessionId !== target) return { present: false, fill: false, reason: "session-id" };
  const session = input.session;
  if (
    !session
    || typeof session !== "object"
    || session.openState !== "open"
    || session.blank !== true
    || session.running === true
  ) {
    return { present: false, fill: false, reason: "session" };
  }
  if (draftMatches(input.draft, entry.message)) return { present: true, fill: false, reason: "ok" };
  if (entry.setDraft === true && isBlankDraft(input.draft)) return { present: false, fill: true, reason: "fill" };
  return { present: false, fill: false, reason: "draft" };
}

/**
 * 星座动作执行链路（fix-cosmos-action-draft-block D1/D6；add-cosmos-native-composer
 * D1–D4；rework：浮动原生窗口设计经宿主槽位核查为结构性死锁后回退——native 分支呈现
 * 归位「关页跳转原生会话页」；spec「点击执行链路（星座模式）」「autoSend 分流与标记隔离」
 * 「原生输入器呈现」）。
 *
 * 校验 → 占用共享门 → **每次现读呈现分支**（`preflight`）→ **恒新建会话**（`createSession`）
 * → 登记标记（hero 或浮窗通道，绑定目标 SessionId + 落稿意图）→ `openSession(新会话 id)`。
 * native 分支在 `openSession` 之后 `closePage()`——用户落到新会话首屏、由原生 composer
 * 承载补写与发送（与提案动作「执行后跳转」同构，宿主契约已验证）；float / autoSend 分支
 * 整页保持打开（导航发生在 Cosmos 覆盖层底下）。
 * 工作区既有 blank 与其草稿零接触（MUST NOT 复用/覆盖/归档）。
 *
 * **降级路径**（`createSession` 缺席/抛错）：toast 注明 + 回落 `startSession`
 * （调用方注入 `whenDraftExists: 'replace'`，覆盖语义只活在这里）；标记无 SessionId
 * 判据、无落稿意图（`startSession` 已把消息写进草稿）；native 分支降级后**同样关页**
 * （两路呈现收敛），float / autoSend 分支保持整页。
 * 失败（宿主动词缺席/抛错）→ 清本链路登记的标记 + toast，页面保持。
 *
 * @param {object} options
 * @param {object} [options.pending] hero 标记 store（autoSend + native 落稿/切模型）
 * @param {object} [options.floats] 浮窗标记 store（未勾选 autoSend 且 float 分支）
 * @param {() => ("native"|"float")} [options.preflight] 「发送前编辑」分支解析器
 *        （每次 `run` 现读；注入缺席 / 抛错 / 漂移值一律按缺省 `float` 兜底——SHALL NOT 抛错、
 *        MUST NOT 误走关页）
 * @param {() => void} [options.closePage] native 分支关整页（主路径与降级路径同用；缺席时 no-op）
 * @param {object} [options.gate] 共享防重入门（与提案动作执行器同门）
 * @param {(wsId: string, group: object) => Promise<string>} [options.createSession] 官方
 *        `ctx.sessions.create({ workspaceId })` 的薄包装（缺省恒新建 blank）
 * @param {(sessionId: string) => void} [options.openSession] 官方 `uiWorkspace.openSession`
 * @param {(wsId: string, message: string, group: object) => unknown} [options.startSession]
 *        **降级路径**：官方 `startSession(工作区, { prompt, whenDraftExists: 'replace' })`
 *        的薄包装（第三参为钻取分组，供实现侧按 `wsPath` 解析权威 id）
 * @param {(text: string, isError?: boolean) => void} [options.notify]
 * @param {object} [options.labels] 文案（degraded——降级注释；缺省内置中文）
 * @param {() => number} [options.now] 私有门时钟（未注入 gate 时生效）
 * @param {number} [options.cooldownMs] 私有门冷却窗（未注入 gate 时生效）
 * @param {boolean} [options.standaloneServerChannel] 独立窗口**服务端送达通道**
 *        （add-cosmos-standalone-jump-feedback D1）：只作用于 autoSend 分支——开启时
 *        跳过「create + hero 标记 + openSession」，改走 `startSession`（调用方注入
 *        `whenDraftExists: "replace"`）服务端落稿，不自动提交、不登记标记、模型切换
 *        不执行。float / native 分支分流不变。缺省 false（行为与从前逐字一致）。
 * @param {(info: {autoSend: boolean}) => void} [options.standaloneNotice]
 *        服务端通道成功后的呈现通知（注入方 toast；执行器不感知文案）。缺省静默。
 * @returns {{run: (input: {button: object, group: object}) => Promise<object>}}
 */
export function createConstellationExecutor(options = {}) {
  const pending = options.pending ?? null;
  const floats = options.floats ?? null;
  const preflight = typeof options.preflight === "function"
    ? options.preflight
    : () => DEFAULT_PREFLIGHT;
  const closePage = typeof options.closePage === "function" ? options.closePage : () => {};
  const createSession = typeof options.createSession === "function" ? options.createSession : null;
  const openSession = typeof options.openSession === "function" ? options.openSession : null;
  const startSession = options.startSession;
  const notify = typeof options.notify === "function" ? options.notify : () => {};
  const standaloneServerChannel = options.standaloneServerChannel === true;
  const standaloneNotice = typeof options.standaloneNotice === "function" ? options.standaloneNotice : null;
  const degradedLabel = typeof options.labels?.degraded === "string" && options.labels.degraded
    ? options.labels.degraded
    : "新建会话通道不可用，已降级为复用空白会话";
  const canCreateNew = createSession !== null && openSession !== null;
  const gate = options.gate ?? createActionGate({ now: options.now, cooldownMs: options.cooldownMs });
  /**
   * 「发送前编辑」分支解析（D1 执行器侧兜底）：只认显式 `"native"`，其余（`"float"`、
   * 缺注入、抛错、设置面漂移值）一律按缺省 `float`——保守默认方向 = 不关页、星空保持，
   * SHALL NOT 抛错中断点击。
   * @returns {"native"|"float"}
   */
  const resolvePreflight = () => {
    try {
      return preflight() === "native" ? "native" : "float";
    } catch {
      return DEFAULT_PREFLIGHT;
    }
  };
  return {
    async run({ button, group } = {}) {
      if (!gate.canEnter()) return { ok: false, reason: "busy" };
      if (!group || typeof group.wsId !== "string" || !group.wsId) return { ok: false, reason: "no-target" };
      const message = constellationMessageOf(button);
      if (!message.trim()) return { ok: false, reason: "no-button" };
      if (!canCreateNew && typeof startSession !== "function") {
        notify("创建会话不可用（当前宿主未提供）", true);
        return { ok: false, reason: "unavailable" };
      }
      /* 三分支分流（D1）：勾选 autoSend = hero 接力（点击即发）；未勾选按设置面分支——
         float（缺省）= 浮窗补写、星空保持；native = hero 落稿 + 关页跳转原生会话页。 */
      const submit = button?.autoSend === true;
      /* 独立窗口服务端通道**只承接 autoSend 分支**（D1）：提交意图在独立窗口不可达
         （依赖窗口内会话输入区），故只落草稿、不自动提交、不登记 hero 标记——每个窗口的
         标记 store 是独立内存实例，跨窗口恒悬空。float / native 分流不变。 */
      const serverAutoSend = standaloneServerChannel && submit;
      if (serverAutoSend && typeof startSession !== "function") {
        notify("创建会话不可用（当前宿主未提供）", true);
        return { ok: false, reason: "unavailable" };
      }
      const native = !submit && resolvePreflight() === "native";
      const channel = submit ? HERO_CHANNEL : native ? PREFLIGHT_CHANNEL : FLOAT_CHANNEL;
      const store = submit || native ? pending : floats;
      if (!serverAutoSend && store === null) return { ok: false, reason: "unavailable" };
      /** native 分支关整页（主路径与降级路径同用——两路呈现收敛于原生会话页）。 */
      const settlePage = () => {
        if (native) closePage();
      };
      const model = buttonModelOf(button?.model);
      if (!gate.enter()) return { ok: false, reason: "busy" };
      /* `meta` 只带展示用信息（浮窗标题栏 / 原生窗口 head）与分支观测值（`channel`）。 */
      const meta = { channel, wsId: group.wsId, wsName: String(group.wsName ?? ""), buttonName: String(button?.name ?? "") };
      let marker = null;
      try {
        if (serverAutoSend) {
          /* 独立窗口服务端送达（D1）：只落草稿、不自动提交（标记不登记——跨窗口不可达）。
             反馈交给注入方（`standaloneNotice`），执行器不感知文案。 */
          try {
            await startSession(group.wsId, message, group);
          } catch (error) {
            const detail = String(error?.message || error);
            notify("创建会话失败：" + detail, true);
            return { ok: false, reason: "start-failed", error: detail, standalone: true };
          }
          standaloneNotice?.({ autoSend: true });
          return {
            ok: true,
            message,
            marker: null,
            channel: "standalone-server",
            degraded: false,
            standalone: true,
            serverDraft: true,
            autoSendSkipped: true,
            modelSkipped: model !== undefined
          };
        }
        if (!canCreateNew) {
          notify(degradedLabel + "：当前宿主未提供新建会话通道");
          marker = store.arm({ message, model, submit, meta });
          await startSession(group.wsId, message, group);
          settlePage();
          return { ok: true, message, marker, channel, degraded: true };
        }
        let sessionId = "";
        try {
          sessionId = await createSession(group.wsId, group);
          if (typeof sessionId !== "string" || !sessionId) throw new Error("会话创建未返回有效 id");
        } catch (error) {
          /* 恒新建不可用：回落现行 replace 链路（覆盖语义只活在这里）。 */
          notify(degradedLabel + "：" + String(error?.message || error));
          marker = store.arm({ message, model, submit, meta });
          await startSession(group.wsId, message, group);
          settlePage();
          return { ok: true, message, marker, channel, degraded: true };
        }
        /* 标记必须先于 openSession：新会话首屏相位（hero / 浮窗挂载）可能在导航
           完成瞬间出现。恒新建路径恒登记（未勾选也需落稿），判据 = 目标 SessionId。 */
        marker = store.arm({ message, model, submit, targetSessionId: sessionId, setDraft: true, meta });
        openSession(sessionId);
        /* native 分支关整页：用户落到新会话首屏、原生 composer 已预填（与提案动作
           「执行后跳转」同序——标记 → openSession → closePage，时序已验证）；
           float / autoSend 分支整页保持打开（导航发生在覆盖层底下）。 */
        settlePage();
        return { ok: true, message, marker, channel, sessionId, degraded: false };
      } catch (error) {
        if (marker) store.clear(marker.token);
        const detail = String(error?.message || error);
        notify("创建会话失败：" + detail, true);
        return { ok: false, reason: "start-failed", error: detail };
      } finally {
        gate.exit();
      }
    }
  };
}

/* 草稿等校验与浮窗标记的生命周期共用 hero 通道同一口径（导出便于消费方与冒烟）。 */
export { draftMatches };
