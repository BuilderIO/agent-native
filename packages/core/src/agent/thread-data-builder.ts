import {
  parseAgentSuggestion,
  type AgentRunSnapshot,
} from "@agent-native/agentkit/protocol";

import type { ActionChatUIConfig } from "../action-ui.js";
import type { ArtifactReceipt } from "../artifacts/detect.js";
import {
  formatChatErrorText,
  normalizeChatError,
} from "../client/error-format.js";
import {
  isCredentialGapCodeAgentEvent,
  normalizeCodeAgentTranscript,
  type CodeAgentTranscriptEvent as CoreCodeAgentTranscriptEvent,
  type NormalizedCodeAgentStatusEvent,
  type NormalizedCodeAgentThinkingEvent,
  type NormalizedCodeAgentToolEvent,
  type NormalizedCodeAgentTranscriptItem,
} from "../code-agents/transcript-normalizer.js";
import type { AgentMcpAppPayload } from "../mcp-client/app-result.js";
import {
  RUN_NOT_STARTED_METADATA_KEY,
  type RefusedTurnRetryContext,
} from "../shared/agent-chat-run-not-started.js";
import { BUILDER_GATEWAY_INTERNAL_ERROR_CODE } from "./engine/error-detail.js";
import { stringifyToolUseInputForGateway } from "./engine/translate-anthropic.js";
import type { EngineContentPart, EngineMessage } from "./engine/types.js";
import { parseFollowUpSuggestions } from "./follow-up-suggestions.js";
import type { ActiveRun } from "./run-manager.js";
import { isContinuationTerminalReason } from "./types.js";
import type { AgentChatAttachment, RunEvent } from "./types.js";

interface ContentPart {
  type: string;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  argsText?: string;
  args?: Record<string, string>;
  result?: string;
  isError?: boolean;
  outcome?: "unknown";
  completedSideEffect?: boolean;
  artifacts?: ArtifactReceipt[];
  mcpApp?: AgentMcpAppPayload;
  chatUI?: ActionChatUIConfig;
  chatUIResult?: unknown;
  activity?: boolean;
  approval?: {
    approvalKey: string;
    dismissed?: boolean;
    askId?: string;
    allowPersistentApproval?: false;
  };
}

interface BuildAssistantMessageOptions {
  suppressInternalContinuation?: boolean;
  turnId?: string;
  runDurationMs?: number;
  scope?: { type: string; id: string } | null;
}

type AssistantMessage = NonNullable<ReturnType<typeof buildAssistantMessage>>;
type UserMessage = ReturnType<typeof buildUserMessage>;

const INTERRUPTED_TOOL_RESULT =
  "Interrupted before this tool returned a result.";
const INTERRUPTED_ACTIVITY_RESULT = "Stopped before this action started.";

export const ASSISTANT_RUN_DURATION_METADATA_KEY = "agentNativeRunDurationMs";

const MAX_STORED_ATTACHMENT_CHARS = 60_000;

function isInternalContinuationError(event: {
  error: string;
  errorCode?: string;
  recoverable?: boolean;
}): boolean {
  const code = String(event.errorCode ?? "").toLowerCase();
  const msg = event.error.toLowerCase();
  if (code === "builder_gateway_error") return false;
  if (event.recoverable === false) return false;
  return (
    event.recoverable === true ||
    code === "builder_gateway_timeout" ||
    code === "builder_gateway_stream_ended" ||
    code === "stale_run" ||
    code === "timeout" ||
    code === "timeout_error" ||
    code === "http_408" ||
    code === "http_429" ||
    code === "http_500" ||
    code === BUILDER_GATEWAY_INTERNAL_ERROR_CODE ||
    code === "http_502" ||
    code === "http_503" ||
    code === "http_504" ||
    code === "rate_limited" ||
    code === "too_many_concurrent_requests" ||
    code === "overloaded_error" ||
    msg.includes("timeout") ||
    msg.includes("gateway timeout") ||
    msg.includes("inactivity timeout") ||
    msg.includes("stream ended") ||
    msg.includes("stream closed") ||
    msg.includes("temporarily unavailable") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504") ||
    msg.includes("529")
  );
}

export function buildAssistantMessage(
  events: RunEvent[],
  runId?: string,
  options: BuildAssistantMessageOptions = {},
): {
  id: string;
  createdAt: Date;
  role: "assistant";
  content: ContentPart[];
  status:
    | { type: "complete"; reason: "stop" }
    | { type: "incomplete"; reason: "error" };
  metadata: Record<string, unknown>;
} | null {
  const content: ContentPart[] = [];
  let toolCallCounter = 0;
  let runError: {
    message: string;
    errorCode?: string;
    details?: string;
    recoverable?: boolean;
  } | null = null;
  let endedAtInternalContinuationBoundary = false;
  let userStoppedRun = false;

  const appendText = (text: string) => {
    const last = content[content.length - 1];
    if (last && last.type === "text") {
      last.text = (last.text ?? "") + text;
    } else {
      content.push({ type: "text", text });
    }
  };

  const appendReasoning = (text: string) => {
    const last = content[content.length - 1];
    if (last && last.type === "reasoning") {
      last.text = (last.text ?? "") + text;
    } else {
      content.push({ type: "reasoning", text });
    }
  };

  let lastNonClearIndex = events.length - 1;
  while (
    lastNonClearIndex >= 0 &&
    events[lastNonClearIndex]?.event.type === "clear"
  ) {
    lastNonClearIndex -= 1;
  }

  for (const [index, { event }] of events.entries()) {
    if (event.type === "clear") {
      if (index > lastNonClearIndex) continue;
      clearAssistantDraftContent(content);
      continue;
    }

    if (event.type === "text") {
      appendText(event.text ?? "");
      continue;
    }

    if (event.type === "thinking") {
      appendReasoning(event.text ?? "");
      continue;
    }

    if (event.type === "tool_start") {
      const explicitToolCallId = event.id?.trim();
      if (explicitToolCallId) {
        const replayed = content.some(
          (part) =>
            part.type === "tool-call" &&
            part.toolCallId === explicitToolCallId &&
            part.toolName === (event.tool ?? "unknown"),
        );
        if (replayed) continue;
      }
      toolCallCounter += 1;
      const toolCallId =
        explicitToolCallId ||
        (runId ? `${runId}:tc_${toolCallCounter}` : `tc_${toolCallCounter}`);
      const args = (event.input ?? {}) as Record<string, string>;
      content.push({
        type: "tool-call",
        toolCallId,
        toolName: event.tool ?? "unknown",
        argsText: JSON.stringify(args),
        args,
      });
      continue;
    }

    if (event.type === "approval_required") {
      const matchingIndex = findApprovalToolCallIndex(
        content,
        event.tool ?? "unknown",
        event.toolCallId,
      );

      const part = content[matchingIndex];
      if (part?.type === "tool-call") {
        part.approval = {
          approvalKey: event.approvalKey,
          ...(event.askId ? { askId: event.askId } : {}),
          ...(event.allowPersistentApproval === false
            ? { allowPersistentApproval: false }
            : {}),
        };
      }
      continue;
    }

    if (event.type === "tool_done") {
      const eventToolCallId = event.id?.trim();
      let matchingIndex = -1;

      if (eventToolCallId) {
        for (let i = content.length - 1; i >= 0; i--) {
          const part = content[i];
          if (
            part.type === "tool-call" &&
            part.toolCallId === eventToolCallId &&
            part.result === undefined
          ) {
            matchingIndex = i;
            break;
          }
        }
      }

      if (matchingIndex === -1) {
        for (let i = content.length - 1; i >= 0; i--) {
          const part = content[i];
          if (
            part.type === "tool-call" &&
            part.toolName === event.tool &&
            part.result === undefined
          ) {
            matchingIndex = i;
            break;
          }
        }
      }

      const part = content[matchingIndex];
      if (part?.type === "tool-call") {
        part.result = event.result ?? "";
        if (event.isError !== undefined) part.isError = event.isError;
        if (event.completedSideEffect !== undefined) {
          part.completedSideEffect = event.completedSideEffect;
        }
        if (event.artifacts !== undefined) part.artifacts = event.artifacts;
        if (event.mcpApp) part.mcpApp = event.mcpApp;
        if (event.chatUI) part.chatUI = event.chatUI;
        if (event.chatUI && event.chatUIResult !== undefined) {
          part.chatUIResult = event.chatUIResult;
        }
      }
      continue;
    }

    if (event.type === "loop_limit") {
      if (options.suppressInternalContinuation) {
        endedAtInternalContinuationBoundary = true;
      }
      continue;
    }

    if (event.type === "auto_continue") {
      if (options.suppressInternalContinuation) {
        endedAtInternalContinuationBoundary = true;
      }
      continue;
    }

    if (event.type === "error") {
      if (
        options.suppressInternalContinuation &&
        isInternalContinuationError(event)
      ) {
        endedAtInternalContinuationBoundary = true;
        continue;
      }
      if (event.errorCode === "run_timeout" && event.recoverable) {
        continue;
      }
      const normalized = normalizeChatError(event.error, event.errorCode);
      runError = {
        message: normalized.message,
        ...(event.errorCode ? { errorCode: event.errorCode } : {}),
        ...((event.details ?? normalized.details)
          ? { details: event.details ?? normalized.details }
          : {}),
        ...(event.recoverable ? { recoverable: event.recoverable } : {}),
      };
      appendText(
        `${content.length > 0 ? "\n\n" : ""}${formatChatErrorText(event.error, event.upgradeUrl, event.errorCode)}`,
      );
      continue;
    }

    if (event.type === "done") {
      userStoppedRun ||= event.reason === "user";
      continue;
    }

    // missing_api_key — terminal signal, not content
  }

  if (content.length === 0) return null;

  const continued = endedAtInternalContinuationBoundary;
  if (userStoppedRun || !continued) {
    settleInterruptedToolCalls(content, userStoppedRun);
  }

  const custom: Record<string, unknown> = {};
  if (options.turnId) custom.turnId = options.turnId;
  if (options.scope?.type && options.scope.id) {
    custom.chatScope = {
      type: options.scope.type,
      id: options.scope.id,
    };
  }
  if (runId) custom.foldedRunIds = [runId];
  if (
    typeof options.runDurationMs === "number" &&
    Number.isFinite(options.runDurationMs) &&
    options.runDurationMs >= 0
  ) {
    custom[ASSISTANT_RUN_DURATION_METADATA_KEY] = options.runDurationMs;
  }
  if (continued) custom.continued = true;
  if (userStoppedRun) custom.userStopped = true;
  if (runError && !userStoppedRun) {
    custom.runError = {
      ...runError,
      ...(runId ? { runId } : {}),
    };
  }

  const metadata: Record<string, unknown> = {};
  if (runId) metadata.runId = runId;
  if (Object.keys(custom).length > 0) metadata.custom = custom;

  return {
    id: `server-${runId ?? Date.now()}`,
    createdAt: new Date(),
    role: "assistant",
    content,
    status: userStoppedRun
      ? { type: "complete" as const, reason: "stop" as const }
      : runError
        ? { type: "incomplete" as const, reason: "error" as const }
        : { type: "complete" as const, reason: "stop" as const },
    metadata,
  };
}

function clearAssistantDraftContent(content: ContentPart[]): void {
  for (let index = content.length - 1; index >= 0; index--) {
    const part = content[index];
    if (!part) continue;
    if (
      part.type === "tool-call" &&
      part.activity !== true &&
      part.result !== undefined
    ) {
      return;
    }
    if (part.type === "text" || part.type === "reasoning") {
      content.splice(index, 1);
      continue;
    }
    if (part.type === "tool-call" && part.result === undefined) {
      const isEphemeral =
        part.activity === true ||
        part.argsText === "" ||
        Object.keys(part.args ?? {}).length === 0;
      if (isEphemeral) content.splice(index, 1);
    }
  }
}

function getStoredMessage(entry: any): any {
  return entry?.message ?? entry;
}

function getStoredParentId(entry: any): string | null | undefined {
  return typeof entry?.parentId === "string" || entry?.parentId === null
    ? entry.parentId
    : undefined;
}

function getStoredRunConfig(entry: any): any {
  return entry && typeof entry === "object" && "runConfig" in entry
    ? entry.runConfig
    : undefined;
}

function messageId(message: any): string | undefined {
  return typeof message?.id === "string" && message.id ? message.id : undefined;
}

function messageCreatedAtMs(message: any): number | null {
  const value = message?.createdAt;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim()) {
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : null;
  }
  return null;
}

function getMessageRunId(message: any): string | undefined {
  const meta = message?.metadata;
  const direct = meta?.runId;
  const custom = meta?.custom?.runId;
  const errorRun = meta?.custom?.runError?.runId ?? meta?.runError?.runId;
  if (typeof direct === "string") return direct;
  if (typeof custom === "string") return custom;
  if (typeof errorRun === "string") return errorRun;
  return undefined;
}

function messageContentIsEmpty(content: unknown): boolean {
  if (typeof content === "string") return content.trim().length === 0;
  if (Array.isArray(content)) {
    return !content.some((part: any) => {
      if (!part || typeof part !== "object") return false;
      if (part.type === "text") {
        return typeof part.text === "string" && part.text.trim().length > 0;
      }
      return true;
    });
  }
  return content == null;
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (part: any) => part?.type === "text" && typeof part.text === "string",
    )
    .map((part: any) => part.text)
    .join("");
}

function settleInterruptedToolCalls(
  content: ContentPart[],
  userStopped = false,
): void {
  for (const part of content) {
    const clearsSyntheticInterruption =
      userStopped &&
      part.type === "tool-call" &&
      part.outcome === "unknown" &&
      (part.result === INTERRUPTED_TOOL_RESULT ||
        part.result === INTERRUPTED_ACTIVITY_RESULT);
    if (
      part.type === "tool-call" &&
      (part.result === undefined || clearsSyntheticInterruption)
    ) {
      if (userStopped) {
        part.result = "";
        delete part.outcome;
      } else {
        part.result = INTERRUPTED_TOOL_RESULT;
        part.outcome = "unknown";
      }
    }
  }
}

function isTerminalAssistantStatus(status: unknown): boolean {
  const type = (status as { type?: unknown } | undefined)?.type;
  return type === "complete" || type === "incomplete";
}

function normalizeAttachmentIdentity(attachments: unknown): unknown {
  if (!Array.isArray(attachments) || attachments.length === 0) return undefined;
  return attachments.map((att: any) => ({
    type: att?.type,
    name: att?.name,
    contentType: att?.contentType,
  }));
}

function findApprovalToolCallIndex(
  content: ContentPart[],
  toolName: string,
  toolCallId?: string,
): number {
  if (toolCallId) {
    for (let i = content.length - 1; i >= 0; i--) {
      const part = content[i];
      if (
        part.type === "tool-call" &&
        part.toolCallId === toolCallId &&
        part.result === undefined
      ) {
        return i;
      }
    }

    const readerLocalCandidates: number[] = [];
    for (let i = 0; i < content.length; i += 1) {
      const part = content[i];
      if (
        part.type === "tool-call" &&
        part.toolName === toolName &&
        part.result === undefined &&
        typeof part.toolCallId === "string" &&
        /^tc_\d+$/.test(part.toolCallId)
      ) {
        readerLocalCandidates.push(i);
      }
    }
    return readerLocalCandidates.length === 1 ? readerLocalCandidates[0]! : -1;
  }

  for (let i = content.length - 1; i >= 0; i--) {
    const part = content[i];
    if (
      part.type === "tool-call" &&
      part.toolName === toolName &&
      part.result === undefined
    ) {
      return i;
    }
  }
  return -1;
}

