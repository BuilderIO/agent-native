import { z } from "zod";

import type { Cell } from "../app/lib/model/contracts.js";
import {
  DEFAULT_PROJECT_GRID_HEIGHT,
  projectGridLayout,
} from "../app/lib/model/project-layout.js";
import {
  notebookCellIdSchema,
  revisionSchema,
  type Revision,
} from "./notebook-snapshot-contract.js";

export const APP_LAYOUT_SPAN = 120;
export const APP_LAYOUT_SNAP = 5;
export const APP_LAYOUT_HEIGHT_STEP = 50;
export const APP_LAYOUT_MIN_HEIGHT = 20;
export const APP_LAYOUT_MAX_HEIGHT = 2_000;
export const DEFAULT_APP_STALE_HOURS = 24;

const MAX_TABS = 25;
const MAX_PLACEMENTS = 500;
const MAX_COLUMNS = APP_LAYOUT_SPAN / APP_LAYOUT_SNAP;
const LEGACY_GRID_ROW_HEIGHT = 120;
const id = z.string().min(1);
const tabName = z.string().trim().min(1).max(80);
const edge = z.number().int().min(0).max(APP_LAYOUT_SPAN);
const height = z
  .number()
  .int()
  .min(APP_LAYOUT_MIN_HEIGHT)
  .max(APP_LAYOUT_MAX_HEIGHT);
const display = z.enum(["source", "output", "both"]);
const elementSchema = z.strictObject({
  elementId: id,
  cellId: notebookCellIdSchema,
  heightPx: height,
  heightMode: z.enum(["content", "fixed"]).optional(),
  display,
  showLabel: z.boolean(),
});
const columnSchema = z.strictObject({
  columnId: id,
  left: edge,
  right: edge,
  elements: z.array(elementSchema).min(1).max(MAX_PLACEMENTS),
});
const rowSchema = z.strictObject({
  rowId: id,
  columns: z.array(columnSchema).min(1).max(MAX_COLUMNS),
});
const tabSchema = z.strictObject({
  tabId: id,
  name: tabName,
  rows: z.array(rowSchema).max(MAX_PLACEMENTS),
});
const settingsSchema = z.strictObject({
  fullWidth: z.boolean(),
  toc: z.boolean(),
  metadata: z.boolean(),
  theme: z.enum(["light", "dark", "viewer"]),
  scratchOnLoad: z.boolean(),
  autoRefresh: z.boolean(),
  autoRerun: z.boolean(),
  staleAfter: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("workspace-default") }),
    z.strictObject({
      kind: z.literal("hours"),
      value: z.number().int().min(1).max(8760),
    }),
  ]),
});
const documentSchema = z.strictObject({
  version: z.literal(2),
  initialized: z.boolean(),
  revision: revisionSchema,
  tabs: z.array(tabSchema).min(1).max(MAX_TABS),
  settings: settingsSchema,
});

export type AppDocument = z.infer<typeof documentSchema>;
type AppTab = z.infer<typeof tabSchema>;
type AppRow = z.infer<typeof rowSchema>;
type AppColumn = z.infer<typeof columnSchema>;
type AppElement = z.infer<typeof elementSchema>;

export const appDocumentSchema = documentSchema.superRefine(
  (document, issues) => {
    const ids = new Set<string>();
    const names = new Set<string>();
    let placements = 0;
    const unique = (value: string, set = ids) => {
      if (set.has(value))
        issues.addIssue({
          code: "custom",
          message: "Duplicate layout identity",
        });
      set.add(value);
    };
    for (const tab of document.tabs) {
      unique(tab.tabId);
      unique(tab.name.toLowerCase(), names);
      const cellIds = new Set<string>();
      for (const row of tab.rows) {
        unique(row.rowId);
        let end = 0;
        for (const column of row.columns) {
          unique(column.columnId);
          if (column.left < end || column.right - column.left < APP_LAYOUT_SNAP)
            issues.addIssue({
              code: "custom",
              message: "Invalid layout interval",
            });
          end = column.right;
          for (const element of column.elements) {
            unique(element.elementId);
            unique(element.cellId, cellIds);
            placements++;
          }
        }
      }
    }
    if (
      placements > MAX_PLACEMENTS ||
      (!document.initialized && placements > 0)
    )
      issues.addIssue({
        code: "custom",
        message: "Invalid layout placement count",
      });
  },
);

