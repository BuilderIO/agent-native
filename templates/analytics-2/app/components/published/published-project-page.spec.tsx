// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import messages from "@/i18n/en-US";
import { cellOutputSchema, projectDocumentSchema } from "@/lib/model/contracts";
import { resolveRoute } from "@/routes/routing/registry";

import {
  appDocumentSchema,
  applyAppPatches,
  emptyAppLayout,
} from "../../../shared/app-layout";
import { revisionSchema } from "../../../shared/notebook-snapshot-contract";
import { defaultPivotConfig } from "../../../shared/pivot-config";
import { projectDocumentWithLayoutSchema } from "../../../shared/project-document";
import { appViewerCellIds } from "../../../shared/published-app-projection";
import { defaultTableConfig } from "../../../shared/table-visualization-config";

import publishedStyles from "./app-layout-snapshot.css?raw";
import notebookStyles from "@/components/notebook/notebook.css?raw";
import globalStyles from "@/global.css?raw";

vi.mock("@tanstack/react-query", () => ({
  useQueries: ({ queries }: { queries: Array<{ queryKey: unknown[] }> }) =>
    queries.map(({ queryKey }) => ({
      data: query.pages.get(queryKey.at(-1) as string),
    })),
  useQueryClient: () => ({ invalidateQueries: vi.fn(async () => {}) }),
}));

vi.mock("@/components/sharing/PublishedAppSharePopover", () => ({
  PublishedAppSharePopover: () => <button type="button">Share</button>,
}));

const timestamp = "2026-11-15T00:00:00.000Z";
const baseContents = {
  label: null,
  hidden: false,
  gridX: null,
  gridY: null,
  gridWidth: null,
  gridHeight: null,
};
const project = {
  project: projectDocumentSchema.parse({
    id: "prj_1",
    ownerEmail: "reader@example.invalid",
    title: "Revenue overview",
    description: "Monthly revenue",
    language: "python",
    statusId: null,
    favorited: false,
    trashedAt: null,
    archivedAt: null,
    lastOpenedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    workingVersionId: "ver_working",
    publishedVersionId: "ver_published",
    collectionIds: [],
    cells: [
      {
        id: "c1",
        contents: {
          ...baseContents,
          id: "c1",
          order: "a1",
          kind: "text",
          label: "Revenue",
          text: "How the business is trending.",
        },
      },
      {
        id: "c2",
        contents: {
          ...baseContents,
          id: "c2",
          order: "a2",
          kind: "display-table",
          label: "Orders",
          dataframe: "df_orders",
          columns: [],
        },
      },
      {
        id: "c3",
        contents: {
          ...baseContents,
          id: "c3",
          order: "a3",
          kind: "chart",
          label: "Orders chart",
          description: "Orders by region",
          dataframe: "df_orders",
          chartSpec: {
            mark: "bar",
            xField: "region",
            yField: "orders",
            seriesField: null,
            title: null,
          },
        },
      },
    ].map((cell) => ({
      ...cell,
      projectId: "prj_1",
      versionId: "ver_published",
      createdAt: timestamp,
      updatedAt: timestamp,
    })),
  }),
  outputs: {
    c3: {
      cellId: "c3",
      status: "complete",
      ranAt: timestamp,
      output: cellOutputSchema.parse({
        type: "chart",
        columns: ["region", "orders"],
        rows: [["EMEA", 42]],
      }),
    },
    c2: {
      cellId: "c2",
      status: "complete",
      ranAt: timestamp,
      output: cellOutputSchema.parse({
        type: "table",
        columns: [
          { name: "region", type: "string" },
          { name: "orders", type: "number" },
        ],
        rows: Array.from({ length: 51 }, () => ["EMEA", 42]),
        rowCount: 51,
        totalRows: "1200",
        truncated: true,
      }),
    },
  },
  queryStates: {},
};

const query = vi.hoisted(() => ({
  useActionQuery: vi.fn(),
  callAction: vi.fn(),
  refetch: vi.fn(async () => ({ data: undefined as unknown })),
  pages: new Map<string, unknown>(),
}));
vi.mock("@agent-native/core/client/hooks", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/client/hooks")>();
  return {
    ...actual,
    useActionQuery: query.useActionQuery,
    callAction: query.callAction,
  };
});
const { PublishedProjectPage, default: PublishedProjectRoutePage } =
  await import("./PublishedProjectPage");

let notebookStyle: HTMLStyleElement;

function sessionFixture(
  projection: Pick<typeof project, "project"> & { outputs: object },
  overrides = {},
) {
  return {
    releaseId: "ver_published",
    sessionId: "session-1",
    inputRevision: "0",
    projection: { ...projection, canViewSource: false },
    effectiveValues: {},
    inputChoices: {},
    overrides: {},
    baselineManifestId: "manifest-1",
    defaultCacheGeneration: "0",
    refreshedAt: "2026-11-15T00:00:00Z",
    ageStatus: "fresh",
    sessionHref: "/app/prj_1/ver_published/session-1",
    caps: { refreshDefault: true, saveView: true },
    cursor: "0",
    state: "ready",
    runId: null,
    staleAfter: { kind: "workspace-default" },
    ...overrides,
  };
}

function showProjection(
  projection: Pick<typeof project, "project"> & { outputs: object },
  overrides?: object,
) {
  const data = sessionFixture(projection, overrides);
  query.useActionQuery.mockReturnValue({
    data,
    isPending: false,
    error: null,
    refetch: query.refetch,
  });
  query.refetch.mockResolvedValue({ data });
}

beforeEach(() => {
  notebookStyle = document.createElement("style");
  notebookStyle.textContent = notebookStyles + publishedStyles + globalStyles;
  query.callAction.mockReset();
  query.useActionQuery.mockReset();
  query.refetch.mockReset();
  query.pages.clear();
  document.head.append(notebookStyle);
});

afterEach(() => notebookStyle.remove());