function normalizeContentForFingerprint(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  return content.map((part: any) =>
    part && typeof part === "object" && part.type === "tool-call"
      ? { ...part, toolCallId: undefined }
      : part,
  );
}

interface MessageIdentityKeySet {
  strong: string[];
  fingerprint: string[];
}

function messageIdentityKeySet(
  message: any,
  eventRunIds?: Map<string, string>,
): MessageIdentityKeySet {
  const strong: string[] = [];
  if (typeof message?.id === "string" && message.id) {
    strong.push(`id:${message.id}`);
  }
  const runId =
    getMessageRunId(message) ??
    (typeof message?.id === "string"
      ? eventRunIds?.get(message.id)
      : undefined);
  if (runId) strong.push(`run:${runId}`);
  const turnId = turnIdOf(message);
  if (turnId) strong.push(`turn:${turnId}`);

  const fingerprint: string[] = [];
  try {
    fingerprint.push(
      `fingerprint:${JSON.stringify({
        role: message?.role,
        content: normalizeContentForFingerprint(message?.content),
        attachments: normalizeAttachmentIdentity(message?.attachments),
      })}`,
    );
  } catch {
    // Best effort. id/runId usually exist for persisted assistant-ui rows.
  }
  if (message?.role === "user") {
    try {
      fingerprint.push(
        `user-fingerprint:${JSON.stringify({
          role: message.role,
          content: normalizeContentForFingerprint(message.content),
          attachments: normalizeAttachmentIdentity(message.attachments),
        })}`,
      );
    } catch {
      // Same best-effort behavior as the full fingerprint.
    }
  }
  return { strong, fingerprint };
}

function messageIdentityKeys(message: any): string[] {
  const { strong, fingerprint } = messageIdentityKeySet(message);
  return [...strong, ...fingerprint];
}

function messagesMatch(a: any, b: any): boolean {
  const bKeys = new Set(messageIdentityKeys(b));
  return messageIdentityKeys(a).some((key) => bKeys.has(key));
}

function keySetsOverlap(a: string[], b: Set<string>): boolean {
  return a.some((key) => b.has(key));
}

function findRankedIdentityMatch(
  existingKeys: MessageIdentityKeySet,
  incomingKeySets: MessageIdentityKeySet[],
  usedIncoming: Set<number>,
  existingIndex: number,
): number {
  const strongCandidates: number[] = [];
  const fingerprintCandidates: number[] = [];
  for (let i = 0; i < incomingKeySets.length; i++) {
    if (usedIncoming.has(i)) continue;
    const keys = incomingKeySets[i]!;
    if (keySetsOverlap(existingKeys.strong, new Set(keys.strong))) {
      strongCandidates.push(i);
    } else if (
      keySetsOverlap(existingKeys.fingerprint, new Set(keys.fingerprint))
    ) {
      fingerprintCandidates.push(i);
    }
  }
  const candidates =
    strongCandidates.length > 0 ? strongCandidates : fingerprintCandidates;
  if (candidates.length === 0) return -1;
  return candidates.reduce((closest, index) =>
    Math.abs(index - existingIndex) < Math.abs(closest - existingIndex)
      ? index
      : closest,
  );
}

function preserveAssistantRunDuration(chosenEntry: any, otherEntry: any): any {
  const chosen = getStoredMessage(chosenEntry);
  const other = getStoredMessage(otherEntry);
  if (chosen?.role !== "assistant" || other?.role !== "assistant") {
    return chosenEntry;
  }

  const chosenCustom =
    chosen.metadata?.custom && typeof chosen.metadata.custom === "object"
      ? (chosen.metadata.custom as Record<string, unknown>)
      : {};
  if (assistantRunDurationMs(chosenCustom) != null) return chosenEntry;

  const otherCustom =
    other.metadata?.custom && typeof other.metadata.custom === "object"
      ? (other.metadata.custom as Record<string, unknown>)
      : {};
  const durationMs = assistantRunDurationMs(otherCustom);
  if (durationMs == null) return chosenEntry;

  const nextMessage = {
    ...chosen,
    metadata: {
      ...chosen.metadata,
      custom: {
        ...chosenCustom,
        [ASSISTANT_RUN_DURATION_METADATA_KEY]: durationMs,
      },
    },
  };
  return chosenEntry?.message === undefined
    ? nextMessage
    : { ...chosenEntry, message: nextMessage };
}

function chooseMergedMessageEntry(existingEntry: any, incomingEntry: any): any {
  const existing = getStoredMessage(existingEntry);
  const incoming = getStoredMessage(incomingEntry);
  if (existing?.role === "user" && incoming?.role === "user") {
    const custom = existing.metadata?.custom;
    if (custom?.submittedRunId) {
      const message = {
        ...incoming,
        metadata: {
          ...existing.metadata,
          ...incoming.metadata,
          custom: {
            ...custom,
            ...incoming.metadata?.custom,
            submittedRunId: custom.submittedRunId,
            ...(custom.submittedTurnId
              ? { submittedTurnId: custom.submittedTurnId }
              : {}),
          },
        },
      };
      return incomingEntry?.message === undefined
        ? message
        : { ...incomingEntry, message };
    }
  }
  const existingTurn = turnIdOf(existing);
  const incomingTurn = turnIdOf(incoming);
  if (
    existing?.role === "assistant" &&
    incoming?.role === "assistant" &&
    existingTurn &&
    existingTurn === incomingTurn
  ) {
    const existingWeight = assistantContentWeight(existing.content);
    const incomingWeight = assistantContentWeight(incoming.content);
    const chosen =
      existingWeight > incomingWeight
        ? existingEntry
        : incomingWeight > existingWeight
          ? incomingEntry
          : isTerminalAssistantStatus(existing?.status) &&
              !isTerminalAssistantStatus(incoming?.status)
            ? existingEntry
            : incomingEntry;
    return preserveAssistantRunDuration(
      chosen,
      chosen === existingEntry ? incomingEntry : existingEntry,
    );
  }
  if (
    existing?.role === "assistant" &&
    incoming?.role === "assistant" &&
    isTerminalAssistantStatus(existing?.status) &&
    !isTerminalAssistantStatus(incoming?.status)
  ) {
    return preserveAssistantRunDuration(existingEntry, incomingEntry);
  }
  return preserveAssistantRunDuration(incomingEntry, existingEntry);
}

function normalizeMessageEntry(
  entry: any,
  parentId: string | null,
): { message: any; parentId: string | null; runConfig?: any } | null {
  const message = getStoredMessage(entry);
  if (!messageId(message)) return null;
  const normalizedMessage = normalizeAssistantToolCallIds(message);
  const runConfig = getStoredRunConfig(entry);
  return {
    message: normalizedMessage,
    parentId,
    ...(runConfig !== undefined ? { runConfig } : {}),
  };
}

function uniqueToolCallId(toolCallId: string, seen: Set<string>): string {
  if (!seen.has(toolCallId)) return toolCallId;
  let suffix = 2;
  let candidate = `${toolCallId}__dedup_${suffix}`;
  while (seen.has(candidate)) {
    suffix += 1;
    candidate = `${toolCallId}__dedup_${suffix}`;
  }
  return candidate;
}

function normalizeAssistantToolCallIds(message: any): any {
  if (message?.role !== "assistant" || !Array.isArray(message.content)) {
    return message;
  }

  const seen = new Set<string>();
  let changed = false;
  const content = message.content.map((part: any) => {
    if (
      part?.type !== "tool-call" ||
      typeof part.toolCallId !== "string" ||
      part.toolCallId.length === 0
    ) {
      return part;
    }

    const nextToolCallId = uniqueToolCallId(part.toolCallId, seen);
    seen.add(nextToolCallId);
    if (nextToolCallId === part.toolCallId) return part;
    changed = true;
    return { ...part, toolCallId: nextToolCallId };
  });

  return changed ? { ...message, content } : message;
}

export function normalizeThreadRepository(repo: any): any {
  const normalized = repo && typeof repo === "object" ? { ...repo } : {};
  const sourceMessages: any[] = Array.isArray(repo?.messages)
    ? repo.messages
    : [];
  const firstIndexById = new Map<string, number>();
  const lastEntryById = new Map<string, any>();
  sourceMessages.forEach((entry, index) => {
    const id = messageId(getStoredMessage(entry));
    if (!id) return;
    if (!firstIndexById.has(id)) firstIndexById.set(id, index);
    lastEntryById.set(id, entry);
  });
  const uniqueSourceMessages = sourceMessages
    .filter((entry, index) => {
      const id = messageId(getStoredMessage(entry));
      return id && firstIndexById.get(id) === index;
    })
    .map((entry) => {
      const id = messageId(getStoredMessage(entry));
      return (id && lastEntryById.get(id)) || entry;
    });
  const messages: Array<{
    message: any;
    parentId: string | null;
    runConfig?: any;
  }> = [];
  const seenIds = new Set<string>();
  let previousId: string | null = null;

  for (const entry of uniqueSourceMessages) {
    const message = getStoredMessage(entry);
    const id = messageId(message);
    if (!id) continue;

    const requestedParentId = getStoredParentId(entry);
    const parentId =
      requestedParentId === null
        ? null
        : requestedParentId && seenIds.has(requestedParentId)
          ? requestedParentId
          : previousId;

    const normalizedEntry = normalizeMessageEntry(entry, parentId);
    if (!normalizedEntry) continue;

    messages.push(normalizedEntry);
    seenIds.add(id);
    previousId = id;
  }

  normalized.messages = messages;
  const headId = typeof repo?.headId === "string" ? repo.headId : undefined;
  normalized.headId =
    headId && seenIds.has(headId) ? headId : (previousId ?? null);
  return normalized;
}

const MAX_REPLAYED_TOOL_RESULT_CHARS = 12_000;
const MAX_REPLAYED_TOOL_PAYLOAD_CHARS = 64_000;
const ELIDED_TOOL_DETAIL_NOTE =
  "[Tool calls from this turn were elided from replayed history to fit the context. Re-read the current state with tools if their detail matters.]";

function replayedToolResultContent(result: unknown): string {
  const body =
    typeof result === "string"
      ? result
      : result === undefined || result === null
        ? ""
        : (() => {
            try {
              return JSON.stringify(result) ?? "";
            } catch {
              return String(result);
            }
          })();
  if (body.length <= MAX_REPLAYED_TOOL_RESULT_CHARS) return body;
  const omitted = body.length - MAX_REPLAYED_TOOL_RESULT_CHARS;
  return `${body.slice(0, MAX_REPLAYED_TOOL_RESULT_CHARS)}\n\n[Tool result truncated after ${MAX_REPLAYED_TOOL_RESULT_CHARS.toLocaleString()} characters; ${omitted.toLocaleString()} omitted from replayed history. Re-read the current state with tools if the exact content matters.]`;
}

function hasIntegrationReplayPolicy(message: any): boolean {
  const metadata = message?.metadata;
  if (!metadata || typeof metadata !== "object") return false;
  return (
    metadata.integrationDelivery !== undefined ||
    metadata.integrationDeliveryAttempted === true ||
    Array.isArray(metadata.integrationArtifacts)
  );
}

function replayableToolCalls(message: any): any[] {
  const content = Array.isArray(message?.content) ? message.content : [];
  return content.filter(
    (part: any) =>
      part?.type === "tool-call" &&
      typeof part.toolCallId === "string" &&
      part.toolCallId.trim() &&
      typeof part.toolName === "string" &&
      part.toolName.trim(),
  );
}

function replayedToolPayloadCost(message: any): number {
  let cost = 0;
  for (const part of replayableToolCalls(message)) {
    cost += stringifyToolUseInputForGateway(part.args ?? {}).length;
    if (part.result !== undefined) {
      cost += replayedToolResultContent(part.result).length;
    }
  }
  return cost;
}

function assistantReplayContent(
  message: any,
  text: string,
): { assistant: EngineContentPart[]; results: EngineContentPart[] } {
  const assistant: EngineContentPart[] = [];
  const results: EngineContentPart[] = [];
  if (text.trim()) assistant.push({ type: "text", text });
  const content = Array.isArray(message?.content) ? message.content : [];
  for (const part of content) {
    if (part?.type !== "tool-call") continue;
    const id =
      typeof part.toolCallId === "string" ? part.toolCallId.trim() : "";
    const name = typeof part.toolName === "string" ? part.toolName.trim() : "";
    if (!id || !name) continue;
    const input =
      part.args && typeof part.args === "object" && !Array.isArray(part.args)
        ? (part.args as Record<string, unknown>)
        : {};
    assistant.push({ type: "tool-call", id, name, input });
    const result =
      part.result === undefined ? INTERRUPTED_TOOL_RESULT : part.result;
    results.push({
      type: "tool-result",
      toolCallId: id,
      toolName: name,
      toolInput: stringifyToolUseInputForGateway(input),
      content: replayedToolResultContent(result),
      ...(part.isError === true ? { isError: true } : {}),
    });
  }
  return { assistant, results };
}

export interface ThreadDataToEngineMessagesOptions {
  includeToolCalls?: boolean;
}

export function threadDataToEngineMessages(
  threadData: string | Record<string, unknown> | null | undefined,
  options: ThreadDataToEngineMessagesOptions = {},
): EngineMessage[] {
  const messages: EngineMessage[] = [];
  if (!threadData) return messages;
  let data: any;
  try {
    data = typeof threadData === "string" ? JSON.parse(threadData) : threadData;
  } catch {
    return messages;
  }
  if (!Array.isArray(data?.messages)) return messages;

  const entries: any[] = data.messages;
  const replaysTools = (m: any) =>
    options.includeToolCalls === true &&
    m?.role === "assistant" &&
    !hasIntegrationReplayPolicy(m);

  const toolPayloadAllowed = new Set<number>();
  if (options.includeToolCalls) {
    let spent = 0;
    for (let i = entries.length - 1; i >= 0; i--) {
      const m = entries[i]?.message ?? entries[i];
      if (!replaysTools(m)) continue;
      const cost = replayedToolPayloadCost(m);
      if (cost === 0) continue;
      if (spent + cost > MAX_REPLAYED_TOOL_PAYLOAD_CHARS) continue;
      spent += cost;
      toolPayloadAllowed.add(i);
    }
  }

  for (const [index, entry] of entries.entries()) {
    const m = entry?.message ?? entry;
    if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
    const text = threadMessageTextForEngine(m);
    if (replaysTools(m)) {
      if (toolPayloadAllowed.has(index)) {
        const { assistant, results } = assistantReplayContent(m, text);
        if (assistant.length === 0) continue;
        messages.push({ role: "assistant", content: assistant });
        if (results.length > 0) {
          messages.push({ role: "user", content: results });
        }
        continue;
      }
      const elided = replayableToolCalls(m).length > 0;
      const prose = elided
        ? `${text.trim() ? `${text.trim()}\n\n` : ""}${ELIDED_TOOL_DETAIL_NOTE}`
        : text;
      if (!prose.trim()) continue;
      messages.push({
        role: "assistant",
        content: [{ type: "text", text: prose }],
      });
      continue;
    }
    if (!text.trim()) continue;
    messages.push({ role: m.role, content: [{ type: "text", text }] });
  }
  return messages;
}

const MAX_RECOVERED_HISTORY_MESSAGES = 12;
const MAX_RECOVERED_HISTORY_CHARS = 32_000;

