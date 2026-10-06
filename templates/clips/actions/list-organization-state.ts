import { defineAction } from "@agent-native/core/action";
import {
  organizations,
  orgInvitations,
  orgMembers,
} from "@agent-native/core/org";
import { isEmailDerivedName } from "@agent-native/core/user-profile";
import { getUserProfiles } from "@agent-native/core/user-profile/server";
import {
  and,
  asc,
  desc,
  eq,
  isNotNull,
  isNull,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  agentRecordingAccessFilter,
  isAgentRecordingCaller,
} from "../server/lib/agent-recording-access.js";
import {
  getActiveOrganizationId,
  getCurrentOwnerEmail,
  ownerEmailMatches,
  requireOrganizationAccess,
} from "../server/lib/recordings.js";

function emptyOrganizationState(currentUserEmail: string) {
  return {
    currentUserEmail,
    organization: null,
    members: [],
    spaces: [],
    folders: [],
    personalFolders: [],
    invitations: [],
  };
}

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
  run: async (args, ctx) => {
    const db = await Promise.resolve(getDb());
    const ownerEmail = getCurrentOwnerEmail();

    const activeOrganizationId =
      args.organizationId ?? (await getActiveOrganizationId());
    if (!activeOrganizationId) return emptyOrganizationState(ownerEmail);

    const { organizationId } =
      await requireOrganizationAccess(activeOrganizationId);

    const memberRowsPromise = Promise.resolve(
      db
        .select({
          id: orgMembers.id,
          email: orgMembers.email,
          role: orgMembers.role,
          joinedAt: orgMembers.joinedAt,
        })
        .from(orgMembers)
        .where(eq(orgMembers.orgId, organizationId))
        .orderBy(asc(orgMembers.joinedAt)),
    );

    const [
      [org],
      memberRows,
      profiles,
      inviteRows,
      spaces,
      folders,
      folderRecordingCountRows,
    ] = await Promise.all([
      db
        .select({
          id: organizations.id,
          name: organizations.name,
          createdAt: organizations.createdAt,
          brandColor: schema.organizationSettings.brandColor,
          brandLogoUrl: schema.organizationSettings.brandLogoUrl,
          defaultVisibility: schema.organizationSettings.defaultVisibility,
        })
        .from(organizations)
        .leftJoin(
          schema.organizationSettings,
          eq(schema.organizationSettings.organizationId, organizations.id),
        )
        .where(eq(organizations.id, organizationId))
        .limit(1),
      memberRowsPromise,
      memberRowsPromise.then((rows) =>
        getUserProfiles(rows.map((member) => member.email)),
      ),
      db
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
        .orderBy(desc(orgInvitations.createdAt)),
      db
        .select({
          id: schema.spaces.id,
          name: schema.spaces.name,
          color: schema.spaces.color,
          iconEmoji: schema.spaces.iconEmoji,
          isAllCompany: schema.spaces.isAllCompany,
        })
        .from(schema.spaces)
        .where(eq(schema.spaces.organizationId, organizationId))
        .orderBy(asc(schema.spaces.name)),
      db
        .select({
          id: schema.folders.id,
          name: schema.folders.name,
          parentId: schema.folders.parentId,
          spaceId: schema.folders.spaceId,
          ownerEmail: schema.folders.ownerEmail,
          position: schema.folders.position,
        })
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
      db
        .select({
          folderId: schema.recordings.folderId,
          recordingCount: sql<number>`COUNT(1)`,
        })
        .from(schema.recordings)
        .where(
          and(
            agentRecordingAccessFilter(
              schema.recordings,
              schema.recordingShares,
              schema.recordingViewers,
              {
                agentOnly: isAgentRecordingCaller(ctx?.caller),
                userEmail: ctx?.userEmail,
              },
            ),
            eq(schema.recordings.organizationId, organizationId),
            isNotNull(schema.recordings.folderId),
            isNull(schema.recordings.archivedAt),
            isNull(schema.recordings.trashedAt),
            notExists(
              db
                .select({ one: sql`1` })
                .from(schema.meetings)
                .where(eq(schema.meetings.recordingId, schema.recordings.id)),
            ),
          ),
        )
        .groupBy(schema.recordings.folderId),
    ]);
    if (!org) return emptyOrganizationState(ownerEmail);

    const membersWithProfiles = memberRows.map((m) => {
      const name = profiles.get(m.email.toLowerCase())?.name;
      return {
        id: m.id,
        email: m.email,
        role: m.role,
        joinedAt: Number(m.joinedAt),
        ...(name && !isEmailDerivedName(name, m.email) ? { name } : {}),
      };
    });

    const invitations = inviteRows.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role ?? "member",
      status: i.status,
      createdAt: Number(i.createdAt),
    }));

    const recordingCountByFolder = new Map(
      folderRecordingCountRows.flatMap((row) =>
        row.folderId
          ? [[row.folderId, Number(row.recordingCount ?? 0)] as const]
          : [],
      ),
    );

    return {
      currentUserEmail: ownerEmail,
      organization: {
        id: org.id,
        name: org.name,
        // guard:allow-raw-color — stored brand data; mirrors the brand_color column default.
        brandColor: org.brandColor ?? "#18181B",
        brandLogoUrl: org.brandLogoUrl ?? null,
        defaultVisibility: org.defaultVisibility ?? "public",
        createdAt: Number(org.createdAt),
      },
      members: membersWithProfiles,
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
        recordingCount: recordingCountByFolder.get(f.id) ?? 0,
      })),
      personalFolders: folders
        .filter((f) => f.spaceId === null)
        .map((f) => ({
          id: f.id,
          name: f.name,
          parentId: f.parentId,
          recordingCount: recordingCountByFolder.get(f.id) ?? 0,
        })),
      invitations,
    };
  },
});
