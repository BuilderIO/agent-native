import { sql, type SqlFragment } from "../db/sql.js";

/**
 * A resource path's name: the path without leading "/". Uploads used to store
 * "/notes.md" beside a created "notes.md", so rows spelled with a leading "/"
 * still exist. The entry points that make a name store this form.
 */
export function canonicalResourcePath(path: string): string {
  return path.replace(/^\/+/, "");
}

/**
 * True where `column` holds any spelling of one of `paths`' names: "notes.md",
 * "/notes.md", "//notes.md". Only claiming a name uses it (create-if-absent,
 * the free-name search, a move, a restore onto an empty path). Reads, writes
 * and deletes by path match the stored path exactly, so an older pair of
 * spellings stays two files.
 */
export function resourcePathNamedSql(
  column: SqlFragment,
  paths: readonly string[],
): SqlFragment {
  const names = [...new Set(paths.map(canonicalResourcePath))];
  return sql`(${column} IN ${sql.in(names.flatMap((name) => [name, `/${name}`]))} OR (${column} LIKE '//%' AND ltrim(${column}, '/') IN ${sql.in(names)}))`;
}