function engineMessageTextLength(message: EngineMessage): number {
  return message.content.reduce(
    (total, part) =>
      total + (part.type === "text" ? (part.text?.length ?? 0) : 0),
    0,
  );
}

function boundedHistoryWindow(
  messages: EngineMessage[],
  limits?: { maxMessages?: number; maxChars?: number },
): EngineMessage[] {
  const maxMessages = limits?.maxMessages ?? MAX_RECOVERED_HISTORY_MESSAGES;
  const maxChars = limits?.maxChars ?? MAX_RECOVERED_HISTORY_CHARS;
  const window = messages.slice(-maxMessages);
  let total = window.reduce(
    (sum, message) => sum + engineMessageTextLength(message),
    0,
  );
  while (window.length > 1 && total > maxChars) {
    total -= engineMessageTextLength(window.shift()!);
  }
  // Providers reject a tool result whose call was cut from the window.
  while (window[0]?.content.some((part) => part.type === "tool-result")) {
    window.shift();
  }
  return window;
}

export function recoverThreadHistoryForRequest(
  threadData: string | Record<string, unknown> | null | undefined,
  limits?: { maxMessages?: number; maxChars?: number },
): EngineMessage[] {
  return boundedHistoryWindow(threadDataToEngineMessages(threadData), limits);
}

/**
 * History for resuming a stopped turn: earlier turns get the recovery window,
 * while the turn itself, from its last user message on, stays whole so every
 * finished tool call keeps its result. Without a user message, the turn's
 * prompt is not in the thread: `foundTurnPrompt` is false and every message is
 * returned unbounded.
 */
export function resumeThreadHistoryForRequest(
  threadData: string | Record<string, unknown> | null | undefined,
): { messages: EngineMessage[]; foundTurnPrompt: boolean } {
  const messages = threadDataToEngineMessages(threadData, {
    includeToolCalls: true,
  });
  let turnStart = messages.length - 1;
  while (
    turnStart >= 0 &&
    !(
      messages[turnStart]!.role === "user" &&
      messages[turnStart]!.content.some((part) => part.type === "text")
    )
  ) {
    turnStart--;
  }
  if (turnStart < 0) return { messages, foundTurnPrompt: false };
  return {
    messages: [
      ...boundedHistoryWindow(messages.slice(0, turnStart)),
      ...messages.slice(turnStart),
    ],
    foundTurnPrompt: true,
  };
}

const MAX_INTEGRATION_ARTIFACTS_IN_CONTEXT = 12;
const MAX_INTEGRATION_ARTIFACT_FIELD_CHARS = 500;

function boundedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed
    ? trimmed.slice(0, MAX_INTEGRATION_ARTIFACT_FIELD_CHARS)
    : undefined;
}

function promptSafeJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("&", "\\u0026")
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e");
}

function messageTextContent(message: any): string {
  if (typeof message?.content === "string") return message.content;
  if (!Array.isArray(message?.content)) return "";
  return message.content
    .filter(
      (part: any) => part?.type === "text" && typeof part.text === "string",
    )
    .map((part: any) => part.text)
    .join("\n");
}

export function threadMessageTextForEngine(message: any): string {
  const delivery = message?.metadata?.integrationDelivery;
  const deliveryAttempted =
    message?.metadata?.integrationDeliveryAttempted === true;
  const deliveredText =
    message?.role === "assistant" &&
    delivery?.status === "delivered" &&
    typeof delivery.text === "string" &&
    delivery.text.trim()
      ? delivery.text
      : undefined;
  let text =
    deliveredText ??
    (message?.role === "assistant" && deliveryAttempted
      ? ""
      : messageTextContent(message));

  if (message?.role !== "assistant") return text;
  const storedArtifacts = message?.metadata?.integrationArtifacts;
  if (!Array.isArray(storedArtifacts)) return text;

  const artifacts = storedArtifacts
    .slice(0, MAX_INTEGRATION_ARTIFACTS_IN_CONTEXT)
    .map((artifact: any) => ({
      resourceType: boundedString(artifact?.resourceType),
      id: boundedString(artifact?.id),
      sourceAction: boundedString(artifact?.sourceAction),
      titleAtAction: boundedString(artifact?.titleAtAction),
      url: boundedString(artifact?.url),
    }))
    .filter(
      (artifact: {
        resourceType?: string;
        id?: string;
        sourceAction?: string;
      }) => artifact.resourceType && artifact.id && artifact.sourceAction,
    );
  if (artifacts.length === 0) return text;

  const context = [
    "<integration_artifact_context>",
    "Trusted action history for this conversation. Resource IDs remain stable if participants rename the resource. Fields such as titleAtAction are historical aliases from the time of that action, not current resource state. Use stable IDs to locate an earlier artifact, read its current state before changing it, and omit fields the user did not explicitly ask to change while still deciding whether to update, add, supersede, or create.",
    promptSafeJson(artifacts),
    "</integration_artifact_context>",
  ].join("\n");
  text = text.trim() ? `${text.trim()}\n\n${context}` : context;
  return text;
}

export interface CodeAgentThreadTranscriptEvent {
  id: string;
  runId: string;
  kind?: CoreCodeAgentTranscriptEvent["kind"];
  type?: CoreCodeAgentTranscriptEvent["kind"] | "note";
  message?: string;
  text?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
  artifactPath?: string;
  artifactUrl?: string;
  signal?: CoreCodeAgentTranscriptEvent["signal"];
}

export interface BuildRepositoryFromCodeAgentTranscriptOptions {
  hideCredentialMessages?: boolean;
}

export function buildRepositoryFromCodeAgentTranscript(
  events: readonly CodeAgentThreadTranscriptEvent[],
  options: BuildRepositoryFromCodeAgentTranscriptOptions = {},
): any {
  const normalized = normalizeCodeAgentTranscript(
    events.map(toCoreCodeAgentTranscriptEvent),
  );
  const repo: {
    headId: string | null;
    messages: Array<{ message: any; parentId: string | null }>;
  } = {
    headId: null,
    messages: [],
  };

  let headId: string | null = null;
  let assistantTurn: {
    turnIndex: number;
    id: string;
    createdAt: string;
    updatedAt: string;
    runId?: string;
    content: ContentPart[];
    eventIds: string[];
  } | null = null;

  const flushAssistant = () => {
    if (!assistantTurn || assistantTurn.content.length === 0) {
      assistantTurn = null;
      return;
    }
    const message = {
      id: assistantTurn.id,
      createdAt: new Date(assistantTurn.createdAt),
      role: "assistant" as const,
      content: assistantTurn.content,
      status: { type: "complete" as const, reason: "stop" as const },
      metadata: {
        ...(assistantTurn.runId ? { runId: assistantTurn.runId } : {}),
        custom: {
          codeAgentTranscriptEventIds: assistantTurn.eventIds,
        },
      },
    };
    repo.messages.push({ message, parentId: headId });
    headId = message.id;
    repo.headId = headId;
    assistantTurn = null;
  };

  for (const item of normalized.items) {
    if (item.type === "user") {
      flushAssistant();
      const runId = item.events[0]?.runId;
      const userMessage = buildUserMessage({
        text: item.text,
        attachments: codeAgentAttachmentsFromEvents(item.events),
        runId: runId ? `${runId}-${item.id}` : item.id,
        createdAt: new Date(item.createdAt),
      });
      userMessage.id = `code-user-${item.id}`;
      const existingCustom =
        userMessage.metadata.custom &&
        typeof userMessage.metadata.custom === "object"
          ? (userMessage.metadata.custom as Record<string, unknown>)
          : {};
      userMessage.metadata = {
        ...userMessage.metadata,
        custom: {
          ...existingCustom,
          submittedRunId: runId,
          codeAgentTranscriptEventIds: item.eventIds,
        },
      };
      repo.messages.push({ message: userMessage, parentId: headId });
      headId = userMessage.id;
      repo.headId = headId;
      continue;
    }

    const content = contentPartForCodeAgentTranscriptItem(item, options);
    if (!content) continue;

    if (!assistantTurn || assistantTurn.turnIndex !== item.turnIndex) {
      flushAssistant();
      assistantTurn = {
        turnIndex: item.turnIndex,
        id: `code-assistant-${item.turnIndex}-${item.id}`,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        runId: item.events[0]?.runId,
        content: [],
        eventIds: [],
      };
    }
    assistantTurn.updatedAt = item.updatedAt;
    assistantTurn.eventIds.push(...item.eventIds);
    if (content.type === "text") {
      const last = assistantTurn.content.at(-1);
      if (last?.type === "text") {
        last.text = `${last.text}${last.text ? "\n\n" : ""}${content.text}`;
      } else {
        assistantTurn.content.push(content);
      }
    } else {
      assistantTurn.content.push(content);
    }
  }

  flushAssistant();
  return normalizeThreadRepository(repo);
}

function rewriteEntryParentId(
  entry: any,
  idRewrites: Map<string, string>,
): any {
  const parentId = getStoredParentId(entry);
  if (!parentId) return entry;
  const rewritten = idRewrites.get(parentId);
  if (!rewritten) return entry;
  return { ...entry, parentId: rewritten };
}

function isMessageAncestor(
  messages: readonly any[],
  ancestorId: string,
  descendantId: string,
): boolean {
  if (ancestorId === descendantId) return true;
  const parentById = new Map<string, string | null>();
  for (const entry of messages) {
    const id = messageId(getStoredMessage(entry));
    if (!id) continue;
    const parentId = getStoredParentId(entry);
    parentById.set(id, typeof parentId === "string" ? parentId : null);
  }

  const visited = new Set<string>();
  let currentId: string | null = descendantId;
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    currentId = parentById.get(currentId) ?? null;
    if (currentId === ancestorId) return true;
  }
  return false;
}

function chooseMergedHeadId(
  existingRepo: any,
  incomingRepo: any,
  mergedRepo: any,
): string | null {
  const existingHead = messageId(
    getStoredMessage(
      existingRepo?.messages?.find(
        (entry: any) =>
          messageId(getStoredMessage(entry)) === existingRepo?.headId,
      ),
    ),
  );
  const incomingHead = messageId(
    getStoredMessage(
      incomingRepo?.messages?.find(
        (entry: any) =>
          messageId(getStoredMessage(entry)) === incomingRepo?.headId,
      ),
    ),
  );
  const mergedMessages = Array.isArray(mergedRepo?.messages)
    ? mergedRepo.messages
    : [];
  const mergedIds = new Set(
    mergedMessages
      .map((entry: any) => messageId(getStoredMessage(entry)))
      .filter((id: string | undefined): id is string => Boolean(id)),
  );
  const existingCandidate =
    existingHead && mergedIds.has(existingHead) ? existingHead : null;
  const incomingCandidate =
    incomingHead && mergedIds.has(incomingHead) ? incomingHead : null;
  if (!existingCandidate) return incomingCandidate;
  if (!incomingCandidate || existingCandidate === incomingCandidate) {
    return existingCandidate;
  }

  if (isMessageAncestor(mergedMessages, existingCandidate, incomingCandidate)) {
    return incomingCandidate;
  }
  if (isMessageAncestor(mergedMessages, incomingCandidate, existingCandidate)) {
    return existingCandidate;
  }

  const messageById = new Map(
    mergedMessages.map((entry: any) => {
      const message = getStoredMessage(entry);
      return [messageId(message), message] as const;
    }),
  );
  const existingTime = messageCreatedAtMs(messageById.get(existingCandidate));
  const incomingTime = messageCreatedAtMs(messageById.get(incomingCandidate));
  if (
    existingTime !== null &&
    incomingTime !== null &&
    existingTime !== incomingTime
  ) {
    return incomingTime > existingTime ? incomingCandidate : existingCandidate;
  }

  return existingCandidate;
}

export interface MergeThreadDataOptions {
  preserveExistingQueuedMessages?: boolean;
  preserveExistingTopLevelKeys?: boolean;
  onAnnotationConflict?: (conflict: ThreadAnnotationSnapshotConflict) => void;
}

export interface ThreadAnnotationSnapshotConflict {
  messageId: string;
  annotationId?: string;
  operation: "upsert" | "remove";
}

const CLAIMED_QUEUED_MESSAGE_IDS_KEY = "_claimedQueuedMessageIds";
const MAX_CLAIMED_QUEUED_MESSAGE_IDS = 200;

function claimedQueuedMessageIds(repo: any): string[] {
  const value = repo?.[CLAIMED_QUEUED_MESSAGE_IDS_KEY];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
}

export function hasClaimedQueuedMessage(repo: any, messageId: string): boolean {
  return claimedQueuedMessageIds(repo).includes(messageId);
}

export function claimQueuedMessage(repo: any, messageId: string): any {
  const normalized = repo && typeof repo === "object" ? { ...repo } : {};
  const claimed = claimedQueuedMessageIds(normalized).filter(
    (id) => id !== messageId,
  );
  normalized[CLAIMED_QUEUED_MESSAGE_IDS_KEY] = [...claimed, messageId].slice(
    -MAX_CLAIMED_QUEUED_MESSAGE_IDS,
  );
  return pruneClaimedQueuedMessages(normalized);
}

export function applySubmittedUserMessage(
  repo: any,
  userMessage: UserMessage,
  queuedMessage?:
    | { kind?: "queued-message"; id: string; claimId?: string; now?: number }
    | { kind: "background-operation"; id: string },
):
  | { status: "submitted" | "already_submitted"; repo: any }
  | { status: "already_claimed" | "claim_expired" } {
  if (!queuedMessage) {
    return { status: "submitted", repo: upsertUserMessage(repo, userMessage) };
  }

  const userCustom = userMessage.metadata.custom as
    | Record<string, unknown>
    | undefined;
  const wasSubmitted = Array.isArray(repo?.messages)
    ? repo.messages.some((entry: unknown) => {
        const outer = entry as Record<string, unknown> | null;
        const message = outer?.message ?? outer;
        if (!message || typeof message !== "object") return false;
        const metadata = (message as Record<string, unknown>).metadata;
        if (!metadata || typeof metadata !== "object") return false;
        const custom = (metadata as Record<string, unknown>).custom;
        return (
          custom !== null &&
          typeof custom === "object" &&
          (custom as Record<string, unknown>).agentNativeQueuedMessageId ===
            queuedMessage.id &&
          (custom as Record<string, unknown>).submittedRunId ===
            userCustom?.submittedRunId
        );
      })
    : false;
  if (wasSubmitted) {
    return {
      status: "already_submitted",
      repo: claimQueuedMessage(repo, queuedMessage.id),
    };
  }
  if (hasClaimedQueuedMessage(repo, queuedMessage.id)) {
    return { status: "already_claimed" };
  }

  const queued = Array.isArray(repo?.queuedMessages)
    ? repo.queuedMessages.find(
        (message: unknown) =>
          message &&
          typeof message === "object" &&
          (message as Record<string, unknown>).id === queuedMessage.id,
      )
    : undefined;
  if (queuedMessage.kind === "background-operation") {
    if (queued) return { status: "claim_expired" };
    return {
      status: "submitted",
      repo: upsertUserMessage(
        claimQueuedMessage(repo, queuedMessage.id),
        userMessage,
      ),
    };
  }
  const claim = queued?.promotionClaim;
  if (
    !queued ||
    typeof queuedMessage.claimId !== "string" ||
    claim?.id !== queuedMessage.claimId ||
    typeof claim.expiresAt !== "number" ||
    claim.expiresAt <= (queuedMessage.now ?? Date.now())
  ) {
    return { status: "claim_expired" };
  }

  return {
    status: "submitted",
    repo: upsertUserMessage(
      claimQueuedMessage(repo, queuedMessage.id),
      userMessage,
    ),
  };
}

