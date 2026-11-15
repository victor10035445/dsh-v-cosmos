/**
 * 提案列表面板投影冒烟（add-cosmos-proposal-actions 3.1/3.6 / cosmos-proposal-panel；
 * add-cosmos-embryo-cards 3.1/3.2/3.5）：分组与组内排序、星胚合并卡片（归并/排序/
 * 不触发分组/不携带 dir）、钻取过滤、搜索过滤联动（工作区名 ∪ 星胚 slug）、选中保留
 * 语义、空态可见性、确定性；以及 mergeScene `ws.path` 透传（D1 勘误）。
 * 运行：node test/panel-smoke.mjs
 */
import assert from "node:assert/strict";
import {
  SELECTION_SURFACE_SELECTOR,
  embryoKeyOf,
  findCard,
  isSelectionSurface,
  keepSelection,
  pendingCategoryOf,
  projectPanel,
  projectSessionPanel,
  proposalDirOf,
  proposalKeyOf,
  sessionKeyOf,
  sessionRowStateOf
} from "../src/panel.mjs";
import { matchWorkspaces, mergeScene } from "../src/merge.mjs";

const scene = {
  workspaces: [
    {
      id: "ws2",
      name: "beta",
      path: "C:\\proj\\beta",
      stars: [
        { id: "add-z", name: "add-z", lifecycle: "executed", setBy: "cosmos-apply-change", at: 300, tasks: [3, 3] }
      ]
    },
    {
      id: "ws1",
      name: "alpha",
      path: "C:/proj/alpha",
      stars: [
        { id: "add-gamma", name: "add-gamma", lifecycle: "reviewed", setBy: "cosmos-review", at: 200, tasks: [1, 2] },
        { id: "add-alpha", name: "add-alpha", lifecycle: "created", setBy: null, at: null, tasks: [0, 1] },
        { id: "add-beta", name: "add-beta", lifecycle: "created", tasks: [2, 2] },
        /* 星胚（pending 锚点）→ 合并卡片（同会话归并，排于正式提案之后） */
        { id: "proto-one", name: "proto-one", lifecycle: "proto", setBy: "cosmos-explore", at: 400, sessionId: "sess-x", tasks: [0, 0] },
        /* 非法 lifecycle → created 兜底 */
        { id: "add-broken", name: "add-broken", lifecycle: "weird", tasks: [0, 0] }
      ]
    },
    {
      /* 无活跃提案的工作区（只有星胚锚点）→ 银河态不生成分组（自动隐藏）。 */
      id: "ws3",
      name: "gamma",
      path: "C:/proj/gamma",
      stars: [{ id: "proto-gamma", name: "proto-gamma", lifecycle: "proto", setBy: "cosmos-explore", at: 500, tasks: [0, 0] }]
    }
  ]
};

/* ── 1. proposalsKeyOf / proposalDirOf（正斜杠、UNC、根目录） ── */
{
  assert.equal(proposalKeyOf("ws1", "add-a"), "ws1\u0000add-a", "跨工作区唯一键");
  assert.equal(proposalDirOf("C:/proj/alpha", "add-a"), "C:/proj/alpha/openspec/changes/add-a");
  assert.equal(proposalDirOf("C:\\proj\\alpha", "add-a"), "C:/proj/alpha/openspec/changes/add-a", "反斜杠归一为正斜杠");
  assert.equal(proposalDirOf("C:/proj/alpha/", "add-a"), "C:/proj/alpha/openspec/changes/add-a", "尾部斜杠剔除");
  assert.equal(proposalDirOf("C://proj//alpha", "add-a"), "C:/proj/alpha/openspec/changes/add-a", "重复分隔符折叠");
  assert.equal(proposalDirOf("//server/share", "add-a"), "//server/share/openspec/changes/add-a", "UNC 前缀保留");
  assert.equal(proposalDirOf("/", "add-a"), "/openspec/changes/add-a", "根目录叠加");
  assert.equal(proposalDirOf("", "add-a"), "", "缺工作区路径 → 空（拒绝组装半截路径）");
  assert.equal(proposalDirOf("C:/p", ""), "", "缺提案名 → 空");
  assert.equal(proposalDirOf("C:/proj with space", "add a"), "C:/proj with space/openspec/changes/add a", "含空格原样（不加引号）");
}

