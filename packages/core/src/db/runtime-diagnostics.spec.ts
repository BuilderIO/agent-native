import { afterEach, describe, expect, it, vi } from "vitest";

const mockExecute = vi.hoisted(() => vi.fn());
const mockIsLocalDatabase = vi.hoisted(() => vi.fn());
const mockRuntimeDatabaseUrl = vi.hoisted(() => vi.fn());
const mockRuntimeDatabaseSource = vi.hoisted(() => vi.fn());
const mockGetAppConfig = vi.hoisted(() =>
  vi.fn(() => ({ runtime: { databaseUrlUnpooled: undefined } })),
);

vi.mock("./client.js", () => ({
  getRuntimeDatabaseUrl: mockRuntimeDatabaseUrl,
  getRuntimeDatabaseSource: mockRuntimeDatabaseSource,
  getDialect: () => "postgres",
  isLocalDatabase: mockIsLocalDatabase,
  getDbExec: () => ({ execute: mockExecute }),
}));
vi.mock("../app-config/index.js", () => ({
  getAppConfig: mockGetAppConfig,
}));

import {
  BETTER_AUTH_REQUIRED_SCHEMA,
  DEFAULT_REQUIRED_SCHEMA,
  formatRuntimeDebugFingerprint,
  getDatabaseRuntimeFingerprint,
  getEffectiveDatabaseEnvStatus,
  getRequiredSchema,
  runDatabaseSchemaHealthCheck,
  type RuntimeDebugFingerprint,
} from "./runtime-diagnostics.js";

afterEach(() => {
  vi.unstubAllEnvs();
  mockRuntimeDatabaseUrl.mockReset();
  mockRuntimeDatabaseSource.mockReset();
  mockIsLocalDatabase.mockReset();
  mockGetAppConfig.mockReset();
  mockGetAppConfig.mockReturnValue({
    runtime: { databaseUrlUnpooled: undefined },
  });
});

