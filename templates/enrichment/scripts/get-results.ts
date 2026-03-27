import path from "path";
import { parseArgs } from "@agent-native/core";
import type { ScriptTool } from "@agent-native/core";
import type { EnrichmentJob, ImportRecord } from "../shared/types.js";
import {
  getExaClient,
  mergeResults,
  readJsonFile,
  writeJsonFile,
} from "../server/lib/exa.js";

const ENRICHMENTS_DIR = path.join(process.cwd(), "data", "enrichments");
const IMPORTS_DIR = path.join(process.cwd(), "data", "imports");

export const tool: ScriptTool = {
  description:
    "Fetch items from an existing webset and merge with the original import. Use this to recover results if the job was interrupted or to refresh data.",
  parameters: {
    type: "object",
    properties: {
      jobId: {
        type: "string",
        description: "The enrichment job ID",
      },
      websetId: {
        type: "string",
        description:
          "Override webset ID (uses job's websetId if not specified)",
      },
    },
    required: ["jobId"],
  },
};

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

  const websetId = args.websetId || job.websetId;
  if (!websetId) {
    return `Error: No webset ID available. Provide --websetId or create a webset first.`;
  }

  const importPath = path.join(IMPORTS_DIR, `${job.importId}.json`);
  let importData: ImportRecord;
  try {
    importData = await readJsonFile<ImportRecord>(importPath);
  } catch {
    return `Error: Import "${job.importId}" not found.`;
  }

  const exa = getExaClient();

  try {
    const itemsResponse = await exa.websets.items.list(websetId, {
      limit: 1000,
    });
    const items = itemsResponse.data ?? [];

    if (items.length === 0) {
      return `No items found in webset "${websetId}". The webset may still be processing.`;
    }

    const results = mergeResults(importData, items);

    job.websetId = websetId;
    job.results = results;
    job.progress = { found: items.length, total: importData.rowCount };
    if (job.status === "running" || job.status === "failed") {
      job.status = "completed";
      job.completedAt = new Date().toISOString();
      job.error = null;
    }
    await writeJsonFile(jobPath, job);

    return [
      `Results fetched and merged.`,
      `  Job: ${jobId}`,
      `  Webset: ${websetId}`,
      `  Items fetched: ${items.length}`,
      `  Merged rows: ${results.length}`,
    ].join("\n");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error fetching results: ${msg}`;
  }
}

export default async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await run(args);
  console.log(result);
}
