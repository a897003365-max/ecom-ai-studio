let
    源 = Folder.Files("D:\麻大师\日更数据\天猫旗舰店\14-推广竞品数据"),
    筛选的隐藏文件1 = Table.SelectRows(源, each [Attributes]?[Hidden]? <> true),
    调用自定义函数1 = Table.AddColumn(筛选的隐藏文件1, "转换文件 (29)", each #"转换文件 (29)"([Content])),
    重命名的列1 = Table.RenameColumns(调用自定义函数1, {"Name", "Source.Name"}),
    删除的其他列1 = Table.SelectColumns(重命名的列1, {"Source.Name", "转换文件 (29)"}),
    扩展的表格列1 = Table.ExpandTableColumn(删除的其他列1, "转换文件 (29)", Table.ColumnNames(#"转换文件 (29)"(#"示例文件 (29)"))),
    更改的类型 = Table.TransformColumnTypes(扩展的表格列1,{{"Source.Name", type text}, {"消耗", type any}, {"展现量", type any}, {"点击量", type any}, {"收藏加购量", type any}, {"成交量", type any}, {"成交金额", type any}, {"ROI", type any}, {"收藏加购率", type any}, {"成交转化率", type any}, {"单次收加成本", type any}, {"单次点击成本", type any}, {"新增单个访问人群成本", type any}, {"新增单个兴趣人群成本", type any}, {"新增单个首购人群成本", type any}, {"新增单个复购人群成本", type any}, {"渠道", type text}, {"品牌", type text}, {"时间", type any}}),
    筛选的行 = Table.SelectRows(更改的类型, each ([渠道] <> null)),
    更改的类型1 = Table.TransformColumnTypes(筛选的行,{{"消耗", type number}, {"ROI", type number}, {"成交金额", type number}, {"成交量", type number}, {"收藏加购量", type number}, {"点击量", type number}, {"展现量", type number}, {"收藏加购率", Percentage.Type}, {"成交转化率", Percentage.Type}, {"单次收加成本", type number}, {"单次点击成本", type number}, {"新增单个访问人群成本", type number}, {"新增单个兴趣人群成本", type number}, {"新增单个首购人群成本", type number}, {"新增单个复购人群成本", type number}}),
    筛选的行1 = Table.SelectRows(更改的类型1, each ([渠道] <> "汇总")),
    删除的副本 = Table.Distinct(筛选的行1, {"时间", "品牌", "渠道","时间段"}),
    更改的类型2 = Table.TransformColumnTypes(删除的副本,{{"时间", type date}})
in
    更改的类型2
