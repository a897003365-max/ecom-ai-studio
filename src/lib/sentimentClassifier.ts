// 舆论倾向分类器：领域情感词典固定算法（评估结论见 HANDOFF，不接 LLM 逐条判分）
// 打分规则：
// 1. 语料清洗：noteBody 中的元数据行（标题/作者/小红书号/粉丝/发布时间/IP 属地）与标签行不参与打分，
//    正文内的 #xxx[话题] 话题标记也剔除 —— 它们是内容主题不是观点，且标题行会造成二次计分
// 2. 最长匹配消耗式扫描（避免"骗人"同时命中"骗"的双重计数）
// 3. 否定识别：命中词前 4 字窗口内含 不/没/无/毫无/并不/不太/没啥/从未/不用/不会/不再/不怕/无需/没有/不用担心 则不计分
//    （"不用担心踩雷""不会变形"不算负面）
// 4. 旧床垫主语排除：负面词前 8 字内出现 旧床垫/软床垫/家里床垫/这种床垫 等主语，视为对旧床垫的描述而非麻大师投诉
// 5. 标题命中权重 ×2

const NEGATIVE_TERMS = [
  "避雷", "踩雷", "后悔", "差评", "退货", "退款", "拔草", "劝退", "别买", "不要买", "千万别买", "避坑",
  "坑", "韭菜", "智商税", "垃圾", "质量差", "太差", "很差", "差劲", "翻车", "破损", "瑕疵",
  "虚假宣传", "虚假", "夸大", "骗", "欺骗", "假货", "山寨", "货不对版", "货不对板", "偷工减料", "减配",
  "异味", "酸臭", "臭味", "味道大", "有味道", "很臭", "刺鼻", "难闻", "甲醛", "超标", "有毒", "头晕", "头疼",
  "塌陷", "凹陷", "塌边", "塌腰", "变形", "起拱", "发霉", "生虫", "虫子", "开线", "断裂", "掉渣",
  "味道重", "味道很重", "味很大", "闷热", "越睡越热", "不透气", "睡醒一身汗",
  "太厚", "偏厚", "尺寸不符", "中间高", "斜坡", "凸起", "滚下去",
  "不贴合", "不适合", "没有回弹", "不回弹",
  "特别热", "太热", "很热", "热醒",
  "过敏", "瘙痒", "起疹", "湿疹", "腰疼", "腰酸", "脖子疼", "落枕", "睡不好", "越睡越累", "难受",
  "客服态度差", "态度差", "不处理", "不退款", "拖延", "推诿", "投诉", "维权", "举报", "售后差", "售后难", "客服敷衍",
  "不推荐", "不好用", "不舒服", "不满意", "不值得", "不建议", "别入手", "退了", "退掉", "换货",
  "白花钱", "浪费钱", "上当", "被坑", "以次充好", "黑心棉", "旧棉", "发黄", "不结实", "软塌塌", "异响", "晃动",
  "有味", "劣质", "次品", "腰突",
];

const POSITIVE_TERMS = [
  "无异味", "没有异味", "没异味", "没味道", "无甲醛", "推荐", "种草", "好用", "好睡", "舒服", "舒适", "满意",
  "超预期", "惊喜", "值得", "性价比", "划算", "回购", "复购", "无限回购", "真香", "安利", "放心", "靠谱",
  "正品", "质量好", "很棒", "点赞", "五星", "好评", "天花板", "闭眼入", "支撑到位", "贴合", "睡得很香",
  "一觉到天亮", "睡得香", "秒睡", "深度睡眠", "强烈推荐", "值得买", "买对了", "选对了", "超值", "爱了", "绝了",
  // 反转句式：先被最长匹配消耗，避免正文里的"塌陷/腰疼/后悔"把好评误判成负面
  "拯救塌陷", "救了我的腰", "解放了腰", "yyds", "后悔没早", "相见恨晚", "早买早享受",
  // 种草文收尾满意度信号
  "很值", "值了", "太适合", "多虑了", "不踩雷", "没踩雷", "买值了",
  "可以试试", "盘活", "救活", "nice", "有求必应", "不错", "还不错",
];

