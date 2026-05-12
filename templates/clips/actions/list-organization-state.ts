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
import { and, asc, eq, isNotNull, or } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { getDbExec } from "@agent-native/core/db";
import {
  getCurrentOwnerEmail,
  requireOrganizationAccess,
} from "../server/lib/recordings.js";

interface OrgRow {
  id: string;
  name: string;
  created_at: number | string | null;
}

interface SettingsRow {
  brand_color: string | null;
  brand_logo_url: string | null;
  default_visibility: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface MemberRow {
  id: string;
  email: string | null;
  role: string | null;
  joined_at: number | string | null;
}

interface InvitationRow {
  id: string;
  email: string | null;
  role: string | null;
  status: string | null;
  created_at: number | string | null;
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
  run: async (args) => {
    const db = getDb();
    const exec = getDbExec();
    const ownerEmail = getCurrentOwnerEmail();

    const { organizationId } = await requireOrganizationAccess(
      args.organizationId,
    );

    const orgRes = await exec.execute({
      sql: `SELECT id, name, created_at FROM organizations WHERE id = ? LIMIT 1`,
      args: [organizationId],
    });
    const org = (orgRes.rows as OrgRow[])[0];
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

    const settingsRes = await exec.execute({
      sql: `SELECT brand_color, brand_logo_url, default_visibility, created_at, updated_at FROM organization_settings WHERE organization_id = ? LIMIT 1`,
      args: [organizationId],
    });
    const settings = (settingsRes.rows as SettingsRow[])[0] ?? null;

    const memberRes = await exec.execute({
      sql: `SELECT id, email, role, joined_at FROM org_members WHERE org_id = ? ORDER BY joined_at ASC`,
      args: [organizationId],
    });
    const members = (memberRes.rows as MemberRow[]).map((m) => ({
      id: String(m.id),
      email: m.email ?? "",
      role: m.role ?? "member",
      joinedAt: m.joined_at !== null ? Number(m.joined_at) : null,
    }));

    const inviteRes = await exec.execute({
      sql: `SELECT id, email, role, status, created_at FROM org_invitations WHERE org_id = ? AND status = 'pending' ORDER BY created_at DESC`,
      args: [organizationId],
    });
    const invitations = (inviteRes.rows as InvitationRow[]).map((i) => ({
      id: String(i.id),
      email: i.email ?? "",
      role: i.role ?? "member",
      status: i.status ?? "pending",
      createdAt: i.created_at !== null ? Number(i.created_at) : null,
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
              eq(schema.folders.ownerEmail, ownerEmail),
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
        brandColor: settings?.brand_color ?? "#18181B",
        brandLogoUrl: settings?.brand_logo_url ?? null,
        defaultVisibility: settings?.default_visibility ?? "private",
        createdAt: org.created_at !== null ? Number(org.created_at) : null,
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
