// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { RowBreakdownSheet } from "./RowBreakdownSheet";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@agent-native/core/client/hooks", () => ({
  deleteClientAppState: vi.fn(async (key: string) => state.delete(key)),
  setClientAppState: vi.fn(async (key: string, value: unknown) => {
    if (value === null) state.delete(key);
    else state.set(key, value);
  }),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@/lib/tab-id", () => ({ TAB_ID: "tab-a" }));
vi.mock("@/lib/sql-query", () => ({ useSqlQuery: () => ({}) }));
vi.mock("@/components/dashboard/SqlChart", () => ({
  formatCell: (value: unknown) => String(value),
  isNumericColumnFormat: (format: string) => format === "number",
}));
vi.mock("@/components/ui/sheet", () => {
  const Content = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return { Sheet: Content, SheetContent: Content, SheetTitle: Content };
});

let root: Root;
let container: HTMLDivElement;
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  state.clear();
});

it("publishes and clears the breakdown only for the browser tab that opened it", async () => {
  const otherTab = { dashboardId: "dashboard-b", panelId: "panel-b" };
  state.set("row-breakdown:tab-b", otherTab);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const row = { role: "Engineer", app: "Clips", people: 30 };
  const panel = {
    id: "panel-a",
    title: "People",
    chartType: "table" as const,
    source: "first-party" as const,
    width: 2,
    sql: "SELECT 1",
    config: {
      columns: [
        { key: "role" },
        { key: "app" },
        { key: "people", format: "number" as const },
      ],
    },
  };
  const props = {
    panel,
    dashboardId: "dashboard-a",
    breakdowns: [{ column: "app" }],
    filters: {},
    onSelectionChange: vi.fn(),
  };
  await act(async () => {
    root.render(
      <RowBreakdownSheet
        {...props}
        selection={{
          row,
          rows: [row],
          resultRows: [row],
          resultTruncated: false,
          openedAt: 1,
        }}
      />,
    );
  });
  // readAppStateForCurrentTab("row-breakdown") resolves this exact key.
  expect(state.get("row-breakdown:tab-a")).toEqual({
    dashboardId: "dashboard-a",
    panelId: "panel-a",
    panelTitle: "People",
    row: { role: "Engineer" },
    breakdownColumn: "app",
  });
  expect(state.has("row-breakdown")).toBe(false);
  expect(state.get("row-breakdown:tab-b")).toEqual(otherTab);

  await act(async () =>
    root.render(<RowBreakdownSheet {...props} selection={null} />),
  );
  expect(state.has("row-breakdown:tab-a")).toBe(false);
  expect(state.get("row-breakdown:tab-b")).toEqual(otherTab);
});
