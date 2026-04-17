/**
 * Create a new space inside a workspace.
 *
 * Usage:
 *   pnpm action create-space --workspaceId=<id> --name="Engineering" --color="#625DF5" --iconEmoji="⚙️"
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail, nanoid } from "../server/lib/recordings.js";

export default defineAction({
  description:
    "Create a new space inside a workspace. Spaces are topic-scoped sub-containers — recordings can live in zero or more spaces.",
  schema: z.object({
    workspaceId: z.string().describe("Workspace id"),
    name: z.string().min(1).describe("Space name"),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{3,8}$/)
      .optional()
      .describe("Hex color for the space chip"),
    iconEmoji: z
      .string()
      .optional()
      .describe("Emoji glyph rendered next to the space name"),
  }),
  run: async (args) => {
    const db = getDb();
    const caller = getCurrentOwnerEmail();
    // Validate caller has any relationship with this workspace (member or owner).
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
    await db.insert(schema.spaces).values({
      id,
      workspaceId: args.workspaceId,
      name: args.name.trim(),
      color: args.color ?? "#625DF5",
      iconEmoji: args.iconEmoji ?? null,
      createdAt: now,
    });

    await writeAppState("refresh-signal", { ts: Date.now() });
    console.log(`Created space "${args.name}" (${id})`);
    return {
      id,
      workspaceId: args.workspaceId,
      name: args.name.trim(),
      color: args.color ?? "#625DF5",
      iconEmoji: args.iconEmoji ?? null,
      createdAt: now,
    };
  },
});
