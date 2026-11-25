---
name: cosmos-explore
description: OpenSpec 探索工作流的 cosmos 变体：探索产出提案建议时，写入 cosmos-spec 待创建锚点（pending-changes/），让 Cosmos 星空提前点亮星胚。
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: cosmos-spec
  version: "1.0"
  generatedBy: "1.1.1"
  contractVersion: "1"
---

读取（read 工具） OPENSPEC_PATH/openspec-explore/SKILL.md，探索并讨论功能需求，如果建议多提案的时候，多个提案如有先后依赖顺序（注意不要以数字开头），则在提案命名前缀上体现出来（两族序数词前缀并存：`one-/two-/…` 与 `first-/second-/…`，供无显式声明时的前缀链推导兜底），**并在后序提案的锚点上写 `requires` 显式声明**（显式声明优先于推导，命名不规范时推导静默失效而声明不失效）。

并且按以下流程调整提案状态：
**状态步骤：探索结论建议创建提案时，写待创建锚点**

当探索的回复建议创建某个提案（给出 kebab-case slug）时，在该工作区写入锚点文件：

- 路径：`openspec/pending-changes/<slug>.json`
- 内容：`{ "name": "<slug>", "by": "cosmos-explore", "at": <epoch 毫秒>, "sessionId": $env:DSH_SESSION_ID }`
  （`sessionId` 取当前写入会话 id——与锚点写入同为会话动作，供 Cosmos 把同一探索
  会话的多个锚点归并为一张星胚卡片；环境变量缺失时省略该字段，读取方按无关联处理）
- 可选依赖声明 `requires`（CONTRACT §3；形状/容错唯一定义点 = cosmos-spec capability
  `cosmos-proposal-dependency`）：建议**链式多提案**（后序提案依赖前序先执行）时，为后序
  提案锚点追加
  `"requires": [{ "slug": "<前置提案 slug>", "state": "executed" }]`
  （`slug` = 前置提案的同工作区 kebab-case slug；`state` 取
  `"created" | "reviewed" | "executed"`，执行序依赖建议用 `"executed"`）。无依赖意图的
  提案 MUST NOT 落该键（存储最小形——缺省由解析面的谱系块前缀链推导兜底）；MUST NOT
  落盘非法形状（非数组 / 条目非法 / 同 slug 重复；写入方写出前自查，读取方对非法值按
  无声明容错）；锚点是持久工件，MUST NOT 携带 `OPENSPEC_PATH` 令牌（CONTRACT §9，
  只写解析后的真实路径或相对路径）。
- 纪律（CONTRACT §3/§7）：
  - `name` MUST 与文件名（去 `.json`）一致；
  - 文件为 UTF-8 无 BOM 的合法 JSON；
  - 一文件一条目——多个建议各写各的文件，并发安全；
  - 目录 `openspec/pending-changes/` 不存在时创建；
  - 同 slug 已有锚点时覆盖写入（内容一致语义，无害）；
  - `sessionId` SHOULD 为当前主会话 id（`$env:DSH_SESSION_ID`），MUST NOT 手填
    其他会话 id（子会话场景不另行支持）。

**效果**：Cosmos 星空随即在该星座点亮一颗「星胚」（虚线轮廓 + 呼吸，确定性预占位）；
真实提案目录由后续 ff 技能创建后原位「点燃」。

**红线**（CONTRACT §4/§8）：只写锚点文件，不改 openspec CLI 任何工件；不做其他
推导写入。

## 关联绑定（写完本轮锚点之后执行；可选，依赖 cosmos 插件）

声明本会话的提案工作面（星图关联，不写任何 openspec 工件）：

- 端点：`POST <base>/api/dsh-v-cosmos/bind-session`
  （base = 当前 DSH Web loopback 地址，如 `http://127.0.0.1:3080`；端口以实际部署为准）；
- 请求：`{ "sessionId": $env:DSH_SESSION_ID, "proposals": ["<slug>", ...] }`
  （请求体须为 UTF-8 字节）——清单 = **本轮建议的全部 slug**（多轮探索时重绑
  累计全量清单）；
- 语义：**替换**（该会话的关联恰为本清单，重复绑定同清单幂等）——探索会话一稿
  多案时行星恰绕建议集做联星轨道。

```powershell
$body = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json @{ sessionId = $env:DSH_SESSION_ID; proposals = @("<slug>") } -Compress))
Invoke-RestMethod -Method Post -Uri "$base/api/dsh-v-cosmos/bind-session" `
  -ContentType "application/json; charset=utf-8" -Body $body
```

**降级（MUST NOT 阻断状态步骤）**：端点不可达（404 / 连接拒绝 / 超时）或返回失败 =
插件未安装或未升级 → 跳过绑定并在回复中**注明**（关联退回启发式推断，星图可能过度
关联；不影响锚点写入），MUST NOT 报错或回滚。

**自改名**：`POST <base>/api/dsh-v-cosmos/rename-session`，请求
   `{ "sessionId": $env:DSH_SESSION_ID, "prefix": "创意-" }`。原题为空 →
   `创意-未命名`；已带前缀 → 幂等不变（不产生双重前缀）；超长由宿主按字节预算
   保头截尾（前缀在头部天然保留）；改名**钉住**标题（自动起名不再覆盖）。
   前缀 MUST 硬编码 `创意-`（不进配置）。