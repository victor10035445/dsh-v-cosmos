/**
 * 设置页「Cosmos」节 UI（add-cosmos-proposal-actions 5.1–5.3 / spec cosmos-button-settings；
 * add-cosmos-constellation-actions 5.2/5.3 新增「星座动作」标签页并复用行交互骨架；
 * add-cosmos-skin-themes 3.4/3.5 新增「皮肤」标签页——卡片网格 + 即时生效；
 * add-cosmos-zoom-focus-nav 3.1–3.3 新增「导航」标签页——缩放阈值与指针聚焦的轻量偏好
 * （两个数字输入 + 一个开关，即时生效，无保存钮）；
 * fix-cosmos-const-float-send-close 4.3：「快捷动作」按钮行增「执行后跳转」勾选框
 * （每按钮独立，缺省勾选；参与暂存-保存）——与固定语义的行内锁定「新增会话」是两个
 * 相互独立的设置（取消跳转 MUST NOT 影响新建会话；星座动作页签无跳转字段）。
 * add-cosmos-action-prestate-gate 4.1–4.3：「快捷动作」行增「前置状态」下拉（不限/
 * 待创建（星胚）/已创建/已审核/已执行；漂移值原样回显标不可用）；星胚行「新增会话」
 * 锁定翻转为不勾选、「提示词在前」禁用；星座动作页签不呈现该下拉。
 * fix-cosmos-skin-select-feedback 2.1–2.4：「皮肤 / 导航」两页签订阅选择失败 health
 * face——整页控制器缺失导致写入未落地时呈现「未生效」提示条（含原因码后缀）；face
 * 缺失时渲染降级占位，而非可点击/可输入却永不生效的卡片网格与控件。
 * add-cosmos-native-composer 4.1/4.2：星座动作页签顶部新增「发送前编辑」下拉
 * （`native` = 跳转会话页由原生 composer 承载 / `float` = 浮窗补写、星空保持）——
 * 独立轻量 face（navFace 同构，注入名 `preflight`）即时保存，不参与按钮暂存-保存
 * 草稿流，也不受按钮 writable/saving 门控（快捷动作页签不呈现）。
 *
 * 由 client.jsx 注册为 `settings.section`（id `v-cosmos`，order 6——「技能管理」之后）+
 * 四条标签页「快捷动作」（order 0）/「星座动作」（order 1）/「皮肤」（order 2）/
 * 「导航」（order 3）。视觉参数照 skill-links 设置节（官方 settings section 形状、
 * `--dsw-alias-*` token），类名统一 `cs-` 前缀避免与其它插件样式互踩。
 *
 * 纯 UI：状态与动作来自 `createButtonSettingsController`（button-settings.mjs）的 face
 * （两实例各自绑定自己的配置节），模型目录来自可选桥的 `{catalog}` 快照面（不可达时整体
 * 降级为「跟随会话（默认）」）。两标签页的差异只有 `variant` 驱动的文案与字段呈现：
 * 星座行**无「提示词在前」与「执行后跳转」**、`newSession` 锁定徽标、intro/hint 走星座口径。
 * 「皮肤」页签是**即时生效**的轻量偏好（无草稿-保存模式）：卡片选中 → face.select(id)
 * → 写 `saveCosmosSettings` + 已打开整页热切。
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { buttonModelOf } from "./actions.mjs";
import { PRE_STATES } from "./buttons.mjs";
import { catalogOptions, describeButtonModel, highestEffort } from "./model-catalog.mjs";
import { COSMOS_DEFAULT_SKIN, COSMOS_SKINS, skinCardOf } from "./cosmos/skin-registry.mjs";

/** 标签页槽位名（client.jsx 注册与本节渲染共用）。 */
export const SETTINGS_TAB_SLOT = "settings.v-cosmos.tab";

const noopSubscribe = () => () => {};
const noopSnapshot = () => null;

/**
 * 两种标签页的差异文案/字段表（其余行交互骨架完全共用）。
 * `labelKey`/`hintKey` 等均为「cosmos.settings.」之下的键名；`errorKeyPrefix` 为
 * 校验错误键的统一前缀（控制器 issue 返回的键已含该前缀，此处仅作可读性说明）。
 */
const ACTION_COPY = {
  anchor: "dsh-v-cosmos:settings-actions",
  label: ["buttonsLabel", "动作按钮（作用于选中提案）"],
  hint: ["buttonsHint", "点击按钮在选中提案所属工作区创建新会话：消息 = 提示词与 @提案目录（按「提示词在前」决定先后）；勾选自动发送则经 hero 相位自动提交首回合。保存后立即生效，无需重启。"],
  extraHint: ["prependDiffHint", "「提示词在前」= 消息里提示词位于 @提案引用之前（与 dsh-v-skill-links 的同名字段语义不同：那里指把提示词前插进既有草稿）。"],
  showPrepend: true,
  /* 每按钮「执行后跳转」：仅快捷动作行提供（星座链路恒整页保持，无跳转语义）。 */
  showJump: true,
  /* 每按钮「前置状态」：仅快捷动作行提供（星座按钮无提案选中上下文）。 */
  showPreState: true,
  /* 「发送前编辑」轻量偏好：仅星座动作页签提供（add-cosmos-native-composer 4.1）。 */
  showPreflight: false,
  newSessionTitle: ["newSessionTitle", "固定为「新增会话」：在提案所属工作区创建新会话（不可修改）"],
  newSessionTitleProto: ["newSessionTitleProto", "星胚动作固定发往探索会话、不开新会话（不可修改）"],
  prependTitleProto: ["prependTitleProto", "星胚消息不含 @ 提案引用、先后无语义（不可勾选）"],
  count: ["buttonsCountPrefix", "动作按钮："]
};

const CONSTELLATION_COPY = {
  anchor: "dsh-v-cosmos:settings-constellation-actions",
  label: ["constButtonsLabel", "星座动作按钮（作用于当前星座）"],
  hint: ["constButtonsHint", "点击按钮在当前星座对应的工作区创建新会话：消息 = 纯提示词（不含 @提案引用）；勾选自动发送则点击即发；未勾选时按下方「发送前编辑」分流——浮窗补写（缺省：星空保持，模型选择/语音转写在浮窗内可用），或跳转会话页由原生输入区承载。保存后立即生效，无需重启。"],
  extraHint: null,
  showPrepend: false,
  showJump: false,
  showPreState: false,
  showPreflight: true,
  newSessionTitle: ["constNewSessionTitle", "固定为「新增会话」：在当前星座对应工作区创建新会话（不可修改）"],
  newSessionTitleProto: null,
  prependTitleProto: null,
  count: ["constButtonsCountPrefix", "星座动作按钮："]
};