/* ── 2. 银河态：全部分组 + 组内字典序 + 星胚剔除 + 四态数据 ── */
{
  const model = projectPanel(scene);
  assert.equal(model.visible, true);
  assert.equal(model.hasProposals, true);
  assert.equal(model.total, 5, "活跃提案 5 条（星胚不计入提案计数）");
  assert.equal(model.embryoTotal, 2, "星胚合并卡片 2 张（ws1 一张 + ws3 一张，均一锚点一组）");
  assert.equal(model.drillWsId, null);
  assert.deepEqual(model.groups.map((group) => group.wsName), ["alpha", "beta"], "分组按星座名字典序");
  const alpha = model.groups[0];
  assert.deepEqual(
    alpha.cards.filter((card) => !card.isEmbryo).map((card) => card.name),
    ["add-alpha", "add-beta", "add-broken", "add-gamma"],
    "组内正式提案按名称字典序（与骨架顺序解耦）"
  );
  assert.deepEqual(
    alpha.cards.filter((card) => card.isEmbryo).map((card) => card.slugs),
    [["proto-one"]],
    "星胚合并卡片追加于全部正式提案之后（MUST NOT 参与字典序混排）"
  );
  assert.equal(alpha.cards.find((card) => card.id === "add-gamma").lifecycle, "reviewed");
  assert.equal(alpha.cards.find((card) => card.id === "add-broken").lifecycle, "created", "非法 lifecycle → created 兜底");
  assert.deepEqual(alpha.cards.find((card) => card.id === "add-gamma").tasks, [1, 2], "tasks x/y 透传");
  assert.equal(alpha.cards.find((card) => card.id === "add-gamma").setBy, "cosmos-review", "setBy 透传");
  assert.equal(alpha.cards.find((card) => card.id === "add-gamma").at, 200, "at 透传");
  assert.equal(alpha.cards.find((card) => card.id === "add-alpha").setBy, null, "缺失 setBy → null（UI 省略徽标）");
  assert.equal(alpha.cards.find((card) => card.id === "add-alpha").at, null, "缺失 at → null");
  /* 沉睡判据（add-cosmos-action-prestate-gate 2.1）：act 纯加法透传 */
  assert.equal(alpha.cards.find((card) => card.id === "add-gamma").act, 0, "act 缺失 → 0（沉睡）");
  {
    const activeScene = {
      workspaces: [{
        id: "ws1",
        name: "alpha",
        path: "C:/proj/alpha",
        stars: [
          { id: "add-a", name: "add-a", lifecycle: "reviewed", tasks: [1, 2], act: 2 },
          { id: "add-b", name: "add-b", lifecycle: "reviewed", tasks: [0, 0], act: 0 }
        ]
      }]
    };
    const activeCards = projectPanel(activeScene).allCards;
    assert.equal(activeCards.find((card) => card.id === "add-a").act, 2, "act 直传（活跃计数）");
    assert.equal(activeCards.find((card) => card.id === "add-b").act, 0, "沉睡 act = 0");
  }
  /* 星胚合并卡片（add-cosmos-embryo-cards 3.1）：进入 allCards / 卡片形状 / 无 dir */
  const embryoCards = model.allCards.filter((card) => card.isEmbryo);
  assert.equal(embryoCards.length, 2, "星胚卡片全部进入 allCards（选中校验来源）");
  const protoCard = embryoCards.find((card) => card.wsId === "ws1");
  assert.equal(protoCard.key, embryoKeyOf("ws1", "sess-x"), "键 = proto 前缀 + wsId + 组键（NUL 分隔）");
  assert.notEqual(protoCard.key, proposalKeyOf("ws1", "proto-one"), "星胚键与提案键取值域隔离");
  assert.equal(protoCard.id, "proto-one", "id = 组内首 slug（DOM 钩子可读）");
  assert.equal(protoCard.lifecycle, "proto", "lifecycle = proto（四态之外的星胚态）");
  assert.equal(protoCard.sessionId, "sess-x", "组 sessionId 透传（星胚动作目标解析来源）");
  assert.deepEqual(protoCard.slugs, ["proto-one"], "组内 slug 清单");
  assert.equal(protoCard.at, 400, "组 at = 最早锚点时间");
  assert.deepEqual(protoCard.tasks, [0, 0], "星胚无任务进度");
  assert.equal(protoCard.act, 0, "星胚无关联会话 → 沉睡");
  assert.ok(!("dir" in protoCard), "星胚卡 MUST NOT 携带 dir（动作按无目标守卫降级）");
  assert.equal(
    model.allCards.find((card) => card.wsId === "ws3").sessionId,
    null,
    "缺 sessionId 的旧锚点 → null（无关联，独立成卡）"
  );
  assert.equal(alpha.cards[0].dir, "C:/proj/alpha/openspec/changes/add-alpha", "卡片携带 @目录（正斜杠）");
  assert.equal(model.groups[1].cards[0].dir, "C:/proj/beta/openspec/changes/add-z", "他工作区路径同源归一");
  assert.deepEqual(model.groups.map((group) => group.wsId), ["ws1", "ws2"], "无提案工作区（gamma）不生成分组（自动隐藏）");
  assert.ok(!model.groups.some((group) => group.wsId === "ws3"), "星胚工作区不进银河态分组");
  /* 搜索命中无提案工作区 → 同样不生成分组 */
  const hiddenByQuery = projectPanel(scene, { matchedIds: new Set(["ws3"]) });
  assert.equal(hiddenByQuery.groups.length, 0, "命中无提案工作区 → 无分组可显（不渲染空标题）");
  assert.equal(hiddenByQuery.total, 5, "计数仍为全部活跃提案");

  /* 确定性：重复投影逐字段一致 */
  assert.deepEqual(projectPanel(scene), model, "相同输入重复投影确定性");
  /* 骨架传入顺序不影响分组顺序 */
  const shuffled = { workspaces: [scene.workspaces[1], scene.workspaces[0]] };
  assert.deepEqual(projectPanel(shuffled).groups.map((g) => g.wsName), ["alpha", "beta"], "分组顺序与传入顺序解耦");
}

