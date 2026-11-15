# CONTRACT: cosmos-spec 提案生命周期契约 v1

> 本文件是**技能写入方**与 **cosmos 渲染读取方**的共同契约唯一定义点。
> 渲染端（dsh-v-cosmos 插件）对本契约文件**恒只读**；任何工具 MUST NOT 以推导方式写入。
>
> - 契约版本：`1`
> - 基于的 openspec 技能世代：`generatedBy: "1.1.1"`（@fission-ai/openspec）
> - 渲染端兼容：dsh-v-cosmos（add-celestial-states 起）

## 1. 前置声明与降级路径

- **技能端前置**：目标设备已安装本机 openspec CLI（核心工作流 scaffold/status/
  instructions/validate/archive 继续调用 CLI）。CLI 对本契约的旁挂文件**零感知**
  （已实验验证：`list` / `status` / `validate` 行为与文件不存在时一致）。
- **渲染端零依赖**：cosmos 渲染端对 openspec CLI 零依赖、对契约文件恒只读；
  文件缺失/非法一律按 §5 兜底规则降级渲染，SHALL NOT 报错。
- 映射接线（哪个环境加载哪些变体技能）属于部署配置，不在 cosmos-spec 内约束
  （见 README「映射解耦」）。

## 2. 文件一：提案状态 `.state.json`

路径：`openspec/changes/<name>/.state.json`（提案目录内旁挂文件）。

```json
{ "version": 1, "state": "created", "setBy": "cosmos-ff-change", "at": 1731000000000 }
```

| 字段 | 类型 | 约束 |
|---|---|---|
| `version` | 整数 | MUST 为 `1`；其他值按非法处理 |
| `state` | 字符串枚举 | MUST 为 `"created" \| "reviewed" \| "executed"` 之一 |
| `setBy` | 字符串 | 写入者标识（技能名，如 `cosmos-ff-change` / `cosmos-review` / `cosmos-apply-change`） |
| `at` | 数字 | 写入时刻 epoch 毫秒 |

## 3. 文件二：待创建锚点 `pending-changes/`

路径：`openspec/pending-changes/<slug>.json`（工作区 openspec 根级目录；
**一文件一条目**，文件名 = 提案 slug + `.json`）。

```json
{ "name": "add-user-auth", "by": "cosmos-explore", "at": 1731000000000, "sessionId": "<DSH_SESSION_ID>" }
```

| 字段 | 类型 | 约束 |
|---|---|---|
| `name` | 字符串 | MUST 与文件名（去 `.json`）一致；即最终提案 slug |
| `by` | 字符串 | 建议写入者（explore 技能名） |
| `at` | 数字 | 建议时刻 epoch 毫秒 |
| `sessionId` | 字符串（**可选**） | 写入该锚点的**会话 id**（`$env:DSH_SESSION_ID`）：与锚点写入同为会话动作，供渲染端把同一探索会话的多个锚点归并为一张星胚卡片。缺失 / 空值 / 非字符串 → 读取方按「无关联」处理（各自成卡），SHALL NOT 抛错 |

写入纪律：explore 技能写锚点时 SHOULD 携带 `sessionId`（主会话执行，环境变量可得；
子会话写锚点非既有流程，不另行支持）；读取方（骨架扫描）容错优先，旧锚点零迁移。

并发语义：一文件一条目 → 多个 explore 建议并发写入互不冲突；同 slug 覆盖写
语义相同（内容一致），无害。`sessionId` 为**schema 加法扩展**（`gate-state-backfill`
先例）：契约版本保持 `1`，状态枚举与既有字段语义不变，旧写入方 / 旧渲染端互不阻断
（缺字段即无关联，读取方兼容写方两种形态）。

## 4. 状态机与回填规则

```
待创建(proto) ──ff──▶ 已创建(created) ──review──▶ 已审核(reviewed) ──apply──▶ 已执行(executed)
   ▲ pending-changes/        .state.json state=created      state=reviewed          state=executed
```

- **单向推进，只进不退**：MUST NOT 将较高状态覆盖为较低状态（写入前先读当前
  state，目标低于当前时保持不变）；**显式降级**仅在用户明确要求时执行。
- **回填规则**（审阅 / apply 技能写入前 MUST 先执行）：读取该提案 `tasks.md` 的
  勾选状态——
  - 全部勾选 → 满足写入 `executed` 的**必要条件**（还须通过下方「主会话收尾门禁」）；
  - 存在未勾选 → 审阅写入 `reviewed`；apply 进入流程时不回写 reviewed
    （apply 的目标态恒为 executed，待全勾后达成）。
