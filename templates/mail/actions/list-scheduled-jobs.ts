import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { listPendingJobs } from "../server/lib/jobs.js";

export default defineAction({
  description:
    "List the user's pending and processing scheduled jobs (snoozes and scheduled sends).",
  schema: z.object({}),
  http: { method: "GET" },
  agentTool: false,
  run: async () => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Unauthenticated");
    return listPendingJobs(ownerEmail);
  },
});
