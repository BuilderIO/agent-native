// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useDemoModeStatus: () => ({
    enabled: false,
    forced: false,
    isLoading: false,
  }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key} ${JSON.stringify(params)}` : key,
  useFormatters: () => ({
    formatNumber: (value: number) => value.toLocaleString("en-US"),
  }),
}));

vi.mock("@/lib/demo-chart-trend", () => ({
  createDemoChartTrendRows: (rows: Record<string, unknown>[]) => rows,
}));

vi.mock("@/lib/sql-query", () => ({
  useSqlQuery: () => ({
    data: { rows: mocks.rows },
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("@agent-native/toolkit/app/extensions", () => ({
  EmbeddedExtension: () => null,
  ExtensionSlot: () => null,
  isExtensionApiPath: () => false,
}));

import type { SqlPanel } from "@/pages/adhoc/sql-dashboard/types";

import { SqlChart } from "./SqlChart";

function panel(
  chartType: SqlPanel["chartType"],
  config?: SqlPanel["config"],
): SqlPanel {
  return {
    id: "panel",
    title: "Panel",
    sql: "SELECT 1",
    source: "first-party",
    chartType,
    width: 1,
    config,
  };
}

describe("SqlChart metric tiles and callouts", () => {
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
    vi.unstubAllGlobals();
  });

  async function render(chart: SqlPanel) {
    await act(async () => {
      root.render(<SqlChart panel={chart} />);
    });
  }

  it("shows a tile's change as a chip with the period, and the previous value in the hover text", async () => {
    mocks.rows = [
      { value: 170, previous_value: 588, period: "the 7 days before" },
    ];
    await render(panel("metric", { yKey: "value", comparison: {} }));

    const line = container.querySelector<HTMLElement>(
      "[data-metric-comparison]",
    );
    expect(line?.dataset.metricComparison).toBe("bad");
    const sentence =
      'sqlDashboard.metricComparisonDown {"change":"71%","previous":"588","period":"the 7 days before"}';
    const description = `sqlDashboard.metricComparisonWorse ${JSON.stringify({
      comparison: sentence,
    })}`;
    expect(line?.getAttribute("title")).toBe(description);
    expect(line?.querySelector(".sr-only")?.textContent).toBe(description);

    const [chip, period] = line!.querySelectorAll('[aria-hidden="true"]');
    expect(chip.textContent).toBe("71%");
    expect(
      chip.querySelector("svg.tabler-icon-arrow-down-right"),
    ).not.toBeNull();
    expect(chip.className).toContain("text-red-700");
    expect(chip.className).toContain("dark:text-red-300");
    expect(period.textContent).toBe(
      'sqlDashboard.metricComparisonVs {"period":"the 7 days before"}',
    );
  });

  it("marks a slower time as worse when lower is better", async () => {
    mocks.rows = [{ seconds: 172800, previous_value: 129600 }];
    await render(
      panel("metric", {
        yFormatter: "duration",
        comparison: { better: "lower", label: "the week before" },
      }),
    );

    const line = container.querySelector<HTMLElement>(
      "[data-metric-comparison]",
    );
    expect(line?.dataset.metricComparison).toBe("bad");
    expect(line?.querySelector('[aria-hidden="true"]')?.textContent).toBe(
      "12 hours",
    );
    expect(
      line?.querySelector("svg.tabler-icon-arrow-up-right"),
    ).not.toBeNull();
  });

  it("uses a quiet outline for no change and the default period name", async () => {
    mocks.rows = [{ value: 10, previous_value: 10 }];
    await render(panel("metric", { comparison: {} }));

    const line = container.querySelector<HTMLElement>(
      "[data-metric-comparison]",
    );
    expect(line?.dataset.metricComparison).toBe("neutral");
    const [chip, period] = line!.querySelectorAll('[aria-hidden="true"]');
    expect(chip.textContent).toBe("sqlDashboard.metricComparisonNoChange");
    expect(chip.className).toContain("ring-1");
    expect(chip.querySelector("svg")).toBeNull();
    expect(period.textContent).toBe(
      'sqlDashboard.metricComparisonVs {"period":"sqlDashboard.metricComparisonPreviousPeriod"}',
    );
  });

  it("shows no comparison without a previous value", async () => {
    mocks.rows = [{ value: 170 }];
    await render(panel("metric", { comparison: {} }));

    expect(container.textContent).toContain("170");
    expect(container.querySelector("[data-metric-comparison]")).toBeNull();
  });

  it("lists callout rows with a labeled severity icon each, without tinted boxes", async () => {
    mocks.rows = [
      { severity: "critical", message: "main is failing" },
      { severity: "Warning", message: "3 PRs wait on review" },
      { severity: "other", message: "All caught up" },
    ];
    await render(panel("callout"));

    const items = [...container.querySelectorAll("li[data-callout-severity]")];
    expect(
      items.map((item) => item.getAttribute("data-callout-severity")),
    ).toEqual(["critical", "warning", "info"]);
    expect(
      items.map((item) =>
        item.querySelector('[role="img"]')?.getAttribute("aria-label"),
      ),
    ).toEqual([
      "sqlDashboard.calloutSeverityCritical",
      "sqlDashboard.calloutSeverityWarning",
      "sqlDashboard.calloutSeverityInfo",
    ]);
    expect(items[0].closest("ul")?.className).toContain("divide-y");
    expect(container.innerHTML).not.toMatch(/bg-(red|amber|sky|blue)-/);
  });

  it("renders links in callout rows", async () => {
    mocks.rows = [
      {
        severity: "warning",
        message: "[#8067](https://github.com/o/r/pull/8067) waits on you",
      },
    ];
    await render(panel("callout"));

    const link = container.querySelector("li a");
    expect(link?.getAttribute("href")).toBe("https://github.com/o/r/pull/8067");
    expect(link?.textContent).toBe("#8067");
  });
});
