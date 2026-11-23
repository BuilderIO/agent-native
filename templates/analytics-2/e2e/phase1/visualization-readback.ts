import {
  notebookTransformSchema,
  type PivotTransformResult,
} from "../../shared/visualization-contracts.js";
import type { FlowContext } from "./runtime.js";

export async function readVisualizationTransform(
  flow: Pick<FlowContext, "action">,
  projectId: string,
  cellId: string,
  mode: "chart" | "pivot",
) {
  return notebookTransformSchema.parse(
    await flow.action("get-notebook-transform", { projectId, cellId, mode }),
  ).result;
}

export function pivotMatrixRows(result: PivotTransformResult) {
  const measureCount = result.config?.values.length;
  if (!measureCount) throw new Error("Pivot matrix has no configured measures");
  return result.rows.flatMap(({ key, values }) =>
    result.columns.flatMap((column, index) => {
      const start = index * measureCount;
      const measures = values.slice(start, start + measureCount);
      if (measures.length !== measureCount)
        throw new Error("Pivot matrix has incomplete coverage");
      if (measures.every(({ kind }) => kind === "missing")) return [];
      return [
        [
          ...(key ?? ["Total"]),
          ...(column ?? ["Total"]),
          ...measures.map((item) =>
            item.kind === "value" ? item.value : null,
          ),
        ],
      ];
    }),
  );
}
