/**
 * 星座模板数据集冒烟（src/cosmos/templates.mjs，one-add-cosmos-constellation-templates 4.1–4.4）。
 *
 * 锁 spec「cosmos-constellation-templates」的全部 Scenario：
 *  - 4.1 计数与唯一性：TEMPLATE_COUNT = 88、id 两两不同且 === abbr 小写、码点序快照、
 *        与 IAU 88 全量锚单完全一致（通稿复核 3.5 的机器化断言：批间无重复无遗漏）；
 *  - 4.2 结构合法性：逐条字段域校验（ra/dec/x/y 域、area>0、stars 3–20、bayer 无重复、
 *        lines ≥1 且索引合法不自环、desc ≤60 字）；
 *  - 4.3 ser 特例：part 全覆盖 caput/cauda、无跨区连线；其余 87 条无 part 字段；
 *  - 4.4 查询面：templateOf 命中 / 未命中 null / 非字符串入参；快照修改不污染模块态；
 *        同参重放一致；头注释呈现性口径声明可考。
 *
 * 运行: node test/constellation-templates-smoke.mjs
 */
import { readFileSync } from "node:fs";
import { TEMPLATE_COUNT, allTemplates, templateOf } from "../src/cosmos/templates.mjs";

function assert(cond, msg) {
  if (!cond) {
    console.error("constellation-templates-smoke FAIL:", msg);
    process.exit(1);
  }
}
function assertEq(a, b, msg) {
  assert(a === b, `${msg}（got ${JSON.stringify(a)}, want ${JSON.stringify(b)}）`);
}

const templates = allTemplates();

/* ---------- 4.1 计数与唯一性 ---------- */

assertEq(TEMPLATE_COUNT, 88, "TEMPLATE_COUNT = 88");
assertEq(templates.length, 88, "allTemplates().length = 88");
const ids = templates.map((t) => t.id);
assertEq(new Set(ids).size, 88, "id 两两不同");
for (const t of templates) assertEq(t.id, t.abbr.toLowerCase(), `id === abbr 小写：${t.id}`);
for (let i = 1; i < ids.length; i += 1) {
  assert(ids[i - 1] < ids[i], `码点序快照：${ids[i - 1]} < ${ids[i]}`);
}

/* IAU 88 全量锚单（通稿复核 3.5：批间无重复无遗漏的机器化验证） */
const IAU88 = "and ant aps aqr aql ara ari aur boo cae cam cnc cvn cma cmi cap car cas cen cep cet cha cir col com cra crb crv crt cru cyg del dor dra equ eri for gem gru her hor hya hyi ind lac leo lmi lep lib lup lyn lyr men mic mon mus nor oct oph ori pav peg per phe pic psc psa pup pyx ret sge sgr sco scl sct ser sex tau tel tri tra tuc uma umi vel vir vul vol".split(" ");
assertEq(IAU88.length, 88, "IAU 锚单自身 88");
assertEq(new Set(IAU88).size, 88, "IAU 锚单无重复");
assertEq(
  ids.slice().sort().join(","),
  [...IAU88].sort().join(","),
  "数据集与 IAU 88 全量锚单完全一致（无重复无遗漏）"
);

/* ---------- 4.2 结构合法性（逐条字段域）---------- */

/* 实源无 α 的五座（Argo 拆分旧序 / 拉卡耶新立 / 拜耳自 β 起录），见模块头注释 bayer 例外段 */
const NO_ALPHA = new Set(["vel", "nor", "oct", "pup", "dra"]);

