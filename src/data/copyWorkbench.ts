import type { BannedWord, CopyItem, HookFormula, HookType, StoryboardBoard, WorkbenchProduct, WorkbenchStatusTone } from "../types/copyWorkbench";

// 数据源：archive/workbench-snapshots/douyin-copy-workbench.html（竞品拆解 2026-07-20 / 2026-07-20-2 批次；2026-08-11 从根目录归档）

export const COPY_STATUSES = ["灵感", "写作中", "待合规", "待分镜", "已发布"] as const;

export const COPY_STATUS_BADGE: WorkbenchStatusTone = {
  灵感: "muted",
  写作中: "blue",
  待合规: "orange",
  待分镜: "purple",
  已发布: "green",
};

export const HOOK_TYPES: HookType[] = [
  "价格对比锚定",
  "场景共情代入",
  "反向挑衅断言",
  "行业内幕揭露",
  "稀缺性+损失厌恶",
  "品牌背书锚定",
  "悬念好奇心",
  "视觉冲击颜值",
  "核心痛点直击",
  "强势指令",
];

export const WORKBENCH_PRODUCTS: WorkbenchProduct[] = ["豆芽Hit", "豆7pro", "黄麻", "其他"];

export const FUNNEL = [
  "开头钩子(2-3s)",
  "场景/痛点代入",
  "老款/竞品背书",
  "新品卖点展开",
  "活动利益",
  "行动指令(CTA)",
] as const;

export const SHOT_TYPES = ["特写", "近景", "中景", "全景", "空镜/字幕卡"] as const;

export const FORMULAS_F: HookFormula[] = [
  { code: "F-01", name: "试睡兜底钩子", desc: "你见过可以试睡X天的吗——用试睡政策打消决策顾虑，天数口径以直播间实时为准。", hook: "反向挑衅断言", src: "B1-2" },
  { code: "F-02", name: "警告式反向钩子", desc: "可别轻易尝试…舍不得起来——反向劝阻制造好奇，暗示舒适度过剩。", hook: "反向挑衅断言", src: "B1-7" },
  { code: "F-03", name: "主播亲测钩子", desc: "报体重+按压+坐边三连演示，用真实身体数据建立信任。", hook: "品牌背书锚定", src: "B1-13" },
  { code: "F-04", name: "沉浸式逐层拆解", desc: "把床垫逐层拆开讲材料，可视化呈现内部结构，适配可视窗/可拆洗产品。", hook: "行业内幕揭露", src: "B1-14/B2-4/B2-10" },
  { code: "F-05", name: "看得见的用料", desc: "拉链360度全拆可视，把「用料透明」变成可直接演示的画面。", hook: "视觉冲击颜值", src: "B1-15/B2-2" },
  { code: "F-06", name: "价格猜谜钩子", desc: "猜猜这张多少钱——先让观众出价，再揭晓直播间价制造落差。", hook: "悬念好奇心", src: "B1-19" },
  { code: "F-07", name: "妈妈情感钩子", desc: "别等孩子羡慕别人妈妈买的——亲情场景触发补偿心理。", hook: "场景共情代入", src: "B1-17" },
  { code: "F-08", name: "客户实测对话", desc: "1千对标6千——用真实客户对话做价格价值锚定。", hook: "价格对比锚定", src: "B2-2" },
  { code: "F-09", name: "规格分层公式", desc: "过软/过硬的痛点用多规格分层解决，按人群给明确推荐。", hook: "核心痛点直击", src: "B2-6" },
  { code: "F-10", name: "痛点强指令", desc: "睡不好的都给我冲——痛点人群锁定+强势行动指令。", hook: "强势指令", src: "B2-8" },
  { code: "F-11", name: "反常识钩子", desc: "懂X的都不X了——用行业反常识筛选精准人群。", hook: "反向挑衅断言", src: "B2-9" },
  { code: "F-12", name: "原床太软场景", desc: "原床太软不用换，加硬薄垫直接升级——低成本解决方案场景。", hook: "场景共情代入", src: "B2-15" },
  { code: "F-13", name: "夫妻真实剧情", desc: "夫妻双人剧情演绎睡眠矛盾，自然引出产品解决方案。", hook: "场景共情代入", src: "B2-16" },
  { code: "F-14", name: "工厂溯源专场", desc: "工厂直供+溯源直播，产地背书替代品牌溢价。", hook: "品牌背书锚定", src: "B2-18" },
  { code: "F-15", name: "沉浸式送货vlog", desc: "第一视角送货入户vlog，用真实交付过程建立服务信任。", hook: "品牌背书锚定", src: "B2-11" },
  { code: "F-16", name: "全年龄段覆盖", desc: "一张床垫覆盖儿童到老人，按年龄段讲支撑需求差异。", hook: "核心痛点直击", src: "B2-20" },
  { code: "F-17", name: "促销节点+多重补贴", desc: "大促节点叠加多重补贴利益点，补贴口径以页面实时为准。", hook: "稀缺性+损失厌恶", src: "B1-10/B2-3" },
  { code: "F-18", name: "赠品钩子模板", desc: "买大件送高价值配套，赠品清单逐项报价拉高感知价值。", hook: "稀缺性+损失厌恶", src: "B1-1" },
];

