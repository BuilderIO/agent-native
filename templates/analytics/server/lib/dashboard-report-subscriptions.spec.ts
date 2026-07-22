import { describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());
const dashboardStoreMocks = vi.hoisted(() => ({
  getDashboard: vi.fn(),
}));

vi.mock("../db/index.js", async () => {
  const actual =
    await vi.importActual<typeof import("../db/index.js")>("../db/index.js");
  return {
    ...actual,
    getDb: getDbMock,
  };
});

vi.mock("./dashboards-store", () => ({
  getDashboard: dashboardStoreMocks.getDashboard,
}));

import { LEGACY_NEW_VS_RECURRING_USERS_SQL } from "./canonical-first-party-dashboard-repair";
import {
  claimDashboardReportSubscription,
  dashboardReportRetryAt,
  getReportDashboard,
  lastDailyRunAt,
  markDashboardReportResult,
  MAX_DASHBOARD_REPORT_RECIPIENTS,
  nextDailyRunAt,
  normalizeDashboardReportRecipients,
  queueDashboardReportSubscriptionNow,
  truncateDashboardReportError,
} from "./dashboard-report-subscriptions";
import type { DashboardReportSubscription } from "./dashboard-report-subscriptions";
import { FIRST_PARTY_DASHBOARD_ID } from "./first-party-metric-catalog";

function createClaimDbMock(rows: unknown[]) {
  const returning = vi.fn(async () => rows);
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  return {
    db: { update },
    update,
    set,
    where,
    returning,
  };
}

