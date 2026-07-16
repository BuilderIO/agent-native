import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  getJob,
  purgeContextSourceArtifacts,
  updateJob,
} from "../store/index.js";

export default defineAction({
  description:
    "Process an already-approved source purge job: remove private blobs, derived search indexes, corpus children, and deprecate promoted derivatives.",
  schema: z.object({ jobId: z.string().min(1) }),
  run: async ({ jobId }) => {
    const job = await getJob(jobId);
    if (!job || job.kind !== "purge" || !job.sourceId) {
      throw new Error("Pending creative-context purge job not found");
    }
    const result = await purgeContextSourceArtifacts(job.sourceId);
    return {
      job: await updateJob(job.id, { status: "completed", result }),
      result,
    };
  },
});
