# 运行与验证日志

本文件只记录可复核的运行事件、数据口径修复和验证结果；日期使用 YYYY-MM-DD。

## 2026-09-07

### 天猫明细支持全局筛选区间按需重算 + 数仓缺口标注（60 天快照窗口外不再静默钳制）

- 背景：天猫明细（PowerBI 复刻）快照固定 60 天滚动窗口（`POWERBI_PAGE_WINDOW_DAYS=60`，随最新数据日前移），全局筛选起点早于窗口起点时页面静默钳制到交集（例：筛选 2026-01-01 起，页面显示 2026-07-09 起）。排查确认标签与数据一致、非缺陷（数仓 04 表实际覆盖 2024-08-02 起 766 天无缺口、07 表 762 天、08 表 2025-01-02 起 613 天，快照裁剪只为控制 payload 体积：60 天 ~3MB vs 全量 ~20MB）。用户要求：版面数据跟全局筛选时间一致，数仓缺数需在标签说明。
- 改动：
  - `pipeline/ecom_pipeline/warehouse.py`：`_build_powerbi_pages` 新增 `period_start/period_end` 显式区间参数（不传保持 60 天滚动快照语义不变）与 `include_customer_service` 开关（按需路径跳过客服聚合，实测省 ~24s 固定开销）；新增 `_source_coverage()` 回报 04/07/08 表在所选区间的 min/max/有数据天数/缺失天数（coverage 字段，快照路径同样输出）。
  - `pipeline/ecom_pipeline/cli.py`：新增 `query-powerbi-pages --start --end` 子命令（read_only 连接，stdout 输出 `{"powerbiPages": ...}`，与 query-products 同款）。
  - `server/warehouse.mjs`：新增 `queryPowerbiPagesOnDemand`（spawn python + single-flight + 快照 mtime 失效缓存；timeout 300s、maxBuffer 256MB，248 天区间 JSON ~8.7MB）。
  - `server/index.mjs`：新增 `GET /api/analytics/powerbi-pages`（`analytics.view` 权限；参数校验 start/end；客服块从快照补齐保持响应结构与快照一致；同步锁库/失败时返回 status=stale）。
  - `src/components/PowerBiReplica.tsx`：GrowthDiagnosis 在全局筛选 ⊆ 快照窗口时照旧用快照（零等待）；超出时自动调按需接口，**渲染区间 = 全局筛选区间（不再钳制）**；标签三态：重算中（约 20-70 秒，暂显示快照窗口）/失败回退（注明原因与快照窗口）/成功（`跟随页面日期：X 至 Y · 数仓覆盖完整` 或 `数仓缺口：商品销售缺 1 天` 等，`coverageSummary` 只列有差异的来源表）。
- 性能实测（生产机）：30 天 ~18s、248 天 28s（温缓存）~74s（冷缓存）；server 缓存后同区间二次请求 68ms；同步后 mtime 变化自动失效。
- 验证：`python -m unittest discover -s pipeline/tests` 73 项全过（新增 3 项显式区间/coverage/反向区间单测）；`npm run build` 成功；5174 asset hash（index-DOuAoEP9.js）与 dist 一致；生产 API 实测 248 天区间 200/8.7MB/period=筛选区间/coverage.product 247 天缺 1 天/客服块补齐，二次请求 68ms；`git diff --check` 干净。
- 顺带修复契约测试既有漂移（HEAD 上即失败，与本次功能无关）：竞品明细表列名 `ROI(公式)/点击率(竞品)` → 线上实际 `ROI/点击率`、两表 4 列人群成本已合并为 hover 浮窗列、客服 KPI 占位断言改为现行 `value={current == null ? "—"`；另 `npm run test:smoke` 图片白名单断言只写死 alicdn，而 pipeline `_safe_product_image` 白名单已含 img.pddpic.com / h2.appsimg.com（productManagement.productNameOverview 有 103 条拼多多/唯品会目录图），smoke 断言对齐 pipeline 真值后 smoke 全过（warehouse rows 3,452,188）。
- 增量（同日 17:4x 用户确认后追加）：① 服务端预热——同步跑在独立进程、预热必须在 server 进程内做，新增 `prewarmPowerbiPagesOnDemand()`（warehouse.mjs）：启动 15s 后 + 每 5 分钟轮询快照 mtime，变化时后台预跑「当年 1 月 1 日 ~ 数据最新日」（起点可 `POWERBI_PREWARM_START` 覆盖；.env.example 已加说明），命中前提是把全局筛选终点选到数据最新日；② AGENTS.md 新增「契约/冒烟测试与实现漂移」小节（展示结构/白名单口径改动必须同步契约断言、测试失败先 stash 对照判定既有失败、白名单真值单点定义）。

### Coze API 每日连通性检查计划任务（失败才飞书告警）

- 背景：小红书舆情抓取依赖 Coze workflow（api.coze.cn）；新增每日连通性巡检，只有「不连通 / 鉴权失败 / 上游 5xx」才向飞书 webhook 告警，连通时静默只记日志。
- 改动：
  - `scripts/check-coze-api.mjs`（新）：探针 = **真实关键词搜索工作流**（`coze.genericWorkflowId`）+ 话题词输入，POST `/v1/workflow/stream_run`——不仅验端点可达 + token 有效，还能验工作流本体可运行、Coze 侧小红书 cookie 未失效；输入词 `COZE_HEALTH_PROBE_KEYWORD` 可覆盖（默认「麻大师」）。判定：401/403、5xx、无响应 = 不连通 → 发飞书；HTTP 200 但返回 `false`/`cookie_status=false`/结构异常 = 工作流异常 → 发飞书；正常返回 note.notes = 连通（静默）。飞书支持无签名（自定义关键词模式，只填 URL）与加签（填 SECRET 后 HMAC-SHA256）；`FEISHU_COZE_WEBHOOK_URL/SECRET` 优先、缺省回退 `FEISHU_JUSHUITAN_WEBHOOK_URL/SECRET`；`--test` 可发测试告警验证 webhook。日志 `logs/coze-api-health.log`。注意：本探针每日会真实运行一次关键词搜索（消耗配额 + 一次小红书搜索）。
  - `scripts/register-coze-health-check-schedule.ps1`（新）：注册任务 `EcomAIStudio-CozeHealthCheck`，每日 08:30，S4U + 网络可用 + 失败重启 3 次（与 DingTalk 口径一致）。
  - `package.json`：新增 `check:coze` / `schedule:coze`。
  - `.env` / `.env.example`：新增 `FEISHU_COZE_WEBHOOK_URL` / `FEISHU_COZE_WEBHOOK_SECRET`（用户已填 URL，无签名模式，SECRET 留空）。
