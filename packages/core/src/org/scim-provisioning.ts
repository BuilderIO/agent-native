import type {
  SCIMIdentity,
  SCIMIdentityResolution,
  SCIMIdentityResolutionContext,
  SCIMIdentityResolutionInput,
  SCIMIdentityState,
  SCIMTransactionContext,
} from "@better-auth/scim";
import type { DBTransactionAdapter } from "better-auth";

import { getAppConfig } from "../app-config/index.js";
import { invalidateMemberOrgCaches } from "./request-org-cache.js";

/**
 * Better Auth's plugin schema for framework-owned rows touched by SCIM. The
 * adapter only sees these models inside the SCIM transaction; no email is
 * persisted in the mapping table, so identity rekey cannot leave stale rows.
 */
export const frameworkOrgBridgePlugin = {
  id: "agent-native-org-bridge",
  version: "1",
  schema: {
    frameworkOrganization: {
      fields: {
        name: { type: "string", required: true },
        createdBy: {
          type: "string",
          required: true,
          fieldName: "createdBy",
        },
        createdAt: {
          type: "number",
          required: true,
          fieldName: "createdAt",
        },
        allowedDomain: {
          type: "string",
          required: false,
          fieldName: "allowedDomain",
        },
      },
    },
    orgMember: {
      fields: {
        orgId: { type: "string", required: true, fieldName: "orgId" },
        email: { type: "string", required: true },
        role: { type: "string", required: true },
        joinedAt: {
          type: "number",
          required: true,
          fieldName: "joinedAt",
        },
        federationRemovalPendingAt: {
          type: "number",
          required: false,
          fieldName: "federationRemovalPendingAt",
        },
      },
    },
    orgScimMembership: {
      fields: {
        orgId: { type: "string", required: true, fieldName: "orgId" },
        userId: { type: "string", required: true, fieldName: "userId" },
        memberId: { type: "string", required: false, fieldName: "memberId" },
        createdMembership: {
          type: "boolean",
          required: true,
          fieldName: "createdMembership",
        },
        createdAt: {
          type: "number",
          required: true,
          fieldName: "createdAt",
        },
      },
    },
    appMemberRole: {
      fields: {
        orgId: { type: "string", required: true, fieldName: "orgId" },
        appId: { type: "string", required: true, fieldName: "appId" },
        email: { type: "string", required: true },
        role: { type: "string", required: true },
        updatedBy: {
          type: "string",
          required: true,
          fieldName: "updatedBy",
        },
        updatedAt: {
          type: "number",
          required: true,
          fieldName: "updatedAt",
        },
      },
    },
  },
} as const;

type UserRow = { id: string; email: string; emailVerified?: boolean };
type OrgRow = { id: string; allowedDomain?: string | null };
type MemberRow = {
  id: string;
  orgId: string;
  email: string;
  role: string;
};
type ScimMembershipRow = {
  id: string;
  orgId: string;
  userId: string;
  memberId?: string | null;
  createdMembership: boolean;
};

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function newId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
  );
}

function isScimEnabled(): boolean {
  return getAppConfig().access.scim.enabled;
}

async function findFrameworkOrg(
  database: Pick<DBTransactionAdapter, "findOne">,
  orgId: string,
): Promise<OrgRow | null> {
  return database.findOne<OrgRow>({
    model: "frameworkOrganization",
    where: [{ field: "id", value: orgId }],
  });
}

async function findMember(
  database: Pick<DBTransactionAdapter, "findOne">,
  orgId: string,
  email: string,
): Promise<MemberRow | null> {
  return database.findOne<MemberRow>({
    model: "orgMember",
    where: [
      { field: "orgId", value: orgId },
      { field: "email", value: normalizeEmail(email), mode: "insensitive" },
    ],
  });
}

async function findUserById(
  database: Pick<DBTransactionAdapter, "findOne">,
  userId: string,
): Promise<UserRow | null> {
  return database.findOne<UserRow>({
    model: "user",
    where: [{ field: "id", value: userId }],
  });
}

async function findMapping(
  database: Pick<DBTransactionAdapter, "findOne">,
  orgId: string,
  userId: string,
): Promise<ScimMembershipRow | null> {
  return database.findOne<ScimMembershipRow>({
    model: "orgScimMembership",
    where: [
      { field: "orgId", value: orgId },
      { field: "userId", value: userId },
    ],
  });
}

