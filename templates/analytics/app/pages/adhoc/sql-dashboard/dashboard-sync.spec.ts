import { describe, expect, it } from "vitest";

import {
  createDashboardAdoptionHold,
  dashboardPrefetchInitialData,
  dashboardVersionAfterSave,
  releaseDashboardAdoptionHold,
  shouldShowDashboardLoadError,
  shouldAdoptDashboardQueryResult,
} from "./dashboard-sync";

describe("releaseDashboardAdoptionHold", () => {
  it("gives up only the hold the failed save placed", () => {
    const placed = createDashboardAdoptionHold({
      dashboardId: "b",
      currentUpdatedAt: "2026-10-15T00:00:00.000Z",
    });
    // A live collaborative update held the same dashboard after the save did.
    const later = createDashboardAdoptionHold({
      dashboardId: "b",
      currentUpdatedAt: "2026-10-15T00:00:01.000Z",
    });
    const otherDashboard = createDashboardAdoptionHold({
      dashboardId: "a",
      currentUpdatedAt: "2026-10-15T00:00:00.000Z",
    });
    expect(releaseDashboardAdoptionHold(placed, placed)).toBeNull();
    expect(releaseDashboardAdoptionHold(later, placed)).toBe(later);
    expect(releaseDashboardAdoptionHold(otherDashboard, placed)).toBe(
      otherDashboard,
    );
    expect(releaseDashboardAdoptionHold(null, placed)).toBeNull();
  });
});

describe("dashboardVersionAfterSave", () => {
  it("moves the page's version from the one the save was sent against", () => {
    expect(dashboardVersionAfterSave("v1", "v1", "v2")).toBe("v2");
  });

  it("keeps a version the page moved to while the save was in flight", () => {
    // The page adopted someone else's save, "vR", before this one answered.
    expect(dashboardVersionAfterSave("vR", "v1", "v2")).toBe("vR");
    // The page switched dashboards and hasn't loaded the next one yet.
    expect(dashboardVersionAfterSave(null, "v1", "v2")).toBeNull();
  });

  it("keeps the version when the server reported none", () => {
    expect(dashboardVersionAfterSave("v1", "v1", undefined)).toBe("v1");
  });
});

describe("dashboard sync adoption", () => {
  it("shows a retryable load error when the first dashboard request fails", () => {
    expect(
      shouldShowDashboardLoadError({
        dashboardId: "dash",
        isError: true,
        loaded: false,
        hasDashboard: false,
      }),
    ).toBe(true);
  });

  it("keeps an already-rendered dashboard visible after a background failure", () => {
    expect(
      shouldShowDashboardLoadError({
        dashboardId: "dash",
        isError: true,
        loaded: true,
        hasDashboard: true,
      }),
    ).toBe(false);
  });

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
