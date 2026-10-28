// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ locale: "en" }));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, string>) => {
    if (values?.age) {
      return mocks.locale === "fr"
        ? `Mis à jour ${values.age}`
        : `Updated ${values.age}`;
    }
    return values?.time ? `${key}(${values.time})` : key;
  },
  useFormatters: () => ({
    formatDate: (value: string, options?: { dateStyle?: string }) =>
      options?.dateStyle ? `full:${value}` : `formatted:${value}`,
    formatRelativeTime: (
      value: number,
      unit: Intl.RelativeTimeFormatUnit,
      options?: Intl.RelativeTimeFormatOptions,
    ) => new Intl.RelativeTimeFormat(mocks.locale, options).format(value, unit),
  }),
}));

import { TooltipProvider } from "@/components/ui/tooltip";

import { PanelFreshnessClock } from "./PanelFreshnessClock";

const FETCHED_AT = "2026-10-14T12:00:00.000Z";

describe("PanelFreshnessClock", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(Date.parse(FETCHED_AT) + 5 * 60_000);
    mocks.locale = "en";
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const render = (
    freshness: Parameters<typeof PanelFreshnessClock>[0]["freshness"],
    showAge = false,
  ) =>
    act(async () => {
      root.render(
        <TooltipProvider>
          <PanelFreshnessClock freshness={freshness} showAge={showAge} />
        </TooltipProvider>,
      );
    });
  const button = () => container.querySelector("button")!;
  const visibleText = () =>
    button().querySelector(".panel-freshness-text")?.textContent;
  const tooltip = () =>
    document.body.querySelector("[data-agent-native-tooltip]");

  it("names the full timestamp and cache state as the button's accessible name", async () => {
    await render({ fetchedAt: FETCHED_AT, cache: "app-cache" });

    expect(button().getAttribute("aria-label")).toBe(
      `sqlDashboard.fetchedAt(full:${FETCHED_AT}) · sqlDashboard.cacheApp`,
    );
    expect(button().getAttribute("type")).toBe("button");
  });

  it("opens on keyboard focus so the full timestamp can be read without a pointer", async () => {
    await render({ fetchedAt: FETCHED_AT, cache: "live" });
    expect(tooltip()).toBeNull();

    await act(async () => button().focus());

    expect(tooltip()?.textContent).toContain(
      `sqlDashboard.fetchedAt(full:${FETCHED_AT})`,
    );
  });

  it("opens on a tap, where hover and focus never fire", async () => {
    await render({ fetchedAt: FETCHED_AT, cache: "provider-cache" });

    await act(async () => button().click());

    expect(tooltip()?.textContent).toContain("sqlDashboard.cacheProvider");
  });

  it("says plainly when the fetch time and cache state are unknown", async () => {
    await render({ cache: "unknown" });

    expect(button().getAttribute("aria-label")).toBe(
      "sqlDashboard.fetchTimeUnknown · sqlDashboard.cacheUnknown",
    );
  });

  it("names a live result by its time alone, with no cache suffix", async () => {
    await render({ fetchedAt: FETCHED_AT, cache: "live" });

    expect(button().getAttribute("aria-label")).toBe(
      `sqlDashboard.fetchedAt(full:${FETCHED_AT})`,
    );
  });

  it("shows a short localized relative age while preserving the full timestamp and cache provenance", async () => {
    await render({ fetchedAt: FETCHED_AT, cache: "app-cache" }, true);

    expect(visibleText()).toBe("Updated 5m ago");
    expect(button().getAttribute("aria-label")).toBe(
      `sqlDashboard.fetchedAt(full:${FETCHED_AT}) · sqlDashboard.cacheApp`,
    );

    mocks.locale = "fr";
    await render({ fetchedAt: FETCHED_AT, cache: "app-cache" }, true);

    expect(visibleText()).toBe(
      `Mis à jour ${new Intl.RelativeTimeFormat("fr", { style: "narrow", numeric: "always" }).format(-5, "minute")}`,
    );
  });

  it.each([
    [60, "Updated 1h ago"],
    [24 * 60, "Updated 1d ago"],
  ])(
    "keeps the relative age short after %s minutes",
    async (minutes, label) => {
      vi.setSystemTime(Date.parse(FETCHED_AT) + minutes * 60_000);

      await render({ fetchedAt: FETCHED_AT, cache: "live" }, true);

      expect(visibleText()).toBe(label);
    },
  );

  it("advances the displayed age on the next minute without a parent render", async () => {
    vi.setSystemTime(Date.parse(FETCHED_AT) + 5 * 60_000 + 59_000);
    await render({ fetchedAt: FETCHED_AT, cache: "live" }, true);
    const originalButton = button();
    expect(visibleText()).toBe("Updated 5m ago");

    await act(async () => vi.advanceTimersByTime(1_000));

    expect(button()).toBe(originalButton);
    expect(visibleText()).toBe("Updated 6m ago");
  });

  it.each([
    [
      "updating",
      "sqlDashboard.updating",
      "data-dashboard-report-updating",
      "refresh",
    ],
    [
      "previous-filters-updating",
      "sqlDashboard.updatingPreviousFilters",
      "data-dashboard-report-updating",
      "previous-filters",
    ],
    [
      "previous-filters",
      "sqlDashboard.previousFilters",
      "data-dashboard-report-paused",
      "previous-filters",
    ],
    [
      "refreshed",
      "sqlDashboard.refreshed",
      "data-dashboard-report-refreshed",
      "",
    ],
  ] as const)(
    "announces %s without losing the timestamp or cache state",
    async (status, label, attribute, value) => {
      await render({ fetchedAt: FETCHED_AT, cache: "provider-cache" }, true);
      const originalButton = button();

      await render(
        { fetchedAt: FETCHED_AT, cache: "provider-cache", status },
        true,
      );

      expect(button()).toBe(originalButton);
      expect(visibleText()).toBe(label);
      expect(button().querySelector('[role="status"]')?.textContent).toBe(
        label,
      );
      expect(button().getAttribute(attribute)).toBe(value);
      expect(button().getAttribute("aria-label")).toBe(
        `${label} · sqlDashboard.fetchedAt(full:${FETCHED_AT}) · sqlDashboard.cacheProvider`,
      );
      await act(async () => button().click());
      expect(tooltip()?.textContent).toContain(label);
      expect(tooltip()?.textContent).toContain(`full:${FETCHED_AT}`);
      expect(tooltip()?.textContent).toContain("sqlDashboard.cacheProvider");
    },
  );

  it("keeps the stale clock readable and removes obsolete refresh state", async () => {
    await render(
      { fetchedAt: FETCHED_AT, cache: "restored", status: "refreshed" },
      true,
    );
    await render(
      { fetchedAt: FETCHED_AT, cache: "restored", status: "stale" },
      true,
    );

    expect(button().getAttribute("data-dashboard-report-stale")).toBe(
      "restored",
    );
    expect(button().hasAttribute("data-dashboard-report-refreshed")).toBe(
      false,
    );
    expect(visibleText()).toBe("Updated 5m ago");
    expect(button().querySelector('[role="status"]')?.textContent).toBe("");
    expect(button().getAttribute("aria-label")).toContain(
      "sqlDashboard.cacheRestored",
    );
  });
});
