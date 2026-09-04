import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
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
  process.env.DATABASE_URL = `pglite:${tempDir}`;
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

    await (await import("@agent-native/core/db")).closeDbExec();
    const freshExec = (await import("@agent-native/core/db")).getDbExec();
    expect(consoleError).not.toHaveBeenCalled();
    const { rows } = await freshExec.execute(
      "SELECT MAX(version) as version FROM dispatch_migrations",
    );
    expect(rows[0]?.version).toBe(6);
    const { rows: identityRows } = await freshExec.execute({
      sql: `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ?`,
      args: ["identity_sso_authorization_code"],
    });
    expect(identityRows).toHaveLength(1);
  });
});
