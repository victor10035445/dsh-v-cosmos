/**
 * dsh-v-cosmos — 曲率计划（warp plan）配置模型与设置页控制器
 * （two-add-cosmos-proposal-warp 5.1 / spec cosmos-proposal-warp「曲率计划配置模型与
 * 曲率引擎设置页签」）。
 *
 * 独立纯逻辑模块（零 node 内建、零 React）：宿主半区（configstore 节归一化）、
 * 浏览器半区（设置页草稿-保存控制器、动作条曲率按钮的计划解析）与冒烟共用同一实现。
 *
 * 存储模型（自营共享配置 `warpPlan` 节）：
 *
 * ```
 * { bars: [ { name: "<提案动作条名>", rule?: "queue" } ] }
 * ```
 *
 *  - `name` 必须命中 `buttons` 配置（悬空引用保存被拒绝——严格净房抛错，交叉校验由
 *    保存面执行）；`bars` 允许空数组（计划未配置 → 曲率按钮禁用）。
 *  - `rule` 枚举 `"direct" | "queue"`，缺省 `direct`；**仅 `queue` 落键**（存储最小形，
 *    同 `prepend` 先例）。`rule: "direct"` 归一化时丢弃。
 *  - 同一按钮名重复 → 保存拒绝。
 *
 * 读面容错（`sanitizeWarpPlan` / `warpPlanSectionOf`）：非数组 / 坏条目 / 未知 rule
 * 逐条剔除或回落 `direct`，MUST NOT 抛错（设置页可回显、旧数据零迁移）。
 */

import { isEmbryoDismissButton, normalizeButtons } from "./buttons.mjs";

/** 分流规则枚举（顺序即设置页下拉顺序：直航 / 转入脉冲队列）。 */
export const WARP_RULES = Object.freeze(["direct", "queue"]);
/** 计划动作条上限（与动作按钮上限同量级；超出保存拒绝）。 */
export const MAX_WARP_BARS = 32;

/** 分流规则合法值判定（缺省 = direct，不落键）。 */
export function isWarpRule(value) {
  return typeof value === "string" && WARP_RULES.includes(value);
}

/**
 * 曲率计划严格净房（保存路径 / 宿主 configstore 写面）。
 *
 * @param {unknown} raw `{ bars: [...] }`（或裸数组，读面容错兼容）
 * @returns {{bars: Array<{name: string, rule?: "queue"}>}}
 * @throws {TypeError} 形状非法 / name 空 / rule 枚举外 / 同名重复 / 超上限
 */
export function normalizeWarpPlan(raw) {
  let list = [];
  if (Array.isArray(raw)) list = raw;
  else if (raw !== null && typeof raw === "object" && Array.isArray(raw.bars)) list = raw.bars;
  else if (raw === null || raw === undefined) list = [];
  else if (raw !== null && typeof raw === "object" && raw.bars === undefined) list = [];
  else throw new TypeError("warpPlan must be an object with a bars array");
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new TypeError("warpPlan.bars contains a non-object entry");
    }
    if (typeof item.name !== "string") throw new TypeError("warpPlan bar name must be a string");
    const name = item.name.trim();
    if (!name) throw new TypeError("warpPlan bar name must not be empty");
    let rule;
    if (item.rule !== undefined && item.rule !== null) {
      if (typeof item.rule !== "string") throw new TypeError(`warpPlan bar "${name}" rule must be a string`);
      const value = item.rule.trim();
      if (value !== "") {
        if (!isWarpRule(value)) {
          throw new TypeError(`warpPlan bar "${name}" rule must be one of ${WARP_RULES.join(", ")}`);
        }
        if (value === "queue") rule = "queue";
      }
    }
    if (seen.has(name)) throw new TypeError(`warpPlan bar "${name}" is duplicated`);
    seen.add(name);
    out.push(rule === "queue" ? { name, rule } : { name });
    if (out.length > MAX_WARP_BARS) throw new TypeError(`warpPlan exceeds ${MAX_WARP_BARS} bars`);
  }
  return { bars: out };
}

/**
 * 曲率计划读面容错投影（设置页 / 附着解析）：坏条目逐条剔除、未知 rule 回落
 * `direct`（不落键）、同名先到先得、超限静默截断。恒返回新对象，MUST NOT 抛错。
 *
 * @param {unknown} raw
 * @returns {{bars: Array<{name: string, rule?: "queue"}>}}
 */
export function sanitizeWarpPlan(raw) {
  const source = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const list = Array.isArray(source.bars) ? source.bars : Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    if (item.rule === "queue") out.push({ name, rule: "queue" });
    else out.push({ name });
    if (out.length >= MAX_WARP_BARS) break;
  }
  return { bars: out };
}