const destinationSchema = z.strictObject({
  rowId: id,
  columnId: id,
  left: edge,
  right: edge,
  afterRowId: id.nullable().optional(),
});
export const appPlaceRequestSchema = z.strictObject({
  tabId: id,
  elementId: id,
  cellId: notebookCellIdSchema,
  destination: destinationSchema,
});
type AppDestination = z.infer<typeof destinationSchema>;

const settingsPatch = { type: z.literal("settings") };
export const appPatchSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("initialize"),
    includeExecutionOutputs: z.literal(true).optional(),
  }),
  z.strictObject({
    type: z.literal("tab-add"),
    tabId: id,
    name: tabName,
    afterTabId: id.optional(),
  }),
  z.strictObject({
    type: z.literal("tab-duplicate"),
    sourceTabId: id,
    tabId: id,
    name: tabName,
  }),
  z.strictObject({ type: z.literal("tab-rename"), tabId: id, name: tabName }),
  z.strictObject({
    type: z.literal("tab-move"),
    tabId: id,
    afterTabId: id.nullable(),
  }),
  z.strictObject({ type: z.literal("tab-remove"), tabId: id }),
  appPlaceRequestSchema.extend({ type: z.literal("place") }),
  z.strictObject({ type: z.literal("remove"), tabId: id, elementId: id }),
  z.strictObject({
    type: z.literal("move"),
    elementId: id,
    fromTabId: id,
    toTabId: id,
    destination: destinationSchema,
  }),
  z.strictObject({
    type: z.literal("resize"),
    tabId: id,
    elementId: id,
    left: edge.optional(),
    right: edge.optional(),
    heightPx: height.optional(),
  }),
  z.strictObject({
    type: z.literal("display"),
    tabId: id,
    elementId: id,
    display,
    showLabel: z.boolean(),
  }),
  z.strictObject({
    type: z.literal("row-move"),
    tabId: id,
    rowId: id,
    afterRowId: id.nullable(),
  }),
  z.strictObject({ type: z.literal("row-distribute"), tabId: id, rowId: id }),
  z.strictObject({
    type: z.literal("reset"),
    tabId: id.optional(),
    preset: z.enum(["empty", "default"]),
  }),
  z.discriminatedUnion("key", [
    z.strictObject({
      ...settingsPatch,
      key: z.literal("fullWidth"),
      value: settingsSchema.shape.fullWidth,
    }),
    z.strictObject({
      ...settingsPatch,
      key: z.literal("toc"),
      value: settingsSchema.shape.toc,
    }),
    z.strictObject({
      ...settingsPatch,
      key: z.literal("metadata"),
      value: settingsSchema.shape.metadata,
    }),
    z.strictObject({
      ...settingsPatch,
      key: z.literal("theme"),
      value: settingsSchema.shape.theme,
    }),
    z.strictObject({
      ...settingsPatch,
      key: z.literal("scratchOnLoad"),
      value: settingsSchema.shape.scratchOnLoad,
    }),
    z.strictObject({
      ...settingsPatch,
      key: z.literal("autoRefresh"),
      value: settingsSchema.shape.autoRefresh,
    }),
    z.strictObject({
      ...settingsPatch,
      key: z.literal("autoRerun"),
      value: settingsSchema.shape.autoRerun,
    }),
    z.strictObject({
      ...settingsPatch,
      key: z.literal("staleAfter"),
      value: settingsSchema.shape.staleAfter,
    }),
  ]),
]);
export type AppPatch = z.input<typeof appPatchSchema>;

export class AppLayoutError extends Error {
  readonly code = "app_layout_invalid";
  readonly statusCode = 422;
}

export function emptyAppLayout(revision: Revision): AppDocument {
  return {
    version: 2,
    initialized: false,
    revision,
    tabs: [{ tabId: "tab-1", name: "Tab 1", rows: [] }],
    settings: {
      fullWidth: false,
      toc: true,
      metadata: true,
      theme: "viewer",
      scratchOnLoad: false,
      autoRefresh: true,
      autoRerun: true,
      staleAfter: { kind: "workspace-default" },
    },
  };
}

