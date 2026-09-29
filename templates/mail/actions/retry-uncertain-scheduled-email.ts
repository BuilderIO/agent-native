import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import {
  retryUncertainScheduledJobForOwner,
  sendScheduledJobNowForOwner,
} from "../server/lib/jobs.js";

export default defineAction({
  uiOnly: true,
  description:
    "Send a new copy of an uncertain scheduled email only after the owner acknowledges that the original may already have been delivered.",
  schema: z.object({
    id: z
      .string()
      .describe("Scheduled job ID. For synthetic emails, remove scheduled-."),
    duplicateRiskAcknowledged: z
      .literal(true)
      .describe(
        "Set true only after the owner confirms they understand the recipient may receive a duplicate.",
      ),
  }),
  run: async ({ id }) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    const jobId = id.startsWith("scheduled-")
      ? id.slice("scheduled-".length)
      : id;
    const retry = await retryUncertainScheduledJobForOwner(ownerEmail, jobId);
    await sendScheduledJobNowForOwner(
      ownerEmail,
      retry.id,
      retry.processingClaimId ?? undefined,
    );
    return `Sent a new copy of scheduled email ${jobId}.`;
  },
});
