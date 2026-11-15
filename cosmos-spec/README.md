# cosmos-spec — openspec 的 cosmos 变体范式

> cosmos-spec 是 openspec 工作流的**提示词级**扩展：为提案增加「待创建 → 已创建 →
> 已审核 → 已执行」生命周期状态，供 DSH Cosmos 星系视图渲染提案的真实位置。
> 无新增 CLI 命令、无 npm 依赖、无插件 API——全部状态由变体技能文本在流程节点
> 直写两个旁挂文件。唯一定义点 = [CONTRACT.md](CONTRACT.md)。
>
> 唯一例外：归档变体技能的**可选「会话扫尾」步骤**调用 cosmos 插件的会话归档 /
> 前缀改名端点（扫尾端点不可达时降级跳过、不阻断归档）；状态契约两个旁挂文件与
> 其余变体技能维持零插件依赖。

## 动机

Cosmos 的核心问题是「我的宇宙现在长什么样、哪里需要我」。原版天体语言只有一层
「扫描推导」的外观表达：恒星颜色来自 tasks.md 勾选进度，看不出一个提案处于
「讨论中 → 已落盘 → 已审核 → 已执行」的哪个位置；「待创建（已建议、尚未落盘）」
的提案更是完全不可见。cosmos-spec 用最小成本补齐这一信息层：

- **恒星颜色 = 生命周期**：待创建（星胚：虚线轮廓+呼吸）/ 已创建（蓝白）/
  已审核（升亮 + 金色印章环）/ 已执行（金色）；
- **执行活跃度走独立热度通道**（白热核 + 十字耀斑），颜色不再承载进度语义。

## 状态机

```
 pending-changes/<slug>.json        changes/<name>/.state.json
 ┌──────────────────────┐     ff     ┌──────────────────────────────────────────┐
 │ 待创建 (proto)        │ ─────────▶ │ 已创建 (created)                          │
 │ 虚线轮廓 + 呼吸        │  写 created │ 蓝白                                     │
 └──────────────────────┘  清理锚点   └──────────────┬───────────────────────────┘
                                                    │ review（tasks 未全勾）
                                                    ▼
                                     ┌──────────────────────────────────────────┐
                                     │ 已审核 (reviewed)  升亮 + 金色印章环        │
                                     └──────────────┬───────────────────────────┘
                                                    │ apply / review（tasks 全勾）
                                                    ▼
                                     ┌──────────────────────────────────────────┐
                                     │ 已执行 (executed)  金色                    │
                                     └──────────────────────────────────────────┘
```

回填规则：审阅/apply 写入前先读 tasks.md 勾选——全勾 → executed，否则 → reviewed；
**只进不退**，显式降级仅用户明确要求。tasks 全勾只是 executed 的**必要条件**：回填另须
通过**主会话收尾门禁**——写入时本会话派生子任务（subagent / 后台任务）均已返回终态
（完成或中断），存在未返回子任务时推迟到全部返回后、最终回复前的最后一步；apply
「进入流程」写入发生在派发之前，天然满足。回填为主会话专属动作，子会话只勾 tasks.md
并返回报告，不得写 `.state.json`。

星胚归并：锚点可选携带 `sessionId`（写入会话 id）——同一探索会话的多个锚点归并为
**一张**星胚合并卡片（卡内逐行列出推荐 slug），缺 `sessionId` 的旧锚点各自成卡。

## 目录约定

```
<workspace>/
└─ openspec/
   ├─ changes/
   │  └─ <name>/                活跃提案（openspec CLI 原生管理）
   │     ├─ .state.json         ← 契约文件一：生命周期 {version, state, setBy, at}
   │     ├─ proposal.md / design.md / tasks.md / specs/ …（CLI 原生工件，不变）
   │     └─ archive/            归档提案（无需状态——已不在活跃状态）
   └─ pending-changes/          ← 契约文件二：待创建锚点（一文件一条目）
      └─ <slug>.json            {name, by, at, sessionId?}
```

- 两个文件均为 **UTF-8 无 BOM** 的合法 JSON（见 CONTRACT §7 编码纪律）；
- 锚点在 ff 成功创建提案后由技能清理；同名目录存在时渲染端忽略锚点
  （目录优先），孤儿锚点无害（仅残留一颗星胚，提示用户手工清理）。

## 与 openspec 上游的关系

- **上游零改动**：不修改 openspec CLI、不新增 npm 依赖、不占用其命令面；
  提案目录内的 `.state.json` 与根级 `pending-changes/` 对 CLI 零感知
  （`list` / `status` / `validate` 行为不变——零侵入性质有自动化断言固化）；
- **核心工作流照旧**：scaffold / status / instructions / validate / archive 继续
  调用本机已装的 openspec CLI（技能端唯一前置）；
- cosmos 渲染端（dsh-v-cosmos 插件）对 CLI **零依赖**、对契约文件**恒只读**；
  fs.watch 覆盖 `openspec/` 根以秒级同步状态变化（点燃/落印转场跨标签页生效）。

## 迁移语义

- 状态随**提案目录**走：工作区迁移到新设备（git clone / 网盘同步）后重新扫描，
  恒星骨架连同 `.state.json` 生命周期一并重建——状态不依赖本机插件存储；
- 存量提案（无 `.state.json`）零动作，一律按「已创建」渲染；审阅/apply 技能
  首次触碰即按 tasks 回填；
- 回滚 = revert 渲染端提交；磁盘上的契约文件残留无害（旧渲染器不读、新渲染器
  按契约读）。

## 变体技能（skills/）

| 技能 | 状态动作 |
|---|---|
| `cosmos-explore` | 探索结论建议创建提案时写 `pending-changes/<slug>.json` 锚点（含写入会话 `sessionId`，同一探索会话的锚点在面板归并呈现为一张星胚卡片） |
| `cosmos-ff-change` | 创建（补全全量 artifacts）+ 创建成功写 `.state.json`（created）+ 以所建提案名清理锚点 |
| `cosmos-review` | 审阅回填（经收尾门禁）：tasks 未全勾 → reviewed；全勾 → executed |
| `cosmos-apply-change` | 进入流程时（派发前，门禁天然满足）按 tasks 回填 executed；收尾时经门禁回填（只进不退） |
| `cosmos-archive-change` | 无需状态动作（归档提案不渲染恒星）；可选「会话扫尾」——经插件端点批量归档关联会话 + 自改名 `已归档-`（端点不可达 → 跳过并注明，不阻断归档） |

技能定义标注基于的 openspec 世代（`generatedBy`）与契约版本；**映射接线**（哪个
环境加载哪些变体技能）属于部署配置，不在 cosmos-spec 内约束——按需将
`skills/*.md` 复制/链接到你的技能目录，并保证 `cosmos-spec/CONTRACT.md` 可被引用。

## 设计与决策记录

完整语境（提案扫描口径、样式选型「星章」、CLI 兼容性 spike、Q&A 决策表）见
dsh-v-cosmos 插件仓库 `openspec/changes/archive/` 下的 add-celestial-states 变更
（proposal / design / explore / walkthrough）。
