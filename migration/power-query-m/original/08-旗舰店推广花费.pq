let
    源 = Folder.Files("D:\麻大师\日更数据\天猫旗舰店\08-旗舰店推广花费"),
    排序的行 = Table.Sort(源,{{"Name", Order.Descending}}),
    筛选的隐藏文件1 = Table.SelectRows(排序的行, each [Attributes]?[Hidden]? <> true),
    调用自定义函数1 = Table.AddColumn(筛选的隐藏文件1, "转换文件 (14)", each #"转换文件 (14)"([Content])),
    重命名的列1 = Table.RenameColumns(调用自定义函数1, {"Name", "Source.Name"}),
    删除的其他列1 = Table.SelectColumns(重命名的列1, {"Source.Name", "转换文件 (14)"}),
    扩展的表格列1 = Table.ExpandTableColumn(删除的其他列1, "转换文件 (14)", Table.ColumnNames(#"转换文件 (14)"(#"示例文件 (14)"))),
    更改的类型 = Table.TransformColumnTypes(扩展的表格列1,{{"Source.Name", type text}, {"日期", type date}, {"场景ID", Int64.Type}, {"场景名字", type text}, {"原二级场景ID", Int64.Type}, {"原二级场景名字", type text}, {"计划ID", Int64.Type}, {"计划名字", type text}, {"主体ID", Int64.Type}, {"主体类型", type text}, {"主体名称", type text}, {"展现量", Int64.Type}, {"点击量", Int64.Type}, {"花费", type number}, {"点击率", type number}, {"平均点击花费", type number}, {"千次展现花费", type number}, {"总预售成交金额", Int64.Type}, {"总预售成交笔数", Int64.Type}, {"直接预售成交金额", Int64.Type}, {"直接预售成交笔数", Int64.Type}, {"间接预售成交金额", Int64.Type}, {"间接预售成交笔数", Int64.Type}, {"直接成交金额", type number}, {"间接成交金额", type number}, {"总成交金额", type number}, {"总成交笔数", Int64.Type}, {"直接成交笔数", Int64.Type}, {"间接成交笔数", Int64.Type}, {"点击转化率", type number}, {"投入产出比", type number}, {"总成交成本", type number}, {"总购物车数", Int64.Type}, {"直接购物车数", Int64.Type}, {"间接购物车数", Int64.Type}, {"加购率", type number}, {"收藏宝贝数", Int64.Type}, {"收藏店铺数", Int64.Type}, {"店铺收藏成本", type number}, {"总收藏加购数", Int64.Type}, {"总收藏加购成本", type number}, {"宝贝收藏加购数", Int64.Type}, {"宝贝收藏加购成本", type number}, {"总收藏数", Int64.Type}, {"宝贝收藏成本", type number}, {"宝贝收藏率", type number}, {"加购成本", type number}, {"拍下订单笔数", Int64.Type}, {"拍下订单金额", Int64.Type}, {"直接收藏宝贝数", Int64.Type}, {"间接收藏宝贝数", Int64.Type}, {"优惠券领取量", Int64.Type}, {"购物金充值笔数", Int64.Type}, {"购物金充值金额", Int64.Type}, {"旺旺咨询量", Int64.Type}, {"引导访问量", Int64.Type}, {"引导访问人数", Int64.Type}, {"引导访问潜客数", Int64.Type}, {"引导访问潜客占比", type number}, {"入会率", type number}, {"入会量", Int64.Type}, {"引导访问率", type number}, {"深度访问量", Int64.Type}, {"平均访问页面数", Int64.Type}, {"成交新客数", Int64.Type}, {"成交新客占比", type number}, {"会员首购人数", Int64.Type}, {"会员成交金额", type number}, {"会员成交笔数", Int64.Type}, {"成交人数", Int64.Type}, {"人均成交笔数", Int64.Type}, {"人均成交金额", type number}, {"自然流量转化金额", Int64.Type}, {"自然流量曝光量", Int64.Type}, {"平台助推总成交", Int64.Type}, {"平台助推直接成交", Int64.Type}, {"平台助推点击", Int64.Type}}),
    追加的查询 = Table.Combine({更改的类型, #"11-旗舰店UD推广计划"}),
    重命名的列 = Table.RenameColumns(追加的查询,{{"主体ID", "商品ID"}}),
    替换的值 = Table.ReplaceValue(重命名的列,null,0,Replacer.ReplaceValue,{"Source.Name", "日期", "场景ID", "场景名字", "原二级场景ID", "原二级场景名字", "计划ID", "计划名字", "商品ID", "主体类型", "主体名称", "展现量", "点击量", "花费", "点击率", "平均点击花费", "千次展现花费", "总预售成交金额", "总预售成交笔数", "直接预售成交金额", "直接预售成交笔数", "间接预售成交金额", "间接预售成交笔数", "直接成交金额", "间接成交金额", "总成交金额", "总成交笔数", "直接成交笔数", "间接成交笔数", "点击转化率", "投入产出比", "总成交成本", "总购物车数", "直接购物车数", "间接购物车数", "加购率", "收藏宝贝数", "收藏店铺数", "店铺收藏成本", "总收藏加购数", "总收藏加购成本", "宝贝收藏加购数", "宝贝收藏加购成本", "总收藏数", "宝贝收藏成本", "宝贝收藏率", "加购成本", "拍下订单笔数", "拍下订单金额", "直接收藏宝贝数", "间接收藏宝贝数", "优惠券领取量", "购物金充值笔数", "购物金充值金额", "旺旺咨询量", "引导访问量", "引导访问人数", "引导访问潜客数", "引导访问潜客占比", "入会率", "入会量", "引导访问率", "深度访问量", "平均访问页面数", "成交新客数", "成交新客占比", "会员首购人数", "会员成交金额", "会员成交笔数", "成交人数", "人均成交笔数", "人均成交金额", "自然流量转化金额", "自然流量曝光量", "平台助推总成交", "平台助推直接成交", "平台助推点击"}),
    删除的副本 = Table.Distinct(替换的值, {"日期", "计划ID", "商品ID","场景名字"}),
    重命名的列2 = Table.RenameColumns(删除的副本,{{"点击率", "点击率（固定）"}, {"加购成本", "加购成本（固数）"}, {"花费", "花费（未含达人）"}, {"加购率", "加购率（固数）"}}),
    更改的类型1 = Table.TransformColumnTypes(重命名的列2,{{"日期", type date}, {"商品ID", type text}}),
    筛选结果 = Table.SelectRows(更改的类型1, each not (
        Text.Contains([Source.Name], "营销场景报表") and 
        List.Contains({"关键词推广", "人群推广", "货品全站推", "货品全站推广"}, [场景名字])
    )),
    已添加条件列 = Table.AddColumn(筛选结果, "商品ID新", each if [商品ID] = "0" then [场景名字] else [商品ID]),
    删除的列 = Table.RemoveColumns(已添加条件列,{"商品ID"}),
    重命名的列3 = Table.RenameColumns(删除的列,{{"商品ID新", "商品ID"}})
in
    重命名的列3
