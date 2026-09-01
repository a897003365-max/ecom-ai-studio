let
			    源 = Folder.Files("D:\麻大师\日更数据\天猫旗舰店\10-2京东客服绩效明细\接待数据"),
			    筛选的隐藏文件1 = Table.SelectRows(源, each [Attributes]?[Hidden]? <> true),
			    调用自定义函数1 = Table.AddColumn(筛选的隐藏文件1, "转换文件 (45)", each #"转换文件 (45)"([Content])),
			    重命名的列1 = Table.RenameColumns(调用自定义函数1, {"Name", "Source.Name"}),
			    删除的其他列1 = Table.SelectColumns(重命名的列1, {"Source.Name", "转换文件 (45)"}),
			    扩展的表格列1 = Table.ExpandTableColumn(删除的其他列1, "转换文件 (45)", Table.ColumnNames(#"转换文件 (45)"(#"示例文件 (45)"))),
			    更改的类型 = Table.TransformColumnTypes(扩展的表格列1,{{"Source.Name", type text}, {"客服", type text}, {"服务时长", type number}, {"咨询量", type number}, {"接待量", type number}, {"应答率", Percentage.Type}, {"30s应答率", Percentage.Type}, {"首次平均响应时间", type number}, {"平均响应时长", type number}, {"平均响应时长(新标)", type number}, {"平均会话时长", type number}, {"平均回复消息数", type number}, {"无响应量", Int64.Type}, {"3分钟回复率（客服维度-不含留言）", Percentage.Type}, {"邀评数", type number}, {"邀评率", Percentage.Type}, {"评价量", Int64.Type}, {"评价率", type text}, {"好评量", type number}, {"满意率", type text}, {"差评量", type number}, {"不满意率", type text}, {"一般评价量", Int64.Type}, {"咨询差评率", type number}, {"解决量", type number}, {"未解决量", type number}, {"解决率", type text}, {"留言回复量", type any}, {"留言分配量", type any}, {"留言接待量", type any}, {"留言响应率", type text}}),
			    筛选的行 = Table.SelectRows(更改的类型, each ([客服] <> null and [客服] <> "均值" and [客服] <> "总值")),
			    重命名的列 = Table.RenameColumns(筛选的行,{{"平均响应时长(新标)", "新平均响应时间"}, {"平均响应时长", "平均响应时间"}, {"应答率", "回复率"}})
			in
			    重命名的列

changedProperty = IsHidden
