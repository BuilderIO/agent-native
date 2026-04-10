import { defineEventHandler, getQuery } from "h3";
import { getOrgContext } from "@agent-native/core/org";
import * as gh from "../lib/greenhouse-api.js";
import { withOrgContext } from "../lib/greenhouse-api.js";
import type {
  GreenhouseScheduledInterview,
  GreenhouseScorecard,
  GreenhouseApplication,
  GreenhouseCandidate,
} from "@shared/types";

export type ScorecardStatus = {
  interview: GreenhouseScheduledInterview;
  candidateName: string;
  candidateId: number;
  jobName: string;
  applicationId: number;
  scorecards: GreenhouseScorecard[];
  /** Interviewers who haven't submitted a scorecard yet */
  missingFrom: { id: number; name: string; email: string }[];
  /** Hours since the interview ended */
  hoursSinceInterview: number;
  status: "complete" | "overdue" | "pending";
};

export type StuckCandidate = {
  applicationId: number;
  candidateId: number;
  candidateName: string;
  jobName: string;
  stageName: string;
  daysInStage: number;
  lastActivityAt: string;
};

export type RecentScorecard = {
  scorecard: GreenhouseScorecard;
  candidateName: string;
  candidateId: number;
  jobName: string;
  interviewName: string;
  applicationId: number;
};

export type ActionItemsResponse = {
  overdueScorecards: ScorecardStatus[];
  pendingScorecards: ScorecardStatus[];
  recentScorecards: RecentScorecard[];
  stuckCandidates: StuckCandidate[];
  summary: {
    overdueScorecardCount: number;
    pendingScorecardCount: number;
    recentScorecardCount: number;
    stuckCandidateCount: number;
    totalActionItems: number;
  };
};

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

export const getActionItemsHandler = defineEventHandler(
  async (event): Promise<ActionItemsResponse> => {
    const ctx = await getOrgContext(event);
    const run = async (): Promise<ActionItemsResponse> => {
    const query = getQuery(event) as {
      overdue_hours?: string;
      stuck_days?: string;
    };

    const overdueThresholdHours = Number(query.overdue_hours) || 24;
    const stuckThresholdDays = Number(query.stuck_days) || 5;
    const now = new Date();

    // Fetch interviews from the last 14 days (covers recent + overdue window)
    const fourteenDaysAgo = new Date(
      now.getTime() - 14 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const thirtyDaysAgo = new Date(
      now.getTime() - 30 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const [interviews, openJobs] = await Promise.all([
      gh.listScheduledInterviews({ created_after: fourteenDaysAgo }),
      gh.listJobs({ status: "open" }),
    ]);

    // Filter to past interviews only (already happened)
    const pastInterviews = interviews.filter(
      (i) => new Date(i.end.date_time) < now,
    );

    // Get unique application IDs from past interviews
    const applicationIds = [
      ...new Set(pastInterviews.map((i) => i.application_id)),
    ];

    // Fetch scorecards for each application
    const scorecardsByApp = await batchFetch<GreenhouseScorecard[]>(
      applicationIds,
      (appId) => gh.listScorecards(appId),
      8,
    );

    // Fetch applications to get candidate IDs and job info
    const applications = await batchFetch<GreenhouseApplication>(
      applicationIds,
      (appId) => gh.getApplication(appId),
      8,
    );

    // Get unique candidate IDs
    const candidateIds = [
      ...new Set([...applications.values()].map((a) => a.candidate_id)),
    ];

    // Fetch candidates for names
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

    // Analyze scorecard status per interview
    const overdueScorecards: ScorecardStatus[] = [];
    const pendingScorecards: ScorecardStatus[] = [];
    const allRecentScorecards: RecentScorecard[] = [];
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

      // Find which interviewers have submitted scorecards
      const submittedByIds = new Set(scorecards.map((s) => s.submitted_by.id));
      const missingFrom = interview.interviewers.filter(
        (i) => !submittedByIds.has(i.id),
      );

      if (missingFrom.length > 0) {
        const item: ScorecardStatus = {
          interview,
          candidateName,
          candidateId: app.candidate_id,
          jobName,
          applicationId: interview.application_id,
          scorecards,
          missingFrom,
          hoursSinceInterview: Math.round(hoursSince),
          status: hoursSince > overdueThresholdHours ? "overdue" : "pending",
        };

        if (item.status === "overdue") {
          overdueScorecards.push(item);
        } else {
          pendingScorecards.push(item);
        }
      }

      // Collect recent scorecards (last 7 days), deduplicating by scorecard ID
      // since multiple interviews for the same application share scorecards
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

    // Sort overdue by most overdue first
    overdueScorecards.sort(
      (a, b) => b.hoursSinceInterview - a.hoursSinceInterview,
    );

    // Sort recent scorecards by submission date (newest first)
    allRecentScorecards.sort(
      (a, b) =>
        new Date(b.scorecard.submitted_at).getTime() -
        new Date(a.scorecard.submitted_at).getTime(),
    );

    // --- Stuck candidates: active applications with no recent activity ---
    const stuckCandidates: StuckCandidate[] = [];

    // Fetch active applications across open jobs
    const activeApps: GreenhouseApplication[] = [];
    for (const job of openJobs.slice(0, 20)) {
      const apps = await gh.listApplications({
        job_id: job.id,
        status: "active",
        per_page: 100,
      });
      activeApps.push(...apps);
      // Rate limit pause
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

    // Sort stuck by longest waiting first
    stuckCandidates.sort((a, b) => b.daysInStage - a.daysInStage);

    return {
      overdueScorecards,
      pendingScorecards,
      recentScorecards: allRecentScorecards,
      stuckCandidates,
      summary: {
        overdueScorecardCount: overdueScorecards.length,
        pendingScorecardCount: pendingScorecards.length,
        recentScorecardCount: allRecentScorecards.length,
        stuckCandidateCount: stuckCandidates.length,
        totalActionItems: overdueScorecards.length + stuckCandidates.length,
      },
    };
    };
    return ctx.orgId ? withOrgContext(ctx.orgId, run) : run();
  },
);
