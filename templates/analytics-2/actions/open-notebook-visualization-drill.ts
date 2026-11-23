import { defineAction } from "@agent-native/core/action";

import { openNotebookVisualizationDrill } from "../server/model/notebook-transforms.js";
import {
  visualizationDrillInputSchema,
  visualizationDrillOutputSchema,
} from "../shared/visualization-contracts.js";

export default defineAction({
  description:
    "Page original rows or group by a new field for an authorized Chart or Pivot selection. Use the visualization and selection IDs from get-notebook-transform. Keep and Remove return the typed predicate for a draft config edit.",
  schema: visualizationDrillInputSchema,
  outputSchema: visualizationDrillOutputSchema,
  mcpOutputSchema: true,
  outputErrorStrategy: "strict",
  http: { method: "POST" },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: (input, context) =>
    openNotebookVisualizationDrill(input, context?.caller ?? "frontend"),
});
