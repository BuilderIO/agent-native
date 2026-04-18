import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { nanoid } from "nanoid";
import { getSchedulingContext } from "../server/context.js";
import { currentUserEmail, currentOrgId } from "./_helpers.js";

export default defineAction({
  description: "Create a routing form",
  schema: z.object({
    name: z.string(),
    description: z.string().optional(),
    teamId: z.string().optional(),
    fields: z.array(z.any()).default([]),
    rules: z.array(z.any()).default([]),
    fallback: z.any().optional(),
  }),
  run: async (args) => {
    const { getDb, schema } = getSchedulingContext();
    const id = nanoid();
    const now = new Date().toISOString();
    await getDb()
      .insert(schema.routingForms)
      .values({
        id,
        name: args.name,
        description: args.description ?? null,
        teamId: args.teamId ?? null,
        disabled: false,
        fields: JSON.stringify(args.fields),
        rules: JSON.stringify(args.rules),
        fallback: args.fallback ? JSON.stringify(args.fallback) : null,
        ownerEmail: args.teamId ? null : currentUserEmail(),
        orgId: currentOrgId() ?? null,
        createdAt: now,
        updatedAt: now,
      });
    return { id };
  },
});
