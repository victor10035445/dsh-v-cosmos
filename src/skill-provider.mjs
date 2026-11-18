/**
 * cosmos-spec 技能 provider 纯逻辑（step3-cosmos-skill-provider-render 1.1 / 1.2）。
 *
 * 职责（全部可注入直测，宿主接线在 src/index.mjs）：
 *  - canonical 根解析序：`paths.cosmosSpecDir`（配置面，step2）→
 *    `<packageDir>/cosmos-spec`（存在时）→ null（空目录观测降级，design D1）；
 *  - 技能束枚举：canonical 根**即时子目录**与 `skills/` 子层（canonical 仓库实际布局
 *    `<cosmos-spec>/skills/<name>/SKILL.md`，见 cosmos-spec/README「变体技能（skills/）」）
 *    双层扫描 `<name>/SKILL.md`，同名以浅层为准；仅目录束（DSH 技能身份规则：
 *    嵌套递归发现不受支持，层级固定两层）；
 *  - frontmatter 解析：`name` / `description` / `when-to-use` / invocation 键
 *    （`disable-model-invocation` / `user-invocable`，缺省双 true——对齐 dsh-skill
 *    本地 provider 的净房口径）；
 *  - 令牌渲染纯函数 `renderSkillContent(text, resolveValue)`：严格实现 step1 契约
 *    （CONTRACT §9 / cosmos-spec capability「路径令牌契约」）——裸前缀整词匹配
 *    （右界紧跟分隔符、左界非路径延续字符）、大小写敏感、配置值去尾分隔符、
 *    拼接边界折叠为恰好一个分隔符且无 `//` 残留；未配置时正文头部附加警示行；
 *  - 读取兜底反馈组合（`resolveTokenPath` + `composeTokenFeedback`，design D4）；
 *  - canonical 目录表控制器 `createCosmosSpecProvider`：list()/get() + 根文件监听
 *    （recursive + ≥2s 防抖 → 注册期 invalidate()，design D5），解析根切换先摘旧
 *    监听再挂新监听，随 disposer 整体摘除。
 *
 * 渲染只作用于返回值（MUST NOT 触碰磁盘 canonical 文件）；`get()` 每次读盘，
 * 不自建缓存（registry 本身不缓存定义 → 配置热生效即改）。
 */

import { existsSync, readdirSync, readFileSync, statSync, watch as fsWatch } from "node:fs";
import { join } from "node:path";

/** provider 在 skills 注册层的名字（`runtime` 为保留名，此处不冲突）。 */
export const PROVIDER_NAME = "cosmos-spec";
/** 候选 rank：MUST < 100——本地接线各根既有 rank 100–600，同层内小者胜（design D2）。 */
export const PROVIDER_RANK = 50;
/** 路径令牌字面量（step1 契约唯一定义点：裸前缀形态，大小写敏感）。 */
export const PATH_TOKEN = "OPENSPEC_PATH";
/** 技能束入口文件名（目录束 `<name>/SKILL.md`）。 */
export const SKILL_ENTRY_FILENAME = "SKILL.md";
/** canonical watch 防抖（design D5 / 既有 openspec/ watch 纪律 ≥2s）。 */
export const CANONICAL_WATCH_DEBOUNCE_MS = 2000;

/** 路径分隔符集合（令牌右界；拼接边界折叠对象）。 */
const SEPARATORS = new Set(["/", "\\"]);
/**
 * 路径延续字符（design D3 整词左边界谓词）：前一字符属于此集合时 NOT 构成令牌出现
 * ——字母数字下划线（标识符字符）与 `/ \ . -`（路径延续）。行首 / 空白 / 引号 /
 * 反引号 / 括号等边界后合法。
 */
const PATH_CONTINUATION_CHARS = new Set([
  ..."abcdefghijklmnopqrstuvwxyz",
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  ..."0123456789",
  "_",
  "/",
  "\\",
  ".",
  "-"
]);

/** 技能名 kebab-case 校验（DSH 技能身份规则）。 */
export function isValidSkillName(name) {
  return typeof name === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
}

/** 去除配置值尾部连续分隔符（契约替换规则：拼接前去尾，MUST NOT 产生 `//` 残留）。 */
export function stripTrailingSeparators(value) {
  let end = value.length;
  while (end > 0 && SEPARATORS.has(value[end - 1])) end -= 1;
  return value.slice(0, end);
}

