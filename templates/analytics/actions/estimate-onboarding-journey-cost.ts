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
import { freezeOnboardingJourneyObservationWindow } from "../server/lib/onboarding-journey.js";

const MAX_WINDOW_DAYS = 90;
const MAX_JOURNEY_EVENT_ROWS = 200_000;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isCalendarDate, { message: "must be a real calendar date" });

export default defineAction({
  description:
    "Dry-run the caller-scoped BigQuery event-page queries for an onboarding journey and return each possible page's estimated bytes, their total if all pages run, the existing per-query bytes-billed cap, and cap status.",
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
      .max(MAX_JOURNEY_EVENT_ROWS)
      .optional()
      .default(40000)
      .describe(
        `Event row budget, matching get-onboarding-journey. Defaults to 40000; at most ${MAX_JOURNEY_EVENT_ROWS}. The second page is estimated when this budget allows it, but the journey reads it only if the first page is full.`,
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
    };
    try {
      return await estimateOnboardingJourneyEventQueryCost(
        scope,
        filters,
        args.maxEventRows,
        freezeOnboardingJourneyObservationWindow(filters),
        args.followUpMode === "person",
        context?.signal,
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
          : "dry_run_failed";
      const messages: Record<
        typeof code,
        { message: string; statusCode: number }
      > = {
        unsupported_backend: {
          message:
            "A BigQuery event-page estimate is unavailable for this Analytics backend.",
          statusCode: 409,
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
