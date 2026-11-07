import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  getSessionReport,
  sessionReportActionScope,
} from "../server/lib/session-reports.js";
import { sessionReportSchema } from "../shared/session-reports.js";

export default defineAction({
  description:
    "Get one session report: its title, summary, key moments (atMs is ms after the recording started), repro steps, linked Monitoring error issue, the commit the session reported, and the recording it cites. role is the caller's access. Read the session itself with get-session-replay-summary and recordingId; a recording past replay retention is gone, while its reports stay. Requires the Sessions triage Lab.",
  schema: z.object({
    id: z.string().min(1).describe("The session report id (srep_...)"),
  }),
  outputSchema: sessionReportSchema.extend({ role: z.string() }),
  http: { method: "GET" },
  readOnly: true,
  mcpTool: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async ({ id }) => {
    const scope = await sessionReportActionScope();
    return getSessionReport(id, scope);
  },
});
