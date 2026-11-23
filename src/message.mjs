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

/**
 * 星胚动作消息组装（add-cosmos-action-prestate-gate 3.1 / spec「星胚动作执行链路」①；
 * two-add-cosmos-proposal-warp 3.4 起抽到本模块供**宿主半区** proto 直投复用——原先只在
 * 浏览器产物链的 actions.mjs 中，宿主侧不可达）。
 *
 * 消息 = 按钮 `prompt`（纯文本，**无 @提案目录引用**——提案目录尚不存在；`prepend`
 * 恒忽略，「先后」无语义）；选中星胚组含多个推荐 slug 时，prompt 之后逐行附 slug
 * 清单（纯文本，单 slug/无 slug 组不附）。
 * @param {{prompt?: string}|null} button
 * @param {{slugs?: unknown}|null} card 星胚合并卡片（`slugs: string[]`）
 * @returns {string} 空串 = 无 prompt（调用方拒执行）
 */
export function assembleEmbryoMessage(button, card) {
  const prompt = typeof button?.prompt === "string" ? button.prompt : "";
  if (!prompt.trim()) return "";
  const slugs = Array.isArray(card?.slugs)
    ? card.slugs
      .filter((slug) => typeof slug === "string" && slug.trim())
      .map((slug) => slug.trim())
    : [];
  return slugs.length > 1 ? prompt + "\n" + slugs.join("\n") : prompt;
}