async function ensureMembership(
  database: DBTransactionAdapter,
  orgId: string,
  userId: string,
  email: string,
): Promise<void> {
  email = normalizeEmail(email);
  const org = await findFrameworkOrg(database, orgId);
  // A provisioning domain is an exact framework org id. Never create a
  // membership for a user-controlled or deleted domain value.
  if (!org) return;

  const member = await findMember(database, orgId, email);
  const mapping = await findMapping(database, orgId, userId);
  if (mapping?.memberId) {
    const mappedMember = await database.findOne<MemberRow>({
      model: "orgMember",
      where: [{ field: "id", value: mapping.memberId }],
    });
    if (mappedMember && normalizeEmail(mappedMember.email) !== email) {
      const previousEmail = normalizeEmail(mappedMember.email);
      await database.update({
        model: "orgMember",
        where: [{ field: "id", value: mappedMember.id }],
        update: { email },
      });
      await database.updateMany({
        model: "appMemberRole",
        where: [
          { field: "orgId", value: orgId },
          {
            field: "email",
            value: previousEmail,
            mode: "insensitive",
          },
        ],
        update: { email },
      });
    }
    if (mappedMember) return;
  }
  if (member) {
    if (mapping) return;
    await database.create({
      model: "orgScimMembership",
      data: {
        orgId,
        userId,
        memberId: null,
        createdMembership: false,
        createdAt: Date.now(),
      },
    });
    return;
  }

  const memberId = newId();
  await database.create({
    model: "orgMember",
    data: {
      id: memberId,
      orgId,
      email: normalizeEmail(email),
      role: "member",
      joinedAt: Date.now(),
    },
    forceAllowId: true,
  });
  await database.create({
    model: "orgScimMembership",
    data: {
      orgId,
      userId,
      memberId: memberId,
      createdMembership: true,
      createdAt: Date.now(),
    },
  });
  invalidateMemberOrgCaches();
}

async function removeMembershipIfOwned(
  database: DBTransactionAdapter,
  mapping: ScimMembershipRow,
  email: string,
): Promise<void> {
  await database.delete({
    model: "orgScimMembership",
    where: [{ field: "id", value: mapping.id }],
  });
  if (!mapping.createdMembership) return;

  // Prefer the immutable row id so a profile update or email rekey cannot
  // strand a SCIM-owned membership. Older rows predate memberId; retain a
  // case-insensitive email fallback for those records only.
  let member = mapping.memberId
    ? await database.findOne<MemberRow>({
        model: "orgMember",
        where: [{ field: "id", value: mapping.memberId }],
      })
    : null;
  if (!member && !mapping.memberId) {
    const members = await database.findMany<MemberRow>({
      model: "orgMember",
      where: [{ field: "orgId", value: mapping.orgId }],
    });
    member =
      members.find(
        (row) => normalizeEmail(row.email) === normalizeEmail(email),
      ) ?? null;
  }
  if (!member) return;
  await database.delete({
    model: "orgMember",
    where: [{ field: "id", value: member.id }],
  });
  // App-role rows are an overlay on membership. Remove rows for a membership
  // SCIM created, but never touch manually-owned memberships.
  await database.deleteMany({
    model: "appMemberRole",
    where: [
      { field: "orgId", value: mapping.orgId },
      {
        field: "email",
        value: normalizeEmail(member.email),
        mode: "insensitive",
      },
    ],
  });
  invalidateMemberOrgCaches();
}

/**
 * Bridge Better Auth SCIM lifecycle state to framework organizations. The
 * callback runs inside Better Auth's native transaction and is idempotent for
 * retries. Deactivation removes only memberships this SCIM source created;
 * manually-added members remain in the roster.
 */
export function createFrameworkSCIMIdentity(): SCIMIdentity {
  return {
    async resolveUser(
      input: SCIMIdentityResolutionInput,
      context: SCIMIdentityResolutionContext,
    ): Promise<SCIMIdentityResolution> {
      // This callback is only registered when SCIM is enabled. Keep the
      // fallback a valid Better Auth resolution so plugin upgrades cannot
      // crash on an unexpected disabled-state invocation.
      if (!isScimEnabled()) return { action: "create" };
      const email = normalizeEmail(input.resource.primaryEmail);
      const user = await context.database.findOne<UserRow>({
        model: "user",
        where: [{ field: "email", value: email, mode: "insensitive" }],
      });
      if (!user) return { action: "create" };
      // A linked identity always resolves by Better Auth user id. The email is
      // merely the SCIM directory's verified lookup key.
      return { action: "link", userId: user.id, profile: "preserve" };
    },

    async reconcileUser(
      input: SCIMIdentityState,
      context: SCIMTransactionContext,
    ): Promise<void> {
      if (!isScimEnabled()) return;
      const user = await findUserById(context.database, input.userId);
      if (!user) return;

      const activeOrgIds = new Set(
        input.sources
          .filter((source) => source.active)
          .map((source) => source.provisioningDomainId),
      );
      const mapped = await context.database.findMany<ScimMembershipRow>({
        model: "orgScimMembership",
        where: [{ field: "userId", value: input.userId }],
      });

      for (const orgId of activeOrgIds) {
        await ensureMembership(
          context.database,
          orgId,
          input.userId,
          user.email,
        );
      }
      for (const mapping of mapped) {
        if (!activeOrgIds.has(mapping.orgId)) {
          await removeMembershipIfOwned(context.database, mapping, user.email);
        }
      }
    },
  };
}

export type { SCIMIdentityState };
