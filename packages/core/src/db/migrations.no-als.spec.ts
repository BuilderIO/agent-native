import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../shared/optional-node-builtins.js", () => ({
  getAsyncLocalStorageCtor: () => undefined,
}));

vi.mock("./client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client.js")>();
  return {
    ...actual,
    getMigrationDatabaseUrl: vi.fn(() => ""),
    getDbExec: vi.fn(),
    createDbExec: vi.fn(),
  };
});

import {
  assertSchemaMutationAllowed,
  createDbExec,
  getDbExec,
} from "./client.js";
import { withMigrationExecutionRuntime } from "./migration-runtime.js";
import { runMigrations } from "./migrations.js";

describe("runMigrations without AsyncLocalStorage", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("skips release-owned migrations before entering the migration runtime", async () => {
    vi.stubEnv("NODE_ENV", "");
    vi.stubEnv("NETLIFY_FUNCTION_NAME", "docs");
    vi.stubEnv("AGENT_NATIVE_RELEASE_MIGRATIONS", "1");

    await expect(
      runMigrations([{ version: 1, sql: "CREATE TABLE docs (id TEXT)" }], {
        table: "docs_migrations",
      })(null),
    ).resolves.toBeUndefined();

    expect(getDbExec).not.toHaveBeenCalled();
    expect(createDbExec).not.toHaveBeenCalled();
  });

  it("loads isolated AsyncLocalStorage for legacy hosted migrations", async () => {
    vi.stubEnv("NODE_ENV", "");
    vi.stubEnv("NETLIFY_FUNCTION_NAME", "legacy-app");

    let migrationEntered!: () => void;
    let finishMigration!: () => void;
    const entered = new Promise<void>((resolve) => {
      migrationEntered = resolve;
    });
    const waitForFinish = new Promise<void>((resolve) => {
      finishMigration = resolve;
    });

    expect(() =>
      assertSchemaMutationAllowed("CREATE TABLE runtime_migration (id TEXT)"),
    ).toThrow(/release job/);

    const migration = withMigrationExecutionRuntime(async () => {
      expect(() =>
        assertSchemaMutationAllowed("CREATE TABLE runtime_migration (id TEXT)"),
      ).not.toThrow();
      migrationEntered();
      await waitForFinish;
    });
    await entered;

    expect(() =>
      assertSchemaMutationAllowed("CREATE TABLE runtime_migration (id TEXT)"),
    ).toThrow(/release job/);

    finishMigration();
    await migration;

    expect(() =>
      assertSchemaMutationAllowed("CREATE TABLE runtime_migration (id TEXT)"),
    ).toThrow(/release job/);
  });
});
