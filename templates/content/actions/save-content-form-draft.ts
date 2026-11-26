import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  contentFormAnswersSchema,
  contentFormDraftSchema,
  contentFormLinkSchema,
} from "../shared/content-forms.js";
import { saveContentFormDraft } from "./_content-form-drafts.js";

export default defineAction({
  description:
    "Keep the signed-in person's unsent answers to a form so they can finish on another device. Replaces their earlier draft of that form; a draft never becomes a record and is deleted 30 days after its last change.",
  schema: z.object({
    link: contentFormLinkSchema,
    answers: contentFormAnswersSchema,
  }),
  outputSchema: contentFormDraftSchema,
  http: { method: "POST" },
  agentTool: false,
  maxBodyBytes: 256 * 1024,
  audit: { enabled: false },
  run: async (args, ctx) => saveContentFormDraft(args, ctx),
});
