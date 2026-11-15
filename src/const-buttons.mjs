/**
 * 星座动作按钮配置模型（add-cosmos-constellation-actions 1.1 / spec
 * cosmos-constellation-actions「星座按钮配置模型」）。
 *
 * 独立纯逻辑模块——宿主半区（configstore 节归一化）与浏览器半区（设置页草稿校验 /
 * 星座动作条投影）共用，test/const-buttons-schema-smoke.mjs 直测。
 *
 * 模型：`{ name, prompt, autoSend, newSession, model? }`
 *  - `name`   显示名（非空，trim 后去重；允许中文）；
 *  - `prompt` 提示词（非空）——**消息即纯提示词**，星座动作无 @提案引用；
 *  - `autoSend` **必填布尔，归一化恒输出**：缺省/null 视为 false，其余非布尔值拒绝；
 *  - `newSession` **语义常量恒 true**（「新增会话」为固定模式）：缺失/null 补 true
 *    （旧数据零迁移），其余非 true 值拒绝；归一化恒输出 `newSession: true`；
 *  - `model` 可选 `{ provider, model, reasoningEffort? }`：形状校验后原样透传，
 *    未提供时 MUST NOT 输出该键。
 *
 * **MUST NOT 含 `prepend` 键**（design D1）：星座动作没有「提示词与 @引用」的先后语义，
 * 该键出现在条目里即拒绝保存（不静默丢弃——静默丢弃会让设置页回显与配置文件漂移）。
 *
 * 与提案动作 `buttons` 节的关系：同文件、**互不读写**（各自只认自己的节名与前缀），
 * 归一化口径同源但独立实现（design D1：两个生命周期独立、作用面不同的列表）。
 *
 * 键序固定 name → prompt → autoSend → newSession → model（客户端 `JSON.stringify`
 * 比较依赖键序稳定）。
 */
import { MAX_PROMPT_CHARS, normalizeButtonModel } from "./buttons.mjs";

/** 星座按钮条数上限（spec：超出保存被拒绝；与提案动作同为 32，但两节独立计数）。 */
export const MAX_CONST_BUTTONS = 32;

/**
 * 归一化星座按钮列表。
 *
 * 接受数组或 `{ constellationButtons: [...] }`；完全空条目（name 与 prompt 皆空）剔除、
 * 半空条目报错。返回条目恒含 `autoSend`（布尔）与 `newSession: true`，且**恒不含**
 * `prepend` 键。
 *
 * 去重口径：trim 后 name 相同 → 抛错（保存被拒绝并提示「名称重复」），不做静默先到先得。
 *
 * @param {unknown} raw
 * @returns {Array<{name: string, prompt: string, autoSend: boolean, newSession: true,
 *          model?: {provider: string, model: string, reasoningEffort?: string}}>}
 * @throws {TypeError} 形状非法 / 含 prepend / 名称重复 / 超上限
 */
export function normalizeConstButtons(raw) {
  let list = [];
  if (Array.isArray(raw)) list = raw;
  else if (raw && typeof raw === "object" && Array.isArray(raw.constellationButtons)) list = raw.constellationButtons;
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (!item || typeof item !== "object") throw new TypeError("constellationButtons contains a non-object entry");
    if (typeof item.name !== "string") throw new TypeError("constellation button name must be a string");
    if (typeof item.prompt !== "string") throw new TypeError(`constellation button "${item.name}" prompt must be a string`);
    const name = item.name.trim();
    const prompt = item.prompt.trim();
    if (!name && !prompt) continue; // 完全空条目剔除（半空条目仍校验）
    if (!name) throw new TypeError("constellation button name must not be empty");
    if (!prompt) throw new TypeError(`constellation button "${name}" prompt must not be empty`);
    if (prompt.length > MAX_PROMPT_CHARS) {
      throw new TypeError(`constellation button "${name}" prompt exceeds ${MAX_PROMPT_CHARS} chars`);
    }
    /* 星座动作没有「前置/后置」语义：该键一旦出现即拒绝（含 false——口径是「模型不含
       该键」，静默忽略会让配置文件与回显不一致）。 */
    if (item.prepend !== undefined) {
      throw new TypeError(`constellation button "${name}" must not contain the prepend key`);
    }
    if (item.autoSend !== undefined && item.autoSend !== null && typeof item.autoSend !== "boolean") {
      throw new TypeError(`constellation button "${name}" autoSend must be a boolean`);
    }
    /* newSession：语义常量恒 true（缺失 = 旧数据，按 true 补齐；非 true 一律拒绝）。 */
    if (item.newSession !== undefined && item.newSession !== null && item.newSession !== true) {
      throw new TypeError(`constellation button "${name}" newSession must be true (fixed "new session" mode)`);
    }
    const model = normalizeButtonModel(item.model, name);
    if (seen.has(name)) throw new TypeError(`constellation button name "${name}" is duplicated`);
    seen.add(name);
    const entry = { name, prompt, autoSend: item.autoSend === true, newSession: true };
    if (model !== undefined) entry.model = model;
    out.push(entry);
    if (out.length > MAX_CONST_BUTTONS) throw new TypeError(`constellationButtons exceeds ${MAX_CONST_BUTTONS} entries`);
  }
  return out;
}

/**
 * 浏览器半区的**容错投影**（读面，不抛错）：非法/残缺条目直接跳过，条目重建走
 * `normalizeConstButtons` 的同款键序与条件键口径（单条失败即丢弃该条，SHALL NOT 波及其余）。
 *
 * 只读 `section.constellationButtons`——与提案动作的 `section.buttons` **零交集**
 * （spec 场景「与提案动作配置隔离」）。
 * @param {unknown} section 设置节（`scope.getSnapshot().value` 或 `/config` 的 value）
 * @returns {Array<object>}
 */
export function constButtonsSectionOf(section) {
  if (!section || typeof section !== "object" || !Array.isArray(section.constellationButtons)) return [];
  const out = [];
  for (const item of section.constellationButtons) {
    if (!item || typeof item !== "object") continue;
    if (typeof item.name !== "string" || typeof item.prompt !== "string") continue;
    if (!item.name.trim() || !item.prompt.trim()) continue;
    try {
      const [entry] = normalizeConstButtons([item]);
      if (entry) out.push(entry);
    } catch {
      /* 单条非法：跳过（读面容错） */
    }
  }
  return out;
}
