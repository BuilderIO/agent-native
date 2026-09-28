import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getCurrentOwnerEmail } from "../server/lib/recordings.js";
import { transactionalEmailStore } from "../server/lib/transactional-email-store.js";

const releaseRequestSchema = z.object({
  jobIds: z.array(z.string().trim().min(1)).min(1).max(10),
});

export default defineAction({
  description:
    "Release transactional email AI claims that this signed-in Clips UI could not dispatch.",
  agentTool: false,
  schema: releaseRequestSchema,
  run: async ({ jobIds }) => {
    const claimantEmail = getCurrentOwnerEmail().trim().toLowerCase();
    const releasedJobIds: string[] = [];
    for (const jobId of jobIds) {
      const released = await transactionalEmailStore.releaseClaimedAi(
        jobId,
        claimantEmail,
      );
      if (released) releasedJobIds.push(released.logicalKey);
    }
    return { releasedJobIds };
  },
});