- 验证：`node scripts/check-coze-api.mjs` 手动探测通过——话题「麻大师」搜索工作流 HTTP 200、返回 30 条笔记、exit 0、未误发飞书；`Start-ScheduledTask` 触发任务 LastTaskResult=0；`--test` 飞书测试告警发送成功（exit 0）；`git diff --check` 通过。NextRun 指向 2026-09-08 08:30。

## 2026-09-04

### 数据库去重手术：快照历史保留策略 + 存储瘦身（duckdb 2.2GB→59MB / sqlite 1.06GB→10MB）

- 背景：审查 5174 运营看板与商品管理模块的数据同步去重链路时发现——**数据口径层（视图/聚合）去重健全**，但**存储层无保留策略**：① duckdb `analytics_snapshots` 表每次同步追加一份 ~10MB 完整 JSON 快照（229 份，占 2.2GB 文件主体），服务端实际只读 `analytics-snapshot.json` 文件，该表纯审计留痕；② sqlite `sync_runs.snapshot_json` 累积 974MB 历史 blob（345 行），`latestSnapshot` 只读每 source 最新一份；③ `local-data/warehouse/` 下 3 份 2026-08-20 的 `analytics-snapshot.bak.*`（33MB，无代码引用）。
- 审计结论（无数据质量问题）：staging parquet 分区按源文件路径哈希内容寻址、覆盖写不累积；`model_*` 视图 `SELECT DISTINCT` 或 row_number 快照去重与 PBIX `Table.Distinct` 口径对齐（model>source 的行数差全部来自 composite union 合并，逐一对账吻合）；聚水潭订单行按真实键（内部订单号）仅 12 组重复（源 Excel 噪声，占 0.006%）；钉钉链路 Map 聚合天然去重。
- 改动（防再膨胀的保留策略）：
  - `pipeline/ecom_pipeline/warehouse.py`：新增 `ANALYTICS_SNAPSHOT_KEEP=7` 与 `_prune_analytics_snapshots()`，每次数仓同步后清理 `analytics_snapshots` 超出最近 7 份的旧行；
  - `server/storage.mjs`：`finishSync` 后调用新增 `pruneSyncRuns()`——非每 source 最新成功行的 `snapshot_json` 置空（保留元数据供 /api/history）、14 天前的旧行删除、僵尸 running 行（>1 天）清理；
  - `pipeline/tests/test_analytics_snapshot_retention.py`：新增 2 项保留策略单测。
- 手术（脚本 `local-data/tmp/dedup-live.py`，选在 11:04 数仓同步完成后执行）：duckdb 删旧快照 → `COPY FROM DATABASE` 重建紧凑库 → 对象数/关键视图行数前后校验一致 → 换文件（旧库移入 `local-data/tmp/dedup-quarantine/`）；sqlite 执行与 pruneSyncRuns 同口径清理 + VACUUM；3 份 .bak 移入隔离区。
- 结果：`ecom.duckdb` 2,325MB→59MB（后续同步后稳定 ~118MB，DuckDB 删除标记不回收属正常）；`ecom-ai-studio.sqlite` 1,065MB→10MB（1055MB 回收，72 行元数据 + 4 份最新成功快照保留）；备份与隔离文件在 `local-data/tmp/dedup-quarantine/`（含旧 duckdb 全量），确认无问题后可删。
- 验证：保留策略在 11:04/15:01 生产同步持续生效（analytics_snapshots 稳定 7 行）；`python -m unittest discover -s pipeline/tests` 68 项全过；按需查询 `python pipeline/sync.py query-products` 与术前一致（orderLines 192,866）；`npm run test:analytics-sync`、`npm run test:products`（起真实服务端到端）、`node scripts/test-global-search-api.mjs` 均通过；5174 `/api/health` 正常。当日钉钉 API 持续 503（11:00/13:00 两次同步失败），smoke 的 dingtalk connected 断言因 degraded 降级状态失败——与手术无关，17:30 钉钉 API 恢复后自愈；顺带修复 `scripts/test-global-search-api.mjs` 时效性缺陷（断言硬编码 2026-08-03，跨月必然失败），改为随快照 `completedThrough` 动态计算。

### 天猫明细（07-旗舰店商品销售数据）适配生意参谋 2026-09 新版导出结构

- 背景：生意参谋导出改版，`D:\麻大师\日更数据\天猫旗舰店\07-旗舰店商品销售数据` 新增两类新版文件——「【生意参谋平台】商品_全部_日期.xls」（38 列宽表）与「生意参谋_品类_商品排行_*.xlsx」（12 列瘦导出，仅支付口径，无访客/加购/退款列）。新版表头上方带 4 行空行/说明（旧版表头在第 0 行），且多列改名（统计日期←日期、商品加购人数←加购人数、成功退款金额←退款金额、访客平均价值←UV价值 等）。旧代码 `header=0` 固定首行，新版文件全部解析为 Column1..N 垃圾列（09-03 文件在当日 11:00 同步已成脏分区，115 行 × 39 列），天猫明细 08-30 起数据断裂。
- 改动：
  - `pipeline/ecom_pipeline/readers.py`：`HEADER_DETECT_QUERIES` 对 07 查询按「首个同时含日期列（日期/统计日期）与商品ID列的行」动态定位表头，新旧版式通吃；定位失败回退第 0 行（旧行为）；xlsx2csv 快速路径对该查询禁用。
  - `pipeline/ecom_pipeline/transforms.py`：新增 `SCHEMA_ALIASES`（07 查询 8 个改名列归一到 PBIX 既有口径，先于类型解析应用）；新增 `_normalize_tmall_product_metrics`，把非 schema 的指标文本列（含千分位/百分号）统一转 Float64，保证新旧分区 `union_by_name` 合并时列类型一致（身份/文本列白名单除外）。
  - `pipeline/ecom_pipeline/warehouse.py`：新增 `PARSE_VERSIONS={"07-旗舰店商品销售数据": 2}`，文件签名带解析版本，下次同步自动重建该查询全部历史分区（否则脏分区因签名不变被增量复用）；`_build_powerbi_pages` 三处商品快照去重（dailyCore/productDaily/去年同期）ORDER BY 增加 `(商品访客数 IS NOT NULL) DESC`，同日期同商品宽表快照优先于瘦导出。
