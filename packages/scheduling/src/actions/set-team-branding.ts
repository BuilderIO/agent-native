import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getSchedulingContext } from "../server/context.js";

export default defineAction({
  description: "Update a team's branding (name, logo, colors, bio)",
  schema: z.object({
    id: z.string(),
    name: z.string().optional(),
    logoUrl: z.string().nullable().optional(),
    brandColor: z.string().nullable().optional(),
    darkBrandColor: z.string().nullable().optional(),
    bio: z.string().nullable().optional(),
    hideBranding: z.boolean().optional(),
  }),
  run: async (args) => {
    const { getDb, schema } = getSchedulingContext();
    const { id, ...set } = args;
    await getDb()
      .update(schema.teams)
      .set({ ...set, updatedAt: new Date().toISOString() })
      .where(eq(schema.teams.id, id));
    return { ok: true };
  },
});
