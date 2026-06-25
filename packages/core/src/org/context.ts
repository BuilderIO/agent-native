import type { H3Event } from "h3";

import { getDbExec } from "../db/client.js";
import { getSession } from "../server/auth.js";
import { getSetting } from "../settings/store.js";
import { getUserSetting, putUserSetting } from "../settings/user-settings.js";
import { autoJoinDomainMatchingOrgs } from "./auto-join-domain.js";
import type { OrgContext, OrgRole } from "./types.js";

const EMPTY_CONTEXT: OrgContext = {
  email: "",
  orgId: null,
  orgName: null,
  role: null,
};

function normalizeOrgRole(value: unknown): OrgRole | null {
  return value === "owner" || value === "admin" || value === "member"
    ? value
    : null;
}

function isLikelyPersonalWorkspace(
  membership: { orgName: string },
  email: string,
  session: { name?: string } | null,
): boolean {
  return membership.orgName.trim() === defaultOrgName(email, session);
}

function autoCreateDefaultOrgEnabled(): boolean {
  const raw = process.env.AUTO_CREATE_DEFAULT_ORG;
  if (raw === undefined || raw.trim() === "") return true;
  return !["0", "false", "no", "off"].includes(raw.trim().toLowerCase());
}

const nanoid = (): string =>
  globalThis.crypto?.randomUUID?.().replace(/-/g, "") ??
  Math.random().toString(36).slice(2) + Date.now().toString(36);

/**
 * Resolve the current user's organization context from their session.
 *
 * - For users in multiple orgs, honors their `active-org-id` user setting.
 * - Falls back to the user's first membership.
 * - When the authenticated user has zero memberships, provisions a default org
 *   named after the user ({name}'s workspace, falling back to the email
 *   local-part). Set `AUTO_CREATE_DEFAULT_ORG=0` to opt out.
 *
 * Per-request memoized on `event.context` — mirrors the `getSession`
 * pattern so multiple callers in the same request (e.g. ssr-handler +
 * a loader) share a single org_members round trip.
 */
export async function getOrgContext(event: H3Event): Promise<OrgContext> {
  // Per-request memoization. Multiple call sites per request (action wrappers,
  // SSR handler, loaders) must not each pay a separate org_members query.
  const ctx = event.context as {
    __anOrgContextCache?: Promise<OrgContext>;
  };
  return (ctx.__anOrgContextCache ??= resolveOrgContextUncached(event));
}

async function resolveOrgContextUncached(event: H3Event): Promise<OrgContext> {
  const session = await getSession(event);
  const email = session?.email;
  if (!email) return EMPTY_CONTEXT;
  const sessionOrgId =
    typeof session.orgId === "string" && session.orgId.trim()
      ? session.orgId.trim()
      : null;
  const sessionOrgRole = normalizeOrgRole(session.orgRole);

  const exec = getDbExec();

  let memberships = await loadMemberships(exec, email);
  if (memberships === null) {
    if (sessionOrgId) {
      return {
        email,
        orgId: sessionOrgId,
        orgName: null,
        role: sessionOrgRole,
      };
    }
    return { email, orgId: null, orgName: null, role: null };
  }

  if (memberships.length > 1) {
    const activeOrgSetting = (await getUserSetting(email, "active-org-id")) as {
      orgId: string;
    } | null;
    if (activeOrgSetting?.orgId) {
      const active = memberships.find(
        (m) => m.orgId === activeOrgSetting.orgId,
      );
      if (active) {
        return {
          email,
          orgId: active.orgId,
          orgName: active.orgName,
          role: active.role,
        };
      }
    }
  }

  const sessionMembership = sessionOrgId
    ? memberships.find((m) => m.orgId === sessionOrgId)
    : null;
  const shouldTryDomainAutoJoin =
    memberships.length === 0 ||
    (memberships.length === 1 &&
      isLikelyPersonalWorkspace(memberships[0], email, session));

  if (shouldTryDomainAutoJoin) {
    const joined = await autoJoinDomainMatchingOrgs(email, {
      activateJoinedOrg: "always",
    });
    if (joined.joined.length > 0) {
      const refreshed = await loadMemberships(exec, email);
      if (refreshed !== null) memberships = refreshed;
    }

    if (joined.activeOrgId) {
      const active = memberships.find((m) => m.orgId === joined.activeOrgId);
      if (active) {
        return {
          email,
          orgId: active.orgId,
          orgName: active.orgName,
          role: active.role,
        };
      }
    }
  }

  if (sessionOrgId) {
    const active =
      sessionMembership ?? memberships.find((m) => m.orgId === sessionOrgId);
    if (active) {
      return {
        email,
        orgId: active.orgId,
        orgName: active.orgName,
        role: active.role,
      };
    }
    return {
      email,
      orgId: sessionOrgId,
      orgName: null,
      role: sessionOrgRole,
    };
  }

  if (memberships.length === 0 && autoCreateDefaultOrgEnabled()) {
    const created = await tryCreateDefaultOrg(exec, email, session);
    if (created) return created;
    // Creation failed (race / DB error); fall through with an empty org context
    // so non-blocking invite/domain UI can still surface recovery options.
  }

  if (memberships.length === 0) {
    return { email, orgId: null, orgName: null, role: null };
  }

  return {
    email,
    orgId: memberships[0].orgId,
    orgName: memberships[0].orgName,
    role: memberships[0].role,
  };
}