// 元数据行前缀：这些行是抓取格式的一部分，不是用户观点
const META_LINE_PREFIXES = ["标题：", "作者：", "小红书号：", "粉丝：", "发布时间：", "IP 属地：", "标签："];

// 否定/豁免后缀（命中词前 4 字窗口匹配）
// 注：「拒绝」刻意不在此列 —— "拒绝发霉"是营销语,但"拒绝退货/退款"是典型投诉,冲突时保投诉
const NEGATION_SUFFIXES = [
  "不", "没", "无",
  "毫无", "并不", "不太", "没啥", "从未", "没有", "没什么",
  "不用", "不会", "不再", "不怕", "无需", "未敢",
  "不用担心", "不必担心",
  // 顾虑/恐惧非投诉（"当初也怕踩雷""主要考虑到甲醛问题"）
  "怕", "担心", "考虑", "考虑到", "纠结",
  // 防止/告别/缓解类前缀：其后的症状词是被解决的问题（"告别发霉异味""缓解腰酸"）
  "不易", "难以", "避免", "告别", "缓解", "改善", "解决", "防止", "防",
  // 假设/比较句式（"不像以前那样"）
  "不像",
];

// 强否定短语（命中词前 10 字窗口内出现即豁免）：覆盖长距离否定（"不会局部塌陷""也不像旧床垫那样"）
const STRONG_NEGATION_PHRASES = ["不用担心", "不必担心", "再也不用", "再也不", "再也没", "很少", "不再", "没再", "再也没有", "没有明显", "无明显", "不会"];

// 后置否定/转好短语（命中词后 6 字窗口内出现即豁免）："一点异味都没有""腰酸也好了""后悔没有早入手""不满意可以退回"
const POST_NEGATION_PHRASES = ["都没有", "也没有", "都没", "也没", "也好了", "好多了", "缓解了", "改善了", "找到了办法", "有救了", "得救了", "救星", "没有早", "没早", "可以退回", "可以退", "更少"];

// 旧床垫/他物主语：负面词前 16 字窗口内出现即视为描述旧床垫、宿舍床板等而非麻大师，不计分
const OLD_MATTRESS_SUBJECTS = [
  "旧床垫", "软床垫", "家里床垫", "家里的床垫", "现在的床垫", "之前的床垫", "原来的床垫", "原先的床垫",
  "这种床垫", "这种软床垫", "那张床垫", "旧床", "软床", "硬床板", "硬板床", "床板",
  "木板床", "硬木板", "木板", "盒子床垫", "网红床垫", "很多床垫",
  "之前买的", "之前睡", "以前睡", "去年买", "图便宜",
  // 软化/塌陷的状态描述主语（"整个人陷进去，腰悬空"是旧床状态铺垫）
  "陷进去", "腰悬空", "腰部悬空", "睡醒浑身酸痛",
];

// 竞品/蹭牌主语：负面词指向其他品牌（"林氏木业床垫已经发霉""担心麻师傅甲醛"），不计为麻大师负面
const OTHER_BRAND_SUBJECTS = ["林氏木业", "林氏", "喜临门", "慕思", "雅兰", "穗宝", "大自然", "顾家", "全友", "源氏木语", "麻师傅", "栖作", "出乎", "蓝盒子", "某盒子"];

// 消耗不计分短语：含敏感字的卖点宣称/固定熟语（"0甲醛""坑坑洼洼"不是投诉）
const SKIP_PHRASES = ["坑坑洼洼", "0甲醛", "0胶水", "零甲醛", "零胶水"];

// 语境豁免：特定词前接特定主语时不计分（"包装垃圾顺手带走"是物流描述，"可以退款"是售后保障陈述）
const CONTEXT_EXEMPTIONS: Record<string, string[]> = {
  "垃圾": ["包装"],
  "退款": ["可以", "能", "支持", "100天"],
  "退货": ["可以", "能", "支持", "不好"],
  "不好用": ["也有"],
  "头疼": ["挑", "选", "纠结"],
  "难受": ["看着", "心疼", "破防"],
  "甲醛": ["不确定", "不知道", "测试", "检测", "焦虑"],
  "踩雷": ["零风险"],
  "腰酸": ["久坐"],
  "腰疼": ["久坐"],
};

