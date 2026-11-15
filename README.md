# dsh-v-cosmos · V Cosmos

**简体中文** | [English](README.en.md)

**DSH Web 的工作区星系可视化插件**：工作区 = 星座，活跃提案 = 恒星（颜色 = 提案生命周期，
热度 = 活跃会话数），openspec 会话 = 行星（四态会话状态），自由会话 = 彗星，
子代理会话 = 卫星（绕父天体），归档变更 = 星云（密度 = 数量）。
风格 D（HUD + 过程化银河）——回答一个问题：**我的宇宙现在长什么样、哪里需要我**。

纯增量插件：不替换、不禁用任何官方插件；对 openspec 工件恒只读。

v0.2 起它同时是**控制台**：左侧提案列表面板选中提案 → 底部动作按钮条一键把
「提示词 + @提案目录」发进该提案工作区的新会话（可自动发送首回合、可绑定模型）——
「观察 → 出手 → 状态回流变色」在同一页面闭环。

## 天体语言

| 天体 | 含义 | 视觉编码 |
|---|---|---|
| 星座 | 工作区 | Fibonacci 球壳 3D 分布（环绕视点全方向铺开，间距松弛防碰撞） |
| ✦ 恒星 | 活跃提案（openspec change） | **颜色 = 生命周期四态**（cosmos-spec 契约）：待创建星胚（灰蓝虚线轮廓+呼吸）/ 已创建蓝白 / 已审核升亮+金章环 / 已执行金色；**热度通道** = act（白热核+十字耀斑，不改颜色）；星胚位置 = 点燃后位置（确定性预占位） |
| ● 行星 | 绑定提案的 openspec 会话 | 绕关联恒星公转；**颜色 = 会话四态**（待机灰白 / 执行中青蓝 / 待决策琥珀光柱+扩散环 / 完成未读薄荷绿 halo 慢脉动）；查看后渐熄回待机；委托忙碌附加青蓝微光环 |
| ◇ 卫星 | 子代理会话（origin: subagent） | 绕父天体（行星/彗星）子轨道虚线环 `[3,5]`；实心圆点，色 = 自身会话四态降饱和 35%；单层渲染、单父可见上限 6（超出折入父卡「子代理 ×N」）；待决策卫星带迷你琥珀光柱；无独立信息卡（不参与拾取） |
| 联星 | 一会话关联多提案 | 行星绕多星质心做联星轨道（circumbinary） |
| ☄ 彗星 | 自由会话 | 星座外围漂泊，尾迹 = 近期活跃；消亡 → 流星划过熄灭；可挂卫星（委托忙碌仅光环不计 act） |
| ☁ 星云 | 归档变更集合 | 尘埃密度 = 归档数量（cap 520 粒） |

星座计数仪表分级呈现：**银河视图 chip 只显示星座名**；进入星座（钻取态）后页面顶部中央
星座标牌显示全量计数 `✦恒星（含星胚） ●行星 ◇卫星（含折叠） ☄彗星 ☁星云`，并随场景实时更新。
星座内金色虚线 = 提案关联（由共享会话派生）。blank 会话与未归属工作区的会话不渲染；
孤儿卫星（父不在镜像/blank/归档/未归属）不渲染。

**状态转场**：星胚点燃 2.2s（轮廓收缩→爆闪→色相渐变）；审核落印 1.6s（金环收拢 +
α 淡入）；完成未读查看渐熄 ~1.6s easeOut（色相渐褪 + halo 消退）。基线 =
`demo/states/states-a-seal.html`（方案一「星章」，参数以 `assets/states-core.js` 为准）。

## 安装与注册

前置：本机 DSH（web profile）已运行；插件目录为 `C:/project/dsh-plugin-v/dsh-v-cosmos`。

```bash
# 1. 构建（产物 lib/index.js + lib/client.js + sourcemap）
npm install
npm run build

# 2. 注册进用户 web profile（两条改动，已按本仓路径写好则跳过）
#    $DSH_HOME/profiles/web/package.json：
#      dsh.profile.bundles 追加 "dsh-v-cosmos"
#      dependencies 增加  "dsh-v-cosmos": "link:C:/project/dsh-plugin-v/dsh-v-cosmos"
pnpm install --dir "$env:DSH_HOME/profiles/web"

# 3. 重启 DSH web profile（新 bundle 在宿主启动期进入 /plugins 启动图；
#    已注册 bundle 的文件改动走 HMR 热更，无需重启）
dsh web
```