it("includes only explicitly bound hidden Table and Pivot producers in the app-only projection", () => {
  const projected = projectDocumentSchema.parse({
    ...project.project,
    cells: [
      ...[
        { id: "table-source", resultVariable: "df_orders" },
        { id: "pivot-source", resultVariable: "df_regions" },
        { id: "private-source", resultVariable: "df_orders" },
      ].map(({ id, resultVariable }, index) => ({
        ...project.project.cells[0],
        id,
        contents: {
          ...baseContents,
          id,
          order: `a${index + 1}`,
          hidden: true,
          kind: "sql",
          source: "SELECT 1",
          dataConnectionId: null,
          databaseSchema: null,
          resultVariable,
          outputResult: true,
        },
      })),
      {
        ...project.project.cells[0],
        id: "configured-table",
        contents: {
          ...baseContents,
          id: "configured-table",
          order: "a4",
          kind: "display-table",
          dataframe: "df_orders",
          columns: [],
          tableConfig: {
            ...defaultTableConfig,
            source: { cellId: "table-source", exportId: "result" },
          },
        },
      },
      {
        ...project.project.cells[0],
        id: "configured-pivot",
        contents: {
          ...baseContents,
          id: "configured-pivot",
          order: "a5",
          kind: "pivot",
          dataframe: "df_regions",
          rows: [],
          columns: [],
          values: [],
          pivotConfig: {
            ...defaultPivotConfig,
            source: { cellId: "pivot-source", exportId: "result" },
          },
        },
      },
    ],
  });
  expect(appViewerCellIds(projected)).toEqual(
    new Set([
      "configured-table",
      "configured-pivot",
      "table-source",
      "pivot-source",
    ]),
  );
});

it.each(["Details", "details-id", "details-1"])(
  "cold viewer opens release bookmark %s with its independent geometry and label",
  async (bookmark) => {
    const layout = applyAppPatches(
      emptyAppLayout(revisionSchema.parse("0")),
      [
        { type: "initialize" },
        { type: "tab-add", tabId: "details-id", name: "Details" },
        {
          type: "place",
          tabId: "details-id",
          elementId: "details-chart",
          cellId: "c3",
          destination: {
            rowId: "details-row",
            columnId: "details-column",
            left: 45,
            right: 120,
            afterRowId: null,
          },
        },
        {
          type: "resize",
          tabId: "details-id",
          elementId: "details-chart",
          heightPx: 320,
        },
        {
          type: "display",
          tabId: "details-id",
          elementId: "details-chart",
          display: "output",
          showLabel: false,
        },
      ],
      project.project.cells,
    );
    const released = {
      ...project,
      project: {
        ...project.project,
        appLayout: appDocumentSchema.parse(JSON.parse(JSON.stringify(layout))),
      },
    };
    showProjection(released, {
      projection: {
        ...released,
        canViewSource: false,
        tabSlugs: [
          ["tab-1", "tab-1"],
          ["details-id", "details-1"],
        ],
      },
    });

    const path = `/app/prj_1/ver_published?tab=${bookmark}&keep=1`;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    function QueryString() {
      return <output>{useLocation().search}</output>;
    }
    try {
      await act(async () =>
        root.render(
          <MemoryRouter initialEntries={[path]}>
            <PublishedProjectRoutePage
              route={resolveRoute(path, { authenticated: true })}
            />
            <QueryString />
          </MemoryRouter>,
        ),
      );
      const chart = container.querySelector<HTMLElement>(
        '[data-app-element="details-chart"]',
      );
      expect(chart?.getAttribute("data-app-interval")).toBe("45:120");
      expect(chart?.style.minHeight).toBe("320px");
      expect(chart?.querySelector("h2")).toBeNull();
      expect(container.textContent).not.toContain(
        "How the business is trending.",
      );
      expect(
        container.querySelector('[role="tab"][aria-selected="true"]')
          ?.textContent,
      ).toBe("Details");
      expect(query.useActionQuery).toHaveBeenCalledWith(
        "open-published-app-session",
        expect.objectContaining({
          projectId: "prj_1",
          version: "ver_published",
        }),
        expect.anything(),
      );
      const [first, details] =
        container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
      if (!first || !details) throw new Error("Published tabs are missing");
      await act(async () =>
        first.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })),
      );
      expect(container.querySelector("output")?.textContent).toBe("?keep=1");
      await act(async () =>
        details.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })),
      );
      expect(container.querySelector("output")?.textContent).toBe(
        "?keep=1&tab=details-1",
      );
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  },
);

