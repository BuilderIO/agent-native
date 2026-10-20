import { sql } from "drizzle-orm";

const readyDatabases = new WeakSet<object>();

/**
 * Production serverless deploys can receive traffic before the scheduled
 * migration creates the association table. Only cache a positive result so
 * requests switch to exact associations as soon as the migration lands.
 */
export async function sessionRecordingAssociationsReady(
  db: any,
): Promise<boolean> {
  if (db && typeof db === "object" && readyDatabases.has(db)) return true;
  const result = await db.execute(
    sql`SELECT to_regclass('session_recording_session_associations') AS table_name`,
  );
  const rows = Array.isArray(result) ? result : result?.rows;
  if (!Array.isArray(rows)) {
    throw new Error("Postgres table existence check returned no row array");
  }
  const value = rows[0]?.table_name;
  if (value === null) return false;
  if (typeof value === "string" && value) {
    if (db && typeof db === "object") readyDatabases.add(db);
    return true;
  }
  throw new Error("Postgres table existence check returned an invalid value");
}
