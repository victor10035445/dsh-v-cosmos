---
name: cosmos-archive-change
description: OpenSpec 归档工作流的 cosmos 变体：无需任何状态动作（归档提案退出活跃清单，恒星并入星云）。
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: cosmos-spec
  version: "1.1"
  generatedBy: "1.1.1"
  contractVersion: "1"
---

汇总提案最终主要交付内容，在提案目录创建archive.md文档，并使用 C:\project\dsh-plugin-v\dsh-v-skill-links\.trae\skills\openspec-archive-change\SKILL.md 技能，同步spec（包括delta 如有需要）归档这个提案。

然后按以下流程调整提案状态：
**状态步骤：无需动作**

- 归档提案移入 `openspec/changes/archive/` 后即退出活跃清单——Cosmos 中对应恒星
  消失（播放消亡流星）、星云计数 +1；归档提案**不需要状态文件**；
- `.state.json` 随提案目录一起移入 archive（保留原状态，供历史追溯）；
- 渲染端扫描口径排除 `archive/` 与 `.` 开头隐藏目录，归档目录内的 `.state.json`
  不会被读取为活跃恒星。

**可选手滑（不建议默认做）**：归档前若发现 `openspec/pending-changes/` 有该提案
的残留锚点（正常情况下 ff 已清理），可顺手删除。

## 会话扫尾（提案归档完成后执行；可选，依赖 cosmos 插件）

让参与本提案的队友会话随提案一起谢幕，并给自己留下可检索的标记。次序**固定**：
**解析队友 → 依次批量归档 → 自改名 → 收尾报告**。

基址 = 当前 DSH Web 地址（loopback，如 `http://127.0.0.1:3080`；端口以实际部署为准）。
以下以 PowerShell 为例（任何 HTTP 客户端等价；请求体须为 UTF-8 字节）。

1. **解析队友**：`GET <base>/api/dsh-v-cosmos/scene` → 在 `scene.workspaces` 中取
   `path` 等于当前工作区的星座（路径比较前统一正斜杠），再取其 `associations` 中
   `proposal == <本次归档的提案名>` 的 `sessionId`（提案归档保留关联边，故归档后
   仍可解析）。去重后：
   - **剔除自己**：`$env:DSH_SESSION_ID`（自身 MUST NOT 进入批量归档、MUST NOT 被归档）；
   - 剔除已归档 id（可选；端点自身会预过滤复验，重复无害）。
2. **依次批量归档**：单次 `POST <base>/api/dsh-v-cosmos/archive-sessions`，
   请求 `{ "sessionIds": [...] }`。端点内部按数组序**依次**逐个归档，**不携带
   stopActivity**——turn / 子代理链 / 后台 job / 活跃提醒（schedule）在跑的会话
   只被跳过、**绝不会被停止**。零队友（空数组）合法 = no-op。
3. **自改名**：`POST <base>/api/dsh-v-cosmos/rename-session`，请求
   `{ "sessionId": $env:DSH_SESSION_ID, "prefix": "已归档-" }`。原题为空 →
   `已归档-未命名`；已带前缀 → 幂等不变（不产生双重前缀）；超长由宿主按字节预算
   保头截尾（前缀在头部天然保留）；改名**钉住**标题（自动起名不再覆盖）。
   前缀 MUST 硬编码 `已归档-`（不进配置）。
4. **收尾报告**（MUST）：逐会话列出 outcome——`archived` / `skipped`（附 activity
   族与条目 id/名称）/ `already-archived` / `missing` / `failed`（附原因）——并给出
   自身最终标题（改名失败则注明原因）。

```powershell
$base = "http://127.0.0.1:3080"
$scene = Invoke-RestMethod -Uri "$base/api/dsh-v-cosmos/scene"
$body  = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json @{ sessionIds = $ids } -Compress))
Invoke-RestMethod -Method Post -Uri "$base/api/dsh-v-cosmos/archive-sessions" `
  -ContentType "application/json; charset=utf-8" -Body $body
$body  = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json @{ sessionId = $env:DSH_SESSION_ID; prefix = "已归档-" } -Compress))
Invoke-RestMethod -Method Post -Uri "$base/api/dsh-v-cosmos/rename-session" `
  -ContentType "application/json; charset=utf-8" -Body $body
```

**降级（MUST NOT 阻断归档）**：`/scene` 或两个扫尾端点不可达（404 / 连接拒绝 /
超时）= 插件未安装或未升级 → 跳过对应扫尾步骤并在回复中**注明**；提案归档本身
照常完成，MUST NOT 报错或回滚。改名失败（404 session/unknown / 503
rename-unavailable / 500）同样只在收尾报告中注明，会话保持存活、扫尾照常收尾。

**零侵入**：扫尾只驱动宿主会话归档与改名，MUST NOT 写任何 openspec 目录内容。

契约唯一定义点 = `cosmos-spec/CONTRACT.md`。
