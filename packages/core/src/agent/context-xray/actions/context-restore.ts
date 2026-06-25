import { z } from "zod";

import { defineAction } from "../../../action.js";
import { getRequestUserEmail } from "../../../server/request-context.js";
import { callerOwnsThread } from "../../run-ownership.js";
import {
  deactivateContextDirective,
  writeContextManifestStatus,
} from "../directives-store.js";
import {
  contextXrayAuthError,
  contextXrayThreadNotFoundError,
} from "./errors.js";

export default defineAction({
  description:
    "Restore a Context X-Ray segment by deactivating its pin, evict, or summarize directive.",
  schema: z.object({
    threadId: z.string(),
    segmentId: z.string(),
  }),
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw contextXrayAuthError();
    if (!(await callerOwnsThread(ownerEmail, args.threadId))) {
      throw contextXrayThreadNotFoundError();
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
