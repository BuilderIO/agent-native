import fs from "fs/promises";
import path from "path";
import { parseArgs } from "@agent-native/core";
import type { ScriptTool } from "@agent-native/core";
import type { EnrichmentJob } from "../shared/types.js";

const ENRICHMENTS_DIR = path.join(process.cwd(), "data", "enrichments");

export const tool: ScriptTool = {
  description:
    "List all enrichment jobs with their status, progress, and associated import. Shows pending, running, completed, and failed jobs.",
  parameters: {
    type: "object",
    properties: {
      status: {
        type: "string",
        description: "Filter by status",
        enum: ["pending", "running", "completed", "failed"],
      },
    },
  },
};

async function listEnrichmentFiles(): Promise<EnrichmentJob[]> {
  try {
    const entries = await fs.readdir(ENRICHMENTS_DIR);
    const jsonFiles = entries.filter((f) => f.endsWith(".json"));
    const jobs: EnrichmentJob[] = [];
    for (const file of jsonFiles) {
      try {
        const raw = await fs.readFile(path.join(ENRICHMENTS_DIR, file), "utf8");
        jobs.push(JSON.parse(raw) as EnrichmentJob);
      } catch {
        // skip malformed files
      }
    }
    return jobs.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  } catch {
    return [];
  }
}

export async function run(args: Record<string, string>): Promise<string> {
  let jobs = await listEnrichmentFiles();

  if (args.status) {
    jobs = jobs.filter((j) => j.status === args.status);
  }

  if (jobs.length === 0) {
    return args.status
      ? `No enrichment jobs with status "${args.status}".`
      : "No enrichment jobs found. Create one first.";
  }

  const lines = [`Found ${jobs.length} enrichment job(s):`, ""];
  for (const job of jobs) {
    const pct =
      job.progress.total > 0
        ? Math.round((job.progress.found / job.progress.total) * 100)
        : 0;
    lines.push(`• Job ${job.id} [${job.status.toUpperCase()}]`);
    lines.push(`  Import: ${job.importId} | Search: ${job.searchType}`);
    lines.push(
      `  Progress: ${job.progress.found}/${job.progress.total} (${pct}%)`,
    );
    if (job.websetId) {
      lines.push(`  Webset: ${job.websetId}`);
    }
    if (job.enrichments.length > 0) {
      lines.push(`  Enrichments: ${job.enrichments.join(", ")}`);
    }
    if (job.error) {
      lines.push(`  Error: ${job.error}`);
    }
    if (job.lastExportId) {
      lines.push(`  Last export: ${job.lastExportId}`);
    }
    lines.push(`  Created: ${job.createdAt}`);
    if (job.completedAt) {
      lines.push(`  Completed: ${job.completedAt}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export default async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await run(args);
  console.log(result);
}