/** 文案取值（词典未登记时回落字面量，避免脏 key 直出）。 */
function tr(t, key, fallback) {
  try {
    const value = typeof t === "function" ? t(key) : null;
    return typeof value === "string" && value && value !== key ? value : fallback;
  } catch {
    return fallback;
  }
}

/**
 * 「未生效」提示文案（fix-cosmos-skin-select-feedback 2.4）：词典主体 + 原因码后缀
 * （`controller-missing` 等，zh/en 成对登记于 client.jsx DICT）。
 */
function notAppliedText(t, key, fallback, failure) {
  const code = failure !== null && typeof failure.code === "string" && failure.code ? failure.code : "";
  return tr(t, key, fallback) + (code ? " (" + code + ")" : "");
}

/**
 * health store 快照 → 最近失败记录（形状防御；非法快照按「无失败」处理）。
 * 载荷：`{ lastFailure: null | { face: "skin"|"nav", code, at } }`。
 */
function selectFailureOf(snapshot) {
  if (snapshot === null || typeof snapshot !== "object") return null;
  const failure = snapshot.lastFailure;
  if (failure === null || typeof failure !== "object") return null;
  return typeof failure.face === "string" ? failure : null;
}

/** 设置 CSS（照官方 settings 节形状：max-width 760 / 18px 标题 / 下边框标签行）。 */
export const COSMOS_SETTINGS_CSS = `
.dsh-cosmos-settings{display:flex;flex-direction:column;gap:12px;max-width:760px;color:var(--dsw-alias-label-primary)}
.dsh-cosmos-settings-heading{margin:0;font-size:18px;font-weight:600}
.dsh-cosmos-settings-intro{margin:0;font-size:13px;color:var(--dsw-alias-label-tertiary)}
.dsh-cosmos-settings-tabs{display:flex;align-items:flex-end;gap:22px;margin-top:2px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsh-cosmos-settings-tab{position:relative;padding:7px 1px 9px;border:0;background:0 0;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:13px;line-height:20px;cursor:pointer}
.dsh-cosmos-settings-tab:hover,.dsh-cosmos-settings-tab[data-active=true]{color:var(--dsw-alias-label-primary)}
.dsh-cosmos-settings-tab[data-active=true]:after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:2px;border-radius:2px;background:var(--dsw-alias-border-inverted)}
.dsh-cosmos-settings-panel{display:flex;flex-direction:column;gap:6px;padding-top:10px}
.cs-secHead{display:flex;align-items:center;gap:8px;margin-top:8px}
.cs-label{flex:1;margin:0;font-size:12px;color:var(--dsw-alias-label-secondary)}
.cs-hint{font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.cs-meta{font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.cs-error{font-size:12px;line-height:16px;color:var(--dsw-alias-state-error-primary)}
.cs-loading{padding:10px 12px;font-size:13px;color:var(--dsw-alias-label-dimmed)}
.cs-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:2px}
.cs-btn{padding:3px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.cs-btn:hover:not(:disabled){color:var(--dsw-alias-label-primary)}
.cs-btn:disabled{opacity:.5;cursor:not-allowed}
.cs-btnPrimary{border-color:transparent;background:var(--dsw-alias-state-business-primary);color:#fff}
.cs-addBtn{padding:3px 10px;border:1px dashed var(--dsw-alias-border-l2);border-radius:8px;background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.cs-addBtn:hover:not(:disabled){border-color:var(--dsw-alias-border-inverted);color:var(--dsw-alias-label-primary)}
.cs-addBtn:disabled{opacity:.5;cursor:not-allowed}
.cs-row{position:relative;display:flex;flex-direction:column;gap:4px;padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px}
.cs-rowHead{display:flex;align-items:center;gap:6px}
.cs-grip{flex:none;align-self:stretch;display:inline-flex;align-items:center;justify-content:center;width:14px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:18px;cursor:grab;-webkit-user-select:none;user-select:none}
.cs-grip:hover{color:var(--dsw-alias-label-secondary)}
.cs-grip[data-disabled=true]{opacity:.45;cursor:not-allowed}
.cs-name{flex:1;min-width:0;padding:3px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:var(--dsw-font-markdown-code-block-small,12px ui-monospace,SFMono-Regular,Menlo,monospace);outline:none}
.cs-name:focus{border-color:var(--dsw-alias-border-inverted)}
.cs-auto{flex:none;display:inline-flex;align-items:center;gap:5px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:16px;cursor:pointer;-webkit-user-select:none;user-select:none}
.cs-auto input{margin:0;cursor:pointer;accent-color:var(--dsw-alias-border-inverted)}
.cs-badge{flex:none;padding:1px 8px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px}
.cs-locked{cursor:default}
.cs-locked input{cursor:not-allowed;opacity:.6}
.cs-move{flex:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1;cursor:pointer}
.cs-move:hover:not(:disabled){border-color:var(--dsw-alias-border-inverted);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.cs-move:disabled{opacity:.4;cursor:not-allowed}
.cs-remove{padding:2px 6px;border:0;border-radius:6px;background:0 0;color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:18px;cursor:pointer}
.cs-remove:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-state-error-primary)}
.cs-prompt{resize:vertical;min-height:44px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:var(--dsw-font-markdown-code-block-small,12px ui-monospace,SFMono-Regular,Menlo,monospace);outline:none}
.cs-prompt:focus{border-color:var(--dsw-alias-border-inverted)}
.cs-prompt:disabled,.cs-name:disabled{opacity:.55}
.cs-dropLine{position:absolute;left:4px;right:4px;height:2px;border-radius:1px;background:var(--dsw-alias-border-inverted);z-index:1;pointer-events:none}
.cs-dropLine[data-edge=before]{top:-3px}
.cs-dropLine[data-edge=after]{bottom:-3px}
.cs-modelRow{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.cs-modelField{display:inline-flex;align-items:center;gap:6px;min-width:0}
.cs-modelCap{flex:none;font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.cs-select{min-width:0;max-width:280px;padding:3px 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;outline:none}
.cs-select:focus{border-color:var(--dsw-alias-border-inverted)}
.cs-select:disabled{opacity:.55;cursor:not-allowed}
.cs-modelHint{font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
/* ── 皮肤页签（add-cosmos-skin-themes 3.4）：卡片网格 + 预览色板条 + 默认徽标/选中态。
      视觉沿用官方 settings 形状（--dsw-alias-* token），不消费 --cos-*（设置页不在
      Cosmos 整页作用域内，令牌不在作用域里继承）。触屏点击目标 ≥44px。 ── */
.cs-skinGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(196px,1fr));gap:8px;margin-top:2px}
.cs-skinCard{display:flex;flex-direction:column;gap:6px;box-sizing:border-box;min-height:44px;padding:8px 9px;
  text-align:left;font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);
  border:1px solid var(--dsw-alias-border-l2);border-radius:10px;cursor:pointer;outline:none}
.cs-skinCard:hover{border-color:var(--dsw-alias-border-inverted)}
.cs-skinCard:focus-visible{outline:2px solid var(--dsw-alias-border-inverted);outline-offset:2px}
.cs-skinCard[data-selected=true]{border-color:var(--dsw-alias-state-business-primary);box-shadow:inset 0 0 0 1px var(--dsw-alias-state-business-primary)}
.cs-skinSwatch{display:flex;height:10px;border-radius:4px;overflow:hidden;border:1px solid var(--dsw-alias-border-l2)}
.cs-skinSwatch i{flex:1 1 0;display:block}
.cs-skinName{font-size:13px;font-weight:600;line-height:18px}
.cs-skinRef{font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary)}
.cs-skinMeta{display:flex;align-items:center;gap:6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.cs-skinBadge{padding:0 6px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover-solid);font-size:10px;line-height:16px}
.cs-skinMode{opacity:.8}
.cs-skinCount{font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary)}
/* ── 导航页签（add-cosmos-zoom-focus-nav 3.1）：进入/返回阈值数字输入 + 指针聚焦开关。
      即时生效（无草稿-保存）；数字输入/开关触控目标 ≥44px，label + aria 可达。 ── */
.cs-nav{display:flex;flex-direction:column;gap:10px;margin-top:2px}
.cs-navRow{display:flex;flex-direction:column;gap:2px}
.cs-navField{display:flex;align-items:center;gap:8px;min-height:44px}
.cs-navLabel{flex:1;min-width:0;font-size:13px;line-height:18px;color:var(--dsw-alias-label-primary)}
.cs-navInput{width:92px;box-sizing:border-box;min-height:44px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l2);
  border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;
  line-height:18px;text-align:right;outline:none}
.cs-navInput:focus{border-color:var(--dsw-alias-border-inverted)}
.cs-navUnit{flex:none;width:24px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.cs-navHint{font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.cs-navToggle{display:flex;align-items:flex-start;gap:8px;box-sizing:border-box;min-height:44px;padding:8px 9px;
  border:1px solid var(--dsw-alias-border-l2);border-radius:10px;cursor:pointer}
.cs-navToggle:hover{border-color:var(--dsw-alias-border-inverted)}
.cs-navToggle:focus-within{outline:2px solid var(--dsw-alias-border-inverted);outline-offset:2px}
.cs-navToggle input{margin:2px 0 0;cursor:pointer;accent-color:var(--dsw-alias-border-inverted)}
.cs-navToggleText{display:flex;flex-direction:column;gap:2px;min-width:0}
/* ── 「发送前编辑」轻量偏好（add-cosmos-native-composer 4.1）：星座动作页签顶部的
   即时保存开关（独立 face——不随按钮草稿保存/放弃，不受按钮 writable/saving 门控）。
   控件语言随既有行内控件（label + cs-select），触控目标 ≥44px。 ── */
.cs-constPreflight{display:flex;flex-direction:column;gap:4px;margin-top:2px;padding:8px 9px;
  border:1px solid var(--dsw-alias-border-l2);border-radius:10px}
.cs-constPreflightField{display:flex;align-items:center;gap:8px;min-height:44px}
.cs-constPreflightField .cs-label{flex:1;min-width:0;font-size:13px;line-height:18px;color:var(--dsw-alias-label-primary)}
`;

