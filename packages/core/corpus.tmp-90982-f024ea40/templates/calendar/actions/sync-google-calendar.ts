import { defineAction } from "@agent-native/core";
import { z } from "zod";

export default defineAction({
  description:
    "Google Calendar sync is no longer needed. Events are read directly from the Google Calendar API. Use list-events or create-event instead.",
  schema: z.object({}),
  http: false,
  run: async () => {
    return "The sync-google-calendar action is no longer needed. Events are now read directly from the Google Calendar API. Use list-events, create-event, or check-availability instead.";
  },
});
