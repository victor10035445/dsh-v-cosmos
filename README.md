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
| **就地操作** | 信息卡提供打开会话、归档会话（在跑任务只跳过、不停止）、移除星胚（两击确认，仅删锚点单文件） |
| **导航** | 点击星座 / 恒星 1.3s 钻取，Esc 分层返回；搜索过滤；WASD 平移（Shift 加速）、滚轮 / 双指缩放、拖拽平移开关 |
| **外观与配置** | 12 套内置皮肤；设置页六个分页（通用 / 快捷动作 / 星座动作 / 皮肤 / 界面 / 快捷键），四组全局键可改、界面尺寸可调 |
| **分栏停靠** | 在 DSH 右栏以停靠页打开 Cosmos，与左侧会话并排；同窗口内动作全额执行（恒新建 / 关联绑定 / 模型切换 / 自动发送），web 与桌面同效 |
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
- **信息卡**：行星 / 彗星卡「打开会话 / 归档会话」；星胚卡「移除星胚」；卫星无信息卡。

## 配置

| 位置 | 内容 |
|---|---|
| 设置 → Cosmos | 打开方式、快捷动作 / 星座动作按钮、皮肤、界面尺寸与缩放、快捷键 |
| `$DSH_HOME/dsh-v-cosmos.config.json` | 动作按钮共享配置（`GET/PUT /api/dsh-v-cosmos/config`；CAS 写入 + 备份轮转 + 热重载） |
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
  声明工作面），启发式（上下文提及 slug / 目录出现 ±30min）回落；会话归档剪边，提案归档留边。

宿主端点在 `/api/dsh-v-cosmos/` 下（loopback，与 UI 同端口）：

| 端点 | 用途 |
|---|---|
| `GET /scene` | 星空骨架（星座 / 恒星生命周期 / 星云 / 关联边） |
| `GET /events` | SSE 轻帧广播（提案 / 关联变更） |
| `GET/PUT /config` | 动作按钮共享配置（CAS 写入） |
| `POST /archive-sessions` | 批量归档会话（跳过在跑任务，逐会话 outcome） |
| `POST /rename-session` | 会话前缀改名（归档扫尾） |
| `POST /bind-session` | 显式会话↔提案绑定（替换语义、幂等） |
| `POST /dismiss-embryo` | 移除星胚锚点（守卫链校验，仅用户点击驱动） |

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
