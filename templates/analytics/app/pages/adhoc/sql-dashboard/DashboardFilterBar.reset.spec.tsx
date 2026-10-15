// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { i18nCatalog } from "../../../i18n";
import {
  DashboardFilterBar,
  type DashboardSavedView,
} from "./DashboardFilterBar";
import type { DashboardFilter } from "./types";

// The v3 BigQuery dashboard's filters, plus a multi-select.
const filters: DashboardFilter[] = [
  {
    id: "timeRange",
    label: "Time range",
    type: "select",
    default: "30d",
    options: [
      { value: "7d", label: "Last 7 days" },
      { value: "30d", label: "Last 30 days" },
      { value: "90d", label: "Last 90 days" },
      { value: "all", label: "All time" },
    ],
  },
  {
    id: "emailFilter",
    label: "Email filter",
    type: "select",
    default: "exclude_builder",
    options: [
      { value: "all", label: "All users" },
      { value: "exclude_builder", label: "Exclude @builder.io" },
      { value: "only_builder", label: "Only @builder.io" },
    ],
  },
  {
    id: "plan",
    label: "Plan",
    type: "multi-select",
    options: [
      { value: "free", label: "Free" },
      { value: "enterprise", label: "Enterprise" },
    ],
  },
];

let container: HTMLDivElement;
let root: Root;
let search = "";

function SearchProbe() {
  const location = useLocation();
  search = location.search;
  return null;
}

function render(
  initialEntry: string,
  options: {
    list?: DashboardFilter[];
    views?: DashboardSavedView[] | null;
    viewsRefreshing?: boolean;
    canSaveViews?: boolean;
  } = {},
) {
  act(() => {
    root.render(
      <AgentNativeI18nProvider
        catalog={i18nCatalog}
        initialLocale="en-US"
        persistPreference={false}
      >
        <TooltipProvider>
          <MemoryRouter initialEntries={[initialEntry]}>
            <DashboardFilterBar
              filters={options.list ?? filters}
              views={options.views}
              viewsRefreshing={options.viewsRefreshing}
              onSaveView={options.canSaveViews ? () => {} : undefined}
            />
            <SearchProbe />
          </MemoryRouter>
        </TooltipProvider>
      </AgentNativeI18nProvider>,
    );
  });
}

function resetButton(): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "Reset filters",
  );
}

function saveViewButton(): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "Save view",
  );
}

function onlyYouLabel(): HTMLElement | undefined {
  return [...container.querySelectorAll<HTMLElement>("[tabindex]")].find(
    (el) => el.textContent?.trim() === "Only you see these filters",
  );
}

function params(): URLSearchParams {
  return new URLSearchParams(search);
}

