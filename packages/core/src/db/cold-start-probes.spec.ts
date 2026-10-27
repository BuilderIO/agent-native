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
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.resetModules();
  });

  it.each([
    ["Netlify", "", undefined, false],
    ["deployed Cloudflare", "", true, false],
    ["local Wrangler", "", false, true],
  ] as const)(
    "%s follows its runtime marker for release-owned schema preparation",
    async (provider, nodeEnv, cloudflareProduction, expectsQueries) => {
      vi.stubEnv("NODE_ENV", nodeEnv);
      state.execute.mockImplementation(async (query: any) => ({
        rows:
          provider === "local Wrangler" &&
          String(typeof query === "string" ? query : query?.sql).includes(
            "pg_indexes AS indexes",
          )
            ? [{ indexname: "cold_start_probe_concurrent_idx" }]
            : [],
        rowsAffected: 0,
      }));
      if (provider === "Netlify") {
        vi.stubEnv("NETLIFY_FUNCTION_NAME", "docs");
      } else {
        vi.stubGlobal("__env__", {});
        vi.stubGlobal(
          "__AGENT_NATIVE_CLOUDFLARE_PRODUCTION__",
          cloudflareProduction,
        );
      }
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
      await additive.ensureAdditiveColumns({
        db: client,
        tables: [probeTable],
      });
      await widen.widenIntColumnsToBigInt("cold_start_probe", ["id"], client);
      await migrations.runMigrations(
        [{ version: 1, name: "cold-start", sql: "SELECT 1" }],
        { table: "_context_xray_migrations" },
      )(null);

      if (expectsQueries) {
        expect(state.execute).toHaveBeenCalled();
        expect(state.getDbExec).toHaveBeenCalled();
      } else {
        expect(state.execute).not.toHaveBeenCalled();
        expect(state.getDbExec).not.toHaveBeenCalled();
      }
    },
  );
});
