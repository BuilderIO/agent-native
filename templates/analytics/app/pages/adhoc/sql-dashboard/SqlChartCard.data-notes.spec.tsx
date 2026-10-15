// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ dataNotes: [] as unknown[] }));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (name: string) => ({
    data: name === "list-data-notes" ? { notes: mocks.dataNotes } : undefined,
  }),
  useActionMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChat: vi.fn(),
}));

vi.mock("@/components/dashboard/SqlChart", () => ({
  SqlChart: () => null,
  ChartFillHeight: ({ children }: { children: unknown }) => children,
}));

import { CONNECT_UNDERCOUNT } from "@shared/annotation-fixtures";

import { DashboardAnnotationsProvider } from "@/components/dashboard/dashboard-annotations-context";
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
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const renderCard = async (panel: SqlPanel) => {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <DashboardAnnotationsProvider dashboardId="dash" annotations={{}}>
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
});
