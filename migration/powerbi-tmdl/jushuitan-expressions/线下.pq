let
    源 = Folder.Files("D:\麻大师\日更数据\天猫旗舰店\02-商品明细库存表\线下"),
    筛选的隐藏文件1 = Table.SelectRows(源, each [Attributes]?[Hidden]? <> true),
    调用自定义函数1 = Table.AddColumn(筛选的隐藏文件1, "转换文件 (7)", each #"转换文件 (7)"([Content])),
    重命名的列1 = Table.RenameColumns(调用自定义函数1, {"Name", "Source.Name"}),
    删除的其他列1 = Table.SelectColumns(重命名的列1, {"Source.Name", "转换文件 (7)"}),
    扩展的表格列1 = Table.ExpandTableColumn(删除的其他列1, "转换文件 (7)", Table.ColumnNames(#"转换文件 (7)"(#"示例文件 (7)"))),
    更改的类型 = Table.TransformColumnTypes(扩展的表格列1,{{"Source.Name", type text}, {"子订单编号", type text}, {"主订单编号", type text}})
in
    更改的类型