// 后接身份词豁免：症状词后接身份/人群后缀时是人群自述而非投诉（"腰突宝妈""腰酸星人救星"）
const SUFFIX_EXEMPTIONS: Record<string, string[]> = {
  "腰突": ["宝妈", "党", "患者", "人", "星"],
  "腰酸": ["星人"],
};

// 恐吓式标题 + 正文反转：标题钩子词命中且正文出现反转信号时,标题负面词清零
// （"腰酸背痛警告😭" + 正文"闭眼冲";真投诉的正文不会出现这些词）
const TITLE_FEAR_HOOKS = /警告|别乱买|千万别|劝退|踩雷无数|选不对|太软|太硬/;
const BODY_REVERSAL_SIGNALS = /闭眼冲|闭眼入|救星|真香|还好|挖到|安排上|找到了办法|太适合|赚到|赚到了|不费劲|拿取|躺平|做功课|就是我.*选|直接换|零风险/;

// 行业测评/预告类标题（"全网床垫甲醛大揭秘"）：@多品牌且无结论,不判负面
const NEUTRAL_TITLE_PATTERNS = /大揭秘|陆续公布|计划测试/;

// 疑问/求证/二选一类标题:提问帖不是投诉,判负降为中性
const QUESTION_TITLE_PATTERNS = /靠不靠谱|靠不靠|值得买吗|值得入|怎么样|咋样|好不好|二选一|有没有用过的|选哪个|推荐吗|避雷吗|真的假的|是不是真的|是真假/;

// 平台投诉类标题:投诉对象是京东/淘宝/物流等平台,不是麻大师
const PLATFORM_COMPLAINT_PATTERNS = /京东|淘宝|天猫|拼多多|物流|快递|plus会员|会员维权/;

// 转折点标记：种草文"痛点铺垫 → 入手麻大师 → 好评"结构的分界。
// 逻辑：入手麻大师之前的疼痛/塌陷在定义上就不是关于麻大师的（还没买），负面词不计分；
// 真投诉的负面描述必然出现在入手之后,不受影响。
// 有效性：标记后 12 字内必须出现麻大师产品词 —— 否则像"当初盲目跟风入手软床垫"
// 买的是旧床垫,不是转折点。
const TURN_MARKERS = ["换上", "入手", "入了", "安排上", "铺上", "换成", "挖到", "这次我选", "还好", "幸好", "被种草", "种草这个", "种草了"];
const TURN_PRODUCT_PATTERN = /麻大师|护脊宝|加硬|神器|豆芽|豆7|豆苗|黄麻/;

function findTurnIndex(body: string): number {
  let earliest = 0;
  for (const marker of TURN_MARKERS) {
    let from = 0;
    while (true) {
      const idx = body.indexOf(marker, from);
      if (idx === -1) break;
      if (TURN_PRODUCT_PATTERN.test(body.slice(idx + marker.length, idx + marker.length + 12))) {
        if (earliest === 0 || idx < earliest) earliest = idx;
        break;
      }
      from = idx + marker.length;
    }
  }
  return earliest;
}

export interface NoteSentiment {
  label: "negative" | "positive" | "neutral";
  neg: number;
  pos: number;
}

interface SentimentTerm {
  term: string;
  negative: boolean;
  /** true = 消耗该片段但不计分（成语/熟语，如"坑坑洼洼"） */
  skip?: boolean;
}

const ALL_SENTIMENT_TERMS: SentimentTerm[] = [
  ...NEGATIVE_TERMS.map((t) => ({ term: t, negative: true })),
  ...POSITIVE_TERMS.map((t) => ({ term: t, negative: false })),
  ...SKIP_PHRASES.map((t) => ({ term: t, negative: false, skip: true })),
].sort((a, b) => b.term.length - a.term.length);

// 按首字分桶，减少逐位置扫描范围
const TERMS_BY_FIRST_CHAR = new Map<string, SentimentTerm[]>();
for (const t of ALL_SENTIMENT_TERMS) {
  const head = t.term[0];
  if (!TERMS_BY_FIRST_CHAR.has(head)) TERMS_BY_FIRST_CHAR.set(head, []);
  TERMS_BY_FIRST_CHAR.get(head)!.push(t);
}

