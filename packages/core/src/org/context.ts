import type { H3Event } from "h3";
import { getSession } from "../server/auth.js";
import { getUserSetting } from "../settings/user-settings.js";
import { getDbExec } from "../db/client.js";
import { getSetting } from "../settings/store.js";
import type { OrgContext, OrgRole } from "./types.js";

const EMPTY_CONTEXT: OrgContext = {
  email: "",
  orgId: null,
  orgName: null,
  role: null,
};

const nanoid = (): string =>
  globalThis.crypto?.randomUUID?.().replace(/-/g, "") ??
  Math.random().toString(36).slice(2) + Date.now().toString(36);

/**
 * Resolve the current user's organization context from their session.
 *
 * - For users in multiple orgs, honors their `active-org-id` user setting.
 * - Falls back to the user's first membership.
 * - `local@localhost` (dev / no-auth mode) is treated as a regular identity:
 *   it owns whatever orgs it has created locally.
 * - When `AUTO_CREATE_DEFAULT_ORG` is set and the authenticated user has
 *   zero memberships, provisions a default org named after the user
 *   ({name}'s workspace, falling back to the email local-part). Opt-in
 *   per deployment so templates that don't use orgs don't accrue phantom
 *   default orgs in their DB. The <RequireActiveOrg> client guard remains
 *   the safety net for pre-existing accounts or provisioning failures.
 */
export async function getOrgContext(event: H3Event): Promise<OrgContext> {
  const session = await getSession(event);
  const email = session?.email;
  // No `?? "local@localhost"` fallback — if the session is genuinely
  // missing (misconfigured prod, expired token mid-request) don't
  // silently promote the caller to the shared dev identity.
  if (!email) return EMPTY_CONTEXT;

  const exec = getDbExec();

  let memberships: Array<{
    orgId: string;
    role: OrgRole;
    orgName: string;
  }> = [];
  try {
    const { rows } = await exec.execute({
      sql: `SELECT m.org_id AS "orgId", m.role AS role, o.name AS "orgName"
            FROM org_members m
            INNER JOIN organizations o ON m.org_id = o.id
            WHERE LOWER(m.email) = ?`,
      args: [email.toLowerCase()],
    });
    memberships = rows.map((r: any) => ({
      orgId: String(r.orgId ?? r.org_id),
      role: String(r.role) as OrgRole,
      orgName: String(r.orgName ?? r.org_name),
    }));
  } catch {
    // Tables may not exist yet on first boot before migrations finish.
    return { email, orgId: null, orgName: null, role: null };
  }

  if (memberships.length === 0 && process.env.AUTO_CREATE_DEFAULT_ORG) {
    const created = await tryCreateDefaultOrg(exec, email, session);
    if (created) return created;
    // Creation failed (race / DB error); fall through and let the
    // RequireActiveOrg client guard prompt the user.
  }

  if (memberships.length === 0) {
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

  return {
    email,
    orgId: memberships[0].orgId,
    orgName: memberships[0].orgName,
    role: memberships[0].role,
  };
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
 * before they ever see the inviter's org in the RequireActiveOrg
 * accept-invite pane, and they'd never join the team that invited them.
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
    // RequireActiveOrg client guard will surface the situation.
    return true;
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
    // Conflict — someone else's claim is in the row. If it's stale, take
    // it over; otherwise yield.
    const existing = (await getSetting(claimKey).catch(() => null)) as {
      at?: number;
    } | null;
    const at = typeof existing?.at === "number" ? existing.at : 0;
    if (now - at < CLAIM_TTL_MS) return false;

    await exec
      .execute({ sql: `DELETE FROM settings WHERE key = ?`, args: [claimKey] })
      .catch(() => {});
    try {
      await exec.execute({
        sql: `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)`,
        args: [claimKey, JSON.stringify({ at: now }), now],
      });
      return true;
    } catch {
      return false;
    }
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
