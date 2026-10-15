// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  /** Undefined until a load succeeds; a failed refresh keeps the last list. */
  keyDateSets: [] as unknown[] | undefined,
  dataNotes: [] as unknown[],
  keyDatesFailed: false,
  dataNotesFailed: false,
  dataNotesRefetchFailed: false,
  /** False on a dashboard shared from another organization. */
  dataNotesEditable: true,
  t: (key: string) => key,
  toastError: vi.fn(),
  /** React Query hands back the same `data` until the list changes. */
  keyDatesData: new WeakMap<unknown[], { sets: unknown[] }>(),
}));

function keyDatesData(sets: unknown[]) {
  const data = mocks.keyDatesData.get(sets) ?? { sets };
  mocks.keyDatesData.set(sets, data);
  return data;
}

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: vi.fn((name: string) =>
    name === "list-key-dates"
      ? {
          data: mocks.keyDateSets && keyDatesData(mocks.keyDateSets),
          isError: mocks.keyDatesFailed,
        }
      : name === "list-data-notes"
        ? mocks.dataNotesFailed
          ? { data: undefined, isError: true }
          : {
              data: {
                notes: mocks.dataNotes,
                editable: mocks.dataNotesEditable,
              },
              isError: mocks.dataNotesRefetchFailed,
            }
        : { data: undefined, isError: false },
  ),
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

vi.mock("@shared/panel-events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@shared/panel-events")>();
  return { ...actual, resolvePanelEvents: vi.fn(actual.resolvePanelEvents) };
});

import { useActionQuery } from "@agent-native/core/client/hooks";
import { SETUP_INCIDENT } from "@shared/annotation-fixtures";
import { resolvePanelEvents } from "@shared/panel-events";

import type { SqlPanel } from "@/pages/adhoc/sql-dashboard/types";

