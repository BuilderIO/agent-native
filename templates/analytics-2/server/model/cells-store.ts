import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { fail } from "@agent-native/core/action";
import { and, eq } from "@agent-native/core/db/schema";
import { nameTaken } from "@agent-native/core/free-name/server";

import { notebookMessages } from "../../app/i18n/messages/notebook.js";
import type {
  Cell,
  CellContents,
  CellDraft,
} from "../../app/lib/model/contracts.js";
import {
  cellContentsSchema,
  cellSchema,
} from "../../app/lib/model/contracts.js";
import { compareOrder } from "../../app/lib/model/order.js";
import { notebookCellSymbol } from "../../shared/notebook-cell-edits.js";
import type { NotebookCell } from "../../shared/notebook-operations.js";
import { notebookInsertionGap } from "../../shared/notebook-sections.js";
import { notebookCellIdSchema } from "../../shared/notebook-snapshot-contract.js";
import { isSqlInputName } from "../../shared/sql-input-name.js";
import { getDb, schema } from "../db/index.js";
import { nowIso } from "./clock.js";
import { ensureAnalyticsDatabase } from "./database.js";
import { newId } from "./ids.js";
import { decodeJsonColumn } from "./json-column.js";
import type { NotebookWrite } from "./notebook-operations/commands.js";
import {
  applyLegacyNotebookOperation,
  legacyGap,
  readLegacyNotebook,
  requireAppliedNotebookOperation,
  requireLegacyCell,
  type LegacyNotebook,
} from "./notebook-operations/legacy.js";
import {
  notebookBusy,
  writeNotebookVersionCells,
} from "./notebook-operations/store.js";
import {
  assertAuthorizedProject,
  assertEditableProject,
  assertReadableProject,
  ProjectAccessError,
} from "./project-access.js";
import {
  type Queryable,
  type WorkspaceScope,
  requireWorkspaceScope,
} from "./scope.js";

const { cells } = schema;

type CellRow = typeof cells.$inferSelect;

export type CellScope = WorkspaceScope & { projectId: string };