/* ── 3. 钻取过滤 + 空态口径（spec「钻取态列表过滤联动」） ── */
{
  const drilled = projectPanel(scene, { drillWsId: "ws1" });
  assert.equal(drilled.groups.length, 1, "钻取态仅当前星座");
  assert.equal(drilled.groups[0].wsName, "alpha");
  assert.equal(drilled.groups[0].cards.length, 5, "4 正式提案 + 1 星胚合并卡片");
  assert.equal(drilled.visible, true);
  assert.equal(drilled.allCards.length, 7, "allCards 不受钻取影响（5 提案 + 2 星胚卡；选中跨视图保留）");

  /* 银河态隐藏 vs 钻取态保留空态（同一工作区两种口径） */
  const drilledEmpty = projectPanel(scene, { drillWsId: "ws3" });
  assert.equal(drilledEmpty.groups.length, 1, "钻取无提案星座 → 仍渲染该分组（星胚照常呈现）");
  assert.equal(drilledEmpty.groups[0].wsName, "gamma");
  assert.equal(drilledEmpty.groups[0].cards.length, 1, "钻取仅星胚星座 → 呈现星胚卡片（非空态）");
  assert.equal(drilledEmpty.groups[0].cards[0].isEmbryo, true);
  assert.equal(drilledEmpty.visible, true, "钻取态面板仍渲染（与银河态零布局可区分）");
  assert.equal(drilledEmpty.total, 5, "钻取空星座不改变全量提案计数");

  /* 钻取无提案星座 → 面板仍渲染（空态文案由 UI 给） */
  const emptyScene = {
    workspaces: [{ id: "ws-empty", name: "gamma", path: "C:/proj/gamma", stars: [{ id: "p", name: "p", lifecycle: "proto" }] }]
  };
  const emptyDrill = projectPanel(emptyScene, { drillWsId: "ws-empty" });
  assert.equal(emptyDrill.visible, true, "钻取无提案星座 → 面板仍渲染（星胚卡片）");
  assert.equal(emptyDrill.groups[0].cards.length, 1, "仅星胚锚点 → 一张星胚卡片");
  assert.equal(emptyDrill.total, 0, "提案计数仍为 0（星胚不计入可见性判定）");

  /* 银河态全无提案 → 零布局 */
  const none = projectPanel(emptyScene);
  assert.equal(none.visible, false, "无任何活跃提案 → 面板不渲染（零布局）");

  /* 钻取目标消失（注销）→ 无分组、标记 missing */
  const gone = projectPanel(emptyScene, { drillWsId: "ws-gone" });
  assert.equal(gone.drillMissing, true);
  assert.equal(gone.groups.length, 0);
  assert.equal(gone.visible, false);
}

/* ── 4. 搜索过滤联动（spec「过滤命中子集分组联动」/「清空恢复」） ── */
{
  const matched = projectPanel(scene, { matchedIds: new Set(["ws2"]) });
  assert.deepEqual(matched.groups.map((g) => g.wsName), ["beta"], "未命中分组隐藏");
  assert.equal(matched.hasProposals, true, "hasProposals 不受搜索影响");
  assert.equal(matched.allCards.length, 7, "allCards 不受搜索影响（5 提案 + 2 星胚卡）");

  const clear = projectPanel(scene, { matchedIds: new Set(["ws1", "ws2"]) });
  assert.equal(clear.groups.length, 2, "清空/全命中恢复全量分组");

  const noneMatched = projectPanel(scene, { matchedIds: new Set() });
  assert.equal(noneMatched.groups.length, 0, "零命中 → 无分组");
  assert.equal(noneMatched.total, 5);

  /* 钻取 + 搜索叠加 */
  const drillSearch = projectPanel(scene, { drillWsId: "ws1", matchedIds: new Set(["ws2"]) });
  assert.equal(drillSearch.groups.length, 0, "钻取态下未命中 → 分组隐藏");
  assert.equal(drillSearch.visible, true, "钻取态面板仍渲染（含空态）");
}

