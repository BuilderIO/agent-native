import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runMigrations: vi.fn(() => vi.fn(async () => {})),
  runBetterAuthMigrations: vi.fn(async () => {}),
  runAutomationRunMigrations: vi.fn(async () => {}),
  runAutomationSchedulerHealthMigrations: vi.fn(async () => {}),
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
vi.mock("./identity-sso-migrations.js", () => ({
  IDENTITY_SSO_MIGRATIONS: mocks.identitySsoMigrations,
}));
vi.mock("./better-auth-migrations.js", () => ({
  runBetterAuthMigrations: mocks.runBetterAuthMigrations,
}));

import { runFrameworkReleaseMigrations } from "./release-migrations.js";

describe("runFrameworkReleaseMigrations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