const byInterval = (a: AppColumn, b: AppColumn) => a.left - b.left;
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function snapAppPosition(position: number): number {
  return clamp(
    Math.round(position / APP_LAYOUT_SNAP) * APP_LAYOUT_SNAP,
    0,
    APP_LAYOUT_SPAN,
  );
}

function defaultElementHeight(cell: Cell) {
  const { contents } = cell;
  if (contents.kind === "collapsible") return 48;
  if (contents.kind === "input") return 70;
  if (contents.kind === "metric" && contents.metricConfig) return 160;
  return 220;
}

export function publishedElementMinHeight(element: AppElement, cell: Cell) {
  const defaultHeight =
    element.elementId === `legacy-element:${cell.id}`
      ? DEFAULT_PROJECT_GRID_HEIGHT * LEGACY_GRID_ROW_HEIGHT
      : defaultElementHeight(cell);
  const heightMode =
    element.heightMode ??
    (element.heightPx === defaultHeight ? "content" : "fixed");
  return heightMode === "fixed" ? element.heightPx : undefined;
}

function defaultElement(elementId: string, cell: Cell): AppElement {
  return {
    elementId,
    cellId: notebookCellIdSchema.parse(cell.id),
    heightPx: defaultElementHeight(cell),
    heightMode: "content",
    display: "output",
    showLabel: true,
  };
}

function firstTab(document: AppDocument) {
  return requireLayoutItem(document.tabs[0], "Layout has no tabs");
}

export function isDefaultAppCell(cell: Cell, includeExecutionOutputs: boolean) {
  if (cell.contents.hidden) return false;
  if (cell.contents.kind === "sql" || cell.contents.kind === "code")
    return includeExecutionOutputs && cell.contents.outputResult;
  if (cell.contents.kind === "metric") return !!cell.contents.metricConfig;
  return [
    "text",
    "markdown",
    "input",
    "chart",
    "display-table",
    "pivot",
    "component-import",
  ].includes(cell.contents.kind);
}

function defaultRows(
  tabId: string,
  cells: readonly Cell[],
  includeExecutionOutputs: boolean,
): AppRow[] {
  const included = cells.filter((cell) =>
    isDefaultAppCell(cell, includeExecutionOutputs),
  );
  return included.map((cell) => {
    const key = JSON.stringify([tabId, cell.id]);
    return {
      rowId: `default-row:${key}`,
      columns: [
        {
          columnId: `default-column:${key}`,
          left: 0,
          right: APP_LAYOUT_SPAN,
          elements: [defaultElement(`default-element:${key}`, cell)],
        },
      ],
    };
  });
}

export function legacyAppLayout(
  cells: readonly Cell[],
  revision: Revision,
): AppDocument {
  const document = emptyAppLayout(revision);
  document.initialized = true;
  const rows = new Map<number, AppRow>();
  const grid = projectGridLayout(cells.filter((cell) => !cell.contents.hidden));
  for (const { cell, placement } of grid.sort(
    (a, b) => a.placement.gridY - b.placement.gridY,
  )) {
    const { gridX, gridY, gridWidth, gridHeight } = placement;
    let row = rows.get(gridY);
    if (!row) {
      row = { rowId: `legacy-row:${gridY}`, columns: [] };
      rows.set(gridY, row);
    }
    row.columns.push({
      columnId: `legacy-column:${cell.id}`,
      left: gridX * 10,
      right: (gridX + gridWidth) * 10,
      elements: [
        {
          ...defaultElement(`legacy-element:${cell.id}`, cell),
          heightPx: gridHeight * LEGACY_GRID_ROW_HEIGHT,
          heightMode:
            gridHeight === DEFAULT_PROJECT_GRID_HEIGHT ? "content" : "fixed",
        },
      ],
    });
  }
  firstTab(document).rows = [...rows.values()];
  for (const row of firstTab(document).rows) row.columns.sort(byInterval);
  return checkedDocument(document);
}

export function draftAppLayout(
  cells: readonly Cell[],
  revision: Revision,
): AppDocument {
  const hasLegacyLayout = cells.some(
    ({ contents }) =>
      contents.hidden ||
      contents.gridX !== null ||
      contents.gridY !== null ||
      contents.gridWidth !== null ||
      contents.gridHeight !== null,
  );
  return hasLegacyLayout
    ? legacyAppLayout(cells, revision)
    : emptyAppLayout(revision);
}

