import {
  getDatabaseAuthToken,
  isLocalSqliteUrl,
  prepareLocalSqliteUrl,
  sqliteFilenameFromUrl,
} from "../../db/client.js";

export interface SqliteScriptResult {
  rows: any[];
  columns: string[];
  rowsAffected: number;
  lastInsertRowid?: bigint | number;
}

export interface SqliteScriptClient {
  execute(
    stmtOrSql: string | { sql: string; args?: any[] },
  ): Promise<SqliteScriptResult>;
  close(): void | Promise<void>;
}

function sqliteRowsToLibsqlShape(rows: unknown[]) {
  const records = rows as Record<string, unknown>[];
  const columns = records.length > 0 ? Object.keys(records[0]) : [];
  return {
    rows: records.map((row) => {
      const values = columns.map((column) => row[column]) as any[];
      return Object.assign(values, row);
    }),
    columns,
  };
}

export async function createSqliteScriptClient(
  url: string,
): Promise<SqliteScriptClient> {
  if (isLocalSqliteUrl(url)) {
    const sqliteUrl = await prepareLocalSqliteUrl(
      url.startsWith("file:") ? url : `file:${url}`,
    );
    const { default: Database } = await import("better-sqlite3");
    const sqlite = new Database(sqliteFilenameFromUrl(sqliteUrl));
    sqlite.pragma("busy_timeout = 10000");
    sqlite.pragma("journal_mode = WAL");

    return {
      async execute(stmtOrSql) {
        const sql = typeof stmtOrSql === "string" ? stmtOrSql : stmtOrSql.sql;
        const args =
          typeof stmtOrSql === "string" ? [] : (stmtOrSql.args ?? []);
        const stmt = sqlite.prepare(sql);
        if (stmt.reader) {
          return {
            ...sqliteRowsToLibsqlShape(stmt.all(...args)),
            rowsAffected: 0,
          };
        }
        const result = stmt.run(...args);
        return {
          rows: [],
          columns: [],
          rowsAffected: result.changes ?? 0,
          lastInsertRowid: result.lastInsertRowid,
        };
      },
      close() {
        sqlite.close();
      },
    };
  }

  const { createClient } = await import("@libsql/client/web");
  const client = createClient({
    url,
    authToken: getDatabaseAuthToken(),
  });
  return client as unknown as SqliteScriptClient;
}
