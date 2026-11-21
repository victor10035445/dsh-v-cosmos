/**
 * dsh-v-cosmos · 星场面 HUD 铬件（p2-add-cosmos-works-face 4.1–4.5）
 *
 * 职责边界：只做 **DOM 呈现与交互编排**——右下控制簇的单枚面切换按钮（「拖拽平移」左侧）、
 * 底部「＋ / 编辑作品」工具行、只读焦点信息卡（引线几何由引擎统一描线）、
 * 作品编辑页（别名 / 备注 / 定位 / 移除）、系统文件选择器登记。数据/动作全部经宿主
 * 注入的 `actions` 回调（client.jsx 以 api.mjs 桥接），本模块零网络、零场景读取。
 *
 * 纪律：
 *  - 内容差分守卫：信息卡按签名重写；编辑页仅在开页/保存/移除时重绘（输入态不被逐帧覆盖）；
 *  - 触屏点击目标：面切换按钮 ≥40px（与右下控制簇同规格）、底部工具 48px、
 *    编辑行按钮/输入 ≥32px；
 *  - 编辑页遵循浮窗层级纪律：z 序高于星场覆盖层（overlay z-46 内 z-30）、低于 toast
 *    （`.cos-toast` z-47）；Esc 关闭由引擎 `consumeEscape` 前置消费（MUST NOT 冒泡换面）；
 *  - 主题化：HUD 镀铬一律 `var(--cos-*, fallback)`（CSS 在 ENGINE_CSS 的星场段落）。
 */

import { WORKS_FACE_LIMIT, WORKS_KIND_GLYPH, WORKS_KIND_LABEL } from "./works-face.mjs";

/** 失败 reason → 呈现文案（服务端结构化 reason 与 p1 spec 同源）。 */
export const WORKS_REASON_TEXT = Object.freeze({
  "missing-on-disk": "文件已被删除（失谐）",
  "platform-unsupported": "当前平台不支持该启动/定位动作",
  "out-of-root": "所选文件不在当前工作区内，已拒绝",
  "not-a-file": "目标不是文件（目录或符号链接不可登记）",
  "entry-unknown": "条目不存在，可能已被其他标签页移除",
  "workspace-unknown": "工作区不在册",
  "workspace/unknown": "工作区不在册",
  duplicate: "该文件已登记过",
  limit: "已达每星座 32 条上限",
  symlink: "符号链接不可登记",
  "picker-unavailable": "系统文件选择器不可用（当前宿主缺少原生文件对话框）",
  "picker-busy": "已有文件选择窗口打开，请先完成选择",
  "picker-failed": "系统文件选择器打开失败",
  "picker-timeout": "文件选择超时，已取消"
});

/**
 * 面切换按钮的两枚图案（单按钮语义：图案 = **将切换到的画面**）：
 *  - 引力场（当前星座视图 → 星场）：中心势阱 + 弯曲场线；
 *  - 星座连线（当前星场视图 → 星座）：节点 + 连线。
 * 纯 `currentColor` 线性图标（尺寸 22），颜色随 HUD 令牌走。
 */
const FACE_ICON_GRAVITY =
  '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
  '<ellipse cx="12" cy="12" rx="9.6" ry="3.9" stroke="currentColor" stroke-width="1.35" opacity=".55"/>' +
  '<ellipse cx="12" cy="12" rx="6.2" ry="2.4" stroke="currentColor" stroke-width="1.35" opacity=".8"/>' +
  '<path d="M2.4 6.6c2.8 0 4.2 2 5 4.1M2.4 17.4c2.8 0 4.2-2 5-4.1M21.6 6.6c-2.8 0-4.2 2-5 4.1M21.6 17.4c-2.8 0-4.2-2-5-4.1" ' +
  'stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity=".75"/>' +
  '<circle cx="12" cy="12" r="1.9" fill="currentColor"/>' +
  "</svg>";

