import { getDbExec } from "../db/client.js";
import { evaluateFeatureFlagStrict } from "../feature-flags/store.js";
import { getUserSetting } from "../settings/user-settings.js";
import { createTtlCache } from "../shared/ttl-cache.js";
import { setActiveOrgId } from "./active-org.js";
import { CROSS_APP_ORG_FEDERATION_FLAG } from "./feature-flags.js";
import { isFreeEmailProvider } from "./free-email-providers.js";
import { invalidateMemberOrgCaches } from "./request-org-cache.js";

const nanoid = (): string =>
  globalThis.crypto?.randomUUID?.().replace(/-/g, "") ??
  Math.random().toString(36).slice(2) + Date.now().toString(36);

export interface AutoJoinDomainResult {
  joined: Array<{ orgId: string }>;
  activeOrgId: string | null;
}

type DomainMatch = { orgId: string; federated: boolean };

const NO_DOMAIN_MATCH_TTL_MS = 60_000;
const noDomainMatchCache = createTtlCache<true>({
  ttlMs: NO_DOMAIN_MATCH_TTL_MS,
  maxEntries: 512,
});

export function invalidateDomainMatchCache(): void {
  noDomainMatchCache.clear();
}

export function __resetDomainMatchCacheForTests(): void {
  noDomainMatchCache.clear();
}

export async function hasAutoJoinDomainMatch(
  rawEmail: string,
): Promise<boolean> {
  const email = rawEmail.trim().toLowerCase();
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain || isFreeEmailProvider(domain)) return false;
  try {
    const { rows } = await getDbExec().execute({
      sql: `SELECT 1 FROM organizations
            WHERE LOWER(allowed_domain) = ?
            LIMIT 1`,
      args: [domain],
    });
    return rows.length > 0;
  } catch (error) {
    const candidate = error as { code?: unknown; message?: unknown };
    if (
      candidate.code === "42P01" ||
      /no such table: ["'`]?organizations|relation ["'`]?organizations["'`]? does not exist/i.test(
        String(candidate.message ?? error),
      )
    ) {
      return false;
    }
    throw error;
  }
}

export interface AutoJoinDomainOptions {
  activateJoinedOrg?: "if-missing" | "always" | "never";
}

export async function autoJoinDomainMatchingOrgs(
  rawEmail: string,
  options: AutoJoinDomainOptions = {},
): Promise<AutoJoinDomainResult> {
  const email = rawEmail.trim().toLowerCase();
  if (!email) return { joined: [], activeOrgId: null };

  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return { joined: [], activeOrgId: null };

  if (isFreeEmailProvider(domain)) return { joined: [], activeOrgId: null };

  if (noDomainMatchCache.get(domain)) {
    return { joined: [], activeOrgId: null };
  }

  const db = getDbExec();

  let matches: DomainMatch[] = [];
  try {
    const res = await db.execute({
      sql: `SELECT o.id AS "orgId", o.identity_authority AS "identityAuthority",
                   o.identity_id AS "identityId"
            FROM organizations o
            WHERE LOWER(o.allowed_domain) = ?
              AND NOT EXISTS (
                SELECT 1
                FROM org_members m
                WHERE m.org_id = o.id
                  AND LOWER(m.email) = ?
                  AND m.federation_removal_pending_at IS NULL
              )
            ORDER BY o.created_at ASC`,
      args: [domain, email],
    });
    matches = res.rows.map((r: any) => ({
      orgId: String(r.orgId ?? r.org_id),
      federated: Boolean(
        String(r.identityAuthority ?? r.identity_authority ?? "").trim() &&
        String(r.identityId ?? r.identity_id ?? "").trim(),
      ),
    }));
  } catch {
    return { joined: [], activeOrgId: null };
  }

  if (matches.length === 0) {
    noDomainMatchCache.set(domain, true);
    return { joined: [], activeOrgId: null };
  }

  const joined: AutoJoinDomainResult["joined"] = [];
  let federationSkipped = false;
  let federationUnavailable = false;
  let localJoinAttempted = false;
  for (const m of matches) {
    if (m.federated) {
      try {
        if (
          await evaluateFeatureFlagStrict(CROSS_APP_ORG_FEDERATION_FLAG.key, {
            userEmail: email,
            userKey: email,
            orgId: m.orgId,
          })
        ) {
          federationSkipped = true;
          continue;
        }
      } catch {
        federationSkipped = true;
        federationUnavailable = true;
        continue;
      }
    }
    localJoinAttempted = true;
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

  if (federationSkipped && !localJoinAttempted && !federationUnavailable) {
    noDomainMatchCache.set(domain, true);
  }

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
