/**
 * Cosmos 独立窗口占位注册表（宿主半区纯逻辑，add-cosmos-standalone-window design D2）。
 *
 * 单实例语义的载体 = 独立窗口的**页面级 SSE 连接**（不是 localStorage、不是心跳轮询）：
 * 连接本身就是活着的心跳，断开即清位（无崩溃残留、无 TTL 参数）。本模块只收敛三件纯事：
 *  - 角色标识常量与判据（`role=cosmos-window` 查询参数值）；
 *  - 占位登记表（Set 语义：add/delete 幂等，count 即占位窗口数）；
 *  - 轻帧构造（`{type:"cosmos-presence-changed", count}`——计数即载荷，对齐「帧体不带
 *    载荷」原则的最小例外）。
 *
 * 连接生命周期、广播与心跳仍归 `index.mjs` 的 `/events` 路由（既有 sseClients 机制扩展，
 * MUST NOT 另起通道）；本模块零依赖、可冒烟直测（test/standalone-window-smoke.mjs）。
 */

/** 独立窗口 SSE 连接的角色标识（客户端 `?role=<本值>`；宿主据此登记占位）。 */
export const COSMOS_WINDOW_ROLE = "cosmos-window";

/** presence 轻帧类型（与既有 `proposals-changed` / `associations-changed` 同通道）。 */
export const COSMOS_PRESENCE_FRAME = "cosmos-presence-changed";

/**
 * 角色值判据（精确匹配）：未携带 / 未知 / 空串一律非独立窗口连接——占位口径不放宽。
 * @param {unknown} value `URLSearchParams.get("role")` 的原始值
 * @returns {boolean}
 */
export function isCosmosWindowRole(value) {
  return typeof value === "string" && value === COSMOS_WINDOW_ROLE;
}

/**
 * 占位登记表（纯逻辑）：以连接对象为 token，`add` / `delete` 幂等——
 * SSE 重连可能重复注册同一浏览器窗口的不同连接对象，但**同一连接** MUST NOT 重复计数。
 * @returns {{add: (client: any) => boolean, delete: (client: any) => boolean,
 *            has: (client: any) => boolean, count: () => number, reset: () => void}}
 *          `add` / `delete` 返回「本次是否真的改变了计数」（供调用方判定是否广播增量）
 */
export function createPresenceRegistry() {
  const clients = new Set();
  return {
    add(client) {
      if (client === null || client === undefined) return false;
      if (clients.has(client)) return false;
      clients.add(client);
      return true;
    },
    delete(client) {
      return clients.delete(client);
    },
    has(client) {
      return clients.has(client);
    },
    count() {
      return clients.size;
    },
    reset() {
      clients.clear();
    }
  };
}

/**
 * presence 轻帧（计数净化为非负整数；非法/负数 → 0）。
 * @param {unknown} count 当前占位连接数
 * @returns {{type: string, count: number}}
 */
export function presenceFrameOf(count) {
  const n = Number(count);
  return {
    type: COSMOS_PRESENCE_FRAME,
    count: Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
  };
}
