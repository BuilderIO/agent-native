/**
 * Create a new space inside an organization.
 *
 * Usage:
 *   pnpm action create-space --name="Engineering" --color="#18181B" --iconEmoji="⚙️"
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { nanoid, requireOrganizationAccess } from "../server/lib/recordings.js";

export default defineAction({
  description:
    "Create a new space inside the active organization. Spaces are topic-scoped sub-containers — recordings can live in zero or more spaces.",
  schema: z.object({
    organizationId: z
      .string()
      .optional()
      .describe("Organization id (defaults to the caller's active org)"),
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
    const { organizationId } = await requireOrganizationAccess(
      args.organizationId,
      ["admin"],
    );

    const id = nanoid();
    const now = new Date().toISOString();
    await db.insert(schema.spaces).values({
      id,
      organizationId,
      name: args.name.trim(),
      color: args.color ?? "#18181B",
      iconEmoji: args.iconEmoji ?? null,
      createdAt: now,
    });

    await writeAppState("refresh-signal", { ts: Date.now() });
    console.log(`Created space "${args.name}" (${id})`);
    return {
      id,
      organizationId,
      name: args.name.trim(),
      color: args.color ?? "#18181B",
      iconEmoji: args.iconEmoji ?? null,
      createdAt: now,
    };
  },
});
