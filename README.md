# ecom AI Studio 本地运营工作台

React + TypeScript + Vite + TailwindCSS 的电商 AI 本地 MVP。页面继承 `E:\Github\电商工作台样板图` 的深色科技风、荧光绿色品牌色、紧凑卡片、固定导航、状态标签、进度条和可横向滚动的表格。

本版本通过一个本机端口同时提供网页和 API。运营数据不再依赖 Power BI Desktop 动态端口：PBIX 中的 25 个 Power Query M 已导出并迁移到 Python + Polars + DuckDB + Parquet 本地数仓；钉钉共享表采用只读 Sheet API，每日三次同步；飞书只读聚合保留在同一数据入口。

## 安装与启动

环境要求：Node.js 22+、Python 3.11+。首次使用本地数仓需安装 Python 依赖。

```bash
npm install
python -m pip install -r pipeline/requirements.txt
python pipeline/sync.py sync
npm run dev
```

默认地址为 `http://127.0.0.1:5173/`。端口被占用时服务自动选择后续端口；网页和 `/api/*` 始终共用实际输出的地址。

### 开机自启（Windows 计划任务）

无需每次重启电脑后手动运行 `npm run dev`。注册一次登录自启任务：

```bash
npm run schedule:devserver
```

任务名为 `EcomAIStudio-DevServer`：用户登录时自动启动 `node server/index.mjs`（开发模式，API + UI 同端口 5173，含 Vite HMR），以当前用户身份运行，失败最多自动重启 3 次（间隔 1 分钟）。注册脚本为 `scripts/register-devserver-schedule.ps1`。

常用管理命令：

```bash
# 手动重启（改了 server/ 或 pipeline/ 代码后需要）
powershell -Command "Restart-ScheduledTask -TaskName 'EcomAIStudio-DevServer'"
# 取消开机自启
powershell -Command "Disable-ScheduledTask -TaskName 'EcomAIStudio-DevServer'"
# 重新启用
powershell -Command "Enable-ScheduledTask -TaskName 'EcomAIStudio-DevServer'"
```

- 改 `src/` 前端代码：刷新浏览器即生效（Vite HMR），无需重启任务。
- 改 `server/`、`pipeline/` 或 `transforms.py` 等后端代码：需 `Restart-ScheduledTask` 重启任务后生效。
- 改 `transforms.py`（数据转换层）字段后，还需 `python pipeline/sync.py sync --query 15-聚水潭商品数据 --force` 强制重建 parquet，否则数仓视图仍是旧值。

登录与权限功能已完整保留，但本地开发默认采用免登录模式，不拦截页面和业务 API。正式上线前设置 `AUTH_ENFORCEMENT_ENABLED=1` 后，首次打开会进入“创建首位管理员”页面；之后登录必须同时匹配邮箱、手机号和密码。账号、密码哈希和服务端会话保存在已忽略的 `local-data/auth/auth-store.json`，浏览器只接收 HttpOnly 会话 Cookie。

构建与验证：

```bash
npm run build
npm run test:auth
npm run test:dingtalk-api
npm run test:public-surface
python -m unittest discover -s pipeline/tests -v
npm run test:smoke
```

## 页面清单

1. 工作台首页：任务、内容、图片、竞品、人工确认、失败任务和本机系统状态。
2. 商品资产：SKU、素材来源、完整度与生产入口。
3. 内容生产 / 短视频生产：批次、文案、口播、直播话术、分镜、质检、确认与导出。
4. 图片处理工坊：导入、抠图、尺寸、角标、背景、合规检测和导出包的前端任务流。
5. 运营数据看板：本地数仓、钉钉、飞书的聚合经营指标、趋势、素材表现与再生成建议。
6. 竞品情报 / TOP100：行业榜单、竞品店铺与价格监控 mock。
7. 任务队列：跨模块异步任务、重试、人工确认、日志和产物入口。
8. 商品管理：按商品查看经营、投放与转化数据。
9. 系统设置：本机环境、数据源状态、同步配置和 AI / 人工分工。
10. 用户与权限：管理员创建、停用账号，并逐项配置页面查看与操作权限。

## 数据架构

```text
D:\麻大师\日更数据 本地源文件
  -> Python / Polars 增量转换
  -> local-data/warehouse/staging/*.parquet
  -> DuckDB 聚合与 mart
  -> analytics-snapshot.json
  -> 单端口 /api/analytics
  -> React 运营数据页面

钉钉共享表 Sheet API（只读，每日 10:30 / 13:00 / 17:30）
  -> local-data 脱敏聚合快照
  -> 单端口 /api/analytics

飞书共享表（只读）
  -> 脱敏聚合快照
  -> 单端口 /api/analytics
```

### 本地数仓

- `migration/power-query-m/original/`：25 个从 PBIX 导出的原始 Power Query M 文件。
- `migration/power-query-m/manifest.json`：查询、来源路径、字段和迁移清单。
- `pipeline/`：可复用 Python 管线，使用 Polars 转换、Parquet 分区和 DuckDB 查询。
- `local-data/warehouse/`：本机数据库、分区和只供网页读取的聚合快照，不进入版本控制。

重新导出 M 代码或重建映射：

```bash
npm run extract:power-query
python pipeline/sync.py sync
```

### 钉钉只读同步

在用户级环境变量中配置以下值，浏览器不会收到密钥：