/** 从抓取的 noteBody 中分离真实观点文本与标签：去掉元数据行、正文前缀和 #xxx[话题] 话题标记 */
export function extractOpinionText(noteBody: string): string {
  return extractBodyAndTags(noteBody).body;
}

function extractBodyAndTags(noteBody: string): { body: string; tags: string } {
  const lines = noteBody.split("\n");
  const kept: string[] = [];
  const tags: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // 「正文：」行剥离前缀后保留内容
    if (trimmed.startsWith("正文：")) {
      kept.push(trimmed.slice(3));
      continue;
    }
    // 「标签：」行单独收集：种草文挂 #床垫推荐、投诉挂 #避雷,标签是弱情感信号,降权计分
    if (trimmed.startsWith("标签：")) {
      tags.push(trimmed.slice(3));
      continue;
    }
    if (META_LINE_PREFIXES.some((p) => trimmed.startsWith(p))) continue;
    kept.push(trimmed);
  }
  // 两种话题标记都清:带 # 前缀的(#塌陷床垫[话题]#)和正文尾部无 # 的(塌陷床垫[话题]) --
  // 话题名是内容归属不是观点,且「塌陷床垫」「床垫救星」类话题名会造成误计分。
  // 注意:标签行的计分在 extractBodyAndTags 里单独走 tags 通道,不受这里影响
  const clean = (s: string) => s.replace(/#[^#\s]{1,30}\[话题\]#?/g, " ").replace(/(?<!#)[^#\s]{1,30}\[话题\]/g, " ");
  return { body: clean(kept.join("\n")), tags: clean(tags.join(" ")) };
}

function isNegatedAt(text: string, index: number): boolean {
  const window4 = text.slice(Math.max(0, index - 4), index);
  if (NEGATION_SUFFIXES.some((s) => window4.endsWith(s))) return true;
  // 强否定短语允许更远的间隔（"很少听见她抱怨睡醒腰疼"间隔可达 9 字）
  const window10 = text.slice(Math.max(0, index - 10), index);
  return STRONG_NEGATION_PHRASES.some((s) => window10.includes(s));
}

// 旧床垫/竞品主语：负面描述指向他物他牌，不是麻大师投诉（16 字窗口覆盖"被软床折磨了一整年…"式长铺垫）
function isExternalSubjectAt(text: string, index: number): boolean {
  const window16 = text.slice(Math.max(0, index - 16), index);
  return OLD_MATTRESS_SUBJECTS.some((s) => window16.includes(s)) || OTHER_BRAND_SUBJECTS.some((s) => window16.includes(s));
}

// 泛指段落豁免：段落开头出现"很多/有些/不少+床垫"式泛指主语时，
// 整段的负面词都指向"某些床垫"而非麻大师（"很多网红床垫不但软乎乎…夏天睡闷热…直接发霉"跨句传播，16字窗口够不到）
function isGenericParagraphAt(text: string, index: number): boolean {
  // 向上最多看 4 行（小红书正文用换行断句,"泛指主语行 + 症状展开行"常被拆成多行;
  // 每轮从当前行首的换行符之前继续向上,不能停在同一个换行上）
  let boundary = index;
  for (let k = 0; k < 4; k += 1) {
    const prev = text.lastIndexOf("\n", boundary - 1);
    if (prev === -1) break;
    const lineStart = prev + 1;
    const context = text.slice(lineStart, index);
    if (/[很有些不少]多?[数张]?[网红通]?床垫|网红床垫|杂牌/.test(context)) return true;
    boundary = prev; // 下一轮从该换行符之前继续找
  }
  return /[很有些不少]多?[数张]?[网红通]?床垫|网红床垫|杂牌/.test(text.slice(0, index));
}

// 语境豁免：如"垃圾"前接"包装"（"包装垃圾顺手带走"是物流描述）
function isContextExemptAt(text: string, index: number, term: string): boolean {
  const prefixes = CONTEXT_EXEMPTIONS[term];
  if (!prefixes) return false;
  const window6 = text.slice(Math.max(0, index - 6), index);
  return prefixes.some((p) => window6.includes(p));
}

