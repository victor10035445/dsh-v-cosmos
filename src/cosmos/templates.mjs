/**
 * Cosmos 星座模板（one-add-cosmos-constellation-templates 2.x/3.x / design D1–D6）。
 *
 * 纯数据模块：内置全部 88 个 IAU 公认星座的模板条目 + 极小查询纯函数面，零依赖、
 * 随 bundle 静态加载（无异步路径，design D5）。消费方是后续 two（恒星图样落位）与
 * three（银河天球布局）两个提案，本模块不做任何渲染集成、不改 merge/engine/客户端
 * 任何现有文件（proposal §Impact）。
 *
 * 字段约定（design D1 / spec「88 星座模板数据集」）：
 *  - id      IAU 三字母缩写小写，全局唯一，恒等自身 abbr 的小写（design D2）；
 *  - abbr    IAU 官方大写缩写；
 *  - name    拉丁名；zh 中文名；genitive 属格；
 *  - area    面积（平方度，IAU/Delporte 边界口径，取整）；
 *  - ra      中心赤经，小时 0–24（含端点，整/半步进粗粒度——three 只取相对方位）；
 *  - dec     中心赤纬，度 −90–+90（含端点）；
 *  - desc    一句中文描述（≤60 字：显著视觉特征 + 一个记忆锚点，design D6）；
 *  - stars   图样主星数组（3–20 颗）：bayer 希腊字母标注、n 星名、x/y 包围盒归一化
 *            坐标（∈ [0,1]，y 轴向上 = 北在上——two 缩放成世界坐标、three 不消费图样
 *            坐标，两者互不干扰）。同条内 bayer MUST NOT 重复；
 *  - lines   图样连线索引对（下标引用 stars），每条 ≥1 对，索引合法且不自环；
 *  - part    仅 ser 出现："caput"|"cauda"（design D3：巨蛇双区单条目，lines 不跨
 *            分区；其余 87 条无此字段，消费方按「无 part = 单区」处理）。
 *
 * 录入基准（任务 1.2 固化，design D4 已决议）：
 *  - 名称 / 属格 / 缩写 / 面积：NAOJ（日本国立天文台）88 星座一览表；
 *  - 中文名与中心 ra/dec：天文学名词审定委员会《全天 88 星座》中文对照表
 *    （异体译名以该表为准：取「蝘蜓座」不取「变色龙座」，余同）；
 *  - 图样主星与连线：希腊古典星座（托勒密 48 座）传统星图为权威基准；南天/近代
 *    40 座无希腊传统可循，以现代公认通行星图补齐——单一基准贯穿 88 条，不混源。
 *
 * 呈现性口径声明（spec）：图样连线与主星选择是文化约定（呈现性约定），坐标为
 * 包围盒归一化的示意相对位置，非星表历元坐标；本模块 MUST NOT 声称天文边界精度。
 *
 * bayer 标注与 α 规则的呈现性例外（实源限制，本注释内固化、不扩散为 schema）：
 *  - 天猫座（lyn）、猎犬座（cvn）、小狮座（lmi）、狐狸座（vul）、鹿豹座（cam 尾段）
 *    历史上拜耳仅赋极少数希腊字母，缺字母星以弗拉斯蒂德编号串充当 bayer（仍保证
 *    条内唯一）；
 *  - 船帆座（vel）、矩尺座（nor）、南极座（oct）、船尾座（pup）、天龙座（dra）的拜耳
 *    序列本就不含 α（前三座承 Argo 拆分旧序 / 拉卡耶新立，天龙座拜耳自 β 起录），
 *    此五座按实源无 α 录入；其余 83 座 α 星均入选。
 *  - 飞马座（peg）大四方东北角即仙女座 α（Alpheratz），图样按通行画法借星入图，
 *    bayer 记 "α And"。
 *
 * 消费示例（任务 2.2；two / three 的预期用法）：
 *  - two（恒星图样落位）：
 *      const t = templateOf(ws.id);           // 未命中 null → 调用方回落哈希散布
 *      const s = t.stars[i % t.stars.length];
 *      // world = 星座中心 + (s.x - 0.5, s.y - 0.5) × 半径（y 轴向上）
 *  - three（银河天球布局）：
 *      const t = templateOf(ws.id);
 *      // 天球方位：ra（小时）→ 经度角、dec（度）→ 纬度角，直接映射银河穹面
 */

/* ---------- 数据（源序 = 分批录入序：北天带 → 黄道带 → 赤道带 → 南天带；
   对外序恒为 id 码点序，见 allTemplates）---------- */

