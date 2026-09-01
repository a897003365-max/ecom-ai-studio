# -*- coding: utf-8 -*-
# WARNING: PII - 从 agent_data_7d.json / chat_sessions_7d.json 读取聚合数据，HTML 输出不直接含 PII。
# 中间产物（chat_sessions_7d.json / agent_data_7d.json）含完整 PII，
# 已通过 .gitignore 防止入仓。HTML 输出已校验为 PII-safe。
# === 严禁把这些中间文件提交到任何代码仓库 ===
"""7天数据版 客服话术分析汇报 HTML 生成器"""
import json, re, statistics, math, html
from collections import Counter, defaultdict
from datetime import datetime

with open('chat_sessions_7d.json', 'r', encoding='utf-8') as f:
    SESSIONS = json.load(f)
with open('agent_data_7d.json', 'r', encoding='utf-8') as f:
    AGENT_DATA = json.load(f)

# 麻小宝催单次数高亮（74次全队最高）
PUSH_BADGE = '<div style="font-size:10px;color:#dc2626;font-weight:700;margin-top:4px">⚠ 74次全队最高</div>'

def esc(s):
    return html.escape(str(s)) if s else ''

def parse_time(t):
    return datetime.strptime(t, '%Y-%m-%d %H:%M:%S')

# ---------- 重新计算指标 ----------
def recompute(name):
    ad = AGENT_DATA[name]
    m = ad['metrics']
    return {
        'name': name,
        'short': name.replace('麻大师自营','').replace('麻大师','').replace('店','').replace('-','').replace('_',''),
        'sessions': ad['sessions'],
        'svc': m['svc'], 'cust': m['cust'],
        'rt_med': m['rt_med'], 'rt_p90': m['rt_p90'],
        'avg_sl': m['avg_sl'],
        'short_pct': m['short_pct'], 'long_pct': m['long_pct'],
        'links': m['links'], 'pics': m['pics'],
        'emoji': m['emoji'], 'quote': m['quote'],
        'open_q': m['open_q'], 'closed_q': m['closed_q'], 'any_q': m['any_q'],
        'feature': m['feature'], 'benefit': m['benefit'], 'fab_both': m['fab_both'],
        'empathy': m['empathy'], 'reassure': m['reassure'], 'apology': m['apology'],
        'pushy': m['pushy'], 'hundred': m['hundred'],
        'warranty': m['warranty'], 'freight': m['freight'],
        'huangma': m['huangma'], 'spring': m['spring'],
        'scene': m['scene'], 'logistics': m['logistics'],
        'reco': m['reco'], 'activity': m['activity'], 'custom': m['custom'],
    }

NAMES_ORDER = sorted(AGENT_DATA.keys(), key=lambda x: -AGENT_DATA[x]['metrics']['svc'])
METRICS = {n: recompute(n) for n in NAMES_ORDER}

def radar_dims(m):
    resp = max(0, min(100, 100 - (m['rt_med']-7)/(30-7)*100)) if m['rt_med'] else 50
    dens = max(0, min(100, 100 - (m['short_pct']-22)/(58-22)*100))
    ques = max(0, min(100, m['open_q']/1.5*100))
    fab = max(0, min(100, m['fab_both']/4*100))
    emp = max(0, min(100, (m['empathy']+m['reassure'])/13*100))
    sale = max(0, min(100, (m['pushy']+m['hundred']+m['reco'])/14*100))
    return [resp, dens, ques, fab, emp, sale]

def radar_svg(values, labels, color='#2563eb', size=240):
    cx, cy, r = size/2, size/2, size/2-42
    n = len(values)
    grid_levels = [0.25, 0.5, 0.75, 1.0]
    svg = [f'<svg viewBox="-60 -18 {size+120} {size+36}" class="radar" style="overflow:visible">']
    for g in grid_levels:
        gp = []
        for i in range(n):
            ang = -math.pi/2 + i*2*math.pi/n
            gp.append(f'{cx+r*g*math.cos(ang)},{cy+r*g*math.sin(ang)}')
        svg.append(f'<polygon points="{" ".join(gp)}" fill="none" stroke="#e2e8f0" stroke-width="1"/>')
    for i in range(n):
        ang = -math.pi/2 + i*2*math.pi/n
        svg.append(f'<line x1="{cx}" y1="{cy}" x2="{cx+r*math.cos(ang)}" y2="{cy+r*math.sin(ang)}" stroke="#e2e8f0" stroke-width="1"/>')
    dp = []
    for i in range(n):
        ang = -math.pi/2 + i*2*math.pi/n
        val = values[i]/100.0
        dp.append(f'{cx+r*val*math.cos(ang)},{cy+r*val*math.sin(ang)}')
    svg.append(f'<polygon points="{" ".join(dp)}" fill="{color}" fill-opacity="0.18" stroke="{color}" stroke-width="2"/>')
    for i in range(n):
        ang = -math.pi/2 + i*2*math.pi/n
        val = values[i]/100.0
        svg.append(f'<circle cx="{cx+r*val*math.cos(ang)}" cy="{cy+r*val*math.sin(ang)}" r="3" fill="{color}"/>')
    for i, lab in enumerate(labels):
        ang = -math.pi/2 + i*2*math.pi/n
        lx = cx + (r+16)*math.cos(ang)
        ly = cy + (r+16)*math.sin(ang)
        anchor = 'middle'
        if math.cos(ang) > 0.3: anchor='start'
        elif math.cos(ang) < -0.3: anchor='end'
        svg.append(f'<text x="{lx}" y="{ly}" text-anchor="{anchor}" dominant-baseline="middle" class="radar-label" font-size="10">{lab}</text>')
    svg.append('</svg>')
    return ''.join(svg)

def bar_svg(items, max_val=None, unit='%'):
    if not items: return ''
    max_val = max_val or max(v for _,v,_ in items) or 1
    w = 520
    bar_h = 22; gap = 8
    h = len(items)*(bar_h+gap)
    svg = [f'<svg viewBox="0 0 {w} {h}" class="bar">']
    for i,(lab,val,col) in enumerate(items):
        y = i*(bar_h+gap)
        bw = w*0.62*val/max_val
        svg.append(f'<text x="0" y="{y+bar_h/2+4}" class="bar-label" font-size="11" fill="#475569">{lab}</text>')
        svg.append(f'<rect x="{w*0.30}" y="{y}" width="{w*0.62}" height="{bar_h}" fill="#f1f5f9" rx="3"/>')
        svg.append(f'<rect x="{w*0.30}" y="{y}" width="{bw}" height="{bar_h}" fill="{col}" rx="3"/>')
        svg.append(f'<text x="{w*0.30+max(bw,3)+6}" y="{y+bar_h/2+4}" class="bar-val" font-size="11" fill="#1e293b" font-weight="700" stroke="#fff" stroke-width="3" paint-order="stroke">{val:.1f}{unit}</text>')
    svg.append('</svg>')
    return ''.join(svg)

