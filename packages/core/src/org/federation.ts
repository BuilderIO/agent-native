import { createHash } from "node:crypto";

import type { H3Event } from "h3";

import { signA2AToken, canonicalA2AAudience } from "../a2a/index.js";
import { getDbExec } from "../db/client.js";
import { isFeatureFlagEnabled } from "../feature-flags/store.js";
import { getOrigin } from "../server/google-oauth.js";
import {
  resolveIdentityHubUrl,
  resolveIdentitySsoAppId,
} from "../server/identity-sso.js";
import { setActiveOrgId } from "./active-org.js";
import { createOrganization } from "./context.js";
import {
  CROSS_APP_ORG_FEDERATION_FLAG,
  CROSS_APP_ORG_FEDERATION_SCOPE,
} from "./feature-flags.js";
import { invalidateMemberOrgCaches } from "./request-org-cache.js";
import type { OrgRole } from "./types.js";

const FEDERATION_PATH = "/_agent-native/identity/organization";
const ORG_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_ORG_NAME_LENGTH = 200;
const MAX_FEDERATION_ROSTER_MEMBERS = 10_000;
const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export interface FederatedOrganizationIdentity {
  authority: string;
  id: string;
  name: string;
  role: OrgRole;
  email: string;
}

export type FederatedOrganizationSyncInput = Omit<
  FederatedOrganizationIdentity,
  "authority"
>;

export type FederatedOrganizationProvisionResult =
  | "disabled"
  | "created"
  | "linked"
  | "unlinked";

type FederatedMemberRole = Exclude<OrgRole, "owner">;
type FederatedRosterMember = { email: string; role: OrgRole };
type FederatedMemberOperation =
  | "add-member"
  | "update-member-role"
  | "remove-member"
  | "check-member";

export type FederatedMembershipValidation =
  | { active: true; role: OrgRole }
  | { active: false; role: null };

function isOrgRole(value: unknown): value is OrgRole {
  return value === "owner" || value === "admin" || value === "member";
}

function isFederatedMemberRole(value: unknown): value is FederatedMemberRole {
  return value === "admin" || value === "member";
}

function normalizeAuthority(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (
      (url.protocol !== "https:" &&
        !(url.protocol === "http:" && LOCALHOST_HOSTS.has(url.hostname))) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return `${url.protocol}//${url.host}${url.pathname}`.replace(/\/+$/, "");
  } catch (error) {
    void error;
    return null;
  }
}

function validateOrganizationFields(
  input: FederatedOrganizationSyncInput,
): void {
  if (
    !ORG_ID_PATTERN.test(input.id) ||
    !input.name.trim() ||
    input.name.trim().length > MAX_ORG_NAME_LENGTH ||
    !isOrgRole(input.role) ||
    !input.email.includes("@")
  ) {
    throw new Error("Invalid federated organization identity.");
  }
}

function validateIdentity(input: FederatedOrganizationIdentity): void {
  validateOrganizationFields(input);
  if (!normalizeAuthority(input.authority)) {
    throw new Error("Invalid federated organization authority.");
  }
}

async function federationEnabled(
  email: string,
  orgId: string | null | undefined,
): Promise<boolean> {
  return isFeatureFlagEnabled(CROSS_APP_ORG_FEDERATION_FLAG, {
    userEmail: email,
    userKey: email,
    ...(orgId ? { orgId } : {}),
  }).catch((error) => {
    // coercion-ok: unreadable rollout state must leave federation disabled.
    void error;
    return false;
  });
}

