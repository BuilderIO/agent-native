import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  getRequestOrgId: vi.fn(() => "org-1"),
  getRequestUserEmail: vi.fn(() => "admin@example.com"),
  ready: vi.fn(async () => undefined),
}));

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: mocks.execute }),
  isUniqueViolation: () => false,
  safeJsonParse: <T>(_value: unknown, fallback: T) => fallback,
}));

vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: vi.fn(),
  ensureIndexExists: vi.fn(),
  ensureTableExists: vi.fn(),
}));

vi.mock("../db/store-registry.js", () => ({
  defineStore: () => ({ ready: mocks.ready }),
}));

vi.mock("../db/versioned-store-migrations.js", () => ({
  fromMigrationEntries: () => [],
}));

vi.mock("../server/request-context.js", () => ({
  getRequestOrgId: mocks.getRequestOrgId,
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("./groups.js", () => ({
  assertWorkspaceUserGroupIds: vi.fn(),
  normalizeWorkspaceUserGroupIds: vi.fn(() => []),
  workspaceUserGroupsIncludeUser: vi.fn(),
}));

vi.mock("./lifecycle.js", () => ({
  notifyWorkspaceConnectionLifecycle: vi.fn(),
}));

const { setWorkspaceConnectionAgentDiscoveryPreference } =
  await import("./index.js");

describe("setWorkspaceConnectionAgentDiscoveryPreference", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue({ rows: [], rowsAffected: 1 });
  });

  it("updates only the scoped app preference in connection config", async () => {
    await setWorkspaceConnectionAgentDiscoveryPreference(
      " connection-1 ",
      true,
    );

    expect(mocks.execute).toHaveBeenCalledOnce();
    const statement = mocks.execute.mock.calls[0]?.[0] as {
      sql: string;
      args: unknown[];
    };
    expect(statement.sql).toContain("SET config_json = jsonb_set(");
    expect(statement.sql).toContain("'{includeInAgentDiscovery}'");
    expect(statement.sql).toContain("WHERE id = ? AND org_id = ?");
    expect(statement.sql).not.toMatch(
      /SET[^\n]*(?:provider|label|status|updated_at)/,
    );
    expect(statement.args).toEqual([true, "connection-1", "org-1"]);
  });

  it("does not claim success when the connection is outside request scope", async () => {
    mocks.execute.mockResolvedValue({ rows: [], rowsAffected: 0 });

    await expect(
      setWorkspaceConnectionAgentDiscoveryPreference(
        "connection-foreign",
        false,
      ),
    ).rejects.toThrow("not found in the current request scope");
  });

  it("rejects a blank connection id without issuing an update", async () => {
    await expect(
      setWorkspaceConnectionAgentDiscoveryPreference("  ", false),
    ).rejects.toThrow("requires a connection id");
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
