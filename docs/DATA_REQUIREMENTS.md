# 运营看板缺失数据需求清单

日期：2026-07-10

## P0：素材与内容闭环

### 素材文案映射 `BridgeMaterialContent`

必填字段：

- `MaterialId`
- `ContentId`
- `Platform`
- `StoreId`
- `CampaignId`
- `ValidFrom`
- `ValidTo`
- `PublishStatus`

没有这张表，素材 TOP10、素材胜率和一键再生成只能保持演示状态，不能准确回流到具体文案或图片任务。

### 商品统一映射 `DimProductMapping`

必填字段：

- `ProductId`
- `SKU`
- `SPU`
- `StandardProductName`
- `Platform`
- `PlatformProductId`
- `StoreId`
- `EffectiveFrom`
- `EffectiveTo`

商品名不能作为唯一关联键。

## P0：钉钉运营表

钉钉 CSV/XLSX/JSON 本机解析器已就绪；当前需要完成浏览器文档授权，或提供一份真实导出文件完成字段映射。最少需要：

- 表名、工作表名、负责人和更新时间。
- 日期、平台、店铺、商品、活动、素材、计划粒度。
- 曝光、点击、消耗、支付订单、GMV、退款、收藏、加购。
- 目标值、预算值和异常说明。

不需要上传员工手机号、用户唯一 ID、聊天记录或文档访问凭据。

## P1：跨平台投放事实

目标表：`FactAdPerformanceDaily`。

必填字段：

- `Date`
- `PlatformId`
- `StoreId`
- `AccountId`
- `CampaignId`
- `PlanId`
- `MaterialId`
- `ProductId` / `SKU`
- `Exposure`
- `Click`
- `Spend`
- `PaidOrder`
- `GMV`
- `Favorite`
- `AddToCart`
- `VideoPlay`
- `VideoComplete`

质量要求：金额为 decimal，比例统一保存为 0-1，未知值为 null，不用 0 代替缺失。

## P1：发布与内容表现

必填字段：

- `ContentId`
- `MaterialId`
- `Platform`
- `AccountId`
- `PublishAt`
- `ContentType`
- `ProductId`
- `ExposureOrPlay`
- `Read`
- `Like`
- `Favorite`
- `Comment`
- `Share`
- `ClickRate`
- `InteractionRate`
- `CompletionRate`

飞书已经覆盖大部分内容表现字段，但仍缺稳定的 `ContentId` 和 `MaterialId`。

## P1：目标与预算

必填字段：

- `Date` / `Month`
- `Platform`
- `StoreId`
- `Channel`
- `TargetGMV`
- `TargetSpend`
- `TargetROI`
- `TargetOrder`
- `Budget`
- `OwnerRole`

负责人只保存岗位或内部员工 ID，不在网页显示手机号。

## P2：质量与人工确认

建议字段：

- `TaskId`
- `ContentId` / `MaterialId`
- `QualityScore`
- `ComplianceStatus`
- `FailureCode`
- `FailureReason`
- `HumanDecision`
- `ConfirmedByRole`
- `ConfirmedAt`
- `Revision`

## 接收格式

- 首选 CSV 或 XLSX。
- 单表第一行为字段名，不要合并单元格。
- 日期统一 `YYYY-MM-DD`。
- 每张事实表必须有稳定主键或可验证的复合主键。
- 上传前删除手机号、地址、电话、Token、Cookie 和带访问令牌的 URL。
- 文件通过系统设置页进入本机 `local-data/uploads`，不会上传到外网。
