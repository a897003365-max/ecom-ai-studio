# HANDOFF — ecom AI Studio 看板加载提速

> 2026-08-01 19:00 · 交接人：Claude Code

## 本次改动

### 目标
优化运营数据看板（AnalyticsPage）和商品管理（ProductManagementPage）打开速度。

### 改动文件（4 个）

| 文件 | 改动 | 说明 |
|------|------|------|
| `server/warehouse.mjs` | 快照内存缓存 + queryProductsOnDemand 缓存 | 快照按 mtime 复用解析结果；按需查询按筛选+mtime 缓存 + single-flight |
| `server/index.mjs` | ETag/304 + brotli 质量 6 | `sendJsonCached` 内容哈希 ETag；brotli q11→6（4MB 响应 5s→50ms）；`/api/analytics`、`/api/products` 两端支持 304 |
| `src/pages/ProductManagementPage.tsx` | 双查改非阻塞 | 首包即渲染，画册字段后台补查，token 防覆盖 |
| 一次性操作 | 重跑 warehouse sync | 快照补全 gallery 字段（`imageUrl` + SKU 级 4 字段），`hasGalleryFields` 不再触发回退 |

### 依赖变更
无。不引入新包。

## 项目状态

### 已验证
- `npm run typecheck` — 通过
- `npm run test:dashboard-ui` — 通过
- `npm run test:ux-polish` — 通过
- `npm run test:select-theme` — 通过
- `npm run test:products`（运行时契约，含 on-demand gallery 字段验证）— 通过
- 快照已确认含 gallery 字段（`hasGalleryFields` + `hasCurrentProductManagementMetrics` 均通过）
- 端点计时：商品管理冷加载 59ms、运营看板预热后 60ms、304 19ms

### 未提交
- `server/index.mjs` — 已修改，未提交
- `server/warehouse.mjs` — 已修改，未提交
- `src/pages/ProductManagementPage.tsx` — 已修改，未提交（含先前存在的 gallery 功能工作）
- `pipeline/ecom_pipeline/warehouse.py` — 已修改，未提交（gallery 字段新增）

### 已知权衡（未解决）
**运营看板首次冷加载 ~9.8s**：`analytics-cache.mjs` 的 `productManagementForAnalytics` 发现钉钉周期（上月）≠ 快照 productManagement 周期（全量 Jan-Jul），回退到 `queryProductsOnDemand` spawn Python。prewarm 在启动后台吸收这 ~9.8s，之后 10 分钟内命中 analytics-cache。用户在服务器启动后立刻打开 analytics 会等到 prewarm 完成。

修法二选一，需产品决策：
- **放弃 ExecutiveCommerceOverview 里对齐周期的商品小窗**：前端 `isProductPeriodAligned` 已会 null 掉未对齐数据，直接返回快照 productManagement 即可，但 executive overview 的商品区块不显示。
- **预计算钉钉周期 productManagement**：sync 时按钉钉周期（上月）也跑一次聚合存入快照，analytics 直接读不 spawn Python。改动触及 Python 流水线。

### 接手方快速启动
```bash
# 确认缓存层生效
curl -s -o /dev/null -w "status=%{http_code} time=%{time_total}s\n" http://127.0.0.1:5173/api/products
curl -s -o /dev/null -w "status=%{http_code} time=%{time_total}s\n" http://127.0.0.1:5173/api/analytics
# 商品管理应 <100ms，analytics 应在 prewarm 后 <100ms

# 测试 304
curl -s -H "If-None-Match: \"$(curl -sI http://127.0.0.1:5173/api/products | grep -i etag | cut -d: -f2)\"" -o /dev/null -w "status=%{http_code} time=%{time_total}s\n" http://127.0.0.1:5173/api/products
# 应返回 304

# 运行契约测试
npm run typecheck
npm run test:dashboard-ui
npm run test:ux-polish
npm run test:products

# 重启 dev server 让改动生效（旧 Node 进程不会自动重载）
# 找到终端窗口 → Ctrl + C → npm run dev
```

## 关键决策日志
- RAG 搜索引擎方案被排除（2026-08-01）：RAG 解决语义搜索，不解决结构化看板加载。方向已与用户确认，走加载提速优先。
- Phase 3.3（客户端 JS SWR 缓存）主动砍掉：ETag/304 已把重新进入做到 12-19ms，JS 缓存边际收益不值得引入过期数据风险。
- Brotli 质量 11→6 是测试中发现的隐性瓶颈：`brotliCompressSync` 默认 q11 在 4MB 响应上同步阻塞 ~5s 且卡住事件循环，降 q6 后 ~50ms。