import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  slackAdapter,
  telegramAdapter,
  emailAdapter,
} from "@agent-native/core/server";
import {
  getDestinationById,
  recordAudit,
} from "../server/lib/dispatch-store.js";

function getAdapter(platform: "slack" | "telegram" | "email") {
  if (platform === "email") return emailAdapter();
  return platform === "slack" ? slackAdapter() : telegramAdapter();
}

function assertOutboundConfigured(platform: "slack" | "telegram" | "email") {
  if (platform === "slack" && !process.env.SLACK_BOT_TOKEN) {
    throw new Error("Slack outbound messaging is not configured");
  }
  if (platform === "telegram" && !process.env.TELEGRAM_BOT_TOKEN) {
    throw new Error("Telegram outbound messaging is not configured");
  }
  if (platform === "email") {
    const hasProvider = !!(
      process.env.RESEND_API_KEY || process.env.SENDGRID_API_KEY
    );
    if (!process.env.EMAIL_AGENT_ADDRESS || !hasProvider) {
      throw new Error("Email outbound messaging is not configured");
    }
  }
}

export default defineAction({
  description:
    "Send a proactive message to a saved Slack, Telegram, or email destination.",
  schema: z.object({
    platform: z.enum(["slack", "telegram", "email"]).optional(),
    destinationId: z.string().optional().describe("Saved destination id"),
    destination: z.string().optional().describe("Raw platform destination id"),
    threadRef: z.string().optional().describe("Optional thread reference"),
    text: z.string().describe("Message to send"),
  }),
  run: async ({ platform, destinationId, destination, threadRef, text }) => {
    const saved = destinationId
      ? await getDestinationById(destinationId)
      : null;
    const resolvedPlatform = (saved?.platform || platform) as
      | "slack"
      | "telegram"
      | "email"
      | undefined;
    const resolvedDestination = saved?.destination || destination;
    const resolvedThreadRef = saved?.threadRef || threadRef || null;

    if (!resolvedPlatform || !resolvedDestination) {
      throw new Error("A platform and destination are required");
    }

    assertOutboundConfigured(resolvedPlatform);

    const adapter = getAdapter(resolvedPlatform);
    if (!adapter.sendMessageToTarget) {
      throw new Error(
        `Platform ${resolvedPlatform} does not support proactive outbound messaging`,
      );
    }

    await adapter.sendMessageToTarget(adapter.formatAgentResponse(text), {
      destination: resolvedDestination,
      threadRef: resolvedThreadRef,
      label: saved?.name || undefined,
    });

    await recordAudit({
      action: "message.sent",
      targetType: "destination",
      targetId: destinationId || resolvedDestination,
      summary: `Sent proactive ${resolvedPlatform} message${saved?.name ? ` to ${saved.name}` : ""}`,
      metadata: {
        platform: resolvedPlatform,
        destination: resolvedDestination,
        threadRef: resolvedThreadRef,
        text,
      },
    });

    return {
      ok: true,
      platform: resolvedPlatform,
      destination: resolvedDestination,
      threadRef: resolvedThreadRef,
    };
  },
});
