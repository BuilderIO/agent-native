// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  keyDateSets: [] as unknown[],
  dataNotes: [] as unknown[],
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (name: string) => ({
    data:
      name === "list-key-dates"
        ? { sets: mocks.keyDateSets }
        : name === "list-data-notes"
          ? { notes: mocks.dataNotes }
          : undefined,
  }),
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

import { SETUP_INCIDENT } from "@shared/annotation-fixtures";

import type { SqlPanel } from "@/pages/adhoc/sql-dashboard/types";

import {
  DashboardAnnotationsProvider,
  type DataNoteActions,
} from "./dashboard-annotations-context";
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
    mocks.dataNotes = [];
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
          <DashboardAnnotationsProvider>
            <SqlChart panel={unmarked("bar")} />
          </DashboardAnnotationsProvider>,
        );
      });
      expect(container.querySelectorAll("[data-event-marker]")).toHaveLength(2);
    });

    it("leaves off the sets the dashboard hides", async () => {
      await act(async () => {
        root.render(
          <DashboardAnnotationsProvider
            annotations={{ hiddenKeyDateSets: ["launches"] }}
          >
            <SqlChart panel={panel("line")} />
          </DashboardAnnotationsProvider>,
        );
      });
      // The panel's Oct 12 and Oct 14 markers, plus the Oct 11 product change.
      expect(container.querySelectorAll("[data-event-marker]")).toHaveLength(3);
    });
  });

  describe("with the owner's data notes", () => {
    const failures = (chartType: SqlPanel["chartType"]): SqlPanel => ({
      ...panel(chartType),
      sql: "SELECT day, count(*) AS people FROM events WHERE event = 'builder_connect_failed'",
      config: { xKey: "day", yKeys: ["people"] },
    });

    beforeEach(() => {
      mocks.dataNotes = [SETUP_INCIDENT];
    });

    const renderInDashboard = async (
      chart: SqlPanel,
      annotations = {},
      dataNoteActions?: DataNoteActions,
    ) => {
      await act(async () => {
        root.render(
          <DashboardAnnotationsProvider
            dashboardId="dash"
            annotations={annotations}
            dataNoteActions={dataNoteActions}
          >
            <SqlChart panel={chart} />
          </DashboardAnnotationsProvider>,
        );
      });
    };

    it.each(["line", "area", "bar", "combo"] as const)(
      "shades the note's days on a %s chart that counts its event",
      async (chartType) => {
        await renderInDashboard(failures(chartType));
        expect(
          container.querySelectorAll("[data-data-note-band]"),
        ).toHaveLength(1);
        expect(
          container.querySelector("[data-data-note-label]")?.textContent,
        ).toContain(SETUP_INCIDENT.title);
      },
    );

    it("leaves charts alone that do not count the event, or that hide the note", async () => {
      await renderInDashboard(panel("line"));
      expect(container.querySelector("[data-data-note-band]")).toBeNull();

      await renderInDashboard(failures("line"), {
        hiddenDataNotes: [{ noteId: SETUP_INCIDENT.id, panelId: "people" }],
      });
      expect(container.querySelector("[data-data-note-band]")).toBeNull();
    });

    const openNoteCard = async () => {
      const label = container.querySelector("[data-data-note-label]")!;
      await act(async () => {
        label.dispatchEvent(
          new PointerEvent("pointerover", {
            bubbles: true,
            pointerType: "mouse",
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      return document.querySelector("[data-radix-popper-content-wrapper]");
    };

    const cardButton = (card: Element | null, text: string) =>
      [...(card?.querySelectorAll("button") ?? [])].find(
        (button) => button.textContent === text,
      );

    it("hides a note on this chart, or marks it fixed, from its card", async () => {
      const open = { ...SETUP_INCIDENT, status: "open" as const };
      mocks.dataNotes = [open];
      const actions = {
        add: vi.fn(),
        edit: vi.fn(),
        markFixed: vi.fn(),
        hide: vi.fn(),
      };
      await renderInDashboard(failures("line"), {}, actions);

      let card = await openNoteCard();
      await act(async () => cardButton(card, "annotations.hideHere")!.click());
      expect(actions.hide).toHaveBeenCalledWith(open.id, "people");

      card = await openNoteCard();
      await act(async () => cardButton(card, "annotations.markFixed")!.click());
      expect(actions.markFixed).toHaveBeenCalledWith(open);
    });

    it("offers no hiding to a viewer who can't edit the dashboard", async () => {
      const actions = { add: vi.fn(), edit: vi.fn(), markFixed: vi.fn() };
      await renderInDashboard(failures("line"), {}, actions);
      const card = await openNoteCard();
      expect(cardButton(card, "annotations.edit")).toBeDefined();
      expect(cardButton(card, "annotations.hideHere")).toBeUndefined();
      // A fixed note has nothing left to mark fixed.
      expect(cardButton(card, "annotations.markFixed")).toBeUndefined();
    });

    it("writes the note under a chart whose x-axis is not dates", async () => {
      mocks.rows = [
        { day: "Signup", people: 120 },
        { day: "Connect", people: 80 },
      ];
      await renderInDashboard(failures("bar"));
      expect(container.querySelector("[data-data-note-band]")).toBeNull();
      expect(
        container.querySelector("[data-data-note-lines]")?.textContent,
      ).toContain(SETUP_INCIDENT.title);
    });
  });
});