/**
 * 令牌出现判定（契约「令牌出现判定」+ design D3 整词边界谓词）：
 *  - `text` 在 `index` 处为 `OPENSPEC_PATH`（大小写敏感）；
 *  - 右界：紧随字符 MUST 为 `/` 或 `\`（裸令牌不构成出现）；
 *  - 左界：前一字段 MUST NOT 为路径延续字符（`xOPENSPEC_PATH/a`、
 *    `docs/OPENSPEC_PATH-notes.md` 的左接情形均不替换）。
 */
export function isTokenOccurrenceAt(text, index) {
  if (!text.startsWith(PATH_TOKEN, index)) return false;
  if (!SEPARATORS.has(text[index + PATH_TOKEN.length])) return false;
  if (index > 0 && PATH_CONTINUATION_CHARS.has(text[index - 1])) return false;
  return true;
}

/**
 * 令牌渲染纯函数（spec「令牌渲染」/ design D3）。`resolveValue` 为取解析值的函数或
 * 值本身（函数形态保证每次渲染取最新配置 = 热生效）。
 *  - 已配置（trim 后非空）：每个令牌出现处替换为「配置值去尾分隔符 + 恰好一个分隔符
 *    + 其后片段」——其后片段原样保留，边界连续分隔符折叠为恰好一个；
 *  - 未配置且正文含令牌：正文**原样**返回，头部附加一行未解析警示；
 *  - 正文不含令牌出现：原样返回（裸提及令牌名不触发警示）。
 */
export function renderSkillContent(text, resolveValue) {
  if (typeof text !== "string" || text === "") return typeof text === "string" ? text : "";
  const rawValue = typeof resolveValue === "function" ? resolveValue() : resolveValue;
  const configured = typeof rawValue === "string" && rawValue.trim() !== "";
  const value = configured ? stripTrailingSeparators(rawValue) : null;

  let out = "";
  let cursor = 0; // 已拼接进 out 的边界（其后片段仍未消费）
  let scan = 0; // 下一次搜索起点
  let hasToken = false;
  for (;;) {
    const index = text.indexOf(PATH_TOKEN, scan);
    if (index === -1) break;
    if (!isTokenOccurrenceAt(text, index)) {
      scan = index + PATH_TOKEN.length; // 形似而非出现（左界/右界不满足）→ 跳过
      continue;
    }
    hasToken = true;
    if (!configured) {
      scan = index + PATH_TOKEN.length;
      continue;
    }
    const separator = text[index + PATH_TOKEN.length];
    let rest = index + PATH_TOKEN.length + 1;
    while (rest < text.length && SEPARATORS.has(text[rest])) rest += 1;
    out += text.slice(cursor, index) + value + separator;
    cursor = rest;
    scan = rest;
  }
  if (!configured) {
    if (!hasToken) return text;
    return unsolvedTokenWarningLine() + "\n\n" + text;
  }
  return out + text.slice(cursor);
}

/** 未配置降级警示行（单行，正文头部；spec「未配置降级警示」场景）。 */
export function unsolvedTokenWarningLine() {
  return (
    "> ⚠️ 未解析警示（cosmos 路径令牌）：本技能含路径令牌 OPENSPEC_PATH，但尚未配置" +
    " openspec 路径——令牌路径按原样保留。请在 DSH 设置页「cosmos」中配置 openspec" +
    " 路径后重新加载本技能。"
  );
}

/**
 * 兜底路径解析（design D4）：以 `OPENSPEC_PATH` 开头（整词，同渲染谓词）的路径字符串
 * → 解析后的绝对路径；不构成出现或未配置 → null（调用方给指引反馈）。
 */
export function resolveTokenPath(rawPath, value) {
  if (typeof rawPath !== "string") return null;
  if (!isTokenOccurrenceAt(rawPath, 0)) return null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const trimmed = stripTrailingSeparators(value);
  const separator = rawPath[PATH_TOKEN.length];
  let rest = PATH_TOKEN.length + 1;
  while (rest < rawPath.length && SEPARATORS.has(rawPath[rest])) rest += 1;
  return trimmed + separator + rawPath.slice(rest);
}

/**
 * 兜底 block 反馈文本（spec「路径令牌读取兜底」：block 反馈是结果的唯一内容通道，
 * 原错误文本 MUST 内嵌进反馈；已配置给解析后路径 + 重试指引，未配置给设置指引）。
 * @param {{rawPath: string, resolved: string|null, originalError?: string}} input
 * @returns {string}
 */
