/**
 * Set which workspace is active in the UI.
 *
 * Writes `current-workspace` to application state. The UI reads this and
 * scopes the library / spaces / roster views to that workspace. This is
 * bidirectional — both the UI (workspace switcher) and the agent can set it.
 *
 * Usage:
 *   pnpm action set-current-workspace --id=<workspaceId>
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Set which workspace is active. Validates the workspace exists, writes current-workspace to application state, and bumps refresh-signal so lists refetch against the new workspace.",
  schema: z.object({
    id: z.string().describe("Workspace id to activate"),
  }),
  run: async (args) => {
    const db = getDb();
    const [row] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, args.id));
    if (!row) {
      throw new Error(`Workspace not found: ${args.id}`);
    }

    await writeAppState("current-workspace", {
      id: row.id,
      name: row.name,
      slug: row.slug,
      brandColor: row.brandColor,
    });
    // Lists (library, spaces, folders, roster) are all workspace-scoped.
    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Switched to workspace "${row.name}" (${row.id})`);
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      brandColor: row.brandColor,
    };
  },
});
