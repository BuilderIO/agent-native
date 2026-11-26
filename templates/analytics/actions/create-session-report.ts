import { defineAction } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { z } from "zod";

import {
  createSessionReport,
  sessionReportActionScope,
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
    destructiveHint: false,
    openWorldHint: false,
  },
  description:
    "Save a report on one session replay: a title and summary you write from the session's evidence, its key moments, the steps that reproduce the problem, and the Monitoring error issue it hit. Read the session-replay skill, get-session-replay-summary and get-session-replay-timeline first, and write only what the session shows. The report records the commit the session reported by itself, opens to the caller's organization when the recording is org-visible there (private otherwise), and lives at /sessions/reports/<id>. Requires the Sessions triage Lab.",
  schema: z.object({
    recordingId: z.string().min(1).describe("The session_recordings id"),
    title: z
      .string()
      .trim()
      .min(1)
      .max(SESSION_REPORT_TITLE_MAX)
      .describe(
        "What went wrong, in one line, such as: Deck stayed empty after the upload failed",
      ),
    summary: z
      .string()
      .trim()
      .max(SESSION_REPORT_SUMMARY_MAX)
      .describe(
        "What happened and why, in plain words, citing the moments that show it",
      ),
    keyMoments: z
      .array(sessionReportKeyMomentSchema)
      .max(SESSION_REPORT_KEY_MOMENTS_MAX)
      .default([])
      .describe("The moments that show the problem, in time order"),
    reproSteps: z
      .array(z.string().trim().min(1).max(500))
      .max(SESSION_REPORT_REPRO_STEPS_MAX)
      .default([])
      .describe("Steps that reproduce it, one action each"),
    errorIssueId: z
      .string()
      .min(1)
      .optional()
      .describe(
        "The Monitoring error issue (erriss_...) the session hit, if any",
      ),
    fromMs: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "The moment the person made the report from, in ms after the recording started",
      ),
  }),
  outputSchema: sessionReportSchema,
  publicAgent: { expose: true, readOnly: false, requiresAuth: true },
  run: async (args) => {
    const scope = await sessionReportActionScope();
    return createSessionReport(args, scope);
  },
  link: ({ result }) => ({
    url: buildDeepLink({
      app: "analytics",
      view: "session-report",
      params: { reportId: result.id },
    }),
    label: "Open the report in Analytics",
    view: "session-report",
  }),
});
