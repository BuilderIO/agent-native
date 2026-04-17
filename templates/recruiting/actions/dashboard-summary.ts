import { defineAction } from "@agent-native/core";
import { getRequestOrgId } from "@agent-native/core/server";
import * as gh from "../server/lib/greenhouse-api.js";
import { withOrgContext } from "../server/lib/greenhouse-api.js";
import type { DashboardStats } from "@shared/types";

async function getDashboard(): Promise<DashboardStats> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [jobs, recentApps, interviews] = await Promise.all([
    gh.listJobs({ status: "open" }),
    gh.listApplications({
      created_after: weekAgo.toISOString(),
      per_page: 100,
    }),
    gh.listScheduledInterviews({
      created_after: new Date(
        now.getTime() - 365 * 24 * 60 * 60 * 1000,
      ).toISOString(),
    }),
  ]);

  const upcomingInterviews = interviews.filter(
    (i) => new Date(i.start.date_time) > now,
  );

  const recentApplications = recentApps
    .sort(
      (a, b) =>
        new Date(b.applied_at).getTime() - new Date(a.applied_at).getTime(),
    )
    .slice(0, 10);

  const uniqueCandidateIds = [
    ...new Set(recentApplications.map((a) => a.candidate_id)),
  ];
  const candidateResults = await Promise.allSettled(
    uniqueCandidateIds.map((id) => gh.getCandidate(id)),
  );
  const candidateNames = new Map<number, string>();
  candidateResults.forEach((result) => {
    if (result.status === "fulfilled") {
      const c = result.value;
      candidateNames.set(c.id, `${c.first_name} ${c.last_name}`);
    }
  });

  const enrichedApplications = recentApplications.map((app) => ({
    ...app,
    candidate_name: candidateNames.get(app.candidate_id) ?? "Unknown",
  }));

  return {
    openJobs: jobs.length,
    activeCandidates: recentApps.length,
    upcomingInterviews: upcomingInterviews.length,
    recentApplications: enrichedApplications,
  };
}

export default defineAction({
  description: "Get a summary of dashboard statistics",
  http: { method: "GET" },
  run: async () => {
    const orgId = getRequestOrgId();
    if (orgId) {
      return withOrgContext(orgId, getDashboard);
    }
    return getDashboard();
  },
});
