import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const identityRows = new Map<string, Record<string, unknown>>();
  return {
    isLocalDatabase: vi.fn(() => false),
    getDatabaseUrl: vi.fn(() => "postgres://db.example/app"),
    getAppConfig: vi.fn(() => ({
      migration: { deployContext: undefined as string | undefined },
    })),
    identityRows,
    mutateSetting: vi.fn(
      async (
        key: string,
        updater: (
          current: Record<string, unknown> | null,
        ) => Record<string, unknown> | Promise<Record<string, unknown>>,
      ) => {
        const current = identityRows.has(key) ? identityRows.get(key)! : null;
        const next = await updater(current);
        identityRows.set(key, next);
        return next;
      },
    ),
    runMigrations: vi.fn(() => vi.fn(async () => {})),
    runBetterAuthMigrations: vi.fn(async () => {}),
    runAutomationRunMigrations: vi.fn(async () => {}),
    runAutomationSchedulerHealthMigrations: vi.fn(async () => {}),
    runFrameworkSchemaEnsures: vi.fn(async () => {}),
    order: [] as string[],
    identitySsoMigrations: [
      {
        version: 1,
        name: "identity-sso-flow-state-and-jti",
        sql: "CREATE TABLE identity_sso_flow_state",
      },
    ],
    agentToolApprovalMigrations: [
      {
        version: 1,
        name: "agent-tool-approvals-table-and-index",
        sql: "CREATE TABLE agent_tool_approvals",
      },
    ],
    remoteDeviceMigrations: [
      {
        version: 1,
        name: "remote-device-table-and-indexes",
        sql: "CREATE TABLE integration_remote_devices",
      },
    ],
  };
});

vi.mock("../agent/context-xray/migrations.js", () => ({
  CONTEXT_XRAY_MIGRATIONS: [],
}));
vi.mock("../agent/observational-memory/migrations.js", () => ({
  OBSERVATIONAL_MEMORY_MIGRATIONS: [],
}));
vi.mock("../agent/tool-approval-migrations.js", () => ({
  AGENT_TOOL_APPROVAL_MIGRATIONS: mocks.agentToolApprovalMigrations,
  AGENT_TOOL_APPROVAL_MIGRATIONS_TABLE: "_agent_tool_approval_migrations",
}));
vi.mock("../app-config/index.js", () => ({
  getAppConfig: mocks.getAppConfig,
}));
vi.mock("../db/client.js", () => ({
  isLocalDatabase: mocks.isLocalDatabase,
  getDatabaseUrl: mocks.getDatabaseUrl,
}));
vi.mock("../db/migrations.js", () => ({
  runMigrations: mocks.runMigrations,
}));
vi.mock("../jobs/run-history.js", () => ({
  runAutomationRunMigrations: mocks.runAutomationRunMigrations,
}));
vi.mock("../settings/store.js", () => ({
  mutateSetting: mocks.mutateSetting,
}));
vi.mock("../jobs/scheduler-health.js", () => ({
  runAutomationSchedulerHealthMigrations:
    mocks.runAutomationSchedulerHealthMigrations,
}));
vi.mock("../oauth-tokens/migrations.js", () => ({
  OAUTH_TOKEN_MIGRATIONS: [],
  OAUTH_TOKEN_MIGRATIONS_TABLE: "_oauth_token_migrations",
}));
vi.mock("../org/migrations.js", () => ({
  ORG_MIGRATIONS: [],
}));
vi.mock("../integrations/remote-device-migrations.js", () => ({
  REMOTE_DEVICE_MIGRATIONS: mocks.remoteDeviceMigrations,
  REMOTE_DEVICE_MIGRATIONS_TABLE: "_remote_device_migrations",
}));
vi.mock("./identity-sso-migrations.js", () => ({
  IDENTITY_SSO_MIGRATIONS: mocks.identitySsoMigrations,
}));
vi.mock("./better-auth-migrations.js", () => ({
  runBetterAuthMigrations: mocks.runBetterAuthMigrations,
}));
vi.mock("./release-schema.js", () => ({
  runFrameworkSchemaEnsures: mocks.runFrameworkSchemaEnsures,
}));

import { DATABASE_IDENTITY_SETTING_KEY } from "./database-identity.js";
import { runFrameworkReleaseMigrations } from "./release-migrations.js";

