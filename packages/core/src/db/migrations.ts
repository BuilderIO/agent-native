import {
  getDbExec,
  createDbExec,
  isPostgres,
  getDialect,
  getMigrationDatabaseUrl,
  getCloudflareD1Binding,
  retrySqliteBusy,
  type DbExec,
} from "./client.js";

interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  all(): Promise<{ results: Record<string, unknown>[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
}

interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch(statements: D1PreparedStatementLike[]): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Shared direct-endpoint exec across concurrent migration runners per boot.
//
// On each serverless cold start THREE plugins call runMigrations (core,
// org, context-xray). Without coordination each would open an independent
// direct-endpoint Neon connection AND leave it idle for ~10 s after
// migrations finish. We avoid that by sharing a single direct exec for
// the duration of the migration window: the first caller opens it,
// subsequent callers reuse the same promise, and the last caller closes it
// via reference-counting. The exec is nulled out after the window so a
// second cold start (e.g. after a Lambda thaw) gets a fresh connection.
// ---------------------------------------------------------------------------

let _migrationExecPromise: Promise<DbExec> | null = null;
let _migrationExecRefCount = 0;

async function acquireMigrationExec(): Promise<DbExec> {
  if (!_migrationExecPromise) {
    const opened = createDbExec({ url: getMigrationDatabaseUrl() });
    _migrationExecPromise = opened;
    opened.catch(() => {
      // Opening the connection failed. Reset the shared state so the next
      // caller retries with a fresh connection instead of awaiting this
      // permanently rejected promise — and zero the ref count, because none
      // of the awaiters that failed here will ever call release.
      if (_migrationExecPromise === opened) {
        _migrationExecPromise = null;
        _migrationExecRefCount = 0;
      }
    });
  }
  _migrationExecRefCount++;
  return _migrationExecPromise;
}

async function releaseMigrationExec(): Promise<void> {
  _migrationExecRefCount--;
  if (_migrationExecRefCount > 0) return;
  // Last caller — close and reset so next boot gets a fresh connection.
  const execPromise = _migrationExecPromise;
  _migrationExecPromise = null;
  _migrationExecRefCount = 0;
  if (!execPromise) return;
  try {
    const exec = await execPromise;
    await exec.close?.();
  } catch {
    // Swallow close errors — the migrations themselves already succeeded or
    // failed; a cleanup error should not surface as a boot crash.
  }
}

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

/**
 * Rewrite SQLite-specific SQL to Postgres-compatible equivalents.
 * Handles: datetime('now') → CURRENT_TIMESTAMP, AUTOINCREMENT → GENERATED, etc.
 */
function adaptSqlForPostgres(sql: string): string {
  return sql
    .replace(/datetime\s*\(\s*'now'\s*\)/gi, "CURRENT_TIMESTAMP")
    .replace(/\bAUTOINCREMENT\b/gi, "")
    .replace(/\bINTEGER\b/gi, "BIGINT");
}

const IF_NOT_EXISTS_ADD_COLUMN_RE = /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS/i;

/**
 * Strip Postgres-only syntax that SQLite doesn't support.
 * Handles: ALTER TABLE ... ADD COLUMN IF NOT EXISTS → ADD COLUMN
 *
 * Note: SQLite does not have a native equivalent, so the idempotent
 * semantic is emulated at the executor level by swallowing the
 * "duplicate column name" error for statements that originally carried
 * the clause. See `hadIfNotExists` tracking in the run loop.
 */
function adaptSqlForSqlite(sql: string): string {
  return sql.replace(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS/gi, "ADD COLUMN");
}

/**
 * True when an error from `ALTER TABLE ... ADD COLUMN` indicates the
 * column already existed. Recognizes both SQLite ("duplicate column
 * name") and Postgres ("column ... already exists" — exact text varies
 * by error code 42701, but the substring is stable). Exported so other
 * idempotent column-upgrade loops in the codebase don't reinvent this
 * regex with subtly different shapes.
 */
export function isDuplicateColumnError(err: unknown): boolean {
  const msg = (err as Error | undefined)?.message ?? "";
  return (
    /duplicate column name/i.test(msg) || /column .* already exists/i.test(msg)
  );
}

/**
 * True when a migration statement failed because the connected DB ROLE lacks
 * privilege — e.g. a permission-limited dev/replica role that doesn't own the
 * table. Postgres raises SQLSTATE 42501 ("insufficient_privilege", routine
 * aclcheck_error, message "must be owner of table …"). We treat these as
 * NON-FATAL so a perms-limited database can't crash-loop the whole server: the
 * migration is skipped (left unrecorded) and a properly-privileged role applies
 * it later. Production, where the role owns its tables, never hits this path.
 */
export function isPermissionError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | undefined;
  if (e?.code === "42501") return true;
  const msg = e?.message ?? "";
  return (
    /must be owner of/i.test(msg) ||
    /permission denied/i.test(msg) ||
    /insufficient privilege/i.test(msg)
  );
}

