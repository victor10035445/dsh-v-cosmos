# dsh-v-cosmos · V Cosmos

**简体中文** | [English](README.en.md)

DSH Web 的工作区星系可视化插件，也是 openspec 提案的控制台。

工作区即星座，活跃提案即恒星，会话即行星 / 彗星，子代理即卫星，归档即星云。风格 D
（HUD + 程序化银河）——一个页面回答两件事：**我的宇宙现在什么样**，以及**下一步该动哪个提案**。

纯增量插件：不替换、不禁用任何官方插件；对 openspec 工件恒只读（唯一例外 = 用户显式
「移除星胚」删除单个锚点）。

## 核心特性

| 能力 | 说明 |
|---|---|
| **星系视图** | 星座 = 工作区；恒星 = 活跃提案；行星 = 提案会话；彗星 = 自由会话；卫星 = 子代理；星云 = 归档变更（密度 = 数量） |
| **双重编码** | 恒星颜色 = 提案生命周期（星胚虚线轮廓 / 已创建 / 已审核金章 / 已执行金色），热度 = 活跃会话数；行星颜色 = 会话四态（待机 / 执行中 / 待决策 / 完成未读） |
| **控制台** | 左侧提案面板 + 底部动作条：选中提案即把「提示词 + `@提案目录`」发进该工作区的新会话，支持自动发送首回合、绑定模型、逐按钮「执行后跳转」 |
| **曲率引擎** | 给提案（含星胚组）附着「曲率计划」后自动接力：前置状态一满足就替用户按下对应动作条，任务完整结束才复查下一级；跨提案并行（上限 3）、同提案串行；每动作条可直航或转入脉冲队列（转投即完成）；双页签队列面板（脉冲 / 曲率），曲率页签含置灰/待发/执行/等待决策/等待会话空闲子态 |
| **就地操作** | 信息卡提供打开会话、归档会话（在跑任务只跳过、不停止）、移除星胚（两击确认，仅删锚点单文件） |
| **导航** | 点击星座 / 恒星 1.3s 钻取，Esc 分层返回；搜索过滤；WASD 平移（Shift 加速）、滚轮 / 双指缩放、拖拽平移开关 |
| **外观与配置** | 12 套内置皮肤；设置页七个分页（通用 / 快捷动作 / 星座动作 / 皮肤 / 界面 / 快捷键 / 曲率引擎），四组全局键可改、界面尺寸可调、曲率计划可编排 |
| **分栏停靠** | 在 DSH 右栏以停靠页打开 Cosmos，与左侧会话并排；同窗口内动作全额执行（恒新建 / 关联绑定 / 模型切换 / 自动发送），web 与桌面同效 |
| **浮窗九键** | 星座动作浮窗的提示词输入区默认呈现 `V9` 按钮（V-T9 品牌缩写，依赖 `dsh-v-t9ime`）：**L 型布局**——浮窗卡片原位不动（开合零位移），备选区在卡片正下方同宽展开（恒高候选条：高度 = t9ime 条高钩子 `--t9-cand-strip-h` + parts 内边距，缺省 56px，不随候选数量变化），九键输入区在右侧形成竖列：宽高随键盘自身尺寸自适应（键帽 44–64px 放大不裁切；放得下时底边与备选区底边对齐，放不下时向下生长并整体左移，保证全部键完整可见——键盘完整优先）。按桥能力降级：t9ime 未装 → 无 V9 钮；旧版（无 `embedPanelParts`）→ 回退并排布局（≤980px 折行）；新版 → L 型双容器。窄屏口径：键盘列定宽不缩、备选区随卡片缩放，视口宽 ≤1144px 或高 ≤632px 时兜底折行（输入区移到备选下方）。草稿双向同步、发送复用浮窗 `send()`。**配色整套跟随当前 Cosmos 皮肤**：浮窗 portal 根自持皮肤作用域（27 枚 `--cos-*` + `data-cos-mode`，与整页同一令牌表），DSW 别名映射层（旧版 t9ime 同样生效）+ `--t9-*` 主题钩子精修层（新版 t9ime）双轨换装，切换即时生效、无需重开；错误/录音语义色保留官方 `state-error`，映射严格限于浮窗子树（零泄漏——DSH 页面其他区域与 DSH 内 T9 面板仍随 DSH 主题） |
| **零侵入** | 对 `openspec/` 恒只读（唯一写例外 = 用户点击的星胚移除；零写入由冒烟套件固化），不修改任何官方 DSH 包 |

## 安装

前置：本机 DSH（web profile）可运行；Node.js 与 pnpm。

