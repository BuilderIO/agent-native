import { type RequestHandler } from "express";

export const handleFeedback: RequestHandler = async (req, res) => {
  try {
    const { message, url, app, email, name } = req.body;
    if (!message) {
      res.status(400).json({ error: "message is required" });
      return;
    }

    const webhookUrl = process.env.SLACK_FEEDBACK_WEBHOOK_URL;
    if (!webhookUrl) {
      throw new Error("SLACK_FEEDBACK_WEBHOOK_URL env var is required");
    }

    const slackPayload = {
      text: `*New Feedback* from \`${app || "unknown"}\``,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "New Feedback", emoji: true },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*App:*\n\`${app || "unknown"}\`` },
            { type: "mrkdwn", text: `*From:*\n${name ? `${name} <${email || "N/A"}>` : email || "N/A"}` },
            { type: "mrkdwn", text: `*URL:*\n${url || "N/A"}` },
          ],
        },
        { type: "divider" },
        {
          type: "section",
          text: { type: "mrkdwn", text: `*Message:*\n${message}` },
        },
      ],
    };

    const slackRes = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(slackPayload),
    });

    if (!slackRes.ok) {
      throw new Error(`Slack webhook error: ${slackRes.status}`);
    }

    res.json({ ok: true });
  } catch (err: any) {
    console.error("Feedback error:", err.message);
    res.status(500).json({ error: err.message });
  }
};
