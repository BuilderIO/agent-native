import { unwrapAttachmentEnvelope } from "@agent-native/toolkit/composer/pasted-text";
import type { ChatModelAdapter, ChatModelRunResult } from "@assistant-ui/react";

import { actionPreparationContinuationNote } from "../agent/action-continuation-guidance.js";
import {
  LLM_MISSING_CREDENTIALS_ERROR_CODE,
  LLM_MISSING_CREDENTIALS_MESSAGE,
} from "../agent/engine/credential-errors.js";
import type {
  AgentChatStructuredContentPart,
  AgentChatStructuredMessage,
} from "../agent/types.js";
import type { ReasoningEffort } from "../shared/reasoning-effort.js";
import {
  clearPendingTurnIfMatches,
  getActiveRun,
  setActiveRun,
  updateActiveRunSeq,
  clearActiveRun,
  clearActiveRunIfMatches,
  setPendingTurn,
} from "./active-run-state.js";
import { getOrCreateAnalyticsSessionId } from "./analytics-session.js";
import { captureError } from "./analytics.js";
import { agentNativePath } from "./api-path.js";
import { formatChatErrorText, normalizeChatError } from "./error-format.js";
import {
  createRunStreamToken,
  preemptRunStream,
  releaseRunStream,
} from "./run-stream-ownership.js";
import {
  AgentAutoContinueSignal,
  INTERRUPTED_TOOL_RESULT,
  appendMissingFinalResponseWarning,
  type AgentActivityTrailEntry,
  type AgentAutoContinueErrorInfo,
  type ContentPart,
  type PreparingActionState,
  type SSEStreamOptions,
  readSSEStream,
  settleInterruptedToolCalls,
} from "./sse-event-processor.js";
import {
  isDelegatedAgentToolCall,
  isToolCallInFlight,
} from "./tool-display.js";
import type { ChatThreadScope } from "./use-chat-threads.js";

export type AgentChatSurfaceKind =
  /**
   * Chat rendered by the app itself, including the normal AgentSidebar. This
   * surface must not receive code-editing dev tools because source edits can
   * reload the same React tree that is hosting the chat.
   */
  | "app"
  /** Chat rendered by the outer local dev frame, outside the app iframe. */
  | "dev-frame"
  /** Chat hosted by Desktop for a local app with explicit code access. */
  | "desktop";

type AdapterHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

type AssistantUiAttachment = {
  name: string;
  contentType?: string;
  content: readonly Record<string, unknown>[];
};

type AgentChatAdapterAttachment = {
  type: string;
  name: string;
  contentType?: string;
  data?: string;
  url?: string;
  uploadProvider?: string;
  referenceOnly?: boolean;
  securityNote?: string;
  text?: string;
};

const TEXT_ATTACHMENT_CONTENT_TYPES = new Set([
  "application/json",
  "application/x-ndjson",
  "image/svg+xml",
  "text/csv",
  "text/css",
  "text/html",
  "text/json",
  "text/markdown",
  "text/plain",
  "text/xml",
]);

const AUTO_CONTINUE_PROMPT =
  "Continue from where you left off and finish the user's original request. Do not repeat completed work, do not mention internal reconnects, time limits, or step limits, and continue as if this is the same uninterrupted run.";
const AUTO_CONTINUE_COMPLETION_GUARD =
  "Before doing more work, inspect the prior partial assistant output in history. If it already gives a coherent answer, summary, artifact, coverage note, or next-step recommendation, finish with at most one short closing sentence and do not call tools, scan more data, or expand the search. Continue only genuinely unfinished work.";
const MAX_RECONNECT_ATTEMPTS = 5;
const MAX_STARTUP_RECOVERY_ATTEMPTS = 8;
const MAX_QUEUED_CONFLICT_RETRIES = 120;
// The consecutive non-advancing continuation (see `describeContinuationAdvance`)
// that ends the turn: the third one stops it, so two are tolerated. This
// replaced five separate budgets — stale-run, stalled, empty, repeated-narration
// and repeated-action-preparation — each of which existed because the rung above
// it had a hole the next one patched. One question answers all five: a round
// that produced nothing, or produced exactly what the round before it
// produced, did not advance.
const MAX_NON_ADVANCING_CONTINUATIONS = 3;
// Ceiling across the whole turn for TRANSIENT continuations — rounds that
// followed a failure (timeout, dropped stream, stale run). Every attempt
// re-POSTs the full history plus attachments, so a high ceiling only burns
// tokens and wall time on a connection that keeps breaking.
const MAX_TOTAL_TRANSIENT_CONTINUATIONS = 12;
// Ceiling across the whole turn for WORK-boundary continuations. A `loop_limit`
// round is not a failure — the server spent a full iteration budget on real
// tool work and handed the turn back — so counting it against the transient
// ceiling killed progressing turns at round 13 that had never failed once.
// Sized against the server's own limits: at its default budget of 400
// iterations per run this is ~10,000 tool calls, two orders past the deepest
// legitimate production turn (117 tool calls) that sized that budget. It still
// has to exist, because the server's per-turn token backstop rides the request
// body between server-chained chunks and resets on every client re-POST.
const MAX_LOOP_LIMIT_CONTINUATIONS = 25;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 8_000;
const MAX_HISTORY_ATTACHMENT_CHARS = 60_000;
// The attachment submitted with the CURRENT turn gets a much larger cap than
// prior-history embedding. The server threads this turn's attachments into each
// action's ActionRunContext, and `create-extension`/`update-extension` host a
// pasted file verbatim from it via `contentFromAttachment` — a feature whose
// whole point is large pastes. Truncating the outbound payload to the 60K
// history cap would silently cut a >60K HTML/Alpine file before the server ever
// reads it, hosting a broken extension. Mirror the large-input tool-arg cap
// (MAX_HISTORY_LARGE_TOOL_ARGS_CHARS) so realistic pasted files survive intact;
// the trailing truncation notice still makes a pathological multi-MB paste
// visibly (not silently) capped.
const MAX_OUTBOUND_ATTACHMENT_CHARS = 200_000;
const MAX_HISTORY_MESSAGES = 24;
const MAX_HISTORY_TOTAL_CHARS = 64_000;
// Budget for everything actually said in the thread — every user ask and every
// assistant conclusion. Separate from MAX_HISTORY_TOTAL_CHARS, which bounds the
// tool args/results those turns produced. See limitPriorMessagesForRequest.
const MAX_HISTORY_WORD_CHARS = 32_000;
const MAX_HISTORY_MESSAGE_CHARS = 12_000;
const MAX_HISTORY_TOOL_ARGS_CHARS = 8_000;
const MAX_HISTORY_TOOL_RESULT_CHARS = 12_000;
// Tools whose entire input IS the artifact being built (extension HTML, etc.).
// Lossy-truncating these to a `{ __agentNativeTruncated }` placeholder strands
// the resumed agent — it can no longer refine the artifact because it sees a
// fake input. Keep the real input for these on continuation, only collapsing
// inputs that are far larger than any realistic extension payload.
const LARGE_INPUT_TOOL_NAMES = new Set([
  "create-extension",
  "update-extension",
]);
const MAX_HISTORY_LARGE_TOOL_ARGS_CHARS = 200_000;
const STARTUP_RESPONSE_TIMEOUT_MS = 45_000;

function dispatchTerminalChatUiCleanup(tabId: string | undefined): void {
  if (typeof window === "undefined") return;

  // Some terminal outcomes are synthesized by the adapter after recovery
  // (for example, a completed tool whose final response timed out) and never
  // pass through a terminal SSE frame. Clear both halves of the status UI so
  // the wrap-up result cannot leave a preparation label or "Resuming" state.
  window.dispatchEvent(
    new CustomEvent("agent-chat:activity-clear", { detail: { tabId } }),
  );
  window.dispatchEvent(
    new CustomEvent("agent-chat:stream-progress", { detail: { tabId } }),
  );
}

function isTerminalChatModelRunResult(result: ChatModelRunResult): boolean {
  return (
    result.status?.type === "complete" || result.status?.type === "incomplete"
  );
}

// ── Background follow mode ──────────────────────────────────────────────────
// For server-continued runs (dispatchMode starts with "background" or equals
// "foreground-self-chain") the SERVER normally chains continuation chunks
// itself (fresh runId, same turnId), pre-inserts the successor run row BEFORE
// the old chunk completes (so /runs/active shows an active run continuously
// across chunk boundaries), and a server sweep reaps lost handoffs into loud
// terminal errors. The client demotes itself to a READER of server state for
// healthy handoffs. Foreground self-chain keeps one escape hatch: if the server
// reports that the self-dispatch itself failed before a successor claimed the
// run, the existing client auto-continue POST remains the fallback.
const BACKGROUND_FOLLOW_POLL_INTERVAL_MS = 1_000;
// This watchdog belongs to a read-only reattach, not to the server run. A
// shorter reader window lets the follow loop re-poll `/runs/active` while a
// completed run is still inside the server's terminal replay window.
export const BACKGROUND_FOLLOW_ATTACH_WATCHDOG_MS = 90_000;
// How long the follow loop tolerates seeing NO active run for this turn before
// treating the turn as ended. The server pre-inserts the successor row before
// the old chunk completes, so a healthy chain never shows an idle gap; allow a
// wider window here because the server's unclaimed-handoff recovery can span
// the 25s grace plus sweep/DB latency. This stays below the background
// reconnect stuck threshold, but gives the server-owned recovery brain time to
// surface the successor or terminal errored run before the client reports idle.
//
// THREE-SITE INVARIANT (keep in lockstep with run-store.ts and
// agent-chat-plugin.ts — see `UNCLAIMED_BACKGROUND_RUN_FAST_SWEEP_MS`'s doc
// comment in run-store.ts for the full derivation): a `chainServerDrivenContinuation`
// deferral (server/production-agent.ts) leaves a successor row `running` with
// no live worker until a sweep redispatches it. The budget is a derived
// chain, each bound comfortably inside the next:
//   UNCLAIMED_BACKGROUND_RUN_GRACE_MS            (25s)
// + UNCLAIMED_BACKGROUND_RUN_FAST_SWEEP_MS       (20s)
// = ~45-65s worst-case time-to-first-redispatch-attempt
// < RUN_NO_PROGRESS_HARD_TIMEOUT_MS              (150s, run-manager.ts)
// < BACKGROUND_FOLLOW_IDLE_TIMEOUT_MS            (210s, this constant)
// < UNCLAIMED_BACKGROUND_RUN_REDISPATCH_BOUND_MS (300s, run-store.ts)
// On top of that margin, the follow loop below never counts a tick against
// this timeout at all while `/runs/active` reports `awaitingRedispatch:
// true` — a server-authoritative "known deferred, recovery in progress"
// signal, not a guess — so this timeout is a backstop for a genuinely lost
// run, not the primary mechanism racing the sweep. Do NOT raise this value to
// paper over a slow sweep; fix the sweep timing (run-store.ts /
// agent-chat-plugin.ts) instead, and keep this comment's inequality chain
// accurate if any of the four numbers change.
export const BACKGROUND_FOLLOW_IDLE_TIMEOUT_MS = 210_000;

// Per-TURN follow budgets. BACKGROUND_FOLLOW_IDLE_TIMEOUT_MS above is a
// per-idle-WINDOW bound and resets every time a successor run appears, so a
// server stuck redispatching the same failing chunk resets the only budget on
// every poll tick and the follow loop never exits (prod: 26 chained runs over
// 22 minutes, all error:stale_run, user watching a spinner). These bound the
// whole turn instead, and an identical repeated failure counts as no progress.
//
// CLIENT-ABOVE-SERVER INVARIANT (asserted in agent-chat-adapter.spec.ts).
// These are a backstop for a server that has gone silent in a way the idle
// timeout misses — NOT the primary limit. They must stay ABOVE the server's
// own ceilings so the server, which can actually tell progress from looping,
// always terminates a turn first and writes a truthful terminal reason:
//   BACKGROUND_SOFT_TIMEOUT_CEILING_MS  (13 min, run-manager.ts)  — one chunk
//   MAX_TURN_WALL_CLOCK_MS              (90 min, production-agent.ts) — one turn
//   MAX_BACKGROUND_RUN_CONTINUATIONS    (20,     production-agent.ts)
//
// They were originally set to 10 min / 6 runs, which put the whole-turn client
// budget BELOW the 13-minute ceiling of a single legal chunk. Any turn needing
// a second full-length chunk was killed by the client while the server was
// healthy and had 80 minutes left — measured in prod as turns dying at 11-25
// minutes with `last_progress_at` tracking the abort, i.e. still streaming
// tokens and completing tools when the client gave up. That is the top
// non-auth cause of "the chat just stopped" reports.
//
// Killing a turn that is NOT progressing is already covered twice over, by
// mechanisms that read progress rather than a clock: the 210s idle timeout
// above, and MAX_REPEATED_BACKGROUND_TERMINAL_REASONS below. Do not re-tighten
// these two to catch a stuck turn — fix the progress signal instead.
export const MAX_FOLLOWED_BACKGROUND_RUNS = 24;
export const MAX_BACKGROUND_FOLLOW_WALL_TIME_MS = 95 * 60_000;
const MAX_REPEATED_BACKGROUND_TERMINAL_REASONS = 3;

// A re-observed terminal run whose outcome would be an ERROR (never a
// genuine "done" success) gets a short extra grace window before the follow
// loop surfaces it: the server's dead-run recovery can reap a lost
// background run and insert a claimable successor a beat after the client
// first sees the stale terminal row. Deliberately much shorter than
// BACKGROUND_FOLLOW_IDLE_TIMEOUT_MS — this exists to absorb that narrow
// insert-latency race, not to mask a genuinely lost run behind a long hang
// before the user sees an error.
const BACKGROUND_TERMINAL_ERROR_GRACE_POLLS = 5;

/**
 * User-facing copy for the server's background terminal reasons
 * (`agent_runs.terminal_reason`, surfaced by /runs/active). These runs died in
 * server-side handoff machinery where no richer error event may exist, so the
 * client owns the message. Keys are matched after stripping an optional
 * `error:` prefix (`terminalReasonForEvent` records `error:<code>`). Keep this
 * map scoped to terminal failures, including reasons that must override a
 * mistakenly completed row.
 */
const BACKGROUND_TERMINAL_REASON_MESSAGES: Record<string, string> = {
  background_worker_never_started:
    "The agent run was handed off to a background worker that never started. It was recovered so you can try again.",
  background_continuation_dispatch_failed:
    "The agent's background worker could not hand off the next step of this run. Retry to continue from the preserved context.",
  dispatch_payload_missing:
    "The agent's background run lost its saved request data and could not continue. Retry to start a fresh run.",
  missing_api_key: LLM_MISSING_CREDENTIALS_MESSAGE,
  missing_credentials: LLM_MISSING_CREDENTIALS_MESSAGE,
  turn_continuation_budget_exhausted:
    "This request needed more automatic continuations than allowed and was stopped. Try breaking it into smaller steps.",
};

/**
 * `agent_runs.terminal_reason` values that mark a CHUNK boundary, not the end
 * of the turn — `markBackgroundContinuationChunkTerminal` (production-agent.ts)
 * writes status "completed" with one of these bare reasons whenever a
 * background chunk ends at a continuation boundary (mirrors
 * `AgentLoopContinuationReason` there). A run in this state is expected to be
 * replaced by a server-chained successor row; it must never be read as "the
 * turn is done" just because its own row says `status: "completed"`.
 */
const BACKGROUND_CONTINUATION_TERMINAL_REASONS = new Set<string>([
  "run_timeout",
  "loop_limit",
  "max_tokens",
  "stream_ended",
  "gateway_timeout",
  "network_interrupted",
  "no_progress",
]);

function isUserInitiatedTerminalReason(reason: string): boolean {
  return (
    reason === "aborted:user" ||
    reason === "aborted:abort" ||
    reason.startsWith("aborted:user_")
  );
}

/**
 * True when the given `/runs/active` snapshot, if surfaced as a background
 * terminal outcome right now, would render as an error rather than a
 * successful completion. Mirrors `emitBackgroundTerminalOutcome`'s own
 * mappedMessage/hasErrorTerminalReason/status branching (kept in sync with
 * it) so callers can decide whether an error-surfacing grace window applies
 * BEFORE actually emitting anything.
 */
function isBackgroundTerminalErrorOutcome(
  lastKnown: Record<string, unknown> | null,
): boolean {
  const status = typeof lastKnown?.status === "string" ? lastKnown.status : "";
  const rawTerminalReason =
    typeof lastKnown?.terminalReason === "string"
      ? lastKnown.terminalReason
      : "";
  if (isUserInitiatedTerminalReason(rawTerminalReason)) return false;
  const hasErrorTerminalReason = rawTerminalReason.startsWith("error:");
  const terminalReason = rawTerminalReason.replace(/^error:/, "");
  const mappedMessage = terminalReason
    ? BACKGROUND_TERMINAL_REASON_MESSAGES[terminalReason]
    : undefined;
  if (mappedMessage || hasErrorTerminalReason) return true;
  return status !== "completed";
}

function normalizeMentions(text: string): string {
  return text.replace(/@\[([^\]|]+)\|[^\]]+\]/g, "@$1");
}

function truncateForContinuation(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n\n...[truncated ${value.length - maxChars} chars from prior partial output]`;
}

function truncateForHistory(
  value: string,
  maxChars: number,
  label: string,
): string {
  if (value.length <= maxChars) return value;
  const omitted = value.length - maxChars;
  return `${value.slice(0, maxChars)}\n\n[${label} truncated after ${maxChars.toLocaleString()} characters; ${omitted.toLocaleString()} characters omitted from prior chat history. Read the current app/resource state with tools if exact content is needed.]`;
}

function contentToContinuationHistory(content: ContentPart[]): string {
  const chunks: string[] = [];
  for (const part of content) {
    if (part.type === "text") {
      if (part.text.trim()) chunks.push(part.text.trim());
      continue;
    }
    if (part.type === "reasoning") continue;
    if (part.activity === true) continue;
    const toolSummary = [
      `Tool: ${part.toolName}`,
      part.argsText ? `Input: ${part.argsText}` : "",
      part.result
        ? `Result:\n${truncateForContinuation(part.result, 8_000)}`
        : "Result: interrupted before this tool returned a result",
    ]
      .filter(Boolean)
      .join("\n");
    chunks.push(toolSummary);
  }
  return truncateForContinuation(chunks.join("\n\n"), 40_000).trim();
}

function messageTextFromContent(
  content: readonly { type: string; text?: string }[],
): string {
  return truncateForHistory(
    content
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => normalizeMentions(p.text))
      .join("\n"),
    MAX_HISTORY_MESSAGE_CHARS,
    "Message",
  );
}

function truncateToolArgsForHistory(
  args: unknown,
  toolName?: string,
): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  // Large-input tools (e.g. create-extension/update-extension) carry the
  // artifact itself as their input. Preserve the real input on continuation so
  // the resumed agent can keep refining it; only collapse inputs that exceed a
  // far larger ceiling than any realistic payload.
  const cap =
    toolName && LARGE_INPUT_TOOL_NAMES.has(toolName)
      ? MAX_HISTORY_LARGE_TOOL_ARGS_CHARS
      : MAX_HISTORY_TOOL_ARGS_CHARS;
  try {
    const json = JSON.stringify(args);
    if (json.length <= cap) {
      return args as Record<string, unknown>;
    }
    return {
      __agentNativeTruncated: true,
      note: "Tool input was too large to resend in chat history. Use the current app/resource state as the source of truth if exact content is needed.",
      preview: truncateForHistory(json, cap, "Tool input"),
    };
  } catch {
    return {
      __agentNativeTruncated: true,
      note: "Tool input could not be serialized for prior chat history.",
    };
  }
}

function messageTextFromContentRaw(
  content: readonly { type: string; text?: string }[],
): string {
  return content
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => normalizeMentions(p.text))
    .join("\n");
}

function escapeAttachmentAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isTextAttachmentContentType(value: string | undefined): boolean {
  if (!value) return false;
  const contentType = value.split(";")[0]?.trim().toLowerCase();
  return (
    !!contentType &&
    (contentType.startsWith("text/") ||
      TEXT_ATTACHMENT_CONTENT_TYPES.has(contentType))
  );
}

function isSvgAttachment(args: {
  name?: string;
  contentType?: string;
}): boolean {
  const contentType = args.contentType?.split(";")[0]?.trim().toLowerCase();
  return contentType === "image/svg+xml" || /\.svg$/i.test(args.name ?? "");
}

function decodeTextDataUrl(dataUrl: string): string | null {
  const match = dataUrl.match(
    /^data:([^;,]+)(?:;charset=[^;,]+)?(;base64)?,(.*)$/i,
  );
  if (!match || !isTextAttachmentContentType(match[1])) return null;

  try {
    const payload = match[3] ?? "";
    if (match[2]) {
      if (typeof atob === "function") {
        return decodeURIComponent(
          Array.from(
            atob(payload),
            (char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`,
          ).join(""),
        );
      }
      return null;
    }
    return decodeURIComponent(payload.replace(/\+/g, "%20"));
  } catch {
    return null;
  }
}

