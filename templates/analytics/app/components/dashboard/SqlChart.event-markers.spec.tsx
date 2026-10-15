// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  keyDateSets: [] as unknown[],
  keyDatesFailed: false,
  t: (key: string) => key,
  toastError: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (name: string) =>
    name !== "list-key-dates"
      ? { data: undefined, isError: false }
      : mocks.keyDatesFailed
        ? { data: undefined, isError: true }
        : { data: { sets: mocks.keyDateSets }, isError: false },
  useDemoModeStatus: () => ({
    enabled: false,
    forced: false,
    isLoading: false,
  }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => mocks.t,
}));

vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));

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

import { DashboardKeyDatesProvider } from "./key-dates-context";
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
    mocks.keyDateSets = [];
    mocks.keyDatesFailed = false;
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

  describe("with the dashboard's key-date sets", () => {
    const keyDate = (setId: string, date: string, label: string) => ({
      id: `${setId}-${date}`,
      setId,
      date,
      label,
      addedBy: "alice@example.test",
      updatedAt: "2026-10-14T00:00:00.000Z",
    });

    beforeEach(() => {
      mocks.keyDateSets = [
        {
          id: "changes",
          name: "Product changes",
          createdBy: "alice@example.test",
          updatedAt: "2026-10-14T00:00:00.000Z",
          dates: [keyDate("changes", "2026-10-11", "Visitor source kept")],
        },
        {
          id: "launches",
          name: "Launches",
          createdBy: "alice@example.test",
          updatedAt: "2026-10-14T00:00:00.000Z",
          dates: [keyDate("launches", "2026-10-13", "Clips launch")],
        },
      ];
    });

    const unmarked = (chartType: SqlPanel["chartType"]): SqlPanel => ({
      ...panel(chartType),
      config: { xKey: "day", yKeys: ["people"] },
    });

    it("marks a chart that lists no events of its own", async () => {
      await act(async () => {
        root.render(
          <DashboardKeyDatesProvider>
            <SqlChart panel={unmarked("bar")} />
          </DashboardKeyDatesProvider>,
        );
      });
      expect(container.querySelectorAll("[data-event-marker]")).toHaveLength(2);
    });

    it("leaves off the sets the dashboard hides", async () => {
      await act(async () => {
        root.render(
          <DashboardKeyDatesProvider
            annotations={{ hiddenKeyDateSets: ["launches"] }}
          >
            <SqlChart panel={panel("line")} />
          </DashboardKeyDatesProvider>,
        );
      });
      // The panel's Oct 12 and Oct 14 markers, plus the Oct 11 product change.
      expect(container.querySelectorAll("[data-event-marker]")).toHaveLength(3);
    });

    it("says once that key dates failed to load, and keeps each chart's own markers", async () => {
      mocks.keyDatesFailed = true;
      await act(async () => {
        root.render(
          <DashboardKeyDatesProvider>
            <SqlChart panel={panel("line")} />
            <SqlChart panel={panel("bar")} />
          </DashboardKeyDatesProvider>,
        );
      });
      expect(mocks.toastError).toHaveBeenCalledTimes(1);
      expect(mocks.toastError).toHaveBeenCalledWith(
        "dashboard.keyDatesUnavailable",
        { id: "key-dates-unavailable" },
      );
      expect(container.querySelectorAll("[data-event-marker]")).toHaveLength(4);
    });

    it("stays quiet when there are no key dates", async () => {
      mocks.keyDateSets = [];
      await act(async () => {
        root.render(
          <DashboardKeyDatesProvider>
            <SqlChart panel={unmarked("line")} />
          </DashboardKeyDatesProvider>,
        );
      });
      expect(mocks.toastError).not.toHaveBeenCalled();
      expect(container.querySelectorAll("[data-event-marker]")).toHaveLength(0);
    });
  });
});
