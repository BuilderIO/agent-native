import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { getSessionFrictionDetails } from "../server/lib/session-friction.js";
import {
  listSessionRecordings,
  listSessionRecordingsPage,
  type SessionRecordingSummary,
} from "../server/lib/session-replay.js";
import {
  assertSessionsTriageLabEnabled,
  type SessionsTriageLabFeature,
} from "../server/lib/sessions-triage-lab.js";
import { MAX_SESSION_EVENT_CONDITIONS } from "../shared/session-events.js";
import {
  isSessionFrictionSort,
  SESSION_FRICTION_SIGNALS,
  SESSION_FRICTION_SORTS,
} from "../shared/session-friction.js";
import { SLOW_SESSION_FILTERS } from "../shared/session-performance.js";

function resolveScope() {
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");
  return { userEmail, orgId: getRequestOrgId() || null };
}

async function withFriction(
  scope: { userEmail: string; orgId: string | null },
  recordings: SessionRecordingSummary[],
): Promise<SessionRecordingSummary[]> {
  const friction = await getSessionFrictionDetails(scope, recordings);
  return recordings.map((recording) => ({
    ...recording,
    friction: friction.get(recording.id),
  }));
}

export default defineAction({
  description:
    "List first-party Analytics session replay recordings accessible to the current user/org. Returns recording summaries only, not raw replay chunks.",
  schema: z.object({
    query: z
      .string()
      .optional()
      .describe(
        "Broad search across recording, session, visitor, URL, app, and template fields",
      ),
    app: z.string().optional().describe("App filter"),
    template: z.string().optional().describe("Template filter"),
    sessionId: z.string().optional().describe("Analytics session id"),
    userId: z.string().optional().describe("Signed-in user email"),
    anonymousId: z
      .string()
      .optional()
      .describe(
        "Secondary anonymous id filter for otherwise email-backed recordings",
      ),
    path: z.string().optional().describe("Exact path filter"),
    from: z
      .string()
      .optional()
      .describe("Inclusive started_at lower bound as an ISO timestamp"),
    to: z
      .string()
      .optional()
      .describe("Inclusive started_at upper bound as an ISO timestamp"),
    minDurationMs: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Only include recordings at least this long"),
    hasErrors: z.boolean().optional().describe("Only recordings with errors"),
    hasRageClicks: z
      .boolean()
      .optional()
      .describe("Only recordings with detected rage clicks"),
    hasNetworkErrors: z
      .boolean()
      .optional()
      .describe("Only recordings with failed network requests"),
    hideEmpty: z
      .boolean()
      .optional()
      .describe("Exclude recordings with zero duration"),
    hideInternal: z
      .boolean()
      .optional()
      .describe("Exclude visitors using the organization's email domains"),
    visitorType: z.enum(["internal", "work", "personal"]).optional(),
    emailDomain: z
      .string()
      .optional()
      .describe("Exact visitor email domain, without @"),
    sort: z
      .enum([
        "newest",
        "longest",
        "errors",
        "events",
        "rage",
        ...SESSION_FRICTION_SORTS,
      ])
      .optional()
      .describe(
        "Sort order. `friction` (score) and the friction signal names sort measured sessions first, unmeasured last, and require the Sessions triage Lab.",
      ),
    offset: z.coerce.number().int().min(0).optional(),
    paginated: z
      .boolean()
      .optional()
      .describe(
        "Return recordings, total count, and app counts rather than the legacy recordings array. Friction filters and sorts, `slow`, and `includePerformance` always return this shape.",
      ),
    status: z.enum(["active", "completed"]).optional(),
    didEvents: z
      .array(z.string().min(1).max(200))
      .max(MAX_SESSION_EVENT_CONDITIONS)
      .optional()
      .describe(
        "Only sessions that tracked every one of these event names. Requires the Sessions triage Lab; covers sessions recorded after the event index started.",
      ),
    didNotEvents: z
      .array(z.string().min(1).max(200))
      .max(MAX_SESSION_EVENT_CONDITIONS)
      .optional()
      .describe(
        "Only sessions that tracked none of these event names. Requires the Sessions triage Lab; covers sessions recorded after the event index started.",
      ),
    frictionSignals: z
      .array(z.enum(SESSION_FRICTION_SIGNALS))
      .max(SESSION_FRICTION_SIGNALS.length)
      .optional()
      .describe(
        "Only sessions that showed every one of these friction signals. Requires the Sessions triage Lab and never matches an unmeasured session. With a friction filter or sort the response has `frictionCoverageStartedAt` for the viewer's own org and personal recordings: sessions before it were not measured, and null means some sessions in the range have no friction coverage at all, so read an empty result against it before calling it zero. A recording shared from elsewhere reads unmeasured on its own row.",
      ),
    includeFriction: z
      .boolean()
      .optional()
      .describe(
        "Add each recording's friction: score, signal counts, top signals, failed actions and agent failures grouped by cause, and linked Monitoring error issues. A null part means it was not measured, not zero: `thumbs_down`, `cancelled_runs`, and `quick_backs` can be null alone, and `errorIssues` null means the links are unknown while [] means no issues. Requires the Sessions triage Lab.",
      ),
    slow: z
      .enum(SLOW_SESSION_FILTERS)
      .optional()
      .describe(
        "Only slow sessions: vitals = a page view with a poor Core Web Vital (LCP > 4 s, INP > 500 ms, CLS > 0.25, or TTFB > 1.8 s); requests = an action request of 1 s or more (not the 3 s `stalled_requests` friction signal); any = either, plus sessions whose measurements failed to save, since missing data cannot rule them out. Sessions without measurements never match. Requires the Sessions triage Lab.",
      ),
    includePerformance: z
      .boolean()
      .optional()
      .describe(
        "Attach each recording's speed summary as performance, plus performanceCoverageStartedAt: worst measured page-view vitals, slowRequests (null when no request was measured), maxRequestMs, atLeast (fields that hit the measurement ceiling, so each is a floor), and incomplete (some measurements failed to save, so it may be slower). performance is null when never measured. Requires the Sessions triage Lab.",
      ),
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  }),
  http: { method: "GET" },
  readOnly: true,
  mcpTool: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  grounding: true,
  run: async (args) => {
    const scope = resolveScope();
    const frictionApplied = Boolean(
      args.frictionSignals?.length || isSessionFrictionSort(args.sort),
    );
    const labFeatures: SessionsTriageLabFeature[] = [];
    if (args.didEvents?.length || args.didNotEvents?.length) {
      labFeatures.push("events");
    }
    if (frictionApplied || args.includeFriction) labFeatures.push("friction");
    if (args.slow || args.includePerformance) labFeatures.push("speed");
    if (labFeatures.length) {
      await assertSessionsTriageLabEnabled(
        scope.userEmail,
        scope.orgId,
        labFeatures,
      );
    }
    const { includeFriction, ...filters } = args;
    // The legacy array has no room for the friction or speed coverage start,
    // and without it an empty match cannot be told apart from "not measured".
    const coverageNeeded =
      frictionApplied || Boolean(args.slow || args.includePerformance);
    if (!args.paginated && !coverageNeeded) {
      const recordings = await listSessionRecordings(scope, filters);
      return includeFriction ? withFriction(scope, recordings) : recordings;
    }
    const page = await listSessionRecordingsPage(scope, filters);
    return includeFriction
      ? { ...page, recordings: await withFriction(scope, page.recordings) }
      : page;
  },
});
