/**
 * 动作按钮配置模型（add-cosmos-proposal-actions 2.2 / spec cosmos-actions「按钮配置模型」）。
 *
 * 独立纯逻辑模块——宿主半区（configstore 节归一化 + 设置命名空间校验）与浏览器半区
 * （设置页草稿校验 / 动作条投影）共用，test/buttons-schema-smoke.mjs 直测。
 *
 * 模型：`{ name, prompt, autoSend, newSession, jumpNewSession?, prepend?, model?, preState?, shortcut?, embryoDismiss?, team? }`
 *  - `name`   显示名（非空，trim 后去重；允许中文，不套用 commands 的小写正则）；
 *  - `prompt` 提示词（非空——**唯一豁免**：`embryoDismiss` 为 `true` 的直执行条目允许为空，
 *    trim 后空串合法且归一化恒输出 `prompt: ""` 保持键序恒定；直执行链路零消费 prompt）；
 *  - `autoSend` **必填布尔，归一化恒输出**：缺省/null 视为 false，其余非布尔值拒绝；
 *  - `newSession` **语义常量恒 true**（「新增会话」为固定模式）：缺失/null 补 true
 *    （旧数据零迁移），其余非 true 值拒绝；归一化恒输出 `newSession: true`；
 *    **唯一例外**：`preState: "proto"`（星胚动作）固定发往探索会话 → 归一化恒输出
 *    `newSession: false`，显式 `true` 保存被拒绝（add-cosmos-action-prestate-gate）；
 *  - `jumpNewSession` 可选布尔：**每个按钮自己的「执行后跳转」**（缺省 true = 跳转）。
 *    **仅 false 时输出该键**（缺省/true 视为未提供 → 存储最小形，旧数据零迁移）；
 *  - `prepend` 可选布尔：**仅 true 时输出该键**（false/null/缺省 = 未提供 → 存储最小形）；
 *    语义为「提示词与 @提案引用」的先后（与 skill-links 同名不同义；proto 行无语义——
 *    星胚消息不含 @ 引用，执行链路恒忽略）；
 *  - `model` 可选 `{ provider, model, reasoningEffort? }`：形状校验后原样透传，
 *    未提供时 MUST NOT 输出该键；
 *  - `preState` 可选枚举 `proto | created | reviewed | executed`（提案前置状态）：
 *    **仅设置时输出该键**（缺省/null = 未提供），枚举外值保存拒绝；**无唯一性约束**
 *    （同一状态可配置多个按钮）。读面容错模式（`tolerateUnknownPreState`）保留未知
 *    字符串原值（手工编辑漂移 → 设置页原样回显，保存路径恒严格）；
 *  - `shortcut` 可选键盘快捷键（add-cosmos-shortcuts 3.1 / spec cosmos-actions「按钮配置
 *    模型」）：值为**按钮键域**枚举（`shortcuts.mjs`：`Digit0`–`Digit9` + `F2/F4/F8/F9`）。
 *    **仅设置时输出该键**（缺省/null/`""` = 未提供 → 存储最小形「无快捷键」）；池外值 /
 *    组合键 / 非字符串保存拒绝。跨条目及与全局键的并集查重由**保存面**统一执行
 *    （`shortcuts.mjs` `shortcutsIssue`），宿主单节 normalize 保持「单条枚举校验」口径。
 *  - `embryoDismiss` 可选布尔（add-cosmos-embryo-dismiss-button 1.x / spec cosmos-actions
 *    「按钮配置模型」）：**星胚直执行模式**——仅布尔 `true` ∧ `preState === "proto"` 时输出
 *    该键（键序最末）；`false`/`null`/缺省按未提供处理（不落键不拒绝，与 `prepend` 同款
 *    布尔最小形纪律）；布尔 `true` 出现在非 proto / 缺省 `preState` 行保存拒绝；其余非布尔
 *    值保存拒绝。读面容错模式（`tolerateUnknownEmbryoDismiss`）保留漂移值不回写。
 *  - `team` 可选布尔（add-cosmos-agent-team-toggle 2.1 / spec cosmos-actions「按钮团队启用键」）：
 *    **智能体团队启用**（目标会话团队模式的按按钮开关）——**仅布尔 `true` 时输出该键**
 *    （键序最末，`embryoDismiss` 之后）；`false`/`null`/缺省按未提供处理（不落键不拒绝，
 *    存储最小形，语义 = 默认关）；其余非布尔值保存拒绝。读面容错模式
 *    （`tolerateUnknownTeam`）保留漂移原值不回写（设置页回显「不可用」并拒绝保存）。
 *
 * 键序固定 name → prompt → autoSend → newSession → jumpNewSession → prepend → model
 * → preState → shortcut → embryoDismiss → team（`preState` / `shortcut` / `embryoDismiss` /
 * `team` 依次追加尾部，既有条目序列化逐字节不变；客户端 `JSON.stringify` 比较依赖键序稳定）。
 */

