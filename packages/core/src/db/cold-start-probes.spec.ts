import { pgTable, text } from "drizzle-orm/pg-core";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  execute: vi.fn(async () => ({ rows: [], rowsAffected: 0 })),
  getDbExec: vi.fn(),
}));

vi.mock("./client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client.js")>();
  return {
    ...actual,
    getDbExec: state.getDbExec,
  };
});

const probeTable = pgTable("cold_start_probe", { id: text("id") });
const client = { execute: state.execute } as any;

describe("cold production function database initialization", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("issues no catalog or migration-table queries when NODE_ENV is unset", async () => {
    vi.stubEnv("NODE_ENV", "");
    vi.stubEnv("NETLIFY_FUNCTION_NAME", "docs");
    vi.stubEnv("AGENT_NATIVE_RELEASE_MIGRATIONS", "1");

    const [ddl, additive, widen, migrations] = await Promise.all([
      import("./ddl-guard.js"),
      import("./ensure-additive-columns.js"),
      import("./widen-columns.js"),
      import("./migrations.js"),
    ]);

    await ddl.ensureTableExists(
      "cold_start_probe",
      "CREATE TABLE cold_start_probe (id TEXT)",
      { injectedClient: client },
    );
    await ddl.ensureIndexExists(
      "cold_start_probe_idx",
      "CREATE INDEX cold_start_probe_idx ON cold_start_probe (id)",
      { injectedClient: client },
    );
    await ddl.ensureIndexExistsConcurrently(
      "cold_start_probe_concurrent_idx",
      "CREATE INDEX CONCURRENTLY cold_start_probe_concurrent_idx ON cold_start_probe (id)",
      { injectedClient: client },
    );
    await additive.ensureAdditiveColumns({ db: client, tables: [probeTable] });
    await widen.widenIntColumnsToBigInt("cold_start_probe", ["id"], client);
    await migrations.runMigrations(
      [{ version: 1, name: "cold-start", sql: "SELECT 1" }],
      { table: "_context_xray_migrations" },
    )(null);

    expect(state.execute).not.toHaveBeenCalled();
    expect(state.getDbExec).not.toHaveBeenCalled();
  });
});
