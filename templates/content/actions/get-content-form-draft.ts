import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  contentFormDraftOrNoneSchema,
  contentFormLinkSchema,
} from "../shared/content-forms.js";
import { getContentFormDraft } from "./_content-form-drafts.js";

export default defineAction({
  description:
    "Read the signed-in person's unsent answers to a form, or null when they have none or it is more than 30 days old.",
  schema: z.object({ link: contentFormLinkSchema }),
  outputSchema: contentFormDraftOrNoneSchema,
  http: { method: "GET" },
  readOnly: true,
  agentTool: false,
  run: async (args, ctx) => getContentFormDraft(args, ctx),
});