async function loadMemberships(
  exec: ReturnType<typeof getDbExec>,
  email: string,
): Promise<Array<{
  orgId: string;
  role: OrgRole;
  orgName: string;
}> | null> {
  try {
    const { rows } = await exec.execute({
      sql: `SELECT m.org_id AS "orgId", m.role AS role, o.name AS "orgName"
            FROM org_members m
            INNER JOIN organizations o ON m.org_id = o.id
            WHERE LOWER(m.email) = ?`,
      args: [email.toLowerCase()],
    });
    return rows.map((r: any) => ({
      orgId: String(r.orgId ?? r.org_id),
      role: String(r.role) as OrgRole,
      orgName: String(r.orgName ?? r.org_name),
    }));
  } catch {
    // Tables may not exist yet on first boot before migrations finish.
    return null;
  }
}

/**
 * Resolve the active org ID for a given email — for non-HTTP contexts like
 * the integration webhook handler where we have an email but no event/session.
 * Picks the user's active-org-id setting if set, otherwise the first membership.
 * Returns null if the user has no memberships.
 */
export async function resolveOrgIdForEmail(
  email: string,
): Promise<string | null> {
  const exec = getDbExec();
  if (!exec) return null;
  try {
    const { rows } = await exec.execute({
      sql: `SELECT org_id FROM org_members WHERE LOWER(email) = ?`,
      args: [email.toLowerCase()],
    });
    if (rows.length === 0) return null;
    const ids = rows.map((r: any) => String(r.org_id));
    if (ids.length === 1) return ids[0];
    const activeOrgSetting = (await getUserSetting(email, "active-org-id")) as {
      orgId: string;
    } | null;
    if (activeOrgSetting?.orgId && ids.includes(activeOrgSetting.orgId)) {
      return activeOrgSetting.orgId;
    }
    return ids[0];
  } catch {
    return null;
  }
}

/**
 * Create a new organization and add the caller as a member with the given
 * role. Generates a per-org A2A secret for cross-app delegation and writes
 * the caller's `active-org-id` user-setting so the new org is immediately
 * active.
 *
 */
export async function createOrganization(
  name: string,
  email: string,
  role: OrgRole = "owner",
): Promise<{
  id: string;
  name: string;
  role: OrgRole;
  a2aSecret: string;
  createdAt: number;
}> {
  const trimmedName = name.trim();
  const exec = getDbExec();
  const id = nanoid();
  const createdAt = Date.now();
  const { randomBytes } = await import("node:crypto");
  const a2aSecret = randomBytes(32).toString("base64url");

  await exec.execute({
    sql: `INSERT INTO organizations (id, name, created_by, created_at, a2a_secret) VALUES (?, ?, ?, ?, ?)`,
    args: [id, trimmedName, email, createdAt, a2aSecret],
  });

  await exec.execute({
    sql: `INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES (?, ?, ?, ?, ?)`,
    args: [nanoid(), id, email, role, createdAt],
  });

  await putUserSetting(email, "active-org-id", { orgId: id });

  return { id, name: trimmedName, role, a2aSecret, createdAt };
}

function defaultOrgName(
  email: string,
  session: { name?: string } | null,
): string {
  const full = session?.name?.trim();
  if (full) return `${full}'s workspace`;
  const local = email.split("@")[0] ?? email;
  const cleaned = local.replace(/[._-]+/g, " ").trim();
  const titled =
    cleaned
      .split(" ")
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ") || "My";
  return `${titled}'s workspace`;
}

