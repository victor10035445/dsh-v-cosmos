/**
 * dsh-v-cosmos 浏览器半区 API 桥（add-cosmos-entry 2.4–2.6 消费面 + 作品桥）。
 * - fetchScene：GET /api/dsh-v-cosmos/scene（星空骨架 JSON）；
 * - subscribeEvents：/api/dsh-v-cosmos/events SSE **轻帧**（帧体不带载荷，
 *   客户端收到后自行重拉 scene / queue / works——hive 同款）。EventSource 自带重连。
 * - 作品桥（p1-add-cosmos-works-service 3.1）：`fetchWorks / browseWorks / addWorks / pickWorks /
 *   updateWork / removeWork / openWork / revealWork`——容错形与 fetchScene 同款，
 *   消费方 = p2 星场面（呈现半区）。
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
 * 团队意图登记的有界等待窗（add-cosmos-agent-team-toggle 4.1）：autoSend 分支最多等在
 * 这么多毫秒，超时照常放行（`armTeamIntent` 的 AbortController 截止窗）。
 */
export const TEAM_INTENT_ARM_TIMEOUT_MS = 1200;

/**
 * 团队意图登记桥（add-cosmos-agent-team-toggle 4.1 / spec cosmos-actions「执行链路团队意图
 * 登记」）：`POST /team-intent { sessionId }` → `{ ok, serviceAvailable }`。
 * **有界超时**（`TEAM_INTENT_ARM_TIMEOUT_MS`）：autoSend 分支等待登记落地，超时照常放行。
 * 容错形与 `bindSession` 同款（网络/非 2xx/坏体 → `{ok:false, error}`），但
 * `serviceAvailable` 只在服务端**显式**返回 false 时为 false（缺席 toast 的唯一判据；
 * 超时/网络/旧宿主端点缺席一律按未知 → true，保持静默不阻断）。
 * @param {{sessionId?: string}} [input]
 * @returns {Promise<{ok: true, serviceAvailable: boolean, immediate?: boolean, armed?: boolean} |
 *          {ok: false, serviceAvailable: boolean, error: string}>}
 */
