# ecom AI Studio 交付报告

日期：2026-07-12

## 已交付

- 将原型拆分为 React + TypeScript + Vite + TailwindCSS 项目，保留深色、荧光绿、紧凑侧栏与数据工作台视觉语言。
- 保留导航结构并验证首页、商品资产、内容生产、图片处理、运营数据、竞品 TOP100、任务队列、系统设置均可切换。
- 完成内容生产、图片处理、竞品、任务队列与设置页的 mock 任务操作、状态标签、进度、导出和人工确认入口。
- 钉钉共享表已接入 Sheet API，只读同步 19 张工作表，计划任务每日四次执行。
- 从 `D:\麻大师\BI文件\麻大师店铺推广数据报表.pbix` 导出 25 个 Power Query M 查询，并建立 Python + Polars + DuckDB + Parquet 本地数仓。
- 本地数仓已迁移 3,828 个源文件、3,828 个 Parquet 分区、2,407,712 行；网页仅读取聚合快照。
- 已从运行中的网页 API 移除 Power BI Desktop 动态端口和 ADOMD 依赖；PBIX / Power BI Desktop 不再是网页同步前置条件。
- 飞书继续以只读脱敏聚合接入，网页不暴露令牌、手机号或原始链接。

## 验证结果

```text
npm install                                      通过
npm run build                                    通过
npm run test:dingtalk-api                        通过
python -m unittest discover -s pipeline/tests -v  通过
POST /api/sync/warehouse                         通过
钉钉 Sheet API 全量只读同步                       通过
任务计划 EcomAIStudio-DingTalk-Sync               Ready，4 个触发时间
浏览器 1440 x 1000 与 390 x 844                  通过
```

## 关键文件

- `server/index.mjs`
- `server/warehouse.mjs`
- `server/dingtalk-api.mjs`
- `pipeline/ecom_pipeline/`
- `migration/power-query-m/original/`
- `scripts/sync-dingtalk.mjs`
- `scripts/register-dingtalk-schedule.ps1`
- `src/pages/AnalyticsPage.tsx`
- `src/pages/SettingsPage.tsx`
- `src/styles.css`

## 残余接口

- 受控 Claude Code worker 的启动、日志流和产物回写。
- 本地图片处理脚本与图片包导出。
- 合规的 TOP100 / 竞品采集产物导入。
- `MaterialId <-> ContentId` 与统一 SKU 映射，供素材胜率与再生成建议使用。
