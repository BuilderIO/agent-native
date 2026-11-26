import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  contentFormLinkSchema,
  contentFormReadSchema,
} from "../shared/content-forms.js";
import { readContentFormByLink } from "./_content-forms.js";

export default defineAction({
  description:
    "Read a Content form from its link (https://<content app>/form/<token>, or just the token) so you can fill it in for your person. Returns the form's title, its page text, and each question's key, wording, help, placeholder, whether it's required, answer type and choices, plus a JSON Schema for the answers, whether you may submit, how you'd be recorded (anonymous or as your signed-in person), and what your person already sent to it. Ask your person only for answers they haven't given, in the form's own words; for a choice, use one of the listed labels. Show them every answer and get a yes, then send them with submit-content-form. A form link shows only the form, never the collection behind it.",
  schema: z.object({ link: contentFormLinkSchema }),
  outputSchema: contentFormReadSchema,
  http: { method: "GET" },
  readOnly: true,
  requiresAuth: false,
  mcpTool: true,
  run: async ({ link }, ctx) => readContentFormByLink(link, ctx),
});