export function appTabSlugs(document: AppDocument) {
  const tabIds = new Set(document.tabs.map(({ tabId }) => tabId));
  const used = new Set<string>();
  const slugs = new Map<string, string>();
  for (const { tabId, name } of document.tabs) {
    const base =
      name
        .toLowerCase()
        .replace(/[^\p{L}\p{M}\p{N}_ -]/gu, "")
        .replaceAll(" ", "-") || tabId;
    let slug = base;
    for (
      let suffix = 1;
      used.has(slug) || (slug !== tabId && tabIds.has(slug));
      suffix++
    ) {
      slug = `${base}-${suffix}`;
    }
    used.add(slug);
    slugs.set(tabId, slug);
  }
  return slugs;
}

export function appTabBookmark(
  document: AppDocument,
  tabId: string,
  slugs?: ReadonlyMap<string, string>,
) {
  if (tabId === firstTab(document).tabId) return null;
  return (slugs ?? appTabSlugs(document)).get(tabId) ?? null;
}

export function resolveAppTab(
  document: AppDocument,
  bookmark?: string | null,
  slugs?: ReadonlyMap<string, string>,
) {
  if (!bookmark) return firstTab(document);
  const byId = document.tabs.find((tab) => tab.tabId === bookmark);
  if (byId) return byId;
  const bookmarks = slugs ?? appTabSlugs(document);
  return (
    document.tabs.find(({ tabId }) => bookmarks.get(tabId) === bookmark) ??
    document.tabs.find(
      ({ name }) => name.toLowerCase() === bookmark.toLowerCase(),
    ) ??
    firstTab(document)
  );
}

export function projectAppLayout(
  document: AppDocument,
  bookmark?: string | null,
  canViewSource = true,
) {
  const { tabId, name, rows } = resolveAppTab(document, bookmark);
  return {
    tab: { tabId, name },
    rows: rows.flatMap((row) => {
      const columns = row.columns.flatMap((column) => {
        if (canViewSource) return [column];
        const elements = column.elements
          .filter((element) => element.display !== "source")
          .map((element) => ({ ...element, display: "output" as const }));
        return elements.length > 0 ? [{ ...column, elements }] : [];
      });
      if (columns.length === 0) return [];
      const heightPx = Math.max(
        ...columns.map((column) =>
          column.elements.reduce(
            (total, element) => total + element.heightPx,
            0,
          ),
        ),
      );
      return [{ rowId: row.rowId, columns, heightPx }];
    }),
  };
}

function requireLayoutItem<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new AppLayoutError(message);
  return value;
}

function checkedDocument(document: AppDocument): AppDocument {
  const checked = appDocumentSchema.safeParse(document);
  if (!checked.success)
    throw new AppLayoutError(checked.error.issues[0]?.message);
  return checked.data;
}

function indexAfter<T>(
  items: readonly T[],
  anchor: string | null,
  getId: (item: T) => string,
) {
  if (anchor === null) return 0;
  const index = items.findIndex((item) => getId(item) === anchor);
  if (index < 0) throw new AppLayoutError("Layout anchor is absent");
  return index + 1;
}

function moveAfter<T>(
  items: T[],
  item: T,
  anchor: string | null,
  getId: (item: T) => string,
) {
  if (getId(item) === anchor) return;
  items.splice(items.indexOf(item), 1);
  items.splice(indexAfter(items, anchor, getId), 0, item);
}

const partitionEdge = (index: number, count: number) =>
  Math.round((APP_LAYOUT_SPAN * index) / count);

function distributeRow(row: AppRow) {
  if (row.columns.length > MAX_COLUMNS)
    throw new AppLayoutError("App row is full");
  row.columns.forEach((column, index) => {
    column.left = partitionEdge(index, row.columns.length);
    column.right = partitionEdge(index + 1, row.columns.length);
  });
}

export function isAppRowDistributed(row: AppRow) {
  return row.columns.every(
    (column, index) =>
      column.left === partitionEdge(index, row.columns.length) &&
      column.right === partitionEdge(index + 1, row.columns.length),
  );
}

