import { sql, type Column, type SQL } from "drizzle-orm";

export type CaseEntry<T> = { id: string; value: T };

/** `CASE <id> WHEN 'a' THEN … END` — writes a different value per row in one statement. */
export function caseById<T>(idColumn: Column, entries: CaseEntry<T>[]): SQL<T> {
  const whens = entries.map(
    (entry) => sql`when ${entry.id} then ${entry.value}`,
  );
  return sql`case ${idColumn} ${sql.join(whens, sql` `)} end`;
}

/**
 * An entry costs three bind parameters (id and value in the CASE, id again in
 * the IN list). Reorder and field cleanup rewrite every row an owner has, which
 * `BULK_ID_LIMIT` does not cap, so the work is chunked to stay under SQLite's
 * 999-parameter default.
 */
export const BULK_WRITE_CHUNK_SIZE = 200;

export function chunk<T>(
  items: T[],
  size: number = BULK_WRITE_CHUNK_SIZE,
): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
