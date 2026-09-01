(商家备注 as nullable text, 订单状态1 as nullable text) =>
let
    备注 = if 商家备注 = null then "" else 商家备注,
    包含等通知 = 
        Text.Contains(备注, "等通知") or 
        Text.Contains(备注, "等客户通知")or 
        Text.Contains(备注, "等客户确认")  ,
    包含延迟 =
        Text.Contains(备注, "延迟") or 
        Text.Contains(备注, "延期") ,
    包含指定日 =
        Text.Contains(备注, "号发") or 
        Text.Contains(备注, "日发") or 
        Text.Contains(备注, "指定"),
    包含定制 = 
        Text.Contains(备注, "定制") or 
        Text.Contains(备注, "折叠") or 
        Text.Contains(备注, "横折") or 
        Text.Contains(备注, "竖折"),
    包含不发出 = Text.Contains(备注, "不发货") or
                Text.Contains(备注, "置换")
in
    if 订单状态1 <> "待发" then 订单状态1 else
        if 包含不发出 then "置换" else
            if 包含等通知 and 包含定制 then "等通知，定制" else
                if 包含等通知 then "等通知" else
                    if 包含延迟 then "延迟" else
                        if 包含指定日 then "指定日" else
                            if 包含定制 then "定制" else 
                                 "待发"