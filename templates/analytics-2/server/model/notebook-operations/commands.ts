import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  cellInputParams,
  cellOutputParams,
} from "../../../app/lib/model/cell-references.js";
import {
  normalizeProjectTitle,
  UNTITLED_PROJECT_NAME,
  cellContentsSchema,
  withoutPendingCellEdit,
  type CellContents,
  type CellDraft,
} from "../../../app/lib/model/contracts.js";
import {
  compareOrder,
  orderBetween,
  orderForInsertion,
} from "../../../app/lib/model/order.js";
import {
  AppLayoutError,
  applyAppPatches,
  draftAppLayout,
  pruneAppLayout,
  type AppDocument,
} from "../../../shared/app-layout.js";
import {
  duplicateContents,
  editContents,
  gapPosition,
  insertContents,
  notebookCellSymbol,
  symbolNames,
} from "../../../shared/notebook-cell-edits.js";
import { isNumericNotebookInput } from "../../../shared/notebook-input-values.js";
import type {
  NotebookCell,
  NotebookChange,
  NotebookCommand,
  NotebookConflictReason,
  NotebookMetadata,
  NotebookResources,
} from "../../../shared/notebook-operations.js";
import {
  canGroupInSection,
  canMoveIntoSection,
  notebookSectionInsertPosition,
  notebookSectionOrder,
  sectionDescendantIds,
  sectionParent,
  sectionSelectionRoots,
  validNotebookSections,
} from "../../../shared/notebook-sections.js";
import type { Revision } from "../../../shared/notebook-snapshot-contract.js";
import { sqlDataframeReferences } from "../../../shared/sql-dataframe-references.js";
import {
  isSqlInputName,
  sqlInputReferences,
} from "../../../shared/sql-input-name.js";
import type { WarehouseTableProvenance } from "../../../shared/warehouse-table.js";
import {
  cellBody,
  inverseCells,
  inverseRevisions,
  type NotebookUndoPlan,
} from "./undo-plan.js";

export class NotebookConflict extends Error {
  constructor(readonly reason: NotebookConflictReason) {
    super(reason);
  }
}

export class NotebookInvalidChange extends Error {
  constructor() {
    super("notebook_invalid_change");
  }
}

export type NotebookState = {
  metadata: NotebookMetadata;
  resources: NotebookResources;
  cells: NotebookCell[];
  tombstones: ReadonlyMap<string, { versionId: string; revision: bigint }>;
  appLayout: AppDocument | null;
};

export type NotebookWrite =
  | Exclude<NotebookChange, { type: "delete" }>
  | (Extract<NotebookChange, { type: "delete" }> & { outputUndoToken?: string })
  | {
      type: "insert-legacy";
      cellId: string;
      gap: { afterCellId: string | null; beforeCellId: string | null };
      expectedOrderRevision: Revision;
      contents: CellDraft;
      parentSectionId?: string | null;
      restore: boolean;
      outputUndoToken?: string;
    }
  | {
      type: "save-legacy";
      cellId: string;
      expectedUpdatedAt: string;
      contents: CellContents;
      optionsResultId?: string;
    };

export function notebookCellChanges(command: NotebookWriteCommand) {
  return command.changes.flatMap((change) =>
    change.type === "set-app"
      ? change.patches.flatMap((patch) =>
          patch.type === "insert-and-place" ? [patch.insert] : [],
        )
      : [change],
  );
}

export type NotebookWriteCommand = Omit<NotebookCommand, "changes"> & {
  changes: NotebookWrite[];
  suppressReactiveRun?: boolean;
  warehouseTable?: WarehouseTableProvenance;
};

function assertAvailableSymbol(contents: CellContents, cells: NotebookCell[]) {
  const name = notebookCellSymbol(contents);
  if (name === null) return;
  if (!isSqlInputName(name)) throw new NotebookInvalidChange();
  if (
    cells.some(
      (cell) =>
        cell.id !== contents.id &&
        notebookCellSymbol(cell.contents)?.toLowerCase() === name.toLowerCase(),
    )
  )
    throw new NotebookConflict("symbol_taken");
}

