import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";
import { sendScheduledJobNowForOwner } from "../server/lib/jobs.js";

export default defineAction({
  description:
    "Send a pending scheduled email immediately by scheduled job ID.",
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
    await sendScheduledJobNowForOwner(ownerEmail, jobId);
    return `Sent scheduled email ${jobId}.`;
  },
});