function snapshotEntryId(entry: any, kind: "message" | "toolCall" | "widget") {
  if (!entry || typeof entry !== "object") return undefined;
  if (kind === "widget") {
    const widgetId = entry.widget?.id;
    return typeof widgetId === "string" ? widgetId : undefined;
  }
  return typeof entry.id === "string" ? entry.id : undefined;
}

function snapshotMessageRunIds(agentKit: any): Map<string, string> {
  const runIds = new Map<string, string>();
  for (const event of Array.isArray(agentKit?.events) ? agentKit.events : []) {
    if (
      (event?.type === "message.created" ||
        event?.type === "message.completed") &&
      event.message?.role === "assistant" &&
      typeof event.message.id === "string" &&
      typeof event.runId === "string"
    ) {
      runIds.set(event.message.id, event.runId);
    }
  }
  for (const run of Array.isArray(agentKit?.runs) ? agentKit.runs : []) {
    if (
      typeof run?.activeMessageId === "string" &&
      typeof run.id === "string"
    ) {
      runIds.set(run.activeMessageId, run.id);
    }
  }
  return runIds;
}

function snapshotAssistantTextKey(
  message: any,
  runIds: Map<string, string>,
): string | undefined {
  const runId =
    (typeof message?.id === "string" ? runIds.get(message.id) : undefined) ??
    message?.metadata?.runId ??
    message?.metadata?.custom?.runId;
  if (
    message?.role !== "assistant" ||
    typeof runId !== "string" ||
    !Array.isArray(message.parts) ||
    message.parts.length === 0 ||
    !message.parts.every(
      (part: any) => part?.type === "text" && typeof part.text === "string",
    )
  ) {
    return undefined;
  }
  return JSON.stringify([
    runId,
    message.parts.map((part: any) => [part.text, part.format ?? null]),
  ]);
}

function preferIncomingSnapshotEntry(
  kind: "message" | "toolCall" | "widget",
  existing: any,
  incoming: any,
): boolean {
  if (kind === "message") {
    const rank = (message: any) =>
      message.status === "complete" ? 2 : message.status === "error" ? 1 : 0;
    if (rank(existing) !== rank(incoming))
      return rank(incoming) > rank(existing);
    const partCount = (message: any) =>
      Array.isArray(message.parts) ? message.parts.length : 0;
    if (partCount(existing) !== partCount(incoming)) {
      return partCount(incoming) > partCount(existing);
    }
    const textLength = (message: any) =>
      (Array.isArray(message.parts) ? message.parts : []).reduce(
        (total: number, part: any) =>
          total + (typeof part?.text === "string" ? part.text.length : 0),
        0,
      );
    return textLength(incoming) > textLength(existing);
  }
  if (kind === "toolCall") {
    return existing.status === "running" && incoming.status !== "running";
  }
  return (
    existing.widget?.state === "active" && incoming.widget?.state !== "active"
  );
}

function mergeAgentKitHistoryArray(
  existing: unknown,
  incoming: unknown,
  kind: "message" | "toolCall" | "widget",
  existingMessageRunIds: Map<string, string>,
  incomingMessageRunIds: Map<string, string>,
  promptRunIds: Map<string, string>,
): unknown[] | undefined {
  if (!Array.isArray(existing) && !Array.isArray(incoming)) return undefined;
  const merged = Array.isArray(existing) ? [...existing] : [];
  const positions = new Map<string, number>();
  const assistantTextPositions = new Map<string, number[]>();
  merged.forEach((entry, index) => {
    const id = snapshotEntryId(entry, kind);
    if (id && !positions.has(id)) positions.set(id, index);
    if (kind === "message") {
      const key = snapshotAssistantTextKey(entry, existingMessageRunIds);
      if (key) {
        assistantTextPositions.set(key, [
          ...(assistantTextPositions.get(key) ?? []),
          index,
        ]);
      }
    }
  });
  const matchedAssistantTextPositions = new Set<number>();
  for (const entry of Array.isArray(incoming) ? incoming : []) {
    const id = snapshotEntryId(entry, kind);
    const idIndex = id ? positions.get(id) : undefined;
    const textKey =
      kind === "message"
        ? snapshotAssistantTextKey(entry, incomingMessageRunIds)
        : undefined;
    const textIndex =
      idIndex === undefined && textKey
        ? assistantTextPositions
            .get(textKey)
            ?.find((candidate) => !matchedAssistantTextPositions.has(candidate))
        : undefined;
    const index = idIndex ?? textIndex;
    if (index === undefined) {
      if (id) positions.set(id, merged.length);
      merged.push(entry);
    } else {
      if (kind === "message") matchedAssistantTextPositions.add(index);
      if (id && idIndex === undefined) positions.set(id, index);
      const preferIncoming = preferIncomingSnapshotEntry(
        kind,
        merged[index],
        entry,
      );
      const preferCurrentMessageId =
        kind === "message" &&
        textIndex !== undefined &&
        !preferIncomingSnapshotEntry(kind, entry, merged[index]);
      if (preferIncoming || preferCurrentMessageId) {
        merged[index] = entry;
      }
    }
  }
  if (kind !== "message") return merged;
  const runAt = replyRunIdAt(
    merged,
    [incomingMessageRunIds, existingMessageRunIds],
    promptRunIds,
  );
  return merged.filter(
    (_entry, index) => !isSupersededInFlightReply(merged, index, runAt),
  );
}

/** Prompt id to the run it was submitted to, from the stored user messages. */
function submittedPromptRunIds(...lists: unknown[]): Map<string, string> {
  const runs = new Map<string, string>();
  for (const list of lists) {
    for (const entry of Array.isArray(list) ? list : []) {
      const message = getStoredMessage(entry);
      const id = messageId(message);
      const runId = message?.metadata?.custom?.submittedRunId;
      if (message?.role === "user" && id && typeof runId === "string") {
        runs.set(id, runId);
      }
    }
  }
  return runs;
}

/**
 * The run behind each reply: its own metadata, else the AgentKit events, else
 * the prompt's submitted run when it is the prompt's first reply. Compacted
 * events drop the link for a reply saved mid-stream, so the prompt is often
 * the only record left.
 */
function replyRunIdAt(
  entries: unknown[],
  eventRunIds: Map<string, string>[],
  promptRunIds: Map<string, string>,
): (index: number) => string | undefined {
  return (index) => {
    const message = getStoredMessage(entries[index]);
    const id = messageId(message);
    const recorded =
      getMessageRunId(message) ??
      (id ? eventRunIds.find((runs) => runs.has(id))?.get(id) : undefined);
    if (recorded) return recorded;
    for (let i = index - 1; i >= 0; i--) {
      const earlier = getStoredMessage(entries[i]);
      if (earlier?.role === "assistant") return undefined;
      if (earlier?.role === "user") {
        const prompt = messageId(earlier);
        return prompt ? promptRunIds.get(prompt) : undefined;
      }
    }
    return undefined;
  };
}

function storedMessageText(message: any): string {
  return messageText(message?.content ?? message?.parts);
}

function isInFlightReply(message: any): boolean {
  return (
    message?.role === "assistant" &&
    (message.status === "streaming" || message.status?.type === "running")
  );
}

/**
 * A reloaded page replays an unfinished run from its first event under a new
 * message id, so the reply it saved mid-stream reaches storage beside the
 * replay. That partial gives way only to a finished reply to the same prompt
 * from the same run whose text extends it, and only while no other run is
 * still answering that prompt. Without a known run on both sides, both stay.
 */
function isSupersededInFlightReply(
  entries: unknown[],
  index: number,
  runAt: (index: number) => string | undefined,
): boolean {
  const message = getStoredMessage(entries[index]);
  if (!isInFlightReply(message)) return false;
  const runId = runAt(index);
  if (!runId) return false;
  let start = index;
  while (start > 0 && getStoredMessage(entries[start - 1])?.role !== "user") {
    start--;
  }
  if (start === 0) return false;
  const text = storedMessageText(message);
  let finishedPast = false;
  for (let other = start; other < entries.length; other++) {
    const reply = getStoredMessage(entries[other]);
    if (reply?.role === "user") break;
    if (other === index || reply?.role !== "assistant") continue;
    const otherRunId = runAt(other);
    if (isInFlightReply(reply) && otherRunId !== runId) return false;
    const replyText = storedMessageText(reply);
    if (
      (reply.status === "complete" || reply.status?.type === "complete") &&
      otherRunId === runId &&
      replyText.length > text.length &&
      replyText.startsWith(text)
    ) {
      finishedPast = true;
    }
  }
  return finishedPast;
}

function latestSnapshotRun(runs: unknown): AgentRunSnapshot | undefined {
  if (!Array.isArray(runs)) return undefined;
  return runs.reduce<AgentRunSnapshot | undefined>((latest, run) => {
    if (typeof run?.id !== "string") return latest;
    if (!latest) return run;
    const latestTime = latest.startedAt ?? latest.completedAt;
    const runTime = run.startedAt ?? run.completedAt;
    return latestTime && runTime && runTime < latestTime ? latest : run;
  }, undefined);
}

function isTerminalRunStatus(status: unknown): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}

function latestStoredUser(repo: any): any {
  return repo?.messages
    ?.map((entry: any) => getStoredMessage(entry))
    .findLast((message: any) => message?.role === "user");
}

function clearThreadSuggestions(repo: any): any {
  return repo.agentKit
    ? { ...repo, agentKit: { ...repo.agentKit, suggestions: [] } }
    : repo;
}

export type ThreadSuggestionRun = Pick<
  ActiveRun,
  | "runId"
  | "threadId"
  | "turnId"
  | "startedAt"
  | "status"
  | "events"
  | "abortReason"
>;

export function foldThreadRunSuggestions(
  repo: any,
  run: ThreadSuggestionRun,
): any {
  const user = latestStoredUser(repo);
  const userContext = user?.metadata?.custom;
  if (
    userContext?.submittedTurnId
      ? userContext.submittedTurnId !== run.turnId
      : userContext?.submittedRunId !== run.runId &&
        user?.createdAt &&
        new Date(user.createdAt).getTime() > run.startedAt
  ) {
    return repo;
  }
  const previous = repo.agentKit ?? {};
  const latest = latestSnapshotRun(previous.runs);
  const startedAt = new Date(run.startedAt).toISOString();
  if (latest?.startedAt && latest.startedAt > startedAt) return repo;

  const terminal = run.events.at(-1)?.event;
  const awaitingApproval = run.events.some(
    ({ event }) => event.type === "approval_required",
  );
  const awaitingConnection = run.events.some(
    ({ event }) => event.type === "connection_required",
  );
  const status: AgentRunSnapshot["status"] =
    run.status === "truncated" ||
    terminal?.type === "auto_continue" ||
    isContinuationTerminalReason(run.abortReason)
      ? "failed"
      : run.status === "aborted" ||
          run.abortReason ||
          (terminal?.type === "done" && terminal.reason === "user")
        ? "cancelled"
        : run.status === "errored"
          ? "failed"
          : awaitingApproval
            ? "awaiting_approval"
            : awaitingConnection
              ? "awaiting_input"
              : run.status === "completed" && terminal?.type === "done"
                ? "completed"
                : "failed";
  const published = [...run.events]
    .reverse()
    .find(({ event }) => event.type === "suggestions")?.event;
  let suggestions: Extract<
    typeof published,
    { type: "suggestions" }
  >["suggestions"] = [];
  if (status === "completed" && published?.type === "suggestions") {
    const candidates = published.suggestions.map((suggestion) =>
      parseAgentSuggestion(suggestion),
    );
    const parsed = parseFollowUpSuggestions({
      suggestions: candidates.map(({ label, prompt }) => ({
        label,
        prompt: prompt ?? label,
      })),
    });
    if (
      !parsed.success ||
      candidates.some((suggestion) => suggestion.runId !== run.runId) ||
      new Set(candidates.map((suggestion) => suggestion.id)).size !==
        candidates.length
    ) {
      throw new TypeError("Invalid canonical follow-up suggestions.");
    }
    suggestions = candidates;
  }
  const runs: AgentRunSnapshot[] = Array.isArray(previous.runs)
    ? previous.runs
    : [];
  const oldRun = runs.find((entry) => entry.id === run.runId);
  const previousSequence =
    oldRun &&
    Number.isSafeInteger(oldRun.lastSequence) &&
    oldRun.lastSequence >= 0
      ? oldRun.lastSequence
      : 0;
  const lastSequence = run.events.reduce(
    (maximum, { seq }) =>
      Number.isSafeInteger(seq) && seq >= 0 ? Math.max(maximum, seq) : maximum,
    previousSequence,
  );
  const snapshot: AgentRunSnapshot = {
    ...oldRun,
    id: run.runId,
    threadId: run.threadId,
    status,
    startedAt,
    lastSequence,
  };
  return {
    ...repo,
    agentKit: {
      ...previous,
      runs: [...runs.filter((entry) => entry.id !== run.runId), snapshot],
      activeRunIds: (previous.activeRunIds ?? []).filter(
        (id: string) => id !== run.runId,
      ),
      suggestions,
    },
  };
}

function mergeAgentKitEvents(
  existing: unknown,
  incoming: unknown,
  replacedRunIds: ReadonlySet<string> = new Set(),
  staleRunIds: ReadonlySet<string> = new Set(),
): unknown[] | undefined {
  if (!Array.isArray(existing) && !Array.isArray(incoming)) return undefined;
  const incomingEvents = Array.isArray(incoming)
    ? incoming.filter(
        (event) =>
          typeof event?.runId !== "string" || !staleRunIds.has(event.runId),
      )
    : [];
  const merged = Array.isArray(existing)
    ? existing.filter(
        (event) =>
          typeof event?.runId !== "string" || !replacedRunIds.has(event.runId),
      )
    : [];
  const positions = new Map<string, number>();
  merged.forEach((event, index) => {
    if (typeof event?.id === "string" && !positions.has(event.id)) {
      positions.set(event.id, index);
    }
  });
  for (const event of incomingEvents) {
    if (typeof event?.id !== "string") {
      merged.push(event);
      continue;
    }
    const index = positions.get(event.id);
    if (index === undefined) {
      positions.set(event.id, merged.length);
      merged.push(event);
    } else {
      merged[index] = event;
    }
  }

  const positionsByRun = new Map<string, number[]>();
  merged.forEach((event, index) => {
    if (typeof event?.runId !== "string") return;
    const runPositions = positionsByRun.get(event.runId) ?? [];
    runPositions.push(index);
    positionsByRun.set(event.runId, runPositions);
  });
  for (const runPositions of positionsByRun.values()) {
    const runEvents = runPositions.map((index, order) => ({
      event: merged[index],
      index,
      order,
      sequence:
        typeof merged[index]?.sequence === "number" &&
        Number.isFinite(merged[index].sequence)
          ? merged[index].sequence
          : Number.NaN,
    }));
    runEvents.sort((left, right) => {
      if (
        Number.isFinite(left.sequence) &&
        Number.isFinite(right.sequence) &&
        left.sequence !== right.sequence
      ) {
        return left.sequence - right.sequence;
      }
      return left.order - right.order;
    });
    runPositions.forEach((index, order) => {
      merged[index] = { ...runEvents[order].event, sequence: order + 1 };
    });
  }
  return merged;
}

