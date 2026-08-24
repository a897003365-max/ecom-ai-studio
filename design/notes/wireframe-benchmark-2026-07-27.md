# 经营工作台线稿案例研究与优化决策

## 目标

在不改变业务逻辑和数据口径的前提下，提取现有线稿的“经营结果 → 诊断依据 → 行动闭环”，参考成熟企业产品的优点，优化 `designs/wireframes/workbench-home-layout-options.html`。

## 线稿保留的核心元素

- 侧栏工作区与多级诊断入口。
- 统计周期、对比口径、经营范围和数据完整日。
- 目标进度、预测缺口、异常 Top List。
- 结果、过程信号和证据边界分层。
- 依据抽屉、下钻入口、行动责任人与截止时间。
- 表格、趋势、漏斗、热力、排名和任务看板。

## 参考案例与优胜点

### Shopify Analytics

参考：[Analytics overview dashboard](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/overview-dashboard)

- 指标卡围绕同一日期范围和对比周期组织。
- 支持目标、自动洞察和可调整卡片层级。
- 反哺：保留顶部统一口径区，目标进度和自动识别的首要核查并列展示。

### Linear Insights

参考：[Linear Insights](https://linear.app/insights)、[Dashboards](https://linear.app/docs/dashboards)、[Filters](https://linear.app/docs/filters)

- 全局筛选影响整个仪表板，数据点可快速下钻到底层工作项。
- 高层概览与立即行动保持同一上下文。
- 反哺：强化 `查看依据 → 对应诊断页 → 创建/查看任务` 链路，保留 URL hash 作为可分享视图。

### Datadog Dashboards

参考：[Top List widget](https://docs.datadoghq.com/dashboards/widgets/top_list/)、[Dashboard querying](https://docs.datadoghq.com/dashboards/querying/)

- Top List 使用绝对值/相对值、条件格式和上下文链接。
- Widget 共享全局时间，也允许局部时间范围。
- 反哺：异常卡同时显示影响、范围和证据状态；局部诊断明确是否继承全局周期。

### Stripe Reporting

参考：[Dashboard basics](https://docs.stripe.com/dashboard/basics)、[Activity breakdown](https://docs.stripe.com/reports/activity-breakdown)、[Revenue Recognition reports](https://docs.stripe.com/revenue-recognition/reports)

- 汇总数字可下钻到活动明细，报表明确数据延迟和导出范围。
- 反哺：保留数据完整日、来源标签和限制说明，不把未覆盖数据显示为零。

## 本轮落地

- 保留原白底评审稿，新增使用项目 Design Token 的深色运营模式。
- 增加可持久化的深浅模式切换，不引入运行时依赖。
- 1023px 以下将侧栏收敛为横向导航；页面栅格按 3/2/1 列逐级收敛。
- 移动端将筛选口径、Hero、异常卡、流程和复杂网格改为可换行或局部滚动。
- 为原型外壳、导航、首页、目标进度和首要行动增加稳定 `data-ui`。
- 26 个 hash 视图在浅色/深色两种模式与 1440、1280、1024、768、390、375px
  共 312 个组合中完成根容器溢出扫描；复杂流程和表格仅在自身容器内横向滚动。

## 不采用的案例特征

- 不采用 Dribbble 式高饱和渐变、超大圆角、玻璃拟态和装饰性 3D。
- 不为了“可拖拽”引入新的仪表板框架。
- 不把所有指标压缩到同权重卡片；首要判断和异常继续拥有更高层级。
- 不在原型阶段改变接口、权限、路由、数据结构或数据口径。
