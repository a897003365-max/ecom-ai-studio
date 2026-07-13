let
    源 = Folder.Files("D:\麻大师\日更数据\天猫旗舰店\10-2京东客服绩效明细\工作量数据"),
    筛选的隐藏文件1 = Table.SelectRows(源, each [Attributes]?[Hidden]? <> true),
    调用自定义函数1 = Table.AddColumn(筛选的隐藏文件1, "转换文件 (43)", each #"转换文件 (43)"([Content])),
    重命名的列1 = Table.RenameColumns(调用自定义函数1, {"Name", "Source.Name"}),
    删除的其他列1 = Table.SelectColumns(重命名的列1, {"Source.Name", "转换文件 (43)"}),
    扩展的表格列1 = Table.ExpandTableColumn(删除的其他列1, "转换文件 (43)", Table.ColumnNames(#"转换文件 (43)"(#"示例文件 (43)"))),
    筛选的行 = Table.SelectRows(扩展的表格列1, each ([客服] <> "均值" and [客服] <> "总值")),
    追加的查询 = Table.Combine({筛选的行, 接待数据}),
    ExtractDate = Table.AddColumn(追加的查询, "日期", each 
 let
    FullText = [Source.Name],
    
    // 使用正则表达式思路提取日期（日） - 保持不变
    DateMatch = Text.Select(Text.BetweenDelimiters(FullText, " ", " ", 1), {"0".."9"}),
    Day = if DateMatch <> "" then Number.FromText(DateMatch) else null,
    
    // 月份查找 - 保持不变
    Month = List.First(List.RemoveNulls(List.Transform(
        {"Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"},
        (m) => if Text.Contains(FullText, m) then 
            List.PositionOf({"Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"}, m) + 1 
            else null
    )), null),
    
    // 提取年份 - 简化版直接查找4位数字
    YearMatch = 
        let
            // 直接在整个文本中查找4位连续数字
            // 方法1: 使用Text.PositionOf和Text.Middle
            YearPattern = " " & Text.Combine(List.Transform({0..9}, Text.From)) & " ",
            YearStart = Text.PositionOf(FullText, " CST ", Occurrence.First) + 5, // 找到第一个"CST "之后的位置
            YearText = if YearStart > 4 then 
                Text.Middle(FullText, YearStart, 4) else null,
            Year = if YearText <> null and 
                    Text.Length(Text.Select(YearText, {"0".."9"})) = 4 then 
                Number.FromText(YearText) else null
        in
            Year,
    
    // 创建日期值
    DateValue = try 
        if Month <> null and Day <> null then 
            if YearMatch <> null then 
                #date(YearMatch, Month, Day)
            else 
                #date(2025, Month, Day)
        else 
            null 
    otherwise null
    
in
    DateValue)
,
    更改的类型 = Table.TransformColumnTypes(ExtractDate,{{"日期", type date}, {"30s应答率", Percentage.Type}, {"平均回复消息数", type number}, {"首次平均响应时间", type number}, {"新平均响应时间", type number}, {"接待量", type number}, {"接待时长", type number}}),
    删除的副本 = Table.Distinct(更改的类型, {"客服", "日期"})
in
    删除的副本
