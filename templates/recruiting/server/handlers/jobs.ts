import { defineEventHandler, getQuery, getRouterParam, createError } from "h3";
import * as gh from "../lib/greenhouse-api.js";
import type { PipelineStage } from "@shared/types";

export const listJobsHandler = defineEventHandler(async (event) => {
  const { status } = getQuery(event) as { status?: string };
  return gh.listJobs({ status });
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

  const [stages, applications, candidates] = await Promise.all([
    gh.getJobStages(id),
    gh.listApplications({ job_id: id, status: "active" }),
    gh.listCandidates({ job_id: id }),
  ]);

  const candidateMap = new Map(
    candidates.map((c) => [
      c.id,
      { name: `${c.first_name} ${c.last_name}`, company: c.company },
    ]),
  );

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
