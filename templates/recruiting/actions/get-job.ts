import { defineAction } from "@agent-native/core";
import { getRequestOrgId } from "@agent-native/core/server";
import * as gh from "../server/lib/greenhouse-api.js";
import { withOrgContext } from "../server/lib/greenhouse-api.js";
import { z } from "zod";
import type { GreenhouseCandidate } from "@shared/types";

/** Fetch items in batches to avoid Greenhouse API rate limits (50 req/10s) */
async function batchFetch<T>(
  ids: number[],
  fetcher: (id: number) => Promise<T>,
  batchSize = 10,
): Promise<Map<number, T>> {
  const results = new Map<number, T>();
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const settled = await Promise.allSettled(batch.map(fetcher));
    settled.forEach((result, idx) => {
      if (result.status === "fulfilled") {
        results.set(batch[idx], result.value);
      }
    });
    if (i + batchSize < ids.length) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  return results;
}

async function getJob(args: { id?: number }) {
  if (!args.id) throw new Error("--id is required");
  const id = args.id;

  const [job, stages, applications] = await Promise.all([
    gh.getJob(id),
    gh.getJobStages(id),
    gh.listApplications({ job_id: id, status: "active", per_page: 100 }),
  ]);

  // Fetch recently-updated candidates for this job
  const thirtyDaysAgo = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const jobCandidates = await gh.listCandidates({
    job_id: id,
    updated_after: thirtyDaysAgo,
    per_page: 100,
  });
  const candidateMap = new Map<
    number,
    { name: string; company: string | null }
  >();
  for (const c of jobCandidates) {
    candidateMap.set(c.id, {
      name: `${c.first_name} ${c.last_name}`,
      company: c.company,
    });
  }

  // Individually fetch any candidates not in the bulk result
  const missingIds = [
    ...new Set(applications.map((a) => a.candidate_id)),
  ].filter((cid) => !candidateMap.has(cid));
  if (missingIds.length > 0) {
    const fetched = await batchFetch<GreenhouseCandidate>(
      missingIds,
      (cid) => gh.getCandidate(cid),
      5,
    );
    fetched.forEach((c, cid) => {
      candidateMap.set(cid, {
        name: `${c.first_name} ${c.last_name}`,
        company: c.company,
      });
    });
  }

  const sortedStages = stages.sort((a, b) => a.priority - b.priority);
  const pipelineSummary = sortedStages.map((stage) => ({
    stage: stage.name,
    count: applications.filter((app) => app.current_stage?.id === stage.id)
      .length,
  }));

  return { ...job, pipeline_summary: pipelineSummary };
}

export default defineAction({
  description:
    "Get details about a specific job including pipeline stage summary",
  schema: z.object({
    id: z.coerce.number().optional().describe("Job ID (required)"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const orgId = getRequestOrgId();
    if (orgId) {
      return withOrgContext(orgId, () => getJob(args));
    }
    return getJob(args);
  },
});