/* ── 5. 选中语义（findCard / keepSelection） ── */
{
  const base = projectPanel(scene);
  const key = proposalKeyOf("ws1", "add-gamma");
  assert.ok(findCard(base, key), "选中卡片可查");
  assert.equal(keepSelection(base, key), key, "目标仍在骨架 → 选中保留");
  assert.equal(keepSelection(base, proposalKeyOf("ws1", "add-missing")), null, "目标消失（归档/注销）→ 清除选中");
  assert.equal(keepSelection(base, null), null, "未选中 → null");
  assert.equal(keepSelection(base, ""), null);

  /* 分组被搜索隐藏时选中保留（目标仍在骨架） */
  const hidden = projectPanel(scene, { matchedIds: new Set(["ws2"]) });
  assert.equal(keepSelection(hidden, key), key, "选中分组被隐藏 → 选中保留");
  /* 钻取其他星座时选中保留 */
  const otherDrill = projectPanel(scene, { drillWsId: "ws2" });
  assert.equal(keepSelection(otherDrill, key), key, "钻取其他星座 → 选中保留");

  /* 卡片移除后 SELECTION 清除 */
  const archived = { workspaces: scene.workspaces.map((ws) => (ws.id === "ws2" ? { ...ws, stars: [] } : ws)) };
  const afterArchive = projectPanel(archived);
  assert.equal(keepSelection(afterArchive, proposalKeyOf("ws2", "add-z")), null, "提案归档 → 选中清除");
}

/* ── 6. mergeScene `ws.path` 透传（D1 勘误：面板与 @组装共用同一来源） ── */
{
  const skeleton = {
    version: 1,
    workspaces: [
      { id: "ws", name: "proj", path: "C:\\proj\\alpha", stars: [{ id: "add-a", name: "add-a", lifecycle: "created", tasks: [1, 2] }], links: [], pending: [], archives: 0, associations: [] }
    ]
  };
  const merged = mergeScene({ skeleton, sessions: { ids: [], byId: {} }, workspaces: { items: [] }, now: 1 });
  assert.equal(merged.workspaces[0].path, "C:\\proj\\alpha", "工作区 path 随合并场景透传");
  const model = projectPanel(merged);
  assert.equal(model.groups[0].wsPath, "C:\\proj\\alpha");
  assert.equal(model.allCards[0].dir, "C:/proj/alpha/openspec/changes/add-a", "面板卡片 dir 由透传路径归一");

  const noPath = mergeScene({
    skeleton: { version: 1, workspaces: [{ id: "x", name: "x", stars: [], links: [], pending: [], archives: 0, associations: [] }] },
    sessions: { ids: [], byId: {} },
    workspaces: { items: [] }
  });
  assert.equal(noPath.workspaces[0].path, "", "缺 path → 空串（不虚构路径）");
}

/* ── 7. 点击探针：选中作用面判定（点击其他区域取消选中 / 切换卡片保持） ── */
{
  assert.ok(SELECTION_SURFACE_SELECTOR.includes(".dsh-cosmos-panel"), "作用面含面板");
  assert.ok(SELECTION_SURFACE_SELECTOR.includes(".dsh-cosmos-actions"), "作用面含动作条");
  assert.ok(SELECTION_SURFACE_SELECTOR.includes(".cos-search"), "作用面含搜索框（过滤联动保留选中）");

  /** 模拟 DOM：closest 命中任一作用面选择器时返回自身（选择器串按逗号包含匹配词）。 */
  const surfaceTarget = (selector) => ({
    closest: (query) => (String(query) === SELECTION_SURFACE_SELECTOR || String(query).includes(selector) ? {} : null)
  });
  assert.equal(isSelectionSurface(surfaceTarget(".dsh-cosmos-panel")), true, "面板内点击 → 保留选中（卡片切换）");
  assert.equal(isSelectionSurface(surfaceTarget(".dsh-cosmos-actions")), true, "动作条内点击 → 保留选中（按钮作用于目标）");
  /* 星座动作条是**面板 footer**（add-cosmos-constellation-actions D2）：点击落在面板作用面内
     → 不清除提案选中（按钮是否依赖选中是另一回事，见 3.1「恒可用」）。 */
  assert.equal(isSelectionSurface(surfaceTarget(".dsh-cosmos-const-action")), true, "星座动作按钮（面板 footer）内点击 → 不清选中");
  assert.equal(isSelectionSurface(surfaceTarget(".cos-search")), true, "搜索框内点击 → 保留选中（过滤联动）");
  assert.equal(isSelectionSurface({ closest: () => null }), false, "画布/其他区域点击 → 清除选中");
  assert.equal(isSelectionSurface(null), false, "无目标 → 清除（保守）");
  assert.equal(isSelectionSurface({}), false, "非 Element（无 closest）→ 清除");
  assert.equal(isSelectionSurface({ closest: () => { throw new Error("boom"); } }), false, "探针异常 → 清除（不抛错）");

  /* 切换提案 = 仅换键：两个卡片均有效，动作目标随之切换且不产生「清除」中间态。 */
  const model = projectPanel(scene);
  const keyA = proposalKeyOf("ws1", "add-alpha");
  const keyB = proposalKeyOf("ws1", "add-beta");
  assert.ok(findCard(model, keyA) && findCard(model, keyB), "两张卡片都可作为动作目标");
  const selected = keyB; // 由 A 切到 B：选中键单值替换，动作条可用态不翻转
  assert.equal(findCard(model, selected)?.key, keyB, "切换后动作目标为新提案");
  assert.equal(keepSelection(model, selected), keyB, "切换后选中仍有效（动作条保持点亮）");
}

