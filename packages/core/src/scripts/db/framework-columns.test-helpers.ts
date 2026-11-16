import { SCHEMA_SNAPSHOT } from "../../db/schema-snapshot.generated.js";

const CREATE_TABLE = /^CREATE TABLE "([^"]+)" \(/;
const COLUMN = /^ {2}"([^"]+)" /gm;

/** `CREATE TABLE` statement and column names of every framework table. */
export function frameworkTables(): Map<
  string,
  { createSql: string; columns: string[] }
> {
  const tables = new Map<string, { createSql: string; columns: string[] }>();
  for (const statement of SCHEMA_SNAPSHOT.statements) {
    const name = CREATE_TABLE.exec(statement)?.[1];
    if (!name) continue;
    const columns = [...statement.matchAll(COLUMN)].flatMap((match) =>
      match[1] ? [match[1]] : [],
    );
    tables.set(name, { createSql: statement, columns });
  }
  return tables;
}

/** The rows `information_schema.columns` would report for the given tables. */
export function frameworkColumnRows(
  names?: Iterable<string>,
): Array<{ table_name: string; column_name: string }> {
  const wanted = names ? new Set(names) : null;
  const rows: Array<{ table_name: string; column_name: string }> = [];
  for (const [table, { columns }] of frameworkTables()) {
    if (wanted && !wanted.has(table)) continue;
    for (const column of columns) {
      rows.push({ table_name: table, column_name: column });
    }
  }
  return rows;
}
