import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { appStateKey } from "../shared/app-state-tabs.js";
import { writeAppStateForCurrentTab } from "./_tab-state.js";

export default defineAction({
  title: "Navigate Slides",
  description:
    "Navigate the UI to a specific deck, slide, or view, including the slide themes gallery or a selected theme. On the Home list, choose the recent or templates tab and optionally search decks. Writes a navigate command to application state which the UI reads and auto-deletes.",
  schema: z.object({
    view: z
      .enum(["list", "editor", "present", "templates", "themes"])
      .optional()
      .describe(
        "Top-level view to navigate to (list, editor, present, templates, themes)",
      ),
    templateId: z
      .string()
      .max(200)
      .optional()
      .describe("Template to preview in the templates view"),
    themeId: z
      .string()
      .max(100)
      .optional()
      .describe("Built-in slide theme to open in the themes view"),
    search: z
      .string()
      .max(200)
      .optional()
      .describe("Search text for the templates view"),
    homeTab: z
      .enum(["recent", "templates"])
      .optional()
      .describe("Home library tab to show on the deck list"),
    deckSearch: z
      .string()
      .max(200)
      .optional()
      .describe("Search text for decks on the Home recent tab"),
    deckFilter: z
      .enum(["all", "created-by-me", "shared"])
      .optional()
      .describe("Ownership filter for the Home recent deck list"),
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
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (args) => {
    if (!args.view && !args.deckId) {
      fail("At least --view or --deckId is required.", {
        errorCode: "navigation_target_required",
      });
    }
    if ((args.view === "editor" || args.view === "present") && !args.deckId) {
      fail("The editor and present views require a deckId.", {
        errorCode: "deck_id_required",
      });
    }
    if (
      args.view === "list" &&
      (args.deckId || args.slideNumber != null || args.slideIndex != null)
    ) {
      fail("The Home list view cannot target a deck or slide.", {
        errorCode: "invalid_home_navigation",
      });
    }
    if (
      args.view === "templates" &&
      (args.deckId || args.slideNumber != null || args.slideIndex != null)
    ) {
      fail("The templates view cannot target a deck or slide.", {
        errorCode: "invalid_template_navigation",
      });
    }
    if ((args.templateId || args.search) && args.view !== "templates") {
      fail("Template selection and search require the templates view.", {
        errorCode: "invalid_template_navigation",
      });
    }
    if (args.themeId && args.view !== "themes") {
      fail("Theme selection requires the themes view.", {
        errorCode: "invalid_theme_navigation",
      });
    }
    if (
      args.view === "themes" &&
      (args.deckId || args.slideNumber != null || args.slideIndex != null)
    ) {
      fail("The themes view cannot target a deck or slide.", {
        errorCode: "invalid_theme_navigation",
      });
    }
    if (
      (args.homeTab || args.deckSearch || args.deckFilter) &&
      (args.view !== "list" ||
        args.deckId ||
        args.slideNumber != null ||
        args.slideIndex != null)
    ) {
      fail(
        "Home tab, deck search, and deck filter require the Home list view.",
        {
          errorCode: "invalid_home_navigation",
        },
      );
    }
    if (args.deckSearch && args.homeTab === "templates") {
      fail("Deck search requires the Home recent tab.", {
        errorCode: "invalid_home_navigation",
      });
    }
    if (args.deckFilter && args.homeTab === "templates") {
      fail("Deck filter requires the Home recent tab.", {
        errorCode: "invalid_home_navigation",
      });
    }
    const nav: Record<string, string | number> = { app: "slides-2" };
    if (args.view) nav.view = args.view;
    if (args.deckId) nav.deckId = args.deckId;
    if (args.templateId) nav.templateId = args.templateId;
    if (args.themeId) nav.themeId = args.themeId;
    if (args.search) nav.search = args.search;
    if (args.homeTab) nav.homeTab = args.homeTab;
    if (args.deckSearch) {
      nav.deckSearch = args.deckSearch;
      nav.homeTab = "recent";
    }
    if (args.deckFilter) nav.deckFilter = args.deckFilter;
    const internalSlideIndex =
      args.slideNumber != null ? args.slideNumber - 1 : args.slideIndex;
    if (internalSlideIndex != null) nav.slideIndex = internalSlideIndex;
    nav._writeId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await writeAppStateForCurrentTab(appStateKey("navigate"), nav);
    return `Navigating to ${args.view || ""}${args.deckId ? ` deck:${args.deckId}` : ""}${internalSlideIndex != null ? ` slide:${internalSlideIndex + 1}` : ""}`;
  },
});