it.each([
  { rows: [["EMEA", 42]], footer: "1 row" },
  {
    rows: [
      ["EMEA", 42],
      ["APAC", 84],
    ],
    footer: "2 rows",
  },
])(
  "renders a published chart tile's tabular result with the notebook result grid and $footer",
  async ({ rows, footer }) => {
    const release = projectDocumentSchema.parse({
      ...project.project,
      cells: [project.project.cells[2]],
    });
    const layout = appDocumentSchema.parse({
      ...emptyAppLayout(revisionSchema.parse("0")),
      initialized: true,
      tabs: [
        {
          tabId: "overview",
          name: "Overview",
          rows: [
            {
              rowId: "orders-row",
              columns: [
                {
                  columnId: "orders-column",
                  left: 0,
                  right: 120,
                  elements: [
                    {
                      elementId: "orders-output",
                      cellId: "c3",
                      heightPx: 220,
                      heightMode: "content",
                      display: "output",
                      showLabel: false,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const projectWithLayout = { ...release, appLayout: layout };
    showProjection({
      project: projectWithLayout,
      outputs: {
        c3: {
          ...project.outputs.c3,
          output: cellOutputSchema.parse({
            ...project.outputs.c2.output,
            rows,
            rowCount: rows.length,
            totalRows: String(rows.length),
            truncated: false,
          }),
        },
      },
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          <AgentNativeI18nProvider
            catalog={{ messages }}
            persistPreference={false}
          >
            <PublishedProjectPage
              route={resolveRoute("/app/prj_1/ver_published")}
            />
          </AgentNativeI18nProvider>,
        );
      });
      const orders = container.querySelector<HTMLElement>(
        '[data-app-element="orders-output"]',
      );
      expect(orders && getComputedStyle(orders).padding).toBe("12px");
      expect(orders?.querySelector('[role="status"]')?.textContent).toBe(
        footer,
      );
      expect(orders?.querySelector('tbody th[scope="row"]')?.textContent).toBe(
        "0",
      );
      const headers = orders?.querySelectorAll('thead th[scope="col"]');
      expect(
        headers?.[1]?.querySelector(".tabler-icon-letter-case"),
      ).toBeTruthy();
      expect(headers?.[2]?.querySelector(".tabler-icon-hash")).toBeTruthy();
      const numericCell = orders?.querySelector<HTMLElement>(
        "tbody td:last-child",
      );
      expect(numericCell?.textContent).toBe("42");
      expect(numericCell && getComputedStyle(numericCell).textAlign).toBe(
        "right",
      );
      expect(orders?.querySelector("pre, [contenteditable]")).toBeNull();
      const menu = orders?.querySelector<HTMLButtonElement>(
        'button[aria-label="Column actions for orders"]',
      );
      expect(menu).toBeTruthy();
      await act(async () => {
        menu?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
      });
      expect(
        [...document.querySelectorAll('[role="menuitem"]')].map(
          (item) => item.textContent,
        ),
      ).toEqual(["Copy column name", "Sort 1 → 9", "Sort 9 → 1", "Filter..."]); // oracle-change: column menu now uses typed sort labels and adds Copy column name
      expect(query.callAction).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  },
);

it("names the calendar button and shows its tooltip on keyboard focus", async () => {
  showProjection(project);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages }}
          persistPreference={false}
        >
          <PublishedProjectPage
            route={resolveRoute("/app/prj_1/ver_published")}
          />
        </AgentNativeI18nProvider>,
      );
    });
    const calendar = container.querySelector<HTMLButtonElement>(
      'header button[aria-label="Scheduled runs & notifications"]',
    );
    expect(calendar).toBeTruthy();
    await act(async () => calendar?.focus());
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
      "Scheduled runs & notifications",
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("renders a saved project's cells for a reader", async () => {
  showProjection(project);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const renderPage = () =>
    act(async () => {
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages }}
          persistPreference={false}
        >
          <PublishedProjectPage
            route={resolveRoute("/app/prj_1/ver_published")}
          />
        </AgentNativeI18nProvider>,
      );
    });
  await renderPage();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  const main = container.querySelector<HTMLElement>(
    '[data-published-app="true"]',
  );
  expect(main).not.toBeNull();
  expect(main && getComputedStyle(main).overflowY).toBe("auto");
  expect(main?.tabIndex).toBe(0);
  expect(
    main?.querySelector('[aria-label="Scheduled runs & notifications"]'),
  ).not.toBeNull();
  expect(main?.textContent).toContain("Share");
  expect(container.textContent).toContain("Revenue overview");
  expect(container.textContent).toContain("How the business is trending.");
  expect(container.textContent).toContain("EMEA");
  expect(container.querySelector("[data-panel-description]")?.textContent).toBe(
    "Orders by region",
  );
  expect(container.querySelector("h2")?.textContent).toBe("Revenue");
  expect(
    [...container.querySelectorAll("h2")].map(
      (title) => title.closest("section")?.parentElement?.style.gridRow,
    ),
  ).toEqual(["1 / span 2", "1 / span 2", "3 / span 2"]);
  expect(container.textContent).toContain("51+ rows");
  expect(container.textContent).not.toContain("1,200 rows");
  const notice = container.querySelector<HTMLElement>(
    ".nb-table-scroll + .nb-output-footer",
  );
  expect(notice?.textContent).toBe("Showing the first 51 rows.");
  expect.soft(notice && getComputedStyle(notice).paddingTop).toBe("8px");
  expect(
    [...container.querySelectorAll('[aria-roledescription="bar"]')].map((bar) =>
      bar.getAttribute("aria-label"),
    ),
  ).toEqual(["x: EMEA; value: 42; series: orders; region: EMEA; Value: 42"]); // oracle-change: charts draw through Vega-Lite, which labels each bar mark instead of a bar title
  // A chart cell draws rather than reporting that it has no result.
  expect(container.textContent).not.toContain("This cell has no result yet");
  // A reader sees no editing chrome.
  expect(
    container.querySelector('button[aria-label="Add cell here"]'),
  ).toBeNull();
  expect(container.querySelector("[contenteditable='true']")).toBeNull();
  expect(query.useActionQuery).toHaveBeenCalledWith(
    "open-published-app-session",
    {
      projectId: "prj_1",
      version: "ver_published",
      openId: expect.any(String),
    },
    expect.objectContaining({ enabled: true, retry: false }),
  );
  showProjection({
    ...project,
    outputs: {
      ...project.outputs,
      c2: {
        ...project.outputs.c2,
        output: cellOutputSchema.parse({
          ...project.outputs.c2.output,
          rows: Array.from({ length: 1200 }, () => ["EMEA", 42]),
          rowCount: 1200,
          truncated: false,
        }),
      },
    },
  });
  await renderPage();
  expect(main?.textContent).toContain("1,200 rows");
  expect(main?.textContent).not.toContain("Showing the first 51 rows.");
  await act(async () => root.unmount());
  container.remove();
});

it("stacks published tiles in reading order in a scrollable phone viewport", async () => {
  showProjection(project);
  const desktopWidth = window.innerWidth;
  const { happyDOM } = window as unknown as {
    happyDOM: { setViewport(viewport: { width: number }): void };
  };
  happyDOM.setViewport({ width: 390 });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages }}
          persistPreference={false}
        >
          <PublishedProjectPage
            route={resolveRoute("/app/prj_1/ver_published")}
          />
        </AgentNativeI18nProvider>,
      );
    });
    const headings = [...container.querySelectorAll("h2")];
    expect(headings.map((heading) => heading.textContent)).toEqual([
      "Revenue",
      "Orders",
      "Orders chart",
    ]);
    const tiles = headings[0]?.closest("section")?.parentElement?.parentElement;
    expect(tiles).toBeDefined();
    expect(tiles && getComputedStyle(tiles).display).toBe("flex");
    expect(tiles && getComputedStyle(tiles).flexDirection).toBe("column");
    const scroller = tiles?.closest("main");
    expect(scroller && getComputedStyle(scroller).overflowY).toBe("auto");
    expect(scroller?.tabIndex).toBe(0);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    happyDOM.setViewport({ width: desktopWidth });
  }
});

