import { createHash } from "node:crypto";

import type { H3Event } from "h3";

import { warnAgent } from "../agent/action-warnings.js";
import { getAppConfig } from "../app-config/index.js";
import { appStatePut } from "../application-state/store.js";
import { getDbExec, isTransientDatabaseError } from "../db/client.js";
import { getSession } from "../server/auth.js";
import { shouldWriteFirstRunOnboardingEligibility } from "../server/first-run-onboarding-build-mode.js";
import {
  getRequestContext,
  hasExplicitPersonalOrgScope,
} from "../server/request-context.js";
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
import { implicitServiceOrgRole } from "./service-identity.js";
import { isBootstrapAdmin } from "./signup-admission.js";
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

async function isSoloOwnedWorkspace(
  exec: ReturnType<typeof getDbExec>,
  orgId: string,
  memberships: MembershipRow[],
): Promise<boolean> {
  const membership = memberships.find((m) => m.orgId === orgId);
  if (!membership || membership.role !== "owner") return false;
  try {
    const { rows } = await exec.execute({
      sql: `SELECT COUNT(*) AS "memberCount" FROM org_members
            WHERE org_id = ? AND federation_removal_pending_at IS NULL`,
      args: [orgId],
    });
    const row = rows[0] as any;
    return Number(row?.memberCount ?? row?.membercount ?? 0) <= 1;
  } catch {
    return false;
  }
}

function autoCreateDefaultOrgEnabled(): boolean {
  const access = getAppConfig().access;
  return access.orgCreation === "open" && access.autoCreateDefaultOrg;
}

const nanoid = (): string =>
  globalThis.crypto?.randomUUID?.().replace(/-/g, "") ??
  Math.random().toString(36).slice(2) + Date.now().toString(36);

export async function getOrgContext(event: H3Event): Promise<OrgContext> {
  const ctx = event.context as {
    __anOrgContextCache?: Promise<OrgContext>;
  };
  return (ctx.__anOrgContextCache ??= resolveOrgContextUncached(event).catch(
    (err) => {
      delete ctx.__anOrgContextCache;
      throw err;
    },
  ));
}

export type OrgMembership = {
  orgId: string;
  role: OrgRole;
  orgName: string;
  allowedDomain: string | null;
  identityAuthority: string | null;
  identityId: string | null;
};

type MembershipRow = OrgMembership;

async function refreshFederatedMemberships(
  event: H3Event,
  email: string,
  memberships: MembershipRow[],
  selectedOrgId: string | null,
): Promise<MembershipRow[]> {
  const selected = selectedOrgId
    ? memberships.find((membership) => membership.orgId === selectedOrgId)
    : undefined;
  if (!selected || (!selected.identityAuthority && !selected.identityId)) {
    return memberships;
  }
  const { validateFederatedOrganizationMembership } =
    await import("./federation.js");
  const result = await validateFederatedOrganizationMembership(event, {
    orgId: selected.orgId,
    email,
  });
  if (!result.active) {
    return memberships.filter((item) => item.orgId !== selected.orgId);
  }
  if (result.role === selected.role) {
    return memberships;
  }
  return memberships.map((item) =>
    item.orgId === selected.orgId ? { ...item, role: result.role } : item,
  );
}

const MEMBERSHIPS_CACHE_KEY = "__anOrgMembershipsCache";
const ACTIVE_ORG_SETTING_CACHE_KEY = "__anActiveOrgSettingCache";
const FEDERATION_MEMBERSHIP_VALIDATED_KEY = "__anFederationMembershipValidated";

export function isFederationMembershipValidatedForEvent(
  event: H3Event,
  email: string | undefined,
  orgId: string | undefined,
): boolean {
  const marker = (event.context as Record<string, unknown>)[
    FEDERATION_MEMBERSHIP_VALIDATED_KEY
  ] as { email?: unknown; orgId?: unknown } | undefined;
  return (
    typeof email === "string" &&
    typeof orgId === "string" &&
    marker?.email === email.trim().toLowerCase() &&
    marker?.orgId === orgId
  );
}

