// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PanelFreshness } from "@/components/dashboard/panel-freshness";

const mocks = vi.hoisted(() => ({
  session: { userId: "test-user", orgId: "test-org" } as {
    userId: string;
    orgId: string;
  } | null,
  sessionStatus: "authenticated" as
    | "authenticated"
    | "loading"
    | "unauthenticated",
  chartProps: [] as Array<{
    panelId: string;
    onFreshnessChange?: (freshness: PanelFreshness | null) => void;
  }>,
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  useActionMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSession: () => ({ session: mocks.session, status: mocks.sessionStatus }),
}));

vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/agent-chat")
  >()),
  sendToAgentChat: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, string>) =>
    values?.time
      ? `${key}(${values.time})`
      : values?.age
        ? `Updated ${values.age}`
        : key,
  useFormatters: () => ({
    formatDate: (value: string, options?: { dateStyle?: string }) =>
      options?.dateStyle ? `full:${value}` : `formatted:${value}`,
    formatRelativeTime: (
      value: number,
      unit: Intl.RelativeTimeFormatUnit,
      options?: Intl.RelativeTimeFormatOptions,
    ) => new Intl.RelativeTimeFormat("en", options).format(value, unit),
  }),
}));

vi.mock("@dnd-kit/core", () => ({
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setActivatorNodeRef: () => {},
    setNodeRef: () => {},
  }),
}));

vi.mock("@/components/dashboard/SqlChart", () => ({
  ChartFillHeight: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
  SqlChart: (props: {
    panel: { id: string };
    onFreshnessChange?: (freshness: PanelFreshness | null) => void;
  }) => {
    mocks.chartProps.push({
      panelId: props.panel.id,
      onFreshnessChange: props.onFreshnessChange,
    });
    return <div data-testid="chart-body" />;
  },
}));

