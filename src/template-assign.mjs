/**
 * per-星座模板指定覆盖面（add-cosmos-template-reassign 1.1/1.2 / design D2/D5/D6）。
 *
 * 独立纯逻辑模块——浏览器 client.jsx 消费（装载注入 / 星座动作条选择器 / 跨窗桥）、
 * merge.mjs 复用净房（`setTemplateOverrides` 注入前的唯一净化口径）、
 * test/template-assign-smoke.mjs 冒烟直测。
 *
 * 存储纪律（与 settings.mjs 同款）：键 `dsh-v-cosmos:tplOverrides` 为插件自有 localStorage
 * 面——per-星座数据 ≠ 全局偏好，**不并入**设置面（设置面净房会剥离未知键、且 payload
 * 语义混杂）。localStorage 缺席（Node 冒烟 / 隐私模式）→ 读面缺省空表、写面静默放弃
 * （本次会话内的覆盖仍由调用方模块态承接），SHALL NOT 抛错。
 *
 * 数据形态：`{ [wsId]: templateId }` 平面映射。净化口径 = **仅保留**
 *  - 键为非空字符串（危险键 `__proto__` / `constructor` / `prototype` 一律剔除，杜绝
 *    原型污染面）；
 *  - 值为 88 数据集内的模板 id（`allTemplates()` 的 id 全集）——未知 id / 空串 /
 *    非字符串值条目剔除（该星座回落哈希缺省命中）；
 *  - 损坏载荷（非对象 / 数组 / 模板数据集整体不可用）→ 空表；
 *  - 净化结果**恒写入新建纯净对象**（不复用输入引用，杜绝调用方后续改写污染模块态）。
 *
 * 重掷语义（design D5）：从「当前 figure 命中之外」的 88 − 1 个模板等概率取一枚直接
 * 写入覆盖条目（MUST NOT 引入「随机模式」等中间状态）——`randomTemplateIdOf`。
 *
 * 选择器投影（design D5）：`templatePickerRowsOf(query)` 为整页内浮层面板的**数据面**
 * 纯函数（88 模板列表 / 中文名或拉丁名子串过滤 / 大小写不敏感 / 多 token AND），
 * 与既有搜索面同款口径；模板模块不可用 → 空列表（选择器呈空态）。
 *
 * 跨窗桥（design D6）：同源 localStorage 是全部窗口共享的唯一覆盖真相——
 * `templateOverridesFromStorageEvent(event)` 只负责「是否与本面相关 + 净房后的完整映射」，
 * 监听绑定/store 同步留在 client.jsx（与 settings 的 `settingsFromStorageEvent` 同构）。
 */

import { TEMPLATE_COUNT, allTemplates } from "./cosmos/templates.mjs";

/** 覆盖表 localStorage 键（独立于设置面 `dsh-v-cosmos:settings`；无迁移前身）。 */
export const TEMPLATE_OVERRIDES_KEY = "dsh-v-cosmos:tplOverrides";

/** 原型污染危险键（净房恒剔除；`Object.keys` 可枚举到的同名自有属性同样拒绝）。 */
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * 模板 id 全集（数据集完整性守卫）：模块可通过但条目数不符 / 抛错 → null（= 不可用）。
 * 88 条目逐项要求非空字符串 id（数据集 spec 已冒烟锁定，此处防御不至于把坏 id 当合法域）。
 * @returns {Set<string>|null}
 */
function templateIdsOf() {
  try {
    const list = allTemplates();
    if (!Array.isArray(list) || list.length !== TEMPLATE_COUNT) return null;
    const ids = new Set();
    for (const template of list) {
      if (template && typeof template.id === "string" && template.id) ids.add(template.id);
    }
    return ids.size > 0 ? ids : null;
  } catch {
    return null;
  }
}

/**
 * 覆盖表净房（纯函数，design D2）：
 *  - 非对象 / 数组 / 模板数据集不可用 → 空表；
 *  - 键非非空字符串 / 命中危险键 / 值不在模板 id 全集 → 该条目剔除；
 *  - 恒返回**新建纯净对象**（`{}` 字面量，不共享输入引用、不读取原型链）。
 * SHALL NOT 抛错（读取条目属性亦经 try/catch 防御 getter 异常）。
 *
 * @param {unknown} raw 原始映射（localStorage 解析产物 / storage 事件载荷 / 调用方 patch 合并中间态）
 * @returns {Record<string, string>} 净房后的覆盖表
 */
export function sanitizeTemplateOverrides(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const ids = templateIdsOf();
  if (!ids) return out;
  let keys;
  try {
    keys = Object.keys(raw);
  } catch {
    return out;
  }
  for (const key of keys) {
    if (typeof key !== "string" || !key) continue;
    if (DANGEROUS_KEYS.has(key)) continue;
    let value;
    try {
      value = raw[key];
    } catch {
      continue;
    }
    if (typeof value !== "string" || !ids.has(value)) continue;
    out[key] = value;
  }
  return out;
}

/**
 * 读覆盖表（localStorage 缺席 / 损坏 JSON / 非法形态 → 空表；SHALL NOT 抛错）。
 * 读面净房与写面同源（同一 `sanitizeTemplateOverrides`），读面**不做写回**
 * （坏载荷仅回落，不静默改写用户数据）。
 * @returns {Record<string, string>}
 */
export function loadTemplateOverrides() {
  try {
    const raw = localStorage?.getItem(TEMPLATE_OVERRIDES_KEY);
    if (raw === null || raw === undefined) return {};
    return sanitizeTemplateOverrides(JSON.parse(raw));
  } catch {
    return {};
  }
}

