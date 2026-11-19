/**
 * dsh-v-cosmos — 动作消息组装纯逻辑（add-cosmos-action-queue 3.2 抽出的共享口径）。
 *
 * 宿主半区（queue/session-executor 投递）与浏览器半区（动作条执行链路）**共用同一口径**：
 *  `@<提案目录>` = `@` + 提案目录绝对路径（正斜杠）；`prepend` 为真 = 提示词在前。
 * 目录缺失（工作区 path 不可得）→ ""（调用方 MUST 拒绝执行，不产生半截 @引用）。
 *
 * 单独成模块的原因：`actions.mjs` 位于浏览器产物链（import panel/buttons），宿主半区的
 * `lib/index.js` 不打包它；把组装函数抽到零依赖模块，两端引用同一实现，避免口径漂移。
 */

/**
 * 组装目标消息（spec 两个组装场景 + prepend 语义重定义）。
 * @param {{prompt?: string, prepend?: boolean}} button
 * @param {{dir?: string}|null} card 面板卡片（含 dir）
 * @returns {string} 空串 = 目录不可得（调用方拒绝执行）
 */
export function assembleMessage(button, card) {
  const dir = typeof card?.dir === "string" ? card.dir : "";
  if (!dir) return "";
  const prompt = typeof button?.prompt === "string" ? button.prompt : "";
  const ref = "@" + dir;
  return button?.prepend === true ? `${prompt}\n${ref}` : `${ref}\n${prompt}`;
}
