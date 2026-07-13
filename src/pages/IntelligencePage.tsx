import { useState } from "react";
import { Card } from "../components/Card";
import { MetricCard } from "../components/MetricCard";
import { PageHeader } from "../components/PageHeader";
import { PlatformBadge } from "../components/PlatformBadge";
import { StatusTag } from "../components/StatusTag";
import { TableShell } from "../components/TableShell";
import { Tabs } from "../components/Tabs";
import { Thumbnail } from "../components/Thumbnail";
import { competitorPrices, competitorStores, top100Items } from "../data/mock";
import type { TaskCreateInput } from "../types";

type IntelligenceTab = "top100" | "price";

interface IntelligencePageProps {
  onAction: (title: string, detail?: string) => void;
  onCreateTask: (task: TaskCreateInput) => void;
}

export function IntelligencePage({ onAction, onCreateTask }: IntelligencePageProps) {
  const [tab, setTab] = useState<IntelligenceTab>("top100");
  const [monitoredIds, setMonitoredIds] = useState<number[]>(top100Items.filter((item) => item.monitored).map((item) => item.rank));

  function addMonitor(rank: number) {
    setMonitoredIds((current) => Array.from(new Set([...current, rank])));
    onAction("加入监控池", `TOP100 第 ${rank} 名已加入 mock 监控池`);
  }

  function createCrawlTask(type: TaskCreateInput["type"], name: string, batch: string) {
    onCreateTask({
      name,
      type,
      module: "竞品情报",
      batch,
      inputFiles: ["crawl_rules/top100_mattress.json", "monitor_pool/competitors.csv"],
      timeline: ["11:30 从竞品情报页创建任务", "11:30 等待合规采集结果写入"],
    });
  }

  return (
    <div>
      <PageHeader
        title="竞品情报与 TOP100"
        subtitle="继承原型抓取任务中心的两个子标签：行业 TOP100 主图抓取与竞品价格监控。第一阶段只做前端模拟，不做真实抓取、不绕反爬、不登录平台账号。"
        actions={
          <>
            <button className="btn-select" type="button">618 大促 · 床垫类目 ▾</button>
            <button className="btn-primary" onClick={() => createCrawlTask("top100_crawl", "启动行业 TOP100 抓取", "TOP100-20260707-MANUAL")} type="button">开始抓取</button>
          </>
        }
      />

      <Tabs<IntelligenceTab>
        value={tab}
        tabs={[
          { id: "top100", label: "行业 TOP100 主图抓取" },
          { id: "price", label: "竞品价格监控" },
        ]}
        onChange={setTab}
      />

      {tab === "top100" ? (
        <>
          <div className="metric-grid mb-5">
            <MetricCard metric={{ label: "已抓取", value: "87/100", progress: 87, tone: "blue" }} />
            <MetricCard metric={{ label: "覆盖店铺数", value: "62", tone: "purple" }} />
            <MetricCard metric={{ label: "新上榜", value: "5", tone: "green" }} />
            <MetricCard metric={{ label: "下次抓取", value: "2026-07-07 20:00", tone: "orange" }} />
          </div>

          <Card className="mb-4">
            <div className="grid gap-3 md:grid-cols-5">
              <select className="input-field" defaultValue="天猫 / 京东 / 抖音">
                <option>天猫 / 京东 / 抖音</option>
                <option>天猫</option>
                <option>京东</option>
                <option>抖音</option>
              </select>
              <select className="input-field" defaultValue="床垫">
                <option>床垫</option>
                <option>黄麻薄垫</option>
                <option>软床</option>
              </select>
              <input className="input-field" defaultValue="可拆洗 护脊" aria-label="关键词" />
              <select className="input-field" defaultValue="2026-06-18~2026-07-07">
                <option>2026-06-18~2026-07-07</option>
                <option>2026-07-01~2026-07-07</option>
              </select>
              <select className="input-field" defaultValue="每日 08:00 / 14:00 / 20:00">
                <option>每日 08:00 / 14:00 / 20:00</option>
                <option>每日一次</option>
                <option>每周一次</option>
              </select>
            </div>
          </Card>

          <Card
            title="TOP100 榜单"
            action={
              <div className="flex flex-wrap gap-2">
                <button className="btn" onClick={() => createCrawlTask("export_package", "导出 TOP100 Excel", "EXPORT-TOP100-20260707")} type="button">导出 Excel</button>
                <button className="btn" onClick={() => createCrawlTask("quality_check", "生成 TOP100 分析报告", "REPORT-TOP100-20260707")} type="button">生成分析报告</button>
              </div>
            }
          >
            <TableShell minWidth={1320}>
              <thead>
                <tr>
                  <th>排名</th>
                  <th>主图</th>
                  <th>商品名</th>
                  <th>店铺</th>
                  <th>品牌</th>
                  <th>平台</th>
                  <th>价格</th>
                  <th>活动价</th>
                  <th>月销/热度</th>
                  <th>活动标签</th>
                  <th>抓取时间</th>
                  <th>是否加入监控</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {top100Items.map((item, index) => (
                  <tr key={item.rank}>
                    <td className="font-bold">{item.rank}</td>
                    <td><Thumbnail icon={item.mainImage} index={index} /></td>
                    <td className="font-semibold">{item.productName}</td>
                    <td>{item.store}</td>
                    <td>{item.brand}</td>
                    <td><PlatformBadge platform={item.platform} /></td>
                    <td>{item.price}</td>
                    <td className="text-[var(--green)]">{item.campaignPrice}</td>
                    <td>{item.heat}</td>
                    <td><StatusTag label={item.campaignTag} tone="blue" /></td>
                    <td>{item.crawledAt}</td>
                    <td>{monitoredIds.includes(item.rank) ? <StatusTag label="已加入" tone="green" /> : <StatusTag label="未加入" tone="muted" />}</td>
                    <td>
                      <button className="btn" onClick={() => addMonitor(item.rank)} type="button">加入监控池</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          </Card>
        </>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[0.75fr_1.6fr_0.75fr]">
          <Card title="竞品店铺列表">
            <TableShell minWidth={620}>
              <thead>
                <tr>
                  <th>店铺</th>
                  <th>平台</th>
                  <th>商品数</th>
                  <th>预警</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {competitorStores.map((store) => (
                  <tr key={store.store}>
                    <td>
                      <div className="font-semibold">{store.store}</div>
                      <div className="text-xs text-[var(--muted)]">{store.brand} · {store.lastCrawl}</div>
                    </td>
                    <td><PlatformBadge platform={store.platform} /></td>
                    <td>{store.productCount}</td>
                    <td className={store.warningCount > 0 ? "text-[var(--red)]" : "text-[var(--muted)]"}>{store.warningCount}</td>
                    <td><StatusTag label={store.status} tone={store.warningCount > 0 ? "red" : "green"} /></td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          </Card>

          <Card
            title="商品价格列表"
            action={
              <div className="flex flex-wrap gap-2">
                <button className="btn" onClick={() => createCrawlTask("export_package", "导出价格监控 Excel", "EXPORT-PRICE-20260707")} type="button">导出 Excel</button>
                <button className="btn" onClick={() => createCrawlTask("quality_check", "生成价格监控分析报告", "REPORT-PRICE-20260707")} type="button">生成分析报告</button>
              </div>
            }
          >
            <TableShell minWidth={1460}>
              <thead>
                <tr>
                  <th>商品名</th>
                  <th>主图</th>
                  <th>店铺</th>
                  <th>品牌</th>
                  <th>平台</th>
                  <th>原价</th>
                  <th>券后价</th>
                  <th>活动信息</th>
                  <th>2026-07-06 价格</th>
                  <th>价格变化</th>
                  <th>30 日最低</th>
                  <th>上新状态</th>
                  <th>预警状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {competitorPrices.map((item, index) => (
                  <tr key={item.id}>
                    <td className="font-semibold">{item.productName}</td>
                    <td><Thumbnail icon={item.mainImage} index={index} /></td>
                    <td>{item.store}</td>
                    <td>{item.brand}</td>
                    <td><PlatformBadge platform={item.platform} /></td>
                    <td>{item.originalPrice}</td>
                    <td className="text-[var(--green)]">{item.couponPrice}</td>
                    <td>{item.campaignInfo}</td>
                    <td>{item.previousPrice}</td>
                    <td className={item.priceChange.includes("▼") ? "text-[var(--red)]" : item.priceChange.includes("▲") ? "text-[var(--green)]" : "text-[var(--muted)]"}>{item.priceChange}</td>
                    <td>{item.low30d}</td>
                    <td>{item.newStatus}</td>
                    <td><StatusTag label={item.warningStatus} tone={item.tone} /></td>
                    <td><button className="btn" onClick={() => onAction("查看价格轨迹", `${item.productName} 使用 mock 价格曲线`)} type="button">查看</button></td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          </Card>

          <Card title="价格预警侧栏">
            <div className="grid gap-3">
              {competitorPrices.filter((item) => item.warningStatus !== "无变化").map((item) => (
                <div className="rounded-lg border border-[var(--border)] bg-white/[0.02] p-3" key={item.id}>
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="font-bold">{item.productName}</div>
                    <StatusTag label={item.warningStatus} tone={item.tone} />
                  </div>
                  <div className="grid gap-1 text-xs leading-5 text-[var(--muted)]">
                    <div>降价幅度：<b className="text-[var(--red)]">{item.priceChange}</b></div>
                    <div>触发阈值：{item.alertThreshold}</div>
                    <div>原因：{item.alertReason}</div>
                    <div>建议动作：{item.suggestedAction}</div>
                  </div>
                  <button className="btn mt-3 w-full" onClick={() => createCrawlTask("quality_check", `${item.productName} 价格预警处理`, `ALERT-${item.id}`)} type="button">创建跟进任务</button>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
