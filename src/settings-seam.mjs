/**
 * 客户端设置作用域 seam（add-cosmos-proposal-actions 2.4 / 5.x / spec cosmos-button-settings
 * 「配置通道与降级」）。
 *
 * 三通道归一（change 沿用 skill-links 的成熟口径）：
 *  1. **自营 API** `GET/PUT /api/dsh-v-cosmos/config`——读写首选，apply 内同步 attach；
 *  2. 宿主 `settingsScope`（web CLI 代）——API 不可达时的 fallback；
 *  3. 宿主 `configForms`（桌面端代）——同上；
 *  三条皆缺 → 合成只读作用域（设置页 notWritable、动作条不渲染、插件激活不受阻）。
 *
 * 通道形状统一为：`getSnapshot() → {status, value, base, user, revision, writable, mode}`、
 * `subscribe(cb)`、`set(key, value)`、`unset(key)`。
 *
 * 本模块零 React / 零 DOM：`createApiChannel` 的 fetch 与时钟可注入，
 * test/settings-panel-smoke.mjs 直测 CAS 409 重试流与降级链。
 */

/** 动作按钮配置 API 路径。 */
export const CONFIG_API_PATH = "/api/dsh-v-cosmos/config";
/** 与宿主半区一致的设置命名空间 / 桌面端 profile 条目 id。 */
export const SETTINGS_NS = "dsh-v-cosmos";
/** 自营设置 API 的轮询间隔（跟随他端 revision；loopback 小负载）。 */
export const CONFIG_POLL_MS = 5_000;

/**
 * 极简快照 store（宿主 `createSnapshotStore` 的同形子集：整态替换 + 订阅）。
 * `set` 对引用相等的写入短路（防重发风暴）；本插件状态量小，无需深冻结。
 * @param {any} initial
 * @returns {{getSnapshot: () => any, subscribe: (fn: Function) => (() => void), set: (next: any) => void}}
 */
export function createSnapshotStore(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next) {
      if (Object.is(next, state)) return;
      state = next;
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch (error) {
          console.error("[dsh-v-cosmos] snapshot listener failed:", error);
        }
      }
    }
  };
}

/** 合成只读快照：入口 config 不在 client 可达范围，只声明「可读、不可写」。 */
export const READ_ONLY_SNAPSHOT = Object.freeze({
  status: "ready",
  value: Object.freeze({ buttons: Object.freeze([]), constellationButtons: Object.freeze([]) }),
  base: Object.freeze({ buttons: Object.freeze([]), constellationButtons: Object.freeze([]) }),
  user: null,
  revision: undefined,
  writable: false,
  mode: "host"
});
export const READ_ONLY_LOADING_SNAPSHOT = Object.freeze({ ...READ_ONLY_SNAPSHOT, status: "loading" });

const readOnlyRejection = () => Promise.reject(new Error("dsh-v-cosmos: settings are read-only on this host"));

/** 合成只读作用域：三条通道皆缺时的降级底座。 */
export function createReadOnlyScope() {
  return {
    getSnapshot: () => READ_ONLY_SNAPSHOT,
    subscribe: () => () => {},
    set: readOnlyRejection,
    unset: readOnlyRejection
  };
}

/**
 * 活动作用域：attach 前为合成只读 scope，attach 后被通道作用域接管。
 * 待命位：活动连接持有期间到达的第一个通道不被丢弃而是静默登记，拆卸时自动晋升——
 * 使 fallback 与 seam 子注入的解析时序无关（API 通道首取失败自拆时，早到的 seam 不落空）。
 * @returns {object} scope + attach/dispose
 */
export function createActiveScope() {
  const fallback = createReadOnlyScope();
  const listeners = new Set();
  let inner = fallback;
  let standby = null;
  let innerOff;
  const fanOut = () => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        console.error("[dsh-v-cosmos] settings scope listener failed:", error);
      }
    }
  };
  const connect = (next) => {
    inner = next;
    innerOff = inner.subscribe(fanOut);
    fanOut();
  };
  const disconnect = () => {
    innerOff?.();
    innerOff = undefined;
    if (standby !== null) {
      const promoted = standby;
      standby = null;
      connect(promoted);
      return;
    }
    inner = fallback;
    innerOff = inner.subscribe(fanOut);
    fanOut();
  };
  innerOff = inner.subscribe(fanOut);
  return {
    getSnapshot: () => inner.getSnapshot(),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (key, value) => inner.set(key, value),
    unset: (key) => inner.unset(key),
    /**
     * 接入一个通道作用域。空闲时直接接通；活动连接持有期登记第一个后来者为待命。
     * @param {object|undefined|null} next
     * @returns {(() => void)|null} 连接 / 待命句柄（幂等，只拆自己接的那次）
     */
    attach(next) {
      if (next === undefined || next === null) return null;
      if (typeof next.getSnapshot !== "function" || typeof next.subscribe !== "function") return null;
      if (inner === fallback) {
        innerOff?.();
        connect(next);
        let live = true;
        return () => {
          if (!live) return;
          live = false;
          if (inner !== next) return;
          disconnect();
        };
      }
      if (standby !== null) return null;
      standby = next;
      let pending = true;
      return () => {
        if (!pending) return;
        pending = false;
        if (standby === next) standby = null;
      };
    },
    dispose() {
      innerOff?.();
      innerOff = undefined;
      standby = null;
      listeners.clear();
    }
  };
}

