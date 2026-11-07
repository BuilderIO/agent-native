import { randomUUID } from "node:crypto";

import { fail } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
  recordChange,
  verifyScopedAgentAccessToken,
} from "@agent-native/core/server";
import {
  accessFilter,
  assertAccess,
  resolveAccess,
  type AccessContext,
} from "@agent-native/core/sharing";
import { and, desc, eq } from "drizzle-orm";

import { ANALYTICS_SESSION_REPORT_AGENT_RESOURCE_KIND } from "../../shared/resource-agent-access.js";
import {
  sessionReportBuildSchema,
  sessionReportKeyMomentSchema,
  type SessionReport,
  type SessionReportKeyMoment,
} from "../../shared/session-reports.js";
import { getDb, schema } from "../db/index.js";
import { getErrorIssue } from "./error-capture.js";
import {
  buildSessionReplayAgentContext,
  createSessionReplayAgentGrant,
  replayBuild,
} from "./session-replay-agent-context.js";
import { getSessionReplaySummary, type ReplayScope } from "./session-replay.js";
import { assertSessionsTriageLabEnabled } from "./sessions-triage-lab.js";

const RESOURCE_TYPE = "session-report";

export interface SessionReportInput {
  title: string;
  summary: string;
  keyMoments: SessionReportKeyMoment[];
  reproSteps: string[];
  errorIssueId?: string | null | undefined;
}

type SessionReportPatch = {
  [K in keyof SessionReportInput]?: SessionReportInput[K] | undefined;
};

/** The signed-in caller, once the Sessions triage Lab is on for them. */
export async function sessionReportActionScope(): Promise<ReplayScope> {
  const userEmail = getRequestUserEmail();
  if (!userEmail) {
    fail("no authenticated user", {
      errorCode: "unauthenticated",
      statusCode: 401,
    });
  }
  const orgId = getRequestOrgId() || null;
  await assertSessionsTriageLabEnabled(userEmail, orgId, ["reports"]);
  return { userEmail, orgId };
}

function reportError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

function accessContext(scope: ReplayScope): AccessContext {
  return scope.orgId
    ? { userEmail: scope.userEmail, orgId: scope.orgId }
    : { userEmail: scope.userEmail };
}

// These columns are written only by this file, so a value that doesn't parse
// is a damaged row, not an empty report.
function parseStoredJson(row: { id: string }, column: string, raw: unknown) {
  if (typeof raw !== "string") {
    throw reportError(
      `Session report ${row.id} has an unreadable ${column}`,
      500,
    );
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw reportError(
      `Session report ${row.id} has an unreadable ${column}`,
      500,
    );
  }
}

type SessionReportRow = typeof schema.sessionReports.$inferSelect;

