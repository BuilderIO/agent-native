/**
 * List the current user's saved library views for the active workspace.
 *
 * Usage:
 *   pnpm action list-saved-views
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import {
  getCurrentOwnerEmail,
  parseJson,
  resolveWorkspaceIdForAction,
} from "../server/lib/calls.js";

export default defineAction({
  description:
    "List saved library views for the current user + workspace. Each view bundles a name and a JSON blob of filter chip state.",
  schema: z.object({
    workspaceId: z
      .string()
      .optional()
      .describe(
        "Workspace id — defaults to current-workspace app state, then user's first workspace.",
      ),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();

    const workspaceId = await resolveWorkspaceIdForAction({
      workspaceId: args.workspaceId,
    });

    const rows = await db
      .select()
      .from(schema.savedViews)
      .where(
        and(
          eq(schema.savedViews.workspaceId, workspaceId),
          eq(schema.savedViews.ownerEmail, ownerEmail),
        ),
      )
      .orderBy(asc(schema.savedViews.name));

    const views = rows.map((v) => ({
      id: v.id,
      name: v.name,
      filters: parseJson<Record<string, unknown>>(v.filtersJson, {}),
      createdAt: v.createdAt,
    }));

    return { workspaceId, views, count: views.length };
  },
});
