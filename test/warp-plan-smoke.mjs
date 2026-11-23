/**
 * 曲率计划配置冒烟（two-add-cosmos-proposal-warp 5.3 / spec cosmos-proposal-warp
 * 「曲率计划配置模型与曲率引擎设置页签」）：
 *  - 严格净房拒绝族：形状非法 / name 空 / rule 枚举外 / 同名重复 / 超上限；
 *  - 存储最小形（仅 queue 落键，direct 不落）、read 容错（坏条目剔除、未知 rule 回落缺省）；
 *  - 计划 × 按钮解析：悬空引用丢弃、星胚目标仅 proto（规则恒直航）、提案目标排除 proto
 *    与直达移除按钮；
 *  - 设置页控制器：勾选/规则编辑、dirty 计算、保存 CAS 载荷、失败保留草稿、放弃/重置、
 *    writable/saving 禁用门；
 *  - 计划变更不影响已附着条目快照（在途链按快照推进）；
 *  - configstore 节集成（normalizeView / mergeView / writeSections / 读面容错）。
 * 运行：node test/warp-plan-smoke.mjs
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_WARP_BARS,
  WARP_RULES,
  createWarpPlanSettingsController,
  normalizeWarpPlan,
  resolveWarpPlanEntries,
  sanitizeWarpPlan,
  warpPlanOptionsOf,
  warpPlanSectionOf
} from "../src/warp-plan.mjs";
import {
  CONFIG_STORE_SECTIONS,
  createConfigStore,
  mergeView,
  normalizeView
} from "../src/configstore.mjs";
import { createWarpStore } from "../src/warp-store.mjs";
import { createSnapshotStore } from "../src/settings-seam.mjs";

const cleanup = [];
const tempDir = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(dir);
  return dir;
};

const button = (name, extra = {}) => ({
  name,
  prompt: "执行 " + name,
  autoSend: false,
  newSession: extra.preState === "proto" ? false : true,
  ...extra
});

/* ── 1. 严格净房拒绝族 ── */
{
  assert.deepEqual(WARP_RULES, ["direct", "queue"]);
  assert.deepEqual(normalizeWarpPlan(undefined), { bars: [] }, "缺省 → 空计划");
  assert.deepEqual(normalizeWarpPlan({ bars: [] }), { bars: [] }, "空数组合法");
  assert.deepEqual(normalizeWarpPlan({ bars: [{ name: " 审查 " }, { name: "执行", rule: "queue" }] }), {
    bars: [{ name: "审查" }, { name: "执行", rule: "queue" }]
  }, "name trim + 存储最小形（仅 queue 落键）");
  assert.deepEqual(normalizeWarpPlan({ bars: [{ name: "执行", rule: "direct" }] }), { bars: [{ name: "执行" }] }, "显式 direct 归一化丢弃");

  const reject = (value, label) => assert.throws(() => normalizeWarpPlan(value), TypeError, label);
  reject(null === null ? "nope" : null, "字符串非法");
  reject({ bars: "x" }, "bars 非数组");
  reject({ bars: [null] }, "非对象条目");
  reject({ bars: [{ name: "" }] }, "name 空");
  reject({ bars: [{ name: "x", rule: "steer" }] }, "rule 枚举外");
  reject({ bars: [{ name: "x", rule: 1 }] }, "rule 非字符串");
  reject({ bars: [{ name: "x" }, { name: "x" }] }, "同名重复");
  reject({ bars: Array.from({ length: MAX_WARP_BARS + 1 }, (_, index) => ({ name: "B" + index })) }, "超上限");

  /* 读面容错：坏条目逐条剔除、未知 rule 回落 direct、同名先到先得、超限截断 */
  assert.deepEqual(sanitizeWarpPlan({
    bars: [
      { name: " 审查 ", rule: "queue" },
      { name: "" },
      { name: "坏", rule: "steer" },
      { name: "审查", rule: "direct" },
      null
    ]
  }), { bars: [{ name: "审查", rule: "queue" }, { name: "坏" }] }, "读面容错（未知 rule 回落缺省）");
  assert.deepEqual(warpPlanSectionOf(undefined), { bars: [] }, "节缺失 → 空计划");
  const capped = sanitizeWarpPlan({ bars: Array.from({ length: MAX_WARP_BARS + 5 }, (_, index) => ({ name: "B" + index })) });
  assert.equal(capped.bars.length, MAX_WARP_BARS, "读面超限截断");
}

