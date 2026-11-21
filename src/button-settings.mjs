/**
 * 设置页按钮控制器（add-cosmos-proposal-actions 5.1–5.3 / spec cosmos-button-settings
 * 「设置页『快捷动作』标签页」「按钮排序交互与顺序语义」；add-cosmos-constellation-actions 5.1
 * 参数化装填星座口径）。
 *
 * 独立纯逻辑模块——client.jsx 的设置页组件消费，test/settings-panel-smoke.mjs 直测。
 * 暂存-保存模型：编辑只改本地草稿，「保存」才经设置作用域写入配置层；「放弃修改」
 * 回退草稿；「重置」清掉用户层该节回退组合层。
 *
 * **参数化（profile）**：`{ section, supportsPrepend, supportsJump, supportsPreState, draftOf, issue }`。
 * 缺省 profile MUST 恒等既有「快捷动作」行为（节键 `buttons`、含 prepend/jump/preState、
 * `buttonDraftOf`/`buttonIssue`——回归冒烟锁定）；星座动作用 `CONSTELLATION_PROFILE`
 * （节键 `constellationButtons`、无 prepend/jump/preState、`constButtonDraftOf`/`constButtonIssue`），
 * 两个实例各自独立、互不读写。
 *
 * 锁定项：`newSession` 普通行恒 true、`preState === "proto"` 行恒 false（星胚动作固定
 * 发往探索会话；UI 只显示、不提供修改/取消路径），保存写在归一化里。
 * 每按钮可选 `jumpNewSession`（「执行后跳转」，缺省 true）：行内可切换、参与暂存-保存。
 * 每按钮可选 `preState`（「前置状态」，缺省不落键）：行内下拉、参与暂存-保存；proto 行
 * 「提示词在前」不落键（发送链路恒忽略 prepend）。
 * 每按钮可选 `shortcut`（add-cosmos-shortcuts 3.3：键盘快捷键，缺省不落键）：行内下拉，
 * 候选 = 按钮键域枚举（`shortcuts.mjs`，与设置页下拉同源）；漂移值原样回显「不可用」并
 * 由 `buttonIssue` / `constButtonIssue` 拒绝保存；**跨域并集查重**由注入的 `crossIssue`
 * 回调在保存门（publish 计算的 invalid / save 前置判据）执行（`shortcutsIssue` 风格）。
 */
import { MAX_BUTTONS, PRE_STATES } from "./buttons.mjs";
import { MAX_CONST_BUTTONS } from "./const-buttons.mjs";
import { buttonModelOf } from "./actions.mjs";
import { isButtonShortcut } from "./shortcuts.mjs";
import { isEmbryoDismissButton } from "./buttons.mjs";

/**
 * 按钮草稿条目构造（键序固定 name → prompt → autoSend → newSession → jumpNewSession →
 * prepend → model → preState → shortcut；`buttonsEqual` 的 JSON 串比较依赖键序稳定）。与宿主
 * 归一化同口径：未勾选前插 MUST NOT 输出 prepend 键、跳转开启（缺省）MUST NOT 输出
 * jumpNewSession 键、未绑定 MUST NOT 输出 model 键、未选前置状态 MUST NOT 输出
 * preState 键、未选快捷键 MUST NOT 输出 shortcut 键。`preState: "proto"` 行：`newSession`
 * 恒 false（星胚动作固定发往探索会话），且 `prepend` 无语义（星胚消息无 @引用）→ 草稿不落该键。
 * 漂移值（枚举外字符串）原样保留在草稿（设置页回显「不可用」，保存由 `buttonIssue` 拒绝）。
 * @param {object} source
 * @returns {object}
 */