# ---------- 8 个客服画像（基于 7 天数据） ----------
PROFILES = {
'麻大师自营麻小宝': {
 'tier':'🟠 第二梯队','role':'售前+售后·价格异议专家','color':'#f59e0b',
 'tag':'价格异议专家·引用噪声王',
 'radar_color':'#f59e0b',
 'good':[
   ('顾客"贵"','"亲，活动促销订单量特别大，下单后预计7天左右发货，早拍早排单哦"','用"早排单"转化为下单理由，不回避价格'),
   ('顾客"还能优惠点吗"','"所有优惠页面统一公示，价格透明无额外优惠，咱们支持 90天保价，买贵退差，您放心下单就好"','全队最规范的价格异议话术：透明+保价+兜底'),
   ('顾客"退货有运费吗"','"30天内免费试用""不用哦，赠送大件运费险的"','直接答+点出权益'),
 ],
 'bad':[
   ('74次"宝喜欢就赶紧下单"','会话结尾反复催','催单过度，每会话都用同一话术'),
   ('35次"引用："噪声','系统功能误用','全队最高，纯噪声'),
   ('100天话术仅1.2%','活动话术强但安全感弱','兜底缺失'),
 ],
 'rewrites':[
   ('顾客嫌贵','"现在活动已生效！价格透明无额外优惠"','加上"而且支持100天试睡不合适免费退，相当于零风险体验"组合兜底'),
   ('催单"赶紧下单"','74次重复同一句','分阶段话术：①首推②"库存X个" ③"帮您加购物车了"'),
   ('35次"引用："','系统功能误用','禁用"引用"功能键，直接答'),
 ],
 'targets':[('引用噪声','35次 → 0'),('催单调换','74次 → ≤30次'),('100天话术','1.2% → ≥2.5%')],
},
'麻大师自营-麻小希': {
 'tier':'⭐ 第一梯队','role':'售前为主·资深推荐官','color':'#2563eb',
 'tag':'FAB+100天冠军·资深推荐官',
 'radar_color':'#2563eb',
 'good':[
   ('顾客问豆7 2.0','"S型黄麻是平铺黄麻的升级工艺，像弹簧一样有波浪弹性，分区承托，贴合脊椎曲线，躺下腰部不悬空，透气性比平铺黄麻提升50%，夏天不闷汗"','全队最专业的S型黄麻FAB：特征+具体数据+体感'),
   ('顾客"我再对比下"','"现在我们家床垫有100天免费试睡服务 试睡期间不合适 不满意 退回运费我们承担，您可以先体验哈，让您选购更放心哦"','挽留话术完整：100天+运费险+零风险'),
   ('顾客"你们京东平台贵"','"哪个优惠您在哪里下单就可以了呢"','不辩解，引导回平台比价'),
 ],
 'bad':[
   ('顾客"这么贵"','"是的亲亲"（无实质回应）','回避价格问题'),
   ('顾客"不要了太贵"','"好吧#E-s61"','直接放弃，无挽留'),
   ('开场"在的亲"107次','固定开场太单调','无探需'),
 ],
 'rewrites':[
   ('顾客"这么贵"','"是的亲亲"','"亲活动期已经是7.8折+国补15%了，而且支持100天试睡不满意免费退，您可以先体验再决定"'),
   ('顾客"不要了太贵"','"好吧#E-s61"','"好的亲没关系～您是价格还是哪方面犹豫？跟我说说，说不定能解决"'),
   ('开场"在的亲"','107次单条','补探需："在的亲～您是想了解睡感、价格还是尺寸呢？"'),
 ],
 'targets':[('挽单"好吧"','→ 三段式'),('价格回避','"是的亲"→补FAB+兜底'),('开场探需','补"想了解啥" → 每会话至少问1次')],
},
'麻大师自营麻小晴': {
 'tier':'🟡 第二梯队','role':'售前+售后·技术讲解员','color':'#f59e0b',
 'tag':'技术讲解员·追问弱',
 'radar_color':'#f59e0b',
 'good':[
   ('顾客问"经典vs升级"','"经典的是平铺黄麻的，升级的是S型黄麻的""平铺黄麻：平面压缩采用优质精细黄麻；S型精细黄麻通过梳理、铺网、高温热压等工艺繁琐，但纤维长密度高，品质好"','技术讲解清晰，区分平铺vs S型工艺'),
   ('顾客问"睡感区别"','"折叠只是针对下面的黄麻折叠，上面还有一层3cm的面料层起到减震、舒缓、连接的作用，折痕处不会有太大影响哦"','工艺细节讲得透，消除顾虑'),
   ('顾客问"折叠优缺点"','"不折叠的没那么方便收纳呢。一般做榻榻米的话底下是要收纳取东西的，床垫定制折叠就比较方便哦"','场景化推荐，给具体使用场景'),
 ],
 'bad':[
   ('开放问0.1%(全队最低)','几乎不主动问顾客需求','靠顾客自己说需求，漏掉大量潜在买家'),
   ('FAB 1.5%(弱)','技术讲解详尽但缺利益转化','"有这个"但不说"对您有啥好处"'),
   ('回复节奏不稳','有时秒回有时1分钟','状态波动'),
 ],
 'rewrites':[
   ('技术讲解后无探需','"S型黄麻通过…纤维长密度高"','补问："您主要是给谁睡呢？孩子/老人/自己睡感需求差很多"'),
   ('FAB弱','只讲工艺不转化','"S型黄麻纤维长密度高→好处是**用10年不塌陷、支撑持久**"'),
   ('"在的亲"少(4次)','开场用"#E-s07"表情包','开场用文字+探需：发文字欢迎+问需求'),
 ],
 'targets':[('开放提问','0.1% → ≥1%'),('FAB转化','1.5% → ≥2.5%'),('技术+利益','每段工艺后补"对您有啥好处"')],
},
'麻大师自营-麻小顺': {
 'tier':'🟠 第二梯队','role':'售前+售后·自动欢迎王','color':'#f59e0b',
 'tag':'自动欢迎王·共情担当',
 'radar_color':'#f59e0b',
 'good':[
   ('顾客"可以试睡么"','"现在活动下单享100天免费试用（定制除外），赠送大件运费险，90天首次退货运费商家全包，超额也由我们承担，零成本试睡！"','100天话术最完整队1：试睡+运费险+兜底'),
   ('顾客"还能优惠吗"','"所有优惠页面统一公示，价格透明无额外优惠，咱们支持 90天保价，买贵退差，您放心下单就好"','规范价格异议三段式'),
   ('共情10.7%全队最高','"亲喜欢的话早下单早发货呢，这边有十年质保和100天免费试睡的"','安抚+兜底组合'),
 ],
 'bad':[
   ('117次"亲亲来啦"自动欢迎','模板化程度全队最高','每次会话都发同一长串欢迎'),
   ('68次"#E-b09"表情','"知道了"类表情刷屏','有水分'),
   ('引用12次','功能误用','纯噪声'),
 ],
 'rewrites':[
   ('"亲亲来啦"117次','模板化','自动欢迎+1句探需：识别进店路径+问"想了解啥"'),
   ('"#E-b09"刷屏','68次','减少表情重复，关键节点用文字'),
   ('引用12次','功能误用','禁用"引用"功能键'),
 ],
 'targets':[('自动欢迎','117次 → 加探需'),('#E-b09','68次 → ≤20次'),('引用','12次 → 0')],
},
'麻大师自营-麻小新': {
 'tier':'🟡 第二梯队','role':'售前+售后·无引用卫士','color':'#f59e0b',
 'tag':'无引用卫士·多线并发',
 'radar_color':'#f59e0b',
 'good':[
   ('0次"引用："噪声','全队唯一无引用','话术规范'),
   ('顾客"运费险用自己报吗"','"不用的，您下单就享受的"','直接答+点出权益'),
   ('顾客"试睡服务吗"','"十年质保，100天免费试睡，有购买大件货物运费险。到货后可以放心拆包验货哈亲，拆包试睡，体验，不合适不喜欢尽管退不勉强~"','质保+试睡+运费险完整话术'),
 ],
 'bad':[
   ('127次"亲亲来啦"全队最高','多线并发导致模板重复','每会话都发同一自动欢迎'),
   ('FAB 1.1%弱','讲完技术不转化','参数堆砌'),
   ('顾客追问时重复发链接','"亲亲来啦"+发链接','疑似切线/重连'),
 ],
 'rewrites':[
   ('"亲亲来啦"127次','自动欢迎模板','精简欢迎+探需一句'),
   ('FAB弱','"豆苗是更适合儿童的亲"','补"为什么适合"：豆苗S型黄麻+华夫格面料，硬中带弹适合发育期孩子脊柱'),
   ('重复发链接','切线嫌疑','先确认"刚才那条是您要看的那款吗？"'),
 ],
 'targets':[('自动欢迎','127次 → 简化+探需'),('FAB','1.1% → ≥2.5%'),('链接重复','确认后再发')],
},
'麻大师自营-麻柚子': {
 'tier':'🟠 第二梯队','role':'售前+售后·短消息病号','color':'#f59e0b',
 'tag':'短消息病号·催单尚可',
 'radar_color':'#f59e0b',
 'good':[
   ('顾客"价格2800→2990"','"您看到的价格有差异，很可能是您的个人消费券或者平台的限时补贴""平台会随机发放优惠的"','用机制解释价格波动，不甩锅'),
   ('顾客"几折的劵"','"这个看平台的，我们不清楚的，平台发的金额是随机的"','诚实+机制解释，不装懂'),
   ('保价话术','"支持3个月保价，买贵可退差价"','主动给兜底'),
 ],
 'bad':[
   ('短消息51%全队最高','一半以上消息不到10字','严重碎消息'),
   ('引用27次(队2)','系统功能误用','纯噪声'),
   ('100天话术仅1.1%','活动强但兜底弱','失衡'),
   ('价格对话后立刻催单','顾客"那你们能给个折扣么"→客服解释→15分钟后"宝喜欢就赶紧下单"','催单时机错误'),
 ],
 'rewrites':[
   ('短消息合并','5条连发→1条长句','"亲～活动最后1小时，78折+国补+100天试睡+运费险，喜欢可以锁定"'),
   ('引用27次','系统功能误用','禁用"引用"功能键'),
   ('催单时机','顾客刚质疑价就催','"您主要是价格犹豫吗？我帮您算到手价看看能不能优化"'),
 ],
 'targets':[('短消息率','51% → ≤35%'),('引用','27次 → 0'),('100天话术','1.1% → ≥2.5%')],
},
'麻大师自营-麻小星': {
 'tier':'⭐ 第一梯队','role':'售前+售后·综合素质冠军','color':'#2563eb',
 'tag':'综合素质冠军·长消息之王',
 'radar_color':'#2563eb',
 'good':[
   ('顾客"凝胶水？"','"咱们黄麻芯采用高温热压成型工艺，垫层边缘使用少量环保热熔胶固定（合规用量，符合母婴级安全标准），出厂气味清淡，拆开无需长时间散味"','诚实+详细+合规——黄麻热压工艺+边缘少量热熔胶固定，全句零禁用词'),
   ('顾客"贵/优惠"','"页面标注的优惠就是当前全部活动，能享受的系统下单会自动抵扣，没有私下额外优惠哦。支持保价3个月的呢"','价格异议清晰专业，不回避'),
   ('顾客"晒单有优惠吗"','"到货满意晒单可以给您返20，小红薯可以额外多返20哦"','售后运营动作清晰'),
 ],
 'bad':[
   ('"在的亲"仅1次，"亲亲来啦"0次','但"欢迎光临"等模板用得少','反而显得专业'),
   ('3次引用','少量','基本规范'),
   ('单会话深度有限','117会话偏少','可能因质量优先分流'),
 ],
 'rewrites':[
   ('价格异议已规范','维持即可','增加主动兜底"100天试睡不满意免费退"组合'),
   ('环保话术已合规','作为团队标杆话术','录案例库，全队学习'),
   ('催单话术偏少','18次仅2.1%','可适度增加分阶段催单'),
 ],
 'targets':[('催单话术','2.1% → ≥3%'),('环保话术','录为团队标杆'),('100天兜底','增加频次')],
},
'麻大师自营店-麻欢欢': {
 'tier':'⭐ 第一梯队','role':'售前为主·催单冠军','color':'#2563eb',
 'tag':'催单冠军·差异化开场',
 'radar_color':'#2563eb',
 'good':[
   ('顾客"工艺？"→"材质？"→"甲醛？"','连串追问都直接答："高温热压""大豆纤维+黄麻""全拆款，黄麻与大豆纤维热压成型""符合国标安全标准"','一问一答清晰，全句零禁用词'),
   ('顾客"敏感皮肤直接用吗"','"可以的哈亲"','直接答+安慰'),
   ('收尾"不客气～如果对产品没有疑问，喜欢可以直接拍下哦，有任何问题随时再来找我😊"','标准化收尾+催单+承诺','节奏好的收尾模板'),
 ],
 'bad':[
   ('共情5.1%偏低','快速答完但温度不够','纯应答型'),
   ('引用8次','中等','噪声存在'),
   ('开场"在的哦亲"54次','差异化但缺探需','不错但能更好'),
 ],
 'rewrites':[
   ('连续直接答','"高温热压"+"大豆纤维+黄麻"','在每答后面补一句"您是想给家人用还是自己睡？"探需'),
   ('收尾"喜欢可以直接拍下"','缺少100天兜底','"喜欢可以拍下锁定，100天试睡不合适免费退"组合'),
   ('引用8次','中等','禁用"引用"功能键'),
 ],
 'targets':[('共情词','5.1% → ≥8%'),('催单+100天','催单强但100天弱→组合'),('探需','快速答后加一句"您主要是？"')],
},
}

