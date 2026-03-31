import { defineEventHandler, getQuery, getRouterParam, createError } from "h3";
import * as gh from "../lib/greenhouse-api.js";
import type { PipelineStage, GreenhouseCandidate } from "@shared/types";

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
    // Delay between batches to stay within Greenhouse rate limits
    if (i + batchSize < ids.length) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  return results;
}

export const listJobsHandler = defineEventHandler(async (event) => {
  const query = getQuery(event) as {
    status?: string;
    per_page?: string;
    page?: string;
  };
  return gh.listJobs({
    status: query.status,
    per_page: Number(query.per_page) || 100,
    page: Number(query.page) || 1,
  });
});

export const getJobHandler = defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, "id"));
  if (!id) throw createError({ statusCode: 400, message: "Job ID required" });
  return gh.getJob(id);
});

export const getJobStagesHandler = defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, "id"));
  if (!id) throw createError({ statusCode: 400, message: "Job ID required" });
  return gh.getJobStages(id);
});

export const getJobPipelineHandler = defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, "id"));
  if (!id) throw createError({ statusCode: 400, message: "Job ID required" });

  const [stages, applications] = await Promise.all([
    gh.getJobStages(id),
    // Fetch only the first page of applications (max 100) for fast pipeline load.
    // Jobs with thousands of applications would be too slow to paginate entirely.
    gh.listApplications({ job_id: id, status: "active", per_page: 100 }),
  ]);

  // Fetch recently-updated candidates for this job (more likely to match active pipeline)
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
  ].filter((id) => !candidateMap.has(id));
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
  const pipeline: PipelineStage[] = sortedStages.map((stage) => ({
    stage,
    applications: applications
      .filter((app) => app.current_stage?.id === stage.id)
      .map((app) => ({
        ...app,
        candidate_name: candidateMap.get(app.candidate_id)?.name ?? "Unknown",
        candidate_company: candidateMap.get(app.candidate_id)?.company ?? null,
      })),
  }));

  return pipeline;
});
