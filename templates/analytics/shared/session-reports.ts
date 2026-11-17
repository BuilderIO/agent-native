import { z } from "zod";

/**
 * A report's agent link lasts a year. Each read also checks that whoever made
 * the link can still open the report, so deleting the report or taking that
 * person's access away ends it sooner.
 */
export const SESSION_REPORT_AGENT_LINK_TTL_SECONDS = 365 * 24 * 60 * 60;

export const SESSION_REPORT_TITLE_MAX = 200;
export const SESSION_REPORT_SUMMARY_MAX = 4000;
export const SESSION_REPORT_KEY_MOMENTS_MAX = 20;
export const SESSION_REPORT_REPRO_STEPS_MAX = 20;

export const sessionReportKeyMomentSchema = z.object({
  atMs: z
    .number()
    .int()
    .min(0)
    .describe("Milliseconds after the recording started"),
  label: z.string().trim().min(1).max(300).describe("What happened then"),
});

export type SessionReportKeyMoment = z.infer<
  typeof sessionReportKeyMomentSchema
>;

export const sessionReportBuildSchema = z.object({
  commit: z.string().nullable(),
  latestCommit: z.string().optional(),
  note: z.string().optional(),
});

export type SessionReportBuild = z.infer<typeof sessionReportBuildSchema>;

export const sessionReportSchema = z.object({
  id: z.string(),
  recordingId: z.string(),
  title: z.string(),
  summary: z.string(),
  keyMoments: z.array(sessionReportKeyMomentSchema),
  reproSteps: z.array(z.string()),
  errorIssueId: z.string().nullable(),
  /** The commit the session reported when the report was made. */
  build: sessionReportBuildSchema.nullable(),
  /** The moment the report was made from, in ms after the recording started. */
  fromMs: z.number().nullable(),
  ownerEmail: z.string(),
  orgId: z.string().nullable(),
  visibility: z.enum(["private", "org", "public"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type SessionReport = z.infer<typeof sessionReportSchema>;

export function sessionReportPath(reportId: string): string {
  return `/sessions/reports/${encodeURIComponent(reportId)}`;
}
