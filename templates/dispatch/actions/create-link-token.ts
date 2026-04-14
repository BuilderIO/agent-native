import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { createLinkToken } from "../server/lib/dispatch-store.js";

export default defineAction({
  description:
    "Create a /link token so a Slack or Telegram user can bind to their personal dispatch identity.",
  schema: z.object({
    platform: z.enum(["slack", "telegram"]),
  }),
  run: async ({ platform }) => createLinkToken(platform),
});
