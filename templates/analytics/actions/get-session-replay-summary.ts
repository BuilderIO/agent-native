import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { getSessionRecordingOutputs } from "../server/lib/output-outcomes.js";
import {
  sessionEventTenantKey,
  viewerTenantKeys,
} from "../server/lib/session-event-index.js";
import { listRecordingFriction } from "../server/lib/session-friction.js";
import {
  getSessionRecordingPerformance,
  getSessionReplaySummary,
} from "../server/lib/session-replay.js";
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
    "Get a scoped summary for one first-party Analytics session replay recording. Does not return raw chunks or storage references. With the Sessions triage Lab on it adds `friction`, the object the replay page's Friction tab shows: score, every signal's count (a null part means not measured, not zero), agent failures grouped by cause, and linked Monitoring error issues (null means the links are unknown, [] means none). It also adds `performance`, the recording's speed summary (worst page-view vitals, slowRequests of 1 s or more, maxRequestMs, atLeast, incomplete; null when never measured), and `performanceCoverageStartedAt`. It also adds `outputs`, the outputs this session made (such as Slides decks) with status used, unused, open, or unmeasured and a url that opens each, and `outputCoverageStartedAt`; [] with a null coverage start means output tracking has not started, not that nothing was made, and null means the recording was shared from another org, whose outputs you cannot read. A Lab state, friction, speed, or outputs read that fails returns `labStateError`, `frictionError`, `performanceError`, or `outputsError` instead.",
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
    const [friction, speed, outputs] = await Promise.allSettled([
      listRecordingFriction(scope, [summary.id]),
      getSessionRecordingPerformance(scope, [summary.id]),
      getSessionRecordingOutputs(scope, [summary.id]),
    ]);
    const recordingFriction =
      friction.status === "fulfilled" ? friction.value[summary.id] : undefined;
    const recordingSpeed =
      speed.status === "fulfilled"
        ? speed.value.performance[summary.id]
        : undefined;
    return {
      ...summary,
      ...(friction.status === "rejected"
        ? {
            frictionError: sessionsTriageReadFailure(
              "friction",
              LOG_PREFIX,
              friction.reason,
            ),
          }
        : recordingFriction
          ? { friction: recordingFriction }
          : { frictionError: "Friction read skipped this recording" }),
      ...(speed.status === "rejected"
        ? {
            performanceError: sessionsTriageReadFailure(
              "speed",
              LOG_PREFIX,
              speed.reason,
            ),
          }
        : recordingSpeed !== undefined
          ? {
              performance: recordingSpeed,
              performanceCoverageStartedAt: speed.value.coverageStartedAt,
            }
          : { performanceError: "Speed read skipped this recording" }),
      ...(outputs.status === "rejected"
        ? {
            outputsError: sessionsTriageReadFailure(
              "outputs",
              LOG_PREFIX,
              outputs.reason,
            ),
          }
        : {
            // A share grants the recording, not its tenant's events, so a
            // recording shared from another tenant has unknown outputs.
            outputs: viewerTenantKeys(scope).includes(
              sessionEventTenantKey(summary.ownerEmail, summary.orgId),
            )
              ? (outputs.value.outputs[summary.id] ?? [])
              : null,
            outputCoverageStartedAt: outputs.value.coverageStartedAt,
          }),
    };
  },
});
