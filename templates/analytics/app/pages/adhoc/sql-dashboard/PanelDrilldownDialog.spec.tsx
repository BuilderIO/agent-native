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
  callAction: vi.fn(),
  drilldownQueryOptions: [] as Array<Record<string, unknown>>,
  sqlQueries: [] as Array<{
    enabled: boolean;
    key: unknown;
    sql: string;
    purpose?: string;
    reuseCompletedOnEnable?: boolean;
  }>,
  sqlError: null as unknown,
  sqlTruncated: false,
  sqlCache: null as Map<string, Record<string, unknown>[]> | null,
  sqlRows: [{ record: "aggregate fallback" }] as Record<string, unknown>[],
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: Record<string, unknown>) => {
    mocks.drilldownQueryOptions.push(options);
    return mocks.actionQuery;
  },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, string>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
  useFormatters: () => ({
    formatNumber: (value: number) => `localized:${value}`,
  }),
}));

vi.mock("@/lib/sql-query", () => ({
  useSqlQuery: (
    key: unknown,
    sql: string,
    _source: string,
    options: {
      enabled: boolean;
      purpose?: string;
      reuseCompletedOnEnable?: boolean;
    },
  ) => {
    mocks.sqlQueries.push({ ...options, key, sql });
    const cacheKey = JSON.stringify(key);
    const rows = mocks.sqlCache?.get(cacheKey) ?? mocks.sqlRows;
    if (options.enabled) mocks.sqlCache?.set(cacheKey, rows);
    return {
      data: { rows, truncated: mocks.sqlTruncated },
      isLoading: false,
      isFetching: false,
      error: mocks.sqlError,
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
    mocks.drilldownQueryOptions.length = 0;
    mocks.sqlError = null;
    mocks.sqlTruncated = false;
    mocks.sqlCache = null;
    mocks.callAction.mockReset();
    mocks.sqlRows = [{ record: "aggregate fallback" }];
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function render(
    panel = PANEL,
    datum: ChartDatum | null = DATUM,
    filters?: Record<string, string>,
  ) {
    await act(async () => {
      root.render(
        <PanelDrilldownDialog
          panel={panel}
          datum={datum}
          filters={filters}
          onClose={vi.fn()}
        />,
      );
    });
  }

  it("uses declared templates for the selected point and filters, with capped on-demand record fetches", async () => {
    const drilldown = {
      sql: "SELECT visitor FROM events WHERE day = '{{drillX}}' AND app = '{{drillSeries}}' AND email = '{{email}}' LIMIT 500",
    };
    const panel: SqlPanel = {
      ...PANEL,
      source: "bigquery",
      config: { drilldown },
    };
    mocks.actionQuery = {
      data: { drilldown },
      isSuccess: true,
      isError: false,
      isLoading: false,
    };
    await render(
      panel,
      { ...DATUM, series: "o'brien\\app" },
      { email: "person@example.com" },
    );
    expect(mocks.drilldownQueryOptions[0].queryKey).toEqual([
      "panel-drilldown-template",
      panel.id,
      "bigquery",
      panel.sql,
      drilldown,
    ]);
    const queryFn = mocks.drilldownQueryOptions[0].queryFn as (context: {
      signal: AbortSignal;
    }) => Promise<unknown>;
    const signal = new AbortController().signal;
    await queryFn({ signal });
    expect(mocks.callAction).toHaveBeenCalledWith(
      "get-panel-drilldown",
      {
        panelId: panel.id,
        panelSource: "bigquery",
        panelSql: panel.sql,
        drilldown,
      },
      { method: "POST", signal },
    );
    expect(mocks.sqlQueries[0]).toMatchObject({
      enabled: true,
      purpose: "panel-drilldown",
      reuseCompletedOnEnable: true,
      sql: "SELECT visitor FROM events WHERE day = '2026-10-15' AND app = 'o\\'brien\\\\app' AND email = 'person@example.com' LIMIT 500",
    });
    expect(mocks.sqlQueries[1].enabled).toBe(false);
    mocks.sqlQueries.length = 0;
    mocks.drilldownQueryOptions.length = 0;
    await render(panel, null);
    expect(mocks.drilldownQueryOptions[0].enabled).toBe(false);
    expect(mocks.sqlQueries.every((query) => !query.enabled)).toBe(true);
  });

  it("keeps identical record SQL from different sources out of each other's cache", async () => {
    const drilldown = { sql: "SELECT record FROM events LIMIT 500" };
    mocks.actionQuery = { data: { drilldown }, isSuccess: true };
    mocks.sqlCache = new Map();
    mocks.sqlRows = [{ record: "BigQuery record" }];
    await render({ ...PANEL, source: "bigquery", config: { drilldown } });
    expect(container.textContent).toContain("BigQuery record");

    mocks.sqlRows = [{ record: "First-party record" }];
    await render({ ...PANEL, source: "first-party", config: { drilldown } });
    expect(container.textContent).toContain("First-party record");
    expect(container.textContent).not.toContain("BigQuery record");
    expect(mocks.sqlCache.size).toBe(2);
  });

  it("labels transport-truncated records and CSV as incomplete when their total is unknown", async () => {
    mocks.actionQuery = {
      data: { drilldown: { sql: "SELECT record FROM events LIMIT 500" } },
      isSuccess: true,
    };
    mocks.sqlRows = [{ record: "first" }, { record: "second" }];
    mocks.sqlTruncated = true;
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:drilldown-csv");
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    await render();
    expect(container.textContent).toContain(
      'sqlDashboard.drilldownShowingLoaded {"shown":"localized:2","loaded":"localized:2"}',
    );
    expect(container.textContent).toContain(
      'sqlDashboard.drilldownCsvTruncatedUnknownTotal {"loaded":"localized:2","exported":"localized:2"}',
    );
    expect(container.textContent).not.toContain(
      "sqlDashboard.drilldownCountMismatch",
    );
    expect(container.textContent).not.toContain(
      "sqlDashboard.drilldownShowing {",
    );
    const downloadButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) =>
      button.textContent?.includes("sqlDashboard.drilldownDownloadCsv"),
    );
    await act(async () => downloadButton!.click());
    const csv = await (createObjectURL.mock.calls[0]?.[0] as Blob).text();
    expect(csv.split("\n").at(-1)).toContain(
      "sqlDashboard.drilldownCsvTruncatedUnknownTotal",
    );
    expect(csv).not.toContain("total");
    createObjectURL.mockRestore();
    click.mockRestore();
  });

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

  it("keeps total_matching visible in aggregate fallback results", async () => {
    mocks.actionQuery = {
      data: { drilldown: null },
      isError: false,
      isLoading: false,
      isSuccess: true,
    };
    mocks.sqlRows = [{ total_matching: 1, signups: 42 }];

    await render();

    expect(
      Array.from(container.querySelectorAll("th")).map((header) =>
        header.textContent?.trim(),
      ),
    ).toContain("total_matching");
  });

  it("labels a capped CSV export as incomplete", async () => {
    mocks.actionQuery = {
      data: {
        drilldown: { sql: "SELECT record, total_matching FROM signups" },
      },
      isError: false,
      isLoading: false,
      isSuccess: true,
    };
    mocks.sqlRows = [
      { record: "first", total_matching: 501 },
      { record: "second", total_matching: 501 },
    ];
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:drilldown-csv");
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    await render();

    expect(container.textContent).toContain(
      '"shown":"localized:2","total":"localized:501"',
    );
    expect(container.textContent).toContain(
      "sqlDashboard.drilldownCsvTruncated",
    );
    const downloadButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) =>
      button.textContent?.includes("sqlDashboard.drilldownDownloadCsv"),
    );
    expect(downloadButton).toBeDefined();
    await act(async () => downloadButton!.click());

    const csv = await (createObjectURL.mock.calls[0]?.[0] as Blob).text();
    const csvRows = csv.split("\n");
    expect(csvRows[0]).toBe("record");
    expect(csvRows[csvRows.length - 1]).toContain(
      "sqlDashboard.drilldownCsvTruncated",
    );
    expect(click).toHaveBeenCalledTimes(1);
    createObjectURL.mockRestore();
    click.mockRestore();
  });

  it("disables CSV export when a refetch fails with cached rows", async () => {
    mocks.actionQuery = {
      data: {
        drilldown: { sql: "SELECT record FROM signups" },
      },
      isError: false,
      isLoading: false,
      isSuccess: true,
    };
    mocks.sqlRows = [{ record: "cached result" }];
    mocks.sqlError = new Error("query failed");

    await render();

    expect(container.textContent).toContain("sqlDashboard.drilldownLoadFailed");
    const downloadButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) =>
      button.textContent?.includes("sqlDashboard.drilldownDownloadCsv"),
    );
    expect(downloadButton?.disabled).toBe(true);
  });

  it("posts long panel SQL in the request body", async () => {
    const sql = `SELECT ${"column_name, ".repeat(2_140)} value`;
    const panel = { ...PANEL, sql };
    const signal = new AbortController().signal;
    mocks.actionQuery = {
      data: { drilldown: null },
      isError: false,
      isLoading: false,
      isSuccess: true,
    };

    await render(panel);

    const queryFn = mocks.drilldownQueryOptions[0]?.queryFn as
      | ((context: { signal: AbortSignal }) => Promise<unknown>)
      | undefined;
    expect(queryFn).toBeDefined();
    await queryFn!({ signal });

    expect(sql.length).toBeGreaterThan(27_000);
    expect(mocks.callAction).toHaveBeenCalledWith(
      "get-panel-drilldown",
      { panelId: panel.id, panelSource: panel.source, panelSql: sql },
      { method: "POST", signal },
    );
  });
});
