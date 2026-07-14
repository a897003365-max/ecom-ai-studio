function shanghaiDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function previousDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function missingText(label, actual, expected) {
  return `${label}（${actual || "未同步"}，应为 ${expected}）`;
}

export function buildDashboardDataStatus({ expectedDate = previousDate(shanghaiDate()), dingtalk, warehouse }) {
  const missing = [];
  if (!dingtalk?.completedThrough || dingtalk.completedThrough !== expectedDate) {
    missing.push(missingText("钉钉经营数据", dingtalk?.completedThrough, expectedDate));
  }
  const warehouseQuality = warehouse?.quality;
  const warehouseUnavailable = !warehouse?.periodEnd || warehouse.periodEnd !== expectedDate;
  const warehouseQualityIssue = warehouseQuality?.status && warehouseQuality.status !== "healthy" || Number(warehouseQuality?.failedFiles || 0) > 0;
  if (warehouseUnavailable || warehouseQualityIssue) {
    const detail = warehouseUnavailable ? missingText("本地数仓", warehouse?.periodEnd, expectedDate) : "本地数仓存在失败/缺失分区";
    missing.push(detail);
  }
  if (Number(dingtalk?.quality?.anomalyCount || 0) > 0) {
    missing.push(`钉钉存在 ${dingtalk.quality.anomalyCount} 个异常`);
  }
  return {
    expectedDate,
    tone: missing.length ? "orange" : "green",
    label: missing.length ? `缺少 ${missing.length} 项数据` : "T-1 数据已更新",
    missing,
  };
}
