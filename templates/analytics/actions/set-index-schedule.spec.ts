import { beforeEach, describe, expect, it, vi } from "vitest";

const orgSettings = new Map<string, Record<string, unknown>>();
const requireAnalyticsAdminContext = vi.fn();
const defineAutomation = vi.fn();
const updateAutomation = vi.fn();
const listAutomationDefinitions = vi.fn();

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: () => "org-1",
  getRequestUserEmail: () => "admin@example.com",
}));

vi.mock("@agent-native/core/settings", () => ({
  getOrgSetting: vi.fn(
    async (orgId: string, key: string) =>
      orgSettings.get(`${orgId}:${key}`) ?? null,
  ),
  putOrgSetting: vi.fn(
    async (orgId: string, key: string, value: Record<string, unknown>) => {
      orgSettings.set(`${orgId}:${key}`, value);
    },
  ),
}));

vi.mock("@agent-native/core/triggers", () => ({
  defineAutomation,
  listAutomationDefinitions,
  updateAutomation,
}));

vi.mock("../server/lib/db-admin-connections.js", () => ({
  requireAnalyticsAdminContext,
}));

const { default: setIndexSchedule } = await import("./set-index-schedule");

const ctx = { appId: "analytics" } as never;
const actor = {
  userEmail: "admin@example.com",
  orgId: "org-1",
  appId: "analytics",
};

function storeSchedule(value: Record<string, unknown>) {
  orgSettings.set(`org-1:analytics-index-schedule`, value);
}

describe("set-index-schedule action", () => {
  beforeEach(() => {
    orgSettings.clear();
    defineAutomation.mockReset();
    updateAutomation.mockReset();
    listAutomationDefinitions.mockReset();
    requireAnalyticsAdminContext.mockReset();
    requireAnalyticsAdminContext.mockResolvedValue({
      userEmail: "admin@example.com",
      orgId: "org-1",
      role: "owner",
    });
    listAutomationDefinitions.mockResolvedValue([]);
    defineAutomation.mockResolvedValue({ name: "analytics-data-index" });
    updateAutomation.mockResolvedValue({ name: "analytics-data-index" });
  });

  it("creates the scheduled automation on first enable and stores its name", async () => {
    const result = await setIndexSchedule.run(
      { enabled: true, cron: "0 6 * * *", timezone: "UTC" },
      ctx,
    );

    expect(defineAutomation).toHaveBeenCalledTimes(1);
    const [calledActor, input] = defineAutomation.mock.calls[0];
    expect(calledActor).toEqual(actor);
    expect(input).toMatchObject({
      name: "analytics-data-index",
      scope: "organization",
      triggerType: "schedule",
      schedule: "0 6 * * *",
      timezone: "UTC",
    });
    expect(input.body).toContain("build-data-index");
    expect(input.body).toContain('trigger "scheduled"');
    expect(updateAutomation).not.toHaveBeenCalled();
    expect(result).toEqual({
      enabled: true,
      cron: "0 6 * * *",
      timezone: "UTC",
      automationName: "analytics-data-index",
    });
    expect(orgSettings.get("org-1:analytics-index-schedule")).toEqual(result);
  });

  it("updates the stored automation instead of creating a second one", async () => {
    storeSchedule({
      enabled: false,
      cron: "0 6 * * *",
      timezone: "UTC",
      automationName: "nightly-index",
    });
    listAutomationDefinitions.mockResolvedValue([{ name: "nightly-index" }]);

    const result = await setIndexSchedule.run(
      { enabled: true, cron: "0 7 * * *", timezone: "Europe/London" },
      ctx,
    );

    expect(defineAutomation).not.toHaveBeenCalled();
    expect(updateAutomation).toHaveBeenCalledWith(actor, {
      name: "nightly-index",
      scope: "organization",
      enabled: true,
      schedule: "0 7 * * *",
      timezone: "Europe/London",
      body: expect.stringContaining("build-data-index"),
    });
    expect(result).toEqual({
      enabled: true,
      cron: "0 7 * * *",
      timezone: "Europe/London",
      automationName: "nightly-index",
    });
  });

  it("disables the automation without deleting it", async () => {
    storeSchedule({
      enabled: true,
      cron: "0 6 * * *",
      timezone: "UTC",
      automationName: "analytics-data-index",
    });
    listAutomationDefinitions.mockResolvedValue([
      { name: "analytics-data-index" },
    ]);

    const result = await setIndexSchedule.run(
      { enabled: false, cron: "0 6 * * *", timezone: "UTC" },
      ctx,
    );

    expect(updateAutomation).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        name: "analytics-data-index",
        enabled: false,
      }),
    );
    expect(defineAutomation).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      enabled: false,
      automationName: "analytics-data-index",
    });
  });

  it("saves a disabled schedule without creating an automation", async () => {
    const result = await setIndexSchedule.run(
      { enabled: false, cron: "0 6 * * *", timezone: "UTC" },
      ctx,
    );

    expect(defineAutomation).not.toHaveBeenCalled();
    expect(updateAutomation).not.toHaveBeenCalled();
    expect(result).toEqual({
      enabled: false,
      cron: "0 6 * * *",
      timezone: "UTC",
      automationName: null,
    });
    expect(orgSettings.get("org-1:analytics-index-schedule")).toEqual(result);
  });

  it("rejects an invalid cron before touching automations or the setting", async () => {
    await expect(
      setIndexSchedule.run(
        { enabled: true, cron: "every morning", timezone: "UTC" },
        ctx,
      ),
    ).rejects.toThrow(/Invalid cron expression/);

    expect(listAutomationDefinitions).not.toHaveBeenCalled();
    expect(defineAutomation).not.toHaveBeenCalled();
    expect(updateAutomation).not.toHaveBeenCalled();
    expect(orgSettings.size).toBe(0);
  });

  it("rejects an unknown timezone before touching automations", async () => {
    await expect(
      setIndexSchedule.run(
        { enabled: true, cron: "0 6 * * *", timezone: "Mars/Olympus" },
        ctx,
      ),
    ).rejects.toThrow(/Unknown timezone/);

    expect(defineAutomation).not.toHaveBeenCalled();
    expect(orgSettings.size).toBe(0);
  });

  it("refuses non-admins before reading or writing anything", async () => {
    requireAnalyticsAdminContext.mockRejectedValue(
      new Error(
        "Only organization owners and admins can use Analytics admin tools.",
      ),
    );

    await expect(
      setIndexSchedule.run(
        { enabled: true, cron: "0 6 * * *", timezone: "UTC" },
        ctx,
      ),
    ).rejects.toThrow(/owners and admins/);

    expect(listAutomationDefinitions).not.toHaveBeenCalled();
    expect(defineAutomation).not.toHaveBeenCalled();
    expect(orgSettings.size).toBe(0);
  });

  it("refuses to save an automation that has no app id, since the scheduler would never run it", async () => {
    await expect(
      setIndexSchedule.run(
        { enabled: true, cron: "0 6 * * *", timezone: "UTC" },
        {} as never,
      ),
    ).rejects.toThrow(/app id/);

    expect(defineAutomation).not.toHaveBeenCalled();
    expect(orgSettings.size).toBe(0);
  });
});
