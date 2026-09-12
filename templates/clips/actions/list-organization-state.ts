/**
 * Return a summary of the active organization — org row, members, spaces,
 * and personal-library folders. Useful for orienting the agent at the start
 * of a session when the user asks "who's in my org?" or "what spaces do I
 * have?".
 *
 * Usage:
 *   pnpm action list-organization-state
 */

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
  notInArray,
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
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();

    // Personal scope - no membership anywhere, or the caller just deleted
    // their last organization - is a supported state, not a read failure.
    // Throwing here reached the UI as a load error next to the
    // create-organization card that already renders the same state correctly.
    // An organization the caller may not read still errors.
    const activeOrganizationId =
      args.organizationId ?? (await getActiveOrganizationId());
    if (!activeOrganizationId) return emptyOrganizationState(ownerEmail);

    const { organizationId } =
      await requireOrganizationAccess(activeOrganizationId);

    const [org] = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        createdAt: organizations.createdAt,
      })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (!org) return emptyOrganizationState(ownerEmail);

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
    const profiles = await getUserProfiles(
      members.map((member) => member.email),
    );
    const membersWithProfiles = members.map((member) => {
      const name = profiles.get(member.email.toLowerCase())?.name;
      return {
        ...member,
        ...(name && !isEmailDerivedName(name, member.email) ? { name } : {}),
      };
    });

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

    const resolvedDb = await Promise.resolve(db);
    const meetingRecordingIds = resolvedDb
      .select({ id: schema.meetings.recordingId })
      .from(schema.meetings)
      .where(isNotNull(schema.meetings.recordingId));
    const [spaces, folders, folderRecordingCountRows] = await Promise.all([
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
      resolvedDb
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
            notInArray(schema.recordings.id, meetingRecordingIds),
          ),
        )
        .groupBy(schema.recordings.folderId),
    ]);
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
        brandColor: settings?.brandColor ?? "#18181B",
        brandLogoUrl: settings?.brandLogoUrl ?? null,
        defaultVisibility: settings?.defaultVisibility ?? "public",
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
