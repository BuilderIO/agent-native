import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

export default defineAction({
  description: "Return a local sample draft for AgentKit widget acceptance.",
  schema: z.object({
    action: z.literal("create"),
    subject: z.string(),
    to: z.string(),
  }),
  chatUI: { renderer: "mail.draft-created", title: "Mail draft" },
  http: false,
  readOnly: true,
  run: async ({ subject, to }) => ({
    draft: { subject, to },
    deepLink:
      "https://mail.agent-native.com/_agent-native/open?draftId=agentkit-sample",
  }),
});