describe("runFrameworkReleaseMigrations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAppConfig.mockReturnValue({
      migration: { deployContext: undefined },
    });
    mocks.isLocalDatabase.mockReturnValue(false);
    mocks.getDatabaseUrl.mockReturnValue("postgres://db.example/app");
    mocks.identityRows.clear();
    mocks.order.length = 0;
    mocks.runFrameworkSchemaEnsures.mockImplementation(async () => {
      mocks.order.push("schema-ensures");
    });
    mocks.runBetterAuthMigrations.mockImplementation(async () => {
      mocks.order.push("better-auth");
    });
  });

  // Most framework tables have no migration list at all — their only definition
  it("creates the stores' own schema, before the versioned migrations", async () => {
    await runFrameworkReleaseMigrations(null);

    expect(mocks.runFrameworkSchemaEnsures).toHaveBeenCalledTimes(1);
    expect(mocks.order).toEqual(["schema-ensures", "better-auth"]);
  });

  it("propagates a schema-ensure failure instead of migrating on regardless", async () => {
    mocks.runFrameworkSchemaEnsures.mockRejectedValueOnce(new Error("boom"));

    await expect(runFrameworkReleaseMigrations(null)).rejects.toThrow("boom");
    expect(mocks.runBetterAuthMigrations).not.toHaveBeenCalled();
  });

  describe("database identity", () => {
    it("records identity after schema ensures, before the versioned migrations", async () => {
      mocks.getAppConfig.mockReturnValue({
        migration: { deployContext: undefined },
        app: { slug: "chat" },
      });

      await runFrameworkReleaseMigrations(null);

      expect(mocks.mutateSetting).toHaveBeenCalledTimes(1);
      const schemaEnsuresOrder =
        mocks.runFrameworkSchemaEnsures.mock.invocationCallOrder[0];
      const identityOrder = mocks.mutateSetting.mock.invocationCallOrder[0];
      const betterAuthOrder =
        mocks.runBetterAuthMigrations.mock.invocationCallOrder[0];
      expect(identityOrder).toBeGreaterThan(schemaEnsuresOrder);
      expect(identityOrder).toBeLessThan(betterAuthOrder);
      expect(
        mocks.identityRows.get(DATABASE_IDENTITY_SETTING_KEY),
      ).toMatchObject({ app: "chat" });
    });

    it("never lets a second app overwrite the first app recorded for this database (CAS)", async () => {
      mocks.getAppConfig.mockReturnValue({
        migration: { deployContext: undefined },
        app: { slug: "factory" },
      });
      await runFrameworkReleaseMigrations(null);

      mocks.getAppConfig.mockReturnValue({
        migration: { deployContext: undefined },
        app: { slug: "chat" },
      });
      await runFrameworkReleaseMigrations(null);

      expect(
        mocks.identityRows.get(DATABASE_IDENTITY_SETTING_KEY),
      ).toMatchObject({ app: "factory" });
    });

    it("skips without failing the release when no app identity is configured", async () => {
      mocks.getAppConfig.mockReturnValue({
        migration: { deployContext: undefined },
      });

      await expect(
        runFrameworkReleaseMigrations(null),
      ).resolves.toBeUndefined();

      expect(mocks.mutateSetting).not.toHaveBeenCalled();
      expect(mocks.runBetterAuthMigrations).toHaveBeenCalled();
    });

    it("fails the release when recording identity fails, like a schema-ensure failure", async () => {
      mocks.getAppConfig.mockReturnValue({
        migration: { deployContext: undefined },
        app: { slug: "chat" },
      });
      mocks.mutateSetting.mockRejectedValueOnce(new Error("db unreachable"));

      await expect(runFrameworkReleaseMigrations(null)).rejects.toThrow(
        "db unreachable",
      );
      expect(mocks.runBetterAuthMigrations).not.toHaveBeenCalled();
    });
  });

  it("runs the approval schema before request paths can use it", async () => {
    await runFrameworkReleaseMigrations(null);

    expect(mocks.runMigrations).toHaveBeenCalledWith(
      mocks.agentToolApprovalMigrations,
      { table: "_agent_tool_approval_migrations" },
    );
    expect(mocks.runMigrations).toHaveBeenCalledWith(
      mocks.identitySsoMigrations,
      { table: "_identity_sso_migrations" },
    );
    expect(mocks.runMigrations).toHaveBeenCalledWith(
      mocks.remoteDeviceMigrations,
      { table: "_remote_device_migrations" },
    );

    const migrationTables = mocks.runMigrations.mock.calls.map(
      ([, options]) => (options as { table: string }).table,
    );
    expect(migrationTables).toEqual(
      expect.arrayContaining([
        "_chat_thread_schema_migrations",
        "_agent_run_migrations",
        "_agent_harness_session_migrations",
        "_usage_alert_migrations",
      ]),
    );
  });

  it("fails a production release migration that resolved to a local database", async () => {
    mocks.getAppConfig.mockReturnValue({
      migration: { deployContext: "production" },
    });
    mocks.isLocalDatabase.mockReturnValue(true);
    mocks.getDatabaseUrl.mockReturnValue("pglite:/tmp/release-test");

    await expect(runFrameworkReleaseMigrations(null)).rejects.toThrow(
      /unusable database/,
    );
    expect(mocks.runFrameworkSchemaEnsures).not.toHaveBeenCalled();
    expect(mocks.runBetterAuthMigrations).not.toHaveBeenCalled();
  });

  it("allows a local database on a beta branch-deploy build", async () => {
    mocks.getAppConfig.mockReturnValue({
      migration: { deployContext: "branch-deploy" },
    });
    mocks.isLocalDatabase.mockReturnValue(true);

    await expect(runFrameworkReleaseMigrations(null)).resolves.toBeUndefined();
    expect(mocks.runBetterAuthMigrations).toHaveBeenCalled();
  });

  it("fails when the production database url is a masked secret", async () => {
    mocks.getAppConfig.mockReturnValue({
      migration: { deployContext: "production" },
    });
    mocks.isLocalDatabase.mockReturnValue(false);
    mocks.getDatabaseUrl.mockReturnValue("****************uire");

    await expect(runFrameworkReleaseMigrations(null)).rejects.toThrow(
      /masked secret/,
    );
    expect(mocks.runBetterAuthMigrations).not.toHaveBeenCalled();
  });

  it("allows a production release migration against a remote database", async () => {
    mocks.getAppConfig.mockReturnValue({
      migration: { deployContext: "production" },
    });
    mocks.isLocalDatabase.mockReturnValue(false);

    await expect(runFrameworkReleaseMigrations(null)).resolves.toBeUndefined();
    expect(mocks.runBetterAuthMigrations).toHaveBeenCalled();
  });
});
