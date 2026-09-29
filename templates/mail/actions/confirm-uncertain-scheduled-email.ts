import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { confirmUncertainScheduledJobSentForOwner } from "../server/lib/jobs.js";

export default defineAction({
  uiOnly: true,
  description:
    "Resolve an uncertain scheduled email after the owner confirms they found it in Mail's Sent view.",
  schema: z.object({
    id: z
      .string()
      .describe("Scheduled job ID. For synthetic emails, remove scheduled-."),
    verifiedInSent: z
      .literal(true)
      .describe(
        "Set true only after checking Mail's Sent view for the message.",
      ),
  }),
  run: async ({ id }) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    const jobId = id.startsWith("scheduled-")
      ? id.slice("scheduled-".length)
      : id;
    const job = await confirmUncertainScheduledJobSentForOwner(
      ownerEmail,
      jobId,
    );
    if (!job) {
      throw new Error(
        "Uncertain scheduled email was not found or was resolved",
      );
    }
    return `Marked scheduled email ${jobId} as sent after confirmation in Mail's Sent view.`;
  },
});
