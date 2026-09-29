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

import { createDbExec, getDbExec } from "./client.js";
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
});
