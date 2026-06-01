/**
 * Rename a folder.
 *
 * Usage:
 *   pnpm action rename-folder --id=<id> --name="Closed won"
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail } from "../server/lib/calls.js";
import { writeAppState } from "@agent-native/core/application-state";

export default defineAction({
  description: "Rename a folder.",
  schema: z.object({
    id: z.string().min(1).describe("Folder id"),
    name: z.string().min(1).describe("New folder name"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();

    const [existing] = await db
      .select()
      .from(schema.folders)
      .where(
        and(
          eq(schema.folders.id, args.id),
          eq(schema.folders.ownerEmail, ownerEmail),
        ),
      )
      .limit(1);
    if (!existing) throw new Error(`Folder not found: ${args.id}`);

    await db
      .update(schema.folders)
      .set({ name: args.name })
      .where(
        and(
          eq(schema.folders.id, args.id),
          eq(schema.folders.ownerEmail, ownerEmail),
        ),
      );

    await writeAppState("refresh-signal", { ts: Date.now() });
    return { id: args.id, name: args.name };
  },
});