验证注册（不挂载）：`dsh --profile web --dump-config` 应出现 `- id: dsh-v-cosmos`。

## 入口

- 侧栏底部「**Cosmos**」按钮（Hive 与 Token统计之间）→ 应用内整页；
- 整页左缘跟踪侧栏右缘；Esc 分层：钻取返回银河 > 退全屏 > 关整页；
- 点星座 chip / 恒星 → 1.3s dive-in；右下「**回到银河**」方形按钮或 Esc 飞回
  （回到钻取前位置）；银河根级点该按钮仅清除选中，不关页；
- HUD：**无面包屑、无右上操作提示**——银河态顶部中央为搜索框，钻取态顶部中央为星座标牌
  （星座名 + 计数仪表，居中对齐；搜索框在钻取态隐藏、查询冻结，飞回后带原查询重现），
  返回路径由 Esc（桌面）与右下按钮（触屏）承担；空态「暂无在册工作区」提示保留；
- hover 天体 → HUD 信息卡；行星/彗星卡并列两颗按钮：「打开会话」→ 关整页并切换右侧
  系统会话页；「归档会话」→ 就地归档该会话（整页保持打开，天体随后谢幕，见下文
  「会话卡就地归档」）；卫星无信息卡、无归档入口；
- 拖拽旋转 / 滚轮缩放 / **双指捏合缩放**（值域与滚轮一致，覆盖星座卡片、信息卡等
  任意覆盖元素上均生效——无缩放死区）/ **WASD 平移相机**（固定速度，不随缩放变化；
  Shift 加速档；输入框聚焦与 Ctrl/Alt/Meta 组合键不劫持）；多指手势期间与结束后
  350ms 内的点击被抑制（防捏合误触 dive）；
- 左下「＋」方形按钮（44×44，触屏目标 ≥40px）→ 新增工作区；
- 整页关闭或页签切后台自动暂停渲染循环。

## 提案动作（控制台）

整页新增两块常驻 UI（均避让既有 HUD：左下「＋」、右下「回到银河」、顶部搜索框、钻取标牌）：

- **左侧提案列表面板**（187px，原 280px 收窄 1/3）：按工作区分组（组标题 = 星座名）、组内按名称字典序；
  银河态**无活跃提案的工作区自动隐藏**（不生成空分组/空标题）；
  卡片颜色与恒星同源（已创建 `#9fd8ff` / 已审核 `#cfe8ff` + 金章徽标 / 已执行 `#ffe27a`，
  缺失或非法 `.state.json` 兜底已创建）；展示 tasks `x/y`、`setBy` 与 `at`（存在时）。
  钻取态只显示当前星座（无提案时显示「该星座暂无提案」）；搜索过滤时分组跟随命中集合；
  无任何活跃提案时面板不渲染（零布局）。点卡片 = **选中 + 聚焦飞行**（「带我去那颗星」）：
  银河态/他星座钻取态钻入该提案所属星座并在落地选中恒星，同星座钻取态以约 0.6s 短补间
  重对焦到该恒星（镜头不动时不重播全量钻入）；飞行目标缺失（已归档/星胚）静默降级，
  选中与动作目标不受影响。**点击面板/动作条/搜索框以外的区域取消选中**，点击其他卡片仅
  切换动作目标（动作条保持点亮）；例外 = 画布命中天体（钻取态恒星由联动转移选中、行星/
  彗星保持既有选中），画布空白照常双侧同清。反向联动：视图里选中恒星（非星胚）时面板
  自动选中对应提案卡片、动作条随之点亮（行星/彗星/星胚无提案对应物，面板保持）；
  待创建星胚（`pending-changes/` 锚点）不进列表。面板是内容滚动区：原生滚动/文本选择
  保留，面板内聚焦时 WASD 不劫持相机、Esc 为失焦（不返回银河、不关页）。
