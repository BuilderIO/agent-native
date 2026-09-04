import { getAppConfig } from "../app-config/index.js";
import { type DbExec } from "../db/client.js";
import { getSetting, mutateSetting } from "../settings/store.js";

/**
 * Which app owns this database, recorded once and never overwritten.
 *
 * `beta.<app>` and `<app>` production intentionally share one database — the
 * split is the app slug, not the site/host. Nothing else records that axis,
 * which is how a copy-pasted repair once pointed three betas' real Postgres
 * URL at a fourth app's production database for twelve days: every layer
 * involved (env vars, deploy config, the DB itself) was silent about which
 * app it belonged to. The setting written here is that missing source of
 * truth — read on every health probe and compared against the app actually
 * running.
 */
export const DATABASE_IDENTITY_SETTING_KEY = "framework.database_identity";

export interface DatabaseIdentityRecord {
  /** `app.slug` (falls back to `app.id`) of the app that first recorded this database. */
  app: string;
  /** ISO timestamp of that first write. Never updated by a later call. */
  recordedAt: string;
}

/**
 * `"unrecorded"` (checked, no row yet) and `"unreadable"` (the check itself
 * failed) are deliberately distinct — coercing a failed read into "no
 * identity recorded" is exactly the silent-success bug this exists to catch.
 */
export type DatabaseIdentityReadResult =
  | ({ state: "recorded" } & DatabaseIdentityRecord)
  | { state: "unrecorded" }
  | { state: "unreadable"; error: string };

export type DatabaseIdentityRecordResult =
  | ({ state: "recorded" } & DatabaseIdentityRecord)
  | { state: "skipped"; reason: "no-app-identity" };

/**
 * The identity axis for a shared database: the template/deployment slug, or
 * the bare app id when no slug was derived. Never the site name or `CONTEXT`
 * — those vary between `beta.<app>` and `<app>` on purpose, for a database
 * the two are meant to share.
 */
export function resolveRunningAppIdentity(): string | null {
  const app = getAppConfig().app;
  return app?.slug ?? app?.id ?? null;
}

function isDatabaseIdentityRecord(
  value: unknown,
): value is DatabaseIdentityRecord {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { app?: unknown }).app === "string" &&
    typeof (value as { recordedAt?: unknown }).recordedAt === "string"
  );
}

/**
 * Record this database as belonging to the running app, unless it already
 * belongs to one. Uses `mutateSetting`'s CAS loop so two processes racing to
 * record different apps at once can't both win — the updater hands back the
 * existing record untouched whenever one is already there, so the retried
 * write persists the first writer's value, not this call's.
 *
 * Failures throw (a release migration that silently failed to record
 * identity is the exact bug this file exists to prevent) except the one
 * legitimate no-op: no app slug or id is configured, so there is nothing to
 * attribute this database to yet.
 */
export async function recordDatabaseIdentity(): Promise<DatabaseIdentityRecordResult> {
  const app = resolveRunningAppIdentity();
  if (!app) {
    console.warn(
      `[database-identity] skipped: no app.slug or app.id configured; cannot record which app owns this database.`,
    );
    return { state: "skipped", reason: "no-app-identity" };
  }
  const recordedAt = new Date().toISOString();
  const stored = await mutateSetting(DATABASE_IDENTITY_SETTING_KEY, (current) =>
    isDatabaseIdentityRecord(current) ? current : { app, recordedAt },
  );
  if (!isDatabaseIdentityRecord(stored)) {
    throw new Error(
      `[database-identity] value at ${DATABASE_IDENTITY_SETTING_KEY} is malformed: ${JSON.stringify(stored)}`,
    );
  }
  if (stored.app !== app) {
    console.warn(
      `[database-identity] this database is already recorded for app "${stored.app}"; the running app is "${app}". Not overwritten.`,
    );
  }
  return { state: "recorded", app: stored.app, recordedAt: stored.recordedAt };
}

/**
 * `getSetting()` always opens its own client via `getDbExec()` — the settings
 * store has no exec parameter. Mirrors its exact query so a caller already
 * holding a bounded connection (the health probe's `SELECT 1`) reads through
 * it instead of paying for a second one.
 */
async function readRawViaExec(
  exec: DbExec,
): Promise<Record<string, unknown> | null> {
  const table = "public.settings";
  const { rows } = await exec.execute({
    sql: `SELECT value FROM ${table} WHERE key = ?`,
    args: [DATABASE_IDENTITY_SETTING_KEY],
  });
  const raw = rows.length === 0 ? undefined : rows[0]?.value;
  return raw == null ? null : JSON.parse(raw);
}

/**
 * Read the recorded database identity. Never throws — a failed read reports
 * `"unreadable"` with its cause, never `"unrecorded"`; callers (the health
 * probe, monitors) must be able to tell "nothing recorded yet" apart from
 * "could not check".
 */
export async function readDatabaseIdentity(
  exec?: DbExec,
): Promise<DatabaseIdentityReadResult> {
  try {
    const raw = exec
      ? await readRawViaExec(exec)
      : await getSetting(DATABASE_IDENTITY_SETTING_KEY);
    if (raw == null) return { state: "unrecorded" };
    if (!isDatabaseIdentityRecord(raw)) {
      return {
        state: "unreadable",
        error: `malformed value at ${DATABASE_IDENTITY_SETTING_KEY}: ${JSON.stringify(raw)}`,
      };
    }
    return { state: "recorded", app: raw.app, recordedAt: raw.recordedAt };
  } catch (err) {
    return {
      state: "unreadable",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