- 验证（隔离检查，全程未触碰 local-data/warehouse 生产库，脚本 `local-data/tmp/verify_tmall_ingest_isolated.py`）：真实文件 8 个样例（旧版 3 + 瘦导出 2 + 宽表 3）走 read+transform → 临时 parquet → `read_parquet(union_by_name=true)` 复刻生产视图合并 → 生产同款去重 SQL 聚合；08-27~09-03 逐日支付金额与绕过 pipeline 的原始单元格聚合逐一相等（如 09-03：547,406.45；08-30：1,114,885.74）；每日快照数=1，去重正确。单测 `python -m unittest discover -s pipeline/tests -v` 68 项全绿（新增 `pipeline/tests/test_tmall_product_sales_ingest.py` 3 项 + `test_powerbi_daily_core.py` 宽表优先 1 项）；`git diff --check` 通过。`npm run test:powerbi-replica` 在竞品明细表 ROI 断言处失败，经 stash 对照确认为既有失败，与本次改动无关。
- 遗留（同日手动同步后复核更新）：当日已运行 `python pipeline/sync.py sync --query "07-旗舰店商品销售数据"` 完成重建（758 文件全量重处理、0 失败、0 复用，签名版本机制生效，166s），5174 `/api/analytics` 经 mtime/SWR 自动刷新，无需重启；宽表日（09-01、09-03）逐日支付金额与商品级数值（如 681141376007：访客 16,040 / 支付 87,965.07 / 退款 31,942.65）与原始文件真值逐一相等。数据侧两个缺口均为源文件问题，与代码无关：① **08-29 整日无源文件**，天猫明细该日为 0（推广侧仍有数据）；② **06-19~09-02 共 74 天（除 09-01）源文件实为 12 列瘦导出**（文件名为「商品_全部」但内容只有支付口径列），这些日期的访客/加购/退款为 0、支付金额/买家数/件数/客单价正常——需用 38 列完整模板重新下载对应日期后同步自动补齐。

### 天猫明细旧版数据恢复（快照重建 57 天 + 回收站找回 08-31）

- 方案：用户选定「快照恢复 + 重新下载覆盖」。对瘦导出覆盖的日期，用当日 11:04 旧 API 快照（`local-data/tmp/api-analytics.json`，去重手术前的完整 productDaily）+ duckdb `analytics_snapshots` 09-03 17:48 存档（补 07-05）重建商品级数据，生成 57 个 `【恢复快照】商品销售_YYYY-MM-DD.xlsx`（07-05~08-30）落回源目录（生成器 `local-data/tmp/build_recovery_files.py`），与瘦导出并存，靠 warehouse 去重的「宽表优先」规则赢。
- 恢复文件设计：商品级行来自旧快照 productDaily（窗口级 Top60/天口径）；每个文件末尾追加 `RESTORE-TAIL` 行（商品名「（恢复快照：60名外商品合计）」）补日级残差——**有瘦导出并存的日期尾包只带访客/加购/退款三项**（支付类由瘦导出长尾商品行兜底，避免重复计数）；**08-29（整日无文件）尾包带全部六项**。07-05 落在看板 60 天窗口外，已入库但页面不显示。
- 08-31 恢复：从回收站（`D:\$RECYCLE.BIN`）找回当日 38 列宽表原始文件（PowerShell COM 复制，115 行，支付合计 1,305,794.42 与瘦导出一致），命名 `【生意参谋平台】商品_全部_2026-08-31_2026-08-31-回收站恢复.xls` 落回源目录。
- 执行：`python pipeline/sync.py sync --query "07-旗舰店商品销售数据"`（日志 logs/manual-sync-07-restore.log），摄入 57 个恢复文件 + 回收站宽表（分区 758→815，processed=59，0 失败）；5174 `/api/analytics` 经 SWR 自动刷新（refreshedAt 16:19:08），无需重启。
- 验证（生产 API 最终态，对账脚本同上）：访客/退款与旧快照**逐日精确一致**；支付金额混合后**恰好等于当日瘦导出总额**（重合商品与旧文件分毫不差，长尾差异来自 Top60 口径覆盖范围：多数天 0 差，14 天 +1.1%~+5.7%，如 08-09 +5.74%）；08-31 完整（访客 80,655 / 退款 363,985.16）；08-29 完整（访客 71,978 / 退款 338,997.60 / 支付 1,023,756.85）；09-02 仍为瘦导出（访客 0 / 支付 603,234.08）。
- 余项与注意：① 商品明细表会出现「（恢复快照：60名外商品合计）」伪商品行，属正常设计；② **06-19~07-04 共 16 天本机无任何副本**，以及 08-29（无文件）、09-02（仍瘦导出）需用 38 列完整模板重新下载，落盘后下次同步自动覆盖恢复数据（宽表 mtime 更新会赢），确认后可删 57 个恢复文件；③ 恢复文件与瘦导出并存期间，若有人刷新 `麻大师店铺推广数据报表.pbix`（Folder.Files 无文件名过滤、按 日期+商品名称+商品ID+支付金额 去重），这些日期会重复计数，且 pbix 链路读不了新版 4 行前置表头——pbix 链路实质不可用，对账以看板为准。

### 天猫明细接入「一键导出」格式（补 06-19~07-04、09-02）+ 瘦导出被源侧删除的影响

- 背景：用户用生意参谋「一键导出」模板重新下载了 06-19~07-04（16 天）与 09-02 共 17 个文件落回源目录，并**同时删除了全部 72 个 12 列瘦导出文件**（含 09-02 的 商品_全部 瘦导出）。一键导出为第三种格式：表头在第 0 行、74 列、无日期列（日期在「日期范围」单元格内，形如 `2026-09-02|2026-09-02`）、商品ID 写作「商品 ID」（带空格）、每个指标带一个「（较上一周期）」环比百分比列。
- 改动：
  - `pipeline/ecom_pipeline/transforms.py`：`transform_source_file` 对 07 查询在 schema 对齐前从「日期范围」按 `|` 切分派生「日期」列（再走 `_date_expression` 正常解析）；`TMALL_PRODUCT_TEXT_COLUMNS` 白名单扩充一键导出的元数据/链接列（栏目/菜单/数据点/维度/类目/选择类型/搜索商品/商品链接/商品图片链接/商品编码/导出时间/日期范围），避免被数值归一清零。
  - `pipeline/ecom_pipeline/readers.py`：`_detect_header_row` 单元格去空格（含全角）后比对，日期 token 改为子串匹配——「商品 ID」「日期范围」也能命中表头行（对现有文件行为不变，防一键导出将来加前置说明行）。
  - 未 bump `PARSE_VERSIONS`：改动只影响新格式文件，旧分区解析结果不变，17 个新文件走增量即可。
