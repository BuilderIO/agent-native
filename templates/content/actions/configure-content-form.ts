import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  CONTENT_FORM_AUDIENCES,
  CONTENT_FORM_THANK_YOU_MAX_LENGTH,
  contentFormSettingsSchema,
} from "../shared/content-forms.js";
import { configureContentForm } from "./_content-forms.js";

export default defineAction({
  description:
    "Set up or change the form behind one Form view of a Content collection: who may answer through its link (anonymous, signed_in, or organization for signed-in members of the collection's organization), whether it is accepting answers, one answer per person (signed-in forms only), the thank-you message, and the form's page. The first call creates the form's link; rotateLink replaces it so the old link stops working. Needs edit access to the collection. Returns the settings and the link.",
  schema: z.object({
    databaseId: z.string().min(1).describe("Content collection ID"),
    viewId: z.string().min(1).describe("The collection's Form view ID"),
    audience: z
      .enum(CONTENT_FORM_AUDIENCES)
      .optional()
      .describe("Who may answer through the link"),
    acceptingAnswers: z.boolean().optional(),
    oneAnswerPerPerson: z
      .boolean()
      .optional()
      .describe("Allow one submission per signed-in person"),
    thankYouMessage: z
      .string()
      .max(CONTENT_FORM_THANK_YOU_MAX_LENGTH)
      .optional()
      .describe("Shown to the sender after their answers are saved"),
    canvasDocumentId: z
      .string()
      .min(1)
      .nullable()
      .optional()
      .describe(
        "A page inside the collection whose question blocks make the form; null goes back to the Form view's question list",
      ),
    rotateLink: z
      .boolean()
      .optional()
      .describe("Replace the link; the old link stops working"),
  }),
  outputSchema: contentFormSettingsSchema,
  mcpTool: "search",
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async (args, ctx) => configureContentForm(args, ctx),
});