const FACE_ICON_CONSTELLATION =
  '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
  '<path d="M4.6 17.4 9.3 6.6l5.8 4.3 4.3-6.1M9.3 6.6l5 11.2 5.1-4.5M6.6 20.6 14.3 17.8" ' +
  'stroke="currentColor" stroke-width="1.25" stroke-linejoin="round" opacity=".8"/>' +
  '<circle cx="4.6" cy="17.4" r="1.65" fill="currentColor"/>' +
  '<circle cx="9.3" cy="6.6" r="1.65" fill="currentColor"/>' +
  '<circle cx="15.1" cy="10.9" r="1.65" fill="currentColor"/>' +
  '<circle cx="19.4" cy="4.8" r="1.65" fill="currentColor"/>' +
  '<circle cx="14.3" cy="17.8" r="1.65" fill="currentColor"/>' +
  "</svg>";

/** 底部「编辑作品」按钮图案（铅笔；与 ＋ 同规格 48px，icon-only）。 */
const EDIT_ICON =
  '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
  '<path d="M4 20l4.2-1 10.1-10.1a2.1 2.1 0 0 0-3-3L5.2 16 4 20z" ' +
  'stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/>' +
  '<path d="M13.8 6.4l3 3M5.2 16l3 3" stroke="currentColor" stroke-width="1.25" opacity=".75"/>' +
  "</svg>";

