import { Card } from "./Card";

interface ChannelShareItem {
  platform: string;
  gmv: number;
}

interface ChannelShareChartProps {
  platforms: ChannelShareItem[];
}

const compactCurrency = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
  notation: "compact",
  maximumFractionDigits: 1,
});

function percent(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

export function ChannelShareChart({ platforms }: ChannelShareChartProps) {
  const totalGmv = platforms.reduce((sum, item) => sum + Number(item.gmv || 0), 0);
  const rows = [...platforms]
    .map((item) => ({ ...item, share: totalGmv ? item.gmv / totalGmv : 0 }))
    .sort((left, right) => right.share - left.share);

  return (
    <Card className="h-full min-w-0">
      <div data-testid="channel-gmv-share-chart">
        <div className="mb-1 flex items-center justify-between gap-3">
          <span className="text-[13.5px] font-bold">各渠道 GMV 占比</span>
          <span className="font-mono text-[11px] text-[var(--blue)]">{compactCurrency.format(totalGmv)}</span>
        </div>
        <div className="mb-4 text-[10.5px] text-[var(--muted-2)]">渠道 GMV / 全渠道 GMV · 按占比降序</div>
        <div className="space-y-3.5">
          {rows.map((item) => (
            <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_4rem] items-center gap-3" key={item.platform}>
              <span className="truncate text-[12px] font-medium text-[var(--muted)]" title={item.platform}>{item.platform}</span>
              <div
                className="relative h-5 overflow-hidden rounded bg-white/[0.055] ring-1 ring-inset ring-white/[0.025]"
                title={`${item.platform} GMV ${compactCurrency.format(item.gmv)}，占比 ${percent(item.share)}`}
              >
                <div
                  className="absolute inset-y-0 left-0 rounded transition-[width] duration-500"
                  style={{
                    width: `${Math.min(100, item.share * 100)}%`,
                    minWidth: item.share > 0 ? 3 : 0,
                    background: "linear-gradient(90deg, var(--blue), #78d8f0)",
                    boxShadow: "0 0 14px rgba(73, 191, 227, 0.25)",
                  }}
                />
              </div>
              <span className="text-right font-mono text-[12px] font-semibold text-[var(--blue)]">{percent(item.share)}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
