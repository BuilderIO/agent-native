import { defineAction } from "@agent-native/core";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { nanoid } from "../server/lib/recordings.js";

export default defineAction({
  description:
    "Add or remove a tag on a recording. Use op='add' or op='remove'.",
  schema: z.object({
    recordingId: z.string().min(1).describe("Recording id"),
    tag: z.string().min(1).max(64).describe("Tag text"),
    op: z.enum(["add", "remove"]).default("add").describe("Add or remove"),
  }),
  run: async (args) => {
    await assertAccess("recording", args.recordingId, "editor");

    const db = getDb();

    const [rec] = await db
      .select({ workspaceId: schema.recordings.workspaceId })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, args.recordingId));
    if (!rec) {
      throw new Error(`Recording not found: ${args.recordingId}`);
    }

    if (args.op === "add") {
      // De-dup — only insert if not already present
      const [existing] = await db
        .select()
        .from(schema.recordingTags)
        .where(
          and(
            eq(schema.recordingTags.recordingId, args.recordingId),
            eq(schema.recordingTags.tag, args.tag),
          ),
        );
      if (!existing) {
        await db.insert(schema.recordingTags).values({
          id: nanoid(),
          recordingId: args.recordingId,
          workspaceId: rec.workspaceId,
          tag: args.tag,
        });
      }
    } else {
      await db
        .delete(schema.recordingTags)
        .where(
          and(
            eq(schema.recordingTags.recordingId, args.recordingId),
            eq(schema.recordingTags.tag, args.tag),
          ),
        );
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    // Return current tag set
    const tags = await db
      .select({ tag: schema.recordingTags.tag })
      .from(schema.recordingTags)
      .where(eq(schema.recordingTags.recordingId, args.recordingId));

    return {
      id: args.recordingId,
      tags: tags.map((t) => t.tag),
    };
  },
});
