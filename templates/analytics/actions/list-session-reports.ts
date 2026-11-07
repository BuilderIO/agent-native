import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  listSessionReports,
  sessionReportActionScope,
} from "../server/lib/session-reports.js";
import { sessionReportSchema } from "../shared/session-reports.js";

export default defineAction({
  description:
    "List the session reports the caller can open, newest first, or only one recording's. Requires the Sessions triage Lab.",
  schema: z.object({
    recordingId: z
      .string()
      .min(1)
      .optional()
      .describe("Only this recording's reports"),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50)
      .describe("At most this many, up to 100"),
  }),
  outputSchema: z.object({ reports: z.array(sessionReportSchema) }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async (args) => {
    const scope = await sessionReportActionScope();
    return { reports: await listSessionReports(args, scope) };
  },
});