vi.mock("./ViewSqlPopover", () => ({
  ViewSqlPopover: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/components/ui/dropdown-menu", () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  );
  return {
    DropdownMenu: Passthrough,
    DropdownMenuContent: () => null,
    DropdownMenuLabel: Passthrough,
    DropdownMenuRadioGroup: Passthrough,
    DropdownMenuRadioItem: Passthrough,
    DropdownMenuSeparator: () => null,
    DropdownMenuSub: Passthrough,
    DropdownMenuSubContent: Passthrough,
    DropdownMenuSubTrigger: Passthrough,
    DropdownMenuTrigger: Passthrough,
    DropdownMenuItem: Passthrough,
  };
});

import { TooltipProvider } from "@/components/ui/tooltip";

import { SqlChartCard } from "./SqlChartCard";
import type { SqlPanel } from "./types";

const FETCHED_AT = "2026-10-14T12:00:00.000Z";

const panel: SqlPanel = {
  id: "signups",
  title: "Signups",
  sql: "SELECT 1 AS value",
  source: "bigquery",
  chartType: "metric",
  width: 1,
};

describe("SqlChartCard freshness clock", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(Date.parse(FETCHED_AT) + 5 * 60_000);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.session = { userId: "test-user", orgId: "test-org" };
    mocks.sessionStatus = "authenticated";
    mocks.chartProps = [];
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

  const render = (props: Partial<Parameters<typeof SqlChartCard>[0]> = {}) =>
    act(async () => {
      root.render(
        <TooltipProvider>
          <SqlChartCard
            panel={panel}
            onRemove={() => {}}
            dashboardId="dashboard-1"
            eagerLoad
            {...props}
          />
        </TooltipProvider>,
      );
    });
  const report = (freshness: PanelFreshness | null) =>
    act(async () => {
      mocks.chartProps[mocks.chartProps.length - 1]!.onFreshnessChange?.(
        freshness,
      );
    });
  const clock = () =>
    container.querySelector<HTMLElement>("[data-dashboard-report-freshness]");

  it("shows no clock until the chart reports a result", async () => {
    await render();
    expect(clock()).toBeNull();
  });

  it("keeps a section card visible when its saved description is not a string", async () => {
    await render({
      panel: {
        ...panel,
        chartType: "section",
        config: {
          description: { note: "This is not panel copy" },
        } as unknown as SqlPanel["config"],
      },
    });

    expect(container.textContent).toContain("Signups");
    expect(container.textContent).not.toContain("This is not panel copy");
    expect(container.textContent).not.toContain("[object Object]");
  });

  it.each(["focus", "mouse", "touch"] as const)(
    "discloses the full title on first %s without selecting the card",
    async (interaction) => {
      const title =
        "Revenue from international organizations with a long localized name";
      const onSelectForChat = vi.fn();
      await render({ panel: { ...panel, title }, onSelectForChat });
      const heading = container.querySelector<HTMLElement>(
        ".dashboard-panel-title h3",
      )!;
      const trigger = heading.querySelector<HTMLButtonElement>("button")!;
      expect(heading.textContent).toBe(title);
      expect(trigger).not.toBeNull();
      expect(trigger.type).toBe("button");
      expect(trigger.tabIndex).toBe(0);
      expect(
        document.body.querySelector("[data-agent-native-tooltip]"),
      ).toBeNull();

      await act(async () => {
        if (interaction !== "focus") {
          trigger.dispatchEvent(
            new PointerEvent("pointerdown", {
              bubbles: true,
              pointerType: interaction,
              pointerId: 1,
            }),
          );
          if (interaction === "touch") {
            trigger.dispatchEvent(
              new PointerEvent("pointerup", {
                bubbles: true,
                pointerType: interaction,
                pointerId: 1,
              }),
            );
          }
        }
        trigger.focus();
      });
      if (interaction !== "focus") {
        if (interaction === "mouse") {
          expect(document.body.querySelector("[role='tooltip']")).toBeNull();
        }
        await act(async () => {
          if (interaction === "mouse") {
            trigger.dispatchEvent(
              new PointerEvent("pointerup", {
                bubbles: true,
                pointerType: interaction,
                pointerId: 1,
              }),
            );
          }
          trigger.dispatchEvent(
            new MouseEvent("click", {
              bubbles: true,
              cancelable: true,
            }),
          );
        });
      }
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1200);
      });

      expect(
        document.body.querySelector("[data-agent-native-tooltip]")?.textContent,
      ).toContain(title);
      expect(onSelectForChat).not.toHaveBeenCalled();
      expect(container.querySelector(".dashboard-panel-title h3")).toBe(
        heading,
      );
      expect(heading.querySelector("button")).toBe(trigger);
      await act(async () => {
        trigger.blur();
      });
      expect(document.body.querySelector("[role='tooltip']")).toBeNull();
      await act(async () => {
        container
          .querySelector<HTMLElement>('[data-testid="chart-body"]')!
          .click();
      });
      expect(onSelectForChat).toHaveBeenCalledWith({ focus: false });
    },
  );

  it("puts freshness in its own title-row track between the title and actions", async () => {
    await render();
    await report({ fetchedAt: FETCHED_AT, cache: "app-cache" });

    expect(clock()?.getAttribute("aria-label")).toBe(
      `sqlDashboard.fetchedAt(full:${FETCHED_AT}) · sqlDashboard.cacheApp`,
    );
    const options = container.querySelector(
      `[aria-label="sqlDashboard.panelOptions"]`,
    );
    const header = container.querySelector(".dashboard-panel-header")!;
    expect(header.children).toHaveLength(3);
    expect(header.children[0]!.textContent).toBe(panel.title);
    expect(header.children[1]!.contains(clock())).toBe(true);
    expect(header.children[2]!.contains(options)).toBe(true);
    expect(
      container.querySelector('[data-testid="chart-body"]')!.contains(clock()),
    ).toBe(false);
    expect(container.textContent).not.toContain("sqlDashboard.fetchedAt");
    expect(clock()?.textContent).toBe("Updated 5m ago");
  });

  it("offers a clock for an unknown fetch time and cache state rather than inventing either", async () => {
    await render();
    await report({ cache: "unknown" });

    expect(clock()?.getAttribute("aria-label")).toBe(
      "sqlDashboard.fetchTimeUnknown · sqlDashboard.cacheUnknown",
    );
  });

  it("removes the clock when the chart stops showing a result", async () => {
    await render();
    await report({ fetchedAt: FETCHED_AT, cache: "live" });
    expect(clock()).not.toBeNull();

    await report(null);
    expect(clock()).toBeNull();
  });

  it("keeps the same callback while the panel is unchanged, so the chart does not re-report", async () => {
    await render();
    await render();
    await render({ resolvedSql: "SELECT 2 AS value" });

    const callbacks = new Set(
      mocks.chartProps.map((props) => props.onFreshnessChange),
    );
    expect(callbacks.size).toBe(1);
  });

  it("never shows one panel's clock on a card reused for another panel or dashboard", async () => {
    await render();
    await report({ fetchedAt: FETCHED_AT, cache: "app-cache" });
    expect(clock()).not.toBeNull();

    await render({ panel: { ...panel, id: "sessions" } });
    expect(clock()).toBeNull();

    await report({ fetchedAt: FETCHED_AT, cache: "live" });
    expect(clock()).not.toBeNull();

    await render({ dashboardId: "dashboard-2" });
    expect(clock()).toBeNull();
  });

  it("ignores a late report for a panel the card no longer shows", async () => {
    await render();
    const staleReport =
      mocks.chartProps[mocks.chartProps.length - 1]!.onFreshnessChange!;
    await render({ panel: { ...panel, id: "sessions" } });

    await act(async () => {
      staleReport({ fetchedAt: FETCHED_AT, cache: "app-cache" });
    });

    expect(clock()).toBeNull();
  });

  it.each(["metric", "line", "bar", "table"] as const)(
    "retains the %s chart and the same three header tracks through each freshness transition",
    async (chartType) => {
      await render({ panel: { ...panel, chartType } });
      const chart = container.querySelector('[data-testid="chart-body"]');
      const header = container.querySelector(".dashboard-panel-header")!;
      const tracks = Array.from(header.children);
      const options = container.querySelector(
        '[aria-label="sqlDashboard.panelOptions"]',
      );

      for (const status of [
        undefined,
        "updating",
        "previous-filters-updating",
        "previous-filters",
        "refreshed",
        "stale",
      ] as const) {
        await report({ fetchedAt: FETCHED_AT, cache: "app-cache", status });

        expect(container.querySelector('[data-testid="chart-body"]')).toBe(
          chart,
        );
        expect(Array.from(header.children)).toEqual(tracks);
        expect(tracks[1]!.contains(clock())).toBe(true);
        expect(
          container.querySelector('[aria-label="sqlDashboard.panelOptions"]'),
        ).toBe(options);
      }

      await report(null);
      expect(clock()).toBeNull();
      expect(Array.from(header.children)).toEqual(tracks);
      expect(container.querySelector('[data-testid="chart-body"]')).toBe(chart);
    },
  );

  it.each(["account", "org", "sign-out", "session-loading"] as const)(
    "removes prior freshness on %s changes and ignores an old account's late report",
    async (change) => {
      await render();
      await report({ fetchedAt: FETCHED_AT, cache: "app-cache" });
      const staleReport =
        mocks.chartProps[mocks.chartProps.length - 1]!.onFreshnessChange!;
      expect(clock()).not.toBeNull();

      if (change === "account")
        mocks.session = { userId: "other-user", orgId: "test-org" };
      if (change === "org")
        mocks.session = { userId: "test-user", orgId: "other-org" };
      if (change === "sign-out") {
        mocks.session = null;
        mocks.sessionStatus = "unauthenticated";
      }
      if (change === "session-loading") mocks.sessionStatus = "loading";
      await render();
      expect(clock()).toBeNull();

      await act(async () =>
        staleReport({ fetchedAt: FETCHED_AT, cache: "app-cache" }),
      );

      expect(clock()).toBeNull();
    },
  );
});