it("draws read-only charts from a published SQL result and inline rows without chart outputs", async () => {
  const cells = [
    {
      id: "source",
      contents: {
        ...baseContents,
        id: "source",
        order: "a1",
        kind: "sql",
        source: "select amount, target, source from flows",
        dataConnectionId: null,
        databaseSchema: null,
        resultVariable: "flows",
        outputResult: true,
      },
    },
    {
      id: "sankey",
      contents: {
        ...baseContents,
        id: "sankey",
        order: "a2",
        kind: "chart",
        dataframe: "flows",
        chartSpec: {
          mark: "sankey",
          xField: "source",
          yField: "amount",
          seriesField: "target",
          title: "Published flow",
        },
      },
    },
    {
      id: "inline",
      contents: {
        ...baseContents,
        id: "inline",
        order: "a3",
        kind: "chart",
        dataframe: JSON.stringify([
          { region: "North", amount: 12 },
          { region: "South", amount: 24 },
        ]),
        chartSpec: {
          mark: "bar",
          xField: "region",
          yField: "amount",
          seriesField: null,
          title: "Published amounts",
        },
      },
    },
  ].map((cell) => ({
    ...cell,
    projectId: "prj_1",
    versionId: "ver_published",
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
  showProjection({
    project: projectDocumentSchema.parse({ ...project.project, cells }),
    outputs: {
      source: {
        output: cellOutputSchema.parse({
          type: "table",
          columns: [
            { name: "amount", type: "number" },
            { name: "target", type: "string" },
            { name: "source", type: "string" },
          ],
          rows: [
            [42, "B", "A"],
            [84, "C", "A"],
          ],
          rowCount: 2,
          truncated: false,
        }),
      },
    },
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <PublishedProjectPage route={resolveRoute("/app/prj_1/latest")} />,
      ),
    );
    expect(
      [...container.querySelectorAll(".nb-chart-sankey-link title")].map(
        (node) => node.textContent,
      ),
    ).toEqual(["A → B: 42", "A → C: 84"]);
    await vi.waitFor(
      () =>
        expect(
          [...container.querySelectorAll('[aria-roledescription="bar"]')].map(
            (node) => node.getAttribute("aria-label"),
          ),
        ).toEqual([
          "x: North; value: 12; series: amount; region: North; Value: 12",
          "x: South; value: 24; series: amount; region: South; Value: 24",
        ]), // oracle-change: charts draw through Vega-Lite, which labels each bar mark and draws after its renderer loads
    );
    expect(
      container.querySelector('[aria-label="Published flow"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[aria-label="Published amounts"]'),
    ).not.toBeNull();
    expect(
      container.querySelector("select, input, [contenteditable=true]"),
    ).toBeNull();
    expect(container.textContent).not.toContain("This cell has no result yet");
  } finally {
    await act(async () => root.unmount());
  }
});

it("keeps a completed empty SQL result distinct from an unresolved chart binding", async () => {
  const chart = project.project.cells.find(
    (cell) => cell.contents.kind === "chart",
  );
  if (!chart) throw new Error("Chart fixture missing");
  showProjection({
    project: projectDocumentSchema.parse({
      ...project.project,
      cells: [
        {
          ...chart,
          id: "source",
          contents: {
            ...baseContents,
            id: "source",
            order: "a1",
            kind: "sql",
            source: "select region, orders from orders where false",
            dataConnectionId: null,
            databaseSchema: null,
            resultVariable: "df_orders",
            outputResult: true,
          },
        },
        chart,
      ],
    }),
    outputs: {
      source: {
        output: cellOutputSchema.parse({
          type: "table",
          columns: [
            { name: "region", type: "string" },
            { name: "orders", type: "number" },
          ],
          rows: [],
          rowCount: 0,
          truncated: false,
        }),
      },
    },
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <PublishedProjectPage route={resolveRoute("/app/prj_1/latest")} />,
      ),
    );
    const chartSection = [...container.querySelectorAll("section")].find(
      (section) => section.querySelector("h2")?.textContent === "Orders chart",
    );
    expect(chartSection).toBeDefined();
    expect(
      [...(chartSection?.querySelectorAll("th") ?? [])].map(
        (node) => node.textContent,
      ),
    ).toEqual(["region", "orders"]);
    expect(chartSection?.textContent).not.toContain(
      "This cell has no result yet",
    );
  } finally {
    await act(async () => root.unmount());
  }
});

it.each([
  [
    "project_not_found",
    404,
    "This link points at a project that is not in this workspace.",
  ],
  ["project_version_not_found", 404, "You don’t have access to this page."],
  [
    "published_snapshot_unavailable",
    409,
    "This version's saved results are unavailable.",
  ],
  ["project_access_denied", 403, "You don’t have access to this page."],
  ["stored_data_error", 500, "An unexpected error occurred."],
] as const)(
  "offers a reader-facing recovery link and message on %s",
  async (errorCode, status, detail) => {
    const message = `Action get-project failed: ${errorCode}`;
    const notFound = errorCode === "project_not_found";
    const denied = status === 403 || status === 404;
    const authored =
      errorCode === "project_version_not_found" ||
      errorCode === "published_snapshot_unavailable";
    query.refetch.mockClear();
    query.useActionQuery.mockReturnValue({
      data: undefined,
      isPending: false,
      refetch: query.refetch,
      error: Object.assign(new Error(message), {
        errorCode,
        status,
        ...(authored ? { actionMessage: detail } : {}),
      }),
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          <AgentNativeI18nProvider
            catalog={{ messages }}
            persistPreference={false}
          >
            <MemoryRouter>
              <PublishedProjectPage
                route={resolveRoute("/app/missing-project/ver_published")}
              />
            </MemoryRouter>
          </AgentNativeI18nProvider>,
        );
      });
      expect(container.querySelector("h1")?.textContent).toBe(
        notFound
          ? "Project not found"
          : denied
            ? "App unavailable"
            : "This project could not be opened",
      );
      if (notFound) {
        expect(document.title).toContain("Project not found");
        expect(document.title).not.toContain("App unavailable");
      }
      expect(container.textContent).toContain(detail);
      expect(container.textContent).not.toContain(message);
      expect(
        container.querySelector(
          denied ? 'a[href="/home/all"]' : 'a[href="/home"]',
        )?.textContent,
      ).toBe(denied ? "Back to Projects" : "Go home");
      const retry = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Retry",
      );
      if (denied) expect(retry).toBeUndefined();
      else {
        if (!retry) throw new Error("Missing Retry on a failed open");
        await act(async () => retry.click());
        expect(query.refetch).toHaveBeenCalledTimes(1);
      }
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  },
);

