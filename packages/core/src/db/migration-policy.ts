import { getAppConfig } from "../app-config/index.js";

export function appMigratesAtRelease(): boolean {
  const { migration } = getAppConfig();
  return (
    migration.releaseMigrations ||
    migration.betaSchemaOwner?.toLowerCase() === "production"
  );
}
