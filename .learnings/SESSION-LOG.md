# Session Log

## 2026-07-14

- 交接：补充项目约束、运行入口、数据口径、无人值守状态和残余风险。
- 清理：登记并清理浏览器快照、旧开发/预览进程日志与测试缓存；保留业务快照、同步健康状态和当前服务日志。
- 验证：复跑构建、钉钉、PowerBI、本地数仓和 Python 测试，并核对文档日期与路径。
- 运行：15:26:37 重启 5180 生产服务加载服务端修正，15:27:11 健康检查恢复正常。

## 2026-07-23

- 诊断：钉钉 10:00 同步失败根因 = 钉钉 Sheet API 早高峰 503，脚本 3 次重试（5s/10s 退避）窗口太短全败；本地数仓无定时任务、与钉钉无联动，设计上只能 HTTP 手动触发。
- 修复 A：sync-dingtalk.mjs 退避改为 30s/60s/120s 封顶 120s；环境变量 DINGTALK_SYNC_ATTEMPTS=5。验证：手动同步第 3 次重试成功（此前 3 次全败），recordCount 7879。
- 修复 B：DINGTALK_SYNC_TIMES 改为 10:30,13:00,17:30 错峰；register-dingtalk-schedule.ps1 改为从注册表读该变量作默认时间，避免计划任务与环境变量脱节；重跑 ps1 重新注册。
- 修复 D：新建 server/warehouse-lock.mjs + scripts/sync-warehouse.mjs + scripts/register-warehouse-schedule.ps1；注册数仓计划任务 EcomAIStudio-Warehouse-Sync（11:00,18:00，S4U）。验证：真实同步 29s 成功，recordCount 2687759。
- 环境：setx PYTHON=E:\anaconda\python.exe，sync-warehouse.mjs 启动时从注册表补设 process.env.PYTHON，确保 S4U 计划任务下 executeSync 用绝对路径调 python。
- 陷阱：PowerShell 5.1 按 GBK 读取无 BOM 的 UTF-8 .ps1，中文注释会破坏语法；.ps1 注释保持英文。

## 2026-08-17

- 新增：15-聚水潭商品数据每日 9:45 同步+导出 Excel。新增 pipeline/ecom_pipeline/export.py（DuckDB→Polars→xlsxwriter 原子写）+ cli.py export-jushuitan 子命令 + scripts/sync-jushuitan-export.mjs（Node 包装：锁+重试+health）+ scripts/register-jushuitan-export-schedule.ps1。
- 验证：计划任务 EcomAIStudio-Jushuitan-Export（S4U，09:45，重试2次/5min）端到端 LastTaskResult=0；输出 D:\麻大师\日更数据\商品管理\15-聚水潭商品数据.xlsx（170,187行×48列，28.4MB）；原子覆盖三层保护（锁跳过/sync失败不写/os.replace保旧文件）全测过。
- 陷阱：.ps1 必须纯 ASCII（本次沿用 07-23 教训，GBK 误读 UTF-8 中文破坏续行 token，-StartWhenAvailable 解析失败）。
- 备注：S4U 会话下 python 冷页缓存全量 sync 约 4 分钟（热缓存 ~56s），仍在 15 分钟执行上限内。

## 2026-08-18

- 故障：9:45 任务触发但卡在 os.replace —— 目标文件被 WPS 打开（PermissionError WinError 5），且目标文件被用户换成 WPS 文档加密版（打开密码 1 / 编辑密码 mds321，OLE 容器非 zip）。
- 决策（用户）：① 输出保持文档加密（打开1/编辑mds321）；② 占用冲突每 10 分钟重试到 10:30。
- 实现：export.py 新增 _encrypt_xlsx_with_com（Excel COM 优先，WPS KET 备用；明文临时→COM 加密另存→os.replace 原子替换）；cli.py export-jushuitan 加 --open-password/--write-password + 异常写 failed health；sync-jushuitan-export.mjs 重写 busy 重试（WinError 5/32 正则，waiting_file_unlock，截止 10:30）。
- 验证：S4U session0 下 Excel/WPS COM 均可用（临时任务探测）；加密输出 is_encrypted=True、错密码拒绝、密码 1 可读（171,176 行×48 列）；busy 锁定→failed health→临时清理→解锁→成功全链路通过。
- 安全：密码存用户级环境变量 JUSHUITAN_OPEN_PASSWORD / JUSHUITAN_WRITE_PASSWORD，不写代码/日志。
- 陷阱：bash 后台 python 的 PID ≠ 持锁 python（kill 包装进程无效，按 StartTime 找真实 python）；git bash kill 只杀 wrapper。
- 已知：生成加密 xlsx 无法纯 Python 实现（msoffcrypto 只解密、openpyxl 只支持防改哈希），COM 是唯一无人值守路径。

## 2026-08-18（下午）

