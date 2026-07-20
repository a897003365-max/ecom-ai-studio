# 商品管理模块交接（给 Codex 接手）

**日期**: 2026-07-16
**交接方**: Claude Code (Sonnet + Opus)
**接手方**: Codex
**项目**: ecom-ai-studio · 数据与监控 · 商品管理

---

## 一句话现状

商品管理模块（聚水潭 15-商品数据 + 5 表 union 产品主表）+ 4 Tab 看板 + 日期切片器 + 订单状态明细切片器 + 15 表 sortable + 7 交叉矩阵均已上线；5180 生产服务在线（`curl http://127.0.0.1:5180/api/health` -> ok）；auth-store 已回原状（用户 admin 1 session）；未做 git 提交，等你指示。

---

## 关键文件与改动

### 1. 数据管线（Python）

| 文件 | 改动 |
|---|---|
| `migration/power-query-m/manifest.json` | 27 条查询（原 25 + `15-聚水潭商品数据` + `product-master`）。`15-聚水潭商品数据` schema 34 列含新增 `发货仓`+`订单状态明细`；`product-master` 5 文件 union |
| `pipeline/ecom_pipeline/transforms.py` | `_transform_jushuitan`（保留 34 列+解析斜杠日期+`订单状态明细`派生）；`_transform_product_master`（5 表 union，coalesce 商品编码/床垫类别/成本/尺寸，去重） |
| `pipeline/ecom_pipeline/warehouse.py` | `_build_product_management_pages(connection, start, end, statuses)` 支持日期+状态切片；产出 KPI（含毛利率）、单品明细（简称/SKU）、渠道/店铺/达人/床垫类别 breakdown、月度/每日趋势、月环比、7 个 PIVOT 矩阵、availableStatuses。用 `source_qNN` 视图（订单行粒度，不用 DISTINCT model 视图） |
| `pipeline/ecom_pipeline/cli.py` | `sync` + `query-products --start --end --status`（可重复，UTF-8 stdout） |

### 2. 服务端（Node）

| 文件 | 改动 |
|---|---|
| `server/warehouse.mjs` | `queryProductsOnDemand({start,end,statuses})` spawn CLI |
| `server/index.mjs` | `/api/products` 有任一 filter 走按需查询，无则返回 snapshot；permission=`products.view`；admin 角色 bypass |

### 3. 前端（React）

| 文件 | 改动 |
|---|---|
| `src/types/integration.ts` | `ProductManagementPages` 全类型（含 productChannelMatrix/productStatusMatrix/dailyStatusMatrix/availableStatuses/monthlyComparison） |
| `src/services/localApi.ts` | `getProductData({start,end,statuses})` |
| `src/components/SortableTable.tsx` | 通用可排序表；`sortValue`+`render` 列定义；箭头 ArrowUpDown/Up/Down；未提供 sortValue 的列不排序 |
| `src/components/AnalyticsDateFilter.tsx` | 复用（近7/30/本月至今预设） |
| `src/pages/ProductManagementPage.tsx` | 4 Tab；顶栏 3 切片器（日期/订单状态/清除）+ 同步按钮；`StatusSlicer`（多选草稿+应用）；`MatrixTable`（行/列/总计均可排序） |
| `src/App.tsx` + `data/mock.ts` + `types/index.ts` + `components/NavIcon.tsx` | 商品管理页路由/nav item/PageId |

### 4. 参考素材

`E:\Github\ecom-ai-studio\参考文件\商品仪表盘（ERP数据）.xlsm` 是受保护的本地参考文件。解密凭据必须通过批准的本地密钥管理渠道取得，**不得**写入仓库、交接文档或日志。解密后 10 sheet，主参考：
- **商品数据源**（38 列，122073 行）— pbi M 处理后的清洗表结构。R 列=订单状态明细（6 值），S 列=床垫类别，Z 列=成本，AI 列=毛利额
- **月底商品分析报表** — KPI + 整体经营总览(月环比) + 月度趋势 + 人群画像 + 渠道明细 + 床垫类别 + 单品明细
- **每日订单数据表** — 7 个透视矩阵（是否定制矩阵因聚水潭无该字段跳过）

---

## 数据流

