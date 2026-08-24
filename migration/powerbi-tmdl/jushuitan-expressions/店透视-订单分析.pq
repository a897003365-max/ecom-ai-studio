let
    源 = Folder.Files("D:\麻大师\日更数据\天猫旗舰店\02-商品明细库存表\淘宝\店透视-订单分析"),
    筛选的隐藏文件1 = Table.SelectRows(源, each [Attributes]?[Hidden]? <> true),
    调用自定义函数1 = Table.AddColumn(筛选的隐藏文件1, "转换文件", each 转换文件([Content])),
    重命名的列1 = Table.RenameColumns(调用自定义函数1, {"Name", "Source.Name"}),
    删除的其他列1 = Table.SelectColumns(重命名的列1, {"Source.Name", "转换文件"}),
    扩展的表格列1 = Table.ExpandTableColumn(删除的其他列1, "转换文件", Table.ColumnNames(转换文件(示例文件))),
    更改的类型 = Table.TransformColumnTypes(扩展的表格列1,{{"Source.Name", type text}, {"订单号", Int64.Type}, {"下单时间", type datetime}, {"买家", type text}, {"买家ID", Int64.Type}, {"商品名称", type text}, {"SKU", type text}, {"商家编码", type text}, {"交易状态", type text}, {"售后状态", type text}, {"标记", type text}, {"插旗备注", type any}, {"数量", Int64.Type}, {"商品总价", Int64.Type}, {"实收款不含快递", type number}, {"实收款含快递", type number}}),
    合并的查询 = Table.NestedJoin(更改的类型, {"标记"}, 旗帜对应表, {"标记"}, "旗帜对应表", JoinKind.LeftOuter),
    #"展开的“旗帜对应表”" = Table.ExpandTableColumn(合并的查询, "旗帜对应表", {"旗帜颜色", "插旗订单信息"}, {"旗帜颜色", "插旗订单信息"}),
    更改的类型1 = Table.TransformColumnTypes(#"展开的“旗帜对应表”",{{"订单号", type text}}),
    删除的副本 = Table.Distinct(更改的类型1, {"订单号", "下单时间"})
in
    删除的副本