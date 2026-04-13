import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { approveRequest } from "../server/lib/dispatcher-store.js";

export default defineAction({
  description: "Approve a pending dispatcher change request and apply it.",
  schema: z.object({
    id: z.string().describe("Approval request id"),
  }),
  run: async ({ id }) => approveRequest(id),
});
