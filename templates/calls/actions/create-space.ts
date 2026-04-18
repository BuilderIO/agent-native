/**
 * Create a new space inside a workspace.
 *
 * Usage:
 *   pnpm action create-space --workspaceId=<id> --name="Enterprise"
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
    "Create a new space inside a workspace. Spaces are topic-scoped sub-containers — calls can live in zero or more spaces.",
  schema: z.object({
    workspaceId: z.string().describe("Workspace id"),
    name: z.string().min(1).describe("Space name"),
    description: z
      .string()
      .optional()
      .describe(
        "Optional short description (not persisted on the row today — reserved for future use)",
      ),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{3,8}$/)
      .optional()
      .describe(
        "Hex color for the space chip — defaults to monochrome #111111",
      ),
    iconEmoji: z
      .string()
      .optional()
      .describe("Emoji glyph rendered next to the space name"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const db = getDb();
    const caller = getCurrentOwnerEmail();

    const [member] = await db
      .select()
      .from(schema.workspaceMembers)
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, args.workspaceId),
          eq(schema.workspaceMembers.email, caller),
        ),
      );
    if (!member) {
      const [ws] = await db
        .select()
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, args.workspaceId));
      if (!ws) throw new Error(`Workspace not found: ${args.workspaceId}`);
      if (ws.ownerEmail !== caller) {
        throw new Error("You do not have access to this workspace.");
      }
    }

    const id = nanoid();
    const now = new Date().toISOString();
    const color = args.color ?? "#111111";

    await db.insert(schema.spaces).values({
      id,
      workspaceId: args.workspaceId,
      name: args.name.trim(),
      color,
      iconEmoji: args.iconEmoji ?? null,
      createdAt: now,
    });

    await writeAppState("refresh-signal", { ts: Date.now() });
    console.log(`Created space "${args.name}" (${id})`);
    return {
      id,
      workspaceId: args.workspaceId,
      name: args.name.trim(),
      description: args.description ?? null,
      color,
      iconEmoji: args.iconEmoji ?? null,
      createdAt: now,
    };
  },
});

void parseSpaceIds;
void stringifySpaceIds;
void parseJson;
void resolveDefaultWorkspaceId;
void readAppState;
void accessFilter;
void assertAccess;
