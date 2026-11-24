import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { addSplit } from "../server/lib/add-split.js";

export default defineAction({
  description:
    "Add a split: a named inbox view filled by an AI rule. Splits only match mail written by a person, never noreply, notification, or bot senders, so describe the topic or relationship, not specific senders. Returns the existing split when one with the same name exists. Backfills recent mail and reports the backfill status.",
  schema: z.object({
    name: z.string().describe("Split name, also its label"),
    condition: z
      .string()
      .describe("Natural-language description of what belongs in the split"),
    backfill: z
      .boolean()
      .optional()
      .describe("Apply the split to recent mail (default true)"),
  }),
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Unauthenticated");
    return addSplit(ownerEmail, args);
  },
});
