/**
 * True when `err` is a UNIQUE / PRIMARY KEY constraint violation from either
 * supported driver (Postgres 23505, SQLite SQLITE_CONSTRAINT_UNIQUE /
 * _PRIMARYKEY). Shared by any action that inserts a row guarded by a
 * best-effort unique index and needs to recover from a losing race instead of
 * failing outright — see `design_files_design_filename_unique_idx` in
 * `server/plugins/db.ts` for the index this is meant to catch a conflict
 * against, and `add-localhost-screens.ts` / `present-design-variants.ts` for
 * the adopt-the-winning-row recovery pattern built on top of this check.
 */
export function isUniqueConstraintViolation(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  if (e?.code === "23505") return true;
  const code = String(e?.code ?? "");
  if (
    code === "SQLITE_CONSTRAINT_PRIMARYKEY" ||
    code === "SQLITE_CONSTRAINT_UNIQUE"
  ) {
    return true;
  }
  const msg = String(e?.message ?? "").toLowerCase();
  return (
    msg.includes("unique constraint") ||
    msg.includes("primary key constraint") ||
    msg.includes("duplicate key")
  );
}
