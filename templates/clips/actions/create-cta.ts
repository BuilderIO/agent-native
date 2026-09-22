import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { nanoid } from "../server/lib/recordings.js";
import { ctaUrlSchema } from "./lib/cta-url.js";

export default defineAction({
  description: "Add a call-to-action button to a recording.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
    label: z.string().min(1).describe("Button label"),
    url: ctaUrlSchema.describe("Button URL"),
    color: z.string().optional().describe("Button color (CSS color)"),
    placement: z
      .enum(["end", "throughout"])
      .optional()
      .describe("When to show the button"),
  }),
  run: async (args) => {
    const db = getDb();
    await assertAccess("recording", args.recordingId, "editor");

    const [recording] = await db
      .select({
        id: schema.recordings.id,
        updatedAt: schema.recordings.updatedAt,
      })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, args.recordingId))
      .limit(1);
    if (!recording) throw new Error(`Recording not found: ${args.recordingId}`);

    const id = nanoid();
    await db.transaction(async (tx) => {
      // Lock the parent row before checking the one-CTA invariant. This keeps
      // simultaneous UI and agent calls serialized on both SQLite and
      // PostgreSQL without adding a destructive migration for legacy data.
      await tx
        .update(schema.recordings)
        .set({ updatedAt: recording.updatedAt })
        .where(eq(schema.recordings.id, args.recordingId));

      const [existingCta] = await tx
        .select({ id: schema.recordingCtas.id })
        .from(schema.recordingCtas)
        .where(eq(schema.recordingCtas.recordingId, args.recordingId))
        .limit(1);
      if (existingCta) {
        throw new Error("This recording already has a call to action.");
      }

      await tx.insert(schema.recordingCtas).values({
        id,
        recordingId: args.recordingId,
        label: args.label,
        url: args.url,
        color:
          args.color ??
          "#18181B" /* guard:allow-raw-color — persisted CTA fallback retained for legacy compatibility. */,
        placement: args.placement ?? "throughout",
      });
    });

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Created CTA ${id} for recording ${args.recordingId}`);
    return { id, recordingId: args.recordingId };
  },
});
