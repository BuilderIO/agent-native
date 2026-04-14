import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { denyRequest } from "../server/lib/vault-store.js";

export default defineAction({
  description: "Deny a pending vault secret request. Admin only.",
  schema: z.object({
    id: z.string().describe("Request ID to deny"),
    reason: z.string().optional().describe("Reason for denial"),
  }),
  run: async (args) => denyRequest(args.id, args.reason),
});
