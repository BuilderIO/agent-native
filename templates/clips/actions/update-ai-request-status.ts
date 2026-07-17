import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

const STATUS_KEY_PREFIX = "clips-ai-request-status-";

export default defineAction({
  description:
    "Report progress or completion for queued Clips AI work so the recording page can show its current status.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
    kind: z.enum(["remove-silences"]).describe("Queued request kind"),
    status: z
      .enum(["working", "completed", "failed"])
      .describe("Current request status"),
    message: z
      .string()
      .trim()
      .max(500)
      .optional()
      .describe("Optional short status detail"),
  }),
  run: async (args) => {
    await assertAccess("recording", args.recordingId, "editor");
    await writeAppState(`${STATUS_KEY_PREFIX}${args.recordingId}`, {
      kind: args.kind,
      status: args.status,
      message: args.message || null,
      updatedAt: new Date().toISOString(),
    });
    return {
      recordingId: args.recordingId,
      kind: args.kind,
      status: args.status,
    };
  },
});
