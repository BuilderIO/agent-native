import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { cancelScheduledJobForOwner } from "../server/lib/jobs.js";

export default defineAction({
  description: "Cancel a pending scheduled email by scheduled job ID.",
  schema: z.object({
    id: z
      .string()
      .describe("Scheduled job ID. For synthetic emails, remove scheduled-."),
  }),
  run: async ({ id }) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    const jobId = id.startsWith("scheduled-")
      ? id.slice("scheduled-".length)
      : id;
    const job = await cancelScheduledJobForOwner(ownerEmail, jobId);
    if (!job) return `Scheduled email ${jobId} was not found.`;
    return `Cancelled scheduled email ${jobId}.`;
  },
});
