import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  runMigrations,
  type MigrationEntry,
  type RunMigrationsOptions,
} from "./migrations.js";

export type DrizzleMigrationsFolder = string | URL;

function folderPath(folder: DrizzleMigrationsFolder): string {
  return typeof folder === "string" ? folder : fileURLToPath(folder);
}

function isMissingPath(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

/**
 * Read Drizzle Kit's generated migration files as Agent Native migrations.
 *
 * Drizzle Kit owns SQL generation. The Agent Native runner remains the runtime
 * owner, so release authorization, dialect adaptation, D1, and bookkeeping
 * stay in one place. The file name becomes the stable migration name.
 */
export async function loadDrizzleMigrations(
  migrationsFolder: DrizzleMigrationsFolder,
): Promise<Array<MigrationEntry>> {
  const root = folderPath(migrationsFolder);
  let folders;
  try {
    folders = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (isMissingPath(error)) return [];
    throw error;
  }

  const migrationFiles = folders
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .sort((a, b) => a.name.localeCompare(b.name));

  const migrations: Array<MigrationEntry> = [];
  for (const [index, file] of migrationFiles.entries()) {
    const sqlPath = join(root, file.name);
    let sql: string;
    try {
      sql = await readFile(sqlPath, "utf8");
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
      sql: trimmedSql,
    });
  }

  return migrations;
}

/**
 * Create a migration plugin backed by Drizzle Kit's generated SQL files.
 *
 * The folder is read lazily after the shared serverless request guard runs.
 * This keeps migration-file I/O out of request paths when releases own DDL.
 */
export function runDrizzleMigrations(
  migrationsFolder: DrizzleMigrationsFolder,
  options: RunMigrationsOptions,
): ReturnType<typeof runMigrations> {
  return runMigrations(() => loadDrizzleMigrations(migrationsFolder), options);
}
