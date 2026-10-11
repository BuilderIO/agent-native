import { beforeEach, describe, expect, it, vi } from "vitest";

const orgSettings = new Map<string, Record<string, unknown>>();
const requireAnalyticsAdminContext = vi.fn();
const putOrgSetting = vi.fn(
  async (orgId: string, key: string, value: Record<string, unknown>) => {
    orgSettings.set(`${orgId}:${key}`, value);
  },
);

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: () => "org-1",
  getRequestUserEmail: () => "admin@example.com",
}));

vi.mock("@agent-native/core/settings", () => ({
  getOrgSetting: vi.fn(),
  putOrgSetting,
}));

vi.mock("../server/lib/db-admin-connections.js", () => ({
  requireAnalyticsAdminContext,
}));

const { default: setDbtRepository } = await import("./set-dbt-repository");

const ctx = { appId: "analytics" } as never;

describe("set-dbt-repository action", () => {
  beforeEach(() => {
    orgSettings.clear();
    putOrgSetting.mockClear();
    requireAnalyticsAdminContext.mockReset();
    requireAnalyticsAdminContext.mockResolvedValue({
      userEmail: "admin@example.com",
      orgId: "org-1",
      role: "owner",
    });
  });

  it("stores the owner and repo under the organization's dbt setting", async () => {
    const result = await setDbtRepository.run(
      { owner: "acme", repo: "analytics-dbt" },
      ctx,
    );

    expect(putOrgSetting).toHaveBeenCalledWith(
      "org-1",
      "analytics-dbt-repository",
      { owner: "acme", repo: "analytics-dbt" },
    );
    expect(result).toEqual({ owner: "acme", repo: "analytics-dbt" });
    expect(orgSettings.get("org-1:analytics-dbt-repository")).toEqual(result);
  });

  it.each([
    ["owner with a slash", { owner: "acme/evil", repo: "dbt" }],
    ["owner with a space", { owner: "bad owner", repo: "dbt" }],
    ["empty owner", { owner: "", repo: "dbt" }],
    ["owner of two dots", { owner: "..", repo: "dbt" }],
    ["owner of one dot", { owner: ".", repo: "dbt" }],
    ["repo with a space", { owner: "acme", repo: "bad repo" }],
    ["repo of two dots", { owner: "acme", repo: ".." }],
    ["repo over 100 characters", { owner: "acme", repo: "a".repeat(101) }],
    ["extra field", { owner: "acme", repo: "dbt", branch: "main" }],
  ])(
    "rejects %s before checking the role or writing",
    async (_label, input) => {
      await expect(setDbtRepository.run(input, ctx)).rejects.toThrow();

      expect(requireAnalyticsAdminContext).not.toHaveBeenCalled();
      expect(putOrgSetting).not.toHaveBeenCalled();
      expect(orgSettings.size).toBe(0);
    },
  );

  it("refuses non-admins before writing anything", async () => {
    requireAnalyticsAdminContext.mockRejectedValue(
      new Error(
        "Only organization owners and admins can use Analytics admin tools.",
      ),
    );

    await expect(
      setDbtRepository.run({ owner: "acme", repo: "dbt" }, ctx),
    ).rejects.toThrow(/owners and admins/);

    expect(putOrgSetting).not.toHaveBeenCalled();
    expect(orgSettings.size).toBe(0);
  });
});
