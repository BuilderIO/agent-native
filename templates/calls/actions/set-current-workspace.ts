/**
 * Set which workspace is active. Writes `current-workspace` application state
 * so the UI scopes library / spaces / roster views to this workspace.
 *
 * Usage:
 *   pnpm action set-current-workspace --id=<workspaceId>
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import {
  getCurrentOwnerEmail,
  nanoid,
  parseSpaceIds,
  stringifySpaceIds,
  parseJson,
  resolveDefaultWorkspaceId,
} from "../server/lib/calls.js";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { writeAppState, readAppState } from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Set which workspace is active. Validates the workspace exists, writes current-workspace to application state, and bumps refresh-signal so lists refetch against the new workspace.",
  schema: z.object({
    id: z.string().describe("Workspace id to activate"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const db = getDb();
    const [row] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, args.id))
      .limit(1);
    if (!row) throw new Error(`Workspace not found: ${args.id}`);

    await writeAppState("current-workspace", {
      id: row.id,
      name: row.name,
      slug: row.slug,
      brandColor: row.brandColor,
      brandLogoUrl: row.brandLogoUrl,
    });
    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Switched to workspace "${row.name}" (${row.id})`);
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      brandColor: row.brandColor,
      brandLogoUrl: row.brandLogoUrl,
    };
  },
});

void getCurrentOwnerEmail;
void nanoid;
void parseSpaceIds;
void stringifySpaceIds;
void parseJson;
void resolveDefaultWorkspaceId;
void readAppState;
void accessFilter;
void assertAccess;
