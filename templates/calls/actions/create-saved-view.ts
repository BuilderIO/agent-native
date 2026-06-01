/**
 * Create a saved library view — a named bundle of filter chip state.
 *
 * Usage:
 *   pnpm action create-saved-view --name="My pipeline" --filters='{"stage":"discovery"}'
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import {
  getCurrentOwnerEmail,
  nanoid,
  parseSpaceIds,
  stringifySpaceIds,
  parseJson,
  resolveWorkspaceIdForAction,
} from "../server/lib/calls.js";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import {
  writeAppState,
  readAppState,
} from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Create a saved library view — a named bundle of filter chip state for the current workspace.",
  schema: z.object({
    name: z.string().min(1).describe("Name of the saved view"),
    filters: z
      .record(z.string(), z.any())
      .default({})
      .describe("Filter chip state as a JSON object"),
    workspaceId: z
      .string()
      .optional()
      .describe(
        "Workspace id — defaults to current-workspace app state, then user's first workspace.",
      ),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();

    const workspaceId = await resolveWorkspaceIdForAction({
      workspaceId: args.workspaceId,
      minRole: "creator-lite",
    });

    const id = nanoid();
    const now = new Date().toISOString();

    await db.insert(schema.savedViews).values({
      id,
      workspaceId,
      ownerEmail,
      name: args.name.trim(),
      filtersJson: JSON.stringify(args.filters ?? {}),
      createdAt: now,
    });

    await writeAppState("refresh-signal", { ts: Date.now() });
    console.log(`Created saved view "${args.name}" (${id})`);
    return {
      id,
      workspaceId,
      ownerEmail,
      name: args.name.trim(),
      filters: args.filters ?? {},
      createdAt: now,
    };
  },
});

void parseSpaceIds;
void stringifySpaceIds;
void parseJson;
void accessFilter;
void assertAccess;
