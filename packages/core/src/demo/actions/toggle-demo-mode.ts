import { z } from "zod";

import { defineAction } from "../../action.js";
import { writeAppState } from "../../application-state/script-helpers.js";

export default defineAction({
  description:
    "Turn demo mode on or off. When demo mode is on, the app replaces contact/free-text names, email addresses, and numbers with realistic fake data everywhere — in the UI and in what you (the agent) see — while keeping labels, IDs, dates, and structure intact so everything still works. Use when the user asks to 'hide my data', 'turn on demo mode', 'anonymize this for a screen share / recording', or similar. This is the same toggle as the Demo mode switch in settings.",
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
        ? "Demo mode is ON — contact/free-text names, emails, and numbers are now replaced with deterministic fake data everywhere (UI and agent). Labels, IDs, and structure are preserved so everything keeps working."
        : "Demo mode is OFF — real data is shown again.",
    };
  },
});