/**
 * Check whether the user has a pending invitation. If so, auto-create
 * MUST be skipped — otherwise we'd provision a personal org for them
 * before they ever see the inviter's org in the invitation banner, and they'd
 * never join the team that invited them.
 */
async function hasPendingInvitation(
  exec: ReturnType<typeof getDbExec>,
  email: string,
): Promise<boolean> {
  try {
    const { rows } = await exec.execute({
      sql: `SELECT 1 FROM org_invitations WHERE LOWER(email) = ? AND status = 'pending' LIMIT 1`,
      args: [email.toLowerCase()],
    });
    return rows.length > 0;
  } catch {
    // If we can't tell, err on the side of NOT auto-creating — the
    // invitation banner or team UI can surface the situation.
    return true;
  }
}

async function hasDomainMatch(
  exec: ReturnType<typeof getDbExec>,
  email: string,
): Promise<boolean> {
  try {
    const domain = email.split("@")[1]?.toLowerCase();
    if (!domain) return false;
    const { rows } = await exec.execute({
      sql: `SELECT 1 FROM organizations WHERE LOWER(allowed_domain) = ? LIMIT 1`,
      args: [domain],
    });
    return rows.length > 0;
  } catch {
    return false;
  }
}

/** Stale-claim threshold. A claim row this old is treated as abandoned
 *  (process crashed, DELETE failed, etc.) and a new caller may take it
 *  over. Long enough that two genuine concurrent first-loads don't
 *  trample each other (those settle in milliseconds), short enough that
 *  a stuck user recovers on their next navigation. */
const CLAIM_TTL_MS = 5 * 60 * 1000;

/**
 * Attempt to provision a default org + owner membership for a user with
 * zero memberships.
 *
 * Race protection: claims the user's auto-create slot via an atomic
 * INSERT into the framework `settings` table (PRIMARY KEY (key) — so
 * concurrent inserts for the same key throw uniqueness violations on
 * both SQLite and Postgres). Only the request that wins the claim
 * proceeds to create the org; losers bail. By the time a losing
 * request retries on a subsequent navigation, the winner's org is in
 * `org_members` and the auto-create branch is skipped entirely.
 *
 * Stuck-state recovery: a stale claim (held longer than CLAIM_TTL_MS)
 * is reclaimed automatically. So even if the DELETE on the failure
 * path fails (network blip, DB error), the user isn't stranded — the
 * next request after the TTL elapses retries cleanly.
 *
 * Returns null on any failure so the caller can fall back to the
 * empty-context / client-guard path.
 */
async function tryCreateDefaultOrg(
  exec: ReturnType<typeof getDbExec>,
  email: string,
  session: { name?: string } | null,
): Promise<OrgContext | null> {
  // Make sure the framework `settings` table exists before we use it as
  // a claim primitive. getSetting() ensures the table on first call.
  await getSetting("__init").catch(() => null);

  const claimKey = `u:${email.toLowerCase()}:auto-create-claim`;

  if (!(await acquireClaim(exec, claimKey))) return null;

  // Pending-invite check happens INSIDE the claim so the window where a
  // newly-arrived invitation can be missed is narrowed to a single SQL
  // round-trip. (A still-narrower window would require a transaction
  // spanning org_invitations and settings — out of scope.)
  if (await hasPendingInvitation(exec, email)) {
    await releaseClaim(exec, claimKey);
    return null;
  }

  if (await hasDomainMatch(exec, email)) {
    await releaseClaim(exec, claimKey);
    return null;
  }

  try {
    const orgId = nanoid();
    const orgName = defaultOrgName(email, session);
    const now = Date.now();

    await exec.execute({
      sql: `INSERT INTO organizations (id, name, created_by, created_at) VALUES (?, ?, ?, ?)`,
      args: [orgId, orgName, email, now],
    });
    await exec.execute({
      sql: `INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES (?, ?, ?, ?, ?)`,
      args: [nanoid(), orgId, email, "owner", now],
    });

    await putUserSetting(email, "active-org-id", { orgId });

    return { email, orgId, orgName, role: "owner" };
  } catch {
    await releaseClaim(exec, claimKey);
    return null;
  }
}

