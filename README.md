# dsh-v-cosmos — V Cosmos

**DSH Web 的工作区星系可视化插件**：工作区 = 星座，活跃提案 = 恒星（颜色 = 提案生命周期，
热度 = 活跃会话数），openspec 会话 = 行星（四态会话状态），自由会话 = 彗星，
子代理会话 = 卫星（绕父天体），归档变更 = 星云（密度 = 数量）。
风格 D（HUD + 过程化银河）——回答一个问题：**我的宇宙现在长什么样、哪里需要我**。

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

星座计数仪表分级呈现：**银河视图 chip 只显示星座名**；进入星座（钻取态）后页面左上
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
- HUD：**无面包屑、无右上操作提示**——钻取态左上为星座标牌（星座名 + 计数仪表），
  返回路径由 Esc（桌面）与右下按钮（触屏）承担；空态「暂无在册工作区」提示保留；
- hover 天体 → HUD 信息卡；行星/彗星卡「打开会话」→ 关整页并切换右侧系统会话页；
- 拖拽旋转 / 滚轮缩放 / **双指捏合缩放**（值域与滚轮一致，覆盖星座卡片、信息卡等
  任意覆盖元素上均生效——无缩放死区）/ **WASD 平移相机**（固定速度，不随缩放变化；
  Shift 加速档；输入框聚焦与 Ctrl/Alt/Meta 组合键不劫持）；多指手势期间与结束后
  350ms 内的点击被抑制（防捏合误触 dive）；
- 左下「＋」方形按钮（44×44，触屏目标 ≥40px）→ 新增工作区；
- 整页关闭或页签切后台自动暂停渲染循环。

## 配置

页面设置持久化在 `localStorage["dsh-v-cosmos:settings"]`（净房界内置，越界落端点；旧名 `dsh-cosmos:settings` 存量自动回落读取）：

| 键 | 缺省 | 界 | 含义 |
|---|---|---|---|
| `panSpeed` | `120` | `[20, 600]` | WASD 基础平移速度（世界单位/秒，固定值不随缩放变化） |
| `panShiftBoost` | `3` | `[1, 10]` | Shift 加速倍率 |

调整方式（设置 UI 后续变更提供；当前可经控制台）：

```js
// DevTools 控制台（改完刷新页面生效）：
const s = JSON.parse(localStorage.getItem("dsh-v-cosmos:settings") ?? "{}");
s.panSpeed = 200; // ±panShiftBoost 同理
localStorage.setItem("dsh-v-cosmos:settings", JSON.stringify(s));
```

出厂默认值定义于 `src/settings.mjs`（`COSMOS_SETTINGS_DEFAULTS`）——只调默认改这一处。

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
  MUST NOT 写任何 openspec 工件；不修改任何 DSH 官方包。

## 开发

```bash
npm run build   # esbuild 浏览器半区 + 宿主半区源码直出（产物 lib/ 不入库）
npm run check   # node --check 全部产物
npm test        # 9 个 node 冒烟套件（扫描/关联/合并/引擎/渲染/工厂/零污染/交叉时序/宿主接线）
```

**构建产物不入库**：`lib/`（`npm run build` 重建）、`demo/`（风格/状态基线）、
`openspec/`（决策历史）、`cosmos-spec/`、`.trae/`、`.dsh-v-explorer/` 均在 `.gitignore`
中；入库内容 = `src/`、`test/`、`build.mjs`、`package.json`、`package-lock.json`、
`cordis.patch.yml`、`README.md`、`.gitignore`、`LICENSE`。克隆后先 `npm install &&
npm run build`（注册流程步骤 1，见上文）；`npm run check` 校验产物存在。
基线文件（`demo/`）只在本地保留——如需重建，从既有 tag/本地备份取回。

结构：

```
src/index.mjs            宿主半区：路由 / SSE / fs.watch（openspec/ 根）/ 启发式引擎 / 关联存储
src/scan.mjs             纯逻辑：提案扫描 / 生命周期判定 / 锚点枚举 / 骨架装配 / slug 匹配
src/associations.mjs     纯逻辑：关联归一化 / 幂等写入 / 封顶淘汰 / 启发式装配
src/client.jsx           浏览器半区：座位 / overlay 整页 / providers 控制器 / sessionStatus 订阅
src/api.mjs              浏览器半区 API 桥（fetchScene / SSE 轻帧）
src/merge.mjs            纯逻辑：骨架×镜像合并 / 四态推导 / 卫星装配 / 确定性摆放 / 补丁 diff
src/cosmos/engine.mjs    渲染引擎（四态标签 / 卫星 body / 生命周期转场 / 容器级滚轮+捏合 / 星座标牌 / 回到银河）
src/cosmos/skin-d.mjs    风格 D 皮肤（星章四态 / 行星 halo / 卫星绘制，引擎无关）
cosmos-spec/             cosmos 变体范式包（CONTRACT.md 契约 + README + skills/ 变体技能）
demo/                    demo 基线（styles/ = 风格基线；states/ = 状态样式「星章」权威基线）
```

## License

MIT
