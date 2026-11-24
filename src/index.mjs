/**
 * dsh-v-cosmos — 宿主半区。
 *
 * 星空骨架与关联引擎（add-cosmos-entry，design.md 架构图左半）：
 *  - GET  /api/dsh-v-cosmos/scene  星空骨架 JSON（星座/恒星/连线/星云/关联边；
 *                                 **会话不在其列**——会话事实走浏览器半区官方镜像）
 *  - GET  /api/dsh-v-cosmos/events SSE 轻帧广播：`proposals-changed` /
 *                                 `associations-changed` / `queue-changed` / `warp-changed` /
 *                                 `works-changed`（帧体不带载荷，客户端收到后自行重拉
 *                                 scene / queue / warp / works——hive 同款；心跳注释防代理断连）。
 *  - 提案动作自动执行队列（add-cosmos-action-queue 4.1 / design D6）：
 *                                 `GET /queue` 全量快照（每星座 `{paused, pausedAt, counts,
 *                                 entries}`；条目投影不含 prompt 正文，executing 子态
 *                                 `running|waiting` 由调度器活动信号推导）；
 *                                 `POST /queue/enqueue` `{wsId, proposalId, buttonName}`
 *                                 （按当前按钮配置落快照；入队时刻复验 `actionButtonVisible`
 *                                 同谓词，400 gate；重复/超限 400 duplicate|limit）；
 *                                 `POST /queue/reorder|remove|clear|pause|resume`（操作矩阵
 *                                 由 queue-store 校验，非法目标 400；写操作幂等）；变更后
 *                                 广播 `queue-changed` 轻帧。队列服务端权威（持久化
 *                                 `$DSH_HOME/storages/dsh-v-cosmos.queues.json`），执行走
 *                                 进程内 `sessionController` 直投（create → selectModel →
 *                                 rename → prompt(mode=queue)，见 session-executor.mjs），
 *                                 完成判定用宿主 agent 事件面 + 冷读双源（活体 agents.get
 *                                 优先 → sessionController.list 摘要）。
 *                                 会话服务不可用 → 条目 failed + 队列暂停，**不回落** hero。
 *  - 曲率引擎 / 曲率队列（two-add-cosmos-proposal-warp 4.1 / design D1、D7、D8）：
 *                                 `GET /warp` 全量快照（每星座 `{paused, pausedAt, counts,
 *                                 entries}`；条目投影不含 prompt 正文；executing 子态
 *                                 `running|waiting`、ready 的 `waiting-session` 由会话活动推导）；
 *                                 `POST /warp/attach` `{wsId, targetKind, targetKey,
 *                                 targetLabel?, anchorSlugs?, explorerSessionId?}` 按**当前
 *                                 曲率计划**落快照（计划悬空引用丢弃、星胚目标仅 proto 条目、
 *                                 重复附着 400 duplicate；星胚组已点燃 slug 立即展开）；
 *                                 `POST /warp/remove|pause|resume`（操作矩阵：launching/
 *                                 executing 锁定；无排序/无清空）。变更后广播 `warp-changed`
 *                                 轻帧。持久化 `$DSH_HOME/storages/dsh-v-cosmos.warp.json`；
 *                                 触发沿 = 目标相关动作任务完整结束（关联会话活动计数下降沿），
 *                                 直航走新建会话通道、proto 走既有探索会话直投（零 create）。
 *  - GET/PUT /api/dsh-v-cosmos/config 动作按钮配置（add-cosmos-proposal-actions）：
 *                                 GET 返回 `{status, revision, value, base, user, writable}`
 *                                 （base = 补丁层 entry config，user = 共享存储节，
 *                                 value = base ← user 逐节覆盖）；PUT = CAS 写入
 *                                 `{baseRevision, sections}`（null = unset 该节），
 *                                 200 / 409 conflict / 400 invalid / 503 busy / 500 io。
 *                                 存储 = `$DSH_HOME/dsh-v-cosmos.config.json`（configstore.mjs）。
 *  - POST /api/dsh-v-cosmos/archive-sessions 会话扫尾批量归档
 *                                 （add-cosmos-archive-session-sweep）：请求 `{sessionIds}`
 *                                 （条目非空、去重后 ≤32，空数组合法）；先按
 *                                 `archivedSessionIds` 预过滤（already-archived），其余按
 *                                 数组序**依次** `archiveSession`（**不带 stopActivity**——
 *                                 在跑工作只跳过不杀），逐会话 outcome
 *                                 archived / skipped+activity / missing / failed，恒 200；
 *                                 重复调用幂等。分流规则见 sweep.mjs。
 *  - POST /api/dsh-v-cosmos/rename-session 会话扫尾前缀改名：请求
 *                                 `{sessionId, prefix}`（prefix 非空、UTF-8 ≤64 字节）；
 *                                 读原题（sessionTitle.get）→ 空题回退 `prefix+未命名` /
 *                                 已带前缀幂等 no-op（unchanged）→ `sessionTitle.rename`
 *                                 （超长宿主按 maxTitleBytes 保头截尾、改名钉住标题）；
 *                                 200 `{outcome, title}` / 404 session/unknown /
 *                                 503 rename-unavailable（部署未挂载 session-title）/
 *                                 400 invalid / 500。sessionTitle 经 ctx.get 请求期惰性
 *                                 可选查找、**不入 inject**（design D9）。
 *  - POST /api/dsh-v-cosmos/bind-session 显式会话关联绑定（fix-cosmos-association-scope）：
 *                                 请求 `{sessionId, proposals}`（sessionId 原样保留；
 *                                 proposals trim/去重/≤16）；工作区复用启发式归属同源解析
 *                                 （registry sessionIds 反查优先 → 会话 cwd 相等兜底），
 *                                 解析不到 400 `workspace/unknown`；写入 = **替换**
 *                                 （该会话在该工作区的关联恰为清单，origin=explicit）；
 *                                 仅实际变更时落盘 + 广播 `associations-changed`（幂等
 *                                 重绑零写入零广播）；200 `{ok, bound}`。持有 explicit
 *                                 条目的会话被启发式两条规则压制（见 runHeuristics）。
 *  - POST /api/dsh-v-cosmos/render-skill-text 渲染服务端点
 *                                 （step5-cosmos-path-render-convergence）：外部技能加载
 *                                 机制把待注入正文整段提交 `{text}` → 按契约「路径令牌
 *                                 契约」渲染后返回 `{content, rendered, configured,
 *                                 containsToken, warning}`；渲染复用 provider `get()` 同一
 *                                 核心与同一配置读取面（状态化警示），不依赖 skills 服务；
 *                                 缺 text / 非字符串 → 400；零配置、零持久化、零工件写入。
 *  - POST /api/dsh-v-cosmos/dismiss-embryo 星胚移除（add-cosmos-embryo-dismiss 2.1 /
 *                                 CONTRACT §6.3：**仅用户显式点击驱动**，禁止任何推导触发）：
 *                                 请求 `{workspaceId, slug}`；守卫链依序执行 = workspace
 *                                 解析（未在册 → missing-workspace，不碰文件系统）→ slug
 *                                 白名单（`^[A-Za-z0-9][A-Za-z0-9._-]*$` 且不含 `..` 子串，
 *                                 不匹配 → failed 且**不解析任何路径**）→ 同名提案目录守卫
 *                                 （`changes/<slug>/` 存在 → guard-dir-exists，零删除）→
 *                                 锚点存在性（缺失 → already-missing，幂等）→ `unlinkSync`
 *                                 仅删 `pending-changes/<slug>.json`（捕 ENOENT 归
 *                                 already-missing，其余删除异常归 failed）；**恒 200** +
 *                                 `{outcome, reason?}`（deleted / already-missing /
 *                                 guard-dir-exists / missing-workspace / failed）。
 *                                 `.state.json` 与 `changes/<name>/` 恒不触碰。
 *  - cosmos-spec 技能 provider（step3-cosmos-skill-provider-render；step4 状态化；
 *    step5 last-good）：条件注入 `ctx.inject(['skills'])` 注册 SkillProvider（skills
 *    缺席仅该分支不激活）——扫描 canonical 目录（paths.cosmosSpecDir →
 *    <packageDir>/cosmos-spec → 空）产出目录表，同名 rank 50 压过本地接线（100–600）；
 *    层目录读取失败（扫描不可信）回退最近一次可信候选集并报告 complete=false（不跨根
 *    回退、dispose 清空）；`get()` 每次读盘并按契约渲染 `OPENSPEC_PATH` 令牌（未配置 /
 *    读取异常 → 原样 + 头部**状态化**警示行；读取状态源 = 配置存储装载结局，damaged 走
 *    warn-once 日志）；canonical 根 fs.watch（recursive + ≥2s 防抖）→ 注册期
 *    invalidate()（目录表自持失效，design D5）。
 *  - 路径令牌读取兜底（tools/post-execute）：路径类入参工具（含 glob/grep 的
 *    `path` 与 `pattern` 键）isError 且入参以 OPENSPEC_PATH 开头、命令类工具
 *    （bash/pwsh 的 `command`）isError 且命令串内出现令牌 → block 纠正反馈（已配置给
 *    解析路径 / 未配置给设置指引，解析根可解析时均附「cosmos-spec 技能目录扫描根」行，
 *    原错误文本内嵌）；其余恒 next() 透传（纯逻辑见 skill-provider.mjs，design D3–D6）。
 *  - 星座作品（p1-add-cosmos-works-service 2.1–2.8 / spec cosmos-works）：作品（脚本工具 /
 *    文档）的星座快捷入口服务端半区，存储 = 插件自有第四件
 *    `$DSH_HOME/storages/dsh-v-cosmos.works.json`（`{version, works: {<wsId>: {entries}}}`
 *    最小形；原子写、坏档回空）。
 *    · `GET  /works?wsId=` 全量/单星座快照（逐条 `exists` 核验；未知/空星座 → 空 entries）；
 *    · `GET  /works/browse?wsId=&dir=` 根内目录浏览（`cwd/parent/entries/truncated`，
 *      目录在前、500 截断；越界 `out-of-root`、符号链接 `symlink` 拒绝进入）；
 *    · `POST /works/add` `{wsId, relPaths[]}` 批量**整批原子**登记（任一非法整批拒绝：
 *      `duplicate/limit/out-of-root/not-a-file/symlink`）；
 *    · `POST /works/pick` `{wsId}` 宿主系统文件选择器多选 → 根内相对路径 → 整批登记
 *      （取消 `cancelled`、`picker-busy` 单飞；`options.pickFiles` 为测试注入点）；
 *    · `POST /works/update` `{wsId, workId, name?, note?}` 改名/备注（缺席/空白 = 清除回落）；
 *    · `POST /works/remove` `{wsId, workId}` 仅删条目不删文件（清空即回收容器键）；
 *    · `POST /works/open` `{wsId, workId}` 启动（**只收 id，不收裸路径**）：固定校验链
 *      在册 → resolve 包含性（含分隔符边界）→ 符号链接拒绝 → 文件判定 → 按 `kind` 分派；
 *      `exec`（exe/bat/cmd）与其余一切类型同一「资源管理器双击」启动语义——`cmd /c start`
 *      可见控制台、cwd = 条目目录（含 ps1，design D4 / exec 启动语义修复）；成功记
 *      `lastLaunchedAt` + 一帧；
 *      失败 reason：`entry-unknown/out-of-root/not-a-file/missing-on-disk/symlink/
 *      platform-unsupported`（非 Windows 结构化降级）；
 *    · `POST /works/reveal` `{wsId, workId}` 资源管理器 `/select` 定位（同源校验链、
 *      即发即忘、目标不被运行、零帧广播）。
 *    全部写盘路径经单点 `broadcastWorks()` 广播 `works-changed` 轻帧（帧体零载荷）。
 *  - 关联存储：$DSH_HOME/storages/dsh-v-cosmos.json（storage-json 同款语义：内存态即
 *    全量、temp 写 + rename 原子替换）。**MUST NOT 落盘到 openspec 工件**——
 *    工作区目录恒只读（零侵入纪律，任务 3.6 冒烟断言）；唯一例外 = `/dismiss-embryo`
 *    的用户显式动词单文件删除（见上）。旧名 dsh-cosmos 的存量
 *    存储首启回读迁移（读取回落，写入恒走新名）。
 *  - 点燃谱系台账（add-cosmos-panel-birthline-sort 2.1/2.2）：独立存储
 *    $DSH_HOME/storages/dsh-v-cosmos.birthlines.json（同族模式，关联/队列写入不覆盖）。
 *    每帧骨架装配时逐工作区做扫描差分（锚点在册 → 同名提案目录出现）捕获点燃事件并
 *    持久化 `{slug, embryoAt, embryoSessionId, ignitedMs}`；骨架 workspace 挂 `lineages`
 *    供 merge 层回查。**不落任何 openspec 工件**（CONTRACT 红线）；dismiss / 手工创建
 *    不误记，sighting TTL 7 天、行/sighting 上限 512。
 *  - 启发式 v1（design.md 优先级；restrict-association-heuristics 收紧信号口径）：
 *      1. 会话归属该工作区且近期**用户侧**消息出现 `@<提案目录>` **指派引用** → 关联
 *         （正文叙述 / 提案清单罗列 / assistant 回显一律不建立关联）；
 *      2. 提案目录出现（stat.birthtime，取不到回落 fs.watch 检测时刻）±30min
 *         窗口内该工作区**空闲**的唯一活跃会话 → 关联（判定时刻运行中的会话不接生新目录；
 *         等待决策的会话保留候选）；
 *    origin: "heuristic" 全部记录；已存在三元关联不重写（幂等，重扫零抖动）。
 *  - fs.watch 增量监听（生命周期对齐 hive「懒启动 / 补挂 / 摘除」请求期对账）：
 *    per-workspace `openspec/` recursive watch（add-celestial-states 2.3：从 changes/
 *    扩至 openspec/ 根，覆盖提案目录与 pending-changes/ 锚点；受监门槛 =
 *    existsSync(openspec)），事件 ≥2s 防抖后仅重扫脏工作区；骨架指纹变化 →
 *    proposals-changed，关联变化 → associations-changed。
 *  - 注册→骨架链路（add-cosmos-add-workspace D3）：`/scene` 请求期比对在册工作区
 *    **id 集合指纹**（`idSetFingerprint`）与骨架 id 集合，不一致 → 全量扫描——宿主
 *    workspaceRegistry 无注册事件，这是「新增/注销工作区」在插件边界内的唯一收敛点。
 *
 * 数据源边界（对齐 hive 数据流原则）：宿主半区只读 registry/agents 头信息与
 * openspec 工件（唯一写例外 = `/dismiss-embryo` 的锚点硬删除，仅用户点击驱动）；
 * displayTitle / pendingInteraction / todos 等投影字段只存在于
 * 浏览器半区，宿主不产出也不需要。
 */

import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, closeSync, writeSync, fdatasyncSync, renameSync, unlinkSync, watch, statSync, lstatSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSkeleton, scanProposal, assignmentProposalSlugs } from "./scan.mjs";
import { actionButtonVisible, normalizeButtons } from "./buttons.mjs";
import {
  createQueueStore,
  proposalDirPath,
  publicEntryOf,
  publicSnapshotOf
} from "./queue-store.mjs";
/* 曲率队列（two-add-cosmos-proposal-warp）：独立存储 + 门控接力状态机；曲率计划模型与
   设置页控制器在纯逻辑模块（configstore 节归一化 / 客户端共用同一实现）。 */
import {
  createWarpStore,
  hasActiveWarpTarget,
  publicWarpEntryOf,
  publicWarpSnapshotOf
} from "./warp-store.mjs";
import { createWarpScheduler } from "./warp-scheduler.mjs";
import {
  normalizeWarpPlan,
  resolveWarpPlanEntries,
  sanitizeWarpPlan
} from "./warp-plan.mjs";
/* 星座作品存储（p1-add-cosmos-works-service 1.1–1.3）：纯逻辑 + 原子写在独立模块，
   本文件只做端点接线与文件系统裁决（包含性/符号链接/文件类型）。 */
import {
  createWorksStore,
  normalizeRelPath,
  publicWorkOf
} from "./works-store.mjs";
import { createQueueScheduler } from "./queue-scheduler.mjs";
import {
  createQueueDeliverer,
  createSessionReader,
  createWarpProtoDeliverer
} from "./session-executor.mjs";
import { normalizeView, createConfigStore, resolveConfigStorePath } from "./configstore.mjs";
import {
  normalizeArchiveRequest,
  normalizeRenameRequest,
  classifyArchiveError,
  composePrefixedTitle,
  normalizeRenameResult
} from "./sweep.mjs";
import {
  ASSOC_VERSION,
  normalizeAssociations,
  pruneArchivedSessions,
  projectionOf,
  upsertAssociation,
  applyContextHeuristic,
  applyBirthtimeHeuristic,
  resolveWorkspacePath,
  normalizeBindRequest,
  applyBinding,
  explicitBoundSessionIds
} from "./associations.mjs";
/* 点燃谱系台账（add-cosmos-panel-birthline-sort 2.1/2.2）：纯逻辑在 birthline.mjs
   （扫描差分 / 点燃配对 / TTL 清理 / 投影），本文件只做持久化 store 接线与骨架注入。 */
import {
  emptyBirthlineDoc,
  lineagesOf,
  observeWorkspaceBirthlines,
  parseBirthlineDoc,
  serializeBirthlineDoc
} from "./birthline.mjs";
/* cosmos-spec 技能 provider 纯逻辑（step3-cosmos-skill-provider-render 1.1/1.2）：
   扫描 / 令牌渲染 / 兜底反馈组合全部在纯逻辑模块，本文件只做宿主接线。
   step4-cosmos-path-unset-visibility：命令串令牌词提取（findTokenCommandPath）与
   状态化读取接入同一纯逻辑面。
   step5-cosmos-path-render-convergence：渲染服务端点复用 renderSkillTextReport
   （与 provider get() 同一渲染核心与同一配置读取面，语义单点）。 */