export function composeTokenFeedback({ rawPath, resolved, originalError } = {}) {
  const errorText = typeof originalError === "string" && originalError ? originalError : "（无）";
  const head = "路径令牌读取兜底：工具入参以未解析令牌 OPENSPEC_PATH 开头且调用失败。";
  const pathLine = "失败路径：" + String(rawPath ?? "");
  if (typeof resolved === "string" && resolved) {
    return (
      head + "\n" +
      pathLine + "\n" +
      "解析后的绝对路径：" + resolved + "\n" +
      "请改用该路径重试。\n" +
      "原始错误信息：" + errorText
    );
  }
  return (
    head + "\n" +
    pathLine + "\n" +
    "尚未配置 openspec 路径：请在 DSH Web 设置页「cosmos」中配置 openspec 路径" +
    "（openspecPath）后重试。\n" +
    "原始错误信息：" + errorText
  );
}

/**
 * canonical 根解析序（design D1）：`paths.cosmosSpecDir` 配置值（trim 后非空）优先
 * ——配置即权威（值指向不存在目录 → 空观测，不静默回退，与设置页「目录不存在仍允许
 * 保存」的提示语义一致）；否则回退 `<packageDir>/cosmos-spec`（存在且为目录时）；
 * 两者皆缺 → null（空目录观测）。
 * @param {{paths?: {openspecPath?: string|null, cosmosSpecDir?: string|null}, packageDir: string, exists?: (path: string) => boolean}} input
 * @returns {string|null}
 */
export function resolveCosmosSpecRoot({ paths, packageDir, exists = defaultIo.exists } = {}) {
  const configured = typeof paths?.cosmosSpecDir === "string" && paths.cosmosSpecDir.trim() !== ""
    ? paths.cosmosSpecDir.trim()
    : null;
  if (configured) return configured;
  const fallback = join(String(packageDir ?? ""), "cosmos-spec");
  return exists(fallback) ? fallback : null;
}

/**
 * 最小 frontmatter 解析（1.1）：仅识别文档开头的 `---` 围栏块内的顶层 `key: value` 行
 * （嵌套/缩进行忽略，值两侧引号剥除）。键映射：`name` / `description` / `when-to-use` /
 * `disable-model-invocation` / `user-invocable`（布尔仅认字面 true/false，其余按缺省）。
 * 无围栏块 → `{ body: text }`。
 * @param {string} text
 * @returns {{name?: string, description?: string, whenToUse?: string,
 *   disableModelInvocation?: boolean, userInvocable?: boolean, body: string}}
 */
export function parseFrontmatter(text) {
  if (typeof text !== "string") return { body: "" };
  const openMatch = /^---[ \t]*\r?\n/.exec(text);
  if (!openMatch) return { body: text };
  const restStart = openMatch[0].length;
  const closeMatch = /^---[ \t]*\r?\n/m;
  const rest = text.slice(restStart);
  const close = closeMatch.exec(rest);
  if (!close) return { body: text };
  const block = rest.slice(0, close.index);
  const meta = { body: rest.slice(close.index + close[0].length) };
  for (const line of block.split(/\r?\n/)) {
    const match = /^([A-Za-z][A-Za-z0-9-]*)[ \t]*:[ \t]*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    const quoted = /^"(.*)"$/s.exec(value) ?? /^'(.*)'$/s.exec(value);
    if (quoted) value = quoted[1];
    if (key === "name" && value) meta.name = value;
    else if (key === "description" && value) meta.description = value;
    else if (key === "when-to-use" && value) meta.whenToUse = value;
    else if (key === "disable-model-invocation") {
      if (value === "true") meta.disableModelInvocation = true;
      else if (value === "false") meta.disableModelInvocation = false;
    } else if (key === "user-invocable") {
      if (value === "true") meta.userInvocable = true;
      else if (value === "false") meta.userInvocable = false;
    }
  }
  return meta;
}

/**
 * 技能束枚举（1.1）：canonical 根即时子目录层 + `skills/` 子层各扫一层
 * `<name>/SKILL.md`（同名浅层优先）；非法形态（非目录 / 无 SKILL.md / 名字非
 * kebab-case / description 缺失）跳过并告警——单束失败不拖垮目录观测。
 * @param {{root: string, io?: object, logger?: {warn?: Function}|null}} input
 * @returns {Array<{name: string, dir: string, file: string, description: string,
 *   whenToUse?: string, invocation: {modelInvocable: boolean, userInvocable: boolean}}>}
 */
