import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { getSessionReplaySummary } from "../server/lib/session-replay.js";

function resolveScope() {
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");
  return { userEmail, orgId: getRequestOrgId() || null };
}

export default defineAction({
  description:
    "Get a scoped summary for one first-party Analytics session replay recording. Does not return raw chunks or storage references.",
  schema: z.object({
    recordingId: z.string().describe("The session_recordings id"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    return getSessionReplaySummary(args.recordingId, resolveScope());
  },
});
