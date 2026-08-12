import type { H3Event } from "h3";

import { warnAgent } from "../agent/action-warnings.js";
import { appStatePut } from "../application-state/store.js";
import { getDbExec, isTransientDatabaseError } from "../db/client.js";
import { getSession } from "../server/auth.js";
import { getSetting } from "../settings/store.js";
import { getUserSetting } from "../settings/user-settings.js";
import { FIRST_RUN_ONBOARDING_ELIGIBLE_KEY } from "../shared/first-run-onboarding.js";
import { setActiveOrgId } from "./active-org.js";
import { autoJoinDomainMatchingOrgs } from "./auto-join-domain.js";
import { isFreeEmailProvider } from "./free-email-providers.js";
import {
  cachedMemberships,
  invalidateMemberOrgCaches,
  requestMemberOrgIds,
} from "./request-org-cache.js";
import type { OrgContext, OrgRole } from "./types.js";

const EMPTY_CONTEXT: OrgContext = {
  email: "",
  orgId: null,
  orgName: null,
  role: null,
};

/**
 * The single way to read `org_members`, so no two call sites can pick opposite
 * defaults for the same failure. A transient database failure is NOT an answer
 * and propagates: a caller that turns it into "no memberships" silently drops
 * org scope, which hides every org-scoped credential behind a
 * permanent-sounding "not configured".
 *
 * `null` is every non-transient failure, not only the intended one (org tables
 * absent on a fresh install before migrations). A permanently unreadable table
 * — a role without SELECT, say — still reports as "no rows" here. Narrowing
 * that further means classifying "no database configured" as readable-absent,
 * which is load-bearing for CLI/script/test contexts that legitimately run
 * without a store; see `assertCredentialStoreReadable`.
 */
export async function queryOrgMembers(query: {
  sql: string;
  args: unknown[];
}): Promise<Record<string, unknown>[] | null> {
  try {
    const { rows } = await getDbExec().execute(query);
    return rows as Record<string, unknown>[];
  } catch (err) {
    if (isTransientDatabaseError(err)) throw err;
    return null;
  }
}

function normalizeOrgRole(value: unknown): OrgRole | null {
  return value === "owner" || value === "admin" || value === "member"
    ? value
    : null;
}

function emailDomainOf(email: string): string | null {
  return email.split("@")[1]?.toLowerCase() || null;
}

/**
 * A workspace the user owns that nobody else has joined is a default/personal
 * workspace whatever it happens to be named, so moving the user into their
 * company org is safe. An org with other members is a team they deliberately
 * belong to — join the domain org in the background but leave them there.
 */
async function isSoloOwnedWorkspace(
  exec: ReturnType<typeof getDbExec>,
  orgId: string,
  memberships: MembershipRow[],
): Promise<boolean> {
  const membership = memberships.find((m) => m.orgId === orgId);
  if (!membership || membership.role !== "owner") return false;
  try {
    const { rows } = await exec.execute({
      sql: `SELECT COUNT(*) AS "memberCount" FROM org_members WHERE org_id = ?`,
      args: [orgId],
    });
    const row = rows[0] as any;
    return Number(row?.memberCount ?? row?.membercount ?? 0) <= 1;
  } catch {
    return false;
  }
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
 * - Honors the user's `active-org-id` setting, including an explicit Personal
 *   context represented by `{ orgId: null }`.
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
  // Evict on failure. A memoized failure would otherwise answer every later
  // caller in this request with the wrong org.
  return (ctx.__anOrgContextCache ??= resolveOrgContextUncached(event).catch(
    (err) => {
      delete ctx.__anOrgContextCache;
      throw err;
    },
  ));
}

type MembershipRow = {
  orgId: string;
  role: OrgRole;
  orgName: string;
  allowedDomain: string | null;
};

const MEMBERSHIPS_CACHE_KEY = "__anOrgMembershipsCache";
const ACTIVE_ORG_SETTING_CACHE_KEY = "__anActiveOrgSettingCache";

type ActiveOrgSetting = { orgId: string | null } | null;

