import { timingSafeEqual } from "node:crypto";

import {
  extractBearerToken,
  verifyInternalToken,
} from "../../integrations/internal-token.js";
import { RECURRING_JOBS_SWEEP_TOKEN_SUBJECT } from "../../jobs/scheduler-dispatch.js";

export type SweepTriggerAuthorization =
  | { ok: true }
  | { ok: false; status: 401 | 405 | 503; error: string };

/**
 * Netlify's scheduled function and the Cloudflare worker's `scheduled` handler
 * POST a short-lived token signed with A2A_SECRET. Vercel Cron can only send a
 * GET carrying the project's CRON_SECRET as a bearer, so that is the one other
 * request shape the sweep accepts.
 */
export function authorizeSweepTrigger(input: {
  method: string;
  authorization: string | undefined;
  cronSecret: string | undefined;
}): SweepTriggerAuthorization {
  if (input.method === "POST") {
    const token = extractBearerToken(input.authorization);
    return token &&
      verifyInternalToken(RECURRING_JOBS_SWEEP_TOKEN_SUBJECT, token)
      ? { ok: true }
      : { ok: false, status: 401, error: "Invalid or expired internal token" };
  }
  if (input.method === "GET") {
    if (!input.cronSecret) {
      return {
        ok: false,
        status: 503,
        error:
          "CRON_SECRET is not set on this deployment, so a cron request cannot be verified.",
      };
    }
    return bearerMatches(input.authorization, input.cronSecret)
      ? { ok: true }
      : { ok: false, status: 401, error: "Invalid cron secret" };
  }
  return { ok: false, status: 405, error: "Method not allowed" };
}

function bearerMatches(header: string | undefined, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  const actual = Buffer.from(header?.trim() ?? "", "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