- 验证：单测 70 项全绿（新增一键导出 2 项：日期派生/列归一/百分比环比列解析 + 与三种旧格式分区的 duckdb union_by_name 合并）；隔离验证（`local-data/tmp/verify_oneclick_ingest_isolated.py`，只读生产库）确认真实文件摄入行数/日期正确，09-02 一键导出支付合计 603,234.08 与瘦导出**分毫不差**，与生产现有瘦导出/恢复快照分区混合去重后类型兼容、一键导出（有访客数）赢瘦导出。
- 同步与结果：`python pipeline/sync.py sync --query "07-旗舰店商品销售数据"`（logs/manual-sync-07-oneclick.log，760 文件、processed=18、reused=742、0 失败，157s 含快照重建）；5174 SWR 刷新后（refreshedAt 16:56:54）核验——09-02 完整（访客 72,558 / 加购 3,009 / 退款 206,870.54 / 支付 603,234.08 不变），productDaily 09-02 商品级访客/退款均正常；60 天窗口（07-06~09-03）内无零支付、无零访客日期。
- 影响与余项：① **瘦导出被删导致 07-06~08-30（除 08-29）共 55 天支付金额回落 0.8%~7.2%（均值约 2.7%，如 08-14 -7.2%）**——这些天的长尾支付原来由瘦导出长尾商品行兜底，恢复快照尾包行按防重复设计不含支付类；访客/加购/退款不受影响仍精确。补齐方案：用一键导出模板重下 07-05~08-30（落盘后自动赢恢复快照），或从回收站还原瘦导出文件；② 06-19~07-04 已入库且在按需查询可达，但天猫明细快照固定 60 天窗口（POWERBI_PAGE_WINDOW_DAYS，窗口只随最新数据日前移），这 17 天页面不可见属既有设计而非缺失；③ 窗口内每天现在都有完整访客/退款口径。

### 天猫明细一键导出补数验收（07-06~08-30 全量真宽表落地，恢复快照退役）

- 验收：用户补传一键导出 07-06~08-30 共 56 个文件（07-05 未补，在 60 天窗口外）+ 重新下载 08-31 原版宽表。验收脚本 `local-data/tmp/accept_oneclick_backfill.py` 对全部 56 个文件走真实 read+transform 逐日合计，与 16:19 生产快照（瘦导出+恢复混合的精确口径）对比：**支付金额 56 天逐日分毫不差**；访客/退款 38 天精确一致、18 天一键导出更高（如 08-09 访客 66,329→80,880、退款 +37,776.86）。
- 差异定性：以 08-09 实证，恢复快照当日仅 29 行（旧快照记录的商品数），一键导出 113 行，独有的 85 个商品带访客 14,594/支付 106,318/退款 37,669——旧版导出只含部分商品，一键导出「全部商品」口径更全，看板访客/退款小幅上升属口径补全而非污染；支付（资金锚点）完全一致。
- 过渡防重复：恢复快照与一键导出并存会经 RESTORE-TAIL 尾包行重复计数，故先把 56 个有了一键导出的恢复快照移入 `local-data/tmp/recovery-quarantine-20260904/`（可回滚，确认无问题后可删），仅保留 07-05 恢复文件（无一键导出对应文件）。
- 同步与终验：`python pipeline/sync.py sync --query "07-旗舰店商品销售数据"`（logs/manual-sync-07-oneclick-full.log，761 文件、processed=57、0 失败）；5174 refreshedAt 19:33:09 后核验：60 天窗口（07-06~09-03）**支付金额逐日与精确参考值一致（0 天偏差）、无零支付/零访客日期、窗口内伪商品行 0 条**；08-29 真宽表数值与此前全量恢复重建值一致（重建口径准确）；08-31/09-02 不变。
- 至此天猫明细 60 天窗口全部为生意参谋真源文件（一键导出/宽表），快照恢复机制完成过渡使命。pbix 链路仍不可用，对账以看板为准。

## 2026-08-25

### 钉钉同步早间计划时间由 10:30 调整为 11:00

- 背景：运营要求看板早间更新从 10:30 推迟到 11:00（当日 10:30 已按旧计划正常执行一次，LastResult=0）。
- 改动（唯一口径来源为注册表 `HKCU:\Environment\DINGTALK_SYNC_TIMES`）：
  - 注册表值 `10:30,13:00,17:30` → `11:00,13:00,17:30`；
  - 重新运行 `scripts/register-dingtalk-schedule.ps1` 重建 `EcomAIStudio-DingTalk-Sync`（S4U/Limited/网络可用/失败重试属性保持不变），触发器验证为 11:00、13:00、17:30，State=Ready；
  - 代码回退默认值同步更新：`server/dingtalk-api.mjs`（scheduleTimes 默认串）、`scripts/register-dingtalk-schedule.ps1`（$Times 回退）、`src/pages/AnalyticsPage.tsx`（页头"每日同步计划"回退文案）；
  - `scripts/test-dingtalk-api.mjs` 两处断言改为 11:00；
  - 文档口径同步：AGENTS.md、docs/HANDOFF.md（§2 与 §8）、docs/OPERATIONS_DATA_INTEGRATION_PLAN.md、README.md（架构图与环境变量示例）。
- 验证：`npm run test:dingtalk-api`、`npm run test:dingtalk-unattended` 通过；计划任务 NextRun 指向当日 11:00（改动时点在 10:30 旧计划跑完之后、11:00 之前，新计划当日即生效）。
- 注意：`readLocalEnv` 优先读进程环境变量、其次注册表；改动前启动的旧 shell 会话与 dev server 进程会残留 10:30 展示值，新起进程一律从注册表读 11:00。改动时点 5180/5173 无运行中服务，下次启动自然生效，无需重启操作。

## 2026-08-07

### yudao 业务管理后台集成（方案 A：服务端只读代理）

