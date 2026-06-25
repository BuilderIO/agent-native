import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_AUTH_TOKEN: process.env.DATABASE_AUTH_TOKEN,
};

let tempDir: string | null = null;

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function setupTempDb() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-migrations-"));
  process.env.DATABASE_URL = `file:${path.join(tempDir, "app.db")}`;
  delete process.env.DATABASE_AUTH_TOKEN;
  vi.resetModules();
}

beforeEach(async () => {
  await setupTempDb();
});

afterEach(async () => {
  try {
    const { closeDbExec } = await import("@agent-native/core/db");
    await closeDbExec();
  } catch {}
  restoreEnv();
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
  vi.restoreAllMocks();
});

describe("dispatch migrations", () => {
  it("quietly records source_health when the column already exists", async () => {
    const [{ getDbExec, runMigrations }, { dispatchMigrations }] =
      await Promise.all([
        import("@agent-native/core/db"),
        import("./migrations.js"),
      ]);
    const exec = getDbExec();
    await exec.execute(`
      CREATE TABLE dispatch_dreams (
        id TEXT PRIMARY KEY,
        source_health TEXT
      )
    `);
    await exec.execute(
      "CREATE TABLE dispatch_migrations (version INTEGER PRIMARY KEY)",
    );
    await exec.execute({
      sql: "INSERT INTO dispatch_migrations VALUES (?)",
      args: [3],
    });

    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    await runMigrations(dispatchMigrations, {
      table: "dispatch_migrations",
    })({});

    expect(consoleError).not.toHaveBeenCalled();
    const { rows } = await exec.execute(
      "SELECT MAX(version) as version FROM dispatch_migrations",
    );
    expect(rows[0]?.version).toBe(4);
  });
});
