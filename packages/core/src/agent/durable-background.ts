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
 * path. The flag is only ever true when ALL of these hold:
 *   1. `AGENT_CHAT_DURABLE_BACKGROUND` env is a truthy value.
 *   2. The runtime is hosted/serverless (local dev keeps the inline path so SSE
 *      stays a single live stream and no second function is needed).
 *   3. `A2A_SECRET` is configured (the HMAC handoff is required to authenticate
 *      the background dispatch; without it the dispatch can't be trusted).
 */
import { hasConfiguredA2ASecret } from "../a2a/auth-policy.js";

/**
 * Framework route the background function actually runs — sibling to
 * `AGENT_TEAM_PROCESS_RUN_PATH`. Reached *through* the Netlify background
 * function, so it inherits the 15-min budget.
 */
export const AGENT_CHAT_PROCESS_RUN_PATH =
  "/_agent-native/agent-chat/_process-run";

/** Env flag (off by default) that opts an app into durable background runs. */
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
  const raw = process.env[AGENT_CHAT_DURABLE_BACKGROUND_ENV];
  if (raw == null) return false;
  const normalized = raw.trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

/**
 * The single gate. True only when the flag is on AND the runtime is hosted AND
 * A2A_SECRET is configured. False otherwise — and false means the current
 * synchronous behavior is used, unchanged.
 */
export function isAgentChatDurableBackgroundEnabled(): boolean {
  return (
    isFlagEnabled() &&
    isHostedRuntimeForDurableBackground() &&
    hasConfiguredA2ASecret()
  );
}