- 背景：调研 yudao-boot-mini 后确定用它的人工录入后台承载看板缺失的档案类数据（商品档案、店铺渠道、竞品价格）；集成方式为方案 A——看板 Node 服务端以只读服务账号调 yudao REST API，前端不直连、不感知 yudao。不做 SSO/权限托管/Java 迁移，钉钉权威口径与数仓链路不动。
- 环境（全部绿色安装，未污染系统）：JDK17/Maven/MySQL 8.0.42（3306，root/123456，库 ruoyi-vue-pro）/Redis 5.0.14（6379）在 `E:/Github/yudao-env/`；后端仓库 `E:/Github/yudao-boot-mini`（48080）；管理 UI `E:/Github/yudao-ui-admin-vue3`（48081，pnpm dev）。yudao 与看板分属不同仓库，互不进对方 git。
- ecom 模块：新增 `yudao-module-ecom`，代码生成器产出 4 张表 CRUD——`ecom_channel`（7 渠道）、`ecom_store`（24 店铺）、`ecom_product`（335 商品，种子自 PowerBI 快照）、`ecom_competitor_price`（0 行，留待业务录入）；菜单挂在父菜单「电商数据」（id 6735）下；admin UI 生成页面经 vite transform 编译验证。
- 修复：`ecom_competitor_price.low_30d` 列被 MyBatis Plus 反推为 `low30d`，create 报 `Unknown column 'low30d' in 'field list'`；在 `CompetitorPriceDO.java` 加 `@TableField("low_30d")` 重建后修复。教训：列名含「下划线+数字」时代码生成器反推不可靠，需显式注解。
- 服务账号：`ecomdashboard`，角色 id 160 仅含 4 个 `ecom:*:query` 权限；越权写操作返回 403 已验证。看板 `.env` 增加 `YUDAO_BASE_URL/YUDAO_USERNAME/YUDAO_PASSWORD/YUDAO_TENANT_ID`；dotenv 会把未加引号值中的 `#` 当注释截断，密码必须写成 `YUDAO_PASSWORD="..."`（带引号），`.env.example` 已注明。
- 看板改动：`server/yudao-client.mjs`（新增，登录缓存+分页拉取）；`server/index.mjs` 新增 `GET /api/masterdata/competitor-prices`（intelligence.view）与 `GET /api/masterdata/products`（products.view），yudao 不可达/登录失败时 HTTP 200 返回 `{items:[],total:0,degraded:true,reason}` 不炸页面；前端 `IntelligencePage` 竞品价格页签脱离 mock 接 API（loading/降级/空态三态），mock.ts 对应段落已删；`SettingsPage` 增加到 48081 后台的外链卡片。
- 验证：端到端链路（admin 建测试行 → 看板 5199 测试实例读到 total=1 且 `low30d=1499` 字段映射正确 → 删除 → 回空态）通过；`npm run build`、`git diff --check` 通过。注意 Windows Git Bash 下 `curl -d` 带中文会发 GBK 字节导致 yudao 500，中文测试一律用 node fetch。
- 菜单修复（同日，管理 UI 登录后卡登录页/404 的根因）：① 父菜单「电商数据」（id 6735）的 `path` 原写为 `ecom`，vue-router 要求顶级路由以 `/` 开头，登录后动态注册路由直接抛 `Route paths should start with a "/"`，已改为 `/ecom`；② 渠道/商品菜单的 `component_name` 原为 `Channel`/`Product`，与 yudao 自带路由（如 `/im/channel` 名为 `Channel`）重名——vue-router 同名后注册者会顶掉先注册者，导致 `/ecom/channel`、`/ecom/product` 404，已改为 `EcomChannel`/`EcomProduct`。教训：代码生成器产出的菜单 SQL 落地后，须以真实浏览器登录 + 逐页打开验证，仅编译页面文件不够。5173 dev server 已于同日重启加载新后端代码，竞品价格页签在 5173 上确认为正常空态（非降级）。
- 看板入口菜单（同日新增）：「电商数据」下新增菜单 id 6760「运营看板入口」，`path=http://127.0.0.1:5173/`（外链菜单，前端 `meta.link` 机制 `window.open` 新标签页打开，非 iframe）；与看板「系统设置 → 业务管理后台」外链形成双向互通。真实浏览器验证：菜单出现、点击新标签页打开 5173 且完整加载、渠道/商品档案页回归正常。回滚：`DELETE FROM system_menu WHERE id=6760`。若看板入口改 5180：`UPDATE system_menu SET path='http://127.0.0.1:5180/' WHERE id=6760`。
- 遗留：4 个店铺（「神机榜」×2、兰知春序、崔氏家具）的渠道映射待业务方在后台补录；竞品价格表留空待业务录入；yudao 四件套（MySQL/Redis/server/UI）当前为手工启动的会话进程，未注册为 Windows 计划任务。

## 2026-08-05

### 顶部智能找数 v1.1：普通用户视角体验优化

- 背景：以普通用户口径实测 v1（直接驱动 `server/search-service.mjs` + 真实快照，钉钉 `completedThrough=2026-08-03`），发现三类问题：静默错答（"昨天/上个月/这个月"不识别时按全周期回答且无周期标识；"8月1日"单日被静默扩成整月；"退款率最高的渠道"被静默改答全渠道值）、实体死路（裸商品/裸渠道 unsupported）、浮层层叠 bug（见下）。
- 改动文件：
  - `server/search-service.mjs`：`parsePeriod` 新增昨天/前天/本周/上周/这个月/上个月/单日 `M月D日[号]`/中文完整日期/中文月份；含未识别时间词时落到最新完整数据日（不再静默全周期）；裸指标默认本月 MTD 并把实际周期回填答案卡；新增排名意图（渠道维度用快照平台行算 Top3 答案卡，店铺/商品维度降级为明示导航）；裸实体兜底（商品→销量/退货率/净销售额三卡，渠道→GMV/净回款/退款率三卡，店铺→明示导航）；无实体时带 kpi 聚合的商品指标（待发货件数/定制率）可直接回答；`OTHER_PAGES` 权限过滤修为 `${page}.view` 映射（权限管理页 admin.users）；实体索引指纹加入权限 salt，修复无商品权限调用复用含商品实体缓存索引的越权泄漏。
  - `server/search-catalog.mjs`：`normalizeTerm` 增加中文数字↔阿拉伯数字、o↔0 变体归一（豆七↔豆7、M52O9↔M5209），查询与索引两侧同规则。
  - `src/components/GlobalSearch.tsx`：答案卡数值提升为右侧大字号主视觉；定义卡去重并中文化（显示"站内推广费 ÷ 净回款"而非 spend/netRevenue）；unsupported 显示"没看懂这个问题，换个说法试试"，示例副标题改"试试这个问法"；kbd 按平台显示（Windows→Ctrl K）；面板底部加键盘提示；**浮层改 `createPortal` 挂到 document.body**。
  - `src/styles.css`：新增 `.global-search-item-value` / `.global-search-unsupported` / `.global-search-footer`。
  - `scripts/test-global-search-api.mjs`：新增 9/10/11 三节断言（口语时间词与默认周期、排名意图对账、裸实体/变体/KPI/页面导航权限）。
