import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { listDestinations } from "../server/lib/dispatcher-store.js";

export default defineAction({
  description: "List saved Slack and Telegram destinations for the dispatcher.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => listDestinations(),
});
