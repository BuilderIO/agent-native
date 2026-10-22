// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentChatDataChartLayout } from "../../../agentkit/react/data-chart-layout.js";
import { createToolkitI18nCatalog } from "../../../i18n.js";
import type {
  DataWidgetAction,
  DataWidgetChartAction,
  DataWidgetDisplayAction,
} from "./data-widget-types.js";
import { DataChartWidget } from "./DataChartWidget.js";

const mocks = vi.hoisted(() => ({
  writeClipboardText: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@agent-native/toolkit/clipboard", () => ({
  writeClipboardText: mocks.writeClipboardText,
}));

vi.mock("../../../../hooks/use-toast.js", () => ({ toast: mocks.toast }));

vi.mock("./DataChartRenderer.js", () => ({
  DataChartRenderer: ({
    chart,
    layout,
  }: {
    chart: {
      contentHeight?: number;
      contentPadding?: number;
      labelFontFamily?: string;
      labelFontSize?: number;
    };
    layout?: AgentChatDataChartLayout;
  }) => (
    <div
      data-testid="chart-surface"
      data-content-height={chart.contentHeight}
      data-content-padding={chart.contentPadding}
      data-label-font-family={chart.labelFontFamily}
      data-label-font-size={chart.labelFontSize}
      data-layout-label-font-family={layout?.labelFontFamily}
      data-layout-label-font-size={layout?.labelFontSize}
    />
  ),
}));

const toolkitI18nCatalog = createToolkitI18nCatalog({ messages: {} });
const initialBasePath = process.env.VITE_APP_BASE_PATH;
const roots: Root[] = [];

async function renderWidget(
  chartActions?: DataWidgetChartAction[],
  displayActions: DataWidgetDisplayAction[] = [
    {
      id: "details",
      type: "link",
      label: "Open details",
      href: "/reports/1/details",
    },
    {
      id: "query",
      type: "copy",
      label: "Copy query",
      text: "select count(*)",
    },
    {
      id: "unsafe",
      type: "link",
      label: "Unsafe",
      href: "javascript:alert(1)",
    },
  ],
  sampled = false,
  chartDataCount = 1,
  truncated = false,
  layout?: AgentChatDataChartLayout,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);

  await act(async () => {
    root.render(
      <AgentNativeI18nProvider
        catalog={toolkitI18nCatalog}
        persistPreference={false}
      >
        <DataChartWidget
          chart={{
            type: "bar",
            title: "Responses by day",
            xKey: "day",
            series: [{ key: "count", label: "Responses" }],
            data: Array.from({ length: chartDataCount }, (_, index) => ({
              day: `Day ${index}`,
              count: index,
            })),
            sampled,
            truncated,
            actions: chartActions,
          }}
          display={{
            primaryAction: {
              label: "Open report",
              href: "/reports/1?tab=chart",
            },
            sources: [
              {
                id: "warehouse",
                label: "Warehouse",
                href: "/sources/warehouse",
              },
              { id: "local", label: "Local data" },
            ],
            actions: displayActions,
          }}
          layout={layout}
        />
      </AgentNativeI18nProvider>,
    );
  });

  return container;
}

async function openActionsMenu(container: HTMLElement) {
  const trigger = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Chart actions"]',
  );
  expect(trigger).not.toBeNull();

  await act(async () => {
    trigger?.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        pointerType: "mouse",
      }),
    );
    await Promise.resolve();
  });

  return document.querySelector<HTMLElement>("[role=menu]");
}