import { SHORTCUT_BUTTON_KEYS, isButtonShortcut } from "./shortcuts.mjs";

/** 前置状态枚举（spec「按钮配置模型」；顺序即设置页下拉顺序）。 */
export const PRE_STATES = Object.freeze(["proto", "created", "reviewed", "executed"]);

/** 前置状态合法值判定（纯函数；非字符串/空串/枚举外一律 false）。 */
export function isPreState(value) {
  return typeof value === "string" && PRE_STATES.includes(value);
}

/** 按钮条数上限（spec：超出保存被拒绝）。 */
export const MAX_BUTTONS = 32;
/** 单条 prompt 字符上限（与 skill-links 同量级；防手滑粘贴巨型文本进配置文件）。 */
export const MAX_PROMPT_CHARS = 20_000;

/**
 * 校验并归一化按钮的可选模型绑定：provider/model trim 后非空；reasoningEffort 缺省或
 * 非空字符串。输出键序固定 provider → model → reasoningEffort，无等级时不输出该键。
 * 形状非法直接抛 TypeError（注册与写入校验同走这条路径）。
 * @param {unknown} raw
 * @param {string} name 按钮显示名（错误信息用）
 * @returns {{provider: string, model: string, reasoningEffort?: string}|undefined}
 *          undefined = 未绑定（跟随会话默认）
 */
export function normalizeButtonModel(raw, name) {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError(`button "${name}" model must be an object`);
  }
  const provider = typeof raw.provider === "string" ? raw.provider.trim() : "";
  const model = typeof raw.model === "string" ? raw.model.trim() : "";
  if (!provider) throw new TypeError(`button "${name}" model.provider must be a non-empty string`);
  if (!model) throw new TypeError(`button "${name}" model.model must be a non-empty string`);
  if (raw.reasoningEffort === undefined || raw.reasoningEffort === null) return { provider, model };
  if (typeof raw.reasoningEffort !== "string") {
    throw new TypeError(`button "${name}" model.reasoningEffort must be a string`);
  }
  const reasoningEffort = raw.reasoningEffort.trim();
  if (!reasoningEffort) throw new TypeError(`button "${name}" model.reasoningEffort must not be empty`);
  return { provider, model, reasoningEffort };
}

/**
 * 归一化按钮列表。
 *
 * 接受数组或 `{ buttons: [...] }`；完全空条目（name 与 prompt 皆空）剔除、半空条目报错。
 * 返回条目恒含 `autoSend`（布尔）与 `newSession`（proto 行 false、其余 true）；
 * `jumpNewSession: false` 仅在该按钮显式关闭跳转时输出；`preState` 仅在设置时输出。
 *
 * 去重口径（spec「上限与去重拒绝」）：trim 后 name 相同 → **抛错**（保存被拒绝并提示
 * 「名称重复」），不做「先到先得静默丢弃」——与 skill-links 的旧口径差异是本 change
 * 的显式决策（spec 场景要求拒绝而非静默）。`preState` 不参与去重。
 *
 * @param {unknown} raw
 * @param {{tolerateUnknownPreState?: boolean, tolerateUnknownShortcut?: boolean,
 *          tolerateUnknownEmbryoDismiss?: boolean, tolerateUnknownTeam?: boolean}} [options]
 *        读面容错（默认严格）：`tolerateUnknownPreState` = true → 未知 `preState` 字符串原样
 *        保留（不回写、不丢弃该条）；`tolerateUnknownShortcut` = true → 池外 `shortcut`
 *        字符串原样保留（设置页回显「不可用」）；`tolerateUnknownEmbryoDismiss` = true →
 *        非 proto 行上的 `embryoDismiss: true` 漂移值原样保留（设置页回显「不可用」并拒绝
 *        保存）；`tolerateUnknownTeam` = true → 非布尔 `team` 漂移值原样保留（同上）。
 *        保存路径 MUST NOT 使用任一模态（写入校验恒严格，见 configstore.writeSections）。
 * @returns {Array<{name: string, prompt: string, autoSend: boolean, newSession: boolean,
 *          jumpNewSession?: false, prepend?: true,
 *          model?: {provider: string, model: string, reasoningEffort?: string},
 *          preState?: string, shortcut?: string, embryoDismiss?: true, team?: true}>}
 * @throws {TypeError} 形状非法 / 名称重复 / 超上限
 */
