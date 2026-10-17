import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { writeAppStateForCurrentTab } from "./_tab-state.js";

export default defineAction({
  title: "Navigate Slides",
  description:
    "Navigate the UI to a specific deck, slide, or view. Writes a navigate command to application state which the UI reads and auto-deletes.",
  schema: z.object({
    view: z
      .enum(["list", "editor", "present", "templates"])
      .optional()
      .describe(
        "Top-level view to navigate to (list, editor, present, templates)",
      ),
    templateId: z
      .string()
      .max(200)
      .optional()
      .describe("Template to preview in the templates view"),
    search: z
      .string()
      .max(200)
      .optional()
      .describe("Search text for the templates view"),
    deckId: z.string().optional().describe("Deck ID to open in the editor"),
    slideNumber: z.coerce
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        "User-visible slide number to jump to (1-based, matching the UI). Prefer this when the user says 'slide N'. Slide 1 is the first slide.",
      ),
    slideIndex: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "Deprecated/internal zero-based slide index. Prefer slideNumber for user-visible slide references.",
      ),
  }),
  http: false,
  run: async (args) => {
    if (!args.view && !args.deckId) {
      throw new Error("At least --view or --deckId is required.");
    }
    if (
      args.view === "templates" &&
      (args.deckId || args.slideNumber != null || args.slideIndex != null)
    ) {
      throw new Error("The templates view cannot target a deck or slide.");
    }
    if ((args.templateId || args.search) && args.view !== "templates") {
      throw new Error(
        "Template selection and search require the templates view.",
      );
    }
    const nav: Record<string, string | number> = {};
    if (args.view) nav.view = args.view;
    if (args.deckId) nav.deckId = args.deckId;
    if (args.templateId) nav.templateId = args.templateId;
    if (args.search) nav.search = args.search;
    const internalSlideIndex =
      args.slideNumber != null ? args.slideNumber - 1 : args.slideIndex;
    if (internalSlideIndex != null) nav.slideIndex = internalSlideIndex;
    nav._writeId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await writeAppStateForCurrentTab("navigate", nav);
    return `Navigating to ${args.view || ""}${args.deckId ? ` deck:${args.deckId}` : ""}${internalSlideIndex != null ? ` slide:${internalSlideIndex + 1}` : ""}`;
  },
});
