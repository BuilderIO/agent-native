// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import messages from "@/i18n/en-US";
import { cellOutputSchema, cellSchema, type Cell } from "@/lib/model/contracts";

import {
  applyAppPatches,
  appDocumentSchema,
  emptyAppLayout,
  legacyAppLayout,
  type AppDocument,
} from "../../../shared/app-layout";
import {
  appSessionIdSchema,
  resultIdSchema,
} from "../../../shared/notebook-execution";
import { revisionSchema } from "../../../shared/notebook-snapshot-contract";
import { AppLayoutSnapshot } from "./AppLayoutSnapshot";

import publishedStyles from "./app-layout-snapshot.css?raw";
import notebookStyles from "@/components/notebook/notebook.css?raw";

const revision = revisionSchema.parse("0");
const timestamp = "2026-11-19T00:00:00.000Z";

function textCell(id: string, label: string, gridHeight: number | null): Cell {
  return {
    id,
    projectId: "project",
    versionId: "release",
    createdAt: timestamp,
    updatedAt: timestamp,
    contents: {
      id,
      kind: "text",
      order: id,
      label,
      hidden: false,
      gridX: 0,
      gridY: id === "a" ? 0 : 2,
      gridWidth: 12,
      gridHeight,
      text: "A short tile.",
    },
  };
}

const cells = [textCell("a", "Summary", 2), textCell("b", "Detail", 3)];
const { useActionQuery } = vi.hoisted(() => ({ useActionQuery: vi.fn() }));
vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  useActionQuery,
}));
let styles: HTMLStyleElement;
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  styles = document.createElement("style");
  styles.textContent = notebookStyles + publishedStyles;
  document.head.append(styles);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  styles.remove();
  useActionQuery.mockReset();
  vi.unstubAllGlobals();
});

async function render(
  layout?: AppDocument,
  snapshotCells = cells,
  values: Record<string, string> = {},
  tabBookmark: string | null = null,
) {
  await act(async () =>
    root.render(
      <AgentNativeI18nProvider catalog={{ messages }} persistPreference={false}>
        <AppLayoutSnapshot
          cells={snapshotCells}
          outputs={{}}
          layout={layout}
          tabBookmark={tabBookmark}
          onTabChange={() => {}}
          canViewSource={false}
          values={values}
        />
      </AgentNativeI18nProvider>,
    ),
  );
}

it("renders a placed Section heading and its independently placed child even when the notebook Section is collapsed", async () => {
  const heading = cellSchema.parse({
    ...textCell("a", "", 2),
    contents: {
      ...textCell("a", "", 2).contents,
      kind: "collapsible",
      title: "Quarterly review",
      collapsed: true,
    },
  });
  const child = textCell("b", "Revenue detail", 3);
  child.contents.parentSectionId = heading.id;
  const snapshotCells = [heading, child];
  await render(legacyAppLayout(snapshotCells, revision), snapshotCells);
  const headings = [...container.querySelectorAll("h2")].map(
    ({ textContent }) => textContent,
  );
  expect(headings).toContain("Quarterly review");
  expect(headings).toContain("Revenue detail");
  expect(container.textContent).toContain("A short tile.");
});

it("shows the published empty state for a selected empty tab", async () => {
  const layout = applyAppPatches(
    savedLayout([{ elementId: "summary", cellId: "a", heightPx: 240 }]),
    [
      {
        type: "tab-add",
        tabId: "details",
        name: "Details",
        afterTabId: "tab-1",
      },
    ],
    cells,
  );
  await render(layout, cells, {}, "details");

  expect(
    container.querySelector('[role="tab"][aria-selected="true"]')?.textContent,
  ).toBe("Details");
  const panel = container.querySelector('[role="tabpanel"]');
  expect(panel?.textContent).toContain("This tab is empty");
  expect(panel?.textContent).toContain("The creator has yet to add elements.");
  expect(panel?.querySelector("[data-app-element]")).toBeNull();
});

