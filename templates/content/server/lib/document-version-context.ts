import type { ActionRunContext } from "@agent-native/core/action";

export interface DocumentVersionChatContext {
  threadId?: string;
  runId?: string;
  turnId?: string;
}

function contextFromFields(value: {
  threadId?: unknown;
  runId?: unknown;
  turnId?: unknown;
}): DocumentVersionChatContext | undefined {
  const context: DocumentVersionChatContext = {};
  for (const key of ["threadId", "runId", "turnId"] as const) {
    if (typeof value[key] === "string" && value[key].trim()) {
      context[key] = value[key];
    }
  }
  return Object.keys(context).length > 0 ? context : undefined;
}

export function documentVersionChatContextFromAction(
  context?: ActionRunContext,
): DocumentVersionChatContext | undefined {
  if (
    !context ||
    (context.caller !== "tool" &&
      context.caller !== "mcp" &&
      context.caller !== "a2a")
  ) {
    return undefined;
  }
  return contextFromFields(context);
}

export function documentVersionChatContextFromRun(run: {
  threadId?: unknown;
  runId?: unknown;
  turnId?: unknown;
}): DocumentVersionChatContext | undefined {
  return contextFromFields(run);
}

export function serializeDocumentVersionChatContext(
  context: DocumentVersionChatContext | undefined,
): string | null {
  return context ? JSON.stringify(context) : null;
}

export function parseDocumentVersionChatContext(
  raw: string | null | undefined,
): DocumentVersionChatContext | undefined {
  if (raw == null) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Document version chat metadata is not valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Document version chat metadata is invalid.");
  }
  const context = contextFromFields(value as Record<string, unknown>);
  if (!context) throw new Error("Document version chat metadata is invalid.");
  return context;
}
