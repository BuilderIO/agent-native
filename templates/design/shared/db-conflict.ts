export function isUniqueConstraintViolation(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  if (e?.code === "23505") return true;
  const msg = typeof e?.message === "string" ? e.message.toLowerCase() : "";
  return (
    msg.includes("unique constraint") ||
    msg.includes("primary key constraint") ||
    msg.includes("duplicate key")
  );
}
