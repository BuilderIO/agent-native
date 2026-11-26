import { defineAction } from "@agent-native/core/action";
import { listDataProgramSummaries } from "@agent-native/core/data-programs";
import { getCredentialContext } from "@agent-native/core/server/request-context";
import { z } from "zod";

import { ANALYTICS_APP_ID } from "../server/lib/provider-credentials";

export default defineAction({
  description:
    "List the saved Analytics data programs the caller can access. Use get-data-program to read one program's code and cached results.",
  schema: z.object({
    includeArchived: z.boolean().optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  mcpTool: true,
  run: async (args) => {
    const ctx = getCredentialContext();
    if (!ctx)
      throw new Error("No authenticated context for list-data-programs.");
    return listDataProgramSummaries(ANALYTICS_APP_ID, ctx, {
      includeArchived: args.includeArchived,
    });
  },
});
