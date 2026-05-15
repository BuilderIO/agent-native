import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { applyDreamProposal } from "../server/lib/dreams-store.js";

export default defineAction({
  description:
    "Apply one pending Dispatch dream proposal. Supports personal memory and shared LEARNINGS.md proposals only.",
  schema: z.object({
    id: z.string().min(1).describe("Dream proposal id."),
  }),
  run: async ({ id }) => applyDreamProposal(id),
});
