/**
 * 设置页「Cosmos」节 UI（add-cosmos-proposal-actions 5.1–5.3 / spec cosmos-button-settings；
 * add-cosmos-constellation-actions 5.2/5.3 新增「星座动作」标签页并复用行交互骨架；
 * add-cosmos-skin-themes 3.4/3.5 新增「皮肤」标签页——卡片网格 + 即时生效；
 * add-cosmos-zoom-focus-nav 3.1–3.3 新增「导航」标签页——缩放阈值与指针聚焦的轻量偏好
 * （两个数字输入 + 一个开关，即时生效，无保存钮）；
 * add-cosmos-layout-tuning 5.1–5.2：「导航」页签更名为「界面」（导航阈值 + 界面尺寸
 * 两组控件，slot/face id 仍为 `nav`）；尺寸组 13 个像素输入经同一 face 即时保存，
 * 整页根容器的 CSS 变量随之热更新。
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
 * add-cosmos-shortcuts 7.1–7.3：新增「快捷键」页签（order 4）——四个全局键位下拉
 * （回到银河 / 移动开关 / 语音开关 / 关闭页面）+ 激活条件说明列 + 默认徽标 + 冲突即时
 * 校验 + 失败「未生效」提示 + Ctrl+Q 风险注记与 Alt+Q 替代；两个动作页签行内新增
 * 「快捷键」下拉（无 / 0–9 / F2/F4/F8/F9），漂移值回显「不可用」、跨域冲突行内错误。
 * step2-cosmos-openspec-path-setting 3.1–3.3：「通用」页签新增「路径」区（CosmosPathsSection，
 * 独立 face：openspecPath / cosmosSpecDir 输入 + CAS 保存 + 非阻断存在性警示 +
 * 端点不可达仅本区禁用降级）。
 * add-cosmos-figure-line-alpha 3.3：「通用」页签「星座装饰」组新增图样连线亮度滑杆
 * （range 5–100 step 5，独立 face `patLineDim`，拖拽即提交 + 数值回显）。
 *
 * 由 client.jsx 注册为 `settings.section`（id `v-cosmos`，order 6——「技能管理」之后）+
 * 六条标签页「通用」（order -1）/「快捷动作」（order 0）/
 * 「星座动作」（order 1）/「皮肤」（order 2）/「界面」（order 3）/「快捷键」（order 4）。
 * 视觉参数照 skill-links 设置节（官方 settings section 形状、`--dsw-alias-*` token），
 * 类名统一 `cs-` 前缀避免与其它插件样式互踩。
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
import { COSMOS_LAUNCH_MODES } from "./settings.mjs";
import {
  SHORTCUT_ALTERNATIVE_OF,
  SHORTCUT_BUTTON_KEYS,
  SHORTCUT_DEFAULTS,
  SHORTCUT_GLOBAL_KEYS,
  SHORTCUT_RISKY_KEYS,
  SHORTCUT_UI_ORDER,
  shortcutConflictOnFieldOf,
  shortcutConflictOnRowOf,
  shortcutConflictOf,
  shortcutLabelOf,
  shortcutsOf
} from "./shortcuts.mjs";

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
  /* 每按钮「直达移除（免提示词）」（add-cosmos-embryo-dismiss-button 5.1）：仅快捷动作行
     提供（星胚直执行需要提案选中上下文与 proto 前置状态，星座按钮两者皆无）。 */
  showEmbryoDismiss: true,
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
  showEmbryoDismiss: false,
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

/* ── 快捷键文案/冲突定位辅助（add-cosmos-shortcuts 7.1–7.3） ── */

/** 全局键位字段 → 词典键（「快捷键」页签行标签；行内错误定位提示复用）。 */
const SHORTCUT_FIELD_LABEL_KEYS = Object.freeze({
  closePage: "shortcutClosePage",
  goHome: "shortcutGoHome",
  togglePan: "shortcutTogglePan",
  voiceToggle: "shortcutVoiceToggle"
});

/** 全局键位字段 → 兜底中文标签（词典未登记时直出可读文案）。 */
const SHORTCUT_FIELD_LABELS = Object.freeze({
  closePage: "关闭页面",
  goHome: "回到银河",
  togglePan: "移动开关",
  voiceToggle: "语音开关（浮窗）"
});

/**
 * 冲突对侧的可读名（行内错误「与该键重复」用）：
 *  - `self` = 当前定位方（全局 {kind:"global", field} 或按钮 {kind:"button", list, index}）；
 *  - 对侧为全局键 → 行标签；对侧为按钮 → 按钮名（空名回落 `#行号`）。
 */
function conflictOtherLabelOf(t, conflict, self) {
  const sides = conflict !== null && typeof conflict === "object" && Array.isArray(conflict.sides) ? conflict.sides : [];
  const other = sides.find((side) => {
    if (side === null || typeof side !== "object") return false;
    if (self.kind === "global") return !(side.kind === "global" && side.field === self.field);
    return !(side.kind === "button" && side.list === self.list && side.index === self.index);
  });
  if (other === undefined) return "";
  if (other.kind === "global") {
    return tr(t, "cosmos.settings." + SHORTCUT_FIELD_LABEL_KEYS[other.field], SHORTCUT_FIELD_LABELS[other.field] ?? other.field);
  }
  const name = typeof other.name === "string" && other.name ? other.name : "#" + (Number(other.index) + 1);
  return name;
}

/** 冲突行内文案（词典模板 + 对侧名；模板缺键时回落中文基线）。 */
function conflictTextOf(t, conflict, self) {
  const template = tr(t, "cosmos.settings.shortcutConflictRow", "冲突：该键与「{other}」重复");
  return template.replace("{other}", conflictOtherLabelOf(t, conflict, self));
}

