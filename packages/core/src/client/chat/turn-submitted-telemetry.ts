import { trackEvent } from "../analytics.js";
import { buildSafePromptMetadata } from "./prompt-metadata.js";
import {
  TURN_SUBMITTED_EVENT,
  type RoutedTurnSubmittedReport,
  type TurnSubmittedReport,
} from "./turn-submitted.js";

export async function trackTurnSubmitted(
  report: TurnSubmittedReport,
  send: typeof trackEvent = trackEvent,
): Promise<void> {
  try {
    const promptMetadata =
      typeof window !== "undefined" &&
      report.initiator !== "system" &&
      report.promptForMetadata?.trim()
        ? await buildSafePromptMetadata(report.promptForMetadata)
        : undefined;
    send(TURN_SUBMITTED_EVENT, {
      turn_id: report.turnId,
      ...(report.threadId ? { thread_id: report.threadId } : {}),
      ...(report.runId ? { run_id: report.runId } : {}),
      surface: report.surface,
      initiator: report.initiator,
      ...(report.submitMessageId
        ? { submit_message_id: report.submitMessageId }
        : {}),
      ...(report.recoveryOfRunId
        ? { recovery_of_run_id: report.recoveryOfRunId }
        : {}),
      ...(report.requestMode ? { request_mode: report.requestMode } : {}),
      ...(promptMetadata ?? {}),
    });
  } catch {
    // coercion-ok: telemetry must never change whether a turn runs.
  }
}

export async function trackRoutedTurnSubmitted(
  report: RoutedTurnSubmittedReport,
  send: typeof trackEvent = trackEvent,
): Promise<void> {
  try {
    const promptMetadata =
      typeof window !== "undefined" && report.promptForMetadata?.trim()
        ? await buildSafePromptMetadata(report.promptForMetadata)
        : undefined;
    send(TURN_SUBMITTED_EVENT, {
      routed_to: report.routedTo,
      surface: report.surface,
      initiator: "app",
      ...(report.submitMessageId
        ? { submit_message_id: report.submitMessageId }
        : {}),
      ...(report.requestMode ? { request_mode: report.requestMode } : {}),
      ...(promptMetadata ?? {}),
    });
  } catch {
    // coercion-ok: telemetry must never change where a message is sent.
  }
}
