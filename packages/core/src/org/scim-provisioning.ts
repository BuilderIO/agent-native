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
    agentAuditLog: {
      fields: {
        createdAt: { type: "number", required: true, fieldName: "createdAt" },
        action: { type: "string", required: true },
        caller: { type: "string", required: true },
        actorKind: { type: "string", required: true, fieldName: "actorKind" },
        actorEmail: {
          type: "string",
          required: false,
          fieldName: "actorEmail",
        },
        orgId: { type: "string", required: false, fieldName: "orgId" },
        targetType: {
          type: "string",
          required: false,
          fieldName: "targetType",
        },
        targetId: { type: "string", required: false, fieldName: "targetId" },
        status: { type: "string", required: true },
        summary: { type: "string", required: false },
        input: { type: "string", required: false },
        ownerEmail: {
          type: "string",
          required: false,
          fieldName: "ownerEmail",
        },
        visibility: { type: "string", required: true },
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
  federationRemovalPendingAt?: number | null;
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
  if (!org) return;

  const member = await findMember(database, orgId, email);
  let mapping = await findMapping(database, orgId, userId);
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
    if (mappedMember) {
      if (mappedMember.federationRemovalPendingAt != null) {
        await database.update({
          model: "orgMember",
          where: [{ field: "id", value: mappedMember.id }],
          update: { federationRemovalPendingAt: null },
        });
      }
      return;
    }
    await database.delete({
      model: "orgScimMembership",
      where: [{ field: "id", value: mapping.id }],
    });
    mapping = null;
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
  if (!mapping.createdMembership) return;

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
  if (!member) {
    await database.delete({
      model: "orgScimMembership",
      where: [{ field: "id", value: mapping.id }],
    });
    return;
  }
  if (member.federationRemovalPendingAt != null) return;
  const pendingAt = Date.now();
  await database.update({
    model: "orgMember",
    where: [{ field: "id", value: member.id }],
    update: { federationRemovalPendingAt: pendingAt },
  });
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
  await database.create({
    model: "agentAuditLog",
    data: {
      createdAt: pendingAt,
      action: "org.member.scim-removal-pending",
      caller: "scim",
      actorKind: "system",
      actorEmail: null,
      orgId: mapping.orgId,
      targetType: "identity",
      targetId: normalizeEmail(member.email),
      status: "pending",
      summary:
        "SCIM deprovisioning marked membership pending successor transfer.",
      input: JSON.stringify({
        userId: mapping.userId,
        memberId: member.id,
        orgId: mapping.orgId,
      }),
      ownerEmail: normalizeEmail(member.email),
      visibility: "org",
    },
    forceAllowId: true,
  });
  invalidateMemberOrgCaches();
}

export function createFrameworkSCIMIdentity(): SCIMIdentity {
  return {
    async resolveUser(
      input: SCIMIdentityResolutionInput,
      context: SCIMIdentityResolutionContext,
    ): Promise<SCIMIdentityResolution> {
      if (!isScimEnabled()) return { action: "create" };
      const email = normalizeEmail(input.resource.primaryEmail);
      const user = await context.database.findOne<UserRow>({
        model: "user",
        where: [{ field: "email", value: email, mode: "insensitive" }],
      });
      if (!user) return { action: "create" };
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
      if (activeOrgIds.size === 0) {
        const remainingMembers = await context.database.findMany<MemberRow>({
          model: "orgMember",
          where: [
            {
              field: "email",
              value: normalizeEmail(user.email),
              mode: "insensitive",
            },
          ],
        });
        const hasActiveMembership = remainingMembers.some(
          (member) => member.federationRemovalPendingAt == null,
        );
        if (hasActiveMembership) return;
        await context.database.deleteMany({
          model: "session",
          where: [{ field: "userId", value: input.userId }],
        });
      }
    },
  };
}

export type { SCIMIdentityState };
