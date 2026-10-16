import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { withSessionsTriage } from "../server/lib/session-replay-triage.js";
import { getSessionReplaySummary } from "../server/lib/session-replay.js";
import { MAX_OUTPUTS_PER_RECORDING } from "../shared/output-use.js";

function resolveScope() {
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");
  return { userEmail, orgId: getRequestOrgId() || null };
}

export default defineAction({
  description: `Get a scoped summary for one first-party Analytics session replay recording. Does not return raw chunks or storage references. With the Sessions triage Lab on it adds \`friction\`, the object the replay page's Friction tab shows: score, every signal's count (a null part means not measured, not zero), agent failures grouped by cause, and linked Monitoring error issues (null means the links are unknown, [] means none). It also adds \`performance\`, the recording's speed summary (worst page-view vitals, slowRequests of 1 s or more, maxRequestMs, atLeast, incomplete; null when never measured), and \`performanceCoverageStartedAt\`. It also adds \`outputs\`, the outputs this session made (such as Slides decks) with status used, unused, open, or unmeasured and a url that opens each, at most ${MAX_OUTPUTS_PER_RECORDING} with unused ones first and \`omittedOutputs\` counting the rest, and \`outputCoverageStartedAt\`. null means they are unknown, not that nothing was made: the recording was shared from another org, whose outputs you cannot read, or output tracking has not started for it. A Lab state, friction, speed, or outputs read that fails returns \`labStateError\`, \`frictionError\`, \`performanceError\`, or \`outputsError\` instead.`,
  schema: z.object({
    recordingId: z.string().describe("The session_recordings id"),
  }),
  http: { method: "GET" },
  readOnly: true,
  mcpTool: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  grounding: true,
  run: async (args) => {
    const scope = resolveScope();
    return withSessionsTriage(
      await getSessionReplaySummary(args.recordingId, scope),
      scope,
      "[get-session-replay-summary]",
    );
  },
});