const RAW = [
  /* ===== 3.1 北天带（22 条）===== */

  /* 小熊座 —— 斗形垂北极 */
  {
    id: "umi", abbr: "UMi", name: "Ursa Minor", zh: "小熊座", genitive: "Ursae Minoris",
    area: 256, ra: 15.1, dec: 78,
    desc: "北极星所在，斗形小座悬天极，是北半球指北认星的罗盘。",
    stars: [
      { bayer: "α", n: "Polaris", x: 0.88, y: 0.08 },
      { bayer: "ζ", n: "Ahfa al Farkadain", x: 0.74, y: 0.28 },
      { bayer: "η", n: "Anwar al Farkadain", x: 0.60, y: 0.44 },
      { bayer: "β", n: "Kochab", x: 0.44, y: 0.62 },
      { bayer: "γ", n: "Pherkad", x: 0.26, y: 0.60 },
      { bayer: "δ", n: "Yildun", x: 0.22, y: 0.42 },
      { bayer: "ε", n: "ε Ursae Minoris", x: 0.40, y: 0.40 }
    ],
    lines: [[0, 1], [1, 2], [2, 6], [6, 3], [3, 4], [4, 5], [5, 6]]
  },

  /* 大熊座 —— 北斗即其腰身 */
  {
    id: "uma", abbr: "UMa", name: "Ursa Major", zh: "大熊座", genitive: "Ursae Majoris",
    area: 1280, ra: 11.3, dec: 51,
    desc: "北斗七星即其腰身，勺口双星连线直指北极星，四季常显。",
    stars: [
      { bayer: "α", n: "Dubhe", x: 0.16, y: 0.64 },
      { bayer: "β", n: "Merak", x: 0.20, y: 0.44 },
      { bayer: "γ", n: "Phecda", x: 0.44, y: 0.40 },
      { bayer: "δ", n: "Megrez", x: 0.42, y: 0.60 },
      { bayer: "ε", n: "Alioth", x: 0.62, y: 0.56 },
      { bayer: "ζ", n: "Mizar", x: 0.80, y: 0.48 },
      { bayer: "η", n: "Alkaid", x: 0.96, y: 0.28 },
      { bayer: "λ", n: "Tania Borealis", x: 0.32, y: 0.18 },
      { bayer: "μ", n: "Tania Australis", x: 0.14, y: 0.20 },
      { bayer: "ν", n: "Alula Borealis", x: 0.46, y: 0.14 },
      { bayer: "ξ", n: "Alula Australis", x: 0.62, y: 0.12 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5], [5, 6], [2, 7], [7, 8], [2, 9], [9, 10]]
  },

  /* 天龙座 —— 巨龙环抱小熊 */
  {
    id: "dra", abbr: "Dra", name: "Draco", zh: "天龙座", genitive: "Draconis",
    area: 1083, ra: 15.1, dec: 65,
    desc: "巨龙蜿蜒环抱小熊，龙首四星紧邻织女星，龙尾扫近北斗柄。",
    stars: [
      { bayer: "γ", n: "Eltanin", x: 0.80, y: 0.86 },
      { bayer: "β", n: "Rastaban", x: 0.70, y: 0.78 },
      { bayer: "ν", n: "Kuma", x: 0.68, y: 0.64 },
      { bayer: "ξ", n: "Grumium", x: 0.76, y: 0.68 },
      { bayer: "δ", n: "δ Draconis", x: 0.62, y: 0.56 },
      { bayer: "ε", n: "Tyl", x: 0.50, y: 0.48 },
      { bayer: "ζ", n: "Aldhibah", x: 0.42, y: 0.54 },
      { bayer: "η", n: "Athebyne", x: 0.32, y: 0.62 },
      { bayer: "θ", n: "Edasich", x: 0.24, y: 0.56 },
      { bayer: "ι", n: "ι Draconis", x: 0.14, y: 0.42 },
      { bayer: "κ", n: "κ Draconis", x: 0.08, y: 0.30 },
      { bayer: "λ", n: "Giausar", x: 0.12, y: 0.16 },
      { bayer: "μ", n: "μ Draconis", x: 0.24, y: 0.10 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11], [11, 12]]
  },

  /* 仙王座 —— 星形似小屋 */
  {
    id: "cep", abbr: "Cep", name: "Cepheus", zh: "仙王座", genitive: "Cephei",
    area: 588, ra: 22.0, dec: 70,
    desc: "头戴王冠的埃塞俄比亚国王，星形似小屋，造父一是著名变星。",
    stars: [
      { bayer: "γ", n: "Errai", x: 0.28, y: 0.84 },
      { bayer: "α", n: "Alderamin", x: 0.42, y: 0.64 },
      { bayer: "β", n: "Alfirk", x: 0.50, y: 0.48 },
      { bayer: "ζ", n: "ζ Cephei", x: 0.32, y: 0.36 },
      { bayer: "η", n: "η Cephei", x: 0.54, y: 0.32 },
      { bayer: "ι", n: "ι Cephei", x: 0.72, y: 0.42 },
      { bayer: "δ", n: "δ Cephei", x: 0.84, y: 0.54 },
      { bayer: "μ", n: "μ Cephei", x: 0.66, y: 0.16 },
      { bayer: "ν", n: "ν Cephei", x: 0.84, y: 0.18 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [4, 7], [7, 8], [8, 6]]
  },

  /* 仙后座 —— W 形五星 */
  {
    id: "cas", abbr: "Cas", name: "Cassiopeia", zh: "仙后座", genitive: "Cassiopeiae",
    area: 598, ra: 1.0, dec: 63,
    desc: "五星连成 W 是北天最易认的星图，与北斗隔极遥遥相对。",
    stars: [
      { bayer: "β", n: "Caph", x: 0.10, y: 0.44 },
      { bayer: "α", n: "Schedar", x: 0.28, y: 0.30 },
      { bayer: "γ", n: "Tsih", x: 0.46, y: 0.52 },
      { bayer: "δ", n: "Ruchbah", x: 0.64, y: 0.34 },
      { bayer: "ε", n: "Segin", x: 0.82, y: 0.54 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4]]
  },

  /* 鹿豹座 —— 长颈鹿卧极旁 */
  {
    id: "cam", abbr: "Cam", name: "Camelopardalis", zh: "鹿豹座", genitive: "Camelopardalis",
    area: 757, ra: 5.8, dec: 70,
    desc: "长颈鹿横卧北天极旁，无亮星，需在暗夜耐心寻其微光链。",
    stars: [
      { bayer: "β", n: "β Camelopardalis", x: 0.12, y: 0.78 },
      { bayer: "α", n: "α Camelopardalis", x: 0.32, y: 0.64 },
      { bayer: "γ", n: "γ Camelopardalis", x: 0.52, y: 0.56 },
      { bayer: "11", n: "11 Camelopardalis", x: 0.74, y: 0.44 },
      { bayer: "53", n: "53 Camelopardalis", x: 0.64, y: 0.26 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4]]
  },

  /* 天猫座 —— 星暗如林猫之目 */
  {
    id: "lyn", abbr: "Lyn", name: "Lynx", zh: "天猫座", genitive: "Lyncis",
    area: 545, ra: 8.6, dec: 46,
    desc: "星暗如林猫之目需利眼方可辨，微星连成歪斜长链居极旁。",
    stars: [
      { bayer: "α", n: "α Lyncis", x: 0.06, y: 0.20 },
      { bayer: "38", n: "38 Lyncis", x: 0.26, y: 0.40 },
      { bayer: "31", n: "31 Lyncis", x: 0.46, y: 0.48 },
      { bayer: "12", n: "12 Lyncis", x: 0.66, y: 0.56 },
      { bayer: "21", n: "21 Lyncis", x: 0.84, y: 0.62 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4]]
  },

  /* 蝎虎座 —— 锯齿小蜥蜴 */
  {
    id: "lac", abbr: "Lac", name: "Lacerta", zh: "蝎虎座", genitive: "Lacertae",
    area: 201, ra: 22.5, dec: 44,
    desc: "夹在仙王与天鹅之间的小座，暗星连成锯齿形小蜥蜴。",
    stars: [
      { bayer: "β", n: "β Lacertae", x: 0.44, y: 0.14 },
      { bayer: "α", n: "α Lacertae", x: 0.64, y: 0.26 },
      { bayer: "γ", n: "γ Lacertae", x: 0.54, y: 0.48 },
      { bayer: "δ", n: "δ Lacertae", x: 0.32, y: 0.40 },
      { bayer: "ζ", n: "ζ Lacertae", x: 0.74, y: 0.58 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [2, 4]]
  },

  /* 天鹅座 —— 北十字顺银河飞翔 */
  {
    id: "cyg", abbr: "Cyg", name: "Cygnus", zh: "天鹅座", genitive: "Cygni",
    area: 804, ra: 20.6, dec: 42,
    desc: "北十字展翅顺银河飞翔，天津四与牛郎织女构成夏季大三角。",
    stars: [
      { bayer: "α", n: "Deneb", x: 0.50, y: 0.90 },
      { bayer: "γ", n: "Sadr", x: 0.50, y: 0.60 },
      { bayer: "β", n: "Albireo", x: 0.46, y: 0.10 },
      { bayer: "δ", n: "δ Cygni", x: 0.22, y: 0.55 },
      { bayer: "ε", n: "Gienah", x: 0.78, y: 0.55 }
    ],
    lines: [[0, 1], [1, 2], [1, 3], [1, 4]]
  },

  /* 天琴座 —— 织女弹琴 */
  {
    id: "lyr", abbr: "Lyr", name: "Lyra", zh: "天琴座", genitive: "Lyrae",
    area: 286, ra: 18.8, dec: 37,
    desc: "织女星领衔北天小座，平行四边形琴身悬于银河东岸。",
    stars: [
      { bayer: "α", n: "Vega", x: 0.46, y: 0.14 },
      { bayer: "ζ", n: "ζ Lyrae", x: 0.40, y: 0.38 },
      { bayer: "δ", n: "δ Lyrae", x: 0.30, y: 0.58 },
      { bayer: "γ", n: "Sulafat", x: 0.46, y: 0.76 },
      { bayer: "β", n: "Sheliak", x: 0.58, y: 0.54 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 1]]
  },

  /* 仙女座 —— 双链延伸 + M31 */
  {
    id: "and", abbr: "And", name: "Andromeda", zh: "仙女座", genitive: "Andromedae",
    area: 722, ra: 0.8, dec: 37,
    desc: "两串链星自仙后延伸，腰间 M31 大星系肉眼可见，距银河最近。",
    stars: [
      { bayer: "α", n: "Alpheratz", x: 0.10, y: 0.72 },
      { bayer: "β", n: "Mirach", x: 0.34, y: 0.54 },
      { bayer: "γ", n: "Almach", x: 0.58, y: 0.36 },
      { bayer: "δ", n: "δ Andromedae", x: 0.26, y: 0.84 },
      { bayer: "π", n: "π Andromedae", x: 0.14, y: 0.94 }
    ],
    lines: [[0, 1], [1, 2], [0, 3], [3, 4]]
  },

  /* 英仙座 —— 魔星大陵五 */
  {
    id: "per", abbr: "Per", name: "Perseus", zh: "英仙座", genitive: "Persei",
    area: 615, ra: 3.4, dec: 43,
    desc: "英仙手持魔星首级，头部三星列弧，大陵五周期眨眼。",
    stars: [
      { bayer: "γ", n: "γ Persei", x: 0.10, y: 0.82 },
      { bayer: "δ", n: "δ Persei", x: 0.20, y: 0.74 },
      { bayer: "α", n: "Mirfak", x: 0.32, y: 0.64 },
      { bayer: "β", n: "Algol", x: 0.52, y: 0.22 },
      { bayer: "ε", n: "ε Persei", x: 0.62, y: 0.36 },
      { bayer: "ζ", n: "ζ Persei", x: 0.74, y: 0.48 },
      { bayer: "κ", n: "Menkib", x: 0.86, y: 0.60 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6]]
  },

  /* 御夫座 —— 五边形抱五车二 */
  {
    id: "aur", abbr: "Aur", name: "Auriga", zh: "御夫座", genitive: "Aurigae",
    area: 657, ra: 6.1, dec: 42,
    desc: "五边形星座环抱五车二，冬夜高悬的黄色亮星如御者执鞭。",
    stars: [
      { bayer: "α", n: "Capella", x: 0.44, y: 0.82 },
      { bayer: "β", n: "Menkalinan", x: 0.60, y: 0.70 },
      { bayer: "θ", n: "θ Aurigae", x: 0.68, y: 0.52 },
      { bayer: "ι", n: "Hassaleh", x: 0.58, y: 0.28 },
      { bayer: "ε", n: "ε Aurigae", x: 0.30, y: 0.36 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0]]
  },

  /* 猎犬座 —— 随牧夫追熊 */
  {
    id: "cvn", abbr: "CVN", name: "Canes Venatici", zh: "猎犬座", genitive: "Canum Venaticorum",
    area: 465, ra: 13.1, dec: 41,
    desc: "两只猎犬随牧夫追熊，常陈一蓝白亮星与查拉犬身相伴。",
    stars: [
      { bayer: "α", n: "Cor Caroli", x: 0.64, y: 0.28 },
      { bayer: "β", n: "Chara", x: 0.44, y: 0.46 },
      { bayer: "24", n: "La Superba", x: 0.20, y: 0.60 }
    ],
    lines: [[0, 1], [1, 2]]
  },

  /* 小狮座 —— 大狮身旁微光 */
  {
    id: "lmi", abbr: "LMi", name: "Leo Minor", zh: "小狮座", genitive: "Leonis Minoris",
    area: 340, ra: 10.2, dec: 34,
    desc: "大狮身旁的小狮子，三星微光相连，需极佳暗夜才能辨认。",
    stars: [
      { bayer: "α", n: "Praecipua", x: 0.58, y: 0.30 },
      { bayer: "β", n: "β Leonis Minoris", x: 0.30, y: 0.52 },
      { bayer: "21", n: "21 Leonis Minoris", x: 0.14, y: 0.34 }
    ],
    lines: [[0, 1], [1, 2], [2, 0]]
  },

  /* 三角座 —— 狭长小三角 */
  {
    id: "tri", abbr: "Tri", name: "Triangulum", zh: "三角座", genitive: "Trianguli",
    area: 132, ra: 2.1, dec: 33,
    desc: "三亮星构成狭长三角形，其间藏肉眼可见的 M33 旋涡星系。",
    stars: [
      { bayer: "α", n: "α Trianguli", x: 0.20, y: 0.20 },
      { bayer: "β", n: "β Trianguli", x: 0.50, y: 0.80 },
      { bayer: "γ", n: "γ Trianguli", x: 0.78, y: 0.28 }
    ],
    lines: [[0, 1], [1, 2], [2, 0]]
  },

  /* 北冕座 —— 弧形王冠 */
  {
    id: "crb", abbr: "CrB", name: "Corona Borealis", zh: "北冕座", genitive: "Coronae Borealis",
    area: 179, ra: 15.4, dec: 33,
    desc: "七星串成弯弧王冠，贯索四坐冠顶，北天小而精致的华冕。",
    stars: [
      { bayer: "θ", n: "θ Coronae Borealis", x: 0.10, y: 0.40 },
      { bayer: "β", n: "Nusakan", x: 0.24, y: 0.30 },
      { bayer: "α", n: "Alphecca", x: 0.40, y: 0.22 },
      { bayer: "γ", n: "γ Coronae Borealis", x: 0.56, y: 0.28 },
      { bayer: "δ", n: "δ Coronae Borealis", x: 0.70, y: 0.38 },
      { bayer: "ε", n: "ε Coronae Borealis", x: 0.82, y: 0.50 },
      { bayer: "ι", n: "ι Coronae Borealis", x: 0.90, y: 0.62 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6]]
  },

  /* 牧夫座 —— 大角领衔风筝形 */
  {
    id: "boo", abbr: "Boo", name: "Boötes", zh: "牧夫座", genitive: "Boötis",
    area: 447, ra: 14.6, dec: 42,
    desc: "大角星领衔风筝形，橙巨星沿北斗斗柄弧线南垂可寻。",
    stars: [
      { bayer: "α", n: "Arcturus", x: 0.20, y: 0.20 },
      { bayer: "ε", n: "Izar", x: 0.38, y: 0.34 },
      { bayer: "δ", n: "δ Boötis", x: 0.46, y: 0.54 },
      { bayer: "β", n: "Nekkar", x: 0.60, y: 0.72 },
      { bayer: "γ", n: "Seginus", x: 0.78, y: 0.62 },
      { bayer: "ρ", n: "ρ Boötis", x: 0.76, y: 0.40 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]]
  },

  /* 后发座 —— 王后献发 */
  {
    id: "com", abbr: "Com", name: "Coma Berenices", zh: "后发座", genitive: "Comae Berenices",
    area: 386, ra: 12.8, dec: 24,
    desc: "王后献发化作的星发，三星弧引出狮子座尾，星系团深藏其间。",
    stars: [
      { bayer: "β", n: "β Comae Berenices", x: 0.18, y: 0.58 },
      { bayer: "γ", n: "γ Comae Berenices", x: 0.34, y: 0.48 },
      { bayer: "α", n: "Diadem", x: 0.50, y: 0.64 },
      { bayer: "δ", n: "δ Comae Berenices", x: 0.64, y: 0.42 },
      { bayer: "ε", n: "ε Comae Berenices", x: 0.80, y: 0.32 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4]]
  },

  /* 武仙座 —— 拱石 + 倒立跪姿 */
  {
    id: "her", abbr: "Her", name: "Hercules", zh: "武仙座", genitive: "Herculis",
    area: 1225, ra: 17.4, dec: 35,
    desc: "四星织成的『拱石』是北天标志，武仙倒立跪姿，M13 居其侧。",
    stars: [
      { bayer: "α", n: "Rasalgethi", x: 0.26, y: 0.06 },
      { bayer: "β", n: "β Herculis", x: 0.18, y: 0.28 },
      { bayer: "δ", n: "Sarin", x: 0.30, y: 0.40 },
      { bayer: "ζ", n: "ζ Herculis", x: 0.44, y: 0.42 },
      { bayer: "ε", n: "ε Herculis", x: 0.52, y: 0.56 },
      { bayer: "π", n: "π Herculis", x: 0.66, y: 0.54 },
      { bayer: "η", n: "η Herculis", x: 0.58, y: 0.42 },
      { bayer: "ι", n: "ι Herculis", x: 0.62, y: 0.74 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 3], [7, 5]]
  },

  /* 狐狸座 —— 衣架星团 */
  {
    id: "vul", abbr: "Vul", name: "Vulpecula", zh: "狐狸座", genitive: "Vulpeculae",
    area: 268, ra: 20.2, dec: 25,
    desc: "狐狸座暗淡无光，衣架星团六星挂杆是暗夜小星图的奇迹。",
    stars: [
      { bayer: "α", n: "Anser", x: 0.20, y: 0.10 },
      { bayer: "6", n: "6 Vulpeculae", x: 0.36, y: 0.30 },
      { bayer: "5", n: "5 Vulpeculae", x: 0.40, y: 0.52 },
      { bayer: "4", n: "4 Vulpeculae", x: 0.54, y: 0.54 },
      { bayer: "2", n: "2 Vulpeculae", x: 0.68, y: 0.56 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4]]
  },

  /* 天箭座 —— 四星成箭 */
  {
    id: "sge", abbr: "Sge", name: "Sagitta", zh: "天箭座", genitive: "Sagittae",
    area: 80, ra: 19.7, dec: 18,
    desc: "四星成箭，γ 为箭镞直指天鹅，全天第三小的星座。",
    stars: [
      { bayer: "α", n: "α Sagittae", x: 0.22, y: 0.18 },
      { bayer: "β", n: "β Sagittae", x: 0.32, y: 0.36 },
      { bayer: "γ", n: "γ Sagittae", x: 0.74, y: 0.84 },
      { bayer: "δ", n: "δ Sagittae", x: 0.56, y: 0.62 }
    ],
    lines: [[0, 3], [3, 2], [0, 1]]
  },

  /* ===== 3.2 黄道带与蛇夫/巨蛇（14 条）===== */

  /* 白羊座 —— 歪柄勺三星 */
  {
    id: "ari", abbr: "Ari", name: "Aries", zh: "白羊座", genitive: "Arietis",
    area: 441, ra: 2.7, dec: 20,
    desc: "白羊三星排成歪柄勺，春分点曾居此座，秋夜东方初升。",
    stars: [
      { bayer: "α", n: "Hamal", x: 0.38, y: 0.66 },
      { bayer: "β", n: "Sheratan", x: 0.60, y: 0.56 },
      { bayer: "γ", n: "Mesarthim", x: 0.80, y: 0.40 },
      { bayer: "41", n: "41 Arietis", x: 0.48, y: 0.84 }
    ],
    lines: [[3, 0], [0, 1], [1, 2]]
  },

  /* 金牛座 —— V 形牛脸 + 昴肩饰 */
  {
    id: "tau", abbr: "Tau", name: "Taurus", zh: "金牛座", genitive: "Tauri",
    area: 797, ra: 4.4, dec: 18,
    desc: "毕宿五红星领衔 V 形牛脸，昴星团如肩饰缀在牛背。",
    stars: [
      { bayer: "α", n: "Aldebaran", x: 0.70, y: 0.24 },
      { bayer: "γ", n: "γ Tauri", x: 0.52, y: 0.34 },
      { bayer: "δ", n: "δ Tauri", x: 0.46, y: 0.44 },
      { bayer: "ε", n: "Ain", x: 0.40, y: 0.54 },
      { bayer: "ζ", n: "Tianguan", x: 0.22, y: 0.72 },
      { bayer: "β", n: "Elnath", x: 0.88, y: 0.86 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [2, 5]]
  },

  /* 双子座 —— 双子并肩 */
  {
    id: "gem", abbr: "Gem", name: "Gemini", zh: "双子座", genitive: "Geminorum",
    area: 514, ra: 7.1, dec: 23,
    desc: "北河二与北河三双子并肩而立，双腿伸向银河，冬夜易认。",
    stars: [
      { bayer: "α", n: "Castor", x: 0.28, y: 0.84 },
      { bayer: "ε", n: "Mebsuta", x: 0.24, y: 0.58 },
      { bayer: "μ", n: "μ Geminorum", x: 0.26, y: 0.34 },
      { bayer: "β", n: "Pollux", x: 0.54, y: 0.88 },
      { bayer: "δ", n: "δ Geminorum", x: 0.44, y: 0.62 },
      { bayer: "γ", n: "Alhena", x: 0.62, y: 0.16 },
      { bayer: "η", n: "Propus", x: 0.66, y: 0.60 },
      { bayer: "κ", n: "κ Geminorum", x: 0.76, y: 0.36 }
    ],
    lines: [[0, 1], [1, 2], [3, 4], [4, 5], [3, 6], [6, 7]]
  },

  /* 巨蟹座 —— 倒 Y + 鬼星团 */
  {
    id: "cnc", abbr: "Cnc", name: "Cancer", zh: "巨蟹座", genitive: "Cancri",
    area: 506, ra: 8.3, dec: 20,
    desc: "倒 Y 形暗淡星座，鬼星团 M44 如蜂巢悬于 δ 与 γ 之间。",
    stars: [
      { bayer: "α", n: "Acubens", x: 0.66, y: 0.16 },
      { bayer: "β", n: "Altarf", x: 0.16, y: 0.80 },
      { bayer: "γ", n: "Asellus Borealis", x: 0.44, y: 0.60 },
      { bayer: "δ", n: "Asellus Australis", x: 0.44, y: 0.42 },
      { bayer: "ι", n: "ι Cancri", x: 0.30, y: 0.22 }
    ],
    lines: [[3, 2], [2, 1], [3, 0], [3, 4]]
  },

  /* 狮子座 —— 镰刀 + 风筝尾 */
  {
    id: "leo", abbr: "Leo", name: "Leo", zh: "狮子座", genitive: "Leonis",
    area: 947, ra: 10.6, dec: 15,
    desc: "镰刀勾出狮首鬃毛，轩辕十四坐镰刀底，五帝座一收尾成筝。",
    stars: [
      { bayer: "α", n: "Regulus", x: 0.42, y: 0.12 },
      { bayer: "η", n: "η Leonis", x: 0.32, y: 0.26 },
      { bayer: "γ", n: "Algieba", x: 0.24, y: 0.40 },
      { bayer: "ζ", n: "Adhafera", x: 0.20, y: 0.54 },
      { bayer: "μ", n: "μ Leonis", x: 0.18, y: 0.68 },
      { bayer: "ε", n: "ε Leonis", x: 0.30, y: 0.80 },
      { bayer: "θ", n: "Chertan", x: 0.66, y: 0.34 },
      { bayer: "δ", n: "Zosma", x: 0.60, y: 0.62 },
      { bayer: "β", n: "Denebola", x: 0.90, y: 0.70 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [0, 6], [6, 7], [6, 8], [7, 8]]
  },

  /* 室女座 —— Y 形大座 */
  {
    id: "vir", abbr: "Vir", name: "Virgo", zh: "室女座", genitive: "Virginis",
    area: 1294, ra: 13.0, dec: 0,
    desc: "黄道最大星座呈 Y 形横卧，角宿一压住春夜南方的地平线。",
    stars: [
      { bayer: "α", n: "Spica", x: 0.28, y: 0.04 },
      { bayer: "γ", n: "Porrima", x: 0.38, y: 0.24 },
      { bayer: "δ", n: "δ Virginis", x: 0.48, y: 0.42 },
      { bayer: "ε", n: "Vindemiatrix", x: 0.78, y: 0.64 },
      { bayer: "ζ", n: "Heze", x: 0.40, y: 0.50 },
      { bayer: "η", n: "η Virginis", x: 0.30, y: 0.66 },
      { bayer: "β", n: "β Virginis", x: 0.22, y: 0.84 }
    ],
    lines: [[0, 1], [1, 4], [4, 2], [2, 3], [4, 5], [5, 6]]
  },

  /* 天秤座 —— 蝎螯化的秤 */
  {
    id: "lib", abbr: "Lib", name: "Libra", zh: "天秤座", genitive: "Librae",
    area: 538, ra: 15.1, dec: -15,
    desc: "天蝎之螯化成的秤，三星小巧，秤梁 βγ 平行黄道而置。",
    stars: [
      { bayer: "α", n: "Zubenelgenubi", x: 0.30, y: 0.06 },
      { bayer: "β", n: "Zubeneschamali", x: 0.52, y: 0.30 },
      { bayer: "γ", n: "γ Librae", x: 0.70, y: 0.52 }
    ],
    lines: [[0, 1], [1, 2]]
  },

  /* 天蝎座 —— S 形长尾毒钩 */
  {
    id: "sco", abbr: "Sco", name: "Scorpius", zh: "天蝎座", genitive: "Scorpii",
    area: 497, ra: 16.3, dec: -38,
    desc: "S 形长尾卷曲如钩，心宿二红心领衔，毒钩 λ 高翘尾端。",
    stars: [
      { bayer: "β", n: "β Scorpii", x: 0.10, y: 0.78 },
      { bayer: "δ", n: "Dschubba", x: 0.16, y: 0.62 },
      { bayer: "π", n: "π Scorpii", x: 0.22, y: 0.52 },
      { bayer: "α", n: "Antares", x: 0.32, y: 0.40 },
      { bayer: "σ", n: "σ Scorpii", x: 0.44, y: 0.32 },
      { bayer: "τ", n: "τ Scorpii", x: 0.54, y: 0.28 },
      { bayer: "ε", n: "ε Scorpii", x: 0.60, y: 0.20 },
      { bayer: "μ", n: "μ Scorpii", x: 0.62, y: 0.12 },
      { bayer: "ζ", n: "ζ Scorpii", x: 0.70, y: 0.10 },
      { bayer: "η", n: "η Scorpii", x: 0.78, y: 0.16 },
      { bayer: "θ", n: "Sargas", x: 0.84, y: 0.26 },
      { bayer: "ι", n: "ι Scorpii", x: 0.88, y: 0.38 },
      { bayer: "κ", n: "κ Scorpii", x: 0.86, y: 0.52 },
      { bayer: "λ", n: "Shaula", x: 0.90, y: 0.62 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11], [11, 12], [12, 13]]
  },

  /* 人马座 —— 茶壶对准银心 */
  {
    id: "sgr", abbr: "Sgr", name: "Sagittarius", zh: "人马座", genitive: "Sagittarii",
    area: 867, ra: 19.2, dec: -25,
    desc: "主星连成茶壶，壶嘴壶盖俱全，银河中心浓雾似自壶口升腾。",
    stars: [
      { bayer: "γ", n: "γ Sagittarii", x: 0.24, y: 0.46 },
      { bayer: "δ", n: "Kaus Media", x: 0.38, y: 0.42 },
      { bayer: "ε", n: "Kaus Australis", x: 0.34, y: 0.24 },
      { bayer: "ζ", n: "Ascella", x: 0.56, y: 0.28 },
      { bayer: "τ", n: "τ Sagittarii", x: 0.68, y: 0.34 },
      { bayer: "σ", n: "Nunki", x: 0.80, y: 0.48 },
      { bayer: "λ", n: "Kaus Borealis", x: 0.56, y: 0.58 },
      { bayer: "α", n: "Rukbat", x: 0.54, y: 0.10 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 1], [3, 7]]
  },

  /* 摩羯座 —— 微笑弧线 */
  {
    id: "cap", abbr: "Cap", name: "Capricornus", zh: "摩羯座", genitive: "Capricorni",
    area: 414, ra: 21.0, dec: -20,
    desc: "主星连成微笑弧线，羊身鱼尾的神兽，δ 与 γ 双星居尾端。",
    stars: [
      { bayer: "α", n: "α Capricorni", x: 0.20, y: 0.68 },
      { bayer: "β", n: "β Capricorni", x: 0.32, y: 0.62 },
      { bayer: "ψ", n: "ψ Capricorni", x: 0.52, y: 0.52 },
      { bayer: "δ", n: "Deneb Algedi", x: 0.74, y: 0.34 },
      { bayer: "γ", n: "Nashira", x: 0.82, y: 0.22 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4]]
  },

  /* 宝瓶座 —— 倾水的瓶子 */
  {
    id: "aqr", abbr: "Aqr", name: "Aquarius", zh: "宝瓶座", genitive: "Aquarii",
    area: 980, ra: 22.7, dec: -10,
    desc: "瓶身四星成格的『水桶』倾泻流星雨，黄道暗淡巨座。",
    stars: [
      { bayer: "β", n: "Sadalsuud", x: 0.28, y: 0.84 },
      { bayer: "α", n: "Sadalmelik", x: 0.40, y: 0.76 },
      { bayer: "γ", n: "γ Aquarii", x: 0.50, y: 0.66 },
      { bayer: "ζ", n: "ζ Aquarii", x: 0.56, y: 0.54 },
      { bayer: "η", n: "η Aquarii", x: 0.62, y: 0.58 },
      { bayer: "π", n: "π Aquarii", x: 0.70, y: 0.50 },
      { bayer: "δ", n: "Skat", x: 0.68, y: 0.12 }
    ],
    lines: [[0, 1], [0, 2], [2, 3], [3, 4], [4, 5], [3, 5], [5, 6]]
  },

  /* 双鱼座 —— 环圈系暗链 */
  {
    id: "psc", abbr: "Psc", name: "Pisces", zh: "双鱼座", genitive: "Piscium",
    area: 889, ra: 0.6, dec: 14,
    desc: "西鱼小环成圈，暗链蜿蜒系于 α 结，秋分点正穿其身。",
    stars: [
      { bayer: "γ", n: "γ Piscium", x: 0.20, y: 0.64 },
      { bayer: "θ", n: "θ Piscium", x: 0.14, y: 0.50 },
      { bayer: "ι", n: "ι Piscium", x: 0.10, y: 0.32 },
      { bayer: "ω", n: "ω Piscium", x: 0.20, y: 0.22 },
      { bayer: "μ", n: "μ Piscium", x: 0.38, y: 0.14 },
      { bayer: "α", n: "Alrescha", x: 0.68, y: 0.08 },
      { bayer: "η", n: "η Piscium", x: 0.34, y: 0.50 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5], [0, 6], [6, 5]]
  },

  /* 蛇夫座 —— 擎巨蛇跨黄道 */
  {
    id: "oph", abbr: "Oph", name: "Ophiuchus", zh: "蛇夫座", genitive: "Ophiuchi",
    area: 948, ra: 17.4, dec: 2,
    desc: "蛇夫双手擎巨蛇跨黄道而行，α 亮星高居天鹰之上。",
    stars: [
      { bayer: "α", n: "Rasalhague", x: 0.40, y: 0.88 },
      { bayer: "β", n: "β Ophiuchi", x: 0.30, y: 0.72 },
      { bayer: "κ", n: "κ Ophiuchi", x: 0.50, y: 0.76 },
      { bayer: "δ", n: "Yed Prior", x: 0.36, y: 0.46 },
      { bayer: "ε", n: "Yed Posterior", x: 0.24, y: 0.42 },
      { bayer: "ζ", n: "ζ Ophiuchi", x: 0.40, y: 0.32 },
      { bayer: "η", n: "η Ophiuchi", x: 0.56, y: 0.30 },
      { bayer: "γ", n: "γ Ophiuchi", x: 0.66, y: 0.12 }
    ],
    lines: [[0, 1], [0, 2], [1, 3], [2, 3], [3, 4], [3, 5], [5, 6], [6, 7]]
  },

  /* 巨蛇座 —— 唯一双区：头楔尾弧（design D3，lines 不跨分区） */
  {
    id: "ser", abbr: "Ser", name: "Serpens", zh: "巨蛇座", genitive: "Serpentis",
    area: 637, ra: 17.0, dec: 4,
    desc: "唯一被劈成两半的星座：头部楔形居西，尾部弧形居东。",
    stars: [
      { bayer: "β", n: "β Serpentis", part: "caput", x: 0.10, y: 0.84 },
      { bayer: "γ", n: "γ Serpentis", part: "caput", x: 0.24, y: 0.90 },
      { bayer: "δ", n: "δ Serpentis", part: "caput", x: 0.30, y: 0.78 },
      { bayer: "α", n: "Unukalhai", part: "caput", x: 0.18, y: 0.66 },
      { bayer: "ε", n: "ε Serpentis", part: "caput", x: 0.10, y: 0.54 },
      { bayer: "ζ", n: "ζ Serpentis", part: "cauda", x: 0.46, y: 0.26 },
      { bayer: "η", n: "η Serpentis", part: "cauda", x: 0.60, y: 0.20 },
      { bayer: "θ", n: "θ Serpentis", part: "cauda", x: 0.74, y: 0.22 },
      { bayer: "ν", n: "ν Serpentis", part: "cauda", x: 0.84, y: 0.32 },
      { bayer: "ο", n: "ο Serpentis", part: "cauda", x: 0.90, y: 0.44 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [5, 6], [6, 7], [7, 8], [8, 9]]
  },

  /* ===== 3.3 赤道带与冬季亮座（15 条）===== */

  /* 猎户座 —— 腰带三星的猎人 */
  {
    id: "ori", abbr: "Ori", name: "Orion", zh: "猎户座", genitive: "Orionis",
    area: 594, ra: 5.5, dec: 3,
    desc: "腰带三星笔直排开，参宿四与参宿七红蓝双巨遥相对峙。",
    stars: [
      { bayer: "α", n: "Betelgeuse", x: 0.72, y: 0.84 },
      { bayer: "γ", n: "Bellatrix", x: 0.30, y: 0.82 },
      { bayer: "δ", n: "Mintaka", x: 0.48, y: 0.50 },
      { bayer: "ε", n: "Alnilam", x: 0.54, y: 0.44 },
      { bayer: "ζ", n: "Alnitak", x: 0.60, y: 0.38 },
      { bayer: "β", n: "Rigel", x: 0.38, y: 0.08 },
      { bayer: "κ", n: "Saiph", x: 0.74, y: 0.10 },
      { bayer: "λ", n: "Meissa", x: 0.52, y: 0.96 }
    ],
    lines: [[0, 4], [1, 2], [2, 3], [3, 4], [2, 5], [4, 6], [1, 7], [0, 7]]
  },

  /* 大犬座 —— 天狼领衔 */
  {
    id: "cma", abbr: "CMa", name: "Canis Major", zh: "大犬座", genitive: "Canis Majoris",
    area: 380, ra: 6.8, dec: -25,
    desc: "全天最亮天狼星领衔，寒冬夜空最耀眼的大犬。",
    stars: [
      { bayer: "α", n: "Sirius", x: 0.26, y: 0.18 },
      { bayer: "β", n: "Mirzam", x: 0.08, y: 0.34 },
      { bayer: "γ", n: "γ Canis Majoris", x: 0.10, y: 0.54 },
      { bayer: "δ", n: "Wezen", x: 0.38, y: 0.58 },
      { bayer: "ε", n: "Adhara", x: 0.56, y: 0.44 },
      { bayer: "η", n: "Aludra", x: 0.70, y: 0.64 },
      { bayer: "ζ", n: "Furud", x: 0.66, y: 0.26 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [4, 6]]
  },

  /* 小犬座 —— 南河三 */
  {
    id: "cmi", abbr: "CMi", name: "Canis Minor", zh: "小犬座", genitive: "Canis Minoris",
    area: 183, ra: 7.7, dec: 7,
    desc: "小犬仅两三颗微星，南河三与北河三遥为冬夜双子。",
    stars: [
      { bayer: "α", n: "Procyon", x: 0.28, y: 0.20 },
      { bayer: "β", n: "Gomeisa", x: 0.56, y: 0.62 },
      { bayer: "10", n: "10 Canis Minoris", x: 0.72, y: 0.30 }
    ],
    lines: [[0, 1], [0, 2]]
  },

  /* 麒麟座 —— 暗淡四边形 */
  {
    id: "mon", abbr: "Mon", name: "Monoceros", zh: "麒麟座", genitive: "Monocerotis",
    area: 482, ra: 7.1, dec: -3,
    desc: "麒麟暗淡四星成四边形，玫瑰星云与圣诞树星团藏其间。",
    stars: [
      { bayer: "α", n: "α Monocerotis", x: 0.38, y: 0.64 },
      { bayer: "β", n: "β Monocerotis", x: 0.58, y: 0.78 },
      { bayer: "δ", n: "δ Monocerotis", x: 0.64, y: 0.42 },
      { bayer: "ε", n: "ε Monocerotis", x: 0.44, y: 0.24 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0]]
  },

  /* 天兔座 —— 伏于猎户脚下 */
  {
    id: "lep", abbr: "Lep", name: "Lepus", zh: "天兔座", genitive: "Leporis",
    area: 290, ra: 5.5, dec: -20,
    desc: "天兔伏于猎户脚边，四星方身双耳前伸，北望猎户腰带。",
    stars: [
      { bayer: "α", n: "Arneb", x: 0.56, y: 0.64 },
      { bayer: "β", n: "Nihal", x: 0.44, y: 0.48 },
      { bayer: "γ", n: "γ Leporis", x: 0.34, y: 0.40 },
      { bayer: "δ", n: "δ Leporis", x: 0.68, y: 0.38 },
      { bayer: "ε", n: "ε Leporis", x: 0.28, y: 0.26 },
      { bayer: "μ", n: "μ Leporis", x: 0.22, y: 0.10 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0], [2, 4], [4, 5]]
  },

  /* 长蛇座 —— 全天最大 */
  {
    id: "hya", abbr: "Hya", name: "Hydra", zh: "长蛇座", genitive: "Hydrae",
    area: 1303, ra: 10.5, dec: -17,
    desc: "全天最大星座横卧南天，蛇头六星成环，孤星『星宿一』独明。",
    stars: [
      { bayer: "β", n: "β Hydrae", x: 0.04, y: 0.68 },
      { bayer: "γ", n: "γ Hydrae", x: 0.10, y: 0.78 },
      { bayer: "δ", n: "δ Hydrae", x: 0.16, y: 0.70 },
      { bayer: "ε", n: "ε Hydrae", x: 0.14, y: 0.60 },
      { bayer: "ζ", n: "ζ Hydrae", x: 0.22, y: 0.64 },
      { bayer: "α", n: "Alphard", x: 0.36, y: 0.42 },
      { bayer: "ι", n: "ι Hydrae", x: 0.52, y: 0.32 },
      { bayer: "κ", n: "κ Hydrae", x: 0.66, y: 0.26 },
      { bayer: "λ", n: "λ Hydrae", x: 0.78, y: 0.18 },
      { bayer: "ν", n: "ν Hydrae", x: 0.88, y: 0.12 },
      { bayer: "ξ", n: "ξ Hydrae", x: 0.92, y: 0.20 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10]]
  },

  /* 鲸鱼座 —— 魔星蒭藁增二 */
  {
    id: "cet", abbr: "Cet", name: "Cetus", zh: "鲸鱼座", genitive: "Ceti",
    area: 1231, ra: 1.4, dec: -7,
    desc: "鲸鱼横卧秋夜，魔星蒭藁增二周期爆发，土司空独守南天。",
    stars: [
      { bayer: "γ", n: "γ Ceti", x: 0.12, y: 0.80 },
      { bayer: "α", n: "Menkar", x: 0.08, y: 0.64 },
      { bayer: "λ", n: "λ Ceti", x: 0.16, y: 0.56 },
      { bayer: "μ", n: "μ Ceti", x: 0.24, y: 0.62 },
      { bayer: "ο", n: "Mira", x: 0.20, y: 0.48 },
      { bayer: "η", n: "η Ceti", x: 0.42, y: 0.54 },
      { bayer: "τ", n: "τ Ceti", x: 0.60, y: 0.40 },
      { bayer: "β", n: "Diphda", x: 0.88, y: 0.10 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5], [5, 6], [6, 7]]
  },

  /* 波江座 —— 千里长河 */
  {
    id: "eri", abbr: "Eri", name: "Eridanus", zh: "波江座", genitive: "Eridani",
    area: 1138, ra: 3.7, dec: -26,
    desc: "大河自猎户脚下蜿蜒千里，尽头一等亮星水委一独照南极。",
    stars: [
      { bayer: "β", n: "Cursa", x: 0.18, y: 0.88 },
      { bayer: "γ", n: "Zaurak", x: 0.32, y: 0.72 },
      { bayer: "δ", n: "δ Eridani", x: 0.26, y: 0.62 },
      { bayer: "ε", n: "ε Eridani", x: 0.36, y: 0.50 },
      { bayer: "θ", n: "Acamar", x: 0.70, y: 0.24 },
      { bayer: "α", n: "Achernar", x: 0.90, y: 0.06 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]]
  },

  /* 天鹰座 —— 牛郎挑扁担 */
  {
    id: "aql", abbr: "Aql", name: "Aquila", zh: "天鹰座", genitive: "Aquilae",
    area: 652, ra: 19.7, dec: 3,
    desc: "牛郎携两子挑扁担居银河东岸，与织女隔河相望。",
    stars: [
      { bayer: "α", n: "Altair", x: 0.50, y: 0.52 },
      { bayer: "β", n: "Tarazed", x: 0.42, y: 0.70 },
      { bayer: "γ", n: "γ Aquilae", x: 0.62, y: 0.72 },
      { bayer: "ζ", n: "ζ Aquilae", x: 0.46, y: 0.34 },
      { bayer: "θ", n: "θ Aquilae", x: 0.56, y: 0.16 },
      { bayer: "λ", n: "λ Aquilae", x: 0.64, y: 0.48 },
      { bayer: "δ", n: "δ Aquilae", x: 0.74, y: 0.40 }
    ],
    lines: [[0, 1], [1, 2], [0, 3], [3, 4], [3, 5], [5, 6]]
  },

  /* 海豚座 —— 菱形小陀螺 */
  {
    id: "del", abbr: "Del", name: "Delphinus", zh: "海豚座", genitive: "Delphini",
    area: 189, ra: 20.7, dec: 14,
    desc: "五星成菱形小陀螺，ε 甩尾指向天鹰，秋夜小巧而精致。",
    stars: [
      { bayer: "β", n: "β Delphini", x: 0.28, y: 0.58 },
      { bayer: "α", n: "Sualocin", x: 0.42, y: 0.74 },
      { bayer: "γ", n: "γ Delphini", x: 0.58, y: 0.66 },
      { bayer: "δ", n: "δ Delphini", x: 0.48, y: 0.50 },
      { bayer: "ε", n: "ε Delphini", x: 0.66, y: 0.34 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4]]
  },

  /* 小马座 —— 五星方框 */
  {
    id: "equ", abbr: "Equ", name: "Equuleus", zh: "小马座", genitive: "Equulei",
    area: 72, ra: 21.2, dec: 8,
    desc: "全天第五小星座，五星方框微光闪烁于飞马鼻前。",
    stars: [
      { bayer: "α", n: "Kitalpha", x: 0.40, y: 0.40 },
      { bayer: "β", n: "β Equulei", x: 0.60, y: 0.55 },
      { bayer: "γ", n: "γ Equulei", x: 0.66, y: 0.70 },
      { bayer: "δ", n: "δ Equulei", x: 0.50, y: 0.72 },
      { bayer: "ε", n: "ε Equulei", x: 0.30, y: 0.62 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4]]
  },

  /* 飞马座 —— 大四方定向标 */
  {
    id: "peg", abbr: "Peg", name: "Pegasus", zh: "飞马座", genitive: "Pegasi",
    area: 1129, ra: 22.7, dec: 19,
    desc: "大四方是秋夜定向标，马颈折向东北，危宿三压阵。",
    stars: [
      { bayer: "α", n: "Markab", x: 0.46, y: 0.42 },
      { bayer: "β", n: "Scheat", x: 0.14, y: 0.46 },
      { bayer: "γ", n: "Algenib", x: 0.42, y: 0.12 },
      { bayer: "α And", n: "Alpheratz", x: 0.16, y: 0.76 },
      { bayer: "ε", n: "Enif", x: 0.76, y: 0.66 },
      { bayer: "θ", n: "Baham", x: 0.90, y: 0.82 },
      { bayer: "η", n: "Matar", x: 0.82, y: 0.92 }
    ],
    lines: [[3, 1], [1, 0], [0, 2], [2, 3], [0, 4], [4, 5], [5, 6]]
  },

  /* 盾牌座 —— 野鸭星团 */
  {
    id: "sct", abbr: "Sct", name: "Scutum", zh: "盾牌座", genitive: "Scuti",
    area: 109, ra: 18.6, dec: -4,
    desc: "盾牌小巧五星成盾，野鸭星团 M11 悬于盾面最为壮观。",
    stars: [
      { bayer: "α", n: "α Scuti", x: 0.40, y: 0.34 },
      { bayer: "β", n: "β Scuti", x: 0.28, y: 0.52 },
      { bayer: "γ", n: "γ Scuti", x: 0.44, y: 0.66 },
      { bayer: "δ", n: "δ Scuti", x: 0.62, y: 0.50 },
      { bayer: "ε", n: "ε Scuti", x: 0.52, y: 0.24 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0]]
  },

  /* 巨爵座 —— 歪杯斜倚 */
  {
    id: "crt", abbr: "Crt", name: "Crater", zh: "巨爵座", genitive: "Crateris",
    area: 282, ra: 11.4, dec: -16,
    desc: "歪杯斜倚长蛇之背，暗星成碗形，是希腊神话中的圣杯。",
    stars: [
      { bayer: "α", n: "α Crateris", x: 0.14, y: 0.60 },
      { bayer: "γ", n: "γ Crateris", x: 0.30, y: 0.72 },
      { bayer: "β", n: "β Crateris", x: 0.54, y: 0.74 },
      { bayer: "ζ", n: "ζ Crateris", x: 0.68, y: 0.62 },
      { bayer: "η", n: "η Crateris", x: 0.56, y: 0.40 },
      { bayer: "δ", n: "δ Crateris", x: 0.36, y: 0.34 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]]
  },

  /* 乌鸦座 —— 歪帆四星 */
  {
    id: "crv", abbr: "Crv", name: "Corvus", zh: "乌鸦座", genitive: "Corvi",
    area: 184, ra: 12.4, dec: -18,
    desc: "乌鸦四星成歪帆，倚在巨爵与长蛇之间，α 独立帆外。",
    stars: [
      { bayer: "α", n: "Alchiba", x: 0.16, y: 0.26 },
      { bayer: "β", n: "β Corvi", x: 0.26, y: 0.60 },
      { bayer: "γ", n: "Gienah", x: 0.40, y: 0.44 },
      { bayer: "δ", n: "Algorab", x: 0.60, y: 0.60 },
      { bayer: "ε", n: "Minkar", x: 0.74, y: 0.42 }
    ],
    lines: [[1, 2], [2, 3], [3, 4], [0, 1]]
  },

  /* ===== 3.4 南天带（37 条，无希腊传统者以现代公认通行星图补齐）===== */

  /* 天鸽座 —— 衔枝白鸽 */
  {
    id: "col", abbr: "Col", name: "Columba", zh: "天鸽座", genitive: "Columbae",
    area: 270, ra: 5.8, dec: -34,
    desc: "大犬座之南的白鸽，衔橄榄枝报洪水已退的讯息。",
    stars: [
      { bayer: "α", n: "Phact", x: 0.32, y: 0.68 },
      { bayer: "β", n: "β Columbae", x: 0.16, y: 0.50 },
      { bayer: "γ", n: "γ Columbae", x: 0.30, y: 0.28 },
      { bayer: "ε", n: "ε Columbae", x: 0.52, y: 0.36 },
      { bayer: "δ", n: "δ Columbae", x: 0.44, y: 0.46 },
      { bayer: "η", n: "η Columbae", x: 0.66, y: 0.28 }
    ],
    lines: [[0, 1], [1, 4], [4, 2], [4, 3], [3, 5]]
  },

  /* 船底座 —— 老人星压阵 */
  {
    id: "car", abbr: "Car", name: "Carina", zh: "船底座", genitive: "Carinae",
    area: 494, ra: 9.0, dec: -60,
    desc: "托起全天第二亮星老人星，海山二正处超新星爆发前夜。",
    stars: [
      { bayer: "α", n: "Canopus", x: 0.24, y: 0.06 },
      { bayer: "β", n: "Miaplacidus", x: 0.40, y: 0.46 },
      { bayer: "ε", n: "Avior", x: 0.62, y: 0.40 },
      { bayer: "ι", n: "Aspidiske", x: 0.78, y: 0.58 },
      { bayer: "υ", n: "υ Carinae", x: 0.66, y: 0.72 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 1]]
  },

  /* 船帆座 —— 张帆无 α（Argo 拆分旧序） */
  {
    id: "vel", abbr: "Vel", name: "Vela", zh: "船帆座", genitive: "Velorum",
    area: 500, ra: 9.6, dec: -48,
    desc: "南船之帆高张，γ Regor 是罕见的沃尔夫-拉叶双星。",
    stars: [
      { bayer: "γ", n: "Regor", x: 0.28, y: 0.42 },
      { bayer: "δ", n: "Alsephina", x: 0.42, y: 0.58 },
      { bayer: "κ", n: "Markeb", x: 0.56, y: 0.18 },
      { bayer: "λ", n: "Suhail", x: 0.66, y: 0.30 }
    ],
    lines: [[0, 1], [1, 3], [3, 2], [2, 0]]
  },

  /* 船尾座 —— 南船后半段 */
  {
    id: "pup", abbr: "Pup", name: "Puppis", zh: "船尾座", genitive: "Puppis",
    area: 673, ra: 7.7, dec: -36,
    desc: "船尾座占南船后半段，ζ 与 π 亮星相伴，疏散星团丰富。",
    stars: [
      { bayer: "ζ", n: "Naos", x: 0.16, y: 0.28 },
      { bayer: "π", n: "π Puppis", x: 0.34, y: 0.52 },
      { bayer: "ρ", n: "ρ Puppis", x: 0.48, y: 0.66 },
      { bayer: "σ", n: "σ Puppis", x: 0.66, y: 0.58 },
      { bayer: "τ", n: "τ Puppis", x: 0.72, y: 0.44 },
      { bayer: "ν", n: "ν Puppis", x: 0.56, y: 0.36 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [3, 5], [5, 1]]
  },

  /* 罗盘座 —— 指引航向 */
  {
    id: "pyx", abbr: "Pyx", name: "Pyxis", zh: "罗盘座", genitive: "Pyxidis",
    area: 221, ra: 9.0, dec: -27,
    desc: "罗盘嵌于长蛇与船帆之间，四星小巧指引南船航向。",
    stars: [
      { bayer: "α", n: "α Pyxidis", x: 0.26, y: 0.34 },
      { bayer: "β", n: "β Pyxidis", x: 0.16, y: 0.16 },
      { bayer: "γ", n: "γ Pyxidis", x: 0.40, y: 0.14 },
      { bayer: "δ", n: "δ Pyxidis", x: 0.56, y: 0.30 }
    ],
    lines: [[1, 0], [0, 3], [3, 2]]
  },

  /* 南十字座 —— 天然罗盘 */
  {
    id: "cru", abbr: "Cru", name: "Crux", zh: "南十字座", genitive: "Crucis",
    area: 68, ra: 12.6, dec: -60,
    desc: "全天最小星座，四星十字是南半球定向的天然罗盘。",
    stars: [
      { bayer: "γ", n: "Gacrux", x: 0.50, y: 0.90 },
      { bayer: "α", n: "Acrux", x: 0.50, y: 0.10 },
      { bayer: "β", n: "Mimosa", x: 0.80, y: 0.52 },
      { bayer: "δ", n: "δ Crucis", x: 0.22, y: 0.46 }
    ],
    lines: [[0, 1], [2, 3]]
  },

  /* 半人马座 —— 最近恒星系 */
  {
    id: "cen", abbr: "Cen", name: "Centaurus", zh: "半人马座", genitive: "Centauri",
    area: 1060, ra: 13.4, dec: -47,
    desc: "南天巨座半人马，α 双星系最近的恒星系统，比邻星在其侧。",
    stars: [
      { bayer: "α", n: "Rigil Kentaurus", x: 0.74, y: 0.10 },
      { bayer: "β", n: "Hadar", x: 0.80, y: 0.28 },
      { bayer: "γ", n: "γ Centauri", x: 0.46, y: 0.50 },
      { bayer: "ζ", n: "ζ Centauri", x: 0.56, y: 0.38 },
      { bayer: "η", n: "η Centauri", x: 0.66, y: 0.54 },
      { bayer: "θ", n: "Menkent", x: 0.44, y: 0.74 },
      { bayer: "ε", n: "Muhlifain", x: 0.28, y: 0.42 },
      { bayer: "ι", n: "ι Centauri", x: 0.32, y: 0.64 }
    ],
    lines: [[3, 2], [2, 5], [5, 7], [7, 6], [6, 3], [3, 4], [4, 1], [1, 0]]
  },

  /* 圆规座 —— 细小三星 */
  {
    id: "cir", abbr: "Cir", name: "Circinus", zh: "圆规座", genitive: "Circini",
    area: 93, ra: 14.8, dec: -63,
    desc: "圆规细小三星连线，β 是快速自转的 Be 型壳层星。",
    stars: [
      { bayer: "α", n: "α Circini", x: 0.34, y: 0.22 },
      { bayer: "β", n: "β Circini", x: 0.52, y: 0.36 },
      { bayer: "γ", n: "γ Circini", x: 0.64, y: 0.52 }
    ],
    lines: [[0, 1], [1, 2]]
  },

  /* 南三角座 —— 北三角的镜像 */
  {
    id: "tra", abbr: "TrA", name: "Triangulum Australe", zh: "南三角座", genitive: "Trianguli Australis",
    area: 110, ra: 16.1, dec: -66,
    desc: "三亮星构成近乎等边的南天小三角，与北天三角座遥相呼应。",
    stars: [
      { bayer: "α", n: "Atria", x: 0.30, y: 0.20 },
      { bayer: "β", n: "β Trianguli Australis", x: 0.70, y: 0.30 },
      { bayer: "γ", n: "γ Trianguli Australis", x: 0.50, y: 0.70 }
    ],
    lines: [[0, 1], [1, 2], [2, 0]]
  },

  /* 南冕座 —— 弧形暗冠 */
  {
    id: "cra", abbr: "CrA", name: "Corona Australis", zh: "南冕座", genitive: "Coronae Australis",
    area: 128, ra: 18.6, dec: -42,
    desc: "南冕弧形暗星成冠，比北冕更暗淡而含蓄。",
    stars: [
      { bayer: "α", n: "α Coronae Australis", x: 0.20, y: 0.50 },
      { bayer: "β", n: "β Coronae Australis", x: 0.30, y: 0.34 },
      { bayer: "γ", n: "γ Coronae Australis", x: 0.44, y: 0.22 },
      { bayer: "δ", n: "δ Coronae Australis", x: 0.58, y: 0.16 },
      { bayer: "ε", n: "ε Coronae Australis", x: 0.72, y: 0.20 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4]]
  },

  /* 天燕座 —— 极乐鸟 */
  {
    id: "aps", abbr: "Aps", name: "Apus", zh: "天燕座", genitive: "Apodis",
    area: 206, ra: 15.2, dec: -76,
    desc: "天堂鸟之名纪念新几内亚极乐鸟，南极附近微星连线。",
    stars: [
      { bayer: "α", n: "α Apodis", x: 0.30, y: 0.60 },
      { bayer: "β", n: "β Apodis", x: 0.40, y: 0.44 },
      { bayer: "γ", n: "γ Apodis", x: 0.56, y: 0.34 },
      { bayer: "δ", n: "δ Apodis", x: 0.70, y: 0.48 }
    ],
    lines: [[0, 1], [1, 2], [2, 3]]
  },

  /* 孔雀座 —— 开屏尾羽 */
  {
    id: "pav", abbr: "Pav", name: "Pavo", zh: "孔雀座", genitive: "Pavonis",
    area: 378, ra: 19.6, dec: -64,
    desc: "α 孔雀星独亮南天，众暗星铺成开屏的尾羽。",
    stars: [
      { bayer: "α", n: "Peacock", x: 0.62, y: 0.38 },
      { bayer: "β", n: "β Pavonis", x: 0.44, y: 0.56 },
      { bayer: "γ", n: "γ Pavonis", x: 0.34, y: 0.44 },
      { bayer: "δ", n: "δ Pavonis", x: 0.50, y: 0.70 },
      { bayer: "ε", n: "ε Pavonis", x: 0.30, y: 0.28 }
    ],
    lines: [[1, 0], [1, 2], [1, 3], [2, 4]]
  },

  /* 杜鹃座 —— 小麦哲伦云 */
  {
    id: "tuc", abbr: "Tuc", name: "Tucana", zh: "杜鹃座", genitive: "Tucanae",
    area: 295, ra: 23.8, dec: -66,
    desc: "巨嘴鸟怀抱小麦哲伦云与著名球状星团 47 Tuc，深空宝库。",
    stars: [
      { bayer: "α", n: "α Tucanae", x: 0.30, y: 0.24 },
      { bayer: "γ", n: "γ Tucanae", x: 0.50, y: 0.38 },
      { bayer: "δ", n: "δ Tucanae", x: 0.66, y: 0.30 },
      { bayer: "β", n: "β Tucanae", x: 0.78, y: 0.50 },
      { bayer: "ε", n: "ε Tucanae", x: 0.60, y: 0.58 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 1]]
  },

  /* 水蛇座 —— 大麦云之伴 */
  {
    id: "hyi", abbr: "Hyi", name: "Hydrus", zh: "水蛇座", genitive: "Hydri",
    area: 243, ra: 2.5, dec: -72,
    desc: "小水蛇三主星斜连一线，守在大麦哲伦云畔的南天小座。",
    stars: [
      { bayer: "α", n: "α Hydri", x: 0.28, y: 0.62 },
      { bayer: "β", n: "β Hydri", x: 0.52, y: 0.46 },
      { bayer: "γ", n: "γ Hydri", x: 0.76, y: 0.30 }
    ],
    lines: [[0, 1], [1, 2]]
  },

  /* 山案座 —— 云桌横陈 */
  {
    id: "men", abbr: "Men", name: "Mensa", zh: "山案座", genitive: "Mensae",
    area: 153, ra: 5.4, dec: -76,
    desc: "桌山之名源于大麦哲伦云如云桌横陈其顶，紧贴南极。",
    stars: [
      { bayer: "α", n: "α Mensae", x: 0.36, y: 0.62 },
      { bayer: "γ", n: "γ Mensae", x: 0.58, y: 0.52 },
      { bayer: "β", n: "β Mensae", x: 0.54, y: 0.30 }
    ],
    lines: [[0, 1], [1, 2]]
  },

  /* 蝘蜓座 —— 贴南极圈游走（译名以对照表基准为准） */
  {
    id: "cha", abbr: "Cha", name: "Chamaeleon", zh: "蝘蜓座", genitive: "Chamaeleontis",
    area: 132, ra: 10.7, dec: -78,
    desc: "蝘蜓贴南极圈游走，四暗星围成小四边形，肉眼勉强可辨。",
    stars: [
      { bayer: "α", n: "α Chamaeleontis", x: 0.30, y: 0.40 },
      { bayer: "β", n: "β Chamaeleontis", x: 0.50, y: 0.55 },
      { bayer: "γ", n: "γ Chamaeleontis", x: 0.66, y: 0.44 },
      { bayer: "δ", n: "δ Chamaeleontis", x: 0.52, y: 0.28 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0]]
  },

  /* 苍蝇座 —— 南天昆虫 */
  {
    id: "mus", abbr: "Mus", name: "Musca", zh: "苍蝇座", genitive: "Muscae",
    area: 138, ra: 12.6, dec: -69,
    desc: "南天唯一的昆虫座，α 双星领衔的苍蝇振翅银河之侧。",
    stars: [
      { bayer: "α", n: "α Muscae", x: 0.30, y: 0.62 },
      { bayer: "β", n: "β Muscae", x: 0.46, y: 0.50 },
      { bayer: "δ", n: "δ Muscae", x: 0.62, y: 0.40 },
      { bayer: "γ", n: "γ Muscae", x: 0.52, y: 0.24 },
      { bayer: "ε", n: "ε Muscae", x: 0.34, y: 0.30 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0]]
  },

  /* 剑鱼座 —— 大麦云与 1987A */
  {
    id: "dor", abbr: "Dor", name: "Dorado", zh: "剑鱼座", genitive: "Doradus",
    area: 179, ra: 5.2, dec: -59,
    desc: "剑鱼怀抱大麦哲伦云，超新星 1987A 曾在此震撼全球。",
    stars: [
      { bayer: "α", n: "α Doradus", x: 0.36, y: 0.24 },
      { bayer: "β", n: "β Doradus", x: 0.54, y: 0.40 },
      { bayer: "γ", n: "γ Doradus", x: 0.70, y: 0.56 },
      { bayer: "δ", n: "δ Doradus", x: 0.30, y: 0.60 }
    ],
    lines: [[3, 0], [0, 1], [1, 2]]
  },

  /* 网罟座 —— 目镜网格 */
  {
    id: "ret", abbr: "Ret", name: "Reticulum", zh: "网罟座", genitive: "Reticuli",
    area: 114, ra: 3.9, dec: -60,
    desc: "拉卡耶以目镜十字网格命名，αβ 双星曾结伴运行。",
    stars: [
      { bayer: "α", n: "α Reticuli", x: 0.34, y: 0.34 },
      { bayer: "β", n: "β Reticuli", x: 0.50, y: 0.46 },
      { bayer: "δ", n: "δ Reticuli", x: 0.66, y: 0.30 },
      { bayer: "ε", n: "ε Reticuli", x: 0.60, y: 0.18 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0]]
  },

  /* 绘架座 —— β 星尘埃盘 */
  {
    id: "pic", abbr: "Pic", name: "Pictor", zh: "绘架座", genitive: "Pictoris",
    area: 247, ra: 5.6, dec: -53,
    desc: "因 β 星尘埃盘揭开系外行星观测序幕而载入天文史。",
    stars: [
      { bayer: "α", n: "α Pictoris", x: 0.36, y: 0.62 },
      { bayer: "β", n: "β Pictoris", x: 0.58, y: 0.46 },
      { bayer: "γ", n: "γ Pictoris", x: 0.72, y: 0.30 },
      { bayer: "δ", n: "δ Pictoris", x: 0.50, y: 0.22 }
    ],
    lines: [[0, 1], [1, 2], [2, 3]]
  },

  /* 凤凰座 —— 浴火神鸟 */
  {
    id: "phe", abbr: "Phe", name: "Phoenix", zh: "凤凰座", genitive: "Phoenicis",
    area: 469, ra: 0.7, dec: -48,
    desc: "浴火重生的神鸟横卧波江尽头，α 安卡领衔南天大座。",
    stars: [
      { bayer: "α", n: "Ankaa", x: 0.46, y: 0.64 },
      { bayer: "β", n: "β Phoenicis", x: 0.20, y: 0.46 },
      { bayer: "γ", n: "γ Phoenicis", x: 0.32, y: 0.30 },
      { bayer: "ε", n: "ε Phoenicis", x: 0.68, y: 0.42 },
      { bayer: "κ", n: "κ Phoenicis", x: 0.82, y: 0.22 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4]]
  },

  /* 望远镜座 —— 拉卡耶仪器 */
  {
    id: "tel", abbr: "Tel", name: "Telescopium", zh: "望远镜座", genitive: "Telescopii",
    area: 252, ra: 18.9, dec: -52,
    desc: "拉卡耶的望远镜化身南天星座，暗淡无亮于四等的星。",
    stars: [
      { bayer: "α", n: "α Telescopii", x: 0.44, y: 0.58 },
      { bayer: "β", n: "β Telescopii", x: 0.36, y: 0.40 },
      { bayer: "γ", n: "γ Telescopii", x: 0.54, y: 0.30 },
      { bayer: "δ", n: "δ Telescopii", x: 0.66, y: 0.44 },
      { bayer: "ε", n: "ε Telescopii", x: 0.60, y: 0.68 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0]]
  },

  /* 矩尺座 —— 量天矩尺（无 α，拜耳序列自 γ 起） */
  {
    id: "nor", abbr: "Nor", name: "Norma", zh: "矩尺座", genitive: "Normae",
    area: 165, ra: 15.9, dec: -54,
    desc: "矩尺夹在半人马与豺狼之间，暗星成小四边形量天。",
    stars: [
      { bayer: "γ", n: "γ Normae", x: 0.40, y: 0.42 },
      { bayer: "δ", n: "δ Normae", x: 0.54, y: 0.58 },
      { bayer: "ε", n: "ε Normae", x: 0.68, y: 0.44 },
      { bayer: "ι", n: "ι Normae", x: 0.52, y: 0.28 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0]]
  },

  /* 豺狼座 —— 执矛所指 */
  {
    id: "lup", abbr: "Lup", name: "Lupus", zh: "豺狼座", genitive: "Lupi",
    area: 334, ra: 15.3, dec: -43,
    desc: "半人马执矛所指的野兽，βγ 亮星如利爪撕开银河。",
    stars: [
      { bayer: "α", n: "α Lupi", x: 0.66, y: 0.58 },
      { bayer: "β", n: "β Lupi", x: 0.54, y: 0.42 },
      { bayer: "γ", n: "γ Lupi", x: 0.42, y: 0.28 },
      { bayer: "δ", n: "δ Lupi", x: 0.48, y: 0.56 },
      { bayer: "ε", n: "ε Lupi", x: 0.36, y: 0.66 },
      { bayer: "η", n: "η Lupi", x: 0.60, y: 0.72 }
    ],
    lines: [[0, 1], [1, 2], [1, 3], [3, 4], [3, 5], [5, 0]]
  },

  /* 天坛座 —— 诸神祭坛 */
  {
    id: "ara", abbr: "Ara", name: "Ara", zh: "天坛座", genitive: "Arae",
    area: 237, ra: 17.4, dec: -54,
    desc: "诸神盟誓的祭坛烟火升腾，银河中心在其上方交映。",
    stars: [
      { bayer: "β", n: "β Arae", x: 0.38, y: 0.64 },
      { bayer: "γ", n: "γ Arae", x: 0.32, y: 0.44 },
      { bayer: "δ", n: "δ Arae", x: 0.50, y: 0.42 },
      { bayer: "α", n: "α Arae", x: 0.60, y: 0.28 },
      { bayer: "ζ", n: "ζ Arae", x: 0.72, y: 0.40 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0]]
  },

  /* 唧筒座 —— 空气泵 */
  {
    id: "ant", abbr: "Ant", name: "Antlia", zh: "唧筒座", genitive: "Antliae",
    area: 239, ra: 10.5, dec: -33,
    desc: "空气泵之名纪念物理学革命，全天最暗的星座之一。",
    stars: [
      { bayer: "α", n: "α Antliae", x: 0.40, y: 0.52 },
      { bayer: "ε", n: "ε Antliae", x: 0.58, y: 0.40 },
      { bayer: "θ", n: "θ Antliae", x: 0.30, y: 0.30 },
      { bayer: "ι", n: "ι Antliae", x: 0.50, y: 0.22 }
    ],
    lines: [[0, 1], [1, 3], [3, 2], [2, 0]]
  },

  /* 雕具座 —— 凿刀小座 */
  {
    id: "cae", abbr: "Cae", name: "Caelum", zh: "雕具座", genitive: "Caeli",
    area: 125, ra: 5.0, dec: -39,
    desc: "雕刻师凿刀化作小座，面积居全天倒数第二。",
    stars: [
      { bayer: "α", n: "α Caeli", x: 0.60, y: 0.42 },
      { bayer: "β", n: "β Caeli", x: 0.44, y: 0.28 },
      { bayer: "γ", n: "γ Caeli", x: 0.30, y: 0.42 },
      { bayer: "δ", n: "δ Caeli", x: 0.36, y: 0.60 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0]]
  },

  /* 时钟座 —— 摆钟化星 */
  {
    id: "hor", abbr: "Hor", name: "Horologium", zh: "时钟座", genitive: "Horologii",
    area: 249, ra: 3.3, dec: -53,
    desc: "摆钟化身星座，α 微光领衔，波江大弯环抱其东。",
    stars: [
      { bayer: "α", n: "α Horologii", x: 0.52, y: 0.40 },
      { bayer: "β", n: "β Horologii", x: 0.36, y: 0.26 },
      { bayer: "γ", n: "γ Horologii", x: 0.28, y: 0.44 },
      { bayer: "δ", n: "δ Horologii", x: 0.38, y: 0.62 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0]]
  },

  /* 天炉座 —— 星系团之路标 */
  {
    id: "for", abbr: "For", name: "Fornax", zh: "天炉座", genitive: "Fornacis",
    area: 398, ra: 2.8, dec: -32,
    desc: "炉膛中藏天炉星系团，αβ 双星微光是深空巡天路标。",
    stars: [
      { bayer: "α", n: "α Fornacis", x: 0.44, y: 0.54 },
      { bayer: "β", n: "β Fornacis", x: 0.34, y: 0.38 },
      { bayer: "γ", n: "γ Fornacis", x: 0.50, y: 0.26 },
      { bayer: "δ", n: "δ Fornacis", x: 0.64, y: 0.38 },
      { bayer: "ε", n: "ε Fornacis", x: 0.60, y: 0.58 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0]]
  },

  /* 玉夫座 —— 雕塑刻案 */
  {
    id: "scl", abbr: "Scl", name: "Sculptor", zh: "玉夫座", genitive: "Sculptoris",
    area: 475, ra: 0.4, dec: -32,
    desc: "雕塑家的刻案上，玉夫星系群安静陈列于南天。",
    stars: [
      { bayer: "α", n: "α Sculptoris", x: 0.30, y: 0.62 },
      { bayer: "β", n: "β Sculptoris", x: 0.44, y: 0.48 },
      { bayer: "γ", n: "γ Sculptoris", x: 0.58, y: 0.36 },
      { bayer: "δ", n: "δ Sculptoris", x: 0.70, y: 0.52 },
      { bayer: "ε", n: "ε Sculptoris", x: 0.56, y: 0.70 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0]]
  },

  /* 南鱼座 —— 北落师门 */
  {
    id: "psa", abbr: "PsA", name: "Piscis Austrinus", zh: "南鱼座", genitive: "Piscis Austrini",
    area: 245, ra: 22.2, dec: -30,
    desc: "北落师门是秋夜南方最低的一等亮星，孤独而明亮。",
    stars: [
      { bayer: "α", n: "Fomalhaut", x: 0.50, y: 0.10 },
      { bayer: "β", n: "β Piscis Austrini", x: 0.58, y: 0.38 },
      { bayer: "δ", n: "δ Piscis Austrini", x: 0.70, y: 0.56 },
      { bayer: "ε", n: "ε Piscis Austrini", x: 0.40, y: 0.62 },
      { bayer: "ι", n: "ι Piscis Austrini", x: 0.62, y: 0.74 }
    ],
    lines: [[0, 1], [1, 2], [2, 4], [4, 3], [3, 1]]
  },

  /* 印第安座 —— 原住民之名 */
  {
    id: "ind", abbr: "Ind", name: "Indus", zh: "印第安座", genitive: "Indi",
    area: 294, ra: 21.3, dec: -58,
    desc: "纪念新大陆原住民的南天小座，αβγ 三星微光列阵。",
    stars: [
      { bayer: "α", n: "α Indi", x: 0.40, y: 0.60 },
      { bayer: "β", n: "β Indi", x: 0.56, y: 0.46 },
      { bayer: "γ", n: "γ Indi", x: 0.66, y: 0.30 },
      { bayer: "δ", n: "δ Indi", x: 0.50, y: 0.24 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0]]
  },

  /* 天鹤座 —— 涉水仙鹤 */
  {
    id: "gru", abbr: "Gru", name: "Grus", zh: "天鹤座", genitive: "Gruis",
    area: 366, ra: 22.5, dec: -42,
    desc: "α 鹤一蓝亮星领衔，长颈双翼形如涉水仙鹤。",
    stars: [
      { bayer: "α", n: "Alnair", x: 0.64, y: 0.06 },
      { bayer: "γ", n: "γ Gruis", x: 0.48, y: 0.34 },
      { bayer: "β", n: "Al Dhanab", x: 0.26, y: 0.14 },
      { bayer: "δ", n: "δ Gruis", x: 0.68, y: 0.52 },
      { bayer: "ε", n: "ε Gruis", x: 0.44, y: 0.60 },
      { bayer: "ζ", n: "ζ Gruis", x: 0.28, y: 0.48 }
    ],
    lines: [[0, 1], [1, 2], [1, 3], [1, 4], [4, 5]]
  },

  /* 南极座 —— σ 即南极星（无 α，拉卡耶新立） */
  {
    id: "oct", abbr: "Oct", name: "Octans", zh: "南极座", genitive: "Octantis",
    area: 291, ra: 22.7, dec: -85,
    desc: "σ 即南极星，亮度仅 5.4 等的黯淡指极针。",
    stars: [
      { bayer: "σ", n: "Polaris Australis", x: 0.50, y: 0.26 },
      { bayer: "ν", n: "ν Octantis", x: 0.68, y: 0.40 },
      { bayer: "β", n: "β Octantis", x: 0.38, y: 0.48 },
      { bayer: "δ", n: "δ Octantis", x: 0.62, y: 0.62 },
      { bayer: "θ", n: "θ Octantis", x: 0.34, y: 0.72 }
    ],
    lines: [[0, 1], [0, 2], [2, 4], [1, 3], [3, 4]]
  },

  /* 显微镜座 —— 科学革命纪念 */
  {
    id: "mic", abbr: "Mic", name: "Microscopium", zh: "显微镜座", genitive: "Microscopii",
    area: 210, ra: 20.8, dec: -33,
    desc: "显微镜之座纪念胡克时代的科学革命，微星斜列无奇。",
    stars: [
      { bayer: "α", n: "α Microscopii", x: 0.40, y: 0.62 },
      { bayer: "β", n: "β Microscopii", x: 0.52, y: 0.44 },
      { bayer: "γ", n: "γ Microscopii", x: 0.66, y: 0.32 },
      { bayer: "ε", n: "ε Microscopii", x: 0.58, y: 0.20 }
    ],
    lines: [[0, 1], [1, 2], [2, 3]]
  },

  /* 六分仪座 —— 航海仪器 */
  {
    id: "sex", abbr: "Sex", name: "Sextans", zh: "六分仪座", genitive: "Sextantis",
    area: 314, ra: 10.3, dec: -1,
    desc: "六分仪纪念航海测量仪器，暗淡小座无一亮于四等。",
    stars: [
      { bayer: "α", n: "α Sextantis", x: 0.40, y: 0.56 },
      { bayer: "β", n: "β Sextantis", x: 0.56, y: 0.44 },
      { bayer: "γ", n: "γ Sextantis", x: 0.46, y: 0.28 },
      { bayer: "δ", n: "δ Sextantis", x: 0.30, y: 0.38 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0]]
  },

  /* 飞鱼座 —— 南船护航 */
  {
    id: "vol", abbr: "Vol", name: "Volans", zh: "飞鱼座", genitive: "Volantis",
    area: 141, ra: 7.8, dec: -70,
    desc: "南船护航的飞鱼跃出水面，小星列成鱼跃之形。",
    stars: [
      { bayer: "α", n: "α Volantis", x: 0.40, y: 0.56 },
      { bayer: "β", n: "β Volantis", x: 0.62, y: 0.60 },
      { bayer: "γ", n: "γ Volantis", x: 0.55, y: 0.40 },
      { bayer: "δ", n: "δ Volantis", x: 0.72, y: 0.46 },
      { bayer: "ζ", n: "ζ Volantis", x: 0.78, y: 0.30 }
    ],
    lines: [[0, 1], [1, 3], [3, 4], [0, 2], [2, 3]]
  }
  /* END-OF-BATCH-4 */
];

/* ---------- 查询纯函数面（spec「模板查询纯函数面」）---------- */

/** 快照构建：深冻结（条目 / stars / lines / 单星全冻结），调用方改不动模块态。 */
function freezeTemplate(t) {
  return Object.freeze({
    ...t,
    stars: Object.freeze(t.stars.map((s) => Object.freeze({ ...s }))),
    lines: Object.freeze(t.lines.map((l) => Object.freeze([l[0], l[1]])))
  });
}

const TEMPLATES = Object.freeze(RAW.map(freezeTemplate));

/** 模板总数（常量 88；与数据集条目数一致，smoke 锁定）。 */
export const TEMPLATE_COUNT = 88;

/** id 码点序快照（模块初始化排序一次，allTemplates 恒返回同一冻结数组）。 */
const SORTED = Object.freeze(
  [...TEMPLATES].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
);

const BY_ID = new Map(TEMPLATES.map((t) => [t.id, t]));

/**
 * 全部模板（按 id 码点序的冻结快照数组）。
 * 确定性：同参同果、零副作用、不依赖运行环境 locale 或时区。调用方对快照的任何
 * 修改（含嵌套 stars / lines）均被冻结语义阻断，模块内部状态不受污染。
 * @returns {readonly object[]}
 */
export function allTemplates() {
  return SORTED;
}

/**
 * 按 id 精确查询模板（字符串全等匹配）。
 * 命中返回对应条目（同等冻结快照语义）；未命中或非字符串入参返回 null，
 * MUST NOT 抛错、无日志副作用。
 * @param {unknown} id
 * @returns {object|null}
 */
export function templateOf(id) {
  return typeof id === "string" ? (BY_ID.get(id) ?? null) : null;
}
