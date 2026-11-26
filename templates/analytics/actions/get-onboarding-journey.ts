import { defineAction, fail } from "@agent-native/core/action";
import type { ActionRunContext } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import {
  allowanceApprovalNotice,
  allowanceBudget,
  allowanceToAskAbout,
  firstPartyQueriesRunOnBigQuery,
  needsAllowanceApproval,
  recordReviewedAllowance,
} from "../server/lib/bigquery-agent-approval.js";
import { outsideAgentIdentity } from "../server/lib/bigquery-agent-budget.js";
import {
  describeOutsideAgentBigQueryReport,
  failForOutsideAgentRefusal,
  outsideAgentCallReportOf,
  runOutsideAgentBigQueryCall,
} from "../server/lib/bigquery-agent-calls.js";
import {
  isOutsideAgentCaller,
  OutsideAgentBigQueryRefusalError,
} from "../server/lib/bigquery-agent-context.js";
import {
  FIRST_PARTY_TEMPLATE_NAMES,
  isCalendarDate,
} from "../server/lib/first-party-metric-catalog.js";
import {
  approvedOutsideAgentOnboardingBound,
  outsideAgentOnboardingEventBytes,
  smallestOutsideAgentOnboardingCall,
} from "../server/lib/onboarding-journey-agent-budget.js";
import {
  DEFAULT_ONBOARDING_EVENT_ROW_BUDGET,
  getOnboardingJourney,
  MAX_ONBOARDING_EVENT_ROW_BUDGET,
  ONBOARDING_JOURNEY_EXPERIMENT_IDS,
  ONBOARDING_EVENTS_DEFAULT_MAX_TOTAL_BYTES_BILLED,
  ONBOARDING_EVENTS_MAX_BYTES_BILLED,
  ONBOARDING_EVENTS_MAX_TOTAL_BYTES_BILLED,
  ONBOARDING_EVENTS_OUTSIDE_AGENT_DEFAULT_MAX_TOTAL_BYTES_BILLED,
  ONBOARDING_JOURNEY_QUERY_BUDGET_MS,
  OnboardingJourneyReadError,
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
    'Return an access-scoped per-session onboarding tree through explicit saved-output events, preserving session counts and direct-parent denominators. When experimentId or splitDesignFirstTouch is supplied, return independent trees for each cohort; Design first-touch cohorts are crossed with experiment arms, and sessionless MCP OAuth signups are counted as events without replay. An aggregated `other` node includes up to 20 root-to-branch label paths, source step keys for identical paths, session counts, and direct-parent percentages; branch summaries are capped at 200 per tree and 64 KiB of serialized detail. `otherBranchCount` gives the full number of branches, and `otherBranchSummariesPartial: true` marks summaries omitted by those bounds. Labels/path segments longer than 300 characters and keys longer than 2,048 characters are visibly shortened with stable hash suffixes and truncation flags so the tree stays within the Design input contract. Journey counts stay bounded by the 200,000-event read cap. BigQuery pages have a 25 GB per-query cap, and maxTotalBytesBilled bounds how many of them one event read may run, counting only pages not already cached; it defaults to 275 GB, or 125 GB for an outside agent over MCP, whose BigQuery jobs count against its daily budget ($1 a person without asking, a $5 person ceiling, $50 an organization, per UTC day) and whose maxTotalBytesBilled is capped at what that budget can still pay for; such a response adds bigQueryBudget with the reserved and billed cost of the call and what is left today. Event and follow-up queries stop inside a 22-second time budget (15 seconds for the event read, follow-ups get the rest), leaving room in a hosted call before its gateway gives up; tree-format replay lookups run after that budget, so prefer format "summary" for long windows; coverage.truncated and notes identify partial counts, and when a time limit or maxTotalBytesBilled stopped the call, continueWith.observationWatermark lets the same call continue from the queries already cached or still running, and stoppedPage says which step the BigQuery event page the read was waiting on had reached (preparing, checking the cache, waiting for another call running the same page, getting BigQuery credentials, submitting, checking an earlier job, polling, saving or finished) and why any earlier job under the same name could not be collected; coverage.followupAggregateRead.stoppedQuery says the same for a follow-up whose BigQuery query ran out of time. Raise maxTotalBytesBilled deliberately to read more pages, up to 1.275 TB. When event coverage is truncated, replay reads are skipped, coverage.sessionsWithReplay is null, and examples omit recordingId with viewportReason "recording_unknown"; recordingId null means a completed lookup found no replay. followUpMode "session" keeps existing bounded same-session counts. "person" adds aggregate-only activity joined into people by agreed session emails and direct canonical auth_user_id, matching later activity by any email or ID of that person (emails compared as hashes computed in the warehouse), across first-party sessions and apps over a fixed 30-day horizon, with a 25 GB bytes-billed cap per follow-up query; identity coverage says how many sessions matched each way. It separates selected-session activity, outside-session/app activity and their overlap, no activity after a fully observed horizon, right-censoring, unknown identity, identity coverage, and read completeness. Its minute-aligned observationWatermark freezes event and receive time. Unknown identity and sessions without a selected step never count as inactive; no-activity is window-bounded evidence, not permanent churn. Output and attempt IDs are never returned. Incomplete follow-up counts are null. A query that fails for a backend, cost, or per-query timeout reason returns a stage-specific error with safe BigQuery status/reason when available; an internal event-read deadline instead returns completed pages with truncated coverage. An unreadable query never becomes zero counts or an empty-tree substitute.',
  schema: z
    .object({
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
      excludeNonProductionHosts: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Exclude events from beta and localhost hosts. Test identities are excluded separately.",
        ),
      followUpMode: z
        .enum(["session", "person"])
        .optional()
        .default("session")
        .describe(
          'Follow-up grain: "session" (default) keeps existing same-session counts; "person" adds a scoped 30-day cross-session, cross-app estimate joined by agreed session emails and direct canonical auth_user_id.',
        ),
      observationWatermark: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/)
        .optional()
        .describe(
          'A past UTC minute, such as 2026-11-10T22:38:00.000Z, to read as of instead of now. Pass continueWith.observationWatermark from a response a time limit or maxTotalBytesBilled stopped: the queries it finished are cached, except any its notes say the cache did not keep, and BigQuery queries a time limit stopped keep running, so the same request with this value, sent within a few minutes, continues from them. It pins event time in both follow-up modes; only followUpMode "person" also pins receive time, so in session mode an event that arrives between calls can change pages, which coverage reports as may_have_shifted.',
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
        .max(MAX_ONBOARDING_EVENT_ROW_BUDGET)
        .optional()
        .default(DEFAULT_ONBOARDING_EVENT_ROW_BUDGET)
        .describe(
          `Event rows to read, plus one extra row to detect truncation. Each query reads at most 4,000 rows and has a 25 GB BigQuery bytes-billed cap. The aggregate page budget and 15-second read budget can stop the read earlier; coverage.truncated and notes say when counts are partial. Defaults to ${DEFAULT_ONBOARDING_EVENT_ROW_BUDGET}.`,
        ),
      maxTotalBytesBilled: z.coerce
        .number()
        .int()
        .min(ONBOARDING_EVENTS_MAX_BYTES_BILLED)
        .max(ONBOARDING_EVENTS_MAX_TOTAL_BYTES_BILLED)
        .optional()
        .describe(
          "Aggregate cap for event-page queries, in bytes billed. Each BigQuery page not already cached reserves its full 25 GB per-query cap; cached pages are free. Defaults to 275 GB (11 pages), or 125 GB (5 pages) for an outside agent over MCP; set a higher value deliberately to allow more pages, up to 1.275 TB (51 pages). Over MCP it is also capped at what today's BigQuery budget can pay for.",
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
        .describe(
          "Only examples whose viewport width/height is at least this.",
        ),
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
        .describe(
          "Only examples whose viewport is at least this many px wide.",
        ),
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
      experimentId: z
        .enum(ONBOARDING_JOURNEY_EXPERIMENT_IDS)
        .optional()
        .describe(
          "Experiment ID to match exactly against each exposure event's experiment_id: first_run_builder_credits or first_run_builder_credits_v2. Returns control and credits session trees from one event read; events for other IDs are not included. Sessions with conflicting or missing assignments remain outside both arms.",
        ),
      splitDesignFirstTouch: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "For the Design app, also return session trees grouped by the signup first_touch_path: /mcp/oauth, another known path, or unknown. Sessionless OAuth signups are reported as counts without invented screenshots.",
        ),
    })
    .superRefine((args, ctx) => {
      if (
        (args.experimentId || args.splitDesignFirstTouch) &&
        args.format !== "tree"
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["format"],
          message: "Cohort splits require format tree.",
        });
      }
      if (
        (args.experimentId || args.splitDesignFirstTouch) &&
        args.followUpMode === "person"
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["followUpMode"],
          message: "Person follow-up is not available with cohort splits.",
        });
      }
      if (args.observationWatermark !== undefined) {
        const watermarkMs = Date.parse(args.observationWatermark);
        // Date.parse rolls an impossible day such as Feb 31 into the next month.
        if (
          !Number.isFinite(watermarkMs) ||
          new Date(watermarkMs).toISOString() !== args.observationWatermark
        ) {
          ctx.addIssue({
            code: "custom",
            path: ["observationWatermark"],
            message: "observationWatermark must be a real UTC date and minute.",
          });
        } else if (watermarkMs > Date.now()) {
          ctx.addIssue({
            code: "custom",
            path: ["observationWatermark"],
            message: "observationWatermark must not be in the future.",
          });
        }
      }
      if (args.splitDesignFirstTouch && args.app !== "design") {
        ctx.addIssue({
          code: "custom",
          path: ["splitDesignFirstTouch"],
          message: "First-touch cohort splits are only available for Design.",
        });
      }
    }),
  http: { method: "GET" },
  readOnly: true,
  mcpTool: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  grounding: true,
  mcpNeedsApproval: async (args, ctx) => {
    const read = await allowanceBudget(ctx);
    return (
      read !== null &&
      (await firstPartyQueriesRunOnBigQuery(read.identity)) &&
      needsAllowanceApproval(
        read.budget,
        smallestOutsideAgentOnboardingCall(args),
      )
    );
  },
  approvalNotice: async (args, ctx) => {
    const budget = await allowanceToAskAbout(
      ctx,
      smallestOutsideAgentOnboardingCall(args),
    );
    return allowanceApprovalNotice(
      budget,
      approvedOutsideAgentOnboardingBound(
        budget,
        args.maxTotalBytesBilled,
        args,
      ),
    );
  },
  approvalProof: "review-page",
  run: async (args, context?: ActionRunContext) => {
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
    const journeyArgs = (maxTotalBytesBilled: number) => ({
      dateFrom: args.dateFrom,
      dateTo: args.dateTo,
      app: args.app,
      emailFilter: args.emailFilter,
      excludeNonProductionHosts: args.excludeNonProductionHosts,
      followUpMode: args.followUpMode,
      ...(args.observationWatermark !== undefined
        ? { observationWatermark: args.observationWatermark }
        : {}),
      format: args.format,
      maxNodes: args.maxNodes,
      maxDepth: args.maxDepth,
      minNodeSessions: args.minNodeSessions,
      examplesPerNode: args.examplesPerNode,
      maxEventRows: args.maxEventRows,
      maxTotalBytesBilled,
      settleMs: args.settleMs,
      recency: args.recency,
      ...(args.experimentId !== undefined
        ? { experimentId: args.experimentId }
        : {}),
      splitDesignFirstTouch: args.splitDesignFirstTouch,
      ...(Object.keys(viewport).length ? { viewport } : {}),
    });
    try {
      if (!isOutsideAgentCaller(context?.caller)) {
        return await getOnboardingJourney(
          scope,
          journeyArgs(
            args.maxTotalBytesBilled ??
              ONBOARDING_EVENTS_DEFAULT_MAX_TOTAL_BYTES_BILLED,
          ),
          context?.signal,
        );
      }
      const identity = outsideAgentIdentity(scope.userEmail, scope.orgId);
      const call = {
        followUpMode: args.followUpMode,
        experimentId: args.experimentId,
        splitDesignFirstTouch: args.splitDesignFirstTouch,
      };
      const askVia =
        context?.caller === "mcp" ? "get-onboarding-journey" : undefined;
      const onBigQuery = await firstPartyQueriesRunOnBigQuery(identity);
      if (onBigQuery) await recordReviewedAllowance(identity);
      const unbudgeted =
        args.maxTotalBytesBilled ??
        ONBOARDING_EVENTS_OUTSIDE_AGENT_DEFAULT_MAX_TOTAL_BYTES_BILLED;
      const { requested, applied, refusal } = onBigQuery
        ? await outsideAgentOnboardingEventBytes(
            identity,
            args.maxTotalBytesBilled,
            call,
            context?.signal,
            askVia,
          )
        : { requested: unbudgeted, applied: unbudgeted, refusal: null };
      if (refusal) throw refusal;
      const { value, report } = await runOutsideAgentBigQueryCall(
        {
          identity,
          source: "get-onboarding-journey",
          reservation: "full-cap",
          leaseMs: ONBOARDING_JOURNEY_QUERY_BUDGET_MS + 60_000,
          ...(askVia ? { askVia } : {}),
        },
        () =>
          getOnboardingJourney(scope, journeyArgs(applied), context?.signal),
      );
      return {
        ...value,
        bigQueryBudget: {
          ...report,
          maxTotalBytesBilled: { requested, applied },
        },
      };
    } catch (error) {
      if (error instanceof OutsideAgentBigQueryRefusalError) {
        failForOutsideAgentRefusal(error);
      }
      if (
        context?.signal?.aborted ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        throw error;
      }
      const spent = outsideAgentCallReportOf(error);
      const spend = spent
        ? ` ${describeOutsideAgentBigQueryReport(spent)}`
        : "";
      if (error instanceof OnboardingJourneyReadError) {
        const stagePrefix =
          error.stage === "journey_events"
            ? "journey_events_read"
            : `journey_${error.stage}`;
        const failureCode =
          error.failureKind === "query_timeout"
            ? `${stagePrefix}_timeout`
            : error.failureKind === "cost_limited"
              ? `${stagePrefix}_cost_limited`
              : error.failureKind === "query_error" &&
                  error.stage !== "journey_events"
                ? `${stagePrefix}_unclassified`
                : `${stagePrefix}_failed`;
        const backendDetail =
          error.backendStatus !== null ||
          error.backendReason !== null ||
          error.backendOperation !== null
            ? ` BigQuery phase: ${error.backendOperation ?? "unavailable"}; status: ${error.backendStatus ?? "unavailable"}; reason: ${error.backendReason ?? "unavailable"}.`
            : "";
        const failureContext = `${error.page === null ? "" : ` Event page: ${error.page}.`} Failure type: ${error.safeErrorType}.`;
        console.error("[get-onboarding-journey] failed", {
          stage: error.stage,
          page: error.page,
          failureKind: error.failureKind,
          failureType: error.safeErrorType,
          backendStatus: error.backendStatus,
          backendReason: error.backendReason,
          backendOperation: error.backendOperation,
        });
        fail(
          `The scoped onboarding journey read failed during ${error.stage}; no journey counts were returned.${failureContext}${backendDetail}${spend}`,
          {
            errorCode: failureCode,
            statusCode: error.failureKind === "query_timeout" ? 504 : 502,
          },
        );
      }
      console.error("[get-onboarding-journey] failed", {
        stage:
          error instanceof JourneyRecordingsError ? "recordings" : "unknown",
        errorType: error instanceof Error ? error.name : "non_error",
      });
      if (error instanceof JourneyRecordingsError) {
        fail(
          `${error.message} Examples would misreport which sessions have a replay, so no tree was built; retry, or use format "summary" for counts only.`,
          { errorCode: "journey_recordings_unreadable", statusCode: 502 },
        );
      }
      fail(
        `Onboarding journey events could not be read, so no tree was built. Retry with a narrower window or app.${spend}`,
        { errorCode: "journey_events_unreadable", statusCode: 502 },
      );
    }
  },
});
