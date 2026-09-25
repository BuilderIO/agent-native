export type AssistantChatHistoryDate = string | number | Date;

export interface AssistantChatHistoryVersion {
  id: string;
  createdAt: AssistantChatHistoryDate;
  editable?: boolean;
  chatContext?: { threadId?: string; runId?: string; turnId?: string };
}

export function coerceAssistantChatHistoryDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

export function isAssistantChatHistoryVersion(
  value: unknown,
): value is AssistantChatHistoryVersion {
  if (!value || typeof value !== "object") return false;
  const version = value as { id?: unknown; createdAt?: unknown };
  return (
    typeof version.id === "string" &&
    version.id.trim().length > 0 &&
    coerceAssistantChatHistoryDate(version.createdAt) !== null
  );
}