export function buttonDraftOf(source) {
  const rawPreState = typeof source?.preState === "string" && source.preState.trim() ? source.preState.trim() : undefined;
  const isProto = rawPreState === "proto";
  const entry = {
    name: typeof source?.name === "string" ? source.name : "",
    prompt: typeof source?.prompt === "string" ? source.prompt : "",
    autoSend: source?.autoSend === true,
    /* 语义常量：普通行恒 true；proto 行例外恒 false（设置行锁定态，不提供更改路径）。 */
    newSession: !isProto
  };
  /* 每按钮「执行后跳转」：缺省 true；仅显式关闭时落键（存储最小形）。 */
  if (source?.jumpNewSession === false) entry.jumpNewSession = false;
  /* proto 行（星胚）不落 prepend：消息无 @提案引用，「先后」无语义（D15）。 */
  if (!isProto && source?.prepend === true) entry.prepend = true;
  const model = buttonModelOf(source?.model);
  if (model !== undefined) entry.model = model;
  if (rawPreState !== undefined) entry.preState = rawPreState;
  /* 快捷键（add-cosmos-shortcuts 3.3）：仅非空字符串落键；漂移值原样保留供回显。 */
  const rawShortcut = typeof source?.shortcut === "string" && source.shortcut.trim() ? source.shortcut.trim() : undefined;
  if (rawShortcut !== undefined) entry.shortcut = rawShortcut;
  /* 星胚直执行键（add-cosmos-embryo-dismiss-button 5.3）：仅 true 落键（键序最末）；
     漂移值（非 proto 行 + true）原样保留供回显，保存由 `buttonIssue` 拒绝。 */
  if (source?.embryoDismiss === true) entry.embryoDismiss = true;
  return entry;
}

/**
 * 校验一份按钮草稿；返回 "" 表示通过，否则返回错误词典键（UI 直接 t(key)）。
 * @param {Array<object>} list
 * @returns {string}
 */
export function buttonIssue(list) {
  const seen = new Set();
  for (const button of Array.isArray(list) ? list : []) {
    const name = String(button?.name ?? "").trim();
    if (!name) return "buttonNameRequired";
    if (seen.has(name)) return "buttonDup";
    seen.add(name);
    /* 直执行键（add-cosmos-embryo-dismiss-button 5.3）：判据用 preState 字面值（校验前后
       一致），`true` 仅在的 proto 行合法；非布尔值一律拒绝。 */
    const dismiss = button?.embryoDismiss;
    const directDraft = dismiss === true && typeof button?.preState === "string" && button.preState.trim() === "proto";
    /* prompt 非空校验的唯一豁免 = 直执行行（trim 后空串合法；保存按 schema 恒落 ""）。 */
    if (!String(button?.prompt ?? "").trim() && !directDraft) return "buttonPromptRequired";
    /* 前置状态：仅枚举内字符串合法（漂移值可回显，但保存 MUST 拒绝并保留草稿修正）。 */
    const preState = button?.preState;
    if (preState !== undefined && preState !== null) {
      if (typeof preState !== "string" || !PRE_STATES.includes(preState.trim())) return "buttonPreStateInvalid";
    }
    const isProto = typeof preState === "string" && preState.trim() === "proto";
    /* 锁定项守卫：普通行恒 true；proto 行例外恒 false（星胚动作固定发往探索会话）。
       缺省/null 按合法处理（旧草稿零迁移），其余非期望值一律拒绝。 */
    if (!isProto && button?.newSession !== undefined && button?.newSession !== null && button?.newSession !== true) {
      return "buttonNewSessionFixed";
    }
    /* 星胚直执行键：非布尔拒绝；非 proto 行携带 true 拒绝（设置页在前置状态切走时自动
       清勾，此处为手工编辑漂移的兜底）。 */
    if (dismiss !== undefined && dismiss !== null && typeof dismiss !== "boolean") {
      return "buttonEmbryoDismissInvalid";
    }
    if (dismiss === true && !isProto) return "buttonEmbryoDismissProtoOnly";
    /* 快捷键：仅按钮键域枚举内字符串合法（漂移值可回显，但保存 MUST 拒绝）；空串按
       「无」（未提供）处理，与宿主 normalize 口径一致。 */
    const shortcut = button?.shortcut;
    if (shortcut !== undefined && shortcut !== null) {
      if (typeof shortcut !== "string") return "buttonShortcutInvalid";
      const trimmed = shortcut.trim();
      if (trimmed !== "" && !isButtonShortcut(trimmed)) return "buttonShortcutInvalid";
    }
  }
  if ((Array.isArray(list) ? list : []).length > MAX_BUTTONS) return "tooManyButtons";
  return "";
}

