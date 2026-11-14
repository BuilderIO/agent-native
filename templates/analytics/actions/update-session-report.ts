import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  sessionReportActionScope,
  updateSessionReport,
} from "../server/lib/session-reports.js";
import {
  SESSION_REPORT_KEY_MOMENTS_MAX,
  SESSION_REPORT_REPRO_STEPS_MAX,
  SESSION_REPORT_SUMMARY_MAX,
  SESSION_REPORT_TITLE_MAX,
  sessionReportKeyMomentSchema,
  sessionReportSchema,
} from "../shared/session-reports.js";

export default defineAction({
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  description:
    "Change a session report's title, summary, key moments, repro steps or linked Monitoring error issue. Send only the fields to change: a list replaces the whole list, and errorIssueId null unlinks the issue. Needs edit access. Requires the Sessions triage Lab.",
  schema: z.object({
    id: z.string().min(1).describe("The session report id (srep_...)"),
    title: z.string().trim().min(1).max(SESSION_REPORT_TITLE_MAX).optional(),
    summary: z.string().trim().max(SESSION_REPORT_SUMMARY_MAX).optional(),
    keyMoments: z
      .array(sessionReportKeyMomentSchema)
      .max(SESSION_REPORT_KEY_MOMENTS_MAX)
      .optional(),
    reproSteps: z
      .array(z.string().trim().min(1).max(500))
      .max(SESSION_REPORT_REPRO_STEPS_MAX)
      .optional(),
    errorIssueId: z.string().min(1).nullable().optional(),
  }),
  outputSchema: sessionReportSchema,
  publicAgent: { expose: true, readOnly: false, requiresAuth: true },
  run: async ({ id, ...patch }) => {
    const scope = await sessionReportActionScope();
    return updateSessionReport(id, patch, scope);
  },
});