function mergeAgentKitFullEventSnapshot(
  existingEvents: unknown,
  incomingEvents: unknown,
  incomingRuns: unknown,
  committedSnapshots: unknown,
): unknown[] | undefined {
  if (!Array.isArray(incomingEvents)) return undefined;
  const previousEvents = Array.isArray(existingEvents) ? existingEvents : [];
  const incomingRunSequences = new Map<string, number>();
  for (const run of Array.isArray(incomingRuns) ? incomingRuns : []) {
    if (
      typeof run?.id === "string" &&
      typeof run.lastSequence === "number" &&
      Number.isSafeInteger(run.lastSequence) &&
      run.lastSequence >= 0
    ) {
      incomingRunSequences.set(run.id, run.lastSequence);
    }
  }
  const existingEventsByRun = new Map<string, unknown[]>();
  for (const event of previousEvents) {
    if (typeof event?.runId !== "string") continue;
    const events = existingEventsByRun.get(event.runId) ?? [];
    events.push(event);
    existingEventsByRun.set(event.runId, events);
  }
  const incomingEventsByRun = new Map<string, unknown[]>();
  for (const event of incomingEvents) {
    if (typeof event?.runId !== "string") continue;
    const events = incomingEventsByRun.get(event.runId) ?? [];
    events.push(event);
    incomingEventsByRun.set(event.runId, events);
  }

  const protectedRunIds = new Set<string>();
  if (
    committedSnapshots &&
    typeof committedSnapshots === "object" &&
    !Array.isArray(committedSnapshots)
  ) {
    for (const [runId, value] of Object.entries(committedSnapshots)) {
      if (!Array.isArray(value)) continue;
      const committedSequence = value.reduce((maxSequence, entry) => {
        const sequence = entry?.lastSequence;
        return typeof sequence === "number" &&
          Number.isSafeInteger(sequence) &&
          sequence >= 0
          ? Math.max(maxSequence, sequence)
          : maxSequence;
      }, -1);
      if (committedSequence < 0) continue;
      const runEvents = incomingEventsByRun.get(runId) ?? [];
      const incomingSequence = Math.max(
        incomingRunSequences.get(runId) ?? 0,
        ...runEvents.map((event) => {
          const sequence =
            event && typeof event === "object"
              ? (event as Record<string, unknown>).sequence
              : undefined;
          return typeof sequence === "number" &&
            Number.isSafeInteger(sequence) &&
            sequence >= 0
            ? sequence
            : 0;
        }),
      );
      if (runEvents.length === 0 || incomingSequence <= committedSequence) {
        protectedRunIds.add(runId);
      }
    }
  }
  if (protectedRunIds.size === 0) return incomingEvents;

  const merged: unknown[] = [];
  const insertedProtectedRuns = new Set<string>();
  for (const event of incomingEvents) {
    const runId = event?.runId;
    if (typeof runId === "string" && protectedRunIds.has(runId)) {
      if (!insertedProtectedRuns.has(runId)) {
        merged.push(...(existingEventsByRun.get(runId) ?? []));
        insertedProtectedRuns.add(runId);
      }
      continue;
    }
    merged.push(event);
  }
  for (const runId of protectedRunIds) {
    if (insertedProtectedRuns.has(runId)) continue;
    merged.push(...(existingEventsByRun.get(runId) ?? []));
  }
  return merged;
}

type AgentKitEventRunSnapshotBatch = {
  runId: string;
  snapshotId: string;
  lastSequence: number;
  expectedEventCount: number;
  complete: boolean;
};

type PendingAgentKitEventRunSnapshot = Pick<
  AgentKitEventRunSnapshotBatch,
  "lastSequence" | "expectedEventCount"
> & { events: unknown[] };

type CommittedAgentKitEventRunSnapshot = Pick<
  AgentKitEventRunSnapshotBatch,
  "snapshotId" | "lastSequence" | "expectedEventCount"
>;

const MAX_PENDING_EVENT_RUN_SNAPSHOTS_PER_RUN = 2;
const MAX_COMMITTED_EVENT_RUN_SNAPSHOTS_PER_RUN = 8;

function mergeAgentKitEventRunSnapshots(input: {
  existingEvents: unknown;
  incomingEvents: unknown;
  existingWatermarks: Map<string, number>;
  existingRunSequences: Map<string, number>;
  incomingWatermarks: Map<string, number>;
  incomingReplacements: Map<string, number>;
  batches: Map<string, AgentKitEventRunSnapshotBatch>;
  existingPending: unknown;
  existingCommits: unknown;
}): {
  events: unknown[] | undefined;
  watermarks: Map<string, number>;
  pending: Record<string, Record<string, PendingAgentKitEventRunSnapshot>>;
  commits: Record<string, CommittedAgentKitEventRunSnapshot[]>;
} {
  const incomingEvents = Array.isArray(input.incomingEvents)
    ? input.incomingEvents
    : [];
  const batchedRunIds = new Set(input.batches.keys());
  const unbatchedEvents = Array.isArray(input.incomingEvents)
    ? incomingEvents.filter((event) => !batchedRunIds.has(event?.runId))
    : undefined;
  const previousEvents = Array.isArray(input.existingEvents)
    ? input.existingEvents
    : [];
  const commits: Record<string, CommittedAgentKitEventRunSnapshot[]> = {};
  if (
    input.existingCommits &&
    typeof input.existingCommits === "object" &&
    !Array.isArray(input.existingCommits)
  ) {
    for (const [runId, value] of Object.entries(input.existingCommits)) {
      if (!Array.isArray(value)) continue;
      const entries = value.flatMap((candidate) => {
        if (!candidate || typeof candidate !== "object") return [];
        const commit = candidate as Record<string, unknown>;
        if (
          typeof commit.snapshotId !== "string" ||
          typeof commit.lastSequence !== "number" ||
          !Number.isSafeInteger(commit.lastSequence) ||
          commit.lastSequence < 0 ||
          typeof commit.expectedEventCount !== "number" ||
          !Number.isSafeInteger(commit.expectedEventCount) ||
          commit.expectedEventCount < 1
        ) {
          return [];
        }
        return [
          {
            snapshotId: commit.snapshotId,
            lastSequence: commit.lastSequence,
            expectedEventCount: commit.expectedEventCount,
          },
        ];
      });
      if (entries.length > 0) {
        commits[runId] = entries.slice(
          -MAX_COMMITTED_EVENT_RUN_SNAPSHOTS_PER_RUN,
        );
      }
    }
  }
  const watermarks = new Map(input.existingWatermarks);
  const replacedRunIds = new Set<string>();
  const staleRunIds = new Set<string>();

  for (const [runId, lastSequence] of input.incomingWatermarks) {
    const storedWatermark = watermarks.get(runId);
    const storedRunSequence = input.existingRunSequences.get(runId);
    const hasCommittedSnapshot = (commits[runId]?.length ?? 0) > 0;
    const committedSequence = Math.max(
      0,
      ...(commits[runId] ?? []).map((entry) => entry.lastSequence),
    );
    const knownSequence = Math.max(
      storedWatermark ?? 0,
      storedRunSequence ?? 0,
      committedSequence,
    );
    const hasKnownSequence =
      storedWatermark !== undefined ||
      storedRunSequence !== undefined ||
      hasCommittedSnapshot;
    const hasStoredEvents = previousEvents.some(
      (event) => event?.runId === runId,
    );
    if (
      (hasKnownSequence && lastSequence < knownSequence) ||
      (hasCommittedSnapshot && lastSequence <= committedSequence)
    ) {
      staleRunIds.add(runId);
      continue;
    }
    if (
      input.incomingReplacements.has(runId) &&
      (hasKnownSequence || !hasStoredEvents)
    ) {
      replacedRunIds.add(runId);
    }
    watermarks.set(runId, Math.max(knownSequence, lastSequence));
  }

  let events = mergeAgentKitEvents(
    input.existingEvents,
    unbatchedEvents,
    replacedRunIds,
    staleRunIds,
  );
  const pending: Record<
    string,
    Record<string, PendingAgentKitEventRunSnapshot>
  > = {};
  if (
    input.existingPending &&
    typeof input.existingPending === "object" &&
    !Array.isArray(input.existingPending)
  ) {
    for (const [runId, value] of Object.entries(input.existingPending)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        continue;
      }
      const batches: Record<string, PendingAgentKitEventRunSnapshot> = {};
      for (const [snapshotId, candidate] of Object.entries(value)) {
        if (!candidate || typeof candidate !== "object") continue;
        const candidateRecord = candidate as Record<string, unknown>;
        if (
          Array.isArray(candidate) ||
          typeof candidateRecord.lastSequence !== "number" ||
          !Number.isSafeInteger(candidateRecord.lastSequence) ||
          candidateRecord.lastSequence < 0 ||
          typeof candidateRecord.expectedEventCount !== "number" ||
          !Number.isSafeInteger(candidateRecord.expectedEventCount) ||
          candidateRecord.expectedEventCount < 1 ||
          !Array.isArray(candidateRecord.events)
        ) {
          continue;
        }
        batches[snapshotId] = {
          lastSequence: candidateRecord.lastSequence,
          expectedEventCount: candidateRecord.expectedEventCount,
          events: candidateRecord.events.filter(
            (event) => event?.runId === runId,
          ),
        };
      }
      if (Object.keys(batches).length > 0) pending[runId] = batches;
    }
  }
  for (const [runId, batches] of Object.entries(pending)) {
    const committedSequence = Math.max(
      watermarks.get(runId) ?? 0,
      input.existingRunSequences.get(runId) ?? 0,
    );
    if (!watermarks.has(runId) && !input.existingRunSequences.has(runId)) {
      continue;
    }
    for (const [snapshotId, batch] of Object.entries(batches)) {
      const supersededByLegacySnapshot =
        (input.incomingWatermarks.get(runId) ?? -1) >= batch.lastSequence;
      if (
        batch.lastSequence < committedSequence ||
        supersededByLegacySnapshot
      ) {
        delete batches[snapshotId];
      }
    }
    if (Object.keys(batches).length === 0) delete pending[runId];
  }

  for (const [runId, batch] of input.batches) {
    const committed = commits[runId]?.find(
      (entry) => entry.snapshotId === batch.snapshotId,
    );
    if (committed) {
      if (
        committed.lastSequence !== batch.lastSequence ||
        committed.expectedEventCount !== batch.expectedEventCount
      ) {
        throw new TypeError("Agent chat event snapshot id was reused.");
      }
      continue;
    }

    const knownSequence = Math.max(
      watermarks.get(runId) ?? 0,
      input.existingRunSequences.get(runId) ?? 0,
    );
    const hasKnownSequence =
      watermarks.has(runId) || input.existingRunSequences.has(runId);
    const alreadyCommittedAtOrAfter = (commits[runId] ?? []).some(
      (entry) => entry.lastSequence >= batch.lastSequence,
    );
    if (
      hasKnownSequence &&
      (batch.lastSequence < knownSequence || alreadyCommittedAtOrAfter)
    ) {
      if (pending[runId]) {
        delete pending[runId][batch.snapshotId];
        if (Object.keys(pending[runId]).length === 0) delete pending[runId];
      }
      continue;
    }

    const current = pending[runId]?.[batch.snapshotId];
    const matchingCurrent =
      current?.lastSequence === batch.lastSequence &&
      current.expectedEventCount === batch.expectedEventCount;
    const batchEvents = incomingEvents.filter(
      (event) => event?.runId === runId,
    );
    const stagedEvents =
      mergeAgentKitEvents(matchingCurrent ? current.events : [], batchEvents) ??
      [];

    if (stagedEvents.length > batch.expectedEventCount) {
      throw new TypeError(
        "Agent chat event snapshot exceeded its event count.",
      );
    }
    if (batch.complete && stagedEvents.length < batch.expectedEventCount) {
      throw new TypeError(
        "Agent chat event snapshot ended before all events arrived.",
      );
    }

    if (stagedEvents.length === batch.expectedEventCount) {
      events = mergeAgentKitEvents(events, stagedEvents, new Set([runId]));
      watermarks.set(runId, Math.max(knownSequence, batch.lastSequence));
      commits[runId] = [
        ...(commits[runId] ?? []).filter(
          (entry) => entry.snapshotId !== batch.snapshotId,
        ),
        {
          snapshotId: batch.snapshotId,
          lastSequence: batch.lastSequence,
          expectedEventCount: batch.expectedEventCount,
        },
      ].slice(-MAX_COMMITTED_EVENT_RUN_SNAPSHOTS_PER_RUN);
      if (pending[runId]) {
        for (const [snapshotId, pendingBatch] of Object.entries(
          pending[runId],
        )) {
          if (pendingBatch.lastSequence <= batch.lastSequence) {
            delete pending[runId][snapshotId];
          }
        }
        if (Object.keys(pending[runId]).length === 0) delete pending[runId];
      }
      continue;
    }

    const runPending = { ...(pending[runId] ?? {}) };
    if (!matchingCurrent) {
      while (
        Object.keys(runPending).length >=
        MAX_PENDING_EVENT_RUN_SNAPSHOTS_PER_RUN
      ) {
        const oldestSnapshotId = Object.keys(runPending)[0];
        if (oldestSnapshotId === undefined) break;
        delete runPending[oldestSnapshotId];
      }
    }
    runPending[batch.snapshotId] = {
      lastSequence: batch.lastSequence,
      expectedEventCount: batch.expectedEventCount,
      events: stagedEvents,
    };
    pending[runId] = runPending;
  }

  return { events, watermarks, pending, commits };
}

function mergeAgentKitAnnotations(
  existing: unknown,
  incoming: unknown,
  replaceMessageIds: ReadonlySet<string>,
  removalValuesByMessage: ReadonlyMap<string, ReadonlyMap<string, string>>,
  conditionalUpserts?: unknown,
  onConflict?: (conflict: ThreadAnnotationSnapshotConflict) => void,
): unknown[] | undefined {
  if (!Array.isArray(existing) && !Array.isArray(incoming)) return undefined;
  const annotationKey = (entry: any) => {
    const id = entry?.annotation?.id;
    return typeof id === "string"
      ? JSON.stringify(["id", id])
      : JSON.stringify(["value", entry]);
  };
  const merged = (Array.isArray(existing) ? existing : []).filter((entry) => {
    const messageId = entry?.messageId;
    if (replaceMessageIds.has(messageId)) return false;
    const removalValues = removalValuesByMessage.get(messageId);
    const baseline = removalValues?.get(annotationKey(entry));
    if (baseline === undefined) return true;
    if (JSON.stringify(entry) === baseline) return false;
    if (typeof messageId === "string") {
      const annotationId = entry?.annotation?.id;
      onConflict?.({
        messageId,
        ...(typeof annotationId === "string" ? { annotationId } : {}),
        operation: "remove",
      });
    }
    return true;
  });
  const positions = new Map<string, number>();
  merged.forEach((entry, index) => {
    if (typeof entry?.messageId !== "string") return;
    const key = JSON.stringify([entry.messageId, annotationKey(entry)]);
    if (!positions.has(key)) positions.set(key, index);
  });
  if (Array.isArray(conditionalUpserts)) {
    for (const update of conditionalUpserts) {
      if (
        !update ||
        typeof update !== "object" ||
        !update.entry ||
        typeof update.entry !== "object" ||
        Array.isArray(update.entry) ||
        (update.baseline !== null &&
          (!update.baseline ||
            typeof update.baseline !== "object" ||
            Array.isArray(update.baseline)))
      ) {
        continue;
      }
      const entry = update.entry;
      if (typeof entry.messageId !== "string") {
        merged.push(entry);
        continue;
      }
      const key = JSON.stringify([entry.messageId, annotationKey(entry)]);
      const index = positions.get(key);
      if (index === undefined) {
        if (update.baseline === null) {
          positions.set(key, merged.length);
          merged.push(entry);
        } else {
          const annotationId = entry.annotation?.id;
          onConflict?.({
            messageId: entry.messageId,
            ...(typeof annotationId === "string" ? { annotationId } : {}),
            operation: "upsert",
          });
        }
        continue;
      }
      if (JSON.stringify(merged[index]) === JSON.stringify(entry)) continue;
      if (
        update.baseline !== null &&
        JSON.stringify(merged[index]) === JSON.stringify(update.baseline)
      ) {
        merged[index] = entry;
      } else {
        const annotationId = entry.annotation?.id;
        onConflict?.({
          messageId: entry.messageId,
          ...(typeof annotationId === "string" ? { annotationId } : {}),
          operation: "upsert",
        });
      }
    }
  } else
    for (const entry of Array.isArray(incoming) ? incoming : []) {
      if (typeof entry?.messageId !== "string") {
        merged.push(entry);
        continue;
      }
      const key = JSON.stringify([entry.messageId, annotationKey(entry)]);
      const index = positions.get(key);
      if (index === undefined) {
        positions.set(key, merged.length);
        merged.push(entry);
      } else {
        merged[index] = entry;
      }
    }
  return merged;
}

