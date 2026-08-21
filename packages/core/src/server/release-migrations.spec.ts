import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
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
}));

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
vi.mock("../db/migrations.js", () => ({
  runMigrations: mocks.runMigrations,
}));
vi.mock("../jobs/run-history.js", () => ({
  runAutomationRunMigrations: mocks.runAutomationRunMigrations,
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
// Mocked as a unit: `release-schema.ts` imports 60 stores, and stubbing each of
// them here would test vitest's mock resolution rather than the release order.
// `release-schema-complete` guards its contents; this file guards that it runs.
vi.mock("./release-schema.js", () => ({
  runFrameworkSchemaEnsures: mocks.runFrameworkSchemaEnsures,
}));

import { runFrameworkReleaseMigrations } from "./release-migrations.js";

describe("runFrameworkReleaseMigrations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.order.length = 0;
    mocks.runFrameworkSchemaEnsures.mockImplementation(async () => {
      mocks.order.push("schema-ensures");
    });
    mocks.runBetterAuthMigrations.mockImplementation(async () => {
      mocks.order.push("better-auth");
    });
  });

  // Most framework tables have no migration list at all — their only definition
  // is the owning store's `ensureTable()`, which production serverless never
  // runs. Without this call the release step creates a fraction of the schema
  // and reports success.
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
});
