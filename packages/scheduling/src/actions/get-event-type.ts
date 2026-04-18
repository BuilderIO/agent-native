import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  getEventTypeById,
  getEventTypeBySlug,
} from "../server/event-types-repo.js";

export default defineAction({
  description: "Get a single event type by id or (owner+slug)",
  schema: z.object({
    id: z.string().optional(),
    slug: z.string().optional(),
    ownerEmail: z.string().optional(),
    teamId: z.string().optional(),
  }),
  run: async (args) => {
    if (args.id) return { eventType: await getEventTypeById(args.id) };
    if (args.slug) {
      return {
        eventType: await getEventTypeBySlug({
          slug: args.slug,
          ownerEmail: args.ownerEmail,
          teamId: args.teamId,
        }),
      };
    }
    throw new Error("Provide id or slug");
  },
});
