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
