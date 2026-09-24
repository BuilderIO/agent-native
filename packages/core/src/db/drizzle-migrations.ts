import { isNodeRuntime } from "../shared/runtime.js";
import {
  runMigrations,
  type MigrationEntry,
  type RunMigrationsOptions,
} from "./migrations.js";

export type DrizzleMigrationsFolder = string | URL;
export type RunDrizzleMigrationsOptions = RunMigrationsOptions;

function isMissingPath(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

/**
 * Read Drizzle Kit's generated migration files as Agent-Native migrations.
 *
 * Drizzle Kit owns SQL generation. The Agent-Native runner remains the runtime
 * owner, so release authorization and bookkeeping stay in one place. The file
 * name becomes the stable migration name.
 *
 * This filesystem loader is for Node.js runtimes. Edge callers must pass
 * embedded entries to `runMigrations` instead.
 */
export async function loadDrizzleMigrations(
  migrationsFolder: DrizzleMigrationsFolder,
): Promise<Array<MigrationEntry>> {
  if (!isNodeRuntime()) {
    throw new Error(
      "loadDrizzleMigrations requires a Node.js filesystem. Edge runtimes must use runMigrations with embedded entries.",
    );
  }

  const [fs, path, url] = await Promise.all([
    import("node:fs/promises"),
    import("node:path"),
    import("node:url"),
  ]);
  const root =
    typeof migrationsFolder === "string"
      ? migrationsFolder
      : url.fileURLToPath(migrationsFolder);
  let folders;
  try {
    folders = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (isMissingPath(error)) {
      throw new Error(`Drizzle migrations folder "${root}" does not exist`, {
        cause: error,
      });
    }
    throw error;
  }

  const migrationFiles = folders
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .sort((a, b) => a.name.localeCompare(b.name));

  const migrations: Array<MigrationEntry> = [];
  for (const [index, file] of migrationFiles.entries()) {
    const sqlPath = path.join(root, file.name);
    let sql: string;
    try {
      sql = await fs.readFile(sqlPath, "utf8");
    } catch (error) {
      if (isMissingPath(error)) {
        throw new Error(
          `Drizzle migration file "${file.name}" disappeared while loading`,
          { cause: error },
        );
      }
      throw error;
    }

    const trimmedSql = sql.trim();
    if (!trimmedSql) {
      throw new Error(`Drizzle migration file "${file.name}" has empty SQL`);
    }

    migrations.push({
      version: index + 1,
      name: file.name,
      sql: { postgres: trimmedSql },
    });
  }

  return migrations;
}

/**
 * Create a migration plugin backed by Drizzle Kit's generated SQL files.
 *
 * The folder is read lazily after the shared serverless request guard runs.
 * This keeps migration-file I/O out of request paths when releases own DDL.
 * The filesystem-backed loader is intentionally unavailable on edge runtimes.
 */
export function runDrizzleMigrations(
  migrationsFolder: DrizzleMigrationsFolder,
  options: RunDrizzleMigrationsOptions,
): ReturnType<typeof runMigrations> {
  return runMigrations(() => loadDrizzleMigrations(migrationsFolder), options);
}
