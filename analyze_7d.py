# -*- coding: utf-8 -*-
# WARNING: PII - 原始聊天数据含真实顾客 PII（姓名/电话/地址）。
# 中间产物（chat_sessions_7d.json / agent_data_7d.json）含完整 PII，
# 已通过 .gitignore 防止入仓。HTML 输出已校验为 PII-safe。
# === 严禁把这些中间文件提交到任何代码仓库 ===
import sys, json, re
from collections import Counter, defaultdict
from datetime import datetime
import statistics
sys.stdout.reconfigure(encoding='utf-8')

with open('chat_sessions_7d.json','r',encoding='utf-8') as f:
    sessions = json.load(f)

def parse_time(t):
    return datetime.strptime(t, '%Y-%m-%d %H:%M:%S')

OPEN_Q = re.compile(r'(什么|哪[个些款]|怎么|如何|给谁|谁睡|什么场景|考虑|喜欢|倾向|预算|多大体重|多高|几岁)')
CLOSED_Q = re.compile(r'(是不是|有没有|可以吗|行吗|对吗|好吗|需要吗|要吗|可以不|行不行|是吗)$|吗[？?]')
EMOJI_PAT = re.compile(r'[\U0001F600-\U0001F64F\U0001F300-\U0001F5FF\U0001F680-\U0001F6FF☀-⛿✀-➿]')
FEATURE_KW = ['黄麻','弹簧','线径','圈数','S型','独立袋','针织','3D','乳胶','厚度','口径','酷布','热压','脱糖','棕']
BENEFIT_KW = ['支撑','护脊','不塌陷','不干扰','睡得香','适合','不用担心','放心','省心','耐用','贴合','均匀','承托','分散','静音','抗打扰']
EMPATHY_KW = ['理解','担心','放心','别担心','不好意思','抱歉','给您添','麻烦您','体谅','辛苦','感谢您','感谢亲']
REASSURE_KW = ['放心','安心','不用担心','别担心','保障','兜底','零风险','免费']
APOLOGY_KW = ['抱歉','不好意思','对不起','添麻烦','给您添']
PUSHY_KW = ['下单','拍下','付款','赶紧','福利','半价','秒杀','划算','省']
HUNDRED_KW = ['100天','100 天','百天','试睡']
WARRANTY_KW = ['10年','十年','质保']
FREIGHT_KW = ['运费险','运费']
HUANGMA_KW = ['黄麻']
SPRING_KW = ['独立弹簧','独立袋','酷布']
SCENE_KW = ['老人','孩子','宝宝','宠物','养宠','孕','腰']
LOGISTICS_KW = ['发货','快递','物流','到货','3-5天','5-7天','7-10天','加急','顺丰']
RECO_KW = ['豆7','豆芽','护脊','经典款','麻小绒','金豆','黑豆','芸豆','豆苗']
ACTIVITY_KW = ['半价','7.8折','78折','政府补贴','国补','宝藏品牌','抢第一']
CUSTOM_KW = ['定制','10-12天','15天','流水线']

QUOTE_PREFIXES = ('引用',)  # 引用：/引用:

agent_sessions = defaultdict(list)
for sess in sessions:
    if not sess: continue
    ac = Counter()
    for m in sess:
        if m['role']=='service': ac[m['user']]+=1
    if ac:
        agent_sessions[ac.most_common(1)[0][0]].append(sess)

def pct(texts, kws):
    if not texts: return 0.0
    return 100.0 * sum(1 for t in texts if any(k in t for k in kws)) / len(texts)

