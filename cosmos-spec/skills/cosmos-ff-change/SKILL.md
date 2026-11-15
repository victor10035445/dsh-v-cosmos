---
name: cosmos-ff-change
description: OpenSpec 快进补全工作流的 cosmos 变体：补全流程中确保 .state.json（created）就位并清理同名待创建锚点。
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: cosmos-spec
  version: "1.0"
  generatedBy: "1.1.1"
  contractVersion: "1"
---

使用 /openspec-ff-change 技能，创建相关提案的内容（proposal，design，specs，tasks），并将探索内容总结为 explorer.md 放在提案目录中。

然后按以下流程调整提案状态：
**状态步骤（补全流程中执行一次）**

1. **确保已创建就位**：若 `openspec/changes/<name>/.state.json` 缺失或非法
   （解析失败/版本≠1/枚举外），写入
   `{ "version": 1, "state": "created", "setBy": "cosmos-ff-change", "at": <epoch 毫秒> }`；
   已存在合法文件时**保持不变**（只进不退，CONTRACT §4）。
2. **清理锚点**：以该提案名删除 `openspec/pending-changes/<name>.json`（存在才删）；
   若发现其他残留锚点与本提案名不一致，在回复中提示用户手工清理
   （CONTRACT §6 孤儿锚点路径）。

**编码纪律**：UTF-8 无 BOM、合法 JSON（CONTRACT §7）。

**效果**：补全完成即视作提案正式落盘——星胚点燃（或保持既有更高状态）。

最后**自改名**：`POST <base>/api/dsh-v-cosmos/rename-session`，请求
   `{ "sessionId": $env:DSH_SESSION_ID, "prefix": "已创建-" }`。原题为空 →
   `已创建-未命名`；已带前缀 → 幂等不变（不产生双重前缀）；超长由宿主按字节预算
   保头截尾（前缀在头部天然保留）；改名**钉住**标题（自动起名不再覆盖）。
   前缀 MUST 硬编码 `已创建-`（不进配置）。
