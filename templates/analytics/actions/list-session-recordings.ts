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
import { assertSessionsTriageLabEnabled } from "../server/lib/sessions-triage-lab.js";
import { MAX_SESSION_EVENT_CONDITIONS } from "../shared/session-events.js";
import {
  isSessionFrictionSort,
  SESSION_FRICTION_SIGNALS,
  SESSION_FRICTION_SORTS,
} from "../shared/session-friction.js";

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
    "List first-party Analytics session replay recordings accessible to the current user/org. Returns scoped recording summaries only, not raw replay chunks.",
  schema: z.object({
    query: z
      .string()
      .optional()
      .describe(
        "Optional broad search across recording, session, visitor, URL, app, and template fields",
      ),
    app: z.string().optional().describe("Optional app filter"),
    template: z.string().optional().describe("Optional template filter"),
    sessionId: z.string().optional().describe("Optional analytics session id"),
    userId: z.string().optional().describe("Optional signed-in user email"),
    anonymousId: z
      .string()
      .optional()
      .describe(
        "Optional secondary anonymous id filter for otherwise email-backed recordings",
      ),
    path: z.string().optional().describe("Optional exact path filter"),
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
        "Sort order. `friction` (score) and the friction signal names sort measured sessions first and require the Sessions triage Lab.",
      ),
    offset: z.coerce.number().int().min(0).optional(),
    paginated: z
      .boolean()
      .optional()
      .describe(
        "Return recordings, total count, and app counts rather than the legacy recordings array",
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
        "Only sessions that showed every one of these friction signals. Requires the Sessions triage Lab; covers sessions measured since friction tracking began, and never matches an unmeasured session.",
      ),
    includeFriction: z
      .boolean()
      .optional()
      .describe(
        "Add each recording's friction: score, signal counts, top signals, failed actions and agent failures grouped by cause, and linked Monitoring error issues. A null part means it was not measured, not zero. Requires the Sessions triage Lab.",
      ),
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  grounding: true,
  run: async (args) => {
    const scope = resolveScope();
    if (
      args.didEvents?.length ||
      args.didNotEvents?.length ||
      args.frictionSignals?.length ||
      isSessionFrictionSort(args.sort) ||
      args.includeFriction
    ) {
      await assertSessionsTriageLabEnabled(scope.userEmail, scope.orgId);
    }
    const { includeFriction, ...filters } = args;
    if (!args.paginated) {
      const recordings = await listSessionRecordings(scope, filters);
      return includeFriction ? withFriction(scope, recordings) : recordings;
    }
    const page = await listSessionRecordingsPage(scope, filters);
    return includeFriction
      ? { ...page, recordings: await withFriction(scope, page.recordings) }
      : page;
  },
});
