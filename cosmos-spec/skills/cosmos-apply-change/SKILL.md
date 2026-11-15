---
name: cosmos-apply-change
description: OpenSpec 实施工作流的 cosmos 变体：进入流程与收尾时按 tasks.md 回填 executed（只进不退），驱动恒星转金。
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: cosmos-spec
  version: "1.0"
  generatedBy: "1.1.1"
  contractVersion: "1"
---

使用 /openspec-apply-change 技能，执行这个提案。

然后按以下流程调整提案状态：
**状态步骤：apply 回填（CONTRACT §4 回填规则）**

1. 读取该提案 `openspec/changes/<name>/tasks.md` 勾选状态；
2. **进入流程时**：tasks 全部勾选且当前 `state` 低于 `executed` → 写入
   `executed`；当前已为 `executed` → 文件保持不变；存在未勾选 → 不回写
   （apply 的目标态恒为 executed，待任务全勾后达成）。此写入发生在派生子任务
   之前（写入时点无派生任务），天然满足下方收尾门禁，时机不变；
3. **收尾时**（门禁式触发）：仅当**写入时本会话派生的子任务均已返回终态
   （完成或中断）**方可回填；存在未返回子任务时 MUST NOT 写入，推迟到全部
   子任务返回后、最终回复前的最后一步执行。回填条件同第 2 条（tasks 全勾 →
   `executed`；未全勾 → 不回写）；
4. 写入形状：`{ "version": 1, "state": "executed", "setBy": "cosmos-apply-change", "at": <epoch 毫秒> }`；
5. **只进不退**：MUST NOT 将较高状态覆盖为较低状态；显式降级仅用户明确要求；
6. **写入者收敛**：状态回填是分发任务的主会话专属动作，子会话 MUST NOT 执行
   本步骤（子会话的完成信号 = 勾选 tasks.md 与返回报告）。

**编码纪律**：UTF-8 无 BOM、合法 JSON（CONTRACT §7）。

**效果**：任务全部完成时恒星转为纯金色「已执行」（无独立转场，属性换色、金章环
随态消失）。

最后**自改名**：`POST <base>/api/dsh-v-cosmos/rename-session`，请求
   `{ "sessionId": $env:DSH_SESSION_ID, "prefix": "已执行-<name>" }`。原题为空 →
   `已执行-未命名`；已带前缀 → 幂等不变（不产生双重前缀）；超长由宿主按字节预算
   保头截尾（前缀在头部天然保留）；改名**钉住**标题（自动起名不再覆盖）。
   前缀 MUST 硬编码 `已执行-`（不进配置）。