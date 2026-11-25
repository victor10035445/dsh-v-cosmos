# CONTRACT: cosmos-spec 提案生命周期契约 v1

> 本文件是**技能写入方**与 **cosmos 渲染读取方**的共同契约唯一定义点。
> 渲染端（dsh-v-cosmos 插件）对本契约文件**恒只读**；任何工具 MUST NOT 以推导方式写入。
> **唯一例外 = 显式动词清理**：用户在 Cosmos 星胚信息卡经内联两击确认「移除星胚」时，
> 渲染端可硬删除单个 `pending-changes/<slug>.json` 锚点（§6 清理路径（三））——这是
> 用户点击驱动的显式动词，与「推导写入」性质不同；除该路径外，渲染端仍恒只读。
> **路径令牌渲染**（§9）作用于技能文本加载层（加载时的内存内文本变换），不构成对
> 本契约文件或 openspec 工件的任何写入——渲染端「恒只读」红线与 §8 零侵入保证不变。
>
> - 契约版本：`1`
> - 基于的 openspec 技能世代：`generatedBy: "1.1.1"`（@fission-ai/openspec）
> - 渲染端兼容：dsh-v-cosmos（add-celestial-states 起）

## 1. 前置声明与降级路径

- **技能端前置**：目标设备已安装本机 openspec CLI（核心工作流 scaffold/status/
  instructions/validate/archive 继续调用 CLI）。CLI 对本契约的旁挂文件**零感知**
  （已实验验证：`list` / `status` / `validate` 行为与文件不存在时一致）。
- **渲染端零依赖**：cosmos 渲染端对 openspec CLI 零依赖、对契约文件恒只读（唯例外 =
  §6 清理路径（三）的用户显式动词）；
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
| `requires` | 数组（**可选**） | 前置依赖声明 `[{ slug, state }]`：`slug` 为同工作区内前置提案 slug（非空字符串），`state` 为目标状态枚举 `"created" \| "reviewed" \| "executed"`（`"proto"` MUST NOT 作为依赖目标——依赖未点燃提案无守卫意义）。形状、枚举与容错归一化的**唯一定义点** = `cosmos-proposal-dependency`「依赖声明 schema 与容错归一化」；缺省不落键（存储最小形），非法（非数组 / 任一非法条目 / 同 slug 重复）→ 读取方按**无声明**处理，SHALL NOT 抛错；旧锚点零迁移 |

写入纪律：explore 技能写锚点时 SHOULD 携带 `sessionId`（主会话执行，环境变量可得；
子会话写锚点非既有流程，不另行支持）；读取方（骨架扫描）容错优先，旧锚点零迁移。

`requires` 写入纪律：explore 技能建议**链式多提案**（后序提案依赖前序先执行）时
SHOULD 为后序提案锚点显式声明前置依赖（缺省交由 `cosmos-proposal-dependency` 的
谱系块前缀链推导兜底——命名未规范时推导静默失效，显式声明不失效）；写入方 MUST NOT
落盘非法 `requires`（写出前自查）；锚点内容为持久工件，MUST NOT 携带 `OPENSPEC_PATH`
令牌（§9，只写解析后的真实路径或相对路径）。锚点在点燃时由渲染端捕获为点燃谱系台账行
的 `requires` 快照（供提案长生命周期消费——锚点在 ff 清理步骤即被删除，台账是唯一持久
载体），承接语义见 `cosmos-birthline-ledger`「点燃谱系台账捕获与持久化」。

并发语义：一文件一条目 → 多个 explore 建议并发写入互不冲突；同 slug 覆盖写
语义相同（内容一致），无害。`sessionId` / `requires` 均为**schema 加法扩展**
（`gate-state-backfill` 先例）：契约版本保持 `1`，状态枚举与既有字段语义不变，
旧写入方 / 旧渲染端互不阻断（缺字段即无关联 / 无声明，读取方兼容写方两种形态）。

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

## 6. 锚点清理路径

三条清理路径，删除对象**恒为** `pending-changes/<slug>.json` 单文件。

### 6.1 路径（一）：ff 技能创建提案时自动清理

1. ff 技能成功创建 `openspec/changes/<最终名>/` 后：
   - 写入 `.state.json`（state=created，setBy=本技能名）；
   - **以所建提案名**删除 `pending-changes/<最终名>.json`（存在才删）。