it("opens a cached release with zero runs, changes private inputs once and resets to cached defaults", async () => {
  const input = {
    id: "region-input",
    projectId: "prj_1",
    versionId: "ver_published",
    createdAt: timestamp,
    updatedAt: timestamp,
    contents: {
      ...baseContents,
      id: "region-input",
      order: "9z",
      kind: "input",
      name: "region",
      inputType: "DROPDOWN",
      defaultValueString: "North",
      options: ["North", "South"],
    },
  };
  const released = {
    ...project,
    project: projectDocumentSchema.parse({
      ...project.project,
      cells: [input, ...project.project.cells],
    }),
  };
  const defaults = { "region-input": { kind: "string", value: "North" } };
  const south = { "region-input": { kind: "string", value: "South" } };
  showProjection(released, {
    effectiveValues: defaults,
    staleAfter: { kind: "hours", value: 1 },
  });
  query.callAction.mockImplementation(async (name) => {
    if (name === "set-published-app-inputs") {
      showProjection(released, {
        effectiveValues: south,
        overrides: south,
        inputRevision: "1",
        refreshedAt: "2026-11-17T00:00:00Z",
      });
      return { inputRevision: "1", effectiveValues: south };
    }
    if (name === "save-published-app-view") {
      return {
        savedViewId: "save-1",
        releaseId: "ver_published",
        name: "South",
        href: "/app/prj_1/ver_published?savedViewId=save-1",
      };
    }
    if (name === "reset-published-app-session") {
      showProjection(released, {
        effectiveValues: defaults,
        inputRevision: "2",
      });
      return { inputRevision: "2", effectiveValues: defaults };
    }
    throw new Error(`Unexpected action ${name}`);
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages }}
          persistPreference={false}
        >
          <PublishedProjectPage
            route={resolveRoute("/app/prj_1/ver_published/session-1", {
              authenticated: true,
            })}
          />
        </AgentNativeI18nProvider>,
      ),
    );
    const control = container.querySelector<HTMLButtonElement>(
      'button[role="combobox"][aria-label="Value for region"]',
    );
    if (!control) throw new Error("Missing Region input");
    expect(control.textContent).toBe("North");
    expect(container.querySelector("select")).toBeNull();
    expect(query.callAction).not.toHaveBeenCalled();
    expect(query.useActionQuery).toHaveBeenCalledWith(
      "open-published-app-session",
      expect.objectContaining({
        projectId: "prj_1",
        version: "ver_published",
        sessionId: "session-1",
      }),
      expect.anything(),
    );
    const ageControl = container.querySelector<HTMLButtonElement>(
      '[aria-label^="Data refreshed:"]',
    );
    if (!ageControl) throw new Error("Missing data freshness control");
    const originalAge = ageControl.getAttribute("aria-label");
    await act(async () => ageControl.click());
    expect(document.body.textContent).toContain(
      "When opened, this app fetches new data if results are older than 1 hour.",
    );
    await act(async () => ageControl.click());
    await act(async () => control.click());
    const southOption = [
      ...document.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find((option) => option.textContent === "South");
    if (!southOption) throw new Error("Missing South option");
    await act(async () => southOption.click());
    expect(query.callAction).toHaveBeenCalledExactlyOnceWith(
      "set-published-app-inputs",
      {
        sessionId: "session-1",
        releaseId: "ver_published",
        requestId: expect.any(String),
        expectedInputRevision: "0",
        updates: [
          {
            inputCellId: "region-input",
            value: { kind: "string", value: "South" },
          },
        ],
      },
    );
    expect(control.textContent).toBe("South");
    expect(container.textContent).toContain("Save view");
    const save = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Save view",
    );
    if (!save) throw new Error("Missing Save view control");
    await act(async () => save.click());
    const saveDialog = document.querySelector('[role="dialog"]');
    const name = saveDialog?.querySelector<HTMLInputElement>(
      'input[aria-label="View name"]',
    );
    const submit = saveDialog?.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    );
    if (!name || !submit) throw new Error("Missing Save view dialog");
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(name, "South");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => submit.click());
    expect(query.callAction).toHaveBeenLastCalledWith(
      "save-published-app-view",
      {
        sessionId: "session-1",
        releaseId: "ver_published",
        requestId: expect.any(String),
        expectedInputRevision: "1",
        name: "South",
      },
    );
    const reset = container.querySelector<HTMLButtonElement>(
      '[aria-label="Reset 1 input and return to default view"]',
    );
    if (!reset) throw new Error("Missing Reset control");
    await act(async () => reset.click());
    expect(query.callAction).toHaveBeenLastCalledWith(
      "reset-published-app-session",
      {
        sessionId: "session-1",
        releaseId: "ver_published",
        requestId: expect.any(String),
        expectedInputRevision: "1",
      },
    );
    expect(control.textContent).toBe("North");
    expect(container.textContent).not.toContain("Save view");
    expect(
      container
        .querySelector('[aria-label^="Data refreshed:"]')
        ?.getAttribute("aria-label"),
    ).toBe(originalAge);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("shows a forced release error from the pinned session with a private recovery action", async () => {
  const reason = "Check the selected connection's permissions.";
  showProjection(
    {
      ...project,
      outputs: {
        ...project.outputs,
        c2: {
          output: { type: "error", message: reason, detail: null },
          resultStatus: "failed",
        },
      },
    },
    { state: "error", ageStatus: "unavailable", refreshedAt: null },
  );
  query.callAction.mockResolvedValue({ runId: "rerun", cursor: "1" });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <PublishedProjectPage
          route={resolveRoute("/app/prj_1/ver_published/session-1", {
            authenticated: true,
          })}
        />,
      ),
    );
    expect(container.textContent).toContain(reason);
    const rerun = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Rerun app",
    );
    if (!rerun) throw new Error("Missing recovery control");
    await act(async () => rerun.click());
    expect(query.callAction).toHaveBeenCalledExactlyOnceWith(
      "refresh-published-app-results",
      {
        sessionId: "session-1",
        releaseId: "ver_published",
        requestId: expect.any(String),
        scope: "session",
        cachePolicy: "reuse",
      },
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("keeps the published layout visible when a SQL cell and its chart have no result after a failed run", async () => {
  const detail = "A private upstream query failed.";
  const cells = projectDocumentSchema.parse({
    ...project.project,
    cells: [
      ...project.project.cells.map((cell) =>
        cell.contents.kind === "chart"
          ? {
              ...cell,
              contents: {
                ...cell.contents,
                chartSpec: {
                  ...cell.contents.chartSpec,
                  version: 3,
                  sourceCellId: "failed-sql",
                  sourceExportId: "result",
                },
              },
            }
          : cell,
      ),
      {
        id: "failed-sql",
        projectId: "prj_1",
        versionId: "ver_published",
        createdAt: timestamp,
        updatedAt: timestamp,
        contents: {
          ...baseContents,
          id: "failed-sql",
          order: "a4",
          kind: "sql",
          label: "Orders query",
          source: "select region, orders from orders",
          dataConnectionId: null,
          databaseSchema: null,
          resultVariable: "df_orders",
          outputResult: true,
        },
      },
    ],
  }).cells;
  const layout = emptyAppLayout(revisionSchema.parse("0"));
  const tab = layout.tabs[0];
  if (!tab) throw new Error("App tab missing");
  const appLayout = applyAppPatches(
    layout,
    [
      { type: "initialize" },
      {
        type: "place",
        tabId: tab.tabId,
        elementId: "failed-query-output",
        cellId: "failed-sql",
        destination: {
          rowId: "query-row",
          columnId: "query-column",
          left: 0,
          right: 120,
          afterRowId: null,
        },
      },
    ],
    cells,
  );
  const release = { ...project.project, cells, appLayout };
  showProjection(
    {
      project: release,
      outputs: {
        c2: project.outputs.c2,
        "failed-sql": {
          output: { type: "error", message: detail, detail: null },
          resultStatus: "failed",
        },
      },
    },
    { state: "error" },
  );
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider catalog={{ messages }}>
          <PublishedProjectPage route={resolveRoute("/app/prj_1/latest")} />
        </AgentNativeI18nProvider>,
      ),
    );
    expect(container.textContent).toContain("How the business is trending.");
    expect(container.textContent).toContain(
      "An error occurred while running this app.",
    );
    expect(container.textContent).toContain("Rerun app");
    expect
      .soft(container.querySelector('[data-published-cell="c3"]')?.textContent)
      .toContain("Loading chart...");
    expect
      .soft(
        container.querySelector('[data-published-cell="failed-sql"]')
          ?.textContent,
      )
      .toContain("This SQL cell has no results");
    expect.soft(container.textContent).not.toContain(detail);
  } finally {
    await act(async () => root.unmount());
  }
});