function loadActiveOrgSettingForEvent(
  event: H3Event,
  email: string,
): Promise<ActiveOrgSetting> {
  const ctx = event.context as Record<string, unknown>;
  const cache = ((ctx[ACTIVE_ORG_SETTING_CACHE_KEY] as
    | Map<string, Promise<ActiveOrgSetting>>
    | undefined) ??
    (ctx[ACTIVE_ORG_SETTING_CACHE_KEY] = new Map<
      string,
      Promise<ActiveOrgSetting>
    >())) as Map<string, Promise<ActiveOrgSetting>>;
  const normalizedEmail = email.toLowerCase();
  let promise = cache.get(normalizedEmail);
  if (!promise) {
    promise = getUserSetting(email, "active-org-id").then((value) => {
      if (!value || !("orgId" in value)) return null;
      if (value.orgId === null) return { orgId: null };
      return typeof value.orgId === "string" ? { orgId: value.orgId } : null;
    });
    cache.set(normalizedEmail, promise);
  }
  return promise;
}

/**
 * Per-request memoization of the org_members lookup, keyed by email on
 * `event.context`. Both the session org backfill (inside `getSession`) and
 * `getOrgContext` need the membership rows; without sharing, every request
 * whose session lacks an orgId pays the query twice.
 */
function loadMembershipsForEvent(
  event: H3Event,
  email: string,
): Promise<MembershipRow[] | null> {
  const ctx = event.context as Record<string, unknown>;
  const cache = ((ctx[MEMBERSHIPS_CACHE_KEY] as
    | Map<string, Promise<MembershipRow[] | null>>
    | undefined) ??
    (ctx[MEMBERSHIPS_CACHE_KEY] = new Map<
      string,
      Promise<MembershipRow[] | null>
    >())) as Map<string, Promise<MembershipRow[] | null>>;
  let promise = cache.get(email);
  if (!promise) {
    // A failed read is evicted rather than memoized: caching it would make one
    // transient error answer every later lookup in this request.
    promise = loadMemberships(email).catch((err) => {
      cache.delete(email);
      throw err;
    });
    cache.set(email, promise);
  }
  return promise;
}

