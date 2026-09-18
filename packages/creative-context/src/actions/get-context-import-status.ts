import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { serializePublicJob } from "../server/public-serialization.js";
import { getJob } from "../store/index.js";

export default defineAction({
  description: "Get the persisted status and checkpoint progress of an import.",
  schema: z.object({ jobId: z.string().min(1) }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ jobId }) => ({ job: serializePublicJob(await getJob(jobId)) }),
});
