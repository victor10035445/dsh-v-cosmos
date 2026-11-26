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
 */
import { buttonModelOf, createActionGate, createPendingActionStore, createTeamIntentArmer, draftMatches, isBlankDraft } from "./actions.mjs";

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
 * 浮窗文本面自适应增高的高度口径（p1-align-const-float-native-layout design D2）：
 * 行高 20px、垂直 padding 2 × 8px、上下边框 2 × 1px —— 高度按 **border-box** 闭合
 * （`scrollHeight` 含 padding 不含 border，故测量侧补边框后传入）：
 *  - 最小 3 行 = `3 × 20 + 2 × 8 + 2 × 1 = 78`；
 *  - 封顶 14 行（与原生编辑器 14 行封顶同源）= `14 × 20 + 2 × 8 + 2 × 1 = 298`。
 * CSS 侧同值（`.dsh-cosmos-const-float-input` 的 `min-height` 与
 * `--cos-float-body-max`），冒烟以本常量交叉校验防漂移。
 */
export const FLOAT_TEXTAREA_MIN_HEIGHT = 78;
export const FLOAT_TEXTAREA_MAX_HEIGHT = 298;

/**
 * 文本面自适应增高的高度夹取（p1-align-const-float-native-layout design D2）。
 *
 * 浮窗 textarea 的测量 effect 先置 `height='auto'` 读 `scrollHeight`（含垂直 padding，
 * 与 `box-sizing:border-box` 的高度同口径），再经本函数夹取后写回受控高度：内容不足
 * 保底最小可视高度（3 行），超出封顶（14 行）后由 CSS `overflow-y:auto` 内部滚动。
 * 清空回落最小高度由同一函数覆盖（`scrollHeight ≤ min` 时取 min）。纯函数（零 DOM），
 * `test/client-ui-smoke.mjs` 直测夹取 / 边界 / 恒等。
 *
 * @param {number} scrollHeight 文本面内容高度（含 padding；非有限值按最小值兜底）
 * @param {{min?: number, max?: number}} [bounds] 夹取边界（`max < min` 时按 min 收敛）
 * @returns {number} 夹取后的高度（px）
 */
export function floatTextareaHeightOf(scrollHeight, bounds = {}) {
  const min = Number.isFinite(bounds.min) ? bounds.min : 0;
  const max = Number.isFinite(bounds.max) ? Math.max(bounds.max, min) : Number.POSITIVE_INFINITY;
  const measured = Number.isFinite(scrollHeight) ? scrollHeight : min;
  return Math.min(Math.max(measured, min), max);
}

/* ------------------------------------------------------------------ *
 * 浮窗图片附件纯逻辑（p2-add-const-float-image-attach 1.2 / 2.x / 4.x；
 * spec cosmos-constellation-actions「浮窗图片附件」）
 * ------------------------------------------------------------------ */

/**
 * 浮窗图片 MIME 白名单：宿主 `isImageMediaType`（`dsh-client-ui-conversation`
 * `service.ts`）的**本地复刻**——bundle 纯洁性禁止跨插件 import 宿主内部模块。
 * 四类栅格图与原生 composer 完全同源（`SubmitAttachment` 收窄面亦为这四类）。
 */