function rowToReport(row: SessionReportRow): SessionReport {
  const keyMoments = sessionReportKeyMomentSchema
    .array()
    .safeParse(parseStoredJson(row, "key_moments", row.keyMoments));
  const reproSteps = parseStoredJson(row, "repro_steps", row.reproSteps);
  const build =
    row.build === null
      ? null
      : sessionReportBuildSchema.safeParse(
          parseStoredJson(row, "build", row.build),
        );
  if (
    !keyMoments.success ||
    !Array.isArray(reproSteps) ||
    !reproSteps.every((step) => typeof step === "string") ||
    (build !== null && !build.success)
  ) {
    throw reportError(`Session report ${row.id} has unreadable fields`, 500);
  }
  return {
    id: row.id,
    recordingId: row.recordingId,
    title: row.title,
    summary: row.summary,
    keyMoments: keyMoments.data,
    reproSteps,
    errorIssueId: row.errorIssueId ?? null,
    build: build?.data ?? null,
    fromMs: row.fromMs ?? null,
    ownerEmail: row.ownerEmail,
    orgId: row.orgId ?? null,
    visibility: row.visibility,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function recordReportChange(
  type: "change" | "delete",
  report: Pick<SessionReport, "id" | "ownerEmail" | "orgId" | "visibility">,
) {
  recordChange({
    source: "session-reports",
    type,
    key: report.id,
    ...(report.visibility === "org" && report.orgId
      ? { orgId: report.orgId }
      : { owner: report.ownerEmail }),
  });
}

async function assertErrorIssueReadable(
  scope: ReplayScope,
  errorIssueId: string,
): Promise<void> {
  await getErrorIssue(scope, errorIssueId, { eventsLimit: 1 });
}

export async function createSessionReport(
  input: SessionReportInput & {
    recordingId: string;
    fromMs?: number | null | undefined;
  },
  scope: ReplayScope,
): Promise<SessionReport> {
  const recording = await getSessionReplaySummary(input.recordingId, scope);
  if (input.errorIssueId) {
    await assertErrorIssueReadable(scope, input.errorIssueId);
  }
  const now = new Date().toISOString();
  const row = {
    id: `srep_${randomUUID().replace(/-/g, "")}`,
    recordingId: recording.id,
    title: input.title,
    summary: input.summary,
    keyMoments: JSON.stringify(input.keyMoments),
    reproSteps: JSON.stringify(input.reproSteps),
    errorIssueId: input.errorIssueId ?? null,
    build: JSON.stringify(replayBuild(recording)),
    fromMs: input.fromMs ?? null,
    createdAt: now,
    updatedAt: now,
    ownerEmail: scope.userEmail,
    orgId: scope.orgId,
    // Org by default, like Clips' bug reports: the people who can see the
    // session can see what was found in it.
    visibility: scope.orgId ? ("org" as const) : ("private" as const),
  };
  await getDb().insert(schema.sessionReports).values(row);
  const report = rowToReport(row);
  recordReportChange("change", report);
  return report;
}

export async function getSessionReport(
  reportId: string,
  scope: ReplayScope,
): Promise<SessionReport & { role: string }> {
  const access = await resolveAccess(
    RESOURCE_TYPE,
    reportId,
    accessContext(scope),
  );
  if (!access) throw reportError("Session report not found", 404);
  return { ...rowToReport(access.resource), role: access.role };
}

export async function updateSessionReport(
  reportId: string,
  patch: SessionReportPatch,
  scope: ReplayScope,
): Promise<SessionReport> {
  await assertAccess(RESOURCE_TYPE, reportId, "editor", accessContext(scope));
  if (patch.errorIssueId) {
    await assertErrorIssueReadable(scope, patch.errorIssueId);
  }
  const update: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.summary !== undefined) update.summary = patch.summary;
  if (patch.keyMoments !== undefined) {
    update.keyMoments = JSON.stringify(patch.keyMoments);
  }
  if (patch.reproSteps !== undefined) {
    update.reproSteps = JSON.stringify(patch.reproSteps);
  }
  if (patch.errorIssueId !== undefined) {
    update.errorIssueId = patch.errorIssueId;
  }
  const updated = await getDb()
    .update(schema.sessionReports)
    .set(update)
    .where(eq(schema.sessionReports.id, reportId))
    .returning();
  const row = updated[0] as SessionReportRow | undefined;
  if (!row) throw reportError("Session report not found", 404);
  const report = rowToReport(row);
  recordReportChange("change", report);
  return report;
}

export async function deleteSessionReport(
  reportId: string,
  scope: ReplayScope,
): Promise<{ id: string; deleted: true }> {
  const access = await assertAccess(
    RESOURCE_TYPE,
    reportId,
    "admin",
    accessContext(scope),
  );
  const report = rowToReport(access.resource);
  const db = getDb();
  await db
    .delete(schema.sessionReportShares)
    .where(eq(schema.sessionReportShares.resourceId, reportId));
  await db
    .delete(schema.sessionReports)
    .where(eq(schema.sessionReports.id, reportId));
  recordReportChange("delete", report);
  return { id: reportId, deleted: true };
}

export async function listSessionReports(
  options: { recordingId?: string | undefined; limit: number },
  scope: ReplayScope,
): Promise<SessionReport[]> {
  const access = accessFilter(
    schema.sessionReports,
    schema.sessionReportShares,
    accessContext(scope),
  );
  const rows = await getDb()
    .select()
    .from(schema.sessionReports)
    .where(
      options.recordingId
        ? and(
            access,
            eq(schema.sessionReports.recordingId, options.recordingId),
          )
        : access,
    )
    .orderBy(desc(schema.sessionReports.createdAt))
    .limit(options.limit);
  return rows.map(rowToReport);
}

/**
 * The report an agent link opens, while whoever made the link can still open
 * the report. Null for a bad, expired or revoked link.
 */
async function resolveReportForAgentLink(
  reportId: string,
  token: string,
): Promise<{ report: SessionReport; makerScope: ReplayScope } | null> {
  const verified = verifyScopedAgentAccessToken(token, {
    resourceKind: ANALYTICS_SESSION_REPORT_AGENT_RESOURCE_KIND,
    resourceId: reportId,
  });
  if (!verified.ok || !verified.viewerEmail) return null;
  const db = getDb();
  // guard:allow-unscoped -- reads one row by id only to learn its org; the resolveAccess call below decides whether the link's maker may still open it.
  const rows = await db
    .select({ orgId: schema.sessionReports.orgId })
    .from(schema.sessionReports)
    .where(eq(schema.sessionReports.id, reportId))
    .limit(1);
  const row = rows[0] as (typeof rows)[number] | undefined;
  if (!row) return null;
  const makerScope = {
    userEmail: verified.viewerEmail,
    orgId: row.orgId ?? null,
  };
  const access = await resolveAccess(
    RESOURCE_TYPE,
    reportId,
    accessContext(makerScope),
  );
  if (!access) return null;
  return { report: rowToReport(access.resource), makerScope };
}

export async function buildSessionReportAgentContext({
  reportId,
  token,
  origin,
}: {
  reportId: string;
  token: string;
  origin?: string | undefined;
}) {
  const resolved = await resolveReportForAgentLink(reportId, token);
  if (!resolved) {
    throw reportError("Invalid, expired or revoked agent link", 401);
  }
  const { report, makerScope } = resolved;
  let session: unknown;
  let sessionUnavailable: string | undefined;
  try {
    // A fresh two-hour session link on every read, so the session's own
    // links in this context work for as long as the report link does.
    const { grant } = await createSessionReplayAgentGrant({
      recordingId: report.recordingId,
      scope: makerScope,
    });
    session = await buildSessionReplayAgentContext({
      recordingId: report.recordingId,
      token: grant.token,
      ...(origin ? { origin } : {}),
    });
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode !== 404) throw error;
    sessionUnavailable =
      "The session replay this report cites is no longer stored, or the person who made this link can no longer open it. The report's own fields still stand.";
  }
  return {
    type: "agent-native.analytics.session-report",
    version: 1,
    instructions: [
      "This is a report a person saved about one session replay: their title, summary, key moments, repro steps, the linked Monitoring error issue, and the commit the session reported.",
      "Start from the report, then use session for the replay's full agent context: its keyMoments, diagnostics and timeline. Its links last two hours; fetch this report link again for fresh ones.",
      "This link is read-only and scoped to this report. Do not store it in code, docs, screenshots, or long-lived notes.",
    ],
    report: {
      id: report.id,
      title: report.title,
      summary: report.summary,
      keyMoments: report.keyMoments,
      reproSteps: report.reproSteps,
      errorIssueId: report.errorIssueId,
      build: report.build,
      fromMs: report.fromMs,
      recordingId: report.recordingId,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
    },
    ...(sessionUnavailable
      ? { session: null, sessionUnavailable }
      : { session }),
  };
}
