import { defineEventHandler, readBody, setResponseStatus } from "h3";

export const handleFeedback = defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { message, path, app, userName, userEmail } = body;
  if (!message) {
    setResponseStatus(event, 400);
    return { error: "message is required" };
  }

  // Respond immediately — don't wait for Slack
  const webhookUrl = process.env.SLACK_FEEDBACK_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error("SLACK_FEEDBACK_WEBHOOK_URL env var is not set");
    return { ok: true };
  }

  const userLabel =
    userName && userEmail
      ? `${userName} (${userEmail})`
      : userName || userEmail || "anonymous";

  const metaFields = [
    { type: "mrkdwn", text: `*App:*\n\`${app || "unknown"}\`` },
    { type: "mrkdwn", text: `*Path:*\n${path || "N/A"}` },
    { type: "mrkdwn", text: `*User:*\n${userLabel}` },
  ];

  const slackPayload = {
    text: `*New Feedback* from \`${app || "unknown"}\` by ${userLabel}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "New Feedback", emoji: true },
      },
      {
        type: "section",
        fields: metaFields,
      },
      { type: "divider" },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Message:*\n${message}` },
      },
    ],
  };

  // Fire and forget
  fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(slackPayload),
  }).catch((err) => {
    console.error("Slack webhook error:", err.message);
  });

  return { ok: true };
});