export const FLOAT_IMAGE_TYPES = Object.freeze(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/** 隐藏 file input 的 `accept` 值（与白名单同源，防两处漂移）。 */
export const FLOAT_IMAGE_ACCEPT = FLOAT_IMAGE_TYPES.join(",");

/**
 * 带在册附件的发送**观察态**看门狗（design D4）：10s 内无终态信号（宿主在途悬挂）→
 * 关闭浮窗。与旧「发送即关」的最坏失败面等价（已知局限，spec 如实标注）。
 */
export const FLOAT_ATTACH_WATCH_MS = 10_000;

/** 降级 face 的稳定空上传快照（`useSyncExternalStore` 要求 getSnapshot 引用稳定）。 */
const EMPTY_FLOAT_UPLOADS = Object.freeze({});

/**
 * 降级上传面（face 缺席时的 no-op 投影；快照恒为空、订阅恒无事件）。
 */
export const FLOAT_ATTACH_ABSENT_UPLOADS = Object.freeze({
  getSnapshot: () => EMPTY_FLOAT_UPLOADS,
  subscribe: () => () => {}
});

/**
 * 单文件是否浮窗可收的图片类型。
 * @param {unknown} type 浏览器声明的 MIME
 * @returns {boolean}
 */
export function isFloatImageType(type) {
  return typeof type === "string" && FLOAT_IMAGE_TYPES.includes(type);
}

/**
 * 剪贴板文件收集（宿主 `input/file-intake.ts` `clipboardFiles` 的图片能力子集复刻）：
 * `items` 中 `kind === 'file'` 的成员经 `getAsFile()` 取出，`null` 与目录成员一律跳过
 * （图片能力无目录语义——design D2）。纯函数、零 DOM：jsdom 的 `DataTransferItemList`
 * 是「带 length 的索引对象」（非数组）→ 逐索引读取，不依赖迭代器。
 *
 * @param {{items?: unknown}} transfer 粘贴事件的 `clipboardData`
 * @returns {File[]} 剪贴板中的文件（按剪贴板顺序）
 */
export function clipboardFilesOf(transfer) {
  const files = [];
  if (transfer === null || typeof transfer !== "object") return files;
  const items = transfer.items;
  if (items === null || typeof items !== "object") return files;
  const length = Number.isFinite(items.length) ? Math.max(0, Math.floor(items.length)) : 0;
  for (let index = 0; index < length; index += 1) {
    let item = null;
    try {
      item = items[index] ?? null;
    } catch {
      item = null;
    }
    if (item === null || typeof item !== "object" || item.kind !== "file") continue;
    if (typeof item.getAsFile !== "function") continue;
    let file = null;
    try {
      file = item.getAsFile();
    } catch {
      file = null;
    }
    if (file !== null && typeof file === "object") files.push(file);
  }
  return files;
}

/**
 * intake 共享校验的纯片段：批次内的图片子集（非图片忽略，目录成员不在文件能力面内）。
 * @param {readonly File[]} files 拾取 / 粘贴的批次
 * @returns {{images: File[], files: number}} 图片子集与批内文件计数（`files === 0` = 空批）
 */
export function floatImagesOf(files) {
  const list = Array.isArray(files) ? files : [];
  const images = [];
  let seen = 0;
  for (const file of list) {
    if (file === null || typeof file !== "object") continue;
    seen += 1;
    if (isFloatImageType(file.type)) images.push(file);
  }
  return { images, files: seen };
}

/** attachFace 的必备动词（缺一即降级——客户端 SHALL NOT 区分原因）。 */
const FLOAT_ATTACH_VERBS = ["createDrafts", "resolveDraftAttachments", "releaseDraftAttachment"];

/**
 * 判定 conversation 服务是否具备浮窗附件能力（服务可达 ∧ 三动词 ∧ 上传投影面齐备）。
 * @param {unknown} service `ctx.get('conversation')` 的运行时面
 * @returns {object|null} 合格服务（否则 null）
 */
function attachServiceOf(service) {
  if (service === null || typeof service !== "object") return null;
  for (const verb of FLOAT_ATTACH_VERBS) {
    if (typeof service[verb] !== "function") return null;
  }
  const uploads = service.fileUploads;
  if (uploads === null || typeof uploads !== "object") return null;
  if (typeof uploads.getSnapshot !== "function" || typeof uploads.subscribe !== "function") return null;
  return service;
}

/**
 * 构造 `attachFace`（design D1：与 models/speech 注入面同构的薄包装 face）。
 *
 * 浮窗只依赖 face、不直接触达 `conversation` 服务——`createDrafts` /
 * `resolveDraftAttachments` / `releaseDraftAttachment` / `fileUploads` 是服务的
 * **包内附件操作**（`IConversation` 冻结契约只承诺 input/blocks/send/updateQueue/
 * cancel/loadOlder），随宿主升级可能漂移：缺席或形状不符 → `available === false`，
 * 添加图片钮转「置灰可点」引导态，零降级噪音。
 *
 * 错误纪律（design D1）：`mint` 的抛错**薄透传**（如不支持的 MIME），由组件层
 * `try/catch` 捕获后 toast `error.message`——face MUST NOT 吞错转 null。
 *
 * @param {object} [options]
 * @param {() => unknown} [options.service] 服务解析器（惰性读取，缺席/抛错即降级）
 * @param {{getSnapshot: () => object, subscribe: (fn: Function) => (() => void)}} [options.uploads]
 *        上传态快照面（apply 侧注入受控镜像；缺席回落稳定空面）
 * @returns {{available: boolean, mint: Function, resolve: Function, release: Function, uploads: object}}
 */
export function createAttachFace(options = {}) {
  const serviceOf = typeof options.service === "function" ? options.service : () => null;
  const uploads = options.uploads === null || typeof options.uploads !== "object"
    ? FLOAT_ATTACH_ABSENT_UPLOADS
    : options.uploads;
  const current = () => {
    try {
      const service = serviceOf();
      return service !== null && typeof service === "object" ? service : null;
    } catch {
      return null;
    }
  };
  return {
    /** 可用判定（每次读取现算：服务注册晚于插件装配时也能在首次交互前就绪）。 */
    get available() {
      return attachServiceOf(current()) !== null;
    },
    /**
     * 铸造草稿附件（`createDrafts` 薄包装，同步）。
     * @param {string} sessionId 目标会话 id
     * @param {readonly File[]} files 已过白名单的图片
     * @param {boolean} uploadImages 是否后台立即上传（浮窗目标恒普通会话 → true）
     * @returns {{ids: string[]}} 有序 `DraftAttachmentId`
     */
    mint(sessionId, files, uploadImages) {
      const service = current();
      if (service === null || typeof service.createDrafts !== "function") {
        throw new Error("附件铸造不可用：宿主未提供附件服务");
      }
      const drafts = service.createDrafts(sessionId, files, uploadImages !== false);
      const list = Array.isArray(drafts) ? drafts : [];
      const ids = [];
      for (const draft of list) {
        const id = draft !== null && typeof draft === "object" ? draft.id : draft;
        if (typeof id === "string" && id !== "") ids.push(id);
      }
      return { ids };
    },
    /**
     * 解析在册 id 的运行时描述符（previewUrl / 宽高 / file；降级恒空）。
     * @param {readonly string[]} ids 输入状态的附件 id
     * @returns {readonly object[]}
     */
    resolve(ids) {
      const service = current();
      const requested = Array.isArray(ids) ? ids : [];
      if (service === null || typeof service.resolveDraftAttachments !== "function" || requested.length === 0) return [];
      const resolved = service.resolveDraftAttachments(requested);
      return Array.isArray(resolved) ? resolved : [];
    },
    /**
     * 释放一枚草稿附件（中止上传、回收 objectURL；降级/非法 id 零噪音）。
     * @param {string} id 附件 id
     */
    release(id) {
      const service = current();
      if (service === null || typeof service.releaseDraftAttachment !== "function") return;
      if (typeof id !== "string" || id === "") return;
      service.releaseDraftAttachment(id);
    },
    uploads: {
      getSnapshot: () => uploads.getSnapshot(),
      subscribe: (listener) => uploads.subscribe(listener)
    }
  };
}

/**
 * 两通道共享的 intake 链路（design D2/D3）：白名单过滤 → 铸造 → `addAttachments` 登记；
 * 登记被 busy 相位拒绝（返回 false）→ **释放已铸造草稿**（objectURL 回收、上传中止）。
 * 纯编排（服务与宿主动词全部由调用方注入），返回结构化 outcome 供组件映射 toast。
 *
 * @param {object} options
 * @param {object|null} options.face attachFace
 * @param {object|null} options.inputActions 会话 `InputActions`
 * @param {string} [options.sessionId] 目标会话 id
 * @param {readonly File[]} [options.files] 拾取 / 粘贴批次
 * @param {boolean} [options.uploadImages] 是否后台上传（缺省 true）
 * @returns {{kind: "added", ids: string[]} | {kind: "empty"} | {kind: "unavailable"}
 *   | {kind: "image-only"} | {kind: "busy"} | {kind: "rejected", message: string}}
 */
export function intakeFloatImages(options = {}) {
  const face = options.face ?? null;
  const inputActions = options.inputActions ?? null;
  const files = Array.isArray(options.files) ? options.files : [];
  if (files.length === 0) return { kind: "empty" };
  if (face === null || typeof face !== "object" || face.available !== true) return { kind: "unavailable" };
  const { images } = floatImagesOf(files);
  if (images.length === 0) return { kind: "image-only" };
  if (inputActions === null || typeof inputActions.addAttachments !== "function") return { kind: "unavailable" };
  let ids = [];
  try {
    const minted = face.mint(options.sessionId, images, options.uploadImages !== false);
    ids = minted !== null && typeof minted === "object" && Array.isArray(minted.ids) ? minted.ids : [];
  } catch (error) {
    return { kind: "rejected", message: String(error?.message || error) };
  }
  if (ids.length === 0) return { kind: "empty" };
  const added = inputActions.addAttachments(ids);
  if (added === false) {
    for (const id of ids) face.release(id);
    return { kind: "busy" };
  }
  return { kind: "added", ids };
}

/**
 * 移除链路（design D5）：`removeAttachment(id)` 成功后才经 face 释放（顺序同原生——
 * 先出机器状态、再中止上传回收 objectURL）；busy 相位拒绝（返回 false）MUST NOT 释放
 * （机器仍持有该 id，释放会让 rail 与输入状态漂移）。
 *
 * @param {object} options
 * @param {object|null} options.inputActions 会话 `InputActions`
 * @param {object|null} options.face attachFace
 * @param {string} options.id 附件 id
 * @returns {boolean} 是否完成移除 + 释放
 */
export function removeFloatAttachment(options = {}) {
  const inputActions = options.inputActions ?? null;
  const face = options.face ?? null;
  const id = options.id;
  if (inputActions === null || typeof inputActions.removeAttachment !== "function") return false;
  if (typeof id !== "string" || id === "") return false;
  const removed = inputActions.removeAttachment(id);
  if (removed === false) return false;
  if (face !== null && typeof face === "object" && typeof face.release === "function") face.release(id);
  return true;
}

/**
 * 发送分类（design D4 三分 + 空输入守卫扩展）：`/` 命令路径与纯文本路径逐字不变，
 * 带在册附件才进入观察态。「空输入」= 文本空 ∧ 无在册附件（附件使输入非空）。
 *
 * @param {{draft?: unknown, attachmentIds?: unknown}} [input]
 * @returns {"empty"|"command"|"text"|"watch"}
 */
export function floatSendPlanOf(input = {}) {
  const draft = typeof input.draft === "string" ? input.draft : "";
  const attachmentIds = Array.isArray(input.attachmentIds) ? input.attachmentIds : [];
  const trimmed = draft.trim();
  if (trimmed === "" && attachmentIds.length === 0) return "empty";
  if (trimmed.startsWith("/")) return "command";
  if (attachmentIds.length === 0) return "text";
  return "watch";
}

/**
 * 上传门控（design D5，对齐原生 `InputBar.tsx` 的 `uploadsPending` 口径）：
 * file 附件无上传态视为未就绪、图片无上传态视为就绪（本链路 `uploadImages` 恒 true，
 * 图片恒有上传态）；任一在册附件非 `ready` → 发送禁用。
 *
 * @param {readonly object[]} attachments 在册描述符（`attachmentIds` 的解析投影）
 * @param {object|null} uploads `fileUploads` 快照（id → DraftFileUpload）
 * @returns {boolean}
 */
export function floatAttachmentsPendingOf(attachments, uploads) {
  const list = Array.isArray(attachments) ? attachments : [];
  const states = uploads !== null && typeof uploads === "object" ? uploads : {};
  return list.some((attachment) => {
    if (attachment === null || typeof attachment !== "object") return false;
    const upload = states[attachment.id];
    if (attachment.kind === "file") return upload === undefined || upload?.status !== "ready";
    return upload !== undefined && upload?.status !== "ready";
  });
}

/**
 * 归一化会话快照的 `promptError`（宿主 `SessionSnapshot.promptError = { op, error }`）。
 * @param {unknown} value
 * @returns {{raw: object, message: string, code: string}|null}
 */
function promptFailureOf(value) {
  if (value === null || typeof value !== "object") return null;
  const error = value.error;
  if (error === null || typeof error !== "object") return null;
  return {
    raw: value,
    message: typeof error.message === "string" ? error.message : "",
    code: typeof error.code === "string" ? error.code : ""
  };
}

/**
 * 观察态终态判定（design D4）：
 *  - 提交相位非 `plain` → 在途（owner 期兜底关闭由调用方抑制）；
 *  - 相位回 `plain` ∧ `attachmentIds` 清空 → **成功**（Host 受理、机器消费附件与草稿）；
 *  - 相位回 `plain` ∧ `promptError` 出现**新**错误（与武装基线引用不同）→ **失败**；
 *  - 其余 → 继续观察（含「基线自身即错误」的重复失败同形情形由引用比较区分）。
 *
 * @param {{phase?: unknown, attachmentIds?: unknown, promptError?: unknown, baseline?: unknown}} [input]
 * @returns {{kind: "pending"} | {kind: "success"}
 *   | {kind: "failure", message: string, code: string}}
 */
export function floatWatchOutcomeOf(input = {}) {
  const phase = typeof input.phase === "string" ? input.phase : "plain";
  if (phase !== "plain") return { kind: "pending" };
  const attachmentIds = Array.isArray(input.attachmentIds) ? input.attachmentIds : [];
  if (attachmentIds.length === 0) return { kind: "success" };
  const failure = promptFailureOf(input.promptError);
  if (failure === null) return { kind: "pending" };
  if (failure.raw === (input.baseline ?? null)) return { kind: "pending" };
  return { kind: "failure", message: failure.message, code: failure.code };
}

/**
 * 失败终态的呈现文案（spec：`{message}（{code}）`）；两者皆空返回 ""（调用方回落文案）。
 * @param {{message?: unknown, code?: unknown}} failure
 * @returns {string}
 */
export function promptFailureTextOf(failure) {
  const message = typeof failure?.message === "string" ? failure.message.trim() : "";
  const code = typeof failure?.code === "string" ? failure.code.trim() : "";
  if (message !== "" && code !== "") return `${message}（${code}）`;
  return message !== "" ? message : code;
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
 * @param {(input: {sessionId: string}) => Promise<unknown>} [options.armTeamIntent]
 *        **团队意图登记**（add-cosmos-agent-team-toggle 4.2 / spec「星座执行链路团队意图
 *        登记」）：按钮 `team === true` 时于 `createSession` 成功后、标记登记与 `openSession`
 *        之前登记；autoSend 等待落地（注入实现自带的有界超时），float / native 非等待。
 *        降级路径（无目标会话 id）确定性跳过；缺省不登记（老宿主/测试面行为不变）。
 * @param {(text: string, isError?: boolean) => void} [options.notify]
 * @param {object} [options.labels] 文案（degraded——降级注释；缺省内置中文）
 * @param {() => number} [options.now] 私有门时钟（未注入 gate 时生效）
 * @param {number} [options.cooldownMs] 私有门冷却窗（未注入 gate 时生效）
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
  /* 团队意图登记（add-cosmos-agent-team-toggle 4.2）：三分支统一在 createSession 成功后
     登记；等待策略（autoSend 等待 / float·native 非等待）与缺席 toast 由共享适配器决定。 */
  const armTeam = createTeamIntentArmer({
    armTeamIntent: options.armTeamIntent,
    notify,
    labels: options.labels
  });
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
      const native = !submit && resolvePreflight() === "native";
      const channel = submit ? HERO_CHANNEL : native ? PREFLIGHT_CHANNEL : FLOAT_CHANNEL;
      const store = submit || native ? pending : floats;
      if (store === null) return { ok: false, reason: "unavailable" };
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
        /* 团队意图（add-cosmos-agent-team-toggle 4.2 / spec「星座执行链路团队意图登记」）：
           三分支统一在 createSession 成功后登记，先于标记登记与 openSession；autoSend 分支
           等待落地（有界超时在注入实现内），float / native 非等待。失败/超时零阻断；
           服务缺席 toast 一次。降级路径无新会话 id，天然不经过这里（确定性跳过登记）。 */
        if (button?.team === true) {
          const teamPending = armTeam({ sessionId, wait: submit });
          if (teamPending !== null) await teamPending;
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
