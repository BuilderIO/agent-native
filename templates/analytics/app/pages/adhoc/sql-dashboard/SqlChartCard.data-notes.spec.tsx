// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dataNotes: [] as unknown[],
  dataNotesLoaded: true,
  chart: null as null | ((props: { panel: unknown }) => null),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (name: string) => ({
    data:
      name === "list-data-notes" && mocks.dataNotesLoaded
        ? { notes: mocks.dataNotes, editable: true }
        : undefined,
  }),
  useActionMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSession: () => ({
    session: { email: "a@example.com", userId: "user-a", orgId: "org-1" },
    status: "authenticated",
  }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChat: vi.fn(),
}));

vi.mock("@/components/dashboard/SqlChart", () => ({
  SqlChart: (props: { panel: unknown }) => mocks.chart?.(props) ?? null,
  ChartFillHeight: ({ children }: { children: unknown }) => children,
}));

import { CONNECT_UNDERCOUNT } from "@shared/annotation-fixtures";

import {
  DashboardAnnotationsProvider,
  type DataNoteActions,
  usePanelDataNotes,
} from "@/components/dashboard/dashboard-annotations-context";
import { useDataNoteLayout } from "@/components/dashboard/data-note-bands";
import { TooltipProvider } from "@/components/ui/tooltip";

import { SqlChartCard } from "./SqlChartCard";
import type { SqlPanel } from "./types";

const clicksByStep: SqlPanel = {
  id: "connect-by-step",
  title: "Connect clicks by onboarding step",
  sql: "SELECT step, count(*) FROM events WHERE event = 'builder connect clicked' GROUP BY step",
  source: "first-party",
  chartType: "table",
  width: 1,
};

describe("SqlChartCard data-note flag", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    mocks.dataNotes = [CONNECT_UNDERCOUNT];
    mocks.chart = null;
    mocks.dataNotesLoaded = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const renderCard = async (
    panel: SqlPanel,
    dataNoteActions?: DataNoteActions,
  ) => {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <DashboardAnnotationsProvider
            dashboardId="dash"
            annotations={{}}
            dataNoteActions={dataNoteActions}
          >
            <SqlChartCard panel={panel} onRemove={() => {}} />
          </DashboardAnnotationsProvider>
        </TooltipProvider>,
      );
    });
  };

  it("sits beside the panel title, apart from the panel's toolbar", async () => {
    await renderCard(clicksByStep);
    const flag = container.querySelector("[data-data-note-flag]");
    const title = container.querySelector("h3");
    expect(flag?.getAttribute("aria-label")).toBe("dataNotes.flagLabel");
    expect(title?.textContent).toBe(clicksByStep.title);
    expect(flag?.parentElement).toBe(title?.parentElement);
    expect(
      flag?.parentElement?.querySelector(
        '[aria-label="sqlDashboard.panelOptions"]',
      ),
    ).toBeNull();
  });

  const pressEnter = (el: Element) =>
    act(async () => {
      el.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  const menuItem = (text: string) =>
    [...document.querySelectorAll('[role="menuitem"]')].find(
      (el) => el.textContent === text,
    );

  it("lets a keyboard user hide a note on this chart from the chart's menu", async () => {
    const hide = vi.fn();
    await renderCard(clicksByStep, { hide });
    await pressEnter(
      container.querySelector('[aria-label="sqlDashboard.panelOptions"]')!,
    );
    await pressEnter(menuItem("annotations.hideNoteHere")!);
    expect(hide).toHaveBeenCalledWith(CONNECT_UNDERCOUNT.id, clicksByStep.id);
  });

  it("offers no hiding in the chart's menu to a viewer who can't edit the dashboard", async () => {
    await renderCard(clicksByStep, { edit: vi.fn() });
    await pressEnter(
      container.querySelector('[aria-label="sqlDashboard.panelOptions"]')!,
    );
    expect(menuItem("annotations.hideNoteHere")).toBeUndefined();
  });

  it.each([true, false])(
    "offers adding a note only once the list says the notes are the viewer's (loaded: %s)",
    async (loaded) => {
      mocks.dataNotesLoaded = loaded;
      await renderCard(clicksByStep, { add: vi.fn(), hide: vi.fn() });
      await pressEnter(
        container.querySelector('[aria-label="sqlDashboard.panelOptions"]')!,
      );
      expect(menuItem("annotations.addDataNote") !== undefined).toBe(loaded);
    },
  );

  it.each(["stacked-bar", "stacked-area"])(
    "leaves a legacy %s chart's notes to the chart, which draws them on its dates",
    async (chartType) => {
      await renderCard({
        ...clicksByStep,
        sql: "SELECT day, count(*) FROM events WHERE event = 'builder connect clicked' GROUP BY day",
        chartType: chartType as SqlPanel["chartType"],
      });
      expect(container.querySelector("[data-data-note-flag]")).toBeNull();
      expect(container.querySelector("[data-data-note-lines]")).toBeNull();
    },
  );

  describe("on a time chart", () => {
    const clicksOverTime: SqlPanel = { ...clicksByStep, chartType: "line" };
    const plotting = (rows: Record<string, unknown>[], xKey: string) => {
      mocks.chart = ({ panel }) => {
        useDataNoteLayout(usePanelDataNotes(panel as SqlPanel), rows, xKey);
        return null;
      };
    };

    it("flags the notes it lists under a plot whose x values aren't dates", async () => {
      plotting([{ step: "Connect" }, { step: "Publish" }], "step");
      await renderCard(clicksOverTime);
      expect(
        container
          .querySelector("[data-data-note-flag]")
          ?.getAttribute("aria-label"),
      ).toBe("dataNotes.flagLabel");
      expect(container.querySelector("[data-data-note-lines]")).toBeNull();
    });

    it("leaves the flag off when every note shades its dates", async () => {
      plotting(
        [{ day: "2026-10-01" }, { day: "2026-10-02" }, { day: "2026-10-03" }],
        "day",
      );
      await renderCard(clicksOverTime);
      expect(container.querySelector("[data-data-note-flag]")).toBeNull();
    });
  });
});
