/**
 * Pure reducer that folds wire events into the visible turn state. One
 * assistant message accumulates per turn; text/reasoning deltas append to
 * parts (respecting partId groupings) and tool events update tool-call parts
 * in place. Ported from the web runtime's mapAgentNativeEvent projection.
 */

import type {
  ChatContentPart,
  ChatMessage,
  ChatTurnState,
  WireEvent,
} from "./types";

let idCounter = 0;
export function nextLocalId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

export function initialTurnState(): ChatTurnState {
  return {
    messages: [],
    activity: null,
    isStreaming: false,
    error: null,
    errorCode: null,
    runId: null,
  };
}

function lastAssistantMessage(
  state: ChatTurnState,
  assistantId: string,
): ChatMessage | null {
  const last = state.messages[state.messages.length - 1];
  return last && last.id === assistantId ? last : null;
}

function withUpdatedAssistant(
  state: ChatTurnState,
  assistantId: string,
  update: (parts: ChatContentPart[]) => ChatContentPart[],
): ChatTurnState {
  const existing = lastAssistantMessage(state, assistantId);
  if (existing) {
    const updated: ChatMessage = { ...existing, parts: update(existing.parts) };
    return {
      ...state,
      messages: [...state.messages.slice(0, -1), updated],
    };
  }
  const created: ChatMessage = {
    id: assistantId,
    role: "assistant",
    parts: update([]),
    createdAt: Date.now(),
  };
  return { ...state, messages: [...state.messages, created] };
}

function appendDelta(
  parts: ChatContentPart[],
  kind: "text" | "reasoning",
  text: string,
  partId: string | undefined,
): ChatContentPart[] {
  const index = partId
    ? parts.findIndex((p) => p.type === kind && p.partId === partId)
    : ((): number => {
        const last = parts[parts.length - 1];
        return last && last.type === kind && !last.partId
          ? parts.length - 1
          : -1;
      })();

  if (index >= 0) {
    const part = parts[index] as Extract<
      ChatContentPart,
      { type: "text" | "reasoning" }
    >;
    const next = [...parts];
    next[index] = { ...part, text: part.text + text };
    return next;
  }
  return [...parts, { type: kind, text, ...(partId ? { partId } : {}) }];
}

function updateToolPart(
  parts: ChatContentPart[],
  toolCallId: string,
  update: (
    part: Extract<ChatContentPart, { type: "tool-call" }>,
  ) => Extract<ChatContentPart, { type: "tool-call" }>,
): ChatContentPart[] {
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (part.type === "tool-call" && part.toolCallId === toolCallId) {
      const next = [...parts];
      next[i] = update(part);
      return next;
    }
  }
  return parts;
}

function stringifyResult(result: unknown): string | undefined {
  if (result === undefined) return undefined;
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result);
  } catch {
    return "[unserializable result]";
  }
}

/** Close any tool calls left running when a turn errors out or completes. */
function settleRunningTools(parts: ChatContentPart[]): ChatContentPart[] {
  return parts.map((part) =>
    part.type === "tool-call" && part.status === "running"
      ? { ...part, status: "failed" as const, error: "Interrupted" }
      : part,
  );
}

/**
 * User-initiated stop: leave partial text in place, mark still-running tools
 * as cancelled (not failed — no error styling), and end the streaming state.
 */
export function cancelTurnState(
  state: ChatTurnState,
  assistantId: string,
): ChatTurnState {
  // Don't create an empty assistant message when nothing streamed yet.
  const settled = lastAssistantMessage(state, assistantId)
    ? withUpdatedAssistant(state, assistantId, (parts) =>
        parts.map((part) =>
          part.type === "tool-call" && part.status === "running"
            ? { ...part, status: "cancelled" as const }
            : part,
        ),
      )
    : state;
  return { ...settled, isStreaming: false, activity: null };
}

export function applyWireEvent(
  state: ChatTurnState,
  event: WireEvent,
  assistantId: string,
): ChatTurnState {
  switch (event.type) {
    case "text":
    case "thinking":
    case "reasoning": {
      const kind = event.type === "text" ? "text" : "reasoning";
      const next = withUpdatedAssistant(state, assistantId, (parts) =>
        appendDelta(parts, kind, event.text ?? "", event.partId),
      );
      return { ...next, activity: null };
    }
    case "activity":
      return { ...state, activity: event.label ?? event.tool ?? "Working" };
    case "tool_start": {
      const part: ChatContentPart = {
        type: "tool-call",
        toolCallId: event.id ?? nextLocalId("tool"),
        toolName: event.tool ?? "tool",
        inputText: event.input !== undefined ? JSON.stringify(event.input) : "",
        status: "running",
      };
      const next = withUpdatedAssistant(state, assistantId, (parts) => [
        ...parts,
        part,
      ]);
      return { ...next, activity: null };
    }
    case "tool_done":
      return withUpdatedAssistant(state, assistantId, (parts) =>
        updateToolPart(parts, event.id ?? "", (part) => ({
          ...part,
          status: event.error ? "failed" : "completed",
          resultText: stringifyResult(event.result),
          error: event.error,
        })),
      );
    case "approval_required": {
      const approvalKey = event.approvalKey ?? event.id ?? "";
      const withExisting = withUpdatedAssistant(state, assistantId, (parts) => {
        const updated = event.id
          ? updateToolPart(parts, event.id, (part) => ({
              ...part,
              status: "awaiting-approval",
              approvalKey,
            }))
          : parts;
        if (updated !== parts || event.id) return updated;
        return [
          ...parts,
          {
            type: "tool-call",
            toolCallId: approvalKey,
            toolName: event.tool ?? "tool",
            inputText:
              event.input !== undefined ? JSON.stringify(event.input) : "",
            status: "awaiting-approval",
            approvalKey,
          },
        ];
      });
      return { ...withExisting, activity: event.label ?? state.activity };
    }
    case "error":
    case "missing_api_key": {
      const settled = withUpdatedAssistant(state, assistantId, (parts) =>
        settleRunningTools(parts),
      );
      return {
        ...settled,
        isStreaming: false,
        activity: null,
        error: event.error ?? "Agent chat failed.",
        errorCode:
          event.errorCode ??
          (event.type === "missing_api_key" ? "missing_api_key" : null),
      };
    }
    case "done":
      return { ...state, isStreaming: false, activity: null };
    default:
      return state;
  }
}