/**
 * 通道 1（web CLI）：`settingsScope.bind` 的返回**原样透传**（零适配）。
 * @param {object} sctx 声明了 settingsScope 的子注入作用域
 * @returns {object|undefined}
 */
export function bindSettingsScopeChannel(sctx) {
  const settingsScope = sctx?.settingsScope;
  if (settingsScope === null || typeof settingsScope !== "object" || typeof settingsScope.bind !== "function") return undefined;
  try {
    return settingsScope.bind({
      namespace: SETTINGS_NS,
      decode: (section) => (section !== null && typeof section === "object" ? section : undefined)
    });
  } catch (error) {
    console.error("[dsh-v-cosmos] settingsScope bind failed:", error);
    return undefined;
  }
}

/**
 * 通道 2（桌面端）：`configForms.get(<条目 id>)` 的控制器同形，此处只归一快照：
 *  - 命名空间未服务（`status: "unavailable"`）→ 归一为只读空快照（与双 seam 缺失同观感）；
 *  - `writable` 只在已服务且非 `memory` 模式时透传（`memory` 下宿主写入静默落空）；
 *  - 写入返回 false（宿主拒绝/版本冲突恢复后未落地）→ 抛错，让「保存未生效」路径生效。
 * @param {object} sctx
 * @returns {object|undefined}
 */
export function adaptConfigFormsChannel(sctx) {
  const configForms = sctx?.configForms;
  if (configForms === null || typeof configForms !== "object" || typeof configForms.get !== "function") return undefined;
  let form = null;
  try {
    form = configForms.get(SETTINGS_NS);
  } catch (error) {
    console.error("[dsh-v-cosmos] configForms lookup failed:", error);
    return undefined;
  }
  if (form === null || typeof form !== "object" || typeof form.getSnapshot !== "function" || typeof form.subscribe !== "function") {
    return undefined;
  }
  const hasWriteApi = typeof form.set === "function" && typeof form.unset === "function";
  const normalize = (snapshot) => {
    if (snapshot?.status === "loading") return READ_ONLY_LOADING_SNAPSHOT;
    if (snapshot?.status !== "ready") return READ_ONLY_SNAPSHOT;
    return {
      status: "ready",
      value: snapshot.value ?? {},
      base: snapshot.base ?? {},
      user: snapshot.user ?? null,
      revision: snapshot.revision,
      writable: hasWriteApi && snapshot.writable === true && snapshot.mode !== "memory",
      mode: typeof snapshot.mode === "string" ? snapshot.mode : "host"
    };
  };
  const writableNow = () => normalize(form.getSnapshot()).writable === true;
  const accepted = (outcome) => outcome.then((ok) => {
    if (ok !== true) throw new Error("dsh-v-cosmos: settings write was refused");
  });
  return {
    getSnapshot: () => normalize(form.getSnapshot()),
    subscribe: (listener) => form.subscribe(listener),
    set: (key, value) => (writableNow() ? accepted(form.set(key, value)) : readOnlyRejection()),
    unset: (key) => (writableNow() ? accepted(form.unset(key)) : readOnlyRejection())
  };
}

/**
 * 通道 3（插件自营 API，读写首选）：`GET/PUT /api/dsh-v-cosmos/config` 适配为内部 scope 形状。
 *  - 快照起于 `loading`，首取成功即 ready；
 *  - **首取失败**（网络错误 / 非 2xx，如旧宿主半区 404）→ 经 attach 句柄静默自拆并停止
 *    轮询（无告警日志）：待命或后到的 seam 通道接管；
 *  - `set`/`unset` 经 PUT 携带当前快照 `revision` 作 `baseRevision`：409 → 重拉最新快照
 *    刷新 revision 后 reject（卡片走「保存未生效，请重试」，草稿保留）；
 *  - 订阅期以 5s 轮询 revision 跟随他端修改；无订阅者停止轮询。
 * @param {{fetch?: Function, pollMs?: number, apiPath?: string}} [options]
 * @returns {object} scope + bind（登记自拆句柄）
 */