it("paints the sticky tab strip with the page background across the content width", async () => {
  const layout = applyAppPatches(
    savedLayout([{ elementId: "summary", cellId: "a", heightPx: 240 }]),
    [{ type: "tab-add", tabId: "details", name: "Details" }],
    cells,
  );
  container.className = "app-session-page";
  container.style.setProperty("--color-background", "rgb(52, 43, 65)");
  container.style.backgroundColor = "var(--color-background)";
  await render(layout);

  const tabs = container.querySelector('[role="tablist"]');
  expect(tabs && getComputedStyle(tabs).position).toBe("sticky");
  expect(tabs && getComputedStyle(tabs).width).toBe("100%");
  expect(tabs && getComputedStyle(tabs).backgroundColor).toBe(
    getComputedStyle(container).backgroundColor,
  );
});

it("renders the formatted metric transform on either app tab without rendering its producer", async () => {
  const fixture = textCell("metric", "Revenue", 2);
  const metric = cellSchema.parse({
    ...fixture,
    contents: {
      ...fixture.contents,
      kind: "metric",
      format: null,
      outputResult: false,
      resultVariable: null,
      valueRowIndex: null,
      valueVariableName: null,
      metricConfig: {
        version: 1,
        revision: 0,
        source: { cellId: "hidden", exportId: "result" },
        fieldId: null,
        mode: "aggregate",
        aggregation: null,
        row: 0,
        title: "Total revenue",
        format: "number",
      },
    },
  });
  const layout = applyAppPatches(
    savedLayout([
      { elementId: "overview-metric", cellId: metric.id, heightPx: 240 },
    ]),
    [
      {
        type: "tab-duplicate",
        sourceTabId: "tab-1",
        tabId: "details",
        name: "Details",
      },
    ],
    [metric],
  );
  const field = {
    fieldId: "total",
    name: "total",
    type: "number",
    nullable: false,
  };
  useActionQuery.mockReturnValue({
    data: {
      sources: [],
      result: {
        status: "ready",
        kind: "metric",
        field,
        aggregation: "sum",
        value: 1830,
        source: {
          fields: [field],
          rowCount: 60,
          result: { resultId: "artifact" },
        },
      },
    },
  });
  const scope = {
    releaseId: "release",
    sessionId: appSessionIdSchema.parse("session"),
  };
  for (const tab of ["tab-1", "details"]) {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages }}
          persistPreference={false}
        >
          <AppLayoutSnapshot
            cells={[metric]}
            outputs={{}}
            metricSourceResultIds={{ metric: "artifact" }}
            visualizationScope={scope}
            layout={layout}
            tabBookmark={tab}
            onTabChange={() => {}}
            canViewSource={false}
            values={{}}
          />
        </AgentNativeI18nProvider>,
      ),
    );
    const panel = container.querySelector('[role="tabpanel"]');
    expect(panel?.textContent).toContain("1,830");
    expect(panel?.textContent).toContain("Total revenue");
    expect(panel?.querySelectorAll("[data-published-cell]")).toHaveLength(1);
    expect(panel?.querySelector("pre, table, input")).toBeNull();
  }
});

function savedLayout(
  entries: readonly { elementId: string; cellId: string; heightPx: number }[],
) {
  return appDocumentSchema.parse({
    ...emptyAppLayout(revision),
    initialized: true,
    tabs: [
      {
        tabId: "tab-1",
        name: "Overview",
        rows: entries.map((element) => ({
          rowId: `row-${element.cellId}`,
          columns: [
            {
              columnId: `column-${element.cellId}`,
              left: 0,
              right: 120,
              elements: [{ ...element, display: "output", showLabel: true }],
            },
          ],
        })),
      },
    ],
  });
}

