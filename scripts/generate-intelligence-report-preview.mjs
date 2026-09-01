import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildReportFacts, createBaselineNarrative, generateIntelligenceReport, writeReportArtifacts } from "../server/intelligence-report.mjs";

const projectRoot = process.cwd();
const intelligenceDir = join(projectRoot, "local-data", "intelligence");
const top100 = JSON.parse(readFileSync(join(intelligenceDir, "top100.json"), "utf8"));
const brandRanking = JSON.parse(readFileSync(join(intelligenceDir, "brand-ranking.json"), "utf8"));
const insights = JSON.parse(readFileSync(join(intelligenceDir, "insights.json"), "utf8"));
const priceSource = readFileSync(join(projectRoot, "src", "data", "tmallCompetitorData.ts"), "utf8");

function extractJsonArray(source, assignment) {
  const assignmentIndex = source.indexOf(assignment);
  if (assignmentIndex < 0) throw new Error(`找不到 ${assignment}`);
  const equals = source.indexOf("=", assignmentIndex + assignment.length);
  const start = source.indexOf("[", equals + 1);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "[") depth += 1;
    else if (character === "]") {
      depth -= 1;
      if (depth === 0) return JSON.parse(source.slice(start, index + 1));
    }
  }
  throw new Error(`${assignment} 数组未闭合`);
}

const periods = extractJsonArray(priceSource, "export const tmallPricePeriods");
const current = periods.find((entry) => entry.period === top100.samplePeriod);
if (!current) throw new Error(`缺少同周期价格快照：${top100.samplePeriod}`);

const priceSnapshot = { period: current.period, label: current.label || current.period, items: current.items };
const facts = buildReportFacts({
  top100,
  brandRanking,
  insights,
  priceSnapshot,
});
const result = process.argv.includes("--llm")
  ? await generateIntelligenceReport({ period: current.period, priceSnapshot })
  : await writeReportArtifacts(facts, createBaselineNarrative(facts), {
      provider: "deterministic-preview",
      model: "evidence-baseline",
    });
console.log(JSON.stringify(result, null, 2));