async function acquireClaim(
  exec: ReturnType<typeof getDbExec>,
  claimKey: string,
): Promise<boolean> {
  const now = Date.now();
  try {
    await exec.execute({
      sql: `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)`,
      args: [claimKey, JSON.stringify({ at: now }), now],
    });
    return true;
  } catch {
    // Conflict — someone else's claim is already in the row. If it's
    // stale (older than CLAIM_TTL_MS) we take it over.
    //
    // CRITICAL: this MUST be a single atomic UPDATE guarded on
    // `updated_at <= staleThreshold`. A read-then-DELETE-then-INSERT
    // sequence lets two concurrent reclaimers each observe the stale
    // timestamp, delete each other's fresh claim, and both think they
    // won — duplicating org creation. The conditional UPDATE matches
    // each stale row at most once: only the first writer sees
    // rowsAffected === 1; the row's updated_at is now `now`, so any
    // subsequent UPDATE no longer satisfies `updated_at <= staleThreshold`
    // and matches zero rows.
    const staleThreshold = now - CLAIM_TTL_MS;
    const result = (await exec.execute({
      sql: `UPDATE settings SET value = ?, updated_at = ? WHERE key = ? AND updated_at <= ?`,
      args: [JSON.stringify({ at: now }), now, claimKey, staleThreshold],
    })) as { rowsAffected?: number };
    return (result.rowsAffected ?? 0) > 0;
  }
}

async function releaseClaim(
  exec: ReturnType<typeof getDbExec>,
  claimKey: string,
): Promise<void> {
  // Best-effort. If this fails (transient network/DB error), the
  // CLAIM_TTL_MS-based takeover in acquireClaim recovers automatically
  // on a future request — no permanent stuck state.
  await exec
    .execute({ sql: `DELETE FROM settings WHERE key = ?`, args: [claimKey] })
    .catch(() => {});
}

/**
 * Look up the `allowed_domain` for an org by its ID.
 * Used when making outbound A2A calls so the JWT includes the
 * caller's org domain for cross-app org resolution.
 */
export async function getOrgDomain(orgId: string): Promise<string | null> {
  try {
    const exec = getDbExec();
    const { rows } = await exec.execute({
      sql: `SELECT allowed_domain FROM organizations WHERE id = ? LIMIT 1`,
      args: [orgId],
    });
    if (!rows[0]) return null;
    const domain = String((rows[0] as any).allowed_domain || "");
    return domain || null;
  } catch {
    return null;
  }
}

/**
 * Look up the org's A2A secret by org ID.
 * Used when making outbound A2A calls so the JWT is signed with the
 * org-specific secret rather than the global A2A_SECRET env var.
 */
export async function getOrgA2ASecret(orgId: string): Promise<string | null> {
  try {
    const exec = getDbExec();
    const { rows } = await exec.execute({
      sql: `SELECT a2a_secret FROM organizations WHERE id = ? LIMIT 1`,
      args: [orgId],
    });
    if (!rows[0]) return null;
    const secret = String((rows[0] as any).a2a_secret || "");
    return secret || null;
  } catch {
    return null;
  }
}

/**
 * Look up an org's A2A secret by its `allowed_domain`.
 * Used on the A2A receiving side: the caller's JWT includes `org_domain`,
 * and the receiver looks up which local org matches that domain to find
 * the secret used to verify the JWT signature.
 */
export async function getA2ASecretByDomain(
  domain: string,
): Promise<string | null> {
  try {
    const exec = getDbExec();
    const { rows } = await exec.execute({
      sql: `SELECT a2a_secret FROM organizations WHERE LOWER(allowed_domain) = ? LIMIT 1`,
      args: [domain.toLowerCase()],
    });
    if (!rows[0]) return null;
    const secret = String((rows[0] as any).a2a_secret || "");
    return secret || null;
  } catch {
    return null;
  }
}

/**
 * Resolve a local org by its `allowed_domain`.
 * Used on the A2A receiving side: the caller sends `org_domain` in the JWT,
 * and the receiver looks up which local org matches that domain.
 */
export async function resolveOrgByDomain(
  domain: string,
): Promise<{ orgId: string; orgName: string } | null> {
  try {
    const exec = getDbExec();
    const { rows } = await exec.execute({
      sql: `SELECT id, name FROM organizations WHERE LOWER(allowed_domain) = ? LIMIT 1`,
      args: [domain.toLowerCase()],
    });
    if (!rows[0]) return null;
    return {
      orgId: String((rows[0] as any).id),
      orgName: String((rows[0] as any).name),
    };
  } catch {
    return null;
  }
}