/* ── 8. 会话列表面板投影（add-cosmos-session-list-panel 1.1–1.3 /
      spec cosmos-session-list「视图作用域与分组投影」「活跃口径与行内容」） ── */
{
  const planetOf = (id, extra = {}) => ({
    id, title: id, state: "idle", pendingKind: null, stars: ["s1"], todos: "—", when: "刚刚",
    updatedAt: 100, satellites: [], satelliteCount: 0, delegatedBusy: false, ...extra
  });
  const cometOf = (id, extra = {}) => ({
    id, title: id, state: "idle", pendingKind: null, todos: "—", when: "刚刚",
    updatedAt: 100, satellites: [], satelliteCount: 0, delegatedBusy: false, ...extra
  });
  const sessionScene = {
    workspaces: [
      {
        id: "ws1", name: "alpha", pos: [0, 0, 0], stars: [], links: [],
        planets: [
          planetOf("pA", { state: "waiting", pendingKind: "approval", todos: "1/2", satelliteCount: 3, updatedAt: 1000 }),
          /* 非 waiting 的残留 pendingKind → 行内 MUST NOT 携带分类（尾注不替换） */
          planetOf("pB", { pendingKind: "approval", updatedAt: 3000 })
        ],
        comets: [cometOf("cA", { state: "busy", updatedAt: 2000 })]
      },
      {
        id: "ws2", name: "beta", pos: [400, 0, 0], stars: [], links: [],
        planets: [
          planetOf("pC", { state: "done-unread", updatedAt: 2500 }),
          /* 同 updatedAt → id 字典序兜底（确定性） */
          planetOf("pT", { state: "idle", updatedAt: 2500 })
        ],
        comets: [
          /* 父待机 ∧ 直属子代理执行中 → 委托 loader 口径 */
          cometOf("cB", { delegatedBusy: true, updatedAt: 1500 }),
          cometOf("cW", { state: "waiting", pendingKind: "weird", updatedAt: 900 })
        ]
      },
      /* 无活跃会话的星座：银河态不占位；钻取态保留分组标题 + 空态 */
      { id: "ws3", name: "gamma", pos: [800, 0, 0], stars: [], links: [], planets: [], comets: [] }
    ]
  };

  /* 银河态：全部分组（星座名序）、组头计数、组内 updatedAt 降序 + 同分 id 兜底。 */
  const galaxy = projectSessionPanel(sessionScene);
  assert.equal(galaxy.visible, true, "面板本体恒可用（空态也保留）");
  assert.deepEqual(galaxy.groups.map((group) => group.wsName), ["alpha", "beta"], "银河态全星座分组按星座名排序（无会话星座不占位）");
  assert.deepEqual(galaxy.groups.map((group) => group.count), [3, 4], "组头 = 星座名 + 会话数");
  assert.deepEqual(galaxy.groups[0].sessions.map((row) => row.id), ["pB", "cA", "pA"], "组内 updatedAt 降序");
  assert.deepEqual(galaxy.groups[1].sessions.map((row) => row.id), ["pC", "pT", "cB", "cW"], "同 updatedAt → id 字典序兜底");
  assert.equal(galaxy.total, 7, "total = 全量活跃会话（行星 ∪ 彗星）");
  assert.equal(galaxy.scopeTotal, 7, "银河作用域行数 = 全量");
  assert.equal(galaxy.waiting, 2, "waiting = 全量待决策计数（pA approval + cW other）");
  assert.equal(galaxy.drillWsId, null);
  assert.equal(galaxy.drillMissing, false);

  /* 行装配：形态标记 / 四态 / 分类 / todos / 卫星徽标 / 委托 loader / 相对时间。 */
  const rowOf = (model, id) => model.allSessions.find((row) => row.id === id);
  const pA = rowOf(galaxy, "pA");
  assert.equal(pA.kind, "planet", "行星形态标记（关联提案）");
  assert.equal(pA.state, "waiting", "待决策态透传");
  assert.equal(pA.pendingKind, "approval", "approval 分类透传");
  assert.deepEqual([pA.todos, pA.satelliteCount, pA.updatedAt, pA.when], ["1/2", 3, 1000, "刚刚"], "todos/卫星计数/时间装配");
  assert.equal(pA.delegatedBusy, false);
  assert.equal(rowOf(galaxy, "cA").kind, "comet", "彗星形态标记（自由会话）");
  assert.equal(rowOf(galaxy, "cA").state, "busy", "自身执行中 → loader 态");
  const cB = rowOf(galaxy, "cB");
  assert.equal(cB.state, "busy", "delegatedBusy → loader 态（父待机 ∧ 直属子代理执行中）");
  assert.equal(cB.delegatedBusy, true, "delegatedBusy 透传");
  assert.equal(cB.pendingKind, null, "非 waiting 行无分类文案");
  assert.equal(rowOf(galaxy, "pC").state, "done-unread", "完成未读态透传");
  assert.equal(rowOf(galaxy, "pB").state, "idle", "待机态（UI 行内无点）");
  assert.equal(rowOf(galaxy, "pB").pendingKind, null, "非 waiting 行 MUST NOT 携带分类（残留 pendingKind 被净化）");
  assert.equal(rowOf(galaxy, "cW").pendingKind, "other", "未知 pendingKind → other（MUST NOT 丢点）");
  assert.ok(!galaxy.allSessions.some((row) => row.id.startsWith("sat")), "卫星（子代理会话）不产行");
  assert.ok(!galaxy.allSessions.some((row) => row.wsId === "ws3"), "无会话星座不产行");

  /* 钻取态：仅当前星座；allSessions/total/waiting 不受钻取影响。 */
  const drilled = projectSessionPanel(sessionScene, { drillWsId: "ws1" });
  assert.deepEqual(drilled.groups.map((group) => group.wsName), ["alpha"], "钻取态仅当前星座");
  assert.equal(drilled.groups[0].count, 3);
  assert.equal(drilled.scopeTotal, 3, "面板标题计数 = 当前作用域");
  assert.equal(drilled.total, 7, "total 不受钻取影响");
  assert.equal(drilled.waiting, 2, "标题栏徽标计数全局（钻取到无待决策星座时不消失）");
  assert.equal(drilled.visible, true);
  assert.equal(drilled.drillMissing, false);
  assert.equal(drilled.drillName, "alpha", "钻取星座名透传");

  const emptyDrill = projectSessionPanel(sessionScene, { drillWsId: "ws3" });
  assert.equal(emptyDrill.groups.length, 1, "钻取无会话星座 → 分组标题保留（空态）");
  assert.equal(emptyDrill.groups[0].count, 0);
  assert.equal(emptyDrill.scopeTotal, 0);
  assert.equal(emptyDrill.total, 7);
  assert.equal(emptyDrill.visible, true);

  const gone = projectSessionPanel(sessionScene, { drillWsId: "ws-gone" });
  assert.equal(gone.drillMissing, true, "钻取目标注销 → missing");
  assert.equal(gone.groups.length, 0);
  assert.equal(gone.visible, true, "面板本体仍渲染（空态提示）");

  /* 空态：无任何活跃会话时银河态呈现空态（面板本体保留）；场景未就绪不抛错。 */
  const empty = projectSessionPanel({ workspaces: [{ id: "x", name: "x", stars: [], planets: [], comets: [] }] });
  assert.equal(empty.groups.length, 0);
  assert.deepEqual([empty.total, empty.scopeTotal, empty.waiting], [0, 0, 0]);
  assert.equal(empty.visible, true, "无活跃会话 → 空态提示（面板本体保留）");
  const noScene = projectSessionPanel(null);
  assert.deepEqual([noScene.total, noScene.scopeTotal, noScene.waiting, noScene.groups.length], [0, 0, 0, 0], "场景未就绪 → 空投影");
  assert.equal(noScene.visible, true);

  /* 确定性：重复投影逐字段一致；分组/组内排序与输入顺序解耦。 */
  assert.deepEqual(projectSessionPanel(sessionScene), galaxy, "相同输入重复投影确定性");
  const shuffled = { workspaces: [sessionScene.workspaces[2], sessionScene.workspaces[1], sessionScene.workspaces[0]] };
  const shuffledModel = projectSessionPanel(shuffled);
  assert.deepEqual(shuffledModel.groups.map((group) => group.wsName), ["alpha", "beta"], "分组顺序与输入顺序解耦");
  assert.deepEqual(shuffledModel.groups[1].sessions.map((row) => row.id), ["pC", "pT", "cB", "cW"], "组内排序与输入顺序解耦");

  /* 降级路径（statuses 不可达 → 场景只有 idle/busy 两态）：投影原样透传，零额外分支。 */
  const degradedScene = {
    workspaces: [{
      id: "wd", name: "deg", stars: [], links: [],
      planets: [planetOf("d1", { state: "busy" }), planetOf("d2", { state: "idle" })],
      comets: [cometOf("d3", { state: "busy" })]
    }]
  };
  const degraded = projectSessionPanel(degradedScene);
  assert.deepEqual(degraded.allSessions.map((row) => row.state), ["busy", "idle", "busy"], "降级两态逐行透传");
  assert.ok(degraded.allSessions.every((row) => row.state === "idle" || row.state === "busy"), "降级路径无 waiting/done-unread 幽灵态");
  assert.equal(degraded.waiting, 0);
}