import {
  PATH_TOKEN,
  composeTokenFeedback,
  createCosmosSpecProvider,
  findTokenCommandPath,
  isTokenOccurrenceAt,
  renderSkillTextReport,
  resolveTokenPath
} from "./skill-provider.mjs";

export const name = "dsh-v-cosmos";

/**
 * cordis 注入声明：`sessions` 是核心服务（活会话解析，恒在；先例 archived-session-gate
 * 的 `inject: ['agents', 'sessions', 'workspaceRegistry']`）。`sessionTitle` MUST NOT
 * 入 inject——它是可选插件服务，声明而未挂载会让 fiber 等待激活，未装
 * dsh-session-title 的部署中整个插件停摆（scene/events/config 全灭，design D9）；
 * 改经请求期 `ctx.get("sessionTitle")` 惰性可选查找，缺失 → rename 端点 503 降级。
 *
 * `tools`（step3-cosmos-skill-provider-render）：与 agents / sessions 同级核心服务
 * （恒在），供路径令牌读取兜底的 `tools/post-execute` 监听注册（design D5）。
 * `sessionController`（swap-cosmos-queue-native-executor）：队列执行通道的宿主核心服务
 * ——进程内建会话/选模型/改名/投递都经它（queen 同款必需引用，支持的宿主上恒在）。
 * 声明而未挂载属宿主异常老化，插件与 queen 同命运；运行期仍对方法残缺做探测兜底
 * （`session-executor.mjs`，D3），把「服务在但残缺」归显式失败而非抛穿。
 * `skills` **MUST NOT** 入顶层 inject——可选服务声明而未挂载会让整个插件在无 skills
 * 环境失活；provider 分支改走条件注入 `ctx.inject(['skills'], …)`：skills 缺席时仅
 * provider 不激活，其余插件能力照常（design D5 / spec「skills 服务缺席」场景）。
 */
export const inject = ["webServer", "agents", "sessionController", "workspaceRegistry", "sessions", "tools"];

const API_PREFIX = "/api/dsh-v-cosmos";
/** 旧插件名（品牌更名前的存储文件名，读取回落迁移用；写入恒走新名）。 */
const LEGACY_STORAGE_FILENAME = "dsh-cosmos.json";
const DOC_VERSION = 1;
/** fs.watch 事件防抖（design.md ≥2s）。 */
const SCAN_DEBOUNCE_MS = 2000;
/** 规则 1 近期上下文的事件窗口上限（防超长会话全量扫描）。 */
const CONTEXT_EVENT_WINDOW = 200;
/** 单工作区活跃会话参与启发式的数量上限（异常大会话面兜底）。 */
const HEURISTIC_SESSION_CAP = 64;

/**
 * 路径令牌兜底判定表（step3 design D4 / step4-cosmos-path-unset-visibility D3/D4；
 * spec「路径令牌读取兜底」）：工具名 → 判定规则列表（`key` = 入参键，`mode` = 判定形态）。
 *  - `prefix`：入参以令牌开头（整词谓词，`isTokenOccurrenceAt(raw, 0)`）——路径类工具
 *    read / write / edit（`file_path`）、str_replace_editor / glob / grep（`path`）；
 *  - `command`：命令串内令牌出现（`findTokenCommandPath` 全文扫描 + 路径词截取）——
 *    命令类工具 bash / pwsh（`command`），不要求命令开头（`cat OPENSPEC_PATH/x.md`
 *    的令牌在命令中部）。
 * glob / grep 的 `path` 与 `pattern` **同批纳入**（step4 D4）：pattern 形如令牌前缀
 * 开头是技能文本照抄形态；两键均按开头整词判定，任一命中即可，结果为 isError 才拦截
 * （零命中非 error 恒透传——真实空结果是合法观测）。
 */
const TOKEN_ARG_RULES = new Map([
  ["read", [{ key: "file_path", mode: "prefix" }]],
  ["write", [{ key: "file_path", mode: "prefix" }]],
  ["edit", [{ key: "file_path", mode: "prefix" }]],
  ["str_replace_editor", [{ key: "path", mode: "prefix" }]],
  ["glob", [{ key: "path", mode: "prefix" }, { key: "pattern", mode: "prefix" }]],
  ["grep", [{ key: "path", mode: "prefix" }, { key: "pattern", mode: "prefix" }]],
  ["bash", [{ key: "command", mode: "command" }]],
  ["pwsh", [{ key: "command", mode: "command" }]]
]);

/**
 * 兜底判定：按工具规则的判定形态取「令牌开头的路径词」（纯同步字符串判断，无异步 IO）。
 * 规则按声明序短路——首个命中即返回；无命中 / 非表内工具 → null（调用方 next() 透传）。
 * @param {unknown} toolName 工具名
 * @param {unknown} args 工具入参
 * @returns {string|null} 待解析的路径词（prefix 形态 = 原入参；command 形态 = 提取子串）
 */
function tokenPathOf(toolName, args) {
  if (typeof toolName !== "string") return null;
  const rules = TOKEN_ARG_RULES.get(toolName);
  if (!rules || args === null || typeof args !== "object") return null;
  for (const rule of rules) {
    const raw = args[rule.key];
    if (typeof raw !== "string") continue;
    if (rule.mode === "command") {
      const found = findTokenCommandPath(raw);
      if (found) return found;
    } else if (isTokenOccurrenceAt(raw, 0)) {
      return raw;
    }
  }
  return null;
}

/**
 * 插件包目录（canonical 回退根 `<packageDir>/cosmos-spec` 的基准）：自模块文件向上
 * 找最近的 package.json（lib/ 与 src/ 两种布局均命中包根），找不到即回落模块目录。
 */
const PACKAGE_DIR = (() => {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  let dir = moduleDir;
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return moduleDir;
})();

/**
 * 星胚移除的 slug 白名单（CONTRACT §6.3 / spec「星胚移除服务端端点」）：
 * `^[A-Za-z0-9][A-Za-z0-9._-]*$` **且不含 `..` 子串**。首字符非点 + 无路径分隔符本已使
 * 穿越不可达；显式拒 `..` 是防御纵深（并使「含 `..` 恒拒」的断言字面成立）。
 * 校验 MUST 先于任何路径解析——不合法输入恒不触达文件系统。
 * @param {unknown} slug
 * @returns {boolean}
 */
export function isDismissableSlug(slug) {
  return (
    typeof slug === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(slug) &&
    !slug.includes("..")
  );
}

/* ── 存储路径：$DSH_HOME（非空）优先，否则 ~/.dsh（对齐 hive storagePath 语义） ── */

/** 插件数据根（`$DSH_HOME` 非空优先，否则 `~/.dsh`）。 */
function dshHomeOf(env = process.env) {
  const envHome = typeof env.DSH_HOME === "string" ? env.DSH_HOME.trim() : "";
  return envHome || join(homedir(), ".dsh");
}

export function storagePath(env = process.env) {
  return join(dshHomeOf(env), "storages", "dsh-v-cosmos.json");
}

/**
 * 点燃谱系台账存储路径（`$DSH_HOME/storages/dsh-v-cosmos.birthlines.json`，
 * add-cosmos-panel-birthline-sort 2.1）：与关联存储（`dsh-v-cosmos.json`）／队列存储
 * （`dsh-v-cosmos.queues.json`）同族模式，各自独立文件——关联/队列写入互不覆盖台账。
 * @param {Record<string, string|undefined>} [env]
 * @returns {string}
 */
export function birthlineStoragePath(env = process.env) {
  return join(dshHomeOf(env), "storages", "dsh-v-cosmos.birthlines.json");
}

/** 旧名存储路径（品牌更名前；仅读取回落，SHALL NOT 写入）。 */
export function legacyStoragePath(env = process.env) {
  return join(dshHomeOf(env), "storages", LEGACY_STORAGE_FILENAME);
}

/**
 * 动作按钮配置的共享存储路径（`$DSH_HOME/dsh-v-cosmos.config.json`）。
 * 与关联存储（`storages/dsh-v-cosmos.json`）完全独立：互不读写对方数据。
 * @param {Record<string, string|undefined>} [env]
 * @returns {string}
 */
export function configStoragePath(env = process.env) {
  return resolveConfigStorePath({ env });
}

/**
 * 在册工作区 id 集合指纹（add-cosmos-add-workspace D3 注册→骨架对账键）：
 * 排序 join（集合等价，顺序无关；NUL 分隔防 id 拼接歧义）。指纹**仅含 id 集合**：
 * 注册/注销检测是本案范围，重命名（title）刻意不入指纹（触发面控制——重命名传播
 * 维持既有滞后行为）。
 * @param {Array<string>} ids
 * @returns {string}
 */
export function idSetFingerprint(ids) {
  const list = Array.isArray(ids) ? ids : [];
  const clean = [];
  for (const value of list) {
    const id = typeof value === "string" ? value : "";
    if (id) clean.push(id);
  }
  clean.sort();
  return clean.join("\u0000");
}

/* ── 原子读写（storage-json 同款：temp 写 + fsync + rename 替换） ── */

function atomicWrite(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(dirname(path), "." + randomUUID() + ".tmp");
  const fd = openSync(tmp, "w");
  try {
    writeSync(fd, text, 0, "utf8");
    try {
      fdatasyncSync(fd);
    } catch {
      /* 平台不支持时跳过（rename 已保证替换原子性） */
    }
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, path);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw error;
  }
}

/** 读关联文档；无文件/损坏/超版本 → 默认文档（version 1、空条目）。 */
export function parseStoredDoc(text) {
  const fallback = { version: DOC_VERSION, entries: [] };
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
    if (parsed.version !== DOC_VERSION) return fallback;
    const entries = normalizeAssociations(parsed.entries);
    return { version: DOC_VERSION, entries: entries ?? [] };
  } catch {
    return fallback;
  }
}

/* ── 工作区目录读回调（宿主半区触碰工作区文件的位置；读 + dismiss 端点单文件删除） ── */

const readers = {
  readChangesDir(workspacePath) {
    return readdirSync(join(String(workspacePath), "openspec", "changes"), { withFileTypes: true });
  },
  readArchiveDir(workspacePath) {
    return readdirSync(join(String(workspacePath), "openspec", "changes", "archive"), { withFileTypes: true });
  },
  readTasks(proposalDir) {
    return readFileSync(join(String(proposalDir), "tasks.md"), "utf8");
  },
  readBirthMs(proposalDir) {
    return statSync(String(proposalDir)).birthtimeMs;
  },
  readState(proposalDir) {
    return readFileSync(join(String(proposalDir), ".state.json"), "utf8");
  },
  readPendingDir(workspacePath) {
    /* cosmos-spec 契约 v1（add-celestial-states 2.3 / add-cosmos-embryo-cards 2.1）：
       原始条目列表（{name, by, at, sessionId?}），归一/非法跳过/目录优先剔除由 scan.mjs
       纯层完成。`sessionId` 为可选加法扩展——**三跳第一跳**，此处漏透传即静默退化为
       旧锚点（各自成卡），故原样携带、不做解释。 */
    const dir = join(String(workspacePath), "openspec", "pending-changes");
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && typeof entry.name === "string" && entry.name.endsWith(".json"))
      .map((entry) => {
        try {
          const parsed = JSON.parse(readFileSync(join(dir, entry.name), "utf8"));
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
          return { name: parsed.name, by: parsed.by, at: parsed.at, sessionId: parsed.sessionId };
        } catch {
          return null; // 非法文件跳过
        }
      })
      .filter(Boolean);
  }
};

/* ── JSON 响应 ── */

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

/* ── 近期上下文文本提取（规则 1 信号源；容错读面，异常一律空串） ── */

/**
 * 提取会话近期上下文文本：snapshotEvents 末窗（CONTEXT_EVENT_WINDOW）内全部
 * assistant/user 消息的 text 块拼接。事件形状漂移容忍：无 content 数组即跳过。
 * @param {object} agent ctx.agents.get(sessionId) 形
 * @returns {string}
 */
export function contextTextOf(agent) {
  try {
    const events = agent?.session?.snapshotEvents?.() ?? [];
    const window = typeof events.slice === "function" ? events.slice(-CONTEXT_EVENT_WINDOW) : [];
    const parts = [];
    for (const event of window) {
      const blocks = event?.data?.message?.content;
      if (!Array.isArray(blocks)) continue;
      for (const block of blocks) {
        if (block?.type === "text" && typeof block.text === "string" && block.text) parts.push(block.text);
      }
    }
    return parts.join("\n");
  } catch {
    return "";
  }
}

/**
 * 会话最近活动时刻：末个携带数值时间戳字段的事件；取不到 → now（把会话视为
 * 「正在进行」参与规则 2 窗口判定——宁可保守命中也不漏）。
 * @param {object} agent
 * @param {number} now
 * @returns {number}
 */
export function lastActivityMsOf(agent, now) {
  try {
    const events = agent?.session?.snapshotEvents?.() ?? [];
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];
      for (const key of ["at", "ts", "time", "timestamp"]) {
        const value = Number(event?.[key]);
        if (Number.isFinite(value) && value > 0) return value;
      }
    }
  } catch {
    /* fallthrough */
  }
  return now;
}

/**
 * 提取会话近期**用户侧**上下文文本（规则 1 指派信号源；restrict-association-heuristics 2.1）。
 *
 * 读取通道与 `contextTextOf` 分离（design D2「新增读取路径」）：宿主 dsh-session 的
 * `user/message` 事件 `data` **即消息本体**（无 `.message` 包装，文本块在 `data.content`），
 * 既有 `contextTextOf` 读 `data.message.content` 结构上看不到用户侧文本——因此规则 1 的
 * 指派 @ 引用必须走本通道。判定面 = 事件 `type`（不依赖消息体 role）：`type` 缺失或
 * 非 `user/message` 的事件一律跳过（宁缺勿滥：assistant 回显 / 工具结果不算指派）。
 * 容错读面：非数组 content / 文本块缺失 → 跳过，异常一律空串。
 * @param {object} agent ctx.agents.get(sessionId) 形
 * @returns {string}
 */
export function userContextTextOf(agent) {
  try {
    const events = agent?.session?.snapshotEvents?.() ?? [];
    const window = typeof events.slice === "function" ? events.slice(-CONTEXT_EVENT_WINDOW) : [];
    const parts = [];
    for (const event of window) {
      if (event?.type !== "user/message") continue;
      const blocks = event?.data?.content;
      if (!Array.isArray(blocks)) continue;
      for (const block of blocks) {
        if (block?.type === "text" && typeof block.text === "string" && block.text) parts.push(block.text);
      }
    }
    return parts.join("\n");
  } catch {
    return "";
  }
}

/* ── 插件主体 ── */

/**
 * @param {object} ctx 宿主 cordis 上下文
 * @param {object} [config] 补丁层 entry config（动作按钮配置的组合层 base：
 *        `buttons` 提案动作 + `constellationButtons` 星座动作 + `paths` 路径节，三节
 *        互不读写；共享存储的同名节分别覆盖各自 base。缺省 = 无自定义按钮/未配置路径）
 * @param {object} [options] 测试注入面
 * @param {object} [options.providerDeps] provider 纯逻辑依赖覆盖
 *        （packageDir / io / watch / debounceMs，见 skill-provider.mjs）
 */