export async function armTeamIntent(input) {
  const sessionId = typeof input?.sessionId === "string" ? input.sessionId.trim() : "";
  if (!sessionId) return { ok: false, serviceAvailable: true, error: "invalid sessionId" };
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller !== null ? setTimeout(() => controller.abort(), TEAM_INTENT_ARM_TIMEOUT_MS) : null;
  try {
    const res = await fetch(API + "/team-intent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId }),
      ...(controller === null ? {} : { signal: controller.signal })
    });
    const body = await res.json().catch(() => ({}));
    const serviceAvailable = body?.serviceAvailable !== false;
    if (!res.ok || body?.ok !== true) {
      return { ok: false, serviceAvailable, error: body?.error || res.status + " " + res.statusText };
    }
    return {
      ok: true,
      serviceAvailable,
      immediate: body?.immediate === true,
      armed: body?.armed === true
    };
  } catch (error) {
    /* 超时/网络失败：serviceAvailable 未知（按 true）→ 零 toast、零阻断。 */
    return { ok: false, serviceAvailable: true, error: String(error?.message || error) };
  } finally {
    if (timer !== null) clearTimeout(timer);
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
 * 队列操作（入队 / 排序 / 移出 / 清空 / 暂停 / 恢复 / 失败残留重试）。
 * `retry` = failed 残留转回队首 queued（two-add-cosmos-queue-failed-entry-retry）；
 * 失败码 `not-failed` / `duplicate` / `limit` / `missing` 由服务端透出。
 * @param {"enqueue"|"reorder"|"remove"|"clear"|"pause"|"resume"|"retry"} action
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
 * 曲率队列桥（two-add-cosmos-proposal-warp 6.1/6.4）：与 `fetchQueue` / `queueAction` 同款
 * 容错形（网络/非 2xx/坏体 → `{ok:false, error}`）。
 */

/**
 * 全量曲率快照（`GET /warp`）：页面加载与收到 `warp-changed` 轻帧后拉取对账。
 * @returns {Promise<{ok: true, warp: {version: number, revisedAt: number, warps: object}} |
 *          {ok: false, error: string}>}
 */
export async function fetchWarp() {
  try {
    const res = await fetch(API + "/warp");
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.ok !== true || !body.warp) {
      return { ok: false, error: body?.error || res.status + " " + res.statusText };
    }
    return { ok: true, warp: body.warp };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

/**
 * 曲率操作（附着 / 单条移出 / 暂停 / 恢复）。
 * @param {"attach"|"remove"|"pause"|"resume"} action
 * @param {object} [body]
 * @returns {Promise<{ok: true, [key: string]: unknown} | {ok: false, error: string, reason?: string, message?: string}>}
 */
export async function warpAction(action, body = {}) {
  try {
    const res = await fetch(API + "/warp/" + action, {
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
 * 星座作品桥（p1-add-cosmos-works-service 3.1）：作品快捷入口的读面/写面/动作面。
 * 消费方 = p2 星场面（呈现半区）；容错形与 `fetchScene` / `queueAction` **同款**
 * （网络/非 2xx/坏体 → `{ok:false, error[, reason]}`，成功 → `{ok:true, …}` 载荷透传，
 * 无二次包装）。调用方保证**非阻断**消费：失败由呈现层 toast/降级，MUST NOT 抛出中断页面。
 *
 * 动作面（`openWork` / `revealWork`）**只传 `(wsId, workId)`**——服务端不接受任何裸路径，
 * 未登记的任意路径没有启动通道（spec「裸路径不可注入」）。
 */

/** @returns {Promise<{ok:true, error?:never}|{ok:false, error:string, reason?:string}>} */
function worksFailure(payload, res) {
  return {
    ok: false,
    error: payload?.error || res.status + " " + res.statusText,
    ...(typeof payload?.reason === "string" ? { reason: payload.reason } : {})
  };
}

/** 作品端点 POST 公共实现（容错形同 `queueAction`）。 */
async function postWorks(path, body) {
  try {
    const res = await fetch(API + "/works/" + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {})
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload?.ok !== true) return worksFailure(payload, res);
    return payload;
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

/**
 * 作品快照（`GET /works?wsId=`）：页面加载与收到 `works-changed` 轻帧后拉取对账。
 * 条目附服务端 `exists` 与 `displayName`（`name` 缺席 → `relPath` 文件名回落）。
 * @param {string} [wsId] 缺省 = 全量（全部在册星座）
 * @returns {Promise<{ok: true, version: number, works: object} | {ok: false, error: string, reason?: string}>}
 */
export async function fetchWorks(wsId) {
  try {
    const query = typeof wsId === "string" && wsId.trim() ? "?wsId=" + encodeURIComponent(wsId.trim()) : "";
    const res = await fetch(API + "/works" + query);
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload?.ok !== true || !payload.works) return worksFailure(payload, res);
    return payload;
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

/**
 * 根内目录浏览（`GET /works/browse?wsId=&dir=`）：作品拾取模态的面包屑数据源。
 * @param {string} wsId
 * @param {string} [dir] 工作区根内相对路径（缺省/空 = 根）
 * @returns {Promise<{ok: true, cwd: string, parent: string,
 *          entries: Array<{name: string, type: string, size?: number}>, truncated: boolean} |
 *          {ok: false, error: string, reason?: string}>}
 */
export async function browseWorks(wsId, dir) {
  try {
    const params = new URLSearchParams();
    params.set("wsId", typeof wsId === "string" ? wsId : "");
    if (typeof dir === "string" && dir.trim()) params.set("dir", dir.trim());
    const res = await fetch(API + "/works/browse?" + params.toString());
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload?.ok !== true) return worksFailure(payload, res);
    return payload;
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

/**
 * 系统文件选择器登记（`POST /works/pick`；用户修订：作品拾取改为宿主原生文件对话框，
 * MUST NOT 自建浏览模态）：服务端弹出平台原生多选对话框（初值 = 工作区根）、收敛根内
 * 相对路径后走与 `/works/add` 同源的整批原子登记。
 * - 取消/空选 → `{ok:true, cancelled:true, entries:[]}`（调用方静默）；
 * - 系统选择器不可用/失败 → `{ok:false, reason:"picker-unavailable"|"picker-failed"}`；
 * - 根外文件 → `out-of-root`；其余 `duplicate/limit/not-a-file/symlink` 同登记语汇.
 * @param {string} wsId
 * @returns {Promise<{ok: true, cancelled?: boolean, picked?: number, entries: Array<object>} |
 *          {ok: false, error: string, reason?: string, message?: string}>}
 */
export async function pickWorks(wsId) {
  return postWorks("pick", { wsId });
}

/**
 * 批量登记（`POST /works/add`，**整批原子**：任一非法即整批拒绝，`reason` 区分
 * `duplicate/limit/out-of-root/not-a-file/symlink`）。
 * @param {string} wsId
 * @param {string[]} relPaths 工作区相对路径（正/反斜杠均可，服务端归一）
 * @returns {Promise<{ok: true, entries: Array<object>} | {ok: false, error: string, reason?: string, relPath?: string}>}
 */
export async function addWorks(wsId, relPaths) {
  return postWorks("add", { wsId, relPaths: Array.isArray(relPaths) ? relPaths : [] });
}

/**
 * 改名/备注（`POST /works/update`）：`name`/`note` 全额覆盖——缺席或空白串 = 清除回落
 * （显示名回落 `relPath` 文件名，备注消失）。
 * @param {string} wsId
 * @param {string} workId
 * @param {{name?: string, note?: string}} [patch]
 * @returns {Promise<{ok: true, entry: object} | {ok: false, error: string, reason?: string}>}
 */
export async function updateWork(wsId, workId, patch = {}) {
  return postWorks("update", { wsId, workId, name: patch?.name, note: patch?.note });
}

/**
 * 移除条目（`POST /works/remove`）：只删条目，磁盘文件原样保留。
 * @param {string} wsId
 * @param {string} workId
 * @returns {Promise<{ok: true, removed: {id: string, relPath: string}} | {ok: false, error: string, reason?: string}>}
 */
export async function removeWork(wsId, workId) {
  return postWorks("remove", { wsId, workId });
}

/**
 * 启动/打开（`POST /works/open`）：`exec` 与其余类型均按资源管理器双击语义启动
 * （`cmd /c start`，可见控制台、不隐藏窗口）。
 * 即发即忘——返回成功只表示启动调用已发出，不含子进程生命周期，也不捕获输出。
 * @param {string} wsId
 * @param {string} workId
 * @returns {Promise<{ok: true, entry: object} | {ok: false, error: string, reason?: string}>}
 */
export async function openWork(wsId, workId) {
  return postWorks("open", { wsId, workId });
}

/**
 * 系统文件管理器中定位（`POST /works/reveal`）：不运行目标、无 `works-changed` 帧。
 * @param {string} wsId
 * @param {string} workId
 * @returns {Promise<{ok: true, entry: object} | {ok: false, error: string, reason?: string}>}
 */
export async function revealWork(wsId, workId) {
  return postWorks("reveal", { wsId, workId });
}

/**
 * @param {(frame: object) => void} onFrame 轻帧回调（{type:"proposals-changed"} |
 *        {type:"associations-changed"} | {type:"queue-changed"} | {type:"warp-changed"} |
 *        {type:"works-changed"}；坏帧忽略）
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
        frame?.type === "queue-changed" ||
        frame?.type === "warp-changed" ||
        frame?.type === "works-changed"
      ) {
        onFrame(frame);
      }
    } catch {
      /* 坏帧忽略 */
    }
  };
  return () => source.close();
}
