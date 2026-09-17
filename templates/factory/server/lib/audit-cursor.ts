export type AuditCursor = {
  startedAt: number;
  id: string;
};

export function encodeAuditCursor(cursor: AuditCursor): string {
  return Buffer.from(
    JSON.stringify({ startedAt: cursor.startedAt, id: cursor.id }),
    "utf8",
  ).toString("base64url");
}

export function decodeAuditCursor(value: string): AuditCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new Error("Audit cursor is unreadable.");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as { startedAt?: unknown }).startedAt !== "number" ||
    !Number.isFinite((parsed as AuditCursor).startedAt) ||
    typeof (parsed as { id?: unknown }).id !== "string" ||
    !(parsed as AuditCursor).id
  ) {
    throw new Error("Audit cursor is unreadable.");
  }
  return {
    startedAt: (parsed as AuditCursor).startedAt,
    id: (parsed as AuditCursor).id,
  };
}

/** True when `run` sorts after `cursor` in startedAt DESC, id ASC tie-break. */
export function isAuditRunAfterCursor(
  run: { startedAt: number; id: string },
  cursor: AuditCursor,
): boolean {
  if (run.startedAt < cursor.startedAt) return true;
  if (run.startedAt > cursor.startedAt) return false;
  return run.id.localeCompare(cursor.id) > 0;
}