export const FORMULAS_H: HookFormula[] = [
  { code: "H-04", name: "内行人建议", desc: "买床垫？听听内行人怎么说——逐一否定普通款缺陷，再提出升级配置。适配信息不对称品类。", hook: "行业内幕揭露", src: "2026-07-20-2 adopt" },
  { code: "H-12", name: "三段式递降否定", desc: "猜猜要多少 → 两千多不用 → 一千五也不用 → 直播间福利价。递降否定制造价格惊喜。", hook: "价格对比锚定", src: "2026-07-20-2 adopt" },
  { code: "H-16", name: "老板你疯了", desc: "情绪化人设+价格震惊反应。仅取公式结构，去掉极端低价表达。", hook: "反向挑衅断言", src: "2026-07-20-2 adopt" },
  { code: "H-15", name: "意式极简高级感", desc: "风格定位+极简设计感叙事，为风格敏感人群提供溢价理由。", hook: "视觉冲击颜值", src: "2026-07-20-2 adopt" },
  { code: "H-19", name: "极限承重演示", desc: "报承重数值+上去跳/摇/晃演示；床垫改为按压、坐边沿演示更稳妥。", hook: "视觉冲击颜值", src: "2026-07-20-2 adopt" },
  { code: "H-07", name: "销冠+奖杯背书", desc: "真实销量与口碑背书，数据口径以店铺实时展示为准。", hook: "品牌背书锚定", src: "2026-07-20-2 adopt" },
];

export const BANNED: BannedWord[] = [
  { w: "0胶水", s: "改为「零胶水工艺」并确保有检测报告佐证" },
  { w: "零甲醛", s: "改为「甲醛释放量达国标XX级」，以检测报告口径为准" },
  { w: "不含甲醛", s: "改为「甲醛释放量达国标XX级」，以检测报告口径为准" },
  { w: "护脊", s: "改为「贴合支撑」「科学承托」，避免医疗化表述" },
  { w: "舒缓腰背", s: "改为「睡醒轻松」等感受型表达，避免功效承诺" },
  { w: "抗菌", s: "改为「抑菌面料（附检测报告）」或删除" },
  { w: "完美解决", s: "改为「改善」「针对性设计」" },
  { w: "绝对", s: "删除绝对化用语" },
  { w: "最好", s: "改为「我们的主推款」「口碑款」" },
  { w: "第一", s: "删除或改为「销量领先（附平台口径）」" },
  { w: "100%", s: "改为具体参数表述，避免绝对化" },
  { w: "治疗", s: "删除医疗化表述" },
  { w: "神医", s: "删除医疗化表述" },
  { w: "根治", s: "删除医疗化表述" },
  { w: "清仓搬家", s: "虚假紧迫感高危，改为真实活动节点" },
  { w: "最后一天", s: "虚假紧迫感高危，以真实活动时间口径为准" },
  { w: "全网最低", s: "虚标价格高危，删除或改为直播间实时口径" },
];

// ---------- 工具 ----------

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function nextCopyId(): string {
  const d = new Date();
  const datePart = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  let n = 0;
  try {
    n = parseInt(localStorage.getItem("wb_dywb_seq") || "0", 10) || 0;
  } catch {
    n = 0;
  }
  n += 1;
  try {
    localStorage.setItem("wb_dywb_seq", String(n));
  } catch {
    // 存储不可用时退化为随机序号
  }
  return `DY-${datePart}-${String(n).padStart(3, "0")}`;
}

// ---------- 示例数据 ----------