agent_data = {}
for name, sess_list in agent_sessions.items():
    ad = {
        'sessions': len(sess_list),
        'service_msgs': [],
        'customer_msgs': [],
        'response_times': [],
        'session_lengths': [len(s) for s in sess_list],
        'closing_msgs': [],
        'opening_msgs': [],
        'used_pics': 0, 'used_links': 0, 'quote_noise': 0, 'emoji_count': 0,
        'short_msgs': 0, 'long_msgs': 0,
    }
    for sess in sess_list:
        for i, m in enumerate(sess):
            if m['role']=='service':
                ad['service_msgs'].append(m)
                t = m['text']
                if EMOJI_PAT.search(t): ad['emoji_count'] += 1
                if 'dd-static.jd.com' in t: ad['used_pics'] += 1
                if 'jd.com' in t and 'dd-static' not in t: ad['used_links'] += 1
                if t.startswith(QUOTE_PREFIXES): ad['quote_noise'] += 1
                if len(t) < 10: ad['short_msgs'] += 1
                if len(t) >= 80: ad['long_msgs'] += 1
            else:
                ad['customer_msgs'].append(m)
        for i in range(1, len(sess)):
            if sess[i-1]['role']=='customer' and sess[i]['role']=='service' and sess[i]['user']==name:
                delta = (parse_time(sess[i]['time']) - parse_time(sess[i-1]['time'])).total_seconds()
                if 0 <= delta < 3600*4:
                    ad['response_times'].append(delta)
        for m in sess:
            if m['role']=='service' and m['user']==name:
                ad['opening_msgs'].append(m['text']); break
        for m in reversed(sess):
            if m['role']=='service' and m['user']==name:
                ad['closing_msgs'].append(m['text']); break

    msgs = [m['text'] for m in ad['service_msgs']]
    n = len(msgs) or 1
    ad['metrics'] = {
        'svc': len(ad['service_msgs']),
        'cust': len(ad['customer_msgs']),
        'rt_med': statistics.median(ad['response_times']) if ad['response_times'] else 0,
        'rt_p90': sorted(ad['response_times'])[int(len(ad['response_times'])*0.9)] if len(ad['response_times'])>5 else 0,
        'avg_sl': sum(ad['session_lengths'])/len(ad['session_lengths']) if ad['session_lengths'] else 0,
        'short_pct': 100.0*ad['short_msgs']/n,
        'long_pct': 100.0*ad['long_msgs']/n,
        'links': ad['used_links'], 'pics': ad['used_pics'],
        'emoji': ad['emoji_count'], 'quote': ad['quote_noise'],
        'open_q': 100.0*sum(1 for m in msgs if OPEN_Q.search(m) and ('？' in m or '?' in m))/n,
        'closed_q': 100.0*sum(1 for m in msgs if CLOSED_Q.search(m))/n,
        'any_q': 100.0*sum(1 for m in msgs if '？' in m or '?' in m)/n,
        'feature': pct(msgs, FEATURE_KW), 'benefit': pct(msgs, BENEFIT_KW),
        'fab_both': 100.0*sum(1 for m in msgs if any(k in m for k in FEATURE_KW) and any(k in m for k in BENEFIT_KW))/n,
        'empathy': pct(msgs, EMPATHY_KW), 'reassure': pct(msgs, REASSURE_KW), 'apology': pct(msgs, APOLOGY_KW),
        'pushy': pct(msgs, PUSHY_KW), 'hundred': pct(msgs, HUNDRED_KW),
        'warranty': pct(msgs, WARRANTY_KW), 'freight': pct(msgs, FREIGHT_KW),
        'huangma': pct(msgs, HUANGMA_KW), 'spring': pct(msgs, SPRING_KW),
        'scene': pct(msgs, SCENE_KW), 'logistics': pct(msgs, LOGISTICS_KW),
        'reco': pct(msgs, RECO_KW), 'activity': pct(msgs, ACTIVITY_KW),
        'custom': pct(msgs, CUSTOM_KW),
    }
    ad['top_openings'] = Counter(ad['opening_msgs']).most_common(5)
    ad['top_closings'] = Counter(ad['closing_msgs']).most_common(5)
    agent_data[name] = ad

def to_plain(o):
    if isinstance(o, dict): return {k: to_plain(v) for k,v in o.items()}
    if isinstance(o, list): return [to_plain(x) for x in o]
    if isinstance(o, tuple): return [to_plain(x) for x in o]
    return o
with open('agent_data_7d.json','w',encoding='utf-8') as f:
    json.dump(to_plain(agent_data), f, ensure_ascii=False, indent=1)

print('%-24s %4s %5s %6s %5s %5s %6s %5s %5s %5s %5s %4s' % (
    '客服','会话','消息','中位','短%','长%','开放问','FAB','共情','催单','100天','引用'))
print('-'*100)
NAMES_ORDER = sorted(agent_data.keys(), key=lambda x: -agent_data[x]['metrics']['svc'])
for n in NAMES_ORDER:
    m = agent_data[n]['metrics']
    print('%-24s %4d %5d %4.0fs %4.0f%% %4.0f%% %5.1f%% %4.1f%% %4.1f%% %4.1f%% %4.1f%% %4d' % (
        n, agent_data[n]['sessions'], m['svc'], m['rt_med'], m['short_pct'], m['long_pct'],
        m['open_q'], m['fab_both'], m['empathy']+m['reassure'], m['pushy'], m['hundred'],
        agent_data[n]['quote_noise']))
print('\nSaved agent_data_7d.json with %d agents' % len(agent_data))