- 关键 bug（v1 预存）：搜索浮层渲染在带 `backdrop-blur` 的 `.topbar` 内，fixed 被困进 topbar 层叠上下文，主内容区压在浮层之上——鼠标点击结果被页头拦截、视觉上页面内容透进浮层。portal 到 body 后两者均消失（该问题在 v1 验收截图 02-search-modal-open.png 中已可见，当时未发现）。
- dev server（5173）已按 §11.6 重启为新后端；交接 §11.7 待复验项通过。
- 验证：`npm run test:global-search`（contract+api 新增 8 条用户口径查询断言）、`npm run typecheck`、`npm run build`、`npm run test:ux-polish`、`npm run test:select-theme`、`npm run test:products`、`npm run test:auth`、`npm run test:public-surface`、`npm run test:dingtalk-api`、`npm run test:analytics-sync`、`git diff --check` 均通过。浏览器实测（Playwright + 系统 Chrome）：六个固定验收查询 + 10 条新查询行为符合预期；答案卡大数值/周期 chip/页脚提示/unsupported 文案渲染正常；点击答案卡可导航并高亮目标区域；移动端 390×844 全屏浮层无横向溢出；控制台零错误（截图在 output/playwright/）。
- 预存在失败（与本次无关，保持记录）：`test:smoke` 因钉钉 2026-08-04 09:30 计划同步失败、健康状态 degraded 而断言失败（数据面沿用 08-04 05:03 成功快照）；`test:analytics-dashboard` 仍为 §11.8 记录的 sharedMax 预存在失败。
- 未做（沿用边界）：不接 LLM/向量库、不生成经营数字、不记录查询历史；排名仅用快照已有数据纯函数计算。

## 2026-07-25

### 商品经营明细字段补齐（对齐 .pbix）

- 背景：网站「天猫明细 -> 旗舰店整体 -> 商品经营明细」表对比 `D:\麻大师\BI文件\麻大师店铺推广数据报表.pbix`「07-旗舰店商品销售数据」商品粒度 measure，缺少「国补后金额(万)」「国补后金额同比」「销额占比」；原「商品费比」分母为支付金额，与 .pbix 减退金额口径不一致，无法对账。
- 决策：用「国补后费比」（`花费 / ((支付−退款)×0.85)`）直接替换原「商品费比」列，不保留旧口径；两层全做（纯派生字段 + 国补后金额同比数据层扩展）；数仓去年同期数据已确认可用。
- 字段真值来源：[migration/powerbi-tmdl/tables/07-旗舰店商品销售数据.tmdl](../migration/powerbi-tmdl/tables/07-旗舰店商品销售数据.tmdl)；完整方案与对账数据：[docs/POWERBI-PRODUCT-TABLE-FIELD-GAP-PLAN.md](POWERBI-PRODUCT-TABLE-FIELD-GAP-PLAN.md)。
- 改动文件：
  - `pipeline/ecom_pipeline/warehouse.py`：`_build_powerbi_pages` 增加 `product_daily_prior_year` 查询，窗口 `period_start−365 ~ period_end−365`（对齐 .pbix `DATEADD(-365, DAY)`），按 productId 聚合 payAmount/refund；空返回兜底 `[]`。
  - `src/types/integration.ts`：`PowerBiPages` 增加 `productDailyPriorYear: Array<{productId, payAmount, refund}>`。
  - `src/components/PowerBiReplica.tsx`：`OverallPage` 增加 `priorYearMap` + `totalSubsidized`；表头 13->16 列；行内派生国补后金额/销额占比/同比/国补后费比；「商品费比」由「国补后费比」替换；同比复用 `Delta` 组件（红绿箭头），去年同期数据缺失时渲染 `.pb-na`「数据不足」。
  - `src/styles.css`：`.pb-business-product-table` min-width 1120->1440；新增 `.pb-na`（muted 兜底样式）。
  - `scripts/test-powerbi-replica-contract.mjs`：新增 5 条断言（国补后金额/销额占比/同比/国补后费比列、priorYear 接入、pb-na、类型、数仓）。
  - 新增 `scripts/audit-product-subsidized-yoy.py`：数仓对账脚本，同步后随时可跑。
- 数据约束：`POWERBI_PAGE_WINDOW_DAYS = 60`，productDaily 只查最近 60 天；同比需去年同期数据，由新增 `product_daily_prior_year` 提供；缺失时前端降级「数据不足」，不显示错误的 0%。
- 口径对照：网站原「商品费比」= 花费/支付金额；.pbix「商品费比」= 花费/(支付−退款)；.pbix「国补后费比」= 花费/((支付−退款)×0.85)。本次采用国补后费比替换。
- 验证：
  - `node scripts/test-powerbi-replica-contract.mjs` -> `powerbi replica contract ok`。
  - `npx tsc --noEmit` 通过。
  - 数仓同步 `node scripts/sync-warehouse.mjs` 成功，period 2026-05-26 ~ 2026-07-24，2,716,580 记录。
  - 对账 `python scripts/audit-product-subsidized-yoy.py`：07 表覆盖 2024-08-17 ~ 2026-07-24；去年同期窗口 138 商品 = 快照 productDailyPriorYear 138 商品（完全一致）；公式自洽抽查（豆芽）`(13462424−4792175)×0.85/10000 = 736.9712万`，偏差 0.000000；Top60 中 49 个有去年同期数据，11 个去年未上架降级「数据不足」。
- 待人工核对：在 PowerBI Desktop 打开 `麻大师店铺推广数据报表.pbix`「07-旗舰店商品销售数据」页，对照方案文档 §6.1 Top10 表的「本期国补后(万)」「去年国补后(万)」「同比」三列数值。
- 注意事项：catalog 内部 `07-旗舰店商品销售数据` 映射到 `model_q08_*` 视图（query 清单编号与文件名编号不一致，属正常）；warehouse.py 用 query_name 查 `warehouse_query_catalog` 取视图，对账脚本同样用 catalog 查询，不要按 `model_q07_*` 表名硬查。Windows cp936 locale 下 python 源码中文字面量传给 duckdb 时 stderr 报错信息会乱码，但实际查询不受影响。