- **底部动作按钮条**：正下方居中、一行 8 个等宽、自动换行（上限 32 = 4 行）；
  未选中提案时禁用并熄灭，选中后点亮（暖金描边 + 微辉光）；按钮列表为空时不渲染。动作条上滚轮照常缩放镜头
  （非滚动区，经引擎 `zoomBy` 转发）并**携带指针坐标参与聚焦收敛**——与容器内滚轮同一收敛式、同一端点冻结，
  多次滚动逐步向指针位置聚焦；缩放按钮无指针坐标，保持屏心缩放。公共面缩放**恒不参与缩放阈值导航判定**
  （动作条上滚轮/按钮不会自动进入或返回星座）；按钮条渲染期间引擎 toast 自动上移到按钮条之上。

点击按钮的链路（「新开会话」固定开启 + 每按钮「执行后跳转」）：

1. 组装消息：`@<提案目录>` = `@` + `<工作区>/openspec/changes/<提案名>`（正斜杠绝对路径，
   含空格不加引号）；`prepend` 为真 = **提示词在前**，否则 **@引用在前**；
2. 经官方 `ctx.sessions.create({ workspaceId })` **恒新建**一个 blank 会话（不带
   `sessionId`——宿主仅对具名 blank 复用，缺省恒新建），登记一次性标记（绑定目标
   SessionId）后经 `uiWorkspace.openSession(新会话 id)` 导航——「新开会话」为固定语义
   （行内锁定徽标，不可关闭）；用户的既有会话与其未发送草稿**零接触**（不复用、不覆盖、
   不归档任何既有 blank）。随后按**该按钮**的「执行后跳转」配置（缺省开启）流转：
   开启 = 关闭 Cosmos 整页、右侧呈现该会话；关闭 = 整页保持打开（新会话已在覆盖层底下
   创建，自动发送照常提交首回合），成功经引擎 toast 反馈；
3. 新会话首屏的 `conversation.input.dock` hero 相位消费一次性标记：先校验**本会话 id 与
   标记目标一致**（无关 blank 零动作、零清除），草稿为空时经 `inputActions.setDraft`
   落稿（**既有非空草稿绝不改写**），草稿恰为消息时按提交意图分流——勾选「自动发送」时
   落稿后提交一次首回合（有绑定模型先切模型，失败 toast 不阻断）；未勾选则仅落稿。
   标记约 10s 过期（过期未消费 = 新会话草稿未落、未发送，不丢用户内容、不误发）；
4. 降级路径：`sessions.create` 不可用（宿主通道缺失 / 创建被拒）时回落官方
   `uiWorkspace.startSession(提案工作区, { prompt })`（keep 语义）并 toast 注明降级——
   此时消费判据退回「草稿等校验」（不一致不提交、不清标记）。星座动作链路同口径
   （恒新建；未勾选自动发送时由浮窗消费器落稿后呈现，废除 `replace` 主路径覆盖语义，
   `replace` 只保留在降级链路）。

> **`prepend` 语义差异**：本插件的「提示词在前」指消息里提示词与 @提案引用的先后；
> 与 `dsh-v-skill-links` 同名但不同义（那里指把提示词前插进既有草稿）。

## 配置

### 页面设置（localStorage）

页面设置持久化在 `localStorage["dsh-v-cosmos:settings"]`（净房界内置，越界落端点；旧名 `dsh-cosmos:settings` 存量自动回落读取）：

| 键 | 缺省 | 界 | 含义 |
|---|---|---|---|
| `panSpeed` | `120` | `[20, 600]` | WASD 基础平移速度（世界单位/秒，固定值不随缩放变化） |
| `panShiftBoost` | `3` | `[1, 10]` | Shift 加速倍率 |
| `skin` | `rosepine` | 12 套内置皮肤 id | HUD 主题皮肤（非法/未知 id 回落默认） |

> 「执行后跳转」不是页面偏好，而是**每个动作按钮自己的配置项**（`buttons[].jumpNewSession`，
> 缺省 true；仅取消勾选时落 `false` 键），随按钮配置写入 `cordis.patch.yml` 的用户层。

调整方式（设置 UI 后续变更提供；当前可经控制台）：

```js
// DevTools 控制台（改完刷新页面生效）：
const s = JSON.parse(localStorage.getItem("dsh-v-cosmos:settings") ?? "{}");
s.panSpeed = 200; // ±panShiftBoost 同理
localStorage.setItem("dsh-v-cosmos:settings", JSON.stringify(s));
```

