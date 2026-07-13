let
    源 = Folder.Files("D:\麻大师\日更数据\天猫旗舰店\淘宝客服排班表"),
    筛选的隐藏文件1 = Table.SelectRows(源, each [Attributes]?[Hidden]? <> true),
    调用自定义函数1 = Table.AddColumn(筛选的隐藏文件1, "转换文件 (31)", each #"转换文件 (31)"([Content])),
    重命名的列1 = Table.RenameColumns(调用自定义函数1, {"Name", "Source.Name"}),
    删除的其他列1 = Table.SelectColumns(重命名的列1, {"Source.Name", "转换文件 (31)"}),
    扩展的表格列1 = Table.ExpandTableColumn(删除的其他列1, "转换文件 (31)", Table.ColumnNames(#"转换文件 (31)"(#"示例文件 (31)"))),
    更改的类型 = Table.TransformColumnTypes(扩展的表格列1,{{"Source.Name", type text}, {"Column1", type text}, {"Column2", type text}}),
    提升的标题 = Table.PromoteHeaders(更改的类型, [PromoteAllScalars=true]),
    更改的类型1 = Table.TransformColumnTypes(提升的标题,{{"客服排班表.xlsx", type text}, {"旺旺昵称", type text}, {"班次", type text}, {"昵称", type text}, {"开始时间", type date}, {"结束时间", type date}})
in
    更改的类型1
