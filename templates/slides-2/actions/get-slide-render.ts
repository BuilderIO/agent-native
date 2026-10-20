import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { slideAssetOrigins } from "../server/lib/slide-source.js";
import { buildReactSlideRuntime } from "../server/lib/slide-worker-runtime.js";
import { resolveSlideDesignFontAssets } from "../server/lib/uploaded-fonts.js";
import { readSlideDesignTokens } from "../shared/slide-design-tokens.js";
import { assertSlides2DeckData } from "./_deck-app-scope.js";
import {
  compileSlideSource,
  readStoredSlideSource,
  slideSourceFailure,
} from "./_slide-source.js";

export default defineAction({
  title: "Render slide source",
  description:
    "Return a revision-checked render artifact for a saved React slide. It contains a bounded Worker bundle and validated design, metadata, transition, styles, and uploaded-asset references for rendering in an opaque-origin sandbox; `html` is the derived legacy preview and may be empty for React modules with imports. The artifact includes the source revision/hash and only origins of referenced uploaded assets.",
  agentTool: false,
  schema: z.object({
    deckId: z.string().min(1).describe("Deck containing the slide"),
    slideId: z.string().min(1).describe("Stable slide ID to render"),
    expectedRevision: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Optional revision the editor expects to render"),
    expectedSourceHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional()
      .describe("Optional source hash the editor expects to render"),
  }),
  readOnly: true,
  retrySafe: true,
  http: { method: "GET" },
  mcpAnnotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  requiresAuth: false,
  run: async ({ deckId, slideId, expectedRevision, expectedSourceHash }) => {
    await assertAccess("deck", deckId, "viewer");
    const [row] = await getDb()
      .select({
        id: schema.decks.id,
        ownerEmail: schema.decks.ownerEmail,
        orgId: schema.decks.orgId,
        data: schema.decks.data,
      })
      .from(schema.decks)
      .where(eq(schema.decks.id, deckId))
      .limit(1);
    if (!row)
      throw slideSourceFailure("Deck not found.", 404, "deck_not_found");
    const snapshot = readStoredSlideSource(row.data, slideId);
    assertSlides2DeckData(snapshot.data);
    if (
      (expectedRevision !== undefined &&
        expectedRevision !== snapshot.revision) ||
      (expectedSourceHash !== undefined &&
        expectedSourceHash !== snapshot.sourceHash)
    ) {
      throw slideSourceFailure(
        "Slide source changed before it could be rendered.",
        409,
        "slide_source_conflict",
        { revision: snapshot.revision, sourceHash: snapshot.sourceHash },
      );
    }
    const rendered = await compileSlideSource(snapshot.slide.sourceTsx, {
      ownerEmail: row.ownerEmail,
      orgId: row.orgId,
    });
    if (
      rendered.sourceHash !== snapshot.sourceHash ||
      snapshot.slide.content !== rendered.content
    ) {
      throw slideSourceFailure(
        "Stored slide preview does not match its React source.",
        409,
        "slide_source_integrity_error",
      );
    }
    const slides = snapshot.data.slides;
    if (!Array.isArray(slides) || slides.length < 1) {
      throw slideSourceFailure(
        "Deck slide ordering is invalid for rendering.",
        409,
        "invalid_deck_slide_order",
      );
    }
    const runtime = await buildReactSlideRuntime(snapshot.slide.sourceTsx, {
      current: snapshot.position + 1,
      total: slides.length,
      assetUrls: rendered.assetUrls,
    });
    const designTokens = readSlideDesignTokens(snapshot.data);
    const fontAssets = await resolveSlideDesignFontAssets(designTokens, {
      deckId,
      ownerEmail: row.ownerEmail,
      orgId: row.orgId,
    });
    return {
      protocolVersion: 1,
      deckId,
      slideId,
      revision: snapshot.revision,
      sourceHash: snapshot.sourceHash,
      width: 1920,
      height: 1080,
      html: rendered.content,
      assetOrigins: rendered.assetOrigins,
      fontOrigins: slideAssetOrigins(fontAssets.map((font) => font.url)),
      fontAssets,
      designTokens,
      runtime,
    };
  },
});