function findElement(tab: AppTab, elementId: string) {
  for (const row of tab.rows) {
    for (const column of row.columns) {
      const element = column.elements.find(
        (candidate) => candidate.elementId === elementId,
      );
      if (element) return { row, column, element };
    }
  }
  throw new AppLayoutError("App element is absent");
}

function takeElement(tab: AppTab, elementId: string, keepRow: boolean) {
  const { row, column, element } = findElement(tab, elementId);
  column.elements.splice(column.elements.indexOf(element), 1);
  if (column.elements.length > 0) return element;
  const distributed = isAppRowDistributed(row);
  row.columns.splice(row.columns.indexOf(column), 1);
  if (keepRow) return element;
  if (row.columns.length === 0) tab.rows.splice(tab.rows.indexOf(row), 1);
  else if (distributed) distributeRow(row);
  return element;
}

function placeElement(
  tab: AppTab,
  element: AppElement,
  destination: AppDestination,
) {
  const { rowId, columnId, left, right, afterRowId } = destination;
  if (right - left < APP_LAYOUT_SNAP)
    throw new AppLayoutError("App interval is too narrow");
  const column = { columnId, left, right, elements: [element] };
  if (afterRowId !== undefined) {
    const index = indexAfter(tab.rows, afterRowId, (row) => row.rowId);
    tab.rows.splice(index, 0, { rowId, columns: [column] });
    return;
  }
  const row = requireLayoutItem(
    tab.rows.find((candidate) => candidate.rowId === rowId),
    "App row is absent",
  );
  const overlap = row.columns.some(
    (existing) => existing.left < right && left < existing.right,
  );
  row.columns.push(column);
  row.columns.sort(byInterval);
  if (overlap) distributeRow(row);
}

function resizeElement(
  tab: AppTab,
  patch: Extract<AppPatch, { type: "resize" }>,
) {
  const { row, column, element } = findElement(tab, patch.elementId);
  if (patch.heightPx !== undefined) {
    element.heightPx = patch.heightPx;
    element.heightMode = "fixed";
  }
  const index = row.columns.indexOf(column);
  const before = row.columns[index - 1];
  const after = row.columns[index + 1];
  const minLeft = before ? before.left + APP_LAYOUT_SNAP : 0;
  const maxRight = after ? after.right - APP_LAYOUT_SNAP : APP_LAYOUT_SPAN;
  if (patch.right !== undefined) {
    const left = patch.left === undefined ? column.left : minLeft;
    column.right = clamp(
      snapAppPosition(patch.right),
      left + APP_LAYOUT_SNAP,
      maxRight,
    );
  }
  if (patch.left !== undefined)
    column.left = clamp(
      snapAppPosition(patch.left),
      minLeft,
      column.right - APP_LAYOUT_SNAP,
    );
  if (before) before.right = Math.min(before.right, column.left);
  if (after) after.left = Math.max(after.left, column.right);
}

export function pruneAppLayout(
  document: AppDocument,
  cells: readonly Cell[],
): AppDocument {
  const ids = new Set(cells.map((cell) => cell.id));
  const missing = document.tabs.flatMap((tab) =>
    tab.rows.flatMap((row) =>
      row.columns.flatMap((column) =>
        column.elements
          .filter((element) => !ids.has(element.cellId))
          .map(({ elementId }) => ({
            type: "remove" as const,
            tabId: tab.tabId,
            elementId,
          })),
      ),
    ),
  );
  return missing.length > 0
    ? applyAppPatches(document, missing, cells)
    : document;
}

