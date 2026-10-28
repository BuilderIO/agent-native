import { beforeEach, describe, expect, it, vi } from "vitest";

const orgSettings = new Map<string, Record<string, unknown>>();
const session = {
  email: "member@example.com" as string | undefined,
  orgId: "org-1" as string | undefined,
};

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: () => session.orgId,
  getRequestUserEmail: () => session.email,
}));

vi.mock("@agent-native/core/settings", () => ({
  getOrgSetting: vi.fn(
    async (orgId: string, key: string) =>
      orgSettings.get(`${orgId}:${key}`) ?? null,
  ),
  putOrgSetting: vi.fn(),
}));

const { default: getIndexSchedule } = await import("./get-index-schedule");

describe("get-index-schedule action", () => {
  beforeEach(() => {
    orgSettings.clear();
    session.email = "member@example.com";
    session.orgId = "org-1";
  });

  it("returns the disabled daily-at-6 UTC default when nothing is saved", async () => {
    await expect(getIndexSchedule.run({}, {} as never)).resolves.toEqual({
      enabled: false,
      cron: "0 6 * * *",
      timezone: "UTC",
      automationName: null,
    });
  });

  it("returns the saved schedule for the active organization", async () => {
    orgSettings.set("org-1:analytics-index-schedule", {
      enabled: true,
      cron: "0 7 * * *",
      timezone: "Europe/London",
      automationName: "analytics-data-index",
    });

    await expect(getIndexSchedule.run({}, {} as never)).resolves.toEqual({
      enabled: true,
      cron: "0 7 * * *",
      timezone: "Europe/London",
      automationName: "analytics-data-index",
    });
  });

  it("requires a signed-in user", async () => {
    session.email = undefined;

    await expect(getIndexSchedule.run({}, {} as never)).rejects.toThrow(
      /Sign in/,
    );
  });

  it("requires an active organization instead of returning a default", async () => {
    session.orgId = undefined;

    await expect(getIndexSchedule.run({}, {} as never)).rejects.toThrow(
      /active organization/,
    );
  });
});
