import { callAction } from "@agent-native/core/client/hooks";

export interface CommentAiConversationTurn {
  turnId: string;
  userText: string | null;
  assistantText: string | null;
  status: "complete" | "incomplete";
}

type StoredMessage = {
  role?: unknown;
  content?: unknown;
  status?: { type?: unknown };
  metadata?: {
    custom?: {
      turnId?: unknown;
      submittedTurnId?: unknown;
      agentNativeQueuedMessageId?: unknown;
    };
  };
};

function storedMessage(entry: unknown): StoredMessage | null {
  if (!entry || typeof entry !== "object") return null;
  const record = entry as { message?: unknown };
  const value = record.message ?? entry;
  return value && typeof value === "object" ? (value as StoredMessage) : null;
}

function messageText(message: StoredMessage): string | null {
  if (typeof message.content === "string")
    return message.content.trim() || null;
  if (!Array.isArray(message.content)) return null;
  const text = message.content
    .filter(
      (part): part is { type: "text"; text: string } =>
        !!part &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string",
    )
    .map((part) => part.text)
    .join("")
    .trim();
  return text || null;
}

export function parseCommentAiConversation(
  threadData: string,
  initialTurnId: string,
  receiptTurnIds: readonly string[] = [],
): CommentAiConversationTurn[] {
  let parsed: { messages?: unknown };
  try {
    parsed = JSON.parse(threadData) as { messages?: unknown };
  } catch {
    throw new Error("The AI conversation could not be read");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray(parsed.messages)
  ) {
    throw new Error("The AI conversation could not be read");
  }

  const turns = new Map<string, CommentAiConversationTurn>();
  for (const entry of parsed.messages) {
    const message = storedMessage(entry);
    if (!message) continue;
    const role = message.role;
    const custom = message.metadata?.custom;
    const turnId =
      role === "assistant"
        ? custom?.turnId
        : (custom?.submittedTurnId ?? custom?.agentNativeQueuedMessageId);
    if (role !== "user" && role !== "assistant") continue;
    if (typeof turnId !== "string" || !turnId) {
      if (messageText(message))
        throw new Error("The AI conversation could not be read");
      continue;
    }
    const current = turns.get(turnId) ?? {
      turnId,
      userText: null,
      assistantText: null,
      status: "complete" as const,
    };
    const text = messageText(message);
    if (role === "user") current.userText = text;
    if (role === "assistant") {
      current.assistantText = text;
      current.status =
        message.status?.type === "incomplete" ? "incomplete" : "complete";
    }
    turns.set(turnId, current);
  }
  const conversation = [...turns.values()];
  if (!initialTurnId) return conversation;
  const initialIndex = conversation.findIndex(
    (turn) => turn.turnId === initialTurnId,
  );
  if (initialIndex < 0)
    throw new Error("The AI conversation could not be read");
  const excluded = new Set([initialTurnId, ...receiptTurnIds]);
  return conversation.filter((turn) => !excluded.has(turn.turnId));
}

export async function loadCommentAiConversation(options: {
  agentThreadId: string;
  initialTurnId: string;
  operationId: string;
  signal?: AbortSignal;
}): Promise<CommentAiConversationTurn[]> {
  const thread = await callAction<{
    threadData?: unknown;
    receiptTurnIds?: unknown;
  }>(
    "get-comment-ai-conversation",
    { requestId: options.operationId },
    { method: "GET", signal: options.signal },
  );
  if (typeof thread.threadData !== "string") {
    throw new Error("The AI conversation could not be read");
  }
  if (
    !Array.isArray(thread.receiptTurnIds) ||
    !thread.receiptTurnIds.every((id) => typeof id === "string")
  ) {
    throw new Error("The AI conversation could not be read");
  }
  return parseCommentAiConversation(
    thread.threadData,
    options.initialTurnId,
    thread.receiptTurnIds,
  );
}