for (const t of templates) {
  assert(typeof t.area === "number" && t.area > 0, `area>0：${t.id}`);
  assert(Number.isFinite(t.ra) && t.ra >= 0 && t.ra <= 24, `ra ∈ [0,24]：${t.id}`);
  assert(Number.isFinite(t.dec) && t.dec >= -90 && t.dec <= 90, `dec ∈ [-90,90]：${t.id}`);
  assert(typeof t.zh === "string" && t.zh.length > 0, `zh 非空：${t.id}`);
  assert(typeof t.name === "string" && t.name.length > 0, `name 非空：${t.id}`);
  assert(typeof t.genitive === "string" && t.genitive.length > 0, `genitive 非空：${t.id}`);
  assert(
    typeof t.desc === "string" && t.desc.length > 0 && t.desc.length <= 60,
    `desc ≤60 字：${t.id}（${t.desc.length} 字）`
  );
  assert(
    Array.isArray(t.stars) && t.stars.length >= 3 && t.stars.length <= 20,
    `stars 3–20：${t.id}（${t.stars?.length}）`
  );
  const bayers = new Set();
  let hasAlpha = false;
  for (const s of t.stars) {
    assert(typeof s.bayer === "string" && s.bayer.length > 0, `bayer 非空：${t.id}`);
    assert(!bayers.has(s.bayer), `bayer 无重复：${t.id} ${s.bayer}`);
    bayers.add(s.bayer);
    if (s.bayer === "α") hasAlpha = true;
    assert(typeof s.n === "string" && s.n.length > 0, `星名 n 非空：${t.id} ${s.bayer}`);
    assert(Number.isFinite(s.x) && s.x >= 0 && s.x <= 1, `x ∈ [0,1]：${t.id} ${s.bayer}`);
    assert(Number.isFinite(s.y) && s.y >= 0 && s.y <= 1, `y ∈ [0,1]：${t.id} ${s.bayer}`);
  }
  assert(hasAlpha || NO_ALPHA.has(t.id), `α 星入选：${t.id}`);

  assert(Array.isArray(t.lines) && t.lines.length >= 1, `lines ≥1：${t.id}`);
  for (const [a, b] of t.lines) {
    assert(Number.isInteger(a) && a >= 0 && a < t.stars.length, `lines 索引合法：${t.id} [${a}]`);
    assert(Number.isInteger(b) && b >= 0 && b < t.stars.length, `lines 索引合法：${t.id} [${b}]`);
    assert(a !== b, `连线不自环：${t.id} [${a},${b}]`);
  }
}

/* ---------- 4.3 ser 双区特例 ---------- */

const ser = templateOf("ser");
assert(ser !== null, "ser 存在");
assert(
  ser.stars.every((s) => s.part === "caput" || s.part === "cauda"),
  "ser 每颗主星带合法 part 标记"
);
const parts = new Set(ser.stars.map((s) => s.part));
assert(parts.has("caput") && parts.has("cauda"), "ser part 全覆盖 caput/cauda");
for (const [a, b] of ser.lines) {
  assertEq(ser.stars[a].part, ser.stars[b].part, `ser 无跨区连线 [${a},${b}]`);
}
for (const t of templates) {
  if (t.id === "ser") continue;
  for (const s of t.stars) assert(!("part" in s), `非 ser 条目无 part 字段：${t.id}`);
}

/* ---------- 4.4 查询面 ---------- */

assertEq(templateOf("ori")?.zh, "猎户座", "精确命中返回猎户座");
assertEq(templateOf("ori")?.stars.length, 8, "命中条目字段与数据集一致");
assertEq(templateOf("xxx"), null, "未命中返回 null");
assertEq(templateOf(""), null, "空串未命中返回 null");
assertEq(templateOf(null), null, "null 入参返回 null 不抛错");
assertEq(templateOf(undefined), null, "undefined 入参返回 null 不抛错");
assertEq(templateOf(88), null, "数字入参返回 null 不抛错");
assertEq(templateOf(["ori"]), null, "数组入参返回 null 不抛错");
assertEq(templateOf("ORI"), null, "大写不匹配（精确匹配语义）");
assert(templateOf("ori") === templateOf("ori"), "同参重放返回同一冻结条目");

/* 快照修改不污染模块态（冻结语义：严格模式下抛 TypeError，此处捕获后复核未变） */
let arrayWriteThrew = false;
try {
  templates[0] = null;
} catch {
  arrayWriteThrew = true;
}
assertEq(templates.length, 88, "快照数组修改后长度不变");
assert(templates[0] !== null, "快照首条目未被改写");
assertEq(allTemplates().length, 88, "allTemplates() 复调不受污染");
let nestedWriteThrew = false;
try {
  templates[0].stars[0].x = 42;
} catch {
  nestedWriteThrew = true;
}
assert(templates[0].stars[0].x !== 42, "嵌套 star 修改不污染模块态");
assert(arrayWriteThrew && nestedWriteThrew, "冻结语义阻断严格模式下的写操作（抛 TypeError）");

/* 确定性重放：同参同果、逐位一致 */
assertEq(JSON.stringify(allTemplates()), JSON.stringify(templates), "allTemplates 重放逐位一致");

/* ---------- 呈现性口径声明（spec Scenario：头注释与 desc 可考）---------- */

const src = readFileSync(new URL("../src/cosmos/templates.mjs", import.meta.url), "utf8");
for (const marker of [
  "y 轴向上",
  "希腊古典星座",
  "NAOJ",
  "呈现性约定",
  "MUST NOT 声称天文边界精度",
  "弗拉斯蒂德",
  "caput",
  "cauda"
]) {
  assert(src.includes(marker), `头注释口径声明缺失：${marker}`);
}
/* 「天文精确边界」类声明 MUST NOT 出现 */
assert(!/天文精确|精确边界/.test(src), "未出现天文精确边界类声明");

console.log("constellation-templates-smoke PASS: 88 条模板 / 字段域 / ser 双区 / 查询面 全部通过");
