import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { writeAppStateForCurrentTab } from "./_tab-state.js";

export default defineAction({
  description:
    "Navigate the UI to a specific deck, slide, or view. Writes a navigate command to application state which the UI reads and auto-deletes.",
  schema: z.object({
    view: z
      .enum(["list", "editor", "present"])
      .optional()
      .describe("Top-level view to navigate to (list, editor, present)"),
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
    const nav: Record<string, string | number> = {};
    if (args.view) nav.view = args.view;
    if (args.deckId) nav.deckId = args.deckId;
    const internalSlideIndex =
      args.slideNumber != null ? args.slideNumber - 1 : args.slideIndex;
    if (internalSlideIndex != null) nav.slideIndex = internalSlideIndex;
    // Unique-per-write token so the UI's `use-navigation-state` hook can
    // dedup race-driven re-reads of the same command (see that hook for the
    // full reasoning).
    nav._writeId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await writeAppStateForCurrentTab("navigate", nav);
    return `Navigating to ${args.view || ""}${args.deckId ? ` deck:${args.deckId}` : ""}${internalSlideIndex != null ? ` slide:${internalSlideIndex + 1}` : ""}`;
  },
});
