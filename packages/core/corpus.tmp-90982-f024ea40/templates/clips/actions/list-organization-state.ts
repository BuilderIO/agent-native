/**
 * Return a summary of the active organization — org row, members, spaces,
 * and personal-library folders. Useful for orienting the agent at the start
 * of a session when the user asks "who's in my org?" or "what spaces do I
 * have?".
 *
 * Usage:
 *   pnpm action list-organization-state
 */

import { defineAction } from "@agent-native/core";
import {
  organizations,
  orgInvitations,
  orgMembers,
} from "@agent-native/core/org";
import { and, asc, desc, eq, isNotNull, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  getCurrentOwnerEmail,
  ownerEmailMatches,
  requireOrganizationAccess,
} from "../server/lib/recordings.js";

export default defineAction({
  description:
    "Return a summary of the active organization — org row, members, spaces, and personal-library folders.",
  schema: z.object({
    organizationId: z
      .string()
      .optional()
      .describe(
        "Override the active organization. If omitted, resolves from the caller's active-org-id user-setting / org_members lookup.",
      ),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();

    const { organizationId } = await requireOrganizationAccess(
      args.organizationId,
    );

    const [org] = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        createdAt: organizations.createdAt,
      })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (!org) {
      return {
        organization: null,
        members: [],
        spaces: [],
        folders: [],
        personalFolders: [],
        invitations: [],
      };
    }

    const [settings] = await db
      .select({
        brandColor: schema.organizationSettings.brandColor,
        brandLogoUrl: schema.organizationSettings.brandLogoUrl,
        defaultVisibility: schema.organizationSettings.defaultVisibility,
      })
      .from(schema.organizationSettings)
      .where(eq(schema.organizationSettings.organizationId, organizationId))
      .limit(1);

    const memberRows = await db
      .select({
        id: orgMembers.id,
        email: orgMembers.email,
        role: orgMembers.role,
        joinedAt: orgMembers.joinedAt,
      })
      .from(orgMembers)
      .where(eq(orgMembers.orgId, organizationId))
      .orderBy(asc(orgMembers.joinedAt));
    const members = memberRows.map((m) => ({
      id: m.id,
      email: m.email,
      role: m.role,
      joinedAt: Number(m.joinedAt),
    }));

    const inviteRows = await db
      .select({
        id: orgInvitations.id,
        email: orgInvitations.email,
        role: orgInvitations.role,
        status: orgInvitations.status,
        createdAt: orgInvitations.createdAt,
      })
      .from(orgInvitations)
      .where(
        and(
          eq(orgInvitations.orgId, organizationId),
          eq(orgInvitations.status, "pending"),
        ),
      )
      .orderBy(desc(orgInvitations.createdAt));
    const invitations = inviteRows.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role ?? "member",
      status: i.status,
      createdAt: Number(i.createdAt),
    }));

    const [spaces, folders] = await Promise.all([
      db
        .select()
        .from(schema.spaces)
        .where(eq(schema.spaces.organizationId, organizationId))
        .orderBy(asc(schema.spaces.name)),
      db
        .select()
        .from(schema.folders)
        .where(
          and(
            eq(schema.folders.organizationId, organizationId),
            or(
              isNotNull(schema.folders.spaceId),
              ownerEmailMatches(schema.folders.ownerEmail, ownerEmail),
            ),
          ),
        )
        .orderBy(asc(schema.folders.position)),
    ]);

    return {
      currentUserEmail: ownerEmail,
      organization: {
        id: org.id,
        name: org.name,
        brandColor: settings?.brandColor ?? "#18181B",
        brandLogoUrl: settings?.brandLogoUrl ?? null,
        defaultVisibility: settings?.defaultVisibility ?? "private",
        createdAt: Number(org.createdAt),
      },
      members,
      spaces: spaces.map((s) => ({
        id: s.id,
        name: s.name,
        color: s.color,
        iconEmoji: s.iconEmoji,
        isAllCompany: Boolean(s.isAllCompany),
      })),
      folders: folders.map((f) => ({
        id: f.id,
        name: f.name,
        parentId: f.parentId,
        spaceId: f.spaceId,
        ownerEmail: f.ownerEmail,
        position: f.position,
      })),
      personalFolders: folders
        .filter((f) => f.spaceId === null)
        .map((f) => ({
          id: f.id,
          name: f.name,
          parentId: f.parentId,
        })),
      invitations,
    };
  },
});