export function applyAppPatches(
  document: AppDocument,
  patches: readonly AppPatch[],
  cells: readonly Cell[],
  insertedCellIds: readonly string[] = [],
): AppDocument {
  const draft = structuredClone(document);
  const byCellId = new Map(cells.map((cell) => [cell.id, cell]));
  const pendingInserts = new Set(insertedCellIds);
  const defaults = (tabId: string, includeExecutionOutputs = false) =>
    defaultRows(
      tabId,
      cells.filter((cell) => !pendingInserts.has(cell.id)),
      includeExecutionOutputs,
    );
  const tab = (id: string) =>
    requireLayoutItem(
      draft.tabs.find((candidate) => candidate.tabId === id),
      "App tab is absent",
    );
  const row = (tabId: string, id: string) =>
    requireLayoutItem(
      tab(tabId).rows.find((candidate) => candidate.rowId === id),
      "App row is absent",
    );

  for (const patch of patches) {
    switch (patch.type) {
      case "initialize":
        if (!draft.initialized)
          firstTab(draft).rows = defaults(
            firstTab(draft).tabId,
            patch.includeExecutionOutputs === true,
          );
        draft.initialized = true;
        break;
      case "tab-add": {
        const index =
          patch.afterTabId === undefined
            ? draft.tabs.length
            : indexAfter(draft.tabs, patch.afterTabId, (value) => value.tabId);
        draft.tabs.splice(index, 0, {
          tabId: patch.tabId,
          name: patch.name,
          rows: [],
        });
        break;
      }
      case "tab-duplicate": {
        const source = tab(patch.sourceTabId);
        const { tabId, name } = patch;
        const rows = source.rows.map((row, rowIndex) => {
          const rowId = `${tabId}:row:${rowIndex}`;
          return {
            rowId,
            columns: row.columns.map((column, columnIndex) => {
              const columnId = `${rowId}:column:${columnIndex}`;
              return {
                ...column,
                columnId,
                elements: column.elements.map((element, elementIndex) => ({
                  ...element,
                  elementId: `${columnId}:element:${elementIndex}`,
                })),
              };
            }),
          };
        });
        draft.tabs.splice(draft.tabs.indexOf(source) + 1, 0, {
          tabId,
          name,
          rows,
        });
        break;
      }
      case "tab-rename":
        tab(patch.tabId).name = patch.name;
        break;
      case "tab-move":
        moveAfter(
          draft.tabs,
          tab(patch.tabId),
          patch.afterTabId,
          (value) => value.tabId,
        );
        break;
      case "tab-remove":
        draft.tabs.splice(draft.tabs.indexOf(tab(patch.tabId)), 1);
        break;
      case "place": {
        const cell = requireLayoutItem(
          byCellId.get(patch.cellId),
          "App cell is absent",
        );
        placeElement(
          tab(patch.tabId),
          defaultElement(patch.elementId, cell),
          patch.destination,
        );
        pendingInserts.delete(cell.id);
        break;
      }
      case "remove":
        takeElement(tab(patch.tabId), patch.elementId, false);
        break;
      case "move": {
        const source = tab(patch.fromTabId);
        const keepRow =
          patch.fromTabId === patch.toTabId &&
          patch.destination.afterRowId === undefined &&
          findElement(source, patch.elementId).row.rowId ===
            patch.destination.rowId;
        const element = takeElement(source, patch.elementId, keepRow);
        placeElement(tab(patch.toTabId), element, patch.destination);
        break;
      }
      case "resize":
        resizeElement(tab(patch.tabId), patch);
        break;
      case "display": {
        const { element } = findElement(tab(patch.tabId), patch.elementId);
        element.display = patch.display;
        element.showLabel = patch.showLabel;
        break;
      }
      case "row-move":
        moveAfter(
          tab(patch.tabId).rows,
          row(patch.tabId, patch.rowId),
          patch.afterRowId,
          (value) => value.rowId,
        );
        break;
      case "row-distribute":
        distributeRow(row(patch.tabId, patch.rowId));
        break;
      case "reset": {
        const selected =
          patch.tabId === undefined ? firstTab(draft) : tab(patch.tabId);
        const reset = patch.tabId === undefined ? draft.tabs : [selected];
        for (const target of reset)
          target.rows =
            patch.preset === "default" && target === selected
              ? defaults(target.tabId)
              : [];
        draft.initialized = true;
        break;
      }
      case "settings":
        draft.settings = { ...draft.settings, [patch.key]: patch.value };
        break;
    }
  }

  for (const target of draft.tabs) {
    for (const row of target.rows) {
      for (const column of row.columns) {
        for (const element of column.elements) {
          const cell = requireLayoutItem(
            byCellId.get(element.cellId),
            "App cell is absent",
          );
          if (
            element.display !== "output" &&
            cell.contents.kind !== "sql" &&
            cell.contents.kind !== "code"
          )
            throw new AppLayoutError("App cell has no source display");
        }
      }
    }
  }
  return checkedDocument(draft);
}