/* ── 9. 会话行纯函数：键 / 分类归一 / 四态优先级（design D3） ── */
{
  assert.equal(sessionKeyOf("ws1", "s1"), "ws1\u0000s1", "行键跨星座唯一");
  assert.equal(sessionKeyOf(null, null), "\u0000");
  assert.equal(pendingCategoryOf("approval"), "approval");
  assert.equal(pendingCategoryOf("plan-review"), "plan", "宿主枚举 plan-review → plan");
  assert.equal(pendingCategoryOf("plan"), "plan", "历史别名 plan 一并接受");
  assert.equal(pendingCategoryOf("question"), "question");
  for (const bad of [null, undefined, "", "weird", 42, {}, []]) {
    assert.equal(pendingCategoryOf(bad), "other", "未知分类 → other：" + String(bad));
  }

  assert.equal(sessionRowStateOf("waiting", true), "waiting", "waiting 优先于 loader");
  assert.equal(sessionRowStateOf("waiting", false), "waiting");
  assert.equal(sessionRowStateOf("busy", false), "busy");
  assert.equal(sessionRowStateOf("idle", true), "busy", "委托 loader 优先于 idle");
  assert.equal(sessionRowStateOf("done-unread", true), "busy", "loader 优先于 done-unread（DSH 行优先级）");
  assert.equal(sessionRowStateOf("done-unread", false), "done-unread");
  assert.equal(sessionRowStateOf("idle", false), "idle");
  assert.equal(sessionRowStateOf(undefined, false), "idle", "非法状态 → idle 兜底");
  assert.equal(sessionRowStateOf(undefined, true), "busy", "非法状态 + 委托执行中 → loader 兜底");
}

