import { describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());

vi.mock("../db/index.js", async () => {
  const actual =
    await vi.importActual<typeof import("../db/index.js")>("../db/index.js");
  return {
    ...actual,
    getDb: getDbMock,
  };
});

import {
  claimDashboardReportSubscription,
  nextDailyRunAt,
  queueDashboardReportSubscriptionNow,
} from "./dashboard-report-subscriptions";

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
});