function extractAttachmentsFromMessage(message: {
  content?: readonly { type: string; image?: string }[];
  attachments?: readonly AssistantUiAttachment[];
}): AgentChatAdapterAttachment[] {
  const attachments: AgentChatAdapterAttachment[] = [];
  for (const att of message.attachments ?? []) {
    for (const part of att.content) {
      if (part.type === "image" && typeof part.image === "string") {
        const persistedMetadata =
          att && typeof (att as any).metadata === "object"
            ? ((att as any).metadata as Record<string, unknown>)
            : undefined;
        const imageIsDataUrl = part.image.startsWith("data:");
        attachments.push({
          type: "image",
          name: att.name,
          contentType: att.contentType,
          ...(imageIsDataUrl ? { data: part.image } : { url: part.image }),
          ...(typeof persistedMetadata?.uploadProvider === "string"
            ? { uploadProvider: persistedMetadata.uploadProvider }
            : {}),
          ...(persistedMetadata?.referenceOnly === true
            ? {
                referenceOnly: true,
                ...(typeof persistedMetadata.securityNote === "string"
                  ? { securityNote: persistedMetadata.securityNote }
                  : {}),
              }
            : {}),
        });
      } else if (
        part.type === "file" &&
        (typeof part.data === "string" || typeof part.url === "string")
      ) {
        const contentType =
          att.contentType ??
          (typeof part.mimeType === "string" ? part.mimeType : undefined);
        const data = typeof part.data === "string" ? part.data : undefined;
        const url = typeof part.url === "string" ? part.url : undefined;
        const persistedMetadata =
          att && typeof (att as any).metadata === "object"
            ? ((att as any).metadata as Record<string, unknown>)
            : undefined;
        const preserveDataUrl =
          typeof data === "string" &&
          data.startsWith("data:") &&
          shouldPreserveFileDataUrl({ name: att.name, contentType });
        const decodedText = data?.startsWith("data:")
          ? decodeTextDataUrl(data)
          : null;
        attachments.push({
          type: "file",
          name: att.name,
          contentType,
          ...(url ? { url } : {}),
          ...(preserveDataUrl
            ? {
                data,
                ...(decodedText !== null
                  ? { text: truncateOutboundAttachment(decodedText) }
                  : {}),
              }
            : decodedText !== null
              ? { text: truncateOutboundAttachment(decodedText) }
              : data?.startsWith("data:")
                ? { data }
                : url
                  ? {}
                  : { text: truncateOutboundAttachment(data ?? "") }),
          ...(typeof persistedMetadata?.uploadProvider === "string"
            ? { uploadProvider: persistedMetadata.uploadProvider }
            : {}),
          ...(persistedMetadata?.referenceOnly === true
            ? {
                referenceOnly: true,
                ...(typeof persistedMetadata.securityNote === "string"
                  ? { securityNote: persistedMetadata.securityNote }
                  : {}),
              }
            : {}),
        });
      } else if (part.type === "text" && typeof part.text === "string") {
        attachments.push({
          type: "file",
          name: att.name,
          contentType: att.contentType,
          text: truncateOutboundAttachment(unwrapAttachmentEnvelope(part.text)),
        });
      }
    }
  }
  for (const part of message.content ?? []) {
    if (part.type === "image" && typeof part.image === "string") {
      const imageIsDataUrl = part.image.startsWith("data:");
      attachments.push({
        type: "image",
        name: "image",
        contentType: /^data:([^;,]+)/.exec(part.image)?.[1],
        ...(imageIsDataUrl ? { data: part.image } : { url: part.image }),
      });
    }
  }
  return attachments;
}

function shouldPreserveFileDataUrl(args: {
  name?: string;
  contentType?: string;
}): boolean {
  return isSvgAttachment(args);
}

function truncateHistoryAttachment(text: string): string {
  if (text.length <= MAX_HISTORY_ATTACHMENT_CHARS) return text;
  const omitted = text.length - MAX_HISTORY_ATTACHMENT_CHARS;
  return `${text.slice(0, MAX_HISTORY_ATTACHMENT_CHARS)}\n\n[Attachment truncated after ${MAX_HISTORY_ATTACHMENT_CHARS.toLocaleString()} characters; ${omitted.toLocaleString()} characters omitted from prior chat history.]`;
}

function truncateOutboundAttachment(text: string): string {
  if (text.length <= MAX_OUTBOUND_ATTACHMENT_CHARS) return text;
  const omitted = text.length - MAX_OUTBOUND_ATTACHMENT_CHARS;
  return `${text.slice(0, MAX_OUTBOUND_ATTACHMENT_CHARS)}\n\n[Attachment truncated after ${MAX_OUTBOUND_ATTACHMENT_CHARS.toLocaleString()} characters; ${omitted.toLocaleString()} characters omitted from the submitted attachment.]`;
}

function attachmentHistoryText(
  attachment: AgentChatAdapterAttachment,
): string | null {
  if (isSvgAttachment(attachment)) {
    const label = attachment.name || "SVG attachment";
    const contentType = attachment.contentType
      ? ` (${attachment.contentType})`
      : "";
    return `[Attached ${attachment.type || "file"}: ${label}${contentType}; SVG reference-only, raw markup omitted from prior chat history.]`;
  }

  if (typeof attachment.text === "string" && attachment.text.length > 0) {
    const attrs = [
      `name="${escapeAttachmentAttribute(attachment.name || "attachment")}"`,
      attachment.contentType
        ? `contentType="${escapeAttachmentAttribute(attachment.contentType)}"`
        : null,
      attachment.type
        ? `type="${escapeAttachmentAttribute(attachment.type)}"`
        : null,
      attachment.url
        ? `url="${escapeAttachmentAttribute(attachment.url)}"`
        : null,
    ].filter(Boolean);
    return `<attachment ${attrs.join(" ")}>\n${truncateHistoryAttachment(attachment.text)}\n</attachment>`;
  }

  if (attachment.name) {
    const hostedUrl = attachment.url ? `; hosted URL: ${attachment.url}` : "";
    return `[Attached ${attachment.type || "file"}: ${attachment.name}${attachment.contentType ? ` (${attachment.contentType})` : ""}${hostedUrl}]`;
  }
  return null;
}

function messageTextForHistory(message: {
  content: readonly { type: string; text?: string }[];
  attachments?: readonly AssistantUiAttachment[];
}): string {
  const text = messageTextFromContentRaw(message.content);
  const attachments = extractAttachmentsFromMessage(message)
    .map(attachmentHistoryText)
    .filter((part): part is string => !!part && part.trim().length > 0);
  return truncateForHistory(
    [text, ...attachments].filter((part) => part.trim()).join("\n\n"),
    MAX_HISTORY_MESSAGE_CHARS,
    "Message",
  );
}

type AdapterMessage = {
  id?: string;
  role: string;
  content: readonly { type: string; text?: string }[];
  attachments?: readonly AssistantUiAttachment[];
  metadata?: unknown;
};

const RECOVERY_USER_MESSAGE_PREFIXES = [
  "Continue from where you left off",
  "Continue from where you stopped",
  "Retry the previous request from a clean approach",
];

function recoveryActionFromMessage(
  message: unknown,
): "continue" | "retry" | null {
  const meta = (message as { metadata?: unknown })?.metadata as
    | { custom?: { agentNativeRecoveryAction?: unknown } }
    | undefined;
  const action = meta?.custom?.agentNativeRecoveryAction;
  return action === "continue" || action === "retry" ? action : null;
}

function isRecoveryUserMessage(message: AdapterMessage): boolean {
  if (recoveryActionFromMessage(message)) return true;
  const text = messageTextFromContentRaw(message.content).trim();
  return RECOVERY_USER_MESSAGE_PREFIXES.some((prefix) =>
    text.startsWith(prefix),
  );
}

function latestUserMessage(
  messages: readonly AdapterMessage[],
  options?: { skipRecovery?: boolean; beforeIndex?: number },
): AdapterMessage | undefined {
  const start =
    typeof options?.beforeIndex === "number"
      ? Math.min(options.beforeIndex, messages.length)
      : messages.length;
  for (let i = start - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "user") continue;
    if (options?.skipRecovery && isRecoveryUserMessage(message)) continue;
    return message;
  }
  return undefined;
}

function isToolCallContentPart(
  part: unknown,
): part is Extract<ContentPart, { type: "tool-call" }> {
  return Boolean(
    part && typeof part === "object" && (part as any).type === "tool-call",
  );
}

function isSuccessOnlyToolResult(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  if (keys.length === 0) return true;
  return keys.every((key) => {
    const item = value[key];
    if (key === "ok" || key === "success") return item === true;
    if (key === "status") {
      return item === "ok" || item === "success" || item === "completed";
    }
    return false;
  });
}

function toolResultContent(result: unknown, toolName?: string): string {
  if (typeof result === "string") return result;
  const completed = toolName?.trim()
    ? `${toolName.trim()} completed.`
    : "Tool completed.";
  if (result === true || result == null) return completed;
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const record = result as Record<string, unknown>;
    const message = record.message ?? record.summary;
    if (typeof message === "string" && message.trim()) return message.trim();
    const title = record.title ?? record.name;
    if (typeof title === "string" && title.trim()) {
      return `${title.trim()} is ready.`;
    }
    const id = record.id ?? record.planId ?? record.commentId;
    if (typeof id === "string" && id.trim() && toolName?.trim()) {
      return `${toolName.trim()} completed for ${id.trim()}.`;
    }
    if (isSuccessOnlyToolResult(record)) return completed;
  }
  try {
    return JSON.stringify(result);
  } catch {
    return String(result ?? "");
  }
}

function contentToStructuredMessages(
  content: readonly ContentPart[],
  nextToolCallId: () => string,
  options?: { truncateForHistory?: boolean },
): AgentChatStructuredMessage[] {
  const messages: AgentChatStructuredMessage[] = [];
  let assistantParts: AgentChatStructuredContentPart[] = [];
  let pendingToolResults: AgentChatStructuredContentPart[] = [];
  const truncate = options?.truncateForHistory === true;

  const flushToolTurn = () => {
    if (pendingToolResults.length === 0) return;
    if (assistantParts.length > 0) {
      messages.push({ role: "assistant", content: assistantParts });
    }
    messages.push({ role: "user", content: pendingToolResults });
    assistantParts = [];
    pendingToolResults = [];
  };

  for (const part of content) {
    if (part.type === "text") {
      if (pendingToolResults.length > 0) flushToolTurn();
      if (part.text.trim()) {
        assistantParts.push({
          type: "text",
          text: truncate
            ? truncateForHistory(
                part.text,
                MAX_HISTORY_MESSAGE_CHARS,
                "Assistant text",
              )
            : part.text,
        });
      }
      continue;
    }

    // Reasoning/thinking is UI-only — do not send chain-of-thought back into
    // model history on continuation.
    if (part.type === "reasoning") {
      continue;
    }

    if (isToolCallContentPart(part)) {
      if (part.activity === true || part.toolName.startsWith("agent:")) {
        continue;
      }
      const toolCallId = nextToolCallId();
      assistantParts.push({
        type: "tool-call",
        toolCallId,
        toolName: part.toolName,
        args: truncate
          ? truncateToolArgsForHistory(part.args ?? {}, part.toolName)
          : (part.args ?? {}),
      });
      if (part.result !== undefined) {
        const body = truncate
          ? truncateForHistory(
              toolResultContent(part.result, part.toolName),
              MAX_HISTORY_TOOL_RESULT_CHARS,
              "Tool result",
            )
          : toolResultContent(part.result, part.toolName);
        pendingToolResults.push({
          type: "tool-result",
          toolCallId,
          toolName: part.toolName,
          toolInput: JSON.stringify(part.args ?? {}),
          // A settled-interrupted tool has a result whose outcome is UNKNOWN.
          // It is neither a success nor a failure, so it carries the marker the
          // server's write-interruption breaker matches on instead of claiming
          // either.
          content:
            part.outcome === "unknown" &&
            !body.includes(INTERRUPTED_TOOL_RESULT)
              ? `${INTERRUPTED_TOOL_RESULT} ${body}`
              : body,
          ...(part.isError === true && part.outcome !== "unknown"
            ? { isError: true }
            : {}),
        });
      } else {
        pendingToolResults.push({
          type: "tool-result",
          toolCallId,
          toolName: part.toolName,
          toolInput: JSON.stringify(part.args ?? {}),
          content: INTERRUPTED_TOOL_RESULT,
        });
      }
    }
  }

  flushToolTurn();
  if (assistantParts.length > 0) {
    messages.push({ role: "assistant", content: assistantParts });
  }
  return messages;
}

function assistantUiMessagesToStructuredHistory(
  messages: readonly {
    role: string;
    content: readonly any[];
    attachments?: readonly AssistantUiAttachment[];
  }[],
): AgentChatStructuredMessage[] {
  let nextId = 0;
  const nextToolCallId = () => `history_tc_${++nextId}`;
  const structured: AgentChatStructuredMessage[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      const text = messageTextForHistory(message);
      if (text.trim()) {
        structured.push({
          role: "user",
          content: [{ type: "text", text }],
        });
      }
      continue;
    }

    if (message.role !== "assistant") continue;
    const content: ContentPart[] = [];
    for (const part of message.content) {
      if (part?.type === "text" && typeof part.text === "string") {
        content.push({ type: "text", text: part.text });
        continue;
      }
      if (part?.type === "tool-call") {
        if ((part as { activity?: unknown }).activity === true) continue;
        const toolNameRaw =
          typeof part.toolName === "string"
            ? part.toolName
            : typeof (part as { name?: string }).name === "string"
              ? (part as { name?: string }).name
              : "";
        const toolName = toolNameRaw.trim();
        if (!toolName) continue;
        content.push({
          type: "tool-call",
          toolCallId:
            typeof part.toolCallId === "string" ? part.toolCallId : "",
          toolName,
          argsText:
            typeof part.argsText === "string"
              ? part.argsText
              : JSON.stringify(part.args ?? {}),
          args:
            part.args &&
            typeof part.args === "object" &&
            !Array.isArray(part.args)
              ? part.args
              : {},
          ...(part.result !== undefined
            ? { result: toolResultContent(part.result, toolName) }
            : {}),
          // A failed call replayed without `isError` reads to the next turn as
          // an ordinary success whose body happens to contain error prose, so
          // the model cannot tell it already tried this and failed. The
          // server's repeat-error breaker keys on exactly this flag.
          ...(part.isError === true ? { isError: true } : {}),
          ...(part.outcome === "unknown"
            ? { outcome: "unknown" as const }
            : {}),
        });
      }
    }
    structured.push(
      ...contentToStructuredMessages(content, nextToolCallId, {
        truncateForHistory: true,
      }),
    );
  }

  return structured;
}

/**
 * Size this message will actually contribute to the request, AFTER the
 * per-part truncation `assistantUiMessagesToStructuredHistory` applies. Tool
 * calls are most of a tool-heavy turn, so counting only text parts priced a
 * turn of 40 tool calls at ~0: it survived every trim against
 * MAX_HISTORY_TOTAL_CHARS while the user's own prose was evicted around it.
 */
function estimateHistoryMessageCost(message: {
  content: readonly { type: string; text?: string }[];
  attachments?: readonly AssistantUiAttachment[];
}): number {
  let cost = messageTextForHistory(message).length;
  for (const part of message.content) {
    if (part.type !== "tool-call") continue;
    const tool = part as {
      toolName?: string;
      argsText?: string;
      args?: unknown;
      result?: unknown;
    };
    const argsCap = LARGE_INPUT_TOOL_NAMES.has(tool.toolName ?? "")
      ? MAX_HISTORY_LARGE_TOOL_ARGS_CHARS
      : MAX_HISTORY_TOOL_ARGS_CHARS;
    const argsText = tool.argsText ?? stableJson(tool.args ?? {});
    cost += Math.min(argsText.length, argsCap);
    if (tool.result !== undefined) {
      cost += Math.min(
        // Price the string the request actually carries. `String(result)` is
        // 15 chars ("[object Object]") for every object result, which is most
        // of them.
        toolResultContent(tool.result, tool.toolName).length,
        MAX_HISTORY_TOOL_RESULT_CHARS,
      );
    }
  }
  return Math.max(1, cost);
}

function limitPriorMessagesForRequest<
  T extends {
    role: string;
    content: readonly { type: string; text?: string }[];
    attachments?: readonly AssistantUiAttachment[];
  },
>(messages: readonly T[]): T[] {
  const recent = messages.slice(-MAX_HISTORY_MESSAGES);
  const kept: T[] = [];
  let words = 0;
  let payload = 0;

  for (let i = recent.length - 1; i >= 0; i--) {
    const message = recent[i];
    if (message.role !== "user" && message.role !== "assistant") continue;
    // What was said is cheap and cannot be re-derived; what a tool returned is
    // ~97% of a tool-heavy turn and can always be re-read. Pricing both against
    // one budget let a single read-heavy turn evict the whole conversation, so
    // the agent re-derived the same answer and re-asked the same question.
    const wordCost = messageTextForHistory(message).length;
    if (kept.length > 0 && words + wordCost > MAX_HISTORY_WORD_CHARS) continue;
    const payloadCost = estimateHistoryMessageCost(message) - wordCost;
    const affordsPayload = payload + payloadCost <= MAX_HISTORY_TOTAL_CHARS;
    const content = affordsPayload
      ? message.content
      : message.content.filter((part) => part.type === "text");
    if (!content.length) continue;
    kept.push(affordsPayload ? message : { ...message, content });
    words += wordCost;
    if (affordsPayload) payload += payloadCost;
  }

  kept.reverse();
  // Stop before emptying: this rule exists to start history on a user turn for
  // providers that require it, not to license sending no history at all. It was
  // the last step that turned an over-budget turn into a blank conversation.
  while (kept.length > 1 && kept[0].role !== "user") {
    kept.shift();
  }
  return kept;
}

