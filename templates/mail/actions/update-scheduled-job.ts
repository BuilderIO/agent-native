import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { updateScheduledJobForOwner } from "../server/lib/jobs.js";

export default defineAction({
  description:
    "Reschedule a pending scheduled job by updating its future run timestamp.",
  schema: z.object({
    id: z.string().describe("Scheduled job ID"),
    runAt: z.coerce.number().describe("New future epoch-millisecond run time"),
  }),
  agentTool: false,
  run: async ({ id, runAt }) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Unauthenticated");
    if (!Number.isFinite(runAt) || runAt <= Date.now()) {
      throw new Error("runAt must be a future timestamp");
    }
    const job = await updateScheduledJobForOwner(ownerEmail, id, runAt);
    if (!job) throw new Error("Scheduled job not found");
    return job;
  },
});
