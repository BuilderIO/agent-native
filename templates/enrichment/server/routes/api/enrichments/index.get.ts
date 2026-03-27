import fs from "fs/promises";
import path from "path";
import { defineEventHandler, getQuery } from "h3";
import type { EnrichmentJob } from "../../../../shared/types.js";

const ENRICHMENTS_DIR = path.join(process.cwd(), "data", "enrichments");

export default defineEventHandler(async (event) => {
  const { importId } = getQuery(event);
  const filterImportId =
    typeof importId === "string" && importId.length > 0 ? importId : undefined;

  let entries: string[];
  try {
    entries = await fs.readdir(ENRICHMENTS_DIR);
  } catch {
    return [];
  }

  const jsonFiles = entries.filter((f) => f.endsWith(".json"));
  const jobs: EnrichmentJob[] = [];

  for (const file of jsonFiles) {
    try {
      const raw = await fs.readFile(path.join(ENRICHMENTS_DIR, file), "utf8");
      const job = JSON.parse(raw) as EnrichmentJob;
      if (filterImportId !== undefined && job.importId !== filterImportId) {
        continue;
      }
      jobs.push(job);
    } catch {
      // skip malformed files
    }
  }

  jobs.sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return jobs;
});
