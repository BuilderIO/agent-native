import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { createEventType } from "../server/event-types-repo.js";
import { currentUserEmail, currentOrgId } from "./_helpers.js";

export default defineAction({
  description: "Create a new event type",
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    length: z.coerce.number().default(30),
    description: z.string().optional(),
    teamId: z.string().optional(),
    schedulingType: z
      .enum(["personal", "collective", "round-robin", "managed"])
      .optional(),
    scheduleId: z.string().optional(),
    color: z.string().optional(),
  }),
  run: async (args) => {
    const ownerEmail = args.teamId ? undefined : currentUserEmail();
    return {
      eventType: await createEventType({
        ownerEmail,
        teamId: args.teamId,
        orgId: currentOrgId(),
        title: args.title,
        slug: args.slug.toLowerCase(),
        length: args.length,
        description: args.description,
        schedulingType: args.schedulingType,
        scheduleId: args.scheduleId,
        color: args.color,
      }),
    };
  },
});
