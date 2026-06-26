import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runQuery: vi.fn(),
  replaceStrategicAccounts: vi.fn(),
  listStrategicAccounts: vi.fn(),
  getDashboard: vi.fn(),
  upsertDashboard: vi.fn(),
  orgId: null as string | null,
  email: "alice@example.com" as string | null,
}));

vi.mock("@agent-native/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agent-native/core")>();
  return { ...actual };
});

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: vi.fn(
    ({ app, view }: { app: string; view: string }) => `/${app}/${view}`,
  ),
  getRequestOrgId: () => mocks.orgId,
  getRequestUserEmail: () => mocks.email,
}));

vi.mock("../server/lib/bigquery", () => ({ runQuery: mocks.runQuery }));
vi.mock("../server/lib/strategic-accounts-store", () => ({
  replaceStrategicAccounts: mocks.replaceStrategicAccounts,
  listStrategicAccounts: mocks.listStrategicAccounts,
}));
vi.mock("../server/lib/dashboards-store", () => ({
  getDashboard: mocks.getDashboard,
  upsertDashboard: mocks.upsertDashboard,
}));

const { default: generateAction } =
  await import("./generate-strategic-accounts-roster");

beforeEach(() => {
  mocks.runQuery.mockReset();
  mocks.replaceStrategicAccounts.mockReset();
  mocks.listStrategicAccounts.mockReset();
  mocks.listStrategicAccounts.mockResolvedValue([]);
  mocks.getDashboard.mockReset();
  mocks.upsertDashboard.mockReset();
  mocks.orgId = null;
  mocks.email = "alice@example.com";
});

describe("generate-strategic-accounts-roster", () => {
  it("ranks warehouse rows, writes the roster, and syncs the dashboard variable", async () => {
    mocks.runQuery.mockResolvedValue({
      rows: [
        { company_name: "Acme", active_users: 50 },
        { company_name: "Globex", active_users: 20 },
        { company_name: "  ", active_users: 5 },
      ],
    });
    mocks.replaceStrategicAccounts.mockImplementation(async (rows: any[]) =>
      rows.map((r, i) => ({ id: String(i), ...r })),
    );
    mocks.getDashboard.mockResolvedValue({
      kind: "sql",
      config: { name: "Strategic Accounts", variables: { accounts: "old" } },
    });
    mocks.upsertDashboard.mockResolvedValue(undefined);

    const result = (await generateAction.run({})) as {
      ok: boolean;
      count: number;
      accountsPipe: string;
      dashboardSynced: boolean;
    };

    expect(result.ok).toBe(true);
    expect(result.count).toBe(2);
    expect(result.accountsPipe).toBe("Acme|Globex");
    expect(result.dashboardSynced).toBe(true);
    // Roster written with sortOrder reflecting rank, blanks dropped.
    expect(mocks.replaceStrategicAccounts).toHaveBeenCalledWith(
      [
        {
          companyName: "Acme",
          sortOrder: 0,
          companyId: null,
          deploymentStatus: "",
          notes: "",
        },
        {
          companyName: "Globex",
          sortOrder: 1,
          companyId: null,
          deploymentStatus: "",
          notes: "",
        },
      ],
      { email: "alice@example.com", orgId: null },
    );
    // Dashboard variable updated to the new pipe list.
    expect(mocks.upsertDashboard).toHaveBeenCalledWith(
      "strategic-accounts",
      "sql",
      expect.objectContaining({
        variables: expect.objectContaining({ accounts: "Acme|Globex" }),
      }),
      { email: "alice@example.com", orgId: null },
    );
  });

  it("preserves manually-curated metadata for companies that already exist", async () => {
    mocks.runQuery.mockResolvedValue({
      rows: [
        { company_name: "Acme", active_users: 50 },
        { company_name: "Globex", active_users: 20 },
      ],
    });
    mocks.listStrategicAccounts.mockResolvedValue([
      {
        id: "x",
        companyName: "Acme",
        companyId: "org_123",
        deploymentStatus: "live",
        notes: "key account",
        sortOrder: 5,
      },
    ]);
    mocks.replaceStrategicAccounts.mockImplementation(async (rows: any[]) =>
      rows.map((r, i) => ({ id: String(i), ...r })),
    );
    mocks.getDashboard.mockResolvedValue(null);

    await generateAction.run({});

    expect(mocks.replaceStrategicAccounts).toHaveBeenCalledWith(
      [
        {
          companyName: "Acme",
          sortOrder: 0,
          companyId: "org_123",
          deploymentStatus: "live",
          notes: "key account",
        },
        {
          companyName: "Globex",
          sortOrder: 1,
          companyId: null,
          deploymentStatus: "",
          notes: "",
        },
      ],
      { email: "alice@example.com", orgId: null },
    );
  });

  it("dryRun previews without writing", async () => {
    mocks.runQuery.mockResolvedValue({
      rows: [{ company_name: "Acme", active_users: 9 }],
    });
    const result = (await generateAction.run({ dryRun: true })) as {
      dryRun: boolean;
      count: number;
    };
    expect(result.dryRun).toBe(true);
    expect(result.count).toBe(1);
    expect(mocks.replaceStrategicAccounts).not.toHaveBeenCalled();
    expect(mocks.upsertDashboard).not.toHaveBeenCalled();
  });

  it("succeeds even when the dashboard doesn't exist yet", async () => {
    mocks.runQuery.mockResolvedValue({
      rows: [{ company_name: "Acme", active_users: 9 }],
    });
    mocks.replaceStrategicAccounts.mockResolvedValue([
      { id: "0", companyName: "Acme", sortOrder: 0 },
    ]);
    mocks.getDashboard.mockResolvedValue(null);
    const result = (await generateAction.run({})) as {
      ok: boolean;
      dashboardSynced: boolean;
    };
    expect(result.ok).toBe(true);
    expect(result.dashboardSynced).toBe(false);
  });

  it("throws when unauthenticated", async () => {
    mocks.email = null;
    await expect(generateAction.run({})).rejects.toThrow(
      "no authenticated user",
    );
  });
});