it("renders pinned Python stream, table, and result in their original order", async () => {
  const fixture = textCell("python", "Python", 2);
  const python = cellSchema.parse({
    ...fixture,
    contents: {
      ...fixture.contents,
      kind: "code",
      language: "python",
      source: "print('streamed text')",
      resultVariable: null,
      outputResult: true,
    },
  });
  const scope = {
    releaseId: "release",
    sessionId: appSessionIdSchema.parse("session"),
  };
  const field = {
    fieldId: "data",
    name: "output column",
    type: "number",
    nullable: false,
  };
  const table = {
    status: "ready",
    manifest: { status: "complete", fields: [field], rowCount: "1" },
    rows: [[422]],
    page: 1,
  };
  useActionQuery.mockReturnValue({ data: table });
  await act(async () =>
    root.render(
      <AgentNativeI18nProvider catalog={{ messages }} persistPreference={false}>
        <AppLayoutSnapshot
          cells={[python]}
          outputs={{
            [python.id]: {
              pythonOutputs: [
                { kind: "stream", channel: "stdout", text: "streamed text" },
                {
                  kind: "table",
                  resultId: resultIdSchema.parse("arrow-display"),
                },
                { kind: "text", data: "a later expression" },
              ],
            },
          }}
          visualizationScope={scope}
          layout={savedLayout([
            { elementId: "output", cellId: python.id, heightPx: 240 },
          ])}
          tabBookmark="tab-1"
          onTabChange={() => {}}
          canViewSource={false}
          values={{}}
        />
      </AgentNativeI18nProvider>,
    ),
  );
  expect(
    container.querySelector('[data-published-cell="python"]')?.textContent,
  ).toMatch(/streamed text.*output column.*a later expression/s);
  expect(useActionQuery).toHaveBeenCalledWith(
    "get-notebook-result-page",
    { resultId: "arrow-display", sessionId: scope.sessionId },
    { method: "GET" },
  );
});

it.each(["text", "markdown"] as const)(
  "renders a published %s tile as Markdown with current input values",
  async (kind) => {
    const source = textCell("a", "Summary", 2);
    const prose = cellSchema.parse({
      ...source,
      contents: {
        ...source.contents,
        kind,
        [kind]:
          "# {{ period }} revenue\n\n- **Net** and *gross*\n- [Guide](https://example.test/guide)",
      },
    });
    const choice = cellSchema.parse({
      ...textCell("b", "Period", 2),
      contents: {
        ...textCell("b", "Period", 2).contents,
        kind: "input",
        name: "period",
        inputType: "TEXT_INPUT",
        defaultValueString: "Quarterly",
      },
    });
    await render(
      savedLayout([{ elementId: "summary", cellId: "a", heightPx: 240 }]),
      [prose, choice],
      { b: "Monthly" },
    );

    expect(
      container.querySelector('[role="heading"][aria-level="1"]')?.textContent,
    ).toBe("Monthly revenue");
    expect(container.querySelector("ul li strong")?.textContent).toBe("Net");
    expect(container.querySelector("ul li em")?.textContent).toBe("gross");
    expect(container.querySelector("ul li a")?.getAttribute("href")).toBe(
      "https://example.test/guide",
    );
  },
);

it.each([220, 240])(
  "uses content height for an older saved default of %i px and retains a custom minimum",
  async (heightPx) => {
    await render(
      savedLayout([
        {
          elementId: heightPx === 220 ? "default-summary" : "legacy-element:a",
          cellId: "a",
          heightPx,
        },
        { elementId: "custom-detail", cellId: "b", heightPx: 360 },
      ]),
    );
    const first = container.querySelector<HTMLElement>("[data-app-element]");
    const row = first?.closest<HTMLElement>(".app-snapshot-row");
    expect(first?.style.minHeight).toBe("");
    expect(row?.style.minHeight).toBe("");
    expect(
      container.querySelector<HTMLElement>('[data-app-element="custom-detail"]')
        ?.style.minHeight,
    ).toBe("360px");
  },
);