describe("resetting dashboard filters", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    search = "";
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("hides the reset when no filter is set", () => {
    render("/dashboards/v3");
    expect(resetButton()).toBeUndefined();
    expect(onlyYouLabel()).toBeUndefined();
  });

  it("hides the reset when the URL spells out the defaults", () => {
    render(
      "/dashboards/v3?f_timeRange=30d&f_emailFilter=exclude_builder&f_plan=__empty__",
    );
    expect(resetButton()).toBeUndefined();
  });

  it("shows the reset outside the hover-only controls once a filter changes", () => {
    render("/dashboards/v3?f_emailFilter=all");
    const button = resetButton();
    expect(button).toBeDefined();
    expect(button?.closest(".opacity-0")).toBeNull();
  });

  it("says only you see the changed filters, next to the reset", () => {
    render("/dashboards/v3?f_emailFilter=all");
    const label = onlyYouLabel();
    expect(label).toBeDefined();
    expect(label?.closest(".opacity-0")).toBeNull();

    act(() => resetButton()!.click());
    expect(onlyYouLabel()).toBeUndefined();
  });

  it("names saving a view as a way to share only to people who can save views", () => {
    const hint = () => {
      act(() => onlyYouLabel()!.focus());
      return document.body.querySelector('[role="tooltip"]')?.textContent;
    };
    render("/dashboards/v3?f_emailFilter=all", { canSaveViews: true });
    expect(hint()).toContain("save a view or send the link");

    act(() => root.unmount());
    root = createRoot(container);
    render("/dashboards/v3?f_emailFilter=all");
    expect(hint()).toContain("To share them, send the link.");
  });

  it("returns every filter to its default and keeps unrelated params", () => {
    render(
      "/dashboards/v3?tab=activity&f_timeRange=custom&f_timeRangeStart=2026-09-09&f_timeRangeEnd=2026-10-04&f_emailFilter=all&f_plan=free&view=sep-9",
    );
    act(() => resetButton()!.click());

    expect(params().toString()).toBe("tab=activity");
    expect(resetButton()).toBeUndefined();
    expect(container.textContent).toContain("Last 30 days");
    expect(container.textContent).toContain("Exclude @builder.io");
  });

  it("counts a cleared multi-select as changed when its default names a value", () => {
    const withDefault: DashboardFilter[] = [
      { ...filters[2], default: "enterprise" },
    ];
    render("/dashboards/v3?f_plan=__empty__", { list: withDefault });
    act(() => resetButton()!.click());

    expect(params().has("f_plan")).toBe(false);
    expect(container.textContent).toContain("Enterprise");
  });

  describe("with saved views", () => {
    const defaultView: DashboardSavedView = {
      id: "launch-window",
      filters: { f_timeRange: "7d", f_emailFilter: "all" },
      isDefault: true,
    };
    const enterprise: DashboardSavedView = {
      id: "enterprise",
      filters: { f_timeRange: "90d", f_plan: "enterprise" },
    };
    const views = [defaultView, enterprise];

    it("resets to the dashboard's default view when no view is open", () => {
      render("/dashboards/v3?f_timeRange=90d&f_plan=free", { views });
      act(() => resetButton()!.click());

      expect(Object.fromEntries(params())).toEqual({
        f_timeRange: "7d",
        f_emailFilter: "all",
        view: "launch-window",
      });
      expect(resetButton()).toBeUndefined();
    });

    it("offers the reset when the default view is set but the URL has no filters", () => {
      render("/dashboards/v3", { views });
      expect(resetButton()).toBeDefined();
    });

    it("returns to the open view after one of its filters changes, not to the default view", () => {
      render(
        "/dashboards/v3?view=enterprise&f_timeRange=7d&f_plan=enterprise",
        {
          views,
        },
      );
      act(() => resetButton()!.click());

      expect(Object.fromEntries(params())).toEqual({
        f_timeRange: "90d",
        f_plan: "enterprise",
        view: "enterprise",
      });
      expect(resetButton()).toBeUndefined();
    });

    it("hides the reset while the filters match the open view, even though they differ from the defaults", () => {
      render(
        "/dashboards/v3?view=enterprise&f_timeRange=90d&f_plan=enterprise",
        {
          views,
        },
      );
      expect(resetButton()).toBeUndefined();
    });

    it("offers Save view with the only-you label after an open view is edited to match the default view", () => {
      render(
        "/dashboards/v3?view=enterprise&f_timeRange=7d&f_emailFilter=all",
        { views, canSaveViews: true },
      );
      expect(onlyYouLabel()).toBeDefined();
      expect(saveViewButton()).toBeDefined();
    });

    it("hides Save view while the filters match the open view", () => {
      render(
        "/dashboards/v3?view=enterprise&f_timeRange=90d&f_plan=enterprise",
        { views, canSaveViews: true },
      );
      expect(onlyYouLabel()).toBeUndefined();
      expect(saveViewButton()).toBeUndefined();
    });

    it("falls back to the default view when the URL names a view that no longer exists", () => {
      render("/dashboards/v3?view=deleted&f_timeRange=90d", { views });
      act(() => resetButton()!.click());

      expect(params().get("view")).toBe("launch-window");
      expect(params().get("f_timeRange")).toBe("7d");
    });

    it("hides the reset until the saved views load, since its target is unknown", () => {
      render("/dashboards/v3?view=enterprise&f_timeRange=7d", { views: null });
      expect(resetButton()).toBeUndefined();
    });

    it("keeps a cached view out of the URL while the views refetch, then resets normally", () => {
      // The cached list still has the default view; the refetch shows it deleted.
      render("/dashboards/v3?f_timeRange=90d&f_plan=free", {
        views,
        viewsRefreshing: true,
      });
      expect(resetButton()?.disabled).toBe(true);
      act(() => resetButton()!.click());
      expect(Object.fromEntries(params())).toEqual({
        f_timeRange: "90d",
        f_plan: "free",
      });

      render("/dashboards/v3?f_timeRange=90d&f_plan=free", {
        views: [enterprise],
        viewsRefreshing: false,
      });
      act(() => resetButton()!.click());
      expect(Object.fromEntries(params())).toEqual({});
    });
  });
});
