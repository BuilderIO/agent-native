import {
  agentTroubleCauseForCode,
  normalizeAgentTroubleMessage,
} from "../../shared/analytics-events.js";
import { trackEvent } from "../analytics.js";
import type { RunOutcomeReport } from "./run-outcome.js";

/**
 * One event per run outcome, so "how do runs end" is a rate and not a set of
 * reports. A run that did not finish well (`interrupted`, `failed`,
 * `unverified`) or that the user stopped is always reported, up to a per-page
 * cap, because each one names a thing to fix and Analytics counts them per
 * session. Only `succeeded` is sampled and carries its weight, so rates still
 * add up. The server counts every run exactly (`agent_run_outcome_daily`,
 * `$ai_trace`); this event is what the browser saw and how it came to know.
 *
 * A failure carries its named `cause` when it has one, or else its message
 * reduced to a shape, so Analytics can group agent trouble without the
 * message's own text.
 */
export const RUN_OUTCOME_EVENT = "agent_run_outcome";

const EXPECTED_OUTCOME_SAMPLE_RATE = 0.1;
const MAX_UNEXPECTED_EVENTS_PER_PAGE = 30;

const stats = {
  sent: 0,
  unexpectedSent: 0,
  unexpectedDropped: 0,
  sampledOut: 0,
};

export function getRunOutcomeTelemetryStats(): Readonly<typeof stats> {
  return { ...stats };
}

export function resetRunOutcomeTelemetryForTests(): void {
  stats.sent = 0;
  stats.unexpectedSent = 0;
  stats.unexpectedDropped = 0;
  stats.sampledOut = 0;
}

export function trackRunOutcome(
  report: RunOutcomeReport,
  send: typeof trackEvent = trackEvent,
  random: () => number = Math.random,
): void {
  const expected = report.outcome === "succeeded";
  if (expected) {
    if (random() >= EXPECTED_OUTCOME_SAMPLE_RATE) {
      stats.sampledOut += 1;
      return;
    }
  } else if (stats.unexpectedSent >= MAX_UNEXPECTED_EVENTS_PER_PAGE) {
    stats.unexpectedDropped += 1;
    return;
  } else {
    stats.unexpectedSent += 1;
  }
  stats.sent += 1;
  const rate = expected ? EXPECTED_OUTCOME_SAMPLE_RATE : 1;
  try {
    const troubled =
      report.outcome === "failed" || report.outcome === "interrupted";
    const cause = troubled ? agentTroubleCauseForCode(report.code) : null;
    const errorMessage =
      troubled && !cause ? normalizeAgentTroubleMessage(report.message) : "";
    send(RUN_OUTCOME_EVENT, {
      outcome: report.outcome,
      ...(report.code ? { code: report.code } : {}),
      ...(cause ? { cause } : {}),
      ...(errorMessage ? { error_message: errorMessage } : {}),
      ...(report.retryable !== undefined
        ? { retryable: report.retryable }
        : {}),
      terminal_source: report.terminalSource,
      verified_after_pipe_closed: report.verifiedAfterPipeClosed,
      resume_attempts: report.resumeAttempts,
      quiet_reads: report.quietReads,
      drain_attempts: report.drainAttempts,
      run_id: report.runId,
      thread_id: report.threadId,
      sample_rate: rate,
      sample_weight: 1 / rate,
    });
  } catch {
    // coercion-ok: telemetry must never change how a run ends.
  }
}

/**
 * A thumbs rating as the page saw it. The server's `$ai_feedback` carries no
 * browser session, so Analytics counts ratings per session from this event.
 */
export const RUN_FEEDBACK_EVENT = "agent_feedback_submitted";

export function trackRunFeedback(
  feedback: { runId?: string; threadId: string; positive: boolean },
  send: typeof trackEvent = trackEvent,
): void {
  try {
    send(RUN_FEEDBACK_EVENT, {
      sentiment: feedback.positive ? "positive" : "negative",
      ...(feedback.runId ? { run_id: feedback.runId } : {}),
      thread_id: feedback.threadId,
    });
  } catch {
    // coercion-ok: telemetry must never change how feedback is saved.
  }
}
