/**
 * 跨提案依赖的**调度门控纯逻辑单点**（second-add-cross-proposal-dependency-gating
 * 1.1–1.5 / 2.1 / 2.3；spec `cosmos-proposal-warp`「门控接力状态机」「完成判定」
 * 「转入脉冲队列」/ `cosmos-action-queue`「调度与串行执行」「入队链路与前置状态复验」）。
 *
 * 职责边界（design D1/D4/D5/D6）：
 *  - 消费 `dep-resolve.mjs` 的**唯一判定点**（达标谓词 / 归一口径不在本模块重写）：
 *    本模块只做「快照形状归一 + 判定结果整形 + 呈现等待信息」；
 *  - **零 node 内建依赖、零 DOM、零网络、零文件 I/O**——观察快照（活跃提案生命周期 /
 *    归档目录名 / 台账行 / 锚点）由宿主注入，冒烟可穷举容错分支；
 *  - deps 快照形状 = `[{ slug, state }]`（**与 `dep-resolve.normalizeRequires` 同形**，
 *    来源标记 `declared|derived` 不落盘：调度只关心「等谁、等到哪一态」）；
 *  - 安全方向恒为**少守卫**：归一失败 / 解析失败 / 成环 → 空依赖（等价现状行为）。
 *
 * 「等待」语义（design D4）：只有依赖子句适合等待——达标谓词是单调超集语义
 * （后继闭包 + 归档超集），等待恒有终态；条目自身的 `preState` 精确相等谓词不并入
 * 扫描等待（生命周期单调前进 → 等待无终态），仍在启动时刻按既有复验跳过。
 */

import { evaluateDependencies, normalizeRequires } from "./dep-resolve.mjs";

/**
 * 依赖未达标时的门控原因码（曲率点火/转投复验 skipped 残留的 reason；
 * 与 `prestate-drift` 同级——防御性复验专用，正常门控下不会触发）。
 */
export const DEPENDENCY_DRIFT_REASON = "dependency-drift";

/**
 * 等待原因码（呈现用；**不落持久状态**——由依赖提案当前生命周期与其队列条目在册态
 * 推导，见 `repairReasonOf`）。
 *  - `repair`：依赖提案的队列条目为 failed / skipped → 等修复。
 */
export const DEPENDENCY_WAIT_REASONS = Object.freeze({ repair: "repair" });

/** 终态残留状态（等待原因 `repair` 的判定输入）。 */
const REPAIR_STATES = Object.freeze(["failed", "skipped"]);

/** 依赖状态枚举（与 `dep-resolve.DEPENDENCY_STATES` 同域；此处不重复导出）。 */
const DEPENDENCY_STATES = new Set(["created", "reviewed", "executed"]);

/**
 * deps 快照归一（读面容错，**唯一入口**）：非法（非数组 / 条目非对象 / slug 空或带
 * 首尾空白 / state 枚举外 / 同 slug 重复）→ **整份按无依赖**（`normalizeRequires`
 * 契约：半份声明比没有更危险）；合法 → 规范化副本；`[]` 合法（= 无守卫）。
 * @param {unknown} raw 任意来源（存储回读 / 附着解析结果）
 * @returns {Array<{slug: string, state: string}>} 空数组 = 无依赖守卫
 */
export function normalizeDeps(raw) {
  const list = normalizeRequires(raw);
  return list === null ? [] : list;
}

/**
 * 生效依赖集（`resolveDependencies` 产物，含 `source` 标记）→ 持久快照形状
 * `[{ slug, state }]`（去重、码点序稳定；非法条目丢弃——防御上游形状漂移）。
 * @param {Array<{slug?: unknown, state?: unknown}>|null|undefined} dependencies
 * @returns {Array<{slug: string, state: string}>}
 */
export function depsSnapshotOf(dependencies) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(dependencies) ? dependencies : []) {
    const slug = typeof item?.slug === "string" ? item.slug : "";
    const state = item?.state;
    if (!slug || slug.trim() !== slug || !DEPENDENCY_STATES.has(state)) continue;
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push({ slug, state });
  }
  out.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return out;
}

/**
 * 依赖子句求值（门控 / 点火复验 / 转投复验 / 让位扫描共用的**唯一入口**）：
 * 逐项求值 `dep-resolve` 达标谓词，未达标项按快照序透出（呈现取首项）。
 * @param {object|null|undefined} observation 观察快照（`active` / `archiveNames`；
 *        另可携带 `lineages` / `anchors`——求值不使用，仅解析面使用）
 * @param {unknown} deps deps 快照（任意来源；内部归一）
 * @returns {{satisfied: boolean,
 *            unsatisfied: Array<{slug: string, state: string}>,
 *            first: {slug: string, state: string}|null}}
 */
export function dependencyVerdictOf(observation, deps) {
  const normalized = normalizeDeps(deps);
  if (normalized.length === 0) return { satisfied: true, unsatisfied: [], first: null };
  const evaluated = evaluateDependencies({
    ...(observation && typeof observation === "object" && !Array.isArray(observation) ? observation : {}),
    dependencies: normalized
  });
  const unsatisfied = evaluated.unsatisfied.map((item) => ({ slug: item.slug, state: item.state }));
  return {
    satisfied: evaluated.satisfied === true,
    unsatisfied,
    first: unsatisfied.length > 0 ? unsatisfied[0] : null
  };
}

/**
 * 等待原因推导（呈现用，纯函数）：依赖提案在册条目的状态集合里出现 `failed | skipped`
 * → `repair`（等前置修复）；否则 `null`（正常等待前置推进）。
 *
 * 局限（design D3 的实施口径）：`failed` 条目被**移出**后无在册痕迹，等待原因退化为
 * 普通「等待依赖」文案（spec 明令 MUST NOT 新增持久状态，故不做跨会话记忆）。
 * @param {Array<unknown>} states 依赖提案在册条目状态（warp / queue 两队列并集）
 * @returns {"repair"|null}
 */
export function repairReasonOf(states) {
  for (const state of Array.isArray(states) ? states : []) {
    if (REPAIR_STATES.includes(state)) return DEPENDENCY_WAIT_REASONS.repair;
  }
  return null;
}

/**
 * 等待呈现信息（公共快照投影用；`null` = 无等待）：依赖全部达标 → null；
 * 否则返回首个未达标项 + 原因码。
 * @param {object|null|undefined} observation 观察快照
 * @param {unknown} deps deps 快照
 * @param {Array<unknown>} [dependencyStates] 首个未达标项的依赖提案在册条目状态
 * @returns {{dep: string, reason?: string}|null}
 */
export function dependencyWaitOf(observation, deps, dependencyStates = []) {
  const verdict = dependencyVerdictOf(observation, deps);
  if (verdict.satisfied || verdict.first === null) return null;
  const reason = repairReasonOf(dependencyStates);
  return reason === null ? { dep: verdict.first.slug } : { dep: verdict.first.slug, reason };
}