- 需求变更（用户）：39 列版本，取数逻辑以 PBIX `麻大师商品数据报表.pbix`-15-聚水潭商品数据 的 M 代码为准。
- 提取：ADOMD 连 PBIDesktop 子进程 msmdsrv（localhost:49611）查 TMSCHEMA_EXPRESSIONS，导出 112 个表达式到 migration/powerbi-tmdl/jushuitan-expressions/（含 hidden 聚水潭商品数据_全量处理 13948 chars、24 步）；pbixray 无法拿 hidden 查询 M（partition 表只有短引用），需 ADOMD。
- 实现：新增 pipeline/ecom_pipeline/jushuitan39.py（24 步 Polars 复现，含 5 张辅助表）；export.py 改为 39 列数据源（替代 DuckDB model_q26 48 列）。
- 对拍：抽样 2026 订单 35/39 列 100% 一致（日期列差异=精度 微秒vs纳秒，值正确）；行数 203,694（源文件 214,520 过滤后，PBIX 缓存 171,174 是历史累积旧数据）。
- 陷阱修复：① polars join 不保留纯 join 键列 → 加匹配标记列（否则新零售恒 false）；② 日期辅助表日期列是 Excel 序列号（45292）需转换；③ polars str.split pattern 是字面量非正则（",|，"失效）→ 先 replace 中文逗号；④ xlsx2csv 快路径 93s（pandas 230s）。
- 验证：加密导出 203,694 行×39 列 63.3MB，is_encrypted True，密码 1 可读，190s。
- 已派 glm-5.3 subagent（effort max）独立验收 24 步 M 覆盖。
- 验收发现（subagent 独立复验）：C1 缺最终销售数量≠0 过滤（多 30,204 行）；H1 xlsx2csv 空串→''非null（达人空→抖音达人应抖1、小旗空→''应灰色旗帜）；H2 辅10 组件 rename 缺失（辅5床类/家纺/京东自营/POP/拼多多）；M3 成本 null→0（应保持 null）。
- 修复：C1 去重后加销售数量≠0（203,694→173,490）；H1 快路径空串→null（抖音达人 3,160→114、灰色旗帜 7,632）；H2 重写 _load_辅10（床垫类别 null 1,194→477、成本 null 2,151→1,373）；M3 成本/毛利额 null 传播对齐（毛利额 null=成本 null）；L2 已取消改子串替换。
- 复审（subagent 第二次）：有条件通过，残留 R1 家纺成本列名（M 的 #(lf)=换行，pandas 读为"成本\n（不含运费）"，startswith 匹配修复）+ R2 毛利额 fill_null(0)（去掉，毛利额 null=1,373 对齐）。已修并派最终验收。
- 用户手动导出 0818 文件（173,490 行×39 列）与我们的输出行数完全一致，构成同天真值对照。
- 付款日期格式：M 第 4 步 type date（只日期），jushuitan39.py 付款日期 cast Date；发货/确认收货日期保持 datetime。验证输出无时分秒。
- v/w/x 列（付款/发货/确认收货日期）全部短日期格式导出：jushuitan39.py 三个日期列都 cast Date。验证输出无时分秒。
- 数据新鲜度检查 + 飞书通知：export.py ExportResult 加 max_payment_date/data_fresh（max 付款日期≥昨天）；缺昨天数据时 Node 发飞书 webhook（FEISHU_JUSHUITAN_WEBHOOK_URL/SECRET 环境变量）。陷阱：飞书签名 HMAC 的 key=timestamp\nsecret、消息为空（不是 key=secret），修后才通。
- 交付小红书负面舆情分析 demo（关键词「麻大师床垫避雷」20 条笔记）+ 方舟 LLM 网关修复，详见 docs/HANDOFF.md 第 14 节。
- 舆情链路：参考文件 txt 元数据 → Coze workflow（7631819451410907182，stream_run，input=笔记url）抓正文（并发 2/间隔 60s/重试 1）= 20/20 成功；正文缓存 local-data/sentiment/notes-cache.json，LLM 失败后可秒级续跑；JSON 落盘 local-data/sentiment/result.json。
- 页面 src/pages/SentimentPage.tsx 接入侧边栏「数据与监控」；前端轮询 /api/sentiment/status；视觉验收 frontend-kimi 全 PASS。
- 方舟踩坑（勿回退）：deepseek-v4-flash-ga-260731 只能走 coding 端点 api/coding/v3/chat/completions + Bearer（标准端点 ModelNotOpen / messages 端点 401）；system 并入 messages 首条；响应取 choices[0].message.content。
- arkProxy 死代码 bug：upstream 无 .ok 字段、if(!upstream.ok) 恒真→/api/ark/call 从未真正成功；修为 status!==200 后实测连通。
- 生产地址：http://100.113.194.123:5174/（tailscale 看门狗托管，只绑 tailscale IP，127.0.0.1 不通正常；端口只认 PORT 环境变量不认 --port）。
