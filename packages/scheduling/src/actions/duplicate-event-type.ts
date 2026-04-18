import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  getEventTypeById,
  createEventType,
} from "../server/event-types-repo.js";
import { currentUserEmail, currentOrgId } from "./_helpers.js";

export default defineAction({
  description: "Duplicate an event type with a new slug",
  schema: z.object({
    id: z.string(),
    newSlug: z.string(),
    newTitle: z.string().optional(),
  }),
  run: async (args) => {
    const source = await getEventTypeById(args.id);
    if (!source) throw new Error("Event type not found");
    return {
      eventType: await createEventType({
        ownerEmail: source.teamId ? undefined : currentUserEmail(),
        teamId: source.teamId,
        orgId: currentOrgId(),
        title: args.newTitle ?? `${source.title} (copy)`,
        slug: args.newSlug.toLowerCase(),
        length: source.length,
        description: source.description,
        schedulingType: source.schedulingType,
        locations: source.locations,
        customFields: source.customFields,
        scheduleId: source.scheduleId,
        color: source.color,
      }),
    };
  },
});
