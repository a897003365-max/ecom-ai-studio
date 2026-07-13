let
    源 = Folder.Files("D:\麻大师\日更数据\天猫旗舰店\03-各店铺销售目标"),
    筛选的隐藏文件1 = Table.SelectRows(源, each [Attributes]?[Hidden]? <> true),
    调用自定义函数1 = Table.AddColumn(筛选的隐藏文件1, "转换文件 (16)", each #"转换文件 (16)"([Content])),
    重命名的列1 = Table.RenameColumns(调用自定义函数1, {"Name", "Source.Name"}),
    删除的其他列1 = Table.SelectColumns(重命名的列1, {"Source.Name", "转换文件 (16)"}),
    扩展的表格列1 = Table.ExpandTableColumn(删除的其他列1, "转换文件 (16)", Table.ColumnNames(#"转换文件 (16)"(#"示例文件 (16)"))),
    更改的类型 = Table.TransformColumnTypes(扩展的表格列1,{{"Source.Name", type text}, {"日期", type date}, {"销售目标", Int64.Type}, {"旗舰店毛利", Int64.Type}, {"Column4", type any}}),
    删除的列 = Table.RemoveColumns(更改的类型,{"Column4"})
in
    删除的列
