import { z } from "zod";

import type { ParameterInputType } from "@/lib/model/cell-types";
import type { Cell } from "@/lib/model/contracts";
import { nearestVisualizationSource } from "@/lib/model/visualization-source";

import { defaultChartSpec } from "../../../shared/chart-visualization-config";
import { defaultMetricConfig } from "../../../shared/metric-config";
import type { NotebookInsert } from "../../../shared/notebook-operations";
import { defaultPivotConfig } from "../../../shared/pivot-config";
import { SAMPLE_DATA_SOURCE_ID } from "../../../shared/sample-data-contract";
import { defaultTableConfig } from "../../../shared/table-visualization-config";
import type { NotebookConnection } from "./types";

export const appBuilderCellKindSchema = z.enum([
  "text",
  "markdown",
  "sql",
  "code",
  "input",
  "chart",
  "display-table",
  "pivot",
  "metric",
]);

export function appCellDraft(
  kind: z.infer<typeof appBuilderCellKindSchema>,
  cells: readonly Cell[],
  connections: readonly NotebookConnection[],
  inputType: ParameterInputType = "TEXT_INPUT",
): NotebookInsert["contents"] {
  const label = null;
  switch (kind) {
    case "text":
      return { kind, label, text: "" };
    case "markdown":
      return { kind, label, markdown: "" };
    case "sql": {
      const previous = [...cells]
        .reverse()
        .find(({ contents }) => contents.kind === "sql")?.contents;
      if (previous?.kind === "sql" && previous.connectionMode === "dataframes")
        return {
          kind,
          label,
          source: "",
          connectionMode: "dataframes",
          dataConnectionId: null,
          databaseSchema: null,
          outputResult: true,
        };
      const dataConnectionId =
        previous?.kind === "sql" &&
        connections.some(({ id }) => id === previous.dataConnectionId)
          ? previous.dataConnectionId
          : (connections.find(({ isDefault }) => isDefault)?.id ??
            SAMPLE_DATA_SOURCE_ID);
      return {
        kind,
        label,
        source: "",
        dataConnectionId,
        databaseSchema: null,
        outputResult: true,
      };
    }
    case "code":
      return {
        kind,
        label,
        language: "python",
        source: "",
        resultVariable: null,
        outputResult: true,
      };
    case "input":
      return {
        kind,
        label,
        inputType,
        options: [],
        optional: false,
        defaultValueString:
          inputType === "MULTISELECT"
            ? "[]"
            : inputType === "CHECKBOX"
              ? "false"
              : inputType === "NUMERIC_INPUT" || inputType === "SLIDER"
                ? "0"
                : "",
      };
    case "chart": {
      const source = nearestVisualizationSource(cells);
      const contents = cells.find(({ id }) => id === source?.cellId)?.contents;
      return {
        kind,
        label,
        dataframe:
          contents && "resultVariable" in contents
            ? contents.resultVariable
            : null,
        chartSpec: defaultChartSpec(source),
      };
    }
    case "display-table":
      return {
        kind,
        label,
        dataframe: null,
        columns: [],
        tableConfig: {
          ...defaultTableConfig,
          source: nearestVisualizationSource(cells),
        },
      };
    case "pivot":
      return {
        kind,
        label,
        dataframe: null,
        rows: [],
        columns: [],
        values: [],
        pivotConfig: {
          ...defaultPivotConfig,
          source: nearestVisualizationSource(cells),
        },
      };
    case "metric":
      return {
        kind,
        label,
        valueVariableName: null,
        valueRowIndex: null,
        resultVariable: null,
        outputResult: false,
        format: null,
        metricConfig: {
          ...defaultMetricConfig,
          source: nearestVisualizationSource(cells),
        },
      };
  }
}
