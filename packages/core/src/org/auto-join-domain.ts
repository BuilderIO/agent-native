import { getDbExec } from "../db/client.js";
import { getUserSetting } from "../settings/user-settings.js";
import { createTtlCache } from "../shared/ttl-cache.js";
import { setActiveOrgId } from "./active-org.js";
import { isFreeEmailProvider } from "./free-email-providers.js";
import { invalidateMemberOrgCaches } from "./request-org-cache.js";

const nanoid = (): string =>
  globalThis.crypto?.randomUUID?.().replace(/-/g, "") ??
  Math.random().toString(36).slice(2) + Date.now().toString(36);

export interface AutoJoinDomainResult {
  joined: Array<{ orgId: string }>;
  activeOrgId: string | null;
}

/**
 * Negative cache for "no org has this email domain as its `allowed_domain`".
 *
 * `resolveOrgContext` calls this function on EVERY authenticated request for
 * any account that holds no membership in a domain-matched org — which is every
 * solo user and every user in a team org that never configured domain matching.
 * The probe finds nothing, changes no state, and runs again on the next
 * request: production showed 318k of these, ~64% of all authenticated requests,
 * with no fixed point because not-joining an org is not a state the user can
 * leave.
 *
 * Keyed on the DOMAIN, not the email, so one entry covers every account at that
 * domain. Only a SUCCESSFUL zero-row read is cached — a failed probe stays on
 * the uncached path so an unreadable `organizations` table never masquerades as
 * "no matching org". Invalidated whenever `allowed_domain` is written, so
 * correctness does not rest on the TTL.
 */
const NO_DOMAIN_MATCH_TTL_MS = 60_000;
const noDomainMatchCache = createTtlCache<true>({
  ttlMs: NO_DOMAIN_MATCH_TTL_MS,
  maxEntries: 512,
});

/**
 * Call after any write that could make a domain start matching an org —
 * `organizations.allowed_domain` updates and org creation. Clears every domain
 * rather than one: the caller knows which org changed, not which domains a
 * stale negative was recorded for.
 */
export function invalidateDomainMatchCache(): void {
  noDomainMatchCache.clear();
}

/** Test seam — the cache is module state, so suites must be able to clear it. */
export function __resetDomainMatchCacheForTests(): void {
  noDomainMatchCache.clear();
}

export interface AutoJoinDomainOptions {
  /**
   * The signup hook should not clobber an org selected by an invite flow, but
   * request-time org resolution may need to move an existing account from a
   * personal workspace into its newly matched company org. `"never"` joins
   * without touching `active-org-id` — the caller decides activation itself.
   */
  activateJoinedOrg?: "if-missing" | "always" | "never";
}

/**
 * Auto-join a newly-signed-up user into every org whose `allowed_domain`
 * matches their email domain.
 *
 * Called from the Better Auth `user.create.after` hook so that e.g. a new
 * `@builder.io` signup lands inside the existing Builder.io org on first
 * page load instead of starting in Personal and having to find the join
 * CTA. The org's owner opts into this by setting
 * `organizations.allowed_domain` — the column already gated the manual
 * "Join your team" UI in the picker; we use the same opt-in to drive
 * automatic join.
 *
 * Idempotent — skips orgs the user is already a member of and, by default,
 * never overwrites an existing `active-org-id` setting.
 *
 * Safe to call when the org tables don't exist (some templates don't use
 * the org module): it swallows the "no such table" error and returns
 * empty. Never throws — the caller is a signup hook and we don't want to
 * block a user from creating their account because of an org-tier issue.
 */
export async function autoJoinDomainMatchingOrgs(
  rawEmail: string,
  options: AutoJoinDomainOptions = {},
): Promise<AutoJoinDomainResult> {
  const email = rawEmail.trim().toLowerCase();
  if (!email) return { joined: [], activeOrgId: null };

  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return { joined: [], activeOrgId: null };

  // `org/handlers.ts` REFUSES to set `allowed_domain` to a free provider, so no
  // org can ever match `gmail.com` — every consumer-email account was probing
  // for a row that is structurally impossible to exist.
  if (isFreeEmailProvider(domain)) return { joined: [], activeOrgId: null };

  if (noDomainMatchCache.get(domain)) {
    return { joined: [], activeOrgId: null };
  }

  const db = getDbExec();

  let matches: Array<{ orgId: string }> = [];
  try {
    const res = await db.execute({
      sql: `SELECT o.id AS "orgId"
            FROM organizations o
            WHERE LOWER(o.allowed_domain) = ?
              AND NOT EXISTS (
                SELECT 1
                FROM org_members m
                WHERE m.org_id = o.id
                  AND LOWER(m.email) = ?
              )
            ORDER BY o.created_at ASC`,
      args: [domain, email],
    });
    matches = res.rows.map((r: any) => ({
      orgId: String(r.orgId ?? r.org_id),
    }));
  } catch {
    // Template without org tables (or `allowed_domain` column not yet
    // migrated). Not fatal — return empty. Deliberately NOT cached: this branch
    // cannot tell "no org matches" from "the table was unreadable", and caching
    // it would let one blip answer every later request for a minute.
    return { joined: [], activeOrgId: null };
  }

  if (matches.length === 0) {
    noDomainMatchCache.set(domain, true);
    return { joined: [], activeOrgId: null };
  }

  const joined: AutoJoinDomainResult["joined"] = [];
  for (const m of matches) {
    try {
      await db.execute({
        sql: `INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES (?, ?, ?, 'member', ?)`,
        args: [nanoid(), m.orgId, email, Date.now()],
      });
      joined.push({ orgId: m.orgId });
      invalidateMemberOrgCaches();
    } catch {
      // Race with a parallel join (e.g. user accepted an invite to the
      // same org milliseconds earlier). The unique constraint keeps the
      // existing membership intact; just skip this org.
    }
  }

  // Set active-org-id to the first match only if the user doesn't already have
  // one, unless the caller is request-time org resolution intentionally moving
  // an existing account into its newly matched company org.
  let activeOrgId: string | null = null;
  if (joined[0] && options.activateJoinedOrg !== "never") {
    try {
      const existing = await getUserSetting(email, "active-org-id");
      const hasActive = Boolean(existing?.orgId);
      if (options.activateJoinedOrg === "always" || !hasActive) {
        activeOrgId = joined[0].orgId;
        await setActiveOrgId(
          email,
          activeOrgId,
          "auto-joined domain-matched org",
        );
      }
    } catch {
      // settings table missing — not fatal.
    }
  }

  return { joined, activeOrgId };
}
