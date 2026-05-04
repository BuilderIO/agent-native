/**
 * POST /_agent-native/runs/_continue-run
 *
 * Internal processor endpoint hit by the run-manager (after a soft timeout)
 * and by the recurring sweep (for stuck rows). Verifies the HMAC bearer
 * token, atomically claims the continuation row, then hands off to the
 * registered resumer. The route itself owns lifecycle bookkeeping
 * (markCompleted / markFailed / markGaveUp) so the resumer can stay focused
 * on actually running the agent loop.
 *
 * Auth posture matches the integrations process-task route: production
 * requires A2A_SECRET; dev allows unsigned dispatches.
 */
import {
  defineEventHandler,
  getMethod,
  getRequestHeader,
  readBody,
  setResponseStatus,
} from "h3";
import {
  extractBearerToken,
  verifyInternalToken,
} from "../integrations/internal-token.js";
import {
  claimRunContinuation,
  getRunContinuation,
  markRunContinuationCompleted,
  markRunContinuationFailed,
} from "./store.js";
import { getRunContinuationResumer } from "./resumer.js";
import { RUN_CONTINUATION_PROCESSOR_PATH } from "./dispatch.js";

export const RUN_CONTINUATIONS_ROUTE_PATH = RUN_CONTINUATION_PROCESSOR_PATH;

export function createRunContinuationRouteHandler() {
  return defineEventHandler(async (event) => {
    if (getMethod(event) !== "POST") {
      setResponseStatus(event, 405);
      return { error: "Method not allowed" };
    }

    let body: { continuationId?: string } | null = null;
    try {
      body = (await readBody(event)) as { continuationId?: string } | null;
    } catch {
      setResponseStatus(event, 400);
      return { error: "Invalid JSON body" };
    }
    const continuationId = body?.continuationId;
    if (!continuationId || typeof continuationId !== "string") {
      setResponseStatus(event, 400);
      return { error: "Missing or invalid continuationId" };
    }

    // Auth: HMAC required in production, optional in dev. Mirror the
    // integrations process-task posture.
    if (process.env.A2A_SECRET || process.env.NODE_ENV === "production") {
      const tok = extractBearerToken(getRequestHeader(event, "authorization"));
      if (!tok || !verifyInternalToken(continuationId, tok)) {
        setResponseStatus(event, 401);
        return { error: "Invalid or expired internal token" };
      }
    }

    // Atomic claim — only one processor wins. Already-claimed / completed /
    // failed / gave_up rows return null and we silently skip.
    const claimed = await claimRunContinuation(continuationId);
    if (!claimed) {
      return { ok: true, skipped: "already-claimed-or-terminal" };
    }

    const resumer = getRunContinuationResumer();
    if (!resumer) {
      // No resumer registered: mark completed so we don't retry forever, but
      // surface the misconfiguration in logs. Templates that opt into this
      // queue must register a resumer at plugin init.
      console.warn(
        `[run-continuations] No resumer registered — marking ${continuationId} completed without resuming. ` +
          "Register one via setRunContinuationResumer() during plugin init.",
      );
      await markRunContinuationCompleted(continuationId);
      return { ok: true, skipped: "no-resumer" };
    }

    try {
      await resumer({
        continuationId: claimed.id,
        threadId: claimed.threadId,
        parentRunId: claimed.parentRunId,
        ownerEmail: claimed.ownerEmail,
        orgId: claimed.orgId,
        attempt: claimed.attempts,
      });
      await markRunContinuationCompleted(continuationId);
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await markRunContinuationFailed(continuationId, message);
      // Log full error for ops; sweep handles retry up to MAX_ATTEMPTS.
      console.error(
        `[run-continuations] Resumer failed for ${continuationId}:`,
        err,
      );
      // Surface the row for tests / integration assertions, but never the
      // raw error string (don't leak internals).
      const refreshed = await getRunContinuation(continuationId);
      setResponseStatus(event, 500);
      return {
        error: "Resumer failed",
        attempts: refreshed?.attempts ?? claimed.attempts,
      };
    }
  });
}