# ---------- CSS ----------
CSS = """
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:"PingFang SC","Microsoft YaHei","Helvetica Neue",Arial,sans-serif;background:#0f172a;color:#1e293b}
.deck{display:flex;flex-direction:column;align-items:center;gap:24px;padding:32px 16px}
.slide{width:1100px;max-width:100%;min-height:680px;background:#fff;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.4);padding:48px 56px;position:relative;overflow:hidden;display:flex;flex-direction:column}
.slide-num{position:absolute;bottom:18px;right:28px;font-size:12px;color:#94a3b8;font-weight:600}
.slide-tag{position:absolute;top:24px;right:32px;font-size:11px;color:#fff;padding:4px 12px;border-radius:20px;font-weight:600}
h1{font-size:38px;font-weight:800;color:#0f172a;letter-spacing:-.5px}
h2{font-size:28px;font-weight:700;color:#0f172a;margin-bottom:6px;letter-spacing:-.3px}
h3{font-size:18px;font-weight:700;color:#334155;margin-bottom:10px}
.sub{font-size:15px;color:#64748b;margin-bottom:24px}
.lead{font-size:17px;color:#475569;line-height:1.7}
.kicker{font-size:13px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px}
.cover{background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 60%,#2563eb 100%);color:#fff;justify-content:center}
.cover h1{color:#fff;font-size:48px;margin-bottom:16px}
.cover .sub{color:#cbd5e1;font-size:18px;margin-bottom:32px}
.cover .meta{display:flex;gap:32px;margin-top:24px}
.cover .meta div{font-size:13px;color:#94a3b8}
.cover .meta b{display:block;font-size:24px;color:#fff;font-weight:800;margin-bottom:2px}
.grid{display:grid;gap:16px}
.grid-2{grid-template-columns:1fr 1fr}
.grid-3{grid-template-columns:1fr 1fr 1fr}
.card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:18px}
.metric{background:#f8fafc;border-radius:10px;padding:14px 16px;border:1px solid #e2e8f0}
.metric b{font-size:30px;font-weight:800;color:#0f172a;display:block}
.metric span{font-size:12px;color:#64748b;white-space:nowrap;display:block}
table{width:100%;border-collapse:collapse;font-size:13px}
th{background:#0f172a;color:#fff;padding:10px 8px;text-align:center;font-weight:600;font-size:12px}
td{padding:8px 6px;border-bottom:1px solid #e2e8f0;text-align:center;font-size:12px}
td:first-child,th:first-child{text-align:left;padding-left:12px}
tr:hover td{background:#f8fafc}
.good{color:#16a34a;font-weight:700}
.bad{color:#dc2626;font-weight:700}
.warn{color:#ea580c;font-weight:700}
.quote{background:#f1f5f9;border-left:3px solid #94a3b8;padding:10px 14px;border-radius:0 8px 8px 0;font-size:13px;color:#475569;line-height:1.6;margin:6px 0}
.quote.cust{border-left-color:#0891b2;background:#ecfeff}
.quote.good{border-left-color:#16a34a;background:#f0fdf4}
.quote.bad{border-left-color:#dc2626;background:#fef2f2}
.quote small{display:block;color:#94a3b8;font-size:11px;margin-top:4px}
.rewrite-table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}
.rewrite-table th{background:#1e293b;font-size:11px;padding:8px}
.rewrite-table td{padding:10px 8px;vertical-align:top;text-align:left;border:1px solid #e2e8f0;line-height:1.5}
.rewrite-table td:first-child{min-width:120px;font-weight:600;background:#f8fafc}
.rewrite-table .cur{color:#dc2626;background:#fef2f2}
.rewrite-table .new{color:#16a34a;background:#f0fdf4}
.radar{display:block;margin:0 auto}
.radar-label{fill:#475569;font-weight:600}
.bar{display:block;margin:0 auto}
.bar-label{font-weight:600}
.tier-badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700}
.t1{background:#dbeafe;color:#1e40af}
.t2{background:#fef3c7;color:#92400e}
.t3{background:#fee2e2;color:#991b1b}
.target{display:flex;gap:8px;align-items:center;font-size:13px;padding:8px 0;border-bottom:1px dashed #e2e8f0}
.target:last-child{border:0}
.target b{color:#0f172a;min-width:120px}
.target .from{color:#dc2626;font-weight:600}
.target .arr{color:#94a3b8}
.target .to{color:#16a34a;font-weight:700}
.section-rule{height:4px;width:60px;background:linear-gradient(90deg,#2563eb,#60a5fa);border-radius:2px;margin:8px 0 20px}
.agent-head{display:flex;align-items:center;gap:16px;margin-bottom:8px}
.agent-avatar{width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;color:#fff;flex-shrink:0}
.divider{height:1px;background:#e2e8f0;margin:16px 0}
.pill{display:inline-block;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600;margin:2px}
.pill.g{background:#dcfce7;color:#166534}
.pill.b{background:#fee2e2;color:#991b1b}
.note{font-size:12px;color:#94a3b8;margin-top:auto;padding-top:16px;border-top:1px solid #f1f5f9}
ul.clean{list-style:none;padding:0}
ul.clean li{padding:6px 0 6px 22px;position:relative;font-size:13px;color:#475569;line-height:1.6}
ul.clean li:before{content:"";position:absolute;left:0;top:13px;width:8px;height:8px;border-radius:50%}
ul.clean li.g:before{background:#16a34a}
ul.clean li.b:before{background:#dc2626}
"""