function combineContinuationHistory(fragments: string[]): string {
  return truncateForContinuation(
    fragments.filter(Boolean).join("\n\n"),
    40_000,
  ).trim();
}

function hasContinuationProgress(content: ContentPart[]): boolean {
  return content.some((part) => {
    if (part.type === "text") return part.text.trim().length > 0;
    if (part.type === "reasoning") return false;
    return part.result !== undefined;
  });
}

const COMPLETED_TOOL_TIMEOUT_NAME_RE =
  /^(add|apply|archive|capture|compose|create|delete|deploy|duplicate|edit|generate|grant|insert|install|migrate|move|mutate|present|publish|remove|rename|reorder|revoke|save|send|set|sync|trash|update|write)(-|$)/;
const COMPLETED_TOOL_TIMEOUT_NAME_ALLOWLIST = new Set([
  "connect-assets-mcp",
  "import-design-tokens",
]);

function isCompletedToolTimeoutCandidate(
  part: Extract<ContentPart, { type: "tool-call" }>,
): boolean {
  if (part.completedSideEffect === false) return false;
  if (part.completedSideEffect === true) return true;
  const toolName = part.toolName.toLowerCase();
  return (
    COMPLETED_TOOL_TIMEOUT_NAME_ALLOWLIST.has(toolName) ||
    COMPLETED_TOOL_TIMEOUT_NAME_RE.test(toolName)
  );
}

function lastCompletedTimeoutCandidateTool(
  content: ContentPart[],
): Extract<ContentPart, { type: "tool-call" }> | undefined {
  for (let i = content.length - 1; i >= 0; i--) {
    const part = content[i];
    if (
      part.type === "tool-call" &&
      part.activity !== true &&
      part.result !== undefined &&
      part.isError !== true &&
      // A settled-interrupted tool has a result but an unknown outcome; claiming
      // it completed is the same false-success this message exists to avoid.
      part.outcome !== "unknown" &&
      isCompletedToolTimeoutCandidate(part)
    ) {
      return part;
    }
  }
  return undefined;
}

function humanizeActionName(toolName: string): string {
  return toolName
    .replace(/^agent:/, "")
    .replace(/[-_]+/g, " ")
    .trim();
}

function completedToolTimeoutMessage(toolName: string): string {
  if (toolName === "generate-design" || toolName === "update-design") {
    return "The design was saved, but the assistant timed out before sending its final note. You can open the generated design from the completed tool card above.";
  }
  if (toolName === "present-design-variants") {
    return "The design variants were saved, but the assistant timed out before sending its final note. You can review the completed variants from the tool card above.";
  }
  return `The ${humanizeActionName(toolName)} action completed, but the assistant timed out before sending its final response. The saved result is in the completed tool card above.`;
}

/**
 * Signature of the *unique* sentence-like segments in a continuation's newly
 * streamed text, used to detect a degenerate repetition loop. A stuck model
 * re-emits the same phrase ("I have the full HTML. Creating the extension
 * now!") an arbitrary number of times per run, so the set of unique segments
 * is small and stable across continuations regardless of how many times any
 * single run repeated it. An empty signature (no visible text) is never a
 * repeat — the stalled/empty budgets handle no-output stalls instead.
 */
function continuationRepeatSignature(content: ContentPart[]): string {
  const text = content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join(" ")
    .toLowerCase();
  const segments = text
    // Split after sentence punctuation even when runs are concatenated without
    // a following space ("...now!I have..."), and on newlines.
    .split(/(?<=[.!?])|\n+/)
    .map((segment) => segment.replace(/[^a-z0-9]+/g, " ").trim())
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) return "";
  return Array.from(new Set(segments)).sort().join("\u0000");
}

type ContinuationAdvance = {
  signature: string;
  /**
   * What the round was left sitting on. Only the give-up wording reads this;
   * the control flow is the signature comparison alone.
   */
  stall: {
    kind: "in-flight" | "preparing" | "repeat" | "empty";
    toolName?: string;
  };
};

/**
 * Everything a continuation could have advanced, as one signature over the
 * work it produced: the distinct tool results it completed, the tool it left
 * in flight, and the action card it left unstarted. Two consecutive
 * continuations with the same signature moved the turn nowhere, whatever the
 * server's reason code called it.
 *
 * DISTINCT, not per-occurrence: a round that degenerates into four hundred
 * copies of one tool call collapses to the same signature as the round before
 * it, which is exactly the shape production shows (up to 28 identical calls in
 * one turn).
 *
 * Narration counts only when the round left NO unfinished work. A model stuck
 * re-wording "I have the file, creating it now!" while the same action never
 * starts emits new prose every round, and prose alone is why that used to look
 * like progress.
 */
function describeContinuationAdvance(
  content: ContentPart[],
  preparingToolName: string | undefined,
): ContinuationAdvance {
  const work = new Set<string>();
  let stall: ContinuationAdvance["stall"] | null = null;
  for (const part of content) {
    if (part.type !== "tool-call") continue;
    if (part.result !== undefined) {
      if (part.activity !== true) {
        work.add(
          `done ${part.toolName} ${inFlightToolInputSignature(part)} ${part.result.length} ${part.result.slice(0, 256)}`,
        );
      }
      continue;
    }
    if (part.activity === true && !isDelegatedAgentToolCall(part)) {
      work.add(`preparing ${part.toolName}`);
      stall ??= { kind: "preparing", toolName: part.toolName };
    } else {
      work.add(`pending ${part.toolName} ${inFlightToolInputSignature(part)}`);
      stall = { kind: "in-flight", toolName: part.toolName };
    }
  }
  // A "Preparing X action" card is an activity-trail entry, not a content
  // part, so a round can sit on an unstarted action while its content holds
  // nothing but narration.
  if (preparingToolName && !stall) {
    work.add(`preparing ${preparingToolName}`);
    stall = { kind: "preparing", toolName: preparingToolName };
  }
  if (!stall) {
    const text = continuationRepeatSignature(content);
    if (text) work.add(`text ${text}`);
    stall = text ? { kind: "repeat" } : { kind: "empty" };
  }
  return { signature: Array.from(work).sort().join(""), stall };
}

/**
 * True when an action was streamed but never returned a result yet — i.e. a
 * `tool_start` with no matching `tool_done`. The server is still executing it,
 * so a run_timeout that fires in this window is NOT a stall: the agent was
 * actively working and `foldAssistantTurn` persisted the in-flight call. We
 * must not count this against the stalled/empty continuation budgets.
 */
export function hasInFlightToolCall(content: ContentPart[]): boolean {
  return content.some((part) => isToolCallInFlight(part));
}

/**
 * Server truth for "does this run still look alive?", used to keep the client
 * from aborting a run the server believes is healthy — the destructive half of
 * the old client watchdog. Fails SAFE (true) when the lookup itself fails: an
 * unreachable server is not evidence that the run is dead. A local content
 * snapshot with an unresolved tool call is also treated as alive, matching the
 * server's own in-flight suspension.
 */
export async function activeRunLooksAlive(args: {
  apiUrl: string;
  threadId: string | undefined;
  runId: string;
  content?: ContentPart[];
}): Promise<boolean> {
  if (args.content && hasInFlightToolCall(args.content)) return true;
  if (!args.threadId) return false;
  try {
    const res = await fetch(
      `${args.apiUrl}/runs/active?threadId=${encodeURIComponent(args.threadId)}`,
      { credentials: "same-origin" },
    );
    if (!res.ok) return true;
    const data = (await res.json()) as {
      active?: boolean;
      runId?: string;
      status?: string;
      hasInFlightWork?: boolean;
    } | null;
    if (data?.active !== true || String(data.runId ?? "") !== args.runId) {
      return false;
    }
    // `running` only says the server row has not terminalized. It is not proof
    // that a tool is executing, and treating it as proof skips the client
    // rescue precisely when a stalled run has no in-flight work.
    return data.hasInFlightWork === true;
  } catch {
    return true;
  }
}

function lastActivityTool(
  trail: readonly AgentActivityTrailEntry[],
): string | undefined {
  for (let i = trail.length - 1; i >= 0; i--) {
    const tool = trail[i]?.tool?.trim();
    if (tool) return tool;
  }
  return undefined;
}

function lastPreparingActionTool(
  trail: readonly AgentActivityTrailEntry[],
): string | undefined {
  for (let i = trail.length - 1; i >= 0; i--) {
    const entry = trail[i];
    const tool = entry?.tool?.trim();
    if (!tool) continue;
    const label = entry.label.trim().toLowerCase();
    if (label.startsWith("preparing ") && label.includes(" action")) {
      return tool;
    }
  }
  return undefined;
}

function formatActivityTrail(
  trail: readonly AgentActivityTrailEntry[],
): string | undefined {
  const items = trail
    .slice(-8)
    .map((entry) => {
      const label = entry.label.replace(/\s+/g, " ").trim();
      const tool = entry.tool?.replace(/\s+/g, " ").trim();
      if (label && tool && label !== tool) return `${label} (${tool})`;
      return label || tool || "";
    })
    .filter(Boolean);
  return items.length > 0 ? items.join(" > ") : undefined;
}

function lastUnresolvedToolActivity(
  content: ContentPart[],
): string | undefined {
  for (let i = content.length - 1; i >= 0; i--) {
    const part = content[i];
    if (
      part.type === "tool-call" &&
      part.activity === true &&
      part.result === undefined
    ) {
      return part.toolName;
    }
  }
  return undefined;
}

function snapshotContent(content: ContentPart[]): ContentPart[] {
  return content.map((part) =>
    part.type === "text" || part.type === "reasoning"
      ? { ...part }
      : { ...part, args: { ...part.args } },
  );
}

function hasMissingFinalResponseAfterTool(content: ContentPart[]): boolean {
  const warning = appendMissingFinalResponseWarning(snapshotContent(content));
  return warning?.errorCode === "final_response_missing_after_tool";
}

function missingFinalResponseWarningFromResult(
  result: ChatModelRunResult,
): { message: string } | null {
  const metadata = result.metadata as { custom?: unknown } | undefined;
  const custom = metadata?.custom;
  if (!custom || typeof custom !== "object") return null;
  const warning = (custom as Record<string, unknown>).runWarning;
  if (!warning || typeof warning !== "object") return null;
  const warningRecord = warning as Record<string, unknown>;
  if (warningRecord.errorCode !== "final_response_missing_after_tool") {
    return null;
  }
  return {
    message:
      typeof warningRecord.message === "string" ? warningRecord.message : "",
  };
}

function stableJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value ?? "");
  }
}

// Bounded signature of an in-flight tool call's input, used by the stall guard
// to tell a genuinely-stuck retry (same tool, same payload, connection keeps
// dropping) apart from a legitimate retry with a CHANGED payload (e.g. the
// `create-extension` cutoff nudge tells the model to re-send a smaller body).
// A changed payload yields a different signature, so the guard resets that
// tool's stall budget instead of aborting the new attempt as a repeat. Bounded
// to length + head so we never retain a large pasted payload across rounds.
function inFlightToolInputSignature(
  part: Extract<ContentPart, { type: "tool-call" }>,
): string {
  const raw = part.argsText ?? stableJson(part.args);
  return `${raw.length}\u0000${raw.slice(0, 256)}`;
}

function toolContinuationKey(
  part: Extract<ContentPart, { type: "tool-call" }>,
): string {
  return [
    part.toolCallId,
    part.toolName,
    part.argsText,
    stableJson(part.args),
    part.result === undefined ? "pending" : "done",
    part.result ?? "",
    part.isError === true ? "error" : "",
    part.completedSideEffect === true ? "side-effect" : "",
    part.activity === true ? "activity" : "tool",
    part.mcpApp ? "mcp-app" : "",
  ].join("\u0000");
}

function contentAfterContinuationPrefix(
  content: ContentPart[],
  prefix: ContentPart[],
): ContentPart[] {
  if (prefix.length === 0) return content;

  const delta: ContentPart[] = [];
  let contentIndex = 0;

  for (const prefixPart of prefix) {
    const currentPart = content[contentIndex];
    if (!currentPart) return content.slice(contentIndex);

    if (prefixPart.type === "text" && currentPart.type === "text") {
      if (currentPart.text === prefixPart.text) {
        contentIndex += 1;
        continue;
      }

      if (currentPart.text.startsWith(prefixPart.text)) {
        const appendedText = currentPart.text.slice(prefixPart.text.length);
        if (appendedText) delta.push({ type: "text", text: appendedText });
        contentIndex += 1;
        continue;
      }

      return content.slice(contentIndex);
    }

    if (prefixPart.type === "reasoning" && currentPart.type === "reasoning") {
      if (currentPart.text === prefixPart.text) {
        contentIndex += 1;
        continue;
      }
      if (currentPart.text.startsWith(prefixPart.text)) {
        const appendedText = currentPart.text.slice(prefixPart.text.length);
        if (appendedText) {
          delta.push({ type: "reasoning", text: appendedText });
        }
        contentIndex += 1;
        continue;
      }
      return content.slice(contentIndex);
    }

    if (
      prefixPart.type === "tool-call" &&
      currentPart.type === "tool-call" &&
      toolContinuationKey(currentPart) === toolContinuationKey(prefixPart)
    ) {
      contentIndex += 1;
      continue;
    }

    return content.slice(contentIndex);
  }

  return [...delta, ...content.slice(contentIndex)];
}

function autoContinueMessage(signal: AgentAutoContinueSignal): string {
  const tool = lastActivityTool(signal.activityTrail);
  const reason =
    signal.reason === "loop_limit"
      ? "The previous run reached an internal step budget."
      : signal.reason === "stale_run"
        ? "The previous run stopped unexpectedly in the server runtime before it could finish."
        : signal.reason === "no_progress"
          ? "The previous run stopped producing progress events while the connection stayed open."
          : signal.reason === "stream_ended"
            ? "The previous stream ended before the agent sent a final completion signal."
            : "The previous run reached an internal execution budget.";
  // A run_timeout or a mid-stream cutoff while assembling one large action
  // payload (e.g. inlining a big pasted HTML file into `create-extension`, a
  // full file set into `generate-design`, or a whole `update-dashboard` config)
  // is the classic trigger for the repetition/cutoff loop. Nudge the model
  // toward a compact first version it can actually finish in a single run, then
  // incremental refinements — never re-streaming the same oversized payload.
  const cutoffPreparingAction =
    signal.reason === "run_timeout" ||
    signal.reason === "stream_ended" ||
    signal.reason === "no_progress";
  let actionInputNote = "";
  if (cutoffPreparingAction && tool) {
    actionInputNote = actionPreparationContinuationNote(tool);
  }
  return `${AUTO_CONTINUE_PROMPT}\n\n${AUTO_CONTINUE_COMPLETION_GUARD}\n\nInternal note: ${reason}${actionInputNote}`;
}

function delay(ms: number, abortSignal: AbortSignal): Promise<void> {
  if (abortSignal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      abortSignal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    abortSignal.addEventListener("abort", onAbort, { once: true });
  });
}

class AgentStartupTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(
      `Agent chat did not start streaming within ${Math.round(timeoutMs / 1000)}s.`,
    );
    this.name = "AgentStartupTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

type StructuredAgentChatError = {
  message: string;
  errorCode?: string;
  details?: string;
  retryable?: boolean;
  upgradeUrl?: string;
};

/**
 * Keep the server's error contract intact across the fetch boundary. In
 * particular, a POST response with `retryable: false` must not be fed into the
 * generic reconnect/continuation path: replaying a mutation after the server
 * has started processing it can duplicate work. The previous code discarded
 * this metadata and exposed the raw JSON body to the user instead.
 */
class AgentChatHttpError extends Error {
  readonly errorCode?: string;
  readonly details?: string;
  readonly retryable?: boolean;
  readonly upgradeUrl?: string;

  constructor(error: StructuredAgentChatError) {
    super(error.message);
    this.name = "AgentChatHttpError";
    this.errorCode = error.errorCode;
    this.details = error.details;
    this.retryable = error.retryable;
    this.upgradeUrl = error.upgradeUrl;
  }
}

