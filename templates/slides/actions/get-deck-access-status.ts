import { defineAction } from "@agent-native/core";
import {
  getRequestUserEmail,
  getRequestUserName,
} from "@agent-native/core/server/request-context";
import { currentAccess, resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export type DeckAccessStatus = {
  exists: boolean;
  hasAccess: boolean;
  signedIn: boolean;
  viewerEmail: string | null;
  viewerName: string | null;
  role: "owner" | "viewer" | "commenter" | "editor" | "admin" | null;
  visibility: "private" | "org" | "public" | null;
};

export default defineAction({
  description:
    "Return whether a deck URL exists and whether the current viewer can access it. This reveals only safe access metadata, never deck content.",
  schema: z.object({
    deckId: z.string().min(1).describe("Deck ID to check."),
  }),
  http: { method: "GET" },
  readOnly: true,
  requiresAuth: false,
  agentTool: false,
  run: async ({ deckId }): Promise<DeckAccessStatus> => {
    const viewerEmail = getRequestUserEmail() ?? null;
    const viewerName = viewerEmail ? (getRequestUserName() ?? null) : null;
    const [deck] = await getDb()
      .select({
        id: schema.decks.id,
        visibility: schema.decks.visibility,
      })
      .from(schema.decks)
      .where(eq(schema.decks.id, deckId))
      .limit(1);

    if (!deck) {
      return {
        exists: false,
        hasAccess: false,
        signedIn: Boolean(viewerEmail),
        viewerEmail,
        viewerName,
        role: null,
        visibility: null,
      };
    }

    const access = await resolveAccess("deck", deckId, currentAccess());
    return {
      exists: true,
      hasAccess: Boolean(access),
      signedIn: Boolean(viewerEmail),
      viewerEmail,
      viewerName,
      role: access?.role ?? null,
      visibility: deck.visibility ?? "private",
    };
  },
});
