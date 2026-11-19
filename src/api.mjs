/**
 * dsh-v-cosmos 浏览器半区 API 桥（add-cosmos-entry 2.4–2.6 消费面）。
 * - fetchScene：GET /api/dsh-v-cosmos/scene（星空骨架 JSON）；
 * - subscribeEvents：/api/dsh-v-cosmos/events SSE **轻帧**（帧体不带载荷，
 *   客户端收到后自行重拉 scene——hive 同款）。EventSource 自带重连。
 */
const API = "/api/dsh-v-cosmos";

/**
 * @returns {Promise<{ok: true, scene: object}|{ok: false, error: string}>}
 */
export async function fetchScene() {
  try {
    const res = await fetch(API + "/scene");
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.ok !== true || !body.scene) {
      return { ok: false, error: body?.error || res.status + " " + res.statusText };
    }
    return { ok: true, scene: body.scene };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

/**
 * 显式会话关联绑定（fix-cosmos-association-scope 3.1 / spec cosmos-actions ⑤）：
 * `POST /bind-session` 声明会话当前的提案工作面（替换语义——清单即完整工作面）。
 * 容错形与 fetchScene 同款：网络/非 2xx/坏体 → `{ok:false, error}`；调用方保证
 * **非阻断**（按钮链路失败静默，技能链路降级注明）。
 * @param {{sessionId?: string, proposals?: string[]}} [input]
 * @returns {Promise<{ok: true, bound: string[]}|{ok: false, error: string}>}
 */
export async function bindSession(input) {
  try {
    const res = await fetch(API + "/bind-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: input?.sessionId,
        proposals: Array.isArray(input?.proposals) ? input.proposals : []
      })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.ok !== true) {
      return { ok: false, error: body?.error || res.status + " " + res.statusText };
    }
    return { ok: true, bound: Array.isArray(body.bound) ? body.bound : [] };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

/**
 * 动作执行队列桥（add-cosmos-action-queue 5.1）：与 `fetchScene` / `bindSession` 同款
 * 容错形（网络/非 2xx/坏体 → `{ok:false, error}`）。
 */

/**
 * 全量队列快照（`GET /queue`）：页面加载与收到 `queue-changed` 轻帧后拉取对账。
 * @returns {Promise<{ok: true, queue: {version: number, revisedAt: number, queues: object}} |
 *          {ok: false, error: string}>}
 */
export async function fetchQueue() {
  try {
    const res = await fetch(API + "/queue");
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.ok !== true || !body.queue) {
      return { ok: false, error: body?.error || res.status + " " + res.statusText };
    }
    return { ok: true, queue: body.queue };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

/**
 * 队列操作（入队 / 排序 / 移出 / 清空 / 暂停 / 恢复）。
 * @param {"enqueue"|"reorder"|"remove"|"clear"|"pause"|"resume"} action
 * @param {object} [body]
 * @returns {Promise<{ok: true, [key: string]: unknown} | {ok: false, error: string, reason?: string, message?: string}>}
 */
export async function queueAction(action, body = {}) {
  try {
    const res = await fetch(API + "/queue/" + action, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {})
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload?.ok !== true) {
      return {
        ok: false,
        error: payload?.error || res.status + " " + res.statusText,
        ...(typeof payload?.reason === "string" ? { reason: payload.reason } : {}),
        ...(typeof payload?.message === "string" ? { message: payload.message } : {})
      };
    }
    return payload;
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

/**
 * @param {(frame: object) => void} onFrame 轻帧回调（{type:"proposals-changed"} |
 *        {type:"associations-changed"} | {type:"queue-changed"}；坏帧忽略）
 * @returns {() => void} 卸载函数
 */
export function subscribeCosmosEvents(onFrame) {
  if (typeof EventSource === "undefined") return () => {};
  const source = new EventSource(API + "/events");
  source.onmessage = (event) => {
    try {
      const frame = JSON.parse(event.data);
      if (
        frame?.type === "proposals-changed" ||
        frame?.type === "associations-changed" ||
        frame?.type === "queue-changed"
      ) {
        onFrame(frame);
      }
    } catch {
      /* 坏帧忽略 */
    }
  };
  return () => source.close();
}
