import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";
import {
  enqueueRemoteCodeCommand,
  type RemoteCodeCommandEnvelope,
} from "../server/lib/dispatch-remote-commands.js";

const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create"), prompt: z.string().min(1) }),
  z.object({ type: z.literal("list") }),
  z.object({ type: z.literal("status"), runRef: z.string().optional() }),
  z.object({
    type: z.literal("continue"),
    runRef: z.string().min(1),
    text: z.string().min(1),
  }),
  z.object({ type: z.literal("approve"), approvalId: z.string().min(1) }),
  z.object({ type: z.literal("deny"), approvalId: z.string().min(1) }),
  z.object({ type: z.literal("stop"), runRef: z.string().min(1) }),
]);

export default defineAction({
  description:
    "Route a command to the remote Agent-Native Code host through the integration relay.",
  schema: z.object({
    command: commandSchema,
    source: z
      .object({
        platform: z.string().default("dispatch"),
        externalThreadId: z.string().default("dispatch"),
        senderId: z.string().optional(),
        senderName: z.string().optional(),
        messageId: z.string().optional(),
        timestamp: z.number().optional(),
      })
      .optional(),
  }),
  run: async ({ command, source }) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    const envelope: RemoteCodeCommandEnvelope = {
      kind: "code-agent",
      ownerEmail,
      command,
      source: {
        platform: source?.platform || "dispatch",
        externalThreadId: source?.externalThreadId || "dispatch",
        senderId: source?.senderId,
        senderName: source?.senderName,
        messageId: source?.messageId,
        timestamp: source?.timestamp ?? Date.now(),
      },
    };

    return enqueueRemoteCodeCommand(envelope);
  },
});