function sampleBoards(firstCopyId: string): StoryboardBoard[] {
  const today = todayStr();
  return [
    {
      id: uid("SB"),
      copyId: firstCopyId,
      title: "试睡兜底·豆芽Hit开箱实测",
      product: "豆芽Hit",
      createdAt: today,
      sample: true,
      shots: [
        { stage: "开头钩子(2-3s)", visual: "主播手扶床垫直视镜头，背景为展厅", audio: "你见过可以试睡的床垫吗？先别划走。", duration: 3, shotType: "近景" },
        { stage: "场景/痛点代入", visual: "快闪剪辑：网购床垫翻车、退货运费单特写", audio: "网购床垫怕踩雷？退货运费大几百，谁受得了。", duration: 5, shotType: "特写" },
        { stage: "老款/竞品背书", visual: "对比画面：普通床垫侧面无法拆开的封闭结构", audio: "普通床垫封得死死的，里面用什么你根本看不到。", duration: 5, shotType: "中景" },
        { stage: "新品卖点展开", visual: "拉链360度拉开，逐层展示S型黄麻与独立袋弹簧，手按压回弹", audio: "豆芽Hit全拆可视：S型黄麻热压成型，独立袋装弹簧，按压回弹看得见。", duration: 12, shotType: "特写" },
        { stage: "活动利益", visual: "字幕卡：试睡政策/运费险（以页面实时口径为准）", audio: "试睡天数、运费险，以直播间页面实时口径为准，不满意你退。", duration: 5, shotType: "空镜/字幕卡" },
        { stage: "行动指令(CTA)", visual: "主播指向头像，引导进直播间", audio: "睡不好的，点头像进直播间。", duration: 3, shotType: "近景" },
      ],
    },
  ];
}

export function seedCopies(): CopyItem[] {
  const today = todayStr();
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yStr = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`;
  return [
    {
      id: `DY-${today.replace(/-/g, "")}-001`,
      title: "试睡兜底·豆芽Hit开箱实测",
      product: "豆芽Hit",
      hookType: "反向挑衅断言",
      formula: "F-01",
      persona: "25-40岁租房/首置家庭",
      pain: "网购床垫怕踩雷，退货运费贵",
      benefit: "试睡+运费险兜底",
      cta: "点头像进直播间，今天下单享试睡政策（以页面口径为准）",
      body: "你见过可以试睡的床垫吗？\n别急着划走——这张豆芽Hit，拉链360度全拆可视，用料直接摊开给你看。\nS型黄麻+独立袋装弹簧，按下去什么回弹，坐边沿塌不塌，直播间现场演示。\n试睡天数、运费险以直播间页面实时口径为准，不满意你退。\n睡不好的，点头像进直播间。",
      status: "待分镜",
      dueDate: yStr,
      sample: true,
      createdAt: today,
    },
    {
      id: `DY-${today.replace(/-/g, "")}-002`,
      title: "三段式递降·豆7pro价格锚定",
      product: "豆7pro",
      hookType: "价格对比锚定",
      formula: "H-12",
      persona: "对大牌床垫价格敏感人群",
      pain: "大牌动辄五六千，预算有限",
      benefit: "同配置平替",
      cta: "评论区扣1，直播间揭晓价格",
      body: "猜猜这张豆7pro多少钱？\n两千多？不用。\n一千五？也不用。\nS型黄麻、独立袋弹簧、双面可拆洗——这个配置，直播间福利价直接揭晓。\n想知道的，评论区扣1。",
      status: "写作中",
      dueDate: today,
      sample: true,
      createdAt: today,
    },
    {
      id: `DY-${today.replace(/-/g, "")}-003`,
      title: "内行人建议·普通床垫三大坑",
      product: "豆芽Hit",
      hookType: "行业内幕揭露",
      formula: "H-04",
      persona: "首次买床垫小白",
      pain: "不懂材料被忽悠",
      benefit: "升级配置一次到位",
      cta: "进直播间看拆垫实测",
      body: "买床垫？先听听内行人怎么说。\n普通椰棕垫——胶水粘合，睡感死硬；\n普通整网弹簧——翻个身全家醒；\n普通面料层——不能拆洗，三年以后什么样自己想象。\n豆芽Hit把这三点全改了：S型黄麻热压成型、独立袋装弹簧、面料双面拆洗。\n不信？直播间现场拆给你看。",
      status: "待合规",
      dueDate: today,
      sample: true,
      createdAt: today,
    },
    {
      id: `DY-${today.replace(/-/g, "")}-004`,
      title: "夫妻剧情·翻身吵醒名场面",
      product: "豆7pro",
      hookType: "场景共情代入",
      formula: "F-13",
      persona: "已婚夫妻/同床睡眠浅人群",
      pain: "伴侣翻身必醒",
      benefit: "独立袋弹簧抗干扰",
      cta: "点击下方进入直播间",
      body: "凌晨两点，他翻了个身——你又醒了。\n整网弹簧就是这样，一个人动，全床跟着晃。\n豆7pro独立袋装弹簧，每个弹簧单独受力，他翻身你无感。\n今晚想睡个好觉的，点进直播间。",
      status: "灵感",
      dueDate: `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate() + 3).padStart(2, "0")}`,
      sample: true,
      createdAt: today,
    },
  ];
}

export function seedBoards(copies: CopyItem[]): StoryboardBoard[] {
  const first = copies.find((copy) => copy.formula === "F-01") ?? copies[0];
  return sampleBoards(first?.id ?? "");
}
