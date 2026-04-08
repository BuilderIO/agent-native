import { defineAction } from "@agent-native/core";
import * as gh from "../server/lib/greenhouse-api.js";
import { withOrgContext } from "../server/lib/greenhouse-api.js";
import type { GreenhouseApplication, GreenhouseCandidate } from "@shared/types";

async function pipelineHealth(args: Record<string, string>) {
  const stuckThresholdDays = Number(args.stuckDays) || 5;
  const now = new Date();

  const openJobs = await gh.listJobs({ status: "open" });
  const candidateNameMap = new Map<number, string>();
  const stuckCandidates: any[] = [];

  // Fetch active applications across open jobs
  const activeApps: GreenhouseApplication[] = [];
  for (const job of openJobs.slice(0, 20)) {
    const apps = await gh.listApplications({
      job_id: job.id,
      status: "active",
      per_page: 100,
    });
    activeApps.push(...apps);
    await new Promise((r) => setTimeout(r, 100));
  }

  for (const app of activeApps) {
    if (!app.current_stage) continue;
    const daysSinceActivity =
      (now.getTime() - new Date(app.last_activity_at).getTime()) /
      (1000 * 60 * 60 * 24);

    if (daysSinceActivity >= stuckThresholdDays) {
      let name = candidateNameMap.get(app.candidate_id);
      if (!name) {
        try {
          const c = await gh.getCandidate(app.candidate_id);
          name = `${c.first_name} ${c.last_name}`;
          candidateNameMap.set(app.candidate_id, name);
        } catch {
          name = "Unknown";
        }
      }

      stuckCandidates.push({
        applicationId: app.id,
        candidateId: app.candidate_id,
        candidateName: name,
        jobName: app.jobs?.[0]?.name ?? "Unknown Job",
        stageName: app.current_stage.name,
        daysInStage: Math.round(daysSinceActivity),
        lastActivityAt: app.last_activity_at,
      });
    }
  }

  stuckCandidates.sort((a, b) => b.daysInStage - a.daysInStage);

  return {
    stuckCandidates,
    summary: {
      stuckCandidateCount: stuckCandidates.length,
    },
  };
}

export default defineAction({
  description:
    "Check pipeline health -- find candidates stuck in a stage with no activity.",
  parameters: {
    stuckDays: {
      type: "string",
      description:
        "Number of days of inactivity before a candidate is considered stuck (default: 5)",
    },
  },
  http: { method: "GET" },
  run: async (args) => {
    const orgId = process.env.AGENT_ORG_ID;
    if (orgId) {
      return withOrgContext(orgId, () => pipelineHealth(args));
    }
    return pipelineHealth(args);
  },
});
