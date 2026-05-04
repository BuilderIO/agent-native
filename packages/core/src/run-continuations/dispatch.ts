/**
 * Fire-and-forget dispatch for the run-continuations queue.
 *
 * After a row is enqueued in `agent_run_continuations`, we POST to a separate
 * processor endpoint so the resume runs in a fresh function execution with
 * its own timeout budget — the original run already exhausted its budget.
 *
 * Mirrors the pattern in `pending-tasks-retry-job.ts:refireProcessor`. The
 * recurring sweep is the safety net: if this dispatch is dropped (network
 * blip, function frozen mid-handshake), the sweep re-fires it 60s later.
 */
import { signInternalToken } from "../integrations/internal-token.js";
import { withConfiguredAppBasePath } from "../server/app-base-path.js";
import { FRAMEWORK_ROUTE_PREFIX } from "../server/core-routes-plugin.js";

export const RUN_CONTINUATION_PROCESSOR_PATH = `${FRAMEWORK_ROUTE_PREFIX}/runs/_continue-run`;

function resolveBaseUrl(override?: string): string {
  return (
    override ||
    process.env.WEBHOOK_BASE_URL ||
    process.env.APP_URL ||
    process.env.URL ||
    process.env.DEPLOY_URL ||
    `http://localhost:${process.env.PORT || 3000}`
  );
}

/**
 * Fire-and-forget POST to the run-continuation processor endpoint.
 *
 * Production must have A2A_SECRET configured — an unsigned dispatch in
 * production lets anyone with the URL re-trigger any queued continuation.
 * Dev falls back to unsigned so contributors can iterate without secrets.
 */
export async function dispatchRunContinuation(
  continuationId: string,
  options?: { baseUrl?: string },
): Promise<void> {
  const baseUrl = resolveBaseUrl(options?.baseUrl);
  const url = `${withConfiguredAppBasePath(baseUrl)}${RUN_CONTINUATION_PROCESSOR_PATH}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  try {
    headers["Authorization"] = `Bearer ${signInternalToken(continuationId)}`;
  } catch (err) {
    if (process.env.NODE_ENV === "production") {
      console.error(
        `[run-continuations] Refusing to dispatch ${continuationId} — A2A_SECRET not configured.`,
      );
      return;
    }
    if (err instanceof Error && !/A2A_SECRET/i.test(err.message)) {
      console.error(
        `[run-continuations] signInternalToken failed unexpectedly for ${continuationId}:`,
        err,
      );
    }
  }

  // 5s timeout so the dispatch loop can't hang if the processor freezes.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);

  try {
    await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ continuationId }),
      signal: controller.signal,
    });
  } catch (err) {
    // The sweep is the safety net — log and move on. Don't propagate, since
    // callers (run-manager .finally(), sweep) treat dispatch as best-effort.
    if (process.env.DEBUG) {
      console.log(
        `[run-continuations] dispatch ${continuationId} failed (sweep will retry):`,
        err instanceof Error ? err.message : err,
      );
    }
  } finally {
    clearTimeout(timer);
  }
}
