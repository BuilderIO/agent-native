import { z } from "zod";
import { defineAction } from "../../../action.js";
import { callerOwnsThread } from "../../run-ownership.js";
import { getRequestUserEmail } from "../../../server/request-context.js";
import {
  deactivateContextDirective,
  writeContextManifestStatus,
} from "../directives-store.js";

export default defineAction({
  description:
    "Restore a Context X-Ray segment by deactivating its pin, evict, or summarize directive.",
  schema: z.object({
    threadId: z.string(),
    segmentId: z.string(),
  }),
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail)
      throw new Error("Context X-Ray requires a signed-in user.");
    if (!(await callerOwnsThread(ownerEmail, args.threadId))) {
      throw new Error("Thread not found.");
    }
    const restored = await deactivateContextDirective({
      threadId: args.threadId,
      segmentId: args.segmentId,
      ownerEmail,
    });
    const manifest = await writeContextManifestStatus({
      threadId: args.threadId,
      segmentId: args.segmentId,
      status: "active",
    });
    return { restored, manifest };
  },
});