export function normalizeButtons(raw, options = {}) {
  const tolerateUnknownPreState = options?.tolerateUnknownPreState === true;
  const tolerateUnknownShortcut = options?.tolerateUnknownShortcut === true;
  const tolerateUnknownEmbryoDismiss = options?.tolerateUnknownEmbryoDismiss === true;
  const tolerateUnknownTeam = options?.tolerateUnknownTeam === true;
  let list = [];
  if (Array.isArray(raw)) list = raw;
  else if (raw && typeof raw === "object" && Array.isArray(raw.buttons)) list = raw.buttons;
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (!item || typeof item !== "object") throw new TypeError("buttons contains a non-object entry");
    if (typeof item.name !== "string") throw new TypeError("button name must be a string");
    if (typeof item.prompt !== "string") throw new TypeError(`button "${item.name}" prompt must be a string`);
    const name = item.name.trim();
    const prompt = item.prompt.trim();
    if (!name && !prompt) continue; // 完全空条目剔除（半空条目仍校验）
    if (!name) throw new TypeError("button name must not be empty");
    /* preState（add-cosmos-action-prestate-gate）：仅设置时输出（尾部键序）；枚举外
       保存拒绝。读面容错模式保留未知字符串原值（设置页漂移回显；门控永不命中）。
       解析前置于 prompt 校验：`embryoDismiss` 的 proto 绑定与 prompt 豁免都要用它。 */
    let preState;
    let driftedPreState = false;
    if (item.preState !== undefined && item.preState !== null) {
      if (typeof item.preState !== "string") {
        throw new TypeError(`button "${name}" preState must be a string`);
      }
      const value = item.preState.trim();
      if (!value) throw new TypeError(`button "${name}" preState must not be empty`);
      if (PRE_STATES.includes(value)) preState = value;
      else if (tolerateUnknownPreState) {
        preState = value;
        driftedPreState = true;
      } else {
        throw new TypeError(`button "${name}" preState must be one of ${PRE_STATES.join(", ")}`);
      }
    }
    const isProto = preState === "proto";
    /* 星胚直执行键（add-cosmos-embryo-dismiss-button 1.1–1.4）：仅布尔 true ∧ proto 时
       输出（键序最末）；false/null/缺省按未提供处理（不落键不拒绝）；其余非布尔值保存
       拒绝；非 proto（或缺省 preState）行携带 true → 保存拒绝，读面容错模式
       （`tolerateUnknownEmbryoDismiss`）原样保留漂移值（设置页回显「不可用」）。 */
    const rawDismiss = item.embryoDismiss;
    if (rawDismiss !== undefined && rawDismiss !== null && typeof rawDismiss !== "boolean") {
      throw new TypeError(`button "${name}" embryoDismiss must be a boolean`);
    }
    const wantsDismiss = rawDismiss === true;
    if (wantsDismiss && !isProto && !tolerateUnknownEmbryoDismiss) {
      throw new TypeError(
        `button "${name}" embryoDismiss: 直达移除仅限前置状态为待创建（星胚）的按钮`
      );
    }
    /* prompt 非空校验的**唯一豁免**（1.3）：直执行按钮点击即删锚点，链路零消费 prompt
       → trim 后空串合法，归一化恒输出 `prompt: ""`（键序不变）。其余组合逐字不变。 */
    if (!prompt && !(wantsDismiss && (isProto || tolerateUnknownEmbryoDismiss))) {
      throw new TypeError(`button "${name}" prompt must not be empty`);
    }
    if (prompt.length > MAX_PROMPT_CHARS) {
      throw new TypeError(`button "${name}" prompt exceeds ${MAX_PROMPT_CHARS} chars`);
    }
    if (item.autoSend !== undefined && item.autoSend !== null && typeof item.autoSend !== "boolean") {
      throw new TypeError(`button "${name}" autoSend must be a boolean`);
    }
    /* newSession：语义常量恒 true；proto 行例外——固定发往探索会话，恒 false，
       显式 true 拒绝。读面容错模式下漂移条目放宽校验（保留原标记，供回显）。 */
    let newSession;
    if (isProto) {
      if (item.newSession !== undefined && item.newSession !== null && item.newSession !== false) {
        throw new TypeError(`button "${name}" newSession must be false for preState "proto"`);
      }
      newSession = false;
    } else if (driftedPreState) {
      /* 漂移条目（preState 非枚举）：newSession 原样保留（布尔），不回写不静默修正。 */
      newSession = item.newSession === false ? false : true;
    } else {
      if (item.newSession !== undefined && item.newSession !== null && item.newSession !== true) {
        throw new TypeError(`button "${name}" newSession must be true (fixed "new session" mode)`);
      }
      newSession = true;
    }
    /* jumpNewSession：每按钮独立的「执行后跳转」，缺省 true；仅布尔可用。 */
    if (item.jumpNewSession !== undefined && item.jumpNewSession !== null && typeof item.jumpNewSession !== "boolean") {
      throw new TypeError(`button "${name}" jumpNewSession must be a boolean`);
    }
    if (item.prepend !== undefined && item.prepend !== null && typeof item.prepend !== "boolean") {
      throw new TypeError(`button "${name}" prepend must be a boolean`);
    }
    const model = normalizeButtonModel(item.model, name);
    /* 快捷键（add-cosmos-shortcuts 3.1）：仅按钮键域枚举合法；缺省/null/空串按未提供
       （存储最小形，「无快捷键」为缺省）；池外值保存拒绝。读面容错模式
       （`tolerateUnknownShortcut`）保留池外字符串原值——设置页据「不可用」回显并拒绝保存，
       分发器只认池内值（漂移值不可触发）。 */
    let shortcut;
    if (item.shortcut !== undefined && item.shortcut !== null) {
      if (typeof item.shortcut !== "string") {
        throw new TypeError(`button "${name}" shortcut must be a string`);
      }
      const value = item.shortcut.trim();
      if (value !== "") {
        if (isButtonShortcut(value)) shortcut = value;
        else if (tolerateUnknownShortcut) shortcut = value;
        else {
          throw new TypeError(
            `button "${name}" shortcut must be one of ${SHORTCUT_BUTTON_KEYS.join(", ")}`
          );
        }
      }
    }
    /* 团队启用键（add-cosmos-agent-team-toggle 2.1 / spec「按钮团队启用键」）：仅布尔
       true 落键（键序最末）；false/null/缺省按未提供处理（不落键不拒绝，语义 = 默认关）；
       其余非布尔值保存拒绝。读面容错模式（`tolerateUnknownTeam`）保留漂移原值不回写。 */
    let team;
    const rawTeam = item.team;
    if (rawTeam !== undefined && rawTeam !== null) {
      if (typeof rawTeam === "boolean") {
        if (rawTeam === true) team = true;
      } else if (tolerateUnknownTeam) {
        team = rawTeam;
      } else {
        throw new TypeError(`button "${name}" team 智能团队开关必须为布尔值 (team must be a boolean)`);
      }
    }
    if (seen.has(name)) throw new TypeError(`button name "${name}" is duplicated`);
    seen.add(name);
    const entry = { name, prompt, autoSend: item.autoSend === true, newSession };
    /* 存储最小形：仅「不跳转」落键（缺省/true 不输出）。 */
    if (item.jumpNewSession === false) entry.jumpNewSession = false;
    if (item.prepend === true) entry.prepend = true;
    if (model !== undefined) entry.model = model;
    if (preState !== undefined) entry.preState = preState;
    /* 快捷键键序恒在尾部（preState 之后）：无键条目序列化逐字节不变。 */
    if (shortcut !== undefined) entry.shortcut = shortcut;
    /* 星胚直执行键序最末（shortcut 之后）：无该键条目序列化逐字节不变。 */
    if (wantsDismiss) entry.embryoDismiss = true;
    /* 团队启用键序最末（embryoDismiss 之后）：无该键条目序列化逐字节不变。 */
    if (team !== undefined) entry.team = team;
    out.push(entry);
    if (out.length > MAX_BUTTONS) throw new TypeError(`buttons exceeds ${MAX_BUTTONS} entries`);
  }
  return out;
}

