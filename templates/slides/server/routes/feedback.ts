import { type RequestHandler } from "express";

export const handleFeedback: RequestHandler = (req, res) => {
  const { message, path, app, userName, userEmail } = req.body;
  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  // Respond immediately — don't wait for Slack
  res.json({ ok: true });

  const webhookUrl = process.env.SLACK_FEEDBACK_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error("SLACK_FEEDBACK_WEBHOOK_URL env var is not set");
    return;
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
};
