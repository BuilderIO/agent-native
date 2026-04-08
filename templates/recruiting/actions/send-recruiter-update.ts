import { defineAction } from "@agent-native/core";
import * as gh from "../server/lib/greenhouse-api.js";
import { withOrgContext } from "../server/lib/greenhouse-api.js";
import { getSetting } from "@agent-native/core/settings";
import type {
  GreenhouseScorecard,
  GreenhouseApplication,
  GreenhouseCandidate,
} from "@shared/types";

type SlackConfig = {
  webhookUrl: string;
  enabled: boolean;
};

function slackSettingsKey(orgId: string | null): string {
  return orgId ? `org:${orgId}:slack-notifications` : "slack-notifications";
}

async function getSlackConfig(
  orgId: string | null,
): Promise<SlackConfig | null> {
  const setting = await getSetting(slackSettingsKey(orgId));
  if (setting && typeof setting === "object" && "webhookUrl" in setting) {
    return setting as SlackConfig;
  }
  if (orgId) {
    const global = await getSetting("slack-notifications");
    if (global && typeof global === "object" && "webhookUrl" in global) {
      return global as SlackConfig;
    }
  }
  return null;
}

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

async function fetchActionItems() {
  const now = new Date();
  const fourteenDaysAgo = new Date(
    now.getTime() - 14 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const [interviews, openJobs] = await Promise.all([
    gh.listScheduledInterviews({ created_after: fourteenDaysAgo }),
    gh.listJobs({ status: "open" }),
  ]);

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
    if (app.jobs?.[0]) jobNameMap.set(app.id, app.jobs[0].name);
  }

  const overdueScorecards: any[] = [];
  const pendingScorecards: any[] = [];
  const recentScorecards: any[] = [];
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
        candidateName,
        candidateId: app.candidate_id,
        jobName,
        applicationId: interview.application_id,
        missingFrom,
        hoursSinceInterview: Math.round(hoursSince),
        status: hoursSince > 24 ? "overdue" : "pending",
      };
      if (item.status === "overdue") overdueScorecards.push(item);
      else pendingScorecards.push(item);
    }

    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    for (const sc of scorecards) {
      if (
        new Date(sc.submitted_at) > sevenDaysAgo &&
        !seenScorecardIds.has(sc.id)
      ) {
        seenScorecardIds.add(sc.id);
        recentScorecards.push({
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

  // Stuck candidates
  const stuckCandidates: any[] = [];
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
    if (daysSinceActivity >= 5) {
      let name = candidateNameMap.get(app.candidate_id);
      if (!name) {
        try {
          const c = await gh.getCandidate(app.candidate_id);
          name = `${c.first_name} ${c.last_name}`;
        } catch {
          name = "Unknown";
        }
      }
      stuckCandidates.push({
        candidateName: name,
        jobName: app.jobs?.[0]?.name ?? "Unknown Job",
        stageName: app.current_stage.name,
        daysInStage: Math.round(daysSinceActivity),
      });
    }
  }
  stuckCandidates.sort((a, b) => b.daysInStage - a.daysInStage);

  return {
    overdueScorecards,
    pendingScorecards,
    recentScorecards,
    stuckCandidates,
    summary: {
      overdueScorecardCount: overdueScorecards.length,
      pendingScorecardCount: pendingScorecards.length,
      recentScorecardCount: recentScorecards.length,
      stuckCandidateCount: stuckCandidates.length,
    },
  };
}

function buildSlackBlocks(data: any, customMessage?: string): any[] {
  const blocks: any[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "Recruiting Pipeline Update" },
    },
  ];

  if (customMessage) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: customMessage },
    });
  }

  blocks.push({
    type: "section",
    fields: [
      {
        type: "mrkdwn",
        text: `*Overdue Scorecards:* ${data.summary.overdueScorecardCount}`,
      },
      {
        type: "mrkdwn",
        text: `*Pending Scorecards:* ${data.summary.pendingScorecardCount}`,
      },
      {
        type: "mrkdwn",
        text: `*Recent Feedback:* ${data.summary.recentScorecardCount}`,
      },
      {
        type: "mrkdwn",
        text: `*Stuck Candidates:* ${data.summary.stuckCandidateCount}`,
      },
    ],
  });

  if (data.overdueScorecards.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Overdue Feedback*\nThese interviews happened but scorecards haven't been submitted:",
      },
    });
    for (const item of data.overdueScorecards.slice(0, 10)) {
      const missing = item.missingFrom.map((m: any) => m.name).join(", ");
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${item.candidateName}* -- ${item.jobName}\n_${item.hoursSinceInterview}h ago_ -- Missing from: ${missing}`,
        },
      });
    }
  }

  if (data.recentScorecards.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "*Recent Feedback Submitted*" },
    });
    for (const item of data.recentScorecards.slice(0, 10)) {
      const rec = item.scorecard.overall_recommendation;
      const emoji =
        rec === "strong_yes"
          ? ":star2:"
          : rec === "yes"
            ? ":thumbsup:"
            : rec === "no"
              ? ":thumbsdown:"
              : rec === "strong_no"
                ? ":x:"
                : ":grey_question:";
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${emoji} *${item.candidateName}* -- ${item.jobName}\n_${item.interviewName}_ by ${item.scorecard.submitted_by.name} -- ${rec?.replace(/_/g, " ")}`,
        },
      });
    }
  }

  if (data.stuckCandidates.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Stuck Candidates*\nNo activity for 5+ days:",
      },
    });
    for (const item of data.stuckCandidates.slice(0, 10)) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${item.candidateName}* -- ${item.jobName}\n_${item.stageName}_ -- ${item.daysInStage} days since last activity`,
        },
      });
    }
  }

  blocks.push({ type: "divider" });
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `_Sent from Recruiting App -- ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}_`,
      },
    ],
  });

  return blocks;
}

export default defineAction({
  description:
    "Send a recruiting pipeline status update to the configured Slack channel.",
  parameters: {
    customMessage: {
      type: "string",
      description:
        "Optional custom message to include at the top of the update",
    },
  },
  http: false,
  run: async (args) => {
    const orgId = process.env.AGENT_ORG_ID || null;

    const config = await getSlackConfig(orgId);
    if (!config?.webhookUrl || !config.enabled) {
      return {
        error:
          "Slack notifications not configured. Go to Settings to add a webhook URL.",
      };
    }

    const actionItems = orgId
      ? await withOrgContext(orgId, fetchActionItems)
      : await fetchActionItems();

    const blocks = buildSlackBlocks(actionItems, args.customMessage);

    const res = await fetch(config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { error: `Slack webhook failed: ${text}` };
    }

    return { success: true, sentAt: new Date().toISOString() };
  },
});
