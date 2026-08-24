let
    源 = Folder.Files("D:\麻大师\日更数据\天猫旗舰店\02-商品明细库存表\淘宝\订单"),
    筛选的隐藏文件1 = Table.SelectRows(源, each [Attributes]?[Hidden]? <> true),
    调用自定义函数1 = Table.AddColumn(筛选的隐藏文件1, "转换文件 (52)", each #"转换文件 (52)"([Content])),
    重命名的列1 = Table.RenameColumns(调用自定义函数1, {"Name", "Source.Name"}),
    删除的其他列1 = Table.SelectColumns(重命名的列1, {"Source.Name", "转换文件 (52)"}),
    扩展的表格列1 = Table.ExpandTableColumn(删除的其他列1, "转换文件 (52)", Table.ColumnNames(#"转换文件 (52)"(#"示例文件 (52)"))),
    更改的类型 = Table.TransformColumnTypes(扩展的表格列1,{{"Source.Name", type text}, {"子订单编号", type text}, {"主订单编号", type text}, {"商品标题", type text}, {"商品价格", Int64.Type}, {"购买数量", Int64.Type}, {"外部系统编号", type text}, {"商品属性", type text}, {"套餐信息", type any}, {"联系方式备注", type text}, {"订单状态", type text}, {"商家编码", type text}, {"支付单号", type number}, {"买家应付货款", type number}, {"买家实付金额", type number}, {"退款状态", type text}, {"退款金额", type text}, {"订单创建时间", type datetime}, {"订单付款时间", type datetime}, {"淘鲜达渠道", type text}, {"商品ID", Int64.Type}, {"分阶段信息", type any}, {"备注标签", type any}, {"商家备注", type text}, {"主订单买家留言", type text}, {"发货时间", type datetime}, {"物流单号", type text}, {"物流公司", type text}, {"是否主动赔付", type text}, {"主动赔付金额", type any}, {"主动赔付出账时间", type any}, {"应发货时间", type text}, {"飞猪购订单信息", type any}, {"百亿补贴超链订单信息", type any}}),
    合并的查询1 = Table.NestedJoin(更改的类型, {"主订单编号"}, #"店透视-订单分析", {"订单号"}, "旗帜", JoinKind.LeftOuter),
    #"展开的“旗帜”" = Table.ExpandTableColumn(合并的查询1, "旗帜", {"旗帜颜色", "插旗订单信息"}, {"旗帜颜色", "插旗订单信息"}),
    追加的查询 = Table.Combine({#"展开的“旗帜”", 京东pop, 抖音订单, 京东自营}),
    更改的类型1 = Table.TransformColumnTypes(追加的查询,{{"商家编码", type text}, {"订单付款时间", type date}}),
    替换的值 = Table.ReplaceValue(更改的类型1,".xlsx","",Replacer.ReplaceText,{"Source.Name"}),
    替换的值1 = Table.ReplaceValue(替换的值,".csv","",Replacer.ReplaceText,{"Source.Name"}),
    // 添加处理后的列
    添加应发货处理列 = Table.AddColumn(替换的值1, "处理后的发货时间", each 
        let
            平台 = [Source.Name],
            原时间 = [应发货时间]
        in
            if 平台 = "淘宝" or 平台 = "京东" then 
                Text.Replace(原时间, "前", "")
            else if 平台 = "京东自营" then 
                let
                    // 只保留数字、空格、冒号、横杠、斜杠、点号
                    保留字符 = Text.Select(原时间, {"0".."9", " ", ":", "-", "/", "."}),
                    // 清理多余空格
                    清理空格 = Text.Trim(保留字符)
                in
                    清理空格
            else 
                原时间
    ),
    // 删除原列并重命名
    删除原列 = Table.RemoveColumns(添加应发货处理列, {"应发货时间"}),
    重命名 = Table.RenameColumns(删除原列, {{"处理后的发货时间", "应发货时间"}}),
    更改类型 = Table.TransformColumnTypes(重命名, {{"应发货时间", type datetime}}),
    替换的值2 = Table.ReplaceValue(更改类型,"色","",Replacer.ReplaceText,{"旗帜颜色"}),
    // 步骤3：添加简单的测试列
    测试小时列 = Table.AddColumn(替换的值2, "测试小时", each Time.Hour([应发货时间])),
    
    // 步骤4：添加日期部分列
    测试日期列 = Table.AddColumn(测试小时列, "测试日期", each Date.From([应发货时间])),
    // 步骤5：最后添加条件列
    最终结果 = Table.AddColumn(测试日期列, "调整后应发货日期", 
        each if [测试小时] < 19
            then Date.AddDays([测试日期], -1)
            else [测试日期]),
    更改的类型5 = Table.TransformColumnTypes(最终结果,{{"调整后应发货日期", type date}}),
    合并的查询 = Table.NestedJoin(更改的类型5, {"订单状态"}, 订单状态对应表, {"订单状态（原始）"}, "订单状态对应表", JoinKind.LeftOuter),
    #"展开的“订单状态对应表”" = Table.ExpandTableColumn(合并的查询, "订单状态对应表", {"订单状态1"}, {"订单状态1"}),
    筛选的行 = Table.SelectRows(#"展开的“订单状态对应表”", each ([订单状态1] <> "关闭" and [订单状态1] <> "待付款")), 
    订单信息打标_自定义函数= Table.AddColumn(筛选的行, "订单状态2", each 商家备注打标([商家备注],[订单状态1])),
    重命名的列2 = Table.RenameColumns(订单信息打标_自定义函数,{{"Source.Name", "渠道平台"}}),
    筛选的行1 = Table.SelectRows(重命名的列2, each not Text.Contains([商品标题], "0.01元锁定") and not Text.Contains([商品标题], "小样") and not Text.Contains([商品标题], "差价") and [商家编码] <> null),
    添加发货超时列 = Table.AddColumn(筛选的行1, "发货状态", each if [发货时间] = null then
    "无发货时间"
else if [应发货时间] = null then
    "无应发货时间"
else if [应发货时间] < [发货时间] then
    "超时发货"
else
    "按时发货"),
    重命名的列3 = Table.RenameColumns(添加发货超时列,{{"物流单号", "平台物流单号"}, {"测试日期", "应发日期"}}),
    替换的值3 = Table.ReplaceValue(重命名的列3,"#(tab)","",Replacer.ReplaceText,{"商家编码"}),
    替换的值4 = Table.ReplaceValue(替换的值3,"#(tab)","",Replacer.ReplaceText,{"主订单编号"}),
    筛选的行2 = Table.SelectRows(替换的值4, each not Text.Contains([商品标题], "补定制")),
    筛选的行3 = Table.SelectRows(筛选的行2, each not Text.Contains([商品标题], "特权定金")),
    删除的副本 = Table.Distinct(筛选的行3, {"渠道平台", "子订单编号", "主订单编号", "商品标题", "商品价格", "购买数量", "外部系统编号", "商品属性", "套餐信息", "联系方式备注", "订单状态", "商家编码", "支付单号", "买家应付货款", "买家实付金额", "退款状态", "退款金额", "订单创建时间", "订单付款时间"}),
    已添加条件列 = Table.AddColumn(删除的副本, "商家编码换", each if [商家编码] = "" then "无商家编码" else [商家编码]),
    删除的列 = Table.RemoveColumns(已添加条件列,{"商家编码"}),
    重命名的列 = Table.RenameColumns(删除的列,{{"商家编码换", "商家编码"}}),
    筛选的行4 = Table.SelectRows(重命名的列, each not Text.Contains([商品标题], "送装一体"))
in
    筛选的行4