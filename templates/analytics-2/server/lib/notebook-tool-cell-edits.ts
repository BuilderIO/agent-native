import { isDeepStrictEqual } from "node:util";

import {
  withoutPendingCellEdit,
  type CellContents,
} from "../../app/lib/model/contracts.js";
import { editContents } from "../../shared/notebook-cell-edits.js";
import type {
  NotebookCell,
  NotebookChange,
} from "../../shared/notebook-operations.js";
import { notebookCellIdSchema } from "../../shared/notebook-snapshot-contract.js";
import { invalidNotebookProposal } from "./notebook-tool-proposal.js";

function comparableContents(contents: CellContents) {
  const { order: _order, ...body } = contents;
  return body.kind === "sql"
    ? { ...body, connectionSelectedAt: undefined }
    : body;
}

export function notebookToolCellEdits(
  cell: NotebookCell,
  contents: CellContents,
  optionsResultId?: string,
) {
  const before = withoutPendingCellEdit(cell.contents);
  const after = withoutPendingCellEdit(contents);
  if (before.kind !== after.kind) invalidNotebookProposal();
  const cellId = notebookCellIdSchema.parse(cell.id);
  const guard = { cellId, expectedRevision: cell.revision };
  const changes: NotebookChange[] = [];
  let projected = before;
  function add(change: Parameters<typeof editContents>[1]) {
    const next = editContents(projected, change);
    if (!next) invalidNotebookProposal();
    const changed = !isDeepStrictEqual(projected, next);
    if (changed) changes.push(change);
    projected = next;
    return changed;
  }
  add({
    type: "set-label",
    cellId,
    expectedLabelRevision: cell.labelRevision,
    label: after.label,
  });
  if (after.kind === "sql" || after.kind === "code") {
    add({ type: "set-code", ...guard, source: after.source });
  }
  if (after.kind === "sql") {
    add({
      type: "set-source",
      ...guard,
      dataConnectionId: after.dataConnectionId,
      databaseSchema: after.databaseSchema,
      connectionMode: after.connectionMode ?? "warehouse",
    });
  }
  if ("resultVariable" in after) {
    add({ type: "set-output-name", ...guard, name: after.resultVariable });
  }
  if (after.kind === "text" || after.kind === "markdown") {
    add({
      type: "set-text",
      ...guard,
      text: after.kind === "text" ? after.text : after.markdown,
    });
  }
  if (before.kind === "input" && after.kind === "input") {
    const updatedConfig = add({
      type: "set-input-config",
      ...guard,
      config: {
        name: after.name,
        inputType: after.inputType,
        options: after.options ?? null,
        optionValueType: after.optionValueType ?? null,
        optionLabels: after.optionLabels ?? null,
        dynamicOptions: after.dynamicOptions ?? null,
        optional: after.optional ?? null,
        sliderOptions: after.sliderOptions ?? null,
        ...(before.inputType === after.inputType
          ? {}
          : { defaultValueString: after.defaultValueString }),
      },
    });
    const defaultChange = {
      type: "set-input-default",
      ...guard,
      defaultValueString: after.defaultValueString,
      ...(optionsResultId === undefined ? {} : { optionsResultId }),
    } as const;
    const updatedDefault = add(defaultChange);
    if (!updatedDefault && updatedConfig && optionsResultId !== undefined)
      changes.push(defaultChange);
  }
  if (after.kind === "chart") {
    add({
      type: "set-chart-config",
      ...guard,
      config: { dataframe: after.dataframe, chartSpec: after.chartSpec },
    });
  }
  if (after.kind === "metric" && after.metricConfig) {
    add({ type: "set-metric-config", ...guard, config: after.metricConfig });
  }
  if (
    !isDeepStrictEqual(comparableContents(after), comparableContents(projected))
  )
    invalidNotebookProposal();
  return changes;
}
