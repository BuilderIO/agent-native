import { defineAction, fail } from "@agent-native/core/action";
import type { ActionRunContext } from "@agent-native/core/action";
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
} from "../server/lib/onboarding-journey.js";

const MAX_WINDOW_DAYS = 90;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isCalendarDate, { message: "must be a real calendar date" });

export default defineAction({
  description:
    "Dry-run the caller-scoped BigQuery event-page queries for an onboarding journey. Returns requested and budget-allowed page counts, estimated bytes per page, and total possible bytes when every allowed page is estimated. Each page reserves the 25 GB per-query cap against maxTotalBytesBilled. Estimates stop after 45 seconds and explicitly report unestimated pages.",
  schema: z.object({
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
      .default(ONBOARDING_EVENTS_DEFAULT_MAX_TOTAL_BYTES_BILLED)
      .describe(
        "Aggregate cap for event-page queries, in bytes billed. Each allowed BigQuery page reserves its full 25 GB per-query cap. Defaults to 275 GB (11 pages); set a higher value deliberately to allow more pages, up to 1.275 TB (51 pages). Match get-onboarding-journey.",
      ),
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
      return await estimateOnboardingJourneyEventQueryCost(
        scope,
        filters,
        args.maxEventRows,
        freezeOnboardingJourneyObservationWindow(filters),
        args.followUpMode === "person",
        context?.signal,
        args.maxTotalBytesBilled,
      );
    } catch (error) {
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