function parseStructuredAgentChatError(
  body: string,
): StructuredAgentChatError | null {
  if (!body.trim()) return null;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;
    const message =
      typeof parsed.error === "string"
        ? parsed.error
        : typeof parsed.message === "string"
          ? parsed.message
          : "";
    if (!message) return null;
    return {
      message,
      ...(typeof parsed.code === "string"
        ? { errorCode: parsed.code }
        : typeof parsed.errorCode === "string"
          ? { errorCode: parsed.errorCode }
          : {}),
      ...(typeof parsed.details === "string"
        ? { details: parsed.details }
        : {}),
      ...(typeof parsed.retryable === "boolean"
        ? { retryable: parsed.retryable }
        : {}),
      ...(typeof parsed.upgradeUrl === "string"
        ? { upgradeUrl: parsed.upgradeUrl }
        : {}),
    };
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

async function fetchWithStartupTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  abortSignal: AbortSignal,
): Promise<Response> {
  if (abortSignal.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abort = () => controller.abort();
  abortSignal.addEventListener("abort", abort, { once: true });

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      throw new AgentStartupTimeoutError(timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    abortSignal.removeEventListener("abort", abort);
  }
}

function retryDelay(attempt: number, abortSignal: AbortSignal): Promise<void> {
  const base = Math.min(
    RETRY_MAX_DELAY_MS,
    RETRY_BASE_DELAY_MS * Math.pow(2, attempt),
  );
  const jitter = base * 0.2;
  const ms = Math.max(0, base + (Math.random() * 2 - 1) * jitter);
  return delay(ms, abortSignal);
}

function shouldCaptureRecoveryHttpStatus(status: number): boolean {
  return status < 500 || status >= 600;
}

function generateTurnId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `turn-${crypto.randomUUID()}`;
  }
  return `turn-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isRetryableStartupError(message: string): boolean {
  const msg = message.toLowerCase();
  if (
    msg.includes("cannot find any route matching") &&
    msg.includes("/_agent-native/agent-chat")
  ) {
    return true;
  }
  if (
    msg.includes("unauthorized") ||
    msg.includes("not authenticated") ||
    msg.includes("401") ||
    msg.includes("403") ||
    msg.includes("404") ||
    msg.includes("405") ||
    msg.includes("missing api key") ||
    msg.includes("api key") ||
    msg.includes("context_length") ||
    msg.includes("input_too_long") ||
    msg.includes("too many tokens") ||
    msg.includes("prompt is too long") ||
    msg.includes("credits-limit") ||
    msg.includes("billing") ||
    msg.includes("permission")
  ) {
    return false;
  }
  return (
    msg.includes("failed to fetch") ||
    msg.includes("network") ||
    msg.includes("connection") ||
    msg.includes("reset") ||
    msg.includes("econnreset") ||
    msg.includes("socket") ||
    msg.includes("timeout") ||
    msg.includes("gateway timeout") ||
    msg.includes("inactivity timeout") ||
    msg.includes("temporarily unavailable") ||
    msg.includes("server error: 408") ||
    msg.includes("server error: 429") ||
    msg.includes("server error: 500") ||
    msg.includes("server error: 502") ||
    msg.includes("server error: 503") ||
    msg.includes("server error: 504") ||
    msg.includes("429") ||
    msg.includes("500") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504") ||
    msg.includes("529")
  );
}

function isAuthErrorMessage(message: string): boolean {
  const msg = message.toLowerCase();
  return (
    msg.includes("authentication required") ||
    msg.includes("unauthorized") ||
    msg.includes("not authenticated") ||
    msg.includes("forbidden") ||
    msg.includes("invalid token") ||
    msg.includes("invalid or expired token") ||
    msg.includes("session expired") ||
    msg.includes("http_401") ||
    msg.includes("http_403") ||
    msg.includes("401") ||
    msg.includes("403") ||
    msg.includes("405")
  );
}

function authErrorReasonFromMessage(
  message: string,
): "auth-required" | "session-expired" {
  const msg = message.toLowerCase();
  return msg.includes("session") ||
    msg.includes("expired") ||
    msg.includes("invalid token") ||
    msg.includes("405")
    ? "session-expired"
    : "auth-required";
}

function authErrorText(
  reason: "auth-required" | "session-expired",
  message?: string,
): string {
  const fallback =
    reason === "session-expired"
      ? "Your chat session expired. Refresh chat and sign in again to continue."
      : "Authentication required. Sign in again to use chat.";

  if (!message) return formatChatErrorText(fallback);

  try {
    const parsed = JSON.parse(message) as {
      error?: unknown;
      message?: unknown;
    };
    const raw =
      typeof parsed.error === "string"
        ? parsed.error
        : typeof parsed.message === "string"
          ? parsed.message
          : undefined;
    return formatChatErrorText(raw || fallback);
  } catch {
    return formatChatErrorText(message || fallback);
  }
}

function safeAgentNativePath(path: string): string {
  try {
    return agentNativePath(path);
  } catch {
    return path;
  }
}

function isMissingCredentialMessage(message: string): boolean {
  const msg = message.toLowerCase();
  return (
    msg.includes("apikey") ||
    msg.includes("authtoken") ||
    msg.includes("anthropic_api_key") ||
    msg.includes("missing_api_key") ||
    msg.includes("missing api key") ||
    msg.includes("missing credentials") ||
    msg.includes("no llm provider") ||
    msg.includes("llm provider is connected")
  );
}

function missingCredentialFailure(message: string): {
  text: string;
  runError: { message: string; errorCode: string };
} {
  try {
    const parsed = JSON.parse(message) as {
      error?: unknown;
      message?: unknown;
      upgradeUrl?: unknown;
      errorCode?: unknown;
    };
    const raw =
      typeof parsed.error === "string"
        ? parsed.error
        : typeof parsed.message === "string"
          ? parsed.message
          : message;
    const errorCode =
      typeof parsed.errorCode === "string"
        ? parsed.errorCode
        : "missing_credentials";
    return {
      text: formatChatErrorText(
        raw,
        typeof parsed.upgradeUrl === "string" ? parsed.upgradeUrl : undefined,
        errorCode,
      ),
      runError: {
        message: normalizeChatError(raw).message,
        errorCode,
      },
    };
  } catch {
    return {
      text: formatChatErrorText(message, undefined, "missing_credentials"),
      runError: {
        message: normalizeChatError(message).message,
        errorCode: "missing_credentials",
      },
    };
  }
}

/**
 * The composer's exec mode is sent as explicit request metadata. The server
 * owns the plan-mode prompt and read-only tool filtering so the chat history
 * stays clean and Plan mode is enforced outside the model's goodwill.
 */
/**
 * Creates a ChatModelAdapter that connects to the agent-native
 * `/_agent-native/agent-chat` SSE endpoint. Supports reconnection via run-manager.
 */
export interface CreateAgentChatAdapterOptions {
  apiUrl?: string;
  tabId?: string;
  threadId?: string;
  modelRef?: { current: string | undefined };
  engineRef?: { current: string | undefined };
  effortRef?: { current: ReasoningEffort | undefined };
  harnessRef?: { current: string | undefined };
  hostedHarnessRef?: { current: boolean };
  execModeRef?: { current: "build" | "plan" | undefined };
  browserTabId?: string;
  scopeRef?: { current: ChatThreadScope | null | undefined };
  surface?: AgentChatSurfaceKind;
}

function runtimeDebugUrlForApiUrl(apiUrl: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const url = new URL(apiUrl, window.location.href);
    const marker = "/_agent-native/";
    const markerIndex = url.pathname.indexOf(marker);
    if (markerIndex < 0) return null;
    url.pathname = `${url.pathname.slice(0, markerIndex)}${marker}debug/runtime`;
    url.search = "";
    return url.toString();
  } catch {
    return null;
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function formatRuntimeDebugDetails(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const root = payload as Record<string, any>;
  const runtime =
    root.runtime && typeof root.runtime === "object" ? root.runtime : {};
  const database =
    runtime.database && typeof runtime.database === "object"
      ? runtime.database
      : {};
  const schema =
    root.schema && typeof root.schema === "object" ? root.schema : {};
  const lines = [
    stringValue(runtime.app) ? `runtime_app: ${runtime.app}` : "",
    stringValue(runtime.environment)
      ? `runtime_environment: ${runtime.environment}`
      : "",
    stringValue(runtime.deployContext)
      ? `deploy_context: ${runtime.deployContext}`
      : "",
    stringValue(runtime.deployId) ? `deploy_id: ${runtime.deployId}` : "",
    stringValue(runtime.commitRef) ? `commit_ref: ${runtime.commitRef}` : "",
    stringValue(runtime.branch) ? `branch: ${runtime.branch}` : "",
    stringValue(runtime.siteName) ? `site_name: ${runtime.siteName}` : "",
    typeof database.configured === "boolean"
      ? `db_configured: ${database.configured}`
      : "",
    stringValue(database.source) ? `db_source: ${database.source}` : "",
    stringValue(database.dialect) ? `db_dialect: ${database.dialect}` : "",
    stringValue(database.protocol) ? `db_protocol: ${database.protocol}` : "",
    stringValue(database.host) ? `db_host: ${database.host}` : "",
    stringValue(database.database) ? `db_database: ${database.database}` : "",
    stringValue(database.urlHash) ? `db_url_hash: ${database.urlHash}` : "",
    database.neon?.endpointId
      ? `db_neon_endpoint: ${database.neon.endpointId}`
      : "",
    typeof database.neon?.pooled === "boolean"
      ? `db_neon_pooled: ${database.neon.pooled}`
      : "",
    typeof schema.ok === "boolean" ? `schema_ok: ${schema.ok}` : "",
    Array.isArray(schema.missingTables) && schema.missingTables.length
      ? `schema_missing_tables: ${schema.missingTables.join(", ")}`
      : "",
    Array.isArray(schema.missingColumns) && schema.missingColumns.length
      ? `schema_missing_columns: ${schema.missingColumns
          .map((entry: any) => `${entry.table}.${entry.column}`)
          .join(", ")}`
      : "",
    stringValue(schema.error) ? `schema_error: ${schema.error}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

