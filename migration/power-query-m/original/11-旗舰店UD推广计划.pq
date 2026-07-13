let
    源 = Folder.Files("D:\麻大师\日更数据\天猫旗舰店\11-旗舰店UD推广计划"),
    筛选的隐藏文件1 = Table.SelectRows(源, each [Attributes]?[Hidden]? <> true),
    排序的行 = Table.Sort(筛选的隐藏文件1,{{"Date created", Order.Descending}}),
    调用自定义函数1 = Table.AddColumn(排序的行, "转换文件 (19)", each #"转换文件 (19)"([Content])),
    重命名的列1 = Table.RenameColumns(调用自定义函数1, {"Name", "Source.Name"}),
    删除的其他列1 = Table.SelectColumns(重命名的列1, {"Source.Name", "转换文件 (19)"}),
    扩展的表格列1 = Table.ExpandTableColumn(删除的其他列1, "转换文件 (19)", Table.ColumnNames(#"转换文件 (19)"(#"示例文件 (19)"))),
    更改的类型 = Table.TransformColumnTypes(扩展的表格列1,{{"Source.Name", type text}, {"日期", type date}, {"展现量", type number}, {"点击量", type number}, {"花费", type number}, {"点击率", type number}, {"平均点击花费", type number}, {"千次展现花费", type number}, {"总预售成交金额", type number}, {"总预售成交笔数", Int64.Type}, {"直接预售成交金额", Int64.Type}, {"直接预售成交笔数", Int64.Type}, {"间接预售成交金额", Int64.Type}, {"间接预售成交笔数", Int64.Type}, {"预售投入产出比", Int64.Type}, {"拍下订单金额", type number}, {"拍下订单笔数", Int64.Type}, {"总成交金额", type number}, {"总成交笔数", Int64.Type}, {" 订单成本", type number}, {"点击转化率", type number}, {"投入产出比", type number}, {"直接投入产出比", type number}, {"直接成交金额", Int64.Type}, {"直接成交笔数", Int64.Type}, {"间接成交金额", type number}, {"间接成交笔数", Int64.Type}, {"新客成交金额", type number}, {"新客成交笔数", Int64.Type}, {"新客订单成本", type number}, {"新客投入产出比", type number}, {"总购物车数", Int64.Type}, {"加购率", type number}, {"加购成本", type number}, {"直接加购成本", type number}, {"直接购物车数", Int64.Type}, {"间接购物车数", Int64.Type}, {"总收藏数", Int64.Type}, {"收藏成本", type number}, {"收藏宝贝数", Int64.Type}, {"收藏店铺数", Int64.Type}, {"引导访问", Int64.Type}, {"到达PV数", Int64.Type}, {"到达PV成本", type number}, {"到达UV数", Int64.Type}, {"到达UV成本", type number}}),
    已添加自定义 = Table.AddColumn(更改的类型, "场景名字", each "UD"),
    删除的副本 = Table.Distinct(已添加自定义, {"日期"})
in
    删除的副本