function assertInputDefault({
  inputType,
  options,
  optionValueType,
  dynamicOptions,
  defaultValueString: value,
}: Extract<CellContents, { kind: "input" }>) {
  if (
    optionValueType === "number" &&
    ((inputType !== "DROPDOWN" && inputType !== "MULTISELECT") ||
      dynamicOptions ||
      (options ?? []).some((option) => !isNumericNotebookInput(option)))
  )
    throw new NotebookInvalidChange();
  if (value === "" || value === "null") return;
  let valid = true;
  if (inputType === "NUMERIC_INPUT" || inputType === "SLIDER") {
    valid = value.trim() !== "" && Number.isFinite(Number(value));
  } else if (inputType === "CHECKBOX") {
    valid = value === "true" || value === "false";
  } else if (inputType === "DATE") {
    valid = z.iso.date().safeParse(value).success;
  } else if (inputType === "MULTISELECT") {
    try {
      valid = z.array(z.string()).safeParse(JSON.parse(value)).success;
    } catch {
      throw new NotebookInvalidChange();
    }
  }
  if (!valid) throw new NotebookInvalidChange();
}

function legacyCellContents(previous: CellContents, update: CellContents) {
  if (previous.kind !== update.kind || previous.id !== update.id)
    throw new NotebookInvalidChange();
  const { parentSectionId: _parent, ...body } = update;
  const placement = {
    order: previous.order,
    ...(previous.parentSectionId === undefined
      ? {}
      : { parentSectionId: previous.parentSectionId }),
  };
  if (previous.kind !== "sql" || update.kind !== "sql")
    return { ...body, ...placement };
  const {
    parentSectionId: _section,
    connectionSelectedAt: _time,
    ...contents
  } = update;
  return {
    ...contents,
    ...placement,
    ...(previous.connectionSelectedAt === undefined
      ? {}
      : { connectionSelectedAt: previous.connectionSelectedAt }),
  };
}

function legacyPlacement(contents: CellContents) {
  const { gridX, gridY, gridWidth, gridHeight, hidden } = contents;
  return [gridX, gridY, gridWidth, gridHeight, hidden];
}

function assertMetricBinding(
  contents: CellContents,
  earlier: readonly NotebookCell[],
) {
  if (contents.kind !== "metric" || !contents.metricConfig?.source) return;
  const { cellId } = contents.metricConfig.source;
  if (
    !earlier.some(
      ({ id, contents }) =>
        id === cellId && (contents.kind === "sql" || contents.kind === "code"),
    )
  )
    throw new NotebookInvalidChange();
}

function executionStates(cells: NotebookCell[]) {
  const inputs = new Map(
    cells.flatMap(({ id, contents }) =>
      contents.kind === "input" ? [[contents.name, id] as const] : [],
    ),
  );
  const producers = new Map<string, string>();
  const dataframes = new Map<string, string>();
  let previousCode: string | undefined;
  return new Map(
    cells
      .filter(({ contents }) => contents.kind !== "collapsible")
      .map(({ id, contents }) => {
        let body = cellBody(withoutPendingCellEdit(contents));
        if (body.kind === "input") {
          const { optionLabels: _optionLabels, ...input } = body;
          body = input;
        }
        const {
          hidden: _hidden,
          gridX: _x,
          gridY: _y,
          gridWidth: _width,
          gridHeight: _height,
          description: _description,
          ...executionBody
        } = body;
        const deps = new Set<string>();
        const use = (producer: string | undefined) => {
          if (producer !== undefined) deps.add(producer);
        };
        if (body.kind === "sql") {
          for (const name of sqlInputReferences(body.source))
            use(inputs.get(name));
          if (body.connectionMode === "dataframes")
            for (const name of sqlDataframeReferences(body.source))
              use(dataframes.get(name));
        } else if (body.kind === "code") {
          for (const producer of producers.values()) use(producer);
          use(previousCode);
          previousCode = id;
        } else {
          if (body.kind === "metric") use(body.metricConfig?.source?.cellId);
          const names =
            body.kind === "display-table"
              ? body.dataframe === null
                ? []
                : [body.dataframe]
              : cellInputParams(contents);
          for (const name of names) use(producers.get(name));
        }
        for (const name of cellOutputParams(contents)) producers.set(name, id);
        if (
          (body.kind === "sql" || body.kind === "code") &&
          body.resultVariable !== null
        ) {
          dataframes.set(body.resultVariable, id);
          dataframes.set(body.resultVariable.toLowerCase(), id);
        }
        return [id, { body: executionBody, deps }] as const;
      }),
  );
}

