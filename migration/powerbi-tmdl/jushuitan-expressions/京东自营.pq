let
    源 = Folder.Files("D:\麻大师\日更数据\天猫旗舰店\02-商品明细库存表\京东自营"),
    筛选的隐藏文件1 = Table.SelectRows(源, each [Attributes]?[Hidden]? <> true),
    调用自定义函数1 = Table.AddColumn(筛选的隐藏文件1, "转换文件 (57)", each #"转换文件 (57)"([Content])),
    重命名的列1 = Table.RenameColumns(调用自定义函数1, {"Name", "Source.Name"}),
    删除的其他列1 = Table.SelectColumns(重命名的列1, {"Source.Name", "转换文件 (57)"}),
    扩展的表格列1 = Table.ExpandTableColumn(删除的其他列1, "转换文件 (57)", Table.ColumnNames(#"转换文件 (57)"(#"示例文件 (57)"))),
    更改的类型 = Table.TransformColumnTypes(扩展的表格列1,{{"Source.Name", type text}, {"客户订单号", type text}, {"商品编码", Int64.Type}, {"品牌", type text}, {"商品名称", type text}, {"商品单价", Int64.Type}, {"采购价", type number}, {"采购单号", Int64.Type}, {"退货单号", type any}, {"购买数量", Int64.Type}, {"预计发货时间", type any}, {"商家仓ID", Int64.Type}, {"商家仓名称", type any}, {"订单备注", type text}, {"商家备注", type text}, {"父单号", Int64.Type}, {"支付方式", type text}, {"出库时间", type datetime}, {"下单时间", type datetime}, {"可出库时间", type datetime}, {"订单金额", Int64.Type}, {"用户支付金额", type number}, {"承运商", type text}, {"运单号", type text}, {"订单状态", type text}, {"订单完成时间", type datetime}, {"是否有退款申请", type text}, {"OU主体", type any}, {"订单类型", type text}, {"客户类型", type text}, {"KA订单发货需提供单据", type any}, {"KA订单客户收货要求", type any}, {"企配订单", type text}, {"预约订单", type text}, {"承诺发货时间", type text}, {"是否强制京配", type text}, {"货号", type any}, {"型号", type text}, {"销售单位", type any}}),
    重命名的列 = Table.RenameColumns(更改的类型,{{"商品编码", "商家编码"}, {"客户订单号", "主订单编号"}, {"商品名称", "商品标题"}, {"下单时间", "订单付款时间"}, {"用户支付金额", "买家应付货款"}, {"承诺发货时间", "应发货时间"}})
in
    重命名的列