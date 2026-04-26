/**
 * See what the user is currently looking at on screen.
 *
 * Reads `navigation` application state and fetches relevant context
 * (dictation history, snippets, style settings, stats). Returns a
 * single JSON snapshot the agent can reason over.
 *
 * Usage:
 *   pnpm action view-screen
 */

import { defineAction } from "@agent-native/core";
import { readAppState } from "@agent-native/core/application-state";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail } from "../server/lib/helpers.js";

interface NavigationState {
  view?: string;
  dictationId?: string;
  path?: string;
}

export default defineAction({
  description:
    "See what the user is currently looking at on screen. Returns the current navigation state plus relevant context (recent dictations on home, snippet list on snippets page, etc.). Prefer reading the auto-included <current-screen> block — call this only when you need a refreshed snapshot.",
  schema: z.object({}),
  http: false,
  run: async () => {
    const navigation = (await readAppState(
      "navigation",
    )) as NavigationState | null;
    const selection = await readAppState("selection");
    const dictationState = await readAppState("dictation-state");

    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;
    if (selection) screen.selection = selection;
    if (dictationState) screen.dictationState = dictationState;

    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    const nav = navigation ?? {};

    switch (nav.view) {
      case "dictation":
      case "home": {
        // Show recent dictations
        const dictations = await db
          .select()
          .from(schema.dictations)
          .where(eq(schema.dictations.ownerEmail, ownerEmail))
          .orderBy(desc(schema.dictations.createdAt))
          .limit(20);
        screen.recentDictations = dictations;
        break;
      }
      case "snippets": {
        const snippets = await db
          .select()
          .from(schema.dictationSnippets)
          .where(eq(schema.dictationSnippets.ownerEmail, ownerEmail))
          .limit(50);
        screen.snippets = snippets;
        break;
      }
      case "dictionary": {
        const terms = await db
          .select()
          .from(schema.dictationDictionary)
          .where(eq(schema.dictationDictionary.ownerEmail, ownerEmail))
          .limit(50);
        screen.dictionary = terms;
        break;
      }
      case "styles":
      case "settings": {
        const styles = await db
          .select()
          .from(schema.dictationStyles)
          .where(eq(schema.dictationStyles.ownerEmail, ownerEmail));
        screen.styles = styles;
        break;
      }
      case "stats": {
        const stats = await db
          .select()
          .from(schema.dictationStats)
          .where(eq(schema.dictationStats.ownerEmail, ownerEmail))
          .orderBy(desc(schema.dictationStats.date))
          .limit(30);
        screen.stats = stats;
        break;
      }
      default:
        break;
    }

    if (Object.keys(screen).length === 0) {
      return "No application state found. Is the app running?";
    }
    return JSON.stringify(screen, null, 2);
  },
});
