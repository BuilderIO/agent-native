// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { getHiddenSeriesKeysAfterFilter, SeriesLegend } from "./SqlChart";

describe("SeriesLegend actions", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("hides every other series when filtering to one key", () => {
    expect(
      Array.from(
        getHiddenSeriesKeysAfterFilter(["alpha", "beta", "gamma"], "beta"),
      ),
    ).toEqual(["alpha", "gamma"]);
    expect(
      Array.from(getHiddenSeriesKeysAfterFilter(["alpha", "beta"], "missing")),
    ).toEqual(["alpha", "beta"]);
  });

  it("shows Filter and Hide actions while hovering a series", async () => {
    const onFilter = vi.fn();
    const onToggle = vi.fn();

    await act(async () => {
      root.render(
        <SeriesLegend
          keys={["alpha", "beta"]}
          colors={["#111", "#222"]}
          panel={{ chartType: "line", source: "first-party" } as never}
          onFilterKey={onFilter}
          onToggleKey={onToggle}
        />,
      );
    });

    const seriesButton = container.querySelector<HTMLButtonElement>(
      'button[title="alpha"]',
    );
    expect(seriesButton).not.toBeNull();

    await act(async () => {
      seriesButton!.dispatchEvent(
        new PointerEvent("pointerenter", { bubbles: true }),
      );
      seriesButton!.dispatchEvent(
        new PointerEvent("pointerover", { bubbles: true }),
      );
    });

    const filterButton = document.body.querySelector<HTMLButtonElement>(
      '[data-chart-legend-action="filter"]',
    );
    const hideButton = document.body.querySelector<HTMLButtonElement>(
      '[data-chart-legend-action="hide"]',
    );
    expect(filterButton?.getAttribute("aria-label")).toBe(
      "sqlDashboard.filterSeries alpha",
    );
    expect(hideButton?.getAttribute("aria-label")).toBe(
      "sqlDashboard.hide alpha",
    );

    await act(async () => {
      filterButton!.click();
    });
    expect(onFilter).toHaveBeenCalledWith("alpha");
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("keeps actions open long enough to move from a legend item to its menu", async () => {
    vi.useFakeTimers();

    await act(async () => {
      root.render(
        <SeriesLegend
          keys={["alpha", "beta"]}
          colors={["#111", "#222"]}
          panel={{ chartType: "line", source: "first-party" } as never}
          onFilterKey={vi.fn()}
          onToggleKey={vi.fn()}
        />,
      );
    });

    const seriesButton = container.querySelector<HTMLButtonElement>(
      'button[title="alpha"]',
    );
    expect(seriesButton).not.toBeNull();

    await act(async () => {
      seriesButton!.dispatchEvent(
        new PointerEvent("pointerenter", { bubbles: true }),
      );
      seriesButton!.dispatchEvent(
        new PointerEvent("pointerover", { bubbles: true }),
      );
      seriesButton!.dispatchEvent(
        new PointerEvent("pointerleave", { bubbles: true }),
      );
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(
      document.body.querySelector('[data-chart-legend-action="filter"]'),
    ).not.toBeNull();
  });

  it("keeps the legend click as the hide toggle", async () => {
    const onFilter = vi.fn();
    const onToggle = vi.fn();

    await act(async () => {
      root.render(
        <SeriesLegend
          keys={["alpha", "beta"]}
          colors={["#111", "#222"]}
          panel={{ chartType: "line", source: "first-party" } as never}
          onFilterKey={onFilter}
          onToggleKey={onToggle}
        />,
      );
    });

    const seriesButton = container.querySelector<HTMLButtonElement>(
      'button[title="alpha"]',
    );
    expect(seriesButton).not.toBeNull();

    await act(async () => {
      seriesButton!.click();
    });

    expect(onToggle).toHaveBeenCalledWith("alpha");
    expect(onFilter).not.toHaveBeenCalled();
  });

  it("opens the action popover from a touch without toggling the series", async () => {
    const onFilter = vi.fn();
    const onToggle = vi.fn();

    await act(async () => {
      root.render(
        <SeriesLegend
          keys={["alpha", "beta"]}
          colors={["#111", "#222"]}
          panel={{ chartType: "line", source: "first-party" } as never}
          onFilterKey={onFilter}
          onToggleKey={onToggle}
        />,
      );
    });

    const seriesButton = container.querySelector<HTMLButtonElement>(
      'button[title="alpha"]',
    );
    expect(seriesButton).not.toBeNull();

    await act(async () => {
      seriesButton!.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          pointerType: "touch",
        }),
      );
      seriesButton!.click();
    });

    expect(onToggle).not.toHaveBeenCalled();
    expect(
      document.body.querySelector('[data-chart-legend-action="filter"]'),
    ).not.toBeNull();
  });
});
