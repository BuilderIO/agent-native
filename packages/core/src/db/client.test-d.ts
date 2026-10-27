import type { DbExec, DbExecStatement } from "./client.js";
import { sql } from "./sql.js";

declare const statement: DbExecStatement;
declare const database: DbExec;

function acceptsMutableArgs(args: unknown[]): void {
  void args;
}

if (typeof statement !== "string") {
  acceptsMutableArgs(statement.args ?? []);
}

void database.execute(sql`SELECT ${sql.value("value")}`);