```bash
# 0. 获取代码（任意目录）
git clone <repo-url> dsh-v-cosmos
cd dsh-v-cosmos

# 1. 构建（产物 lib/ 不入库）
npm install && npm run build

# 2. 注册到 web profile —— 编辑 $DSH_HOME/profiles/web/package.json：
#      dsh.profile.bundles  追加  "dsh-v-cosmos"
#      dependencies         增加  "dsh-v-cosmos": "link:<本仓绝对路径>"
pnpm install --dir "$DSH_HOME/profiles/web"

# 3. 重启宿主
dsh web
```

验证注册：`dsh --profile web --dump-config` 输出含 `- id: dsh-v-cosmos`。重启后侧栏底部出现
**Cosmos** 入口；插件升级后请重启宿主。

## 使用

- **入口与视角**：侧栏底部「Cosmos」打开整页；拖拽旋转（开启拖拽平移后为平移）、滚轮 / 双指
  缩放（指针为中心）、WASD 平移（Shift 加速）、空格打开选中会话。
- **钻取与返回**：点击星座 chip 或恒星钻取，Esc 分层（返回银河 → 退全屏 → 关页），右下
  「回到银河」等效；四组全局键（回到银河 / 移动开关 / 语音开关 / 关闭页面）均可在设置中改键。
- **提案面板**：点击提案卡 = 选中并飞行到对应恒星；点击面板外取消选中；面板内 Esc 仅失焦。
- **动作条**：未选中提案时禁用。点击按钮执行「新建会话 → 消息 = 提示词 + `@提案目录` →
  可选自动发送 → 按按钮配置跳转或留在整页」；新会话取独立草稿，不覆盖既有会话与草稿。
- **曲率**：在「曲率引擎」设置页勾选若干动作条组成计划（每条可选「曲率直航 / 转入脉冲
  队列」），选中提案或星胚组合并卡后点动作条右侧「曲率」即附着。系统按提案生命周期
  门控自动接力：匹配即点亮执行，任务完整结束才复查下一级；星胚目标先跑 proto（New，
  安静投递到探索会话），创建出的提案按 slug 快照自动展开后续动作。曲率队列与脉冲队列
  同面板双页签呈现，可单条移出、可整队暂停（暂停只挡点火、不打断在途）。
- **信息卡**：行星 / 彗星卡「打开会话 / 归档会话」；星胚卡「移除星胚」；卫星无信息卡。

## 配置

| 位置 | 内容 |
|---|---|
| 设置 → Cosmos | 打开方式、快捷动作 / 星座动作按钮、皮肤、界面尺寸与缩放、快捷键 |
| `$DSH_HOME/dsh-v-cosmos.config.json` | 动作按钮共享配置（`buttons` / `constellationButtons` / `paths` / `warpPlan` 四节；`GET/PUT /api/dsh-v-cosmos/config`；CAS 写入 + 备份轮转 + 热重载） |
| `localStorage["dsh-v-cosmos:settings"]` | 页面偏好（皮肤 / 平移速度 / 缩放聚焦 / 界面尺寸 / 键位） |

按钮配置示例：

```json
{
  "revision": 1,
  "buttons": [
    { "name": "审查", "prompt": "请使用 /cosmos-review 审查本提案", "autoSend": true, "newSession": true, "prepend": true },
    { "name": "执行", "prompt": "请使用 /cosmos-apply-change 按 tasks.md 执行本提案", "autoSend": false }
  ]
}
```

`name` / `prompt` 必填；`autoSend` 缺省 `false`；`newSession` 恒为 `true`；`prepend` = 提示词
置于 `@` 引用之前；`model` 可选（`{ provider, model, reasoningEffort? }`，发送前切换）。上限 32 条。

> 升级提示：按钮配置由宿主归一化后落盘，升级插件后请重启宿主（旧宿主会丢弃新增字段）。

## 数据与边界

- **星空骨架**：宿主扫描各工作区 `openspec/` 生成（`GET /scene`），`fs.watch` 增量重扫 + SSE
  广播，跨页签实时同步。
- **会话事实**：来自官方镜像（`ctx.sessions.list` / `ctx.workspaces.list`）与统一会话状态快照；
  四态、卫星父子链、布局均在客户端推导。
- **提案生命周期**：来自契约文件 `openspec/changes/<name>/.state.json` 与
  `openspec/pending-changes/<slug>.json`（缺失 / 非法兜底「已创建」），随提案目录跨设备迁移；
  契约定义见 [cosmos-spec/CONTRACT.md](cosmos-spec/CONTRACT.md)。
- **会话↔提案关联**：存于 `$DSH_HOME/storages/dsh-v-cosmos.json`；显式绑定优先（技能与按钮链路
  声明工作面），启发式（用户侧 `@<提案目录>` 指派引用 / 目录出现 ±30min 且会话空闲）回落；
  会话归档剪边，提案归档留边。