/* ── 2. 计划 × 按钮解析 ── */
{
  const buttons = [
    button("New", { preState: "proto" }),
    button("Review", { preState: "created", model: { provider: "p", model: "m" }, prepend: true }),
    button("Apply", { preState: "reviewed" }),
    button("Dismiss", { preState: "proto", embryoDismiss: true, prompt: "" }),
    button("Archive")
  ];
  const plan = { bars: [{ name: "New" }, { name: "Review", rule: "queue" }, { name: "Dismiss" }, { name: "Missing" }] };

  const embryoEntries = resolveWarpPlanEntries(plan, buttons, "embryo");
  assert.deepEqual(embryoEntries.map((entry) => entry.button.name), ["New"], "星胚目标仅 proto 条目（直达移除/非 proto/悬空剔除）");
  assert.equal(embryoEntries[0].rule, "direct", "星胚 proto 恒直航（转投需要提案目录）");

  const proposalEntries = resolveWarpPlanEntries(plan, buttons, "proposal");
  assert.deepEqual(proposalEntries.map((entry) => entry.button.name), ["Review"], "提案目标排除 proto / 直达移除 / 悬空");
  assert.equal(proposalEntries[0].rule, "queue", "分流规则快照");
  assert.deepEqual(proposalEntries[0].button, {
    name: "Review",
    prompt: "执行 Review",
    model: { provider: "p", model: "m" },
    prepend: true,
    preState: "created"
  }, "按钮快照（存储最小形 + 键序）");

  const options = warpPlanOptionsOf(buttons);
  assert.deepEqual(options.map((option) => option.name), ["New", "Review", "Apply", "Archive"], "候选行排除直达移除按钮");
  assert.equal(options[0].preState, "proto");
}

/* ── 3. 设置页控制器（暂存-保存 / 失败 / 放弃 / 重置） ── */
{
  const scopeStore = createSnapshotStore({
    status: "ready",
    revision: 4,
    writable: true,
    user: null,
    value: {
      buttons: [
        button("New", { preState: "proto" }),
        button("Review", { preState: "created" }),
        button("Apply", { preState: "reviewed" }),
        button("Dismiss", { preState: "proto", embryoDismiss: true, prompt: "" })
      ],
      warpPlan: { bars: [{ name: "Review" }] }
    }
  });
  const writes = [];
  let rejectNext = false;
  const scope = {
    getSnapshot: scopeStore.getSnapshot,
    subscribe: scopeStore.subscribe,
    async set(key, value) {
      writes.push({ key, value });
      if (rejectNext) throw new Error("cas conflict");
      const current = scopeStore.getSnapshot();
      const nextValue = { ...current.value, [key]: value };
      scopeStore.set({
        ...current,
        revision: current.revision + 1,
        user: { ...(current.user ?? {}), [key]: value },
        value: nextValue
      });
    },
    async unset(key) {
      const current = scopeStore.getSnapshot();
      const value = { ...current.value };
      delete value[key];
      const user = { ...(current.user ?? {}) };
      delete user[key];
      scopeStore.set({ ...current, revision: current.revision + 1, user: Object.keys(user).length > 0 ? user : null, value });
    }
  };
  const face = createWarpPlanSettingsController(scope);
  let state = face.getSnapshot();
  assert.equal(state.rows.length, 3, "候选行 = 非直达移除动作条");
  assert.equal(state.rows.find((row) => row.name === "Review").checked, true, "生效计划回显勾选");
  assert.equal(state.rows.find((row) => row.name === "Apply").checked, false);
  assert.equal(state.dirty, false, "未编辑不 dirty");
  assert.equal(state.count, 1);

  /* 编辑：勾选 Apply + 规则 queue → dirty；保存载荷最小形 */
  face.edit("Apply", { checked: true });
  face.edit("Apply", { rule: "queue" });
  state = face.getSnapshot();
  assert.equal(state.dirty, true);
  assert.equal(state.rows.find((row) => row.name === "Apply").rule, "queue");
  assert.equal(await face.save(), true, "保存成功");
  assert.deepEqual(writes.at(-1), {
    key: "warpPlan",
    value: { bars: [{ name: "Review" }, { name: "Apply", rule: "queue" }] }
  }, "保存载荷 = 按钮配置顺序 + 仅 queue 落键");
  state = face.getSnapshot();
  assert.equal(state.dirty, false, "保存后草稿回退生效值");

  /* 失败保留草稿 */
  face.edit("Review", { rule: "queue" });
  rejectNext = true;
  assert.equal(await face.save(), false, "CAS 失败返回 false");
  rejectNext = false;
  state = face.getSnapshot();
  assert.equal(state.failed, true, "失败态置位");
  assert.equal(state.dirty, true, "草稿保留");

  /* 放弃修改回退 */
  face.discard();
  state = face.getSnapshot();
  assert.equal(state.dirty, false);
  assert.equal(state.rows.find((row) => row.name === "Review").rule, "direct", "放弃后回退生效值");

  /* 覆盖标记 + 重置 */
  assert.equal(state.overridden, true, "配置层存在用户覆盖");
  assert.equal(await face.reset(), true, "重置成功");
  state = face.getSnapshot();
  assert.equal(state.overridden, false, "重置后无覆盖");
  assert.equal(state.rows.every((row) => row.checked === false), true, "重置后空计划");
  assert.equal(state.count, 0);

  /* 悬空引用：生效计划含已删除按钮 → 优雅降级（不出行、保存丢弃） */
  scopeStore.set({
    status: "ready",
    revision: 9,
    writable: true,
    user: { warpPlan: { bars: [{ name: "Gone" }] } },
    value: {
      buttons: [button("Review", { preState: "created" })],
      warpPlan: { bars: [{ name: "Gone" }] }
    }
  });
  state = face.getSnapshot();
  assert.equal(state.rows.length, 1, "悬空引用不出行");
  assert.equal(state.dangling.includes("Gone"), true, "悬空引用可见（诊断）");
  face.edit("Review", { checked: true });
  assert.deepEqual(face.getSnapshot().plan, [{ name: "Review" }], "保存时自然丢弃悬空引用");

  face.dispose();
}