/**
 * 部分写覆盖表（design D2/D5）：以当前净房值为底合并 patch 后净房落盘，返回净房结果。
 *  - patch 键值语义：字符串 = 指定；`null` / `undefined` = **删除该星座覆盖**（恢复默认 /
 *    重掷撤销的唯一写入口径）；
 *  - 未知 id / 空串 / 非字符串值：经净房剔除（等价于该键回到哈希缺省）；
 *  - 危险键剔除（连删除也不落盘——键本就不可能在净房结果中存在）；
 *  - localStorage 写失败（隐私模式 / 配额）静默放弃：返回的净房结果仍是本次会话生效值
 *    （调用方据此注入 merge 模块态，本次会话内仍即时生效）。
 *
 * @param {Record<string, string|null|undefined>|null|undefined} patch 部分写（键 = wsId）
 * @returns {Record<string, string>} 净房后的完整覆盖表
 */
export function saveTemplateOverrides(patch) {
  const current = loadTemplateOverrides();
  const merged = { ...current };
  if (patch && typeof patch === "object" && !Array.isArray(patch)) {
    let keys = [];
    try {
      keys = Object.keys(patch);
    } catch {
      keys = [];
    }
    for (const key of keys) {
      if (typeof key !== "string" || !key) continue;
      if (DANGEROUS_KEYS.has(key)) continue;
      let value;
      try {
        value = patch[key];
      } catch {
        continue;
      }
      if (value === null || value === undefined) delete merged[key];
      else merged[key] = value;
    }
  }
  const clean = sanitizeTemplateOverrides(merged);
  try {
    localStorage?.setItem(TEMPLATE_OVERRIDES_KEY, JSON.stringify(clean));
  } catch {
    /* 写不进就算了：本次会话内覆盖仍经调用方注入模块态生效 */
  }
  return clean;
}

/**
 * 随机重掷目标（design D5）：从 88 模板中剔除 `excludeId` 后的池子等概率取一枚。
 *  - `excludeId` 为 null / 非字符串 / 不在数据集 → 池子 = 全部 88（首次指定场景）；
 *  - 模板模块不可用 / 池空 → null（调用方不执行重掷；SHALL NOT 抛错）。
 * MUST NOT 返回 `excludeId` 自身（88 − 1 均匀域）。
 * @param {string|null|undefined} excludeId 当前 figure 命中 id
 * @returns {string|null}
 */
export function randomTemplateIdOf(excludeId) {
  try {
    const list = allTemplates();
    if (!Array.isArray(list) || list.length === 0) return null;
    const excluded = typeof excludeId === "string" ? excludeId : null;
    const pool = [];
    for (const template of list) {
      const id = template && typeof template.id === "string" ? template.id : "";
      if (!id || id === excluded) continue;
      pool.push(id);
    }
    if (pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)] ?? null;
  } catch {
    return null;
  }
}

/**
 * 选择器数据面（design D5，纯函数）：88 模板列表 + 搜索过滤。
 *  - `query` 空 / 纯空白（含非字符串）→ 全量（语义 = 过滤关闭）；
 *  - 非空 → 按空白切分多 token，匹配域 = 中文名 `zh` ∪ 拉丁 id ∪ 拉丁名 `name` ∪
 *    缩写 `abbr`（换行拼接后小写化；子串 AND 语义，与 matchWorkspaces 同口径）；
 *  - 模板模块不可用 → 空列表（选择器呈空态，MUST NOT 抛错）。
 * 返回值为模板条目浅数组（条目本身为冻结快照，调用方零拷贝即可只读消费）。
 * @param {unknown} query 原始查询串
 * @returns {readonly object[]}
 */
export function templatePickerRowsOf(query) {
  let list;
  try {
    list = allTemplates();
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const text = typeof query === "string" ? query.trim() : "";
  if (!text) return list.slice();
  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return list.slice();
  return list.filter((template) => {
    const haystack = [template?.zh, template?.id, template?.name, template?.abbr]
      .filter((value) => typeof value === "string")
      .join("\n")
      .toLowerCase();
    return tokens.every((token) => haystack.indexOf(token) >= 0);
  });
}

/**
 * `storage` 事件 → 覆盖表投影（design D6；跨窗即时生效的纯函数面）。
 *
 * 与设置面同款：同源 localStorage 是全部窗口共享的唯一覆盖真相——窗口 A 的指定/重掷/
 * 恢复默认写入后，窗口 B 收到 `storage` 事件；本函数只负责「是否与本面相关 + 净房后的
 * 完整覆盖表」，监听绑定/重新注入留在 client.jsx。与本面无关的键 → `null`。
 * `newValue === null`（clear）与坏 JSON 一律按空表处理（与读面同语义）。
 * @param {{key?: unknown, newValue?: unknown}|null|undefined} event StorageEvent 形状子集
 * @returns {Record<string, string>|null} 净房后的覆盖表；null = 与本面无关
 */
export function templateOverridesFromStorageEvent(event) {
  if (event === null || typeof event !== "object") return null;
  if (event.key !== TEMPLATE_OVERRIDES_KEY) return null;
  let raw = {};
  if (typeof event.newValue === "string" && event.newValue) {
    try {
      raw = JSON.parse(event.newValue);
    } catch {
      raw = {};
    }
  }
  return sanitizeTemplateOverrides(raw);
}