## 2026-07-16

### 账号登录与权限管理

- 按本地开发与 Agent 验收需要增加 `AUTH_ENFORCEMENT_ENABLED` 开关：默认 `0` 时以本地免登录管理员身份放行业务页面、API 和竞品图片；设置为 `1` 后恢复登录页、401/403 和逐用户权限校验。
- 登录页、账号库、密码哈希、会话、登录限流和“用户与权限”页面均保留；`npm run test:auth` 在强制模式下继续覆盖完整安全链路。
- 新增首次管理员初始化；后续登录同时校验邮箱、手机号和密码，不设置源码默认账号或密码。
- 密码采用 `scrypt` 加盐哈希；会话 Cookie 使用 HttpOnly、SameSite=Strict，服务端账号库仅保存令牌摘要并放在 `local-data/auth/`。
- 业务 API、同步、上传、任务和竞品图片均增加服务端权限校验；未登录返回 401、权限不足返回 403。
- 新增“用户与权限”页面：管理员可创建、停用用户，设置角色及页面查看/操作权限；最后一名启用管理员受到保护。
- 登录失败使用 15 分钟窗口限流；认证单元、接口契约和真实 HTTP E2E 均由 `npm run test:auth` 覆盖。
- 浏览器隔离验收完成：首次管理员创建成功；错误手机号无法登录；受限分析员仅显示工作台和运营看板；未授权卡片跳转被拦截；新建批次与同步数据按钮按操作权限禁用。
- 5180 生产预览当前以免登录模式运行；`/api/auth/status` 返回 `enforcementEnabled=false` 和本地免登录管理员，未带 Cookie 访问 `/api/data-sources`、`/api/analytics` 均返回 200。强制模式的未登录 401 行为由隔离 HTTP E2E 覆盖。
- 隔离账号全量 smoke 通过：本地数仓 2616350 行、钉钉 7719 行、飞书 7590 行、工作流 12/12；测试账号库和临时日志已清理。

### 全页面文案与互动优化

- 逐页复核 9 个用户页面，删除或改写 `mock`、MVP、原型、API/本机路径、复刻比例和“对齐参考看板”等开发过程文案。
- 工作台数据源说明改为数据量和可用状态；运营看板移除重复的数据管线说明；商品页修正“净销售额”和“件单价”命名并精简毛利率说明。
- PowerBI 复刻页移除 `LAYOUT REPLICA`、原始尺寸和运行管线标记，保留日期与业务口径。
- 系统设置隐藏本机环境与接口占位组，不再展示接口路径、数据库路径和内部状态英文；保留同步状态、数据量、安全策略和工作流阶段。
- 卡片增加边缘光带、指标/可点击卡片悬停反馈；筛选按钮、日期弹层、渠道筛选、标签页和视图切换增加统一动画，并支持 reduced-motion。

### 销售目标年份与漏斗视觉修复

- 复核钉钉 `销售目标!A2:O12`：1 月至 12 月目标日期行属于 2026 年；旧快照只保存 `01` 至 `12`，导致 2026 年 8 月至 12 月目标错误套用到图中的 2025 年同月。
- 目标模型改为 `YYYY-MM` 键；旧快照的两位月份键仅映射到快照完成日期所在年份。缺少目标的月份只绘制净销售额，不再绘制目标柱或达成率。
- 近 12 月图返工：双柱使用固定 6px 间距和实色区分，2026-01 至 2026-07 的 7 个有效达成率点恢复为 1 条连续折线；2025-08 至 2025-12 保持无目标。1920px 桌面验收确认 7 个目标柱、7 个折线节点、无重叠、页面无横向溢出，控制台无错误。
- 转化漏斗改为复用全局 `metric-card card-glow` 视觉，使用统一青色填充、末级荧光绿转化率、逐层悬停和入场动画；reduced-motion 下停用动画。

### 钉钉计划任务排查与重试修复

- `EcomAIStudio-DingTalk-Sync` 在 2026-07-15 10:00:01、12:30:01、17:30:01 均正常启动并成功，分别写入 7683、7683、7719 条聚合记录；10:00 快照的完整数据日为 2026-07-14，页面显示 07-14 符合 T-1 口径，不是计划任务漏跑。
- 2026-07-16 10:00:01 任务因钉钉 HTTP 500 失败；发现请求层和脚本层均未把 500 纳入瞬时故障重试范围，且失败健康文件错误写入最大尝试次数而非实际尝试次数。
- 请求层与脚本层已覆盖 HTTP 500；失败健康状态改为记录实际尝试次数。11:27 手动补跑已验证 3 次退避重试生效，但三次均收到钉钉 HTTP 503；12:30 恢复前系统继续沿用 2026-07-15 17:34 的最后成功快照，未用失败响应覆盖本地数据。
- 12:30:01 计划任务按时再次启动并于 12:34:24 同步成功；健康状态恢复为 healthy，钉钉快照记录数更新为 7739，说明故障来自钉钉短时 500/503，而不是 Windows 计划任务未执行。
- 本轮 `npm run build`、`npm run test:analytics-dashboard`、`npm run test:dingtalk-unattended` 与 `git diff --check` 通过；隔离浏览器验收确认 2025 年无目标柱、漏斗卡片视觉统一、控制台无错误、页面级横向溢出为 0。
- `npm run test:ux-polish` 当前仍有一个既存文案断言：测试要求商品管理页包含“商品销售、履约、退货与渠道分布”，当前页面已移除该句；该失败与本轮目标、漏斗和同步修改无关，未为迎合旧断言恢复冗余文案。

### 浏览器与回归

- 桌面端逐页检查：9 个页面均未发现用户可见的开发标记；日期筛选展开动画为 0.24 秒，近 7 日预设正确更新日期草稿，商品标签切换状态正确。
- 移动端 390 × 844 逐页检查：9 个页面 body 均无横向溢出。
- npm run build、npm run test:ux-polish、npm run test:analytics-dashboard、npm run test:smoke、PowerBI/钉钉/同步/主题/公域契约及 pipeline 9 项测试均通过。
- git diff --check：通过；仅有工作区既存的 LF/CRLF 提示，无空白错误。

## 2026-07-15

