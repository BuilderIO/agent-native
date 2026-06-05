/**
 * Local single-user identity resolution for the no-login local mode.
 *
 * `/visual-plan` is local-first: by default a person creates, edits, and views
 * plans with NO login. Plans persist to the local repo as MDX plus local SQL.
 * Only when they want to SHARE a plan do they make a lazy account and publish
 * the plan to a hosted instance (see `publish-visual-plan`).
 *
 * To make that work, the plan actions must resolve an owner identity even when
 * there is no authenticated user — but ONLY when the runtime is genuinely local.
 * On a hosted/production deployment a missing user must still be rejected.
 *
 * The gating here deliberately mirrors the existing dev-only auth precedents in
 * `@agent-native/core`:
 *   - `packages/core/src/scripts/dev-session.ts` (CLI dev session bootstrap)
 *   - the "latest session" fallback in `packages/core/src/server/agent-chat-plugin.ts`
 *
 * Both refuse to source an unauthenticated identity unless:
 *   - `NODE_ENV !== "production"` (hard refusal in production), AND
 *   - `AUTH_MODE` is unset or === "local" (the dev-only auth shim — any other
 *     value means a real hosted/admin auth mode is in play).
 *
 * We keep the same semantics so the local-mode fallback can NEVER activate on a
 * hosted deploy: a production process always rejects, and a non-local AUTH_MODE
 * always rejects. An optional explicit `PLAN_LOCAL_MODE=1` flag lets a developer
 * force local mode on, but it still cannot override the production refusal.
 */

/**
 * Stable owner email for the local single-user identity. Kept distinct from the
 * core dev sentinel `local@localhost` (which the resolvers intentionally reject)
 * and from the anonymous public-viewer identity `public-*@agent-native.local`.
 */
export const LOCAL_PLAN_OWNER_EMAIL = "local@agent-native.local";

/**
 * True when this process is allowed to assume the local single-user identity.
 *
 * CRITICAL: this must never return true on a hosted/production deploy. The
 * production short-circuit is first and unconditional.
 */
export function isLocalPlanRuntime(): boolean {
  // Hard refusal: never assume a local identity in production, regardless of
  // any other flag. Mirrors the runtime assertions in core's dev fallbacks.
  if (process.env.NODE_ENV === "production") return false;

  // An explicit opt-out always wins, even in dev (useful for testing the
  // hosted/auth-required behavior locally).
  if (process.env.PLAN_LOCAL_MODE === "0") return false;

  // A non-"local" AUTH_MODE means a real auth mode (hosted, admin, etc.) is in
  // play; do not assume a single local user on its behalf.
  const authMode = process.env.AUTH_MODE;
  if (authMode && authMode !== "local") return false;

  // An explicit opt-in forces local mode on (still gated by the production
  // refusal above).
  if (process.env.PLAN_LOCAL_MODE === "1") return true;

  // Default dev behavior: local mode is on when not in production and AUTH_MODE
  // is unset or "local".
  return true;
}

/**
 * Resolve the owner email for a plan write/read.
 *
 * Priority:
 *   1. The authenticated request user (always honored — hosted and local).
 *   2. The local single-user identity, ONLY when `isLocalPlanRuntime()` and the
 *      caller is not an anonymous public-plan viewer.
 *
 * Anonymous public-plan viewers (`public-*@agent-native.local`, minted by
 * `resolvePublicPlanViewerOwner`) are passed through unchanged so they keep
 * their read-only public access — they must NOT be upgraded to the local owner.
 *
 * Returns `undefined` when no identity is available (hosted + unauthenticated),
 * so callers can reject exactly as before.
 */
export function resolvePlanOwnerEmail(
  authenticatedEmail: string | undefined,
): string | undefined {
  if (authenticatedEmail) return authenticatedEmail;
  if (isLocalPlanRuntime()) return LOCAL_PLAN_OWNER_EMAIL;
  return undefined;
}

/**
 * Resolve the owner email for a plan write and throw a friendly error when no
 * identity is available. Use at the top of create-style actions.
 *
 * In local mode this always succeeds with `LOCAL_PLAN_OWNER_EMAIL`. On a hosted
 * deploy with no authenticated user it throws, preserving the previous
 * "requires an authenticated user" contract.
 */
export function requirePlanOwnerEmail(
  authenticatedEmail: string | undefined,
  action: string,
): string {
  const owner = resolvePlanOwnerEmail(authenticatedEmail);
  if (!owner) {
    throw new Error(`${action} requires an authenticated user.`);
  }
  return owner;
}

/**
 * True when the given owner email is the anonymous public-plan viewer identity
 * minted by `resolvePublicPlanViewerOwner` (`public-<uuid>@agent-native.local`).
 *
 * These viewers can read public plans but have no real account; actions that
 * require an account (e.g. commenting) use this to reject them.
 */
export function isAnonymousPublicViewer(
  email: string | null | undefined,
): boolean {
  return (
    typeof email === "string" &&
    /^public-[0-9a-f-]+@agent-native\.local$/i.test(email)
  );
}
