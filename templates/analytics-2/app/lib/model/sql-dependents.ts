import { sqlDataframeReferences } from "../../../shared/sql-dataframe-references";
import { sqlInputReferences } from "../../../shared/sql-input-name";
import type { Cell } from "./contracts";

export function dependentSqlCells(
  cells: readonly Cell[],
  sourceFor: (cell: Cell) => string,
  changed: { inputName: string } | { cellId: string },
): Set<string> {
  const affected = new Set<string>();
  const producers = new Map<string, string>();
  for (const cell of cells) {
    const contents = cell.contents;
    if (contents.kind !== "sql") continue;
    const source = sourceFor(cell);
    const direct =
      "inputName" in changed
        ? sqlInputReferences(source).has(changed.inputName)
        : cell.id === changed.cellId;
    const downstream =
      contents.connectionMode === "dataframes" &&
      [...sqlDataframeReferences(source)].some((name) => {
        const producer = producers.get(name);
        return producer !== undefined && affected.has(producer);
      });
    if (direct || downstream) affected.add(cell.id);
    if (contents.resultVariable) {
      producers.set(contents.resultVariable, cell.id);
      producers.set(contents.resultVariable.toLowerCase(), cell.id);
    }
  }
  return affected;
}
