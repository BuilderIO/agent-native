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

/**
 * Per-request agent-run state. Lives on `RequestContext.run` so the
 * agent-chat plugin can populate fields as the run progresses (owner,
 * resolved API key, system prompt, engine, model, threadId) without
 * mutating module-scope `let` bindings — those leak across concurrent
 * requests on a single Node.js process.
 *
 * Mutated in-place by `prepareRun`, `onEngineResolved`, `onRunStart` so
 * tool factory closures (automation, fetch, team, builder-browser) read
 * the live per-request value via `getRequestRunContext()`.
 */
export interface RequestRunContext {
  /** Origin of the current request (used by the builder-browser tool). */
  requestOrigin?: string;
  /** Resolved owner email (set by prepareRun). */
  owner?: string;
  /** Owner's active Anthropic API key (set by prepareRun). */
  userApiKey?: string;
  /** Thread ID for the current run (set by onRunStart). */
  threadId?: string;
  /** System prompt actually sent to the model for this run. */
  systemPrompt?: string;
  /** Engine instance for this run (set by onEngineResolved). */
  engine?: import("../agent/engine/types.js").AgentEngine;
  /** Model name for this run (set by onEngineResolved). */
  model?: string;
}

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
  /**
   * Mutable per-request agent-run state. Populated by the agent-chat plugin
   * during a run; tool closures dereference it on each invocation.
   */
  run?: RequestRunContext;
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
 *
 * - If a request context exists (HTTP/A2A path), returns its `userEmail` —
 *   even when that value is `undefined`. The env fallback MUST NOT fire here:
 *   on serverless platforms `process.env.AGENT_USER_EMAIL` is mutated as a
 *   back-compat hack on every request, so a previous request's identity
 *   would leak into an unauthenticated A2A call (e.g. unsigned or API-key
 *   modes where `runWithRequestContext({ userEmail: undefined })` is used).
 * - Only when there is NO request context (CLI scripts) do we fall back to
 *   `process.env.AGENT_USER_EMAIL`.
 */
export function getRequestUserEmail(): string | undefined {
  const store = als.getStore();
  if (store !== undefined) return store.userEmail;
  return process.env.AGENT_USER_EMAIL;
}

/**
 * Get the current request's org ID.
 *
 * Same store-aware semantics as `getRequestUserEmail()` — env fallback is
 * CLI-only, so a request that explicitly has no org doesn't inherit a stale
 * `process.env.AGENT_ORG_ID` from a prior request on the same Lambda instance.
 */
export function getRequestOrgId(): string | undefined {
  const store = als.getStore();
  if (store !== undefined) return store.orgId;
  return process.env.AGENT_ORG_ID;
}

/**
 * Get the current request's IANA timezone (e.g. "America/Los_Angeles").
 * The UI sends this via the `x-user-timezone` header on every action call, and
 * the agent chat plugin propagates it into the request context so that
 * agent-initiated tool calls also see the user's timezone. Falls back to
 * `process.env.AGENT_USER_TIMEZONE` only for CLI scripts (no request context).
 */
export function getRequestTimezone(): string | undefined {
  const store = als.getStore();
  if (store !== undefined) return store.timezone;
  return process.env.AGENT_USER_TIMEZONE;
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

/**
 * Convenience: returns `{ userEmail, orgId }` from the active request context,
 * suitable for passing to `resolveCredential(key, ctx)`. Returns `null` when
 * no user is associated with the call (e.g. an unauthenticated public route).
 *
 * For framework actions auto-mounted at `/_agent-native/actions/...` this is
 * always populated because action-routes wraps every invocation in
 * `runWithRequestContext`. For hand-written `/api/*` routes the calling code
 * is responsible for setting up the context (see `runWithRequestContext`).
 */
export function getCredentialContext(): {
  userEmail: string;
  orgId: string | null;
} | null {
  const userEmail = getRequestUserEmail();
  if (!userEmail) return null;
  return { userEmail, orgId: getRequestOrgId() ?? null };
}

/**
 * Get the active request's mutable agent-run state. Returns `undefined` when
 * called outside an agent run (e.g. before `prepareRun` or in a non-agent
 * code path). Callers must tolerate the field absence; use the helper
 * `requireRequestRunContext()` if missing context is a programming error.
 */
export function getRequestRunContext(): RequestRunContext | undefined {
  const store = als.getStore();
  if (!store) return undefined;
  return store.run;
}

/**
 * Ensure a `RequestRunContext` exists on the active request store and
 * return it. Used by the agent-chat handler to attach run state once it
 * starts processing a chat request. Returns `undefined` if there is no
 * active request store (caller should not be invoking this outside ALS).
 */
export function ensureRequestRunContext(): RequestRunContext | undefined {
  const store = als.getStore();
  if (!store) return undefined;
  if (!store.run) store.run = {};
  return store.run;
}
