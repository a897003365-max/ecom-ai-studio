let
    源 = Folder.Files("D:\麻大师\日更数据\天猫旗舰店\10-2京东客服绩效明细\绩效数据"),
    筛选的隐藏文件2 = Table.SelectRows(源, each [Attributes]?[Hidden]? <> true),
    调用自定义函数2 = Table.AddColumn(筛选的隐藏文件2, "转换文件 (42)", each #"转换文件 (42)"([Content])),
    重命名的列2 = Table.RenameColumns(调用自定义函数2, {"Name", "Source.Name"}),
    删除的其他列2 = Table.SelectColumns(重命名的列2, {"Source.Name", "转换文件 (42)"}),
    扩展的表格列2 = Table.ExpandTableColumn(删除的其他列2, "转换文件 (42)", Table.ColumnNames(#"转换文件 (42)"(#"示例文件 (42)"))),
    更改的类型1 = Table.TransformColumnTypes(扩展的表格列2,{{"Source.Name", type text}, {"客服", type any}, {"售前接待人数", type number}, {"促成下单人数", type number}, {"促成出库人数", type any}, {"促成下单订单数", type any}, {"促成出库订单数", type any}, {"促成下单商品数", type any}, {"促成出库商品数", type any}, {"促成下单商品金额", type any}, {"促成出库商品金额", type any}}),
    筛选的行 = Table.SelectRows(更改的类型1, each ([客服] <> "均值" and [客服] <> "总值")),
    已添加自定义 = Table.AddColumn(筛选的行, "售前咨询-下单转化率", each [促成下单人数]/[售前接待人数]),
    追加的查询 = Table.Combine({已添加自定义, 营销数据, 营销数据改版}),
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
    更改的类型 = Table.TransformColumnTypes(ExtractDate,{{"促成下单商品金额", type number}, {"促成下单人数", Int64.Type}, {"售前接待人数", type number}, {"日期", type date}, {"售前咨询-下单转化率", Percentage.Type}}),
    删除的副本 = Table.Distinct(更改的类型, {"客服", "日期"})
in
    删除的副本
