import { defineEventHandler, getQuery, getRouterParam, createError } from "h3";
import * as gh from "../lib/greenhouse-api.js";
import type { PipelineStage } from "@shared/types";

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

  // Fetch candidate details for the applications we have (max 100, in parallel)
  const uniqueCandidateIds = [
    ...new Set(applications.map((a) => a.candidate_id)),
  ];
  const candidateResults = await Promise.allSettled(
    uniqueCandidateIds.map((cid) => gh.getCandidate(cid)),
  );
  const candidateMap = new Map<
    number,
    { name: string; company: string | null }
  >();
  candidateResults.forEach((result) => {
    if (result.status === "fulfilled") {
      const c = result.value;
      candidateMap.set(c.id, {
        name: `${c.first_name} ${c.last_name}`,
        company: c.company,
      });
    }
  });

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