export function createAgentChatAdapter(
  options?: CreateAgentChatAdapterOptions,
): ChatModelAdapter {
  const apiUrl =
    options?.apiUrl ?? agentNativePath("/_agent-native/agent-chat");
  const tabId = options?.tabId;
  const threadId = options?.threadId;
  const modelRef = options?.modelRef;
  const engineRef = options?.engineRef;
  const effortRef = options?.effortRef;
  const harnessRef = options?.harnessRef;
  const hostedHarnessRef = options?.hostedHarnessRef;
  const execModeRef = options?.execModeRef;
  const browserTabId = options?.browserTabId;
  const scopeRef = options?.scopeRef;
  const surface = options?.surface ?? "app";
  // A queued recovery can survive until a server-owned continuation finishes,
  // and assistant-ui may ask the same memoized adapter to run that item again.
  const claimedRecoveryMessageIds = new Set<string>();
  let runtimeDebugDetails = "";
  const runtimeDebugUrl = runtimeDebugUrlForApiUrl(apiUrl);
  if (runtimeDebugUrl && typeof fetch === "function") {
    void fetch(runtimeDebugUrl, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        runtimeDebugDetails = formatRuntimeDebugDetails(payload);
      })
      .catch(() => {});
  }

  return {
    async *run({ messages, abortSignal, runConfig }) {
      // Extract latest user message and build history from prior messages
      const adapterMessages = messages as readonly AdapterMessage[];
      const latestUserIndex = (() => {
        for (let i = adapterMessages.length - 1; i >= 0; i--) {
          if (adapterMessages[i].role === "user") return i;
        }
        return -1;
      })();
      const latestUserMsg =
        latestUserIndex >= 0 ? adapterMessages[latestUserIndex] : undefined;
      const latestUserIsRecovery = latestUserMsg
        ? isRecoveryUserMessage(latestUserMsg)
        : false;
      const recoveryMessageId =
        latestUserIsRecovery && latestUserMsg?.id?.trim()
          ? latestUserMsg.id.trim()
          : null;
      if (recoveryMessageId) {
        if (claimedRecoveryMessageIds.has(recoveryMessageId)) return;
        claimedRecoveryMessageIds.add(recoveryMessageId);
      }
      const lastUserMsg =
        latestUserIsRecovery && latestUserIndex >= 0
          ? (latestUserMessage(adapterMessages, {
              skipRecovery: true,
              beforeIndex: latestUserIndex,
            }) ?? latestUserMsg)
          : latestUserMsg;
      const recoveryMessageText =
        latestUserIsRecovery && latestUserMsg
          ? messageTextFromContentRaw(latestUserMsg.content)
          : "";
      const rawMessageText =
        lastUserMsg?.content
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("\n") ?? "";
      const runConfigRequestMode =
        runConfig?.custom &&
        typeof runConfig.custom === "object" &&
        "requestMode" in runConfig.custom
          ? (runConfig.custom as { requestMode?: unknown }).requestMode
          : undefined;
      const trackInRunsTray =
        runConfig?.custom &&
        typeof runConfig.custom === "object" &&
        (runConfig.custom as { trackInRunsTray?: unknown }).trackInRunsTray ===
          true;
      const queuedMessageId = (() => {
        const raw =
          runConfig?.custom && typeof runConfig.custom === "object"
            ? (runConfig.custom as { agentNativeQueuedMessageId?: unknown })
                .agentNativeQueuedMessageId
            : undefined;
        return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
      })();
      // Human-in-the-loop approval keys (opt-in `needsApproval` actions). When
      // the user approves a paused tool call, the turn is re-issued with the
      // approval key so the server lets that specific call run.
      const approvedToolCalls = (() => {
        const raw =
          runConfig?.custom &&
          typeof runConfig.custom === "object" &&
          "approvedToolCalls" in runConfig.custom
            ? (runConfig.custom as { approvedToolCalls?: unknown })
                .approvedToolCalls
            : undefined;
        if (!Array.isArray(raw)) return undefined;
        const keys = raw.filter(
          (key): key is string => typeof key === "string" && key.length > 0,
        );
        return keys.length > 0 ? keys : undefined;
      })();
      const requestMode =
        runConfigRequestMode === "act" || runConfigRequestMode === "plan"
          ? runConfigRequestMode
          : execModeRef?.current === "plan"
            ? "plan"
            : execModeRef?.current === "build"
              ? "act"
              : undefined;
      // Queued turns carry the model/engine/effort they were composed with.
      // The refs track the live picker, so without this a queue that flushes
      // after the user switches models runs under the wrong one.
      const runConfigSelection = (
        key: "model" | "engine" | "effort" | "harness",
      ) => {
        const raw =
          runConfig?.custom && typeof runConfig.custom === "object"
            ? (runConfig.custom as Record<string, unknown>)[key]
            : undefined;
        return typeof raw === "string" && raw.length > 0 ? raw : undefined;
      };
      const model = runConfigSelection("model") ?? modelRef?.current;
      const engine = runConfigSelection("engine") ?? engineRef?.current;
      const effort =
        (runConfigSelection("effort") as ReasoningEffort | undefined) ??
        effortRef?.current;
      const harness = hostedHarnessRef?.current
        ? runConfigSelection("harness") ?? harnessRef?.current
        : undefined;
      const requestedTurnId = (() => {
        const raw =
          runConfig?.custom && typeof runConfig.custom === "object"
            ? (runConfig.custom as { turnId?: unknown }).turnId
            : undefined;
        return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
      })();
      const turnId = requestedTurnId ?? generateTurnId();

      const withRequestModeMetadata = (
        result: ChatModelRunResult,
      ): ChatModelRunResult => {
        const metadata = (result.metadata ?? {}) as Record<string, unknown>;
        const custom =
          metadata.custom && typeof metadata.custom === "object"
            ? (metadata.custom as Record<string, unknown>)
            : {};
        return {
          ...result,
          metadata: {
            ...metadata,
            custom: {
              ...custom,
              turnId,
              ...(requestMode ? { requestMode } : {}),
            },
          },
        };
      };

      // Extract attachments (images as base64, text as content).
      // assistant-ui puts user attachments on msg.attachments (not on content);
      // each attachment carries its own content parts from the adapter.
      const attachments = lastUserMsg
        ? extractAttachmentsFromMessage(lastUserMsg as any)
        : [];
      const userMessageText =
        rawMessageText.trim() || attachments.length === 0
          ? rawMessageText
          : "Use the attached context.";

      const priorMessages = limitPriorMessagesForRequest(
        messages.slice(0, latestUserIndex >= 0 ? latestUserIndex : -1) as any,
      ); // exclude latest user/recovery message and cap resend size
      const history = priorMessages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content:
            m.role === "user"
              ? messageTextForHistory(m as any)
              : messageTextFromContent(m.content),
        }))
        .filter((m) => m.content.trim());
      const structuredHistory =
        assistantUiMessagesToStructuredHistory(priorMessages);

      // Signal that generation is starting
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("agentNative.chatRunning", {
            detail: { isRunning: true, tabId },
          }),
        );
      }

      const content: ContentPart[] = [];
      const toolCallCounter = { value: 0 };
      if (threadId) setPendingTurn({ threadId, turnId });
      let runId: string | null = null;
      let lastSeq = -1;
      const ownsActiveRunState = () => {
        const activeRun = getActiveRun();
        return (
          !activeRun ||
          (!!threadId &&
            !!runId &&
            activeRun.threadId === threadId &&
            activeRun.runId === runId)
        );
      };
      // The adapter's own stream outranks AssistantChat's reconnect fallback:
      // when it attaches to a run, any reconnect reader folding the same run
      // must stop writing UI state or both folds render at once.
      const streamOwnershipToken = createRunStreamToken(`adapter:${turnId}`);
      const takeRunStreamOwnership = () => {
        if (threadId && runId) {
          preemptRunStream(threadId, runId, streamOwnershipToken);
        }
      };
      const settleTerminalChatRun = () => {
        if (threadId && runId) {
          releaseRunStream(threadId, runId, streamOwnershipToken);
        }
        if (!ownsActiveRunState()) return;
        if (threadId && runId) {
          clearActiveRunIfMatches(threadId, runId);
        } else {
          clearActiveRun();
        }
        if (typeof window === "undefined") return;
        dispatchTerminalChatUiCleanup(tabId);
        window.dispatchEvent(
          new CustomEvent("agentNative.chatRunning", {
            detail: { isRunning: false, tabId },
          }),
        );
      };
      const seenRunSeqs = new Map<string, number>();
      const preparingActionStatesByRun = new Map<
        string,
        PreparingActionState
      >();
      let currentRunDispatchMode: string | null = null;
      let currentMessageText = normalizeMentions(
        recoveryMessageText.trim() || userMessageText,
      );
      let currentHistory: AdapterHistoryMessage[] = history;
      let currentStructuredHistory: AgentChatStructuredMessage[] =
        structuredHistory;
      let includeAttachments = attachments.length > 0;
      let includeReferences = Boolean(runConfig?.custom?.references);
      let internalContinuationRequest = latestUserIsRecovery;
      let startupRecoveryAttempts = 0;
      let queuedConflictRetries = 0;
      let totalTransientContinuationAttempts = 0;
      // Work-boundary continuations (`loop_limit`), counted apart from the
      // transient ones — see MAX_LOOP_LIMIT_CONTINUATIONS.
      let loopLimitContinuations = 0;
      // Consecutive continuations whose advance signature matched the previous
      // round's (or was empty). Reset by any real advance.
      let nonAdvancingContinuations = 0;
      let lastAdvanceSignature: string | null = null;
      // Set at the moment we give up, so the user-facing message can name what
      // the turn was stuck on without a counter per shape of stuck.
      let recoveryStall: ContinuationAdvance["stall"] | null = null;
      // Content already accounted for by a previous advance check. Tracked
      // separately from `visibleContinuationPrefix`, which deliberately does
      // NOT advance on a `loop_limit` boundary so that round's output stays in
      // continuation history; the advance check needs the per-round delta for
      // every reason code, `loop_limit` included.
      let advanceCheckPrefix: ContentPart[] = [];
      // Set when the turn is stopped by a whole-turn continuation ceiling
      // (MAX_TOTAL_TRANSIENT_CONTINUATIONS or MAX_LOOP_LIMIT_CONTINUATIONS)
      // rather than by a dropped connection. Either can trip on a turn that was
      // making real progress the entire time, so it needs its own honest
      // message instead of falling through to the generic "connection kept
      // failing" copy below.
      let recoveryGaveUpOnContinuationBudget = false;
      const continuationHistoryFragments: string[] = [];
      const structuredContinuationFragments: AgentChatStructuredMessage[] = [];
      let visibleContinuationPrefix: ContentPart[] = [];
      let lastAutoContinueReason: string | null = null;
      let lastRecoverableRunError: AgentAutoContinueErrorInfo | null = null;
      let lastActivityTrail: AgentActivityTrailEntry[] = [];
      let backgroundFollowNoProgressDetaches = 0;
      let backgroundFollowConsecutiveNoProgressDetaches = 0;
      let backgroundFollowLastDetachReason: string | null = null;
      let backgroundFollowLastDetachWasClientWatchdog: boolean | null = null;
      let backgroundFollowLastServerProgressAt: number | null = null;
      const attemptedRunIds: string[] = [];
      let authRecoveryAttempted = false;
      let continuationToolCallCounter = 0;
      const nextContinuationToolCallId = () =>
        `continuation_tc_${++continuationToolCallCounter}`;

      const runDebugContextDetails = (): string => {
        const pageOrigin =
          typeof window !== "undefined" && window.location?.origin
            ? window.location.origin
            : "";
        return [
          `api_url: ${apiUrl}`,
          pageOrigin ? `page_origin: ${pageOrigin}` : "",
          tabId ? `tab_id: ${tabId}` : "",
          threadId ? `thread_id: ${threadId}` : "",
          `turn_id: ${turnId}`,
          runId ? `current_run: ${runId}` : "",
          attemptedRunIds.length > 0
            ? `attempted_runs: ${attemptedRunIds.join(", ")}`
            : "",
          runtimeDebugDetails,
        ]
          .filter(Boolean)
          .join("\n");
      };

      const connectionRecoveryDetails = (): string => {
        return [
          runDebugContextDetails(),
          lastAutoContinueReason
            ? `last_auto_continue_reason: ${lastAutoContinueReason}`
            : "",
          lastRecoverableRunError?.errorCode
            ? `last_recoverable_error_code: ${lastRecoverableRunError.errorCode}`
            : "",
          lastRecoverableRunError?.message
            ? `last_recoverable_error: ${lastRecoverableRunError.message}`
            : "",
          `non_advancing_continuations: ${nonAdvancingContinuations}`,
          recoveryStall ? `stalled_on: ${recoveryStall.kind}` : "",
          recoveryStall?.toolName
            ? `stalled_on_tool: ${recoveryStall.toolName}`
            : "",
          formatActivityTrail(lastActivityTrail)
            ? `activity_trail: ${formatActivityTrail(lastActivityTrail)}`
            : "",
          `total_transient_continuations: ${totalTransientContinuationAttempts}`,
          `loop_limit_continuations: ${loopLimitContinuations}`,
          `background_follow_no_progress_detaches: ${backgroundFollowNoProgressDetaches}`,
          `background_follow_consecutive_no_progress_detaches: ${backgroundFollowConsecutiveNoProgressDetaches}`,
          backgroundFollowLastDetachReason
            ? `background_follow_last_detach_reason: ${backgroundFollowLastDetachReason}`
            : "",
          backgroundFollowLastDetachWasClientWatchdog !== null
            ? `background_follow_last_detach_source: ${
                backgroundFollowLastDetachWasClientWatchdog
                  ? "client_watchdog"
                  : "server"
              }`
            : "",
          backgroundFollowLastServerProgressAt !== null
            ? `background_follow_last_server_progress_at: ${backgroundFollowLastServerProgressAt}`
            : "",
        ]
          .filter(Boolean)
          .join("\n");
      };

      const exhaustedRecoveryMessage = (reason?: string): string => {
        if (recoveryStall?.kind === "in-flight") {
          return "The agent got stuck waiting for the same tool to finish, so I stopped the automatic retries. The tool did not report a completed result.";
        }
        if (recoveryStall?.kind === "repeat") {
          return "The agent got stuck repeating the same response without finishing, so I stopped the automatic retries. This often happens when it tries to re-type a large pasted file into one action — starting a new chat, or asking for a smaller first step, usually gets it unstuck.";
        }
        if (recoveryStall?.kind === "preparing") {
          const tool = recoveryStall.toolName
            ? ` the ${humanizeActionName(recoveryStall.toolName)} action`
            : " the same action";
          return `The agent got stuck preparing${tool} input and never started the tool, so I stopped the automatic retries. Try a smaller first step or a more compact version of the request.`;
        }
        if (recoveryGaveUpOnContinuationBudget) {
          return "This turn reached the limit on how many times it can be automatically continued, so I stopped it here. It may have still been making progress — retry as a single, narrower request so it can finish within fewer continuations.";
        }
        if (
          content.length === 0 &&
          (reason === "run_timeout" ||
            reason === "no_progress" ||
            reason === "stream_ended")
        ) {
          return "The agent request started but did not produce any visible progress before timing out. I stopped the automatic retries so this chat would not stay stuck on Thinking.";
        }
        if (recoveryStall?.kind === "empty") {
          return "The agent stopped producing new output across several automatic retries, so I stopped it here rather than leaving the chat stuck on Thinking.";
        }
        return "The agent connection kept failing after several automatic recovery attempts.";
      };

      const dispatchAuthError = (
        reason: "auth-required" | "session-expired",
      ) => {
        if (typeof window === "undefined") return;
        window.dispatchEvent(
          new CustomEvent("agent-chat:auth-error", {
            detail: {
              reason,
              ...(tabId ? { tabId } : {}),
              ...(threadId ? { threadId } : {}),
            },
          }),
        );
      };

      const dispatchMissingApiKey = () => {
        if (typeof window === "undefined") return;
        window.dispatchEvent(
          new CustomEvent("agent-chat:missing-api-key", {
            detail: {
              ...(tabId ? { tabId } : {}),
              ...(threadId ? { threadId } : {}),
            },
          }),
        );
      };

      const tryRecoverAuthOnce = async (): Promise<boolean> => {
        if (authRecoveryAttempted || abortSignal.aborted) return false;
        authRecoveryAttempted = true;
        try {
          const sessionRes = await fetch(
            safeAgentNativePath("/_agent-native/auth/session"),
            {
              method: "GET",
              headers: { Accept: "application/json" },
              cache: "no-store",
              credentials: "same-origin",
              signal: abortSignal,
            },
          );
          if (!sessionRes.ok) return false;
          const session = await sessionRes.json().catch(() => null);
          return Boolean(session && !session.error);
        } catch {
          return false;
        }
      };

      const updateCurrentRunDispatchMode = (value: unknown) => {
        if (typeof value !== "string") return;
        const mode = value.trim();
        if (mode) currentRunDispatchMode = mode;
      };

      // Mode switch for recovery ownership: durable/background-dispatched runs
      // are always recovered by the server. Foreground self-chain follows the
      // server on healthy handoffs. A loud continuation-dispatch failure falls
      // back to the client POST path in either mode because the server has
      // already marked the unclaimed successor terminal; the per-turn tool
      // journal keeps that retry from replaying completed side effects.
      const isDurableBackgroundDispatch = () =>
        currentRunDispatchMode?.startsWith("background") === true;
      const isForegroundSelfChainDispatch = () =>
        currentRunDispatchMode === "foreground-self-chain";
      const shouldFollowServerContinuation = (
        signal?: AgentAutoContinueSignal,
      ) => {
        if (
          signal?.errorInfo?.errorCode ===
          "background_continuation_dispatch_failed"
        ) {
          return false;
        }
        if (isDurableBackgroundDispatch()) return true;
        if (!isForegroundSelfChainDispatch()) return false;
        return true;
      };

      const rememberRunSeq = (seq: number) => {
        lastSeq = seq;
        if (runId) {
          seenRunSeqs.set(runId, seq);
        }
      };

      const reconnectCursorForRun = (
        nextRunId: string,
        previousRunId: string | null,
      ) => {
        if (previousRunId !== nextRunId) {
          lastAutoContinueReason = null;
          lastRecoverableRunError = null;
          lastActivityTrail = [];
        }
        const rememberedSeq = seenRunSeqs.get(nextRunId);
        if (rememberedSeq !== undefined) {
          lastSeq = rememberedSeq;
          return;
        }
        if (previousRunId !== nextRunId) {
          lastSeq = -1;
        }
      };

      const canAttachRun = (candidateRunId: string, candidateTurnId: string) =>
        attemptedRunIds.includes(candidateRunId) ||
        (candidateTurnId.length > 0 && candidateTurnId === turnId);

      const preparingActionStateForRun = (
        id: string | null,
      ): PreparingActionState | undefined => {
        if (!id) return undefined;
        const existing = preparingActionStatesByRun.get(id);
        if (existing) return existing;
        const state: PreparingActionState = {};
        preparingActionStatesByRun.set(id, state);
        return state;
      };

      const currentSSEOptions = (
        overrides: Pick<
          SSEStreamOptions,
          "noProgressTimeoutMs" | "actionPreparationStallTimeoutMs"
        > = {},
      ): SSEStreamOptions => ({
        markTerminalResults: true,
        durableBackgroundRun:
          currentRunDispatchMode?.startsWith("background") === true,
        ...(runId
          ? { preparingActionState: preparingActionStateForRun(runId) }
          : {}),
        ...overrides,
      });

      const captureChatClientError = (
        error: unknown,
        phase: string,
        extra: Record<string, unknown> = {},
      ) => {
        captureError(error, {
          tags: {
            source: "agent-chat-client",
            phase,
            hasThread: threadId ? "true" : "false",
            hasRun: runId ? "true" : "false",
            lastAutoContinueReason: lastAutoContinueReason ?? undefined,
          },
          extra: {
            apiUrl,
            tabId,
            threadId,
            runId,
            lastSeq,
            contentParts: content.length,
            attemptedRunIds: [...attemptedRunIds],
            activityTrail: [...lastActivityTrail],
            startupRecoveryAttempts,
            nonAdvancingContinuations,
            stalledOn: recoveryStall?.kind,
            stalledOnTool: recoveryStall?.toolName,
            totalTransientContinuationAttempts,
            ...extra,
          },
          contexts: {
            agentChat: {
              tabId,
              threadId,
              runId,
              lastSeq,
              contentParts: content.length,
              startupRecoveryAttempts,
              nonAdvancingContinuations,
              stalledOn: recoveryStall?.kind,
              stalledOnTool: recoveryStall?.toolName,
              totalTransientContinuationAttempts,
            },
          },
        });
      };

      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        try {
          const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
          if (tz) headers["x-user-timezone"] = tz;
        } catch {
          // Non-browser or Intl unavailable — tool calls will fall back to UTC.
        }
        try {
          // Lets the run's `$ai_*` events carry PostHog's `$session_id`, so an
          // agent trace joins to the session replay it happened in.
          const sessionId = getOrCreateAnalyticsSessionId();
          if (sessionId) headers["x-agent-native-session-id"] = sessionId;
          // coercion-ok: replay linkage must not block sending the message
        } catch {
          // Analytics session unavailable — traces just lose replay linkage.
        }
        // Surface hint — the server uses this to keep code-editing dev tools
        // out of the app-rendered sidebar. The outer dev frame passes
        // "dev-frame" explicitly; the reusable in-product chat defaults to
        // "app" even when it is running in Desktop or inside a preview iframe.
        headers["x-agent-native-surface"] = surface;
        if (harness) headers["x-agent-native-hosted-harness"] = "1";

        const reconnectCurrentRun = async function* (): AsyncGenerator<
          ChatModelRunResult,
          boolean,
          unknown
        > {
          if (!runId) return false;
          let lastReconnectError: unknown = null;
          let reconnectErrorCaptured = false;
          for (let attempt = 0; attempt < MAX_RECONNECT_ATTEMPTS; attempt++) {
            try {
              const reconnectRes = await fetch(
                `${apiUrl}/runs/${encodeURIComponent(runId)}/events?after=${lastSeq + 1}`,
                { signal: abortSignal },
              );
              if (!reconnectRes.ok || !reconnectRes.body) {
                if (reconnectRes.status === 404) {
                  clearActiveRun();
                  return false;
                }
                lastReconnectError = new Error(
                  `Reconnect failed: ${reconnectRes.status}`,
                );
                if (shouldCaptureRecoveryHttpStatus(reconnectRes.status)) {
                  captureChatClientError(
                    lastReconnectError,
                    "reconnect-current-response",
                    {
                      status: reconnectRes.status,
                      hasBody: Boolean(reconnectRes.body),
                      attempt,
                    },
                  );
                }
                reconnectErrorCaptured = true;
                break;
              }
              updateCurrentRunDispatchMode(
                reconnectRes.headers.get("X-Dispatch-Mode"),
              );

              takeRunStreamOwnership();
              for await (const result of readSSEStream(
                reconnectRes.body,
                content,
                toolCallCounter,
                tabId,
                (seq, isProgress) => {
                  rememberRunSeq(seq);
                  if (threadId && runId) {
                    updateActiveRunSeq(threadId, runId, seq, isProgress);
                  }
                },
                runId,
                currentSSEOptions(),
              )) {
                const nextResult = withRequestModeMetadata(result);
                if (isTerminalChatModelRunResult(nextResult)) {
                  settleTerminalChatRun();
                }
                yield nextResult;
              }
              if (ownsActiveRunState()) {
                clearActiveRun();
              }
              return true;
            } catch (reconnectErr: unknown) {
              if (
                reconnectErr instanceof Error &&
                reconnectErr.name === "AbortError"
              ) {
                clearActiveRun();
                return true;
              }
              if (reconnectErr instanceof AgentAutoContinueSignal) {
                return false;
              }
              lastReconnectError = reconnectErr;
              await retryDelay(attempt, abortSignal);
            }
          }
          if (lastReconnectError && !reconnectErrorCaptured) {
            captureChatClientError(
              lastReconnectError,
              "reconnect-current-failed",
            );
          }
          return false;
        };

        const reconnectActiveRunForThread = async function* (options?: {
          requireCurrentTurn?: boolean;
        }): AsyncGenerator<ChatModelRunResult, boolean, unknown> {
          if (!threadId) return false;
          let lastActiveRunError: unknown = null;
          for (let attempt = 0; attempt < MAX_RECONNECT_ATTEMPTS; attempt++) {
            try {
              const activeRes = await fetch(
                `${apiUrl}/runs/active?threadId=${encodeURIComponent(threadId)}`,
                { signal: abortSignal },
              );
              if (!activeRes.ok) {
                if (activeRes.status === 404) {
                  return false;
                }
                lastActiveRunError = new Error(
                  `Active run lookup failed: ${activeRes.status}`,
                );
                if (shouldCaptureRecoveryHttpStatus(activeRes.status)) {
                  captureChatClientError(
                    lastActiveRunError,
                    "reconnect-active-response",
                    { status: activeRes.status, attempt },
                  );
                }
                return false;
              }
              const active = await activeRes.json();
              if (active?.active && active.runId) {
                const activeRunId = String(active.runId);
                const activeTurnId =
                  typeof active.turnId === "string" ? active.turnId : "";
                if (options?.requireCurrentTurn && activeTurnId !== turnId) {
                  return false;
                }
                if (!canAttachRun(activeRunId, activeTurnId)) {
                  return false;
                }
                updateCurrentRunDispatchMode(active.dispatchMode);
                const previousRunId = runId;
                runId = activeRunId;
                if (!attemptedRunIds.includes(activeRunId)) {
                  attemptedRunIds.push(activeRunId);
                }
                reconnectCursorForRun(activeRunId, previousRunId);
                setActiveRun({
                  threadId,
                  runId: activeRunId,
                  turnId,
                  lastSeq,
                });
                const reconnected = yield* reconnectCurrentRun();
                if (reconnected) return true;
              }
              return false;
            } catch (activeErr: unknown) {
              if (
                activeErr instanceof Error &&
                activeErr.name === "AbortError"
              ) {
                clearActiveRun();
                return true;
              }
              lastActiveRunError = activeErr;
              await retryDelay(attempt, abortSignal);
            }
          }
          if (lastActiveRunError) {
            captureChatClientError(
              lastActiveRunError,
              "reconnect-active-failed",
            );
          }
          return false;
        };

        const reconnectBackgroundContinuationForRunTimeout =
          async function* (): AsyncGenerator<
            ChatModelRunResult,
            boolean,
            unknown
          > {
            if (!threadId || !runId) return false;
            const interruptedRunId = runId;
            const interruptedLastSeq = lastSeq;
            let lastActiveRunError: unknown = null;
            for (let attempt = 0; attempt < 3; attempt++) {
              if (attempt > 0) {
                await delay(500, abortSignal);
              }
              if (abortSignal.aborted) return true;
              try {
                const activeRes = await fetch(
                  `${apiUrl}/runs/active?threadId=${encodeURIComponent(threadId)}`,
                  { signal: abortSignal },
                );
                if (!activeRes.ok) {
                  if (activeRes.status === 404) return false;
                  lastActiveRunError = new Error(
                    `Active run lookup failed: ${activeRes.status}`,
                  );
                  continue;
                }
                const active = await activeRes.json();
                if (!active?.active || !active.runId) return false;
                const activeRunId = String(active.runId);
                const dispatchMode =
                  typeof active.dispatchMode === "string"
                    ? active.dispatchMode
                    : "";
                const activeTurnId =
                  typeof active.turnId === "string" ? active.turnId : "";
                if (!canAttachRun(activeRunId, activeTurnId)) return false;
                updateCurrentRunDispatchMode(dispatchMode);
                if (activeRunId === interruptedRunId) {
                  if (dispatchMode.startsWith("background")) continue;
                  return false;
                }
                const activeStatus =
                  typeof active.status === "string" ? active.status : "";
                if (!dispatchMode.startsWith("background")) return false;
                if (activeStatus !== "running" && activeStatus !== "starting") {
                  return false;
                }
                const previousRunId = runId;
                runId = activeRunId;
                if (!attemptedRunIds.includes(activeRunId)) {
                  attemptedRunIds.push(activeRunId);
                }
                reconnectCursorForRun(activeRunId, previousRunId);
                setActiveRun({
                  threadId,
                  runId: activeRunId,
                  turnId,
                  lastSeq,
                });
                const reconnected = yield* reconnectCurrentRun();
                if (reconnected) return true;
              } catch (activeErr: unknown) {
                if (
                  activeErr instanceof Error &&
                  activeErr.name === "AbortError"
                ) {
                  clearActiveRun();
                  return true;
                }
                lastActiveRunError = activeErr;
              }
            }
            if (lastActiveRunError) {
              captureChatClientError(
                lastActiveRunError,
                "reconnect-background-continuation-failed",
              );
            }
            runId = interruptedRunId;
            lastSeq = interruptedLastSeq;
            return false;
          };

        // ── Background follow mode (see module comment on the constants) ──
        // Emits a terminal chat error using the same runError/content/yield
        // shape as the exhausted-recovery paths, so background failures render
        // identically to foreground ones.
        const emitBackgroundTerminalError = function* (args: {
          message: string;
          errorCode: string;
          details?: string;
        }): Generator<ChatModelRunResult, void, unknown> {
          const runError = {
            message: args.message,
            details: [args.details, connectionRecoveryDetails()]
              .filter(Boolean)
              .join("\n\n"),
            errorCode: args.errorCode,
            recoverable: true,
            ...(runId ? { runId } : {}),
          };
          if (typeof window !== "undefined") {
            if (args.errorCode === LLM_MISSING_CREDENTIALS_ERROR_CODE) {
              dispatchMissingApiKey();
            }
            window.dispatchEvent(
              new CustomEvent("agent-chat:run-error", {
                detail: { ...runError, tabId },
              }),
            );
          }
          settleInterruptedToolCalls(content, undefined, {
            includeActivity: true,
          });
          content.push({
            type: "text",
            text: formatChatErrorText(args.message, undefined, args.errorCode),
          });
          settleTerminalChatRun();
          yield {
            content: [...content],
            status: { type: "incomplete" as const, reason: "error" as const },
            metadata: { custom: { ...(runId ? { runId } : {}), runError } },
          } as ChatModelRunResult;
          clearActiveRun();
        };

        // Final outcome for a background turn the follow loop can no longer
        // follow: either the run went terminal server-side (surface its
        // error, mapping terminal_reason to clear copy) or it vanished
        // (finalize with received content when it completed, loud error
        // otherwise — never a silent stop).
        const emitBackgroundTerminalOutcome = function* (
          lastKnown: Record<string, unknown> | null,
        ): Generator<ChatModelRunResult, void, unknown> {
          const status =
            typeof lastKnown?.status === "string" ? lastKnown.status : "";
          const rawTerminalReason =
            typeof lastKnown?.terminalReason === "string"
              ? lastKnown.terminalReason
              : "";
          if (isUserInitiatedTerminalReason(rawTerminalReason)) {
            settleInterruptedToolCalls(content, undefined, {
              includeActivity: true,
            });
            settleTerminalChatRun();
            yield {
              content: [...content],
              status: {
                type: "complete" as const,
                reason: "stop" as const,
              },
              metadata: {
                custom: {
                  ...(runId ? { runId } : {}),
                  userStopped: true,
                },
              },
            } as ChatModelRunResult;
            clearActiveRun();
            return;
          }
          // terminal_reason is either a bare reason ("dispatch_payload_missing")
          // or "error:<errorCode>" when derived from a terminal error event.
          const hasErrorTerminalReason = rawTerminalReason.startsWith("error:");
          const terminalReason = rawTerminalReason.replace(/^error:/, "");
          const mappedMessage = terminalReason
            ? BACKGROUND_TERMINAL_REASON_MESSAGES[terminalReason]
            : undefined;
          const mappedErrorCode =
            terminalReason === "missing_api_key" ||
            terminalReason === LLM_MISSING_CREDENTIALS_ERROR_CODE
              ? LLM_MISSING_CREDENTIALS_ERROR_CODE
              : terminalReason;

          if (mappedMessage) {
            yield* emitBackgroundTerminalError({
              message: mappedMessage,
              errorCode: mappedErrorCode,
              details: `terminal_reason: ${rawTerminalReason}`,
            });
            return;
          }

          if (hasErrorTerminalReason) {
            if (lastRecoverableRunError) {
              yield* emitBackgroundTerminalError({
                message: lastRecoverableRunError.message,
                errorCode:
                  lastRecoverableRunError.errorCode ||
                  mappedErrorCode ||
                  "background_run_failed",
                details: lastRecoverableRunError.details,
              });
              return;
            }
            yield* emitBackgroundTerminalError({
              message:
                "The agent's background run failed before its final response could be recovered. You can retry from the preserved chat context.",
              errorCode: mappedErrorCode || "background_run_failed",
              details: `terminal_reason: ${rawTerminalReason}`,
            });
            return;
          }

          if (status === "completed") {
            // The turn finished server-side; the events we managed to fold are
            // the durable transcript. Never turn a terminal tool-only chunk
            // into a blank successful message when no explicit `done` event
            // passed through the normal SSE finalizer.
            settleInterruptedToolCalls(content, undefined, {
              includeActivity: true,
            });
            const runWarning = appendMissingFinalResponseWarning(content);
            settleTerminalChatRun();
            yield {
              content: [...content],
              status: { type: "complete" as const, reason: "stop" as const },
              metadata: {
                custom: {
                  ...(runId ? { runId } : {}),
                  ...(runWarning ? { runWarning } : {}),
                },
              },
            } as ChatModelRunResult;
            clearActiveRun();
            return;
          }

          if (lastRecoverableRunError) {
            // A replayed terminal error event already carried the real
            // message (recoverable errors replay as auto-continue signals
            // whose errorInfo we captured while following).
            yield* emitBackgroundTerminalError({
              message: lastRecoverableRunError.message,
              errorCode:
                lastRecoverableRunError.errorCode ?? "connection_error",
              details: lastRecoverableRunError.details,
            });
            return;
          }
          yield* emitBackgroundTerminalError({
            message:
              "The agent's background run stopped before finishing and no continuation appeared. You can retry from the preserved chat context.",
            errorCode: terminalReason || "background_run_lost",
            details: rawTerminalReason
              ? `terminal_reason: ${rawTerminalReason}`
              : undefined,
          });
        };

        // One read-only attach to the current run's event stream. Unlike
        // reconnectCurrentRun this does NOT retry internally and lets the
        // follow loop see every auto-continue signal (with errorInfo intact),
        // because the loop — not this reader — decides what a detach means.
        // Return values: "completed" = terminal event consumed (turn over);
        // "aborted" = user abort; "detached" = we ATTACHED to a live stream
        // that ended/stalled without a terminal event (resets the follow
        // loop's idle window); "gone" = could not attach at all (404, HTTP
        // error, network failure — the idle window keeps accumulating so a
        // persistently unattachable run still terminates loudly).
        const followAttachOnce = async function* (): AsyncGenerator<
          ChatModelRunResult,
          "completed" | "client_continue" | "aborted" | "detached" | "gone",
          unknown
        > {
          if (!runId) return "gone";
          let attached = false;
          backgroundFollowLastDetachReason = null;
          backgroundFollowLastDetachWasClientWatchdog = null;
          try {
            const eventsRes = await fetch(
              `${apiUrl}/runs/${encodeURIComponent(runId)}/events?after=${lastSeq + 1}`,
              { signal: abortSignal },
            );
            if (!eventsRes.ok || !eventsRes.body) {
              return "gone";
            }
            attached = true;
            updateCurrentRunDispatchMode(
              eventsRes.headers.get("X-Dispatch-Mode"),
            );
            takeRunStreamOwnership();
            let missingFinalResponseResult: ChatModelRunResult | null = null;
            for await (const result of readSSEStream(
              eventsRes.body,
              content,
              toolCallCounter,
              tabId,
              (seq, isProgress) => {
                rememberRunSeq(seq);
                if (threadId && runId) {
                  updateActiveRunSeq(threadId, runId, seq, isProgress);
                }
              },
              runId,
              currentSSEOptions({
                noProgressTimeoutMs: BACKGROUND_FOLLOW_ATTACH_WATCHDOG_MS,
                actionPreparationStallTimeoutMs:
                  BACKGROUND_FOLLOW_ATTACH_WATCHDOG_MS,
              }),
            )) {
              const nextResult = withRequestModeMetadata(result);
              if (
                isDurableBackgroundDispatch() &&
                missingFinalResponseWarningFromResult(nextResult)
              ) {
                missingFinalResponseResult = nextResult;
                continue;
              }
              if (isTerminalChatModelRunResult(nextResult)) {
                settleTerminalChatRun();
              }
              yield nextResult;
            }
            if (missingFinalResponseResult) {
              const warning = missingFinalResponseWarningFromResult(
                missingFinalResponseResult,
              );
              const lastContentPart = content.at(-1);
              if (
                warning?.message &&
                lastContentPart?.type === "text" &&
                lastContentPart.text === warning.message
              ) {
                content.pop();
              }
              if (continueAfterMissingFinalResponse()) {
                await delay(250, abortSignal);
                return "client_continue";
              }
              settleTerminalChatRun();
              yield missingFinalResponseResult;
              clearActiveRun();
              return "completed";
            }
            // readSSEStream returned normally: a terminal done/error was
            // consumed and rendered — the turn is over.
            clearActiveRun();
            return "completed";
          } catch (attachErr: unknown) {
            if (attachErr instanceof Error && attachErr.name === "AbortError") {
              clearActiveRun();
              return "aborted";
            }
            if (attachErr instanceof AgentAutoContinueSignal) {
              lastAutoContinueReason = attachErr.reason;
              backgroundFollowLastDetachReason = attachErr.reason;
              backgroundFollowLastDetachWasClientWatchdog =
                attachErr.clientWatchdog;
              if (attachErr.activityTrail.length > 0) {
                lastActivityTrail = [...attachErr.activityTrail];
              }
              if (attachErr.errorInfo) {
                lastRecoverableRunError = attachErr.errorInfo;
              }
            }
            // A fetch that never yielded a response body counts as "gone" for
            // the idle window; a broken mid-stream read counts as attached.
            return attached ? "detached" : "gone";
          }
        };

        // The background follow loop. Entered instead of ANY synthetic
        // continuation POST when the current run is background-dispatched.
        // Keeps following as long as an active run for this turn exists — the
        // server keeps chaining until its own per-turn budget or a real
        // terminal error, so a successor that stalls again is simply
        // re-followed, not counted against any client budget. Only a
        // continuous BACKGROUND_FOLLOW_IDLE_TIMEOUT_MS with no active run
        // ends the turn from the client side.
        const followBackgroundTurn = async function* (
          initialSignal: AgentAutoContinueSignal,
        ): AsyncGenerator<
          ChatModelRunResult,
          "completed" | "client_continue",
          unknown
        > {
          lastAutoContinueReason = initialSignal.reason;
          if (initialSignal.activityTrail.length > 0) {
            lastActivityTrail = [...initialSignal.activityTrail];
          }
          if (initialSignal.errorInfo) {
            lastRecoverableRunError = initialSignal.errorInfo;
          }
          // Show "Resuming…" instead of a frozen Thinking label while waiting
          // for the server-chained successor chunk.
          const dispatchResumingUiEvent = () => {
            if (typeof window !== "undefined") {
              window.dispatchEvent(
                new CustomEvent("agent-chat:auto-continue", {
                  detail: { tabId },
                }),
              );
            }
          };
          dispatchResumingUiEvent();

          const durablyAbortBackgroundTurn = async (
            reason: string,
          ): Promise<boolean> => {
            if (!threadId) return false;
            for (let attempt = 0; attempt < 2; attempt++) {
              try {
                const response = await fetch(
                  `${apiUrl}/runs/turn/${encodeURIComponent(turnId)}/abort`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ threadId, reason }),
                    signal: abortSignal,
                  },
                );
                if (response.ok) return true;
              } catch {
                if (abortSignal.aborted) return false;
              }
            }
            return false;
          };

          const stopBackgroundTurnBeforeReporting = async function* (
            outcome: Parameters<typeof emitBackgroundTerminalError>[0],
          ): AsyncGenerator<ChatModelRunResult> {
            await durablyAbortBackgroundTurn(outcome.errorCode);
            yield* emitBackgroundTerminalError(outcome);
          };

          // Before surfacing a background terminal ERROR (never called for a
          // genuine "done" success — see call site), give the server's
          // reap-and-recover path a short extra window to insert a claimable
          // successor row for this turn. Returns as soon as `/runs/active`
          // reports a DIFFERENT runId than the stale one, so the caller can
          // hand back to the main loop and follow it seamlessly instead of
          // erroring out from under it.
          const awaitBackgroundErrorRecoverySuccessor = async (
            staleRunId: string,
          ): Promise<"successor" | "timeout" | "aborted"> => {
            for (
              let attempt = 0;
              attempt < BACKGROUND_TERMINAL_ERROR_GRACE_POLLS;
              attempt++
            ) {
              if (abortSignal.aborted) return "aborted";
              dispatchResumingUiEvent();
              await delay(BACKGROUND_FOLLOW_POLL_INTERVAL_MS, abortSignal);
              if (abortSignal.aborted) return "aborted";
              let recheck: Record<string, unknown> | null = null;
              try {
                const activeRes = await fetch(
                  `${apiUrl}/runs/active?threadId=${encodeURIComponent(threadId!)}`,
                  { signal: abortSignal },
                );
                if (activeRes.ok) {
                  recheck = await activeRes.json().catch(() => null);
                }
              } catch (pollErr: unknown) {
                if (pollErr instanceof Error && pollErr.name === "AbortError") {
                  return "aborted";
                }
                // Transient poll failure — this attempt counts as "no
                // successor yet", not a hard failure of the grace window.
              }
              const recheckRunId =
                recheck?.active === true && recheck.runId
                  ? String(recheck.runId)
                  : null;
              if (recheckRunId && recheckRunId !== staleRunId) {
                return "successor";
              }
            }
            return "timeout";
          };

          const followStartedAt = Date.now();
          const followedRunIds = new Set<string>();
          let repeatedTerminalReason: string | null = null;
          let repeatedTerminalReasonCount = 0;
          // Returns true once the SAME terminal reason has come back from
          // enough successive successors that produced no events at all.
          const noteRepeatedTerminalReason = (
            reason: string,
            producedEvents: boolean,
          ): boolean => {
            if (producedEvents || !reason) {
              repeatedTerminalReason = null;
              repeatedTerminalReasonCount = 0;
              return false;
            }
            if (reason === repeatedTerminalReason) {
              repeatedTerminalReasonCount += 1;
            } else {
              repeatedTerminalReason = reason;
              repeatedTerminalReasonCount = 1;
            }
            return (
              repeatedTerminalReasonCount >=
              MAX_REPEATED_BACKGROUND_TERMINAL_REASONS
            );
          };

          let idleSince: number | null = null;
          let lastSeenActive: Record<string, unknown> | null = null;
          let lastObservedActiveRunId = runId;
          let lastObservedServerProgressAt: number | null = null;
          let noProgressPollAttempts = 0;
          // Terminal runs already replayed once. A recoverable terminal error
          // event replays as an auto-continue signal (isAutoRecoverableError),
          // which used to re-drive a POST in foreground mode. In follow mode
          // the server owns recovery, so a SECOND visit to the same terminal
          // run means the turn is over — surface the outcome instead of
          // re-replaying it every poll for the whole reconnect window. (A
          // CONTINUATION-class terminal_reason is the one exception: see the
          // isContinuationChunkBoundary check below, which keeps polling
          // instead of surfacing anything.)
          const replayedTerminalRunIds = new Set<string>();

          while (true) {
            if (abortSignal.aborted) {
              clearActiveRun();
              return "completed";
            }
            if (
              Date.now() - followStartedAt >=
              MAX_BACKGROUND_FOLLOW_WALL_TIME_MS
            ) {
              yield* stopBackgroundTurnBeforeReporting({
                // Says only what this backstop actually knows. It fires on a
                // clock, so it cannot tell a looping turn from one that was
                // still working — the old copy asserted "kept restarting
                // without finishing", which prod runs contradicted: they were
                // streaming tokens right up to the abort.
                message: `This turn ran for ${Math.round(MAX_BACKGROUND_FOLLOW_WALL_TIME_MS / 60_000)} minutes without finishing, so it was stopped. Your chat context is preserved — retrying, or splitting this into smaller requests, usually gets through.`,
                errorCode: "background_follow_time_budget_exhausted",
                details: `followed_runs: ${followedRunIds.size}`,
              });
              return "completed";
            }
            let active: Record<string, unknown> | null = null;
            // "The poll failed" and "the server reports no active run" are
            // different facts. Only the second one is evidence the run is
            // gone; coercing the first into the second lets a flaky network
            // tick drive a durable abort of a run that is still working.
            let activeUnreadable = false;
            try {
              const activeRes = await fetch(
                `${apiUrl}/runs/active?threadId=${encodeURIComponent(threadId!)}`,
                { signal: abortSignal },
              );
              if (activeRes.ok) {
                active = await activeRes.json().catch(() => {
                  activeUnreadable = true;
                  return null;
                });
              } else {
                // A 5xx/404 from this route is the route failing, not the run
                // ending.
                activeUnreadable = true;
              }
            } catch (pollErr: unknown) {
              if (pollErr instanceof Error && pollErr.name === "AbortError") {
                clearActiveRun();
                return "completed";
              }
              activeUnreadable = true;
            }
            if (activeUnreadable) {
              // Unreadable: learn nothing, decide nothing, wait and re-ask.
              await delay(BACKGROUND_FOLLOW_POLL_INTERVAL_MS, abortSignal);
              if (abortSignal.aborted) {
                clearActiveRun();
                return "completed";
              }
              continue;
            }

            const activeRunId =
              active?.active === true && active.runId
                ? String(active.runId)
                : null;
            const activeTurnId =
              typeof active?.turnId === "string" ? active.turnId : "";
            const activeStatus =
              typeof active?.status === "string" ? active.status : "";
            // Only follow runs belonging to THIS turn (server-chained
            // successors reuse the turnId) or runs we already attached to.
            const isOurRun =
              activeRunId !== null && canAttachRun(activeRunId, activeTurnId);

            if (activeRunId && isOurRun) {
              lastSeenActive = active;
              updateCurrentRunDispatchMode(active?.dispatchMode);
              const activeTerminalReason =
                typeof active?.terminalReason === "string"
                  ? active.terminalReason
                  : "";
              if (isUserInitiatedTerminalReason(activeTerminalReason)) {
                yield* emitBackgroundTerminalOutcome(active);
                return "completed";
              }
              const isTerminal =
                activeStatus === "completed" || activeStatus === "errored";
              if (isTerminal && replayedTerminalRunIds.has(activeRunId)) {
                if (
                  lastAutoContinueReason === "stale_run" &&
                  lastRecoverableRunError?.errorCode === "stale_run"
                ) {
                  const continuation = prepareAutoContinuation(
                    new AgentAutoContinueSignal({
                      reason: "stale_run",
                      errorInfo: lastRecoverableRunError,
                      activityTrail: lastActivityTrail,
                    }),
                  );
                  if (continuation.ok) {
                    dispatchResumingUiEvent();
                    await delay(250, abortSignal);
                    return "client_continue";
                  }
                }
                const rawTerminalReason =
                  typeof active?.terminalReason === "string"
                    ? active.terminalReason
                    : "";
                const bareTerminalReason = rawTerminalReason.replace(
                  /^error:/,
                  "",
                );
                // A re-observed "completed" row with a CONTINUATION-class
                // reason (run_timeout/no_progress/loop_limit/…) is a MID-TURN
                // chunk boundary, not the end of the turn — a warm instance
                // can keep serving this stale row for a beat before the
                // pre-inserted successor becomes visible. Emitting a terminal
                // outcome here is exactly the bug this branch exists to
                // avoid: it would flip the message to "done" while the
                // successor's content is still coming. Keep polling on the
                // shared idle budget instead; a truly stuck handoff still
                // fails loud (never a silent stop) once it expires.
                const isContinuationChunkBoundary =
                  activeStatus === "completed" &&
                  !rawTerminalReason.startsWith("error:") &&
                  !BACKGROUND_TERMINAL_REASON_MESSAGES[bareTerminalReason] &&
                  BACKGROUND_CONTINUATION_TERMINAL_REASONS.has(
                    bareTerminalReason,
                  );
                if (isContinuationChunkBoundary) {
                  if (idleSince === null) idleSince = Date.now();
                  if (
                    Date.now() - idleSince >=
                    BACKGROUND_FOLLOW_IDLE_TIMEOUT_MS
                  ) {
                    yield* stopBackgroundTurnBeforeReporting({
                      message:
                        "The agent's background run stopped between chunks and no continuation appeared. You can retry from the preserved chat context.",
                      errorCode: "background_run_lost",
                      details: `terminal_reason: ${rawTerminalReason}`,
                    });
                    return "completed";
                  }
                  dispatchResumingUiEvent();
                  await delay(BACKGROUND_FOLLOW_POLL_INTERVAL_MS, abortSignal);
                  continue;
                }
                if (isBackgroundTerminalErrorOutcome(active)) {
                  const graceOutcome =
                    await awaitBackgroundErrorRecoverySuccessor(activeRunId);
                  if (graceOutcome === "aborted") {
                    clearActiveRun();
                    return "completed";
                  }
                  if (graceOutcome === "successor") {
                    // A successor claimed the turn while we waited — hand
                    // back to the top of the loop so it attaches and follows
                    // it exactly like any other newly-discovered run instead
                    // of duplicating that bookkeeping here.
                    continue;
                  }
                }
                if (
                  hasMissingFinalResponseAfterTool(content) &&
                  continueAfterMissingFinalResponse()
                ) {
                  await delay(250, abortSignal);
                  return "client_continue";
                }
                yield* emitBackgroundTerminalOutcome(active);
                return "completed";
              }
              followedRunIds.add(activeRunId);
              if (followedRunIds.size > MAX_FOLLOWED_BACKGROUND_RUNS) {
                yield* stopBackgroundTurnBeforeReporting({
                  message: `The agent restarted this step ${followedRunIds.size} times without finishing it. It was stopped so you can retry from the preserved chat context — a smaller request usually gets through.`,
                  errorCode: "background_follow_run_budget_exhausted",
                  details: `followed_runs: ${followedRunIds.size}`,
                });
                return "completed";
              }
              const previousRunId = runId;
              runId = activeRunId;
              if (!attemptedRunIds.includes(activeRunId)) {
                attemptedRunIds.push(activeRunId);
              }
              reconnectCursorForRun(activeRunId, previousRunId);
              if (threadId) {
                setActiveRun({
                  threadId,
                  runId: activeRunId,
                  turnId,
                  lastSeq,
                });
              }
              const seqBeforeAttach = lastSeq;
              const attach = yield* followAttachOnce();
              if (attach === "client_continue") {
                return "client_continue";
              }
              if (attach === "completed" || attach === "aborted") {
                return "completed";
              }
              if (isTerminal) {
                replayedTerminalRunIds.add(activeRunId);
              }
              const observedTerminalReason =
                typeof active?.terminalReason === "string"
                  ? active.terminalReason
                  : "";
              if (
                noteRepeatedTerminalReason(
                  observedTerminalReason,
                  lastSeq > seqBeforeAttach,
                )
              ) {
                yield* stopBackgroundTurnBeforeReporting({
                  message:
                    "The agent's background run failed the same way several times in a row without producing any output. It was stopped so you can retry from the preserved chat context.",
                  errorCode: "background_follow_repeated_failure",
                  details: `terminal_reason: ${observedTerminalReason}`,
                });
                return "completed";
              }
              // Progress read from the PRE-attach snapshot first...
              const snapshotProgressAt =
                typeof active?.lastProgressAt === "number" &&
                Number.isFinite(active.lastProgressAt)
                  ? active.lastProgressAt
                  : null;
              const snapshotSaysStalled =
                lastObservedServerProgressAt !== null &&
                (snapshotProgressAt === null ||
                  snapshotProgressAt <= lastObservedServerProgressAt);
              // ...and re-read ONLY when that snapshot would condemn the run.
              //
              // `active` was fetched at the top of this iteration and the attach
              // above blocked for its whole duration, so judging progress from
              // it asks "did the server advance before we started listening?" —
              // never the question. A run that streamed text and a complete
              // tool-argument payload DURING the attach still looked frozen, and
              // the client durably aborted it. Measured fleet-wide: 23 of 24
              // client-watchdog kills landed on runs that had made
              // server-authoritative progress within the previous 90 seconds.
              //
              // Re-reading only on the condemning path keeps the extra request
              // off the healthy path entirely: a run already observed to be
              // advancing needs no second opinion.
              let activeProgressAt = snapshotProgressAt;
              // Set when the second opinion could not be obtained. The
              // snapshot is NOT a safe fallback here: it is precisely the
              // value that condemns the run, so falling back to it turns a
              // network blip into a kill.
              let secondOpinionUnreadable = false;
              if (snapshotSaysStalled) {
                try {
                  const freshRes = await fetch(
                    `${apiUrl}/runs/active?threadId=${encodeURIComponent(threadId!)}`,
                    { signal: abortSignal },
                  );
                  if (!freshRes.ok) {
                    // The route failing is not the run ending.
                    secondOpinionUnreadable = true;
                  } else {
                    const fresh = await freshRes.json().catch(() => {
                      secondOpinionUnreadable = true;
                      return null;
                    });
                    const freshProgressAt =
                      typeof fresh?.lastProgressAt === "number" &&
                      Number.isFinite(fresh.lastProgressAt)
                        ? fresh.lastProgressAt
                        : null;
                    if (freshProgressAt !== null) {
                      activeProgressAt =
                        snapshotProgressAt === null
                          ? freshProgressAt
                          : Math.max(snapshotProgressAt, freshProgressAt);
                    }
                  }
                } catch (refetchErr: unknown) {
                  if (
                    refetchErr instanceof Error &&
                    refetchErr.name === "AbortError"
                  ) {
                    clearActiveRun();
                    return "completed";
                  }
                  secondOpinionUnreadable = true;
                }
              }
              const runChanged = activeRunId !== lastObservedActiveRunId;
              const serverProgressAdvanced =
                activeProgressAt !== null &&
                lastObservedServerProgressAt !== null &&
                activeProgressAt > lastObservedServerProgressAt;
              lastObservedActiveRunId = activeRunId;
              if (activeProgressAt !== null) {
                lastObservedServerProgressAt =
                  lastObservedServerProgressAt === null || runChanged
                    ? activeProgressAt
                    : Math.max(lastObservedServerProgressAt, activeProgressAt);
                backgroundFollowLastServerProgressAt =
                  lastObservedServerProgressAt;
              }
              // Server-authoritative "silently deferred, recovery in
              // progress" signal (see `awaitingRedispatch` on
              // `getActiveRunForThreadAsync`, run-manager.ts): a
              // `chainServerDrivenContinuation` successor still inside
              // `UNCLAIMED_BACKGROUND_RUN_REDISPATCH_BOUND_MS`, being
              // redispatched by the server's fast/slow sweeps. This is known
              // to demonstrably exist — same as a "detached" attach — so
              // treat it identically and never accumulate idle time against
              // it. Once the server's own bound is exceeded (or the row is
              // claimed/terminal) this flips false and normal idle accounting
              // resumes, so a truly stuck deferral still fails loud via the
              // existing timeout below.
              const awaitingRedispatch = active?.awaitingRedispatch === true;
              const madeProgress = runChanged || serverProgressAdvanced;
              if (
                madeProgress ||
                awaitingRedispatch ||
                secondOpinionUnreadable
              ) {
                // Only server-authoritative progress resets the idle window:
                // a successor run or a newer lastProgressAt timestamp. Raw
                // sequence advancement is not enough — keepalives and retry
                // `clear` events are sequenced too, but the run manager
                // deliberately excludes both from lastProgressAt because they
                // do not move the user's task forward.
                idleSince = null;
                noProgressPollAttempts = 0;
                backgroundFollowConsecutiveNoProgressDetaches = 0;
              } else {
                // An absent stream and an attached stream with no newer
                // server-authoritative progress are the same no-progress
                // observation. Keep accumulating one idle window and back off
                // repeat attaches so a broken SQL tail cannot become a
                // reconnect storm.
                if (idleSince === null) idleSince = Date.now();
                noProgressPollAttempts += 1;
                if (attach === "detached") {
                  backgroundFollowNoProgressDetaches += 1;
                  backgroundFollowConsecutiveNoProgressDetaches += 1;
                }
                if (
                  Date.now() - idleSince >=
                  BACKGROUND_FOLLOW_IDLE_TIMEOUT_MS
                ) {
                  await durablyAbortBackgroundTurn("background_run_lost");
                  yield* emitBackgroundTerminalOutcome(lastSeenActive);
                  return "completed";
                }
              }
              dispatchResumingUiEvent();
            } else {
              // No active run visible for this turn yet (the gap between a
              // chunk ending and the successor becoming pollable). Refresh
              // the "Resuming…" bridge on every tick here too — not just
              // when an active run IS visible — so the client's own
              // isAutoResuming window can't lapse into a false-idle UI while
              // this loop is still confidently waiting out its own budget.
              dispatchResumingUiEvent();
              if (idleSince === null) idleSince = Date.now();
              if (Date.now() - idleSince >= BACKGROUND_FOLLOW_IDLE_TIMEOUT_MS) {
                captureChatClientError(
                  new Error(
                    "Background run went idle with no successor run appearing",
                  ),
                  "background-follow-idle",
                  {
                    lastSeenStatus:
                      typeof lastSeenActive?.status === "string"
                        ? lastSeenActive.status
                        : null,
                  },
                );
                await durablyAbortBackgroundTurn("background_run_lost");
                yield* emitBackgroundTerminalOutcome(lastSeenActive);
                return "completed";
              }
            }
            const backedOffPollDelayMs =
              noProgressPollAttempts > 0
                ? Math.min(
                    BACKGROUND_FOLLOW_POLL_INTERVAL_MS *
                      2 ** Math.min(noProgressPollAttempts - 1, 3),
                    5_000,
                  )
                : BACKGROUND_FOLLOW_POLL_INTERVAL_MS;
            const idleRemainingMs =
              idleSince === null
                ? Number.POSITIVE_INFINITY
                : Math.max(
                    0,
                    BACKGROUND_FOLLOW_IDLE_TIMEOUT_MS -
                      (Date.now() - idleSince),
                  );
            const nextPollDelayMs = Math.min(
              backedOffPollDelayMs,
              idleRemainingMs,
            );
            await delay(nextPollDelayMs, abortSignal);
            if (abortSignal.aborted) {
              clearActiveRun();
              return "completed";
            }
          }
        };

        const visibleContentForContinuation = (): ContentPart[] => {
          return contentAfterContinuationPrefix(
            content,
            visibleContinuationPrefix,
          );
        };

        const prepareAutoContinuation = (
          signal: AgentAutoContinueSignal,
        ): {
          ok: boolean;
          resetVisibleContent: boolean;
          completedToolName?: string;
          nonAdvancing?: boolean;
        } => {
          lastAutoContinueReason = signal.reason;
          lastActivityTrail = [...signal.activityTrail];
          if (signal.errorInfo) {
            lastRecoverableRunError = signal.errorInfo;
          }
          const isTransient = signal.reason !== "loop_limit";
          const visibleContent = visibleContentForContinuation();
          let currentPartialHistory =
            contentToContinuationHistory(visibleContent);
          const madeContentProgress = hasContinuationProgress(visibleContent);
          // THE boundary. One question — did this continuation advance the
          // turn? — decides every reason code, `loop_limit` included. It used
          // to skip this block entirely AND reset two of the budgets, so a
          // model that degenerated into a tool loop re-POSTed the same turnId
          // until the user gave up (measured in production at 186 minutes with
          // no answer). The durable per-turn ledger lives server-side inside
          // one run and never sees a client re-POST, so nothing else bounds it.
          const advanceDelta = contentAfterContinuationPrefix(
            content,
            advanceCheckPrefix,
          );
          // Everything that asks "what did THIS round do" reads the delta.
          // `visibleContent` accumulates across a `loop_limit` chain — its
          // prefix deliberately does not advance there — so one unresolved
          // "Preparing X" card from an earlier round would otherwise stall
          // every later round on the same name and kill a turn that was
          // streaming new prose the whole time.
          // An action streamed but not returned yet (a tool_start with no
          // tool_done) means the SERVER is still executing it, so a run_timeout
          // in that window can still deliver the result on reconnect; every
          // other reason means the stream is dead and nothing will complete it.
          const hasInFlightTool = hasInFlightToolCall(advanceDelta);
          const completedTool = lastCompletedTimeoutCandidateTool(content);
          const currentPreparingToolName =
            lastUnresolvedToolActivity(advanceDelta) ??
            lastPreparingActionTool(signal.activityTrail);

          const advance = describeContinuationAdvance(
            advanceDelta,
            currentPreparingToolName,
          );
          const serverStillRunningTool =
            signal.reason === "run_timeout" && hasInFlightTool;
          const advanced =
            serverStillRunningTool ||
            (advance.signature !== "" &&
              advance.signature !== lastAdvanceSignature);
          // Only remember a non-empty signature, so an empty round between two
          // identical rounds cannot launder the second one into "new work".
          if (advance.signature) lastAdvanceSignature = advance.signature;
          nonAdvancingContinuations = advanced
            ? 0
            : nonAdvancingContinuations + 1;
          if (isTransient) {
            totalTransientContinuationAttempts += 1;
          } else {
            loopLimitContinuations += 1;
          }
          advanceCheckPrefix = snapshotContent(content);

          // If a tool already completed, do not turn a missing closing
          // sentence into a scary connection failure. Give the model one
          // continuation opportunity (the completed tool itself counts as an
          // advance on the first timeout); if the follow-up produces no new
          // content, stop locally with a clear completed-tool warning.
          if (
            signal.reason === "run_timeout" &&
            completedTool &&
            !hasInFlightToolCall(content) &&
            !currentPreparingToolName &&
            !madeContentProgress &&
            !hasInFlightTool
          ) {
            return {
              ok: false,
              resetVisibleContent: false,
              completedToolName: completedTool.toolName,
            };
          }
          if (nonAdvancingContinuations >= MAX_NON_ADVANCING_CONTINUATIONS) {
            recoveryStall = advance.stall;
            return { ok: false, resetVisibleContent: false };
          }
          if (
            totalTransientContinuationAttempts >
              MAX_TOTAL_TRANSIENT_CONTINUATIONS ||
            loopLimitContinuations > MAX_LOOP_LIMIT_CONTINUATIONS
          ) {
            recoveryGaveUpOnContinuationBudget = true;
            return { ok: false, resetVisibleContent: false };
          }

          if (isTransient) {
            const settledInterruptedTools = settleInterruptedToolCalls(
              visibleContent,
              undefined,
              { includeActivity: true },
            );
            if (settledInterruptedTools) {
              currentPartialHistory =
                contentToContinuationHistory(visibleContent);
            }
          }

          if (isTransient && currentPartialHistory) {
            continuationHistoryFragments.push(currentPartialHistory);
          }
          const partialHistory = combineContinuationHistory(
            isTransient
              ? continuationHistoryFragments
              : [...continuationHistoryFragments, currentPartialHistory],
          );
          const structuredPartialHistory = contentToStructuredMessages(
            visibleContent,
            nextContinuationToolCallId,
          );
          if (isTransient && structuredPartialHistory.length > 0) {
            structuredContinuationFragments.push(...structuredPartialHistory);
          }
          const structuredCombinedHistory = isTransient
            ? structuredContinuationFragments
            : [...structuredContinuationFragments, ...structuredPartialHistory];
          currentHistory = [
            ...history,
            { role: "user", content: normalizeMentions(userMessageText) },
            ...(partialHistory
              ? [{ role: "assistant" as const, content: partialHistory }]
              : []),
          ];
          currentStructuredHistory = [
            ...structuredHistory,
            {
              role: "user",
              content: [
                { type: "text", text: normalizeMentions(userMessageText) },
              ],
            },
            ...structuredCombinedHistory,
          ];
          currentMessageText = autoContinueMessage(signal);
          // Continuation requests are stateless new POSTs. If the interrupted
          // turn depended on uploaded context, re-send that context; otherwise
          // an attachment-only prompt degrades to "Use the attached context."
          // with nothing attached after a stale run or reconnect recovery.
          includeAttachments = attachments.length > 0;
          includeReferences = Boolean(runConfig?.custom?.references);
          internalContinuationRequest = true;
          startupRecoveryAttempts = 0;
          clearActiveRun();
          if (!isTransient) {
            return {
              ok: true,
              resetVisibleContent: false,
              nonAdvancing: !advanced,
            };
          }

          // Keep everything visible during transient recovery. The continuation
          // prefix diff tracks what the next request has already seen, so
          // preserving text no longer causes duplicate continuation history.
          visibleContinuationPrefix = snapshotContent(content);
          return {
            ok: true,
            resetVisibleContent: false,
            nonAdvancing: !advanced,
          };
        };

        const continueAfterMissingFinalResponse = (): boolean => {
          const continuation = prepareAutoContinuation(
            new AgentAutoContinueSignal({ reason: "stream_ended" }),
          );
          if (!continuation.ok) return false;
          if (typeof window !== "undefined") {
            window.dispatchEvent(
              new CustomEvent("agent-chat:auto-continue", {
                detail: { tabId },
              }),
            );
          }
          return true;
        };

        while (true) {
          try {
            runId = null;
            lastSeq = -1;
            const res = await fetchWithStartupTimeout(
              apiUrl,
              {
                method: "POST",
                headers,
                body: JSON.stringify({
                  message: currentMessageText,
                  displayMessage: userMessageText,
                  ...(queuedMessageId ? { queuedMessageId } : {}),
                  history: currentHistory,
                  structuredHistory: currentStructuredHistory,
                  turnId,
                  ...(trackInRunsTray ? { trackInRunsTray: true } : {}),
                  ...(threadId ? { threadId } : {}),
                  ...(internalContinuationRequest
                    ? { internalContinuation: true }
                    : {}),
                  ...(requestMode ? { mode: requestMode } : {}),
                  ...(model ? { model } : {}),
                  ...(engine ? { engine } : {}),
                  ...(effort ? { effort } : {}),
                  ...(harness ? { harness: { runtime: harness } } : {}),
                  ...(browserTabId ? { browserTabId } : {}),
                  ...(scopeRef?.current ? { scope: scopeRef.current } : {}),
                  ...(includeAttachments ? { attachments } : {}),
                  ...(includeReferences && runConfig?.custom?.references
                    ? { references: runConfig.custom.references }
                    : {}),
                  ...(approvedToolCalls ? { approvedToolCalls } : {}),
                }),
              },
              STARTUP_RESPONSE_TIMEOUT_MS,
              abortSignal,
            );

            // Check for auth errors returned as 200 with JSON (common with middleware issues)
            const contentType = res.headers.get("content-type") || "";
            if (
              res.ok &&
              contentType.includes("application/json") &&
              !contentType.includes("text/event-stream")
            ) {
              try {
                const body = await res.text();
                const parsed = JSON.parse(body) as { error?: unknown };
                if (parsed.error) {
                  throw new Error(String(parsed.error));
                }
              } catch (e) {
                if (
                  e instanceof Error &&
                  e.message !== "Unexpected end of JSON input"
                ) {
                  throw e;
                }
              }
            }

            if (!res.ok) {
              if (res.status === 409) {
                let activeRunId: string | null = null;
                try {
                  const body = await res.json();
                  if (body?.activeRunId) {
                    activeRunId = String(body.activeRunId);
                  }
                } catch {
                  // Fall through to the generic response handling below.
                }
                // A 409 means the server still has an active run for this
                // thread. For a fresh user turn — a queued follow-up OR a normal
                // send fired shortly after the previous run finished (the server
                // can report a just-finished run as active for up to
                // RUN_STALE_MS while its terminal status write lands) — adopting
                // `activeRunId` below would reconnect to that prior run, replay
                // its final answer, and silently drop this turn. The same race
                // can happen after an internal auto-continue: if the reported
                // active run is one this adapter already consumed, reconnecting
                // to it replays the terminal auto_continue and exits instead of
                // posting the continuation. Wait for stale/previous active runs
                // to clear and retry THIS prompt. An unknown run reported to an
                // internal continuation is only adoptable after /runs/active
                // proves it carries this turnId; a bare 409 run id is not
                // enough ownership evidence.
                if (activeRunId !== null && internalContinuationRequest) {
                  const reconnected = yield* reconnectActiveRunForThread({
                    requireCurrentTurn: true,
                  });
                  if (reconnected) return;
                }
                const shouldRetryConflictingActiveRun = activeRunId !== null;
                if (shouldRetryConflictingActiveRun) {
                  queuedConflictRetries += 1;
                  if (queuedConflictRetries <= MAX_QUEUED_CONFLICT_RETRIES) {
                    await delay(500, abortSignal);
                    if (abortSignal.aborted) return;
                    continue;
                  }
                  const message =
                    "The previous response is still finishing and the new message could not start yet. Please try again.";
                  const runError = {
                    message,
                    details: `The server kept reporting active run ${activeRunId} for this thread after ${MAX_QUEUED_CONFLICT_RETRIES} retries.`,
                    errorCode: "active_run_conflict",
                    recoverable: true,
                    runId: activeRunId,
                  };
                  // This is a terminal outcome for the attempted turn. Settle
                  // both real in-flight calls and activity-only placeholders
                  // before yielding the error; otherwise a prior "Preparing
                  // run-code" event remains an unresolved tool card and the UI
                  // keeps showing a spinner beside an already-terminal error.
                  settleInterruptedToolCalls(content, undefined, {
                    includeActivity: true,
                  });
                  if (typeof window !== "undefined") {
                    window.dispatchEvent(
                      new CustomEvent("agent-chat:activity-clear", {
                        detail: { tabId },
                      }),
                    );
                    window.dispatchEvent(
                      new CustomEvent("agent-chat:run-error", {
                        detail: { ...runError, tabId },
                      }),
                    );
                  }
                  content.push({
                    type: "text",
                    text: `Something went wrong: ${message}`,
                  });
                  settleTerminalChatRun();
                  yield {
                    content: [...content],
                    status: {
                      type: "incomplete" as const,
                      reason: "error" as const,
                    },
                    metadata: { custom: { runError } },
                  } as ChatModelRunResult;
                  return;
                }
              }

              if (res.status === 401 || res.status === 403) {
                if (await tryRecoverAuthOnce()) {
                  continue;
                }
                dispatchAuthError("auth-required");
                content.push({
                  type: "text",
                  text: authErrorText("auth-required"),
                });
                settleTerminalChatRun();
                yield {
                  content: [...content],
                  status: {
                    type: "incomplete" as const,
                    reason: "error" as const,
                  },
                } as ChatModelRunResult;
                return;
              }

              // 405 Method Not Allowed usually means the session is broken/expired
              // (e.g. a redirect to a login page that only accepts GET).
              if (res.status === 405) {
                if (await tryRecoverAuthOnce()) {
                  continue;
                }
                dispatchAuthError("session-expired");
                content.push({
                  type: "text",
                  text: authErrorText("session-expired"),
                });
                settleTerminalChatRun();
                yield {
                  content: [...content],
                  status: {
                    type: "incomplete" as const,
                    reason: "error" as const,
                  },
                } as ChatModelRunResult;
                return;
              }

              let errorText = `Server error: ${res.status}`;
              try {
                const body = await res.text();
                const structuredError = parseStructuredAgentChatError(body);
                if (isAuthErrorMessage(body)) {
                  if (await tryRecoverAuthOnce()) {
                    continue;
                  }
                  const reason = authErrorReasonFromMessage(body);
                  dispatchAuthError(reason);
                  content.push({
                    type: "text",
                    text: authErrorText(reason, body),
                  });
                  settleTerminalChatRun();
                  yield {
                    content: [...content],
                    status: {
                      type: "incomplete" as const,
                      reason: "error" as const,
                    },
                  } as ChatModelRunResult;
                  return;
                }
                if (isMissingCredentialMessage(body)) {
                  const failure = missingCredentialFailure(body);
                  if (typeof window !== "undefined") {
                    dispatchMissingApiKey();
                    window.dispatchEvent(
                      new CustomEvent("agent-chat:run-error", {
                        detail: { ...failure.runError, tabId },
                      }),
                    );
                  }
                  content.push({ type: "text", text: failure.text });
                  settleTerminalChatRun();
                  yield {
                    content: [...content],
                    status: {
                      type: "incomplete" as const,
                      reason: "error" as const,
                    },
                    metadata: { custom: { runError: failure.runError } },
                  } as ChatModelRunResult;
                  return;
                } else if (body.includes("Cannot find any path")) {
                  errorText =
                    "Agent chat endpoint not found. Make sure the agent-chat plugin is loaded in server/plugins/.";
                } else if (body) {
                  // A non-retryable structured response is a terminal server
                  // outcome. Preserve its code and stop before the generic
                  // connection recovery below can POST the same turn again.
                  if (
                    structuredError &&
                    (structuredError.retryable === false ||
                      structuredError.errorCode === "database_unavailable")
                  ) {
                    throw new AgentChatHttpError(structuredError);
                  }
                  errorText = structuredError
                    ? structuredError.message
                    : body.length > 200
                      ? body.slice(0, 200) + "..."
                      : body;
                }
              } catch (error) {
                if (error instanceof AgentChatHttpError) throw error;
              }
              throw new Error(errorText);
            }
            if (!res.body) {
              throw new Error("No response body");
            }

            // Track the run ID for reconnection
            runId = res.headers.get("X-Run-Id");
            updateCurrentRunDispatchMode(res.headers.get("X-Dispatch-Mode"));
            if (runId && !attemptedRunIds.includes(runId)) {
              attemptedRunIds.push(runId);
            }
            if (runId && threadId) {
              clearPendingTurnIfMatches(threadId, turnId);
              setActiveRun({ threadId, runId, turnId, lastSeq: -1 });
            }

            takeRunStreamOwnership();
            let missingFinalResponseResult: ChatModelRunResult | null = null;
            for await (const result of readSSEStream(
              res.body,
              content,
              toolCallCounter,
              tabId,
              (seq, isProgress) => {
                rememberRunSeq(seq);
                if (runId && threadId) {
                  updateActiveRunSeq(threadId, runId, seq, isProgress);
                }
              },
              runId,
              currentSSEOptions(),
            )) {
              const nextResult = withRequestModeMetadata(result);
              if (
                isDurableBackgroundDispatch() &&
                missingFinalResponseWarningFromResult(nextResult)
              ) {
                missingFinalResponseResult = nextResult;
                continue;
              }
              if (isTerminalChatModelRunResult(nextResult)) {
                settleTerminalChatRun();
              }
              yield nextResult;
            }

            if (isDurableBackgroundDispatch() && missingFinalResponseResult) {
              const warning = missingFinalResponseWarningFromResult(
                missingFinalResponseResult,
              );
              const lastContentPart = content.at(-1);
              if (
                warning?.message &&
                lastContentPart?.type === "text" &&
                lastContentPart.text === warning.message
              ) {
                content.pop();
              }
              if (continueAfterMissingFinalResponse()) {
                continue;
              }
              settleTerminalChatRun();
              yield missingFinalResponseResult;
              clearActiveRun();
              return;
            }

            // Run completed normally — clear active run state
            clearActiveRun();
            return;
          } catch (err: unknown) {
            if (err instanceof Error && err.name === "AbortError") {
              // User-initiated abort (Stop button) — clear active run
              clearActiveRun();
              return;
            }

            if (err instanceof AgentAutoContinueSignal) {
              // Background-dispatched runs: the server chains continuations
              // itself (successor row pre-inserted before the old chunk
              // completes). Never POST a synthetic continuation and never
              // abort the live server-side run — switch to read-only
              // following of server state instead. This is the fix for the
              // client/server recovery race: client watchdog signals here are
              // just "reattach", not "recover".
              if (shouldFollowServerContinuation(err) && threadId) {
                const followOutcome = yield* followBackgroundTurn(err);
                if (followOutcome === "client_continue") {
                  continue;
                }
                return;
              }
              if (err.reason === "run_timeout" && !err.errorInfo) {
                const reconnected =
                  yield* reconnectBackgroundContinuationForRunTimeout();
                if (reconnected) return;
              }
              // A CLIENT watchdog expiring means "reattach", never "kill the
              // run": the server owns recovery and still believes this run is
              // healthy. Aborting here was the single largest source of
              // user-visible failure. A server-sent `auto_continue` is a
              // different thing entirely — it wants a fresh POST.
              if (
                err.reason === "stream_ended" ||
                (err.reason === "no_progress" && err.clientWatchdog)
              ) {
                const reconnected = yield* reconnectCurrentRun();
                if (reconnected) return;
                const activeReconnected = yield* reconnectActiveRunForThread();
                if (activeReconnected) return;
              }
              const continuation = prepareAutoContinuation(err);
              if (!continuation.ok) {
                if (continuation.completedToolName) {
                  const message = completedToolTimeoutMessage(
                    continuation.completedToolName,
                  );
                  content.push({ type: "text", text: message });
                  settleTerminalChatRun();
                  yield {
                    content: [...content],
                    status: {
                      type: "complete" as const,
                      reason: "stop" as const,
                    },
                    metadata: {
                      custom: {
                        ...(runId ? { runId } : {}),
                        runWarning: {
                          message,
                          errorCode: "final_response_timeout_after_tool",
                          recoverable: true,
                        },
                      },
                    },
                  };
                  clearActiveRun();
                  return;
                }
                const preservedError =
                  err.errorInfo ?? lastRecoverableRunError ?? null;
                const message =
                  preservedError?.message ??
                  exhaustedRecoveryMessage(err.reason);
                const details = [
                  preservedError?.details,
                  connectionRecoveryDetails(),
                ]
                  .filter(Boolean)
                  .join("\n\n");
                const errorCode =
                  preservedError?.errorCode ?? "connection_error";
                captureChatClientError(err, "auto-continuation-exhausted", {
                  autoContinueReason: err.reason,
                  ...(errorCode ? { errorCode } : {}),
                });
                const runError = {
                  message,
                  ...(details ? { details } : {}),
                  errorCode,
                  recoverable: preservedError?.recoverable ?? true,
                  ...(runId ? { runId } : {}),
                };
                if (typeof window !== "undefined") {
                  window.dispatchEvent(
                    new CustomEvent("agent-chat:run-error", {
                      detail: { ...runError, tabId },
                    }),
                  );
                }
                settleInterruptedToolCalls(content, undefined, {
                  includeActivity: true,
                });
                content.push({
                  type: "text",
                  text: formatChatErrorText(
                    message,
                    preservedError?.upgradeUrl,
                    // `message` is already user-facing here: either a
                    // recovery-specific explanation from exhaustedRecoveryMessage
                    // or a normalized gateway message from errorInfo. Passing
                    // the fallback connection_error code back through the
                    // formatter would replace the useful recovery guidance
                    // with the generic interruption copy.
                    preservedError ? errorCode : undefined,
                  ),
                });
                settleTerminalChatRun();
                yield {
                  content: [...content],
                  status: {
                    type: "incomplete" as const,
                    reason: "error" as const,
                  },
                  metadata: {
                    custom: { ...(runId ? { runId } : {}), runError },
                  },
                };
                clearActiveRun();
                return;
              }
              if (continuation.resetVisibleContent) {
                yield {
                  content: snapshotContent(content),
                } as ChatModelRunResult;
              }
              // Signal to the UI that we are in the continuation window so it
              // can display "Resuming…" instead of "Thinking" during the gap.
              if (typeof window !== "undefined") {
                window.dispatchEvent(
                  new CustomEvent("agent-chat:auto-continue", {
                    detail: { tabId },
                  }),
                );
              }
              // A run that advanced nothing usually never got past
              // startup/gateway; re-POSTing the identical payload immediately
              // just hits the identical wall. Back that case off instead.
              if (continuation.nonAdvancing) {
                await retryDelay(
                  Math.max(0, nonAdvancingContinuations - 1),
                  abortSignal,
                );
              } else {
                await delay(250, abortSignal);
              }
              if (abortSignal.aborted) return;
              continue;
            }

            if (err instanceof AgentChatHttpError) {
              const normalized = normalizeChatError(err.message, err.errorCode);
              const details = [err.details, normalized.details]
                .filter(Boolean)
                .join("\n\n");
              const runError = {
                message: normalized.message,
                ...(details ? { details } : {}),
                ...(err.errorCode ? { errorCode: err.errorCode } : {}),
                recoverable: err.retryable === true,
                ...(runId ? { runId } : {}),
              };
              captureChatClientError(err, "server-error", {
                ...(err.errorCode ? { errorCode: err.errorCode } : {}),
                retryable: err.retryable ?? false,
              });
              if (typeof window !== "undefined") {
                window.dispatchEvent(
                  new CustomEvent("agent-chat:run-error", {
                    detail: {
                      ...runError,
                      ...(err.upgradeUrl ? { upgradeUrl: err.upgradeUrl } : {}),
                      tabId,
                    },
                  }),
                );
              }
              settleInterruptedToolCalls(content, undefined, {
                includeActivity: true,
              });
              content.push({
                type: "text",
                text: `Something went wrong: ${normalized.message}`,
              });
              settleTerminalChatRun();
              yield {
                content: [...content],
                status: {
                  type: "incomplete" as const,
                  reason: "error" as const,
                },
                metadata: {
                  custom: { ...(runId ? { runId } : {}), runError },
                },
              };
              clearActiveRun();
              return;
            }

            const errMsg =
              err instanceof Error ? err.message : "Something went wrong.";
            const isAuthError = isAuthErrorMessage(errMsg);

            // Don't try to reconnect for auth/client errors — show error directly
            if (isAuthError) {
              if (await tryRecoverAuthOnce()) {
                continue;
              }
              const reason = authErrorReasonFromMessage(errMsg);
              dispatchAuthError(reason);
              content.push({
                type: "text",
                text: authErrorText(reason, errMsg),
              });
              settleTerminalChatRun();
              yield {
                content: [...content],
                status: {
                  type: "incomplete" as const,
                  reason: "error" as const,
                },
              };
              clearActiveRun();
              return;
            }

            if (isMissingCredentialMessage(errMsg)) {
              const failure = missingCredentialFailure(errMsg);
              if (typeof window !== "undefined") {
                dispatchMissingApiKey();
                window.dispatchEvent(
                  new CustomEvent("agent-chat:run-error", {
                    detail: { ...failure.runError, tabId },
                  }),
                );
              }
              content.push({ type: "text", text: failure.text });
              settleTerminalChatRun();
              yield {
                content: [...content],
                status: {
                  type: "incomplete" as const,
                  reason: "error" as const,
                },
                metadata: { custom: { runError: failure.runError } },
              };
              clearActiveRun();
              return;
            }

            // Connection lost — try to reconnect to the run
            const reconnected = yield* reconnectCurrentRun();
            if (reconnected) return;
            const activeReconnected = yield* reconnectActiveRunForThread();
            if (activeReconnected) return;

            // Background-dispatched run whose transport failed and could not
            // be reconnected above: follow server state instead of the
            // synthetic-continuation POST below. (An initial POST that failed
            // before any response headers arrived has no dispatch mode yet
            // and keeps the foreground startup-retry path.)
            if (shouldFollowServerContinuation() && threadId) {
              const followOutcome = yield* followBackgroundTurn(
                new AgentAutoContinueSignal({ reason: "stream_ended" }),
              );
              if (followOutcome === "client_continue") {
                continue;
              }
              return;
            }

            if (err instanceof AgentStartupTimeoutError) {
              if (startupRecoveryAttempts < MAX_STARTUP_RECOVERY_ATTEMPTS) {
                await retryDelay(startupRecoveryAttempts++, abortSignal);
                if (abortSignal.aborted) return;
                continue;
              }
              const message =
                "The agent chat endpoint did not start streaming in time after several recovery attempts. This usually means prompt setup, the LLM gateway, or the provider is stalled.";
              captureChatClientError(err, "startup-timeout", {
                timeoutMs: err.timeoutMs,
                startupRecoveryAttempts,
              });
              const runError = {
                message,
                details: connectionRecoveryDetails(),
                errorCode: "startup_timeout",
                recoverable: true,
                ...(runId ? { runId } : {}),
              };
              if (typeof window !== "undefined") {
                window.dispatchEvent(
                  new CustomEvent("agent-chat:run-error", {
                    detail: { ...runError, tabId },
                  }),
                );
              }
              content.push({
                type: "text",
                text: `Something went wrong: ${message}`,
              });
              settleTerminalChatRun();
              yield {
                content: [...content],
                status: {
                  type: "incomplete" as const,
                  reason: "error" as const,
                },
                metadata: { custom: { ...(runId ? { runId } : {}), runError } },
              };
              clearActiveRun();
              return;
            }

            // Reconnect failed or not possible — keep going from the partial
            // streamed content instead of surfacing a transient transport error.
            if (content.length > 0) {
              const continuation = prepareAutoContinuation(
                new AgentAutoContinueSignal({ reason: "stream_ended" }),
              );
              if (!continuation.ok) {
                if (continuation.completedToolName) {
                  const message = completedToolTimeoutMessage(
                    continuation.completedToolName,
                  );
                  content.push({ type: "text", text: message });
                  settleTerminalChatRun();
                  yield {
                    content: [...content],
                    status: {
                      type: "complete" as const,
                      reason: "stop" as const,
                    },
                    metadata: {
                      custom: {
                        ...(runId ? { runId } : {}),
                        runWarning: {
                          message,
                          errorCode: "final_response_timeout_after_tool",
                          recoverable: true,
                        },
                      },
                    },
                  };
                  clearActiveRun();
                  return;
                }
                const message = exhaustedRecoveryMessage("stream_ended");
                captureChatClientError(err, "recovery-exhausted");
                const runError = {
                  message,
                  details: connectionRecoveryDetails(),
                  errorCode: "connection_error",
                  recoverable: true,
                  ...(runId ? { runId } : {}),
                };
                if (typeof window !== "undefined") {
                  window.dispatchEvent(
                    new CustomEvent("agent-chat:run-error", {
                      detail: { ...runError, tabId },
                    }),
                  );
                }
                settleInterruptedToolCalls(content, undefined, {
                  includeActivity: true,
                });
                content.push({
                  type: "text",
                  text: `Something went wrong: ${message}`,
                });
                settleTerminalChatRun();
                yield {
                  content: [...content],
                  status: {
                    type: "incomplete" as const,
                    reason: "error" as const,
                  },
                  metadata: {
                    custom: { ...(runId ? { runId } : {}), runError },
                  },
                };
                clearActiveRun();
                return;
              }
              if (continuation.resetVisibleContent) {
                yield {
                  content: snapshotContent(content),
                } as ChatModelRunResult;
              }
              // Signal to the UI that we are in the continuation window.
              if (typeof window !== "undefined") {
                window.dispatchEvent(
                  new CustomEvent("agent-chat:auto-continue", {
                    detail: { tabId },
                  }),
                );
              }
              await delay(250, abortSignal);
              if (abortSignal.aborted) return;
              continue;
            }

            if (
              isRetryableStartupError(errMsg) &&
              startupRecoveryAttempts < MAX_STARTUP_RECOVERY_ATTEMPTS
            ) {
              await retryDelay(startupRecoveryAttempts++, abortSignal);
              if (abortSignal.aborted) return;
              continue;
            }

            // No partial work exists, so this is still a real startup failure.
            captureChatClientError(err, "startup-failed", {
              retryableStartupError: isRetryableStartupError(errMsg),
            });
            const normalized = normalizeChatError(errMsg);
            const runError = {
              message: normalized.message,
              ...(normalized.details ? { details: normalized.details } : {}),
              errorCode: "connection_error",
              recoverable: true,
              ...(runId ? { runId } : {}),
            };
            if (typeof window !== "undefined") {
              window.dispatchEvent(
                new CustomEvent("agent-chat:run-error", {
                  detail: { ...runError, tabId },
                }),
              );
            }
            content.push({
              type: "text",
              text: errMsg.startsWith("Server error:")
                ? errMsg
                : `Something went wrong: ${normalized.message}`,
            });
            settleTerminalChatRun();
            yield {
              content: [...content],
              status: {
                type: "incomplete" as const,
                reason: "error" as const,
              },
              metadata: { custom: { ...(runId ? { runId } : {}), runError } },
            };
            return;
          }
        }
      } finally {
        if (typeof window !== "undefined" && ownsActiveRunState()) {
          dispatchTerminalChatUiCleanup(tabId);
          window.dispatchEvent(
            new CustomEvent("agentNative.chatRunning", {
              detail: { isRunning: false, tabId },
            }),
          );
        }
      }
    },
  };
}