/**
 * Split a multi-statement SQL blob into individual statements.
 *
 * libsql's `execute(sql)` only runs the first statement in a multi-statement
 * string. This splitter is intentionally simple: it respects single-quoted
 * string literals (with `''` escaping) and `--` line comments, and splits on
 * top-level `;`. It does NOT attempt to parse `$$`-quoted Postgres function
 * bodies — migrations that define functions/triggers with `;` inside bodies
 * should pass a single-statement migration per entry instead.
 */
function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  let i = 0;
  let inSingle = false;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (!inSingle && ch === "-" && next === "-") {
      // Skip to end of line
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (ch === "'") {
      buf += ch;
      if (inSingle && next === "'") {
        buf += next;
        i += 2;
        continue;
      }
      inSingle = !inSingle;
      i++;
      continue;
    }
    if (ch === ";" && !inSingle) {
      const trimmed = buf.trim();
      if (trimmed) out.push(trimmed);
      buf = "";
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

export interface RunMigrationsOptions {
  /**
   * Name of the migrations bookkeeping table. REQUIRED — there is intentionally
   * no default. Two templates that share a database (e.g. via the same Neon URL)
   * each have their own version space starting at v1, and a single shared
   * `_migrations` table will silently skip the second template's migrations if
   * the first has already advanced past those version numbers. This caused the
   * design template's migrations to be skipped entirely on a Neon DB that
   * slides had already populated up to v15 (PR #320 era).
   *
   * Use one bookkeeping table per template, e.g. `slides_migrations`. Core
   * feature plugins (e.g. the org module) follow the same convention with
   * their own prefix, e.g. `_org_migrations`.
   */
  table: string;
}

/**
 * A single migration entry.
 *
 * `sql` can be a string (runs on every dialect) or an object with dialect
 * keys for dialect-gated SQL. Useful when Postgres needs an ALTER that
 * SQLite can't parse.
 *
 *   { version: 14, sql: { postgres: "ALTER TABLE …" } }  // no-op on sqlite
 *   { version: 15, sql: { sqlite: "…", postgres: "…" } } // both dialects
 *
 * `name` is an optional stable, unique slug that opts a migration into
 * **name-based tracking** instead of the legacy version-number gate. See the
 * "Name-based tracking" section on `runMigrations` for why this exists and
 * exactly how the two gating strategies interact.
 */
export type MigrationSql = string | { postgres?: string; sqlite?: string };

export interface MigrationEntry {
  version: number;
  sql: MigrationSql;
  /**
   * Stable, unique slug for this migration (e.g. `"analytics-alert-rules-table"`).
   * When present, this migration is tracked by NAME instead of by version
   * number — see the `runMigrations` doc comment for the full rationale and
   * gating rules. Must be unique across the migration list; a duplicate name
   * throws at startup (programmer error, not a runtime data problem).
   */
  name?: string;
}

function resolveMigrationSql(sql: MigrationSql, pg: boolean): string | null {
  if (typeof sql === "string") return sql;
  const raw = pg ? sql.postgres : sql.sqlite;
  return raw ?? null;
}

/**
 * Runs a list of migrations against the configured database, gated by a
 * per-table bookkeeping row (`options.table`) so repeated boots only apply
 * new migrations.
 *
 * ## Name-based tracking (why it exists)
 *
 * The legacy gate is purely numeric: `SELECT MAX(version)` from the
 * bookkeeping table, then apply every entry whose `version` is greater. That
 * scheme silently breaks down when **two independent branches each extend the
 * same migration list with different DDL under the same version numbers** —
 * exactly what happened to the analytics template's v75-v83 range. Branch A
 * shipped alert-rule tables as v75-v78; branch B shipped unrelated DDL as its
 * own v75-v83. Whichever branch deployed first recorded "v75..v83 applied"
 * in the bookkeeping table. When the other branch merged and deployed, its
 * migrations at those same version numbers were never applied — `MAX(version)`
 * was already ≥ their version, so the gate treated them as done even though
 * their actual DDL had never run. The result: `analytics_migrations` showed
 * rows for 1..83 with no gaps, yet `analytics_alert_rules`,
 * `analytics_alert_incidents`, and `session_recordings.network_error_count`
 * did not exist in production. Version numbers are not a stable identity —
 * they're just sequence position, and sequence position collides across
 * branches.
 *
 * Name-based tracking fixes this by keying application on a stable, unique
 * **string slug** instead of a position in a shared integer sequence:
 *
 * - Entries with a `name` are recorded in a companion table,
 *   `${table}_named` (`name TEXT PRIMARY KEY`), and APPLY IFF their name is
 *   absent from that table — completely independent of version numbers or
 *   the legacy `MAX(version)` gate. Two branches can both ship a migration
 *   named `"analytics-alert-rules-table"` at version 75, or one at version 75
 *   and the other at version 90 after a rebase — either way it applies
 *   exactly once per database, keyed on the name.
 * - Entries WITHOUT a `name` keep the exact legacy behavior
 *   (`version > MAX(recorded version)`), so nothing changes for existing
 *   unnamed migrations.
 * - Named migrations still execute in list order, interleaved with unnamed
 *   ones exactly as written.
 * - When a named migration's DDL runs, we record BOTH the named row (always)
 *   and — if its `version` is greater than the current legacy max — the
 *   legacy version row too, in the SAME atomic batch/transaction as the DDL.
 *   This keeps the legacy `MAX(version)` gate monotonically advancing for
 *   any unnamed migrations that come after it in the list, while ensuring a
 *   named migration is never "double recorded" in a way that would let it
 *   re-apply.
 * - A duplicate `name` across the migration list throws at startup — that's
 *   a programmer error (copy-paste or merge mistake), not a runtime data
 *   problem, and failing loud beats silently tracking the wrong row.
 *
 * New migrations should always set a `name`. Legacy unnamed migrations don't
 * need to be renamed retroactively — the two gating strategies coexist in the
 * same list — but if a table is EVER at risk of being shared across parallel
 * branches (any template's own migrations qualify, since branches routinely
 * extend the same list concurrently), giving new entries a name is what makes
 * them immune to the collision class described above.
 */
export function runMigrations(
  migrations: Array<MigrationEntry>,
  options: RunMigrationsOptions,
): NitroPluginDef {
  const table = options?.table;
  if (
    !table ||
    typeof table !== "string" ||
    !/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)
  ) {
    throw new Error(
      "runMigrations: `table` option is required and must be a valid SQL identifier " +
        '(e.g. `{ table: "slides_migrations" }`). See packages/core/src/db/migrations.ts ' +
        "for why this is required (shared-DB version-collision bug).",
    );
  }

  // Duplicate-name detection — programmer error, fail loud at startup rather
  // than silently tracking the wrong migration's applied state.
  {
    const seenNames = new Set<string>();
    for (const m of migrations) {
      if (!m.name) continue;
      if (seenNames.has(m.name)) {
        throw new Error(
          `runMigrations: duplicate migration name "${m.name}" in the migration list for table "${table}". ` +
            "Migration names must be unique — pick a different stable slug.",
        );
      }
      seenNames.add(m.name);
    }
  }

  const namedTable = `${table}_named`;

  return async () => {
    try {
      // Check for Cloudflare D1 binding (only if DATABASE_URL not set)
      const d1 =
        getDialect() === "d1"
          ? (getCloudflareD1Binding() as D1DatabaseLike | undefined)
          : null;
      if (d1) {
        await d1
          .prepare(
            `CREATE TABLE IF NOT EXISTS ${table} (version INTEGER PRIMARY KEY)`,
          )
          .run();
        await d1
          .prepare(
            `CREATE TABLE IF NOT EXISTS ${namedTable} (name TEXT PRIMARY KEY, version INTEGER, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`,
          )
          .run();
        const firstRow = await d1
          .prepare(`SELECT MAX(version) as v FROM ${table}`)
          .first<{ v?: number }>();
        const current = (firstRow?.v as number) ?? 0;

        const appliedNamesRows = await d1
          .prepare(`SELECT name FROM ${namedTable}`)
          .all();
        const appliedNames = new Set(
          (appliedNamesRows?.results ?? []).map((r) => String(r.name)),
        );

        const pending = migrations.filter((m) =>
          m.name ? !appliedNames.has(m.name) : m.version > current,
        );

        for (const m of pending) {
          try {
            // D1 is SQLite-compatible
            const raw = resolveMigrationSql(m.sql, false);
            const recordStatements = [
              m.name
                ? d1
                    .prepare(
                      `INSERT OR IGNORE INTO ${namedTable} (name, version) VALUES (?, ?)`,
                    )
                    .bind(m.name, m.version)
                : null,
              m.version > current
                ? d1
                    .prepare(`INSERT OR IGNORE INTO ${table} VALUES (?)`)
                    .bind(m.version)
                : null,
            ].filter((s): s is NonNullable<typeof s> => s != null);

            if (raw == null) {
              // Dialect-gated migration with no SQL for this dialect; still
              // record it so we don't retry forever.
              for (const stmt of recordStatements) await stmt.run();
              continue;
            }
            const originalStatements = splitSqlStatements(raw);
            const statements = originalStatements.map((orig) => ({
              sql: adaptSqlForSqlite(orig),
              hadIfNotExists: IF_NOT_EXISTS_ADD_COLUMN_RE.test(orig),
            }));
            const hasIfNotExists = statements.some((s) => s.hadIfNotExists);
            if (hasIfNotExists) {
              // Per-statement path: we need to swallow "duplicate column"
              // errors for statements that originally carried
              // `ADD COLUMN IF NOT EXISTS`, which a batch() can't express.
              // Loses atomicity, but the idempotent-ADD-COLUMN semantic
              // means a partial re-run resolves cleanly on retry.
              for (const { sql: stmt, hadIfNotExists } of statements) {
                try {
                  await d1.prepare(stmt).run();
                } catch (err) {
                  if (hadIfNotExists && isDuplicateColumnError(err)) continue;
                  throw err;
                }
              }
              for (const stmt of recordStatements) await stmt.run();
            } else {
              // Atomic batch: all statements + bookkeeping inserts land in
              // the same transaction. A failing statement rolls the whole
              // migration back, so we never record a half-applied migration.
              await d1.batch([
                ...statements.map((s) => d1.prepare(s.sql)),
                ...recordStatements,
              ]);
            }
            console.log(
              `[db] Applied migration ${m.name ? `"${m.name}" ` : ""}v${m.version} (${statements.length} statement${statements.length === 1 ? "" : "s"})`,
            );
          } catch (err) {
            console.error(
              `[db] Migration ${m.name ? `"${m.name}" ` : ""}v${m.version} FAILED:`,
              (err as Error).message,
              "\nSQL:",
              JSON.stringify(m.sql),
            );
            throw err;
          }
        }
        return;
      }

      // Generic path — works for libsql and Postgres
      const pg = isPostgres();

      // ---------------------------------------------------------------------------
      // Fast-path: read migration state through the regular pooled singleton before
      // opening the direct-endpoint connection.
      //
      // On Postgres every cold start previously opened a fresh direct-endpoint Neon
      // connection (bypassing PgBouncer, which is needed only for DDL), ran
      // CREATE TABLE IF NOT EXISTS + SELECT MAX(version) even with zero pending
      // migrations, and never closed the pool — it idled for ~10 s. Three runners
      // (core, org, context-xray) did this independently per boot.
      //
      // Now: use the pooled singleton (getDbExec) for the bookkeeping SELECT. If
      // the migrations table does not yet exist we treat it as "all migrations
      // pending" (current = -1). Only when there are pending migrations do we open
      // the direct-endpoint exec (DDL is the only thing Neon's PgBouncer blocks —
      // documented at getMigrationDatabaseUrl). The direct exec is shared across
      // concurrent runners via acquireMigrationExec() and closed after the last
      // caller via releaseMigrationExec().
      // ---------------------------------------------------------------------------

      let current = -1; // sentinel: "table missing" → treat all as pending
      let namedRowsMissing = false; // sentinel: "named table missing" → no names applied yet

      // Any migration with a `name` is a candidate regardless of version, so
      // the fast-path "anything pending?" check must also account for names.
      const hasNamedMigrations = migrations.some((m) => m.name);
      let appliedNames = new Set<string>();

      if (pg) {
        try {
          const { rows } = await getDbExec().execute(
            `SELECT MAX(version) as v FROM ${table}`,
          );
          current = (rows[0]?.v as number) ?? 0;
        } catch {
          // Table doesn't exist yet — leave current = -1 so all migrations apply.
        }
        if (hasNamedMigrations) {
          try {
            const { rows } = await getDbExec().execute(
              `SELECT name FROM ${namedTable}`,
            );
            appliedNames = new Set(rows.map((r) => String(r.name)));
          } catch {
            // Named table doesn't exist yet — leave appliedNames empty so all
            // named migrations apply.
            namedRowsMissing = true;
          }
        }
      }

      // For SQLite we still use getDbExec() as exec throughout (no pooler concern).
      // For Postgres we only open the direct exec when there are pending migrations.
      const pendingFast = pg
        ? migrations.filter((m) =>
            m.name ? !appliedNames.has(m.name) : m.version > current,
          )
        : null; // SQLite: compute after table creation below

      // Short-circuit: Postgres with nothing to do — skip the direct connection entirely.
      if (pg && pendingFast !== null && pendingFast.length === 0) {
        return;
      }

      // Acquire the exec appropriate for the dialect.
      // For Postgres: the shared direct-endpoint exec (DDL-safe, closed on release).
      // For SQLite/libsql: the singleton pooled exec (no pooler concern).
      const exec = pg ? await acquireMigrationExec() : getDbExec();

      try {
        // Retry initial table creation — SQLITE_BUSY_RECOVERY can occur on HMR
        // restarts when WAL files from the previous process haven't been released yet.
        await retrySqliteBusy(
          () =>
            exec.execute(
              `CREATE TABLE IF NOT EXISTS ${table} (version INTEGER PRIMARY KEY)`,
            ),
          { maxAttempts: 6, baseDelayMs: 1000, rethrow: true },
        );
        // Companion name-keyed bookkeeping table — never alters the existing
        // `${table}`'s PRIMARY KEY, so legacy version rows keep working exactly
        // as before. See the `runMigrations` doc comment for why this exists.
        await retrySqliteBusy(
          () =>
            exec.execute(
              `CREATE TABLE IF NOT EXISTS ${namedTable} (name TEXT PRIMARY KEY, version INTEGER, applied_at ${pg ? "TIMESTAMP NOT NULL DEFAULT now()" : "TEXT NOT NULL DEFAULT (datetime('now'))"})`,
            ),
          { maxAttempts: 6, baseDelayMs: 1000, rethrow: true },
        );

        // For Postgres, current was already set by the fast-path SELECT above.
        // For SQLite we run the SELECT now (via the same exec, which is the singleton).
        if (!pg) {
          const { rows } = await exec.execute(
            `SELECT MAX(version) as v FROM ${table}`,
          );
          current = (rows[0]?.v as number) ?? 0;
          if (hasNamedMigrations) {
            const { rows: nameRows } = await exec.execute(
              `SELECT name FROM ${namedTable}`,
            );
            appliedNames = new Set(nameRows.map((r) => String(r.name)));
          }
        } else if (current === -1 || (hasNamedMigrations && namedRowsMissing)) {
          // Fast-path read failed (table was absent on the pooler): re-read via the
          // direct exec now that CREATE TABLE IF NOT EXISTS has ensured it exists.
          if (current === -1) {
            const { rows } = await exec.execute(
              `SELECT MAX(version) as v FROM ${table}`,
            );
            current = (rows[0]?.v as number) ?? 0;
          }
          if (hasNamedMigrations && namedRowsMissing) {
            const { rows: nameRows } = await exec.execute(
              `SELECT name FROM ${namedTable}`,
            );
            appliedNames = new Set(nameRows.map((r) => String(r.name)));
          }
        }

        const insertVersionSql = pg
          ? `INSERT INTO ${table} VALUES (?) ON CONFLICT DO NOTHING`
          : `INSERT OR IGNORE INTO ${table} VALUES (?)`;
        const insertNamedSql = pg
          ? `INSERT INTO ${namedTable} (name, version) VALUES (?, ?) ON CONFLICT DO NOTHING`
          : `INSERT OR IGNORE INTO ${namedTable} (name, version) VALUES (?, ?)`;

        const pending = migrations.filter((m) =>
          m.name ? !appliedNames.has(m.name) : m.version > current,
        );
        if (pending.length > 0) {
          console.log(
            `[db] Applying ${pending.length} migration(s) on ${pg ? "Postgres" : "SQLite/libsql"}…`,
          );
        }

        for (const m of pending) {
          const raw = resolveMigrationSql(m.sql, pg);
          const label = m.name
            ? `"${m.name}" (v${m.version})`
            : `v${m.version}`;

          // Record BOTH the named row (always, when named) and the legacy
          // version row (only if this migration actually advances the legacy
          // MAX) — atomically with the DDL below. This keeps the legacy gate
          // monotonic for any unnamed migrations later in the list, while a
          // named migration is tracked by name regardless of version.
          const recordSql: Array<{ sql: string; args: unknown[] }> = [];
          if (m.name) {
            recordSql.push({
              sql: insertNamedSql,
              args: [m.name, m.version],
            });
          }
          if (m.version > current) {
            recordSql.push({ sql: insertVersionSql, args: [m.version] });
          }

          if (raw == null) {
            // Dialect-gated migration with no SQL for this dialect; still mark
            // as applied so we don't retry forever.
            for (const stmt of recordSql) await exec.execute(stmt);
            if (m.version > current) current = m.version;
            if (m.name) appliedNames.add(m.name);
            continue;
          }
          // Split BEFORE adapting so we can remember which original statements
          // carried `ADD COLUMN IF NOT EXISTS` — SQLite drops the clause, so we
          // emulate the idempotent semantic by swallowing duplicate-column
          // errors only for those statements.
          const originalStatements = splitSqlStatements(raw);
          const statements = originalStatements.map((orig) => ({
            sql: pg ? adaptSqlForPostgres(orig) : adaptSqlForSqlite(orig),
            hadIfNotExists: IF_NOT_EXISTS_ADD_COLUMN_RE.test(orig),
          }));
          let currentStmt = "";
          try {
            for (const { sql: stmt, hadIfNotExists } of statements) {
              currentStmt = stmt;
              try {
                await exec.execute(stmt);
              } catch (err) {
                if (!pg && hadIfNotExists && isDuplicateColumnError(err)) {
                  // IF NOT EXISTS semantic: column already present, skip.
                  continue;
                }
                throw err;
              }
            }
            for (const stmt of recordSql) await exec.execute(stmt);
            if (m.version > current) current = m.version;
            if (m.name) appliedNames.add(m.name);
            console.log(
              `[db] Applied migration ${label} (${statements.length} statement${statements.length === 1 ? "" : "s"})`,
            );
          } catch (err) {
            if (pg && isPermissionError(err)) {
              // The connected role lacks privilege for this migration (e.g. a
              // permission-limited dev/replica role that doesn't own the table).
              // Don't crash-loop the whole server over it — warn and STOP here.
              // We must NOT continue to later migrations: unnamed pending work is
              // computed as `version > MAX(recorded version)`, so applying a later
              // unnamed migration would advance MAX past this unrecorded one and
              // orphan it forever. Stopping leaves MAX at the last recorded
              // version, so a properly-privileged role resumes from this exact
              // migration, in order. (A named migration skipped here simply
              // isn't recorded by name either, so it's retried next boot same as
              // the legacy gate — no orphaning risk from name-based tracking.)
              console.warn(
                `[db] Migration ${label} skipped — insufficient privilege: ${(err as Error).message}. ` +
                  `Apply it with a DB role that owns the table. ` +
                  `Halting further migrations so this one isn't orphaned. ` +
                  `Set <APP_NAME>_DATABASE_URL (e.g. PLAN_DATABASE_URL) to a database this app owns — a file: URL uses local SQLite.`,
                "\nStatement:",
                currentStmt,
              );
              break;
            }
            console.error(
              `[db] Migration ${label} FAILED:`,
              (err as Error).message,
              "\nStatement:",
              currentStmt,
            );
            throw err;
          }
        }
      } finally {
        // Release the direct-endpoint exec (Postgres only). For SQLite getDbExec()
        // returns the process-lifetime singleton, so releaseMigrationExec is a no-op
        // (refCount never incremented for SQLite path, guard in releaseMigrationExec).
        if (pg) await releaseMigrationExec();
      }
    } catch (err) {
      console.error("[db] Migration failed:", (err as Error).message);
      // In local dev, hard-fail so the developer catches errors immediately.
      // On serverless runtimes (Netlify Functions, Vercel, CF Workers) we
      // keep the process alive — the app will return 500s for routes that
      // depend on the missing tables, but at least other routes still work.
      // Note: Node.js 21+ defines globalThis.navigator, so we check for
      // serverless env vars instead of navigator presence.
      const isServerless =
        !!globalThis.process?.env?.NETLIFY ||
        !!globalThis.process?.env?.AWS_LAMBDA_FUNCTION_NAME ||
        !!globalThis.process?.env?.VERCEL ||
        "__cf_env" in globalThis;
      if (typeof globalThis.process?.exit === "function" && !isServerless) {
        process.exit(1);
      }
    }
  };
}
