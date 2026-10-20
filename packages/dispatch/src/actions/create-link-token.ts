import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { createLinkToken } from "../server/lib/dispatch-store.js";

export default defineAction({
  description:
    "Create a /link token so a Slack or Telegram user can bind to their personal dispatch identity.",
  schema: z.object({
    platform: z.enum(["slack", "telegram"]),
  }),
  // It creates, changes, or revokes a credential or who may use one: every
  // call needs the user's approval, and "always allow" is not offered.
  needsApproval: true,
  allowPersistentApproval: false,
  run: async ({ platform }) => createLinkToken(platform),
});
