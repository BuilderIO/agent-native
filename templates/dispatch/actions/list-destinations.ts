import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { listDestinations } from "../server/lib/dispatch-store.js";

export default defineAction({
  description: "List saved Slack and Telegram destinations for the dispatch.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => listDestinations(),
});
