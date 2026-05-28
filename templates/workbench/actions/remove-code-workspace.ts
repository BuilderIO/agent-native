import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";

/**
 * Remove a Code Room workspace by id.
 *
 * Per-user only: the DELETE matches both the row id AND
 * `ownerEmail === getRequestUserEmail()`, so a user can never remove
 * another user's workspace by guessing its id. Returns a `removed: false`
 * sentinel when the row is missing rather than throwing so the UI's
 * delete confirmation can short-circuit cleanly.
 *
 * Also clears any `workbench_open_files` rows tied to this workspace —
 * those would otherwise be orphaned and the agent would keep trying to
 * restore tabs for a workspace that no longer exists.
 */
export default defineAction({
  description:
    "Remove a Code Room workspace by id. Owner-only — a user can only " +
    "remove workspaces they themselves added.",
  schema: z.object({
    id: z.string().min(1),
  }),
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      throw new Error("Sign in to remove a code workspace.");
    }

    const db = getDb();

    const existing = await db
      .select({
        id: schema.workbenchCodeWorkspaces.id,
        label: schema.workbenchCodeWorkspaces.label,
        path: schema.workbenchCodeWorkspaces.path,
        ownerEmail: schema.workbenchCodeWorkspaces.ownerEmail,
      })
      .from(schema.workbenchCodeWorkspaces)
      .where(eq(schema.workbenchCodeWorkspaces.id, args.id))
      .limit(1);

    if (existing.length === 0) {
      return {
        ok: true,
        id: args.id,
        removed: false,
        message: "Workspace wasn't in your list.",
      };
    }

    if (existing[0].ownerEmail !== ownerEmail) {
      throw new Error("You can only remove workspaces you yourself added.");
    }

    await db
      .delete(schema.workbenchCodeWorkspaces)
      .where(
        and(
          eq(schema.workbenchCodeWorkspaces.id, args.id),
          eq(schema.workbenchCodeWorkspaces.ownerEmail, ownerEmail),
        ),
      );

    // Clean up any tabs the user had remembered for this workspace.
    await db
      .delete(schema.workbenchOpenFiles)
      .where(
        and(
          eq(schema.workbenchOpenFiles.workspaceId, args.id),
          eq(schema.workbenchOpenFiles.ownerEmail, ownerEmail),
        ),
      );

    return {
      ok: true,
      id: args.id,
      removed: true,
      workspace: {
        label: existing[0].label,
        path: existing[0].path,
      },
    };
  },
});