```text
DINGTALK_APP_KEY
DINGTALK_APP_SECRET
DINGTALK_WORKBOOK_ID
DINGTALK_OPERATOR_ID
DINGTALK_OPERATOR_USER_ID
DINGTALK_SYNC_TIMES=10:30,13:00,17:30
# 可选：无人值守重试与单请求超时
DINGTALK_SYNC_ATTEMPTS=3
DINGTALK_API_TIMEOUT_MS=45000
```

手动同步、试运行和注册计划任务：

```bash
npm run sync:dingtalk
npm run sync:dingtalk:dry
npm run schedule:dingtalk
```

计划任务名为 `EcomAIStudio-DingTalk-Sync`。它只读取工作表并保存脱敏聚合，不回写钉钉；注册后使用 S4U 身份运行，不依赖用户交互登录，网络恢复后自动补跑，失败最多自动重启 3 次。每次运行的状态会写入 `local-data/runtime/dingtalk-sync-health.json`，并可从 `/api/health` 查看。

### 飞书只读聚合

飞书 URL 可放入已忽略的 `local-data/source-config.json`，或使用 `FEISHU_PR_SHEET_URL`、`FEISHU_CONTENT_SHEET_URL` 环境变量。网页仅展示平台、日期、产品和效果指标的聚合结果，不展示访问令牌、手机号或原始链接。

## 本地 API

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/health` | 服务健康状态 |
| GET | `/api/auth/status` | 登录状态与首次初始化状态 |
| POST | `/api/auth/bootstrap` | 仅首次创建管理员并签发会话 |
| POST | `/api/auth/login` | 使用邮箱、手机号和密码登录 |
| POST | `/api/auth/logout` | 注销当前服务端会话 |
| GET/POST | `/api/admin/users` | 管理员查询或创建用户 |
| PATCH | `/api/admin/users/:id` | 管理员更新账号状态与权限 |
| GET | `/api/data-sources` | 本地数仓、钉钉、飞书和工作流状态 |
| GET | `/api/analytics` | 三类来源的聚合快照与同步历史 |
| POST | `/api/sync/warehouse` | 增量读取本地源文件并刷新 DuckDB / Parquet |
| POST | `/api/sync/dingtalk` | 触发钉钉 Sheet API 只读同步；未配置时解析本地导出 |
| POST | `/api/sync/feishu` | 触发飞书只读聚合 |
| GET/POST | `/api/tasks` | 查询或创建本地任务 |
| POST | `/api/tasks/:id/actions` | 重试、确认、取消或导出任务状态 |
| GET | `/api/workflows` | 内容生产工作流状态 |
| POST | `/api/workflows/douyin-ecom-copy/run` | 写入文案、分镜或质检本地队列 |
| POST | `/api/uploads` | 导入 CSV / XLSX / JSON 作为本地兜底数据源 |

当 `AUTH_ENFORCEMENT_ENABLED=1` 时，除 `/api/health` 和登录初始化接口外，业务 API 均要求有效会话，并在服务端按权限再次校验；默认值 `0` 用于本地开发和 Agent 调试，可直接访问页面与业务 API。管理员始终拥有全部权限；普通用户的导航和接口访问范围由“用户与权限”页面配置。连续登录失败会触发 15 分钟窗口限流。

## 工程结构

```text
server/
  index.mjs             # 单端口 UI / API 服务
  warehouse.mjs         # Python 数仓同步与聚合快照读取
  dingtalk-api.mjs      # 钉钉 Sheet API 只读连接
  dingtalk-lock.mjs     # 钉钉同步跨进程互斥锁
  dingtalk.mjs          # 钉钉本地导出文件兜底解析
  feishu.mjs            # 飞书只读脱敏聚合
  workflow.mjs          # Claude Code 内容任务入口
pipeline/
  ecom_pipeline/        # Polars / DuckDB / Parquet 管线
  tests/                # 管线单元测试
scripts/
  extract-power-query.mjs
  sync-dingtalk.mjs
  register-dingtalk-schedule.ps1
src/
  components/           # 通用界面组件和导航图标
  data/mock.ts          # 尚未接入真实执行器的演示数据
  pages/                # 各业务页面
  services/localApi.ts  # 浏览器 API 客户端
  types/                # 类型定义
  utils/                # 格式与状态工具
```

## 当前 MVP 边界与后续接入点

- 已接入：本地文件数仓、钉钉 Sheet API 只读聚合、飞书只读聚合、网页到本地内容任务队列。
- 保留 mock：图片执行脚本、TOP100 / 竞品抓取结果、素材与广告内容 ID 映射、任务产物回写。
- 不做真实抓取、绕过反爬、操作真实店铺、发布内容、投放或平台账号写操作。
- 后续应从 `server/workflow.mjs` 接入受控本地 worker，从图片页接入本地脚本结果目录，从竞品页接入合规采集产物文件。
- 任何密钥、Cookie、手机号、买家信息、原始链接和带令牌 URL 都不得进入浏览器快照、日志或版本库。

## 相关文档

- [本地数仓迁移状态](migration/power-query-m/MIGRATION_STATUS.md)
- [运营数据本地化方案](docs/OPERATIONS_DATA_INTEGRATION_PLAN.md)
- [内容工作流本地编排方案](docs/CONTENT_WORKFLOW_LOCAL_ORCHESTRATION_PLAN.md)
- [缺失数据需求清单](docs/DATA_REQUIREMENTS.md)
- [交接文档](docs/HANDOFF.md)
- [运行与验证日志](docs/OPERATIONS-LOG.md)
- [钉钉安全说明](docs/DINGTALK-SECURITY.md)
- [PowerBI 独有数据呈现方案](docs/POWERBI-UNIQUE-DATA-PRESENTATION-PLAN.md)