/* ── 4. 计划变更不影响已附着条目快照（配合 3.7） ── */
{
  const store = createWarpStore({
    filePath: "C:/virtual/plan.json",
    read: () => null,
    write: () => {},
    idFactory: (() => {
      let n = 0;
      return () => "w-" + (++n);
    })()
  });
  store.load();
  const planA = [{ button: button("Review", { preState: "created" }), rule: "direct" }];
  const attached = store.attach({
    wsId: "ws1",
    targetKey: "add-a",
    targetKind: "proposal",
    proposalDir: "C:/ws/openspec/changes/add-a",
    entries: planA,
    now: 1
  });
  assert.equal(attached.ok, true);
  /* 用户随后把计划改成完全不同的条目（或删除 Review）——在途快照不变 */
  const planB = resolveWarpPlanEntries({ bars: [{ name: "Archive", rule: "queue" }] }, [button("Archive")], "proposal");
  assert.deepEqual(planB[0].button, { name: "Archive", prompt: "执行 Archive" }, "新计划解析为独立快照");
  assert.equal(planB[0].rule, "queue");
  const entry = store.warp("ws1").entries[0];
  assert.equal(entry.button.name, "Review", "在途条目仍按附着快照推进");
  assert.equal(entry.button.preState, "created");
  assert.equal(entry.rule, "direct");
}

/* ── 5. configstore 节集成 ── */
{
  assert.deepEqual(CONFIG_STORE_SECTIONS, ["buttons", "constellationButtons", "paths", "warpPlan"], "warpPlan 节注册");
  const view = normalizeView({
    buttons: [],
    warpPlan: { bars: [{ name: "Review" }, { name: "Bad", rule: "steer" }] }
  }, { tolerateUnknownPreState: true });
  assert.deepEqual(view.warpPlan, { bars: [{ name: "Review" }, { name: "Bad" }] }, "读面容错合并");
  const merged = mergeView(normalizeView({}), { warpPlan: { bars: [{ name: "Review", rule: "queue" }] } });
  assert.deepEqual(merged.warpPlan, { bars: [{ name: "Review", rule: "queue" }] }, "存储节覆盖 base");
  assert.deepEqual(mergeView(normalizeView({}), null).warpPlan, { bars: [] }, "无覆盖 → 空计划");

  const home = tempDir("dsh-cosmos-warp-plan-");
  const store = createConfigStore({ filePath: join(home, "dsh-v-cosmos.config.json"), sleep: async () => {} });
  const outcome = await store.writeSections({
    baseRevision: 0,
    sections: { warpPlan: { bars: [{ name: "Review", rule: "queue" }, { name: "Apply" }] } }
  });
  assert.equal(outcome.revision, 1);
  store.refresh();
  assert.deepEqual(store.snapshot({ buttons: [] }).user, { warpPlan: { bars: [{ name: "Review", rule: "queue" }, { name: "Apply" }] } }, "落盘最小形");
  /* 严格净房拒绝（写面） */
  await assert.rejects(() => store.writeSections({
    baseRevision: 1,
    sections: { warpPlan: { bars: [{ name: "Review" }, { name: "Review" }] } }
  }), /duplicated/, "同名重复保存拒绝");
  await assert.rejects(() => store.writeSections({
    baseRevision: 1,
    sections: { warpPlan: { bars: [{ name: "Review", rule: "steer" }] } }
  }), /rule must be/, "枚举外 rule 保存拒绝");
}

for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
console.log("warp-plan-smoke: all assertions passed");