describe("runtime diagnostics", () => {
  it("reports only the effective Netlify database without reading scoped secrets", () => {
    vi.stubEnv("APP_NAME", "forms");
    vi.stubEnv("FORMS_DATABASE_URL", "");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("NETLIFY_DATABASE_URL", "postgres://netlify.example/db");
    mockRuntimeDatabaseUrl.mockReturnValue("postgres://netlify.example/db");
    mockRuntimeDatabaseSource.mockReturnValue("NETLIFY_DATABASE_URL");
    mockIsLocalDatabase.mockReturnValue(false);

    expect(getEffectiveDatabaseEnvStatus("DATABASE_URL")).toBe(false);
    expect(getEffectiveDatabaseEnvStatus("NETLIFY_DATABASE_URL")).toBe(true);
    expect(
      getEffectiveDatabaseEnvStatus("DATABASE_AUTH_TOKEN"),
    ).toBeUndefined();
  });

  it("keeps a local effective URL local even when Netlify also has a URL", () => {
    vi.stubEnv("DATABASE_URL", "file:./data/app.db");
    vi.stubEnv("NETLIFY_DATABASE_URL", "postgres://netlify.example/db");
    mockRuntimeDatabaseUrl.mockReturnValue("file:./data/app.db");
    mockRuntimeDatabaseSource.mockReturnValue("DATABASE_URL");
    mockIsLocalDatabase.mockReturnValue(true);

    expect(getEffectiveDatabaseEnvStatus("DATABASE_URL")).toBe(false);
    expect(getEffectiveDatabaseEnvStatus("NETLIFY_DATABASE_URL")).toBe(false);
  });

  it("follows app-prefixed URL precedence when multiple URLs are present", () => {
    vi.stubEnv("APP_NAME", "forms");
    vi.stubEnv("FORMS_DATABASE_URL", "postgres://forms.example/db");
    vi.stubEnv("DATABASE_URL", "postgres://generic.example/db");
    vi.stubEnv("NETLIFY_DATABASE_URL", "postgres://netlify.example/db");
    mockRuntimeDatabaseUrl.mockReturnValue("postgres://forms.example/db");
    mockRuntimeDatabaseSource.mockReturnValue("FORMS_DATABASE_URL");
    mockIsLocalDatabase.mockReturnValue(false);

    expect(getEffectiveDatabaseEnvStatus("FORMS_DATABASE_URL")).toBe(true);
    expect(getEffectiveDatabaseEnvStatus("DATABASE_URL")).toBe(false);
    expect(getEffectiveDatabaseEnvStatus("NETLIFY_DATABASE_URL")).toBe(false);
  });

  it("follows unpooled URL precedence for request-time clients", () => {
    vi.stubEnv("APP_NAME", "forms");
    vi.stubEnv(
      "FORMS_DATABASE_URL_UNPOOLED",
      "postgres://forms-direct.example/db",
    );
    vi.stubEnv("FORMS_DATABASE_URL", "postgres://forms.example/db");
    vi.stubEnv("DATABASE_URL", "postgres://generic.example/db");
    vi.stubEnv("NETLIFY_DATABASE_URL", "postgres://netlify.example/db");
    mockRuntimeDatabaseUrl.mockReturnValue(
      "postgres://forms-direct.example/db",
    );
    mockRuntimeDatabaseSource.mockReturnValue("FORMS_DATABASE_URL_UNPOOLED");
    mockIsLocalDatabase.mockReturnValue(false);

    expect(getEffectiveDatabaseEnvStatus("FORMS_DATABASE_URL_UNPOOLED")).toBe(
      true,
    );
    expect(getEffectiveDatabaseEnvStatus("FORMS_DATABASE_URL")).toBe(false);
    expect(getEffectiveDatabaseEnvStatus("DATABASE_URL")).toBe(false);
    expect(getEffectiveDatabaseEnvStatus("NETLIFY_DATABASE_URL")).toBe(false);
  });

  it("reports an unpooled Netlify URL when it is the only remote database", () => {
    vi.stubEnv("APP_NAME", "forms");
    vi.stubEnv("FORMS_DATABASE_URL", "");
    vi.stubEnv("FORMS_DATABASE_URL_UNPOOLED", "");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("NETLIFY_DATABASE_URL", "");
    vi.stubEnv(
      "NETLIFY_DATABASE_URL_UNPOOLED",
      "postgres://netlify-direct.example/db",
    );
    mockRuntimeDatabaseUrl.mockReturnValue(
      "postgres://netlify-direct.example/db",
    );
    mockRuntimeDatabaseSource.mockReturnValue("NETLIFY_DATABASE_URL_UNPOOLED");
    mockIsLocalDatabase.mockReturnValue(false);

    expect(getEffectiveDatabaseEnvStatus("NETLIFY_DATABASE_URL_UNPOOLED")).toBe(
      true,
    );
    expect(getEffectiveDatabaseEnvStatus("DATABASE_URL")).toBe(false);
  });

  it("reports an app-configured unpooled URL through the canonical status key", () => {
    vi.stubEnv("APP_NAME", "forms");
    vi.stubEnv("FORMS_DATABASE_URL", "");
    vi.stubEnv("FORMS_DATABASE_URL_UNPOOLED", "");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("DATABASE_URL_UNPOOLED", "");
    vi.stubEnv("NETLIFY_DATABASE_URL", "");
    vi.stubEnv(
      "NETLIFY_DATABASE_URL_UNPOOLED",
      "postgres://netlify-direct.example/db",
    );
    mockGetAppConfig.mockReturnValue({
      runtime: { databaseUrlUnpooled: "postgres://configured.example/db" },
    });
    mockRuntimeDatabaseUrl.mockReturnValue("postgres://configured.example/db");
    mockRuntimeDatabaseSource.mockReturnValue("DATABASE_URL_UNPOOLED");
    mockIsLocalDatabase.mockReturnValue(false);

    expect(getEffectiveDatabaseEnvStatus("DATABASE_URL_UNPOOLED")).toBe(true);
    expect(getEffectiveDatabaseEnvStatus("NETLIFY_DATABASE_URL_UNPOOLED")).toBe(
      false,
    );
    expect(getEffectiveDatabaseEnvStatus("DATABASE_URL")).toBe(false);
  });

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

  it("fingerprints a pooled and unpooled URL to the same Neon database identically", () => {
    mockRuntimeDatabaseSource.mockReturnValue("DATABASE_URL");

    mockRuntimeDatabaseUrl.mockReturnValue(
      "postgres://user:pw@ep-round-heart-pooler.us-east-1.aws.neon.tech/neondb",
    );
    const pooled = getDatabaseRuntimeFingerprint();

    mockRuntimeDatabaseUrl.mockReturnValue(
      "postgres://user:pw@ep-round-heart.us-east-1.aws.neon.tech/neondb",
    );
    const unpooled = getDatabaseRuntimeFingerprint();

    expect(pooled.fingerprint).toBeTruthy();
    expect(pooled.fingerprint).toBe(unpooled.fingerprint);
    expect(pooled.fingerprint).not.toContain("pw");
  });

  it("fingerprints different databases differently", () => {
    mockRuntimeDatabaseSource.mockReturnValue("DATABASE_URL");

    mockRuntimeDatabaseUrl.mockReturnValue(
      "postgres://user:pw@ep-round-heart-pooler.us-east-1.aws.neon.tech/neondb",
    );
    const first = getDatabaseRuntimeFingerprint();

    mockRuntimeDatabaseUrl.mockReturnValue(
      "postgres://user:pw@ep-other-endpoint-pooler.us-east-1.aws.neon.tech/neondb",
    );
    const second = getDatabaseRuntimeFingerprint();

    expect(first.fingerprint).not.toBe(second.fingerprint);
  });

  it("reports no fingerprint when no database is configured", () => {
    mockRuntimeDatabaseUrl.mockReturnValue("");
    mockRuntimeDatabaseSource.mockReturnValue("DATABASE_URL");

    expect(getDatabaseRuntimeFingerprint().fingerprint).toBeUndefined();
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
    // Pin the default required set to DEFAULT_REQUIRED_SCHEMA alone — this
    // test is about memoization mechanics, not about Better Auth's tables.
    vi.stubEnv("AUTH_DISABLED", "1");

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

  it("requires Better Auth's tables only when auth is enabled", () => {
    expect(getRequiredSchema(true)).toEqual([
      ...DEFAULT_REQUIRED_SCHEMA,
      ...BETTER_AUTH_REQUIRED_SCHEMA,
    ]);
    expect(getRequiredSchema(false)).toEqual(DEFAULT_REQUIRED_SCHEMA);
  });

  it("reads AUTH_DISABLED for the default required set", () => {
    vi.stubEnv("AUTH_DISABLED", "true");
    expect(getRequiredSchema()).toEqual(DEFAULT_REQUIRED_SCHEMA);

    vi.stubEnv("AUTH_DISABLED", "");
    expect(getRequiredSchema()).toEqual([
      ...DEFAULT_REQUIRED_SCHEMA,
      ...BETTER_AUTH_REQUIRED_SCHEMA,
    ]);
  });

  it("reports a missing jwks table when auth is enabled", async () => {
    mockExecute.mockReset();
    mockExecute.mockImplementation(async (query: unknown) => {
      const table =
        typeof query === "string" ? "" : String((query as any).args?.[0] ?? "");
      if (table === "jwks") return { rows: [], rowsAffected: 0 };
      const required =
        [...DEFAULT_REQUIRED_SCHEMA, ...BETTER_AUTH_REQUIRED_SCHEMA].find(
          (r) => r.table === table,
        )?.columns ?? [];
      return {
        rows: required.map((column) => ({ column_name: column })),
        rowsAffected: 0,
      };
    });

    // Explicit `dialect` bypasses the healthy-probe memo left by an earlier
    // test — this checks the DEFAULT required set, not the memo mechanics.
    const result = await runDatabaseSchemaHealthCheck({ dialect: "postgres" });

    expect(result.ok).toBe(false);
    expect(result.missingTables).toContain("jwks");
  });

  it("does not require jwks (or the rest of Better Auth) when auth is disabled", async () => {
    vi.stubEnv("AUTH_DISABLED", "1");
    mockExecute.mockReset();
    mockExecute.mockImplementation(async (query: unknown) => {
      const table =
        typeof query === "string" ? "" : String((query as any).args?.[0] ?? "");
      // Only the framework's own tables answer — no Better Auth tables exist.
      const required =
        DEFAULT_REQUIRED_SCHEMA.find((r) => r.table === table)?.columns ?? [];
      return {
        rows: required.map((column) => ({ column_name: column })),
        rowsAffected: 0,
      };
    });

    const result = await runDatabaseSchemaHealthCheck({ dialect: "postgres" });

    expect(result.ok).toBe(true);
    expect(result.missingTables).not.toContain("jwks");
  });
});
