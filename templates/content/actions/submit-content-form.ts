import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  CONTENT_FORM_IDEMPOTENCY_KEY_MAX_LENGTH,
  CONTENT_FORM_IDEMPOTENCY_KEY_MIN_LENGTH,
  contentFormAnswersSchema,
  contentFormLinkSchema,
  contentFormSubmitResultSchema,
} from "../shared/content-forms.js";
import { submitContentFormByLink } from "./_content-forms.js";

export default defineAction({
  description:
    "Send your person's answers to a Content form you read with get-content-form, after they have seen every answer and said yes. Pass the form's link, one { question, value } entry per answered question (question is the key from get-content-form), and a new random idempotencyKey for this submission. If anything is wrong, nothing is saved and outcome is needs_changes with every problem at once: ask about just those, then send all the answers again with the same key. outcome submitted returns the receipt: the values saved, the record's ID and link, the form's thank-you message, and whether the answers were recorded anonymously or as your signed-in person, which follows the form's setting. Resending the same key and answers returns that receipt again without a second record.",
  schema: z.object({
    link: contentFormLinkSchema,
    idempotencyKey: z
      .string()
      .min(CONTENT_FORM_IDEMPOTENCY_KEY_MIN_LENGTH)
      .max(CONTENT_FORM_IDEMPOTENCY_KEY_MAX_LENGTH)
      .describe(
        "A new random key, such as a UUID, for this submission; reuse it only to resend the same submission",
      ),
    answers: contentFormAnswersSchema.describe(
      "One entry per answered question; leave out questions your person skipped",
    ),
  }),
  outputSchema: contentFormSubmitResultSchema,
  http: { method: "POST" },
  requiresAuth: false,
  mcpTool: true,
  maxBodyBytes: 256 * 1024,
  audit: { enabled: false },
  changeEvents: false,
  run: async (args, ctx) => submitContentFormByLink(args, ctx),
});
