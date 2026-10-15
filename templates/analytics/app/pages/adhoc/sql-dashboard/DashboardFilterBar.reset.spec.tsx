// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { i18nCatalog } from "../../../i18n";
import {
  DashboardFilterBar,
  type DashboardDefaultView,
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
    defaultView?: DashboardDefaultView;
  } = {},
) {
  act(() => {
    root.render(
      <AgentNativeI18nProvider
        catalog={i18nCatalog}
        initialLocale="en-US"
        persistPreference={false}
      >
        <MemoryRouter initialEntries={[initialEntry]}>
          <DashboardFilterBar
            filters={options.list ?? filters}
            defaultView={options.defaultView}
          />
          <SearchProbe />
        </MemoryRouter>
      </AgentNativeI18nProvider>,
    );
  });
}

function resetButton(): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "Reset filters",
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

  it("resets to the dashboard's default view when it has one", () => {
    const defaultView: DashboardDefaultView = {
      id: "launch-window",
      filters: { f_timeRange: "7d", f_emailFilter: "all" },
    };
    render("/dashboards/v3?f_timeRange=90d&f_plan=free", { defaultView });
    act(() => resetButton()!.click());

    expect(Object.fromEntries(params())).toEqual({
      f_timeRange: "7d",
      f_emailFilter: "all",
      view: "launch-window",
    });
    expect(resetButton()).toBeUndefined();
  });

  it("offers the reset when the default view is set but the URL has no filters", () => {
    render("/dashboards/v3", {
      defaultView: { id: "launch-window", filters: { f_timeRange: "7d" } },
    });
    expect(resetButton()).toBeDefined();
  });
});