/**
 * 浏览器半区的**容错投影**（读面，不抛错）：非法/残缺条目直接跳过，条目重建走
 * `normalizeButtons` 的同款键序与条件键口径（单条失败即丢弃该条，SHALL NOT 波及其余）。
 * 读面容错模式（`tolerateUnknownPreState` / `tolerateUnknownShortcut` /
 * `tolerateUnknownEmbryoDismiss` / `tolerateUnknownTeam`）保留未知 `preState` / 池外
 * `shortcut` / 非 proto 行的 `embryoDismiss` / 非布尔 `team` 原值——设置页据此
 * 「原样回显标不可用」，动作条门控/分发对未知值恒不命中（自然隐藏 / 不可触发）。直执行
 * 条目（proto ∧ `embryoDismiss: true`）的**空 prompt 合法**
 * ——此处的 `prompt` 非空前置过滤同口径豁免，否则免提示词的按钮会被投影静默丢弃。
 * @param {unknown} section 设置节（`scope.getSnapshot().value` 或 `/config` 的 value）
 * @returns {Array<object>}
 */
export function buttonsSectionOf(section) {
  if (!section || typeof section !== "object" || !Array.isArray(section.buttons)) return [];
  const out = [];
  for (const item of section.buttons) {
    if (!item || typeof item !== "object") continue;
    if (typeof item.name !== "string" || typeof item.prompt !== "string") continue;
    if (!item.name.trim()) continue;
    if (!item.prompt.trim() && !isEmbryoDismissButton(item)) continue;
    try {
      const [entry] = normalizeButtons([item], {
        tolerateUnknownPreState: true,
        tolerateUnknownShortcut: true,
        tolerateUnknownEmbryoDismiss: true,
        tolerateUnknownTeam: true
      });
      if (entry) out.push(entry);
    } catch {
      /* 单条非法：跳过（读面容错） */
    }
  }
  return out;
}

