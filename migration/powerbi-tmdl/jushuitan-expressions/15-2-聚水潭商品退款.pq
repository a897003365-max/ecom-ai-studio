let
    源 = Folder.Files("D:\麻大师\日更数据\天猫旗舰店\15-2-聚水潭商品退款"),
    筛选的隐藏文件1 = Table.SelectRows(源, each [Attributes]?[Hidden]? <> true),
    调用自定义函数1 = Table.AddColumn(筛选的隐藏文件1, "转换文件 (10)", each #"转换文件 (10)"([Content])),
    重命名的列1 = Table.RenameColumns(调用自定义函数1, {"Name", "Source.Name"}),
    删除的其他列1 = Table.SelectColumns(重命名的列1, {"Source.Name", "转换文件 (10)"}),
    扩展的表格列1 = Table.ExpandTableColumn(删除的其他列1, "转换文件 (10)", Table.ColumnNames(#"转换文件 (10)"(#"示例文件 (10)"))),
    更改的类型 = Table.TransformColumnTypes(扩展的表格列1,{{"Source.Name", type text}, {"售后单号", Int64.Type}, {"内部订单号", Int64.Type}, {"登记时间", type datetime}, {"申请日期", type datetime}, {"线上类型", type text}, {"售后分类", type text}, {"买家帐号", type text}, {"收货人", type text}, {"线上申请金额", type number}, {"线上退运费", Int64.Type}, {"优惠/差额", type number}, {"卖家应退金额", type number}, {"买家应补偿金额", Int64.Type}, {"卖家应退运费", Int64.Type}, {"实际应退金额", type number}, {"买家退款账号", type any}, {"卖家退款账号", type any}, {" 收货仓", type any}, {"仓库", type text}, {"店铺编号", Int64.Type}, {"店铺名称", type text}, {"线上订单号", type text}, {"问题类型", type text}, {"原订单状态", type text}, {"原订单类型", type text}, {"备注", type text}, {"处理结果", type any}, {"售后问题登记(线下备注)", type text}, {"状态", type text}, {"线上状态", type text}, {"货物状态", type text}, {"最后确认日期", type datetime}, {"最后修改日期", type datetime}, {"修改人", type text}, {"创建人", type text}, {"退回快递公司", type text}, {"退回快递单号(运单号)", type text}, {"订单发货时间", type datetime}, {"退款编码", type text}, {"售后问题登记(图片)", type any}, {"币种", type any}, {"售后异常", type any}, {"外部单号", type any}, {"退货物流状态", type text}, {"退货签收时间", type any}, {"快递拦截状态", type text}, {"拦截失败原因", type any}, {"快递拦截时间", type any}, {"仲裁状态", type text}, {"营收小计-商家实收", type number}, {"营收小计-买家实付", type number}, {"营收小计-平台补贴", type number}, {"营收小计-政府补贴", type number}, {"图片", type text}, {"商品编码", type text}, {"款式编码", type text}, {"线上子订单编号", type text}, {"申请数量", Int64.Type}, {"实退数量", Int64.Type}, {"单价", type number}, {"申请金额", type number}, {"商品名", type text}, {"类型", type text}, {"明细问题类型", type any}, {"颜色规格", type text}, {"进仓时间", type any}, {"明细备注", type any}, {"次品数量", Int64.Type}, {"成本价", Int64.Type}, {"商品品牌", type text}, {"原始订单号", type text}, {"达人ID", Int64.Type}, {"达人名称", type text}, {"商品标签", type any}, {"分类", type any}, {"供应商商品款号", type any}, {"供应商商品编码", type any}, {"简称", type any}, {"国标码", type any}, {"其它价格1", Int64.Type}, {"其它价格2", Int64.Type}, {"其它价格3", Int64.Type}, {"其它价格4", Int64.Type}, {"其它属性1", type any}, {"其它属性2", type any}, {"其它属性3", type any}, {"其它属性4", type any}, {"其它属性5", type any}, {"原订单旗帜", type text}, {"原订单备注", type text}, {"原订单标签", type text}, {"原订单便签｜线下备注", type text}, {"原订单下单金额", type number}, {"原订单买家留言", type text}, {"原订单业务员", type text}, {"订单日期", type datetime}, {"订单支付日期", type datetime}, {"原订单快递", type text}, {"原订单快递单号", type text}, {"原订单发货仓库", type text}, {"原订单收货国家", type text}}),
    合并的查询 = Table.NestedJoin(更改的类型, {"店铺名称"}, 店铺名称对应表, {"店铺"}, "店铺名称对应表", JoinKind.LeftOuter),
    #"展开的“店铺名称对应表”" = Table.ExpandTableColumn(合并的查询, "店铺名称对应表", {"店铺简称"}, {"店铺简称"}),
    按分隔符拆分列1 = Table.SplitColumn(Table.TransformColumnTypes(#"展开的“店铺名称对应表”", {{"最后确认日期", type text}}, "zh-CN"), "最后确认日期", Splitter.SplitTextByEachDelimiter({" "}, QuoteStyle.Csv, false), {"最后确认日期.1", "最后确认日期.2"}),
    重命名的列2 = Table.RenameColumns(按分隔符拆分列1,{{"最后确认日期.1", "最后确认日期"}}),
    更改的类型2 = Table.TransformColumnTypes(重命名的列2,{{"最后确认日期", type date}}),
    按分隔符拆分列 = Table.SplitColumn(Table.TransformColumnTypes(更改的类型2, {{"订单支付日期", type text}}, "zh-CN"), "订单支付日期", Splitter.SplitTextByEachDelimiter({" "}, QuoteStyle.Csv, false), {"订单支付日期.1", "订单支付日期.2"}),
    更改的类型1 = Table.TransformColumnTypes(按分隔符拆分列,{{"订单支付日期.1", type date}, {"订单支付日期.2", type time}}),
    重命名的列 = Table.RenameColumns(更改的类型1,{{"订单支付日期.1", "订单支付日期"}}),
    筛选的行 = Table.SelectRows(重命名的列, each ([店铺名称] <> "HAIMAZIYUE家具旗舰店-周飞-京7" and [店铺名称] <> "伊凯琳家具旗舰店-周飞-猫1" and [店铺名称] <> "艾美悦旗舰店-周飞-猫8")),
    合并的查询1 = Table.NestedJoin(筛选的行, {"商品编码"}, #"辅10-产品编码", {"商家规编（后台）"}, "辅10-产品编码", JoinKind.LeftOuter),
    #"展开的“辅10-产品编码”" = Table.ExpandTableColumn(合并的查询1, "辅10-产品编码", {"产品名称", "子名称", "SPU产品商编", "商品ID", "规格名称（工厂看）"}, {"产品名称", "子名称", "SPU产品商编", "商品ID", "规格名称（工厂看）"}),
    合并的查询2 = Table.NestedJoin(#"展开的“辅10-产品编码”", {"店铺简称"}, 渠道平台, {"店铺简称"}, "渠道平台", JoinKind.LeftOuter),
    #"展开的“渠道平台”" = Table.ExpandTableColumn(合并的查询2, "渠道平台", {"渠道平台"}, {"渠道平台.1"}),
    重命名的列3 = Table.RenameColumns(#"展开的“渠道平台”",{{"渠道平台.1", "渠道平台"}, {"营收小计-商家实收", "商家实收"}}),
    最终列排序 = Table.SelectColumns(重命名的列3, {"线上订单号", "线上子订单编号", "订单支付日期","售后分类","商家实收","卖家应退金额","商品ID","SPU产品商编", "产品名称", "子名称","颜色规格", "商品编码", "最后确认日期", "店铺简称", "渠道平台", "内部订单号"
    }),
    删除的副本 = Table.Distinct(最终列排序)
in
    删除的副本