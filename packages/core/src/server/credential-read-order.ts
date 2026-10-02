/**
 * Which credential answers first when a caller has their own and their
 * organization has one too. Owners and admins run on the organization's, so a
 * personal key or Builder.io account kept from before a promotion, or created
 * by a one-off activation, never shadows the connection the org pays for.
 * Members run on their own first. Their own stays the fallback for everyone:
 * an org with no credential of its own still runs on an owner's.
 *
 * Every credential resolver orders its scopes with this module, so the rule
 * lives here and nowhere else.
 */
import { readOrgMemberRole } from "./personal-provider-key-policy.js";
import { getRequestContext } from "./request-context.js";

// One role read per (email, org) per request: a chat turn resolves many keys.
const _requestAnswers = new WeakMap<object, Map<string, Promise<boolean>>>();

function requestCache(): Map<string, Promise<boolean>> | null {
  const ctx = getRequestContext();
  if (!ctx || typeof ctx !== "object") return null;
  let cache = _requestAnswers.get(ctx);
  if (!cache) {
    cache = new Map();
    _requestAnswers.set(ctx, cache);
  }
  return cache;
}

function isMissingOrgMembersTable(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  if (candidate?.code === "42P01") return true;
  return /relation ["']?org_members["']? does not exist/i.test(
    String(candidate?.message ?? error),
  );
}

/**
 * True when `email` is an owner or admin of `orgId`. Throws when the role
 * cannot be read: guessing "member" would run a manager on the personal
 * credential the organization's is meant to replace. A database that never
 * created the org tables has no managers.
 */
export async function readsOrgCredentialFirst(
  orgId: string | null | undefined,
  email: string,
): Promise<boolean> {
  const org = orgId?.trim();
  const member = email.trim().toLowerCase();
  if (!org || !member) return false;
  const cache = requestCache();
  const cacheKey = `${member}\u0000${org}`;
  const cached = cache?.get(cacheKey);
  if (cached) return cached;
  const pending = readOrgMemberRole(org, member).then(
    (role) => role === "owner" || role === "admin",
    (error: unknown) => {
      if (isMissingOrgMembersTable(error)) return false;
      throw error;
    },
  );
  if (cache) {
    cache.set(cacheKey, pending);
    // A failed read must be retried, not remembered.
    pending.catch(() => cache.delete(cacheKey));
  }
  return pending;
}

/** The caller's own rows: their `user` row and pre-organization `solo:` row. */
export function isPersonalCredentialScope(ref: {
  scope: string;
  scopeId: string;
}): boolean {
  return ref.scope === "user" || ref.scopeId.startsWith("solo:");
}

/**
 * `refs` in read order: unchanged for a member, the organization's rows ahead
 * of the caller's own for an owner or admin. Reads the role only when `refs`
 * hold both kinds.
 */
export async function orderCredentialScopes<
  T extends { scope: string; scopeId: string },
>(
  refs: readonly T[],
  orgId: string | null | undefined,
  email: string,
): Promise<T[]> {
  const personal = refs.filter(isPersonalCredentialScope);
  const shared = refs.filter((ref) => !isPersonalCredentialScope(ref));
  if (personal.length === 0 || shared.length === 0) return [...refs];
  return (await readsOrgCredentialFirst(orgId, email))
    ? [...shared, ...personal]
    : [...refs];
}
