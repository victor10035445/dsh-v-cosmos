/**
 * 宿主当前会话跟随（add-cosmos-host-session-follow）纯逻辑面。
 *
 * dsh 侧「当前会话」的两类事实收敛在这里，客户端控制器只做接线：
 *  - **单点出口** `currentSessionIdOf`：主源 `ctx.uiSession.adapter.current`
 *    （ObservableSnapshot；present 形态快照 `.key` = 当前会话 id、absent 形态
 *    `key: void 0`）。服务缺席 / absent / 形状漂移 / 读取异常 → 回落**降级镜像**
 *    （本插件最近一次成功发起的宿主切换目标；控制器生命周期内模块级、MUST NOT
 *    持久化、初值 null）。
 *  - **跟随链路**：变化沿（出口返回值变化）与开页定位共用引擎既有薄入口
 *    `focusBody(wsId, id)`——与面板行点击同一机械（零新增引擎入口）；会话 id →
 *    星座解析后委派引擎。目标不在册 / 引擎缺席 / 聚焦降级失败全部静默。
 *
 * 本模块零 DOM / 零网络 / 零 React：宿主 ctx 与引擎访问器由客户端控制器注入，
 * test/host-session-follow-smoke.mjs 直接实例化，并在真引擎上走通飞行与选中通知。
 */

/**
 * 宿主当前会话单点出口（spec「宿主当前会话单点出口」）。
 *
 * 采信次序：主源快照 `.key` 为**非空字符串**才采信；其余一切形态（服务缺席、
 * 注入回调未达、`key: void 0`、非字符串漂移、getSnapshot 抛错）静默回落镜像。
 * MUST NOT 外抛到事件链（宿主异常不得打断订阅回调）。
 *
 * @param {object|null} ctx 宿主 ctx（uiSession 可缺席 = 旧宿主 / 最小桩环境）
 * @param {string|null} [mirror] 降级镜像（本插件最近一次成功发起的切换目标）
 * @returns {string|null} 当前会话 id；无当前会话 = null
 */
export function currentSessionIdOf(ctx, mirror = null) {
  try {
    const current = ctx?.uiSession?.adapter?.current;
    if (current && typeof current.getSnapshot === "function") {
      const key = current.getSnapshot()?.key;
      if (typeof key === "string" && key) return key;
    }
  } catch {
    /* 宿主快照形态异常 → 静默走降级（spec：MUST NOT 抛错、MUST NOT 采信漂移值） */
  }
  return typeof mirror === "string" && mirror ? mirror : null;
}

/**
 * 会话 id → 所属星座（工作区）解析纯函数（design D6）：
 * 遍历 `workspaces × (planets + comets)`，按 id 命中即返回 `ws.id`；未命中 = null。
 *
 * 拒绝另建面板索引表：多一份需维护同步的派生结构、收益为零。卫星（子代理会话）
 * 不是宿主「当前会话」的星图目标（面板行也只列行星/彗星），不入遍历。
 *
 * @param {{workspaces?: Array<object>}|null} scene 合并场景（mergedScene）
 * @param {string} sessionId 目标会话 id
 * @returns {string|null} 所属工作区 id；不在册 = null
 */
export function wsIdBySessionId(scene, sessionId) {
  const id = typeof sessionId === "string" ? sessionId : "";
  if (!id) return null;
  const workspaces = Array.isArray(scene?.workspaces) ? scene.workspaces : [];
  for (const ws of workspaces) {
    if (!ws) continue;
    if ((ws.planets ?? []).some((planet) => planet?.id === id)) return ws.id ?? null;
    if ((ws.comets ?? []).some((comet) => comet?.id === id)) return ws.id ?? null;
  }
  return null;
}

/**
 * 跟随器工厂（客户端控制器 setup 调用，与控制器同寿命；页开合无关）：
 * 降级镜像 / 哨兵 / 主源订阅都**不随整页开合重置**——页关闭期间变化沿只记哨兵，
 * 重开页由开页定位兜底（design D5）。
 *
 * 依赖全部注入（便于冒烟直测）：
 * @param {object} [options]
 * @param {object|null} [options.ctx] 宿主 ctx（`ctx.inject` 可选接线用）
 * @param {() => object|null} [options.getEngine] 当前引擎（页关闭 = null）
 * @param {() => object|null} [options.getScene] 当前合并场景（mergedScene）
 * @param {(dispose: Function) => void} [options.addDisposer] 控制器 disposers 收集
 * @returns {object} 跟随器公共面
 */
