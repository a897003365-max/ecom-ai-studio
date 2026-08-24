let
    源 = Folder.Files("D:\麻大师\日更数据\天猫旗舰店\02-商品明细库存表\抖音"),
    筛选的隐藏文件1 = Table.SelectRows(源, each [Attributes]?[Hidden]? <> true),
    调用自定义函数1 = Table.AddColumn(筛选的隐藏文件1, "转换文件 (8)", each #"转换文件 (8)"([Content])),
    重命名的列1 = Table.RenameColumns(调用自定义函数1, {"Name", "Source.Name"}),
    删除的其他列1 = Table.SelectColumns(重命名的列1, {"Source.Name", "转换文件 (8)"}),
    扩展的表格列1 = Table.ExpandTableColumn(删除的其他列1, "转换文件 (8)", Table.ColumnNames(#"转换文件 (8)"(#"示例文件 (8)"))),
    更改的类型 = Table.TransformColumnTypes(扩展的表格列1,{{"Source.Name", type text}, {"主订单编号", type text}, {"子订单编号", type text}, {"选购商品", type text}, {"商品规格", type text}, {"商品数量", Int64.Type}, {"商品ID", Int64.Type}, {"商家编码", type text}, {"商品单价", type number}, {"订单应付金额", type number}, {"运费", Int64.Type}, {"优惠总金额", type number}, {"平台优惠", type text}, {"商家优惠", type text}, {"达人优惠", type text}, {"商家改价", Int64.Type}, {"支付优惠", type number}, {"红包抵扣", type number}, {"支付方式", type text}, {"手续费", Int64.Type}, {"收件人", type text}, {"收件人手机号", type text}, {"省", type text}, {"市", type text}, {"区", type text}, {"街道", type text}, {"详细地址", type text}, {"是否修改过地址", type text}, {"买家留言", type any}, {"订单提交时间", type datetime}, {"旗帜颜色", type text}, {"商家备注", type text}, {"订单完成时间", type any}, {"支付完成时间", type datetime}, {"APP渠道", type text}, {"流量来源", type text}, {"订单状态", type text}, {"承诺发货时间", type datetime}, {"订单类型", type text}, {"鲁班落地页ID", Int64.Type}, {"达人ID", Int64.Type}, {"达人昵称", type text}, {"所属门店ID", type text}, {"售后状态", type text}, {"取消原因", type text}, {"预约发货时间", type text}, {"仓库ID", type text}, {"仓库名称", type text}, {"是否安心购", type text}, {"广告渠道", type text}, {"流量类型", type text}, {"流量体裁", type text}, {"流量渠道", type text}, {"发货主体", type text}, {"发货主体明细", type text}, {"发货时间", type datetime}, {"降价类优惠", Int64.Type}, {"平台实际承担优惠金额", type number}, {"商家实际承担优惠金额", type number}, {"达人实际承担优惠金额", Int64.Type}, {"预计送达时间", type any}, {"是否平台仓自流转", type text}, {"车型", type any}, {"商品69码", type any}, {"发货SN码", type any}, {"发货IMEI码1", type any}, {"发货IMEI码2", type any}, {"是否福袋订单", type text}, {"福袋采购订单号", type any}, {"福袋采购订单状态", type any}, {"福袋采购订单采购方ID", type any}, {"福袋采购订单采购方名称", type any}, {"福袋采购订单创建时间", type any}, {"福袋采购订单支付时间", type any}, {"福袋采购订单订单应付金额", type any}, {"福袋采购订单订单实际付款金额", type any}, {"福袋采购订单订单优惠金额", type any}, {"福袋采购订单商品ID", type any}, {"福袋采购订单商品名称", type any}, {"福袋采购订单商品单价", type any}, {"福袋采购订单商品数量", type any}, {"福袋采购订单核销数量", type any}, {"福袋采购订单结算数量", type any}, {"预约送达时间", type text}, {"建议发货时间（起）", type text}, {"建议发货时间（止）", type text}, {"物流SN码", type any}, {"物流IMEI码1", type any}, {"物流IMEI码2", type any}}),
    重命名的列 = Table.RenameColumns(更改的类型,{{"选购商品", "商品标题"}, {"商品数量", "购买数量"}, {"订单应付金额", "买家应付货款"}, {"支付完成时间", "订单付款时间"}, {"承诺发货时间", "应发货时间"}}),
    替换的值 = Table.ReplaceValue(重命名的列,"#(tab)","",Replacer.ReplaceText,{"商家编码"}),
    合并的查询 = Table.NestedJoin(替换的值, {"商家编码"}, 商家编码修正, {"原编码"}, "商家编码修正", JoinKind.LeftOuter),
    #"展开的“商家编码修正”" = Table.ExpandTableColumn(合并的查询, "商家编码修正", {"新编码"}, {"新编码"}),
    已添加条件列 = Table.AddColumn(#"展开的“商家编码修正”", "商家编码改", each if [新编码] = null then [商家编码] else [新编码]),
    删除的列 = Table.RemoveColumns(已添加条件列,{"商家编码", "新编码"}),
    重命名的列2 = Table.RenameColumns(删除的列,{{"商家编码改", "商家编码"}}),
    替换的值1 = Table.ReplaceValue(重命名的列2,"#(tab)","",Replacer.ReplaceText,{"主订单编号"}),
    替换的值2 = Table.ReplaceValue(替换的值1,"#(tab)","",Replacer.ReplaceText,{"子订单编号"})
in
    替换的值2