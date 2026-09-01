# -*- coding: utf-8 -*-
import sys
sys.stdout.reconfigure(encoding='utf-8')
with open('generate_ppt_7d.py','r',encoding='utf-8') as f:
    src = f.read()

patches = []

# 1a. 统一引用次数 89→100，并修正第5页小字为完整8人
old1a = '<h3 style="color:#dc2626">引用功能误用（89次）</h3>'
new1a = '<h3 style="color:#dc2626">引用功能误用（100次）</h3>'
if old1a in src:
    src = src.replace(old1a, new1a); patches.append('1a. 89->100')
else:
    print('WARN 1a not found')

# 找含 35次 + 麻柚子27次 + 麻小顺12次 + 麻小晴12次 = 全队89次 的small标签
old1a2 = '麻小宝35次 + 麻柚子27次 + 麻小顺12次 + 麻小晴12次 = 全队89次噪声'
new1a2 = '麻小宝35 + 麻柚子27 + 麻小顺12 + 麻小晴12 + 麻欢欢8 + 麻小星4 + 麻小希2 = 全队100次噪声'
if old1a2 in src:
    src = src.replace(old1a2, new1a2); patches.append('1a2. cite 8人完整拆分')
else:
    print('WARN 1a2 not found')

# 1b. P0 系统级 89→100
old1b = '禁用"引用"功能键(89次/全队)'
new1b = '禁用"引用"功能键(100次/全队)'
if old1b in src:
    src = src.replace(old1b, new1b); patches.append('1b. P0 89->100')
else:
    print('WARN 1b not found')

# 1c. 总结 89→100
old1c = '<b>引用滥用严重</b>：89次/全队'
new1c = '<b>引用滥用严重</b>：100次/全队'
if old1c in src:
    src = src.replace(old1c, new1c); patches.append('1c. summary 89->100')
else:
    print('WARN 1c not found')

# 2. 禁用词替换
old2 = '"咱们黄麻芯本身是0胶水热压成型的。垫层边缘只用了极少量的环保热熔胶做固定，用量非常少，而且热熔胶本身无甲醛、无异味"'
new2 = '"咱们黄麻芯采用高温热压成型工艺，垫层边缘使用少量环保热熔胶固定（合规用量，符合母婴级安全标准），出厂气味清淡，拆开无需长时间散味"'
if old2 in src:
    src = src.replace(old2, new2); patches.append('2. 环保去禁用词')
else:
    print('WARN 2 not found')

# 3. 页码补零
for old_s, new_s in [
    ("f'{7+num_base*4}'", "f'{7+num_base*4:02d}'"),
    ("f'{8+num_base*4}'", "f'{8+num_base*4:02d}'"),
    ("f'{9+num_base*4}'", "f'{9+num_base*4:02d}'"),
    ("f'{10+num_base*4}'", "f'{10+num_base*4:02d}'"),
]:
    if old_s in src:
        src = src.replace(old_s, new_s)
patches.append('3. agent页码补零')

# 3b. closing 页号 40,41,42,43 → 39,40,41,42
old_close_nums = ["', '总', '#16a34a', '40')",
                  "', '总', '#16a34a', '41')",
                  "', '总', '#16a34a', '42')",
                  "', '总', '#16a34a', '43')"]
new_close_nums = ["', '总', '#16a34a', '39')",
                  "', '总', '#16a34a', '40')",
                  "', '总', '#16a34a', '41')",
                  "', '总', '#16a34a', '42')"]
for o, n in zip(old_close_nums, new_close_nums):
    if o in src:
        src = src.replace(o, n)
patches.append('3b. closing 39-42')

# 4. 第14页（麻小希）目标残缺
old4_alt = '(\'开场探需\',\'补"想了解啥"\')'
new4_alt = '(\'开场探需\',\'补"想了解啥" → 每会话至少问1次\')'
if old4_alt in src:
    src = src.replace(old4_alt, new4_alt); patches.append('4. 目标补全')
else:
    print('WARN 4 not found, trying re')
    import re
    m = re.search(r"\('开场探需','补[^']+'\)", src)
    if m:
        old_real = m.group(0)
        new_real = '''('开场探需','补"想了解啥" → 每会话至少问1次')'''
        src = src.replace(old_real, new_real)
        patches.append('4. 目标补全(re)')
    else:
        print('WARN 4 re failed')

# 5. 第7页（麻小宝）催单标注
old5 = '<div class="metric"><b>{m["pushy"]:.1f}%</b><span>催单话术</span></div>'
new5 = '<div class="metric"><b>{m["pushy"]:.1f}%</b><span>催单话术</span>{"<div style=\"font-size:10px;color:#dc2626;font-weight:700;margin-top:4px\">⚠ 74次全队最高</div>" if m["name"].endswith("麻小宝") else ""}</div>'
if old5 in src:
    src = src.replace(old5, new5); patches.append('5. 催单标注(麻小宝)')
else:
    print('WARN 5 not found')

# 6. 橙色柱状图对比度
old6 = 'svg.append(f\'<text x="{w*0.30+max(bw,3)+6}" y="{y+bar_h/2+4}" class="bar-val" font-size="11" fill="#1e293b" font-weight="600">{val:.1f}{unit}</text>\')'
new6 = 'svg.append(f\'<text x="{w*0.30+max(bw,3)+6}" y="{y+bar_h/2+4}" class="bar-val" font-size="11" fill="#1e293b" font-weight="700" stroke="#fff" stroke-width="3" paint-order="stroke">{val:.1f}{unit}</text>\')'
if old6 in src:
    src = src.replace(old6, new6); patches.append('6. 柱状图加白边描边')
else:
    print('WARN 6 not found')

with open('generate_ppt_7d.py','w',encoding='utf-8') as f:
    f.write(src)
print('Applied patches:', patches)