function toCell(row: CellRow): Cell {
  // Unreadable stored contents throw a typed StoredDataError; they are never
  // dropped from the page.
  const contents = decodeJsonColumn(row.contents, cellContentsSchema);
  if (contents === null) {
    throw new Error("A stored cell is missing its contents.");
  }
  return cellSchema.parse({
    id: row.id,
    projectId: row.projectId,
    versionId: row.versionId,
    contents,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

/**
 * Cells of one version, in display order. The parent project is authorised
 * against the request scope first, so a guessed project or cell id from
 * another account or organisation cannot be read.
 */
export async function readCells(
  scopeInput: Partial<WorkspaceScope> | null | undefined,
  projectId: string,
  versionId: string,
  db: Queryable = getDb(),
): Promise<Cell[]> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(scopeInput);
  await assertEditableProject(scope, projectId, db);
  return readCellRows(projectId, versionId, db);
}

export async function readReadableCells(
  scopeInput: Partial<WorkspaceScope> | null | undefined,
  projectId: string,
  versionId: string,
  db: Queryable = getDb(),
): Promise<Cell[]> {
  const scope = requireWorkspaceScope(scopeInput);
  await assertReadableProject(scope, projectId, db);
  return readCellRows(projectId, versionId, db);
}

async function readCellRows(
  projectId: string,
  versionId: string,
  db: Queryable,
): Promise<Cell[]> {
  const rows = await db
    .select()
    .from(cells)
    .where(and(eq(cells.projectId, projectId), eq(cells.versionId, versionId)));
  return rows
    .map(toCell)
    .sort((a, b) => compareOrder(a.contents.order, b.contents.order));
}

export type InsertCellRowsInput = {
  scope: WorkspaceScope;
  projectId: string;
  versionId: string;
  cells: CellDraft[];
  /** Timestamp for every row; defaults to the clock. */
  at?: string;
  /** Starting position when the cells carry no order of their own. */
  afterOrder?: string | null;
};

/**
 * Writes cells in the order given. A cell that already carries an order keeps
 * it; anything else is placed after the previous cell, so a caller can insert
 * a list of new cells without computing keys itself.
 *
 * The caller passes the transaction handle for a compound write, so every row
 * is written through the same transaction as its project/version.
 */
export async function insertCellRows(
  input: InsertCellRowsInput,
  db: Queryable = getDb(),
): Promise<Cell[]> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(input.scope);
  const project = await assertAuthorizedProject(scope, input.projectId, db);
  if (input.versionId === project.workingVersionId)
    fail("The project draft changed. Refresh and try again.", {
      statusCode: 409,
      errorCode: "project_draft_changed",
    });
  return writeNotebookVersionCells(
    db,
    input,
    input.cells,
    input.at ?? nowIso(),
    input.afterOrder,
  );
}

async function isEditableVersion(
  scope: WorkspaceScope,
  projectId: string,
  versionId: string,
): Promise<boolean> {
  await ensureAnalyticsDatabase();
  const project = await assertEditableProject(scope, projectId);
  if (project.workingVersionId === versionId) return true;
  const [version] = await getDb()
    .select({ kind: schema.projectVersions.kind })
    .from(schema.projectVersions)
    .where(
      and(
        eq(schema.projectVersions.projectId, projectId),
        eq(schema.projectVersions.id, versionId),
      ),
    )
    .limit(1);
  if (!version)
    throw new ProjectAccessError(
      "That project version is not in this workspace.",
    );
  if (version.kind === "published")
    fail("Published project versions cannot be edited.", {
      statusCode: 409,
      errorCode: "project_version_read_only",
    });
  return false;
}

export type AddCellInput = CellScope & {
  versionId: string;
  contents:
    | CellDraft
    | ((existing: readonly Cell[]) => CellDraft | Promise<CellDraft>);
  /** Place after this cell; without it the cell goes last. */
  afterCellId?: string | null;
  beforeCellId?: string;
  parentSectionId?: string | null;
  restore?: boolean;
  outputUndoToken?: string;
  originId?: string;
};

function inputNames(existing: readonly Cell[]): Set<string> {
  const names = new Set<string>();
  for (const { contents } of existing) {
    if (contents.kind === "input") names.add(contents.name);
  }
  return names;
}

export function nextInputName(existing: readonly Cell[]): string {
  const names = inputNames(existing);
  let ordinal = 1;
  while (names.has(`input_${ordinal}`)) ordinal++;
  return `input_${ordinal}`;
}

function assertAvailableInputName(name: string, existing: readonly Cell[]) {
  if (!isSqlInputName(name))
    fail(
      "Use letters, digits, and underscores, starting with a letter or underscore.",
      {
        statusCode: 422,
        errorCode: "project_input_name_invalid",
      },
    );
  if (inputNames(existing).has(name))
    throw nameTaken("input", name, nextInputName(existing));
}

async function cellDraftFor(input: CellScope & { versionId: string }) {
  const scope = requireWorkspaceScope(input);
  const draft = await readCellDraft(scope, input);
  if (!draft)
    fail("The project draft changed. Refresh and try again.", {
      statusCode: 409,
      errorCode: "project_draft_changed",
    });
  return draft;
}

async function readCellDraft(
  scope: WorkspaceScope,
  input: CellScope & { versionId: string },
) {
  if (!(await isEditableVersion(scope, input.projectId, input.versionId)))
    return null;
  const draft = await readLegacyNotebook(scope, input.projectId);
  return draft.project.workingVersionId === input.versionId ? draft : null;
}

export async function addCell(
  input: AddCellInput,
  initial?: LegacyNotebook,
): Promise<Cell> {
  const scope = requireWorkspaceScope(input);
  let draft = initial ?? (await cellDraftFor(input));
  const anchorId = input.beforeCellId ?? input.afterCellId;
  for (let attempt = 0; attempt < 8; attempt++) {
    const existing = draft.cells;
    const contents =
      typeof input.contents === "function"
        ? await input.contents(existing)
        : input.contents;
    if (contents.kind === "input")
      assertAvailableInputName(contents.name, existing);
    if (anchorId != null) requireLegacyCell(draft, anchorId);
    const target = notebookInsertionGap(existing, {
      ...input,
      parentSectionId:
        input.parentSectionId === undefined && input.restore
          ? contents.parentSectionId
          : input.parentSectionId,
    });
    if (!target)
      fail("The notebook insertion point changed. Refresh and try again.", {
        statusCode: 409,
        errorCode: "notebook_conflict",
      });
    const id = contents.id || newId("cel");
    const receipt = await applyLegacyNotebookOperation(
      scope,
      draft.notebook,
      [
        {
          type: "insert-legacy",
          cellId: id,
          ...target,
          expectedOrderRevision: draft.notebook.resources.orderRevision,
          contents,
          restore: input.restore === true,
          ...(input.outputUndoToken === undefined
            ? {}
            : { outputUndoToken: input.outputUndoToken }),
        },
      ],
      undefined,
      input.originId,
    );
    if (
      receipt.status === "conflict" &&
      receipt.reason === "order_changed" &&
      anchorId == null &&
      input.restore !== true
    ) {
      draft = await cellDraftFor(input);
      continue;
    }
    const accepted = requireAppliedNotebookOperation(receipt);
    const created =
      accepted.status === "applied"
        ? accepted.delta.cells.find((cell) => cell.id === id)
        : undefined;
    if (!created) throw new Error("The cell could not be created.");
    return created;
  }
  return notebookBusy();
}

export type UpdateCellInput = CellScope & {
  versionId: string;
  cellId: string;
  contents: CellContents;
  expectedUpdatedAt?: string;
  inputOptionsResultId?: string;
  suppressReactiveRun?: boolean;
  originId?: string;
};

function cellWrite(
  before: NotebookCell,
  update: CellContents,
  optionsResultId?: string,
): NotebookWrite {
  const current = before.contents;
  const cellId = notebookCellIdSchema.parse(before.id);
  const guard = { cellId, expectedRevision: before.revision };
  if (
    current.label !== update.label &&
    isDeepStrictEqual({ ...current, label: update.label }, update)
  )
    return {
      type: "set-label",
      cellId,
      expectedLabelRevision: before.labelRevision,
      label: update.label,
    };
  if (
    (current.kind === "sql" || current.kind === "code") &&
    (update.kind === "sql" || update.kind === "code") &&
    current.source !== update.source &&
    isDeepStrictEqual({ ...current, source: update.source }, update)
  )
    return { type: "set-code", ...guard, source: update.source };
  if (current.kind === "sql" && update.kind === "sql") {
    const { connectionMode: _previousMode, ...previous } = current;
    const { dataConnectionId, connectionMode, databaseSchema } = update;
    if (
      isDeepStrictEqual(
        {
          ...previous,
          dataConnectionId,
          databaseSchema,
          ...(connectionMode === undefined ? {} : { connectionMode }),
        },
        update,
      )
    )
      return {
        type: "set-source",
        ...guard,
        dataConnectionId,
        databaseSchema,
        connectionMode:
          connectionMode === "dataframes" ? "dataframes" : "warehouse",
      };
  }
  if (
    current.kind === "text" &&
    update.kind === "text" &&
    isDeepStrictEqual({ ...current, text: update.text }, update)
  )
    return { type: "set-text", ...guard, text: update.text };
  if (
    current.kind === "markdown" &&
    update.kind === "markdown" &&
    isDeepStrictEqual({ ...current, markdown: update.markdown }, update)
  )
    return { type: "set-text", ...guard, text: update.markdown };
  if (
    current.kind === "input" &&
    update.kind === "input" &&
    isDeepStrictEqual(
      { ...current, defaultValueString: update.defaultValueString },
      update,
    )
  )
    return {
      type: "set-input-default",
      ...guard,
      defaultValueString: update.defaultValueString,
      ...(optionsResultId === undefined ? {} : { optionsResultId }),
    };
  return {
    type: "save-legacy",
    cellId,
    expectedUpdatedAt: before.updatedAt,
    contents: update,
    ...(optionsResultId === undefined ? {} : { optionsResultId }),
  };
}

export async function updateCell(
  input: UpdateCellInput,
  initial?: LegacyNotebook,
): Promise<Cell | null> {
  const scope = requireWorkspaceScope(input);
  const draft = initial ?? (await readCellDraft(scope, input));
  if (!draft) return null;
  const before = requireLegacyCell(draft, input.cellId);
  if (
    input.expectedUpdatedAt !== undefined &&
    before.updatedAt !== input.expectedUpdatedAt
  )
    return null;
  const contents = cellContentsSchema.parse(input.contents);
  if (
    contents.kind === "input" &&
    before.contents.kind === "input" &&
    contents.name !== before.contents.name
  )
    assertAvailableInputName(
      contents.name,
      draft.cells.filter((cell) => cell.id !== before.id),
    );
  if (
    contents.kind === "sql" &&
    before.contents.kind === "sql" &&
    contents.resultVariable !== null &&
    contents.resultVariable !== before.contents.resultVariable
  ) {
    const name = contents.resultVariable;
    if (!isSqlInputName(name))
      fail("Invalid variable name", {
        statusCode: 422,
        errorCode: "project_result_variable_invalid",
      });
    if (
      draft.cells.some(
        (cell) =>
          cell.id !== before.id &&
          notebookCellSymbol(cell.contents)?.toLowerCase() ===
            name.toLowerCase(),
      )
    )
      fail("Variable name is already in use.", {
        statusCode: 409,
        errorCode: "project_result_variable_taken",
      });
  }
  const receipt = await applyLegacyNotebookOperation(
    scope,
    draft.notebook,
    [cellWrite(before, contents, input.inputOptionsResultId)],
    input.suppressReactiveRun,
    input.originId,
  );
  if (receipt.status === "conflict") {
    if (receipt.reason === "layout_changed")
      fail(notebookMessages.notebook.saveFailed, {
        statusCode: 409,
        errorCode: "layout_changed",
      });
    return null;
  }
  if (receipt.status === "no_change") return before;
  const updated = receipt.delta.cells.find((cell) => cell.id === input.cellId);
  if (!updated) throw new Error("The cell could not be read back.");
  return updated;
}

function cellsChangedElsewhere(): never {
  return fail("Changed elsewhere", {
    statusCode: 409,
    errorCode: "cell_changed_elsewhere",
  });
}

async function applyCellWrites(
  scope: WorkspaceScope,
  draft: LegacyNotebook,
  writes: NotebookWrite[],
  cellIds: readonly string[],
): Promise<{ cellId: string; updatedAt: string }[]> {
  const receipt = await applyLegacyNotebookOperation(
    scope,
    draft.notebook,
    writes,
  );
  if (receipt.status === "conflict") {
    if (receipt.reason === "layout_changed")
      fail(notebookMessages.notebook.saveFailed, {
        statusCode: 409,
        errorCode: "layout_changed",
      });
    cellsChangedElsewhere();
  }
  const saved = receipt.status === "applied" ? receipt.delta.cells : [];
  return cellIds.map((cellId) => {
    const cell =
      saved.find(({ id }) => id === cellId) ?? requireLegacyCell(draft, cellId);
    return { cellId, updatedAt: cell.updatedAt };
  });
}

export async function updateCellsAtomic(
  input: CellScope & {
    versionId: string;
    cells: {
      cellId: string;
      expectedUpdatedAt: string;
      contents: CellContents;
    }[];
  },
): Promise<{ cellId: string; updatedAt: string }[]> {
  const scope = requireWorkspaceScope(input);
  const ids = input.cells.map(({ cellId }) => cellId);
  if (ids.length < 1 || ids.length > 200 || new Set(ids).size !== ids.length)
    fail("Choose 1 to 200 unique cells.", {
      statusCode: 400,
      errorCode: "invalid_cell_batch",
    });
  const draft = await cellDraftFor(input);
  const writes = input.cells.map((item) => {
    const before = requireLegacyCell(draft, item.cellId);
    if (before.updatedAt !== item.expectedUpdatedAt) cellsChangedElsewhere();
    const contents = cellContentsSchema.parse(item.contents);
    if (contents.id !== before.id || contents.kind !== before.contents.kind)
      fail("The cell identity or kind changed.", {
        statusCode: 400,
        errorCode: "invalid_cell_batch",
      });
    return cellWrite(before, contents);
  });
  return applyCellWrites(scope, draft, writes, ids);
}

/** Replace one connection across the exact observed set of working SQL cells. */
export async function replaceSqlConnection(
  input: CellScope & {
    versionId: string;
    fromConnectionId: string;
    toConnectionId: string;
    expectedCells: { cellId: string; updatedAt: string }[];
  },
): Promise<number> {
  const scope = requireWorkspaceScope(input);
  const expected = new Map(
    input.expectedCells.map((cell) => [cell.cellId, cell.updatedAt]),
  );
  if (
    expected.size !== input.expectedCells.length ||
    expected.size === 0 ||
    input.fromConnectionId === input.toConnectionId
  )
    fail("Choose distinct connections and a unique, nonempty set of cells.", {
      statusCode: 400,
      errorCode: "invalid_connection_replacement",
    });
  const draft = await cellDraftFor(input);
  const matches = draft.cells.flatMap((cell) =>
    cell.contents.kind === "sql" &&
    cell.contents.dataConnectionId === input.fromConnectionId
      ? [{ cell, contents: cell.contents }]
      : [],
  );
  if (
    matches.length !== expected.size ||
    matches.some(({ cell }) => expected.get(cell.id) !== cell.updatedAt)
  )
    fail("The project cells changed elsewhere. Reload and retry.", {
      statusCode: 409,
      errorCode: "cell_changed_elsewhere",
    });
  if (matches.some(({ contents }) => contents.connectionMode === "dataframes"))
    fail("A Dataframes cell cannot also select a warehouse connection.", {
      statusCode: 400,
      errorCode: "invalid_cell_connection",
    });
  const writes = matches.map(({ cell, contents }) =>
    cellWrite(cell, { ...contents, dataConnectionId: input.toConnectionId }),
  );
  await applyCellWrites(
    scope,
    draft,
    writes,
    matches.map(({ cell }) => cell.id),
  );
  return matches.length;
}

/** Moves a cell to `position` among its siblings (0 is first). */
export async function moveCell(
  input: CellScope & {
    versionId: string;
    cellId: string;
    position: number;
    originId?: string;
  },
  initial?: LegacyNotebook,
): Promise<Cell[]> {
  const scope = requireWorkspaceScope(input);
  const draft = initial ?? (await cellDraftFor(input));
  requireLegacyCell(draft, input.cellId);
  const others = draft.cells.filter((cell) => cell.id !== input.cellId);
  requireAppliedNotebookOperation(
    await applyLegacyNotebookOperation(
      scope,
      draft.notebook,
      [
        {
          type: "move",
          cellId: notebookCellIdSchema.parse(input.cellId),
          gap: legacyGap(others, input.position),
          expectedOrderRevision: draft.notebook.resources.orderRevision,
        },
      ],
      undefined,
      input.originId,
    ),
  );
  return readCells(scope, input.projectId, input.versionId);
}

export async function deleteCell(
  input: CellScope & {
    versionId: string;
    cellId: string;
    keepOutputForUndo?: boolean;
    originId?: string;
  },
): Promise<string | undefined> {
  const scope = requireWorkspaceScope(input);
  const draft = await cellDraftFor(input);
  const before = requireLegacyCell(draft, input.cellId);
  const token =
    input.keepOutputForUndo && before.contents.kind === "sql"
      ? randomUUID()
      : undefined;
  const receipt = requireAppliedNotebookOperation(
    await applyLegacyNotebookOperation(
      scope,
      draft.notebook,
      [
        {
          type: "delete",
          cellId: notebookCellIdSchema.parse(before.id),
          expectedRevision: before.revision,
          expectedOrderRevision: draft.notebook.resources.orderRevision,
          ...(token === undefined ? {} : { outputUndoToken: token }),
        },
      ],
      undefined,
      input.originId,
    ),
  );
  if (
    token !== undefined &&
    receipt.status === "applied" &&
    receipt.delta.tombstones.some(
      ({ cellId, outputGeneration }) =>
        cellId === before.id && outputGeneration === token,
    )
  )
    return token;
}
