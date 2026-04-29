import { defineEventHandler, createError } from "h3";
import {
  getSetting,
  putSetting,
  deleteSetting,
} from "@agent-native/core/settings";
import { getOrgContext } from "@agent-native/core/org";
import type { ActionItemsResponse } from "./action-items.js";
import { readBody } from "@agent-native/core/server";

type SlackConfig = {
  webhookUrl: string;
  enabled: boolean;
};

/**
 * Build the per-user / per-org settings key for the Slack webhook config.
 *
 * SECURITY: The unprefixed `slack-notifications` setting must NEVER be
 * read or written — every Neon deployment is shared across solo users, so
 * an unscoped key leaks each user's webhook URL to every other user. When
 * an org is active we scope by org, otherwise we scope by the caller's
 * email. If neither is available we throw rather than silently leak.
 */
function slackSettingsKey(
  orgId: string | null,
  email: string | null,
): string {
  if (orgId) return `o:${orgId}:slack-notifications`;
  if (email) return `u:${email.toLowerCase()}:slack-notifications`;
  throw createError({
    statusCode: 401,
    message: "Sign in to manage Slack notifications.",
  });
}

async function getSlackConfig(
  orgId: string | null,
  email: string | null,
): Promise<SlackConfig | null> {
  const setting = await getSetting(slackSettingsKey(orgId, email));
  if (setting && typeof setting === "object" && "webhookUrl" in setting) {
    return setting as SlackConfig;
  }
  // No fall-back to the unprefixed global key — that's the leak we're
  // fixing. Solo users who previously stored a webhook under the global
  // key will see "not configured" and need to re-save through the UI.
  return null;
}

export const getNotificationStatusHandler = defineEventHandler(
  async (event) => {
    const ctx = await getOrgContext(event);
    if (!ctx.orgId && !ctx.email) {
      // Not signed in — surface a benign "not configured" rather than
      // throwing. The UI can prompt the user to sign in.
      return { configured: false, enabled: false };
    }
    const config = await getSlackConfig(ctx.orgId, ctx.email || null);
    return {
      configured: !!config?.webhookUrl,
      enabled: config?.enabled ?? false,
    };
  },
);

export const saveNotificationConfigHandler = defineEventHandler(
  async (event) => {
    const ctx = await getOrgContext(event);
    if (!ctx.email) {
      throw createError({
        statusCode: 401,
        message: "Sign in to manage Slack notifications.",
      });
    }
    // Owner/admin role gating only applies when the caller is acting on
    // behalf of an org. Solo users (no orgId) own their per-user webhook.
    if (ctx.orgId && ctx.role !== "owner" && ctx.role !== "admin") {
      throw createError({
        statusCode: 403,
        message: "Only owners and admins can manage Slack configuration",
      });
    }
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

    await putSetting(slackSettingsKey(ctx.orgId, ctx.email), {
      webhookUrl: body.webhookUrl,
      enabled: body.enabled ?? true,
    });

    return { success: true };
  },
);

export const deleteNotificationConfigHandler = defineEventHandler(
  async (event) => {
    const ctx = await getOrgContext(event);
    if (!ctx.email) {
      throw createError({
        statusCode: 401,
        message: "Sign in to manage Slack notifications.",
      });
    }
    if (ctx.orgId && ctx.role !== "owner" && ctx.role !== "admin") {
      throw createError({
        statusCode: 403,
        message: "Only owners and admins can manage Slack configuration",
      });
    }
    await deleteSetting(slackSettingsKey(ctx.orgId, ctx.email));
    return { success: true };
  },
);

export const sendRecruiterUpdateHandler = defineEventHandler(async (event) => {
  const ctx = await getOrgContext(event);
  if (!ctx.orgId && !ctx.email) {
    throw createError({
      statusCode: 401,
      message: "Sign in to send Slack notifications.",
    });
  }
  const body = await readBody(event);
  const config = await getSlackConfig(ctx.orgId, ctx.email || null);

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
