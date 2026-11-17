import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settings: new Map<string, Record<string, unknown>>(),
  role: "admin" as string | null,
  memberRole: "member" as string | null,
}));

vi.mock("@agent-native/core/settings", () => ({
  mutateOrgSetting: async (
    orgId: string,
    key: string,
    update: (
      current: Record<string, unknown> | null,
    ) => Record<string, unknown>,
  ) => {
    const next = update(mocks.settings.get(`${orgId}:${key}`) ?? null);
    mocks.settings.set(`${orgId}:${key}`, next);
    return next;
  },
  getOrgSetting: async (orgId: string, key: string) =>
    mocks.settings.get(`${orgId}:${key}`) ?? null,
}));
vi.mock("../server/lib/db-admin-connections", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/lib/db-admin-connections")>();
  return {
    ...actual,
    requireAnalyticsAdminContext: async () => {
      if (mocks.role !== "admin" && mocks.role !== "owner") {
        throw new actual.DbAdminConnectionError(
          403,
          "Only organization owners and admins can use Analytics admin tools.",
        );
      }
      return {
        userEmail: "admin@example.com",
        orgId: "org-1",
        role: mocks.role,
      };
    },
    resolveOrgRole: async () => mocks.memberRole,
  };
});

const { default: setBudget } = await import("./set-bigquery-agent-budget");
const {
  BIGQUERY_AGENT_BUDGET_SETTING_KEY,
  outsideAgentLimits,
  readBigQueryAgentBudgetOverrides,
} = await import("../server/lib/bigquery-agent-budget");
const { billedBytesForUsd } = await import("../server/lib/bigquery-pricing");

beforeEach(() => {
  mocks.settings.clear();
  mocks.role = "admin";
  mocks.memberRole = "member";
});

describe("set-bigquery-agent-budget", () => {
  it("lets an admin raise the org limit and one member's allowance, and reset them", async () => {
    await setBudget.run(
      { scope: "org", dailyLimitUsd: 120 },
      { caller: "tool" },
    );
    const person = (await setBudget.run(
      { scope: "person", email: "Bob@Example.com", dailyLimitUsd: 12 },
      { caller: "tool" },
    )) as { limits: Record<string, any> };
    expect(person.limits).toMatchObject({
      perJobCapUsd: 0.2842,
      org: { dailyLimitUsd: 120, source: "admin" },
      person: {
        email: "bob@example.com",
        noAskDailyAllowanceUsd: 12,
        dailyCeilingUsd: 12,
        source: "admin",
      },
    });

    const overrides = await readBigQueryAgentBudgetOverrides("org-1");
    const limits = outsideAgentLimits(
      { ownerEmail: "bob@example.com", orgId: "org-1" },
      overrides,
    );
    expect(limits.personBaseBytes).toBe(billedBytesForUsd(12));
    expect(limits.orgLimitBytes).toBe(billedBytesForUsd(120));
    expect(
      mocks.settings.get(`org-1:${BIGQUERY_AGENT_BUDGET_SETTING_KEY}`),
    ).toMatchObject({
      updatedBy: "admin@example.com",
    });

    await setBudget.run(
      { scope: "person", email: "bob@example.com", dailyLimitUsd: null },
      { caller: "tool" },
    );
    const reset = outsideAgentLimits(
      { ownerEmail: "bob@example.com", orgId: "org-1" },
      await readBigQueryAgentBudgetOverrides("org-1"),
    );
    expect(reset.source).toEqual({ person: "default", org: "admin" });
  });

  it("refuses members who are not admins", async () => {
    mocks.role = "member";
    await expect(
      setBudget.run({ scope: "org", dailyLimitUsd: 500 }, { caller: "tool" }),
    ).rejects.toMatchObject({ errorCode: "forbidden", statusCode: 403 });
    expect(mocks.settings.size).toBe(0);
  });

  it.each(["mcp", "a2a"] as const)(
    "refuses an outside agent (%s), even one acting for an admin",
    async (caller) => {
      await expect(
        setBudget.run({ scope: "org", dailyLimitUsd: 500 }, { caller }),
      ).rejects.toMatchObject({ errorCode: "forbidden" });
      expect(mocks.settings.size).toBe(0);
    },
  );

  it("refuses someone outside the org and a limit past the sanity ceiling", async () => {
    mocks.memberRole = null;
    await expect(
      setBudget.run(
        { scope: "person", email: "stranger@example.com", dailyLimitUsd: 2 },
        { caller: "tool" },
      ),
    ).rejects.toMatchObject({ errorCode: "not_a_member" });
    await expect(
      setBudget.run(
        { scope: "org", dailyLimitUsd: 50_000 },
        { caller: "tool" },
      ),
    ).rejects.toThrow(/at most/);
  });
});
