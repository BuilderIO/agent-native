/**
 * Rename a saved library view and/or update its filters.
 *
 * Usage:
 *   pnpm action update-saved-view --id=<id> --name="Renamed view"
 *   pnpm action update-saved-view --id=<id> --filters='{"stage":"closing"}'
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
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
import {
  writeAppState,
  readAppState,
} from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Update a saved library view — rename it and/or replace its filter JSON. The caller must be the view's owner.",
  schema: z.object({
    id: z.string().describe("Saved view id"),
    name: z.string().min(1).optional().describe("New name"),
    filters: z
      .record(z.string(), z.any())
      .optional()
      .describe("Replacement filter chip state JSON"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();

    const [existing] = await db
      .select()
      .from(schema.savedViews)
      .where(
        and(
          eq(schema.savedViews.id, args.id),
          eq(schema.savedViews.ownerEmail, ownerEmail),
        ),
      )
      .limit(1);
    if (!existing) throw new Error(`Saved view not found: ${args.id}`);

    const patch: Record<string, unknown> = {};
    if (typeof args.name === "string") patch.name = args.name.trim();
    if (args.filters !== undefined)
      patch.filtersJson = JSON.stringify(args.filters);

    if (Object.keys(patch).length === 0) {
      return {
        id: args.id,
        name: existing.name,
        filters: parseJson<Record<string, unknown>>(existing.filtersJson, {}),
        changed: false,
      };
    }

    await db
      .update(schema.savedViews)
      .set(patch)
      .where(
        and(
          eq(schema.savedViews.id, args.id),
          eq(schema.savedViews.ownerEmail, ownerEmail),
        ),
      );

    await writeAppState("refresh-signal", { ts: Date.now() });

    const [updated] = await db
      .select()
      .from(schema.savedViews)
      .where(eq(schema.savedViews.id, args.id))
      .limit(1);

    return {
      id: args.id,
      name: updated?.name,
      filters: parseJson<Record<string, unknown>>(updated?.filtersJson, {}),
      changed: true,
    };
  },
});

void nanoid;
void parseSpaceIds;
void stringifySpaceIds;
void resolveDefaultWorkspaceId;
void readAppState;
void accessFilter;
void assertAccess;
