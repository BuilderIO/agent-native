import { defineAction } from "@agent-native/core/action";

import { getNotebookVisualizationPage } from "../server/model/notebook-transforms.js";
import {
  visualizationPageInputSchema,
  visualizationPageOutputSchema,
} from "../shared/visualization-contracts.js";

export default defineAction({
  description:
    "Read 50 rows and filtered totals from a saved Table. Pass the returned result ID and cell update timestamp while paging an export.",
  schema: visualizationPageInputSchema,
  outputSchema: visualizationPageOutputSchema,
  mcpOutputSchema: true,
  outputErrorStrategy: "strict",
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: (input, context) =>
    getNotebookVisualizationPage(input, context?.caller ?? "frontend"),
});
