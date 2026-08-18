import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  automationResponse,
  findAutomation,
  requireOwnerEmail,
} from "../server/lib/email-automation.js";

export default defineAction({
  description:
    "Read the current daily digest automation configuration for the signed-in user.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const ownerEmail = requireOwnerEmail();
    return automationResponse(await findAutomation(ownerEmail));
  },
});
