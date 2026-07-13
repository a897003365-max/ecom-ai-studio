from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from .catalog import QuerySpec


# DingTalk is the source of truth for these business grains. Keeping the policy
# next to the warehouse code prevents a later explicit or full sync from
# silently reintroducing duplicate website metrics.
DINGTALK_COVERED_QUERIES: dict[str, dict[str, Any]] = {
    "00-月表汇总": {
        "authority": "钉钉：全渠道数据表",
        "grain": "日期 × 渠道 × 店铺",
        "overlap": ["GMV", "回款额", "退款额", "站内费", "总费用", "加购人数"],
        "reason": "与钉钉日经营明细同粒度、同口径，网站不应重复同步。",
    },
    "03-1-各渠道目标金额": {
        "authority": "钉钉：销售目标",
        "grain": "月份 × 渠道/店铺",
        "overlap": ["月度销售目标"],
        "reason": "月度目标已由钉钉销售目标表维护，避免双来源冲突。",
    },
}


# These queries may contain a few familiar headline fields, but their analytical
# grain is finer than the DingTalk business summary. They remain in the local
# warehouse; website modules should expose their unique dimensions and derived
# diagnostics instead of repeating the headline totals.
PARTIAL_OVERLAP_QUERIES: dict[str, dict[str, Any]] = {
    "04-旗舰店基础数据": {
        "retainBecause": "访客、商品访客、转化、客单价、UV价值、新老客等漏斗字段不在钉钉表。",
        "doNotRepublish": ["GMV", "回款额", "退款额", "总推广费"],
    },
    "06-旗舰店流量数据": {
        "retainBecause": "流量来源粒度和来源质量诊断不在钉钉表。",
        "doNotRepublish": ["全店浏览量", "全店访客数"],
    },
    "08-旗舰店推广花费": {
        "retainBecause": "计划、单元和投放日粒度的效率与诊断字段不在钉钉表。",
        "doNotRepublish": ["总推广费", "站内总推广费"],
    },
}


POWERBI_UNIQUE_DOMAINS: tuple[dict[str, Any], ...] = (
    {
        "id": "store_goal_profit",
        "label": "店铺日目标与毛利",
        "priority": "P1",
        "queries": ("03-2店铺每天销售目标",),
    },
    {
        "id": "funnel_traffic",
        "label": "转化漏斗与流量来源",
        "priority": "P0",
        "queries": ("04-旗舰店基础数据", "06-旗舰店流量数据"),
    },
    {
        "id": "product_sku",
        "label": "商品与 SKU 经营",
        "priority": "P0",
        "queries": ("07-旗舰店商品销售数据", "辅4-床垫编码", "辅5-床类编码"),
    },
    {
        "id": "advertising_diagnostics",
        "label": "投放诊断",
        "priority": "P0",
        "queries": ("08-1关键词报表数据", "08-2人群报表数据", "08-旗舰店推广花费", "11-旗舰店UD推广计划"),
    },
    {
        "id": "customer_service",
        "label": "客服效能与排班",
        "priority": "P1",
        "queries": (
            "10-1淘宝客服绩效明细",
            "10-2京东客服营销明细",
            "10-3京东客服绩效数据",
            "10-4客服员工日报统计",
            "接待数据",
            "京东客服分组表",
            "考勤数据",
            "淘宝客服排班表",
            "营销数据",
            "营销数据改版",
        ),
    },
    {
        "id": "competitor_promotion",
        "label": "竞品与促销观测",
        "priority": "P1",
        "queries": ("14-推广竞品数据",),
    },
    {
        "id": "model_support",
        "label": "模型关联辅助",
        "priority": "support",
        "queries": ("01-店铺数据辅助表", "05-旗舰店ID对照表"),
    },
)


def select_sync_specs(
    specs: Iterable[QuerySpec],
    requested_names: frozenset[str] | None = None,
) -> tuple[list[QuerySpec], list[QuerySpec]]:
    """Return active PowerBI-unique specs and DingTalk-owned exclusions."""

    considered = [spec for spec in specs if requested_names is None or spec.name in requested_names]
    selected = [spec for spec in considered if spec.name not in DINGTALK_COVERED_QUERIES]
    excluded = [spec for spec in considered if spec.name in DINGTALK_COVERED_QUERIES]
    return selected, excluded


def unique_domain_catalog(query_results: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Build a website-safe inventory without exposing customer or source rows."""

    domains = []
    for domain in POWERBI_UNIQUE_DOMAINS:
        results = [query_results[name] for name in domain["queries"] if name in query_results]
        domains.append(
            {
                "id": domain["id"],
                "label": domain["label"],
                "priority": domain["priority"],
                "queryCount": len(results),
                "rowCount": sum(int(item.get("rows", 0)) for item in results),
                "failedFiles": sum(int(item.get("failed", 0)) for item in results),
                "queries": list(domain["queries"]),
            }
        )
    return domains
