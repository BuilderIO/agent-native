import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadDrizzleMigrations } from "./drizzle-migrations.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function createMigrationFile(
  root: string,
  name: string,
  sql?: string,
): Promise<void> {
  await mkdir(root, { recursive: true });
  if (sql !== undefined) {
    await writeFile(join(root, name), sql, "utf8");
  }
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "agent-native-drizzle-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("loadDrizzleMigrations", () => {
  it("sorts migration files, preserves SQL, and ignores Drizzle metadata", async () => {
    const root = await createTemporaryDirectory();
    await createMigrationFile(
      root,
      "0001_add_title.sql",
      "CREATE TABLE titles (id TEXT PRIMARY KEY);\n",
    );
    await createMigrationFile(
      root,
      "0000_initial.sql",
      "CREATE TABLE records (id TEXT PRIMARY KEY);\n",
    );
    await mkdir(join(root, "meta"), { recursive: true });
    await writeFile(join(root, "meta", "_journal.json"), "{}", "utf8");

    const migrations = await loadDrizzleMigrations(pathToFileURL(root));

    expect(migrations).toEqual([
      {
        version: 1,
        name: "0000_initial.sql",
        sql: { postgres: "CREATE TABLE records (id TEXT PRIMARY KEY);" },
      },
      {
        version: 2,
        name: "0001_add_title.sql",
        sql: { postgres: "CREATE TABLE titles (id TEXT PRIMARY KEY);" },
      },
    ]);
  });

  it("fails when Drizzle Kit has not created the output folder", async () => {
    const root = await createTemporaryDirectory();

    await expect(
      loadDrizzleMigrations(join(root, "server", "db", "migrations")),
    ).rejects.toThrow("Drizzle migrations folder");
  });

  it("fails clearly on filesystem-free runtimes", async () => {
    vi.stubGlobal("__cf_env", {});

    await expect(loadDrizzleMigrations("/missing/migrations")).rejects.toThrow(
      "loadDrizzleMigrations requires a Node.js filesystem",
    );
  });

  it("ignores non-SQL metadata files", async () => {
    const root = await createTemporaryDirectory();
    await writeFile(join(root, "README.md"), "not a migration", "utf8");
    await mkdir(join(root, "meta"), { recursive: true });
    await writeFile(join(root, "meta", "0000_snapshot.json"), "{}", "utf8");

    await expect(loadDrizzleMigrations(root)).resolves.toEqual([]);
  });

  it("fails when a migration file is empty", async () => {
    const root = await createTemporaryDirectory();
    await createMigrationFile(root, "0000_empty.sql", "\n");

    await expect(loadDrizzleMigrations(root)).rejects.toThrow(
      'Drizzle migration file "0000_empty.sql" has empty SQL',
    );
  });

  it("does not mutate the generated SQL", async () => {
    const root = await createTemporaryDirectory();
    const sql = [
      "CREATE TABLE records (id TEXT PRIMARY KEY);",
      "--> statement-breakpoint",
      "CREATE INDEX records_id_idx ON records (id);",
    ].join("\n");
    await createMigrationFile(root, "0000_initial.sql", sql);

    const migrations = await loadDrizzleMigrations(root);

    expect(migrations[0]?.sql).toEqual({ postgres: sql });
    expect(await readFile(join(root, "0000_initial.sql"), "utf8")).toBe(sql);
  });
});