it("explains when a published app has no elements in the layout", async () => {
  const release = {
    ...project.project,
    appLayout: emptyAppLayout(revisionSchema.parse("0")),
  };
  showProjection({ project: release, outputs: project.outputs });
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider catalog={{ messages }}>
          <PublishedProjectPage route={resolveRoute("/app/prj_1/latest")} />
        </AgentNativeI18nProvider>,
      ),
    );
    expect(container.textContent).toContain("The App builder is empty");
    expect(container.textContent).toContain(
      "The creator of this project has not added any elements.",
    );
    expect(container.querySelectorAll("[data-published-cell]")).toHaveLength(0);
  } finally {
    await act(async () => root.unmount());
  }
});

it("report A2-BQ-V3-NO-RESULTS: runs a release that was published without results once on first open", async () => {
  showProjection(project, {
    state: "ready",
    ageStatus: "unavailable",
    refreshedAt: null,
  });
  query.callAction.mockResolvedValue({ runId: "first-run", cursor: "1" });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <PublishedProjectPage
          route={resolveRoute("/app/prj_1/ver_published/session-1", {
            authenticated: true,
          })}
        />,
      ),
    );
    expect(query.callAction).toHaveBeenCalledTimes(1);
    expect(query.callAction.mock.calls[0]?.[0]).toBe(
      "refresh-published-app-results",
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("pages and drills by authorized result identity in the pinned viewer session", async () => {
  const data = projectDocumentSchema.parse({
    ...project.project,
    cells: [
      ...project.project.cells,
      {
        id: "sql-orders",
        projectId: "prj_1",
        versionId: "ver_published",
        createdAt: timestamp,
        updatedAt: timestamp,
        contents: {
          ...baseContents,
          id: "sql-orders",
          kind: "sql",
          source: "SELECT region, orders FROM results",
          dataConnectionId: null,
          databaseSchema: null,
          order: "a4",
          hidden: true,
          resultVariable: "df_orders",
          outputResult: true,
        },
      },
    ],
  });
  const fields = [
    { fieldId: "0", name: "region", type: "string" },
    { fieldId: "1", name: "orders", type: "number" },
  ];
  const manifest = {
    result: { resultId: "result-orders" },
    status: "complete",
    fields,
    rowCount: "51",
  };
  query.pages.set("result-orders", {
    status: "ready",
    manifest,
    rows: Array.from({ length: 50 }, () => ["EMEA", 42]),
    page: 1,
  });
  showProjection({
    project: data,
    outputs: {
      "sql-orders": {
        output: null,
        resultId: "result-orders",
        resultStatus: "ready",
      },
    },
  });
  const sessionData = sessionFixture({
    project: data,
    outputs: {
      "sql-orders": {
        output: null,
        resultId: "result-orders",
        resultStatus: "ready",
      },
    },
  });
  query.useActionQuery.mockImplementation((actionName: string) => {
    if (actionName === "get-notebook-transform") {
      return {
        data: {
          result: {
            status: "ready",
            kind: "chart",
            visualizationResultId: "viz-orders",
            source: {
              result: { resultId: "result-orders" },
              fields,
              rowCount: "51",
            },
            categories: ["EMEA"],
            rows: [
              { x: "EMEA", series: null, value: 42, selectionId: "sel-emea" },
            ],
            capped: false,
          },
        },
        isPending: false,
        error: null,
        refetch: query.refetch,
      };
    }
    return {
      data: sessionData,
      isPending: false,
      error: null,
      refetch: query.refetch,
    };
  });
  query.callAction.mockImplementation(async (name) => {
    if (name === "get-notebook-result-page")
      return { status: "ready", manifest, rows: [["APAC", 84]], page: 2 };
    if (name === "open-published-result-drill")
      return {
        status: "ready",
        fields,
        rows: [["EMEA", 42]],
        page: 1,
        totalRows: 1,
      };
    throw new Error(`Unexpected action ${name}`);
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <PublishedProjectPage
          route={resolveRoute("/app/prj_1/ver_published/session-1", {
            authenticated: true,
          })}
        />,
      ),
    );
    expect(container.textContent).toContain("EMEA");
    const next = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Next page"]',
    );
    if (!next) throw new Error("Missing artifact page control");
    await act(async () => next.click());
    expect(query.callAction).toHaveBeenCalledExactlyOnceWith(
      "get-notebook-result-page",
      {
        resultId: "result-orders",
        sessionId: "session-1",
        page: 2,
      },
      { method: "GET" },
    );
    expect(container.textContent).toContain("APAC");
    const mark = container.querySelector('[aria-roledescription="bar"]'); // oracle-change: charts draw through Vega-Lite, so the drilled mark is its bar
    if (!mark) throw new Error("Missing chart mark for the source result");
    await act(async () =>
      mark.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(query.callAction).toHaveBeenLastCalledWith(
      "open-published-result-drill",
      {
        resultId: "result-orders",
        sessionId: "session-1",
        filters: [{ fieldId: "0", value: "EMEA" }],
      },
    );
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "EMEA",
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

async function renderEmbedded(search: string) {
  showProjection(project);
  window.history.replaceState(null, "", `/app/prj_1/latest${search}`);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <PublishedProjectPage
        route={resolveRoute(`/app/prj_1/latest${search}`)}
      />,
    );
  });
  await vi.waitFor(() =>
    expect(container.querySelector("[data-published-app]")).not.toBeNull(),
  );
  return {
    container,
    done: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

it("shows only the embedded cell, with none of the page around it", async () => {
  const { container, done } = await renderEmbedded("?embed=c1");
  try {
    expect(
      container
        .querySelector('[data-published-app="true"]')
        ?.getAttribute("data-embedded"),
    ).toBe("true");
    expect(container.textContent).toContain("How the business is trending.");
    expect(container.textContent).not.toContain("Revenue overview");
    expect(container.textContent).not.toContain("EMEA");
    expect(container.querySelector("h1")).toBeNull();
    expect(container.querySelectorAll("[data-published-cell]")).toHaveLength(1);
  } finally {
    await done();
  }
});

it("says so when the embedded cell is not there, and shows nothing else of the project", async () => {
  const { container, done } = await renderEmbedded("?embed=no_such_cell");
  try {
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelectorAll("[data-published-cell]")).toHaveLength(0);
    expect(container.textContent).not.toContain("Revenue overview");
  } finally {
    await done();
  }
});

it("shows the whole app when no cell is embedded", async () => {
  const { container, done } = await renderEmbedded("");
  try {
    expect(container.textContent).toContain("Revenue overview");
    expect(
      container.querySelectorAll("[data-published-cell]").length,
    ).toBeGreaterThan(1);
  } finally {
    await done();
  }
});

it("report ASK84-PANEL-DESCRIPTION shows a long description as one line that expands", async () => {
  const long =
    "Of the people who first signed up in the 7 days up to each date, the share who came back in week one.";
  showProjection({
    ...project,
    project: {
      ...project.project,
      cells: project.project.cells.map((cell) =>
        cell.id === "c3"
          ? { ...cell, contents: { ...cell.contents, description: long } }
          : cell,
      ),
    },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <PublishedProjectPage route={resolveRoute("/app/prj_1/ver_published")} />,
    );
  });
  const toggle = container.querySelector<HTMLButtonElement>(
    "button[data-panel-description]",
  );
  expect(toggle?.textContent).toBe(long);
  expect(toggle?.getAttribute("aria-expanded")).toBe("false");
  expect(toggle?.querySelector("span")?.style.whiteSpace).toBe("nowrap");
  await act(async () => toggle?.click());
  expect(toggle?.getAttribute("aria-expanded")).toBe("true");
  expect(toggle?.querySelector("span")?.style.whiteSpace).toBe("pre-wrap");
  await act(async () => root.unmount());
  container.remove();
});

