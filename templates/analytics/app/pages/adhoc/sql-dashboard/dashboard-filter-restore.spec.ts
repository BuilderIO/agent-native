import { describe, expect, it } from "vitest";

import {
  canPersistDashboardFilterPreference,
  dashboardFilterPreferenceSaveState,
  matchesDashboardFilterRestoreState,
  resolveDashboardFilterRestoreStep,
  type DashboardFilterRestoreProgress,
} from "./dashboard-filter-restore";

const defaultView = { id: "90-days", filters: { f_timeRange: "90d" } };
const personalFilters = { f_timeRange: "7d", f_emailFilter: "all" };

function resolveStep(
  options: {
    search?: string;
    defaultView?: typeof defaultView | undefined;
    savedFilters?: Record<string, string> | undefined;
    viewsState?: "loading" | "error" | "success";
    savedFiltersState?: "loading" | "error" | "success";
    progress?: DashboardFilterRestoreProgress;
  } = {},
) {
  const {
    search = "",
    viewsState = "success",
    savedFiltersState = "success",
    progress = { status: "pending" } as DashboardFilterRestoreProgress,
  } = options;
  const configuredDefault =
    "defaultView" in options ? options.defaultView : defaultView;
  const configuredSavedFilters =
    "savedFilters" in options ? options.savedFilters : personalFilters;

  return resolveDashboardFilterRestoreStep({
    searchParams: new URLSearchParams(search),
    defaultView: configuredDefault,
    savedFilters: configuredSavedFilters,
    viewsState,
    savedFiltersState,
    progress,
  });
}

describe("resolveDashboardFilterRestoreStep", () => {
  it("preserves explicit URL filters and views", () => {
    expect(resolveStep({ search: "f_timeRange=30d" })).toEqual({
      progress: { status: "complete" },
      restore: null,
    });
    expect(resolveStep({ search: "view=custom-view" })).toEqual({
      progress: { status: "complete" },
      restore: null,
    });
  });

  it("matches an absent URL view ID to an undefined fallback view ID", () => {
    const searchParams = new URLSearchParams(
      "f_timeRange=7d&f_emailFilter=all",
    );

    expect(
      matchesDashboardFilterRestoreState(
        searchParams,
        personalFilters,
        undefined,
      ),
    ).toBe(true);
    expect(
      matchesDashboardFilterRestoreState(
        searchParams,
        personalFilters,
        "90-days",
      ),
    ).toBe(false);
  });

  it("applies the dashboard default before the user's last filters", () => {
    expect(resolveStep()).toEqual({
      progress: { status: "complete" },
      restore: {
        filters: { f_timeRange: "90d" },
        viewId: "90-days",
        source: "dashboard-default",
      },
    });
  });

  it("restores personal filters after saved views fail but keeps default restoration pending", () => {
    const fallback = resolveStep({ viewsState: "error" });

    expect(fallback).toEqual({
      progress: { status: "fallback-applied", filters: personalFilters },
      restore: { filters: personalFilters, source: "personal" },
    });

    expect(
      resolveStep({
        search: "f_timeRange=7d&f_emailFilter=all",
        viewsState: "success",
        progress: fallback.progress,
      }),
    ).toEqual({
      progress: { status: "complete" },
      restore: {
        filters: { f_timeRange: "90d" },
        viewId: "90-days",
        source: "dashboard-default",
      },
    });
  });

  it("keeps autosave paused while saved views are delayed, then applies the default", () => {
    const waiting = resolveStep({ viewsState: "loading" });
    expect(waiting).toEqual({ progress: { status: "pending" }, restore: null });
    expect(
      canPersistDashboardFilterPreference(waiting.progress, {}, undefined),
    ).toBe(false);

    const ready = resolveStep({ progress: waiting.progress });
    expect(ready.restore?.source).toBe("dashboard-default");
    expect(
      canPersistDashboardFilterPreference(
        ready.progress,
        { f_timeRange: "90d" },
        "90-days",
      ),
    ).toBe(true);
  });

  it("does not replace filter changes made after restoring the personal fallback", () => {
    const fallback = resolveStep({ viewsState: "error" });

    expect(
      resolveStep({
        search: "f_timeRange=30d&f_emailFilter=all",
        viewsState: "success",
        progress: fallback.progress,
      }),
    ).toEqual({ progress: { status: "complete" }, restore: null });
  });

  it("keeps retrying when saved views fail before personal preferences load", () => {
    expect(
      resolveStep({
        viewsState: "error",
        savedFiltersState: "loading",
      }),
    ).toEqual({
      progress: { status: "views-failed", filters: {}, viewId: undefined },
      restore: null,
    });
  });

  it("keeps retrying after a failed preference read", () => {
    const failed = resolveStep({
      defaultView: undefined,
      savedFiltersState: "error",
    });
    expect(failed).toEqual({ progress: { status: "pending" }, restore: null });
    expect(
      canPersistDashboardFilterPreference(failed.progress, {}, undefined),
    ).toBe(false);

    expect(
      resolveStep({
        defaultView: undefined,
        savedFiltersState: "success",
        progress: failed.progress,
      }),
    ).toEqual({
      progress: { status: "complete" },
      restore: { filters: personalFilters, source: "personal" },
    });
  });

  it("skips saving a dashboard default without consuming the guard before its URL is applied", () => {
    const guard = {
      filters: { f_timeRange: "90d" },
      viewId: "90-days",
      previousFilters: personalFilters,
    };
    expect(
      dashboardFilterPreferenceSaveState(guard, personalFilters, undefined),
    ).toBe("pending");
    expect(
      dashboardFilterPreferenceSaveState(
        guard,
        { f_timeRange: "90d" },
        "90-days",
      ),
    ).toBe("applied");
    expect(
      dashboardFilterPreferenceSaveState(
        guard,
        { f_timeRange: "30d" },
        undefined,
      ),
    ).toBe("changed");
  });

  it("keeps a view-list failure retryable while allowing a later user change to autosave", () => {
    const failed = resolveStep({
      viewsState: "error",
      savedFilters: undefined,
    });
    expect(failed).toEqual({
      progress: { status: "views-failed", filters: {} },
      restore: null,
    });
    expect(
      canPersistDashboardFilterPreference(failed.progress, {}, undefined),
    ).toBe(false);

    expect(
      resolveStep({
        progress: failed.progress,
        viewsState: "success",
      }).restore,
    ).toEqual({
      filters: { f_timeRange: "90d" },
      viewId: "90-days",
      source: "dashboard-default",
    });

    const userChanged = resolveStep({
      progress: failed.progress,
      viewsState: "error",
      search: "f_timeRange=30d",
      savedFilters: undefined,
    });
    expect(userChanged).toEqual({
      progress: { status: "complete" },
      restore: null,
    });
    expect(
      canPersistDashboardFilterPreference(
        userChanged.progress,
        { f_timeRange: "30d" },
        undefined,
      ),
    ).toBe(true);
  });

  it("uses the personal filters when no dashboard default exists", () => {
    expect(resolveStep({ defaultView: undefined })).toEqual({
      progress: { status: "complete" },
      restore: { filters: personalFilters, source: "personal" },
    });
  });

  it("completes with no restore when no saved filters or default exists", () => {
    expect(
      resolveStep({ defaultView: undefined, savedFilters: undefined }),
    ).toEqual({ progress: { status: "complete" }, restore: null });
  });
});
