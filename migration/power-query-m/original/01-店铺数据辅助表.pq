let
    源 = Folder.Files("D:\麻大师\日更数据\天猫旗舰店\01-店铺数据辅助表"),
    删除的其他列 = Table.SelectColumns(源,{"Content"}),
    筛选的隐藏文件1 = Table.SelectRows(删除的其他列, each [Attributes]?[Hidden]? <> true),
    调用自定义函数1 = Table.AddColumn(筛选的隐藏文件1, "转换文件 (3)", each #"转换文件 (3)"([Content])),
    删除的其他列1 = Table.SelectColumns(调用自定义函数1, {"转换文件 (3)"}),
    扩展的表格列1 = Table.ExpandTableColumn(删除的其他列1, "转换文件 (3)", Table.ColumnNames(#"转换文件 (3)"(#"示例文件 (3)"))),
    更改的类型 = Table.TransformColumnTypes(扩展的表格列1,{{"日期", type date}, {"年度", type text}, {"月份", type text}, {"日", type text}})
in
    更改的类型
