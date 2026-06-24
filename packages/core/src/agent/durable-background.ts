/**
 * Durable background agent-chat runs (Netlify background functions).
 *
 * Off by default. When enabled, a long in-app agent-chat turn is dispatched
 * into a Netlify *background* function (15-min budget) instead of completing
 * synchronously under the ~40s soft-timeout. The foreground POST claims the
 * run slot, inserts the run row, fires an HMAC-signed self-dispatch to
 * `AGENT_CHAT_PROCESS_RUN_PATH`, and returns the existing SSE subscription so
 * the client streams the same events (via the cross-isolate SQL-poll path)
 * with no client change.
 *
 * This module owns ONLY the gating decision + shared constants so both the
 * HTTP handler (`production-agent.ts`) and the processor route
 * (`agent-chat-plugin.ts`) agree on when the path is active without a circular
 * import. The actual run machinery is reused verbatim from run-manager /
 * run-store / self-dispatch / internal-token.
 *
 * GUARDRAIL: when `isAgentChatDurableBackgroundEnabled()` returns false, the
 * agent-chat handler must behave byte-for-byte like the current synchronous
 * path. The gate is true only when ALL of these hold:
 *   1. `AGENT_CHAT_DURABLE_BACKGROUND` env is not explicitly disabled. It is
 *      DEFAULT-ON: unset/empty counts as enabled; set it to a falsy value
 *      (`false`/`0`/`no`/`off`) to opt a specific app back out.
 *   2. The runtime is hosted/serverless (local dev keeps the inline path so SSE
 *      stays a single live stream and no second function is needed).
 *   3. `A2A_SECRET` is configured (the HMAC handoff is required to authenticate
 *      the background dispatch; without it the dispatch can't be trusted).
 */
import {
  hasConfiguredA2ASecret,
  isA2AProductionRuntime,
} from "../a2a/auth-policy.js";
import {
  extractBearerToken,
  verifyInternalToken,
} from "../integrations/internal-token.js";

/**
 * Framework route the background function actually runs — sibling to
 * `AGENT_TEAM_PROCESS_RUN_PATH`. Reached *through* the Netlify background
 * function, so it inherits the 15-min budget.
 */
export const AGENT_CHAT_PROCESS_RUN_PATH =
  "/_agent-native/agent-chat/_process-run";

/**
 * Env flag for durable background runs. DEFAULT-ON: unset means enabled; an app
 * opts OUT with an explicit falsy value (`false`/`0`/`no`/`off`).
 */
export const AGENT_CHAT_DURABLE_BACKGROUND_ENV =
  "AGENT_CHAT_DURABLE_BACKGROUND";

/**
 * Body field the foreground handler injects when self-dispatching to the
 * background processor. Its presence is how the re-entered handler knows it is
 * the background worker (run inline with the background soft-timeout; do NOT
 * re-claim the slot or re-dispatch). Untrusted on its own — the route also
 * verifies the HMAC token before invoking the handler.
 */
export const AGENT_CHAT_BACKGROUND_RUN_FIELD = "__backgroundRun";

/**
 * Mirror of run-manager's private `isHostedRuntime`. Kept in sync deliberately:
 * the durable-background gate must agree with the soft-timeout regime about
 * what "hosted" means.
 */
export function isHostedRuntimeForDurableBackground(): boolean {
  if (
    process.env.NETLIFY &&
    process.env.NETLIFY !== "false" &&
    process.env.NETLIFY_LOCAL !== "true"
  ) {
    return true;
  }
  if (
    process.env.AWS_LAMBDA_FUNCTION_NAME &&
    process.env.NETLIFY_LOCAL !== "true"
  ) {
    return true;
  }
  return Boolean(
    process.env.CF_PAGES ||
    process.env.VERCEL ||
    process.env.VERCEL_ENV ||
    process.env.RENDER ||
    process.env.FLY_APP_NAME ||
    process.env.K_SERVICE,
  );
}