/* ── 10. 星胚合并卡片（add-cosmos-embryo-cards 3.1/3.2/3.4/3.5） ── */
{
  const embryoScene = {
    workspaces: [
      {
        id: "wsA",
        name: "alpha",
        path: "C:/proj/alpha",
        stars: [
          { id: "zzz-last", name: "zzz-last", lifecycle: "created", tasks: [0, 1] },
          { id: "add-x", name: "add-x", lifecycle: "proto", sessionId: "sess-1", at: 300, setBy: "cosmos-explore", tasks: [0, 0] },
          { id: "add-y", name: "add-y", lifecycle: "proto", sessionId: "sess-1", at: 100, setBy: "cosmos-explore", tasks: [0, 0] },
          { id: "add-z", name: "add-z", lifecycle: "proto", sessionId: "sess-1", at: 200, setBy: "cosmos-explore", tasks: [0, 0] },
          { id: "old-a", name: "old-a", lifecycle: "proto", at: 50, tasks: [0, 0] },
          { id: "old-b", name: "old-b", lifecycle: "proto", at: null, tasks: [0, 0] }
        ]
      },
      {
        id: "wsB",
        name: "beta",
        path: "C:/proj/beta",
        stars: [{ id: "only-proto", name: "only-proto", lifecycle: "proto", sessionId: "sess-2", at: 10, tasks: [0, 0] }]
      }
    ]
  };
  const model = projectPanel(embryoScene);
  assert.deepEqual(model.groups.map((g) => g.wsName), ["alpha"], "仅星胚工作区（beta）不生成分组（星胚不触发分组）");
  assert.equal(model.visible, true, "存在活跃提案 → 银河态面板渲染");
  assert.equal(model.total, 1, "提案计数 1（zzz-last）");
  assert.equal(model.embryoTotal, 4, "星胚组 4 张（sess-1 合并 1 + 旧锚点 2 + beta 1）");
  const cards = model.groups[0].cards;
  assert.deepEqual(
    cards.map((card) => (card.isEmbryo ? "embryo:" + card.key : card.name)),
    [
      "zzz-last",
      "embryo:" + embryoKeyOf("wsA", "sess-1"),
      "embryo:" + embryoKeyOf("wsA", "old-a"),
      "embryo:" + embryoKeyOf("wsA", "old-b")
    ],
    "排序：正式提案（字典序）在前，星胚卡按组间首 slug 字典序追加于后（'zzz-last' 仍先于星胚 → 不参与混排）"
  );
  const merged = cards[1];
  assert.deepEqual(merged.slugs, ["add-x", "add-y", "add-z"], "同会话 3 锚点归并为 1 张卡（slug 逐行清单字典序）");
  assert.equal(merged.sessionId, "sess-1", "组 sessionId 透传");
  assert.equal(merged.at, 100, "组 at 取最早锚点（非首 slug 的 at）");
  assert.equal(merged.isEmbryo, true);
  assert.equal(merged.lifecycle, "proto");
  assert.ok(!("dir" in merged), "星胚卡不携带 dir");
  assert.equal(cards[2].sessionId, null, "旧锚点各自成卡（无关联）");
  assert.equal(cards[2].at, 50, "旧锚点 at 照常");
  assert.equal(cards[3].at, null, "at 全缺 → null（UI 省略时间徽标）");
  /* 仅星胚工作区的卡片在 allCards（选中校验）但无分组（银河不呈现） */
  assert.ok(model.allCards.some((card) => card.wsId === "wsB" && card.isEmbryo), "星胚卡进入 allCards");
  assert.ok(!model.groups.some((group) => group.wsId === "wsB"), "星胚不占空分组位");
  /* 银河态零布局：全部工作区仅星胚 */
  const onlyEmbryo = projectPanel({ workspaces: [embryoScene.workspaces[1]] });
  assert.equal(onlyEmbryo.visible, false, "仅星胚 → 面板零布局（不渲染零分组空壳）");
  assert.equal(onlyEmbryo.groups.length, 0);
  assert.equal(onlyEmbryo.total, 0);
  assert.equal(onlyEmbryo.allCards.length, 1, "星胚卡仍在 allCards（钻取/选中可查）");
  /* 钻取仅星胚星座 → 照常呈现分组与卡片 */
  const drilled = projectPanel(embryoScene, { drillWsId: "wsB" });
  assert.deepEqual(drilled.groups.map((g) => g.wsName), ["beta"]);
  assert.deepEqual(drilled.groups[0].cards.map((card) => card.slugs), [["only-proto"]], "钻取态呈现星胚卡片");

  /* 搜索谓词（3.2）：工作区名 ∪ 星胚 slug；正式提案名不参与 */
  assert.deepEqual([...matchWorkspaces(embryoScene, "add-y")], ["wsA"], "星胚 slug 命中 → 工作区命中");
  assert.deepEqual([...matchWorkspaces(embryoScene, "only-proto")], ["wsB"], "仅星胚工作区也可被 slug 命中（面板无分组可显）");
  assert.deepEqual([...matchWorkspaces(embryoScene, "zzz-last")], [], "正式提案名 MUST NOT 参与匹配");
  assert.deepEqual([...matchWorkspaces(embryoScene, "alpha add-z")], ["wsA"], "多 token AND（名称 + slug 跨域）");
  const searched = projectPanel(embryoScene, { matchedIds: matchWorkspaces(embryoScene, "add-y") });
  assert.deepEqual(searched.groups.map((g) => g.wsName), ["alpha"], "星胚 slug 命中 → 分组呈现（组内不过滤）");
  assert.equal(searched.groups[0].cards.length, 4, "组内正式提案与星胚卡片一并展示");
  assert.equal(
    projectPanel(embryoScene, { matchedIds: matchWorkspaces(embryoScene, "only-proto") }).groups.length,
    0,
    "命中仅星胚工作区 → 无分组可显"
  );

  /* 选中（3.4）：星胚键可选中 / 消失清除 / 与提案键互不干扰 */
  const mergedKey = embryoKeyOf("wsA", "sess-1");
  assert.equal(findCard(model, mergedKey)?.key, mergedKey, "星胚键可作为动作目标");
  assert.equal(keepSelection(model, mergedKey), mergedKey, "锚点仍在 → 选中保留");
  const litScene = {
    workspaces: [{
      id: "wsA",
      name: "alpha",
      path: "C:/proj/alpha",
      stars: [
        /* 星胚被 ff 点燃：同名提案目录出现且锚点删除 → 该组整体从骨架消失 */
        { id: "add-x", name: "add-x", lifecycle: "created", tasks: [0, 1] },
        { id: "add-y", name: "add-y", lifecycle: "created", tasks: [0, 1] }
      ]
    }]
  };
  assert.equal(keepSelection(projectPanel(litScene), mergedKey), null, "星胚组从骨架消失（ff 点燃/锚点删除）→ 选中清除");
  assert.ok(findCard(model, proposalKeyOf("wsA", "zzz-last")), "提案键照常可查（与星胚键互不干扰）");
}

console.log("panel-smoke: all assertions passed");