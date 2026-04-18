import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { nanoid } from "nanoid";
import { getSchedulingContext } from "../server/context.js";
import { currentUserEmail, currentOrgId } from "./_helpers.js";

export default defineAction({
  description: "Create a new team",
  schema: z.object({
    name: z.string(),
    slug: z.string(),
    bio: z.string().optional(),
  }),
  run: async (args) => {
    const { getDb, schema } = getSchedulingContext();
    const id = nanoid();
    const now = new Date().toISOString();
    const ownerEmail = currentUserEmail();
    await getDb()
      .insert(schema.teams)
      .values({
        id,
        slug: args.slug.toLowerCase(),
        name: args.name,
        bio: args.bio ?? null,
        hideBranding: false,
        createdAt: now,
        updatedAt: now,
        ownerEmail,
        orgId: currentOrgId() ?? null,
      });
    // Owner is automatically a member with owner role
    await getDb().insert(schema.teamMembers).values({
      id: nanoid(),
      teamId: id,
      userEmail: ownerEmail,
      role: "owner",
      accepted: true,
      invitedAt: now,
      joinedAt: now,
    });
    return { team: { id, slug: args.slug, name: args.name } };
  },
});
