/**
 * vision-prompt.mjs
 *
 * 85 字段主图分析 prompt + JSON schema
 *
 * 输入：单张床垫竞品主图
 * 输出：符合 SCHEMA 的 JSON 对象（含 85 字段）
 *
 * 字段体系源自：E:/Github/竞品主图分析/analysis/fields_85_schema.json
 */

// 85 字段的 key 顺序（来自 batch01_results.json 实际数据）
export const FIELD_KEYS = [
  "P图片分析状态", "Q图片数量", "R图片信息完整度", "S分析依据类型",
  "T主图主要任务", "U第一视觉焦点", "V第二视觉焦点", "W核心传播主题",
  "X主标题文案", "Y副标题文案", "Z重点数字信息", "AA三秒理解度",
  "AB信息密度", "AC阅读路径", "AD营销手法分类", "AE核心营销手法",
  "AF营销手法说明", "AG营销目的", "AH营销力度", "AI营销信息可信度",
  "AJ核心卖点", "AK其他卖点", "AL卖点分类", "AM产品特征",
  "AN用户利益", "AO用户最终结果", "AP对应消费痛点", "AQ卖点证明方式",
  "AR卖点差异化程度", "AS卖点表达完整度", "AT卖点表达方式",
  "AU是否展示赠品", "AV赠品内容", "AW赠品类型", "AX赠品标称价值",
  "AY赠品获得条件", "AZ赠品策略类型", "BA赠品与主商品关联度",
  "BB赠品视觉突出度", "BC赠品主要作用", "BD赠品策略评价",
  "BE是否展示价格", "BF价格表达方式", "BG价格锚点方式", "BH优惠组合",
  "BI优惠复杂度", "BJ优惠理解难度", "BK紧迫感来源",
  "BL版式类型", "BM背景风格", "BN主色调", "BO商品主体突出度",
  "BP文案层级清晰度", "BQ缩略图可读性", "BR品牌感强度", "BS促销感强度",
  "BT视觉使用元素", "BU视觉优点", "BV视觉问题",
  "BW目标人群", "BX使用场景", "BY主要消费痛点", "BZ购买触发因素",
  "CA情绪诉求", "CB理性诉求", "CC转化公式",
  "CD主要解决的消费者问题", "CE主要消除的购买顾虑",
  "CF所处转化阶段", "CG下一步行动引导",
  "CH信息清晰度评分", "CI卖点表达评分", "CJ差异化评分",
  "CK价格吸引力评分", "CL赠品吸引力评分", "CM信任建立评分",
  "CN紧迫感评分", "CO视觉完成度评分", "CP综合转化潜力评分",
  "CQ最大优势", "CR最大问题", "CS最值得借鉴的做法",
  "CT借鉴条件", "CU不建议照搬的内容", "CV单图分析结论",
];

const RATING_FIELDS = new Set([
  "CH信息清晰度评分", "CI卖点表达评分", "CJ差异化评分",
  "CK价格吸引力评分", "CL赠品吸引力评分", "CM信任建立评分",
  "CN紧迫感评分", "CO视觉完成度评分", "CP综合转化潜力评分",
]);

// 完整参考示例（麻大师豆芽真实图，来自 madashi_real_3images_analysis.json 行 16）
const EXAMPLE_OUTPUT = {
  "P图片分析状态": "分析完成",
  "Q图片数量": 1,
  "R图片信息完整度": "高",
  "S分析依据类型": "明确展示、实拍场景",
  "T主图主要任务": "品牌背书、卖点教育、价格促销、赠品展示、信任背书、临门促单",
  "U第一视觉焦点": "白色床垫+木质床架真实卧室场景+女性模特",
  "V第二视觉焦点": "顶部大字标题[有效支撑 撑腰护脊]与品牌Logo",
  "W核心传播主题": "有效支撑撑腰护脊，进口黄麻抑菌防螨黄麻床垫",
  "X主标题文案": "有效支撑 撑腰护脊",
  "Y副标题文案": "进口黄麻 抑菌防螨",
  "Z重点数字信息": "1486起、政府补贴15%、100天试睡",
  "AA三秒理解度": "高",
  "AB信息密度": "高",
  "AC阅读路径": "标题→场景图→价格区→优惠标签→赠品",
  "CH信息清晰度评分": 4,
  "CI卖点表达评分": 4,
  "CJ差异化评分": 3,
  "CK价格吸引力评分": 4,
  "CL赠品吸引力评分": 4,
  "CM信任建立评分": 4,
  "CN紧迫感评分": 2,
  "CO视觉完成度评分": 4,
  "CP综合转化潜力评分": 4,
  "CQ最大优势": "复合战术齐备（品牌+卖点+价格+赠品+服务+补贴全套），真实场景感强",
  "CR最大问题": "缺失大促时间窗口/倒计时元素，紧迫感偏弱",
  "CS最值得借鉴的做法": "复合战术套装（护脊功能+价格+赠品+服务+补贴一图完成）",
};

