let
    源 = Folder.Files("D:\麻大师\日更数据\天猫旗舰店\05-旗舰店ID对照表"),
    筛选的隐藏文件1 = Table.SelectRows(源, each [Attributes]?[Hidden]? <> true),
    调用自定义函数1 = Table.AddColumn(筛选的隐藏文件1, "转换文件 (9)", each #"转换文件 (9)"([Content])),
    重命名的列1 = Table.RenameColumns(调用自定义函数1, {"Name", "Source.Name"}),
    删除的其他列1 = Table.SelectColumns(重命名的列1, {"Source.Name", "转换文件 (9)"}),
    扩展的表格列1 = Table.ExpandTableColumn(删除的其他列1, "转换文件 (9)", Table.ColumnNames(#"转换文件 (9)"(#"示例文件 (9)"))),
    更改的类型 = Table.TransformColumnTypes(扩展的表格列1,{{"Source.Name", type text}, {"商品名称", type text}, {"商品ID", type text}, {"商品图片", type text}, {"商家编码", type text}, {"类目名称", type text}, {"商品价格", type number}, {"库存", Int64.Type}, {"累计销量", Int64.Type}, {"30日销量", Int64.Type}, {"基础分", type any}, {"扶优分", type any}, {"创建时间", type datetime}, {"商品状态", type text}})
in
    更改的类型