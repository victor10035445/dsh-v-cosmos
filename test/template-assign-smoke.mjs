/**
 * per-星座模板指定覆盖冒烟（src/template-assign.mjs，add-cosmos-template-reassign 4.1）。
 *
 * 锁 spec「cosmos-template-assign」的持久化/净化/重掷/跨窗投影口径：
 *  - 净化矩阵：合法条目保留、未知 id / 空串 / 非字符串 / 空键剔除、非对象 → 空表、
 *    危险键（`__proto__` / `constructor` / `prototype`）剔除且不污染原型；
 *  - load / save 往返：部分写合并、`null` 删除、坏载荷回落、写失败不抛错；
 *  - `randomTemplateIdOf`：域 ∈ 88 id 全集、恒不等于排除项、覆盖率（88 − 1 池）；
 *  - storage 事件投影：键匹配 + 净房、clear / 坏 JSON → 空表、无关键 → null；
 *  - 选择器数据面：全量 / 中文名 / 拉丁名 / 大小写不敏感 / 多 token AND / 空态。
 *
 * 运行：node test/template-assign-smoke.mjs
 */
import { TEMPLATE_COUNT, allTemplates } from "../src/cosmos/templates.mjs";
import {
  TEMPLATE_OVERRIDES_KEY,
  loadTemplateOverrides,
  randomTemplateIdOf,
  sanitizeTemplateOverrides,
  saveTemplateOverrides,
  templateOverridesFromStorageEvent,
  templatePickerRowsOf
} from "../src/template-assign.mjs";

function assert(cond, msg) {
  if (!cond) {
    console.error("template-assign-smoke FAIL:", msg);
    process.exit(1);
  }
}
function assertEq(a, b, msg) {
  assert(a === b, `${msg}（got ${JSON.stringify(a)}, want ${JSON.stringify(b)}）`);
}
function assertDeep(a, b, msg) {
  const left = JSON.stringify(a);
  const right = JSON.stringify(b);
  assert(left === right, `${msg}（got ${left}, want ${right}）`);
}

/** localStorage 最小桩（Node 无该全局；模块内 `localStorage?.` 守卫读取本桩）。 */
class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    this.map.set(String(key), String(value));
  }
  removeItem(key) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
  key(index) {
    return [...this.map.keys()][index] ?? null;
  }
  get length() {
    return this.map.size;
  }
}

const storage = new MemoryStorage();
globalThis.localStorage = storage;

const ids = new Set(allTemplates().map((template) => template.id));

/* ---------- 1. 键与常量 ---------- */

assertEq(TEMPLATE_OVERRIDES_KEY, "dsh-v-cosmos:tplOverrides", "覆盖表键 = dsh-v-cosmos:tplOverrides（独立于设置面）");
assertEq(TEMPLATE_COUNT, 88, "数据集 88 条（净化值域前提）");

/* ---------- 2. 净化矩阵 ---------- */

assertDeep(sanitizeTemplateOverrides(null), {}, "null → 空表");
assertDeep(sanitizeTemplateOverrides(undefined), {}, "undefined → 空表");
assertDeep(sanitizeTemplateOverrides([]), {}, "数组 → 空表");
assertDeep(sanitizeTemplateOverrides("[1,2]"), {}, "字符串（非法 JSON 形态）→ 空表");
assertDeep(sanitizeTemplateOverrides(42), {}, "数字 → 空表");
assertDeep(sanitizeTemplateOverrides({}), {}, "空对象 → 空表");

const legal = sanitizeTemplateOverrides({ "ws-a": "ori", "ws-b": "uma" });
assertDeep(legal, { "ws-a": "ori", "ws-b": "uma" }, "合法条目全保留");
assertEq(legal["ws-a"], "ori", "合法值透传");

const mixed = sanitizeTemplateOverrides({
  "ws-a": "ori",
  "ws-b": "not-a-template",
  "ws-c": "",
  "ws-d": 42,
  "ws-e": null,
  "ws-f": ["ori"],
  "": "ori"
});
assertDeep(mixed, { "ws-a": "ori" }, "未知 id / 空串 / 非字符串 / 空键逐条剔除");

