import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { previewDreamProposal } from "../server/lib/dreams-store.js";

export default defineAction({
  description:
    "Preview one Dispatch dream proposal before applying it, including target, current content, proposed content, and approval behavior.",
  schema: z.object({
    id: z.string().min(1).describe("Dream proposal id."),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ id }) => previewDreamProposal(id),
});
