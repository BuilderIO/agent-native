import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { slackAdapter, telegramAdapter } from "@agent-native/core/server";
import {
  getDestinationById,
  recordAudit,
} from "../server/lib/dispatch-store.js";

function getAdapter(platform: "slack" | "telegram") {
  return platform === "slack" ? slackAdapter() : telegramAdapter();
}

export default defineAction({
  description:
    "Send a proactive message to a saved Slack or Telegram destination.",
  schema: z.object({
    platform: z.enum(["slack", "telegram"]).optional(),
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
      | undefined;
    const resolvedDestination = saved?.destination || destination;
    const resolvedThreadRef = saved?.threadRef || threadRef || null;

    if (!resolvedPlatform || !resolvedDestination) {
      throw new Error("A platform and destination are required");
    }

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