/**
 * 「Cosmos」设置节：heading + intro + 标签行 + 激活面板（单标签页）。
 * 与官方 settings section 同构：`hooks.tabs` 目录 + renderSlot；草稿存于控制器外部
 * store，切换/重渲染不丢。
 */
export function CosmosSettingsSection(props) {
  const { renderSlot, useTabs } = props;
  const t = props.t;
  const rows = typeof useTabs === "function" ? useTabs((value) => value) : [];
  const [activeId, setActiveId] = useState();
  const active = rows.find((row) => row.id === activeId)?.id ?? rows[0]?.id;
  return (
    <div className="dsh-cosmos-settings" data-plugin-anchor="dsh-v-cosmos:settings">
      <h2 className="dsh-cosmos-settings-heading">{tr(t, "cosmos.settings.title", "Cosmos")}</h2>
      <p className="dsh-cosmos-settings-intro">{tr(t, "cosmos.settings.intro", "提案动作按钮：在 Cosmos 整页选中提案后一键把提示词发进该提案工作区的新会话。")}</p>
      {rows.length === 0 ? null : (
        <div className="dsh-cosmos-settings-tabs" role="tablist" aria-label={tr(t, "cosmos.settings.tabsAria", "Cosmos 设置分区")}>
          {rows.map((row) => (
            <button
              key={row.id}
              type="button"
              role="tab"
              className="dsh-cosmos-settings-tab"
              aria-selected={row.id === active}
              data-active={row.id === active ? "true" : undefined}
              onClick={() => setActiveId(row.id)}
            >
              {row.label}
            </button>
          ))}
        </div>
      )}
      {active === undefined || typeof renderSlot !== "function" ? null : (
        <div role="tabpanel" className="dsh-cosmos-settings-panel">
          {renderSlot(SETTINGS_TAB_SLOT, {}, { only: active })}
        </div>
      )}
    </div>
  );
}

