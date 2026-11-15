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

使用 /openspec-explore 技能，探索并讨论功能需求

并且按以下流程调整提案状态：
**状态步骤：探索结论建议创建提案时，写待创建锚点**

当探索的回复建议创建某个提案（给出 kebab-case slug）时，在该工作区写入锚点文件：

- 路径：`openspec/pending-changes/<slug>.json`
- 内容：`{ "name": "<slug>", "by": "cosmos-explore", "at": <epoch 毫秒>, "sessionId": $env:DSH_SESSION_ID }`
  （`sessionId` 取当前写入会话 id——与锚点写入同为会话动作，供 Cosmos 把同一探索
  会话的多个锚点归并为一张星胚卡片；环境变量缺失时省略该字段，读取方按无关联处理）
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

**自改名**：`POST <base>/api/dsh-v-cosmos/rename-session`，请求
   `{ "sessionId": $env:DSH_SESSION_ID, "prefix": "创意-" }`。原题为空 →
   `创意-未命名`；已带前缀 → 幂等不变（不产生双重前缀）；超长由宿主按字节预算
   保头截尾（前缀在头部天然保留）；改名**钉住**标题（自动起名不再覆盖）。
   前缀 MUST 硬编码 `创意-`（不进配置）。