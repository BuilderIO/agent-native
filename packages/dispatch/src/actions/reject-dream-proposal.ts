import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { rejectDreamProposal } from "../server/lib/dreams-store.js";

export default defineAction({
  description: "Reject one pending Dispatch dream proposal.",
  schema: z.object({
    id: z.string().min(1).describe("Dream proposal id."),
    reason: z.string().optional().describe("Optional rejection reason."),
  }),
  run: async ({ id, reason }) => rejectDreamProposal(id, reason),
});
