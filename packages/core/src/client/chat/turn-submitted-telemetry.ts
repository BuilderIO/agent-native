import { trackEvent } from "../analytics.js";
import { buildSafePromptHash, summarizePrompt } from "./prompt-metadata.js";
import {
  TURN_SUBMITTED_EVENT,
  type RoutedTurnSubmittedReport,
  type TurnSubmittedReport,
} from "./turn-submitted.js";

export async function trackTurnSubmitted(
  report: TurnSubmittedReport,
  send: typeof trackEvent = trackEvent,
): Promise<void> {
  const prompt =
    typeof window !== "undefined" && report.initiator !== "system"
      ? report.promptForMetadata?.trim()
      : undefined;
  const promptSummary = prompt ? summarizePrompt(prompt) : undefined;
  const properties = {
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
    ...(promptSummary ?? {}),
  };
  try {
    send(TURN_SUBMITTED_EVENT, properties);
  } catch {
    // coercion-ok: telemetry must never change whether a turn runs.
    return;
  }

  if (!prompt) return;
  try {
    const promptHash = await buildSafePromptHash(prompt);
    if (!promptHash) return;
    send("agent_prompt_hash_recorded", {
      prompt_hash: promptHash,
      turn_id: report.turnId,
      ...(report.threadId ? { thread_id: report.threadId } : {}),
      ...(report.runId ? { run_id: report.runId } : {}),
      ...(report.submitMessageId
        ? { submit_message_id: report.submitMessageId }
        : {}),
      surface: report.surface,
      initiator: report.initiator,
    });
  } catch {
    // coercion-ok: prompt hashing and telemetry must never change whether a turn runs.
  }
}

export async function trackRoutedTurnSubmitted(
  report: RoutedTurnSubmittedReport,
  send: typeof trackEvent = trackEvent,
): Promise<void> {
  const prompt =
    typeof window !== "undefined"
      ? report.promptForMetadata?.trim()
      : undefined;
  const promptSummary = prompt ? summarizePrompt(prompt) : undefined;
  const properties = {
    routed_to: report.routedTo,
    surface: report.surface,
    initiator: "app",
    ...(report.submitMessageId
      ? { submit_message_id: report.submitMessageId }
      : {}),
    ...(report.requestMode ? { request_mode: report.requestMode } : {}),
    ...(promptSummary ?? {}),
  };
  try {
    send(TURN_SUBMITTED_EVENT, properties);
  } catch {
    // coercion-ok: telemetry must never change where a message is sent.
    return;
  }

  if (!prompt) return;
  try {
    const promptHash = await buildSafePromptHash(prompt);
    if (!promptHash) return;
    send("agent_prompt_hash_recorded", {
      prompt_hash: promptHash,
      routed_to: report.routedTo,
      ...(report.submitMessageId
        ? { submit_message_id: report.submitMessageId }
        : {}),
      surface: report.surface,
      initiator: "app",
    });
  } catch {
    // coercion-ok: prompt hashing and telemetry must never change where a message is sent.
  }
}