/* 危险键：JSON.parse 得到**自有** __proto__ 属性（对象字面量的 __proto__ 会改原型，不传本断言） */
const pollutedRaw = JSON.parse('{"ws-a":"ori","__proto__":"ori","constructor":"ori","prototype":"ori"}');
const polluted = sanitizeTemplateOverrides(pollutedRaw);
assertDeep(polluted, { "ws-a": "ori" }, "危险键条目被剔除（只留合法 ws-a）");
assertEq(Object.prototype.hasOwnProperty.call(polluted, "__proto__"), false, "净化结果无自有 __proto__");
assertEq(Object.prototype.hasOwnProperty.call(polluted, "constructor"), false, "净化结果无自有 constructor");
assertEq(Object.prototype.hasOwnProperty.call(polluted, "prototype"), false, "净化结果无自有 prototype");
assertEq(Object.getPrototypeOf(polluted), Object.prototype, "净化结果为普通纯净对象（原型未被改写）");
assertEq({}.ori, undefined, "Object.prototype 未被写入污染值");
assertEq(typeof {}.constructor, "function", "Object.prototype.constructor 未被删除/改写");
assert(polluted !== pollutedRaw, "净化结果恒为新对象（不复用输入引用）");

/* 输入引用隔离：净化后改写输入不影响结果 */
const mutableRaw = { "ws-a": "ori" };
const isolated = sanitizeTemplateOverrides(mutableRaw);
mutableRaw["ws-a"] = "uma";
assertEq(isolated["ws-a"], "ori", "净化结果与输入引用隔离");

/* ---------- 3. load / save 往返 ---------- */

storage.clear();
assertDeep(loadTemplateOverrides(), {}, "无存储 → 空表");

const savedA = saveTemplateOverrides({ "ws-a": "ori" });
assertDeep(savedA, { "ws-a": "ori" }, "save 返回净房结果");
assertDeep(loadTemplateOverrides(), { "ws-a": "ori" }, "落盘可读回");
assertDeep(JSON.parse(storage.getItem(TEMPLATE_OVERRIDES_KEY)), { "ws-a": "ori" }, "localStorage 载荷为净房 JSON");

const savedB = saveTemplateOverrides({ "ws-b": "uma" });
assertDeep(savedB, { "ws-a": "ori", "ws-b": "uma" }, "部分写合并既有条目");
const savedReset = saveTemplateOverrides({ "ws-a": null });
assertDeep(savedReset, { "ws-b": "uma" }, "null = 删除该星座覆盖（恢复默认）");
assertDeep(loadTemplateOverrides(), { "ws-b": "uma" }, "删除条目落盘可读回");

const savedInvalid = saveTemplateOverrides({ "ws-b": "not-a-template" });
assertDeep(savedInvalid, {}, "非法值经净房剔除（等价恢复默认），不抛错");
assertDeep(saveTemplateOverrides(JSON.parse('{"__proto__":"ori"}')), {}, "patch 危险键剔除（不落盘）");
assertDeep(saveTemplateOverrides(null), {}, "null patch = 不改动（返回当前净房值）");
assertDeep(saveTemplateOverrides([]), {}, "数组 patch = 不改动");

/* 坏载荷：数组 / 非法 JSON → 空表（SHALL NOT 抛错） */
storage.setItem(TEMPLATE_OVERRIDES_KEY, "[]");
assertDeep(loadTemplateOverrides(), {}, "持久载荷为数组 → 空表");
storage.setItem(TEMPLATE_OVERRIDES_KEY, "{not json");
assertDeep(loadTemplateOverrides(), {}, "非法 JSON → 空表");
storage.setItem(TEMPLATE_OVERRIDES_KEY, JSON.stringify({ "ws-a": "ori", "ws-b": "nope", "ws-c": 7 }));
assertDeep(loadTemplateOverrides(), { "ws-a": "ori" }, "持久载荷读面同样净房（未知 id / 非字符串剔除）");

/* 写失败（隐私模式 / 配额）→ 不抛错，返回本次会话生效值 */
storage.clear();
const originalSetItem = storage.setItem;
storage.setItem = () => {
  throw new Error("quota exceeded");
};
let writeThrew = false;
let failedSave = null;
try {
  failedSave = saveTemplateOverrides({ "ws-d": "ori" });
} catch {
  writeThrew = true;
}
assertEq(writeThrew, false, "写失败不抛错");
assertDeep(failedSave, { "ws-d": "ori" }, "写失败仍返回本次会话的净房结果（内存态降级）");
storage.setItem = originalSetItem;

/* localStorage 整体缺席（Node 冒烟 / 隐私模式）→ 读面空表、写面静默 */
globalThis.localStorage = undefined;
assertDeep(loadTemplateOverrides(), {}, "localStorage 缺席 → 读面空表");
let absentThrew = false;
try {
  saveTemplateOverrides({ "ws-a": "ori" });
} catch {
  absentThrew = true;
}
assertEq(absentThrew, false, "localStorage 缺席时写入不抛错（静默降级）");
globalThis.localStorage = storage;