function updateMembershipsForEvent(
  event: H3Event,
  email: string,
  memberships: MembershipRow[] | null,
): void {
  const ctx = event.context as Record<string, unknown>;
  const cache = ctx[MEMBERSHIPS_CACHE_KEY] as
    | Map<string, Promise<MembershipRow[] | null>>
    | undefined;
  cache?.set(email, Promise.resolve(memberships));
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

  // Started before the memberships await so the two round trips overlap; the
  // `catch` only covers the early returns below, the later `await` still
  // propagates a real failure.
  const activeOrgSettingPromise = loadActiveOrgSettingForEvent(event, email);
  activeOrgSettingPromise.catch(() => {});

  let memberships: MembershipRow[] | null;
  try {
    memberships = await loadMembershipsForEvent(event, email);
  } catch (err) {
    // A transient membership read must not downgrade an authenticated request
    // to a private/solo scope when the session already carries its org.
    if (sessionOrgId && isTransientDatabaseError(err)) {
      return {
        email,
        orgId: sessionOrgId,
        orgName: null,
        role: sessionOrgRole,
      };
    }
    throw err;
  }
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

  const activeOrgSetting = await activeOrgSettingPromise;
  const explicitPersonal = activeOrgSetting?.orgId === null;

  const emailDomain = emailDomainOf(email);
  // Membership in a domain-matched org is the only durable "already joined"
  // signal. Recognizing the personal workspace by its *name* instead breaks the
  // moment the provider display name or the workspace name changes, which
  // strands an existing user in Personal with no way into their company org.
  // `isFreeEmailProvider` short-circuits before the round trip rather than
  // relying on the negative cache inside `autoJoinDomainMatchingOrgs`: a
  // consumer-email domain can NEVER match (see `org/handlers.ts`, which refuses
  // to set `allowed_domain` to a free provider), so it needs no TTL at all.
  const shouldTryDomainAutoJoin =
    !explicitPersonal &&
    emailDomain !== null &&
    !isFreeEmailProvider(emailDomain) &&
    !memberships.some((m) => m.allowedDomain?.toLowerCase() === emailDomain);

  if (
    !explicitPersonal &&
    activeOrgSetting?.orgId &&
    !shouldTryDomainAutoJoin
  ) {
    const active = memberships.find((m) => m.orgId === activeOrgSetting.orgId);
    if (active) {
      return {
        email,
        orgId: active.orgId,
        orgName: active.orgName,
        role: active.role,
      };
    }
  }

  const sessionMembership = sessionOrgId
    ? memberships.find((m) => m.orgId === sessionOrgId)
    : null;

  if (shouldTryDomainAutoJoin) {
    const membershipsBeforeJoin = memberships;
    const joined = await autoJoinDomainMatchingOrgs(email, {
      activateJoinedOrg: "never",
    });
    const joinedOrgId = joined.joined[0]?.orgId ?? null;
    if (joinedOrgId) {
      const refreshed = await loadMemberships(email);
      if (refreshed !== null) {
        memberships = refreshed;
        updateMembershipsForEvent(event, email, refreshed);
      }

      const currentOrgId =
        activeOrgSetting?.orgId ??
        sessionOrgId ??
        membershipsBeforeJoin[0]?.orgId ??
        null;
      const shouldActivate =
        !explicitPersonal &&
        (currentOrgId === null ||
          (await isSoloOwnedWorkspace(
            exec,
            currentOrgId,
            membershipsBeforeJoin,
          )));

      if (shouldActivate) {
        await setActiveOrgId(email, joinedOrgId, "joined domain-matched org");
        const active = memberships.find((m) => m.orgId === joinedOrgId);
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
  }

  if (explicitPersonal) {
    return { email, orgId: null, orgName: null, role: null };
  }

  if (activeOrgSetting?.orgId) {
    const active = memberships.find((m) => m.orgId === activeOrgSetting.orgId);
    if (active) {
      return {
        email,
        orgId: active.orgId,
        orgName: active.orgName,
        role: active.role,
      };
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

/**
 * Ordering for every membership lookup that falls back to "first membership".
 * Without it the fallback is whatever order the plan happens to return, so a
 * multi-org user's active org can change between two identical requests — and
 * `getSession` then freezes that arbitrary answer into `session.orgId`.
 * `org_id` breaks ties so two memberships joined in the same millisecond still
 * resolve identically.
 */
const MEMBERSHIP_FALLBACK_ORDER_BY = `ORDER BY joined_at ASC, org_id ASC`;

async function loadMemberships(email: string): Promise<MembershipRow[] | null> {
  return cachedMemberships(email, () => loadMembershipsUncached(email));
}

async function loadMembershipsUncached(
  email: string,
): Promise<MembershipRow[] | null> {
  const rows = await queryOrgMembers({
    sql: `SELECT m.org_id AS "orgId", m.role AS role, o.name AS "orgName",
                 o.allowed_domain AS "allowedDomain"
          FROM org_members m
          INNER JOIN organizations o ON m.org_id = o.id
          WHERE LOWER(m.email) = ?
          ${MEMBERSHIP_FALLBACK_ORDER_BY}`,
    args: [email.toLowerCase()],
  });
  return (
    rows?.map((r: any) => {
      const domain = r.allowedDomain ?? r.allowed_domain;
      return {
        orgId: String(r.orgId ?? r.org_id),
        role: String(r.role) as OrgRole,
        orgName: String(r.orgName ?? r.org_name),
        allowedDomain: domain ? String(domain) : null,
      };
    }) ?? null
  );
}

/**
 * Resolve the active org ID for a given email — for non-HTTP contexts like
 * the integration webhook handler where we have an email but no event/session.
 * Picks the user's active-org-id setting if set, including explicit Personal,
 * otherwise the oldest membership.
 * Returns null if the user has no memberships.
 */
export async function resolveOrgIdForEmail(
  email: string,
): Promise<string | null> {
  const idsPromise = requestMemberOrgIds(email, async () => {
    const rows = await queryOrgMembers({
      sql: `SELECT org_id FROM org_members WHERE LOWER(email) = ?
            ${MEMBERSHIP_FALLBACK_ORDER_BY}`,
      args: [email.toLowerCase()],
    });
    return rows?.map((r: any) => String(r.org_id)) ?? null;
  });
  // Both reads depend only on the email, so they overlap instead of queueing.
  // The `catch` only keeps the early return below from surfacing an unhandled
  // rejection; the `await` further down still propagates the failure.
  const settingPromise = getUserSetting(
    email,
    "active-org-id",
  ) as Promise<ActiveOrgSetting>;
  settingPromise.catch(() => {});

  const ids = await idsPromise;
  if (!ids?.length) return null;
  const activeOrgSetting = await settingPromise;
  if (activeOrgSetting?.orgId === null) return null;
  if (activeOrgSetting?.orgId && ids.includes(activeOrgSetting.orgId)) {
    return activeOrgSetting.orgId;
  }
  return ids[0];
}

/**
 * Event-aware variant of `resolveOrgIdForEmail` for HTTP request paths.
 * Shares the per-request membership lookup with `getOrgContext`, so the
 * session org backfill inside `getSession` and a later `getOrgContext` call
 * in the same request pay ONE org_members round trip, not two.
 */
export async function resolveOrgIdForEmailViaEvent(
  event: H3Event,
  email: string,
): Promise<string | null> {
  // Overlapped, not queued: each is a separate round trip and this pair runs
  // on the session-backfill path of every authenticated request.
  const settingPromise = loadActiveOrgSettingForEvent(event, email);
  settingPromise.catch(() => {});
  const memberships = await loadMembershipsForEvent(event, email);
  if (!memberships || memberships.length === 0) return null;
  const activeOrgSetting = await settingPromise;
  if (activeOrgSetting?.orgId === null) return null;
  if (
    activeOrgSetting?.orgId &&
    memberships.some((m) => m.orgId === activeOrgSetting.orgId)
  ) {
    return activeOrgSetting.orgId;
  }
  return memberships[0].orgId;
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
  invalidateMemberOrgCaches();

  await warnOnAdditionalOrganization(exec, email, id, trimmedName);

  await setActiveOrgId(email, id, `created organization "${trimmedName}"`);

  return { id, name: trimmedName, role, a2aSecret, createdAt };
}

/**
 * A second organization is the single most expensive accident in this codebase:
 * vault credentials are scoped per organization, so creating one and activating
 * it orphans every key synced under the previous org, and the only symptom is a
 * missing-env-var error somewhere else entirely. The UI warns humans before
 * they click (`org.createOrgVaultNotice`); this covers the path that actually
 * did the damage — app code or a migration action calling `createOrganization`
 * directly, where no notice is ever rendered.
 */
async function warnOnAdditionalOrganization(
  exec: ReturnType<typeof getDbExec>,
  email: string,
  newOrgId: string,
  newOrgName: string,
): Promise<void> {
  try {
    const { rows } = await exec.execute({
      sql: `SELECT 1 FROM org_members WHERE LOWER(email) = ? AND org_id <> ? LIMIT 1`,
      args: [email.toLowerCase(), newOrgId],
    });
    if (rows.length === 0) return;
  } catch {
    // "Couldn't tell" is not "it didn't" — swallowing the failed probe here made
    // the function whose entire job is to not be silent, silent.
    warnAgent({
      severity: "critical",
      code: "org-additional-org-membership-unreadable",
      message:
        `Created an organization "${newOrgName}" (${newOrgId}) and made it the account's active org, ` +
        `but could not read whether that account already belonged to another organization. If it did, ` +
        `every vault credential synced under the previous organization is now unreadable for it, and ` +
        `requests will fail with missing-credential errors that name the key rather than this org ` +
        `change. Confirm the account's memberships before continuing; if this came from a roster, ` +
        `identity, or user-list migration, add the members to the EXISTING organization instead.`,
    });
    return;
  }

  warnAgent({
    severity: "critical",
    code: "org-additional-organization",
    message:
      `Created an ADDITIONAL organization "${newOrgName}" (${newOrgId}) ` +
      `for an account that already belongs to another organization, and made it their active org. ` +
      `Vault credentials are scoped per organization and are NOT shared between them: every API key ` +
      `synced under the previous organization is now unreadable for this account until it is re-saved ` +
      `in "${newOrgName}". Requests will fail with missing-credential errors that name the key rather ` +
      `than this org change. If this came from a roster, identity, or user-list migration, add the ` +
      `members to the EXISTING organization instead of creating a new one.`,
  });
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
    invalidateMemberOrgCaches();

    await setActiveOrgId(email, orgId, "auto-created default organization");
    try {
      await appStatePut(
        email,
        FIRST_RUN_ONBOARDING_ELIGIBLE_KEY,
        { orgId, at: new Date(now).toISOString() },
        { requestSource: "org-auto-create" },
      );
    } catch (error) {
      // The safe failure mode is to omit first-run onboarding. The org itself
      // already exists, so do not turn a marker-write failure into a false
      // zero-membership result or retry that creates another org.
      warnAgent({
        severity: "warning",
        code: "first-run-onboarding-eligibility-unreadable",
        message:
          `Auto-created organization ${orgId} for ${email}, but could not persist ` +
          `the first-run onboarding eligibility marker: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

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
