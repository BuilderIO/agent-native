/**
 * Dispatch identity authority routes.
 *
 * Browser flow:
 *   1. Client -> /authorize?response_type=code&code_challenge=...
 *   2. Dispatch authenticates the existing user and redirects with `code` and
 *      the caller's opaque `state`.
 *   3. Client server -> /token with code + state + PKCE verifier.
 *   4. Dispatch atomically consumes the code and returns a short-lived signed
 *      identity assertion server-to-server.
 *
 * The browser never receives a JWT, password, or reusable identity assertion.
 * The device-local Desktop setting controls whether the parent login surface
 * appears. The per-user Desktop flag still gates session fan-out; canonical
 * browser federation is controlled by the separate `browser.identity-sso`
 * flag, while self-hosted federation remains explicitly configured by the
 * client.
 */

import { createHash, randomBytes } from "node:crypto";

import { signA2AToken, verifyA2AToken } from "@agent-native/core/a2a";
import { getDbExec } from "@agent-native/core/db";
import {
  hasActiveFeatureFlagRollout,
  isFeatureFlagEnabled,
} from "@agent-native/core/feature-flags";
import {
  CROSS_APP_ORG_FEDERATION_FLAG,
  CROSS_APP_ORG_FEDERATION_SCOPE,
  getOrgContext,
  getOrgDomain,
  invalidateMemberOrgCaches,
} from "@agent-native/core/org";
import {
  getH3App,
  getSession,
  hasGoogleAuthIdentity,
} from "@agent-native/core/server";
import { signInJourney } from "@agent-native/core/shared";
import { defineEventHandler, getHeader, getMethod, readBody } from "h3";
import type { H3Event } from "h3";

import {
  BROWSER_IDENTITY_SSO_FLAG,
  DESKTOP_WORKSPACE_SSO_FLAG,
} from "../../shared/feature-flags.js";
import {
  IDENTITY_AUTHORIZATION_CODE_TTL_MS,
  IDENTITY_SCOPE,
  IDENTITY_SSO_TOKEN_PATH,
  IDENTITY_TOKEN_TTL,
  buildIdentityClaims,
  buildRedirectLocation,
  consumeIdentityAuthorizationCode,
  createIdentityAuthorizationCode,
  DEFAULT_ALLOWED_ORIGINS,
  isValidSsoState,
  normalizeIdentityAuthority,
  resolveIdentitySsoApp,
  getIdentitySsoAppRegistry,
} from "../lib/identity-sso.js";

const AVAILABILITY_PATH = "/_agent-native/identity/availability";
const AUTHORIZE_PATH = "/_agent-native/identity/authorize";
export const ORGANIZATION_FEDERATION_PATH =
  "/_agent-native/identity/organization";
const DESKTOP_SSO_USER_AGENT = /AgentNativeDesktop(?:SsoCanary)?\//i;

export function isDesktopWorkspaceSsoRequest(
  userAgent: string | undefined,
): boolean {
  return DESKTOP_SSO_USER_AGENT.test(userAgent ?? "");
}

