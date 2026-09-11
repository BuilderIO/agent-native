import { z } from "zod";

import { defineAction } from "../../../action.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../../../server/request-context.js";
import { callerOwnsThread } from "../../run-ownership.js";
import {
  readContextManifest,
  upsertContextDirective,
  writeContextManifestStatus,
} from "../directives-store.js";
import {
  contextXrayAuthError,
  contextXraySystemSegmentError,
  contextXrayThreadNotFoundError,
  isContextXraySystemSegment,
} from "./errors.js";

export default defineAction({
  description:
    "Evict a Context X-Ray segment from future model calls. This excludes the segment from context; it does not delete chat history and can be restored.",
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
    if (
      isContextXraySystemSegment(
        await readContextManifest(args.threadId),
        args.segmentId,
      )
    ) {
      throw contextXraySystemSegmentError();
    }
    const directive = await upsertContextDirective({
      threadId: args.threadId,
      segmentId: args.segmentId,
      action: "evict",
      ownerEmail,
      orgId: getRequestOrgId() ?? null,
    });
    const manifest = await writeContextManifestStatus({
      threadId: args.threadId,
      segmentId: args.segmentId,
      status: "evicted",
    });
    return { directive, manifest };
  },
});