function esc(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function removeOn(el) {
  try {
    if (el && typeof el.remove === "function") el.remove();
  } catch { /* 桩容错 */ }
}

/**
 * @param {object} host
 * @param {Element} host.root `.cos-root`
 * @param {Element} host.overlay `.cos-overlay`
 * @param {(text: string, isError?: boolean) => void} host.toast
 * @param {(face: "matter"|"field") => boolean} host.onFaceRequest
 * @param {() => number} host.getCount
 * @param {() => string|null} host.getWorksId
 * @param {() => Array<object>} host.getWorks 当前钻取星座焦点快照（编辑页列表）
 * @param {(id: string) => object|null} host.getFocus
 * @param {(id: string) => void} host.onLaunched
 * @param {(id: string) => void} host.onEvaporate
 * @param {() => void} host.onAdded
 * @param {object} host.actions `{pick, update, remove, open, reveal}`（pick = 系统文件选择器登记）
 */
export function createWorksFaceUI(host) {
  const H = host && typeof host === "object" ? host : {};
  const doc = typeof document !== "undefined" ? document : null;
  if (!doc) return nullHostUI();

  const state = {
    busy: false,
    face: "",
    faceBtnOn: false,
    fabOn: false,
    picking: false,
    cardOpen: false,
    cardId: null,
    cardSig: "",
    pinned: false,
    editorOpen: false,
    editorRows: [],
    editorDrafts: new Map(),
    saving: new Set(),
    armedRemoveId: null,
    armedTimer: null
  };

  const actions = H.actions && typeof H.actions === "object" ? H.actions : {};

  /* ── 建 DOM（一次；MUST NOT 逐帧重建，否则 click 永不派发） ── */

  /* ── 单枚面切换按钮（右下控制簇，「拖拽平移」左侧）──────────────────────────
     语义：图案 = 将切换到的画面（当前星座视图 → 引力场图标 = 去星场；当前星场 →
     星座连线图标 = 回星座视图）；仅钻取态呈现（银河视图无面概念），转场中呈忙态并
     忽略点击。DOM 建一次、内容差分（`dataset.face`）切换图案，MUST NOT 逐帧重建。 */
  const faceBtn = doc.createElement("button");
  faceBtn.className = "cos-face-btn";
  faceBtn.setAttribute("type", "button");
  faceBtn.setAttribute("data-on", "false");
  faceBtn.setAttribute("data-busy", "false");
  faceBtn.setAttribute("data-face", "matter");
  faceBtn.setAttribute("aria-label", "切换到星场");
  faceBtn.setAttribute("title", "切换到星场");
  faceBtn.innerHTML = FACE_ICON_GRAVITY;
  faceBtn.addEventListener("click", () => requestFace(state.face === "field" ? "matter" : "field"));
  if (H.overlay) H.overlay.appendChild(faceBtn);

  /* 底部工具行（星场态常驻；转场/他面隐藏）：左「＋」凝聚、右「编辑作品」管理页。 */
  const tools = doc.createElement("div");
  tools.className = "cos-wfield-tools";
  tools.setAttribute("data-on", "false");
  tools.setAttribute("aria-hidden", "true");

  const fab = doc.createElement("button");
  fab.className = "cos-wfield-fab";
  fab.setAttribute("type", "button");
  fab.setAttribute("aria-label", "凝聚作品");
  fab.setAttribute("title", "凝聚作品");
  fab.innerHTML = "<span aria-hidden=\"true\">\uFF0B</span>";
  fab.addEventListener("click", () => { pickFiles(); });
  tools.appendChild(fab);

  const editBtn = doc.createElement("button");
  editBtn.className = "cos-wfield-edit";
  editBtn.setAttribute("type", "button");
  editBtn.setAttribute("aria-label", "编辑作品");
  editBtn.setAttribute("title", "编辑作品（别名 / 备注 / 所在目录）");
  editBtn.innerHTML = EDIT_ICON;
  editBtn.addEventListener("click", () => { openEditor(); });
  tools.appendChild(editBtn);

  if (H.overlay) H.overlay.appendChild(tools);

  /* 作品编辑页（只读列表 + 行内别名/备注 + 定位/移除；Esc 由引擎优先关闭）。 */
  const card = doc.createElement("div");
  card.className = "cos-wcard";
  card.setAttribute("data-on", "false");
  card.addEventListener("pointerenter", () => { state.pinned = true; });
  card.addEventListener("pointerleave", () => { state.pinned = false; });
  if (H.overlay) H.overlay.appendChild(card);

  const editor = doc.createElement("div");
  editor.className = "cos-weditor";
  editor.setAttribute("hidden", "");
  editor.innerHTML =
    '<div class="cos-weditor-backdrop" data-act="close-editor"></div>' +
    '<section class="cos-weditor-panel" role="dialog" aria-modal="true" aria-label="编辑作品">' +
    '  <header class="cos-weditor-head"><b>作品焦点</b>' +
    '    <span class="cos-weditor-count" data-role="editor-count"></span>' +
    '    <button type="button" class="cos-weditor-x" data-act="close-editor" aria-label="关闭">\u00D7</button>' +
    "  </header>" +
    '  <div class="cos-weditor-list" data-role="editor-list"></div>' +
    "</section>";
  editor.addEventListener("click", (ev) => onEditorClick(ev));
  editor.addEventListener("input", (ev) => onEditorInput(ev));
  editor.addEventListener("keydown", (ev) => onEditorKeydown(ev));
  if (H.overlay) H.overlay.appendChild(editor);

  /* ── 小工具 ── */

  function queryRole(root, role) {
    if (!root) return null;
    if (typeof root.querySelector !== "function") return null;
    try { return root.querySelector('[data-role="' + role + '"]'); } catch { return null; }
  }

  /** `hidden` 属性切换（桩 DOM 无 removeAttribute → 走 attrs 面）。 */
  function showHidden(el, hidden) {
    if (!el) return;
    if (hidden) { el.setAttribute("hidden", ""); return; }
    if (typeof el.removeAttribute === "function") el.removeAttribute("hidden");
    else el.attrs.hidden = false;
  }


  function reasonText(result) {
    const message = typeof result?.message === "string" ? result.message.trim() : "";
    if (message && (result?.reason === "out-of-root" || result?.reason === "picker-failed" || result?.reason === "picker-unavailable")) {
      return message;
    }
    const reason = typeof result?.reason === "string" && WORKS_REASON_TEXT[result.reason]
      ? WORKS_REASON_TEXT[result.reason]
      : null;
    const detail = typeof result?.error === "string" && result.error ? result.error : "";
    if (reason) return detail && detail !== result.reason ? reason + "（" + detail + "）" : reason;
    return detail || "操作失败";
  }

  function toast(text, isError) {
    try { H.toast?.(text, isError !== false); } catch { /* 容错 */ }
  }

  function requestFace(face) {
    if (state.busy) return false; // 转场进行中：请求被忽略（按钮忙态）
    try { return H.onFaceRequest?.(face) === true; } catch { return false; }
  }

  /* ── 面切换按钮 / fab 同步（逐帧调用，差分守卫） ── */

  /**
   * @param {{face: "matter"|"field", busy: boolean, drilled: boolean}} info
   */
  function syncFaceButton(info) {
    const face = info?.face === "field" ? "field" : "matter";
    const busy = info?.busy === true;
    const on = info?.drilled === true;
    if (state.faceBtnOn !== on) {
      state.faceBtnOn = on;
      faceBtn.setAttribute("data-on", on ? "true" : "false");
      faceBtn.style.display = on ? "" : "none";
    }
    if (state.busy !== busy) {
      state.busy = busy;
      faceBtn.setAttribute("data-busy", busy ? "true" : "false");
      faceBtn.setAttribute("aria-disabled", busy ? "true" : "false");
    }
    if (state.face !== face) {
      state.face = face;
      const icon = face === "field" ? FACE_ICON_CONSTELLATION : FACE_ICON_GRAVITY;
      const label = face === "field" ? "切换到星座视图" : "切换到星场";
      faceBtn.innerHTML = icon;
      faceBtn.setAttribute("data-face", face);
      faceBtn.setAttribute("aria-label", label);
      faceBtn.setAttribute("title", label);
    }
  }

  function syncFab(visible) {
    const on = visible === true;
    if (state.fabOn === on) return;
    state.fabOn = on;
    tools.setAttribute("data-on", on ? "true" : "false");
    tools.setAttribute("aria-hidden", on ? "false" : "true");
  }

  /* ── 焦点信息卡（只读：类型 + 显示名 + 相对路径；操作已移至编辑页）── */

  function cardSignatureOf(f) {
    if (!f) return "";
    return [f.id, f.displayName, f.relPath, f.kind, f.exists === false ? 0 : 1].join("|");
  }

  function cardHtmlOf(f) {
    const glyph = WORKS_KIND_GLYPH[f.kind] || WORKS_KIND_GLYPH.other;
    const kindName = f.exists === false ? "失谐 · 文件不存在" : (WORKS_KIND_LABEL[f.kind] || "文件");
    return '<span class="cos-wcard-kind"><i>' + esc(glyph) + "</i>" + esc(kindName) + "</span>" +
      '<b class="cos-wcard-name">' + esc(f.displayName) + "</b>" +
      '<span class="cos-wcard-path">' + esc(f.relPath) + "</span>" +
      (f.exists === false ? '<span class="cos-wcard-hint">文件不存在，无法激发</span>' : "");
  }

  function showCard(focus) {
    if (!focus) { hideCard(); return; }
    state.cardOpen = true;
    state.cardId = focus.id;
    card.setAttribute("data-on", "true");
    const sig = cardSignatureOf(focus);
    if (sig !== state.cardSig) {
      card.innerHTML = cardHtmlOf(focus);
      card.dataset.sig = sig;
      state.cardSig = sig;
    }
  }

  function hideCard() {
    state.cardOpen = false;
    state.cardId = null;
    state.cardSig = "";
    card.setAttribute("data-on", "false");
  }

  /* ── 作品编辑页（＋ 旁铅笔按钮打开：列表 / 别名 / 备注 / 定位 / 移除）────────── */

  function basenameOf(relPath) {
    return String(relPath || "").split(/[\\/]+/).filter(Boolean).pop() || String(relPath || "");
  }

  function worksEntries() {
    try {
      const list = H.getWorks?.();
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function draftOf(id) {
    return state.editorDrafts.get(id) || { name: "", note: "" };
  }

  function editorRowHtmlOf(f) {
    const glyph = WORKS_KIND_GLYPH[f.kind] || WORKS_KIND_GLYPH.other;
    const kindName = f.exists === false ? "失谐" : (WORKS_KIND_LABEL[f.kind] || "文件");
    const draft = draftOf(f.id);
    const display = String(draft.name || "").trim() || basenameOf(f.relPath);
    const armed = state.armedRemoveId === f.id;
    return '<div class="cos-weditor-row" data-id="' + esc(f.id) + '">' +
      '<span class="cos-weditor-kind" title="' + esc(kindName) + '"><i>' + esc(glyph) + "</i>" + esc(kindName) + "</span>" +
      '<div class="cos-weditor-main"><b>' + esc(display) + "</b>" +
      '<span class="cos-weditor-path">' + esc(f.relPath) + "</span>" +
      '<div class="cos-weditor-fields">' +
      '<label>别名<input type="text" spellCheck="false" data-field="name" data-id="' + esc(f.id) +
      '" value="' + esc(draft.name) + '" placeholder="留空 = 使用文件名" /></label>' +
      '<label>备注<input type="text" spellCheck="false" data-field="note" data-id="' + esc(f.id) +
      '" value="' + esc(draft.note) + '" placeholder="可选" /></label>' +
      "</div></div>" +
      '<div class="cos-weditor-ops">' +
      '<button type="button" data-act="save" data-id="' + esc(f.id) + '">保存</button>' +
      '<button type="button" data-act="reveal" data-id="' + esc(f.id) + '">打开所在目录</button>' +
      '<button type="button" class="cos-weditor-remove" data-act="remove" data-id="' + esc(f.id) +
      '"' + (armed ? ' data-armed="true"' : "") + ">" + (armed ? "确认移除" : "移除") + "</button>" +
      "</div></div>";
  }

  function renderEditor(rowsOverride) {
    const rows = Array.isArray(rowsOverride) ? rowsOverride.slice() : worksEntries();
    state.editorRows = rows;
    const ids = new Set(rows.map((row) => row.id));
    for (const id of Array.from(state.editorDrafts.keys())) {
      if (!ids.has(id)) state.editorDrafts.delete(id);
    }
    for (const row of rows) {
      if (!state.editorDrafts.has(row.id)) {
        state.editorDrafts.set(row.id, { name: row.alias || row.name || "", note: row.note || "" });
      }
    }
    const list = queryRole(editor, "editor-list");
    if (list) {
      list.innerHTML = rows.length
        ? rows.map((row) => editorRowHtmlOf(row)).join("")
        : '<div class="cos-weditor-empty">还没有作品焦点；先用「＋」凝聚文件。</div>';
    }
    const countEl = queryRole(editor, "editor-count");
    if (countEl) countEl.textContent = rows.length + " 个焦点";
  }

  function openEditor() {
    if (state.editorOpen) return true;
    if (!worksId()) {
      toast("作品数据尚未就绪（星座未钻取或快照在途）", true);
      return false;
    }
    state.editorOpen = true;
    state.armedRemoveId = null;
    renderEditor();
    showHidden(editor, false);
    return true;
  }

  function clearArmed() {
    if (state.armedTimer) {
      clearTimeout(state.armedTimer);
      state.armedTimer = null;
    }
    state.armedRemoveId = null;
  }

  function closeEditor() {
    if (!state.editorOpen) return false;
    state.editorOpen = false;
    clearArmed();
    state.editorDrafts.clear();
    showHidden(editor, true);
    return true;
  }

  function editorIsOpen() {
    return state.editorOpen === true;
  }

  function readAttr(node, name) {
    let cur = node;
    for (let i = 0; i < 6 && cur; i++) {
      const value = cur.getAttribute ? cur.getAttribute(name) : null;
      if (value) return value;
      cur = cur.parentNode;
    }
    return null;
  }

  function onEditorInput(ev) {
    const target = ev?.target;
    if (!target || typeof target.getAttribute !== "function") return;
    const id = target.getAttribute("data-id");
    const field = target.getAttribute("data-field");
    if (!id || (field !== "name" && field !== "note")) return;
    const draft = { ...draftOf(id) };
    draft[field] = String(target.value ?? "");
    state.editorDrafts.set(id, draft);
  }

  function onEditorKeydown(ev) {
    if (ev?.key !== "Enter") return;
    const target = ev.target;
    if (!target || typeof target.getAttribute !== "function") return;
    const field = target.getAttribute("data-field");
    if (field !== "name" && field !== "note") return;
    const id = target.getAttribute("data-id");
    if (!id) return;
    ev.preventDefault?.();
    saveEditorRow(id);
  }

  function onEditorClick(ev) {
    const target = ev?.target;
    const act = readAttr(target, "data-act");
    if (!act) return;
    if (act === "close-editor") { closeEditor(); return; }
    const id = readAttr(target, "data-id");
    if (!id) return;
    if (act === "save") { saveEditorRow(id); return; }
    if (act === "reveal") { revealRow(id); return; }
    if (act === "remove") { removeRow(id); }
  }

  async function saveEditorRow(id) {
    if (!id || state.saving.has(id)) return;
    const row = state.editorRows.find((item) => item.id === id);
    if (!row) return;
    const wsId = worksId();
    if (!wsId) { toast("星座未就绪，暂时无法保存", true); return; }
    const draft = draftOf(id);
    const name = String(draft.name ?? "").trim();
    const note = String(draft.note ?? "").trim();
    state.saving.add(id);
    let result;
    try { result = await actions.update?.(wsId, id, { name, note }); } catch (error) {
      result = { ok: false, error: String(error?.message || error) };
    } finally {
      state.saving.delete(id);
    }
    if (result?.ok === true) {
      row.name = name || null;
      row.alias = name || null;
      row.note = note || null;
      row.displayName = name || basenameOf(row.relPath);
      state.editorDrafts.set(id, { name, note });
      renderEditor(state.editorRows);
      toast("已保存（空别名回落文件名）", false);
    } else {
      toast(reasonText(result), true);
    }
  }

  async function revealRow(id) {
    const wsId = worksId();
    if (!wsId) return;
    let result;
    try { result = await actions.reveal?.(wsId, id); } catch (error) {
      result = { ok: false, error: String(error?.message || error) };
    }
    if (result?.ok === true) toast("已在资源管理器中定位", false);
    else toast(reasonText(result), true);
  }

  async function removeRow(id) {
    const row = state.editorRows.find((item) => item.id === id);
    if (!row) return;
    if (state.armedRemoveId !== id) {
      state.armedRemoveId = id;
      renderEditor(state.editorRows);
      if (state.armedTimer) clearTimeout(state.armedTimer);
      state.armedTimer = setTimeout(() => {
        state.armedTimer = null;
        if (state.armedRemoveId !== id) return;
        state.armedRemoveId = null;
        if (state.editorOpen) renderEditor(state.editorRows);
      }, 3000);
      state.armedTimer?.unref?.();
      return;
    }
    clearArmed();
    const wsId = worksId();
    if (!wsId) return;
    const before = state.editorRows.slice();
    state.editorRows = state.editorRows.filter((item) => item.id !== id);
    state.editorDrafts.delete(id);
    renderEditor(state.editorRows);
    H.onEvaporate?.(id); // 星场蒸发动画先起（服务端失败由快照对账复位）
    let result;
    try { result = await actions.remove?.(wsId, id); } catch (error) {
      result = { ok: false, error: String(error?.message || error) };
    }
    if (result?.ok === true) {
      toast("已移除 · " + row.displayName, false);
    } else {
      state.editorRows = before;
      renderEditor(state.editorRows);
      toast(reasonText(result), true);
    }
  }

  /**
   * 卡体定位（引擎逐帧供给焦点屏幕位置）：45° 斜出 + 水平段引线的端点由本函数一次算出。
   * @param {{x:number,y:number,r?:number,width:number,height:number}} input
   * @returns {{x:number,y:number,anchor:{x:number,y:number},dir:number}|null}
   */
  function placeCard(input) {
    if (!state.cardOpen) return null;
    const W = Number(input?.width) > 0 ? Number(input.width) : 1280;
    const Hh = Number(input?.height) > 0 ? Number(input.height) : 720;
    const fx = Number(input?.x) || 0;
    const fy = Number(input?.y) || 0;
    const fr = Number(input?.r) || 20;
    let cw = Number(card.offsetWidth) || 0;
    let ch = Number(card.offsetHeight) || 0;
    if (!(cw > 0)) cw = 250;
    if (!(ch > 0)) ch = 132;
    const gap = 40;
    const margin = 12;
    let dir = fx + fr + gap + cw <= W - margin ? 1 : -1;
    let left = dir === 1 ? fx + fr + gap : fx - fr - gap - cw;
    if (left < margin) { dir = 1; left = fx + fr + gap; }
    if (left + cw > W - margin) left = Math.max(margin, W - margin - cw);
    let top = fy - ch - gap * 0.45;
    if (top < 70) top = fy + fr + 14;
    top = Math.min(Math.max(top, 70), Math.max(70, Hh - ch - 96));
    const transform = "translate(" + Math.round(left) + "px," + Math.round(top) + "px)";
    if (card.style.transform !== transform) card.style.transform = transform;
    const nearX = dir === 1 ? left : left + cw;
    const anchorY = Math.min(Math.max(fy - 10, top + 18), top + ch - 18);
    return { x: left, y: top, dir, anchor: { x: nearX, y: anchorY } };
  }

  /* ── 系统文件选择器登记 ── */

  function worksId() {
    try { return H.getWorksId?.() || null; } catch { return null; }
  }

  function count() {
    const n = Number(H.getCount?.());
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * 系统文件选择器登记（用户修订：MUST NOT 自建浏览模态）。
   * 宿主经 `actions.pick(wsId)` 弹出平台原生多选对话框（初值 = 工作区根），
   * 服务端收敛根内相对路径后整批原子登记；取消静默、失败 toast。
   * @returns {Promise<boolean>} 是否完成一次受理（取消也算受理成功）
   */
  async function pickFiles() {
    if (state.picking) return false;
    const wsId = worksId();
    if (!wsId) {
      toast("作品数据尚未就绪（星座未钻取或快照在途）", true);
      return false;
    }
    if (count() >= WORKS_FACE_LIMIT) {
      toast("已达每星座 32 条作品上限（先移除部分条目）", true);
      return false;
    }
    if (typeof actions.pick !== "function") {
      toast(WORKS_REASON_TEXT["picker-unavailable"], true);
      return false;
    }
    state.picking = true;
    let result;
    try {
      result = await actions.pick(wsId);
    } catch (error) {
      result = { ok: false, error: String(error?.message || error) };
    } finally {
      state.picking = false;
    }
    if (result?.ok === true) {
      if (result.cancelled === true) return true; // 用户取消：静默
      const n = Array.isArray(result.entries)
        ? result.entries.length
        : Number(result.picked) || 0;
      H.onAdded?.();
      toast("已凝聚 " + n + " 件作品（系统文件浏览器）", false);
      return true;
    }
    toast(reasonText(result), true);
    return false;
  }
  /* ── 观测面（冒烟） ── */

  function inspect() {
    return {
      faceButton: {
        busy: state.busy,
        face: state.face,
        on: state.faceBtnOn,
        icon: faceBtn.getAttribute("data-face"),
        label: faceBtn.getAttribute("aria-label")
      },
      fab: { on: state.fabOn, picking: state.picking },
      card: {
        open: state.cardOpen,
        id: state.cardId,
        sig: state.cardSig,
        pinned: state.pinned
      },
      editor: {
        open: state.editorOpen,
        rows: state.editorRows.length,
        armedRemoveId: state.armedRemoveId
      },
      elements: { faceButton: faceBtn, tools, fab, editButton: editBtn, card, editor }
    };
  }

  function dispose() {
    if (state.armedTimer) clearTimeout(state.armedTimer);
    state.armedTimer = null;
    state.saving.clear();
    state.editorDrafts.clear();
    removeOn(faceBtn);
    removeOn(tools);
    removeOn(card);
    removeOn(editor);
  }

  // 初始态：面按钮默认天体面（未钻取隐藏）；底部工具行隐藏。
  syncFaceButton({ face: "matter", busy: false, drilled: false });
  syncFab(false);

  return {
    syncFaceButton,
    syncFab,
    showCard,
    hideCard,
    placeCard,
    cardOpen: () => state.cardOpen,
    cardPinned: () => state.pinned,
    openEditor,
    closeEditor,
    editorOpen: editorIsOpen,
    pickFiles,
    inspect,
    dispose,
    elements: { faceButton: faceBtn, tools, fab, editButton: editBtn, card, editor }
  };
}

/** 无 DOM 环境的桩（单元测试/SSR 兜底：全部动作静默 no-op，SHALL NOT 抛错）。 */
function nullHostUI() {
  return {
    syncFaceButton() {},
    syncFab() {},
    showCard() {},
    hideCard() {},
    placeCard: () => null,
    cardOpen: () => false,
    cardPinned: () => false,
    openEditor: () => false,
    closeEditor() {},
    editorOpen: () => false,
    pickFiles: () => false,
    inspect: () => ({
      faceButton: { busy: false, face: "matter", on: false },
      fab: { on: false },
      card: { open: false },
      editor: { open: false, rows: 0 }
    }),
    dispose() {},
    elements: {}
  };
}
