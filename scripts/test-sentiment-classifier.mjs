// 舆论倾向分类器契约测试（真值以 src/lib/sentimentClassifier.ts 为准）：
//   node --experimental-strip-types scripts/test-sentiment-classifier.mjs
// 用例来源：
//   - 2026-09-14 线上案例「床垫别乱买！踩无数坑总结的选购攻略」被误判负面（实为麻大师豆芽3.0种草攻略文）：
//     转折点「我这次选了麻大师」未命中 TURN_MARKERS（旧表只有「这次我选」），
//     标题钩子「别乱买/踩无数坑」缺少正文反转信号豁免。
//   - 2026-09-19 线上案例「【关于床垫太软我有话说】」（乔乔爱宅家, 2026-08-29 12:09:48）被误判负面
//     （实为软床加硬神器种草文）：转折点写作「试了一下现在的棕榈垫加硬，我选的是一家做黄麻的加硬神器」，
//     弱转折标记「试了一下/我选的」不在 TURN_MARKERS 中，旧床垫的 避雷/塌陷×2/不舒服/坑 全部计分。
//     修复：新增 WEAK_TURN_MARKERS（必须紧跟正向评价，防止真投诉被误当转折点而漏报）。
//   - 2026-09-19 全库审计：装修流水账「换货」主语是床头柜，不是床垫售后（新增语境/后缀豁免）。
//   - 避雷/踩雷/虚假宣传类真实投诉必须保持负面，防止规则放宽导致漏报。
import { classifyNoteSentiment, debugScanSentiment } from "../src/lib/sentimentClassifier.ts";

const cases = [
  {
    name: "攻略种草文：转折点+标题钩子豁免 → positive",
    note: {
      title: "床垫别乱买！踩无数坑总结的选购攻略",
      author: "小林姐姐",
      noteBody: "标题：床垫别乱买！踩无数坑总结的选购攻略\n作者：小林姐姐\n正文：劝大家买床垫别跟风！\n之前踩过好几次床垫的坑。软床垫睡完腰悬空，早起腰酸；硬床垫又硌得浑身不舒服。\n踩雷很多之后，我总结出一套床垫选购经验！\n我这次选了麻大师的豆芽3.0经典款，黄麻支撑到位，不会硌骨头。老式弹簧翻身整张床晃动；18cm独立袋装弹簧，边缘加固，坐在床边支撑不塌陷。\n床垫选对，居家幸福感直接拉满～\n标签：床垫推荐、床垫推荐性价比高的品牌",
    },
    expect: "positive",
  },
  {
    name: "2026-09-19 案例：软床加硬神器种草文（弱转折点）→ positive",
    note: {
      title: "【关于床垫太软我有话说】",
      author: "乔乔爱宅家",
      noteBody:
        "标题：【关于床垫太软我有话说】\n作者：乔乔爱宅家\n发布时间：2026-08-29 12:09:48\nIP 属地：广东\n正文：上次我发了我家一万多买的床垫避雷，\n有姐妹好奇后面我怎么样了\n床垫不是一买回来就软就塌陷的，是睡了一段时间后就塌陷的，加上我怀孕体重上涨，所以不好焕新\n但床垫确实也睡不了了，\n只会越睡越不舒服越睡越软......\n而且我现在是带娃睡觉，太软的床垫对娃的脊椎发育也不健康！\n❌试过了硬木板直接加硬，太硬了，腰睡着还是不舒服\n❌试过了纸板，加上跟没加一样，床垫还是一踩一个坑\n后面听了网上姐妹的建议，试了一下现在的棕榈垫加硬，我选的是一家做黄麻的加硬神器，确实还不错，可以给跟我一样睡不惯软床的姐妹分享一下\n✨【睡感很符合】\n他不是那种生硬，因为里面是植物弹簧“黄麻”填充，自带支撑护脊和透气，整个背部睡上去都可以点对点的贴合住，睡起来放松踏实多了！很快就能适应这个睡感，而且也不用担心睡久会塌陷，\n✨【面料可以全拆】\n面料也是8d设计，舒适又透气，完全不担心闷热\n加硬神器真的太香了😭\n#床垫太软[话题]#软床垫加硬神器[话题]#麻大师护脊宝床垫[话题]\n标签：床垫太软、软床垫加硬神器、麻大师软床垫加硬神器、麻大师护脊宝床垫、黄麻床垫",
    },
    expect: "positive",
  },
  {
    name: "弱转折点需正向信号：先投诉后点品牌 → 不豁免，negative",
    note: { title: "定制床垫踩坑记录", noteBody: "正文：我买的是加硬款，结果宽度差两公分。反馈给客服，客服说误差很合理，只好退掉。" },
    expect: "negative",
  },
  {
    name: "转折点之后的真投诉仍然计分 → negative",
    note: { title: "床垫使用记录", noteBody: "正文：入手了麻大师加硬神器，结果睡了一个月还是塌陷了，客服也不处理。" },
    expect: "negative",
  },
  {
    name: "装修流水账：换货主语是床头柜 → 不判负面",
    note: {
      title: "五周 家电家具全齐",
      noteBody: "正文：麻大师定制了折叠床垫，做工还行，也没有味道。床头柜花纹不理想，换货柜子色差太大，最终放弃更换，处理换货用了刚好五周。",
    },
    expect: "neutral",
  },
  { name: "种草收尾「太香了」计入正面 → positive", note: { title: "床垫加硬神器真的太香了", noteBody: "正文：铺上麻大师加硬神器，腰不酸了。" }, expect: "positive" },
  { name: "真实投诉：避雷标题 → negative", note: { title: "避雷麻大师床垫" }, expect: "negative" },
  { name: "真实投诉：踩雷后续 → negative", note: { title: "麻大师床垫踩雷——后续" }, expect: "negative" },
  { name: "真实投诉：虚假宣传 → negative", note: { title: "麻大师床垫虚假宣传" }, expect: "negative" },
  { name: "真实投诉：味道熏人 → negative", note: { title: "麻大师床垫味道熏人" }, expect: "negative" },
  { name: "真实投诉：退货售后 → negative", note: { title: "网购麻大师床垫的退货大无语" }, expect: "negative" },
  { name: "求推荐提问帖 → 不判负面", note: { title: "帮我选个床垫吧", noteBody: "好纠结，预算有限。" }, expect: "neutral" },
  { name: "通用睡感原则：塌腰豁免，支撑到位计正分 → positive", note: { title: "睡感怎么选", noteBody: "太软塌腰，太硬硌人，要选支撑到位的。" }, expect: "positive" },
];

let failed = 0;
for (const c of cases) {
  const r = classifyNoteSentiment(c.note);
  const ok = r.label === c.expect;
  if (!ok) {
    failed += 1;
    const d = debugScanSentiment(c.note);
    console.error(`FAIL ${c.name}: expect=${c.expect} got=${r.label} (neg=${r.neg} pos=${r.pos})`);
    for (const h of d.hits) console.error(`  [${h.src}] ${h.counted ? "COUNT" : "skip "} ${h.term}  …${h.ctx.replace(/\n/g, " ")}…`);
  } else {
    console.log(`ok   ${c.name} → ${r.label}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} 个用例失败`);
  process.exit(1);
}
console.log("\n全部通过");
