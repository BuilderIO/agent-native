import { defineAction, fail } from "@agent-native/core/action";
import { verifyScopedAgentAccessToken } from "@agent-native/core/server";
import { currentAccess, resolveAccess } from "@agent-native/core/sharing";
import {
  toSharedDeckSlide,
  type DesignSystemData,
  type SharedDeckResponse,
  type SharedDeckSlide,
} from "@shared/api";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { slideRevealIssues } from "../server/lib/slide-reveal-issues.js";
import { DECK_AGENT_RESOURCE_KIND } from "../shared/agent-readable.js";
import {
  projectRenderingDesignSystemData,
  readDeckLinkedDesignSystem,
} from "./_linked-design-system.js";

type DeckData = {
  title?: string;
  slides?: unknown[];
  aspectRatio?: SharedDeckResponse["aspectRatio"];
  designSystemId?: unknown;
};

const objectValue = (value: unknown) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export default defineAction({
  description:
    "Read a deck for the /p/:id presentation page: its slides without speaker notes, aspect ratio, and linked design system. Public decks are readable by anyone; other decks need deck access or a deck-scoped agent access token, else the result is restricted.",
  schema: z.object({
    deckId: z.string().min(1).describe("Deck ID from the presentation link."),
    agentAccessToken: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Deck-scoped agent access token from the link's query."),
  }),
  outputSchema: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("ok"),
      deck: z.object({
        title: z.string(),
        slides: z.array(z.custom<SharedDeckSlide>(objectValue)),
        aspectRatio: z
          .custom<NonNullable<SharedDeckResponse["aspectRatio"]>>(
            (value) => typeof value === "string",
          )
          .optional(),
        designSystem: z.custom<DesignSystemData>(objectValue).optional(),
      }),
    }),
    z.object({ status: z.literal("restricted") }),
  ]),
  http: { method: "GET" },
  readOnly: true,
  requiresAuth: false,
  agentTool: false,
  run: async ({ deckId, agentAccessToken }) => {
    // guard:allow-unscoped -- the row is returned only after the public, token, or resolveAccess check below.
    const deck = (
      await getDb()
        .select({
          title: schema.decks.title,
          data: schema.decks.data,
          visibility: schema.decks.visibility,
          designSystemId: schema.decks.designSystemId,
        })
        .from(schema.decks)
        .where(eq(schema.decks.id, deckId))
        .limit(1)
    ).at(0);
    if (!deck) fail(`Deck ${deckId} not found`, { statusCode: 404 });

    const tokenAccess = agentAccessToken
      ? verifyScopedAgentAccessToken(agentAccessToken, {
          resourceKind: DECK_AGENT_RESOURCE_KIND,
          resourceId: deckId,
        }).ok
      : false;
    const readable =
      deck.visibility === "public" ||
      tokenAccess ||
      Boolean(await resolveAccess("deck", deckId, currentAccess()));
    if (!readable) return { status: "restricted" as const };

    const data = JSON.parse(deck.data) as DeckData;
    const designSystemId =
      deck.designSystemId ??
      (typeof data.designSystemId === "string" ? data.designSystemId : null);
    let designSystem: DesignSystemData | undefined;
    if (designSystemId?.trim()) {
      const linked = await readDeckLinkedDesignSystem(deck, designSystemId);
      const projected = projectRenderingDesignSystemData(linked?.resource.data);
      if (projected) designSystem = JSON.parse(projected) as DesignSystemData;
    }

    return {
      status: "ok" as const,
      deck: {
        title: deck.title || data.title || "Untitled",
        slides: Array.isArray(data.slides)
          ? data.slides.map((slide, index) =>
              toSharedDeckSlide(slide, index, {
                includeNotes: false,
                revealIssues: slideRevealIssues(slide),
              }),
            )
          : [],
        ...(data.aspectRatio ? { aspectRatio: data.aspectRatio } : {}),
        ...(designSystem ? { designSystem } : {}),
      },
    };
  },
});
