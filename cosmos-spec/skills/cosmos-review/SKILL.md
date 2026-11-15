---
name: cosmos-review
description: OpenSpec 审阅工作流的 cosmos 变体：审阅后按 tasks.md 勾选状态回填 reviewed/executed（只进不退）。
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: cosmos-spec
  version: "1.0"
  generatedBy: "1.1.1"
  contractVersion: "1"
---

审阅这个提案的详细设计方案，并根据建议修订提案。

然后按以下流程调整提案状态：
**状态步骤：审阅回填（CONTRACT §4 回填规则）**

1. 读取该提案 `openspec/changes/<name>/tasks.md` 的 checkbox 勾选状态；
2. 按勾选决定目标态：**全部勾选 → `executed`；存在未勾选 → `reviewed`**；
3. **收尾门禁**：回填写入 MUST 满足「写入时本会话派生的子任务（subagent 子会话 /
   后台任务）均已返回终态（完成或中断）」；存在未返回子任务时 MUST 推迟写入，至
   全部返回后、主会话最终回复前的最后一步执行。tasks 全部勾选是写入 `executed`
   的必要条件而非充分条件；
4. 写入（或保持）`openspec/changes/<name>/.state.json`：
   `{ "version": 1, "state": "<目标态>", "setBy": "cosmos-review", "at": <epoch 毫秒> }`；
5. **只进不退**：写入前先读当前 `state`——目标态不高于当前态时文件保持不变
   （如已为 `executed` 则不动）；显式降级仅在用户明确要求时执行；
6. 缺失/非法的现有文件按「当前为 created」对待（写入目标态）；
7. **写入者收敛**：状态回填（reviewed / executed）是分发任务的主会话专属动作，
   子会话 MUST NOT 执行本步骤（其完成信号 = 勾选 tasks.md 与返回报告）。

**编码纪律**：UTF-8 无 BOM、合法 JSON（CONTRACT §7）。

**效果**：审阅通过即「落印」——恒星升亮并加盖金色印章环（reviewed），或转纯金色
（executed）。

最后**自改名**：`POST <base>/api/dsh-v-cosmos/rename-session`，请求
   `{ "sessionId": $env:DSH_SESSION_ID, "prefix": "已审阅-<name>" }`。原题为空 →
   `已审阅-未命名`；已带前缀 → 幂等不变（不产生双重前缀）；超长由宿主按字节预算
   保头截尾（前缀在头部天然保留）；改名**钉住**标题（自动起名不再覆盖）。
   前缀 MUST 硬编码 `已审阅-`（不进配置）。