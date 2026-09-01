import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const tmdlDir = join(projectRoot, "migration", "powerbi-tmdl", "tables");
const outputRoot = join(projectRoot, "migration", "power-query-m");
const originalDir = join(outputRoot, "original");

function extractExpression(source) {
  const fenced = source.match(/\bpartition\s+.+?=\s*m[\s\S]*?\n\s*source\s*=\s*```\r?\n([\s\S]*?)\r?\n\s*```/i);
  const indented = source.match(/\bpartition\s+.+?=\s*m[\s\S]*?\n\s*source\s*=\s*\r?\n([\s\S]*?)(?=\r?\n\tannotation\b)/i);
  const match = fenced ?? indented;
  if (!match) return null;
  const lines = match[1].replace(/\r\n/g, "\n").split("\n");
  const indent = Math.min(...lines.filter((line) => line.trim()).map((line) => line.match(/^\s*/)[0].length));
  return `${lines.map((line) => line.slice(indent)).join("\n").trim()}\n`;
}

function uniqueMatches(expression, pattern, group = 1) {
  return [...new Set([...expression.matchAll(pattern)].map((match) => match[group]).filter(Boolean))];
}

function sourceKind(expression) {
  if (/Folder\.(Files|Contents)\(/.test(expression)) return "folder";
  if (/Excel\.Workbook\(File\.Contents\(/.test(expression)) return "excel_file";
  if (/Csv\.Document\(File\.Contents\(/.test(expression)) return "csv_file";
  if (/Web\.Contents\(|SharePoint\./.test(expression)) return "remote";
  return "query_or_inline";
}

async function pathSummary(path) {
  if (!existsSync(path)) return { path, exists: false, files: 0, extensions: [] };
  const pathStat = await stat(path);
  if (pathStat.isFile()) {
    return { path, exists: true, files: 1, extensions: [extname(path).toLowerCase() || "[none]"] };
  }
  const stack = [path];
  let files = 0;
  const extensions = new Set();
  while (stack.length && files < 100_000) {
    const current = stack.pop();
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else {
        files += 1;
        extensions.add(extname(entry.name).toLowerCase() || "[none]");
      }
    }
  }
  return { path, exists: true, files, extensions: [...extensions].sort() };
}

function markdownCell(value) {
  return String(value ?? "-").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

await rm(originalDir, { recursive: true, force: true });
await mkdir(originalDir, { recursive: true });
const tableFiles = (await readdir(tmdlDir)).filter((file) => file.endsWith(".tmdl")).sort((a, b) => a.localeCompare(b, "zh-CN"));
const queries = [];

for (const file of tableFiles) {
  const tmdl = await readFile(join(tmdlDir, file), "utf8");
  const expression = extractExpression(tmdl);
  if (!expression) continue;
  const name = basename(file, ".tmdl");
  const sourcePaths = uniqueMatches(expression, /(?:File\.Contents|Folder\.(?:Files|Contents))\("([^"]+)"\)/g);
  const operations = uniqueMatches(expression, /\b((?:Table|Excel|Csv|Folder|File|Text|Date|DateTime|Number|List|Record)\.[A-Za-z0-9_]+)/g);
  const references = uniqueMatches(expression, /#"([^"]+)"/g)
    .filter((value) => !expression.includes(`${value} =`))
    .slice(0, 100);
  const schemaByColumn = new Map();
  for (const match of expression.matchAll(/\{"([^"]+)",\s*((?:type\s+\w+)|(?:Int64|Percentage|Currency|Date|DateTime)\.Type)/g)) {
    schemaByColumn.set(match[1], match[2]);
  }
  const schema = [...schemaByColumn].map(([column, mType]) => ({ column, mType }));
  const outputFile = `${name}.pq`;
  await writeFile(join(originalDir, outputFile), expression, "utf8");
  queries.push({
    name,
    tmdlFile: `tables/${file}`,
    mFile: `original/${outputFile}`,
    sourceKind: sourceKind(expression),
    sourcePaths,
    operations,
    references,
    sheetName: expression.match(/\[Item="([^"]+)",Kind="Sheet"\]/)?.[1] ?? null,
    promoteHeaders: expression.includes("Table.PromoteHeaders"),
    typedColumnCount: schema.length,
    typedColumns: schema.map((item) => item.column),
    schema,
    migrationStatus: "catalogued",
  });
}

const allPaths = [...new Set(queries.flatMap((query) => query.sourcePaths))];
const sources = [];
for (const path of allPaths) sources.push(await pathSummary(path));

const operationUsage = {};
for (const query of queries) {
  for (const operation of query.operations) operationUsage[operation] = (operationUsage[operation] ?? 0) + 1;
}

const manifest = {
  generatedAt: new Date().toISOString(),
  sourcePbix: "D:/麻大师/BI文件/麻大师店铺推广数据报表.pbix",
  tmdlRoot: "migration/powerbi-tmdl",
  queryCount: queries.length,
  queries,
  sources,
  operationUsage: Object.fromEntries(Object.entries(operationUsage).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))),
};

if (queries.length !== 25) {
  throw new Error(`应导出 25 个 M 查询，实际识别 ${queries.length} 个；请检查 TMDL 序列化格式`);
}

await writeFile(join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const rows = queries.map((query) => {
  const sourceState = query.sourcePaths.length
    ? query.sourcePaths.map((path) => sources.find((source) => source.path === path)?.exists ? "可读取" : "缺失").join(" / ")
    : "查询依赖";
  const complexity = query.operations.some((operation) => /Join|Pivot|Unpivot|Group/.test(operation)) ? "复合" : "标准";
  return `| ${markdownCell(query.name)} | ${query.sourceKind} | ${markdownCell(sourceState)} | ${query.typedColumnCount} | ${complexity} | 待迁移 |`;
});

const topOperations = Object.entries(manifest.operationUsage)
  .slice(0, 20)
  .map(([operation, count]) => `- \`${operation}\`: ${count} 个查询`)
  .join("\n");

const matrix = `# Power Query M 迁移矩阵

生成日期：2026-07-11  
源文件：\`D:/麻大师/BI文件/麻大师店铺推广数据报表.pbix\`  
M 查询：${queries.length} 个

## 迁移原则

- \`original/*.pq\` 保留 PBIX 中的原始 M 表达式，作为行为基线和审计依据。
- Python 管线只读取 \`D:/麻大师/日更数据\` 本地文件，不依赖 Power BI Desktop、本地 Analysis Services 端口或 Power BI MCP。
- 清洗结果写入 Parquet，DuckDB 只负责查询、视图和聚合快照。
- 每个查询先完成源文件可用性、列契约和行数校验，再标记为“已迁移”。

## 查询清单

| 查询 | 数据源类型 | 本地源状态 | 类型列 | 复杂度 | 状态 |
|---|---|---:|---:|---|---|
${rows.join("\n")}

## 高频 M 操作

${topOperations}

## 产物

- \`manifest.json\`：机器可读查询、路径、操作与列清单。
- \`original/*.pq\`：逐查询原始 M 代码。
- \`MIGRATION_MATRIX.md\`：迁移范围与状态。
`;

await writeFile(join(outputRoot, "MIGRATION_MATRIX.md"), matrix, "utf8");
console.log(JSON.stringify({ queryCount: queries.length, sourceCount: sources.length, outputRoot }, null, 2));
