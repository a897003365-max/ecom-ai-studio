# ecom AI Studio — Demo 功能补全方案

> 日期：2026-08-25
> 范围：盘点各页面中"看起来能用、实际无数据源"的 demo 功能，给出补全优先级与实施方案。

## 现状盘点

| 页面 | Demo 功能 | 数据源现状 | 补全路径 |
|------|-----------|-----------|---------|
| 竞品情报 · 价格监控 | 商品价格列表 | ✅ 已补全：tmall-sku-price 实时抓取（本方案附带） | 已完成 |
| 竞品情报 · 价格监控 | 竞品店铺列表 | ✅ 已补全：按榜内商品聚合真实店铺 | 已完成 |
| 竞品情报 · 价格监控 | 价格变化/30日最低/预警 | ❌ 单次抓取无历史 | 需积累：每次抓取存快照，N 期后计算 |
| 竞品情报 · TOP100 | 主图 CP 评分/营销手法 | ⚠️ 需 vision pipeline + 原始 xlsx | 已有 pipeline，缺 source_raw.xlsx |
| 竞品情报 · TOP100 | 网页实时抓取按钮 | ❌ disabled，"需单独立项" | tmall-sku-price 的 safe_scrape.py 可作为实现基础 |
| 工作台 Dashboard | KPI/业务线/模块概览 | ❌ mock.ts 静态 | 接 /api/analytics + warehouse |
| 内容生产 | contentPipeline/contentProducts | ❌ mock.ts 静态 | 接任务队列真实状态 |
| 图片处理 | imageKpis/imageTasks | ❌ mock.ts 静态 | 接图片生成 worker |
| 数据分析 | analyticsKpis/materialTop10 | ⚠️ 部分有 API | 对齐 /api/analytics 实际字段 |
| 任务队列 | queueTasks | ⚠️ 有 /api/tasks，mock 混合 | 全量切真实 API |

## 已落地（本次提交）

### 竞品价格监控 ← tmall-sku-price 真实数据

- 新增 `src/data/tmallCompetitorData.ts`（自动生成，100KB）：
  - `tmallCompetitorPrices`：32 个商品的 1800mm*2000mm 入门 SKU 价格（原价/券后价/在售 SKU 数）
  - `tmallCompetitorStores`：26 家真实天猫店铺（按榜内商品数排序）
  - `tmallTop100Fallback`：60 个商品的行业排名 + 价格带兜底数据
- `localApi.ts#getCompetitorPrices`：yudao 不可用时自动回退到 tmall 数据（degraded=false，不再显示红色警告条）
- `IntelligencePage.tsx`：
  - TOP100 加载失败时用兜底榜单（CP 评分显示 "—"，诚实标记数据缺口）
  - 店铺列表优先用真实店铺数据

### 数据更新流程

```bash
# 1. 抓取（在 tmall-sku-price 项目）
python safe_scrape.py --excel <新排行.xlsx> --force --output-excel <新排行.xlsx> --sheet SKU价格

# 2. 生成 TS 数据模块
python scripts_tmall/gen_tmall_competitor_data.py

# 3. 通过 WebDAV 上传 src/data/tmallCompetitorData.ts，watcher 自动 rebuild
```

## 待补全（按优先级）

### P0 — 价格历史与预警（让"价格变化/30日最低/预警"有真实值）

现状：每次抓取只留最新快照，`previousPrice`/`priceChange`/`low30d` 全是 "-"。

方案：tmall-sku-price 侧加快照积累。
- 每次 `safe_scrape.py` 跑完，把当次结果追加到 `price_history.csv`（itemId, skuId, coupon, ts）
- `gen_tmall_competitor_data.py` 读历史，计算：priceChange（vs 上一期）、low30d（30 天最低）
- 预警规则：券后价降幅 > 5% → "降价预警"；> 10% → "重点预警"

工作量：~80 行 Python，无前端改动。

### P1 — TOP100 主图分析接真实 pipeline

现状：榜单兜底数据没有 CP 评分（需 vision 分析主图）。

方案：
- 把排行 Excel 里的商品图片链接列（col[7] 商品图片链接）作为 source_raw.xlsx 的图片源
- 或 tmall-sku-price 抓取时顺手存主图 URL，build-intelligence-dataset 直接拉取
- 需要 vision API key（.env 的 ARK_API_KEY）

工作量：pipeline 已有，主要是喂数据。

### P2 — Dashboard / 内容生产 / 图片处理去 mock

这三个页面整体依赖 mock.ts。建议逐页做，每页一个 PR：
1. 列该页用到的 mock export
2. 确认对应 /api/* 是否已实现（tasks/analytics/uploads 已通）
3. 页面改 fetch，mock 保留为 loading skeleton 的占位

### P3 — 网页实时抓取按钮启用

现状：disabled + "需单独立项"。

方案：tmall-sku-price 的 safe_scrape.py 已是可用的天猫抓取器。把它包装成 server 的一个 endpoint：
- POST /api/intelligence/scrape-tmall { itemIds[] }
- server 调 safe_scrape.py（子进程），完成后自动重新生成 tmallCompetitorData.ts
- 前端按钮改为可用，点击后跑抓取 + 刷新

注意：需遵守 robots 与频控；当前 60-120s 间隔是安全值。

## 安全边界提醒

本方案所有改动只涉及 `src/data/`、`src/services/`、`src/pages/`，不触碰 local-data/、.env、watcher 脚本。
