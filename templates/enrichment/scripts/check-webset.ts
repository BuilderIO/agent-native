import path from "path";
import { parseArgs } from "@agent-native/core";
import type { ScriptTool } from "@agent-native/core";
import type { EnrichmentJob } from "../shared/types.js";
import { getExaClient, readJsonFile, writeJsonFile } from "../server/lib/exa.js";

const ENRICHMENTS_DIR = path.join(process.cwd(), "data", "enrichments");

export const tool: ScriptTool = {
  description:
    "Check the status of an enrichment job's webset. Queries the Exa API for current progress and updates the local job file.",
  parameters: {
    type: "object",
    properties: {
      jobId: {
        type: "string",
        description: "The enrichment job ID to check",
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

  if (!job.websetId) {
    return `Error: Job "${jobId}" has no webset. Create a webset first.`;
  }

  const exa = getExaClient();

  try {
    const webset = await exa.websets.get(job.websetId);
    const items = await exa.websets.items.list(job.websetId, { limit: 0 });
    const itemCount = items.data?.length ?? 0;

    job.progress = { found: itemCount, total: job.progress.total || itemCount };

    const websetStatus = webset.status;
    if (websetStatus === "idle" && job.status === "running") {
      job.progress.total = itemCount;
    }

    await writeJsonFile(jobPath, job);

    const lines = [
      `Webset status for job "${jobId}":`,
      `  Webset ID: ${job.websetId}`,
      `  Webset status: ${websetStatus}`,
      `  Items found: ${itemCount}`,
      `  Job status: ${job.status}`,
      `  Progress: ${job.progress.found}/${job.progress.total}`,
    ];

    if (websetStatus === "idle") {
      lines.push("", "The webset has finished processing.");
    } else {
      lines.push("", "The webset is still processing. Check again later.");
    }

    return lines.join("\n");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error checking webset: ${msg}`;
  }
}

export default async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await run(args);
  console.log(result);
}
