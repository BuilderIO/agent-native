import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { serializePublicJob } from "../server/public-serialization.js";
import { continueJob } from "../store/index.js";

export default defineAction({
  description:
    "Resume a yielded or failed creative-context import from its durable checkpoint.",
  schema: z.object({ jobId: z.string().min(1) }),
  publicAgent: { expose: true, readOnly: false, requiresAuth: true },
  run: async ({ jobId }) => ({
    job: serializePublicJob(await continueJob(jobId)),
  }),
});
