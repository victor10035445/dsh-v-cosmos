/**
 * 点燃谱系台账冒烟（add-cosmos-panel-birthline-sort 1.2 / spec cosmos-birthline-ledger）：
 * 八组断言——点燃配对写入、dismiss 不误记（sighting 仅 TTL 过期）、手工创建提案不写行、
 * 同 slug 重复点燃覆盖为最新谱系、停机跨帧配对（sighting 持久化语义）、TTL 过期清理、
 * 容量上限淘汰、非法行剔除；另覆盖存储文档解析/序列化（损坏兜底、跨工作区命名空间、
 * 确定性字节）与投影容错。
 * 运行：node test/birthline-smoke.mjs
 */
import assert from "node:assert/strict";
import {
  BIRTHLINE_LIMIT,
  BIRTHLINE_VERSION,
  SIGHTING_LIMIT,
  SIGHTING_TTL_MS,
  emptyBirthlineDoc,
  lineagesOf,
  normalizeLineages,
  normalizeSightings,
  observeWorkspaceBirthlines,
  parseBirthlineDoc,
  serializeBirthlineDoc
} from "../src/birthline.mjs";

const WS = "C:/proj/alpha";
const WS2 = "C:/proj/beta";
const NOW = 1_800_000_000_000;
const anchor = (name, at, sessionId = undefined) => ({ name, by: "cosmos-explore", at, sessionId });

/** 观察一步（返回新文档 + 变更标记），简化连续帧模拟。 */
function step(doc, { pending = [], active = [], now = NOW, workspacePath = WS } = {}) {
  return observeWorkspaceBirthlines(doc, { workspacePath, pending, activeSlugs: active, now });
}

/* ── 1. 点燃配对写入台账（spec「点燃配对写入台账」） ── */
{
  const frame1 = step(emptyBirthlineDoc(), { pending: [anchor("add-x", 1000, "sess-S")] });
  assert.equal(frame1.lineages.length, 0, "锚点在册帧：仅登记 sighting，不写台账行");
  assert.deepEqual(frame1.sightings, [{ slug: "add-x", at: 1000, sessionId: "sess-S", seenAt: NOW }], "sighting 登记（at / sessionId / seenAt）");
  assert.equal(frame1.changed, true, "新 sighting → 变更（宿主落盘）");
  assert.equal(frame1.lineagesChanged, false, "仅 sighting 变更 → 谱系未变（不进骨架指纹）");

  const frame2 = step(frame1.doc, { active: ["add-x"] });
  assert.deepEqual(
    frame2.lineages,
    [{ slug: "add-x", embryoAt: 1000, embryoSessionId: "sess-S", ignitedMs: NOW }],
    "点燃配对写入台账行（embryoAt = sighting.at、ignitedMs = now）"
  );
  assert.deepEqual(frame2.sightings, [], "配对后 sighting 被消费");
  assert.equal(frame2.lineagesChanged, true, "台账写入 → 谱系变更（骨架指纹变化 → 广播）");
  assert.deepEqual(lineagesOf(frame2.doc, WS), frame2.lineages, "骨架投影回查命中");
  assert.deepEqual(lineagesOf(frame2.doc, WS2), [], "其他工作区 lineages 为空清单（同 slug 不串扰）");

  /* 幂等：同输入重复观察 → 无变更（零落盘抖动） */
  const again = step(frame2.doc, { active: ["add-x"] });
  assert.equal(again.changed, false, "重复观察同态 → 零变更");
  assert.deepEqual(again.lineages, frame2.lineages, "台账行原样（ignitedMs 不被刷新）");
}

/* ── 2. dismiss 不误记（spec「dismiss 不产生台账行」） ── */
{
  const registered = step(emptyBirthlineDoc(), { pending: [anchor("add-dismiss", 2000, "sess-D")] });
  /* dismiss：锚点消失、无同名提案出现——之后任意帧都不产台账行。 */
  const afterDismiss = step(registered.doc, { pending: [], active: [] });
  assert.deepEqual(afterDismiss.lineages, [], "锚点消失且无提案 → 台账无行（dismiss 不误记）");
  assert.equal(afterDismiss.sightings.length, 1, "sighting 保留（仅靠 TTL 过期，不立即删）");
  const afterProposallessFrames = step(afterDismiss.doc, { pending: [], active: ["other-proposal"] });
  assert.deepEqual(afterProposallessFrames.lineages, [], "其他提案点燃不借用该 sighting（slug 精确匹配）");
}

/* ── 3. 手工创建提案不写行（spec「手工创建提案不写行」） ── */
{
  const manual = step(emptyBirthlineDoc(), { active: ["add-manual"] });
  assert.deepEqual(manual.lineages, [], "无锚点史（opsx:new 手工创建）→ 不写台账行（面板走 birthMs 兜底）");
  assert.equal(manual.changed, false, "无 sighting 也无台账变化 → 零变更、零落盘");
}

