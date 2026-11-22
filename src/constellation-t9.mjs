/**
 * T9（九键）挂载路径探测与挂载/释放编排（stage4-cosmos-v9-lshape design D4/D5）。
 *
 * 纯逻辑 + 桥契约调用：不 import React、不触 DOM，可被 Node 冒烟直测
 * （`test/t9-mount-smoke.mjs`）。宿主（星座浮窗组件）只负责：
 *  - 打开瞬间经 `t9EmbedModeOf` 探测并**锁定**本次挂载路径（开合期间不切换）；
 *  - 提供三块容器（parts 两容器 / legacy 单容器）与草稿 adapter；
 *  - 关合 / 卸载时经 `disposeT9Handle` 单句柄释放。
 *
 * 桥契约（`dsh-v-t9ime`，两插件独立：仅函数存在性探测）：
 *  - `embedPanel(container, options) → { dispose } | null`（旧版，stack 单容器，并排回退）；
 *  - `embedPanelParts({ candidates, input, ...options }) → { dispose } | null`（stage3+，parts 双容器，L 型）。
 * 任一容器非法 / 桥拒绝挂载（返回 null）/ 抛异常 → `mountT9Panel` 返回 null（宿主持久化
 * 「收起 V9」），MUST NOT 产生半挂载状态。
 */

/** 已释放句柄（幂等判据；WeakSet 不阻止句柄回收）。 */
const disposedHandles = new WeakSet();

/**
 * 读取 t9ime 暴露的可嵌入面板桥（`scope.__dshVT9IME__`）：桥缺席 / 畸形 / 无 `embedPanel`
 * → null（浮窗不呈现 V9 按钮，零降级噪音）。`scope` 缺省 `globalThis`（浏览器即 window）。
 * @param {object|null} [scope]
 * @returns {object|null}
 */
export function readT9Bridge(scope = globalThis) {
  if (scope === null || scope === undefined || typeof scope !== "object") return null;
  const bridge = scope.__dshVT9IME__;
  if (bridge === null || typeof bridge !== "object") return null;
  return typeof bridge.embedPanel === "function" ? bridge : null;
}

/**
 * 探测 T9 挂载路径（以桥函数存在性为准，MUST NOT 依赖 t9ime 内部实现）：
 *  - `"parts"`：`embedPanelParts` 可用 → L 型双容器；
 *  - `"legacy"`：只有 `embedPanel` → 并排回退；
 *  - `null`：无桥（不呈现 V9 按钮、不挂载任何容器）。
 * @param {unknown} bridge `window.__dshVT9IME__`（可能缺席/畸形）
 * @returns {"parts"|"legacy"|null}
 */
export function t9EmbedModeOf(bridge) {
  if (bridge === null || bridge === undefined || typeof bridge !== "object") return null;
  if (typeof bridge.embedPanel !== "function") return null;
  return typeof bridge.embedPanelParts === "function" ? "parts" : "legacy";
}

/**
 * 按锁定路径挂载 T9 面板。
 * @param {object} input
 * @param {object|null} input.bridge 桥（`window.__dshVT9IME__`）
 * @param {"parts"|"legacy"} input.mode 打开瞬间锁定的路径
 * @param {{candidates?: unknown, input?: unknown, legacy?: unknown}} [input.containers] 容器表
 * @param {object} [input.panelOptions] 透传桥的挂载选项（sessionId / adapter / instanceId / onClose）
 * @param {(error: unknown) => void} [input.onError] 异常诊断回调（桥抛错时呼叫；自身异常吞并）
 * @returns {{dispose?: Function} | null} 句柄；容器缺失 / 桥拒绝 / 抛异常 → null
 */
export function mountT9Panel(input = {}) {
  const { bridge = null, mode = null, containers = {}, panelOptions = {}, onError = null } = input;
  if (bridge === null || bridge === undefined || typeof bridge !== "object") return null;
  if (mode !== "parts" && mode !== "legacy") return null;
  try {
    if (mode === "parts") {
      if (typeof bridge.embedPanelParts !== "function") return null;
      const candidates = containers.candidates ?? null;
      const panelInput = containers.input ?? null;
      if (candidates === null || panelInput === null) return null;
      return bridge.embedPanelParts({ ...panelOptions, candidates, input: panelInput }) ?? null;
    }
    if (typeof bridge.embedPanel !== "function") return null;
    const legacy = containers.legacy ?? null;
    if (legacy === null) return null;
    return bridge.embedPanel(legacy, panelOptions) ?? null;
  } catch (error) {
    if (typeof onError === "function") {
      try {
        onError(error);
      } catch {
        /* 诊断回调异常不影响浮窗 */
      }
    }
    return null;
  }
}

/**
 * 单句柄释放（幂等：同一句柄只释放一次；异常吞并——容器已移除 / 面板已卸载等情形不抛出）。
 * 释放链路与旧路径同口径：开合翻转与组件卸载都走这里，MUST NOT 影响主 composer 面板。
 * @param {unknown} handle `mountT9Panel` 返回句柄
 * @returns {boolean} 本次是否真正调用了 dispose
 */
export function disposeT9Handle(handle) {
  if (handle === null || typeof handle !== "object") return false;
  if (typeof handle.dispose !== "function") return false;
  if (disposedHandles.has(handle)) return false;
  disposedHandles.add(handle);
  try {
    handle.dispose();
    return true;
  } catch {
    return false;
  }
}
