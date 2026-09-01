let
    源 = Excel.Workbook(File.Contents("D:\麻大师\日更数据\天猫旗舰店\00-各渠道销售数据\25年各渠道目标.xlsx"), null, false),
    Sheet1_sheet = 源{[Item="Sheet1",Kind="Sheet"]}[Data],
    FilterNullAndWhitespace = each List.Select(_, each _ <> null and (not (_ is text) or Text.Trim(_) <> "")),
    删除的底部行 = Table.RemoveLastN(Sheet1_sheet, each try List.IsEmpty(List.Skip(FilterNullAndWhitespace(Record.FieldValues(_)), 1)) otherwise false),
    更改的类型 = Table.TransformColumnTypes(删除的底部行,{{"Column1", type text}, {"Column2", type text}, {"Column3", type any}, {"Column4", type any}, {"Column5", type any}, {"Column6", type any}, {"Column7", type any}, {"Column8", type any}, {"Column9", type any}, {"Column10", type any}, {"Column11", type any}, {"Column12", type any}, {"Column13", type any}, {"Column14", type any}}),
    提升的标题 = Table.PromoteHeaders(更改的类型, [PromoteAllScalars=true]),
    更改的类型1 = Table.TransformColumnTypes(提升的标题,{{"渠道", type text}, {"店铺", type text}, {"1月", Int64.Type}, {"2月", Int64.Type}, {"3月", Int64.Type}, {"4月", Int64.Type}, {"5月", Int64.Type}, {"6月", Int64.Type}, {"7月", Int64.Type}, {"8月", Int64.Type}, {"9月", Int64.Type}, {"10月", Int64.Type}, {"11月", Int64.Type}, {"12月", Int64.Type}}),
    逆透视的列 = Table.UnpivotOtherColumns(更改的类型1, {"渠道", "店铺"}, "属性", "值"),
    更改的类型2 = Table.TransformColumnTypes(逆透视的列,{{"属性", type date}}),
    重命名的列 = Table.RenameColumns(更改的类型2,{{"属性", "日期"}})
in
    重命名的列
