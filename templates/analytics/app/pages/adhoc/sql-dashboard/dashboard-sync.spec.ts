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
  const page = (updatedAt: string | null, dashboardId = "dash") => ({
    dashboardId,
    updatedAt,
  });
  const save = (sentAgainst: string, saved?: string, dashboardId = "dash") => ({
    dashboardId,
    sentAgainst,
    saved,
  });

  it("moves the page's version from the one the save was sent against", () => {
    expect(dashboardVersionAfterSave(page("v1"), save("v1", "v2"))).toBe("v2");
  });

  it("keeps a version the page moved to while the save was in flight", () => {
    // The page adopted someone else's save, "vR", before this one answered.
    expect(dashboardVersionAfterSave(page("vR"), save("v1", "v2"))).toBe("vR");
    // The page switched dashboards and hasn't loaded the next one yet.
    expect(
      dashboardVersionAfterSave(page(null, "other"), save("v1", "v2")),
    ).toBeNull();
  });

  it("keeps another dashboard's version even when it matches the save's", () => {
    expect(
      dashboardVersionAfterSave(page("v1", "other"), save("v1", "v2")),
    ).toBe("v1");
  });

  it("keeps the version when the server reported none", () => {
    expect(dashboardVersionAfterSave(page("v1"), save("v1"))).toBe("v1");
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
        savesPending: false,
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
        savesPending: false,
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
        savesPending: false,
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
        savesPending: false,
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
        savesPending: false,
        now: Date.parse("2026-06-27T10:00:06.000Z"),
      }),
    ).toEqual({ adopt: true, clearHold: true });
  });

  it("adopts nothing while a save for the dashboard is queued or in flight", () => {
    const hold = createDashboardAdoptionHold({
      dashboardId: "dash",
      currentUpdatedAt: "2026-06-27T10:00:00.000Z",
      now: 1_000,
    });

    // The first of two queued saves has landed; its refetch lacks the second.
    expect(
      shouldAdoptDashboardQueryResult({
        dashboardId: "dash",
        loaded: true,
        isPlaceholderData: false,
        fetchedId: "dash",
        fetchedUpdatedAt: "2026-06-27T10:00:01.000Z",
        currentUpdatedAt: "2026-06-27T10:00:01.000Z",
        hold,
        savesPending: true,
        now: 1_001,
      }),
    ).toEqual({ adopt: false, clearHold: false });
  });

  it("keeps the hold against a fetch older than a save that already landed", () => {
    const hold = createDashboardAdoptionHold({
      dashboardId: "dash",
      currentUpdatedAt: "2026-06-27T10:00:00.000Z",
      now: 1_000,
    });
    const adoption = (fetchedUpdatedAt: string) =>
      shouldAdoptDashboardQueryResult({
        dashboardId: "dash",
        loaded: true,
        isPlaceholderData: false,
        fetchedId: "dash",
        fetchedUpdatedAt,
        currentUpdatedAt: "2026-06-27T10:00:02.000Z",
        hold,
        savesPending: false,
        now: 1_001,
      });

    // Newer than the hold, but from between the page's two saves.
    expect(adoption("2026-06-27T10:00:01.000Z")).toEqual({
      adopt: false,
      clearHold: false,
    });
    expect(adoption("2026-06-27T10:00:02.000Z")).toEqual({
      adopt: true,
      clearHold: true,
    });
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
        savesPending: false,
        now: 1_000,
      }),
    ).toEqual({ adopt: false, clearHold: false });
  });
});