/**
 * 设置作用域 `value`（或 `/config` 的 value）→ 曲率计划容错投影。
 * @param {unknown} section
 * @returns {{bars: Array<{name: string, rule?: "queue"}>}}
 */
export function warpPlanSectionOf(section) {
  return sanitizeWarpPlan(section && typeof section === "object" ? section : undefined);
}

/**
 * 计划 × 按钮配置 → 附着条目快照（**附着时刻**解析；调用方负责悬空丢弃）。
 *
 * 适用性过滤（spec「计划附着与曲率按钮」「星胚展开」）：
 *  - 星胚目标（`targetKind === "embryo"`）：仅 `preState === "proto"` 且有非空 prompt 的
 *    非直达移除按钮；**分流规则恒直航**（转投脉冲需要提案目录，星胚阶段不存在）。
 *  - 提案目标（`targetKind === "proposal"`）：排除 proto 按钮（提案生命周期永不命中
 *    proto，会永久置灰）与直达移除按钮。
 *
 * 快照形状（存储最小形，与 queue-store 同口径）：
 * `{ name, prompt, model?, prepend?, preState? }`。
 *
 * @param {unknown} plan 曲率计划（`{bars}` / 裸数组）
 * @param {unknown} buttons 当前 `buttons` 配置（归一化后数组）
 * @param {"proposal"|"embryo"} targetKind 目标形态
 * @returns {Array<{button: {name: string, prompt: string, model?: object, prepend?: true,
 *          preState?: string}, rule: "direct"|"queue"}>}
 */
export function resolveWarpPlanEntries(plan, buttons, targetKind) {
  const bars = sanitizeWarpPlan(plan).bars;
  let list = [];
  try {
    list = normalizeButtons(Array.isArray(buttons) ? buttons : [], {
      tolerateUnknownPreState: true,
      tolerateUnknownShortcut: true,
      tolerateUnknownEmbryoDismiss: true
    });
  } catch {
    list = [];
  }
  const byName = new Map(list.map((button) => [button.name, button]));
  const out = [];
  for (const bar of bars) {
    const button = byName.get(bar.name);
    if (!button) continue;
    if (isEmbryoDismissButton(button)) continue;
    if (typeof button.prompt !== "string" || !button.prompt.trim()) continue;
    const isProto = button.preState === "proto";
    if (targetKind === "embryo" && !isProto) continue;
    if (targetKind !== "embryo" && isProto) continue;
    const snapshot = { name: button.name, prompt: button.prompt };
    if (button.model !== undefined) snapshot.model = { ...button.model };
    if (button.prepend === true) snapshot.prepend = true;
    if (typeof button.preState === "string" && button.preState) snapshot.preState = button.preState;
    out.push({
      button: snapshot,
      rule: targetKind === "embryo" ? "direct" : (bar.rule === "queue" ? "queue" : "direct")
    });
  }
  return out;
}

/**
 * 提案动作条候选（设置页「曲率引擎」行清单）：排除直达移除按钮与空 prompt 条目；
 * 保留 `preState` 供行内徽标呈现。按配置顺序（数组顺序即行顺序，MUST NOT 二次排序）。
 * @param {unknown} buttons
 * @returns {Array<{name: string, prompt: string, preState?: string}>}
 */
export function warpPlanOptionsOf(buttons) {
  let list = [];
  try {
    list = normalizeButtons(Array.isArray(buttons) ? buttons : [], {
      tolerateUnknownPreState: true,
      tolerateUnknownShortcut: true,
      tolerateUnknownEmbryoDismiss: true
    });
  } catch {
    list = [];
  }
  const out = [];
  for (const button of list) {
    if (isEmbryoDismissButton(button)) continue;
    if (typeof button.prompt !== "string" || !button.prompt.trim()) continue;
    const row = { name: button.name, prompt: button.prompt };
    if (typeof button.preState === "string" && button.preState) row.preState = button.preState;
    out.push(row);
  }
  return out;
}

/** 计划等价（成员 + rule，**与行顺序无关**：设置页行序固定为按钮配置顺序）。 */
function samePlan(a, b) {
  const keyOf = (plan) => sanitizeWarpPlan(plan).bars
    .map((bar) => bar.name + "\u0000" + (bar.rule === "queue" ? "queue" : "direct"))
    .sort()
    .join("\u0001");
  return keyOf(a) === keyOf(b);
}