function mergeAgentKitHistory(
  existing: unknown,
  incoming: unknown,
  promptRunIds: Map<string, string>,
  onAnnotationConflict?: (conflict: ThreadAnnotationSnapshotConflict) => void,
): unknown {
  const incomingIsRecord =
    incoming !== null &&
    typeof incoming === "object" &&
    !Array.isArray(incoming);
  if (!incomingIsRecord) return incoming ?? existing;
  const next = incoming as Record<string, unknown>;
  const existingIsRecord =
    existing !== null &&
    typeof existing === "object" &&
    !Array.isArray(existing);
  const snapshotDelta = next._snapshotDelta === true;
  const incomingEventRunIds = new Set(
    (Array.isArray(next.events) ? next.events : []).flatMap((event) =>
      typeof event?.runId === "string" ? [event.runId] : [],
    ),
  );
  const incomingRunStarts = new Set(
    (Array.isArray(next.events) ? next.events : []).flatMap((event) =>
      typeof event?.runId === "string" && event.sequence === 1
        ? [event.runId]
        : [],
    ),
  );
  const eventRunSnapshotBatches = new Map<
    string,
    AgentKitEventRunSnapshotBatch
  >();
  for (const batch of Array.isArray(next.eventRunSnapshotBatches)
    ? next.eventRunSnapshotBatches
    : []) {
    if (
      typeof batch?.runId === "string" &&
      typeof batch.snapshotId === "string" &&
      batch.snapshotId.length > 0 &&
      typeof batch.lastSequence === "number" &&
      Number.isSafeInteger(batch.lastSequence) &&
      batch.lastSequence >= 0 &&
      typeof batch.expectedEventCount === "number" &&
      Number.isSafeInteger(batch.expectedEventCount) &&
      batch.expectedEventCount > 0 &&
      typeof batch.complete === "boolean" &&
      incomingEventRunIds.has(batch.runId)
    ) {
      eventRunSnapshotBatches.set(batch.runId, {
        runId: batch.runId,
        snapshotId: batch.snapshotId,
        lastSequence: batch.lastSequence,
        expectedEventCount: batch.expectedEventCount,
        complete: batch.complete,
      });
    }
  }
  const eventRunSnapshotWatermarks = new Map<string, number>();
  for (const watermark of Array.isArray(next.eventRunSnapshotWatermarks)
    ? next.eventRunSnapshotWatermarks
    : []) {
    if (
      typeof watermark?.runId === "string" &&
      typeof watermark.lastSequence === "number" &&
      Number.isSafeInteger(watermark.lastSequence) &&
      watermark.lastSequence >= 0 &&
      incomingEventRunIds.has(watermark.runId) &&
      !eventRunSnapshotBatches.has(watermark.runId)
    ) {
      eventRunSnapshotWatermarks.set(
        watermark.runId,
        Math.max(
          eventRunSnapshotWatermarks.get(watermark.runId) ?? 0,
          watermark.lastSequence,
        ),
      );
    }
  }
  const eventRunReplacements = new Map<string, number>();
  for (const replacement of Array.isArray(next.eventRunReplacements)
    ? next.eventRunReplacements
    : []) {
    if (
      typeof replacement?.runId === "string" &&
      typeof replacement.lastSequence === "number" &&
      Number.isSafeInteger(replacement.lastSequence) &&
      replacement.lastSequence >= 1 &&
      incomingRunStarts.has(replacement.runId) &&
      !eventRunSnapshotBatches.has(replacement.runId)
    ) {
      eventRunReplacements.set(
        replacement.runId,
        Math.max(
          eventRunReplacements.get(replacement.runId) ?? 0,
          replacement.lastSequence,
        ),
      );
    }
  }
  for (const [runId, lastSequence] of eventRunReplacements) {
    eventRunSnapshotWatermarks.set(
      runId,
      Math.max(eventRunSnapshotWatermarks.get(runId) ?? 0, lastSequence),
    );
  }
  const annotationMessageIdsToReplace = new Set<string>();
  const annotationRemovalValuesByMessage = new Map<
    string,
    Map<string, string>
  >();
  for (const replacement of Array.isArray(next.annotationMessageIdsToReplace)
    ? next.annotationMessageIdsToReplace
    : []) {
    if (typeof replacement === "string") {
      annotationMessageIdsToReplace.add(replacement);
      continue;
    }
    if (
      !replacement ||
      typeof replacement !== "object" ||
      typeof replacement.messageId !== "string" ||
      !Array.isArray(replacement.annotationsToRemove)
    ) {
      continue;
    }
    const removalValues = new Map<string, string>();
    for (const removal of replacement.annotationsToRemove) {
      if (
        !removal ||
        typeof removal !== "object" ||
        typeof removal.key !== "string" ||
        !removal.baseline ||
        typeof removal.baseline !== "object" ||
        Array.isArray(removal.baseline)
      ) {
        continue;
      }
      const baseline = JSON.stringify(removal.baseline);
      if (typeof baseline === "string") {
        removalValues.set(removal.key, baseline);
      }
    }
    if (removalValues.size > 0) {
      annotationRemovalValuesByMessage.set(
        replacement.messageId,
        removalValues,
      );
    }
  }
  if (!existingIsRecord) {
    const initial = { ...next };
    delete initial._eventRunWatermarks;
    if (snapshotDelta) {
      if (Array.isArray(initial.messages) && initial.messages.length === 0) {
        delete initial.messages;
      }
      const eventSnapshot = mergeAgentKitEventRunSnapshots({
        existingEvents: undefined,
        incomingEvents: next.events,
        existingWatermarks: new Map(),
        existingRunSequences: new Map(),
        incomingWatermarks: eventRunSnapshotWatermarks,
        incomingReplacements: eventRunReplacements,
        batches: eventRunSnapshotBatches,
        existingPending: undefined,
        existingCommits: undefined,
      });
      if (eventSnapshot.events) initial.events = eventSnapshot.events;
      if (eventSnapshot.watermarks.size > 0) {
        initial._eventRunWatermarks = Object.fromEntries(
          eventSnapshot.watermarks,
        );
      }
      if (Object.keys(eventSnapshot.pending).length > 0) {
        initial._pendingEventRunSnapshots = eventSnapshot.pending;
      } else {
        delete initial._pendingEventRunSnapshots;
      }
      if (Object.keys(eventSnapshot.commits).length > 0) {
        initial._eventRunSnapshotCommits = eventSnapshot.commits;
      } else {
        delete initial._eventRunSnapshotCommits;
      }
      const annotations = mergeAgentKitAnnotations(
        undefined,
        next.annotations,
        annotationMessageIdsToReplace,
        annotationRemovalValuesByMessage,
        next.annotationUpserts,
        onAnnotationConflict,
      );
      if (annotations) initial.annotations = annotations;
    }
    delete initial._snapshotDelta;
    delete initial.eventRunReplacements;
    delete initial.eventRunSnapshotWatermarks;
    delete initial.eventRunSnapshotBatches;
    delete initial.annotationMessageIdsToReplace;
    delete initial.annotationUpserts;
    return initial;
  }
  const previous = existing as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...previous, ...next };
  const runs = new Map<string, AgentRunSnapshot>();
  for (const run of [
    ...(Array.isArray(next.runs) ? next.runs : []),
    ...(Array.isArray(previous.runs) ? previous.runs : []),
  ]) {
    if (typeof run?.id !== "string") continue;
    const newer = runs.get(run.id);
    if (!newer) {
      runs.set(run.id, run);
      continue;
    }
    const richer = newer.lastSequence >= run.lastSequence ? newer : run;
    const statusRun =
      run.lastSequence > newer.lastSequence
        ? run
        : newer.lastSequence > run.lastSequence
          ? newer
          : isTerminalRunStatus(run.status)
            ? run
            : newer;
    runs.set(run.id, {
      ...run,
      ...newer,
      ...richer,
      metadata: { ...run.metadata, ...newer.metadata, ...richer.metadata },
      lastSequence: Math.max(newer.lastSequence, run.lastSequence),
      status: statusRun.status,
    });
  }
  if (runs.size > 0) {
    merged.runs = [...runs.values()];
    const latest = latestSnapshotRun(merged.runs);
    const incomingLatest = latestSnapshotRun(next.runs);
    const previousLatest = latestSnapshotRun(previous.runs);
    const incomingLatestCompleted = incomingLatest?.status === "completed";
    const incomingLatestIsMergedLatest =
      incomingLatest?.id === latest?.id && incomingLatestCompleted;
    const newLatestRunCompletion =
      incomingLatestIsMergedLatest && latest?.id !== previousLatest?.id;
    const latestRunJustCompleted =
      incomingLatestIsMergedLatest &&
      incomingLatest !== undefined &&
      latest !== undefined &&
      previousLatest !== undefined &&
      previousLatest.id === latest.id &&
      previousLatest.status !== "completed" &&
      Number.isSafeInteger(incomingLatest.lastSequence) &&
      incomingLatest.lastSequence >= 0 &&
      Number.isSafeInteger(previousLatest.lastSequence) &&
      previousLatest.lastSequence >= 0 &&
      incomingLatest.lastSequence >= previousLatest.lastSequence;
    const sameCompletedRunAdvanced =
      incomingLatestIsMergedLatest &&
      incomingLatest !== undefined &&
      latest !== undefined &&
      previousLatest !== undefined &&
      incomingLatest.id === latest.id &&
      previousLatest.id === latest.id &&
      previousLatest.status === "completed" &&
      Number.isSafeInteger(incomingLatest.lastSequence) &&
      incomingLatest.lastSequence >= 0 &&
      Number.isSafeInteger(previousLatest.lastSequence) &&
      previousLatest.lastSequence >= 0 &&
      incomingLatest.lastSequence > previousLatest.lastSequence;
    const incomingSuggestionsAreCurrent =
      Object.prototype.hasOwnProperty.call(next, "suggestions") &&
      (newLatestRunCompletion ||
        latestRunJustCompleted ||
        sameCompletedRunAdvanced);
    if (latest?.status !== "completed") {
      merged.suggestions = [];
    } else if (incomingSuggestionsAreCurrent) {
      merged.suggestions = next.suggestions;
    } else if (
      previousLatest !== undefined &&
      latest.id === previousLatest.id &&
      previousLatest.status === "completed"
    ) {
      if (Object.prototype.hasOwnProperty.call(previous, "suggestions")) {
        merged.suggestions = previous.suggestions;
      } else {
        delete merged.suggestions;
      }
    } else {
      merged.suggestions = [];
    }
    if (Array.isArray(merged.suggestions)) {
      merged.suggestions = merged.suggestions.filter(
        (suggestion: any) => suggestion?.runId === latest?.id,
      );
    }
    if (Array.isArray(merged.activeRunIds)) {
      merged.activeRunIds = merged.activeRunIds.filter(
        (id: string) =>
          !["completed", "failed", "cancelled"].includes(
            runs.get(id)?.status ?? "",
          ),
      );
    }
  }
  const existingMessageRunIds = snapshotMessageRunIds(previous);
  const incomingMessageRunIds = snapshotMessageRunIds(next);
  for (const [key, kind] of [
    ["messages", "message"],
    ["toolCalls", "toolCall"],
    ["widgets", "widget"],
  ] as const) {
    const entries = mergeAgentKitHistoryArray(
      previous[key],
      next[key],
      kind,
      existingMessageRunIds,
      incomingMessageRunIds,
      promptRunIds,
    );
    if (entries) merged[key] = entries;
  }
  if (
    snapshotDelta &&
    Array.isArray(next.messages) &&
    next.messages.length === 0 &&
    !Array.isArray(previous.messages)
  ) {
    delete merged.messages;
  }
  if (snapshotDelta) {
    const previousWatermarks = new Map<string, number>();
    const previousWatermarkRecord = previous._eventRunWatermarks;
    if (
      previousWatermarkRecord &&
      typeof previousWatermarkRecord === "object" &&
      !Array.isArray(previousWatermarkRecord)
    ) {
      for (const [runId, value] of Object.entries(previousWatermarkRecord)) {
        if (
          typeof value === "number" &&
          Number.isSafeInteger(value) &&
          value >= 0
        ) {
          previousWatermarks.set(runId, value);
        }
      }
    }
    const previousRunSequences = new Map<string, number>();
    for (const run of Array.isArray(previous.runs) ? previous.runs : []) {
      if (
        typeof run?.id === "string" &&
        typeof run.lastSequence === "number" &&
        Number.isSafeInteger(run.lastSequence) &&
        run.lastSequence >= 0
      ) {
        previousRunSequences.set(run.id, run.lastSequence);
      }
    }
    const eventSnapshot = mergeAgentKitEventRunSnapshots({
      existingEvents: previous.events,
      incomingEvents: next.events,
      existingWatermarks: previousWatermarks,
      existingRunSequences: previousRunSequences,
      incomingWatermarks: eventRunSnapshotWatermarks,
      incomingReplacements: eventRunReplacements,
      batches: eventRunSnapshotBatches,
      existingPending: previous._pendingEventRunSnapshots,
      existingCommits: previous._eventRunSnapshotCommits,
    });
    if (eventSnapshot.events) merged.events = eventSnapshot.events;
    delete merged._eventRunWatermarks;
    if (eventSnapshot.watermarks.size > 0) {
      merged._eventRunWatermarks = Object.fromEntries(eventSnapshot.watermarks);
    }
    if (Object.keys(eventSnapshot.pending).length > 0) {
      merged._pendingEventRunSnapshots = eventSnapshot.pending;
    } else {
      delete merged._pendingEventRunSnapshots;
    }
    if (Object.keys(eventSnapshot.commits).length > 0) {
      merged._eventRunSnapshotCommits = eventSnapshot.commits;
    } else {
      delete merged._eventRunSnapshotCommits;
    }
  } else {
    const events = mergeAgentKitFullEventSnapshot(
      previous.events,
      next.events,
      next.runs,
      previous._eventRunSnapshotCommits,
    );
    if (events) merged.events = events;
    if (previous._eventRunWatermarks === undefined) {
      delete merged._eventRunWatermarks;
    } else {
      merged._eventRunWatermarks = previous._eventRunWatermarks;
    }
  }
  delete merged._snapshotDelta;
  delete merged.eventRunReplacements;
  delete merged.eventRunSnapshotWatermarks;
  delete merged.eventRunSnapshotBatches;
  if (
    snapshotDelta ||
    annotationMessageIdsToReplace.size > 0 ||
    annotationRemovalValuesByMessage.size > 0
  ) {
    const annotations = mergeAgentKitAnnotations(
      previous.annotations,
      next.annotations,
      annotationMessageIdsToReplace,
      annotationRemovalValuesByMessage,
      next.annotationUpserts,
      onAnnotationConflict,
    );
    if (annotations) merged.annotations = annotations;
  } else if (Array.isArray(next.annotations)) {
    merged.annotations = next.annotations;
  }
  delete merged.annotationMessageIdsToReplace;
  delete merged.annotationUpserts;
  return merged;
}

