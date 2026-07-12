import { defineAction } from "@agent-native/core";
import { assertAccess, resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { runSlackPilot } from "../server/lib/connectors.js";

const channelRefsSchema = z
  .union([z.array(z.string()), z.string()])
  .default([])
  .transform((value) =>
    Array.isArray(value)
      ? value
      : value
          .split(/[\n,]/g)
          .map((item) => item.trim())
          .filter(Boolean),
  );

export default defineAction({
  description:
    "Run a guarded Slack pilot report. By default it validates credentials and channel allow-lists only; pass readHistory=true for a tiny capped history sync.",
  schema: z.object({
    sourceId: z
      .string()
      .min(1)
      .describe("Existing Slack Brain source to validate or pilot-sync."),
    readHistory: z.coerce
      .boolean()
      .default(false)
      .describe(
        "When true, read a tiny bounded Slack history sample after validation. Defaults to false.",
      ),
    channelRefs: channelRefsSchema.describe(
      "Optional Slack channel IDs or names to validate instead of the source allow-list.",
    ),
    resolveNames: z.coerce
      .boolean()
      .default(false)
      .describe(
        "When true, channel names may be resolved through conversations.list metadata. Channel IDs avoid that metadata scan.",
      ),
    historyLimit: z.coerce
      .number()
      .int()
      .min(1)
      .max(10)
      .default(10)
      .describe("Maximum messages per channel page for pilot sync."),
    maxChannels: z.coerce
      .number()
      .int()
      .min(1)
      .max(2)
      .default(2)
      .describe("Maximum channels to read during pilot sync."),
    permalinkLimit: z.coerce
      .number()
      .int()
      .min(0)
      .max(10)
      .default(10)
      .describe("Maximum Slack permalink calls during pilot sync."),
    recentDays: z.coerce
      .number()
      .int()
      .min(1)
      .max(30)
      .default(14)
      .describe("Default recent history window when oldest is not supplied."),
    oldest: z
      .string()
      .optional()
      .describe("Optional Slack oldest timestamp or ISO date for pilot sync."),
  }),
  run: async (args) => {
    const access = args.readHistory
      ? await assertAccess("brain-source", args.sourceId, "editor")
      : await resolveAccess("brain-source", args.sourceId);
    if (!access) throw new Error(`No access to brain source ${args.sourceId}`);
    if (access.resource.provider !== "slack") {
      throw new Error(
        "run-slack-pilot sourceId must reference a Slack source.",
      );
    }
    return runSlackPilot(access.resource, args);
  },
});