/**
 * 「曲率引擎」设置页控制器（暂存-保存模型；与 buttons/paths 控制器同纪律）。
 *
 * - 草稿 = 勾选集合（name → rule）；编辑只改本地草稿，「保存」才整节 CAS 写
 *   `warpPlan`（`scope.set("warpPlan", {bars})`）；409/只读 → `failed` 置位、草稿保留。
 * - 行清单来自当前 `buttons` 配置（`scope.value.buttons`），悬空引用不出行（已删除按钮
 *   在计划里的旧引用在保存时被自然丢弃——优雅降级）。
 * - 空计划保存为 `{ bars: [] }`（显式覆盖）；「重置」= `scope.unset("warpPlan")`
 *   （回落组合层 base），覆盖标记据 `scope.user.warpPlan` 派生。
 * - 规则下拉仅 `queue` 落键；直航为缺省。
 *
 * @param {object} scope 归一后的设置作用域（通道作用域 / 合成只读）
 * @returns {object} face：getSnapshot/subscribe + edit/save/discard/reset/dispose
 */
export function createWarpPlanSettingsController(scope) {
  const listeners = new Set();
  let state = null;
  let staged = null; // Map<name, "direct"|"queue">；null = 跟随生效值
  let saving = false;
  let failed = false;

  const optionsOf = () => {
    const value = scope.getSnapshot()?.value;
    return warpPlanOptionsOf(value?.buttons);
  };

  const effectiveBars = () => warpPlanSectionOf(scope.getSnapshot()?.value?.warpPlan).bars;

  const draftMap = () => {
    if (staged !== null) return new Map(staged);
    const map = new Map();
    for (const bar of effectiveBars()) map.set(bar.name, bar.rule === "queue" ? "queue" : "direct");
    return map;
  };

  const payloadOf = (map, options) => {
    const bars = [];
    for (const option of options) {
      if (!map.has(option.name)) continue;
      const rule = map.get(option.name) === "queue" ? "queue" : "direct";
      bars.push(rule === "queue" ? { name: option.name, rule: "queue" } : { name: option.name });
    }
    return { bars };
  };

  const publish = () => {
    const snapshot = scope.getSnapshot();
    const options = optionsOf();
    const map = draftMap();
    const draft = payloadOf(map, options);
    const effective = warpPlanSectionOf(snapshot?.value?.warpPlan);
    const user = snapshot?.user;
    const overridden = user !== null && typeof user === "object"
      && user.warpPlan !== null && typeof user.warpPlan === "object";
    const dirty = staged !== null && !samePlan(draft, effective);
    const known = new Set(options.map((option) => option.name));
    const dangling = effectiveBars().filter((bar) => !known.has(bar.name)).map((bar) => bar.name);
    const rows = options.map((option) => ({
      name: option.name,
      prompt: option.prompt,
      preState: option.preState ?? null,
      checked: map.has(option.name),
      rule: map.get(option.name) === "queue" ? "queue" : "direct"
    }));
    state = Object.freeze({
      status: typeof snapshot?.status === "string" ? snapshot.status : "ready",
      loading: snapshot?.status === "loading",
      writable: snapshot?.writable === true,
      saving,
      failed,
      dirty,
      overridden,
      dangling,
      rows,
      plan: draft.bars,
      count: draft.bars.length,
      revision: snapshot?.revision
    });
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        console.error("[dsh-v-cosmos] warp plan settings listener failed:", error);
      }
    }
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
    /** 编辑一行：`{checked?: boolean, rule?: "direct"|"queue"}`；仅当前选项内生效。 */
    edit(name, patch = {}) {
      if (typeof name !== "string" || !name) return;
      const options = optionsOf();
      if (!options.some((option) => option.name === name)) return;
      const map = draftMap();
      if (patch.checked === false) map.delete(name);
      else if (patch.checked === true) {
        if (!map.has(name)) map.set(name, "direct");
      }
      if (typeof patch.rule === "string" && map.has(name)) {
        map.set(name, patch.rule === "queue" ? "queue" : "direct");
      }
      staged = map;
      failed = false;
      publish();
    },
    /** 保存草稿（整节 CAS 写入；失败保留草稿，UI 走「保存未生效，请重试」）。 */
    async save() {
      const current = state;
      if (!current || !current.writable || !current.dirty || saving) return false;
      const options = optionsOf();
      const map = draftMap();
      const payload = payloadOf(map, options);
      saving = true;
      failed = false;
      publish();
      try {
        await scope.set("warpPlan", payload);
        staged = null;
        return true;
      } catch {
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
    /** 重置：删除用户覆盖节（回落组合层 base）。 */
    async reset() {
      if (!state || !state.writable || !state.overridden || saving) return false;
      saving = true;
      failed = false;
      publish();
      try {
        await scope.unset("warpPlan");
        staged = null;
        return true;
      } catch {
        failed = true;
        return false;
      } finally {
        saving = false;
        publish();
      }
    },
    dispose() {
      unsubscribe?.();
      listeners.clear();
    }
  };
}
