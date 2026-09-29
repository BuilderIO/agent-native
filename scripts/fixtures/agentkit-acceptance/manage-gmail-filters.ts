import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

export default defineAction({
  description: "Return a local sample Gmail filter for widget acceptance.",
  schema: z.object({
    operation: z.literal("create"),
    sender: z.string(),
    label: z.string(),
  }),
  http: false,
  readOnly: true,
  run: async ({ sender, label }) => ({
    ok: true,
    message: "Created sample filter",
    accountEmail: "agentkit-mail@example.test",
    filter: {
      id: "agentkit-sample-filter",
      criteriaSummary: `From: ${sender}`,
      actionSummary: `Apply label: ${label}`,
    },
    change: {
      verb: "created",
      kind: "gmail-filter",
      title: `From: ${sender}`,
      detail: `Apply label: ${label}`,
      url: "https://mail.google.com/mail/?authuser=agentkit-mail%40example.test#settings/filters",
    },
  }),
});
