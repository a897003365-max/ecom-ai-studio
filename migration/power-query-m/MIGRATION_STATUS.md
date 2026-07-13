# Power Query 开源迁移状态

生成日期：2026-07-12  
查询完成：25/25  
源文件：3828  
Parquet 分区：3828  
可查询行：2407712

## M 到开源实现映射

| Power Query M | 本地实现 |
|---|---|
| `Folder.Files` / `File.Contents` | Python `pathlib` 增量文件发现与签名 |
| `Excel.Workbook` | Pandas + openpyxl/xlrd，兼容 XLSX、XLS 与 HTML 表格导出 |
| `Csv.Document` | Polars CSV 读取，GB18030 回退到 Pandas |
| `Table.PromoteHeaders` | 显式表头提升并隔离来源元数据列 |
| `Table.TransformColumnTypes` | Polars 严格列契约、数值、百分比和 Excel 日期转换 |
| `Table.SelectRows` / `RemoveColumns` / `RenameColumns` | Polars filter/drop/rename |
| `Table.Distinct` | 分区内 Polars unique + 模型视图 DuckDB DISTINCT |
| `Table.UnpivotOtherColumns` | Polars unpivot，用于渠道月目标 |
| `Table.Combine` | DuckDB `UNION ALL BY NAME` 复合模型视图 |
| `Table.FuzzyNestedJoin` | DuckDB Jaro-Winkler 相似度侧向连接 |

## 查询结果

| 查询 | 源文件 | Parquet | 行数 | 失败 | 状态 |
|---|---:|---:|---:|---:|---|
| 00-月表汇总 | 1 | 1 | 986 | 0 | 已迁移 |
| 01-店铺数据辅助表 | 1 | 1 | 1154 | 0 | 已迁移 |
| 03-1-各渠道目标金额 | 1 | 1 | 108 | 0 | 已迁移 |
| 03-2店铺每天销售目标 | 1 | 1 | 3325 | 0 | 已迁移 |
| 04-旗舰店基础数据 | 239 | 239 | 7032 | 0 | 已迁移 |
| 05-旗舰店ID对照表 | 1 | 1 | 120 | 0 | 已迁移 |
| 06-旗舰店流量数据 | 120 | 120 | 11002 | 0 | 已迁移 |
| 07-旗舰店商品销售数据 | 651 | 651 | 68057 | 0 | 已迁移 |
| 08-1关键词报表数据 | 122 | 122 | 1082385 | 0 | 已迁移 |
| 08-2人群报表数据 | 124 | 124 | 212748 | 0 | 已迁移 |
| 08-旗舰店推广花费 | 420 | 420 | 988302 | 0 | 已迁移 |
| 10-1淘宝客服绩效明细 | 543 | 543 | 9436 | 0 | 已迁移 |
| 10-2京东客服营销明细 | 249 | 249 | 1917 | 0 | 已迁移 |
| 10-3京东客服绩效数据 | 249 | 249 | 1923 | 0 | 已迁移 |
| 10-4客服员工日报统计 | 258 | 258 | 3175 | 0 | 已迁移 |
| 11-旗舰店UD推广计划 | 102 | 102 | 421 | 0 | 已迁移 |
| 14-推广竞品数据 | 46 | 46 | 1288 | 0 | 已迁移 |
| 辅4-床垫编码 | 1 | 1 | 7949 | 0 | 已迁移 |
| 辅5-床类编码 | 1 | 1 | 488 | 0 | 已迁移 |
| 接待数据 | 235 | 235 | 1851 | 0 | 已迁移 |
| 京东客服分组表 | 1 | 1 | 61 | 0 | 已迁移 |
| 考勤数据 | 229 | 229 | 1765 | 0 | 已迁移 |
| 淘宝客服排班表 | 1 | 1 | 398 | 0 | 已迁移 |
| 营销数据 | 27 | 27 | 202 | 0 | 已迁移 |
| 营销数据改版 | 205 | 205 | 1619 | 0 | 已迁移 |

## 数据边界

- 网站 API 只读取 `analytics-snapshot.json` 中的聚合指标。
- 客服、商品和投放明细只保留在本机 Parquet/DuckDB，不通过前端接口返回。
- PBIX 和 Power BI Desktop 不再是网站同步依赖。