/**
 * 星座按钮草稿条目构造（键序固定 name → prompt → autoSend → newSession → model →
 * shortcut；**恒无 prepend 键**——星座动作无「提示词在前」语义）。与
 * `normalizeConstButtons` 同口径：未绑定 MUST NOT 输出 model 键、未选快捷键 MUST NOT
 * 输出 shortcut 键（漂移值原样保留供回显）。
 * @param {object} source
 * @returns {object}
 */
export function constButtonDraftOf(source) {
  const entry = {
    name: typeof source?.name === "string" ? source.name : "",
    prompt: typeof source?.prompt === "string" ? source.prompt : "",
    autoSend: source?.autoSend === true,
    /* 语义常量：草稿恒 true（设置行呈现锁定态，不提供取消路径）。 */
    newSession: true
  };
  const model = buttonModelOf(source?.model);
  if (model !== undefined) entry.model = model;
  const rawShortcut = typeof source?.shortcut === "string" && source.shortcut.trim() ? source.shortcut.trim() : undefined;
  if (rawShortcut !== undefined) entry.shortcut = rawShortcut;
  return entry;
}

/**
 * 校验一份星座按钮草稿；返回 "" 表示通过，否则返回错误词典键。
 * 额外口径：`prepend` 键不允许出现（spec「prepend 键拒绝」——UI 不产生该字段，
 * 但草稿可能来自加载的配置层，故在保存前显式拦截）；`shortcut` 仅按钮键域枚举合法。
 * @param {Array<object>} list
 * @returns {string}
 */
export function constButtonIssue(list) {
  const seen = new Set();
  for (const button of Array.isArray(list) ? list : []) {
    const name = String(button?.name ?? "").trim();
    if (!name) return "constButtonNameRequired";
    if (seen.has(name)) return "constButtonDup";
    seen.add(name);
    if (!String(button?.prompt ?? "").trim()) return "constButtonPromptRequired";
    if (button?.prepend !== undefined) return "constButtonPrependRejected";
    if (button?.newSession !== undefined && button?.newSession !== null && button?.newSession !== true) {
      return "constButtonNewSessionFixed";
    }
    const shortcut = button?.shortcut;
    if (shortcut !== undefined && shortcut !== null) {
      if (typeof shortcut !== "string") return "constButtonShortcutInvalid";
      const trimmed = shortcut.trim();
      if (trimmed !== "" && !isButtonShortcut(trimmed)) return "constButtonShortcutInvalid";
    }
  }
  if ((Array.isArray(list) ? list : []).length > MAX_CONST_BUTTONS) return "tooManyConstButtons";
  return "";
}

/**
 * 星座动作控制器 profile（设置页「星座动作」标签页注入用）。
 * 与提案动作 profile 的差异只有：节键、无 prepend、草稿/校验口径。
 */
export const CONSTELLATION_PROFILE = Object.freeze({
  section: "constellationButtons",
  supportsPrepend: false,
  /* 星座动作链路恒「整页保持打开」（不跳转），无逐按钮跳转语义。 */
  supportsJump: false,
  /* 星座动作无提案选中上下文 → 无「前置状态」控件（spec「星座动作行不呈现」）。 */
  supportsPreState: false,
  /* 星胚直执行需要 proto 前置状态 + 提案选中上下文 → 星座行无该控件。 */
  supportsEmbryoDismiss: false,
  draftOf: constButtonDraftOf,
  issue: constButtonIssue
});

/**
 * 排序纯函数：把第 from 条移到第 to 位（splice 换位）。索引是排序期唯一可靠标识
 * （草稿 name 可空/可改/可重名），不依赖名称内容；不 mutate 输入，恒返回新数组；
 * 越界或相等 → 等价原序的新数组（空操作）。
 * @param {Array} list
 * @param {number} from
 * @param {number} to
 * @returns {Array}
 */