```
D:\麻大师\日更数据\天猫旗舰店\
├── 15-聚水潭商品数据\销售主题分析_明细订单商品.xlsx  (~16万行，34字段保留)
└── 商品信息文件\{产品明细,拼多多店铺...,家纺商品表,自营商品表,pop商品表}.xlsx

  ↓ pipeline sync (pandas → Polars → Parquet)

local-data/warehouse/staging/
├── q26_9a71536c9f/  (聚水潭订单行)
└── q27_c2e7b6093e/  (product-master, 16478 编码去重, 商家规编（后台）为 join key)

  ↓ DuckDB source_qNN 视图 + LEFT JOIN

analytics-snapshot.json.productManagement
  + /api/products (start/end/statuses 时走 CLI 按需重聚合)
  ↓
ProductManagementPage 渲染
```

---

## 已知边界与未做项

| 项 | 现状 | 补法 |
|---|---|---|
| 订单状态明细的 M 派生逻辑 | 「全量处理」是 pbix 连接-only 查询，pbixray 取不到卖家备注/小旗细分。当前按 raw 订单状态主映射派生 4 个值（缺 交易关闭退货退款/指定日 两个子类型） | 拿到 M 代码或接入退款类型字段后细化 |
| 毛利率覆盖率 57.8% | product-master 商家规编（后台）与聚水潭商品编码 join，2550/4604 匹配。未匹配商品 grossMargin=null | 补 `床类编码.xlsx` join 辅4 派生的行 |
| 人群画像（年龄/性别） | 参考看板有，本 pbix 无数据源 | 需另接天猫人群画像导出 |
| 是否定制矩阵 | 参考看板有，聚水潭无该字段 | 从产品主表接入是否定制列 |
| Git 提交 | 未提交（按项目规则等用户指示） | 26 个改动文件 + 20 个新增文件，包括参考文件目录（含 172MB xlsm，注意 .gitignore） |

---

## 快速验证 3 条命令

```bash
# 1. Python + Node 测试
cd E:/Github/ecom-ai-studio
python -m unittest discover -s pipeline/tests  # 9 tests OK
npm run test:smoke   # smoke auth gate ok
npm run test:public-surface  # 3 files scanned

# 2. 按需查询（无需登录）
python pipeline/sync.py query-products --start 2026-06-01 --end 2026-06-30 --status "已发货" > /tmp/pm.json
python -c "import json; d=json.load(open('/tmp/pm.json',encoding='utf-8'))['productManagement']; print('period:',d['period'],'orderLines:',d['kpis']['orderLines'])"

# 3. 浏览器（登录后）
# 打开 http://127.0.0.1:5180/ → 商品管理
# 顶栏日期选择器/订单状态切片器/清除筛选/同步数仓；4 Tab 均含可排序表
```

---

## 5180 服务

- 端口 5180 已在跑 production 模式，`/api/health` ok
- 需要重启：`taskkill //F //PID $(netstat -ano | grep ":5180.*LISTENING" | awk '{print $5}' | head -1); cd E:/Github/ecom-ai-studio && PORT=5180 node server/index.mjs --production &`
- 管理员账号与会话凭据不写入交接文档；需要验证时使用正常登录流程和单独的测试账号。

---

## 认知留档（重要坑）

1. **聚水潭源文件已刷新**：raw 订单状态从旧版（已付款待接单/待收取）改为新版（已付款待审核/已取消），映射键要按新值
2. **fastexcel/calamine 读不出**这个聚水潭 xlsx 的文本列（共享字符串兼容性），必须用 pandas+openpyxl，慢但正确
3. **聚水潭订单行粒度**：必须用 `source_qNN` 视图，不能用 `model_qNN`（DISTINCT 会错误折叠订单行）
4. **销售数量**含 0.01链接促销单（max 80000）致件单件失真，单位指标改用**实发数量**
5. **参考看板凭据**：受保护文件的解密凭据不进入代码库、文档或日志；如需处理，使用批准的本地密钥管理流程。
6. **CLI stdout GBK 编码**：Windows 控制台，必须 `sys.stdout.buffer.write(json.dumps(..., ensure_ascii=False).encode('utf-8'))`，否则 emoji/中文报 UnicodeEncodeError
7. **Playwright MCP 未接**：这个 session 只有 firebase/context7/pencil MCP。浏览器验证需装 Python playwright + 指向缓存 chromium 可执行 `~/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe`
8. **文件末尾 exit 127**：`node server/index.mjs &` 在 background shell 包装层报 exit 127 是误报，node 进程实际 detach 运行，用 `netstat -ano | grep :5180` 确认

---

## 记忆索引

- 完整会话日志：`E:/Github/.learnings/SESSION-LOG.md`
- 项目 CLAUDE.md：`E:/Github/CLAUDE.md`
- 项目规则：`E:/Github/ecom-ai-studio/AGENTS.md`
