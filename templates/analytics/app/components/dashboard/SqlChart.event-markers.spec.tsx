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
  useT: () => (key: string) => key,
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
}));

import type { SqlPanel } from "@/pages/adhoc/sql-dashboard/types";

import { SqlChart } from "./SqlChart";

const CHART_SIZE = { width: 640, height: 320 };

// The Oct 14, 2026 launch: two moments on one day, plus an earlier change.
const EVENTS = [
  {
    date: "2026-10-14",
    time: "12:00",
    timeZone: "America/New_York",
    label: "Launch posts on X, LinkedIn",
  },
  {
    date: "2026-10-14",
    time: "00:01",
    timeZone: "America/Los_Angeles",
    label: "Product Hunt live",
  },
  { date: "2026-10-12", label: "Role step first" },
];

function panel(chartType: SqlPanel["chartType"]): SqlPanel {
  return {
    id: "people",
    title: "New people",
    sql: "SELECT 1",
    source: "first-party",
    chartType,
    width: 1,
    config: { xKey: "day", yKeys: ["people"], events: EVENTS },
  };
}

describe("SqlChart key-date markers", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    for (const [prop, value] of Object.entries(CHART_SIZE)) {
      Object.defineProperty(
        HTMLElement.prototype,
        prop === "width" ? "offsetWidth" : "offsetHeight",
        { configurable: true, value },
      );
    }
    HTMLElement.prototype.getBoundingClientRect = () =>
      ({ ...CHART_SIZE, top: 0, left: 0, right: 640, bottom: 320 }) as DOMRect;

    mocks.rows = ["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14"].map(
      (day, index) => ({ day, people: 100 + index * 10 }),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it.each(["line", "area", "bar", "combo"] as const)(
    "draws one marker per day on a %s chart",
    async (chartType) => {
      await act(async () => {
        root.render(<SqlChart panel={panel(chartType)} />);
      });
      expect(container.querySelectorAll("[data-event-marker]")).toHaveLength(2);
    },
  );

  it("lists every event of the day, with times, outside the chart's SVG", async () => {
    await act(async () => {
      root.render(<SqlChart panel={panel("line")} />);
    });
    const markers = container.querySelectorAll("[data-event-marker]");
    await act(async () => {
      markers[1].dispatchEvent(
        new PointerEvent("pointerover", {
          bubbles: true,
          pointerType: "mouse",
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    const card = document.querySelector("[data-radix-popper-content-wrapper]");
    expect(card).not.toBeNull();
    expect(container.contains(card)).toBe(false);
    const rows = [...(card?.querySelectorAll("li") ?? [])].map(
      (row) => row.textContent,
    );
    expect(rows).toEqual([
      "Product Hunt live12:01 AM PT",
      "Launch posts on X, LinkedIn12:00 PM ET",
    ]);
  });
});
