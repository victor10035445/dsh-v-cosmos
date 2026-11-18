/**
 * 设置页「路径」区控制器（step2-cosmos-openspec-path-setting 3.1–3.3 / spec
 * cosmos-path-setting「设置页路径区」）。
 *
 * 独立纯逻辑模块——client.jsx 注入「通用」页签（CosmosPathsSection），浏览器 bundle
 * 可用（零 node 内建依赖，净房器来自 src/paths.mjs）。
 *
 * 草稿-保存模型（与按钮控制器同纪律，但字段为两个标量路径键）：
 *  - 编辑只改本地草稿（原始文本，未 trim）；「保存」才经设置作用域整节写 `paths`
 *    （CAS：scope.set 携带快照 revision，409 → failed 置位、草稿保留，UI「请重试」）；
 *  - 保存载荷 = 两键显式（trim 非空保留字面量 / 空白→null）——键级 unset = 写 null 键，
 *    与宿主 normalizePaths 净房同口径（spec「unset 语义」场景）；
 *  - 保存前**目录存在性检查**（MAY，spec）：注入 `checkDir` 时对已配置键逐键调用，
 *    结果为非阻断警示（`warnings`；目录不存在仍允许保存——「先配后建」合法工作流）。
 *    web bundle 无 fs 通道，缺省不注入 = 检查跳过（零警示零阻断），绝不抛错；
 *  - 端点不可达（通道回退合成只读 / status loading）→ `writable` false / `loading`，
 *    UI 路径区禁用态 + 提示，不影响页面其余设置。
 */
import { normalizePaths, pathsSectionOf } from "./paths.mjs";

/** 草稿两键文本形状（null 回显为空串，键序恒定）。 */
function draftOf(paths) {
  const normalized = normalizePaths(paths);
  return { openspecPath: normalized.openspecPath ?? "", cosmosSpecDir: normalized.cosmosSpecDir ?? "" };
}

/** 草稿文本 → 保存载荷（trim 非空保留字面量 / 空白→null；两键显式）。 */
function payloadOf(draft) {
  return normalizePaths({
    openspecPath: typeof draft?.openspecPath === "string" ? draft.openspecPath : "",
    cosmosSpecDir: typeof draft?.cosmosSpecDir === "string" ? draft.cosmosSpecDir : ""
  });
}

const draftEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * 路径设置控制器。
 * @param {object} scope 归一后的设置作用域（通道作用域 / 合成只读）
 * @param {{checkDir?: (raw: string) => {exists: boolean, resolved?: string}|null}} [options]
 *        可选存在性检查钩子（node 侧注入；web 缺省不注入 = 跳过）。
 * @returns {object} face：getSnapshot/subscribe + edit/save/discard/dispose
 */
export function createPathsSettingsController(scope, options = {}) {
  const checkDir = typeof options.checkDir === "function" ? options.checkDir : null;
  const listeners = new Set();
  let state = null;
  let staged = null; // {openspecPath, cosmosSpecDir} 原始文本草稿；null = 跟随生效值
  let saving = false;
  let failed = false;
  let warnings = []; // [{key, raw, resolved}]

  const draftBase = () => (staged !== null ? { ...staged } : draftOf(scope.getSnapshot()?.value));

  /** 非阻断存在性检查（保存前调用；checkDir 缺席/抛错 → 零警示，绝不阻断保存）。 */
  const collectWarnings = (payload) => {
    if (checkDir === null) return [];
    const out = [];
    for (const key of ["openspecPath", "cosmosSpecDir"]) {
      const raw = payload[key];
      if (typeof raw !== "string" || raw === "") continue;
      try {
        const result = checkDir(raw);
        if (result !== null && typeof result === "object" && result.exists === false) {
          out.push({ key, raw, resolved: typeof result.resolved === "string" && result.resolved ? result.resolved : raw });
        }
      } catch {
        /* 检查器故障按「无检查」处理（MAY 语义，非阻断） */
      }
    }
    return out;
  };

  const publish = () => {
    const snapshot = scope.getSnapshot();
    const effective = pathsSectionOf(snapshot?.value);
    const draft = staged !== null ? { ...staged } : draftOf(effective);
    const dirty = staged !== null && !draftEqual(payloadOf(staged), effective);
    const user = snapshot?.user;
    state = Object.freeze({
      status: typeof snapshot?.status === "string" ? snapshot.status : "ready",
      loading: snapshot?.status === "loading",
      available: snapshot?.status !== "unavailable",
      writable: snapshot?.writable === true,
      saving,
      failed,
      dirty,
      openspecPath: draft.openspecPath,
      cosmosSpecDir: draft.cosmosSpecDir,
      effective,
      overridden: user !== null && typeof user === "object" && user.paths !== null && typeof user.paths === "object",
      warnings,
      revision: snapshot?.revision
    });
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        console.error("[dsh-v-cosmos] paths settings listener failed:", error);
      }
    }
  };

  const unsubscribe = scope.subscribe(publish);
  publish();

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** 编辑一个路径键的草稿文本（原始文本直存；清警示与失败态）。 */
    edit(key, value) {
      if (key !== "openspecPath" && key !== "cosmosSpecDir") return;
      staged = { ...draftBase(), [key]: typeof value === "string" ? value : "" };
      failed = false;
      warnings = [];
      publish();
    },
    /** 保存：整节 CAS 写入（409 → failed 置位、草稿保留）；成功后清草稿、留存存在性警示。 */
    async save() {
      const current = state;
      if (!current || !current.writable || !current.dirty) return false;
      const payload = payloadOf(draftBase());
      const nextWarnings = collectWarnings(payload);
      saving = true;
      failed = false;
      publish();
      try {
        await scope.set("paths", payload);
        staged = null;
        warnings = nextWarnings;
        return true;
      } catch {
        /* CAS 409 / 只读 / 写拒绝：草稿保留，UI 走「保存未生效，请重试」。 */
        failed = true;
        return false;
      } finally {
        saving = false;
        publish();
      }
    },
    /** 放弃修改：草稿回退到生效值（警示/失败态一并清）。 */
    discard() {
      staged = null;
      failed = false;
      warnings = [];
      publish();
    },
    dispose() {
      unsubscribe?.();
      listeners.clear();
    }
  };
}
