import { describe, expect, it } from "vitest";

import {
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
    savedFiltersSettled?: boolean;
    progress?: DashboardFilterRestoreProgress;
  } = {},
) {
  const {
    search = "",
    viewsState = "success",
    savedFiltersSettled = true,
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
    savedFiltersSettled,
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
        savedFiltersSettled: false,
      }),
    ).toEqual({ progress: { status: "pending" }, restore: null });
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