/* ---------- 4. randomTemplateIdOf：88 − 1 等概率域 ---------- */

for (const exclude of ["ori", "uma", "scl", null]) {
  for (let i = 0; i < 60; i += 1) {
    const id = randomTemplateIdOf(exclude);
    assert(typeof id === "string" && ids.has(id), `重掷结果 ∈ 88 id 全集（exclude=${String(exclude)}, got ${id}）`);
    if (typeof exclude === "string") assert(id !== exclude, `重掷结果恒不等于当前命中（exclude=${exclude}）`);
  }
}
const seen = new Set();
for (let i = 0; i < 2000; i += 1) seen.add(randomTemplateIdOf("ori"));
assertEq(seen.size, 87, "重掷池恒为 88 − 1 = 87（2000 次覆盖全集）");
assert(!seen.has("ori"), "重掷池不含排除项");
assertEq(randomTemplateIdOf(undefined) !== null, true, "undefined 排除项 → 全量池可抽");

/* ---------- 5. storage 事件投影 ---------- */

assertEq(templateOverridesFromStorageEvent(null), null, "null 事件 → null（无关）");
assertEq(templateOverridesFromStorageEvent(undefined), null, "undefined 事件 → null");
assertEq(templateOverridesFromStorageEvent({}), null, "无键事件 → null");
assertEq(templateOverridesFromStorageEvent({ key: "dsh-v-cosmos:settings", newValue: "{}" }), null,
  "设置面键 → null（不越界消费）");
assertDeep(
  templateOverridesFromStorageEvent({ key: TEMPLATE_OVERRIDES_KEY, newValue: JSON.stringify({ "ws-a": "ori", "ws-b": "nope" }) }),
  { "ws-a": "ori" },
  "键匹配 → 净房投影（未知 id 剔除）"
);
assertDeep(templateOverridesFromStorageEvent({ key: TEMPLATE_OVERRIDES_KEY, newValue: null }), {},
  "clear（newValue null）→ 空表");
assertDeep(templateOverridesFromStorageEvent({ key: TEMPLATE_OVERRIDES_KEY, newValue: "[]" }), {},
  "数组载荷 → 空表");
assertDeep(templateOverridesFromStorageEvent({ key: TEMPLATE_OVERRIDES_KEY, newValue: "{broken" }), {},
  "坏 JSON → 空表（与读面同语义）");
assertDeep(
  templateOverridesFromStorageEvent({ key: TEMPLATE_OVERRIDES_KEY, newValue: JSON.stringify({ "ws-a": "uma" }) }),
  { "ws-a": "uma" },
  "他窗写入值原样净房透传"
);

/* ---------- 6. 选择器数据面（templatePickerRowsOf） ---------- */

const all = templatePickerRowsOf("");
assertEq(all.length, 88, "空查询 → 全量 88 条");
assertEq(templatePickerRowsOf("   ").length, 88, "纯空白 → 全量（过滤关闭）");
assertEq(templatePickerRowsOf(undefined).length, 88, "非字符串查询 → 全量");
assertEq(templatePickerRowsOf("猎户").map((tpl) => tpl.id).join(","), "ori", "中文名子串过滤（猎户 → ori）");
assertEq(templatePickerRowsOf("ori").map((tpl) => tpl.id).join(","), "ori", "拉丁 id 子串过滤（ori → ori）");
assertEq(templatePickerRowsOf("ORION").map((tpl) => tpl.id).join(","), "ori", "大小写不敏感（ORION → ori）");
assertEq(templatePickerRowsOf("猎户 ori").map((tpl) => tpl.id).join(","), "ori", "多 token AND（猎户 + ori）");
assertEq(templatePickerRowsOf("zzzzzz").length, 0, "无命中 → 空列表（选择器空态）");
assertEq(templatePickerRowsOf("andromeda").map((tpl) => tpl.id).join(","), "and", "拉丁全名子串命中");
assert(templatePickerRowsOf("ori")[0] === all.find((tpl) => tpl.id === "ori"), "过滤结果复用冻结条目引用（零拷贝）");

/* ---------- 7. 形态与确定性 ---------- */

assertDeep(sanitizeTemplateOverrides({ "ws-a": "ori" }), sanitizeTemplateOverrides({ "ws-a": "ori" }),
  "同参重放净房结果逐位一致");
assertEq(typeof randomTemplateIdOf("ori"), "string", "随机重掷返回字符串 id（域断言见上）");

console.log("template-assign-smoke PASS: 净化 / 往返 / 重掷域 / storage 投影 / 选择器数据面 全部通过");
