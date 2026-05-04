import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { rejectRequest } from "../server/lib/dispatch-store.js";

export default defineAction({
  description: "Reject a pending dispatch change request.",
  schema: z.object({
    id: z.string().describe("Approval request id"),
    reason: z.string().optional().describe("Optional rejection reason"),
  }),
  run: async ({ id, reason }) => rejectRequest(id, reason),
});
