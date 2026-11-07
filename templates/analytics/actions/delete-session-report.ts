import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  deleteSessionReport,
  sessionReportActionScope,
} from "../server/lib/session-reports.js";

export default defineAction({
  description:
    "Delete a session report and its shares, which also ends its agent links. The session replay it cites is untouched. Only its owner or an admin can. Requires the Sessions triage Lab.",
  schema: z.object({
    id: z.string().min(1).describe("The session report id (srep_...)"),
  }),
  outputSchema: z.object({ id: z.string(), deleted: z.literal(true) }),
  publicAgent: { expose: true, readOnly: false, requiresAuth: true },
  run: async ({ id }) => {
    const scope = await sessionReportActionScope();
    return deleteSessionReport(id, scope);
  },
});
