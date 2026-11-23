import type { Cell } from "./contracts.js";

export function nearestVisualizationSource(
  cells: readonly Cell[],
  dataframe?: string,
) {
  const producer = [...cells]
    .reverse()
    .find(
      ({ contents }) =>
        (contents.kind === "sql" || contents.kind === "code") &&
        contents.resultVariable !== null &&
        (dataframe === undefined || contents.resultVariable === dataframe),
    );
  return producer ? { cellId: producer.id, exportId: "result" } : null;
}
