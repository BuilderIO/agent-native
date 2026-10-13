import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

export default defineAction({
  description: "Return a local sample draft for AgentKit widget acceptance.",
  schema: z.object({
    action: z.literal("create"),
    subject: z.string(),
    to: z.string(),
  }),
  http: false,
  readOnly: true,
  run: async ({ subject, to }) => ({
    change: {
      verb: "created",
      kind: "email-draft",
      title: subject,
      detail: to,
      url: "/_agent-native/open?draftId=agentkit-sample",
    },
  }),
});