function outputImpact(before: NotebookCell[], after: NotebookCell[]) {
  const previous = executionStates(before);
  const next = executionStates(after);
  const dependents = new Map<string, Set<string>>();
  for (const states of [previous, next]) {
    for (const [id, { deps }] of states) {
      for (const dependency of deps) {
        const readers = dependents.get(dependency) ?? new Set<string>();
        readers.add(id);
        dependents.set(dependency, readers);
      }
    }
  }
  const changed = [...new Set([...previous.keys(), ...next.keys()])].filter(
    (id) => !isDeepStrictEqual(previous.get(id), next.get(id)),
  );
  const remaining = new Set(after.map(({ id }) => id));
  for (const { id, contents } of before)
    if (contents.kind === "collapsible" && !remaining.has(id)) changed.push(id);
  const aliased = new Set(
    changed.filter((id) => {
      const prior = previous.get(id);
      const current = next.get(id);
      return (
        prior?.body.kind === "sql" &&
        current?.body.kind === "sql" &&
        prior.body.resultVariable !== current.body.resultVariable &&
        isDeepStrictEqual(prior, {
          ...current,
          body: { ...current.body, resultVariable: prior.body.resultVariable },
        })
      );
    }),
  );
  const changedInputs = changed.filter(
    (id) => (next.get(id) ?? previous.get(id))?.body.kind === "input",
  );
  const expand = (roots: string[]) => {
    const affected = new Set(roots);
    for (const id of affected) {
      for (const dependent of dependents.get(id) ?? []) affected.add(dependent);
    }
    return [...affected];
  };
  const hasOutput = (id: string) => {
    const kind = next.get(id)?.body.kind;
    return kind !== "input" && kind !== "text" && kind !== "markdown";
  };
  return {
    invalidatedCellIds: expand(
      changed.flatMap((id) =>
        aliased.has(id) ? [...(dependents.get(id) ?? [])] : [id],
      ),
    ).filter(hasOutput),
    inputInvalidatedCellIds: expand(changedInputs).filter(
      (id) => next.has(id) && hasOutput(id),
    ),
    inputChanged: changedInputs.length > 0,
  };
}

function orderedBlock(
  cells: NotebookCell[],
  lower: string | null,
  upper: string | null,
): { cell: NotebookCell; order: string }[] {
  const middle = Math.floor(cells.length / 2);
  const cell = cells[middle];
  if (!cell) return [];
  const order = orderBetween(lower, upper);
  return [
    ...orderedBlock(cells.slice(0, middle), lower, order),
    { cell, order },
    ...orderedBlock(cells.slice(middle + 1), order, upper),
  ];
}

