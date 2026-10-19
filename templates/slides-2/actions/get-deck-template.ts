import { defineAction, fail } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { z } from "zod";

import { getBuiltInDeckTemplate } from "../server/lib/deck-templates.js";

export default defineAction({
  description:
    "Read a built-in deck template's complete editable slide HTML and speaker notes. This does not create a deck; use create-deck-from-template to save an independent copy without AI generation.",
  schema: z.object({
    id: z
      .string()
      .min(1)
      .max(100)
      .describe("Built-in ID from list-deck-templates"),
  }),
  http: { method: "GET" },
  readOnly: true,
  link: ({ args }) => ({
    url: buildDeepLink({
      app: "slides-2",
      view: "templates",
      params: { templateId: args.id },
    }),
    label: "Preview template in Slides 2",
    view: "templates",
  }),
  run: async ({ id }) => {
    const template = getBuiltInDeckTemplate(id);
    if (!template) {
      fail("Deck template not found.", {
        errorCode: "deck_template_not_found",
        statusCode: 404,
      });
    }
    return { ...template, slideCount: template.slides.length };
  },
});
