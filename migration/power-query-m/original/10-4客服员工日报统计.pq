let
    源 = Folder.Files("D:\麻大师\日更数据\天猫旗舰店\10-2京东客服绩效明细\客服员工日报统计"),
    筛选的隐藏文件1 = Table.SelectRows(源, each [Attributes]?[Hidden]? <> true),
    调用自定义函数1 = Table.AddColumn(筛选的隐藏文件1, "转换文件 (40)", each #"转换文件 (40)"([Content])),
    重命名的列1 = Table.RenameColumns(调用自定义函数1, {"Name", "Source.Name"}),
    删除的其他列1 = Table.SelectColumns(重命名的列1, {"Source.Name", "转换文件 (40)"}),
    扩展的表格列1 = Table.ExpandTableColumn(删除的其他列1, "转换文件 (40)", Table.ColumnNames(#"转换文件 (40)"(#"示例文件 (40)"))),
    更改的类型2 = Table.TransformColumnTypes(扩展的表格列1,{{"非常满意", type number}, {"满意", type number}, {"不满意", type number}, {"非常不满意", type number}}),
    已添加自定义 = Table.AddColumn(更改的类型2, "好评量", each [非常满意]+[满意]),
    已添加自定义1 = Table.AddColumn(已添加自定义, "差评量", each [不满意]+[非常不满意]),
    追加的查询 = Table.Combine({已添加自定义1, 考勤数据}),
    更改的类型1 = Table.TransformColumnTypes(追加的查询,{{"好评量", type number}, {"差评量", type number}}),
    替换的值 = Table.ReplaceValue(更改的类型1,null,0,Replacer.ReplaceValue,{"Source.Name", "日期", "UID", "技能组", "服务商", "ERP", "咨询量", "接待量", "转出量", "转入量", "评价总数", "勋章评价", "非常满意", "满意", "一般", "不满意", "非常不满意", "评价率", "满意率", "不满意率", "一次性解决量", "一次性解决率", "4次以下会话数", "4- 10 次会话数", "10次以上会话数", "客户总消息数", "客服总消息数", "邀评数", "邀评率", "CPH时长", "会话时长", "首次应答时长", "留言分配量", "留言接待量", "留言响应率", "平均响应时间", "30s应答率", "好评量", "差评量", "工作时间段咨询量", "全天咨询量", "首次30s接待量", "首次30s应答率", "工作时间段无响应量", "新平均响应时间", "咨询差评率", "3分钟人工回复量", "3分钟回复率（客服维度-不含留言）"}),
    更改的类型 = Table.TransformColumnTypes(替换的值,{{"Source.Name", type text}, {"日期", type date}, {"UID", type text}, {"技能组", type text}, {"服务商", type text}, {"ERP", type any}, {"咨询量", Int64.Type}, {"接待量", Int64.Type}, {"转出量", Int64.Type}, {"转入量", Int64.Type}, {"评价总数", Int64.Type}, {"勋章评价", Int64.Type}, {"非常满意", Int64.Type}, {"满意", Int64.Type}, {"一般", Int64.Type}, {"不满意", Int64.Type}, {"非常不满意", Int64.Type}, {"评价率", type text}, {"满意率", type text}, {"不满意率", type text}, {"一次性解决量", type any}, {"一次性解决率", type any}, {"4次以下会话数", Int64.Type}, {"4- 10 次会话数", Int64.Type}, {"10次以上会话数", Int64.Type}, {"客户总消息数", Int64.Type}, {"客服总消息数", Int64.Type}, {"邀评数", Int64.Type}, {"邀评率", type text}, {"CPH时长", Int64.Type}, {"会话时长", type number}, {"首次应答时长", type number}, {"留言分配量", Int64.Type}, {"留言接待量", Int64.Type}, {"留言响应率", type text}, {"平均响应时间", type number}, {"30s应答率", Percentage.Type}}),
    删除的副本 = Table.Distinct(更改的类型, {"日期", "UID", "技能组", "服务商"})
in
    删除的副本
