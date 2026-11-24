import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { stopColumnFill } from "../server/lib/column-fill.js";
import { columnFillOutput } from "./_column-fill-output.js";

export default defineAction({
  description:
    "Stop a column fill: rows already running finish, and rows that haven't started are skipped.",
  mcpTool: false,
  schema: z.object({
    fillId: z.string().min(1).describe("Column fill ID"),
  }),
  outputSchema: columnFillOutput,
  run: ({ fillId }) => stopColumnFill(fillId),
});
