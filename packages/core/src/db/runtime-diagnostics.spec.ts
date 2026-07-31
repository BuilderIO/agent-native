import { describe, expect, it, vi } from "vitest";

const mockExecute = vi.hoisted(() => vi.fn());

vi.mock("./client.js", () => ({
  getDatabaseUrl: () => "postgres://localhost/test",
  getDialect: () => "postgres",
  getDbExec: () => ({ execute: mockExecute }),
}));

import {
  DEFAULT_REQUIRED_SCHEMA,
  formatRuntimeDebugFingerprint,
  runDatabaseSchemaHealthCheck,
  type RuntimeDebugFingerprint,
} from "./runtime-diagnostics.js";

describe("runtime diagnostics", () => {
  it("formats runtime debug details without leaking credentials", () => {
    const details = formatRuntimeDebugFingerprint({
      app: "design",
      environment: "production",
      deployContext: "production",
      commitRef: "abc123",
      database: {
        configured: true,
        source: "DESIGN_DATABASE_URL",
        dialect: "postgres",
        protocol: "postgresql",
        host: "ep-round-heart-pooler.us-east-1.aws.neon.tech",
        database: "neondb",
        urlHash: "cafef00d1234",
        authTokenConfigured: false,
        netlifyDatabaseUrlConfigured: true,
        neon: {
          endpointId: "ep-round-heart",
          pooled: true,
          projectHost: "us-east-1.aws.neon.tech",
        },
      },
    } satisfies RuntimeDebugFingerprint);

    expect(details).toContain("app: design");
    expect(details).toContain("db_source: DESIGN_DATABASE_URL");
    expect(details).toContain("db_url_hash: cafef00d1234");
    expect(details).toContain("db_neon_pooled: true");
    expect(details).not.toContain("postgresql://");
    expect(details).not.toContain("password");
  });

  it("reports missing tables and columns from metadata probes", async () => {
    const result = await runDatabaseSchemaHealthCheck({
      dialect: "postgres",
      required: [
        { table: "agent_runs", columns: ["id", "worker_stage"] },
        { table: "chat_threads", columns: ["id"] },
      ],
      exec: {
        async execute(query) {
          const table =
            typeof query === "string" ? "" : String(query.args?.[0] ?? "");
          if (table === "agent_runs") {
            return {
              rows: [{ column_name: "id" }],
              rowsAffected: 0,
            };
          }
          return { rows: [], rowsAffected: 0 };
        },
      },
    });

    expect(result).toMatchObject({
      ok: false,
      checked: true,
      missingTables: ["chat_threads"],
      missingColumns: [{ table: "agent_runs", column: "worker_stage" }],
    });
  });

  it("memoizes a healthy default probe but never an unhealthy one", async () => {
    // Unhealthy first: a probe that reports a problem must be re-run, or the
    // migration that fixes it stays invisible for the memo window.
    mockExecute.mockReset();
    mockExecute.mockResolvedValue({ rows: [], rowsAffected: 0 });
    expect((await runDatabaseSchemaHealthCheck()).ok).toBe(false);
    const afterMissing = mockExecute.mock.calls.length;
    expect(afterMissing).toBeGreaterThan(0);

    expect((await runDatabaseSchemaHealthCheck()).ok).toBe(false);
    expect(mockExecute.mock.calls.length).toBe(afterMissing * 2);

    // Healthy: answer every column probe, then the second call must not query.
    mockExecute.mockImplementation(async (query: unknown) => {
      const table =
        typeof query === "string" ? "" : String((query as any).args?.[0] ?? "");
      const required =
        DEFAULT_REQUIRED_SCHEMA.find((r) => r.table === table)?.columns ?? [];
      return {
        rows: required.map((column) => ({ column_name: column })),
        rowsAffected: 0,
      };
    });
    mockExecute.mockClear();
    expect((await runDatabaseSchemaHealthCheck()).ok).toBe(true);
    const probes = mockExecute.mock.calls.length;
    expect(probes).toBeGreaterThan(0);

    mockExecute.mockClear();
    expect((await runDatabaseSchemaHealthCheck()).ok).toBe(true);
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
