import { defineAction } from "@agent-native/core/action";
import { getDataProgramDetails } from "@agent-native/core/data-programs";
import { getCredentialContext } from "@agent-native/core/server/request-context";
import { z } from "zod";

import { ANALYTICS_APP_ID } from "../server/lib/provider-credentials";

export default defineAction({
  description:
    "Get one Analytics data program's metadata, code, and last finished run. When that run failed, lastGoodRun is the newest successful one. scheduledRefresh says whether the server refreshes its org-shared run on a schedule, and orgSharedRun is that run's latest outcome. Pass includeRows to return their cached rows.",
  schema: z.object({
    programId: z.string().min(1),
    includeRows: z.boolean().optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  mcpTool: true,
  run: async (args) => {
    const ctx = getCredentialContext();
    if (!ctx) throw new Error("No authenticated context for get-data-program.");
    return getDataProgramDetails(args.programId, ANALYTICS_APP_ID, ctx, {
      includeRows: args.includeRows,
    });
  },
});
