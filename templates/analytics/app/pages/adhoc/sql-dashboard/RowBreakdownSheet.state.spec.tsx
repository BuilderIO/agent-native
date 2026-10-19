// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { readAppStateForCurrentTab } from "../../../../../../packages/core/src/application-state/script-helpers";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../../../../../../packages/core/src/application-state/store", () => ({
  appStateGet: async (_owner: string, key: string) => state.get(key) ?? null,
}));
vi.mock("../../../../../../packages/core/src/server/request-context", () => ({
  getRequestUserEmail: () => "viewer@example.test",
  getRequestRunContext: () => ({ browserTabId: "tab-a" }),
  getAmbientUserEmail: () => null,
  getRequestAuthCapability: () => null,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  getBrowserTabId: () => "tab-a",
  deleteClientAppState: vi.fn(async (key: string) => state.delete(key)),
  setClientAppState: vi.fn(async (key: string, value: unknown) => {
    if (value === null) state.delete(key);
    else state.set(key, value);
  }),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@/lib/sql-query", () => ({ useSqlQuery: () => ({}) }));
vi.mock("@/components/dashboard/SqlChart", () => ({
  formatCell: (value: unknown) => String(value),
  isNumericColumnFormat: (format: string) => format === "number",
}));
vi.mock("@/components/ui/sheet", () => {
  const Content = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return { Sheet: Content, SheetContent: Content, SheetTitle: Content };
});

let RowBreakdownSheet: typeof import("./RowBreakdownSheet").RowBreakdownSheet;
let root: Root | null;
let container: HTMLDivElement;
const otherTab = { dashboardId: "dashboard-b", panelId: "panel-b" };
beforeEach(async () => {
  vi.resetModules();
  ({ RowBreakdownSheet } = await import("./RowBreakdownSheet"));
  state.set("row-breakdown:tab-b", otherTab);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  container.remove();
  state.clear();
});

const row = { role: "Engineer", app: "Clips", people: 30 };
const props = {
  panel: {
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
  },
  dashboardId: "dashboard-a",
  breakdowns: [{ column: "app" }],
  filters: {},
  onSelectionChange: vi.fn(),
};
async function openSheet() {
  await act(async () => {
    root!.render(
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
}

it("makes the open breakdown available to the real current-tab reader and clears it on close", async () => {
  await openSheet();
  expect(await readAppStateForCurrentTab("row-breakdown")).toEqual({
    dashboardId: "dashboard-a",
    panelId: "panel-a",
    panelTitle: "People",
    row: { role: "Engineer" },
    breakdownColumn: "app",
  });
  expect(state.has("row-breakdown")).toBe(false);
  expect(state.get("row-breakdown:tab-b")).toEqual(otherTab);

  await act(async () =>
    root!.render(<RowBreakdownSheet {...props} selection={null} />),
  );
  expect(await readAppStateForCurrentTab("row-breakdown")).toBeNull();
  expect(state.get("row-breakdown:tab-b")).toEqual(otherTab);
});

it("clears an open sheet on unmount without clearing another tab", async () => {
  await openSheet();
  await act(async () => root!.unmount());
  root = null;
  expect(await readAppStateForCurrentTab("row-breakdown")).toBeNull();
  expect(state.get("row-breakdown:tab-b")).toEqual(otherTab);
});

it("clears a breakdown left by reload only in the current tab", async () => {
  state.set("row-breakdown:tab-a", { dashboardId: "previous-dashboard" });
  await act(async () =>
    root!.render(<RowBreakdownSheet {...props} selection={null} />),
  );
  expect(await readAppStateForCurrentTab("row-breakdown")).toBeNull();
  expect(state.get("row-breakdown:tab-b")).toEqual(otherTab);
});
