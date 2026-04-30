import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";

export default defineAction({
  description: "Update a call-to-action button on a recording.",
  schema: z.object({
    id: z.string().describe("CTA ID"),
    label: z.string().min(1).optional(),
    url: z.string().url().optional(),
    color: z.string().optional(),
    placement: z.enum(["end", "throughout"]).optional(),
  }),
  run: async (args) => {
    const db = getDb();

    const [existing] = await db
      .select()
      .from(schema.recordingCtas)
      .where(eq(schema.recordingCtas.id, args.id))
      .limit(1);
    if (!existing) throw new Error(`CTA not found: ${args.id}`);
    await assertAccess("recording", existing.recordingId, "editor");

    const patch: Record<string, unknown> = {};
    if (args.label !== undefined) patch.label = args.label;
    if (args.url !== undefined) patch.url = args.url;
    if (args.color !== undefined) patch.color = args.color;
    if (args.placement !== undefined) patch.placement = args.placement;

    if (Object.keys(patch).length > 0) {
      await db
        .update(schema.recordingCtas)
        .set(patch)
        .where(eq(schema.recordingCtas.id, args.id));
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    return { id: args.id };
  },
});
