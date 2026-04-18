/**
 * Rename a space (and optionally update its color / emoji).
 *
 * Usage:
 *   pnpm action rename-space --id=<id> --name="Enterprise"
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
import {
  writeAppState,
  readAppState,
} from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Rename a space and optionally change its color or emoji. A no-op when no fields are provided.",
  schema: z.object({
    id: z.string().describe("Space id"),
    name: z.string().min(1).optional().describe("New name"),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{3,8}$/)
      .optional()
      .describe("New hex color"),
    iconEmoji: z
      .string()
      .nullish()
      .describe("New emoji glyph — pass null to clear"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const db = getDb();
    const [existing] = await db
      .select()
      .from(schema.spaces)
      .where(eq(schema.spaces.id, args.id))
      .limit(1);
    if (!existing) throw new Error(`Space not found: ${args.id}`);

    const patch: Record<string, unknown> = {};
    if (typeof args.name === "string") patch.name = args.name.trim();
    if (typeof args.color === "string") patch.color = args.color;
    if (args.iconEmoji !== undefined) patch.iconEmoji = args.iconEmoji ?? null;

    if (Object.keys(patch).length === 0) {
      return {
        id: args.id,
        name: existing.name,
        color: existing.color,
        iconEmoji: existing.iconEmoji,
        changed: false,
      };
    }

    await db
      .update(schema.spaces)
      .set(patch)
      .where(eq(schema.spaces.id, args.id));
    await writeAppState("refresh-signal", { ts: Date.now() });

    const [updated] = await db
      .select()
      .from(schema.spaces)
      .where(eq(schema.spaces.id, args.id))
      .limit(1);

    console.log(`Renamed space ${args.id}`);
    return {
      id: args.id,
      name: updated?.name,
      color: updated?.color,
      iconEmoji: updated?.iconEmoji,
      changed: true,
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
