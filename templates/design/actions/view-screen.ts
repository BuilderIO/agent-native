/**
 * See what the user is currently looking at on screen.
 *
 * Reads navigation state and design context from application state.
 *
 * Usage:
 *   pnpm action view-screen
 */

import { defineAction } from "@agent-native/core";
import { readAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description:
    "See what the user is currently looking at on screen. Returns the current navigation state including which design is open, which view they are on (list, editor, design-systems, present, examples), plus any pending question overlay or variant grid. Always call this first before taking any action.",
  schema: z.object({}),
  http: false,
  run: async () => {
    const [navigation, showQuestions, designVariants] = await Promise.all([
      readAppState("navigation"),
      readAppState("show-questions"),
      readAppState("design-variants"),
    ]);

    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;
    if (showQuestions) {
      screen.pendingQuestions = showQuestions;
      screen.note =
        "Questions are visible to the user as a full-canvas overlay. Wait for their answers (they'll come back as a chat message) before generating.";
    }
    if (designVariants) {
      screen.pendingVariants = designVariants;
      screen.variantsNote =
        "A variant picker is open. Wait for the user to pick one (a chat message will arrive) before generating further. Do not call generate-design while this is open.";
    }

    if (Object.keys(screen).length === 0) {
      return "No application state found. Is the app running?";
    }
    return JSON.stringify(screen, null, 2);
  },
});
