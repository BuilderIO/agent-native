import { describe, expect, it } from "vitest";

import type { Cell } from "../app/lib/model/contracts.js";
import {
  applyAppPatches,
  appDocumentSchema,
  appPatchSchema,
  draftAppLayout,
  emptyAppLayout,
  legacyAppLayout,
  projectAppLayout,
  resolveAppTab,
  type AppDocument,
  type AppPatch,
} from "./app-layout.js";
import { revisionSchema } from "./notebook-snapshot-contract.js";

const revision = revisionSchema.parse("0");

function textCell(
  id: string,
  grid: Partial<
    Pick<
      Cell["contents"],
      "gridX" | "gridY" | "gridWidth" | "gridHeight" | "hidden"
    >
  > = {},
): Cell {
  return {
    id,
    projectId: "project",
    versionId: "working",
    createdAt: "2026-11-18T00:00:00.000Z",
    updatedAt: "2026-11-18T00:00:00.000Z",
    contents: {
      id,
      kind: "text",
      order: "a",
      label: null,
      hidden: false,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
      text: id,
      ...grid,
    },
  };
}

function sqlCell(id: string) {
  const cell = textCell(id);
  return {
    ...cell,
    contents: {
      ...cell.contents,
      kind: "sql",
      source: "SELECT 42",
      dataConnectionId: null,
      databaseSchema: null,
      resultVariable: null,
      outputResult: true,
    },
  } satisfies Cell;
}

function inputCell(id: string): Cell {
  const cell = textCell(id);
  return {
    ...cell,
    contents: {
      ...cell.contents,
      kind: "input",
      name: id,
      inputType: "TEXT_INPUT",
      defaultValueString: "",
    },
  };
}

function place(
  cellId: string,
  destination: Extract<AppPatch, { type: "place" }>["destination"],
  tabId = "tab-1",
): Extract<AppPatch, { type: "place" }> {
  return {
    type: "place",
    tabId,
    cellId,
    elementId: `${tabId}-${cellId}`,
    destination,
  };
}

function intervals(document: AppDocument, bookmark?: string) {
  return projectAppLayout(document, bookmark).rows.map(({ columns }) =>
    columns.map(({ left, right, elements }) => [
      left,
      right,
      ...elements.map(({ cellId }) => cellId),
    ]),
  );
}

