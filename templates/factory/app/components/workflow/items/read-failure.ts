import type { ItemsStrings } from "../items-strings";

type ReadFailureKind = keyof ItemsStrings["error"]["title"];

export interface ReadFailure {
  kind: ReadFailureKind;
  /** The typed code the action sent, when it sent one. */
  code: string | null;
  status: number | null;
  /** What the server said, as authored by the action. */
  message: string | null;
}

const TYPED_CODES = new Set<string>([
  "workflow_not_found",
  "workflow_item_not_found",
  "workflow_node_not_found",
  "factory_not_found",
  "bad_cursor",
  "stored_record_unreadable",
]);

/**
 * Sorts a failed read into the states the views have words for. A typed code
 * the action sent wins. A 404 or 405 with no code means the route itself is
 * not there (an action this server does not have), which is its own state and
 * never an empty list.
 */
export function classifyReadError(error: unknown): ReadFailure {
  const fields = (error ?? {}) as {
    errorCode?: unknown;
    status?: unknown;
    actionMessage?: unknown;
    message?: unknown;
  };
  const code = typeof fields.errorCode === "string" ? fields.errorCode : null;
  const status = typeof fields.status === "number" ? fields.status : null;
  const message =
    typeof fields.actionMessage === "string" && fields.actionMessage
      ? fields.actionMessage
      : typeof fields.message === "string" && fields.message
        ? fields.message
        : null;
  if (code !== null && TYPED_CODES.has(code)) {
    return { kind: code as ReadFailureKind, code, status, message };
  }
  if (code === null && (status === 404 || status === 405)) {
    return { kind: "action_unavailable", code, status, message };
  }
  return { kind: "generic", code, status, message };
}
