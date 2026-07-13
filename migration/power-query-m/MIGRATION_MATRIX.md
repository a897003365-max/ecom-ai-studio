# Power Query M 迁移矩阵

生成日期：2026-07-11  
源文件：`D:/麻大师/BI文件/麻大师店铺推广数据报表.pbix`  
M 查询：25 个

## 迁移原则

- `original/*.pq` 保留 PBIX 中的原始 M 表达式，作为行为基线和审计依据。
- Python 管线只读取 `D:/麻大师/日更数据` 本地文件，不依赖 Power BI Desktop、本地 Analysis Services 端口或 Power BI MCP。
- 清洗结果写入 Parquet，DuckDB 只负责查询、视图和聚合快照。
- 每个查询先完成源文件可用性、列契约和行数校验，再标记为“已迁移”。

## 查询清单

| 查询 | 数据源类型 | 本地源状态 | 类型列 | 复杂度 | 状态 |
|---|---|---:|---:|---|---|
| 00-月表汇总 | excel_file | 可读取 | 24 | 标准 | 待迁移 |
| 01-店铺数据辅助表 | folder | 可读取 | 4 | 标准 | 待迁移 |
| 03-1-各渠道目标金额 | excel_file | 可读取 | 29 | 复合 | 待迁移 |
| 03-2店铺每天销售目标 | folder | 可读取 | 5 | 标准 | 待迁移 |
| 04-旗舰店基础数据 | folder | 可读取 | 120 | 标准 | 待迁移 |
| 05-旗舰店ID对照表 | folder | 可读取 | 14 | 标准 | 待迁移 |
| 06-旗舰店流量数据 | folder | 可读取 | 34 | 标准 | 待迁移 |
| 07-旗舰店商品销售数据 | folder | 可读取 | 12 | 标准 | 待迁移 |
| 08-1关键词报表数据 | folder | 可读取 | 78 | 标准 | 待迁移 |
| 08-2人群报表数据 | folder | 可读取 | 76 | 标准 | 待迁移 |
| 08-旗舰店推广花费 | folder | 可读取 | 78 | 标准 | 待迁移 |
| 10-1淘宝客服绩效明细 | folder | 可读取 | 27 | 标准 | 待迁移 |
| 10-2京东客服营销明细 | folder | 可读取 | 7 | 标准 | 待迁移 |
| 10-3京东客服绩效数据 | folder | 可读取 | 13 | 标准 | 待迁移 |
| 10-4客服员工日报统计 | folder | 可读取 | 39 | 标准 | 待迁移 |
| 11-旗舰店UD推广计划 | folder | 可读取 | 46 | 标准 | 待迁移 |
| 14-推广竞品数据 | folder | 可读取 | 19 | 标准 | 待迁移 |
| 辅4-床垫编码 | excel_file | 可读取 | 0 | 标准 | 待迁移 |
| 辅5-床类编码 | excel_file | 可读取 | 0 | 标准 | 待迁移 |
| 接待数据 | folder | 可读取 | 31 | 标准 | 待迁移 |
| 京东客服分组表 | folder | 可读取 | 3 | 复合 | 待迁移 |
| 考勤数据 | folder | 可读取 | 16 | 标准 | 待迁移 |
| 淘宝客服排班表 | folder | 可读取 | 9 | 标准 | 待迁移 |
| 营销数据 | folder | 可读取 | 12 | 标准 | 待迁移 |
| 营销数据改版 | folder | 可读取 | 53 | 标准 | 待迁移 |

## 高频 M 操作

- `Table.TransformColumnTypes`: 23 个查询
- `Table.RenameColumns`: 22 个查询
- `Folder.Files`: 21 个查询
- `Table.AddColumn`: 21 个查询
- `Table.ExpandTableColumn`: 21 个查询
- `Table.SelectRows`: 21 个查询
- `Table.ColumnNames`: 20 个查询
- `Table.SelectColumns`: 20 个查询
- `Table.Distinct`: 13 个查询
- `Table.PromoteHeaders`: 7 个查询
- `Excel.Workbook`: 5 个查询
- `Table.Sort`: 5 个查询
- `File.Contents`: 4 个查询
- `Table.Combine`: 4 个查询
- `Table.RemoveColumns`: 4 个查询
- `Text.Contains`: 4 个查询
- `List.First`: 3 个查询
- `List.PositionOf`: 3 个查询
- `List.RemoveNulls`: 3 个查询
- `List.Transform`: 3 个查询

## 产物

- `manifest.json`：机器可读查询、路径、操作与列清单。
- `original/*.pq`：逐查询原始 M 代码。
- `MIGRATION_MATRIX.md`：迁移范围与状态。