export function createApiChannel(options = {}) {
  const apiPath = typeof options.apiPath === "string" && options.apiPath ? options.apiPath : CONFIG_API_PATH;
  const fetchImpl = typeof options.fetch === "function" ? options.fetch : (url, init) => fetch(url, init);
  const pollMs = Number.isFinite(options.pollMs) ? options.pollMs : CONFIG_POLL_MS;
  const listeners = new Set();
  let snapshot = Object.freeze({
    status: "loading",
    value: Object.freeze({ buttons: Object.freeze([]), constellationButtons: Object.freeze([]) }),
    base: Object.freeze({ buttons: Object.freeze([]), constellationButtons: Object.freeze([]) }),
    user: null,
    revision: undefined,
    writable: true,
    mode: "host"
  });
  let detach = null;
  let dead = false;
  let started = false;
  let pollTimer = null;
  const fanOut = () => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        console.error("[dsh-v-cosmos] api channel listener failed:", error);
      }
    }
  };
  const settle = (next) => {
    snapshot = Object.freeze(next);
    fanOut();
  };
  /** 服务端快照 → 本层形状；`status` 只认 ready（形状不符按首取失败口径抛错）。 */
  const normalize = (data) => {
    if (data === null || typeof data !== "object" || data.status !== "ready") throw new Error("unexpected config snapshot");
    return {
      status: "ready",
      value: data.value !== null && typeof data.value === "object" ? data.value : {},
      base: data.base !== null && typeof data.base === "object" ? data.base : {},
      user: data.user !== null && typeof data.user === "object" ? data.user : null,
      revision: typeof data.revision === "number" ? data.revision : 0,
      writable: data.writable !== false,
      mode: "host"
    };
  };
  const readSnapshot = async () => {
    const res = await fetchImpl(apiPath, { headers: { accept: "application/json" } });
    if (!res || res.ok !== true) throw new Error(`config fetch failed: HTTP ${res?.status ?? "?"}`);
    return normalize(await res.json());
  };
  const stopPolling = () => {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };
  const startPolling = () => {
    if (dead || pollTimer !== null || listeners.size === 0) return;
    pollTimer = setInterval(() => {
      readSnapshot().then((next) => {
        if (dead) return;
        if (next.revision !== snapshot.revision) settle(next);
      }).catch(() => {
        /* 轮询失败（宿主重启窗口期）：保持上一份有效快照，恢复后自动跟随 */
      });
    }, pollMs);
    pollTimer?.unref?.();
  };
  const retire = () => {
    if (dead) return;
    dead = true;
    stopPolling();
    const handle = detach;
    detach = null;
    if (typeof handle === "function") handle();
  };
  /** PUT：CAS 写入；409 → 重拉快照后 reject；200 → 刷新快照（新 revision 立即可用）。 */
  const write = async (sections) => {
    if (dead) throw new Error("dsh-v-cosmos: settings API channel is unavailable");
    const baseRevision = typeof snapshot.revision === "number" ? snapshot.revision : 0;
    let res;
    try {
      res = await fetchImpl(apiPath, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseRevision, sections })
      });
    } catch (error) {
      throw new Error(`dsh-v-cosmos: settings save failed: ${String(error?.message || error)}`);
    }
    if (res.status === 409) {
      /* CAS 冲突：先刷新 revision（草稿保留），再抛错让「保存未生效，请重试」生效。 */
      await readSnapshot().then(settle).catch(() => {});
      throw new Error("dsh-v-cosmos: settings save conflict (revision changed elsewhere)");
    }
    if (res.ok !== true) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`dsh-v-cosmos: settings save failed: HTTP ${res.status}${body?.reason ? " · " + body.reason : ""}`);
    }
    const data = await res.json().catch(() => ({}));
    if (typeof data.revision === "number") settle({ ...snapshot, revision: data.revision });
    await readSnapshot().then(settle).catch(() => {});
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (dead) return () => {};
      listeners.add(listener);
      if (!started) {
        started = true;
        readSnapshot().then((next) => {
          if (dead) return;
          settle(next);
          startPolling();
        }).catch(() => {
          /* 首取失败：静默退场，落回待命 seam 或合成只读底座 */
          retire();
        });
      } else {
        startPolling();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stopPolling();
      };
    },
    set: (key, value) => write({ [key]: value }),
    unset: (key) => write({ [key]: null }),
    /** 登记 attach 句柄（首取失败自拆用；apply 内同步 attach 后立即调用）。 */
    bind(handle) {
      detach = typeof handle === "function" ? handle : null;
    }
  };
}

/**
 * 列表节快照 store：把设置作用域里的某一列表节投影为干净的只读快照面。
 * 与设置页共享同一作用域实例（不依赖设置页是否打开）；scope 变更即发布 →
 * 设置页保存后动作条当场更新（spec「数组顺序即展示顺序」/ 热生效场景）。
 *
 * 提案动作（`buttons`）与星座动作（`constellationButtons`）各用一个实例，**互不共享**
 * （两套投影各自只读自己的节）。
 * @param {{getSnapshot: Function, subscribe: Function}} scope
 * @param {(section: unknown) => Array<object>} project 该节的容错投影（buttonsSectionOf / constButtonsSectionOf）
 * @param {{field?: string}} [options] 快照键名（缺省 `buttons`）
 */
export function createButtonsStore(scope, project, options = {}) {
  const field = typeof options.field === "string" && options.field ? options.field : "buttons";
  const store = createSnapshotStore({ [field]: [] });
  const publish = () => {
    const value = scope.getSnapshot()?.value;
    store.set({ [field]: project(value) });
  };
  const unsubscribe = scope.subscribe(publish);
  publish();
  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    dispose: unsubscribe
  };
}
