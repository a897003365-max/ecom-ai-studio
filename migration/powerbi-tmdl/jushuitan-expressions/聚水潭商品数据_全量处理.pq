let
    // ==============================
    // 1. 缓冲所有辅助表
    // ==============================
    buff_京东自营商品表 = Table.Buffer(京东自营商品表),
    buff_辅10产品编码 = Table.Buffer(#"辅10-产品编码"),
    buff_线下 = Table.Buffer(线下),
    buff_店铺名称对应表 = Table.Buffer(店铺名称对应表),
    buff_日期辅助表 = Table.Buffer(#"01-店铺数据辅助表"),

    // ==============================
    // 2. 读取并合并所有文件
    // ==============================
    源 = Folder.Files("D:\麻大师\日更数据\天猫旗舰店\15-聚水潭商品数据"),
    隐藏文件已筛选 = Table.SelectRows(源, each [Attributes]?[Hidden]? <> true),
    已添加转换列 = Table.AddColumn(隐藏文件已筛选, "转换文件", each #"转换文件 (5)"([Content])),
    已删除其他列 = Table.SelectColumns(已添加转换列, {"Name", "转换文件"}),
    已重命名Name = Table.RenameColumns(已删除其他列, {{"Name", "Source.Name"}}),
    扩展文件内容 = Table.ExpandTableColumn(已重命名Name, "转换文件", Table.ColumnNames(#"转换文件 (5)"(#"示例文件 (5)"))),

    // ==============================
    // 3. 安全转换日期时间列
    // ==============================
    安全日期转换 = Table.TransformColumns(扩展文件内容, {
        {"付款日期", each if _ = null or _ = "" then null else try DateTime.FromText(_, [Culture="en-US"]) otherwise null, type nullable datetime},
        {"确认收货日期", each if _ = null or _ = "" then null else try DateTime.FromText(_, [Culture="en-US"]) otherwise null, type nullable datetime},
        {"发货日期", each if _ = null or _ = "" then null else try DateTime.FromText(_, [Culture="en-US"]) otherwise null, type nullable datetime},
        {"订单日期", each if _ = null or _ = "" then null else try DateTime.FromText(_, [Culture="en-US"]) otherwise null, type nullable datetime},
        {"供销支付时间", each if _ = null or _ = "" then null else try DateTime.FromText(_, [Culture="en-US"]) otherwise null, type nullable datetime}
    }),

    // ==============================
    // 4. 核心列类型转换
    // ==============================
    初始类型转换 = Table.TransformColumnTypes(安全日期转换, {
        {"付款日期", type date},
        {"商家实收", type number},
        {"销售数量", type number},
        {"销售金额", type number},
        {"销售毛利", type number},
        {"退货金额", type number},
        {"实退金额", type number},
        {"线上订单号", type text},
        {"买家ID", type text},
        {"原始线上订单号", type text},
        {"线上子订单编号", type text},
        {"买家实付", type number},
        {"店铺商品编码", type text},
        {"商品编码", type text},
        {"店铺款式编码", type text},
        {"款式编码", type text},
        {"线上商品名", type text},
        {"买家留言", type text}
    }),

    // ==============================
    // 5. 尽早筛选
    // ==============================
    仅普通订单 = Table.SelectRows(初始类型转换, each [订单类型] = "普通订单"),

    实付不低于50 = Table.SelectRows(仅普通订单, each 
        [买家实付] >= 50 
        or (
            [线上商品名] <> null 
            and Text.Contains(Text.From([线上商品名]), "0.01")
        )
    ),

    排除非麻大师店铺 = Table.SelectRows(实付不低于50, each 
        [店铺] <> "伊凯琳家具旗舰店-周飞-猫1" and 
        [店铺] <> "伊凯琳家居特卖旗舰店-周飞-唯1" and 
        [店铺] <> "艾美悦旗舰店-周飞-猫8"
    ),

    排除返修留言 = Table.SelectRows(排除非麻大师店铺, each [买家留言] = null or not Text.Contains([买家留言], "返修")),

    // ==============================
    // 6. 替换商店站点 → 重命名渠道平台
    // ==============================
    替换站点 = Table.TransformColumns(排除返修留言, {{"商店站点", each 
        if _ = null then null
        else 
            let
                s1 = Text.Replace(_, "头条放心购", "抖音"),
                s2 = Text.Replace(s1, "京东厂家直送", "京东自营"),
                s3 = Text.Replace(s2, "京东商城", "京东POP")
            in 
                s3,
        type nullable text
    }}),

    重命名渠道 = Table.RenameColumns(替换站点, {{"商店站点", "渠道平台"}}),

    // ==============================
    // 7. 合并自营 id 编码 → 条件替换商品编码
    // ==============================
    合并自营 = Table.NestedJoin(重命名渠道, {"店铺商品编码"}, buff_京东自营商品表, {"商品ID"}, "京东自营商品表", JoinKind.LeftOuter),
    展开自营 = Table.ExpandTableColumn(合并自营, "京东自营商品表", {"商家规编（后台）"}, {"自营商家规编"}),

    添加新商品编码 = Table.AddColumn(展开自营, "新商品编码", each 
        if [自营商家规编] = null then [商品编码] else [自营商家规编],
        type text
    ),

    删除旧商品编码 = Table.RemoveColumns(添加新商品编码, {"商品编码", "自营商家规编"}),
    重命名新商品编码 = Table.RenameColumns(删除旧商品编码, {{"新商品编码", "商品编码"}}),

    // ==============================
    // 8. 合并辅10-产品编码 → 获取产品属性
    // ==============================
    合并辅10 = Table.NestedJoin(重命名新商品编码, {"商品编码"}, buff_辅10产品编码, {"商家规编（后台）"}, "辅10-产品编码", JoinKind.LeftOuter),

    展开辅10 = Table.ExpandTableColumn(
        合并辅10,
        "辅10-产品编码",
        {"产品名称", "子名称", "SPU产品商编", "发货仓", "床垫类别", "厚度", "尺寸", "成本"},
        {"产品名称", "子名称", "SPU产品商编", "发货仓.1", "床垫类别", "厚度", "尺寸", "成本"}
    ),

    替换并转数字 = Table.TransformColumns(展开辅10, {{"成本", 
        each 
            let 
                txt = Text.From(_),
                result = if txt = "暂无" or txt = "/" then 0 else try Number.From(_) otherwise 0
            in 
                result,
        type number
    }}),

    // ==============================
    // 9. 手动将指定商品销售数量改为 0
    // ==============================
    添加新销售数量 = Table.AddColumn(替换并转数字, "新销售数量", each 
        let
            商品名 = [线上商品名],
            需置零 =
                if 商品名 = null then true
                else if Text.Contains(商品名, "礼品袋") then true
                else if Text.Contains(商品名, "差") then true
                else if List.Contains({
                    "0.01入会专拍链接",
                    "1",
                    "【3支-紫杆（黑）】【禾硕新5度+东米605刷题能量笔+知心k181】",
                    "【3支-蓝杆（黑）】【禾硕新5度+东米605刷题能量笔+知心k181】",
                    "入会专拍链接"
                }, 商品名) then true
                else if Text.Contains(商品名, "皮革") then true
                else if Text.Contains(商品名, "单拍不发货") then true
                else if Text.Contains(商品名, "0.01") then true
                else if Text.Contains(商品名, "链接") then true
                else if Text.Contains(商品名, "入会") then true
                else if Text.Contains(商品名, "袋子") then true
                else if Text.Contains(商品名, "小额收款") then true
                else if List.Contains({
                    "【优惠价】麻大师乳胶枕头泰国进口正品成人呵护颈椎家用睡眠宿舍橡胶枕芯",
                    "【优惠价】麻大师瑜伽茶道黄麻坐垫蒲团坐垫客厅阳台飘窗榻榻米日式坐垫",
                    "【特权定金】麻大师乳胶枕头泰国进口正品成人呵护颈椎家用睡眠宿舍橡胶枕芯",
                    "麻大师乳胶枕头泰国进口正品成人呵护颈椎家用睡眠宿舍橡胶枕芯",
                    "麻大师瑜伽茶道黄麻坐垫蒲团坐垫客厅阳台飘窗榻榻米日式坐垫",
                    "麻大师瑜伽茶道黄麻坐垫蒲团坐垫客厅阳台飘窗榻榻米日式坐垫 麻大师坐垫:6CM厚 34cm*40cm",
                    "麻大师瑜伽茶道黄麻坐垫蒲团坐垫客厅阳台飘窗榻榻米日式坐垫40cm*40cm 麻大师坐垫:6CM厚 40cm*40cm"
                }, 商品名) then true
                else if Text.Contains(商品名, "麻大师环保黄麻手提袋") then true
                else false
        in
            if 需置零 then 0 else [销售数量],
        Int64.Type
    ),

    删除原销售数量 = Table.RemoveColumns(添加新销售数量, {"销售数量"}),
    重命名新销售数量 = Table.RenameColumns(删除原销售数量, {{"新销售数量", "销售数量"}}),

    // ==============================
    // 10. 填充空值
    // ==============================
    填充空值 = Table.TransformColumns(重命名新销售数量, {
        {"小旗", each if _ = null then "灰色旗帜" else _, type text},
        {"标记多标签", each if _ = null then "无" else _, type text},
        {"卖家备注", each if _ = null then "" else _, type text}
    }),

    // ==============================
    // 11. 添加订单状态明细与汇总
    // ==============================
    添加订单状态明细 = Table.AddColumn(填充空值, "订单状态明细", each 
        if [售后分类] = "仅退款" then "交易关闭（仅退款）"
        else if [售后分类] = "普通退货" then "交易关闭（退货退款）"
        else if [发货日期] <> null then "已发货"
        else if [确认收货日期] <> null then "已收货"
        else if Text.Contains([小旗], "紫") then "等通知"
        else if Text.Contains([小旗], "黄") then "指定日"
        else if [订单状态] = "异常" or Text.Contains(Text.From([订单状态]), "等供销") or Text.Contains(Text.From([订单状态]), "发货中") or Text.Contains(Text.From([订单状态]), "已付款待审核") then "待发货"
        else if [付款日期] = null then "未付款"
        else [订单状态],
        type text
    ),

    修正已取消 = Table.ReplaceValue(添加订单状态明细, "已取消", "交易关闭（仅退款）", Replacer.ReplaceText, {"订单状态明细"}),

    添加状态汇总 = Table.AddColumn(修正已取消, "订单状态汇总", each 
        if [订单状态明细] = "待发货" or [订单状态明细] = "等通知" or [订单状态明细] = "指定日" then "待发"
        else if [订单状态明细] = "已发货" or [订单状态明细] = "已收货" then "已发"
        else "未付款或交易关闭",
        type text
    ),

    // ==============================
    // 12. 是否定制
    // ==============================
    添加是否定制 = Table.AddColumn(添加状态汇总, "是否定制", each 
        let 
            备注 = [卖家备注]
        in 
            if Text.Contains(备注, "定制") or
               Text.Contains(备注, "厚度") or
               Text.Contains(备注, "订制") or
               Text.Contains(备注, "特殊") or
               Text.Contains(备注, "横折") or
               Text.Contains(备注, "竖折") or
               Text.Contains(备注, "折叠") or
               Text.Contains(备注, "对角") or
               Text.Contains(备注, "对折") 
            then "定制"
            else "常规",
        type text
    ),
    添加备注标签 = Table.AddColumn(添加是否定制, "定制备注标签", each
    let
        备注 = if [卖家备注] = null then "" else Text.From([卖家备注])
    in
        if Text.Contains(备注, "定制尺寸/缺角/折叠/内材") 
           or Text.Contains(备注, "定制异形") then "定制异形"
        else if Text.Contains(备注, "定制尺寸") then "定制尺寸"
        else if Text.Contains(备注, "定制内材") then "定制内材"
        else if Text.Contains(备注, "定制厚度") then "定制厚度"
        else if Text.Contains(备注, "定制折叠") then "定制折叠"
        else if Text.Contains(备注, "定制缺角") then "定制缺角"
        else if Text.Contains(备注, "更换赠品") then "更换赠品"
        else null,
    type text
),
    // ==============================
    // 13. 颜色规格处理
    // ==============================
    处理颜色规格 = Table.TransformColumns(添加备注标签, {{"颜色规格", each 
        if _ = null then null else Text.SplitAny(Text.From(_), ",，"){0},
        type nullable text
    }}),

    删除线上颜色规格 = Table.RemoveColumns(处理颜色规格, {"线上颜色规格"}),

    // ==============================
    // 14. 合并线下表
    // ==============================
    合并线下 = Table.NestedJoin(删除线上颜色规格, {"线上子订单编号"}, buff_线下, {"子订单编号"}, "线下", JoinKind.LeftOuter),
    展开线下 = Table.ExpandTableColumn(合并线下, "线下", {"子订单编号"}, {"线下子订单编号"}),

    // ==============================
    // 15. 合并店铺名称对应表
    // ==============================
    合并店铺名称 = Table.NestedJoin(展开线下, {"店铺"}, buff_店铺名称对应表, {"店铺"}, "店铺名称对应表", JoinKind.LeftOuter),
    展开店铺名称 = Table.ExpandTableColumn(合并店铺名称, "店铺名称对应表", {"店铺简称"}, {"店铺简称"}),

    // ==============================
    // 16. 抖音细分及店铺简称加工
    // ==============================
    添加抖音细分 = Table.AddColumn(展开店铺名称, "新抖音简称", each 
        if [渠道平台] <> "抖音" then "非抖音渠道"
        else if [达人名称] = null or [达人名称] = "null" 
                or [达人名称] = "麻大师床垫旗舰店" 
                or [达人名称] = "麻大师官方旗舰店" then "抖1"
        else if [达人名称] = "麻大师床垫官方直播间" then "抖2"
        else if [达人名称] = "麻大师官方旗舰店直播间" then "抖3"
        else if List.Contains({
            "与辉同行", "「神机榜」床垫严选", "「神机榜」家居严选", "东方甄选家居馆", "兰知春序", "东方甄选美丽生活"
        }, [达人名称]) then [达人名称]
        else "抖音达人",
        type text
    ),

    添加店铺简称2 = Table.AddColumn(添加抖音细分, "店铺简称2", each if [新抖音简称] = "非抖音渠道" then [店铺简称] else [新抖音简称], type text),
    添加店铺简称3 = Table.AddColumn(添加店铺简称2, "店铺简称3", each if [线下子订单编号] = [线上子订单编号] then "新零售" else [店铺简称2], type text),
    添加店铺简称4 = Table.AddColumn(添加店铺简称3, "店铺简称4", each if Text.Contains([卖家备注], "M0") then "新零售" else [店铺简称3], type text),

    重命名结算店铺 = Table.RenameColumns(添加店铺简称4, {{"店铺简称2", "店铺简称（结算店铺）"}}),
    清理店铺中间列 = Table.RemoveColumns(重命名结算店铺, {"线下子订单编号", "达人名称", "店铺简称", "店铺简称3", "新抖音简称"}),
    重命名店铺简称 = Table.RenameColumns(清理店铺中间列, {{"店铺简称4", "店铺简称"}}),
    已添加条件列 = Table.AddColumn(重命名店铺简称, "新渠道平台", each if [店铺简称] = "新零售" then [店铺简称] else [渠道平台]),
    删除的列 = Table.RemoveColumns(已添加条件列,{"渠道平台"}),
    重命名的列 = Table.RenameColumns(删除的列,{{"新渠道平台", "渠道平台"}}),

    // ==============================
    // 17. 添加年月
    // ==============================
    添加年月 = Table.AddColumn(重命名的列, "年月", each Date.ToText([付款日期], "yyyy-MM"), type text),

    // ==============================
    // 18. 删除冗余属性列
    // ==============================
    删除多余属性 = Table.RemoveColumns(添加年月, {
        "其它价格1", "其它价格2", "其它价格3", "其它价格4", "其它价格5",
        "其它属性1", "其它属性2", "其它属性3", "其它属性4", "其它属性5",
        "平台外部订单号", "供应商", "供应商款号", "供应商商品编码",
        "组合装实体编码", "商品标签", "优惠券名称", "商品资料设置重量"
    }),

    // ==============================
    // 19. 重命名商品ID列
    // ==============================
    重命名商品ID = Table.RenameColumns(删除多余属性, {{"店铺款式编码", "商品id"}}),

    // ==============================
    // 20. 补充计算列：单件价格、毛利额
    // ==============================
    添加单件价格 = Table.AddColumn(重命名商品ID, "单件价格", each try [商家实收] / [销售数量] otherwise 0, type number),
    添加毛利额 = Table.AddColumn(添加单件价格, "毛利额", each [商家实收] - [成本] * [销售数量], type number),

    // ==============================
    // 21. 合并日期辅助表 → 获取周
    // ==============================
    合并日期 = Table.NestedJoin(添加毛利额, {"付款日期"}, buff_日期辅助表, {"日期"}, "日期辅助", JoinKind.LeftOuter),
    展开周 = Table.ExpandTableColumn(合并日期, "日期辅助", {"周"}, {"周"}),

    // ==============================
    // 22. 修正发货仓
    // ==============================
    添加新发货仓 = Table.AddColumn(展开周, "新发货仓", each 
        if [付款日期] < #date(2026, 5, 27) and [发货仓] = "---- 未设定 ----" and [订单状态汇总] = "已发"
        then [发货仓.1]
        else [发货仓],
        type text
    ),

    删除旧发货仓 = Table.RemoveColumns(添加新发货仓, {"发货仓"}),
    重命名新发货仓 = Table.RenameColumns(删除旧发货仓, {{"新发货仓", "发货仓"}}),

    // ==============================
    // 23. 选择最终列
    // ==============================
    最终列排序 = Table.SelectColumns(重命名新发货仓, {
        "线上订单号", "线上子订单编号", "线上商品名", "销售数量", "商家实收", "买家实付","退货金额",
        "SPU产品商编", "产品名称", "子名称", "商品编码", "颜色规格", "商品id", "渠道平台",
        "店铺简称", "是否定制", "定制备注标签", "订单状态汇总", "订单状态明细",
        "床垫类别", "年月", "付款日期", "发货日期", "确认收货日期", "发货仓", "买家ID",
        "成本", "订单状态", "卖家备注", "小旗", "店铺简称（结算店铺）",
        "厚度", "尺寸", "店铺", "商品简称", "毛利额", "单件价格", "周", "内部订单号"
    }),

    最终类型调整 = Table.TransformColumnTypes(最终列排序, {
        {"销售数量", Int64.Type},
        {"单件价格", type number},
        {"毛利额", type number}
    }),

    // ==============================
    // 24. 去重
    // ==============================
    去重 = Table.Distinct(最终类型调整)
in
    去重