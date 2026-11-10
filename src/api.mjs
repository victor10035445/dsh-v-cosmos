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
 * @param {(frame: object) => void} onFrame 轻帧回调（{type:"proposals-changed"} |
 *        {type:"associations-changed"}；坏帧忽略）
 * @returns {() => void} 卸载函数
 */
export function subscribeCosmosEvents(onFrame) {
  if (typeof EventSource === "undefined") return () => {};
  const source = new EventSource(API + "/events");
  source.onmessage = (event) => {
    try {
      const frame = JSON.parse(event.data);
      if (frame?.type === "proposals-changed" || frame?.type === "associations-changed") onFrame(frame);
    } catch {
      /* 坏帧忽略 */
    }
  };
  return () => source.close();
}
