// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { ExplorerChart } from "./ExplorerChart";

describe("ExplorerChart incomplete results", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const config = {
    name: "test",
    events: [{ event: "signup", filters: [], groupBy: [] }],
    chartType: "metric" as const,
    dateRange: "30d" as const,
  };

  it("shows partial data warnings even when the result has no rows", async () => {
    await act(async () => {
      root.render(
        <ExplorerChart
          config={config}
          result={{ rows: [], partial: true }}
          isLoading={false}
          sql="SELECT 1"
        />,
      );
    });

    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "explorer.incompleteResultsWarning",
    );
    expect(container.textContent).toContain("explorer.noDataReturned");
  });

  it("shows a warning with truncated chart data", async () => {
    await act(async () => {
      root.render(
        <ExplorerChart
          config={config}
          result={{ rows: [{ count: 2 }], truncated: true }}
          isLoading={false}
          sql="SELECT 1"
        />,
      );
    });

    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "explorer.incompleteResultsWarning",
    );
    expect(container.textContent).toContain("2");
  });
});
