import { defineAction } from "@agent-native/core";
import { readAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description:
    "Return a summary of what the user is currently looking at on screen",
  schema: z.object({}),
  run: async () => {
    const navigation = (await readAppState("navigation")) ?? {};
    const bookerState = (await readAppState("booker-state")) ?? null;
    const eventTypeDraft = (await readAppState("event-type-draft")) ?? null;
    const scheduleDraft = (await readAppState("schedule-draft")) ?? null;
    return {
      navigation,
      bookerState,
      eventTypeDraft,
      scheduleDraft,
    };
  },
});
