import { agentNativePath } from "@agent-native/core/client/api-path";

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
): CommentAiConversationTurn[] {
  let parsed: { messages?: unknown };
  try {
    parsed = JSON.parse(threadData) as { messages?: unknown };
  } catch {
    throw new Error("The AI conversation could not be read");
  }
  if (!Array.isArray(parsed.messages)) return [];

  const turns = new Map<string, CommentAiConversationTurn>();
  for (const entry of parsed.messages) {
    const message = storedMessage(entry);
    if (!message) continue;
    const role = message.role;
    const custom = message.metadata?.custom;
    const turnId =
      role === "assistant"
        ? custom?.turnId
        : custom?.agentNativeQueuedMessageId;
    if (typeof turnId !== "string" || !turnId || turnId === initialTurnId)
      continue;
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
  return [...turns.values()];
}

export async function loadCommentAiConversation(options: {
  agentThreadId: string;
  initialTurnId: string;
  operationId: string;
  signal?: AbortSignal;
}): Promise<CommentAiConversationTurn[]> {
  const params = new URLSearchParams({
    scopeType: "content-comment-ai",
    scopeId: options.operationId,
  });
  const response = await fetch(
    `${agentNativePath("/_agent-native/agent-chat/threads")}/${encodeURIComponent(options.agentThreadId)}?${params}`,
    { credentials: "same-origin", cache: "no-store", signal: options.signal },
  );
  if (response.status === 404) {
    throw new Error("This AI conversation is no longer available");
  }
  if (!response.ok) {
    throw new Error("The AI conversation could not be loaded");
  }
  const thread = (await response.json()) as { threadData?: unknown };
  if (typeof thread.threadData !== "string") {
    throw new Error("The AI conversation could not be read");
  }
  return parseCommentAiConversation(thread.threadData, options.initialTurnId);
}