- **曲率队列**：存于 `$DSH_HOME/storages/dsh-v-cosmos.warp.json`（服务端权威，原子写）；
  附着快照与在途链不随计划配置漂移；提案归档 / 星胚移除 / 工作区注销触发对应清理。
  已知局限：探索会话内用户并发回合的完成归属按**会话级信号**（安静投递门只能缩小而非消除
  竞争窗口）；等待决策的重启冷读沿用脉冲队列口径（重启瞬间可能短暂显示「执行中」）——
  与「内容级完成检测不做」同为 v1 边界。

宿主端点在 `/api/dsh-v-cosmos/` 下（loopback，与 UI 同端口）：

| 端点 | 用途 |
|---|---|
| `GET /scene` | 星空骨架（星座 / 恒星生命周期 / 星云 / 关联边） |
| `GET /events` | SSE 轻帧广播（提案 / 关联变更） |
| `GET/PUT /config` | 动作按钮共享配置（CAS 写入） |
| `POST /archive-sessions` | 批量归档会话（跳过在跑任务，逐会话 outcome） |
| `POST /rename-session` | 会话前缀改名（归档扫尾） |
| `POST /bind-session` | 显式会话↔提案绑定（替换语义、幂等） |
| `POST /render-skill-text` | 技能文本路径令牌渲染服务（外部加载机制接入；零持久化） |
| `POST /dismiss-embryo` | 移除星胚锚点（守卫链校验，仅用户点击驱动） |
| `GET /warp` · `POST /warp/attach|remove|pause|resume` | 曲率队列快照与操作面（服务端权威；附着快照按当前曲率计划解析；SSE `warp-changed` 轻帧） |

### 渲染服务端点（技能文本路径令牌）

外部技能加载机制（例如按映射目录直读技能文件并注入会话的插件）可在注入前把待注入正文
**整段**提交，由本插件按 [cosmos-spec/CONTRACT.md](cosmos-spec/CONTRACT.md) §9「路径令牌」
语义完成替换后整段取回——渲染与技能 provider 单点同源（同一纯函数、同一配置读取面），
不会出现第二处实现：

`POST /api/dsh-v-cosmos/render-skill-text`（UTF-8 JSON）：

```json
// 请求
{ "text": "<待注入技能正文整段>" }
// 响应 200
{ "content": "<渲染后文本>", "rendered": true, "configured": true,
  "containsToken": true, "warning": null }
```

- `content`：整段渲染后文本（调用方直接按此注入）；
- `rendered`：本次是否发生令牌替换。未解析降级形态会前置警示行、`content` 相对原文有变，
  但替换未发生，故为 `false`——**不要用 `rendered` 判断 `content` 是否变化**；
- `configured`：解析值是否可用；`containsToken`：文本是否含令牌出现（整词判定，仅裸提及
  令牌名不构成出现）；`warning`：仅「含出现且解析值不可用」时为警示行文本（与 provider
  降级形态同源、可区分「未配置 / 读取异常」），其余为 `null`；
- 缺 `text` 或类型非法 → `400 { "error": "invalid" }`；配置每次请求实时读取（改配置即生效）。

接入方降级矩阵（端点缺席 / 不可达本身就是**协商机制**，接入方无需版本探测）：

| 情形 | 接入方行为 |
|---|---|
| `200` | 按 `content` 注入（已渲染；或未配置时的「警示行 + 原文」降级形态） |
| `404`（旧版插件）/ 连接失败 / 超时 | 按原文注入，并附加一行降级说明（如「渲染服务不可达，路径按原文保留」）；MUST NOT 阻断注入 |

零侵入：端点零配置、零持久化，不写任何文件、不触碰 `openspec/` 工件——渲染只作用于
响应文本（与 provider 注入面同等暴露面；响应不含配置值本身）。

## 开发

```bash
npm run build   # esbuild 浏览器半区 + 宿主半区直出（lib/）
npm run check   # node --check 全部产物
npm test        # 25 个 node 冒烟套件
```

```
src/index.mjs     宿主半区：路由 / SSE / fs.watch / 关联引擎 / 配置通道
src/client.jsx    浏览器半区：整页 / 面板 / 动作条 / 设置页接线
src/cosmos/       渲染引擎、风格 D 皮肤与皮肤注册表
src/*.mjs         纯逻辑：扫描 / 合并 / 面板 / 动作 / 关联 / 扫尾 / 快捷键 / 配置存储
test/             node 冒烟套件（25 个）
```

`lib/`（构建产物）、`demo/`、`openspec/`、`docs/`、`.trae/`、`.dsh-v-explorer/` 不入库；
入库内容 = `src/`、`test/`、`build.mjs`、`package.json`、`cordis.patch.yml`、`cosmos-spec/`、
README 与 LICENSE。

## License

MIT