def slide_open(content, tag_text='', tag_color='#2563eb', num=''):
    tag = f'<div class="slide-tag" style="background:{tag_color}">{tag_text}</div>' if tag_text else ''
    return f'<section class="slide">{tag}{content}<div class="slide-num">{num}</div></section>'

def cover():
    return f'''
<section class="slide cover">
  <div class="kicker" style="color:#60a5fa">客服话术分析及优化汇报（7天版）</div>
  <h1>麻大师京东自营店<br/>客服话术深度分析与优化建议</h1>
  <div class="sub">1,371 通会话 · 8 位客服 · 18,262 条客服消息 · 6 维度评估</div>
  <div class="meta">
    <div><b>1,371</b>会话样本</div>
    <div><b>8</b>位客服</div>
    <div><b>7</b>天数据</div>
    <div><b>18,262</b>条消息</div>
  </div>
  <div style="margin-top:40px;font-size:13px;color:#94a3b8">汇报对象：客服主管 + 管理层　|　数据范围：2026-08-12 至 2026-08-19　|　总分总结构</div>
</section>'''

def overview_slides():
    s1 = slide_open(f'''
  <div class="kicker">01 总 · 分析概览</div>
  <h2>分析方法论与样本概览</h2>
  <div class="section-rule"></div>
  <div class="grid grid-2">
    <div>
      <h3>数据样本</h3>
      <div class="grid grid-2" style="gap:10px">
        <div class="metric"><b>1,371</b><span>总会话数</span></div>
        <div class="metric"><b>18,262</b><span>总消息数</span></div>
        <div class="metric"><b>9,633</b><span>客服消息</span></div>
        <div class="metric"><b>8,629</b><span>顾客消息</span></div>
        <div class="metric"><b>13.3</b><span>均消息/会话</span></div>
        <div class="metric"><b>10s</b><span>中位响应时长</span></div>
      </div>
    </div>
    <div>
      <h3>六维评估模型</h3>
      <ul class="clean">
        <li class="g"><b>响应速度</b>　中位响应、P90、30秒内占比</li>
        <li class="g"><b>话术密度</b>　短消息率、长消息率、连续短消息</li>
        <li class="g"><b>提问能力</b>　开放问 / 封闭问 / 纯陈述</li>
        <li class="g"><b>利益转化</b>　特征→利益 FAB 同时表达率</li>
        <li class="g"><b>共情温度</b>　共情词 / 安抚词 / 道歉词</li>
        <li class="g"><b>销售主动</b>　催单、100天、推荐具体款</li>
      </ul>
      <div class="note">数据集为麻大师<strong>自营店</strong>（vs 之前的<strong>旗舰店</strong>），是不同团队。维度①②为运营效率指标，③④⑤⑥为话术质量指标。</div>
    </div>
  </div>
''', '总', '#2563eb', '02')

    rows = ''
    for n in NAMES_ORDER:
        m = METRICS[n]
        rows += f'''<tr>
        <td><b>{esc(m["short"])}</b></td><td>{m["sessions"]}</td><td>{m["svc"]}</td>
        <td>{m["rt_med"]:.0f}s</td><td class="{'bad' if m['short_pct']>45 else 'warn' if m['short_pct']>35 else 'good'}">{m["short_pct"]:.0f}%</td>
        <td class="{'bad' if m['open_q']<0.5 else 'warn' if m['open_q']<1 else 'good'}">{m["open_q"]:.1f}%</td>
        <td class="{'bad' if m['fab_both']<1.5 else 'warn' if m['fab_both']<3 else 'good'}">{m["fab_both"]:.1f}%</td>
        <td class="{'bad' if m['empathy']+m['reassure']<5 else 'warn' if m['empathy']+m['reassure']<8 else 'good'}">{m["empathy"]+m["reassure"]:.1f}%</td>
        <td class="{'bad' if m['quote']>10 else 'warn' if m['quote']>3 else ''}">{m["quote"]}</td>
        <td>{esc(PROFILES[n]["role"].split("·")[0])}</td></tr>'''
    s2 = slide_open(f'''
  <div class="kicker">02 总 · 全景对比</div>
  <h2>8 位客服核心指标全景</h2>
  <div class="section-rule"></div>
  <table>
    <thead><tr><th>客服</th><th>会话</th><th>服务消息</th><th>中位响应</th><th>短消息%</th><th>开放问%</th><th>FAB%</th><th>共情%</th><th>引用噪声</th><th>角色</th></tr></thead>
    <tbody>{rows}</tbody>
  </table>
  <div class="note">颜色：绿=优秀 / 橙=待提升 / 红=短板。引用噪声=系统"引用"功能误用次数（纯噪声）。</div>
''', '总', '#2563eb', '03')

    bar_items_open = [(METRICS[n]['short'], METRICS[n]['open_q'], '#2563eb') for n in NAMES_ORDER]
    bar_items_fab = [(METRICS[n]['short'], METRICS[n]['fab_both'], '#16a34a') for n in NAMES_ORDER]
    bar_items_emp = [(METRICS[n]['short'], METRICS[n]['empathy']+METRICS[n]['reassure'], '#ea580c') for n in NAMES_ORDER]
    s3 = slide_open(f'''
  <div class="kicker">03 总 · 三大新维度</div>
  <h2>提问能力 · 利益转化 · 共情温度 对比</h2>
  <div class="section-rule"></div>
  <div class="grid grid-3">
    <div class="card">
      <h3 style="color:#2563eb">① 提问能力（开放问%）</h3>
      <div style="font-size:11px;color:#64748b;margin-bottom:8px">越高越能挖需求</div>
      {bar_svg(bar_items_open, max_val=1.5)}
    </div>
    <div class="card">
      <h3 style="color:#16a34a">② 特征→利益转化（FAB%）</h3>
      <div style="font-size:11px;color:#64748b;margin-bottom:8px">同时提特征+利益才是合格FAB</div>
      {bar_svg(bar_items_fab, max_val=4.0)}
    </div>
    <div class="card">
      <h3 style="color:#ea580c">③ 共情温度（共情+安抚%）</h3>
      <div style="font-size:11px;color:#64748b;margin-bottom:8px">售前建立信任的关键信号</div>
      {bar_svg(bar_items_emp, max_val=12)}
    </div>
  </div>
  <div class="note">关键发现：麻小顺/麻柚子开放提问1.3%最佳（与旗舰店麻柚子一致）；麻小希FAB 3.6%最强；麻小顺共情10.7%最佳。</div>
''', '总', '#2563eb', '04')

    s4 = slide_open(f'''
  <div class="kicker">04 总 · 团队共性</div>
  <h2>四类团队级共性失败模式</h2>
  <div class="section-rule"></div>
  <div class="grid grid-2">
    <div class="card" style="border-left:4px solid #dc2626">
      <h3 style="color:#dc2626">❶ 引用功能误用（100次）</h3>
      <div class="quote bad">"引用：30天内免费试用" <small>麻小宝35 + 麻柚子27 + 麻小顺12 + 麻小晴12 + 麻欢欢8 + 麻小星4 + 麻小希2 = 全队100次噪声</small></div>
    </div>
    <div class="card" style="border-left:4px solid #dc2626">
      <h3 style="color:#dc2626">❷ 催单话术单调（316次"赶紧下单"）</h3>
      <div class="quote bad">"宝，喜欢就赶紧下单吧！"<small>麻小宝74次 + 麻小顺43次 + 麻小晴40次 + 麻小希39次 + 麻小新36次 + 麻欢欢34次 + 麻柚子32次 + 麻小星18次</small></div>
    </div>
    <div class="card" style="border-left:4px solid #ea580c">
      <h3 style="color:#ea580c">❸ 自动欢迎模板化（370次"亲亲来啦"）</h3>
      <div class="quote bad">"亲亲来啦~您的专属客服已上线~有什么需求尽管说，全程暖心陪伴不迷路！ ~"<small>麻小新127次 + 麻小顺117次 + 麻柚子73次 + 麻小晴31次</small></div>
    </div>
    <div class="card" style="border-left:4px solid #ea580c">
      <h3 style="color:#ea580c">❹ 短消息率过高（平均40%）</h3>
      <div class="quote bad">"嗯呢"+"亲需要下单吗"+"宝喜欢就赶紧下单吧" 拆成3条发<small>麻柚子51%最严重、9条话术里近一半不到10字</small></div>
    </div>
  </div>
''', '总', '#2563eb', '05')

    s5 = slide_open(f'''
  <div class="kicker">05 总 · 客服分层</div>
  <h2>8 位客服三梯队管理矩阵</h2>
  <div class="section-rule"></div>
  <div class="grid grid-3">
    <div class="card" style="border-top:4px solid #2563eb">
      <span class="tier-badge t1">⭐ 第一梯队 综合优秀</span>
      <h3 style="margin-top:10px">麻小星 · 麻欢欢 · 麻小希</h3>
      <ul class="clean">
        <li class="g">麻小星：短消息23%队1优、话术密度最强</li>
        <li class="g">麻欢欢：催单12.4%队1、差异化开场</li>
        <li class="g">麻小希：FAB 3.6%队1、100天 3.6%队1、资深推荐</li>
      </ul>
      <div style="margin-top:10px;font-size:12px;color:#2563eb;font-weight:600">→ 带新人 + 话术模板来源</div>
    </div>
    <div class="card" style="border-top:4px solid #f59e0b">
      <span class="tier-badge t2">🟡 第二梯队 需专项提升</span>
      <h3 style="margin-top:10px">麻小晴 · 麻小新 · 麻小顺 · 麻柚子</h3>
      <ul class="clean">
        <li class="b">麻小晴：技术讲解强但追问弱(开放问0.1%)</li>
        <li class="b">麻小新：0引用好但FAB弱(1.1%)</li>
        <li class="b">麻小顺：欢迎模板117次+引用12次</li>
        <li class="b">麻柚子：短消息51%+引用27次</li>
      </ul>
      <div style="margin-top:10px;font-size:12px;color:#92400e;font-weight:600">→ 专项培训补短板</div>
    </div>
    <div class="card" style="border-top:4px solid #f59e0b">
      <span class="tier-badge t2">🟠 重点关注</span>
      <h3 style="margin-top:10px">麻小宝</h3>
      <ul class="clean">
        <li class="g">304会话队1最多，价格异议话术全队最规范</li>
        <li class="b">35次"引用"全队最高噪声</li>
        <li class="b">74次"赶紧下单"全队最高</li>
        <li class="b">100天话术仅1.2%(兜底缺失)</li>
      </ul>
      <div style="margin-top:10px;font-size:12px;color:#92400e;font-weight:600">→ 系统禁用"引用"+催单调换</div>
    </div>
  </div>
''', '总', '#2563eb', '06')

    return s1+s2+s3+s4+s5

