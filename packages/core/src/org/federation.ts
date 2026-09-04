import type { H3Event } from "h3";

import { signA2AToken, canonicalA2AAudience } from "../a2a/index.js";
import { getDbExec } from "../db/client.js";
import { isFeatureFlagEnabled } from "../feature-flags/store.js";
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

function isOrgRole(value: unknown): value is OrgRole {
  return value === "owner" || value === "admin" || value === "member";
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

async function registerWithIdentityHub(
  event: H3Event,
  input: FederatedOrganizationIdentity,
): Promise<string | null> {
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
    },
  });

  const response = await fetch(`${hub}${FEDERATION_PATH}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
    },
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  });
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
  return hub;
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
    sql: `SELECT identity_authority, identity_id FROM organizations WHERE id = ? LIMIT 1`,
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

  await registerWithIdentityHub(event, { ...input, authority });

  if (!existingAuthority && !existingId) {
    await exec.execute({
      sql: `UPDATE organizations
            SET identity_authority = ?, identity_id = ?
            WHERE id = ? AND identity_authority IS NULL AND identity_id IS NULL`,
      args: [authority, input.id, input.id],
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
    sql: `UPDATE org_members SET role = ? WHERE org_id = ? AND LOWER(email) = ?`,
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
    sql: `SELECT org_id FROM org_members WHERE LOWER(email) = ?`,
    args: [normalizedEmail],
  });

  if (mapped.rows[0]) {
    const localOrgId = String((mapped.rows[0] as any).id);
    await ensureLocalMembership(localOrgId, identity);
    if (memberships.rows.length === 0) {
      await setActiveOrgId(
        identity.email,
        localOrgId,
        "signed cross-app organization context",
      );
    }
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
      return "linked";
    }
    return "unlinked";
  }

  if (memberships.rows.length > 0) return "unlinked";

  await createOrganization(identity.name, identity.email, identity.role, {
    id: identity.id,
    identityAuthority: identity.authority,
    identityId: identity.id,
  });
  return "created";
}