function pruneClaimedQueuedMessages(repo: any): any {
  if (!Array.isArray(repo?.queuedMessages)) return repo;
  const claimed = new Set(claimedQueuedMessageIds(repo));
  if (claimed.size === 0) return repo;
  return {
    ...repo,
    queuedMessages: repo.queuedMessages.filter(
      (message: any) =>
        typeof message?.id !== "string" || !claimed.has(message.id),
    ),
  };
}

export function mergeThreadDataForClientSave(
  existingRepo: any,
  incomingRepo: any,
  options: MergeThreadDataOptions = {},
) {
  const preserveExistingQueuedMessages =
    options.preserveExistingQueuedMessages ?? true;
  const preserveExistingTopLevelKeys =
    options.preserveExistingTopLevelKeys ?? true;
  const existingNormalized = normalizeThreadRepository(existingRepo);
  const incomingNormalized = normalizeThreadRepository(incomingRepo);
  const merged =
    incomingNormalized && typeof incomingNormalized === "object"
      ? { ...incomingNormalized }
      : {};
  if (
    preserveExistingTopLevelKeys &&
    existingNormalized &&
    typeof existingNormalized === "object"
  ) {
    for (const [key, value] of Object.entries(existingNormalized)) {
      if (key === "messages" || key === "headId" || key === "queuedMessages") {
        continue;
      }
      if (!(key in merged)) {
        merged[key] = value;
      }
    }
  }
  // Queue mutations are the only writer of the queue and opt out here. Any
  // other save carries a queue it read earlier, and letting that copy win drops
  // a promotion claim or an append that landed in between.
  if (
    preserveExistingQueuedMessages &&
    existingNormalized?.queuedMessages !== undefined
  ) {
    merged.queuedMessages = existingNormalized.queuedMessages;
  }

  const promptRunIds = submittedPromptRunIds(
    existingNormalized?.messages,
    incomingNormalized?.messages,
  );
  if (merged.agentKit !== undefined) {
    merged.agentKit = mergeAgentKitHistory(
      existingNormalized?.agentKit,
      merged.agentKit,
      promptRunIds,
      options.onAnnotationConflict,
    );
  }

  const existingMessages = Array.isArray(existingNormalized?.messages)
    ? existingNormalized.messages
    : null;
  const incomingMessages = Array.isArray(merged.messages)
    ? merged.messages
    : null;
  if (!existingMessages || !incomingMessages) {
    return pruneClaimedQueuedMessages(merged);
  }

  // The chat UI saves its replies under AgentKit ids with no runId; only the
  // AgentKit events tie them to the run the server folded under its own id.
  const eventRunIds = snapshotMessageRunIds(merged.agentKit);
  const incomingKeySets: MessageIdentityKeySet[] = incomingMessages.map(
    (entry: unknown) =>
      messageIdentityKeySet(getStoredMessage(entry), eventRunIds),
  );
  const usedIncoming = new Set<number>();
  const nextMessages: any[] = [];
  const idRewrites = new Map<string, string>();

  // A message that keeps its own id owns the incoming copy with that id; a
  // run or turn match is weaker and must not take it from the message itself.
  const incomingByOwnId = new Map<number, number>();
  existingMessages.forEach((entry: unknown, existingIndex: number) => {
    const existingMessage = getStoredMessage(entry);
    const id = messageId(existingMessage);
    if (
      !id ||
      (existingMessage?.role === "assistant" &&
        messageContentIsEmpty(existingMessage.content))
    ) {
      return;
    }
    const incomingIndex = incomingKeySets.findIndex(
      (keys, index) =>
        !usedIncoming.has(index) && keys.strong.includes(`id:${id}`),
    );
    if (incomingIndex === -1) return;
    usedIncoming.add(incomingIndex);
    incomingByOwnId.set(existingIndex, incomingIndex);
  });

  for (
    let existingIndex = 0;
    existingIndex < existingMessages.length;
    existingIndex++
  ) {
    const existingEntry = existingMessages[existingIndex];
    const existingMessage = getStoredMessage(existingEntry);
    if (
      existingMessage?.role === "assistant" &&
      messageContentIsEmpty(existingMessage.content)
    ) {
      continue;
    }

    const existingKeys = messageIdentityKeySet(existingMessage, eventRunIds);
    const incomingIndex =
      incomingByOwnId.get(existingIndex) ??
      findRankedIdentityMatch(
        existingKeys,
        incomingKeySets,
        usedIncoming,
        existingIndex,
      );

    if (incomingIndex === -1) {
      nextMessages.push(existingEntry);
      continue;
    }

    usedIncoming.add(incomingIndex);
    const incomingEntry = incomingMessages[incomingIndex];
    const chosen = chooseMergedMessageEntry(existingEntry, incomingEntry);
    const existingId = messageId(getStoredMessage(existingEntry));
    const chosenId = messageId(getStoredMessage(chosen));
    if (existingId && chosenId && existingId !== chosenId) {
      idRewrites.set(existingId, chosenId);
    }
    nextMessages.push(chosen);
  }

  for (let index = 0; index < incomingMessages.length; index++) {
    if (usedIncoming.has(index)) continue;
    const incomingMessage = getStoredMessage(incomingMessages[index]);
    if (
      incomingMessage?.role === "assistant" &&
      messageContentIsEmpty(incomingMessage.content)
    ) {
      continue;
    }
    nextMessages.push(incomingMessages[index]);
  }

  // One reply per run: the server's folded reply carries the run in its
  // metadata, and the chat UI's own copy of it (saved under an AgentKit id,
  // tied to the run only by events) is dropped wherever both ended up stored.
  const serverReplyRuns = new Set<string>();
  for (const entry of nextMessages) {
    const message = getStoredMessage(entry);
    const runId =
      message?.role === "assistant" ? getMessageRunId(message) : null;
    if (runId) serverReplyRuns.add(runId);
  }
  const runAt = replyRunIdAt(
    nextMessages,
    [eventRunIds, snapshotMessageRunIds(existingNormalized?.agentKit)],
    promptRunIds,
  );
  const keptMessages = nextMessages.filter((entry, index) => {
    if (isSupersededInFlightReply(nextMessages, index, runAt)) return false;
    const message = getStoredMessage(entry);
    if (message?.role !== "assistant" || getMessageRunId(message)) return true;
    const runId =
      typeof message.id === "string" ? eventRunIds.get(message.id) : undefined;
    if (!runId || !serverReplyRuns.has(runId)) return true;
    const kept = nextMessages.find((candidate) => {
      const other = getStoredMessage(candidate);
      return other?.role === "assistant" && getMessageRunId(other) === runId;
    });
    const keptId = messageId(getStoredMessage(kept));
    const droppedId = messageId(message);
    if (keptId && droppedId) idRewrites.set(droppedId, keptId);
    return false;
  });

  merged.messages = keptMessages.map((entry) =>
    rewriteEntryParentId(entry, idRewrites),
  );
  const normalizedMerged = normalizeThreadRepository(
    pruneClaimedQueuedMessages(merged),
  );
  normalizedMerged.headId = chooseMergedHeadId(
    existingNormalized,
    incomingNormalized,
    normalizedMerged,
  );
  const previousUser = latestStoredUser(existingNormalized);
  const mergedUser = latestStoredUser(normalizedMerged);
  const previousUserId = messageId(previousUser);
  if (
    mergedUser &&
    messageId(mergedUser) !==
      (idRewrites.get(previousUserId ?? "") ?? previousUserId)
  ) {
    return clearThreadSuggestions(normalizedMerged);
  }
  return normalizedMerged;
}

function escapeAttachmentAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function unwrapTextAttachmentEnvelope(text: string): string {
  const match = text.match(
    /^<attachment\b[^>]*>\n?([\s\S]*?)\n?<\/attachment>$/,
  );
  return match ? match[1] : text;
}

function truncateStoredAttachment(text: string): string {
  const unwrapped = unwrapTextAttachmentEnvelope(text);
  if (unwrapped.length <= MAX_STORED_ATTACHMENT_CHARS) return unwrapped;
  const omitted = unwrapped.length - MAX_STORED_ATTACHMENT_CHARS;
  return `${unwrapped.slice(0, MAX_STORED_ATTACHMENT_CHARS)}\n\n[Attachment truncated after ${MAX_STORED_ATTACHMENT_CHARS.toLocaleString()} characters; ${omitted.toLocaleString()} characters omitted from persisted chat history.]`;
}

function textAttachmentEnvelope(
  att: AgentChatAttachment,
  text: string,
): string {
  const attrs = [
    `name="${escapeAttachmentAttribute(att.name || "attachment")}"`,
    att.contentType
      ? `contentType="${escapeAttachmentAttribute(att.contentType)}"`
      : null,
    att.type ? `type="${escapeAttachmentAttribute(att.type)}"` : null,
  ].filter(Boolean);
  return `<attachment ${attrs.join(" ")}>\n${truncateStoredAttachment(text)}\n</attachment>`;
}

function buildStoredAttachments(
  attachments: AgentChatAttachment[] | undefined,
  runId: string | undefined,
): any[] {
  return (attachments ?? [])
    .map((att, index) => {
      const id = `server-${runId ?? Date.now()}-attachment-${index}`;
      if (att.displayOnly === true) {
        return {
          id,
          type: att.type === "image" ? "image" : "file",
          name: att.name,
          contentType: att.contentType,
          status: { type: "complete" },
          content:
            typeof att.text === "string" && att.text.length > 0
              ? [{ type: "text", text: textAttachmentEnvelope(att, att.text) }]
              : [],
          metadata: { displayOnly: true },
        };
      }
      const uploadedUrl = (att as any).url as string | undefined;
      if (uploadedUrl) {
        const referenceOnly = (att as any).referenceOnly === true;
        const storedAsImage = att.type === "image" && !referenceOnly;
        return {
          id,
          type: storedAsImage ? "image" : "file",
          name: att.name,
          contentType: att.contentType,
          status: { type: "complete" },
          content: storedAsImage
            ? [{ type: "image", image: uploadedUrl }]
            : [
                {
                  type: "file",
                  url: uploadedUrl,
                  mimeType: att.contentType,
                  filename: att.name,
                },
              ],
          metadata: {
            uploadUrl: uploadedUrl,
            uploadProvider: (att as any).uploadProvider as string | undefined,
            ...(referenceOnly
              ? {
                  referenceOnly: true,
                  securityNote: (att as any).securityNote as string | undefined,
                }
              : {}),
          },
        };
      }

      if (typeof att.text === "string" && att.text.length > 0) {
        return {
          id,
          type: "file",
          name: att.name,
          contentType: att.contentType,
          status: { type: "complete" },
          content: [
            { type: "text", text: textAttachmentEnvelope(att, att.text) },
          ],
        };
      }

      if (att.storageRequired === true || typeof att.data === "string") {
        const uploadFailed = att.storageUploadFailed === true;
        return {
          id,
          type: att.type === "image" ? "image" : "file",
          name: att.name,
          contentType: att.contentType,
          status: { type: "complete" },
          content: [
            {
              type: "text",
              text: uploadFailed
                ? "Attachment not retained: the configured object-storage upload failed. Retry the upload to keep files available throughout this thread."
                : "Attachment not retained: connect object storage to keep files available throughout this thread.",
            },
          ],
          metadata: {
            storageRequired: true,
            ...(uploadFailed ? { storageUploadFailed: true } : {}),
          },
        };
      }
      return null;
    })
    .filter(Boolean);
}

export function buildUserMessage(opts: {
  text: string;
  attachments?: AgentChatAttachment[];
  runId?: string;
  turnId?: string;
  agentKitMessageId?: string;
  queuedMessageId?: string;
  createdAt?: Date;
  /** The turn was refused before a run started; its retry reads this back. */
  refusedRetry?: RefusedTurnRetryContext;
}): {
  id: string;
  createdAt: Date;
  role: "user";
  content: ContentPart[];
  attachments?: any[];
  metadata: Record<string, unknown>;
} {
  const attachments = buildStoredAttachments(opts.attachments, opts.runId);
  return {
    id: `server-user-${opts.runId ?? Date.now()}`,
    createdAt: opts.createdAt ?? new Date(),
    role: "user",
    content: [{ type: "text", text: opts.text }],
    ...(attachments.length > 0 ? { attachments } : {}),
    metadata: {
      ...opts.refusedRetry,
      custom: {
        submittedRunId: opts.runId,
        ...(opts.turnId ? { submittedTurnId: opts.turnId } : {}),
        ...(opts.agentKitMessageId
          ? { agentKitMessageId: opts.agentKitMessageId }
          : {}),
        ...(opts.queuedMessageId
          ? { agentNativeQueuedMessageId: opts.queuedMessageId }
          : {}),
        ...(opts.refusedRetry ? { [RUN_NOT_STARTED_METADATA_KEY]: true } : {}),
      },
    },
  };
}

function toCoreCodeAgentTranscriptEvent(
  event: CodeAgentThreadTranscriptEvent,
): CoreCodeAgentTranscriptEvent {
  return {
    schemaVersion: 1,
    id: event.id,
    runId: event.runId,
    kind: (event.kind ??
      event.type ??
      "status") as CoreCodeAgentTranscriptEvent["kind"],
    message: event.message ?? event.text ?? "",
    createdAt: event.createdAt,
    metadata: {
      ...(event.metadata ?? {}),
      ...(event.artifactPath ? { artifactPath: event.artifactPath } : {}),
      ...(event.artifactUrl ? { artifactUrl: event.artifactUrl } : {}),
    },
    ...(event.signal ? { signal: event.signal } : {}),
  };
}

function contentPartForCodeAgentTranscriptItem(
  item: NormalizedCodeAgentTranscriptItem,
  options: BuildRepositoryFromCodeAgentTranscriptOptions,
): ContentPart | null {
  if (item.type === "assistant") {
    return item.text.trim() ? { type: "text", text: item.text } : null;
  }
  if (item.type === "tool") {
    return toolContentPartForCodeAgentTranscriptItem(item);
  }
  if (item.type === "thinking") {
    return thinkingContentPartForCodeAgentTranscriptItem(item);
  }
  if (item.type === "status") {
    const text = statusTextForCodeAgentTranscriptItem(item, options);
    return text ? { type: "text", text } : null;
  }
  return null;
}

function thinkingContentPartForCodeAgentTranscriptItem(
  item: NormalizedCodeAgentThinkingEvent,
): ContentPart | null {
  const text = item.text.trim();
  return text ? { type: "reasoning", text } : null;
}