it.each([false, true])(
  "report A2-BQ-V3-TABLE-PAGER: pages published table rows (configured columns: %s)",
  async (configured) => {
    const data = structuredClone(project);
    const cell = data.project.cells.find((item) => item.id === "c2");
    if (!cell || cell.contents.kind !== "display-table")
      throw new Error("table missing");
    cell.contents.columns = configured
      ? [{ name: "orders", header: null, format: null, hidden: false }]
      : [];
    const output = data.outputs.c2.output;
    if (output.type !== "table") throw new Error("table output missing");
    output.rows = Array.from({ length: 34 }, (_, index) => ["EMEA", index + 1]);
    output.rowCount = 34;
    output.truncated = false;
    showProjection(data);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          <PublishedProjectPage
            route={resolveRoute("/app/prj_1/ver_published")}
          />,
        ),
      );
      expect(container.querySelectorAll("tbody tr")).toHaveLength(25);
      expect(
        container.querySelector("tbody tr:last-child")?.textContent,
      ).toContain("25");
      const next = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Next page"]',
      );
      expect(next?.disabled).toBe(false);
      await act(async () => next?.click());
      const rows = container.querySelectorAll("tbody tr");
      expect(rows).toHaveLength(9);
      expect(rows[0]?.textContent).toContain("26");
      expect(rows[8]?.textContent).toContain("34");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  },
);

