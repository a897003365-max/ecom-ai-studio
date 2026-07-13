let
			    源 = Folder.Files("D:\麻大师\日更数据\天猫旗舰店\10-2京东客服绩效明细\营销数据"),
			    筛选的隐藏文件1 = Table.SelectRows(源, each [Attributes]?[Hidden]? <> true),
			    调用自定义函数1 = Table.AddColumn(筛选的隐藏文件1, "转换文件 (46)", each #"转换文件 (46)"([Content])),
			    重命名的列1 = Table.RenameColumns(调用自定义函数1, {"Name", "Source.Name"}),
			    删除的其他列1 = Table.SelectColumns(重命名的列1, {"Source.Name", "转换文件 (46)"}),
			    扩展的表格列1 = Table.ExpandTableColumn(删除的其他列1, "转换文件 (46)", Table.ColumnNames(#"转换文件 (46)"(#"示例文件 (46)"))),
			    更改的类型 = Table.TransformColumnTypes(扩展的表格列1,{{"Source.Name", type text}, {"客服", type text}, {"售前接待人数", Int64.Type}, {"推荐人数", Int64.Type}, {"促成下单人数", Int64.Type}, {"促成下单订单数", Int64.Type}, {"促成下单商品数", Int64.Type}, {"促成下单商品金额", type number}, {"售前下单转化率", Percentage.Type}, {"促成下单商品均价", type number}, {"促成下单客单价（元/人）", type number}, {"促成下单客件数（件/人）", type number}}),
			    筛选的行 = Table.SelectRows(更改的类型, each ([客服] <> "均值" and [客服] <> "总值"))
			in
			    筛选的行

changedProperty = IsHidden
