import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { getSessionReplayEvents } from "../server/lib/session-replay.js";

function resolveScope() {
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");
  return { userEmail, orgId: getRequestOrgId() || null };
}

export default defineAction({
  description:
    "Read sanitized replay events for a first-party Analytics session recording. Results are capped and never expose storage provider URLs or raw chunk table access.",
  schema: z.object({
    recordingId: z.string().describe("The session_recordings id"),
    startSeq: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Optional first chunk sequence to include"),
    endSeq: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Optional last chunk sequence to include"),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .optional()
      .describe("Maximum replay events to return"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    return getSessionReplayEvents(args.recordingId, resolveScope(), {
      startSeq: args.startSeq,
      endSeq: args.endSeq,
      limit: args.limit,
    });
  },
});