// 后置否定/转好："一点异味都没有""腰酸也好了很多"
function isPostNegatedAt(text: string, index: number, termLength: number): boolean {
  const after = text.slice(index + termLength, index + termLength + 6);
  return POST_NEGATION_PHRASES.some((s) => after.startsWith(s) || after.includes(s));
}

// 后接身份词："腰突宝妈""腰酸星人"是人群自述
function isSuffixExemptAt(text: string, index: number, term: string): boolean {
  const suffixes = SUFFIX_EXEMPTIONS[term];
  if (!suffixes) return false;
  const after = text.slice(index + term.length, index + term.length + 3);
  return suffixes.some((s) => after.startsWith(s));
}

function scanSentimentText(text: string, weight: number, negStartIndex = 0): { neg: number; pos: number } {
  let neg = 0;
  let pos = 0;
  let i = 0;
  while (i < text.length) {
    const bucket = TERMS_BY_FIRST_CHAR.get(text[i]);
    if (bucket) {
      let matched = false;
      for (const t of bucket) {
        if (text.startsWith(t.term, i)) {
          let exempt = false;
          if (!t.skip) {
            if (t.negative) {
              // 负面词：否定/他物他牌主语/泛指段落/语境/后置转好/身份后缀均豁免；转折点之前的负面词不计（买前痛点）
              exempt = i < negStartIndex || isNegatedAt(text, i) || isExternalSubjectAt(text, i) ||
                isGenericParagraphAt(text, i) || isContextExemptAt(text, i, t.term) || isPostNegatedAt(text, i, t.term.length) ||
                isSuffixExemptAt(text, i, t.term);
            } else {
              // 正面词只认否定："不贴合"不能计正分（横评真差评的逻辑缺陷修复）
              exempt = isNegatedAt(text, i);
            }
          }
          if (!t.skip && !exempt) {
            if (t.negative) neg += weight;
            else pos += weight;
          }
          i += t.term.length;
          matched = true;
          break;
        }
      }
      if (matched) continue;
    }
    i += 1;
  }
  return { neg, pos };
}

export function classifyNoteSentiment(note: { title?: string; noteBody?: string; author?: string }): NoteSentiment {
  const title = (note.title ?? "").trim();
  const { body, tags } = extractBodyAndTags(note.noteBody ?? "");
  if (!title && !body && !tags) return { label: "neutral", neg: 0, pos: 0 };
  // 标题带问号的负面词多为悬念钩子（"劝退？我赚到了"），权重降为 1 与正文一致；
  // 真正的投诉标题罕见疑问句式
  const titleWeight = /[？?]/.test(title) ? 1 : 2;
  const t = scanSentimentText(title, titleWeight);
  const b = scanSentimentText(body, 1, findTurnIndex(body));
  // 标签是弱信号（话题归属而非观点），半权计分
  const g = scanSentimentText(tags, 0.5);
  let neg = t.neg + b.neg + g.neg;
  const pos = t.pos + b.pos + g.pos;
  // 恐吓式标题 + 正文反转：标题负面词清零（"腰酸背痛警告😭" + 正文"闭眼冲"）
  if (t.neg > 0 && TITLE_FEAR_HOOKS.test(title) && BODY_REVERSAL_SIGNALS.test(`${title}\n${body}`)) {
    neg -= t.neg;
  }
  if (neg > pos) {
    // 疑问/求证标题:提问帖不是投诉
    if (QUESTION_TITLE_PATTERNS.test(title)) return { label: "neutral", neg, pos };
    // 平台投诉:投诉对象是京东/物流等,不是麻大师
    if (PLATFORM_COMPLAINT_PATTERNS.test(title) && !(note.noteBody ?? "").includes("麻大师客服")) return { label: "neutral", neg, pos };
    // 行业测评/预告类标题:@多品牌无结论,不判负面
    if (NEUTRAL_TITLE_PATTERNS.test(title)) return { label: "neutral", neg, pos };
    // 品牌官方账号（作者含"麻大师"）的痛点设问是营销话术，不判负面
    if ((note.author ?? "").includes("麻大师")) return { label: "neutral", neg, pos };
    return { label: "negative", neg, pos };
  }
  if (pos > neg) return { label: "positive", neg, pos };
  return { label: "neutral", neg, pos };
}
