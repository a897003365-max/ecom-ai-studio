let
    源 = Folder.Files("D:\麻大师\日更数据\天猫旗舰店\京东客服分组表"),
    筛选的隐藏文件1 = Table.SelectRows(源, each [Attributes]?[Hidden]? <> true),
    调用自定义函数1 = Table.AddColumn(筛选的隐藏文件1, "转换文件 (38)", each #"转换文件 (38)"([Content])),
    重命名的列1 = Table.RenameColumns(调用自定义函数1, {"Name", "Source.Name"}),
    删除的其他列1 = Table.SelectColumns(重命名的列1, {"Source.Name", "转换文件 (38)"}),
    扩展的表格列1 = Table.ExpandTableColumn(删除的其他列1, "转换文件 (38)", Table.ColumnNames(#"转换文件 (38)"(#"示例文件 (38)"))),
    更改的类型 = Table.TransformColumnTypes(扩展的表格列1,{{"Source.Name", type text}, {"客服账号", type text}, {"京东分组", type text}}),
    筛选的行 = Table.SelectRows(更改的类型, each ([客服账号] <> "麻大师思思")),
    合并的查询 = Table.FuzzyNestedJoin(筛选的行, {"客服账号"}, 淘宝客服排班表, {"昵称"}, "淘宝客服排班表", JoinKind.LeftOuter, [IgnoreCase=true, IgnoreSpace=true, NumberOfMatches=1, Threshold=0.1]),
    #"展开的“淘宝客服排班表”" = Table.ExpandTableColumn(合并的查询, "淘宝客服排班表", {"昵称", "旺旺昵称"}, {"昵称", "旺旺昵称"}),
    重命名的列 = Table.RenameColumns(#"展开的“淘宝客服排班表”",{{"旺旺昵称", "客服"}})
in
    重命名的列