def agent_slides(name):
    m = METRICS[name]
    p = PROFILES[name]
    num_base = NAMES_ORDER.index(name)
    color = p['color']
    short = m['short']
    dims = radar_dims(m)
    radar_labels = ['响应速度','话术密度','提问能力','利益转化','共情温度','销售主动']
    initials = short[-1:] if short else '?'

    p1 = slide_open(f'''
  <div class="agent-head">
    <div class="agent-avatar" style="background:{color}">{esc(initials)}</div>
    <div>
      <div class="kicker" style="color:{color}">分 · 客服 {num_base+1}/8 · {p["tier"]}</div>
      <h2 style="margin:0">{esc(short)}</h2>
      <div class="sub" style="margin:4px 0 0">{esc(p["tag"])}</div>
    </div>
  </div>
  <div class="section-rule" style="background:linear-gradient(90deg,{color},#94a3b8)"></div>
  <div class="grid grid-2" style="flex:1">
    <div>
      <h3>六维能力雷达</h3>
      <div style="display:flex;justify-content:center">{radar_svg(dims, radar_labels, color)}</div>
      <div class="note" style="border:0;margin-top:8px">归一化0-100，越大越好。{esc(p["role"])}</div>
    </div>
    <div>
      <h3>核心指标指纹</h3>
      <div class="grid grid-2" style="gap:10px">
        <div class="metric"><b>{m["sessions"]}</b><span>会话数</span></div>
        <div class="metric"><b>{m["svc"]}</b><span>服务消息</span></div>
        <div class="metric"><b>{m["rt_med"]:.0f}s</b><span>中位响应</span></div>
        <div class="metric"><b>{m["short_pct"]:.0f}%</b><span>短消息率</span></div>
        <div class="metric"><b>{m["open_q"]:.1f}%</b><span>开放提问率</span></div>
        <div class="metric"><b>{m["fab_both"]:.1f}%</b><span>FAB转化率</span></div>
        <div class="metric"><b>{m["empathy"]+m["reassure"]:.1f}%</b><span>共情温度</span></div>
        <div class="metric"><b>{m["pushy"]:.1f}%</b><span>催单话术</span>{PUSH_BADGE if m['name'].endswith('麻小宝') else ''}</div>
      </div>
      <div style="margin-top:12px">
        <span class="pill {'g' if m['quote']<=3 else 'b'}">引用噪声 {m["quote"]}次</span>
        <span class="pill {'g' if m['emoji']>5 else 'b'}">Emoji {m["emoji"]}次</span>
        <span class="pill {'g' if m['pics']>15 else 'b'}">配图 {m["pics"]}张</span>
        <span class="pill g">链接 {m["links"]}次</span>
      </div>
    </div>
  </div>
''', short, color, f'{7+num_base*4:02d}')

    good_html = ''
    for scene, quote, eval_ in p['good']:
        good_html += f'''<div class="card" style="border-left:4px solid #16a34a">
        <div style="font-size:12px;color:#64748b;margin-bottom:6px">场景：{esc(scene)}</div>
        <div class="quote good">{esc(quote)}</div>
        <div style="font-size:12px;color:#16a34a;font-weight:600;margin-top:4px">✓ {esc(eval_)}</div>
      </div>'''
    p2 = slide_open(f'''
  <div class="kicker" style="color:{color}">分 · {esc(short)} · 优势实录</div>
  <h2>✅ 话术优势（真实对话）</h2>
  <div class="section-rule" style="background:linear-gradient(90deg,#16a34a,#86efac)"></div>
  <div style="display:flex;flex-direction:column;gap:14px;flex:1;justify-content:center">{good_html}</div>
''', short, color, f'{8+num_base*4:02d}')

    bad_html = ''
    for scene, quote, eval_ in p['bad']:
        bad_html += f'''<div class="card" style="border-left:4px solid #dc2626">
        <div style="font-size:12px;color:#64748b;margin-bottom:6px">场景：{esc(scene)}</div>
        <div class="quote bad">{esc(quote)}</div>
        <div style="font-size:12px;color:#dc2626;font-weight:600;margin-top:4px">✗ {esc(eval_)}</div>
      </div>'''
    p3 = slide_open(f'''
  <div class="kicker" style="color:{color}">分 · {esc(short)} · 短板实录</div>
  <h2>❌ 话术短板（真实对话）</h2>
  <div class="section-rule" style="background:linear-gradient(90deg,#dc2626,#fca5a5)"></div>
  <div style="display:flex;flex-direction:column;gap:14px;flex:1;justify-content:center">{bad_html}</div>
''', short, color, f'{9+num_base*4:02d}')

    rw_rows = ''
    for scene, cur, new in p['rewrites']:
        rw_rows += f'''<tr><td style="background:#f8fafc;font-weight:600">{esc(scene)}</td>
        <td class="cur">{esc(cur)}</td><td class="new">{esc(new)}</td></tr>'''
    targets_html = ''
    for item in p['targets']:
        t = item[0]
        ft = item[1] if len(item) > 1 else ''
        parts = re.split(r'[-→➜]+', ft)
        fr = parts[0].strip() if parts else ft
        to = parts[1].strip() if len(parts) > 1 else ''
        targets_html += f'<div class="target"><b>{esc(t)}</b><span class="from">{esc(fr)}</span><span class="arr">-&gt;</span><span class="to">{esc(to)}</span></div>'
    p4 = slide_open(f'''
  <div class="kicker" style="color:{color}">分 · {esc(short)} · 优化建议</div>
  <h2>📝 逐句改写与4周目标</h2>
  <div class="section-rule" style="background:linear-gradient(90deg,{color},#94a3b8)"></div>
  <div class="grid grid-2" style="flex:1">
    <div>
      <h3>逐句改写（可直接复用）</h3>
      <table class="rewrite-table">
        <thead><tr><th>场景</th><th style="background:#991b1b">当前 ❌</th><th style="background:#166534">改写 ✅</th></tr></thead>
        <tbody>{rw_rows}</tbody>
      </table>
    </div>
    <div>
      <h3>4周量化目标</h3>
      <div class="card">{targets_html}</div>
      <div class="note" style="border:0;margin-top:12px">目标按周复盘，未达标进入二轮培训。</div>
    </div>
  </div>
''', short, color, f'{10+num_base*4:02d}')

    return p1+p2+p3+p4

