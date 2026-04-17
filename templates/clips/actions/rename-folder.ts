import { defineAction } from "@agent-native/core";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { writeAppState } from "@agent-native/core/application-state";
import { getCurrentOwnerEmail } from "../server/lib/recordings.js";

export default defineAction({
  description: "Rename a folder.",
  schema: z.object({
    id: z.string().min(1).describe("Folder id"),
    name: z.string().min(1).describe("New folder name"),
  }),
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
      );

    if (!existing) {
      throw new Error(`Folder not found: ${args.id}`);
    }

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