describe("dashboard report subscriptions", () => {
  it("repairs the exact canonical custom panel in a report snapshot", async () => {
    dashboardStoreMocks.getDashboard.mockResolvedValue({
      id: FIRST_PARTY_DASHBOARD_ID,
      kind: "sql",
      title: "First-party Template Traffic",
      config: {
        panels: [
          {
            id: "new-vs-recurring-users",
            sql: LEGACY_NEW_VS_RECURRING_USERS_SQL,
            config: {
              description:
                "Daily signed-in visitors split by first-ever session (New) vs return visit (Recurring), stacked with Recurring on the bottom and New on top. Docs excluded. A user is New only on their all-time first active day.",
            },
          },
        ],
      },
    });

    const dashboard = await getReportDashboard(FIRST_PARTY_DASHBOARD_ID, {
      email: "steve@builder.io",
      orgId: "builder",
    });

    const panel = (
      dashboard?.config.panels as Array<{
        sql: string;
        config: { description: string };
      }>
    )[0];
    expect(panel?.sql).toContain("WITH first_seen AS");
    expect(panel?.sql).toContain("), activity AS");
    expect(panel?.config.description).toContain("previous 365 days");
  });

  describe("normalizeDashboardReportRecipients", () => {
    it("rejects an empty recipient list after normalization", () => {
      expect(() => normalizeDashboardReportRecipients([" ", ""])).toThrow(
        "At least one recipient is required",
      );
    });

    it("deduplicates before applying the recipient limit", () => {
      expect(
        normalizeDashboardReportRecipients([
          "ONE@example.com",
          "one@example.com",
          "two@example.com",
          "three@example.com",
          "four@example.com",
          "five@example.com",
        ]),
      ).toEqual([
        "one@example.com",
        "two@example.com",
        "three@example.com",
        "four@example.com",
        "five@example.com",
      ]);
    });

    it("rejects more than five distinct recipients after deduplication", () => {
      const recipients = Array.from(
        { length: MAX_DASHBOARD_REPORT_RECIPIENTS + 1 },
        (_, index) => `person-${index}@example.com`,
      );

      expect(() => normalizeDashboardReportRecipients(recipients)).toThrow(
        "Dashboard reports support at most 5 recipients",
      );
    });
  });

  describe("truncateDashboardReportError", () => {
    it("preserves short errors", () => {
      const error = "Dashboard screenshot capture failed";

      expect(truncateDashboardReportError(error)).toBe(error);
    });

    it("bounds long errors while preserving their beginning and final failure", () => {
      const error = `first capture attempt\n${"x".repeat(4_000)}\nfinal browser error: page crashed`;
      const stored = truncateDashboardReportError(error);

      expect(stored).toHaveLength(2_000);
      expect(stored).toContain("… [truncated] …");
      expect(stored.startsWith("first capture attempt")).toBe(true);
      expect(stored.endsWith("final browser error: page crashed")).toBe(true);
    });
  });

  it("schedules the next daily run in UTC", () => {
    expect(
      nextDailyRunAt("09:00", "UTC", new Date("2026-01-01T08:00:00.000Z")),
    ).toBe("2026-01-01T09:00:00.000Z");
  });

  it("rolls over when today's local send time has already passed", () => {
    expect(
      nextDailyRunAt(
        "09:00",
        "America/Los_Angeles",
        new Date("2026-01-01T18:00:00.000Z"),
      ),
    ).toBe("2026-01-02T17:00:00.000Z");
  });

  it("computes the most recent daily occurrence not after `from`", () => {
    expect(
      lastDailyRunAt(
        "04:00",
        "America/Los_Angeles",
        new Date("2026-07-13T11:06:00.000Z"),
      ),
    ).toBe("2026-07-13T11:00:00.000Z");
    expect(
      lastDailyRunAt(
        "04:00",
        "America/Los_Angeles",
        new Date("2026-07-13T10:30:00.000Z"),
      ),
    ).toBe("2026-07-12T11:00:00.000Z");
  });

  describe("dashboardReportRetryAt", () => {
    function reportSubscription(enabled: boolean): DashboardReportSubscription {
      return {
        id: "sub_1",
        dashboardId: "dash_1",
        name: "Daily",
        recipients: ["person@example.com"],
        filters: {},
        frequency: "daily",
        timeOfDay: "04:00",
        timezone: "America/Los_Angeles",
        enabled,
        nextRunAt: null,
        lastRunAt: null,
        lastStatus: null,
        lastError: null,
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
        ownerEmail: "owner@example.com",
        orgId: "org_1",
      };
    }

    it("returns a delayed retry time within the retry window", () => {
      const now = new Date("2026-07-13T11:06:00.000Z");
      expect(dashboardReportRetryAt(reportSubscription(true), now)).toBe(
        new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
      );
    });

    it("returns null once the retry window has elapsed", () => {
      const now = new Date("2026-07-13T12:00:00.000Z");
      expect(dashboardReportRetryAt(reportSubscription(true), now)).toBeNull();
    });

    it("returns null for a disabled subscription", () => {
      const now = new Date("2026-07-13T11:06:00.000Z");
      expect(dashboardReportRetryAt(reportSubscription(false), now)).toBeNull();
    });
  });

  it("claims a manual send through one running-state update", async () => {
    const row = {
      id: "sub_1",
      dashboardId: "dash_1",
      name: "Daily",
      recipients: JSON.stringify(["person@example.com"]),
      filters: "{}",
      timeOfDay: "09:00",
      timezone: "UTC",
      enabled: true,
      nextRunAt: "2026-01-02T09:00:00.000Z",
      lastRunAt: null,
      lastStatus: null,
      lastError: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      ownerEmail: "owner@example.com",
      orgId: "org_1",
    };
    const { db, set, where, returning } = createClaimDbMock([row]);
    getDbMock.mockReturnValue(db);

    const claimed = await claimDashboardReportSubscription(
      "sub_1",
      { email: "owner@example.com", orgId: "org_1" },
      new Date("2026-01-01T12:00:00.000Z"),
    );

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        lastRunAt: "2026-01-01T12:00:00.000Z",
        lastStatus: "running",
        lastError: null,
        updatedAt: "2026-01-01T12:00:00.000Z",
      }),
    );
    expect(where).toHaveBeenCalledTimes(1);
    expect(returning).toHaveBeenCalledTimes(1);
    expect(claimed).toMatchObject({
      id: "sub_1",
      ownerEmail: "owner@example.com",
      orgId: "org_1",
    });
  });

  it("returns null when a manual send cannot claim the subscription", async () => {
    const { db, returning } = createClaimDbMock([]);
    getDbMock.mockReturnValue(db);

    const claimed = await claimDashboardReportSubscription(
      "sub_1",
      { email: "owner@example.com", orgId: "org_1" },
      new Date("2026-01-01T12:00:00.000Z"),
    );

    expect(returning).toHaveBeenCalledTimes(1);
    expect(claimed).toBeNull();
  });

  it("queues a subscription to run immediately", async () => {
    const row = {
      id: "sub_1",
      dashboardId: "dash_1",
      name: "Daily",
      recipients: JSON.stringify(["person@example.com"]),
      filters: "{}",
      timeOfDay: "09:00",
      timezone: "UTC",
      enabled: true,
      nextRunAt: "2026-01-01T12:00:00.000Z",
      lastRunAt: "2026-01-01T11:00:00.000Z",
      lastStatus: null,
      lastError: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T12:00:00.000Z",
      ownerEmail: "owner@example.com",
      orgId: "org_1",
    };
    const { db, set, returning } = createClaimDbMock([row]);
    getDbMock.mockReturnValue(db);

    const queued = await queueDashboardReportSubscriptionNow(
      "sub_1",
      { email: "owner@example.com", orgId: "org_1" },
      new Date("2026-01-01T12:34:00.000Z"),
    );

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        nextRunAt: "2026-01-01T12:34:00.000Z",
        lastStatus: null,
        lastError: null,
        updatedAt: "2026-01-01T12:34:00.000Z",
      }),
    );
    expect(returning).toHaveBeenCalledTimes(1);
    expect(queued).toMatchObject({
      id: "sub_1",
      ownerEmail: "owner@example.com",
      orgId: "org_1",
    });
  });

  it("persists the bounded diagnostic when a report fails", async () => {
    const { db, set } = createClaimDbMock([]);
    getDbMock.mockReturnValue(db);
    const error = `initial attempt\n${"x".repeat(4_000)}\nfinal screenshot failure`;

    await markDashboardReportResult(
      {
        id: "sub_1",
        dashboardId: "dash_1",
        name: "Daily",
        recipients: ["person@example.com"],
        filters: {},
        frequency: "daily",
        timeOfDay: "09:00",
        timezone: "UTC",
        enabled: false,
        nextRunAt: null,
        lastRunAt: null,
        lastStatus: "running",
        lastError: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ownerEmail: "owner@example.com",
        orgId: "org_1",
      },
      "error",
      error,
    );

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        lastError: expect.stringMatching(/final screenshot failure$/),
      }),
    );
  });
});
