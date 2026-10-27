import { beforeEach, describe, expect, it, vi } from "vitest";

const orgSettings = new Map<string, Record<string, unknown>>();

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

const {
  DEFAULT_INDEX_SCHEDULE_CRON,
  INDEX_SCHEDULE_SETTING_KEY,
  parseIndexScheduleInput,
  readIndexSchedule,
  writeIndexSchedule,
} = await import("./index-schedule");

describe("index schedule setting", () => {
  beforeEach(() => {
    orgSettings.clear();
  });

  it("returns the disabled default when nothing is saved", async () => {
    await expect(readIndexSchedule("org-1")).resolves.toEqual({
      enabled: false,
      cron: "0 6 * * *",
      timezone: "UTC",
      automationName: null,
    });
    expect(DEFAULT_INDEX_SCHEDULE_CRON).toBe("0 6 * * *");
  });

  it("round-trips a saved schedule under the org setting key", async () => {
    const saved = {
      enabled: true,
      cron: "30 7 * * 1-5",
      timezone: "America/New_York",
      automationName: "analytics-data-index",
    };

    await writeIndexSchedule("org-1", saved);

    expect(orgSettings.get(`org-1:${INDEX_SCHEDULE_SETTING_KEY}`)).toEqual(
      saved,
    );
    await expect(readIndexSchedule("org-1")).resolves.toEqual(saved);
    await expect(readIndexSchedule("org-2")).resolves.toMatchObject({
      enabled: false,
    });
  });

  it("fails loudly on a stored value it cannot read instead of defaulting", async () => {
    orgSettings.set(`org-1:${INDEX_SCHEDULE_SETTING_KEY}`, {
      enabled: "yes",
      cron: "0 6 * * *",
    });

    await expect(readIndexSchedule("org-1")).rejects.toThrow(/unreadable/);
  });
});

describe("parseIndexScheduleInput", () => {
  it("trims valid cron and timezone input", () => {
    expect(
      parseIndexScheduleInput({
        cron: "  0 6 * * *  ",
        timezone: " America/New_York ",
      }),
    ).toEqual({ cron: "0 6 * * *", timezone: "America/New_York" });
  });

  it("rejects an invalid cron expression with a clear error", () => {
    expect(() =>
      parseIndexScheduleInput({ cron: "every morning", timezone: "UTC" }),
    ).toThrow(/Invalid cron expression "every morning"/);
  });

  it("rejects an empty cron expression", () => {
    expect(() =>
      parseIndexScheduleInput({ cron: "   ", timezone: "UTC" }),
    ).toThrow(/Invalid cron expression/);
  });

  it("rejects a six-field (seconds) cron expression", () => {
    expect(() =>
      parseIndexScheduleInput({ cron: "0 0 6 * * *", timezone: "UTC" }),
    ).toThrow(/Invalid cron expression/);
  });

  it("rejects an unknown timezone with a clear error", () => {
    expect(() =>
      parseIndexScheduleInput({ cron: "0 6 * * *", timezone: "Mars/Olympus" }),
    ).toThrow(/Unknown timezone "Mars\/Olympus"/);
  });

  it("rejects a blank timezone", () => {
    expect(() =>
      parseIndexScheduleInput({ cron: "0 6 * * *", timezone: "  " }),
    ).toThrow(/Unknown timezone/);
  });
});