import {
  DashboardAnnotationsProvider,
  type DataNoteActions,
} from "./dashboard-annotations-context";
import { layoutDataNoteLabels } from "./data-note-bands";
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
    mocks.keyDatesFailed = false;
    mocks.dataNotesFailed = false;
    mocks.dataNotesRefetchFailed = false;
    mocks.dataNotesEditable = true;
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

  async function hoverMarker(index: number) {
    const markers = container.querySelectorAll("[data-event-marker]");
    await act(async () => {
      markers[index].dispatchEvent(
        new PointerEvent("pointerover", {
          bubbles: true,
          pointerType: "mouse",
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    return document.querySelector("[data-radix-popper-content-wrapper]");
  }

  const cardRows = (card: Element | null) =>
    [...(card?.querySelectorAll("li") ?? [])].map((row) => row.textContent);

  it("lists every event of the day, with times, outside the chart's SVG", async () => {
    await act(async () => {
      root.render(<SqlChart panel={panel("line")} />);
    });
    const card = await hoverMarker(1);
    expect(card).not.toBeNull();
    expect(container.contains(card)).toBe(false);
    expect(cardRows(card)).toEqual([
      "Product Hunt live12:01 AM PT",
      "Launch posts on X, LinkedIn12:00 PM ET",
    ]);
  });

  it("dates each event a weekly point gathers from another day", async () => {
    mocks.rows = ["2026-10-05", "2026-10-12", "2026-10-19"].map(
      (day, index) => ({ day, people: 100 + index * 10 }),
    );
    await act(async () => {
      root.render(<SqlChart panel={panel("line")} />);
    });
    expect(container.querySelectorAll("[data-event-marker]")).toHaveLength(1);
    const card = await hoverMarker(0);
    expect(card?.textContent).toContain("Oct 12, 2026");
    expect(cardRows(card)).toEqual([
      "Role step first",
      "Product Hunt liveOct 14, 2026, 12:01 AM PT",
      "Launch posts on X, LinkedInOct 14, 2026, 12:00 PM ET",
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

    it("says once that key dates failed to load, and keeps each chart's own markers", async () => {
      mocks.keyDateSets = undefined;
      mocks.keyDatesFailed = true;
      await act(async () => {
        root.render(
          <DashboardAnnotationsProvider>
            <SqlChart panel={panel("line")} />
            <SqlChart panel={panel("bar")} />
          </DashboardAnnotationsProvider>,
        );
      });
      expect(mocks.toastError).toHaveBeenCalledTimes(1);
      expect(mocks.toastError).toHaveBeenCalledWith(
        "dashboard.keyDatesUnavailable",
        { id: "key-dates-unavailable" },
      );
      expect(container.querySelectorAll("[data-event-marker]")).toHaveLength(4);
    });

    it("says a refresh failed, and keeps the key dates it already drew", async () => {
      mocks.keyDatesFailed = true;
      await act(async () => {
        root.render(
          <DashboardAnnotationsProvider>
            <SqlChart panel={panel("line")} />
          </DashboardAnnotationsProvider>,
        );
      });
      expect(mocks.toastError).toHaveBeenCalledTimes(1);
      expect(mocks.toastError).toHaveBeenCalledWith(
        "dashboard.keyDatesUnavailable",
        { id: "key-dates-unavailable" },
      );
      // The panel's Oct 12 and Oct 14 markers, plus the cached Oct 11 and Oct 13 key dates.
      expect(container.querySelectorAll("[data-event-marker]")).toHaveLength(4);
    });

    it("resolves a 1,000-date list once per chart, not again on each render", async () => {
      const longAgo = Array.from({ length: 998 }, (_, day) =>
        keyDate(
          "changes",
          new Date(Date.UTC(2023, 0, 1 + day)).toISOString().slice(0, 10),
          `Old change ${day}`,
        ),
      );
      mocks.keyDateSets = [
        {
          id: "changes",
          name: "Product changes",
          createdBy: "alice@example.test",
          updatedAt: "2026-10-14T00:00:00.000Z",
          dates: [
            ...longAgo,
            keyDate("changes", "2026-10-11", "Visitor source kept"),
            keyDate("changes", "2026-10-13", "Clips launch"),
          ],
        },
      ];
      const chart = unmarked("line");
      const renderChart = () =>
        act(async () => {
          root.render(
            <DashboardAnnotationsProvider>
              <SqlChart panel={chart} />
            </DashboardAnnotationsProvider>,
          );
        });

      await renderChart();
      expect(container.querySelectorAll("[data-event-marker]")).toHaveLength(2);
      // Hovering a marker renders the chart again, and so does its parent.
      expect(cardRows(await hoverMarker(1))).toEqual(["Clips launch"]);
      await renderChart();

      expect(container.querySelectorAll("[data-event-marker]")).toHaveLength(2);
      expect(resolvePanelEvents).toHaveBeenCalledTimes(1);
    });

    it("loads the key dates and notes of the dashboard it draws, not the viewer's", async () => {
      await act(async () => {
        root.render(
          <DashboardAnnotationsProvider dashboardId="shared-dashboard">
            <SqlChart panel={unmarked("line")} />
          </DashboardAnnotationsProvider>,
        );
      });
      for (const list of ["list-key-dates", "list-data-notes"]) {
        expect(useActionQuery).toHaveBeenCalledWith(
          list,
          { dashboardId: "shared-dashboard" },
          expect.anything(),
        );
      }
    });

    it("stays quiet when there are no key dates", async () => {
      mocks.keyDateSets = [];
      await act(async () => {
        root.render(
          <DashboardAnnotationsProvider>
            <SqlChart panel={unmarked("line")} />
          </DashboardAnnotationsProvider>,
        );
      });
      expect(mocks.toastError).not.toHaveBeenCalled();
      expect(container.querySelectorAll("[data-event-marker]")).toHaveLength(0);
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

    it("still shades the note on a chart that ends in a total row", async () => {
      mocks.rows = [...mocks.rows, { day: "Total", people: 460 }];
      await renderInDashboard(failures("bar"));
      expect(container.querySelectorAll("[data-data-note-band]")).toHaveLength(
        1,
      );
      expect(container.querySelector("[data-data-note-lines]")).toBeNull();
    });

    it("shades only the note's bars on a chart sorted by something other than date, under one title", async () => {
      mocks.rows = [
        { day: "2026-10-09", people: 20 },
        { day: "2026-10-01", people: 3 },
        { day: "2026-10-13", people: 40 },
      ];
      await renderInDashboard(failures("bar"));
      const fills = [
        ...container.querySelectorAll("[data-data-note-band] rect"),
      ].map((rect) => {
        const left = Number(rect.getAttribute("x"));
        return [left, left + Number(rect.getAttribute("width"))];
      });
      expect(fills).toHaveLength(2);
      const [[firstLeft, firstRight], [secondLeft]] = fills;
      // The Oct 1 bar's slot, between the runs, stays clear.
      expect(secondLeft - firstRight).toBeCloseTo(firstRight - firstLeft, 0);
      expect(container.querySelectorAll("[data-data-note-label]")).toHaveLength(
        1,
      );
    });

    it("keeps a narrow band's whole title, inside the chart at its right edge", async () => {
      const title = "Signups counted twice after the webhook retry";
      mocks.dataNotes = [
        {
          ...SETUP_INCIDENT,
          title,
          startDate: "2026-10-14",
          endDate: "2026-10-14",
        },
      ];
      await renderInDashboard(failures("line"));
      const label = container.querySelector("[data-data-note-label]");
      expect(label?.textContent).toBe(title);
      const pill = label!.querySelector("rect")!;
      const left = Number(pill.getAttribute("x"));
      const right = left + Number(pill.getAttribute("width"));
      expect(left).toBeGreaterThanOrEqual(0);
      expect(right).toBeLessThanOrEqual(CHART_SIZE.width);
    });

    it("stacks title pills that would cover each other", () => {
      const titles = ["Signups counted twice", "Account setup failures"];
      const slots = layoutDataNoteLabels(
        [
          { left: 100, right: 110, title: titles[0] },
          { left: 120, right: 130, title: titles[1] },
          { left: 400, right: 410, title: titles[0] },
        ],
        0,
        600,
      );
      expect(slots.map((slot) => slot.text)).toEqual([...titles, titles[0]]);
      expect(slots.map((slot) => slot.row)).toEqual([0, 1, 0]);
    });

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

    it("lets an editor hide another organization's note here, but not change it", async () => {
      mocks.dataNotes = [{ ...SETUP_INCIDENT, status: "open" as const }];
      mocks.dataNotesEditable = false;
      const actions = {
        add: vi.fn(),
        edit: vi.fn(),
        markFixed: vi.fn(),
        hide: vi.fn(),
      };
      await renderInDashboard(failures("line"), {}, actions);
      const card = await openNoteCard();
      expect(cardButton(card, "annotations.hideHere")).toBeDefined();
      expect(cardButton(card, "annotations.edit")).toBeUndefined();
      expect(cardButton(card, "annotations.markFixed")).toBeUndefined();
    });

    it("holds a just-added note's actions until the server confirms it", async () => {
      mocks.dataNotes = [
        { ...SETUP_INCIDENT, id: "pending-1", status: "open" as const },
      ];
      const actions = {
        add: vi.fn(),
        edit: vi.fn(),
        markFixed: vi.fn(),
        hide: vi.fn(),
      };
      await renderInDashboard(failures("line"), {}, actions);
      const card = await openNoteCard();
      for (const text of [
        "annotations.edit",
        "annotations.markFixed",
        "annotations.hideHere",
      ]) {
        const button = cardButton(card, text)!;
        expect(button.disabled).toBe(true);
        await act(async () => button.click());
      }
      expect(actions.edit).not.toHaveBeenCalled();
      expect(actions.markFixed).not.toHaveBeenCalled();
      expect(actions.hide).not.toHaveBeenCalled();
    });

    const chartTooltip = () =>
      container.querySelector<HTMLElement>(".recharts-tooltip-wrapper")!;
    const hideNote = (noteId: string) =>
      renderInDashboard(failures("line"), {
        hiddenDataNotes: [{ noteId, panelId: "people" }],
      });
    const settle = () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

    it("leaves the chart's tooltip hidden once a note is hidden from its card", async () => {
      const open = { ...SETUP_INCIDENT, status: "open" as const };
      mocks.dataNotes = [open];
      const actions = {
        add: vi.fn(),
        edit: vi.fn(),
        markFixed: vi.fn(),
        hide: vi.fn(),
      };
      await renderInDashboard(failures("line"), {}, actions);

      const hide = cardButton(await openNoteCard(), "annotations.hideHere")!;
      await act(async () => hide.focus());
      await act(async () => hide.click());
      await hideNote(open.id);
      await settle();

      expect(container.querySelector("[data-data-note-band]")).toBeNull();
      expect(chartTooltip().style.visibility).toBe("hidden");
    });

    it("gives the chart its tooltip back when an open card's note goes away", async () => {
      await renderInDashboard(failures("line"));
      await openNoteCard();
      // Hidden from the Annotations menu, say, while the card is still open.
      await hideNote(SETUP_INCIDENT.id);
      await settle();

      await act(async () => {
        container.querySelector(".recharts-wrapper")!.dispatchEvent(
          new MouseEvent("mousemove", {
            bubbles: true,
            clientX: 400,
            clientY: 160,
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      expect(chartTooltip().style.visibility).toBe("visible");
    });

    it("opens a band's card down toward the chart, and up only when it can't fit", async () => {
      await renderInDashboard(failures("line"));
      const rect = SVGElement.prototype.getBoundingClientRect;
      // happy-dom's page has no height; the card measures the viewport by it.
      const html = document.documentElement;
      Object.defineProperty(html, "clientWidth", {
        configurable: true,
        value: window.innerWidth,
      });
      Object.defineProperty(html, "clientHeight", {
        configurable: true,
        value: window.innerHeight,
      });
      const pillAt = (top: number) => {
        SVGElement.prototype.getBoundingClientRect = () =>
          ({
            x: 100,
            y: top,
            top,
            left: 100,
            width: 80,
            height: 20,
            right: 180,
            bottom: top + 20,
          }) as DOMRect;
      };
      const sideAt = async (top: number) => {
        pillAt(top);
        const card = await openNoteCard();
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
        });
        return card?.querySelector("[data-side]")?.getAttribute("data-side");
      };
      try {
        // Room either way: below, clear of the chart card's header.
        expect(await sideAt(window.innerHeight / 2)).toBe("bottom");
        // A chart without the note drops the open card, so the next opens anew.
        await renderInDashboard(panel("line"));
        await renderInDashboard(failures("line"));
        expect(await sideAt(window.innerHeight - 30)).toBe("top");
      } finally {
        SVGElement.prototype.getBoundingClientRect = rect;
        delete (html as { clientWidth?: number }).clientWidth;
        delete (html as { clientHeight?: number }).clientHeight;
      }
    });

    it("writes a note that falls between the rows' dates under the chart, shading none of them", async () => {
      // Days with no failures have no row: Oct 10–12 sit between Oct 8 and Oct 13.
      mocks.rows = [
        { day: "2026-10-08", people: 3 },
        { day: "2026-10-13", people: 40 },
      ];
      mocks.dataNotes = [
        { ...SETUP_INCIDENT, startDate: "2026-10-10", endDate: "2026-10-12" },
      ];
      await renderInDashboard(failures("line"));
      expect(container.querySelector("[data-data-note-band]")).toBeNull();
      expect(
        container.querySelector("[data-data-note-lines]")?.textContent,
      ).toContain(SETUP_INCIDENT.title);
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

    it("says once that data notes failed to load", async () => {
      mocks.dataNotesFailed = true;
      await act(async () => {
        root.render(
          <DashboardAnnotationsProvider dashboardId="dash" annotations={{}}>
            <SqlChart panel={failures("line")} />
            <SqlChart panel={failures("bar")} />
          </DashboardAnnotationsProvider>,
        );
      });
      expect(mocks.toastError).toHaveBeenCalledTimes(1);
      expect(mocks.toastError).toHaveBeenCalledWith(
        "dashboard.dataNotesUnavailable",
        { id: "data-notes-unavailable" },
      );
      expect(container.querySelector("[data-data-note-band]")).toBeNull();
    });

    it("says data notes failed to refresh, and keeps drawing the ones it has", async () => {
      mocks.dataNotesRefetchFailed = true;
      await renderInDashboard(failures("line"));
      expect(mocks.toastError).toHaveBeenCalledWith(
        "dashboard.dataNotesUnavailable",
        { id: "data-notes-unavailable" },
      );
      expect(container.querySelectorAll("[data-data-note-band]")).toHaveLength(
        1,
      );
    });
  });
});
