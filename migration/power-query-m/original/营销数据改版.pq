let
    源 = Folder.Files("D:\麻大师\日更数据\天猫旗舰店\10-2京东客服绩效明细\营销数据改版"),
    筛选的隐藏文件1 = Table.SelectRows(源, each [Attributes]?[Hidden]? <> true),
    调用自定义函数1 = Table.AddColumn(筛选的隐藏文件1, "转换文件 (10)", each #"转换文件 (10)"([Content])),
    重命名的列1 = Table.RenameColumns(调用自定义函数1, {"Name", "Source.Name"}),
    删除的其他列1 = Table.SelectColumns(重命名的列1, {"Source.Name", "转换文件 (10)"}),
    扩展的表格列1 = Table.ExpandTableColumn(删除的其他列1, "转换文件 (10)", Table.ColumnNames(#"转换文件 (10)"(#"示例文件 (10)"))),
    更改的类型 = Table.TransformColumnTypes(扩展的表格列1,{{"Source.Name", type text}, {"Column1", type text}, {"Column2", type text}, {"Column3", type text}, {"Column4", type text}, {"Column5", type text}, {"Column6", type text}, {"Column7", type text}, {"Column8", type text}, {"Column9", type text}, {"Column10", type text}, {"Column11", type text}, {"Column12", type text}, {"Column13", type text}, {"Column14", type text}, {"Column15", type text}, {"Column16", type text}, {"Column17", type text}, {"Column18", type text}, {"Column19", type text}, {"Column20", type text}, {"Column21", type text}, {"Column22", type text}, {"Column23", type text}, {"Column24", type text}, {"Column25", type text}, {"Column26", type text}}),
    筛选的行 = Table.SelectRows(更改的类型, each ([Column1] <> null and [Column1] <> "均值" and [Column1] <> "总值")),
    删除的副本 = Table.Distinct(筛选的行, {"Column1", "Column2", "Column3", "Column4", "Column5", "Column6"}),
    提升的标题 = Table.PromoteHeaders(删除的副本, [PromoteAllScalars=true]),
    复制的列 = Table.DuplicateColumn(提升的标题, "SalesPerformanceDataJimgmai_Fri Apr 03 00_00_00 CST 2026_Fri Apr 03 00_00_00 CST 2026_1633190228.xls", "Source.Name"),
    删除的列 = Table.RemoveColumns(复制的列,{"SalesPerformanceDataJimgmai_Fri Apr 03 00_00_00 CST 2026_Fri Apr 03 00_00_00 CST 2026_1633190228.xls"}),
    更改的类型1 = Table.TransformColumnTypes(删除的列,{{"Source.Name", type text}, {"客服", type text}, {"售前接待人数", Int64.Type}, {"推荐人数", Int64.Type}, {"24H下单人数", Int64.Type}, {"24H下单未取消人数", Int64.Type}, {"24H下单金额", type number}, {"24H下单未取消金额", type number}, {"24H下单转化率", Percentage.Type}, {"24H未取消转化率", Percentage.Type}, {"促成下单人数", Int64.Type}, {"促成下单订单数", Int64.Type}, {"促成下单商品数", Int64.Type}, {"促成下单商品金额", type number}, {"售前下单转化率", Percentage.Type}, {"促成下单商品均价", type number}, {"促成下单客单价（元/人）", type number}, {"促成下单客件数（件/人）", type number}, {"促成出库人数", Int64.Type}, {"促成出库订单数", Int64.Type}, {"促成出库商品数", Int64.Type}, {"促成出库商品金额", type number}, {"售前出库转化率", Percentage.Type}, {"下单出库转化率", Percentage.Type}, {"促成出库商品均价", type number}, {"促成出库客单价（元/人）", type number}, {"促成出库客件数（件/人）", type number}})
in
    更改的类型1
