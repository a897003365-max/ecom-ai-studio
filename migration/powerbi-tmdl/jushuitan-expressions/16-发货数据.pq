let
    源 = Folder.Files("D:\麻大师\日更数据\天猫旗舰店\16-发货数据"),
    筛选的隐藏文件1 = Table.SelectRows(源, each [Attributes]?[Hidden]? <> true),
    调用自定义函数1 = Table.AddColumn(筛选的隐藏文件1, "转换文件 (6)", each #"转换文件 (6)"([Content])),
    重命名的列1 = Table.RenameColumns(调用自定义函数1, {"Name", "Source.Name"}),
    删除的其他列1 = Table.SelectColumns(重命名的列1, {"Source.Name", "转换文件 (6)"}),
    扩展的表格列1 = Table.ExpandTableColumn(删除的其他列1, "转换文件 (6)", Table.ColumnNames(#"转换文件 (6)"(#"示例文件 (6)"))),
    重命名的列 = Table.RenameColumns(扩展的表格列1,{{"商店站点", "渠道平台"}}),
    替换的值 = Table.ReplaceValue(重命名的列,"头条放心购","抖音",Replacer.ReplaceText,{"渠道平台"}),
    替换的值1 = Table.ReplaceValue(替换的值,"京东厂家直送","京东自营",Replacer.ReplaceText,{"渠道平台"}),
    替换的值2 = Table.ReplaceValue(替换的值1,"京东商城","京东POP",Replacer.ReplaceText,{"渠道平台"}),
    筛选的行 = Table.SelectRows(替换的值2, each ([商品简称] <> null)),
    筛选的行1 = Table.SelectRows(筛选的行, each not Text.Contains([商品简称], "补")),
    筛选的行2 = Table.SelectRows(筛选的行1, each not Text.Contains([商品简称], "差")),
    替换的值3 = Table.ReplaceValue(筛选的行2,null,"灰色旗帜",Replacer.ReplaceValue,{"小旗"}),
    已添加条件列 = Table.AddColumn(替换的值3, "订单状态2", each if [售后分类] = "仅退款" then "交易关闭（仅退款）" else if [售后分类] = "普通退货" then "交易关闭（退货退款）" else if Text.Contains([小旗], "紫") then "等通知" else if [订单状态] = "异常" then "待发货" else if Text.Contains([订单状态], "等供销") then "待发货" else [订单状态]),
    更改的类型 = Table.TransformColumnTypes(已添加条件列,{{"销售金额", type number}, {"实发金额", type number}, {"销售数量", type number}, {"发货日期", type datetime}}),
    更改的类型1 = Table.TransformColumnTypes(更改的类型,{{"发货日期", type date}})
in
    更改的类型1