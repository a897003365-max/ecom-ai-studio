let
    源 = Folder.Files("D:\麻大师\日更数据\天猫旗舰店\07-旗舰店商品销售数据"),
    已添加自定义 = Table.AddColumn(源, "自定义", each Excel.Workbook([Content])),
    排序的行 = Table.Sort(已添加自定义,{{"Date created", Order.Descending}}),
    #"展开的“自定义”" = Table.ExpandTableColumn(排序的行, "自定义", {"Name", "Data", "Item", "Kind", "Hidden"}, {"Name.1", "Data", "Item", "Kind", "Hidden"}),
    #"展开的“Data”" = Table.ExpandTableColumn(#"展开的“自定义”", "Data", {"Column1", "Column2", "Column3", "Column4", "Column5", "Column6", "Column7", "Column8", "Column9", "Column10", "Column11", "Column12", "Column13", "Column14", "Column15", "Column16", "Column17", "Column18", "Column19", "Column20", "Column21", "Column22", "Column23", "Column24", "Column25", "Column26", "Column27", "Column28", "Column29", "Column30", "Column31", "Column32", "Column33", "Column34", "Column35", "Column36", "Column37", "Column38"}, {"Column1", "Column2", "Column3", "Column4", "Column5", "Column6", "Column7", "Column8", "Column9", "Column10", "Column11", "Column12", "Column13", "Column14", "Column15", "Column16", "Column17", "Column18", "Column19", "Column20", "Column21", "Column22", "Column23", "Column24", "Column25", "Column26", "Column27", "Column28", "Column29", "Column30", "Column31", "Column32", "Column33", "Column34", "Column35", "Column36", "Column37", "Column38"}),
    删除的列2 = Table.RemoveColumns(#"展开的“Data”",{"Content", "Name", "Extension", "Date accessed", "Date modified", "Date created", "Attributes", "Folder Path", "Name.1", "Item", "Kind", "Hidden", "Column4", "Column37", "Column38"}),
    删除的副本1 = Table.Distinct(删除的列2),
    提升的标题1 = Table.PromoteHeaders(删除的副本1, [PromoteAllScalars=true]),
    更改的类型 = Table.TransformColumnTypes(提升的标题1,{{"退款金额", Currency.Type}, {"支付金额", Currency.Type}, {"商品访客数", Int64.Type}, {"日期", type date}, {"支付买家数", Int64.Type}}),
    删除的副本 = Table.Distinct(更改的类型, {"日期", "商品名称", "商品ID", "支付金额"}),
    已删除的空行 = Table.SelectRows(删除的副本, each not List.IsEmpty(List.RemoveMatchingItems(Record.FieldValues(_), {"", null}))),
    更改的类型1 = Table.TransformColumnTypes(已删除的空行,{{"支付金额", Currency.Type}, {"退款金额", Currency.Type}, {"支付买家数", Int64.Type}, {"支付件数", Int64.Type}, {"商品ID", type text}, {"商品访客数", Int64.Type}, {"加购人数", Int64.Type}, {"支付新买家数", Int64.Type}}),
    重命名的列 = Table.RenameColumns(更改的类型1,{{"支付件数", "商品支付件数"}}),
    更改的类型2 = Table.TransformColumnTypes(重命名的列,{{"UV价值", type number}, {"客单价", type number}, {"加购件数", type number}})
in
    更改的类型2
