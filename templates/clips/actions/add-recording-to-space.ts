import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { parseSpaceIds, stringifySpaceIds } from "../server/lib/recordings.js";

export default defineAction({
  description:
    "Append or remove a space from a recording's space list. Use op='add' or op='remove'.",
  schema: z.object({
    recordingId: z.string().min(1).describe("Recording id"),
    spaceId: z.string().min(1).describe("Space id to add / remove"),
    op: z
      .enum(["add", "remove"])
      .default("add")
      .describe("Whether to add or remove the space"),
  }),
  run: async (args) => {
    await assertAccess("recording", args.recordingId, "editor");

    const db = getDb();
    const [row] = await db
      .select({ spaceIds: schema.recordings.spaceIds })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, args.recordingId));

    if (!row) {
      throw new Error(`Recording not found: ${args.recordingId}`);
    }

    const current = parseSpaceIds(row.spaceIds);
    let next: string[];
    if (args.op === "add") {
      next = current.includes(args.spaceId)
        ? current
        : [...current, args.spaceId];
    } else {
      next = current.filter((id) => id !== args.spaceId);
    }

    const now = new Date().toISOString();
    await db
      .update(schema.recordings)
      .set({ spaceIds: stringifySpaceIds(next), updatedAt: now })
      .where(eq(schema.recordings.id, args.recordingId));

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      id: args.recordingId,
      spaceIds: next,
    };
  },
});
