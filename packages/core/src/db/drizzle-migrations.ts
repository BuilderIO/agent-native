import { isNodeRuntime } from "../shared/runtime.js";
import {
  runMigrations,
  type MigrationEntry,
  type RunMigrationsOptions,
} from "./migrations.js";

export type DrizzleMigrationsFolder = string | URL;
export type DrizzleMigrationDialect = "postgresql" | "sqlite" | "turso";

export interface LoadDrizzleMigrationsOptions {
  dialect: DrizzleMigrationDialect;
}

export interface RunDrizzleMigrationsOptions extends RunMigrationsOptions {
  dialect: DrizzleMigrationDialect;
}

function isMissingPath(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

/**
 * Read Drizzle Kit's generated migration files as Agent-Native migrations.
 *
 * Drizzle Kit owns SQL generation. The Agent-Native runner remains the runtime
 * owner, so release authorization, dialect adaptation, and bookkeeping stay in
 * one place. The file name becomes the stable migration name.
 *
 * This filesystem loader is for Node.js runtimes. Cloudflare Workers and D1
 * callers must pass embedded entries to `runMigrations` instead.
 */
export async function loadDrizzleMigrations(
  migrationsFolder: DrizzleMigrationsFolder,
  options: LoadDrizzleMigrationsOptions,
): Promise<Array<MigrationEntry>> {
  if (!isNodeRuntime()) {
    throw new Error(
      "loadDrizzleMigrations requires a Node.js filesystem. Cloudflare Workers and D1 must use runMigrations with embedded entries.",
    );
  }

  const [{ readdir, readFile }, { join }, { fileURLToPath }] =
    await Promise.all([
      import("node:fs/promises"),
      import("node:path"),
      import("node:url"),
    ]);
  const root =
    typeof migrationsFolder === "string"
      ? migrationsFolder
      : fileURLToPath(migrationsFolder);
  let folders;
  try {
    folders = await readdir(root, { withFileTypes: true });
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
      sql:
        options.dialect === "postgresql"
          ? { postgres: trimmedSql }
          : { sqlite: trimmedSql },
      dialectSpecific: true,
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
  const { dialect, ...migrationOptions } = options;
  return runMigrations(
    () => loadDrizzleMigrations(migrationsFolder, { dialect }),
    migrationOptions,
  );
}