export function moveButton(list, from, to) {
  const base = Array.isArray(list) ? list : [];
  if (!Number.isInteger(from) || !Number.isInteger(to)) return base.slice();
  if (from === to || from < 0 || from >= base.length || to < 0 || to >= base.length) return base.slice();
  const next = base.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** 缺省 profile = 「快捷动作」既有行为（零改动基线；回归冒烟锁定）。 */
const DEFAULT_PROFILE = {
  section: "buttons",
  supportsPrepend: true,
  supportsJump: true,
  supportsPreState: true,
  supportsEmbryoDismiss: true,
  draftOf: buttonDraftOf,
  issue: buttonIssue,
  maxEntries: MAX_BUTTONS
};

const buttonsEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * 按钮设置控制器（由 profile 参数化；缺省 = 「快捷动作」既有行为）。
 * @param {object} scope 归一后的设置作用域（通道作用域 / 合成只读）
 * @param {{section?: string, supportsPrepend?: boolean, supportsJump?: boolean,
 *          supportsPreState?: boolean, draftOf?: Function, issue?: Function,
 *          crossIssue?: Function, maxEntries?: number}} [profile]
 *        节键与草稿/校验口径；`crossIssue(draft)` 为可选**跨域附加校验**
 *        （add-cosmos-shortcuts 3.3：快捷键并集查重，返回 "" 或词典键），与单列表
 *        `issue` 同一保存门（publish 的 invalid 判定与 save 前置判据共用）。
 * @returns {object} face：getSnapshot/subscribe + add/remove/edit/move/reset/save/discard/dispose
 */
export function createButtonSettingsController(scope, profile) {
  const raw = profile !== null && typeof profile === "object" ? profile : {};
  const section = typeof raw.section === "string" && raw.section ? raw.section : DEFAULT_PROFILE.section;
  const supportsPrepend = raw.supportsPrepend !== false;
  const supportsJump = raw.supportsJump !== false;
  const supportsPreState = raw.supportsPreState !== false;
  /* 星胚直执行复选框（add-cosmos-embryo-dismiss-button 5.1）：仅快捷动作 profile 提供。 */
  const supportsEmbryoDismiss = raw.supportsEmbryoDismiss !== false;
  const draftOf = typeof raw.draftOf === "function" ? raw.draftOf : DEFAULT_PROFILE.draftOf;
  const issue = typeof raw.issue === "function" ? raw.issue : DEFAULT_PROFILE.issue;
  const crossIssue = typeof raw.crossIssue === "function" ? raw.crossIssue : null;
  const maxEntries = Number.isInteger(raw.maxEntries) && raw.maxEntries > 0 ? raw.maxEntries : DEFAULT_PROFILE.maxEntries;
  const listeners = new Set();
  let state = null;
  let staged = null; // Array | null：按钮草稿；null = 跟随生效值
  let saving = false;
  let failed = false;

  /** 单列表校验 + 跨域附加校验（后者缺席/抛错按无附加错误处理，不阻断既有校验链）。 */
  const issueOf = (draft) => {
    const local = issue(draft);
    if (local !== "") return local;
    if (crossIssue === null) return "";
    try {
      const extra = crossIssue(draft);
      return typeof extra === "string" ? extra : "";
    } catch (error) {
      console.error("[dsh-v-cosmos] button cross-issue failed:", error);
      return "";
    }
  };

  /** 读取视图里**本控制器所属节**的列表并投影为草稿（只读自己的节）。 */
  const listOf = (view) => {
    if (!view || typeof view !== "object" || !Array.isArray(view[section])) return [];
    return view[section]
      .filter((button) => button && typeof button === "object" && typeof button.name === "string" && typeof button.prompt === "string")
      .map((button) => draftOf(button));
  };

  const publish = () => {
    const snapshot = scope.getSnapshot();
    const effectiveButtons = listOf(snapshot?.value);
    const draft = staged === null ? effectiveButtons.map((button) => draftOf(button)) : staged;
    const invalidReason = issueOf(draft);
    const dirty = staged !== null && !buttonsEqual(staged, effectiveButtons);
    const user = snapshot?.user;
    state = Object.freeze({
      status: typeof snapshot?.status === "string" ? snapshot.status : "ready",
      available: snapshot?.status !== "unavailable",
      writable: snapshot?.writable === true,
      mode: typeof snapshot?.mode === "string" ? snapshot.mode : "host",
      saving,
      failed,
      dirty,
      invalid: invalidReason !== "",
      invalidReason,
      buttonsDraft: draft,
      buttonsDirty: dirty,
      buttonsInvalid: invalidReason !== "",
      buttonsInvalidReason: invalidReason,
      /* 覆盖标记：用户层存在本节（含空数组）→ 显示「重置」入口。 */
      buttonsOverridden: user !== null && typeof user === "object" && Array.isArray(user[section]),
      effectiveButtons,
      baseButtonsCount: listOf(snapshot?.base).length,
      revision: snapshot?.revision
    });
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        console.error("[dsh-v-cosmos] button settings listener failed:", error);
      }
    }
  };

  const draftBase = () => {
    if (staged !== null) return staged;
    return listOf(scope.getSnapshot()?.value).map((button) => draftOf(button));
  };

  const commitDraft = (next) => {
    staged = next;
    failed = false;
    publish();
  };

  const unsubscribe = scope.subscribe(publish);
  publish();

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** 新增一条空按钮草稿（追加到数组尾部——顺序即展示顺序）。 */
    addButton() {
      const base = draftBase();
      if (base.length >= maxEntries) return;
      commitDraft([...base, draftOf({ name: "", prompt: "", autoSend: false })]);
    },
    /** 删除第 index 条草稿。 */
    removeButton(index) {
      commitDraft(draftBase().filter((_button, i) => i !== index));
    },
    /**
     * 编辑第 index 条的字段（name/prompt/autoSend/jumpNewSession/prepend/model/preState/
     * shortcut/embryoDismiss）。
     * `model`/`prepend`/`jumpNewSession`/`preState`/`shortcut`/`embryoDismiss` 走 draftOf
     * 特判：取消勾选/解绑/清空 MUST 删键（否则草稿残留显式 false/undefined，与存储条目不再
     * 逐字同形，dirty 永不回清）。`prepend`/`jumpNewSession`/`preState`/`embryoDismiss` 在
     * 对应 `supports*: false` 的 profile（星座动作）里是空操作。
     *
     * 两个联动纪律（add-cosmos-embryo-dismiss-button 5.2）：
     *  - 勾选 `embryoDismiss` → 草稿提示词**即时清空**（直执行行不残留死文案；保存落
     *    `prompt: ""`），取消勾选只删键（提示词控件回到可编辑，文案不回填）；
     *  - `preState` 切走「待创建（星胚）」→ 直执行勾选自动清除（保存面 `buttonIssue`
     *    归一化拒绝兜底）。
     */
    editButton(index, field, value) {
      if (field === "prepend" && !supportsPrepend) return;
      if (field === "jumpNewSession" && !supportsJump) return;
      if (field === "preState" && !supportsPreState) return;
      if (field === "embryoDismiss" && !supportsEmbryoDismiss) return;
      commitDraft(draftBase().map((button, i) => {
        if (i !== index) return button;
        if (field === "model") return draftOf({ ...button, model: value });
        if (field === "prepend") return draftOf({ ...button, prepend: value });
        if (field === "preState") {
          /* 前置状态切走 proto：直执行勾选自动清勾（草稿态即时联动）。 */
          const keepDismiss = typeof value === "string" && value.trim() === "proto" ? button.embryoDismiss : undefined;
          return draftOf({ ...button, preState: value, embryoDismiss: keepDismiss });
        }
        /* 星胚直执行（5.2）：勾选时即时清空提示词；取消勾选仅删键。 */
        if (field === "embryoDismiss") {
          if (value === true) return draftOf({ ...button, embryoDismiss: true, prompt: "" });
          return draftOf({ ...button, embryoDismiss: undefined });
        }
        /* 快捷键（add-cosmos-shortcuts 3.3）：值 = 规范形字符串，`undefined`/`""` = 无
           （草稿删键，存储最小形）；漂移值原样保留供回显。 */
        if (field === "shortcut") return draftOf({ ...button, shortcut: value });
        /* 锁定项：newSession 方向的唯一决定因素是 preState（proto → false，其余 → true）。 */
        if (field === "newSession") return draftOf(button);
        return draftOf({ ...button, [field]: value });
      }));
    },
    /** 移动第 from 条到第 to 位（排序：只换位不增删；越界/相等为空操作）。 */
    moveButton(from, to) {
      commitDraft(moveButton(draftBase(), from, to));
    },
    /** 重置：清掉用户层本节，回退组合层配置（覆盖标记消失）。 */
    async resetButtons() {
      if (state?.writable !== true) return false;
      staged = null;
      failed = false;
      saving = true;
      publish();
      try {
        await scope.unset(section);
        return true;
      } catch {
        failed = true;
        return false;
      } finally {
        saving = false;
        publish();
      }
    },
    /** 写全部暂存草稿；失败保留草稿供修正（宿主是唯一裁决者）。 */
    async save() {
      const current = state;
      if (!current || !current.writable || !current.dirty) return false;
      /* 保存前**同步重算**校验（add-cosmos-shortcuts 3.3/D9）：跨域冲突可能来自另一列表
         的草稿变化——controller 的 `invalid` 只在本控制器 publish 时刷新，可能滞后。此处
         以当前草稿现算 `issueOf`，冲突/非法一律拒绝并 publish 出错误态（UI 行内提示）。 */
      const before = draftBase();
      const recomputed = issueOf(before);
      if (recomputed !== "") {
        failed = false;
        publish();
        return false;
      }
      saving = true;
      publish();
      try {
        const entries = before.map((button) => {
          /* 前置状态：仅本 profile 支持时落键；空值不落键（存储最小形）。 */
          const preState = supportsPreState && typeof button.preState === "string" && button.preState.trim()
            ? button.preState.trim()
            : undefined;
          const isProto = preState === "proto";
          const entry = {
            name: String(button.name ?? "").trim(),
            prompt: String(button.prompt ?? "").trim(),
            autoSend: button.autoSend === true,
            /* 锁定项：普通行恒写出 true；proto 行恒 false（spec 归一化同口径）。 */
            newSession: !isProto
          };
          if (supportsJump && button.jumpNewSession === false) entry.jumpNewSession = false;
          /* proto 行不写 prepend：星胚消息无 @引用，「先后」无语义（执行链路亦恒忽略）。 */
          if (supportsPrepend && !isProto && button.prepend === true) entry.prepend = true;
          const model = buttonModelOf(button.model);
          if (model !== undefined) entry.model = model;
          if (preState !== undefined) entry.preState = preState;
          /* 快捷键（add-cosmos-shortcuts 3.3）：键序尾部；无键不落（存储最小形）。 */
          const shortcut = typeof button.shortcut === "string" ? button.shortcut.trim() : "";
          if (shortcut !== "") entry.shortcut = shortcut;
          /* 星胚直执行键（add-cosmos-embryo-dismiss-button 5.3）：仅 proto 行写出（键序
             最末）；直执行行提示词按 schema 豁免恒落空串（控件已即时清空，双保险）。 */
          if (isProto && button.embryoDismiss === true) entry.embryoDismiss = true;
          return entry;
        });
        await scope.set(section, entries);
        staged = null;
        failed = false;
        return true;
      } catch {
        /* CAS 409 / 只读 / 写拒绝：草稿保留，UI 走「保存未生效，请重试」。 */
        failed = true;
        return false;
      } finally {
        saving = false;
        publish();
      }
    },
    /** 放弃修改：草稿回退到生效值。 */
    discard() {
      staged = null;
      failed = false;
      publish();
    },
    dispose() {
      unsubscribe?.();
      listeners.clear();
    }
  };
}
