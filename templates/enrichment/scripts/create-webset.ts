import path from "path";
import { parseArgs } from "@agent-native/core";
import type { ScriptTool } from "@agent-native/core";
import type { EnrichmentJob, ImportRecord } from "../shared/types.js";
import { CreateEnrichmentParametersFormat } from "exa-js";
import {
  getExaClient,
  detectSearchType,
  mergeResults,
  readJsonFile,
  writeJsonFile,
} from "../server/lib/exa.js";

const ENRICHMENTS_DIR = path.join(process.cwd(), "data", "enrichments");
const IMPORTS_DIR = path.join(process.cwd(), "data", "imports");

export const tool: ScriptTool = {
  description:
    "Create and run an Exa webset enrichment. Detects whether to use search or import based on CSV columns. Waits for completion, merges results, and updates the job.",
  parameters: {
    type: "object",
    properties: {
      jobId: {
        type: "string",
        description: "The enrichment job ID to process",
      },
      query: {
        type: "string",
        description:
          "Search query for search-based websets (ignored for import-based)",
      },
      count: {
        type: "string",
        description: "Number of results to find (default: matches row count)",
      },
    },
    required: ["jobId"],
  },
};

function hasUrlColumns(columns: string[]): boolean {
  return columns.some((c) => {
    const low = c.toLowerCase().trim();
    return (
      low.includes("domain") ||
      low === "website" ||
      low === "url" ||
      low === "website url" ||
      low.endsWith("_url") ||
      low === "site"
    );
  });
}

function buildSearchQuery(
  importData: ImportRecord,
  searchType: "people" | "companies",
): string {
  const sampleRows = importData.rows.slice(0, 5);
  const parts: string[] = [];

  if (searchType === "people") {
    const nameCol = importData.columns.find((c) => {
      const low = c.toLowerCase();
      return (
        low === "name" ||
        low === "full name" ||
        low === "full_name" ||
        low === "contact"
      );
    });
    if (nameCol) {
      const names = sampleRows
        .map((r) => r[nameCol])
        .filter(Boolean)
        .slice(0, 3);
      if (names.length > 0) {
        parts.push(`People similar to: ${names.join(", ")}`);
      }
    }
  }

  if (searchType === "companies") {
    const companyCol = importData.columns.find((c) => {
      const low = c.toLowerCase();
      return (
        low.includes("company") || low.includes("organization") || low === "org"
      );
    });
    if (companyCol) {
      const names = sampleRows
        .map((r) => r[companyCol])
        .filter(Boolean)
        .slice(0, 3);
      if (names.length > 0) {
        parts.push(`Companies similar to: ${names.join(", ")}`);
      }
    }
  }

  if (parts.length === 0) {
    const firstCol = importData.columns[0];
    if (firstCol) {
      const values = sampleRows
        .map((r) => r[firstCol])
        .filter(Boolean)
        .slice(0, 3);
      parts.push(`Find ${searchType} matching: ${values.join(", ")}`);
    } else {
      parts.push(`Find ${searchType}`);
    }
  }

  return parts.join(". ");
}

function rowsToCsv(importData: ImportRecord): string {
  const { columns, rows } = importData;
  const escape = (v: string | null | undefined): string => {
    if (v == null) return "";
    const s = String(v);
    if (
      s.includes(",") ||
      s.includes('"') ||
      s.includes("\n") ||
      s.includes("\r")
    ) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [columns.map(escape).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => escape(row[c])).join(","));
  }
  return lines.join("\n") + "\n";
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

  if (job.status === "completed") {
    return `Job "${jobId}" is already completed with ${job.results.length} results.`;
  }

  const importPath = path.join(IMPORTS_DIR, `${job.importId}.json`);
  let importData: ImportRecord;
  try {
    importData = await readJsonFile<ImportRecord>(importPath);
  } catch {
    return `Error: Import "${job.importId}" not found.`;
  }

  const exa = getExaClient();
  const searchType =
    job.searchType === "auto"
      ? detectSearchType(importData.columns)
      : job.searchType;
  const useImport = hasUrlColumns(importData.columns);

  const enrichmentDefs = job.enrichments.map((desc) => ({
    description: desc,
    format: CreateEnrichmentParametersFormat.text,
  }));

  job.status = "running";
  job.progress = { found: 0, total: importData.rowCount };
  await writeJsonFile(jobPath, job);

  try {
    let websetId: string;

    if (useImport) {
      const webset = await exa.websets.create({
        enrichments: enrichmentDefs,
      });
      websetId = webset.id;

      const csvContent = rowsToCsv(importData);
      const csvBuffer = Buffer.from(csvContent, "utf8");

      const entity =
        searchType === "people"
          ? { type: "person" as const }
          : { type: "company" as const };

      const importJob = await (exa.websets as any).imports.create(websetId, {
        format: "csv",
        size: csvBuffer.length,
        count: importData.rowCount,
        entity,
      });

      if (importJob.uploadUrl) {
        await fetch(importJob.uploadUrl, {
          method: "PUT",
          body: csvBuffer,
          headers: { "Content-Type": "text/csv" },
        });
      }
    } else {
      const query = args.query || buildSearchQuery(importData, searchType);
      const count = args.count ? parseInt(args.count, 10) : importData.rowCount;

      const entityParam =
        searchType === "people"
          ? { type: "person" as const }
          : { type: "company" as const };

      const webset = await exa.websets.create({
        search: { query, count, entity: entityParam },
        enrichments: enrichmentDefs,
      });
      websetId = webset.id;
    }

    job.websetId = websetId;
    await writeJsonFile(jobPath, job);

    await exa.websets.waitUntilIdle(websetId, {
      timeout: 300_000,
      pollInterval: 5_000,
    });

    const itemsResponse = await exa.websets.items.list(websetId, {
      limit: 1000,
    });
    const items = itemsResponse.data ?? [];

    const results = mergeResults(importData, items);

    job.status = "completed";
    job.results = results;
    job.progress = { found: items.length, total: importData.rowCount };
    job.completedAt = new Date().toISOString();
    await writeJsonFile(jobPath, job);

    return [
      `Webset enrichment completed.`,
      `  Job: ${jobId}`,
      `  Webset: ${websetId}`,
      `  Mode: ${useImport ? "import" : "search"}`,
      `  Items found: ${items.length}`,
      `  Merged rows: ${results.length}`,
    ].join("\n");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    job.status = "failed";
    job.error = msg;
    await writeJsonFile(jobPath, job);
    return `Error creating webset: ${msg}`;
  }
}

export default async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await run(args);
  console.log(result);
}
