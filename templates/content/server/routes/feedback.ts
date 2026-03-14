import { Request, Response } from "express";

interface FeedbackPayload {
  message: string;
  user?: {
    name?: string;
    email?: string;
  };
}

export async function sendFeedback(req: Request, res: Response) {
  const { message, user }: FeedbackPayload = req.body;

  if (!message?.trim()) {
    res.status(400).json({ error: "Message is required" });
    return;
  }

  const webhookUrl = process.env.SLACK_FEEDBACK_WEBHOOK_URL;
  if (!webhookUrl) {
    res.status(503).json({ error: "Slack webhook not configured" });
    return;
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

  // Fire and forget — respond immediately, let Slack call happen in background
  res.json({ ok: true });

  fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(slackPayload),
  }).catch((err) => {
    console.error("[feedback] Slack webhook error:", err);
  });
}
