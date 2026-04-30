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
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { getDbExec, isPostgres } from "@agent-native/core/db";
import { requireOrganizationAccess } from "../server/lib/recordings.js";

interface OrgRow {
  id: string;
  name: string;
  slug: string | null;
  logo?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
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
  created_at?: string | null;
}

interface InvitationRow {
  id: string;
  email: string | null;
  role: string | null;
  status: string | null;
  expires_at: string | null;
  created_at: string | null;
}

export default defineAction({
  description:
    "Return a summary of the active organization — org row, members, spaces, and personal-library folders.",
  schema: z.object({
    organizationId: z
      .string()
      .optional()
      .describe(
        "Override the active organization. If omitted, resolves from the session's active_organization_id / member lookup.",
      ),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    const exec = getDbExec();
    const pg = isPostgres();

    const { organizationId } = await requireOrganizationAccess(
      args.organizationId,
    );

    // Organization row
    const orgRes = await exec.execute({
      sql: pg
        ? `SELECT id, name, slug, logo, created_at, updated_at FROM organization WHERE id = $1 LIMIT 1`
        : `SELECT id, name, slug, logo, created_at, updated_at FROM organization WHERE id = ? LIMIT 1`,
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

    // Settings sidecar
    const settingsRes = await exec.execute({
      sql: pg
        ? `SELECT brand_color, brand_logo_url, default_visibility, created_at, updated_at FROM organization_settings WHERE organization_id = $1 LIMIT 1`
        : `SELECT brand_color, brand_logo_url, default_visibility, created_at, updated_at FROM organization_settings WHERE organization_id = ? LIMIT 1`,
      args: [organizationId],
    });
    const settings = (settingsRes.rows as SettingsRow[])[0] ?? null;

    // Members + emails — join to the user table.
    const userTable = pg ? `"user"` : `user`;
    const memberRes = await exec.execute({
      sql: pg
        ? `SELECT m.id AS id, u.email AS email, m.role AS role, m.created_at AS created_at
             FROM member m
             LEFT JOIN ${userTable} u ON u.id = m.user_id
             WHERE m.organization_id = $1
             ORDER BY m.created_at ASC`
        : `SELECT m.id AS id, u.email AS email, m.role AS role, m.created_at AS created_at
             FROM member m
             LEFT JOIN ${userTable} u ON u.id = m.user_id
             WHERE m.organization_id = ?
             ORDER BY m.created_at ASC`,
      args: [organizationId],
    });
    const members = (memberRes.rows as MemberRow[]).map((m) => ({
      id: String(m.id),
      email: m.email ?? "",
      role: m.role ?? "member",
      joinedAt: m.created_at ?? null,
    }));

    // Pending invitations
    const inviteRes = await exec.execute({
      sql: pg
        ? `SELECT id, email, role, status, expires_at, created_at FROM invitation WHERE organization_id = $1 AND status = 'pending' ORDER BY created_at DESC`
        : `SELECT id, email, role, status, expires_at, created_at FROM invitation WHERE organization_id = ? AND status = 'pending' ORDER BY created_at DESC`,
      args: [organizationId],
    });
    const invitations = (inviteRes.rows as InvitationRow[]).map((i) => ({
      id: String(i.id),
      email: i.email ?? "",
      role: i.role ?? "member",
      status: i.status ?? "pending",
      expiresAt: i.expires_at ?? null,
      createdAt: i.created_at ?? null,
    }));

    // Spaces + folders via Drizzle
    const [spaces, folders] = await Promise.all([
      db
        .select()
        .from(schema.spaces)
        .where(eq(schema.spaces.organizationId, organizationId))
        .orderBy(asc(schema.spaces.name)),
      db
        .select()
        .from(schema.folders)
        .where(eq(schema.folders.organizationId, organizationId))
        .orderBy(asc(schema.folders.position)),
    ]);

    return {
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug ?? null,
        brandColor: settings?.brand_color ?? "#18181B",
        brandLogoUrl: settings?.brand_logo_url ?? org.logo ?? null,
        defaultVisibility: settings?.default_visibility ?? "private",
        createdAt: org.created_at ?? null,
        updatedAt: org.updated_at ?? null,
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