/* ── 4. 同 slug 重复点燃覆盖为最新谱系（spec「同 slug 重复点燃覆盖」） ── */
{
  const first = step(emptyBirthlineDoc(), { pending: [anchor("add-x", 1000, "sess-S")] });
  const lit = step(first.doc, { active: ["add-x"], now: NOW + 10 });
  assert.equal(lit.lineages[0].embryoAt, 1000);
  /* 归档重建：同名锚点再次孕育（新 at / 新会话），再次点燃 → 行覆盖（不保留历史版本）。 */
  const again = step(lit.doc, { pending: [anchor("add-x", 3000, "sess-T")], now: NOW + 100 });
  assert.equal(again.lineages[0].embryoAt, 1000, "重新登记 sighting 不改既有台账行");
  const relit = step(again.doc, { active: ["add-x"], now: NOW + 200 });
  assert.deepEqual(
    relit.lineages,
    [{ slug: "add-x", embryoAt: 3000, embryoSessionId: "sess-T", ignitedMs: NOW + 200 }],
    "同 slug 再次点燃 → 台账行覆盖为最新谱系（embryoAt / sessionId / ignitedMs 全新）"
  );
}

/* ── 5. 停机跨帧配对（sighting 持久化语义：序列化 → 重启回读 → 仍可配对） ── */
{
  const registered = step(emptyBirthlineDoc(), { pending: [anchor("add-persist", 4000, "sess-P")] });
  const text = serializeBirthlineDoc(registered.doc, NOW);
  assert.equal(text.includes("add-persist"), true, "sighting 落盘文本含条目");
  const reloaded = parseBirthlineDoc(text, NOW + 60_000); // 重启（未过 TTL）
  const paired = step(reloaded, { active: ["add-persist"], now: NOW + 61_000 });
  assert.deepEqual(
    paired.lineages,
    [{ slug: "add-persist", embryoAt: 4000, embryoSessionId: "sess-P", ignitedMs: NOW + 61_000 }],
    "重启后（sighting 持久化生效）→ 点燃配对照常命中"
  );
}

/* ── 6. TTL 过期清理（spec「TTL 过期清理」） ── */
{
  const registered = step(emptyBirthlineDoc(), { pending: [anchor("add-stale", 5000)] });
  const sightingSeenAt = registered.sightings[0].seenAt;
  const afterTtl = step(registered.doc, { now: sightingSeenAt + SIGHTING_TTL_MS + 1 });
  assert.deepEqual(afterTtl.sightings, [], "登记后超 7 天无同名提案 → sighting 过期清理");
  assert.deepEqual(afterTtl.lineages, [], "过期清理不产生台账行");
  assert.equal(afterTtl.changed, true, "清理属变更（陈旧残影不落盘）");
  /* 边界：恰在 TTL 内仍存活；过 1ms 即过期。 */
  const inside = step(registered.doc, { now: sightingSeenAt + SIGHTING_TTL_MS });
  assert.equal(inside.sightings.length, 1, "恰在 TTL 边界 → 仍存活（> TTL 才过期）");
  const outside = step(registered.doc, { now: sightingSeenAt + SIGHTING_TTL_MS + 1 });
  assert.equal(outside.sightings.length, 0, "超 TTL 1ms → 过期");
  /* 过期后重新观测在册锚点 → 重新登记（自愈）。 */
  const reRegistered = step(afterTtl.doc, { pending: [anchor("add-stale", 5000)], now: NOW + SIGHTING_TTL_MS + 10 });
  assert.equal(reRegistered.sightings.length, 1, "过期后仍在册的锚点 → 重新登记（自愈）");
}

/* ── 7. 容量上限淘汰（spec「容量上限淘汰」） ── */
{
  assert.equal(BIRTHLINE_LIMIT, 512);
  assert.equal(SIGHTING_LIMIT, 512);
  /* 台账行：600 行输入 → 保留 ignitedMs 最新 512（最旧淘汰），同刻 slug 兜底确定性。 */
  const rows = [];
  for (let i = 0; i < 600; i += 1) rows.push({ slug: "add-" + String(i).padStart(3, "0"), embryoAt: 1000 + i, ignitedMs: 10_000 + i });
  const capped = normalizeLineages(rows);
  assert.equal(capped.length, 512, "台账行超上限 → 淘汰至 512");
  assert.equal(capped[0].slug, "add-088", "最旧 88 条被淘汰（600 - 512）");
  assert.equal(capped.at(-1).slug, "add-599", "最新行保留");
  /* sighting：600 条 → 保留 seenAt 最新 512。 */
  const sightings = [];
  for (let i = 0; i < 600; i += 1) sightings.push({ slug: "s-" + String(i).padStart(3, "0"), at: 1000, seenAt: NOW - 10_000 + i });
  const cappedSightings = normalizeSightings(sightings, NOW);
  assert.equal(cappedSightings.length, 512, "sighting 超上限 → 淘汰至 512");
  assert.equal(cappedSightings[0].slug, "s-088", "最旧 sighting 被淘汰");
  /* 观察面淘汰同口径且不抛错。 */
  const big = step(emptyBirthlineDoc(), { pending: Array.from({ length: 600 }, (_, i) => anchor("p-" + String(i).padStart(3, "0"), 1000 + i)) });
  assert.equal(big.sightings.length, 512, "登记面超上限 → 淘汰（SHALL NOT 抛错）");
}