/**
 * 构建单张主图的分析 prompt
 * @param {{name?: string, shop?: string, price?: string, brand?: string, keywords?: string}} context 来自原始表的商品上下文，可空
 * @returns {string} 完整 prompt
 */
export function buildPrompt(context = {}) {
  const contextLines = [];
  if (context.name) contextLines.push(`- 商品名称：${context.name}`);
  if (context.shop) contextLines.push(`- 店铺：${context.shop}`);
  if (context.brand) contextLines.push(`- 品牌：${context.brand}`);
  if (context.price) contextLines.push(`- 价格带：${context.price}`);
  if (context.keywords) contextLines.push(`- 关键词：${context.keywords}`);

  const contextBlock = contextLines.length > 0
    ? `【商品上下文】\n${contextLines.join("\n")}\n\n`
    : "";

  const fieldList = FIELD_KEYS.map((k, i) => {
    const isRating = RATING_FIELDS.has(k);
    const hint = isRating ? "（1-5 整数）" : "";
    return `  ${i + 1}. ${k}${hint}`;
  }).join("\n");

  return `你是资深电商主图分析师，请严格分析这张床垫主图，输出 85 个字段的 JSON 对象。

${contextBlock}【分析规则】
1. 每个字段都必须填写，不确定时填 "-" 而非 null 或空字符串
2. 9 项评分字段（CH-CP）必须是 1-5 的整数：
   - 1: 明显不足；2: 待改进；3: 中等；4: 良好；5: 优秀
   - CP 综合评分应参考其他 8 项综合判断
3. 定性字段（力度/密度/度）用"高/中/低"或"强/中/弱"
4. 文字类字段简明扼要，中文，一句话内
5. 输出必须是纯 JSON 对象，不要 markdown 代码块，不要额外解释

【参考示例】（麻大师豆芽床垫主图分析节选）：
${JSON.stringify(EXAMPLE_OUTPUT, null, 2)}

【要输出的完整字段列表】
${fieldList}

请仔细观察主图，输出完整的 JSON 对象：`;
}

/**
 * 解析 Vision 返回的文本为结构化对象
 * 宽容处理：模型可能返回 ```json 包裹、多余空白等
 *
 * @param {string} text Vision 返回的原始文本
 * @returns {object} 解析后的 85 字段对象
 */
export function parseVisionResponse(text) {
  if (!text) throw new Error("Vision 返回文本为空");

  // 剥离 markdown 代码块
  let cleaned = text.trim();
  const mdMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (mdMatch) cleaned = mdMatch[1].trim();

  // 找到第一个 { 和最后一个 }
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    throw new Error(`Vision 返回无法找到 JSON 对象: ${text.slice(0, 200)}`);
  }
  const jsonStr = cleaned.slice(first, last + 1);

  let obj;
  try {
    obj = JSON.parse(jsonStr);
  } catch (error) {
    throw new Error(`Vision 返回 JSON 解析失败: ${error.message}\n原始文本前 500 字：${cleaned.slice(0, 500)}`);
  }

  // 补齐缺失字段
  for (const key of FIELD_KEYS) {
    if (!(key in obj)) obj[key] = "-";
  }

  // 归一化评分字段为数字
  for (const key of RATING_FIELDS) {
    const v = obj[key];
    if (typeof v === "string") {
      const n = parseInt(v, 10);
      obj[key] = Number.isFinite(n) ? n : null;
    } else if (typeof v !== "number") {
      obj[key] = null;
    }
  }

  return obj;
}
