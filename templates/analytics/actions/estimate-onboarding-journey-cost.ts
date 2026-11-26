import { defineAction, fail } from "@agent-native/core/action";
import type { ActionRunContext } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { firstPartyQueriesRunOnBigQuery } from "../server/lib/bigquery-agent-approval.js";
import { outsideAgentIdentity } from "../server/lib/bigquery-agent-budget.js";
import { failForOutsideAgentRefusal } from "../server/lib/bigquery-agent-calls.js";
import {
  isOutsideAgentCaller,
  OutsideAgentBigQueryRefusalError,
} from "../server/lib/bigquery-agent-context.js";
import {
  FIRST_PARTY_TEMPLATE_NAMES,
  isCalendarDate,
} from "../server/lib/first-party-metric-catalog.js";
import { outsideAgentOnboardingEventBytes } from "../server/lib/onboarding-journey-agent-budget.js";
import {
  estimateOnboardingJourneyEventQueryCost,
  OnboardingJourneyCostError,
} from "../server/lib/onboarding-journey-cost.js";
import {
  DEFAULT_ONBOARDING_EVENT_ROW_BUDGET,
  freezeOnboardingJourneyObservationWindow,
  MAX_ONBOARDING_EVENT_ROW_BUDGET,
  ONBOARDING_EVENTS_DEFAULT_MAX_TOTAL_BYTES_BILLED,
  ONBOARDING_EVENTS_MAX_BYTES_BILLED,
  ONBOARDING_EVENTS_MAX_TOTAL_BYTES_BILLED,
  ONBOARDING_JOURNEY_EXPERIMENT_IDS,
} from "../server/lib/onboarding-journey.js";

const MAX_WINDOW_DAYS = 90;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isCalendarDate, { message: "must be a real calendar date" });