/**
 * 「快捷动作」/「星座动作」标签页（同一行交互骨架，variant 换文案与字段）：
 * 按钮行 CRUD（name / prompt / 自动发送 / 可选「提示词在前」/ 可选「执行后跳转」/
 * 可选「前置状态」/ 锁定「新增会话」徽标 / 模型与级别）+ 拖拽与上下移排序 +
 * 暂存-保存/放弃/重置。「执行后跳转」与「前置状态」都是每按钮独立设置（缺省分别为
 * 勾选与「不限」）；「新增会话」为固定语义锁定徽标（方向随 preState 是否为星胚翻转）。
 */
export function CosmosActionsPanel(props) {
  const t = props.t;
  const face = props.face;
  const models = props.models ?? null;
  const variant = props.variant === "constellation" ? "constellation" : "actions";
  const copy = variant === "constellation" ? CONSTELLATION_COPY : ACTION_COPY;
  const state = useSyncExternalStore(face.subscribe, face.getSnapshot);
  const catalogState = useSyncExternalStore(models ? models.subscribe : noopSubscribe, models ? models.getSnapshot : noopSnapshot);
  /* 「发送前编辑」轻量偏好（add-cosmos-native-composer 4.1）：独立 face（navFace 同构），
     与按钮 face 的草稿/保存态正交——开关值来自持久化镜像，改动即时写回（无保存钮）。 */
  const preflight = props.preflight ?? null;
  const preflightState = useSyncExternalStore(
    preflight ? preflight.subscribe : noopSubscribe,
    preflight ? preflight.getSnapshot : noopSnapshot
  );
  /* 拖拽状态：from = 拖起行；overIndex/edge = 悬停行与上/下缘（松手才落位）。 */
  const [drag, setDrag] = useState(null);

  if (!state) return null;
  if (state.status === "loading") return <div className="cs-loading">{tr(t, "cosmos.settings.loading", "正在加载设置…")}</div>;

  const errorText = (key, fallback) => tr(t, "cosmos.settings." + key, fallback);
  const copyText = ([key, fallback]) => errorText(key, fallback);
  const disabled = !state.writable || state.saving;
  const rowError = state.buttonsInvalid ? errorText(state.buttonsInvalidReason, state.buttonsInvalidReason) : null;
  const rowCount = state.buttonsDraft.length;
  const canReorder = rowCount > 1 && !disabled;

  const catalog = catalogState === null ? null : catalogState.catalog;
  const catalogReady = catalog !== null && typeof catalog === "object" && catalog.status === "ready";
  const catalogDegraded = models === null || catalog === null || !catalogReady;
  const { byKey: catalogByKey } = catalogOptions(catalogReady ? catalog.groups : []);

  /* 「发送前编辑」分支取值（净房后的枚举；face 缺失 / 快照形状非法 → 缺省 float，
     rework 星空保持优先）。
     onChange → `preflight.set` 即时写回持久化 + 受控镜像（MUST NOT 走按钮草稿编辑）。 */
  const preflightMode = preflightState !== null
    && typeof preflightState === "object"
    && preflightState.constPreflight === "native"
    ? "native"
    : "float";
  const setPreflight = (mode) => {
    try {
      preflight?.set?.(mode);
    } catch (error) {
      console.error("[dsh-v-cosmos] preflight setting failed:", error);
    }
  };

  const targetOf = (from, index, edge) => {
    if (from < index) return edge === "before" ? index - 1 : index;
    if (from > index) return edge === "before" ? index : index + 1;
    return from;
  };

  /* 「前置状态」下拉（add-cosmos-action-prestate-gate 4.1）：不限（缺省不落键）/
     待创建（星胚）/ 已创建 / 已审核 / 已执行；已存漂移值（手工编辑的非枚举字符串）
     原样回显并标「不可用」，MUST NOT 被静默改写（保存由草稿校验拒绝）。 */
  const preStateField = (button, index) => {
    if (!copy.showPreState) return null;
    const known = button.preState === undefined || PRE_STATES.includes(button.preState);
    const options = [
      <option key="@unlimited" value="">{errorText("preStateUnlimited", "不限")}</option>,
      <option key="proto" value="proto">{errorText("preStateProto", "待创建（星胚）")}</option>,
      <option key="created" value="created">{errorText("preStateCreated", "已创建")}</option>,
      <option key="reviewed" value="reviewed">{errorText("preStateReviewed", "已审核")}</option>,
      <option key="executed" value="executed">{errorText("preStateExecuted", "已执行")}</option>
    ];
    if (!known) {
      options.push(
        <option key={"@drift:" + button.preState} value={button.preState}>
          {button.preState + " · " + errorText("preStateUnavailable", "不可用")}
        </option>
      );
    }
    return (
      <label className="cs-modelField">
        <span className="cs-modelCap">{errorText("preStateLabel", "前置状态")}</span>
        <select
          className="cs-select"
          value={button.preState ?? ""}
          disabled={disabled}
          aria-label={errorText("preStateLabel", "前置状态")}
          onChange={(event) => {
            const next = event.target.value;
            if (next === (button.preState ?? "")) return; // 漂移项被重选：保持原值
            face.editButton(index, "preState", next === "" ? undefined : next);
          }}
        >
          {options}
        </select>
      </label>
    );
  };

  const modelRow = (button, index) => {
    const bound = buttonModelOf(button.model);
    const view = describeButtonModel(bound, catalog);
    const controlDisabled = disabled;
    const options = [<option key="@follow" value="">{errorText("buttonModelFollow", "跟随会话（默认）")}</option>];
    for (const item of view.options) options.push(<option key={item.key} value={item.key}>{item.label}</option>);
    if (view.drift) {
      options.push(
        <option key={"@drift:" + view.key} value={view.key}>
          {catalogReady ? view.key + " · " + errorText("modelUnavailable", "不可用") : view.key}
        </option>
      );
    }
    let levelSelect = null;
    if (view.levelVisible) {
      const levelOptions = view.levelOptions.map((effort) => (
        <option key={effort.id} value={effort.id}>
          {typeof effort.name === "string" && effort.name !== "" ? effort.name : effort.id}
        </option>
      ));
      if (view.levelDrift && catalogReady && view.levelValue !== undefined) {
        levelOptions.push(
          <option key={"@drift:" + view.levelValue} value={view.levelValue}>
            {view.levelValue + " · " + errorText("modelUnavailable", "不可用")}
          </option>
        );
      }
      levelSelect = (
        <label className="cs-modelField">
          <span className="cs-modelCap">{errorText("buttonEffortLabel", "级别")}</span>
          <select
            className="cs-select"
            value={view.levelValue}
            disabled={controlDisabled}
            aria-label={errorText("buttonEffortLabel", "级别")}
            onChange={(event) => {
              const effort = event.target.value;
              if (effort === view.levelValue) return; // 漂移项被重选：空操作
              if (!bound) return;
              face.editButton(index, "model", { provider: bound.provider, model: bound.model, reasoningEffort: effort });
            }}
          >
            {levelOptions}
          </select>
        </label>
      );
    }
    return (
      <div className="cs-modelRow">
        {preStateField(button, index)}
        <label className="cs-modelField">
          <span className="cs-modelCap">{errorText("buttonModelLabel", "模型")}</span>
          <select
            className="cs-select"
            value={view.key}
            disabled={controlDisabled}
            aria-label={errorText("buttonModelLabel", "模型")}
            onChange={(event) => {
              const next = event.target.value;
              if (next === "") {
                face.editButton(index, "model", undefined); // 跟随会话：删除 model 键
                return;
              }
              const picked = catalogByKey.get(next);
              if (picked === undefined) return; // 漂移项被重选：保持原绑定
              const effort = highestEffort(picked.efforts);
              face.editButton(
                index,
                "model",
                effort === undefined
                  ? { provider: picked.provider, model: picked.model }
                  : { provider: picked.provider, model: picked.model, reasoningEffort: effort }
              );
            }}
          >
            {options}
          </select>
        </label>
        {levelSelect}
      </div>
    );
  };

  return (
    <div
      className="dsh-cosmos-settings-panel"
      data-plugin-anchor={copy.anchor}
      data-variant={variant}
    >
      <div className="cs-secHead">
        <label className="cs-label">{copyText(copy.label)}</label>
        {state.buttonsOverridden ? (
          <button className="cs-btn" type="button" disabled={disabled} onClick={() => face.resetButtons()}>
            {errorText("resetButtons", "重置为组合层")}
          </button>
        ) : null}
        <button className="cs-addBtn" type="button" disabled={disabled} onClick={() => face.addButton()}>
          {errorText("addButton", "新增")}
        </button>
      </div>
      <div className="cs-hint">{copyText(copy.hint)}</div>
      {copy.extraHint === null ? null : <div className="cs-hint">{copyText(copy.extraHint)}</div>}
      {/* 「发送前编辑」轻量偏好（add-cosmos-native-composer 4.1/4.2）：仅星座动作页签呈现。
          即时保存的全局分支，MUST NOT 纳入按钮暂存-保存草稿流，也 MUST NOT 随按钮
          writable/saving 禁用——故控件不消费下方 `disabled`。 */}
      {copy.showPreflight ? (
        <div className="cs-constPreflight" data-plugin-anchor="dsh-v-cosmos:settings-const-preflight">
          <div className="cs-constPreflightField">
            <label className="cs-label" htmlFor="cosmos-const-preflight">{errorText("constPreflightLabel", "发送前编辑")}</label>
            <select
              id="cosmos-const-preflight"
              className="cs-select"
              value={preflightMode}
              data-preflight={preflightMode}
              aria-label={errorText("constPreflightAria", "未勾选自动发送时的发送前编辑方式")}
              aria-describedby="cosmos-const-preflight-hint"
              onChange={(event) => {
                const next = event.target.value;
                if (next === preflightMode) return;
                setPreflight(next);
              }}
            >
              <option value="float">{errorText("constPreflightFloat", "浮窗补写（星空保持，缺省）")}</option>
              <option value="native">{errorText("constPreflightNative", "跳转会话页（原生输入区）")}</option>
            </select>
          </div>
          <div className="cs-hint" id="cosmos-const-preflight-hint">
            {errorText("constPreflightHint", "未勾选自动发送的星座按钮：浮窗补写 = 不关 Cosmos 整页，浮窗卡片补写后手动发送（模型选择与语音转写在浮窗内直接可用；@引用/附件等编辑器能力需选「跳转会话页」在原生输入区完成）；跳转会话页 = 关闭整页，落到新会话的原生输入区（预填提示词，原生能力全量可用）。关闭浮窗或按 Esc 只收卡片，草稿保留。")}
          </div>
          <div className="cs-meta">{errorText("constPreflightInstant", "改动立即生效并保存（不随按钮草稿暂存/放弃）")}</div>
        </div>
      ) : null}
      {catalogDegraded ? <div className="cs-modelHint">{errorText("modelCatalogFallback", "模型目录不可用：仅可选择「跟随会话（默认）」；绑定模型的按钮执行时跳过切换。")}</div> : null}
      {rowError ? <div className="cs-error">{rowError}</div> : null}
      {state.buttonsDraft.map((button, index) => {
        const over = drag !== null && drag.overIndex === index ? drag.edge : null;
        /* 星胚行（preState=proto）：锁定方向翻转（不勾选「新增会话」）且「提示词在前」禁用。 */
        const isProto = button.preState === "proto";
        return (
          <div
            className="cs-row"
            key={index}
            onDragOver={drag === null ? undefined : (event) => {
              event.preventDefault();
              const rect = event.currentTarget.getBoundingClientRect();
              const edge = event.clientY - rect.top < rect.height / 2 ? "before" : "after";
              if (drag.overIndex !== index || drag.edge !== edge) setDrag({ from: drag.from, overIndex: index, edge });
            }}
            onDrop={drag === null ? undefined : (event) => {
              event.preventDefault();
              const current = drag;
              setDrag(null);
              if (!current) return;
              const to = targetOf(current.from, index, current.edge);
              if (to !== current.from) face.moveButton(current.from, to);
            }}
            onDragLeave={drag === null ? undefined : () => {
              setDrag((value) => (value !== null && value.overIndex === index ? { ...value, overIndex: null, edge: null } : value));
            }}
          >
            {over === "before" ? <div className="cs-dropLine" data-edge="before" /> : null}
            <div className="cs-rowHead">
              <span
                className="cs-grip"
                title={errorText("gripLabel", "拖动调整顺序")}
                aria-label={errorText("gripLabel", "拖动调整顺序")}
                draggable={canReorder}
                data-disabled={canReorder ? undefined : "true"}
                onDragStart={canReorder ? (event) => {
                  try {
                    event.dataTransfer.setData("text/plain", "");
                  } catch {
                    /* 非可信事件里 dataTransfer 只读：占位失败不阻塞拖起 */
                  }
                  event.dataTransfer.effectAllowed = "move";
                  setDrag({ from: index, overIndex: null, edge: null });
                } : undefined}
                onDragEnd={() => setDrag(null)}
              >
                ⠿
              </span>
              <input
                className="cs-name"
                value={button.name}
                placeholder={errorText("buttonNamePh", "名称（按钮上显示，可中文）")}
                spellCheck={false}
                disabled={disabled}
                onChange={(event) => face.editButton(index, "name", event.target.value)}
              />
              {/* 「提示词在前」只在提案动作行呈现：星座动作无 @引用，故无先后语义；
                  星胚行（preState=proto）消息同样无 @引用 → 控件禁用、保存不写 prepend。 */}
              {copy.showPrepend ? (
                <label
                  className="cs-auto"
                  title={isProto ? copyText(copy.prependTitleProto) : errorText("prependTitle", "勾选：提示词在消息里位于 @提案引用之前")}
                >
                  <input
                    type="checkbox"
                    checked={button.prepend === true}
                    disabled={disabled || isProto}
                    onChange={(event) => {
                      if (isProto) return;
                      face.editButton(index, "prepend", event.target.checked);
                    }}
                  />
                  {errorText("prependLabel", "提示词在前")}
                </label>
              ) : null}
              <label className="cs-auto" title={errorText("autoSendLabel", "自动发送")}>
                <input
                  type="checkbox"
                  checked={button.autoSend === true}
                  disabled={disabled}
                  onChange={(event) => face.editButton(index, "autoSend", event.target.checked)}
                />
                {errorText("autoSendLabel", "自动发送")}
              </label>
              <label
                className="cs-auto cs-locked"
                title={isProto ? copyText(copy.newSessionTitleProto) : copyText(copy.newSessionTitle)}
              >
                {/* 锁定态：禁用勾选框 + 固定徽标（MUST NOT 提供取消路径）。普通行锁定为
                    勾选；星胚行锁定为不勾选（固定发往探索会话、不开新会话）。 */}
                <input type="checkbox" checked={!isProto} disabled readOnly />
                <span className="cs-badge">{errorText("newSessionLabel", "新增会话")}</span>
              </label>
              {/* 每按钮「执行后跳转」（缺省勾选）：仅快捷动作行提供——星座链路恒整页保持。 */}
              {copy.showJump ? (
                <label className="cs-auto" title={errorText("jumpTitle", "每个按钮独立设置：勾选 = 执行成功后关闭 Cosmos 整页、右侧呈现该会话；取消 = 保持 Cosmos 画面（新会话照常创建，勾选自动发送则照常提交首回合）。")}>
                  <input
                    type="checkbox"
                    checked={button.jumpNewSession !== false}
                    disabled={disabled}
                    onChange={(event) => face.editButton(index, "jumpNewSession", event.target.checked)}
                  />
                  {errorText("jumpLabel", "执行后跳转")}
                </label>
              ) : null}
              <button className="cs-move" type="button" title={errorText("moveUp", "上移")} aria-label={errorText("moveUp", "上移")} disabled={!canReorder || index === 0} onClick={() => face.moveButton(index, index - 1)}>
                ↑
              </button>
              <button className="cs-move" type="button" title={errorText("moveDown", "下移")} aria-label={errorText("moveDown", "下移")} disabled={!canReorder || index === rowCount - 1} onClick={() => face.moveButton(index, index + 1)}>
                ↓
              </button>
              <button className="cs-remove" type="button" title={errorText("removeButton", "删除")} disabled={disabled} onClick={() => face.removeButton(index)}>
                ✕
              </button>
            </div>
            {modelRow(button, index)}
            <textarea
              className="cs-prompt"
              rows={Math.min(8, Math.max(2, String(button.prompt ?? "").split("\n").length))}
              value={button.prompt}
              placeholder={errorText("buttonPromptPh", "提示词：随消息进入新会话草稿…")}
              spellCheck={false}
              disabled={disabled}
              onChange={(event) => face.editButton(index, "prompt", event.target.value)}
            />
            {over === "after" ? <div className="cs-dropLine" data-edge="after" /> : null}
          </div>
        );
      })}
      {!state.writable ? <div className="cs-error">{errorText("notWritable", "当前连接不支持持久设置修改")}</div> : null}
      {state.failed ? <div className="cs-error">{errorText("saveFailed", "保存未生效，请重试")}</div> : null}
      <div className="cs-meta">{copyText(copy.count) + rowCount}</div>
      <div className="cs-actions">
        <button className="cs-btn" type="button" disabled={!state.dirty || state.saving} onClick={() => face.discard()}>
          {errorText("discard", "放弃修改")}
        </button>
        <button className="cs-btn cs-btnPrimary" type="button" disabled={!state.dirty || state.invalid || disabled} onClick={() => face.save()}>
          {state.saving ? errorText("saving", "保存中…") : errorText("save", "保存")}
        </button>
      </div>
    </div>
  );
}