function markFederationMembershipValidated(
  event: H3Event,
  email: string,
  orgId: string,
): void {
  (event.context as Record<string, unknown>)[
    FEDERATION_MEMBERSHIP_VALIDATED_KEY
  ] = { email: email.trim().toLowerCase(), orgId };
}

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
  if (hasExplicitPersonalOrgScope(event)) {
    return { email, orgId: null, orgName: null, role: null };
  }
  const sessionOrgId =
    typeof session.orgId === "string" && session.orgId.trim()
      ? session.orgId.trim()
      : null;
  const sessionOrgRole = normalizeOrgRole(session.orgRole);

  const requestContext = getRequestContext();
  const serviceRole = implicitServiceOrgRole({
    email,
    orgId: sessionOrgId,
    requestOrgId:
      requestContext?.orgScope === "personal"
        ? null
        : (requestContext?.orgId ?? sessionOrgId),
  });
  if (serviceRole && sessionOrgId) {
    return {
      email,
      orgId: sessionOrgId,
      orgName: null,
      role: serviceRole,
    };
  }

  const exec = getDbExec();

  const activeOrgSettingPromise = loadActiveOrgSettingForEvent(event, email);
  activeOrgSettingPromise.catch(() => {});

  let memberships: MembershipRow[] | null;
  try {
    memberships = await loadMembershipsForEvent(event, email);
  } catch (err) {
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
  const selectedMembership = explicitPersonal
    ? undefined
    : ((activeOrgSetting?.orgId
        ? memberships.find(
            (membership) => membership.orgId === activeOrgSetting.orgId,
          )
        : undefined) ??
      (sessionOrgId
        ? memberships.find((membership) => membership.orgId === sessionOrgId)
        : undefined) ??
      memberships[0]);
  const selectedOrgId = selectedMembership?.orgId ?? null;
  const selectedWasFederated = Boolean(
    selectedMembership?.identityAuthority || selectedMembership?.identityId,
  );
  const refreshedMemberships = await refreshFederatedMemberships(
    event,
    email,
    memberships,
    selectedOrgId,
  );
  if (refreshedMemberships !== memberships) {
    memberships = refreshedMemberships;
    updateMembershipsForEvent(event, email, memberships);
  }
  if (
    selectedWasFederated &&
    selectedOrgId &&
    !memberships.some((membership) => membership.orgId === selectedOrgId)
  ) {
    return { email, orgId: null, orgName: null, role: null };
  }
  if (selectedOrgId && memberships.some((m) => m.orgId === selectedOrgId)) {
    markFederationMembershipValidated(event, email, selectedOrgId);
  }

  const emailDomain = emailDomainOf(email);
  const shouldTryDomainAutoJoin =
    !explicitPersonal &&
    session.emailVerified === true &&
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
    const pending = await exec.execute({
      sql: `SELECT 1 FROM org_members
            WHERE org_id = ? AND LOWER(email) = ?
              AND federation_removal_pending_at IS NOT NULL
            LIMIT 1`,
      args: [sessionOrgId, email.toLowerCase()],
    });
    if (pending.rows.length > 0) {
      return { email, orgId: null, orgName: null, role: null };
    }
    return { email, orgId: null, orgName: null, role: null };
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

const MEMBERSHIP_FALLBACK_ORDER_BY = `ORDER BY joined_at ASC, org_id ASC`;

async function loadMemberships(email: string): Promise<MembershipRow[] | null> {
  return cachedMemberships(email, () => loadMembershipsUncached(email));
}

export async function listOrgMemberships(
  email: string,
): Promise<OrgMembership[] | null> {
  return loadMemberships(email);
}

export async function listOrgMembershipsForEvent(
  event: H3Event,
  email: string,
  selectedOrgId: string | null,
): Promise<OrgMembership[] | null> {
  const memberships = await loadMembershipsForEvent(event, email);
  if (memberships === null) return null;
  const refreshed = await refreshFederatedMemberships(
    event,
    email,
    memberships,
    selectedOrgId,
  );
  if (refreshed !== memberships) {
    updateMembershipsForEvent(event, email, refreshed);
  }
  return refreshed;
}

export async function getActiveOrgSettingForEvent(
  event: H3Event,
  email: string,
): Promise<{ orgId: string | null } | null> {
  return loadActiveOrgSettingForEvent(event, email);
}

async function loadMembershipsUncached(
  email: string,
): Promise<MembershipRow[] | null> {
  const rows = await queryOrgMembers({
    sql: `SELECT m.org_id AS "orgId", m.role AS role, o.name AS "orgName",
                 o.allowed_domain AS "allowedDomain",
                 o.identity_authority AS "identityAuthority",
                 o.identity_id AS "identityId"
          FROM org_members m
          INNER JOIN organizations o ON m.org_id = o.id
          WHERE LOWER(m.email) = ?
            AND m.federation_removal_pending_at IS NULL
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
        identityAuthority:
          String(r.identityAuthority ?? r.identity_authority ?? "").trim() ||
          null,
        identityId: String(r.identityId ?? r.identity_id ?? "").trim() || null,
      };
    }) ?? null
  );
}

export async function resolveOrgIdForEmail(
  email: string,
): Promise<string | null> {
  if (getRequestContext()?.orgScope === "personal") return null;
  const idsPromise = requestMemberOrgIds(email, async () => {
    const rows = await queryOrgMembers({
      sql: `SELECT org_id FROM org_members
            WHERE LOWER(email) = ?
              AND federation_removal_pending_at IS NULL
            ${MEMBERSHIP_FALLBACK_ORDER_BY}`,
      args: [email.toLowerCase()],
    });
    return rows?.map((r: any) => String(r.org_id)) ?? null;
  });
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

export async function resolveOrgIdForEmailViaEvent(
  event: H3Event,
  email: string,
): Promise<string | null> {
  if (getRequestContext()?.orgScope === "personal") return null;
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

export async function createOrganization(
  name: string,
  email: string,
  role: OrgRole = "owner",
  options: {
    id?: string;
    identityAuthority?: string;
    identityId?: string;
  } = {},
): Promise<{
  id: string;
  name: string;
  role: OrgRole;
  a2aSecret: string;
  createdAt: number;
}> {
  const trimmedName = name.trim();
  const exec = getDbExec();
  const id = options.id ?? nanoid();
  if (Boolean(options.identityAuthority) !== Boolean(options.identityId)) {
    throw new Error(
      "Organization identity authority and identity id must be provided together.",
    );
  }
  const createdAt = Date.now();
  const { randomBytes } = await import("node:crypto");
  const a2aSecret = randomBytes(32).toString("base64url");
  const identityColumns = options.identityAuthority
    ? ", identity_authority, identity_id"
    : "";
  const identityPlaceholders = options.identityAuthority ? ", ?, ?" : "";
  const identityArgs = options.identityAuthority
    ? [options.identityAuthority, options.identityId]
    : [];

  await exec.execute({
    sql: `INSERT INTO organizations (id, name, created_by, created_at, a2a_secret${identityColumns}) VALUES (?, ?, ?, ?, ?${identityPlaceholders})`,
    args: [id, trimmedName, email, createdAt, a2aSecret, ...identityArgs],
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

export async function bootstrapAdminOrganization(
  rawEmail: string,
): Promise<boolean> {
  const email = rawEmail.trim().toLowerCase();
  if (!email || !isBootstrapAdmin(email)) return false;

  const exec = getDbExec();
  const orgs = await exec.execute({
    sql: `SELECT id FROM organizations
          ORDER BY created_at ASC, id ASC
          LIMIT 2`,
    args: [],
  });
  if (orgs.rows.length > 1) {
    console.warn(
      "[org] bootstrap admin could not choose among multiple organizations",
    );
    return false;
  }

  if (orgs.rows.length === 0) {
    const config = getAppConfig();
    const name = config.app.name ?? config.app.id ?? "Agent-Native";
    const identity = config.app.workspaceId ?? config.app.id ?? name;
    const id = `bootstrap-${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
    try {
      await createOrganization(name, email, "owner", { id });
      return true;
    } catch (error) {
      const existing = await exec.execute({
        sql: `SELECT id FROM organizations WHERE id = ? LIMIT 1`,
        args: [id],
      });
      if (existing.rows.length === 0) throw error;
      orgs.rows.push(existing.rows[0]);
    }
  }

  const orgId = String((orgs.rows[0] as any).id);
  const now = Date.now();
  await exec.execute({
    sql: `INSERT INTO org_members (id, org_id, email, role, joined_at)
          VALUES (?, ?, ?, 'owner', ?)
          ON CONFLICT (org_id, LOWER(email)) DO UPDATE SET role = 'owner'`,
    args: [nanoid(), orgId, email, now],
  });
  invalidateMemberOrgCaches();
  await setActiveOrgId(email, orgId, "bootstrap admin organization access");
  return true;
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
      sql: `SELECT 1 FROM org_members
            WHERE LOWER(email) = ? AND org_id <> ?
              AND federation_removal_pending_at IS NULL
            LIMIT 1`,
      args: [email.toLowerCase(), newOrgId],
    });
    if (rows.length === 0) return;
  } catch {
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

const CLAIM_TTL_MS = 5 * 60 * 1000;

/**
 * Attempt to provision a default org + owner membership for a user with
 * zero memberships.
 *
 * Race protection: claims the user's auto-create slot via an atomic
 * INSERT into the framework `settings` table (PRIMARY KEY (key) — so
 * concurrent inserts for the same key throw a Postgres uniqueness violation.
 * Only the request that wins the claim
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
  await getSetting("__init").catch(() => null);

  const claimKey = `u:${email.toLowerCase()}:auto-create-claim`;

  if (!(await acquireClaim(exec, claimKey))) return null;

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
    if (shouldWriteFirstRunOnboardingEligibility()) {
      try {
        await appStatePut(
          email,
          FIRST_RUN_ONBOARDING_ELIGIBLE_KEY,
          { orgId, at: new Date(now).toISOString() },
          { requestSource: "org-auto-create" },
        );
      } catch (error) {
        warnAgent({
          severity: "advisory",
          code: "first-run-onboarding-eligibility-unreadable",
          message:
            `Auto-created organization ${orgId} for ${email}, but could not persist ` +
            `the first-run onboarding eligibility marker: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
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
  await exec
    .execute({ sql: `DELETE FROM settings WHERE key = ?`, args: [claimKey] })
    .catch(() => {});
}

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

/**
 * Whether the requested domain is the only organization in this deployment.
 * Legacy workspace-wide A2A credentials may use this to preserve access
 * without allowing one credential to select among multiple local tenants.
 */
export async function isSoleOrgDomain(domain: string): Promise<boolean> {
  try {
    const exec = getDbExec();
    const { rows } = await exec.execute({
      sql: `SELECT allowed_domain FROM organizations LIMIT 2`,
      args: [],
    });
    if (rows.length !== 1) return false;
    return (
      String((rows[0] as any).allowed_domain || "").toLowerCase() ===
      domain.trim().toLowerCase()
    );
  } catch {
    // coercion-ok: an unreadable org registry denies legacy global-secret compatibility.
    return false;
  }
}