async function sendFederationAssertion(
  event: H3Event,
  input: FederatedOrganizationIdentity,
  extraClaims: Record<string, unknown> = {},
  body?: unknown,
): Promise<{ hub: string; response: Response } | null> {
  const hub = resolveIdentityHubUrl(event);
  if (!hub) return null;

  const token = await signA2AToken(input.email, undefined, undefined, {
    preferGlobalSecret: true,
    audience: canonicalA2AAudience(hub),
    expiresIn: "2m",
    extraClaims: {
      app_id: resolveIdentitySsoAppId(event),
      scope: CROSS_APP_ORG_FEDERATION_SCOPE,
      org_id: input.id,
      org_name: input.name.trim(),
      org_role: input.role,
      ...extraClaims,
    },
  });

  const serializedBody = body === undefined ? undefined : JSON.stringify(body);

  return {
    hub,
    response: await fetch(`${hub}${FEDERATION_PATH}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(serializedBody ? { "content-type": "application/json" } : {}),
      },
      ...(serializedBody ? { body: serializedBody } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    }),
  };
}

async function sendFederatedMemberOperation(
  event: H3Event,
  input: {
    orgId: string;
    actorEmail: string;
    actorRole: OrgRole;
    memberEmail: string;
    memberRole?: FederatedMemberRole;
  },
  operation: FederatedMemberOperation,
): Promise<boolean> {
  if (!(await federationEnabled(input.actorEmail, input.orgId))) return false;
  const isSelfRemoval =
    operation === "remove-member" &&
    input.actorEmail.trim().toLowerCase() ===
      input.memberEmail.trim().toLowerCase();
  if (
    !isSelfRemoval &&
    input.actorRole !== "owner" &&
    input.actorRole !== "admin"
  ) {
    throw new Error("Only organization owners and admins can change members.");
  }
  const memberEmail = input.memberEmail.trim().toLowerCase();
  const actorEmail = input.actorEmail.trim().toLowerCase();
  if (!actorEmail.includes("@") || !memberEmail.includes("@")) {
    throw new Error("Invalid federated member email.");
  }
  if (
    operation !== "remove-member" &&
    operation !== "check-member" &&
    !isFederatedMemberRole(input.memberRole)
  ) {
    throw new Error("A federated member role is required.");
  }

  const exec = getDbExec();
  const local = await exec.execute({
    sql: `SELECT id, name, identity_authority, identity_id
          FROM organizations WHERE id = ? LIMIT 1`,
    args: [input.orgId],
  });
  const row = local.rows[0] as any;
  if (!row) return false;

  const existingAuthority = String(row.identity_authority ?? "").trim();
  const existingId = String(row.identity_id ?? "").trim();
  if (!existingAuthority && !existingId) return false;

  const hub = resolveIdentityHubUrl(event);
  const authority = normalizeAuthority(hub ?? "");
  if (
    !authority ||
    existingAuthority !== authority ||
    existingId !== input.orgId
  ) {
    throw new Error(
      "Organization is linked to an unavailable identity authority.",
    );
  }

  const sent = await sendFederationAssertion(
    event,
    {
      authority,
      id: input.orgId,
      name: String(row.name ?? ""),
      role: input.actorRole,
      email: actorEmail,
    },
    {
      federation_operation: operation,
      federation_member_email: memberEmail,
      ...(input.memberRole ? { federation_member_role: input.memberRole } : {}),
    },
  );
  if (!sent) throw new Error("Identity authority is not configured.");
  if (!sent.response.ok) {
    throw new Error(
      `Identity authority member operation failed (${sent.response.status}).`,
    );
  }
  return true;
}

async function registerWithIdentityHub(
  event: H3Event,
  input: FederatedOrganizationIdentity,
  roster?: readonly FederatedRosterMember[],
): Promise<{ hub: string; rosterInitialized: boolean } | null> {
  const rosterBody = roster ? { members: roster } : undefined;
  const sent = await sendFederationAssertion(
    event,
    input,
    roster
      ? {
          federation_roster_hash: createHash("sha256")
            .update(JSON.stringify(rosterBody))
            .digest("base64url"),
        }
      : {},
    rosterBody,
  );
  if (!sent) return null;
  const { hub, response } = sent;
  if (!response.ok) {
    throw new Error(
      `Identity hub organization federation failed (${response.status}).`,
    );
  }
  const body = (await response.json().catch((error) => {
    void error;
    return null;
  })) as Record<string, unknown> | null;
  if (
    body?.orgId !== input.id ||
    typeof body.name !== "string" ||
    !body.name.trim()
  ) {
    throw new Error("Identity hub returned an invalid federated organization.");
  }
  return { hub, rosterInitialized: body.rosterInitialized === true };
}

async function loadFederatedRoster(
  exec: ReturnType<typeof getDbExec>,
  orgId: string,
  ownerEmail: string,
): Promise<FederatedRosterMember[]> {
  const result = await exec.execute({
    sql: `SELECT email, role FROM org_members
          WHERE org_id = ? AND federation_removal_pending_at IS NULL
          ORDER BY LOWER(email) ASC`,
    args: [orgId],
  });
  if (
    result.rows.length === 0 ||
    result.rows.length > MAX_FEDERATION_ROSTER_MEMBERS
  ) {
    throw new Error("Invalid federated organization roster.");
  }

  const roster: FederatedRosterMember[] = [];
  const emails = new Set<string>();
  for (const row of result.rows as any[]) {
    const email = String(row.email ?? "")
      .trim()
      .toLowerCase();
    const role = row.role;
    if (!email.includes("@") || !isOrgRole(role) || emails.has(email)) {
      throw new Error("Invalid federated organization roster.");
    }
    emails.add(email);
    roster.push({ email, role });
  }

  roster.sort((left, right) =>
    left.email < right.email ? -1 : left.email > right.email ? 1 : 0,
  );
  const owner = roster.find((member) => member.role === "owner");
  if (!owner || owner.email !== ownerEmail.trim().toLowerCase()) {
    throw new Error("Federated organization roster must contain its owner.");
  }
  return roster;
}

/** Add an explicitly invited member to the identity authority roster. */
export async function addFederatedOrganizationMember(
  event: H3Event,
  input: {
    orgId: string;
    actorEmail: string;
    actorRole: OrgRole;
    memberEmail: string;
    memberRole: FederatedMemberRole;
  },
): Promise<boolean> {
  return sendFederatedMemberOperation(event, input, "add-member");
}

/** Propagate an owner/admin role change to the identity authority roster. */
export async function updateFederatedOrganizationMemberRole(
  event: H3Event,
  input: {
    orgId: string;
    actorEmail: string;
    actorRole: OrgRole;
    memberEmail: string;
    memberRole: FederatedMemberRole;
  },
): Promise<boolean> {
  return sendFederatedMemberOperation(event, input, "update-member-role");
}

/** Remove a member from the identity authority before removing its local row. */
export async function revokeFederatedOrganizationMember(
  event: H3Event,
  input: {
    orgId: string;
    actorEmail: string;
    actorRole: OrgRole;
    memberEmail: string;
  },
): Promise<boolean> {
  return sendFederatedMemberOperation(event, input, "remove-member");
}

/**
 * Revalidate a linked local membership against Dispatch before using it for
 * authorization. This is the satellite-side revocation boundary: local rows
 * are copied state, so a successful authority response can remove or retag
 * them while an unavailable authority fails closed.
 */
export async function validateFederatedOrganizationMembership(
  event: H3Event,
  input: { orgId: string; email: string },
): Promise<FederatedMembershipValidation> {
  const email = input.email.trim().toLowerCase();
  const exec = getDbExec();
  const organization = await exec.execute({
    sql: `SELECT name, identity_authority, identity_id
          FROM organizations WHERE id = ? LIMIT 1`,
    args: [input.orgId],
  });
  const org = organization.rows[0] as any;
  if (!org) return { active: false, role: null };

  const member = await exec.execute({
    sql: `SELECT role, federation_removal_pending_at FROM org_members
          WHERE org_id = ? AND LOWER(email) = ? LIMIT 1`,
    args: [input.orgId, email],
  });
  const localRole = (member.rows[0] as any)?.role;
  if (
    !member.rows[0] ||
    (member.rows[0] as any).federation_removal_pending_at ||
    !isOrgRole(localRole)
  ) {
    return { active: false, role: null };
  }

  const identityAuthority = String(org.identity_authority ?? "").trim();
  const identityId = String(org.identity_id ?? "").trim();
  if (!identityAuthority && !identityId) {
    return { active: true, role: localRole };
  }
  if (!identityAuthority || identityId !== input.orgId) {
    throw new Error("Organization has an invalid identity mapping.");
  }
  if (!(await federationEnabled(email, input.orgId))) {
    return { active: true, role: localRole };
  }

  const currentOrigin = normalizeAuthority(getOrigin(event));
  if (currentOrigin === identityAuthority) {
    return { active: true, role: localRole };
  }
  const hub = resolveIdentityHubUrl(event);
  const authority = normalizeAuthority(hub ?? "");
  if (!authority || authority !== identityAuthority) {
    throw new Error(
      "Organization is linked to an unavailable identity authority.",
    );
  }

  const sent = await sendFederationAssertion(
    event,
    {
      authority,
      id: input.orgId,
      name: String(org.name ?? ""),
      role: localRole,
      email,
    },
    {
      federation_operation: "check-member",
      federation_member_email: email,
    },
  );
  if (!sent) throw new Error("Identity authority is not configured.");
  if (!sent.response.ok) {
    throw new Error(
      `Identity authority membership check failed (${sent.response.status}).`,
    );
  }
  const body = (await sent.response.json().catch((error) => {
    void error;
    return null;
  })) as Record<string, unknown> | null;
  if (
    body?.orgId !== input.orgId ||
    String(body.memberEmail ?? "")
      .trim()
      .toLowerCase() !== email
  ) {
    throw new Error("Identity authority returned an invalid membership check.");
  }
  if (body.memberPresent === false) {
    await exec.execute({
      sql: `UPDATE org_members SET federation_removal_pending_at = ?
            WHERE org_id = ? AND LOWER(email) = ?
              AND federation_removal_pending_at IS NULL`,
      args: [Date.now(), input.orgId, email],
    });
    try {
      await exec.execute({
        sql: `DELETE FROM org_members WHERE org_id = ? AND LOWER(email) = ?`,
        args: [input.orgId, email],
      });
    } catch (error) {
      void error;
    }
    invalidateMemberOrgCaches();
    return { active: false, role: null };
  }
  if (body.memberPresent !== true || !isOrgRole(body.memberRole)) {
    throw new Error("Identity authority returned an invalid membership check.");
  }
  if (body.memberRole !== localRole) {
    await exec.execute({
      sql: `UPDATE org_members SET role = ?
            WHERE org_id = ? AND LOWER(email) = ?
              AND federation_removal_pending_at IS NULL`,
      args: [body.memberRole, input.orgId, email],
    });
    invalidateMemberOrgCaches();
  }
  return { active: true, role: body.memberRole };
}

/** Register the local org and its current member with the Dispatch authority. */
export async function syncOrganizationToIdentityHub(
  event: H3Event,
  input: FederatedOrganizationSyncInput,
): Promise<boolean> {
  if (!(await federationEnabled(input.email, input.id))) return false;
  validateOrganizationFields(input);

  const exec = getDbExec();
  const local = await exec.execute({
    sql: `SELECT identity_authority, identity_id,
                 federation_roster_initialized_at
          FROM organizations WHERE id = ? LIMIT 1`,
    args: [input.id],
  });
  const row = local.rows[0] as any;
  if (!row)
    throw new Error("Organization not found while enabling federation.");

  const existingAuthority = String(row.identity_authority ?? "").trim();
  const existingId = String(row.identity_id ?? "").trim();
  const authority = normalizeAuthority(resolveIdentityHubUrl(event) ?? "");
  if (!authority) return false;
  if (
    (existingAuthority || existingId) &&
    (existingAuthority !== authority || existingId !== input.id)
  ) {
    throw new Error(
      "Organization is already linked to another identity authority.",
    );
  }

  const roster =
    input.role === "owner" && !(row as any).federation_roster_initialized_at
      ? await loadFederatedRoster(exec, input.id, input.email)
      : undefined;

  const registered = await registerWithIdentityHub(
    event,
    {
      ...input,
      authority,
    },
    roster,
  );
  if (!registered) return false;

  if (!existingAuthority && !existingId) {
    await exec.execute({
      sql: `UPDATE organizations
            SET identity_authority = ?, identity_id = ?
            WHERE id = ? AND identity_authority IS NULL AND identity_id IS NULL`,
      args: [authority, input.id, input.id],
    });
  }
  if (roster && registered.rosterInitialized) {
    await exec.execute({
      sql: `UPDATE organizations
            SET federation_roster_initialized_at = ?
            WHERE id = ? AND federation_roster_initialized_at IS NULL`,
      args: [Date.now(), input.id],
    });
  }
  return true;
}

async function ensureLocalMembership(
  orgId: string,
  identity: FederatedOrganizationIdentity,
): Promise<void> {
  const exec = getDbExec();
  const now = Date.now();
  await exec.execute({
    sql: `INSERT INTO org_members (id, org_id, email, role, joined_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (org_id, LOWER(email)) DO NOTHING`,
    args: [
      globalThis.crypto.randomUUID(),
      orgId,
      identity.email,
      identity.role,
      now,
    ],
  });
  await exec.execute({
    sql: `UPDATE org_members
          SET role = ?, federation_removal_pending_at = NULL
          WHERE org_id = ? AND LOWER(email) = ?`,
    args: [identity.role, orgId, identity.email.toLowerCase()],
  });
  invalidateMemberOrgCaches();
}

/**
 * Link the signed Dispatch org into this app without guessing from a name or
 * email domain. Existing local orgs with no durable match are left untouched.
 */
export async function provisionFederatedOrganization(
  identity: FederatedOrganizationIdentity,
): Promise<FederatedOrganizationProvisionResult> {
  if (!(await federationEnabled(identity.email, identity.id)))
    return "disabled";
  validateIdentity(identity);

  const exec = getDbExec();
  const normalizedEmail = identity.email.toLowerCase();
  const mapped = await exec.execute({
    sql: `SELECT id FROM organizations
          WHERE identity_authority = ? AND identity_id = ? LIMIT 1`,
    args: [identity.authority, identity.id],
  });
  const memberships = await exec.execute({
    sql: `SELECT org_id FROM org_members
          WHERE LOWER(email) = ?
            AND federation_removal_pending_at IS NULL`,
    args: [normalizedEmail],
  });

  if (mapped.rows[0]) {
    const localOrgId = String((mapped.rows[0] as any).id);
    await ensureLocalMembership(localOrgId, identity);
    await setActiveOrgId(
      identity.email,
      localOrgId,
      "signed cross-app organization context",
    );
    return "linked";
  }

  const sameId = await exec.execute({
    sql: `SELECT id, identity_authority, identity_id FROM organizations WHERE id = ? LIMIT 1`,
    args: [identity.id],
  });
  if (sameId.rows[0]) {
    const row = sameId.rows[0] as any;
    const hasMapping =
      String(row.identity_authority ?? "").trim() ||
      String(row.identity_id ?? "").trim();
    const alreadyMember = memberships.rows.some(
      (membership: any) => String(membership.org_id) === identity.id,
    );
    if (!hasMapping && alreadyMember) {
      await exec.execute({
        sql: `UPDATE organizations
              SET identity_authority = ?, identity_id = ?
              WHERE id = ? AND identity_authority IS NULL AND identity_id IS NULL`,
        args: [identity.authority, identity.id, identity.id],
      });
      await ensureLocalMembership(identity.id, identity);
      await setActiveOrgId(
        identity.email,
        identity.id,
        "signed cross-app organization context",
      );
      return "linked";
    }
    return "unlinked";
  }

  if (memberships.rows.length > 0) return "unlinked";

  if (identity.role !== "owner") return "unlinked";

  await createOrganization(identity.name, identity.email, identity.role, {
    id: identity.id,
    identityAuthority: identity.authority,
    identityId: identity.id,
  });
  return "created";
}
