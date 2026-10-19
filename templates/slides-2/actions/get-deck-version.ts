import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { assertSlides2DeckData } from "./_deck-app-scope.js";

export default defineAction({
  description:
    "Read one saved deck history snapshot, including full slide data, so it can be inspected before restore.",
  schema: z.object({
    deckId: z.string().describe("ID of the deck that owns the snapshot."),
    versionId: z
      .string()
      .describe("Snapshot ID returned by list-deck-versions."),
  }),
  readOnly: true,
  retrySafe: true,
  http: { method: "GET" },
  run: async ({ deckId, versionId }) => {
    let access;
    try {
      access = await assertAccess("deck", deckId, "viewer");
    } catch (error) {
      if (error instanceof ForbiddenError) {
        fail("Deck not found.", {
          errorCode: "deck_not_found",
          statusCode: 404,
        });
      }
      throw error;
    }
    assertSlides2DeckData(access.resource.data);
    const ownerEmail = access.resource.ownerEmail as string;
    const db = getDb();

    const [version] = await db
      .select()
      .from(schema.deckVersions)
      .where(
        and(
          eq(schema.deckVersions.id, versionId),
          eq(schema.deckVersions.deckId, deckId),
          eq(schema.deckVersions.ownerEmail, ownerEmail),
        ),
      )
      .limit(1);

    if (!version) {
      fail("Saved deck version not found.", {
        errorCode: "deck_version_not_found",
        statusCode: 404,
      });
    }

    assertSlides2DeckData(version.data);
    const data = JSON.parse(version.data);
    const slides = Array.isArray(data?.slides) ? data.slides : [];

    return {
      id: version.id,
      deckId: version.deckId,
      title: version.title,
      label: version.changeLabel,
      createdAt: version.createdAt,
      data,
      slides,
      slideCount: slides.length,
      aspectRatio: data?.aspectRatio ?? null,
      designSystemId: data?.designSystemId ?? null,
    };
  },
});