/** 全局快捷键净房投影（面板态：非对象/非法 → 四键缺省）。 */
function shortcutsStateOf(snapshot) {
  return shortcutsOf(snapshot);
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
.cs-rowHead{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.cs-grip{flex:none;align-self:stretch;display:inline-flex;align-items:center;justify-content:center;width:14px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:18px;cursor:grab;-webkit-user-select:none;user-select:none}
.cs-grip:hover{color:var(--dsw-alias-label-secondary)}
.cs-grip[data-disabled=true]{opacity:.45;cursor:not-allowed}
.cs-name{flex:1 1 160px;min-width:120px;padding:3px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:var(--dsw-font-markdown-code-block-small,12px ui-monospace,SFMono-Regular,Menlo,monospace);outline:none}
.cs-name:focus{border-color:var(--dsw-alias-border-inverted)}
.cs-auto{flex:none;display:inline-flex;align-items:center;gap:5px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:16px;white-space:nowrap;cursor:pointer;-webkit-user-select:none;user-select:none}
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
/* ── 「曲率引擎」页签（two-add-cosmos-proposal-warp 5.2）：动作条行多选 + 规则下拉。
   与动作页签行骨架同族：行容器 = 浅描边圆角、勾选行提亮；徽标复用「cs-badge」。 ── */
.cs-warpRows{display:flex;flex-direction:column;gap:4px}
.cs-warpRow{display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px}
.cs-warpRow[data-checked=true]{border-color:var(--dsw-alias-border-inverted);background:var(--dsw-alias-interactive-bg-hover)}
.cs-warpName{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-size:13px}
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
/* ── 导航页签（add-cosmos-zoom-focus-nav 3.1；add-cosmos-zoom-ruler 3.2 删阈值输入）：
      仅「指针聚焦缩放」开关。即时生效（无草稿-保存）；开关触控目标 ≥44px，label + aria 可达。 ── */
.cs-nav{display:flex;flex-direction:column;gap:10px;margin-top:2px}
.cs-navLabel{flex:1;min-width:0;font-size:13px;line-height:18px;color:var(--dsw-alias-label-primary)}
.cs-navHint{font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.cs-navToggle{display:flex;align-items:flex-start;gap:8px;box-sizing:border-box;min-height:44px;padding:8px 9px;
  border:1px solid var(--dsw-alias-border-l2);border-radius:10px;cursor:pointer}
.cs-navToggle:hover{border-color:var(--dsw-alias-border-inverted)}
.cs-navToggle:focus-within{outline:2px solid var(--dsw-alias-border-inverted);outline-offset:2px}
.cs-navToggle input{margin:2px 0 0;cursor:pointer;accent-color:var(--dsw-alias-border-inverted)}
.cs-navToggleText{display:flex;flex-direction:column;gap:2px;min-width:0}
/* ── 「界面尺寸」组（add-cosmos-layout-tuning 5.2；add-cosmos-template-reassign 返工扩第
      13 键 wsToolSize）：「界面」页签内 13 个像素值输入
      （面板宽/高、按钮尺寸、动作条、搜索框、星座标题字号）。与导航组同款即时生效，
      数字输入触控目标 ≥44px，label[htmlFor] 原生可达；高度类键标注「0 = 自适应」。 ── */
.cs-sizeGroup{display:flex;flex-direction:column;gap:6px;margin-top:8px;padding-top:10px;
  border-top:1px solid var(--dsw-alias-border-l2)}
.cs-sizeTitle{font-size:13px;font-weight:600;line-height:18px;color:var(--dsw-alias-label-primary)}
.cs-sizeHint{font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.cs-sizeGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:4px 14px}
.cs-sizeRow{display:flex;align-items:center;gap:8px;min-height:44px}
.cs-sizeLabel{flex:1;min-width:0;font-size:13px;line-height:18px;color:var(--dsw-alias-label-primary);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cs-sizeInput{width:72px;box-sizing:border-box;min-height:44px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l2);
  border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;
  line-height:18px;text-align:right;outline:none}
.cs-sizeInput:focus{border-color:var(--dsw-alias-border-inverted)}
.cs-sizeUnit{flex:none;width:20px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.cs-sizeAuto{flex:none;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
/* ── 「发送前编辑」轻量偏好（add-cosmos-native-composer 4.1）：星座动作页签顶部的
   即时保存开关（独立 face——不随按钮草稿保存/放弃，不受按钮 writable/saving 门控）。
   控件语言随既有行内控件（label + cs-select），触控目标 ≥44px。 ── */
.cs-constPreflight{display:flex;flex-direction:column;gap:4px;margin-top:2px;padding:8px 9px;
  border:1px solid var(--dsw-alias-border-l2);border-radius:10px}
.cs-constPreflightField{display:flex;align-items:center;gap:8px;min-height:44px}
.cs-constPreflightField .cs-label{flex:1;min-width:0;font-size:13px;line-height:18px;color:var(--dsw-alias-label-primary)}
/* ── 快捷键页签（add-cosmos-shortcuts 7.1）：四行 = 标签 + 激活条件说明 + 键位下拉 +
      默认徽标 + 冲突/风险注记。即时保存（无草稿-保存），触控目标 ≥44px。 ── */
.cs-shortcuts{display:flex;flex-direction:column;gap:8px;margin-top:2px}
.cs-shortcutRow{display:flex;flex-direction:column;gap:2px;padding:8px 9px;
  border:1px solid var(--dsw-alias-border-l2);border-radius:10px}
.cs-shortcutField{display:flex;align-items:center;gap:8px;min-height:44px}
.cs-shortcutLabel{flex:1;min-width:0;font-size:13px;line-height:18px;color:var(--dsw-alias-label-primary)}
.cs-shortcutHint{font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.cs-shortcutRisk{font-size:12px;line-height:16px;color:var(--dsw-alias-state-warning-primary)}
.cs-shortcutBadge{flex:none;padding:0 6px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover-solid);
  font-size:10px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.cs-shortcutCount{font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary)}
/* 行内快捷键的生效条件注（带前置状态的按钮）：小字、不换行、可悬停看完整说明 */
.cs-shortcutRowNote{flex:none;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
/* ── 「通用」页签（add-cosmos-rightbar-dock）：打开方式单选（内嵌整页 / 分栏）——
      即时保存；两档在 web 与桌面形态同效，无形态禁用或降级文案。 ── */
.cs-launch{display:flex;flex-direction:column;gap:2px;margin:2px 0 0;padding:8px 10px 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px}
.cs-launchLegend{padding:0 4px;font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.cs-launchRow{display:flex;align-items:flex-start;gap:8px;min-height:44px;padding:6px 0;cursor:pointer;color:var(--dsw-alias-label-primary);font-size:13px;line-height:18px}
.cs-launchRow input{margin:2px 0 0;cursor:pointer;accent-color:var(--dsw-alias-border-inverted)}
.cs-launchText{display:flex;flex-direction:column;gap:2px;min-width:0}
.cs-launchHint{font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
/* ── 「通用」页签·星座装饰组·图样连线亮度滑杆（add-cosmos-figure-line-alpha 3.3/D4）：
      仓库首个 range 控件——行式布局（label + 滑杆 + 数值回显），拖拽即提交（无草稿态）；
      行高 ≥44px 保触控目标，数值列等宽防回显抖动。 ── */
.cs-rangeRow{display:flex;align-items:center;gap:10px;box-sizing:border-box;min-height:44px;padding:6px 0;
  color:var(--dsw-alias-label-primary);font-size:13px;line-height:18px}
.cs-rangeLabel{flex:none;min-width:0;max-width:42%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cs-rangeInput{flex:1;min-width:96px;height:44px;margin:0;cursor:pointer;accent-color:var(--dsw-alias-border-inverted)}
.cs-rangeInput:focus-visible{outline:2px solid var(--dsw-alias-border-inverted);outline-offset:2px}
.cs-rangeValue{flex:none;width:44px;text-align:right;font-size:12px;line-height:16px;
  color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
/* ── 「通用」页签·路径区（step2-cosmos-openspec-path-setting 3.1–3.3）：openspecPath /
      cosmosSpecDir 两个文本输入 + 保存（CAS 草稿-保存模式）；端点不可达整组禁用 +
      提示（不影响页面其余设置）；存在性警示为非阻断提示。触控目标 ≥44px。 ── */
.cs-paths{display:flex;flex-direction:column;gap:6px;margin:2px 0 0;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px}
.cs-paths[data-unavailable=true]{opacity:.75}
.cs-pathsLegend{padding:0 4px;font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.cs-pathsField{display:flex;flex-direction:column;gap:2px}
.cs-pathsLabel{font-size:13px;line-height:18px;color:var(--dsw-alias-label-primary)}
.cs-pathsInput{box-sizing:border-box;min-height:44px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:var(--dsw-font-markdown-code-block-small,12px ui-monospace,SFMono-Regular,Menlo,monospace);outline:none}
.cs-pathsInput:focus{border-color:var(--dsw-alias-border-inverted)}
.cs-pathsInput:disabled{opacity:.55;cursor:not-allowed}
.cs-pathsHint{font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.cs-pathsWarn{font-size:12px;line-height:16px;color:var(--dsw-alias-state-warning-primary)}
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

/** 「打开方式」两档（值 / 标签词典键 / 行内说明词典键；顺序 = 呈现顺序）。 */
const LAUNCH_MODE_FIELDS = Object.freeze([
  {
    value: "embedded",
    labelKey: "launchModeEmbedded",
    fallback: "内嵌整页（默认）",
    hintKey: "launchModeEmbeddedHint",
    hintFallback: "在 DSH 主窗口内以整页覆盖层打开（与变更前一致）。"
  },
  {
    value: "dock",
    labelKey: "launchModeDock",
    fallback: "分栏（右栏停靠）",
    hintKey: "launchModeDockHint",
    hintFallback: "在 DSH 右栏打开 Cosmos 停靠页，与左侧会话并排；动作与跳转在同一窗口内完成，web 与桌面形态一致。"
  }
]);

/**
 * 「通用」页签·路径区（step2-cosmos-openspec-path-setting 3.1–3.3 / spec
 * cosmos-path-setting「设置页路径区」）：
 *  - `openspecPath` 与 `cosmosSpecDir` 两个文本输入 + 保存（CAS 草稿-保存模式）；
 *    页面加载时以 `GET /config` 快照回显当前值（face 快照的 effective 值）；
 *  - 保存：face.save() → 整节 CAS 写入；409/失败 → 「保存未生效，请重试」（草稿保留）；
 *  - 目录存在性警示（非阻断）：face.warnings 逐条呈现「目录不存在（仍已保存）」+
 *    `path.resolve` 归一后的实际形态（检查器由注入提供，web 侧缺席 = 无警示）；
 *  - 端点不可达降级（3.3）：writable false / loading → 输入禁用 + 提示，
 *    MUST NOT 影响页面其余设置（launch 单选不受 paths face 牵连）；
 *  - face 缺失（旧宿主未注入）→ 降级占位（与其它页签同纪律，不渲染可输入却永不生效的控件）。
 * @param {{t: Function, paths?: object|null}} props
 */
export function CosmosPathsSection(props) {
  const t = props.t;
  const face = props.paths ?? null;
  const state = useSyncExternalStore(face ? face.subscribe : noopSubscribe, face ? face.getSnapshot : noopSnapshot);
  if (face === null) {
    return (
      <div data-plugin-anchor="dsh-v-cosmos:settings-general-paths">
        <div className="cs-hint" data-state="face-missing">{tr(t, "cosmos.settings.pathsUnavailable", "路径设置暂不可用：插件页面未就绪（刷新页面后重试）。")}</div>
      </div>
    );
  }
  const loading = state?.status === "loading";
  const writable = state?.writable === true;
  const disabled = loading || !writable || state?.saving === true;
  const dirty = state?.dirty === true;
  const failed = state?.failed === true;
  const warnings = Array.isArray(state?.warnings) ? state.warnings : [];
  return (
    <fieldset
      className="cs-paths"
      data-plugin-anchor="dsh-v-cosmos:settings-general-paths"
      data-unavailable={!writable && !loading ? "true" : undefined}
      disabled={disabled}
    >
      <legend className="cs-pathsLegend">{tr(t, "cosmos.settings.pathsLabel", "路径")}</legend>
      <div className="cs-hint">{tr(t, "cosmos.settings.pathsHint", "openspec 路径令牌 OPENSPEC_PATH 的解析值与 cosmos-spec 技能目录：保存后写入本机共享配置并即时生效（无需重启插件或会话）。未配置留空。")}</div>
      {loading ? <div className="cs-loading">{tr(t, "cosmos.settings.pathsLoading", "正在加载路径设置…")}</div> : null}
      <div className="cs-pathsField">
        <label className="cs-pathsLabel" htmlFor="cosmos-paths-openspec">{tr(t, "cosmos.settings.pathsOpenspecLabel", "openspecPath（openspec 技能仓库根）")}</label>
        <input
          id="cosmos-paths-openspec"
          className="cs-pathsInput"
          type="text"
          value={state?.openspecPath ?? ""}
          placeholder={tr(t, "cosmos.settings.pathsOpenspecPh", "如 C:\\openspec 或 ~/openspec（留空 = 未配置）")}
          spellCheck={false}
          disabled={disabled}
          onChange={(event) => face.edit("openspecPath", event.target.value)}
        />
        <div className="cs-pathsHint">{tr(t, "cosmos.settings.pathsOpenspecHint", "路径令牌 OPENSPEC_PATH 的解析值：渲染技能引用时以该目录为 openspec 根。")}</div>
      </div>
      <div className="cs-pathsField">
        <label className="cs-pathsLabel" htmlFor="cosmos-paths-cosmos-spec">{tr(t, "cosmos.settings.pathsCosmosSpecLabel", "cosmosSpecDir（cosmos-spec 目录）")}</label>
        <input
          id="cosmos-paths-cosmos-spec"
          className="cs-pathsInput"
          type="text"
          value={state?.cosmosSpecDir ?? ""}
          placeholder={tr(t, "cosmos.settings.pathsCosmosSpecPh", "如 C:\\cosmos-spec（留空 = 未配置）")}
          spellCheck={false}
          disabled={disabled}
          onChange={(event) => face.edit("cosmosSpecDir", event.target.value)}
        />
        <div className="cs-pathsHint">{tr(t, "cosmos.settings.pathsCosmosSpecHint", "cosmos-spec canonical 目录：技能渲染的扫描根（技能提供方消费）。")}</div>
      </div>
      {warnings.map((warning, index) => (
        <div className="cs-pathsWarn" key={warning.key + ":" + index} data-path-warning={warning.key} role="status">
          {tr(t, "cosmos.settings.pathsDirMissing", "目录不存在（仍已保存，可先配后建）：") + warning.resolved}
        </div>
      ))}
      {!writable && !loading ? (
        <div className="cs-error" data-paths-unavailable="true" role="status">
          {tr(t, "cosmos.settings.pathsNotWritable", "路径设置在此连接不可用（插件宿主半区未就绪或未升级）：页面其余设置不受影响。")}
        </div>
      ) : null}
      {failed ? <div className="cs-error">{tr(t, "cosmos.settings.pathsSaveFailed", "保存未生效（可能已被他端修改），请重试")}</div> : null}
      <div className="cs-actions">
        <button className="cs-btn" type="button" disabled={!dirty || state?.saving === true} onClick={() => face.discard()}>
          {tr(t, "cosmos.settings.pathsDiscard", "放弃修改")}
        </button>
        <button
          className="cs-btn cs-btnPrimary"
          type="button"
          disabled={!dirty || disabled}
          onClick={() => {
            try {
              void face.save();
            } catch (error) {
              console.error("[dsh-v-cosmos] paths setting failed:", error);
            }
          }}
        >
          {state?.saving === true ? tr(t, "cosmos.settings.pathsSaving", "保存中…") : tr(t, "cosmos.settings.pathsSave", "保存")}
        </button>
      </div>
    </fieldset>
  );
}

/**
 * 「通用」标签页（add-cosmos-rightbar-dock / spec「设置 v10 与历史值迁移」；
 * step2-cosmos-openspec-path-setting 3.1 追加「路径」区；
 * add-cosmos-template-name-toggle 1.2 追加「星座模板名显示」开关行）：
 *  - 「打开方式」单选：内嵌整页（缺省）/ 分栏（右栏停靠）——**即时保存**（无草稿-保存
 *    模式），改动经 face.set → `applyLaunchMode`（净房持久化 + 受控镜像）；跨窗口即时
 *    生效由同源 localStorage + `storage` 事件桥承接（入口按钮点击时现读配置）。
 *  - 「星座模板名显示」复选框（缺省关）：独立 face（`templateNames`），改动立即持久化 +
 *    已打开整页 `setTuning` 热更（同一「即时保存、无暂存钮」纪律，与 launchMode 同款）；
 *    装饰用途提示走 title + 行内 hint 双通道。
 *  - 「图样连线亮度」滑杆（5–100，step 5；缺省 50）：独立 face（`patLineDim`），拖拽即
 *    提交（无草稿态）、数值回显 + aria；与模板名开关同组「星座装饰」（add-cosmos-figure-
 *    line-alpha 3.3/D4）。仓库首个 range 控件——行式样式类 `cs-range*`（cs-sizeRow 同族）。
 *  - 两档在 web 与桌面形态同效，无任何形态禁用或降级说明（独立窗口的协议判据随能力退役）。
 *  - face 缺失（旧宿主未注入）→ 降级占位（不渲染可点却永不生效的控件，与其它页签同纪律）。
 * @param {{t: Function, launch?: object, paths?: object|null, templateNames?: object|null, patLineDim?: object|null, worksFace?: object|null}} props
 */
export function CosmosGeneralPanel(props) {
  const t = props.t;
  const face = props.launch ?? null;
  const snapshot = useSyncExternalStore(
    face ? face.subscribe : noopSubscribe,
    face ? face.getSnapshot : noopSnapshot
  );
  /* 星座模板名显示 face（add-cosmos-template-name-toggle 1.2）：独立受控镜像（与
     launchMode 同款受控读面）；hook 必须先于下方 face===null 早退注册（Hook 顺序恒定）。 */
  const namesFace = props.templateNames ?? null;
  const namesSnapshot = useSyncExternalStore(
    namesFace ? namesFace.subscribe : noopSubscribe,
    namesFace ? namesFace.getSnapshot : noopSnapshot
  );
  const templateNamesOn = namesSnapshot !== null && typeof namesSnapshot === "object"
    ? namesSnapshot.templateNames === true
    : false;
  /* 图样连线亮度 face（add-cosmos-figure-line-alpha 3.3）：独立受控镜像（与 templateNames
     同款读面）；快照缺键/非法 → 回显缺省 50（净房兜底，不抛错）。 */
  const lineFace = props.patLineDim ?? null;
  const lineSnapshot = useSyncExternalStore(
    lineFace ? lineFace.subscribe : noopSubscribe,
    lineFace ? lineFace.getSnapshot : noopSnapshot
  );
  const patLineDimValue = lineSnapshot !== null && typeof lineSnapshot === "object" && Number.isFinite(Number(lineSnapshot.patLineDim))
    ? Math.min(100, Math.max(5, Math.round(Number(lineSnapshot.patLineDim))))
    : 50;
  /* 星场呈现 face（p2-add-cosmos-works-face 1.2）：独立受控镜像（与 templateNames 同款
     即时偏好）；快照缺键/非法 → 回显缺省 true（净房兜底，不抛错）。 */
  const worksFace = props.worksFace ?? null;
  const worksSnapshot = useSyncExternalStore(
    worksFace ? worksFace.subscribe : noopSubscribe,
    worksFace ? worksFace.getSnapshot : noopSnapshot
  );
  const worksContoursOn = worksSnapshot !== null && typeof worksSnapshot === "object"
    ? worksSnapshot.worksContours !== false
    : true;
  const worksAsciiOn = worksSnapshot !== null && typeof worksSnapshot === "object"
    ? worksSnapshot.worksAscii !== false
    : true;
  const current = snapshot !== null && typeof snapshot === "object" && COSMOS_LAUNCH_MODES.includes(snapshot.launchMode)
    ? snapshot.launchMode
    : "embedded";
  const set = (mode) => {
    try {
      face?.set?.(mode);
    } catch (error) {
      console.error("[dsh-v-cosmos] launch mode setting failed:", error);
    }
  };
  const setTemplateNames = (enabled) => {
    try {
      namesFace?.set?.(enabled === true);
    } catch (error) {
      console.error("[dsh-v-cosmos] template names setting failed:", error);
    }
  };
  const templateNamesHint = tr(
    t,
    "cosmos.settings.templateNamesHint",
    "在银河星座标签与钻取标牌上追加该星座命中模板的中文名（如「猎户座」）；纯装饰文本，不影响布局与交互。"
  );
  const setPatLineDim = (value) => {
    try {
      lineFace?.set?.(value);
    } catch (error) {
      console.error("[dsh-v-cosmos] pattern line brightness setting failed:", error);
    }
  };
  const patLineDimHint = tr(
    t,
    "cosmos.settings.patLineDimHint",
    "调低会弱化星座图样的辨识度（连线更淡、空槽装饰点同比变暗）；纯装饰层，不影响恒星、行星与拾取。"
  );
  /** 星场两开关写入（p2 1.2）：face.set(patch) 唯一落点（控制器净房持久化 + 引擎热更）。 */
  const setWorksOption = (key, enabled) => {
    try {
      worksFace?.set?.({ [key]: enabled === true });
    } catch (error) {
      console.error("[dsh-v-cosmos] works face setting failed:", error);
    }
  };
  const worksContoursHint = tr(
    t,
    "cosmos.settings.worksContoursHint",
    "在星场叠加合成势场的等势线（多焦点邻近处呈鞍部融合）；关闭后立即停绘，不影响焦点与拾取。"
  );
  const worksAsciiHint = tr(
    t,
    "cosmos.settings.worksAsciiHint",
    "星场背景的 ASCII 字符底纹（势阱处字符渐密 + 慢掷数据脉冲）；仅隐约标注感，关闭零残留。"
  );
  if (face === null) {
    return (
      <div className="dsh-cosmos-settings-panel" data-plugin-anchor="dsh-v-cosmos:settings-general">
        <div className="cs-hint" data-state="face-missing">{tr(t, "cosmos.settings.generalUnavailable", "通用设置暂不可用：插件整页未就绪（刷新页面后重试）。")}</div>
      </div>
    );
  }
  return (
    <div className="dsh-cosmos-settings-panel" data-plugin-anchor="dsh-v-cosmos:settings-general">
      <div className="cs-hint">{tr(t, "cosmos.settings.launchModeHint", "内嵌整页 = 在当前 DSH 窗口内以整页覆盖层打开（现状）；分栏 = 在 DSH 右栏打开 Cosmos 停靠页，与左侧会话并排，两边可同时操作且天然联动（存量「独立窗口」配置自动迁移为分栏）。")}</div>
      <fieldset className="cs-launch">
        <legend className="cs-launchLegend">{tr(t, "cosmos.settings.launchModeLabel", "打开方式")}</legend>
        {LAUNCH_MODE_FIELDS.map((field) => (
          <label key={field.value} className="cs-launchRow">
            <input
              type="radio"
              name="cosmos-launch-mode"
              value={field.value}
              checked={current === field.value}
              onChange={() => set(field.value)}
            />
            <span className="cs-launchText">
              <span>{tr(t, "cosmos.settings." + field.labelKey, field.fallback)}</span>
              <span className="cs-launchHint">{tr(t, "cosmos.settings." + field.hintKey, field.hintFallback)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {/* 星座装饰组（add-cosmos-template-name-toggle 1.2/D1/D3 + add-cosmos-figure-line-alpha
          3.3/D4）：图例「星座装饰」下两行——模板名开关（独立 face + 即时保存；title 与行内
          hint 双通道说明「纯装饰」用途）与图样连线亮度滑杆（range 5–100 step 5，拖拽即提交、
          数值回显）。face 缺席（旧宿主未注入）→ 对应行不渲染（同其它页签纪律：不渲染可点
          却永不生效的控件）；两组 face 都缺席时整组不渲染。 */}
      {namesFace !== null || lineFace !== null ? (
        <fieldset className="cs-launch">
          <legend className="cs-launchLegend">{tr(t, "cosmos.settings.patLineDimLegend", "星座装饰")}</legend>
          {namesFace !== null ? (
            <label className="cs-launchRow" title={templateNamesHint} data-setting="templateNames">
              <input
                type="checkbox"
                checked={templateNamesOn}
                aria-label={tr(t, "cosmos.settings.templateNamesAria", "星座模板名显示开关")}
                onChange={(event) => setTemplateNames(event.target.checked)}
              />
              <span className="cs-launchText">
                <span>{tr(t, "cosmos.settings.templateNamesLabel", "星座模板名显示")}</span>
                <span className="cs-launchHint">{templateNamesHint}</span>
              </span>
            </label>
          ) : null}
          {lineFace !== null ? (
            <>
              <div className="cs-rangeRow" title={patLineDimHint} data-setting="patLineDim">
                <span className="cs-rangeLabel">{tr(t, "cosmos.settings.patLineDimLabel", "图样连线亮度")}</span>
                <input
                  className="cs-rangeInput"
                  type="range"
                  min={5}
                  max={100}
                  step={5}
                  value={patLineDimValue}
                  aria-label={tr(t, "cosmos.settings.patLineDimAria", "图样连线亮度百分比")}
                  onChange={(event) => setPatLineDim(Number(event.target.value))}
                />
                <span className="cs-rangeValue">{patLineDimValue}%</span>
              </div>
              <span className="cs-launchHint">{patLineDimHint}</span>
            </>
          ) : null}
        </fieldset>
      ) : null}
      {/* 星场组（p2-add-cosmos-works-face 1.2）：两枚「轻量即时偏好」布尔开关——等势线 /
          ASCII 底纹，缺省均开；face 缺席（旧宿主未注入）→ 整组不渲染（同其它页签纪律）。 */}
      {worksFace !== null ? (
        <fieldset className="cs-launch" data-plugin-anchor="dsh-v-cosmos:settings-works-face">
          <legend className="cs-launchLegend">{tr(t, "cosmos.settings.worksFaceLegend", "星场")}</legend>
          <label className="cs-launchRow" title={worksContoursHint} data-setting="worksContours">
            <input
              type="checkbox"
              checked={worksContoursOn}
              aria-label={tr(t, "cosmos.settings.worksContoursAria", "星场等势线开关")}
              onChange={(event) => setWorksOption("worksContours", event.target.checked)}
            />
            <span className="cs-launchText">
              <span>{tr(t, "cosmos.settings.worksContoursLabel", "等势线")}</span>
              <span className="cs-launchHint">{worksContoursHint}</span>
            </span>
          </label>
          <label className="cs-launchRow" title={worksAsciiHint} data-setting="worksAscii">
            <input
              type="checkbox"
              checked={worksAsciiOn}
              aria-label={tr(t, "cosmos.settings.worksAsciiAria", "星场 ASCII 底纹开关")}
              onChange={(event) => setWorksOption("worksAscii", event.target.checked)}
            />
            <span className="cs-launchText">
              <span>{tr(t, "cosmos.settings.worksAsciiLabel", "ASCII 底纹")}</span>
              <span className="cs-launchHint">{worksAsciiHint}</span>
            </span>
          </label>
          <div className="cs-meta">{tr(t, "cosmos.settings.worksFaceInstant", "改动立即生效并保存（星场下一帧即跟随）")}</div>
        </fieldset>
      ) : null}
      <div className="cs-meta">{tr(t, "cosmos.settings.launchModeInstant", "改动立即生效并保存")}</div>
      {/* 路径区（step2-cosmos-openspec-path-setting 3.1）：独立 face，端点不可达时
          仅本区禁用降级，MUST NOT 牵连 launch 单选（launchMode 走 localStorage 面）。 */}
      <CosmosPathsSection t={t} paths={props.paths ?? null} />
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
  /* 跨域冲突数据面（add-cosmos-shortcuts 7.2/7.3）：全局四键（受控镜像）+ 两列表当前
     草稿（模块 store，任一控制器 publish 即同步）→ 行内错误定位 + 面板级提示 + 保存门。
     hooks 必须先于下方「无状态/加载中」早退注册（Hook 顺序恒定）。 */
  const shortcutsFace = props.shortcuts ?? null;
  const shortcutsSnapshot = useSyncExternalStore(
    shortcutsFace ? shortcutsFace.subscribe : noopSubscribe,
    shortcutsFace ? shortcutsFace.getSnapshot : noopSnapshot
  );
  const draftsFace = props.drafts ?? null;
  const draftsSnapshot = useSyncExternalStore(
    draftsFace ? draftsFace.subscribe : noopSubscribe,
    draftsFace ? draftsFace.getSnapshot : noopSnapshot
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

  const draftListName = variant === "constellation" ? "constellations" : "proposals";
  const conflict = shortcutConflictOf(shortcutsStateOf(shortcutsSnapshot), {
    proposals: Array.isArray(draftsSnapshot?.proposals) ? draftsSnapshot.proposals : [],
    constellations: Array.isArray(draftsSnapshot?.constellations) ? draftsSnapshot.constellations : []
  });
  const conflictBlocked = conflict !== null;

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

  /* 「快捷键」行内下拉（add-cosmos-shortcuts 7.2）：候选 = 无 + 按钮键域枚举（与键位池
     常量同源）；漂移值（手工写入的池外字符串）原样回显「不可用」、MUST NOT 被静默改写
     （保存由草稿校验拒绝）；跨域冲突在该行呈现行内错误（对侧可读名定位）。
     真机反馈修订：悬停提示写明「需保存」与「前置状态门控」——带 preState 的按钮只在选中
     提案生命周期匹配（且空闲）时渲染，按键与点击共用同一谓词（隐藏按钮无可触发通道）。 */
  const shortcutField = (button, index) => {
    const raw = typeof button.shortcut === "string" ? button.shortcut.trim() : "";
    const known = raw === "" || SHORTCUT_BUTTON_KEYS.includes(raw);
    const preStateLabel = typeof button.preState === "string" && PRE_STATES.includes(button.preState)
      ? errorText("preState" + button.preState.charAt(0).toUpperCase() + button.preState.slice(1), button.preState)
      : "";
    const title = errorText("buttonShortcutSaveHint", "选择后需点击下方「保存」才生效")
      + (preStateLabel
        ? " · " + errorText("buttonShortcutPreStateHint", "仅当选中提案的前置状态为「{state}」且空闲（该按钮渲染出来）时按键才生效").replace("{state}", preStateLabel)
        : "");
    const options = [
      <option key="@none" value="">{errorText("buttonShortcutNone", "无")}</option>
    ];
    for (const key of SHORTCUT_BUTTON_KEYS) {
      options.push(<option key={key} value={key}>{shortcutLabelOf(key)}</option>);
    }
    if (!known) {
      options.push(
        <option key={"@drift:" + raw} value={raw}>
          {raw + " · " + errorText("buttonShortcutUnavailable", "不可用")}
        </option>
      );
    }
    const rowConflict = conflict !== null && shortcutConflictOnRowOf(conflict, draftListName, index);
    return (
      <label className="cs-modelField" data-shortcut-conflict={rowConflict ? "true" : undefined}>
        <span className="cs-modelCap">{errorText("buttonShortcutLabel", "快捷键")}</span>
        <select
          className="cs-select"
          value={raw}
          disabled={disabled}
          aria-label={errorText("buttonShortcutLabel", "快捷键")}
          title={title}
          onChange={(event) => {
            const next = event.target.value;
            if (next === raw) return; // 漂移项被重选：保持原值
            face.editButton(index, "shortcut", next === "" ? undefined : next);
          }}
        >
          {options}
        </select>
        {preStateLabel && raw !== "" ? (
          <span className="cs-shortcutRowNote" title={title}>
            {errorText("buttonShortcutPreStateShort", "仅「{state}」时生效").replace("{state}", preStateLabel)}
          </span>
        ) : null}
        {rowConflict ? (
          <span className="cs-error">{conflictTextOf(t, conflict, { kind: "button", list: draftListName, index })}</span>
        ) : null}
      </label>
    );
  };

  /**
   * 模型与级别行（`preStateField` / `shortcutField` 同排）。
   * `extraDisabled` = 该行语义收窄（add-cosmos-embryo-dismiss-button：直执行行不组装消息、
   * 不选模型 → 控件禁用 + 说明 title；存储形状不变）。
   */
  const modelRow = (button, index, extraDisabled) => {
    const bound = buttonModelOf(button.model);
    const view = describeButtonModel(bound, catalog);
    const controlDisabled = disabled || extraDisabled === true;
    const directTitle = extraDisabled === true
      ? errorText("embryoDismissModelTitle", "直达移除点击即执行移除：不组装消息、不涉及会话与模型")
      : undefined;
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
        <label className="cs-modelField" title={directTitle}>
          <span className="cs-modelCap">{errorText("buttonEffortLabel", "级别")}</span>
          <select
            className="cs-select"
            value={view.levelValue}
            disabled={controlDisabled}
            aria-label={errorText("buttonEffortLabel", "级别")}
            title={directTitle}
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
        {shortcutField(button, index)}
        <label className="cs-modelField" title={directTitle}>
          <span className="cs-modelCap">{errorText("buttonModelLabel", "模型")}</span>
          <select
            className="cs-select"
            value={view.key}
            disabled={controlDisabled}
            aria-label={errorText("buttonModelLabel", "模型")}
            title={directTitle}
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
      {/* 跨域唯一性（add-cosmos-shortcuts 7.2/D9）：冲突时面板级定位提示 + 保存拒绝；
          行内同时按冲突双方高亮（`shortcutField` 的 data-shortcut-conflict + 文案）。 */}
      {conflictBlocked ? (
        <div className="cs-error" data-shortcut-conflict="true" role="status">
          {errorText("shortcutDup", "快捷键冲突：与其它按键（全局键或其它按钮）重复，请改选其它键位")}
          {" · "}
          {conflictTextOf(t, conflict, conflict.sides?.[0] ?? { kind: "unknown" })}
        </div>
      ) : null}
      <div className="cs-hint">{errorText("shortcutPanelHint", "按钮快捷键与全局键共享同一唯一性域：同一键只属于一个动作（保存时跨列表查重，重复会被拒绝）。")}</div>
      {state.buttonsDraft.map((button, index) => {
        const over = drag !== null && drag.overIndex === index ? drag.edge : null;
        /* 星胚行（preState=proto）：锁定方向翻转（不勾选「新增会话」）且「提示词在前」禁用。 */
        const isProto = button.preState === "proto";
        /* 直执行行（add-cosmos-embryo-dismiss-button 5.1/5.2）：`embryoDismiss === true`。
           `directDrift` = 手工编辑漂移（非 proto 行 + true）——原样回显勾选并标不可用，
           保存由草稿校验拒绝；该行复选框仍可取消（唯一修复路径）。 */
        const directChecked = button.embryoDismiss === true;
        const directDrift = directChecked && !isProto;
        const isDirect = directChecked && isProto;
        const directTitle = isDirect
          ? errorText("embryoDismissActiveTitle", "直达移除点击即执行移除：不组装消息、不导航、不涉及会话与模型")
          : undefined;
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
                  title={isDirect ? directTitle : isProto ? copyText(copy.prependTitleProto) : errorText("prependTitle", "勾选：提示词在消息里位于 @提案引用之前")}
                >
                  <input
                    type="checkbox"
                    checked={button.prepend === true}
                    disabled={disabled || isProto || isDirect}
                    onChange={(event) => {
                      if (isProto || isDirect) return;
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
                  disabled={disabled || isDirect}
                  title={directTitle}
                  onChange={(event) => face.editButton(index, "autoSend", event.target.checked)}
                />
                {errorText("autoSendLabel", "自动发送")}
              </label>
              {/* 「直达移除（免提示词）」（add-cosmos-embryo-dismiss-button 5.1）：仅快捷动作
                  行呈现；仅当前置状态草稿为「待创建（星胚）」时可勾选（其余行禁用 + 说明）。
                  勾选即清空草稿提示词并禁用消息面控件（下方）；切走前置状态由控制器自动清勾。 */}
              {copy.showEmbryoDismiss ? (
                <label
                  className="cs-auto"
                  data-embryo-dismiss={directDrift ? "drift" : directChecked ? "true" : undefined}
                  title={directDrift
                    ? errorText("embryoDismissDriftTitle", "直达移除仅限前置状态为待创建（星胚）的按钮：本行配置不可用，保存会被拒绝")
                    : isProto
                      ? errorText("embryoDismissTitle", "勾选：点击该按钮即删除选中星胚的全部锚点（免提示词、无确认弹层、不导航）；仅「待创建（星胚）」行可用")
                      : errorText("embryoDismissProtoOnly", "直达移除仅限前置状态为待创建（星胚）的按钮")}
                >
                  <input
                    type="checkbox"
                    checked={directChecked}
                    /* 非 proto 且未勾选 → 禁用（不可成为直执行）；漂移勾选保留取消路径。 */
                    disabled={disabled || (!isProto && !directChecked)}
                    aria-label={errorText("embryoDismissLabel", "直达移除（免提示词）")}
                    onChange={(event) => face.editButton(index, "embryoDismiss", event.target.checked)}
                  />
                  {errorText("embryoDismissLabel", "直达移除（免提示词）")}
                </label>
              ) : null}
              <label
                className="cs-auto cs-locked"
                title={isProto ? copyText(copy.newSessionTitleProto) : copyText(copy.newSessionTitle)}
              >
                {/* 锁定态：禁用勾选框 + 固定徽标（MUST NOT 提供取消路径）。普通行锁定为
                    勾选；星胚行锁定为不勾选（固定发往探索会话、不开新会话）。 */}
                <input type="checkbox" checked={!isProto} disabled readOnly />
                <span className="cs-badge">{errorText("newSessionLabel", "新增会话")}</span>
              </label>
              {/* 每按钮「执行后跳转」（缺省勾选）：仅快捷动作行提供——星座链路恒整页保持；
                  直执行行零流转（不导航、不关页）→ 控件禁用 + 说明。 */}
              {copy.showJump ? (
                <label className="cs-auto" title={isDirect ? directTitle : errorText("jumpTitle", "每个按钮独立设置：勾选 = 执行成功后关闭 Cosmos 整页、右侧呈现该会话；取消 = 保持 Cosmos 画面（新会话照常创建，勾选自动发送则照常提交首回合）。")}>
                  <input
                    type="checkbox"
                    checked={button.jumpNewSession !== false}
                    disabled={disabled || isDirect}
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
            {modelRow(button, index, isDirect)}
            <textarea
              className="cs-prompt"
              rows={Math.min(8, Math.max(2, String(button.prompt ?? "").split("\n").length))}
              value={button.prompt}
              placeholder={isDirect
                ? errorText("buttonPromptPhDirect", "直执行按钮不需要提示词（点击即移除选中星胚）")
                : errorText("buttonPromptPh", "提示词：随消息进入新会话草稿…")}
              title={directTitle}
              spellCheck={false}
              disabled={disabled || isDirect}
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
        <button className="cs-btn cs-btnPrimary" type="button" disabled={!state.dirty || state.invalid || conflictBlocked || disabled} onClick={() => face.save()}>
          {state.saving ? errorText("saving", "保存中…") : errorText("save", "保存")}
        </button>
      </div>
    </div>
  );
}

/**
 * 「界面尺寸」字段表（add-cosmos-layout-tuning 5.2 / spec「界面尺寸配置」）：
 * key = settings 键；id = 输入框稳定 id（label[htmlFor] 原生可达）；label = 词典键；
 * min/max/step = 界与粒度（与 settings.mjs `COSMOS_SETTINGS_BOUNDS` 同值，UI 侧硬编码
 * 以保持「设置页不引净房实现」的既有分层）；auto = 高度类键（0 = 自适应，显示提示）。
 */
const COSMOS_SIZE_FIELDS = Object.freeze([
  { key: "sessionPanelWidth", id: "cosmos-size-session-w", label: "sizeSessionW", min: 200, max: 420, step: 10, fallback: 260 },
  { key: "sessionPanelHeight", id: "cosmos-size-session-h", label: "sizeSessionH", min: 0, max: 2000, step: 20, fallback: 0, auto: true },
  { key: "constPanelWidth", id: "cosmos-size-const-w", label: "sizeConstW", min: 140, max: 360, step: 10, fallback: 187 },
  { key: "constPanelHeight", id: "cosmos-size-const-h", label: "sizeConstH", min: 0, max: 2000, step: 20, fallback: 0, auto: true },
  { key: "addBtnSize", id: "cosmos-size-add-btn", label: "sizeAddBtn", min: 40, max: 64, step: 2, fallback: 44 },
  { key: "hudBtnSize", id: "cosmos-size-hud-btn", label: "sizeHudBtn", min: 40, max: 72, step: 2, fallback: 44 },
  { key: "actionBtnWidth", id: "cosmos-size-action-w", label: "sizeActionW", min: 80, max: 200, step: 4, fallback: 112 },
  { key: "actionBtnHeight", id: "cosmos-size-action-h", label: "sizeActionH", min: 40, max: 72, step: 2, fallback: 40 },
  { key: "constActionHeight", id: "cosmos-size-const-action-h", label: "sizeConstActionH", min: 40, max: 72, step: 2, fallback: 40 },
  { key: "searchWidth", id: "cosmos-size-search-w", label: "sizeSearchW", min: 180, max: 640, step: 20, fallback: 320 },
  { key: "searchHeight", id: "cosmos-size-search-h", label: "sizeSearchH", min: 0, max: 64, step: 2, fallback: 0, auto: true },
  { key: "wsTitleSize", id: "cosmos-size-ws-title", label: "sizeWsTitle", min: 10, max: 24, step: 1, fallback: 13 },
  /* 顶部模板工具高度（add-cosmos-template-reassign 返工 D8）：钻取态标牌两侧文字按钮，
     允许低于图标按钮的 40px 下限（横向热区由文本宽度保证）。 */
  { key: "wsToolSize", id: "cosmos-size-ws-tool", label: "sizeWsTool", min: 28, max: 48, step: 2, fallback: 32 }
]);

/**
 * 单个尺寸输入（add-cosmos-layout-tuning 5.2）：本地文本草稿承接键入（与导航页签数字
 * 输入同款纪律——界内即时提交、清空/越界停留草稿并在失焦时夹取），避免受控输入在
 * 键入中途被净房回写打断。`auto` 字段在值 0 时显示「0 = 自适应」提示。
 */
function CosmosSizeField(props) {
  const { t, field, current, commit } = props;
  const value = Number.isFinite(Number(current)) ? Number(current) : field.fallback;
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const range = field.min + "–" + field.max;
  return (
    <div className="cs-sizeRow" title={tr(t, "cosmos.settings.sizeRangeHint", "界 ") + range + " px"}>
      <label className="cs-sizeLabel" htmlFor={field.id}>{tr(t, "cosmos.settings." + field.label, field.key)}</label>
      <input
        id={field.id}
        className="cs-sizeInput"
        type="number"
        inputMode="numeric"
        min={field.min}
        max={field.max}
        step={field.step}
        value={text}
        aria-describedby={field.auto ? field.id + "-auto" : undefined}
        onChange={(event) => {
          setText(event.target.value);
          commit(field, event.target.value, value);
        }}
        onBlur={(event) => {
          const n = Number(event.target.value);
          const next = event.target.value.trim() !== "" && Number.isFinite(n)
            ? Math.min(field.max, Math.max(field.min, Math.round(n)))
            : value;
          setText(String(next));
          if (next !== value) commit(field, String(next), value);
        }}
      />
      <span className="cs-sizeUnit" aria-hidden="true">px</span>
      {field.auto ? <span className="cs-sizeAuto" id={field.id + "-auto"}>{tr(t, "cosmos.settings.sizeAuto", "0 = 自适应")}</span> : null}
    </div>
  );
}

/**
 * 「界面」标签页（add-cosmos-zoom-focus-nav 3.1–3.3 / add-cosmos-layout-tuning 5.1–5.2 /
 * add-cosmos-zoom-ruler 3.2；spec「缩放导航设置页签」→「界面」页签）：
 *  - 导航组：仅「指针聚焦缩放」开关（默认开）；缩放进入/返回阈值已收敛为引擎常量并
 *    由 Cosmos 整页顶部缩放标尺呈现，本组 MUST NOT 提供阈值数字输入；
 *  - 界面尺寸组：`COSMOS_SIZE_FIELDS` 13 个像素输入（面板宽高 / 按钮边长 / 动作条 /
 *    搜索框 / 星座标题字号；高度类 0 = 自适应）。
 * **即时生效**（无草稿-保存模式）：改动即 `face.set` → 写持久化偏好 × 已打开整页
 * 引擎 `setTuning` 热更 + 页根 CSS 令牌重渲染；数字输入用本地文本草稿承接键入
 * （界内即时提交，清空/越界停留草稿并在失焦时夹取），避免受控输入在键入中途被净房
 * 回写打断。
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
  const focus = state !== null && state !== undefined ? state.zoomPointerFocus !== false : true;
  const set = (patch) => {
    try {
      face?.set?.(patch);
    } catch (error) {
      console.error("[dsh-v-cosmos] nav setting failed:", error);
    }
  };
  /** 尺寸字段即时提交（与 nav 的 commit 同纪律：界内整数且与当前不同才写）。 */
  const commitSize = (field, raw, current) => {
    const n = Number(raw);
    if (String(raw).trim() === "" || !Number.isFinite(n)) return;
    const clamped = Math.min(field.max, Math.max(field.min, Math.round(n)));
    if (clamped === n && clamped !== current) set({ [field.key]: clamped });
  };
  /* face 缺失（宿主未注入 nav / 旧宿主）→ 降级占位，不渲染可交互却永不生效的控件（D4）。 */
  if (face === null) {
    return (
      <div className="dsh-cosmos-settings-panel" data-plugin-anchor="dsh-v-cosmos:settings-nav">
        <div className="cs-hint" data-state="face-missing">{tr(t, "cosmos.settings.navUnavailable", "界面设置暂不可用：插件整页未就绪（刷新页面后重试）。")}</div>
      </div>
    );
  }
  return (
    <div className="dsh-cosmos-settings-panel" data-plugin-anchor="dsh-v-cosmos:settings-nav">
      <div className="cs-hint">{tr(t, "cosmos.settings.navHint", "缩放即导航：顶部只读标尺显示当前缩放尺度，刻度 = 钻取参考视距。银河态放大到刻度且最近星座在屏幕中心 25% 范围内即自动进入；钻取态缩小越过刻度下方的滞回下限即自动飞回。两项阈值由引擎常量固定，不设配置项。")}</div>
      {notApplied !== null ? (
        <div className="cs-error" role="status" data-failure-code={notApplied.code}>
          {notAppliedText(t, "cosmos.settings.navNotApplied", "界面设置未生效：插件整页控制器缺失，请重试或刷新页面后重新调整。", notApplied)}
        </div>
      ) : null}
      <div className="cs-nav">
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
      {/* 界面尺寸组（add-cosmos-layout-tuning 5.2）：13 个像素输入，即时生效并持久化；
          高度类字段 0 = 自适应页面高度（max-height 语义），见 design D2/D3。 */}
      <div className="cs-sizeGroup">
        <div className="cs-sizeTitle">{tr(t, "cosmos.settings.sizeGroup", "界面尺寸")}</div>
        <div className="cs-sizeHint">{tr(t, "cosmos.settings.sizeGroupHint", "像素值，改动立即生效并保存；面板与搜索框的高度 0 = 自适应。")}</div>
        <div className="cs-sizeGrid">
          {COSMOS_SIZE_FIELDS.map((field) => (
            <CosmosSizeField
              key={field.key}
              t={t}
              field={field}
              current={state === null || state === undefined ? undefined : state[field.key]}
              commit={commitSize}
            />
          ))}
        </div>
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

/**
 * 「快捷键」标签页（add-cosmos-shortcuts 7.1 / spec cosmos-shortcuts「设置页『快捷键』页签」）：
 * 四行 = 键位标签 + 激活条件说明列 + 键位下拉（`SHORTCUT_GLOBAL_KEYS` 单一常量表同源）+
 * 缺省值「默认」徽标；行序 = `SHORTCUT_UI_ORDER`（回到银河 / 移动开关 / 语音开关 /
 * 关闭页面——与读面冲突优先序刻意解耦）。
 *
 * **即时生效**（无草稿-保存模式）：改选即 `face.set` → 净房持久化 × 受控镜像 × 已打开
 * 整页引擎 `setShortcuts` 热更；冲突即时拒绝（本地预判 + face 侧再校验，两处同源
 * `shortcutConflictOf`）→ 行内错误 + 面板级提示，选择回弹当前生效值。
 * `Ctrl+KeyQ` 标注浏览器保留组合风险并提供 `Alt+KeyQ` 替代（`SHORTCUT_RISKY_KEYS`）；
 * 控制器缺失/写失败经 health store 呈现「未生效」（皮肤/导航同款口径）。
 */
export function CosmosShortcutsPanel(props) {
  const t = props.t;
  const face = props.shortcuts ?? null;
  const state = useSyncExternalStore(face ? face.subscribe : noopSubscribe, face ? face.getSnapshot : noopSnapshot);
  const health = props.selectHealth ?? null;
  const healthState = useSyncExternalStore(health ? health.subscribe : noopSubscribe, health ? health.getSnapshot : noopSnapshot);
  const failure = selectFailureOf(healthState);
  const notApplied = failure !== null && failure.face === "shortcuts" ? failure : null;
  const draftsFace = props.drafts ?? null;
  const draftsSnapshot = useSyncExternalStore(
    draftsFace ? draftsFace.subscribe : noopSubscribe,
    draftsFace ? draftsFace.getSnapshot : noopSnapshot
  );
  /* 被拒绝的选择（值回弹 + 行内错误）；得到无冲突的写入后清除。 */
  const [rejected, setRejected] = useState(null);

  const errorText = (key, fallback) => tr(t, "cosmos.settings." + key, fallback);
  const current = shortcutsStateOf(state);
  const conflict = shortcutConflictOf(current, {
    proposals: Array.isArray(draftsSnapshot?.proposals) ? draftsSnapshot.proposals : [],
    constellations: Array.isArray(draftsSnapshot?.constellations) ? draftsSnapshot.constellations : []
  });

  const commit = (field, value) => {
    const candidate = shortcutsOf({ ...current, [field]: value });
    const hit = shortcutConflictOf(candidate, {
      proposals: Array.isArray(draftsSnapshot?.proposals) ? draftsSnapshot.proposals : [],
      constellations: Array.isArray(draftsSnapshot?.constellations) ? draftsSnapshot.constellations : []
    });
    if (hit !== null) {
      setRejected({ field, value, conflict: hit });
      return;
    }
    setRejected(null);
    try {
      face?.set?.({ [field]: value });
    } catch (error) {
      console.error("[dsh-v-cosmos] shortcut setting failed:", error);
    }
  };

  /* face 缺失（宿主未注入 / 旧宿主）→ 降级占位，不渲染可选却永不生效的下拉（D4 同口径）。 */
  if (face === null) {
    return (
      <div className="dsh-cosmos-settings-panel" data-plugin-anchor="dsh-v-cosmos:settings-shortcuts">
        <div className="cs-hint" data-state="face-missing">{errorText("shortcutsUnavailable", "快捷键设置暂不可用：插件整页未就绪（刷新页面后重试）。")}</div>
      </div>
    );
  }

  return (
    <div className="dsh-cosmos-settings-panel" data-plugin-anchor="dsh-v-cosmos:settings-shortcuts">
      <div className="cs-hint">{errorText("shortcutsHint", "四个全局键 + 两条动作条按钮的自定义快捷键：改动立即生效并保存。快捷键只在 Cosmos 整页打开时生效——输入框聚焦、输入法组字、浮窗打开时按纪律让位。键位按物理键位（ev.code）匹配，非 QWERTY 布局下印刷字母可能不同。")}</div>
      {notApplied !== null ? (
        <div className="cs-error" role="status" data-failure-code={notApplied.code}>
          {notAppliedText(t, "cosmos.settings.shortcutsNotApplied", "快捷键未生效：插件整页控制器缺失，请重试或刷新页面后重新设置。", notApplied)}
        </div>
      ) : null}
      {conflict !== null ? (
        <div className="cs-error" data-shortcut-conflict="true" role="status">
          {errorText("shortcutDup", "快捷键冲突：与其它按键（全局键或其它按钮）重复，请改选其它键位")}
          {" · "}
          {conflictTextOf(t, conflict, conflict.sides?.[0] ?? { kind: "unknown" })}
        </div>
      ) : null}
      <div className="cs-shortcuts">
        {SHORTCUT_UI_ORDER.map((field) => {
          const value = current[field] ?? SHORTCUT_DEFAULTS[field];
          const label = errorText("shortcut" + field.charAt(0).toUpperCase() + field.slice(1), SHORTCUT_FIELD_LABELS[field]);
          const isDefault = value === SHORTCUT_DEFAULTS[field];
          const risky = SHORTCUT_RISKY_KEYS.includes(value);
          const rowConflict = conflict !== null && shortcutConflictOnFieldOf(conflict, field);
          const rowRejected = rejected !== null && rejected.field === field ? rejected.conflict : null;
          const alternative = risky ? SHORTCUT_ALTERNATIVE_OF[value] : "";
          return (
            <div className="cs-shortcutRow" key={field} data-shortcut-field={field}>
              <div className="cs-shortcutField">
                <label className="cs-shortcutLabel" htmlFor={"cosmos-shortcut-" + field}>{label}</label>
                {isDefault ? <span className="cs-shortcutBadge">{errorText("shortcutsDefault", "默认")}</span> : null}
                <select
                  id={"cosmos-shortcut-" + field}
                  className="cs-select"
                  value={value}
                  data-shortcut={value}
                  aria-label={label}
                  aria-describedby={"cosmos-shortcut-" + field + "-hint"}
                  onChange={(event) => {
                    const next = event.target.value;
                    if (next === value) return;
                    commit(field, next);
                  }}
                >
                  {SHORTCUT_GLOBAL_KEYS.map((key) => (
                    <option key={key} value={key}>
                      {shortcutLabelOf(key) + (SHORTCUT_RISKY_KEYS.includes(key) ? " · " + errorText("shortcutRiskTag", "浏览器保留") : "")}
                    </option>
                  ))}
                </select>
              </div>
              <div className="cs-shortcutHint" id={"cosmos-shortcut-" + field + "-hint"}>
                {errorText(SHORTCUT_FIELD_LABEL_KEYS[field] + "Hint", SHORTCUT_FIELD_HINTS[field])}
              </div>
              {risky ? (
                <div className="cs-shortcutRisk" data-shortcut-risk="true">
                  {errorText("shortcutRiskyHint", "Ctrl+Q 在部分浏览器是「退出浏览器」的保留组合、网页无法拦截：可改用 Alt+Q 等替代键。")
                    + (alternative ? " · " + shortcutLabelOf(alternative) : "")}
                </div>
              ) : null}
              {rowConflict || rowRejected !== null ? (
                <div className="cs-error" data-shortcut-conflict="true">
                  {conflictTextOf(t, rowConflict ? conflict : rowRejected, { kind: "global", field })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="cs-shortcutCount">
        {errorText("shortcutsCount", "全局快捷键：") + SHORTCUT_UI_ORDER.length + " · " + errorText("shortcutInstant", "改动立即生效并保存")}
      </div>
    </div>
  );
}

/** 四行激活条件说明兜底文案（词典同键 `shortcut<Field>Hint`；缺键时直出中文基线）。 */
const SHORTCUT_FIELD_HINTS = Object.freeze({
  goHome: "钻取态生效：飞回银河视图（与右下「回到银河」按钮等效）；银河态无动作。",
  togglePan: "整页打开时生效：翻转右下「拖拽平移」开关（与点击按钮同一状态链，含持久化）。",
  voiceToggle: "仅浮窗打开时生效：开始/停止语音录入；浮窗文本域聚焦时可用。",
  closePage: "整页打开时生效：关闭/收起链——钻取返回 > 清空搜索 > 收起会话面板 > 退全屏 > 关闭整页。"
});

/** 曲率计划的「前置状态」徽标文案（null = 不限；与动作页签下拉文案同值）。 */
const WARP_PRE_STATE_TEXT = Object.freeze({
  proto: ["warpPreStateProto", "待创建（星胚）"],
  created: ["warpPreStateCreated", "已创建"],
  reviewed: ["warpPreStateReviewed", "已审核"],
  executed: ["warpPreStateExecuted", "已执行"]
});

/** 前置状态徽标取值（未知漂移值原样回显，不静默改写）。 */
function warpPreStateText(t, preState) {
  if (typeof preState !== "string" || !preState) return "";
  const pair = WARP_PRE_STATE_TEXT[preState];
  if (pair) return tr(t, "cosmos.settings." + pair[0], pair[1]);
  return preState;
}

/**
 * 「曲率引擎」标签页（two-add-cosmos-proposal-warp 5.2 / spec「曲率计划配置模型与曲率
 * 引擎设置页签」）：
 *  - 行清单 = 当前提案动作条（`face.rows`：名称 / 前置状态徽标），多选框勾选即加入
 *    曲率计划；每行规则下拉「曲率直航（缺省）/ 转入脉冲队列」（未勾选时禁用）。
 *  - **暂存-保存模型**：编辑只改本地草稿；「保存」才经 face 整节 CAS 写入 `warpPlan`；
 *    「放弃修改」回退草稿；配置层存在用户覆盖时显示「已覆盖」并允许「重置」。
 *  - 不可写 / 保存中 → 全部控件禁用（与动作页签同门控）。
 *  - 空行清单（尚无动作条）→ 引导去「动作」页签配置，不渲染可点却永不生效的空表。
 * @param {{t: Function, face: object}} props
 */
export function CosmosWarpPanel(props) {
  const t = props.t;
  const face = props.face;
  const state = useSyncExternalStore(
    face ? face.subscribe : noopSubscribe,
    face ? face.getSnapshot : noopSnapshot
  );
  if (face === undefined || face === null) return null;
  if (!state) return null;
  if (state.status === "loading") {
    return <div className="cs-loading">{tr(t, "cosmos.settings.loading", "正在加载设置…")}</div>;
  }
  const disabled = state.writable !== true || state.saving === true;
  const rows = Array.isArray(state.rows) ? state.rows : [];
  const checkedCount = rows.filter((row) => row.checked === true).length;
  const reset = () => {
    try {
      void face.reset?.();
    } catch (error) {
      console.error("[dsh-v-cosmos] warp plan reset failed:", error);
    }
  };
  return (
    <div className="cs-list" data-cosmos-warp-plan="true" data-plugin-anchor="dsh-v-cosmos:settings-warp-engine">
      <div className="cs-secHead">
        <h3 className="cs-label">{tr(t, "cosmos.settings.warpPlanLabel", "曲率引擎动作（附着到目标后自动接力）")}</h3>
        <button
          className="cs-btn"
          type="button"
          data-cosmos-warp-plan-reset="true"
          disabled={state.overridden !== true || disabled}
          title={tr(t, "cosmos.settings.warpPlanResetTitle", "清除用户覆盖，回落默认曲率计划")}
          onClick={reset}
        >{tr(t, "cosmos.settings.warpPlanReset", "重置")}</button>
      </div>
      <div className="cs-hint">
        {tr(
          t,
          "cosmos.settings.warpPlanHint",
          "从已保存的提案动作条中多选组成曲率计划：附着到选中提案（或星胚组）后，前置状态一满足即自动执行并逐级接力；规则缺省「曲率直航」，「转入脉冲队列」把该动作交给脉冲队列（转投落定即在曲率侧完成）。计划变更不影响已附着目标在途条目。"
        )}
      </div>
      {rows.length === 0 ? (
        <div className="cs-hint" data-cosmos-warp-plan-empty="true">
          {tr(t, "cosmos.settings.warpPlanNoBars", "还没有可用的提案动作条：请先到「动作」页签配置按钮。")}
        </div>
      ) : (
        <div className="cs-warpRows">
          {rows.map((row) => {
            const preStateText = warpPreStateText(t, row.preState);
            return (
              <div
                className="cs-warpRow"
                key={row.name}
                data-cosmos-warp-plan-row={row.name}
                data-checked={row.checked === true ? "true" : undefined}
              >
                <label className="cs-auto">
                  <input
                    type="checkbox"
                    checked={row.checked === true}
                    disabled={disabled}
                    aria-label={row.name}
                    onChange={(event) => face.edit(row.name, { checked: event.target.checked })}
                  />
                  <span className="cs-warpName">{row.name}</span>
                </label>
                <span
                  className="cs-badge"
                  data-pre-state={typeof row.preState === "string" && row.preState ? row.preState : "any"}
                >{preStateText || tr(t, "cosmos.settings.warpPreStateAny", "不限")}</span>
                <select
                  className="cs-select"
                  value={row.rule === "queue" ? "queue" : "direct"}
                  disabled={disabled || row.checked !== true}
                  aria-label={row.name + " · " + tr(t, "cosmos.settings.warpRuleLabel", "规则")}
                  onChange={(event) => face.edit(row.name, { rule: event.target.value === "queue" ? "queue" : "direct" })}
                >
                  <option value="direct">{tr(t, "cosmos.settings.warpRuleDirect", "曲率直航（缺省）")}</option>
                  <option value="queue">{tr(t, "cosmos.settings.warpRuleQueue", "转入脉冲队列")}</option>
                </select>
              </div>
            );
          })}
        </div>
      )}
      {!state.writable ? (
        <div className="cs-error">{tr(t, "cosmos.settings.notWritable", "当前连接不支持持久设置修改")}</div>
      ) : null}
      {state.failed ? (
        <div className="cs-error">{tr(t, "cosmos.settings.saveFailed", "保存未生效，请重试")}</div>
      ) : null}
      {state.overridden ? (
        <div className="cs-meta" data-cosmos-warp-plan-overridden="true">
          {tr(t, "cosmos.settings.warpPlanOverridden", "已覆盖默认曲率计划")}
        </div>
      ) : null}
      <div className="cs-meta">
        {tr(t, "cosmos.settings.warpPlanCount", "曲率计划动作条：") + checkedCount + " / " + rows.length}
      </div>
      <div className="cs-actions">
        <button
          className="cs-btn"
          type="button"
          disabled={state.dirty !== true || state.saving === true}
          onClick={() => face.discard()}
        >{tr(t, "cosmos.settings.discard", "放弃修改")}</button>
        <button
          className="cs-btn cs-btnPrimary"
          type="button"
          disabled={state.dirty !== true || disabled}
          onClick={() => face.save()}
        >{state.saving ? tr(t, "cosmos.settings.saving", "保存中…") : tr(t, "cosmos.settings.save", "保存")}</button>
      </div>
    </div>
  );
}