def closing_slides():
    s1 = slide_open(f'''
  <div class="kicker">总 · 标杆话术库</div>
  <h2>🏆 六条标杆话术（全队复用）</h2>
  <div class="section-rule"></div>
  <div class="grid grid-2">
    <div class="card" style="border-left:4px solid #2563eb"><h3 style="color:#2563eb">FAB标杆 · 麻小希</h3><div class="quote good">"S型黄麻是平铺黄麻的升级工艺，像弹簧一样有波浪弹性，分区承托，贴合脊椎曲线，躺下腰部不悬空，透气性比平铺黄麻提升50%，夏天不闷汗"</div></div>
    <div class="card" style="border-left:4px solid #2563eb"><h3 style="color:#2563eb">价格标杆 · 麻小宝</h3><div class="quote good">"所有优惠页面统一公示，价格透明无额外优惠，咱们支持 90天保价，买贵退差，您放心下单就好"</div></div>
    <div class="card" style="border-left:4px solid #2563eb"><h3 style="color:#2563eb">环保合规标杆 · 麻小星</h3><div class="quote good">"咱们黄麻芯采用高温热压成型工艺，垫层边缘使用少量环保热熔胶固定（合规用量，符合母婴级安全标准），出厂气味清淡，拆开无需长时间散味"</div></div>
    <div class="card" style="border-left:4px solid #2563eb"><h3 style="color:#2563eb">100天兜底标杆 · 麻小希</h3><div class="quote good">"现在我们家床垫有100天免费试睡服务 试睡期间不合适 不满意 退回运费我们承担，您可以先体验哈"</div></div>
    <div class="card" style="border-left:4px solid #2563eb"><h3 style="color:#2563eb">价格机制解释标杆 · 麻小星</h3><div class="quote good">"页面标注的优惠就是当前全部活动，能享受的系统下单会自动抵扣，没有私下额外优惠哦。支持保价3个月的呢"</div></div>
    <div class="card" style="border-left:4px solid #2563eb"><h3 style="color:#2563eb">保价兜底标杆 · 麻柚子</h3><div class="quote good">"亲亲，活动价已生效，当前下单价就是您的最终到手价，我们支持 3 个月保价，买贵可退差价，放心下单就好"</div></div>
  </div>
''', '总', '#16a34a', '39')

    s2 = slide_open(f'''
  <div class="kicker">总 · 团队级标准话术</div>
  <h2>📋 四类共性失败的团队级标准话术</h2>
  <div class="section-rule"></div>
  <div class="grid grid-2">
    <div class="card" style="border-left:4px solid #16a34a">
      <h3>禁用"引用"功能（100次/全队）</h3>
      <div class="quote good">规则：京东客服后台关闭"引用"功能键。客服收到顾客消息时直接回复，<strong>不要</strong>用"引用：xxx"复读顾客原话，那是给顾客看上下文的，不是给顾客听你复读的。</div>
    </div>
    <div class="card" style="border-left:4px solid #16a34a">
      <h3>催单话术分阶段（316次重复→分阶段）</h3>
      <div class="quote good">①首推："{{卖点}}+{{活动}}，今天划算，喜欢先拍下锁权益"<br/>②二次："{{库存}}还剩X个，我先帮您确认能不能锁"<br/>③三次："帮您加购物车了，付款后我立刻{{承诺}}"</div>
    </div>
    <div class="card" style="border-left:4px solid #16a34a">
      <h3>价格异议三段式</h3>
      <div class="quote good">"亲价格是活动底价啦，自产自销没中间商。我能帮您：①算到手价 ②申请赠品（相当于再省X元）③确认价保规则。您看中哪款？我算最划算的下单方式"</div>
    </div>
    <div class="card" style="border-left:4px solid #16a34a">
      <h3>短消息合并（平均40%→≤30%）</h3>
      <div class="quote good">❌ 拆3条：'在的亲亲' + '您好亲亲' + '宝喜欢就赶紧下单'<br/>✅ 1条："在的亲～这款您想自己睡还是给家人？活动最后1小时，喜欢就锁定"</div>
    </div>
  </div>
''', '总', '#16a34a', '40')

    s3 = slide_open(f'''
  <div class="kicker">总 · 培训落地</div>
  <h2>🎯 培训优先级矩阵与落地建议</h2>
  <div class="section-rule"></div>
  <table>
    <thead><tr><th>优先级</th><th>客服</th><th>核心动作</th><th>预期周期</th></tr></thead>
    <tbody>
      <tr><td><span class="tier-badge t3">🔴 P0系统级</span></td><td>全队8人</td><td style="text-align:left">禁用"引用"功能键(100次/全队)；"赶紧下单"24h限3次</td><td>立即</td></tr>
      <tr><td><span class="tier-badge t3">🔴 P0紧急</span></td><td>麻小宝</td><td style="text-align:left">35次引用→0；74次催单→分阶段；100天话术从1.2%提升到2.5%</td><td>1-2周</td></tr>
      <tr><td><span class="tier-badge t2">🟠 P1重点</span></td><td>麻柚子</td><td style="text-align:left">短消息率51%→≤35%；引用27次→0；100天1.1%→2.5%</td><td>2-3周</td></tr>
      <tr><td><span class="tier-badge t2">🟡 P2提升</span></td><td>麻小顺</td><td style="text-align:left">117次自动欢迎+探需；68次#E-b09表情去重；引用12次→0</td><td>3-4周</td></tr>
      <tr><td><span class="tier-badge t2">🟡 P2提升</span></td><td>麻小新·麻小晴</td><td style="text-align:left">麻小新：FAB 1.1%→2.5%；麻小晴：开放问0.1%→1%</td><td>3-4周</td></tr>
      <tr><td><span class="tier-badge t1">🟢 P3固化</span></td><td>麻小星·麻欢欢·麻小希</td><td style="text-align:left">录案例库；麻小星环保话术+价格机制做标杆；麻小希FAB做模板</td><td>4周+</td></tr>
    </tbody>
  </table>
  <div class="grid grid-3" style="margin-top:18px">
    <div class="card"><h3>系统级动作（立即）</h3><ul class="clean"><li class="b">禁用"引用"功能键</li><li class="b">"赶紧下单"24h限3次</li><li class="b">增加3条催单变体</li></ul></div>
    <div class="card"><h3>流程级动作（1-2周）</h3><ul class="clean"><li class="g">售前/售后分线</li><li class="g">流失会话30分钟召回</li><li class="g">参数话术卡标准化</li></ul></div>
    <div class="card"><h3>资产级动作（1-2月）</h3><ul class="clean"><li class="g">4大场景图卡（儿童/老人/孕妇/大体重）</li><li class="g">10秒拆洗演示短视频</li><li class="g">环保话术合规白名单</li></ul></div>
  </div>
''', '总', '#16a34a', '41')

    s4 = slide_open(f'''
  <div class="kicker">总 · 总结</div>
  <h2>核心结论与下一步建议</h2>
  <div class="section-rule"></div>
  <div class="grid grid-2">
    <div>
      <h3>核心结论</h3>
      <ul class="clean">
        <li class="g"><b>响应速度稳定</b>：中位10s，3位客服7-9s（队2领先）</li>
        <li class="g"><b>价格异议规范</b>：麻小宝"保价退差"模板成熟</li>
        <li class="g"><b>环保话术合规</b>：麻小星"极少量热熔胶"是合规标杆</li>
        <li class="b"><b>引用滥用严重</b>：100次/全队，麻小宝+麻柚子+麻小顺最严重</li>
        <li class="b"><b>催单调换</b>：316次"赶紧下单"几乎全员使用</li>
        <li class="b"><b>短消息碎</b>：平均40%，麻柚子51%最严重</li>
        <li class="b"><b>自动欢迎模板化</b>：370次"亲亲来啦"缺探需</li>
      </ul>
    </div>
    <div>
      <h3>下一步建议</h3>
      <ul class="clean">
        <li class="g"><b>立即(P0)</b>：禁用引用+催单调换+短消息合并</li>
        <li class="g"><b>1-2周(P1)</b>：自动欢迎加探需、FAB训练、100天兜底</li>
        <li class="g"><b>1-2月(P2)</b>：视频话术库、图卡资产、合规白名单</li>
      </ul>
    </div>
  </div>
''', '总', '#16a34a', '42')

    s5 = slide_open(f'''
  <div class="kicker">总 · 总结（续）</div>
  <h2>未验证项与跨数据集对比</h2>
  <div class="section-rule"></div>
  <div class="grid grid-2">
    <div>
      <div class="card" style="border-left:4px solid #f59e0b">
        <h3 style="color:#92400e">未验证项（需业务侧补数据）</h3>
        <ul class="clean" style="font-size:13px">
          <li class="b">每通会话是否最终下单（转化率分人）</li>
          <li class="b">自营vs旗舰店跨团队话术差异对比</li>
          <li class="b">客服排班/在线时段分布</li>
          <li class="b">顾客满意度/DSR评分关联</li>
        </ul>
      </div>
    </div>
    <div>
      <div class="card" style="border-left:4px solid #0891b2">
        <h3 style="color:#155e75">跨数据集对比</h3>
        <ul class="clean" style="font-size:13px">
          <li class="b">1天旗舰店11人 vs 7天自营店8人：<strong>团队不同</strong></li>
          <li class="b">旗舰店"小希"短消息44% → 自营店"小希"42%：<strong>表现近似</strong>，可能是同一人</li>
          <li class="b">旗舰店"小星"短消息22.7% → 自营店"小星"23%：<strong>高度一致</strong></li>
          <li class="b">建议业务侧核对：<strong>自营/旗舰是同一批人还是不同团队</strong></li>
        </ul>
      </div>
    </div>
  </div>
''', '总', '#16a34a', '43')

    return s1+s2+s3+s4+s5

def build():
    parts = ['<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">',
             '<meta name="viewport" content="width=device-width,initial-scale=1">',
             '<title>客服话术分析及优化汇报（7天版）</title>',
             f'<style>{CSS}</style></head><body><div class="deck">']
    parts.append(cover())
    parts.append(overview_slides())
    for n in NAMES_ORDER:
        parts.append(agent_slides(n))
    parts.append(closing_slides())
    parts.append('</div></body></html>')
    return '\n'.join(parts)

if __name__ == '__main__':
    html_out = build()
    out_path = '客服话术分析及优化汇报_7天.html'
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(html_out)
    print(f'Generated: {out_path}')
    print(f'Size: {len(html_out)} chars')
    print(f'Slides: {html_out.count(chr(60)+"section class=" + chr(34) + "slide")} + cover')
