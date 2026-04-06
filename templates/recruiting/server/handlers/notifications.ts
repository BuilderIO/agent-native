import { defineEventHandler, readBody, createError } from "h3";
import { getSetting, putSetting } from "@agent-native/core/settings";
import type { ActionItemsResponse } from "./action-items.js";

type SlackConfig = {
  webhookUrl: string;
  enabled: boolean;
};

const SETTING_KEY = "slack-notifications";

async function getSlackConfig(): Promise<SlackConfig | null> {
  const setting = await getSetting(SETTING_KEY);
  if (setting && typeof setting === "object" && "webhookUrl" in setting) {
    return setting as SlackConfig;
  }
  return null;
}

export const getNotificationStatusHandler = defineEventHandler(async () => {
  const config = await getSlackConfig();
  return {
    configured: !!config?.webhookUrl,
    enabled: config?.enabled ?? false,
  };
});

export const saveNotificationConfigHandler = defineEventHandler(
  async (event) => {
    const body = await readBody(event);
    if (!body?.webhookUrl) {
      throw createError({
        statusCode: 400,
        message: "webhookUrl is required",
      });
    }

    // Validate the webhook URL format
    if (!body.webhookUrl.startsWith("https://hooks.slack.com/")) {
      throw createError({
        statusCode: 400,
        message: "Invalid Slack webhook URL",
      });
    }

    await putSetting(SETTING_KEY, {
      webhookUrl: body.webhookUrl,
      enabled: body.enabled ?? true,
    });

    return { success: true };
  },
);

export const deleteNotificationConfigHandler = defineEventHandler(async () => {
  await putSetting(SETTING_KEY, null);
  return { success: true };
});

export const sendRecruiterUpdateHandler = defineEventHandler(async (event) => {
  const body = await readBody(event);
  const config = await getSlackConfig();

  if (!config?.webhookUrl || !config.enabled) {
    throw createError({
      statusCode: 400,
      message: "Slack notifications not configured or disabled",
    });
  }

  const actionItems: ActionItemsResponse = body?.actionItems;
  if (!actionItems) {
    throw createError({
      statusCode: 400,
      message: "actionItems data is required",
    });
  }

  const blocks = buildSlackBlocks(actionItems, body?.customMessage);

  const res = await fetch(config.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocks }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw createError({
      statusCode: 502,
      message: `Slack webhook failed: ${text}`,
    });
  }

  return { success: true, sentAt: new Date().toISOString() };
});

function buildSlackBlocks(
  data: ActionItemsResponse,
  customMessage?: string,
): any[] {
  const blocks: any[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "Recruiting Pipeline Update",
      },
    },
  ];

  if (customMessage) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: customMessage },
    });
  }

  // Summary
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

  // Overdue scorecards
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
      const missing = item.missingFrom.map((m) => m.name).join(", ");
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${item.candidateName}* — ${item.jobName}\n_${item.hoursSinceInterview}h ago_ · Missing from: ${missing}`,
        },
      });
    }
  }

  // Recent scorecards
  if (data.recentScorecards.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Recent Feedback Submitted*",
      },
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
          text: `${emoji} *${item.candidateName}* — ${item.jobName}\n_${item.interviewName}_ by ${item.scorecard.submitted_by.name} · ${rec?.replace(/_/g, " ")}`,
        },
      });
    }
  }

  // Stuck candidates
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
          text: `*${item.candidateName}* — ${item.jobName}\n_${item.stageName}_ · ${item.daysInStage} days since last activity`,
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
        text: `_Sent from Recruiting App · ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}_`,
      },
    ],
  });

  return blocks;
}
