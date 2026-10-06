import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { listRecordingFriction } from "../server/lib/session-friction.js";
import { getSessionReplaySummary } from "../server/lib/session-replay.js";
import {
  isSessionsTriageLabEnabled,
  sessionsTriageReadFailure,
} from "../server/lib/sessions-triage-lab.js";

const LOG_PREFIX = "[get-session-replay-summary]";

function resolveScope() {
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");
  return { userEmail, orgId: getRequestOrgId() || null };
}

export default defineAction({
  description:
    "Get a scoped summary for one first-party Analytics session replay recording. Does not return raw chunks or storage references. With the Sessions triage Lab on it adds `friction`, the object the replay page's Friction tab shows: score, every signal's count (a null part means not measured, not zero), agent failures grouped by cause, and linked Monitoring error issues (null means the links are unknown, [] means none). A Lab state or friction read that fails returns `labStateError` or `frictionError` instead.",
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
    const summary = await getSessionReplaySummary(args.recordingId, scope);
    let labEnabled: boolean;
    try {
      labEnabled = await isSessionsTriageLabEnabled(
        scope.userEmail,
        scope.orgId,
      );
    } catch (error) {
      return {
        ...summary,
        labStateError: sessionsTriageReadFailure("labState", LOG_PREFIX, error),
      };
    }
    if (!labEnabled) return summary;
    try {
      const friction = (await listRecordingFriction(scope, [summary.id]))[
        summary.id
      ];
      return friction
        ? { ...summary, friction }
        : { ...summary, frictionError: "Friction read skipped this recording" };
    } catch (error) {
      return {
        ...summary,
        frictionError: sessionsTriageReadFailure("friction", LOG_PREFIX, error),
      };
    }
  },
});
