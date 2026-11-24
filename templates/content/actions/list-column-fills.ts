import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listColumnFills } from "../server/lib/column-fill.js";
import { columnFillOutput } from "./_column-fill-output.js";

export default defineAction({
  description:
    "List the current user's latest column fill for each column of a collection, with each cell's progress.",
  readOnly: true,
  http: { method: "GET" },
  mcpTool: false,
  schema: z.object({
    databaseId: z.string().min(1).describe("Collection ID"),
  }),
  outputSchema: z.object({ fills: z.array(columnFillOutput) }),
  run: async ({ databaseId }) => ({
    fills: await listColumnFills(databaseId),
  }),
});
