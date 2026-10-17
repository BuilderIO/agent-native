// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: {
    data: {
      rows: [
        { name: "b", signups: 1 },
        { name: "a", signups: 2 },
      ] as Record<string, unknown>[],
    },
    isLoading: false,
    isFetching: false,
    isPlaceholderData: false,
    error: null as Error | null,
    refetch: vi.fn(),
    freshness: undefined as unknown,
  },
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useDemoModeStatus: () => ({
    enabled: false,
    forced: false,
    isLoading: false,
  }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
  useFormatters: () => ({
    formatDate: (value: string) => value,
    formatNumber: (value: number) => String(value),
  }),
}));

vi.mock("@/lib/demo-chart-trend", () => ({
  createDemoChartTrendRows: (rows: Record<string, unknown>[]) => rows,
}));

vi.mock("@/lib/sql-query", () => ({
  useSqlQuery: () => mocks.query,
}));

vi.mock("@agent-native/toolkit/app/extensions", () => ({
  EmbeddedExtension: () => null,
  ExtensionSlot: () => null,
}));

import type { SqlPanel } from "@/pages/adhoc/sql-dashboard/types";

import { SqlChart } from "./SqlChart";

describe("SqlChart renderer state across a refresh", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.query.isFetching = false;
    mocks.query.data.rows = Array.from({ length: 25 }, (_, index) => ({
      name: `row-${index}`,
      signups: index,
      visits: index * 2,
    }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 640,
      height: 320,
      top: 0,
      left: 0,
      right: 640,
      bottom: 320,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(640);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(320);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const panel = {
    id: "signups",
    title: "Signups",
    sql: "SELECT name, signups FROM t",
    source: "bigquery" as const,
    chartType: "table" as const,
    width: 1,
  };
  const render = (target: SqlPanel = panel) =>
    act(async () => {
      root.render(<SqlChart panel={target} />);
    });
  const header = (name: string) =>
    Array.from(container.querySelectorAll("th")).find(
      (th) => th.textContent === name,
    ) as HTMLTableCellElement;

  it("keeps the table mounted and sorted while the updating notice comes and goes", async () => {
    await render();
    const table = container.querySelector("table");
    const signupsHeader = header("signups");
    expect(table).not.toBeNull();
    expect(signupsHeader.getAttribute("aria-sort")).toBe("none");

    await act(async () => {
      signupsHeader.click();
    });
    expect(header("signups").getAttribute("aria-sort")).toBe("descending");
    const nextPage = container.querySelector<HTMLButtonElement>(
      "button:has(svg.tabler-icon-chevron-right)",
    );
    expect(nextPage).not.toBeNull();
    await act(async () => nextPage!.click());
    expect(container.textContent).toContain("11–20 of 25");
    const visibleRows = Array.from(
      container.querySelectorAll("tbody tr"),
      (row) => row.textContent,
    );

    mocks.query.isFetching = true;
    await render();
    expect(
      container.querySelector("[data-dashboard-report-updating]"),
    ).not.toBeNull();
    expect(container.querySelector("table")).toBe(table);
    expect(header("signups")).toBe(signupsHeader);
    expect(header("signups").getAttribute("aria-sort")).toBe("descending");
    expect(container.textContent).toContain("11–20 of 25");
    expect(
      Array.from(
        container.querySelectorAll("tbody tr"),
        (row) => row.textContent,
      ),
    ).toEqual(visibleRows);

    mocks.query.isFetching = false;
    await render();
    expect(
      container.querySelector("[data-dashboard-report-updating]"),
    ).toBeNull();
    expect(container.querySelector("table")).toBe(table);
    expect(header("signups")).toBe(signupsHeader);
    expect(header("signups").getAttribute("aria-sort")).toBe("descending");
    expect(container.textContent).toContain("11–20 of 25");
    expect(
      Array.from(
        container.querySelectorAll("tbody tr"),
        (row) => row.textContent,
      ),
    ).toEqual(visibleRows);
  });

  it("keeps hidden legend series while the notice comes and goes", async () => {
    const chart: SqlPanel = {
      ...panel,
      chartType: "bar",
      config: { xKey: "name", yKeys: ["signups", "visits"] },
    };
    await render(chart);
    const legend = container.querySelector<HTMLButtonElement>(
      '[data-chart-legend-item="signups"]',
    );
    expect(legend).not.toBeNull();
    expect(legend!.getAttribute("aria-pressed")).toBe("true");
    await act(async () => legend!.click());
    expect(legend!.getAttribute("aria-pressed")).toBe("false");
    for (const fetching of [true, false]) {
      mocks.query.isFetching = fetching;
      await render(chart);
      expect(
        container.querySelector('[data-chart-legend-item="signups"]'),
      ).toBe(legend);
      expect(legend!.getAttribute("aria-pressed")).toBe("false");
    }
  });
});