### 分层运营看板与本地数仓

- 各渠道 GMV 占比改为使用 GMV 总额作分母并按占比降序，不再使用回款额份额冒充 GMV 份额。
- 近 12 月销售达成改为连续 12 个月的净销售额、钉钉月目标和达成率双轴图；当前月使用筛选结束日的 MTD。
- L6 下方渠道经营汇总表替换为渠道规模、渠道效率与风险两张横向条形图；店铺明细表保留。
- `/api/analytics` 增加 `warehouse.dashboard`，从 PowerBI 本地快照聚合访客、成交客户、支付转化、加购、客单价、件单价和推广 ROI。
- 前端 `Math.random()` 趋势和 MOCK 指标已移除；同比/环比由服务端计算，无对比期覆盖时返回 null。

### UI 与接口复核

- API 复核：PowerBI 看板区间为 2026-07-01 至 2026-07-14，返回访客 718755、成交客户 4543、推广 ROI 5.181；月度达成返回 12 个连续月份。
- 浏览器桌面端复核：GMV 占比、12 月达成、渠道规模、渠道效率与风险图正常展示。
- 浏览器移动端 390 × 844 复核：document 无横向溢出，图表卡片宽度为 350px；12 月图仅在卡片内部横向滚动。
- 5180 生产预览已重启加载本轮服务端改动；健康检查为 true，正式 `/api/analytics` 返回 `warehouse.dashboard.available=true`、12 个月度达成点和渠道 GMV 占比合计 1。

### 验证命令

- npm run build：通过。
- npm run test:analytics-dashboard：通过。
- npm run test:smoke：通过；warehouse 2616350 行、dingtalk 7719 行、feishu 7590 行、workflow agents 12/12。
- npm run test:dingtalk-unattended、test:powerbi-images、test:powerbi-replica、test:select-theme、test:analytics-sync、test:public-surface：通过。
- python -m unittest discover -s pipeline/tests -v：9/9 通过。
- git diff --check：通过；仅有工作区既存的 LF/CRLF 提示，无空白错误。

## 2026-07-14

### 无人值守同步

- 06:03:50：Windows 任务 EcomAIStudio-DingTalk-Sync 启动。
- 06:09:32：同步成功，19 张表、7669 条记录；健康状态为 success。
- 06:10 至 06:15：dry-run 成功，未写入外部数据。
- 任务配置验证：S4U、StartWhenAvailable、网络可用、IgnoreNew、失败重试 3 次；计划时间 10:00、12:30、17:30。

### MTD 口径修复

- 发现：钉钉汇总行完成日期为 2026-07-12，日明细完成日期为 2026-07-13。
- 原因：旧逻辑只按 completedThrough 选汇总行，筛选结束日为 2026-07-13 时错误覆盖了更晚的日明细。
- 修复：server/dingtalk-api.mjs 仅在 summary.end 等于筛选结束日时使用汇总行，否则按日明细重算。
- 回归：2026-07-01 至 2026-07-13 的 MTD 为 9844916.615（展示 ¥984.5 万），与日明细合计一致；最新日回款为 63.7 万；目标为 2430 万。

### PowerBI 数据

- 迁移矩阵复核：25 个查询中 23 个进入本地 PowerBI 独有数仓，00-月表汇总和 03-1-各渠道目标金额由钉钉权威口径覆盖并排除。
- 快照复核：3854 个源文件、3854 个 Parquet 分区、2433553 条事实行。
- 图片复核：商品图片使用已验证的 img.alicdn.com 白名单地址，快照中 68 个链接符合白名单。

### UI 与浏览器复核

- 页面区间显示 2026-07-01 至 2026-07-13。
- MTD 卡片显示 ¥984.5 万，目标进度使用 ¥984.5 万 / ¥2430 万。
- 日回款折线包含 07-13；PowerBI 三个复刻页面保留商品图片、表格行高和可读性调整。

### 过程文件清理

- 已删除项目根目录旧 Vite、开发服务和预览服务日志、PowerBI 过程截图、Playwright 快照目录，以及 pipeline 测试缓存目录。
- 已删除 local-data/runtime 下旧的 server-5180 启动日志；保留 local-data/logs/server-5180.stdout.log、local-data/logs/server-5180.stderr.log，因为它们对应 5180 生产服务。
- 保留 local-data/logs/dingtalk-sync.log、local-data/runtime/dingtalk-sync-health.json、local-data/warehouse、dist、node_modules、.env 和 .git_disabled。
- 15:26:37：为加载服务端文案修正，按预期进程命令重启 5180 生产服务；15:27:11 健康检查恢复正常。

### 验证命令

- npm run build：通过。
- npm run test:smoke：通过；warehouse 2433553 行、dingtalk 7669 行、feishu 7590 行、workflow agents 12/12。
- npm run test:dingtalk-api：通过。
- npm run test:dingtalk-unattended：通过。
- npm run test:powerbi-images：通过。
- npm run test:powerbi-replica：通过。
- npm run test:dashboard-ui：通过。
- npm run test:select-theme：通过。
- npm run test:analytics-sync：通过。
- npm run test:public-surface：通过。
- python -m unittest discover -s pipeline/tests -v：9/9 通过。
- git diff --check：通过。

## 历史问题记录

### 2026-07-11：DuckDB 文件监听 EBUSY

- Vite 监听 local-data/warehouse/ecom.duckdb 时出现 EBUSY。
- 影响：旧开发进程启动失败或热更新中断。
- 处理：保留数据库文件，使用生产服务和单独日志路径；不再把数据库文件加入前端监听范围。

### 2026-07-13：WebSocket 端口占用

- 开发服务报告 24678 端口已被占用。
- 影响：旧开发服务无法建立 WebSocket。
- 处理：以实际监听端口为准，生产服务固定使用 5180；过程日志已记录后清理。

### 2026-07-14：生产 PORT 继承

- 发现父进程环境变量 PORT 可能导致服务尝试使用非预期端口。
- 处理：启动生产服务时显式设置 PORT=5180，并以 /api/health 和监听端口复核。

## 日志保留策略

- 保留 local-data/logs/dingtalk-sync.log 和 local-data/runtime/dingtalk-sync-health.json，它们是无人值守同步的审计与健康证据。
- 清理根目录旧 Vite、预览服务日志以及浏览器快照；这些文件不承载业务数据。
- 不读取、不记录 .env 中的凭证值；公域部署只使用环境变量和服务端受保护接口。