/**
 * 「导航」标签页（add-cosmos-zoom-focus-nav 3.1–3.3 / spec「缩放导航设置页签」）：
 *  - 「进入星座视图」数字输入（60–140，步长 5，单位 %）：星座放大到钻取参考尺寸的
 *    X% 时自动进入星座视图；
 *  - 「返回银河视图」数字输入（10–50，步长 5，单位 %）：星座缩小到屏幕短边的 X% 时
 *    自动返回银河视图；
 *  - 「指针聚焦缩放」开关（默认开）：缩放以指针位置为焦点逐步聚焦。
 * **即时生效**（无草稿-保存模式）：改动即 `face.set` → 写持久化偏好 × 已打开整页
 * 引擎 `setTuning` 热更；数字输入用本地文本草稿承接键入（界内即时提交，清空/越界
 * 停留草稿并在失焦时夹取），避免受控输入在键入中途被净房回写打断。
 */
export function CosmosNavPanel(props) {
  const t = props.t;
  const face = props.nav ?? null;
  const state = useSyncExternalStore(face ? face.subscribe : noopSubscribe, face ? face.getSnapshot : noopSnapshot);
  /* 选择/写入失败观测面（fix-cosmos-skin-select-feedback 2.3/D1）：订阅 health store，
     仅当最近失败属于本页签（face: "nav"）时呈现「未生效」提示；成功写入后自动消失。 */
  const health = props.selectHealth ?? null;
  const healthState = useSyncExternalStore(health ? health.subscribe : noopSubscribe, health ? health.getSnapshot : noopSnapshot);
  const failure = selectFailureOf(healthState);
  const notApplied = failure !== null && failure.face === "nav" ? failure : null;
  const dive = state !== null && state !== undefined && Number.isFinite(Number(state.zoomDiveRatio))
    ? Number(state.zoomDiveRatio) : 100;
  const flyOut = state !== null && state !== undefined && Number.isFinite(Number(state.zoomFlyOutRatio))
    ? Number(state.zoomFlyOutRatio) : 25;
  const focus = state !== null && state !== undefined ? state.zoomPointerFocus !== false : true;
  const [diveText, setDiveText] = useState(String(dive));
  const [flyText, setFlyText] = useState(String(flyOut));
  useEffect(() => { setDiveText(String(dive)); }, [dive]);
  useEffect(() => { setFlyText(String(flyOut)); }, [flyOut]);
  const set = (patch) => {
    try {
      face?.set?.(patch);
    } catch (error) {
      console.error("[dsh-v-cosmos] nav setting failed:", error);
    }
  };
  const commit = (key, min, max, raw, current) => {
    const n = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(n)) return;
    const clamped = Math.min(max, Math.max(min, Math.round(n)));
    if (clamped === n && clamped !== current) set({ [key]: clamped });
  };
  const normalize = (key, min, max, raw, current, setText) => {
    const n = Number(raw);
    const value = Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : current;
    setText(String(value));
    if (value !== current) set({ [key]: value });
  };
  /* face 缺失（宿主未注入 nav / 旧宿主）→ 降级占位，不渲染可交互却永不生效的控件（D4）。 */
  if (face === null) {
    return (
      <div className="dsh-cosmos-settings-panel" data-plugin-anchor="dsh-v-cosmos:settings-nav">
        <div className="cs-hint" data-state="face-missing">{tr(t, "cosmos.settings.navUnavailable", "导航设置暂不可用：插件整页未就绪（刷新页面后重试）。")}</div>
      </div>
    );
  }
  return (
    <div className="dsh-cosmos-settings-panel" data-plugin-anchor="dsh-v-cosmos:settings-nav">
      <div className="cs-hint">{tr(t, "cosmos.settings.navHint", "缩放即导航：银河态放大到阈值自动进入星座视图，钻取态缩小到阈值自动返回。两项阈值改动即时生效并持久化，下次打开保持。")}</div>
      {notApplied !== null ? (
        <div className="cs-error" role="status" data-failure-code={notApplied.code}>
          {notAppliedText(t, "cosmos.settings.navNotApplied", "导航设置未生效：插件整页控制器缺失，请重试或刷新页面后重新调整。", notApplied)}
        </div>
      ) : null}
      <div className="cs-nav">
        <div className="cs-navRow">
          <div className="cs-navField">
            <label className="cs-navLabel" htmlFor="cosmos-nav-dive">{tr(t, "cosmos.settings.navDiveLabel", "进入星座视图")}</label>
            <input
              id="cosmos-nav-dive"
              className="cs-navInput"
              type="number"
              inputMode="numeric"
              min={60}
              max={140}
              step={5}
              value={diveText}
              aria-label={tr(t, "cosmos.settings.navDiveAria", "进入星座视图阈值（百分比）")}
              aria-describedby="cosmos-nav-dive-hint"
              onChange={(event) => {
                setDiveText(event.target.value);
                commit("zoomDiveRatio", 60, 140, event.target.value, dive);
              }}
              onBlur={(event) => normalize("zoomDiveRatio", 60, 140, event.target.value, dive, setDiveText)}
            />
            <span className="cs-navUnit" aria-hidden="true">%</span>
          </div>
          <div className="cs-navHint" id="cosmos-nav-dive-hint">{tr(t, "cosmos.settings.navDiveHint", "星座放大到钻取参考尺寸的 X% 时自动进入（界 60–140，越小越早触发）。")}</div>
        </div>
        <div className="cs-navRow">
          <div className="cs-navField">
            <label className="cs-navLabel" htmlFor="cosmos-nav-flyout">{tr(t, "cosmos.settings.navFlyOutLabel", "返回银河视图")}</label>
            <input
              id="cosmos-nav-flyout"
              className="cs-navInput"
              type="number"
              inputMode="numeric"
              min={10}
              max={50}
              step={5}
              value={flyText}
              aria-label={tr(t, "cosmos.settings.navFlyOutAria", "返回银河视图阈值（百分比）")}
              aria-describedby="cosmos-nav-flyout-hint"
              onChange={(event) => {
                setFlyText(event.target.value);
                commit("zoomFlyOutRatio", 10, 50, event.target.value, flyOut);
              }}
              onBlur={(event) => normalize("zoomFlyOutRatio", 10, 50, event.target.value, flyOut, setFlyText)}
            />
            <span className="cs-navUnit" aria-hidden="true">%</span>
          </div>
          <div className="cs-navHint" id="cosmos-nav-flyout-hint">{tr(t, "cosmos.settings.navFlyOutHint", "星座缩小到屏幕短边的 X% 时自动返回（界 10–50，默认约 1/4）。")}</div>
        </div>
        <label className="cs-navToggle">
          <input
            type="checkbox"
            checked={focus}
            aria-label={tr(t, "cosmos.settings.navFocusAria", "指针聚焦缩放开关")}
            onChange={(event) => set({ zoomPointerFocus: event.target.checked })}
          />
          <span className="cs-navToggleText">
            <span className="cs-navLabel">{tr(t, "cosmos.settings.navFocusLabel", "指针聚焦缩放")}</span>
            <span className="cs-navHint">{tr(t, "cosmos.settings.navFocusHint", "缩放以指针位置为焦点逐步聚焦（关闭后回落屏幕中心缩放）。")}</span>
          </span>
        </label>
      </div>
      <div className="cs-meta">{tr(t, "cosmos.settings.navInstant", "改动立即生效并保存")}</div>
    </div>
  );
}

