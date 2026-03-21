import {
  defineEventHandler,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";

interface FeedbackPayload {
  message: string;
  user?: {
    name?: string;
    email?: string;
  };
}

export const sendFeedback = defineEventHandler(async (event: H3Event) => {
  const { message, user }: FeedbackPayload = await readBody(event);

  if (!message?.trim()) {
    setResponseStatus(event, 400);
    return { error: "Message is required" };
  }

  const webhookUrl = process.env.SLACK_FEEDBACK_WEBHOOK_URL;
  if (!webhookUrl) {
    setResponseStatus(event, 503);
    return { error: "Slack webhook not configured" };
  }

  const userLine =
    user?.name || user?.email
      ? `*From:* ${[user.name, user.email].filter(Boolean).join(" · ")}`
      : "*From:* Anonymous";

  const slackPayload = {
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "Content Workspace Feedback",
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: message.trim(),
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: userLine,
          },
        ],
      },
    ],
  };

  // Fire and forget - respond immediately, let Slack call happen in background
  fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(slackPayload),
  }).catch((err) => {
    console.error("[feedback] Slack webhook error:", err);
  });

  return { ok: true };
});
