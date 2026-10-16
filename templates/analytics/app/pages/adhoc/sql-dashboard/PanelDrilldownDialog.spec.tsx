// @vitest-environment happy-dom

import { act } from "react";
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  actionQuery: {} as Record<string, unknown>,
  sqlQueries: [] as Array<{ enabled: boolean; key: unknown; sql: string }>,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => mocks.actionQuery,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/lib/sql-query", () => ({
  useSqlQuery: (
    key: unknown,
    sql: string,
    _source: string,
    options: { enabled: boolean },
  ) => {
    mocks.sqlQueries.push({ enabled: options.enabled, key, sql });
    return {
      data: { rows: [{ record: "aggregate fallback" }] },
      isLoading: false,
      isFetching: false,
      error: null,
    };
  },
}));

vi.mock("@tabler/icons-react", () => ({
  IconDownload: () => null,
}));

vi.mock("@/components/ui/dialog", async () => {
  const React = await import("react");
  const wrapper =
    (tag: string) =>
    ({ children }: { children?: ReactNode }) =>
      React.createElement(tag, null, children);

  return {
    Dialog: ({ children, open }: { children?: ReactNode; open: boolean }) =>
      open ? React.createElement("div", { role: "dialog" }, children) : null,
    DialogContent: wrapper("section"),
    DialogHeader: wrapper("header"),
    DialogTitle: wrapper("h2"),
  };
});

vi.mock("@/components/ui/button", async () => {
  const React = await import("react");
  return {
    Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) =>
      React.createElement("button", props, children),
  };
});

vi.mock("@/components/ui/input", async () => {
  const React = await import("react");
  return {
    Input: (props: InputHTMLAttributes<HTMLInputElement>) =>
      React.createElement("input", props),
  };
});

vi.mock("@/components/ui/skeleton", async () => {
  const React = await import("react");
  return {
    Skeleton: (props: HTMLAttributes<HTMLDivElement>) =>
      React.createElement("div", props),
  };
});

vi.mock("@/components/ui/table", async () => {
  const React = await import("react");
  const element =
    (tag: string) =>
    ({ children }: { children?: ReactNode }) =>
      React.createElement(tag, null, children);
  return {
    Table: element("table"),
    TableBody: element("tbody"),
    TableCell: element("td"),
    TableHead: element("th"),
    TableHeader: element("thead"),
    TableRow: element("tr"),
  };
});

import type { ChartDatum } from "@/components/dashboard/SqlChart";

import { PanelDrilldownDialog } from "./PanelDrilldownDialog";
import type { SqlPanel } from "./types";

const PANEL: SqlPanel = {
  id: "signups-over-time",
  title: "Signups over time",
  sql: "SELECT day, count FROM signups",
  source: "first-party",
  chartType: "area",
  width: 1,
};

const DATUM: ChartDatum = {
  x: "2026-10-15",
  series: "clips",
  value: 2,
};

describe("PanelDrilldownDialog metadata lookup", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.sqlQueries.length = 0;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function render() {
    await act(async () => {
      root.render(
        <PanelDrilldownDialog panel={PANEL} datum={DATUM} onClose={vi.fn()} />,
      );
    });
  }

  it("shows lookup failure without enabling the aggregate fallback", async () => {
    mocks.actionQuery = {
      data: undefined,
      isError: true,
      isLoading: false,
      isSuccess: false,
    };

    await render();

    expect(container.textContent).toContain("sqlDashboard.drilldownLoadFailed");
    expect(container.textContent).not.toContain("aggregate fallback");
    expect(mocks.sqlQueries.map((query) => query.enabled)).toEqual([
      false,
      false,
    ]);
  });

  it("enables the aggregate fallback only for an explicit successful null", async () => {
    mocks.actionQuery = {
      data: { drilldown: null },
      isError: false,
      isLoading: false,
      isSuccess: true,
    };

    await render();

    expect(mocks.sqlQueries.map((query) => query.enabled)).toEqual([
      false,
      true,
    ]);
    expect(container.textContent).toContain("aggregate fallback");
    expect(container.textContent).toContain(
      "sqlDashboard.drilldownAggregateOnly",
    );
  });
});
