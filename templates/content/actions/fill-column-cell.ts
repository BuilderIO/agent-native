import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { fillColumnCell } from "../server/lib/column-fill.js";
import { documentChangeResource } from "../server/lib/document-change-resource.js";
import { columnFillCellStatusOutput } from "./_column-fill-output.js";

export default defineAction({
  description:
    "Save the value for one cell of a column fill (Fill with AI). Only for runs started by a column fill, which give the fillId and documentId. Send value null with a short reason when the page has nothing to base a value on.",
  mcpTool: false,
  schema: z.object({
    fillId: z.string().min(1).describe("Column fill ID from the run's task"),
    documentId: z.string().min(1).describe("Row page ID from the run's task"),
    value: z
      .union([z.string(), z.number(), z.array(z.string()), z.null()])
      .describe(
        "The cell's value: text, a number, a URL, one option name for a select column, or a list of option names for a multi-select column. null leaves it empty.",
      ),
    reason: z
      .string()
      .trim()
      .max(500)
      .optional()
      .describe("Why the cell is left empty, when value is null"),
  }),
  outputSchema: z.object({
    status: columnFillCellStatusOutput,
    message: z.string(),
  }),
  changeResource: (input) => documentChangeResource(input.documentId),
  run: (input, ctx) => fillColumnCell(input, ctx),
});