export function apply(ctx, config, options = {}) {
  /** 关联条目（内存态即全量；持久化 = temp 写 + rename）。 */
  let entries = [];
  /** 点燃谱系台账文档（内存态即最新；持久化 = 独立 store 单 JSON 节，损坏/缺席按空台账兜底）。 */
  let birthlineDoc = emptyBirthlineDoc();
  /** 本轮骨架装配是否产生台账变更（落盘判定；谱系变化另经骨架指纹触发广播）。 */
  let birthlineDirty = false;
  /** 组合层视图（entry config；宿主半区不注册 settings 命名空间——design D7）。 */
  const baseView = normalizeView(config);
  /** 动作按钮配置共享存储（`$DSH_HOME/dsh-v-cosmos.config.json`）。 */
  const configStore = createConfigStore({ logger: ctx.logger ?? null });
  /* 测试注入面（provider 纯逻辑依赖覆盖：packageDir / io / watch / 防抖）。 */
  const providerDeps = options?.providerDeps ?? null;
  /** cosmosSpecDir 根切换钩子（provider 条件注入分支登记；config watch 防抖后执行）。 */
  const configChangeHooks = new Set();
  /** paths 节读取面（内存态即最新：configStore watch + 写路径同拍更新 state，step2「配置热生效」）。 */
  const readPaths = () => {
    const view = configStore.snapshot(baseView);
    return view?.value?.paths ?? { openspecPath: null, cosmosSpecDir: null };
  };
  /** 读取异常告警一次性闩（step4 D1：同一异常态只以 warn 告警一次，成功装载后清除）。 */
  let readErrorWarned = false;
  /**
   * 读取状态（spec「令牌渲染」状态化警示 / step4 D1）：`"ok" | "unset" | "read-error"`。
   * 状态源 = **配置存储装载结局**（design 勘误：`readPaths()` 链为纯内存同步读取、不抛错
   * ——共享配置存储损坏在 store 内部消化；真实可观测的读取失败信号是装载结局）：
   *  - `damaged`（正式文件与备份链均不可用、读取已降级到组合层）→ `"read-error"`，
   *    并以 warn 级告警一次（成功装载清除闩，下次再损坏再告警一次）；
   *  - 其余：`openspecPath` 空白 / 缺失 → `"unset"`，非空 → `"ok"`；
   *  - 外层 try/catch 仅作防御兜底（意外异常归 `"read-error"`）。
   * @returns {"ok"|"unset"|"read-error"}
   */
  const readPathsStatus = () => {
    try {
      if (configStore.loadOutcome() === "damaged") {
        if (!readErrorWarned) {
          readErrorWarned = true;
          ctx.logger?.warn?.(
            "[dsh-v-cosmos] 读取状态：共享配置存储装载失败（正式文件与备份链均不可用），路径令牌渲染降级为读取异常警示"
          );
        }
        return "read-error";
      }
      readErrorWarned = false; // 成功装载清除闩（自然恢复；下次再损坏再告警一次）
      const value = readPaths()?.openspecPath;
      return typeof value === "string" && value.trim() !== "" ? "ok" : "unset";
    } catch {
      return "read-error";
    }
  };
  /**
   * 兜底反馈扫描根桥接（step4 D5 作用域桥接）：provider 实例闭包在
   * `ctx.inject(['skills'], …)` 分支内，主作用域不可见 `providerHandle`——由该分支注册
   * 时赋值、卸载（dispose 回调）时置 null；桥缺席（skills 服务未激活 / 已卸载）→
   * `null`，反馈省略扫描根提示行而不阻断兜底主体。
   * @type {null | (() => (string|null))}
   */
  let providerResolveRoot = null;
  /** 桥接读取面：桥缺席 / 抛错 / 根不可解析 → null（反馈省略该行）。 */
  const skillRootHintOf = () => {
    if (typeof providerResolveRoot !== "function") return null;
    try {
      const root = providerResolveRoot();
      return typeof root === "string" && root !== "" ? root : null;
    } catch {
      return null;
    }
  };
  /* 尽早装载（provider list/get 与兜底监听先于主 effect 使用时也有值；幂等）。 */
  configStore.refresh();
  /** 星空骨架缓存（per-workspace 指纹增量比对）。 */
  let skeleton = { version: DOC_VERSION, generatedAt: 0, workspaces: [] };
  /** 已执行过至少一次全量扫描（懒启动门）。 */
  let scanned = false;
  const sseClients = new Set();
  let heartbeat = null;
  /** 提案目录首次检测时刻（birthMs 取不到时规则 2 的回落基准）。 */
  const firstSeenMs = new Map();
  /** 脏工作区路径集合（fs.watch 防抖后的重扫范围）。 */
  const dirtyWorkspaces = new Set();
  let scanTimer = null;
  /** per-workspace watcher 映射（key = workspaceId）。 */
  const watchers = new Map();

  const broadcast = (event) => {
    const line = "data: " + JSON.stringify(event) + "\n\n";
    for (const res of sseClients) {
      try {
        res.write(line);
      } catch {
        /* 写失败由 close 统一清理 */
      }
    }
  };

  const startHeartbeat = () => {
    if (heartbeat) return;
    heartbeat = setInterval(() => {
      for (const res of sseClients) {
        try {
          res.write(": ping\n\n");
        } catch {
          /* ignore */
        }
      }
    }, 25000);
    heartbeat.unref?.();
  };
  const maybeStopHeartbeat = () => {
    if (heartbeat && sseClients.size === 0) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };

  /** 关联持久化 + associations-changed 轻帧（帧体不带载荷）。 */
  const persistAssociations = () => {
    try {
      atomicWrite(storagePath(), JSON.stringify({ version: DOC_VERSION, entries }, null, 2));
    } catch (error) {
      ctx.logger?.warn?.("[dsh-v-cosmos] 关联存储落盘失败: %s", String(error?.message || error));
    }
    broadcast({ type: "associations-changed" });
  };

  /**
   * 点燃谱系台账持久化（add-cosmos-panel-birthline-sort 2.1）：独立 store 单 JSON 节，
   * UTF-8 无 BOM、temp 写 + rename 原子替换（与关联/队列存储同族模式）。台账变化不单独
   * 广播——谱系参与骨架下发，变化经 `skeletonFingerprint` 走既有 proposals-changed 链。
   */
  const persistBirthlines = () => {
    try {
      atomicWrite(birthlineStoragePath(), serializeBirthlineDoc(birthlineDoc, Date.now()));
    } catch (error) {
      ctx.logger?.warn?.("[dsh-v-cosmos] 谱系台账落盘失败: %s", String(error?.message || error));
    }
  };

  /**
   * 单工作区扫描差分观察（design D2/D3）：在同一帧的 pending / 活跃提案清单上登记
   * sighting + 点燃配对，返回该工作区的谱系投影（供骨架挂 `lineages`）。读取/观察失败
   * 一律按空清单兜底，SHALL NOT 中断骨架扫描。
   * @param {string} workspacePath 工作区路径（台账命名空间键）
   * @param {{stars?: Array<object>, pending?: Array<object>}} scanned 扫描产物
   * @param {number} now 判定时刻
   * @returns {Array<object>} 谱系行清单
   */
  const observeBirthlineFor = (workspacePath, scanned, now) => {
    try {
      const result = observeWorkspaceBirthlines(birthlineDoc, {
        workspacePath,
        pending: scanned?.pending,
        activeSlugs: Array.isArray(scanned?.stars) ? scanned.stars.map((star) => star?.id) : [],
        now
      });
      if (result.changed) {
        birthlineDoc = result.doc;
        birthlineDirty = true;
      }
      return lineagesOf(birthlineDoc, workspacePath);
    } catch (error) {
      ctx.logger?.warn?.("[dsh-v-cosmos] 谱系观察失败（按空谱系兜底）: %s", String(error?.message || error));
      return [];
    }
  };

  /**
   * 骨架装配上下文（关联投影 + 谱系观察回调同拍注入）：所有 `buildSkeleton` 调用点共用，
   * 避免「关联/谱系回填漏注入 → 下发旧数据」的旁路。
   * @param {number} [now] 生成时刻
   * @returns {object} buildSkeleton context
   */
  const skeletonContext = (now = Date.now()) => ({
    now,
    associations: projectionOf(entries),
    lineagesOf: (workspacePath, scanned) => observeBirthlineFor(workspacePath, scanned, now)
  });

  /**
   * 在册骨架重建（关联/谱系回填同拍；落盘一次）：调用方按需广播/返回。
   * @param {number} [now]
   * @returns {object} 新骨架
   */
  const rebuildSkeleton = (now = Date.now()) => {
    birthlineDirty = false;
    const next = buildSkeleton(listWorkspaces(), readers, skeletonContext(now));
    if (birthlineDirty) persistBirthlines();
    birthlineDirty = false;
    return next;
  };

  /**
   * 在册工作区清单（registry 未就绪/抛错 → null，**不当作空集**）：注册指纹对账
   * MUST NOT 把「registry 暂不可达」误判为「全部注销」而清空骨架。
   */
  const listedWorkspaces = () => {
    try {
      const list = ctx.workspaceRegistry?.list?.();
      return Array.isArray(list) ? list : null;
    } catch {
      return null;
    }
  };

  /** 在册工作区清单（registry 不可达 → 空表，不抛错）。 */
  const listWorkspaces = () => listedWorkspaces() ?? [];

  /** 工作区实体 id（`id ?? workspaceId` 双写兜底，对齐 hive workspaceEntityId）。 */
  const workspaceEntityId = (workspace) => {
    const id = typeof workspace?.id === "string" && workspace.id ? workspace.id : "";
    if (id) return id;
    const alt = typeof workspace?.workspaceId === "string" && workspace.workspaceId ? workspace.workspaceId : "";
    return alt;
  };

  /** 归档会话集合（registry 缺席 → 空集，不剪）。 */
  const archivedSessionIds = () => {
    try {
      return new Set(ctx.workspaceRegistry?.archivedSessionIds ?? []);
    } catch {
      return new Set();
    }
  };

  /**
   * 会话标题服务惰性可选查找（add-cosmos-archive-session-sweep design D9）：
   * `sessionTitle` 是可选插件服务，不入 inject；请求期经 `ctx.get` 沙箱查找
   * （无需声明），缺失 / 查找失败 → undefined（rename 端点 503 rename-unavailable）。
   */
  const sessionTitleService = () => {
    try {
      return ctx.get?.("sessionTitle") ?? undefined;
    } catch {
      return undefined;
    }
  };

  /** 活会话对象解析（rename 要求 exact live session；缺席 → 404 session/unknown）。 */
  const liveSessionOf = (sessionId) => {
    try {
      return ctx.sessions?.get?.(sessionId) ?? undefined;
    } catch {
      return undefined;
    }
  };

  /** 会话 agent 对象容错解析（ctx.agents 镜像；缺席/抛错 → null）。 */
  const agentOf = (sessionId) => {
    try {
      return ctx.agents?.get?.(sessionId) ?? null;
    } catch {
      return null;
    }
  };

  /**
   * 会话→工作区归属解析（bind-session 端点复用启发式同源逻辑）：
   * registry `sessionIds` 反查优先，回落会话 cwd（`agent.session.header.cwd`）与工作区
   * path 相等；解析不到 → null（宿主映射 400 workspace/unknown）。
   */
  const resolveSessionWorkspace = (sessionId) => {
    const header = agentOf(sessionId)?.session?.header ?? null;
    const cwd = typeof header?.cwd === "string" ? header.cwd : "";
    return resolveWorkspacePath({ sessionId, cwd, workspaces: listWorkspaces() });
  };

  /**
   * workspaceId → 工作区路径（dismiss 端点守卫链第一跳）：在册工作区按实体 id 反查，
   * 未登记 / 路径空 → null（端点映射 missing-workspace，不触碰文件系统）。
   */
  const workspacePathOf = (workspaceId) => {
    if (typeof workspaceId !== "string" || !workspaceId) return null;
    for (const workspace of listWorkspaces()) {
      if (workspaceEntityId(workspace) !== workspaceId) continue;
      const path = typeof workspace?.path === "string" ? workspace.path : "";
      if (path) return path;
    }
    return null;
  };

  /**
   * 该工作区的活跃会话面（启发式输入）：registry sessionIds ∩ ctx.agents 在册、
   * 非子代理（header.origin）、非 blank（header 可见时）、未归档。
   * @returns {Array<{ sessionId: string, agent: object, lastActivityMs: number }>}
   */
  const activeSessionsOf = (workspacePath, now) => {
    const workspace = listWorkspaces().find((ws) => typeof ws?.path === "string" && ws.path === workspacePath);
    const ids = Array.isArray(workspace?.sessionIds) ? workspace.sessionIds : [];
    const archived = archivedSessionIds();
    const out = [];
    for (const sessionId of ids) {
      if (archived.has(sessionId)) continue;
      const agent = agentOf(sessionId);
      if (!agent) continue;
      const header = agent?.session?.header ?? null;
      if (header?.origin === "subagent") continue; // 无人机不渲染也不计活跃度（v1）
      if (header?.blank === true) continue; // blank 会话（header 可见时的防御检查）
      out.push({ sessionId, agent, lastActivityMs: lastActivityMsOf(agent, now) });
      if (out.length >= HEURISTIC_SESSION_CAP) break;
    }
    return out;
  };

  /* ── 提案动作自动执行队列（add-cosmos-action-queue 4.1）：服务端权威 ──
     队列状态与调度器是服务端单例（多窗口/独立窗口共享；页面全关也照常推进）；浏览器半区
     纯投影（`queue-changed` 轻帧 → 客户端拉 `GET /queue` 对账）。

     执行通道 = 进程内 `sessionController` 直投（swap-cosmos-queue-native-executor：零配置、
     零外部插件；链 create → selectModel → rename → **bindAssociation（显式关联绑定，
     bind-queue-sessions-to-target）** → prompt(mode=queue) 见 session-executor.mjs）。
     完成判定信号面 = 宿主 agent 事件面（`agent/status` + 两道交互瀑布，prepend 观测）+ 重启
     冷读双源（活体 `ctx.agents.get(id).status` 优先 → 非活体 `sessionController.list()` 摘要）。 */

  /** 队列存储（`$DSH_HOME/storages/dsh-v-cosmos.queues.json`，原子写）。 */
  const queueStore = createQueueStore({ logger: ctx.logger ?? null });

  /**
   * 队列投递的显式关联绑定（bind-queue-sessions-to-target 2.1 / design D2–D5）：
   * 进程内直调关联写入单点（不经 HTTP bind-session 端点——队列在服务端进程内，具备直调
   * 条件），范围 = 工作区**路径**指纹 × 新会话 id，清单 = `[条目目标提案]`。写纪律与
   * bind-session 端点同拍：**仅 `changed` 时**收尾（scanned 时重建在册骨架 → 持久化 →
   * `associations-changed` 广播）；幂等重绑零抖动。全部失败静默降级（不抛穿投递链）：
   * 工作区路径解析不到或写入异常只 warn 记录，该会话退回启发式推断——对齐动作条
   * `bindExplicitAssociation` 的降级纪律，MUST NOT 影响条目成败判定。
   *
   * @param {{sessionId?: string, proposal?: string, workspaceId?: string}} [input]
   *        workspaceId = 条目工作区 id（投递器透传；本函数据此解析工作区路径）
   */
  const bindQueuedSession = ({ sessionId, proposal, workspaceId } = {}) => {
    try {
      const id = typeof sessionId === "string" ? sessionId.trim() : "";
      const name = typeof proposal === "string" ? proposal.trim() : "";
      if (!id || !name) return;
      const workspace = workspacePathOf(workspaceId);
      if (!workspace) {
        /* 解析不到视同绑定失败：静默跳过（不阻断投递），但保留可诊断的降级记录。 */
        ctx.logger?.warn?.(
          "[dsh-v-cosmos] 队列会话关联绑定跳过：工作区路径解析不到（%s）",
          String(workspaceId ?? "")
        );
        return;
      }
      const result = applyBinding(entries, { workspace, sessionId: id, proposals: [name] });
      entries = result.entries;
      if (!result.changed) return;
      /* 关联投影随骨架下发：已在册骨架需同拍重建（客户端收到 associations-changed 后
         会重拉 /scene——不回填即返回旧边）。与 bind-session 端点逐字同拍。 */
      if (scanned) {
        skeleton = rebuildSkeleton();
      }
      persistAssociations();
    } catch (error) {
      ctx.logger?.warn?.(
        "[dsh-v-cosmos] 队列会话关联绑定失败（不阻断投递）: %s",
        String(error?.message || error)
      );
    }
  };

  /** 投递器（失败显式返回原因；MUST NOT 回落前台 hero 通道）。 */
  const deliverQueuedEntry = createQueueDeliverer({
    sessionController: ctx.sessionController,
    agents: ctx.agents,
    logger: ctx.logger ?? null,
    bindAssociation: bindQueuedSession
  });

  /** 冷读器（重启对账：活体 status 优先 → list 摘要；waiting 恒 false）。 */
  const readQueueSession = createSessionReader({
    sessionController: ctx.sessionController,
    agents: ctx.agents
  });

  /**
   * 该提案的「活动信号」（服务端口径）：关联存储中属于该提案的会话里，处于 running 或
   * 等待决策的条数。与客户端 `act`（busy ∨ waiting ∨ 委托忙碌计数）同口径的**服务端可达
   * 部分**——委托忙碌服务端不可见，按 0 计（spike-findings §1.3 已如实标注）。
   */
  const queueActivityActOf = (wsId, proposalId) => {
    const workspacePath = workspacePathOf(wsId);
    if (!workspacePath) return 0;
    let act = 0;
    for (const entry of entries) {
      if (entry.workspace !== workspacePath || entry.proposal !== proposalId) continue;
      const state = scheduler.sessionStateOf(entry.sessionId);
      if (state !== null && (state.running === true || state.waiting > 0)) act += 1;
    }
    return act;
  };

  /** 执行时刻复验（与动作条渲染门控同一谓词 `actionButtonVisible`；不过 → skipped）。 */
  const reverifyQueuedEntry = (entry) => {
    const preState = typeof entry?.button?.preState === "string" ? entry.button.preState : "";
    if (!preState) return { ok: true };
    const proposal = scanProposal(entry.proposalId, entry.proposalDir, readers.readTasks, readers.readBirthMs, readers.readState);
    const act = queueActivityActOf(entry.wsId, entry.proposalId);
    return actionButtonVisible({ preState }, { lifecycle: proposal.lifecycle, act })
      ? { ok: true }
      : { ok: false, reason: "prestate-drift" };
  };

  /** 队列变更轻帧（帧体不带载荷）。 */
  const broadcastQueue = () => broadcast({ type: "queue-changed" });

  /** 调度器（单飞 / 暂停只挡 advance / 完成判定 / 重启对账）。 */
  const scheduler = createQueueScheduler({
    store: queueStore,
    deliver: deliverQueuedEntry,
    readSession: readQueueSession,
    reverify: reverifyQueuedEntry,
    isArchived: (sessionId) => archivedSessionIds().has(sessionId),
    onChange: broadcastQueue,
    notify: (message) => {
      ctx.logger?.warn?.("[dsh-v-cosmos] 队列：%s", String(message));
    },
    logger: ctx.logger ?? null
  });

  /** 对外快照（`GET /queue`）：叠加调度器活动信号（executing → running/waiting 子态）。 */
  const queueViewSnapshot = () => ({
    ...publicSnapshotOf(queueStore.doc, (wsId, entry) => scheduler.activityOf(wsId, entry)),
    revisedAt: queueStore.revisedAt
  });

  /* ── 曲率队列（two-add-cosmos-proposal-warp 4.1–4.4）：服务端权威 ──
     曲率 = 附着在目标上的计划 + 反应式门控接力引擎（design D1：独立存储/独立调度器，
     不寄生脉冲队列）。状态与调度器是服务端单例；浏览器半区纯投影（`warp-changed`
     轻帧 → 客户端拉 `GET /warp` 对账）。

     触发沿（design D2）= 「与目标相关的动作任务完整结束」：与服务端关联存储 × 共享会话
     态缓存（脉冲调度器的 `sessionStateOf`，**零第二份缓存**）聚合出每目标的活动计数，
     计数 >0 → 归 0 的下降沿喂 `warpScheduler.onTaskSettled`；提案状态翻转本身不触发。 */

  /** 曲率存储（`$DSH_HOME/storages/dsh-v-cosmos.warp.json`，原子写）。 */
  const warpStore = createWarpStore({ logger: ctx.logger ?? null });

  /** 曲率直航投递器（提案目标：新建会话；标题前缀「曲率」，关联绑定与脉冲同口径）。 */
  const deliverWarpProposal = createQueueDeliverer({
    sessionController: ctx.sessionController,
    logger: ctx.logger ?? null,
    bindAssociation: bindQueuedSession,
    titlePrefix: "曲率"
  });

  /** proto 直投器（星胚目标：既有探索会话，零 create/rename/草稿；spike-findings §1.4）。 */
  const deliverWarpProto = createWarpProtoDeliverer({
    sessionController: ctx.sessionController,
    logger: ctx.logger ?? null
  });

  /** 曲率投递入口：按目标形态分派。 */
  const deliverWarpEntry = (entry) => {
    if (entry?.targetKind === "embryo") return deliverWarpProto(entry);
    return deliverWarpProposal({
      wsId: entry.wsId,
      proposalId: entry.targetKey,
      proposalDir: entry.proposalDir,
      button: entry.button
    });
  };

  /**
   * 该提案的服务端活动计数（与 `queueActivityActOf` 同口径：关联存储中属于该提案的
   * 会话里 running ∨ 等待决策的条数；委托忙碌服务端不可见，按 0 计）。
   */
  const warpActivityActOf = (wsId, proposalId) => {
    const workspacePath = workspacePathOf(wsId);
    if (!workspacePath) return 0;
    let act = 0;
    for (const entry of entries) {
      if (entry.workspace !== workspacePath || entry.proposal !== proposalId) continue;
      const state = scheduler.sessionStateOf(entry.sessionId);
      if (state !== null && (state.running === true || state.waiting > 0)) act += 1;
    }
    return act;
  };

  /** 探索会话是否仍被占用（proto 安静投递门：running ∨ 等待决策 → 保持「等待会话空闲」）。 */
  const explorerBusy = (entry) => {
    const sessionId = typeof entry?.explorerSessionId === "string" ? entry.explorerSessionId : "";
    if (!sessionId) return false;
    const state = scheduler.sessionStateOf(sessionId);
    return state !== null && (state.running === true || state.waiting > 0);
  };

  /**
   * 曲率门控复查（同步）：与动作条渲染同一谓词 + 磁盘重扫。
   *  - proposal：`preState` 匹配（未设恒过）∧ 沉睡（act === 0）∧ 提案目录存在；
   *  - embryo：目标锚点仍存在（proto 生命周期由锚点存在性表达）；会话空闲由点火时刻
   *    安静门另行复验（ready 保留「等待会话空闲」子态）。
   */
  const warpGate = (entry) => {
    const wsPath = workspacePathOf(entry.wsId);
    if (!wsPath) return { ok: false, reason: "workspace/unknown" };
    if (entry.targetKind === "embryo") {
      const anchors = Array.isArray(entry.anchorSlugs) ? entry.anchorSlugs : [];
      const alive = anchors.some(
        (slug) => typeof slug === "string" && slug
          && existsSync(join(wsPath, "openspec", "pending-changes", slug + ".json"))
      );
      return alive ? { ok: true } : { ok: false, reason: "target-gone" };
    }
    const dir = typeof entry.proposalDir === "string" ? entry.proposalDir : "";
    if (!dir || !existsSync(dir)) return { ok: false, reason: "proposal/unknown" };
    const proposal = scanProposal(entry.targetKey, dir, readers.readTasks, readers.readBirthMs, readers.readState);
    const act = warpActivityActOf(entry.wsId, entry.targetKey);
    const preState = typeof entry.button?.preState === "string" ? entry.button.preState : "";
    if (preState && !actionButtonVisible({ preState }, { lifecycle: proposal.lifecycle, act })) {
      return { ok: false, reason: "prestate-drift" };
    }
    if (act > 0) return { ok: false, reason: "busy" };
    return { ok: true };
  };

  /** 曲率变更轻帧（帧体不带载荷）。 */
  const broadcastWarp = () => broadcast({ type: "warp-changed" });

  /**
   * 星胚展开（design D5）：proto 任务收尾 / 附着时已点燃 slug 即展开——按**展开时刻**
   * 曲率计划解析非 proto 动作条，为每个已点燃提案（磁盘存在提案目录）附着（grayed 入场）。
   * 目标已有非终态条目（用户先行附着/另一 proto 已展开）→ 跳过。快照外 slug 不吸入。
   *
   * @param {{wsId: string, anchorSlugs: string[]}} input
   * @returns {{targets: Array<{wsId: string, targetKey: string}>, attached: number}}
   */
  const expandWarpEmbryo = (input) => {
    const wsId = typeof input?.wsId === "string" ? input.wsId : "";
    const wsPath = workspacePathOf(wsId);
    const anchors = Array.isArray(input?.anchorSlugs) ? input.anchorSlugs : [];
    if (!wsPath || anchors.length === 0) return { targets: [], attached: 0 };
    const ignited = anchors.filter(
      (slug) => typeof slug === "string" && slug && existsSync(join(wsPath, "openspec", "changes", slug))
    );
    if (ignited.length === 0) return { targets: [], attached: 0 };
    const view = configStore.snapshot(baseView);
    const plan = view?.value?.warpPlan;
    const buttons = Array.isArray(view?.value?.buttons) ? view.value.buttons : [];
    const planEntries = resolveWarpPlanEntries(plan, buttons, "proposal");
    if (planEntries.length === 0) return { targets: [], attached: 0 };
    const targets = [];
    for (const slug of ignited) {
      if (hasActiveWarpTarget(warpStore.doc, wsId, slug)) continue;
      const proposalDir = proposalDirPath(wsPath, slug);
      if (!proposalDir || !existsSync(proposalDir)) continue;
      const attached = warpStore.attach({
        wsId,
        targetKey: slug,
        targetKind: "proposal",
        targetLabel: slug,
        proposalDir,
        entries: planEntries
      });
      if (attached.ok === true) targets.push({ wsId, targetKey: slug });
    }
    if (targets.length > 0) broadcastWarp();
    return { targets, attached: targets.length };
  };

  /**
   * 转入脉冲队列（转投即完成）：进程内直调 enqueue，同口径快照与复验。
   * 返回 `{ok:true}`（转投落定）或显式原因（`limit/busy` → 保持待发；`gate/...` → skipped）。
   */
  const transferWarpEntry = (entry) => {
    if (entry?.targetKind !== "proposal") {
      return { ok: false, reason: "invalid-target", message: "星胚任务不能转入脉冲队列" };
    }
    const wsPath = workspacePathOf(entry.wsId);
    if (!wsPath) return { ok: false, reason: "workspace/unknown" };
    const proposalDir = typeof entry.proposalDir === "string" && entry.proposalDir
      ? entry.proposalDir
      : proposalDirPath(wsPath, entry.targetKey);
    if (!proposalDir || !existsSync(proposalDir)) return { ok: false, reason: "proposal/unknown" };
    const proposal = scanProposal(entry.targetKey, proposalDir, readers.readTasks, readers.readBirthMs, readers.readState);
    const act = warpActivityActOf(entry.wsId, entry.targetKey);
    const preState = typeof entry.button?.preState === "string" ? entry.button.preState : "";
    if (preState) {
      if (!actionButtonVisible({ preState }, { lifecycle: proposal.lifecycle, act })) {
        return { ok: false, reason: "gate" };
      }
    }
    if (act > 0) return { ok: false, reason: "gate" };
    const enqueued = queueStore.enqueue({
      wsId: entry.wsId,
      proposalId: entry.targetKey,
      proposalDir,
      button: entry.button
    });
    if (enqueued.ok !== true) {
      if (enqueued.error === "duplicate") return { ok: true, duplicate: true };
      if (enqueued.error === "limit") return { ok: false, reason: "limit" };
      return { ok: false, reason: enqueued.error || "delivery-failed", message: "脉冲队列拒绝转入" };
    }
    broadcastQueue();
    scheduler.kick(entry.wsId);
    return { ok: true, duplicate: false };
  };

  /** 曲率调度器（门控接力 / 并发上限 / 安静门 / 转投即完成 / 重启对账）。 */
  const warpScheduler = createWarpScheduler({
    store: warpStore,
    gate: warpGate,
    deliver: deliverWarpEntry,
    transfer: transferWarpEntry,
    expand: (entry) => expandWarpEmbryo({ wsId: entry.wsId, anchorSlugs: entry.anchorSlugs }),
    explorerBusy,
    readSession: readQueueSession,
    readSessionState: (sessionId) => scheduler.sessionStateOf(sessionId),
    isArchived: (sessionId) => archivedSessionIds().has(sessionId),
    onChange: broadcastWarp,
    notify: (message) => {
      ctx.logger?.warn?.("[dsh-v-cosmos] 曲率：%s", String(message));
    },
    logger: ctx.logger ?? null
  });

  /** 对外快照（`GET /warp`）：叠加调度器活动子态（executing running/waiting、ready 等待会话空闲）。 */
  const warpViewSnapshot = () => ({
    ...publicWarpSnapshotOf(warpStore.doc, (wsId, entry) => warpScheduler.activityOf(wsId, entry)),
    revisedAt: warpStore.revisedAt
  });

  /** 目标活动计数基线（下降沿检测；key = wsId\0targetKey）。 */
  const warpActivityLast = new Map();

  /** 单目标当前活动计数（proposal = 关联会话聚合；embryo = 探索会话）。 */
  const warpActivityNowOf = (target) => {
    if (target.targetKind === "embryo") {
      const sessionId = typeof target.explorerSessionId === "string" ? target.explorerSessionId : "";
      if (!sessionId) return 0;
      const state = scheduler.sessionStateOf(sessionId);
      return state !== null && (state.running === true || state.waiting > 0) ? 1 : 0;
    }
    return warpActivityActOf(target.wsId, target.targetKey);
  };

  /**
   * 触发沿刷新：对文档内全部去重目标采样活动计数，`>0 → 0` 下降沿喂复查。
   * 每道会话事件（agent/status、交互瀑布退出）后调用；新附着目标也调用一次建立基线
   * （避免「附着时会话已忙 → 收尾下降沿」丢失）。
   */
  const refreshWarpTriggers = () => {
    const live = new Set();
    for (const target of warpStore.targets()) {
      const key = target.wsId + "\u0000" + target.targetKey;
      live.add(key);
      const count = warpActivityNowOf(target);
      const previous = warpActivityLast.get(key) ?? 0;
      warpActivityLast.set(key, count);
      if (previous > 0 && count === 0) {
        warpScheduler.onTaskSettled(target.wsId, target.targetKey);
      }
    }
    for (const key of [...warpActivityLast.keys()]) {
      if (!live.has(key)) warpActivityLast.delete(key);
    }
  };

  /**
   * 工作区不在册守卫：清空该星座曲率队列（registry 暂不可达时不误清）。
   * @returns {boolean} 是否有清理动作（调用方据此广播）
   */
  const reconcileWarpWorkspaces = () => {
    const list = listedWorkspaces();
    if (list === null) return false;
    const ids = new Set(list.map(workspaceEntityId));
    let changed = false;
    for (const wsId of Object.keys(warpStore.doc?.warps ?? {})) {
      if (ids.has(wsId)) continue;
      const result = warpStore.clearWarp({ wsId });
      if (result.ok === true) changed = true;
    }
    if (changed) broadcastWarp();
    return changed;
  };

  /**
   * 提案归档清理（骨架扫描退出活跃清单时调用）：清该提案全部非在途曲率条目。
   * @param {string} wsId
   * @param {string} proposalId
   * @returns {number} 清理条数
   */
  const clearWarpForArchivedProposal = (wsId, proposalId) => {
    const result = warpStore.clearProposal({ wsId, proposalId });
    if (result.ok === true && result.removed > 0) {
      broadcastWarp();
      return result.removed;
    }
    return 0;
  };

  /**
   * 星胚移除清理（`/dismiss-embryo` 成功/幂等路径调用）：凡锚点清单含该 slug 的星胚
   * 目标 → 清该目标**全部**曲率条目（含 grayed proto）。已展开的提案目标不受影响。
   * @returns {number} 清理条数
   */
  const clearWarpForDismissedEmbryo = (wsId, slug) => {
    const result = warpStore.clearEmbryoSlug({ wsId, slug });
    if (result.ok === true && result.removed > 0) {
      broadcastWarp();
      return result.removed;
    }
    return 0;
  };

  /** 曲率计划保存面交叉校验（悬空引用拒绝；spec「曲率计划配置模型」）。 */
  const warpPlanPatchError = (sections) => {
    if (sections === null || typeof sections !== "object" || !("warpPlan" in sections)) return null;
    if (sections.warpPlan === null) return null;
    let plan;
    try {
      plan = normalizeWarpPlan(sections.warpPlan);
    } catch (error) {
      return String(error?.message || error);
    }
    let buttons;
    if (Array.isArray(sections.buttons)) {
      try {
        buttons = normalizeButtons(sections.buttons);
      } catch {
        return null; // 按钮节自身非法 → 交给 configStore.writeSections 统一报 invalid
      }
    } else {
      const snapshot = configStore.snapshot(baseView);
      buttons = Array.isArray(snapshot?.value?.buttons) ? snapshot.value.buttons : [];
    }
    const known = new Set(buttons.map((button) => button.name));
    for (const bar of plan.bars) {
      if (!known.has(bar.name)) return `曲率计划引用的动作条不存在：${bar.name}`;
    }
    return null;
  };

  /* ── 星座作品（p1-add-cosmos-works-service 2.1–2.8）：作品快捷入口的服务端半区 ──
     存储 = 插件自有第四件 `$DSH_HOME/storages/dsh-v-cosmos.works.json`（与关联/队列/谱系
     互不覆盖）。启动面按 design D3 三层收窄：①端点签名只收 `(wsId, workId)`（裸路径结构上
     不可达）②`relPath` resolve 后严格包含于注册根（含分隔符边界）③`statSync` 必须文件 +
     符号链接显式拒绝；④`kind` 分派（`exec` 走执行面、其余走系统默认程序打开，两者同一
     「资源管理器双击」启动形态 = `cmd /c start` 可见控制台，design D4 + exec 启动语义修复）。 */

  /** 作品存储（原子写；坏档回空、首写即建）。 */
  const worksStore = createWorksStore({ logger: ctx.logger ?? null });

  /** 作品变更轻帧（帧体不带载荷；单点广播——所有写盘路径共用，spec「works-changed」）。 */
  const broadcastWorks = () => broadcast({ type: "works-changed" });

  /** 平台/进程启动注入面（冒烟桩测：跨平台分支与零真实进程；缺省 = 宿主机行为）。 */
  const platformOf = () => (typeof options?.platform === "string" && options.platform ? options.platform : process.platform);
  const isWindows = () => platformOf() === "win32";

  /**
   * cmd.exe 参数引号：经 cmd 解析的命令行里，路径必须**整体加引号**——否则文件名中的
   * `&`/`|`/`>`/`^` 会被 cmd 当作命令分隔符（白名单只约束「启动哪个条目」，引号负责
   * 约束「条目名里的元字符」）。内嵌引号按 cmd 习惯双写。
   * @param {string} value
   * @returns {string}
   */
  const cmdQuote = (value) => '"' + String(value).replace(/"/g, '""') + '"';

  /**
   * 即发即忘启动（detached + `stdio: 'ignore'` + unref）：Cosmos 是启动器不是终端——
   * 不等待退出、不捕获输出、不展示子进程生命周期（design D5）。异步 `error` 事件必须
   * 挂监听，否则 ENOENT 一类失败会升级为未捕获异常（spec「SHALL NOT 抛出未捕获异常」）。
   * @param {string} command
   * @param {string[]} args
   * @param {object} spawnOptions
   */
  const launchDetached = (command, args, spawnOptions) => {
    const spawner = typeof options?.spawn === "function" ? options.spawn : spawn;
    const child = spawner(command, args, spawnOptions);
    try {
      child?.on?.("error", (error) => {
        ctx.logger?.warn?.("[dsh-v-cosmos] 作品启动子进程失败: %s", String(error?.message || error));
      });
      child?.unref?.();
    } catch {
      /* 桩对象可能无事件面/句柄方法（不影响请求结果） */
    }
    return child;
  };

  /**
   * 严格包含性判定（含分隔符边界：`C:\proj-evil` 不是 `C:\proj` 的子路径——design D3）。
   * @param {string} root 已 `resolve` 的工作区根
   * @param {string} target 已 `resolve` 的目标绝对路径
   * @returns {boolean}
   */
  const pathInside = (root, target) => {
    const rel = relative(root, target);
    if (rel === "") return true;
    return rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
  };

  /**
   * 真实路径包含性（父级符号链接逃逸防守；design「不追随逃逸根的符号链接」）：
   * 返回 `null` = 不可解析（缺失/无权限）→ 调用方一律 fail-closed。
   * @param {string} root
   * @param {string} target
   * @returns {boolean|null}
   */
  const realPathInside = (root, target) => {
    try {
      return pathInside(realpathSync(root), realpathSync(target));
    } catch {
      return null;
    }
  };

  /** 工作区根绝对路径（未在册 / 路径空 → null；端点映射 workspace/unknown）。 */
  const worksRootOf = (wsId) => {
    const root = workspacePathOf(wsId);
    return root ? resolve(root) : null;
  };

  /**
   * 作品条目的磁盘裁决链（登记 / 启动 / 定位三处**同源**，spec「与 open 同源校验链」）：
   * `resolve` 包含性 → `lstat`（符号链接拒绝）→ 真实路径包含性 → 必须普通文件。
   * @param {string} root 工作区根（已 resolve）
   * @param {string} relPath 存储中的工作区相对路径（已归一并净房）
   * @returns {{ok: true, abs: string} | {ok: false, reason: string}}
   *          reason：out-of-root / missing-on-disk / symlink / not-a-file
   */
  const resolveWorkFile = (root, relPath) => {
    const abs = resolve(root, relPath);
    if (!pathInside(root, abs)) return { ok: false, reason: "out-of-root" };
    let stats;
    try {
      stats = lstatSync(abs);
    } catch {
      return { ok: false, reason: "missing-on-disk" };
    }
    if (stats.isSymbolicLink()) return { ok: false, reason: "symlink" };
    /* fail-closed：真实路径不可解析同样按越界处理（不因解析失败而放行）。 */
    if (realPathInside(root, abs) !== true) return { ok: false, reason: "out-of-root" };
    if (!stats.isFile()) return { ok: false, reason: "not-a-file" };
    return { ok: true, abs };
  };

  /** 快照的逐条存在性核验（`fs.statSync` 同源链；文件已被外部删除 → false）。 */
  const workExistsOf = (wsId, entry) => {
    const root = worksRootOf(wsId);
    if (!root) return false;
    return resolveWorkFile(root, entry.relPath).ok === true;
  };

  /* ── 系统文件选择器（作品拾取；用户修订：取消自建浏览模态）─────────────────
     宿主侧原生文件对话框（与官方目录选择器同思路）：Windows PowerShell OpenFileDialog /
     macOS osascript `choose file` / Linux zenity|kdialog；多选、初值 = 工作区根。
     `options.pickFiles(root)` 为测试/嵌入注入点：返回绝对路径数组，`null` = 取消。 */
  const PICKER_TIMEOUT_MS = 180000;
  let pickerBusy = false;

  /** 运行一次原生对话框命令并收集 stdout（超时/启动错误都结构化返回）。 */
  const runPickerCommand = (command, args) => new Promise((resolveRun) => {
    const spawner = typeof options?.spawn === "function" ? options.spawn : spawn;
    let child;
    try {
      child = spawner(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolveRun({ ok: false, error: String(error?.message || error) });
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveRun(value);
    };
    const timer = setTimeout(() => {
      try { child.kill?.(); } catch { /* ignore */ }
      finish({ ok: false, error: "picker-timeout" });
    }, PICKER_TIMEOUT_MS);
    timer.unref?.();
    child.stdout?.on?.("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on?.("data", (chunk) => { stderr += String(chunk); });
    child.on?.("error", (error) => finish({ ok: false, error: String(error?.message || error) }));
    child.on?.("close", (code) => finish({ ok: true, code: Number(code), stdout, stderr }));
  });

  const pickerLines = (text) => String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  /** 平台原生文件对话框（多选）。返回 `{ok, files: string[]|null}` 或 `{ok:false, reason}`。 */
  const pickFilesNative = async (root) => {
    const platform = platformOf();
    if (platform === "win32") {
      const quote = (value) => "'" + String(value).replace(/'/g, "''") + "'";
      const script = [
        "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
        "Add-Type -AssemblyName System.Windows.Forms",
        "Add-Type -AssemblyName System.Drawing",
        "$d = New-Object System.Windows.Forms.OpenFileDialog",
        "$d.Title = " + quote("选择要凝聚的作品文件"),
        "$d.InitialDirectory = " + quote(root),
        "$d.Multiselect = $true",
        "$d.CheckFileExists = $true",
        "$d.Filter = " + quote("所有文件 (*.*)|*.*"),
        "$d.RestoreDirectory = $true",
        "$owner = New-Object System.Windows.Forms.Form",
        "$owner.TopMost = $true",
        "$owner.ShowInTaskbar = $false",
        "$owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None",
        "$owner.StartPosition = 'Manual'",
        "$owner.Location = [System.Drawing.Point]::new(-2000, -2000)",
        "$owner.Size = [System.Drawing.Size]::new(1, 1)",
        "$owner.Opacity = 0",
        "$owner.Show()",
        "$result = $d.ShowDialog($owner)",
        "$owner.Close()",
        "if ($result -eq [System.Windows.Forms.DialogResult]::OK) { $d.FileNames | ForEach-Object { Write-Output $_ } }"
      ].join("; ");
      const run = await runPickerCommand("powershell.exe", ["-NoLogo", "-NoProfile", "-STA", "-Command", script]);
      if (run.ok !== true) return { ok: false, reason: "picker-failed", message: run.error };
      if (run.code !== 0) return { ok: false, reason: "picker-failed", message: run.stderr };
      return { ok: true, files: pickerLines(run.stdout) };
    }
    if (platform === "darwin") {
      const escaped = String(root).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const script = [
        "try",
        'set theFiles to choose file with prompt "选择要凝聚的作品文件" default location (POSIX file "' + escaped + '") with multiple selections allowed',
        'set out to ""',
        "repeat with f in theFiles",
        "set out to out & (POSIX path of f) & linefeed",
        "end repeat",
        "return out",
        "on error number -128",
        'return ""',
        "end try"
      ].join("\n");
      const run = await runPickerCommand("osascript", ["-e", script]);
      if (run.ok !== true) return { ok: false, reason: "picker-failed", message: run.error };
      /* 用户取消：AppleScript error -128 已被脚本吞掉（返回空串）；其他非零一律按取消处理。 */
      if (run.code !== 0) return { ok: true, files: null };
      return { ok: true, files: pickerLines(run.stdout) };
    }
    /* Linux：zenity 优先、kdialog 兜底；两者都不可用 → picker-unavailable。 */
    const title = "选择要凝聚的作品文件";
    const zenity = await runPickerCommand("zenity", [
      "--file-selection", "--multiple", "--separator=\n", "--title=" + title, "--filename=" + root + sep
    ]);
    if (zenity.ok === true) {
      if (zenity.code !== 0) return { ok: true, files: null };
      return { ok: true, files: pickerLines(zenity.stdout) };
    }
    const kdialog = await runPickerCommand("kdialog", [
      "--getopenfilename", root, "--multiple", "--separator", "\n", "--title", title
    ]);
    if (kdialog.ok === true) {
      if (kdialog.code !== 0) return { ok: true, files: null };
      return { ok: true, files: pickerLines(kdialog.stdout) };
    }
    return { ok: false, reason: "picker-unavailable" };
  };

  const pickFilesFor = async (root) => {
    if (typeof options?.pickFiles === "function") {
      try {
        const files = await options.pickFiles(root);
        return { ok: true, files: Array.isArray(files) ? files : null };
      } catch (error) {
        return { ok: false, reason: "picker-failed", message: String(error?.message || error) };
      }
    }
    return pickFilesNative(root);
  };

  /** 绝对路径 → 工作区根内相对路径（根外/跨盘 → null；统一 `/` 分隔）。 */
  const relPathWithin = (root, file) => {
    const abs = resolve(String(file));
    const rel = relative(root, abs);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
    return rel.split(sep).join("/");
  };

  /** 单次浏览条目上限（spec「单次返回条目数上限 500」）。 */
  const BROWSE_LIMIT = 500;

  /** 相对路径的父目录（`""` = 根；存储路径恒为 `/` 分隔）。 */
  const dirOfRelPath = (relPath) => {
    const index = relPath.lastIndexOf("/");
    return index < 0 ? "" : relPath.slice(0, index);
  };

  /**
   * 工作区根内目录浏览（spec「目录浏览端点」）：`dir` 为空 = 根；越界/符号链接/非目录
   * 各自结构化拒绝；目录在前、文件在后（各按名称大小写不敏感排序）；超 500 条截断标注。
   * @param {string} root 工作区根（已 resolve）
   * @param {unknown} rawDir 请求 `dir` 查询参数
   * @returns {{ok: true, cwd: string, parent: string, entries: Array<object>, truncated: boolean} |
   *           {ok: false, reason: string}}
   */
  const browseWorksDir = (root, rawDir) => {
    const raw = typeof rawDir === "string" ? rawDir.trim() : "";
    let relPath = "";
    if (raw) {
      const parsed = normalizeRelPath(raw);
      if (parsed.ok !== true) return { ok: false, reason: parsed.reason };
      relPath = parsed.relPath;
    }
    const abs = relPath ? resolve(root, relPath) : root;
    if (!pathInside(root, abs)) return { ok: false, reason: "out-of-root" };
    let stats;
    try {
      stats = lstatSync(abs);
    } catch {
      return { ok: false, reason: "missing-on-disk" };
    }
    /* 符号链接条目不可作为浏览目标进入（spec「符号链接不追随」）。 */
    if (stats.isSymbolicLink()) return { ok: false, reason: "symlink" };
    if (!stats.isDirectory()) return { ok: false, reason: "not-a-directory" };
    if (realPathInside(root, abs) !== true) return { ok: false, reason: "out-of-root" };
    let dirents;
    try {
      dirents = readdirSync(abs, { withFileTypes: true });
    } catch {
      return { ok: false, reason: "missing-on-disk" };
    }
    const rows = [];
    for (const dirent of dirents) {
      const type = dirent.isSymbolicLink() ? "symlink" : dirent.isDirectory() ? "dir" : "file";
      rows.push({ name: dirent.name, type });
    }
    rows.sort((left, right) => {
      const rankLeft = left.type === "dir" ? 0 : 1;
      const rankRight = right.type === "dir" ? 0 : 1;
      if (rankLeft !== rankRight) return rankLeft - rankRight;
      const nameLeft = left.name.toLowerCase();
      const nameRight = right.name.toLowerCase();
      if (nameLeft < nameRight) return -1;
      if (nameLeft > nameRight) return 1;
      return 0;
    });
    const truncated = rows.length > BROWSE_LIMIT;
    const kept = truncated ? rows.slice(0, BROWSE_LIMIT) : rows;
    /* size 只对**保留页**的文件补（大目录先截断再 stat，避免为丢弃项付系统调用）；
       单个条目 stat 失败不阻断整页（size 为可选字段）。 */
    for (const row of kept) {
      if (row.type !== "file") continue;
      try {
        const fileStats = statSync(join(abs, row.name));
        if (fileStats.isFile()) row.size = fileStats.size;
      } catch {
        /* ignore */
      }
    }
    return { ok: true, cwd: relPath, parent: relPath ? dirOfRelPath(relPath) : "", entries: kept, truncated };
  };

  /** 工作区在册 + 条目在册 + 磁盘裁决（`/works/open` 与 `/works/reveal` 的共同前置）。 */
  const verifiedWorkOf = (wsId, workId) => {
    const root = worksRootOf(wsId);
    if (!root) return { ok: false, reason: "workspace/unknown" };
    const entry = worksStore.find(wsId, workId);
    if (!entry) return { ok: false, reason: "entry-unknown" };
    const checked = resolveWorkFile(root, entry.relPath);
    if (checked.ok !== true) return { ok: false, reason: checked.reason };
    return { ok: true, entry, abs: checked.abs };
  };

  /** 作品端点的 reason → HTTP 状态（同一 reason 码在 `error`/`reason` 两字段同出）。 */
  const WORKS_STATUS = Object.freeze({
    invalid: 400,
    "workspace/unknown": 404,
    "entry-unknown": 404,
    "out-of-root": 400,
    "not-a-file": 400,
    "not-a-directory": 400,
    symlink: 400,
    duplicate: 400,
    limit: 400,
    "missing-on-disk": 404,
    "platform-unsupported": 400,
    "launch-failed": 500,
    "picker-busy": 409,
    "picker-unavailable": 501,
    "picker-failed": 500
  });
  const worksStatusOf = (reason) => WORKS_STATUS[reason] ?? 400;

  /** 作品端点结构化错误体（`error` 与 `reason` 同码，两种消费口径都可用）。 */
  const worksError = (res, reason, extra = {}) => {
    json(res, worksStatusOf(reason), { ok: false, error: reason, reason, ...extra });
  };

  /**
   * 宿主 agent 事件面 → 脉冲调度器 + 曲率引擎（two-add-cosmos-proposal-warp 2.1）：
   *  - `agent/status`：running/idle 迁移（`payload.agent.id` = 会话 id）——**先**喂脉冲
   *    调度器（共享会话态缓存的唯一写者），再喂曲率引擎（只读同一缓存），最后刷新曲率
   *    触发沿（按目标活动计数下降沿）；
   *  - `approval/request` / `user-questions/request`：**prepend** 观察者——`[实证]`
   *    （add-cosmos-action-queue 探索）：有浏览器连接时 `dsh-api-remotes` 的转发监听者
   *    会持有整条链直到人应答，非 prepend 监听者在该路径上永远收不到请求（本插件的主场景
   *    正是浏览器常开）。观察者恒 `next()` 透传、`finally` 配对进出沿，绝不吞链、不改变
   *    官方应答者行为。退出沿同时喂曲率完成判定与触发沿刷新。
   * @returns {() => void} 卸载函数
   */
  const installQueueListeners = () => {
    if (typeof ctx.on !== "function") return () => {};
    const disposers = [];
    disposers.push(
      ctx.on("agent/status", (payload) => {
        try {
          scheduler.onAgentStatus({ sessionId: payload?.agent?.id, status: payload?.status });
          warpScheduler.onAgentStatus({ sessionId: payload?.agent?.id, status: payload?.status });
          refreshWarpTriggers();
        } catch (error) {
          ctx.logger?.warn?.("[dsh-v-cosmos] 队列 agent/status 归约失败: %s", String(error?.message || error));
        }
      })
    );
    const joinInteraction = (event) => {
      disposers.push(
        ctx.on(event, (request, next) => {
          const sessionId = request?.agent?.session?.header?.id ?? request?.agent?.id;
          if (!sessionId || typeof next !== "function") return typeof next === "function" ? next() : undefined;
          scheduler.interactionEnter(sessionId);
          let result;
          try {
            result = next();
          } catch (error) {
            scheduler.interactionExit(sessionId);
            throw error;
          }
          return Promise.resolve(result).finally(() => {
            scheduler.interactionExit(sessionId);
            warpScheduler.onInteractionExit(sessionId);
            refreshWarpTriggers();
          });
        }, { prepend: true })
      );
    };
    joinInteraction("approval/request");
    joinInteraction("user-questions/request");
    return () => {
      for (const dispose of disposers) {
        try {
          dispose?.();
        } catch {
          /* ignore */
        }
      }
    };
  };

  /** 启发式执行（单工作区）：规则 1（归属+用户侧指派引用）优先、规则 2（birthtime 窗口）兜底。
      变更时落盘 + 广播 associations-changed；幂等条目不产生广播。

      信号口径（restrict-association-heuristics / design D1–D5）：
      - 规则 1 只从**用户侧消息**（`userContextTextOf`，事件 `type === "user/message"`）解析
        `@<提案目录>` 指派引用（`assignmentProposalSlugs`）——正文提及与 assistant 回显不再
        建立关联（「拿提到当在干」的语义错误由信号口径纠正）；
      - 规则 2 的候选集合排除判定时刻**正在运行**的会话（数据源 = 调度器会话态缓存
        `sessionStateOf`，与队列复验同源；null/不可达按非运行处理保留候选；等待决策的
        会话 running=false 同样保留候选）。

      显式绑定压制（fix-cosmos-association-scope 2.2 / spec「显式会话关联绑定」）：
      以存储中 explicit 条目为**唯一依据**（无内存标志，重启由回读恢复）——规则 1 循环
      跳过被绑定会话；规则 2 的活跃集合先剔除被绑定会话再判唯一性。未绑定会话路径
      逐字不变。 */
  const runHeuristics = (workspacePath, proposalNames, now) => {
    let changed = false;
    const active = activeSessionsOf(workspacePath, now);
    const bound = explicitBoundSessionIds(entries, workspacePath);
    const heuristicActive = active.filter((session) => !bound.has(session.sessionId));
    const before = projectionOf(entries).length;
    /* 规则 1：逐活跃会话的用户侧指派信号 × 提案目录（被绑定会话跳过）。 */
    for (const session of heuristicActive) {
      const assignmentSlugs = assignmentProposalSlugs(userContextTextOf(session.agent));
      if (assignmentSlugs.length === 0) continue;
      const result = applyContextHeuristic({
        workspacePath,
        sessionId: session.sessionId,
        proposalNames,
        assignmentSlugs,
        entries,
        now
      });
      entries = result.entries;
      if (result.added.length > 0) changed = true;
    }
    /* 规则 2 的候选排除集合：判定时刻正在运行的会话（忙碌会话不可能是新目录的接生者）。
       数据源 = 服务端可达会话态（调度器缓存；null/不可达 → 非运行，保留候选）。 */
    const runningSessionIds = new Set();
    for (const session of heuristicActive) {
      const state = scheduler.sessionStateOf(session.sessionId);
      if (state?.running === true) runningSessionIds.add(session.sessionId);
    }
    /* 规则 2：提案目录出现窗口 × 唯一活跃会话（已有关联的提案跳过；被绑定会话不参与
       唯一性判定——否则刚绑定的忙碌会话会误连后续新提案目录）。 */
    const associated = new Set(entries.filter((e) => e.workspace === workspacePath).map((e) => e.proposal));
    const wsSkeleton = skeleton.workspaces.find((ws) => ws.path === workspacePath);
    for (const proposal of wsSkeleton?.stars ?? []) {
      if (associated.has(proposal.id)) continue;
      const birthMs = typeof proposal.birthMs === "number" ? proposal.birthMs : null;
      const seenKey = workspacePath + "\u0000" + proposal.id;
      if (!firstSeenMs.has(seenKey)) firstSeenMs.set(seenKey, now);
      const result = applyBirthtimeHeuristic({
        workspacePath,
        proposal: { id: proposal.id, birthMs },
        detectedMs: birthMs ?? firstSeenMs.get(seenKey),
        activeSessions: heuristicActive.map((s) => ({ sessionId: s.sessionId, lastActivityMs: s.lastActivityMs })),
        runningSessionIds,
        entries,
        now
      });
      entries = result.entries;
      if (result.added) changed = true;
    }
    if (changed) persistAssociations();
    void before; // 变更判定以 added 语义为准（before 仅观察用）
    return changed;
  };

  /** 会话归档剪除（任务 3.5）：持久化写入点执行；剪动才广播。 */
  const pruneAssociations = () => {
    const archived = archivedSessionIds();
    if (archived.size === 0) return false;
    const pruned = pruneArchivedSessions(entries, archived);
    const before = entries.length;
    if ((pruned?.length ?? 0) === before) return false;
    entries = pruned ?? [];
    persistAssociations();
    return true;
  };

  /** 单工作区骨架指纹（增量比对键）：stars 含 lifecycle/setBy/at（add-celestial-states），
      pending 锚点一并入指纹；`lin` = 点燃谱系投影（add-cosmos-panel-birthline-sort 3.2：
      谱系写入/时间线变化 MUST 触发增量广播，否则面板停留兜底块旧序）。 */
  const skeletonFingerprint = (ws) => JSON.stringify({ s: ws.stars, a: ws.archives, p: ws.pending, lin: ws.lineages, l: ws.links, assoc: ws.associations });

  /** 骨架活跃正式提案 id 集合（proto 星胚不入；归档检测用）。 */
  const activeProposalIdsOf = (ws) => new Set(
    (Array.isArray(ws?.stars) ? ws.stars : [])
      .filter((star) => star && star.lifecycle !== "proto" && typeof star.id === "string" && star.id)
      .map((star) => star.id)
  );

  /**
   * 全量扫描（懒启动/请求期对账/watch 防抖共用入口）：
   * registry 清单 × 目录扫描 → 会话剪除 → 启发式 → 骨架装配（含关联边投影回填）。
   * 骨架变化 → proposals-changed；关联变化 → associations-changed（persist 内广播）。
   * 点燃谱系（add-cosmos-panel-birthline-sort 2.2）：每帧扫描差分观察并入骨架装配，
   * 台账变更落盘一次；谱系入指纹 → 变化走既有 proposals-changed 链。
   * 曲率生命周期（two-add-cosmos-proposal-warp 4.3）：提案退出活跃清单 → 清其非在途
   * 曲率条目；工作区不在册 → 清空该星座曲率队列；扫描变更只作**已有触发沿目标**的
   * 置灰补查（`onScanChanged`，不主动点火新目标——design D3 红线）。
   */
  const scanAll = ({ scope } = {}) => {
    const now = Date.now();
    const workspaces = listWorkspaces();
    const pruned = pruneAssociations();
    const context = skeletonContext(now);
    birthlineDirty = false;
    let next = buildSkeleton(workspaces, readers, context);
    const entriesBefore = next.workspaces.reduce((n, ws) => n + ws.associations.length, 0);
    for (const ws of next.workspaces) {
      if (scope && !scope.has(ws.path)) continue;
      runHeuristics(ws.path, ws.stars.map((star) => star.id), now);
    }
    /* 关联投影回填：剪除或本轮启发式建立了新关联时重建骨架（否则关联边缺席一拍）。
       重建廉价（目录再读一轮），以正确性优先。 */
    const entriesAfter = projectionOf(entries).length;
    if (pruned || entriesAfter !== entriesBefore) {
      next = buildSkeleton(workspaces, readers, { ...context, associations: projectionOf(entries) });
    }
    if (birthlineDirty) persistBirthlines();
    birthlineDirty = false;
    let skeletonChanged = pruned;
    const prevWsIds = new Set(skeleton.workspaces.map((ws) => ws.id));
    const nextWsIds = new Set();
    for (const ws of next.workspaces) {
      nextWsIds.add(ws.id);
      if (scope && !scope.has(ws.path)) continue;
      const prev = skeleton.workspaces.find((old) => old.id === ws.id);
      if (!prev || skeletonFingerprint(prev) !== skeletonFingerprint(ws)) skeletonChanged = true;
    }
    /* 注销（id 消失）同样是骨架变化：上面的循环只看新集合，删空时无条目可比较
       （add-cosmos-add-workspace D3：请求期指纹对账依赖 proposals-changed 广播把
       注销传播给等其他客户端）。 */
    if (prevWsIds.size !== nextWsIds.size) {
      skeletonChanged = true;
    } else {
      for (const id of prevWsIds) {
        if (!nextWsIds.has(id)) {
          skeletonChanged = true;
          break;
        }
      }
    }
    /* ── 曲率生命周期清理（仅在任何一次扫描之后；首扫无可比旧态） ── */
    const wasScanned = scanned;
    reconcileWarpWorkspaces();
    if (wasScanned) {
      for (const ws of next.workspaces) {
        const prev = skeleton.workspaces.find((old) => old.id === ws.id);
        if (!prev) continue;
        const before = activeProposalIdsOf(prev);
        if (before.size === 0) continue;
        const after = activeProposalIdsOf(ws);
        for (const proposalId of before) {
          if (after.has(proposalId)) continue;
          clearWarpForArchivedProposal(ws.id, proposalId);
        }
      }
    }
    skeleton = next;
    scanned = true;
    reconcileWatchers();
    if (wasScanned) warpScheduler.onScanChanged();
    if (skeletonChanged) broadcast({ type: "proposals-changed" });
    return skeleton;
  };

  /* ── fs.watch 生命周期（懒启动 / 补挂 / 摘除，对齐 hive 请求期对账） ── */

  /** 受监听工作区清单：有 `openspec/` 目录且已登记 workspaceId（add-celestial-states 2.3：
      watch 范围从 changes/ 扩至 openspec/ 根，覆盖 changes/ 与 pending-changes/；星胚移除
      的锚点 `unlink` 同样是该目录下的事件，零新增通道）。 */
  const watchableWorkspaces = () => {
    const out = [];
    for (const workspace of listWorkspaces()) {
      const workspaceId = workspaceEntityId(workspace);
      const path = typeof workspace?.path === "string" ? workspace.path : "";
      if (!workspaceId || !path) continue;
      out.push({ workspaceId, path, dir: join(path, "openspec") });
    }
    return out;
  };

  const dropWatcher = (workspaceId) => {
    const entry = watchers.get(workspaceId);
    if (!entry) return;
    watchers.delete(workspaceId);
    try {
      entry.watcher.close();
    } catch {
      /* 已关闭 */
    }
  };

  /** 请求期对账：(a) 摘除已消失工作区 (b) 摘除 error 条目 (c) 补挂合格工作区。 */
  const reconcileWatchers = () => {
    const live = watchableWorkspaces();
    const liveIds = new Set(live.map((entry) => entry.workspaceId));
    for (const workspaceId of [...watchers.keys()]) {
      if (!liveIds.has(workspaceId)) dropWatcher(workspaceId);
    }
    for (const { workspaceId, path, dir } of live) {
      const existing = watchers.get(workspaceId);
      if (existing && !existing.errored) continue;
      if (existing?.errored) dropWatcher(workspaceId);
      if (!existsSync(dir)) continue;
      try {
        const watcher = watch(dir, { recursive: true, persistent: false }, () => markDirty(path));
        watcher.on("error", () => {
          const entry = watchers.get(workspaceId);
          if (entry) entry.errored = true;
        });
        watchers.set(workspaceId, { watcher, dir, errored: false });
      } catch {
        /* 启动失败（网络盘/权限/EMFILE/平台不支持）→ 静默降级：客户端保持拉取语义 */
      }
    }
  };

  /** watch 事件 → 标记脏工作区 + 单次 2s 防抖重扫（只重扫脏集）。 */
  const markDirty = (workspacePath) => {
    dirtyWorkspaces.add(workspacePath);
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      const scope = new Set(dirtyWorkspaces);
      dirtyWorkspaces.clear();
      try {
        scanAll({ scope });
      } catch (error) {
        ctx.logger?.warn?.("[dsh-v-cosmos] 脏工作区重扫失败: %s", String(error?.message || error));
      }
    }, SCAN_DEBOUNCE_MS);
    scanTimer.unref?.(); // 硬要求：SHALL NOT 拖着事件循环（含测试进程）
  };

  /* ── cosmos-spec 技能 provider（step3-cosmos-skill-provider-render 2.1/2.2，条件注入） ──
     `ctx.inject(['skills'], …)`：skills 服务缺席 → 回调不执行 → 仅 provider 分支不激活，
     其余插件能力照常（design D5）。回调体（fork 上下文）注册 provider——fork 卸载
     （skills 消失 / 插件卸载）即注销 provider 并摘除 canonical 根监听。get() 每次读盘
     + 渲染（registry 不缓存定义 → 配置热生效即改）；目录表新鲜度 = provider 自持失效：
     canonical 根 fs.watch（recursive + ≥2s 防抖）→ 注册期 invalidate()（沿 skills/change
     广播）；cosmosSpecDir 配置切换经 configChangeHooks 先摘旧监听再挂新监听。
     ctx.inject 本身缺席（旧宿主 / 最小桩环境）视同 skills 缺席——同分支静默不激活。 */
  if (typeof ctx.inject === "function") {
    ctx.inject(["skills"], (skillsCtx) => {
      let providerHandle = null;
      let canonicalHook = null;
      const disposeRegistrationEffect = skillsCtx.effect(() => {
        const disposeRegistration = skillsCtx.skills.registerProvider((control) => {
          providerHandle = createCosmosSpecProvider({
            readPaths,
            readPathsStatus,
            packageDir: providerDeps?.packageDir ?? PACKAGE_DIR,
            logger: ctx.logger ?? null,
            invalidate: () => control.invalidate(),
            deps: providerDeps
          });
          providerHandle.reconcileWatch(); // 注册期即挂载首监听（自持失效的载体）
          /* 扫描根桥接（step4 D5）：主作用域兜底反馈经此读解析根（纯读，缺省省略提示行）。 */
          providerResolveRoot = () => providerHandle?.resolveRoot() ?? null;
          canonicalHook = () => providerHandle.reconcileWatch({ invalidateIfChanged: true });
          configChangeHooks.add(canonicalHook);
          return providerHandle;
        });
        return () => {
          if (canonicalHook) {
            configChangeHooks.delete(canonicalHook);
            canonicalHook = null;
          }
          disposeRegistration();
          providerHandle?.dispose(); // 摘除 canonical fs.watch 句柄与防抖定时器
          providerHandle = null;
          providerResolveRoot = null; // 桥随分支卸载（反馈退回省略扫描根行）
        };
      }, "dsh-v-cosmos: cosmos-spec skills provider");
      return disposeRegistrationEffect;
    });
  }

  /* ── 插件主体（ctx.effect 生命周期） ── */

  ctx.effect(() => {
    /* 启动即加载关联文档（损坏/超版本即默认重建）；新名存储缺席时回读旧名档
       （品牌更名迁移：读取回落，下次 persistAssociations 落新名文件）。 */
    let doc = null;
    for (const path of [storagePath(), legacyStoragePath()]) {
      try {
        doc = parseStoredDoc(readFileSync(path, "utf8"));
        break;
      } catch {
        doc = null; // 缺席/损坏 → 尝试下一路径
      }
    }
    entries = Array.isArray(doc?.entries) ? doc.entries : [];
    entries = normalizeAssociations(entries) ?? [];

    /* 点燃谱系台账装载（add-cosmos-panel-birthline-sort 2.1）：独立 store 单 JSON 节；
       文件缺席 / 损坏 / 超版本 → 空台账兜底重建（spec「台账文件损坏兜底重建」：
       SHALL NOT 抛错、不中断骨架扫描；面板排序回落 birthMs 口径）。 */
    try {
      birthlineDoc = parseBirthlineDoc(readFileSync(birthlineStoragePath(), "utf8"), Date.now());
    } catch {
      birthlineDoc = emptyBirthlineDoc();
    }

    /* ── 动作按钮配置共享存储（configstore.mjs） ──
       装载 + 幂等播种（组合层视图 = entry config；空视图 ⇒ 只写 revision/migratedFrom
       骨架文件，节缺席 = 未自定义）+ fs.watch 热重载（他端进程写入 → 重读）。 */
    configStore.refresh();
    void configStore.ensureSeeded(baseView, { source: "entry-config" }).catch((error) => {
      ctx.logger?.warn?.("[dsh-v-cosmos] 配置存储播种失败: %s", String(error?.message || error));
    });
    const stopConfigWatch = configStore.watch(() => {
      try {
        configStore.refresh();
      } catch (error) {
        ctx.logger?.warn?.("[dsh-v-cosmos] 配置存储热重载失败: %s", String(error?.message || error));
      }
      /* paths 节变更的下游对账（step3：canonical 解析根切换 → 摘旧挂新 + 立即失效；
         openspecPath 变更不影响目录表，由 reconcileWatch 的变更判定天然跳过）。 */
      for (const hook of configChangeHooks) {
        try {
          hook();
        } catch {
          /* 单个下游钩子失败不阻断其余对账 */
        }
      }
    });

    /* ── 路径令牌读取兜底（step3 3.1 / step4 D3/D4/D5/D6，tools/post-execute） ──
       拦截面覆盖两类工具形态（TOKEN_ARG_RULES）：路径类入参工具（read/write/edit =
       file_path；str_replace_editor = path；glob/grep = path 或 pattern，均「开头整词」
       判定）与命令类工具（bash/pwsh = command，`findTokenCommandPath` 全文扫描提取
       第一个令牌开头的路径词）。结果为 isError 且命中 → block 纠正反馈（已配置：解析后
       绝对路径 + 重试指引；未配置：设置指引；解析根可解析时两分支均附「cosmos-spec
       技能目录扫描根」提示行；原错误文本内嵌）。glob/grep 零命中非 error 恒透传。
       其余调用恒 next() 透传（practices.md「不拥有决策必须 next()」纪律）。同步字符串
       判断（无异步 IO），观察 exec.signal；监听是提示词级纠偏——MUST NOT 静默改写调用
       或重试。全局层对所有 agent 生效：未命中路径零产出（design 风险表权衡）。 */
    /* ctx.on 缺席（旧宿主 / 最小桩环境）→ 兜底监听不注册（等价 tools 缺席分支）。 */
    const disposeTokenFallback = typeof ctx.on === "function"
      ? ctx.on("tools/post-execute", (exec, result, next) => {
        try {
          if (!result?.isError) return next();
          if (exec?.signal?.aborted) return next(); // 观察 exec.signal：已中止交还瀑布
          const tokenPath = tokenPathOf(exec?.name, exec?.arguments);
          if (!tokenPath) return next();
          const resolved = resolveTokenPath(tokenPath, readPaths().openspecPath);
          const feedback = composeTokenFeedback({
            rawPath: tokenPath,
            resolved,
            originalError: result?.error?.message ?? "",
            skillRootHint: skillRootHintOf()
          });
          return { kind: "block", feedback: [{ type: "text", text: feedback }] };
        } catch {
          return next(); // 兜底自身异常不放大为调用失败
        }
      })
      : null;

    /* ── 队列：装载 + 事件面挂接 + 重启对账/推进（add-cosmos-action-queue 4.1） ──
       装载先于挂载（对账必须看到持久化条目）；`scheduler.start()` 冷读在途条目
       （launching/executing）后逐队列推进。失败只告警（路由与投影不受影响）。 */
    queueStore.load();
    /* 曲率：装载 → 事件面同拍挂接 → 重启对账（executing 冷读续监视 / launching → failed）
       → 逐星座复查点火。状态回填/广播由 warpScheduler 注入的 onChange 承担。 */
    warpStore.load();
    /* 作品存储装载（坏档 → 空作品表；首写即建）。装载失败只告警：路由与投影照常。 */
    try {
      worksStore.load();
    } catch (error) {
      ctx.logger?.warn?.("[dsh-v-cosmos] 作品存储装载失败（按空作品表）: %s", String(error?.message || error));
    }
    const disposeQueueListeners = installQueueListeners();
    void scheduler.start().catch((error) => {
      ctx.logger?.warn?.("[dsh-v-cosmos] 队列启动对账失败: %s", String(error?.message || error));
    });
    void warpScheduler.start()
      .then(() => refreshWarpTriggers())
      .catch((error) => {
        ctx.logger?.warn?.("[dsh-v-cosmos] 曲率启动对账失败: %s", String(error?.message || error));
      });

    const readJsonBody = async (req) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) return {};
      try {
        return JSON.parse(text);
      } catch {
        return {};
      }
    };

    const dispose = ctx.webServer.register({
      kind: "prefix",
      path: API_PREFIX,
      handler: async (req, res) => {
        const url = new URL(req.url, "http://localhost");
        const route = url.pathname.slice(API_PREFIX.length) || "/";
        try {
          /* ── 星空骨架 ── */
          if (route === "/scene" && req.method === "GET") {
            if (!scanned) {
              scanAll();
            } else {
              /* 注册→骨架对账（add-cosmos-add-workspace D3）：在册 id 集合指纹与骨架
                 id 集合不一致（新登记/注销工作区）→ 全量重扫（scanAll 内含
                 reconcileWatchers 与 proposals-changed 广播）。宿主侧无注册事件，
                 故对账收敛在插件自身的请求期钩子；常态请求零增量。
                 registry 不可达（null）→ 不误判为「全部注销」，维持既有轻量对账。 */
              const registry = listedWorkspaces();
              const registryIds = registry ? registry.map(workspaceEntityId) : null;
              const idSetChanged = registryIds !== null
                && idSetFingerprint(registryIds) !== idSetFingerprint(skeleton.workspaces.map((ws) => ws.id));
              if (idSetChanged) {
                scanAll();
              } else {
                reconcileWatchers(); // 请求期对账（新登记工作区/摘除消失工作区）
                /* 会话归档不产生 fs.watch 事件 → 剪除挂在每次拉取（时序一收敛入口）；
                   剪动才重建骨架切片并广播。 */
                if (pruneAssociations()) {
                  skeleton = rebuildSkeleton();
                  broadcast({ type: "proposals-changed" });
                }
              }
            }
            json(res, 200, { ok: true, scene: skeleton });
            return;
          }

          /* ── 动作按钮配置：读（视图语义 base/user/value；存储缺席按 revision 0 空存储） ── */
          if (route === "/config" && req.method === "GET") {
            configStore.refresh();
            json(res, 200, configStore.snapshot(baseView));
            return;
          }

          /* ── 动作按钮配置：CAS 写入 `{ baseRevision, sections }`（null = unset 该节） ──
             曲率计划节（two-add-cosmos-proposal-warp 5.1）：保存前交叉校验 `name` 必须命中
             既有按钮配置（悬空引用拒绝——spec「曲率计划配置模型与曲率引擎设置页签」）。 */
          if (route === "/config" && req.method === "PUT") {
            const body = await readJsonBody(req);
            const planError = warpPlanPatchError(body?.sections);
            if (planError !== null) {
              json(res, 400, { error: "invalid", reason: planError });
              return;
            }
            let outcome;
            try {
              outcome = await configStore.writeSections(body);
            } catch (error) {
              if (error?.code === "conflict") {
                json(res, 409, {
                  error: "conflict",
                  revision: typeof error.revision === "number" ? error.revision : configStore.revision()
                });
                return;
              }
              if (error?.code === "invalid") {
                json(res, 400, { error: "invalid", reason: String(error?.message || error) });
                return;
              }
              if (error?.code === "busy") {
                json(res, 503, { error: "busy" });
                return;
              }
              json(res, 500, { error: "io", reason: String(error?.message || error) });
              return;
            }
            json(res, 200, { revision: outcome.revision });
            return;
          }

          /* ── 会话扫尾：批量归档（add-cosmos-archive-session-sweep 2.2） ──
             预过滤 `archivedSessionIds`（幂等）→ 按数组序**依次**逐个
             `await archiveSession`——**不带 stopActivity**：turn / subagent 链 /
             job / schedule 由宿主活动瀑布判定，在跑工作只跳过不杀。部分失败不改变
             整体成功语义（逐会话 outcome，恒 200）。 */
          if (route === "/archive-sessions" && req.method === "POST") {
            const request = normalizeArchiveRequest(await readJsonBody(req));
            if (!request.ok) {
              json(res, 400, { error: "invalid", reason: request.reason });
              return;
            }
            const archived = archivedSessionIds();
            const results = [];
            for (const sessionId of request.sessionIds) {
              if (archived.has(sessionId)) {
                results.push({ sessionId, outcome: "already-archived" });
                continue;
              }
              let outcome;
              try {
                await ctx.workspaceRegistry.archiveSession(sessionId);
                outcome = { outcome: "archived" };
                archived.add(sessionId); // 单请求内重复 id 已被归一化去重，此处仅保持集合语义
              } catch (error) {
                outcome = classifyArchiveError(error);
              }
              results.push({ sessionId, ...outcome });
            }
            json(res, 200, { results });
            return;
          }

          /* ── 会话扫尾：前缀改名（2.3） ──
             会话先解析为 live 对象（标题服务要求 exact live session）→
             `sessionTitle` 惰性查找（缺失 → 503）→ 读原题 → 前缀拼接（空题回退 /
             已带前缀幂等 no-op）→ rename（超长由宿主 maxTitleBytes 保头截尾）。 */
          if (route === "/rename-session" && req.method === "POST") {
            const request = normalizeRenameRequest(await readJsonBody(req));
            if (!request.ok) {
              json(res, 400, { error: "invalid", reason: request.reason });
              return;
            }
            const session = liveSessionOf(request.sessionId);
            if (!session) {
              json(res, 404, { error: "session/unknown", sessionId: request.sessionId });
              return;
            }
            const titles = sessionTitleService();
            if (!titles) {
              json(res, 503, { error: "rename-unavailable" });
              return;
            }
            let current = "";
            try {
              const snapshot = titles.get?.(session);
              current = typeof snapshot?.title === "string" ? snapshot.title : "";
            } catch (error) {
              json(res, 500, { error: "internal", reason: String(error?.message || error) });
              return;
            }
            const composed = composePrefixedTitle(current, request.prefix);
            if (composed.unchanged) {
              json(res, 200, normalizeRenameResult({ unchanged: true, title: composed.title }));
              return;
            }
            let accepted;
            try {
              accepted = titles.rename?.(session, composed.title);
            } catch (error) {
              json(res, 500, { error: "internal", reason: String(error?.message || error) });
              return;
            }
            const result = normalizeRenameResult({ unchanged: false, accepted });
            if (result.outcome === "failed") {
              json(res, 500, { error: "internal", reason: result.error });
              return;
            }
            json(res, 200, result);
            return;
          }

          /* ── 显式会话关联绑定（fix-cosmos-association-scope 2.1 / spec「显式会话关联绑定」） ──
             归一化失败 400 invalid；工作区复用启发式归属同源解析（registry sessionIds
             反查 → 会话 cwd 兜底），解析不到 400 workspace/unknown（存储/广播零变化）；
             替换语义写入后**仅 changed 时**落盘 + 广播（persistAssociations 无条件广播，
             幂等重绑 MUST 跳过）；200 {ok, bound}（bound = 归一化后清单）。 */
          if (route === "/bind-session" && req.method === "POST") {
            const request = normalizeBindRequest(await readJsonBody(req));
            if (!request.ok) {
              json(res, 400, { error: "invalid", reason: request.reason });
              return;
            }
            const workspace = resolveSessionWorkspace(request.sessionId);
            if (!workspace) {
              json(res, 400, { error: "workspace/unknown", sessionId: request.sessionId });
              return;
            }
            const result = applyBinding(entries, {
              workspace,
              sessionId: request.sessionId,
              proposals: request.proposals
            });
            entries = result.entries;
            if (result.changed) {
              /* 关联投影随骨架下发：已在册骨架需同拍重建（客户端收到
                 associations-changed 后会重拉 /scene——不回填即返回旧边）。 */
              if (scanned) {
                skeleton = rebuildSkeleton();
              }
              persistAssociations();
            }
            json(res, 200, { ok: true, bound: request.proposals });
            return;
          }

          /* ── 渲染服务端点（step5-cosmos-path-render-convergence 2.1 / spec「渲染服务端点」） ──
             外部技能加载机制（dsh-v-skill-links 等）注入前把待注入正文**整段**提交 →
             端点按契约「路径令牌契约」语义渲染后整段返回（`content` + 四枚状态键）。
             渲染复用 provider `get()` 同一核心与同一配置读取面（`readPaths` /
             `readPathsStatus` → 状态化警示）——**不经过 providerHandle**：skills 服务
             缺席时端点仍可用（渲染只依赖配置面，这正是外部加载器需要的独立性）。
             零配置、零持久化、不触碰 openspec 工件：渲染只作用于响应；配置每次实时读取
             （热生效）。请求净房：缺 text / 非字符串 → 400，不产生任何副作用。 */
          if (route === "/render-skill-text" && req.method === "POST") {
            const body = await readJsonBody(req);
            if (typeof body?.text !== "string") {
              json(res, 400, { error: "invalid", reason: "缺少 text（必须是字符串）" });
              return;
            }
            const report = renderSkillTextReport(body.text, () => readPaths().openspecPath, readPathsStatus());
            json(res, 200, report);
            return;
          }

          /* ── 星胚移除（add-cosmos-embryo-dismiss 2.1 / CONTRACT §6.3） ──
             dsh-v-cosmos 一等清理方：用户在星胚信息卡两击确认后，硬删除
             `openspec/pending-changes/<slug>.json` 单文件。**仅用户显式点击驱动**——本端点
             不挂任何定时/推导触发者。恒 200 + outcome 枚举（照 archive-sessions 口径）：
             workspace 解析 → slug 白名单（零路径解析）→ 同名提案目录守卫 → 锚点存在性
             幂等 → `unlinkSync`（捕 ENOENT 归幂等，其余异常 failed + reason）。 */
          if (route === "/dismiss-embryo" && req.method === "POST") {
            const body = await readJsonBody(req);
            const workspacePath = workspacePathOf(body?.workspaceId);
            if (!workspacePath) {
              json(res, 200, { outcome: "missing-workspace" });
              return;
            }
            const slug = body?.slug;
            if (!isDismissableSlug(slug)) {
              /* 白名单先于任何路径解析：路径穿越输入（/ \ ..）恒不可达文件系统。 */
              json(res, 200, { outcome: "failed", reason: "非法 slug" });
              return;
            }
            /* 目录守卫先行：同名真实提案目录存在 → 绝不触碰（锚点按目录优先本就被忽略）。 */
            if (existsSync(join(workspacePath, "openspec", "changes", slug))) {
              json(res, 200, { outcome: "guard-dir-exists" });
              return;
            }
            const anchorPath = join(workspacePath, "openspec", "pending-changes", slug + ".json");
            /* 锚点存在性：缺失 = 幂等（重复移除 / ff 已清理）。 */
            if (!existsSync(anchorPath)) {
              /* 星胚移除的曲率清理同样幂等（重复移除时已清空 → removed 0 零广播）。 */
              clearWarpForDismissedEmbryo(body?.workspaceId, slug);
              json(res, 200, { outcome: "already-missing" });
              return;
            }
            try {
              unlinkSync(anchorPath);
            } catch (error) {
              /* 存在性检查与删除之间被 ff / explore 并发清理 → 归幂等（恒 200 不破）。 */
              if (error?.code === "ENOENT") {
                clearWarpForDismissedEmbryo(body?.workspaceId, slug);
                json(res, 200, { outcome: "already-missing" });
                return;
              }
              json(res, 200, { outcome: "failed", reason: String(error?.message || error) });
              return;
            }
            /* 星胚被移除 → 清该星胚目标全部曲率条目（two-add-cosmos-proposal-warp 4.3）。 */
            clearWarpForDismissedEmbryo(body?.workspaceId, slug);
            json(res, 200, { outcome: "deleted" });
            return;
          }

          /* ── 动作执行队列（add-cosmos-action-queue 4.1 / design D6） ──
             `GET /queue` 全量快照（UI 纯投影）；`POST /queue/*` 操作面：enqueue 按当前按钮
             配置落快照（入队时刻复验与渲染门控同谓词）、reorder/remove/clear/pause/resume
             由 queue-store 校验操作矩阵（非法目标 400）。每次成功变更广播 `queue-changed`
             轻帧；返回体恒 `{ok:...}`（前端据此 toast）。 */
          if (route === "/queue" && req.method === "GET") {
            json(res, 200, { ok: true, queue: queueViewSnapshot() });
            return;
          }
          if (route.startsWith("/queue/") && req.method === "POST") {
            const action = route.slice("/queue/".length);
            const body = await readJsonBody(req);
            const wsId = typeof body?.wsId === "string" ? body.wsId.trim() : "";
            if (!wsId) {
              json(res, 400, { error: "invalid", reason: "缺少 wsId" });
              return;
            }
            /* 工作区必须已在册（未知星座的队列操作一律拒绝，不落任何空队列）。 */
            const workspacePath = workspacePathOf(wsId);
            if (!workspacePath) {
              json(res, 400, { error: "workspace/unknown" });
              return;
            }
            if (action === "enqueue") {
              const proposalId = typeof body?.proposalId === "string" ? body.proposalId.trim() : "";
              const buttonName = typeof body?.buttonName === "string" ? body.buttonName.trim() : "";
              if (!proposalId || !buttonName) {
                json(res, 400, { error: "invalid", reason: "缺少 proposalId/buttonName" });
                return;
              }
              const proposalDir = proposalDirPath(workspacePath, proposalId);
              if (!proposalDir || !existsSync(proposalDir)) {
                json(res, 400, { error: "proposal/unknown" });
                return;
              }
              const view = configStore.snapshot(baseView);
              /* `view.value.buttons` 已是 `normalizeButtons` 归一化后的数组（读面容错）。 */
              const buttonList = Array.isArray(view?.value?.buttons) ? view.value.buttons : [];
              const button = buttonList.find((item) => item.name === buttonName);
              if (!button) {
                json(res, 400, { error: "button/unknown" });
                return;
              }
              /* 入队复验（spec「入队链路与前置状态复验」）：与动作条渲染门控同一谓词。 */
              const proposal = scanProposal(proposalId, proposalDir, readers.readTasks, readers.readBirthMs, readers.readState);
              if (!actionButtonVisible(button, { lifecycle: proposal.lifecycle, act: queueActivityActOf(wsId, proposalId) })) {
                json(res, 400, { error: "gate", reason: "前置状态不匹配" });
                return;
              }
              const enqueued = queueStore.enqueue({ wsId, proposalId, proposalDir, button });
              if (enqueued.ok !== true) {
                json(res, 400, { error: enqueued.error });
                return;
              }
              broadcastQueue();
              scheduler.kick(wsId);
              json(res, 200, { ok: true, entry: publicEntryOf(enqueued.entry) });
              return;
            }
            if (action === "reorder") {
              const entryId = typeof body?.entryId === "string" ? body.entryId : "";
              const direction = body?.direction === "up" ? "up" : body?.direction === "down" ? "down" : "";
              if (!entryId || !direction) {
                json(res, 400, { error: "invalid", reason: "缺少 entryId/direction" });
                return;
              }
              const result = queueStore.reorder({ wsId, entryId, direction });
              if (result.ok !== true) {
                json(res, 400, { error: result.error });
                return;
              }
              broadcastQueue();
              json(res, 200, { ok: true });
              return;
            }
            if (action === "remove") {
              const entryId = typeof body?.entryId === "string" ? body.entryId : "";
              if (!entryId) {
                json(res, 400, { error: "invalid", reason: "缺少 entryId" });
                return;
              }
              const result = queueStore.remove({ wsId, entryId });
              if (result.ok !== true) {
                json(res, 400, { error: result.error });
                return;
              }
              broadcastQueue();
              json(res, 200, { ok: true });
              return;
            }
            if (action === "clear") {
              const result = queueStore.clear({ wsId });
              if (result.ok !== true) {
                json(res, 400, { error: result.error });
                return;
              }
              broadcastQueue();
              json(res, 200, { ok: true, removed: result.removed });
              return;
            }
            if (action === "pause" || action === "resume") {
              const paused = action === "pause";
              const result = queueStore.setPaused({ wsId, paused });
              if (result.ok !== true) {
                json(res, 400, { error: result.error });
                return;
              }
              broadcastQueue();
              /* 继续 = 立即尝试启动队首（暂停期间完成/跳过的条目重新推进）。 */
              if (!paused) scheduler.kick(wsId);
              json(res, 200, { ok: true, paused: result.paused });
              return;
            }
            json(res, 400, { error: "invalid", reason: "未知队列操作" });
            return;
          }

          /* ── 曲率队列（two-add-cosmos-proposal-warp 4.1 / design D1、D7、D8） ──
             `GET /warp` 全量快照（UI 纯投影，投影不含 prompt 正文；工作区不在册守卫在
             读面同拍清理）；`POST /warp/attach` 按**当前曲率计划**快照附着（悬空引用丢弃、
             重复附着拒绝、星胚目标仅 proto 条目 + 已点燃 slug 立即展开）；`remove` 走操作
             矩阵；`pause/resume` 只挡点火不碰在途。每次成功变更广播 `warp-changed` 轻帧。 */
          if (route === "/warp" && req.method === "GET") {
            reconcileWarpWorkspaces();
            json(res, 200, { ok: true, warp: warpViewSnapshot() });
            return;
          }
          if (route.startsWith("/warp/") && req.method === "POST") {
            const action = route.slice("/warp/".length);
            const body = await readJsonBody(req);
            const wsId = typeof body?.wsId === "string" ? body.wsId.trim() : "";
            if (!wsId) {
              json(res, 400, { error: "invalid", reason: "缺少 wsId" });
              return;
            }
            const workspacePath = workspacePathOf(wsId);
            if (!workspacePath) {
              json(res, 400, { error: "workspace/unknown" });
              return;
            }
            if (action === "attach") {
              const targetKind = body?.targetKind === "embryo"
                ? "embryo"
                : body?.targetKind === "proposal"
                  ? "proposal"
                  : "";
              const targetKey = typeof body?.targetKey === "string" ? body.targetKey.trim() : "";
              if (!targetKind || !targetKey) {
                json(res, 400, { error: "invalid", reason: "缺少 targetKind/targetKey" });
                return;
              }
              const view = configStore.snapshot(baseView);
              const plan = view?.value?.warpPlan;
              const planBars = sanitizeWarpPlan(plan).bars;
              const buttons = Array.isArray(view?.value?.buttons) ? view.value.buttons : [];
              const entries = resolveWarpPlanEntries(plan, buttons, targetKind);
              if (planBars.length === 0) {
                json(res, 400, { error: "plan-empty", reason: "曲率计划为空：请先在「曲率引擎」设置中添加动作条" });
                return;
              }
              if (entries.length === 0) {
                json(res, 400, { error: "plan-unmatched", reason: "曲率计划中没有可应用于该目标的动作条" });
                return;
              }
              const targetLabel = typeof body?.targetLabel === "string" ? body.targetLabel.trim() : "";
              if (targetKind === "proposal") {
                const proposalDir = proposalDirPath(workspacePath, targetKey);
                if (!proposalDir || !existsSync(proposalDir)) {
                  json(res, 400, { error: "proposal/unknown" });
                  return;
                }
                const attached = warpStore.attach({
                  wsId,
                  targetKey,
                  targetKind,
                  targetLabel: targetLabel || targetKey,
                  proposalDir,
                  entries
                });
                if (attached.ok !== true) {
                  json(res, 400, { error: attached.error, reason: attached.error === "duplicate" ? "已托管" : undefined });
                  return;
                }
                broadcastWarp();
                /* 附着完成且队列运行中 → 立即复查（门控匹配条目点亮）。 */
                warpScheduler.reviewTarget(wsId, targetKey);
                refreshWarpTriggers();
                json(res, 200, {
                  ok: true,
                  targetKey,
                  entries: attached.entries.map((entry) => publicWarpEntryOf(entry)),
                  expanded: []
                });
                return;
              }
              const anchorSlugs = [];
              for (const item of Array.isArray(body?.anchorSlugs) ? body.anchorSlugs : []) {
                const slug = typeof item === "string" ? item.trim() : "";
                if (slug && !anchorSlugs.includes(slug)) anchorSlugs.push(slug);
              }
              if (anchorSlugs.length === 0) {
                json(res, 400, { error: "invalid", reason: "缺少 anchorSlugs" });
                return;
              }
              let explorerSessionId = typeof body?.explorerSessionId === "string" ? body.explorerSessionId.trim() : "";
              if (!explorerSessionId) {
                /* 服务端兜底解析：锚点 JSON 的 `sessionId`（客户端未提供时）。 */
                try {
                  const anchors = readers.readPendingDir(workspacePath) ?? [];
                  const found = anchors.find(
                    (item) => item && anchorSlugs.includes(item.name)
                      && typeof item.sessionId === "string" && item.sessionId.trim()
                  );
                  explorerSessionId = found ? String(found.sessionId).trim() : "";
                } catch {
                  explorerSessionId = "";
                }
              }
              const attached = warpStore.attach({
                wsId,
                targetKey,
                targetKind,
                targetLabel: targetLabel || targetKey,
                anchorSlugs,
                explorerSessionId,
                entries
              });
              if (attached.ok !== true) {
                json(res, 400, { error: attached.error, reason: attached.error === "duplicate" ? "已托管" : undefined });
                return;
              }
              broadcastWarp();
              /* 附着时已点燃的 slug 立即展开（不等 proto 跑完）。 */
              const expanded = expandWarpEmbryo({ wsId, anchorSlugs });
              for (const target of expanded.targets) {
                warpScheduler.reviewTarget(target.wsId, target.targetKey);
              }
              warpScheduler.reviewTarget(wsId, targetKey);
              refreshWarpTriggers();
              json(res, 200, {
                ok: true,
                targetKey,
                entries: attached.entries.map((entry) => publicWarpEntryOf(entry)),
                expanded: expanded.targets.map((target) => target.targetKey)
              });
              return;
            }
            if (action === "remove") {
              const entryId = typeof body?.entryId === "string" ? body.entryId : "";
              if (!entryId) {
                json(res, 400, { error: "invalid", reason: "缺少 entryId" });
                return;
              }
              const result = warpStore.remove({ wsId, entryId });
              if (result.ok !== true) {
                json(res, 400, { error: result.error });
                return;
              }
              broadcastWarp();
              json(res, 200, { ok: true });
              return;
            }
            if (action === "pause" || action === "resume") {
              const paused = action === "pause";
              const result = warpStore.setPaused({ wsId, paused });
              if (result.ok !== true) {
                json(res, 400, { error: result.error });
                return;
              }
              broadcastWarp();
              /* 继续 = 立即尝试点火（暂停期间点亮/待发的条目重新推进）。 */
              if (!paused) warpScheduler.kick(wsId);
              json(res, 200, { ok: true, paused: result.paused });
              return;
            }
            json(res, 400, { error: "invalid", reason: "未知曲率操作" });
            return;
          }

          /* ── 星座作品（p1-add-cosmos-works-service 2.1–2.7 / spec cosmos-works） ──
             读面：`GET /works` 全量/单星座快照（逐条 `exists` 核验，只读零写路径）、
             `GET /works/browse` 根内目录浏览（越界/符号链接拒绝、500 截断）；
             写面：`POST /works/add|pick|update|remove`（成功即原子写盘 + `works-changed` 轻帧；
             `pick` = 宿主原生文件选择器，客户端不再自建模态）；
             动作面：`POST /works/open|reveal`（**只收 `(wsId, workId)`**——请求体里的任何
             裸路径字段不参与裁决：未登记路径无启动通道，spec「裸路径不可注入」）。
             错误一律结构化 `{ok:false, error, reason}`（reason 同码，见 WORKS_STATUS）。 */
          if (route === "/works" && req.method === "GET") {
            /* wsId 缺席 = 全量；未知/空星座/不在册 → 空 entries（SHALL NOT 报错，
               spec「空星座快照」；不在册星座的残留条目不投影内容）。 */
            const wsId = (url.searchParams.get("wsId") ?? "").trim();
            json(res, 200, {
              ok: true,
              ...worksStore.snapshot({
                wsId,
                existsOf: workExistsOf,
                knownOf: (id) => worksRootOf(id) !== null
              })
            });
            return;
          }

          if (route === "/works/browse" && req.method === "GET") {
            const wsId = (url.searchParams.get("wsId") ?? "").trim();
            if (!wsId) {
              worksError(res, "invalid");
              return;
            }
            const root = worksRootOf(wsId);
            if (!root) {
              worksError(res, "workspace/unknown");
              return;
            }
            const listed = browseWorksDir(root, url.searchParams.get("dir"));
            if (listed.ok !== true) {
              worksError(res, listed.reason);
              return;
            }
            json(res, 200, {
              ok: true,
              cwd: listed.cwd,
              parent: listed.parent,
              entries: listed.entries,
              truncated: listed.truncated
            });
            return;
          }

          /* 系统文件选择器登记（用户修订：MUST NOT 自建浏览模态）：原生对话框多选 →
             绝对路径收敛进工作区根 → 同 `/works/add` 校验链整批原子登记 → 一帧广播。
             取消（null/空选）→ `{ok:true, cancelled:true, entries:[]}`（静默）。
             `picker-busy` 防并发（同一时刻只允许一个系统对话框）。 */
          if (route === "/works/pick" && req.method === "POST") {
            const body = await readJsonBody(req);
            const wsId = typeof body?.wsId === "string" ? body.wsId.trim() : "";
            if (!wsId) {
              worksError(res, "invalid", { message: "缺少 wsId" });
              return;
            }
            const root = worksRootOf(wsId);
            if (!root) {
              worksError(res, "workspace/unknown");
              return;
            }
            if (pickerBusy) {
              worksError(res, "picker-busy");
              return;
            }
            pickerBusy = true;
            let picked;
            try {
              picked = await pickFilesFor(root);
            } finally {
              pickerBusy = false;
            }
            if (picked.ok !== true) {
              worksError(res, picked.reason, picked.message ? { message: picked.message } : {});
              return;
            }
            if (!Array.isArray(picked.files) || picked.files.length === 0) {
              json(res, 200, { ok: true, cancelled: true, entries: [] });
              return;
            }
            const relPaths = [];
            for (const file of picked.files) {
              const relPath = relPathWithin(root, file);
              if (!relPath) {
                const name = String(file).split(/[\\/]/).filter(Boolean).pop() || String(file);
                worksError(res, "out-of-root", { message: "所选文件不在当前工作区内：" + name });
                return;
              }
              relPaths.push(relPath);
            }
            const added = worksStore.add({
              wsId,
              relPaths,
              checkFile: (relPath) => {
                const checked = resolveWorkFile(root, relPath);
                if (checked.ok === true) return { ok: true };
                const reason = checked.reason === "missing-on-disk" ? "not-a-file" : checked.reason;
                return { ok: false, reason };
              }
            });
            if (added.ok !== true) {
              worksError(res, added.reason, added.relPath ? { relPath: added.relPath } : {});
              return;
            }
            broadcastWorks();
            json(res, 200, {
              ok: true,
              picked: relPaths.length,
              entries: added.entries.map((entry) => publicWorkOf(entry, true))
            });
            return;
          }

          if (route === "/works/add" && req.method === "POST") {
            const body = await readJsonBody(req);
            const wsId = typeof body?.wsId === "string" ? body.wsId.trim() : "";
            if (!wsId) {
              worksError(res, "invalid", { message: "缺少 wsId" });
              return;
            }
            const root = worksRootOf(wsId);
            if (!root) {
              worksError(res, "workspace/unknown");
              return;
            }
            /* 请求净房：只认 `relPaths`（批量）与 `relPath`（单条别名）；其余字段（含 `path`）
               一律不进裁决。形态净房在 store 内完成，磁盘裁决经 `checkFile` 注入。 */
            const relPaths = Array.isArray(body?.relPaths)
              ? body.relPaths
              : typeof body?.relPath === "string"
                ? [body.relPath]
                : [];
            const added = worksStore.add({
              wsId,
              relPaths,
              checkFile: (relPath) => {
                const checked = resolveWorkFile(root, relPath);
                if (checked.ok === true) return { ok: true };
                /* 登记语汇只区分 not-a-file（目录/不存在/非普通文件统一口径，task 2.3）。 */
                const reason = checked.reason === "missing-on-disk" ? "not-a-file" : checked.reason;
                return { ok: false, reason };
              }
            });
            if (added.ok !== true) {
              worksError(res, added.reason, added.relPath ? { relPath: added.relPath } : {});
              return;
            }
            broadcastWorks();
            json(res, 200, { ok: true, entries: added.entries.map((entry) => publicWorkOf(entry, true)) });
            return;
          }

          if (route === "/works/update" && req.method === "POST") {
            const body = await readJsonBody(req);
            const wsId = typeof body?.wsId === "string" ? body.wsId.trim() : "";
            const workId = typeof body?.workId === "string" ? body.workId.trim() : "";
            if (!wsId || !workId) {
              worksError(res, "invalid", { message: "缺少 wsId/workId" });
              return;
            }
            /* `name`/`note` 全额覆盖：缺席/空白 = 清除回落（spec 端点语义）。 */
            const updated = worksStore.update({ wsId, workId, name: body?.name, note: body?.note });
            if (updated.ok !== true) {
              worksError(res, updated.reason);
              return;
            }
            broadcastWorks();
            json(res, 200, { ok: true, entry: publicWorkOf(updated.entry, workExistsOf(wsId, updated.entry)) });
            return;
          }

          if (route === "/works/remove" && req.method === "POST") {
            const body = await readJsonBody(req);
            const wsId = typeof body?.wsId === "string" ? body.wsId.trim() : "";
            const workId = typeof body?.workId === "string" ? body.workId.trim() : "";
            if (!wsId || !workId) {
              worksError(res, "invalid", { message: "缺少 wsId/workId" });
              return;
            }
            /* 只删条目、MUST NOT 触碰文件系统上的文件本身；清空星座即回收容器键。 */
            const removed = worksStore.remove({ wsId, workId });
            if (removed.ok !== true) {
              worksError(res, removed.reason);
              return;
            }
            broadcastWorks();
            json(res, 200, { ok: true, removed: { id: removed.removed.id, relPath: removed.removed.relPath } });
            return;
          }

          if (route === "/works/open" && req.method === "POST") {
            const body = await readJsonBody(req);
            const wsId = typeof body?.wsId === "string" ? body.wsId.trim() : "";
            const workId = typeof body?.workId === "string" ? body.workId.trim() : "";
            if (!wsId || !workId) {
              worksError(res, "invalid", { message: "缺少 wsId/workId" });
              return;
            }
            const verified = verifiedWorkOf(wsId, workId);
            if (verified.ok !== true) {
              worksError(res, verified.reason);
              return;
            }
            if (!isWindows()) {
              worksError(res, "platform-unsupported");
              return;
            }
            const { entry, abs } = verified;
            /* ── 启动形态统一（fix-cosmos-works-exec-launch-semantics D1/D2）：exec 与其余
               类型同一入口 `cmd /c start "" "<引号绝对路径>"`（ShellExecute = 资源管理器
               双击）——exe/bat/cmd 一律走此形态，**无 exe 直接 spawn 特例**（旧 exe 子路径与
               其「路径元字符」理由注释一并删除：该顾虑由 `cmdQuote` + `windowsVerbatimArguments`
               承担，与 bat/cmd 同一防线）。
               窗口语义：被启动进程 SHALL NOT 被隐藏——bat/cmd 与控制台型 exe 获**新建可见
               控制台**、GUI exe 正常弹窗；交互式脚本的列表/输入因此有着落，也不会隐身挂死成
               僵尸进程。执行白名单（design D3）零改动：端点只收 `(wsId, workId)`、`relPath`
               根内包含性、扩展名收窄 exe/bat/cmd。引号纪律原样：`cmdQuote` 整体加引号且
               `windowsVerbatimArguments` 关掉 Node 二次引号处理，条目名里的 `&`/`|`/`>` 不会
               成为命令分隔符；`'""'` 占 `start` 的首个「窗口标题」参数位。
               wrapper 上的 `windowsHide` 只作用于瞬时的 cmd 外壳——`start` 经 ShellExecute
               新建的进程窗口态由 shell 决定，**不受父进程 hide 影响**（非 exec 分支的既有
               成熟先例，design D3）。cwd 恒为条目所在目录（design D5 的 cwd 裁决保留）。 */
            try {
              const openOptions = {
                cwd: dirname(abs),
                detached: true,
                stdio: "ignore",
                windowsHide: true,
                windowsVerbatimArguments: true
              };
              if (entry.kind === "exec") {
                /* 执行面：与资源管理器双击同语义运行（可见控制台；即发即忘）。 */
                launchDetached("cmd.exe", ["/c", "start", '""', cmdQuote(abs)], openOptions);
              } else {
                /* 其余一切类型（md/pdf/html/other/ps1）走系统默认程序打开，
                   SHALL NOT 以可执行方式运行（`start` 即 ShellExecute 语义）。 */
                launchDetached("cmd.exe", ["/c", "start", '""', cmdQuote(abs)], openOptions);
              }
            } catch (error) {
              /* 启动调用本身失败（如进程创建配额）→ 结构化错误，不抛未捕获异常。 */
              ctx.logger?.warn?.("[dsh-v-cosmos] 作品启动失败: %s", String(error?.message || error));
              worksError(res, "launch-failed", { message: String(error?.message || error) });
              return;
            }
            /* 成功才记账（lastLaunchedAt）+ 单帧广播；启动本身即发即忘（design D5）。 */
            const touched = worksStore.touch({ wsId, workId });
            if (touched.ok === true) broadcastWorks();
            const view = touched.ok === true ? touched.entry : entry;
            json(res, 200, { ok: true, entry: publicWorkOf(view, true) });
            return;
          }

          if (route === "/works/reveal" && req.method === "POST") {
            const body = await readJsonBody(req);
            const wsId = typeof body?.wsId === "string" ? body.wsId.trim() : "";
            const workId = typeof body?.workId === "string" ? body.workId.trim() : "";
            if (!wsId || !workId) {
              worksError(res, "invalid", { message: "缺少 wsId/workId" });
              return;
            }
            const verified = verifiedWorkOf(wsId, workId);
            if (verified.ok !== true) {
              worksError(res, verified.reason);
              return;
            }
            if (!isWindows()) {
              worksError(res, "platform-unsupported");
              return;
            }
            try {
              /* `explorer /select,<abs>` 是**单个**参数（含逗号）；目标不被运行。
                 零 `works-changed` 帧：无文档变更（spec「定位端点」）。 */
              launchDetached("explorer.exe", ["/select," + verified.abs], {
                detached: true,
                stdio: "ignore",
                windowsHide: true
              });
            } catch (error) {
              ctx.logger?.warn?.("[dsh-v-cosmos] 定位失败: %s", String(error?.message || error));
              worksError(res, "launch-failed", { message: String(error?.message || error) });
              return;
            }
            json(res, 200, { ok: true, entry: publicWorkOf(verified.entry, true) });
            return;
          }

          /* ── SSE 轻帧广播（add-cosmos-entry）：既有心跳、proposals/associations
             帧机制；连接建立/断开只增减客户端集合。 ── */
          if (route === "/events" && req.method === "GET") {
            res.writeHead(200, {
              "content-type": "text/event-stream",
              "cache-control": "no-cache",
              connection: "keep-alive"
            });
            res.write("retry: 3000\n\n");
            res.write(": connected\n\n");
            sseClients.add(res);
            startHeartbeat();
            res.on("close", () => {
              sseClients.delete(res);
              maybeStopHeartbeat();
            });
            return;
          }

          json(res, 404, { error: "unknown route" });
        } catch (error) {
          json(res, 400, { error: String(error?.message || error) });
        }
      }
    });

    return () => {
      dispose();
      disposeQueueListeners(); // 摘除 agent 事件面监听
      scheduler.dispose(); // 清队列定时器（持久化状态不触碰）
      warpScheduler.dispose(); // 清曲率定时器 / 绑定（持久化状态不触碰）
      stopConfigWatch();
      disposeTokenFallback?.(); // 摘除路径令牌读取兜底监听
      for (const workspaceId of [...watchers.keys()]) dropWatcher(workspaceId);
      if (scanTimer) {
        clearTimeout(scanTimer);
        scanTimer = null;
      }
      for (const res of sseClients) {
        try {
          res.end();
        } catch {
          /* 已断开 */
        }
      }
      sseClients.clear();
      if (heartbeat) clearInterval(heartbeat);
    };
  }, "dsh-v-cosmos: api routes");
}

/* 导出供测试与后续 UI 消费的观察面（不改变运行时行为）。 */
export { ASSOC_VERSION, upsertAssociation, normalizeAssociations };