export default defineAction({
  description:
    "Dry-run the caller-scoped BigQuery event-page queries for an onboarding journey. Returns requested and budget-allowed page counts, estimated bytes per page, and total possible bytes when every allowed page is estimated. Each page reserves the 25 GB per-query cap against maxTotalBytesBilled unless its result is already cached; cached pages are free, so a repeat get-onboarding-journey call can read past the allowed count. Estimates stop after 45 seconds and explicitly report unestimated pages.",
  schema: z
    .object({
      dateFrom: isoDate.describe(
        "Inclusive UTC start date, YYYY-MM-DD. Use the same dateFrom as get-onboarding-journey.",
      ),
      dateTo: isoDate.describe(
        `Inclusive UTC end date, YYYY-MM-DD, at most ${MAX_WINDOW_DAYS} days after dateFrom. Use the same dateTo as get-onboarding-journey.`,
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
          'Builder employee filter, matching get-onboarding-journey: "exclude_builder" (default), "only_builder", or "all".',
        ),
      excludeNonProductionHosts: z
        .boolean()
        .optional()
        .describe(
          "Exclude beta and localhost hosts, matching the journey query.",
        ),
      followUpMode: z
        .enum(["session", "person"])
        .optional()
        .default("session")
        .describe(
          'Use the same mode as get-onboarding-journey. "person" freezes the event receive-time watermark used by that request. This estimates event pages only; data-dependent follow-up queries are excluded. Defaults to "session".',
        ),
      maxEventRows: z.coerce
        .number()
        .int()
        .min(1000)
        .max(MAX_ONBOARDING_EVENT_ROW_BUDGET)
        .optional()
        .default(DEFAULT_ONBOARDING_EVENT_ROW_BUDGET)
        .describe(
          `Event row budget, matching get-onboarding-journey. Defaults to ${DEFAULT_ONBOARDING_EVENT_ROW_BUDGET}; at most ${MAX_ONBOARDING_EVENT_ROW_BUDGET}. Estimates include the one-row overflow check; the journey reads each page only when the previous page is full.`,
        ),
      maxTotalBytesBilled: z.coerce
        .number()
        .int()
        .min(ONBOARDING_EVENTS_MAX_BYTES_BILLED)
        .max(ONBOARDING_EVENTS_MAX_TOTAL_BYTES_BILLED)
        .optional()
        .describe(
          "Aggregate cap for event-page queries, in bytes billed. Each BigQuery page not already cached reserves its full 25 GB per-query cap. Defaults to 275 GB (11 pages), or 125 GB (5 pages) for an outside agent, whose cap is also lowered to what its daily BigQuery budget can still pay for, exactly as get-onboarding-journey applies it; the result's maxTotalBytesBilled is the cap applied, and maxTotalBytesBilledRequested what was asked when the budget lowered it. Set a higher value deliberately to allow more pages, up to 1.275 TB (51 pages). Match get-onboarding-journey.",
        ),
      experimentId: z
        .enum(ONBOARDING_JOURNEY_EXPERIMENT_IDS)
        .optional()
        .describe(
          "Use the same experimentId as get-onboarding-journey. It doesn't change the event pages estimated, but a cohort split runs no follow-up query, so an outside agent's allowance sets none aside.",
        ),
      splitDesignFirstTouch: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Use the same splitDesignFirstTouch as get-onboarding-journey. Like experimentId, it changes only the follow-up allowance.",
        ),
      observationWatermark: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/)
        .optional()
        .describe(
          "Use the same observationWatermark as get-onboarding-journey when estimating a continued read, so the estimate prices the same observation window.",
        ),
    })
    .superRefine((args, ctx) => {
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
      if (args.splitDesignFirstTouch && args.app !== "design") {
        ctx.addIssue({
          code: "custom",
          path: ["splitDesignFirstTouch"],
          message: "First-touch cohort splits are only available for Design.",
        });
      }
      if (args.observationWatermark !== undefined) {
        const watermarkMs = Date.parse(args.observationWatermark);
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
    }),
  http: { method: "GET" },
  readOnly: true,
  mcpTool: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  grounding: true,
  run: async (args, context?: ActionRunContext) => {
    const days =
      (Date.parse(`${args.dateTo}T00:00:00Z`) -
        Date.parse(`${args.dateFrom}T00:00:00Z`)) /
      86_400_000;
    if (days < 0) fail("dateTo must not be before dateFrom.");
    if (days > MAX_WINDOW_DAYS) {
      fail(`The window may span at most ${MAX_WINDOW_DAYS} days.`);
    }
    const userEmail = getRequestUserEmail();
    if (!userEmail) {
      fail("Sign in to use this action.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }
    const scope = { userEmail, orgId: getRequestOrgId() || null };
    const filters = {
      dateFrom: args.dateFrom,
      dateTo: args.dateTo,
      app: args.app,
      emailFilter: args.emailFilter,
      ...(args.excludeNonProductionHosts
        ? { excludeNonProductionHosts: true }
        : {}),
    };
    try {
      const identity = isOutsideAgentCaller(context?.caller)
        ? outsideAgentIdentity(scope.userEmail, scope.orgId)
        : null;
      const allowance =
        identity && (await firstPartyQueriesRunOnBigQuery(identity))
          ? await outsideAgentOnboardingEventBytes(
              identity,
              args.maxTotalBytesBilled,
              {
                followUpMode: args.followUpMode,
                experimentId: args.experimentId,
                splitDesignFirstTouch: args.splitDesignFirstTouch,
              },
              context?.signal,
              context?.caller === "mcp" ? "get-onboarding-journey" : undefined,
            )
          : null;
      if (allowance?.refusal) throw allowance.refusal;
      const estimate = await estimateOnboardingJourneyEventQueryCost(
        scope,
        filters,
        args.maxEventRows,
        freezeOnboardingJourneyObservationWindow(
          filters,
          args.observationWatermark,
        ),
        args.followUpMode === "person",
        context?.signal,
        allowance?.applied ??
          args.maxTotalBytesBilled ??
          ONBOARDING_EVENTS_DEFAULT_MAX_TOTAL_BYTES_BILLED,
      );
      return allowance && allowance.applied < allowance.requested
        ? { ...estimate, maxTotalBytesBilledRequested: allowance.requested }
        : estimate;
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
      const code =
        error instanceof OnboardingJourneyCostError
          ? error.code
          : "preparation_failed";
      const messages: Record<
        typeof code,
        { message: string; statusCode: number }
      > = {
        unsupported_backend: {
          message:
            "A BigQuery event-page estimate is unavailable for this Analytics backend.",
          statusCode: 409,
        },
        preparation_failed: {
          message:
            "The scoped onboarding event-page estimate could not be prepared. No event rows were read.",
          statusCode: 502,
        },
        dry_run_failed: {
          message:
            "BigQuery could not estimate the scoped onboarding event pages. No event rows were read.",
          statusCode: 502,
        },
        dry_run_timeout: {
          message:
            "BigQuery timed out estimating the scoped onboarding event pages. No event rows were read.",
          statusCode: 504,
        },
        estimate_unavailable: {
          message:
            "BigQuery returned no usable byte estimate for the scoped onboarding event pages.",
          statusCode: 502,
        },
      };
      fail(messages[code].message, {
        errorCode: `onboarding_journey_cost_${code}`,
        statusCode: messages[code].statusCode,
      });
    }
  },
});