it("retains an explicit height when it is resized back to the default", async () => {
  const initialized = applyAppPatches(
    emptyAppLayout(revision),
    [{ type: "initialize" }],
    cells,
  );
  const detail = initialized.tabs[0]?.rows[1]?.columns[0]?.elements[0];
  if (!detail) throw new Error("Missing initialized detail tile");
  const layout = applyAppPatches(
    initialized,
    [320, 220].map((heightPx) => ({
      type: "resize",
      tabId: "tab-1",
      elementId: detail.elementId,
      heightPx,
    })),
    cells,
  );
  await render(appDocumentSchema.parse(JSON.parse(JSON.stringify(layout))));
  const tiles = [
    ...container.querySelectorAll<HTMLElement>("[data-app-element]"),
  ];
  expect(tiles.map((tile) => tile.style.minHeight)).toEqual(["", "220px"]);
});

it("sizes legacy tracks to content while preserving grid positions and resized spans", async () => {
  await render();
  const grid = container.querySelector<HTMLElement>(".nb-published-grid");
  expect(grid && getComputedStyle(grid).gridAutoRows).toBe("auto");
  const tiles = [...(grid?.children ?? [])].map((node) => node as HTMLElement);
  expect(tiles.map((tile) => tile.style.gridRow)).toEqual([
    "1 / span 2",
    "3 / span 3",
  ]);
  expect(tiles.map((tile) => tile.style.minHeight)).toEqual(["", "288px"]);
});

it("expands and collapses the table of contents with links to the rendered tiles", async () => {
  await render(legacyAppLayout(cells, revision));
  const trigger = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Table of contents",
  );
  expect(trigger?.getAttribute("aria-expanded")).toBe("false");
  expect(
    trigger
      ?.querySelector(".tabler-icon-chevron-right")
      ?.getAttribute("aria-hidden"),
  ).toBe("true");
  expect(container.querySelector("nav")).toBeNull();

  await act(async () => trigger?.click());
  expect(trigger?.getAttribute("aria-expanded")).toBe("true");
  const navigation = container.querySelector(
    'nav[aria-label="Table of contents"]',
  );
  const links = [...(navigation?.querySelectorAll("a") ?? [])];
  expect(links.map((link) => link.textContent)).toEqual(["Summary", "Detail"]);
  expect(
    links.map(
      (link) =>
        document.getElementById(link.hash.slice(1))?.querySelector("h2")
          ?.textContent,
    ),
  ).toEqual(["Summary", "Detail"]);

  await act(async () => trigger?.click());
  expect(trigger?.getAttribute("aria-expanded")).toBe("false");
  expect(container.querySelector("nav")).toBeNull();
});

it("pages a SQL table at 25 rows like the App builder", async () => {
  const sql = cellSchema.parse({
    ...cells[0],
    id: "tbl",
    contents: {
      ...cells[0]?.contents,
      id: "tbl",
      kind: "sql",
      source: "select 1",
      dataConnectionId: null,
      databaseSchema: null,
      resultVariable: "t",
      outputResult: true,
    },
  });
  await act(async () =>
    root.render(
      <AgentNativeI18nProvider catalog={{ messages }} persistPreference={false}>
        <AppLayoutSnapshot
          cells={[sql]}
          outputs={{
            tbl: {
              output: cellOutputSchema.parse({
                type: "table",
                columns: [{ name: "value", type: "string" }],
                rows: Array.from({ length: 34 }, (_, i) => [String(i + 1)]),
                rowCount: 34,
                truncated: false,
              }),
            },
          }}
          layout={legacyAppLayout([sql], revision)}
          tabBookmark={null}
          onTabChange={() => {}}
          canViewSource={false}
          values={{}}
        />
      </AgentNativeI18nProvider>,
    ),
  );
  expect(container.textContent).toContain("Rows 1–25 of 34");
  expect(container.querySelectorAll("tbody tr")).toHaveLength(25);
});

