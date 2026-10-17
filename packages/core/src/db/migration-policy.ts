import { getAppConfig } from "../app-config/index.js";

export function appMigratesAtRelease(): boolean {
  const { migration } = getAppConfig();
  return (
    migration.releaseMigrations ||
    migration.betaSchemaOwner?.toLowerCase() === "production"
  );
}

/** Operator opt-out: never run schema setup from this runtime. */
export function schemaEnsureSkipRequested(): boolean {
  return getAppConfig().migration.skipEnsureTables;
}
