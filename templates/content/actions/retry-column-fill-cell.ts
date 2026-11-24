import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { retryColumnFillCell } from "../server/lib/column-fill.js";
import { columnFillOutput } from "./_column-fill-output.js";

export default defineAction({
  description: "Run a column fill's agent again for one cell that failed.",
  mcpTool: false,
  schema: z.object({
    fillId: z.string().min(1).describe("Column fill ID"),
    documentId: z.string().min(1).describe("Row page ID of the failed cell"),
  }),
  outputSchema: columnFillOutput,
  run: retryColumnFillCell,
});