it("report A2-FIND-1120F-S5-5: keeps /app/<id>/latest URL instead of rewriting to a versioned session UUID", async () => {
  showProjection(project);
  let currentPath = "";
  function PathObserver() {
    currentPath = useLocation().pathname;
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={["/app/prj_1/latest"]}>
          <PathObserver />
          <PublishedProjectRoutePage
            route={resolveRoute("/app/prj_1/latest")!}
          />
        </MemoryRouter>,
      ),
    );
    expect(currentPath).toBe("/app/prj_1/latest");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("report A2-FIND-1120F-S5-4: formats age and switches Run now vs Refresh data now by state", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-21T12:00:00Z"));
  const twoWeeksAgo = "2026-11-07T12:00:00Z";
  const threeHoursAgo = "2026-11-21T09:00:00Z";
  const expectedDate = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
  }).format(new Date(twoWeeksAgo));

  const mountAndOpenRefreshPopover = async (
    overrides: Record<string, unknown>,
  ) => {
    const appLayout = emptyAppLayout(revisionSchema.parse("0"));
    const withLayout = {
      ...project,
      project: projectDocumentWithLayoutSchema.parse({
        ...project.project,
        appLayout: {
          ...appLayout,
          settings: {
            ...appLayout.settings,
            autoRefresh:
              typeof overrides.autoRefresh === "boolean"
                ? overrides.autoRefresh
                : true,
          },
        },
      }),
    };
    const { autoRefresh: _ignored, ...sessionOverrides } = overrides;
    showProjection(withLayout, sessionOverrides);
    query.callAction.mockResolvedValue({ runId: "run_refresh", cursor: "1" });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages }}
          persistPreference={false}
        >
          <PublishedProjectPage
            route={resolveRoute("/app/prj_1/ver_published/session-1", {
              authenticated: true,
            })}
          />
        </AgentNativeI18nProvider>,
      ),
    );
    const headerRow = container.querySelector("header > div");
    const leftGroup = headerRow?.firstElementChild;
    const rightGroup = headerRow?.lastElementChild;
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Data refreshed:"]',
    );
    if (!trigger) throw new Error("Missing data-refresh trigger");
    return {
      container,
      leftGroup,
      rightGroup,
      trigger,
      cleanup: async () => {
        await act(async () => root.unmount());
        container.remove();
      },
    };
  };

  try {
    const oldFresh = await mountAndOpenRefreshPopover({
      refreshedAt: twoWeeksAgo,
      ageStatus: "fresh",
    });
    try {
      expect(oldFresh.rightGroup?.contains(oldFresh.trigger)).toBe(true);
      expect(oldFresh.leftGroup?.contains(oldFresh.trigger)).toBe(false);
      expect(oldFresh.trigger.textContent.trim()).toBe(expectedDate);
      expect(oldFresh.trigger.textContent).not.toContain("days ago");

      await act(async () => oldFresh.trigger.click());
      const buttons = [...document.querySelectorAll("button")];
      const runNow = buttons.find(
        (item) => item.textContent.trim() === "Run now",
      );
      expect(runNow).toBeTruthy();
      expect(
        buttons.some((item) => item.textContent.trim() === "Refresh data now"),
      ).toBe(false);
      await act(async () => runNow?.click());
      expect(query.callAction).toHaveBeenCalledWith(
        "refresh-published-app-results",
        expect.objectContaining({
          sessionId: "session-1",
          releaseId: "ver_published",
          scope: "default",
          cachePolicy: "bypass",
        }),
      );
    } finally {
      await oldFresh.cleanup();
    }

    const recentFresh = await mountAndOpenRefreshPopover({
      refreshedAt: threeHoursAgo,
      ageStatus: "fresh",
    });
    try {
      expect(recentFresh.trigger.textContent.trim()).toBe("3h ago");
      await act(async () => recentFresh.trigger.click());
      expect(
        [...document.querySelectorAll("button")].some(
          (item) => item.textContent.trim() === "Run now",
        ),
      ).toBe(true);
    } finally {
      await recentFresh.cleanup();
    }

    const staleAuto = await mountAndOpenRefreshPopover({
      refreshedAt: threeHoursAgo,
      ageStatus: "stale",
      autoRefresh: true,
    });
    try {
      await act(async () => staleAuto.trigger.click());
      expect(
        [...document.querySelectorAll("button")].some(
          (item) => item.textContent.trim() === "Refresh data now",
        ),
      ).toBe(true);
    } finally {
      await staleAuto.cleanup();
    }

    const staleManual = await mountAndOpenRefreshPopover({
      refreshedAt: threeHoursAgo,
      ageStatus: "stale",
      autoRefresh: false,
    });
    try {
      await act(async () => staleManual.trigger.click());
      const buttons = [...document.querySelectorAll("button")];
      expect(
        buttons.some((item) => item.textContent.trim() === "Run now"),
      ).toBe(true);
      expect(
        buttons.some((item) => item.textContent.trim() === "Refresh data now"),
      ).toBe(false);
    } finally {
      await staleManual.cleanup();
    }
  } finally {
    vi.useRealTimers();
  }
});
