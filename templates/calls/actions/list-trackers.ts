/**
 * List all tracker definitions for the current workspace.
 *
 * Usage:
 *   pnpm action list-trackers [--workspaceId=<wid>]
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { parseJson, resolveWorkspaceIdForAction } from "../server/lib/calls.js";

export default defineAction({
  description:
    "List all tracker definitions (keyword + smart) for the current workspace.",
  schema: z.object({
    workspaceId: z
      .string()
      .optional()
      .describe(
        "Workspace id; defaults to the current-workspace app-state value.",
      ),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    const workspaceId = await resolveWorkspaceIdForAction({
      workspaceId: args.workspaceId,
    });

    const rows = await db
      .select()
      .from(schema.trackerDefinitions)
      .where(eq(schema.trackerDefinitions.workspaceId, workspaceId))
      .orderBy(asc(schema.trackerDefinitions.createdAt));

    const trackers = rows.map((t) => ({
      id: t.id,
      workspaceId: t.workspaceId,
      name: t.name,
      description: t.description,
      kind: t.kind,
      keywords: parseJson<string[]>(t.keywordsJson, []),
      classifierPrompt: t.classifierPrompt,
      color: t.color,
      isDefault: Boolean(t.isDefault),
      enabled: Boolean(t.enabled),
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));

    return { workspaceId, trackers };
  },
});
