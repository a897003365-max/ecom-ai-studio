let
    源 = Folder.Files("D:\麻大师\日更数据\天猫旗舰店\06-旗舰店流量数据"),
    筛选的隐藏文件1 = Table.SelectRows(源, each [Attributes]?[Hidden]? <> true),
    调用自定义函数1 = Table.AddColumn(筛选的隐藏文件1, "转换文件 (21)", each #"转换文件 (21)"([Content])),
    重命名的列1 = Table.RenameColumns(调用自定义函数1, {"Name", "Source.Name"}),
    删除的其他列1 = Table.SelectColumns(重命名的列1, {"Source.Name", "转换文件 (21)"}),
    扩展的表格列1 = Table.ExpandTableColumn(删除的其他列1, "转换文件 (21)", Table.ColumnNames(#"转换文件 (21)"(#"示例文件 (21)"))),
    更改的类型 = Table.TransformColumnTypes(扩展的表格列1,{{"Source.Name", type text}, {"流量载体", type text}, {"一级来源", type text}, {"二级来源", type text}, {"三级来源", type text}, {"访客数", Int64.Type}, {"访客数环比", Percentage.Type}, {"新访客", Int64.Type}, {"新访客环比", Percentage.Type}, {"平均停留时长", type number}, {"平均停留时长环比", type text}, {"3s查看人数", Int64.Type}, {"3s查看人数环比", type text}, {"商品点击人数", Int64.Type}, {"商品点击人数环比", type text}, {"加购人数", Int64.Type}, {"加购人数环比", Percentage.Type}, {"商品收藏人数", Int64.Type}, {"商品收藏人数环比", Percentage.Type}, {"加购件数", type text}, {"加购件数环比", Percentage.Type}, {"关注店铺人数", Int64.Type}, {"关注店铺人数环比", type text}, {"支付买家数", Int64.Type}, {"支付买家数环比", Percentage.Type}, {"支付转化率", Percentage.Type}, {"支付转化率环比", Percentage.Type}, {"支付金额", type number}, {"支付金额环比", Percentage.Type}, {"客单价", type number}, {"客单价环比", Percentage.Type}, {"UV价值", type number}, {"uv价值环比", Percentage.Type}, {"数据日期", type date}}),
    已替换的错误1 = Table.ReplaceErrorValues(更改的类型, {{"Source.Name", 0}, {"流量载体", 0}, {"一级来源", 0}, {"二级来源", 0}, {"三级来源", 0}, {"访客数", 0}, {"访客数环比", 0}, {"新访客", 0}, {"新访客环比", 0}, {"平均停留时长", 0}, {"平均停留时长环比", 0}, {"3s查看人数", 0}, {"3s查看人数环比", 0}, {"商品点击人数", 0}, {"商品点击人数环比", 0}, {"加购人数", 0}, {"加购人数环比", 0}, {"商品收藏人数", 0}, {"商品收藏人数环比", 0}, {"加购件数", 0}, {"加购件数环比", 0}, {"关注店铺人数", 0}, {"关注店铺人数环比", 0}, {"支付买家数", 0}, {"支付买家数环比", 0}, {"支付转化率", 0}, {"支付转化率环比", 0}, {"支付金额", 0}, {"支付金额环比", 0}, {"客单价", 0}, {"客单价环比", 0}, {"UV价值", 0}, {"uv价值环比", 0}, {"数据日期", 0}}),
    重命名的列 = Table.RenameColumns(已替换的错误1,{{"数据日期", "日期"}}),
    筛选的行 = Table.SelectRows(重命名的列, each ([三级来源] <> "汇总"))
in
    筛选的行
