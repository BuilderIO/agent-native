export type InboxCursor = {
  updatedAt: string;
  id: string;
};

export function encodeInboxCursor(cursor: InboxCursor): string {
  return Buffer.from(
    JSON.stringify({ updatedAt: cursor.updatedAt, id: cursor.id }),
    "utf8",
  ).toString("base64url");
}

export function decodeInboxCursor(value: string): InboxCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new Error("Inbox cursor is unreadable.");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as { updatedAt?: unknown }).updatedAt !== "string" ||
    typeof (parsed as { id?: unknown }).id !== "string" ||
    !(parsed as InboxCursor).updatedAt ||
    !(parsed as InboxCursor).id
  ) {
    throw new Error("Inbox cursor is unreadable.");
  }
  return {
    updatedAt: (parsed as InboxCursor).updatedAt,
    id: (parsed as InboxCursor).id,
  };
}
