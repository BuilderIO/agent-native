import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { upsertDestination } from "../server/lib/dispatch-store.js";

export default defineAction({
  description:
    "Create or update a saved messaging destination for proactive Slack or Telegram sends.",
  schema: z.object({
    id: z.string().optional(),
    name: z.string().describe("Friendly destination name"),
    platform: z.enum(["slack", "telegram"]).describe("Destination platform"),
    destination: z
      .string()
      .describe("Channel ID, chat ID, or other platform destination id"),
    threadRef: z
      .string()
      .optional()
      .describe("Optional thread or topic reference"),
    notes: z
      .string()
      .optional()
      .describe("Optional notes about this destination"),
  }),
  run: async (args) => upsertDestination(args),
});
