/**
 * Per-request context using AsyncLocalStorage.
 *
 * Replaces the unsafe pattern of mutating `process.env.AGENT_USER_EMAIL` /
 * `process.env.AGENT_ORG_ID` on every request. On Node.js (Netlify, self-hosted)
 * concurrent requests would overwrite each other's env vars. AsyncLocalStorage
 * gives each async call-chain its own isolated context.
 *
 * Supported on all deployment targets:
 * - Node.js (native)
 * - Cloudflare Workers (via nodejs_compat flag)
 * - Deno Deploy (via node:async_hooks compat)
 *
 * For CLI scripts that run outside a request context, the getters fall back to
 * process.env so existing `AGENT_USER_EMAIL=x pnpm action foo` invocations
 * continue to work.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  userEmail?: string;
  orgId?: string;
  timezone?: string;
  /**
   * True when this request is being processed by an integration-platform
   * webhook (Slack, Telegram, etc.) where the function timeout is the
   * binding constraint (~26s on Netlify Pro). Code that calls slow remote
   * APIs can use this to apply tighter budgets on this path while leaving
   * normal agent-chat callers (5+ min budget) unaffected.
   */
  isIntegrationCaller?: boolean;
}

const als = new AsyncLocalStorage<RequestContext>();

/**
 * Run a callback within a per-request context. The context is available to all
 * async operations spawned from `fn` via `getRequestUserEmail()` / `getRequestOrgId()`.
 */
export function runWithRequestContext<T>(
  ctx: RequestContext,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return als.run(ctx, fn);
}

/**
 * Get the current request's user email.
 * Falls back to `process.env.AGENT_USER_EMAIL` for CLI scripts.
 */
export function getRequestUserEmail(): string | undefined {
  return als.getStore()?.userEmail ?? process.env.AGENT_USER_EMAIL;
}

/**
 * Get the current request's org ID.
 * Falls back to `process.env.AGENT_ORG_ID` for CLI scripts.
 */
export function getRequestOrgId(): string | undefined {
  return als.getStore()?.orgId ?? process.env.AGENT_ORG_ID;
}

/**
 * Get the current request's IANA timezone (e.g. "America/Los_Angeles").
 * The UI sends this via the `x-user-timezone` header on every action call, and
 * the agent chat plugin propagates it into the request context so that
 * agent-initiated tool calls also see the user's timezone. Falls back to
 * `process.env.AGENT_USER_TIMEZONE` for CLI scripts, and undefined if unset.
 */
export function getRequestTimezone(): string | undefined {
  return als.getStore()?.timezone ?? process.env.AGENT_USER_TIMEZONE;
}

/**
 * Returns true when this request is on an integration-platform path (Slack,
 * Telegram, etc.) — i.e. we're inside the integration plugin's processor
 * function and the platform's deliver-by deadline plus the host's function
 * timeout are the binding budget. Non-integration callers (CLI, normal
 * agent chat) should treat this as `false`.
 */
export function isIntegrationCallerRequest(): boolean {
  return als.getStore()?.isIntegrationCaller === true;
}
