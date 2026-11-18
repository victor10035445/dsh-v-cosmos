/**
 * cosmos 路径配置节纯逻辑（step2-cosmos-openspec-path-setting 1.1 / spec
 * cosmos-path-setting「路径配置节（paths）」）。
 *
 * `paths` 节形状：`{ openspecPath: string|null, cosmosSpecDir: string|null }`——
 *  - `openspecPath`：路径令牌 `OPENSPEC_PATH`（契约见 cosmos-spec capability
 *    「路径令牌契约」）的解析值（openspec 技能仓库根）；
 *  - `cosmosSpecDir`：cosmos-spec canonical 目录（step3 provider 的扫描根；
 *    本提案一并建节以避免二次 schema 变更，见 design D1）。
 *
 * 净房口径 = **纯形态校验，不做存在性校验**（design D2）：
 *  - trim 后非空字符串 → 已配置，保留（trim 后的）字面量——正反斜杠、相对/绝对、
 *    `~` 前缀一律原样（拼接归一在渲染层契约 D3 处理）；
 *  - 非字符串 / 空串 / 空白串 / 缺席键 → `null`（未配置），SHALL NOT 抛错；
 *  - 输出恒为**两键显式**形状（节补丁缺席键按 `null` 处理）——快照回显形状稳定，
 *    「GET /config 回显 null」成立。
 *
 * 零 node 内建依赖：宿主半区（configstore.mjs）与客户端 bundle
 * （paths-settings.mjs → esbuild web 平台）共用本模块。
 */

/** paths 节的两个键（顺序 = 归一化输出键序）。 */
export const PATH_KEYS = ["openspecPath", "cosmosSpecDir"];

/** 未配置的恒定形状（冻结常量；归一化输出恒为新对象，此值仅作回退/比较基准）。 */
export const PATHS_UNSET = Object.freeze({ openspecPath: null, cosmosSpecDir: null });

/**
 * paths 节净房器（写路径与读路径同口径，spec「净房 MUST 为纯形态校验」）。
 * 键级独立：一键非法不影响同节其他键。恒返回**新对象**（两键显式，未配置键 null）。
 * @param {unknown} raw 任意来源（存储文档 / 组合层 entry config / 设置页节补丁）
 * @returns {{openspecPath: string|null, cosmosSpecDir: string|null}}
 */
export function normalizePaths(raw) {
  const source = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const key of PATH_KEYS) {
    const value = source[key];
    out[key] = typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  }
  return out;
}

/**
 * 组合层视图（快照 value/base）→ paths 节容错投影：视图缺席 / 形状非法 → 未配置形状。
 * @param {unknown} view
 * @returns {{openspecPath: string|null, cosmosSpecDir: string|null}}
 */
export function pathsSectionOf(view) {
  return normalizePaths(view !== null && typeof view === "object" ? view.paths : undefined);
}

/**
 * paths 节是否已配置（至少一键为非空白字符串）。
 * 存储侧用作对象节「非空」判定（seed/upgrade/ensureSeeded 不播种全 null 节），
 * 设置页用作保存载荷可空判断。
 * @param {unknown} paths
 * @returns {boolean}
 */
export function pathsConfigured(paths) {
  if (paths === null || typeof paths !== "object") return false;
  return PATH_KEYS.some((key) => typeof paths[key] === "string" && paths[key].trim() !== "");
}
