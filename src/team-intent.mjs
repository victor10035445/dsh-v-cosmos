/**
 * 团队意图集合（add-cosmos-agent-team-toggle 3.1 / spec cosmos-agent-team-toggle
 * 「意图生命周期与易失性」）。
 *
 * 纯逻辑内存集合——宿主半区（意图端点 / `agent/created` 消费 / 星胚即时启用）与
 * `test/team-intent-smoke.mjs` 共用，零 IO、零定时器（时钟经构造注入）。
 *
 * 模型：`Map<sessionId, armedAt>`（epoch 毫秒）
 *  - `arm` **幂等**：同 sessionId 重复登记只刷新时间戳（不产生重复条目）；空 id → null；
 *  - `consume` **一次性消费**：命中即删并返回 `{ sessionId, armedAt }`；未命中/已过期 → null
 *    （过期条目被顺带清除——消费判定即惰性清除点）；
 *  - TTL 缺省 `TEAM_INTENT_TTL_MS`（30 分钟）。`arm` / `consume` / `has` / `size` 均先在
 *    判定前惰性清除过期条目；
 *  - **不持久化**：意图是易失意图（宿主重启即清空；持久化会制造「幽灵启用」）。
 */
export const TEAM_INTENT_TTL_MS = 30 * 60 * 1000;

/**
 * 建立团队意图集合。
 *
 * @param {{now?: () => number, ttlMs?: number}} [options]
 *        `now` 时钟注入（冒烟直测用）；`ttlMs` 过期窗注入（缺省 30 分钟；
 *        非有限值/非正值回落缺省）。
 * @returns {{arm: Function, consume: Function, has: Function, size: Function,
 *          clear: Function, ttlMs: number}}
 */
export function createTeamIntentStore(options = {}) {
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const configuredTtl = Number(options.ttlMs);
  const ttlMs = Number.isFinite(configuredTtl) && configuredTtl > 0 ? configuredTtl : TEAM_INTENT_TTL_MS;
  /** @type {Map<string, number>} sessionId → armedAt */
  const intents = new Map();

  const normalizeId = (sessionId) => (typeof sessionId === "string" ? sessionId.trim() : "");

  /** 惰性清除：过期（`at - armedAt > ttlMs`）意图直接删除。 */
  const purge = (at) => {
    for (const [sessionId, armedAt] of intents) {
      if (at - armedAt > ttlMs) intents.delete(sessionId);
    }
  };

  return {
    /**
     * 登记（幂等刷新时间戳）。
     * @param {unknown} sessionId 目标会话 id（trim 后非空）
     * @returns {{sessionId: string, armedAt: number}|null} null = 非法 id（零状态变化）
     */
    arm(sessionId) {
      const id = normalizeId(sessionId);
      if (!id) return null;
      const at = now();
      purge(at);
      intents.set(id, at);
      return { sessionId: id, armedAt: at };
    },
    /**
     * 一次性消费（命中即删）。
     * @param {unknown} sessionId 目标会话 id（trim 后非空）
     * @returns {{sessionId: string, armedAt: number}|null} null = 未命中或已过期
     */
    consume(sessionId) {
      const id = normalizeId(sessionId);
      if (!id) return null;
      const at = now();
      const armedAt = intents.get(id);
      purge(at);
      if (armedAt === undefined || !intents.has(id)) return null;
      intents.delete(id);
      return { sessionId: id, armedAt };
    },
    /** 是否有未过期意图（只读，不清除命中项）。 */
    has(sessionId) {
      const id = normalizeId(sessionId);
      if (!id) return false;
      purge(now());
      return intents.has(id);
    },
    /** 未过期意图条数。 */
    size() {
      purge(now());
      return intents.size;
    },
    /** 清空（仅测试/卸载用；生产上宿主重启天然清空）。 */
    clear() {
      intents.clear();
    },
    get ttlMs() {
      return ttlMs;
    }
  };
}
