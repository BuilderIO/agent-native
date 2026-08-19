import { defineAction } from "@agent-native/core";
import { signScopedAgentAccessToken } from "@agent-native/core/server";
import {
  getRequestUserEmail,
  getRequestUserName,
} from "@agent-native/core/server/request-context";
import { currentAccess, resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  SLIDES_ACCESS_REQUEST_TOKEN_PREFIX,
  SLIDES_ACCESS_REQUEST_TOKEN_TTL_SECONDS,
} from "../shared/deck-access.js";

export type DeckAccessStatus = {
  exists: boolean;
  hasAccess: boolean;
  signedIn: boolean;
  viewerEmail: string | null;
  viewerName: string | null;
  role: "owner" | "viewer" | "commenter" | "editor" | "admin" | null;
  visibility: "private" | "org" | "public" | null;
  accessRequestToken?: string;
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

    let access: Awaited<ReturnType<typeof resolveAccess>> = null;
    try {
      access = await resolveAccess("deck", deckId, currentAccess());
    } catch (error) {
      // coercion-ok: an access probe failure must fail closed as no access so
      // the page stays gated while the request capability remains available.
      console.warn(
        "[slides] deck access probe failed; treating the deck as private:",
        error,
      );
    }
    const visibility = deck.visibility ?? "private";
    const accessRequestToken =
      !access && visibility === "private"
        ? signScopedAgentAccessToken({
            resourceKind: SLIDES_ACCESS_REQUEST_TOKEN_PREFIX,
            resourceId: deckId,
            ...(viewerEmail ? { viewerEmail } : {}),
            ttlSeconds: SLIDES_ACCESS_REQUEST_TOKEN_TTL_SECONDS,
          })
        : undefined;
    return {
      exists: true,
      hasAccess: Boolean(access),
      signedIn: Boolean(viewerEmail),
      viewerEmail,
      viewerName,
      role: access?.role ?? null,
      visibility,
      ...(accessRequestToken ? { accessRequestToken } : {}),
    };
  },
});