export function enumerateSkillBundles({ root, io = defaultIo, logger = null } = {}) {
  if (typeof root !== "string" || !root) return [];
  const layers = [root, join(root, "skills")];
  const byName = new Map();
  for (const layer of layers) {
    let entries;
    try {
      entries = io.readdir(layer);
    } catch {
      continue; // 层目录缺席（如根下无 skills/）→ 跳过该层，不算失败
    }
    for (const entry of entries) {
      if (!entry?.isDirectory?.() || typeof entry.name !== "string") continue;
      if (entry.name.startsWith(".")) continue;
      const file = join(layer, entry.name, SKILL_ENTRY_FILENAME);
      let text;
      try {
        text = io.readText(file);
      } catch {
        continue; // 无 SKILL.md / 读失败 → 非技能束
      }
      const meta = parseFrontmatter(text);
      const name = isValidSkillName(meta.name) ? meta.name : (isValidSkillName(entry.name) ? entry.name : null);
      if (!name) {
        logger?.warn?.(`[dsh-v-cosmos] 技能束跳过（名字非法）：${file}`);
        continue;
      }
      if (typeof meta.description !== "string" || meta.description.trim() === "") {
        logger?.warn?.(`[dsh-v-cosmos] 技能束跳过（frontmatter 缺 description）：${file}`);
        continue;
      }
      if (byName.has(name)) continue; // 浅层同名优先
      byName.set(name, {
        name,
        dir: join(layer, entry.name),
        file,
        description: meta.description,
        ...(meta.whenToUse ? { whenToUse: meta.whenToUse } : {}),
        invocation: {
          modelInvocable: meta.disableModelInvocation !== true,
          userInvocable: meta.userInvocable !== false
        }
      });
    }
  }
  return [...byName.values()];
}

/* ── 默认 IO 面（node:fs；测试经 deps.io 注入桩） ── */

const defaultIo = {
  /** 目录存在性（非目录按缺席处理）。 */
  exists(path) {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  },
  readdir(dir) {
    return readdirSync(dir, { withFileTypes: true });
  },
  readText(file) {
    return readFileSync(file, "utf8");
  }
};

const defaultWatch = (target, options, listener) => fsWatch(target, options, listener);

/**
 * canonical 目录表控制器（2.1 / 2.2 的纯逻辑面）：产出 DSH `SkillProvider` 形状
 * （name / list / get）+ 根监听生命周期。
 *
 *  - `list()`：观测 signal → 对账根监听 → 解析根 → 枚举。canonical 缺席 / 扫描失败 /
 *    signal 已中止 → `{ candidates: [], complete: false }`（观测不完整、不缓存、不抛错，
 *    spec「canonical 缺席降级」）；扫描成功 → 候选数组（complete-discovery 简写）。
 *  - `get()`：每次读盘 + 渲染（不自建缓存 → 配置热生效即改）；读失败 → undefined
 *    （registry 视为不再可加载，不抛错）。
 *  - 根监听：解析根切换（cosmosSpecDir 配置变更）先摘旧监听再挂新监听；事件 ≥ 防抖
 *    → `invalidate()`（注册期控制柄，失效沿 skills/change 广播）；监听随 `dispose()`
 *    摘除。
 *
 * @param {object} options
 * @param {() => {openspecPath: string|null, cosmosSpecDir: string|null}} options.readPaths
 *     每次使用前取最新 paths 节（宿主接线注入；step2「配置热生效」）
 * @param {string} options.packageDir 插件包目录（canonical 回退根的基准）
 * @param {() => void} options.invalidate 注册期失效控制柄（control.invalidate）
 * @param {{warn?: Function}|null} [options.logger]
 * @param {{io?: object, watch?: Function, debounceMs?: number}} [options.deps] 测试注入
 * @returns {{name: string, list: Function, get: Function,
 *   reconcileWatch: Function, dispose: Function}}
 */