- **主会话收尾门禁**：回填写入 MUST 满足「写入时本会话派生的子任务（subagent
  子会话 / 后台任务）均已返回终态（完成或中断/失败）」；存在未返回子任务时
  MUST 推迟写入，至全部返回后、主会话最终回复前的最后一步执行。tasks.md 全部
  勾选是写入 `executed` 的必要条件而非充分条件——**全勾 ∧ 无未返回子任务 ∧
  主会话收尾**三者同时成立才可写入。
  - apply「进入流程」写入发生在派生子任务之前（写入时点无未返回子任务），
    天然满足门禁，保持现行时机；
  - 单会话串行流程（无派生子任务）门禁恒真，行为不变；多提案并行属不同会话
    各写各的 `.state.json`，不受门禁影响。
- **写入者收敛**：状态回填（`reviewed` / `executed` 的写入）是分发任务的主会话
  专属动作；子会话 MUST NOT 执行状态回填（子会话的完成信号 = 勾选 tasks.md 与
  返回报告）。`created` 写入属创建技能（ff）自身流程，不在本条约束内。
- 状态 MUST 由变体技能在流程节点**显式写入**（`setBy` 记录技能名）；任何工具
  MUST NOT 依据 tasks.md 推导改写 `.state.json`（tasks 回填只发生在审阅/apply
  技能的显式写入动作内）。

## 5. 读取方兜底（渲染端行为，写入方无需关心）

| 磁盘事实 | 渲染结果 |
|---|---|
| `.state.json` 缺失 / 非法 JSON / 非对象 / `version≠1` / `state` 枚举外 | 按**已创建**渲染，SHALL NOT 抛错 |
| `pending-changes/<slug>.json` 非法 | 该锚点跳过 |
| 锚点 slug 同名真实提案目录已存在 | 锚点忽略（**目录优先**） |
| 两者皆无 | 提案按已创建渲染；无星胚 |

状态写入不规范（缺字段/乱序）的后果 = 渲染退化为默认态，**可自愈**（技能下次
触碰按回填规则写回），不影响其他提案。

## 6. 锚点清理路径（ff 技能职责）

1. ff 技能成功创建 `openspec/changes/<最终名>/` 后：
   - 写入 `.state.json`（state=created，setBy=本技能名）；
   - **以所建提案名**删除 `pending-changes/<最终名>.json`（存在才删）。
2. 若最终目录名与某个残留锚点 slug **不一致**（探索建议的 slug 与实际创建名分叉）：
   - 技能 SHALL 在回复中明确提示用户手工清理旧锚点
     （`删除 openspec/pending-changes/<旧slug>.json`）；
   - 未清理的孤儿锚点会持续渲染为星胚（无害但视觉残留），由渲染端目录优先规则
     保证不与真实提案冲突。

## 7. 编码纪律

- 两个契约文件 MUST 为 **UTF-8 无 BOM** 且 JSON 语法有效；
- 写入工具禁止使用会带 BOM 的写出方式（Windows PowerShell 5.1
  `Set-Content -Encoding UTF8` 会写 BOM——用 .NET
  `[IO.File]::WriteAllText($p, $text, (New-Object Text.UTF8Encoding $false))`
  或编辑器工具写 UTF-8 无 BOM）；
- 解析失败由读取方按 §5 兜底（不抛错），但写入方 SHALL 遵守纪律避免退化渲染。

## 8. 零侵入保证

上述文件的 existence 与内容 MUST NOT 改变 openspec CLI 的任何行为
（`openspec list` / `openspec status` / `openspec validate` 输出与文件不存在时
一致）。该性质由 dsh-v-cosmos 的自动化断言固化（test/zero-pollution-smoke.mjs）。

## 9. 变更记录

| 版本 | 变更 |
|---|---|
| 1 | 初版（add-celestial-states）：两文件 schema + 回填规则 + 兜底 + 清理路径 |
| 1 | 2026-11-11（gate-state-backfill-on-subagent-settle）：§4 回填规则增加主会话收尾门禁（派生子任务全部返回终态后才可回填；tasks 全勾降为 executed 的必要条件）与写入者收敛（子会话 MUST NOT 回填）；schema / 状态枚举 / 渲染端行为不变，契约版本仍为 `1` |
| 1 | 2026-11-15（add-cosmos-embryo-cards）：§3 锚点 schema 增**可选** `sessionId`（写入会话 id，供渲染端与同一探索会话的锚点归并为一组星胚卡片）+ 写入纪律 + 读取方容错；加法扩展、旧锚点零迁移，契约版本仍为 `1` |