function toolContentPartForCodeAgentTranscriptItem(
  item: NormalizedCodeAgentToolEvent,
): ContentPart {
  return {
    type: "tool-call",
    toolCallId: `code-tool-${item.id}`,
    toolName: item.tool ?? item.label ?? "code-agent",
    argsText: previewCodeAgentTranscriptValue(item.input) ?? "",
    args: recordArgsForCodeAgentTool(item.input),
    ...(item.result !== undefined
      ? { result: previewCodeAgentTranscriptValue(item.result) ?? "" }
      : {}),
    ...(item.structuredMeta ? { structuredMeta: item.structuredMeta } : {}),
    ...(item.pendingApprovalKey
      ? { approval: { approvalKey: item.pendingApprovalKey } }
      : {}),
  };
}

function statusTextForCodeAgentTranscriptItem(
  item: NormalizedCodeAgentStatusEvent,
  options: BuildRepositoryFromCodeAgentTranscriptOptions,
): string | null {
  if (options.hideCredentialMessages && isCredentialGapCodeAgentEvent(item)) {
    return null;
  }
  if (item.statusKind === "artifact") {
    const event = item.events[0];
    const path =
      stringRecordValue(event?.metadata, "artifactPath") ??
      stringRecordValue(event?.metadata, "path");
    const url = stringRecordValue(event?.metadata, "artifactUrl");
    const target = url ?? path;
    return target
      ? `Artifact: ${item.text}\n${target}`
      : `Artifact: ${item.text}`;
  }
  if (item.level === "info" && item.statusKind !== "note") return null;
  return item.text;
}

function codeAgentAttachmentsFromEvents(
  events: readonly CoreCodeAgentTranscriptEvent[],
): AgentChatAttachment[] {
  for (const event of events) {
    const raw = event.metadata?.attachments;
    if (!Array.isArray(raw) || raw.length === 0) continue;
    const attachments: AgentChatAttachment[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const name = stringRecordValue(record, "name");
      if (!name) continue;
      const contentType = stringRecordValue(record, "type");
      const text = stringRecordValue(record, "text");
      const dataUrl = stringRecordValue(record, "dataUrl");
      attachments.push({
        type: dataUrl ? "image" : "file",
        name,
        ...(contentType ? { contentType } : {}),
        ...(text ? { text } : {}),
        ...(dataUrl ? { data: dataUrl } : {}),
      });
    }
    if (attachments.length > 0) return attachments;
  }
  return [];
}

function recordArgsForCodeAgentTool(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] =
      typeof entry === "string"
        ? entry
        : (previewCodeAgentTranscriptValue(entry) ?? "");
  }
  return result;
}

function previewCodeAgentTranscriptValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text =
    typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? "");
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return trimmed.length > 4000 ? `${trimmed.slice(0, 4000)}\n...` : trimmed;
}

function stringRecordValue(
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function upsertUserMessage(repo: any, userMsg: UserMessage): any {
  const nextRepo = clearThreadSuggestions(normalizeThreadRepository(repo));

  const lastIndex = nextRepo.messages.length - 1;
  const lastEntry = lastIndex >= 0 ? nextRepo.messages[lastIndex] : undefined;
  const lastMsg = getStoredMessage(lastEntry);
  if (lastMsg?.role === "user" && messagesMatch(lastMsg, userMsg)) {
    nextRepo.messages[lastIndex] = {
      ...lastEntry,
      message: {
        ...lastMsg,
        metadata: {
          ...lastMsg.metadata,
          custom: {
            ...lastMsg.metadata?.custom,
            ...(userMsg.metadata.custom as Record<string, unknown>),
          },
        },
      },
    };
    return nextRepo;
  }

  const parentId =
    typeof nextRepo.headId === "string"
      ? nextRepo.headId
      : lastIndex >= 0
        ? (messageId(getStoredMessage(lastEntry)) ?? null)
        : null;
  nextRepo.messages.push({ message: userMsg, parentId });
  nextRepo.headId = userMsg.id;
  return nextRepo;
}

function shouldReplaceLastAssistant(
  lastMessage: any,
  assistantMsg: AssistantMessage,
): boolean {
  const lastContent = lastMessage?.content;
  if (messageContentIsEmpty(lastContent)) return true;

  const lastRunId = getMessageRunId(lastMessage);
  const nextRunId = getMessageRunId(assistantMsg);
  if (lastRunId && nextRunId && lastRunId === nextRunId) return true;
  if (lastRunId && nextRunId && lastRunId !== nextRunId) return false;

  const lastStatus = lastMessage?.status;
  if (lastStatus && !isTerminalAssistantStatus(lastStatus)) return true;

  try {
    if (JSON.stringify(lastContent) === JSON.stringify(assistantMsg.content)) {
      return true;
    }
  } catch {
    // Fall through to the text-prefix check.
  }

  const lastText = messageText(lastContent).trim();
  const nextText = messageText(assistantMsg.content).trim();
  if (isTerminalAssistantStatus(lastStatus)) return false;
  return Boolean(lastText && nextText && nextText.startsWith(lastText));
}

export function upsertAssistantMessage(
  repo: any,
  assistantMsg: AssistantMessage,
  parentId?: string | null,
): any {
  const nextRepo = normalizeThreadRepository(repo);

  const lastIndex = nextRepo.messages.length - 1;
  const lastEntry = lastIndex >= 0 ? nextRepo.messages[lastIndex] : undefined;
  const lastMsg = getStoredMessage(lastEntry);
  const lastRole = lastMsg?.role;
  const lastParentId = lastEntry ? getStoredParentId(lastEntry) : undefined;

  if (
    lastRole === "assistant" &&
    (parentId === undefined || lastParentId === parentId) &&
    shouldReplaceLastAssistant(lastMsg, assistantMsg)
  ) {
    nextRepo.messages[lastIndex] = { ...lastEntry, message: assistantMsg };
    nextRepo.headId = assistantMsg.id;
    return nextRepo;
  }

  const fallbackParentId =
    typeof nextRepo.headId === "string"
      ? nextRepo.headId
      : nextRepo.messages.length > 0
        ? (messageId(
            getStoredMessage(nextRepo.messages[nextRepo.messages.length - 1]),
          ) ?? null)
        : null;
  const resolvedParentId =
    parentId === null ||
    (typeof parentId === "string" &&
      nextRepo.messages.some(
        (entry: any) => messageId(getStoredMessage(entry)) === parentId,
      ))
      ? parentId
      : fallbackParentId;
  nextRepo.messages.push({ message: assistantMsg, parentId: resolvedParentId });
  nextRepo.headId = assistantMsg.id;
  return nextRepo;
}

function turnIdOf(message: any): string | undefined {
  const t = message?.metadata?.custom?.turnId;
  return typeof t === "string" && t ? t : undefined;
}

function foldedRunIdsOf(message: any): string[] {
  const ids = message?.metadata?.custom?.foldedRunIds;
  return Array.isArray(ids)
    ? ids.filter((x: unknown): x is string => typeof x === "string")
    : [];
}

function assistantRunDurationMs(
  custom: Record<string, unknown>,
): number | null {
  const durationMs = custom[ASSISTANT_RUN_DURATION_METADATA_KEY];
  return typeof durationMs === "number" &&
    Number.isFinite(durationMs) &&
    durationMs >= 0
    ? durationMs
    : null;
}

function assistantContentWeight(content: unknown): number {
  if (!Array.isArray(content)) return 0;
  let weight = 0;
  for (const part of content) {
    if (part?.type === "text" && typeof part.text === "string") {
      weight += part.text.length;
    } else {
      weight += 1;
    }
  }
  return weight;
}

function appendFoldedContent(existing: any[], incoming: any[]): any[] {
  const merged = existing.map((p) => ({ ...p }));
  for (const part of incoming) {
    const last = merged[merged.length - 1];
    if (
      part?.type === "text" &&
      typeof part.text === "string" &&
      last?.type === "text" &&
      typeof last.text === "string"
    ) {
      last.text = `${last.text}${part.text}`;
    } else {
      merged.push({ ...part });
    }
  }
  return normalizeAssistantToolCallIds({
    role: "assistant",
    content: merged,
  }).content;
}

export function foldAssistantTurn(
  repo: any,
  assistantMsg: AssistantMessage,
  options: {
    turnId?: string;
    runId?: string;
    parentId?: string | null;
    agentKitOwnsContinuation?: boolean;
  },
): any {
  if (options.agentKitOwnsContinuation) return repo;
  const turnId = options.turnId;
  const runId = options.runId;
  if (!turnId)
    return upsertAssistantMessage(repo, assistantMsg, options.parentId);

  const nextRepo = normalizeThreadRepository(repo);
  const lastIndex = nextRepo.messages.length - 1;
  const lastEntry = lastIndex >= 0 ? nextRepo.messages[lastIndex] : undefined;
  const lastMsg = getStoredMessage(lastEntry);

  const sameTurn =
    lastMsg?.role === "assistant" &&
    (options.parentId === undefined ||
      getStoredParentId(lastEntry) === options.parentId) &&
    (turnIdOf(lastMsg) === turnId ||
      (!!runId && getMessageRunId(lastMsg) === runId));

  if (!sameTurn) {
    return upsertAssistantMessage(repo, assistantMsg, options.parentId);
  }

  const existingContent = Array.isArray(lastMsg.content) ? lastMsg.content : [];
  const incomingContent = Array.isArray(assistantMsg.content)
    ? assistantMsg.content
    : [];
  const existingFolded = foldedRunIdsOf(lastMsg);
  const runAlreadyFolded =
    !!runId &&
    (existingFolded.includes(runId) || getMessageRunId(lastMsg) === runId);

  const mergedContent = runAlreadyFolded
    ? assistantContentWeight(incomingContent) >
      assistantContentWeight(existingContent)
      ? incomingContent
      : existingContent
    : appendFoldedContent(existingContent, incomingContent);

  const mergedFolded = Array.from(
    new Set([...existingFolded, ...(runId ? [runId] : [])]),
  );

  const existingCustom =
    lastMsg.metadata?.custom && typeof lastMsg.metadata.custom === "object"
      ? (lastMsg.metadata.custom as Record<string, unknown>)
      : {};
  const incomingCustom =
    assistantMsg.metadata?.custom &&
    typeof assistantMsg.metadata.custom === "object"
      ? (assistantMsg.metadata.custom as Record<string, unknown>)
      : {};

  const mergedCustom: Record<string, unknown> = {
    ...existingCustom,
    ...incomingCustom,
    turnId,
    foldedRunIds: mergedFolded,
  };
  const existingDurationMs = assistantRunDurationMs(existingCustom);
  const incomingDurationMs = assistantRunDurationMs(incomingCustom);
  const mergedDurationMs = runAlreadyFolded
    ? existingDurationMs == null
      ? incomingDurationMs
      : incomingDurationMs == null
        ? existingDurationMs
        : Math.max(existingDurationMs, incomingDurationMs)
    : existingDurationMs == null && incomingDurationMs == null
      ? null
      : (existingDurationMs ?? 0) + (incomingDurationMs ?? 0);
  if (mergedDurationMs != null) {
    mergedCustom[ASSISTANT_RUN_DURATION_METADATA_KEY] = mergedDurationMs;
  }
  if (incomingCustom.continued !== true) delete mergedCustom.continued;

  const mergedMessage = {
    ...lastMsg,
    content: normalizeAssistantToolCallIds({
      role: "assistant",
      content: mergedContent,
    }).content,
    status: assistantMsg.status ?? lastMsg.status,
    metadata: {
      ...lastMsg.metadata,
      runId: runId ?? lastMsg.metadata?.runId,
      custom: mergedCustom,
    },
  };

  nextRepo.messages[lastIndex] = { ...lastEntry, message: mergedMessage };
  nextRepo.headId = mergedMessage.id ?? nextRepo.headId;
  return nextRepo;
}

export function foldAgentChatRunCompletion(
  repo: unknown,
  assistantMsg: Parameters<typeof foldAssistantTurn>[1] | null,
  run: ThreadSuggestionRun &
    Pick<
      ActiveRun,
      "runId" | "turnId" | "parentId" | "agentKitApprovalContinuation"
    >,
) {
  const folded = assistantMsg
    ? foldAssistantTurn(repo, assistantMsg, {
        runId: run.runId,
        turnId: run.turnId,
        parentId: run.parentId,
        agentKitOwnsContinuation: run.agentKitApprovalContinuation === true,
      })
    : repo;
  return foldThreadRunSuggestions(normalizeThreadRepository(folded), run);
}

/**
 * A turn the server refused before any run started (no usable model
 * credential, AI setup missing) still answers in the thread: a typed
 * assistant error in the durable history and a failed AgentKit run, keyed by
 * the turn id the client already uses as the run id, so the transcript shows
 * the failure card with a retry instead of an unanswered prompt.
 */
export function foldUnstartedTurnFailure(
  repo: any,
  failure: {
    runId: string;
    threadId: string;
    turnId?: string;
    code: string;
    message: string;
    at?: Date;
  },
): any {
  const assistant = buildAssistantMessage(
    [
      {
        seq: 0,
        event: {
          type: "error",
          error: failure.message,
          errorCode: failure.code,
        },
      },
    ],
    failure.runId,
    failure.turnId ? { turnId: failure.turnId } : {},
  );
  if (assistant) {
    assistant.metadata.custom = {
      ...(assistant.metadata.custom as Record<string, unknown> | undefined),
      [RUN_NOT_STARTED_METADATA_KEY]: true,
    };
  }
  const folded = assistant
    ? foldAssistantTurn(repo, assistant, {
        runId: failure.runId,
        turnId: failure.turnId,
      })
    : normalizeThreadRepository(repo);
  const at = (failure.at ?? new Date()).toISOString();
  const previous = folded.agentKit ?? {};
  const runs: AgentRunSnapshot[] = Array.isArray(previous.runs)
    ? previous.runs.filter(
        (run: AgentRunSnapshot | null) => run?.id !== failure.runId,
      )
    : [];
  return {
    ...folded,
    agentKit: {
      ...previous,
      runs: [
        ...runs,
        {
          id: failure.runId,
          threadId: failure.threadId,
          status: "failed",
          lastSequence: 0,
          startedAt: at,
          completedAt: at,
          error: {
            code: failure.code,
            message: failure.message,
            retryable: false,
          },
        } satisfies AgentRunSnapshot,
      ],
      activeRunIds: Array.isArray(previous.activeRunIds)
        ? previous.activeRunIds.filter((id: string) => id !== failure.runId)
        : [],
    },
  };
}

export function normalizeThreadTitle(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, 160);
}

export function extractThreadMeta(repo: any): {
  title: string;
  preview: string;
} {
  const titleOverride = normalizeThreadTitle(repo?._titleOverride);
  const msgs = repo?.messages;
  if (!Array.isArray(msgs) || msgs.length === 0)
    return { title: titleOverride, preview: "" };

  let title = "";
  let preview = "";
  for (const entry of msgs) {
    const msg = entry?.message ?? entry;
    if (msg.role !== "user") continue;
    const textParts = Array.isArray(msg.content)
      ? msg.content
          .filter((p: any) => p.type === "text")
          .map((p: any) => p.text)
          .join(" ")
      : typeof msg.content === "string"
        ? msg.content
        : "";
    if (textParts.trim()) {
      if (!title) title = textParts.trim().slice(0, 80);
      preview = textParts.trim().slice(0, 120);
    }
  }
  return { title: titleOverride || title, preview };
}