function isFlagEnabled(): boolean {
  // Read the literal key (not `process.env[CONST]`) so guard:no-env-credentials
  // can statically verify it against the allowlisted `AGENT_*` prefix. Keep this
  // in sync with AGENT_CHAT_DURABLE_BACKGROUND_ENV.
  //
  // DEFAULT-ON: durable background runs are the desired behavior for every
  // hosted app (verified in prod — long multi-step runs complete past the 40s
  // soft-timeout with no thrash). So an unset flag means ON; an app opts OUT
  // only with an explicit falsy value. This still composes with the hosted +
  // A2A_SECRET gates below, so non-hosted / unconfigured apps stay synchronous.
  const raw = process.env.AGENT_CHAT_DURABLE_BACKGROUND;
  if (raw == null) return true;
  const normalized = raw.trim().toLowerCase();
  return !(
    normalized === "0" ||
    normalized === "false" ||
    normalized === "no" ||
    normalized === "off"
  );
}

/**
 * The single gate. True when the flag is not explicitly disabled (default-on)
 * AND the runtime is hosted AND A2A_SECRET is configured. False otherwise — and
 * false means the current synchronous behavior is used, unchanged. So a local /
 * non-hosted / unconfigured app stays synchronous even with the flag defaulting
 * on; durable only engages where the runtime actually supports it.
 */
export function isAgentChatDurableBackgroundEnabled(): boolean {
  return (
    isFlagEnabled() &&
    isHostedRuntimeForDurableBackground() &&
    hasConfiguredA2ASecret()
  );
}

/** Decision returned by `prepareProcessRunRequest`. */
export type ProcessRunPreparation =
  | {
      ok: true;
      /** The pre-claimed run id the background worker must reuse. */
      runId: string;
      /** Body to stash for the re-entered handler (marker guaranteed present). */
      body: Record<string, unknown>;
    }
  | {
      ok: false;
      /** HTTP status the route should return. */
      status: number;
      /** Error payload. */
      error: string;
    };

/**
 * Pure, transport-agnostic core of the `_process-run` route: validate the body,
 * authenticate the HMAC self-dispatch, and produce the body the re-entered
 * agent-chat handler should run as the background worker.
 *
 * Auth policy mirrors the agent-teams processor exactly:
 *   - `A2A_SECRET` set → require a valid `verifyInternalToken(runId, token)`.
 *   - no secret but a production runtime → refuse (503) — never run unsigned in
 *     prod.
 *   - no secret + non-prod (local dev) → allow unsigned; the SQL atomic claim
 *     in the worker still prevents double-processing.
 *
 * Extracted from the route handler so the auth + marker-prep decision is unit
 * testable without booting the whole Nitro plugin. The route only adds body
 * reading and the final handler invocation around this.
 */
export function prepareProcessRunRequest(
  body: unknown,
  authHeader: string | undefined,
): ProcessRunPreparation {
  if (!body || typeof body !== "object") {
    return { ok: false, status: 400, error: "Invalid request body" };
  }
  const record = body as Record<string, unknown>;
  const marker = record[AGENT_CHAT_BACKGROUND_RUN_FIELD] as
    | { runId?: unknown }
    | undefined;
  const runId =
    marker && typeof marker.runId === "string"
      ? marker.runId
      : typeof record.taskId === "string"
        ? (record.taskId as string)
        : "";
  if (!runId) {
    return { ok: false, status: 400, error: "runId required" };
  }

  if (hasConfiguredA2ASecret()) {
    const token = extractBearerToken(authHeader);
    if (!verifyInternalToken(runId, token ?? "")) {
      return {
        ok: false,
        status: 401,
        error: "Invalid or expired processor token",
      };
    }
  } else if (isA2AProductionRuntime()) {
    return {
      ok: false,
      status: 503,
      error:
        "Agent chat background processor not configured — set A2A_SECRET on this deployment.",
    };
  }

  // Ensure the marker is present so the re-entered handler runs as the
  // background worker (reuses runId/turnId, no re-claim, no re-dispatch).
  if (!marker || typeof marker.runId !== "string") {
    record[AGENT_CHAT_BACKGROUND_RUN_FIELD] = { runId };
  }
  return { ok: true, runId, body: record };
}
