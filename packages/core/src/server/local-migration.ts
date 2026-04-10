/**
 * Migrate data owned by `local@localhost` to a real account.
 *
 * When a user starts an app in local mode and later signs in to create a real
 * account, this function moves all of their existing data over to the new
 * account so they don't lose anything.
 *
 * Scope of the migration:
 *   - `application_state`: rows with `session_id = 'local'`
 *   - `settings`: keys prefixed with `u:local@localhost:`
 *   - `oauth_tokens`: rows with `owner = 'local@localhost'`
 *   - Any template table that has an `owner_email` column: rows with
 *     `owner_email = 'local@localhost'`
 *
 * The operation is a no-op if the target email is itself `local@localhost`,
 * empty, or if there is nothing to migrate.
 */

import { getDbExec, isPostgres } from "../db/client.js";

const LOCAL_EMAIL = "local@localhost";
const LOCAL_SESSION_ID = "local";
const OWNER_COLUMN = "owner_email";

export interface LocalMigrationResult {
  /** Whether anything was actually migrated. */
  migrated: boolean;
  /** Per-table row counts that were updated. Omits tables with zero updates. */
  tables: Record<string, number>;
  /** Target email the data now belongs to. */
  targetEmail: string;
}

/** Discover every table that has an `owner_email` column. */
async function discoverOwnerEmailTables(): Promise<string[]> {
  const client = getDbExec();
  if (isPostgres()) {
    const { rows } = await client.execute({
      sql: `SELECT table_name
              FROM information_schema.columns
             WHERE table_schema = 'public'
               AND column_name = $1`,
      args: [OWNER_COLUMN],
    });
    return rows.map((r: any) => r.table_name ?? r[0]).filter(Boolean);
  }

  // SQLite path: iterate tables and inspect columns via PRAGMA
  const tablesRes = await client.execute(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
  );
  const tables = tablesRes.rows
    .map((r: any) => (r.name ?? r[0]) as string)
    .filter(Boolean);

  const withOwner: string[] = [];
  for (const table of tables) {
    const escaped = table.replace(/"/g, '""');
    const colsRes = await client.execute(`PRAGMA table_info("${escaped}")`);
    const hasOwner = colsRes.rows.some(
      (row: any) => (row.name ?? row[1]) === OWNER_COLUMN,
    );
    if (hasOwner) withOwner.push(table);
  }
  return withOwner;
}

/** Replace `?` placeholders with `$1`, `$2`, … for Postgres. */
function sqlWithParams(sql: string): string {
  if (!isPostgres()) return sql;
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/**
 * Rename `settings` keys so a user's config carries over. Keys are prefixed
 * with `u:<email>:` — moving from one email to another is a prefix swap.
 *
 * If a destination key already exists (unlikely but possible if the user had
 * previously signed in with the same email) we leave the destination alone
 * and drop the local row, so we never clobber real-account state.
 */
async function migrateSettings(targetEmail: string): Promise<number> {
  const client = getDbExec();
  const oldPrefix = `u:${LOCAL_EMAIL}:`;
  const newPrefix = `u:${targetEmail}:`;

  const { rows } = await client.execute({
    sql: sqlWithParams(`SELECT key FROM settings WHERE key LIKE ? ESCAPE '\\'`),
    args: [oldPrefix.replace(/([\\%_])/g, "\\$1") + "%"],
  });

  let updated = 0;
  for (const row of rows) {
    const oldKey = (row.key ?? (row as any)[0]) as string;
    if (!oldKey.startsWith(oldPrefix)) continue;
    const newKey = newPrefix + oldKey.slice(oldPrefix.length);

    // Skip if the destination already exists — don't overwrite real data.
    const existsRes = await client.execute({
      sql: sqlWithParams(`SELECT 1 FROM settings WHERE key = ?`),
      args: [newKey],
    });
    if (existsRes.rows.length > 0) {
      await client.execute({
        sql: sqlWithParams(`DELETE FROM settings WHERE key = ?`),
        args: [oldKey],
      });
      continue;
    }

    await client.execute({
      sql: sqlWithParams(`UPDATE settings SET key = ? WHERE key = ?`),
      args: [newKey, oldKey],
    });
    updated++;
  }
  return updated;
}

/**
 * Move application_state rows from `session_id='local'` to the target email.
 * Rows that already exist for the destination session are left alone.
 */
async function migrateApplicationState(targetEmail: string): Promise<number> {
  const client = getDbExec();
  // Only migrate keys that don't already exist under the destination session.
  const { rows } = await client.execute({
    sql: sqlWithParams(
      `SELECT key FROM application_state WHERE session_id = ?`,
    ),
    args: [LOCAL_SESSION_ID],
  });

  let updated = 0;
  for (const row of rows) {
    const key = (row.key ?? (row as any)[0]) as string;
    const existsRes = await client.execute({
      sql: sqlWithParams(
        `SELECT 1 FROM application_state WHERE session_id = ? AND key = ?`,
      ),
      args: [targetEmail, key],
    });
    if (existsRes.rows.length > 0) {
      await client.execute({
        sql: sqlWithParams(
          `DELETE FROM application_state WHERE session_id = ? AND key = ?`,
        ),
        args: [LOCAL_SESSION_ID, key],
      });
      continue;
    }
    await client.execute({
      sql: sqlWithParams(
        `UPDATE application_state SET session_id = ? WHERE session_id = ? AND key = ?`,
      ),
      args: [targetEmail, LOCAL_SESSION_ID, key],
    });
    updated++;
  }
  return updated;
}

/** Move oauth_tokens rows. `owner` is the user's email in core tables. */
async function migrateOauthTokens(targetEmail: string): Promise<number> {
  const client = getDbExec();
  const res = await client.execute({
    sql: sqlWithParams(`UPDATE oauth_tokens SET owner = ? WHERE owner = ?`),
    args: [targetEmail, LOCAL_EMAIL],
  });
  return res.rowsAffected ?? 0;
}

/** Move rows in a template table that uses the `owner_email` convention. */
async function migrateOwnerEmailTable(
  table: string,
  targetEmail: string,
): Promise<number> {
  const client = getDbExec();
  const escaped = table.replace(/"/g, '""');
  const res = await client.execute({
    sql: sqlWithParams(
      `UPDATE "${escaped}" SET owner_email = ? WHERE owner_email = ?`,
    ),
    args: [targetEmail, LOCAL_EMAIL],
  });
  return res.rowsAffected ?? 0;
}

/**
 * Migrate every piece of local-mode data to the given real account email.
 * Safe to call multiple times — it only touches rows that are still attached
 * to `local@localhost`.
 */
export async function migrateLocalUserData(
  targetEmail: string,
): Promise<LocalMigrationResult> {
  const email = targetEmail?.trim().toLowerCase();
  if (!email || email === LOCAL_EMAIL) {
    return { migrated: false, tables: {}, targetEmail: email || "" };
  }

  const tables: Record<string, number> = {};

  // Core tables — best-effort. A missing table just means the feature isn't
  // enabled in this app (e.g. an app that doesn't use oauth_tokens).
  const coreSteps: Array<[string, () => Promise<number>]> = [
    ["settings", () => migrateSettings(email)],
    ["application_state", () => migrateApplicationState(email)],
    ["oauth_tokens", () => migrateOauthTokens(email)],
  ];
  for (const [name, fn] of coreSteps) {
    try {
      const count = await fn();
      if (count > 0) tables[name] = count;
    } catch (err: any) {
      // Missing table or column — skip silently.
      if (!/no such table|does not exist|undefined table/i.test(String(err))) {
        throw err;
      }
    }
  }

  // Template tables — discovered dynamically.
  let templateTables: string[] = [];
  try {
    templateTables = await discoverOwnerEmailTables();
  } catch {
    templateTables = [];
  }
  for (const table of templateTables) {
    try {
      const count = await migrateOwnerEmailTable(table, email);
      if (count > 0) tables[table] = count;
    } catch (err: any) {
      if (!/no such table|does not exist|undefined table/i.test(String(err))) {
        throw err;
      }
    }
  }

  const migrated = Object.values(tables).some((n) => n > 0);
  return { migrated, tables, targetEmail: email };
}
