import { defineAction } from "@agent-native/core";
import {
  getRequestContext,
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { createSessionReplayAgentLink } from "../server/lib/session-replay-agent-context.js";

function resolveScope() {
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");
  return { userEmail, orgId: getRequestOrgId() || null };
}

export default defineAction({
  description:
    "Create a temporary private agent-readable link for one Analytics session replay recording. The URL is scoped to that recording and expires after two hours.",
  schema: z.object({
    recordingId: z.string().describe("The session_recordings id"),
  }),
  run: async (args) => {
    return createSessionReplayAgentLink({
      recordingId: args.recordingId,
      scope: resolveScope(),
      origin: getRequestContext()?.requestOrigin,
    });
  },
  // Minting this scoped, expiring read link does not mutate the recording or
  // expose data outside the caller's existing access scope, so it is safe for
  // Plan mode's read-only investigation workflow.
  readOnly: true,
});