出厂默认值定义于 `src/settings.mjs`（`COSMOS_SETTINGS_DEFAULTS`）——只调默认改这一处。

### 动作按钮（共享配置存储）

按钮配置存于插件自营共享文件 **`$DSH_HOME/dsh-v-cosmos.config.json`**（与关联存储
`storages/dsh-v-cosmos.json` 完全独立）：

```json
{
  "revision": 3,
  "buttons": [
    {
      "name": "审查",
      "prompt": "请使用 /cosmos-review 审查本提案",
      "autoSend": true,
      "newSession": true,
      "prepend": true,
      "model": { "provider": "deepseek", "model": "deepseek-chat", "reasoningEffort": "max" }
    },
    {
      "name": "执行本提案",
      "prompt": "请使用 /cosmos-apply-change 按 tasks.md 执行本提案",
      "autoSend": false,
      "newSession": true
    }
  ]
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | 是 | 按钮显示名（trim 后去重；可中文） |
| `prompt` | 是 | 提示词（非空；上限 20000 字符） |
| `autoSend` | 归一化恒输出 | 缺省视为 `false`；非布尔值保存被拒绝 |
| `newSession` | 归一化恒 `true` | 「新增会话」为固定模式：缺失按 `true` 补齐（旧数据零迁移），非 `true` 保存被拒绝 |
| `prepend` | 否 | 仅 `true` 时写出该键；语义 = 消息里提示词位于 @提案引用之前 |
| `model` | 否 | `{ provider, model, reasoningEffort? }` 原样透传（不补默认值）；执行时先切模型后发 |

- 上限 32 条，`name` trim 后重复保存被拒绝（设置页提示「名称重复 / 超过上限」）；
- 每条写入前轮转 `.bak.1~3`（复制式备份），临时文件 + 原子替换，跨进程锁内校验
  （锁等待约 1s 超时 → HTTP 503）；并发写入以 `revision` CAS 裁决（先写者成功、后写者 409）；
  主文件损坏按 `.bak.1 → .bak.2 → .bak.3` 依次恢复；
- 宿主 `fs.watch` 热重载：手工编辑该文件，打开的设置页与 Cosmos 按钮条秒级内跟随，无需重启；
- 通道：自营 API `GET/PUT /api/dsh-v-cosmos/config` 首选；宿主 `settingsScope` /
  `configForms` 为 fallback；三条皆不可达时只读降级（动作条不渲染、设置页提示只读、插件激活不受阻）。

### 设置页

**设置 → Cosmos → 快捷动作**（本插件首次拥有设置 UI）：新增/删除/编辑按钮行
（name、prompt、自动发送、提示词在前、执行后跳转、锁定「新增会话」徽标、模型与级别
下拉）、拖拽把手 + 上移/下移排序、暂存-保存（「放弃修改」回退草稿；用户层存在覆盖时
显示「重置为组合层」）。模型下拉候选与会话模型菜单同源（官方
`remote.session.modelCatalog`），级别默认最高；目录不可达时仅「跟随会话（默认）」；
已存绑定漂移原样回显并标「不可用」。数组顺序即按钮展示顺序，保存后即刻热生效。
「执行后跳转」是**每按钮独立**配置（缺省勾选 = 执行成功后关闭整页跳转；取消 = 保持
Cosmos 画面，新会话仍在覆盖层底下创建/发送），与锁定「新增会话」正交——取消跳转
不影响新建会话；该字段随行草稿保存，不写页面偏好面（星座动作行不呈现该字段）。

> **升级提示**：按钮配置由宿主半区归一化后落盘（`lib/buttons.mjs` 的
> `normalizeButtons`）。升级插件后请**重启 DSH 宿主**（仅刷新页面不够）——旧宿主会
> 静默丢弃新增的 `jumpNewSession` 键，表现为「取消勾选『执行后跳转』保存后又勾上」。

## 数据与关联（规则核心）

- **星空骨架**（恒星/星云/连线/待创建锚点）由宿主半区扫描各工作区 `openspec/`
  生成（`GET /api/dsh-v-cosmos/scene`），fs.watch（`openspec/` 根 recursive）增量 +
  SSE 轻帧广播跨页签同步；
- **会话事实** 100% 来自浏览器半区官方镜像（`ctx.sessions.list` /
  `ctx.workspaces.list`），四态状态信号来自统一会话状态快照
  （`ctx.uiSession.sessionStatus` 的 running / pendingInteraction / completionUnread，
  不可达时降级 idle/busy 两态）；卫星父子链由镜像 `origin`/`parentSessionId` 推导
  （不依赖宿主层字段）；状态推导全部在客户端完成；
- **提案生命周期状态** 来自 cosmos-spec 契约的两个磁盘文件（渲染端恒只读）：
  `openspec/changes/<name>/.state.json`（created/reviewed/executed）与
  `openspec/pending-changes/<slug>.json`（待创建锚点）；缺失/非法兜底「已创建」，
  状态随提案目录跨设备迁移。契约 schema / 回填规则 / 变体技能文本见
  **[cosmos-spec/CONTRACT.md](cosmos-spec/CONTRACT.md)**（唯一定义点）；
- **会话↔提案关联** 存于插件自有存储 `$DSH_HOME/storages/dsh-v-cosmos.json`
  （旧名 `dsh-cosmos.json` 存量首启回读迁移；origin: heuristic 记录，条目封顶 512 按 updatedAt 淘汰）：
  - 规则 1：会话归属工作区且近期上下文含提案 slug → 关联；
  - 规则 2：提案目录出现 ±30min 窗口内唯一活跃会话 → 关联；
  - 幂等（已有关联不重写）；会话归档剪除条目，提案归档保留边记录（行星回归彗星）。
- **零侵入纪律**：工作区目录恒只读（含契约文件——由 openspec CLI 零感知断言固化）；
  MUST NOT 写任何 openspec 工件（动作按钮链路同样零写入：执行前后 `openspec/` 逐字节一致、
  `openspec list/status/validate` 输出不变，`test/zero-pollution-smoke.mjs` 固化）；
  不修改任何 DSH 官方包。
- **会话扫尾**（add-cosmos-archive-session-sweep）：归档技能经两个通用端点驱动宿主会话
  状态——`POST /archive-sessions` 批量归档提案关联会话（宿主活动瀑布准入：turn /
  子代理链 / job / schedule 在跑者**只跳过、绝不停止**；已归档幂等跳过），
  `POST /rename-session` 给归档者自身加 `已归档-` 前缀（钉住标题，作后续整体收拾的
  检索标记）；自身永不归档。扫尾同样**不改 openspec 目录**（`openspec/` 逐字节一致 +
  `list/status/validate` 输出不变，同一冒烟套件固化）。
- **会话卡就地归档**（add-cosmos-session-archive-action）：行星/彗星信息卡的「归档会话」
  是 `POST /archive-sessions` 的**第二个 UI 消费面**（第一个是上面的扫尾技能）——
  以卡片实体组装单元素 `{ sessionIds: [<id>] }` → 逐会话 outcome → 引擎 toast：
  `archived` 已归档确认 / `already-archived` 与 `missing` **中性**说明（不呈现为失败）/
  `skipped` = 「会话仍在运行，未归档」+ activity 明细摘要（族名领域词汇 + `族 ×条目数`，
  单条目族呈现截断后的条目名）/ `failed` + 宿主错误消息。请求**不带 `stopActivity`**
  （在跑工作只跳过不杀）、点击即执行无确认模态（归档可逆）、per-session in-flight 防重入；
  整页保持打开，行星/彗星谢幕与关联边剪除全走既有管道（零新增转场代码）。

## 宿主端点

宿主半区在 `/api/dsh-v-cosmos/` 下提供（loopback，与 UI 同一 DSH Web 端口；无独立鉴权）：

| 端点 | 用途 |
|---|---|
| `GET /scene` | 星空骨架 JSON（星座 / 恒星生命周期 / 星云 / 关联边） |
| `GET /events` | SSE 轻帧广播（`proposals-changed` / `associations-changed`） |
| `GET/PUT /config` | 动作按钮共享配置（CAS 写入：200 / 409 / 400 / 503 / 500） |
| `POST /archive-sessions` | 会话扫尾：批量归档 `{sessionIds}`（去重 ≤32；依次逐个、不带 stopActivity，逐会话 outcome 恒 200） |
| `POST /rename-session` | 会话扫尾：前缀改名 `{sessionId, prefix}`（空题回退 `未命名` / 已带前缀幂等 / 超长宿主截断 / 钉住标题） |


## 开发

```bash
npm run build   # esbuild 浏览器半区 + 宿主半区源码直出（产物 lib/ 不入库）
npm run check   # node --check 全部产物
npm test        # 21 个 node 冒烟套件（扫描/关联/按钮 schema/配置存储/合并/面板投影/
                #   执行链路/设置控制器/客户端 UI/会话卡归档/引擎/渲染/工厂/零污染/
                #   交叉时序/宿主接线/会话扫尾纯逻辑/会话扫尾接线/皮肤注册表）
