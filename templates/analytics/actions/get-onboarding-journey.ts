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
    'Build the onboarding journey tree for a date window: per-session step sequences (signup, onboarding questions, setup method, app entry, first action, first output) folded into a prefix tree. format "tree" returns { window, app, rootN, coverage, nodes }: each node has n, pctOfRoot, pctOfParent, dropoffN/dropoffPct (sessions whose last observed step is that node, not a confirmed exit) and example sessions with recordingId, a recording-start-relative offsetMs to seek to, and the recording\'s viewport. format "summary" returns the same counts as an indented text outline with no examples. Check coverage.truncated first: true means counts are a partial sample or the node list was cut (see notes). Use it to plan onboarding storyboards or find where new users stop; feed the tree to the journey:capture CLI to render frames.',
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
        "Most nodes returned, largest first. When the tree has more, coverage.truncated is true and notes says how many were cut. Defaults to 60.",
      ),
    maxDepth: z.coerce
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .default(8)
      .describe(
        "Steps kept per session before sessions are folded into the deeperN count of the node at this depth. Defaults to 8.",
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
