import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import * as gh from "../server/lib/greenhouse-api.js";
import { withCredentialContext } from "../server/lib/greenhouse-api.js";
import { z } from "zod";
import type {
  GreenhouseScheduledInterview,
  GreenhouseScorecard,
  GreenhouseApplication,
  GreenhouseCandidate,
} from "@shared/types";

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

async function checkScorecards(args: {
  overdueHours?: number;
  section?: string;
}) {
  const overdueThresholdHours = args.overdueHours || 24;
  const now = new Date();

  const fourteenDaysAgo = new Date(
    now.getTime() - 14 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const interviews = await gh.listScheduledInterviews({
    created_after: fourteenDaysAgo,
  });

  const pastInterviews = interviews.filter(
    (i) => new Date(i.end.date_time) < now,
  );

  const applicationIds = [
    ...new Set(pastInterviews.map((i) => i.application_id)),
  ];

  const scorecardsByApp = await batchFetch<GreenhouseScorecard[]>(
    applicationIds,
    (appId) => gh.listScorecards(appId),
    8,
  );

  const applications = await batchFetch<GreenhouseApplication>(
    applicationIds,
    (appId) => gh.getApplication(appId),
    8,
  );

  const candidateIds = [
    ...new Set([...applications.values()].map((a) => a.candidate_id)),
  ];

  const candidates = await batchFetch<GreenhouseCandidate>(
    candidateIds,
    (id) => gh.getCandidate(id),
    8,
  );

  const candidateNameMap = new Map<number, string>();
  candidates.forEach((c) => {
    candidateNameMap.set(c.id, `${c.first_name} ${c.last_name}`);
  });

  const jobNameMap = new Map<number, string>();
  for (const app of applications.values()) {
    if (app.jobs?.[0]) {
      jobNameMap.set(app.id, app.jobs[0].name);
    }
  }

  const overdueScorecards: any[] = [];
  const pendingScorecards: any[] = [];
  const allRecentScorecards: any[] = [];
  const seenScorecardIds = new Set<number>();

  for (const interview of pastInterviews) {
    const app = applications.get(interview.application_id);
    if (!app) continue;

    const scorecards = scorecardsByApp.get(interview.application_id) || [];
    const candidateName = candidateNameMap.get(app.candidate_id) ?? "Unknown";
    const jobName = jobNameMap.get(app.id) ?? "Unknown Job";

    const hoursSince =
      (now.getTime() - new Date(interview.end.date_time).getTime()) /
      (1000 * 60 * 60);

    const submittedByIds = new Set(scorecards.map((s) => s.submitted_by.id));
    const missingFrom = interview.interviewers.filter(
      (i) => !submittedByIds.has(i.id),
    );

    if (missingFrom.length > 0) {
      const item = {
        interview,
        candidateName,
        candidateId: app.candidate_id,
        jobName,
        applicationId: interview.application_id,
        scorecards,
        missingFrom,
        hoursSinceInterview: Math.round(hoursSince),
        status:
          hoursSince > overdueThresholdHours ? "overdue" : ("pending" as const),
      };

      if (item.status === "overdue") {
        overdueScorecards.push(item);
      } else {
        pendingScorecards.push(item);
      }
    }

    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    for (const sc of scorecards) {
      if (new Date(sc.submitted_at) > sevenDaysAgo) {
        if (!seenScorecardIds.has(sc.id)) {
          seenScorecardIds.add(sc.id);
          allRecentScorecards.push({
            scorecard: sc,
            candidateName,
            candidateId: app.candidate_id,
            jobName,
            interviewName: sc.interview,
            applicationId: interview.application_id,
          });
        }
      }
    }
  }

  overdueScorecards.sort(
    (a, b) => b.hoursSinceInterview - a.hoursSinceInterview,
  );
  allRecentScorecards.sort(
    (a, b) =>
      new Date(b.scorecard.submitted_at).getTime() -
      new Date(a.scorecard.submitted_at).getTime(),
  );

  const result = {
    overdueScorecards,
    pendingScorecards,
    recentScorecards: allRecentScorecards,
    summary: {
      overdueScorecardCount: overdueScorecards.length,
      pendingScorecardCount: pendingScorecards.length,
      recentScorecardCount: allRecentScorecards.length,
    },
  };

  if (args.section && args.section !== "all") {
    const sectionMap: Record<string, string> = {
      overdue: "overdueScorecards",
      pending: "pendingScorecards",
      recent: "recentScorecards",
    };
    const key = sectionMap[args.section];
    return {
      [args.section]: (result as any)[key],
      count: (result as any)[key]?.length ?? 0,
    };
  }

  return result;
}

export default defineAction({
  description:
    "Check scorecard status -- find overdue scorecards, pending feedback, and recently submitted scorecards.",
  schema: z.object({
    overdueHours: z.coerce
      .number()
      .optional()
      .describe(
        "Hours after interview to consider a scorecard overdue (default: 24)",
      ),
    section: z
      .enum(["overdue", "pending", "recent", "all"])
      .optional()
      .describe(
        "Which section to return: overdue, pending, recent, or all (default: all)",
      ),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const orgId = getRequestOrgId() ?? null;
    const email = getRequestUserEmail() ?? null;
    return withCredentialContext({ email, orgId }, () => checkScorecards(args));
  },
});
