import { z } from "zod";

import { defineAction } from "../../action.js";
import { writeAppState } from "../../application-state/script-helpers.js";

export default defineAction({
  description:
    "Turn demo mode on or off. When demo mode is on, the UI replaces every email address with anonymous@builder.io and supported dashboards reshape chart values for presentations. Agent-visible results use the same anonymous email and anonymize numbers while keeping names, free text, labels, IDs, dates, and structure intact. Use when the user asks to 'hide my data', 'turn on demo mode', 'anonymize this for a screen share / recording', or similar. This is the same toggle as the Demo mode switch in settings.",
  schema: z.object({
    enabled: z
      .boolean()
      .describe("true to turn demo mode on, false to turn it off."),
  }),
  run: async ({ enabled }) => {
    await writeAppState("demo-mode", { enabled });
    return {
      enabled,
      message: enabled
        ? "Demo mode is ON — UI emails are anonymized and supported dashboard charts are reshaped for presentation. Agent-visible emails and numbers are also anonymized. Names, free text, labels, IDs, and structure are preserved."
        : "Demo mode is OFF — real data is shown again.",
    };
  },
});