```

**构建产物与本地目录不入库**：`lib/`（`npm run build` 重建）、`demo/`（风格/状态基线）、
`openspec/`（决策历史）、`cosmos-spec/`（契约包）、`docs/`、`.trae/`、`.dsh-v-explorer/`
均在 `.gitignore` 中；入库内容 = `src/`、`test/`、`build.mjs`、`package.json`、
`package-lock.json`、`cordis.patch.yml`、`README.md`、`README.en.md`、`.gitignore`、
`LICENSE`。克隆后先 `npm install && npm run build`（注册流程步骤 1，见上文）；
`npm run check` 校验产物存在。基线文件（`demo/`）只在本地保留——如需重建，
从既有 tag/本地备份取回。

结构：

```
src/index.mjs            宿主半区：路由 / SSE / fs.watch（openspec/ 根）/ 启发式引擎 / 关联存储 / 动作按钮配置通道
src/scan.mjs             纯逻辑：提案扫描 / 生命周期判定 / 锚点枚举 / 骨架装配 / slug 匹配
src/associations.mjs     纯逻辑：关联归一化 / 幂等写入 / 封顶淘汰 / 启发式装配
src/sweep.mjs            纯逻辑：会话扫尾（请求归一化 / 宿主错误 → outcome 分流 / 前缀拼接）
src/buttons.mjs          纯逻辑：动作按钮归一化（autoSend/newSession/prepend/model、上限/去重）
src/configstore.mjs      共享配置存储（CAS + 备份轮转 + 原子替换 + 损坏恢复 + fs.watch 热重载）
src/client.jsx           浏览器半区：座位 / overlay 整页 / providers 控制器 / 面板 / 动作条 / hero 消费条目
src/api.mjs              浏览器半区 API 桥（fetchScene / SSE 轻帧）
src/merge.mjs            纯逻辑：骨架×镜像合并 / 四态推导 / 卫星装配 / 确定性摆放 / 补丁 diff / 工作区 path 透传
src/panel.mjs            纯逻辑：提案列表面板投影（分组/排序/星胚剔除/钻取与搜索过滤/选中语义/@目录）
src/actions.mjs          纯逻辑：消息组装 / 草稿等校验 / 一次性标记 / 执行链路 / hero 消费
src/session-archive.mjs  纯逻辑：会话卡归档（outcome 判定 / outcome → 文案映射 / activity 明细摘要）
src/model-catalog.mjs    纯逻辑：模型目录取值（等级默认最高 / 键编解码 / 漂移与降级判定）
src/settings-seam.mjs    客户端设置通道（自营 API / settingsScope / configForms / 只读降级 / 快照 store）
src/button-settings.mjs  纯逻辑：设置页「快捷动作」控制器（暂存-保存 / CRUD / 排序 / 重置）
src/settings-ui.jsx      设置页「Cosmos」节与「快捷动作」标签页（React）
src/cosmos/engine.mjs    渲染引擎（四态标签 / 卫星 body / 生命周期转场 / 容器级滚轮+捏合 / 星座标牌 / 回到银河 / zoomBy / 钻取态回调）
src/cosmos/skin-d.mjs    风格 D 皮肤（星章四态 / 行星 halo / 卫星绘制，引擎无关）
cosmos-spec/             cosmos 变体范式包（CONTRACT.md 契约 + README + skills/ 变体技能；本地保留，不入库）
demo/                    demo 基线（styles/ = 风格基线；states/ = 状态样式「星章」权威基线；本地保留，不入库）
```

> 更多文档（英文版）：[README.en.md](README.en.md)

## License

MIT