it("renders nothing for an empty text cell in the published app", async () => {
  const empty = cellSchema.parse({
    ...textCell("empty", "", 2),
    contents: { ...textCell("empty", "", 2).contents, text: "  " },
  });
  const filled = textCell("filled", "", 2);
  const snapshotCells = [empty, filled];
  await render(legacyAppLayout(snapshotCells, revision), snapshotCells);
  expect(container.textContent).not.toContain("This markdown cell is empty.");
  expect(container.textContent).toContain("A short tile.");
  const emptyCard = container.querySelector('[data-published-cell="empty"]');
  expect(emptyCard?.childElementCount ?? 0).toBe(0);
});

it("shows a compact muted No value for a single value without a result", async () => {
  const fixture = textCell("metric", "", 2);
  const metric = cellSchema.parse({
    ...fixture,
    contents: {
      ...fixture.contents,
      kind: "metric",
      format: null,
      outputResult: false,
      resultVariable: null,
      valueRowIndex: null,
      valueVariableName: null,
      metricConfig: {
        version: 1,
        revision: 0,
        source: { cellId: "hidden", exportId: "result" },
        fieldId: null,
        mode: "aggregate",
        aggregation: null,
        row: 0,
        title: "",
        format: null,
      },
    },
  });
  useActionQuery.mockReturnValue({ data: undefined, isPending: false });
  await render(legacyAppLayout([metric], revision), [metric]);
  const label = [...container.querySelectorAll("div")].find(
    (node) => node.textContent === "No value" && node.children.length === 0,
  );
  expect(label?.className).toContain("text-base");
  expect(label?.className).toContain("text-muted-foreground");
  expect(label?.className).not.toContain("font-semibold");
});

it("edits a custom range through its linked hidden inputs and rejects reversed dates", async () => {
  const input = (id: string, name: string, value: string, extra = {}) =>
    cellSchema.parse({
      ...textCell(id, name, 1),
      contents: {
        ...textCell(id, name, 1).contents,
        kind: "input",
        name,
        inputType: "DATE",
        defaultValueString: value,
        ...extra,
      },
    });
  const snapshotCells = [
    input("period", "period", "custom", {
      inputType: "DROPDOWN",
      options: ["30d", "custom"],
      optionLabels: { "30d": "Last 30 days", custom: "Custom range" },
      rangeInputs: { start: "begin", end: "finish" },
    }),
    input("begin", "begin", "2026-10-01", { hidden: true }),
    input("finish", "finish", "2026-10-31", { hidden: true }),
  ];
  const commit = vi.fn();
  await act(async () =>
    root.render(
      <AgentNativeI18nProvider catalog={{ messages }} persistPreference={false}>
        <AppLayoutSnapshot
          cells={snapshotCells}
          outputs={{}}
          layout={undefined}
          tabBookmark={null}
          onTabChange={() => {}}
          canViewSource={false}
          values={{}}
          onChangeValue={() => {}}
          onCommitValue={() => {}}
          onCommitValues={commit}
        />
      </AgentNativeI18nProvider>,
    ),
  );
  const start = container.querySelector<HTMLInputElement>(
    'input[aria-label="Start date"]',
  );
  const end = container.querySelector<HTMLInputElement>(
    'input[aria-label="End date"]',
  );
  expect(start, "custom range exposes the linked start date").not.toBeNull();
  expect(end, "custom range exposes the linked end date").not.toBeNull();
  expect(start!.value).toBe("2026-10-01");
  expect(end!.value).toBe("2026-10-31");
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    setter.call(start!, "2026-11-02");
    start!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    "start date",
  );
  expect(commit).not.toHaveBeenCalled();
  await act(async () => {
    setter.call(end!, "2026-11-08");
    end!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(commit).toHaveBeenCalledExactlyOnceWith([
    { cell: snapshotCells[1], value: "2026-11-02" },
    { cell: snapshotCells[2], value: "2026-11-08" },
  ]);
});
