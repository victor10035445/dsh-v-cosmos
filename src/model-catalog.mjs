/**
 * 模型目录取值纯函数（add-cosmos-proposal-actions 5.2 / design D6）。
 *
 * 独立纯逻辑模块——设置页模型/级别下拉与会话模型菜单同源（`remote.session.modelCatalog`
 * 的 `value.groups`），test/settings-panel-smoke.mjs 直测。零依赖：不触网、不读 store。
 */

/** 已知推理等级顺序（官方 pi-ai / deepseek 两处适配器实测升序）。 */
export const EFFORT_ORDER = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * 级别默认最高：在已知等级序里取最大者；出现未知等级 id 时退回列表末项
 * （两处适配器实测均升序，未知 id 无法排序）。
 * @param {Array<{id?: string, name?: string}>|undefined} efforts
 * @returns {string|undefined} 空列表/无等级元数据 → undefined
 */
export function highestEffort(efforts) {
  const list = (Array.isArray(efforts) ? efforts : []).filter(
    (effort) => effort && typeof effort === "object" && typeof effort.id === "string" && effort.id !== ""
  );
  if (list.length === 0) return undefined;
  let best;
  let bestRank = -1;
  for (const effort of list) {
    const rank = EFFORT_ORDER.indexOf(effort.id);
    if (rank === -1) return list[list.length - 1].id;
    if (rank > bestRank) {
      bestRank = rank;
      best = effort.id;
    }
  }
  return best;
}

/**
 * 模型键编解码：`provider/model[/effort]`（受控值与 `<option>` value 的唯一出处，
 * 避免 JSON-in-DOM）。模型下拉用无等级形态（等级由级别下拉单独承载）。
 * @param {{provider?: string, model?: string, reasoningEffort?: string}|undefined} model
 * @returns {string} 形状不足 → ""
 */
export function modelKeyOf(model) {
  if (!model || typeof model !== "object") return "";
  const provider = typeof model.provider === "string" ? model.provider : "";
  const id = typeof model.model === "string" ? model.model : "";
  if (!provider || !id) return "";
  return typeof model.reasoningEffort === "string" && model.reasoningEffort !== ""
    ? `${provider}/${id}/${model.reasoningEffort}`
    : `${provider}/${id}`;
}

/**
 * 目录 → 下拉候选项展开：候选按目录顺序（provider 分组序）排列，label 形如
 * `provider.name · model.name`；键 = provider/model，值表同时给出该模型的等级列表。
 * @param {Array|undefined} groups 目录 `value.groups`
 * @returns {{items: Array<{key: string, label: string}>, byKey: Map<string, object>}}
 */
export function catalogOptions(groups) {
  const items = [];
  const byKey = new Map();
  for (const group of Array.isArray(groups) ? groups : []) {
    if (!group || typeof group !== "object") continue;
    const provider = typeof group.id === "string" ? group.id : "";
    if (!provider) continue;
    const providerName = typeof group.name === "string" && group.name !== "" ? group.name : provider;
    for (const entry of Array.isArray(group.models) ? group.models : []) {
      if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || entry.id === "") continue;
      const key = modelKeyOf({ provider, model: entry.id });
      if (byKey.has(key)) continue; // 重键先到先得
      const modelName = typeof entry.name === "string" && entry.name !== "" ? entry.name : entry.id;
      const efforts = (Array.isArray(entry.reasoning?.efforts) ? entry.reasoning.efforts : []).filter(
        (effort) => effort && typeof effort === "object" && typeof effort.id === "string" && effort.id !== ""
      );
      byKey.set(key, { provider, model: entry.id, label: `${providerName} · ${modelName}`, efforts });
      items.push({ key, label: `${providerName} · ${modelName}` });
    }
  }
  return { items, byKey };
}

/**
 * 设置行模型/级别下拉的取值面（design D6；纯函数，UI 直接消费、冒烟直测）：
 *  - `catalog` 不可达（null / status !== "ready"）→ `degraded: true`，候选表为空；
 *  - 已存绑定不在目录中 → `drift: true`（原样回显并标「不可用」，MUST NOT 被静默改写）；
 *  - 级别下拉仅当所选模型带等级元数据时可见（`levelVisible`），默认值为已存等级或
 *    该模型的最高等级；已存等级漂移 → `levelDrift: true`（原样回显标不可用）。
 * @param {{provider?: string, model?: string, reasoningEffort?: string}|undefined} bound
 * @param {{status?: string, groups?: Array}|null} catalog
 * @returns {{
 *   key: string, entry: object|undefined, drift: boolean, degraded: boolean,
 *   options: Array<{key: string, label: string}>, levelVisible: boolean,
 *   levelOptions: Array<object>, levelValue: string|undefined, levelDrift: boolean
 * }}
 */
export function describeButtonModel(bound, catalog) {
  const ready = catalog !== null && typeof catalog === "object" && catalog.status === "ready";
  const { items, byKey } = catalogOptions(ready ? catalog.groups : []);
  /* 模型下拉的受控键**不含等级**（等级由级别下拉单独承载）——带等级查表会永远落空。 */
  const key = bound === undefined || bound === null ? "" : modelKeyOf({ provider: bound.provider, model: bound.model });
  const entry = key ? byKey.get(key) : undefined;
  const efforts = entry === undefined ? [] : entry.efforts;
  const savedEffort = typeof bound?.reasoningEffort === "string" && bound.reasoningEffort !== "" ? bound.reasoningEffort : undefined;
  const knownEffort = savedEffort !== undefined && efforts.some((effort) => effort.id === savedEffort);
  return {
    key,
    entry,
    drift: key !== "" && entry === undefined,
    degraded: !ready,
    options: items,
    levelVisible: efforts.length > 0,
    levelOptions: efforts,
    levelValue: efforts.length === 0 ? undefined : savedEffort ?? highestEffort(efforts),
    levelDrift: savedEffort !== undefined && !knownEffort
  };
}
