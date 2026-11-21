/**
 * 提案列表面板投影冒烟（add-cosmos-proposal-actions 3.1/3.6 / cosmos-proposal-panel；
 * add-cosmos-embryo-cards 3.1/3.2/3.5；add-cosmos-galaxy-embryo-cards 3.1–3.4；
 * add-cosmos-panel-birthline-sort 4.3）：分组与**组内孕育时间线**排序（谱系块装配 /
 * 星胚卡块头 / 点燃提案创建顺序 / ignitedMs 次序兜底 / birthMs 兜底块 / 台账缺席回落 /
 * 旧锚点 solo 块 / 确定性）、星胚合并卡片（归并/银河态触发分组/不携带 dir）、钻取过滤、
 * 搜索过滤联动（工作区名 ∪ 星胚 slug，含仅星胚工作区命中呈现）、选中保留语义、空态可见性
 * （活跃提案 ∨ 星胚锚点）、确定性；mergeScene `ws.path` 透传（D1 勘误）；以及
 * p1-add-cosmos-card-progress-bars 4.1 的进度数字对派生（会话行 todos 解析 / 提案卡 tasks
 * 直取 / 星胚恒 null）。
 * 运行：node test/panel-smoke.mjs
 */
import assert from "node:assert/strict";
import {
  SELECTION_SURFACE_SELECTOR,
  birthlineBlocksOf,
  cardIsLinkedOf,
  crossHoverTargets,
  embryoKeyOf,
  findCard,
  hoverSourceAlive,
  isSelectionSurface,
  keepSelection,
  pendingCategoryOf,
  projectPanel,
  projectSessionPanel,
  proposalDirOf,
  proposalKeyOf,
  rowIsLinkedOf,
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
      /* 仅星胚锚点的工作区（零正式提案）→ 银河态照常生成分组（组内仅星胚合并卡片）。 */
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
  assert.deepEqual(model.groups.map((group) => group.wsName), ["alpha", "beta", "gamma"], "分组按星座名字典序（仅星胚星座同样参与全序）");
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
  /* 进度数字对（p1-add-cosmos-card-progress-bars 1.2/4.1）：正式卡直取 tasks；y=0 → null。 */
  assert.deepEqual(alpha.cards.find((card) => card.id === "add-gamma").progress, { done: 1, total: 2 }, "提案卡 progress = tasks 直取");
  assert.equal(alpha.cards.find((card) => card.id === "add-broken").progress, null, "tasks [0,0] → progress null（y=0 门控）");
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
  assert.equal(protoCard.progress, null, "星胚合并卡 progress 恒 null（无任务进度行纪律）");
  assert.equal(protoCard.act, 0, "星胚 act 缺失（scene 未聚合）→ 0（沉睡，门控通用兜底）");
  assert.ok(!("dir" in protoCard), "星胚卡 MUST NOT 携带 dir（动作按无目标守卫降级）");
  assert.equal(
    model.allCards.find((card) => card.wsId === "ws3").sessionId,
    null,
    "缺 sessionId 的旧锚点 → null（无关联，独立成卡）"
  );
  assert.equal(
    alpha.cards.find((card) => card.id === "add-alpha").dir,
    "C:/proj/alpha/openspec/changes/add-alpha",
    "卡片携带 @目录（正斜杠）"
  );
  assert.equal(model.groups[1].cards[0].dir, "C:/proj/beta/openspec/changes/add-z", "他工作区路径同源归一");
  assert.deepEqual(model.groups.map((group) => group.wsId), ["ws1", "ws2", "ws3"], "分组条件 = 活跃提案 ∨ 星胚锚点（仅星胚的 gamma 亦生成分组）");
  const gammaGroup = model.groups.find((group) => group.wsId === "ws3");
  assert.deepEqual(gammaGroup.cards.map((card) => card.isEmbryo), [true], "仅星胚分组组内仅星胚合并卡片");
  assert.deepEqual(gammaGroup.cards[0].slugs, ["proto-gamma"], "星胚卡片 slug 清单（合并卡呈现）");
  /* 搜索命中仅星胚工作区 → 该分组可呈现（详测见 3.3 场景块） */
  const hitOnlyEmbryo = projectPanel(scene, { matchedIds: new Set(["ws3"]) });
  assert.deepEqual(hitOnlyEmbryo.groups.map((group) => group.wsName), ["gamma"], "命中仅星胚工作区 → 分组呈现");
  assert.equal(hitOnlyEmbryo.total, 5, "计数仍为全部活跃提案");

  /* 确定性：重复投影逐字段一致 */
  assert.deepEqual(projectPanel(scene), model, "相同输入重复投影确定性");
  /* 骨架传入顺序不影响分组顺序 */
  const shuffled = { workspaces: [scene.workspaces[2], scene.workspaces[1], scene.workspaces[0]] };
  assert.deepEqual(projectPanel(shuffled).groups.map((g) => g.wsName), ["alpha", "beta", "gamma"], "分组顺序与传入顺序解耦（仅星胚星座同样参与全序）");
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
  assert.equal(emptyDrill.total, 0, "提案计数仍为 0（星胚不计入正式提案计数）");

  /* 银河态：全部工作区仅星胚 → 面板照常渲染（3.2：MUST NOT 零布局） */
  const onlyEmbryoGalaxy = projectPanel(emptyScene);
  assert.equal(onlyEmbryoGalaxy.visible, true, "仅星胚锚点 → 银河态面板照常渲染（MUST NOT 零布局）");
  assert.equal(onlyEmbryoGalaxy.hasProposals, false, "hasProposals 仍按正式提案口径（无正式提案 → false）");
  assert.equal(onlyEmbryoGalaxy.total, 0, "主计数仍为 0（星胚不计入正式提案数）");
  assert.equal(onlyEmbryoGalaxy.embryoTotal, 1, "星胚数独立计数（头部附注徽标数据源）");
  assert.deepEqual(onlyEmbryoGalaxy.groups.map((group) => group.wsName), ["gamma"], "仅星胚星座照常生成分组");
  assert.deepEqual(onlyEmbryoGalaxy.groups[0].cards.map((card) => card.isEmbryo), [true], "组内仅星胚合并卡片");

  /* 银河态无提案且无锚点 → 零布局（spec「无提案且无锚点零布局」） */
  const none = projectPanel({ workspaces: [{ id: "ws-blank", name: "delta", path: "C:/proj/delta", stars: [] }] });
  assert.equal(none.visible, false, "无活跃提案且无星胚锚点 → 面板不渲染（零布局）");
  assert.equal(none.groups.length, 0, "不生成空分组/空标题占位");
  assert.equal(none.embryoTotal, 0, "星胚计数 0");

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

  const clear = projectPanel(scene, { matchedIds: new Set(["ws1", "ws2", "ws3"]) });
  assert.equal(clear.groups.length, 3, "清空/全命中恢复全量分组（含仅星胚星座）");

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

/* ── 8b. 进度数字对派生（p1-add-cosmos-card-progress-bars 1.1/1.2/4.1 / design D3） ── */
{
  /* 会话行：todos 徽标字符串 → progress 数字对（防御解析；文本徽标原样保留）。 */
  const rowOf = (todos) => {
    const scene = {
      workspaces: [{
        id: "w", name: "w", stars: [], comets: [],
        planets: [{ id: "p", title: "p", state: "idle", todos, when: "刚刚", updatedAt: 1 }]
      }]
    };
    return projectSessionPanel(scene).allSessions[0];
  };
  assert.deepEqual(rowOf("2/5").progress, { done: 2, total: 5 }, "会话行 \"2/5\" → {done:2,total:5}");
  assert.deepEqual(rowOf("0/4").progress, { done: 0, total: 4 }, "\"0/4\" → {0,4}（全空轨仍渲染）");
  assert.deepEqual(rowOf("7/20").progress, { done: 7, total: 20 }, "\"7/20\" 数字对原样（上限退化属呈现层）");
  assert.equal(rowOf("2/5").todos, "2/5", "todos 文本徽标保留（条为比例增强，非数字替代）");
  assert.equal(rowOf("—").progress, null, "\"—\" → null（无 todos 不渲染进度条）");
  for (const bad of ["2/5x", "a/b", "5/2", "0/0", "2", "2/", "/5", " 2/5", "2/5\n", "-1/5", "1.5/2", 42, null, undefined]) {
    assert.equal(rowOf(bad).progress, null, "格式外/越界 todos → null（MUST NOT 抛错）：" + JSON.stringify(bad));
  }

  /* 提案卡：tasks 直取（`tasks[1] > 0` 才给值）；星胚合并卡恒 null。 */
  const cardScene = {
    workspaces: [{
      id: "wsC",
      name: "gamma",
      path: "C:/proj/gamma",
      stars: [
        { id: "add-a", name: "add-a", lifecycle: "reviewed", tasks: [3, 7] },
        { id: "add-b", name: "add-b", lifecycle: "created", tasks: [0, 0] },
        { id: "add-c", name: "add-c", lifecycle: "created", tasks: [0, 4] }
      ]
    }]
  };
  const cards = projectPanel(cardScene).allCards;
  assert.deepEqual(cards.find((card) => card.id === "add-a").progress, { done: 3, total: 7 }, "提案卡 tasks [3,7] → progress 直取");
  assert.equal(cards.find((card) => card.id === "add-b").progress, null, "tasks [0,0] → null（y=0 不渲染）");
  assert.deepEqual(cards.find((card) => card.id === "add-c").progress, { done: 0, total: 4 }, "tasks [0,4] → 全空轨进度");

  const embryoScene = {
    workspaces: [{
      id: "wsE",
      name: "delta",
      path: "C:/proj/delta",
      stars: [{ id: "proto-x", name: "proto-x", lifecycle: "proto", sessionId: "s1", at: 10, tasks: [3, 7] }]
    }]
  };
  const embryoCard = projectPanel(embryoScene).allCards[0];
  assert.equal(embryoCard.isEmbryo, true, "星胚合并卡进入 allCards");
  assert.equal(embryoCard.progress, null, "星胚卡即使骨架带 tasks 也恒 null（排除纪律）");
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
  assert.deepEqual(model.groups.map((g) => g.wsName), ["alpha", "beta"], "仅星胚工作区（beta）照常生成分组（分组条件 = 活跃提案 ∨ 星胚锚点）");
  assert.equal(model.visible, true, "存在活跃提案 → 银河态面板渲染");
  assert.equal(model.total, 1, "提案计数 1（zzz-last）");
  assert.equal(model.embryoTotal, 4, "星胚组 4 张（sess-1 合并 1 + 旧锚点 2 + beta 1）");
  const cards = model.groups[0].cards;
  assert.deepEqual(
    cards.map((card) => (card.isEmbryo ? "embryo:" + card.key : card.name)),
    [
      "embryo:" + embryoKeyOf("wsA", "old-a"),
      "embryo:" + embryoKeyOf("wsA", "sess-1"),
      "embryo:" + embryoKeyOf("wsA", "old-b"),
      "zzz-last"
    ],
    "组内孕育时间线排序：old-a（at 50）→ sess-1（at 100）→ 无时间块（old-b solo / zzz-last 恒星族，块键码点序）；星胚卡为其谱系块头"
  );
  const merged = cards[1];
  assert.deepEqual(merged.slugs, ["add-x", "add-y", "add-z"], "同会话 3 锚点归并为 1 张卡（slug 逐行清单字典序）");
  assert.equal(merged.sessionId, "sess-1", "组 sessionId 透传");
  assert.equal(merged.at, 100, "组 at 取最早锚点（非首 slug 的 at）");
  assert.equal(merged.isEmbryo, true);
  assert.equal(merged.lifecycle, "proto");
  assert.ok(!("dir" in merged), "星胚卡不携带 dir");
  assert.equal(cards[2].sessionId, null, "旧锚点各自成卡（无关联）");
  assert.equal(cards[2].at, null, "at 全缺 → null（UI 省略时间徽标）");
  assert.equal(cards[0].at, 50, "旧锚点 at 照常（solo 块时间 = 锚点 at）");
  /* 星胚卡 act 透传（keep-embryo-active-while-exploring 2.2/3.2）：组 act = 组内 proto 星
     act 最大值（锚点探索会话活跃度），panel 纯加法透传 → 动作条门控直接消费。 */
  {
    const embryoActiveScene = {
      workspaces: [{
        id: "wsE",
        name: "embryo-active",
        path: "C:/proj/embryo",
        stars: [
          { id: "e-a", name: "e-a", lifecycle: "proto", sessionId: "sess-E", at: 1, tasks: [0, 0], act: 1 },
          { id: "e-b", name: "e-b", lifecycle: "proto", sessionId: "sess-E", at: 2, tasks: [0, 0], act: 0 },
          { id: "e-solo", name: "e-solo", lifecycle: "proto", at: 3, tasks: [0, 0], act: 0 }
        ]
      }]
    };
    const embryoCards = projectPanel(embryoActiveScene).allCards.filter((card) => card.isEmbryo);
    assert.equal(embryoCards.find((card) => card.sessionId === "sess-E").act, 1, "组内任一锚点 act=1 → 组卡 act=1（探索会话进行中）");
    assert.equal(embryoCards.find((card) => card.sessionId === "sess-E").slugs.length, 2, "同会话仍归并为一张卡（act 透传不改分组）");
    assert.equal(embryoCards.find((card) => card.sessionId === null).act, 0, "自组星胚按自身 act 透传（沉睡 0）");
  }
  /* 仅星胚工作区：卡片进入 allCards（选中校验）**且**生成分组（银河态可呈现） */
  assert.ok(model.allCards.some((card) => card.wsId === "wsB" && card.isEmbryo), "星胚卡进入 allCards");
  const betaGroup = model.groups.find((group) => group.wsId === "wsB");
  assert.ok(betaGroup, "仅星胚工作区生成分组（银河态可呈现）");
  assert.deepEqual(betaGroup.cards.map((card) => card.isEmbryo), [true], "组内仅星胚合并卡片（无空态占位）");
  assert.deepEqual(betaGroup.cards[0].slugs, ["only-proto"], "星胚卡 slug 清单");
  /* 银河态：全部工作区仅星胚 → 面板照常渲染（3.2 断言翻转） */
  const onlyEmbryo = projectPanel({ workspaces: [embryoScene.workspaces[1]] });
  assert.equal(onlyEmbryo.visible, true, "仅星胚 → 面板照常渲染（MUST NOT 零布局）");
  assert.deepEqual(onlyEmbryo.groups.map((g) => g.wsName), ["beta"], "仅星胚星座生成分组");
  assert.deepEqual(onlyEmbryo.groups[0].cards.map((card) => card.isEmbryo), [true], "组内仅星胚卡");
  assert.equal(onlyEmbryo.total, 0, "主计数 0（无正式提案）");
  assert.equal(onlyEmbryo.embryoTotal, 1, "星胚计数 1（头部附注徽标数据源）");
  assert.equal(onlyEmbryo.hasProposals, false, "hasProposals 保持原语义（total > 0）");
  assert.equal(onlyEmbryo.allCards.length, 1, "星胚卡仍在 allCards（钻取/选中可查）");
  /* 钻取仅星胚星座 → 照常呈现分组与卡片 */
  const drilled = projectPanel(embryoScene, { drillWsId: "wsB" });
  assert.deepEqual(drilled.groups.map((g) => g.wsName), ["beta"]);
  assert.deepEqual(drilled.groups[0].cards.map((card) => card.slugs), [["only-proto"]], "钻取态呈现星胚卡片");

  /* 搜索谓词（3.2）：工作区名 ∪ 星胚 slug；正式提案名不参与 */
  assert.deepEqual([...matchWorkspaces(embryoScene, "add-y")], ["wsA"], "星胚 slug 命中 → 工作区命中");
  assert.deepEqual([...matchWorkspaces(embryoScene, "only-proto")], ["wsB"], "仅星胚工作区也可被 slug 命中（分组随之呈现）");
  assert.deepEqual([...matchWorkspaces(embryoScene, "zzz-last")], [], "正式提案名 MUST NOT 参与匹配");
  assert.deepEqual([...matchWorkspaces(embryoScene, "alpha add-z")], ["wsA"], "多 token AND（名称 + slug 跨域）");
  const searched = projectPanel(embryoScene, { matchedIds: matchWorkspaces(embryoScene, "add-y") });
  assert.deepEqual(searched.groups.map((g) => g.wsName), ["alpha"], "星胚 slug 命中 → 分组呈现（组内不过滤）");
  assert.equal(searched.groups[0].cards.length, 4, "组内正式提案与星胚卡片一并展示");
  /* 3.3：仅星胚工作区被 slug 命中 → 分组呈现（组内仅星胚卡；断言翻转） */
  const onlyEmbryoHit = projectPanel(embryoScene, { matchedIds: matchWorkspaces(embryoScene, "only-proto") });
  assert.deepEqual(onlyEmbryoHit.groups.map((g) => g.wsName), ["beta"], "命中仅星胚工作区 → 分组呈现（MUST NOT 因无正式提案被隐藏）");
  assert.deepEqual(onlyEmbryoHit.groups[0].cards.map((card) => card.isEmbryo), [true], "组内仅星胚合并卡片（matchedIds 过滤后不丢卡）");
  assert.deepEqual(onlyEmbryoHit.groups[0].cards[0].slugs, ["only-proto"], "命中呈现的星胚卡 slug 清单");
  assert.equal(onlyEmbryoHit.groups[0].matched, true, "命中标记透传（UI 显隐判据）");

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

  /* ── 3.4 星胚锚点清空回落隐藏 / 点燃转正（spec「星胚锚点清空回落隐藏」） ── */
  /* 仅星胚工作区的锚点被全部移除（星胚 dismiss）且无正式提案 → 分组消失、银河态回落零布局。 */
  const dismissed = projectPanel({
    workspaces: [{ id: "wsB", name: "beta", path: "C:/proj/beta", stars: [] }]
  });
  assert.equal(dismissed.groups.length, 0, "锚点清空且无正式提案 → 分组消失");
  assert.equal(dismissed.visible, false, "银河态可见性回落（零布局）");
  assert.equal(dismissed.embryoTotal, 0, "星胚计数归零（头部附注徽标不渲染）");
  assert.equal(dismissed.allCards.length, 0, "骨架无卡片（选中随 keepSelection 清除）");
  /* ff 点燃转正（同 slug 正式提案出现 + 锚点删除）→ 分组保留并以正式卡片呈现。 */
  const litOnly = projectPanel({
    workspaces: [{
      id: "wsB",
      name: "beta",
      path: "C:/proj/beta",
      stars: [{ id: "only-proto", name: "only-proto", lifecycle: "created", tasks: [0, 1] }]
    }]
  });
  assert.deepEqual(litOnly.groups.map((group) => group.wsName), ["beta"], "点燃转正 → 分组保留");
  assert.equal(litOnly.groups[0].cards.length, 1, "组内 1 张正式提案卡");
  assert.equal(litOnly.groups[0].cards[0].isEmbryo, undefined, "转正后不再走星胚卡片分支");
  assert.equal(litOnly.groups[0].cards[0].lifecycle, "created", "转正卡片呈现正式四态");
  assert.equal(litOnly.embryoTotal, 0, "星胚卡随锚点删除消失");
  assert.equal(litOnly.visible, true, "正式提案存在 → 面板渲染");
  /* 无 slug 的畸形锚点不产卡 → 与「无锚点」同口径隐藏（design D1）。 */
  const malformed = projectPanel({
    workspaces: [{ id: "wsM", name: "mu", path: "C:/proj/mu", stars: [{ id: "", name: "x", lifecycle: "proto" }] }]
  });
  assert.equal(malformed.groups.length, 0, "无 slug 的畸形锚点不产星胚卡 → 不生成分组");
  assert.equal(malformed.visible, false, "畸形锚点不参与可见性判定");
}

/* ── 跨面板悬停关联派生与受体判定（p2-add-cosmos-cross-hover-markers 2.1–2.3） ──
   `crossHoverTargets` 以合流悬停描述 + 单星座 merge 产物派生受体集（零 DOM/零网络）；
   受体判定辅助按行 id / 卡 id（星胚卡任一 slug 整卡）；`hoverSourceAlive` 供场景刷新
   残留清理守卫。场景为 merge 产物同形（stars / links 索引对 / planets / comets）。 */
{
  const hoverWs = {
    id: "wh",
    name: "hover",
    stars: [
      { id: "star-a", lifecycle: "reviewed" },
      { id: "star-b", lifecycle: "created" },
      { id: "star-c", lifecycle: "executed" },
      { id: "proto-p1", lifecycle: "proto" },
      { id: "proto-p2", lifecycle: "proto" }
    ],
    /* 恒星索引对：a↔b、b↔c（共享会话）。 */
    links: [[0, 1], [1, 2]],
    planets: [
      { id: "s1", stars: ["star-a", "star-b"] }, // 联星行星
      { id: "s2", stars: ["star-b"] },
      { id: "s3", stars: ["proto-p1"] }, // 关联星胚（锚点 slug 在册即可为行星关联受体）
      { id: "s4", stars: ["proto-p2"] },
      { id: "s5", stars: ["star-a", "star-a"] } // 畸形重复：派生去重
    ],
    comets: [{ id: "free-1" }]
  };
  const otherWs = {
    id: "wo",
    name: "other",
    stars: [{ id: "star-a", lifecycle: "reviewed" }],
    links: [],
    planets: [{ id: "s1", stars: ["star-a"] }],
    comets: []
  };
  const hoverScene = { workspaces: [hoverWs, otherWs] };

  /* 行星源：联星全量不截断；DOM 源自身行不标；画布源自含（对应行 `<`）。 */
  assert.deepEqual(
    crossHoverTargets({ source: "row", wsId: "wh", kind: "planet", id: "s1" }, hoverWs),
    { sessionIds: [], proposalIds: ["star-a", "star-b"] },
    "行星行源：proposalIds = planet.stars 全量；DOM 源 sessionIds 不含自身"
  );
  assert.deepEqual(
    crossHoverTargets({ source: "canvas", wsId: "wh", kind: "planet", id: "s1" }, hoverWs),
    { sessionIds: ["s1"], proposalIds: ["star-a", "star-b"] },
    "画布行星源：sessionIds 含自身会话 id（对应行 `<`）"
  );
  assert.deepEqual(
    crossHoverTargets({ source: "row", wsId: "wh", kind: "planet", id: "s5" }, hoverWs).proposalIds,
    ["star-a"],
    "planet.stars 重复项去重（联星全量语义不重复渲染）"
  );

  /* 彗星源：关联集为空；画布源自含。 */
  assert.deepEqual(
    crossHoverTargets({ source: "row", wsId: "wh", kind: "comet", id: "free-1" }, hoverWs),
    { sessionIds: [], proposalIds: [] },
    "彗星行源：无关联卡、自身行不标"
  );
  assert.deepEqual(
    crossHoverTargets({ source: "canvas", wsId: "wh", kind: "comet", id: "free-1" }, hoverWs),
    { sessionIds: ["free-1"], proposalIds: [] },
    "画布彗星源：自身行 `<`，无卡亮"
  );

  /* 恒星源：反向索引全量 + 共享会话其他恒星（排除自身），镜像画布星↔星共享段。 */
  const starA = crossHoverTargets({ source: "card", wsId: "wh", kind: "star", id: "star-a" }, hoverWs);
  assert.deepEqual(starA.sessionIds, ["s1", "s5"], "恒星 A 反查关联会话全量（含联星/重复星对象）");
  assert.deepEqual(starA.proposalIds, ["star-b"], "恒星 A 的共享会话其他恒星（排除自身）");
  assert.ok(!starA.proposalIds.includes("star-a"), "恒星源自身卡不标（proposalIds 排除自身）");
  const starB = crossHoverTargets({ source: "canvas", wsId: "wh", kind: "star", id: "star-b" }, hoverWs);
  assert.deepEqual(starB.sessionIds, ["s1", "s2"], "恒星 B 反查关联会话全量");
  assert.deepEqual(starB.proposalIds, ["star-a", "star-c"], "恒星 B 共享星双向映射（a、c；不含自身）");
  assert.deepEqual(
    crossHoverTargets({ source: "canvas", wsId: "wh", kind: "star", id: "proto-p1" }, hoverWs),
    { sessionIds: ["s3"], proposalIds: [] },
    "画布星胚（proto 恒星）源：反查关联会话行；无共享段（links 未含）"
  );

  /* 星胚合并卡源：slug 并集反查；不注入引擎、无 proposalIds（整卡粒度由受体判定消费）。 */
  const embryoHover = {
    source: "embryo",
    wsId: "wh",
    kind: "proto",
    id: "proto-p1",
    slugs: ["proto-p1", "proto-p2"]
  };
  assert.deepEqual(
    crossHoverTargets(embryoHover, hoverWs),
    { sessionIds: ["s3", "s4"], proposalIds: [] },
    "星胚合并卡源：各 slug 反查会话并集（两行亮 `<`）"
  );
  assert.deepEqual(
    crossHoverTargets({ source: "embryo", wsId: "wh", kind: "proto", slugs: [] }, hoverWs),
    { sessionIds: [], proposalIds: [] },
    "空 slug 清单 → 空集（MUST NOT 抛错）"
  );

  /* 跨工作区隔离：悬停源属其他星座 → 双方均空集。 */
  assert.deepEqual(
    crossHoverTargets({ source: "row", wsId: "wh", kind: "planet", id: "s1" }, otherWs),
    { sessionIds: [], proposalIds: [] },
    "跨工作区：宿主 ws 与悬停源 wsId 不同 → 无标记"
  );
  assert.deepEqual(
    crossHoverTargets({ source: "canvas", wsId: "wo", kind: "planet", id: "s1" }, otherWs),
    { sessionIds: ["s1"], proposalIds: ["star-a"] },
    "同星座画布源照常派生（隔离只按 wsId 不按同名 id）"
  );

  /* 非法输入防御：空 / 非对象 / 未知 kind → 空集，不抛错。 */
  assert.deepEqual(crossHoverTargets(null, hoverWs), { sessionIds: [], proposalIds: [] }, "null 悬停描述 → 空集");
  assert.deepEqual(crossHoverTargets({ wsId: "wh", kind: "planet", id: "s1" }, null), { sessionIds: [], proposalIds: [] }, "null 星座 → 空集");
  assert.deepEqual(
    crossHoverTargets({ source: "row", wsId: "wh", kind: "moon", id: "m1" }, hoverWs),
    { sessionIds: [], proposalIds: [] },
    "未知 kind → 空集"
  );

  /* 受体判定：行 id ∈ sessionIds；正式卡 id ∈ proposalIds；星胚卡任一 slug 命中整卡。 */
  const crossHover = {
    source: "row",
    wsId: "wh",
    kind: "planet",
    id: "s1",
    sessionIds: ["s1"],
    proposalIds: ["star-a", "proto-p2"]
  };
  assert.equal(rowIsLinkedOf(crossHover, { wsId: "wh", id: "s1" }), true, "受体行命中（行 id ∈ sessionIds）");
  assert.equal(rowIsLinkedOf(crossHover, { wsId: "wh", id: "s2" }), false, "非关联行不标");
  assert.equal(rowIsLinkedOf(crossHover, { wsId: "wo", id: "s1" }), false, "跨工作区同名行不标");
  assert.equal(cardIsLinkedOf(crossHover, { wsId: "wh", id: "star-a" }), true, "正式卡命中（card.id ∈ proposalIds）");
  assert.equal(cardIsLinkedOf(crossHover, { wsId: "wh", id: "star-b" }), false, "非关联正式卡不标");
  assert.equal(cardIsLinkedOf(crossHover, { wsId: "wh", isEmbryo: true, id: "proto-p1", slugs: ["proto-p1", "proto-p2"] }), true, "星胚任一 slug 命中 → 整卡标");
  assert.equal(cardIsLinkedOf(crossHover, { wsId: "wh", isEmbryo: true, id: "proto-p1", slugs: ["proto-p1"] }), false, "星胚 slug 未命中不标");
  assert.equal(cardIsLinkedOf(crossHover, { wsId: "wo", isEmbryo: true, id: "x", slugs: ["star-a"] }), false, "跨工作区星胚卡不标");

  /* 源自身不标（派生口径闭环）：行源自身行不标、卡源自身卡不标。 */
  const rowDerived = {
    ...{ source: "row", wsId: "wh", kind: "planet", id: "s1" },
    ...crossHoverTargets({ source: "row", wsId: "wh", kind: "planet", id: "s1" }, hoverWs)
  };
  assert.equal(rowIsLinkedOf(rowDerived, { wsId: "wh", id: "s1" }), false, "悬停行自身不标（DOM 源 sessionIds 空集）");
  const cardDerived = {
    ...{ source: "card", wsId: "wh", kind: "star", id: "star-b" },
    ...crossHoverTargets({ source: "card", wsId: "wh", kind: "star", id: "star-b" }, hoverWs)
  };
  assert.equal(cardIsLinkedOf(cardDerived, { wsId: "wh", id: "star-b" }), false, "悬停卡自身不标（proposalIds 排除自身）");
  assert.equal(cardIsLinkedOf(cardDerived, { wsId: "wh", id: "star-a" }), true, "悬停卡共享星卡照常标（同实体同亮面）");

  /* 场景刷新残留清理：源实体键仍在册 → true；归档/摘除 → false。 */
  assert.equal(hoverSourceAlive(hoverScene, { source: "row", wsId: "wh", kind: "planet", id: "s1" }), true, "行星行源在册");
  assert.equal(hoverSourceAlive(hoverScene, { source: "row", wsId: "wh", kind: "planet", id: "gone" }), false, "行星行源被摘除 → 清理");
  assert.equal(hoverSourceAlive(hoverScene, { source: "row", wsId: "wh", kind: "comet", id: "free-1" }), true, "彗星行源在册");
  assert.equal(hoverSourceAlive(hoverScene, { source: "card", wsId: "wh", kind: "star", id: "star-a" }), true, "正式卡源在册");
  assert.equal(hoverSourceAlive(hoverScene, { source: "card", wsId: "wh", kind: "star", id: "proto-p1" }), false, "正式卡源不认 proto 恒星（星胚走合并卡分支）");
  assert.equal(hoverSourceAlive(hoverScene, { source: "canvas", wsId: "wh", kind: "star", id: "proto-p1" }), true, "画布源认 proto 恒星（画布星胚悬停可回推）");
  assert.equal(hoverSourceAlive(hoverScene, { source: "embryo", wsId: "wh", kind: "proto", id: "proto-p1", slugs: ["proto-p1", "proto-p2"] }), true, "星胚合并卡源在册");
  assert.equal(hoverSourceAlive(hoverScene, { source: "embryo", wsId: "wh", kind: "proto", id: "gone", slugs: ["gone"] }), false, "星胚 slug 被摘除 → 清理");
  assert.equal(hoverSourceAlive({ workspaces: [] }, { source: "row", wsId: "wh", kind: "planet", id: "s1" }), false, "工作区注销 → 清理");
  assert.equal(hoverSourceAlive(hoverScene, null), false, "无悬停描述 → false");
}

/* ── 组内孕育时间线排序（add-cosmos-panel-birthline-sort 4.3 / spec cosmos-proposal-panel
   「组内孕育时间线排序」「谱系块内星胚卡打头、点燃提案按创建顺序」「星胚合并卡作为谱系
   块头」「无谱系提案按 birthMs 兜底成块」「同刻点燃 ignitedMs 次序兜底」「台账缺席回落
   birthMs 口径」「旧锚点各自成卡」） ──
   谱系块装配纯逻辑（`birthlineBlocksOf`）独立直测 + 面板投影端到端断言。 */
{
  const T1 = 1000, T2 = 2000, T3 = 3000, T4 = 4000, T5 = 5000;
  const birthlineStars = [
    { id: "anchor-a", name: "anchor-a", lifecycle: "proto", sessionId: "sess-A", at: T1, tasks: [0, 0] },
    { id: "anchor-b", name: "anchor-b", lifecycle: "proto", sessionId: "sess-B", at: T3, tasks: [0, 0] },
    { id: "prop-c", name: "prop-c", lifecycle: "created", tasks: [0, 1], birthMs: T2 },
    { id: "ign-a1", name: "ign-a1", lifecycle: "reviewed", tasks: [1, 2], birthMs: T4, embryoAt: T1, embryoSessionId: "sess-A", ignitedMs: 6000 },
    { id: "ign-a2", name: "ign-a2", lifecycle: "created", tasks: [0, 2], birthMs: T5, embryoAt: T1, embryoSessionId: "sess-A", ignitedMs: 7000 }
  ];
  const birthlineWs = { id: "wsT", name: "timeline", path: "C:/proj/timeline", stars: birthlineStars };
  const orderOf = (cards) => cards.map((card) => (card.isEmbryo ? "embryo:" + card.sessionId : card.id));

  /* 组内孕育时间线（spec 场景：星胚 A / 无谱系 C / 星胚 B，T₁ < T₂ < T₃） */
  const timeline = projectPanel({ workspaces: [birthlineWs] });
  assert.deepEqual(
    orderOf(timeline.groups[0].cards),
    ["embryo:sess-A", "ign-a1", "ign-a2", "prop-c", "embryo:sess-B"],
    "组内谱系块按星胚出生时间升序：A 块（星胚卡 + 点燃提案）→ C 块（birthMs 兜底）→ B 块"
  );
  assert.equal(timeline.total, 3, "正式提案计数 3（ign-a1 / ign-a2 / prop-c）");
  assert.equal(timeline.embryoTotal, 2, "星胚合并卡 2 张（sess-A / sess-B）");
  /* 块内：星胚卡打头 + 点燃提案创建顺序（birthMs 升序） */
  assert.deepEqual(timeline.groups[0].cards[0].slugs, ["anchor-a"], "A 块头 = 星胚合并卡（仅剩在册 slug）");
  assert.deepEqual(
    timeline.groups[0].cards.slice(1, 3).map((card) => card.id),
    ["ign-a1", "ign-a2"],
    "块内点燃提案按创建顺序（birthMs T₄ < T₅，与点燃先后一致）"
  );
  /* 无谱系提案不自带标注（零视觉变化） */
  const propC = timeline.groups[0].cards.find((card) => card.id === "prop-c");
  assert.equal(propC.isEmbryo, undefined, "无谱系提案走正式卡路径（不加任何标注字段）");
  assert.deepEqual(Object.keys(propC).sort(), Object.keys(timeline.groups[0].cards.find((card) => card.id === "ign-a1")).sort(), "有/无谱系正式卡字段集相同（MUST NOT 呈现无谱系视觉标注）");

  /* `birthlineBlocksOf` 纯逻辑直测：块键 / 块时间 / 块内序 / 块间序 */
  const blocks = birthlineBlocksOf(birthlineStars);
  assert.deepEqual(blocks.map((block) => block.key), ["session\u0000sess-A", "star\u0000prop-c", "session\u0000sess-B"], "块键命名空间（会话族 / 恒星族）+ 块间块键序");
  assert.deepEqual(blocks.map((block) => block.time), [T1, T2, T3], "块时间取值链：活锚点 at → birthMs");
  assert.deepEqual(blocks[0].stars.map((star) => star.id), ["ign-a1", "ign-a2"], "块内星序（birthMs 升序）");
  assert.equal(blocks[1].embryo, null, "无谱系提案块无星胚组");
  assert.deepEqual(birthlineBlocksOf([...birthlineStars].reverse()).map((block) => block.key), blocks.map((block) => block.key), "块装配与传入顺序解耦（确定性）");
  assert.deepEqual(birthlineBlocksOf(null), [], "非数组输入 → 空块清单（不抛错）");
  assert.deepEqual(birthlineBlocksOf([{ id: "", lifecycle: "created" }, { id: "x", lifecycle: "proto" }]).map((block) => block.stars), [[]], "无 id 恒星不产块成员；proto 恒星只进星胚组（不占正式卡成员位）");
  /* 块时间全缺 → null 殿后；同刻块键码点序兜底 */
  const nullTime = birthlineBlocksOf([
    { id: "zzz", lifecycle: "created" },
    { id: "aaa", lifecycle: "created" },
    { id: "timed", lifecycle: "created", birthMs: T2 }
  ]);
  assert.deepEqual(nullTime.map((block) => block.key), ["star\u0000timed", "star\u0000aaa", "star\u0000zzz"], "有 birthMs 的块在前、全缺块殿后按 id 码点序");

  /* 同刻点燃 ignitedMs 次序兜底（spec 场景）：birthMs 同刻 → ignitedMs 升序（压过 id 序） */
  {
    const sameMs = projectPanel({
      workspaces: [{
        id: "wsS",
        name: "same",
        path: "C:/proj/same",
        stars: [
          { id: "z-early", lifecycle: "created", tasks: [0, 1], birthMs: 9000, embryoAt: 500, embryoSessionId: "sess-S", ignitedMs: 9200 },
          { id: "a-late", lifecycle: "created", tasks: [0, 1], birthMs: 9000, embryoAt: 500, embryoSessionId: "sess-S", ignitedMs: 9500 },
          { id: "m-tie", lifecycle: "created", tasks: [0, 1], birthMs: 9000, embryoAt: 500, embryoSessionId: "sess-S", ignitedMs: 9500 }
        ]
      }]
    });
    assert.deepEqual(
      sameMs.groups[0].cards.map((card) => card.id),
      ["z-early", "a-late", "m-tie"],
      "同刻 birthMs → ignitedMs 升序（9200 先于 9500）；ignitedMs 亦同刻 → id 码点序兜底"
    );
  }

  /* 台账缺席全量回落 birthMs 口径（spec「台账缺席回落 birthMs 口径」）：各提案自成块、升序 */
  {
    const noLedger = projectPanel({
      workspaces: [{
        id: "wsN",
        name: "noledger",
        path: "C:/proj/noledger",
        stars: [
          { id: "late", lifecycle: "created", tasks: [0, 1], birthMs: 9000 },
          { id: "early", lifecycle: "created", tasks: [0, 1], birthMs: 1000 },
          { id: "middle", lifecycle: "created", tasks: [0, 1], birthMs: 5000 },
          { id: "no-birth", lifecycle: "created", tasks: [0, 1] }
        ]
      }]
    });
    assert.deepEqual(
      noLedger.groups[0].cards.map((card) => card.id),
      ["early", "middle", "late", "no-birth"],
      "台账缺席 → 全量回落 birthMs 升序（birthMs 亦缺者殿后）"
    );
  }

  /* 旧锚点 solo 块同序纪律（spec「旧锚点各自成卡」）：无 sessionId 各成 solo 块、按块时间排序 */
  {
    const solos = projectPanel({
      workspaces: [{
        id: "wsO",
        name: "solos",
        path: "C:/proj/solos",
        stars: [
          { id: "old-b", lifecycle: "proto", at: 300, tasks: [0, 0] },
          { id: "old-a", lifecycle: "proto", at: 100, tasks: [0, 0] },
          { id: "old-none", lifecycle: "proto", at: null, tasks: [0, 0] }
        ]
      }]
    });
    assert.deepEqual(
      solos.groups[0].cards.map((card) => card.slugs[0]),
      ["old-a", "old-b", "old-none"],
      "旧锚点各自成 solo 谱系块：at 升序 → null 殿后（同序纪律适用）"
    );
    assert.equal(solos.embryoTotal, 3, "3 张独立星胚卡（不归并）");
  }

  /* 重复投影顺序一致（确定性）：同集合 + 同台账 → 相同顺序；传入顺序无关 */
  const again = projectPanel({ workspaces: [birthlineWs] });
  assert.deepEqual(orderOf(again.groups[0].cards), orderOf(timeline.groups[0].cards), "相同输入重复投影 → 相同顺序");
  const reversed = projectPanel({ workspaces: [{ ...birthlineWs, stars: [...birthlineStars].reverse() }] });
  assert.deepEqual(orderOf(reversed.groups[0].cards), orderOf(timeline.groups[0].cards), "骨架传入顺序不影响孕育时间线顺序");
}

console.log("panel-smoke: all assertions passed");