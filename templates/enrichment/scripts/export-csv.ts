import fs from "fs/promises";
import path from "path";
import { parseArgs } from "@agent-native/core";
import type { ScriptTool } from "@agent-native/core";
import type { EnrichmentJob } from "../shared/types.js";
import { readJsonFile, writeJsonFile } from "../server/lib/exa.js";

const ENRICHMENTS_DIR = path.join(process.cwd(), "data", "enrichments");
const EXPORTS_DIR = path.join(process.cwd(), "data", "exports");

export const tool: ScriptTool = {
  description:
    "Export enrichment results as a CSV file. Merges original import columns with enriched data columns.",
  parameters: {
    type: "object",
    properties: {
      jobId: {
        type: "string",
        description: "The enrichment job ID to export",
      },
    },
    required: ["jobId"],
  },
};

function escapeCsvField(value: string | null | undefined): string {
  if (value == null) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function run(args: Record<string, string>): Promise<string> {
  const { jobId } = args;
  if (!jobId) {
    return "Error: jobId is required.";
  }

  const jobPath = path.join(ENRICHMENTS_DIR, `${jobId}.json`);
  let job: EnrichmentJob;
  try {
    job = await readJsonFile<EnrichmentJob>(jobPath);
  } catch {
    return `Error: Enrichment job "${jobId}" not found.`;
  }

  if (job.results.length === 0) {
    return `Error: Job "${jobId}" has no results to export. Run the enrichment first.`;
  }

  const originalCols = new Set<string>();
  const enrichedCols = new Set<string>();
  for (const row of job.results) {
    for (const k of Object.keys(row.originalRow)) originalCols.add(k);
    for (const k of Object.keys(row.enriched)) enrichedCols.add(k);
  }

  const headers = [...originalCols, ...enrichedCols];
  const csvLines: string[] = [headers.map(escapeCsvField).join(",")];

  for (const row of job.results) {
    const values = headers.map((h) => {
      if (originalCols.has(h) && h in row.originalRow) {
        return escapeCsvField(row.originalRow[h]);
      }
      if (enrichedCols.has(h) && h in row.enriched) {
        return escapeCsvField(row.enriched[h]);
      }
      return "";
    });
    csvLines.push(values.join(","));
  }

  const csv = csvLines.join("\n") + "\n";
  const exportId = `${jobId}-${Date.now()}`;
  const exportPath = path.join(EXPORTS_DIR, `${exportId}.csv`);

  await fs.mkdir(EXPORTS_DIR, { recursive: true });
  await fs.writeFile(exportPath, csv, "utf8");

  job.lastExportId = exportId;
  await writeJsonFile(jobPath, job);

  return [
    `CSV exported successfully.`,
    `  Export ID: ${exportId}`,
    `  Rows: ${job.results.length}`,
    `  Columns: ${headers.length}`,
    `  File: ${exportPath}`,
  ].join("\n");
}

export default async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await run(args);
  console.log(result);
}
