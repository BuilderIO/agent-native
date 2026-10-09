import { defineAction, fail } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import {
  FIRST_PARTY_TEMPLATE_NAMES,
  isCalendarDate,
} from "../server/lib/first-party-metric-catalog.js";
import {
  getOnboardingJourney,
  JourneyRecordingsError,
} from "../server/lib/onboarding-journey.js";

const MAX_WINDOW_DAYS = 90;
const MAX_DEPTH = 40;

function resolveScope() {
  const userEmail = getRequestUserEmail();
  if (!userEmail)
    fail("Sign in to use this action.", {
      errorCode: "unauthenticated",
      statusCode: 401,
    });
  return { userEmail, orgId: getRequestOrgId() || null };
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isCalendarDate, { message: "must be a real calendar date" });

export default defineAction({
  description:
    'Build a per-session onboarding journey tree from signup through the first saved output. Clips uses recording_ready; Slides uses explicit generation_completed; Design uses generation_completed or design_output_created. Starts are attempt steps, not outputs. Slides acceptance and failed, stuck, cancelled, abandoned, or unresolved outcomes are separate attempt steps; unresolved stays unresolved even when persisted_output is true, and a missing terminal event stays absent. Edits and views do not establish a saved output. A saved output or Slides attempt event without a session is attached only when its exact output/attempt pair matches exactly one onboarding cohort session; otherwise it stays unattributed. Output and attempt IDs are never returned. format "tree" returns { window, app, rootN, coverage, nodes } for onboarding sessions plus standaloneSetup for Home chat integration sessions without onboarding, with a separate denominator. Nodes include n, pctOfRoot, pctOfParent, dropoffN/dropoffPct (last observed step, not a confirmed exit), deeperN, and recording examples. followUpMode "session" (default) preserves bounded same-session counts after each terminal selected step; missing later events are not abandonment or churn. followUpMode "person" adds personFollowUp, assigning each distinct canonical person to their latest terminal selected step and checking later native Analytics events in the selected session/app and across other first-party sessions/apps over a fixed 30-day horizon. Cross-session matching uses only direct properties.auth_user_id; missing or organization pseudo-identities stay unknown. Selected-session/app and outside-session/app evidence may overlap; explicit both and anywhere counts show the overlap. The frozen observationWatermark, follow-up duration, censoring, identity-join, and read-coverage fields bound the estimate. No activity means no event was observed within a fully observed horizon; it is not permanent churn. Sessions without a selected step and identity-unavailable sessions are not no-activity people. If the event read or aggregate is incomplete/truncated, personFollowUp counts and percentages are null. Existing tree session counts and direct-parent denominators remain unchanged. Check coverage.truncated first. format "summary" returns the same counts as indented outlines without examples. For a standalone storyboard, pass standaloneSetup as the top-level tree to journey:capture.',
  schema: z.object({
    dateFrom: isoDate.describe(
      "Inclusive UTC start date, YYYY-MM-DD. Sessions that began earlier appear mid-journey, so start a day before the period you care about.",
    ),
    dateTo: isoDate.describe(
      `Inclusive UTC end date, YYYY-MM-DD, at most ${MAX_WINDOW_DAYS} days after dateFrom. Events are windowed before any join.`,
    ),
    app: z
      .enum(["all", ...FIRST_PARTY_TEMPLATE_NAMES])
      .optional()
      .default("all")
      .describe(
        'Template filter: "all" or one first-party template such as clips, design, or slides. Defaults to "all".',
      ),
    emailFilter: z
      .enum(["all", "exclude_builder", "only_builder"])
      .optional()
      .default("exclude_builder")
      .describe(
        'Builder-employee scope, as in the onboarding metrics: "exclude_builder" (default), "only_builder", or "all". Test identities are always excluded.',
      ),
    followUpMode: z
      .enum(["session", "person"])
      .optional()
      .default("session")
      .describe(
        'Follow-up grain: "session" (default) keeps existing same-session counts; "person" adds a scoped 30-day cross-session, cross-app estimate joined only by direct canonical auth_user_id.',
      ),
    format: z
      .enum(["tree", "summary"])
      .optional()
      .default("tree")
      .describe(
        'Output shape: "tree" (default) with example sessions, or "summary", an indented text outline of counts and drop-off with no examples.',
      ),
    maxNodes: z.coerce
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .default(60)
      .describe(
        "Most nodes in each independently counted tree, largest first. When a tree has more, coverage.truncated is true and notes says how many were cut. Defaults to 60.",
      ),
    maxDepth: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_DEPTH)
      .optional()
      .default(8)
      .describe(
        `Steps kept per session, at most ${MAX_DEPTH}. Sessions that continue beyond the requested depth appear in node.deeperN and set coverage.truncated. Defaults to 8.`,
      ),
    minNodeSessions: z.coerce
      .number()
      .int()
      .min(1)
      .optional()
      .default(1)
      .describe(
        'Branches with fewer sessions than this merge into one "other" child per parent. Defaults to 1 (nothing merges).',
      ),
    examplesPerNode: z.coerce
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .default(3)
      .describe("Example sessions returned per node. Defaults to 3."),
    maxEventRows: z.coerce
      .number()
      .int()
      .min(1000)
      .max(200000)
      .optional()
      .default(40000)
      .describe(
        "Event rows to read before stopping and reporting coverage.truncated. Each 4,000 rows is one query; raise it only for a wide window. Defaults to 40000.",
      ),
    recency: z
      .enum(["newest", "none"])
      .optional()
      .default("newest")
      .describe(
        'Example order after replay availability: "newest" (default) prefers recent sessions, "none" orders by session id.',
      ),
    settleMs: z.coerce
      .number()
      .int()
      .min(0)
      .max(5000)
      .optional()
      .default(300)
      .describe(
        "Added to each example's offsetMs so the frame has rendered. Defaults to 300.",
      ),
    minAspect: z.coerce
      .number()
      .positive()
      .optional()
      .describe("Only examples whose viewport width/height is at least this."),
    maxAspect: z.coerce
      .number()
      .positive()
      .optional()
      .describe("Only examples whose viewport width/height is at most this."),
    minWidth: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe("Only examples whose viewport is at least this many px wide."),
    maxWidth: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe("Only examples whose viewport is at most this many px wide."),
    requireKnownViewport: z
      .boolean()
      .optional()
      .describe(
        "Leave out examples whose viewport was not recorded or cannot be read. Without it they are kept with viewport null and a viewportReason.",
      ),
  }),
  http: { method: "GET" },
  readOnly: true,
  mcpTool: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  grounding: true,
  run: async (args) => {
    const days =
      (Date.parse(`${args.dateTo}T00:00:00Z`) -
        Date.parse(`${args.dateFrom}T00:00:00Z`)) /
      86_400_000;
    if (days < 0) fail("dateTo must not be before dateFrom.");
    if (days > MAX_WINDOW_DAYS) {
      fail(`The window may span at most ${MAX_WINDOW_DAYS} days.`);
    }
    const viewport = {
      ...(args.minAspect !== undefined ? { minAspect: args.minAspect } : {}),
      ...(args.maxAspect !== undefined ? { maxAspect: args.maxAspect } : {}),
      ...(args.minWidth !== undefined ? { minWidth: args.minWidth } : {}),
      ...(args.maxWidth !== undefined ? { maxWidth: args.maxWidth } : {}),
      ...(args.requireKnownViewport ? { requireKnown: true } : {}),
    };
    const scope = resolveScope();
    try {
      return await getOnboardingJourney(scope, {
        dateFrom: args.dateFrom,
        dateTo: args.dateTo,
        app: args.app,
        emailFilter: args.emailFilter,
        followUpMode: args.followUpMode,
        format: args.format,
        maxNodes: args.maxNodes,
        maxDepth: args.maxDepth,
        minNodeSessions: args.minNodeSessions,
        examplesPerNode: args.examplesPerNode,
        maxEventRows: args.maxEventRows,
        settleMs: args.settleMs,
        recency: args.recency,
        viewport: Object.keys(viewport).length ? viewport : undefined,
      });
    } catch (error) {
      // Causes can quote database details; the server log keeps them.
      console.error("[get-onboarding-journey] failed", error);
      if (error instanceof JourneyRecordingsError) {
        fail(
          `${error.message} Examples would misreport which sessions have a replay, so no tree was built; retry, or use format "summary" for counts only.`,
          { errorCode: "journey_recordings_unreadable", statusCode: 502 },
        );
      }
      fail(
        "Onboarding journey events could not be read, so no tree was built. Retry with a narrower window or app.",
        { errorCode: "journey_events_unreadable", statusCode: 502 },
      );
    }
  },
});
