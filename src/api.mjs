/**
 * dsh-v-cosmos 浏览器半区 API 桥（add-cosmos-entry 2.4–2.6 消费面）。
 * - fetchScene：GET /api/dsh-v-cosmos/scene（星空骨架 JSON）；
 * - subscribeEvents：/api/dsh-v-cosmos/events SSE **轻帧**（帧体不带载荷，
 *   客户端收到后自行重拉 scene——hive 同款）。EventSource 自带重连。
 *   例外：`cosmos-presence-changed` 独立窗口占位计数帧（add-cosmos-standalone-window
 *   D2）携带 `count`——计数即载荷，仍属轻帧；`options.role` 为该连接的占位角色标识。
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
 * @param {(frame: object) => void} onFrame 轻帧回调（{type:"proposals-changed"} |
 *        {type:"associations-changed"} | {type:"cosmos-presence-changed", count}；坏帧忽略）
 * @param {{role?: string}} [options] 连接角色标识（add-cosmos-standalone-window 3.4）：
 *        独立窗口态传 `COSMOS_WINDOW_ROLE`（`role=cosmos-window`）——宿主据此登记占位并
 *        广播计数帧；内嵌态缺席 = 普通客户端（不登记占位）。
 * @returns {() => void} 卸载函数
 */
export function subscribeCosmosEvents(onFrame, options) {
  if (typeof EventSource === "undefined") return () => {};
  const role = typeof options?.role === "string" ? options.role.trim() : "";
  const query = role ? "?role=" + encodeURIComponent(role) : "";
  const source = new EventSource(API + "/events" + query);
  source.onmessage = (event) => {
    try {
      const frame = JSON.parse(event.data);
      if (frame?.type === "proposals-changed" || frame?.type === "associations-changed") {
        onFrame(frame);
        return;
      }
      /* 占位计数帧（add-cosmos-standalone-window D2）：帧体携带 count（最小例外——
         计数即载荷）；非法计数整体丢弃（防脏帧改写按钮状态）。 */
      if (frame?.type === "cosmos-presence-changed") {
        if (Number.isFinite(Number(frame.count))) onFrame(frame);
        return;
      }
    } catch {
      /* 坏帧忽略 */
    }
  };
  return () => source.close();
}
