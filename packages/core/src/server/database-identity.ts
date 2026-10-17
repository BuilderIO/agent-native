import { getAppConfig } from "../app-config/index.js";
import { type DbExec } from "../db/client.js";
import { getSetting, mutateSetting } from "../settings/store.js";

export const DATABASE_IDENTITY_SETTING_KEY = "framework.database_identity";

export interface DatabaseIdentityRecord {
  app: string;
  recordedAt: string;
}

export type DatabaseIdentityReadResult =
  | ({ state: "recorded" } & DatabaseIdentityRecord)
  | { state: "unrecorded" }
  | { state: "unreadable"; error: string };

export type DatabaseIdentityRecordResult =
  | ({ state: "recorded" } & DatabaseIdentityRecord)
  | { state: "skipped"; reason: "no-app-identity" };

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
