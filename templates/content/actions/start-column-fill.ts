import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { startColumnFill } from "../server/lib/column-fill.js";
import {
  COLUMN_FILL_INSTRUCTION_MAX_LENGTH,
  COLUMN_FILL_MAX_CELLS,
} from "../shared/column-fill.js";
import { columnFillOutput } from "./_column-fill-output.js";

export default defineAction({
  description:
    "Fill one collection column with AI: start a quiet agent run for each listed row whose cell is empty (or every listed row when rewrite is true), five at a time. Each run reads its row's page and writes only that row's cell.",
  toolCallable: false,
  mcpTool: false,
  schema: z.object({
    databaseId: z.string().min(1).describe("Collection ID"),
    propertyId: z.string().min(1).describe("Column (property) ID to fill"),
    instruction: z
      .string()
      .trim()
      .min(1)
      .max(COLUMN_FILL_INSTRUCTION_MAX_LENGTH)
      .describe("What to put in each cell"),
    rewrite: z
      .boolean()
      .default(false)
      .describe("Also rewrite cells that already have a value"),
    documentIds: z
      .array(z.string().min(1))
      .min(1)
      .max(COLUMN_FILL_MAX_CELLS * 4)
      .describe("Row page IDs the current view shows, in view order"),
  }),
  outputSchema: columnFillOutput,
  run: startColumnFill,
});
