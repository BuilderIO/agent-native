/**
 * Local single-user identity resolution for the no-login local mode.
 *
 * `/visual-plan` is local-first: by default a person creates, edits, and views
 * plans with NO login. Plans persist to the local repo as MDX plus local SQL.
 * Only when they want to SHARE a plan do they make a lazy account and publish
 * the plan to a hosted instance (see `publish-visual-plan`).
 *
 * To make that work, the plan actions must resolve one stable local owner
 * identity for local plan work — even when the browser happens to have a dev
 * auth session. On a hosted/production deployment a missing user must still be
 * rejected.
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
 *
 * `PLAN_LOCAL_OWNER_EMAIL` may override the synthetic owner in local runtime
 * only. This is useful when pointing localhost at a shared/prod database to
 * inspect private rows owned by the signed-in hosted account.
 */

/**
 * Stable owner email for the local single-user identity. Kept distinct from the
 * core dev sentinel `local@localhost` (which the resolvers intentionally reject)
 * and from the anonymous public-viewer identity `public-*@agent-native.local`.
 */
export const LOCAL_PLAN_OWNER_EMAIL = "local@agent-native.local";

export function getLocalPlanOwnerEmail(): string {
  return process.env.PLAN_LOCAL_OWNER_EMAIL?.trim() || LOCAL_PLAN_OWNER_EMAIL;
}

/**
 * Domain used for hosted guest-author identities (`guest-<uuid>@agent-native.guest`).
 *
 * Deliberately a DIFFERENT top-level domain from the local single-user identity
 * (`local@agent-native.local`) and the anonymous public-viewer identity
 * (`public-*@agent-native.local`). The distinct domain makes guest authors
 * trivially distinguishable from real accounts and from the other two synthetic
 * identities — both for `isGuestAuthorIdentity()` here and for the future claim
 * agent that migrates a guest's plans onto a real account.
 */
export const GUEST_AUTHOR_DOMAIN = "agent-native.guest";

/**
 * True when the given owner email is a hosted guest-author identity minted by
 * `resolvePlanGuestAuthorOwner` (`guest-<uuid>@agent-native.guest`).
 *
 * Guest authors may create/read/list/edit their OWN plans (scoped by exact
 * `ownerEmail` match), but have no real account — actions that require an
 * account (e.g. commenting, sharing) use this to reject them.
 */
export function isGuestAuthorIdentity(
  email: string | null | undefined,
): boolean {
  return (
    typeof email === "string" &&
    /^guest-[0-9a-f-]+@agent-native\.guest$/i.test(email)
  );
}

/**
 * True when this process is allowed to assume the local single-user identity.
 *
 * CRITICAL: this must never return true on a hosted/production deploy. The
 * production short-circuit is first and unconditional.
 */
export function isLocalPlanRuntime(): boolean {
  // Hard refusal: never assume a local identity in production, regardless of
  // any other flag. Mirrors the runtime assertions in core's dev fallbacks.
  // Case-insensitive + whitespace-tolerant: a mis-cased "Production" or a padded
  // value must still trip the hard refusal, never silently enable local mode.
  const nodeEnv = (process.env.NODE_ENV ?? "").trim().toLowerCase();
  if (nodeEnv === "production" || nodeEnv === "prod") return false;

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

function shouldUseLocalPlanOwner(
  authenticatedEmail: string | undefined,
): boolean {
  if (!isLocalPlanRuntime()) return false;
  // Public-link viewers stay read-only public viewers. Do not accidentally turn
  // an anonymous public review session into the local owner/editor.
  if (isAnonymousPublicViewer(authenticatedEmail)) return false;
  return true;
}

export type PlanAccessContext = {
  userEmail?: string;
  orgId?: string;
};

/**
 * Current request context adjusted for local single-user plan access.
 *
 * In local plan runtime, a coding agent may create a plan through the CLI/no-login
 * path while Codex Desktop has a signed-in browser session. Both are one local
 * workspace, so reads/lists/edits should resolve against the same synthetic
 * owner instead of stranding private plans behind whichever auth surface created
 * them. Hosted/production contexts are returned unchanged.
 */
export function resolvePlanAccessContext(
  ctx: PlanAccessContext,
): PlanAccessContext {
  if (shouldUseLocalPlanOwner(ctx.userEmail)) {
    const localOrgId = process.env.PLAN_LOCAL_ORG_ID?.trim();
    return {
      userEmail: getLocalPlanOwnerEmail(),
      ...(localOrgId ? { orgId: localOrgId } : {}),
    };
  }
  return ctx;
}

/**
 * Resolve the org scope that should be persisted beside a newly written plan.
 * This mirrors `resolvePlanAccessContext()` so local single-user plans do not
 * get tagged with an authenticated dev-session org that the synthetic local
 * owner cannot later access.
 */
export function resolvePlanOrgIdForWrite(
  authenticatedEmail: string | undefined,
  requestOrgId: string | undefined,
): string | undefined {
  return resolvePlanAccessContext({
    userEmail: authenticatedEmail,
    orgId: requestOrgId,
  }).orgId;
}

/**
 * Resolve the owner email for a plan write/read.
 *
 * Priority:
 *   1. The local single-user identity, ONLY when `isLocalPlanRuntime()` and the
 *      caller is not an anonymous public-plan viewer.
 *   2. The authenticated request user (hosted and non-local auth modes).
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
  if (shouldUseLocalPlanOwner(authenticatedEmail)) {
    return getLocalPlanOwnerEmail();
  }
  if (authenticatedEmail) return authenticatedEmail;
  return undefined;
}

/**
 * Resolve the owner email for a plan WRITE (create / import / patch / visualize).
 *
 * Resolution priority:
 *   1. The local single-user identity, ONLY when `isLocalPlanRuntime()` and the
 *      caller is not an anonymous public-plan viewer.
 *   2. The authenticated request user, except for the legacy hosted guest-author
 *      identity (`guest-*@agent-native.guest`), which is no longer allowed to
 *      write on hosted deployments.
 *
 * Anonymous public-plan VIEWERS (`public-*@agent-native.local`) must never reach
 * this path — they are read-only.
 *
 * Returns `undefined` when no identity is available (hosted + truly
 * unidentified), so callers reject exactly as before.
 */
export function resolvePlanOwnerEmailForWrite(
  authenticatedEmail: string | undefined,
): string | undefined {
  if (shouldUseLocalPlanOwner(authenticatedEmail)) {
    return getLocalPlanOwnerEmail();
  }
  if (authenticatedEmail && !isGuestAuthorIdentity(authenticatedEmail)) {
    return authenticatedEmail;
  }
  return undefined;
}

/**
 * Resolve the owner email for a plan write and throw a friendly error when no
 * identity is available. Use at the top of create-style actions.
 *
 * Accepts a real account or the local single-user identity (local mode). On a
 * hosted deploy with no authenticated user it throws, preserving the
 * "requires an authenticated user" contract for unidentified requests.
 */
export function requirePlanOwnerEmailForWrite(
  authenticatedEmail: string | undefined,
  action: string,
): string {
  const owner = resolvePlanOwnerEmailForWrite(authenticatedEmail);
  if (!owner) {
    throw new Error(`${action} requires an authenticated user.`);
  }
  return owner;
}

/**
 * Legacy require helper retained for backward compatibility. Behaves exactly as
 * before (authenticated user OR local single-user identity; throws otherwise).
 *
 * Note: create-style actions use `requirePlanOwnerEmailForWrite`, which rejects
 * legacy hosted guest-author identities.
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
