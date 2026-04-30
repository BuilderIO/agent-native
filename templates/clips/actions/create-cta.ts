import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { nanoid, getCurrentOwnerEmail } from "../server/lib/recordings.js";
import { writeAppState } from "@agent-native/core/application-state";

export default defineAction({
  description: "Add a call-to-action button to a recording.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
    label: z.string().min(1).describe("Button label"),
    url: z.string().url().describe("Button URL"),
    color: z.string().optional().describe("Button color (CSS color)"),
    placement: z
      .enum(["end", "throughout"])
      .optional()
      .describe("When to show the button"),
  }),
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();

    const [recording] = await db
      .select({ id: schema.recordings.id })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, args.recordingId))
      .limit(1);
    if (!recording) throw new Error(`Recording not found: ${args.recordingId}`);

    const id = nanoid();
    await db.insert(schema.recordingCtas).values({
      id,
      recordingId: args.recordingId,
      label: args.label,
      url: args.url,
      color: args.color ?? "#18181B",
      placement: args.placement ?? "throughout",
    });

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Created CTA ${id} for recording ${args.recordingId}`);
    return { id, recordingId: args.recordingId };
  },
});
