import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { resetAppConfigForTests } from "../app-config/index.js";
import { closeDbExec, getDbExec } from "../db/client.js";
import { withMigrationRuntime } from "../db/migration-runtime.js";
import { runAppReleaseMigrations } from "./app-release-migrations.js";

const migrationsModule = path.resolve(
  import.meta.dirname,
  "../db/migrations.ts",
);
const previousUrl = process.env.DATABASE_URL;
const dirs: string[] = [];
let seq = 0;

/** A starter app that followed the storing-data skill. */
function starterApp(table: string, extra: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "starter-app-"));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, "server/plugins"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "server/plugins/db.ts"),
    `import { runMigrations } from ${JSON.stringify(migrationsModule)};
export default runMigrations(
  [{ version: 1, name: "${table}-table", sql: "CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY)" }],
  { table: "${table}_migrations" },
);
`,
  );
  for (const [file, body] of Object.entries(extra)) {
    fs.writeFileSync(path.join(dir, file), body);
  }
  return dir;
}

async function tableExists(table: string): Promise<boolean> {
  const { rows } = await getDbExec().execute({
    sql: "SELECT to_regclass(?) IS NOT NULL AS present",
    args: [table],
  });
  return rows[0]?.present === true;
}

beforeAll(async () => {
  process.env.DATABASE_URL = "pglite:memory";
  await closeDbExec();
});

beforeEach(() => {
  vi.unstubAllEnvs();
  resetAppConfigForTests();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDbExec();
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe("runAppReleaseMigrations", () => {
  it("creates the tables a release-owned hosted boot skips", async () => {
    const table = `rooms_${++seq}`;
    const app = starterApp(table);
    const plugin = (await import(path.join(app, "server/plugins/db.ts")))
      .default as (nitroApp: unknown) => Promise<void>;

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NETLIFY", "true");
    vi.stubEnv("AGENT_NATIVE_RELEASE_MIGRATIONS", "1");
    resetAppConfigForTests();
    await plugin(null);
    // The bug: a release-owned function skips the list at boot, and a
    // framework-only release script never applies it.
    expect(await tableExists(table)).toBe(false);

    vi.unstubAllEnvs();
    resetAppConfigForTests();
    await expect(
      withMigrationRuntime(() => runAppReleaseMigrations(app)),
    ).resolves.toEqual({ status: "applied", plugin: "server/plugins/db.ts" });
    expect(await tableExists(table)).toBe(true);
  });

  it("leaves a managed Drizzle project to db:migrate", async () => {
    const table = `rooms_${++seq}`;
    const app = starterApp(table, {
      "drizzle.config.ts": "export default {};\n",
    });

    await expect(
      withMigrationRuntime(() => runAppReleaseMigrations(app)),
    ).resolves.toEqual({
      status: "managed-drizzle",
      config: "drizzle.config.ts",
    });
    expect(await tableExists(table)).toBe(false);
  });

  it("does nothing for an app without tables of its own", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "starter-app-"));
    dirs.push(dir);
    await expect(runAppReleaseMigrations(dir)).resolves.toEqual({
      status: "no-app-tables",
    });
  });

  it("fails loudly when the plugin is not a migration plugin", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "starter-app-"));
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, "server/plugins"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "server/plugins/db.ts"),
      "export const x = 1;\n",
    );

    await expect(runAppReleaseMigrations(dir)).rejects.toThrow(
      /must default-export its migration plugin/,
    );
  });
});
