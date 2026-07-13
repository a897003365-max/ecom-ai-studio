let
    源 = Folder.Files("D:\麻大师\日更数据\天猫旗舰店\10-1淘宝客服绩效明细\自制报表"),
    筛选的隐藏文件1 = Table.SelectRows(源, each [Attributes]?[Hidden]? <> true),
    调用自定义函数1 = Table.AddColumn(筛选的隐藏文件1, "转换文件 (37)", each #"转换文件 (37)"([Content])),
    重命名的列1 = Table.RenameColumns(调用自定义函数1, {"Name", "Source.Name"}),
    删除的其他列1 = Table.SelectColumns(重命名的列1, {"Source.Name", "转换文件 (37)"}),
    扩展的表格列1 = Table.ExpandTableColumn(删除的其他列1, "转换文件 (37)", Table.ColumnNames(#"转换文件 (37)"(#"示例文件 (37)"))),
    更改的类型 = Table.TransformColumnTypes(扩展的表格列1,{{"Source.Name", type text}, {"旺旺昵称", type text}, {"客服主动跟进人数", Int64.Type}, {"有效接待人数", Int64.Type}, {"销售人数", Int64.Type}, {"询单最终付款转化率", type number}, {"客单价", type number}, {"净销售额", type number}, {"旺旺回复率", Int64.Type}, {"平均响应时长（秒)", type number}, {"答问比", type number}, {"平均接待时长", type text}, {"成功退款率", type number}, {"当日询单人数", Int64.Type}, {"下单最终付款人数", Int64.Type}, {"询单当日付款人数", Int64.Type}, {"客户满意率", type number}, {"平均上线时间", type time}, {"销售额", type number}, {"询单流失人数", Int64.Type}, {"下单当日付款转化率", type number}, {"首次响应时长（秒)", type number}, {"旺旺分组", type any}}),
    按分隔符拆分列 = Table.SplitColumn(更改的类型, "Source.Name", Splitter.SplitTextByDelimiter("_", QuoteStyle.Csv), {"Source.Name.1", "Source.Name.2", "Source.Name.3", "Source.Name.4"}),
    更改的类型1 = Table.TransformColumnTypes(按分隔符拆分列,{{"Source.Name.1", type text}, {"Source.Name.2", type date}, {"Source.Name.3", Int64.Type}, {"Source.Name.4", type text}}),
    筛选的行 = Table.SelectRows(更改的类型1, each ([旺旺昵称] <> "全店平均值" and [旺旺昵称] <> "全店汇总值" and [旺旺昵称] <> "同行同层优秀" and [旺旺昵称] <> "同行同层均值" and [旺旺昵称] <> "平均值" and [旺旺昵称] <> "汇总值")),
    删除的副本 = Table.Distinct(筛选的行, {"Source.Name.2", "旺旺昵称"}),
    替换的值 = Table.ReplaceValue(删除的副本,null,0,Replacer.ReplaceValue,{"Source.Name.1", "Source.Name.2", "Source.Name.3", "Source.Name.4", "旺旺昵称", "客服主动跟进人数", "有效接待人数", "销售人数", "询单最终付款转化率", "客单价", "净销售额", "旺旺回复率", "平均响应时长（秒)", "答问比", "平均接待时长", "成功退款率", "当日询单人数", "下单最终付款人数", "询单当日付款人数", "客户满意率", "平均上线时间", "销售额", "询单流失人数", "下单当日付款转化率", "首次响应时长（秒)", "旺旺分组"}),
    更改的类型2 = Table.TransformColumnTypes(替换的值,{{"平均接待时长", type time}, {"Source.Name.2", type date}, {"询单最终付款转化率", Percentage.Type}}),
    删除的副本1 = Table.Distinct(更改的类型2, {"Source.Name.2", "旺旺昵称", "净销售额", "客单价"}),
    筛选的行1 = Table.SelectRows(删除的副本1, each true),
    重命名的列 = Table.RenameColumns(筛选的行1,{{"答问比", "淘宝答问比"}, {"Source.Name.2", "日期"}})
in
    重命名的列
