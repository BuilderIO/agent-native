/**
 * Return the current workspace's roster / spaces / folders summary.
 *
 * Useful for orienting the agent at the start of a session when the user
 * says things like "who's in my workspace?" or "what spaces do I have?".
 *
 * Usage:
 *   pnpm action list-workspace-state
 */

import { defineAction } from "@agent-native/core";
import { readAppState } from "@agent-native/core/application-state";
import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Return a summary of the active workspace — workspace row, members, spaces, and personal-library folders. Useful for grounding roster / space / folder questions.",
  schema: z.object({
    workspaceId: z
      .string()
      .optional()
      .describe(
        "Override the active workspace. If omitted, reads current-workspace from application state and falls back to the most-recently-created workspace.",
      ),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();

    let workspaceId = args.workspaceId ?? null;
    if (!workspaceId) {
      const current = (await readAppState("current-workspace")) as {
        id?: string;
      } | null;
      workspaceId = current?.id ?? null;
    }

    let workspace = null as any;
    if (workspaceId) {
      const [row] = await db
        .select()
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, workspaceId));
      workspace = row ?? null;
    }
    if (!workspace) {
      const [row] = await db
        .select()
        .from(schema.workspaces)
        .orderBy(desc(schema.workspaces.createdAt))
        .limit(1);
      workspace = row ?? null;
    }

    if (!workspace) {
      return {
        workspace: null,
        members: [],
        spaces: [],
        folders: [],
        invites: [],
      };
    }

    const [members, spaces, folders, invites] = await Promise.all([
      db
        .select()
        .from(schema.workspaceMembers)
        .where(eq(schema.workspaceMembers.workspaceId, workspace.id))
        .orderBy(asc(schema.workspaceMembers.email)),
      db
        .select()
        .from(schema.spaces)
        .where(eq(schema.spaces.workspaceId, workspace.id))
        .orderBy(asc(schema.spaces.name)),
      db
        .select()
        .from(schema.folders)
        .where(eq(schema.folders.workspaceId, workspace.id))
        .orderBy(asc(schema.folders.position)),
      db
        .select()
        .from(schema.invites)
        .where(eq(schema.invites.workspaceId, workspace.id))
        .orderBy(desc(schema.invites.createdAt)),
    ]);

    return {
      workspace: {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        brandColor: workspace.brandColor,
        brandLogoUrl: workspace.brandLogoUrl,
        defaultVisibility: workspace.defaultVisibility,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
      },
      members: members.map((m) => ({
        id: m.id,
        email: m.email,
        role: m.role,
        invitedAt: m.invitedAt,
        joinedAt: m.joinedAt,
      })),
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
      invites: invites
        .filter((i) => !i.acceptedAt)
        .map((i) => ({
          id: i.id,
          email: i.email,
          role: i.role,
          invitedBy: i.invitedBy,
          expiresAt: i.expiresAt,
          createdAt: i.createdAt,
        })),
    };
  },
});