describe("DataChartWidget display contract", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    process.env.VITE_APP_BASE_PATH = "/mounted";
    window.history.replaceState({}, "", "/chat");
    mocks.writeClipboardText.mockResolvedValue(true);
  });

  afterEach(() => {
    for (const root of roots.splice(0)) {
      act(() => root.unmount());
    }
    document.body.innerHTML = "";
    window.history.replaceState({}, "", "/");
    process.env.VITE_APP_BASE_PATH = initialBasePath;
    mocks.writeClipboardText.mockReset();
    mocks.toast.mockReset();
    vi.unstubAllGlobals();
  });

  it("renders source chips and navigates safe chart links", async () => {
    const container = await renderWidget();
    const primary = Array.from(container.querySelectorAll("a")).find((link) =>
      link.textContent?.includes("Open report"),
    );
    const source = Array.from(container.querySelectorAll("a")).find((link) =>
      link.textContent?.includes("Warehouse"),
    );

    expect(primary?.getAttribute("href")).toBe("/mounted/reports/1?tab=chart");
    expect(source?.getAttribute("href")).toBe("/mounted/sources/warehouse");
    expect(container.textContent).toContain("Local data");

    await act(async () => {
      primary?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
      );
    });

    expect(window.location.pathname).toBe("/mounted/reports/1");
    expect(window.location.search).toBe("?tab=chart");
  });

  it("opts into responsive chart sizing and quiet controls", async () => {
    const container = await renderWidget(
      [
        {
          id: "explore",
          label: "Explore",
          href: "/explore",
          icon: "explore",
          presentation: "icon",
        },
      ],
      undefined,
      false,
      1,
      false,
      {
        maxWidth: 720,
        labelFontFamily: "IBM Plex Sans",
        labelFontSize: 14,
        titleFontFamily: "IBM Plex Sans",
        titleFontSize: 14,
        titleFontWeight: 400,
        titleLineHeight: 20,
        titleTone: "muted",
        actionsVariant: "quiet",
      },
    );
    const card = container.querySelector<HTMLElement>(".my-4");
    const title = card?.querySelector<HTMLElement>(".border-b .min-w-0");
    const chart = container.querySelector<HTMLElement>(
      '[data-testid="chart-surface"]',
    );
    const primary = Array.from(container.querySelectorAll("a")).find((link) =>
      link.textContent?.includes("Open report"),
    );
    const explore = container.querySelector<HTMLAnchorElement>(
      'a[aria-label="Explore"]',
    );

    expect(card?.style.width).toBe("100%");
    expect(card?.style.maxWidth).toBe("720px");
    expect(card?.style.marginInline).toBe("auto");
    expect(title?.style.fontFamily).toBe("IBM Plex Sans");
    expect(title?.style.fontSize).toBe("14px");
    expect(title?.style.fontWeight).toBe("400");
    expect(title?.style.lineHeight).toBe("20px");
    expect(title?.classList.contains("text-muted-foreground")).toBe(true);
    expect(chart?.dataset.layoutLabelFontFamily).toBe("IBM Plex Sans");
    expect(chart?.dataset.layoutLabelFontSize).toBe("14");
    expect(primary?.classList.contains("border")).toBe(false);
    expect(explore?.classList.contains("border")).toBe(false);
    expect(explore?.classList.contains("size-7")).toBe(true);
    expect(container.querySelector('[aria-label="Chart actions"]')).toBeNull();
  });

  it("announces incomplete chart data and stays quiet for complete data", async () => {
    const cappedContainer = await renderWidget(
      undefined,
      undefined,
      false,
      201,
    );
    const cappedDisclosure = cappedContainer.querySelector('[role="status"]');

    expect(cappedDisclosure?.textContent).toBe(
      "This chart shows only some of the available rows.",
    );

    const sampledContainer = await renderWidget(undefined, undefined, true);
    expect(sampledContainer.querySelector('[role="status"]')?.textContent).toBe(
      "This chart shows only some of the available rows.",
    );

    const sampledAndCappedContainer = await renderWidget(
      undefined,
      undefined,
      true,
      201,
    );
    expect(
      sampledAndCappedContainer.querySelector('[role="status"]')?.textContent,
    ).toBe("This chart shows only some of the available rows.");

    const clampedContainer = await renderWidget(
      undefined,
      undefined,
      true,
      200,
      true,
    );
    expect(clampedContainer.querySelector('[role="status"]')?.textContent).toBe(
      "This chart shows only some of the available rows.",
    );

    const completeContainer = await renderWidget();
    expect(completeContainer.querySelector('[role="status"]')).toBeNull();
  });

  it("opens overflow links and copies the requested text", async () => {
    const container = await renderWidget();
    const menu = await openActionsMenu(container);
    expect(menu).not.toBeNull();
    expect(menu?.textContent).toContain("Open details");
    expect(menu?.textContent).toContain("Copy query");
    expect(menu?.textContent).not.toContain("Unsafe");

    const details = Array.from(menu?.querySelectorAll("a") ?? []).find((link) =>
      link.textContent?.includes("Open details"),
    );
    expect(details?.getAttribute("href")).toBe("/mounted/reports/1/details");

    await act(async () => {
      details?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
      );
    });
    expect(window.location.pathname).toBe("/mounted/reports/1/details");

    const secondContainer = await renderWidget();
    const secondMenu = await openActionsMenu(secondContainer);
    const copy = Array.from(
      secondMenu?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [],
    ).find((item) => item.textContent?.includes("Copy query"));

    await act(async () => {
      copy?.click();
      await Promise.resolve();
    });

    expect(mocks.writeClipboardText).toHaveBeenCalledWith("select count(*)");
    expect(mocks.toast).toHaveBeenCalledWith({ title: "Copied" });
  });

  it("renders actions attached to the chart payload", async () => {
    const container = await renderWidget([
      {
        label: "Explore results",
        href: "/reports/1/explore",
        icon: "explore",
      },
      {
        label: "Download image",
        href: "/reports/1/image",
        icon: "camera",
      },
      {
        label: "Save to notebook",
        href: "/notebooks/new",
        icon: "notebook",
      },
    ]);
    const menu = await openActionsMenu(container);

    expect(menu?.textContent).toContain("Explore results");
    expect(menu?.textContent).toContain("Download image");
    expect(menu?.textContent).toContain("Save to notebook");
    expect(
      menu?.querySelector('a[href="/mounted/reports/1/explore"] svg'),
    ).not.toBeNull();
    expect(
      menu?.querySelector('a[href="/mounted/reports/1/image"] svg'),
    ).not.toBeNull();
    expect(
      menu?.querySelector('a[href="/mounted/notebooks/new"] svg'),
    ).not.toBeNull();
  });

  it("renders an icon action directly with an accessible label", async () => {
    const container = await renderWidget([
      {
        label: "Download image",
        href: "/reports/1/image",
        icon: "camera",
        presentation: "icon",
      },
    ]);
    const directAction = container.querySelector<HTMLAnchorElement>(
      'a[aria-label="Download image"]',
    );
    const menu = await openActionsMenu(container);

    expect(directAction?.getAttribute("href")).toBe("/mounted/reports/1/image");
    expect(directAction?.getAttribute("title")).toBe("Download image");
    expect(directAction?.querySelector("svg")).not.toBeNull();
    expect(menu?.textContent).not.toContain("Download image");
    expect(menu?.textContent).toContain("Open details");
    expect(menu?.textContent).toContain("Copy query");
  });

  it("hides the overflow control when all actions are direct icons", async () => {
    const container = await renderWidget(
      [],
      [
        {
          id: "direct-download",
          type: "link",
          label: "Download image",
          href: "/reports/1/image",
          icon: "camera",
          presentation: "icon",
        },
      ],
    );

    expect(
      container.querySelector('a[aria-label="Download image"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="Chart actions"]'),
    ).toBeNull();
  });

  it("keeps chart actions as links when payload metadata includes a type", async () => {
    const container = await renderWidget([
      {
        type: "copy",
        label: "Explore results",
        href: "/reports/1/explore",
      } as DataWidgetAction,
    ]);
    const menu = await openActionsMenu(container);

    expect(
      menu?.querySelector('a[href="/mounted/reports/1/explore"]'),
    ).not.toBeNull();
  });

  it("does not render executable primary-action URLs", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          catalog={toolkitI18nCatalog}
          persistPreference={false}
        >
          <DataChartWidget
            chart={{
              type: "bar",
              xKey: "day",
              series: [{ key: "count", label: "Count" }],
              data: [],
            }}
            display={{
              primaryAction: { label: "Unsafe", href: "javascript:alert(1)" },
            }}
          />
        </AgentNativeI18nProvider>,
      );
    });

    expect(container.querySelector("a")).toBeNull();
  });

  it("uses the chart-selected content height without adding body padding", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          catalog={toolkitI18nCatalog}
          persistPreference={false}
        >
          <DataChartWidget
            chart={{
              type: "bar",
              xKey: "day",
              contentHeight: 400,
              contentPadding: 16,
              labelFontFamily: "sans",
              labelFontSize: 14,
              series: [{ key: "count", label: "Count" }],
              data: [],
            }}
          />
        </AgentNativeI18nProvider>,
      );
    });

    const frame = container.querySelector(".my-4");
    const header = frame?.querySelector(".h-12");
    const chartSurface = frame?.querySelector<HTMLElement>(
      "[data-testid=chart-surface]",
    );
    expect(frame?.className).toContain("rounded-[3px]");
    expect(header?.className).toContain("border-b");
    expect(chartSurface?.dataset.contentHeight).toBe("400");
    expect(chartSurface?.dataset.contentPadding).toBe("16");
    expect(chartSurface?.dataset.labelFontFamily).toBe("sans");
    expect(chartSurface?.dataset.labelFontSize).toBe("14");
    expect(frame?.querySelector(".p-3")).toBeNull();
  });
});