/**
 * 「皮肤」标签页（add-cosmos-skin-themes 3.4 / spec「皮肤选择设置页签」）：
 * 12 张卡片网格（预览色板条 5 色 + 名称 + 血统 + 默认徽标 + 选中态），
 * **单选即时生效**（无草稿-保存模式）：点选 → `face.select(id)` → 写持久化偏好 ×
 * 已打开整页热切（canvas + HUD 令牌同帧换装）。键盘：Tab 聚焦 + Enter/Space 选中 +
 * 方向键在网格内移动焦点（radiogroup 语义，与既有设置页交互形态一致）。
 * fix-cosmos-skin-select-feedback：face 缺失 → 降级占位（不渲染点不动的卡片网格）；
 * 选择未落地（控制器缺失）→ 面板级「未生效」提示 + 原因码，选中环停留原卡片。
 */
export function CosmosSkinPanel(props) {
  const t = props.t;
  const face = props.skins ?? null;
  const state = useSyncExternalStore(face ? face.subscribe : noopSubscribe, face ? face.getSnapshot : noopSnapshot);
  /* 失败观测面（2.1/D1）：订阅 health store，仅当最近失败属于本页签（face: "skin"）
     时呈现提示；成功点选后 store 归零 → 提示自动消失（自愈）。 */
  const health = props.selectHealth ?? null;
  const healthState = useSyncExternalStore(health ? health.subscribe : noopSubscribe, health ? health.getSnapshot : noopSnapshot);
  const failure = selectFailureOf(healthState);
  const notApplied = failure !== null && failure.face === "skin" ? failure : null;
  const current = state !== null && typeof state === "object" && typeof state.skin === "string" ? state.skin : COSMOS_DEFAULT_SKIN;
  const cards = COSMOS_SKINS.map(skinCardOf);
  const select = (id) => {
    try {
      face?.select?.(id);
    } catch (error) {
      console.error("[dsh-v-cosmos] skin select failed:", error);
    }
  };
  const moveFocus = (event) => {
    const key = event.key;
    if (key !== "ArrowRight" && key !== "ArrowDown" && key !== "ArrowLeft" && key !== "ArrowUp") return;
    event.preventDefault();
    const group = event.currentTarget.parentElement;
    if (!group || typeof group.querySelectorAll !== "function") return;
    const buttons = Array.from(group.querySelectorAll("[data-skin]"));
    const index = buttons.indexOf(event.currentTarget);
    if (index < 0) return;
    const step = key === "ArrowRight" || key === "ArrowDown" ? 1 : -1;
    const next = buttons[(index + step + buttons.length) % buttons.length];
    if (next && typeof next.focus === "function") next.focus();
  };
  /* face 缺失（宿主未注入 skins / 旧宿主）→ 降级占位，不渲染可点击却永不生效的卡片（D4）。 */
  if (face === null) {
    return (
      <div className="dsh-cosmos-settings-panel" data-plugin-anchor="dsh-v-cosmos:settings-skins">
        <div className="cs-hint" data-state="face-missing">{tr(t, "cosmos.settings.skinUnavailable", "皮肤选择暂不可用：插件整页未就绪（刷新页面后重试）。")}</div>
      </div>
    );
  }
  return (
    <div className="dsh-cosmos-settings-panel" data-plugin-anchor="dsh-v-cosmos:settings-skins">
      <div className="cs-hint">{tr(t, "cosmos.settings.skinsHint", "点选即生效：已打开的 Cosmos 整页立即换装（canvas 天体与 HUD 镀铬同气），偏好随即持久化，下次打开仍是它。")}</div>
      {notApplied !== null ? (
        <div className="cs-error" role="status" data-failure-code={notApplied.code}>
          {notAppliedText(t, "cosmos.settings.skinNotApplied", "皮肤选择未生效：插件整页控制器缺失，请重试或刷新页面后重新选择。", notApplied)}
        </div>
      ) : null}
      <div
        className="cs-skinGrid"
        role="radiogroup"
        aria-label={tr(t, "cosmos.settings.skinsAria", "皮肤")}
      >
        {cards.map((card) => {
          const selected = card.id === current;
          return (
            <button
              key={card.id}
              type="button"
              role="radio"
              aria-checked={selected ? "true" : "false"}
              aria-label={tr(t, "cosmos.skin." + card.id + ".name", card.name)}
              className="cs-skinCard"
              data-skin={card.id}
              data-selected={selected ? "true" : undefined}
              onClick={() => select(card.id)}
              onKeyDown={moveFocus}
            >
              <span className="cs-skinSwatch" aria-hidden="true">
                {card.swatches.map((color, i) => (
                  <i key={i} style={{ background: color }} />
                ))}
              </span>
              <span className="cs-skinName">{tr(t, "cosmos.skin." + card.id + ".name", card.name)}</span>
              <span className="cs-skinRef">{tr(t, "cosmos.skin." + card.id + ".ref", card.ref)}</span>
              <span className="cs-skinMeta">
                {card.isDefault ? <span className="cs-skinBadge">{tr(t, "cosmos.settings.skinsDefault", "默认")}</span> : null}
                <span className="cs-skinMode">{card.mode === "light" ? tr(t, "cosmos.settings.skinsLight", "亮色") : tr(t, "cosmos.settings.skinsDark", "暗色")}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="cs-skinCount">{tr(t, "cosmos.settings.skinsCountPrefix", "内置皮肤：") + cards.length + " · " + tr(t, "cosmos.settings.skinsInstant", "选中即预览即保存")}</div>
    </div>
  );
}
