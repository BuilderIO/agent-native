import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Where the starters' storing-data skill tells an app to declare its tables. */
export const APP_DB_PLUGIN = "server/plugins/db.ts";

const MANAGED_DRIZZLE_CONFIGS = [
  "drizzle.config.ts",
  "drizzle.config.js",
  "drizzle.config.json",
];

export type AppReleaseMigrationResult =
  | { status: "applied"; plugin: string }
  | { status: "no-app-tables" }
  | { status: "managed-drizzle"; config: string };

/**
 * Applies the app's own `runMigrations` list at release. A release-owned
 * hosted function skips that list at boot (that is what release-owned means),
 * so without this step a starter app's tables are never created in
 * production. A managed Drizzle project is the exception: `db:migrate` owns
 * its tables, and running the plugin too would give them two owners.
 *
 * Call inside `withMigrationRuntime`, after `runFrameworkReleaseMigrations`.
 */
export async function runAppReleaseMigrations(
  cwd: string = process.cwd(),
): Promise<AppReleaseMigrationResult> {
  const managed = MANAGED_DRIZZLE_CONFIGS.find((file) =>
    existsSync(path.join(cwd, file)),
  );
  if (managed) return { status: "managed-drizzle", config: managed };
  const pluginPath = path.join(cwd, APP_DB_PLUGIN);
  if (!existsSync(pluginPath)) return { status: "no-app-tables" };

  const plugin = (await import(pathToFileURL(pluginPath).href)).default;
  if (typeof plugin !== "function") {
    throw new Error(
      `${APP_DB_PLUGIN} must default-export its migration plugin (export default runMigrations([...], { table })).`,
    );
  }
  await plugin(null);
  return { status: "applied", plugin: APP_DB_PLUGIN };
}