2. 若最终目录名与某个残留锚点 slug **不一致**（探索建议的 slug 与实际创建名分叉）：
   - 技能 SHALL 在回复中明确提示用户清理旧锚点
     （`删除 openspec/pending-changes/<旧slug>.json`，或经 Cosmos 星胚信息卡的
     「移除星胚」两击确认移除——见 §6.3）；
   - 未清理的孤儿锚点会持续渲染为星胚（无害但视觉残留），由渲染端目录优先规则
     保证不与真实提案冲突。

### 6.2 路径（二）：孤儿锚点（用户手工清理）

`pending-changes/` 中与任何真实提案目录都不对应的残留条目（含 §6.1 第 2 条的分叉
场景、历史遗留、手工试写的锚点），由用户自行清理——删除该 JSON 文件，或在 Cosmos
星胚信息卡经两击确认「移除星胚」（§6.3）移除。清理是**用户判断**：「这条建议不用做」
不产生任何提案工件，故无需写入 `.state.json`。

### 6.3 路径（三）：用户显式移除（dsh-v-cosmos 一等清理方）

dsh-v-cosmos 是锚点的**一等清理方**（与 ff 技能的锚点删除同级，均为显式动词，不是
本契约红线所指的「推导写入」）：用户在 Cosmos 星胚（proto 恒星）信息卡点击
「移除星胚」并经内联两击确认后，宿主经 `POST /api/dsh-v-cosmos/dismiss-embryo`
硬删除该锚点。该路径 MUST 满足三条约束：

1. **仅用户显式点击驱动**：任何工具与自动化流程 MUST NOT 以推导方式触发锚点删除
   （如按时间 / 数量 / 状态推导清理）；入口的唯一驱动者是用户的两击确认。
2. **仅删锚点单文件**：只删除 `pending-changes/<slug>.json`；MUST NOT 触碰
   `.state.json` 与 `changes/<name>/` 的任何内容，也不修改锚点内容。
3. **目录守卫先行**：目标 slug 已存在同名真实提案目录 `changes/<slug>/` 时 MUST
   拒绝执行（锚点与提案目录均保持原样，锚点按目录优先规则本就被忽略）。

slug 校验 MUST 为白名单 `^[A-Za-z0-9][A-Za-z0-9._-]*$` 且不含 `..` 子串（路径穿越
输入恒不可达文件系统）；锚点缺失按幂等处理（不报错）。移除是**硬删除**，反悔路径 =
重建同名锚点（重跑 explore 或手写 JSON），渲染端按首次出现重新渲染。除本节路径外，
渲染端对契约文件仍恒只读。

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

## 9. 路径令牌（OPENSPEC_PATH）

cosmos-spec 变体技能文本 MAY 以**路径令牌**引用跨设备可变的技能资源目录（如 openspec
技能仓库根 `dsh-v-skill-links`，各设备克隆路径不同——硬编码本机绝对路径换设备即断链）。
本章为令牌语义的**唯一定义点**：契约只定义令牌**语义**，MUST NOT 钉死渲染**实现**——
渲染由承担技能文本加载的机制负责（现实载体 = cosmos 插件的 SkillProvider；接线期渲染
脚本、手工展开等任何承担加载的机制均合法）。渲染实现侧（配置面 / provider / 兜底 /
技能文本令牌化）以独立提案落地，MUST 遵循本章语义，MUST NOT 出现第二处令牌语法定义。

- **令牌语法**：裸前缀形态 `OPENSPEC_PATH/…`；MUST NOT 引入 `${…}` 等模板语法。
  令牌 MUST 大小写敏感。
- **令牌出现判定**：`OPENSPEC_PATH` 后必须紧跟 `/` 或 `\`，且前一字符不得为标识符
  字符（字母/数字/下划线）或路径分隔符——不后随分隔符的裸令牌（如行内单独提及
  令牌名）不构成出现，原样保留，也不触发未配置降级警示。
- **替换规则**：渲染层 SHALL 在技能文本**注入会话前**，把出现在**路径开头**的令牌
  整词前缀替换为该设备配置的绝对路径（模型看到的正文已是可读真实路径）：
  - 仅路径开头整词匹配：路径中部的同名子串（如 `docs/OPENSPEC_PATH-notes.md`）
    MUST NOT 替换；不构成出现的裸令牌 MUST NOT 替换；
  - **原样拼接**：解析值 = 配置值与其后片段原样拼接；拼接前去除配置值尾部连续
    分隔符，拼接边界折叠为恰好一个分隔符，MUST NOT 产生 `//` 残留（`C:/x/` +
    `/y` 解析为 `C:/x/y` 等价形态）；
  - 拼接后**不做**大小写折叠等规范化，保证确定性可审计。
