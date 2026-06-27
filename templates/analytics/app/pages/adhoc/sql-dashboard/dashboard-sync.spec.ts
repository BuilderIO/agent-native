import { describe, expect, it } from "vitest";

import {
  createDashboardAdoptionHold,
  dashboardPrefetchInitialData,
  shouldAdoptDashboardQueryResult,
} from "./dashboard-sync";

describe("dashboard sync adoption", () => {
  it("does not seed initial data from stale non-null prefetch snapshots", () => {
    const snapshot = {
      data: { id: "dash", panels: [{ id: "old" }] },
      syncVersion: 1,
    };

    expect(dashboardPrefetchInitialData(snapshot, 2)).toBeUndefined();
    expect(dashboardPrefetchInitialData(snapshot, 1)).toBe(snapshot.data);
  });

  it("does not adopt placeholder data after a sync bump", () => {
    expect(
      shouldAdoptDashboardQueryResult({
        dashboardId: "dash",
        loaded: true,
        isPlaceholderData: true,
        fetchedId: "dash",
        fetchedUpdatedAt: "2026-06-27T10:00:00.000Z",
        currentUpdatedAt: "2026-06-27T10:00:00.000Z",
        hold: null,
        now: 1_000,
      }),
    ).toEqual({ adopt: false, clearHold: false });
  });

  it("blocks stale in-flight fetches during an optimistic update", () => {
    const hold = createDashboardAdoptionHold({
      dashboardId: "dash",
      currentUpdatedAt: "2026-06-27T10:00:00.000Z",
      now: 1_000,
    });

    expect(
      shouldAdoptDashboardQueryResult({
        dashboardId: "dash",
        loaded: true,
        isPlaceholderData: false,
        fetchedId: "dash",
        fetchedUpdatedAt: "2026-06-27T10:00:00.000Z",
        currentUpdatedAt: "2026-06-27T10:00:00.000Z",
        hold,
        now: 1_001,
      }),
    ).toEqual({ adopt: false, clearHold: false });
  });

  it("adopts the first newer server version without waiting for the hold timeout", () => {
    const hold = createDashboardAdoptionHold({
      dashboardId: "dash",
      currentUpdatedAt: "2026-06-27T10:00:00.000Z",
      now: 1_000,
    });

    expect(
      shouldAdoptDashboardQueryResult({
        dashboardId: "dash",
        loaded: true,
        isPlaceholderData: false,
        fetchedId: "dash",
        fetchedUpdatedAt: "2026-06-27T10:00:01.000Z",
        currentUpdatedAt: "2026-06-27T10:00:00.000Z",
        hold,
        now: 1_001,
      }),
    ).toEqual({ adopt: true, clearHold: true });
  });

  it("blocks stale first snapshots while an optimistic update has no current updatedAt", () => {
    const hold = createDashboardAdoptionHold({
      dashboardId: "dash",
      currentUpdatedAt: null,
      now: Date.parse("2026-06-27T10:00:05.000Z"),
    });

    expect(
      shouldAdoptDashboardQueryResult({
        dashboardId: "dash",
        loaded: true,
        isPlaceholderData: false,
        fetchedId: "dash",
        fetchedUpdatedAt: "2026-06-27T10:00:00.000Z",
        currentUpdatedAt: null,
        hold,
        now: Date.parse("2026-06-27T10:00:06.000Z"),
      }),
    ).toEqual({ adopt: false, clearHold: false });
  });

  it("adopts newer server snapshots after a null-baseline optimistic hold", () => {
    const hold = createDashboardAdoptionHold({
      dashboardId: "dash",
      currentUpdatedAt: null,
      now: Date.parse("2026-06-27T10:00:05.000Z"),
    });

    expect(
      shouldAdoptDashboardQueryResult({
        dashboardId: "dash",
        loaded: true,
        isPlaceholderData: false,
        fetchedId: "dash",
        fetchedUpdatedAt: "2026-06-27T10:00:06.000Z",
        currentUpdatedAt: null,
        hold,
        now: Date.parse("2026-06-27T10:00:06.000Z"),
      }),
    ).toEqual({ adopt: true, clearHold: true });
  });

  it("rejects server payloads older than the adopted dashboard version", () => {
    expect(
      shouldAdoptDashboardQueryResult({
        dashboardId: "dash",
        loaded: true,
        isPlaceholderData: false,
        fetchedId: "dash",
        fetchedUpdatedAt: "2026-06-27T09:59:59.000Z",
        currentUpdatedAt: "2026-06-27T10:00:00.000Z",
        hold: null,
        now: 1_000,
      }),
    ).toEqual({ adopt: false, clearHold: false });
  });
});