export function createHostSessionFollow({
  ctx = null,
  getEngine = () => null,
  getScene = () => null,
  addDisposer = () => {}
} = {}) {
  /* 降级镜像（design D2）：本插件最近一次成功发起的宿主切换目标——不持久化、初值 null。 */
  let mirrorSessionId = null;
  /* 哨兵（design D4）：初值与镜像同源（null），首沿判定确定；只在处理面写，
     唯一例外 = 自身切换的乐观前写（成功才转正、未发起回滚，吸收换绑回声）。 */
  let lastFollowed = null;
  /* 主源快照引用（订阅后保存；dispose 清引用，MUST NOT 泄漏）。 */
  let primarySource = null;
  let disposed = false;
  /* 可选主源接线只做一次（ctx.inject 回调可能晚到；重复接线 = 双订阅）。 */
  let bound = false;
  /* 开页定位待执行：attach 置位，场景首次就绪时消费一次（每次开页都执行）。 */
  let locateArmed = false;
  /* 自身切换前写快照（`noteOpenedSession` → `settleOpenedSession` 的未决窗口）：
     宿主换绑通知可能**同步**发生在切换动词内部——前写必须早于动词才能吸收回声；
     未真正发起（通道缺失 / 异常）时按本快照回滚（镜像/哨兵净前进只发生在成功路径）。 */
  let switchSnapshot = null;

  /** 出口读取（单点；disposed 后恒定 null）。 */
  const readCurrent = () => (disposed ? null : currentSessionIdOf(ctx, mirrorSessionId));

  /**
   * 跟随一次（变化沿 / 开页定位 / 任何调用方）：会话 id → 星座 → 引擎 `focusBody`。
   * 与面板行点击同一机械（钻入 + 落地选中 / 同星座重对焦 / 跨星座替换焦点）。
   * 引擎缺席（页关闭）/ 不在册 / 聚焦降级失败 → 静默 false（MUST NOT 抛错）。
   */
  const followTo = (sessionId) => {
    if (disposed || !sessionId) return false;
    const wsId = wsIdBySessionId(getScene(), sessionId);
    if (!wsId) return false; // 不在册（已归档 / 工作区未注册 / 未进场景骨架）→ 仅记哨兵
    const engine = getEngine();
    if (!engine) return false; // 页关闭：引擎未挂载，无镜头动作
    try {
      return engine.focusBody?.(wsId, sessionId) === true;
    } catch {
      return false; // 引擎降级契约之外的异常同样静默（spec「降级静默边界」）
    }
  };

  /**
   * 变化沿处理面（spec「变化沿跟随」+「变化沿判据与哨兵去重」）：
   * 出口取值 → 哨兵比较（同值零动作）→ 解析星座 → `focusBody`（页关闭仅记哨兵）。
   * 列表镜像的任意非 current 刷新不经本入口（重建路径不调用），故不会重触发飞行。
   * @returns {boolean} 是否接受一次新的聚焦请求
   */
  const applyCurrentSession = () => {
    if (disposed) return false;
    const id = readCurrent();
    if (id === lastFollowed) return false; // 哨兵短路：同值 = 无变化沿（含自身切换回声）
    lastFollowed = id;
    return followTo(id);
  };

  /**
   * 自身宿主切换的**乐观前写**（design D4 唯一例外）：镜像 + 哨兵同时记录目标。
   *
   * MUST 在切换动词**之前**调用——宿主 `uiSession` 换绑通知可能在动词内部同步抵达，
   * 前写才能把回声（同值）短路；镜像同时前写保证「absent 窗口」内出口读取自洽。
   * 动词未真正发起时调用方 MUST 调 `settleOpenedSession(false)` 回滚（净前进只发生在
   * 成功路径）。随后的换绑通知（同值）被哨兵短路——MUST NOT 出现二次镜头补间。
   * @param {string} sessionId 即将发起的切换目标
   * @returns {boolean} 是否写入
   */
  const noteOpenedSession = (sessionId) => {
    const id = typeof sessionId === "string" && sessionId ? sessionId : null;
    if (disposed || !id) return false;
    switchSnapshot = { mirror: mirrorSessionId, followed: lastFollowed };
    mirrorSessionId = id;
    lastFollowed = id;
    return true;
  };

  /**
   * 结束 `noteOpenedSession` 的未决窗口：
   *  - `accepted === true` → 切换已发起，前写转正（清快照，值保持不变）；
   *  - `accepted === false` → 未发起（导航通道缺失 / 异常）→ 回滚前写的前值。
   * @param {boolean} accepted 是否真的发起了宿主切换
   * @returns {boolean} 是否执行了回滚
   */
  const settleOpenedSession = (accepted) => {
    const snapshot = switchSnapshot;
    switchSnapshot = null;
    if (accepted || !snapshot) return false;
    mirrorSessionId = snapshot.mirror;
    lastFollowed = snapshot.followed;
    return true;
  };

  /**
   * 开页定位尝试（spec「开页定位」）：与变化沿同一链路，但**不读哨兵**——每次开页
   * 都执行；定位后同步哨兵仅防同值重放。
   * 场景尚未就绪（mergedScene null）→ 保留待执行（首次 setScene 后经 onSceneReady 消费）。
   * @returns {boolean} 本次是否真的发起镜头
   */
  const tryOpenLocate = () => {
    if (!locateArmed || disposed) return false;
    if (!getScene()) return false;
    locateArmed = false; // 每次开页只尝试一次（场景就绪时执行；不在册则静默放弃）
    const id = readCurrent();
    if (!id) return false;
    const accepted = followTo(id);
    lastFollowed = id; // 定位后同步哨兵（随后的同值刷新 MUST NOT 重复触发飞行）
    return accepted;
  };

  /** 整页 attach 后调用：置位开页定位，已就绪的场景立即执行。 */
  const onPageAttach = () => {
    locateArmed = true;
    return tryOpenLocate();
  };

  /** 场景重建完成（setScene 之后）：消费待执行的开页定位。 */
  const onSceneReady = () => tryOpenLocate();

  /** 整页 detach：撤销未执行的开页定位（下次开页重新置位）。 */
  const onPageDetach = () => {
    locateArmed = false;
  };

  /**
   * 可选主源接线（`ctx.inject(["uiSession"], …)` 回调形态）：服务不在册 → 回调不执行
   * → 降级镜像模式；服务在册 → 订阅 `adapter.current` 变化沿并在 disposers 回收。
   * 主源读取仍走单点出口（全消费点 MUST NOT 直读宿主快照散字段）。
   * @returns {boolean} 是否尝试了注入
   */
  const attachUiSession = () => {
    if (disposed || bound) return false;
    bound = true;
    try {
      if (typeof ctx?.inject !== "function") return false;
      ctx.inject(["uiSession"], (scope) => {
        if (disposed) return undefined;
        try {
          const source = scope?.uiSession?.adapter?.current;
          if (!source || typeof source.subscribe !== "function") return undefined;
          primarySource = source;
          const off = source.subscribe(() => {
            /* 变化沿（官方侧栏切换 / 任意外部导航换绑）：跟随；页关闭时仅记哨兵。 */
            applyCurrentSession();
          });
          let released = false;
          const release = () => {
            if (released) return;
            released = true;
            try {
              if (typeof off === "function") off();
            } catch {
              /* 宿主退订异常不阻断其余回收 */
            }
            if (primarySource === source) primarySource = null;
          };
          /* 控制器 disposers 统一回收（spec「订阅随控制器回收」）；回调返回值供
             ctx.inject 作用域回收，双路径幂等。 */
          addDisposer(release);
          return release;
        } catch {
          return undefined;
        }
      });
      return true;
    } catch {
      /* 注入被拒（旧宿主 / cordis 形态差异）→ 降级镜像模式，MUST NOT 阻断插件加载 */
      return false;
    }
  };

  /** 控制器销毁：撤销哨兵待办并释放主源引用（订阅本身由 disposers 回收）。 */
  const dispose = () => {
    disposed = true;
    locateArmed = false;
    switchSnapshot = null;
    primarySource = null;
  };

  return {
    /* 观测面（冒烟/排障）：单点出口读取、镜像、哨兵。 */
    currentSessionId: readCurrent,
    mirrorSessionIdOf: () => mirrorSessionId,
    lastFollowedOf: () => lastFollowed,
    attachUiSession,
    applyCurrentSession,
    noteOpenedSession,
    settleOpenedSession,
    onPageAttach,
    onSceneReady,
    onPageDetach,
    dispose
  };
}