- **持久工件禁令**：令牌 MUST NOT 进入持久工件——proposal / design / tasks / specs /
  explorer 等落盘文档 MUST 只写解析后的真实路径或相对路径（落盘文档会被后续会话
  原样读取，彼时无渲染层）。漏网令牌由渲染实现侧的读取兜底给出纠正反馈（独立提案）。
- **未配置降级**：目标路径未配置（渲染层无解析值）且技能文本含令牌时，渲染层 MUST
  降级为：正文原样注入 + 明显的未解析警示行；MUST NOT 静默替换为猜测路径，MUST NOT
  抛错阻断技能加载（与 cosmos-spec 既有「降级注明、不阻断」纪律同构）。
- **零侵入确认**：令牌是纯文本层概念，其引入与渲染 MUST NOT 改变 openspec CLI 的
  任何行为（§8 性质不变），MUST NOT 新增变体技能的网络端点调用（渲染发生在加载
  机制内，非技能发起的调用）。渲染层对契约文件与 openspec 工件仍**恒只读**，MUST
  NOT 将渲染结果回写技能文本或任何契约文件（开篇红线不变）。

## 10. 变更记录

| 版本 | 变更 |
|---|---|
| 1 | 初版（add-celestial-states）：两文件 schema + 回填规则 + 兜底 + 清理路径 |
| 1 | 2026-11-11（gate-state-backfill-on-subagent-settle）：§4 回填规则增加主会话收尾门禁（派生子任务全部返回终态后才可回填；tasks 全勾降为 executed 的必要条件）与写入者收敛（子会话 MUST NOT 回填）；schema / 状态枚举 / 渲染端行为不变，契约版本仍为 `1` |
| 1 | 2026-11-15（add-cosmos-embryo-cards）：§3 锚点 schema 增**可选** `sessionId`（写入会话 id，供渲染端与同一探索会话的锚点归并为一组星胚卡片）+ 写入纪律 + 读取方容错；加法扩展、旧锚点零迁移，契约版本仍为 `1` |
| 1 | 2026-11-16（add-cosmos-embryo-dismiss）：§6 拆为三条清理路径，增「路径（三）：用户显式移除」——dsh-v-cosmos 升为一等清理方（仅用户两击确认驱动 / 仅删锚点单文件 / 同名提案目录守卫先行），开篇红线补「显式动词例外」；锚点 schema / 状态枚举 / 渲染端其余行为不变，契约版本仍为 `1` |
| 1 | 2026-11-18（step1-cosmos-path-token-contract）：新增 §9「路径令牌」——裸前缀令牌 `OPENSPEC_PATH` 的语法 / 令牌出现判定 / 替换规则（大小写敏感、路径开头整词匹配、原样拼接、拼接前去配置值尾部分隔符 + 边界折叠为单一分隔符且无 `//` 残留、无规范化折叠）、持久工件禁令、未配置降级与零侵入确认；契约只定语义不定实现（渲染归承担技能文本加载的机制，现实载体 = cosmos 插件 SkillProvider，独立提案落地），开篇红线补「令牌渲染不触碰契约文件」澄清；schema / 状态枚举 / 渲染端其余行为不变，契约版本仍为 `1` |
| 1 | 2026-11-25（first-add-proposal-dependency-declaration）：§3 锚点 schema 增**可选** `requires`（`[{ slug, state }]` 前置依赖声明，形状/枚举/容错唯一定义点 = `cosmos-proposal-dependency`；缺省不落键、非法按无声明、旧锚点零迁移）+ 写入纪律（链式提案显式声明、MUST NOT 落盘非法值、落盘不带令牌）；新增依赖解析面与点燃谱系台账 `requires` 快照承接（`cosmos-birthline-ledger`）；锚点其余字段 / 状态枚举 / 渲染端行为不变，契约版本仍为 `1` |
