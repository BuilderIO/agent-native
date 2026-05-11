import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description:
    "Navigate the UI to a specific deck, slide, or view. Writes a navigate command to application state which the UI reads and auto-deletes.",
  schema: z.object({
    view: z
      .string()
      .optional()
      .describe("Top-level view to navigate to (list, settings)"),
    deckId: z.string().optional().describe("Deck ID to open in the editor"),
    slideIndex: z.coerce
      .number()
      .optional()
      .describe("Slide index to jump to (0-based)"),
  }),
  http: false,
  run: async (args) => {
    if (!args.view && !args.deckId) {
      return "Error: At least --view or --deckId is required.";
    }
    const nav: Record<string, string | number> = {};
    if (args.view) nav.view = args.view;
    if (args.deckId) nav.deckId = args.deckId;
    if (args.slideIndex != null) nav.slideIndex = args.slideIndex;
    // Unique-per-write token so the UI's `use-navigation-state` hook can
    // dedup race-driven re-reads of the same command (see that hook for the
    // full reasoning).
    nav._writeId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await writeAppState("navigate", nav);
    return `Navigating to ${args.view || ""}${args.deckId ? ` deck:${args.deckId}` : ""}${args.slideIndex != null ? ` slide:${args.slideIndex}` : ""}`;
  },
});