describe("app layout document", () => {
  it("resolves name slugs and older ID bookmarks and falls back to the first tab", () => {
    const layout = applyAppPatches(
      emptyAppLayout(revision),
      [
        { type: "initialize" },
        {
          type: "tab-add",
          tabId: "details-id",
          name: "Monthly Details",
          afterTabId: "tab-1",
        },
      ],
      [],
    );
    expect(resolveAppTab(layout, "monthly-details").tabId).toBe("details-id");
    expect(resolveAppTab(layout, "details-id").tabId).toBe("details-id");
    expect(resolveAppTab(layout, "tab-1").tabId).toBe("tab-1");
    expect(resolveAppTab(layout, "unknown-slug").tabId).toBe("tab-1");
    expect(resolveAppTab(layout).tabId).toBe("tab-1");
  });

  it("keeps unopened drafts empty and initializes visible outputs in notebook order", () => {
    const code = textCell("python");
    const sourceOnly = sqlCell("source-only");
    const cells = [
      textCell("a"),
      sqlCell("sql"),
      {
        ...code,
        contents: {
          ...code.contents,
          kind: "code",
          language: "python",
          source: "42",
          resultVariable: null,
          outputResult: true,
        },
      } satisfies Cell,
      {
        ...sourceOnly,
        contents: { ...sourceOnly.contents, outputResult: false },
      },
      inputCell("input"),
      textCell("b"),
    ];
    const unopened = draftAppLayout(cells, revision);
    expect(unopened.initialized).toBe(false);
    expect(projectAppLayout(unopened).rows).toEqual([]);

    const defaults = applyAppPatches(
      unopened,
      [{ type: "initialize", includeExecutionOutputs: true }],
      [...cells, textCell("hidden", { hidden: true })],
    );
    expect(intervals(defaults)).toEqual([
      [[0, 120, "a"]],
      [[0, 120, "sql"]],
      [[0, 120, "python"]],
      [[0, 120, "input"]],
      [[0, 120, "b"]],
    ]);
    expect(projectAppLayout(defaults).rows[3]?.heightPx).toBe(70);
    expect(defaults.settings).toEqual({
      fullWidth: false,
      toc: true,
      metadata: true,
      theme: "viewer",
      scratchOnLoad: false,
      autoRefresh: true,
      autoRerun: true,
      staleAfter: { kind: "workspace-default" },
    });
    const a = projectAppLayout(defaults).rows[0];
    expect(a).toBeDefined();
    const withSql = applyAppPatches(
      defaults,
      [
        place("source-only", {
          rowId: "sql-row",
          columnId: "sql-column",
          left: 0,
          right: 120,
          afterRowId: a?.rowId ?? null,
        }),
      ],
      cells,
    );
    expect(intervals(withSql)).toEqual([
      [[0, 120, "a"]],
      [[0, 120, "source-only"]],
      [[0, 120, "sql"]],
      [[0, 120, "python"]],
      [[0, 120, "input"]],
      [[0, 120, "b"]],
    ]);
    expect(
      projectAppLayout(withSql).rows[1]?.columns[0]?.elements[0]?.display,
    ).toBe("output");
  });

  it("distributes seven columns using rounded cumulative edges and fills an equal row after a removal", () => {
    const cells = ["a", "b", "c", "d", "e", "f", "g"].map(sqlCell);
    const open = applyAppPatches(
      emptyAppLayout(revision),
      [{ type: "initialize" }],
      cells,
    );
    const places = cells.map(({ id }, index) =>
      place(id, {
        rowId: "row",
        columnId: `column-${id}`,
        left: index * 15,
        right: index * 15 + 10,
        ...(index === 0 ? { afterRowId: null } : {}),
      }),
    );
    const complete = applyAppPatches(
      open,
      [...places, { type: "row-distribute", tabId: "tab-1", rowId: "row" }],
      cells,
    );
    expect(intervals(complete)).toEqual([
      [
        [0, 17, "a"],
        [17, 34, "b"],
        [34, 51, "c"],
        [51, 69, "d"],
        [69, 86, "e"],
        [86, 103, "f"],
        [103, 120, "g"],
      ],
    ]);
    const removed = applyAppPatches(
      complete,
      [{ type: "remove", tabId: "tab-1", elementId: "tab-1-d" }],
      cells,
    );
    expect(intervals(removed)).toEqual([
      [
        [0, 20, "a"],
        [20, 40, "b"],
        [40, 60, "c"],
        [60, 80, "e"],
        [80, 100, "f"],
        [100, 120, "g"],
      ],
    ]);
  });

  it("snaps, clamps against neighbors, preserves custom gaps and removes empty rows", () => {
    const cells = ["a", "b", "below"].map(sqlCell);
    const initial = applyAppPatches(
      emptyAppLayout(revision),
      [
        { type: "initialize" },
        place("a", {
          rowId: "row",
          columnId: "left",
          left: 0,
          right: 50,
          afterRowId: null,
        }),
        place("b", { rowId: "row", columnId: "right", left: 60, right: 120 }),
        place("below", {
          rowId: "below-row",
          columnId: "below-column",
          left: 0,
          right: 120,
          afterRowId: "row",
        }),
      ],
      cells,
    );
    const resize = (document: AppDocument, right: number, heightPx: number) =>
      applyAppPatches(
        document,
        [
          {
            type: "resize",
            tabId: "tab-1",
            elementId: "tab-1-a",
            right,
            heightPx,
          },
        ],
        cells,
      );
    const snapped = resize(initial, 53, 300);
    expect(intervals(snapped)[0]).toEqual([
      [0, 55, "a"],
      [60, 120, "b"],
    ]);
    expect(
      projectAppLayout(snapped).rows.map(({ heightPx }) => heightPx),
    ).toEqual([300, 220]);
    const expanded = resize(snapped, 118, 350);
    expect(intervals(expanded)[0]).toEqual([
      [0, 115, "a"],
      [115, 120, "b"],
    ]);
    const shrunk = resize(expanded, 42, 250);
    expect(intervals(shrunk)[0]).toEqual([
      [0, 40, "a"],
      [115, 120, "b"],
    ]);

    const remaining = applyAppPatches(
      shrunk,
      [{ type: "remove", tabId: "tab-1", elementId: "tab-1-a" }],
      cells,
    );
    expect(intervals(remaining)).toEqual([
      [[115, 120, "b"]],
      [[0, 120, "below"]],
    ]);
    expect(projectAppLayout(remaining).rows[0]?.heightPx).toBe(220);
    const withoutRow = applyAppPatches(
      remaining,
      [{ type: "remove", tabId: "tab-1", elementId: "tab-1-b" }],
      cells,
    );
    expect(projectAppLayout(withoutRow).rows.map(({ rowId }) => rowId)).toEqual(
      ["below-row"],
    );
  });

  it("retains a renamed tab by ID, falls back after tab deletion and keeps one cell independent across tabs", () => {
    const cells = [sqlCell("sql")];
    const initial = applyAppPatches(
      emptyAppLayout(revision),
      [
        { type: "initialize" },
        { type: "tab-add", tabId: "details", name: "Details" },
        place("sql", {
          rowId: "overview-row",
          columnId: "overview-column",
          left: 0,
          right: 120,
          afterRowId: null,
        }),
        place(
          "sql",
          {
            rowId: "details-row",
            columnId: "details-column",
            left: 0,
            right: 120,
            afterRowId: null,
          },
          "details",
        ),
        {
          type: "display",
          tabId: "details",
          elementId: "details-sql",
          display: "both",
          showLabel: false,
        },
        {
          type: "resize",
          tabId: "details",
          elementId: "details-sql",
          heightPx: 320,
        },
      ],
      cells,
    );
    expect(projectAppLayout(initial, "Details").tab.tabId).toBe("details");
    const renamed = applyAppPatches(
      initial,
      [{ type: "tab-rename", tabId: "details", name: "More" }],
      cells,
    );
    expect(projectAppLayout(renamed, "details").tab).toEqual({
      tabId: "details",
      name: "More",
    });
    expect(
      projectAppLayout(renamed, "More").rows[0]?.columns[0]?.elements[0],
    ).toMatchObject({
      cellId: "sql",
      elementId: "details-sql",
      heightPx: 320,
      display: "both",
      showLabel: false,
    });
    expect(
      projectAppLayout(renamed, "tab-1").rows[0]?.columns[0]?.elements[0],
    ).toMatchObject({
      cellId: "sql",
      elementId: "tab-1-sql",
      heightPx: 220,
      display: "output",
      showLabel: true,
    });
    expect(
      projectAppLayout(renamed, "More", false).rows[0]?.columns[0]?.elements[0]
        ?.display,
    ).toBe("output");
    const removed = applyAppPatches(
      renamed,
      [{ type: "tab-remove", tabId: "details" }],
      cells,
    );
    expect(projectAppLayout(removed, "details").tab).toEqual({
      tabId: "tab-1",
      name: "Tab 1",
    });
    expect(intervals(removed)).toEqual([[[0, 120, "sql"]]]);
  });

  it("converts collision-resolved legacy rows, keeps compatible gaps and projects the same cold document", () => {
    const legacy = [
      textCell("a", { gridX: 0, gridY: 0, gridWidth: 4, gridHeight: 3 }),
      textCell("b", { gridX: 5, gridY: 0, gridWidth: 3, gridHeight: 1 }),
      textCell("collision", {
        gridX: 2,
        gridY: 0,
        gridWidth: 4,
        gridHeight: 2,
      }),
      textCell("staggered", {
        gridX: 8,
        gridY: 1,
        gridWidth: 2,
        gridHeight: 1,
      }),
      textCell("hidden", { hidden: true }),
    ];
    const canonical = legacyAppLayout(legacy, revision);
    expect(intervals(canonical)).toEqual([
      [
        [0, 40, "a"],
        [50, 80, "b"],
      ],
      [[80, 100, "staggered"]],
      [[20, 60, "collision"]],
    ]);
    expect(
      projectAppLayout(canonical).rows.map(({ heightPx }) => heightPx),
    ).toEqual([360, 120, 240]);
    const cold = appDocumentSchema.parse(JSON.parse(JSON.stringify(canonical)));
    expect(projectAppLayout(cold)).toEqual(projectAppLayout(canonical));
    expect(draftAppLayout(legacy, revision)).toEqual(cold);
  });

  it("rejects duplicate cell membership within a tab and mis-typed setting patches", () => {
    const cells = [sqlCell("sql")];
    const initial = applyAppPatches(
      emptyAppLayout(revision),
      [
        { type: "initialize" },
        place("sql", {
          rowId: "row",
          columnId: "column",
          left: 0,
          right: 120,
          afterRowId: null,
        }),
      ],
      cells,
    );
    expect(() =>
      applyAppPatches(
        initial,
        [
          {
            ...place("sql", {
              rowId: "row-2",
              columnId: "column-2",
              left: 0,
              right: 120,
              afterRowId: "row",
            }),
            elementId: "duplicate-placement",
          },
        ],
        cells,
      ),
    ).toThrow("Duplicate layout identity");
    expect(
      appPatchSchema.safeParse({
        type: "settings",
        key: "autoRerun",
        value: "viewer",
      }).success,
    ).toBe(false);
    const settings = appPatchSchema.parse({
      type: "settings",
      key: "autoRerun",
      value: false,
    });
    expect(applyAppPatches(initial, [settings], cells).settings.autoRerun).toBe(
      false,
    );
  });
});