/* ── 8. 非法行剔除（spec「非法行剔除」） ── */
{
  const mixed = normalizeLineages([
    { slug: "ok", embryoAt: 1000, embryoSessionId: "s", ignitedMs: 2000 },
    { slug: "", embryoAt: 1000, ignitedMs: 2000 }, // slug 空
    { slug: "no-at", embryoAt: 0, ignitedMs: 2000 }, // embryoAt 非正
    { slug: "neg-at", embryoAt: -5, ignitedMs: 2000 },
    { slug: "no-ignite", embryoAt: 1000, ignitedMs: 0 }, // ignitedMs 非正
    { slug: "nan-at", embryoAt: "x", ignitedMs: 2000 },
    null,
    "text",
    [1, 2]
  ]);
  assert.deepEqual(mixed, [{ slug: "ok", embryoAt: 1000, embryoSessionId: "s", ignitedMs: 2000 }], "非法行剔除、合法行原样");
  const noSession = normalizeLineages([{ slug: "solo", embryoAt: 10, ignitedMs: 20 }]);
  assert.equal(noSession[0].embryoSessionId, null, "缺失 sessionId → null（solo 台账行）");
  const sightings = normalizeSightings([
    { slug: "ok", at: 1, seenAt: NOW },
    { slug: "", at: 1, seenAt: NOW },
    { slug: "bad-at", at: 0, seenAt: NOW },
    { slug: "bad-seen", at: 1, seenAt: 0 }
  ], NOW);
  assert.deepEqual(sightings, [{ slug: "ok", at: 1, sessionId: null, seenAt: NOW }], "sighting 非法行剔除");
  /* 文档损坏 / 超版本 / 非对象 → 空台账兜底（不抛错）。 */
  for (const text of [null, "", "{", "[]", JSON.stringify({ version: 2, workspaces: {} }), JSON.stringify({ version: 1, workspaces: [] })]) {
    assert.deepEqual(parseBirthlineDoc(text, NOW), { version: BIRTHLINE_VERSION, workspaces: {} }, "损坏/超版本 → 空台账兜底: " + JSON.stringify(text));
  }
  assert.deepEqual(lineagesOf(null, WS), [], "台账缺席 → 空谱系（面板回落 birthMs）");
  assert.deepEqual(lineagesOf({ version: 1, workspaces: {} }, ""), [], "空工作区路径 → 空谱系");
}

/* ── 9. 存储文档：跨工作区命名空间 + 序列化确定性 + 空节不保留 ── */
{
  const a = step(emptyBirthlineDoc(), { pending: [anchor("same", 1000, "sess-A")] });
  const b = step(a.doc, { workspacePath: WS2, pending: [anchor("same", 2000, "sess-B")] });
  const la = step(b.doc, { active: ["same"], now: NOW + 1 });
  const lb = step(la.doc, { workspacePath: WS2, active: ["same"], now: NOW + 2 });
  assert.deepEqual(lineagesOf(lb.doc, WS), [{ slug: "same", embryoAt: 1000, embryoSessionId: "sess-A", ignitedMs: NOW + 1 }], "工作区 A 谱系独立");
  assert.deepEqual(lineagesOf(lb.doc, WS2), [{ slug: "same", embryoAt: 2000, embryoSessionId: "sess-B", ignitedMs: NOW + 2 }], "同名 slug 跨工作区不串扰（路径命名空间）");
  const text1 = serializeBirthlineDoc(lb.doc, NOW);
  const text2 = serializeBirthlineDoc(parseBirthlineDoc(text1, NOW), NOW);
  assert.equal(text1, text2, "序列化 → 解析 → 序列化 逐字节恒等（确定性，跨重启零抖动）");
  assert.equal(text1.includes("\uFEFF"), false, "写出文本无 BOM（编码纪律由宿主写出面保证）");
  const json = JSON.parse(text1);
  assert.equal(json.version, 1);
  assert.deepEqual(Object.keys(json.workspaces), [WS, WS2], "工作区键按路径码点序");
  /* 空节不保留：仅有 sighting 的工作区在 TTL 过期后整节移除（存储零噪声）。 */
  const staleDoc = step(emptyBirthlineDoc(), { workspacePath: WS2, pending: [anchor("stale", 10)], now: NOW });
  assert.ok(staleDoc.doc.workspaces[WS2], "仅有 sighting 的工作区节在册");
  const cleaned = step(staleDoc.doc, { workspacePath: WS2, now: NOW + SIGHTING_TTL_MS + 1 });
  assert.equal(cleaned.doc.workspaces[WS2], undefined, "空节（无行无 sighting）不保留 → 存储零噪声");
  /* 非对象文档 / 空路径 → 不写、返回原文档（防御）。 */
  const untouched = observeWorkspaceBirthlines(emptyBirthlineDoc(), { workspacePath: "", pending: [anchor("x", 1)], activeSlugs: ["x"], now: NOW });
  assert.equal(untouched.changed, false, "空工作区路径 → 不写台账");
  assert.equal(Object.keys(untouched.doc.workspaces).length, 0);
}

console.log("birthline-smoke: all assertions passed");
