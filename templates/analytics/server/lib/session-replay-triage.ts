import { getSessionRecordingOutputs } from "./output-outcomes.js";
import { listRecordingFriction } from "./session-friction.js";
import {
  getSessionRecordingPerformance,
  type SessionRecordingSummary,
  type SessionReplayScope,
} from "./session-replay.js";
import {
  isSessionsTriageLabEnabled,
  sessionsTriageReadFailure,
} from "./sessions-triage-lab.js";

/**
 * One replay's summary plus what the Sessions triage Lab adds to its page:
 * friction, speed, and outputs, each replaced by its error when the read
 * fails. The summary action and `view-screen` both return this, so the agent
 * reads what the replay page shows.
 */
export async function withSessionsTriage(
  summary: SessionRecordingSummary,
  scope: SessionReplayScope,
  logPrefix: string,
) {
  let labEnabled: boolean;
  try {
    labEnabled = await isSessionsTriageLabEnabled(
      scope.userEmail,
      scope.orgId ?? null,
    );
  } catch (error) {
    return {
      ...summary,
      labStateError: sessionsTriageReadFailure("labState", logPrefix, error),
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
  const recordingOutputs =
    outputs.status === "fulfilled"
      ? outputs.value.outputs[summary.id]
      : undefined;
  const omittedOutputs =
    outputs.status === "fulfilled"
      ? outputs.value.omittedOutputs[summary.id]
      : undefined;
  return {
    ...summary,
    ...(friction.status === "rejected"
      ? {
          frictionError: sessionsTriageReadFailure(
            "friction",
            logPrefix,
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
            logPrefix,
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
            logPrefix,
            outputs.reason,
          ),
        }
      : recordingOutputs !== undefined
        ? {
            outputs: recordingOutputs,
            ...(omittedOutputs ? { omittedOutputs } : {}),
            outputCoverageStartedAt: outputs.value.coverageStartedAt,
          }
        : { outputsError: "Outputs read skipped this recording" }),
  };
}