/**
 * 星胚直执行按钮判据（add-cosmos-embryo-dismiss-button / spec cosmos-actions
 * 「星胚直执行执行链路」）：`preState === "proto"` ∧ `embryoDismiss === true`。
 * 单一谓词供客户端分流（`runButton`）、行级禁用豁免（`actionButtonStateOf`）、设置页控件
 * 启用态与读面容错投影共用，MUST NOT 在各处重写条件。
 * @param {{preState?: string, embryoDismiss?: boolean}|null|undefined} button 按钮配置条目
 * @returns {boolean}
 */
export function isEmbryoDismissButton(button) {
  return button?.preState === "proto" && button?.embryoDismiss === true;
}

/**
 * 前置状态呈现门控（add-cosmos-action-prestate-gate / spec「前置状态呈现门控」）。
 *
 * 双条件恒成立：`preState` 未设 → 恒显示（旧配置行为逐字不变）；已设 →
 * `target.lifecycle === preState` **且** `(target.act ?? 0) === 0`（沉睡：关联会话
 * busy ∨ waiting ∨ 委托忙碌计数为 0，口径与恒星活力两态的 `act` 聚合同源）。
 * 目标缺失/无 act 字段按 0 处理；未知 preState（漂移）永不命中 → 自然隐藏。
 *
 * @param {{preState?: string}|null|undefined} button 动作按钮配置条目
 * @param {{lifecycle?: string, act?: number}|null|undefined} target 选中目标（面板卡片）
 * @returns {boolean} true = 渲染该按钮
 */
export function actionButtonVisible(button, target) {
  const preState = typeof button?.preState === "string" ? button.preState : "";
  if (!preState) return true;
  /* 未知 preState（手工编辑漂移）不是合法前置状态 → 恒不命中（读面自然隐藏）。 */
  if (!PRE_STATES.includes(preState)) return false;
  if (!target || typeof target !== "object") return false;
  if (target.lifecycle !== preState) return false;
  return (target.act ?? 0) === 0;
}

/**
 * 设置命名空间 schema（宿主 `settings.register` 用；形状对齐 schemastery 最小契约：
 * 可调用 + type/dict + toJSON）。本插件不注册宿主 settings 命名空间（design D7 的
 * 「自营 API 首选」决策），此函数保留给宿主设置服务 fallback 的完整性校验与冒烟。
 * 条目可选键：`jumpNewSession` / `prepend` / `model` / `preState` / `shortcut` /
 * `embryoDismiss` / `team`（尾部依次追加；口径由 `normalizeButtons` 单条枚举/绑定校验）。
 * @returns {(value: unknown) => { buttons: Array<object> }}
 */
export function buttonsSchema() {
  const schema = (value) => {
    const source = value !== null && typeof value === "object" ? value : {};
    const rawButtons = source.buttons;
    if (rawButtons !== undefined && !Array.isArray(rawButtons)) throw new TypeError("buttons must be an array");
    return { buttons: normalizeButtons(rawButtons) };
  };
  schema.type = "object";
  schema.dict = { buttons: { type: "array", inner: { type: "object" } } };
  schema.toJSON = () => ({ type: "object", dict: { buttons: { type: "array", inner: { type: "object" } } } });
  return schema;
}