export function createCosmosSpecProvider(options = {}) {
  const { readPaths, packageDir, invalidate, logger = null } = options;
  const deps = options.deps ?? {};
  const io = deps.io ? { ...defaultIo, ...deps.io } : defaultIo;
  const watchFn = typeof deps.watch === "function" ? deps.watch : defaultWatch;
  const debounceMs = Number.isFinite(deps.debounceMs) ? Math.max(0, deps.debounceMs) : CANONICAL_WATCH_DEBOUNCE_MS;

  let watcher = null;
  let watchedRoot = null;
  let watchWarned = false;
  let debounceTimer = null;
  let disposed = false;

  const safeReadPaths = () => {
    try {
      const paths = typeof readPaths === "function" ? readPaths() : null;
      return paths !== null && typeof paths === "object"
        ? paths
        : { openspecPath: null, cosmosSpecDir: null };
    } catch {
      return { openspecPath: null, cosmosSpecDir: null };
    }
  };

  const resolveRoot = () => resolveCosmosSpecRoot({ paths: safeReadPaths(), packageDir, exists: io.exists });

  const closeWatcher = () => {
    if (watcher) {
      try {
        watcher.close();
      } catch {
        /* 已关闭 */
      }
      watcher = null;
    }
    watchedRoot = null;
  };

  const markDirty = () => {
    if (disposed || debounceTimer) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (!disposed) invalidate?.();
    }, debounceMs);
    debounceTimer.unref?.(); // 硬要求：不拖事件循环（对齐既有 watch 纪律）
  };

  /**
   * 根监听对账：解析根与在监根不同 → 先摘旧再挂新（spec「解析根切换先摘旧监听再挂
   * 新监听」）。挂载失败 → 告警一次并保持无监听（目录表退化为静态，正文渲染不受影响
   * ——get() 恒读盘）。
   * @param {{invalidateIfChanged?: boolean}} [callOptions] 配置变更钩子传 true：
   *        根切换时立即失效（不等防抖——目录身份已变）
   */
  const reconcileWatch = (callOptions = {}) => {
    if (disposed) return;
    const root = resolveRoot();
    if (root === watchedRoot) return;
    const hadWatch = watchedRoot !== null; // 曾有在监根且现在切换 → 真·根切换
    closeWatcher();
    if (root) {
      try {
        const handle = watchFn(root, { recursive: true, persistent: false }, markDirty);
        handle?.on?.("error", () => {
          closeWatcher();
          if (!watchWarned) {
            watchWarned = true;
            logger?.warn?.(`[dsh-v-cosmos] canonical 目录监听失败（目录表退化为静态）：${root}`);
          }
        });
        watcher = handle;
        watchedRoot = root;
      } catch (error) {
        if (!watchWarned) {
          watchWarned = true;
          logger?.warn?.(`[dsh-v-cosmos] canonical 目录监听启动失败：${String(error?.message || error)}`);
        }
      }
    }
    if (hadWatch && callOptions.invalidateIfChanged) invalidate?.();
  };

  return {
    name: PROVIDER_NAME,
    async list(lookupOptions = {}) {
      if (lookupOptions?.signal?.aborted) return { candidates: [], complete: false };
      reconcileWatch();
      const root = resolveRoot();
      if (!root) return { candidates: [], complete: false }; // 空目录观测（不完整、不缓存）
      let bundles;
      try {
        bundles = enumerateSkillBundles({ root, io, logger });
      } catch (error) {
        logger?.warn?.(`[dsh-v-cosmos] canonical 目录扫描失败：${String(error?.message || error)}`);
        return { candidates: [], complete: false };
      }
      return bundles.map((bundle) => ({
        name: bundle.name,
        description: bundle.description,
        ...(bundle.whenToUse ? { whenToUse: bundle.whenToUse } : {}),
        invocation: bundle.invocation,
        source: PROVIDER_NAME,
        provider: PROVIDER_NAME,
        rank: PROVIDER_RANK,
        locator: { name: bundle.name, dir: bundle.dir, file: bundle.file }
      }));
    },
    async get(candidate, lookupOptions = {}) {
      if (!candidate || lookupOptions?.signal?.aborted) return undefined;
      const locator = candidate?.locator;
      if (!locator || typeof locator.file !== "string") return undefined;
      let text;
      try {
        text = io.readText(locator.file);
      } catch {
        return undefined; // 不再可加载（registry 语义），不抛错
      }
      return {
        name: candidate.name,
        description: typeof candidate.description === "string" ? candidate.description : "",
        ...(candidate.whenToUse ? { whenToUse: candidate.whenToUse } : {}),
        invocation: candidate.invocation ?? { modelInvocable: true, userInvocable: true },
        source: candidate.source ?? PROVIDER_NAME,
        provider: PROVIDER_NAME,
        path: locator.file,
        resourceBase: { kind: "directory", path: locator.dir },
        content: renderSkillContent(text, () => safeReadPaths().openspecPath)
      };
    },
    reconcileWatch,
    dispose() {
      disposed = true;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      closeWatcher();
    }
  };
}
