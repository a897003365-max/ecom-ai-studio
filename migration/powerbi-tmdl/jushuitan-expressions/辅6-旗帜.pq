let
    源 = Folder.Files("D:\麻大师\日更数据\天猫旗舰店\02-商品明细库存表\淘宝\旗帜"),
    筛选的隐藏文件1 = Table.SelectRows(源, each [Attributes]?[Hidden]? <> true),
    调用自定义函数1 = Table.AddColumn(筛选的隐藏文件1, "转换文件 (51)", each #"转换文件 (51)"([Content])),
    重命名的列1 = Table.RenameColumns(调用自定义函数1, {"Name", "Source.Name"}),
    删除的其他列1 = Table.SelectColumns(重命名的列1, {"Source.Name", "转换文件 (51)"}),
    扩展的表格列1 = Table.ExpandTableColumn(删除的其他列1, "转换文件 (51)", Table.ColumnNames(#"转换文件 (51)"(#"示例文件 (51)"))),
    复制的列 = Table.DuplicateColumn(扩展的表格列1, "Source.Name", "旗帜颜色"),
    替换的值 = Table.ReplaceValue(复制的列,".xlsx","",Replacer.ReplaceText,{"旗帜颜色"}),
    替换的值1 = Table.ReplaceValue(替换的值,"2.xlsx","",Replacer.ReplaceText,{"旗帜颜色"}),
    更改的类型 = Table.TransformColumnTypes(替换的值1,{{"Source.Name", type text}, {"子订单编号", type text}, {"主订单编号", type text}, {"旗帜颜色", type text}}),
    删除的副本 = Table.Distinct(更改的类型, {"子订单编号"})
in
    删除的副本