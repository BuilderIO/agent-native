import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";

/**
 * Remove a repo from the current user's Workbench queue.
 *
 * Per-user only: the DELETE WHERE clause matches BOTH the row id AND
 * `ownerEmail === getRequestUserEmail()`, so a user cannot delete another
 * user's repo even if they guess the id. `workbench_repos` has no shares
 * table, so this owner-equality check is the access control.
 */
export default defineAction({
  description:
    "Remove a repo from the current user's Workbench queue by id. " +
    "Owner-only — a user can only remove repos they themselves added.",
  schema: z.object({
    id: z.string().min(1),
  }),
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      throw new Error("Sign in to remove repos from your queue.");
    }

    const db = getDb();

    // Fetch first so we can return useful info AND so we can tell the
    // caller "not found" vs "not yours" vs "deleted" without a second
    // round-trip from the UI.
    const existing = await db
      .select({
        id: schema.workbenchRepos.id,
        owner: schema.workbenchRepos.owner,
        name: schema.workbenchRepos.name,
        ownerEmail: schema.workbenchRepos.ownerEmail,
      })
      .from(schema.workbenchRepos)
      .where(eq(schema.workbenchRepos.id, args.id))
      .limit(1);

    if (existing.length === 0) {
      return {
        ok: true,
        id: args.id,
        removed: false,
        message: "Repo wasn't in your queue.",
      };
    }

    if (existing[0].ownerEmail !== ownerEmail) {
      throw new Error(
        "You can only remove repos you yourself added to your queue.",
      );
    }

    await db
      .delete(schema.workbenchRepos)
      .where(
        and(
          eq(schema.workbenchRepos.id, args.id),
          eq(schema.workbenchRepos.ownerEmail, ownerEmail),
        ),
      );

    return {
      ok: true,
      id: args.id,
      removed: true,
      repo: {
        owner: existing[0].owner,
        name: existing[0].name,
      },
    };
  },
});
