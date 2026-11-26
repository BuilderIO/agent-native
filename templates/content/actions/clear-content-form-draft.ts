import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { contentFormLinkSchema } from "../shared/content-forms.js";
import { clearContentFormDraft } from "./_content-form-drafts.js";

export default defineAction({
  description:
    "Delete the signed-in person's unsent answers to a form. Sending the form clears them too.",
  schema: z.object({ link: contentFormLinkSchema }),
  outputSchema: z.object({ cleared: z.literal(true) }),
  http: { method: "POST" },
  agentTool: false,
  audit: { enabled: false },
  changeEvents: false,
  run: async (args, ctx) => clearContentFormDraft(args, ctx),
});