function getRequestUrl(event: H3Event): string {
  return (event as any).node?.req?.url ?? (event as any).path ?? "/";
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "application/json",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function redirect(location: string): Response {
  return new Response("", {
    status: 302,
    headers: {
      Location: location,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function resolveAuthority(): string | null {
  return normalizeIdentityAuthority(
    process.env.APP_URL || process.env.BETTER_AUTH_URL,
  );
}

function bodyString(body: unknown, key: string): string | null {
  if (!body || typeof body !== "object") return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function resolveOrgDomain(
  orgId: string | undefined,
): Promise<string | undefined> {
  if (!orgId) return undefined;
  try {
    return (await getOrgDomain(orgId)) ?? undefined;
  } catch (error) {
    void error;
    return undefined;
  }
}

function bearerToken(event: H3Event): string | null {
  const authorization = getHeader(event, "authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
}

function validOrganizationRole(
  value: unknown,
): value is "owner" | "admin" | "member" {
  return value === "owner" || value === "admin" || value === "member";
}

type FederationOperation =
  | "add-member"
  | "update-member-role"
  | "remove-member";

function validFederationOperation(
  value: unknown,
): value is FederationOperation {
  return (
    value === "add-member" ||
    value === "update-member-role" ||
    value === "remove-member"
  );
}

function validFederatedMemberRole(value: unknown): value is "admin" | "member" {
  return value === "admin" || value === "member";
}

const FEDERATION_ROSTER_HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MAX_FEDERATION_ROSTER_MEMBERS = 10_000;
type FederationRosterMember = {
  email: string;
  role: "owner" | "admin" | "member";
};

function parseFederationRoster(
  body: unknown,
  expectedHash: string,
): FederationRosterMember[] | null {
  if (!body || typeof body !== "object") return null;
  const rawMembers = (body as Record<string, unknown>).members;
  if (
    !Array.isArray(rawMembers) ||
    rawMembers.length === 0 ||
    rawMembers.length > MAX_FEDERATION_ROSTER_MEMBERS
  ) {
    return null;
  }

  const emails = new Set<string>();
  const members: FederationRosterMember[] = [];
  for (const rawMember of rawMembers) {
    if (!rawMember || typeof rawMember !== "object") return null;
    const email = String((rawMember as any).email ?? "")
      .trim()
      .toLowerCase();
    const role = (rawMember as any).role;
    if (
      !email.includes("@") ||
      !validOrganizationRole(role) ||
      emails.has(email)
    ) {
      return null;
    }
    emails.add(email);
    members.push({ email, role });
  }

  members.sort((left, right) =>
    left.email < right.email ? -1 : left.email > right.email ? 1 : 0,
  );
  const canonicalBody = JSON.stringify({ members });
  const actualHash = createHash("sha256")
    .update(canonicalBody)
    .digest("base64url");
  if (actualHash !== expectedHash) return null;
  if (members.filter((member) => member.role === "owner").length !== 1) {
    return null;
  }
  return members;
}

async function executeFederationRosterSetup(
  exec: ReturnType<typeof getDbExec>,
  statements: Array<{ sql: string; args: unknown[] }>,
): Promise<boolean> {
  if (exec.transaction) {
    await exec.transaction(async (tx) => {
      for (const statement of statements) await tx.execute(statement);
    });
    return true;
  }
  if (exec.atomicBatch) {
    await exec.atomicBatch(statements);
    return true;
  }
  return false;
}

type FederationRosterSetupResult =
  | { ok: true }
  | { ok: false; status: 409 | 503; error: string };

async function initializeFederationRoster(
  exec: ReturnType<typeof getDbExec>,
  input: {
    orgId: string;
    authority: string;
    actorEmail: string;
    existingOrg: any;
    roster: FederationRosterMember[];
  },
): Promise<FederationRosterSetupResult> {
  const existingMembers = await exec.execute({
    sql: `SELECT email, role, federation_removal_pending_at
          FROM org_members WHERE org_id = ?`,
    args: [input.orgId],
  });
  const byEmail = new Map<string, { role: string; pending: boolean }>();
  for (const row of existingMembers.rows as any[]) {
    const email = String(row.email ?? "")
      .trim()
      .toLowerCase();
    if (email) {
      byEmail.set(email, {
        role: String(row.role ?? ""),
        pending: Boolean(row.federation_removal_pending_at),
      });
    }
  }

  const existingAuthority = String(
    input.existingOrg?.identity_authority ?? "",
  ).trim();
  const existingId = String(input.existingOrg?.identity_id ?? "").trim();
  if (existingAuthority && existingId) {
    const actor = byEmail.get(input.actorEmail);
    if (!actor || actor.pending || actor.role !== "owner") {
      return {
        ok: false,
        status: 409,
        error: "Only the central organization owner can bootstrap its roster",
      };
    }
  }

  for (const member of input.roster) {
    const existing = byEmail.get(member.email);
    if (!existing) continue;
    if (existing.pending) {
      return {
        ok: false,
        status: 409,
        error: "Organization membership is pending identity-authority cleanup",
      };
    }
    if (existing.role !== member.role) {
      return {
        ok: false,
        status: 409,
        error: "Organization membership role conflict",
      };
    }
  }

  const statements: Array<{ sql: string; args: unknown[] }> = [];
  if (!existingAuthority && !existingId) {
    statements.push({
      sql: `UPDATE organizations
            SET identity_authority = ?, identity_id = ?
            WHERE id = ? AND identity_authority IS NULL AND identity_id IS NULL`,
      args: [input.authority, input.orgId, input.orgId],
    });
  }
  for (const member of input.roster) {
    if (byEmail.has(member.email)) continue;
    statements.push({
      sql: `INSERT INTO org_members (id, org_id, email, role, joined_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [
        randomBytes(16).toString("base64url"),
        input.orgId,
        member.email,
        member.role,
        Date.now(),
      ],
    });
  }
  statements.push({
    sql: `UPDATE organizations
          SET federation_roster_initialized_at = ?
          WHERE id = ? AND federation_roster_initialized_at IS NULL`,
    args: [Date.now(), input.orgId],
  });

  try {
    if (!(await executeFederationRosterSetup(exec, statements))) {
      return {
        ok: false,
        status: 503,
        error: "Identity authority does not support atomic roster setup",
      };
    }
  } catch (error) {
    void error;
    return {
      ok: false,
      status: 503,
      error: "Could not initialize the federated organization roster",
    };
  }
  invalidateMemberOrgCaches();
  return { ok: true };
}

export async function canAttemptWorkspaceSso(): Promise<boolean> {
  return hasActiveFeatureFlagRollout(DESKTOP_WORKSPACE_SSO_FLAG.key).catch(
    () => false,
  );
}

export async function isWorkspaceSsoEnabledForSession(
  session: Awaited<ReturnType<typeof getSession>>,
): Promise<boolean> {
  if (!session?.email) return false;
  return isFeatureFlagEnabled(DESKTOP_WORKSPACE_SSO_FLAG, {
    userEmail: session.email,
    userKey: session.email,
    orgId: session.orgId,
  }).catch(() => false);
}

export async function canAttemptBrowserIdentitySso(): Promise<boolean> {
  return hasActiveFeatureFlagRollout(BROWSER_IDENTITY_SSO_FLAG.key).catch(
    // coercion-ok: unreadable rollout state must fail closed for silent sign-in.
    () => false,
  );
}

export async function isBrowserIdentitySsoEnabledForSession(
  session: Awaited<ReturnType<typeof getSession>>,
): Promise<boolean> {
  if (!session?.email) return false;
  return isFeatureFlagEnabled(BROWSER_IDENTITY_SSO_FLAG, {
    userEmail: session.email,
    userKey: session.email,
    orgId: session.orgId,
  }).catch(() => false); // coercion-ok: unreadable rollout state must fail closed.
}

/**
 * Accept a signed org assertion from a registered first-party app. The org
 * fields are read from the verified JWT, never from a mutable request body.
 */
export const organizationFederationHandler = defineEventHandler(
  async (event: H3Event): Promise<Response> => {
    if (getMethod(event) !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }
    const token = bearerToken(event);
    if (!token) return jsonResponse({ error: "Unauthorized" }, 401);

    const verified = await verifyA2AToken(token, event, {
      routePrefix: "_agent-native",
      includeClaims: true,
      globalSecretOnly: true,
    });
    const claims = verified.claims;
    const issuer =
      typeof claims?.iss === "string"
        ? normalizeIdentityAuthority(claims.iss)
        : null;
    const appId = typeof claims?.app_id === "string" ? claims.app_id : null;
    const registration =
      appId && issuer
        ? getIdentitySsoAppRegistry().find(
            (candidate) =>
              candidate.appId === appId && candidate.origin === issuer,
          )
        : null;
    if (
      !verified.email ||
      !claims ||
      claims.scope !== CROSS_APP_ORG_FEDERATION_SCOPE ||
      !registration
    ) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const orgId = verified.orgId?.trim() ?? "";
    const orgName =
      typeof claims.org_name === "string" ? claims.org_name.trim() : "";
    const orgRole = claims.org_role;
    const rawFederationOperation = claims.federation_operation;
    if (
      rawFederationOperation !== undefined &&
      !validFederationOperation(rawFederationOperation)
    ) {
      return jsonResponse({ error: "Invalid federation operation" }, 400);
    }
    const federationOperation = rawFederationOperation as
      | FederationOperation
      | undefined;
    const federationMemberEmail =
      typeof claims.federation_member_email === "string"
        ? claims.federation_member_email.trim().toLowerCase()
        : "";
    const federationMemberRole = claims.federation_member_role;
    const rawFederationRosterHash = claims.federation_roster_hash;
    if (
      rawFederationRosterHash !== undefined &&
      (typeof rawFederationRosterHash !== "string" ||
        !FEDERATION_ROSTER_HASH_PATTERN.test(rawFederationRosterHash))
    ) {
      return jsonResponse(
        { error: "Invalid federated organization roster" },
        400,
      );
    }
    const federationRosterHash =
      typeof rawFederationRosterHash === "string"
        ? rawFederationRosterHash
        : undefined;
    if (
      federationOperation === undefined &&
      (claims.federation_member_email !== undefined ||
        federationMemberRole !== undefined)
    ) {
      return jsonResponse({ error: "Invalid federation operation" }, 400);
    }
    if (
      federationOperation !== undefined &&
      !federationMemberEmail.includes("@")
    ) {
      return jsonResponse({ error: "Invalid federated member email" }, 400);
    }
    if (
      federationOperation !== "remove-member" &&
      federationOperation !== undefined &&
      !validFederatedMemberRole(federationMemberRole)
    ) {
      return jsonResponse({ error: "Invalid federated member role" }, 400);
    }
    if (
      federationOperation === "remove-member" &&
      federationMemberRole !== undefined
    ) {
      return jsonResponse({ error: "Invalid federated member role" }, 400);
    }
    if (federationRosterHash && federationOperation !== undefined) {
      return jsonResponse(
        { error: "Invalid federated organization roster" },
        400,
      );
    }
    if (
      !/^[A-Za-z0-9_-]{1,128}$/.test(orgId) ||
      !orgName ||
      orgName.length > 200 ||
      !validOrganizationRole(orgRole)
    ) {
      return jsonResponse({ error: "Invalid organization assertion" }, 400);
    }

    let federationRoster: FederationRosterMember[] | undefined;
    if (federationRosterHash) {
      const body = await readBody(event).catch((error) => {
        void error;
        return null;
      });
      federationRoster =
        parseFederationRoster(body, federationRosterHash) ?? undefined;
      if (!federationRoster) {
        return jsonResponse(
          { error: "Invalid federated organization roster" },
          400,
        );
      }
      const owner = federationRoster.find((member) => member.role === "owner");
      if (
        orgRole !== "owner" ||
        owner?.email !== verified.email.trim().toLowerCase()
      ) {
        return jsonResponse(
          { error: "Only the organization owner can bootstrap its roster" },
          403,
        );
      }
    }

    const enabled = await isFeatureFlagEnabled(CROSS_APP_ORG_FEDERATION_FLAG, {
      userEmail: verified.email,
      userKey: verified.email,
      orgId,
    }).catch((error) => {
      // coercion-ok: unreadable rollout state must fail closed.
      void error;
      return false;
    });
    if (!enabled) return jsonResponse({ error: "Not found" }, 404);

    const email = verified.email.trim().toLowerCase();
    const authority = resolveAuthority();
    if (!authority) return jsonResponse({ error: "identity_unavailable" }, 503);
    const exec = getDbExec();
    const existing = await exec.execute({
      sql: `SELECT id, name, identity_authority, identity_id,
                   federation_roster_initialized_at
            FROM organizations WHERE id = ? LIMIT 1`,
      args: [orgId],
    });
    const existingOrg = existing.rows[0] as any;
    const existingAuthority = String(
      existingOrg?.identity_authority ?? "",
    ).trim();
    const existingId = String(existingOrg?.identity_id ?? "").trim();
    if (
      existingOrg &&
      (existingAuthority || existingId) &&
      (existingAuthority !== authority || existingId !== orgId)
    ) {
      return jsonResponse({ error: "Organization identity conflict" }, 409);
    }
    if (
      existingOrg &&
      federationOperation !== undefined &&
      !existingAuthority &&
      !existingId
    ) {
      return jsonResponse(
        { error: "Organization identity is not linked" },
        409,
      );
    }
    if (!existingOrg) {
      if (federationOperation === "remove-member") {
        return jsonResponse(
          {
            orgId,
            name: orgName,
            role: orgRole,
            removedMember: federationMemberEmail,
          },
          200,
        );
      }
      if (federationOperation !== undefined) {
        return jsonResponse({ error: "Organization not found" }, 404);
      }
      if (orgRole !== "owner") {
        return jsonResponse(
          {
            error: "Only an organization owner can register a new organization",
          },
          403,
        );
      }
      const now = Date.now();
      if (federationRoster) {
        const statements: Array<{ sql: string; args: unknown[] }> = [
          {
            sql: `INSERT INTO organizations
                  (id, name, created_by, created_at, a2a_secret,
                   identity_authority, identity_id,
                   federation_roster_initialized_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
              orgId,
              orgName,
              email,
              now,
              randomBytes(32).toString("base64url"),
              authority,
              orgId,
              now,
            ],
          },
          ...federationRoster.map((member) => ({
            sql: `INSERT INTO org_members (id, org_id, email, role, joined_at)
                  VALUES (?, ?, ?, ?, ?)`,
            args: [
              randomBytes(16).toString("base64url"),
              orgId,
              member.email,
              member.role,
              now,
            ],
          })),
        ];
        let rosterSetupSucceeded = false;
        try {
          rosterSetupSucceeded = await executeFederationRosterSetup(
            exec,
            statements,
          );
        } catch (error) {
          void error;
        }
        if (!rosterSetupSucceeded) {
          return jsonResponse(
            {
              error: "Could not initialize the federated organization roster",
            },
            503,
          );
        }
        invalidateMemberOrgCaches();
      } else {
        await exec.execute({
          sql: `INSERT INTO organizations
                (id, name, created_by, created_at, a2a_secret,
                 identity_authority, identity_id)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
          args: [
            orgId,
            orgName,
            email,
            now,
            randomBytes(32).toString("base64url"),
            authority,
            orgId,
          ],
        });
      }
      if (federationRoster) {
        return jsonResponse(
          {
            orgId,
            name: orgName,
            role: orgRole,
            rosterInitialized: true,
          },
          200,
        );
      }
    } else if (!existingAuthority && !existingId && !federationRoster) {
      await exec.execute({
        sql: `UPDATE organizations
              SET identity_authority = ?, identity_id = ?
              WHERE id = ? AND identity_authority IS NULL AND identity_id IS NULL`,
        args: [authority, orgId, orgId],
      });
    }

    const organizationName = String(existingOrg?.name ?? orgName);
    if (federationRoster && !existingOrg?.federation_roster_initialized_at) {
      const setup = await initializeFederationRoster(exec, {
        orgId,
        authority,
        actorEmail: email,
        existingOrg,
        roster: federationRoster,
      });
      if (!setup.ok) return jsonResponse({ error: setup.error }, setup.status);
      return jsonResponse(
        {
          orgId,
          name: organizationName,
          role: orgRole,
          rosterInitialized: true,
        },
        200,
      );
    }
    if (federationRoster && existingOrg?.federation_roster_initialized_at) {
      return jsonResponse(
        {
          orgId,
          name: organizationName,
          role: orgRole,
          rosterInitialized: true,
        },
        200,
      );
    }
    if (federationOperation !== undefined) {
      if (!existingOrg) {
        return jsonResponse({ error: "Organization not found" }, 404);
      }
      if (!existingAuthority && !existingId) {
        return jsonResponse(
          { error: "Organization identity is not linked" },
          409,
        );
      }

      const member = await exec.execute({
        sql: `SELECT role, federation_removal_pending_at FROM org_members
              WHERE org_id = ? AND LOWER(email) = ? LIMIT 1`,
        args: [orgId, federationMemberEmail],
      });
      const currentMemberRole = String((member.rows[0] as any)?.role ?? "");
      const memberRemovalPending = Boolean(
        (member.rows[0] as any)?.federation_removal_pending_at,
      );
      let actorRole = "";
      const isSelfRemoval =
        federationOperation === "remove-member" &&
        federationMemberEmail === email;
      if (isSelfRemoval) {
        if (!member.rows[0]) {
          return jsonResponse(
            {
              orgId,
              name: organizationName,
              role: orgRole,
              removedMember: federationMemberEmail,
            },
            200,
          );
        }
        if (
          !validOrganizationRole(currentMemberRole) ||
          currentMemberRole === "owner"
        ) {
          return jsonResponse({ error: "Unauthorized" }, 403);
        }
        actorRole = currentMemberRole;
      } else {
        const actor = await exec.execute({
          sql: `SELECT role FROM org_members
                WHERE org_id = ? AND LOWER(email) = ?
                  AND federation_removal_pending_at IS NULL
                LIMIT 1`,
          args: [orgId, email],
        });
        actorRole = String((actor.rows[0] as any)?.role ?? "");
        if (
          (actorRole !== "owner" && actorRole !== "admin") ||
          actorRole !== orgRole
        ) {
          return jsonResponse({ error: "Unauthorized" }, 403);
        }
      }

      if (federationOperation === "add-member") {
        const memberRole = federationMemberRole as "admin" | "member";
        if (currentMemberRole === "owner") {
          return jsonResponse(
            { error: "Cannot add or change the organization owner" },
            403,
          );
        }
        if (actorRole === "admin" && memberRole === "admin") {
          return jsonResponse(
            { error: "Only the organization owner can manage admins" },
            403,
          );
        }
        if (memberRemovalPending) {
          await exec.execute({
            sql: `UPDATE org_members
                  SET role = ?, federation_removal_pending_at = NULL
                  WHERE org_id = ? AND LOWER(email) = ?`,
            args: [memberRole, orgId, federationMemberEmail],
          });
          invalidateMemberOrgCaches();
          return jsonResponse(
            {
              orgId,
              name: organizationName,
              role: memberRole,
              memberEmail: federationMemberEmail,
            },
            200,
          );
        }
        if (!member.rows[0]) {
          await exec.execute({
            sql: `INSERT INTO org_members (id, org_id, email, role, joined_at)
                  VALUES (?, ?, ?, ?, ?)`,
            args: [
              randomBytes(16).toString("base64url"),
              orgId,
              federationMemberEmail,
              memberRole,
              Date.now(),
            ],
          });
          invalidateMemberOrgCaches();
          return jsonResponse(
            {
              orgId,
              name: organizationName,
              role: memberRole,
              memberEmail: federationMemberEmail,
            },
            200,
          );
        }
        if (!validOrganizationRole(currentMemberRole)) {
          return jsonResponse(
            { error: "Invalid organization membership" },
            409,
          );
        }
        if (currentMemberRole !== memberRole) {
          return jsonResponse(
            { error: "Organization membership role conflict" },
            409,
          );
        }
        return jsonResponse(
          {
            orgId,
            name: organizationName,
            role: currentMemberRole,
            memberEmail: federationMemberEmail,
          },
          200,
        );
      }

      if (federationOperation === "update-member-role") {
        const memberRole = federationMemberRole as "admin" | "member";
        if (!member.rows[0] || memberRemovalPending) {
          return jsonResponse({ error: "Member not found" }, 404);
        }
        if (currentMemberRole === "owner") {
          return jsonResponse(
            { error: "Cannot change the organization owner's role" },
            403,
          );
        }
        if (
          actorRole === "admin" &&
          (currentMemberRole === "admin" || memberRole === "admin")
        ) {
          return jsonResponse(
            { error: "Only the organization owner can manage admins" },
            403,
          );
        }
        await exec.execute({
          sql: `UPDATE org_members SET role = ?
                WHERE org_id = ? AND LOWER(email) = ?`,
          args: [memberRole, orgId, federationMemberEmail],
        });
        invalidateMemberOrgCaches();
        return jsonResponse(
          {
            orgId,
            name: organizationName,
            role: memberRole,
            memberEmail: federationMemberEmail,
          },
          200,
        );
      }

      if (currentMemberRole === "owner") {
        return jsonResponse(
          { error: "Cannot remove the organization owner" },
          403,
        );
      }
      if (actorRole === "owner" && federationMemberEmail === email) {
        return jsonResponse(
          { error: "Organization owner cannot remove themselves" },
          403,
        );
      }
      await exec.execute({
        sql: `UPDATE org_members SET federation_removal_pending_at = ?
              WHERE org_id = ? AND LOWER(email) = ?
                AND federation_removal_pending_at IS NULL`,
        args: [Date.now(), orgId, federationMemberEmail],
      });
      await exec.execute({
        sql: `DELETE FROM org_members WHERE org_id = ? AND LOWER(email) = ?`,
        args: [orgId, federationMemberEmail],
      });
      invalidateMemberOrgCaches();
      return jsonResponse(
        {
          orgId,
          name: organizationName,
          role: orgRole,
          removedMember: federationMemberEmail,
        },
        200,
      );
    }

    const member = await exec.execute({
      sql: `SELECT role, federation_removal_pending_at FROM org_members
            WHERE org_id = ? AND LOWER(email) = ? LIMIT 1`,
      args: [orgId, email],
    });
    if ((member.rows[0] as any)?.federation_removal_pending_at) {
      return jsonResponse(
        {
          error: "Membership is pending removal by the identity authority",
        },
        403,
      );
    }
    if (!member.rows[0]) {
      if (orgRole !== "owner") {
        return jsonResponse(
          {
            error: "Membership must be added by an organization owner or admin",
          },
          403,
        );
      }
      await exec.execute({
        sql: `INSERT INTO org_members (id, org_id, email, role, joined_at)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT (org_id, LOWER(email)) DO NOTHING`,
        args: [
          randomBytes(16).toString("base64url"),
          orgId,
          email,
          orgRole,
          Date.now(),
        ],
      });
      invalidateMemberOrgCaches();
    }

    return jsonResponse(
      {
        orgId,
        name: organizationName,
        role: String((member.rows[0] as any)?.role ?? orgRole),
      },
      200,
    );
  },
);

export const availabilityHandler = defineEventHandler(
  async (event: H3Event): Promise<Response> => {
    const method = getMethod(event);
    if (method !== "GET" && method !== "HEAD") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }
    const session = await getSession(event).catch(() => null);
    const isDesktopRequest = isDesktopWorkspaceSsoRequest(
      getHeader(event, "user-agent"),
    );
    // Anonymous availability is only a Canary hint used by an explicit
    // Desktop settings action. Ordinary browser requests never get a positive
    // answer here, so this endpoint cannot become an anonymous auto-login.
    const available = session?.email
      ? await isWorkspaceSsoEnabledForSession(session)
      : isDesktopRequest
        ? await canAttemptWorkspaceSso()
        : false;
    return jsonResponse({ available }, 200);
  },
);

export const authorizeHandler = defineEventHandler(
  async (event: H3Event): Promise<Response> => {
    const method = getMethod(event);
    if (method !== "GET" && method !== "HEAD") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const rawUrl = getRequestUrl(event);
    let search: URLSearchParams;
    try {
      search = new URL(rawUrl, "http://an.invalid").searchParams;
    } catch (error) {
      void error;
      search = new URLSearchParams();
    }

    const redirectUri = search.get("redirect_uri");
    const appId = search.get("app");
    const clientId = search.get("client_id");
    const state = search.get("state");
    const responseType = search.get("response_type");
    const codeChallenge = search.get("code_challenge");
    const codeChallengeMethod = search.get("code_challenge_method");
    const prompt = search.get("prompt");
    const isDesktopRequest = isDesktopWorkspaceSsoRequest(
      getHeader(event, "user-agent"),
    );

    // Validate every browser-controlled protocol parameter before resolving a
    // Dispatch session or constructing a continuation URL.
    const registration = resolveIdentitySsoApp(appId, clientId, redirectUri);
    const isCanonicalBrowserClient =
      !isDesktopRequest &&
      DEFAULT_ALLOWED_ORIGINS.includes(registration?.origin ?? "");
    if (
      !registration ||
      responseType !== "code" ||
      !isValidSsoState(state) ||
      !isValidSsoState(codeChallenge) ||
      codeChallengeMethod !== "S256" ||
      (prompt !== null && prompt !== "none") ||
      (prompt === "none" && !isCanonicalBrowserClient)
    ) {
      return jsonResponse(
        {
          error: "invalid_authorization_request",
          error_description:
            "The app, client, callback, state, or PKCE binding is not registered.",
        },
        400,
      );
    }
    const isSilentBrowserRequest = prompt === "none";
    const safeRedirectUri = redirectUri as string;
    const safeAppId = appId as string;
    const safeClientId = clientId as string;
    const safeState = state as string;
    const safeCodeChallenge = codeChallenge as string;
    const authority = resolveAuthority();
    if (!authority) {
      return jsonResponse(
        {
          error: "identity_unavailable",
          error_description: "Dispatch identity authority is not configured.",
        },
        503,
      );
    }

    const buildErrorLocation = (
      error: "feature_disabled" | "login_required",
    ) => {
      const location = new URL(safeRedirectUri);
      location.searchParams.set("error", error);
      location.searchParams.set("state", safeState);
      return location.toString();
    };

    if (isSilentBrowserRequest && !(await canAttemptBrowserIdentitySso())) {
      return redirect(buildErrorLocation("feature_disabled"));
    }

    if (isDesktopRequest && !(await canAttemptWorkspaceSso())) {
      return jsonResponse({ error: "not_found" }, 404);
    }

    const session = await getSession(event).catch(() => null);
    if (!session?.email) {
      if (isSilentBrowserRequest) {
        return redirect(buildErrorLocation("login_required"));
      }
      const queryStart = rawUrl.indexOf("?");
      const authorizePathWithQuery =
        AUTHORIZE_PATH + (queryStart >= 0 ? rawUrl.slice(queryStart) : "");
      const { signInHref } = signInJourney({ at: authorizePathWithQuery });
      if (!signInHref) {
        return jsonResponse(
          {
            error: "invalid_authorize_target",
            error_description:
              "The authorize URL is not a valid sign-in continuation.",
          },
          400,
        );
      }
      return redirect(signInHref);
    }

    if (
      isSilentBrowserRequest &&
      !(await isBrowserIdentitySsoEnabledForSession(session))
    ) {
      return redirect(buildErrorLocation("feature_disabled"));
    }

    if (isDesktopRequest && !(await isWorkspaceSsoEnabledForSession(session))) {
      return jsonResponse({ error: "not_found" }, 404);
    }
    if (!process.env.A2A_SECRET) {
      return jsonResponse(
        {
          error: "identity_unavailable",
          error_description: "Dispatch identity signing is not configured.",
        },
        503,
      );
    }

    const hasFederationRollout = await hasActiveFeatureFlagRollout(
      CROSS_APP_ORG_FEDERATION_FLAG.key,
    ).catch((error) => {
      // coercion-ok: unreadable rollout state must not add org claims.
      void error;
      return false;
    });
    const localOrg = hasFederationRollout
      ? await getOrgContext(event).catch((error) => {
          // coercion-ok: malformed or unreadable local org state omits org
          // claims rather than turning identity SSO into an org grant.
          void error;
          return null;
        })
      : null;
    const federationEnabled = hasFederationRollout
      ? await isFeatureFlagEnabled(CROSS_APP_ORG_FEDERATION_FLAG, {
          userEmail: session.email,
          userKey: session.email,
          ...((localOrg?.orgId ?? session.orgId)
            ? { orgId: localOrg?.orgId ?? session.orgId }
            : {}),
        }).catch((error) => {
          // coercion-ok: unreadable rollout state must not add org claims.
          void error;
          return false;
        })
      : false;
    const federatedOrg = federationEnabled && localOrg?.orgId ? localOrg : null;

    let code: string;
    try {
      code = await createIdentityAuthorizationCode({
        state: safeState,
        appId: safeAppId,
        clientId: safeClientId,
        redirectUri: safeRedirectUri,
        authority,
        codeChallenge: safeCodeChallenge,
        email: session.email,
        name: session.name,
        orgDomain: await resolveOrgDomain(federatedOrg?.orgId ?? session.orgId),
        ...(federatedOrg?.orgId
          ? {
              orgId: federatedOrg.orgId,
              orgName: federatedOrg.orgName,
              orgRole: federatedOrg.role,
            }
          : {}),
      });
    } catch (error) {
      void error;
      return jsonResponse(
        {
          error: "identity_unavailable",
          error_description: "Could not create a one-time sign-in code.",
        },
        503,
      );
    }

    return redirect(buildRedirectLocation(safeRedirectUri, code, safeState));
  },
);

export const tokenHandler = defineEventHandler(
  async (event: H3Event): Promise<Response> => {
    if (getMethod(event) !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }
    const body = await readBody(event).catch((error) => {
      // coercion-ok: unreadable request bodies are rejected as invalid requests below.
      void error;
      return null;
    });
    const grantType = bodyString(body, "grant_type");
    const code = bodyString(body, "code");
    const state = bodyString(body, "state");
    const appId = bodyString(body, "app_id");
    const clientId = bodyString(body, "client_id");
    const redirectUri = bodyString(body, "redirect_uri");
    const codeVerifier = bodyString(body, "code_verifier");
    if (
      grantType !== "authorization_code" ||
      !code ||
      !state ||
      !appId ||
      !clientId ||
      !redirectUri ||
      !codeVerifier
    ) {
      return jsonResponse({ error: "invalid_token_request" }, 400);
    }

    const registration = resolveIdentitySsoApp(appId, clientId, redirectUri);
    if (!registration) {
      return jsonResponse({ error: "invalid_token_request" }, 400);
    }
    const authority = resolveAuthority();
    if (!authority || !process.env.A2A_SECRET) {
      return jsonResponse({ error: "identity_unavailable" }, 503);
    }

    const identity = await consumeIdentityAuthorizationCode({
      code,
      state,
      appId,
      clientId,
      redirectUri,
      authority,
      codeVerifier,
    }).catch((error) => {
      // coercion-ok: an unreadable authorization code is handled as invalid_grant below.
      void error;
      return null;
    });
    if (!identity) return jsonResponse({ error: "invalid_grant" }, 400);

    const claims = buildIdentityClaims({
      email: identity.email,
      name: identity.name,
      orgDomain: identity.orgDomain,
      orgId: identity.orgId,
      orgName: identity.orgName,
      orgRole: identity.orgRole,
    });
    const identityAuthProvider = (await hasGoogleAuthIdentity(identity.email))
      ? "google"
      : undefined;
    let assertion: string;
    try {
      assertion = await signA2AToken(
        identity.email,
        identity.orgDomain,
        undefined,
        {
          preferGlobalSecret: true,
          expiresIn: IDENTITY_TOKEN_TTL,
          audience: redirectUri,
          extraClaims: {
            email: claims.email,
            ...(claims.name ? { name: claims.name } : {}),
            ...(claims.org_id ? { org_id: claims.org_id } : {}),
            ...(claims.org_name ? { org_name: claims.org_name } : {}),
            ...(claims.org_role ? { org_role: claims.org_role } : {}),
            ...(identityAuthProvider
              ? { identity_auth_provider: identityAuthProvider }
              : {}),
            scope: IDENTITY_SCOPE,
            jti: identity.jti,
            redirect_uri: redirectUri,
            identity_client_id: clientId,
            identity_authority: authority,
          },
        },
      );
    } catch (error) {
      void error;
      return jsonResponse({ error: "sign_failed" }, 500);
    }

    // This response is server-to-server. It is never redirected through the
    // browser and is intentionally not rendered or logged.
    return jsonResponse(
      {
        assertion,
        token_type: "identity-assertion",
        expires_in: Math.floor(IDENTITY_AUTHORIZATION_CODE_TTL_MS / 1_000),
      },
      200,
    );
  },
);

/** Mount the authority and token endpoints. */
export default async (nitroApp: any) => {
  getH3App(nitroApp).use(AVAILABILITY_PATH, availabilityHandler);
  getH3App(nitroApp).use(AUTHORIZE_PATH, authorizeHandler);
  getH3App(nitroApp).use(
    ORGANIZATION_FEDERATION_PATH,
    organizationFederationHandler,
  );
  getH3App(nitroApp).use(IDENTITY_SSO_TOKEN_PATH, tokenHandler);
};