export function planNotebookCommand(
  command: NotebookWriteCommand,
  state: NotebookState,
  nextRevision: Revision,
  timestamp: string,
  inverse?: {
    plan: NotebookUndoPlan;
    currentRevisions: ReadonlyMap<string, Revision>;
    equivalent: (key: string, revision: Revision) => Revision;
  },
) {
  const original = new Map(state.cells.map((cell) => [cell.id, cell]));
  const current = new Map(original);
  const inserted = new Set<string>();
  const ordered = () =>
    [...current.values()].sort((a, b) =>
      compareOrder(a.contents.order, b.contents.order),
    );
  const requireCell = (id: string) => {
    const cell = current.get(id);
    if (!cell) throw new NotebookConflict("cell_missing");
    return cell;
  };
  const createCell = (contents: CellContents) => {
    const { id } = contents;
    inserted.add(id);
    current.set(id, {
      id,
      projectId: command.projectId,
      versionId: command.workingVersionId,
      contents,
      createdAt: timestamp,
      updatedAt: timestamp,
      revision: nextRevision,
      labelRevision: nextRevision,
    });
  };
  const moveSectionCells = (
    cells: NotebookCell[],
    roots: NotebookCell[],
    parentSectionId: string | null,
    beforeCellId?: string,
  ) => {
    const rootIds = new Set(roots.map(({ id }) => id));
    const moving = new Set(
      roots.flatMap(({ id }) => [id, ...sectionDescendantIds(cells, id)]),
    );
    const remaining = cells.filter(({ id }) => !moving.has(id));
    const siblings = remaining.filter(
      (cell) => sectionParent(cell) === parentSectionId,
    );
    const index =
      beforeCellId === undefined
        ? siblings.length
        : siblings.findIndex(({ id }) => id === beforeCellId);
    if (index < 0) throw new NotebookConflict("stale_anchor");
    const position = notebookSectionInsertPosition(remaining, parentSectionId, {
      afterCellId: siblings[index - 1]?.id ?? null,
      beforeCellId: siblings[index]?.id ?? null,
    });
    if (position === null) throw new NotebookConflict("stale_anchor");
    const block = cells.filter(({ id }) => moving.has(id));
    for (const { cell, order } of orderedBlock(
      block,
      remaining[position - 1]?.contents.order ?? null,
      remaining[position]?.contents.order ?? null,
    )) {
      const contents = {
        ...cell.contents,
        order,
        ...(rootIds.has(cell.id) && sectionParent(cell) !== parentSectionId
          ? { parentSectionId }
          : {}),
      };
      current.set(cell.id, { ...cell, contents });
    }
  };
  const guardCell = (id: string, revision: Revision, includeLabel = false) => {
    const base = original.get(id);
    if ((base?.revision ?? "0") !== revision)
      throw new NotebookConflict("cell_changed");
    if (
      includeLabel &&
      base &&
      BigInt(base.labelRevision) > BigInt(command.observedHead.revision)
    )
      throw new NotebookConflict("label_changed");
  };
  let metadata = state.metadata;
  const restored: string[] = [];

  if (inverse) {
    const { plan, currentRevisions, equivalent } = inverse;
    for (const { key, expected } of inverseRevisions(plan)) {
      if (expected === undefined) continue;
      const actual = currentRevisions.get(key);
      if (
        actual !== undefined &&
        equivalent(key, actual) === equivalent(key, expected)
      )
        continue;
      if (key === "order") throw new NotebookConflict("order_changed");
      if (key === "layout") throw new NotebookConflict("layout_changed");
      if (key.startsWith("label:") && actual !== undefined)
        throw new NotebookConflict("label_changed");
      throw new NotebookConflict(
        actual === undefined ? "cell_missing" : "cell_changed",
      );
    }
    const renamed: string[] = [];
    for (const { id, expected, target } of inverseCells(plan)) {
      if (!expected) {
        if (
          !target ||
          current.has(id) ||
          state.tombstones.get(id)?.versionId !== command.workingVersionId
        )
          throw new NotebookConflict("cell_id_reserved");
        current.set(id, {
          ...target,
          updatedAt: timestamp,
          revision: nextRevision,
          labelRevision: nextRevision,
        });
        restored.push(id);
        renamed.push(id);
        continue;
      }
      const cell = requireCell(id);
      if (!target) {
        current.delete(id);
        continue;
      }
      const bodyChanged = !isDeepStrictEqual(
        cellBody(expected.contents),
        cellBody(target.contents),
      );
      const { parentSectionId: _parent, ...body } = bodyChanged
        ? target.contents
        : cell.contents;
      const parentSectionId =
        sectionParent(target) !== sectionParent(expected)
          ? target.contents.parentSectionId
          : cell.contents.parentSectionId;
      const contents = {
        ...body,
        ...(parentSectionId === undefined ? {} : { parentSectionId }),
        order:
          target.contents.order !== expected.contents.order
            ? target.contents.order
            : cell.contents.order,
        label:
          target.contents.label !== expected.contents.label
            ? target.contents.label
            : cell.contents.label,
      };
      if (notebookCellSymbol(contents) !== notebookCellSymbol(cell.contents))
        renamed.push(id);
      current.set(id, { ...cell, contents });
    }
    for (const id of renamed)
      assertAvailableSymbol(requireCell(id).contents, [...current.values()]);
  }

  const layoutChange = command.changes.find(
    (change) => change.type === "set-app",
  );
  if (
    layoutChange &&
    layoutChange.expectedLayoutRevision !== state.resources.layoutRevision
  )
    throw new NotebookConflict("layout_changed");

  for (const change of notebookCellChanges(command)) {
    if (
      "expectedOrderRevision" in change &&
      change.expectedOrderRevision !== state.resources.orderRevision
    )
      throw new NotebookConflict("order_changed");

    if (change.type === "set-metadata") {
      if (change.expectedMetadataRevision !== state.resources.metadataRevision)
        throw new NotebookConflict("metadata_changed");
      const { title, description, statusId } = change.metadata;
      metadata = {
        title:
          title === undefined
            ? metadata.title
            : normalizeProjectTitle(title) || UNTITLED_PROJECT_NAME,
        description: description ?? metadata.description,
        statusId: statusId === undefined ? metadata.statusId : statusId,
      };
      continue;
    }

    const id = change.cellId;
    if (change.type === "group-section") {
      if (original.has(id) || inserted.has(id) || state.tombstones.has(id))
        throw new NotebookConflict("cell_id_reserved");
      for (const cellId of change.cellIds) requireCell(cellId);
      const rows = ordered();
      const roots = sectionSelectionRoots(rows, change.cellIds);
      const first = roots[0];
      if (!first || !canGroupInSection(rows, change.cellIds))
        throw new NotebookInvalidChange();
      const order = orderForInsertion(
        rows.map((row) => row.contents.order),
        rows.indexOf(first),
      );
      createCell({
        ...insertContents(
          { kind: "collapsible", title: null, label: null, collapsed: false },
          id,
          order,
          [],
        ),
        parentSectionId: sectionParent(first),
      });
      moveSectionCells(ordered(), roots, id);
      continue;
    }
    if (change.type === "move-to-section") {
      if (!change.cellIds.includes(change.cellId))
        throw new NotebookInvalidChange();
      for (const cellId of change.cellIds) requireCell(cellId);
      const rows = ordered();
      if (!canMoveIntoSection(rows, change.cellIds, change.parentSectionId))
        throw new NotebookInvalidChange();
      moveSectionCells(
        rows,
        sectionSelectionRoots(rows, change.cellIds),
        change.parentSectionId,
        change.beforeCellId,
      );
      if (change.parentSectionId !== null) {
        const parent = requireCell(change.parentSectionId);
        if (parent.contents.kind === "collapsible" && parent.contents.collapsed)
          current.set(parent.id, {
            ...parent,
            contents: { ...parent.contents, collapsed: false },
          });
      }
      continue;
    }
    if (
      change.type === "insert" ||
      change.type === "insert-legacy" ||
      change.type === "duplicate"
    ) {
      const tombstone = state.tombstones.get(id);
      const restoresCurrentDeletion =
        change.type === "insert-legacy" &&
        change.restore &&
        tombstone?.versionId === command.workingVersionId &&
        tombstone.revision <= BigInt(command.observedHead.revision);
      if (
        original.has(id) ||
        inserted.has(id) ||
        (tombstone && !restoresCurrentDeletion)
      )
        throw new NotebookConflict("cell_id_reserved");
      const rows = ordered();
      const parentSectionId =
        change.type === "duplicate" ? undefined : change.parentSectionId;
      const position =
        parentSectionId === undefined
          ? gapPosition(rows, change.gap)
          : notebookSectionInsertPosition(rows, parentSectionId, change.gap);
      if (position === null) throw new NotebookConflict("stale_anchor");
      const order = orderForInsertion(
        rows.map((row) => row.contents.order),
        position,
      );
      const names = symbolNames(rows);
      let contents: CellContents;
      if (change.type === "duplicate") {
        const source = requireCell(change.fromCellId);
        guardCell(source.id, change.expectedRevision, true);
        contents = { ...duplicateContents(source.contents, names), id, order };
      } else {
        contents =
          change.type === "insert"
            ? insertContents(change.contents, id, order, names)
            : withoutPendingCellEdit(
                cellContentsSchema.parse({ ...change.contents, id, order }),
              );
        if (contents.kind === "input") assertInputDefault(contents);
        if (!restoresCurrentDeletion)
          assertMetricBinding(contents, rows.slice(0, position));
      }
      assertAvailableSymbol(contents, rows);
      if (
        contents.kind === "code" &&
        contents.language === "python" &&
        !restoresCurrentDeletion &&
        Buffer.byteLength(contents.source) > 256 * 1024
      )
        throw new NotebookInvalidChange();
      if (contents.kind === "sql") {
        if (
          contents.connectionMode === "dataframes" &&
          contents.dataConnectionId !== null
        )
          throw new NotebookInvalidChange();
        contents = {
          ...contents,
          connectionSelectedAt: timestamp,
          ...(command.warehouseTable
            ? { warehouseTable: command.warehouseTable }
            : {}),
        };
      }
      const { parentSectionId: _parent, ...body } = contents;
      createCell(
        parentSectionId === null
          ? body
          : parentSectionId === undefined
            ? contents
            : { ...body, parentSectionId },
      );
      continue;
    }

    const cell = requireCell(id);
    if (change.type === "remove-section") {
      if (cell.contents.kind !== "collapsible")
        throw new NotebookInvalidChange();
      if (change.mode === "delete") {
        for (const cellId of [id, ...sectionDescendantIds(ordered(), id)]) {
          const base = original.get(cellId);
          if (
            base &&
            BigInt(base.revision) > BigInt(command.observedHead.revision)
          )
            throw new NotebookConflict("cell_changed");
          if (
            base &&
            BigInt(base.labelRevision) > BigInt(command.observedHead.revision)
          )
            throw new NotebookConflict("label_changed");
          current.delete(cellId);
        }
      } else {
        for (const child of current.values()) {
          if (sectionParent(child) === id)
            current.set(child.id, {
              ...child,
              contents: {
                ...child.contents,
                parentSectionId: sectionParent(cell),
              },
            });
        }
        current.delete(id);
      }
      continue;
    }
    if (change.type === "delete") {
      guardCell(id, change.expectedRevision, true);
      if (
        cell.contents.kind === "collapsible" &&
        sectionDescendantIds(ordered(), id).length > 0
      )
        throw new NotebookInvalidChange();
      current.delete(id);
      continue;
    }
    if (change.type === "move") {
      const rows = ordered();
      const others = rows.filter((row) => row.id !== id);
      const position = gapPosition(others, change.gap);
      if (position === null) throw new NotebookConflict("stale_anchor");
      if (rows[position]?.id !== id) {
        const order = orderForInsertion(
          others.map((row) => row.contents.order),
          position,
        );
        current.set(id, { ...cell, contents: { ...cell.contents, order } });
      }
      continue;
    }
    if (change.type === "save-legacy") {
      if (original.get(id)?.updatedAt !== change.expectedUpdatedAt)
        throw new NotebookConflict("cell_changed");
      if (
        state.appLayout &&
        !isDeepStrictEqual(
          legacyPlacement(cell.contents),
          legacyPlacement(change.contents),
        )
      )
        throw new NotebookConflict("layout_changed");
    } else if (change.type === "set-label") {
      if (
        (original.get(id)?.labelRevision ?? "0") !==
        change.expectedLabelRevision
      )
        throw new NotebookConflict("label_changed");
    } else {
      guardCell(id, change.expectedRevision);
    }
    const contents =
      change.type === "save-legacy"
        ? legacyCellContents(cell.contents, change.contents)
        : editContents(cell.contents, change);
    if (!contents) throw new NotebookInvalidChange();
    if (
      contents.kind === "metric" &&
      contents.metricConfig?.source &&
      !isDeepStrictEqual(
        contents.metricConfig.source,
        cell.contents.kind === "metric"
          ? cell.contents.metricConfig?.source
          : null,
      )
    )
      assertMetricBinding(
        contents,
        ordered().filter(
          ({ contents }) =>
            compareOrder(contents.order, cell.contents.order) < 0,
        ),
      );
    if (
      contents.kind === "code" &&
      contents.language === "python" &&
      (cell.contents.kind !== "code" ||
        cell.contents.source !== contents.source) &&
      Buffer.byteLength(contents.source) > 256 * 1024
    )
      throw new NotebookInvalidChange();
    if (
      contents.kind === "input" &&
      cell.contents.kind === "input" &&
      (contents.inputType !== cell.contents.inputType ||
        contents.optionValueType !== cell.contents.optionValueType ||
        !isDeepStrictEqual(contents.options, cell.contents.options) ||
        !isDeepStrictEqual(
          contents.dynamicOptions,
          cell.contents.dynamicOptions,
        ) ||
        contents.defaultValueString !== cell.contents.defaultValueString)
    )
      assertInputDefault(contents);
    if (notebookCellSymbol(cell.contents) !== notebookCellSymbol(contents))
      assertAvailableSymbol(contents, [...current.values()]);
    current.set(id, { ...cell, contents });
  }

  const ranked = ordered();
  if (!validNotebookSections(ranked)) throw new NotebookInvalidChange();
  const projected = notebookSectionOrder(ranked).map((cell, index) => {
    const order = ranked[index]?.contents.order;
    return order === undefined || order === cell.contents.order
      ? cell
      : { ...cell, contents: { ...cell.contents, order } };
  });
  const orderChanged = !isDeepStrictEqual(
    state.cells.map((cell) => [cell.id, sectionParent(cell)]),
    projected.map((cell) => [cell.id, sectionParent(cell)]),
  );
  const cells = projected.map((cell) => {
    const base = original.get(cell.id);
    if (!base) return cell;
    let { contents } = cell;
    if (!orderChanged) contents = { ...contents, order: base.contents.order };
    if (isDeepStrictEqual(base.contents, contents)) return base;
    const updatedAt = new Date(
      Math.max(Date.parse(timestamp), Date.parse(base.updatedAt) + 1),
    ).toISOString();
    if (
      contents.kind === "sql" &&
      base.contents.kind === "sql" &&
      (contents.dataConnectionId !== base.contents.dataConnectionId ||
        contents.connectionMode !== base.contents.connectionMode)
    )
      contents = { ...contents, connectionSelectedAt: updatedAt };
    return {
      ...cell,
      contents,
      updatedAt,
      revision: isDeepStrictEqual(cellBody(base.contents), cellBody(contents))
        ? base.revision
        : nextRevision,
      labelRevision:
        base.contents.label === contents.label
          ? base.labelRevision
          : nextRevision,
    };
  });
  const legacyLayoutChanged =
    state.appLayout === null &&
    [...new Set([...original.keys(), ...current.keys()])].some((id) => {
      const before = original.get(id);
      const after = current.get(id);
      const unplaced = [null, null, null, null, false];
      return !isDeepStrictEqual(
        before ? legacyPlacement(before.contents) : unplaced,
        after ? legacyPlacement(after.contents) : unplaced,
      );
    });
  const contentChanged =
    orderChanged ||
    cells.some((cell) => original.get(cell.id)?.revision !== cell.revision);
  const previousLayout =
    state.appLayout ??
    (layoutChange || inverse?.plan.after.appLayout
      ? draftAppLayout(state.cells, state.resources.layoutRevision)
      : null);
  let layout =
    inverse?.plan.before.appLayout ??
    (previousLayout && pruneAppLayout(previousLayout, state.cells));
  if (layoutChange && layout) {
    const cellIds = new Set(cells.map(({ id }) => id));
    const insertedCellIds: string[] = [];
    const patches = layoutChange.patches.map((patch) => {
      if (patch.type !== "insert-and-place") {
        if (patch.type === "place" && !cellIds.has(patch.cellId))
          throw new AppLayoutError("App cell is absent");
        return patch;
      }
      if (
        patch.insert.cellId !== patch.placement.cellId ||
        patch.insert.contents.kind === "collapsible" ||
        !cellIds.has(patch.insert.cellId)
      )
        throw new AppLayoutError("Inserted cell must match the placement");
      insertedCellIds.push(patch.insert.cellId);
      return { type: "place" as const, ...patch.placement };
    });
    const deleted = state.cells.filter(({ id }) => !cellIds.has(id));
    layout = applyAppPatches(
      layout,
      patches,
      [...cells, ...deleted],
      insertedCellIds,
    );
  }
  if (layout) layout = pruneAppLayout(layout, cells);
  const layoutChanged =
    !isDeepStrictEqual(previousLayout, layout) ||
    (state.appLayout === null &&
      layoutChange !== undefined &&
      layout?.initialized === true);
  const changed =
    contentChanged ||
    layoutChanged ||
    !isDeepStrictEqual(state.metadata, metadata) ||
    cells.some((cell) => original.get(cell.id) !== cell);
  const impact = contentChanged
    ? outputImpact(state.cells, cells)
    : {
        invalidatedCellIds: [],
        inputInvalidatedCellIds: [],
        inputChanged: false,
      };
  return {
    metadata,
    cells,
    orderChanged,
    layoutChanged: layoutChanged || legacyLayoutChanged,
    changed,
    previousLayout,
    appLayout:
      layoutChanged && layout ? { ...layout, revision: nextRevision } : null,
    ...impact,
    invalidatedCellIds: [
      ...new Set([...impact.invalidatedCellIds, ...restored]),
    ],
  };
}
