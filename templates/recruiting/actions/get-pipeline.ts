import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import * as gh from "../server/lib/greenhouse-api.js";
import { withCredentialContext } from "../server/lib/greenhouse-api.js";
import { z } from "zod";
import type { GreenhouseCandidate, PipelineStage } from "@shared/types";

/** Fetch items in batches to avoid Greenhouse API rate limits */
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

async function getPipeline(args: { jobId?: number; compact?: boolean }) {
  if (!args.jobId) throw new Error("--jobId is required");
  const jobId = args.jobId;

  const [stages, applications] = await Promise.all([
    gh.getJobStages(jobId),
    gh.listApplications({ job_id: jobId, status: "active", per_page: 100 }),
  ]);

  // Fetch recently-updated candidates for this job
  const thirtyDaysAgo = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const jobCandidates = await gh.listCandidates({
    job_id: jobId,
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

  if (args.compact) {
    return pipeline.map((s: any) => ({
      stage: s.stage.name,
      count: s.applications.length,
      candidates: s.applications.map((a: any) => ({
        id: a.candidate_id,
        name: a.candidate_name,
        company: a.candidate_company,
      })),
    })) as unknown as typeof pipeline;
  }
  return pipeline;
}

export default defineAction({
  description: "Get pipeline view for a job — candidates grouped by stage",
  schema: z.object({
    jobId: z.coerce.number().optional().describe("Job ID (required)"),
    compact: z.coerce.boolean().optional().describe("Return compact output"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const orgId = getRequestOrgId() ?? null;
    const email = getRequestUserEmail() ?? null;
    return withCredentialContext({ email, orgId }, () => getPipeline(args));
  },
});
